import type { Tone } from '../statusText';

const colors: Record<Tone, string> = {
  ok: 'bg-mint shadow-[0_0_10px_2px_rgba(77,240,192,.65)]',
  warn: 'bg-lemon animate-pulse shadow-[0_0_8px_1px_rgba(255,228,94,.55)]',
  bad: 'bg-gum shadow-[0_0_8px_1px_rgba(255,95,183,.6)]',
  idle: 'bg-white/30',
};

export function StatusDot({ tone, className = '' }: { tone: Tone; className?: string }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${colors[tone]} ${className}`} aria-hidden />;
}
