// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameController } from '../../game/controller';
import { placeBuilding } from '../../sim/state';
import { must, testCtx, testState } from '../../sim/testkit';
import { buyTruck, createRoute } from '../../sim/vehicles';
import { closeAllWindows } from '../window';
import { PANELS } from './index';

/** Class presence only: every panel is built from the shared `.p-*` classes and keeps font sizes in CSS. */
function setup() {
  const s = testState({ width: 100, height: 40, money: 1_000_000, cities: [{ x: 10, y: 20, population: 1000, name: 'Ashford' }] });
  const ctx = testCtx(s);
  const a = must(placeBuilding(ctx, 'player', 'sawmill', { x: 30, y: 20 }));
  const b = must(placeBuilding(ctx, 'player', 'sawmill', { x: 40, y: 20 }));
  for (let x = 28; x < 46; x++) s.map.tiles[23 * s.map.width + x].road = true;
  const route = must(createRoute(ctx, 'player', 'Run', [
    { buildingId: a.id, load: [], unload: [] },
    { buildingId: b.id, load: [], unload: [] },
  ]));
  const truck = buyTruck(ctx, 'player', route.id);
  const game = { ctx, state: s, renderer: { setSelection: vi.fn() }, centerOn: vi.fn(), openPanel: vi.fn(), hud: { markNewsRead: vi.fn() },
    tools: { onPick: null }, setTool: vi.fn(), onToolChange: () => () => {} };
  return { game: game as unknown as GameController, a, route, vehicleId: truck.ok ? truck.value.id : 0 };
}

beforeEach(() => {
  // jsdom has no canvas: the charts and the Baron's portrait just skip drawing
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  closeAllWindows();
  document.body.replaceChildren();
});

// panels that have several titled blocks must say so
const MIN_SECTIONS: Record<string, number> = { finance: 5, politics: 5, building: 3, city: 3, contracts: 3, rival: 6 };

const INLINE_FONT_EXEMPT = new Set<string>([]);

describe('panel density classes', () => {
  const cases: [string, (t: ReturnType<typeof setup>) => unknown][] = [
    ['finance', () => undefined],
    ['politics', () => undefined],
    ['routes', () => undefined],
    ['fleet', () => undefined],
    ['contracts', () => undefined],
    ['newspaper', () => undefined],
    ['rival', () => undefined],
    ['goals', () => undefined],
    ['building', (t) => t.a.id],
    ['city', () => 0],
    ['vehicle', (t) => t.vehicleId],
  ];
  for (const [id, arg] of cases) {
    it(`${id} is made of p-section blocks and sets no inline font-size`, () => {
      const t = setup();
      PANELS[id].open(t.game, arg(t));
      const body = document.querySelector('.window-body') as HTMLElement;
      const sections = body.querySelectorAll('.p-section').length;
      expect(sections).toBeGreaterThanOrEqual(MIN_SECTIONS[id] ?? 1);
      if (!INLINE_FONT_EXEMPT.has(id)) expect(body.querySelectorAll('[style*="font-size"]')).toHaveLength(0);
    });
  }

  it('politics uses the shared row, chip and header classes', () => {
    const t = setup();
    PANELS.politics.open(t.game);
    const body = document.querySelector('.window-body') as HTMLElement;
    expect(body.querySelectorAll('.p-section > .p-head').length).toBeGreaterThan(0);
    expect(body.querySelectorAll('.p-chips').length).toBe(3);
    expect(body.querySelectorAll('.p-row').length).toBeGreaterThan(0);
  });
});
