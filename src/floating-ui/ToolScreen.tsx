import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Coffee, Search, Send, Sparkles, SquareCheckBig, Volume2, VolumeX } from 'lucide-react';
import type { SoundId } from '@/shared/protocol';
import { sendRuntime, type StickerResult, type StickerSearchResponse } from '@/shared/messaging';
import type { PartyState } from '@/shared/types';
import { SPRING } from '@/shared/ui/kit';
import { searchEmojis } from './emojis';
import type { ChatItem } from './hooks';
import { SOUNDS } from './sounds';
import { MessageCircle } from 'lucide-react';

/** The four "do together" screens that open inside the panel. */
export type ToolKind = 'chat' | 'fun' | 'sounds' | 'pause';
export type FunTab = 'emoji' | 'stickers' | 'gifs';

export const TOOL_TITLES: Record<ToolKind, string> = { chat: 'Chat', fun: 'Emoji, stickers & GIFs', sounds: 'Sounds', pause: 'Pause together' };

export interface ScreenProps {
  kind: ToolKind;
  funTab: FunTab;
  onFunTab: (t: FunTab) => void;
  onBack: () => void;
  /** Can we reach the friend right now? Sending anything needs the peer connection. */
  connected: boolean;
  peerName: string;
  hasGiphyKey: boolean;
  chat: ChatItem[];
  party: PartyState;
  muted: boolean;
  onMuted: (m: boolean) => void;
  onReaction: (r: { emoji?: string; gif?: string; label?: string }) => void;
  onChat: (text: string) => boolean;
  onSound: (id: SoundId) => void;
  onReady: () => void;
  onBrb: () => void;
}

const FUN_TABS: { id: FunTab; label: string }[] = [{ id: 'emoji', label: 'Emoji' }, { id: 'stickers', label: 'Stickers' }, { id: 'gifs', label: 'GIFs' }];

/**
 * The content of the "Do together" box (chat, emoji/stickers/GIFs, sounds, pause tools). The panel's header and the
 * Back button live in the box header (App.tsx); the video and call controls stay visible above it.
 */
