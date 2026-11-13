/* Bergtagebuch Web – Eingabe, Statistik, Mehr, Verwaltung, Backup, GPX-Import */
'use strict';

/* ------------------------------------------------------------------ Tour erfassen / bearbeiten */
function trackFromGpx(g, max = 2000) {
  const P = g.points, step = Math.max(1, Math.ceil(P.length / max)), out = [];
  for (let i = 0; i < P.length; i += step) out.push([+P[i][0].toFixed(6), +P[i][1].toFixed(6), P[i][2] == null || isNaN(P[i][2]) ? null : Math.round(P[i][2])]);
  const l = P[P.length - 1];
  out.push([+l[0].toFixed(6), +l[1].toFixed(6), l[2] == null || isNaN(l[2]) ? null : Math.round(l[2])]);
  return out;
}
function gpxFromTrack(pts) { const g = { points: pts.map(p => [p[0], p[1], p[2], 0]), name: '' }; computeGpx(g); return g; }

async function openEdit(id, onSaved) {
  const isNew = id == null;
  const orig = isNew ? null : tourById(id);
  const lastAct = await DB.kvGet('lastActivity', 1);
  const t = isNew ? { date: todayIso(), activityId: S.activities.some(a => a.id === lastAct) ? lastAct : S.activities[0].id, regionId: null, title: '', start: '',
    lat: null, lon: null, ascent: null, descent: null, distance: null, summitAlt: null, duration: 0, grade: '', avalanche: 0, weather: '', summitReached: true,
    rating: 0, conditions: '', features: '', description: '', persons: [], summits: [], coverId: null } : JSON.parse(JSON.stringify(orig));
  t.persons = t.persons || []; t.summits = t.summits || [];
  /* Fotos: vorhandene aus der DB, neue erst beim Speichern schreiben */
  const photos = isNew ? [] : (await DB.byIndex('photos', 'tourId', id)).sort((a, b) => (a.order || 0) - (b.order || 0));
  const removed = [];
  let coverKey = t.coverId || null, tmpKey = 0;
  let gpx = null, trackChanged = false, trackRemoved = false;
  const oldTrack = isNew ? null : await DB.get('tracks', id);
  let hasTrack = !!oldTrack;
  let dirty = false, dateTouched = !isNew;
  const touch = () => { dirty = true; };

  const pg = makePage({ title: T(isNew ? 'new_tour' : 'edit_tour'), back: true, actions: `<button class="tb" id="sv">${esc(T('save'))}</button>` });
  pushPage(pg, { beforeClose: async () => !dirty || await confirmBox(T('discard_question'), T('discard'), T('discard_title'), true) });
  const w = h('<div class="wrap"></div>'); pg.content.appendChild(w);
  const actOpts = () => S.activities.map(a => `<option value="${a.id}" ${a.id === t.activityId ? 'selected' : ''}>${a.icon} ${esc(pickName(a))}</option>`).join('')
    + `<option value="new">➕ ${esc(T('activity_add_own'))}</option><option value="manage">⚙️ ${esc(T('activity_manage'))}</option>`;
  const v = x => x == null ? '' : x;
  /* optionale Bereiche: je nach Einstellung auf- oder zugeklappt */
  const grpOpen = {};
  for (const k of ['rating', 'grade', 'persons', 'place', 'texts'])
    grpOpen[k] = S.formMode === 'closed' ? false : S.formMode === 'remember' ? await DB.kvGet('grp_' + k, true) : true;
  const grp = (k, icon, body) => `<div class="grp ${grpOpen[k] ? '' : 'closed'}" data-g="${k}"><button class="grp-h" type="button"><span>${icon}</span><span class="t">${esc(T('grp_' + k))}</span><span class="cnt"></span><span class="arr">▾</span></button><div class="grp-b">${body}</div></div>`;
  w.innerHTML = `
    <div class="card">
      <div class="grid2 stack">
        <div class="field"><label>${esc(T('f_date'))}</label><input class="inp" type="date" id="e_date" value="${esc(t.date)}"></div>
        <div class="field"><label>${esc(T('f_activity'))}</label><select class="inp" id="e_act">${actOpts()}</select></div>
      </div>
      <div class="field"><label>${esc(T('f_title'))}</label><input class="inp" id="e_title" value="${esc(t.title)}" placeholder="${esc(T('f_title_hint'))}"></div>
      <div class="field"><label>${esc(T('f_region'))}</label><select class="inp" id="e_reg"><option value="">–</option>${S.regions.map(r => `<option value="${r.id}" ${r.id === t.regionId ? 'selected' : ''}>${esc(pickName(r))}</option>`).join('')}</select></div>
    </div>
    <div class="card"><div class="lbl">🧭 ${esc(T('f_gpx'))}</div><div class="row"><div class="grow small" id="e_gpxst"></div><button class="btn sec2" id="e_gpx">${esc(T('gpx_import'))}</button></div></div>
    <div class="card">
      <div class="grid2">
        <div class="field"><label>${esc(T('f_ascent'))}</label><div class="unit"><input class="inp" id="e_asc" inputmode="numeric" value="${v(t.ascent)}"><span>m</span></div></div>
        <div class="field"><label>${esc(T('f_descent'))}</label><div class="unit"><input class="inp" id="e_desc" inputmode="numeric" value="${v(t.descent)}"><span>m</span></div></div>
        <div class="field"><label>${esc(T('f_distance'))}</label><div class="unit"><input class="inp" id="e_dist" inputmode="decimal" value="${t.distance != null ? String(+t.distance.toFixed(2)).replace('.', I18N.code === 'en' ? '.' : ',') : ''}"><span>km</span></div></div>
        <div class="field"><label>${esc(T('f_summit_alt'))}</label><div class="unit"><input class="inp" id="e_salt" inputmode="numeric" value="${v(t.summitAlt)}"><span>m</span></div></div>
      </div>
      <div class="field"><label>${esc(T('f_duration'))}</label><div class="grid2">
        <div class="unit"><input class="inp" id="e_dh" inputmode="numeric" value="${t.duration ? Math.floor(t.duration / 60) : ''}"><span>h</span></div>
        <div class="unit"><input class="inp" id="e_dm" inputmode="numeric" value="${t.duration ? t.duration % 60 : ''}"><span>min</span></div></div></div>
    </div>
    <div class="card" id="e_sumcard"><div class="lbl">⛰️ ${esc(T('summits'))}</div><div>
      <button class="chip" id="s_add">＋ ${esc(T('summit_add'))}</button><button class="chip" id="s_det">🔎 ${esc(T('summit_detect'))}</button><button class="chip" id="s_near">📍 ${esc(T('summit_near'))}</button></div>
      <div id="e_sums"></div>
      <label class="check"><input type="checkbox" id="e_reached" ${t.summitReached !== false ? 'checked' : ''}>${esc(T('f_summit_reached'))}</label></div>
    <div class="card"><div class="lbl">📷 ${esc(T('photos'))}</div><div class="gallery" id="e_ph"></div></div>
    ${grp('rating', '⭐', `<div class="lbl">${esc(T('f_rating'))}</div><div class="starsel" id="e_rate"></div>
      <div class="lbl" style="margin-top:0.625rem">${esc(T('f_weather'))}</div><div id="e_wx">${Object.keys(WEATHER).map(k => `<button class="chip ${t.weather === k ? 'sel' : ''}" data-w="${k}">${WEATHER[k]} ${esc(T('w_' + k))}</button>`).join('')}</div>`)}
    ${grp('grade', '🧗', `<div id="e_grade"></div><div id="e_aval"></div>`)}
    ${grp('persons', '👥', `<div id="e_pers"></div>
      <div class="row" style="margin-top:0.375rem"><input class="inp grow" id="e_pin" list="e_plist" placeholder="${esc(T('f_persons_hint'))}" autocomplete="off"><button class="btn sec2" id="e_padd">＋</button></div>
      <datalist id="e_plist">${allPersons().map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>`)}
    ${grp('place', '📍', `<div class="field"><label>${esc(T('f_start'))}</label><input class="inp" id="e_start" value="${esc(t.start)}" placeholder="${esc(T('f_start_hint'))}"></div>
      <div class="lbl">${esc(T('f_position'))}</div><div class="small" id="e_pos"></div>
      <div class="row" style="margin-top:0.5rem"><button class="btn sec2 grow" id="e_pmap">🗺️ ${esc(T('pos_map'))}</button><button class="btn sec2 grow" id="e_pgps">📍 ${esc(T('pos_gps'))}</button></div>`)}
    ${grp('texts', '📝', `<div class="field"><label>${esc(T('f_description'))}</label><textarea class="inp" id="e_descr" placeholder="${esc(T('f_description_hint'))}">${esc(t.description)}</textarea></div>
      <div class="field"><label>${esc(T('f_conditions'))}</label><textarea class="inp" id="e_cond" placeholder="${esc(T('f_conditions_hint'))}">${esc(t.conditions)}</textarea></div>
      <div class="field"><label>${esc(T('f_features'))}</label><textarea class="inp" id="e_feat" placeholder="${esc(T('f_features_hint'))}">${esc(t.features)}</textarea></div>`)}
    <button class="btn block" id="sv2" style="margin-top:0.375rem">${esc(T('save'))}</button>`;
  w.addEventListener('input', touch);
  const E = id2 => $('#' + id2, w);
  const filled = k => {
    const nz = id2 => E(id2) && E(id2).value.trim() ? 1 : 0;
    switch (k) {
      case 'rating': return (t.rating ? 1 : 0) + (t.weather ? 1 : 0);
      case 'grade': return (t.grade ? 1 : 0) + (t.avalanche ? 1 : 0);
      case 'persons': return t.persons.length;
      case 'place': return nz('e_start') + (t.lat != null ? 1 : 0);
      case 'texts': return nz('e_descr') + nz('e_cond') + nz('e_feat');
    }
    return 0;
  };
  const drawCounts = () => $$('.grp', w).forEach(g => { const n = filled(g.dataset.g); $('.cnt', g).textContent = n && g.classList.contains('closed') ? '✓ ' + fill(T('grp_filled'), { n }) : ''; });
  $$('.grp-h', w).forEach(b => b.onclick = () => {
    const g = b.parentElement, k = g.dataset.g, open = g.classList.toggle('closed') === false;
    if (S.formMode === 'remember') DB.kvSet('grp_' + k, open);
    drawCounts();
  });

  /* --- Aktivität, Schwierigkeit, Lawinenstufe */
  const drawGrade = () => {
    const a = actById(t.activityId), scales = Grades.scalesFor(a.scales);
    let [key, val] = Grades.decode(t.grade);
    if (!key && val && scales.length === 1 && scales[0] === 'FREE') key = 'FREE';
    if (!scales.includes(key)) { if (key || val) { /* alte Skala behalten */ if (key) scales.push(key); } else key = scales[0]; }
    if (!key) key = scales[0];
    const opts = Grades.options[key];
    E('e_grade').innerHTML = `<div class="field"><label>${esc(T('f_grade'))}</label><div class="${scales.length > 1 ? 'grid2' : ''}">
      ${scales.length > 1 ? `<select class="inp" id="g_sc">${scales.map(k => `<option value="${k}" ${k === key ? 'selected' : ''}>${esc(Grades.longName(k))}</option>`).join('')}</select>` : ''}
      ${opts ? `<select class="inp" id="g_v"><option value="">–</option>${opts.map(o => `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${esc(Grades.valueLabel(key, o))}</option>`).join('')}</select>`
        : `<input class="inp" id="g_v" value="${esc(val)}" placeholder="${esc(T('f_grade_hint'))}">`}</div></div>`;
    const sc = E('g_sc');
    if (sc) sc.onchange = () => { t.grade = Grades.encode(sc.value, ''); touch(); drawGrade(); };
    E('g_v').oninput = E('g_v').onchange = () => { const k = sc ? sc.value : key; t.grade = E('g_v').value ? Grades.encode(k, E('g_v').value) : ''; touch(); };
    const ski = Grades.isSkiTour(a.scales);
    E('e_aval').innerHTML = ski ? `<div class="field"><label>${esc(T('f_avalanche'))}</label><select class="inp" id="g_av"><option value="0">–</option>${[1, 2, 3, 4, 5].map(i => `<option value="${i}" ${t.avalanche === i ? 'selected' : ''}>${esc(T('aval_' + i))}</option>`).join('')}</select></div>` : '';
    if (ski) E('g_av').onchange = e => { t.avalanche = +e.target.value; touch(); };
  };
  drawGrade();
  E('e_act').onchange = async e => {
    const val = e.target.value;
    if (val === 'new') {
      const a = await editActivity(null);
      if (a) t.activityId = a.id;
      E('e_act').innerHTML = actOpts();
    } else if (val === 'manage') {
      E('e_act').value = t.activityId;
      openManageActivities(() => { E('e_act').innerHTML = actOpts(); });
      return;
    } else {
      t.activityId = +val;
      const [k] = Grades.decode(t.grade);
      if (k && !Grades.scalesFor(actById(t.activityId).scales).includes(k)) t.grade = '';
    }
    E('e_act').value = t.activityId;
    drawGrade();
  };
  E('e_date').onchange = () => { dateTouched = true; };

  /* --- Wetter, Bewertung */
  $$('[data-w]', w).forEach(b => b.onclick = () => { t.weather = t.weather === b.dataset.w ? '' : b.dataset.w; $$('[data-w]', w).forEach(x => x.classList.toggle('sel', x.dataset.w === t.weather)); touch(); });
  const drawRate = () => {
    E('e_rate').innerHTML = [1, 2, 3, 4, 5].map(i => `<button data-r="${i}" class="${i <= t.rating ? 'on' : ''}">${i <= t.rating ? '★' : '☆'}</button>`).join('');
    $$('[data-r]', w).forEach(b => b.onclick = () => { t.rating = t.rating === +b.dataset.r ? 0 : +b.dataset.r; touch(); drawRate(); });
  };
  drawRate();

  /* --- Begleiter */
  const drawPersons = () => {
    E('e_pers').innerHTML = t.persons.map((p, i) => `<span class="chip">${esc(p)}<button class="x" data-i="${i}">✕</button></span>`).join('');
    $$('#e_pers .x', w).forEach(b => b.onclick = () => { t.persons.splice(+b.dataset.i, 1); touch(); drawPersons(); });
  };
  const addPerson = () => {
    const n = E('e_pin').value.trim();
    if (n && !t.persons.some(p => p.toLowerCase() === n.toLowerCase())) { t.persons.push(n); touch(); drawPersons(); }
    E('e_pin').value = '';
  };
  E('e_padd').onclick = addPerson;
  E('e_pin').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } };
  E('e_pin').onchange = () => { if (allPersons().some(p => p.name === E('e_pin').value)) addPerson(); };
  drawPersons();

  /* --- Position */
  const drawPos = () => {
    E('e_pos').innerHTML = t.lat != null ? `${t.lat.toFixed(5)}, ${t.lon.toFixed(5)} <button class="chip" id="p_clr" style="margin-left:0.375rem">✕</button>` : `<span class="muted">${esc(T('pos_none'))}</span>`;
    const c = E('p_clr'); if (c) c.onclick = () => { t.lat = t.lon = null; touch(); drawPos(); };
  };
  drawPos();
  E('e_pmap').onclick = async () => { const p = await pickPosition(t.lat, t.lon); if (p) { t.lat = p.lat; t.lon = p.lon; touch(); drawPos(); } };
  E('e_pgps').onclick = () => getPosition().then(p => {
    t.lat = +p.lat.toFixed(6); t.lon = +p.lon.toFixed(6);
    if (!E('e_salt').value && p.alt) E('e_salt').value = Math.round(p.alt);
    touch(); drawPos(); toast(T('gps_ok'));
  }).catch(m => toast(m, 4000));

  /* --- Gipfel */
  const drawSummits = () => {
    E('e_sums').innerHTML = t.summits.length ? t.summits.map((s, i) => `<div class="sum-row" data-i="${i}"><span class="grow">${esc(s.name)}</span><b>${s.alt ? fmtInt(s.alt) + ' m' : ''}</b><span class="muted">›</span></div>`).join('') : '';
    $$('#e_sums .sum-row', w).forEach(r => r.onclick = async () => {
      const i = +r.dataset.i, res = await summitDialog(t.summits[i], true);
      if (res === 'delete') t.summits.splice(i, 1); else if (res) t.summits[i] = res; else return;
      touch(); drawSummits(); syncSummitAlt();
    });
  };
  const syncSummitAlt = () => { if (t.summits.length) { const m = Math.max(...t.summits.map(s => s.alt || 0)); if (m && !num(E('e_salt').value)) E('e_salt').value = m; } };
  drawSummits();
  E('s_add').onclick = async () => { const r = await summitDialog(null, false); if (r) { t.summits.push(r); touch(); drawSummits(); syncSummitAlt(); } };
  const addFound = list => {
    let n = 0;
    list.forEach(s => {
      if (!s.name) s.name = fill(T('summit_unnamed'), { h: fmtInt(s.alt) });
      const dup = t.summits.some(x => x.name.toLowerCase() === s.name.toLowerCase() || (x.lat != null && s.lat != null && distM(x.lat, x.lon, s.lat, s.lon) < 150));
      if (!dup) { t.summits.push({ name: s.name, alt: s.alt || 0, lat: s.lat, lon: s.lon }); n++; }
    });
    return n;
  };
  const detect = async (quiet) => {
    let cands = [];
    const g = gpx || (hasTrack && !trackRemoved && oldTrack ? gpxFromTrack(oldTrack.pts) : null);
    if (g && g.hasEle) cands = findPeaks(g);
    else if (t.lat != null) cands = [{ lat: t.lat, lon: t.lon, ele: num(E('e_salt').value) || 0 }];
    if (!cands.length) { if (!quiet) toast(T('summit_need_pos'), 3500); return; }
    const b = quiet ? null : busy(T('summit_searching'));
    const res = await lookupPeaks(cands);
    if (b) b.close();
    if (res.error) { if (!quiet) toast(T('summit_offline'), 3500); return; }
    /* automatisch nur benannte Gipfel übernehmen, beim Antippen auch unbenannte Hochpunkte */
    const n = addFound(quiet ? res.filter(s => s.name) : res);
    if (n) { touch(); drawSummits(); syncSummitAlt(); toast(fill(T('summit_found'), { n }), 4000); }
    else if (!quiet) toast(res.error ? T('summit_offline') : T('summit_none_found'));
  };
  E('s_det').onclick = () => detect(false);
  E('s_near').onclick = async () => {
    let lat = t.lat, lon = t.lon;
    if (lat == null && gpx) { lat = gpx.maxLat; lon = gpx.maxLon; }
    if (lat == null) { toast(T('summit_near_need_pos'), 3500); return; }
    const b = busy(T('summit_searching'));
    let list = [];
    try { list = await nearbyPeaks(lat, lon); } catch (e) { b.close(); toast(T('summit_offline')); return; }
    b.close();
    if (!list.length) { toast(T('summit_none_found')); return; }
    const p = await choose(T('summit_near_title'), list.map(s => ({ label: `${s.name}${s.alt ? ' · ' + fmtInt(s.alt) + ' m' : ''} · ${s.dist < 1000 ? Math.round(s.dist) + ' m' : fmtKm(s.dist / 1000) + ' km'}`, value: s, icon: '⛰️' })));
    if (p && addFound([p])) { touch(); drawSummits(); syncSummitAlt(); }
  };

  /* --- GPX */
  const drawGpxState = () => {
    E('e_gpxst').innerHTML = (gpx || (hasTrack && !trackRemoved)) ? `✅ ${esc(T('gpx_attached'))} <button class="chip" id="gx_clr">✕</button>` : `<span class="muted">${esc(T('gpx_none'))}</span>`;
    const c = E('gx_clr'); if (c) c.onclick = () => { gpx = null; trackRemoved = true; trackChanged = true; touch(); drawGpxState(); };
  };
  drawGpxState();
  E('e_gpx').onclick = async () => {
    const files = await pickFiles(isIOS() ? '' : '.gpx,application/gpx+xml,application/xml,text/xml', false);
    if (!files.length) return;
    let g = null;
    try { g = parseGpx(await files[0].text()); } catch (e) { toast(T('gpx_error')); return; }
    if (!g) { toast(T('gpx_invalid'), 3500); return; }
    gpx = g; trackChanged = true; trackRemoved = false;
    E('e_dist').value = String(+g.distanceKm.toFixed(2)).replace('.', I18N.code === 'en' ? '.' : ',');
    if (g.hasEle) { E('e_asc').value = Math.round(g.ascent); E('e_desc').value = Math.round(g.descent); E('e_salt').value = Math.round(g.maxEle); t.lat = +g.maxLat.toFixed(6); t.lon = +g.maxLon.toFixed(6); }
    else { const m = g.points[Math.floor(g.points.length / 2)]; t.lat = +m[0].toFixed(6); t.lon = +m[1].toFixed(6); }
    if (g.durationMin) { E('e_dh').value = Math.floor(g.durationMin / 60); E('e_dm').value = g.durationMin % 60; }
    if (g.startDate && (!dateTouched || isNew)) { E('e_date').value = g.startDate; }
    if (!E('e_title').value.trim() && g.name) E('e_title').value = g.name;
    touch(); drawPos(); drawGpxState();
    toast(T('gpx_applied'), 3000);
    if (!t.summits.length && g.hasEle) detect(true);
  };

  /* --- Fotos */
  const drawPhotos = () => {
    const g = E('e_ph');
    g.innerHTML = '';
    photos.forEach((p, i) => {
      const key = p.id || p._key;
      const b = h(`<button class="g">${key === coverKey || (!coverKey && i === 0) ? '<span class="badge">⭐</span>' : ''}</button>`);
      if (p.id) thumbUrl(p.id).then(u => b.style.backgroundImage = `url("${u}")`);
      else { if (!p._url) p._url = URL.createObjectURL(p.thumb); b.style.backgroundImage = `url("${p._url}")`; }
      b.onclick = () => openViewer(photos, i, {
        onCover: ph => { coverKey = ph.id || ph._key; touch(); drawPhotos(); },
        onRemove: ph => { const j = photos.indexOf(ph); if (j >= 0) photos.splice(j, 1); if (ph.id) removed.push(ph.id); if (coverKey === (ph.id || ph._key)) coverKey = null; touch(); drawPhotos(); }
      });
      g.appendChild(b);
    });
    const add = h('<button class="g add">＋</button>');
    add.onclick = addPhotos;
    g.appendChild(add);
  };
  const addPhotos = async () => {
    let files = await pickFiles('image/*', true);
    if (!files.length) return;
    const MAX = 30;
    if (files.length > MAX) { toast(fill(T('photo_max'), { n: MAX }), 3500); files = files.slice(0, MAX); }
    const b = busy(T('photo_working'));
    let failed = 0, posSet = false, dateSet = false;
    for (let i = 0; i < files.length; i++) {
      b.set(fill(T('photo_working_n'), { i: i + 1, n: files.length }));
      try {
        const p = await makePhoto(files[i]);
        p._key = 'n' + (++tmpKey);
        photos.push(p);
        if (t.lat == null && p.lat != null) { t.lat = +p.lat.toFixed(6); t.lon = +p.lon.toFixed(6); posSet = true; }
        if (isNew && !dateTouched && !gpx && p.takenAt && /^\d{4}-\d\d-\d\d$/.test(p.takenAt)) { E('e_date').value = p.takenAt; dateTouched = true; dateSet = true; }
      } catch (e) { failed++; }
    }
    b.close();
    touch(); drawPhotos(); drawPos();
    const msgs = [];
    if (failed) msgs.push(fill(T('photo_error_n'), { n: failed }));
    if (posSet) msgs.push(T('pos_from_photo'));
    if (dateSet) msgs.push(T('date_from_photo'));
    if (msgs.length) toast(msgs.join('\n'), 3500);
  };
  drawPhotos();
  drawCounts();

  /* --- Speichern */
  const save = async () => {
    const title = E('e_title').value.trim();
    if (!title) { toast(T('title_required')); E('e_title').focus(); return; }
    const bz = busy(T('save') + ' …');
    try {
      Object.assign(t, {
        title, date: E('e_date').value || todayIso(), regionId: E('e_reg').value ? +E('e_reg').value : null, start: E('e_start').value.trim(),
        ascent: num(E('e_asc').value), descent: num(E('e_desc').value), distance: num(E('e_dist').value), summitAlt: num(E('e_salt').value),
        duration: (parseInt(E('e_dh').value, 10) || 0) * 60 + (parseInt(E('e_dm').value, 10) || 0),
        summitReached: E('e_reached').checked, description: E('e_descr').value.trim(), conditions: E('e_cond').value.trim(), features: E('e_feat').value.trim()
      });
      if (t.ascent != null) t.ascent = Math.round(t.ascent);
      if (t.descent != null) t.descent = Math.round(t.descent);
      if (t.summitAlt != null) t.summitAlt = Math.round(t.summitAlt);
      if (E('g_v')) { const sc = E('g_sc'); const val = E('g_v').value.trim(); const k = sc ? sc.value : Grades.decode(t.grade)[0] || Grades.scalesFor(actById(t.activityId).scales)[0]; t.grade = val ? Grades.encode(k, val) : ''; }
      if (!Grades.isSkiTour(actById(t.activityId).scales)) t.avalanche = 0;
      if (gpx) t.gpxName = gpx.name || '';
      t.hasTrack = gpx ? true : (trackRemoved ? false : hasTrack);
      if (isNew) t.created = Date.now();
      t.updated = Date.now();
      const tid = await DB.put('tours', t);
      t.id = tid;
      for (const rid of removed) await DB.del('photos', rid);
      dropThumbs(removed);
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        if (p.id) { if ((p.order || 0) !== i) { p.order = i; await DB.put('photos', p); } continue; }
        const rec = { tourId: tid, blob: p.blob, thumb: p.thumb, lat: p.lat, lon: p.lon, takenAt: p.takenAt, order: i };
        p.id = await DB.put('photos', rec);
        if (p._url) URL.revokeObjectURL(p._url);
        if (coverKey === p._key) coverKey = p.id;
      }
      const cover = photos.find(p => p.id === coverKey) || photos[0];
      t.coverId = cover ? cover.id : null;
      await DB.put('tours', t);
      if (trackChanged) { if (gpx) await DB.put('tracks', { tourId: tid, pts: trackFromGpx(gpx) }); else await DB.del('tracks', tid); }
      await DB.kvSet('lastActivity', t.activityId);
      bz.close();
      dirty = false;
      toast('✓ ' + T('saved'));
      const before = new Set(evaluateBadges(S.tours, S.activities).filter(b => b.earned).map(b => b.key));
      S.tours = await DB.all('tours');
      const fresh = evaluateBadges(S.tours, S.activities).filter(b => b.earned && !before.has(b.key));
      popSilently();
      if (onSaved) onSaved(tid); else { renderTab(); if (isNew) setTimeout(() => openDetail(tid), 60); }
      if (fresh.length) setTimeout(() => alertBox(fresh.map(b => b.icon + ' ' + T('badge_' + b.key) + '\n' + T('badge_' + b.key + '_d')).join('\n\n'), '🎉 ' + T('badge_new')), 500);
    } catch (e) {
      bz.close();
      console.error(e);
      alertBox(T('save_failed') + '\n\n' + (e && e.message || e));
    }
  };
  $('#sv', pg.el).onclick = save;
  E('sv2').onclick = save;
}

