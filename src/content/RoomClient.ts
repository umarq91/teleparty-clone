import type { SupabaseClient } from '@supabase/supabase-js';
import { HEARTBEAT_MS, PING_MS, STUN_SERVERS } from '@/shared/constants';
import { log } from '@/shared/logger';
import { PROTOCOL_VERSION, cleanChatText, isSoundId, type PeerMessage, type SoundId, type PresencePayload, type SignalEnvelope, type SyncMessage } from '@/shared/protocol';
import { initialStatus, type ConnectionPhase, type RoomSession, type RoomStatus, type Settings } from '@/shared/types';
import { Emitter, errorMessage, randomId } from '@/shared/util';
import { ensureAuth, getSupabase } from '@/rooms/supabaseClient';
import { joinRoom, leaveRoom, touchRoom } from '@/rooms/roomApi';
import { RoomChannel, type ChannelStatus, type PeerPresence } from '@/signaling/RoomChannel';
import { PeerLink, type LinkStats } from '@/webrtc/PeerLink';
import { LocalMedia } from '@/webrtc/LocalMedia';
import { SyncEngine } from '@/player/SyncEngine';
import { VideoWatcher } from '@/player/VideoWatcher';
import { seekVideo } from '@/player/seek';
import { urlForTitle, type SiteAdapter } from '@/player/sites';
import { PartyControl } from './PartyControl';

type Events = {
  status: RoomStatus;
  remoteStream: MediaStream | null;
  notice: string | null;
  /** The server no longer lets us in (room deleted/full): the session should be discarded. */
  evicted: string;
  /** A sticker/emoji/GIF from the friend. */
  reaction: { from: string; emoji?: string; gif?: string; label?: string };
  chat: { id: string; from: string; text: string; mine: boolean };
  sound: { id: SoundId; from: string; mine: boolean };
};

const RTT_WINDOW = 8;
const CHAT_BURST = 6, CHAT_WINDOW_MS = 8000; // inbound flood limit
const SOUND_MIN_GAP_MS = 700;

function iceServers(s: Settings): RTCIceServer[] {
  const servers = [...STUN_SERVERS];
  const urls = s.turnUrls.split(',').map((u) => u.trim()).filter((u) => /^turns?:/i.test(u));
  if (urls.length) servers.push({ urls, username: s.turnUsername || undefined, credential: s.turnCredential || undefined });
  return servers;
}

/**
 * Orchestrates one participant's side of a room: signaling channel, peer link, local media,
 * the player watcher and the sync engine. Pure logic, no React.
 * Lives in the content script of exactly one tab on a supported site (Web Lock per site + a cross-site lease).
 */
export class RoomClient extends Emitter<Events> {
  readonly media = new LocalMedia();
  readonly party: PartyControl;
  private chatTimes: number[] = [];
  private lastSoundAt = 0;
  private lastSoundSent = 0;
  private sb!: SupabaseClient;
  private me = '';
  private channel: RoomChannel | null = null;
  private link: PeerLink | null = null;
  private peer: PeerPresence | null = null;
  private chanStatus: ChannelStatus = 'connecting';
  private chanError: string | null = null;
  private status: RoomStatus = initialStatus();
  private watcher: VideoWatcher;
  private sync: SyncEngine;
  private gen = randomId(6);
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private rttSamples: { rtt: number; offset: number }[] = [];
  private clockOffset = 0;
  private relayedSync = false;
  private stopped = false;
  private emitQueued = false;
  private unsubMedia: (() => void) | null = null;

  constructor(private session: RoomSession, private settings: Settings, private adapter: SiteAdapter) {
    super();
    this.watcher = new VideoWatcher(adapter);
    this.sync = new SyncEngine({
      send: (m) => this.sendSync(m),
      clockOffset: () => this.clockOffset,
      isAuthority: () => this.session.role === 'host',
      config: () => ({
        ignoreSec: this.settings.driftIgnoreSec,
        seekSec: this.settings.driftSeekSec,
        seekCooldownMs: 5000,
        maxRateDelta: 0.08,
        useBridge: this.settings.useNetflixSeekBridge && adapter.supportsSeekBridge,
      }),
      seek: (v, sec, bridge) => seekVideo(v as HTMLVideoElement, sec, bridge),
    });
    this.party = new PartyControl({
      send: (m) => this.sendPeer(m),
      clockOffset: () => this.clockOffset,
      isHost: () => this.session.role === 'host',
      hold: (o) => this.sync.hold(o),
      release: (o) => { void this.sync.release(o); },
      position: () => this.watcher.current?.currentTime ?? null,
      bufferHoldEnabled: () => this.settings.waitForBuffering,
      peerName: () => this.peer?.name ?? 'Your friend',
      notify: (m) => this.emit('notice', m),
    });
  }

