import { PROTOCOL_VERSION, type PlaybackState, type SyncMessage, type SyncType } from '@/shared/protocol';
import type { PlayerStatus, SyncStatus } from '@/shared/types';
import { Emitter, errorMessage } from '@/shared/util';
import { log } from '@/shared/logger';
import { PERIODIC_SYNC_MS } from '@/shared/constants';
import { expectedPosition, planDrift, type DriftConfig } from './drift';
import type { VideoEventType } from './VideoWatcher';

/** The subset of HTMLVideoElement we use (lets us unit-test with a fake). */
export interface VideoLike {
  currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
}

export interface SyncDeps {
  /** Deliver a message to the peer (DataChannel, or broadcast fallback). */
  send(msg: SyncMessage): void;
  /** Estimated (peer clock - local clock) in ms. */
  clockOffset(): number;
  /** The host is the drift reference; the guest follows its PERIODIC_SYNC. */
  isAuthority(): boolean;
  config(): DriftConfig & { useBridge: boolean };
  seek(video: VideoLike, sec: number, useBridge: boolean): Promise<void>;
  now?(): number;
}

type Events = {
  status: { sync: SyncStatus; driftMs: number | null };
  follow: 'none' | 'following' | 'followed';
  notice: string | null;
};

const GUARD_MS = 2500;       // how long after applying a remote command we expect the echo events
const SEND_COALESCE_MS = 120; // Netflix sometimes emits pause+play around a seek; merge them
const LOCAL_PRIORITY_MS = 3000; // after a local user action, ignore PERIODIC_SYNC for this long

interface Guard { until: number; position?: number }

/**
 * Playback synchronisation.
 *
 * Loop prevention: when we *apply* a remote command we arm one-shot "guards" (play / pause / seek).
 * The DOM events our own `video.play()/pause()/currentTime=` produce are matched against the guards
 * and swallowed instead of being re-broadcast. Guards expire, so a genuine user action is never lost.
 */
export class SyncEngine extends Emitter<Events> {
  private video: VideoLike | null = null;
  private localTitle: string | null = null;
  private localStatus: PlayerStatus = 'none';
  private peerStatus: PlayerStatus = 'none';
  private peerTitle: string | null = null;

  private guards: { play?: Guard; pause?: Guard; seek?: Guard } = {};
  private seq: number;
  private lastRemoteSeq = 0;
  private lastLocalCommandAt = 0;
  private lastRemoteApplyAt = 0;
  private lastAutoSeekAt = 0;
  private pending: { types: Set<VideoEventType>; timer: ReturnType<typeof setTimeout> } | null = null;
  private periodic: ReturnType<typeof setInterval> | null = null;
  private baseRate = 1;
  private readyAt = 0;
  private lastStatus: SyncStatus = 'idle';
  private lastDrift: number | null = null;
  private stopped = false;
  private following = false;      // I mirror the peer (I never send playback commands)
  private followedByPeer = false; // the peer mirrors me (I am the only reference)
  private tick = 0;

  constructor(private deps: SyncDeps) {
    super();
    this.seq = (deps.now?.() ?? Date.now()) * 1000;
  }

  private now() { return this.deps.now?.() ?? Date.now(); }

  start() {
    this.periodic = setInterval(() => this.tickPeriodic(), PERIODIC_SYNC_MS);
  }

  private emitFollow() { this.emit('follow', this.following ? 'following' : this.followedByPeer ? 'followed' : 'none'); }

  /** One-way mode: I mirror my friend. My own play/pause/seek are not sent, so nothing can bounce back. */
  startFollowing() {
    if (this.stopped) return;
    if (this.peerStatus !== 'ready') { this.emit('notice', 'Your friend has no player open yet.'); return; }
    if (!this.sameTitle()) { this.emit('notice', 'You are watching different titles. Use "Go there" first.'); return; }
    this.following = true;
    this.followedByPeer = false;
    this.sendType('FOLLOW_START');
    this.emitFollow();
  }

  stopFollowing() {
    if (!this.following) return;
    this.following = false;
    this.sendType('FOLLOW_STOP');
    this.emitFollow();
  }

  /** The peer left or its link was rebuilt. */
  peerGone() {
    if (this.followedByPeer) { this.followedByPeer = false; this.emitFollow(); }
  }

  // ---- inputs from the local player ------------------------------------------------

  setPlayer(status: PlayerStatus, video: VideoLike | null, titleId: string | null) {
    const changed = status !== this.localStatus || titleId !== this.localTitle || video !== this.video;
    if (changed && status === 'ready') this.readyAt = this.now();
    this.localStatus = status;
    this.video = video;
    this.localTitle = titleId;
    this.baseRate = 1;
    if (changed) this.announcePlayer();
    this.refreshStatus();
  }

  /** Tell the peer about our player (also called when the peer (re)connects). */
  announcePlayer() {
    if (this.localStatus === 'ready' && this.video) this.sendType('PLAYER_READY');
    else if (this.localStatus === 'not-found') this.sendType('PLAYER_NOT_FOUND');
  }

