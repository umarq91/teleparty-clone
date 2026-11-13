import { describe, expect, it } from 'vitest';
import { canTake } from './lease';

const now = 1_000_000;
describe('canTake', () => {
  it('takes a free or own lease', () => {
    expect(canTake(null, 'me', false, now)).toBe(true);
    expect(canTake({ id: 'me', at: now, visible: true }, 'me', false, now)).toBe(true);
  });
  it('takes an expired lease, even while hidden', () => {
    expect(canTake({ id: 'x', at: now - 6000, visible: true }, 'me', false, now)).toBe(true);
  });
  it('does not take a fresh lease from a visible holder', () => {
    expect(canTake({ id: 'x', at: now - 500, visible: true }, 'me', true, now)).toBe(false);
    expect(canTake({ id: 'x', at: now - 500, visible: true }, 'me', false, now)).toBe(false);
  });
  it('a visible tab takes a fresh lease from a hidden one, but a hidden tab never does', () => {
    expect(canTake({ id: 'x', at: now - 500, visible: false }, 'me', true, now)).toBe(true);
    expect(canTake({ id: 'x', at: now - 500, visible: false }, 'me', false, now)).toBe(false);
  });
});