  get snapshot(): RoomStatus { return this.status; }
  get remoteStream(): MediaStream | null { return this.link?.remoteStream ?? null; }

  updateSettings(s: Settings) { this.settings = s; }

  // ---- lifecycle --------------------------------------------------------------------------

  async start() {
    this.patch({ roomId: this.session.roomId, role: this.session.role, selfName: this.session.displayName, phase: 'connecting', hostingTab: true, siteName: this.adapter.name });

    // Player side runs regardless of the network so the user sees "player detected" early.
    this.sync.on('status', ({ sync, driftMs }) => this.patch({ sync, driftMs }));
    this.sync.on('notice', (n) => this.emit('notice', n));
    this.sync.on('follow', (follow) => this.patch({ follow }));
    this.sync.on('heldPlayAttempt', () => {
      const name = this.peer?.name ?? 'your friend';
      const h = this.party.state.hold;
      this.emit('notice', h === 'buffering' ? `Waiting for ${name}'s video to catch up. We'll restart together.`
        : h === 'ready-check' ? `Waiting for the ready check. ${name} hasn't said ready yet.`
        : `${name} paused for a break. Use "Resume" when you're both back.`);
    });
    this.party.on('state', (party) => this.patch({ party }));
    this.watcher.on('buffer', (b) => this.party.setLocalBuffering(b.on, b.why ?? null));
    this.watcher.on('player', ({ status, video, titleId }) => {
      this.sync.setPlayer(status, video, titleId);
      this.patch({ player: status, titleId });
      void this.channel?.updatePresence({ playerStatus: status, titleId });
    });
    this.watcher.on('event', ({ type }) => this.sync.onVideoEvent(type));
    this.sync.start();
    this.watcher.start();

    this.unsubMedia = this.media.on('change', (m) => {
      void this.link?.setLocalTracks(m.audio, m.video);
      this.patchCall({ micOn: m.micOn, camOn: m.camOn, active: this.media.isActive });
      this.sendMediaState();
      this.emit('remoteStream', this.remoteStream);
    });
    this.media.on('error', (e) => this.patchCall({ error: e }));

    try {
      this.sb = await getSupabase();
      this.me = await ensureAuth(this.sb);
      // Verify (and refresh) membership; handles "stale member got pruned while the tab was closed".
      await this.ensureMember();
    } catch (e) {
      return this.fail(errorMessage(e));
    }
    if (this.stopped) return;

    const presence: PresencePayload = {
      name: this.session.displayName, role: this.session.role, gen: this.gen,
      playerStatus: this.status.player, titleId: this.status.titleId, inCall: this.media.isActive,
    };
    this.channel = new RoomChannel(this.sb, this.session.roomId, this.me, presence);
    this.channel.on('status', ({ status, error }) => { this.chanStatus = status; this.chanError = error; this.recompute(); });
    this.channel.on('peer', (p) => this.onPeer(p));
    this.channel.on('signal', (env) => this.onSignal(env));
    this.channel.start();

    this.heartbeat = setInterval(() => void this.beat(), HEARTBEAT_MS);
    if (this.settings.autoStartCall) void this.startCall().catch(() => undefined);
  }

  private async ensureMember() {
    const ok = await touchRoom(this.session.roomId).catch(() => null);
    if (ok === false) {
      // Server forgot us (pruned as stale). Re-join with the invite secret if there is still room.
      await joinRoom({ roomId: this.session.roomId, secret: this.session.secret }, this.session.displayName);
    }
  }

  private async beat() {
    try {
      await ensureAuth(this.sb);
      const ok = await touchRoom(this.session.roomId);
      if (!ok) await joinRoom({ roomId: this.session.roomId, secret: this.session.secret }, this.session.displayName);
    } catch (e) {
      const msg = errorMessage(e);
      if (/full|not found|invalid/i.test(msg)) { this.emit('evicted', msg); return; }
      log.warn('heartbeat failed (will retry)', msg); // transient network trouble
    }
  }

