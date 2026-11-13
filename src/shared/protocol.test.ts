import { describe, expect, it } from 'vitest';
import { validateEnvelope, validatePeerMessage, validatePresence, validateSync } from './protocol';

const good = { kind: 'sync', v: 1, type: 'PLAY', seq: 5, sentAt: Date.now(), titleId: '80100172', state: { position: 12.5, playing: true, rate: 1 } };

describe('validateSync', () => {
  it('accepts a valid message', () => expect(validateSync(good)).not.toBeNull());
  it('rejects bad types, ranges and shapes', () => {
    expect(validateSync({ ...good, type: 'EXPLODE' })).toBeNull();
    expect(validateSync({ ...good, v: 2 })).toBeNull();
    expect(validateSync({ ...good, state: { ...good.state, position: -1 } })).toBeNull();
    expect(validateSync({ ...good, state: { ...good.state, position: NaN } })).toBeNull();
    expect(validateSync({ ...good, state: { ...good.state, rate: 100 } })).toBeNull();
    expect(validateSync({ ...good, state: null })).toBeNull(); // PLAY needs state
    expect(validateSync({ ...good, titleId: '../../evil' })).toBeNull();
    expect(validateSync({ ...good, seq: 'x' })).toBeNull();
    expect(validateSync(null)).toBeNull();
    expect(validateSync([])).toBeNull();
  });
  it('PLAYER_READY needs no state', () => {
    expect(validateSync({ ...good, type: 'PLAYER_READY', state: null })).not.toBeNull();
  });
  it('strips unknown fields', () => {
    expect(validateSync({ ...good, evil: 1 })).not.toHaveProperty('evil');
  });
});

describe('validatePeerMessage', () => {
  it('handles ping/pong/media', () => {
    expect(validatePeerMessage({ kind: 'ping', v: 1, t0: 5 })).not.toBeNull();
    expect(validatePeerMessage({ kind: 'pong', v: 1, t0: 5, t1: 6 })).not.toBeNull();
    expect(validatePeerMessage({ kind: 'media', v: 1, micOn: true, camOn: 'yes' })).toBeNull();
    expect(validatePeerMessage({ kind: 'nope', v: 1 })).toBeNull();
  });
});

describe('validateEnvelope', () => {
  const env = { v: 1, from: 'a', to: 'b', gen: 'g', payload: { kind: 'hello' } };
  it('requires addressing to me, from someone else', () => {
    expect(validateEnvelope(env, 'b')).not.toBeNull();
    expect(validateEnvelope(env, 'c')).toBeNull();
    expect(validateEnvelope({ ...env, from: 'b' }, 'b')).toBeNull();
  });
  it('validates payloads', () => {
    expect(validateEnvelope({ ...env, payload: { kind: 'description', description: { type: 'offer', sdp: 'v=0' } } }, 'b')).not.toBeNull();
    expect(validateEnvelope({ ...env, payload: { kind: 'description', description: { type: 'pranswer', sdp: 'v=0' } } }, 'b')).toBeNull();
    expect(validateEnvelope({ ...env, payload: { kind: 'description', description: { type: 'offer', sdp: 'x'.repeat(70_000) } } }, 'b')).toBeNull();
    expect(validateEnvelope({ ...env, payload: { kind: 'candidate', candidate: { candidate: 5 } } }, 'b')).toBeNull();
    expect(validateEnvelope({ ...env, payload: { kind: 'candidate', candidate: null } }, 'b')).not.toBeNull();
    expect(validateEnvelope({ ...env, payload: { kind: 'sync-relay', message: { ...good, type: 'BAD' } } }, 'b')).toBeNull();
    expect(validateEnvelope({ ...env, payload: { kind: 'x' } }, 'b')).toBeNull();
  });
});

describe('validatePresence', () => {
  const p = { name: 'Sam', role: 'host', gen: 'abc', playerStatus: 'ready', titleId: '1', inCall: false };
  it('accepts / rejects', () => {
    expect(validatePresence(p)).not.toBeNull();
    expect(validatePresence({ ...p, role: 'admin' })).toBeNull();
    expect(validatePresence({ ...p, name: '' })).toBeNull();
    expect(validatePresence({ ...p, name: 'x'.repeat(41) })).toBeNull();
  });
});

describe('media delivery messages', () => {
  it('keeps valid rx flags and drops invalid ones', () => {
    expect(validatePeerMessage({ kind: 'media', v: 1, micOn: true, camOn: true, rxVideo: false, rxAudio: true }))
      .toEqual({ kind: 'media', v: 1, micOn: true, camOn: true, rxVideo: false, rxAudio: true });
    expect(validatePeerMessage({ kind: 'media', v: 1, micOn: true, camOn: true, rxVideo: 'yes' }))
      .toEqual({ kind: 'media', v: 1, micOn: true, camOn: true });
  });
  it('accepts a fix request', () => expect(validatePeerMessage({ kind: 'fix', v: 1 })).toEqual({ kind: 'fix', v: 1 }));
});

