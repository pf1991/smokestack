import { describe, expect, it } from 'vitest';
import { touchCoachText } from './touchCoach';

describe('touchCoachText', () => {
  it('is silent on desktop unless forced', () => {
    expect(touchCoachText({ kind: 'inspect' }, false, false)).toBeNull();
  });

  it('teaches map-first gestures when forced', () => {
    expect(touchCoachText({ kind: 'inspect' }, false, true)).toMatch(/Drag to move/);
    expect(touchCoachText({ kind: 'build', typeId: 'sawmill' }, false, true)).toMatch(/Tap to place/);
    expect(touchCoachText({ kind: 'road' }, false, true)).toMatch(/Tap one end/);
    expect(touchCoachText({ kind: 'road' }, true, true)).toMatch(/other end/);
  });
});
