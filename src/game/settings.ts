export type TickerMode = 'scroll' | 'headline' | 'off';

export type UiScale = 'auto' | 0.8 | 0.9 | 1 | 1.15 | 1.3;
export const UI_SCALES: readonly number[] = [0.8, 0.9, 1, 1.15, 1.3];

export interface Settings {
  /** master volume 0..1 */
  volume: number;
  muted: boolean;
  /** open the newspaper automatically when a historic event happens */
  autoNews: boolean;
  /** start new games without the cold-open intro (game/coldOpen.ts) */
  skipIntro: boolean;
  /** side panel width in CSS px (ui/sidePanel.ts); null means the default min(420px, 34vw) */
  panelWidth: number | null;
  /** news strip: scrolling headlines, the latest headline only, or none (ui/ticker.ts) */
  ticker: TickerMode;
  /** interface scale (ui/scale.ts); 'auto' picks by viewport width */
  uiScale: UiScale;
  /** let JEV (the local decision proxy) weigh in on event-card choices */
  smartEvents: boolean;
}

const KEY = 'smokestack:settings';
/** Same key the newspaper panel reads ('off' disables auto-open). */
const AUTO_NEWS_KEY = 'smokestack:autoNews';

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.6, muted: false, autoNews: true, skipIntro: false, panelWidth: null, ticker: 'headline', uiScale: 'auto', smartEvents: true,
};

export function loadSettings(): Settings {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Settings>;
      if (typeof p.volume === 'number' && Number.isFinite(p.volume)) out.volume = Math.min(1, Math.max(0, p.volume));
      if (typeof p.muted === 'boolean') out.muted = p.muted;
      if (typeof p.skipIntro === 'boolean') out.skipIntro = p.skipIntro;
      if (typeof p.panelWidth === 'number' && Number.isFinite(p.panelWidth) && p.panelWidth > 0) out.panelWidth = p.panelWidth;
      if (p.ticker === 'scroll' || p.ticker === 'headline' || p.ticker === 'off') out.ticker = p.ticker;
      if (p.uiScale === 'auto' || UI_SCALES.includes(p.uiScale as number)) out.uiScale = p.uiScale as UiScale;
      if (typeof p.smartEvents === 'boolean') out.smartEvents = p.smartEvents;
    }
    out.autoNews = localStorage.getItem(AUTO_NEWS_KEY) !== 'off';
  } catch {
    /* blocked storage: defaults */
  }
  return out;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      volume: s.volume, muted: s.muted, skipIntro: s.skipIntro,
      panelWidth: s.panelWidth, ticker: s.ticker, uiScale: s.uiScale, smartEvents: s.smartEvents,
    }));
    localStorage.setItem(AUTO_NEWS_KEY, s.autoNews ? 'on' : 'off');
  } catch {
    /* quota or blocked storage: settings last for this session only */
  }
  for (const fn of [...listeners]) fn(s);
}

const listeners = new Set<(s: Settings) => void>();

/** Calls `fn` after every saveSettings (the ticker follows its setting live). Returns the unsubscribe. */
export function onSettingsSaved(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
