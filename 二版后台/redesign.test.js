'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{open}=require('./db'),{build}=require('./server'),M=require('./management'),L=require('./ledger'),{defaults}=require('./content');

test('当天批量选动作无需周计划，继续追加不替换且请求幂等', async t => {
 const {store,api}=await fixture(t); let n=0;
 const mutate=(action,body,status=200)=>api('change',{action,body,rev:store.account('person1').rev,requestId:'quick-training-'+(++n)},'person1',status);
 await mutate('sync',{owned:['哑铃'],active:['哑铃'],favorites:[],merge:true});
 const date='2026-11-19';
 let a=await mutate('addMany',{date,ids:['0334','0293']});
 assert.deepEqual(a.sessions[date].items.map(i=>i.id),['0334','0293']);
 assert.deepEqual(a.weeks['2026-11-16'].gear,['哑铃']);
 const original=a.sessions[date].items[0].key,course=a.sessions[date].key;
 a=await mutate('addMany',{date,ids:['0334','0662','0662']});
 assert.deepEqual(a.sessions[date].items.map(i=>i.id),['0334','0293','0334','0662','0662']);
 assert.equal(new Set(a.sessions[date].items.map(i=>i.key)).size,5);
 assert.equal(a.sessions[date].items[0].key,original);assert.equal(a.sessions[date].key,course);
 const before=structuredClone(a);
 await mutate('addMany',{date,ids:['1760','nonexistent']},400);
 assert.deepEqual(store.account('person1'),before);
 await mutate('addMany',{date,ids:['0327']},400);
 assert.deepEqual(store.account('person1'),before);
 a=await mutate('addMany',{date:'2026-11-20',ids:['0662']});
 assert.equal(a.weeks['2026-11-16'].days,2);assert.deepEqual(a.sessions[date],before.sessions[date]);
 await mutate('start',{date});
 await mutate('record',{date,key:original,value:10,weight:3});
 a=await mutate('add',{date,id:'1760'});
 assert.equal(a.sessions[date].actual[original][0].weight,3);assert.equal(a.sessions[date].snapshot.length,5);
 const cmd={action:'addMany',body:{date,ids:['0662']},rev:a.rev,requestId:'quick-training-repeat'};
 a=await api('change',cmd,'person1');const again=await api('change',cmd,'person1');assert.deepEqual(again,a);
 await mutate('finish',{date});await mutate('addMany',{date,ids:['0334']},400);
 const content=store.content();store.publish('op:owner','actions',2,content.actions.map(m=>m.id==='0334'?{...m,visible:false}:m),'测试下架');
 await mutate('addMany',{date:'2026-11-21',ids:['0662','0334']},400);
 assert.equal(store.account('person1').sessions['2026-11-21'],undefined);
});
async function fixture(t,options={}){
 const store=open(':memory:');store.operator('owner','test-password-12345',['管理员','运营','审核','客服']);store.operator('support','test-password-12345',['客服']);store.ensure('person1');store.ensure('person2');
 const c=structuredClone(defaults);c.actions.forEach(a=>a.approved=true);c.ai={...c.ai,dailyLimit:100,pricePerMillionInput:2,pricePerMillionOutput:8};
 for(const [key,value]of Object.entries(c))store.publish('op:owner',key,1,value,'测试初始配置');
 const server=build(store,{masterKey:'a'.repeat(64),...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));store.db.close()});
 const tokens={owner:store.opLogin('owner','test-password-12345'),support:store.opLogin('support','test-password-12345'),person1:store.session('person1'),person2:store.session('person2')};
 async function api(route,body={},who='owner',status=200){const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(tokens[who]||who)},body:JSON.stringify(body)});const v=await r.json();assert.equal(r.status,status,route+': '+JSON.stringify(v));return v}
 await api('admin/key',{key:'test-model-key-only'});return {store,api,tokens,base:"http://127.0.0.1:"+server.address().port};
}
test('用户业务查询、幂等收藏事件、敏感字段隔离与账号限制',async t=>{
 const {store,api}=await fixture(t);const catalog=await api('admin/v3/data');assert.equal(catalog.moves.length,1324);assert.equal(catalog.users.length,2);const uid=M.user(store,'person1').id;
 const b={requestId:'sync-test-000001',rev:0,action:'sync',body:{owned:['哑铃'],active:['哑铃'],favorites:['0334'],merge:true}};
 await api('change',b,'person1');await api('change',b,'person1');assert.equal(store.get('SELECT count(*) n FROM favorite_events').n,1);
 const state=store.account('person1');await api('change',{requestId:'sync-test-000002',rev:state.rev,action:'sync',body:{owned:[],active:[],favorites:[],merge:false}},'person1');assert.equal(store.get('SELECT count(*) n FROM favorite_events').n,2);
 const detail=await api('admin/v3/user',{id:uid});assert.equal(detail.profile,undefined);assert.equal(detail.events.length,2);
 assert.equal((await api('admin/v3/data',{},'support')).users.length,0);await api('admin/v3/user',{id:uid},'support',403);await api('admin/ledger/data',{},'support',403);
 await api('admin/v3/user-status',{id:uid,status:'已限制',reason:'回归限制'});await api('state',{},'person1',401);assert.ok(store.get('SELECT 1 FROM accounts WHERE id=?','person1'));
 await api('admin/v3/user-status',{id:uid,status:'正常',reason:'恢复'});assert.equal(store.account('person1').prefs.favorites.length,0);
 assert.ok(store.all('SELECT * FROM admin_events').some(e=>e.result==='拒绝'));
});
test('全库动作草稿、审核、发布、下架与历史基线冲突',async t=>{
 const {store,api}=await fixture(t);const m=(await api('admin/v3/data')).moves.find(x=>x.id==='0334'),old=structuredClone(m);
 await api('admin/v3/move-draft',{id:m.id,base:0,value:{...m,name:'侧平举·核对',steps:['测试动作说明']}});assert.equal((await api('catalog')).actions.find(a=>a.id===m.id).name,old.name);
 await api('admin/v3/move-submit',{id:m.id});await api('admin/v3/move-publish',{id:m.id,base:0,reason:'审核通过'});assert.equal((await api('catalog')).actions.find(a=>a.id===m.id).name,'侧平举·核对');
 await api('admin/v3/move-status',{id:m.id,base:0,visible:false,reason:'过期基线'},'owner',409);
 await api('admin/v3/move-status',{id:m.id,base:1,visible:false,reason:'下架核对'});assert.equal((await api('catalog')).actions.find(a=>a.id===m.id).visible,false);
 const h=await api('admin/v3/move-history',{id:m.id});assert.equal(h.length,3);
 await api('admin/v3/move-rollback',{id:m.id,base:2,version:0,reason:'恢复初始'});assert.equal((await api('catalog')).actions.find(a=>a.id===m.id).name,old.name);
});
test('多角色、用户范围、撤权即时失效与最后管理员保护',async t=>{
 const {store,api}=await fixture(t),uid=M.user(store,'person1').id;
 await api('admin/v3/staff-save',{name:'caseworker',display:'个案客服',password:'caseworker-pass-123',roles:['客服'],scope:{users:[uid],scenes:[],environment:'production'},reason:'仅授权一个用户'});
 const login=await api('admin/login',{name:'caseworker',password:'caseworker-pass-123'});const d=await api('admin/v3/data',{},login.token);assert.deepEqual(d.users.map(u=>u.id),[uid]);assert.equal(d.staff,undefined);
 await api('admin/v3/user',{id:uid,sensitive:true,reason:'越权读取'},login.token,403);
 await api('admin/v3/staff-state',{name:'owner',enabled:false,reason:'最后管理员'},'owner',400);
 await api('admin/v3/role-save',{name:'客服',permissions:['logs.view'],reason:'收回用户查看'});await api('admin/v3/data',{},login.token,401);
 const logs=store.all('SELECT * FROM admin_events');assert.ok(!JSON.stringify(logs).includes('caseworker-pass'));
});
test('AI 先落库、失败重试、幂等、精确费用、账单去重与历史单价',async t=>{
 let n=0,storeRef;const {store,api}=await fixture(t,{fetch:async()=>{n++;assert.equal(storeRef.get('SELECT count(*) n FROM model_calls').n,n);return {ok:true,json:async()=>({id:'provider-'+n,usage:{prompt_tokens:n===1?2000:1000,completion_tokens:n===1?500:250},choices:[{message:{content:n===1?'bad json':'[{"id":"rice-white","reason":"合适"}]'}}]})}}});storeRef=store;
 const food=store.content().foods[0];const external=async()=>{n++;assert.equal(store.get('SELECT count(*) n FROM model_calls').n,n);return {ok:true,json:async()=>({id:'provider-'+n,usage:{prompt_tokens:n===1?2000:1000,completion_tokens:n===1?500:250},choices:[{message:{content:n===1?'bad json':JSON.stringify([{id:food.id,reason:'合适'}])}}]})}};
 const cfg={...store.content().ai,maxRetries:1},b={index:1,requestId:'same-business-request'};
 const r=await L.recommend(store,'op:owner',{},b,store.content(),cfg,external,'test','https://api.deepseek.com/chat/completions');assert.equal(r.items.length,1);assert.equal(n,2);
 const again=await L.recommend(store,'op:owner',{},b,store.content(),cfg,external,'test','https://api.deepseek.com/chat/completions');assert.equal(again.generationId,r.generationId);assert.equal(n,2);
 let rows=(await api('admin/ledger/data')).calls.sort((a,b)=>a.seq-b.seq);assert.equal(rows[0].estimate,'0.008000000000');assert.equal(rows[1].estimate,'0.004000000000');assert.equal(rows[0].result,'失败');
 const bill={id:rows[0].id,billId:'unique-bill-line',period:'2026-11',currency:'CNY',amount:'0.008',source:'fixture provider bill',reason:'按请求核对'};await api('admin/ledger/bill',bill);assert.equal((await api('admin/ledger/bill',bill)).duplicate,true);await api('admin/ledger/bill',{...bill,id:rows[1].id},'owner',409);
 store.publish('op:owner','ai',2,{...cfg,pricePerMillionInput:20},'调价');rows=(await api('admin/ledger/data')).calls;assert.ok(rows.every(c=>c.price.pricePerMillionInput===2));assert.equal(store.get('SELECT count(*) n FROM bills').n,1);
 assert.equal(L.amount(L.estimate({prompt_tokens:2000,completion_tokens:500,prompt_cache_hit_tokens:1000},{pricePerMillionInput:2,pricePerMillionCache:1,pricePerMillionOutput:8})),'0.007000000000');
 await api('admin/ledger/period-bill',{billId:'period-total',source:'fixture',period:'2026-11',currency:'CNY',amount:'1',reason:'周期核对'});
 await api('admin/v3/staff-save',{name:'scoped-ai',display:'仅正式环境',password:'local-scoped-ai-pass',roles:['AI 运营'],scope:{users:'all',scenes:[],environment:'production'},reason:'测试范围'});
 const scoped=(await api('admin/login',{name:'scoped-ai',password:'local-scoped-ai-pass'})).token;
 const limited=await api('admin/ledger/data',{},scoped);assert.equal(limited.calls.length,0);assert.equal(limited.bills.length,0);
 await api('admin/usage',{date:'2026-11-18'},scoped,403);
 await api('admin/ledger/period-bill',{billId:'scope-invalid',source:'fixture',period:'2026-11',currency:'CNY',amount:'1',reason:'越权周期核对'},scoped,403);
 assert.equal((await api('admin/ledger/data')).bills.length,2);
 assert.equal((await api('admin/ledger/data',{environment:'production'})).bills.length,0);
});
test('进行中预算预留、未知费用保留与用量回补',async t=>{
 const {store,api}=await fixture(t);let release;const gate=new Promise(r=>release=r),cfg={...store.content().ai,dailyBudget:.04},c=store.content(),food=c.foods[0];
 const first=L.recommend(store,'op:owner',{}, {index:1,requestId:'concurrent-one'},c,cfg,async()=>{await gate;throw Object.assign(Error('timeout'),{name:'TimeoutError'})},'test','https://api.deepseek.com/chat/completions');
 const second=await L.recommend(store,'op:owner',{}, {index:1,requestId:'concurrent-two'},c,cfg,async()=>{throw Error('must not send')},'test','https://api.deepseek.com/chat/completions');assert.match(second.reason,/预算不足/);assert.equal(store.get('SELECT count(*) n FROM model_calls').n,1);release();await first;
 let row=(await api('admin/ledger/data')).calls[0];assert.equal(row.estimate,null);assert.equal(row.billing,'未获得用量');assert.ok(Number(row.reserve)>0);
 await api('admin/ledger/usage',{id:row.id,usage:{prompt_tokens:1000,completion_tokens:250},reason:'服务商回补'});row=(await api('admin/ledger/data')).calls[0];assert.equal(row.estimate,'0.004000000000');assert.equal(row.result,'超时');assert.equal(Number(row.reserve),0);
});
test('新增动作、素材校验、草稿发布及不可删除已发布引用',async t=>{
 const {api}=await fixture(t);const r=await api('admin/v3/move-new',{name:'本地测试动作',part:'全身',steps:['按计划动作执行']});
 await api('admin/v3/media-upload',{data:Buffer.from('<svg>bad</svg>').toString('base64')},'owner',400);
 const bytes=require('node:fs').readFileSync(require('node:path').join(__dirname,'../微信小程序/miniprogram/assets/0334.webp'));
 const media=await api('admin/v3/media-upload',{data:bytes.toString('base64')});const m=(await api('admin/v3/data')).moves.find(m=>m.id===r.id);assert.equal(m.visible,false);
 await api('admin/v3/move-draft',{id:m.id,base:0,value:{...m,visible:true,media:{coverHash:media.hash,animationHash:media.hash}}});await api('admin/v3/move-submit',{id:m.id});
 await api('admin/v3/move-publish',{id:m.id,base:0,reason:'测试发布'});const live=(await api('catalog')).actions.find(a=>a.id===m.id);assert.equal(live.sourceId,m.id);assert.match(live.media.cover,/uploaded\/[a-f0-9]{40}\.webp$/);
 await api('admin/v3/move-delete',{id:m.id,reason:'不允许删除已发布'},'owner',400);
});

