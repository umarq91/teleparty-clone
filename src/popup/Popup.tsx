import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { Check, Copy, ExternalLink, LogOut, Plus, Settings as Cog } from 'lucide-react';
import { buildInviteLink, parseInvite } from '@/shared/invite';
import { sendRuntime } from '@/shared/messaging';
import { NETFLIX_ORIGIN, YOUTUBE_ORIGIN } from '@/shared/constants';
import { callLabel, connectionLabel, playerLabel, syncLabel, watchInvite } from '@/shared/statusText';
import { StatusDot } from '@/shared/ui/StatusDot';
import { createRoom, joinRoom, leaveRoom } from '@/rooms/roomApi';
import { errorMessage } from '@/shared/util';
import type { RoomSession, RoomStatus } from '@/shared/types';
import { Button, Field, Input, Logo } from './components';
import { SettingsView } from './SettingsView';
import { useRoomStatus, useSession, useSettings } from './hooks';

type Site = 'netflix' | 'youtube';
const ORIGIN: Record<Site, string> = { netflix: NETFLIX_ORIGIN, youtube: YOUTUBE_ORIGIN };
const SITE_KEY = 'pp-invite-site';
const loadSite = (): Site => { try { return localStorage.getItem(SITE_KEY) === 'youtube' ? 'youtube' : 'netflix'; } catch { return 'netflix'; } };

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } };

