import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  Activity, Check, Clapperboard, LogOut, Link2, Maximize2, Mic, MicOff, Minus, Phone, PhoneOff, RefreshCw,
  Smile, SquareCheckBig, Video, VideoOff, X, Maximize, Shrink, MessageCircle, Volume2, ArrowLeft, ChevronDown,
} from 'lucide-react';
import type { RoomClient } from '@/content/RoomClient';
import { callLabel, connectionLabel, playerLabel, syncLabel, videoLabel, watchInvite } from '@/shared/statusText';
import { StatusDot } from '@/shared/ui/StatusDot';
import { Collapse, Logo, Section, SPRING } from '@/shared/ui/kit';
import { useChat, useDrag, useLiveSettings, useNotice, usePanelMode, useReactions, useRemoteStream, useRoomStatus, useSoundsMuted, type CinemaSize } from './hooks';
import { ChatLayer, PartyLayer } from './Party';
import { ReactionLayer } from './Reactions';
import { ToolPane, TOOL_TITLES, type FunTab, type ToolKind } from './ToolScreen';
import { VideoTile } from './VideoTile';

interface Props {
  client: RoomClient;
  inviteLink: string;
  onLeave: () => void;
  /** Preview/testing: open a tool screen straight away. */
  initialScreen?: ToolKind | null;
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

/** Small labelled button: one shape for every secondary control. */
function Chip({ onClick, label, title, icon, state = 'normal', disabled, tight }: { onClick: () => void; label: string; title?: string; icon: React.ReactNode; state?: 'normal' | 'off' | 'danger'; disabled?: boolean; tight?: boolean }) {
  const style = state === 'danger' ? 'bg-gum text-grape-950 font-bold'
    : state === 'off' ? 'border border-[#8a2f63] bg-[#3a1730] text-[#ffc2e2] font-semibold'
    : 'surface-raised text-white font-semibold hover:bg-[#2c3760]';
  return (
    <motion.button
      type="button" disabled={disabled} title={title ?? label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.96 }} transition={SPRING}
      className={`focus-candy flex h-9 min-w-0 items-center justify-center rounded-lg leading-4 ${tight ? 'gap-1 px-0.5 text-[12px]' : 'gap-1.5 px-1.5 text-[12.5px]'} disabled:cursor-not-allowed disabled:opacity-40 ${style}`}
    >
      <span className="shrink-0">{icon}</span><span className="truncate">{label}</span>
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
      className={`focus-candy flex min-h-[38px] w-full items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${style}`}
    >{children}</motion.button>
  );
}

