import { Emitter } from '@/shared/util';
import type { SiteAdapter } from './sites';
import type { PlayerStatus } from '@/shared/types';

export type VideoEventType = 'play' | 'pause' | 'seeking' | 'seeked' | 'ratechange' | 'ended';
const EVENTS: VideoEventType[] = ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'ended'];

type Events = {
  /** Fired when the player video appears/disappears/changes (also on Netflix's SPA navigation). */
  player: { status: PlayerStatus; video: HTMLVideoElement | null; titleId: string | null };
  event: { type: VideoEventType; video: HTMLVideoElement };
  /** The player ran out of data (true) / has been comfortably playable again for a moment (false). */
  buffer: { on: boolean; why?: 'ad' };
  /** The playing video's title text changed (best effort; titles load a moment after the player). */
  title: string | null;
};

const BUFFER_AFTER_MS = 800;   // ignore the tiny stalls every seek causes
const BUFFER_STABLE_MS = 1200; // readyState must stay >= HAVE_FUTURE_DATA this long before we call it recovered
const BUFFER_GIVE_UP_MS = 45_000; // never deadlock the pair on a stuck player
const AD_POLL_MS = 250;
const AD_CLEAR_MS = 600;        // the ad must be gone this long (and the video playable) before we say it's over
const AD_GIVE_UP_MS = 4 * 60_000; // a stuck class name must never hold the friend forever

const NOT_FOUND_AFTER_MS = 10_000;

/**
 * Finds the site's player <video> (via the SiteAdapter) and re-finds it whenever it's replaced (Netflix and YouTube are SPAs: next
 * episode, back-to-browse and re-entry swap the element without a page load). All listeners and
 * observers are removed in `stop()`.
 */
export class VideoWatcher extends Emitter<Events> {
  private video: HTMLVideoElement | null = null;
  private status: PlayerStatus = 'none';
  private titleId: string | null = null;
  private watchSince = 0;
  private mo: MutationObserver | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private handlers = new Map<VideoEventType, () => void>();
  private scheduled = false;
  private buffering = false;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private bufPoll: ReturnType<typeof setInterval> | null = null;
  private bufStart = 0;
  private bufStableSince = 0;
  private adOn = false;
  private titleName: string | null = null;
  private adStart = 0;
  private adClearSince = 0;
  private adTimer: ReturnType<typeof setInterval> | null = null;
  private lastBuf: { on: boolean; why?: 'ad' } = { on: false };

  constructor(private adapter: SiteAdapter) { super(); }

  start() {
    this.mo = new MutationObserver(() => this.scheduleCheck());
    this.mo.observe(document.documentElement, { childList: true, subtree: true });
    this.timer = setInterval(() => this.check(), 1000); // catches pushState navigation + not-found timeout
    this.adTimer = setInterval(() => this.pollAd(), AD_POLL_MS);
    this.check();
  }

  get current() { return this.video; }
  get playerStatus() { return this.status; }

  private scheduleCheck() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => { this.scheduled = false; this.check(); });
  }

  private check() {
    const titleId = this.adapter.titleId();
    const onWatch = this.adapter.isWatchPage();
    if (!onWatch) this.watchSince = 0; else if (!this.watchSince) this.watchSince = Date.now();

    const found = this.adapter.findVideo();
    if (found !== this.video) this.attach(found);

    const status: PlayerStatus = this.video && onWatch ? 'ready' : onWatch && Date.now() - this.watchSince > NOT_FOUND_AFTER_MS ? 'not-found' : 'none';
    const name = onWatch && this.video ? this.adapter.titleName() : null;
    if (name !== this.titleName) { this.titleName = name; this.emit('title', name); }
    if (status !== this.status || titleId !== this.titleId) {
      this.status = status;
      this.titleId = titleId;
      this.emit('player', { status, video: this.video, titleId });
    }
  }

  private attach(video: HTMLVideoElement | null) {
    this.detach();
    this.video = video;
    if (!video) return;
    for (const type of EVENTS) {
      const h = () => this.emit('event', { type, video });
      this.handlers.set(type, h);
      video.addEventListener(type, h);
    }
    video.addEventListener('waiting', this.onWaiting);
    video.addEventListener('stalled', this.onWaiting);
    video.addEventListener('playing', this.onResumed);
    video.addEventListener('canplay', this.onResumed);
  }

  // ---- buffering ---------------------------------------------------------------------------
  // `waiting` fires on every seek, so it only counts once the stall lasts a moment. Recovery is polled
  // (readyState), because a paused video fires no `playing` event.

  private onWaiting = () => {
    if (this.buffering || this.waitTimer) return;
    this.waitTimer = setTimeout(() => {
      this.waitTimer = null;
      const v = this.video;
      if (v && !v.paused && v.readyState < 3) this.setBuffering(true);
    }, BUFFER_AFTER_MS);
  };

  private onResumed = () => {
    if (this.waitTimer && (this.video?.readyState ?? 0) >= 3) { clearTimeout(this.waitTimer); this.waitTimer = null; }
  };

  private setBuffering(on: boolean) {
    if (on === this.buffering) return;
    this.buffering = on;
    if (this.bufPoll) clearInterval(this.bufPoll);
    this.bufPoll = null;
    if (on) {
      this.bufStart = Date.now();
      this.bufStableSince = 0;
      this.bufPoll = setInterval(() => {
        const v = this.video;
        const now = Date.now();
        if (!v || now - this.bufStart > BUFFER_GIVE_UP_MS) return this.setBuffering(false);
        if (v.readyState >= 3) {
          this.bufStableSince ||= now;
          if (now - this.bufStableSince >= BUFFER_STABLE_MS) this.setBuffering(false);
        } else this.bufStableSince = 0;
      }, 250);
    }
    this.publishBuffer();
  }

  /** Merge "stalled" and "ad playing" into one signal for the party logic (an ad is reported at once, with its reason). */
  private publishBuffer() {
    const next: { on: boolean; why?: 'ad' } = { on: this.buffering || this.adOn, ...(this.adOn ? { why: 'ad' as const } : {}) };
    if (next.on === this.lastBuf.on && next.why === this.lastBuf.why) return;
    this.lastBuf = next;
    this.emit('buffer', next);
  }

  private pollAd() {
    const now = Date.now();
    const ad = this.adapter.isWatchPage() && this.adapter.isAdPlaying();
    if (ad) {
      this.adClearSince = 0;
      if (!this.adOn) { this.adOn = true; this.adStart = now; this.publishBuffer(); }
      else if (now - this.adStart > AD_GIVE_UP_MS) { this.adOn = false; this.publishBuffer(); }
    } else if (this.adOn) {
      this.adClearSince ||= now;
      if (now - this.adClearSince >= AD_CLEAR_MS && (this.video?.readyState ?? 4) >= 3) { this.adOn = false; this.adClearSince = 0; this.publishBuffer(); }
    }
  }

  private detach() {
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
    if (this.video) {
      this.video.removeEventListener('waiting', this.onWaiting);
      this.video.removeEventListener('stalled', this.onWaiting);
      this.video.removeEventListener('playing', this.onResumed);
      this.video.removeEventListener('canplay', this.onResumed);
    }
    this.setBuffering(false);
    if (this.video) for (const [type, h] of this.handlers) this.video.removeEventListener(type, h);
    this.handlers.clear();
    this.video = null;
  }

  stop() {
    this.mo?.disconnect();
    this.mo = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.adTimer) clearInterval(this.adTimer);
    this.adTimer = null;
    this.adOn = false;
    this.detach();
    this.removeAllListeners();
  }
}