function summitDialog(s, canDelete) {
  const html = `<div class="field"><label>${esc(T('summit_name'))}</label><input class="inp" id="sd_n" value="${esc(s ? s.name : '')}" placeholder="${esc(T('summit_name_hint'))}"></div>
    <div class="field"><label>${esc(T('summit_alt'))}</label><input class="inp" id="sd_a" inputmode="numeric" value="${s && s.alt ? s.alt : ''}"></div>`;
  const btns = [{ label: T('cancel'), value: null }];
  if (canDelete) btns.push({ label: T('delete'), value: 'delete', cls: 'danger' });
  btns.push({ label: 'OK', check: ovl => { if (!$('#sd_n', ovl).value.trim()) { toast(T('name_required')); return false; } return true; },
    value: ovl => ({ ...(s || {}), name: $('#sd_n', ovl).value.trim(), alt: Math.round(num($('#sd_a', ovl).value) || 0) }) });
  return dialog({ title: '⛰️ ' + T('summits'), html, buttons: btns, onOpen: ovl => setTimeout(() => !s && $('#sd_n', ovl).focus(), 50) });
}

/* ------------------------------------------------------------------ Statistik */
function renderStats(v) {
  const pg = makePage({ title: T('tab_stats') });
  v.appendChild(pg.el);
  const w = h('<div class="wrap"></div>'); pg.content.appendChild(w);
  const yrs = years();
  if (S.statYear && !yrs.includes(S.statYear)) S.statYear = '';
  w.innerHTML = `<div class="years"><button class="chip ${!S.statYear ? 'sel' : ''}" data-y="">${esc(T('all_years'))}</button>${yrs.map(y => `<button class="chip ${S.statYear === y ? 'sel' : ''}" data-y="${y}">${y}</button>`).join('')}</div><div id="sb"></div>`;
  $$('[data-y]', w).forEach(b => b.onclick = () => { S.statYear = b.dataset.y; renderTab(); });
  const sb = $('#sb', w);
  const tours = toursOf(S.tours, S.statYear);
  if (!tours.length) { sb.innerHTML = `<div class="empty"><span class="big">📊</span>${esc(T('stats_empty'))}</div>`; drawBadges(sb); return; }
  const tot = statTotals(tours);
  const prev = S.statYear ? statTotals(toursOf(S.tours, String(+S.statYear - 1))) : null;
  const cmp = (a, b) => { if (!prev || !b) return ''; const d = a - b; return `<div class="cmp ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${fmtInt(Math.abs(d))} ${esc(T('prev_year'))}</div>`; };
  let html = `<div class="tiles">
    <div class="tile"><b>${fmtInt(tot.tours)}</b><small>${esc(T('st_tours'))}</small>${cmp(tot.tours, prev && prev.tours)}</div>
    <div class="tile"><b>${fmtInt(tot.ascent)}</b><small>${esc(T('st_ascent'))}</small>${cmp(tot.ascent, prev && prev.ascent)}</div>
    <div class="tile"><b>${fmtKm(tot.distance)}</b><small>${esc(T('st_distance'))}</small>${cmp(Math.round(tot.distance), prev && Math.round(prev.distance))}</div>
    <div class="tile"><b>${fmtInt(tot.minutes / 60)}</b><small>${esc(T('st_hours'))}</small></div>
    <div class="tile"><b>${fmtInt(tot.days)}</b><small>${esc(T('st_days'))}</small></div>
    <div class="tile"><b>${fmtInt(tot.summits)}</b><small>${esc(T('st_summits'))}</small></div></div>`;
  if (tot.ascent >= 885) html += `<div class="hint-box" style="margin-top:0.625rem">🏔️ ${esc(fill(T('st_everest'), { x: (tot.ascent / 8849).toLocaleString(locale(), { maximumFractionDigits: 1 }) }))}</div>`;
  /* nach Aktivität */
  const byAct = {};
  tours.forEach(t => { const o = byAct[t.activityId] || (byAct[t.activityId] = { n: 0, asc: 0 }); o.n++; o.asc += t.ascent || 0; });
  const actRows = Object.entries(byAct).sort((a, b) => b[1].n - a[1].n);
  const maxN = Math.max(...actRows.map(r => r[1].n));
  html += `<div class="sec">${esc(T('st_by_activity'))}</div><div class="card">${actRows.map(([id, o]) => { const a = actById(+id); return `<div class="hbar"><span class="lab">${a.icon} ${esc(pickName(a))}</span><span class="trk"><i style="width:${o.n / maxN * 100}%;background:${a.color}"></i></span><span class="val">${o.n} · ${fmtInt(o.asc)} m</span></div>`; }).join('')}</div>`;
  /* pro Monat (Jahr) oder pro Jahr (alle) */
  let bars;
  if (S.statYear) {
    const ms = T('months_short').split(','), m = new Array(12).fill(0);
    tours.forEach(t => { const i = parseInt((t.date || '').slice(5, 7), 10) - 1; if (i >= 0) m[i] += t.ascent || 0; });
    bars = m.map((x, i) => [ms[i], x]);
    html += `<div class="sec">${esc(T('st_by_month'))}</div>`;
  } else {
    const ys = [...yrs].reverse().slice(-12);
    bars = ys.map(y => [y.slice(2), toursOf(S.tours, y).reduce((s, t) => s + (t.ascent || 0), 0)]);
    html += `<div class="sec">${esc(T('st_by_year'))}</div>`;
  }
  const mx = Math.max(1, ...bars.map(b => b[1])), mi = bars.findIndex(b => b[1] === mx);
  html += `<div class="card"><div class="months">${bars.map((b, i) => `<div>${i === mi && b[1] ? `<em>${fmtInt(b[1])}</em>` : ''}<span class="b"><i style="height:${b[1] / mx * 100}%"></i></span>${esc(b[0])}</div>`).join('')}</div>${S.statYear ? `<div class="small muted" style="margin-top:0.375rem">${esc(T('st_month_hint'))}</div>` : ''}</div>`;
  /* Rekorde */
  const recs = [];
  const ranking = summitRanking(tours);
  if (ranking.length) recs.push([T('rec_highest'), ranking[0].summits[0].name + ' · ' + fmtInt(ranking[0].summits[0].alt) + ' m', ranking[0].tour]);
  const ma = [...tours].sort((a, b) => (b.ascent || 0) - (a.ascent || 0))[0];
  if (ma && ma.ascent) recs.push([T('rec_ascent'), fmtInt(ma.ascent) + ' m · ' + ma.title, ma]);
  const md = [...tours].sort((a, b) => (b.distance || 0) - (a.distance || 0))[0];
  if (md && md.distance) recs.push([T('rec_distance'), fmtKm(md.distance) + ' km · ' + md.title, md]);
  if (recs.length) html += `<div class="sec">🏆 ${esc(T('st_records'))}</div><div class="list">${recs.map(r => `<div class="item" data-open="${r[2].id}"><div class="grow"><div class="small muted">${esc(r[0])}</div><div>${esc(r[1])}</div></div><span class="chev">›</span></div>`).join('')}</div>`;
  /* Gipfel-Rangliste */
  if (ranking.length) {
    const counts = summitCounts(tours), nSum = ranking.reduce((s, r) => s + r.summits.length, 0);
    html += `<div class="sec">⛰️ ${esc(T('st_summit_ranking'))}</div><div class="card"><div class="small muted">${esc(fill(T('st_summit_counts'), { n: nSum, d: Object.keys(counts).length }))}</div><div id="rk"></div></div>`;
  }
  /* Begleiter, Regionen */
  const pc = {}; tours.forEach(t => (t.persons || []).forEach(p => pc[p] = (pc[p] || 0) + 1));
  const topP = Object.entries(pc).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topP.length) html += `<div class="sec">👥 ${esc(T('st_top_persons'))}</div><div class="card">${topP.map(([n, c]) => `<div class="hbar"><span class="lab">${esc(n)}</span><span class="trk"><i style="width:${c / topP[0][1] * 100}%;background:var(--sun)"></i></span><span class="val">${c}</span></div>`).join('')}</div>`;
  const rc = {}; tours.forEach(t => { if (t.regionId) rc[t.regionId] = (rc[t.regionId] || 0) + 1; });
  const topR = Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topR.length) html += `<div class="sec">🗺️ ${esc(T('st_top_regions'))}</div><div class="card">${topR.map(([id, c]) => `<div class="hbar"><span class="lab">${esc(pickName(regById(+id)) || '?')}</span><span class="trk"><i style="width:${c / topR[0][1] * 100}%;background:var(--accent)"></i></span><span class="val">${c}</span></div>`).join('')}</div>`;
  sb.innerHTML = html;
  $$('[data-open]', sb).forEach(el => el.onclick = () => openDetail(+el.dataset.open));
  if (ranking.length) {
    let all = false;
    const drawRank = () => {
      const show = all ? ranking : ranking.slice(0, 10);
      $('#rk', sb).innerHTML = show.map((r, i) => `<div class="rank" data-open="${r.tour.id}"><span class="n">${i + 1}.</span><div class="grow">
        <div class="row"><b class="grow">${esc(r.summits[0].name)}</b><span class="alt">${fmtInt(r.summits[0].alt)} m</span></div>
        ${r.summits.slice(1).map(s => `<div class="row sub2"><span class="grow">+ ${esc(s.name)}</span><span>${fmtInt(s.alt)} m</span></div>`).join('')}
        <div class="small muted">${actById(r.tour.activityId).icon} ${fmtDate(r.tour.date)} · ${esc(r.tour.title)}</div></div></div>`).join('')
        + (ranking.length > 10 ? `<button class="btn sec2 block" id="rkm" style="margin-top:0.5rem">${esc(all ? T('show_less') : fill(T('show_all'), { n: ranking.length }))}</button>` : '');
      $$('#rk [data-open]', sb).forEach(el => el.onclick = () => openDetail(+el.dataset.open));
      const m = $('#rkm', sb); if (m) m.onclick = () => { all = !all; drawRank(); };
    };
    drawRank();
  }
  drawBadges(sb);
}
function drawBadges(root) {
  const bs = evaluateBadges(S.tours, S.activities), n = bs.filter(b => b.earned).length;
  const el = h(`<div><div class="sec">🎖️ ${esc(T('badges'))}</div><div class="small muted" style="margin:-0.25rem 0.25rem 0.5rem">${esc(fill(T('badges_count'), { n, t: bs.length }))}</div>
    <div class="badges">${bs.map((b, i) => `<button class="bdg ${b.earned ? '' : 'off'}" data-i="${i}"><span>${b.icon}</span>${esc(T('badge_' + b.key))}</button>`).join('')}</div></div>`);
  $$('.bdg', el).forEach(btn => btn.onclick = () => {
    const b = bs[+btn.dataset.i];
    const val = b.key.startsWith('km_') ? fmtKm(b.value) : fmtInt(b.value);
    dialog({ title: b.icon + ' ' + T('badge_' + b.key), html: `<p>${esc(T('badge_' + b.key + '_d'))}</p>${b.earned ? '<p>✅</p>' : `<div class="small muted">${esc(fill(T('badge_progress'), { v: val, t: fmtInt(b.target) }))}</div><div class="prog"><i style="width:${b.progress * 100}%"></i></div>`}` });
  });
  root.appendChild(el);
}

