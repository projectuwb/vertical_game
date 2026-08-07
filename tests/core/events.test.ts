import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/events.js';

interface Events {
  strokeFired: { class: 'Hane' | 'Tome' | 'Harai'; row: number };
  blotDied: { unitId: number };
}

describe('EventBus', () => {
  it('delivers payloads to a subscribed listener', () => {
    const bus = new EventBus<Events>();
    const received: Events['strokeFired'][] = [];
    bus.on('strokeFired', (payload) => received.push(payload));

    bus.emit('strokeFired', { class: 'Hane', row: 0 });
    bus.emit('strokeFired', { class: 'Tome', row: 1 });

    expect(received).toEqual([
      { class: 'Hane', row: 0 },
      { class: 'Tome', row: 1 },
    ]);
  });

  it('supports multiple listeners on the same event', () => {
    const bus = new EventBus<Events>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('blotDied', a);
    bus.on('blotDied', b);

    bus.emit('blotDied', { unitId: 7 });

    expect(a).toHaveBeenCalledWith({ unitId: 7 });
    expect(b).toHaveBeenCalledWith({ unitId: 7 });
  });

  it('keeps event streams independent', () => {
    const bus = new EventBus<Events>();
    const strokeListener = vi.fn();
    const blotListener = vi.fn();
    bus.on('strokeFired', strokeListener);
    bus.on('blotDied', blotListener);

    bus.emit('strokeFired', { class: 'Harai', row: 2 });

    expect(strokeListener).toHaveBeenCalledTimes(1);
    expect(blotListener).not.toHaveBeenCalled();
  });

  it('off() unsubscribes a listener', () => {
    const bus = new EventBus<Events>();
    const listener = vi.fn();
    bus.on('blotDied', listener);
    bus.off('blotDied', listener);

    bus.emit('blotDied', { unitId: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('the unsubscribe function returned by on() works', () => {
    const bus = new EventBus<Events>();
    const listener = vi.fn();
    const unsubscribe = bus.on('blotDied', listener);
    unsubscribe();

    bus.emit('blotDied', { unitId: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('emitting an event with no listeners is a silent no-op', () => {
    const bus = new EventBus<Events>();
    expect(() => bus.emit('strokeFired', { class: 'Hane', row: 0 })).not.toThrow();
  });

  it('clear() removes every listener for every event', () => {
    const bus = new EventBus<Events>();
    const strokeListener = vi.fn();
    const blotListener = vi.fn();
    bus.on('strokeFired', strokeListener);
    bus.on('blotDied', blotListener);

    bus.clear();
    bus.emit('strokeFired', { class: 'Hane', row: 0 });
    bus.emit('blotDied', { unitId: 1 });

    expect(strokeListener).not.toHaveBeenCalled();
    expect(blotListener).not.toHaveBeenCalled();
  });
});
