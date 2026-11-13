import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Coffee, Film, MessageCircle, PartyPopper, Search, Send, Smile, Sparkles, SquareCheckBig, Sticker, Volume2, VolumeX, X } from 'lucide-react';
import type { SoundId } from '@/shared/protocol';
import { sendRuntime, type StickerResult, type StickerSearchResponse } from '@/shared/messaging';
import type { PartyState } from '@/shared/types';
import { SPRING } from '@/shared/ui/kit';
import { searchEmojis } from './emojis';
import type { ChatItem } from './hooks';
import { SOUNDS } from './sounds';

export type TrayTab = 'chat' | 'emoji' | 'stickers' | 'gifs' | 'sounds' | 'party';

const TABS: { id: TrayTab; label: string; icon: typeof Smile }[] = [
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'emoji', label: 'Emoji', icon: Smile },
  { id: 'stickers', label: 'Stickers', icon: Sticker },
  { id: 'gifs', label: 'GIFs', icon: Film },
  { id: 'sounds', label: 'Sounds', icon: Volume2 },
  { id: 'party', label: 'Party', icon: PartyPopper },
];

interface TrayProps {
  tab: TrayTab;
  onTab: (t: TrayTab) => void;
  onClose: () => void;
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

/** One home for everything you can throw at your friend: words, stickers, GIFs, sounds, and "let's pause". */
export function Tray(p: TrayProps) {
  const [q, setQ] = useState('');
  const searchable = p.tab === 'emoji' || p.tab === 'stickers' || p.tab === 'gifs';
  useEffect(() => setQ(''), [p.tab]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }} transition={SPRING}
      role="dialog" aria-label="Chat, stickers, sounds and party tools"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); } }}
      className="glass-deep w-[320px] rounded-3xl p-3"
    >
      <div className="mb-2 flex items-center gap-1">
        <div role="tablist" aria-label="Sections" className="flex min-w-0 flex-1 gap-0.5 rounded-2xl bg-black/25 p-1">
          {TABS.map((t) => {
            const active = p.tab === t.id;
            return (
              <motion.button
                key={t.id} layout role="tab" type="button" aria-selected={active} aria-label={t.label} title={t.label}
                onMouseDown={(e) => e.preventDefault()} onClick={() => p.onTab(t.id)} transition={SPRING}
                className={`focus-candy relative flex h-8 items-center justify-center gap-1 rounded-xl text-[11.5px] font-bold ${active ? 'flex-[2.3] text-grape-950' : 'flex-1 text-white/70 hover:text-white'}`}
              >
                {active && <motion.span layoutId="tray-tab" transition={SPRING} className="absolute inset-0 rounded-xl bg-lemon" />}
                <t.icon size={15} className="relative shrink-0" />
                {active && <span className="relative">{t.label}</span>}
              </motion.button>
            );
          })}
        </div>
        <button type="button" aria-label="Close" onMouseDown={(e) => e.preventDefault()} onClick={p.onClose} className="focus-candy flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white"><X size={16} /></button>
      </div>

      {searchable && (
        <div className="relative mb-2">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/60" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search"
            placeholder={p.tab === 'emoji' ? 'Search emoji… (try “cry”)' : p.tab === 'stickers' ? 'Search stickers on the internet…' : 'Search GIFs on the internet…'}
            className="h-9 w-full rounded-xl border border-white/15 bg-black/25 pl-8 pr-2 text-[12.5px] text-white outline-none placeholder:text-white/50 focus:border-lemon/70"
          />
        </div>
      )}

      <div className="h-[210px]">
        {p.tab === 'chat' && <ChatTab {...p} />}
        {p.tab === 'emoji' && <EmojiGrid q={q} disabled={!p.connected} onPick={(e, label) => p.onReaction({ emoji: e, label })} />}
        {(p.tab === 'stickers' || p.tab === 'gifs') && <WebResults kind={p.tab} q={q} hasKey={p.hasGiphyKey} disabled={!p.connected} onPick={(r) => p.onReaction({ gif: r.url, label: r.title })} />}
        {p.tab === 'sounds' && <SoundsTab {...p} />}
        {p.tab === 'party' && <PartyTab {...p} />}
      </div>
      {!p.connected && <p className="mt-1.5 text-center text-[11px] text-white/60">Connect with {p.peerName} to send things.</p>}
      {(p.tab === 'stickers' || p.tab === 'gifs') && <div className="mt-1 text-right text-[10px] text-white/50">Powered by GIPHY</div>}
    </motion.div>
  );
}

/* ---------- Chat ---------- */

