import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { STORAGE_AUTH_PREFIX } from '@/shared/constants';
import { getSettings, supabaseStorage } from '@/shared/storage';

let cached: { key: string; client: SupabaseClient } | null = null;

export class ConfigError extends Error {}

/** Lazily builds the client from build-time env or user settings. Only the public anon key is ever used. */
export async function getSupabase(): Promise<SupabaseClient> {
  const { supabaseUrl, supabaseAnonKey } = await getSettings();
  if (!/^https?:\/\//.test(supabaseUrl) || !supabaseAnonKey) {
    throw new ConfigError('Supabase is not configured. Open Settings and enter your project URL and anon key.');
  }
  const key = `${supabaseUrl}|${supabaseAnonKey}`;
  if (cached?.key === key) return cached.client;
  cached?.client.removeAllChannels();
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: supabaseStorage,
      storageKey: `${STORAGE_AUTH_PREFIX}${new URL(supabaseUrl).host}`,
      // Several extension contexts (popup + tab) can touch the session; avoid the Web Locks deadlock risk.
      lock: async (_name, _timeout, fn) => fn(),
    },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  cached = { key, client };
  return client;
}

/** Ensures an anonymous session exists (creating one on first use) and that realtime has its JWT. */
export async function ensureAuth(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  let session = data.session;
  if (!session) {
    const res = await client.auth.signInAnonymously();
    if (res.error || !res.data.session) {
      throw new Error(
        res.error?.message?.includes('Anonymous')
          ? 'Anonymous sign-ins are disabled in your Supabase project (Authentication → Providers).'
          : `Could not sign in anonymously: ${res.error?.message ?? 'unknown error'}`,
      );
    }
    session = res.data.session;
  }
  await client.realtime.setAuth(session.access_token);
  return session.user.id;
}