test('外币换算、退款与调增调减幂等、原账单保留及超额拒绝',async t=>{
 const {store,api}=await fixture(t),food=store.content().foods[0];
 await L.recommend(store,'person1',{}, {index:1,requestId:'fx-call'},store.content(),store.content().ai,async()=>({ok:true,json:async()=>({usage:{prompt_tokens:1000,completion_tokens:100},choices:[{message:{content:JSON.stringify([{id:food.id}])}}]})}),'test','https://api.deepseek.com/chat/completions');
 const cid=(await api('admin/ledger/data')).calls[0].id;
 const bill={id:cid,billId:'usd-bill',period:'2026-11',currency:'USD',amount:'0.02',rate:'7.123456',rateDate:'2026-11-19',rateSource:'测试汇率依据',source:'测试账单',reason:'外币核对'};
 await api('admin/ledger/bill',{...bill,rateDate:undefined},'owner',400);await api('admin/ledger/bill',bill);assert.equal((await api('admin/ledger/bill',bill)).duplicate,true);
 let rows=await api('admin/ledger/data');assert.equal(rows.calls[0].confirmed,'0.142469120000');assert.equal(rows.bills[0].original,'0.02');assert.equal(rows.bills[0].rate_date,'2026-11-19');
 const a={billId:'usd-bill',adjustmentId:'refund-1',kind:'退款',currency:'USD',amount:'0.005',rate:'7.123456',rateDate:'2026-11-19',rateSource:'同账单汇率',source:'退款凭据',reason:'部分退款'};
 await api('admin/ledger/adjustment',a);assert.equal((await api('admin/ledger/adjustment',a)).duplicate,true);await api('admin/ledger/adjustment',{...a,adjustmentId:'too-much',amount:'1'},'owner',400);
 rows=await api('admin/ledger/data');assert.equal(rows.calls[0].confirmed,'0.106851840000');assert.equal(rows.bills[0].amount,'0.142469120000');assert.equal(rows.adjustments.length,1);
 await api('admin/ledger/adjustment',{...a,adjustmentId:'increase-1',kind:'调增',currency:'CNY',amount:'0.01'});assert.equal((await api('admin/ledger/data')).calls[0].confirmed,'0.116851840000');
 assert.equal(L.amount(L.units('999999999.123456789012')),'999999999.123456789012');
 await api('admin/ledger/funding',{entryId:'balance',kind:'余额快照',currency:'CNY',amount:'100',source:'测试余额',reason:'登记'});rows=await api('admin/ledger/data');assert.equal(rows.funding[0].amount,'100.000000000000');assert.equal(rows.calls[0].confirmed,'0.116851840000');
});

