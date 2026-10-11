import { GOODS } from '../../data/goods';
import type { GameController } from '../../game/controller';
import type { GameState, Route, Vehicle } from '../../sim/types';
import { assignVehicle, sellVehicle, tripsLast30, VEHICLE_KINDS } from '../../sim/vehicles';
import { h } from '../dom';
import { formatMoney, formatNumber } from '../format';
import { createWindow } from '../window';
import type { PanelDef } from './index';
import './fleet.css';

/** The slice of the GameController this panel needs (lets tests use a small stub). */
type Host = Pick<GameController, 'ctx' | 'renderer' | 'centerOn' | 'openPanel'> & { follow?: GameController['follow'] };

export type FleetFilter = 'all' | 'truck' | 'train' | 'problem';

const FILTERS: { id: FleetFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'truck', label: 'Trucks' },
  { id: 'train', label: 'Trains' },
  { id: 'problem', label: '⚠ Idle or stuck' },
];

export const STATUS_LABEL = { moving: 'Driving', loading: 'Loading', idle: 'Idle', stuck: 'Stuck' } as const;
const SELL_REFUND = 0.5;

const playerVehicles = (state: GameState): Vehicle[] =>
  Object.values(state.vehicles)
    .filter((v) => v.ownerId === 'player')
    .sort((a, b) => a.id - b.id);

const isProblem = (v: Vehicle): boolean => v.state === 'idle' || v.state === 'stuck';

/** Vehicles shown under a filter (exported for tests). */
export function filterVehicles(vehicles: Vehicle[], f: FleetFilter): Vehicle[] {
  switch (f) {
    case 'truck':
    case 'train':
      return vehicles.filter((v) => v.kind === f);
    case 'problem':
      return vehicles.filter(isProblem);
    default:
      return vehicles;
  }
}

/** "12 trucks · 2 trains · 2 idle · 1 stuck · $X/mo upkeep". */
export function fleetSummary(state: GameState): string {
  const vs = playerVehicles(state);
  const n = (k: Vehicle['kind']) => vs.filter((v) => v.kind === k).length;
  const trucks = n('truck');
  const trains = n('train');
  const idle = vs.filter((v) => v.state === 'idle').length;
  const stuck = vs.filter((v) => v.state === 'stuck').length;
  const upkeep = vs.reduce((sum, v) => sum + (VEHICLE_KINDS[v.kind]?.spec.maintenance ?? 0), 0);
  return `${trucks} ${trucks === 1 ? 'truck' : 'trucks'} · ${trains} ${trains === 1 ? 'train' : 'trains'} · ${idle} idle · ${stuck} stuck · ${formatMoney(upkeep)}/mo upkeep`;
}

export function cargoLabel(v: Vehicle): string {
  const items = Object.entries(v.cargo).filter(([, q]) => q > 0.5);
  if (items.length === 0) return 'Empty';
  return items.map(([g, q]) => `${GOODS[g]?.icon ?? g} ${formatNumber(q)}`).join(' ');
}

const playerRoutes = (state: GameState, kind: Vehicle['kind']): Route[] =>
  Object.values(state.routes).filter((r) => r.ownerId === 'player' && r.kind === kind);

/** Fills a route dropdown for a vehicle; returns the signature of the options shown. */
export function routeOptions(state: GameState, v: Vehicle): { value: string; label: string }[] {
  return [{ value: '', label: '— no route —' }, ...playerRoutes(state, v.kind).map((r) => ({ value: String(r.id), label: r.name }))];
}

interface Row {
  vehicle: Vehicle;
  el: HTMLElement;
  select: HTMLSelectElement;
  optSig: string;
  status: HTMLElement;
  cargo: HTMLElement;
  trips: HTMLElement;
}

class FleetPanel {
  private readonly root = h('div', { class: 'fl' });
  private filter: FleetFilter = 'all';
  private readonly summary = h('div', { class: 'fl-summary' });
  private readonly filterBar = h('div', { class: 'fl-filters' });
  private readonly body = h('div', { class: 'fl-body' });
  private readonly empty = h('p', { class: 'fl-empty' }, 'No vehicles to show.');
  private readonly rows = new Map<number, Row>();
  private listSig = '\0';
  private timer = 0;

  constructor(private readonly game: Host) {
    for (const f of FILTERS) {
      this.filterBar.append(
        h('button', {
          class: 'btn fl-filter',
          'data-filter': f.id,
          onClick: () => {
            this.filter = f.id;
            this.update();
          },
        }, f.label),
      );
    }
    this.root.append(
      this.summary,
      this.filterBar,
      h('div', { class: 'fl-head' }, h('span'), h('span', null, 'Route'), h('span', null, 'Status'), h('span', null, 'Cargo'), h('span', { title: 'Completed unloading stops in the last 30 days' }, 'Trips'), h('span')),
      this.body,
    );
    createWindow({ id: 'fleet', title: 'Fleet', content: this.root, width: 560, onClose: () => this.dispose() });
    this.timer = window.setInterval(() => this.update(), 1000);
    this.update();
  }

