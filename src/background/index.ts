import { DEFAULT_SETTINGS, NETFLIX_ORIGIN, STORAGE_SETTINGS_KEY } from '@/shared/constants';
import { isRuntimeMessage, type StickerResult, type StickerSearchResponse } from '@/shared/messaging';
import { getSettings } from '@/shared/storage';
import { isAllowedGifUrl } from '@/shared/protocol';

/**
 * The service worker is deliberately thin: WebRTC and Realtime need a long-lived DOM context, which
 * a service worker is not, so they run in the Netflix tab (see content/). The worker only handles
 * install defaults, opening Netflix, and the toolbar badge.
 */

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const r = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
    if (!r[STORAGE_SETTINGS_KEY]) await chrome.storage.local.set({ [STORAGE_SETTINGS_KEY]: { driftIgnoreSec: DEFAULT_SETTINGS.driftIgnoreSec, driftSeekSec: DEFAULT_SETTINGS.driftSeekSec } });
  }
  await chrome.action.setBadgeBackgroundColor({ color: '#ff5fb7' });
});

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!isRuntimeMessage(msg)) return false;
  switch (msg.type) {
    case 'OPEN_NETFLIX': {
      void (async () => {
        const path = msg.path && /^\/[\w\-/?=&.%]*$/.test(msg.path) ? msg.path : '/';
        const tabs = await chrome.tabs.query({ url: `${NETFLIX_ORIGIN}/*` });
        const tab = tabs[0];
        if (tab?.id !== undefined) {
          await chrome.tabs.update(tab.id, { active: true });
          if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
        } else {
          await chrome.tabs.create({ url: NETFLIX_ORIGIN + path });
        }
        sendResponse({ ok: true });
      })();
      return true; // async response
    }
    case 'SET_BADGE': {
      void chrome.action.setBadgeText({ text: msg.text });
      if (msg.color) void chrome.action.setBadgeBackgroundColor({ color: msg.color });
      return false;
    }
    case 'SEARCH_STICKERS': {
      void searchStickers(msg.query, msg.kind).then(sendResponse);
      return true;
    }
    default:
      return false;
  }
});

/** GIF/sticker search runs here (not in the page) so Netflix's CORS/CSP can't interfere with the API call. */
async function searchStickers(query: string, kind: 'stickers' | 'gifs'): Promise<StickerSearchResponse> {
  const { giphyApiKey } = await getSettings();
  if (!giphyApiKey) return { ok: false, error: 'GIF search isn’t set up yet. See setup.md (GIPHY key).' };
  const q = query.trim().slice(0, 60);
  const endpoint = q ? 'search' : 'trending';
  const url = new URL(`https://api.giphy.com/v1/${kind}/${endpoint}`);
  url.searchParams.set('api_key', giphyApiKey);
  url.searchParams.set('limit', '24');
  url.searchParams.set('rating', 'pg-13');
  if (q) url.searchParams.set('q', q);
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return { ok: false, error: res.status === 401 || res.status === 403 ? 'GIPHY rejected the API key.' : res.status === 429 ? 'GIPHY rate limit hit. Try again in a bit.' : `GIPHY error ${res.status}` };
    const json = (await res.json()) as { data?: { id?: string; title?: string; images?: Record<string, { url?: string; width?: string; height?: string }> }[] };
    const results: StickerResult[] = [];
    for (const d of json.data ?? []) {
      const full = d.images?.fixed_height ?? d.images?.fixed_width;
      const small = d.images?.fixed_height_small ?? full;
      if (!d.id || !full?.url || !small?.url || !isAllowedGifUrl(full.url) || !isAllowedGifUrl(small.url)) continue;
      results.push({ id: d.id, title: (d.title ?? '').slice(0, 40), url: full.url, preview: small.url, w: Number(full.width) || 200, h: Number(full.height) || 200 });
    }
    return { ok: true, results };
  } catch {
    return { ok: false, error: 'Couldn’t reach GIPHY. Check your connection.' };
  }
}
