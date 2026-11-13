export type Role = 'host' | 'guest';

export interface RoomSession {
  roomId: string;
  secret: string;
  role: Role;
  displayName: string;
  joinedAt: number;
}

export interface Settings {
  displayName: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  turnUrls: string; // comma separated
  turnUsername: string;
  turnCredential: string;
  /** Ignore drift below this many seconds. */
  driftIgnoreSec: number;
  /** Above this many seconds, hard-seek instead of nudging the playback rate. */
  driftSeekSec: number;
  /** Opt-in: seek through Netflix's own (undocumented) player API instead of video.currentTime. */
  useNetflixSeekBridge: boolean;
  autoStartCall: boolean;
  /** Pause both sides while either one is buffering, and resume together. */
  waitForBuffering: boolean;
  /** Fold the panel down to just the videos once the call is healthy. */
  autoCollapse: boolean;
  /** Free GIPHY API key for GIF/sticker search (optional). */
  giphyApiKey: string;
}

export type PlayerStatus = 'none' | 'not-found' | 'ready';

export type ConnectionPhase =
  | 'idle'
  | 'connecting' // signaling
  | 'waiting-for-friend'
  | 'friend-connected'
  | 'negotiating'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface PeerInfo {
  userId: string;
  name: string;
  playerStatus: PlayerStatus;
  titleId: string | null;
  inCall: boolean;
}

export type SyncStatus = 'no-player' | 'peer-no-player' | 'different-title' | 'synchronizing' | 'in-sync' | 'idle';

/** Snapshot of everything the UI needs. Produced by RoomClient, consumed by overlay + popup. */
export interface RoomStatus {
  phase: ConnectionPhase;
  error: string | null;
  roomId: string | null;
  role: Role | null;
  selfName: string;
  peer: PeerInfo | null;
  transport: 'none' | 'datachannel' | 'relay-fallback';
  rtt: number | null;
  /** Media goes through a TURN relay (not directly between the two computers). */
  relayed: boolean;
  player: PlayerStatus;
  titleId: string | null;
  sync: SyncStatus;
  driftMs: number | null;
  /** 'following': I mirror my friend. 'followed': my friend mirrors me. */
  follow: 'none' | 'following' | 'followed';
  call: CallStatus;
  /** Shared pauses / ready checks / countdowns. */
  party: PartyState;
  /** Which site this tab is on ("Netflix", "YouTube"). */
  siteName: string;
  hostingTab: boolean;
  updatedAt: number;
}

export type HoldKind = 'none' | 'brb' | 'buffering' | 'ready-check';
export interface PartyState {
  hold: HoldKind;
  /** brb: who stepped away · buffering: whose video is loading · ready-check: who asked. */
  by: 'me' | 'peer' | 'both' | null;
  meReady: boolean;
  peerReady: boolean;
  /** Epoch ms (local clock) when the hold began, for a "away for 2:13" timer. */
  since: number;
  /** Epoch ms (local clock) at which playback resumes, while a countdown runs. */
  countdownTo: number | null;
  /** Short countdown for buffering recovery (a toast, not the big 3-2-1). */
  countdownQuick: boolean;
  /** buffering: the wait is because of an advert (YouTube), not a slow connection. */
  why: 'ad' | null;
  /** Epoch ms of the last resume, so the UI can flash "GO!". */
  goAt: number;
}

export const initialParty = (): PartyState => ({ hold: 'none', by: null, meReady: false, peerReady: false, since: 0, countdownTo: null, countdownQuick: false, why: null, goAt: 0 });

export interface CallStatus {
  active: boolean;
  micOn: boolean;
  camOn: boolean;
  remoteMicOn: boolean;
  remoteCamOn: boolean;
  quality: 'unknown' | 'good' | 'fair' | 'poor';
  iceState: RTCIceConnectionState | 'new';
  /** Delivery checks (null = not measured yet). rx* = frames actually arriving here; peerRx* = what the friend reports receiving from us. */
  rxVideo: boolean | null;
  rxAudio: boolean | null;
  txVideo: boolean | null;
  peerRxVideo: boolean | null;
  peerRxAudio: boolean | null;
  error: string | null;
}

export const initialStatus = (): RoomStatus => ({
  phase: 'idle',
  error: null,
  roomId: null,
  role: null,
  selfName: '',
  peer: null,
  transport: 'none',
  rtt: null,
  relayed: false,
  player: 'none',
  titleId: null,
  sync: 'idle',
  follow: 'none',
  driftMs: null,
  call: {
    active: false, micOn: false, camOn: false, remoteMicOn: false, remoteCamOn: false,
    quality: 'unknown', iceState: 'new', rxVideo: null, rxAudio: null, txVideo: null, peerRxVideo: null, peerRxAudio: null, error: null,
  },
  party: initialParty(),
  siteName: '',
  hostingTab: false,
  updatedAt: Date.now(),
});
