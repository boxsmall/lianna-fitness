'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { open } = require('./db');
const { defaults } = require('./content');
const { build } = require('./server');

async function fixture(t, options = {}) {
  const store = open(':memory:');
  const roles = {
    owner: ['管理员', '运营', '审核', '客服'],
    editor: ['运营'],
    reviewer: ['审核'],
    support: ['客服']
  };
  for (const [name, values] of Object.entries(roles))
    store.operator(name, 'fixture-password-123', values);
  const server = build(store, {
    masterKey: randomBytes(32).toString('hex'),
    ...options
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.db.close();
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const tokens = Object.fromEntries(
    Object.keys(roles).map((name) => [
      name,
      store.opLogin(name, 'fixture-password-123')
    ])
  );
  async function api(route, body = {}, role = 'owner', expected = 200) {
    const response = await fetch(origin + '/api/' + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (tokens[role] || role)
      },
      body: JSON.stringify(body)
    });
    const value = await response.json();
    assert.equal(
      response.status,
      expected,
      route + ' ' + JSON.stringify(value)
    );
    return value;
  }
  return { store, api, tokens, origin };
}

test('微信密钥加密配置、角色隔离与登录换取会话', async (t) => {
  const key = '0123456789abcdef0123456789abcdef';
  let valid = true;
  const { store, api } = await fixture(t, { fetch: async (url) => {
    assert.equal(url.origin, 'https://api.weixin.qq.com');
    assert.equal(url.pathname, '/sns/jscode2session');
    assert.equal(url.searchParams.get('secret'), key);
    assert.equal(url.searchParams.get('appid'), 'wx30a87cd4d4c6e9c1');
    return { json: async () => valid ? { openid: 'fixture-wechat-user' } : { errcode: 40029 } };
  } });
  assert.equal((await api('admin/wechat-status')).configured, false);
  await api('login', { code: 'fixture-code' }, '', 503);
  for (const role of ['editor', 'reviewer', 'support']) {
    await api('admin/wechat-status', {}, role, 403);
    await api('admin/wechat-key', { key }, role, 403);
  }
  await api('admin/wechat-key', { key: 'invalid-secret' }, 'owner', 400);
  await api('admin/wechat-key', { key });
  const status = await api('admin/wechat-status');
  assert.deepEqual(status, { configured: true, appId: 'wx30a87cd4d4c6e9c1' });
  assert.ok(!store.get("SELECT value FROM secrets WHERE name='wechat'").value.includes(key));
  const signed = await api('login', { code: 'fixture-code' }, '');
  assert.ok(signed.token && signed.accountId);
  assert.ok(!JSON.stringify(signed).includes(key));
  valid = false;
  await api('login', { code: 'invalid-code' }, '', 401);
});

