'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const R = require('./rules'), E = require('./energy'), W = require('./workout-energy');
const { defaults, validate } = require('./content'), { change } = require('./account'), { open } = require('./db');
const nutrition = { ...structuredClone(defaults.nutrition), estimation: { ...defaults.nutrition.estimation, approved: true }, goalPolicy: { ...E.defaults, approved: true } };
const input = { sex:'男', height:175, weight:70, age:30, activity:'中等活动', generalAdult:true, resistance:true, estimate:true, energyModel:'goal-v1', goal:'减脂', ratios:[30,40,30], targets:{kcal:2000,carb:275,protein:100,fat:56} };
const config = { ...defaults, nutrition, version:{nutrition:3,foods:1}, risk:{} };
function account() { return { profile:null, prefs:{owned:[],favorites:[],active:[]},weeks:{},sessions:{},history:[],meals:{} }; }
function saved(a, at='2026-10-01T00:00:00Z') { change(a,'profile',{...input,version:3},config,new Date(at)); return a; }
test('静息公式和目标系数正确，减脂/维持/增肌不同，旧营养不残留',()=> {
  const n = structuredClone(nutrition); n.estimation.activity['中等活动'] = 2400/1648.75;
  const kcal = ['减脂','维持','增肌'].map(goal=>R.profile({...input,goal},n).targets.kcal);
  assert.deepEqual(kcal,[2040,2400,2520]);
  const p=R.profile(input,n); assert.equal(p.targets.protein,112);assert.equal(p.targets.fat,57);assert.equal(p.targets.carb,270); assert.equal(p.energy.includesTraining,true);
  assert.equal(R.mealTarget(p,0).kcal+R.mealTarget(p,1).kcal+R.mealTarget(p,2).kcal,2040);
  const female = R.profile({...input, sex:'女',goal:'维持'},nutrition);
  assert.equal(female.energy.resting,1483); assert.equal(female.targets.kcal,Math.round(1482.75*1.55));
  const legacy=R.profile({...input,goal:undefined,energyModel:undefined},n);
  assert.equal(legacy.targets.carb,330); assert.equal(legacy.targets.protein,120);
});
test('已审核策略、人群、单位、下限和手动营养一致性均在服务器检查',()=> {
  for (const b of [{age:17},{age:65},{height:1.75},{weight:150},{goal:'快速减脂'}]) assert.throws(()=>R.profile({...input,...b},nutrition));
  assert.throws(()=>R.profile(input,{...nutrition,goalPolicy:{...E.defaults}}),/尚未发布/);
  assert.throws(()=>R.profile({...input,sex:'女',height:150,weight:45,age:60,activity:'久坐'},nutrition),/下限/);
  assert.throws(()=>R.profile({...input,estimate:false,targets:{kcal:2000,carb:100,protein:100,fat:50}},nutrition),/不一致/);
  const manual=R.profile({...input,estimate:false,targets:{kcal:2000}},nutrition); assert.equal(manual.targets.protein,100);assert.equal(manual.energy,null);
  assert.throws(()=>validate('nutrition',{...nutrition,goalPolicy:{...nutrition.goalPolicy,deficit:.8}}),/参数/);
});
test('两个开关可关闭或省略，三种目标均可预览保存且不伪造健康确认',()=> {
  for (const goal of E.goals) for (const generalAdult of [undefined,false,true]) for (const resistance of [undefined,false,true]) {
    const args={...input,goal,generalAdult,resistance};
    const preview=R.profile(args,nutrition);
    assert.equal(preview.generalAdult,generalAdult===true);
    assert.equal(preview.resistance,resistance===true);
    assert.equal(preview.targets.kcal,{减脂:2172,维持:2556,增肌:2683}[goal]);
    E.checkTargets(preview.targets);
    const a=account();change(a,'profile',{...args,version:3},config);
    assert.deepEqual(a.profile.targets,preview.targets);
  }
  const legacy=R.profile({...input,goal:undefined,energyModel:undefined,generalAdult:false,resistance:false},nutrition);
  assert.equal(legacy.targets.kcal,2556);
});
test('保存要求预览版本；改分餐不改变估算和旧餐快照',()=> {
  const a=saved(account()); const before=structuredClone(a.profile);
  assert.throws(()=>change(a,'profile',{...input,version:2},config),/重新预览/);
  a.meals.old={profileSnapshot:structuredClone(a.profile)};
  change(a,'profileRatios',{ratios:[20,40,40]},config);
  assert.deepEqual(a.profile.targets,before.targets);assert.deepEqual(a.profile.energy,before.energy);assert.equal(a.profile.estimate,true);
  assert.deepEqual(a.meals.old.profileSnapshot.ratios,[30,40,30]);
});
function plateau() {
  const a=saved(account());
  for(const d of ['2026-11-07','2026-11-09','2026-11-12','2026-11-14','2026-11-17','2026-11-20']) change(a,'measurement',{date:d,weight:70},config,new Date('2026-11-20T02:00:00Z'));
  for(const d of ['2026-11-12','2026-11-20']) change(a,'energyFeedback',{date:d,adherence:'基本按计划',wellbeing:'正常',waterChange:false},config,new Date('2026-11-20T02:00:00Z'));
  return a;
}
test('两周各三天且执行反馈完整才提出调整，明日生效，历史不变',()=> {
  const a=plateau(), now=new Date('2026-11-20T02:00:00Z'); const before=structuredClone(a.profile);
  const r=E.progress(a,nutrition.goalPolicy,'2026-11-20'); assert.deepEqual(r.counts,[3,3]);assert.equal(r.recommendation.delta,-100);
  change(a,'acceptEnergy',{id:r.recommendation.id},config,now);
  assert.deepEqual(a.profile,before);assert.equal(a.pendingEnergy.effectiveFrom,'2026-11-21');
  change(a,'profileRatios',{ratios:[20,40,40]},config,now);assert.deepEqual(a.pendingEnergy.profile.ratios,[20,40,40]);
  E.effective(a,'2026-11-21');assert.equal(a.profile.targets.kcal,before.targets.kcal-100);assert.equal(a.pendingEnergy,undefined); assert.equal(a.energyHistory[0].targets.kcal,before.targets.kcal);
  assert.equal(E.progress(a,nutrition.goalPolicy,'2026-11-21').recommendation,null);
});
test('记录不足、反馈不明、波动、不适、冷却期和过时建议不减餐',()=> {
  for(const mutate of [a=>a.measurements={},a=>a.energyFeedback={},a=>a.energyFeedback['2026-11-20'].waterChange=true,a=>a.energyFeedback['2026-11-20'].adherence='偏多',a=>a.energyFeedback['2026-11-20'].wellbeing='明显饥饿或疲劳',a=>a.profile.effectiveFrom='2026-11-18']) {
    const a=plateau();mutate(a);assert.equal(E.progress(a,nutrition.goalPolicy,'2026-11-20').recommendation,null);
  }
  const a=plateau(), id=E.progress(a,nutrition.goalPolicy,'2026-11-20').recommendation.id;
  a.measurements['2026-11-20'].weight=65;
  assert.throws(()=>change(a,'acceptEnergy',{id},config,new Date('2026-11-20T02:00:00Z')),/变化/);
  assert.throws(()=>change(a,'measurement',{date:'2026-11-21',weight:70},config,new Date('2026-11-20T02:00:00Z')),/日期/);
});
test('计划搭配与摄入分别快照，改搭配不改变已吃记录',()=> {
  const a=account();a.meals['2026-11-20-1']={date:'2026-11-20',index:1,actual:{kcal:600},rows:[{id:'rice',grams:150}]};
  assert.equal(a.consumedMeals,undefined);
  change(a,'consumeMeal',{date:'2026-11-20',index:1},config,new Date('2026-11-20T02:00:00Z'));
  a.meals['2026-11-20-1'].actual.kcal=800;
  assert.equal(a.consumedMeals['2026-11-20-1'].actual.kcal,600);
  change(a,'consumeMeal',{date:'2026-11-20',index:1,remove:true},config,new Date('2026-11-20T02:00:00Z'));assert.equal(Object.keys(a.consumedMeals).length,0);
});
test('计时暂停、长时间离开和重复开始不增加虚假训练时长',()=> {
  const a=saved(account());a.sessions['2026-11-20']={status:'待训练',items:[{key:'a',id:'0334'}],workoutType:'bodyweight'};
  const cmd=(act,n)=>change(a,act,{date:'2026-11-20'},config,new Date(Date.parse('2026-11-20T02:00:00Z')+n*1000));
  cmd('start',0);cmd('heartbeat',30);cmd('pause',45);cmd('resume',1000);cmd('heartbeat',1030);cmd('start',1040);
  assert.equal(a.sessions['2026-11-20'].startedAt,'2026-11-20T02:00:00.000Z');
  cmd('heartbeat',2000);assert.equal(a.sessions['2026-11-20'].timer.running,false);assert.equal(a.sessions['2026-11-20'].timer.seconds,135);
  const kcal=a.profile.targets.kcal;cmd('finish',2020);assert.equal(a.profile.targets.kcal,kcal);assert.equal(a.history[0].energyEstimate.available,true);
  const e=W.estimate({workoutType:'bodyweight',energyPerson:{weight:70,age:30},timer:{seconds:1800}});assert.equal(e.gross,105);assert.equal(e.net,70);
  assert.equal(W.estimate({workoutType:'unknown',timer:{seconds:1800}}).available,false);
});
test('北京时间跨日激活已确认方案，不更改数据库中历史副本',()=> {
  assert.equal(E.date('2026-11-20T16:00:00Z'),'2026-11-21');
  const s=open(':memory:');s.ensure('e'); const a=saved(account());
  a.pendingEnergy={effectiveFrom:'2000-01-01',profile:{...a.profile,targets:{...a.profile.targets,kcal:1900}}};
  s.run('UPDATE accounts SET value=? WHERE id=?',JSON.stringify(a),'e');
  assert.equal(s.account('e').profile.targets.kcal,1900);assert.equal(JSON.parse(s.get('SELECT value FROM accounts WHERE id=?','e').value).profile.targets.kcal,a.profile.targets.kcal);
  s.db.close();
});
test('加餐分配合计一致，目标体重达标只提示重新评估，不自动改目标',()=> {
  const p=R.profile({...input,ratios:[25,35,30,10]},nutrition);
  for (const k of R.metrics) assert.equal([0,1,2,3].reduce((sum,i)=>sum+R.mealTarget(p,i)[k],0),p.targets[k]);
  assert.throws(()=>R.mealTarget({...p,ratios:[30,40,30]},3),/餐次/);
  for(let total=0;total<50;total++) {
    const parts=require('../微信小程序/miniprogram/lib/nutrition').allocate(total,[30,30,30,10]);
    assert.ok(parts.every(v=>v>=0));assert.equal(parts.reduce((s,v)=>s+v,0),total);
  }
  const a=plateau();a.profile.targetWeight=70;const result=E.progress(a,nutrition.goalPolicy,'2026-11-20');assert.equal(result.goalReached,true);assert.equal(result.recommendation,null);assert.equal(a.profile.goal,'减脂');
});
test('HTTP 预览与保存一致，幂等与账号隔离，后台敏感数据不泄露',async t=> {
  const s=open(':memory:');s.ensure('energy-one');s.ensure('energy-two');
  s.operator('energy-admin','energy-test-password',['管理员']);s.operator('energy-support','energy-test-password',['运营']);
  s.publish('test','nutrition',1,nutrition,'隔离测试');
  const server=require('./server').build(s);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));s.db.close();});
  const tokens={one:s.session('energy-one'),two:s.session('energy-two'),admin:s.opLogin('energy-admin','energy-test-password'),support:s.opLogin('energy-support','energy-test-password')};
  async function call(route,body={},who='one',status=200) {
    const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[who]},body:JSON.stringify(body)});
    const value=await r.json();assert.equal(r.status,status,route+': '+JSON.stringify(value));return value;
  }
  const preview=await call('profile/preview',input);assert.equal(preview.version,2);
  const command={action:'profile',body:{...input,version:preview.version},rev:0,requestId:'energy-profile-http-1'};
  const a=await call('change',command);assert.deepEqual(a.profile.targets,preview.targets);assert.equal(a.stageGoal,'减脂');
  assert.deepEqual(await call('change',command),a);assert.equal((await call('state',{},'two')).profile,null);
  const today=E.date();await call('change',{action:'measurement',body:{date:today,weight:70.1,waist:89},rev:a.rev,requestId:'energy-weight-http-1'});
  assert.equal((await call('energy/progress')).records[0].weight,70.1);assert.equal((await call('energy/progress',{},'two')).records.length,0);
  const uid=require('./management').user(s,'energy-one').id;
  const redacted=await call('admin/v3/user',{id:uid},'support');assert.equal(redacted.measurements,undefined);assert.equal(redacted.events.some(e=>e.after.measurements || e.after.energyHistory),false);
  await call('admin/v3/user',{id:uid,sensitive:true,reason:'测试隔离'},'support',403);
  const detail=await call('admin/v3/user',{id:uid,sensitive:true,reason:'测试计算追溯'},'admin');assert.equal(detail.measurements[today].weight,70.1);assert.equal(detail.profile.energy.model,'goal-v1');
  const trial=await call('preview/draft',{module:'nutrition',value:nutrition,sample:{profile:input,index:1,items:[]}},'admin');assert.deepEqual(trial.profile.targets,preview.targets);
});
