import { describe, expect, it } from 'vitest';
import { defaultDriftConfig as cfg, expectedPosition, planDrift } from './drift';

describe('expectedPosition', () => {
  it('advances while playing, using latency', () => {
    expect(expectedPosition({ position: 10, playing: true, rate: 1 }, 1000, 1500)).toBeCloseTo(10.5);
    expect(expectedPosition({ position: 10, playing: true, rate: 1.05 }, 0, 1000)).toBeCloseTo(11.05);
  });
  it('does not advance while paused', () => {
    expect(expectedPosition({ position: 10, playing: false, rate: 1 }, 0, 5000)).toBe(10);
  });
  it('clamps absurd clock skew', () => {
    expect(expectedPosition({ position: 10, playing: true, rate: 1 }, 0, 9e9)).toBe(20);
    expect(expectedPosition({ position: 10, playing: true, rate: 1 }, 5000, 0)).toBe(10);
  });
});

describe('planDrift', () => {
  it('ignores negligible drift', () => expect(planDrift(0.1, 1, cfg, 1e9).kind).toBe('none'));
  it('nudges rate for moderate drift, in the right direction', () => {
    const behind = planDrift(0.8, 1, cfg, 1e9);
    expect(behind.kind).toBe('rate');
    expect(behind.rate).toBeGreaterThan(1);
    expect(behind.rate).toBeLessThanOrEqual(1.08 + 1e-9);
    expect(planDrift(-0.8, 1, cfg, 1e9).rate).toBeLessThan(1);
  });
  it('hard-seeks on big drift, but not twice within the cooldown', () => {
    expect(planDrift(5, 1, cfg, 1e9).kind).toBe('seek');
    const cooled = planDrift(5, 1, cfg, 1000);
    expect(cooled.kind).toBe('rate');
    expect(cooled.rate).toBeCloseTo(1.08);
  });
});
