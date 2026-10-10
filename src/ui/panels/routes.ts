import { BUILDINGS } from '../../data/buildings';
import { GOODS } from '../../data/goods';
import type { GameController } from '../../game/controller';
import { isTyping } from '../../game/input';
import { acceptedGoods, appendStop, legLength, offeredGoods, routeThroughput } from '../../sim/routeHelpers';
import { buyTrain, STATION_TYPE, TRAIN } from '../../sim/rail';
import type { Building, GameState, GoodId, Route, RouteStop } from '../../sim/types';
import { buyTruck, createRoute, deleteRoute, ROUTE_COLORS, sellVehicle, TRUCK, updateRoute, VEHICLE_KINDS } from '../../sim/vehicles';
import { h } from '../dom';
import { formatMoney, formatNumber } from '../format';
import { createWindow } from '../window';
import type { PanelDef } from './index';
import './routes.css';

/** The slice of the GameController this panel needs (lets tests use a small stub). */
type Host = Pick<GameController, 'ctx' | 'tools' | 'renderer' | 'setTool' | 'onToolChange'>;

type Kind = Route['kind'];

interface Draft {
  kind: Kind;
  stops: RouteStop[];
  name: string;
  buyFirst: boolean;
}

const CATEGORY_ICON = { extractor: '⛏️', factory: '🏭', retail: '🏪', logistics: '📦' } as const;

const buildingName = (b: Building | undefined): string => (b ? (BUILDINGS[b.typeId]?.name ?? b.typeId) : 'Missing building');
const buildingIcon = (b: Building | undefined): string => (b ? (CATEGORY_ICON[BUILDINGS[b.typeId]?.category] ?? '🏭') : '❔');

function routeTrucks(state: GameState, routeId: number) {
  return Object.values(state.vehicles).filter((v) => v.routeId === routeId && v.ownerId === 'player');
}

/** Words, icon and price for the vehicles of a route kind. */
const KIND_INFO = {
  truck: { one: 'truck', many: 'trucks', icon: '🚚', cost: TRUCK.cost, way: 'road', buy: buyTruck },
  train: { one: 'train', many: 'trains', icon: '🚂', cost: TRAIN.cost, way: 'track', buy: buyTrain },
} as const;

/** Access tiles for a stop of a route kind (road for trucks, rail for trains). */
function stopAccess(state: GameState, b: Building, kind: Kind) {
  return VEHICLE_KINDS[kind]?.access(state, b) ?? [];
}

/** Human-readable problems with a route, most serious first. */
export function routeWarnings(state: GameState, route: Route): string[] {
  const out: string[] = [];
  const info = KIND_INFO[route.kind] ?? KIND_INFO.truck;
  const bs = route.stops.map((s) => state.buildings[s.buildingId]);
  if (route.stops.length < 2) out.push('needs at least two stops');
  if (bs.some((b) => !b)) out.push('a stop building is gone');
  if (bs.some((b) => b && stopAccess(state, b, route.kind).length === 0)) {
    out.push(route.kind === 'train' ? 'a station has no rail access' : 'a stop has no road access');
  }
  else if (bs.every((b) => b)) {
    const legs = bs.length === 2 ? 1 : bs.length;
    for (let i = 0; i < legs && bs.length >= 2; i++) {
      const a = bs[i] as Building;
      const b = bs[(i + 1) % bs.length] as Building;
      if (legLength(state, a, b, route.kind) === null) {
        out.push(`no ${info.way} between ${buildingName(a)} and ${buildingName(b)}`);
        break;
      }
    }
  }
  const stuck = routeTrucks(state, route.id).filter((v) => v.state === 'stuck').length;
  if (stuck > 0) out.push(`${info.many} stuck: ${stuck}`);
  if (routeTrucks(state, route.id).length === 0) out.push(`no ${info.many} assigned`);
  return out;
}

/** Singleton panel instance (the window is a singleton too); reset when the window closes. */
class RoutesPanel {
  private readonly root = h('div', { class: 'rt' });
  private selected: number | null = null;
  private draft: Draft | null = null;
  private confirmDelete: number | null = null;
  private confirmTimer = 0;
  private readonly offs: (() => void)[] = [];
  private timer = 0;

  constructor(private readonly game: Host) {
    createWindow({ id: 'routes', title: 'Routes', content: this.root, width: 440, onClose: () => this.dispose() });
    this.offs.push(game.onToolChange((t) => {
      if (t.kind !== 'pickStop' && this.draft) this.endDraft(false);
    }));
    const onKey = (e: KeyboardEvent) => {
      if (this.draft && e.key === 'Enter' && !isTyping(e.target)) {
        e.preventDefault();
        this.saveDraft();
      }
    };
    window.addEventListener('keydown', onKey);
    this.offs.push(() => window.removeEventListener('keydown', onKey));
    this.timer = window.setInterval(() => {
      // never rebuild under a focused text field
      if (!this.root.contains(document.activeElement) || !isTyping(document.activeElement)) this.render();
    }, 1000);
    this.render();
  }