/* ------------------------------------------------------------------ Mehr */
async function renderMore(v) {
  const pg = makePage({ title: T('tab_more') });
  v.appendChild(pg.el);
  const w = h('<div class="wrap"></div>'); pg.content.appendChild(w);
  const last = await DB.kvGet('lastBackup', 0);
  const item = (id, ic, label, sub = '') => `<div class="item" id="${id}"><span class="ic">${ic}</span><div class="grow">${esc(label)}${sub ? `<div class="small muted">${esc(sub)}</div>` : ''}</div><span class="chev">›</span></div>`;
  w.innerHTML = `
    <div class="sec">${esc(T('more_manage'))}</div><div class="list">
      ${item('m_act', '🏷️', T('manage_activities'))}${item('m_reg', '🗺️', T('manage_regions'))}${item('m_per', '👥', T('manage_persons'))}</div>
    <div class="sec">GPX</div><div class="list">${item('m_gpx', '🧭', T('gpx_multi_import'), T('web_gpx_sub'))}</div>
    <div class="sec">${esc(T('backup'))}</div><div class="list">
      ${item('m_bak', '💾', T('backup_create'), T('backup_last') + ': ' + (last ? fmtDate(new Date(last).toISOString().slice(0, 10)) : T('backup_never')))}
      ${item('m_res', '♻️', T('backup_restore'))}</div>
    <div class="sec">${esc(T('more_app'))}</div><div class="list">
      ${item('m_set', '⚙️', T('settings'))}
      ${item('m_help', '❓', T('help'))}
      ${isStandalone() ? '' : item('m_inst', '📲', T('install_title'))}
      ${item('m_kofi', '☕', T('support_kofi'))}
      ${item('m_about', 'ℹ️', T('about'), 'Web ' + APP_VERSION)}</div>
    <div class="small muted" style="text-align:center;margin-top:0.875rem" id="m_store"></div>`;
  $('#m_act', w).onclick = () => openManageActivities();
  $('#m_reg', w).onclick = () => openManageRegions();
  $('#m_per', w).onclick = () => openManagePersons();
  $('#m_gpx', w).onclick = () => bulkGpxImport();
  $('#m_bak', w).onclick = () => exportBackup();
  $('#m_res', w).onclick = () => importBackup();
  $('#m_help', w).onclick = () => openHelp();
  const inst = $('#m_inst', w); if (inst) inst.onclick = () => alertBox(isIOS() ? T('install_ios') : T('install_other'), '📲 ' + T('install_title'));
  $('#m_kofi', w).onclick = async () => { if (await dialog({ title: '☕ ' + T('support_kofi'), text: T('support_text'), buttons: [{ label: T('support_no'), value: false }, { label: T('support_open'), value: true }] })) window.open(KOFI_URL, '_blank'); };
  $('#m_set', w).onclick = () => openSettings();
  $('#m_about', w).onclick = () => {
    const link = `<a href="${KOFI_URL}" target="_blank" rel="noopener">ko-fi.com/egazzz</a>`;
    const txt = esc(fill(T('about_text'), { v: 'Web ' + APP_VERSION })).replace('ko-fi.com/egazzz', link);
    const diag = `Bergtagebuch Web ${APP_VERSION}\n${navigator.userAgent}\nstandalone: ${isStandalone()}\n${T('st_tours')}: ${S.tours.length}`;
    dialog({ title: T('about'), html: `<div style="white-space:pre-line">${txt}</div>
      <p class="small muted">${esc(T('web_storage_note'))}</p><p><a href="https://github.com/egazzz/bergtagebuch" target="_blank" rel="noopener">GitHub</a></p>`,
      buttons: [{ label: T('diag_send'), value: 'diag' }, { label: 'OK', value: true }] }).then(r => {
      if (r !== 'diag') return;
      if (navigator.share) navigator.share({ title: 'Bergtagebuch Diagnose', text: diag }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(diag).then(() => toast(T('crash_copied')));
    });
  };
  if (navigator.storage && navigator.storage.estimate) {
    const [est, pers] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false]);
    $('#m_store', w).textContent = `${T('web_storage_used')}: ${fmtKm((est.usage || 0) / 1048576)} MB${pers ? ' · 🔒 ' + T('web_storage_persist') : ''}`;
  }
}

