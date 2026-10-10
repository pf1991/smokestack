/**
 * TEMPORARY debug tool (Task 18). Task 20's route editor replaces it — delete this file and its
 * one-line mount in main.ts then.
 *
 * "Quick route" switches to the pickStop tool; click two or more of your buildings, press Enter, and
 * a truck route is created with suggested load/unload goods and one truck bought for it.
 */
import { BUILDINGS } from '../data/buildings';
import { buyTruck, createRoute } from '../sim/vehicles';
import { h } from '../ui/dom';
import { isTyping } from './input';
import type { GameController } from './controller';
import { suggestStops } from './routeSuggest';

export class QuickRoute {
  private picked: number[] = [];
  private active = false;
  private readonly button: HTMLButtonElement;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly game: GameController, root: HTMLElement) {
    this.button = h('button', {
      class: 'btn quick-route-debug',
      title: 'Debug tool until the route editor arrives: pick buildings, then Enter',
      style: {
        position: 'fixed',
        left: '12px',
        top: '76px',
        zIndex: '60',
        fontSize: '12px',
        padding: '4px 10px',
        border: '2px dashed #e8c75a',
        background: 'rgba(43, 29, 20, 0.92)',
        color: '#f3e9d2',
        cursor: 'pointer',
      },
      onClick: () => (this.active ? this.finish() : this.begin()),
    }) as HTMLButtonElement;
    root.appendChild(this.button);
    this.render();

    const onKey = (e: KeyboardEvent) => {
      if (!this.active || isTyping(e.target)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.finish();
      }
    };
    window.addEventListener('keydown', onKey);
    this.offs.push(() => window.removeEventListener('keydown', onKey));
    this.offs.push(game.onToolChange((t) => {
      if (t.kind !== 'pickStop' && this.active) this.reset();
    }));
  }

  private render(): void {
    if (!this.active) this.button.textContent = '🛠 DEBUG · Quick route';
    else {
      const names = this.picked.map((id) => BUILDINGS[this.game.state.buildings[id]?.typeId]?.name ?? '?');
      this.button.textContent = this.picked.length === 0
        ? '🛠 DEBUG · Click your buildings in order… (Esc cancels)'
        : `🛠 DEBUG · ${names.join(' → ')} — Enter or click to create`;
    }
  }

  private begin(): void {
    this.game.setTool({ kind: 'pickStop', routeId: null });
    this.active = true;
    this.picked = [];
    this.game.tools.onPick = (id) => this.pick(id);
    this.render();
  }

  private pick(id: number): void {
    const b = this.game.state.buildings[id];
    if (!b) return;
    if (b.ownerId !== 'player') {
      this.toast('Not your building', 'bad');
      return;
    }
    if (this.picked[this.picked.length - 1] === id) return;
    this.picked.push(id);
    this.game.renderer.setSelection({ buildingId: id });
    this.render();
  }

  private finish(): void {
    if (this.picked.length < 2) {
      this.toast('Pick at least two buildings for a route', 'bad');
      return;
    }
    const { ctx } = this.game;
    const stops = suggestStops(ctx.state, this.picked);
    const name = `Route ${Object.keys(ctx.state.routes).length + 1}`;
    const route = createRoute(ctx, 'player', name, stops);
    if (!route.ok) {
      this.toast(route.error, 'bad');
      return;
    }
    const truck = buyTruck(ctx, 'player', route.value.id);
    if (!truck.ok) this.toast(`${name} created, but no truck: ${truck.error}`, 'bad');
    else {
      const cargo = [...new Set(stops.flatMap((s) => s.load))].join(', ') || 'nothing yet';
      this.toast(`${name} created with one truck (carries ${cargo})`, 'good');
    }
    this.game.renderer.setSelection({ routeId: route.value.id });
    this.game.setTool({ kind: 'inspect' });
  }

  private reset(): void {
    this.active = false;
    this.picked = [];
    this.game.tools.onPick = null;
    this.render();
  }

  private toast(message: string, tone: 'info' | 'good' | 'bad'): void {
    this.game.ctx.bus.emit({ type: 'toast', message, tone });
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.button.remove();
  }
}