  private get ctx() {
    return this.game.ctx;
  }

  private dispose(): void {
    clearInterval(this.timer);
    current = null;
  }

  private toast(message: string, tone: 'info' | 'good' | 'bad'): void {
    this.ctx.bus.emit({ type: 'toast', message, tone });
  }

  private makeRow(v: Vehicle): Row {
    const select = h('select', {
      class: 'fl-route',
      'aria-label': 'Route',
      onChange: () => {
        const cur = this.ctx.state.vehicles[v.id];
        if (!cur) return;
        const r = assignVehicle(this.ctx, v.id, select.value === '' ? null : Number(select.value));
        if (!r.ok) this.toast(r.error, 'bad');
        this.update();
      },
    }) as HTMLSelectElement;
    const status = h('span', { class: 'fl-status' });
    const cargo = h('span', { class: 'fl-cargo' });
    const trips = h('span', { class: 'fl-trips', title: 'Completed unloading stops in the last 30 days' });
    const el = h('div', { class: 'fl-row', 'data-vehicle': v.id },
      h('span', { class: 'fl-icon', title: v.kind === 'train' ? 'Train' : 'Truck' }, v.kind === 'train' ? '🚂' : '🚚'),
      select,
      status,
      cargo,
      trips,
      h('span', { class: 'fl-actions' },
        h('button', { class: 'btn fl-btn', 'data-act': 'locate', title: 'Pan the camera here and select it', onClick: () => this.locate(v.id) }, 'Locate'),
        h('button', { class: 'btn fl-btn fl-sell', 'data-act': 'sell', onClick: () => this.sell(v.id) }, 'Sell')));
    return { vehicle: v, el, select, optSig: '\0', status, cargo, trips };
  }

  private locate(id: number): void {
    const v = this.ctx.state.vehicles[id];
    if (!v) return;
    this.game.follow?.(null); // an explicit jump overrides camera follow
    this.game.centerOn({ x: v.pos.x, y: v.pos.y });
    this.game.renderer.setSelection({ vehicleId: id });
    this.game.openPanel('vehicle', id);
  }

  private sell(id: number): void {
    const v = this.ctx.state.vehicles[id];
    if (!v) return;
    const refund = (VEHICLE_KINDS[v.kind]?.spec.cost ?? 0) * SELL_REFUND;
    const r = sellVehicle(this.ctx, id);
    if (r.ok) this.toast(`Vehicle sold for ${formatMoney(refund)}`, 'good');
    else this.toast(r.error, 'bad');
    this.update();
  }

  /** Updates numbers and labels in place; the row list is rebuilt only when the set of rows changes. */
  update(): void {
    const state = this.ctx.state;
    const all = playerVehicles(state);
    const shown = filterVehicles(all, this.filter);
    const text = (el: HTMLElement, t: string) => {
      if (el.textContent !== t) el.textContent = t;
    };
    text(this.summary, fleetSummary(state));
    for (const b of this.filterBar.children) {
      b.classList.toggle('active', (b as HTMLElement).dataset.filter === this.filter);
    }
    const sig = shown.map((v) => v.id).join(',');
    if (sig !== this.listSig) {
      this.listSig = sig;
      const next = new Map<number, Row>();
      for (const v of shown) next.set(v.id, this.rows.get(v.id) ?? this.makeRow(v));
      this.rows.clear();
      for (const [id, row] of next) this.rows.set(id, row);
      this.body.replaceChildren(...(shown.length > 0 ? shown.map((v) => this.rows.get(v.id)!.el) : [this.empty]));
    }
    for (const v of shown) {
      const row = this.rows.get(v.id);
      if (!row) continue;
      row.vehicle = v;
      row.el.classList.toggle('problem', isProblem(v));
      text(row.status, STATUS_LABEL[v.state]);
      row.status.className = `fl-status st-${v.state}`;
      text(row.cargo, cargoLabel(v));
      text(row.trips, String(tripsLast30(state, v)));
      this.syncSelect(row, v);
    }
  }

  private syncSelect(row: Row, v: Vehicle): void {
    const opts = routeOptions(this.ctx.state, v);
    const sig = opts.map((o) => `${o.value}:${o.label}`).join('|');
    const focused = document.activeElement === row.select;
    if (sig !== row.optSig && !focused) {
      row.optSig = sig;
      row.select.replaceChildren(...opts.map((o) => h('option', { value: o.value }, o.label)));
    }
    const want = v.routeId === null ? '' : String(v.routeId);
    if (!focused && row.select.value !== want) row.select.value = want;
  }
}

let current: FleetPanel | null = null;

export const fleetPanel: PanelDef = {
  id: 'fleet',
  open(game: GameController) {
    if (current) {
      createWindow({ id: 'fleet', title: 'Fleet', content: h('div') }); // raises the existing window
      current.update();
      return;
    }
    current = new FleetPanel(game);
  },
};