/* ------------------------------------------------------------------ Einstellungen */
const LANG_NAMES = { de: 'Deutsch', it: 'Italiano', en: 'English' };
function openSettings() {
  const pg = makePage({ title: T('settings'), back: true });
  pushPage(pg, { onClose: () => { buildTabs(); renderTab(); } });
  const item = (id, ic, label, val) => `<div class="item" id="${id}"><span class="ic">${ic}</span><div class="grow">${esc(label)}<div class="val">${esc(val)}</div></div><span class="chev">›</span></div>`;
  const toggle = (id, ic, label, on) => `<label class="item" for="${id}"><span class="ic">${ic}</span><div class="grow">${esc(label)}</div><span class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></span></label>`;
  const draw = () => {
    pg.el.querySelector('h1').textContent = T('settings');
    pg.content.innerHTML = `<div class="wrap">
      <div class="sec">${esc(T('settings_display'))}</div><div class="list">
        ${item('s_font', '🔤', T('settings_font'), T('font_' + S.font))}
        ${item('s_size', '🔍', T('settings_size'), S.uiScale + ' %')}</div>
      <div class="preview">${esc(T('settings_preview'))}</div>
      <div class="small muted" style="margin:-0.25rem 0.25rem 0">${esc(T('settings_size_hint'))}</div>
      <div class="sec">${esc(T('settings_form'))}</div><div class="list">
        ${item('s_form', '📝', T('settings_form_mode'), T('form_' + S.formMode))}</div>
      <div class="small muted" style="margin:-0.25rem 0.25rem 0">${esc(T('settings_form_hint'))}</div>
      <div class="sec">${esc(T('settings_general'))}</div><div class="list">
        ${item('s_lang', '🌐', T('language'), LANG_NAMES[I18N.code])}
        ${toggle('s_bak', '💾', T('settings_backup_reminder'), S.backupReminder)}</div></div>`;
    const c = pg.content;
    $('#s_font', c).onclick = async () => {
      const keys = ['system', 'atkinson', 'nunito', 'lato', 'serif'];
      const html = keys.map(k => `<button class="opt ${k === S.font ? 'sel' : ''}" data-k="${k}" style="font-family:${esc(FONTS[k])}">${esc(T('font_' + k))}</button>`).join('');
      const k = await dialog({ title: T('settings_font'), html, buttons: [{ label: T('cancel'), value: null, cls: 'sec2' }], onOpen: (ovl, close) => $$('[data-k]', ovl).forEach(b => b.onclick = () => close(b.dataset.k)) });
      if (k) { S.font = k; await DB.kvSet('font', k); applyAppearance(); draw(); }
    };
    $('#s_size', c).onclick = async () => {
      const v = await choose(T('settings_size'), [100, 115, 125, 150].map(p => ({ label: p + ' %', value: p, sel: p === S.uiScale })));
      if (v) { S.uiScale = v; await DB.kvSet('uiScale', v); applyAppearance(); draw(); }
    };
    $('#s_form', c).onclick = async () => {
      const v = await choose(T('settings_form_mode'), ['open', 'closed', 'remember'].map(m => ({ label: T('form_' + m), value: m, sel: m === S.formMode })));
      if (v) { S.formMode = v; await DB.kvSet('formMode', v); draw(); }
    };
    $('#s_lang', c).onclick = async () => {
      const v = await choose(T('language'), ['de', 'it', 'en'].map(k => ({ label: LANG_NAMES[k], value: k, sel: k === I18N.code, icon: { de: '🇩🇪', it: '🇮🇹', en: '🇬🇧' }[k] })));
      if (!v || v === I18N.code) return;
      await DB.kvSet('lang', v); await loadLang(v); document.title = T('app_name'); buildTabs(); draw();
    };
    $('#s_bak', c).onchange = async e => { S.backupReminder = e.target.checked; await DB.kvSet('backupReminder', S.backupReminder); };
  };
  draw();
}

