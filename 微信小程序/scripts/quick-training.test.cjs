const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const plain=v=>JSON.parse(JSON.stringify(v));
function fixture(pageName){
 let page,intent=null,owned=['哑铃']; const calls=[],state={weeks:{},sessions:{},history:[]};
 const storage={read:()=>({owned,active:[],favorites:[]})};
 const api={state:()=>state,credentials:()=>true,localDate:()=> '2026-11-19',monday:()=> '2026-11-16',shift:(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)},sync:async()=>{},refresh:async()=>{},login:async()=>true,confirm:async()=>true,run:async(p,f)=>f(),mutate:async(action,b)=>{calls.push({action,...b});if(action==='add'){const s=state.sessions[b.date] ||= {items:[]};if(!s.items.some(i=>i.id===b.id))s.items.push({id:b.id,key:b.id})}}};
 const nav={take:()=>{const v=intent;intent=null;return v},follow(){},open:(...args)=>calls.push({navigation:args})};
 const byId=new Map(['A','B','C'].map(id=>[id,{id,sourceId:id,name:id,gear:[]}]))
 const catalog={byId,media:()=>'',equipmentCatalog:{},pickView:()=>({category:'全部',sections:[{rows:['A','B','C'].map(id=>({id}))}]})};
 const wx={pageScrollTo(){},showToast(){},navigateTo(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages',pageName,'index.js'),'utf8'),{Page:p=>page=p,wx,getApp:()=>({globalData:{filters:{parts:[],category:'全部'}}}),require:n=>n.endsWith('/service')?api:n.endsWith('/storage')?storage:n.endsWith('/catalog')?catalog:n.endsWith('/navigation')?nav:n.endsWith('/training')?require('../miniprogram/lib/training'):n.endsWith('/workout-types')?require('../miniprogram/lib/workout-types'):{shortDate:d=>d}});
 page.data=plain(page.data);page.setData=v=>Object.assign(page.data,plain(v));page.onLoad({});
 return {page,api,state,calls,intent:v=>intent=v,owned:v=>owned=v};
}
test('详情连续加入 A、B 均立即追加，保持指定日期而非覆盖待选 ID',async()=>{const f=fixture('week');for(const id of ['A','B']){f.intent({add:id,date:'2026-11-20'});await f.page.onShow()}assert.deepEqual(f.state.sessions['2026-11-20'].items.map(i=>i.id),['A','B']);assert.equal(f.page.data.addId,'');assert.equal(f.page.data.mode,'session');f.page.browse();assert.deepEqual(plain(f.calls.at(-1).navigation),['pick',{from:'plan',date:'2026-11-20',sessionKey:''}]);});
test('新建计划读取最新器械，返回页面保留本次徒手选择，再次新建恢复我的器械',async()=>{const f=fixture('week');f.owned(['哑铃','训练凳']);f.intent({mode:'create'});await f.page.onShow();assert.deepEqual(plain(f.page.data.gear),['哑铃','训练凳']);f.page.bodyweight();await f.page.onShow();assert.deepEqual(plain(f.page.data.gear),[]);f.page.mode({currentTarget:{dataset:{mode:'create'}}});assert.deepEqual(plain(f.page.data.gear),['哑铃','训练凳']);});
test('动作多选跨刷新保留，取消单项不影响其余，提交同一日期的整组选项',async()=>{const f=fixture('pick');f.page.onLoad({from:'plan',date:'2026-11-20'});f.page.toggleMove({detail:{id:'A'}});f.page.toggleMove({detail:{id:'B'}});f.page.refresh();assert.deepEqual(plain(f.page.data.selectedIds),['A','B']);f.page.toggleMove({detail:{id:'A'}});f.page.toggleMove({detail:{id:'C'}});await f.page.confirmSelection();const call=f.calls.find(c=>c.action==='addMany');assert.deepEqual(plain(call.ids),['B','C']);assert.equal(call.date,'2026-11-20');assert.equal(f.page.data.selectedCount,0);});


test('返回页面的异步同步保留正在编辑的组次，保存后才关闭表单',async()=>{
 const f=fixture('week'),date='2026-11-20';
 f.state.sessions[date]={key:'session-a',date,status:'待训练',type:'自行编排',budget:30,items:[{key:'block-a',id:'A',sets:2,target:10,rest:45}],timing:{}};
 f.page.setData({date,start:'2026-11-16',sessionKey:'session-a'});f.page.draw();
 f.page.editor({currentTarget:{dataset:{key:'block-a'}}});f.page.data.edit.target='12';f.page.data.edit.rest='20';
 f.page.draw();assert.equal(f.page.data.edit.key,'block-a');assert.equal(f.page.data.edit.target,'12');assert.equal(f.page.data.edit.rest,'20');
 await f.page.commit('edit',{key:'block-a',sets:2,target:12,rest:20});assert.equal(f.page.data.edit,null);
});
