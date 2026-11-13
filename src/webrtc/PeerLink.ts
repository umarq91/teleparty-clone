import { PROTOCOL_VERSION, validatePeerMessage, type PeerMessage, type SignalPayload } from '@/shared/protocol';
import { log } from '@/shared/logger';
import { Emitter, errorMessage } from '@/shared/util';

export interface LinkStats {
  rtt: number | null;
  loss: number | null;
  quality: 'unknown' | 'good' | 'fair' | 'poor';
  relayed: boolean;
  /** Are media frames actually flowing since the last poll? null = no sample yet. */
  rxVideo: boolean | null;
  rxAudio: boolean | null;
  txVideo: boolean | null;
}

type Events = {
  dc: boolean;
  message: PeerMessage;
  remoteStream: MediaStream;
  state: { conn: RTCPeerConnectionState; ice: RTCIceConnectionState };
  stats: LinkStats;
};

export interface PeerLinkOptions {
  peerId: string;
  remoteGen: string;
  /** Exactly one side is the offerer (deterministic), so offers can never collide ("glare"). */
  isOfferer: boolean;
  iceServers: RTCIceServer[];
  sendSignal: (p: SignalPayload) => void;
}

const MAX_DC_MESSAGE = 64 * 1024;

/**
 * One RTCPeerConnection to the other participant.
 *
 *  - A *negotiated* DataChannel (id 0) carries playback sync, ping/pong and media-state messages.
 *    It exists from the first offer, so sync works even if nobody ever starts the camera.
 *  - Audio + video transceivers are created up front; camera/mic are attached with
 *    `replaceTrack`, which needs no renegotiation. Starting/stopping a call is therefore cheap
 *    and independent of the data channel.
 */
export class PeerLink extends Emitter<Events> {
  readonly pc: RTCPeerConnection;
  readonly remoteStream = new MediaStream();
  private dc: RTCDataChannel;
  private audioTx: RTCRtpTransceiver;
  private videoTx: RTCRtpTransceiver;
  private localTracks: { audio: MediaStreamTrack | null; video: MediaStreamTrack | null } = { audio: null, video: null };
  private pendingCandidates: (RTCIceCandidateInit | null)[] = [];
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private statsTimer: ReturnType<typeof setInterval>;
  private recoverTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBytes = { t: 0, lost: 0, recv: 0 };
  private lastFlow: { rxVideo: number; rxAudio: number; txVideo: number } | null = null;

