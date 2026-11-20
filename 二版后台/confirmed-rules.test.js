'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('./rules'),E=require('./energy'),W=require('./workout-energy'),T=require('../微信小程序/miniprogram/lib/training');
const {change,prepare}=require('./account'),{defaults}=require('./content');
const c={...structuredClone(defaults),version:{actions:2,templates:1,nutrition:3,foods:1},risk:{}};
c.actions=c.actions.map(m=>({...m,approved:true}));
c.foods=c.foods.map(f=>({...f,checked:['花生','牛奶']}));
c.nutrition.estimation.approved=true;c.nutrition.goalPolicy={...E.defaults,approved:true};
const input={sex:'男',height:175,weight:70,age:30,activity:'中等活动',resistance:false,estimate:true,energyModel:'goal-v1',goal:'减脂',ratios:[30,40,30],targets:{kcal:2000},version:3};
const now=new Date('2026-11-20T02:00:00Z'),date='2026-11-20';
function account(){return {prefs:{owned:['哑铃'],favorites:[],active:[]},sessions:{},weeks:{},history:[],meals:{}};}
function mutate(a,action,body={}){change(a,action,body,c,now);return a;}
function session(a,goal='减脂',d=date){mutate(a,'createSession',{date:d,goal});return T.select(a.sessions,d,a.lastCreatedSession);}
function settled(goal='减脂'){
 const a=account();change(a,'profile',{...input,goal},c,new Date('2026-10-01T00:00:00Z'));
 for(const d of ['2026-11-07','2026-11-09','2026-11-12','2026-11-14','2026-11-17','2026-11-20'])mutate(a,'measurement',{date:d,weight:70});
 return a;
}
const assess={adherence:'基本按计划',wellbeing:'正常',waterStatus:'无影响'};
test('年龄确认、BMI参考、正数输入及低热量复核各自独立',()=>{
 const old={...input,age:70};assert.ok(R.profile(old,c.nutrition,{preview:true}).energy.ageNotice);
 assert.throws(()=>R.profile(old,c.nutrition),/确认/);
 assert.ok(R.profile({...old,ageAcknowledged:true},c.nutrition).targets.kcal>0);
 assert.ok(R.profile({...input,weight:150},c.nutrition).energy.bmi>30);
 const manual={...input,estimate:false,height:99,weight:20,targetWeight:10};
 assert.equal(R.profile(manual,c.nutrition).targetWeight,10);
 for(const weight of [0,-1,Infinity,NaN])assert.throws(()=>R.profile({...manual,weight},c.nutrition));
 const low={...input,sex:'女',height:150,weight:45,age:60,activity:'久坐'};
 const preview=R.profile(low,c.nutrition,{preview:true});assert.equal(preview.reviewRequired,true);assert.ok(preview.targets.kcal<1200);
 assert.throws(()=>R.profile(low,c.nutrition),/复核阈值/);
 assert.equal(R.profile({...input,goalPercent:20},c.nutrition).targets.kcal,2044);
});
test('手填营养差额须明确选择保留或重算，估算始终保持合计一致',()=>{
 const manual={...input,estimate:false,targets:{kcal:2000,carb:300,protein:100,fat:50}};
 assert.equal(R.profile(manual,c.nutrition,{preview:true}).macroDifference,50);
 assert.throws(()=>R.profile(manual,c.nutrition),/差额/);
 assert.equal(R.profile({...manual,macroResolution:'align'},c.nutrition).targets.kcal,2050);
 assert.equal(R.profile({...manual,macroResolution:'keep'},c.nutrition).targets.kcal,2000);
 const a=R.profile(input,c.nutrition),b=R.profile({...input,resistance:true},c.nutrition);
 assert.equal(a.targets.kcal,b.targets.kcal);assert.notEqual(a.targets.protein,b.targets.protein);E.checkTargets(a.targets);E.checkTargets(b.targets);
});
test('同日两节独立、重复动作独立、加练不改变计划且周重排保留多节',()=>{
 const a=account(),one=session(a,'增肌'),two=session(a);
 assert.equal(T.onDate(a.sessions,date).length,2);assert.equal(a.weeks[R.monday(date)].days,1);
 assert.throws(()=>mutate(a,'addMany',{date,ids:['0662']}),/先选择/);
 mutate(a,'addMany',{date,sessionKey:one.key,ids:['0662','0662']});
 mutate(a,'addMany',{date,sessionKey:two.key,ids:['0662']});
 assert.equal(one.items[0].sets,3);assert.equal(two.items[0].sets,2);assert.notEqual(one.items[0].key,one.items[1].key);
 mutate(a,'edit',{date,sessionKey:one.key,key:one.items[1].key,sets:1,target:12,rest:20});
 assert.equal(one.items[0].sets,3);assert.equal(one.items[1].rest,20);
 const plan=prepare(a,{start:'2026-11-16',days:3,goal:'减脂',minutes:30,gear:['哑铃']},c);
 mutate(a,'savePlan',{input:{start:'2026-11-16',days:3,goal:'减脂',minutes:30,gear:['哑铃']},version:plan.version});
 assert.equal(T.onDate(a.sessions,date).length,2);
 const s=T.select(a.sessions,date,one.key),key=s.items[1].key;
 mutate(a,'start',{date,sessionKey:s.key});mutate(a,'record',{date,sessionKey:s.key,key,value:12});
 assert.throws(()=>mutate(a,'record',{date,sessionKey:s.key,key,value:12}),/加练/);
 mutate(a,'record',{date,sessionKey:s.key,key,value:9,extra:true});
 assert.equal(s.items[1].sets,1);assert.equal(s.snapshot[1].sets,1);assert.equal(s.actual[key][1].extra,true);
 mutate(a,'finish',{date,sessionKey:s.key});assert.equal(T.select(a.sessions,date,two.key).status,'待训练');
 assert.equal(a.history[0].key,one.key);
});
test('重复动作向后修改匹配对应块；日期调整可并列或指定交换',()=>{
 const a=account(),s=session(a),next=session(a,'减脂','2026-11-21');
 for(const x of [s,next])mutate(a,'addMany',{date:x.date,sessionKey:x.key,ids:['0662','0662']});
 mutate(a,'edit',{date,sessionKey:s.key,key:s.items[1].key,sets:4,target:15,rest:30,future:true});
 assert.deepEqual(next.items.map(i=>i.sets),[2,4]);
 mutate(a,'move',{date,sessionKey:s.key,to:next.date});assert.equal(T.onDate(a.sessions,next.date).length,2);
 const third=session(a,'日常健身',date);
 mutate(a,'move',{date,sessionKey:third.key,to:next.date,swap:true,swapSessionKey:next.key});
 assert.equal(T.select(a.sessions,date,next.key).key,next.key);assert.equal(T.onDate(a.sessions,'2026-11-21').length,2);
});
test('体重任意历史日期、覆盖确认、90条分页和查询，反馈不保留腰围',()=>{
 const a=account();mutate(a,'measurement',{date:'1990-01-01',weight:60,waist:80});
 assert.deepEqual(a.measurements['1990-01-01'],{date:'1990-01-01',weight:60});
 assert.throws(()=>mutate(a,'measurement',{date:'1990-01-01',weight:61}),/确认覆盖/);
 assert.throws(()=>mutate(a,'measurement',{date:'1990-01-01',weight:61,confirmOverwrite:true,previousWeight:59}),/确认覆盖/);
 mutate(a,'measurement',{date:'1990-01-01',weight:61,confirmOverwrite:true,previousWeight:60});
 mutate(a,'energyFeedback',{date:'1990-01-01',adherence:'偏多',wellbeing:'正常'});
 assert.throws(()=>mutate(a,'energyFeedback',{date:'2026-11-21',...assess}),/未来/);
 for(let i=0;i<100;i++)mutate(a,'measurement',{date:E.shift(date,-i),weight:70});
 const page=E.progress(a,c.nutrition.goalPolicy,date);assert.equal(page.records.length,90);assert.equal(page.nextOffset,90);
 const older=E.progress(a,c.nutrition.goalPolicy,date,{offset:90});assert.equal(older.records.length,11);assert.equal(older.records.at(-1).weight,61);
 assert.equal(E.progress(a,c.nutrition.goalPolicy,date,{from:'1990-01-01',to:'1990-01-01'}).records.length,1);
});
test('评估时补反馈，单次偏离及已缓解不适不拦截，仍不适仅暂停减量',()=>{
 const a=settled();assert.equal(E.progress(a,c.nutrition.goalPolicy,date).needsAssessment,true);
 mutate(a,'energyFeedback',{date:'2026-11-12',adherence:'偏多',wellbeing:'训练表现下降',waterChange:true});
 mutate(a,'energyAssessment',assess);assert.equal(E.progress(a,c.nutrition.goalPolicy,date).recommendation.delta,-100);
 mutate(a,'energyAssessment',{...assess,wellbeing:'训练表现下降'});assert.equal(E.progress(a,c.nutrition.goalPolicy,date).recommendation,null);
 const gain=settled('增肌');mutate(gain,'energyAssessment',{...assess,wellbeing:'训练表现下降'});assert.equal(E.progress(gain,c.nutrition.goalPolicy,date).recommendation.delta,100);
 mutate(a,'energyAssessment',{...assess,waterStatus:'不确定'});assert.equal(E.progress(a,c.nutrition.goalPolicy,date).recommendation,null);
 mutate(a,'energyAssessment',assess);const r=E.progress(a,c.nutrition.goalPolicy,date).recommendation;mutate(a,'acceptEnergy',{id:r.id});
 assert.equal(a.pendingEnergy.effectiveFrom,'2026-11-21');assert.equal(a.profile.targets.kcal-r.targets.kcal,100);
 assert.equal(a.energyHistory.length,1);
});
test('实际克数可以更新，计划搭配及当时目标不被覆盖',()=>{
 const a=account();mutate(a,'profile',input);
 mutate(a,'saveMeal',{date,index:1,items:[{id:'168878',locked:100}],version:1});
 const original=structuredClone(a.meals[date+'-1']);
 mutate(a,'consumeMeal',{date,index:1,items:[{id:'168878',locked:150}],version:1});
 assert.deepEqual(a.meals[date+'-1'],original);assert.equal(a.consumedMeals[date+'-1'].rows[0].grams,150);
 assert.throws(()=>mutate(a,'consumeMeal',{date,index:1,items:[{id:'168878',locked:120}],version:0}),/更新/);
});
test('各类成人训练可估算，65岁确认不可省略且失败开始不改变状态',()=>{
 for(const type of Object.keys(W.types))for(const age of [18,30,60,65,80]){
  const s={workoutType:type,energyPerson:{age,weight:70,ageAcknowledged:true},timer:{seconds:1800}};
  assert.equal(W.estimate(s).available,true);assert.ok(W.estimate(s).gross>W.estimate(s).net);
 }
 assert.equal(W.estimate({workoutType:'mixed',energyPerson:{age:30,weight:70},timer:{seconds:1800}}).available,false);
 const a=account(),s=session(a);mutate(a,'addMany',{date,sessionKey:s.key,ids:['0662']});mutate(a,'workoutType',{date,sessionKey:s.key,type:'walking'});
 assert.throws(()=>mutate(a,'start',{date,sessionKey:s.key,age:65,weight:70}),/确认/);assert.equal(s.status,'待训练');
 mutate(a,'start',{date,sessionKey:s.key,age:65,weight:70,ageAcknowledged:true});assert.equal(s.status,'训练中');
});

