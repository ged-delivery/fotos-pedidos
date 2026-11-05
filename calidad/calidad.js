/* Control de calidad y reclamos – página para PC. Habla con el mismo Apps Script que la app del celular.
   Todo el filtrado por local lo hace el servidor: esta pantalla solo muestra lo que recibe. */
(function () {
  'use strict';
  var CFG = window.GED_CONFIG || {};
  var KEY = 'ged-calidad-token';
  var S = { token: '', user: null, tab: 'q', q: { items: [], locales: [], fil: 'todos', sel: '', det: null, rev: {} }, r: { items: [], locales: [], est: 'PEND', local: '', tipo: '', sel: '', det: null, cand: {}, ver: {}, nota: {}, picked: {}, hist: [], reabrir: false, avisos: '' } };
  var photoCache = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function toast(msg, bad) { var t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = 'toast hidden'; }, 4500); }
  function money(n) { return '$ ' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 }); }
  function dmy(ymd) { var a = String(ymd).split('-'); return a.length === 3 ? a[2] + '/' + a[1] + '/' + a[0] : ymd; }
  function today() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

  /* ───────── API ───────── */
  function api(action, payload, ms) {
    if (!CFG.API_URL || CFG.API_URL.indexOf('http') !== 0) return Promise.reject(new Error('Falta pegar la URL de Apps Script en config.js'));
    var ctrl = window.AbortController ? new AbortController() : null, timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 60000);
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctrl ? ctrl.signal : undefined,
      body: JSON.stringify(Object.assign({ action: action, token: S.token }, payload || {})) })
      .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }, function (e) { clearTimeout(timer); throw e; })
      .then(function (j) { if (j && j.code === 'AUTH') { logout(true); throw new Error(j.error); } return j; });
  }
  function fail(e) { toast(String(e && e.message || e), true); }

  /* ───────── Sesión ───────── */
  function showLogin(msg) {
    $('vApp').classList.add('hidden'); $('vLogin').classList.remove('hidden');
    var e = $('loginErr'); if (msg) { e.textContent = msg; e.classList.remove('hidden'); } else e.classList.add('hidden');
  }
  function logout(expired) { S.token = ''; S.user = null; lsDel(KEY); photoCache = {}; showLogin(expired ? 'Tu sesión venció. Ingresá de nuevo.' : ''); }
  $('fLogin').addEventListener('submit', function (ev) {
    ev.preventDefault(); var b = $('bLogin'); b.disabled = true; b.textContent = 'Entrando…';
    api('login', { usuario: $('usuario').value, clave: $('clave').value, area: 'calidad' }, 45000).then(function (j) {
      b.disabled = false; b.textContent = 'Entrar';
      if (!j.ok) { showLogin(j.error || 'No se pudo ingresar'); return; }
      S.token = j.token; S.user = j.user; lsSet(KEY, j.token); $('clave').value = ''; start();
    }, function (e) { b.disabled = false; b.textContent = 'Entrar'; showLogin('No hay conexión con el servidor: ' + (e.message || e)); });
  });
  $('bOut').addEventListener('click', function () { logout(false); });

  function start() {
    $('vLogin').classList.add('hidden'); $('vApp').classList.remove('hidden');
    $('who').textContent = S.user.nombre + ' · ' + (S.user.locales.length > 1 ? S.user.locales.length + ' locales' : (S.user.locales[0] || 'sin locales'));
    $('qDesde').value = $('qHasta').value = today();
    loadQ(); loadR(true);
  }
  function boot() {
    S.token = lsGet(KEY);
    if (!S.token) return showLogin('');
    api('config').then(function (j) {
      if (j.ok && j.user && j.user.rol === 'CALIDAD') { S.user = j.user; start(); } else logout(false);
    }, function () { showLogin('No hay conexión con el servidor.'); });
  }

  /* ───────── Pestañas ───────── */
  function setTab(t) {
    S.tab = t;
    $('tabQ').classList.toggle('on', t === 'q'); $('tabR').classList.toggle('on', t === 'r');
    $('pQ').classList.toggle('hidden', t !== 'q'); $('pR').classList.toggle('hidden', t !== 'r');
  }
  document.querySelector('.tabs').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-tab]'); if (b) setTab(b.getAttribute('data-tab')); });

  /* ───────── Fotos ───────── */
  function loadPhoto(id) {
    if (photoCache[id]) return Promise.resolve(photoCache[id]);
    return api('q_photo', { id: id }, 90000).then(function (j) {
      if (!j.ok) throw new Error(j.error || 'No se pudo cargar la foto');
      return (photoCache[id] = 'data:' + j.mime + ';base64,' + j.data);
    });
  }
  function fillPhotos(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.im[data-id]'), function (box) {
      var id = box.getAttribute('data-id');
      loadPhoto(id).then(function (src) { if (!box.isConnected) return; box.innerHTML = '<img alt="' + esc(box.getAttribute('data-alt')) + '" src="' + src + '">'; },
        function () { if (box.isConnected) box.textContent = 'No se pudo cargar'; });
    });
  }
  document.addEventListener('click', function (ev) {
    var im = ev.target.closest('.im img');
    if (im) { ev.stopPropagation(); ev.preventDefault(); $('lbImg').src = im.src; $('lightbox').classList.remove('hidden'); }
  }, true);
  $('lightbox').addEventListener('click', function () { $('lightbox').classList.add('hidden'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('lightbox').classList.add('hidden'); });

  function optList(sel, arr, cur, all) {
    sel.innerHTML = '<option value="">' + all + '</option>' + arr.map(function (x) { return '<option' + (x.v === cur ? ' selected' : '') + ' value="' + esc(x.v) + '">' + esc(x.t) + '</option>'; }).join('');
  }

  /* ═════════════════ CALIDAD DE FOTOS ═════════════════ */
  var QFIL = [['todos', 'Todos'], ['alertas', 'Con alertas'], ['bajo', 'Puntaje bajo (<60)'], ['sinrev', 'Sin revisar']];
  function paintQFil() {
    $('qFil').innerHTML = QFIL.map(function (f) { return '<button class="chip' + (S.q.fil === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>'; }).join('');
  }
  $('qFil').addEventListener('click', function (ev) { var b = ev.target.closest('[data-f]'); if (b) { S.q.fil = b.getAttribute('data-f'); paintQFil(); paintQ(); } });
  $('qGo').addEventListener('click', loadQ);
  $('qBus').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadQ(); });
  $('qLocal').addEventListener('change', loadQ);

  function loadQ() {
    $('qMsg').classList.add('hidden'); $('qRows').innerHTML = '<tr><td colspan="8" class="sm">Cargando…</td></tr>';
    api('q_list', { desde: $('qDesde').value, hasta: $('qHasta').value, local: $('qLocal').value, q: $('qBus').value }).then(function (j) {
      if (!j.ok) { $('qRows').innerHTML = ''; return fail(j.error); }
      S.q.items = j.items; S.q.locales = j.locales;
      var cur = $('qLocal').value; optList($('qLocal'), j.locales.map(function (l) { return { v: l, t: l }; }), cur, j.locales.length > 1 ? 'Todos mis locales' : 'Mi local');
      paintQFil(); paintQ();
    }, fail);
  }
  function qShown() {
    return S.q.items.filter(function (i) {
      if (S.q.fil === 'alertas') return !!i.alertas;
      if (S.q.fil === 'bajo') return i.puntaje !== '' && Number(i.puntaje) < 60;
      if (S.q.fil === 'sinrev') return !i.rev;
      return true;
    });
  }
  function scoreTag(p) {
    if (p === '' || p == null) return '<span class="tag t-gray">—</span>';
    p = Number(p); return '<span class="tag ' + (p >= 75 ? 't-ok' : p >= 60 ? 't-warn' : 't-err') + '">' + p + '</span>';
  }
  var REV_TAG = { OK: ['Aprobado', 't-ok'], OBSERVADO: ['Con observaciones', 't-warn'], REPETIR: ['Había que repetir', 't-err'] };
  function revTag(rv) { return rv ? '<span class="tag ' + REV_TAG[rv.resultado][1] + '">' + REV_TAG[rv.resultado][0] + '</span><div class="sm">' + esc(rv.usuario) + '</div>' : '<span class="tag t-gray">Sin revisar</span>'; }
  function paintQ() {
    var all = S.q.items, scored = all.filter(function (i) { return i.puntaje !== '' && isFinite(Number(i.puntaje)); });
    var avg = scored.length ? Math.round(scored.reduce(function (a, i) { return a + Number(i.puntaje); }, 0) / scored.length) : '—';
    $('qKpi').innerHTML = kpi(all.length, 'Pedidos') + kpi(avg, 'Puntaje promedio') + kpi(scored.filter(function (i) { return Number(i.puntaje) < 60; }).length, 'Puntaje bajo') + kpi(all.filter(function (i) { return !i.rev; }).length, 'Sin revisar');
    var list = qShown();
    $('qRows').innerHTML = list.length ? list.map(function (i) {
      return '<tr tabindex="0" data-k="' + esc(i.clave) + '" class="' + (i.clave === S.q.sel ? 'sel' : '') + '"><td>' + dmy(i.fecha) + '</td><td>' + esc(i.local) + '<div class="sm">' + esc(i.marca) + '</div></td><td>' + esc(i.app) + '</td><td><b>' + esc(i.pedido) + '</b></td>' +
        '<td>' + i.fotosA + ' ab. · ' + i.fotosC + ' cer.</td><td>' + scoreTag(i.puntaje) + '</td><td>' + (i.alertas ? '<span class="sm">' + esc(i.alertas) + '</span>' : '') + '</td><td>' + revTag(i.rev) + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">No hay pedidos con estos filtros.</td></tr>';
  }
  function kpi(v, t) { return '<div class="kpi"><b>' + esc(v) + '</b><span>' + esc(t) + '</span></div>'; }
  function rowOpen(tbodyId, fn) {
    var tb = $(tbodyId);
    tb.addEventListener('click', function (ev) { var tr = ev.target.closest('tr[data-k]'); if (tr) fn(tr.getAttribute('data-k')); });
    tb.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { var tr = ev.target.closest('tr[data-k]'); if (tr) fn(tr.getAttribute('data-k')); } });
  }
  rowOpen('qRows', function (k) { S.q.sel = k; paintQ(); openQ(k); });

  function openQ(k) {
    var box = $('qDet'); box.innerHTML = '<div class="empty">Cargando pedido…</div>'; box.scrollTop = 0;
    api('q_detail', { clave: k }).then(function (j) {
      if (!j.ok) { box.innerHTML = '<div class="empty">' + esc(j.error) + '</div>'; return; }
      S.q.det = j; paintQDet();
    }, fail);
  }
  function fotoCard(f, pick, on) {
    return '<' + (pick ? 'div role="checkbox" tabindex="0" aria-checked="' + (on ? 'true' : 'false') + '" data-p="' + esc(f.id) + '"' : 'div') + ' class="ph' + (pick ? ' pick' : '') + (on ? ' on' : '') + '">' +
      '<div class="im" data-id="' + esc(f.id) + '" data-alt="Bolsa ' + f.tipo + ' ' + f.n + '">Cargando…</div>' +
      '<div class="cap">' + (pick ? '<span class="tick">' + (on ? '✓' : '') + '</span>' : '') + 'Bolsa ' + f.tipo + ' ' + f.n + (f.puntajeCel !== '' ? ' ' + scoreTag(f.puntajeCel) : '') + '</div>' +
      '<div class="meta">' + esc(String(f.capturado).slice(11, 19)) + (f.nitidez !== '' ? ' · nitidez ' + esc(f.nitidez) : '') + (f.luz !== '' ? ' · luz ' + esc(f.luz) : '') + '</div>' +
      (f.obsCel ? '<div class="meta">' + esc(f.obsCel) + '</div>' : '') + (f.alertas ? '<div class="meta" style="color:var(--warn)">' + esc(f.alertas) + '</div>' : '') + '</div>';
  }
  function paintQDet() {
    var d = S.q.det, p = d.pedido, rv = d.rev;
    $('qDet').innerHTML = '<h2>' + esc(p.app) + ' · ' + esc(p.pedido) + '</h2><div class="sm">' + esc(p.local) + ' · ' + esc(p.marca) + ' · ' + dmy(p.fecha) + '</div>' +
      '<div class="kv" style="margin-top:10px"><span>Estado</span><span>' + esc(p.estado) + '</span><span>Puntaje del pedido</span><span>' + scoreTag(p.puntaje) + '</span><span>Cargó</span><span>' + esc(p.usuario) + '</span>' +
      (p.obs ? '<span>Observaciones</span><span>' + esc(p.obs) + '</span>' : '') + (p.alertas ? '<span>Alertas</span><span>' + esc(p.alertas) + '</span>' : '') + '</div>' +
      '<h3>Fotos (' + d.fotos.length + ')</h3><div class="photos">' + d.fotos.map(function (f) { return fotoCard(f, false, false); }).join('') + '</div>' +
      '<h3>Tu revisión</h3>' + (rv ? '<div class="box">Última: ' + revTag(rv) + ' <span class="sm">· ' + esc(rv.fecha) + (rv.puntaje !== '' ? ' · puntaje ' + esc(rv.puntaje) : '') + '</span>' + (rv.nota ? '<div>' + esc(rv.nota) + '</div>' : '') + '</div>' : '') +
      '<div class="seg" style="margin-top:8px" id="qRes"><button data-r="OK">Aprobado<small>Fotos correctas</small></button><button data-r="OBSERVADO">Con observaciones<small>Aceptable</small></button><button data-r="REPETIR">Había que repetir<small>Mala calidad</small></button></div>' +
      '<label class="l" for="qPun">Puntaje (opcional, 0-100)</label><input type="number" id="qPun" min="0" max="100" step="1" value="' + (rv && rv.puntaje !== '' ? esc(rv.puntaje) : '') + '">' +
      '<label class="l" for="qNota">Observaciones</label><textarea id="qNota" placeholder="Ej.: la comanda no se lee en la foto 2"></textarea>' +
      '<div class="act"><button class="btn primary" id="qSave" disabled>Guardar revisión</button></div>';
    fillPhotos($('qDet'));
    var res = '';
    $('qRes').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-r]'); if (!b) return; res = b.getAttribute('data-r');
      Array.prototype.forEach.call($('qRes').children, function (x) { x.classList.toggle('on', x === b); }); $('qSave').disabled = false;
    });
    $('qSave').addEventListener('click', function () {
      var b = this; b.disabled = true;
      api('q_review', { clave: d.pedido.clave, resultado: res, puntaje: $('qPun').value, nota: $('qNota').value }).then(function (j) {
        if (!j.ok) { b.disabled = false; return fail(j.error); }
        toast('Revisión guardada'); d.rev = j.rev;
        S.q.items.forEach(function (i) { if (i.clave === d.pedido.clave) i.rev = j.rev; });
        paintQ(); paintQDet();
      }, function (e) { b.disabled = false; fail(e); });
    });
  }

  /* ═════════════════ RECLAMOS DE PEYA ═════════════════ */
  var TIPOS = { MISSING_ITEM: 'Faltante', WRONG_ITEM: 'Ítem equivocado', WRONG_ORDER: 'Pedido equivocado', FOOD_QUALITY: 'Calidad' };
  var EST = {
    PEND: ['Pendiente', 't-warn'], VENC: ['Vencido', 't-org'], VALIDADO: ['Validado', 't-ok'], PARA_DISPUTAR: ['Para disputar', 't-blue'],
    ENVIADO: ['Enviado a PEYA', 't-vio'], SEGUNDA: ['2ª revisión', 't-sky'], SINFOTOS: ['Sin fotos', 't-err']
  };
  function estOf(c) {                                        // estado visible = lo que dice el servidor, más lo que se deriva (sin fotos / vencido)
    if (c.estado === 'PENDIENTE') { if (!c.cands.length) return 'SINFOTOS'; return c.left < 0 ? 'VENC' : 'PEND'; }
    return c.estado;
  }
  function plazoTxt(c) { return c.left < 0 ? 'Vencido' : c.left === 0 ? 'Vence hoy' : c.left === 1 ? 'Queda 1 día' : 'Quedan ' + c.left + ' días'; }
  function plazoCls(c) { return c.left < 0 ? 't-org' : c.left <= 3 ? 't-warn' : 't-gray'; }

  function loadR(quiet) {
    $('rMsg').classList.add('hidden');
    api('r_list', {}, 90000).then(function (j) {
      if (!j.ok) return fail(j.error);
      S.r.items = j.items; S.r.locales = j.locales || [];
      if (j.aviso) { $('rMsg').textContent = j.aviso; $('rMsg').classList.remove('hidden'); }
      var cur = $('rLocal').value;
      var locs = S.r.locales.slice(); j.items.forEach(function (c) { if (!c.local && locs.indexOf('(sin vincular)') < 0) locs.push('(sin vincular)'); });
      optList($('rLocal'), locs.map(function (l) { return { v: l, t: l }; }), cur, 'Todos');
      var tp = $('rTipo').value; optList($('rTipo'), Object.keys(TIPOS).map(function (k) { return { v: k, t: TIPOS[k] }; }), tp, 'Todos');
      var urg = j.items.filter(function (c) { return estOf(c) === 'PEND' && c.left <= 3; }).length;
      $('badgeR').textContent = urg; $('badgeR').classList.toggle('hidden', !urg);
      paintR();
      if (S.r.sel) { var c = byId(S.r.sel); if (c) openR(c.id, true); }
    }, function (e) { if (!quiet) fail(e); });
  }
  function byId(id) { for (var i = 0; i < S.r.items.length; i++) if (S.r.items[i].id === id) return S.r.items[i]; return null; }
  $('rGo').addEventListener('click', function () { loadR(); });
  $('rLocal').addEventListener('change', function () { S.r.local = this.value; paintR(); });
  $('rTipo').addEventListener('change', function () { S.r.tipo = this.value; paintR(); });
  function rMatch(c, skip) {
    return (skip === 'est' || S.r.est === 'TODOS' || estOf(c) === S.r.est) &&
      (!S.r.local || (S.r.local === '(sin vincular)' ? !c.local : c.local === S.r.local)) && (!S.r.tipo || c.tipo === S.r.tipo);
  }
  function paintR() {
    var opts = [['PEND', 'Pendientes de revisar'], ['VENC', 'Vencidos (sin revisar)'], ['VALIDADO', 'Validados'], ['PARA_DISPUTAR', 'Para disputar'], ['ENVIADO', 'Enviados a PEYA'], ['SEGUNDA', '2ª revisión'], ['SINFOTOS', 'Sin fotos'], ['TODOS', 'Todos']];
    $('rEst').innerHTML = opts.map(function (o) {
      var n = S.r.items.filter(function (c) { return rMatch(c, 'est') && (o[0] === 'TODOS' || estOf(c) === o[0]); }).length;
      return '<button class="chip' + (S.r.est === o[0] ? ' on' : '') + '" data-e="' + o[0] + '">' + o[1] + ' · ' + n + '</button>';
    }).join('');
    var all = S.r.items, live = ['PEND', 'VENC', 'PARA_DISPUTAR', 'SEGUNDA'];
    $('rKpi').innerHTML = kpi(all.filter(function (c) { return estOf(c) === 'PEND'; }).length, 'Pendientes') +
      kpi(all.filter(function (c) { return estOf(c) === 'PEND' && c.left <= 3; }).length, 'Vencen en 3 días o menos') +
      kpi(money(all.filter(function (c) { return live.indexOf(estOf(c)) >= 0; }).reduce(function (a, c) { return a + c.monto; }, 0)), 'Monto sin resolver') +
      kpi(all.filter(function (c) { return estOf(c) === 'VALIDADO'; }).length, 'Validados');
    var list = all.filter(function (c) { return rMatch(c); });
    $('rRows').innerHTML = list.length ? list.map(function (c) {
      var e = estOf(c);
      return '<tr tabindex="0" data-k="' + esc(c.id) + '" class="' + (c.id === S.r.sel ? 'sel' : '') + '"><td><b>' + esc(c.pedido) + '</b></td><td>' + esc(c.fecha) + '</td><td>' + esc(c.local || c.localTxt) + '<div class="sm">' + esc(c.marca) + '</div></td>' +
        '<td>' + esc(TIPOS[c.tipo] || c.tipo) + '</td><td class="num">' + money(c.monto) + '</td><td>' + (c.cands.length ? (c.cands.length > 1 ? c.cands.length + ' pedidos' : (c.cands[0].fotosA + c.cands[0].fotosC) + ' fotos') : '—') + '</td>' +
        '<td><span class="tag ' + EST[e][1] + '">' + EST[e][0] + '</span></td><td><span class="tag ' + plazoCls(c) + '">' + plazoTxt(c) + '</span></td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">No hay reclamos con estos filtros.</td></tr>';
  }
  $('rEst').addEventListener('click', function (ev) { var b = ev.target.closest('[data-e]'); if (b) { S.r.est = b.getAttribute('data-e'); paintR(); } });
  rowOpen('rRows', function (k) { S.r.sel = k; S.r.reabrir = false; paintR(); openR(k); });

  function candIdx(c) {
    if (S.r.cand[c.id] != null) return S.r.cand[c.id];
    if (c.gestion && c.gestion.clave) { for (var i = 0; i < c.cands.length; i++) if (c.cands[i].clave === c.gestion.clave) return i; }
    return c.sug >= 0 ? c.sug : 0;
  }
  function openR(id, keepForm) {
    var c = byId(id); if (!c) return;
    S.r.hist = []; api('r_hist', { id: id }).then(function (j) { if (j.ok && S.r.sel === id) { S.r.hist = j.items; paintHist(); } });
    if (!keepForm) $('rDet').scrollTop = 0;
    if (!c.cands.length) { S.r.det = { fotos: [] }; return paintRDet(); }
    var cd = c.cands[candIdx(c)];
    $('rDet').innerHTML = '<div class="empty">Cargando fotos…</div>';
    api('q_detail', { clave: cd.clave }).then(function (j) {
      if (!j.ok) { $('rDet').innerHTML = '<div class="empty">' + esc(j.error) + '</div>'; return; }
      if (S.r.sel !== id) return;
      S.r.det = j; if (!keepForm) delete S.r.picked[id]; paintRDet();
    }, fail);
  }
  function nowTxt(c, v, f) {                                 // nota sugerida (se puede editar)
    var it = c.items || c.productos || 'el producto', refs = f.map(function (x) { return 'bolsa ' + x.tipo + ' ' + x.n; }).join(', ');
    if (v === 'noConcl') return 'Las fotos no permiten confirmar ni descartar el reclamo. Queda para una segunda revisión.';
    if (c.tipo === 'MISSING_ITEM') return v === 'valido' ? 'Faltante confirmado: en la foto de bolsa abierta no se ve «' + it + '». Se valida el reclamo del cliente y se cierra.' : 'El ítem «' + it + '» se ve dentro de la bolsa (' + refs + '). Se responde a PEYA con la evidencia.';
    if (c.tipo === 'WRONG_ITEM' || c.tipo === 'WRONG_ORDER') return v === 'valido' ? 'La foto de bolsa abierta no coincide con lo pedido («' + it + '»). Se valida el reclamo y se cierra.' : 'El producto de la foto coincide con la comanda («' + it + '»). Se responde a PEYA con la evidencia (' + refs + ').';
    return v === 'valido' ? 'La foto muestra el producto en mal estado. Se valida el reclamo y se cierra.' : 'La foto muestra el producto en condiciones normales (' + refs + '). Se responde a PEYA con la evidencia.';
  }
  function pickedOf(c) {
    if (S.r.picked[c.id]) return S.r.picked[c.id];
    var all = S.r.det.fotos.map(function (f) { return f.id; });
    if (c.gestion && c.gestion.fotos && c.gestion.fotos.length) return c.gestion.fotos.filter(function (x) { return all.indexOf(x) >= 0; });
    return all;
  }
  function paintHist() {
    var h = $('rHist'); if (!h) return;
    h.innerHTML = S.r.hist.length ? S.r.hist.map(function (x) { return '<li><b>' + esc(x.accion === 'REABRIR' ? 'Reabierto' : (EST[x.estado === 'PENDIENTE' ? 'PEND' : x.estado] || [x.estado])[0]) + '</b> · ' + esc(x.usuario) + ' · ' + esc(x.fecha) + (x.nota ? '<div class="sm">' + esc(x.nota) + '</div>' : '') + '</li>'; }).join('') : '<li class="sm">Sin movimientos todavía.</li>';
  }
  function paintRDet() {
    var c = byId(S.r.sel), e = estOf(c), g = c.gestion, fotos = S.r.det.fotos, locked = c.estado === 'VALIDADO' || c.estado === 'ENVIADO';
    var ver = S.r.ver[c.id] || (g ? g.veredicto : '') || '', picked = pickedOf(c), expired = c.left < 0;
    var cd = c.cands.length ? c.cands[candIdx(c)] : null;
    var nota = S.r.nota[c.id] != null ? S.r.nota[c.id] : (g && g.nota && (!S.r.ver[c.id] || S.r.ver[c.id] === g.veredicto) ? g.nota : nowTxt(c, ver, fotos.filter(function (f) { return picked.indexOf(f.id) >= 0; })));
    if (!ver) nota = S.r.nota[c.id] || '';
    var h = '<h2>Pedido ' + esc(c.pedido) + '</h2><div class="sm">' + esc(c.local || c.localTxt) + ' · ' + esc(c.marca) + '</div>' +
      '<div class="kv" style="margin-top:10px"><span>Estado</span><span><span class="tag ' + EST[e][1] + '">' + EST[e][0] + '</span></span><span>Fecha del reclamo</span><span>' + esc(c.fecha) + '</span>' +
      '<span>Plazo para disputar</span><span><span class="tag ' + plazoCls(c) + '">' + plazoTxt(c) + '</span> <span class="sm">' + (expired ? 'venció el ' : 'hasta el ') + esc(c.lim) + '</span></span>' +
      '<span>Tipo</span><span>' + esc(TIPOS[c.tipo] || c.tipo) + '</span><span>Ítem reclamado</span><span>' + esc(c.items || c.productos) + '</span><span>Comentario</span><span>' + esc(c.comentario || '—') + '</span>' +
      '<span>Cargo al local</span><span>' + money(c.monto) + '</span><span>En PEYA</span><span>' + esc(c.peya || '—') + '</span></div>';
    if (!c.local) h += '<div class="box warn">El local «' + esc(c.localTxt) + '» no figura en la app. Agregalo en la hoja Locales, columna «Nombre en reclamos».</div>';
    else if (!cd) h += '<div class="box warn">No hay fotos cargadas en la app para este pedido (terminación «' + esc(c.pedido.slice(-4)) + '», ' + esc(c.local) + ', PEYA, ese día). No se puede validar ni disputar con fotos.</div>';
    else {
      h += '<h3>Fotos vinculadas por los últimos 4 dígitos</h3><div class="box">' +
        (c.cands.length > 1 ? '<b>Hay ' + c.cands.length + ' pedidos terminados en «' + esc(c.pedido.slice(-4)) + '» en ese local.</b> Elegí cuál es:' + c.cands.map(function (x, i) {
          return '<button class="cand' + (i === candIdx(c) ? ' on' : '') + '" data-c="' + i + '"' + (locked ? ' disabled' : '') + '>«' + esc(x.pedido) + '» · ' + dmy(x.fecha) + (x.hora ? ' ' + esc(x.hora) : '') + ' · ' + (x.fotosA + x.fotosC) + ' fotos' + (i === c.sug ? ' · sugerido (la hora está más cerca de la entrega)' : '') + '</button>';
        }).join('') : 'Cargadas como «' + esc(cd.pedido) + '» el ' + dmy(cd.fecha) + (cd.hora ? ' a las ' + esc(cd.hora) : '') + ' · coincide terminación, local y día.') + '</div>';
      h += '<h3>' + (locked ? 'Fotos incluidas en la respuesta: ' + picked.length : 'Tildá las fotos que van en la respuesta (' + picked.length + ' de ' + fotos.length + ')') + '</h3><div class="photos">' +
        fotos.map(function (f) { return fotoCard(f, !locked, picked.indexOf(f.id) >= 0); }).join('') + '</div>';
      h += '<h3>¿Qué muestran las fotos?</h3><div class="seg" id="rVer">' +
        [['valido', 'El reclamo es válido', 'La foto lo confirma'], ['noValido', 'El reclamo no es válido', 'La foto lo desmiente'], ['noConcl', 'No concluyente', 'No se puede saber']].map(function (o) {
          return '<button data-v="' + o[0] + '" class="' + (ver === o[0] ? 'on' : '') + '"' + (locked ? ' disabled' : '') + '>' + o[1] + '<small>' + o[2] + '</small></button>';
        }).join('') + '</div>' +
        '<label class="l" for="rNota">Nota' + (ver ? ' (sugerida, podés editarla)' : '') + '</label><textarea id="rNota"' + (locked ? ' readonly' : '') + '>' + esc(nota) + '</textarea>';
      h += '<div class="act" id="rAct">' + actions(c, ver, picked, expired, locked, g) + '</div>';
    }
    if (g && g.usuario) h += '<div class="sm" style="margin-top:8px">Último movimiento: ' + esc(g.usuario) + ' · ' + esc(g.fecha) + '</div>';
    if (locked || e === 'PARA_DISPUTAR' || e === 'SEGUNDA') h += reabrirBox(c);
    h += '<h3>Historial</h3><ul class="hist" id="rHist"></ul>';
    $('rDet').innerHTML = h; fillPhotos($('rDet')); paintHist();
    wireR(c, fotos, picked);
  }
  function reabrirBox(c) {
    return '<div style="margin-top:12px">' + (S.r.reabrir
      ? '<label class="l" for="rMot">Motivo de la reapertura</label><textarea id="rMot" placeholder="Ej.: el cliente envió una foto nueva"></textarea><div class="act"><button class="btn danger" id="rReab">Confirmar reapertura</button></div>'
      : '<button class="btn" id="rReabOpen">Reabrir reclamo</button>') + '</div>';
  }
  function actions(c, ver, picked, expired, locked, g) {
    var b = function (id, cls, txt, dis) { return '<button class="btn ' + cls + '" id="' + id + '"' + (dis ? ' disabled' : '') + '>' + txt + '</button>'; };
    if (c.estado === 'VALIDADO') return b('xNone', '', 'Reclamo validado y cerrado', true);
    if (c.estado === 'ENVIADO') return b('xPdf', '', 'Descargar PDF de la evidencia enviada') ;
    if (c.estado === 'PARA_DISPUTAR') return b('xSend', 'primary', 'Marcar como enviado a PEYA', expired) + b('xPdf', '', 'Descargar PDF con ' + picked.length + ' foto' + (picked.length === 1 ? '' : 's') + ' y nota') + '<div class="sm">La respuesta a PEYA se carga en su portal; acá se arma el PDF y se deja constancia.</div>' + (expired ? '<div class="sm">Venció el plazo: ya no se puede enviar.</div>' : '');
    if (ver === 'valido') return b('xVal', 'primary', 'Validar y cerrar reclamo') + '<div class="sm">No se disputa: el reclamo del cliente es correcto y queda cerrado con esta nota.</div>';
    if (ver === 'noValido') {
      if (expired) return b('xNone', '', 'Venció el plazo: ya no se puede disputar', true) + '<div class="sm">Pasaron más de 10 días corridos desde el reclamo.</div>';
      return b('xDisp', 'primary', picked.length ? 'Preparar respuesta a PEYA' : 'Elegí al menos una foto', !picked.length) + '<div class="sm">Se incluyen solo las fotos tildadas.</div>';
    }
    if (ver === 'noConcl') return b('xSeg', 'primary', 'Dejar para segunda revisión');
    return b('xNone', '', 'Elegí qué muestran las fotos', true);
  }
  function wireR(c, fotos, picked) {
    var d = $('rDet');
    function rerender() { var ta = $('rNota'); if (ta && ta.value) S.r.nota[c.id] = ta.value; paintRDet(); }
    Array.prototype.forEach.call(d.querySelectorAll('[data-c]'), function (b) { b.addEventListener('click', function () { S.r.cand[c.id] = Number(b.getAttribute('data-c')); delete S.r.picked[c.id]; delete S.r.nota[c.id]; openR(c.id); }); });
    Array.prototype.forEach.call(d.querySelectorAll('[data-p]'), function (b) {
      function tog() { var id = b.getAttribute('data-p'), cp = picked.indexOf(id) >= 0 ? picked.filter(function (x) { return x !== id; }) : picked.concat([id]); S.r.picked[c.id] = cp; if (!S.r.nota[c.id]) delete S.r.nota[c.id]; paintRDet(); }
      b.addEventListener('click', function (ev) { if (ev.target.closest('img')) return; tog(); });
      b.addEventListener('keydown', function (ev) { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); tog(); } });
    });
    var rv = $('rVer'); if (rv) rv.addEventListener('click', function (ev) { var b = ev.target.closest('[data-v]'); if (!b || b.disabled) return; S.r.ver[c.id] = b.getAttribute('data-v'); delete S.r.nota[c.id]; paintRDet(); });
    var nt = $('rNota'); if (nt) nt.addEventListener('input', function () { S.r.nota[c.id] = nt.value; });
    function save(accion, extra) {
      var cd = c.cands[candIdx(c)];
      return api('r_save', Object.assign({ id: c.id, accion: accion, veredicto: S.r.ver[c.id] || (c.gestion && c.gestion.veredicto) || '', clave: cd ? cd.clave : '', nota: ($('rNota') || {}).value || '', fotos: picked }, extra || {})).then(function (j) {
        if (!j.ok) { fail(j.error); return null; }
        c.estado = j.estado; c.gestion = j.gestion; delete S.r.ver[c.id]; delete S.r.nota[c.id]; delete S.r.picked[c.id]; S.r.reabrir = false;
        toast('Listo: ' + EST[estOf(c) === 'PEND' ? 'PEND' : estOf(c)][0]); paintR(); openR(c.id); return j;
      }, fail);
    }
    var on = function (id, fn) { var el = $(id); if (el) el.addEventListener('click', function () { el.disabled = true; Promise.resolve(fn()).then(function () { if (el.isConnected) el.disabled = false; }); }); };
    on('xVal', function () { return save('VALIDAR'); });
    on('xDisp', function () { return save('DISPUTAR'); });
    on('xSeg', function () { return save('SEGUNDA'); });
    on('xSend', function () { return save('ENVIAR'); });
    on('xPdf', function () { return pdf(c, fotos); });
    on('rReab', function () { return save('REABRIR', { nota: $('rMot').value }); });
    var ro = $('rReabOpen'); if (ro) ro.addEventListener('click', function () { S.r.reabrir = true; paintRDet(); });
  }

  /* PDF: se arma en una hoja imprimible y el navegador lo guarda como PDF (Imprimir → Guardar como PDF). */
  function pdf(c, fotos) {
    var g = c.gestion || {}, ids = (g.fotos && g.fotos.length ? g.fotos : pickedOf(c)), sel = fotos.filter(function (f) { return ids.indexOf(f.id) >= 0; });
    return Promise.all(sel.map(function (f) { return loadPhoto(f.id); })).then(function (srcs) {
      var cd = c.cands[candIdx(c)];
      $('printArea').innerHTML = '<h1>Respuesta al reclamo – Pedido ' + esc(c.pedido) + '</h1><div>' + esc(c.local || c.localTxt) + ' · ' + esc(c.marca) + ' · reclamo del ' + esc(c.fecha) + '</div>' +
        '<h2>Reclamo del cliente</h2><table><tr><td>Tipo</td><td>' + esc(TIPOS[c.tipo] || c.tipo) + '</td></tr><tr><td>Ítem</td><td>' + esc(c.items || c.productos) + '</td></tr><tr><td>Comentario</td><td>' + esc(c.comentario || '—') + '</td></tr><tr><td>Monto</td><td>' + money(c.monto) + '</td></tr></table>' +
        '<h2>Nota de revisión</h2><div>' + esc(($('rNota') || {}).value || g.nota || '').replace(/\n/g, '<br>') + '</div>' +
        '<h2>Fotos (' + sel.length + ')</h2><div class="pk">' + sel.map(function (f, i) {
          return '<figure><img src="' + srcs[i] + '" alt=""><figcaption>Bolsa ' + f.tipo + ' ' + f.n + ' · tomada ' + esc(f.capturado) + ' · recibida ' + esc(f.recibido) + (f.dist !== '' ? ' · a ' + esc(f.dist) + ' m del local' : '') + '<br>Huella SHA-256: ' + esc(String(f.sha).slice(0, 24)) + '…</figcaption></figure>';
        }).join('') + '</div><h2>Registro</h2><div class="sm">Pedido cargado en la app como «' + esc(cd ? cd.pedido : '') + '» · Generado por ' + esc(S.user.nombre) + ' el ' + new Date().toLocaleString('es-AR') + '</div>';
      setTimeout(function () { window.print(); }, 150);
    }, fail);
  }

  boot();
})();