  /** Stop everything and release devices. If `server`, also leave the room on the backend. */
  async dispose(server = false) {
    if (this.stopped) return;
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.unsubMedia?.();
    this.party.destroy();
    this.watcher.stop();
    this.sync.stop();
    this.media.stop();
    this.link?.close();
    this.link = null;
    await this.channel?.stop();
    this.channel = null;
    if (server) await leaveRoom(this.session.roomId);
    this.patch({ phase: 'idle', peer: null, hostingTab: false });
    this.removeAllListeners();
  }

  // ---- peer / signaling -------------------------------------------------------------------

  private onPeer(p: PeerPresence | null) {
    if (this.stopped) return;
    const prev = this.peer;
    this.peer = p;
    if (!p) {
      this.dropLink();
      this.sync.setPeerPlayer('none', null);
      this.sync.peerGone();
      this.party.peerGone();
      return this.recompute();
    }
    this.sync.setPeerPlayer(p.playerStatus, p.titleId);
    if (!this.link || this.link.peerId !== p.userId || this.link.remoteGen !== p.gen) {
      this.dropLink();
      this.createLink(p.userId, p.gen);
      // Answerer: if no offer shows up shortly, nudge the offerer.
      if (this.me > p.userId) {
        this.helloTimer = setTimeout(() => {
          if (this.link && this.link.pc.signalingState === 'stable' && !this.link.pc.remoteDescription) {
            void this.channel?.sendSignal(p.userId, { kind: 'hello' });
          }
        }, 3000);
      }
    }
    if (prev && prev.inCall !== p.inCall && !p.inCall) this.patchCall({ remoteCamOn: false, remoteMicOn: false });
    this.recompute();
  }

  private createLink(peerId: string, remoteGen: string) {
    const link = new PeerLink({
      peerId, remoteGen, isOfferer: this.me < peerId, iceServers: iceServers(this.settings),
      sendSignal: (payload) => { void this.channel?.sendSignal(peerId, payload); },
    });
    this.link = link;
    this.rttSamples = [];
    this.clockOffset = 0;
    link.on('dc', (open) => {
      if (open) {
        this.relayedSync = false;
        this.sendPeer(this.pingNow());
        this.sync.announcePlayer();
        this.sendMediaState();
        this.party.resend();
      }
      this.recompute();
    });
    link.on('message', (m) => this.onPeerMessage(m));
    link.on('remoteStream', (s) => this.emit('remoteStream', s));
    link.on('state', ({ ice }) => { this.patchCall({ iceState: ice }); this.recompute(); });
    link.on('stats', (s) => this.onStats(s));
    void link.setLocalTracks(this.media.state.audio, this.media.state.video);
    this.pingTimer ??= setInterval(() => this.sendPeer(this.pingNow()), PING_MS);
    this.emit('remoteStream', link.remoteStream);
  }

  private dropLink() {
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    this.link?.close();
    this.link = null;
    this.rttSamples = [];
    this.patch({ rtt: null });
    this.patchCall({ remoteCamOn: false, remoteMicOn: false, quality: 'unknown', iceState: 'new', rxVideo: null, rxAudio: null, txVideo: null, peerRxVideo: null, peerRxAudio: null });
    this.emit('remoteStream', null);
  }

  private onSignal(env: SignalEnvelope) {
    if (this.stopped) return;
    const p = env.payload;
    if (p.kind === 'sync-relay') {
      if (this.peer && env.from === this.peer.userId) void this.sync.handleRemote(p.message);
      return;
    }
    if (!this.link || this.link.peerId !== env.from || this.link.remoteGen !== env.gen) {
      // The peer restarted its tab (new generation) and opened with an offer/hello: rebuild the link.
      const restart = p.kind === 'hello' || (p.kind === 'description' && p.description.type === 'offer');
      if (!restart || (this.peer && this.peer.userId !== env.from)) return;
      this.dropLink();
      this.createLink(env.from, env.gen);
    }
    this.link!.handleSignal(p);
  }

