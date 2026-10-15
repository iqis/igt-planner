// The public site's only code: short links, and anonymous counts. Everything else is static assets (dist/), and the
// Worker is not even invoked for them -- wrangler.jsonc routes only /api/* and /s/* through here.
//
//   POST /api/s   body = the #d= payload (gzipped layout JSON, base64url)  ->  { id, url }
//   GET  /s/<id>  -> 302 to /web/#d=<payload>
//   POST /api/e   body = an event name  ->  204 (an anonymous count; see count())
//
// A short link is a pointer to the SAME payload the long link carries, so the app needs nothing new
// to open one, and every short link can be expanded back into a long one that needs no server.
// Ids are content hashes: the same design always gets the same link, and re-sharing costs no write.
// The payload is checked to be a real layout before it is stored -- this is not a pastebin.

const MAX_PAYLOAD = 12000;          // chars of base64url; the app refuses links past 8000 anyway
const ID_LEN = 8;                   // base62: 62^8 = 2e14
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

async function idFor(payload, len) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)));
  let s = "";
  for (let i = 0; s.length < len; i++) s += B62[h[i] % 62];
  return s;
}

async function isLayout(payload) {
  try {
    const bin = Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const out = new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip")));
    const text = await out.text();
    if (text.length > 200000) return false;
    const doc = JSON.parse(text);
    return doc?.app === "igt-planner" && Array.isArray(doc.nodes);
  } catch { return false; }
}

async function mint(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "?";
  if (env.MINT && !(await env.MINT.limit({ key: ip })).success) return json({ error: "slow down" }, 429);
  const payload = (await request.text()).trim();
  if (!payload || payload.length > MAX_PAYLOAD || !/^[A-Za-z0-9_-]+$/.test(payload)) return json({ error: "bad payload" }, 400);
  if (!(await isLayout(payload))) return json({ error: "not a layout" }, 400);
  // A hash collision with a different design is astronomically unlikely; if it happens, lengthen.
  for (let len = ID_LEN; len <= ID_LEN + 4; len += 2) {
    const id = await idFor(payload, len);
    const have = await env.SHORT.get(id);
    if (have === payload) return json({ id });
    if (have == null) {
      await env.SHORT.put(id, payload, { metadata: { at: new Date().toISOString() } });
      return json({ id });
    }
  }
  return json({ error: "could not mint" }, 500);
}

// Counting, not tracking: POST /api/e with an event name ("tour.step.3", "tpl.open.lshape") adds one
// to that name in Workers Analytics Engine. Nothing else is written -- no IP, no id, no cookie, no
// user agent -- so a count can say how far people get through the tour, and never who.
const EVENT = /^[a-z0-9]+(\.[a-z0-9-]+){1,3}$/;
async function count(request, env) {
  const name = (await request.text()).trim();
  if (!EVENT.test(name) || name.length > 48) return new Response(null, { status: 400 });
  const ip = request.headers.get("cf-connecting-ip") || "?";
  if (env.EVT_LIMIT && !(await env.EVT_LIMIT.limit({ key: ip })).success) return new Response(null, { status: 429 });
  env.EVENTS?.writeDataPoint({ blobs: [name], indexes: [name.split(".")[0]] });
  return new Response(null, { status: 204 });
}

async function open(id, url, env) {
  const payload = /^[A-Za-z0-9]{8,12}$/.test(id) ? await env.SHORT.get(id) : null;
  if (!payload) return Response.redirect(`${url.origin}/web/#missing=${encodeURIComponent(id)}`, 302);
  return new Response(null, { status: 302, headers: { location: `/web/#d=${payload}`, "cache-control": "public, max-age=3600" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Plain http never gets an answer, only the way to https. The zone's "Always Use HTTPS" does this
    // at the edge for everything; this is the same rule kept in the code, so it holds without it.
    if (url.protocol === "http:") { url.protocol = "https:"; return Response.redirect(url.toString(), 301); }
    if (url.pathname === "/api/e") {
      return request.method === "POST" ? count(request, env) : new Response(null, { status: 405 });
    }
    if (url.pathname === "/api/s") {
      return request.method === "POST" ? mint(request, env) : json({ error: "POST only" }, 405);
    }
    const m = /^\/s\/([^/]+)\/?$/.exec(url.pathname);
    if (m && (request.method === "GET" || request.method === "HEAD")) return open(m[1], url, env);
    return env.ASSETS.fetch(request);
  },
};
