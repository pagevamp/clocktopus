import { describe, it, expect } from 'bun:test';
import { extractTicket } from './branch-parser.js';

describe('extractTicket', () => {
  it('returns ticket from plain ticket branch', () => {
    expect(extractTicket('RST-100')).toBe('RST-100');
  });

  it('returns ticket from feature/RST-100 branch', () => {
    expect(extractTicket('feature/RST-100-add-login')).toBe('RST-100');
  });

  it('returns ticket from bugfix/abc-123 lowercase (normalizes to uppercase)', () => {
    expect(extractTicket('bugfix/abc-123-fix')).toBe('ABC-123');
  });

  it('returns null when no ticket pattern present', () => {
    expect(extractTicket('feature/login')).toBeNull();
  });

  it('returns null for main/master/develop', () => {
    expect(extractTicket('main')).toBeNull();
    expect(extractTicket('master')).toBeNull();
    expect(extractTicket('develop')).toBeNull();
  });

  it('returns first match when multiple tickets in branch', () => {
    expect(extractTicket('RST-1-and-RST-2')).toBe('RST-1');
  });

  it('handles alphanumeric project key (ABC2-7)', () => {
    expect(extractTicket('ABC2-7-work')).toBe('ABC2-7');
  });

  it('returns null for empty string', () => {
    expect(extractTicket('')).toBeNull();
  });
});
