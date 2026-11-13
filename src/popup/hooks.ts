import { useCallback, useEffect, useState } from 'react';
import { getSession, getSettings, getStatus, onSessionChange, onSettingsChange, onStatusChange, saveSettings } from '@/shared/storage';
import type { RoomSession, RoomStatus, Settings } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/constants';

export function useSession(): { session: RoomSession | null; loaded: boolean } {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void getSession().then((s) => { setSession(s); setLoaded(true); });
    return onSessionChange((s) => setSession(s ?? null));
  }, []);
  return { session, loaded };
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const load = () => void getSettings().then((s) => { setSettings(s); setLoaded(true); });
    load();
    return onSettingsChange(load);
  }, []);
  const save = useCallback(async (patch: Partial<Settings>) => setSettings(await saveSettings(patch)), []);
  return { settings, loaded, save };
}

/** Live status as published by whichever Netflix tab is hosting the room. */
export function useRoomStatus(): RoomStatus | null {
  const [s, setS] = useState<RoomStatus | null>(null);
  useEffect(() => {
    void getStatus().then(setS);
    return onStatusChange((v) => setS(v ?? null));
  }, []);
  return s;
}
