const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const R = require('../../二版后台/rules'), {change} = require('../../二版后台/account');
const {defaults} = require('../../二版后台/content');
const T = require('../miniprogram/lib/training');
const plain = x => JSON.parse(JSON.stringify(x));
const date = '2026-11-21', now = new Date(date+'T02:00:00Z');
function fixture(name) {
  const content = structuredClone(defaults);
  content.version = {actions:1,templates:1,nutrition:1,foods:1}; content.risk = {};
  content.nutrition.estimation.approved = true; content.nutrition.goalPolicy.approved = true;
  content.foods.forEach(f=>f.checked=['花生','牛奶']);
  let state = {prefs:{owned:['哑铃'],active:[],favorites:[]},weeks:{},sessions:{},history:[],meals:{},stageGoal:'减脂'};
  let intent = null, page, choice = 0; const calls=[];
  const storage = {read:()=>state.prefs};
  const api = {state:()=>state, credentials:()=>({accountId:'qa'}), localDate:()=>date,monday:R.monday,shift:R.shift,
    login:async()=>state,sync:async()=>state,refresh:async()=>state, confirm:async(...args)=>{calls.push({confirm:args});return true},
    run:async(p,f)=>{try{return await f()}catch(e){p.setData({error:e.message});throw e}},
    mutate:async(action,body)=>{calls.push({action,body:plain(body)});const next=structuredClone(state);change(next,action,plain(body),content,now);state=next;return state},
    request:async(route,body)=>{
      if(route==='foods')return {foods:content.foods.filter(f=>R.usable(f,body,{}))};
      if(route==='preview/meal')return {...R.meal(body.profile,body.index,body.items,content.foods,{}),version:1};
      if(route==='profile/preview')return {...R.profile(body,content.nutrition,{preview:true}),version:1};
      throw Error('Unexpected route '+route);
    }};
  const nav={follow(){},take:()=>{const i=intent;intent=null;return i},open:(page,opts)=>calls.push({nav:page,opts})};
  const catalog=require('../miniprogram/lib/catalog');
  const wx={pageScrollTo(){},showToast(){},navigateTo(){},navigateBack(){}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages',name,'index.js'),'utf8'),{
    Page:p=>page=p,wx,setTimeout,clearTimeout,getApp:()=>({globalData:{filters:{parts:[],category:'全部'}}}),
    require:n=>n.endsWith('/service')?api:n.endsWith('/storage')?storage:n.endsWith('/navigation')?nav:n.endsWith('/choose-option')?async()=>choice:require(path.join(__dirname,'../miniprogram/pages',name,n))
  });
  page.data=plain(page.data);page.setData=patch=>{for(const [k,v]of Object.entries(patch)){const parts=k.split('.');let obj=page.data;for(const p of parts.slice(0,-1))obj=obj[p] ||= {};obj[parts.at(-1)]=v===undefined?undefined:plain(v)}};
  const setup = (action,body) => {change(state,action,body,content,now);return state};
  const create=(d=date)=>{setup('createSession',{date:d});return T.select(state.sessions,d,state.lastCreatedSession)};
  const profile=()=>{setup('profile',{energyModel:'goal-v1',goal:'减脂',sex:'男',height:175,weight:70,age:30,activity:'中等活动',estimate:true,ratios:[30,40,30],version:1});page.adopt?.(state.profile)};
  page.onLoad?.({});
  return {page,api,calls,setup,create,profile,content,state:()=>state,intent:i=>intent=i,choose:i=>choice=i,catalog};
}
const event=(dataset,value)=>({currentTarget:{dataset},detail:{value}});
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate)};

