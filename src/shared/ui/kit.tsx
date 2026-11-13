import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

export const SPRING = { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 } as const;
export const SOFT = { type: 'spring', stiffness: 300, damping: 30 } as const;

/* ---------- Brand ---------- */

const LETTERS: [string, string][] = [
  ['P', 'text-gum'], ['a', 'text-lemon'], ['r', 'text-mint'], ['i', 'text-sky'],
  ['P', 'text-gum'], ['a', 'text-lemon'], ['r', 'text-mint'], ['t', 'text-sky'], ['y', 'text-gum'],
];

/** Wordmark in four flat colours. Static: it must never compete with the movie. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className={`${size === 'sm' ? 'text-[18px]' : 'text-[22px]'} leading-none`}>🎉</span>
      <span aria-label="PariParty" className={`font-display font-bold tracking-tight ${size === 'sm' ? 'text-[16px]' : 'text-[22px]'}`}>
        {LETTERS.map(([ch, c], i) => <span key={i} aria-hidden className={c}>{ch}</span>)}
      </span>
    </div>
  );
}

/* ---------- Buttons ---------- */

interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'mint';
  busy?: boolean;
}

// One button shape (12px radius, 40px tall); colour alone says what it is. Text on bright fills is dark (>= 8:1).
const BTN: Record<NonNullable<BtnProps['variant']>, string> = {
  primary: 'bg-gum text-grape-950 font-bold hover:bg-[#ff7cc6]',
  mint: 'bg-mint text-grape-950 font-bold hover:bg-[#7bf5d2]',
  secondary: 'surface-raised text-white font-semibold hover:bg-[#2c3760]',
  ghost: 'text-soft font-semibold hover:bg-white/10 hover:text-white',
  danger: 'border border-[#8a2f63] bg-[#3a1730] text-[#ffc2e2] font-semibold hover:bg-[#4a1c3d]',
};

export function Button({ variant = 'secondary', busy, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <motion.button
      {...(rest as object)}
      disabled={disabled || busy}
      whileHover={disabled || busy ? undefined : { y: -1 }}
      whileTap={disabled || busy ? undefined : { scale: 0.97 }}
      transition={SPRING}
      className={`focus-candy inline-flex h-10 select-none items-center justify-center gap-2 rounded-xl px-4 text-[14px] disabled:cursor-not-allowed disabled:opacity-45 ${BTN[variant]} ${className}`}
    >
      {busy && <Loader2 size={15} className="animate-spin" />}
      {children}
    </motion.button>
  );
}

/* ---------- Form controls ---------- */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[13px] font-semibold text-white">{label}</span>
      {children}
      {hint && <span className="block text-[12.5px] leading-[18px] text-mute">{hint}</span>}
    </label>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-11 w-full rounded-xl border border-[#46527f] bg-[#0b0f1d] px-3 text-[14px] text-white outline-none transition placeholder:text-mute hover:border-[#5b69a0] focus:border-lemon focus:shadow-[0_0_0_3px_rgb(255_228_94/.25)] ${className}`}
    />
  );
}

/** On/off switch. State is shown by position, colour AND a check mark. */
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <div className="text-[14px] font-semibold text-white">{label}</div>
        {hint && <div className="mt-0.5 text-[12.5px] leading-[18px] text-mute">{hint}</div>}
      </label>
      <button
        id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`focus-candy relative mt-0.5 h-[28px] w-[50px] shrink-0 rounded-full border-2 transition-colors duration-150 ${checked ? 'border-mint bg-mint' : 'border-[#5b69a0] bg-[#0b0f1d]'}`}
      >
        <motion.span
          className={`absolute top-[2px] flex h-[20px] w-[20px] items-center justify-center rounded-full ${checked ? 'bg-grape-950' : 'bg-white'}`}
          animate={{ x: checked ? 22 : 2 }} transition={SPRING}
        >{checked && <Check size={12} strokeWidth={4} className="text-mint" />}</motion.span>
      </button>
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className="focus-candy group flex w-full items-start gap-3 rounded-lg text-left">
      <span className={`mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-2 transition-colors ${checked ? 'border-lemon bg-lemon' : 'border-[#5b69a0] bg-[#0b0f1d] group-hover:border-white'}`}>
        {checked && <Check size={15} strokeWidth={4} className="text-grape-950" />}
      </span>
      <span className="text-[14px] leading-[22px] text-white">{label}</span>
    </button>
  );
}

/* ---------- Collapsing ---------- */

export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="c" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={{ height: SOFT, opacity: { duration: 0.15 } }} style={{ overflow: 'hidden' }}
        >{children}</motion.div>
      )}
    </AnimatePresence>
  );
}

/** Titled, collapsible section. */
export function Section({ title, icon, defaultOpen = true, badge, compact, children }: { title: string; icon?: ReactNode; defaultOpen?: boolean; badge?: ReactNode; compact?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`surface ${compact ? 'rounded-xl' : 'rounded-2xl'}`}>
      <button
        type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} onMouseDown={(e) => e.preventDefault()}
        className={`focus-candy flex w-full items-center gap-2 text-left ${compact ? 'min-h-[40px] rounded-xl px-3 py-1' : 'min-h-[48px] rounded-2xl px-3.5 py-2'}`}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className={`flex-1 font-bold text-white ${compact ? 'text-[13px]' : 'text-[14px]'}`}>{title}</span>
        {badge}
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="text-soft"><ChevronDown size={18} /></motion.span>
      </button>
      <Collapse open={open}><div className={compact ? 'space-y-2 px-3 pb-3' : 'space-y-3.5 px-3.5 pb-3.5'}>{children}</div></Collapse>
    </section>
  );
}
