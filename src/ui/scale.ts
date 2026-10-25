import { loadSettings, onSettingsSaved, type UiScale } from '../game/settings';

/**
 * Interface scale. `--ui-scale` on <html> drives `zoom: var(--ui-scale)` on #ui, the side panel and the
 * modal roots (never the map canvas, so map input stays in canvas pixels).
 */

/**
 * 'auto': phones 0.75, small tablets 0.8, laptops 0.9, desktops 1, large 1.15.
 * Narrow screens need a smaller chrome so the map keeps usable space.
 */
export function resolveUiScale(setting: UiScale, viewportW: number): number {
  if (setting !== 'auto') return setting;
  if (viewportW < 600) return 0.75;
  if (viewportW < 900) return 0.8;
  if (viewportW < 1440) return 0.9;
  if (viewportW <= 2200) return 1;
  return 1.15;
}

/** False only when the engine positively lacks CSS zoom; the scale is then forced to 1 so no px maths diverges from the layout. */
export function zoomSupported(): boolean {
  return !(typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !CSS.supports('zoom', '1'));
}

export function applyUiScale(scale: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(zoomSupported() ? scale : 1));
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
