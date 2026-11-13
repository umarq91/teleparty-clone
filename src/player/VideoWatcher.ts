import { Emitter } from '@/shared/util';
import { findPlayerVideo, getTitleId, isWatchPage } from './netflix';
import type { PlayerStatus } from '@/shared/types';

export type VideoEventType = 'play' | 'pause' | 'seeking' | 'seeked' | 'ratechange' | 'ended';
const EVENTS: VideoEventType[] = ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'ended'];

type Events = {
  /** Fired when the player video appears/disappears/changes (also on Netflix's SPA navigation). */
  player: { status: PlayerStatus; video: HTMLVideoElement | null; titleId: string | null };
  event: { type: VideoEventType; video: HTMLVideoElement };
  /** The player ran out of data (true) / has been comfortably playable again for a moment (false). */
  buffer: boolean;
};

const BUFFER_AFTER_MS = 800;   // ignore the tiny stalls every seek causes
const BUFFER_STABLE_MS = 1200; // readyState must stay >= HAVE_FUTURE_DATA this long before we call it recovered
const BUFFER_GIVE_UP_MS = 45_000; // never deadlock the pair on a stuck player

const NOT_FOUND_AFTER_MS = 10_000;

/**
 * Finds Netflix's player <video> and re-finds it whenever it's replaced (Netflix is a SPA: next
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

  start() {
    this.mo = new MutationObserver(() => this.scheduleCheck());
    this.mo.observe(document.documentElement, { childList: true, subtree: true });
    this.timer = setInterval(() => this.check(), 1000); // catches pushState navigation + not-found timeout
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
    const titleId = getTitleId();
    const onWatch = isWatchPage();
    if (!onWatch) this.watchSince = 0; else if (!this.watchSince) this.watchSince = Date.now();

    const found = findPlayerVideo();
    if (found !== this.video) this.attach(found);

    const status: PlayerStatus = this.video && onWatch ? 'ready' : onWatch && Date.now() - this.watchSince > NOT_FOUND_AFTER_MS ? 'not-found' : 'none';
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
    this.emit('buffer', on);
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
    this.detach();
    this.removeAllListeners();
  }
}