  private get ctx() {
    return this.game.ctx;
  }

  private get state(): GameState {
    return this.game.ctx.state;
  }

  private toast(message: string, tone: 'info' | 'good' | 'bad' = 'bad'): void {
    this.ctx.bus.emit({ type: 'toast', message, tone });
  }

  private dispose(): void {
    if (this.draft) this.endDraft(false);
    this.game.renderer.setSelection(null);
    for (const off of this.offs) off();
    clearInterval(this.timer);
    clearTimeout(this.confirmTimer);
    current = null;
  }

  // ------------------------------------------------------------------ draft

  private startDraft(kind: Kind = 'truck'): void {
    const n = Object.keys(this.state.routes).length + 1;
    this.draft = { kind, stops: [], name: kind === 'train' ? `Line ${n}` : `Route ${n}`, buyFirst: true };
    this.selected = null;
    this.game.tools.onPick = (id) => this.pick(id);
    this.game.setTool({ kind: 'pickStop', routeId: null });
    this.syncSelection();
    this.render();
  }

  private pick(id: number): void {
    const d = this.draft;
    const b = this.state.buildings[id];
    if (!d || !b) return;
    if (b.ownerId !== 'player') return this.toast('Not your building');
    if (d.kind === 'train') {
      if (b.typeId !== STATION_TYPE) return this.toast('Trains only stop at train stations');
      if (stopAccess(this.state, b, 'train').length === 0) return this.toast(`${buildingName(b)} has no rail access`);
    } else if (stopAccess(this.state, b, 'truck').length === 0) return this.toast(`${buildingName(b)} has no road access`);
    if (d.stops[d.stops.length - 1]?.buildingId === id) return;
    d.stops = appendStop(this.state, d.stops, id);
    this.syncSelection();
    this.render();
  }

  private syncSelection(): void {
    const d = this.draft;
    if (d) {
      this.game.renderer.setSelection({ draftRoute: { color: ROUTE_COLORS[0], stops: d.stops } });
    } else if (this.selected !== null && this.state.routes[this.selected]) {
      this.game.renderer.setSelection({ routeId: this.selected });
    } else {
      this.game.renderer.setSelection(null);
    }
  }

  /** Leaves pick mode. `switchTool` also returns to the inspect tool (not needed when the tool already changed). */
  private endDraft(switchTool: boolean): void {
    this.draft = null;
    this.game.tools.onPick = null;
    if (switchTool) this.game.setTool({ kind: 'inspect' });
    this.syncSelection();
    this.render();
  }

  private saveDraft(): void {
    const d = this.draft;
    if (!d) return;
    if (d.stops.length < 2) return this.toast('Pick at least two of your buildings first');
    const name = d.name.trim() || 'Route';
    const r = createRoute(this.ctx, 'player', name, d.stops, d.kind);
    if (!r.ok) return this.toast(r.error);
    const info = KIND_INFO[d.kind];
    if (d.buyFirst) {
      const t = info.buy(this.ctx, 'player', r.value.id);
      if (!t.ok) this.toast(`${name} created, but no ${info.one}: ${t.error}`);
      else this.toast(`${name} created with a ${info.one}`, 'good');
    } else this.toast(`${name} created`, 'good');
    this.selected = r.value.id;
    this.endDraft(true);
    this.syncSelection();
  }

  // ------------------------------------------------------------------ actions

  private select(id: number): void {
    this.selected = this.selected === id ? null : id;
    this.confirmDelete = null;
    this.syncSelection();
    this.render();
  }

  private editStops(route: Route, stops: RouteStop[]): void {
    const r = updateRoute(this.ctx, route.id, { stops });
    if (!r.ok) this.toast(r.error);
    this.render();
  }

  private truckPlus(route: Route): void {
    const r = (KIND_INFO[route.kind] ?? KIND_INFO.truck).buy(this.ctx, 'player', route.id);
    if (!r.ok) this.toast(r.error);
    this.render();
  }

  private truckMinus(route: Route): void {
    const trucks = routeTrucks(this.state, route.id);
    const last = trucks[trucks.length - 1];
    if (last) sellVehicle(this.ctx, last.id);
    this.render();
  }

  private deleteClick(route: Route): void {
    if (this.confirmDelete !== route.id) {
      this.confirmDelete = route.id;
      clearTimeout(this.confirmTimer);
      this.confirmTimer = window.setTimeout(() => {
        this.confirmDelete = null;
        this.render();
      }, 4000);
      this.render();
      return;
    }
    clearTimeout(this.confirmTimer);
    this.confirmDelete = null;
    const r = deleteRoute(this.ctx, route.id);
    if (!r.ok) this.toast(r.error);
    else this.toast(`${route.name} deleted`, 'info');
    this.selected = null;
    this.syncSelection();
    this.render();
  }

