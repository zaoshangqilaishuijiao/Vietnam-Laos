// Preview-only glue; existing gallery/map/menu controllers remain authoritative.
(() => {
 const desktop=()=>matchMedia('(min-width:960px)').matches;
 const shell=document.querySelector('.bk-trip-panel');
 const cow=document.querySelector('[data-guide-floating-toggle]');
 const restoreButton=document.querySelector('[data-bk-panel-restore]');
 const collapseButton=document.querySelector('[data-bk-panel-collapse]');
 const panelViewport=document.querySelector('.itinerary-day-panels');
 const nearbySwitch=document.querySelector('[data-nearby-switch]');
 const offsets={planned:0,nearby:0};
 let showingNearby=false;
 let sidebarOffset=0;
 const syncNearbyView=()=>{
  const next=Boolean(nearbySwitch?.checked);
  if(next!==showingNearby){offsets[showingNearby?'nearby':'planned']=panelViewport.scrollTop;panelViewport.scrollTop=offsets[next?'nearby':'planned'];}
  showingNearby=next;
  document.body.dataset.bkNearby=String(next);
  shell.querySelector('.bk-panel-title').hidden=next;
  shell.querySelector('.bk-nearby-view-heading').hidden=!next;
 };
 const setCollapsed=value=>{
  if(value)sidebarOffset=panelViewport.scrollTop;
  document.body.dataset.bkSidebarCollapsed=String(value);
  restoreButton.hidden=!value;
  cow.setAttribute('aria-label',value?'展开行程面板':'打开快捷工具');
  cow.title=value?'展开行程面板':'打开快捷工具';
  cow.setAttribute('aria-controls',value?'bk-trip-panel':'guide-floating-actions');
  document.dispatchEvent(new CustomEvent('guide:floating-actions-close'));
  if(value)cow.focus({preventScroll:true});
  else {panelViewport.scrollTop=sidebarOffset;collapseButton.focus({preventScroll:true});}
  document.dispatchEvent(new CustomEvent('guide:bk-sidebar'));
  refit();
 };
 shell.id='bk-trip-panel';
 collapseButton.addEventListener('click',()=>setCollapsed(true));
 restoreButton.addEventListener('click',()=>{setCollapsed(false);document.dispatchEvent(new CustomEvent('guide:floating-actions-close'));});
 // First click on a docked cow restores the panel; the usual menu remains available afterwards.
 cow.addEventListener('click',event=>{
  if(document.body.dataset.bkSidebarCollapsed!=='true')return;
  event.preventDefault();event.stopImmediatePropagation();setCollapsed(false);
 },true);
 nearbySwitch?.addEventListener('change',syncNearbyView);
 document.addEventListener('guide:nearby-toggle',syncNearbyView);
 document.addEventListener('guide:map-marker-select',()=>{
  if(document.body.dataset.bkSidebarCollapsed==='true')setCollapsed(false);
  if(nearbySwitch?.checked){nearbySwitch.checked=false;nearbySwitch.dispatchEvent(new Event('change',{bubbles:true}));}
 },true);
 syncNearbyView();
 document.addEventListener('click',event=>{
  const target=event.target.closest('[data-bk-overview-map]');
  if(!target)return;
  const toggle=document.querySelector('[data-travel-toggle]');
  if(document.body.dataset.travelView!=='travel')toggle?.click();
  requestAnimationFrame(()=>document.dispatchEvent(new CustomEvent('guide:focus-place',{detail:{placeId:target.dataset.bkOverviewMap,dayNumber:Number(document.querySelector('[data-day-tab][aria-selected="true"]')?.dataset.dayTab||1),showMarker:true}})));
 });
 // The original scroll follower observes window. The desktop preview has its own scrollport.
 const viewport=document.querySelector('.itinerary-day-panels');
 viewport?.addEventListener('scroll',()=>{
  if(!desktop()||document.body.dataset.travelView!=='travel')return;
  const top=viewport.getBoundingClientRect().top;
  const cards=[...viewport.querySelectorAll('[data-travel-item]')];
  const current=cards.find(c=>c.getBoundingClientRect().bottom>top+100);
  cards.forEach(c=>c.classList.toggle('is-travel-selected',c===current));
 },{passive:true});
 // Refit the real map after switching between document and desktop workspace dimensions.
 let timer;
 const refit=()=>{clearTimeout(timer);timer=setTimeout(()=>{
  if(document.body.dataset.travelView==='travel')document.dispatchEvent(new CustomEvent('guide:day-change',{detail:{dayNumber:Number(document.querySelector('[data-day-tab][aria-selected="true"]')?.dataset.dayTab||1),restorePosition:false}}));
 },180);};
 new MutationObserver(()=>{if(document.body.dataset.travelView!=='travel'&&document.body.dataset.bkSidebarCollapsed==='true')setCollapsed(false);refit();}).observe(document.body,{attributes:true,attributeFilter:['data-travel-view']});
 window.addEventListener('resize',refit,{passive:true});
})();

