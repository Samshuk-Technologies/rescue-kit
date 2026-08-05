import { describe, expect, it } from 'vitest';
import { gradeFor, overallScore, scoreCategory, verdictFor } from '../src/engine/score.js';
import type { Finding, Severity } from '../src/types.js';

function finding(severity: Severity): Finding {
  return {
    ruleId: 'test/rule',
    title: 'Test',
    category: 'secrets',
    severity,
    detail: 'detail',
    remediation: 'remediation',
    effortHours: 1,
  };
}

describe('scoreCategory', () => {
  it('is 100 with no findings', () => {
    expect(scoreCategory([])).toBe(100);
  });

  it('penalises by severity', () => {
    expect(scoreCategory([finding('low')])).toBe(97);
    expect(scoreCategory([finding('medium')])).toBe(91);
    expect(scoreCategory([finding('high')])).toBe(78);
    expect(scoreCategory([finding('critical')])).toBe(50);
  });

  it('never goes below zero', () => {
    expect(scoreCategory(Array.from({ length: 10 }, () => finding('critical')))).toBe(0);
  });

  it('keeps a single critical out of passing range', () => {
    // The calibration that matters: one critical must dominate an otherwise clean category.
    expect(scoreCategory([finding('critical')])).toBeLessThan(60);
  });
});

describe('gradeFor', () => {
  it('maps scores to grades at the documented boundaries', () => {
    expect(gradeFor(100)).toBe('A');
    expect(gradeFor(90)).toBe('A');
    expect(gradeFor(89)).toBe('B');
    expect(gradeFor(75)).toBe('B');
    expect(gradeFor(74)).toBe('C');
    expect(gradeFor(60)).toBe('C');
    expect(gradeFor(59)).toBe('D');
    expect(gradeFor(40)).toBe('D');
    expect(gradeFor(39)).toBe('F');
    expect(gradeFor(0)).toBe('F');
  });
});

describe('overallScore', () => {
  it('ignores inapplicable categories instead of scoring them 100', () => {
    const withInapplicable = overallScore([
      { category: 'secrets', score: 50, applicable: true },
      { category: 'payments', score: 100, applicable: false },
    ]);

    expect(withInapplicable).toBe(50);
  });

  it('weights secrets and auth above testing', () => {
    const secretsBad = overallScore([
      { category: 'secrets', score: 0, applicable: true },
      { category: 'testing', score: 100, applicable: true },
    ]);
    const testingBad = overallScore([
      { category: 'secrets', score: 100, applicable: true },
      { category: 'testing', score: 0, applicable: true },
    ]);

    expect(secretsBad).toBeLessThan(testingBad);
  });

  it('returns 100 when nothing applies', () => {
    expect(overallScore([])).toBe(100);
  });
});

describe('verdictFor', () => {
  const none = { critical: 0, high: 0, medium: 0, low: 0 };

  it('leads with the critical count when there is one', () => {
    const verdict = verdictFor('C', { ...none, critical: 3 });
    expect(verdict).toContain('Not safe to ship');
    expect(verdict).toContain('3 critical');
  });

  it('pluralises a single critical correctly', () => {
    expect(verdictFor('C', { ...none, critical: 1 })).toContain('1 critical issue would');
  });

  it('describes grades without criticals in terms of readiness', () => {
    expect(verdictFor('A', none)).toContain('Production-ready');
    expect(verdictFor('F', none)).toContain('Not production-ready');
  });
});
