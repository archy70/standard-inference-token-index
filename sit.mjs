// Standard Inference Token (SIT) index: the pure calculation.
// Same method as the sample index (v0.1). No network calls here.

export const METHOD = {
  version: "v0.1",
  floor: 25,          // minimum capability score to count at all
  frontierCut: 45,    // SITF from this score up; SITB below it
  anchorB: 30,        // SITB priced as if every model scored 30
  anchorF: 55,        // SITF priced as if every model scored 55
  inputPerOutput: 3,  // workload blend: 3 input tokens per output token
  labCap: 0.30,       // no lab above 30% of a tier
  compositeFrontierShare: 0.30, // SITC = 70% SITB + 30% SITF
};

export function describeMethod(m = METHOD) {
  return `${m.version}: score ≥${m.floor}; SITB ${m.floor}–${m.frontierCut - 1} anchor ${m.anchorB}; ` +
    `SITF ≥${m.frontierCut} anchor ${m.anchorF}; ${m.inputPerOutput}:1 blend; usage weights, ` +
    `${Math.round(m.labCap * 100)}% lab cap; SITC ${Math.round((1 - m.compositeFrontierShare) * 100)}/${Math.round(m.compositeFrontierShare * 100)}`;
}

// Cap each lab's weight and hand the excess to the others, pro rata, until stable.
export function capWeights(shares, cap) {
  const labs = Object.keys(shares);
  if (!labs.length) return {};
  const total = labs.reduce((a, l) => a + shares[l], 0) || labs.length;
  const w = {};
  labs.forEach((l) => (w[l] = (shares[l] || 0) / total || 1 / labs.length));
  const c = Math.max(cap, 1 / labs.length);
  for (let i = 0; i < 50; i++) {
    const over = labs.filter((l) => w[l] > c + 1e-12);
    if (!over.length) break;
    let excess = 0;
    over.forEach((l) => { excess += w[l] - c; w[l] = c; });
    const under = labs.filter((l) => w[l] < c - 1e-12);
    const s = under.reduce((a, l) => a + w[l], 0);
    if (!s) break;
    under.forEach((l) => (w[l] += (excess * w[l]) / s));
  }
  return w;
}

// Lab names differ between sources ("Z.ai" / "Z AI", "Moonshot" / "Moonshot AI", "Qwen" / "Alibaba").
const LAB_ALIASES = { alibaba: "qwen", alibabacloud: "qwen", moonshotai: "moonshot", zhipu: "zai", zhipuai: "zai", metaai: "meta", googledeepmind: "google", mistralai: "mistral" };
export function labKey(name = "") {
  const k = String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
  return LAB_ALIASES[k] || k;
}

// models: [{model, lab, score, input, output}] with prices in USD per 1M tokens.
// labShares: {lab: share %}; labs missing from it get `otherShare` each.
export function computeTier(models, { lo, hi, anchor }, labShares, otherShare, m = METHOD) {
  const qual = models.filter((x) => x.score >= lo && x.score < hi && x.output > 0);
  if (!qual.length) return { index: null, cheapest: null, rows: [] };
  const byLab = {};
  qual.forEach((x) => (byLab[x.lab] ??= []).push(x));
  const keyed = Object.fromEntries(Object.entries(labShares).map(([l, v]) => [labKey(l), v]));
  const shares = {};
  Object.keys(byLab).forEach((l) => (shares[l] = keyed[labKey(l)] ?? otherShare));
  const w = capWeights(shares, m.labCap);
  const rows = [];
  let index = 0;
  for (const [lab, list] of Object.entries(byLab)) {
    for (const x of list) {
      const blended = (m.inputPerOutput * x.input + x.output) / (m.inputPerOutput + 1);
      const perSit = blended * (anchor / x.score);
      const weight = w[lab] / list.length;
      index += weight * perSit;
      rows.push({ ...x, blended, perSit, weight });
    }
  }
  const cheapest = rows.reduce((a, r) => (r.perSit < a.perSit ? r : a), rows[0]);
  return { index, cheapest, rows };
}

const r4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4);

export function computeFixing(date, models, labShares, otherShare, m = METHOD) {
  const B = computeTier(models, { lo: m.floor, hi: m.frontierCut, anchor: m.anchorB }, labShares, otherShare, m);
  const F = computeTier(models, { lo: m.frontierCut, hi: Infinity, anchor: m.anchorF }, labShares, otherShare, m);
  if (B.index == null || F.index == null) throw new Error("A tier has no qualifying models; not writing a fixing.");
  const sitc = (1 - m.compositeFrontierShare) * B.index + m.compositeFrontierShare * F.index;
  return {
    date,
    sitb: r4(B.index), sitf: r4(F.index), sitc: r4(sitc),
    ctdB: r4(B.cheapest.perSit), ctdBModel: B.cheapest.model,
    ctdF: r4(F.cheapest.perSit), ctdFModel: F.cheapest.model,
    nB: B.rows.length, nF: F.rows.length,
    method: describeMethod(m),
    constituents: [...B.rows, ...F.rows]
      .sort((a, b) => b.score - a.score)
      .map((r) => ({ model: r.model, lab: r.lab, score: r.score, input: r4(r.input), output: r4(r.output),
        priceSource: r.priceSource, perSit: r4(r.perSit), weight: r4(r.weight) })),
  };
}

// One line on what moved since the previous fixing.
export function describeChange(prev, next) {
  if (!prev) return "First fixing.";
  const before = new Map((prev.constituents || []).map((c) => [c.model, c]));
  const after = new Map((next.constituents || []).map((c) => [c.model, c]));
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const repriced = [...after.keys()].filter((k) => before.has(k) &&
    (before.get(k).input !== after.get(k).input || before.get(k).output !== after.get(k).output));
  const parts = [];
  if (repriced.length) parts.push(`${repriced.length} repriced (${repriced.slice(0, 3).join(", ")}${repriced.length > 3 ? "…" : ""})`);
  if (added.length) parts.push(`${added.length} added`);
  if (removed.length) parts.push(`${removed.length} dropped`);
  const big = ["sitb", "sitf"].filter((k) => prev[k] && Math.abs(next[k] / prev[k] - 1) > 0.4);
  if (big.length) parts.push(`large move in ${big.join(" and ").toUpperCase()}; check inputs`);
  return parts.length ? parts.join("; ") + "." : "No input changes.";
}
