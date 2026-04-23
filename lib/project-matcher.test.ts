import { describe, it, expect } from 'bun:test';
import { matchProjectByTicket } from './project-matcher.js';

const projects = [
  { id: 'p1', name: 'Rocket', ticketPrefixes: ['RST', 'RS'] },
  { id: 'p2', name: 'Boost', ticketPrefixes: ['BST'] },
  { id: 'p3', name: 'Misc' },
];

describe('matchProjectByTicket', () => {
  it('returns matching project by prefix', () => {
    expect(matchProjectByTicket('RST-100', projects)?.id).toBe('p1');
    expect(matchProjectByTicket('BST-9', projects)?.id).toBe('p2');
  });

  it('is case-insensitive on prefix match', () => {
    expect(matchProjectByTicket('rst-100', projects)?.id).toBe('p1');
  });

  it('returns null when no prefix matches', () => {
    expect(matchProjectByTicket('ZZZ-1', projects)).toBeNull();
  });

  it('returns null when ticket is null', () => {
    expect(matchProjectByTicket(null, projects)).toBeNull();
  });

  it('ignores projects without ticketPrefixes', () => {
    expect(matchProjectByTicket('MISC-1', projects)).toBeNull();
  });
});
