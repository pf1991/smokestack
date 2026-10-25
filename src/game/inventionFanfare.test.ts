// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/events';
import { clearStamps } from '../ui/juice';
import { tabForUnlock } from '../ui/toolbar';
import { testCtx } from '../sim/testkit';
import { attachInventionFanfare } from './feedback';

afterEach(() => clearStamps());

describe('tabForUnlock', () => {
  it('maps buildings and goods to build-bar tabs', () => {
    expect(tabForUnlock('oil_well')).toBe('extract');
    expect(tabForUnlock('refinery')).toBe('refine');
    expect(tabForUnlock('electronics_works')).toBe('components');
    expect(tabForUnlock('phonographs')).toBe('manufacture');
    expect(tabForUnlock('microchips')).toBe('components');
    expect(tabForUnlock('cars')).toBe('manufacture');
  });
});

describe('attachInventionFanfare', () => {
  it('toasts, stamps, and pulses Manufacture for a consumer-good invention', () => {
    const ui = document.createElement('div');
    ui.id = 'ui';
    document.body.appendChild(ui);
    const ctx = testCtx();
    const seen: Extract<GameEvent, { type: 'toast' }>[] = [];
    ctx.bus.on('toast', (e) => seen.push(e));
    const pulsed: string[] = [];
    const opened: string[] = [];
    attachInventionFanfare(ctx, {
      pulseTab: (t) => pulsed.push(t),
      openTab: (t) => opened.push(t),
    });
    ctx.bus.emit({ type: 'unlock', defId: 'phonographs', kind: 'good' });
    expect(seen).toHaveLength(1);
    expect(seen[0].tone).toBe('good');
    expect(seen[0].message).toMatch(/phonograph/i);
    expect(seen[0].action?.label).toBe('Open Manufacture');
    expect(pulsed).toEqual(['manufacture']);
    expect(ui.querySelectorAll('.stamp').length).toBe(1);
    seen[0].action!.run();
    expect(opened).toEqual(['manufacture']);
    ui.remove();
  });

  it('dedupes shared headlines (oil_well then refinery) and pulses Extract once', () => {
    const ctx = testCtx();
    const seen: Extract<GameEvent, { type: 'toast' }>[] = [];
    ctx.bus.on('toast', (e) => seen.push(e));
    const pulsed: string[] = [];
    attachInventionFanfare(ctx, { pulseTab: (t) => pulsed.push(t) });
    ctx.bus.emit({ type: 'unlock', defId: 'oil_well', kind: 'building' });
    ctx.bus.emit({ type: 'unlock', defId: 'refinery', kind: 'building' });
    expect(seen).toHaveLength(1);
    expect(pulsed).toEqual(['extract']);
  });

  it('ignores unlocks without an invention story', () => {
    const ctx = testCtx();
    const seen: Extract<GameEvent, { type: 'toast' }>[] = [];
    ctx.bus.on('toast', (e) => seen.push(e));
    attachInventionFanfare(ctx);
    ctx.bus.emit({ type: 'unlock', defId: 'sawmill', kind: 'building' });
    expect(seen).toHaveLength(0);
  });
});
