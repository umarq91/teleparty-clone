/**
 * Wire protocol + strict validators. Everything arriving from the network is `unknown`
 * until it passes one of these functions. Never trust peers: check type, shape, ranges.
 */

export const PROTOCOL_VERSION = 1;

export type SyncType = 'PLAY' | 'PAUSE' | 'SEEK' | 'PERIODIC_SYNC' | 'PLAYER_READY' | 'PLAYER_NOT_FOUND' | 'SYNC_REQUEST' | 'FOLLOW_START' | 'FOLLOW_STOP';
export const SYNC_TYPES: readonly SyncType[] = ['PLAY', 'PAUSE', 'SEEK', 'PERIODIC_SYNC', 'PLAYER_READY', 'PLAYER_NOT_FOUND', 'SYNC_REQUEST', 'FOLLOW_START', 'FOLLOW_STOP'];

export interface PlaybackState {
  position: number; // seconds
  playing: boolean;
  rate: number;
}

export interface SyncMessage {
  kind: 'sync';
  v: number;
  type: SyncType;
  seq: number;
  /** Sender's wall clock (ms) at the instant `state` was sampled. */
  sentAt: number;
  titleId: string | null;
  state: PlaybackState | null;
  /** PLAYER_READY only: how long (ms) the sender's player has been ready. A duration, so clock skew is irrelevant. */
  readyAgeMs?: number;
}

export interface PingMessage { kind: 'ping'; v: number; t0: number }
export interface PongMessage { kind: 'pong'; v: number; t0: number; t1: number }
/** rxVideo/rxAudio: whether the sender is actually *receiving* the other side's frames (delivery check). */
export interface MediaStateMessage { kind: 'media'; v: number; micOn: boolean; camOn: boolean; rxVideo?: boolean; rxAudio?: boolean }
/** "Please re-attach your camera/mic and restart ICE": sent by a side that is not getting your media. */
export interface FixMediaMessage { kind: 'fix'; v: number }
/** A sticker/emoji/GIF reaction. Exactly one of `emoji` or `gif` is set. */
export interface ReactMessage { kind: 'react'; v: number; emoji?: string; gif?: string; label?: string }
export type PeerMessage = SyncMessage | PingMessage | PongMessage | MediaStateMessage | FixMediaMessage | ReactMessage;

/** Only GIPHY's CDN is accepted for remote GIFs: a peer must not be able to make us load arbitrary URLs. */
export const GIF_URL_RE = /^https:\/\/(?:media\d{0,2}|i)\.giphy\.com\/[\w\-./]{1,200}$/;
export const isAllowedGifUrl = (u: unknown): u is string => typeof u === 'string' && u.length <= 300 && GIF_URL_RE.test(u);
const EMOJI_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f]{1,16}$/u;

/** Signaling payloads travel over the Supabase broadcast channel. */
export type SignalPayload =
  | { kind: 'description'; description: { type: 'offer' | 'answer'; sdp: string } }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit | null }
  | { kind: 'hello' } // "I'm here, (re)start negotiation"
  | { kind: 'sync-relay'; message: SyncMessage }; // fallback when the DataChannel is down

export interface SignalEnvelope {
  v: number;
  from: string;
  to: string;
  /** Per-tab connection generation so stale messages from a previous tab/session are dropped. */
  gen: string;
  payload: SignalPayload;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown, min = -Infinity, max = Infinity): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
const isStr = (x: unknown, max = 100_000): x is string => typeof x === 'string' && x.length <= max;

export const MAX_POSITION_SEC = 60 * 60 * 24;

export function validatePlayback(x: unknown): PlaybackState | null {
  if (!isObj(x)) return null;
  const { position, playing, rate } = x;
  if (!isNum(position, 0, MAX_POSITION_SEC) || typeof playing !== 'boolean' || !isNum(rate, 0.25, 4)) return null;
  return { position, playing, rate };
}

export function validateSync(x: unknown): SyncMessage | null {
  if (!isObj(x) || x.kind !== 'sync' || x.v !== PROTOCOL_VERSION) return null;
  if (!isStr(x.type, 32) || !(SYNC_TYPES as readonly string[]).includes(x.type)) return null;
  if (!isNum(x.seq, 0, Number.MAX_SAFE_INTEGER) || !isNum(x.sentAt, 0, Number.MAX_SAFE_INTEGER)) return null;
  const titleId = x.titleId === null ? null : isStr(x.titleId, 32) && /^\d{1,20}$/.test(x.titleId) ? x.titleId : undefined;
  if (titleId === undefined) return null;
  const type = x.type as SyncType;
  let state: PlaybackState | null = null;
  if (x.state !== null && x.state !== undefined) {
    state = validatePlayback(x.state);
    if (!state) return null;
  }
  const needsState = type === 'PLAY' || type === 'PAUSE' || type === 'SEEK' || type === 'PERIODIC_SYNC';
  if (needsState && !state) return null;
  const msg: SyncMessage = { kind: 'sync', v: PROTOCOL_VERSION, type, seq: x.seq, sentAt: x.sentAt, titleId, state };
  if (x.readyAgeMs !== undefined) {
    if (!isNum(x.readyAgeMs, 0, 1e11)) return null;
    msg.readyAgeMs = x.readyAgeMs;
  }
  return msg;
}

