// Where each input comes from. Every fetch is tolerant: on failure it returns null
// and the run falls back to the previous fixing's values.
// Config is bundled into the functions at deploy time, so editing a file in config/ means redeploying.
import scoresCfg from "../config/scores.json" with { type: "json" };
import weightsCfg from "../config/weights.json" with { type: "json" };
import aliasesCfg from "../config/aliases.json" with { type: "json" };
import seedCfg from "../config/seed-fixing.json" with { type: "json" };

const CONFIG = { "scores.json": scoresCfg, "weights.json": weightsCfg, "aliases.json": aliasesCfg, "seed-fixing.json": seedCfg };
export async function loadConfig(name) {
  if (!(name in CONFIG)) throw new Error(`Unknown config ${name}`);
  return structuredClone(CONFIG[name]);
}

// "Anthropic: Claude Opus 5.5" / "claude-opus-5-5" / "Claude Opus 5.5 (max)" → "claudeopus55"
export function normalise(name = "") {
  return String(name).toLowerCase()
    .replace(/^[^:]*:\s*/, "")       // drop "Provider: " prefix
    .replace(/\(.*?\)/g, "")         // drop "(max)", "(preview)" etc.
    .replace(/[^a-z0-9]/g, "");
}

// OpenRouter: current list prices for every model, per token → per 1M tokens. No key needed.
export async function fetchOpenRouterPrices(fetchFn = fetch) {
  try {
    const res = await fetchFn("https://openrouter.ai/api/v1/models", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const json = await res.json();
    const byId = new Map(), byName = new Map();
    for (const m of json.data || []) {
      const input = Number(m.pricing?.prompt) * 1e6, output = Number(m.pricing?.completion) * 1e6;
      if (!(output > 0) || !(input >= 0)) continue; // skip free and broken entries
      const rec = { input, output, id: m.id };
      byId.set(m.id, rec);
      if (m.canonical_slug) byId.set(m.canonical_slug, rec);
      const key = normalise(m.name || m.id.split("/").pop());
      // Keep the cheapest variant when several endpoints share a name.
      if (!byName.has(key) || byName.get(key).output > output) byName.set(key, rec);
    }
    return { byId, byName, count: byId.size };
  } catch (e) {
    console.warn("OpenRouter prices unavailable:", e.message);
    return null;
  }
}

// Capability scores. With AA_API_KEY set, from the Artificial Analysis API;
// otherwise from config/scores.json, which you maintain (or point at a source you may republish).
export async function fetchScores(env = {}, fetchFn = fetch) {
  const key = env.AA_API_KEY;
  if (key) {
    for (const path of ["/api/v2/language/models", "/api/v2/language/models/free"]) {
      try {
        const out = [];
        for (let page = 1; page <= 10; page++) {
          const res = await fetchFn(`https://artificialanalysis.ai${path}?page=${page}`, { headers: { "x-api-key": key } });
          if (!res.ok) throw new Error(`AA ${path} ${res.status}`);
          const json = await res.json();
          for (const m of json.data || []) {
            const score = Number(m.evaluations?.artificial_analysis_intelligence_index);
            if (!isFinite(score)) continue;
            out.push({
              model: m.name, lab: m.model_creator?.name || "Unknown", score,
              aaInput: Number(m.pricing?.price_1m_input_tokens), aaOutput: Number(m.pricing?.price_1m_output_tokens),
              slug: m.slug,
            });
          }
          if (!json.pagination?.has_more) break;
        }
        if (out.length) return { source: `Artificial Analysis API (${path})`, models: out };
      } catch (e) {
        console.warn(e.message);
      }
    }
  }
  try {
    const cfg = await loadConfig("scores.json");
    return { source: cfg.source || "config/scores.json", models: cfg.models };
  } catch (e) {
    console.warn("No scores available:", e.message);
    return null;
  }
}

// Join scores to prices. Price priority: alias → OpenRouter id → OpenRouter name match → AA price → previous fixing.
export function joinModels(scores, prices, aliases = {}, previous = null) {
  const prev = new Map((previous?.constituents || []).map((c) => [c.model, c]));
  const models = [], unmatched = [];
  // One entry per model: where a benchmark lists several effort settings, keep the highest score.
  const best = new Map();
  for (const s of scores) { const k = normalise(s.model); if (!best.has(k) || best.get(k).score < s.score) best.set(k, s); }
  for (const s of best.values()) {
    let p = null, src = null;
    const alias = aliases[s.model];
    if (alias && prices?.byId.get(alias)) { p = prices.byId.get(alias); src = "OpenRouter"; }
    if (!p && prices) { p = prices.byName.get(normalise(s.model)) || (s.slug && prices.byName.get(normalise(s.slug))); if (p) src = "OpenRouter"; }
    if (!p && s.aaOutput > 0) { p = { input: s.aaInput >= 0 ? s.aaInput : s.aaOutput / 5, output: s.aaOutput }; src = "Artificial Analysis"; }
    if (!p && s.input != null && s.output > 0) { p = { input: s.input, output: s.output }; src = "config"; }
    if (!p && prev.get(s.model)) { const c = prev.get(s.model); p = { input: c.input, output: c.output }; src = "previous fixing"; }
    if (!p) { unmatched.push(s.model); continue; }
    models.push({ model: s.model, lab: s.lab, score: s.score, input: p.input, output: p.output, priceSource: src });
  }
  return { models, unmatched };
}
