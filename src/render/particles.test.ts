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

describe('particles', () => {
  it('particles expire', () => {
    const ps = new ParticleSystem();
    ps.emitSmoke(100, 100, 1);
    ps.emitFloatText(100, 100, '+$48', '#0f0');
    ps.emitSparks(100, 100);
    expect(ps.count()).toBeGreaterThan(0);
    ps.update(5000);
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
    for (let i = 0; i < 50; i++) ps.emitSmoke(0, 0, 0);
    expect(ps.count()).toBe(0);
  });

  it('density scales smoke emission', () => {
    const low = new ParticleSystem();
    const high = new ParticleSystem();
    for (let i = 0; i < 100; i++) {
      low.emitSmoke(0, 0, 0.2);
      high.emitSmoke(0, 0, 1);
    }
    expect(high.count()).toBeGreaterThan(low.count());
  });

  it('sparks emit 8 dots that last 0.6 s', () => {
    const ps = new ParticleSystem();
    ps.emitSparks(0, 0);
    expect(ps.count()).toBe(8);
    ps.update(500);
    expect(ps.count()).toBe(8);
    ps.update(200);
    expect(ps.count()).toBe(0);
  });

  it('float text rises 24 px over 1.2 s', () => {
    const ps = new ParticleSystem();
    ps.emitFloatText(100, 200, '+$48', '#0f0');
    ps.update(600);
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