  onVideoEvent(type: VideoEventType) {
    const v = this.video;
    if (!v || this.stopped) return;
    const now = this.now();
    if (type === 'ratechange' || type === 'ended') return;
    if (this.following) return; // followers never publish: the friend is the only reference
    if (type === 'play' && this.consume('play')) return;
    if (type === 'pause' && this.consume('pause')) return;
    if (type === 'seeking' || type === 'seeked') {
      const g = this.guards.seek;
      if (g && now < g.until && (g.position === undefined || Math.abs(v.currentTime - g.position) < 1.5)) {
        if (type === 'seeked') delete this.guards.seek;
        return;
      }
    }
    if (type === 'seeking') { this.lastLocalCommandAt = now; return; } // wait for `seeked`
    this.lastLocalCommandAt = now;
    this.queueLocal(type);
  }

  private consume(k: 'play' | 'pause'): boolean {
    const g = this.guards[k];
    if (g && this.now() < g.until) { delete this.guards[k]; return true; }
    return false;
  }

  private queueLocal(type: VideoEventType) {
    if (!this.pending) {
      this.pending = { types: new Set(), timer: setTimeout(() => this.flushLocal(), SEND_COALESCE_MS) };
    }
    this.pending.types.add(type);
  }

  private flushLocal() {
    const p = this.pending;
    this.pending = null;
    const v = this.video;
    if (!p || !v || this.stopped) return;
    // Decide from the *resulting* state rather than the event order.
    if (p.types.has('seeked')) this.sendType('SEEK');
    else this.sendType(v.paused ? 'PAUSE' : 'PLAY');
  }

  // ---- outputs -------------------------------------------------------------------------

  private snapshot(): PlaybackState | null {
    const v = this.video;
    if (!v) return null;
    return { position: Math.max(0, v.currentTime), playing: !v.paused && !v.ended, rate: this.baseRate };
  }

  private sendType(type: SyncType) {
    const needsState = type === 'PLAY' || type === 'PAUSE' || type === 'SEEK' || type === 'PERIODIC_SYNC';
    const state = needsState ? this.snapshot() : null;
    if (needsState && !state) return;
    const msg: SyncMessage = { kind: 'sync', v: PROTOCOL_VERSION, type, seq: ++this.seq, sentAt: this.now(), titleId: this.localTitle, state };
    if (type === 'PLAYER_READY') msg.readyAgeMs = Math.max(0, this.now() - this.readyAt);
    this.deps.send(msg);
  }

  private tickPeriodic() {
    if (this.stopped) return;
    if (this.following && ++this.tick % 5 === 0) this.sendType('FOLLOW_START'); // heartbeat: survives a lost message / peer reload
    if (this.following || !this.video || !(this.followedByPeer || this.deps.isAuthority())) return;
    if (this.peerStatus !== 'ready' || !this.sameTitle()) return;
    this.sendType('PERIODIC_SYNC');
  }

  // ---- inputs from the peer --------------------------------------------------------------

  setPeerPlayer(status: PlayerStatus, titleId: string | null) {
    this.peerStatus = status;
    this.peerTitle = titleId;
    this.refreshStatus();
  }

  private sameTitle() {
    return !this.localTitle || !this.peerTitle || this.localTitle === this.peerTitle;
  }

  async handleRemote(msg: SyncMessage): Promise<void> {
    if (this.stopped) return;
    if (msg.seq <= this.lastRemoteSeq) return; // stale / duplicated / reordered
    this.lastRemoteSeq = msg.seq;

    if (msg.type === 'PLAYER_READY') {
      this.peerStatus = 'ready'; this.peerTitle = msg.titleId;
      // Hand our state to a peer whose player is *newer* than ours so it can catch up. Only the
      // longer-running side answers (by >1s); if both started together nobody does, and the
      // host's PERIODIC_SYNC aligns the guest. Replying from both sides would let two stale
      // snapshots overwrite a fresh PLAY/PAUSE.
      // NOTE: we deliberately do NOT auto-seek the newcomer here any more: seeking a player that is
      // still loading makes Netflix abort with M7375. The newcomer uses "Sync to <friend>" instead.
      this.refreshStatus();
      return;
    }
    if (msg.type === 'FOLLOW_START' || msg.type === 'SYNC_REQUEST') {
      this.peerStatus = 'ready'; this.peerTitle = msg.titleId;
      if (this.following) { this.following = false; this.emitFollow(); } // the one who asked last wins; never both
      const fresh = !this.followedByPeer;
      this.followedByPeer = true;
      // First time only: hand over our exact position so the follower lands on it at once.
      if (fresh && this.video && this.localStatus === 'ready' && this.sameTitle()) this.sendType('SEEK');
      if (fresh) this.emitFollow();
      this.refreshStatus();
      return;
    }
    if (msg.type === 'FOLLOW_STOP') {
      if (this.followedByPeer) { this.followedByPeer = false; this.emitFollow(); }
      return;
    }

    if (msg.type === 'PLAYER_NOT_FOUND') {
      this.peerStatus = 'not-found'; this.peerTitle = msg.titleId;
      this.refreshStatus();
      return;
    }
    this.peerStatus = 'ready';
    this.peerTitle = msg.titleId;

    const v = this.video;
    if (!v || this.localStatus !== 'ready' || !msg.state) { this.refreshStatus(); return; }
    if (!this.sameTitle()) { this.refreshStatus(); return; }

    const cfg = this.deps.config();
    const nowPeer = this.now() + this.deps.clockOffset();
    const target = expectedPosition(msg.state, msg.sentAt, nowPeer);

    try {
      switch (msg.type) {
        case 'PLAY':
        case 'SEEK':
          await this.applyState(v, target, msg.state.playing, msg.state.rate, msg.type === 'SEEK' ? 0.3 : 0.6, cfg.useBridge);
          break;
        case 'PAUSE':
          await this.applyState(v, msg.state.position, false, msg.state.rate, 0.3, cfg.useBridge);
          break;
        case 'PERIODIC_SYNC':
          if (this.following || (!this.followedByPeer && !this.deps.isAuthority())) await this.follow(v, msg, target, cfg);
          break;
      }
    } catch (e) {
      log.warn('failed to apply remote command', errorMessage(e));
    }
    this.refreshStatus();
  }

