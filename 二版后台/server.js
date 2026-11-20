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
const M = require('./management'), Ledger = require('./ledger');
const Completion = require('./completion');
const root = __dirname;
function build(store, options = {}) {
  M.setup(store); Ledger.setup(store); Completion.setup(store);
  const requestExternal = options.fetch || globalThis.fetch;
  const encryptionKey = () => process.env.LIANNA_MASTER_KEY || options.masterKey;
  const modelUrl = (model) => process.env.LIANNA_AI_URL || (model?.startsWith('deepseek-') ? 'https://api.deepseek.com/chat/completions' : '');
  const bearer = (req) =>
    (req.headers.authorization || '').replace(/^Bearer /, '');
  const content = () => store.content();
  function admin(actor, action, b) {
    need(actor?.startsWith('op:'), '请登录管理后台', 401);
    const name = actor.slice(3);
    const principal=M.principal(store,actor);
    const modulePermission=b.module==='ai'?'ai.':'content.';
    const priceKeys=['pricePerMillionInput','pricePerMillionOutput','pricePerMillionCache','fallbackInput','fallbackOutput','fallbackCache'];
    const safeConfig=value=>{const copy=structuredClone(value);if(b.module==='ai'&&!principal.has('ai.cost'))for(const k of priceKeys)delete copy[k];return copy};

    const roles = JSON.parse(
      store.get('SELECT roles FROM operators WHERE name=?', name).roles
    );
    const allow = (...r) => {
      const capability=action==='key'?'ai.credentials':action==='operator'||action==='wechat-key'||action==='wechat-status'||action==='assign'?'admin.manage':['publish','reject','rollback'].includes(action)?modulePermission+'publish':['draft','submit'].includes(action)?modulePermission+'edit':b.module==='ai'?'ai.view':'content.view';
      need(r.some(v=>roles.includes(v))||principal.has(capability),'当前角色无此权限',403);
    };
    if (action === 'me') return { name, roles };
    if (action === 'logout') {
      return {};
    }
    if (action === 'source') {
      allow('运营', '审核', '管理员');
      return [
        ...new Map([...R.moves.values()].map((m) => [m.sourceId, m])).values()
      ].map((m) => ({
        id: m.sourceId,
        name: m.name,
        part: m.part,
        muscle: m.muscle,
        steps: m.steps,
        gear: m.gear
      }));
    }
    if (action === 'usage') {
      need(Ledger.globalScope(principal),'旧版汇总需要完整数据范围，请使用新版费用明细',403);
      allow('管理员', '审核', '运营');
      R.day(b.date);
      const dateList = Array.from({ length: 7 }, (_, i) =>
        R.shift(b.date, i - 6)
      );
      const stats = new Map(
        dateList.map((date) => [
          date,
          { date, calls: 0, success: 0, input: 0, output: 0, cost: 0 }
        ])
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
    if (action === 'overview') {
      need(Ledger.globalScope(principal),'旧版汇总需要完整数据范围，请使用新版运营概览',403);
      allow('管理员', '审核', '运营');
      R.day(b.date);
      const days = Array.from({ length: 7 }, (_, i) => R.shift(b.date, i - 6));
      const counts = store.all(
        "SELECT substr(at,1,10) AS day,kind,count(*) AS n FROM audit WHERE kind IN ('生成计划','保存计划') AND substr(at,1,10) BETWEEN ? AND ? GROUP BY day,kind",
        days[0],
        b.date
      );
      const history = store.all(
        "SELECT actor,at,info FROM audit WHERE kind='发布' AND substr(at,1,10)<=? ORDER BY id DESC LIMIT 20",
        b.date
      );
      return {
        trend: days.map((day) => ({
          day,
          generated:
            counts.find((x) => x.day === day && x.kind === '生成计划')?.n || 0,
          saved:
            counts.find((x) => x.day === day && x.kind === '保存计划')?.n || 0
        })),
        history: history.map((x) => ({ ...x, info: JSON.parse(x.info) }))
      };
    }
    if (action === 'dashboard') {
      need(Ledger.globalScope(principal),'旧版事件汇总需要完整数据范围，请使用新版操作日志',403);
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
      return events.filter(x=>x.kind!=='AI 调用'||principal.has('ai.cost')).map((x) => ({ ...x, info: JSON.parse(x.info) }));
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
          store.get('SELECT roles FROM operators WHERE name=?', b.assignee)
            ?.roles || '[]'
        ).includes('客服'),
        '客服账号不存在'
      );
      need(store.run('UPDATE tickets SET assignee=? WHERE id=?', b.assignee, b.id).changes === 1, '工单不存在', 404);
      store.audit(actor, '工单分派', { id: b.id });
      return {};
    }
    if (action === 'ticket') {
      allow('客服', '管理员');
      const t = store.get('SELECT * FROM tickets WHERE id=?', b.id);
      need(
        t && (t.assignee === name || roles.includes('管理员')),
        '无此工单权限',
        403
      );
      if (b.resolve) {
        need(t.kind !== '注销', '请由管理员完成注销流程');
        store.run("UPDATE tickets SET status='已处理' WHERE id=?", t.id);
        store.audit(actor, '处理工单', { id: t.id });
        t.status = '已处理';
      }
      if (b.erase) {
        allow('管理员');
        need(
          t.kind === '注销' && t.status !== '已处理',
          '此工单不是待处理的注销申请'
        );
        Completion.endpoint(store,actor,'ticket',{id:t.id,operation:'注销',confirm:String(t.id),reason:b.reason||'根据用户注销申请完成清理'},{});
        return { id: t.id, status: '已处理' };
      }
      if (t.status === '已处理' && !t.owner)
        return { id: t.id, status: t.status };
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
    if(action==='operator') return M.endpoint(store,actor,'staff-save',{...b,display:b.name,scope:{users:'all',scenes:[],environment:'all'},reason:b.reason||'设置后台账号与角色'},{});
    if (action === 'ai-status') {
      allow('管理员', '审核', '运营');
      return { configured: !!(store.get("SELECT 1 FROM secrets WHERE name='ai'") || process.env.LIANNA_AI_KEY || process.env.DEEPSEEK_API_KEY),disabled:!!store.get("SELECT 1 FROM secrets WHERE name='ai-disabled'") };
    }
    if (action === 'wechat-status') {
      allow('管理员');
      return {
        appId: process.env.LIANNA_APP_ID || 'wx30a87cd4d4c6e9c1',
        configured: !!(process.env.LIANNA_APP_SECRET || store.get("SELECT 1 FROM secrets WHERE name='wechat'"))
      };
    }
    if (action === 'key' || action === 'wechat-key') {
      allow('管理员');
      const hex = encryptionKey();
      need(/^[0-9a-f]{64}$/i.test(hex || ''), '请先配置服务端加密密钥');
      need(typeof b.key === 'string' && b.key.length >= 8, '密钥无效');
      if (action === 'wechat-key') need(/^[0-9a-f]{32}$/i.test(b.key), 'AppSecret 应为 32 位十六进制字符');
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), iv);
      const enc = Buffer.concat([c.update(b.key, 'utf8'), c.final()]);
      store.run(
        'INSERT OR REPLACE INTO secrets VALUES(?,?)',
        action === 'wechat-key' ? 'wechat' : 'ai',
        JSON.stringify([
          iv.toString('hex'),
          c.getAuthTag().toString('hex'),
          enc.toString('hex')
        ])
      );
      store.audit(actor, action === 'wechat-key' ? '配置微信 AppSecret' : '轮换模型密钥', {});
      return { configured: true };
    }
    if (action === 'modules') {
      allow('运营', '审核', '管理员');
      const c = content();
      return {
        versions: c.version,
        drafts: store.all(
          'SELECT id,module,base,status,byname FROM drafts ORDER BY id DESC'
        )
      };
    }
    const mod = b.module;
    need(Object.hasOwn(defaults, mod), '模块不存在');
    if (mod === 'ai') allow('管理员', '审核', '运营');
    else allow('管理员', '审核', '运营');
    if (action === 'inspect') {
      const c = content();
      return {
        active: safeConfig(c[mod]),
        templates: mod === 'actions' ? c.templates.patterns : undefined,
        version: c.version[mod],
        history: store
          .all(
            'SELECT version FROM versions WHERE module=? ORDER BY version DESC',
            mod
          )
          .map((x) => x.version),
        draft: b.id
          ? store.get('SELECT * FROM drafts WHERE id=? AND module=?', b.id, mod)
          : store.get("SELECT * FROM drafts WHERE module=? AND base=? AND status IN ('草稿','待审核','退回') ORDER BY id DESC LIMIT 1",mod,c.version[mod])
      };
    }
    if (action === 'version') {
      const v = store.get(
        'SELECT value FROM versions WHERE module=? AND version=?',
        mod,
        b.version
      );
      need(v, '版本不存在');
      return safeConfig(JSON.parse(v.value));
    }
    if (action === 'draft') {
      allow('运营', ...(mod === 'ai' ? ['管理员'] : []));
      if(mod==='ai'&&!principal.has('ai.cost')) {const active=content().ai;for(const k of priceKeys){need(b.value[k]===undefined||b.value[k]===active[k],'无单价变更权限',403);if(active[k]!==undefined)b.value[k]=active[k];}}
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
    need(
      typeof b.reason === 'string' && b.reason.trim(),
      '请填写审核或回退原因'
    );
    if (action === 'rollback') {
      const v = store.get(
        'SELECT value FROM versions WHERE module=? AND version=?',
        mod,
        b.version
      );
      need(v, '目标版本不存在');
      return {
        version: store.publish(
          actor,
          mod,
          b.base,
          JSON.parse(v.value),
          b.reason
        )
      };
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
    const version = store.publish(
      actor,
      mod,
      d.base,
      JSON.parse(d.value),
      b.reason
    );
    store.run("UPDATE drafts SET status='已发布' WHERE id=?", d.id);
    return { version };
  }
  function modelKey() {
    if(store.get("SELECT 1 FROM secrets WHERE name='ai-disabled'"))return undefined;
    return savedSecret('ai') || process.env.LIANNA_AI_KEY || process.env.DEEPSEEK_API_KEY;
  }
  function savedSecret(name) {
    const r = store.get('SELECT value FROM secrets WHERE name=?', name);
    if (!r) return undefined;
    const [iv, tag, cipher] = JSON.parse(r.value);
    const dec = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(encryptionKey(), 'hex'),
      Buffer.from(iv, 'hex')
    );
    dec.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([
      dec.update(Buffer.from(cipher, 'hex')),
      dec.final()
    ]).toString('utf8');
  }
  async function recommend(actor, profile, b, c, override) {
    return Ledger.recommend(store,actor,profile,b,c,override||c.ai,requestExternal,modelKey(),modelUrl((override||c.ai).model));
  }
  async function api(route, b, req) {
    const token = bearer(req),
      actor = store.owner(token),
      c = content();
    if (route === 'admin/login') {
      const meta=M.operatorMeta(store,b.name||'');
      need(meta.enabled,'账号已停用',401);
      const token=store.opLogin(b.name,b.password);
      store.run('UPDATE operator_meta SET last=? WHERE name=?',M.now(),b.name);
      M.audit(store,'op:'+b.name,'登录',b.name,'成功','',null,null,req);
      return {token};
    }
    if(route==='admin/replay') {
      const p=M.principal(store,actor);M.allow(p,'ai.test');M.allow(p,'ai.sensitive');need(b.reason?.trim(),'请填写重放原因');
      const g=store.get('SELECT * FROM generations WHERE id=?',b.id);need(g&&M.inScope(store,p,g.owner,g.scene,g.environment),'无此生成权限',403);
      const input=M.parse(g.input,null);need(input,'旧记录缺少原始输入，不能重放');
      const profile=g.owner.startsWith('op:')?{}:store.account(g.owner).profile||{};
      M.audit(store,actor,'重放为测试',g.id,'成功',b.reason,null,{configVersion:c.version.ai},req);
      return recommend(actor,profile,{index:R.parts.indexOf(input.meal),taste:input.taste,parentId:g.id,requestId:b.requestId||M.id('replay-'),candidateIds:input.candidates.map(x=>x.id)},c);
    }
    if(route==='admin/key-state') {const p=M.principal(store,actor);M.allow(p,'ai.credentials');need(b.reason?.trim(),'请填写原因');if(b.enabled)store.run("DELETE FROM secrets WHERE name='ai-disabled'");else store.run("INSERT OR REPLACE INTO secrets VALUES('ai-disabled','1')");M.audit(store,actor,b.enabled?'启用AI凭据':'停用AI凭据','ai','成功',b.reason,null,{enabled:!!b.enabled},req);return {enabled:!!b.enabled}}
    if(route.startsWith('admin/complete/'))return store.tx(()=>Completion.endpoint(store,actor,route.slice(15),b,req));
    if(route.startsWith('admin/v3/')) return store.tx(()=>M.endpoint(store,actor,route.slice(9),b,req));
    if(route.startsWith('admin/ledger/')) return store.tx(()=>Ledger.endpoint(store,actor,route.slice(13),b,req));

    if (route === 'admin/logout') {
      M.audit(store,actor,'退出登录',actor,'成功','',null,null,req);
      store.run('DELETE FROM sessions WHERE token=?', store.hash(token));
      return {};
    }
    if (route.startsWith('admin/')) {
      const p=M.principal(store,actor),a=route.slice(6);
      if(!['me','logout'].includes(a)) {
        const key=a==='usage'?'ai.cost':['operator','wechat-status','wechat-key'].includes(a)?'admin.manage':a==='key'?'ai.credentials':a==='ai-status'?'ai.view':b.module==='ai'?(['publish','rollback','reject'].includes(a)?'ai.publish':['draft','submit'].includes(a)?'ai.edit':'ai.view'):['publish','rollback','reject'].includes(a)?'content.publish':['draft','submit'].includes(a)?'content.edit':a==='tickets'||a==='ticket'?'users.view':a==='assign'?'users.manage':'content.view';
        M.allow(p,key);
      }
      return store.tx(()=>{const result=admin(actor,a,b);if(a==='inspect'&&b.module==='ai'&&!p.has('ai.cost')&&result.draft){const v=JSON.parse(result.draft.value);for(const k of ['pricePerMillionInput','pricePerMillionOutput','pricePerMillionCache','fallbackInput','fallbackOutput','fallbackCache'])delete v[k];result.draft.value=JSON.stringify(v)}if(!['me','source','usage','overview','dashboard','tickets','inspect','modules','ai-status','wechat-status'].includes(a))M.audit(store,actor,a,b.module||b.id||b.name,'成功',b.reason,null,{version:result?.version},req);return result});
    }

    if (route === 'login') {
      need(typeof b.code === 'string' && b.code, '缺少微信登录凭证');
      const appid = process.env.LIANNA_APP_ID || 'wx30a87cd4d4c6e9c1',
        secret = process.env.LIANNA_APP_SECRET || savedSecret('wechat');
      need(secret, '业务服务尚未配置微信 AppSecret', 503);
      const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
      url.search = new URLSearchParams({
        appid,
        secret,
        js_code: b.code,
        grant_type: 'authorization_code'
      });
      const data = await (
        await requestExternal(url, { signal: AbortSignal.timeout(8000) })
      ).json();
      need(
        typeof data.openid === 'string' && data.openid,
        '微信登录凭证无效，请重试',
        401
      );
      const id = store.hash(appid + ':' + data.openid);
      return store.tx(() => {
        const fresh=!store.get('SELECT 1 FROM accounts WHERE id=?',id);
        store.ensure(id);
        const meta=M.user(store,id,fresh);need(meta.status==='正常','账号已限制，请联系管理员',403);
        store.run('UPDATE user_meta SET last=? WHERE owner=?',M.now(),id);
        return {
          token: store.session(id),
          accountId: id,
          state: store.account(id)
        };
      });
    }
    if(actor&&!actor.startsWith('op:')) {const meta=M.user(store,actor);need(meta.status==='正常','账号已限制，请联系管理员',403);store.run('UPDATE user_meta SET last=? WHERE owner=?',M.now(),actor);store.run('INSERT OR REPLACE INTO account_activity VALUES(?,?,?)',actor,Ledger.dayKey(M.now()),M.now());}
    if (route === 'catalog')
      return {
        version: c.version.actions,
        actions: c.actions,
        gear: R.gearList
      };
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
            (a.pattern === meta.pattern ||
              (meta.replacements || []).includes(a.id)) &&
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
        const result =
          actor && !actor.startsWith('op:')
            ? prepare(store.account(actor), b, c)
            : R.plan(b, c, {
                favorites: Array.isArray(b.favorites) ? b.favorites : []
              });
        if (!actor?.startsWith('op:'))
          store.audit(actor || '游客', '生成计划', {});
        return result;
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
      return {
        version: c.version.foods,
        foods: c.foods.filter((f) => R.usable(f, b, c.risk))
      };
    if (route === 'profile/preview') return { ...R.profile(b, c.nutrition), version: c.version.nutrition };
    if (route === 'preview/meal') {
      const profile = R.profile(b.profile, c.nutrition);
      return {
        ...R.meal(profile, b.index, b.items, c.foods, c.risk),
        version: c.version.foods
      };
    }
    if (route === 'preview/draft') {
      need(actor?.startsWith('op:'), '请登录后台', 401);
      const module = b.module;
      M.allow(M.principal(store,actor),module==='ai'?'ai.test':'content.view');
      admin(actor, 'inspect', { module });
      validate(module, b.value);
      const draft = { ...c, [module]: b.value };
      if (module === 'ai') M.allow(M.principal(store,actor),'ai.test');
      if (module === 'ai')
        return recommend(
          actor,
          b.sample.profile || {},
          b.sample,
          draft,
          b.value
        );
      if (['nutrition', 'foods'].includes(module)) {
        const p = R.profile(b.sample.profile, draft.nutrition);
        return {
          profile: p,
          ...R.meal(p, b.sample.index, b.sample.items, draft.foods, c.risk),
          excluded: draft.foods
            .filter((f) => !R.usable(f, p, c.risk))
            .map((f) => ({
              id: f.id,
              name: f.name,
              reason: R.foodReason(f, p, c.risk)
            })),
          version: draft.version
        };
      }
      return R.plan(b.sample, draft, { favorites: b.sample.favorites || [] });
    }
    if (route === 'media/error') {
      need(R.moves.has(b.id), '动作不存在');
      store.audit(actor || '游客', '动图失败', {
        id: b.id,
        version: c.version.actions
      });
      return {};
    }
    need(actor && !actor.startsWith('op:'), '请先微信登录', 401);
    if (route === 'state') return store.account(actor);
    if (route === 'energy/progress') return require('./energy').progress(store.account(actor), c.nutrition.goalPolicy);
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
      if (ref)
        need(Object.hasOwn(store.account(actor).meals, ref), '关联餐次无效');
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
      need(
        typeof b.requestId === 'string' && /^[\w-]{12,100}$/.test(b.requestId),
        '请求编号无效'
      );
      if (
        store.get(
          'SELECT 1 FROM requests WHERE owner=? AND id=?',
          actor,
          b.requestId
        )
      )
        return a;
      need(a.rev === b.rev, '另一台设备已更新，请重新载入再保存', 409);
      const before=structuredClone(a);
      if(b.action==='add'){const source=R.moves.get(b.body.id);need(!c.actions.some(m=>m.id===source?.sourceId&&m.visible===false),'此动作已下架，请选择其他动作')}
      change(a, b.action, b.body, c);
      const stamp=M.now();
      if(b.action==='savePlan')store.run('INSERT OR IGNORE INTO plan_inputs VALUES(?,?,?,?)',actor,b.body.input.start,JSON.stringify(b.body.input),stamp);
      if(b.action==='finish'){a.sessions[b.body.date].endedAt=stamp;Object.assign(a.history.at(-1),a.sessions[b.body.date])}
      if(b.action==='saveMeal'){
        const meal=a.meals[b.body.date+'-'+b.body.index];meal.profileSnapshot=structuredClone(a.profile);meal.savedAt=stamp;
        if(b.body.generationId){const g=store.get('SELECT * FROM generations WHERE id=? AND owner=?',b.body.generationId,actor);need(g&&g.status==='成功交付','推荐记录不属于当前用户');const ids=(JSON.parse(g.output).items||[]).map(x=>x.id).sort().join(',');const actual=b.body.items.map(x=>x.id).sort().join(',');store.run('UPDATE generations SET adoption=?,object=? WHERE id=?',ids===actual?'已保存':'修改后保存',b.body.date+'-'+b.body.index,g.id);meal.generationId=g.id;}
      }
      if (b.action !== 'heartbeat') M.record(store,actor,b,before,a);
      if (b.action === 'savePlan') store.audit(actor, '保存计划', {});
      const rev = a.rev + 1;
      delete a.rev;
      store.run(
        'UPDATE accounts SET value=?,rev=? WHERE id=?',
        JSON.stringify(a),
        rev,
        actor
      );
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
  const names = {
    '/': 'admin.html',
    '/admin.css': 'admin.css',
    '/admin.js': 'admin.js',
    '/console.js': 'console.js',
    '/design.css': 'design.css',
    '/icons.js': 'icons.js',
    '/brand.svg': 'brand.svg',
    '/manage.css':'manage.css',
    '/manage.js':'manage.js',
    '/manage-views.js':'manage-views.js',
    '/manage-events.js':'manage-events.js',
    '/manage-detail.js':'manage-detail.js'
  };
  const mediaRoot = path.join(root, '..', '动作库');
  const originalFiles = new Map(
    fs
      .readdirSync(path.join(mediaRoot, '原版项目', 'videos'))
      .map((f) => [f.slice(0, 4), f])
  );
  return http.createServer(async (req, res) => {
    try {
      req.requestId=M.id('R');
      const uploaded=/^\/uploaded\/([a-f0-9]{40})\.webp$/.exec(req.url);
      if(req.method==='GET'&&uploaded){const row=store.get('SELECT data FROM uploaded_media WHERE hash=?',uploaded[1]);need(row,'素材不存在',404);res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'public,max-age=31536000,immutable'});return res.end(Buffer.from(row.data));}
      const media = /^\/media\/(original|new|cover)\/(\d{4})$/.exec(req.url);
      if(req.method==='GET'&&/^\/gear\/[a-zA-Z0-9_-]+\.(webp|jpg|svg)$/.test(req.url)){const f=path.join(root,'../微信小程序/miniprogram/assets',req.url.slice(1));need(fs.existsSync(f),'参考图不存在',404);res.writeHead(200,{'Content-Type':req.url.endsWith('.svg')?'image/svg+xml':req.url.endsWith('.jpg')?'image/jpeg':'image/webp','Cache-Control':'public,max-age=86400'});return fs.createReadStream(f).pipe(res)}
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
            {
              html: 'text/html',
              css: 'text/css',
              js: 'text/javascript',
              svg: 'image/svg+xml'
            }[file.split('.').pop()] + '; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        return res.end(fs.readFileSync(path.join(root, file)));
      }
      need(
        req.method === 'POST' && req.url.startsWith('/api/'),
        '接口不存在',
        404
      );
      let size = 0;
      const chunks = [];
      for await (const raw of req) {
        size += raw.length;
        need(size <= (req.url==='/api/admin/v3/media-upload'?6e6:2e6), '请求过大', 413);
        chunks.push(raw);
      }
      const b = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      need(b && typeof b === 'object' && !Array.isArray(b), '请求格式无效');
      if (['/api/admin/login', '/api/login'].includes(req.url))
        limit(req.socket.remoteAddress);
      const out = await api(req.url.slice(5), b, req);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify(out));
    } catch (e) {
      if(req.url?.startsWith('/api/admin/')||req.url==='/api/preview/draft'){
        try{M.audit(store,store.owner(bearer(req))||'未登录',req.url,'请求',''+(e.status===403?'拒绝':'失败'),e.status?e.message:'请求未完成',null,null,req)}catch{}
      }
      res.writeHead(e.status || (e instanceof SyntaxError ? 400 : 500), {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(
        JSON.stringify({
          error: e.status ? e.message : '操作未完成，请检查输入后重试'
        })
      );
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
    let masterKey = process.env.LIANNA_MASTER_KEY;
    if (!masterKey) {
      const keyFile = path.join(dir, 'model-master.key');
      try { fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      masterKey = fs.readFileSync(keyFile, 'utf8').trim();
    }
    build(store, { masterKey }).listen(port, process.env.LIANNA_BIND || '127.0.0.1', () =>
      console.log('练哪二版服务端口 ' + port)
    );
  }
}
module.exports = { build };
