export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function randomId(bytes = 8): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** Tiny typed emitter. */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(v: never) => void>>();
  on<K extends keyof E>(k: K, fn: (v: E[K]) => void): () => void {
    const set = this.map.get(k) ?? new Set();
    set.add(fn as (v: never) => void);
    this.map.set(k, set);
    return () => set.delete(fn as (v: never) => void);
  }
  protected emit<K extends keyof E>(k: K, v: E[K]) {
    this.map.get(k)?.forEach((fn) => (fn as (v: E[K]) => void)(v));
  }
  removeAllListeners() { this.map.clear(); }
}
