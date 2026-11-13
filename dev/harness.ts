// Dev-only: exercises PeerLink in a real browser with in-memory signaling (no Supabase, no Netflix).
import { PeerLink } from '@/webrtc/PeerLink';
import { validateEnvelope, PROTOCOL_VERSION, type SignalPayload, type SyncMessage } from '@/shared/protocol';

const out = document.getElementById('out')!;
const results: Record<string, unknown> = {};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean | Promise<boolean>, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await cond()) return true; await wait(50); }
  return false;
}

async function run() {
  const idA = 'aaaa', idB = 'bbbb';
  const offers = { a: 0, b: 0 };
  let a!: PeerLink, b!: PeerLink;
  // Realistic wire: JSON round-trip + the same validator the real channel uses.
  const deliver = (from: string, to: string, target: () => PeerLink, p: SignalPayload) => {
    const env = validateEnvelope(JSON.parse(JSON.stringify({ v: PROTOCOL_VERSION, from, to, gen: 'g', payload: p })), to);
    if (!env) { results.invalidEnvelope = true; return; }
    setTimeout(() => target().handleSignal(env.payload), 5);
  };
  const mk = (me: string, other: string, isOfferer: boolean, self: 'a' | 'b', target: () => PeerLink) =>
    new PeerLink({ peerId: other, remoteGen: 'g', isOfferer, iceServers: [], sendSignal: (p) => {
      if (p.kind === 'description' && p.description.type === 'offer') offers[self]++;
      deliver(me, other, target, p);
    } });
  a = mk(idA, idB, true, 'a', () => b);
  b = mk(idB, idA, false, 'b', () => a);

  const got: SyncMessage[] = [];
  b.on('message', (m) => { if (m.kind === 'sync') got.push(m); });

  results.dataChannelOpen = await until(() => a.dataChannelOpen && b.dataChannelOpen);
  results.connected = await until(() => a.pc.connectionState === 'connected' && b.pc.connectionState === 'connected');

  const sync: SyncMessage = { kind: 'sync', v: 1, type: 'PLAY', seq: 1, sentAt: Date.now(), titleId: '1', state: { position: 3, playing: true, rate: 1 } };
  results.syncSent = a.send(sync);
  results.syncReceived = await until(() => got.length === 1);
  // garbage over the channel must be dropped, not delivered
  (a as unknown as { dc: RTCDataChannel }).dc.send('{"kind":"sync","v":1,"type":"NUKE"}');
  (a as unknown as { dc: RTCDataChannel }).dc.send('not json');
  await wait(300);
  results.invalidDropped = got.length === 1;

  // Camera: canvas video + oscillator audio, attached WITHOUT renegotiation.
  const offersBefore = offers.a;
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
  const g = canvas.getContext('2d')!;
  const timer = setInterval(() => { g.fillStyle = `hsl(${Date.now() / 10 % 360},80%,50%)`; g.fillRect(0, 0, 320, 240); }, 33);
  const video = canvas.captureStream(30).getVideoTracks()[0]!;
  const ac = new AudioContext(); const osc = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); osc.connect(dest); osc.start();
  const audio = dest.stream.getAudioTracks()[0]!;
  await a.setLocalTracks(audio, video);
  results.remoteTracks = await until(() => b.remoteStream.getTracks().length === 2);
  results.videoFramesDecoded = await until(async () => {
    const r = await b.pc.getStats(); let n = 0;
    r.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video') n = Math.max(n, s.framesDecoded ?? 0); });
    return n > 5;
  }, 8000);
  results.audioPacketsReceived = await until(async () => {
    const r = await b.pc.getStats(); let n = 0;
    r.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio') n = Math.max(n, s.packetsReceived ?? 0); });
    return n > 5;
  }, 8000);
  results.noRenegotiationForMedia = offers.a === offersBefore;

  // Toggle camera off/on (replaceTrack(null) and back) keeps the connection and channel.
  await a.setLocalTracks(audio, null); await wait(300); await a.setLocalTracks(audio, video); await wait(300);
  results.stillConnectedAfterCamToggle = a.pc.connectionState === 'connected' && a.dataChannelOpen;

  // Recovery path: answerer asks for restart -> offerer ICE-restarts; link must survive.
  b.handleSignal({ kind: 'hello' }); // ignored by answerer
  a.handleSignal({ kind: 'hello' }); // offerer re-offers with restart
  await wait(1500);
  results.survivesRenegotiation = a.pc.connectionState === 'connected' && b.pc.connectionState === 'connected' && a.send(sync);
  results.stats = await until(() => false, 3500) || 'n/a';

  clearInterval(timer); osc.stop(); void ac.close();
  a.close(); b.close();
  results.closedClean = a.pc.connectionState === 'closed' && b.pc.connectionState === 'closed';
  delete results.stats;
  return results;
}

run().then((r) => { out.textContent = JSON.stringify(r, null, 2); (window as unknown as { __result: unknown }).__result = r; })
  .catch((e) => { out.textContent = 'ERROR ' + e; (window as unknown as { __result: unknown }).__result = { error: String(e) }; });
