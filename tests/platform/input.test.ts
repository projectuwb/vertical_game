import { describe, expect, it } from 'vitest';
import { InputSampler } from '../../src/platform/input.js';

type Handler = (event: unknown) => void;

/** Minimal EventTarget stand-in — no jsdom dependency (TECH_SPEC.md §2 keeps devDeps
 * to the listed set), just enough surface for InputSampler's addEventListener usage. */
class FakeEventTarget {
  private readonly handlers = new Map<string, Set<Handler>>();

  addEventListener(type: string, handler: Handler): void {
    let set = this.handlers.get(type);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
  }

  removeEventListener(type: string, handler: Handler): void {
    this.handlers.get(type)?.delete(handler);
  }

  dispatch(type: string, event: unknown): void {
    const set = this.handlers.get(type);
    if (set === undefined) return;
    for (const handler of Array.from(set)) handler(event);
  }
}

function noop(): void {
  /* stands in for a real Event's preventDefault */
}

function pointerEvent(pointerId: number, clientX: number): unknown {
  return { pointerId, clientX, preventDefault: noop };
}

function keyEvent(code: string): unknown {
  return { code, preventDefault: noop };
}

function makeSampler(): { sampler: InputSampler; target: FakeEventTarget; doc: FakeEventTarget } {
  const target = new FakeEventTarget();
  const doc = new FakeEventTarget();
  const sampler = new InputSampler(
    target as unknown as HTMLElement,
    doc as unknown as Document,
  );
  return { sampler, target, doc };
}

const DT = 1 / 60;

describe('InputSampler', () => {
  it('converts a pointer drag to lateralDelta in world units (0.028 units/px)', () => {
    const { sampler, target, doc } = makeSampler();
    target.dispatch('pointerdown', pointerEvent(1, 100));
    doc.dispatch('pointermove', pointerEvent(1, 150)); // +50px
    doc.dispatch('pointermove', pointerEvent(1, 130)); // -20px

    const frame = sampler.sample(DT);

    expect(frame.lateralDelta).toBeCloseTo(30 * 0.028, 9);
    expect(frame.holding).toBe(true);
    expect(frame.dtFixed).toBe(DT);
  });

  it('resets the accumulated delta after each sample()', () => {
    const { sampler, target, doc } = makeSampler();
    target.dispatch('pointerdown', pointerEvent(1, 0));
    doc.dispatch('pointermove', pointerEvent(1, 100));
    const first = sampler.sample(DT);
    const second = sampler.sample(DT);

    expect(first.lateralDelta).toBeCloseTo(100 * 0.028, 9);
    expect(second.lateralDelta).toBe(0);
  });

  it('holding goes false after pointerup', () => {
    const { sampler, target, doc } = makeSampler();
    target.dispatch('pointerdown', pointerEvent(1, 0));
    expect(sampler.sample(DT).holding).toBe(true);
    doc.dispatch('pointerup', pointerEvent(1, 0));
    expect(sampler.sample(DT).holding).toBe(false);
  });

  it('ignores a second simultaneous pointer', () => {
    const { sampler, target, doc } = makeSampler();
    target.dispatch('pointerdown', pointerEvent(1, 0));
    target.dispatch('pointerdown', pointerEvent(2, 500));
    doc.dispatch('pointermove', pointerEvent(2, 900)); // should be ignored — pointer 2 never "owned" control
    doc.dispatch('pointermove', pointerEvent(1, 40));

    const frame = sampler.sample(DT);
    expect(frame.lateralDelta).toBeCloseTo(40 * 0.028, 9);
  });

  it('keyboard: ArrowLeft/KeyA move negative, ArrowRight/KeyD move positive, at 14 u/s', () => {
    const { sampler, doc } = makeSampler();
    doc.dispatch('keydown', keyEvent('ArrowRight'));
    expect(sampler.sample(DT).lateralDelta).toBeCloseTo(14 * DT, 9);
    doc.dispatch('keyup', keyEvent('ArrowRight'));

    doc.dispatch('keydown', keyEvent('KeyA'));
    expect(sampler.sample(DT).lateralDelta).toBeCloseTo(-14 * DT, 9);
  });

  it('holding both left and right keys cancels lateral movement', () => {
    const { sampler, doc } = makeSampler();
    doc.dispatch('keydown', keyEvent('ArrowLeft'));
    doc.dispatch('keydown', keyEvent('ArrowRight'));
    expect(sampler.sample(DT).lateralDelta).toBe(0);
  });

  it('Space is a hold-to-Flourish input independent of the pointer', () => {
    const { sampler, doc } = makeSampler();
    doc.dispatch('keydown', keyEvent('Space'));
    expect(sampler.sample(DT).holding).toBe(true);
    doc.dispatch('keyup', keyEvent('Space'));
    expect(sampler.sample(DT).holding).toBe(false);
  });

  it('dispose() stops responding to further events', () => {
    const { sampler, target, doc } = makeSampler();
    sampler.dispose();
    target.dispatch('pointerdown', pointerEvent(1, 0));
    doc.dispatch('keydown', keyEvent('ArrowRight'));

    const frame = sampler.sample(DT);
    expect(frame.holding).toBe(false);
    expect(frame.lateralDelta).toBe(0);
  });
});
