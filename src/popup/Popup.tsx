import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, LogOut, Plus, Settings as Cog, Sparkles } from 'lucide-react';
import { buildInviteLink, parseInvite } from '@/shared/invite';
import { sendRuntime } from '@/shared/messaging';
import { callLabel, connectionLabel, playerLabel, syncLabel } from '@/shared/statusText';
import { StatusDot } from '@/shared/ui/StatusDot';
import { SPRING } from '@/shared/ui/kit';
import { createRoom, joinRoom, leaveRoom } from '@/rooms/roomApi';
import { errorMessage } from '@/shared/util';
import type { RoomSession, RoomStatus } from '@/shared/types';
import { Blobs, Button, Field, Input, Logo } from './components';
import { SettingsView } from './SettingsView';
import { useRoomStatus, useSession, useSettings } from './hooks';

const TAGLINES = [
  'Watch together. Judge the plot separately.',
  'Two humans, one questionable movie night.',
  'Snacks not included. Opinions are.',
  'Sync’d playback, unsync’d snack habits.',
  'Pause for bathroom breaks. Together.',
];

const fade = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -10 }, transition: SPRING };

export function Popup() {
  const { session, loaded } = useSession();
  const { settings, loaded: settingsLoaded, save } = useSettings();
  const status = useRoomStatus();
  const [view, setView] = useState<'main' | 'settings'>('main');
  const tagline = useMemo(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)], []);

  if (!loaded || !settingsLoaded) return <div className="aurora h-40" />;
  const configured = /^https?:\/\//.test(settings.supabaseUrl) && !!settings.supabaseAnonKey;

  return (
    <div className="aurora relative min-h-[260px] overflow-hidden">
      <Blobs />
      <AnimatePresence mode="wait" initial={false}>
        {view === 'settings' ? (
          <motion.div key="s" {...fade} className="relative"><SettingsView settings={settings} onSave={save} onBack={() => setView('main')} /></motion.div>
        ) : (
          <motion.div key="m" {...fade} className="relative space-y-4 p-4">
            <header className="flex items-start justify-between">
              <div>
                <Logo />
                <p className="mt-1 text-[11.5px] font-semibold text-white/70">{tagline}</p>
              </div>
              <Button variant="ghost" className="!h-9 !w-9 !rounded-full !px-0" aria-label="Settings" onClick={() => setView('settings')}><Cog size={17} /></Button>
            </header>
            {!configured ? (
              <div className="glass space-y-3 rounded-2xl p-4">
                <div className="flex items-center gap-2 font-display text-[13px] font-extrabold text-lemon"><Sparkles size={15} /> One-time setup</div>
                <p className="text-[12.5px] leading-5 text-white/75">This build has no Supabase project connected. Follow <b className="text-white">setup.md</b>: add your keys to <code className="rounded bg-black/30 px-1">.env</code>, run <code className="rounded bg-black/30 px-1">npm run build</code>, then reload the extension.</p>
              </div>
            ) : session ? (
              <RoomView session={session} status={status} />
            ) : (
              <Home displayName={settings.displayName} saveName={(n) => save({ displayName: n })} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Home({ displayName, saveName }: { displayName: string; saveName: (n: string) => Promise<void> }) {
  const [name, setName] = useState(displayName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveName = (fallback: string) => name.trim().slice(0, 40) || fallback;

  const create = async () => {
    setBusy('create'); setError(null);
    try {
      const n = effectiveName('Host');
      await saveName(n);
      await createRoom(n);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };

  const join = async () => {
    const token = parseInvite(code);
    if (!token) return setError('That doesn’t look like a valid invite link or code.');
    setBusy('join'); setError(null);
    try {
      const n = effectiveName('Guest');
      await saveName(n);
      await joinRoom(token, n);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };

  return (
    <div className="glass space-y-4 rounded-3xl p-4">
      <Field label="Your party name"><Input value={name} maxLength={40} placeholder="e.g. Captain Popcorn" onChange={(e) => setName(e.target.value)} /></Field>
      <Button variant="primary" className="h-11 w-full text-[14px]" busy={busy === 'create'} disabled={busy !== null} onClick={() => void create()}>
        <Plus size={16} strokeWidth={3} /> Start a party
      </Button>
      <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-widest text-white/55"><div className="h-px flex-1 bg-white/15" />or crash one<div className="h-px flex-1 bg-white/15" /></div>
      <div className="flex gap-2">
        <Input value={code} placeholder="Paste invite link or code" onChange={(e) => { setCode(e.target.value); setError(null); }} onKeyDown={(e) => e.key === 'Enter' && void join()} />
        <Button variant="mint" busy={busy === 'join'} disabled={busy !== null || !code.trim()} onClick={() => void join()}>Join</Button>
      </div>
      <AnimatePresence>
        {error && <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden rounded-xl border border-gum/30 bg-gum/10 px-3 py-2 text-[12px] leading-4 text-[#ff9ccf]">{error}</motion.p>}
      </AnimatePresence>
    </div>
  );
}

function RoomView({ session, status }: { session: RoomSession; status: RoomStatus | null }) {
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const link = buildInviteLink({ roomId: session.roomId, secret: session.secret });
  const live = status && status.roomId === session.roomId ? status : null;

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };
  const leave = async () => { setLeaving(true); await leaveRoom(session.roomId); };

  const conn = live ? connectionLabel(live) : { text: 'Open Netflix or YouTube to connect', tone: 'idle' as const };

  return (
    <div className="space-y-3">
      <div className="glass rounded-3xl p-4">
        <div className="flex items-center gap-2">
          <StatusDot tone={conn.tone} />
          <span className="font-display text-[13px] font-extrabold">{conn.text}</span>
        </div>
        <div className="mt-3 space-y-2.5">
          <Participant name={`${session.displayName} (you)`} tone={live ? 'ok' : 'idle'} sub={live ? playerLabel(live).text : 'No video tab connected'} hue="from-gum to-coral" />
          <Participant
            name={live?.peer?.name ?? 'Your person'}
            tone={live?.peer ? 'ok' : 'idle'}
            sub={live?.peer ? (live.peer.playerStatus === 'ready' ? 'Video player ready' : 'In the room') : 'Not here yet… 🦗'}
            hue="from-sky to-mint"
          />
        </div>
        {live && live.phase === 'connected' && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-[11.5px] text-white/65">
            <span className="flex items-center gap-1.5"><StatusDot tone={syncLabel(live).tone} className="!h-1.5 !w-1.5" />{syncLabel(live).text}</span>
            <span className="flex items-center gap-1.5"><StatusDot tone={callLabel(live).tone} className="!h-1.5 !w-1.5" />{callLabel(live).text}</span>
          </div>
        )}
      </div>

      <div className="glass rounded-3xl p-4">
        <Field label="Invite link" hint="Anyone with this link can join (max 2 people). It stops working when you leave.">
          <div className="flex gap-2">
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono !text-[11px]" />
            <Button onClick={() => void copy()} aria-label="Copy invite link" className="!w-10 !px-0">{copied ? <Check size={16} className="text-mint" /> : <Copy size={16} />}</Button>
          </div>
        </Field>
      </div>

      <div className="flex gap-2">
        <Button variant="primary" className="h-10 flex-1" onClick={() => void sendRuntime({ type: 'OPEN_SITE', site: 'netflix' })}><ExternalLink size={14} /> Netflix</Button>
        <Button variant="mint" className="h-10 flex-1" onClick={() => void sendRuntime({ type: 'OPEN_SITE', site: 'youtube' })}><ExternalLink size={14} /> YouTube</Button>
        <Button variant="danger" className="h-10" busy={leaving} onClick={() => void leave()}><LogOut size={14} /> Leave</Button>
      </div>
      {live?.error && <p className="rounded-xl border border-gum/30 bg-gum/10 px-3 py-2 text-[12px] leading-4 text-[#ff9ccf]">{live.error}</p>}
      {!live && <p className="px-1 text-[11.5px] leading-4 text-white/65">The party connects from your video tab. Open Netflix or YouTube and the PariParty panel pops up. 🎈</p>}
    </div>
  );
}

function Participant({ name, tone, sub, hue }: { name: string; tone: 'ok' | 'idle'; sub: string; hue: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br ${hue} font-display text-[14px] font-black text-grape-950`}>{name.slice(0, 1).toUpperCase()}</div>
      <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-bold">{name}</div><div className="truncate text-[11px] text-white/65">{sub}</div></div>
      <StatusDot tone={tone} />
    </div>
  );
}
