const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const plain=v=>JSON.parse(JSON.stringify(v));
function fixture() {
  let page;const calls=[];
  const profile={goal:'减脂',energyModel:'goal-v1',estimate:true,sex:'男',height:175,weight:70,age:30,generalAdult:true,resistance:true,targets:{kcal:2172,protein:112,fat:60,carb:296},ratios:[30,40,30],allergens:[],avoid:[],energy:{maintenance:2556},macroMode:'auto',version:4};
  const api={state:()=>({profile}),credentials:()=>true,confirm:async()=>true,login:async()=>true,run:async(_,f)=>f(),request:async(route,b)=>{calls.push({route,body:plain(b)});return plain({...profile,version:4})},mutate:async(action,body)=>{calls.push({action,body:plain(body)});return {profile:plain(profile)}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages/diet/index.js'),'utf8'),{Page:p=>page=p,wx:{pageScrollTo(){}},require:n=>n.endsWith('/service')?api:n.endsWith('/presentation')?{meals:()=>[]}:{} });
  page.data=plain(page.data);page.setData=patch=>{for(const [key,v] of Object.entries(patch)){const parts=key.split('.');let d=page.data;for(const p of parts.slice(0,-1)) d=d[p];d[parts.at(-1)]=v}};
  page.loadMeal=async()=>{};page.adopt(plain(profile));
  return {page,calls,profile};
}
test('重新估算不提交旧营养值，预览版本传入保存请求',async()=> {
  const f=fixture();f.page.data.form.weight='72';await f.page.saveProfile();await new Promise(setImmediate);
  const request=f.calls.find(x=>x.route==='profile/preview'),save=f.calls.find(x=>x.action==='profile');
  assert.deepEqual(request.body.targets,{kcal:2172});assert.equal(request.body.weight,72);assert.equal(request.body.goal,'减脂');assert.equal(save.body.version,4);
});
test('分餐调整单独提交，手动营养由显式开关控制',async()=> {
  const f=fixture();f.page.data.ratioDraft='25,35,30,10';await f.page.saveRatios();assert.deepEqual(f.calls[0],{action:'profileRatios',body:{ratios:[25,35,30,10]}});
  f.page.data.form.estimate=false;f.page.data.form.useManualMacros=false;assert.deepEqual(plain(f.page.profileArgs().targets),{kcal:2172});
  f.page.data.form.useManualMacros=true;assert.deepEqual(plain(f.page.profileArgs().targets),f.profile.targets);
});
