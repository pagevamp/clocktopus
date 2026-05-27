import { describe, it, expect } from 'bun:test';
import { worklogSecondsFromHours, groupTodoIssues } from './jira.js';

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

describe('groupTodoIssues', () => {
  const sample = {
    issues: [
      {
        key: 'ABC-1',
        fields: {
          summary: 'First',
          project: { key: 'ABC', name: 'Alpha' },
          timetracking: { originalEstimateSeconds: 7200, timeSpentSeconds: 3600 },
        },
      },
      {
        key: 'ABC-2',
        fields: {
          summary: 'Second',
          project: { key: 'ABC', name: 'Alpha' },
          timetracking: {},
        },
      },
      {
        key: 'XYZ-9',
        fields: {
          summary: 'Other',
          project: { key: 'XYZ', name: 'Xeno' },
          timetracking: { timeSpentSeconds: 1800 },
        },
      },
    ],
  };

  it('groups issues by project preserving first-seen order', () => {
    const groups = groupTodoIssues(sample);
    expect(groups.map((g) => g.projectKey)).toEqual(['ABC', 'XYZ']);
    expect(groups[0].projectName).toBe('Alpha');
    expect(groups[0].issues.map((i) => i.key)).toEqual(['ABC-1', 'ABC-2']);
  });

  it('extracts estimate/spent with null estimate and zero-spent defaults', () => {
    const groups = groupTodoIssues(sample);
    expect(groups[0].issues[0]).toMatchObject({ estimateSeconds: 7200, spentSeconds: 3600 });
    expect(groups[0].issues[1]).toMatchObject({ estimateSeconds: null, spentSeconds: 0 });
    expect(groups[1].issues[0]).toMatchObject({ estimateSeconds: null, spentSeconds: 1800 });
  });

  it('returns [] for null / malformed input', () => {
    expect(groupTodoIssues(null)).toEqual([]);
    expect(groupTodoIssues({})).toEqual([]);
    expect(groupTodoIssues({ issues: 'nope' })).toEqual([]);
  });

  it('skips issues missing key or project', () => {
    const bad = { issues: [{ key: 'NO-PROJ', fields: { summary: 's' } }, { fields: { project: { key: 'P' } } }] };
    expect(groupTodoIssues(bad)).toEqual([]);
  });

  it('falls back to projectKey when project.name is absent', () => {
    const input = { issues: [{ key: 'P-1', fields: { summary: 's', project: { key: 'PROJ' } } }] };
    const groups = groupTodoIssues(input);
    expect(groups).toHaveLength(1);
    expect(groups[0].projectName).toBe('PROJ');
  });

  it('skips issues with fields entirely absent without throwing', () => {
    const input = { issues: [{ key: 'NOFIELDS' }] };
    expect(groupTodoIssues(input)).toEqual([]);
  });
});
