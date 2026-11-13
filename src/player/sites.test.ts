// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getTitleName, getVideoId, isAdPlaying, isWatchPage } from './youtube';
import { adapterForHost, NETFLIX, urlForTitle, YOUTUBE } from './sites';

describe('youtube helpers', () => {
  it('reads the video id from /watch only', () => {
    expect(getVideoId({ pathname: '/watch', search: '?v=dQw4w9WgXcQ&t=30s' })).toBe('dQw4w9WgXcQ');
    expect(getVideoId({ pathname: '/watch', search: '?v=short' })).toBeNull();
    expect(getVideoId({ pathname: '/results', search: '?v=dQw4w9WgXcQ' })).toBeNull();
    expect(isWatchPage({ pathname: '/', search: '' })).toBe(false);
  });
  it('detects an ad from the player classes', () => {
    document.body.innerHTML = '<div id="movie_player"></div>';
    expect(isAdPlaying()).toBe(false);
    document.getElementById('movie_player')!.classList.add('ad-showing');
    expect(isAdPlaying()).toBe(true);
  });
});

describe('youtube title', () => {
  it('strips the notification count and the site suffix', () => {
    expect(getTitleName('(3) Never Gonna Give You Up - YouTube')).toBe('Never Gonna Give You Up');
    expect(getTitleName('YouTube')).toBeNull();
    expect(getTitleName('')).toBeNull();
  });
});

describe('site adapters', () => {
  it('routes hosts and title ids to the right site', () => {
    expect(adapterForHost('www.youtube.com')).toBe(YOUTUBE);
    expect(adapterForHost('www.netflix.com')).toBe(NETFLIX);
    expect(adapterForHost('evil.com')).toBeNull();
    expect(urlForTitle('80100172')).toBe('https://www.netflix.com/watch/80100172');
    expect(urlForTitle('yt:dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(urlForTitle('nope')).toBeNull();
  });
});
