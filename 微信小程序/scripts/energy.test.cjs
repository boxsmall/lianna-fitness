const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const plain=v=>JSON.parse(JSON.stringify(v));
function fixture() {
  let page;const calls=[];
  const profile={goal:'减脂',energyModel:'goal-v1',estimate:true,sex:'男',height:175,weight:70,age:30,generalAdult:true,resistance:true,targets:{kcal:2172,protein:112,fat:60,carb:296},ratios:[30,40,30],allergens:[],avoid:[],energy:{maintenance:2556},macroMode:'auto',version:4};
  const api={state:()=>({profile}),credentials:()=>true,confirm:async()=>true,login:async()=>true,run:async(_,f)=>f(),request:async(route,b)=>{calls.push({route,body:plain(b)});return plain({...profile,version:4})},mutate:async(action,body)=>{calls.push({action,body:plain(body)});return {profile:plain(profile)}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages/diet/index.js'),'utf8'),{setTimeout,clearTimeout,Page:p=>page=p,wx:{pageScrollTo(){}},require:n=>n.endsWith('/service')?api:n.endsWith('/presentation')?{meals:()=>[]}:{} });
  page.data=plain(page.data);page.setData=patch=>{for(const [key,v] of Object.entries(patch)){const parts=key.split('.');let d=page.data;for(const p of parts.slice(0,-1)) d=d[p];d[parts.at(-1)]=v}};
  page.loadMeal=async()=>{};page.adopt(plain(profile));
  return {page,calls,profile,api};
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
test('可选开关关闭仍提交预览保存，修改表单清除旧提示',async()=> {
  const f=fixture();f.page.data.error='请使用专业人员提供的目标';
  for(const k of ['generalAdult','resistance']) f.page.input({currentTarget:{dataset:{k}},detail:{value:false}});
  assert.equal(f.page.data.error,'');
  await f.page.saveProfile();await new Promise(setImmediate);
  for(const call of f.calls.filter(x=>x.route==='profile/preview'||x.action==='profile')) {
    assert.equal(call.body.generalAdult,false);assert.equal(call.body.resistance,false);
  }
  assert.ok(f.calls.some(x=>x.action==='profile'));
});


test('抗阻开关实时更新预览但不保存，过时请求不覆盖新输入',async()=> {
  const f=fixture(), R=require('../../二版后台/rules'),{defaults}=require('../../二版后台/content'), E=require('../../二版后台/energy');
  const rules=structuredClone(defaults.nutrition);rules.estimation.approved=true;rules.goalPolicy={...E.defaults,approved:true};
  f.api.request=async(route,b)=>{f.calls.push({route,body:plain(b)});return R.profile(b,rules,{preview:true})};
  f.page.data.mode='energy';f.page.data.form.activity='中等活动';
  f.page.input({currentTarget:{dataset:{k:'resistance'}},detail:{value:false}});
  await new Promise(r=>setTimeout(r,300));const old=plain(f.page.data.targetPreview.targets);
  f.page.input({currentTarget:{dataset:{k:'resistance'}},detail:{value:true}});
  await new Promise(r=>setTimeout(r,300));const next=f.page.data.targetPreview.targets;
  assert.equal(next.kcal,old.kcal);assert.equal(next.protein,112);assert.notEqual(next.protein,old.protein);
  assert.ok(f.page.data.macroDelta.includes('蛋白质'));assert.equal(f.calls.some(c=>c.action==='profile'),false);
  let resolveOld;f.api.request=()=>new Promise(r=>resolveOld=r);f.page.queuePreview();await new Promise(r=>setTimeout(r,300));
  f.page.input({currentTarget:{dataset:{k:'weight'}},detail:{value:'72'}});resolveOld({targets:{kcal:999,protein:1,fat:1,carb:1}});
  await new Promise(setImmediate);assert.equal(f.page.data.targetPreview,null);f.page.onHide();
});
