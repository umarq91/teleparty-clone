import { Emitter, errorMessage } from '@/shared/util';
import { log } from '@/shared/logger';

export interface LocalMediaState {
  micOn: boolean;
  camOn: boolean;
  stream: MediaStream;
  audio: MediaStreamTrack | null;
  video: MediaStreamTrack | null;
}

type Events = { change: LocalMediaState; error: string | null };

export function describeMediaError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera/microphone access was blocked. Click the camera icon in the address bar (or Netflix site settings) to allow it, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera or microphone was found.';
    case 'TimeoutError':
      return 'Camera/microphone did not respond. Chrome may be waiting on a permission prompt (look near the address bar), or another app is holding the device. Check, then try again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Your camera or microphone is in use by another app.';
    default:
      return `Could not start camera/microphone: ${errorMessage(e)}`;
  }
}

/**
 * Owns the local camera/microphone. Mic mute = `track.enabled=false` (instant, keeps permission);
 * camera off = stop the track so the camera light actually turns off.
 */
export class LocalMedia extends Emitter<Events> {
  readonly stream = new MediaStream();
  private audio: MediaStreamTrack | null = null;
  private video: MediaStreamTrack | null = null;
  private micWanted = true;
  private active = false;
  private onDeviceChange = () => void this.recoverEndedTracks();

  get isActive() { return this.active; }
  get state(): LocalMediaState {
    return { micOn: !!this.audio?.enabled && this.audio.readyState === 'live', camOn: !!this.video && this.video.readyState === 'live', stream: this.stream, audio: this.audio, video: this.video };
  }

  /** Request devices. Succeeds with partial media (e.g. mic only) if one device is unavailable. */
  async start(opts: { audio: boolean; video: boolean }): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support camera access here.');
    let firstError: unknown = null;
    if (opts.audio) await this.acquire('audio').catch((e) => { firstError = e; });
    if (opts.video) await this.acquire('video').catch((e) => { firstError ??= e; });
    if (!this.audio && !this.video) {
      const err = describeMediaError(firstError);
      this.emit('error', err);
      throw new Error(err);
    }
    this.active = true;
    if (firstError) this.emit('error', describeMediaError(firstError)); // partial success: surface a warning
    navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange);
    this.publish();
  }

  private async acquire(kind: 'audio' | 'video') {
    log.info(`requesting ${kind}`);
    const request = navigator.mediaDevices.getUserMedia(
      kind === 'audio'
        ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
        : { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } },
    );
    // A request that never settles (hidden prompt, device held by another app) must not fail silently.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(Object.assign(new Error('getUserMedia timed out'), { name: 'TimeoutError' })); }, 12_000);
    });
    const s = await Promise.race([request, timeout]).finally(() => clearTimeout(timer));
    // If it resolves late (after we gave up), release the devices instead of leaking a live camera.
    void request.then((late) => { if (timedOut) late.getTracks().forEach((t) => t.stop()); }).catch(() => undefined);
    const track = (kind === 'audio' ? s.getAudioTracks() : s.getVideoTracks())[0];
    if (!track) throw new Error('no track');
    this.adopt(kind, track);
  }

  private adopt(kind: 'audio' | 'video', track: MediaStreamTrack) {
    const prev = kind === 'audio' ? this.audio : this.video;
    if (prev) { this.stream.removeTrack(prev); prev.stop(); prev.onended = null; }
    if (kind === 'audio') { this.audio = track; track.enabled = this.micWanted; } else this.video = track;
    this.stream.addTrack(track);
    track.onended = () => { log.warn(`${kind} track ended (device removed?)`); void this.recoverEndedTracks(); };
  }

  private publish() { this.emit('change', this.state); }

  setMic(on: boolean) {
    this.micWanted = on;
    if (this.audio) this.audio.enabled = on;
    this.publish();
  }

  async setCam(on: boolean) {
    if (!on) {
      if (this.video) { this.stream.removeTrack(this.video); this.video.onended = null; this.video.stop(); this.video = null; }
      this.publish();
      return;
    }
    try { await this.acquire('video'); this.emit('error', null); } catch (e) { this.emit('error', describeMediaError(e)); throw e; }
    this.publish();
  }

  /** Called on devicechange / track end: try to re-acquire whatever died. */
  private async recoverEndedTracks() {
    if (!this.active) return;
    let changed = false;
    if (this.audio?.readyState === 'ended') {
      this.stream.removeTrack(this.audio); this.audio = null; changed = true;
      await this.acquire('audio').catch(() => undefined);
    }
    if (this.video?.readyState === 'ended') {
      this.stream.removeTrack(this.video); this.video = null; changed = true;
      await this.acquire('video').catch(() => undefined);
    }
    if (changed) this.publish();
  }

  /** Stop every track and release devices. */
  stop() {
    navigator.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
    for (const t of this.stream.getTracks()) { t.onended = null; t.stop(); this.stream.removeTrack(t); }
    this.audio = this.video = null;
    this.active = false;
    this.publish();
  }
}