  private armSeekGuard(position: number) { this.guards.seek = { until: this.now() + GUARD_MS, position }; }

  private async applyState(v: VideoLike, target: number, playing: boolean, rate: number, seekTolerance: number, useBridge: boolean) {
    this.lastRemoteApplyAt = this.now();
    this.baseRate = rate;
    if (v.playbackRate !== rate) v.playbackRate = rate;

    if (Math.abs(v.currentTime - target) > seekTolerance) {
      this.armSeekGuard(target);
      await this.deps.seek(v, target, useBridge);
    }
    if (playing && v.paused) {
      this.guards.play = { until: this.now() + GUARD_MS };
      await v.play().catch((e: unknown) => {
        delete this.guards.play;
        if ((e as { name?: string })?.name === 'NotAllowedError') this.emit('notice', 'Your browser blocked automatic playback. Click the video once to allow it.');
        else throw e;
      });
    } else if (!playing && !v.paused) {
      this.guards.pause = { until: this.now() + GUARD_MS };
      v.pause();
    }
  }

  /** Guest-side handling of the host's periodic reference state. */
  private async follow(v: VideoLike, msg: SyncMessage, target: number, cfg: DriftConfig & { useBridge: boolean }) {
    const now = this.now();
    // Don't fight the user: a local action in the last few seconds wins until the peer has seen it.
    if (now - this.lastLocalCommandAt < LOCAL_PRIORITY_MS || now - this.lastRemoteApplyAt < 800 || this.pending) return;
    const state = msg.state!;

    if (state.playing === v.paused) { // play/pause disagreement (lost message): converge on the host
      // Play/pause only: no automatic seek (see below); position is fixed by the "Sync" button.
      await this.applyState(v, target, state.playing, state.rate, Infinity, cfg.useBridge);
      return;
    }
    if (!state.playing) { this.setDrift(null); return; } // both paused: nothing to do

    this.baseRate = state.rate;
    const drift = target - v.currentTime;
    this.setDrift(drift * 1000);
    const plan = planDrift(drift, state.rate, cfg, now - this.lastAutoSeekAt);
    if (plan.kind === 'seek') {
      if (this.following && now - this.readyAt > 8000) {
        // Explicit follower on a settled player: it is safe (and expected) to jump to the friend.
        this.lastAutoSeekAt = now;
        this.lastRemoteApplyAt = now;
        this.armSeekGuard(target);
        await this.deps.seek(v, target, cfg.useBridge);
        v.playbackRate = state.rate;
      } else if (now - this.lastAutoSeekAt > 15_000) {
        // Never hard-seek on our own (Netflix may abort with M7375): tell the user to press the button.
        this.lastAutoSeekAt = now;
        this.emit('notice', `You're ${Math.abs(Math.round(drift))}s ${drift > 0 ? 'behind' : 'ahead of'} your friend. Press "Follow" to jump to them.`);
      }
    } else if (v.playbackRate !== plan.rate) {
      v.playbackRate = plan.rate;
    }
  }

  // ---- status ------------------------------------------------------------------------------

  private setDrift(ms: number | null) { this.lastDrift = ms; }

  private refreshStatus() {
    let sync: SyncStatus;
    if (this.localStatus !== 'ready') sync = 'no-player';
    else if (this.peerStatus !== 'ready') sync = 'peer-no-player';
    else if (!this.sameTitle()) sync = 'different-title';
    else {
      const recent = this.now() - this.lastRemoteApplyAt < 1500;
      sync = recent || (this.lastDrift !== null && Math.abs(this.lastDrift) > 400) ? 'synchronizing' : 'in-sync';
    }
    if (sync !== this.lastStatus || this.lastDrift !== null) {
      this.lastStatus = sync;
      this.emit('status', { sync, driftMs: this.lastDrift });
    }
  }

  stop() {
    this.stopped = true;
    if (this.periodic) clearInterval(this.periodic);
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
    if (this.video && this.video.playbackRate !== 1 && this.baseRate === 1) this.video.playbackRate = 1;
    this.removeAllListeners();
  }
}
