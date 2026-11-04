// POST /api/run with header "Authorization: Bearer <ADMIN_TOKEN>" → compute today's fixing now.
// Use it once after deploying, and whenever you want to re-run a day (add ?force=1).
import { openStore } from "../../lib/store.mjs";
import { runFixing } from "../../lib/run.mjs";

export default async (req) => {
  const token = Netlify.env.get("ADMIN_TOKEN");
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`) return new Response("Unauthorised", { status: 401 });
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const out = await runFixing({ store: openStore(), env: { AA_API_KEY: Netlify.env.get("AA_API_KEY") }, force });
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};

export const config = { path: "/api/run" };
