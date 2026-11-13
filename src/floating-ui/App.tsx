import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  Activity, Check, Clapperboard, Coffee, LogOut, Link2, Maximize2, Mic, MicOff, Minus, Phone, PhoneOff, RefreshCw,
  Smile, SquareCheckBig, Video, VideoOff, X, Maximize, Shrink, MessageCircle, Volume2,
} from 'lucide-react';
import type { RoomClient } from '@/content/RoomClient';
import { callLabel, connectionLabel, playerLabel, syncLabel, videoLabel } from '@/shared/statusText';
import { StatusDot } from '@/shared/ui/StatusDot';
import { Logo, Section, SPRING } from '@/shared/ui/kit';
import { useChat, useDrag, useLiveSettings, useNotice, usePanelMode, useReactions, useRemoteStream, useRoomStatus, useSoundsMuted, type CinemaSize } from './hooks';
import { ChatLayer, PartyLayer } from './Party';
import { ReactionLayer } from './Reactions';
import { Tray, type TrayTab } from './Tray';
import { VideoTile } from './VideoTile';

interface Props {
  client: RoomClient;
  inviteLink: string;
  onLeave: () => void;
}

const CINEMA_W: Record<CinemaSize, number> = { S: 150, M: 220, L: 320 };
const NEXT_SIZE: Record<CinemaSize, CinemaSize> = { S: 'M', M: 'L', L: 'S' };

/** Icon-only button (compact bars). Mouse-down is swallowed so keyboard focus stays on the video (Space = play/pause). */
function IconButton({ onClick, active = true, danger, title, small, children }: { onClick: () => void; active?: boolean; danger?: boolean; title: string; small?: boolean; children: React.ReactNode }) {
  return (
    <motion.button
      type="button" title={title} aria-label={title}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      whileHover={{ y: -1 }} whileTap={{ scale: 0.92 }} transition={SPRING}
      className={`focus-candy flex shrink-0 items-center justify-center rounded-xl ${small ? 'h-9 w-9' : 'h-11 w-11'} ${
        danger ? 'bg-gum text-grape-950'
        : active ? 'surface-raised text-white hover:bg-[#2c3760]'
        : 'border border-[#8a2f63] bg-[#3a1730] text-[#ffc2e2]'}`}
    >
      {children}
    </motion.button>
  );
}

