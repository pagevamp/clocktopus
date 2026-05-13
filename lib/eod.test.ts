import { describe, it, expect } from 'bun:test';
import { shouldFireEod, type EodState } from './eod.js';

const base: EodState = {
  enabled: true,
  time: '18:00',
  lastFiredDate: null,
  snoozeUntil: null,
  hasOpenSession: true,
};

// Mon 2026-05-11 17:59 local
const beforeTime = new Date(2026, 4, 11, 17, 59, 0);
// Mon 2026-05-11 18:00 local
const atTime = new Date(2026, 4, 11, 18, 0, 0);
// Mon 2026-05-11 18:30 local
const afterTime = new Date(2026, 4, 11, 18, 30, 0);
// Sat 2026-05-09 18:30 local
const weekend = new Date(2026, 4, 9, 18, 30, 0);

describe('shouldFireEod', () => {
  it('returns skip when disabled', () => {
    expect(shouldFireEod({ now: afterTime, state: { ...base, enabled: false } })).toBe('skip');
  });

  it('returns skip on Saturday', () => {
    expect(shouldFireEod({ now: weekend, state: base })).toBe('skip');
  });

  it('returns skip when before configured time', () => {
    expect(shouldFireEod({ now: beforeTime, state: base })).toBe('skip');
  });

  it('returns fire-primary at the configured time with open session', () => {
    expect(shouldFireEod({ now: atTime, state: base })).toBe('fire-primary');
  });

  it('returns fire-primary after the configured time with open session', () => {
    expect(shouldFireEod({ now: afterTime, state: base })).toBe('fire-primary');
  });

  it('returns skip-mark-fired when after time but no open session', () => {
    expect(shouldFireEod({ now: afterTime, state: { ...base, hasOpenSession: false } })).toBe('skip-mark-fired');
  });

  it('returns skip when already fired today', () => {
    expect(
      shouldFireEod({
        now: afterTime,
        state: { ...base, lastFiredDate: '2026-05-11' },
      }),
    ).toBe('skip');
  });

  it('returns skip when snooze pending and now < snoozeUntil', () => {
    const snoozeUntil = new Date(2026, 4, 11, 18, 45, 0).toISOString();
    expect(
      shouldFireEod({
        now: afterTime,
        state: { ...base, lastFiredDate: '2026-05-11', snoozeUntil },
      }),
    ).toBe('skip');
  });

  it('returns fire-snooze when snooze elapsed, same day, open session', () => {
    const snoozeUntil = new Date(2026, 4, 11, 18, 15, 0).toISOString();
    const now = new Date(2026, 4, 11, 18, 20, 0);
    expect(
      shouldFireEod({
        now,
        state: { ...base, lastFiredDate: '2026-05-11', snoozeUntil },
      }),
    ).toBe('fire-snooze');
  });

  it('returns skip-mark-fired when snooze elapsed but no open session', () => {
    const snoozeUntil = new Date(2026, 4, 11, 18, 15, 0).toISOString();
    const now = new Date(2026, 4, 11, 18, 20, 0);
    expect(
      shouldFireEod({
        now,
        state: { ...base, lastFiredDate: '2026-05-11', snoozeUntil, hasOpenSession: false },
      }),
    ).toBe('skip-mark-fired');
  });

  it('returns skip when snooze elapsed but date is yesterday', () => {
    const snoozeUntil = new Date(2026, 4, 10, 18, 15, 0).toISOString();
    const now = new Date(2026, 4, 11, 18, 20, 0);
    expect(
      shouldFireEod({
        now,
        state: { ...base, lastFiredDate: '2026-05-10', snoozeUntil },
      }),
    ).toBe('skip');
  });

  it('returns skip when time string is malformed', () => {
    expect(shouldFireEod({ now: afterTime, state: { ...base, time: 'oops' } })).toBe('skip');
  });

  it('returns skip when time is null', () => {
    expect(shouldFireEod({ now: afterTime, state: { ...base, time: null } })).toBe('skip');
  });

  it('returns skip on Sunday', () => {
    // Sun 2026-05-10 18:30 local
    const sunday = new Date(2026, 4, 10, 18, 30, 0);
    expect(shouldFireEod({ now: sunday, state: base })).toBe('skip');
  });

  it('returns skip when snoozeUntil is malformed', () => {
    expect(
      shouldFireEod({
        now: afterTime,
        state: { ...base, snoozeUntil: 'not-a-date' },
      }),
    ).toBe('skip');
  });
});
