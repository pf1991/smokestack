/**
 * Map-first touch copy: drag pans, pinch zooms, tap acts. Shown above the build bar on coarse
 * pointers so players are not stuck inventing two-finger gestures.
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
      return 'Tap to place · Drag to move the map';
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
  readonly el = h('div', {
    class: 'touch-coach',
    hidden: true,
    role: 'status',
    'aria-live': 'polite',
  });

  constructor(parent: HTMLElement) {
    parent.appendChild(this.el);
  }

  set(tool: ToolSpec, hasAnchor: boolean): void {
    const text = touchCoachText(tool, hasAnchor);
    if (!text) {
      this.el.hidden = true;
      this.el.textContent = '';
      return;
    }
    this.el.hidden = false;
    this.el.textContent = text;
  }

  destroy(): void {
    this.el.remove();
  }
}