test('备用模型独立价格、响应校验快照与凭据停用',async t=>{
 const {store,api}=await fixture(t);let n=0;const c=store.content(),food=c.foods[0],config={...c.ai,maxRetries:0,fallbackModel:'deepseek-v4-pro',fallbackInput:4,fallbackOutput:12};
 const r=await L.recommend(store,'op:owner',{}, {index:1,requestId:'fallback-case'},c,config,async(_url,opts)=>{n++;const body=JSON.parse(opts.body);assert.equal(body.model,n===1?'deepseek-flash':'deepseek-v4-pro');return {ok:true,json:async()=>({usage:{prompt_tokens:1000,completion_tokens:100},choices:[{message:{content:n===1?'broken':JSON.stringify([{id:food.id}]),reasoning_content:'PRIVATE_THOUGHT_DO_NOT_STORE'}}]})}},'test','https://api.deepseek.com/chat/completions');
 assert.equal(n,2);const rows=(await api('admin/ledger/data')).calls.sort((a,b)=>a.seq-b.seq);assert.equal(rows[1].estimate,'0.005200000000');
 const detail=await api('admin/ledger/detail',{id:r.generationId,reason:'测试核对'});assert.equal(detail.payloads.length,2);assert.ok(!JSON.stringify(detail).includes('PRIVATE_THOUGHT'));assert.equal(detail.payloads[1].validation,'候选编号与最新限制校验通过');
 await api('admin/key-state',{enabled:false,reason:'临时停用'});assert.equal((await api('admin/ai-status')).disabled,true);await api('admin/key-state',{enabled:true,reason:'恢复'});assert.equal((await api('admin/ai-status')).disabled,false);
});

