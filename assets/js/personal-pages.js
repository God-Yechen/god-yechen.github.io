(() => {
  if (window.__personalPages) return;
  window.__personalPages = true;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs = {}, text) => {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const point = ([lon, lat]) => [250 + (lon - 73) * 13.6, 80 + (merc(54) - merc(lat)) * 710 / (merc(54) - merc(3))];
  async function initMap() {
    const root = document.querySelector('[data-footprints]');
    if (!root || root.dataset.initialized) return;
    root.dataset.initialized = 'true';
    const container = root.querySelector('.travel-map');
    try {
      const records = JSON.parse(root.querySelector('[data-footprints-data]').textContent);
      const response = await fetch(root.dataset.mapUrl);
      if (!response.ok) throw new Error('map');
      const geo = await response.json();
      if (!root.isConnected) return;
      const svg = el('svg', { viewBox:'0 0 1400 1000', role:'group', 'aria-label':'中国省级区划与个人足迹地图' });
      const defs = el('defs');
      const arrow = el('marker', { id:'travel-arrow', viewBox:'0 0 10 10', refX:9, refY:5, markerWidth:5, markerHeight:5, orient:'auto-start-reverse' });
      arrow.append(el('path', { d:'M0 0L10 5L0 10Z', fill:'#91ad98' })); defs.append(arrow); svg.append(defs);
      const shapes = el('g'), leaders = el('g'), dots = el('g'), callouts = el('g');
      svg.append(shapes, leaders, dots, callouts);
      const groups = new Map();
      const choose = code => {
        for (const [key, group] of groups) for (const node of group) node.classList.toggle('is-selected', key === code);
        const r = records.find(row => String(row.code) === code);
        root.querySelector('.map-selection').textContent = `${r.name} · ${r.capital}｜去过的城市：${r.cities.length ? r.cities.join('、') : '暂未记录'}`;
      };
      const features = geo.features.filter(f => f.properties.name);
      for (const feature of geo.features) {
        const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
        const d = polygons.map(poly => poly.map(ring => ring.map((p, i) => (i ? 'L' : 'M') + point(p).map(n => n.toFixed(2)).join(',')).join('') + 'Z').join('')).join('');
        const code = String(feature.properties.adcode);
        const record = records.find(r => String(r.code) === code);
        const path = el('path', {d, 'fill-rule':'evenodd', class:record ? 'travel-province' + (record.cities.length ? ' has-cities' : '') : 'travel-boundary'});
        if (record) { path.append(el('title', {}, `${record.name} · ${record.capital}`)); path.addEventListener('click', () => choose(code)); groups.set(code, [path]); }
        shapes.append(path);
      }
      // Distribute labels geographically on the two sides, leaving the country outline intact.
      const ordered = [...features].sort((a,b) => (a.properties.centroid || a.properties.center)[0] - (b.properties.centroid || b.properties.center)[0]);
      for (const [side, sideFeatures] of [[0,ordered.slice(0,17)],[1,ordered.slice(17)]]) {
        sideFeatures.sort((a,b) => (b.properties.centroid || b.properties.center)[1] - (a.properties.centroid || a.properties.center)[1]);
        sideFeatures.forEach((f,i) => {
          const code = String(f.properties.adcode), r = records.find(row => String(row.code) === code);
          const [cx,cy] = point(f.properties.centroid || f.properties.center);
          const x = side ? 1195 : 10, y = 38 + i*55, edge = side ? x : x+195;
          const leader = el('path', {d:`M${cx},${cy} Q${(cx+edge)/2},${cy} ${edge},${y+22}`, class:'travel-leader', 'marker-end':'url(#travel-arrow)'});
          leaders.append(leader);
          const group = el('g', {class:'travel-callout', tabindex:0, role:'button', 'aria-label':`${r.name}，${r.capital}，去过的城市：${r.cities.join('、') || '暂未记录'}`});
          group.append(el('rect', {x,y,width:195,height:47,rx:8}),el('text',{x:x+10,y:y+20,class:'travel-callout-name'},r.name.replace('特别行政区','').replace('维吾尔自治区','').replace('壮族自治区','').replace('回族自治区','').replace('自治区','')));
          const cityText = r.cities.join('、') || '待记录';
          group.append(el('text',{x:x+10,y:y+38,class:'travel-callout-cities'},cityText.length > 12 ? cityText.slice(0,11)+'…' : cityText));
          group.addEventListener('click', () => choose(code));
          group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(code); } });
          callouts.append(group); groups.get(code).push(leader,group);
          const [px,py] = point(f.properties.center);
          dots.append(el('circle',{cx:px,cy:py,r:3,class:'travel-capital'}));
          let dx=5, dy=-6;
          if (code==='810000') { dx=9; dy=-12; }
          if (code==='820000') { dx=-30; dy=16; }
          if (code==='130000') { dx=-45; dy=12; }
          if (code==='120000') { dx=8; dy=12; }
          dots.append(el('text',{x:px+dx,y:py+dy,class:'travel-capital-label'},r.capital));
        });
      }
      container.replaceChildren(svg); container.setAttribute('aria-busy','false');
      const scroller = root.querySelector('.travel-map-scroll');
      scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
      const cities = new Set(records.flatMap(r => r.cities));
      root.querySelector('[data-city-count]').textContent = cities.size;
      root.querySelector('[data-province-count]').textContent = records.filter(r => r.cities.length).length;
      if (cities.size) { root.querySelector('.personal-muted').textContent = '每一站，都值得记下来'; root.querySelector('.map-selection').textContent = '点击省份或侧边标注，查看这一站的城市。'; }
    } catch (_) {
      container.setAttribute('aria-busy','false');
      const error = document.createElement('p'); error.className='map-loading'; error.textContent='地图暂时未能加载，请稍后重新打开。'; container.replaceChildren(error);
    }
  }
  function init() {
    const trigger = document.querySelector('[data-personal-menu]');
    if (trigger && !trigger.dataset.initialized) {
      trigger.dataset.initialized = 'true';
      const dialog = document.getElementById('personal-menu-dialog');
      trigger.addEventListener('click', event => { event.preventDefault(); if (!dialog.open) dialog.showModal(); });
      trigger.addEventListener('keydown', event => { if (event.key === ' ') { event.preventDefault(); trigger.click(); } });
    }
    initMap();
  }
  init(); document.addEventListener('site:content-loaded',init);
})();
