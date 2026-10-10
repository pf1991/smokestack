export interface Settings {
  /** master volume 0..1 */
  volume: number;
  muted: boolean;
  /** open the newspaper automatically when a historic event happens */
  autoNews: boolean;
}

const KEY = 'smokestack:settings';
/** Same key the newspaper panel reads ('off' disables auto-open). */
const AUTO_NEWS_KEY = 'smokestack:autoNews';

export const DEFAULT_SETTINGS: Settings = { volume: 0.6, muted: false, autoNews: true };

export function loadSettings(): Settings {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Settings>;
      if (typeof p.volume === 'number' && Number.isFinite(p.volume)) out.volume = Math.min(1, Math.max(0, p.volume));
      if (typeof p.muted === 'boolean') out.muted = p.muted;
    }
    out.autoNews = localStorage.getItem(AUTO_NEWS_KEY) !== 'off';
  } catch {
    /* blocked storage: defaults */
  }
  return out;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ volume: s.volume, muted: s.muted }));
    localStorage.setItem(AUTO_NEWS_KEY, s.autoNews ? 'on' : 'off');
  } catch {
    /* quota or blocked storage: settings last for this session only */
  }
}
