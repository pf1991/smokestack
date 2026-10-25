// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TouchCoach, touchCoachText } from './touchCoach';

afterEach(() => {
  vi.unstubAllGlobals();
});

function coarse(on: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('pointer: coarse'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('touchCoachText', () => {
  it('is silent on desktop unless forced', () => {
    expect(touchCoachText({ kind: 'inspect' }, false, false)).toBeNull();
  });

  it('teaches map-first gestures when forced', () => {
    expect(touchCoachText({ kind: 'inspect' }, false, true)).toMatch(/Drag to move/);
    expect(touchCoachText({ kind: 'build', typeId: 'sawmill' }, false, true)).toMatch(/Tap the map to place/);
    expect(touchCoachText({ kind: 'road' }, false, true)).toMatch(/Tap one end/);
    expect(touchCoachText({ kind: 'road' }, true, true)).toMatch(/other end/);
  });
});

describe('TouchCoach Done', () => {
  it('shows Done while a sticky tool is armed and calls onDone', () => {
    coarse(true);
    const onDone = vi.fn();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const coach = new TouchCoach(root, onDone);
    coach.set({ kind: 'inspect' }, false);
    expect(coach.el.hidden).toBe(false);
    expect((root.querySelector('.touch-coach-done') as HTMLButtonElement).hidden).toBe(true);

    coach.set({ kind: 'build', typeId: 'sawmill' }, false);
    const done = root.querySelector('.touch-coach-done') as HTMLButtonElement;
    expect(coach.el.hidden).toBe(false);
    expect(done.hidden).toBe(false);
    expect(coach.el.classList.contains('touch-coach--armed')).toBe(true);
    done.click();
    expect(onDone).toHaveBeenCalledTimes(1);
    coach.destroy();
    root.remove();
  });
});
