/* Bergtagebuch Web – Oberfläche: Gerüst, Dialoge, Tagebuch, Detail, Karte, Foto-Viewer */
'use strict';

const S = { tours: [], activities: [], regions: [], tab: 'diary', filter: { q: '', year: '', act: '', sort: 'date' }, mapStyle: 'topo', mapFilter: 'none', statYear: '' };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

/* ------------------------------------------------------------------ Daten laden */
async function loadAll() {
  S.tours = await DB.all('tours');
  S.activities = await DB.kvGet('activities', null);
  if (!S.activities) { S.activities = DEFAULT_ACTIVITIES.map(a => ({ ...a })); await DB.kvSet('activities', S.activities); }
  S.regions = await DB.kvGet('regions', null);
  if (!S.regions) { S.regions = DEFAULT_REGIONS.map(r => ({ ...r })); await DB.kvSet('regions', S.regions); }
  S.mapStyle = await DB.kvGet('mapStyle', 'topo');
  S.mapFilter = await DB.kvGet('mapFilter', 'none');
}
const actById = id => S.activities.find(a => a.id === id) || { id: 0, name_de: '?', icon: '❔', color: '#546E7A', scales: 'FREE' };
const regById = id => S.regions.find(r => r.id === id);
const tourById = id => S.tours.find(t => t.id === id);
function allPersons() {
  const m = {};
  S.tours.forEach(t => (t.persons || []).forEach(p => { m[p] = (m[p] || 0) + 1; }));
  return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(e => ({ name: e[0], count: e[1] }));
}
function years() { return [...new Set(S.tours.map(t => (t.date || '').slice(0, 4)).filter(Boolean))].sort().reverse(); }

/* Vorschaubilder als Objekt-URLs zwischenspeichern */
const ThumbCache = new Map();
async function thumbUrl(photoId, full = false) {
  if (!photoId) return '';
  const key = photoId + (full ? 'f' : 't');
  if (ThumbCache.has(key)) return ThumbCache.get(key);
  const p = await DB.get('photos', photoId);
  if (!p) return '';
  const url = URL.createObjectURL(full ? p.blob : p.thumb);
  ThumbCache.set(key, url);
  return url;
}
function dropThumbs(ids) { ids.forEach(id => ['t', 'f'].forEach(s => { const u = ThumbCache.get(id + s); if (u) { URL.revokeObjectURL(u); ThumbCache.delete(id + s); } })); }

/* ------------------------------------------------------------------ Dialoge, Meldungen */
let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}
function dialog({ title = '', text = '', html = '', buttons = [{ label: 'OK', value: true }], onOpen, dismiss = true }) {
  return new Promise(resolve => {
    const ovl = h(`<div class="ovl"><div class="dlg">${title ? `<h3>${esc(title)}</h3>` : ''}
      <div class="body ${html ? 'html' : ''}">${html || esc(text)}</div>
      <div class="btns">${buttons.map((b, i) => `<button class="btn ${b.cls || (i < buttons.length - 1 ? 'sec2' : '')}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div></div>`);
    const close = v => { ovl.remove(); resolve(v); };
    ovl.addEventListener('click', e => { if (e.target === ovl && dismiss) close(null); });
    $$('.btns button', ovl).forEach(b => b.onclick = async () => {
      const btn = buttons[+b.dataset.i];
      if (btn.check) { const ok = await btn.check(ovl); if (!ok) return; }
      close(typeof btn.value === 'function' ? btn.value(ovl) : btn.value);
    });
    document.body.appendChild(ovl);
    if (onOpen) onOpen(ovl, close);
  });
}
const alertBox = (text, title = '') => dialog({ title, text, buttons: [{ label: 'OK', value: true }] });
const confirmBox = (text, yes, title = '', danger = false) => dialog({ title, text, buttons: [{ label: T('cancel'), value: false }, { label: yes || 'OK', value: true, cls: danger ? 'danger' : '' }] });
function choose(title, options) {
  const html = options.map((o, i) => `<button class="opt ${o.sel ? 'sel' : ''}" data-i="${i}">${o.icon ? `<span style="font-size:22px">${o.icon}</span>` : ''}<span>${esc(o.label)}</span></button>`).join('');
  return dialog({ title, html, buttons: [{ label: T('cancel'), value: null, cls: 'sec2' }], onOpen: (ovl, close) => {
    $$('.opt', ovl).forEach(b => b.onclick = () => close(options[+b.dataset.i].value));
  } });
}
function busy(msg) {
  const el = h(`<div class="busy"><div><span class="spin"></span><span class="m">${esc(msg)}</span></div></div>`);
  document.body.appendChild(el);
  return { set: m => { $('.m', el).textContent = m; }, close: () => el.remove() };
}
function pickFiles(accept, multiple) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple;
    inp.style.display = 'none';
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    document.body.appendChild(inp);
    inp.click();
  });
}
function fill(s, vars) { return String(s).replace(/\{(\w+)\}/g, (m, k) => vars[k] !== undefined ? vars[k] : m); }