/** Icon + visible label, so every control says what it does. */
function LabelButton({ onClick, label, title, icon, state = 'normal', disabled }: { onClick: () => void; label: string; title?: string; icon: React.ReactNode; state?: 'normal' | 'off' | 'danger'; disabled?: boolean }) {
  const style = state === 'danger' ? 'bg-gum text-grape-950 font-bold'
    : state === 'off' ? 'border border-[#8a2f63] bg-[#3a1730] text-[#ffc2e2] font-semibold'
    : 'surface-raised text-white font-semibold hover:bg-[#2c3760]';
  return (
    <motion.button
      type="button" disabled={disabled} title={title ?? label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      whileHover={disabled ? undefined : { y: -1 }} whileTap={disabled ? undefined : { scale: 0.96 }} transition={SPRING}
      className={`focus-candy flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[13px] leading-4 disabled:cursor-not-allowed disabled:opacity-40 ${style}`}
    >
      {icon}<span className="max-w-full truncate">{label}</span>
    </motion.button>
  );
}

function TextButton({ onClick, disabled, tone = 'surface', title, children }: { onClick: () => void; disabled?: boolean; tone?: 'surface' | 'candy' | 'lemon'; title?: string; children: React.ReactNode }) {
  const style = tone === 'candy' ? 'bg-gum text-grape-950'
    : tone === 'lemon' ? 'bg-lemon text-grape-950' : 'surface-raised text-white hover:bg-[#2c3760]';
  return (
    <motion.button
      type="button" disabled={disabled} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      whileHover={disabled ? undefined : { y: -1 }} whileTap={disabled ? undefined : { scale: 0.97 }} transition={SPRING}
      className={`focus-candy flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13.5px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${style}`}
    >{children}</motion.button>
  );
}

export function App({ client, inviteLink, onLeave }: Props) {
  const status = useRoomStatus(client);
  const remote = useRemoteStream(client);
  const settings = useLiveSettings();
  const [notice, dismissNotice] = useNotice(client);
  const { mode, size, setMode, setSize } = usePanelMode();
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [tray, setTray] = useState<TrayTab | null>(null);
  const lastTab = useRef<TrayTab>('chat');
  const trayOpen = tray !== null;
  const openTray = (t?: TrayTab) => setTray((cur) => { const next = t ?? lastTab.current; if (cur === next && t === undefined) return null; lastTab.current = next; return next; });
  const chat = useChat(client);
  const [soundsMuted, setSoundsMuted] = useSoundsMuted(client);
  const winRef = useRef<HTMLDivElement>(null);
  const { pos, onPointerDown } = useDrag(() => ({ x: Math.max(8, window.innerWidth - 372), y: 72 }));
  const reactions = useReactions(client);

  const conn = connectionLabel(status);
  const player = playerLabel(status);
  const sync = syncLabel(status);
  const call = callLabel(status);
  const video = videoLabel(status);
  const peerName = status.peer?.name ?? 'Friend';
  const c = status.call;
  const inCall = c.active || !!status.peer?.inCall;
  // Cinema mode only makes sense with a call to show; otherwise degrade to the pill.
  const shown = mode === 'cinema' && !inCall ? 'pill' : mode;

  // Once the call has been healthy for a few seconds, tuck everything away except the faces (once per call).
  const autoDone = useRef(false);
  const healthy = settings.autoCollapse && c.active && !!status.peer?.inCall && status.phase === 'connected' && c.quality === 'good' && c.rxVideo !== false;
  useEffect(() => {
    if (!c.active) { autoDone.current = false; return; }
    if (!healthy || autoDone.current) return;
    const t = setTimeout(() => { autoDone.current = true; if (mode === 'full') setMode('cinema'); }, 5000);
    return () => clearTimeout(t);
  }, [healthy, c.active, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteLink); } catch {
      const ta = document.createElement('textarea'); ta.value = inviteLink; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const connected = !!status.peer && status.transport === 'datachannel';
  const sendSticker = (r: { emoji?: string; gif?: string; label?: string }) => {
    const ok = client.sendReaction(r);
    if (ok) reactions.add({ from: 'You', emoji: r.emoji, gif: r.gif, mine: true });
    else client.notify('Can’t send stickers until you’re connected to your friend.');
  };

  const startCall = () => void client.startCall().catch(() => undefined);
  const trayAbove = pos.y > window.innerHeight / 2;
  const width = shown === 'full' ? 344 : shown === 'cinema' ? CINEMA_W[size] : 'auto';

  /** Compact mic / cam / call buttons for the videos-only bar. */
  const compactCallButtons = () => (
    <>
      <IconButton small onClick={() => client.toggleMic()} active={c.micOn} title={c.micOn ? 'Mute microphone' : 'Unmute microphone'}>{c.micOn ? <Mic size={16} /> : <MicOff size={16} />}</IconButton>
      <IconButton small onClick={() => void client.toggleCam()} active={c.camOn} title={c.camOn ? 'Turn camera off' : 'Turn camera on'}>{c.camOn ? <Video size={16} /> : <VideoOff size={16} />}</IconButton>
    </>
  );

  const videos = (compact: boolean) => (
    <div className="relative aspect-[4/3] w-full">
      <VideoTile stream={remote} label={peerName} hasVideo={c.remoteCamOn} micOn={c.remoteMicOn} compact={compact} className="h-full w-full" />
      {c.active && (
        <VideoTile
          stream={client.media.stream} label="You" muted mirror hasVideo={c.camOn} micOn={c.micOn} tint="sky" compact
          className={`absolute right-2 top-2 ${compact ? 'h-[32%] w-[34%]' : 'h-[26%] w-[30%]'}`}
        />
      )}
    </div>
  );

  const partyOff = !connected || status.party.hold !== 'none';

  return (
    <>
      <ReactionLayer items={reactions.items} />
      <ChatLayer items={chat.live} />
      <PartyLayer party={status.party} control={client.party} peerName={peerName} notice={shown === 'full' ? null : notice} onDismissNotice={dismissNotice} />
      <div
        ref={winRef}
        className="mtp-root pointer-events-auto fixed select-none"
        style={{ left: pos.x, top: pos.y, width, zIndex: 2147483000 }}
        // Don't let the site see keystrokes/clicks aimed at our UI.
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <LayoutGroup>
          <AnimatePresence mode="popLayout" initial={false}>
            {shown === 'pill' && (
              <motion.div
                key="pill" layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={SPRING}
                className="surface-float flex cursor-grab items-center gap-2 rounded-2xl py-1.5 pl-3 pr-1.5 active:cursor-grabbing"
                onPointerDown={(e) => onPointerDown(e, winRef.current)}
              >
                <StatusDot tone={conn.tone} className="!h-2.5 !w-2.5" />
                <span className="text-[14px] font-bold text-white">PariParty</span>
                {c.active && <IconButton small onClick={() => client.toggleMic()} active={c.micOn} title={c.micOn ? 'Mute microphone' : 'Unmute microphone'}>{c.micOn ? <Mic size={16} /> : <MicOff size={16} />}</IconButton>}
                {inCall && <IconButton small onClick={() => setMode('cinema')} title="Videos only"><Clapperboard size={16} /></IconButton>}
                <IconButton small onClick={() => setMode('full')} title="Open panel"><Maximize2 size={16} /></IconButton>
              </motion.div>
            )}

            {shown === 'cinema' && (
              <motion.div
                key="cinema" layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={SPRING}
                className="group relative cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => onPointerDown(e, winRef.current)}
              >
                {videos(true)}
                {/* Controls appear only on hover or keyboard focus, so nothing sits on the movie while watching. */}
                <div className={`absolute inset-x-1.5 bottom-1.5 flex justify-center transition-opacity duration-150 motion-reduce:transition-none ${trayOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                  <div className="surface-float flex items-center gap-1 rounded-2xl p-1">
                    {size === 'S' ? (
                      <IconButton small onClick={() => client.toggleMic()} active={c.micOn} title={c.micOn ? 'Mute microphone' : 'Unmute microphone'}>{c.micOn ? <Mic size={16} /> : <MicOff size={16} />}</IconButton>
                    ) : (
                      <>
                        {compactCallButtons()}
                        {size === 'L' && (c.active
                          ? <IconButton small onClick={() => client.endCall()} danger title="End call"><PhoneOff size={16} /></IconButton>
                          : <IconButton small onClick={startCall} title="Start call"><Phone size={16} /></IconButton>)}
                        <IconButton small onClick={() => openTray()} active={!trayOpen} title="Chat, stickers, sounds and party tools"><Smile size={16} /></IconButton>
                      </>
                    )}
                    <IconButton small onClick={() => setSize(NEXT_SIZE[size])} title={`Size: ${size} (click to change)`}>{size === 'L' ? <Shrink size={16} /> : <Maximize size={16} />}</IconButton>
                    <IconButton small onClick={() => setMode('full')} title="Show full panel"><Maximize2 size={16} /></IconButton>
                  </div>
                </div>
              </motion.div>
            )}

            {shown === 'full' && (
              <motion.div
                key="full" layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={SPRING}
                className="surface-float overflow-hidden rounded-2xl"
              >
                {/* Header / drag handle */}
                <div className="cursor-grab px-3.5 pb-2 pt-3 active:cursor-grabbing" onPointerDown={(e) => onPointerDown(e, winRef.current)}>
                  <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><Logo size="sm" /></div>
                  {inCall && <button type="button" title="Show only the videos" onMouseDown={(e) => e.preventDefault()} onClick={() => setMode('cinema')} className="focus-candy surface-raised flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold text-white hover:bg-[#2c3760]"><Clapperboard size={15} /> Videos only</button>}
                  <IconButton small onClick={() => setMode('pill')} title="Minimize"><Minus size={16} /></IconButton>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[14px] leading-5 text-soft">
                    <StatusDot tone={conn.tone} />
                    <span>{status.peer ? `${conn.text} · with ${peerName}` : conn.text}</span>
                  </div>
                </div>

                <div className="space-y-3 p-3.5 pt-1.5">
                  {/* Stage */}
                  <AnimatePresence initial={false} mode="wait">
                    {inCall ? (
                      <motion.div key="v" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{videos(false)}</motion.div>
                    ) : (
                      <motion.div key="e" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="surface flex w-full flex-col items-center justify-center gap-2.5 rounded-xl px-4 py-5 text-center">
                        <p className="text-[14px] font-semibold text-white">{status.peer ? `${peerName} is here. Start a video call?` : 'Waiting for your friend to join…'}</p>
                        <TextButton tone="candy" disabled={!status.peer} onClick={startCall}><Phone size={16} /> Start video call</TextButton>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {!c.active && status.peer?.inCall && (
                    <TextButton tone="lemon" onClick={startCall}>{peerName} is in a call. Join →</TextButton>
                  )}

                  {/* Call controls */}
                  <div className="grid grid-cols-3 gap-2">
                    <LabelButton onClick={() => client.toggleMic()} state={c.micOn ? 'normal' : 'off'} label={c.micOn ? 'Mic on' : 'Mic off'} title={c.micOn ? 'Mute microphone' : 'Unmute microphone'} icon={c.micOn ? <Mic size={20} /> : <MicOff size={20} />} />
                    <LabelButton onClick={() => void client.toggleCam()} state={c.camOn ? 'normal' : 'off'} label={c.camOn ? 'Camera on' : 'Camera off'} title={c.camOn ? 'Turn camera off' : 'Turn camera on'} icon={c.camOn ? <Video size={20} /> : <VideoOff size={20} />} />
                    {c.active
                      ? <LabelButton onClick={() => client.endCall()} state="danger" label="End call" icon={<PhoneOff size={20} />} />
                      : <LabelButton onClick={startCall} label="Start call" icon={<Phone size={20} />} />}
                  </div>

                  {/* Do-together tools */}
                  <div>
                    <div className="mb-1.5 text-[13px] font-bold text-white">Do together</div>
                    <div className="grid grid-cols-5 gap-1.5">
                      <LabelButton onClick={() => client.party.requestReadyCheck()} disabled={partyOff} label="Ready?" title="Ready check: pause both, then count 3-2-1" icon={<SquareCheckBig size={18} />} />
                      <LabelButton onClick={() => client.party.requestBrb()} disabled={partyOff} label="Brb" title="Pause both while you step away" icon={<Coffee size={18} />} />
                      <LabelButton onClick={() => openTray('chat')} label="Chat" title="Message your friend" icon={<MessageCircle size={18} />} />
                      <LabelButton onClick={() => openTray('emoji')} label="Emoji" title="Emoji, stickers and GIFs" icon={<Smile size={18} />} />
                      <LabelButton onClick={() => openTray('sounds')} label="Sounds" title="Soundboard" icon={<Volume2 size={18} />} />
                    </div>
                  </div>

                  {/* Watch-sync actions */}
                  {status.sync === 'different-title' && status.peer?.titleId && (
                    <TextButton tone="lemon" onClick={() => client.followPeerTitle()}>{peerName} is watching something else. Go there →</TextButton>
                  )}
                  {status.peer && status.sync !== 'different-title' && (
                    status.follow === 'followed' ? (
                      <div className="surface rounded-xl px-3 py-2.5 text-center text-[13.5px] font-semibold text-white">{peerName} is following you. Just watch normally.</div>
                    ) : status.follow === 'following' ? (
                      <TextButton tone="lemon" onClick={() => client.stopFollowingPeer()} title="Stop mirroring your friend"><RefreshCw size={15} /> Following {peerName}. Tap to stop</TextButton>
                    ) : (
                      <TextButton disabled={status.player !== 'ready'} onClick={() => client.followPeer()} title={status.player !== 'ready' ? 'Open a video first' : `Mirror ${peerName}: you will follow their playback`}>
                        <RefreshCw size={15} /> Jump to {peerName}’s spot
                      </TextButton>
                    )
                  )}

                  <AnimatePresence initial={false}>
                    {(c.error || notice) && (
                      <motion.div key="n" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div role="alert" className="flex items-start gap-2 rounded-xl border border-[#8c7a1f] bg-[#2f2a0f] px-3 py-2.5 text-[13.5px] leading-5 text-lemon">
                          <span className="flex-1">{c.error ?? notice}</span>
                          {notice && <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={dismissNotice} aria-label="Dismiss" className="focus-candy rounded p-0.5"><X size={15} /></button>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Invite + leave */}
                  <div className="grid grid-cols-2 gap-2">
                    <TextButton onClick={() => void copy()}>{copied ? <><Check size={16} className="text-mint" /> Link copied</> : <><Link2 size={16} /> Copy invite link</>}</TextButton>
                    {confirmLeave
                      ? <TextButton tone="candy" onClick={onLeave}><Check size={16} /> Tap to confirm</TextButton>
                      : <TextButton onClick={() => { setConfirmLeave(true); setTimeout(() => setConfirmLeave(false), 3000); }}><LogOut size={16} /> Leave room</TextButton>}
                  </div>

                  {/* Collapsible details */}
                  <Section title="Connection details" icon={<Activity size={17} className="text-mint" />} defaultOpen={false} badge={<StatusDot tone={sync.tone} className="!h-2.5 !w-2.5" />}>
                    <dl className="space-y-2 text-[13px]">
                      {[[status.siteName || 'Player', player], ['Sync', sync], ['Call', call], ...(video ? [['Video', video]] : [])].map(([k, l]) => {
                        const label = l as typeof conn;
                        return (
                          <div key={k as string} className="flex items-start gap-2">
                            <dt className="w-14 shrink-0 font-bold text-mute">{k as string}</dt>
                            <dd className="flex min-w-0 flex-1 items-start gap-2 text-white"><StatusDot tone={label.tone} className="mt-1.5 !h-2 !w-2" /><span>{label.text}</span></dd>
                          </div>
                        );
                      })}
                      {video?.fix && (
                        <div className="pl-16"><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void client.fixMedia()} className="focus-candy rounded-lg bg-lemon px-3 py-1.5 text-[13px] font-bold text-grape-950 hover:brightness-105">Fix video (both sides)</button></div>
                      )}
                      {status.rtt !== null && <div className="pl-16 text-[13px] text-mute">{status.transport === 'datachannel' ? (status.relayed ? 'via TURN relay' : 'direct peer-to-peer') : status.transport === 'relay-fallback' ? 'via server fallback' : ''} · {status.rtt} ms</div>}
                    </dl>
                  </Section>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>

        {/* Tray floats beside whichever layout is showing */}
        <AnimatePresence>
          {tray && (
            <div className={`absolute left-0 ${trayAbove ? 'bottom-full mb-2' : 'top-full mt-2'}`} style={{ maxWidth: '100vw' }}>
              <Tray
                tab={tray} onTab={(t) => { lastTab.current = t; setTray(t); }} onClose={() => setTray(null)}
                connected={connected} peerName={peerName} hasGiphyKey={!!settings.giphyApiKey}
                chat={chat.log} party={status.party} muted={soundsMuted} onMuted={setSoundsMuted}
                onReaction={sendSticker}
                onChat={(t) => { const ok = client.sendChat(t); if (!ok) client.notify('Couldn’t send. Are you connected to your friend?'); return ok; }}
                onSound={(id) => { if (!client.sendSound(id)) client.notify('Can’t play sounds until you’re connected to your friend.'); }}
                onReady={() => client.party.requestReadyCheck()} onBrb={() => client.party.requestBrb()}
              />
            </div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
