export const isWatchPage = (loc: Pick<Location, 'pathname'> = location) => /^\/watch\/\d+/.test(loc.pathname);

export function getTitleId(loc: Pick<Location, 'pathname'> = location): string | null {
  return loc.pathname.match(/^\/watch\/(\d{1,20})/)?.[1] ?? null;
}

/** Best-effort title of what is playing (Netflix shows it in the player's title element while controls are up). */
export function getTitleName(root: ParentNode = document): string | null {
  const t = root.querySelector('[data-uia="video-title"]')?.textContent?.replace(/\s+/g, ' ').trim();
  return t || null;
}

export const watchUrl = (titleId: string) => `https://www.netflix.com/watch/${encodeURIComponent(titleId)}`;

/**
 * The main player's <video>. Netflix's browse pages also contain autoplaying preview videos,
 * so we only look on /watch pages and prefer the largest loaded element.
 */
export function findPlayerVideo(root: ParentNode = document): HTMLVideoElement | null {
  if (!isWatchPage()) return null;
  const videos = Array.from(root.querySelectorAll('video'));
  if (!videos.length) return null;
  const score = (v: HTMLVideoElement) => {
    const r = v.getBoundingClientRect();
    return (v.readyState > 0 ? 1e9 : 0) + r.width * r.height + (v.closest('.watch-video') ? 1e6 : 0);
  };
  return videos.sort((a, b) => score(b) - score(a))[0] ?? null;
}
