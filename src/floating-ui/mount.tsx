import { createRoot, type Root } from 'react-dom/client';
import type { RoomClient } from '@/content/RoomClient';
import css from './styles.css?inline';
import { App } from './App';

export interface OverlayHandle { unmount(): void }

/**
 * Mounts the overlay in a closed-off Shadow DOM so the site's CSS can't touch it (and ours can't touch
 * the site). While the site is fullscreen, only descendants of the fullscreen element are visible, so
 * the host is re-parented into `document.fullscreenElement` when fullscreen toggles.
 */
export function mountOverlay(client: RoomClient, inviteLink: string, onLeave: () => void): OverlayHandle {
  const host = document.createElement('div');
  host.id = 'mini-teleparty-root';
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const mountPoint = document.createElement('div');
  shadow.append(style, mountPoint);

  const place = () => {
    const parent = document.fullscreenElement ?? document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  };
  place();
  document.addEventListener('fullscreenchange', place);
  // The site may wipe unknown nodes from <body> on navigation; re-attach if that ever happens.
  const keepAlive = setInterval(() => { if (!host.isConnected) place(); }, 1500);

  // Sites bind single-key hotkeys (YouTube: k, f, m, j, l, /; Netflix: space, f, m...) with *capture* listeners that
  // fire before anything inside our Shadow DOM sees the key. This one is registered first (document_start), so while
  // you type in our chat box the page never hears the keys. Escape is left alone so our tray can close.
  const shield = (e: KeyboardEvent) => { if (e.key !== 'Escape' && e.composedPath().includes(host)) e.stopImmediatePropagation(); };
  const KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const;
  KEY_EVENTS.forEach((t) => window.addEventListener(t, shield, true));

  const root: Root = createRoot(mountPoint);
  root.render(<App client={client} inviteLink={inviteLink} onLeave={onLeave} />);

  return {
    unmount() {
      clearInterval(keepAlive);
      KEY_EVENTS.forEach((t) => window.removeEventListener(t, shield, true));
      document.removeEventListener('fullscreenchange', place);
      root.unmount();
      host.remove();
    },
  };
}
