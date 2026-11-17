// Apex Grand Prix - game shell: menus, saves, touch controls, screen handling
(function () {
  'use strict';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const POINTS = [25, 18, 15, 12, 10, 8, 6, 4];
  const ORDER = ['monza', 'silverstone', 'spa', 'interlagos', 'redbullring', 'monaco'];
  const SAVE_KEY = 'apexgp.save.v1';
  const touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 1;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  // ---------- save data ----------
  const defaults = () => ({
    profile: { name: 'YOU', num: 7, livery: 0 },
    settings: { assist: 'Full', autoThr: touch, sens: 1, camera: 'Chase', quality: touch ? 'Medium' : 'High', units: 'kmh', vol: 0.8, names: true, map: true, laps: 3, rivals: 5, diff: 'Medium', quali: true },
    records: {}, champ: null, stats: { races: 0, wins: 0, podiums: 0, poles: 0, titles: 0 }, seenInstall: false,
  });
  let mem = null;
  function load() {
    if (mem) return mem;
    let d = defaults();
    try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { const p = JSON.parse(raw); d = Object.assign(d, p); d.profile = Object.assign(defaults().profile, p.profile); d.settings = Object.assign(defaults().settings, p.settings); d.stats = Object.assign(defaults().stats, p.stats); } } catch (e) { }
    mem = d; return d;
  }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(mem)); } catch (e) { } }
  const S = load();

  // ---------- engine ----------
  const ui = {
    screen: 'title', mode: 'quick', trackId: S.settings.lastTrack || 'monza', lastEngineScreen: null,
    showGarage() { return ['title', 'menu', 'garage', 'tracks', 'champ', 'records', 'settings', 'howto', 'standings'].indexOf(ui.screen) >= 0; },
    garageFocus() { return ui.screen === 'garage' ? 'garage' : 'menu'; },
    recordFor(id) { const r = S.records[id]; return r && r.best ? r.best : null; },
    onEngine(s) {
      if (s.screen && ui.screen === 'game' && s.screen !== ui.lastEngineScreen) { ui.lastEngineScreen = s.screen; render(); }
      if (ui.screen === 'game' && engine.state.screen === 'loading' && (s.prog != null || s.msg != null)) updateLoading();
    },
    onLap(id, t) { const r = rec(id); if (!r.best || t < r.best) { r.best = t; save(); } },
    onQuali(rows) {
      const me = rows.find((r) => r.isPlayer); const id = engine.cfg.trackId, r = rec(id);
      if (me && me.time && (!r.best || me.time < r.best)) r.best = me.time;
      if (rows[0] && rows[0].isPlayer && rows[0].time) { r.poles = (r.poles || 0) + 1; S.stats.poles++; }
      save();
    },
    onRaceDone(order) {
      const id = engine.cfg.trackId, r = rec(id), pos = order.findIndex((o) => o.isPlayer) + 1, me = order[pos - 1];
      r.races = (r.races || 0) + 1; S.stats.races++;
      if (pos === 1) { r.wins = (r.wins || 0) + 1; S.stats.wins++; }
      if (pos <= 3) { r.podiums = (r.podiums || 0) + 1; S.stats.podiums++; }
      if (me && me.best && (!r.best || me.best < r.best)) r.best = me.best;
      if (engine.cfg.mode === 'champ' && S.champ) {
        const c = S.champ, gained = {};
        order.forEach((o, i) => { const p = POINTS[i] || 0; c.pts[o.name] = (c.pts[o.name] || 0) + p; gained[o.name] = p; c.cols[o.name] = o.col; });
        c.results.push({ track: id, pos, order: order.map((o) => o.name) });
        c.lastGained = gained; c.round++;
        if (c.round >= ORDER.length) {
          const table = Object.keys(c.pts).sort((a, b) => c.pts[b] - c.pts[a]);
          c.done = true; c.champion = table[0];
          if (table[0] === S.profile.name.toUpperCase().slice(0, 3)) S.stats.titles++;
        }
      }
      save();
    },
  };
  function rec(id) { if (!S.records[id]) S.records[id] = {}; return S.records[id]; }

  const engine = new Engine(ui);
  window.__engine = engine;
  const glc = $('#gl'), hud = $('#hud');
  engine.init(glc, hud, touch);
  applyPrefs();

  function applyPrefs() {
    const st = S.settings;
    engine.prefs.quality = st.quality; engine.prefs.vol = st.vol; engine.prefs.units = st.units; engine.prefs.names = st.names; engine.prefs.map = st.map; engine.prefs.sens = st.sens;
    if (engine.audio) engine.audio.muted = st.vol <= 0.001;
    if (engine.cfg) { engine.cfg.assist = st.assist; engine.cfg.autoThr = st.autoThr; }
    engine.applyView();
  }

  // ---------- viewport, safe areas ----------
  const probe = $('#safe');
  function layout() {
    const w = window.innerWidth, h = window.innerHeight, cs = getComputedStyle(probe);
    const ins = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
    glc.style.width = w + 'px'; glc.style.height = h + 'px'; hud.style.width = w + 'px'; hud.style.height = h + 'px';
    engine.resize(w, h, window.devicePixelRatio || 1, ins);
    if (engine.garage) { engine.garage.cam.aspect = w / h; engine.garage.cam.updateProjectionMatrix(); }
    const root = document.documentElement.style;
    root.setProperty('--s', engine.view.s); root.setProperty('--il', ins.l + 'px'); root.setProperty('--ir', ins.r + 'px'); root.setProperty('--it', ins.t + 'px'); root.setProperty('--ib', ins.b + 'px');
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 250));
  layout();

  // ---------- input ----------
  window.addEventListener('keydown', (e) => {
    if (ui.screen !== 'game') { if (e.key === 'Escape' && ui.screen !== 'title' && ui.screen !== 'menu') go('menu'); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].indexOf(e.key) >= 0) e.preventDefault();
    engine.keyDown(e);
  });
  window.addEventListener('keyup', (e) => { if (ui.screen === 'game') engine.keyUp(e); });
  window.addEventListener('blur', () => { engine.keys = {}; engine.tkeys = {}; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && ui.screen === 'game' && engine.state.screen === 'race') engine.setState({ screen: 'paused' }); });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  // ---------- helpers for markup ----------
  const btn = (label, action, cls, extra) => `<button type="button" class="btn ${cls || ''}" data-a="${action}" ${extra || ''}>${label}</button>`;
  const seg = (key, opts, val, labels) => `<div class="seg">${opts.map((o, i) => `<button type="button" class="${o === val ? 'on' : ''}" data-a="set" data-k="${key}" data-v="${o}" aria-pressed="${o === val}">${labels ? labels[i] : o}</button>`).join('')}</div>`;
  const toggle = (key, val) => `<button type="button" class="tog ${val ? 'on' : ''}" data-a="tog" data-k="${key}" aria-pressed="${val}"><span></span></button>`;
  const stepper = (key, val, min, max) => `<div class="step"><button type="button" data-a="step" data-k="${key}" data-d="-1" data-min="${min}" data-max="${max}" aria-label="Decrease">−</button><span>${val}</span><button type="button" data-a="step" data-k="${key}" data-d="1" data-min="${min}" data-max="${max}" aria-label="Increase">+</button></div>`;
  const fmt = (t) => (t == null ? '-:--.---' : engine.fmt(t));
  const defs = () => engine.defs();
  const prev = (id, kind) => engine.previews()[id][kind];
  const outline = (id, kind, w, h, cls) => { const p = prev(id, kind); return `<svg class="${cls || ''}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polygon points="${p.poly}" class="ol-bg"></polygon><polygon points="${p.poly}" class="ol"></polygon><circle cx="${p.sx}" cy="${p.sy}" r="${w / 50}" class="ol-dot"></circle></svg>`; };
  const icon = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 0h11l-2 4 2 4H5"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4m-4 3h8"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M10 2h4"/></svg>',
    car: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15l2-5h14l2 5v3H3v-3zM7 18v2m10-2v2M6 13h12"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3v.5"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-8l4-4 4 4M6 12v8h12v-8"/></svg>',
  };

  // ---------- screens ----------
  const UI = $('#ui');
  function stopEngine() {
    engine.loadToken = (engine.loadToken || 0) + 1; engine.g = { phase: 'idle' }; engine.ready = false;
    engine.state.screen = 'lobby'; engine.keys = {}; engine.tkeys = {};
  }
  function go(screen) { if (screen !== 'game' && engine.state.screen && engine.state.screen !== 'lobby') stopEngine(); ui.screen = screen; if (screen !== 'game') ensureShowroom(); render(); }
  function ensureShowroom() { try { engine.buildGarage(S.profile.livery, S.profile.num, S.profile.name); } catch (e) { console.error(e); } }

  function topbar(title, action) {
    return `<header class="topbar"><button type="button" class="iconbtn" data-a="nav" data-to="menu" aria-label="Back to main menu">${icon.back}</button><h1>${title}</h1>${action || `<div class="badge"><span class="num">${esc(S.profile.num)}</span><span>${esc(S.profile.name)}</span></div>`}</header>`;
  }

  function vTitle() {
    const tip = isIOS && !standalone && !S.seenInstall;
    return `<div class="title" data-a="start">
      <div class="logo"><div class="kicker">2026 SEASON</div><div class="word">APEX</div><div class="word2">GRAND PRIX</div><div class="stripe"></div></div>
      <div class="press">${touch ? 'Tap to start' : 'Click or press any key to start'}</div>
      ${tip ? `<div class="install" data-a="noop">${icon.share}<div><b>Play full screen:</b> tap the Share button in Safari, then <b>Add to Home Screen</b>. Open Apex Grand Prix from your home screen.</div><button type="button" class="x" data-a="hideinstall" aria-label="Dismiss">✕</button></div>` : ''}
    </div>`;
  }

  function vMenu() {
    const c = S.champ, champSub = !c ? 'Six rounds. Win the title.' : c.done ? 'Season complete' : `Next: Round ${c.round + 1}, ${defs().find((d) => d.id === ORDER[c.round]).name}`;
    const items = [
      ['quick', 'Quick Race', 'Pick a circuit and race', icon.flag],
      ['champ', 'Championship', champSub, icon.trophy],
      ['tt', 'Time Trial', 'Hot laps. Beat your records.', icon.clock],
      ['garage', 'Garage', 'Livery, number and name', icon.car],
      ['records', 'Records', `${S.stats.wins} wins · ${S.stats.podiums} podiums · ${S.stats.poles} poles`, icon.chart],
      ['settings', 'Settings', 'Controls, graphics and sound', icon.gear],
    ];
    return `<div class="menu">
      <div class="brand"><div class="word">APEX</div><div class="word2">GRAND PRIX</div></div>
      <nav class="mlist">${items.map((it, i) => `<button type="button" class="mitem ${i === 0 ? 'primary' : ''}" data-a="menu" data-to="${it[0]}"><span class="mi">${it[3]}</span><span class="mt"><b>${it[1]}</b><small>${esc(it[2])}</small></span></button>`).join('')}</nav>
      <button type="button" class="help" data-a="nav" data-to="howto">${icon.help}How to play</button>
      <div class="badge corner"><span class="num">${esc(S.profile.num)}</span><span>${esc(S.profile.name)}</span></div>
    </div>`;
  }

  function vTracks() {
    const st = S.settings, tt = ui.mode === 'tt', sel = defs().find((d) => d.id === ui.trackId) || defs()[0], r = S.records[sel.id] || {};
    return `<div class="screen">${topbar(tt ? 'Time Trial' : 'Quick Race', btn(tt ? 'Start time trial' : 'Start race weekend', 'go', 'primary'))}
      <div class="split">
        <div class="cards">${defs().map((d) => { const rr = S.records[d.id] || {}; return `<button type="button" class="card ${d.id === sel.id ? 'sel' : ''}" data-a="pick" data-id="${d.id}" aria-pressed="${d.id === sel.id}">${outline(d.id, 'small', 200, 116)}<b>${esc(d.name)}</b><small>${esc(d.country)} · ${d.km.toFixed(3)} km</small><small class="rec">${rr.best ? 'Best ' + fmt(rr.best) : 'No lap yet'}</small></button>`; }).join('')}</div>
        <aside class="side">
          ${outline(sel.id, 'mid', 360, 150, 'big')}
          <h2>${esc(sel.full)}</h2><div class="sub">${esc(sel.country)} · ${sel.km.toFixed(3)} km · ${sel.turns} turns</div>
          <div class="stats"><div><small>Best lap</small><b>${fmt(r.best)}</b></div><div><small>Wins</small><b>${r.wins || 0}</b></div><div><small>Poles</small><b>${r.poles || 0}</b></div></div>
          ${tt ? '<p class="note">Drive as many laps as you like on an empty track. Every lap that beats your record is saved.</p>' : `
          <div class="row"><span>Laps</span>${stepper('laps', st.laps, 1, 20)}</div>
          <div class="row"><span>Rivals</span>${stepper('rivals', st.rivals, 1, 7)}</div>
          <div class="row"><span>Difficulty</span>${seg('diff', ['Easy', 'Medium', 'Hard'], st.diff)}</div>
          <div class="row"><span>Qualifying</span>${toggle('quali', st.quali)}</div>`}
        </aside>
      </div></div>`;
  }

  function standingsRows(c, highlightGain) {
    const names = Object.keys(c.pts).sort((a, b) => c.pts[b] - c.pts[a]), me = S.profile.name.toUpperCase().slice(0, 3);
    return names.map((n, i) => `<div class="trow ${n === me ? 'me' : ''}"><span class="p">${i + 1}</span><i style="background:${esc(c.cols[n] || '#888')}"></i><span class="n">${esc(n)}</span>${highlightGain && c.lastGained ? `<span class="g">${c.lastGained[n] ? '+' + c.lastGained[n] : ''}</span>` : ''}<span class="pts">${c.pts[n]}</span></div>`).join('');
  }
  function vChamp() {
    const c = S.champ;
    if (!c) return `<div class="screen">${topbar('Championship')}<div class="center"><div class="panel narrow">
      <h2>2026 Apex Championship</h2><p class="note">Race all six circuits in order: ${ORDER.map((id) => esc(defs().find((d) => d.id === id).name)).join(', ')}. Each weekend has qualifying and a race. Points go 25, 18, 15, 12, 10, 8, 6 and 4 down to eighth. Seven rivals, ${S.settings.laps} laps a race.</p>
      <div class="row"><span>Difficulty</span>${seg('diff', ['Easy', 'Medium', 'Hard'], S.settings.diff)}</div>
      <div class="row"><span>Race laps</span>${stepper('laps', S.settings.laps, 1, 20)}</div>
      ${btn('Start the season', 'champnew', 'primary big')}</div></div></div>`;
    const me = S.profile.name.toUpperCase().slice(0, 3);
    const act = c.done ? btn('New season', 'champreset', 'primary') : btn(`Race round ${c.round + 1}: ${esc(defs().find((d) => d.id === ORDER[c.round]).name)}`, 'champgo', 'primary');
    return `<div class="screen">${topbar('Championship', act)}
      <div class="split">
        <div class="rounds">${ORDER.map((id, i) => { const d = defs().find((x) => x.id === id), res = c.results[i]; const state = res ? `P${res.pos}` : i === c.round ? 'Next' : ''; return `<div class="round ${i === c.round && !c.done ? 'next' : ''} ${res ? 'done' : ''}">${outline(id, 'small', 200, 116)}<div><small>Round ${i + 1}</small><b>${esc(d.name)}</b></div><span class="tag">${state}</span></div>`; }).join('')}</div>
        <aside class="side">
          <h2>${c.done ? (c.champion === me ? 'You are the champion!' : esc(c.champion) + ' wins the title') : 'Standings'}</h2>
          <div class="table">${standingsRows(c)}</div>
          <div class="grow"></div>
          ${c.done ? '' : btn('Abandon season', 'champreset', 'ghost')}
        </aside>
      </div></div>`;
  }

  function vGarage() {
    const p = S.profile, livs = engine.liveryDefs();
    return `<div class="screen garage">${topbar('Garage')}
      <aside class="side right">
        <h2>Your car</h2>
        <div class="row col"><span>Livery</span><div class="swatches">${livs.map((l, i) => `<button type="button" class="sw ${i === p.livery ? 'on' : ''}" data-a="livery" data-i="${i}" aria-label="${esc(l.label)}" aria-pressed="${i === p.livery}"><svg viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="13" fill="${l.c}"></circle><rect x="5" y="15" width="24" height="4" fill="${l.c2}"></rect></svg></button>`).join('')}</div></div>
        <div class="row"><span>Car number</span>${stepper('num', p.num, 1, 99)}</div>
        <div class="row"><label for="pname">Driver code</label><input id="pname" maxlength="3" value="${esc(p.name)}" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>
        <p class="note">Three letters, like on the timing screens.</p>
      </aside></div>`;
  }

  function vRecords() {
    const st = S.stats;
    return `<div class="screen">${topbar('Records')}
      <div class="center col">
        <div class="kpis">${[['Races', st.races], ['Wins', st.wins], ['Podiums', st.podiums], ['Poles', st.poles], ['Titles', st.titles]].map((k) => `<div><small>${k[0]}</small><b>${k[1]}</b></div>`).join('')}</div>
        <div class="panel wide"><div class="thead"><span>Circuit</span><span>Best lap</span><span>Races</span><span>Wins</span><span>Podiums</span><span>Poles</span></div>
        ${defs().map((d) => { const r = S.records[d.id] || {}; return `<div class="trow5"><span>${esc(d.name)}</span><span>${fmt(r.best)}</span><span>${r.races || 0}</span><span>${r.wins || 0}</span><span>${r.podiums || 0}</span><span>${r.poles || 0}</span></div>`; }).join('')}</div>
      </div></div>`;
  }

  function settingsBody(inGame) {
    const st = S.settings;
    return `
      <h3>Driving</h3>
      <div class="row"><span>Driving assist<small>${st.assist === 'Full' ? 'The car steers and brakes itself. Arrows nudge your line.' : st.assist === 'Assisted' ? 'Steers when you let go, brakes for corners.' : 'You do everything.'}</small></span>${seg('assist', ['Full', 'Assisted', 'Off'], st.assist)}</div>
      <div class="row"><span>Auto-throttle<small>The car accelerates by itself</small></span>${toggle('autoThr', st.autoThr)}</div>
      <div class="row"><span>Steering sensitivity</span>${seg('sens', ['0.7', '1', '1.3'], String(st.sens), ['Low', 'Normal', 'High'])}</div>
      <div class="row"><span>Camera</span>${seg('camera', ['Chase', 'Far chase', 'Onboard'], st.camera, ['Chase', 'Far', 'Onboard'])}</div>
      <h3>Display and sound</h3>
      ${inGame ? '' : `<div class="row"><span>Graphics<small>${touch ? 'Medium is smoothest on iPhone' : 'Lower it if the game stutters'}</small></span>${seg('quality', ['Low', 'Medium', 'High'], st.quality)}</div>`}
      <div class="row"><span>Speed units</span>${seg('units', ['kmh', 'mph'], st.units, ['km/h', 'mph'])}</div>
      <div class="row"><span>Engine volume</span><input type="range" min="0" max="1" step="0.05" value="${st.vol}" data-k="vol" aria-label="Engine volume"></div>
      <div class="row"><span>Rival name tags</span>${toggle('names', st.names)}</div>
      <div class="row"><span>Track map</span>${toggle('map', st.map)}</div>
      ${inGame ? '' : `<h3>Progress</h3><div class="row"><span>Reset all records and the championship</span>${btn('Reset', 'reset', 'ghost danger')}</div>`}`;
  }
  function vSettings() { return `<div class="screen">${topbar('Settings')}<div class="center"><div class="panel scroll">${settingsBody(false)}</div></div></div>`; }

  function vHowto() {
    const rows = touch ? [
      ['Steer', 'The arrow buttons on the left'], ['Brake', 'BRAKE on the right'], ['Accelerate', 'GO on the right, or turn on Auto-throttle'], ['Camera', 'The Camera button'], ['Pause', 'The Pause button'], ['Skip an intro', 'Tap the screen'],
    ] : [
      ['Accelerate', '↑ or W'], ['Brake', '↓ or S'], ['Steer', '← → or A D'], ['Camera', 'C'], ['Pause', 'P or Esc'], ['Mute', 'M'], ['Skip an intro', 'Any key'],
    ];
    return `<div class="screen">${topbar('How to play')}<div class="center"><div class="panel narrow">
      <h2>Controls</h2>${rows.map((r) => `<div class="row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}
      <h2>Race weekend</h2><p class="note">Qualifying is one flying lap; your time sets your grid slot. The race starts when the five red lights go out. The top three finish on the podium. With Full assist the car finds the racing line and brakes for every corner, so you can simply enjoy the speed.</p>
    </div></div></div>`;
  }

  // in-game overlays (on top of the 3D view)
  function vGame() {
    const es = engine.state.screen, sess = engine.session, def = engine.def || defs()[0];
    if (es === 'loading') return `<div class="loading">
      <div class="kicker">LOADING CIRCUIT</div>
      <svg viewBox="0 0 400 230" class="lo" aria-hidden="true"><polygon points="${prev(def.id, 'big').poly}" class="ol-bg"></polygon><polygon id="lo-line" points="${prev(def.id, 'big').poly}" class="ol" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"></polygon></svg>
      <h2>${esc(def.full)}</h2><div class="sub">${esc(def.country)} · ${def.km.toFixed(3)} km${engine.cfg && engine.cfg.mode === 'champ' ? ' · Round ' + (S.champ.round + 1) + ' of 6' : ''}</div>
      <div class="bar"><i id="lo-bar"></i></div><div class="msg" id="lo-msg">${esc(engine.state.msg || '')}</div>
      <div class="tip">${esc(engine.tips()[engine.state.tip || 0] || '')}</div></div>`;
    let out = '';
    if (es === 'race') {
      out += `<div class="ingame">
        <button type="button" class="hudbtn pause" data-a="pause" aria-label="Pause"><svg viewBox="0 0 12 14" aria-hidden="true"><rect x="0" y="0" width="4" height="14"></rect><rect x="8" y="0" width="4" height="14"></rect></svg><span>Pause</span></button>
        <button type="button" class="hudbtn cam" data-a="cam">Camera</button>
        ${touch ? `<div class="pad">
          <button type="button" class="tb steer l" data-t="ArrowLeft" aria-label="Steer left"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4L7 12l8 8"/></svg></button>
          <button type="button" class="tb steer r" data-t="ArrowRight" aria-label="Steer right"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4l8 8-8 8"/></svg></button>
          <button type="button" class="tb brake" data-t="ArrowDown">BRAKE</button>
          ${S.settings.autoThr ? '' : '<button type="button" class="tb gas" data-t="ArrowUp">GO</button>'}
        </div>` : ''}
      </div>`;
    }
    if (es === 'paused') out += `<div class="dim"><div class="panel pausep scroll">
      <h2>Paused</h2>
      <div class="pbtns">${btn('Resume', 'resume', 'primary')}${btn(sess === 'quali' ? 'Restart qualifying' : sess === 'tt' ? 'Restart time trial' : 'Restart race', 'restart')}${sess === 'quali' ? btn('Skip qualifying (start last)', 'skipq') : ''}${btn('Quit to menu', 'quit', 'ghost')}</div>
      ${settingsBody(true)}</div></div>`;
    if (es === 'qualiResults') {
      const q = engine.state.qres || [];
      out += `<div class="dim"><div class="panel narrow"><div class="phead"><h2>Qualifying</h2><span class="sub">${esc(def.full)}</span></div><div class="redline"></div>
        <div class="table">${q.map((r) => `<div class="trow ${r.mine ? 'me' : ''}"><span class="p">${r.pos}</span><i style="background:${esc(r.col)}"></i><span class="n">${esc(r.name)}</span><span class="t">${r.time}</span><span class="gap">${r.gap}</span></div>`).join('')}</div>
        <div class="pbtns h">${btn('Start the race', 'torace', 'primary')}${btn('Quit to menu', 'quit', 'ghost')}</div></div></div>`;
    }
    if (es === 'finished') out += `<div class="endbtns">${btn('Podium ceremony', 'podium', 'primary')}${engine.cfg.mode === 'champ' ? '' : btn('Race again', 'again')}${btn('Menu', 'quit', 'ghost')}</div>`;
    if (es === 'podium') {
      const pod = engine.state.pod || [];
      out += `<div class="podtitle"><div class="kicker">${esc(def.full)}</div><div class="big">Podium</div></div>
        <div class="podcards">${pod.map((d) => `<div class="pc ${d.big ? 'p1' : ''}"><div><b>${d.pos}</b><i style="background:${esc(d.col)}"></i><span>${esc(d.name)}</span></div><small>${esc(d.time)}</small></div>`).join('')}</div>
        <div class="endbtns">${engine.cfg.mode === 'champ' ? btn('Championship standings', 'standings', 'primary') : btn('Race again', 'again', 'primary')}${btn('Menu', 'quit', 'ghost')}</div>`;
    }
    return out;
  }
  function vStandings() {
    const c = S.champ, me = S.profile.name.toUpperCase().slice(0, 3), last = c.results[c.results.length - 1];
    const act = c.done ? btn('Back to menu', 'nav', 'primary', 'data-to="menu"') : btn('Next round: ' + esc(defs().find((d) => d.id === ORDER[c.round]).name), 'champgo', 'primary');
    return `<div class="screen">${topbar('Championship', act)}<div class="center"><div class="panel narrow">
      <div class="phead"><h2>${c.done ? (c.champion === me ? 'World champion!' : 'Season complete') : 'Standings after round ' + c.round}</h2><span class="sub">You finished P${last ? last.pos : '-'}</span></div><div class="redline"></div>
      <div class="table">${standingsRows(c, true)}</div>
    </div></div></div>`;
  }

  function render() {
    let html = '';
    switch (ui.screen) {
      case 'title': html = vTitle(); break;
      case 'menu': html = vMenu(); break;
      case 'tracks': html = vTracks(); break;
      case 'champ': html = vChamp(); break;
      case 'garage': html = vGarage(); break;
      case 'records': html = vRecords(); break;
      case 'settings': html = vSettings(); break;
      case 'howto': html = vHowto(); break;
      case 'standings': html = vStandings(); break;
      case 'game': html = vGame(); break;
    }
    UI.innerHTML = html;
    UI.className = 'ui s-' + ui.screen + (ui.screen === 'game' ? ' e-' + engine.state.screen : '');
    hud.style.visibility = ui.screen === 'game' ? 'visible' : 'hidden';
    if (ui.screen === 'game' && engine.state.screen === 'loading') updateLoading();
    const nm = $('#pname');
    if (nm) nm.addEventListener('input', () => { const v = nm.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3); nm.value = v; if (v.length) { S.profile.name = v; save(); ensureShowroom(); } });
    UI.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => { S.settings[r.dataset.k] = parseFloat(r.value); save(); applyPrefs(); }));
    bindTouch();
  }
  function updateLoading() {
    const b = $('#lo-bar'), l = $('#lo-line'), m = $('#lo-msg'), p = engine.state.prog || 0;
    if (b) b.style.width = Math.round(p * 100) + '%';
    if (l) l.setAttribute('stroke-dashoffset', String(Math.round(100 - 100 * p)));
    if (m) m.textContent = engine.state.msg || '';
  }

  // touch pedals: pointer events per button, multi-touch safe
  function bindTouch() {
    UI.querySelectorAll('[data-t]').forEach((b) => {
      const k = b.dataset.t;
      const down = (e) => { e.preventDefault(); engine.tkeys = engine.tkeys || {}; engine.tkeys[k] = true; b.classList.add('down'); if (engine.g && engine.g.phase === 'intro') engine.g.it = engine.g.introLen; };
      const up = (e) => { if (e) e.preventDefault(); if (engine.tkeys) engine.tkeys[k] = false; b.classList.remove('down'); };
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }
  // tapping the 3D view skips intros
  $('#tapzone').addEventListener('pointerdown', () => { if (ui.screen === 'game' && engine.g && engine.g.phase === 'intro') engine.g.it = engine.g.introLen; });

  // in-game confirm dialog (browser pop-ups are blocked inside Claude)
  function ask(text, yesLabel, onYes) {
    const d = document.createElement('div'); d.className = 'modal';
    d.innerHTML = `<div class="panel narrow" role="dialog" aria-modal="true"><h2>Are you sure?</h2><p class="note">${esc(text)}</p><div class="pbtns h"><button type="button" class="btn danger" data-m="yes">${esc(yesLabel)}</button><button type="button" class="btn primary" data-m="no">Cancel</button></div></div>`;
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b && e.target !== d) return; d.remove(); if (b && b.dataset.m === 'yes') onYes(); });
    document.body.appendChild(d);
  }
  // ---------- actions ----------
  function startWeekend(trackId, mode) {
    const st = S.settings, p = S.profile;
    ui.trackId = trackId; S.settings.lastTrack = trackId; save();
    const champ = mode === 'champ';
    Object.assign(engine.state, {
      laps: st.laps, rivals: champ ? 7 : st.rivals, diff: st.diff, assist: st.assist, camera: st.camera, livery: p.livery, quali: champ ? true : st.quali, autoThr: st.autoThr,
      mode, pname: p.name, pnum: p.num,
    });
    applyPrefs();
    ui.screen = 'game'; ui.lastEngineScreen = null;
    engine.beginLoad(trackId);
    render();
  }
  function quitToMenu() { stopEngine(); go('menu'); }

  UI.addEventListener('click', (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const a = t.dataset.a, st = S.settings;
    switch (a) {
      case 'start':
        if (e.target.closest('.install')) return;
        try { if (!isIOS && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => { }); } catch (err) { }
        engine.ensureAudio(); go('menu'); break;
      case 'hideinstall': e.stopPropagation(); S.seenInstall = true; save(); render(); break;
      case 'nav': go(t.dataset.to); break;
      case 'menu': {
        const to = t.dataset.to;
        if (to === 'quick' || to === 'tt') { ui.mode = to; go('tracks'); } else go(to);
        break;
      }
      case 'pick': ui.trackId = t.dataset.id; render(); break;
      case 'go': startWeekend(ui.trackId, ui.mode); break;
      case 'set': {
        const k = t.dataset.k; let v = t.dataset.v; if (k === 'sens') v = parseFloat(v);
        st[k] = v; save(); applyPrefs();
        if (k === 'camera' && engine.cfg) { engine.cfg.camera = v; engine.snapCamera(); }
        if (k === 'quality') { engine.garage = null; ensureShowroom(); }
        render(); break;
      }
      case 'tog': { const k = t.dataset.k; st[k] = !st[k]; save(); applyPrefs(); render(); break; }
      case 'step': {
        const k = t.dataset.k, d = +t.dataset.d, mn = +t.dataset.min, mx = +t.dataset.max;
        if (k === 'num') { S.profile.num = Math.max(mn, Math.min(mx, S.profile.num + d)); ensureShowroom(); } else st[k] = Math.max(mn, Math.min(mx, st[k] + d));
        save(); render(); break;
      }
      case 'livery': S.profile.livery = +t.dataset.i; save(); ensureShowroom(); render(); break;
      case 'reset': ask('This deletes all your lap records, stats and your championship season. It cannot be undone.', 'Reset everything', () => { S.records = {}; S.champ = null; S.stats = defaults().stats; save(); render(); }); break;
      case 'champnew': {
        // everyone starts the season on zero points
        const p = S.profile, prevCfg = engine.cfg;
        engine.cfg = { rivals: 7, livery: p.livery, diff: S.settings.diff, pname: p.name, pnum: p.num };
        engine.makeRoster(); const ros = engine.roster; engine.cfg = prevCfg;
        const pts = {}, cols = {}; ros.forEach((r) => { pts[r.name] = 0; cols[r.name] = r.col; });
        S.champ = { round: 0, pts, cols, results: [], done: false }; save(); render(); break;
      }
      case 'champreset': if (S.champ && S.champ.done) { S.champ = null; save(); render(); } else ask('Your current season and its points will be lost.', 'Abandon season', () => { S.champ = null; save(); render(); }); break;
      case 'champgo': startWeekend(ORDER[S.champ.round], 'champ'); break;
      case 'pause': engine.keys = {}; engine.tkeys = {}; engine.setState({ screen: 'paused' }); break;
      case 'cam': { const m = engine.cameraModes(); engine.cfg.camera = m[(m.indexOf(engine.cfg.camera) + 1) % m.length]; engine.snapCamera(); break; }
      case 'resume': engine.setState({ screen: 'race' }); break;
      case 'restart': if (engine.session === 'quali') engine.startQuali(); else if (engine.session === 'tt') engine.startTT(); else engine.startRace(); break;
      case 'skipq': engine.finishQuali(null); break;
      case 'torace': engine.startRace(); break;
      case 'podium': engine.startPodium(); break;
      case 'again': engine.startRace(); break;
      case 'standings': go('standings'); break;
      case 'quit': quitToMenu(); break;
    }
  });

  // start on the title screen with the showroom car turning behind it
  ensureShowroom();
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !/claude|claudeusercontent/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
})();
