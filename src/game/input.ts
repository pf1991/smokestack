import { clampCamera, screenToTile, screenToWorld, setZoomTarget, stepZoom } from '../render/camera';
import type { Camera } from '../render/constants';
import type { GameMap, Speed, Vec2 } from '../sim/types';
import type { ToolSpec } from '../ui/tools';
import { closeHelp, isHelpOpen, toggleHelp } from '../ui/help';
import { shortcutForEvent } from '../ui/shortcuts';

/** What the input layer drives (implemented by GameController). */
export interface InputHost {
  camera: Camera;
  readonly map: GameMap;
  tools: {
    pointerDown(t: Vec2, world?: Vec2): void;
    pointerMove(t: Vec2, world?: Vec2): void;
    pointerUp(t: Vec2): void;
    /** map-first touch: deliberate tap (never a pan) */
    tap(t: Vec2, world?: Vec2): void;
    leave(): void;
    cancel(): void;
    /** drop an in-progress road/rail drag without changing the tool (second finger / pinch) */
    abortDrag?(): void;
    readonly hasAnchor?: boolean;
  };
  /** refresh the on-screen touch coaching strip after a tap changes the anchor */
  onTouchCoach?(): void;
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
  /** M / K: flips a map overlay and keeps its HUD button in sync */
  toggleOverlay?(id: 'pollution' | 'factions'): void;
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
  /** T: opens or closes the top-bar alerts tray */
  toggleAlerts?(): void;
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
/** screen pixels per millisecond for keyboard panning */
const KEY_PAN_SPEED = 0.9;
const WHEEL_STEP = 1.15;
/** Manhattan screen px a left press must travel in Inspect before it becomes a pan. */
export const DRAG_THRESHOLD_PX = 6;
/** Touch taps wobble more than mouse clicks. */
export const TOUCH_DRAG_THRESHOLD_PX = 12;

/** True for finger / pen — uses map-first controls (drag pans, tap acts, pinch zooms). */
export function isTouchPointer(e: Pick<PointerEvent, 'pointerType'>): boolean {
  return e.pointerType === 'touch' || e.pointerType === 'pen';
}

/** True when keyboard focus is in a text field, where game shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Mouse, wheel, touch and keyboard handling.
 *
 * Desktop: left → tool; right/middle drag → pan; wheel → zoom.
 * Touch (map-first): **drag pans**, **pinch zooms**, **tap acts** (roads are tap–tap). Never requires
 * two fingers just to move the map.
 * Photo mode: left pans; only Esc, P and pan keys act.
 */
export class Input {
  private held = new Set<string>();
  private pan: { x: number; y: number; id: number; moved: boolean } | null = null;
  /** left press not yet classified as pan vs click/tap */
  private pending: { x: number; y: number; id: number; world: Vec2; tile: Vec2; touch: boolean } | null = null;
  private toolPointer: number | null = null;
  /** live pointers on the canvas (pinch uses two) */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; midX: number; midY: number } | null = null;
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
      if (this.toolPointer === null && this.pointers.size === 0) this.host.tools.leave();
    });
    on(canvas, 'wheel', (e) => this.wheel(e), { passive: false });
    onWin('keydown', (e) => this.keyDown(e));
    onWin('keyup', (e) => this.held.delete(e.key.toLowerCase()));
    onWin('blur', () => this.held.clear());
  }

  private threshold(e: PointerEvent): number {
    return isTouchPointer(e) ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
  }

  private track(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  private untrack(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size < 2) this.pinch = null;
  }

  private pair(): [{ x: number; y: number }, { x: number; y: number }] | null {
    if (this.pointers.size < 2) return null;
    const pts = [...this.pointers.values()];
    return [pts[0]!, pts[1]!];
  }

  private beginPinch(): void {
    const pair = this.pair();
    if (!pair) return;
    const [a, b] = pair;
    this.pinch = {
      dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
    // a second finger cancels any one-finger pan / tool / pending inspect / tap–tap anchor
    this.pending = null;
    this.pan = null;
    this.toolPointer = null;
    this.host.tools.abortDrag?.();
    this.host.onTouchCoach?.();
    this.setCursor('grabbing');
    this.host.onManualPan?.();
  }

  private movePinch(): void {
    const pair = this.pair();
    if (!pair || !this.pinch) return;
    const [a, b] = pair;
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const cam = this.host.camera;
    const r = this.canvas.getBoundingClientRect();
    const lx = midX - r.left;
    const ly = midY - r.top;
    const factor = dist / this.pinch.dist;
    if (factor > 0 && Number.isFinite(factor) && Math.abs(factor - 1) > 0.001) {
      setZoomTarget(cam, lx, ly, factor);
    }
    cam.x -= (midX - this.pinch.midX) / cam.zoom;
    cam.y -= (midY - this.pinch.midY) / cam.zoom;
    this.pinch = { dist, midX, midY };
    clampCamera(cam, this.host.map);
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

  private inspecting(): boolean {
    return this.host.activeToolKind === 'inspect' && !this.host.photoActive;
  }

  private setCursor(c: string): void {
    this.canvas.style.cursor = c;
  }

  private startPan(x: number, y: number, id: number, moved = false): void {
    this.pan = { x, y, id, moved };
    this.setCursor('grabbing');
  }

  private down(e: PointerEvent): void {
    this.track(e);
    this.capture(e.pointerId);
    if (this.pointers.size >= 2) {
      e.preventDefault();
      this.beginPinch();
      return;
    }
    // Touch map-first: every single finger is "pending" until we know pan vs tap
    if (isTouchPointer(e) && (e.button === 0 || e.button === -1)) {
      e.preventDefault();
      const p = this.local(e);
      this.pending = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        world: screenToWorld(this.host.camera, p.x, p.y),
        tile: this.tileOf(e),
        touch: true,
      };
      return;
    }
    if (e.button === 0 && this.inspecting()) {
      const p = this.local(e);
      this.pending = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        world: screenToWorld(this.host.camera, p.x, p.y),
        tile: this.tileOf(e),
        touch: false,
      };
      return;
    }
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.host.photoActive)) {
      e.preventDefault();
      this.startPan(e.clientX, e.clientY, e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    this.toolPointer = e.pointerId;
    const p = this.local(e);
    this.host.tools.pointerDown(this.tileOf(e), screenToWorld(this.host.camera, p.x, p.y));
  }

  private move(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) this.track(e);
    if (this.pinch || this.pointers.size >= 2) {
      if (!this.pinch) this.beginPinch();
      this.movePinch();
      return;
    }
    if (this.pending && e.pointerId === this.pending.id) {
      const pd = this.pending;
      if (Math.abs(e.clientX - pd.x) + Math.abs(e.clientY - pd.y) < this.threshold(e)) return;
      this.pending = null;
      this.startPan(pd.x, pd.y, pd.id, true);
    }
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
    this.setCursor(this.inspecting() || this.host.photoActive ? 'grab' : '');
    if (this.host.photoActive) return;
    const p = this.local(e);
    this.host.tools.pointerMove(this.tileOf(e), screenToWorld(this.host.camera, p.x, p.y));
  }

  private up(e: PointerEvent): void {
    const wasPinch = this.pinch !== null || this.pointers.size >= 2;
    this.untrack(e.pointerId);
    if (wasPinch) {
      this.pan = null;
      this.pending = null;
      this.toolPointer = null;
      this.setCursor(this.inspecting() || this.host.photoActive ? 'grab' : '');
      return;
    }
    if (this.pending && e.pointerId === this.pending.id) {
      const pd = this.pending;
      this.pending = null;
      if (e.type === 'pointercancel') return;
      if (this.host.photoActive) return;
      if (pd.touch) {
        this.host.tools.tap(pd.tile, pd.world);
        this.host.onTouchCoach?.();
        return;
      }
      this.host.tools.pointerDown(pd.tile, pd.world);
      this.host.tools.pointerUp(pd.tile);
      return;
    }
    if (this.pan && e.pointerId === this.pan.id) {
      const click = !this.pan.moved && e.button === 2;
      this.pan = null;
      this.setCursor(this.inspecting() || this.host.photoActive ? 'grab' : '');
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
    const factor = e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
    setZoomTarget(this.host.camera, p.x, p.y, factor);
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
    if (isHelpOpen()) {
      // the help overlay is modal: Esc, ? and H close it, everything else waits
      if (key === 'escape' || key === '?' || key === 'h') {
        e.preventDefault();
        closeHelp();
      }
      return;
    }
    const sc = shortcutForEvent(e.key);
    if (!sc) return;
    const a = sc.action;
    if (this.host.photoActive && a.kind !== 'escape' && a.kind !== 'photo') return;
    switch (a.kind) {
      case 'pause':
        e.preventDefault();
        this.host.togglePause();
        break;
      case 'speed':
        this.host.setSpeed(a.speed);
        break;
      case 'escape':
        if (this.host.escape) {
          this.host.escape();
        } else {
          this.host.tools.cancel();
          this.host.closeDrawer();
        }
        break;
      case 'photo':
        this.host.togglePhotoMode?.();
        break;
      case 'toolbar':
        this.host.toggleToolbar();
        break;
      case 'bulldoze':
        this.host.setTool({ kind: 'bulldoze' });
        break;
      case 'panel':
        this.host.tryOpenPanel(a.id);
        break;
      case 'overlay':
        this.host.toggleOverlay?.(a.id);
        break;
      case 'help':
        toggleHelp();
        break;
      case 'alerts':
        this.host.toggleAlerts?.();
        break;
    }
  }

  /** Applies held pan keys; call once per frame with the real elapsed milliseconds. */
  update(dtMs: number): void {
    if (this.host.camera.zoomTarget !== undefined) {
      stepZoom(this.host.camera, dtMs);
      clampCamera(this.host.camera, this.host.map);
    }
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
    closeHelp();
  }
}
