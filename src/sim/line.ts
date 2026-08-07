// The Line: formation, growth, loss — Task 2.2 builds the full Line/Brush entity.
//
// The critically damped 1D follower below is laid down now (Task 1.5) because the
// lateral control response is part of /sim by construction: TECH_SPEC.md §4 requires
// the sim to consume raw InputFrame deltas and never touch the DOM, and a smoothing
// recurrence with persistent velocity state has to run once per fixed step to stay
// deterministic/replayable — so it belongs here, not in /platform. Task 2.2 wires this
// into the real Brush entity.

/** Persistent state for one critically damped 1D follower (e.g. the Brush's lateral position). */
export interface DampedFollower1D {
  readonly position: number;
  readonly velocity: number;
}

/**
 * Exact closed-form step of a critically damped spring-damper (no overshoot on a step
 * input) chasing `target`, with response speed set by time constant `tau` seconds
 * (GAME_DESIGN.md §3: "critically damped with a 70ms time constant"). Using the exact
 * exponential solution rather than a semi-implicit Euler step keeps it stable for any
 * dt/tau ratio, which matters since `tau` (70ms) is close to a single fixed step (16.7ms).
 */
export function stepCriticallyDamped(
  state: DampedFollower1D,
  target: number,
  dt: number,
  tau: number,
): DampedFollower1D {
  const omega = 1 / tau;
  const change = state.position - target;
  const c2 = state.velocity + omega * change;
  const factor = Math.exp(-omega * dt);
  const newPosition = target + (change + c2 * dt) * factor;
  const newVelocity = factor * (c2 * (1 - omega * dt) - omega * change);
  return { position: newPosition, velocity: newVelocity };
}