/* ------------------------------------------------------------------ Verwaltung: Aktivitäten */
function openManageActivities(onClose) {
  const pg = makePage({ title: T('manage_activities'), back: true });
  pushPage(pg, { onClose: () => { if (onClose) onClose(); renderTab(); } });
  const draw = () => {
    const used = id => S.tours.filter(t => t.activityId === id).length;
    pg.content.innerHTML = `<div class="wrap"><button class="btn block" id="a_new" style="margin-bottom:0.75rem">＋ ${esc(T('activity_new'))}</button><div class="list">${S.activities.map(a => `<div class="item" data-id="${a.id}">
      <span class="ic" style="background:${a.color}22;border-radius:0.625rem">${a.icon}</span><div class="grow">${esc(pickName(a))}<div class="small muted">${esc(Grades.groupLabel(a.scales))} · ${used(a.id)} ${esc(T('tours_unit'))}</div></div><span class="chev">›</span></div>`).join('')}</div></div>`;
    $('#a_new', pg.content).onclick = async () => { if (await editActivity(null)) draw(); };
    $$('[data-id]', pg.content).forEach(el => el.onclick = async () => { await editActivity(S.activities.find(a => a.id === +el.dataset.id)); draw(); });
  };
  draw();
}
async function editActivity(a) {
  const isNew = !a;
  const cur = a ? { ...a } : { name_de: '', name_it: '', name_en: '', icon: '🏃', color: '#00897B', scales: 'AV' };
  let sel = Grades.scalesFor(cur.scales).filter(k => k !== 'FREE');
  const html = `<div class="field"><label>${esc(T('name_de'))}</label><input class="inp" id="a_de" value="${esc(cur.name_de)}" placeholder="${esc(T('activity_name_hint'))}"></div>
    <div class="field"><label>${esc(T('name_it'))}</label><input class="inp" id="a_it" value="${esc(cur.name_it)}"></div>
    <div class="field"><label>${esc(T('name_en'))}</label><input class="inp" id="a_en" value="${esc(cur.name_en)}"></div>
    <div class="lbl">${esc(T('icon'))}</div><div class="icgrid">${ICONS.map(i => `<button data-ic="${i}" class="${i === cur.icon ? 'sel' : ''}">${i}</button>`).join('')}</div>
    <div class="lbl" style="margin-top:0.75rem">${esc(T('color'))}</div><div class="colgrid">${COLORS.map(c => `<button data-c="${c[1]}" title="${esc(T(c[0]))}" class="${c[1] === cur.color ? 'sel' : ''}" style="background:${c[1]}"></button>`).join('')}</div>
    <div class="lbl" style="margin-top:0.75rem">${esc(T('grade_scale'))}</div><div>${Grades.all.filter(k => k !== 'FREE').map(k => `<button class="chip ${sel.includes(k) ? 'sel' : ''}" data-k="${k}">${esc(Grades.longName(k))}</button>`).join('')}</div>`;
  const used = a ? S.tours.filter(t => t.activityId === a.id).length : 0;
  const btns = [{ label: T('cancel'), value: null }];
  if (!isNew) btns.push({ label: T('delete'), value: 'delete', cls: 'danger' });
  btns.push({ label: T('save'), check: ovl => {
    const de = $('#a_de', ovl).value.trim(), it = $('#a_it', ovl).value.trim(), en = $('#a_en', ovl).value.trim();
    const nm = de || it || en;
    if (!nm) { toast(T('name_required')); return false; }
    if (S.activities.some(x => x !== a && x.id !== (a && a.id) && [x.name_de, x.name_it, x.name_en].some(n => n && n.toLowerCase() === nm.toLowerCase()))) { toast(T('name_exists')); return false; }
    return true;
  }, value: ovl => 'save' });
  const res = await dialog({ title: isNew ? T('activity_new') : pickName(a), html, buttons: btns, onOpen: ovl => {
    $$('[data-ic]', ovl).forEach(b => b.onclick = () => { cur.icon = b.dataset.ic; $$('[data-ic]', ovl).forEach(x => x.classList.toggle('sel', x === b)); });
    $$('[data-c]', ovl).forEach(b => b.onclick = () => { cur.color = b.dataset.c; $$('[data-c]', ovl).forEach(x => x.classList.toggle('sel', x === b)); });
    $$('[data-k]', ovl).forEach(b => b.onclick = () => { const k = b.dataset.k; sel = sel.includes(k) ? sel.filter(x => x !== k) : [...sel, k]; b.classList.toggle('sel'); });
    const read = () => { cur.name_de = $('#a_de', ovl).value.trim(); cur.name_it = $('#a_it', ovl).value.trim(); cur.name_en = $('#a_en', ovl).value.trim(); };
    ['a_de', 'a_it', 'a_en'].forEach(i => $('#' + i, ovl).addEventListener('input', read));
  } });
  if (res === 'delete') {
    if (used) { alertBox(T('activity_in_use')); return null; }
    if (!await confirmBox(fill(T('activity_delete_confirm'), { n: pickName(a) }), T('delete'), '', true)) return null;
    S.activities = S.activities.filter(x => x.id !== a.id);
    await DB.kvSet('activities', S.activities);
    toast(T('deleted'));
    return null;
  }
  if (res !== 'save') return null;
  const nm = cur.name_de || cur.name_it || cur.name_en;
  cur.name_de = cur.name_de || nm; cur.name_it = cur.name_it || nm; cur.name_en = cur.name_en || nm;
  cur.scales = sel.length ? sel.join(',') : 'FREE';
  if (isNew) { cur.id = Math.max(0, ...S.activities.map(x => x.id)) + 1; S.activities.push(cur); toast(T('activity_added'), 3000); }
  else S.activities[S.activities.findIndex(x => x.id === a.id)] = cur;
  await DB.kvSet('activities', S.activities);
  return cur;
}

