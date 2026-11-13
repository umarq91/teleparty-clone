/** YouTube watch-page helpers. Title ids are namespaced `yt:<11 chars>` so they can never collide with Netflix's numeric ids. */
const VIDEO_ID_RE = /^[\w-]{11}$/;

export function getVideoId(loc: Pick<Location, 'pathname' | 'search'> = location): string | null {
  if (loc.pathname !== '/watch') return null;
  const v = new URLSearchParams(loc.search).get('v');
  return v && VIDEO_ID_RE.test(v) ? v : null;
}

export const isWatchPage = (loc: Pick<Location, 'pathname' | 'search'> = location) => getVideoId(loc) !== null;

export const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

/** The main player's <video> (hover previews and the miniplayer use other elements). */
export function findPlayerVideo(root: ParentNode = document): HTMLVideoElement | null {
  if (!isWatchPage()) return null;
  return root.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video')
    ?? root.querySelector<HTMLVideoElement>('video.html5-main-video');
}

/**
 * Ads play inside the very same <video>, so while one is showing, currentTime/duration describe the ad,
 * not the video. The player element carries these classes for the duration of an ad.
 */
export const isAdPlaying = (root: ParentNode = document): boolean =>
  !!root.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting');