test('器械图片与顺序、扩展动作字段、批量草稿逐条结果',async t=>{
 const {api}=await fixture(t);const bytes=require('node:fs').readFileSync(require('node:path').join(__dirname,'../微信小程序/miniprogram/assets/0334.webp'));const media=await api('admin/v3/media-upload',{data:bytes.toString('base64')});
 await api('admin/v3/taxonomy-save',{kind:'器械',name:'哑铃',base:0,value:{aliases:['dumbbell'],enabled:true,order:3,image:media.url},reason:'核对图片'});const d=await api('admin/v3/data');assert.equal(d.dictionaries[0].value.image,media.url);assert.ok(d.equipment['哑铃']);
 await api('admin/v3/taxonomy-save',{kind:'器械',name:'哑铃',base:1,value:{aliases:[],enabled:false},reason:'仍有引用'},'owner',400);
 const m=d.moves.find(m=>m.id==='0334');await api('admin/v3/move-draft',{id:m.id,base:0,value:{...m,originalName:'Dumbbell lateral raise',secondaryMuscles:['斜方肌'],tips:['控制速度'],optionalGear:['训练凳']}});await api('admin/v3/move-submit',{id:m.id});await api('admin/v3/move-publish',{id:m.id,base:0,reason:'测试完整字段'});
 assert.equal((await api('admin/v3/data')).moves.find(m=>m.id==='0334').originalName,'Dumbbell lateral raise');
 const bulk=await api('admin/complete/move-batch',{ids:['0334','missing-id'],kind:'标签',tags:['基础'],reason:'批量维护'});assert.equal(bulk.results[0].ok,true);assert.equal(bulk.results[1].ok,false);
});

