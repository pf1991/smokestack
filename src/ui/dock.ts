let strip: HTMLElement | null = null;

/** Right-side vertical tab strip for docked windows, created lazily inside #ui. */
export function dockTabs(): HTMLElement {
  if (strip?.isConnected) return strip;
  strip = document.createElement('div');
  strip.className = 'dock';
  strip.setAttribute('role', 'tablist');
  (document.getElementById('ui') ?? document.body).appendChild(strip);
  return strip;
}
