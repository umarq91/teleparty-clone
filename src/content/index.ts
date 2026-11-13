import { HOST_LOCK_NAME } from '@/shared/constants';
import { buildInviteLink } from '@/shared/invite';
import { log } from '@/shared/logger';
import { sendRuntime } from '@/shared/messaging';
import { clearSession, clearStatus, getSession, getSettings, onSessionChange, onSettingsChange, publishStatus } from '@/shared/storage';
import type { RoomSession } from '@/shared/types';
import { mountOverlay } from '@/floating-ui/mount';
import { RoomClient } from './RoomClient';
import { promptJoin, takeInviteFromUrl } from './inviteBanner';

/**
 * Content-script entry. One Netflix tab at a time "hosts" the room (Web Lock), so refreshing,
 * opening a second Netflix tab or navigating never creates duplicate peers or presence entries.
 * Other tabs queue on the lock and take over automatically if the hosting tab goes away.
 */

let current: { session: RoomSession; abort: AbortController } | null = null;

const sameSession = (a?: RoomSession | null, b?: RoomSession | null) =>
  !!a && !!b && a.roomId === b.roomId && a.secret === b.secret && a.displayName === b.displayName;

function apply(session: RoomSession | undefined | null) {
  if (sameSession(current?.session, session)) return;
  current?.abort.abort();
  current = null;
  if (!session) return;
  const abort = new AbortController();
  current = { session, abort };
  navigator.locks
    .request(HOST_LOCK_NAME, { signal: abort.signal }, () => hostRoom(session, abort.signal))
    .catch((e: unknown) => { if ((e as { name?: string })?.name !== 'AbortError') log.error('lock error', e); });
}

async function hostRoom(session: RoomSession, signal: AbortSignal): Promise<void> {
  const client = new RoomClient(session, await getSettings());
  const overlay = mountOverlay(client, buildInviteLink(session), () => { void client.dispose(true); });
  let lastPublish = 0;
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  const publish = () => {
    lastPublish = Date.now();
    void publishStatus(client.snapshot).catch(() => undefined);
    const s = client.snapshot;
    void sendRuntime({ type: 'SET_BADGE', ...(s.phase === 'connected' ? { text: 'ON', color: '#22c55e' } : s.phase === 'error' ? { text: '!', color: '#ef4444' } : { text: '…', color: '#f59e0b' }) });
  };
  const offStatus = client.on('status', () => {
    if (publishTimer) return;
    publishTimer = setTimeout(() => { publishTimer = null; publish(); }, Math.max(0, 300 - (Date.now() - lastPublish)));
  });
  client.on('evicted', (reason) => { log.warn('evicted:', reason); void clearSession(); });
  const offSettings = onSettingsChange(() => void getSettings().then((s) => client.updateSettings(s)));
  const onHide = () => { void client.dispose(false); };
  window.addEventListener('pagehide', onHide);

  await client.start();
  publish();

  // Hold the lock until we're told to stop.
  await new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener('abort', () => resolve(), { once: true });
  });

  offStatus();
  offSettings();
  window.removeEventListener('pagehide', onHide);
  if (publishTimer) clearTimeout(publishTimer);
  overlay.unmount();
  await client.dispose(false);
  await clearStatus().catch(() => undefined);
  void sendRuntime({ type: 'SET_BADGE', text: '' });
}

async function main() {
  if (window.top !== window) return;
  onSessionChange((s) => apply(s));
  const invite = takeInviteFromUrl();
  const existing = await getSession();
  apply(existing);
  if (invite && !(existing && existing.roomId === invite.roomId)) {
    const show = () => promptJoin(invite);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true }); else show();
  }
}

void main().catch((e) => log.error('init failed', e));
