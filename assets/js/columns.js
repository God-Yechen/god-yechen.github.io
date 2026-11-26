(() => {
  if(window.__blogColumnsReady) return;
  window.__blogColumnsReady = true;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let observer;
  function openLinkedColumn() {
    if(location.pathname !== '/categories/' || !location.hash) return;
    let id; try { id=decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const section=document.getElementById(id);
    const card=section?.querySelector('[data-column-card]');
    if(card) card.open=true;
  }
  function revealAll() {
    observer?.disconnect();
    document.querySelectorAll('.is-column-pending').forEach(section=>section.classList.remove('is-column-pending'));
  }
  function initialize() {
    observer?.disconnect();
    openLinkedColumn();
    const cards=[...document.querySelectorAll('[data-column-collection] > .column-section, #post-list > .card-wrapper')];
    if(!cards.length) return;
    if(reduced.matches || !('IntersectionObserver' in window) || !Element.prototype.animate) { revealAll(); return; }
    observer=new IntersectionObserver(entries=>{
      let order=0;
      for(const entry of entries) {
        if(!entry.isIntersecting) continue;
        const section=entry.target;
        section.classList.remove('is-column-pending');
        section.dataset.columnRevealed='true';
        observer.unobserve(section);
        section.animate([{opacity:0,transform:'translateY(48px)'},{opacity:1,transform:'translateY(0)'}],{duration:1100,delay:order++*170,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});
      }
    },{threshold:.08,rootMargin:'0px 0px -16px 0px'});
    cards.forEach(section=>{
      if(section.dataset.columnRevealed) return;
      section.classList.add('is-column-pending');observer.observe(section);
    });
  }
  reduced.addEventListener('change',()=>{if(reduced.matches)revealAll();});
  document.addEventListener('click',event=>{
    if(event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const link=event.target.closest('a[href]');if(!link || link.target || location.pathname !== '/categories/') return;
    const url=new URL(link.href,location.href);if(url.origin !== location.origin || url.pathname !== '/categories/' || !url.hash) return;
    try { document.getElementById(decodeURIComponent(url.hash.slice(1)))?.querySelector('[data-column-card]')?.setAttribute('open',''); } catch {}
  },true);
  document.addEventListener('site:content-loaded',initialize);
  window.addEventListener('hashchange',openLinkedColumn);
  initialize();
})();
