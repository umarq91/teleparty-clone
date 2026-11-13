import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Coffee, Hourglass, Loader2, Megaphone, MessageCircle, Play, SquareCheckBig, Tv, Volume2, X } from 'lucide-react';
import type { PartyControl } from '@/content/PartyControl';
import type { PartyState } from '@/shared/types';
import { SPRING } from '@/shared/ui/kit';
import { useNow, type ChatItem } from './hooks';

/* ---------- Chat bubbles floating over the movie ---------- */

/** Semi-transparent bubbles that fade on their own, so nothing needs closing and the picture stays clear. */
export function ChatLayer({ items }: { items: ChatItem[] }) {
  return (
    <div className="mtp-root pointer-events-none fixed bottom-24 right-4 flex w-[min(320px,80vw)] flex-col items-end gap-1.5" style={{ zIndex: 2147483001 }} aria-live="polite" aria-relevant="additions">
      <AnimatePresence initial={false}>
        {items.map((m) => (
          <motion.div
            key={m.key} layout
            initial={{ opacity: 0, y: 14, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.9 } }} transition={SPRING}
            className={`max-w-full rounded-2xl px-3.5 py-2 text-[14px] leading-5 text-white shadow-[0_6px_18px_rgb(0_0_0/.5)] ${m.mine ? 'rounded-br-md border border-[#2f7da8] bg-[#174a68]' : 'rounded-bl-md border border-[#3b4772] bg-[#1c2540]'}`}
          >
            {m.kind === 'sound' ? (
              <span className="flex items-center gap-1.5 text-soft"><Volume2 size={13} className="shrink-0 text-lemon" /><b className={m.mine ? 'text-sky' : 'text-gum'}>{m.from}</b> {m.text}</span>
            ) : (
              <><b className={`mr-1.5 text-[12px] uppercase tracking-wide ${m.mine ? 'text-sky' : 'text-gum'}`}>{m.from}</b><span className="break-words">{m.text}</span></>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Shared pauses, ready checks, countdowns ---------- */

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ToastButton({ onClick, primary, children }: { onClick: () => void; primary?: boolean; children: ReactNode }) {
  return (
    <motion.button
      type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      whileHover={{ y: -1.5 }} whileTap={{ scale: 0.94 }} transition={SPRING}
      className={`focus-candy h-10 whitespace-nowrap rounded-xl px-4 text-[14px] font-bold ${primary ? 'bg-mint text-grape-950' : 'surface-raised text-white hover:bg-[#2c3760]'}`}
    >{children}</motion.button>
  );
}

interface Toast { key: string; icon: ReactNode; tone: string; title: string; sub?: string; actions: ReactNode | null }

function describe(p: PartyState, peer: string, party: PartyControl, now: number): Toast | null {
  const away = fmt(now - p.since);
  if (p.countdownTo !== null && p.countdownQuick) {
    return { key: 'quick', tone: 'bg-mint', icon: <Play size={17} className="fill-current" />, title: `Resuming in ${Math.max(1, Math.ceil((p.countdownTo - now) / 1000))}…`, sub: 'Both of you, at the same moment.', actions: <ToastButton onClick={() => party.cancel()}>Wait!</ToastButton> };
  }
  if (p.countdownTo !== null) return null; // the big numerals take over
  switch (p.hold) {
    case 'buffering': {
      if (p.why === 'ad' && p.by === 'me') {
        return { key: 'ad-me', tone: 'bg-lemon', icon: <Megaphone size={17} />, title: 'An ad is playing', sub: `${peer} is paused so you don’t miss anything. We restart together after it.`, actions: null };
      }
      if (p.why === 'ad' && p.by === 'peer') {
        return { key: 'ad-peer', tone: 'bg-lemon', icon: <Megaphone size={17} />, title: `${peer} is watching an ad`, sub: 'Paused for both of us. We restart together after it.', actions: <ToastButton onClick={() => party.resumeNow()}>Don’t wait</ToastButton> };
      }
      const waiting = p.by === null;
      return {
        key: 'buf', tone: 'bg-lemon', icon: <Loader2 size={17} className="animate-spin" />,
        title: waiting ? 'Almost there…' : p.by === 'me' ? 'Your video is catching up' : p.by === 'peer' ? `${peer}'s video is catching up` : 'Both videos are catching up',
        sub: waiting ? 'Restarting together.' : p.by === 'me' ? `${peer} is paused too, so nobody misses anything.` : 'Paused for both of us. We restart together.',
        actions: <ToastButton onClick={() => party.resumeNow()}>Don’t wait</ToastButton>,
      };
    }
    case 'brb': {
      const mine = p.by !== 'peer';
      return {
        key: 'brb', tone: 'bg-tang', icon: <Coffee size={17} />,
        title: mine ? 'You’re on a break' : `${peer} stepped away`,
        sub: `Paused for both · ${away}`,
        actions: <ToastButton primary onClick={() => party.resumeNow()}>{mine ? 'I’m back' : 'Resume'}</ToastButton>,
      };
    }
    case 'ready-check': {
      if (p.by === 'peer' && !p.meReady) {
        return {
          key: 'rc-ask', tone: 'bg-mint', icon: <SquareCheckBig size={17} />, title: `${peer} asks: ready?`, sub: 'Say yes and we count down 3-2-1.',
          actions: <><ToastButton onClick={() => party.cancel()}>Not yet</ToastButton><ToastButton primary onClick={() => party.imReady()}>I’m ready!</ToastButton></>,
        };
      }
      return {
        key: 'rc-wait', tone: 'bg-mint', icon: <Hourglass size={17} />, title: p.meReady && p.by === 'peer' ? 'Locked in, starting…' : `Waiting for ${peer}…`, sub: 'The countdown starts as soon as they say ready.',
        actions: <><ToastButton onClick={() => party.cancel()}>Cancel</ToastButton><ToastButton onClick={() => party.resumeNow()}>Start anyway</ToastButton></>,
      };
    }
    default: return null;
  }
}

/** Top-centre status toast + the big centre-screen 3-2-1. Both sit above the movie and never block it. */
export function PartyLayer({ party: p, control, peerName, notice, onDismissNotice, watch, onJump, onDismissWatch }: { party: PartyState; control: PartyControl; peerName: string; notice: string | null; onDismissNotice: () => void; watch: { name: string; title: string | null } | null; onJump: () => void; onDismissWatch: () => void }) {
  const ticking = p.hold !== 'none' || p.countdownTo !== null;
  const now = useNow(ticking, 200);
  const toast = describe(p, peerName, control, now);

  // "GO!" flash, only after a *big* countdown actually finished (not after a cancelled one or a quick resume).
  const wasBig = useRef(false);
  const seenGo = useRef(p.goAt);
  const [flash, setFlash] = useState(false);
  useEffect(() => { if (p.countdownTo !== null) wasBig.current = !p.countdownQuick; }, [p.countdownTo, p.countdownQuick]);
  useEffect(() => {
    if (!p.goAt || p.goAt === seenGo.current) return;
    seenGo.current = p.goAt;
    if (!wasBig.current) return;
    wasBig.current = false;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [p.goAt]);

  const big = p.countdownTo !== null && !p.countdownQuick;
  const n = big ? Math.max(1, Math.ceil((p.countdownTo! - now) / 1000)) : 0;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-4 flex flex-col items-center gap-2 px-4" style={{ zIndex: 2147483002 }}>
        <AnimatePresence mode="popLayout">
          {toast && (
            <motion.div
              key={toast.key} role="status" aria-live="polite"
              initial={{ opacity: 0, y: -16, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.96 }} transition={SPRING}
              className="mtp-root surface-float pointer-events-auto flex max-w-[min(520px,94vw)] flex-wrap items-center gap-3 rounded-[22px] py-3 pl-3 pr-3.5"
              onKeyDown={(e) => e.stopPropagation()}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${toast.tone} text-grape-950`}>{toast.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold leading-5 text-white">{toast.title}</div>
                {toast.sub && <div className="text-[13px] leading-[18px] text-soft">{toast.sub}</div>}
              </div>
              {toast.actions && <div className="flex items-center gap-1.5">{toast.actions}</div>}
            </motion.div>
          )}
          {watch && p.hold === 'none' && (
            <motion.div
              key="watch" role="status"
              initial={{ opacity: 0, y: -16, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.96 }} transition={SPRING}
              className="mtp-root surface-float pointer-events-auto flex max-w-[min(520px,94vw)] flex-wrap items-center gap-3 rounded-[18px] py-3 pl-3 pr-3.5"
              onKeyDown={(e) => e.stopPropagation()}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lemon text-grape-950"><Tv size={18} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold leading-5 text-white">{watch.name} is watching</div>
                <div className="max-w-[320px] truncate text-[13px] leading-[18px] text-soft">{watch.title ?? 'a video'}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <ToastButton onClick={onDismissWatch}>Not now</ToastButton>
                <ToastButton primary onClick={onJump}>Jump there</ToastButton>
              </div>
            </motion.div>
          )}
          {!toast && notice && p.hold === 'none' && (
            <motion.div key="notice" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING}
              className="mtp-root surface-float pointer-events-auto flex max-w-[min(460px,94vw)] items-start gap-2 rounded-2xl px-3.5 py-3 text-[14px] leading-5 text-white">
              <MessageCircle size={14} className="mt-px shrink-0 text-lemon" /><span className="flex-1">{notice}</span>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onDismissNotice} aria-label="Dismiss" className="focus-candy rounded text-mute hover:text-white"><X size={13} /></button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="pointer-events-none fixed inset-0 flex flex-col items-center justify-center" style={{ zIndex: 2147483002 }} aria-hidden={!big && !flash}>
        <AnimatePresence mode="popLayout">
          {big && (
            <motion.div key={n} initial={{ opacity: 0, scale: 1.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.35, ease: [0.2, 1.3, 0.4, 1] }}
              className="mtp-root flex h-[230px] w-[230px] items-center justify-center rounded-full border-4 border-gum bg-[#0e1322] font-display text-[150px] font-bold leading-none text-white">{n}</motion.div>
          )}
          {!big && flash && (
            <motion.div key="go" initial={{ opacity: 0, scale: 0.5, rotate: -8 }} animate={{ opacity: 1, scale: 1.05, rotate: 0 }} exit={{ opacity: 0, scale: 1.5 }} transition={SPRING}
              className="mtp-root flex h-[230px] w-[230px] items-center justify-center rounded-full border-4 border-mint bg-[#0e1322] font-display text-[84px] font-bold leading-none text-mint">GO!</motion.div>
          )}
        </AnimatePresence>
        {big && (
          <div className="pointer-events-auto mt-6">
            <ToastButton onClick={() => control.cancel()}>Wait, hold on!</ToastButton>
          </div>
        )}
      </div>
    </>
  );
}
