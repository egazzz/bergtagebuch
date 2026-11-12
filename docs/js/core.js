/* Bergtagebuch Web – Kern: Daten (IndexedDB), Sprachen, Skalen, GPX, Gipfelsuche, Statistik, Erfolge */
'use strict';

const APP_VERSION = '1.7.1';
const KOFI_URL = 'https://ko-fi.com/egazzz';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/* ------------------------------------------------------------------ IndexedDB */
const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('bergtagebuch', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('tours', { keyPath: 'id', autoIncrement: true });
        const ph = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        ph.createIndex('tourId', 'tourId');
        db.createObjectStore('tracks', { keyPath: 'tourId' });
        db.createObjectStore('kv', { keyPath: 'k' });
      };
      req.onsuccess = () => { DB.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = DB.db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then(r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  all(store) { return DB.tx(store, 'readonly', s => DB.req(s.getAll())); },
  get(store, key) { return DB.tx(store, 'readonly', s => DB.req(s.get(key))); },
  put(store, obj) { return DB.tx(store, 'readwrite', s => DB.req(s.put(obj))); },
  del(store, key) { return DB.tx(store, 'readwrite', s => DB.req(s.delete(key))); },
  clear(store) { return DB.tx(store, 'readwrite', s => DB.req(s.clear())); },
  byIndex(store, index, key) { return DB.tx(store, 'readonly', s => DB.req(s.index(index).getAll(key))); },
  async kvGet(k, def) { const r = await DB.get('kv', k); return r ? r.v : def; },
  kvSet(k, v) { return DB.put('kv', { k, v }); }
};

/* ------------------------------------------------------------------ Sprachen */
const I18N = { code: 'de', s: {} };
async function loadLang(code) {
  if (!['de', 'it', 'en'].includes(code)) code = 'de';
  const txt = await (await fetch('lang/lang_' + code + '.txt')).text();
  const s = {};
  txt.split(/\r?\n/).forEach(line => {
    if (line.startsWith('#')) return;
    const i = line.indexOf('=');
    if (i > 0) s[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/\\n/g, '\n');
  });
  I18N.code = code; I18N.s = s;
  document.documentElement.lang = code;
}
function T(k) { return I18N.s[k] !== undefined ? I18N.s[k] : k; }
function systemLang() {
  const l = (navigator.language || 'de').slice(0, 2).toLowerCase();
  return l === 'it' ? 'it' : l === 'de' ? 'de' : 'en';
}
/* Name in der App-Sprache (name_de / name_it / name_en) */
function pickName(o, prefix = 'name') {
  if (!o) return '';
  return o[prefix + '_' + I18N.code] || o[prefix + '_de'] || o[prefix] || '';
}

/* ------------------------------------------------------------------ Hilfsfunktionen */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const locale = () => ({ de: 'de-DE', it: 'it-IT', en: 'en-GB' }[I18N.code]);
const fmtInt = v => Math.round(Number(v) || 0).toLocaleString(locale());
const fmtKm = v => (Number(v) || 0).toLocaleString(locale(), { maximumFractionDigits: 1 });
const fmtDate = iso => (iso && iso.length >= 10) ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : (iso || '');
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtDuration = m => m > 0 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ' h' : '';
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const num = s => { if (s == null || s === '') return null; const v = parseFloat(String(s).replace(',', '.')); return isNaN(v) ? null : v; };
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const distM = (a, b, c, d) => haversine(a, b, c, d) * 1000;

/* ------------------------------------------------------------------ Stammdaten */
const DEFAULT_ACTIVITIES = [
  { id: 1, name_de: 'Wandern', name_it: 'Escursionismo', name_en: 'Hiking', icon: '🥾', color: '#2E7D32', scales: 'SAC_T,AV,CAI', builtin: true },
  { id: 2, name_de: 'Bergsteigen', name_it: 'Alpinismo', name_en: 'Mountaineering', icon: '⛰️', color: '#1565C0', scales: 'FR_ALP,SAC_HT,FR,UIAA,AV', builtin: true },
  { id: 3, name_de: 'Klettern', name_it: 'Arrampicata', name_en: 'Climbing', icon: '🧗', color: '#EF6C00', scales: 'FR,UIAA,YDS', builtin: true },
  { id: 4, name_de: 'Klettersteig', name_it: 'Via ferrata', name_en: 'Via ferrata', icon: '⛓️', color: '#AD1457', scales: 'SCHALL,HUESLER,AV', builtin: true },
  { id: 5, name_de: 'Skitour', name_it: 'Scialpinismo', name_en: 'Ski touring', icon: '🎿', color: '#0288D1', scales: 'SKI_SAC,BLACHERE,TOPONEIGE,AV', builtin: true },
  { id: 6, name_de: 'Biken', name_it: 'Mountain bike', name_en: 'Mountain biking', icon: '🚵', color: '#6D4C41', scales: 'STS,AV', builtin: true },
  { id: 7, name_de: 'Skifahren', name_it: 'Sci alpino', name_en: 'Skiing', icon: '⛷️', color: '#C62828', scales: 'PISTE', builtin: true }
];
const DEFAULT_REGIONS = [
  ['Vinschgau', 'Val Venosta'], ['Burggrafenamt', 'Burgraviato'], ['Passeier', 'Val Passiria'], ['Ultental', "Val d'Ultimo"],
  ['Sarntal', 'Val Sarentino'], ['Überetsch-Unterland', 'Oltradige-Bassa Atesina'], ['Bozen', 'Bolzano'], ['Eisacktal', 'Valle Isarco'],
  ['Wipptal', 'Alta Valle Isarco'], ['Pustertal', 'Val Pusteria'], ['Ahrntal', 'Valle Aurina'], ['Gröden', 'Val Gardena'],
  ['Gadertal', 'Val Badia'], ['Seiser Alm-Schlern', 'Alpe di Siusi-Sciliar'], ['Eggental', "Val d'Ega"], ['Trentino', 'Trentino'],
  ['Tirol', 'Tirolo'], ['Andere', 'Altro']
].map((r, i) => ({ id: i + 1, name_de: r[0], name_it: r[1],
  name_en: r[0] === 'Tirol' ? 'Tyrol' : r[0] === 'Andere' ? 'Other' : r[0] === 'Bozen' ? 'Bolzano / Bozen' : (r[0] === r[1] ? r[0] : r[0] + ' / ' + r[1]) }));
const ICONS = ['🏃', '⛷️', '🏂', '🥾', '⛰️', '🧗', '🎿', '🚵', '🚴', '🛶', '🧊', '🏕️', '🚶', '🌲', '🏔️', '⛺', '🪂', '🐎', '🧘', '❄️'];
const COLORS = [['color_teal', '#00897B'], ['color_green', '#2E7D32'], ['color_blue', '#1565C0'], ['color_orange', '#EF6C00'], ['color_lightblue', '#0288D1'],
  ['color_brown', '#6D4C41'], ['color_red', '#C62828'], ['color_purple', '#6A1B9A'], ['color_gray', '#546E7A']];
const WEATHER = { sun: '☀️', cloud: '⛅', rain: '🌧️', snow: '❄️', fog: '🌫️', wind: '💨' };

/* ------------------------------------------------------------------ Schwierigkeitsskalen */
const Grades = {
  all: ['AV', 'SAC_T', 'CAI', 'SCHALL', 'HUESLER', 'FR', 'UIAA', 'YDS', 'FR_ALP', 'SAC_HT', 'SKI_SAC', 'BLACHERE', 'TOPONEIGE', 'STS', 'PISTE', 'FREE'],
  options: {
    AV: ['blue', 'red', 'black'],
    SAC_T: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'],
    CAI: ['T', 'E', 'EE', 'EEA'],
    SCHALL: ['A', 'A/B', 'B', 'B/C', 'C', 'C/D', 'D', 'D/E', 'E', 'E/F', 'F'],
    HUESLER: ['K1', 'K2', 'K3', 'K4', 'K5', 'K6'],
    FR: ['2', '3a', '3b', '3c', '4a', '4b', '4c', '5a', '5a+', '5b', '5b+', '5c', '5c+', '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a', '9a+', '9b', '9b+', '9c'],
    UIAA: ['I', 'II', 'III-', 'III', 'III+', 'IV-', 'IV', 'IV+', 'V-', 'V', 'V+', 'VI-', 'VI', 'VI+', 'VII-', 'VII', 'VII+', 'VIII-', 'VIII', 'VIII+', 'IX-', 'IX', 'IX+', 'X-', 'X', 'X+', 'XI-', 'XI', 'XI+', 'XII-', 'XII'],
    YDS: ['5.2', '5.3', '5.4', '5.5', '5.6', '5.7', '5.8', '5.9', '5.10a', '5.10b', '5.10c', '5.10d', '5.11a', '5.11b', '5.11c', '5.11d', '5.12a', '5.12b', '5.12c', '5.12d', '5.13a', '5.13b', '5.13c', '5.13d', '5.14a', '5.14b', '5.14c', '5.14d', '5.15a', '5.15b', '5.15c', '5.15d'],
    FR_ALP: ['F', 'F+', 'PD-', 'PD', 'PD+', 'AD-', 'AD', 'AD+', 'D-', 'D', 'D+', 'TD-', 'TD', 'TD+', 'ED', 'ED+', 'ABO'],
    SAC_HT: ['L', 'L+', 'WS-', 'WS', 'WS+', 'ZS-', 'ZS', 'ZS+', 'S-', 'S', 'S+', 'SS-', 'SS', 'SS+', 'AS-', 'AS', 'AS+', 'EX'],
    SKI_SAC: ['L', 'WS-', 'WS', 'WS+', 'ZS-', 'ZS', 'ZS+', 'S-', 'S', 'S+', 'SS', 'AS', 'EX'],
    BLACHERE: ['MS', 'MSA', 'BS', 'BSA', 'OS', 'OSA'],
    TOPONEIGE: ['1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '3.1', '3.2', '3.3', '4.1', '4.2', '4.3', '5.1', '5.2', '5.3', '5.4', '5.5', '5.6'],
    STS: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'],
    PISTE: ['blue', 'red', 'black', 'freeride', 'skiroute']
  },
  short: { AV: 'AVS', SAC_T: 'SAC', SAC_HT: 'SAC', SKI_SAC: 'SAC', CAI: 'CAI', SCHALL: 'Schall', HUESLER: 'Hüsler', FR: 'fr.', UIAA: 'UIAA', YDS: 'YDS', FR_ALP: 'IFAS', BLACHERE: 'Blachère', TOPONEIGE: 'Toponeige', STS: 'STS' },
  scalesFor(group) {
    const res = String(group || '').split(',').map(s => s.trim()).filter(k => Grades.all.includes(k));
    return res.length ? [...new Set(res)] : ['FREE'];
  },
  isSkiTour(group) { return Grades.scalesFor(group).some(k => ['SKI_SAC', 'BLACHERE', 'TOPONEIGE'].includes(k)); },
  valueLabel(key, v) {
    if (key === 'AV') return { blue: '🔵 ' + T('av_blue'), red: '🔴 ' + T('av_red'), black: '⚫ ' + T('av_black') }[v] || v;
    if (key === 'PISTE') return { blue: '🔵 ' + T('piste_blue'), red: '🔴 ' + T('piste_red'), black: '⚫ ' + T('piste_black'), freeride: 'Freeride', skiroute: T('piste_route') }[v] || v;
    return v;
  },
  longName: k => T('scale_' + k),
  decode(stored) { const i = String(stored || '').indexOf('|'); return i < 0 ? ['', stored || ''] : [stored.slice(0, i), stored.slice(i + 1)]; },
  encode: (k, v) => (!k || k === 'FREE') ? v : k + '|' + v,
  display(stored) {
    if (!stored) return '';
    const [k, v] = Grades.decode(stored);
    if (!k) return v;
    const s = Grades.short[k] || '';
    return (s ? s + ' ' : '') + Grades.valueLabel(k, v);
  },
  groupLabel(group) { return Grades.scalesFor(group).map(k => Grades.short[k] || Grades.longName(k)).join(' / '); }
};

/* ------------------------------------------------------------------ GPX */
function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  let pts = [...doc.getElementsByTagName('trkpt')];
  if (!pts.length) pts = [...doc.getElementsByTagName('rtept')];
  const points = pts.map(p => {
    const e = p.getElementsByTagName('ele')[0], t = p.getElementsByTagName('time')[0];
    return [parseFloat(p.getAttribute('lat')), parseFloat(p.getAttribute('lon')),
      e ? parseFloat(e.textContent) : null, t ? Date.parse(t.textContent) || 0 : 0];
  }).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
  if (points.length < 2) return null;
  let name = '';
  const trk = doc.getElementsByTagName('trk')[0] || doc.getElementsByTagName('rte')[0];
  if (trk) { const n = [...trk.children].find(c => c.localName === 'name'); if (n) name = n.textContent.trim(); }
  if (!name) { const md = doc.getElementsByTagName('metadata')[0]; const n = md && [...md.children].find(c => c.localName === 'name'); if (n) name = n.textContent.trim(); }
  const g = { points, name };
  computeGpx(g);
  return g;
}

function computeGpx(g) {
  const P = g.points;
  g.distanceKm = 0; g.ascent = 0; g.descent = 0; g.maxEle = null; g.maxLat = P[0][0]; g.maxLon = P[0][1];
  g.start = 0; g.end = 0;
  const eles = [];
  for (let i = 0; i < P.length; i++) {
    if (i > 0) g.distanceKm += haversine(P[i - 1][0], P[i - 1][1], P[i][0], P[i][1]);
    const e = P[i][2];
    if (e != null && !isNaN(e)) {
      eles.push(e);
      if (g.maxEle == null || e > g.maxEle) { g.maxEle = e; g.maxLat = P[i][0]; g.maxLon = P[i][1]; }
    }
    if (P[i][3] > 0) { if (!g.start) g.start = P[i][3]; g.end = P[i][3]; }
  }
  g.hasEle = eles.length > 2;
  if (g.hasEle) computeElevation(g, eles);
  g.durationMin = g.start && g.end > g.start ? Math.round((g.end - g.start) / 60000) : 0;
  g.startDate = g.start ? new Date(g.start).toISOString().slice(0, 10) : '';
}

/* Höhenmeter je nach Art der Höhendaten (wie Android): glatt -> 1 m, gefiltert -> 3 m + leichte Glättung, GPS -> 5 m + Glättung */
function computeElevation(g, eles) {
  const n = eles.length, d2 = [];
  for (let i = 1; i < n - 1; i++) d2.push(Math.abs(eles[i + 1] - 2 * eles[i] + eles[i - 1]));
  d2.sort((a, b) => a - b);
  const noise = d2[Math.floor(d2.length / 2)] || 0;
  let th, win;
  if (noise < 0.5) { g.eleMode = 'smooth'; th = 1; win = 0; }
  else if (noise < 2) { g.eleMode = 'filtered'; th = 3; win = 1; }
  else { g.eleMode = 'gps'; th = 5; win = 2; }
  const sm = eles.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) { s += eles[k]; c++; } return s / c; });
  let ref = sm[0];
  for (let i = 1; i < n; i++) {
    if (sm[i] - ref >= th) { g.ascent += sm[i] - ref; ref = sm[i]; }
    else if (ref - sm[i] >= th) { g.descent += ref - sm[i]; ref = sm[i]; }
  }
}

