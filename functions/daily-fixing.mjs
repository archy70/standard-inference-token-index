// Runs every day at 06:00 UTC (07:00 London in summer). Netlify schedules are always UTC.
import { openStore } from "../../lib/store.mjs";
import { runFixing } from "../../lib/run.mjs";

export default async () => {
  const out = await runFixing({ store: openStore(), env: { AA_API_KEY: Netlify.env.get("AA_API_KEY") } });
  console.log(out.skipped ? `Already fixed for ${out.date}` : `Fixed ${out.fixing.date}: SITB ${out.fixing.sitb} SITF ${out.fixing.sitf} SITC ${out.fixing.sitc}`);
};

export const config = { schedule: "0 6 * * *" };
