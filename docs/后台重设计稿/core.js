const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const state={viewer:'超级管理员',filters:{},selected:new Set(),staffRole:'业务运营',draftPermissions:null,revealed:new Set(),paused:new Set(),stills:{}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>n===null?'待回补':'¥ '+(n/1000000).toFixed(6);
const findUser=id=>users.find(x=>x.id===id)||users[0];
const move=id=>allMoves.find(x=>x.sourceId===id)||allMoves[0];
const gen=id=>generations.find(x=>x.id===id)||generations[0];
const call=id=>calls.find(x=>x.id===id)||calls[0];
const route=()=>{const [path,q='']=(location.hash.slice(1)||'/users').split('?');const seg=path.split('/').filter(Boolean);return {page:seg[0]||'users',id:seg[1],params:new URLSearchParams(q)}};
const nav=path=>{location.hash=path};
const link=(text,path,cls='')=>`<a class="${cls}" href="#${path}">${esc(text)}</a>`;
const action=(text,a,cls='btn',extra='')=>`<button class="${cls}" data-action="${a}" ${extra}>${text}</button>`;
const badge=(text,tone)=>{const t=tone||(['正常','成功','启用','账单确认','已发布','已保存','成功交付','已完成'].includes(text)?'green':['仅估算','待审核','注销处理中','校验拦截','修改后保存'].includes(text)?'orange':['拒绝','失败','超时','已限制','生成失败','返回结构异常'].includes(text)?'red':'');return `<span class="badge ${t}"><i class="dot"></i>${esc(text)}</span>`};
const title=(h,sub,buttons='')=>`<div class="page-head"><div><h1>${h}</h1><p>${sub}</p></div><div class="actions">${buttons}</div></div>`;
const section=(h,body,extra='',cls='')=>`<section class="section ${cls}">${h?`<div class="section-head"><h2>${h}</h2>${extra}</div>`:''}<div class="section-body">${body}</div></section>`;
const table=(heads,rows)=>`<div class="table-wrap"><table><thead><tr>${heads.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(x=>`<td>${x??'—'}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${heads.length}"><div class="empty"><h2>没有匹配的记录</h2>试试其他关键词，或重置筛选条件。</div></td></tr>`}</tbody></table></div>`;
const kv=(items)=>`<div class="kv-grid">${items.map(([k,v])=>`<div><div class="kv-label">${k}</div><div class="kv-value">${v}</div></div>`).join('')}</div>`;
const kvList=items=>`<div class="kv-list">${items.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
const note=(text,warn=false)=>`<div class="note ${warn?'warn':''}">${text}</div>`;
const identity=u=>`<div class="identity"><span class="avatar">${esc(u.name[0])}</span><div>${link(u.name,'/user/'+u.id)}<span class="sub mono">${u.id}</span></div></div>`;
const tabs=(items,active)=>`<div class="tabs plain">${items.map(([id,name])=>action(name,'tab:'+id,id===active?'on':'')).join('')}</div>`;
const currentTab=fallback=>route().params.get('tab')||fallback;
const filter=()=>state.filters[route().page]||{};
const filterBar=(fields=[],placeholder='搜索名称或编号')=>{const f=filter();return `<form class="filters" id="filter-form"><input name="q" type="search" value="${esc(f.q||'')}" placeholder="${placeholder}" aria-label="搜索">${fields.map(([key,label,values])=>`<select name="${key}" aria-label="${label}"><option value="">${label}</option>${values.map(v=>`<option ${f[key]===v?'selected':''}>${esc(v)}</option>`).join('')}</select>`).join('')}<button type="submit" class="btn primary">查询</button>${action('重置','reset','text-btn')}<span class="right muted">演示记录</span></form>`};
const matches=(s,q)=>!q||String(s).toLowerCase().includes(q.toLowerCase());
const pager=(total,size=10)=>{const f=filter(),page=f.page||1,pages=Math.max(1,Math.ceil(total/size));return `<div class="pagination"><span>共 ${total.toLocaleString()} 条 · 每页 ${size} 条</span><div class="actions">${action('上一页','page:'+(page-1),'',page<=1?'disabled':'')}<span>第 ${page} / ${pages} 页</span>${action('下一页','page:'+(page+1),'',page>=pages?'disabled':'')}</div></div>`};
const paginate=(rows,size=10)=>rows.slice(((filter().page||1)-1)*size,(filter().page||1)*size);
const summary=items=>`<div class="summary-strip">${items.map(([label,value,sub,path])=>`<div class="summary-cell">${path?`<button data-nav="${path}">`:''}<span class="muted">${label}</span><div class="value">${value}</div><small>${sub}</small>${path?'</button>':''}</div>`).join('')}</div>`;
const costs=cs=>({confirmed:cs.filter(c=>c.billing==='账单确认').reduce((s,c)=>s+c.amount,0),pending:cs.filter(c=>c.amount!==null&&c.billing!=='账单确认').reduce((s,c)=>s+c.amount,0),unknown:cs.filter(c=>c.amount===null).length});
const userCalls=id=>calls.filter(c=>gen(c.gen).user===id);
const priceCells=cs=>{const c=costs(cs);return `<span class="money">${money(c.confirmed)}</span><span class="sub">已确认 · 待确认 ${money(c.pending)}${c.unknown?' · '+c.unknown+' 笔未知':''}</span>`};
const permission=(name)=>section('',`<div class="permission"><h2>当前角色无权查看${name}</h2><p>可在右上角切换演示角色，检查不同角色的可见范围和操作权限。</p>${link('返回用户列表','/users','btn')}</div>`);
const can=kind=>state.viewer==='超级管理员'||(roleDefaults[state.viewer]||[]).includes(({cost:'ai.cost',content:'content.edit',ai:'ai.edit',users:'users.view'})[kind]);
function toast(text){$('#toast').textContent=text;clearTimeout(state.tt);state.tt=setTimeout(()=>$('#toast').textContent='',2600)}
function modal(h,body,buttons=''){const d=$('#dialog');d.innerHTML=`<div class="dialog-head"><h2>${h}</h2>${action('关闭','close','text-btn')}</div><div class="dialog-body">${body}</div><div class="dialog-foot">${action('取消','close')}${buttons}</div>`;if(!d.open)d.showModal()}
function log(module,act,obj,before,after,reason='演示操作',result='成功'){audit.unshift({id:'L'+(6100+audit.length+1),time:new Date().toLocaleTimeString('zh-CN',{hour12:false}),who:'林晓',role:state.viewer,module,action:act,object:obj,result,before,after,reason})}
function exportRows(rows,name){const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name+'.csv';a.click();URL.revokeObjectURL(url);log('数据导出','导出记录',name,'',rows.length-1+' 条');toast('已导出演示数据，并记录操作日志')}
const navGroups=[['数据概览',[['overview','运营概览']]],['用户中心',[['users','用户列表'],['favorites','收藏记录'],['plans','训练计划'],['meals','饮食记录']]],['动作库管理',[['moves','全部动作'],['taxonomy','部位、肌群与器械'],['templates','训练模板与规则']]],['AI 中心',[['generations','生成记录'],['calls','调用与消费明细'],['costs','费用统计'],['config','模型与生成配置']]],['系统管理',[['staff','管理人员'],['roles','角色与权限'],['logs','操作日志']]]];
const pageNames=Object.fromEntries(navGroups.flatMap(g=>g[1]));
Object.assign(pageNames,{user:'用户详情',plan:'计划详情',meal:'饮食详情',move:'动作编辑',generation:'生成详情',call:'调用详情',staffdetail:'管理员详情'});
function shell(){const r=route(),parent=({user:'users',plan:'plans',meal:'meals',move:'moves',generation:'generations',call:'calls',staffdetail:'staff'})[r.page]||r.page;$('#sidebar').innerHTML=`<a class="logo" href="#/users"><img src="assets/brand.svg" alt="练哪"><span>管理控制台</span></a><nav class="nav-scroll">${navGroups.map(([g,items])=>`<div class="nav-group">${g}</div>${items.map(([id,label])=>`<a href="#/${id}" class="nav-link ${parent===id?'active':''}">${label}${id==='moves'?'<span class="nav-num">1,324</span>':''}${id==='logs'?'<span class="nav-num">审计</span>':''}</a>`).join('')}`).join('')}</nav><div class="side-foot">后台重设计 · 可点击原型<br><a href="页面总览.html">查看页面总览</a></div>`;$('#breadcrumb').innerHTML=`工作空间 <span style="margin:0 12px">/</span> <b>${pageNames[r.page]||'管理后台'}</b>${r.id?'<span style="margin:0 12px">/</span>'+esc(r.id):''}`}