export function ToolPane(p: ScreenProps) {
  const [q, setQ] = useState('');
  useEffect(() => setQ(''), [p.kind, p.funTab]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
      role="region" aria-label={TOOL_TITLES[p.kind]}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); p.onBack(); } }}
      className="space-y-2 px-2.5 pb-2.5"
    >
      {p.kind === 'fun' && (
        <>
          <div role="tablist" aria-label="Reaction type" className="grid grid-cols-3 gap-1 rounded-lg bg-[#0b0f1d] p-0.5">
            {FUN_TABS.map((t) => (
              <button
                key={t.id} role="tab" type="button" aria-selected={p.funTab === t.id} onMouseDown={(e) => e.preventDefault()} onClick={() => p.onFunTab(t.id)}
                className={`focus-candy h-8 rounded-md text-[13px] font-bold transition-colors ${p.funTab === t.id ? 'bg-lemon text-grape-950' : 'text-soft hover:bg-white/10 hover:text-white'}`}
              >{t.label}</button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search"
              placeholder={p.funTab === 'emoji' ? 'Search emoji (try “cry”)' : 'Search the internet'}
              className="h-9 w-full rounded-lg border border-[#46527f] bg-[#0b0f1d] pl-8 pr-2 text-[13px] text-white outline-none placeholder:text-mute focus:border-lemon"
            />
          </div>
        </>
      )}

      <div className={p.kind === 'pause' ? '' : 'h-[200px]'}>
        {p.kind === 'chat' && <ChatTab {...p} />}
        {p.kind === 'fun' && p.funTab === 'emoji' && <EmojiGrid q={q} disabled={!p.connected} onPick={(e, label) => p.onReaction({ emoji: e, label })} />}
        {p.kind === 'fun' && p.funTab !== 'emoji' && <WebResults kind={p.funTab} q={q} hasKey={p.hasGiphyKey} disabled={!p.connected} onPick={(r) => p.onReaction({ gif: r.url, label: r.title })} />}
        {p.kind === 'sounds' && <SoundsTab {...p} />}
        {p.kind === 'pause' && <PartyTab {...p} />}
      </div>
      {!p.connected && <p className="text-center text-[12.5px] text-soft">Sending needs {p.peerName} to be connected.</p>}
      {p.kind === 'fun' && p.funTab !== 'emoji' && <div className="text-right text-[12px] text-mute">Powered by GIPHY</div>}
    </motion.div>
  );
}

/* ---------- Chat ---------- */

function ChatTab({ chat, connected, peerName, onChat }: ScreenProps) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.length]);
  const send = () => { if (text.trim() && onChat(text)) setText(''); };
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">
        {chat.length === 0 && <Empty text={`Say something to ${peerName}. It floats over the movie, then fades.`} icon={<MessageCircle size={20} className="text-sky" />} />}
        {chat.map((m) => (
          <div key={m.key} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[14px] leading-5 ${m.mine ? 'rounded-br-md bg-[#174a68]' : 'rounded-bl-md bg-[#222b4a]'} ${m.kind === 'sound' ? 'italic text-soft' : 'text-white'}`}>
              {m.kind === 'sound' ? <><b className="not-italic">{m.from}</b> {m.text}</> : <span className="break-words">{m.text}</span>}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          value={text} onChange={(e) => setText(e.target.value)} maxLength={200} disabled={!connected} autoFocus aria-label="Message"
          placeholder={connected ? `Message ${peerName}…` : 'Waiting for your friend…'}
          className="h-10 min-w-0 flex-1 rounded-lg border border-[#46527f] bg-[#0b0f1d] px-3 text-[13.5px] text-white outline-none placeholder:text-mute focus:border-lemon disabled:opacity-50"
        />
        <motion.button
          type="submit" disabled={!connected || !text.trim()} aria-label="Send message" onMouseDown={(e) => e.preventDefault()}
          whileHover={{ y: -1.5 }} whileTap={{ scale: 0.9 }} transition={SPRING}
          className="focus-candy flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gum text-grape-950 disabled:opacity-40"
        ><Send size={16} /></motion.button>
      </form>
    </div>
  );
}

/* ---------- Emoji + web stickers/GIFs ---------- */

function EmojiGrid({ q, disabled, onPick }: { q: string; disabled: boolean; onPick: (e: string, label: string) => void }) {
  const list = searchEmojis(q);
  if (!list.length) return <Empty text="No emoji match. Try a vibe: laugh, love, spicy…" />;
  return (
    <div className="grid h-full grid-cols-8 content-start gap-0.5 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">
      {list.map((x) => (
        <motion.button
          key={x.e} type="button" disabled={disabled} title={x.k.split(' ')[0]} aria-label={x.k.split(' ')[0]} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(x.e, x.k.split(' ')[0]!)}
          whileHover={{ scale: 1.3, rotate: -6 }} whileTap={{ scale: 0.8 }} transition={SPRING}
          className="focus-candy flex aspect-square items-center justify-center rounded-lg text-[19px] hover:bg-white/10 disabled:opacity-40"
        >{x.e}</motion.button>
      ))}
    </div>
  );
}

function WebResults({ kind, q, hasKey, disabled, onPick }: { kind: 'stickers' | 'gifs'; q: string; hasKey: boolean; disabled: boolean; onPick: (r: StickerResult) => void }) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; results: StickerResult[] }>({ loading: false, error: null, results: [] });
  useEffect(() => {
    if (!hasKey) { setState({ loading: false, error: 'Stickers & GIFs need a GIPHY key. See setup.md to turn them on.', results: [] }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(() => {
      void sendRuntime<StickerSearchResponse>({ type: 'SEARCH_STICKERS', query: q, kind }).then((res) => {
        if (!live) return;
        if (!res) setState({ loading: false, error: 'No answer from the extension. Try reloading the page.', results: [] });
        else if (!res.ok) setState({ loading: false, error: res.error, results: [] });
        else setState({ loading: false, error: null, results: res.results });
      });
    }, q ? 350 : 0); // debounce typing
    return () => { live = false; clearTimeout(t); };
  }, [kind, q, hasKey]);

  if (state.error) return <Empty text={state.error} />;
  if (state.loading && !state.results.length) return <Empty text="Fishing the internet…" pulse />;
  if (!state.results.length) return <Empty text="Nothing found. Try something sillier." />;
  return (
    <div className="h-full overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">
      <div className="columns-4 gap-1">
        {state.results.map((r) => (
          <motion.button
            key={r.id} type="button" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(r)} aria-label={r.title || 'Send this'}
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }} transition={SPRING}
            className="focus-candy mb-1.5 block w-full overflow-hidden rounded-lg bg-white/5 disabled:opacity-40"
          ><img src={r.preview} alt={r.title} loading="lazy" referrerPolicy="no-referrer" className="w-full" /></motion.button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Sounds ---------- */

function SoundsTab({ connected, muted, onMuted, onSound }: ScreenProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="grid flex-1 grid-cols-4 content-start gap-1.5">
        {SOUNDS.map((s) => (
          <motion.button
            key={s.id} type="button" disabled={!connected} onMouseDown={(e) => e.preventDefault()} onClick={() => onSound(s.id)} aria-label={`Play ${s.label}`}
            whileHover={{ y: -2, scale: 1.04 }} whileTap={{ scale: 0.88, rotate: -4 }} transition={SPRING}
            className="focus-candy surface-raised flex h-[62px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 disabled:opacity-40"
          >
            <span className="text-[20px] leading-none">{s.emoji}</span>
            <span className="text-[12px] font-bold leading-4 text-soft">{s.label}</span>
          </motion.button>
        ))}
      </div>
      <button
        type="button" role="switch" aria-checked={muted} onMouseDown={(e) => e.preventDefault()} onClick={() => onMuted(!muted)}
        className="focus-candy mt-2 flex items-center gap-2 self-start rounded-lg px-1.5 py-1 text-[12px] font-semibold text-soft hover:text-white"
      >{muted ? <VolumeX size={15} className="text-gum" /> : <Volume2 size={15} className="text-mint" />}{muted ? 'Sounds muted' : 'Sounds on'}</button>
    </div>
  );
}

/* ---------- Party tools ---------- */

function PartyTab({ connected, party, onReady, onBrb, onBack }: ScreenProps) {
  const busy = party.hold !== 'none' || party.countdownTo !== null;
  const row = (title: string, sub: string, icon: React.ReactNode, tone: string, action: () => void) => (
    <motion.button
      type="button" disabled={!connected || busy} onMouseDown={(e) => e.preventDefault()} onClick={() => { action(); onBack(); }}
      whileTap={{ scale: 0.98 }} transition={SPRING}
      className="focus-candy surface-raised flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[#2c3760] disabled:opacity-40"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${tone} text-grape-950`}>{icon}</span>
      <span className="min-w-0"><span className="block text-[13.5px] font-bold leading-4 text-white">{title}</span><span className="block text-[12px] leading-4 text-soft">{sub}</span></span>
    </motion.button>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {row('Ready check', 'Pause both, then 3-2-1', <SquareCheckBig size={16} />, 'bg-mint', onReady)}
      {row('Brb', 'Pause both until you’re back', <Coffee size={16} />, 'bg-tang', onBrb)}
      {busy && <p className="text-[12.5px] text-mute">Something is already holding the movie.</p>}
    </div>
  );
}

function Empty({ text, pulse, icon }: { text: string; pulse?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      {icon ?? <Sparkles size={20} className={`text-lemon ${pulse ? 'animate-pulse' : ''}`} />}
      <p className="text-[12px] leading-4 text-soft">{text}</p>
    </div>
  );
}