  // ------------------------------------------------------------------ views

  private render(): void {
    const body = this.draft ? this.draftView(this.draft) : this.listView();
    this.root.replaceChildren(body);
  }

  private listView(): HTMLElement {
    const routes = Object.values(this.state.routes).filter((r) => r.ownerId === 'player');
    if (this.selected !== null && !routes.some((r) => r.id === this.selected)) this.selected = null;
    return h(
      'div',
      null,
      h('div', { class: 'rt-top' },
        h('button', { class: 'btn', 'data-act': 'new', onClick: () => this.startDraft('truck') }, '+ New route'),
        ' ',
        h('button', {
          class: 'btn',
          'data-act': 'new-train',
          title: 'A train line between your train stations (lay rail first)',
          onClick: () => this.startDraft('train'),
        }, '+ New rail line')),
      routes.length === 0 && h('p', { class: 'rt-empty' },
        'No routes yet. Press New route, then click your buildings on the map in the order trucks should visit them. Rail lines link train stations joined by track.'),
      routes.map((r) => this.routeCard(r)),
    );
  }

  private routeCard(route: Route): HTMLElement {
    const state = this.state;
    const open = this.selected === route.id;
    const trucks = routeTrucks(state, route.id);
    const warnings = routeWarnings(state, route);
    const names = route.stops.map((s) => buildingName(state.buildings[s.buildingId])).join(' → ');
    const thr = routeThroughput(state, route.id);
    const nameInput = h('input', {
      class: 'rt-name',
      type: 'text',
      value: route.name,
      maxlength: 32,
      'aria-label': 'Route name',
      onClick: (e: Event) => e.stopPropagation(),
      onChange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value.trim();
        if (v) updateRoute(this.ctx, route.id, { name: v });
        this.render();
      },
    });
    const head = h('div', { class: 'rt-head', onClick: () => this.select(route.id) },
      h('span', { class: 'rt-swatch', style: { background: route.color } }),
      h('div', { class: 'rt-title' },
        nameInput,
        h('div', { class: 'rt-stops-line', title: names }, names || 'no stops')),
      h('div', { class: 'rt-stat' },
        h('b', null, `${trucks.length} ${(KIND_INFO[route.kind] ?? KIND_INFO.truck).icon}`),
        h('span', null, `~${formatNumber(thr)}/mo`)));
    const children: (HTMLElement | false)[] = [head];
    if (warnings.length > 0) {
      children.push(h('ul', { class: 'rt-warn' }, warnings.map((w) => h('li', null, `⚠ ${w}`))));
    }
    if (open) children.push(this.routeDetail(route, trucks.length));
    return h('div', { class: `rt-card${open ? ' open' : ''}`, 'data-route': route.id }, children);
  }

  private routeDetail(route: Route, trucks: number): HTMLElement {
    const confirming = this.confirmDelete === route.id;
    const info = KIND_INFO[route.kind] ?? KIND_INFO.truck;
    const refund = routeTrucks(this.state, route.id).length * info.cost * 0.5;
    return h(
      'div',
      { class: 'rt-detail' },
      route.stops.map((s, i) =>
        this.stopRow(s, i, route.stops.length, (next) => this.editStops(route, next), route.stops)),
      h('div', { class: 'rt-actions' },
        h('span', { class: 'rt-trucks' },
          h('button', { class: 'btn rt-sq', 'data-act': 'truck-minus', title: `Sell last ${info.one} (50% refund)`, disabled: trucks === 0, onClick: () => this.truckMinus(route) }, '−'),
          ` ${trucks} ${trucks === 1 ? info.one : info.many} `,
          h('button', { class: 'btn rt-sq', 'data-act': 'truck-plus', title: `Buy a ${info.one} (${formatMoney(info.cost)})`, onClick: () => this.truckPlus(route) }, '+'),
          h('small', null, ` ${formatMoney(info.cost)} each`)),
        h('button', {
          class: `btn rt-del${confirming ? ' confirm' : ''}`,
          'data-act': 'delete',
          onClick: () => this.deleteClick(route),
        }, confirming ? `Really delete? (+${formatMoney(refund)})` : 'Delete route')),
    );
  }

  private draftView(d: Draft): HTMLElement {
    const nameInput = h('input', {
      class: 'rt-name',
      type: 'text',
      value: d.name,
      maxlength: 32,
      'aria-label': 'Route name',
      onInput: (e: Event) => {
        d.name = (e.target as HTMLInputElement).value;
      },
    });
    return h(
      'div',
      null,
      h('p', { class: 'rt-hint' },
        d.stops.length === 0
          ? d.kind === 'train'
            ? 'Click your train stations on the map in the order the train should visit them. Each needs track alongside.'
            : 'Click your buildings on the map in the order trucks should visit them.'
          : `Keep clicking ${d.kind === 'train' ? 'stations' : 'buildings'} to add stops. Enter saves, Esc cancels.`),
      h('div', { class: 'rt-draft-name' }, 'Name ', nameInput),
      d.stops.map((s, i) =>
        this.stopRow(s, i, d.stops.length, (next) => {
          d.stops = next;
          this.syncSelection();
          this.render();
        }, d.stops)),
      h('label', { class: 'rt-buy' },
        h('input', {
          type: 'checkbox',
          'data-act': 'buy-first',
          checked: d.buyFirst,
          onClick: (e: Event) => {
            d.buyFirst = (e.target as HTMLInputElement).checked;
          },
        }),
        ` Buy first ${KIND_INFO[d.kind].one} (${formatMoney(KIND_INFO[d.kind].cost)})`),
      h('div', { class: 'rt-actions' },
        h('button', { class: 'btn', 'data-act': 'done', onClick: () => this.saveDraft() }, 'Done'),
        h('button', { class: 'btn rt-cancel', 'data-act': 'cancel', onClick: () => this.endDraft(true) }, 'Cancel')),
    );
  }

  private chips(kind: 'load' | 'unload', stop: RouteStop, goods: GoodId[], commit: (next: GoodId[]) => void): HTMLElement {
    const all = [...new Set([...goods, ...stop[kind]])];
    return h(
      'div',
      { class: 'rt-chips' },
      h('span', { class: 'rt-chip-label' }, kind === 'load' ? 'Load' : 'Unload'),
      all.length === 0 && h('span', { class: 'rt-none' }, kind === 'load' ? 'nothing to load here' : 'nothing accepted here'),
      all.map((g) => {
        const on = stop[kind].includes(g);
        const def = GOODS[g];
        return h('button', {
          class: `rt-chip${on ? ' on' : ''}`,
          'data-chip': `${kind}:${g}`,
          title: `${on ? 'Stop' : 'Start'} ${kind === 'load' ? 'loading' : 'unloading'} ${def?.name ?? g}`,
          'aria-pressed': on ? 'true' : 'false',
          onClick: () => commit(on ? stop[kind].filter((x) => x !== g) : [...stop[kind], g]),
        }, def?.icon ?? g);
      }),
    );
  }

  private stopRow(
    stop: RouteStop,
    i: number,
    n: number,
    commit: (stops: RouteStop[]) => void,
    stops: RouteStop[],
  ): HTMLElement {
    const b = this.state.buildings[stop.buildingId];
    const set = (patch: Partial<RouteStop>) =>
      commit(stops.map((s, j) => (j === i ? { ...s, ...patch } : { ...s })));
    const move = (to: number) => {
      const next = stops.map((s) => ({ ...s }));
      [next[i], next[to]] = [next[to], next[i]];
      commit(next);
    };
    // goods that other stops load are also worth offering for unloading here
    const others = stops.filter((_, j) => j !== i).flatMap((s) => s.load);
    const loadGoods = b ? offeredGoods(b) : [];
    const unloadGoods = b ? acceptedGoods(b).filter((g) => (BUILDINGS[b.typeId].category === 'logistics' ? others.includes(g) : true)) : [];
    return h(
      'div',
      { class: 'rt-stop', 'data-i': i },
      h('div', { class: 'rt-stop-head' },
        h('span', { class: 'rt-num' }, i + 1),
        h('span', { class: 'rt-bicon' }, buildingIcon(b)),
        h('span', { class: 'rt-bname' }, buildingName(b)),
        h('span', { class: 'rt-ctl' },
          h('button', { class: 'rt-mini', 'data-act': 'up', title: 'Move earlier', disabled: i === 0, onClick: () => move(i - 1) }, '↑'),
          h('button', { class: 'rt-mini', 'data-act': 'down', title: 'Move later', disabled: i === n - 1, onClick: () => move(i + 1) }, '↓'),
          h('button', { class: 'rt-mini', 'data-act': 'remove', title: 'Remove stop', onClick: () => commit(stops.filter((_, j) => j !== i).map((s) => ({ ...s }))) }, '✕'))),
      this.chips('load', stop, loadGoods, (load) => set({ load })),
      this.chips('unload', stop, unloadGoods, (unload) => set({ unload })),
    );
  }
}

let current: RoutesPanel | null = null;

export const routesPanel: PanelDef = {
  id: 'routes',
  open(game: GameController) {
    if (current) {
      createWindow({ id: 'routes', title: 'Routes', content: h('div') }); // raises the existing window
      return;
    }
    current = new RoutesPanel(game);
  },
};
