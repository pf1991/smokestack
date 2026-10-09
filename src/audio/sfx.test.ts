import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { Sfx } from './sfx';

function fakeFactory() {
  const log = { created: 0, oscStarts: 0, noiseStarts: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  });
  const node = () => ({ connect() {}, disconnect() {} });
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    destination: node(),
    state: 'running',
    resume() { return Promise.resolve(); },
    createGain: () => ({ ...node(), gain: param() }),
    createOscillator: () => ({
      ...node(), type: 'sine', frequency: param(), detune: param(),
      start() { log.oscStarts++; }, stop() {},
    }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => ({
      ...node(), buffer: null, loop: false,
      start() { log.noiseStarts++; }, stop() {},
    }),
  };
  const factory = () => { log.created++; return ctx as unknown as AudioContext; };
  return { factory, log };
}

describe('Sfx', () => {
  it('no context before first play', () => {
    const { factory, log } = fakeFactory();
    const sfx = new Sfx(factory);
    sfx.setVolume(0.5);
    expect(log.created).toBe(0);
    sfx.play('click');
    expect(log.created).toBe(1);
    expect(log.oscStarts).toBeGreaterThan(0);
  });

  it('muted plays nothing', () => {
    const { factory, log } = fakeFactory();
    const sfx = new Sfx(factory);
    sfx.setMuted(true);
    sfx.play('whistle');
    expect(log.oscStarts).toBe(0);
    expect(log.noiseStarts).toBe(0);
    sfx.setMuted(false);
    sfx.play('whistle');
    expect(log.oscStarts).toBeGreaterThan(0);
  });

  it('kaching throttled', () => {
    const { factory, log } = fakeFactory();
    let t = 10000;
    const sfx = new Sfx(factory, () => t);
    sfx.play('kaching');
    const first = log.oscStarts;
    expect(first).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) { t += 200; sfx.play('kaching'); }
    expect(log.oscStarts).toBe(first); // 5 sales within 1 s -> one sound
    t += 1000;
    sfx.play('kaching');
    expect(log.oscStarts).toBeGreaterThan(first);
  });

  it('attach maps events', () => {
    const { factory, log } = fakeFactory();
    const sfx = new Sfx(factory, () => 0);
    const bus = new EventBus();
    sfx.attach(bus);
    const played: string[] = [];
    const orig = sfx.play.bind(sfx);
    sfx.play = (n) => { played.push(n); orig(n); };
    bus.emit({ type: 'buildingRemoved', buildingId: 1 });
    bus.emit({ type: 'vehicleStuck', vehicleId: 1 });
    bus.emit({ type: 'toast', message: 'x', tone: 'bad' });
    bus.emit({ type: 'toast', message: 'x', tone: 'good' });
    bus.emit({ type: 'achievement', id: 'a' });
    bus.emit({ type: 'sale', cityId: 1, goodId: 'x' as never, qty: 1, revenue: 1, ownerId: 'player', buildingId: 1 });
    expect(played).toEqual(['demolish', 'horn', 'error', 'achievement', 'kaching']);
    expect(log.oscStarts).toBeGreaterThan(0);
  });

  it('ambience respects mute', () => {
    const { factory, log } = fakeFactory();
    const sfx = new Sfx(factory);
    sfx.setMuted(true);
    sfx.startAmbience();
    expect(log.noiseStarts).toBe(0);
    sfx.setMuted(false);
    expect(log.noiseStarts).toBe(1);
  });

  it('never throws when AudioContext is unavailable', () => {
    const sfx = new Sfx(() => { throw new Error('no audio'); });
    expect(() => sfx.play('click')).not.toThrow();
    expect(() => sfx.startAmbience()).not.toThrow();
    expect(() => sfx.setMuted(false)).not.toThrow();
  });

  it('attach returns a detach function', () => {
    const { factory, log } = fakeFactory();
    const sfx = new Sfx(factory, () => 0);
    const bus = new EventBus();
    const off = sfx.attach(bus);
    off();
    bus.emit({ type: 'achievement', id: 'a' });
    bus.emit({ type: 'buildingRemoved', buildingId: 1 });
    expect(log.created).toBe(0);
    expect(log.oscStarts).toBe(0);
  });

  it('only player sales ka-ching', () => {
    const { factory, log } = fakeFactory();
    const sfx = new Sfx(factory, () => 0);
    const bus = new EventBus();
    sfx.attach(bus);
    bus.emit({ type: 'sale', cityId: 1, goodId: 'x' as never, qty: 1, revenue: 1, ownerId: 'rival', buildingId: 1 });
    expect(log.oscStarts).toBe(0);
    bus.emit({ type: 'sale', cityId: 1, goodId: 'x' as never, qty: 1, revenue: 1, ownerId: 'player', buildingId: 1 });
    expect(log.oscStarts).toBeGreaterThan(0);
  });
});
