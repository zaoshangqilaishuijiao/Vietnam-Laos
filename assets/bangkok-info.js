(()=>{
 const root=document.querySelector('#recommendations');
 const cards=[...root.querySelectorAll('[data-demo-kind]')];
 const overall=root.querySelector('.local-experience-heading small');
 const total=cards.length+root.querySelectorAll('.local-knowledge-card').length;
 root.querySelectorAll('[data-demo-category]').forEach(button=>button.addEventListener('click',()=>{
  const kind=button.dataset.demoCategory;
  root.querySelectorAll('[data-demo-category]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  cards.forEach(card=>card.hidden=kind!=='全部'&&card.dataset.demoKind!==kind);
  root.querySelectorAll('.recommendation-module').forEach(group=>{
   const items=[...group.querySelectorAll('[data-demo-kind]')];
   const shown=items.filter(c=>!c.hidden).length;
   group.hidden=kind!=='全部'&&!shown;
   const count=group.querySelector('h3 small');if(count)count.textContent=(kind==='全部'?(items.length||group.querySelectorAll('.local-knowledge-card').length):shown)+' 项';
  });
  overall.textContent=kind==='全部'?total+' 项':cards.filter(c=>!c.hidden).length+' / '+total+' 项';
 }));
 const checklist=document.querySelector('[data-checklist-items]');
 const syncHeadings=()=>{
  checklist.querySelectorAll('.info-check-group').forEach(h=>{let next=h.nextElementSibling,shown=false;while(next&&!next.classList.contains('info-check-group')){if(next.matches('.guide-checklist-item')&&!next.hidden&&getComputedStyle(next).display!=='none')shown=true;next=next.nextElementSibling;}if(h.hidden===shown)h.hidden=!shown;});
 };
 new MutationObserver(syncHeadings).observe(checklist,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','style']});
 syncHeadings();
 document.querySelector('[data-demo-copy-address]')?.addEventListener('click',async()=>{const text=document.querySelector('.info-address').textContent;try{await navigator.clipboard.writeText(text);document.querySelector('[data-demo-copy-status]').textContent='地址已复制';}catch{document.querySelector('[data-demo-copy-status]').textContent=text;}});
 const revealAnchor=()=>{
  const id=decodeURIComponent(location.hash.slice(1));if(!id||id.startsWith('guide-share='))return;
  const target=document.getElementById(id);if(!target)return;
  if(target.closest('[data-demo-kind]'))root.querySelector('[data-demo-category="全部"]')?.click();
  for(let p=target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
 };
 window.addEventListener('hashchange',revealAnchor);revealAnchor();
 document.addEventListener('click',event=>{
  const link=event.target.closest('a[href^="#"]');if(!link)return;
  const target=document.getElementById(link.hash.slice(1));if(!target)return;
  if(target.closest('[data-demo-kind]'))root.querySelector('[data-demo-category="全部"]')?.click();
  for(let p=target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
 });
 document.querySelectorAll('[data-demo-category]').forEach(button=>{const kind=button.dataset.demoCategory;if(kind!=='全部'&&!cards.some(c=>c.dataset.demoKind===kind))button.hidden=true;});
})();

// Keep dates compact; show the day's weather beside its summary or outing title.
(()=>{
 const root=document.querySelector('#itinerary'),title=root?.querySelector('.bk-panel-title');if(!root||!title)return;
 const weather=[...root.querySelectorAll('.ov-tab-shell > [data-tab-weather]')];
 weather.forEach(button=>{const meta=root.querySelector(`.ov-day[data-overview-day="${button.dataset.tabWeather}"] .ov-day-meta`);if(meta){button.classList.add('info-day-weather');meta.append(button);}});
 const current=weather[0]?.cloneNode(true);if(!current)return;current.classList.add('info-title-weather');current.setAttribute('aria-expanded','false');title.append(current);
 const sync=()=>{
  const selected=root.querySelector('[data-day-tab][aria-selected="true"]');const day=selected?.dataset.dayTab||'1',source=weather.find(n=>n.dataset.tabWeather===day);if(!source)return;
  current.dataset.tabWeather=day;current.textContent=source.textContent;current.hidden=source.hidden;current.setAttribute('aria-label',source.getAttribute('aria-label'));
 };
 const observer=new MutationObserver(sync);weather.forEach(n=>observer.observe(n,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-label']}));
 root.querySelectorAll('[data-day-tab]').forEach(n=>observer.observe(n,{attributes:true,attributeFilter:['aria-selected']}));
 document.addEventListener('guide:day-change',sync);sync();
})();