/* Gipfel im Track: Hochpunkte mit mindestens minProm Metern Gegenanstieg */
function findPeaks(g, minProm = 50) {
  const res = [];
  if (!g.hasEle) return res;
  const P = g.points.filter(p => p[2] != null && !isNaN(p[2]));
  const n = P.length, ele = P.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) { s += P[k][2]; c++; } return s / c; });
  const idx = [];
  let lastMin = null, candMax = null, ci = -1;
  for (let i = 0; i < n; i++) {
    const e = ele[i];
    if (lastMin == null) { lastMin = e; candMax = e; ci = i; continue; }
    if (e > candMax) { candMax = e; ci = i; }
    if (candMax - lastMin < minProm && e < lastMin) { lastMin = e; candMax = e; ci = i; }
    else if (candMax - lastMin >= minProm && candMax - e >= minProm) { idx.push(ci); lastMin = e; candMax = e; ci = i; }
  }
  if (ci >= 0 && candMax - lastMin >= minProm && !idx.includes(ci)) idx.push(ci);
  idx.forEach(i => res.push({ lat: P[i][0], lon: P[i][1], ele: P[i][2] }));
  if (g.maxEle != null && !res.some(r => distM(r.lat, r.lon, g.maxLat, g.maxLon) < 150)) res.push({ lat: g.maxLat, lon: g.maxLon, ele: g.maxEle });
  return res;
}