// Move the same date controller and map between overview and outing containers.
(()=>{
 const root=document.querySelector('#itinerary'),map=root.querySelector('#itinerary-explore');
 const dates=root.querySelector('.itinerary-date-bar'),shell=root.querySelector('.bk-trip-panel');
 const dateSlot=root.querySelector('.ov-date-slot'),mapSlot=root.querySelector('.ov-map-slot');
 const activeDay=()=>Number(root.querySelector('[data-day-tab][aria-selected=true]')?.dataset.dayTab||1);
 const outing=()=>document.body.dataset.travelView==='travel';
 const labels={1:'抵达与暹罗',2:'半马与老城',3:'宅院与河岸'};
 const weatherEngine=document.querySelector('[data-bk-weather-engine]');
 const weatherRefresh=weatherEngine?.querySelector('[data-weather-refresh]');
 const weatherStatus=weatherEngine?.querySelector('[data-weather-status]');
 const weatherCard=weatherEngine?.querySelector('[data-weather-card]');
 const weatherAvailable=()=>{
  const today=new Date();today.setHours(0,0,0,0);
  const start=new Date((weatherCard?.dataset.weatherStartDate||'2026-11-27')+'T00:00:00');
  const end=new Date((weatherCard?.dataset.weatherEndDate||'2026-11-29')+'T23:59:59');
  return (start-today)/86400000<=7&&today<=end;
 };
 const bubble=document.createElement('div');bubble.id='bk-weather-popover';bubble.className='bk-weather-popover';bubble.hidden=true;
 bubble.setAttribute('role','dialog');bubble.setAttribute('aria-label','刷新天气');
 bubble.innerHTML='<button type="button" data-bk-refresh-weather>刷新天气</button><p role="status" aria-live="polite"></p>';
 document.body.append(bubble);let weatherTrigger=null;
 const closeWeather=(focus=false)=>{bubble.hidden=true;weatherTrigger?.setAttribute('aria-expanded','false');if(focus)weatherTrigger?.focus({preventScroll:true});};
 const refreshAction=bubble.querySelector('button');
 const syncWeather=()=>{
  root.querySelectorAll('[data-tab-weather]').forEach(target=>{
   const source=root.querySelector(`[data-day-panel="${target.dataset.tabWeather}"] [data-day-weather]`);
   const text=source?.textContent||'';
   const temperature=text.match(/(-?\d+(?:\.\d+)?)\s*[–—~至]\s*(-?\d+(?:\.\d+)?)\s*°C/);
   const condition=text.split('·')[0].trim();
   const icon=/雷/.test(condition)?'⛈️':/雪/.test(condition)?'🌨️':/雨/.test(condition)?'🌧️':/多云/.test(condition)?'⛅':/阴/.test(condition)?'☁️':/晴/.test(condition)?'☀️':/雾/.test(condition)?'🌫️':'';
   target.hidden=!weatherAvailable();
   target.textContent=temperature?`${icon||'🌡️'} ${temperature[1]}–${temperature[2]}°`:'🌡️';
   target.setAttribute('aria-label',temperature?`${condition} ${temperature[1]}至${temperature[2]}摄氏度`:'刷新当天气温与天气');
  });
  if(!bubble.hidden){refreshAction.disabled=Boolean(weatherRefresh?.disabled);refreshAction.textContent=weatherCard?.classList.contains('is-loading')?'正在刷新…':'刷新天气';bubble.querySelector('p').textContent=weatherStatus?.textContent||'';}
 };
 document.addEventListener('click',event=>{
  const trigger=event.target.closest('[data-tab-weather]');
  if(trigger&&!trigger.hidden){
   event.preventDefault();event.stopPropagation();
   if(weatherTrigger===trigger&&!bubble.hidden){closeWeather();return;}
   closeWeather();weatherTrigger=trigger;bubble.hidden=false;trigger.setAttribute('aria-expanded','true');syncWeather();
   const r=trigger.getBoundingClientRect();bubble.style.left=Math.max(12,Math.min(innerWidth-232,r.right-220))+'px';
   const h=bubble.getBoundingClientRect().height;bubble.style.top=(r.bottom+h+12>innerHeight?Math.max(12,r.top-h-8):r.bottom+8)+'px';
   refreshAction.focus({preventScroll:true});return;
  }
  if(!bubble.contains(event.target))closeWeather();
 });
 refreshAction.addEventListener('click',()=>{if(weatherAvailable()&&weatherRefresh&&!weatherRefresh.disabled){weatherRefresh.click();syncWeather();}});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!bubble.hidden){event.preventDefault();closeWeather(true);}});
 window.addEventListener('resize',()=>closeWeather());
 if(weatherEngine)new MutationObserver(syncWeather).observe(weatherEngine,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','class']});
 root.querySelectorAll('[data-day-weather]').forEach(source=>new MutationObserver(syncWeather).observe(source,{childList:true,characterData:true,subtree:true}));
 let lastMode;
 const updateDay=()=>{
  const day=activeDay();
  root.querySelectorAll('[data-overview-day].ov-day').forEach(n=>n.hidden=Number(n.dataset.overviewDay)!==day);
  shell.querySelector('.bk-panel-title h3').textContent=labels[day];
  syncWeather();
 };
 let layoutTimer;
 const syncLayout=()=>{
  const mode=outing();
  if(mode!==lastMode){
   lastMode=mode;
   if(mode){shell.querySelector('.bk-panel-header').prepend(dates);root.insertBefore(map,shell);}
   else{dateSlot.append(dates);mapSlot.append(map);}
   clearTimeout(layoutTimer);layoutTimer=setTimeout(()=>document.dispatchEvent(new CustomEvent('guide:day-change',{detail:{dayNumber:activeDay(),restorePosition:false}})),160);
  }
  updateDay();
 };
 new MutationObserver(syncLayout).observe(document.body,{attributes:true,attributeFilter:['data-travel-view']});
 document.addEventListener('guide:day-change',updateDay);
 document.addEventListener('click',event=>{
  const trigger=event.target.closest('[data-overview-focus]');if(!trigger)return;
  root.querySelectorAll('.ov-stop-list .is-active').forEach(n=>n.classList.remove('is-active'));
  trigger.closest('li').classList.add('is-active');
  document.dispatchEvent(new CustomEvent('guide:focus-place',{detail:{placeId:trigger.dataset.overviewFocus,dayNumber:activeDay(),showMarker:true}}));
 });
 document.addEventListener('guide:map-marker-select',event=>{
  if(outing())return;
  root.querySelectorAll('.ov-stop-list li').forEach(n=>n.classList.toggle('is-active',n.dataset.overviewPlace===event.detail.placeId));
 });
 const strip=root.querySelector('[data-day-tabs]');
 let down=null,dragged=false,userScrolled=false;
 strip.addEventListener('touchstart',()=>userScrolled=true,{passive:true});
 strip.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')return;down={x:e.clientX,left:strip.scrollLeft};dragged=false;});
 strip.addEventListener('pointermove',e=>{if(!down)return;const dx=e.clientX-down.x;if(Math.abs(dx)>8){dragged=true;userScrolled=true;e.preventDefault();strip.scrollLeft=down.left-dx;}});
 window.addEventListener('pointerup',()=>down=null);
 strip.addEventListener('click',e=>{if(dragged){e.preventDefault();e.stopImmediatePropagation();dragged=false;}},true);
 strip.addEventListener('scrollend',()=>{
  if(!userScrolled||outing()||down||strip.scrollWidth<=strip.clientWidth+2)return;
  userScrolled=false;
  const r=strip.getBoundingClientRect();
  const tabs=[...strip.querySelectorAll('[data-day-tab]')];
  const nearest=tabs.reduce((a,b)=>Math.abs(a.getBoundingClientRect().left+a.clientWidth/2-r.left-r.width/2)<Math.abs(b.getBoundingClientRect().left+b.clientWidth/2-r.left-r.width/2)?a:b);
  if(nearest.getAttribute('aria-selected')!=='true')nearest.click();
 });
 syncLayout();
})();

// Keep the reference album as tall as the current photo and its caption.
(() => {
 document.querySelectorAll('.travel-photo-reference .travel-photo-track').forEach(track => {
  const slides = [...track.children];
  let pending = false;
  const fit = () => {
   pending = false;
   if (!track.clientWidth) return;
   const index = Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
   const height = Math.ceil(slides[index]?.getBoundingClientRect().height || 0);
   if (height && Math.abs(track.clientHeight - height) > 1) track.style.height = height + 'px';
  };
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(fit); } };
  track.addEventListener('scroll', schedule, {passive:true});
  const observer = new ResizeObserver(schedule);
  observer.observe(track);
  slides.forEach(slide => observer.observe(slide));
  schedule();
 });
})();