/* ------------------------------------------------------------------ Verwaltung: Regionen, Begleiter */
function openManageRegions() {
  const pg = makePage({ title: T('manage_regions'), back: true });
  pushPage(pg, { onClose: renderTab });
  const draw = () => {
    const used = id => S.tours.filter(t => t.regionId === id).length;
    pg.content.innerHTML = `<div class="wrap"><button class="btn block" id="r_new" style="margin-bottom:0.75rem">＋ ${esc(T('add_new'))}</button><div class="list">${S.regions.map(r => `<div class="item" data-id="${r.id}"><span class="ic">🗺️</span><div class="grow">${esc(pickName(r))}<div class="small muted">${used(r.id)} ${esc(T('tours_unit'))}</div></div><span class="chev">›</span></div>`).join('')}</div></div>`;
    $('#r_new', pg.content).onclick = async () => { await editRegion(null); draw(); };
    $$('[data-id]', pg.content).forEach(el => el.onclick = async () => { await editRegion(S.regions.find(r => r.id === +el.dataset.id)); draw(); });
  };
  draw();
}
async function editRegion(r) {
  const html = ['de', 'it', 'en'].map(c => `<div class="field"><label>${esc(T('name_' + c))}</label><input class="inp" id="r_${c}" value="${esc(r ? r['name_' + c] : '')}"></div>`).join('');
  const btns = [{ label: T('cancel'), value: null }];
  if (r) btns.push({ label: T('delete'), value: 'delete', cls: 'danger' });
  btns.push({ label: T('save'), check: ovl => { if (!['de', 'it', 'en'].some(c => $('#r_' + c, ovl).value.trim())) { toast(T('name_required')); return false; } return true; },
    value: ovl => { const o = {}; ['de', 'it', 'en'].forEach(c => o[c] = $('#r_' + c, ovl).value.trim()); return o; } });
  const res = await dialog({ title: r ? pickName(r) : T('manage_regions'), html, buttons: btns });
  if (!res) return;
  if (res === 'delete') {
    const n = S.tours.filter(t => t.regionId === r.id).length;
    if (!await confirmBox(n ? fill(T('delete_used'), { n }) : pickName(r) + ' – ' + T('delete') + '?', T('delete'), '', true)) return;
    for (const t of S.tours.filter(t => t.regionId === r.id)) { t.regionId = null; await DB.put('tours', t); }
    S.regions = S.regions.filter(x => x.id !== r.id);
  } else {
    const nm = res.de || res.it || res.en;
    const o = r || { id: Math.max(0, ...S.regions.map(x => x.id)) + 1 };
    o.name_de = res.de || nm; o.name_it = res.it || nm; o.name_en = res.en || nm;
    if (!r) S.regions.push(o);
  }
  await DB.kvSet('regions', S.regions);
}
function openManagePersons() {
  const pg = makePage({ title: T('manage_persons'), back: true });
  pushPage(pg, { onClose: renderTab });
  const draw = () => {
    const ps = allPersons();
    pg.content.innerHTML = `<div class="wrap">${ps.length ? `<div class="list">${ps.map((p, i) => `<div class="item" data-i="${i}"><span class="ic">👤</span><div class="grow">${esc(p.name)}<div class="small muted">${p.count} ${esc(T('tours_unit'))}</div></div><span class="chev">›</span></div>`).join('')}</div>`
      : `<div class="empty">${esc(T('list_empty'))}\n${esc(T('web_persons_hint'))}</div>`}</div>`;
    $$('[data-i]', pg.content).forEach(el => el.onclick = async () => {
      const p = ps[+el.dataset.i];
      const res = await dialog({ title: p.name, html: `<div class="field"><label>${esc(T('name'))}</label><input class="inp" id="p_n" value="${esc(p.name)}"></div>`,
        buttons: [{ label: T('cancel'), value: null }, { label: T('delete'), value: 'delete', cls: 'danger' }, { label: T('save'), value: ovl => $('#p_n', ovl).value.trim() }] });
      if (!res) return;
      if (res === 'delete' && !await confirmBox(fill(T('delete_used'), { n: p.count }), T('delete'), '', true)) return;
      for (const t of S.tours.filter(t => (t.persons || []).includes(p.name))) {
        t.persons = res === 'delete' ? t.persons.filter(x => x !== p.name) : [...new Set(t.persons.map(x => x === p.name ? res : x))];
        await DB.put('tours', t);
      }
      draw();
    });
  };
  draw();
}

