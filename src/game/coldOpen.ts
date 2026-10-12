/**
 * Cold open: the 7.5 s intro a New Game plays before handing over. The camera opens wide on the
 * survey map over the city farthest from the player, pans to the Baron's first target with his
 * portrait and taunt, then swoops down onto the player's start (at the zoom play begins at) with the
 * family crest. The sim is paused throughout and resumes at its previous speed.
 *
 * It stays out of the way: Esc, a click or any key skips it at once, and that event is swallowed so
 * it never also pauses, inspects or builds. With `prefers-reduced-motion` the camera cuts instead of
 * panning and the timeline is shortened (cards only, briefly).
 */
import { DEFAULT_ZOOM, TILE, clampCamera } from '../render/camera';
import { drawBaronPortrait, drawFamilyCrest } from '../render/portrait';
import { chooseProject } from '../sim/rival/market';
import type { City, GameState, Vec2 } from '../sim/types';
import { h } from '../ui/dom';
import '../ui/coldOpen.css';
import { biggestCity } from './autoplay';
import type { GameController } from './controller';

export interface ColdOpenStep {
  atMs: number;
  /** view centre in tile units (tile centres are at +0.5) and zoom */
  camera?: { x: number; y: number; zoom: number };
  card?: 'baron' | 'family';
  text?: string;
}

export const BARON_LINE = "Smogsworth: 'This valley is mine, upstart.'";
/** Establishing shot zoom (survey map). */
const OPEN_ZOOM = 0.6;
/** Zoom over the Baron's city: closer, still on the map. */
const BARON_ZOOM = 1;
/** Each camera move takes this long from its step's time. */
const MOVE_MS = 2000;
/** Slow push-in over the establishing shot. */
const DRIFT = 1.1;
/** With reduced motion the timeline runs at this fraction of its length. */
const REDUCED_SCALE = 0.6;
/** Longest step of the intro clock per frame. */
const MAX_STEP_MS = 50;
/** Upper bound on frames spent warming the final shot's caches before the clock starts. */
const MAX_WARM_FRAMES = 12;
/** The cards and letterbox start leaving this long before the end. */
const OUTRO_MS = 450;

const centre = (p: Vec2) => ({ x: p.x + 0.5, y: p.y + 0.5 });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The Baron's city for the second shot: the city his opening project would pick, unless that is the
 * player's start or the establishing shot's city (the camera would not move); then the biggest
 * other city. Usually his first pick is the player's own (biggest) city, which would leave the
 * pan to the player with nowhere to go.
 */
function baronCity(state: GameState, start: City | undefined, far: City | undefined): City | undefined {
  let pick: City | undefined;
  try {
    pick = chooseProject(state)?.city;
  } catch {
    /* no viable rival plan: fall back to population order */
  }
  const byPop = [...state.cities].sort((a, b) => b.population - a.population || a.id - b.id);
  const order = pick ? [pick, ...byPop] : byPop;
  return order.find((c) => c.id !== start?.id && c.id !== far?.id) ?? order.find((c) => c.id !== start?.id) ?? start;
}

export function coldOpenScript(state: GameState): ColdOpenStep[] {
  const start = biggestCity(state.cities);
  const home = start ? start.center : { x: Math.floor(state.map.width / 2), y: Math.floor(state.map.height / 2) };
  let far = start;
  for (const c of state.cities) if (!far || dist(c.center, home) > dist(far.center, home)) far = c;
  const baron = baronCity(state, start, far);
  return [
    { atMs: 0, camera: { ...centre(far ? far.center : home), zoom: OPEN_ZOOM } },
    { atMs: 2500, camera: { ...centre(baron ? baron.center : home), zoom: BARON_ZOOM }, card: 'baron', text: BARON_LINE },
    { atMs: 5000, camera: { ...centre(home), zoom: DEFAULT_ZOOM }, card: 'family', text: state.companies.player.name },
    { atMs: 7500 },
  ];
}

function easeInOut(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

/**
 * Camera at `t` ms: each keyframe's move starts at its step time and eases in-out over MOVE_MS
 * (centre linear, zoom geometric so the swoop feels even), then holds. The establishing shot pushes
 * in slowly until the first move. `cut` jumps straight to each keyframe.
 */
export function cameraAt(steps: ColdOpenStep[], t: number, cut = false, moveMs = MOVE_MS): { x: number; y: number; zoom: number } {
  const keys = steps.filter((s) => s.camera);
  const first = keys[0].camera!;
  const drifted = (): { x: number; y: number; zoom: number } => {
    if (cut || keys.length < 2) return first;
    const p = Math.min(1, Math.max(0, (t - keys[0].atMs) / (keys[1].atMs - keys[0].atMs)));
    return { ...first, zoom: first.zoom * DRIFT ** p };
  };
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].atMs <= t) i++;
  if (i === 0) return drifted();
  const to = keys[i].camera!;
  const from = i === 1 && !cut ? { ...first, zoom: first.zoom * DRIFT } : keys[i - 1].camera!;
  const u = cut ? 1 : (t - keys[i].atMs) / moveMs;
  if (u >= 1) return to;
  const e = easeInOut(Math.max(0, u));
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    zoom: from.zoom * (to.zoom / from.zoom) ** e,
  };
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function cardEl(step: ColdOpenStep, state: GameState): HTMLElement {
  const px = 112;
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const canvas = h('canvas', { class: 'coldopen-art', width: px * dpr, height: px * dpr }) as HTMLCanvasElement;
  const g = canvas.getContext('2d');
  const name = state.companies.player.name;
  if (g) {
    if (step.card === 'baron') drawBaronPortrait(g, px * dpr, 'smug');
    else drawFamilyCrest(g, px * dpr, name);
  }
  const caption = step.card === 'baron' ? 'Baron Cornelius Smogsworth' : `Established ${state.date.year}`;
  return h('div', { class: `coldopen-card coldopen-${step.card}` },
    canvas,
    h('div', { class: 'coldopen-words' },
      h('div', { class: 'coldopen-text' }, step.text ?? ''),
      h('div', { class: 'coldopen-caption' }, caption)));
}

