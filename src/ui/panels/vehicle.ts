import { BUILDINGS } from '../../data/buildings';
import { getGood } from '../../data/goods';
import type { GameController } from '../../game/controller';
import { assignVehicle, replaceCost, replaceVehicle, sellRefund, sellVehicle } from '../../sim/vehicles';
import { fitKit, hasNewerModel, kitCost, kitRefusal, modelRow, newestModel, type KitId } from '../../sim/logistics/models';
import { assetAge, assetEfficiency } from '../../sim/society/aging';
import { HUB_VALUE, routeOptions } from './fleet';
import { hubTarget } from '../../sim/logistics/jobRoute';
import type { HubJob } from '../../sim/logistics/types';
import type { Vehicle } from '../../sim/types';
import { h } from '../dom';
import { formatMoney, formatNumber } from '../format';
import './panels.css';
import { openInspector, setMeter, setOwnerBadge, setText, swap, type InspectorHost, type InspectorView } from './inspect';
import { meter, panelHeader, pill, section, type Tone } from '../kit';
import type { PanelDef } from './index';

const STATE_LABEL = { moving: 'Driving', loading: 'Loading / unloading', stuck: 'Stuck — no path', idle: 'Idle' } as const;
const STATE_TONE: Record<Vehicle['state'], Tone> = { moving: 'positive', loading: 'info', stuck: 'negative', idle: 'warning' };

const btnClass = (variant: 'primary' | 'secondary' | 'quiet' | 'danger', extra: string) => `btn kit-btn kit-btn--${variant} ${extra}`;