export function Popup() {
  const { session, loaded } = useSession();
  const { settings, loaded: settingsLoaded, save } = useSettings();
  const status = useRoomStatus();
  const [view, setView] = useState<'main' | 'settings'>('main');

  if (!loaded || !settingsLoaded) return <div className="page h-40" />;
  const configured = /^https?:\/\//.test(settings.supabaseUrl) && !!settings.supabaseAnonKey;

  return (
    <div className="page min-h-[260px]">
      <AnimatePresence mode="wait" initial={false}>
        {view === 'settings' ? (
          <motion.div key="s" {...fade}><SettingsView settings={settings} onSave={save} onBack={() => setView('main')} /></motion.div>
        ) : (
          <motion.div key="m" {...fade} className="space-y-3 p-4">
            <header className="flex items-center justify-between">
              <Logo />
              <Button variant="ghost" className="!h-10 !px-3" onClick={() => setView('settings')}><Cog size={17} /> Settings</Button>
            </header>
            {!configured ? (
              <div className="surface space-y-2.5 rounded-2xl p-4">
                <div className="text-[15px] font-bold text-lemon">Setup needed</div>
                <p className="text-[14px] leading-[22px] text-soft">This build isn’t connected to a Supabase project. Follow <b className="text-white">setup.md</b>: add your keys to <code className="rounded bg-black/40 px-1.5 py-0.5">.env</code>, run <code className="rounded bg-black/40 px-1.5 py-0.5">npm run build</code>, then reload the extension.</p>
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
    <div className="space-y-3">
      <div className="surface space-y-3 rounded-2xl p-4">
        <Field label="Your name"><Input value={name} maxLength={40} placeholder="e.g. Sam" onChange={(e) => setName(e.target.value)} /></Field>
        <Button variant="primary" className="h-12 w-full text-[15px]" busy={busy === 'create'} disabled={busy !== null} onClick={() => void create()}>
          <Plus size={18} strokeWidth={3} /> Start a new party
        </Button>
      </div>
      <div className="surface space-y-3 rounded-2xl p-4">
        <Field label="Or join your friend’s party" hint="Paste the invite link they sent you.">
          <div className="flex gap-2">
            <Input value={code} placeholder="Invite link or code" onChange={(e) => { setCode(e.target.value); setError(null); }} onKeyDown={(e) => e.key === 'Enter' && void join()} />
            <Button variant="mint" className="!h-11" busy={busy === 'join'} disabled={busy !== null || !code.trim()} onClick={() => void join()}>Join</Button>
          </div>
        </Field>
      </div>
      {error && <p role="alert" className="rounded-xl border border-[#8a2f63] bg-[#3a1730] px-3.5 py-2.5 text-[13.5px] leading-5 text-[#ffc2e2]">{error}</p>}
    </div>
  );
}

function RoomView({ session, status }: { session: RoomSession; status: RoomStatus | null }) {
  const live = status && status.roomId === session.roomId ? status : null;
  const [site, setSite] = useState<Site>(() => (live?.siteName === 'YouTube' ? 'youtube' : loadSite()));
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const link = buildInviteLink({ roomId: session.roomId, secret: session.secret }, ORIGIN[site]);

  const pickSite = (s: Site) => { setSite(s); setCopied(false); try { localStorage.setItem(SITE_KEY, s); } catch { /* optional */ } };
  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const leave = async () => { setLeaving(true); await leaveRoom(session.roomId); };

  const conn = live ? connectionLabel(live) : { text: 'Open Netflix or YouTube to connect', tone: 'idle' as const };

  return (
    <div className="space-y-3">
      <div className="surface rounded-2xl p-4">
        <div className="flex items-center gap-2.5">
          <StatusDot tone={conn.tone} className="!h-2.5 !w-2.5" />
          <span className="text-[15px] font-bold">{conn.text}</span>
        </div>
        <div className="mt-3 space-y-3">
          <Participant name={`${session.displayName} (you)`} tone={live ? 'ok' : 'idle'} sub={live ? playerLabel(live).text : 'No video tab connected'} hue="bg-gum" />
          <Participant
            name={live?.peer?.name ?? 'Your friend'}
            tone={live?.peer ? 'ok' : 'idle'}
            sub={live?.peer ? (live.peer.playerStatus === 'ready' ? 'Video player ready' : 'In the room') : 'Not here yet'}
            hue="bg-sky"
          />
        </div>
        {live && live.phase === 'connected' && (
          <div className="mt-3 space-y-1.5 border-t border-[#2f3a5e] pt-3 text-[13.5px] text-soft">
            <span className="flex items-center gap-2"><StatusDot tone={syncLabel(live).tone} />{syncLabel(live).text}</span>
            <span className="flex items-center gap-2"><StatusDot tone={callLabel(live).tone} />{callLabel(live).text}</span>
          </div>
        )}
      </div>

      {live && watchInvite(live) && (
        <div className="space-y-2 rounded-2xl border border-[#8c7a1f] bg-[#2f2a0f] p-4">
          <div className="text-[13px] font-bold text-lemon">{live.peer?.name} is watching</div>
          <div className="truncate text-[15px] font-bold text-white">{live.peer?.title ?? 'a video'}</div>
          <Button variant="primary" className="w-full" onClick={() => void sendRuntime({ type: 'OPEN_TITLE', titleId: live.peer!.titleId! })}><ExternalLink size={15} /> Jump there</Button>
        </div>
      )}

      <div className="surface space-y-3 rounded-2xl p-4">
        <div className="text-[15px] font-bold">Invite your friend</div>
        <div>
          <div className="mb-1.5 text-[13px] font-semibold text-white">Send a link that opens</div>
          <div role="radiogroup" aria-label="Invite link site" className="grid grid-cols-2 gap-1 rounded-xl bg-[#0b0f1d] p-1">
            {(['netflix', 'youtube'] as const).map((s) => (
              <button
                key={s} type="button" role="radio" aria-checked={site === s} onClick={() => pickSite(s)}
                className={`focus-candy h-9 rounded-lg text-[14px] font-bold transition-colors ${site === s ? 'bg-lemon text-grape-950' : 'text-soft hover:bg-white/10 hover:text-white'}`}
              >{s === 'netflix' ? 'Netflix' : 'YouTube'}</button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Input readOnly aria-label="Invite link" value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono !text-[12px]" />
          <Button variant={copied ? 'mint' : 'primary'} className="!h-11 w-[104px] shrink-0" onClick={() => void copy()}>
            {copied ? <><Check size={16} strokeWidth={3} /> Copied</> : <><Copy size={16} /> Copy</>}
          </Button>
        </div>
        <p className="text-[12.5px] leading-[18px] text-mute">Max 2 people. The link stops working when you leave. You can watch on either site, whichever link you send.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => void sendRuntime({ type: 'OPEN_SITE', site: 'netflix' })}><ExternalLink size={15} /> Open Netflix</Button>
        <Button onClick={() => void sendRuntime({ type: 'OPEN_SITE', site: 'youtube' })}><ExternalLink size={15} /> Open YouTube</Button>
      </div>
      <Button variant="danger" className="w-full" busy={leaving} onClick={() => void leave()}><LogOut size={15} /> Leave this party</Button>
      {live?.error && <p role="alert" className="rounded-xl border border-[#8a2f63] bg-[#3a1730] px-3.5 py-2.5 text-[13.5px] leading-5 text-[#ffc2e2]">{live.error}</p>}
      {!live && <p className="px-1 text-[13px] leading-5 text-mute">Open Netflix or YouTube. The PariParty panel appears on the page.</p>}
    </div>
  );
}

function Participant({ name, tone, sub, hue }: { name: string; tone: 'ok' | 'idle'; sub: string; hue: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${hue} text-[16px] font-bold text-grape-950`}>{name.slice(0, 1).toUpperCase()}</div>
      <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-bold">{name}</div><div className="truncate text-[13px] text-mute">{sub}</div></div>
      <StatusDot tone={tone} className="!h-2.5 !w-2.5" />
    </div>
  );
}
