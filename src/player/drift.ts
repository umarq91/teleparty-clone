import { clamp } from '@/shared/util';
import type { PlaybackState } from '@/shared/protocol';

export interface DriftConfig {
  /** Below this |drift| (seconds) do nothing. */
  ignoreSec: number;
  /** At/above this |drift| hard-seek. Between ignore and seek: gently nudge playback rate. */
  seekSec: number;
  /** Minimum gap between automatic hard seeks, to avoid seek storms on slow connections. */
  seekCooldownMs: number;
  /** Max playback-rate deviation used for gentle correction (0.05 = ±5%). */
  maxRateDelta: number;
}

export const defaultDriftConfig: DriftConfig = { ignoreSec: 0.25, seekSec: 2, seekCooldownMs: 5000, maxRateDelta: 0.08 };

export type DriftAction =
  | { kind: 'none'; rate: number }
  | { kind: 'rate'; rate: number }
  | { kind: 'seek'; rate: number };

/**
 * Where the sender's playhead is *now*, given the state sampled at `sentAt` (sender clock).
 * `nowRemote` is the local time translated to the sender's clock (local + offset).
 * Latency is clamped so a bad clock estimate can never fling us across the movie.
 */
export function expectedPosition(state: PlaybackState, sentAt: number, nowRemote: number): number {
  if (!state.playing) return state.position;
  const elapsedMs = clamp(nowRemote - sentAt, 0, 10_000);
  return state.position + (elapsedMs / 1000) * state.rate;
}

/** drift = target - current. Positive => we are behind. */
export function planDrift(drift: number, baseRate: number, cfg: DriftConfig, msSinceLastSeek: number): DriftAction {
  const abs = Math.abs(drift);
  if (abs < cfg.ignoreSec) return { kind: 'none', rate: baseRate };
  if (abs >= cfg.seekSec && msSinceLastSeek >= cfg.seekCooldownMs) return { kind: 'seek', rate: baseRate };
  // Proportional nudge, saturating at ±maxRateDelta. During seek cooldown we saturate too.
  const delta = clamp(drift * 0.12, -cfg.maxRateDelta, cfg.maxRateDelta);
  const minNudge = 0.02; // below this the change is imperceptible and not worth fiddling with the player
  const effective = Math.abs(delta) < minNudge ? Math.sign(delta) * minNudge : delta;
  return { kind: 'rate', rate: baseRate * (1 + effective) };
}
