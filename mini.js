import { DEFAULTS, dateKey, durationFor } from './shared.js';

// Element references are kept (rather than document queries) because the whole .mini block
// gets moved into a Picture-in-Picture window when pinned on top.
const mini = document.getElementById('mini');
const $ = (s) => mini.querySelector(s);
const prog = $('.prog');
const RING = 2 * Math.PI * 21;
prog.style.strokeDasharray = RING;

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7V5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" style="fill:none"/></svg>',
};

let settings = DEFAULTS;
let timer = null;
let stats = {};
let completing = false;
let pip = null;

const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });
const pad = (n) => String(n).padStart(2, '0');
const fmtClock = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const fmtDur = (ms) => {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

function render() {
  if (!timer) return;
  const total = durationFor(timer.phase, settings);
  const rem = timer.running ? Math.max(0, timer.endTime - Date.now()) : timer.remainingMs;
  const paused = !timer.running && rem < total;

  mini.dataset.phase = timer.phase;
  mini.classList.toggle('running', timer.running);
  $('.dot').textContent = timer.phase === 'break' ? '☕' : '🌷';
  $('.phase').textContent = paused ? 'paused' : timer.phase;
  $('.time').textContent = fmtClock(rem);
  prog.style.strokeDashoffset = RING * (1 - Math.min(1, rem / total));

  let today = stats[dateKey()]?.ms ?? 0;
  if (timer.running && timer.phase === 'focus') today += Math.max(0, Math.min(Date.now(), timer.endTime) - timer.segmentStart);
  $('.today').textContent = `today ${fmtDur(today)}`;

  const main = $('[data-act="toggle"]');
  const state = timer.running ? 'pause' : 'play';
  if (main.dataset.icon !== state) {
    main.innerHTML = ICONS[state];
    main.dataset.icon = state;
  }
  $('[data-act="music"]').classList.toggle('on', settings.musicOn);
  $('[data-act="pin"]').classList.toggle('on', Boolean(pip));

  const title = `${fmtClock(rem)} · ${paused ? 'paused' : timer.phase}`;
  document.title = title;
  if (pip) pip.document.title = title;

  if (timer.running && rem === 0 && !completing) {
    completing = true;
    send('tick').finally(() => (completing = false));
  }
}

async function sync() {
  const data = await chrome.storage.local.get(['settings', 'timer', 'stats']);
  settings = { ...DEFAULTS, ...data.settings };
  timer = data.timer ?? { phase: 'focus', running: false, remainingMs: durationFor('focus', settings) };
  stats = data.stats ?? {};
  render();
}

async function pinOnTop() {
  if (pip) return pip.close();
  if (!window.documentPictureInPicture) {
    document.getElementById('note').textContent = 'Keep-on-top needs Chrome 116 or newer.';
    document.getElementById('note').hidden = false;
    return;
  }
  pip = await documentPictureInPicture.requestWindow({ width: 290, height: 110 });
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    pip.document.head.appendChild(link.cloneNode());
  }
  pip.document.body.appendChild(mini);
  document.getElementById('note').hidden = false;
  render();
  pip.addEventListener('pagehide', () => {
    document.body.prepend(mini);
    document.getElementById('note').hidden = true;
    pip = null;
    render();
  });
}

mini.querySelector('.btns').addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'toggle') send(timer.running ? 'pause' : 'start');
  else if (act === 'reset') send('reset');
  else if (act === 'skip') send('skip');
  else if (act === 'music') send('setMusic', { on: !settings.musicOn });
  else if (act === 'pin') pinOnTop();
});

chrome.storage.onChanged.addListener((_changes, area) => area === 'local' && sync());
sync();
setInterval(render, 250);