function ChatTab({ chat, connected, peerName, onChat }: TrayProps) {
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
            <div className={`max-w-[85%] rounded-2xl px-2.5 py-1.5 text-[12.5px] leading-[17px] ${m.mine ? 'rounded-br-md bg-sky/30' : 'rounded-bl-md bg-white/10'} ${m.kind === 'sound' ? 'italic text-white/75' : 'text-white'}`}>
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
          className="h-10 min-w-0 flex-1 rounded-xl border border-white/15 bg-black/25 px-3 text-[13px] text-white outline-none placeholder:text-white/50 focus:border-lemon/70 disabled:opacity-50"
        />
        <motion.button
          type="submit" disabled={!connected || !text.trim()} aria-label="Send message" onMouseDown={(e) => e.preventDefault()}
          whileHover={{ y: -1.5 }} whileTap={{ scale: 0.9 }} transition={SPRING}
          className="focus-candy flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gum to-gum-deep text-white shadow-candy disabled:opacity-40"
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
    <div className="grid h-full grid-cols-6 content-start gap-1 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">
      {list.map((x) => (
        <motion.button
          key={x.e} type="button" disabled={disabled} title={x.k.split(' ')[0]} aria-label={x.k.split(' ')[0]} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(x.e, x.k.split(' ')[0]!)}
          whileHover={{ scale: 1.3, rotate: -6 }} whileTap={{ scale: 0.8 }} transition={SPRING}
          className="focus-candy flex aspect-square items-center justify-center rounded-lg text-[24px] hover:bg-white/10 disabled:opacity-40"
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
      <div className="columns-3 gap-1.5">
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

function SoundsTab({ connected, muted, onMuted, onSound }: TrayProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="grid flex-1 grid-cols-4 content-start gap-1.5">
        {SOUNDS.map((s) => (
          <motion.button
            key={s.id} type="button" disabled={!connected} onMouseDown={(e) => e.preventDefault()} onClick={() => onSound(s.id)} aria-label={`Play ${s.label}`}
            whileHover={{ y: -2, scale: 1.04 }} whileTap={{ scale: 0.88, rotate: -4 }} transition={SPRING}
            className="focus-candy glass-chip flex h-[84px] flex-col items-center justify-center gap-1 rounded-2xl px-1 disabled:opacity-40"
          >
            <span className="text-[26px] leading-none">{s.emoji}</span>
            <span className="text-[10.5px] font-bold leading-3 text-white/85">{s.label}</span>
          </motion.button>
        ))}
      </div>
      <button
        type="button" role="switch" aria-checked={muted} onMouseDown={(e) => e.preventDefault()} onClick={() => onMuted(!muted)}
        className="focus-candy mt-2 flex items-center gap-2 self-start rounded-lg px-1.5 py-1 text-[12px] font-semibold text-white/80 hover:text-white"
      >{muted ? <VolumeX size={15} className="text-gum" /> : <Volume2 size={15} className="text-mint" />}{muted ? 'Sounds muted' : 'Sounds on'}</button>
    </div>
  );
}

/* ---------- Party tools ---------- */

function PartyTab({ connected, party, onReady, onBrb, onClose, peerName }: TrayProps) {
  const busy = party.hold !== 'none' || party.countdownTo !== null;
  const card = (title: string, text: string, icon: React.ReactNode, tone: string, action: () => void) => (
    <motion.button
      type="button" disabled={!connected || busy} onMouseDown={(e) => e.preventDefault()} onClick={() => { action(); onClose(); }}
      whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={SPRING}
      className="focus-candy glass-chip flex w-full items-center gap-3 rounded-2xl p-3 text-left disabled:opacity-40"
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${tone} text-grape-950`}>{icon}</span>
      <span className="min-w-0"><span className="block font-display text-[14px] font-bold text-white">{title}</span><span className="block text-[11.5px] leading-4 text-white/70">{text}</span></span>
    </motion.button>
  );
  return (
    <div className="flex h-full flex-col gap-2">
      {card('Ready check', `Pauses both. When ${peerName} says ready, a 3-2-1 starts the movie.`, <SquareCheckBig size={20} />, 'from-mint to-sky', onReady)}
      {card('Brb', 'Pauses both while you grab snacks. Tap “I’m back” for a 3-2-1.', <Coffee size={20} />, 'from-tang to-gum', onBrb)}
      <p className="mt-auto text-[11px] leading-4 text-white/60">{busy ? 'Something is already holding the movie. Finish that first.' : 'Videos that buffer pause for both of you automatically.'}</p>
    </div>
  );
}

function Empty({ text, pulse, icon }: { text: string; pulse?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      {icon ?? <Sparkles size={20} className={`text-lemon ${pulse ? 'animate-pulse' : ''}`} />}
      <p className="text-[12px] leading-4 text-white/70">{text}</p>
    </div>
  );
}

