// One daily run: gather inputs, compute, store. Safe to call twice in a day (second call is a no-op unless forced).
import { computeFixing, describeChange, METHOD } from "./sit.mjs";
import { fetchOpenRouterPrices, fetchScores, joinModels, loadConfig } from "./sources.mjs";

const summary = ({ constituents, ...rest }) => rest;

export function londonDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export async function runFixing({ store, env = {}, fetchFn = fetch, now = new Date(), force = false }) {
  const date = londonDate(now);
  let history = await store.history();

  if (!history.length) {
    const seed = await loadConfig("seed-fixing.json").catch(() => null);
    if (seed) { await store.saveFixing(seed); history = [summary(seed)]; await store.saveHistory(history); }
  }
  if (!force && history.some((h) => h.date === date)) return { skipped: true, date };

  const lastSummary = history.filter((h) => h.date < date).at(-1) || null;
  const previous = lastSummary ? await store.fixing(lastSummary.date) : null;

  const [prices, scored, weights, aliases, refs] = await Promise.all([
    fetchOpenRouterPrices(fetchFn),
    fetchScores(env, fetchFn),
    loadConfig("weights.json"),
    loadConfig("aliases.json").catch(() => ({})),
    loadConfig("references.json").catch(() => null),
  ]);
  if (!scored) throw new Error("No capability scores available; not writing a fixing.");

  const { models, unmatched } = joinModels(scored.models, prices, aliases, previous);
  const fixing = computeFixing(date, models, weights.shares, weights.otherShare, METHOD);
  const notes = [describeChange(previous, fixing)];
  if (!prices) notes.push("OpenRouter unreachable; prices carried forward.");
  if (unmatched.length) notes.push(`${unmatched.length} scored models had no price.`);
  fixing.note = notes.join(" ");
  fixing.sources = { scores: scored.source, prices: prices ? `OpenRouter (${prices.count} models)` : "carried forward", weights: weights.asOf };
  fixing.unmatched = unmatched;
  fixing.weights = { shares: weights.shares, otherShare: weights.otherShare, asOf: weights.asOf };
  // A copy of the comparison indices as they stood today, so the page can chart SIT against them over time.
  if (refs) fixing.refs = { asOf: refs.asOf, tokenIndices: refs.tokenIndices, gpuRent: refs.gpuRent };

  await store.saveFixing(fixing);
  history = history.filter((h) => h.date !== date).concat(summary(fixing)).sort((a, b) => (a.date < b.date ? -1 : 1));
  await store.saveHistory(history);
  return { skipped: false, fixing };
}