test('已存在本周计划时，新训练跟随最新阶段目标，旧训练保持不变',()=>{
  const f=fixture('week'),old=f.create();f.state().stageGoal='增肌';const next=f.create();
  f.setup('add',{date,sessionKey:next.key,id:'0662'});
  assert.equal(next.goal,'增肌');assert.equal(next.items[0].sets,3);assert.equal(old.goal,'减脂');
});
test('更新我的器械后新建训练采用新器械，旧训练仍保留原器械',()=>{
  const f=fixture('week'),old=f.create();f.state().prefs.owned=['单杠'];const next=f.create();
  assert.deepEqual(next.gear,['单杠']);assert.deepEqual(old.gear,['哑铃']);
});
test('同日两节训练移动到已有训练的日期后，页面仍选中刚移动的训练',async()=>{
  const f=fixture('week'),one=f.create(),two=f.create(),target=f.create('2026-11-22');
  f.page.setData({date,start:R.monday(date),sessionKey:two.key,mode:'session'});f.page.draw();
  f.page.move(event({},target.date));await settle();
  assert.equal(f.page.data.date,target.date);assert.equal(f.page.data.sessionKey,two.key);assert.equal(f.page.data.session.key,two.key);
  assert.equal(T.select(f.state().sessions,date,one.key).key,one.key);
});
test('编辑训练名称后往返动作库追加，名称草稿不会被重置',async()=>{
  const f=fixture('week'),s=f.create();f.page.setData({date,start:R.monday(date),sessionKey:s.key,mode:'session'});f.page.draw();
  f.page.nameField(event({},'周六上肢'));f.page.browse();
  f.setup('addMany',{date,sessionKey:s.key,ids:['0662','0662']});
  f.intent({date,sessionKey:s.key,mode:'session'});await f.page.onShow();
  assert.equal(f.page.data.sessionName,'周六上肢');await f.page.saveTraining();
  assert.equal(T.select(f.state().sessions,date,s.key).name,'周六上肢');
});
test('饮食克数直接修改后保存，采用输入值而不是旧推荐值',async()=>{
  const f=fixture('diet');f.profile();f.page.setData({date,index:0});await f.page.loadMeal();
  f.page.add(event({id:'168878'}));await settle();
  f.page.grams(event({id:'168878'},'123'));f.page.save();await settle();
  assert.equal(f.state().meals[date+'-0'].rows[0].grams,123);
});
test('上一餐的克数草稿不能泄漏到下一餐同一食材',async()=>{
  const f=fixture('diet');f.profile();f.page.setData({date,index:0});await f.page.loadMeal();
  f.page.add(event({id:'168878'}));await settle();f.page.grams(event({id:'168878'},'123'));
  f.page.changeMeal(event({i:1}));await settle();f.page.add(event({id:'168878'}));await settle();
  const recommended=f.page.data.result.rows[0].grams;
  f.page.row(event({id:'168878',op:'lock'}));await settle();
  assert.equal(f.page.data.items[0].locked,recommended);
});
test('切到后台再回来，饮食设置仍停留原步骤并保留未保存输入',async()=>{
  const f=fixture('diet');f.profile();f.page.onShow();await settle();
  f.page.screen(event({mode:'energy'}));f.page.input(event({k:'weight'},'72'));
  f.page.onHide();f.page.onShow();await settle();f.page.onHide();
  assert.equal(f.page.data.mode,'energy');assert.equal(f.page.data.form.weight,'72');
});
test('旧餐次缺少目标快照时，取消加餐后仍能修正原加餐实吃记录',()=>{
  const f=fixture('diet');f.profile();f.setup('profileRatios',{ratios:[25,35,30,10]});
  f.setup('saveMeal',{date,index:3,version:1,items:[{id:'168878',locked:100}]});
  delete f.state().meals[date+'-3'].profileSnapshot;
  const target=structuredClone(f.state().meals[date+'-3'].target);
  f.setup('profileRatios',{ratios:[30,40,30]});
  assert.doesNotThrow(()=>f.setup('consumeMeal',{date,index:3,version:1,items:[{id:'168878',locked:80}]}));
  assert.deepEqual(f.state().consumedMeals[date+'-3'].target,target);
});

test('训练选动作默认使用我的器械时，徒手动作仍在可选列表中',()=>{
  const f=fixture('pick');f.create();f.page.onLoad({from:'plan',date});f.page.more(event({name:'胸肌'}));
  assert.ok(f.page.data.sections.flatMap(s=>s.rows).some(m=>m.id==='pushup'));
});

test('旧训练移动日期时保留原器械，不跟随目标周的器械变化',()=>{
  const f=fixture('week'),s=f.create();delete s.gear;
  f.state().weeks['2026-11-23']={goal:'减脂',gear:['单杠'],days:0,minutes:30};
  f.setup('move',{date,sessionKey:s.key,to:'2026-11-23'});
  assert.deepEqual(s.gear,['哑铃']);
});

test('返回动作选择详情时目录更新仍保留选择模式',async()=>{
  const module={exports:{}},m={id:'pushup',sourceId:'0662',name:'俯卧撑',gear:[],steps:[]};let options;
  const page={route:'pages/detail/index',move:m,data:{selecting:true,selected:true,already:true},onLoad:o=>options=o};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/lib/updates.js'),'utf8'),{module,getCurrentPages:()=>[page],
    wx:{getStorageSync:()=>null,setStorageSync(){},getFileSystemManager:()=>({mkdirSync(){},readdirSync:()=>[]}),env:{USER_DATA_PATH:'/test'}},
    require:n=>n==='./catalog'?{byId:new Map([['0662',m]])}:{request:async()=>({version:1,actions:[{id:'0662',name:'新说明'}]})}});
  await module.exports.sync();assert.equal(options.select,'1');assert.equal(options.selected,'1');assert.equal(options.already,'1');
});

test('同日多节选择目标课后，按该节器械而非第一节检查缺少器械',async()=>{
  const f=fixture('pick');f.state().prefs.owned=['单杠'];const one=f.create();
  f.state().prefs.owned=['哑铃'];const two=f.create();
  const move=[...R.moves.values()].find(m=>m.gear.length===1&&m.gear[0]==='单杠');
  f.page.setData({date,sessionKey:'',selectedIds:[move.id]});f.choose(1);
  await f.page.confirmSelection();
  assert.equal(T.select(f.state().sessions,date,two.key).items.length,1);
  assert.equal(T.select(f.state().sessions,date,one.key).items.length,0);
  assert.ok(f.calls.some(c=>c.confirm?.[1]?.includes('单杠')));
});
