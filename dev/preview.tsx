import './chrome-mock';
import { createRoot } from 'react-dom/client';
import '../src/floating-ui/styles.css';
import { App } from '../src/floating-ui/App';
import { ChatLayer, PartyLayer } from '../src/floating-ui/Party';
import type { ToolKind } from '../src/floating-ui/ToolScreen';
import { initialParty, initialStatus, type PartyState, type RoomStatus } from '../src/shared/types';

const q = new URLSearchParams(location.search);
if (q.get('mode')) void (globalThis as unknown as { chrome: { storage: { local: { set(o: object): Promise<void> } } } }).chrome.storage.local.set({ overlayMode: { mode: q.get('mode'), size: q.get('size') ?? 'M' } });
const view = q.get('v') ?? 'panel';
const now = Date.now();
const noop = () => undefined;
const fakeControl = { cancel: noop, resumeNow: noop, imReady: noop, requestBrb: noop, requestReadyCheck: noop } as never;

const PARTIES: Record<string, PartyState> = {
  none: initialParty(),
  brb: { ...initialParty(), hold: 'brb', by: 'peer', since: now - 133_000 },
  brbme: { ...initialParty(), hold: 'brb', by: 'me', since: now - 20_000 },
  buffer: { ...initialParty(), hold: 'buffering', by: 'peer', since: now },
  bufferme: { ...initialParty(), hold: 'buffering', by: 'me', since: now },
  adpeer: { ...initialParty(), hold: 'buffering', by: 'peer', why: 'ad', since: now },
  adme: { ...initialParty(), hold: 'buffering', by: 'me', why: 'ad', since: now },
  ask: { ...initialParty(), hold: 'ready-check', by: 'peer', peerReady: true, since: now },
  wait: { ...initialParty(), hold: 'ready-check', by: 'me', meReady: true, since: now },
  count: { ...initialParty(), hold: 'brb', by: 'me', since: now, countdownTo: now + 2400 },
  quick: { ...initialParty(), hold: 'buffering', by: null, since: now, countdownTo: now + 1500, countdownQuick: true },
};

const ITEMS = [
  { key: 1, from: 'Sam', text: 'WAIT. did he just say that?? 😭', mine: false, kind: 'chat' as const },
  { key: 2, from: 'You', text: 'yes. rewinding', mine: true, kind: 'chat' as const },
  { key: 3, from: 'Sam', text: 'played Airhorn', mine: false, kind: 'sound' as const },
];

function Backdrop({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(120% 90% at 30% 20%, #3a2a1c 0%, #1a1410 45%, #070605 100%)' }}>{children}</div>;
}

function fakeClient(partyKey: string) {
  const status: RoomStatus = {
    ...initialStatus(), phase: 'connected', roomId: 'r', role: 'host', selfName: 'Umar', transport: 'datachannel', rtt: 42, siteName: q.get('site') ?? 'YouTube', player: 'ready', sync: 'in-sync',
    peer: { userId: 'p', name: 'Sam', playerStatus: 'ready', titleId: '80100172', title: 'Stranger Things S4:E1 · Chapter One', inCall: q.get('call') !== '0' },
    call: { ...initialStatus().call, active: q.get('call') !== '0', micOn: true, camOn: false, remoteMicOn: true, remoteCamOn: false, quality: 'good' },
    party: PARTIES[partyKey] ?? initialParty(),
    titleId: q.get('same') ? '80100172' : null,
  };
  return {
    snapshot: status, remoteStream: null, media: { stream: null }, party: fakeControl,
    on: () => noop, toggleMic: noop, toggleCam: noop, startCall: async () => undefined, endCall: noop, fixMedia: async () => undefined,
    followPeer: noop, stopFollowingPeer: noop, followPeerTitle: noop, notify: noop, sendReaction: () => true, sendChat: () => true, sendSound: () => true,
  } as never;
}

function Preview() {
  if (view === 'party') {
    return <Backdrop><PartyLayer party={PARTIES[q.get('s') ?? 'brb']!} control={fakeControl} peerName="Sam" notice={q.get('notice')} onDismissNotice={noop} watch={q.get('watch') ? { name: 'Sam', title: 'The Bear S2:E6 · Fishes' } : null} onJump={noop} onDismissWatch={noop} /></Backdrop>;
  }
  if (view === 'chat') return <Backdrop><ChatLayer items={ITEMS} /></Backdrop>;
  return <Backdrop><App client={fakeClient(q.get('s') ?? 'none')} inviteLink="https://x" onLeave={noop} initialScreen={(q.get('open') as ToolKind) ?? null} /></Backdrop>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
