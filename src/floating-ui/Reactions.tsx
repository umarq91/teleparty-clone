import { AnimatePresence, motion } from 'framer-motion';
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
