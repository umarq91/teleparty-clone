# Architecture

- `src/content/` – content script on netflix.com: `RoomClient` orchestrates signaling, `PeerLink`, `LocalMedia`, `VideoWatcher`, `SyncEngine`; mounts the overlay. One tab hosts the room (Web Lock `navigator.locks`).
- `src/signaling/RoomChannel.ts` – private Supabase Realtime channel `room:<id>`: presence + broadcast, backoff resubscribe, validated inbound messages.
- `src/webrtc/` – `PeerLink` (one RTCPeerConnection, deterministic offerer so no glare, negotiated DataChannel id 0, audio/video transceivers attached with `replaceTrack`), `LocalMedia` (getUserMedia, device changes).
- `src/player/` – `VideoWatcher` (finds/re-finds `<video>` across SPA navigation), `SyncEngine` (loop guards, coalescing, drift), `drift.ts` (pure), `seek.ts` + `bridge.ts` (opt-in MAIN-world seek).
- `src/rooms/` – anonymous auth + RPC wrappers. `src/shared/` – types, protocol validators, invite tokens, storage.
- `src/popup/`, `src/floating-ui/` – React UIs (Tailwind; overlay in Shadow DOM, re-parented into the fullscreen element).
- `src/background/` – thin MV3 service worker (open Netflix, badge). WebRTC can't run in a service worker.
- `supabase/migrations/` – tables, SECURITY DEFINER RPCs, RLS on `realtime.messages`.

Security: anonymous JWT per browser; room secret stored hashed; join only via RPC; only members can use the room's Realtime topic; all inbound data validated (`shared/protocol.ts`); only the public anon key ships.
Sync: host is drift authority; <0.25 s ignore, 0.25–2 s rate nudge (≤±8 %), >2 s seek (5 s cooldown). Only the longer-running side answers `PLAYER_READY` with a state snapshot.
