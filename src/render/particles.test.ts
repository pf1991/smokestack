import { describe, it, expect, vi } from 'vitest';
import type { Camera } from './constants';
import { ParticleSystem } from './particles';

function fakeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    lineWidth: 1,
    textAlign: 'left',
    globalAlpha: 1,
  };
}

const cam: Camera = { x: 0, y: 0, zoom: 1, viewW: 800, viewH: 600 };
const asCtx = (c: ReturnType<typeof fakeCtx>) => c as unknown as CanvasRenderingContext2D;

/** update() clamps each step to 100 ms, so advance time in steps. */
function advance(ps: ParticleSystem, ms: number): void {
  for (let left = ms; left > 0; left -= 100) ps.update(Math.min(100, left));
}

describe('particles', () => {
  it('particles expire', () => {
    const ps = new ParticleSystem();
    ps.emitSmoke(100, 100, 1, 100);
    ps.emitFloatText(100, 100, '+$48', '#0f0');
    ps.emitSparks(100, 100);
    expect(ps.count()).toBeGreaterThan(0);
    advance(ps, 5000);
    expect(ps.count()).toBe(0);
  });

  it('cap respected', () => {
    const ps = new ParticleSystem();
    for (let i = 0; i < 2100; i++) ps.emitFloatText(i, i, '+$1', '#fff');
    expect(ps.count()).toBe(2000);
    for (let i = 0; i < 500; i++) ps.emitSparks(i, i);
    expect(ps.count()).toBe(2000);
  });

  it('density 0 emits no smoke', () => {
    const ps = new ParticleSystem();
    for (let i = 0; i < 50; i++) ps.emitSmoke(0, 0, 0, 100);
    expect(ps.count()).toBe(0);
  });

  it('density scales smoke emission', () => {
    const low = new ParticleSystem();
    const high = new ParticleSystem();
    for (let i = 0; i < 100; i++) {
      low.emitSmoke(0, 0, 0.2, 100);
      high.emitSmoke(0, 0, 1, 100);
    }
    expect(high.count()).toBeGreaterThan(low.count());
  });

  it('smoke emission is frame-rate independent', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const at60 = new ParticleSystem();
      for (let i = 0; i < 60; i++) at60.emitSmoke(0, 0, 1, 16.7);
      const at30 = new ParticleSystem();
      for (let i = 0; i < 30; i++) at30.emitSmoke(0, 0, 1, 33.3);
      expect(Math.abs(at60.count() - at30.count())).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('smoke emission rate matches SMOKE_RATE over real time', () => {
    // Low-discrepancy stand-in for Math.random so the sum tracks its expectation.
    let i = 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      i++;
      return (i * 0.6180339887) % 1;
    });
    try {
      const at60 = new ParticleSystem();
      for (let k = 0; k < 60; k++) at60.emitSmoke(0, 0, 1, 16.7);
      const at30 = new ParticleSystem();
      for (let k = 0; k < 30; k++) at30.emitSmoke(0, 0, 1, 33.3);
      // Expected 6 puffs per second of real time, so about 6 for each run.
      expect(Math.abs(at60.count() - 6)).toBeLessThanOrEqual(2);
      expect(Math.abs(at30.count() - 6)).toBeLessThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('smoke dt is clamped to 100 ms', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      const clamped = new ParticleSystem();
      clamped.emitSmoke(0, 0, 1, 100000);
      const normal = new ParticleSystem();
      normal.emitSmoke(0, 0, 1, 100);
      expect(clamped.count()).toBe(normal.count());
    } finally {
      spy.mockRestore();
    }
  });

  it('sparks emit 8 dots that last 0.6 s', () => {
    const ps = new ParticleSystem();
    ps.emitSparks(0, 0);
    expect(ps.count()).toBe(8);
    advance(ps, 500);
    expect(ps.count()).toBe(8);
    advance(ps, 200);
    expect(ps.count()).toBe(0);
  });

  it('float text rises 24 px over 1.2 s', () => {
    const ps = new ParticleSystem();
    ps.emitFloatText(100, 200, '+$48', '#0f0');
    advance(ps, 600);
    const ctx = fakeCtx();
    ps.draw(asCtx(ctx), cam);
    expect(ctx.fillText).toHaveBeenCalled();
    const [text, x, y] = ctx.fillText.mock.calls[0];
    expect(text).toBe('+$48');
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(200 - 12);
  });

  it('draw converts world to screen with camera and zoom', () => {
    const ps = new ParticleSystem();
    ps.emitFloatText(100, 200, '+$1', '#fff');
    const ctx = fakeCtx();
    ps.draw(asCtx(ctx), { x: 50, y: 100, zoom: 2, viewW: 800, viewH: 600 });
    const [, x, y] = ctx.fillText.mock.calls[0];
    expect(x).toBeCloseTo((100 - 50) * 2);
    expect(y).toBeCloseTo((200 - 100) * 2);
  });
});
