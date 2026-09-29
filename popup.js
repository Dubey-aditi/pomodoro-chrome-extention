import { dateKey, durationFor } from './shared.js';

const $ = (s) => document.querySelector(s);
const RING = 2 * Math.PI * 88;
let st = null;
let completing = false;

const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

async function act(type, extra) {
  const next = await send(type, extra);
  if (next && !next.error) st = next;
  completing = false;
  render();
}

const pad = (n) => String(n).padStart(2, '0');
function fmtClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

const remaining = () => (st.timer.running ? Math.max(0, st.timer.endTime - Date.now()) : st.timer.remainingMs);

// Includes the focus time ticking in the current segment so "today" updates live.
function todayMs() {
  const base = st.stats[dateKey()]?.ms ?? 0;
  const t = st.timer;
  if (t.running && t.phase === 'focus') return base + Math.max(0, Math.min(Date.now(), t.endTime) - t.segmentStart);
  return base;
}

function labelFor(t, total) {
  if (t.running) return t.phase === 'focus' ? 'stay cozy & focused ✿' : 'breathe, stretch, sip water ☁';
  if (t.remainingMs < total) return 'paused, take your time';
  return t.phase === 'focus' ? 'ready when you are' : 'you earned a little rest';
}

function renderWeek() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    days.push({ key, label: 'SMTWTFS'[d.getDay()], ms: key === dateKey() ? todayMs() : st.stats[key]?.ms ?? 0 });
  }
  const max = Math.max(60 * 60000, ...days.map((d) => d.ms));
  $('#week').innerHTML = days
    .map((d, i) => {
      const h = Math.max(4, Math.round((d.ms / max) * 44));
      return `<div class="day${i === 6 ? ' today' : ''}" title="${fmtDur(d.ms)}">
        <div class="bar${d.ms > 0 ? ' filled' : ''}" style="height:${h}px"></div><span>${d.label}</span></div>`;
    })
    .join('');
}

function render() {
  if (!st) return;
  const { timer, settings } = st;
  const total = durationFor(timer.phase, settings);
  const rem = remaining();

  document.body.dataset.phase = timer.phase;
  document.body.classList.toggle('running', timer.running);
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.phase === timer.phase));

  $('#time').textContent = fmtClock(rem);
  $('#label').textContent = labelFor(timer, total);
  $('#progress').style.strokeDashoffset = RING * (1 - Math.min(1, rem / total));
  $('#toggle').textContent = timer.running ? 'pause' : rem < total ? 'resume' : 'start';

  $('#focusMin').textContent = settings.focusMin;
  $('#breakMin').textContent = settings.breakMin;
  $('#autoStart').checked = settings.autoStart;
  $('#widgetOn').checked = settings.widgetOn;
  $('#musicOn').checked = settings.musicOn;
  $('#eq').classList.toggle('on', settings.musicOn);
  $('#volumeRow').hidden = !settings.musicOn;
  if (document.activeElement !== $('#volume')) $('#volume').value = settings.volume;

  $('#today').textContent = fmtDur(todayMs());
  const sessions = st.stats[dateKey()]?.sessions ?? 0;
  $('#sessions').textContent = `${sessions} session${sessions === 1 ? '' : 's'} 🍑`;
  renderWeek();

  // The alarm can lag by up to ~30s; nudge the background as soon as we see the timer hit zero.
  if (timer.running && rem === 0 && !completing) {
    completing = true;
    act('tick');
  }
}

$('#progress').style.strokeDasharray = RING;

$('#toggle').addEventListener('click', () => act(st.timer.running ? 'pause' : 'start'));
$('#reset').addEventListener('click', () => act('reset'));
$('#skip').addEventListener('click', () => act('skip'));
$('#popout').addEventListener('click', () => send('openMini').then(() => window.close()));
$('#gear').addEventListener('click', () => ($('#settings').hidden = !$('#settings').hidden));
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => act('setPhase', { phase: b.dataset.phase })));

document.querySelectorAll('.stepper').forEach((el) => {
  el.addEventListener('click', (e) => {
    const d = Number(e.target.dataset?.d);
    if (!d) return;
    const { key, step, min, max } = el.dataset;
    const value = Math.min(Number(max), Math.max(Number(min), st.settings[key] + d * Number(step)));
    act('updateSettings', { patch: { [key]: value } });
  });
});

$('#autoStart').addEventListener('change', (e) => act('updateSettings', { patch: { autoStart: e.target.checked } }));
$('#widgetOn').addEventListener('change', (e) => act('updateSettings', { patch: { widgetOn: e.target.checked } }));
$('#musicOn').addEventListener('change', (e) => act('setMusic', { on: e.target.checked }));
$('#volume').addEventListener('input', (e) => {
  st.settings.volume = Number(e.target.value);
  send('setVolume', { volume: st.settings.volume });
});

chrome.storage.onChanged.addListener(async () => {
  const next = await send('getState');
  if (next && !next.error) st = next;
  render();
});

act('getState');
setInterval(render, 250);
