import { describe, expect, it } from 'vitest';
import { buildInviteLink, generateSecret, parseInvite } from './invite';

const roomId = '3f2b8c1e-9a4d-4e7b-8c11-0d5e6f7a8b9c';

describe('invite tokens', () => {
  it('round-trips link and bare code', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(parseInvite(buildInviteLink({ roomId, secret }))).toEqual({ roomId, secret });
    expect(parseInvite(`${roomId}.${secret}`)).toEqual({ roomId, secret });
  });
  it('rejects garbage', () => {
    for (const bad of ['', 'hello', `${roomId}`, `${roomId}.short`, `not-a-uuid.${generateSecret()}`, `${roomId}.${generateSecret()}.x`, `#mtp=<script>`]) {
      expect(parseInvite(bad), bad).toBeNull();
    }
  });
  it('secrets are unique', () => {
    expect(new Set(Array.from({ length: 200 }, generateSecret)).size).toBe(200);
  });
});
