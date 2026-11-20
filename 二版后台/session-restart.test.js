'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {open}=require('./db'),{build}=require('./server');
test('后台有效会话在数据库及服务重开后仍有效，退出后再次重开不能恢复',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lianna-session-restart-'));
 const file=path.join(dir,'test.sqlite');let store,server;
 t.after(async()=>{if(server?.listening)await new Promise(r=>server.close(r));store?.db.close();fs.rmSync(dir,{recursive:true,force:true})});
 const start=async()=>{store=open(file);server=build(store,{masterKey:'a'.repeat(64)});await new Promise(r=>server.listen(0,'127.0.0.1',r))};
 const stop=async()=>{await new Promise(r=>server.close(r));store.db.close();store=null};
 const api=async(route,token)=>fetch('http://127.0.0.1:'+server.address().port+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:'{}'});
 await start();store.operator('restart-qa','Only-for-test-restart-2026',['管理员']);
 const token=store.opLogin('restart-qa','Only-for-test-restart-2026');
 assert.equal((await api('admin/v3/data',token)).status,200);
 await stop();await start();assert.equal((await api('admin/v3/data',token)).status,200);
 assert.equal((await api('admin/logout',token)).status,200);
 await stop();await start();assert.equal((await api('admin/v3/data',token)).status,401);
});
