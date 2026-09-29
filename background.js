import { DEFAULTS, dateKey, durationFor } from './shared.js';

// Every state change goes through this queue so overlapping messages/alarms can't clobber each other.
let queue = Promise.resolve();
const serial = (fn) => {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
};

const idle = (phase, settings) => ({
  phase,
  running: false,
  endTime: null,
  segmentStart: null,
  remainingMs: durationFor(phase, settings),
});

const run = (timer, now) => ({ ...timer, running: true, endTime: now + timer.remainingMs, segmentStart: now });

async function load() {
  const { settings, timer, stats } = await chrome.storage.local.get(['settings', 'timer', 'stats']);
  const s = { ...DEFAULTS, ...settings };
  return { settings: s, timer: timer ?? idle('focus', s), stats: stats ?? {} };
}

async function commit(st) {
  await chrome.storage.local.set({ settings: st.settings, timer: st.timer, stats: st.stats });
  await chrome.alarms.clear('phaseEnd');
  await chrome.alarms.clear('badge');
  if (st.timer.running) {
    chrome.alarms.create('phaseEnd', { when: st.timer.endTime });
    chrome.alarms.create('badge', { periodInMinutes: 0.5 });
  }
  updateBadge(st.timer, st.settings);
  return st;
}

// Adds the focus time elapsed in the current running segment to today's total.
function creditFocus(st, now, completed = false) {
  const { timer, stats } = st;
  if (timer.phase !== 'focus' || !timer.running) return;
  const ms = Math.max(0, Math.min(now, timer.endTime) - timer.segmentStart);
  const key = dateKey(new Date(now));
  const day = stats[key] ?? { ms: 0, sessions: 0 };
  stats[key] = { ms: day.ms + ms, sessions: day.sessions + (completed ? 1 : 0) };
  const cutoff = dateKey(new Date(now - 60 * 86400000));
  for (const k of Object.keys(stats)) if (k < cutoff) delete stats[k];
}

function nextTimer(st, now) {
  const t = idle(st.timer.phase === 'focus' ? 'break' : 'focus', st.settings);
  return st.settings.autoStart ? run(t, now) : t;
}

async function complete(st, now) {
  const finished = st.timer.phase;
  creditFocus(st, now, true);
  st.timer = nextTimer(st, now);
  await commit(st);
  notify(finished, st.settings);
  chime(finished, st.settings);
  return st;
}

async function checkComplete() {
  const st = await load();
  const now = Date.now();
  if (st.timer.running && now >= st.timer.endTime - 500) return complete(st, now);
  updateBadge(st.timer, st.settings);
  return st;
}

function updateBadge(timer, settings) {
  let text = '';
  if (timer.running) text = `${Math.max(1, Math.ceil((timer.endTime - Date.now()) / 60000))}m`;
  else if (timer.remainingMs < durationFor(timer.phase, settings)) text = `${Math.ceil(timer.remainingMs / 60000)}m`;
  const color = !timer.running ? '#BDB2CF' : timer.phase === 'focus' ? '#F28AA5' : '#6FC3A5';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' });
}

function notify(finished, settings) {
  const focusDone = finished === 'focus';
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: focusDone ? 'Focus session complete 🌸' : "Break's over ☁️",
    message: focusDone
      ? `Lovely work! Enjoy a ${settings.breakMin} min break.`
      : `Ready for another ${settings.focusMin} min of focus?`,
    priority: 1,
  });
}

// ---------- offscreen audio ----------

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

let creating = null;
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Plays calm background music and gentle chimes between sessions.',
    })
    .finally(() => (creating = null));
  await creating;
}

const toOffscreen = (msg) => chrome.runtime.sendMessage({ target: 'offscreen', ...msg }).catch(() => {});

function closeOffscreenLater(ms) {
  setTimeout(async () => {
    const { settings } = await load();
    if (!settings.musicOn && (await hasOffscreen())) chrome.offscreen.closeDocument().catch(() => {});
  }, ms);
}

async function chime(kind, settings) {
  await ensureOffscreen();
  await toOffscreen({ cmd: 'chime', kind });
  if (!settings.musicOn) closeOffscreenLater(5000);
}

async function applyMusic(settings) {
  if (settings.musicOn) {
    await ensureOffscreen();
    await toOffscreen({ cmd: 'music', on: true, volume: settings.volume });
  } else if (await hasOffscreen()) {
    await toOffscreen({ cmd: 'music', on: false });
    closeOffscreenLater(3000);
  }
}

// ---------- message handlers ----------

const handlers = {
  getState: load,

  async start() {
    const st = await load();
    if (st.timer.running) return st;
    st.timer = run(st.timer, Date.now());
    return commit(st);
  },

  async pause() {
    const st = await load();
    const now = Date.now();
    if (!st.timer.running) return st;
    if (now >= st.timer.endTime) return complete(st, now);
    creditFocus(st, now);
    st.timer = { ...st.timer, running: false, endTime: null, segmentStart: null, remainingMs: st.timer.endTime - now };
    return commit(st);
  },

  async reset() {
    const st = await load();
    creditFocus(st, Date.now());
    st.timer = idle(st.timer.phase, st.settings);
    return commit(st);
  },

  async skip() {
    const st = await load();
    const now = Date.now();
    creditFocus(st, now);
    st.timer = nextTimer(st, now);
    return commit(st);
  },

  async setPhase({ phase }) {
    const st = await load();
    if (st.timer.phase === phase) return st;
    creditFocus(st, Date.now());
    st.timer = idle(phase, st.settings);
    return commit(st);
  },

  tick: checkComplete,

  async updateSettings({ patch }) {
    const st = await load();
    st.settings = { ...st.settings, ...patch };
    const { phase, running } = st.timer;
    const touchesCurrent = (phase === 'focus' && 'focusMin' in patch) || (phase === 'break' && 'breakMin' in patch);
    if (!running && touchesCurrent) st.timer = idle(phase, st.settings);
    return commit(st);
  },

  async setMusic({ on }) {
    const st = await load();
    st.settings.musicOn = on;
    await chrome.storage.local.set({ settings: st.settings });
    await applyMusic(st.settings);
    return st;
  },

  async setVolume({ volume }) {
    const st = await load();
    st.settings.volume = volume;
    await chrome.storage.local.set({ settings: st.settings });
    if (st.settings.musicOn) await toOffscreen({ cmd: 'volume', volume });
    return st;
  },

  async openMini() {
    const url = chrome.runtime.getURL('mini.html');
    const [existing] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
    if (existing) {
      await chrome.windows.update(existing.windowId, { focused: true, state: 'normal' });
    } else {
      await chrome.windows.create({ url, type: 'popup', width: 320, height: 150, focused: true });
    }
    return load();
  },

  async offscreenReady() {
    const { settings } = await load();
    return { on: settings.musicOn, volume: settings.volume };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg?.target !== 'offscreen' && handlers[msg?.type];
  if (!handler) return;
  serial(() => handler(msg)).then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'phaseEnd' || alarm.name === 'badge') serial(checkComplete);
});

chrome.runtime.onStartup.addListener(() =>
  serial(async () => {
    // Don't surprise anyone with music right as the browser opens.
    const st = await load();
    st.settings.musicOn = false;
    await chrome.storage.local.set({ settings: st.settings });
    return checkComplete();
  })
);

chrome.runtime.onInstalled.addListener(() => serial(checkComplete));
