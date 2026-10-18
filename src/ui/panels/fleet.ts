import { GOODS } from '../../data/goods';
import './panels.css';
import type { GameController } from '../../game/controller';
import type { GameState, Route, Vehicle } from '../../sim/types';
import { assignVehicle, replaceCost, replaceVehicle, sellRefund, sellVehicle, tripsLast30, upgradeRouteTrucks, vehicleUpkeep } from '../../sim/vehicles';
import { hasNewerModel, modelRow, newestModel } from '../../sim/logistics/models';
import { assetAge, assetEfficiency } from '../../sim/society/aging';
import type { IconId } from '../../render/icons';
import { h } from '../dom';
import { iconEl } from '../icon';
import { formatMoney, formatNumber } from '../format';
import { COMPACT_WIDTH, createWindow } from '../window';
import type { PanelDef } from './index';
import './fleet.css';

/** The slice of the GameController this panel needs (lets tests use a small stub). */
type Host = Pick<GameController, 'ctx' | 'renderer' | 'centerOn' | 'openPanel'> & { follow?: GameController['follow'] };

export type FleetFilter = 'all' | 'truck' | 'train' | 'problem';

const FILTERS: { id: FleetFilter; label: string; icon?: IconId }[] = [
  { id: 'all', label: 'All' },
  { id: 'truck', label: 'Trucks' },
  { id: 'train', label: 'Trains' },
  { id: 'problem', label: 'Idle or stuck', icon: 'warning' },
];

export const STATUS_LABEL = { moving: 'Driving', loading: 'Loading', idle: 'Idle', stuck: 'Stuck' } as const;

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
  const upkeep = vs.reduce((sum, v) => sum + vehicleUpkeep(state, v), 0);
  return `${trucks} ${trucks === 1 ? 'truck' : 'trucks'} · ${trains} ${trains === 1 ? 'train' : 'trains'} · ${idle} idle · ${stuck} stuck · ${formatMoney(upkeep)}/mo upkeep`;
}

/** Cargo as icon + quantity pairs ("Empty" when nothing aboard); `sig` changes only when the display would. */
export function cargoView(v: Vehicle): { sig: string; nodes: (string | HTMLElement)[] } {
  const items = Object.entries(v.cargo).filter(([, q]) => q > 0.5);
  if (items.length === 0) return { sig: '', nodes: ['Empty'] };
  return {
    sig: items.map(([g, q]) => `${g}:${formatNumber(q)}`).join(','),
    nodes: items.flatMap(([g, q], i) => [i > 0 ? ' ' : '', iconEl(g, 16, GOODS[g]?.name ?? g), ` ${formatNumber(q)}`]),
  };
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
  model: HTMLElement;
  cargo: HTMLElement;
  trips: HTMLElement;
  age: HTMLElement;
  replace: HTMLButtonElement;
}

/** "41 yr" with the efficiency when it has started to slip (exported for tests). */
export function ageText(state: GameState, v: Vehicle): string {
  const age = assetAge(state, v);
  const eff = assetEfficiency(state, v);
  return eff < 1 ? `${age} yr · ${Math.round(eff * 100)}%` : `${age} yr`;
}

class FleetPanel {
  private readonly root = h('div', { class: 'fl' });
  private filter: FleetFilter = 'all';
  private routeFilter: number | null = null;
  private readonly summary = h('div', { class: 'fl-summary' });
  private readonly filterBar = h('div', { class: 'fl-filters' });
  private readonly routeSel = h('select', {
    class: 'fl-route-filter',
    'aria-label': 'Route filter',
    onChange: () => {
      this.routeFilter = this.routeSel.value === '' ? null : Number(this.routeSel.value);
      this.update();
    },
  }) as HTMLSelectElement;
  private routeSig = '\0';
  private readonly upgradeBtn = h('button', { class: 'btn fl-btn', 'data-act': 'upgrade-route', onClick: () => this.upgradeRoute() }, 'Upgrade all trucks on this route') as HTMLButtonElement;
  private readonly body = h('div', { class: 'p-section fl-body' });
  private readonly empty = h('p', { class: 'fl-empty' }, 'No vehicles to show.');
  private readonly rows = new Map<number, Row>();
  private listSig = '\0';
  private timer = 0;

