'use strict';
const menu = document.querySelector('.menu-toggle');
if (menu) menu.dataset.telemetry = 'menu_toggle';
menu?.addEventListener('click', () => {
 const open = menu.getAttribute('aria-expanded') !== 'true';
 menu.setAttribute('aria-expanded', String(open));
 document.querySelector('.header').classList.toggle('menu-open', open);
});
document.querySelectorAll('#main-nav a').forEach(link => link.addEventListener('click', () => {
 menu?.setAttribute('aria-expanded','false'); document.querySelector('.header').classList.remove('menu-open');
}));
document.addEventListener('keydown', event => {
 if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
  menu.click(); menu.focus();
 }
});
const scenarios = {
 hello: ['Hi! Is Alex taking on new design projects?', 'Hey there! Alex loves helping thoughtful brands find their voice. What are you working on?', 'A little coffee shop with a big idea ☕'],
 meeting: ['Could I catch up with Alex this week?', 'Of course. What would you like to talk about? I can pass the details to Alex before anything is confirmed.', 'A quick introduction about our project.'],
 question: ['What kind of work does Alex do?', 'Alex helps small businesses with brand identity and thoughtful websites. Tell me a little about what you have in mind.', 'We’re giving our neighbourhood bookshop a fresh start.']
};
document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
 const content = scenarios[button.dataset.scenario];
 if (!content) return;
 document.querySelectorAll('[data-scenario]').forEach(other => { const active = other === button; other.classList.toggle('selected',active); other.setAttribute('aria-pressed',String(active)); });
 ['demo-question','demo-answer','demo-followup'].forEach((id,i) => document.getElementById(id).textContent = content[i]);
 const chat = document.querySelector('.chat-content');chat.classList.remove('changed');requestAnimationFrame(() => chat.classList.add('changed'));
}));
document.querySelectorAll('[data-scenario]').forEach(button => { button.dataset.telemetry = `demo_${button.dataset.scenario}`; });
document.querySelectorAll('.copy').forEach(button => button.addEventListener('click', async () => {
 const block = button.closest('.code'), status = block.querySelector('.copy-status');
 try { await navigator.clipboard.writeText(block.querySelector('code').textContent); button.textContent='Copied!';status.textContent='Commands copied to clipboard.'; }
 catch { const selection = window.getSelection(), range = document.createRange();range.selectNodeContents(block.querySelector('code'));selection.removeAllRanges();selection.addRange(range);button.textContent='Select & copy';status.textContent='Clipboard is unavailable. Commands are selected; use your device’s copy command.'; }
 setTimeout(() => button.textContent='Copy', 2500);
}));
document.querySelectorAll('.copy').forEach(button => { button.dataset.telemetry = 'copy_command'; });
const tabs = [...document.querySelectorAll('[data-tab]')];
tabs.forEach(tab => { tab.dataset.telemetry = `install_${tab.dataset.tab}`; });
function selectTab(tab, focus = false) {
 tabs.forEach(button => {const selected = button === tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
 document.querySelectorAll('[data-panel]').forEach(panel => panel.hidden=panel.dataset.panel!==tab.dataset.tab);
 if (focus) tab.focus();
}
tabs.forEach((tab,index) => {
 tab.addEventListener('click',()=>selectTab(tab));
 tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;if(next!==undefined){event.preventDefault();selectTab(tabs[next],true);}});
});
const search = document.getElementById('docs-search');
search?.addEventListener('input', () => {
 const query=search.value.trim().toLowerCase();let count=0;
 document.querySelectorAll('[data-doc-search]').forEach(link=>{const match=link.dataset.docSearch.toLowerCase().includes(query);link.hidden=!match;if(match)count++;});
 document.querySelectorAll('.doc-group').forEach(group=>group.hidden=![...group.querySelectorAll('a')].some(link=>!link.hidden));
 document.getElementById('no-docs').hidden=count!==0;
 window.youbotTelemetry?.event('ui_interaction',{interaction:'search',control:'search',action:'docs_search',query_state:query?'nonempty':'empty'});
});
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
 const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('in-view');observer.unobserve(entry.target);}}),{threshold:.12});
 document.querySelectorAll('.reveal').forEach(element=>observer.observe(element));
}
const docsToggle=document.querySelector('.docs-toggle');
if (docsToggle) docsToggle.dataset.telemetry = 'docs_toggle';
function toggleGuides(open){document.querySelector('.docs-sidebar')?.classList.toggle('guides-open',open);docsToggle?.setAttribute('aria-expanded',String(open));}
docsToggle?.addEventListener('click',()=>toggleGuides(docsToggle.getAttribute('aria-expanded')!=='true'));
search?.addEventListener('input',()=>{if(search.value.trim())toggleGuides(true);});
