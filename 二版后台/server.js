'use strict';
const http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const R = require('./rules'),
  { need } = R,
  { open } = require('./db'),
  { validate, defaults } = require('./content'),
  { prepare, change } = require('./account');
const root = __dirname;
function build(store, options = {}) {
  const requestExternal = options.fetch || globalThis.fetch;
  const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer /, '');
  const content = () => store.content();
  function admin(actor, action, b) {
    need(actor?.startsWith('op:'), '请登录管理后台', 401);
    const name = actor.slice(3);
    const roles = JSON.parse(store.get('SELECT roles FROM operators WHERE name=?', name).roles);
    const allow = (...r) =>
      need(
        r.some((v) => roles.includes(v)),
        '当前角色无此权限',
        403
      );
    if (action === 'me') return { name, roles };
    if (action === 'logout') {
      return {};
    }
    if (action === 'source') {
      allow('运营', '审核', '管理员');
      return [...new Map([...R.moves.values()].map((m) => [m.sourceId, m])).values()].map((m) => ({
        id: m.sourceId,
        name: m.name,
        part: m.part,
        muscle: m.muscle,
        gear: m.gear
      }));
    }
    if (action === 'usage') {
      allow('管理员', '审核', '运营');
      R.day(b.date);
      const dateList = Array.from({ length: 7 }, (_, i) => R.shift(b.date, i - 6));
      const stats = new Map(
        dateList.map((date) => [date, { date, calls: 0, success: 0, input: 0, output: 0, cost: 0 }])
      );
      for (const e of store.all(
        "SELECT substr(at,1,10) AS date,info FROM audit WHERE kind='AI 调用' AND substr(at,1,10) BETWEEN ? AND ?",
        dateList[0],
        b.date
      )) {
        const v = JSON.parse(e.info),
          d = stats.get(e.date);
        d.calls++;
        d.success += Number(!!v.ok);
        d.input += v.inputTokens || 0;
        d.output += v.outputTokens || 0;
        d.cost += v.cost || 0;
      }
      return [...stats.values()];
    }
    if (action === 'dashboard') {
      allow('管理员', '运营', '审核', '客服');
      let events = store.all(
        'SELECT id,at,kind,info FROM audit WHERE substr(at,1,10)=? ORDER BY id DESC',
        b.date
      );
      events = events.filter(
        (x) =>
          roles.includes('管理员') ||
          (['排课失败', '动图失败', 'AI 调用', '发布'].includes(x.kind) &&
            !roles.every((r) => r === '客服'))
      );
      return events.map((x) => ({ ...x, info: JSON.parse(x.info) }));
    }
    if (action === 'tickets') {
      allow('客服', '管理员');
      return store.all(
        'SELECT id,kind,detail,status,assignee,consent,at,mealRef FROM tickets WHERE assignee=? OR ? ORDER BY id DESC',
        name,
        roles.includes('管理员') ? 1 : 0
      );
    }
    if (action === 'assign') {
      allow('管理员');
      need(
        JSON.parse(
          store.get('SELECT roles FROM operators WHERE name=?', b.assignee)?.roles || '[]'
        ).includes('客服'),
        '客服账号不存在'
      );
      store.run('UPDATE tickets SET assignee=? WHERE id=?', b.assignee, b.id);
      store.audit(actor, '工单分派', { id: b.id });
      return {};
    }
    if (action === 'ticket') {
      allow('客服', '管理员');
      const t = store.get('SELECT * FROM tickets WHERE id=?', b.id);
      need(t && (t.assignee === name || roles.includes('管理员')), '无此工单权限', 403);
      if (b.resolve) {
        need(t.kind !== '注销', '请由管理员完成注销流程');
        store.run("UPDATE tickets SET status='已处理' WHERE id=?", t.id);
        store.audit(actor, '处理工单', { id: t.id });
        t.status = '已处理';
      }
      if (b.erase) {
        allow('管理员');
        need(t.kind === '注销' && t.status !== '已处理', '此工单不是待处理的注销申请');
        store.run('DELETE FROM sessions WHERE owner=?', t.owner);
        store.run('DELETE FROM requests WHERE owner=?', t.owner);
        store.run('DELETE FROM accounts WHERE id=?', t.owner);
        store.run(
          "UPDATE tickets SET owner='',detail='',consent=0,status='已处理' WHERE owner=?",
          t.owner
        );
        store.audit(actor, '完成注销', { id: t.id });
        return { id: t.id, status: '已处理' };
      }
      if (t.status === '已处理' && !t.owner) return { id: t.id, status: t.status };
      const a = store.account(t.owner);
      const result = {
        id: t.id,
        kind: t.kind,
        status: t.status,
        detail: t.detail,
        versions:
          t.mealRef && a.meals[t.mealRef]
            ? [a.meals[t.mealRef]].map((m) => ({
                date: m.date,
                index: m.index,
                foodsVersion: m.foodsVersion,
                nutritionVersion: m.nutritionVersion
              }))
            : []
      };
      if (b.personal) {
        need(t.consent && t.assignee === name, '缺少用户对此工单的授权', 403);
        store.audit(actor, '查看个人字段', { ticket: t.id });
        result.profile = a.profile;
      }
      return result;
    }
    if (action === 'operator') {
      allow('管理员');
      store.operator(b.name, b.password, b.roles);
      store.audit(actor, '设置角色', { name: b.name, roles: b.roles });
      return {};
    }
    if (action === 'key') {
      allow('管理员');
      const hex = process.env.LIANNA_MASTER_KEY;
      need(/^[0-9a-f]{64}$/i.test(hex || ''), '请先配置服务端加密密钥');
      need(typeof b.key === 'string' && b.key.length >= 8, '密钥无效');
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), iv);
      const enc = Buffer.concat([c.update(b.key, 'utf8'), c.final()]);
      store.run(
        'INSERT OR REPLACE INTO secrets VALUES(?,?)',
        'ai',
        JSON.stringify([iv.toString('hex'), c.getAuthTag().toString('hex'), enc.toString('hex')])
      );
      store.audit(actor, '轮换模型密钥', {});
      return { configured: true };
    }
    if (action === 'modules') {
      allow('运营', '审核', '管理员');
      const c = content();
      return {
        versions: c.version,
        drafts: store.all('SELECT id,module,base,status,byname FROM drafts ORDER BY id DESC')
      };
    }
    const mod = b.module;
    need(Object.hasOwn(defaults, mod), '模块不存在');
    if (mod === 'ai') allow('管理员', '审核', '运营');
    else allow('管理员', '审核', '运营');
    if (action === 'inspect') {
      const c = content();
      return {
        active: c[mod],
        templates: mod === 'actions' ? c.templates.patterns : undefined,
        version: c.version[mod],
        history: store
          .all('SELECT version FROM versions WHERE module=? ORDER BY version DESC', mod)
          .map((x) => x.version),
        draft: b.id ? store.get('SELECT * FROM drafts WHERE id=? AND module=?', b.id, mod) : null
      };
    }
    if (action === 'version') {
      const v = store.get(
        'SELECT value FROM versions WHERE module=? AND version=?',
        mod,
        b.version
      );
      need(v, '版本不存在');
      return JSON.parse(v.value);
    }
    if (action === 'draft') {
      allow('运营', ...(mod === 'ai' ? ['管理员'] : []));
      validate(mod, b.value);
      need(Number.isInteger(b.base), '基线无效');
      const id = store.run(
        "INSERT INTO drafts(module,base,value,status,byname) VALUES(?,?,?,'草稿',?)",
        mod,
        b.base,
        JSON.stringify(b.value),
        name
      ).lastInsertRowid;
      return { id: Number(id) };
    }
    if (action === 'submit') {
      allow('运营', ...(mod === 'ai' ? ['管理员'] : []));
      need(
        store.run(
          "UPDATE drafts SET status='待审核' WHERE id=? AND module=? AND status='草稿'",
          b.id,
          mod
        ).changes === 1,
        '草稿状态已变化',
        409
      );
      return {};
    }
    allow('审核');
    need(typeof b.reason === 'string' && b.reason.trim(), '请填写审核或回退原因');
    if (action === 'rollback') {
      const v = store.get(
        'SELECT value FROM versions WHERE module=? AND version=?',
        mod,
        b.version
      );
      need(v, '目标版本不存在');
      return { version: store.publish(actor, mod, b.base, JSON.parse(v.value), b.reason) };
    }
    const d = store.get(
      "SELECT * FROM drafts WHERE module=? AND id=? AND status='待审核'",
      mod,
      b.id
    );
    need(d, '待审核内容不存在', 409);
    if (action === 'reject') {
      store.run("UPDATE drafts SET status='退回' WHERE id=?", d.id);
      store.audit(actor, '退回', { id: d.id, reason: b.reason });
      return {};
    }
    need(action === 'publish', '未知操作');
    const version = store.publish(actor, mod, d.base, JSON.parse(d.value), b.reason);
    store.run("UPDATE drafts SET status='已发布' WHERE id=?", d.id);
    return { version };
  }
  function modelKey() {
    const r = store.get("SELECT value FROM secrets WHERE name='ai'");
    if (!r) return process.env.LIANNA_AI_KEY;
    const [iv, tag, cipher] = JSON.parse(r.value);
    const dec = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.LIANNA_MASTER_KEY, 'hex'),
      Buffer.from(iv, 'hex')
    );
    dec.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([dec.update(Buffer.from(cipher, 'hex')), dec.final()]).toString('utf8');
  }
  async function recommend(actor, profile, b, c, override) {
    const foods = c.foods.filter((f) => R.usable(f, profile, c.risk));
    const config = override || c.ai;
    const fallback = (reason) => ({ items: [], reason, manual: true });
    const info = {
      version: c.version.ai,
      model: config.model,
      cost: 0,
      ok: false,
      inputTokens: 0,
      outputTokens: 0
    };
    const t = Date.now();
    try {
      const key = modelKey(),
        url = process.env.LIANNA_AI_URL;
      need(key && url && config.model, '模型未配置');
      need(/^https:\/\//.test(url), '模型服务地址无效');
      store.tx(() => {
        const n = store.get(
          "SELECT count(*) n FROM audit WHERE kind='AI 请求' AND date(at)=date('now','+8 hours')"
        ).n;
        need(n < config.dailyLimit, '今日额度已用尽');
        store.audit(actor, 'AI 请求', { version: info.version });
      });
      const reply = await requestExternal(url, {
        method: 'POST',
        signal: AbortSignal.timeout(12000),
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: config.prompt },
            {
              role: 'user',
              content: JSON.stringify({
                meal: R.parts[b.index],
                candidates: foods.map((f) => ({ id: f.id, name: f.name })),
                taste: String(b.taste || '').slice(0, 120)
              })
            }
          ]
        })
      });
      need(reply.ok, '模型暂不可用');
      const data = await reply.json();
      info.inputTokens = data.usage?.prompt_tokens || 0;
      info.outputTokens = data.usage?.completion_tokens || 0;
      info.cost =
        ((data.usage?.prompt_tokens || 0) * config.pricePerMillionInput +
          (data.usage?.completion_tokens || 0) * config.pricePerMillionOutput) /
        1e6;
      const choices = JSON.parse(data.choices[0].message.content);
      const current = content();
      const liveProfile = actor.startsWith('op:') ? profile : store.account(actor).profile;
      const available = current.foods.filter((f) => R.usable(f, liveProfile, current.risk));
      need(
        Array.isArray(choices) &&
          choices.length &&
          choices.every(
            (x) => foods.some((f) => f.id === x.id) && available.some((f) => f.id === x.id)
          ),
        '模型返回不可用编号'
      );
      info.ok = true;
      return {
        items: choices.map((x) => ({ id: x.id, reason: String(x.reason || '').slice(0, 200) }))
      };
    } catch (e) {
      info.reason = e.status ? e.message : '模型超时或返回格式无效';
      return fallback(info.reason);
    } finally {
      store.audit(actor, 'AI 调用', { ...info, duration: Date.now() - t });
    }
  }
  async function api(route, b, req) {
    const token = bearer(req),
      actor = store.owner(token),
      c = content();
    if (route === 'admin/login') return { token: store.opLogin(b.name, b.password) };
    if (route === 'admin/logout') {
      store.run('DELETE FROM sessions WHERE token=?', store.hash(token));
      return {};
    }
    if (route.startsWith('admin/')) return store.tx(() => admin(actor, route.slice(6), b));
    if (route === 'login') {
      need(typeof b.code === 'string' && b.code, '缺少微信登录凭证');
      const appid = process.env.LIANNA_APP_ID || 'wx30a87cd4d4c6e9c1',
        secret = process.env.LIANNA_APP_SECRET;
      need(secret, '业务服务尚未配置微信 AppSecret', 503);
      const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
      url.search = new URLSearchParams({
        appid,
        secret,
        js_code: b.code,
        grant_type: 'authorization_code'
      });
      const data = await (await requestExternal(url, { signal: AbortSignal.timeout(8000) })).json();
      need(typeof data.openid === 'string' && data.openid, '微信登录凭证无效，请重试', 401);
      const id = store.hash(appid + ':' + data.openid);
      return store.tx(() => {
        store.ensure(id);
        return { token: store.session(id), accountId: id, state: store.account(id) };
      });
    }
    if (route === 'catalog')
      return { version: c.version.actions, actions: c.actions, gear: R.gearList };
    if (route === 'replacements') {
      const from = R.moves.get(b.id),
        meta = c.actions.find((a) => a.id === from?.sourceId);
      if (!meta) return [];
      const gear = Array.isArray(b.gear) ? b.gear : [];
      return c.actions
        .filter(
          (a) =>
            a.id !== meta.id &&
            a.approved &&
            a.enabled &&
            a.visible !== false &&
            (a.pattern === meta.pattern || (meta.replacements || []).includes(a.id)) &&
            !R.missing(
              {
                ...R.moves.get(a.id),
                gear: a.gear || R.moves.get(a.id).gear,
                alternatives: a.alternatives || R.moves.get(a.id).alternatives
              },
              gear
            ).length
        )
        .sort(
          (x, y) =>
            Number(R.moves.get(y.id).muscle === from.muscle) -
            Number(R.moves.get(x.id).muscle === from.muscle)
        );
    }
    if (route === 'preview/plan') {
      try {
        if (actor && !actor.startsWith('op:')) return prepare(store.account(actor), b, c);
        return R.plan(b, c, { favorites: Array.isArray(b.favorites) ? b.favorites : [] });
      } catch (e) {
        store.audit(actor || '游客', '排课失败', {
          reason: e.message,
          version: c.version.templates,
          actionsVersion: c.version.actions
        });
        throw e;
      }
    }
    if (route === 'foods')
      return { version: c.version.foods, foods: c.foods.filter((f) => R.usable(f, b, c.risk)) };
    if (route === 'profile/preview') return R.profile(b, c.nutrition);
    if (route === 'preview/meal') {
      const profile = R.profile(b.profile, c.nutrition);
      return { ...R.meal(profile, b.index, b.items, c.foods, c.risk), version: c.version.foods };
    }
    if (route === 'preview/draft') {
      need(actor?.startsWith('op:'), '请登录后台', 401);
      const module = b.module;
      admin(actor, 'inspect', { module });
      validate(module, b.value);
      const draft = { ...c, [module]: b.value };
      if (module === 'ai')
        return recommend(actor, b.sample.profile || {}, b.sample, draft, b.value);
      if (['nutrition', 'foods'].includes(module)) {
        const p = R.profile(b.sample.profile, draft.nutrition);
        return {
          ...R.meal(p, b.sample.index, b.sample.items, draft.foods, c.risk),
          excluded: draft.foods
            .filter((f) => !R.usable(f, p, c.risk))
            .map((f) => ({ id: f.id, name: f.name, reason: R.foodReason(f, p, c.risk) })),
          version: draft.version
        };
      }
      return R.plan(b.sample, draft, { favorites: b.sample.favorites || [] });
    }
    if (route === 'media/error') {
      need(R.moves.has(b.id), '动作不存在');
      store.audit(actor || '游客', '动图失败', { id: b.id, version: c.version.actions });
      return {};
    }
    need(actor && !actor.startsWith('op:'), '请先微信登录', 401);
    if (route === 'state') return store.account(actor);
    if (route === 'logout') {
      store.run('DELETE FROM sessions WHERE token=?', store.hash(token));
      return {};
    }
    if (route === 'recommend') {
      const profile = store.account(actor).profile;
      need(profile, '请先保存饮食资料');
      return recommend(actor, profile, b, c);
    }
    if (route === 'ticket') {
      need(
        ['反馈', '注销'].includes(b.kind) &&
          typeof b.detail === 'string' &&
          b.detail.length <= 1000,
        '工单内容无效'
      );
      const ref = b.mealRef || null;
      if (ref) need(Object.hasOwn(store.account(actor).meals, ref), '关联餐次无效');
      const id = store.run(
        "INSERT INTO tickets(owner,kind,detail,status,consent,mealRef) VALUES(?,?,?,'待处理',?,?)",
        actor,
        b.kind,
        b.detail,
        b.consent ? 1 : 0,
        ref
      ).lastInsertRowid;
      return { id: Number(id) };
    }
    if (route === 'tickets')
      return store.all(
        'SELECT id,kind,status,at FROM tickets WHERE owner=? ORDER BY id DESC',
        actor
      );
    need(route === 'change', '接口不存在', 404);
    return store.tx(() => {
      const a = store.account(actor);
      need(typeof b.requestId === 'string' && /^[\w-]{12,100}$/.test(b.requestId), '请求编号无效');
      if (store.get('SELECT 1 FROM requests WHERE owner=? AND id=?', actor, b.requestId)) return a;
      need(a.rev === b.rev, '另一台设备已更新，请重新载入再保存', 409);
      change(a, b.action, b.body, c);
      const rev = a.rev + 1;
      delete a.rev;
      store.run('UPDATE accounts SET value=?,rev=? WHERE id=?', JSON.stringify(a), rev, actor);
      store.run('INSERT INTO requests VALUES(?,?,?)', actor, b.requestId, rev);
      return { rev, ...a };
    });
  }
  const attempts = new Map();
  function limit(ip) {
    const now = Date.now();
    if (attempts.size > 10000)
      for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
    let v = attempts.get(ip);
    if (!v || v.until <= now) {
      v = { count: 0, until: now + 60000 };
      attempts.set(ip, v);
    }
    need(++v.count <= 20, '登录尝试过于频繁，请稍后重试', 429);
  }
  const names = { '/': 'admin.html', '/admin.css': 'admin.css', '/admin.js': 'admin.js' };
  const mediaRoot = path.join(root, '..', '动作库');
  const originalFiles = new Map(
    fs.readdirSync(path.join(mediaRoot, '原版项目', 'videos')).map((f) => [f.slice(0, 4), f])
  );
  return http.createServer(async (req, res) => {
    try {
      const media = /^\/media\/(original|new|cover)\/(\d{4})$/.exec(req.url);
      if (req.method === 'GET' && media) {
        const [, kind, id] = media;
        need(originalFiles.has(id), '无此素材', 404);
        const file =
          kind === 'original'
            ? path.join(mediaRoot, '原版项目', 'videos', originalFiles.get(id))
            : path.join(
                mediaRoot,
                '新版动作库',
                kind === 'new' ? '动图' : '封面',
                id + (kind === 'new' ? '.gif' : '.png')
              );
        res.writeHead(200, {
          'Content-Type': kind === 'cover' ? 'image/png' : 'image/gif',
          'Cache-Control': 'private,max-age=3600'
        });
        return fs
          .createReadStream(file)
          .on('error', () => res.destroy())
          .pipe(res);
      }
      if (req.method === 'GET' && Object.hasOwn(names, req.url)) {
        const file = names[req.url];
        res.writeHead(200, {
          'Content-Type':
            { html: 'text/html', css: 'text/css', js: 'text/javascript' }[file.split('.').pop()] +
            '; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        return res.end(fs.readFileSync(path.join(root, file)));
      }
      need(req.method === 'POST' && req.url.startsWith('/api/'), '接口不存在', 404);
      let size = 0;
      const chunks = [];
      for await (const raw of req) {
        size += raw.length;
        need(size <= 2e6, '请求过大', 413);
        chunks.push(raw);
      }
      const b = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      need(b && typeof b === 'object' && !Array.isArray(b), '请求格式无效');
      if (['/api/admin/login', '/api/login'].includes(req.url)) limit(req.socket.remoteAddress);
      const out = await api(req.url.slice(5), b, req);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(e.status || (e instanceof SyntaxError ? 400 : 500), {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({ error: e.status ? e.message : '操作未完成，请检查输入后重试' }));
    }
  });
}
if (require.main === module) {
  const dir = process.env.LIANNA_DATA || path.join(root, 'runtime');
  fs.mkdirSync(dir, { recursive: true });
  const store = open(path.join(dir, 'lianna.sqlite'));
  if (process.argv[2] === 'operator') {
    store.operator(
      process.argv[3],
      process.env.LIANNA_OPERATOR_PASSWORD,
      (process.argv[4] || '').split(',')
    );
    console.log('后台账号已配置');
  } else {
    const port = Number(process.env.PORT || 8786);
    build(store).listen(port, process.env.LIANNA_BIND || '127.0.0.1', () =>
      console.log('练哪二版服务端口 ' + port)
    );
  }
}
module.exports = { build };
