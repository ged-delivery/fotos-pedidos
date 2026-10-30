/* Fotos de pedidos – Grupo El Desembarco · app del celular
   Solo cámara en vivo (no hay selector de archivos), cola de envío local, metadatos EXIF,
   hasta 4 fotos por situación, control de calidad en el momento y teclado propio para el número de pedido. */
(function () {
  'use strict';

  var CFG = window.GED_CONFIG || {};
  var VER = CFG.VERSION || '1.2.0';
  var MAX_SIDE = 1600, QUALITY = 0.8, GPS_FRESH_MS = 10 * 60 * 1000, MAX_FOTOS = 4;
  var DEF_MARCAS = ['DS', 'MT', 'MG'];
  var DEF_APPS = ['PEYA', 'RAPPI', 'RAPPI-T', 'MELI', 'UBER', 'PROPIO'];
  var APP_LABEL = { 'RAPPI-T': 'RAPPI T' };
  var LABELS = {
    DIFERIDO: 'Envío tardío', RELOJ: 'Hora dudosa', SIN_GPS: 'Sin ubicación', FUERA_ZONA: 'Fuera del local',
    DUPLICADA: 'Foto repetida', MARCA_DISTINTA: 'Marca distinta', CALIDAD_BAJA: 'Calidad baja'
  };

  /* Calidad de la foto (se ajusta en config.js con fotos reales; ver la guía) */
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  var Q = {
    sharpMin: num(CFG.Q_SHARP_MIN, 35),     // índice de nitidez por debajo del cual se avisa "movida"
    sharpOk: num(CFG.Q_SHARP_OK, 80),       // índice a partir del cual la nitidez vale 100
    darkMean: num(CFG.Q_DARK_MEAN, 55),     // brillo promedio (0-255) por debajo del cual se avisa "oscura"
    glare: num(CFG.Q_GLARE, 0.2),           // fracción de píxeles quemados a partir de la cual se avisa "reflejo"
    low: num(CFG.Q_LOW, 60)                 // puntaje por debajo del cual se avisa y se pide repetir
  };
  var Q_TXT = {
    MOVIDA: ['Foto movida o desenfocada', 'Apoyá el celular en el mostrador y esperá un segundo antes de sacar.'],
    OSCURA: ['Foto muy oscura', 'Prendé la linterna o acercate a una luz.'],
    QUEMADA: ['Demasiado brillo o reflejo', 'Evitá la luz directa sobre la comanda: inclinate un poco o cambiá de ángulo.']
  };

  var $ = function (id) { return document.getElementById(id); };
  var S = {
    token: '', user: null, local: '', marca: '', app: '', pedido: '', marcas: DEF_MARCAS, apps: DEF_APPS,
    fotos: { abierta: [], cerrada: [] }, gps: null, model: '', dev: ''
  };

  /* ───────── Utilidades ───────── */
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function appLabel(v) { return APP_LABEL[v] || v; }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function rid(n) {
    var a = new Uint8Array(n), s = '';
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < n; i++) s += (a[i] % 36).toString(36);
    return s;
  }
  function distM(lat1, lng1, lat2, lng2) {
    var R = 6371000, r = Math.PI / 180, dLa = (lat2 - lat1) * r, dLo = (lng2 - lng1) * r;
    var a = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  var toastT;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, ms || 2800);
  }
  function fmtDate(ms) {
    var d = new Date(ms);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function readAs(blob, how) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r[how](blob);
    });
  }
  function setNet() { $('net').classList.toggle('off', !navigator.onLine); }
  function showView(id) {
    ['vLogin', 'vLocal', 'vApp'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); });
    if (id !== 'vApp') closeKp();
  }

  /* ───────── API (Apps Script) ───────── */
  function apiReady() { return CFG.API_URL && CFG.API_URL.indexOf('http') === 0; }
  function api(action, payload, ms) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 45000);
    var body = JSON.stringify(Object.assign({ action: action, token: S.token }, payload || {}));
    return fetch(CFG.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body, redirect: 'follow', signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { clearTimeout(timer); throw e; });
  }

  /* ───────── Cola local de envíos (IndexedDB; respaldo en memoria) ───────── */
  var DB = 'ged-fotos-cola', ST = 'items', mem = [], useMem = false;
  function openDb() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('sin indexedDB'));
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(ST, { keyPath: 'id' }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function store(mode, fn) {
    if (useMem) return Promise.resolve(fn(null, true));
    return openDb().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(ST, mode), rq = fn(t.objectStore(ST), false);
        t.oncomplete = function () { res(rq && rq.result); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error || new Error('abort')); };
      });
    }, function () { useMem = true; return fn(null, true); });
  }
  function qAll() { return store('readonly', function (s, m) { return m ? mem.slice() : s.getAll(); }).then(function (x) { return x || []; }); }
  function qPut(it) {
    return store('readwrite', function (s, m) {
      if (m) { mem = mem.filter(function (x) { return x.id !== it.id; }); mem.push(it); return null; }
      return s.put(it);
    });
  }
  function qDel(id) {
    return store('readwrite', function (s, m) {
      if (m) { mem = mem.filter(function (x) { return x.id !== id; }); return null; }
      return s.delete(id);
    });
  }
  function qMine() {
    return qAll().then(function (all) {
      var u = S.user && S.user.usuario;
      return all.filter(function (i) { return i.user === u; }).sort(function (a, b) {
        return a.ts - b.ts || (a.tipo < b.tipo ? -1 : a.tipo > b.tipo ? 1 : 0) || ((a.n || 1) - (b.n || 1));
      });
    });
  }

  /* ───────── Sesión ───────── */
  function showLogin(msg) {
    showView('vLogin');
    $('usuario').value = lsGet('ged.lastuser'); $('clave').value = '';
    $('loginErr').textContent = msg || '';
    if (!apiReady()) $('loginErr').textContent = 'Falta configurar la dirección del servidor (archivo config.js).';
  }
  function needLogin(msg) {
    S.token = ''; lsDel('ged.token');
    showLogin(msg);
  }
  function saveSession(res) {
    if (res.token) { S.token = res.token; lsSet('ged.token', res.token); }
    S.user = res.user; lsSet('ged.user', JSON.stringify(res.user)); lsSet('ged.lastuser', res.user.usuario);
    S.marcas = res.marcas && res.marcas.length ? res.marcas : DEF_MARCAS;
    S.apps = res.apps && res.apps.length ? res.apps : DEF_APPS;
    lsSet('ged.cfg', JSON.stringify({ m: S.marcas, a: S.apps }));
  }

  $('btnVer').addEventListener('click', function () {
    var c = $('clave'), show = c.type === 'password';
    c.type = show ? 'text' : 'password'; $('btnVer').textContent = show ? 'Ocultar' : 'Ver';
  });

  $('fLogin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!apiReady()) return showLogin();
    var u = $('usuario').value.trim(), c = $('clave').value;
    if (!u || !c) { $('loginErr').textContent = 'Completá usuario y contraseña'; return; }
    var btn = $('btnLogin'); btn.disabled = true; btn.textContent = 'Entrando…'; $('loginErr').textContent = '';
    S.token = '';
    api('login', { usuario: u, clave: c }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Entrar';
      if (!r.ok) { $('loginErr').textContent = r.error || 'No se pudo entrar'; return; }
      saveSession(r);
      enterApp();
    }).catch(function () {
      btn.disabled = false; btn.textContent = 'Entrar';
      $('loginErr').textContent = 'No hay conexión con el servidor. Probá de nuevo.';
    });
  });

  $('btnSalir').addEventListener('click', function () {
    qMine().then(function (items) {
      var msg = items.length
        ? 'Hay ' + items.length + ' foto(s) sin enviar. Quedan guardadas en este celular y se envían cuando vuelvas a entrar.'
        : 'Vas a cerrar tu sesión en este celular.';
      ask('¿Salir de la sesión?', msg, 'Salir', 'Cancelar').then(function (yes) {
        if (!yes) return;
        clearPhotos(); resetForm();
        S.token = ''; S.user = null; lsDel('ged.token'); lsDel('ged.user');
        showLogin();
      });
    });
  });

  function refreshConfig() {
    if (!apiReady() || !navigator.onLine) return;
    api('config').then(function (r) {
      if (r && r.ok) {
        saveSession(r);
        if (!$('vApp').classList.contains('hidden')) {
          if (localesList().indexOf(S.local) < 0 && localesList().length) { enterApp(); return; }   // le sacaron el local
          paintHeader(); buildChips('chMarca', S.marcas, 'marca'); buildChips('chApp', S.apps, 'app');
        }
      } else if (r && r.code === 'AUTH') needLogin('Tu sesión venció. Entrá de nuevo.');
    }).catch(function () {});
  }

  /* ───────── Local del día ───────── */
  function localesList() { return (S.user && S.user.locales) || []; }
  function setLocal(n) {
    S.local = n; lsSet('ged.local', n); lsSet('ged.localUser', S.user.usuario); lsSet('ged.localDay', todayStr());
  }
  /* Un solo local: se usa siempre. Varios: se elige una vez por día (rotan entre locales). */
  function resolveLocal() {
    var list = localesList();
    if (!list.length) { S.local = ''; return true; }
    if (list.length === 1) { S.local = list[0]; return true; }
    var ok = lsGet('ged.localUser') === S.user.usuario && lsGet('ged.localDay') === todayStr() && list.indexOf(lsGet('ged.local')) >= 0;
    if (ok) { S.local = lsGet('ged.local'); return true; }
    S.local = '';
    return false;
  }

  var pickFromApp = false;
  function openPicker(fromApp) {
    pickFromApp = !!fromApp;
    var list = localesList().slice().sort(function (a, b) { return a.localeCompare(b, 'es'); });
    $('selPick').innerHTML = list.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    var pre = fromApp && S.local ? S.local : lsGet('ged.local');
    $('selPick').value = list.indexOf(pre) >= 0 ? pre : list[0];
    $('pickTitle').textContent = fromApp ? 'Cambiar de local' : 'Elegí tu local de hoy';
    $('pickWarn').classList.toggle('hidden', !(fromApp && (pedidoVal() || hasPhotos())));
    $('btnPickCancel').classList.toggle('hidden', !fromApp);
    $('gpsBox').classList.add('hidden');
    showView('vLocal');
    suggestByGps();
  }
  function suggestByGps() {
    var geo = (S.user && S.user.geo) || [];
    if (!geo.length || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (p) {
      if ($('vLocal').classList.contains('hidden')) return;
      var best = null, bd = Infinity;
      geo.forEach(function (g) {
        var d = distM(p.coords.latitude, p.coords.longitude, g.lat, g.lng);
        if (d < bd) { bd = d; best = g; }
      });
      if (!best || bd > 1000) return;
      $('gpsTxt').innerHTML = 'Estás a ' + Math.round(bd) + ' m de <b>' + esc(best.n) + '</b>.';
      var b = $('btnGpsUse'); b.textContent = 'Usar ' + best.n; b.setAttribute('data-n', best.n);
      $('gpsBox').classList.remove('hidden');
    }, function () {}, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
  }
  function confirmPick(n) {
    var changed = n !== S.local;
    setLocal(n);
    if (changed) { clearPhotos(); resetForm(); }
    openMain();
    if (changed && !$('tHoy').classList.contains('hidden')) loadHoy();
  }
  $('btnPickOk').addEventListener('click', function () { if ($('selPick').value) confirmPick($('selPick').value); });
  $('btnGpsUse').addEventListener('click', function () { confirmPick($('btnGpsUse').getAttribute('data-n')); });
  $('btnPickCancel').addEventListener('click', function () { openMain(); });
  $('btnLocal').addEventListener('click', function () { openPicker(true); });

  /* ───────── Pantalla principal ───────── */
  function enterApp() {
    if (!resolveLocal()) { openPicker(false); return; }
    openMain();
  }
  function paintHeader() {
    $('hUser').textContent = (S.user && (S.user.nombre || S.user.usuario)) || '';
    $('hLocal').textContent = S.local || 'Sin local asignado';
    $('btnLocal').classList.toggle('hidden', localesList().length <= 1);
  }
  function openMain() {
    showView('vApp');
    paintHeader();
    if (!localesList().length) toast('Tu usuario no tiene locales asignados. Avisá al administrador.', 6000);
    buildChips('chMarca', S.marcas, 'marca');
    buildChips('chApp', S.apps, 'app');
    var m = lsGet('ged.marca'); if (m && S.marcas.indexOf(m) >= 0) { S.marca = m; paintChips('chMarca', m); }
    paintPedido(); paintShots(); refreshForm(); renderCola(); flush(); getGps();
  }

  var tabs = document.querySelectorAll('nav button');
  Array.prototype.forEach.call(tabs, function (b) {
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-tab');
      Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle('on', x === b); });
      $('tCargar').classList.toggle('hidden', t !== 'cargar');
      $('tHoy').classList.toggle('hidden', t !== 'hoy');
      $('tEnvios').classList.toggle('hidden', t !== 'envios');
      if (t !== 'cargar') closeKp();
      if (t === 'hoy') loadHoy();
      if (t === 'envios') renderCola();
    });
  });

  /* ───────── Formulario ───────── */
  function buildChips(id, values, key) {
    var box = $(id); box.innerHTML = '';
    values.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip' + (S[key] === v ? ' on' : ''); b.textContent = key === 'app' ? appLabel(v) : v;
      b.setAttribute('data-v', v);
      b.addEventListener('click', function () {
        S[key] = v; paintChips(id, v);
        if (key === 'marca') lsSet('ged.marca', v);
        if (key === 'app' && kp.open) { kp.mode = v === 'UBER' ? 'abc' : 'num'; paintKp(); }
        refreshForm();
      });
      box.appendChild(b);
    });
  }
  function paintChips(id, val) {
    Array.prototype.forEach.call($(id).children, function (c) { c.classList.toggle('on', c.getAttribute('data-v') === val); });
  }
  function pedidoVal() { return S.pedido; }
  function dataOk() { return !!(S.local && S.marca && S.app && pedidoVal()); }
  function nFotos() { return S.fotos.abierta.length + S.fotos.cerrada.length; }
  function hasPhotos() { return nFotos() > 0; }

  function refreshForm() {
    var locked = hasPhotos();
    Array.prototype.forEach.call(document.querySelectorAll('#chMarca .chip, #chApp .chip'), function (c) { c.disabled = locked; });
    $('pedidoBtn').disabled = locked;
    if (locked) closeKp();
    $('btnCorregir').classList.toggle('hidden', !locked);
    $('btnGuardar').disabled = !(dataOk() && S.fotos.abierta.length && S.fotos.cerrada.length);
  }

  $('btnCorregir').addEventListener('click', function () {
    ask('¿Corregir los datos?', 'Si corregís los datos hay que volver a sacar las fotos de este pedido.', 'Corregir', 'Cancelar').then(function (yes) {
      if (!yes) return;
      clearPhotos(); refreshForm();
    });
  });

  function clearPhotos() {
    ['abierta', 'cerrada'].forEach(function (t) {
      S.fotos[t].forEach(function (f) { if (f.url) URL.revokeObjectURL(f.url); });
      S.fotos[t] = [];
    });
    paintShots();
  }
  function resetForm() {
    S.pedido = ''; S.app = ''; paintChips('chApp', ''); paintPedido(); closeKp(); refreshForm();
  }

  function paintShots() {
    ['abierta', 'cerrada'].forEach(function (t) {
      var T = t === 'abierta' ? 'Abierta' : 'Cerrada';
      var el = $('shot' + T), arr = S.fotos[t], n = arr.length, last = arr[n - 1];
      var im = el.querySelector('img'); if (im) el.removeChild(im);
      var tg = el.querySelector('.tag'); if (tg) el.removeChild(tg);
      el.classList.toggle('has', n > 0);
      if (n) {
        var img = document.createElement('img'); img.alt = ''; img.src = last.url; el.insertBefore(img, el.firstChild);
        var d = document.createElement('div'); d.className = 'tag';
        d.textContent = (t === 'abierta' ? 'Bolsa abierta' : 'Bolsa cerrada') + ' · ' + n + ' de ' + MAX_FOTOS + ' ✓' +
          (n < MAX_FOTOS ? ' · tocá para agregar otra' : ' · máximo');
        el.appendChild(d);
      }
      Array.prototype.forEach.call($('dots' + T).children, function (i, k) { i.classList.toggle('on', k < n); });
      $('rm' + T).classList.toggle('hidden', n === 0);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.shot'), function (b) {
    b.addEventListener('click', function () { openCam(b.getAttribute('data-tipo')); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-rm]'), function (b) {
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-rm'), f = S.fotos[t].pop();
      if (f && f.url) URL.revokeObjectURL(f.url);
      paintShots(); refreshForm();
    });
  });

  /* ───────── Teclado propio para el número de pedido ───────── */
  var kp = { open: false, mode: 'num' };
  var ABC_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL-'];

  function keyBtn(label, attrs, fn) {
    return '<button type="button" class="key' + (fn ? ' fn' : '') + '" ' + attrs + '>' + label + '</button>';
  }
  function buildKeys() {
    var n = '';
    '123456789'.split('').forEach(function (d) { n += keyBtn(d, 'data-k="' + d + '" aria-label="Dígito ' + d + '"'); });
    n += keyBtn('ABC', 'data-act="abc" aria-label="Cambiar a teclado con letras"', true);
    n += keyBtn('0', 'data-k="0" aria-label="Dígito 0"');
    n += keyBtn('Borrar', 'data-act="del" aria-label="Borrar un carácter"', true);
    $('kpNum').innerHTML = n;

    var a = '';
    ABC_ROWS.forEach(function (row) {
      a += '<div class="kr">' + row.split('').map(function (c) {
        return keyBtn(c, 'data-k="' + c + '" aria-label="' + (c === '-' ? 'Guion' : (/\d/.test(c) ? 'Dígito ' : 'Letra ') + c) + '"');
      }).join('') + '</div>';
    });
    a += '<div class="kr">' + keyBtn('123', 'data-act="num" aria-label="Cambiar a teclado numérico"', true) +
      'ZXCVBNM'.split('').map(function (c) { return keyBtn(c, 'data-k="' + c + '" aria-label="Letra ' + c + '"'); }).join('') +
      keyBtn('Borrar', 'data-act="del" aria-label="Borrar un carácter"', true) + '</div>';
    $('kpAbc').innerHTML = a;
  }
  function paintPedido() {
    var v = S.pedido;
    $('pedidoTxt').textContent = v || 'Como figura en la comanda';
    $('pedidoTxt').classList.toggle('ph', !v);
    $('pedidoBtn').classList.toggle('open', kp.open);
    $('pedidoCaret').classList.toggle('hidden', !kp.open);
  }
  function paintKp() {
    $('kp').classList.toggle('hidden', !kp.open);
    $('kpNum').classList.toggle('hidden', kp.mode !== 'num');
    $('kpAbc').classList.toggle('hidden', kp.mode !== 'abc');
    document.body.classList.toggle('kpopen', kp.open);
    paintPedido();
  }
  function openKp() {
    if (hasPhotos()) return;
    kp.open = true; kp.mode = S.app === 'UBER' ? 'abc' : 'num';
    paintKp();
    var b = $('pedidoBtn');
    if (b.scrollIntoView) { try { b.scrollIntoView({ block: 'center' }); } catch (e) {} }
  }
  function closeKp() {
    if (!kp.open) return;
    kp.open = false; paintKp(); refreshForm();
  }
  $('pedidoBtn').addEventListener('click', function () { if (kp.open) closeKp(); else openKp(); });
  $('btnKpOk').addEventListener('click', closeKp);
  $('kp').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('button') : null;
    if (!b || b.id === 'btnKpOk') return;
    var k = b.getAttribute('data-k'), act = b.getAttribute('data-act');
    if (k) { if (S.pedido.length < 30) S.pedido += k; }
    else if (act === 'del') S.pedido = S.pedido.slice(0, -1);
    else if (act === 'abc') kp.mode = 'abc';
    else if (act === 'num') kp.mode = 'num';
    paintKp(); refreshForm();
  });
  buildKeys();

  /* ───────── Ubicación ───────── */
  function setGpsLabel(t) { var e = $('camGps'); if (e) e.textContent = t; }
  function getGps() {
    if (!navigator.geolocation) { setGpsLabel('Ubicación: no disponible'); return; }
    navigator.geolocation.getCurrentPosition(function (p) {
      S.gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: p.timestamp || Date.now() };
      setGpsLabel('Ubicación ✓ (±' + Math.round(p.coords.accuracy) + ' m)');
    }, function (e) {
      setGpsLabel(e && e.code === 1 ? 'Ubicación bloqueada en el navegador' : 'Ubicación no disponible');
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
  }
  function freshGps() { return S.gps && Date.now() - S.gps.ts < GPS_FRESH_MS ? S.gps : null; }

  /* Cuadro de confirmación propio (reemplaza el de Chrome). Devuelve una promesa con true/false. */
  function ask(title, msg, yes, no, danger) {
    return new Promise(function (resolve) {
      var box = $('dlg'), y = $('dlgYes'), n = $('dlgNo');
      $('dlgT').textContent = title; $('dlgM').textContent = msg;
      y.textContent = yes || 'Aceptar'; n.textContent = no || 'Cancelar';
      y.className = danger ? 'danger' : 'primary';
      function done(v) {
        box.classList.add('hidden'); y.removeEventListener('click', ok); n.removeEventListener('click', cancel);
        box.removeEventListener('click', bg); document.removeEventListener('keydown', key); resolve(v);
      }
      function ok() { done(true); } function cancel() { done(false); }
      function bg(e) { if (e.target === box) done(false); }
      function key(e) { if (e.key === 'Escape') done(false); }
      y.addEventListener('click', ok); n.addEventListener('click', cancel);
      box.addEventListener('click', bg); document.addEventListener('keydown', key);
      box.classList.remove('hidden'); n.focus();
    });
  }

  /* ───────── Calidad de la foto (mide nitidez y luz en el celular) ───────── */
  /* Devuelve { s: puntaje 0-100, sh: índice de nitidez, lu: brillo promedio, o: [códigos], warn: bool } o null si no pudo medir. */
  function analyze(src) {
    try {
      var W = 480, H = Math.max(3, Math.round(src.height * W / src.width));
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var g = c.getContext('2d'); g.drawImage(src, 0, 0, W, H);
      var d = g.getImageData(0, 0, W, H).data, n = W * H, gray = new Float32Array(n), sum = 0, bright = 0, i, p;
      for (i = 0, p = 0; i < n; i++, p += 4) {
        var y = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        gray[i] = y; sum += y; if (y > 245) bright++;
      }
      var mean = sum / n, gv = 0;
      for (i = 0; i < n; i++) { var dv = gray[i] - mean; gv += dv * dv; }
      gv /= n;
      var s1 = 0, s2 = 0, m = 0, x, yy, k, l;
      for (yy = 1; yy < H - 1; yy++) {
        for (x = 1; x < W - 1; x++) {
          k = yy * W + x; l = 4 * gray[k] - gray[k - 1] - gray[k + 1] - gray[k - W] - gray[k + W];
          s1 += l; s2 += l * l; m++;
        }
      }
      var lap = s2 / m - (s1 / m) * (s1 / m);
      var sh = Math.min(9999, Math.round(lap / (gv + 1) * 100));      // nitidez relativa al contraste de la escena
      var brightFrac = bright / n;

      var sharpScore = Math.max(0, Math.min(1, (sh - 15) / Math.max(1, Q.sharpOk - 15)));
      var lightScore = mean < 90 ? (mean - 20) / 70 : mean > 185 ? (245 - mean) / 60 : 1;
      lightScore = Math.max(0, Math.min(1, lightScore));
      if (brightFrac > 0.1) lightScore *= Math.max(0, 1 - (brightFrac - 0.1) * 3);
      var score = Math.round(100 * (0.6 * sharpScore + 0.4 * lightScore));

      var o = [];
      if (sh < Q.sharpMin) o.push('MOVIDA');
      if (mean < Q.darkMean) o.push('OSCURA');
      if (brightFrac > Q.glare) o.push('QUEMADA');
      return { s: score, sh: sh, lu: Math.round(mean), o: o, warn: score < Q.low || o.length > 0 };
    } catch (e) { return null; }
  }

  /* ───────── Cámara en vivo (sin galería) ───────── */
  var cam = { open: false, stream: null, tipo: '', canvas: null, native: '', capAt: 0, track: null, torch: false, torchOk: false, zoomOk: false, live: false, q: null };
  var gridOn = lsGet('ged.grid') !== '0';                    // la cuadrícula viene activada de fábrica

  function stopStream(s) { if (s) s.getTracks().forEach(function (t) { t.stop(); }); }
  function camMsg(t) { var m = $('camMsg'); m.textContent = t || ''; m.classList.toggle('hidden', !t); }

  /* Ayudas de encuadre y controles que dependen del celular (linterna, zoom).
     Solo se muestran si el navegador/celular los soporta; no cambian la foto que se guarda. */
  function layoutGrid() {
    var v = $('video'), vw = v.videoWidth, vh = v.videoHeight, box = $('camView');
    if (!vw || !vh) return;
    var W = box.clientWidth, H = box.clientHeight, k = Math.min(W / vw, H / vh), w = vw * k, h = vh * k, g = $('camGrid');
    g.style.width = w + 'px'; g.style.height = h + 'px'; g.style.left = ((W - w) / 2) + 'px'; g.style.top = ((H - h) / 2) + 'px';
  }
  function paintCamTools() {
    $('camGrid').classList.toggle('hidden', !(gridOn && cam.live));
    $('btnGrid').classList.toggle('on', gridOn);
    $('btnTorch').classList.toggle('on', cam.torch);
    $('camTools').classList.toggle('hidden', !cam.live);
    $('zoom').classList.toggle('hidden', !(cam.live && cam.zoomOk));
  }
  function setTorch(on) {
    if (!cam.track) return;
    cam.track.applyConstraints({ advanced: [{ torch: on }] }).then(function () {
      cam.torch = on; lsSet('ged.torch', on ? '1' : '0'); paintCamTools();
    }, function () { toast('Este celular no permite usar la linterna desde la app.', 4000); });
  }
  function setupCamTools(stream) {
    var track = stream.getVideoTracks()[0], caps = {};
    cam.track = track; cam.torch = false; cam.torchOk = false;
    try { caps = track && track.getCapabilities ? track.getCapabilities() : {}; } catch (e) { caps = {}; }
    cam.torchOk = !!caps.torch;
    $('btnTorch').classList.toggle('hidden', !cam.torchOk);
    var z = caps.zoom, zr = $('zoom');
    cam.zoomOk = !!(z && z.max > z.min);
    if (cam.zoomOk) { zr.min = z.min; zr.max = z.max; zr.step = z.step || 0.1; zr.value = z.min; }
    cam.live = true; paintCamTools(); layoutGrid();
    if (cam.torchOk && lsGet('ged.torch') === '1') setTorch(true);
  }
  $('btnGrid').addEventListener('click', function () { gridOn = !gridOn; lsSet('ged.grid', gridOn ? '1' : '0'); paintCamTools(); });
  $('btnTorch').addEventListener('click', function () { setTorch(!cam.torch); });
  $('zoom').addEventListener('input', function () {
    if (cam.track) cam.track.applyConstraints({ advanced: [{ zoom: Number($('zoom').value) }] }).catch(function () {});
  });
  window.addEventListener('resize', function () { if (cam.open) layoutGrid(); });

  /* Aviso de calidad en la pantalla de revisión de la foto */
  function paintReview() {
    var q = cam.q, bad = !!(q && q.warn);
    var qb = $('camQ'); qb.classList.toggle('hidden', !q);
    if (q) qb.textContent = 'Nitidez ' + q.sh + ' · Luz ' + q.lu + ' · Puntaje ' + q.s;
    var w = $('camWarn'); w.classList.toggle('hidden', !bad);
    if (bad) {
      var titles = [], tips = [];
      q.o.forEach(function (c) { if (Q_TXT[c]) { titles.push(Q_TXT[c][0]); tips.push(Q_TXT[c][1]); } });
      if (!titles.length) { titles.push('Calidad baja'); tips.push('Probá de nuevo con más luz y el celular quieto.'); }
      $('camWarnT').textContent = 'Puntaje ' + q.s + '/100 · ' + titles.join(' · ');
      $('camWarnS').textContent = tips.join(' ');
    }
    $('btnRepetir').className = bad ? 'primary' : 'secondary';
    $('btnUsar').className = bad ? 'secondary' : 'primary';
    $('btnUsar').textContent = bad ? 'Usar igual' : 'Usar foto';
  }

  function openCam(tipo) {
    if (!dataOk()) { toast('Primero elegí marca, canal y número de pedido'); return; }
    if (S.fotos[tipo].length >= MAX_FOTOS) { toast('Ya hay ' + MAX_FOTOS + ' fotos. Quitá la última si querés repetirla.', 4000); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Este navegador no permite usar la cámara. Abrí la app en Chrome.', 6000); return;
    }
    closeKp();
    cam.tipo = tipo; cam.canvas = null; cam.q = null; cam.open = true;
    $('camTitle').textContent = (tipo === 'abierta' ? 'Bolsa ABIERTA' : 'Bolsa CERRADA') + ' · foto ' + (S.fotos[tipo].length + 1) + '/' + MAX_FOTOS +
      ' · ' + appLabel(S.app) + ' #' + pedidoVal();
    $('cam').classList.remove('hidden');
    $('video').classList.remove('hidden'); $('camBot1').classList.remove('hidden'); $('camBot2').classList.add('hidden');
    paintReview();
    $('btnShutter').disabled = true; camMsg('Abriendo cámara…');
    try { history.pushState({ cam: 1 }, ''); } catch (e) {}
    getGps();

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
    }).then(function (stream) {
      if (!cam.open) { stopStream(stream); return; }
      cam.stream = stream;
      var v = $('video');
      v.srcObject = stream;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
      var ready = function () {
        if (cam.open && v.videoWidth) { camMsg(''); $('btnShutter').disabled = false; layoutGrid(); }
      };
      v.onplaying = ready; v.onloadedmetadata = ready; setTimeout(ready, 1500);
      setupCamTools(stream);
    }).catch(function (err) {
      var n = err && err.name;
      camMsg(n === 'NotAllowedError' || n === 'SecurityError'
        ? 'La cámara está bloqueada. Tocá el candado de la barra de direcciones → Permisos → Cámara → Permitir.'
        : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'No se encontró una cámara en este celular.'
        : 'No se pudo abrir la cámara. Cerrá otras apps que la usen y probá de nuevo.');
    });
  }

  function closeCam() {
    if (!cam.open) return;
    cam.open = false; stopStream(cam.stream); cam.stream = null;
    cam.track = null; cam.torch = false; cam.zoomOk = false; cam.live = false; cam.q = null;
    var v = $('video'); v.pause(); v.srcObject = null; v.onplaying = null; v.onloadedmetadata = null;
    paintCamTools(); paintReview();
    removeShot(); $('cam').classList.add('hidden');
  }
  function dismissCam() {
    if (!cam.open) return;
    if (history.state && history.state.cam) history.back(); else closeCam();
  }
  window.addEventListener('popstate', function () { if (cam.open) closeCam(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && cam.open) dismissCam(); });
  $('btnCamCerrar').addEventListener('click', dismissCam);

  function removeShot() {
    if (cam.canvas && cam.canvas.parentNode) cam.canvas.parentNode.removeChild(cam.canvas);
    cam.canvas = null;
  }

  $('btnShutter').addEventListener('click', function () {
    var v = $('video');
    if (!v.videoWidth) return;
    cam.capAt = Date.now();                                  // hora de captura (reloj del celular)
    var w = v.videoWidth, h = v.videoHeight, k = Math.min(1, MAX_SIDE / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    cam.canvas = c; cam.native = w + 'x' + h;
    cam.q = analyze(c);
    v.pause(); $('video').classList.add('hidden');
    $('camView').insertBefore(c, $('camGps'));
    cam.live = false; paintCamTools();
    $('camBot1').classList.add('hidden'); $('camBot2').classList.remove('hidden');
    paintReview();
  });

  $('btnRepetir').addEventListener('click', function () {
    removeShot(); cam.q = null; paintReview();
    var v = $('video'); v.classList.remove('hidden');
    var p = v.play(); if (p && p.catch) p.catch(function () {});
    cam.live = true; paintCamTools(); layoutGrid();
    $('camBot2').classList.add('hidden'); $('camBot1').classList.remove('hidden');
  });

  $('btnUsar').addEventListener('click', function () {
    if (!cam.canvas) return;
    var btn = $('btnUsar'); btn.disabled = true;
    var tipo = cam.tipo, form = { local: S.local, marca: S.marca, app: S.app, pedido: pedidoVal() };
    var n = S.fotos[tipo].length + 1;
    if (n > MAX_FOTOS) { btn.disabled = false; dismissCam(); return; }
    var tipoTxt = tipo === 'abierta' ? 'ABIERTA' : 'CERRADA', tipoN = tipoTxt + ' ' + n;
    var gps = freshGps(), capAt = cam.capAt, uid = 'p' + Date.now().toString(36) + rid(8);
    var user = S.user.usuario, q = cam.q;

    // Banda inferior con los datos del pedido, visible en la imagen
    var out = stampFooter(cam.canvas, [
      'GED · ' + form.local + ' · ' + form.marca + ' · ' + form.app + ' · #' + form.pedido + ' · ' + tipoN,
      fmtDate(capAt) + ' · ' + user + ' · ' + S.dev.slice(0, 8)
    ]);
    var res = cam.native + '>' + out.width + 'x' + out.height;

    out.toBlob(function (blob) {
      if (!blob) { btn.disabled = false; toast('No se pudo procesar la foto. Probá de nuevo.'); return; }
      readAs(blob, 'readAsArrayBuffer').then(function (buf) {
        var bytes;
        try {
          bytes = ExifWriter.injectIntoJpeg(buf, {
            description: ['GED', form.local, form.marca, form.app, form.pedido, tipoTxt + n].join('|'),
            artist: user, model: S.model, software: 'GED Fotos ' + VER,
            copyright: 'Grupo El Desembarco - uso interno', capturedAt: capAt,
            comment: { v: 2, u: user, l: form.local, m: form.marca, a: form.app, p: form.pedido, t: tipoTxt, n: n, uid: uid, dev: S.dev, cap: capAt, ver: VER, q: q ? q.s : null },
            gps: gps, width: out.width, height: out.height
          });
        } catch (e) { bytes = new Uint8Array(buf); }
        var final = new Blob([bytes], { type: 'image/jpeg' });
        var meta = {
          capturedAt: capAt, lat: gps ? gps.lat : null, lng: gps ? gps.lng : null, acc: gps ? gps.acc : null,
          dev: S.dev, model: S.model, ua: navigator.userAgent, res: res, ver: VER
        };
        if (q) meta.q = { s: q.s, sh: q.sh, lu: q.lu, o: q.o };
        S.fotos[tipo].push({ uid: uid, n: n, blob: final, buf: bytes.buffer, url: URL.createObjectURL(final), capAt: capAt, form: form, meta: meta });
        btn.disabled = false; dismissCam(); paintShots(); refreshForm();
      });
    }, 'image/jpeg', QUALITY);
  });

  function stampFooter(src, lines) {
    var w = src.width, fs = Math.max(14, Math.round(w / 42)), pd = Math.round(fs * 0.5), lh = Math.round(fs * 1.3);
    var band = pd * 2 + lh * lines.length;
    var out = document.createElement('canvas'); out.width = w; out.height = src.height + band;
    var g = out.getContext('2d');
    g.drawImage(src, 0, 0);
    g.fillStyle = '#111827'; g.fillRect(0, src.height, w, band);
    g.fillStyle = '#ffffff'; g.font = '700 ' + fs + 'px Roboto, sans-serif'; g.textBaseline = 'top';
    lines.forEach(function (t, i) { g.fillText(t, pd, src.height + pd + i * lh, w - pd * 2); });
    return out;
  }

  /* ───────── Guardar = poner en la cola local y enviar ───────── */
  $('btnGuardar').addEventListener('click', function () {
    if (!(dataOk() && S.fotos.abierta.length && S.fotos.cerrada.length)) return;
    var items = [];
    ['abierta', 'cerrada'].forEach(function (t) {
      S.fotos[t].forEach(function (f) {
        items.push({
          id: f.uid, user: S.user.usuario, ts: f.capAt, tipo: t, n: f.n, local: f.form.local, marca: f.form.marca,
          app: f.form.app, pedido: f.form.pedido, buf: f.buf, meta: f.meta, tries: 0, error: '', lastError: '',
          label: appLabel(f.form.app) + ' · ' + f.form.pedido + ' · ' + (t === 'abierta' ? 'bolsa abierta ' : 'bolsa cerrada ') + f.n
        });
      });
    });
    $('btnGuardar').disabled = true;
    Promise.all(items.map(qPut)).then(function () {
      clearPhotos(); resetForm();
      toast(navigator.onLine ? 'Guardado. Enviando…' : 'Guardado en el celular. Se envía cuando haya conexión.', 3200);
      renderCola(); flush();
    }, function () {
      refreshForm(); toast('No se pudo guardar en el celular (¿poco espacio?). Liberá espacio y probá de nuevo.', 6000);
    });
  });

  /* ───────── Envío de la cola ───────── */
  var flushing = false;
  /* La foto se guarda como ArrayBuffer (no como Blob): es lo más confiable en IndexedDB, sobre todo en iPhone. */
  function itemBlob(it) { return it.buf ? new Blob([it.buf], { type: 'image/jpeg' }) : it.blob; }
  function sendItem(it) {
    var read;
    try { read = readAs(itemBlob(it), 'readAsDataURL'); } catch (e) { read = Promise.reject(e); }
    return read.then(function (url) {
      return api('upload', {
        local: it.local, marca: it.marca, app: it.app, pedido: it.pedido, tipo: it.tipo, n: it.n || 1, uid: it.id,
        data: url.split(',')[1], meta: it.meta
      }, 90000);
    }, function () {
      return { ok: false, permanent: true, error: 'No se pudo leer la foto guardada' };   // queda visible en "Envíos"
    });
  }
  function flush() {
    if (flushing || !S.token || !S.user || !navigator.onLine || !apiReady()) return Promise.resolve();
    flushing = true;
    var done = function () { flushing = false; renderCola(); };
    return qMine().then(function (all) {
      var items = all.filter(function (i) { return !i.error; });
      var chain = Promise.resolve(), stop = false;
      items.forEach(function (it) {
        chain = chain.then(function () {
          if (stop) return;
          return sendItem(it).then(function (r) {
            if (r && r.ok) return qDel(it.id);
            if (r && r.code === 'AUTH') { stop = true; needLogin('Tu sesión venció. Entrá de nuevo para enviar las fotos pendientes.'); return; }
            if (r && r.permanent) { it.error = r.error || 'Error'; return qPut(it); }
            it.tries = (it.tries || 0) + 1; it.lastError = (r && r.error) || ''; stop = true; return qPut(it);
          }).catch(function () { stop = true; });
        });
      });
      return chain;
    }).then(done, done);
  }
  window.addEventListener('online', function () { setNet(); flush(); refreshConfig(); });
  window.addEventListener('offline', setNet);
  setInterval(function () { if (S.token) flush(); }, 20000);

  $('btnReintentar').addEventListener('click', function () {
    qMine().then(function (items) {
      return Promise.all(items.map(function (i) { i.error = ''; i.tries = 0; return qPut(i); }));
    }).then(flush);
  });

  function renderCola() {
    if (!S.user) return;
    qMine().then(function (items) {
      var b = $('badge'); b.textContent = items.length; b.classList.toggle('hidden', !items.length);
      var box = $('colaBox');
      if (!items.length) { box.innerHTML = '<div class="empty">Todo enviado ✓</div>'; return; }
      box.innerHTML = items.map(function (i) {
        var st = i.error ? '<span class="st bad">' + esc(i.error) + '</span>'
          : '<span class="st warn">' + (i.tries ? 'Reintentando' : 'Pendiente') + '</span>';
        var acts = i.error
          ? '<div class="acts"><button type="button" class="secondary" data-dl="' + esc(i.id) + '">Guardar copia</button>' +
            '<button type="button" class="secondary" data-rm="' + esc(i.id) + '">Descartar</button></div>' : '';
        return '<div class="row"><div class="m"><b>' + esc(i.label) + '</b><small>' + esc(i.local) + ' · ' + fmtDate(i.ts) + '</small></div>' + st + acts + '</div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('[data-dl]'), function (btn) {
        btn.addEventListener('click', function () { downloadCopy(items, btn.getAttribute('data-dl')); });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-rm]'), function (btn) {
        btn.addEventListener('click', function () {
          ask('¿Descartar la foto?', 'Se borra de este celular y no se enviará.', 'Descartar', 'Cancelar', true).then(function (yes) {
            if (yes) qDel(btn.getAttribute('data-rm')).then(renderCola);
          });
        });
      });
    });
  }

  function downloadCopy(items, id) {
    var it = items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(itemBlob(it));
    a.download = [it.local, it.marca, it.app, it.pedido, it.tipo, it.n || 1, it.id].join('_').replace(/[^\w\-]+/g, '-') + '.jpg';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 4000);
  }

  /* ───────── Pestaña "Hoy" ───────── */
  function alertText(s) {
    var out = [];
    String(s || '').split(',').forEach(function (x) {
      var k = x.replace(/\(.*\)/, '').trim();
      if (k && LABELS[k] && out.indexOf(LABELS[k]) < 0) out.push(LABELS[k]);
    });
    return out.join(' · ');
  }
  function fotosText(i) {
    if (typeof i.fotosA !== 'number' || typeof i.fotosC !== 'number') return '';
    var t = i.fotosA + i.fotosC;
    return t + (t === 1 ? ' foto' : ' fotos') + ' (' + i.fotosA + ' abierta' + (i.fotosA === 1 ? '' : 's') + ', ' + i.fotosC + ' cerrada' + (i.fotosC === 1 ? '' : 's') + ')';
  }
  function loadHoy() {
    var box = $('hoyBox'); box.innerHTML = '<div class="empty">Cargando…</div>';
    if (!S.local) { box.innerHTML = '<div class="empty">Sin local asignado.</div>'; return; }
    api('today', { local: S.local }).then(function (r) {
      if (r && r.code === 'AUTH') { needLogin('Tu sesión venció. Entrá de nuevo.'); return; }
      if (!r || !r.ok) { box.innerHTML = '<div class="empty">' + esc((r && r.error) || 'No se pudo cargar') + '</div>'; return; }
      if (!r.items.length) { box.innerHTML = '<div class="empty">Todavía no hay pedidos hoy.</div>'; return; }
      box.innerHTML = r.items.map(function (i) {
        var a = alertText(i.alertas), f = fotosText(i);
        return '<div class="row"><div class="m"><b>' + esc(appLabel(i.app)) + ' · ' + esc(i.pedido) + '</b><small>' + esc(i.marca) +
          (f ? ' · ' + esc(f) : '') + (a ? ' · ⚠ ' + esc(a) : '') + '</small></div><span class="st ' + (i.estado === 'Completo' ? 'ok' : 'warn') + '">' + esc(i.estado) + '</span></div>';
      }).join('');
    }).catch(function () { box.innerHTML = '<div class="empty">Sin conexión.</div>'; });
  }
  $('btnHoy').addEventListener('click', loadHoy);

  /* ───────── Arranque ───────── */
  function boot() {
    setNet();
    S.dev = lsGet('ged.dev');
    if (!S.dev) { S.dev = 'd-' + rid(10); lsSet('ged.dev', S.dev); }
    var ua = navigator.userAgent || '', mm = /Android[^;]*;\s*([^)]+)\)/.exec(ua);
    S.model = mm && mm[1] && mm[1] !== 'K' ? mm[1].trim() : '';
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      navigator.userAgentData.getHighEntropyValues(['model']).then(function (v) { if (v && v.model) S.model = v.model; }).catch(function () {});
    }
    if (document.fonts && document.fonts.load) document.fonts.load('700 24px Roboto');

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});

    var tok = lsGet('ged.token'), us = lsGet('ged.user');
    if (tok && us) {
      try {
        S.token = tok; S.user = JSON.parse(us);
        var cfg = JSON.parse(lsGet('ged.cfg') || '{}');
        if (cfg.m) S.marcas = cfg.m; if (cfg.a) S.apps = cfg.a;
        enterApp(); refreshConfig();
        return;
      } catch (e) { /* sesión guardada dañada: pide entrar de nuevo */ }
    }
    showLogin();
  }
  boot();
})();
