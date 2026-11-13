import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PartyControl, type PartyDeps } from './PartyControl';
import type { PartyMessage } from '@/shared/protocol';

interface Side { party: PartyControl; calls: string[]; notices: string[]; buffering: { on: boolean } }

function pair(opts: { latency?: number; offsetBToA?: number; bufferHold?: boolean } = {}) {
  const latency = opts.latency ?? 30;
  const sides = {} as Record<'a' | 'b', Side>;
  const mk = (other: 'a' | 'b', host: boolean, offset: number, skew: number): Side => {
    const calls: string[] = [];
    const notices: string[] = [];
    const deps: PartyDeps = {
      send: (m: PartyMessage) => { setTimeout(() => sides[other].party.handle(m), latency); return true; },
      clockOffset: () => offset,
      isHost: () => host,
      hold: (o) => calls.push(o?.pause === false ? 'hold-passive' : 'hold'),
      release: (o) => calls.push(o.play ? `play@${o.position ?? 'here'}` : 'stay-paused'),
      position: () => 42,
      bufferHoldEnabled: () => opts.bufferHold ?? true,
      now: () => Date.now() + skew, // this side's (possibly wrong) wall clock
      peerName: () => other,
      notify: (n) => notices.push(n),
    };
    return { party: new PartyControl(deps), calls, notices, buffering: { on: false } };
  };
  // a is the host; b's clock is `offset` ms ahead of a's, so a sees (b - a) = +offset and b sees -offset.
  const off = opts.offsetBToA ?? 0;
  sides.a = mk('b', true, off, 0);
  sides.b = mk('a', false, -off, off);
  return sides;
}
const settle = (ms = 100) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers({ now: 1_700_000_000_000 }));
afterEach(() => vi.useRealTimers());

describe('ready check', () => {
  it('pauses both, then counts down and plays together once the friend is ready', async () => {
    const { a, b } = pair();
    a.party.requestReadyCheck();
    await settle();
    expect(a.party.state).toMatchObject({ hold: 'ready-check', by: 'me', meReady: true, peerReady: false });
    expect(b.party.state).toMatchObject({ hold: 'ready-check', by: 'peer', meReady: false, peerReady: true });

    b.party.imReady();
    await settle();
    expect(a.party.state.countdownTo).not.toBeNull();
    expect(b.party.state.countdownTo).not.toBeNull();
    // both fire within a couple of ms of each other (here: the same tick)
    expect(Math.abs(a.party.state.countdownTo! - b.party.state.countdownTo!)).toBeLessThan(5);

    await settle(3200);
    expect(a.calls).toEqual(['hold', 'play@42']);
    expect(b.calls).toEqual(['hold', 'play@42']);
    expect(a.party.state.hold).toBe('none');
    expect(b.party.state.hold).toBe('none');
    expect(b.party.state.goAt).toBeGreaterThan(0);
  });

  it('a cancel during the countdown keeps both paused', async () => {
    const { a, b } = pair();
    a.party.requestReadyCheck(); await settle();
    b.party.imReady(); await settle(500);
    b.party.cancel(); await settle(100);
    await settle(4000);
    expect(a.calls).toEqual(['hold', 'stay-paused']);
    expect(b.calls).toEqual(['hold', 'stay-paused']);
    expect(a.party.state.hold).toBe('none');
    expect(a.notices.length).toBe(1);
  });

  it('simultaneous asks resolve into one countdown', async () => {
    const { a, b } = pair();
    a.party.requestReadyCheck(); b.party.requestReadyCheck();
    await settle();
    expect(a.party.state.countdownTo).not.toBeNull();
    await settle(3200);
    expect(a.calls.filter((c) => c.startsWith('play'))).toHaveLength(1);
    expect(b.calls.filter((c) => c.startsWith('play'))).toHaveLength(1);
  });
});

describe('brb', () => {
  it('holds both; either side can restart with a countdown', async () => {
    const { a, b } = pair();
    a.party.requestBrb(); await settle();
    expect(b.party.state).toMatchObject({ hold: 'brb', by: 'peer' });
    b.party.resumeNow(); await settle(3300);
    expect(a.calls).toEqual(['hold', 'play@42']);
    expect(b.calls).toEqual(['hold', 'play@42']);
  });
  it('releases (paused) when the friend disconnects', async () => {
    const { a } = pair();
    a.party.requestBrb();
    a.party.peerGone();
    expect(a.party.state.hold).toBe('none');
    expect(a.calls).toEqual(['hold', 'stay-paused']);
    expect(a.notices).toHaveLength(1);
  });
});

