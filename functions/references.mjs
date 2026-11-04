// GET /api/references → comparison indices, GPU rents, throughput and lab weights used by the page.
import { loadConfig } from "../../lib/sources.mjs";

export default async () => {
  const [refs, weights] = await Promise.all([loadConfig("references.json"), loadConfig("weights.json")]);
  return Response.json({ ...refs, weights }, { headers: { "cache-control": "public, max-age=300" } });
};

export const config = { path: "/api/references" };
