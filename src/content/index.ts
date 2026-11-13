import { HOST_LOCK_NAME } from '@/shared/constants';
import { buildInviteLink } from '@/shared/invite';
import { log } from '@/shared/logger';
import { sendRuntime } from '@/shared/messaging';
import { clearSession, clearStatus, getSession, getSettings, onSessionChange, onSettingsChange, publishStatus } from '@/shared/storage';
import type { RoomSession } from '@/shared/types';
import { mountOverlay } from '@/floating-ui/mount';
import { adapterForHost, type SiteAdapter } from '@/player/sites';
import { acquireLease, holdLease, releaseLease } from './lease';
import { RoomClient } from './RoomClient';
import { promptJoin, takeInviteFromUrl } from './inviteBanner';

/**
 * Content-script entry (Netflix and YouTube). One tab at a time "hosts" the room, so refreshing,
 * opening a second tab or navigating never creates duplicate peers or presence entries:
 *  - a Web Lock serialises tabs of the same site,
 *  - a storage lease (lease.ts) serialises across sites (a Netflix tab and a YouTube tab).
 * Other tabs wait and take over automatically if the hosting tab goes away (or, if it is hidden, when they become visible).
 */

let current: { session: RoomSession; abort: AbortController } | null = null;

const sameSession = (a?: RoomSession | null, b?: RoomSession | null) =>
  !!a && !!b && a.roomId === b.roomId && a.secret === b.secret && a.displayName === b.displayName;

function apply(session: RoomSession | undefined | null, adapter: SiteAdapter) {
  if (sameSession(current?.session, session)) return;
  current?.abort.abort();
  current = null;
  if (!session) return;
  const abort = new AbortController();
  current = { session, abort };
  navigator.locks
    .request(HOST_LOCK_NAME, { signal: abort.signal }, async () => {
      // Re-acquire after losing the lease to a tab on the other site: we simply go back to waiting.
      while (!abort.signal.aborted) {
        if (!(await acquireLease(abort.signal))) break;
        const run = new AbortController();
        const forward = () => run.abort();
        abort.signal.addEventListener('abort', forward, { once: true });
        const stop = holdLease(() => run.abort());
        try { await hostRoom(session, run.signal, adapter); } finally {
          stop();
          abort.signal.removeEventListener('abort', forward);
          await releaseLease();
        }
      }
    })
    .catch((e: unknown) => { if ((e as { name?: string })?.name !== 'AbortError') log.error('lock error', e); });
}

async function hostRoom(session: RoomSession, signal: AbortSignal, adapter: SiteAdapter): Promise<void> {
  const client = new RoomClient(session, await getSettings(), adapter);
  const overlay = mountOverlay(client, buildInviteLink(session, adapter.origin), () => { void client.dispose(true); });
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
  const adapter = adapterForHost(location.hostname);
  if (!adapter) return;
  onSessionChange((s) => apply(s, adapter));
  const invite = takeInviteFromUrl();
  const existing = await getSession();
  apply(existing, adapter);
  if (invite && !(existing && existing.roomId === invite.roomId)) {
    const show = () => promptJoin(invite);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true }); else show();
  }
}

void main().catch((e) => log.error('init failed', e));
