import { INVITE_HASH_KEY } from '@/shared/constants';
import { parseInvite, type InviteToken } from '@/shared/invite';
import { joinRoom, RoomError } from '@/rooms/roomApi';
import { getSettings } from '@/shared/storage';
import { errorMessage } from '@/shared/util';

/** If the URL carries `#mtp=<roomId>.<secret>` return it and strip it from the address bar. */
export function takeInviteFromUrl(): InviteToken | null {
  if (!location.hash.includes(`${INVITE_HASH_KEY}=`)) return null;
  const token = parseInvite(location.hash);
  // Remove the secret from the visible URL/history either way.
  history.replaceState(history.state, '', location.pathname + location.search);
  return token;
}

/**
 * Joining a room is never silent: a link on some web page must not be able to enrol you in a room
 * (and later its call) without your consent. Plain DOM + Shadow DOM, no React needed for one banner.
 */
export function promptJoin(token: InviteToken): void {
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483600;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .b{font:13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;color:#fff;display:flex;gap:14px;align-items:center;padding:14px 16px;
         background:linear-gradient(160deg,#25134dcc,#0a1222d9);border:1px solid #ffffff2b;border-radius:22px;
         box-shadow:0 18px 50px -10px #000a,inset 0 1px 0 #ffffff33;backdrop-filter:blur(26px) saturate(1.6);-webkit-backdrop-filter:blur(26px) saturate(1.6);
         animation:in .45s cubic-bezier(.2,1.4,.4,1) both}
      @keyframes in{from{opacity:0;transform:translateY(-14px) scale(.92)}to{opacity:1;transform:none}}
      .e{font-size:26px;animation:w 1.4s ease-in-out infinite} @keyframes w{50%{transform:rotate(12deg) scale(1.1)}}
      .t{max-width:250px;font-weight:700} .s{color:#ffffffa6;font-size:12px;font-weight:500;margin-top:2px}
      .n{background:linear-gradient(90deg,#ff5fb7,#ffe45e,#4df0c0);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:900}
      button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:8px 14px;cursor:pointer;transition:transform .15s}
      button:hover{transform:translateY(-1px) scale(1.03)} button:active{transform:scale(.95)}
      .p{background:linear-gradient(#ff5fb7,#e03a98);color:#fff;box-shadow:0 6px 18px -4px #ff5fb78c} .g{background:#ffffff1f;color:#fff}
      .err{color:#ff9ccf}
    </style>
    <div class="b"><span class="e">🎉</span><div class="t"><div>Join a <span class="n">PariParty</span> room?</div><div class="s" id="m">Someone invited you to watch together.</div></div>
    <button class="p" id="j">Join</button><button class="g" id="x">Nah</button></div>`;
  document.documentElement.appendChild(host);
  const $ = (id: string) => root.getElementById(id) as HTMLElement;
  $('x').onclick = () => host.remove();
  $('j').onclick = async () => {
    const btn = $('j') as HTMLButtonElement;
    btn.disabled = true; btn.textContent = 'Joining…';
    try {
      const { displayName } = await getSettings();
      await joinRoom(token, displayName.trim() || 'Guest');
      host.remove(); // RoomClient takes over via the stored session
    } catch (e) {
      $('m').className = 'err';
      $('m').textContent = e instanceof RoomError ? e.message : errorMessage(e);
      btn.disabled = false; btn.textContent = 'Retry';
    }
  };
}
