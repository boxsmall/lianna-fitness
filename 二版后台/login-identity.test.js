'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {open}=require('./db'),{build}=require('./server');
async function fixture(t) {
 const store=open(':memory:');store.operator('qa','Only-for-test-2026',['管理员']);
 const server=build(store,{masterKey:'a'.repeat(64),fetch:async()=>({json:async()=>({openid:'new-wechat-person'})})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));store.db.close()});
 const base='http://127.0.0.1:'+server.address().port;
 async function api(route,b={},token='',status=200){const r=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(b)});const v=await r.json();assert.equal(r.status,status,route+': '+JSON.stringify(v));return v;}
 return {store,base,api};
}
test('后台空密码、错误密码、伪造和过期会话拒绝；有效会话可重复验证，退出立即失效',async t=>{
 const {store,api}=await fixture(t);
 for(const b of [{},{name:'qa'},{name:'qa',password:''},{name:'qa',password:'wrong'},{name:'ghost',password:'wrong'}]) await api('admin/login',b,'',401);
 assert.equal(store.get('SELECT count(*) n FROM sessions').n,0);
 assert.equal(store.get("SELECT 1 FROM operator_meta WHERE name='ghost'"),undefined);
 const {token}=await api('admin/login',{name:'qa',password:'Only-for-test-2026'});
 for(let i=0;i<3;i++) assert.equal((await api('admin/v3/data',{},token)).me.name,'qa');
 await api('admin/v3/data',{},'forged',401);
 await api('admin/logout',{},token);await api('admin/v3/data',{},token,401);
 const expired=store.opLogin('qa','Only-for-test-2026');store.run('UPDATE sessions SET expires=0 WHERE token=?',store.hash(expired));await api('admin/v3/data',{},expired,401);
});
test('微信首次登录即进入后台列表，重复登录不重复；昵称头像需主动确认并可更新和注销',async t=>{
 const {store,api,base}=await fixture(t);const op=store.opLogin('qa','Only-for-test-2026');
 await api('admin/wechat-key',{key:'b'.repeat(32)},op);
 assert.equal((await api('admin/v3/data',{},op)).users.length,0);
 const first=await api('login',{code:'test-code'});await api('login',{code:'test-code'});
 let users=(await api('admin/v3/data',{},op)).users;assert.equal(users.length,1);assert.ok(users[0].created);assert.ok(users[0].last);
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 const cmd={action:'identity',rev:first.state.rev,requestId:'identity-test-request-1',body:{nickname:'测试昵称',avatarData:png,consent:false}};
 await api('change',cmd,first.token,400);assert.equal(store.get('SELECT count(*) n FROM user_avatars').n,0);
 cmd.body.consent=true;const saved=await api('change',cmd,first.token);const repeated=await api('change',cmd,first.token);assert.deepEqual(saved,repeated);
 users=(await api('admin/v3/data',{},op)).users;assert.equal(users[0].name,'测试昵称');assert.equal(users[0].avatar,saved.identity.avatar);
 const image=await fetch(base+saved.identity.avatar);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('x-content-type-options'),'nosniff');
 const bad={...cmd,rev:saved.rev,requestId:'identity-test-request-2',body:{nickname:'new',consent:true,avatarData:Buffer.from('<svg onload="bad"/>').toString('base64')}};await api('change',bad,first.token,400);assert.equal(store.account(first.accountId).identity.nickname,'测试昵称');
 await api('change',{...bad,body:{nickname:'改名后',consent:true}},first.token);assert.equal(store.account(first.accountId).identity.avatar,saved.identity.avatar);
 const ticket=await api('ticket',{kind:'注销',detail:'测试注销',consent:true},first.token);
 await api('admin/complete/ticket',{id:ticket.id,operation:'注销',confirm:String(ticket.id),reason:'隔离测试'},op);
 assert.equal(store.get('SELECT count(*) n FROM user_avatars').n,0);assert.equal((await fetch(base+saved.identity.avatar)).status,404);
});