test('新增已审核且启用的动作可参与自动排课，不限定初始化名单',()=>{
 const config=structuredClone(c),old=config.actions.find(m=>m.pattern==='蹲');
 assert.ok(old);
 const extra=[...R.moves.values()].find(m=>!config.actions.some(a=>a.id===m.sourceId)&&m.gear.length===0);
 assert.ok(extra);config.actions.unshift({...old,id:extra.sourceId,gear:[],approved:true,enabled:true,visible:true});
 const p=R.plan({start:'2026-11-16',days:1,goal:'日常健身',minutes:60,gear:['哑铃']},config,{favorites:[extra.id]});
 assert.ok(T.all(p.sessions).some(s=>s.items.some(i=>i.id===extra.sourceId)));
 config.actions[0].approved=false;
 assert.equal(T.all(R.plan({start:'2026-11-16',days:1,goal:'日常健身',minutes:60,gear:['哑铃']},config,{favorites:[extra.id]}).sessions).some(s=>s.items.some(i=>i.id===extra.sourceId)),false);
});

test('HTTP多节训练幂等、拒绝含糊写入、账号隔离与评估敏感字段脱敏',async t=>{
 const {open}=require('./db'),{build}=require('./server'),M=require('./management');
 const store=open(':memory:');store.ensure('confirmed-one');store.ensure('confirmed-two');
 store.operator('confirmed-support','test-password-only',['运营']);
 store.publish('test','nutrition',1,c.nutrition,'隔离测试');
 const server=build(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.db.close()});
 const tokens={one:store.session('confirmed-one'),two:store.session('confirmed-two'),support:store.opLogin('confirmed-support','test-password-only')};
 let seq=0;
 async function call(route,body={},who='one',status=200){const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[who]},body:JSON.stringify(body)});const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;}
 async function cmd(action,body,status=200){const a=await call('state');return call('change',{action,body,rev:a.rev,requestId:'confirmed-http-'+(++seq)},'one',status);}
 let a=await cmd('createSession',{date});const first=a.lastCreatedSession;
 a=await cmd('createSession',{date});const second=a.lastCreatedSession;
 await cmd('addMany',{date,ids:['0662']},400);
 const request={action:'addMany',body:{date,sessionKey:second,ids:['0662','0662']},rev:a.rev,requestId:'confirmed-retry-add'};
 a=await call('change',request);assert.deepEqual(await call('change',request),a);
 assert.equal(T.select(a.sessions,date,first).items.length,0);assert.equal(T.select(a.sessions,date,second).items.length,2);
 assert.equal(T.onDate((await call('state',{},'two')).sessions,date).length,0);
 const preview=await call('profile/preview',input);await cmd('profile',{...input,version:preview.version});await cmd('energyAssessment',assess);
 const detail=await call('admin/v3/user',{id:M.user(store,'confirmed-one').id},'support');
 assert.equal(detail.energyAssessment,undefined);assert.ok(detail.events.every(e=>!e.after.energyAssessment));
 const query=await call('energy/progress',{from:'1990-01-01',to:date});assert.equal(query.records.length,0);
 await call('energy/progress',{from:date,to:'1990-01-01'},'one',400);
});

test('训练命名只更新选中的待训练课程，开始后保留原名称',()=>{
 const a=account(),one=session(a),two=session(a);
 mutate(a,'sessionName',{date,sessionKey:two.key,name:'  晚间力量训练  '});
 assert.equal(two.name,'晚间力量训练');assert.equal(one.name,undefined);
 assert.throws(()=>mutate(a,'sessionName',{date,name:'错误目标'}),/先选择/);
 for(const name of ['', '  ', '名'.repeat(41)])assert.throws(()=>mutate(a,'sessionName',{date,sessionKey:two.key,name}),/训练名称/);
 mutate(a,'addMany',{date,sessionKey:two.key,ids:['0662']});mutate(a,'start',{date,sessionKey:two.key});
 assert.throws(()=>mutate(a,'sessionName',{date,sessionKey:two.key,name:'修改'}),/开始后/);
 assert.equal(two.name,'晚间力量训练');
});
