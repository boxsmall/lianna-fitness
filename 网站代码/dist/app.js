const legacy=[{"id": "floorpress", "name": "哑铃地板卧推", "part": "胸部", "gear": ["哑铃"], "legacy": true}, {"id": "swim", "name": "俯卧划臂", "part": "背部", "gear": [], "legacy": true}, {"id": "pike", "name": "折刀俯卧撑", "part": "肩部", "gear": [], "legacy": true}, {"id": "plank", "name": "平板支撑", "part": "腹部", "gear": [], "legacy": true}, {"id": "bcurl", "name": "弹力带弯举", "part": "手臂", "gear": ["弹力带"], "legacy": true}];
const allEntries=[...exercises,...legacy];
const app=document.querySelector('#app'), nav=document.querySelector('#nav'), modal=document.querySelector('#equipment');
const schema={gear:gearList,currentGear:gearList,favorites:allEntries.map(e=>e.id)};
function read(key){
 try{const value=JSON.parse(localStorage.getItem('lianna.'+key)||'[]');return new Set(Array.isArray(value)?value.filter(x=>schema[key].includes(x)):[])}catch{return new Set()}
}
let owned=read('gear'), favorites=read('favorites'), selected=new Set(), favoritePart='全部', noticeTimer;
const offsets=new Map();
function notify(message){const el=document.querySelector('#notice');el.textContent=message;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>el.textContent='',1800)}
function save(key,values){try{localStorage.setItem('lianna.'+key,JSON.stringify([...values]));return true}catch{notify('浏览器未允许本地保存');return false}}
function svg(content){return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+content+'</svg>'}
const book=on=>svg('<path fill="'+(on?'currentColor':'none')+'" d="M6 3h12v18l-6-4-6 4z"/>');
const dumb=svg('<path d="M3 9v6m3-9v12m12-12v12m3-9v6M6 12h12"/>');
const placeholder=svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.3"/><path d="m4 17 5-5 4 3 3-3 5 5"/>');
function art(exercise, hero){
 const classes=hero?'art hero':'art';
 if(!exercise.sourceId)return '<div class="'+classes+'" aria-label="暂无动作示意图">'+placeholder+'</div>';
 const folder=hero?'animations':'covers';
 const version=exercise.mediaRevision?'?v='+exercise.mediaRevision:'';
 const description=hero?exercise.name+'动作演示':'';
 return '<img class="'+classes+' move-image" src="moves/'+folder+'/'+exercise.sourceId+'.webp'+version+'" alt="'+description+'" decoding="async"'+(hero?'':' loading="lazy"')+'>';
}
function gearText(e){
 const gear=e.gear.length?e.gear:['徒手'];
 return gear.map(g=>activeGear.has(g)?g:(e.alternatives?.[g]||[]).find(option=>activeGear.has(option))||g).join(' · ');
}
const button=(label,attr,cls='')=>'<button class="'+cls+'" '+attr+'>'+label+'</button>';
const brand='<img src="brand.svg" alt="练哪">';
const navBrand='<span class="nav-brand">'+brand+'</span>';
function row(e){
 const on=favorites.has(e.id);
 const favoriteGroup=e.warmup && e.warmPart && e.warmPart!==e.part
  ? '<small>收藏归入'+e.part+'</small>' : '';
 return '<div class="row">'+button(art(e,false)+'<span><strong>'+e.name+'</strong><small>'+gearText(e)+'</small>'+favoriteGroup+'</span>','data-open="'+e.id+'"','item')+button(book(on),'data-save="'+e.id+'" aria-pressed="'+on+'" aria-label="'+(on?'取消收藏':'收藏')+e.name+'"','bookmark')+'</div>';
}
function setPage(hash){const current=location.hash||'#pick';if(current===hash)return;offsets.set(current,window.scrollY);location.hash=hash}
function tabbar(page){nav.className='bottom';nav.innerHTML=navBrand+[['pick','挑动作',dumb],['saved','我的收藏',book(page==='saved')]].map(([id,title,icon])=>button(icon+title,'data-nav="'+id+'" aria-current="'+(page===id?'page':'false')+'"',page===id?'selected':'')).join('')}
function saved(){const items=allEntries.filter(e=>favorites.has(e.id)), groups=parts.filter(p=>items.some(e=>e.part===p));if(!groups.includes(favoritePart))favoritePart='全部';
 const tabButtons=['全部',...groups].map(p=>button(p,'data-group="'+p+'" aria-pressed="'+(p===favoritePart)+'"',p===favoritePart?'selected':'')).join('');
 const sections=groups.filter(p=>favoritePart==='全部'||p===favoritePart).map(p=>{
  const list=items.filter(e=>e.part===p);
  return '<section class="group"><div class="between"><h2>'+p+'</h2><span class="count">'+list.length+'</span></div><div class="move-grid">'+list.map(row).join('')+'</div></section>';
 }).join('');
 const body=items.length?'<div class="workspace"><aside class="facets saved-facets"><h2>训练部位</h2><div class="tabs">'+tabButtons+'</div></aside><div class="saved-results">'+sections+'</div></div>':'<div class="empty">还没有收藏的动作。<br>'+button('去挑动作','data-nav="pick"','link')+'</div>';
 app.innerHTML='<header><h1>我的收藏</h1>'+brand+'</header>'+body;tabbar('saved')}
