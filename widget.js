// Floating mini timer for coding practice sites. Reads timer state straight from storage and
// sends commands to the background worker, so it stays in sync with the popup and badge.
(() => {
  if (window.__bloomWidget) return;
  window.__bloomWidget = true;

  const DEFAULTS = { focusMin: 25, breakMin: 5, musicOn: false, widgetOn: true };
  const durationFor = (phase, s) => (phase === 'focus' ? s.focusMin : s.breakMin) * 60000;
  const pad = (n) => String(n).padStart(2, '0');
  const fmtClock = (ms) => {
    const s = Math.ceil(ms / 1000);
    return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  };

  let settings = DEFAULTS;
  let timer = null;
  let minimized = false;
  let pos = null;
  let completing = false;
  let ticker = null;

  const alive = () => Boolean(chrome.runtime?.id);
  const send = (type, extra = {}) => {
    if (!alive()) return Promise.resolve();
    return chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});
  };

  const host = document.createElement('div');
  host.id = 'bloom-focus-widget';
  host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;';
  const root = host.attachShadow({ mode: 'closed' });

  const icon = {
    play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7V5Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
    reset: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    skip: '<svg viewBox="0 0 24 24"><path d="M5 5l10 7-10 7V5Z"/><path d="M19 5v14"/></svg>',
    music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
    min: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
    popout: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><rect x="12" y="11" width="6" height="5" rx="1"/></svg>',
  };

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .w {
        --accent: #f28aa5; --soft: #fde3ea; --g1: #f7a8b8; --g2: #c9b6e4;
        --bg: rgba(255, 250, 247, 0.94); --ink: #5b4a5e; --muted: #a898a8; --line: #f3e6ea;
        font: 600 12px/1.3 'Nunito', ui-rounded, 'SF Pro Rounded', system-ui, sans-serif;
        color: var(--ink); background: var(--bg); backdrop-filter: blur(10px);
        border: 1px solid var(--line); border-radius: 20px; padding: 10px 12px;
        box-shadow: 0 10px 30px rgba(180, 120, 150, 0.25);
        display: flex; align-items: center; gap: 10px; cursor: grab; user-select: none;
        transition: border-radius .25s, padding .25s;
      }
      .w.break { --accent: #5fbf9f; --soft: #daf3ea; --g1: #a8ddc9; --g2: #a9cdf0; box-shadow: 0 10px 30px rgba(100, 170, 150, 0.25); }
      @media (prefers-color-scheme: dark) {
        .w { --bg: rgba(42, 35, 48, 0.94); --ink: #f3e8f0; --muted: #a797ab; --line: #463b4e; --soft: #4a3a4d; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
        .w.break { --soft: #33483f; }
      }
      .w.dragging { cursor: grabbing; }
      .ring { position: relative; width: 44px; height: 44px; flex-shrink: 0; }
      .ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
      .ring circle { fill: none; stroke-width: 5; }
      .track { stroke: var(--line); }
      .prog { stroke: url(#bg); stroke-linecap: round; transition: stroke-dashoffset .3s linear; }
      .dot { position: absolute; inset: 0; display: grid; place-items: center; font-size: 15px; }
      .info { display: flex; flex-direction: column; min-width: 64px; }
      .time { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: .5px; }
      .phase { font-size: 10px; text-transform: uppercase; letter-spacing: 1.1px; color: var(--muted); font-weight: 800; }
      .btns { display: flex; gap: 4px; }
      button {
        all: unset; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%;
        color: var(--muted); cursor: pointer; transition: background .2s, color .2s;
      }
      button:hover { background: var(--soft); color: var(--accent); }
      button.main { background: linear-gradient(135deg, var(--g1), var(--accent)); color: #fff; width: 32px; height: 32px; }
      button.main:hover { filter: brightness(1.05); color: #fff; }
      button.on { color: var(--accent); background: var(--soft); }
      svg.i, button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      button.main svg { fill: currentColor; stroke: currentColor; }
      .w.min { padding: 6px 12px 6px 6px; border-radius: 999px; gap: 8px; }
      .w.min .ring { width: 30px; height: 30px; }
      .w.min .dot { font-size: 11px; }
      .w.min .phase, .w.min .btns { display: none; }
      .w.min .time { font-size: 14px; }
      .w.min .info { min-width: 0; }
      .w.running .dot { animation: pulse 2.4s ease-in-out infinite; }
      @keyframes pulse { 50% { transform: scale(1.15); } }
    </style>
    <div class="w" part="widget">
      <div class="ring" title="Click to expand/collapse">
        <svg viewBox="0 0 50 50">
          <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" class="s1"/><stop offset="100%" class="s2"/></linearGradient></defs>
          <circle cx="25" cy="25" r="21" class="track"/><circle cx="25" cy="25" r="21" class="prog"/>
        </svg>
        <div class="dot">🌷</div>
      </div>
      <div class="info"><span class="phase">focus</span><span class="time">25:00</span></div>
      <div class="btns">
        <button class="main" data-act="toggle" title="Start / pause">${icon.play}</button>
        <button data-act="reset" title="Reset">${icon.reset}</button>
        <button data-act="skip" title="Skip">${icon.skip}</button>
        <button data-act="music" title="Calm music">${icon.music}</button>
        <button data-act="popout" title="Open mini timer you can keep on top">${icon.popout}</button>
        <button data-act="min" title="Minimize">${icon.min}</button>
      </div>
    </div>`;

  const w = root.querySelector('.w');
  const prog = root.querySelector('.prog');
  const RING = 2 * Math.PI * 21;
  prog.style.strokeDasharray = RING;
  const gradStops = root.querySelectorAll('stop');

  function remaining() {
    return timer.running ? Math.max(0, timer.endTime - Date.now()) : timer.remainingMs;
  }

  function place() {
    const r = w.getBoundingClientRect();
    const x = pos ? pos.x : window.innerWidth - r.width - 20;
    const y = pos ? pos.y : window.innerHeight - r.height - 20;
    host.style.left = `${Math.min(Math.max(4, x), window.innerWidth - r.width - 4)}px`;
    host.style.top = `${Math.min(Math.max(4, y), window.innerHeight - r.height - 4)}px`;
  }

  function render() {
    if (!timer) return;
    const isBreak = timer.phase === 'break';
    const total = durationFor(timer.phase, settings);
    const rem = remaining();
    w.classList.toggle('break', isBreak);
    w.classList.toggle('min', minimized);
    w.classList.toggle('running', timer.running);
    gradStops[0].setAttribute('stop-color', isBreak ? '#a8ddc9' : '#f7a8b8');
    gradStops[1].setAttribute('stop-color', isBreak ? '#a9cdf0' : '#c9b6e4');
    root.querySelector('.dot').textContent = isBreak ? '☕' : '🌷';
    root.querySelector('.phase').textContent = timer.running ? timer.phase : rem < total ? 'paused' : timer.phase;
    root.querySelector('.time').textContent = fmtClock(rem);
    prog.style.strokeDashoffset = RING * (1 - Math.min(1, rem / total));
    const main = root.querySelector('[data-act="toggle"]');
    const state = timer.running ? 'pause' : 'play';
    if (main.dataset.icon !== state) {
      main.innerHTML = icon[state];
      main.dataset.icon = state;
    }
    root.querySelector('[data-act="music"]').classList.toggle('on', settings.musicOn);
    if (timer.running && rem === 0 && !completing) {
      completing = true;
      send('tick').finally(() => (completing = false));
    }
  }

  function mount() {
    if (!document.documentElement.contains(host)) document.documentElement.appendChild(host);
    render();
    place();
    ticker ??= setInterval(() => {
      if (!alive()) return teardown();
      render();
    }, 250);
  }

  function teardown() {
    host.remove();
    clearInterval(ticker);
    ticker = null;
  }

  async function sync() {
    if (!alive()) return teardown();
    const data = await chrome.storage.local.get(['settings', 'timer', 'widgetPos', 'widgetMin']);
    settings = { ...DEFAULTS, ...data.settings };
    timer = data.timer ?? { phase: 'focus', running: false, remainingMs: durationFor('focus', settings) };
    pos = data.widgetPos ?? null;
    minimized = Boolean(data.widgetMin);
    settings.widgetOn ? mount() : teardown();
  }

  // ---- interactions ----
  root.querySelector('.btns').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    if (act === 'toggle') send(timer.running ? 'pause' : 'start');
    else if (act === 'reset') send('reset');
    else if (act === 'skip') send('skip');
    else if (act === 'music') send('setMusic', { on: !settings.musicOn });
    else if (act === 'popout') send('openMini');
    else if (act === 'min') chrome.storage.local.set({ widgetMin: true });
  });

  let drag = null;
  w.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = host.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
    w.setPointerCapture(e.pointerId);
  });
  w.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
    if (!drag.moved) return;
    w.classList.add('dragging');
    pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy };
    place();
  });
  w.addEventListener('pointerup', (e) => {
    if (!drag) return;
    w.classList.remove('dragging');
    if (drag.moved) chrome.storage.local.set({ widgetPos: pos });
    else if (e.target.closest('.ring') || minimized) chrome.storage.local.set({ widgetMin: !minimized });
    drag = null;
  });

  window.addEventListener('resize', () => host.isConnected && place());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const wasMin = minimized;
    sync().then(() => wasMin !== minimized && requestAnimationFrame(place));
  });

  sync();
})();
