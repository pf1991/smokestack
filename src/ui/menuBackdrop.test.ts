// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const made: { cityLabels: boolean }[] = [];
vi.mock('../render/world', () => ({
  WorldRenderer: class {
    cityLabels = true;
    constructor() {
      made.push(this);
    }
    attachEffects() {
      return () => {};
    }
    render() {}
  },
}));

const { MenuBackdrop } = await import('./menuBackdrop');

describe('MenuBackdrop', () => {
  it('draws no town labels (a town name would sit under the title)', () => {
    const b = new MenuBackdrop(document.createElement('canvas'), 7);
    b.destroy();
    expect(made).toHaveLength(1);
    expect(made[0].cityLabels).toBe(false);
  });
});
