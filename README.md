# PariParty

A private, self-hosted, two-person "watch Netflix together" Chrome extension: synced playback + a peer-to-peer video call.
Each person uses their **own** Netflix account. The extension never captures, proxies or touches Netflix video/DRM; it only
reads the `<video>` element's play/pause/time state and calls the standard `play()`, `pause()`, `currentTime`, `playbackRate`.

## Setup

All configuration (Supabase, TURN, GIPHY) lives in `.env` at build time, never inside the app. See **[setup.md](setup.md)**.

## Features
- **Synced playback** with drift correction, plus a private peer-to-peer video call.
- **Buffering sync:** if either video stalls, both pause and show who is catching up, then restart together.
- **Ready check, brb pause and a shared 3-2-1:** everyone resumes at the same instant, even with mismatched clocks.
- **Chat bubbles** that float over the movie and fade; **soundboard** (synthesized, no files); **emoji, stickers and GIFs** (GIPHY).
- Collapsible panel: full, videos-only, or a pill.

## Use

1. Popup → **Create room** → copy the invite link → send it. 2. Friend opens the link (or pastes it in their popup) and confirms **Join**.
3. Both open a Netflix title (same title; the panel offers "Go there" if not). 4. Click **Start call** in the floating panel.

## Scripts
`npm run build` · `npm run dev` (watch) · `npm run typecheck` · `npm test` (unit tests) · `npx vite --config dev/vite.config.ts` then open `/harness.html` (WebRTC harness).

## Known limitations / risks (please read)
- **Seeking on Netflix**: assigning `video.currentTime` makes some Netflix builds abort with error **M7375**. Default is the standard API.
  If you hit it, enable *Netflix seek bridge (experimental)* in Settings: it seeks via Netflix's own **undocumented** player object (opt-in, feature-detected, falls back to the standard API). Play/pause/rate use only standard APIs.
- **Not tested against live Netflix** by the author of this scaffold (no account in the build environment): selectors/`<video>` detection, fullscreen overlay and seek behaviour need your verification.
- Camera/mic permission is requested for `netflix.com`; if Netflix's Permissions-Policy blocks it, the panel shows an error.
- The room runs in one Netflix tab (Web Lock). Closing that tab drops the room connection until another Netflix tab is open.
- The host is the drift reference; autoplay may be blocked by Chrome until you click the page once.
- Buffering on one side is not yet propagated (the other side keeps playing and is corrected by drift sync).
- Invite link = join credential (anyone holding it can take the free slot). Rooms hold max 2 people; stale members are pruned after 90 s.
- Reconnection and network-interruption handling are implemented (backoff resubscribe, ICE restart, DataChannel→broadcast fallback) but only the WebRTC path has been exercised in a browser.

See `docs/ARCHITECTURE.md`.
