/**
 * Map-first touch copy: drag pans, pinch zooms, tap acts. Shown above the build bar on coarse
 * pointers so players are not stuck inventing two-finger gestures. When a build/road tool is
 * active, a Done control returns to Inspect (phones have no Esc).
 */
import type { ToolSpec } from './tools';
import { h } from './dom';
import './touchCoach.css';

/** True when the primary pointer is coarse (phones / many tablets). */
export function preferTouchControls(win: Window = window): boolean {
  return typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
}

/** One-line coaching for the active tool; null when desktop chrome should stay quiet. */
export function touchCoachText(tool: ToolSpec, hasAnchor: boolean, force = preferTouchControls()): string | null {
  if (!force) return null;
  switch (tool.kind) {
    case 'inspect':
      return 'Drag to move · Pinch to zoom · Tap to inspect';
    case 'build':
      return 'Tap the map to place';
    case 'road':
      return hasAnchor ? 'Tap the other end of the road' : 'Tap one end of the road · Drag to move';
    case 'rail':
      return hasAnchor ? 'Tap the other end of the track' : 'Tap one end of the track · Drag to move';
    case 'trees':
      return hasAnchor ? 'Tap the opposite corner' : 'Tap one corner · Drag to move';
    case 'bulldoze':
      return 'Tap to demolish · Drag to move the map';
    case 'pickStop':
      return 'Tap a building for this stop · Drag to move';
  }
}

/** Floating hint above the toolbar; call `set` whenever the tool or anchor changes. */
export class TouchCoach {
  private readonly hint = h('span', { class: 'touch-coach-hint' });
  private readonly done = h('button', {
    type: 'button',
    class: 'touch-coach-done',
    hidden: true,
    'aria-label': 'Done — stop building',
  }, 'Done') as HTMLButtonElement;
  readonly el = h('div', {
    class: 'touch-coach',
    hidden: true,
    role: 'status',
    'aria-live': 'polite',
  }, this.done, this.hint);

  constructor(parent: HTMLElement, private readonly onDone: () => void) {
    parent.appendChild(this.el);
    this.done.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onDone();
    });
  }

  set(tool: ToolSpec, hasAnchor: boolean): void {
    const text = touchCoachText(tool, hasAnchor);
    if (!text) {
      this.el.hidden = true;
      this.hint.textContent = '';
      this.done.hidden = true;
      return;
    }
    this.el.hidden = false;
    this.hint.textContent = text;
    // Done only while a sticky tool would keep placing / drawing on every tap
    const sticky = tool.kind !== 'inspect';
    this.done.hidden = !sticky;
    this.el.classList.toggle('touch-coach--armed', sticky);
  }

  destroy(): void {
    this.el.remove();
  }
}
