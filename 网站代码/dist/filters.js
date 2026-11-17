function initialGear(){
 try{
  const cached=localStorage.getItem('lianna.currentGear');
  if(cached!==null){
   const gear=new Set([...read('currentGear')].filter(g=>owned.has(g)));
   // Earlier versions used an empty saved selection for bodyweight-only training.
   if(!gear.size && localStorage.getItem('lianna.gearMode')!=='all')gear.add('徒手');
   return gear;
  }
 }catch{}
 return new Set(owned);
}
let activeGear=initialGear(), resultCategory='全部';
const limits=new Map();
const training=exercises.filter(e=>!e.warmup);
const muscleOf=e=>e.muscle;
const requirements=e=>e.gear.length?e.gear:['徒手'];
function optionsFor(e,g){return [g,...(e.alternatives?.[g]||[])]}
function gearMatches(e){
 return !activeGear.size || requirements(e).every(g=>optionsFor(e,g).some(option=>activeGear.has(option)));
}
function partMatches(e){return !selected.size||selected.has(e.part)}
function warmMatches(e){return !selected.size||selected.has(e.warmPart)||selected.has(e.part)}
function canPickPart(p){
 if(resultCategory==='热身')return exercises.some(e=>e.warmup&&(e.part===p||e.warmPart===p));
 return !activeGear.size||training.some(e=>e.part===p&&gearMatches(e));
}
function partSection(){
 const buttons=parts.map(p=>button(p,'data-part="'+p+'" aria-pressed="'+selected.has(p)+'" '+(!selected.has(p)&&!canPickPart(p)?'disabled':''),selected.has(p)?'selected':'')).join('');
 return '<section class="section"><div class="between"><h2>训练部位</h2>'+((selected.size||activeGear.size||resultCategory!=='全部')?button('清空筛选','data-reset','link'):'')+'</div><div class="choose">'+buttons+'</div></section>';
}
function initialLimit(){return resultCategory==='全部'?6:24}
function renderPick(){
 const matches=training.filter(e=>partMatches(e)&&gearMatches(e));
 const warm=exercises.filter(e=>e.warmup&&warmMatches(e));
 const clusters=new Map();
 if(warm.length)clusters.set('热身',warm);
 for(const e of matches){
  if(!clusters.has(e.muscle))clusters.set(e.muscle,[]);
  clusters.get(e.muscle).push(e);
 }
 // Warmups have a target muscle too. Include them in a specific muscle view only once.
 const targets=[...new Set([...matches,...warm].map(muscleOf))];
 const categories=['全部',...(warm.length?['热身']:[]),...targets];
 if(!categories.includes(resultCategory))resultCategory='全部';
 const tabs=categories.map(p=>button(p,'data-category="'+p+'" aria-pressed="'+(p===resultCategory)+'"',p===resultCategory?'selected':'')).join('');
 const visible=resultCategory==='全部'?[...clusters]:resultCategory==='热身'?[['热身',warm]]:[[resultCategory,[...matches,...warm].filter(e=>e.muscle===resultCategory)]];
 const sections=visible.map(([group,list])=>{
  const limit=limits.get(group)||initialLimit();
  return '<section class="group"><div class="between"><h3>'+group+'</h3><span class="count">'+list.length+'</span></div>'+(group==='热身'?'<p class="hint">按部位推荐，不限器械</p>':'')+'<div class="move-grid">'+list.slice(0,limit).map(row).join('')+'</div>'+(list.length>limit?button('再看 '+Math.min(24,list.length-limit)+' 个动作','data-more="'+group+'"','more link'):'')+'</section>';
 }).join('');
 app.innerHTML='<header><h1>挑动作</h1>'+brand+'</header><div class="workspace"><aside class="facets" aria-label="训练筛选">'+partSection()+
 '<section class="section"><div class="between"><h2>我的器械</h2>'+button('选择器械 ＋','data-gear','link')+'</div><div class="gearline">'+([...activeGear].join(' · ')||'不限器械')+'</div></section></aside>'+
 '<section class="results"><div class="between"><h2>匹配动作</h2><span class="count">'+visible.reduce((n,[,a])=>n+a.length,0)+' 个动作</span></div><div class="tabs">'+tabs+'</div>'+
 sections+(!matches.length&&resultCategory==='全部'?'<div class="empty">当前组合暂无正式动作。可添加动作搭配使用的器械，或选择不限器械。<br>'+button('调整器械','data-gear','link')+'</div>':'')+'</section></div>';
 tabbar('pick');
}
const availableFor=list=>new Set(list.flatMap(e=>requirements(e).flatMap(g=>optionsFor(e,g))));
const catalogMatches=availableFor(training);
const gearSearch=modal.querySelector('#gear-search'),groupSelect=modal.querySelector('#gear-group');
const groupOrder=['自由重量与负重','架、凳与训练站','上肢力量','下肢力量','躯干与核心','有氧器械','功能训练与配件','绳索把手与配件','其他训练方式'];
groupSelect.innerHTML=['全部分类',...groupOrder].map(s=>'<option>'+s+'</option>').join('');
let draftGear,draftOwned,pickerTab,allowed;
function updateGearCount(){
 const inventory=pickerTab==='owned';
 modal.querySelector('#gear-count').textContent=inventory?'已拥有 '+draftOwned.size+' 项':draftGear.size?'本次已选 '+draftGear.size+' 项':'本次不限器械';
 modal.querySelector('#unlimit').hidden=inventory||!draftGear.size;
}
function drawGear(){
 const inventory=pickerTab==='owned', choices=inventory?draftOwned:draftGear;
 const query=gearSearch.value.trim().toLowerCase();
 const html=groupOrder.filter(group=>groupSelect.selectedIndex===0||groupSelect.value===group).map(group=>{
  const names=gearList.filter(g=>{
   const entry=equipmentCatalog[g];return entry.group===group && (g+' '+entry.aliases).toLowerCase().includes(query);
  });
  if(!names.length)return '';
  return '<fieldset><legend>'+group+'</legend><div class="geargrid">'+names.map(g=>{
   const item=equipmentCatalog[g],disabled=!inventory&&!choices.has(g)&&!allowed.has(g);
   const note=!catalogMatches.has(g)?'原库暂无正式动作':disabled?'当前条件不匹配':'';
   return '<label class="tile '+(disabled?'unavailable':'')+'"><input type="checkbox" value="'+g+'" '+(choices.has(g)?'checked ':'')+(disabled?'disabled':'')+'><img src="'+item.img+'" alt="'+g+'外观参考" loading="lazy"><span>'+g+'</span>'+(note?'<small>'+note+'</small>':'')+'</label>';
  }).join('')+'</div></fieldset>';
 }).join('');
 modal.querySelector('#options').innerHTML=html||'<p class="empty">没有找到这种器械，试试其他名称。</p>';
 for(const b of modal.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===pickerTab));
 modal.querySelector('#gear-help').textContent=inventory?'器械清单保存在此浏览器。':'可多选。需要搭配的器械请一并勾选。';
 updateGearCount();
}
function showPicker(){
 allowed=availableFor(training.filter(e=>partMatches(e)&&(resultCategory==='全部'||resultCategory==='热身'||e.muscle===resultCategory)));
 draftOwned=new Set(owned);draftGear=new Set(activeGear);pickerTab='current';
 groupSelect.selectedIndex=0;gearSearch.value='';drawGear();modal.showModal();modal.querySelector('#options').scrollTop=0;
}
gearSearch.addEventListener('input',drawGear);
gearSearch.addEventListener('keydown',event=>{
 if(event.key==='Enter'&&!event.isComposing){event.preventDefault();gearSearch.blur()}
});
groupSelect.addEventListener('change',drawGear);
modal.addEventListener('change',ev=>{
 const input=ev.target;if(input.type!=='checkbox')return;
 const g=input.value;
 if(pickerTab==='owned'){
  if(input.checked){draftOwned.add(g);if(allowed.has(g))draftGear.add(g)}
  else{draftOwned.delete(g);draftGear.delete(g)}
 }else if(input.checked){draftGear.add(g);draftOwned.add(g)}else draftGear.delete(g);
 if(pickerTab==='current'&&!input.checked&&!allowed.has(g))drawGear();
 else updateGearCount();
});
modal.addEventListener('click',ev=>{
 const mode=ev.target.closest('[data-mode]');
 if(mode){pickerTab=mode.dataset.mode;drawGear();modal.querySelector('#options').scrollTop=0}
 if(ev.target.id==='unlimit'){draftGear.clear();drawGear()}
 if(ev.target===modal)modal.close();
});
function saveGearMode(gear){
 try{localStorage.setItem('lianna.gearMode',gear.size?'selected':'all')}catch{}
}
modal.querySelector('form').addEventListener('submit',ev=>{
 if(ev.submitter?.value!=='save')return;
 if(!save('gear',draftOwned)||!save('currentGear',draftGear)){ev.preventDefault();return}
 owned=draftOwned;activeGear=draftGear;saveGearMode(activeGear);limits.clear();render();notify('器械已更新');
});
