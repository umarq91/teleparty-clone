# PariParty setup

Everything that needs a key or a URL is configured **here, at build time**. The extension itself has no
credential fields: nothing is typed into the popup, nothing is stored in the browser. Change a value, rebuild, reload.

## 1. Supabase (required)

Supabase only carries room signaling (who is in the room, WebRTC handshakes, sync fallback). Video never touches it.

1. Create a free project at <https://supabase.com>.
2. **Authentication → Providers →** enable **Anonymous sign-ins**.
3. **SQL editor →** run `supabase/migrations/20260101000000_rooms.sql`.
4. *(optional)* clean up stale rooms:
   `select cron.schedule('mtp-cleanup','*/10 * * * *','select public.cleanup_stale_rooms()');`
5. **Settings → API:** copy the **Project URL** and the **anon (public)** key into `.env` (below).
   Never use the `service_role` key.

## 2. GIPHY (optional: internet stickers & GIFs)

Without it, the sticker tray still has searchable emoji. For GIF/sticker search:

1. Go to <https://developers.giphy.com>, create an app (API type), copy the key.
2. Put it in `.env` as `VITE_GIPHY_API_KEY`.

## 3. TURN (optional: only for strict networks)

Needed only when two people can't connect directly (corporate or carrier-grade NAT). Sync still works without it
through a Supabase fallback; the video call does not. Run your own coturn on a small VPS, or use a free-tier provider.

## 4. `.env`

```bash
cp .env.example .env
```

| Variable | Required | What |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | `https://YOUR-PROJECT.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | yes | the public anon key |
| `VITE_GIPHY_API_KEY` | no | enables GIF/sticker search |
| `VITE_TURN_URLS` | no | comma separated, e.g. `turn:turn.example.com:3478?transport=udp` |
| `VITE_TURN_USERNAME` | no | TURN username |
| `VITE_TURN_CREDENTIAL` | no | TURN password |

`.env` is gitignored. Keep it that way, and don't paste real values into this file.

> Vite inlines these values into the built extension (`dist/`). The Supabase anon key and GIPHY key are designed to be
> public-facing, but anyone you send `dist/` to can read them. Share the source and have each person build with their
> own `.env` if that matters. The TURN credential is the one to be careful with.

## 5. Build and load

```bash
npm install
npm run build
```

Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → select `dist/`.
After changing `.env`: `npm run build`, then click the reload icon on the extension and refresh your Netflix tab.

## 6. Use

1. Popup → **Start a party** → copy the invite link → send it.
2. Your friend opens the link (or pastes it in their popup) and confirms **Join**.
3. Both open the same Netflix title or YouTube video, then press **Start call** in the PariParty panel.
   (Chrome asks for camera/mic permission separately for netflix.com and youtube.com.)

## Troubleshooting

- **Popup says no Supabase project is connected:** `.env` was missing or empty when you built. Fix it and rebuild.
- **Stickers tab says it needs a GIPHY key:** set `VITE_GIPHY_API_KEY` and rebuild.
- **Seeking triggers Netflix error M7375:** the Netflix seek bridge in popup Settings is on by default; toggle it if seeking misbehaves.
- **No video between you two:** probably a restrictive network; set up TURN (section 3).
