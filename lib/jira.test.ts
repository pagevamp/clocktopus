import { describe, it, expect } from 'bun:test';
import { worklogSecondsFromHours } from './jira.js';

describe('worklogSecondsFromHours', () => {
  it('converts hours to rounded seconds', () => {
    expect(worklogSecondsFromHours(2.5)).toBe(9000);
    expect(worklogSecondsFromHours(1)).toBe(3600);
  });

  it('rounds sub-second results, returning null when they round to 0', () => {
    expect(worklogSecondsFromHours(0.0001)).toBeNull(); // 0.36s rounds to 0
    expect(worklogSecondsFromHours(0.001)).toBe(4); // 3.6s rounds to 4
  });

  it('rejects non-positive, non-finite, and over-cap values', () => {
    expect(worklogSecondsFromHours(0)).toBeNull();
    expect(worklogSecondsFromHours(-3)).toBeNull();
    expect(worklogSecondsFromHours(NaN)).toBeNull();
    expect(worklogSecondsFromHours(Infinity)).toBeNull();
    expect(worklogSecondsFromHours(12.0001)).toBeNull(); // > 12h cap
  });

  it('accepts exactly the 12h cap', () => {
    expect(worklogSecondsFromHours(12)).toBe(43200);
  });
});
