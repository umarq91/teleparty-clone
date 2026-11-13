import { Emitter } from '@/shared/util';
import { findPlayerVideo, getTitleId, isWatchPage } from './netflix';
import type { PlayerStatus } from '@/shared/types';

export type VideoEventType = 'play' | 'pause' | 'seeking' | 'seeked' | 'ratechange' | 'ended';
const EVENTS: VideoEventType[] = ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'ended'];

type Events = {
  /** Fired when the player video appears/disappears/changes (also on Netflix's SPA navigation). */
  player: { status: PlayerStatus; video: HTMLVideoElement | null; titleId: string | null };
  event: { type: VideoEventType; video: HTMLVideoElement };
};

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
  }

  private detach() {
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
