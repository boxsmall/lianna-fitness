'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const R = require('./rules'),
  { defaults } = require('./content'),
  { open } = require('./db'),
  { change } = require('./account'),
  { build } = require('./server');
const c = {
  ...defaults,
  version: { actions: 2, templates: 1, foods: 2, nutrition: 2 },
  risk: {},
  actions: defaults.actions.map((a) => ({ ...a, approved: true })),
  foods: defaults.foods.map((f) => ({ ...f, checked: ['花生', '牛奶'] }))
};
const inputs = { start: '2026-11-16', days: 3, goal: '增肌', minutes: 30, gear: ['哑铃'] };
const diet = {
  sex: '女',
  height: 165,
  weight: 62.5,
  targets: { kcal: 2000 },
  ratios: [30, 40, 30],
  allergens: ['花生'],
  avoid: ['猪肉']
};
function account() {
  const s = open(':memory:');
  s.ensure('test');
  const a = s.account('test');
  s.db.close();
  return a;
}
test('训练预算、首周轮换、缺器械及自行编排', () => {
  const a = account(),
    p = R.plan(inputs, c, a.prefs);
  assert.equal(Object.keys(p.sessions).length, 3);
  assert.equal(p.dates.length, 7);
  for (const s of Object.values(p.sessions)) {
    assert.ok(s.timing.total <= 1800);
    for (const m of s.items) assert.deepEqual(R.missing(R.moves.get(m.id), inputs.gear), []);
  }
  assert.ok(p.rejected.some((x) => x.id === '0327' && x.reason.includes('训练凳')));
  assert.equal(
    R.plan({ ...inputs, start: '2026-11-23', anchor: inputs.start }, c, a.prefs).sessions[
      '2026-11-23'
    ].type,
    '全身 B'
  );
  assert.throws(() => R.plan({ ...inputs, minutes: 1 }, c, a.prefs), /超出/);
  assert.throws(() => R.plan(inputs, { ...c, actions: defaults.actions }, a.prefs), /缺少/);
  const manual = R.plan({ ...inputs, days: 6 }, c, a.prefs);
  assert.ok(Object.values(manual.sessions).every((s) => s.manual && !s.items.length));
});
test('调课、交换、跨周、剩余组和完成记录', () => {
  const a = account(),
    cmd = (name, b) => change(a, name, b, c);
  cmd('savePlan', { input: inputs, version: c.version });
  cmd('move', { date: '2026-11-18', to: '2026-11-19' });
  const oldKey=a.sessions['2026-11-19'].key;
  cmd('move',{date:'2026-11-19',to:'2026-11-20',swap:true});
  assert.equal(a.sessions['2026-11-20'].key,oldKey);
  cmd('move',{date:'2026-11-20',to:'2026-11-19',swap:true});
  const d = '2026-11-19',
    s = a.sessions[d],
    i = s.items[1];
  cmd('edit', { date: d, key: i.key, sets: 3, target: 10 });
  cmd('start', { date: d });
  cmd('record', { date: d, key: i.key, value: 10 });
  cmd('edit', { date: d, key: i.key, sets: 3, target: 8 });
  cmd('record', { date: d, key: i.key, value: 8 });
  cmd('finish', { date: d });
  assert.deepEqual(
    s.actual[i.key].map((x) => x.value),
    [10, 8]
  );
  assert.equal(s.snapshot[1].target, 10);
  cmd('move', { date: '2026-11-20', to: '2026-11-23' });
  cmd('savePlan', { input: { ...inputs, start: '2026-11-23' }, version: c.version });
  assert.ok(a.sessions['2026-11-23'].carried);
  assert.equal(a.history[0].status, '已完成');
  assert.throws(() => cmd('edit', { date: d, key: i.key, sets: 1, target: 8 }), /已完成/);
});
test('食材筛选、称重锁定、取整、营养与历史', () => {
  const a = account();
  assert.throws(() => R.profile({ ...diet, weight: 0 }, c.nutrition), /体重/);
  change(a, 'profile', diet, c);
  assert.deepEqual(
    [0, 1, 2].map((i) => R.mealTarget(a.profile, i).kcal),
    [600, 800, 600]
  );
  const list = c.foods.filter((f) => R.usable(f, a.profile));
  assert.ok(list.length);
  assert.ok(list.every((f) => !f.contains.includes('花生') && !f.tags.includes('猪肉')));
  const rice = list.find((f) => f.id === '168878');
  assert.equal(R.usable({ ...rice, checked: [] }, a.profile), false);
  assert.equal(R.usable(rice, a.profile, { [rice.id]: ['花生'] }), false);
  const items = [{ id: '168878', locked: 153 }, { id: '171477' }, { id: '172336' }],
    first = R.meal(a.profile, 1, items, c.foods, c.risk);
  assert.equal(first.rows[0].grams, 153);
  assert.equal(first.rows[1].grams % 5, 0);
  const expected = Math.round(first.rows.reduce((s, f) => s + (f.protein * f.grams) / 100, 0));
  assert.equal(expected, first.actual.protein);
  change(a, 'saveMeal', { date: inputs.start, index: 1, items, version: 2 }, c);
  const history = JSON.stringify(a.meals);
  items[1] = { id: '170633' };
  assert.equal(R.meal(a.profile, 1, items, c.foods).rows[0].grams, 153);
  assert.equal(JSON.stringify(a.meals), history);
});
test('账号隔离、幂等、版本冲突、角色权限与回退', async (t) => {
  const s = open(':memory:');
  s.ensure('one');
  s.ensure('two');
  s.operator('editor', 'test-editor-password', ['运营']);
  s.operator('review', 'test-review-password', ['审核']);
  s.operator('support', 'test-support-password', ['客服']);
  const server = build(s);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(async () => {
    await new Promise((ok) => server.close(ok));
    s.db.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/';
  async function api(route, b, token = '') {
    const r = await fetch(base + route, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: JSON.stringify(b)
    });
    return [r.status, await r.json()];
  }
  const one = s.session('one'),
    two = s.session('two');
  const b = {
    rev: 0,
    requestId: 'test-request-00001',
    action: 'sync',
    body: { owned: ['哑铃'], favorites: ['0334', 'raise'], active: ['哑铃'], merge: true }
  };
  assert.equal((await api('change', b, one))[1].rev, 1);
  assert.deepEqual((await api('change', b, one))[1].prefs.favorites, ['raise']);
  assert.equal((await api('change', { ...b, requestId: 'test-request-00002' }, one))[0], 409);
  assert.deepEqual((await api('state', {}, two))[1].prefs.favorites, []);
  assert.equal((await api('state', {}))[0], 401);
  const op = s.opLogin('editor', 'test-editor-password'),
    rev = s.opLogin('review', 'test-review-password'),
    support = s.opLogin('support', 'test-support-password');
  const d = (await api('admin/draft', { module: 'foods', base: 1, value: c.foods }, op))[1];
  assert.ok(d.id);
  await api('admin/submit', { module: 'foods', id: d.id }, op);
  assert.equal(
    (await api('admin/publish', { module: 'foods', id: d.id, reason: '样例' }, op))[0],
    403
  );
  assert.equal(
    (await api('admin/publish', { module: 'foods', id: d.id, reason: '样例' }, rev))[1].version,
    2
  );
  assert.equal(
    (
      await api('admin/rollback', { module: 'foods', base: 2, version: 1, reason: '回退测试' }, rev)
    )[1].version,
    3
  );
  assert.ok(s.content().risk['173806'].includes('花生'));
  assert.equal((await api('admin/inspect', { module: 'ai' }, support))[0], 403);
});

test('微信凭证交换、AI 二次过滤与回退、客服授权和注销', async (t) => {
  const envKeys = ['LIANNA_APP_SECRET', 'LIANNA_AI_URL', 'LIANNA_AI_KEY'];
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    LIANNA_APP_SECRET: 'test-secret',
    LIANNA_AI_URL: 'https://fixture.invalid/model',
    LIANNA_AI_KEY: 'fixture-key'
  });
  const s = open(':memory:');
  s.operator('lead', 'test-lead-password', ['管理员']);
  s.operator('support', 'test-support-password', ['客服']);
  s.publish('test', 'foods', 1, c.foods, '验收');
  s.publish('test', 'nutrition', 1, c.nutrition, '验收');
  s.publish('test', 'ai', 1, { ...defaults.ai, model: 'fixture-model', dailyLimit: 4 }, '验收');
  let mode = 'success',
    calls = 0;
  const service = build(s, {
    fetch: async (url, opts) => {
      if (String(url).startsWith('https://api.weixin.qq.com/'))
        return { json: async () => ({ openid: 'test-openid' }) };
      calls++;
      const input = JSON.parse(JSON.parse(opts.body).messages[1].content);
      assert.ok(input.candidates.every((f) => !['173806', '168250'].includes(f.id)));
      if (mode === 'timeout') throw Error('timeout');
      const choices =
        mode === 'invalid'
          ? [{ id: 'not-found' }]
          : mode === 'allergen'
            ? [{ id: '173806' }]
            : [{ id: '168878', reason: '候选主食' }];
      return {
        ok: true,
        json: async () => ({
          usage: { prompt_tokens: 20, completion_tokens: 8 },
          choices: [{ message: { content: JSON.stringify(choices) } }]
        })
      };
    }
  });
  await new Promise((ok) => service.listen(0, '127.0.0.1', ok));
  t.after(async () => {
    await new Promise((ok) => service.close(ok));
    s.db.close();
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  async function api(route, data, token = '') {
    const r = await fetch('http://127.0.0.1:' + service.address().port + '/api/' + route, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: JSON.stringify(data)
    });
    return [r.status, await r.json()];
  }
  const login = (await api('login', { code: 'fixture' }))[1];
  assert.ok(login.token);
  const user = login.token;
  assert.equal((await api('login', { code: 'same-account' }))[1].accountId, login.accountId);
  let rev = (
    await api(
      'change',
      { action: 'profile', body: diet, rev: 0, requestId: 'initial-profile-1' },
      user
    )
  )[1].rev;
  assert.equal(rev, 1);
  for (const m of ['success', 'invalid', 'allergen', 'timeout', 'quota']) {
    mode = m;
    const res = (await api('recommend', { index: 1 }, user))[1];
    if (m === 'success') assert.equal(res.items[0].id, '168878');
    else assert.equal(res.manual, true);
  }
  assert.equal(calls, 4);
  const items = [{ id: '168878', locked: 153 }];
  assert.equal(
    (
      await api(
        'change',
        {
          action: 'saveMeal',
          body: { date: inputs.start, index: 1, items, version: 2 },
          rev,
          requestId: 'saved-meal-0001'
        },
        user
      )
    )[0],
    200
  );
  const ref = inputs.start + '-1',
    support = s.opLogin('support', 'test-support-password'),
    lead = s.opLogin('lead', 'test-lead-password');
  for (const consent of [false, true]) {
    const id = (
      await api('ticket', { kind: '反馈', detail: '午餐份量', mealRef: ref, consent }, user)
    )[1].id;
    assert.equal((await api('admin/ticket', { id }, support))[0], 403);
    await api('admin/assign', { id, assignee: 'support' }, lead);
    const trace = (await api('admin/ticket', { id }, support))[1];
    assert.equal(trace.versions.length, 1);
    assert.equal(trace.versions[0].foodsVersion, 2);
    assert.equal(
      (await api('admin/ticket', { id, personal: true }, support))[0],
      consent ? 200 : 403
    );
  }
  const tid = (await api('ticket', { kind: '注销', detail: '删除个人记录' }, user))[1].id;
  assert.equal((await api('admin/ticket', { id: tid, erase: true }, lead))[0], 200);
  assert.equal((await api('state', {}, user))[0], 401);
  assert.ok(!s.get('SELECT id FROM accounts WHERE id=?', login.accountId));
});