/* ------------------------------------------------------------------ Seiten und Navigation */
const Stack = [];
function makePage({ title, back = false, actions = '', nopad = false }) {
  const el = h(`<section class="page"><header class="bar">${back ? '<button class="ib back" aria-label="back">‹</button>' : ''}<h1>${esc(title)}</h1>${actions}</header>
    <div class="content ${nopad ? 'nopad' : ''}"></div></section>`);
  if (back) { const b = $('.back', el); b.style.fontSize = '34px'; b.onclick = () => history.back(); }
  return { el, content: $('.content', el), bar: $('.bar', el) };
}
/* Seite über die Tabs legen; beforeClose kann das Schließen verhindern (z. B. ungespeicherte Änderungen) */
function pushPage(pg, { onClose, beforeClose } = {}) {
  pg.el.classList.add('pushed');
  $('#app').appendChild(pg.el);
  Stack.push({ pg, onClose, beforeClose });
  history.pushState({ depth: Stack.length }, '');
}
function closeTop() { history.back(); }
async function handlePop() {
  if ($('.viewer')) return; // der Foto-Viewer behandelt das selbst
  const top = Stack[Stack.length - 1];
  if (!top) return;
  if (top.beforeClose) {
    const ok = await top.beforeClose();
    if (!ok) { history.pushState({ depth: Stack.length }, ''); return; }
  }
  Stack.pop();
  top.pg.el.remove();
  if (top.onClose) top.onClose();
}
window.addEventListener('popstate', handlePop);
/* Seite ohne Zurück-Animation schließen (nach Speichern) */
function popSilently() { const top = Stack[Stack.length - 1]; if (top) top.beforeClose = null; history.back(); }

