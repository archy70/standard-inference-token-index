// Offline test: fake OpenRouter and Artificial Analysis responses, in-memory storage.
import assert from "node:assert/strict";
import { runFixing } from "../lib/run.mjs";
import { memoryStore } from "../lib/store.mjs";
import { capWeights, computeFixing, labKey } from "../lib/sit.mjs";
import { normalise } from "../lib/sources.mjs";

const json = (body) => ({ ok: true, status: 200, json: async () => body });
const perTok = (usdPerM) => String(usdPerM / 1e6);

// OpenRouter: Opus 5.5 cut from $4/$20 to $3/$15; a free model and an unknown model to be ignored.
const openrouter = { data: [
  { id: "anthropic/claude-opus-5.5", name: "Anthropic: Claude Opus 5.5", pricing: { prompt: perTok(3), completion: perTok(15) } },
  { id: "openai/gpt-6.1-terra", name: "OpenAI: GPT-6.1 Terra", pricing: { prompt: perTok(1), completion: perTok(5) } },
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek: DeepSeek V4.1 Flash", pricing: { prompt: perTok(0.15), completion: perTok(0.6) } },
  { id: "some/free-model:free", name: "Some: Free Model", pricing: { prompt: "0", completion: "0" } },
]};

const fetchNoAA = async (url) => { if (url.includes("openrouter.ai")) return json(openrouter); throw new Error("unexpected " + url); };

// 1. Pure pieces
assert.equal(normalise("Anthropic: Claude Opus 5.5 (max)"), "claudeopus55");
assert.equal(labKey("Z AI"), labKey("Z.ai")); assert.equal(labKey("Alibaba"), "qwen");
const w = capWeights({ A: 80, B: 10, C: 10 }, 0.3);
assert.ok(Math.abs(w.A - 1 / 3) < 1e-9, "cap rises to 1/n when three labs");
const w2 = capWeights({ A: 70, B: 10, C: 10, D: 10 }, 0.3);
assert.ok(Math.abs(w2.A - 0.3) < 1e-9 && Math.abs(w2.A + w2.B + w2.C + w2.D - 1) < 1e-9, "capped and sums to 1");

// 2. First run on an empty store: seeds 3 Nov, then writes today's fixing from config scores + OpenRouter prices.
const store = memoryStore();
const now = new Date("2026-11-04T06:00:00Z");
const r1 = await runFixing({ store, fetchFn: fetchNoAA, now });
assert.equal(r1.skipped, false);
const f = r1.fixing;
assert.equal(f.date, "2026-11-04");
for (const k of ["sitb", "sitf", "sitc"]) assert.ok(f[k] > 0, k);
const opus = f.constituents.find((c) => c.model === "Claude Opus 5.5");
assert.equal(opus.input, 3); assert.equal(opus.priceSource, "OpenRouter");
assert.ok(f.sitf < 7.7446, "Opus price cut lowers SITF");
assert.match(f.note, /repriced/);
const hist = await store.history();
assert.deepEqual(hist.map((h) => h.date), ["2026-11-03", "2026-11-04"]);
assert.ok(!("constituents" in hist[1]), "history holds summaries only");

// 3. Same day again: skipped. Forced: rewritten, not duplicated.
assert.equal((await runFixing({ store, fetchFn: fetchNoAA, now })).skipped, true);
await runFixing({ store, fetchFn: fetchNoAA, now, force: true });
assert.equal((await store.history()).length, 2);

// 4. OpenRouter down: prices carried forward, run still completes.
const r4 = await runFixing({ store, fetchFn: async () => { throw new Error("down"); }, now: new Date("2026-11-05T06:00:00Z") });
assert.match(r4.fixing.note, /OpenRouter unreachable/);

// 5. Artificial Analysis path: effort variants collapse to the best score; AA prices used where OpenRouter has none.
const aa = { pagination: { has_more: false }, data: [
  { name: "Claude Opus 5.5 (max)", slug: "claude-opus-5-5", model_creator: { name: "Anthropic" }, evaluations: { artificial_analysis_intelligence_index: 58.4 }, pricing: { price_1m_input_tokens: 4, price_1m_output_tokens: 20 } },
  { name: "Claude Opus 5.5 (low)", slug: "claude-opus-5-5-low", model_creator: { name: "Anthropic" }, evaluations: { artificial_analysis_intelligence_index: 35 }, pricing: { price_1m_input_tokens: 4, price_1m_output_tokens: 20 } },
  { name: "Cheap Model", slug: "cheap", model_creator: { name: "Acme" }, evaluations: { artificial_analysis_intelligence_index: 30 }, pricing: { price_1m_input_tokens: 0.1, price_1m_output_tokens: 0.4 } },
]};
const fetchAA = async (url) => url.includes("openrouter.ai") ? json(openrouter) : json(aa);
const s2 = memoryStore();
const r5 = await runFixing({ store: s2, env: { AA_API_KEY: "test" }, fetchFn: fetchAA, now });
const names = r5.fixing.constituents.map((c) => c.model);
assert.ok(names.includes("Claude Opus 5.5 (max)") && !names.includes("Claude Opus 5.5 (low)"));
assert.equal(r5.fixing.constituents.find((c) => c.model === "Cheap Model").priceSource, "Artificial Analysis");
assert.match(r5.fixing.sources.scores, /Artificial Analysis/);

console.log("All tests passed.");
console.log(`Test fixing 2026-11-04: SITB ${f.sitb}  SITF ${f.sitf}  SITC ${f.sitc}  · ${f.note}`);