/* ------------------------------------------------------------------ Viele GPX-Dateien auf einmal */
async function bulkGpxImport() {
  let files = await pickFiles(isIOS() ? '' : '.gpx,application/gpx+xml,application/xml,text/xml', true);
  if (!files.length) return;
  const MAX = 100;
  if (files.length > MAX) { toast(fill(T('gpx_multi_max'), { n: MAX }), 3500); files = files.slice(0, MAX); }
  const actId = await choose(T('gpx_multi_activity'), S.activities.map(a => ({ label: pickName(a), icon: a.icon, value: a.id })));
  if (!actId) return;
  const b = busy('');
  let ok = 0, dup = 0, bad = 0, online = true;
  for (let i = 0; i < files.length; i++) {
    b.set(fill(T('gpx_multi_progress'), { i: i + 1, n: files.length }));
    let g = null;
    try { g = parseGpx(await files[i].text()); } catch (e) { g = null; }
    if (!g) { bad++; continue; }
    const date = g.startDate || todayIso();
    if (S.tours.some(t => t.date === date && t.distance != null && Math.abs(t.distance - g.distanceKm) < 0.1)) { dup++; continue; }
    const t = { date, activityId: actId, regionId: null, title: g.name || fill(T('gpx_multi_title'), { d: fmtDate(date) }),
      start: '', lat: g.hasEle ? +g.maxLat.toFixed(6) : +g.points[0][0].toFixed(6), lon: g.hasEle ? +g.maxLon.toFixed(6) : +g.points[0][1].toFixed(6),
      ascent: g.hasEle ? Math.round(g.ascent) : null, descent: g.hasEle ? Math.round(g.descent) : null, distance: +g.distanceKm.toFixed(2),
      summitAlt: g.hasEle ? Math.round(g.maxEle) : null, duration: g.durationMin, grade: '', avalanche: 0, weather: '', summitReached: true, rating: 0,
      conditions: '', features: '', description: '', persons: [], summits: [], coverId: null, hasTrack: true, gpxName: g.name, created: Date.now(), updated: Date.now() };
    if (online && g.hasEle) {
      const res = await lookupPeaks(findPeaks(g));
      if (res.error) online = false;
      res.filter(s => s.name).forEach(s => { if (!t.summits.some(x => x.name === s.name)) t.summits.push({ name: s.name, alt: s.alt, lat: s.lat, lon: s.lon }); });
    }
    if (!g.name && t.summits.length) t.title = [...t.summits].sort((a, b) => b.alt - a.alt)[0].name;
    const id = await DB.put('tours', t);
    await DB.put('tracks', { tourId: id, pts: trackFromGpx(g) });
    S.tours.push({ ...t, id });
    ok++;
  }
  b.close();
  await refreshAll();
  const msg = [fill(T('gpx_multi_done'), { n: ok })];
  if (dup) msg.push(fill(T('gpx_multi_dup'), { n: dup }));
  if (bad) msg.push(fill(T('gpx_multi_invalid'), { n: bad }));
  if (!online) msg.push(T('summit_offline'));
  alertBox(msg.join('\n'), '🧭 ' + T('gpx_multi_import'));
}

