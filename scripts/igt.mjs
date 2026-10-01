#!/usr/bin/env node
// The planner's rules from a terminal -- for you, for a script, or for your own agent (Claude Code,
// Codex, anything that can run a command). Same engine as the web app (web/core.js), no browser.
//
//   node scripts/igt.mjs parts [query] [--role frame]     find parts: sku, name, size, span, weight
//   node scripts/igt.mjs evaluate layout.json             is it buildable? bill, weight, what fits next
//   node scripts/igt.mjs link layout.json                 a planner URL that opens the design
//   node scripts/igt.mjs example                          a small valid layout to start from
//
// A layout file is the planner's own JSON (export one from the layouts menu to see a real one).
// "-" reads it from stdin. Output is JSON. --site sets the planner base URL for `link`.

import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../web/core.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const cat = f => JSON.parse(readFileSync(join(ROOT, "catalog", f), "utf8"));
core.loadCatalog({
  catalog: cat("igt-catalog.json"), colors: cat("colors.json"),
  textures: cat("textures.json"), fittings: cat("frame_fittings.json"),
});

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args.splice(i, 2)[1]; };
const site = flag("--site", "https://igt.gardenplace.cc/web/");
const role = flag("--role", "");
const [cmd, arg] = args;
const out = v => process.stdout.write(JSON.stringify(v, null, 2) + "\n");
const readDoc = f => JSON.parse(f === "-" || !f ? readFileSync(0, "utf8") : readFileSync(f, "utf8"));

const EXAMPLE = {
  app: "igt-planner", v: 1,
  nodes: [
    { i: 1, sku: "CK-150", leg: "CK-114", x: 0, z: 0, rot: 0,
      placements: [{ sku: "GS-450R-US", span: 2, start: 0 }] },
    { i: 2, sku: "CK-116TR", host: 1, edge: "end+x" },
  ],
};

switch (cmd) {
  case "parts": out(core.listParts({ query: arg || "", role })); break;
  case "evaluate": out(core.evaluate(readDoc(arg))); break;
  case "link": {
    const doc = readDoc(arg);
    core.readLayout(doc);                       // throws on a file the planner would refuse
    const b64u = gzipSync(JSON.stringify(doc)).toString("base64url");
    out({ url: `${site}#d=${b64u}` });
    break;
  }
  case "example": out(EXAMPLE); break;
  default:
    process.stderr.write("usage: igt.mjs parts [query] [--role R] | evaluate FILE | link FILE | example\n");
    process.exit(2);
}
