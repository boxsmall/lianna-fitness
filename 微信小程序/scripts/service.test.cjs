const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture({ confirm = true, nextId = 'same', pending = true, validSession = false } = {}) {
  const prefs = { owned: ['哑铃'], active: [], favorites: [] };
  const baseline = { ...prefs, favorites: ['0334'] };
  const values = new Map([
    ['lianna.session.v2', { token: validSession ? 'fresh' : 'expired', accountId: 'same' }],
    ['lianna.preferences.account.same', { ...prefs, base: baseline, dirty: true }]
  ]);
  const cmd = { action: 'record', body: {}, rev: 0, requestId: 'pending-original' };
  if (pending) values.set('lianna.pending.same', cmd);
  const requests = [];
  let rev = 0;
  const wx = {
    getStorageSync: k => values.get(k),
    setStorageSync: (k,v) => values.set(k,v),
    removeStorageSync: k => values.delete(k),
    showToast() {},
    showModal: o => o.success({ confirm }),
    login: o => o.success({ code: 'one-use-code' }),
    request(o) {
      const route = o.url.split('/api/')[1];
      requests.push({ route, ...o.data });
      if (route === 'state' && validSession) return o.success({statusCode:200,data:{rev,prefs:baseline}});
      if (route === 'state' || route === 'logout') return o.success({statusCode:401,data:{error:'expired'}});
      if (route === 'login') return o.success({statusCode:200,data:{token:'fresh',accountId:nextId,state:{rev,prefs}}});
      assert.equal(o.header.Authorization, 'Bearer fresh');
      assert.equal(o.data.rev, rev);
      o.success({statusCode:200,data:{rev:++rev,prefs}});
    }
  };
  function load(name, require) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/lib',name),'utf8'), {wx,module,require});
    return module.exports;
  }
  const storage = load('storage.js', () => ({gearList:['哑铃'],byId:new Map([['0334',{id:'0334'}]])}));
  storage.resume();
  const service = load('service.js', () => storage);
  return { service, values, requests, cmd, baseline };
}
test('过期重新登录重试原待提交操作，保留收藏删除的三方合并基线', async () => {
  const f = fixture();
  await f.service.login();
  const changes = f.requests.filter(r=>r.route==='change');
  assert.equal(changes[0].requestId, f.cmd.requestId);
  assert.equal(changes[0].action, 'record');
  assert.equal(changes[1].body.merge, false);
  assert.deepEqual(changes[1].body.base, f.baseline);
  assert.equal(f.values.has('lianna.pending.same'), false);
  assert.equal(f.values.get('lianna.session.v2').token,'fresh');
});

test('已有有效登录时也先同步本机新器械和收藏，再继续创建训练',async()=> {
  const f=fixture({pending:false,validSession:true});
  await f.service.login();
  const sync=f.requests.find(r=>r.action==='sync');
  assert.ok(sync);assert.equal(sync.body.merge,false);assert.deepEqual(sync.body.base,f.baseline);
  assert.equal(sync.body.favorites.length,0);assert.deepEqual([...sync.body.owned],['哑铃']);
});
test('取消重新登录保留本地待提交记录', async () => {
  const f=fixture({confirm:false});
  assert.equal(await f.service.login(),null);
  assert.equal(f.values.get('lianna.pending.same'),f.cmd);
  assert.equal(f.values.get('lianna.session.v2').token,'expired');
});
test('切换账号不会把上一账号收藏或待提交记录同步给新账号', async () => {
  const f=fixture({nextId:'different'});
  await f.service.login();
  const changes=f.requests.filter(r=>r.route==='change');
  assert.equal(changes.length,1);
  assert.equal(changes[0].action,'sync');
  assert.equal(changes[0].body.owned.length,0);
  assert.equal(changes[0].body.favorites.length,0);
});
test('会话过期后仍可以正常退出账号', async () => {
  const f=fixture({pending:false});
  await f.service.logout();
  assert.equal(f.values.has('lianna.session.v2'),false);
});
test('训练心跳与业务保存串行发送，不能覆盖待提交操作', async()=> {
  const f=fixture({pending:false});await f.service.login();
  await Promise.all([f.service.mutate('heartbeat',{date:'2026-11-20'}),f.service.mutate('measurement',{weight:70})]);
  const changes=f.requests.filter(r=>r.route==='change');
  assert.deepEqual(changes.slice(-2).map(x=>x.action),['heartbeat','measurement']);
  assert.equal(changes.at(-1).rev,changes.at(-2).rev+1);
});
test('排队过程中换账号时拒绝把旧操作写到新账号',async()=> {
  const f=fixture({pending:false});await f.service.login();
  const pending=f.service.mutate('measurement',{weight:70});
  f.values.set('lianna.session.v2',{accountId:'different',token:'other'});
  await assert.rejects(pending,/账号已切换/);
  assert.equal(f.requests.filter(r=>r.action==='measurement').length,0);
});