export function App({ client, inviteLink, onLeave, initialScreen = null }: Props) {
  const status = useRoomStatus(client);
  const remote = useRemoteStream(client);
  const settings = useLiveSettings();
  const [notice, dismissNotice] = useNotice(client);
  const { mode, size, setMode, setSize } = usePanelMode();
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Chat / emoji / sounds / pause open as a screen *inside* the panel (with a Back button), never as a popover that can fall off-screen.
  const [screen, setScreen] = useState<ToolKind | null>(initialScreen);
  const [funTab, setFunTab] = useState<FunTab>('emoji');
  const [togetherOpen, setTogetherOpen] = useState(true);
  const [dismissedWatch, setDismissedWatch] = useState<string | null>(null); // titleId of an offer the user waved off
  const openTool = (k: ToolKind) => { setTogetherOpen(true); setScreen(k); };
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
  // The friend has a video open that we don't: offer to jump there (works even while we are just browsing).
  const invite = watchInvite(status);
  const inCall = c.active || !!status.peer?.inCall;
  // Cinema mode only makes sense with a call to show; otherwise degrade to the pill.
  const base = mode === 'cinema' && !inCall ? 'pill' : mode;
  // An open tool screen always shows in the full panel; closing it returns to whatever mode you were in (e.g. videos-only).
  const shown = screen ? 'full' : base;

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
  const width = shown === 'full' ? 344 : shown === 'cinema' ? CINEMA_W[size] : 'auto';

  /** Compact mic / cam / call buttons for the videos-only bar. */
  const compactCallButtons = () => (
    <>
      <IconButton small onClick={() => client.toggleMic()} active={c.micOn} title={c.micOn ? 'Mute microphone' : 'Unmute microphone'}>{c.micOn ? <Mic size={16} /> : <MicOff size={16} />}</IconButton>
      <IconButton small onClick={() => void client.toggleCam()} active={c.camOn} title={c.camOn ? 'Turn camera off' : 'Turn camera on'}>{c.camOn ? <Video size={16} /> : <VideoOff size={16} />}</IconButton>
    </>
  );

  const videos = (compact: boolean) => (
    <div className={`relative w-full ${compact ? "aspect-[4/3]" : "aspect-video"}`}>
      <VideoTile stream={remote} label={peerName} hasVideo={c.remoteCamOn} micOn={c.remoteMicOn} compact={compact} className="h-full w-full" />
      {c.active && (
        <VideoTile
          stream={client.media.stream} label="You" muted mirror hasVideo={c.camOn} micOn={c.micOn} tint="sky" compact
          className={`absolute right-2 top-2 ${compact ? 'h-[32%] w-[34%]' : 'h-[26%] w-[30%]'}`}
        />
      )}
    </div>
  );

  const goBack = () => setScreen(null);
  const toggleTogether = () => { if (togetherOpen) { setScreen(null); setTogetherOpen(false); } else setTogetherOpen(true); };

  return (
    <>
      <ReactionLayer items={reactions.items} />
      <ChatLayer items={chat.live} />
      <PartyLayer
        party={status.party} control={client.party} peerName={peerName} notice={shown === 'full' ? null : notice} onDismissNotice={dismissNotice}
        watch={shown !== 'full' && invite && dismissedWatch !== invite.titleId ? invite : null}
        onJump={() => client.jumpToPeer()} onDismissWatch={() => invite && setDismissedWatch(invite.titleId)}
      />
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
                <div className={`absolute inset-x-1.5 bottom-1.5 flex justify-center transition-opacity duration-150 motion-reduce:transition-none opacity-0 group-hover:opacity-100 focus-within:opacity-100`}>
                  <div className="surface-float flex items-center gap-1 rounded-2xl p-1">
                    {size === 'S' ? (
                      <IconButton small onClick={() => client.toggleMic()} active={c.micOn} title={c.micOn ? 'Mute microphone' : 'Unmute microphone'}>{c.micOn ? <Mic size={16} /> : <MicOff size={16} />}</IconButton>
                    ) : (
                      <>
                        {compactCallButtons()}
                        {size === 'L' && (c.active
                          ? <IconButton small onClick={() => client.endCall()} danger title="End call"><PhoneOff size={16} /></IconButton>
                          : <IconButton small onClick={startCall} title="Start call"><Phone size={16} /></IconButton>)}
                        <IconButton small onClick={() => openTool('chat')} title="Chat, emoji, sounds and more"><MessageCircle size={16} /></IconButton>
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
                style={{ maxHeight: `calc(100vh - ${Math.max(0, pos.y) + 12}px)` }} // never taller than the space below it: scroll instead of running off-screen
                className="surface-float overflow-y-auto overscroll-contain rounded-2xl [scrollbar-width:thin]"
              >
                {/* Header / drag handle */}
                <div className="cursor-grab px-3 pb-1.5 pt-2.5 active:cursor-grabbing" onPointerDown={(e) => onPointerDown(e, winRef.current)}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1"><Logo size="sm" /></div>
                    {inCall && <button type="button" title="Show only the videos" onMouseDown={(e) => e.preventDefault()} onClick={() => setMode('cinema')} className="focus-candy surface-raised flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-semibold text-white hover:bg-[#2c3760]"><Clapperboard size={14} /> Videos only</button>}
                    <button type="button" title="Minimize" aria-label="Minimize" onMouseDown={(e) => e.preventDefault()} onClick={() => setMode('pill')} className="focus-candy surface-raised flex h-8 w-8 items-center justify-center rounded-lg text-white hover:bg-[#2c3760]"><Minus size={15} /></button>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[12.5px] leading-4 text-soft">
                    <StatusDot tone={conn.tone} className="!h-2 !w-2" />
                    <span className="truncate">{status.peer ? `${conn.text} · with ${peerName}` : conn.text}</span>
                  </div>
                </div>

                <div className="space-y-2 px-3 pb-3">
                  {/* The friend is watching something we aren't: one tap to join them */}
                  {invite && (
                    <div className="rounded-xl border border-[#8c7a1f] bg-[#2f2a0f] p-2.5">
                      <div className="text-[12.5px] font-bold text-lemon">{invite.name} is watching</div>
                      <div className="mb-2 truncate text-[14px] font-bold text-white" title={invite.title ?? undefined}>{invite.title ?? 'a video'}</div>
                      <TextButton tone="lemon" onClick={() => client.jumpToPeer()}>Jump there →</TextButton>
                    </div>
                  )}

                  {/* Stage: the videos are always here */}
                  <AnimatePresence initial={false} mode="wait">
                    {inCall ? (
                      <motion.div key="v" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{videos(false)}</motion.div>
                    ) : (
                      <motion.div key="e" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="surface flex w-full flex-col items-center justify-center gap-2 rounded-xl px-3 py-4 text-center">
                        <p className="text-[13px] font-semibold text-white">{status.peer ? `${peerName} is here. Start a video call?` : 'Waiting for your friend to join…'}</p>
                        <TextButton tone="candy" disabled={!status.peer} onClick={startCall}><Phone size={15} /> Start video call</TextButton>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {!c.active && status.peer?.inCall && (
                    <TextButton tone="lemon" onClick={startCall}>{peerName} is in a call. Join →</TextButton>
                  )}

                  {/* Call controls */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <Chip onClick={() => client.toggleMic()} state={c.micOn ? 'normal' : 'off'} label={c.micOn ? 'Mic on' : 'Mic off'} title={c.micOn ? 'Mute microphone' : 'Unmute microphone'} icon={c.micOn ? <Mic size={15} /> : <MicOff size={15} />} />
                    <Chip onClick={() => void client.toggleCam()} state={c.camOn ? 'normal' : 'off'} label={c.camOn ? 'Cam on' : 'Cam off'} title={c.camOn ? 'Turn camera off' : 'Turn camera on'} icon={c.camOn ? <Video size={15} /> : <VideoOff size={15} />} />
                    {c.active
                      ? <Chip onClick={() => client.endCall()} state="danger" label="End call" icon={<PhoneOff size={15} />} />
                      : <Chip onClick={startCall} label="Start call" icon={<Phone size={15} />} />}
                  </div>

                  {/* Do together: collapsible; a tool opens inside this box, the videos above stay put */}
                  <section className="surface rounded-xl">
                    <div className="flex h-10 items-center gap-1.5 px-1.5">
                      {screen ? (
                        <>
                          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={goBack} className="focus-candy surface-raised flex h-8 items-center gap-1 rounded-lg pl-1.5 pr-2.5 text-[12.5px] font-bold text-white hover:bg-[#2c3760]"><ArrowLeft size={14} /> Back</button>
                          <h3 className="min-w-0 flex-1 truncate text-[13px] font-bold text-white">{TOOL_TITLES[screen]}</h3>
                        </>
                      ) : (
                        <button type="button" aria-expanded={togetherOpen} onMouseDown={(e) => e.preventDefault()} onClick={toggleTogether} className="focus-candy flex h-8 min-w-0 flex-1 items-center rounded-lg px-2 text-left text-[13px] font-bold text-white">Do together</button>
                      )}
                      <button type="button" aria-label={togetherOpen ? 'Collapse Do together' : 'Expand Do together'} aria-expanded={togetherOpen} onMouseDown={(e) => e.preventDefault()} onClick={toggleTogether} className="focus-candy flex h-8 w-8 items-center justify-center rounded-lg text-soft hover:bg-white/10 hover:text-white">
                        <motion.span animate={{ rotate: togetherOpen ? 180 : 0 }} transition={SPRING}><ChevronDown size={16} /></motion.span>
                      </button>
                    </div>
                    <Collapse open={togetherOpen}>
                      {screen ? (
                        <ToolPane
                          kind={screen} funTab={funTab} onFunTab={setFunTab} onBack={goBack}
                          connected={connected} peerName={peerName} hasGiphyKey={!!settings.giphyApiKey}
                          chat={chat.log} party={status.party} muted={soundsMuted} onMuted={setSoundsMuted}
                          onReaction={sendSticker}
                          onChat={(t) => { const ok = client.sendChat(t); if (!ok) client.notify('Couldn’t send. Are you connected to your friend?'); return ok; }}
                          onSound={(id) => { if (!client.sendSound(id)) client.notify('Can’t play sounds until you’re connected to your friend.'); }}
                          onReady={() => client.party.requestReadyCheck()} onBrb={() => client.party.requestBrb()}
                        />
                      ) : (
                        <div className="grid grid-cols-4 gap-1.5 px-2.5 pb-2.5">
                          <Chip tight onClick={() => openTool('chat')} label="Chat" icon={<MessageCircle size={14} />} />
                          <Chip tight onClick={() => openTool('fun')} label="Emoji" title="Emoji, stickers and GIFs" icon={<Smile size={15} />} />
                          <Chip tight onClick={() => openTool('sounds')} label="Sounds" icon={<Volume2 size={15} />} />
                          <Chip tight onClick={() => openTool('pause')} label="Pause" title="Ready check or take a break" icon={<SquareCheckBig size={15} />} />
                        </div>
                      )}
                    </Collapse>
                  </section>

                  {/* Watch-sync actions */}
                  {status.peer && status.sync !== 'different-title' && (
                    status.follow === 'followed' ? (
                      <div className="surface rounded-lg px-3 py-2 text-center text-[12.5px] font-semibold text-white">{peerName} is following you.</div>
                    ) : status.follow === 'following' ? (
                      <TextButton tone="lemon" onClick={() => client.stopFollowingPeer()} title="Stop mirroring your friend"><RefreshCw size={14} /> Following {peerName}. Tap to stop</TextButton>
                    ) : (
                      <TextButton disabled={status.player !== 'ready'} onClick={() => client.followPeer()} title={status.player !== 'ready' ? 'Open a video first' : `Mirror ${peerName}: you will follow their playback`}>
                        <RefreshCw size={14} /> Jump to {peerName}’s spot
                      </TextButton>
                    )
                  )}

                  <AnimatePresence initial={false}>
                    {(c.error || notice) && (
                      <motion.div key="n" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div role="alert" className="flex items-start gap-2 rounded-lg border border-[#8c7a1f] bg-[#2f2a0f] px-3 py-2 text-[12.5px] leading-[18px] text-lemon">
                          <span className="flex-1">{c.error ?? notice}</span>
                          {notice && <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={dismissNotice} aria-label="Dismiss" className="focus-candy rounded p-0.5"><X size={14} /></button>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Invite + leave */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <Chip onClick={() => void copy()} label={copied ? 'Link copied' : 'Invite link'} title="Copy an invite link for this site" icon={copied ? <Check size={15} className="text-mint" /> : <Link2 size={15} />} />
                    {confirmLeave
                      ? <Chip onClick={onLeave} state="danger" label="Tap to confirm" icon={<Check size={15} />} />
                      : <Chip onClick={() => { setConfirmLeave(true); setTimeout(() => setConfirmLeave(false), 3000); }} label="Leave room" icon={<LogOut size={15} />} />}
                  </div>

                  {/* Collapsible details */}
                  <Section compact title="Connection details" icon={<Activity size={15} className="text-mint" />} defaultOpen={false} badge={<StatusDot tone={sync.tone} className="!h-2 !w-2" />}>
                    <dl className="space-y-1.5 text-[12.5px]">
                      {[[status.siteName || 'Player', player], ['Sync', sync], ['Call', call], ...(video ? [['Video', video]] : [])].map(([k, l]) => {
                        const label = l as typeof conn;
                        return (
                          <div key={k as string} className="flex items-start gap-2">
                            <dt className="w-12 shrink-0 font-bold text-mute">{k as string}</dt>
                            <dd className="flex min-w-0 flex-1 items-start gap-1.5 text-white"><StatusDot tone={label.tone} className="mt-1.5 !h-2 !w-2" /><span>{label.text}</span></dd>
                          </div>
                        );
                      })}
                      {video?.fix && (
                        <div className="pl-14"><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void client.fixMedia()} className="focus-candy rounded-md bg-lemon px-2.5 py-1 text-[12.5px] font-bold text-grape-950 hover:brightness-105">Fix video (both sides)</button></div>
                      )}
                      {status.rtt !== null && <div className="pl-14 text-[12px] text-mute">{status.transport === 'datachannel' ? (status.relayed ? 'via TURN relay' : 'direct peer-to-peer') : status.transport === 'relay-fallback' ? 'via server fallback' : ''} · {status.rtt} ms</div>}
                    </dl>
                  </Section>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>

      </div>
    </>
  );
}
