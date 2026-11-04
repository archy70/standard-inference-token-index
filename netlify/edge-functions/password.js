// Optional password gate. Set SITE_PASSWORD in Netlify to turn it on; leave it unset for a public site.
export default async (req, context) => {
  const pw = Netlify.env.get("SITE_PASSWORD");
  if (!pw) return context.next();
  const url = new URL(req.url);
  if (url.pathname === "/api/run") return context.next(); // has its own token
  const auth = req.headers.get("authorization") || "";
  const [, b64] = auth.split(" ");
  const pass = b64 ? atob(b64).split(":").slice(1).join(":") : "";
  if (pass === pw) return context.next();
  return new Response("Password required", { status: 401, headers: { "www-authenticate": 'Basic realm="SIT index"' } });
};

export const config = { path: "/*" };
