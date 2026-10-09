import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './events';

describe('EventBus', () => {
  it('on receives only its type', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('yearEnd', fn);
    bus.emit({ type: 'buildingRemoved', buildingId: 1 });
    bus.emit({ type: 'yearEnd', year: 1901 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ type: 'yearEnd', year: 1901 });
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('yearEnd', fn);
    off();
    bus.emit({ type: 'yearEnd', year: 1901 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('onAny sees everything', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.onAny(fn);
    bus.emit({ type: 'yearEnd', year: 1901 });
    bus.emit({ type: 'toast', message: 'hi', tone: 'info' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('unsubscribing during emit is safe', () => {
    const bus = new EventBus();
    const second = vi.fn();
    const off = bus.on('yearEnd', () => off());
    bus.on('yearEnd', second);
    bus.emit({ type: 'yearEnd', year: 1901 });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
