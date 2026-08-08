import { describe, expect, it } from 'vitest';
import { computeDailySeed, dailyDayNumber, formatDailyShareText } from '../../src/meta/dailySeed.js';

describe('computeDailySeed', () => {
  it('is deterministic: the same UTC calendar day always produces the same seed', () => {
    const morning = new Date('2026-08-08T00:00:01Z');
    const night = new Date('2026-08-08T23:59:59Z');
    expect(computeDailySeed(morning)).toBe(computeDailySeed(night));
  });

  it('differs across UTC calendar days', () => {
    const today = new Date('2026-08-08T12:00:00Z');
    const tomorrow = new Date('2026-08-09T12:00:00Z');
    expect(computeDailySeed(today)).not.toBe(computeDailySeed(tomorrow));
  });

  it('is a non-negative 32-bit integer, valid as a seed anywhere Date.now() is used today', () => {
    const seed = computeDailySeed(new Date('2026-08-08T12:00:00Z'));
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });

  it('crossing local-time midnight but not UTC midnight does not change the seed (this is a UTC day, not a local one)', () => {
    // 2026-08-08T23:30 UTC and 2026-08-09T00:30 UTC are different *local* dates in many
    // timezones but the same instant-adjacent UTC day only for the first — this instead
    // checks the inverse framing directly: two timestamps squarely inside the same UTC
    // calendar day, regardless of what local wall-clock date they'd show as.
    const a = new Date('2026-08-08T01:00:00Z');
    const b = new Date('2026-08-08T22:00:00Z');
    expect(computeDailySeed(a)).toBe(computeDailySeed(b));
  });
});

describe('dailyDayNumber', () => {
  it('is the Unix epoch on 1970-01-01', () => {
    expect(dailyDayNumber(new Date('1970-01-01T00:00:00Z'))).toBe(0);
  });

  it('increases by exactly 1 across a UTC day boundary', () => {
    const before = dailyDayNumber(new Date('2026-08-08T23:59:59Z'));
    const after = dailyDayNumber(new Date('2026-08-09T00:00:01Z'));
    expect(after).toBe(before + 1);
  });

  it('stays the same within one UTC day', () => {
    const a = dailyDayNumber(new Date('2026-08-08T00:00:00Z'));
    const b = dailyDayNumber(new Date('2026-08-08T23:59:59Z'));
    expect(a).toBe(b);
  });
});

describe('formatDailyShareText', () => {
  it('includes the day number, distance, peak Line, seals broken, and death cause', () => {
    const text = formatDailyShareText({
      dayNumber: 20670,
      distanceU: 243.7,
      peakLine: 12,
      sealsBroken: 2,
      deathCauseText: 'A Gate cost too much',
    });
    expect(text).toContain('Day #20670');
    expect(text).toContain('243u');
    expect(text).toContain('Peak Line 12');
    expect(text).toContain('2 Seals broken');
    expect(text).toContain('A Gate cost too much');
  });

  it('floors the distance rather than rounding', () => {
    const text = formatDailyShareText({
      dayNumber: 1,
      distanceU: 99.9,
      peakLine: 1,
      sealsBroken: 0,
      deathCauseText: 'Overrun',
    });
    expect(text).toContain('99u');
  });

  it('uses singular "Seal" for exactly one, plural otherwise', () => {
    const one = formatDailyShareText({ dayNumber: 1, distanceU: 0, peakLine: 1, sealsBroken: 1, deathCauseText: 'x' });
    const zero = formatDailyShareText({ dayNumber: 1, distanceU: 0, peakLine: 1, sealsBroken: 0, deathCauseText: 'x' });
    const many = formatDailyShareText({ dayNumber: 1, distanceU: 0, peakLine: 1, sealsBroken: 3, deathCauseText: 'x' });
    expect(one).toContain('1 Seal broken');
    expect(one).not.toContain('1 Seals broken');
    expect(zero).toContain('0 Seals broken');
    expect(many).toContain('3 Seals broken');
  });
});
