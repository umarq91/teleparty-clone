import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RoomClient } from '@/content/RoomClient';
import type { RoomStatus, Settings } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import { getSettings, onSettingsChange } from '@/shared/storage';
import { playSound, SOUNDS } from './sounds';

export function useRoomStatus(client: RoomClient): RoomStatus {
  return useSyncExternalStore(
    (cb) => client.on('status', cb),
    () => client.snapshot,
  );
}

export function useRemoteStream(client: RoomClient): MediaStream | null {
  const [s, setS] = useState<MediaStream | null>(client.remoteStream);
  useEffect(() => { setS(client.remoteStream); return client.on('remoteStream', setS); }, [client]);
  return s;
}

export function useNotice(client: RoomClient): [string | null, () => void] {
  const [n, setN] = useState<string | null>(null);
  useEffect(() => client.on('notice', setN), [client]);
  useEffect(() => {
    if (!n) return;
    const t = setTimeout(() => setN(null), 8000);
    return () => clearTimeout(t);
  }, [n]);
  return [n, () => setN(null)];
}

interface Pos { x: number; y: number }
const KEY = 'overlayState';

/** Draggable position (persisted in chrome.storage.local), clamped to the viewport. */
export function useDrag(initial: () => Pos) {
  const [pos, setPos] = useState<Pos>(initial);
  const posRef = useRef(pos);
  posRef.current = pos;
  const size = useRef({ w: 320, h: 200 });

  useEffect(() => {
    chrome.storage.local.get(KEY).then((r) => {
      const p = (r[KEY] as { pos?: Pos } | undefined)?.pos;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) setPos(clampPos(p, size.current));
    }).catch(() => undefined);
    const onResize = () => setPos((p) => clampPos(p, size.current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, el: HTMLElement | null) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const start = { px: e.clientX, py: e.clientY, ...posRef.current };
    if (el) size.current = { w: el.offsetWidth, h: el.offsetHeight };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setPos(clampPos({ x: start.x + ev.clientX - start.px, y: start.y + ev.clientY - start.py }, size.current));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      chrome.storage.local.set({ [KEY]: { pos: posRef.current } }).catch(() => undefined);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    e.preventDefault();
  };
  return { pos, onPointerDown, setSize: (w: number, h: number) => { size.current = { w, h }; setPos((p) => clampPos(p, size.current)); } };
}

function clampPos(p: Pos, s: { w: number; h: number }): Pos {
  return {
    x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - Math.min(s.w, 120))),
    y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - 44)),
  };
}

export type PanelMode = 'full' | 'cinema' | 'pill';
export type CinemaSize = 'S' | 'M' | 'L';
const MODE_KEY = 'overlayMode';

/** Panel layout mode + cinema size, remembered across Netflix pages. */
export function usePanelMode() {
  const [mode, setModeState] = useState<PanelMode>('full');
  const [size, setSizeState] = useState<CinemaSize>('M');
  useEffect(() => {
    chrome.storage.local.get(MODE_KEY).then((r) => {
      const v = r[MODE_KEY] as { mode?: PanelMode; size?: CinemaSize } | undefined;
      if (v?.mode === 'full' || v?.mode === 'cinema' || v?.mode === 'pill') setModeState(v.mode);
      if (v?.size === 'S' || v?.size === 'M' || v?.size === 'L') setSizeState(v.size);
    }).catch(() => undefined);
  }, []);
  const persist = (mode: PanelMode, size: CinemaSize) => { chrome.storage.local.set({ [MODE_KEY]: { mode, size } }).catch(() => undefined); };
  return {
    mode, size,
    setMode: (m: PanelMode) => { setModeState(m); persist(m, size); },
    setSize: (s: CinemaSize) => { setSizeState(s); persist(mode, s); },
  };
}

/** Live copy of the user's settings (so toggling "auto-collapse" in the popup applies instantly). */
export function useLiveSettings(): Settings {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    const load = () => void getSettings().then(setS).catch(() => undefined);
    load();
    return onSettingsChange(load);
  }, []);
  return s;
}

export interface FloatingReaction { id: number; from: string; emoji?: string; gif?: string; x: number; mine: boolean }
let reactionId = 1;

/** Stickers currently floating up the screen: both ones we send and ones the friend sends. */
export function useReactions(client: RoomClient) {
  const [items, setItems] = useState<FloatingReaction[]>([]);
  const add = (r: Omit<FloatingReaction, 'id' | 'x'>) => {
    const id = reactionId++;
    setItems((cur) => [...cur.slice(-11), { ...r, id, x: 12 + Math.random() * 76 }]);
    setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), 4200);
  };
  useEffect(() => client.on('reaction', (r) => add({ from: r.from, emoji: r.emoji, gif: r.gif, mine: false })), [client]); // eslint-disable-line react-hooks/exhaustive-deps
  return { items, add };
}

// ---- chat bubbles + soundboard ----------------------------------------------------------------

export interface ChatItem { key: number; from: string; text: string; mine: boolean; kind: 'chat' | 'sound' }
const BUBBLE_MS = 8000;
let chatKey = 1;

/** `log` = scroll-back for the tray; `live` = the few bubbles currently floating over the movie. */
export function useChat(client: RoomClient) {
  const [log, setLog] = useState<ChatItem[]>([]);
  const [live, setLive] = useState<ChatItem[]>([]);
  useEffect(() => {
    const push = (it: Omit<ChatItem, 'key'>) => {
      const item = { ...it, key: chatKey++ };
      setLog((l) => [...l.slice(-59), item]);
      setLive((l) => [...l.slice(-3), item]);
      setTimeout(() => setLive((l) => l.filter((x) => x.key !== item.key)), BUBBLE_MS);
    };
    const offChat = client.on('chat', (m) => push({ from: m.from, text: m.text, mine: m.mine, kind: 'chat' }));
    const offSound = client.on('sound', (m) => push({ from: m.from, text: `played ${SOUNDS.find((s) => s.id === m.id)?.label ?? m.id}`, mine: m.mine, kind: 'sound' }));
    return () => { offChat(); offSound(); };
  }, [client]);
  return { log, live };
}

const MUTE_KEY = 'overlaySoundsMuted';
/** Mute switch for the soundboard, remembered across pages. */
export function useSoundsMuted(client: RoomClient): [boolean, (m: boolean) => void] {
  const [muted, setMuted] = useState(false);
  const ref = useRef(false);
  ref.current = muted;
  useEffect(() => {
    chrome.storage.local.get(MUTE_KEY).then((r) => setMuted(r[MUTE_KEY] === true)).catch(() => undefined);
  }, []);
  useEffect(() => client.on('sound', (m) => { if (!ref.current) playSound(m.id); }), [client]);
  return [muted, (m) => { setMuted(m); chrome.storage.local.set({ [MUTE_KEY]: m }).catch(() => undefined); }];
}

/** A clock that only ticks while `active` (countdowns, "away for 2:13"). */
export function useNow(active: boolean, ms = 200): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setN(Date.now());
    const t = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return n;
}
