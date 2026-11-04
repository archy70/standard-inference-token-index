// GET /api/fixings            → every fixing (summary rows, oldest first)
// GET /api/fixings?date=YYYY-MM-DD → one fixing with its constituents
import { openStore } from "../../lib/store.mjs";

export default async (req) => {
  const store = openStore();
  const date = new URL(req.url).searchParams.get("date");
  const body = date ? await store.fixing(date) : await store.history();
  if (date && !body) return Response.json({ error: "No fixing for that date." }, { status: 404 });
  return Response.json(body, { headers: { "cache-control": "public, max-age=300" } });
};

export const config = { path: "/api/fixings" };
