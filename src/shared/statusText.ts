import type { RoomStatus } from './types';

export type Tone = 'ok' | 'warn' | 'bad' | 'idle';
export interface Label { text: string; tone: Tone }

/** Human-readable connection state. Derived strictly from real state — nothing is assumed. */
export function connectionLabel(s: RoomStatus): Label {
  switch (s.phase) {
    case 'idle': return { text: 'Not connected', tone: 'idle' };
    case 'connecting': return { text: 'Connecting to room…', tone: 'warn' };
    case 'waiting-for-friend': return { text: 'Waiting for friend', tone: 'warn' };
    case 'friend-connected': return { text: 'Friend connected', tone: 'ok' };
    case 'negotiating': return { text: 'Friend connected · linking up…', tone: 'warn' };
    case 'connected': return { text: 'Connected', tone: 'ok' };
    case 'reconnecting': return { text: 'Reconnecting…', tone: 'warn' };
    case 'disconnected': return { text: 'Disconnected', tone: 'bad' };
    case 'error': return { text: s.error ?? 'Something went wrong', tone: 'bad' };
  }
}

const site = (s: RoomStatus) => s.siteName || 'Video';

export function playerLabel(s: RoomStatus): Label {
  switch (s.player) {
    case 'ready': return { text: `${site(s)} player detected`, tone: 'ok' };
    case 'not-found': return { text: `${site(s)} player not found on this page`, tone: 'bad' };
    case 'none': return { text: s.titleId ? `Connecting to ${site(s)}…` : 'Open a video to start', tone: s.titleId ? 'warn' : 'idle' };
  }
}

export function syncLabel(s: RoomStatus): Label {
  switch (s.sync) {
    case 'no-player': return { text: 'Sync paused · no player here', tone: 'idle' };
    case 'peer-no-player': return { text: `Sync paused · ${s.peer?.name ?? 'friend'} hasn’t opened a title`, tone: 'warn' };
    case 'different-title': return { text: `${s.peer?.name ?? 'Friend'} is watching something else`, tone: 'warn' };
    case 'synchronizing': return { text: 'Synchronizing…', tone: 'warn' };
    case 'in-sync': return { text: 'In sync', tone: 'ok' };
    case 'idle': return { text: 'Sync idle', tone: 'idle' };
  }
}

export function callLabel(s: RoomStatus): Label {
  const c = s.call;
  if (!c.active && !s.peer?.inCall) return { text: 'Call off', tone: 'idle' };
  if (s.phase !== 'connected') return { text: c.active ? 'Call disconnected' : 'Call off', tone: c.active ? 'bad' : 'idle' };
  if (c.iceState === 'failed' || c.iceState === 'disconnected') return { text: 'Call disconnected', tone: 'bad' };
  if (c.quality === 'poor') return { text: 'Poor connection', tone: 'bad' };
  if (c.quality === 'fair') return { text: 'Fair connection', tone: 'warn' };
  if (c.active && !s.peer?.inCall) return { text: 'Waiting for friend to join the call', tone: 'warn' };
  return { text: c.quality === 'good' ? 'Call connected' : 'Call connecting…', tone: c.quality === 'good' ? 'ok' : 'warn' };
}

/** Delivery check: do we see them, do they see us? `fix` = a mismatch worth a "Fix video" click. */
export function videoLabel(s: RoomStatus): (Label & { fix: boolean }) | null {
  const c = s.call;
  if (!c.active || s.phase !== 'connected') return null;
  const issues: string[] = [];
  let unknown = false;
  if (c.remoteCamOn) { if (c.rxVideo === false) issues.push('their video isn’t arriving'); else if (c.rxVideo === null) unknown = true; }
  if (c.camOn && c.txVideo === false) issues.push('your camera isn’t sending');
  else if (c.camOn) { if (c.peerRxVideo === false) issues.push('sent, but it isn’t reaching them (weak link)'); else if (c.peerRxVideo === null) unknown = true; }
  if (c.remoteMicOn && c.rxAudio === false) issues.push('their audio isn’t arriving');
  if (issues.length) return { text: issues.join(' · ').replace(/^./, (x) => x.toUpperCase()), tone: 'bad', fix: true };
  if (unknown) return { text: 'Checking video…', tone: 'warn', fix: false };
  if (!c.camOn && !c.remoteCamOn) return { text: 'Cameras off', tone: 'idle', fix: false };
  return { text: `${c.remoteCamOn ? 'You see them ✓' : 'Their camera is off'}${c.camOn ? ' · They see you ✓' : ''}`, tone: 'ok', fix: false };
}
