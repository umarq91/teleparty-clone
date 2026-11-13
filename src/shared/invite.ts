import { INVITE_HASH_KEY, NETFLIX_ORIGIN } from './constants';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_RE = /^[A-Za-z0-9_-]{22,128}$/;

export interface InviteToken {
  roomId: string;
  secret: string;
}

/** 24 bytes -> 32 url-safe chars, 192 bits of entropy. */
export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const formatToken = (t: InviteToken): string => `${t.roomId}.${t.secret}`;

export function parseToken(raw: string): InviteToken | null {
  const [roomId, secret, ...rest] = raw.trim().split('.');
  if (rest.length || !roomId || !secret) return null;
  if (!UUID_RE.test(roomId) || !SECRET_RE.test(secret)) return null;
  return { roomId: roomId.toLowerCase(), secret };
}

/** The link opens `origin` (Netflix by default, or YouTube) where the extension offers to join. Either site works for watching. */
export function buildInviteLink(t: InviteToken, origin: string = NETFLIX_ORIGIN): string {
  return `${origin}/#${INVITE_HASH_KEY}=${formatToken(t)}`;
}

/** Accepts a full invite link, a "#mtp=..." hash, or a bare "roomId.secret" code. */
export function parseInvite(input: string): InviteToken | null {
  const text = input.trim();
  if (!text) return null;
  const m = text.match(new RegExp(`${INVITE_HASH_KEY}=([A-Za-z0-9._-]+)`));
  return parseToken(m?.[1] ?? text);
}
