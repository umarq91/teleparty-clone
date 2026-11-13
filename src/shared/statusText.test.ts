import { describe, expect, it } from 'vitest';
import { initialStatus, type RoomStatus } from './types';
import { watchInvite } from './statusText';

const status = (over: Partial<RoomStatus>, peer: Partial<NonNullable<RoomStatus['peer']>> = {}): RoomStatus => ({
  ...initialStatus(),
  peer: { userId: 'p', name: 'Sam', playerStatus: 'ready', titleId: '80100172', title: 'The Bear', inCall: false, ...peer },
  ...over,
});

describe('watchInvite', () => {
  it('offers the friend\'s video while we are just browsing', () => {
    expect(watchInvite(status({ titleId: null }))).toEqual({ titleId: '80100172', name: 'Sam', title: 'The Bear' });
  });
  it('offers it when we are watching something else', () => {
    expect(watchInvite(status({ titleId: '999' }))).not.toBeNull();
  });
  it('offers a YouTube video to someone on Netflix', () => {
    expect(watchInvite(status({ titleId: '999' }, { titleId: 'yt:dQw4w9WgXcQ', title: null }))).toMatchObject({ titleId: 'yt:dQw4w9WgXcQ', title: null });
  });
  it('stays quiet when we are already on the same video, or the friend has none', () => {
    expect(watchInvite(status({ titleId: '80100172' }))).toBeNull();
    expect(watchInvite(status({ titleId: null }, { titleId: null, playerStatus: 'none' }))).toBeNull();
    expect(watchInvite(status({ titleId: null }, { playerStatus: 'not-found' }))).toBeNull();
    expect(watchInvite({ ...initialStatus(), peer: null })).toBeNull();
  });
});
