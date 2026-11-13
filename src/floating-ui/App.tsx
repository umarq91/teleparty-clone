import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  Activity, Check, Clapperboard, LogOut, Link2, Maximize2, Mic, MicOff, Minus, Phone, PhoneOff, RefreshCw,
  Smile, Video, VideoOff, X, Maximize, Shrink,
} from 'lucide-react';
import type { RoomClient } from '@/content/RoomClient';
import { callLabel, connectionLabel, playerLabel, syncLabel, videoLabel } from '@/shared/statusText';
import { StatusDot } from '@/shared/ui/StatusDot';
import { Section, SPRING } from '@/shared/ui/kit';
import { useDrag, useLiveSettings, useNotice, usePanelMode, useReactions, useRemoteStream, useRoomStatus, type CinemaSize } from './hooks';
import { ReactionLayer, StickerTray } from './Reactions';
import { VideoTile } from './VideoTile';

interface Props {
  client: RoomClient;
  inviteLink: string;
  onLeave: () => void;
}

const CINEMA_W: Record<CinemaSize, number> = { S: 150, M: 220, L: 320 };
const NEXT_SIZE: Record<CinemaSize, CinemaSize> = { S: 'M', M: 'L', L: 'S' };

/** Round control button. Mouse-down is swallowed so keyboard focus stays on Netflix (Space = play/pause). */
function IconButton({ onClick, active = true, danger, title, small, children }: { onClick: () => void; active?: boolean; danger?: boolean; title: string; small?: boolean; children: React.ReactNode }) {
  return (
    <motion.button
      type="button" title={title} aria-label={title}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      whileHover={{ y: -2, scale: 1.08 }} whileTap={{ scale: 0.88 }} transition={SPRING}
      className={`focus-candy flex shrink-0 items-center justify-center rounded-full ${small ? 'h-9 w-9' : 'h-11 w-11'} ${
        danger ? 'bg-gradient-to-b from-gum to-gum-deep text-white shadow-candy'
        : active ? 'glass-chip text-white hover:bg-white/20'
        : 'border border-gum/40 bg-gum/20 text-[#ff9ccf]'}`}
    >
      {children}
    </motion.button>
  );
}

