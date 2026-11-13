/**
 * OPT-IN MAIN-world helper (off unless the user enables "Netflix seek bridge" in Settings).
 *
 * Why it exists: on some Netflix builds, assigning `video.currentTime` directly makes the player
 * abort with error M7375. Netflix's *own* player object can seek without that. That object is an
 * undocumented internal API, so:
 *   - it is never used unless the user turns it on,
 *   - it is feature-detected on every call,
 *   - on any failure we report `ok:false` and the caller falls back to the standard media API.
 * It never touches media data, DRM or network traffic.
 */
interface NetflixPlayer { seek(ms: number): void }
interface NetflixGlobal {
  appContext?: { state?: { playerApp?: { getAPI?: () => { videoPlayer?: {
    getAllPlayerSessionIds?: () => string[];
    getVideoPlayerBySessionId?: (id: string) => NetflixPlayer | undefined;
  } } } } };
}

const SRC_IN = 'mini-teleparty';
const SRC_OUT = 'mini-teleparty-bridge';

function findPlayer(): NetflixPlayer | null {
  try {
    const vp = (window as unknown as { netflix?: NetflixGlobal }).netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
    const id = vp?.getAllPlayerSessionIds?.().find((s) => s.startsWith('watch-')) ?? vp?.getAllPlayerSessionIds?.()[0];
    return (id && vp?.getVideoPlayerBySessionId?.(id)) || null;
  } catch { return null; }
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window) return;
  const d = e.data as { source?: string; type?: string; ms?: unknown; id?: unknown } | null;
  if (!d || d.source !== SRC_IN || d.type !== 'SEEK') return;
  let ok = false;
  if (typeof d.ms === 'number' && Number.isFinite(d.ms) && d.ms >= 0) {
    const p = findPlayer();
    if (p) { try { p.seek(Math.round(d.ms)); ok = true; } catch { ok = false; } }
  }
  window.postMessage({ source: SRC_OUT, type: 'SEEK_RESULT', id: d.id, ok }, location.origin);
});
