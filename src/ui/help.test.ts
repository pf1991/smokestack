// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { closeHelp, openHelp, SYSTEMS_PRIMER, toggleHelp } from './help';

afterEach(() => closeHelp());

describe('help primer', () => {
  it('lists Extract → Refine → Components → Manufacture → Retail / Trade above hotkeys', () => {
    openHelp();
    const primer = document.querySelector('[data-help="primer"]') as HTMLElement;
    expect(primer).not.toBeNull();
    const steps = [...primer.querySelectorAll('strong')].map((s) => s.textContent);
    expect(steps).toEqual(SYSTEMS_PRIMER.map((s) => s.step));
    expect(steps).toEqual(['Extract', 'Refine', 'Components', 'Manufacture', 'Retail / Trade']);
    const pointers = document.querySelector('[data-help="pointers"]')!.textContent!;
    expect(pointers).toContain('Codex');
    expect(pointers).toContain('Alerts');
    expect(pointers).toMatch(/I/);
    expect(pointers).toMatch(/T/);
    // hotkeys still present below
    expect(document.querySelector('.help-card')!.textContent).toContain('Controls');
    const touch = document.querySelector('[data-help="touch"]')!.textContent!;
    expect(touch).toMatch(/Always pan/);
    expect(touch).toMatch(/Tap, tap/);
    expect(touch).toMatch(/Done/);
  });

  it('toggle opens and closes', () => {
    toggleHelp();
    expect(document.querySelector('.help-modal')).not.toBeNull();
    toggleHelp();
    expect(document.querySelector('.help-modal')).toBeNull();
  });
});
