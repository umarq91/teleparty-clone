import { useEffect, useState } from 'react';
import { ArrowLeft, Film, Sparkles } from 'lucide-react';
import type { Settings } from '@/shared/types';
import { Button, Checkbox, Field, Input, Section, Toggle } from './components';

interface Props { settings: Settings; onSave: (p: Partial<Settings>) => Promise<void>; onBack: () => void }

export function SettingsView({ settings, onSave, onBack }: Props) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setSaved(false); setDraft((d) => ({ ...d, [k]: v })); };

  const save = async () => {
    await onSave({
      ...draft,
      displayName: draft.displayName.trim().slice(0, 40),
      driftSeekSec: Math.max(draft.driftIgnoreSec + 0.25, draft.driftSeekSec),
    });
    setSaved(true);
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" className="!h-10 !px-3" onClick={onBack}><ArrowLeft size={17} /> Back</Button>
        <h2 className="text-[17px] font-bold">Settings</h2>
      </div>

      <div className="surface rounded-2xl p-3.5">
        <Field label="Your name"><Input value={draft.displayName} maxLength={40} placeholder="Shown to your friend" onChange={(e) => set('displayName', e.target.value)} /></Field>
      </div>

      <Section title="Call and sync" icon={<Sparkles size={17} className="text-lemon" />} defaultOpen>
        <Checkbox checked={draft.autoCollapse} onChange={(v) => set('autoCollapse', v)} label="Tuck away everything but the videos once the call is solid" />
        <Checkbox checked={draft.waitForBuffering} onChange={(v) => set('waitForBuffering', v)} label="Pause for both of us when either video is buffering or showing an ad" />
        <Checkbox checked={draft.autoStartCall} onChange={(v) => set('autoStartCall', v)} label="Start the call automatically when we connect" />
      </Section>

      <Section title="Playback" icon={<Film size={17} className="text-mint" />} defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ignore drift (s)"><Input type="number" step="0.05" min="0.05" max="2" value={draft.driftIgnoreSec} onChange={(e) => set('driftIgnoreSec', Number(e.target.value) || 0.25)} /></Field>
          <Field label="Hard-seek (s)"><Input type="number" step="0.25" min="0.5" max="30" value={draft.driftSeekSec} onChange={(e) => set('driftSeekSec', Number(e.target.value) || 2)} /></Field>
        </div>
        <Toggle
          label="Netflix seek bridge (experimental)"
          hint="Seeks through Netflix's own undocumented player object. Only turn on if seeking triggers Netflix error M7375."
          checked={draft.useNetflixSeekBridge} onChange={(v) => set('useNetflixSeekBridge', v)}
        />
      </Section>

      <Button variant={saved ? 'mint' : 'primary'} className="h-11 w-full text-[15px]" onClick={() => void save()}>{saved ? 'Saved' : 'Save settings'}</Button>
    </div>
  );
}