test('后台完整流程：初始数据、角色、五个模块审核回退、试算、工单与退出', async (t) => {
  const { store, api } = await fixture(t);
  assert.equal((await api('admin/me')).name, 'owner');
  await api('admin/login', { name: 'owner', password: 'wrong' }, '', 401);
  assert.equal(
    (await api('admin/inspect', { module: 'nutrition' })).active.macroRatio,
    null
  );
  assert.equal((await api('admin/source')).length, 1324);
  const date = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Shanghai'
  });
  assert.equal((await api('admin/overview', { date })).trend.length, 7);
  assert.equal((await api('admin/usage', { date })).length, 7);
  await api('admin/overview', { date: 'bad' }, 'owner', 400);
  await api('admin/operator', {
    name: 'qa-two-roles',
    password: 'fixture-password-234',
    roles: ['运营', '审核']
  });
  assert.deepEqual(
    JSON.parse(
      store.get('SELECT roles FROM operators WHERE name=?', 'qa-two-roles')
        .roles
    ),
    ['运营', '审核']
  );
  await api(
    'admin/operator',
    { name: 'bad', password: 'fixture-password-234', roles: '运营' },
    'owner',
    400
  );
  await api(
    'admin/operator',
    { name: 'bad', password: 'short', roles: ['运营'] },
    'owner',
    400
  );
  await api(
    'admin/operator',
    { name: 'bad', password: 'fixture-password-234', roles: [] },
    'owner',
    400
  );
  await api(
    'admin/operator',
    { name: 'forbidden', password: 'fixture-password-234', roles: ['管理员'] },
    'editor',
    403
  );
  await api('admin/modules', {}, 'support', 403);
  await api('admin/key', { key: 'fixture-only-key' }, 'editor', 403);
  const values = {
    ...defaults,
    actions: defaults.actions.map((a) => ({ ...a, approved: true })),
    foods: defaults.foods.map((f) => ({ ...f, checked: ['花生', '牛奶'] }))
  };
  for (const module of ['actions', 'templates', 'foods', 'nutrition', 'ai']) {
    const value = values[module];
    const editorRole=module==='ai'?'owner':'editor', reviewerRole=module==='ai'?'owner':'reviewer';
    const rejected = await api(
      'admin/draft',
      { module, base: 1, value },
      editorRole
    );
    await api('admin/submit', { module, id: rejected.id }, editorRole);
    await api(
      'admin/reject',
      { module, id: rejected.id, reason: '回归退回测试' },
      reviewerRole
    );
    const draft = await api(
      'admin/draft',
      { module, base: 1, value },
      editorRole
    );
    await api('admin/submit', { module, id: draft.id }, editorRole);
    await api('admin/submit', { module, id: draft.id }, editorRole, 409);
    await api(
      'admin/publish',
      { module, id: draft.id, reason: '越权尝试' },
      'editor',
      403
    );
    await api(
      'admin/publish',
      { module, id: draft.id, reason: '' },
      reviewerRole,
      400
    );
    assert.equal(
      (
        await api(
          'admin/publish',
          { module, id: draft.id, reason: '回归发布测试' },
          reviewerRole
        )
      ).version,
      2
    );
    assert.deepEqual(await api('admin/version', { module, version: 2 }), value);
    await api(
      'admin/publish',
      { module, id: draft.id, reason: '重复' },
      reviewerRole,
      409
    );
  }
  const planSample = {
    start: '2026-11-16',
    days: 3,
    goal: '增肌',
    minutes: 30,
    gear: ['哑铃']
  };
  const plan = await api('preview/draft', {
    module: 'templates',
    value: values.templates,
    sample: planSample
  });
  assert.equal(Object.keys(plan.sessions).length, 3);
  const manual = await api('preview/draft', {
    module: 'templates',
    value: values.templates,
    sample: { ...planSample, days: 5, weekdays: [0, 1, 2, 3, 4] }
  });
  assert.equal(Object.keys(manual.sessions).length, 5);
  const meal = await api('preview/draft', {
    module: 'foods',
    value: values.foods,
    sample: {
      profile: {
        sex: '女',
        height: 165,
        weight: 62.5,
        targets: { kcal: 2000 },
        ratios: [30, 40, 30]
      },
      index: 1,
      items: [{ id: '168878', locked: 153 }, { id: '171477' }]
    }
  });
  assert.equal(meal.rows.find((r) => r.id === '168878').grams, 153);
  assert.equal(meal.target.kcal, 800);
  assert.equal(
    (
      await api(
        'admin/rollback',
        { module: 'foods', base: 2, version: 1, reason: '回退' },
        'reviewer'
      )
    ).version,
    3
  );
  await api(
    'admin/rollback',
    { module: 'foods', base: 2, version: 2, reason: '冲突' },
    'reviewer',
    409
  );
  await api(
    'admin/rollback',
    { module: 'foods', base: 3, version: 2, reason: '恢复' },
    'reviewer'
  );
  store.ensure('qa-user');
  const user = store.session('qa-user');
  const ticket = await api(
    'ticket',
    { kind: '反馈', detail: '功能测试', consent: true },
    user
  );
  await api('admin/ticket', { id: ticket.id }, 'support', 403);
  await api('admin/assign', { id: 999999, assignee: 'support' }, 'owner', 404);
  await api('admin/assign', { id: ticket.id, assignee: 'support' });
  assert.equal((await api('admin/tickets', {}, 'support')).length, 1);
  assert.ok(
    Object.hasOwn(
      await api('admin/ticket', { id: ticket.id, personal: true }, 'support'),
      'profile'
    )
  );
  await api('admin/ticket', { id: ticket.id, personal: true }, 'owner', 403);
  assert.equal(
    (await api('admin/ticket', { id: ticket.id, resolve: true }, 'support'))
      .status,
    '已处理'
  );
  const erase = await api(
    'ticket',
    { kind: '注销', detail: '隔离账号注销' },
    user
  );
  await api('admin/ticket', { id: erase.id, erase: true });
  await api('state', {}, user, 401);
  await api('admin/logout');
  await api('admin/me', {}, 'owner', 401);
});

test('DeepSeek 官方接口、加密密钥、JSON 返回与错误降级', async (t) => {
  const names = ['LIANNA_AI_URL', 'LIANNA_AI_KEY', 'DEEPSEEK_API_KEY'];
  const original = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  names.forEach((k) => delete process.env[k]);
  t.after(() => {
    for (const k of names) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });
  let mode = 'valid';
  const { store, api } = await fixture(t, {
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      assert.equal(
        options.headers.Authorization,
        'Bearer fixture-deepseek-key'
      );
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'deepseek-flash');
      assert.equal(body.thinking.type, 'disabled');
      assert.equal(body.max_tokens, 2048);
      if (mode === 'timeout') throw Error('timeout');
      if (mode === 'http') return { ok: false };
      return {
        ok: true,
        json: async () => ({
          usage: { prompt_tokens: 50, completion_tokens: 20 },
          choices: [
            {
              message: {
                content:
                  mode === 'valid'
                    ? '```json\n[{"id":"168878","reason":"候选主食"}]\n```'
                    : mode === 'invalid'
                      ? '[{"id":"unknown"}]'
                      : ''
              }
            }
          ]
        })
      };
    }
  });
  store.publish('test', 'foods', 1, defaults.foods, '回归');
  const sample = { profile: {}, index: 1 };
  const value = { ...defaults.ai, dailyLimit: 10 };
  const preview = () => api('preview/draft', { module: 'ai', value, sample });
  assert.equal((await api('admin/ai-status')).configured, false);
  assert.equal((await preview()).manual, true);
  await api('admin/key', { key: 'fixture-deepseek-key' });
  assert.equal((await api('admin/ai-status')).configured, true);
  assert.ok(
    !store
      .get("SELECT value FROM secrets WHERE name='ai'")
      .value.includes('fixture-deepseek-key')
  );
  assert.equal((await preview()).items[0].id, '168878');
  for (mode of ['invalid', 'empty', 'timeout', 'http'])
    assert.equal((await preview()).manual, true);
  assert.equal(
    (
      await api('preview/draft', {
        module: 'ai',
        value: { ...value, dailyLimit: 0 },
        sample
      })
    ).reason,
    '今日额度已用尽'
  );
});
