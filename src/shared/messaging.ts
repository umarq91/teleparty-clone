/** Typed runtime messages between popup / content script / background. */
export type RuntimeMessage =
  | { type: 'OPEN_SITE'; site: 'netflix' | 'youtube' }
  | { type: 'SET_BADGE'; text: string; color?: string }
  | { type: 'SEARCH_STICKERS'; query: string; kind: 'stickers' | 'gifs' };

export interface StickerResult { id: string; title: string; url: string; preview: string; w: number; h: number }
export type StickerSearchResponse = { ok: true; results: StickerResult[] } | { ok: false; error: string };

export function isRuntimeMessage(x: unknown): x is RuntimeMessage {
  return typeof x === 'object' && x !== null && typeof (x as { type?: unknown }).type === 'string';
}

export const sendRuntime = <R = unknown>(m: RuntimeMessage): Promise<R | undefined> =>
  chrome.runtime.sendMessage(m).catch(() => undefined) as Promise<R | undefined>;
