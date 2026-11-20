const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){let page;let account={meals:{},history:[]};const calls=[];
 const api={credentials:()=>true,state:()=>account,asset:p=>p?'https://admin.yijiandot.com.cn'+p:'',login:async()=>account,refresh:async()=>account,request:async()=>[],run:async(p,f)=>{try{await f()}catch(e){p.setData({error:e.message})}},mutate:async(a,b)=>{calls.push({a,b});account.identity={nickname:b.nickname,avatar:'/avatars/'+'a'.repeat(48)}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages/account/index.js'),'utf8'),{Page:p=>page=p,require:n=>n.endsWith('service')?api:n.endsWith('navigation')?{take:()=>null}:{byId:new Map()},wx:{showToast(){},getFileSystemManager:()=>({readFile:o=>o.success({data:'selected-image'})})}});
 page.data=JSON.parse(JSON.stringify(page.data));page.setData=p=>Object.assign(page.data,p);return {page,calls};}
test('昵称头像不自动获取，未确认不能上传，选择器返回不丢失编辑，确认后同步',async()=>{
 const {page,calls}=fixture();page.editIdentity();assert.equal(calls.length,0);
 page.nickname({detail:{value:'用户自选昵称'}});await page.saveIdentity();await new Promise(setImmediate);assert.match(page.data.error,/确认/);assert.equal(calls.length,0);
 page.chooseAvatar({detail:{avatarUrl:'wxfile://picked'}});await new Promise(setImmediate);page.onShow();assert.equal(page.data.mode,'identity');assert.equal(page.data.nickname,'用户自选昵称');
 page.identityConsent({detail:{value:['agree']}});await page.saveIdentity();await new Promise(setImmediate);assert.equal(calls.length,1);assert.equal(calls[0].b.consent,true);assert.equal(calls[0].b.avatarData,'selected-image');assert.equal(page.data.mode,'mine');assert.equal(page.data.nickname,'用户自选昵称');
});
