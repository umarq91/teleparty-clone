# PariParty

A private, self-hosted, two-person "watch together" Chrome extension for **Netflix and YouTube**: synced playback + a peer-to-peer video call.
Each person uses their **own** Netflix account. The extension never captures, proxies or touches video/DRM; it only
reads the `<video>` element's play/pause/time state and calls the standard `play()`, `pause()`, `currentTime`, `playbackRate`.

## Setup

All configuration (Supabase, TURN, GIPHY) lives in `.env` at build time, never inside the app. See **[setup.md](setup.md)**.

## Features
- **Synced playback** on Netflix and YouTube with drift correction, plus a private peer-to-peer video call. You can even be on different sites: "Go there" takes you to what your friend is watching.
- **"Sam is watching…" → Jump there.** If your friend has a video open and you don't (you're browsing, or on something else), you get an offer with the video's title: in the panel, as a toast when it's minimised, and in the popup. One tap opens the same video (even on the other site) and lines your position up with theirs.
- **YouTube ads:** when one of you gets an ad, the other pauses ("Sam is watching an ad") and you restart together after it.
- **Buffering sync:** if either video stalls, both pause and show who is catching up, then restart together.
- **Ready check, brb pause and a shared 3-2-1:** everyone resumes at the same instant, even with mismatched clocks.
- **Chat bubbles** that float over the movie and fade; **soundboard** (synthesized, no files); **emoji, stickers and GIFs** (GIPHY).
- Collapsible panel: full, videos-only, or a pill.

## Use

1. Popup → **Start a party** → copy the invite link → send it. 2. Friend opens the link (or pastes it in their popup) and confirms **Join**.
3. Both open the same Netflix title or YouTube video (the panel offers "Go there" if not). 4. Click **Start call** in the floating panel.

## Scripts
`npm run build` · `npm run dev` (watch) · `npm run typecheck` · `npm test` (unit tests) · `npx vite --config dev/vite.config.ts` then open `/harness.html` (WebRTC harness).

## Known limitations / risks (please read)
- **YouTube:** watch pages only (`/watch?v=…`): no Shorts, no live streams (position means nothing there), no embedded players, no `m.youtube.com`. Ads are detected from YouTube's player classes (`ad-showing`), which YouTube can change. Camera/mic permission is asked once per site.
- **One host tab:** only one tab hosts the room. Netflix and YouTube tabs coordinate through a short storage lease; a visible tab takes over from a hidden one after a few seconds (a running call restarts in the new tab).
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
