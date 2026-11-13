import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { Search, Sparkles, X } from 'lucide-react';
import { useEffect } from 'react';
import { sendRuntime, type StickerResult, type StickerSearchResponse } from '@/shared/messaging';
import { SPRING } from '@/shared/ui/kit';
import { searchEmojis } from './emojis';
import type { FloatingReaction } from './hooks';

/** Stickers drifting up the screen. Pure decoration, never intercepts clicks. */
export function ReactionLayer({ items }: { items: FloatingReaction[] }) {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 2147483001 }} aria-hidden>
      <AnimatePresence>
        {items.map((r, i) => (
          <motion.div
            key={r.id}
            className="absolute bottom-0 flex flex-col items-center"
            style={{ left: `${r.x}%` }}
            initial={{ y: 40, opacity: 0, scale: 0.3, rotate: -20 }}
            animate={{ y: -(window.innerHeight * 0.62), opacity: [0, 1, 1, 0], scale: [0.3, 1.25, 1, 1], rotate: [-20, 12, -8, 6] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 4, ease: 'easeOut', times: [0, 0.12, 0.75, 1], delay: (i % 3) * 0.04 }}
          >
            {r.emoji
              ? <span className="text-[64px] leading-none drop-shadow-[0_6px_12px_rgba(0,0,0,.45)]">{r.emoji}</span>
              : <img src={r.gif} alt="" referrerPolicy="no-referrer" className="h-28 max-w-[180px] rounded-2xl object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,.5)]" />}
            {!r.mine && <span className="glass-chip mt-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-white">{r.from}</span>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

type Tab = 'emoji' | 'stickers' | 'gifs';
const TABS: { id: Tab; label: string }[] = [{ id: 'emoji', label: '😜 Emoji' }, { id: 'stickers', label: '🧃 Stickers' }, { id: 'gifs', label: '🎞️ GIFs' }];

interface TrayProps {
  onSend: (r: { emoji?: string; gif?: string; label?: string }) => void;
  onClose: () => void;
  hasKey: boolean;
}

/** Search-and-send tray. Emoji are local; stickers/GIFs are fetched live from GIPHY via the background worker. */
export function StickerTray({ onSend, onClose, hasKey }: TrayProps) {
  const [tab, setTab] = useState<Tab>('emoji');
  const [q, setQ] = useState('');
  const [state, setState] = useState<{ loading: boolean; error: string | null; results: StickerResult[] }>({ loading: false, error: null, results: [] });

  useEffect(() => {
    if (tab === 'emoji') return;
    if (!hasKey) { setState({ loading: false, error: 'Stickers & GIFs need a GIPHY key. See setup.md to turn them on.', results: [] }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(() => {
      void sendRuntime<StickerSearchResponse>({ type: 'SEARCH_STICKERS', query: q, kind: tab }).then((res) => {
        if (!live) return;
        if (!res) setState({ loading: false, error: 'No answer from the extension. Try reloading the page.', results: [] });
        else if (!res.ok) setState({ loading: false, error: res.error, results: [] });
        else setState({ loading: false, error: null, results: res.results });
      });
    }, q ? 350 : 0); // debounce typing
    return () => { live = false; clearTimeout(t); };
  }, [tab, q, hasKey]);

  const emojis = searchEmojis(q);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }} transition={SPRING}
      role="dialog" aria-label="Stickers and GIFs"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      className="glass-deep w-[300px] rounded-3xl p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/60" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'emoji' ? 'Search emoji… (try “cry”)' : 'Search the internet…'} autoFocus
            className="h-9 w-full rounded-xl border border-white/15 bg-black/25 pl-8 pr-2 text-[12.5px] text-white outline-none placeholder:text-white/55 focus:border-lemon/70"
          />
        </div>
        <button type="button" aria-label="Close" onMouseDown={(e) => e.preventDefault()} onClick={onClose} className="focus-candy flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"><X size={15} /></button>
      </div>
      <div role="tablist" className="mb-2 flex gap-1 rounded-xl bg-black/20 p-1">
        {TABS.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={tab === t.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setTab(t.id)}
            className={`focus-candy relative flex-1 rounded-lg py-1.5 text-[11.5px] font-bold transition-colors ${tab === t.id ? 'text-grape-950' : 'text-white/65 hover:text-white'}`}
          >
            {tab === t.id && <motion.span layoutId="tray-tab" transition={SPRING} className="absolute inset-0 rounded-lg bg-lemon" />}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="h-[196px] overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">
        {tab === 'emoji' ? (
          emojis.length ? (
            <div className="grid grid-cols-6 gap-1">
              {emojis.map((x) => (
                <motion.button
                  key={x.e} type="button" title={x.k.split(' ')[0]} onMouseDown={(e) => e.preventDefault()} onClick={() => onSend({ emoji: x.e, label: x.k.split(' ')[0] })}
                  whileHover={{ scale: 1.3, rotate: -6 }} whileTap={{ scale: 0.8 }} transition={SPRING}
                  className="focus-candy flex aspect-square items-center justify-center rounded-lg text-[24px] hover:bg-white/10"
                >{x.e}</motion.button>
              ))}
            </div>
          ) : <Empty text="No emoji match. Try a vibe: laugh, love, spicy…" />
        ) : state.error ? <Empty text={state.error} />
        : state.loading && !state.results.length ? <Empty text="Fishing the internet…" pulse />
        : state.results.length === 0 ? <Empty text="Nothing found. Try something sillier." />
        : (
          <div className="columns-3 gap-1.5">
            {state.results.map((r) => (
              <motion.button
                key={r.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onSend({ gif: r.url, label: r.title })}
                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }} transition={SPRING}
                className="focus-candy mb-1.5 block w-full overflow-hidden rounded-lg bg-white/5"
              >
                <img src={r.preview} alt={r.title} loading="lazy" referrerPolicy="no-referrer" className="w-full" />
              </motion.button>
            ))}
          </div>
        )}
      </div>
      {tab !== 'emoji' && <div className="mt-1.5 text-right text-[10px] text-white/55">Powered by GIPHY</div>}
    </motion.div>
  );
}

function Empty({ text, pulse }: { text: string; pulse?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <Sparkles size={20} className={`text-lemon ${pulse ? 'animate-pulse' : ''}`} />
      <p className="text-[12px] leading-4 text-white/60">{text}</p>
    </div>
  );
}
