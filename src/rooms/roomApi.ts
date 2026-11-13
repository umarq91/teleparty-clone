import { generateSecret, type InviteToken } from '@/shared/invite';
import { setSession, clearSession } from '@/shared/storage';
import type { Role, RoomSession } from '@/shared/types';
import { ensureAuth, getSupabase } from './supabaseClient';

export class RoomError extends Error {
  constructor(public code: 'not_found' | 'full' | 'auth' | 'network' | 'unknown', message: string) { super(message); }
}

function mapError(e: { message?: string; code?: string } | null | undefined): RoomError {
  const m = e?.message ?? '';
  if (m.includes('room_not_found') || e?.code === 'P0002') return new RoomError('not_found', 'Room not found or the invite is invalid/expired.');
  if (m.includes('room_full') || e?.code === 'P0001') return new RoomError('full', 'This room already has two people.');
  if (m.includes('not_authenticated')) return new RoomError('auth', 'Not authenticated with Supabase.');
  if (m.toLowerCase().includes('fetch')) return new RoomError('network', 'Network error talking to Supabase.');
  return new RoomError('unknown', m || 'Unknown error');
}

export async function createRoom(displayName: string): Promise<{ session: RoomSession; token: InviteToken }> {
  const sb = await getSupabase();
  await ensureAuth(sb);
  const secret = generateSecret();
  const { data, error } = await sb.rpc('create_room', { p_secret: secret, p_display_name: displayName });
  if (error || typeof data !== 'string') throw mapError(error);
  const session: RoomSession = { roomId: data, secret, role: 'host', displayName, joinedAt: Date.now() };
  await setSession(session);
  return { session, token: { roomId: data, secret } };
}

export async function joinRoom(token: InviteToken, displayName: string): Promise<RoomSession> {
  const sb = await getSupabase();
  await ensureAuth(sb);
  const { data, error } = await sb.rpc('join_room', { p_room_id: token.roomId, p_secret: token.secret, p_display_name: displayName });
  if (error || !data) throw mapError(error);
  const role = (data as { role?: Role }).role === 'host' ? 'host' : 'guest';
  const session: RoomSession = { roomId: token.roomId, secret: token.secret, role, displayName, joinedAt: Date.now() };
  await setSession(session);
  return session;
}

/** Heartbeat; false means the server no longer lists us as a member. */
export async function touchRoom(roomId: string): Promise<boolean> {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc('touch_room', { p_room_id: roomId });
  if (error) throw mapError(error);
  return data === true;
}

export async function leaveRoom(roomId: string): Promise<void> {
  try {
    const sb = await getSupabase();
    await sb.rpc('leave_room', { p_room_id: roomId });
  } catch { /* best effort: stale-member pruning cleans up anyway */ }
  await clearSession();
}
