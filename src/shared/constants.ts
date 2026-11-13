import type { Settings } from './types';

export const NETFLIX_ORIGIN = 'https://www.netflix.com';
export const YOUTUBE_ORIGIN = 'https://www.youtube.com';
export const HOST_LEASE_KEY = 'hostLease';
/** Set right before jumping to the friend's video; the next page syncs position once the player has settled. */
export const PENDING_JUMP_KEY = 'pendingJump';
export const INVITE_HASH_KEY = 'mtp';
export const STORAGE_SESSION_KEY = 'roomSession';
export const STORAGE_SETTINGS_KEY = 'settings';
export const STORAGE_STATUS_KEY = 'roomStatus'; // chrome.storage.session
export const STORAGE_AUTH_PREFIX = 'sb-auth:';
export const HOST_LOCK_NAME = 'mini-teleparty-room-host';

export const HEARTBEAT_MS = 30_000;
export const PERIODIC_SYNC_MS = 2_000;
export const PING_MS = 5_000;
export const MAX_NAME_LENGTH = 40;

export const STUN_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

const env = import.meta.env;
export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  supabaseUrl: (env?.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseAnonKey: (env?.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  turnUrls: (env?.VITE_TURN_URLS as string | undefined) ?? '',
  turnUsername: (env?.VITE_TURN_USERNAME as string | undefined) ?? '',
  turnCredential: (env?.VITE_TURN_CREDENTIAL as string | undefined) ?? '',
  driftIgnoreSec: 0.25,
  driftSeekSec: 2,
  useNetflixSeekBridge: true,
  autoStartCall: false,
  autoCollapse: true,
  waitForBuffering: true,
  giphyApiKey: (env?.VITE_GIPHY_API_KEY as string | undefined) ?? '',
};
