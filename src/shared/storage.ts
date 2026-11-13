import { DEFAULT_SETTINGS, STORAGE_SESSION_KEY, STORAGE_SETTINGS_KEY, STORAGE_STATUS_KEY } from './constants';
import type { RoomSession, RoomStatus, Settings } from './types';

type Unsub = () => void;

export async function getSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
  const stored = stripEmpty((r[STORAGE_SETTINGS_KEY] ?? {}) as Partial<Settings>);
  // Connection credentials are build-time only (.env, see setup.md): never read from, or written to, storage.
  const { supabaseUrl, supabaseAnonKey, turnUrls, turnUsername, turnCredential, giphyApiKey } = DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...stored, supabaseUrl, supabaseAnonKey, turnUrls, turnUsername, turnCredential, giphyApiKey };
}

/** Empty strings in saved settings must not shadow build-time env defaults. */
function stripEmpty(s: Partial<Settings>): Partial<Settings> {
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== '')) as Partial<Settings>;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const r = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
  const next = { ...(r[STORAGE_SETTINGS_KEY] ?? {}), ...patch };
  for (const k of ['supabaseUrl', 'supabaseAnonKey', 'turnUrls', 'turnUsername', 'turnCredential', 'giphyApiKey'] as const) delete (next as Partial<Settings>)[k];
  await chrome.storage.local.set({ [STORAGE_SETTINGS_KEY]: next });
  return getSettings();
}

export async function getSession(): Promise<RoomSession | null> {
  const r = await chrome.storage.local.get(STORAGE_SESSION_KEY);
  return (r[STORAGE_SESSION_KEY] as RoomSession | undefined) ?? null;
}
export const setSession = (s: RoomSession) => chrome.storage.local.set({ [STORAGE_SESSION_KEY]: s });
export const clearSession = () => chrome.storage.local.remove(STORAGE_SESSION_KEY);

export function onStorage<T>(area: 'local' | 'session', key: string, cb: (value: T | undefined) => void): Unsub {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, name: string) => {
    if (name === area && key in changes) cb(changes[key]?.newValue as T | undefined);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
export const onSessionChange = (cb: (s: RoomSession | undefined) => void) => onStorage<RoomSession>('local', STORAGE_SESSION_KEY, cb);
export const onSettingsChange = (cb: () => void) => onStorage('local', STORAGE_SETTINGS_KEY, cb);

export const publishStatus = (s: RoomStatus) => chrome.storage.session.set({ [STORAGE_STATUS_KEY]: s });
export async function getStatus(): Promise<RoomStatus | null> {
  const r = await chrome.storage.session.get(STORAGE_STATUS_KEY);
  return (r[STORAGE_STATUS_KEY] as RoomStatus | undefined) ?? null;
}
export const onStatusChange = (cb: (s: RoomStatus | undefined) => void) => onStorage<RoomStatus>('session', STORAGE_STATUS_KEY, cb);
export const clearStatus = () => chrome.storage.session.remove(STORAGE_STATUS_KEY);

/** Storage adapter so supabase-js persists its anonymous session in chrome.storage (shared by popup + content). */
export const supabaseStorage = {
  async getItem(key: string) {
    const r = await chrome.storage.local.get(key);
    return (r[key] as string | undefined) ?? null;
  },
  async setItem(key: string, value: string) { await chrome.storage.local.set({ [key]: value }); },
  async removeItem(key: string) { await chrome.storage.local.remove(key); },
};