function simplifyTrack(g, max = 1500) {
  const step = Math.max(1, Math.ceil(g.points.length / max));
  const out = [];
  for (let i = 0; i < g.points.length; i += step) out.push([+g.points[i][0].toFixed(6), +g.points[i][1].toFixed(6)]);
  const last = g.points[g.points.length - 1];
  out.push([+last[0].toFixed(6), +last[1].toFixed(6)]);
  return out;
}

/* ------------------------------------------------------------------ Gipfel aus OpenStreetMap */
function peakName(tags) { return (tags && (tags['name:' + I18N.code] || tags['name:de'] || tags.name)) || ''; }
function parseEle(s) { const m = String(s || '').match(/^\d+/); return m ? parseInt(m[0], 10) : 0; }
async function overpass(query) {
  const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(query),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!r.ok) throw new Error('Overpass ' + r.status);
  return (await r.json()).elements || [];
}
/* Kandidaten {lat,lon,ele} -> [{name, alt, lat, lon}] (Name leer, wenn nichts gefunden oder offline) */
async function lookupPeaks(cands, radius = 250) {
  let elements = [], error = '';
  if (cands.length) {
    const q = '[out:json][timeout:20];(' + cands.map(c => `node["natural"~"peak|volcano|hill"](around:${radius},${c.lat},${c.lon});`).join('') + ');out body;';
    try { elements = await overpass(q); } catch (e) { error = e.message || 'offline'; }
  }
  const used = new Set();
  const res = cands.map(c => {
    let best = null, bestD = radius + 1;
    elements.forEach(el => {
      const d = distM(c.lat, c.lon, el.lat, el.lon);
      if (d < bestD && !used.has(el.id) && peakName(el.tags)) { bestD = d; best = el; }
    });
    if (best) {
      used.add(best.id);
      return { name: peakName(best.tags), alt: parseEle(best.tags.ele) || Math.round(c.ele || 0), lat: best.lat, lon: best.lon };
    }
    return { name: '', alt: Math.round(c.ele || 0), lat: c.lat, lon: c.lon };
  });
  res.error = error;
  return res;
}
async function nearbyPeaks(lat, lon, radius = 3000) {
  const els = await overpass(`[out:json][timeout:20];node["natural"~"peak|volcano|hill"]["name"](around:${radius},${lat},${lon});out body;`);
  return els.map(el => ({ name: peakName(el.tags), alt: parseEle(el.tags.ele), lat: el.lat, lon: el.lon, dist: distM(lat, lon, el.lat, el.lon) }))
    .filter(p => p.name).sort((a, b) => a.dist - b.dist).slice(0, 40);
}