const TABS = [['diary', '📖', 'tab_diary'], ['map', '🗺️', 'tab_map'], ['stats', '📊', 'tab_stats'], ['more', '☰', 'tab_more']];
function buildTabs() {
  $('#tabs').innerHTML = TABS.map(t => `<button data-t="${t[0]}" class="${S.tab === t[0] ? 'sel' : ''}"><span>${t[1]}</span>${esc(T(t[2]))}</button>`).join('');
  $$('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.t));
}
function showTab(name) {
  S.tab = name;
  $$('#tabs button').forEach(b => b.classList.toggle('sel', b.dataset.t === name));
  renderTab();
}
function renderTab() {
  const v = $('#views');
  if (S.tab !== 'map' && MapView.map) { MapView.map.remove(); MapView.map = null; }
  v.innerHTML = '';
  ({ diary: renderDiary, map: renderMap, stats: renderStats, more: renderMore })[S.tab](v);
}
/* nach Änderungen an Touren: alles neu zeichnen, was sichtbar ist */
async function refreshAll() {
  S.tours = await DB.all('tours');
  renderTab();
}

/* ------------------------------------------------------------------ Tagebuch */
function tourNums(t) {
  const a = [];
  if (t.ascent) a.push('↑ ' + fmtInt(t.ascent) + ' m');
  if (t.distance) a.push(fmtKm(t.distance) + ' km');
  if (t.duration) a.push(fmtDuration(t.duration));
  const top = (t.summits && t.summits.length) ? Math.max(...t.summits.map(s => s.alt || 0)) : (t.summitAlt || 0);
  if (top) a.push('▲ ' + fmtInt(top) + ' m');
  return a.join(' · ');
}
function filteredTours() {
  const f = S.filter, q = f.q.trim().toLowerCase();
  let list = S.tours.filter(t => {
    if (f.year && !(t.date || '').startsWith(f.year)) return false;
    if (f.act && String(t.activityId) !== f.act) return false;
    if (q) {
      const reg = regById(t.regionId);
      const hay = [t.title, t.start, t.description, t.features, t.conditions, (t.persons || []).join(' '), (t.summits || []).map(s => s.name).join(' '), reg ? pickName(reg) : ''].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const by = { date: (a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id,
    ascent: (a, b) => (b.ascent || 0) - (a.ascent || 0), distance: (a, b) => (b.distance || 0) - (a.distance || 0),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || (b.date || '').localeCompare(a.date || '') };
  return list.sort(by[f.sort] || by.date);
}
function renderDiary(v) {
  const pg = makePage({ title: T('app_name'), actions: `<button class="ib" id="hlp" aria-label="help">?</button>` });
  v.appendChild(pg.el);
  $('#hlp', pg.el).onclick = () => openHelp();
  const c = pg.content;
  const wrap = h('<div class="wrap"></div>'); c.appendChild(wrap);
  const fab = h('<button class="fab" aria-label="new">+</button>');
  fab.onclick = () => openEdit(null);
  pg.el.appendChild(fab);
  installHint(wrap);
  if (!S.tours.length) {
    wrap.insertAdjacentHTML('beforeend', `<div class="empty"><span class="big">🏔️</span>${esc(T('diary_empty'))}</div>`);
    return;
  }
  const yrs = years();
  wrap.insertAdjacentHTML('beforeend', `<div class="search"><input class="inp" type="search" id="q" placeholder="${esc(T('search_hint'))}" value="${esc(S.filter.q)}"></div>
    <div class="filters">
      <select class="inp" id="fy"><option value="">${esc(T('all_years'))}</option>${yrs.map(y => `<option ${S.filter.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <select class="inp" id="fa"><option value="">${esc(T('all_activities'))}</option>${S.activities.filter(a => S.tours.some(t => t.activityId === a.id)).map(a => `<option value="${a.id}" ${S.filter.act === String(a.id) ? 'selected' : ''}>${a.icon} ${esc(pickName(a))}</option>`).join('')}</select>
      <select class="inp" id="fs">${['date', 'ascent', 'distance', 'rating'].map(k => `<option value="${k}" ${S.filter.sort === k ? 'selected' : ''}>${esc(T('sort_' + k))}</option>`).join('')}</select>
    </div><div id="tl"></div>`);
  const draw = () => {
    const list = filteredTours(), tl = $('#tl', wrap);
    if (!list.length) { tl.innerHTML = `<div class="empty">${esc(T('diary_nothing_found'))}</div>`; return; }
    let html = '', lastYear = '';
    list.forEach(t => {
      const y = (t.date || '').slice(0, 4);
      if (S.filter.sort === 'date' && y !== lastYear) { html += `<div class="year-sep">${y} · ${list.filter(x => (x.date || '').startsWith(y)).length} ${esc(T('tours_unit'))}</div>`; lastYear = y; }
      const a = actById(t.activityId), reg = regById(t.regionId);
      html += `<div class="tour" data-id="${t.id}">
        <div class="th" data-cover="${t.coverId || ''}" style="background-color:${a.color}22">${t.coverId ? '' : a.icon}</div>
        <div class="grow"><h3>${esc(t.title)}</h3>
          <div class="meta">${a.icon} ${esc(pickName(a))} · ${fmtDate(t.date)}${reg ? ' · ' + esc(pickName(reg)) : ''}</div>
          <div class="nums">${tourNums(t)}</div>
          ${t.rating ? `<div class="small" style="color:#F4A261">${stars(t.rating)}</div>` : ''}
          ${t.summitReached === false ? `<div class="back">↩ ${esc(T('turned_back'))}</div>` : ''}
        </div></div>`;
    });
    tl.innerHTML = html;
    $$('.tour', tl).forEach(el => el.onclick = () => openDetail(+el.dataset.id));
    lazyCovers(tl);
  };
  draw();
  let deb;
  $('#q', wrap).oninput = e => { S.filter.q = e.target.value; clearTimeout(deb); deb = setTimeout(draw, 150); };
  $('#fy', wrap).onchange = e => { S.filter.year = e.target.value; draw(); };
  $('#fa', wrap).onchange = e => { S.filter.act = e.target.value; draw(); };
  $('#fs', wrap).onchange = e => { S.filter.sort = e.target.value; draw(); };
}
function lazyCovers(root) {
  const els = $$('[data-cover]', root).filter(e => e.dataset.cover);
  const load = async el => { const u = await thumbUrl(+el.dataset.cover); if (u) el.style.backgroundImage = `url("${u}")`; };
  if (!('IntersectionObserver' in window)) { els.forEach(load); return; }
  const io = new IntersectionObserver(ents => ents.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }), { rootMargin: '300px' });
  els.forEach(el => io.observe(el));
}
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
async function installHint(wrap) {
  if (isStandalone() || await DB.kvGet('installHintDone', false)) return;
  const box = h(`<div class="hint-box"><b>📲 ${esc(T('install_title'))}</b><div class="txt">${esc(isIOS() ? T('install_ios') : T('install_other'))}</div><div class="row"><button class="btn sec2">${esc(T('install_ok'))}</button></div></div>`);
  $('button', box).onclick = () => { DB.kvSet('installHintDone', true); box.remove(); };
  wrap.prepend(box);
}

/* ------------------------------------------------------------------ Karte */
const MapView = { map: null };
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ESRI_ATTR = '&copy; Esri, Maxar, Earthstar Geographics';
const BZ_URL = 'https://geoservices.buergernetz.bz.it/mapproxy/ows';
const BZ_ATTR = '&copy; Autonome Provinz Bozen – Südtirol';
const esriSat = () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18, attribution: ESRI_ATTR });
const bzWms = (layer, fmt) => L.tileLayer.wms(BZ_URL, { layers: layer, format: fmt, transparent: fmt === 'image/png', version: '1.3.0', maxZoom: 19, attribution: BZ_ATTR });
const CARTO = s => L.tileLayer('https://{s}.basemaps.cartocdn.com/' + s + '/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: OSM_ATTR + ' &copy; CARTO' });
const LAYERS = {
  topo: () => [L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; OpenTopoMap (CC-BY-SA), ' + OSM_ATTR })],
  osm: () => [L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTR })],
  cycle: () => [L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', { maxZoom: 18, attribution: 'CyclOSM | ' + OSM_ATTR })],
  sat: () => [esriSat()],
  hybrid: () => [esriSat(), L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18, attribution: 'Esri' })],
  bz_ortho: () => [esriSat(), bzWms('p_bz-Orthoimagery:Aerial-2023-RGB', 'image/jpeg')],
  bz_base: () => [L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTR }), bzWms('p_bz-BaseMap:Basemap-Standard', 'image/png')],
  light: () => [CARTO('light_all')],
  dark: () => [CARTO('dark_all')]
};
const FILTERS = { none: '', vivid: 'saturate(1.6) contrast(1.1)', soft: 'saturate(0.6) brightness(1.08)', gray: 'grayscale(1)', sepia: 'sepia(0.75) saturate(1.2)' };
/* Leaflet-Karte mit gespeichertem Kartentyp und Stil-Knopf */
function createMap(el, { center = [46.65, 11.35], zoom = 9, styleButton = true, extraButtons = [] } = {}) {
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(center, zoom);
  map.attributionControl.setPrefix('');
  let layers = [];
  map.applyStyle = () => {
    layers.forEach(l => map.removeLayer(l));
    layers = (LAYERS[S.mapStyle] || LAYERS.topo)();
    layers.forEach(l => l.addTo(map));
    map.getPane('tilePane').style.filter = FILTERS[S.mapFilter] || '';
  };
  map.applyStyle();
  const ctl = h('<div class="map-ctl"></div>');
  if (styleButton) {
    const b = h('<button aria-label="layers">🗂️</button>');
    b.onclick = e => { e.stopPropagation(); chooseMapStyle(map); };
    ctl.appendChild(b);
  }
  extraButtons.forEach(([icon, fn]) => { const b = h(`<button>${icon}</button>`); b.onclick = e => { e.stopPropagation(); fn(); }; ctl.appendChild(b); });
  L.DomEvent.disableClickPropagation(ctl);
  el.appendChild(ctl);
  return map;
}
async function chooseMapStyle(map) {
  const styles = ['topo', 'osm', 'cycle', 'sat', 'hybrid', 'bz_ortho', 'bz_base', 'light', 'dark'];
  const html = `<div class="lbl">${esc(T('map_type'))}</div><div>${styles.map(s => `<button class="chip ${s === S.mapStyle ? 'sel' : ''}" data-s="${s}">${esc(T('map_' + s))}</button>`).join('')}</div>
    <div class="lbl" style="margin-top:14px">${esc(T('map_color'))}</div><div>${Object.keys(FILTERS).map(f => `<button class="chip ${f === S.mapFilter ? 'sel' : ''}" data-f="${f}">${esc(T('filter_' + f))}</button>`).join('')}</div>`;
  await dialog({ title: T('map_type'), html, buttons: [{ label: 'OK', value: true }], onOpen: ovl => {
    $$('[data-s]', ovl).forEach(b => b.onclick = () => { S.mapStyle = b.dataset.s; DB.kvSet('mapStyle', S.mapStyle); $$('[data-s]', ovl).forEach(x => x.classList.toggle('sel', x === b)); map.applyStyle(); });
    $$('[data-f]', ovl).forEach(b => b.onclick = () => { S.mapFilter = b.dataset.f; DB.kvSet('mapFilter', S.mapFilter); $$('[data-f]', ovl).forEach(x => x.classList.toggle('sel', x === b)); map.applyStyle(); });
  } });
}
function pinIcon(a) {
  return L.divIcon({ className: '', html: `<div class="pin" style="background:${a.color}"><span>${a.icon}</span></div>`, iconSize: [34, 34], iconAnchor: [4, 34], popupAnchor: [13, -30] });
}
let mapYear = '';
function renderMap(v) {
  const pg = makePage({ title: T('tab_map'), nopad: true });
  v.appendChild(pg.el);
  const el = h('<div class="mapwrap"></div>'); pg.content.appendChild(el);
  const yrs = years();
  const map = createMap(el, { extraButtons: [['📍', () => locateMe(map)]] });
  MapView.map = map;
  const ysel = h(`<div class="map-year"><select class="inp"><option value="">${esc(T('all_years'))}</option>${yrs.map(y => `<option ${mapYear === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>`);
  L.DomEvent.disableClickPropagation(ysel);
  el.appendChild(ysel);
  const zc = L.control.zoom({ position: 'bottomleft' }); zc.addTo(map);
  let cluster = null;
  const draw = () => {
    if (cluster) map.removeLayer(cluster);
    cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 });
    const pts = [];
    S.tours.filter(t => t.lat != null && t.lon != null && (!mapYear || (t.date || '').startsWith(mapYear))).forEach(t => {
      const a = actById(t.activityId);
      const m = L.marker([t.lat, t.lon], { icon: pinIcon(a) });
      m.bindPopup(`<div class="pop"><h4>${esc(t.title)}</h4><div class="muted">${a.icon} ${fmtDate(t.date)}</div><div>${tourNums(t)}</div><button class="btn" data-open="${t.id}">${esc(T('open'))}</button></div>`);
      cluster.addLayer(m); pts.push([t.lat, t.lon]);
    });
    map.addLayer(cluster);
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 13 });
  };
  map.on('popupopen', e => { const b = e.popup.getElement().querySelector('[data-open]'); if (b) b.onclick = () => openDetail(+b.dataset.open); });
  $('select', ysel).onchange = e => { mapYear = e.target.value; draw(); };
  setTimeout(() => { map.invalidateSize(); draw(); }, 50);
}
function locateMe(map) {
  getPosition().then(p => { map.setView([p.lat, p.lon], 13); L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#1565C0', fillOpacity: 1 }).addTo(map); })
    .catch(msg => toast(msg));
}
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(T('gps_disabled')); return; }
    const b = busy(T('gps_wait'));
    navigator.geolocation.getCurrentPosition(p => { b.close(); resolve({ lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude }); },
      err => { b.close(); reject(err.code === 1 ? T('gps_no_permission') : T('gps_timeout')); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  });
}
/* Position auf der Karte wählen -> Promise {lat, lon} oder null */
function pickPosition(lat, lon) {
  return new Promise(resolve => {
    const pg = makePage({ title: T('pick_title'), back: true, nopad: true });
    let result = null, marker = null;
    pushPage(pg, { onClose: () => { map.remove(); resolve(result); } });
    const el = h('<div class="mapwrap"></div>'); pg.content.appendChild(el);
    const has = lat != null && lon != null;
    const map = createMap(el, { center: has ? [lat, lon] : [46.65, 11.35], zoom: has ? 14 : 9, extraButtons: [['📍', () => locateMe(map)]] });
    el.appendChild(h(`<div class="pick-hint">${esc(T('pick_hint'))}</div>`));
    const go = h(`<button class="btn pick-go" ${has ? '' : 'disabled'}>${esc(T('pick_apply'))}</button>`);
    L.DomEvent.disableClickPropagation(go);
    el.appendChild(go);
    const setM = ll => { if (marker) marker.setLatLng(ll); else marker = L.marker(ll, { draggable: true }).addTo(map); go.disabled = false; };
    if (has) setM([lat, lon]);
    map.on('click', e => setM(e.latlng));
    go.onclick = () => { const ll = marker.getLatLng(); result = { lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6) }; closeTop(); };
    setTimeout(() => map.invalidateSize(), 60);
  });
}

/* ------------------------------------------------------------------ Detailansicht */
async function openDetail(id) {
  const t = tourById(id);
  if (!t) return;
  const a = actById(t.activityId), reg = regById(t.regionId);
  const pg = makePage({ title: t.title, back: true, actions: `<button class="ib" id="ed" aria-label="edit">✏️</button>` });
  let mini = null;
  pushPage(pg, { onClose: () => { if (mini) mini.remove(); } });
  $('#ed', pg.el).onclick = () => openEdit(id, () => { closeTop(); setTimeout(() => openDetail(id), 30); });
  const c = pg.content; c.style.padding = '0 0 calc(var(--sb) + 40px)';
  const photos = (await DB.byIndex('photos', 'tourId', id)).sort((x, y) => (x.order || 0) - (y.order || 0));
  const coverId = t.coverId || (photos[0] && photos[0].id);
  const cover = h(`<div class="cover ${coverId ? '' : 'noimg'}">${coverId ? '' : a.icon}</div>`);
  if (coverId) { thumbUrl(coverId, true).then(u => cover.style.backgroundImage = `url("${u}")`); cover.onclick = () => openViewer(photos, Math.max(0, photos.findIndex(p => p.id === coverId))); }
  c.appendChild(cover);
  const w = h('<div class="wrap" style="padding:0 12px"></div>'); c.appendChild(w);
  const top = (t.summits && t.summits.length) ? Math.max(...t.summits.map(s => s.alt || 0)) : (t.summitAlt || 0);
  const st = [];
  if (t.ascent) st.push([fmtInt(t.ascent) + ' m', T('f_ascent')]);
  if (t.descent) st.push([fmtInt(t.descent) + ' m', T('f_descent')]);
  if (t.distance) st.push([fmtKm(t.distance) + ' km', T('f_distance')]);
  if (t.duration) st.push([fmtDuration(t.duration), T('f_duration').split('(')[0].trim()]);
  if (top) st.push([fmtInt(top) + ' m', T('f_summit_alt')]);
  let html = `<div class="dhead" style="padding:14px 4px 0"><h2>${esc(t.title)}</h2>
    <div class="muted">${a.icon} ${esc(pickName(a))} · ${fmtDate(t.date)}${reg ? ' · ' + esc(pickName(reg)) : ''}</div>
    ${t.rating ? `<div style="color:#F4A261;font-size:18px">${stars(t.rating)}</div>` : ''}
    ${t.summitReached === false ? `<div class="back" style="color:var(--danger)">↩ ${esc(T('turned_back'))}</div>` : ''}</div>`;
  if (st.length) html += `<div class="stats4">${st.map(s => `<div class="stat"><b>${s[0]}</b><small>${esc(s[1])}</small></div>`).join('')}</div>`;
  if (t.summits && t.summits.length) html += `<div class="sec">⛰️ ${esc(T('summits'))}</div><div class="card">${[...t.summits].sort((x, y) => (y.alt || 0) - (x.alt || 0)).map(s => `<div class="sum-row"><span class="grow">${esc(s.name)}</span><b>${s.alt ? fmtInt(s.alt) + ' m' : ''}</b></div>`).join('')}</div>`;
  const rows = [];
  if (t.grade) rows.push([T('f_grade'), Grades.display(t.grade)]);
  if (t.avalanche) rows.push([T('f_avalanche'), T('aval_' + t.avalanche)]);
  if (t.weather) rows.push([T('f_weather'), WEATHER[t.weather] + ' ' + T('w_' + t.weather)]);
  if (t.start) rows.push([T('f_start'), t.start]);
  if (t.persons && t.persons.length) rows.push([T('f_persons'), t.persons.join(', ')]);
  if (rows.length) html += `<div class="card" style="margin-top:10px">${rows.map(r => `<div class="kv"><div class="k">${esc(r[0])}</div><div class="v">${esc(r[1])}</div></div>`).join('')}</div>`;
  [['f_description', t.description], ['f_conditions', t.conditions], ['f_features', t.features]].forEach(([k, val]) => {
    if (val) html += `<div class="sec">${esc(T(k))}</div><div class="card text">${esc(val)}</div>`;
  });
  w.insertAdjacentHTML('beforeend', html);
  if (photos.length) {
    w.insertAdjacentHTML('beforeend', `<div class="sec">📷 ${esc(T('photos'))} (${photos.length})</div>`);
    const g = h('<div class="gallery"></div>');
    photos.forEach((p, i) => { const b = h(`<button class="g" data-cover="${p.id}"></button>`); b.onclick = () => openViewer(photos, i); g.appendChild(b); });
    w.appendChild(g); lazyCovers(g);
  }
  const track = await DB.get('tracks', id);
  if (track || (t.lat != null && t.lon != null)) {
    w.insertAdjacentHTML('beforeend', `<div class="sec">🗺️ ${esc(T('map'))}</div>`);
    const mEl = h('<div class="minimap"></div>'); w.appendChild(mEl);
    setTimeout(() => {
      mini = createMap(mEl, { center: [t.lat || 46.6, t.lon || 11.3], zoom: 13 });
      let bounds = null;
      if (track && track.pts && track.pts.length > 1) {
        const line = L.polyline(track.pts.map(p => [p[0], p[1]]), { color: '#E63946', weight: 4, opacity: .9 }).addTo(mini);
        bounds = line.getBounds();
      }
      if (t.lat != null) L.marker([t.lat, t.lon], { icon: pinIcon(a) }).addTo(mini);
      (t.summits || []).filter(s => s.lat != null).forEach(s => L.circleMarker([s.lat, s.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#1D3D47', fillOpacity: 1 }).bindTooltip(s.name).addTo(mini));
      if (bounds) mini.fitBounds(bounds.pad(0.1)); else mini.setView([t.lat, t.lon], 13);
    }, 250);
    if (track && track.pts && track.pts.length > 2 && track.pts[0].length > 2 && track.pts.some(p => p[2] != null)) w.appendChild(profileSvg(track.pts));
  }
  w.insertAdjacentHTML('beforeend', `<div style="margin-top:22px" class="row"><button class="btn sec2 grow" id="ed2">✏️ ${esc(T('edit'))}</button><button class="btn danger grow" id="del">🗑️ ${esc(T('delete'))}</button></div>`);
  $('#ed2', w).onclick = () => $('#ed', pg.el).click();
  $('#del', w).onclick = async () => {
    if (!await confirmBox(fill(T('delete_confirm_named'), { n: t.title }), T('delete'), '', true)) return;
    await deleteTour(id);
    toast(T('deleted'));
    popSilently();
    refreshAll();
  };
}
async function deleteTour(id) {
  const photos = await DB.byIndex('photos', 'tourId', id);
  for (const p of photos) await DB.del('photos', p.id);
  dropThumbs(photos.map(p => p.id));
  await DB.del('tracks', id);
  await DB.del('tours', id);
}
/* Höhenprofil als SVG */
function profileSvg(pts) {
  let d = 0; const xs = [0];
  for (let i = 1; i < pts.length; i++) { d += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); xs.push(d); }
  const es = pts.map(p => p[2]).map((e, i, arr) => e != null ? e : (arr[i - 1] != null ? arr[i - 1] : 0));
  const mn = Math.min(...es), mx = Math.max(...es), W = 600, H = 120, pad = 18;
  const X = x => (x / (d || 1)) * W, Y = e => H - pad - ((e - mn) / ((mx - mn) || 1)) * (H - pad - 8);
  const path = es.map((e, i) => (i ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(e).toFixed(1)).join(' ');
  const el = h(`<div class="card" style="padding:8px 8px 4px;margin-top:8px"><svg class="profile" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${path} L ${W} ${H} L 0 ${H} Z" fill="#2A9D8F" fill-opacity=".22"/><path d="${path}" fill="none" stroke="#1D3D47" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div class="row small muted" style="justify-content:space-between"><span>▼ ${fmtInt(mn)} m</span><span>${fmtKm(d)} km</span><span>▲ ${fmtInt(mx)} m</span></div></div>`);
  return el;
}

/* ------------------------------------------------------------------ Foto-Viewer mit Wischen und Zoom */
async function openViewer(photos, start, { onCover, onRemove } = {}) {
  let idx = start;
  const v = h(`<div class="viewer"><div class="strip"></div><div class="vbar"><button class="x">✕</button><div class="grow"></div>
    ${onCover ? `<button class="cv" title="${esc(T('photo_cover'))}">⭐</button>` : ''}${onRemove ? `<button class="rm" title="${esc(T('photo_remove'))}">🗑️</button>` : ''}</div></div>`);
  const strip = $('.strip', v);
  photos.forEach(() => strip.appendChild(h('<div class="slide"><img alt=""></div>')));
  document.body.appendChild(v);
  history.pushState({ viewer: 1 }, '');
  const urls = [];
  const loadSlide = async i => {
    if (i < 0 || i >= photos.length) return;
    const img = $$('.slide', strip)[i].firstElementChild;
    if (img.src) return;
    const p = photos[i];
    let u;
    if (p.id) u = await thumbUrl(p.id, true); else { u = URL.createObjectURL(p.blob); urls.push(u); }
    img.src = u;
  };
  const label = () => { $('.grow', v).textContent = (idx + 1) + ' / ' + photos.length; };
  const close = () => { v.remove(); window.removeEventListener('popstate', onPop); urls.forEach(u => URL.revokeObjectURL(u)); };
  const onPop = () => close();
  window.addEventListener('popstate', onPop);
  $('.x', v).onclick = () => history.back();
  if (onCover) $('.cv', v).onclick = () => { onCover(photos[idx]); toast('⭐ ' + T('photo_cover')); };
  if (onRemove) $('.rm', v).onclick = () => { onRemove(photos[idx]); history.back(); };
  [idx - 1, idx, idx + 1].forEach(loadSlide);
  requestAnimationFrame(() => { strip.scrollLeft = idx * strip.clientWidth; label(); });
  let st;
  strip.addEventListener('scroll', () => {
    clearTimeout(st);
    st = setTimeout(() => {
      const i = Math.round(strip.scrollLeft / strip.clientWidth);
      if (i !== idx) { resetZoom(); idx = i; label(); [idx - 1, idx, idx + 1].forEach(loadSlide); }
    }, 60);
  }, { passive: true });

  /* Zoom: zwei Finger oder Doppeltipp; gezoomt wird mit einem Finger verschoben, Wischen ist dann gesperrt */
  let z = { s: 1, x: 0, y: 0 }, g = null, lastTap = 0;
  const curImg = () => $$('.slide', strip)[idx].firstElementChild;
  const apply = () => {
    const img = curImg();
    img.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
    const zoomed = z.s > 1.01;
    strip.classList.toggle('locked', zoomed);
    $$('.slide', strip)[idx].classList.toggle('zoom', zoomed);
  };
  const resetZoom = () => { if (z.s !== 1) { const img = curImg(); img.style.transition = 'transform .2s'; z = { s: 1, x: 0, y: 0 }; apply(); setTimeout(() => img.style.transition = '', 220); } };
  const clamp = () => {
    const img = curImg(), W = img.offsetWidth, H = img.offsetHeight;
    if (z.s <= 1) { z = { s: 1, x: 0, y: 0 }; return; }
    z.s = Math.min(z.s, 5);
    z.x = Math.min(0, Math.max(W - W * z.s, z.x));
    z.y = Math.min(0, Math.max(H - H * z.s, z.y));
  };
  const rel = (t, img) => { const r = img.getBoundingClientRect(); return { x: t.clientX - r.left + z.x, y: t.clientY - r.top + z.y }; };
  strip.addEventListener('touchstart', e => {
    const img = curImg();
    if (e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      const mid = { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
      g = { mode: 'pinch', d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s0: z.s, x0: z.x, y0: z.y, m: rel(mid, img) };
      strip.classList.add('locked');
    } else if (e.touches.length === 1 && z.s > 1.01) {
      g = { mode: 'pan', sx: e.touches[0].clientX, sy: e.touches[0].clientY, x0: z.x, y0: z.y };
    }
  }, { passive: true });
  strip.addEventListener('touchmove', e => {
    if (!g) return;
    e.preventDefault();
    if (g.mode === 'pinch' && e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      const s = Math.max(1, Math.min(5, g.s0 * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / g.d0));
      /* Punkt unter den Fingern bleibt stehen */
      const px = (g.m.x - g.x0) / g.s0, py = (g.m.y - g.y0) / g.s0;
      z.s = s; z.x = g.m.x - px * s; z.y = g.m.y - py * s;
      apply();
    } else if (g.mode === 'pan' && e.touches.length === 1) {
      z.x = g.x0 + e.touches[0].clientX - g.sx; z.y = g.y0 + e.touches[0].clientY - g.sy;
      clamp(); apply();
    }
  }, { passive: false });
  strip.addEventListener('touchend', e => {
    if (g && e.touches.length === 0) { clamp(); apply(); g = null; }
    if (e.touches.length === 0 && e.changedTouches.length === 1) {
      const now = Date.now();
      if (now - lastTap < 280) {
        const img = curImg(), t = e.changedTouches[0];
        if (z.s > 1.01) resetZoom();
        else { const p = rel(t, img); img.style.transition = 'transform .2s'; z = { s: 2.5, x: p.x - p.x * 2.5, y: p.y - p.y * 2.5 }; clamp(); apply(); setTimeout(() => img.style.transition = '', 220); }
        lastTap = 0;
      } else lastTap = now;
    }
  });
  /* Desktop: Doppelklick zoomt, Pfeiltasten blättern */
  strip.addEventListener('dblclick', e => {
    const img = curImg();
    if (z.s > 1.01) resetZoom(); else { const p = rel(e, img); z = { s: 2.5, x: p.x - p.x * 2.5, y: p.y - p.y * 2.5 }; clamp(); apply(); }
  });
  const key = e => {
    if (!document.body.contains(v)) { window.removeEventListener('keydown', key); return; }
    if (e.key === 'ArrowRight') strip.scrollBy({ left: strip.clientWidth, behavior: 'smooth' });
    if (e.key === 'ArrowLeft') strip.scrollBy({ left: -strip.clientWidth, behavior: 'smooth' });
    if (e.key === 'Escape') history.back();
  };
  window.addEventListener('keydown', key);
}

/* ------------------------------------------------------------------ Hilfe */
function openHelp(anchor = '') {
  const pg = makePage({ title: T('help'), back: true, nopad: true });
  pushPage(pg);
  pg.content.classList.add('help');
  pg.content.innerHTML = `<iframe src="help_${I18N.code}.html${anchor ? '#' + anchor : ''}" title="help"></iframe>`;
}

/* ------------------------------------------------------------------ Start */
async function boot() {
  try {
    await DB.open();
  } catch (e) {
    document.body.innerHTML = '<p style="padding:30px">Speicher nicht verfügbar / storage not available (private browsing?).</p>';
    return;
  }
  await loadLang(await DB.kvGet('lang', systemLang()));
  document.title = T('app_name');
  await loadAll();
  history.replaceState({ depth: 0 }, '');
  buildTabs();
  renderTab();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  registerSW();
  setTimeout(startupHints, 800);
}
async function startupHints() {
  /* Backup-Erinnerung und einmaliger Ko-fi-Hinweis */
  if (S.tours.length >= 15 && !await DB.kvGet('supportHintDone', false)) {
    await DB.kvSet('supportHintDone', true);
    const r = await dialog({ title: '☕ ' + T('support_kofi'), text: T('support_hint'), buttons: [{ label: T('support_no'), value: false }, { label: T('support_open'), value: true }] });
    if (r) window.open(KOFI_URL, '_blank');
    return;
  }
  const last = await DB.kvGet('lastBackup', 0);
  if (S.tours.length >= 3 && Date.now() - last > 30 * 86400000 && Date.now() - await DB.kvGet('backupNag', 0) > 14 * 86400000) {
    await DB.kvSet('backupNag', Date.now());
    const r = await dialog({ title: '💾 ' + T('backup'), text: T('backup_reminder') + '\n\n' + T('web_storage_note'), buttons: [{ label: T('later'), value: false }, { label: T('backup_now'), value: true }] });
    if (r) exportBackup();
  }
}
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const ask = w => {
      dialog({ title: T('update_title'), text: T('web_update_ready'), buttons: [{ label: T('later'), value: false }, { label: T('web_reload'), value: true }] })
        .then(ok => { if (ok) w.postMessage('skipWaiting'); });
    };
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); });
    });
    /* bei jedem Start einmal nach einer neuen Version schauen */
    reg.update().catch(() => {});
  }).catch(() => {});
  /* nur nach einem Update neu laden, nicht beim allerersten Start */
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}
document.addEventListener('DOMContentLoaded', boot);
