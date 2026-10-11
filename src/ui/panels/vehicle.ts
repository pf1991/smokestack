import { BUILDINGS } from '../../data/buildings';
import { getGood } from '../../data/goods';
import type { GameController } from '../../game/controller';
import { assignVehicle, sellVehicle, VEHICLE_KINDS } from '../../sim/vehicles';
import { routeOptions } from './fleet';
import { h } from '../dom';
import { formatMoney, formatNumber } from '../format';
import './panels.css';
import { openInspector, setText, type InspectorHost, type InspectorView } from './inspect';
import type { PanelDef } from './index';

const STATE_LABEL = { moving: 'Driving', loading: 'Loading / unloading', stuck: 'Stuck — no path', idle: 'Idle' } as const;
const SELL_REFUND = 0.5;

function buildView(host: InspectorHost, id: number): InspectorView {
  const owner = h('span', { class: 'insp-badge' });
  const game = host as unknown as GameController;
  const routeSel = h('select', {
    class: 'insp-route-sel',
    'aria-label': 'Route',
    onChange: () => {
      const r = assignVehicle(host.ctx, id, routeSel.value === '' ? null : Number(routeSel.value));
      if (!r.ok) host.ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
      view.update();
    },
  }) as HTMLSelectElement;
  let optSig = '\0';
  const follow = h('button', {
    class: 'btn insp-follow',
    'data-act': 'follow',
    'aria-pressed': 'false',
    title: 'Keep the camera on this vehicle (panning stops it)',
    onClick: () => {
      game.follow(game.followId === id ? null : id);
      view.update();
    },
  }, 'Follow');
  const state = h('span');
  const next = h('span');
  const cargo = h('span');
  const stat = (label: string, v: HTMLElement) => h('div', { class: 'insp-stat' }, h('span', { class: 'insp-label' }, label), v);
  const sell = h('button', {
    class: 'btn insp-sell',
    onClick: () => {
      const veh = host.ctx.state.vehicles[id];
      if (!veh) return;
      const r = sellVehicle(host.ctx, id);
      const refund = (VEHICLE_KINDS[veh.kind]?.spec.cost ?? 0) * SELL_REFUND;
      host.ctx.bus.emit(
        r.ok
          ? { type: 'toast', message: `Vehicle sold for ${formatMoney(refund)}`, tone: 'good' }
          : { type: 'toast', message: r.error, tone: 'bad' },
      );
    },
  });
  const view: InspectorView = {
    el: h('div', { class: 'insp' }, h('div', { class: 'insp-head' }, owner), stat('Route', routeSel), stat('State', state), stat('Next stop', next), stat('Cargo', cargo), follow, sell),
    update() {
      const s = host.ctx.state;
      const v = s.vehicles[id];
      if (!v) return false;
      const route = v.routeId !== null ? s.routes[v.routeId] : undefined;
      const stop = route?.stops[v.stopIndex];
      const target = stop ? s.buildings[stop.buildingId] : undefined;
      setText(owner, v.ownerId === 'player' ? s.companies.player.name : s.companies.rival.name);
      owner.className = `insp-badge ${v.ownerId === 'player' ? 'owner-player' : 'owner-rival'}`;
      const opts = routeOptions(s, v);
      const sig = opts.map((o) => `${o.value}:${o.label}`).join('|');
      const focused = document.activeElement === routeSel;
      if (sig !== optSig && !focused) {
        optSig = sig;
        routeSel.replaceChildren(...opts.map((o) => h('option', { value: o.value }, o.label)));
      }
      const want = v.routeId === null ? '' : String(v.routeId);
      if (!focused && routeSel.value !== want) routeSel.value = want;
      routeSel.disabled = v.ownerId !== 'player';
      const following = game.followId === id;
      follow.classList.toggle('active', following);
      follow.setAttribute('aria-pressed', String(following));
      setText(state, STATE_LABEL[v.state]);
      setText(next, target ? `${BUILDINGS[target.typeId].name} #${target.id}` : '—');
      const items = Object.entries(v.cargo).filter(([, q]) => q > 0.5);
      const total = items.reduce((n, [, q]) => n + q, 0);
      setText(
        cargo,
        items.length > 0
          ? `${items.map(([g, q]) => `${getGood(g).icon} ${formatNumber(q)} ${getGood(g).name}`).join(', ')} (${formatNumber(total)} / ${v.capacity})`
          : `Empty (0 / ${v.capacity})`,
      );
      sell.hidden = v.ownerId !== 'player';
      setText(sell, `Sell (+${formatMoney((VEHICLE_KINDS[v.kind]?.spec.cost ?? 0) * SELL_REFUND)})`);
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