/**
 * Plays the cold open on `game`, then calls `onDone` once (at the end or on skip). The returned
 * function cancels it (removing every listener, frame hook and DOM node, restoring the speed)
 * without calling `onDone`; it is safe to call more than once or after the end.
 */
export function playColdOpen(game: GameController, onDone: () => void): () => void {
  const state = game.state;
  const reduced = prefersReducedMotion();
  const scale = reduced ? REDUCED_SCALE : 1;
  const steps = coldOpenScript(state).map((s) => ({ ...s, atMs: s.atMs * scale }));
  const endMs = steps[steps.length - 1].atMs;
  const finalCam = [...steps].reverse().find((s) => s.camera)!.camera!;
  const prevSpeed = state.speed;
  game.setSpeed(0);

  const slot = h('div', { class: 'coldopen-slot' });
  const layer = h('div', { class: `coldopen${reduced ? ' coldopen-reduced' : ''}`, 'aria-label': 'Intro' },
    h('div', { class: 'coldopen-bar coldopen-top' }),
    h('div', { class: 'coldopen-bar coldopen-bottom' }, h('span', { class: 'coldopen-hint' }, 'Click or press any key to skip')),
    slot);
  game.uiRoot.appendChild(layer);

  /** The camera of the final shot, as a full Camera for the renderer's prewarm. */
  const landing = () => {
    const cam = { ...game.camera, zoom: finalCam.zoom };
    cam.x = finalCam.x * TILE - cam.viewW / cam.zoom / 2;
    cam.y = finalCam.y * TILE - cam.viewH / cam.zoom / 2;
    clampCamera(cam, game.map);
    return cam;
  };
  const apply = (c: { x: number; y: number; zoom: number }) => {
    const cam = game.camera;
    cam.zoom = c.zoom;
    cam.x = c.x * TILE - cam.viewW / cam.zoom / 2;
    cam.y = c.y * TILE - cam.viewH / cam.zoom / 2;
    clampCamera(cam, game.map);
  };

  // the intro's own clock: advances by real frame time, but at most MAX_STEP_MS per frame, so a
  // slow frame (first-time chunk renders) briefly slows the camera instead of making it jump
  let t = 0;
  let last: number | null = null;
  let warm = 0;
  let shown = -1;
  let over = false;
  const showCard = (t: number) => {
    let idx = -1;
    for (let i = 0; i < steps.length; i++) if (steps[i].card && steps[i].atMs <= t) idx = i;
    if (idx === shown) return;
    shown = idx;
    slot.replaceChildren(...(idx >= 0 ? [cardEl(steps[idx], state)] : []));
  };

  const onFrame = (now: number) => {
    // before the clock starts, fill the diorama caches for the final shot while the establishing
    // shot holds still (a few frames; the letterbox slides in meanwhile)
    if (warm < MAX_WARM_FRAMES && game.renderer?.prewarm(state, landing())) {
      warm++;
      return;
    }
    warm = MAX_WARM_FRAMES;
    t += last === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, now - last));
    last = now;
    if (t >= endMs) return finish();
    apply(cameraAt(steps, t, reduced, MOVE_MS * scale));
    showCard(t);
    if (t >= endMs - OUTRO_MS * scale) layer.classList.add('coldopen-out');
  };
  const onKey = (e: KeyboardEvent) => {
    // browser shortcuts (reload, devtools) pass through untouched
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finish();
  };
  const onPointer = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    finish();
  };
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  apply(cameraAt(steps, 0, reduced));
  const offFrame = game.addFrameHook(onFrame);
  // capture on window: runs before the game's own keydown handler (Space, Esc, 1-4, panels)
  window.addEventListener('keydown', onKey, true);
  layer.addEventListener('pointerdown', onPointer);
  layer.addEventListener('wheel', swallow, { passive: false });
  layer.addEventListener('contextmenu', swallow);

  const cleanup = () => {
    over = true;
    offFrame();
    window.removeEventListener('keydown', onKey, true);
    layer.removeEventListener('pointerdown', onPointer);
    layer.removeEventListener('wheel', swallow);
    layer.removeEventListener('contextmenu', swallow);
    layer.remove();
  };
  function finish(): void {
    if (over) return;
    cleanup();
    // skipped or not, play begins exactly where the intro would have landed
    apply(finalCam);
    game.setSpeed(prevSpeed);
    onDone();
  }
  return () => {
    if (over) return;
    cleanup();
    game.setSpeed(prevSpeed);
  };
}
