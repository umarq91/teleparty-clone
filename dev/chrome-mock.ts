// Minimal chrome.* so the real UI components can render in a plain browser tab (preview only).
const store: Record<string, unknown> = {};
const area = { get: async (k?: string) => (k ? { [k]: store[k] } : { ...store }), set: async (o: Record<string, unknown>) => { Object.assign(store, o); }, remove: async (k: string) => { delete store[k]; } };
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local: area, session: area, onChanged: { addListener() {}, removeListener() {} } },
  runtime: { sendMessage: async () => undefined },
};
