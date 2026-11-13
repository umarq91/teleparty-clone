import * as netflix from './netflix';
import * as youtube from './youtube';

export type SiteId = 'netflix' | 'youtube';

/** Everything that differs between supported video sites. The sync, call and party code never looks past this. */
export interface SiteAdapter {
  id: SiteId;
  name: string;
  origin: string;
  /** Hosts this adapter's content script runs on. */
  hosts: string[];
  isWatchPage(): boolean;
  /** Namespaced id of what is playing here (Netflix: digits; YouTube: `yt:<id>`), or null. */
  titleId(): string | null;
  findVideo(): HTMLVideoElement | null;
  /** Best-effort text title of what is playing. */
  titleName(): string | null;
  /** Is an advert currently playing in the player? (Content must not be synced while it is.) */
  isAdPlaying(): boolean;
  /** Does this site own that title id? */
  owns(titleId: string): boolean;
  urlFor(titleId: string): string;
  /** Netflix's undocumented seek bridge only exists on Netflix. */
  supportsSeekBridge: boolean;
}

const YT_PREFIX = 'yt:';

export const NETFLIX: SiteAdapter = {
  id: 'netflix', name: 'Netflix', origin: 'https://www.netflix.com', hosts: ['www.netflix.com'],
  isWatchPage: () => netflix.isWatchPage(),
  titleId: () => netflix.getTitleId(),
  findVideo: () => netflix.findPlayerVideo(),
  titleName: () => netflix.getTitleName(),
  isAdPlaying: () => false,
  owns: (id) => /^\d{1,20}$/.test(id),
  urlFor: (id) => netflix.watchUrl(id),
  supportsSeekBridge: true,
};

export const YOUTUBE: SiteAdapter = {
  id: 'youtube', name: 'YouTube', origin: 'https://www.youtube.com', hosts: ['www.youtube.com'],
  isWatchPage: () => youtube.isWatchPage(),
  titleId: () => { const v = youtube.getVideoId(); return v ? YT_PREFIX + v : null; },
  findVideo: () => youtube.findPlayerVideo(),
  titleName: () => youtube.getTitleName(),
  isAdPlaying: () => youtube.isAdPlaying(),
  owns: (id) => id.startsWith(YT_PREFIX),
  urlFor: (id) => youtube.watchUrl(id.slice(YT_PREFIX.length)),
  supportsSeekBridge: false,
};

export const SITES: Record<SiteId, SiteAdapter> = { netflix: NETFLIX, youtube: YOUTUBE };

export function adapterForHost(host: string): SiteAdapter | null {
  return Object.values(SITES).find((s) => s.hosts.includes(host)) ?? null;
}

/** Where to go to watch what the friend is watching (works across sites). */
export function urlForTitle(titleId: string): string | null {
  const site = Object.values(SITES).find((s) => s.owns(titleId));
  return site ? site.urlFor(titleId) : null;
}