/* ------------------------------------------------------------------ Backup (JSON mit Fotos) */
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function exportBackup() {
  const b = busy(T('backup_working'));
  try {
    const tours = await DB.all('tours'), tracks = await DB.all('tracks');
    const parts = [`{"app":"bergtagebuch-web","format":1,"version":${JSON.stringify(APP_VERSION)},"created":${JSON.stringify(new Date().toISOString())},`,
      `"tours":${JSON.stringify(tours)},"tracks":${JSON.stringify(tracks)},"activities":${JSON.stringify(S.activities)},"regions":${JSON.stringify(S.regions)},"photos":[`];
    /* Fotos einzeln lesen, damit nicht alles gleichzeitig im Speicher liegt */
    const ids = await DB.tx('photos', 'readonly', s => DB.req(s.getAllKeys()));
    for (let i = 0; i < ids.length; i++) {
      b.set(T('backup_working') + ' ' + (i + 1) + '/' + ids.length);
      const p = await DB.get('photos', ids[i]);
      parts.push((i ? ',' : '') + JSON.stringify({ id: p.id, tourId: p.tourId, order: p.order || 0, lat: p.lat, lon: p.lon, takenAt: p.takenAt || '', blob: await blobToDataUrl(p.blob), thumb: await blobToDataUrl(p.thumb) }));
    }
    parts.push(']}');
    const name = 'bergtagebuch_' + todayIso() + '.json';
    const file = new File(parts, name, { type: 'application/json' });
    b.close();
    let shared = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: T('backup_share_title') }); shared = true; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    if (!shared) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
    await DB.kvSet('lastBackup', Date.now());
    toast('💾 ' + T('saved'));
    if (S.tab === 'more') renderTab();
  } catch (e) {
    b.close();
    alertBox(T('backup_failed') + '\n\n' + (e && e.message || e));
  }
}
async function importBackup() {
  const files = await pickFiles(isIOS() ? '' : '.json,application/json', false);
  if (!files.length) return;
  let data;
  try { data = JSON.parse(await files[0].text()); } catch (e) { data = null; }
  if (!data || data.app !== 'bergtagebuch-web' || !Array.isArray(data.tours)) {
    alertBox(T('restore_invalid') + (files[0].name.toLowerCase().endsWith('.zip') ? '\n\n' + T('web_android_backup') : ''));
    return;
  }
  if (!await confirmBox(T('restore_confirm'), T('restore_yes'), T('backup_restore'), true)) return;
  const b = busy(T('restore_working'));
  try {
    for (const st of ['tours', 'photos', 'tracks']) await DB.clear(st);
    ThumbCache.forEach(u => URL.revokeObjectURL(u)); ThumbCache.clear();
    for (const t of data.tours) await DB.put('tours', t);
    for (const t of data.tracks || []) await DB.put('tracks', t);
    if (data.activities) await DB.kvSet('activities', data.activities);
    if (data.regions) await DB.kvSet('regions', data.regions);
    const ph = data.photos || [];
    for (let i = 0; i < ph.length; i++) {
      b.set(T('restore_working') + ' ' + (i + 1) + '/' + ph.length);
      const p = ph[i];
      await DB.put('photos', { id: p.id, tourId: p.tourId, order: p.order || 0, lat: p.lat, lon: p.lon, takenAt: p.takenAt,
        blob: await (await fetch(p.blob)).blob(), thumb: await (await fetch(p.thumb)).blob() });
    }
    await loadAll();
    b.close();
    toast('✓ ' + T('restore_done'));
    renderTab();
  } catch (e) {
    b.close();
    alertBox(T('restore_failed') + '\n\n' + (e && e.message || e));
  }
}
