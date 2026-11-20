const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const plain=v=>JSON.parse(JSON.stringify(v));
function fixture(name,a={}){
 let page;const calls=[];
 const api={state:()=>a,localDate:()=> '2026-11-20',run:async(p,f)=>f(),confirm:async(...v)=>{calls.push({confirm:v});return true},mutate:async(action,body)=>{calls.push({action,body:plain(body)});return a},refresh:async()=>a,request:async()=>({records:[],nextOffset:null})};
 const nav={follow(){},open:(...v)=>calls.push({nav:v})};
 const display={shortDate:d=>d,weekDays:()=>Array.from({length:7},(_,i)=>({date:'2026-11-'+(16+i),weekday:'一二三四五六日'[i],active:i===4})),meals:()=>[]};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages',name,'index.js'),'utf8'),{Page:p=>page=p,wx:{showToast(){}},require:n=>n.endsWith('/service')?api:n.endsWith('/navigation')?nav:n.endsWith('/training')?require('../miniprogram/lib/training'):n.endsWith('/catalog')?{byId:new Map(),media:()=>''}:display});
 page.data=plain(page.data);page.setData=v=>Object.assign(page.data,v);
 return {page,calls,api};
}
test('首页打开当天未完成的指定训练，不回到已完成的第一节',()=>{
 const f=fixture('today');const a={sessions:{'2026-11-20':{key:'done',date:'2026-11-20',status:'已完成'},'2026-11-20@next':{key:'next',date:'2026-11-20',status:'待训练',items:[{key:'block1'},{key:'block2'}]}},weeks:{}};
 f.page.draw(a,'2026-11-20');f.page.openTraining();assert.equal(f.page.data.sessionCount,2);assert.equal(f.page.data.sessionItemCount,2);
 assert.equal(f.calls[0].nav[1].sessionKey,'next');
});
test('体重覆盖展示原值，取消不写入，确认携带原值并且不提交腰围',async()=>{
 const f=fixture('progress',{measurements:{'1990-01-01':{date:'1990-01-01',weight:70}}});
 f.page.setData({date:'1990-01-01',weight:'69',waist:80});f.page.reload=async()=>{};
 f.api.confirm=async(...v)=>{f.calls.push({confirm:v});return false};await f.page.saveWeight();assert.equal(f.calls.some(x=>x.action),false);
 assert.ok(f.calls[0].confirm[1].includes('原值 70 kg'));
 f.api.confirm=async()=>true;await f.page.saveWeight();assert.deepEqual(f.calls.at(-1).body,{date:'1990-01-01',weight:69,confirmOverwrite:true,previousWeight:70});
});
test('历史加载按服务端游标追加，筛选不丢失日期条件',async()=>{
 const f=fixture('progress');f.page.setData({from:'1990-01-01',to:'2026-11-20',records:[{date:'2026-11-20',weight:70}],nextOffset:90});
 f.api.request=async(route,body)=>{f.calls.push({route,body:plain(body)});return {records:[{date:'1990-01-01',weight:65}],nextOffset:null}};
 await f.page.more();assert.equal(f.page.data.records.length,2);assert.equal(f.page.data.nextOffset,null);
 assert.deepEqual(f.calls[0].body,{from:'1990-01-01',to:'2026-11-20',offset:90});
});
test('当前评估三项均由用户确认，保存后刷新；独立反馈仍可不填',async()=>{
 const f=fixture('progress');f.page.reload=async()=>{};f.page.assess();
 await assert.rejects(()=>f.page.saveAssessment(),/请确认/);assert.equal(f.calls.length,0);
 f.page.setData({assessmentAdherence:'基本按计划',assessmentWellbeing:'正常',assessmentWater:'无影响'});
 await f.page.saveAssessment();assert.equal(f.calls[0].action,'energyAssessment');assert.equal(f.page.data.assessmentOpen,false);
});
test('训练选择超过六项仍可选择后面的项目',async()=>{
 let choose;const steps=[5,2],pages=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/lib/choose-option.js'),'utf8'),{module:{set exports(f){choose=f}},wx:{showActionSheet(o){pages.push(o.itemList);o.success({tapIndex:steps.shift()})}}});
 assert.equal(await choose(Array.from({length:9},(_,i)=>'训练'+i)),7);assert.ok(pages.every(p=>p.length<=6));
});
