// Generative calm lofi: warm pad chords, a soft bass, sparse pentatonic keys and a quiet noise bed,
// all synthesized live with Web Audio so no audio files need to ship with the extension.

const ctx = new AudioContext();
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

const out = ctx.createDynamicsCompressor();
out.connect(ctx.destination);

function impulse(seconds, decay) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

const reverb = ctx.createConvolver();
reverb.buffer = impulse(5, 2.4);
const wet = ctx.createGain();
wet.gain.value = 0.6;
reverb.connect(wet).connect(out);

const musicGain = ctx.createGain();
musicGain.gain.value = 0;
const tone = ctx.createBiquadFilter();
tone.type = 'lowpass';
tone.frequency.value = 1500;
tone.Q.value = 0.4;
musicGain.connect(tone);
tone.connect(out);
tone.connect(reverb);

// Very slow filter drift so the texture breathes.
const lfo = ctx.createOscillator();
lfo.frequency.value = 0.04;
const lfoAmt = ctx.createGain();
lfoAmt.gain.value = 450;
lfo.connect(lfoAmt).connect(tone.frequency);
lfo.start();

const chimeGain = ctx.createGain();
chimeGain.gain.value = 0.3;
chimeGain.connect(out);
chimeGain.connect(reverb);

// Fmaj7 → Em7 → Dm9 → Cmaj9
const CHORDS = [
  { bass: 41, notes: [53, 57, 60, 64] },
  { bass: 40, notes: [52, 55, 59, 62] },
  { bass: 38, notes: [50, 53, 57, 60, 64] },
  { bass: 36, notes: [48, 52, 55, 59, 62] },
];
const KEYS = [72, 74, 76, 79, 81, 84];
const CHORD_LEN = 8;

function padNote(midi, t, dur, level) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 2.5);
  g.gain.setValueAtTime(level, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 3);
  const pan = ctx.createStereoPanner();
  pan.pan.value = (Math.random() * 2 - 1) * 0.5;
  g.connect(pan).connect(musicGain);
  for (const [type, detune] of [['triangle', -7], ['sine', 7]]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = mtof(midi);
    o.detune.value = detune;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 3.1);
  }
}

function keyNote(midi, t, level) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
  const pan = ctx.createStereoPanner();
  pan.pan.value = (Math.random() * 2 - 1) * 0.6;
  g.connect(pan).connect(musicGain);
  const partials = [[1, 1], [2, 0.22], [3, 0.06]];
  for (const [mult, amp] of partials) {
    const o = ctx.createOscillator();
    const pg = ctx.createGain();
    o.frequency.value = mtof(midi) * mult;
    pg.gain.value = amp;
    o.connect(pg).connect(g);
    o.start(t);
    o.stop(t + 3.6);
  }
}

function playChord(chord, t) {
  for (const n of chord.notes) padNote(n, t, CHORD_LEN, 0.035);
  padNote(chord.bass, t, CHORD_LEN, 0.07);
  const count = 1 + Math.floor(Math.random() * 3);
  const slots = [0.5, 2, 3.5, 5, 6.5].sort(() => Math.random() - 0.5).slice(0, count);
  let last = null;
  for (const s of slots) {
    let note;
    do note = KEYS[Math.floor(Math.random() * KEYS.length)];
    while (note === last);
    last = note;
    keyNote(note, t + s + Math.random() * 0.2, 0.05);
  }
}

function brownNoise() {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}
const noiseBuf = brownNoise();

let playing = false;
let volume = 0.5;
let nextTime = 0;
let chordIdx = 0;
let scheduler = null;
let noise = null;
let suspendTimer = null;

function schedule() {
  while (nextTime < ctx.currentTime + 4) {
    playChord(CHORDS[chordIdx % CHORDS.length], nextTime);
    nextTime += CHORD_LEN;
    chordIdx++;
  }
}

async function start(vol) {
  volume = vol ?? volume;
  clearTimeout(suspendTimer);
  await ctx.resume();
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  musicGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.8);
  if (playing) return;
  playing = true;
  nextTime = Math.max(nextTime, ctx.currentTime + 0.1);
  schedule();
  scheduler = setInterval(schedule, 1000);
  if (!noise) {
    noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 450;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(lp).connect(ng).connect(musicGain);
    noise.start();
  }
}

function stop() {
  if (!playing) return;
  playing = false;
  clearInterval(scheduler);
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
  suspendTimer = setTimeout(() => {
    noise?.stop();
    noise = null;
    ctx.suspend();
  }, 4000);
}

function setVolume(v) {
  volume = v;
  if (playing) musicGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.1);
}

async function chime(kind) {
  clearTimeout(suspendTimer);
  await ctx.resume();
  // Rising after focus (time to rest), falling after a break (settle back in).
  const notes = kind === 'focus' ? [79, 84, 88] : [88, 84, 79];
  notes.forEach((m, i) => {
    const t = ctx.currentTime + 0.05 + i * 0.28;
    for (const [mult, amp] of [[1, 1], [2.76, 0.25], [5.4, 0.08]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = mtof(m) * mult;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5 * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5 / mult + 0.5);
      o.connect(g).connect(chimeGain);
      o.start(t);
      o.stop(t + 3);
    }
  });
  if (!playing) suspendTimer = setTimeout(() => ctx.suspend(), 5000);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.cmd === 'music') msg.on ? start(msg.volume) : stop();
  else if (msg.cmd === 'volume') setVolume(msg.volume);
  else if (msg.cmd === 'chime') chime(msg.kind);
});

chrome.runtime.sendMessage({ type: 'offscreenReady' }).then((s) => {
  if (s?.on) start(s.volume);
});