  private onPeerMessage(m: PeerMessage) {
    switch (m.kind) {
      case 'sync': void this.sync.handleRemote(m); break;
      case 'ping': this.sendPeer({ kind: 'pong', v: PROTOCOL_VERSION, t0: m.t0, t1: Date.now() }); break;
      case 'pong': this.onPong(m.t0, m.t1); break;
      case 'media': this.patchCall({ remoteMicOn: m.micOn, remoteCamOn: m.camOn, peerRxVideo: m.rxVideo ?? null, peerRxAudio: m.rxAudio ?? null }); break;
      case 'fix': void this.fixMedia(false); break;
      case 'party': this.party.handle(m); break;
      case 'chat': {
        const now = Date.now();
        this.chatTimes = this.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
        if (this.chatTimes.length >= CHAT_BURST) break; // a flooding peer is simply ignored
        this.chatTimes.push(now);
        this.emit('chat', { id: m.id, from: this.peer?.name ?? 'Friend', text: m.text, mine: false });
        break;
      }
      case 'sound': {
        const now = Date.now();
        if (now - this.lastSoundAt < SOUND_MIN_GAP_MS) break;
        this.lastSoundAt = now;
        this.emit('sound', { id: m.id, from: this.peer?.name ?? 'Friend', mine: false });
        break;
      }
      case 'react': this.emit('reaction', { from: this.peer?.name ?? 'Friend', emoji: m.emoji, gif: m.gif, label: m.label }); break;
    }
  }

  private pingNow(): PeerMessage { return { kind: 'ping', v: PROTOCOL_VERSION, t0: Date.now() }; }

  /** NTP-style offset estimate; keep the lowest-RTT samples, they are the least asymmetric. */
  private onPong(t0: number, t1: number) {
    const t2 = Date.now();
    const rtt = t2 - t0;
    if (rtt < 0 || rtt > 10_000) return;
    this.rttSamples.push({ rtt, offset: t1 - (t0 + rtt / 2) });
    if (this.rttSamples.length > RTT_WINDOW) this.rttSamples.shift();
    const best = this.rttSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.clockOffset = best.offset;
    this.patch({ rtt });
  }

  private sendMediaState() {
    const c = this.status.call;
    this.sendPeer({ kind: 'media', v: PROTOCOL_VERSION, micOn: c.micOn, camOn: c.camOn, ...(c.rxVideo !== null ? { rxVideo: c.rxVideo } : {}), ...(c.rxAudio !== null ? { rxAudio: c.rxAudio } : {}) });
  }

  private lastFix = 0;
  /** Re-attach camera/mic and restart ICE. `askPeer`: also make the friend do the same for what they send. */
  async fixMedia(askPeer = true) {
    const link = this.link;
    if (!link || Date.now() - this.lastFix < 5000) return;
    this.lastFix = Date.now();
    if (askPeer) this.sendPeer({ kind: 'fix', v: PROTOCOL_VERSION });
    const m = this.media.state;
    await link.setLocalTracks(null, null);
    await link.setLocalTracks(m.audio, m.video);
    link.restartIce();
  }

  private onStats(s: LinkStats) {
    const prev = this.status.call;
    this.patchCall({ quality: s.quality, rxVideo: s.rxVideo, rxAudio: s.rxAudio, txVideo: s.txVideo });
    // Adapt to the link: poor/fair or lossy => low profile; only go back after it is clearly good.
    if (s.quality === 'poor' || (s.loss ?? 0) > 5) void this.link?.setLowBandwidth(true);
    else if (s.quality === 'good') void this.link?.setLowBandwidth(false);
    if (s.rxVideo !== prev.rxVideo || s.rxAudio !== prev.rxAudio) this.sendMediaState(); // tell the friend what actually reaches us
    if (s.rtt !== null) this.patch({ rtt: Math.round(s.rtt) });
    if (s.relayed !== this.status.relayed) this.patch({ relayed: s.relayed });
  }

  // ---- sending ----------------------------------------------------------------------------

  private sendPeer(m: PeerMessage): boolean { return this.link?.send(m) ?? false; }

  /** Playback commands prefer the DataChannel and fall back to the Supabase broadcast. */
  private sendSync(m: SyncMessage) {
    if (this.sendPeer(m)) { if (this.relayedSync) { this.relayedSync = false; this.recompute(); } return; }
    if (this.peer) {
      void this.channel?.sendSignal(this.peer.userId, { kind: 'sync-relay', message: m });
      if (!this.relayedSync) { this.relayedSync = true; this.recompute(); }
    }
  }

