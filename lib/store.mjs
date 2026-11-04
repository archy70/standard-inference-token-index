// Fixings live in Netlify Blobs: one summary list ("history") plus the full record per day.
import { getStore } from "@netlify/blobs";

export function openStore() {
  const s = getStore("sit-fixings");
  return {
    async history() { return (await s.get("history", { type: "json" })) || []; },
    async saveHistory(list) { await s.setJSON("history", list); },
    async fixing(date) { return s.get(`fixing/${date}`, { type: "json" }); },
    async saveFixing(f) { await s.setJSON(`fixing/${f.date}`, f); },
  };
}

// In-memory store with the same shape, for tests and local runs.
export function memoryStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    async history() { return m.get("history") || []; },
    async saveHistory(list) { m.set("history", list); },
    async fixing(date) { return m.get(`fixing/${date}`) || null; },
    async saveFixing(f) { m.set(`fixing/${f.date}`, f); },
    dump: () => Object.fromEntries(m),
  };
}
