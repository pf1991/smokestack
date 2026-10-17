import { loadSettings, onSettingsSaved, type UiScale } from '../game/settings';

/**
 * Interface scale. `--ui-scale` on <html> drives `zoom: var(--ui-scale)` on #ui, the side panel and the
 * modal roots (never the map canvas, so map input stays in canvas pixels).
 */

/** 'auto': 0.9 below 1440 px, 1 up to 2200 px, 1.15 above. */
export function resolveUiScale(setting: UiScale, viewportW: number): number {
  if (setting !== 'auto') return setting;
  return viewportW < 1440 ? 0.9 : viewportW <= 2200 ? 1 : 1.15;
}

export function applyUiScale(scale: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  window.dispatchEvent(new Event('uiscalechange'));
}

/** The scale in force (1 when none was applied). Zoomed elements take px lengths in zoomed units: divide screen px by this. */
export function currentUiScale(): number {
  const v = parseFloat(document.documentElement.style.getPropertyValue('--ui-scale'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Applies the saved setting now, follows later changes and (in auto mode) window resizes. Returns the stop function. */
export function startUiScale(): () => void {
  const apply = () => applyUiScale(resolveUiScale(loadSettings().uiScale, window.innerWidth));
  apply();
  const off = onSettingsSaved(apply);
  const onResize = () => {
    if (loadSettings().uiScale === 'auto') apply();
  };
  window.addEventListener('resize', onResize);
  return () => {
    off();
    window.removeEventListener('resize', onResize);
  };
}