  /** Show a one-off message in the overlay. */
  notify(msg: string) { this.emit('notice', msg); }

  /** Send a short chat line. Returns false (and sends nothing) if the friend isn't reachable. */
  sendChat(raw: string): boolean {
    const text = cleanChatText(raw);
    if (!text) return false;
    const id = randomId(4);
    if (!this.sendPeer({ kind: 'chat', v: PROTOCOL_VERSION, id, text })) return false;
    this.emit('chat', { id, from: 'You', text, mine: true });
    return true;
  }

  /** Play a built-in sound on both sides. */
  sendSound(id: SoundId): boolean {
    const now = Date.now();
    if (!isSoundId(id) || now - this.lastSoundSent < SOUND_MIN_GAP_MS) return false;
    if (!this.sendPeer({ kind: 'sound', v: PROTOCOL_VERSION, id })) return false;
    this.lastSoundSent = now;
    this.emit('sound', { id, from: 'You', mine: true });
    return true;
  }

  /** Fire a sticker at the friend. Returns false when the peer link is down (nothing is queued). */
  sendReaction(r: { emoji?: string; gif?: string; label?: string }): boolean {
    return this.sendPeer({ kind: 'react', v: PROTOCOL_VERSION, ...r });
  }

  // ---- call controls ----------------------------------------------------------------------

  async startCall() {
    this.patchCall({ error: null });
    this.emit('notice', 'Starting camera and microphone… allow the browser prompt if one appears.');
    try { await this.media.start({ audio: true, video: true }); } finally { this.emit('notice', null); }
    void this.channel?.updatePresence({ inCall: true });
    this.patchCall({ active: true });
  }

  endCall() {
    this.media.stop();
    void this.link?.setLocalTracks(null, null);
    void this.channel?.updatePresence({ inCall: false });
    this.patchCall({ active: false, micOn: false, camOn: false });
  }

  toggleMic() { this.media.setMic(!this.media.state.micOn); }
  async toggleCam() {
    try { await this.media.setCam(!this.media.state.camOn); } catch { /* error surfaced via media 'error' */ }
  }

  /** Seek (and play/pause) to wherever the friend currently is. */
  followPeer() { this.sync.startFollowing(); }
  stopFollowingPeer() { this.sync.stopFollowing(); }

  /** Jump to whatever the friend is watching (a plain navigation, same as clicking a link; works across sites). */
  followPeerTitle() {
    const id = this.peer?.titleId;
    const url = id ? urlForTitle(id) : null;
    if (url) location.assign(url);
  }

  // ---- status -----------------------------------------------------------------------------

  private fail(message: string) {
    log.error(message);
    this.patch({ phase: 'error', error: message });
  }

  private recompute() {
    if (this.stopped) return;
    const link = this.link;
    let phase: ConnectionPhase;
    if (this.chanStatus === 'connecting') phase = 'connecting';
    else if (this.chanStatus === 'reconnecting') phase = 'reconnecting';
    else if (!this.peer) phase = 'waiting-for-friend';
    else if (!link) phase = 'friend-connected';
    else if (link.pc.connectionState === 'connected') phase = 'connected';
    else if (link.pc.connectionState === 'disconnected' || link.pc.connectionState === 'failed') phase = 'reconnecting';
    else phase = this.status.phase === 'connected' ? 'reconnecting' : 'negotiating';

    this.patch({
      phase,
      error: this.status.phase === 'error' ? this.status.error : this.chanError,
      peer: this.peer && { userId: this.peer.userId, name: this.peer.name, playerStatus: this.peer.playerStatus, titleId: this.peer.titleId, inCall: this.peer.inCall },
      transport: !link ? 'none' : link.dataChannelOpen && !this.relayedSync ? 'datachannel' : this.relayedSync ? 'relay-fallback' : 'none',
    });
  }

  private patchCall(c: Partial<RoomStatus['call']>) {
    this.patch({ call: { ...this.status.call, ...c } });
  }

  private patch(p: Partial<RoomStatus>) {
    this.status = { ...this.status, ...p, updatedAt: Date.now() };
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => { this.emitQueued = false; if (!this.stopped || this.status.phase === 'idle') this.emit('status', this.status); });
  }
}
