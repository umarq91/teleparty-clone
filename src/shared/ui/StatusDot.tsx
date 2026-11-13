import type { Tone } from '../statusText';

// Flat, solid dots: colour is never the only signal (the text next to a dot always says the state).
const colors: Record<Tone, string> = {
  ok: 'bg-mint',
  warn: 'bg-lemon animate-pulse',
  bad: 'bg-gum',
  idle: 'bg-[#6b769c]',
};

export function StatusDot({ tone, className = '' }: { tone: Tone; className?: string }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${colors[tone]} ${className}`} aria-hidden />;
}
