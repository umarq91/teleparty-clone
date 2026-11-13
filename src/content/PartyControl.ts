import { PROTOCOL_VERSION, type PartyMessage, type PartyOp } from '@/shared/protocol';
import { initialParty, type HoldKind, type PartyState } from '@/shared/types';
import { Emitter } from '@/shared/util';

/**
 * Shared "we do this together" state: ready checks, brb pauses, buffering holds and the 3-2-1 that
 * restarts playback. It owns no player and no network: everything goes through `PartyDeps`, so two
 * instances can be wired together in a unit test.
 *
 * Rules of thumb (they come from how Jellyfin SyncPlay / Teams Live Share behave):
 *  - Either side may start a hold; a hold pauses BOTH players and blocks local play until released.
 *  - Playback never restarts "whenever": it restarts at an agreed wall-clock moment (`go`, in the
 *    sender's clock, converted with the measured clock offset), so both sides hit zero together.
 *  - Buffering is a hold that the host releases once nobody is buffering any more (the buffer must
 *    have been stable, see VideoWatcher); the guest has a fallback in case the `go` is lost.
 */

export interface PartyDeps {
  send(m: PartyMessage): boolean;
  /** Estimated (peer clock - local clock), ms. */
  clockOffset(): number;
  isHost(): boolean;
  /** Pause + block local playback. */
  hold(): void;
  release(o: { play: boolean; position?: number | null }): void;
  position(): number | null;
  /** Setting: pause for buffering at all. */
  bufferHoldEnabled(): boolean;
  peerName(): string;
  notify(msg: string): void;
  now?(): number;
}

type Events = { state: PartyState };

export const BIG_COUNTDOWN_MS = 3000;
export const QUICK_COUNTDOWN_MS = 1500;
const MIN_LEAD_MS = 200;
const MAX_LEAD_MS = 6000;
const HOST_FALLBACK_MS = 4000;
const GUEST_FALLBACK_MS = 8000;

export class PartyControl extends Emitter<Events> {
  state: PartyState = initialParty();
  private selfBuf = false;
  private peerBuf = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null;
  private pendingPos: number | null = null;
  private clearSince = 0;

  constructor(private deps: PartyDeps) {
    super();
    this.tickTimer = setInterval(() => this.tick(), 1000);
  }

  private now() { return this.deps.now?.() ?? Date.now(); }
  private msg(op: PartyOp, extra: Partial<PartyMessage> = {}): PartyMessage { return { kind: 'party', v: PROTOCOL_VERSION, op, ...extra }; }
  private set(p: Partial<PartyState>) { this.state = { ...this.state, ...p }; this.emit('state', this.state); }

  private enter(hold: HoldKind, by: PartyState['by'], extra: Partial<PartyState> = {}) {
    this.clearCountdown();
    this.deps.hold();
    this.set({ hold, by, meReady: false, peerReady: false, countdownTo: null, countdownQuick: false, since: this.state.hold === 'none' ? this.now() : this.state.since, ...extra });
  }

  private reset(flash = false) {
    this.clearCountdown();
    this.clearSince = 0;
    this.state = { ...initialParty(), goAt: flash ? this.now() : this.state.goAt };
    this.emit('state', this.state);
  }

  private clearCountdown() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ---- user actions -----------------------------------------------------------------------------

  /** "Brb": pause both sides until someone presses resume. */
  requestBrb() {
    if (this.state.hold === 'brb') return;
    if (!this.deps.send(this.msg('brb'))) return this.deps.notify('Can’t reach your friend right now.');
    this.enter('brb', 'me');
  }

  /** "Ready?": pause both sides; when the friend says yes, a 3-2-1 starts the movie. */
  requestReadyCheck() {
    if (this.state.hold !== 'none') return;
    if (!this.deps.send(this.msg('ready-ask'))) return this.deps.notify('Can’t reach your friend right now.');
    this.enter('ready-check', 'me', { meReady: true });
  }

  imReady() {
    const s = this.state;
    if (s.hold !== 'ready-check' || s.meReady) return;
    if (!this.deps.send(this.msg('ready-yes'))) return this.deps.notify('Can’t reach your friend right now.');
    this.set({ meReady: true });
  }

  /** Start the countdown now ("I'm back", "start anyway", "don't wait"). */
  resumeNow() {
    if (this.state.hold === 'none' || this.state.countdownTo !== null) return;
    const quick = this.state.hold === 'buffering';
    this.startCountdown(quick ? QUICK_COUNTDOWN_MS : BIG_COUNTDOWN_MS, quick);
  }

  /** Abort a ready check or a running countdown; both sides stay paused. */
  cancel() {
    if (this.state.hold === 'none') return;
    this.deps.send(this.msg('cancel'));
    this.deps.release({ play: false });
    this.reset();
  }

  // ---- local player ------------------------------------------------------------------------------

  setLocalBuffering(on: boolean) {
    if (!this.deps.bufferHoldEnabled()) return;
    if (on && !this.selfBuf) {
      if (!this.deps.send(this.msg('buffering'))) return; // can't coordinate: carry on, drift sync will catch up
      this.selfBuf = true;
      if (this.state.hold === 'none') this.enter('buffering', this.peerBuf ? 'both' : 'me');
      else this.refreshBy();
    } else if (!on && this.selfBuf) {
      this.selfBuf = false;
      this.deps.send(this.msg('buffered'));
      this.refreshBy();
      this.maybeResumeBuffering();
    }
  }

