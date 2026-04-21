import { describe, it, expect } from 'bun:test';
import { isClockifyKeyValid } from './credentials.js';

describe('isClockifyKeyValid', () => {
  it('returns false when value is undefined', () => {
    expect(isClockifyKeyValid(undefined)).toBe(false);
  });

  it('returns false when value is an empty string', () => {
    expect(isClockifyKeyValid('')).toBe(false);
  });

  it('returns true when value is a non-empty string', () => {
    expect(isClockifyKeyValid('abc123')).toBe(true);
  });
});