describe('react messages', () => {
  it('accepts emoji and giphy gifs', () => {
    expect(validatePeerMessage({ kind: 'react', v: 1, emoji: '🍿' })).not.toBeNull();
    expect(validatePeerMessage({ kind: 'react', v: 1, gif: 'https://media2.giphy.com/media/abc123/200.gif' })).not.toBeNull();
  });
  it('rejects foreign hosts, text and odd shapes', () => {
    expect(validatePeerMessage({ kind: 'react', v: 1, gif: 'https://evil.com/x.gif' })).toBeNull();
    expect(validatePeerMessage({ kind: 'react', v: 1, gif: 'https://media.giphy.com.evil.com/x.gif' })).toBeNull();
    expect(validatePeerMessage({ kind: 'react', v: 1, gif: 'http://media.giphy.com/x.gif' })).toBeNull();
    expect(validatePeerMessage({ kind: 'react', v: 1, emoji: '<img src=x>' })).toBeNull();
    expect(validatePeerMessage({ kind: 'react', v: 1 })).toBeNull();
  });
});

describe('chat / sound / party messages', () => {
  it('cleans chat text and rejects junk', () => {
    expect(validatePeerMessage({ kind: 'chat', v: 1, id: 'abc123', text: '  hi\u0000   there‮ ' })).toMatchObject({ text: 'hi there' });
    expect(validatePeerMessage({ kind: 'chat', v: 1, id: 'abc123', text: 'x'.repeat(500) })).toMatchObject({ text: 'x'.repeat(200) });
    expect(validatePeerMessage({ kind: 'chat', v: 1, id: 'abc123', text: '   ' })).toBeNull();
    expect(validatePeerMessage({ kind: 'chat', v: 1, id: '../x', text: 'hi' })).toBeNull();
    expect(validatePeerMessage({ kind: 'chat', v: 1, id: 'a', text: 'x'.repeat(2000) })).toBeNull();
  });
  it('only knows built-in sounds', () => {
    expect(validatePeerMessage({ kind: 'sound', v: 1, id: 'airhorn' })).not.toBeNull();
    expect(validatePeerMessage({ kind: 'sound', v: 1, id: 'https://evil/x.mp3' })).toBeNull();
  });
  it('validates party ops', () => {
    expect(validatePeerMessage({ kind: 'party', v: 1, op: 'brb' })).not.toBeNull();
    expect(validatePeerMessage({ kind: 'party', v: 1, op: 'go', goAt: Date.now() + 3000, pos: 12.5 })).not.toBeNull();
    expect(validatePeerMessage({ kind: 'party', v: 1, op: 'go' })).toBeNull(); // go needs a time
    expect(validatePeerMessage({ kind: 'party', v: 1, op: 'explode' })).toBeNull();
    expect(validatePeerMessage({ kind: 'party', v: 1, op: 'go', goAt: NaN })).toBeNull();
    expect(validatePeerMessage({ kind: 'party', v: 1, op: 'go', goAt: 5, pos: -1 })).toBeNull();
  });
});

describe('title ids and ad reasons', () => {
  it('accepts Netflix and YouTube ids only', () => {
    expect(validateSync({ ...good, titleId: 'yt:dQw4w9WgXcQ' })).not.toBeNull();
    expect(validateSync({ ...good, titleId: 'yt:short' })).toBeNull();
    expect(validateSync({ ...good, titleId: 'yt:dQw4w9WgXcQ/../x' })).toBeNull();
    expect(validateSync({ ...good, titleId: 'evil:dQw4w9WgXcQ' })).toBeNull();
    expect(validatePresence({ name: 'Sam', role: 'guest', gen: 'g', playerStatus: 'ready', titleId: 'yt:dQw4w9WgXcQ', inCall: false })).not.toBeNull();
    expect(validatePresence({ name: 'Sam', role: 'guest', gen: 'g', playerStatus: 'ready', titleId: 'javascript:alert(1)', inCall: false })).toBeNull();
  });
  it('buffering may carry why:ad, nothing else', () => {
    expect(validatePeerMessage({ kind: 'party', v: 1, op: 'buffering', why: 'ad' })).toMatchObject({ why: 'ad' });
    expect(validatePeerMessage({ kind: 'party', v: 1, op: 'buffering', why: 'because' })).toBeNull();
  });
});