  constructor(private readonly game: Host) {
    // compact viewports cap windows at 420px: drop cargo and trips, actions on a second line (fleet.css)
    if (window.innerWidth <= COMPACT_WIDTH) this.root.classList.add('fl-compact');
    for (const f of FILTERS) {
      this.filterBar.append(
        h('button', {
          class: 'btn fl-filter',
          'data-filter': f.id,
          onClick: () => {
            this.filter = f.id;
            this.update();
          },
        }, f.icon && iconEl(f.icon, 14), f.icon ? ` ${f.label}` : f.label),
      );
    }
    this.root.append(
      h('div', { class: 'p-section' }, this.summary, this.filterBar, h('div', { class: 'fl-routebar' }, this.routeSel, this.upgradeBtn)),
      h('div', { class: 'fl-head' }, h('span'), h('span', null, 'Route'), h('span', null, 'Status'), h('span', null, 'Model'), h('span', null, 'Cargo'), h('span', { title: 'Completed unloading stops in the last 30 days' }, 'Trips'), h('span', { title: 'Years since bought; old vehicles run slower and cost more to keep' }, 'Age'), h('span')),
      this.body,
    );
    createWindow({ id: 'fleet', title: 'Fleet', content: this.root, width: 740, onClose: () => this.dispose() });
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
    const model = h('span', { class: 'fl-model' });
    const cargo = h('span', { class: 'fl-cargo' });
    const trips = h('span', { class: 'fl-trips', title: 'Completed unloading stops in the last 30 days' });
    const age = h('span', { class: 'fl-age' });
    const replace = h('button', { class: 'btn fl-btn', 'data-act': 'replace', onClick: () => this.replace(v.id) }, 'Replace') as HTMLButtonElement;
    const el = h('div', { class: 'fl-row', 'data-vehicle': v.id },
      h('span', { class: 'fl-icon', title: v.kind === 'train' ? 'Train' : 'Truck' }, iconEl(v.kind === 'train' ? 'train' : 'truck', 16, v.kind === 'train' ? 'Train' : 'Truck')),
      select,
      status,
      model,
      cargo,
      trips,
      age,
      h('span', { class: 'fl-actions' },
        h('button', { class: 'btn fl-btn', 'data-act': 'locate', title: 'Pan the camera here and select it', onClick: () => this.locate(v.id) }, 'Locate'),
        replace,
        h('button', { class: 'btn fl-btn fl-sell', 'data-act': 'sell', onClick: () => this.sell(v.id) }, 'Sell')));
    return { vehicle: v, el, select, optSig: '\0', status, model, cargo, trips, age, replace };
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
    const refund = sellRefund(this.ctx.state, v);
    const r = sellVehicle(this.ctx, id);
    if (r.ok) this.toast(`Vehicle sold for ${formatMoney(refund)}`, 'good');
    else this.toast(r.error, 'bad');
    this.update();
  }

  /** Sells the vehicle and buys a new one for its route (sim/vehicles.ts replaceVehicle). */
  private replace(id: number): void {
    const v = this.ctx.state.vehicles[id];
    if (!v) return;
    const cost = replaceCost(this.ctx.state, v);
    const r = replaceVehicle(this.ctx, id, 'player');
    if (r.ok) this.toast(`${v.kind === 'train' ? 'Train' : 'Truck'} replaced for ${formatMoney(cost)}`, 'good');
    else this.toast(r.error, 'bad');
    this.update();
  }

  /** Replaces every older truck on the selected route with the newest model (sim/vehicles.ts upgradeRouteTrucks). */
  private upgradeRoute(): void {
    if (this.routeFilter === null) return;
    const r = upgradeRouteTrucks(this.ctx, this.routeFilter, 'player');
    if (!r.ok) this.toast(r.error, 'bad');
    else this.toast(r.value.replaced > 0 ? `${r.value.replaced} ${r.value.replaced === 1 ? 'truck' : 'trucks'} upgraded` : 'No truck could be upgraded', r.value.replaced > 0 ? 'good' : 'info');
    this.update();
  }

  /** Updates numbers and labels in place; the row list is rebuilt only when the set of rows changes. */
  update(): void {
    const state = this.ctx.state;
    const all = playerVehicles(state);
    this.syncRouteFilter(all);
    const shown = filterVehicles(all, this.filter).filter((v) => this.routeFilter === null || v.routeId === this.routeFilter);
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
      const cargo = cargoView(v);
      if (row.cargo.dataset.sig !== cargo.sig) {
        row.cargo.dataset.sig = cargo.sig;
        row.cargo.replaceChildren(...cargo.nodes);
      }
      text(row.model, modelRow(v.model).name);
      text(row.trips, String(tripsLast30(state, v)));
      text(row.age, ageText(state, v));
      const tip = `Sell and buy new for this route: ${formatMoney(replaceCost(state, v))} net`;
      if (row.replace.title !== tip) row.replace.title = tip;
      this.syncSelect(row, v);
    }
  }

  /** Route filter options (the player's routes) and the bulk-upgrade button, shown when a route is selected. */
  private syncRouteFilter(all: Vehicle[]): void {
    const state = this.ctx.state;
    const routes = Object.values(state.routes).filter((r) => r.ownerId === 'player').sort((a, b) => a.id - b.id);
    if (this.routeFilter !== null && !routes.some((r) => r.id === this.routeFilter)) this.routeFilter = null;
    const sig = routes.map((r) => `${r.id}:${r.name}`).join('|');
    if (sig !== this.routeSig) {
      this.routeSig = sig;
      this.routeSel.replaceChildren(h('option', { value: '' }, 'All routes'), ...routes.map((r) => h('option', { value: String(r.id) }, r.name)));
    }
    const want = this.routeFilter === null ? '' : String(this.routeFilter);
    if (this.routeSel.value !== want) this.routeSel.value = want;
    const older = this.routeFilter === null ? 0 : all.filter((v) => v.routeId === this.routeFilter && hasNewerModel(state, v.model)).length;
    const newest = modelRow(newestModel(state)).name;
    this.upgradeBtn.hidden = this.routeFilter === null;
    this.upgradeBtn.disabled = older === 0;
    this.upgradeBtn.title = older === 0 ? `Every truck here is already a ${newest}` : `${older} older ${older === 1 ? 'truck' : 'trucks'} on this route become ${newest}s`;
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
