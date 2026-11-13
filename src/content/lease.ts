import { HOST_LEASE_KEY } from '@/shared/constants';
import { randomId, sleep } from '@/shared/util';

/**
 * Only ONE tab may host the room (two would join as two peers). Web Locks already guarantee that per
 * *origin*, but Netflix and YouTube are different origins, so a second mechanism is needed across them:
 * a small lease in chrome.storage.local, refreshed while hosting.
 *
 *  - A lease older than TTL is dead (tab closed / crashed) and may be taken over.
 *  - A visible tab may take the lease from a tab that reports itself hidden, so the panel follows the
 *    video you are actually watching.
 *  - After writing, we wait a beat and read back: if someone else wrote at the same instant, last write
 *    wins and the loser simply keeps waiting.
 */

export interface Lease { id: string; at: number; visible: boolean }

const TTL_MS = 5000;
const BEAT_MS = 1500;
const SETTLE_MS = 250;
const POLL_MS = 1500;

export const TAB_ID = randomId(6);

const visible = () => document.visibilityState === 'visible';

async function read(): Promise<Lease | null> {
  const r = await chrome.storage.local.get(HOST_LEASE_KEY);
  const l = r[HOST_LEASE_KEY] as Lease | undefined;
  return l && typeof l.id === 'string' && Number.isFinite(l.at) ? l : null;
}
const write = (): Promise<void> => chrome.storage.local.set({ [HOST_LEASE_KEY]: { id: TAB_ID, at: Date.now(), visible: visible() } satisfies Lease });

/** Pure rule, exported for tests: may this tab take the lease right now? */
export function canTake(lease: Lease | null, me: string, meVisible: boolean, now: number): boolean {
  if (!lease || lease.id === me) return true;
  if (now - lease.at > TTL_MS) return true;
  return meVisible && !lease.visible;
}

/** Resolves true once this tab owns the lease, false if `signal` aborts first. */
export async function acquireLease(signal: AbortSignal): Promise<boolean> {
  while (!signal.aborted) {
    try {
      if (canTake(await read(), TAB_ID, visible(), Date.now())) {
        await write();
        await sleep(SETTLE_MS);
        if ((await read())?.id === TAB_ID) return true;
      }
    } catch { /* storage hiccup: retry */ }
    await sleep(POLL_MS);
  }
  return false;
}

/** Keep the lease fresh while hosting; calls `onLost` (once) if another tab took it. Returns a stop function. */
export function holdLease(onLost: () => void): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    void (async () => {
      try {
        const l = await read();
        if (stopped) return;
        if (l && l.id !== TAB_ID && !(Date.now() - l.at > TTL_MS)) { stopped = true; clearInterval(timer); onLost(); return; }
        await write();
      } catch { /* try again next beat */ }
    })();
  }, BEAT_MS);
  return () => { stopped = true; clearInterval(timer); };
}

export async function releaseLease(): Promise<void> {
  try { if ((await read())?.id === TAB_ID) await chrome.storage.local.remove(HOST_LEASE_KEY); } catch { /* expires on its own */ }
}
