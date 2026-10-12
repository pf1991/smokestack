import { clampCamera, screenToTile, screenToWorld, zoomAt } from '../render/camera';
import type { Camera } from '../render/constants';
import type { GameMap, Speed, Vec2 } from '../sim/types';
import type { ToolSpec } from '../ui/tools';

/** What the input layer drives (implemented by GameController). */
export interface InputHost {
  camera: Camera;
  readonly map: GameMap;
  tools: {
    pointerDown(t: Vec2, world?: Vec2): void;
    pointerMove(t: Vec2): void;
    pointerUp(t: Vec2): void;
    leave(): void;
    cancel(): void;
  };
  setSpeed(s: Speed): void;
  togglePause(): void;
  setTool(t: ToolSpec): void;
  toggleToolbar(): void;
  /** closes an open build drawer */
  closeDrawer(): void;
  /** Esc: when provided it replaces the default cancel-tool behaviour (it must cancel the tool itself) */
  escape?(): void;
  /** P: toggles photo mode */
  togglePhotoMode?(): void;
  /** opens a registered panel; returns false when none is registered under `id` */
  tryOpenPanel(id: string): boolean;
  /** the player panned by hand (cancels camera follow) */
  onManualPan?(): void;
  /** right-click without dragging: cancels pick mode */
  readonly activeToolKind?: string;
  /**
   * True while photo mode is on: the left button pans instead of reaching the tool, hovering sets no
   * ghost, and only Esc, P and the pan keys act (wheel zoom and right/middle-drag pan still work).
   */
  readonly photoActive?: boolean;
}

const PAN_KEYS: Record<string, Vec2> = {
  w: { x: 0, y: -1 },
  arrowup: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  arrowdown: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  arrowleft: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
  arrowright: { x: 1, y: 0 },
};
const SPEED_KEYS: Record<string, Speed> = { '1': 1, '2': 2, '3': 4, '4': 8 };
const PANEL_KEYS: Record<string, string> = { r: 'routes', f: 'finance', n: 'newspaper', v: 'fleet' };
/** screen pixels per millisecond for keyboard panning */
const KEY_PAN_SPEED = 0.9;
const WHEEL_STEP = 1.15;

/** True when keyboard focus is in a text field, where game shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Mouse, wheel and keyboard handling per Game Design → Controls. Left button → current tool;
 * right/middle drag pans; wheel zooms at the cursor; WASD/arrows pan; Space pauses; 1–4 set speeds;
 * Esc cancels the tool; B toggles the toolbar; Delete picks the bulldozer; R/F/N open panels.
 * In photo mode (`host.photoActive`) the left button pans too and only Esc, P and the pan keys act.
 */
export class Input {
  private held = new Set<string>();
  private pan: { x: number; y: number; id: number; moved: boolean } | null = null;
  private toolPointer: number | null = null;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: InputHost,
    win: Window = window,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.offs.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    const onWin = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      win.addEventListener(type, fn as EventListener);
      this.offs.push(() => win.removeEventListener(type, fn as EventListener));
    };

    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'pointerdown', (e) => this.down(e));
    on(canvas, 'pointermove', (e) => this.move(e));
    on(canvas, 'pointerup', (e) => this.up(e));
    on(canvas, 'pointercancel', (e) => this.up(e));
    on(canvas, 'pointerleave', () => {
      if (this.toolPointer === null) this.host.tools.leave();
    });
    on(canvas, 'wheel', (e) => this.wheel(e), { passive: false });
    onWin('keydown', (e) => this.keyDown(e));
    onWin('keyup', (e) => this.held.delete(e.key.toLowerCase()));
    onWin('blur', () => this.held.clear());
  }

  private local(e: MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private tileOf(e: MouseEvent): Vec2 {
    const p = this.local(e);
    return screenToTile(this.host.camera, p.x, p.y);
  }

  private capture(id: number): void {
    try {
      this.canvas.setPointerCapture(id);
    } catch {
      /* synthetic events have no active pointer */
    }
  }

  private down(e: PointerEvent): void {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.host.photoActive)) {
      e.preventDefault();
      this.pan = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
      this.capture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    this.toolPointer = e.pointerId;
    this.capture(e.pointerId);
    const p = this.local(e);
    this.host.tools.pointerDown(this.tileOf(e), screenToWorld(this.host.camera, p.x, p.y));
  }

  private move(e: PointerEvent): void {
    if (this.pan && e.pointerId === this.pan.id) {
      const cam = this.host.camera;
      if (Math.abs(e.clientX - this.pan.x) + Math.abs(e.clientY - this.pan.y) > 0) this.pan.moved = true;
      if (this.pan.moved) this.host.onManualPan?.();
      cam.x -= (e.clientX - this.pan.x) / cam.zoom;
      cam.y -= (e.clientY - this.pan.y) / cam.zoom;
      this.pan.x = e.clientX;
      this.pan.y = e.clientY;
      clampCamera(cam, this.host.map);
      return;
    }
    if (this.host.photoActive) return;
    this.host.tools.pointerMove(this.tileOf(e));
  }

  private up(e: PointerEvent): void {
    if (this.pan && e.pointerId === this.pan.id) {
      const click = !this.pan.moved && e.button === 2;
      this.pan = null;
      if (click && this.host.activeToolKind === 'pickStop') this.host.tools.cancel();
      return;
    }
    if (this.toolPointer !== e.pointerId) return;
    this.toolPointer = null;
    this.host.tools.pointerUp(this.tileOf(e));
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.deltaY === 0) return;
    const p = this.local(e);
    zoomAt(this.host.camera, p.x, p.y, e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP);
    clampCamera(this.host.camera, this.host.map);
  }

  private keyDown(e: KeyboardEvent): void {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key in PAN_KEYS) {
      this.held.add(key);
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (this.host.photoActive && key !== 'escape' && key !== 'p') return;
    if (key === ' ') {
      e.preventDefault();
      this.host.togglePause();
    } else if (key in SPEED_KEYS) {
      this.host.setSpeed(SPEED_KEYS[key]);
    } else if (key === 'escape') {
      if (this.host.escape) {
        this.host.escape();
      } else {
        this.host.tools.cancel();
        this.host.closeDrawer();
      }
    } else if (key === 'p') {
      this.host.togglePhotoMode?.();
    } else if (key === 'b') {
      this.host.toggleToolbar();
    } else if (key === 'delete') {
      this.host.setTool({ kind: 'bulldoze' });
    } else if (key in PANEL_KEYS) {
      this.host.tryOpenPanel(PANEL_KEYS[key]);
    }
  }

  /** Applies held pan keys; call once per frame with the real elapsed milliseconds. */
  update(dtMs: number): void {
    if (this.held.size === 0) return;
    let dx = 0;
    let dy = 0;
    for (const k of this.held) {
      const v = PAN_KEYS[k];
      if (v) {
        dx += v.x;
        dy += v.y;
      }
    }
    if (dx === 0 && dy === 0) return;
    this.host.onManualPan?.();
    const cam = this.host.camera;
    const len = Math.hypot(dx, dy);
    cam.x += ((dx / len) * KEY_PAN_SPEED * dtMs) / cam.zoom;
    cam.y += ((dy / len) * KEY_PAN_SPEED * dtMs) / cam.zoom;
    clampCamera(cam, this.host.map);
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.held.clear();
  }
}