describe('buffering', () => {
  it('holds both while one buffers, then the host restarts everyone', async () => {
    const { a, b } = pair();
    b.party.setLocalBuffering(true); await settle();
    expect(a.party.state).toMatchObject({ hold: 'buffering', by: 'peer' });
    expect(b.party.state).toMatchObject({ hold: 'buffering', by: 'me' });
    expect(a.party.state.countdownTo).toBeNull();

    b.party.setLocalBuffering(false); await settle(100);
    expect(a.party.state).toMatchObject({ countdownTo: expect.any(Number), countdownQuick: true });
    await settle(1700);
    expect(a.calls).toEqual(['hold', 'play@42']);
    expect(b.calls).toEqual(['hold', 'play@42']);
  });

  it('waits for BOTH to recover when both buffer', async () => {
    const { a, b } = pair();
    a.party.setLocalBuffering(true); b.party.setLocalBuffering(true); await settle();
    expect(a.party.state.by).toBe('both');
    b.party.setLocalBuffering(false); await settle(2000);
    expect(a.calls).toEqual(['hold']); // host still buffering: nothing restarts
    a.party.setLocalBuffering(false); await settle(2000);
    expect(a.calls).toEqual(['hold', 'play@42']);
  });

  it('a buffering friend does not undo a brb', async () => {
    const { a, b } = pair();
    a.party.requestBrb(); await settle();
    b.party.setLocalBuffering(true); await settle();
    b.party.setLocalBuffering(false); await settle(3000);
    expect(a.party.state.hold).toBe('brb'); // still on break
    expect(a.calls).toEqual(['hold']);
  });

  it('is ignored entirely when the setting is off', async () => {
    const { a, b } = pair({ bufferHold: false });
    b.party.setLocalBuffering(true); await settle();
    expect(a.party.state.hold).toBe('none');
    expect(b.party.state.hold).toBe('none');
  });

  it('the guest resumes on its own if the host\'s go never arrives', async () => {
    const { a, b } = pair();
    a.party.setLocalBuffering(true); await settle();
    // the guest recovers while the host's `buffered`/`go` are lost
    (b.party as unknown as { peerBuf: boolean }).peerBuf = false;
    await settle(10_000);
    expect(b.calls).toContain('play@here');
    expect(b.party.state.hold).toBe('none');
  });
});

describe('clocks', () => {
  it('lands on the same instant even when the clocks disagree by 5 s', async () => {
    const { a, b } = pair({ offsetBToA: 5000 });
    a.party.requestBrb(); await settle();
    a.party.resumeNow(); await settle(50);
    // convert b's local timestamp back to real time before comparing
    const delta = Math.abs(a.party.state.countdownTo! - (b.party.state.countdownTo! - 5000));
    expect(delta).toBeLessThan(5);
  });
});

describe('ads', () => {
  it('our own ad holds the friend but leaves OUR player alone, then pauses it again before the countdown', async () => {
    const { a, b } = pair();
    b.party.setLocalBuffering(true, 'ad'); await settle();
    expect(b.calls).toEqual(['hold-passive']);            // the ad itself is never paused
    expect(a.calls).toEqual(['hold']);                    // the friend is paused
    expect(a.party.state).toMatchObject({ hold: 'buffering', by: 'peer', why: 'ad' });
    expect(b.party.state).toMatchObject({ by: 'me', why: 'ad' });

    b.party.setLocalBuffering(false); await settle(100);
    expect(b.calls).toEqual(['hold-passive', 'hold']);    // content is held at the agreed spot after the ad
    await settle(1700);
    expect(a.calls).toEqual(['hold', 'play@42']);
    expect(b.calls).toEqual(['hold-passive', 'hold', 'play@42']);
  });

  it('both in an ad: waits for both to finish', async () => {
    const { a, b } = pair();
    a.party.setLocalBuffering(true, 'ad'); b.party.setLocalBuffering(true, 'ad'); await settle();
    expect(a.party.state.by).toBe('both');
    b.party.setLocalBuffering(false); await settle(2000);
    expect(a.calls).not.toContain('play@42');
    a.party.setLocalBuffering(false); await settle(2000);
    expect(a.calls).toContain('play@42');
  });
});