test('历史目标复算不写回、计划条件与活动去重、工单处理授权',async t=>{
 const {store,api}=await fixture(t),uid=M.user(store,'person1').id;let count=0;
 async function mutate(action,body){return api('change',{action,body,rev:store.account('person1').rev,requestId:'detail-request-'+(++count)},'person1')}
 await mutate('profile',{sex:'女',height:165,weight:62.5,targets:{kcal:2000},ratios:[30,40,30],allergens:[],avoid:[],estimate:false});const food=store.content().foods[0];await mutate('saveMeal',{date:'2026-11-19',index:1,version:store.content().version.foods,items:[{id:food.id,locked:150}]});
 const before=JSON.stringify(store.account('person1'));const r=await api('admin/complete/meal-preview',{user:uid,key:'2026-11-19-1',items:[{id:food.id,locked:100}]});assert.equal(r.rows[0].grams,100);assert.equal(JSON.stringify(store.account('person1')),before);
 await api('admin/complete/meal-preview',{user:uid,key:'2026-11-19-1',items:[]},'support',403);
 await api('state',{},'person1');await api('state',{},'person1');assert.equal(store.get('SELECT count(*) n FROM account_activity WHERE owner=?','person1').n,1);
 const input={goal:'增肌',days:3,minutes:30,start:'2026-11-16',gear:['哑铃'],experience:'基础'};await mutate('savePlan',{input,version:store.content().version});assert.equal((await api('admin/v3/data')).users.find(u=>u.id===uid).plans[0].input.experience,'基础');
 store.run("INSERT INTO tickets(owner,kind,detail,status) VALUES('person1','反馈','测试反馈','待处理')");const id=store.get('SELECT max(id) id FROM tickets').id;
 await api('admin/complete/ticket',{id,operation:'处理',reason:'完成排查'},'support',403);await api('admin/complete/ticket',{id,operation:'处理',reason:'完成排查'});assert.equal(store.get('SELECT status FROM tickets WHERE id=?',id).status,'已处理');assert.equal(store.get('SELECT count(*) n FROM ticket_history').n,1);
});