  // ---- network -----------------------------------------------------------------------------------

  handle(m: PartyMessage) {
    const s = this.state;
    switch (m.op) {
      case 'brb':
        if (s.hold === 'brb' && s.by === 'me') this.set({ by: 'both' });
        else this.enter('brb', 'peer');
        break;
      case 'ready-ask':
        if (s.hold === 'ready-check' && s.by === 'me') { // we asked at the same moment: that counts as yes from both
          this.set({ by: 'both', peerReady: true });
          if (this.deps.isHost()) this.startCountdown(BIG_COUNTDOWN_MS, false);
        } else this.enter('ready-check', 'peer', { peerReady: true });
        break;
      case 'ready-yes':
        if (s.hold !== 'ready-check') break;
        this.set({ peerReady: true });
        if (s.by === 'me') this.startCountdown(BIG_COUNTDOWN_MS, false); // the asker starts the countdown
        break;
      case 'buffering':
        if (!this.deps.bufferHoldEnabled()) break;
        this.peerBuf = true;
        if (s.hold === 'none') this.enter('buffering', this.selfBuf ? 'both' : 'peer');
        else { this.refreshBy(); if (s.hold === 'buffering') this.clearCountdown(), this.set({ countdownTo: null }); }
        break;
      case 'buffered':
        this.peerBuf = false;
        this.refreshBy();
        this.maybeResumeBuffering();
        break;
      case 'go': {
        if (m.goAt === undefined) break;
        const quick = (m.secs ?? 3) < 2.5;
        if (s.hold === 'none') { this.deps.hold(); this.set({ hold: quick ? 'buffering' : 'brb', by: 'peer', since: this.now() }); }
        const lead = Math.min(MAX_LEAD_MS, Math.max(MIN_LEAD_MS, m.goAt - this.deps.clockOffset() - this.now()));
        this.scheduleGo(this.now() + lead, m.pos ?? null, quick);
        break;
      }
      case 'cancel':
        if (s.hold === 'none') break;
        this.deps.release({ play: false });
        this.reset();
        this.deps.notify(`${this.deps.peerName()} hit pause on the plan. Staying paused.`);
        break;
    }
  }

  /** The friend left or lost connection: never leave someone paused behind a hold nobody can end. */
  peerGone() {
    this.peerBuf = false;
    if (this.state.hold === 'none') return;
    this.deps.release({ play: false });
    this.reset();
    this.deps.notify(`${this.deps.peerName()} disconnected, so we stopped waiting.`);
  }

  /** The data channel (re)opened: tell the friend about a hold they may have missed. */
  resend() {
    const s = this.state;
    if (s.hold === 'brb' && s.by !== 'peer') this.deps.send(this.msg('brb'));
    else if (s.hold === 'ready-check' && s.by !== 'peer') this.deps.send(this.msg('ready-ask'));
    else if (this.selfBuf) this.deps.send(this.msg('buffering'));
  }

  destroy() {
    this.clearCountdown();
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.removeAllListeners();
  }

  // ---- internals ---------------------------------------------------------------------------------

  private refreshBy() {
    if (this.state.hold !== 'buffering') return;
    const by = this.selfBuf && this.peerBuf ? 'both' : this.selfBuf ? 'me' : this.peerBuf ? 'peer' : this.state.by;
    if (by !== this.state.by) this.set({ by });
  }

  /** The host restarts everyone once nobody is buffering any more. */
  private maybeResumeBuffering() {
    const s = this.state;
    if (s.hold !== 'buffering' || this.selfBuf || this.peerBuf || s.countdownTo !== null) return;
    this.clearSince = this.now();
    if (this.deps.isHost()) this.startCountdown(QUICK_COUNTDOWN_MS, true);
  }

  private startCountdown(ms: number, quick: boolean) {
    const goLocal = this.now() + ms; // sent in OUR clock; the receiver converts it with its measured offset
    const pos = this.deps.position();
    const ok = this.deps.send(this.msg('go', { goAt: goLocal, secs: ms / 1000, ...(pos !== null ? { pos } : {}) }));
    if (!ok) return this.deps.notify('Can’t reach your friend right now.');
    this.scheduleGo(goLocal, pos, quick);
  }

  private scheduleGo(goLocal: number, pos: number | null, quick: boolean) {
    this.clearCountdown();
    this.pendingPos = pos;
    this.set({ countdownTo: goLocal, countdownQuick: quick });
    this.timer = setTimeout(() => this.fire(), Math.max(0, goLocal - this.now()));
  }

  private fire() {
    this.timer = null;
    this.selfBuf = false;
    this.peerBuf = false;
    this.deps.release({ play: true, position: this.pendingPos });
    this.reset(true);
  }

  private tick() {
    const s = this.state;
    if (s.hold !== 'buffering' || s.countdownTo !== null || this.selfBuf || this.peerBuf) { this.clearSince = 0; return; }
    if (!this.clearSince) { this.clearSince = this.now(); return; }
    const waited = this.now() - this.clearSince;
    if (this.deps.isHost() && waited > HOST_FALLBACK_MS) this.startCountdown(QUICK_COUNTDOWN_MS, true);
    else if (!this.deps.isHost() && waited > GUEST_FALLBACK_MS) { this.deps.release({ play: true }); this.reset(true); } // the host's `go` never arrived
  }
}