test('断网、中断下载、摘要校验和发布回退均保持图文一致', async () => {
  const vm = require('node:vm'),
    fs = require('node:fs'),
    path = require('node:path');
  const script = fs.readFileSync(
    path.join(__dirname, '../微信小程序/miniprogram/lib/updates.js'),
    'utf8'
  );
  const original = {
      id: 'raise',
      sourceId: '0334',
      name: '原名',
      steps: ['原说明'],
      gear: ['哑铃']
    },
    byId = new Map([['0334', original]]);
  let remote,
    fail = '',
    stored = null;
  const files = new Set(),
    hash = 'a'.repeat(40),
    other = 'b'.repeat(40);
  const wx = {
    env: { USER_DATA_PATH: '/sandbox' },
    getStorageSync: () => stored,
    setStorageSync: (k, v) => {
      stored = structuredClone(v);
    },
    getFileSystemManager: () => ({
      mkdirSync() {},
      accessSync: (p) => {
        if (!files.has(p)) throw Error('ENOENT');
      },
      copyFileSync: (a, b) => files.add(b),
      readdirSync: () => [],
      unlinkSync() {}
    }),
    downloadFile: (o) =>
      o.url === fail
        ? o.fail(Error('offline'))
        : o.success({ statusCode: 200, tempFilePath: o.url }),
    getFileInfo: (o) => o.success({ digest: o.filePath.endsWith('cover') ? hash : other })
  };
  const module = { exports: {} };
  vm.runInNewContext(script, {
    module,
    wx,
    getCurrentPages: () => [],
    require: (k) =>
      k === './catalog'
        ? { byId }
        : {
            request: async () => {
              if (!remote) throw Error('offline');
              return structuredClone(remote);
            }
          }
  });
  const sync = module.exports.sync;
  remote = { version: 1, actions: [{ id: '0334', name: '一版' }] };
  await sync();
  assert.equal(original.name, '一版');
  remote = {
    version: 2,
    actions: [
      {
        id: '0334',
        name: '二版',
        steps: ['二版说明'],
        media: {
          cover: 'https://example.invalid/cover',
          animation: 'https://example.invalid/animation',
          coverHash: hash,
          animationHash: other
        }
      }
    ]
  };
  fail = remote.actions[0].media.animation;
  await sync();
  assert.equal(stored.version, 1);
  assert.equal(original.name, '一版');
  fail = '';
  remote.actions[0].media.animationHash = 'c'.repeat(40);
  await sync();
  assert.equal(stored.version, 1);
  remote.actions[0].media.animationHash = other;
  await sync();
  assert.equal(stored.version, 2);
  assert.equal(original.steps[0], '二版说明');
  assert.ok(files.has(original.localMedia.animations));
  remote = null;
  await sync();
  assert.equal(original.name, '二版');
  remote = { version: 3, actions: [] };
  await sync();
  assert.equal(original.name, '原名');
  assert.equal(original.steps[0], '原说明');
  assert.ok(!original.localMedia);
});