function detail(e){
 const on=favorites.has(e.id);
 const info=[['训练部位',e.part],['目标肌群',e.muscle],['器械',gearText(e)]].filter(([,v])=>v);
 const instructions=e.legacy?'<p>早期试用动作，原项目没有可确认的同名条目。</p>':'<ol>'+e.steps.map(t=>'<li>'+t+'</li>').join('')+'</ol><p class="source">'+(e.sourceDescription?'原始条目':'原项目中文说明')+' · 动作 '+e.sourceId+' · <a href="https://github.com/muxuezzz/exercises-dataset-zh-cn/blob/main/locales/zh-CN.js" target="_blank" rel="noopener">来源</a></p>';
 app.innerHTML='<header class="detailhead">'+button('← 返回','data-back','back')+brand+'</header><h1 class="detailTitle">'+e.name+'</h1>'+'<div class="detail-layout"><div class="detail-media">'+art(e,true)+info.map(([k,v])=>'<div class="meta"><b>'+k+'</b><span>'+v+'</span></div>').join('')+'</div><section class="cue"><h2>动作说明</h2>'+instructions+'</section></div>';
 nav.className='bottom detailbar';nav.innerHTML=navBrand+button(book(on)+(on?'已收藏':'加入收藏'),'data-save="'+e.id+'" aria-pressed="'+on+'"','primary')
}
function render(){const hash=location.hash.slice(1), e=hash.startsWith('move/')&&allEntries.find(e=>e.id===hash.split('/')[1]||e.sourceId===hash.split('/')[1]);if(e)detail(e);else if(hash==='saved')saved();else renderPick();
 const tab=app.querySelector('.tabs .selected');
 if(tab){const strip=tab.parentElement;strip.scrollLeft+=tab.getBoundingClientRect().left-strip.getBoundingClientRect().left-(strip.clientWidth-tab.offsetWidth)/2}
 document.title='练哪 · '+(e?e.name:hash==='saved'?'我的收藏':'挑动作')}
document.addEventListener('click',ev=>{const el=ev.target.closest('button');if(!el)return;const d=el.dataset;
 if(d.part){
  if(!selected.delete(d.part))selected.add(d.part);
  if(resultCategory!=='热身')resultCategory='全部';limits.clear();render()
 }
 else if('reset' in d){selected.clear();activeGear.clear();saveGearMode(activeGear);save('currentGear',activeGear);resultCategory='全部';limits.clear();render()}
 else if(d.more){limits.set(d.more,(limits.get(d.more)||initialLimit())+24);render()}
 else if(d.category){resultCategory=d.category;limits.clear();render()}
 else if(d.group){favoritePart=d.group;render()}
 else if('gear' in d)showPicker();
 else if(d.save){const next=new Set(favorites);next.has(d.save)?next.delete(d.save):next.add(d.save);if(save('favorites',next)){favorites=next;render();notify(next.has(d.save)?'已加入收藏':'已取消收藏')}}
 else if(d.open){const from=location.hash||'#pick';offsets.set(from,scrollY);history.pushState({from},'','#move/'+d.open);render();scrollTo(0,0)}
 else if('back' in d){if(history.state?.from)history.back();else setPage('#pick')}
 else if(d.nav)setPage('#'+d.nav)
});
window.addEventListener('hashchange',()=>{render();scrollTo(0,offsets.get(location.hash||'#pick')||0)});
window.addEventListener('storage',()=>{owned=read('gear');activeGear=initialGear();favorites=read('favorites');render()});
if('scrollRestoration' in history)history.scrollRestoration='manual';
