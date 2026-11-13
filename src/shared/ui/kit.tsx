import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

export const SPRING = { type: 'spring', stiffness: 420, damping: 30, mass: 0.7 } as const;
export const SOFT = { type: 'spring', stiffness: 260, damping: 26 } as const;

/* ---------- Brand ---------- */

const LETTERS: [string, string][] = [
  ['P', 'text-gum'], ['a', 'text-lemon'], ['r', 'text-mint'], ['i', 'text-sky'],
  ['P', 'text-tang'], ['a', 'text-coral'], ['r', 'text-gum'], ['t', 'text-lemon'], ['y', 'text-mint'],
];

/** Wordmark: every letter bounces on hover, because why not. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <div className="flex items-center gap-2">
      <motion.span
        aria-hidden
        className={`${size === 'sm' ? 'text-[18px]' : 'text-[24px]'} inline-block leading-none`}
        whileHover={{ rotate: [0, -18, 14, -8, 0], scale: 1.15 }}
        transition={{ duration: 0.55 }}
      >🎉</motion.span>
      <span aria-label="PariParty" className={`font-display font-black tracking-tight ${size === 'sm' ? 'text-[15px]' : 'text-[21px]'}`}>
        {LETTERS.map(([ch, c], i) => (
          <motion.span
            key={i} aria-hidden className={`inline-block ${c}`}
            whileHover={{ y: -4, rotate: i % 2 ? 8 : -8, scale: 1.18 }}
            transition={SPRING}
          >{ch}</motion.span>
        ))}
      </span>
    </div>
  );
}

/* ---------- Buttons ---------- */

interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'mint';
  busy?: boolean;
}

const BTN: Record<NonNullable<BtnProps['variant']>, string> = {
  primary: 'bg-gradient-to-b from-gum to-gum-deep text-white font-bold shadow-candy hover:brightness-110',
  mint: 'bg-gradient-to-b from-mint to-[#2fcf9f] text-grape-950 font-bold shadow-[0_6px_18px_-4px_rgb(77_240_192/.5),inset_0_1px_0_rgb(255_255_255/.5)] hover:brightness-105',
  secondary: 'glass-chip text-white/90 hover:bg-white/[0.16]',
  ghost: 'text-white/70 hover:bg-white/10 hover:text-white',
  danger: 'bg-gum/15 text-[#ff9ccf] border border-gum/30 hover:bg-gum/25',
};

export function Button({ variant = 'secondary', busy, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <motion.button
      {...(rest as object)}
      disabled={disabled || busy}
      whileHover={disabled || busy ? undefined : { y: -1.5, scale: 1.02 }}
      whileTap={disabled || busy ? undefined : { scale: 0.95, y: 1 }}
      transition={SPRING}
      className={`focus-candy inline-flex h-9 select-none items-center justify-center gap-2 rounded-xl px-3.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-45 ${BTN[variant]} ${className}`}
    >
      {busy && <Loader2 size={14} className="animate-spin" />}
      {children}
    </motion.button>
  );
}

/* ---------- Form controls ---------- */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-bold uppercase tracking-wider text-white/70">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-4 text-white/65">{hint}</span>}
    </label>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-10 w-full rounded-xl border border-white/15 bg-black/20 px-3 text-[13px] text-white outline-none transition placeholder:text-white/50 hover:border-white/25 focus:border-lemon/70 focus:bg-black/30 focus:shadow-[0_0_0_3px_rgb(255_228_94/.15)] ${className}`}
    />
  );
}

/** Chunky pill switch with a springy knob. */
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <div className="text-[12.5px] font-semibold text-white/90">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-4 text-white/65">{hint}</div>}
      </label>
      <button
        id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`focus-candy relative mt-0.5 h-[26px] w-[46px] shrink-0 rounded-full border transition-colors duration-200 ${checked ? 'border-mint/60 bg-mint/80' : 'border-white/15 bg-white/10'}`}
      >
        <motion.span
          className="absolute top-[2px] flex h-[20px] w-[20px] items-center justify-center rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/.35)]"
          animate={{ x: checked ? 22 : 2 }} transition={SPRING}
        >
          <AnimatePresence initial={false}>
            {checked && <motion.span key="c" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check size={12} strokeWidth={4} className="text-mint" /></motion.span>}
          </AnimatePresence>
        </motion.span>
      </button>
    </div>
  );
}

/** Squishy checkbox. */
export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className="focus-candy group flex items-center gap-2.5 rounded-lg text-left">
      <motion.span
        animate={{ scale: checked ? [1, 1.25, 1] : 1, rotate: checked ? [0, -8, 0] : 0 }} transition={{ duration: 0.32 }}
        className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-md border transition-colors ${checked ? 'border-lemon bg-lemon' : 'border-white/25 bg-white/5 group-hover:border-white/45'}`}
      >
        <motion.span initial={false} animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={SPRING}><Check size={13} strokeWidth={4} className="text-grape-950" /></motion.span>
      </motion.span>
      <span className="text-[12.5px] text-white/85">{label}</span>
    </button>
  );
}

/* ---------- Collapsing ---------- */

/** Height-animating collapse. Content stays mounted only while open. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="c" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={{ height: SOFT, opacity: { duration: 0.18 } }} style={{ overflow: 'hidden' }}
        >{children}</motion.div>
      )}
    </AnimatePresence>
  );
}

/** Titled, collapsible glass section. */
export function Section({ title, icon, defaultOpen = true, badge, children }: { title: string; icon?: ReactNode; defaultOpen?: boolean; badge?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="glass rounded-2xl">
      <button
        type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} onMouseDown={(e) => e.preventDefault()}
        className="focus-candy flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left"
      >
        {icon && <span className="text-[15px] leading-none">{icon}</span>}
        <span className="flex-1 font-display text-[12.5px] font-extrabold tracking-wide text-white/90">{title}</span>
        {badge}
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="text-white/65"><ChevronDown size={15} /></motion.span>
      </button>
      <Collapse open={open}><div className="space-y-3 px-3 pb-3">{children}</div></Collapse>
    </section>
  );
}

/* ---------- Ambient decoration ---------- */

/** Slow-drifting colour blobs behind glass. Purely decorative. */
export function Blobs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-10 -top-10 h-40 w-40 animate-drift rounded-full bg-gum/40 blur-3xl" />
      <div className="absolute -right-12 top-24 h-44 w-44 animate-drift rounded-full bg-sky/30 blur-3xl [animation-delay:-3s]" />
      <div className="absolute bottom-0 left-1/3 h-40 w-40 animate-drift rounded-full bg-coral/35 blur-3xl [animation-delay:-6s]" />
    </div>
  );
}
