export const DEFAULTS = {
  focusMin: 25,
  breakMin: 5,
  autoStart: false,
  musicOn: false,
  volume: 0.5,
  widgetOn: true,
};

export const durationFor = (phase, s) => (phase === 'focus' ? s.focusMin : s.breakMin) * 60000;

export function dateKey(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