  constructor(private opts: PeerLinkOptions) {
    super();
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers, bundlePolicy: 'max-bundle' });
    this.dc = this.pc.createDataChannel('mtp', { negotiated: true, id: 0, ordered: true });
    this.audioTx = this.pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.videoTx = this.pc.addTransceiver('video', { direction: 'sendrecv' });
    this.wireDataChannel();

    this.pc.ontrack = (e) => {
      if (!this.remoteStream.getTracks().includes(e.track)) this.remoteStream.addTrack(e.track);
      this.emit('remoteStream', this.remoteStream);
    };
    this.pc.onicecandidate = (e) => this.opts.sendSignal({ kind: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null });
    this.pc.onnegotiationneeded = () => { if (opts.isOfferer) void this.makeOffer(false); };
    const stateChanged = () => {
      this.emit('state', { conn: this.pc.connectionState, ice: this.pc.iceConnectionState });
      this.maybeRecover();
    };
    this.pc.onconnectionstatechange = stateChanged;
    this.pc.oniceconnectionstatechange = stateChanged;
    this.statsTimer = setInterval(() => void this.pollStats(), 3000);
  }

  get peerId() { return this.opts.peerId; }
  get remoteGen() { return this.opts.remoteGen; }
  get dataChannelOpen() { return !this.closed && this.dc.readyState === 'open'; }

  private wireDataChannel() {
    this.dc.onopen = () => this.emit('dc', true);
    this.dc.onclose = () => this.emit('dc', false);
    this.dc.onerror = () => log.warn('datachannel error');
    this.dc.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > MAX_DC_MESSAGE) return;
      let parsed: unknown;
      try { parsed = JSON.parse(e.data); } catch { return; }
      const msg = validatePeerMessage(parsed);
      if (msg) this.emit('message', msg); else log.warn('dropped invalid datachannel message');
    };
  }

  send(msg: PeerMessage): boolean {
    if (!this.dataChannelOpen) return false;
    try { this.dc.send(JSON.stringify(msg)); return true; } catch { return false; }
  }

  /** Attach / detach local tracks. No renegotiation required. */
  async setLocalTracks(audio: MediaStreamTrack | null, video: MediaStreamTrack | null) {
    if (this.closed) return;
    this.localTracks = { audio, video };
    this.adoptTransceivers();
    await this.audioTx.sender.replaceTrack(audio).catch((e) => log.warn('audio replaceTrack', errorMessage(e)));
    await this.videoTx.sender.replaceTrack(video).catch((e) => log.warn('video replaceTrack', errorMessage(e)));
    if (video) await this.applyVideoProfile();
  }

  /**
   * On the *answering* side the browser does not reuse the transceivers we pre-created with
   * addTransceiver(); the remote offer creates its own. Tracks attached to our unused ones are never
   * sent, so that side would be "connected" but silent. Point audioTx/videoTx at the transceivers
   * that are really negotiated (they have a `mid`) and make sure they send.
   */
  private adoptTransceivers() {
    for (const kind of ['audio', 'video'] as const) {
      const real = this.pc.getTransceivers().find((t) => t.mid !== null && t.receiver.track.kind === kind);
      if (!real) continue;
      const cur = kind === 'audio' ? this.audioTx : this.videoTx;
      if (real !== cur) {
        try { void cur.sender.replaceTrack(null); cur.direction = 'inactive'; } catch { /* unused transceiver */ }
        if (kind === 'audio') this.audioTx = real; else this.videoTx = real;
        log.info(`using negotiated ${kind} transceiver`);
      }
      if (real.direction !== 'sendrecv') real.direction = 'sendrecv';
    }
  }

  private lowVideo = false;
  /** Weak link: send small, slow video (it arrives) instead of nice video (it doesn't). */
  async setLowBandwidth(low: boolean) {
    if (this.closed || low === this.lowVideo) return;
    this.lowVideo = low;
    await this.applyVideoProfile();
  }

  private async applyVideoProfile() {
    try {
      const p = this.videoTx.sender.getParameters();
      p.encodings = p.encodings?.length ? p.encodings : [{}];
      const e = p.encodings[0]!;
      e.maxBitrate = this.lowVideo ? 200_000 : 700_000;
      e.scaleResolutionDownBy = this.lowVideo ? 2 : 1;
      e.maxFramerate = this.lowVideo ? 15 : 30;
      await this.videoTx.sender.setParameters(p);
    } catch { /* optional optimisation */ }
  }

  // ---- signaling -----------------------------------------------------------

  handleSignal(payload: SignalPayload) {
    this.queue = this.queue.then(() => this.process(payload)).catch((e) => log.warn('signal error', errorMessage(e)));
  }

  private async process(payload: SignalPayload) {
    if (this.closed) return;
    switch (payload.kind) {
      case 'hello':
        if (this.opts.isOfferer) await this.makeOffer(this.pc.connectionState !== 'new');
        return;
      case 'description': {
        const d = payload.description;
        if (d.type === 'offer') {
          if (this.opts.isOfferer) return log.warn('ignoring offer: we are the offerer');
          await this.pc.setRemoteDescription(d);
          await this.flushCandidates();
          this.adoptTransceivers();
          await this.pc.setLocalDescription();
          this.sendLocalDescription();
          await this.setLocalTracks(this.localTracks.audio, this.localTracks.video);
        } else {
          if (this.pc.signalingState !== 'have-local-offer') return;
          await this.pc.setRemoteDescription(d);
          await this.flushCandidates();
        }
        return;
      }
      case 'candidate':
        if (!this.pc.remoteDescription) { this.pendingCandidates.push(payload.candidate); return; }
        await this.addCandidate(payload.candidate);
        return;
      case 'sync-relay': return; // handled by RoomClient
    }
  }

  private async addCandidate(c: RTCIceCandidateInit | null) {
    try { await this.pc.addIceCandidate(c ?? undefined); } catch (e) { log.debug('addIceCandidate', errorMessage(e)); }
  }
  private async flushCandidates() {
    const list = this.pendingCandidates.splice(0);
    for (const c of list) await this.addCandidate(c);
  }

  private sendLocalDescription() {
    const d = this.pc.localDescription;
    if (d && (d.type === 'offer' || d.type === 'answer')) {
      this.opts.sendSignal({ kind: 'description', description: { type: d.type, sdp: d.sdp } });
    }
  }

  private async makeOffer(iceRestart: boolean) {
    if (this.closed || !this.opts.isOfferer) return;
    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      try {
        if (this.pc.signalingState !== 'stable') await this.pc.setLocalDescription({ type: 'rollback' });
        await this.pc.setLocalDescription(await this.pc.createOffer({ iceRestart }));
        this.sendLocalDescription();
      } catch (e) { log.warn('makeOffer failed', errorMessage(e)); }
    });
    await this.queue;
  }

  // ---- recovery ------------------------------------------------------------

  /** Manual "fix video": force a fresh ICE/media path (the offerer re-offers; the other side asks it to). */
  restartIce() {
    if (this.closed) return;
    if (this.opts.isOfferer) void this.makeOffer(true);
    else this.opts.sendSignal({ kind: 'hello' });
  }

  private maybeRecover() {
    if (this.closed) return;
    const bad = this.pc.connectionState === 'failed' || this.pc.iceConnectionState === 'disconnected' || this.pc.iceConnectionState === 'failed';
    if (!bad) {
      if (this.recoverTimer && (this.pc.connectionState === 'connected')) { clearTimeout(this.recoverTimer); this.recoverTimer = null; }
      return;
    }
    if (this.recoverTimer) return;
    // Give ICE a moment to heal on its own (Wi-Fi blips), then restart it.
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null;
      if (this.closed || this.pc.connectionState === 'connected') return;
      log.info('ICE recovery');
      if (this.opts.isOfferer) void this.makeOffer(true);
      else this.opts.sendSignal({ kind: 'hello' });
      this.maybeRecover(); // keep trying while still broken
    }, 3000);
  }

  // ---- stats ---------------------------------------------------------------

  private async pollStats() {
    if (this.closed || this.pc.connectionState !== 'connected') return;
    try {
      const report = await this.pc.getStats();
      let rtt: number | null = null;
      let relayed = false;
      let lost = 0, recv = 0;
      let rxVideoB = 0, rxAudioB = 0, txVideoB = 0;
      const byId = new Map<string, Record<string, unknown>>();
      report.forEach((s) => byId.set(s.id, s as Record<string, unknown>));
      report.forEach((s) => {
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) {
          if (typeof s.currentRoundTripTime === 'number') rtt = s.currentRoundTripTime * 1000;
          const local = byId.get(s.localCandidateId as string);
          if (local?.candidateType === 'relay') relayed = true;
        }
        if (s.type === 'inbound-rtp' && s.kind === 'video') rxVideoB += (s.bytesReceived as number) || 0;
        if (s.type === 'inbound-rtp' && s.kind === 'audio') rxAudioB += (s.bytesReceived as number) || 0;
        if (s.type === 'outbound-rtp' && s.kind === 'video') txVideoB += (s.bytesSent as number) || 0;
        if (s.type === 'inbound-rtp' && (s.kind === 'video' || s.kind === 'audio')) {
          lost += (s.packetsLost as number) || 0;
          recv += (s.packetsReceived as number) || 0;
        }
      });
      let loss: number | null = null;
      const dLost = lost - this.lastBytes.lost, dRecv = recv - this.lastBytes.recv;
      if (dRecv + dLost > 20) loss = (Math.max(0, dLost) / (dRecv + dLost)) * 100;
      this.lastBytes = { t: Date.now(), lost, recv };
      let quality: LinkStats['quality'] = 'unknown';
      if (rtt !== null) {
        quality = rtt < 150 && (loss ?? 0) < 2 ? 'good' : rtt < 400 && (loss ?? 0) < 8 ? 'fair' : 'poor';
      }
      const prev = this.lastFlow;
      this.lastFlow = { rxVideo: rxVideoB, rxAudio: rxAudioB, txVideo: txVideoB };
      // > 2 KB in ~3 s: real media, not just RTCP keep-alives.
      const grew = (a: number, b: number | undefined) => (b === undefined ? null : a - b > 2000);
      this.emit('stats', {
        rtt, loss, quality, relayed,
        rxVideo: grew(rxVideoB, prev?.rxVideo), rxAudio: grew(rxAudioB, prev?.rxAudio), txVideo: grew(txVideoB, prev?.txVideo),
      });
    } catch { /* ignore */ }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.statsTimer);
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    for (const t of [this.audioTx, this.videoTx]) { try { void t.sender.replaceTrack(null); } catch { /* */ } }
    try { this.dc.close(); } catch { /* */ }
    this.pc.onicecandidate = this.pc.ontrack = this.pc.onnegotiationneeded = null;
    this.pc.onconnectionstatechange = this.pc.oniceconnectionstatechange = null;
    try { this.pc.close(); } catch { /* */ }
    this.removeAllListeners();
  }
}

export const pingMessage = (): PeerMessage => ({ kind: 'ping', v: PROTOCOL_VERSION, t0: Date.now() });
