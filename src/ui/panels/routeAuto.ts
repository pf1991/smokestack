import { clampMaxTrucks } from '../../sim/logistics/autoRoutes';
import type { Result } from '../../core/result';
import type { Route, SimContext } from '../../sim/types';
import { MIN_LOADS, updateRoute } from '../../sim/vehicles';
import { h } from '../dom';
import { buildingName } from './routeActions';

const DEFAULT_MAX_TRUCKS = 5;
const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * The route window's automation section (spec §6.5): the Manual / Auto switch, the auto-sizing row
 * (on or off, maximum trucks, last month's loaded share) and, on a manual route, a "Leave at"
 * select per stop that loads something. Every change goes through updateRoute.
 */
export function autoControls(host: { ctx: SimContext }, routeId: number): { el: HTMLElement; refresh(): void } {
  const el = h('div', { class: 'p-section rt-auto' });
  const route = (): Route | undefined => host.ctx.state.routes[routeId];

  const apply = (patch: Parameters<typeof updateRoute>[2]): void => {
    const r: Result = updateRoute(host.ctx, routeId, patch);
    if (!r.ok) host.ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
    refresh();
  };

  function refresh(): void {
    const r = route();
    if (!r) {
      el.replaceChildren();
      return;
    }
    const auto = r.mode === 'auto';
    const size = r.autoSize ?? { on: false, maxTrucks: DEFAULT_MAX_TRUCKS };
    const last = r.stats?.last;
    const rows: HTMLElement[] = [
      h('div', { class: 'p-head' }, 'Automation'),
      h('div', { class: 'p-row' },
        h('span', null, 'Mode'),
        h('button', {
          class: 'btn',
          'data-act': 'mode',
          'aria-pressed': auto ? 'true' : 'false',
          title: auto ? 'Trucks follow the stops as written' : 'Trucks pick the most valuable job among the stops each time they leave',
          onClick: () => apply({ mode: auto ? 'manual' : 'auto' }),
        }, auto ? 'Auto' : 'Manual')),
      h('div', { class: 'p-row' },
        h('label', null,
          h('input', {
            type: 'checkbox',
            'data-act': 'autosize',
            checked: size.on,
            onChange: (e: Event) => apply({ autoSize: { on: (e.target as HTMLInputElement).checked, maxTrucks: size.maxTrucks } }),
          }),
          ' Auto-size, at most '),
        h('input', {
          type: 'number',
          class: 'rt-max',
          'data-act': 'max-trucks',
          min: 1,
          max: 20,
          value: size.maxTrucks,
          'aria-label': 'Maximum trucks',
          onChange: (e: Event) => apply({ autoSize: { on: size.on, maxTrucks: clampMaxTrucks(Number((e.target as HTMLInputElement).value)) } }),
        }),
        h('span', null, ' trucks')),
      h('div', { class: 'p-row insp-muted', 'data-stat': 'util' }, last === undefined ? 'Last month: no departures' : `Last month: ${last}% loaded`),
    ];
    if (!auto) {
      r.stops.forEach((stop, i) => {
        if (stop.load.length === 0) return; // nothing to wait for where nothing is loaded
        rows.push(h('div', { class: 'p-row' },
          h('span', null, `Leave ${buildingName(host.ctx.state.buildings[stop.buildingId])} at`),
          h('select', {
            'data-act': 'minload',
            'data-i': i,
            'aria-label': `Leave stop ${i + 1} at`,
            onChange: (e: Event) => {
              const v = Number((e.target as HTMLSelectElement).value);
              const cur = route();
              if (!cur) return;
              apply({ stops: cur.stops.map((s, j) => (j === i ? { ...s, minLoad: v } : { ...s })) });
            },
          }, MIN_LOADS.map((m) => h('option', { value: String(m), selected: (stop.minLoad ?? 0) === m }, m === 0 ? 'any load' : `${pct(m)} full`)))));
      });
    }
    el.replaceChildren(...rows);
  }

  refresh();
  return { el, refresh };
}
