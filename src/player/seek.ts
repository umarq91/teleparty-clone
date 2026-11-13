import { log } from '@/shared/logger';

let nextId = 1;

/** Ask the (opt-in) MAIN-world bridge to seek. Resolves false on timeout/failure. */
function seekViaBridge(sec: number): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 800);
    function onMsg(e: MessageEvent) {
      const d = e.data as { source?: string; type?: string; id?: number; ok?: boolean } | null;
      if (e.source !== window || d?.source !== 'mini-teleparty-bridge' || d.type !== 'SEEK_RESULT' || d.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      resolve(d.ok === true);
    }
    window.addEventListener('message', onMsg);
    window.postMessage({ source: 'mini-teleparty', type: 'SEEK', ms: sec * 1000, id }, location.origin);
  });
}

/** Seek via the bridge if enabled (falling back on failure), otherwise via the standard media API. */
export async function seekVideo(video: HTMLVideoElement, sec: number, useBridge: boolean): Promise<void> {
  const target = Math.max(0, Number.isFinite(video.duration) ? Math.min(sec, video.duration) : sec);
  if (useBridge && (await seekViaBridge(target))) return;
  if (useBridge) log.warn('seek bridge unavailable, using video.currentTime');
  video.currentTime = target;
}