function buildView(host: InspectorHost, id: number): InspectorView {
  const headerBox = h('div', { class: 'insp-header' });
  const owner = h('span', { class: 'insp-badge' });
  const routePillBox = h('span', { class: 'insp-route-pill-box' });
  const game = host as unknown as GameController;
  const routeSel = h('select', {
    class: 'insp-route-sel',
    'aria-label': 'Route',
    onChange: () => {
      if (routeSel.value === HUB_VALUE) return; // already on its hub
      const r = assignVehicle(host.ctx, id, routeSel.value === '' ? null : Number(routeSel.value));
      if (!r.ok) host.ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
      view.update();
    },
  }) as HTMLSelectElement;
  let optSig = '\0';
  const follow = h('button', {
    class: btnClass('secondary', 'insp-follow'),
    type: 'button',
    'data-act': 'follow',
    'aria-pressed': 'false',
    title: 'Keep the camera on this vehicle (panning stops it)',
    onClick: () => {
      game.follow(game.followId === id ? null : id);
      view.update();
    },
  }, 'Follow');
  const next = h('span');
  const job = h('span');
  const cargoText = h('span', { class: 'insp-cargo-text' });
  const cargoMeter = meter(0, 1, { label: 'Cargo' });
  const cargo = h('div', { class: 'insp-cargo' }, h('div', { class: 'insp-cargo-line' }, h('span', { class: 'insp-label' }, 'Cargo'), cargoText), cargoMeter);
  const stat = (label: string, v: HTMLElement) => h('div', { class: 'p-row insp-stat' }, h('span', { class: 'insp-label' }, label), v);
  const jobRow = stat('Job', job);
  const routeRow = stat('Assign', routeSel);
  const sell = h('button', {
    class: btnClass('danger', 'insp-sell'),
    type: 'button',
    onClick: () => {
      const veh = host.ctx.state.vehicles[id];
      if (!veh) return;
      const refund = sellRefund(host.ctx.state, veh);
      const r = sellVehicle(host.ctx, id);
      host.ctx.bus.emit(
        r.ok
          ? { type: 'toast', message: `Vehicle sold for ${formatMoney(refund)}`, tone: 'good' }
          : { type: 'toast', message: r.error, tone: 'bad' },
      );
    },
  });
  const age = h('span');
  const kitRows = (['body', 'engine'] as const).map((kit) => {
    const label = kit === 'body' ? 'Bigger body' : 'Tuned engine';
    const effect = h('span', { class: 'insp-kit-effect' });
    const fit = h('button', {
      class: btnClass('secondary', 'insp-fit'),
      type: 'button',
      'data-kit': kit,
      onClick: () => {
        const r = fitKit(host.ctx, id, kit, 'player');
        if (!r.ok) host.ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
        view.update();
      },
    }) as HTMLButtonElement;
    return { kit, label, row: h('div', { class: 'p-row insp-stat insp-kit' }, h('span', { class: 'insp-label' }, label), h('span', { class: 'insp-kit-right' }, effect, fit)), effect, fit };
  });
  // sell and rebuy at today's price for the same route (sim/vehicles.ts replaceVehicle); the new vehicle has a new id
  const replace = h('button', {
    class: btnClass('secondary', 'insp-replace'),
    type: 'button',
    onClick: () => {
      const veh = host.ctx.state.vehicles[id];
      if (!veh) return;
      const r = replaceVehicle(host.ctx, id, 'player');
      host.ctx.bus.emit(
        r.ok
          ? { type: 'toast', message: `${veh.kind === 'train' ? 'Train' : 'Truck'} replaced`, tone: 'good' }
          : { type: 'toast', message: r.error, tone: 'bad' },
      );
    },
  });
  const kitSection = section('Kit', kitRows.map((k) => k.row));
  const view: InspectorView = {
    el: h('div', { class: 'insp insp-vehicle' },
      headerBox,
      h('div', { class: 'insp-head' }, owner, routePillBox),
      cargo,
      h('div', { class: 'p-section' }, routeRow, jobRow, stat('Next stop', next), stat('Age', age)),
      kitSection,
      h('div', { class: 'p-actions' }, follow, replace, sell)),
    update() {
      const s = host.ctx.state;
      const v = s.vehicles[id];
      if (!v) return false;
      const route = v.routeId !== null ? s.routes[v.routeId] : undefined;
      const stop = route?.stops[v.stopIndex];
      const hubbed = v.hubId != null;
      const targetId = hubbed ? hubTarget(v) : stop?.buildingId;
      const target = targetId != null ? s.buildings[targetId] : undefined;
      const modelName = modelRow(v.model).name;
      swap(headerBox, `${modelName}|${v.state}`, () => panelHeader({ title: modelName, summary: STATE_LABEL[v.state], tone: STATE_TONE[v.state], icon: v.kind }));
      setOwnerBadge(owner, s, v.ownerId);
      const opts = routeOptions(s, v);
      const routeName = hubbed ? (opts.find((o) => o.value === HUB_VALUE)?.label ?? 'Hub') : route ? route.name : 'No route';
      const color = !hubbed && route ? route.color : '';
      swap(routePillBox, `${routeName}|${color}`, () => {
        const p = pill(routeName, hubbed || route ? 'info' : 'warning', hubbed ? 'hub' : undefined);
        p.classList.add('insp-route-pill');
        p.title = hubbed || route ? `Route: ${routeName}` : 'Not on a route: assign one below';
        if (color) p.prepend(h('span', { class: 'swatch', style: { background: color } }));
        return p;
      });
      const sig = opts.map((o) => `${o.value}:${o.label}`).join('|');
      const focused = document.activeElement === routeSel;
      if (sig !== optSig && !focused) {
        optSig = sig;
        routeSel.replaceChildren(...opts.map((o) => h('option', { value: o.value }, o.label)));
      }
      const want = hubbed ? HUB_VALUE : v.routeId === null ? '' : String(v.routeId);
      if (!focused && routeSel.value !== want) routeSel.value = want;
      const mine = v.ownerId === 'player';
      routeRow.hidden = !mine;
      jobRow.hidden = !hubbed;
      if (hubbed) setText(job, jobText(v));
      const following = game.followId === id;
      follow.classList.toggle('active', following);
      follow.setAttribute('aria-pressed', String(following));
      setText(next, target ? `${BUILDINGS[target.typeId].name} #${target.id}` : '—');
      const items = Object.entries(v.cargo).filter(([, q]) => q > 0.5);
      const total = items.reduce((n, [, q]) => n + q, 0);
      const cargoLine = items.length > 0
        ? `${items.map(([g, q]) => `${formatNumber(q)} ${getGood(g).name}`).join(', ')} (${formatNumber(total)} / ${v.capacity})`
        : `Empty (0 / ${v.capacity})`;
      setText(cargoText, cargoLine);
      setMeter(cargoMeter, Math.round(total), v.capacity, 'neutral', `Cargo: ${cargoLine}`);
      sell.hidden = v.ownerId !== 'player';
      setText(sell, `Sell (+${formatMoney(sellRefund(s, v))})`);
      kitSection.hidden = v.kind !== 'truck';
      for (const k of kitRows) {
        k.row.hidden = v.kind !== 'truck';
        const fitted = v.kits?.[k.kit as KitId] === true;
        setText(k.effect, fitted ? 'Fitted' : k.kit === 'body' ? '+25% capacity' : '+15% speed');
        k.fit.hidden = fitted || v.ownerId !== 'player';
        k.fit.disabled = kitRefusal(s, v, k.kit, 'player') !== null;
        setText(k.fit, `Fit (${formatMoney(kitCost(s, v, k.kit))})`);
      }
      setText(age, `Bought ${v.builtYear} (age ${assetAge(s, v)}): ${Math.round(assetEfficiency(s, v) * 100)}% speed`);
      replace.hidden = v.ownerId !== 'player';
      setText(replace, hasNewerModel(s, v.model) ? `Replace with ${modelRow(newestModel(s)).name} ${formatMoney(replaceCost(s, v))}` : `Replace (${formatMoney(replaceCost(s, v))})`);
      return true;
    },
    dispose: () => {
      if (game.followId === id) game.follow(null);
    },
  };
  return view;
}

export const vehiclePanel: PanelDef = {
  id: 'vehicle',
  open(game, arg) {
    const host = game as unknown as InspectorHost;
    const id = Number(arg);
    const v = host.ctx.state.vehicles[id];
    if (!v) return;
    openInspector(host, {
      id: `vehicle-${id}`,
      title: v.kind === 'train' ? 'Train' : 'Truck',
      width: 320,
      selection: { vehicleId: id },
      build: () => buildView(host, id),
    });
  },
};

/** A hub truck's job in words: "Collect 20 Lumber", "Deliver 15 Bread", "Return home", or waiting. */
function jobText(v: Vehicle): string {
  const j = (v.job ?? null) as HubJob | null;
  if (!j) return 'Waiting at its hub';
  if (j.kind === 'return') return 'Return home';
  const verb = j.kind === 'collect' ? 'Collect' : j.kind === 'deliver' ? 'Deliver' : 'Balance';
  return `${verb} ${formatNumber(j.qty)} ${j.good ? getGood(j.good).name : ''}`.trim();
}
