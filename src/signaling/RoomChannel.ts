import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { PROTOCOL_VERSION, validateEnvelope, validatePresence, type PresencePayload, type SignalEnvelope, type SignalPayload } from '@/shared/protocol';
import { log } from '@/shared/logger';
import { Emitter, errorMessage } from '@/shared/util';
import { ensureAuth } from '@/rooms/supabaseClient';

export type ChannelStatus = 'connecting' | 'subscribed' | 'reconnecting' | 'closed';

export interface PeerPresence extends PresencePayload {
  userId: string;
}

type Events = {
  status: { status: ChannelStatus; error: string | null };
  peer: PeerPresence | null;
  signal: SignalEnvelope;
};

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];

/**
 * Private Supabase Realtime channel for one room: presence (who's here) + broadcast (signaling).
 * Authorization is enforced server-side by RLS on realtime.messages; everything we receive is
 * additionally validated client-side.
 */
export class RoomChannel extends Emitter<Events> {
  private channel: RealtimeChannel | null = null;
  private stopped = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private presence: PresencePayload;
  private peerKey = '';

  constructor(
    private sb: SupabaseClient,
    private roomId: string,
    readonly me: string,
    initialPresence: PresencePayload,
  ) {
    super();
    this.presence = initialPresence;
  }

  get gen() { return this.presence.gen; }

  start() {
    this.stopped = false;
    this.connect();
  }

  private async connect() {
    if (this.stopped) return;
    this.emit('status', { status: this.attempt === 0 ? 'connecting' : 'reconnecting', error: null });
    try {
      await ensureAuth(this.sb); // refreshes the realtime JWT; re-creates anon session if lost
    } catch (e) {
      return this.scheduleRetry(errorMessage(e));
    }
    if (this.stopped) return;

    this.teardownChannel();
    const ch = this.sb.channel(`room:${this.roomId}`, {
      config: { private: true, broadcast: { self: false, ack: false }, presence: { key: this.me } },
    });
    this.channel = ch;

    ch.on('presence', { event: 'sync' }, () => this.syncPeer());
    ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const env = validateEnvelope(payload, this.me);
      if (!env) return log.warn('dropped malformed signal');
      // Only accept messages from the participant we currently see in presence.
      if (this.peerKey && env.from !== this.peerKey) return log.warn('dropped signal from unknown sender');
      this.emit('signal', env);
    });

    ch.subscribe(async (status, err) => {
      if (this.stopped || this.channel !== ch) return;
      if (status === 'SUBSCRIBED') {
        this.attempt = 0;
        this.emit('status', { status: 'subscribed', error: null });
        await ch.track(this.presence).catch((e) => log.warn('track failed', e));
        this.syncPeer();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        const reason = err ? errorMessage(err) : status === 'TIMED_OUT' ? 'Realtime timed out' : 'Realtime channel closed';
        this.scheduleRetry(reason);
      }
    });
  }

  private scheduleRetry(reason: string) {
    if (this.stopped || this.retryTimer) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt++;
    log.warn(`realtime down (${reason}); retry #${this.attempt} in ${delay}ms`);
    this.peerKey = '';
    this.emit('peer', null);
    this.emit('status', { status: 'reconnecting', error: reason });
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.connect(); }, delay);
  }

  private syncPeer() {
    if (!this.channel) return;
    const state = this.channel.presenceState<Record<string, unknown>>();
    let found: PeerPresence | null = null;
    for (const [key, metas] of Object.entries(state)) {
      if (key === this.me) continue;
      // Newest meta wins if one participant has several (e.g. quick refresh).
      for (const meta of [...metas].reverse()) {
        const p = validatePresence(meta);
        if (p) { found = { ...p, userId: key }; break; }
      }
      if (found) break;
    }
    this.peerKey = found?.userId ?? '';
    this.emit('peer', found);
  }

  async updatePresence(patch: Partial<PresencePayload>) {
    this.presence = { ...this.presence, ...patch };
    if (this.channel && !this.stopped) await this.channel.track(this.presence).catch(() => undefined);
  }

  async sendSignal(to: string, payload: SignalPayload): Promise<boolean> {
    if (!this.channel || this.stopped) return false;
    const envelope: SignalEnvelope = { v: PROTOCOL_VERSION, from: this.me, to, gen: this.presence.gen, payload };
    try {
      const res = await this.channel.send({ type: 'broadcast', event: 'signal', payload: envelope });
      return res === 'ok';
    } catch { return false; }
  }

  private teardownChannel() {
    if (this.channel) {
      const ch = this.channel;
      this.channel = null;
      void this.sb.removeChannel(ch).catch(() => undefined);
    }
  }

  async stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ch = this.channel;
    if (ch) { await ch.untrack().catch(() => undefined); }
    this.teardownChannel();
    this.emit('status', { status: 'closed', error: null });
    this.removeAllListeners();
  }
}
