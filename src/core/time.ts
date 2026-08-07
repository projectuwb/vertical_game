// Wall-clock access, isolated so the rest of /core never touches `performance`
// or `Date` directly — keeps the loop's own logic testable with fabricated timestamps.

export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