/* ------------------------------------------------------------------ Fotos: verkleinern, EXIF */
async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* weiter mit <img> */ }
  }
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
function canvasBlob(src, w, h, sx = 0, sy = 0, sw, sh, q = 0.85) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, sx, sy, sw || src.width, sh || src.height, 0, 0, w, h);
  return new Promise(res => c.toBlob(res, 'image/jpeg', q));
}
async function makePhoto(file) {
  const img = await loadImage(file);
  const iw = img.width, ih = img.height;
  const sc = Math.min(1, 1600 / Math.max(iw, ih));
  const blob = await canvasBlob(img, Math.round(iw * sc), Math.round(ih * sc));
  const side = Math.min(iw, ih);
  const thumb = await canvasBlob(img, 300, 300, (iw - side) / 2, (ih - side) / 2, side, side, 0.8);
  let exif = {};
  try { exif = readExif(await file.slice(0, 256 * 1024).arrayBuffer()); } catch (e) { /* ohne EXIF */ }
  return { blob, thumb, lat: exif.lat ?? null, lon: exif.lon ?? null, takenAt: exif.date || '' };
}
/* minimaler EXIF-Leser: Aufnahmedatum und GPS */
function readExif(buf) {
  const v = new DataView(buf);
  if (v.getUint16(0) !== 0xFFD8) return {};
  let off = 2;
  while (off < v.byteLength - 4) {
    const marker = v.getUint16(off), len = v.getUint16(off + 2);
    if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
    off += 2 + len;
  }
  return {};
}
function parseTiff(v, start) {
  const le = v.getUint16(start) === 0x4949;
  const u16 = o => v.getUint16(start + o, le), u32 = o => v.getUint32(start + o, le);
  const res = {};
  const readIfd = o => { const n = u16(o), m = {}; for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; m[u16(e)] = { type: u16(e + 2), count: u32(e + 4), off: e + 8 }; } return m; };
  const str = ent => { const p = ent.count > 4 ? u32(ent.off) : ent.off; let s = ''; for (let i = 0; i < ent.count - 1; i++) s += String.fromCharCode(v.getUint8(start + p + i)); return s; };
  const rat3 = ent => { const p = u32(ent.off); const r = i => u32(p + i * 8) / (u32(p + i * 8 + 4) || 1); return r(0) + r(1) / 60 + r(2) / 3600; };
  const ifd0 = readIfd(u32(4));
  if (ifd0[0x8769]) { const ex = readIfd(u32(ifd0[0x8769].off)); const d = ex[0x9003] || ex[0x9004]; if (d) res.date = str(d).slice(0, 10).replace(/:/g, '-'); }
  if (!res.date && ifd0[0x0132]) res.date = str(ifd0[0x0132]).slice(0, 10).replace(/:/g, '-');
  if (ifd0[0x8825]) {
    const gp = readIfd(u32(ifd0[0x8825].off));
    if (gp[2] && gp[4]) {
      let lat = rat3(gp[2]), lon = rat3(gp[4]);
      if (gp[1] && String.fromCharCode(v.getUint8(gp[1].off)) === 'S') lat = -lat;
      if (gp[3] && String.fromCharCode(v.getUint8(gp[3].off)) === 'W') lon = -lon;
      if (lat || lon) { res.lat = lat; res.lon = lon; }
    }
  }
  return res;
}

