// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../../core/events';
import type { GameController } from '../../game/controller';
import { hire } from '../../sim/logistics/managers';
import { placeBuilding, createGame } from '../../sim/state';
import { must } from '../../sim/testkit';
import type { SimContext } from '../../sim/types';
import { PANELS } from './index';
import { levelCard } from './buildingLevel';

afterEach(() => {
  for (const b of document.querySelectorAll<HTMLElement>('.window-close')) b.click();
  document.body.replaceChildren();
});

function setup() {
  const state = createGame({ seed: 7, companyName: 'Acme Works', rival: true });
  state.companies.player.money = 1e8;
  const bus = new EventBus();
  const toasts: GameEvent[] = [];
  bus.on('toast', (e) => toasts.push(e));
  const ctx: SimContext = { state, bus };
  const game = { ctx, state, renderer: { setSelection: () => {} }, openPanel: () => {} } as unknown as GameController;
  return { ctx, game, toasts };
}

const rows = (sel: string) => [...document.querySelectorAll<HTMLElement>(`.managers-panel ${sel}`)];

describe('managers panel', () => {
  it('is registered and lists the market and the staff in two sections', () => {
    const { ctx, game } = setup();
    expect(PANELS.managers.id).toBe('managers');
    PANELS.managers.open(game);
    expect(document.querySelectorAll('.managers-panel .p-section')).toHaveLength(2);
    const heads = rows('.p-head').map((e) => e.textContent);
    expect(heads).toEqual(['On the market', 'Your staff']);
    const cand = rows('.mgr-row');
    expect(cand).toHaveLength(ctx.state.logistics.market.length);
    expect(cand[0].textContent).toContain(ctx.state.logistics.market[0].name);
    expect(cand[0].querySelectorAll('.mgr-skills > span')).toHaveLength(3);
    expect(cand[0].querySelector('button[data-act="hire"]')).not.toBeNull();
    expect(rows('.mgr-empty').map((e) => e.textContent)).toEqual(['No managers hired']);
  });

  it('Hire moves a candidate to the staff, and Fire (severance in the title) removes him', () => {
    const { ctx, game } = setup();
    PANELS.managers.open(game);
    const first = ctx.state.logistics.market[0];
    const n = ctx.state.logistics.market.length;
    (rows('button[data-act="hire"]')[0]).click();
    expect(ctx.state.logistics.managers.map((m) => m.id)).toEqual([first.id]);
    expect(rows('.mgr-row')).toHaveLength(n - 1 + 1);
    const fireBtn = rows('button[data-act="fire"]')[0];
    expect(fireBtn.title).toMatch(/^Severance \$/);
    fireBtn.click();
    expect(ctx.state.logistics.managers).toEqual([]);
    expect(rows('button[data-act="fire"]')).toHaveLength(0);
  });

  it('the Assign select offers the works and warehouses without a manager', () => {
    const { ctx, game } = setup();
    const mill = must(placeBuilding(ctx, 'player', 'warehouse', { x: 3, y: 3 }));
    const m = must(hire(ctx, 'player', ctx.state.logistics.market[0].id));
    PANELS.managers.open(game);
    const sel = rows('select')[0] as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toContain(String(mill.id));
    sel.value = String(mill.id);
    sel.dispatchEvent(new Event('change'));
    expect(m.post).toBe(mill.id);
  });
});

describe('the inspector manager slot', () => {
  it('shows the posted manager and assigns an idle one', () => {
    const { ctx } = setup();
    const wh = must(placeBuilding(ctx, 'player', 'warehouse', { x: 3, y: 3 }));
    const m = must(hire(ctx, 'player', ctx.state.logistics.market[0].id));
    const card = levelCard({ ctx }, wh);
    document.body.append(card.el);
    const sel = card.el.querySelector('.insp-manager-select') as HTMLSelectElement;
    expect(sel.hidden).toBe(false);
    sel.value = String(m.id);
    sel.dispatchEvent(new Event('change'));
    expect(m.post).toBe(wh.id);
    expect(card.el.querySelector('.insp-manager-info')?.textContent).toContain(m.name);
    (card.el.querySelector('.insp-manager-unassign') as HTMLButtonElement).click();
    expect(m.post).toBeNull();
  });
});
