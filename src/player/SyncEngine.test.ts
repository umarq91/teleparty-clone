import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncMessage } from '@/shared/protocol';
import { defaultDriftConfig } from './drift';
import { SyncEngine, type VideoLike } from './SyncEngine';

class FakeVideo implements VideoLike {
  currentTime = 0;
  paused = true;
  ended = false;
  playbackRate = 1;
  onEvent: (t: 'play' | 'pause' | 'seeking' | 'seeked') => void = () => undefined;
  play() { this.paused = false; this.onEvent('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.onEvent('pause'); }
  /** Like the browser: setting currentTime fires seeking then seeked. */
  jump(t: number) { this.currentTime = t; this.onEvent('seeking'); this.onEvent('seeked'); }
  /** time passes while playing */
  tick(sec: number) { if (!this.paused) this.currentTime += sec * this.playbackRate; }
}

interface Peer { engine: SyncEngine; video: FakeVideo; sent: SyncMessage[] }

function makePair(opts: { titleA?: string; titleB?: string; latencyMs?: number } = {}) {
  const latency = opts.latencyMs ?? 40;
  const peers: Record<'a' | 'b', Peer> = {} as never;
  const mk = (other: 'a' | 'b', authority: boolean, title: string): Peer => {
    const sent: SyncMessage[] = [];
    const video = new FakeVideo();
    const engine = new SyncEngine({
      send: (m) => { sent.push(m); setTimeout(() => void peers[other].engine.handleRemote(m), latency); },
      clockOffset: () => 0,
      isAuthority: () => authority,
      config: () => ({ ...defaultDriftConfig, useBridge: false }),
      seek: async (v, sec) => (v as FakeVideo).jump(sec),
    });
    video.onEvent = (t) => engine.onVideoEvent(t);
    engine.start();
    engine.setPlayer('ready', video, title);
    return { engine, video, sent };
  };
  peers.a = mk('b', true, opts.titleA ?? '1');
  peers.b = mk('a', false, opts.titleB ?? '1');
  peers.a.engine.setPeerPlayer('ready', opts.titleB ?? '1');
  peers.b.engine.setPeerPlayer('ready', opts.titleA ?? '1');
  return peers;
}
const settle = (ms = 500) => vi.advanceTimersByTimeAsync(ms);
const userMsgs = (p: Peer) => p.sent.filter((m) => m.type !== 'PLAYER_READY' && m.type !== 'PERIODIC_SYNC');

beforeEach(() => vi.useFakeTimers({ now: 1_700_000_000_000 }));
afterEach(() => vi.useRealTimers());

describe('SyncEngine', () => {
  it('propagates play without echoing it back', async () => {
    const { a, b } = makePair();
    a.video.play();
    await settle();
    expect(b.video.paused).toBe(false);
    expect(userMsgs(a)).toHaveLength(1);
    expect(userMsgs(b)).toHaveLength(0); // the loop guard swallowed b's own `play` event
  });

  it('propagates pause from the guest to the host, with no ping-pong', async () => {
    const { a, b } = makePair();
    a.video.play(); await settle();
    b.video.pause(); await settle();
    expect(a.video.paused).toBe(true);
    await settle(10_000);
    expect(userMsgs(a)).toHaveLength(1);
    expect(userMsgs(b)).toHaveLength(1);
  });

  it('propagates seeks (and keeps playing) with latency compensation', async () => {
    const { a, b } = makePair({ latencyMs: 200 });
    a.video.play(); await settle(); // b is now playing
    a.video.jump(600);
    await settle(400);
    expect(b.video.paused).toBe(false);
    expect(b.video.currentTime).toBeGreaterThanOrEqual(600.15); // 200ms latency compensated
    expect(b.video.currentTime).toBeLessThan(601);
    expect(userMsgs(b)).toHaveLength(0);
  });

  it('coalesces the pause+play+seeked burst Netflix emits around a seek into one SEEK', async () => {
    const { a } = makePair();
    a.video.play(); await settle();
    const before = userMsgs(a).length;
    a.video.pause(); a.video.currentTime = 50; a.video.onEvent('seeking'); a.video.onEvent('seeked'); a.video.play();
    await settle();
    const burst = userMsgs(a).slice(before);
    expect(burst).toHaveLength(1);
    expect(burst[0]!.type).toBe('SEEK');
  });

  it('guest hard-seeks on large drift, nudges rate on moderate drift, ignores tiny drift', async () => {
    const { a, b } = makePair({ latencyMs: 0 });
    a.video.currentTime = 100; a.video.play(); await settle(100);

    b.video.currentTime = 90;           // far behind
    for (let i = 0; i < 3; i++) { a.video.tick(2); b.video.tick(2); await settle(2000); }
    expect(Math.abs(a.video.currentTime - b.video.currentTime)).toBeLessThan(0.5);

    b.video.currentTime = a.video.currentTime - 0.8; // moderate
    await settle(2000);
    expect(b.video.playbackRate).toBeGreaterThan(1);
    expect(b.video.playbackRate).toBeLessThanOrEqual(1.081);

    b.video.playbackRate = 1;
    b.video.currentTime = a.video.currentTime - 0.1; // negligible
    await settle(2000);
    expect(b.video.playbackRate).toBe(1);
  });

  it('never auto-seeks when far behind; it only nudges the rate', async () => {
    const { a, b } = makePair({ latencyMs: 0 });
    a.video.currentTime = 100; a.video.play(); await settle(100);
    for (let i = 0; i < 4; i++) { a.video.tick(2); b.video.tick(2); await settle(2000); } // let everything converge (8s)
    const seeks: number[] = [];
    const orig = b.video.jump.bind(b.video);
    b.video.jump = (t) => { seeks.push(t); orig(t); };

    for (let i = 0; i < 2; i++) { // the guest is flung 50s back twice, 2s apart (< 5s cooldown)
      b.video.currentTime = a.video.currentTime - 50;
      await settle(2000);
      a.video.tick(2); b.video.tick(2);
    }
    expect(seeks.length).toBe(0); // hard seeks are manual now ("Sync" button) to avoid Netflix M7375
    expect(b.video.playbackRate).toBeCloseTo(1.08, 2); // meanwhile it catches up at the capped rate
  });

  it('ignores commands for a different title', async () => {
    const { a, b } = makePair({ titleA: '1', titleB: '2' });
    a.video.play(); await settle();
    expect(b.video.paused).toBe(true);
  });

  it('hands its state to a peer whose player just (re)started', async () => {
    const { a, b } = makePair({ latencyMs: 0 });
    a.video.currentTime = 321; a.video.play(); await settle(100);
    b.video.pause(); await settle(100); // (guest paused → host pauses too)
    a.video.currentTime = 321; a.video.play(); await settle(400);

    b.video.currentTime = 0;
    b.video.paused = true;
    await settle(5000); // a has been running for a while
    b.engine.setPlayer('none', null, null); // simulates a Netflix refresh: player gone, then back
    b.engine.setPlayer('ready', b.video, '1'); // announces PLAYER_READY (age ≈ 0)
    b.engine.announcePlayer();
    await settle(200);
    expect(b.video.currentTime).toBeLessThan(10); // no automatic seek on (re)load: the user presses "Sync"
    b.engine.startFollowing();
    await settle(300);
    expect(b.video.currentTime).toBeGreaterThan(320);
    expect(b.video.paused).toBe(false);
  });

  it('follow mode is one-way: the follower never publishes, the leader drives', async () => {
    const { a, b } = makePair({ latencyMs: 0 });
    a.video.currentTime = 500; a.video.play(); await settle(400);
    b.engine.startFollowing();
    await settle(300);
    expect(Math.abs(b.video.currentTime - 500)).toBeLessThan(2);
    const before = a.sent.length;
    b.video.jump(10); b.video.pause(); b.video.play(); // follower fiddles: must not reach the leader
    await settle(1000);
    expect(b.sent.filter((m) => m.type === 'SEEK' || m.type === 'PLAY' || m.type === 'PAUSE')).toHaveLength(0);
    expect(a.video.paused).toBe(false);
    expect(a.video.currentTime).toBeGreaterThanOrEqual(500);
    a.video.jump(900); await settle(400); // leader seeks: follower goes along
    expect(Math.abs(b.video.currentTime - 900)).toBeLessThan(2);
    expect(a.sent.length).toBeGreaterThan(before);
  });

  it('drops stale / duplicated messages', async () => {
    const { b } = makePair();
    const msg: SyncMessage = { kind: 'sync', v: 1, type: 'PLAY', seq: 10, sentAt: Date.now(), titleId: '1', state: { position: 5, playing: true, rate: 1 } };
    await b.engine.handleRemote(msg);
    b.video.pause(); await settle(300);
    await b.engine.handleRemote(msg); // replay
    expect(b.video.paused).toBe(true);
  });

  it('reports a blocked autoplay instead of throwing', async () => {
    const { a, b } = makePair();
    b.video.play = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    const notice = vi.fn();
    b.engine.on('notice', notice);
    a.video.play(); await settle();
    expect(notice).toHaveBeenCalled();
  });

  describe('shared holds', () => {
    it('hold pauses without broadcasting, undoes a play attempt, and ignores remote playback', async () => {
      const { a, b } = makePair();
      a.video.play(); await settle();
      expect(b.video.paused).toBe(false);
      const before = userMsgs(a).length;

      a.engine.hold(); b.engine.hold(); await settle();
      expect(a.video.paused).toBe(true);
      expect(b.video.paused).toBe(true);
      expect(userMsgs(a)).toHaveLength(before); // hold()'s own pause was swallowed by the guard

      const attempts: boolean[] = [];
      a.engine.on('heldPlayAttempt', () => attempts.push(true));
      a.video.play(); await settle();
      expect(a.video.paused).toBe(true);        // play is undone while held
      expect(attempts).toHaveLength(1);
      expect(userMsgs(a)).toHaveLength(before); // and nothing was sent
      await settle(10_000);                     // no periodic sync while held either
      expect(b.video.paused).toBe(true);
    });

    it('release(play) resumes from the agreed position', async () => {
      const { a, b } = makePair();
      a.video.play(); await settle();
      a.engine.hold(); b.engine.hold(); await settle();
      a.video.currentTime = 100; b.video.currentTime = 90; // drifted apart while waiting
      await a.engine.release({ play: true, position: 100 });
      await b.engine.release({ play: true, position: 100 });
      expect(a.video.paused).toBe(false);
      expect(b.video.paused).toBe(false);
      expect(b.video.currentTime).toBe(100);   // >1 s off: snapped to the agreed position
      await settle();
      expect(userMsgs(b)).toHaveLength(0);     // the resume play was a guarded echo, not a user action
    });

    it('release(no play) leaves the player paused and normal syncing works again', async () => {
      const { a, b } = makePair();
      a.engine.hold(); b.engine.hold();
      await a.engine.release({ play: false }); await b.engine.release({ play: false });
      expect(a.video.paused).toBe(true);
      a.video.play(); await settle();
      expect(b.video.paused).toBe(false);
    });
  });

  describe('passive hold (ad playing)', () => {
    it('does not touch the player, never broadcasts, and ignores remote commands until released', async () => {
      const { a, b } = makePair();
      a.video.play(); await settle();
      const before = userMsgs(b).length;
      b.engine.hold({ pause: false });
      b.video.pause(); b.video.play(); b.video.jump(500); await settle(); // the "ad" doing its thing
      expect(b.video.paused).toBe(false);                 // our engine did not pause or re-pause it
      expect(userMsgs(b)).toHaveLength(before);           // nothing broadcast
      a.video.pause(); await settle();
      expect(b.video.paused).toBe(false);                 // remote commands ignored while held
      await b.engine.release({ play: false });
      a.video.play(); await settle();
      expect(b.video.paused).toBe(false);
    });
  });
});