test('注销清理个人快照，保留脱敏费用与处理日志',async t=>{
 const {store,api}=await fixture(t);store.run("INSERT INTO tickets(owner,kind,detail,status) VALUES('person2','注销','测试申请','待处理')");const id=store.get('SELECT max(id) id FROM tickets').id;
 await api('admin/complete/ticket',{id,operation:'注销',confirm:'wrong',reason:'核对申请'},'owner',400);
 await api('admin/complete/ticket',{id,operation:'注销',confirm:String(id),reason:'核对本人申请'});assert.equal(store.get("SELECT * FROM accounts WHERE id='person2'"),undefined);assert.equal(store.get('SELECT status FROM tickets WHERE id=?',id).status,'已处理');assert.ok(store.get("SELECT * FROM admin_events WHERE action='工单注销'"));
});

test('跨周课程、修改前后与实际组数可追溯，发布模板不改旧计划',async t=>{
 const{store,api}=await fixture(t);let seq=0;const mutate=(action,body)=>api('change',{action,body,rev:store.account('person1').rev,requestId:'cross-week-test-'+(++seq)},'person1');
 const input={goal:'增肌',days:3,minutes:30,start:'2026-11-16',gear:['哑铃'],experience:'基础'};await mutate('savePlan',{input,version:store.content().version});const original=store.account('person1').sessions['2026-11-16'];
 await mutate('move',{date:'2026-11-16',to:'2026-11-23'});const item=original.items[1];await mutate('edit',{date:'2026-11-23',key:item.key,sets:2,target:12});await mutate('start',{date:'2026-11-23'});await mutate('record',{date:'2026-11-23',key:item.key,value:10,weight:8});await mutate('finish',{date:'2026-11-23'});
 const after=store.account('person1'),s=after.sessions['2026-11-23'];assert.equal(s.key,original.key);assert.equal(s.actual[item.key][0].value,10);assert.ok(s.startedAt&&s.endedAt);const snapshot=JSON.stringify(after.weeks);store.publish('op:owner','templates',store.content().version.templates,store.content().templates,'新版模板');assert.equal(JSON.stringify(store.account('person1').weeks),snapshot);
 const d=await api('admin/v3/user',{id:M.user(store,'person1').id});const moved=d.events.find(e=>e.action==='move');assert.equal(moved.before.sessions['2026-11-16'].key,moved.after.sessions['2026-11-23'].key);assert.equal((await api('admin/v3/data')).users.find(u=>u.id===M.user(store,'person1').id).history.length,1);
});
test('仅 AI 查看权限不能读取历史单价或保存单价变更',async t=>{
 const{store,api}=await fixture(t);await api('admin/v3/role-save',{name:'AI只读',permissions:['ai.view','ai.edit'],reason:'权限测试'});await api('admin/v3/staff-save',{name:'price-viewer',password:'local-price-test-123',roles:['AI只读'],display:'只读测试',scope:{users:'all',environment:'all',scenes:[]},reason:'权限测试'});const token=store.opLogin('price-viewer','local-price-test-123');const r=await api('admin/inspect',{module:'ai'},token);assert.equal(r.active.pricePerMillionInput,undefined);const old=await api('admin/version',{module:'ai',version:r.version},token);assert.equal(old.pricePerMillionOutput,undefined);await api('admin/draft',{module:'ai',base:r.version,value:{...r.active,pricePerMillionInput:999}},token,403);
});

test('器械目录所有参考图均可加载，静态路径不能越界',async t=>{const {base}=await fixture(t);const images=[...new Set(Object.values(require('../微信小程序/miniprogram/data/catalog').equipmentCatalog).map(x=>x.img))];for(const img of images){const r=await fetch(base+'/'+img);assert.equal(r.status,200,img);assert.equal(r.headers.get('content-type'),img.endsWith('.svg')?'image/svg+xml':'image/jpeg');assert.ok((await r.arrayBuffer()).byteLength>100)}assert.equal((await fetch(base+'/gear/nonexistent.jpg')).status,404)});