function TextButton({ onClick, disabled, tone = 'glass', title, children }: { onClick: () => void; disabled?: boolean; tone?: 'glass' | 'candy' | 'lemon'; title?: string; children: React.ReactNode }) {
  const style = tone === 'candy' ? 'bg-gradient-to-b from-gum to-gum-deep text-white shadow-candy'
    : tone === 'lemon' ? 'bg-lemon text-grape-950' : 'glass-chip text-white';
  return (
    <motion.button
      type="button" disabled={disabled} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      whileHover={disabled ? undefined : { y: -1.5, scale: 1.015 }} whileTap={disabled ? undefined : { scale: 0.96 }} transition={SPRING}
      className={`focus-candy flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${style}`}
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
  const [trayOpen, setTrayOpen] = useState(false);
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

  const sendSticker = (r: { emoji?: string; gif?: string; label?: string }) => {
    const ok = client.sendReaction(r);
    if (ok) reactions.add({ from: 'You', emoji: r.emoji, gif: r.gif, mine: true });
    else client.notify('Can’t send stickers until you’re connected to your friend.');
  };

  const startCall = () => void client.startCall().catch(() => undefined);
  const trayAbove = pos.y > window.innerHeight / 2;
  const width = shown === 'full' ? 344 : shown === 'cinema' ? CINEMA_W[size] : 'auto';

  /** Mic / cam / call buttons, shared by full + cinema layouts. */
  const callButtons = (small?: boolean) => (
    <>
      <IconButton small={small} onClick={() => client.toggleMic()} active={c.micOn} title={c.micOn ? 'Mute microphone' : 'Unmute microphone'}>{c.micOn ? <Mic size={small ? 14 : 17} /> : <MicOff size={small ? 14 : 17} />}</IconButton>
      <IconButton small={small} onClick={() => void client.toggleCam()} active={c.camOn} title={c.camOn ? 'Turn camera off' : 'Turn camera on'}>{c.camOn ? <Video size={small ? 14 : 17} /> : <VideoOff size={small ? 14 : 17} />}</IconButton>
      {c.active
        ? <IconButton small={small} onClick={() => client.endCall()} danger title="End call"><PhoneOff size={small ? 14 : 17} /></IconButton>
        : <IconButton small={small} onClick={startCall} title="Start call"><Phone size={small ? 14 : 17} /></IconButton>}
    </>
  );

  const stickerButton = (small?: boolean) => (
    <IconButton small={small} onClick={() => setTrayOpen((o) => !o)} active={!trayOpen} title="Stickers & GIFs"><Smile size={small ? 14 : 17} /></IconButton>
  );

  const videos = (compact: boolean) => (
    <div className={`relative w-full ${compact ? 'aspect-[4/3]' : 'aspect-[4/3]'}`}>
      <VideoTile stream={remote} label={peerName} hasVideo={c.remoteCamOn} micOn={c.remoteMicOn} compact={compact} className="h-full w-full" />
      {c.active && (
        <VideoTile
          stream={client.media.stream} label="You" muted mirror hasVideo={c.camOn} micOn={c.micOn} tint="sky" compact
          className={`absolute right-2 top-2 shadow-lg ${compact ? 'h-[32%] w-[34%]' : 'h-[26%] w-[30%]'}`}
        />
      )}
    </div>
  );

  return (
    <>
      <ReactionLayer items={reactions.items} />
      <div
        ref={winRef}
        className="mtp-root pointer-events-auto fixed select-none"
        style={{ left: pos.x, top: pos.y, width, zIndex: 2147483000 }}
        // Don't let Netflix see keystrokes/clicks aimed at our UI.
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <LayoutGroup>
          <AnimatePresence mode="popLayout" initial={false}>
            {shown === 'pill' && (
              <motion.div
                key="pill" layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={SPRING}
                className="glass-deep flex cursor-grab items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 active:cursor-grabbing"
                onPointerDown={(e) => onPointerDown(e, winRef.current)}
              >
                <StatusDot tone={conn.tone} />
                <span className="font-display text-[12px] font-extrabold text-candy animate-sheen">PariParty</span>
                {c.active && <IconButton small onClick={() => client.toggleMic()} active={c.micOn} title={c.micOn ? 'Mute microphone' : 'Unmute microphone'}>{c.micOn ? <Mic size={14} /> : <MicOff size={14} />}</IconButton>}
                {inCall && <IconButton small onClick={() => setMode('cinema')} title="Videos only"><Clapperboard size={14} /></IconButton>}
                <IconButton small onClick={() => setMode('full')} title="Open panel"><Maximize2 size={14} /></IconButton>
              </motion.div>
            )}

            {shown === 'cinema' && (
              <motion.div
                key="cinema" layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={SPRING}
                className="group relative cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => onPointerDown(e, winRef.current)}
              >
                {videos(true)}
                {/* Controls fade in only on hover, so nothing sits on top of the movie while watching. */}
                <div className={`absolute inset-x-1.5 bottom-1.5 flex justify-center transition-opacity duration-200 motion-reduce:transition-none ${trayOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                  <div className="glass-deep flex items-center gap-1 rounded-full p-1">
                    {size === 'S' ? (
                      <IconButton small onClick={() => client.toggleMic()} active={c.micOn} title={c.micOn ? 'Mute microphone' : 'Unmute microphone'}>{c.micOn ? <Mic size={14} /> : <MicOff size={14} />}</IconButton>
                    ) : (
                      <>
                        <IconButton small onClick={() => client.toggleMic()} active={c.micOn} title={c.micOn ? 'Mute microphone' : 'Unmute microphone'}>{c.micOn ? <Mic size={14} /> : <MicOff size={14} />}</IconButton>
                        <IconButton small onClick={() => void client.toggleCam()} active={c.camOn} title={c.camOn ? 'Turn camera off' : 'Turn camera on'}>{c.camOn ? <Video size={14} /> : <VideoOff size={14} />}</IconButton>
                        {size === 'L' && (c.active
                          ? <IconButton small onClick={() => client.endCall()} danger title="End call"><PhoneOff size={14} /></IconButton>
                          : <IconButton small onClick={startCall} title="Start call"><Phone size={14} /></IconButton>)}
                        {stickerButton(true)}
                      </>
                    )}
                    <IconButton small onClick={() => setSize(NEXT_SIZE[size])} title={`Size: ${size} (click to change)`}>{size === 'L' ? <Shrink size={14} /> : <Maximize size={14} />}</IconButton>
                    <IconButton small onClick={() => setMode('full')} title="Show full panel"><Maximize2 size={14} /></IconButton>
                  </div>
                </div>
              </motion.div>
            )}

            {shown === 'full' && (
              <motion.div
                key="full" layout initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} transition={SPRING}
                className="glass-deep relative overflow-hidden rounded-[26px]"
              >
                {/* decorative glow */}
                <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-gum/30 blur-3xl" />
                <div aria-hidden className="pointer-events-none absolute -bottom-12 -left-10 h-32 w-32 rounded-full bg-sky/25 blur-3xl" />

                {/* Header / drag handle */}
                <div className="relative flex cursor-grab items-center gap-2.5 px-3.5 pb-1 pt-3 active:cursor-grabbing" onPointerDown={(e) => onPointerDown(e, winRef.current)}>
                  <span aria-hidden className="text-[20px] leading-none animate-bob">🎉</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15px] font-black leading-4 tracking-tight text-candy animate-sheen">PariParty</div>
                    <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] leading-4 text-white/65">
                      <StatusDot tone={conn.tone} className="!h-1.5 !w-1.5" />
                      <span className="truncate">{status.peer ? `${conn.text} · with ${peerName}` : conn.text}</span>
                    </div>
                  </div>
                  {inCall && <IconButton small onClick={() => setMode('cinema')} title="Videos only (hide everything else)"><Clapperboard size={14} /></IconButton>}
                  <IconButton small onClick={() => setMode('pill')} title="Collapse to a pill"><Minus size={14} /></IconButton>
                </div>

                <div className="relative space-y-2.5 p-3.5 pt-2.5">
                  {/* Stage */}
                  <AnimatePresence initial={false} mode="wait">
                    {inCall ? (
                      <motion.div key="v" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>{videos(false)}</motion.div>
                    ) : (
                      <motion.div key="e" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="glass flex aspect-[16/8] w-full flex-col items-center justify-center gap-2 rounded-2xl text-center">
                        <span className="text-[30px] leading-none animate-bob">{status.peer ? '📞' : '🛋️'}</span>
                        <p className="px-4 text-[12px] font-semibold text-white/70">{status.peer ? `Ring ${peerName} for a video call` : 'Waiting for your person to show up'}</p>
                        <TextButton tone="candy" disabled={!status.peer} onClick={startCall}><Phone size={13} /> Start call</TextButton>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Control dock */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">{callButtons()}</div>
                    <div className="flex items-center gap-1.5">
                      {stickerButton()}
                      <IconButton onClick={() => void copy()} title={copied ? 'Copied!' : 'Copy invite link'}>{copied ? <Check size={17} className="text-mint" /> : <Link2 size={17} />}</IconButton>
                      {confirmLeave
                        ? <IconButton onClick={onLeave} danger title="Tap again to leave the room"><Check size={17} /></IconButton>
                        : <IconButton onClick={() => { setConfirmLeave(true); setTimeout(() => setConfirmLeave(false), 3000); }} title="Leave room"><LogOut size={17} /></IconButton>}
                    </div>
                  </div>

                  {!c.active && status.peer?.inCall && (
                    <TextButton tone="lemon" onClick={startCall}><span>{peerName} is in the call 👀</span><span>Join →</span></TextButton>
                  )}

                  <AnimatePresence initial={false}>
                    {(c.error || notice) && (
                      <motion.div key="n" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="flex items-start gap-2 rounded-xl border border-lemon/30 bg-lemon/10 px-3 py-2 text-[11.5px] leading-4 text-lemon">
                          <span className="flex-1">{c.error ?? notice}</span>
                          {notice && <button onMouseDown={(e) => e.preventDefault()} onClick={dismissNotice} aria-label="Dismiss"><X size={12} /></button>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Watch-sync actions */}
                  {status.sync === 'different-title' && status.peer?.titleId && (
                    <TextButton tone="lemon" onClick={() => client.followPeerTitle()}><span>{peerName} is watching something else</span><span>Go there →</span></TextButton>
                  )}
                  {status.peer && status.sync !== 'different-title' && (
                    status.follow === 'followed' ? (
                      <div className="glass rounded-xl px-3 py-2 text-center text-[12px] font-semibold text-white/80">{peerName} is following you. Just watch normally 🍿</div>
                    ) : status.follow === 'following' ? (
                      <TextButton tone="lemon" onClick={() => client.stopFollowingPeer()} title="Stop mirroring your friend"><RefreshCw size={13} /> Following {peerName} · tap to stop</TextButton>
                    ) : (
                      <TextButton disabled={status.player !== 'ready'} onClick={() => client.followPeer()} title={status.player !== 'ready' ? 'Open a movie on Netflix first' : `Mirror ${peerName}: you will follow their playback`}>
                        <RefreshCw size={13} /> Follow {peerName}
                      </TextButton>
                    )
                  )}

                  {/* Collapsible details */}
                  <Section title="Under the hood" icon={<Activity size={15} className="text-mint" />} defaultOpen={false} badge={<StatusDot tone={sync.tone} />}>
                    <dl className="space-y-1.5 text-[11.5px]">
                      {[['Netflix', player], ['Sync', sync], ['Call', call], ...(video ? [['Video', video]] : [])].map(([k, l]) => {
                        const label = l as typeof conn;
                        return (
                          <div key={k as string} className="flex items-start gap-2">
                            <dt className="w-12 shrink-0 font-bold text-white/65">{k as string}</dt>
                            <dd className="flex min-w-0 flex-1 items-start gap-1.5 text-white/85"><StatusDot tone={label.tone} className="mt-1 !h-1.5 !w-1.5" /><span>{label.text}</span></dd>
                          </div>
                        );
                      })}
                      {video?.fix && (
                        <div className="pl-14"><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void client.fixMedia()} className="focus-candy rounded-lg bg-lemon px-2.5 py-1 text-[11px] font-bold text-grape-950 hover:brightness-105">Fix video (both sides)</button></div>
                      )}
                      {status.rtt !== null && <div className="pl-14 text-[10.5px] text-white/60">{status.transport === 'datachannel' ? (status.relayed ? 'via TURN relay' : 'direct peer-to-peer') : status.transport === 'relay-fallback' ? 'via server fallback' : ''} · {status.rtt} ms</div>}
                    </dl>
                  </Section>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>

        {/* Sticker tray floats beside whichever layout is showing */}
        <AnimatePresence>
          {trayOpen && (
            <div className={`absolute left-0 ${trayAbove ? 'bottom-full mb-2' : 'top-full mt-2'}`} style={{ maxWidth: '100vw' }}>
              <StickerTray hasKey={!!settings.giphyApiKey} onClose={() => setTrayOpen(false)} onSend={sendSticker} />
            </div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