export function validatePeerMessage(x: unknown): PeerMessage | null {
  if (!isObj(x) || x.v !== PROTOCOL_VERSION) return null;
  switch (x.kind) {
    case 'sync': return validateSync(x);
    case 'ping': return isNum(x.t0, 0) ? { kind: 'ping', v: PROTOCOL_VERSION, t0: x.t0 } : null;
    case 'pong': return isNum(x.t0, 0) && isNum(x.t1, 0) ? { kind: 'pong', v: PROTOCOL_VERSION, t0: x.t0, t1: x.t1 } : null;
    case 'media':
      if (typeof x.micOn !== 'boolean' || typeof x.camOn !== 'boolean') return null;
      return {
        kind: 'media', v: PROTOCOL_VERSION, micOn: x.micOn, camOn: x.camOn,
        ...(typeof x.rxVideo === 'boolean' ? { rxVideo: x.rxVideo } : {}),
        ...(typeof x.rxAudio === 'boolean' ? { rxAudio: x.rxAudio } : {}),
      };
    case 'fix': return { kind: 'fix', v: PROTOCOL_VERSION };
    case 'react': {
      const label = isStr(x.label, 40) ? x.label : undefined;
      if (x.gif !== undefined) return isAllowedGifUrl(x.gif) ? { kind: 'react', v: PROTOCOL_VERSION, gif: x.gif, ...(label ? { label } : {}) } : null;
      if (isStr(x.emoji, 32) && EMOJI_RE.test(x.emoji)) return { kind: 'react', v: PROTOCOL_VERSION, emoji: x.emoji, ...(label ? { label } : {}) };
      return null;
    }
    default: return null;
  }
}

function validateCandidate(c: unknown): RTCIceCandidateInit | null {
  if (c === null) return null;
  if (!isObj(c) || !isStr(c.candidate, 2000)) return null;
  const out: RTCIceCandidateInit = { candidate: c.candidate };
  if (c.sdpMid !== undefined && c.sdpMid !== null) { if (!isStr(c.sdpMid, 64)) return null; out.sdpMid = c.sdpMid; }
  if (c.sdpMLineIndex !== undefined && c.sdpMLineIndex !== null) { if (!isNum(c.sdpMLineIndex, 0, 64)) return null; out.sdpMLineIndex = c.sdpMLineIndex; }
  if (c.usernameFragment !== undefined && c.usernameFragment !== null) { if (!isStr(c.usernameFragment, 256)) return null; out.usernameFragment = c.usernameFragment; }
  return out;
}

/** Returns the envelope iff it is well formed and addressed to `me` from someone else. */
export function validateEnvelope(x: unknown, me: string): SignalEnvelope | null {
  if (!isObj(x) || x.v !== PROTOCOL_VERSION) return null;
  if (!isStr(x.from, 64) || !isStr(x.to, 64) || !isStr(x.gen, 64)) return null;
  if (x.to !== me || x.from === me) return null;
  const p = x.payload;
  if (!isObj(p)) return null;
  let payload: SignalPayload | null = null;
  switch (p.kind) {
    case 'hello': payload = { kind: 'hello' }; break;
    case 'description': {
      const d = p.description;
      if (isObj(d) && (d.type === 'offer' || d.type === 'answer') && isStr(d.sdp, 60_000)) {
        payload = { kind: 'description', description: { type: d.type, sdp: d.sdp } };
      }
      break;
    }
    case 'candidate': {
      if (p.candidate === null) { payload = { kind: 'candidate', candidate: null }; break; }
      const c = validateCandidate(p.candidate);
      if (c) payload = { kind: 'candidate', candidate: c };
      break;
    }
    case 'sync-relay': {
      const m = validateSync(p.message);
      if (m) payload = { kind: 'sync-relay', message: m };
      break;
    }
  }
  return payload ? { v: PROTOCOL_VERSION, from: x.from, to: x.to, gen: x.gen, payload } : null;
}

/** Presence payload (also validated: it is peer-controlled). */
export interface PresencePayload {
  name: string;
  role: 'host' | 'guest';
  gen: string;
  playerStatus: 'none' | 'not-found' | 'ready';
  titleId: string | null;
  inCall: boolean;
}

export function validatePresence(x: unknown): PresencePayload | null {
  if (!isObj(x)) return null;
  const { name, role, gen, playerStatus, titleId, inCall } = x;
  if (!isStr(name, 40) || name.trim() === '') return null;
  if (role !== 'host' && role !== 'guest') return null;
  if (!isStr(gen, 64)) return null;
  if (playerStatus !== 'none' && playerStatus !== 'not-found' && playerStatus !== 'ready') return null;
  if (titleId !== null && !(isStr(titleId, 32) && /^\d{1,20}$/.test(titleId))) return null;
  if (typeof inCall !== 'boolean') return null;
  return { name, role, gen, playerStatus, titleId: titleId as string | null, inCall };
}