/* ------------------------------------------------------------------ Statistik */
const reached = t => t.summitReached !== false;
function toursOf(tours, year) { return year ? tours.filter(t => (t.date || '').startsWith(year)) : tours; }
function statTotals(tours) {
  const days = new Set(tours.map(t => t.date));
  return {
    tours: tours.length, days: days.size,
    ascent: tours.reduce((s, t) => s + (t.ascent || 0), 0),
    distance: tours.reduce((s, t) => s + (t.distance || 0), 0),
    minutes: tours.reduce((s, t) => s + (t.duration || 0), 0),
    summits: tours.filter(reached).length
  };
}
function summitRanking(tours) {
  return tours.filter(t => reached(t) && (t.summits || []).length)
    .map(t => ({ tour: t, summits: [...t.summits].sort((a, b) => (b.alt || 0) - (a.alt || 0)) }))
    .sort((a, b) => ((b.summits[0].alt || 0) - (a.summits[0].alt || 0)) || (b.tour.date || '').localeCompare(a.tour.date || ''));
}
function summitCounts(tours) {
  const m = {};
  tours.filter(reached).forEach(t => (t.summits || []).forEach(s => { const k = s.name.trim().toLowerCase(); m[k] = (m[k] || 0) + 1; }));
  return m;
}

/* ------------------------------------------------------------------ Erfolge */
const BADGES = [
  ['first_tour', '🥾', 'tours', 1], ['tours_10', '🎒', 'tours', 10], ['tours_50', '🏅', 'tours', 50], ['tours_100', '🏆', 'tours', 100],
  ['days_30', '📅', 'days', 30], ['summits_10', '⛰️', 'summits', 10], ['summits_50', '🏔️', 'summits', 50], ['summits_100', '👑', 'summits', 100],
  ['distinct_25', '🗻', 'distinct', 25], ['alt_3000', '3️⃣', 'maxAlt', 3000], ['alt_3500', '❄️', 'maxAlt', 3500], ['alt_4000', '💎', 'maxAlt', 4000],
  ['day_1500', '💪', 'ascentDay', 1500], ['day_2000', '🔥', 'ascentDay', 2000], ['everest', '🏔', 'ascentTotal', 8849],
  ['year_25000', '📈', 'ascentYear', 25000], ['year_50000', '🚀', 'ascentYear', 50000], ['km_500', '🛤️', 'distance', 500], ['km_1000', '🌍', 'distance', 1000],
  ['regions_5', '🗺️', 'regions', 5], ['regions_10', '🧭', 'regions', 10], ['allrounder', '🎯', 'activities', 4], ['homepeak', '🏠', 'samePeak', 5],
  ['skitours_10', '🎿', 'skitours', 10]
];
function badgeStats(tours, activities) {
  const ok = tours.filter(reached), sums = ok.flatMap(t => t.summits || []);
  const counts = summitCounts(tours), years = {};
  tours.forEach(t => { const y = (t.date || '').slice(0, 4); years[y] = (years[y] || 0) + (t.ascent || 0); });
  const skiIds = activities.filter(a => Grades.scalesFor(a.scales).includes('SKI_SAC')).map(a => a.id);
  return {
    tours: tours.length, days: new Set(tours.map(t => t.date)).size, summits: sums.length,
    distinct: Object.keys(counts).length, maxAlt: Math.max(0, ...sums.map(s => s.alt || 0)),
    ascentDay: Math.max(0, ...tours.map(t => t.ascent || 0)), ascentTotal: tours.reduce((s, t) => s + (t.ascent || 0), 0),
    ascentYear: Math.max(0, ...Object.values(years)), distance: tours.reduce((s, t) => s + (t.distance || 0), 0),
    regions: new Set(tours.map(t => t.regionId).filter(Boolean)).size, activities: new Set(tours.map(t => t.activityId)).size,
    samePeak: Math.max(0, ...Object.values(counts)), skitours: tours.filter(t => skiIds.includes(t.activityId)).length
  };
}
function evaluateBadges(tours, activities) {
  const st = badgeStats(tours, activities);
  return BADGES.map(([key, icon, stat, target]) => ({ key, icon, value: st[stat] || 0, target, earned: (st[stat] || 0) >= target, progress: Math.min(1, (st[stat] || 0) / target) }));
}
