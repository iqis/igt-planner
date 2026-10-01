#!/usr/bin/env python3
"""Serve the planner. Static files, project root, so web/ can read ../catalog/.

  py serve.py            -> http://localhost:8791/web/
  py serve.py --port N
"""

import argparse
import http.server
import json
import os
import re
import socketserver
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ANNO = ROOT / "anno"
SKU_RE = re.compile(r"[A-Za-z0-9._-]{1,40}")


class Handler(http.server.SimpleHTTPRequestHandler):
    # Annotation writes are opt-in. The tailnet instance serves guests, and a guest's
    # browser POSTing its (empty) marks over the owner's files is not a malice scenario,
    # it is the default outcome of opening the bench. See do_POST.
    allow_anno = False

    def end_headers(self):
        # The catalog is rebuilt underneath a long-lived tab; a cached copy is a
        # confusing way to debug a scraper. That argument covers the DATA -- it was
        # being applied to the 1.3MB of vendored three.js too, which never changes and
        # was re-downloaded by every phone on every visit. So: no-store for what
        # rebuilds, a day for what is frozen, and revalidation for the app files in
        # between (SimpleHTTPRequestHandler already answers If-Modified-Since with 304,
        # so an edited app.js still shows up on the next reload).
        # getattr, because send_error() runs through here too and parse_request() can call
        # it BEFORE self.path exists (TLS bytes on the plain port, an oversized request
        # line). Bare self.path turned every such 400 into a dropped connection.
        p = getattr(self, "path", "").split("?", 1)[0]
        if p.startswith("/catalog/") or p.startswith("/anno"):
            self.send_header("Cache-Control", "no-store")
        elif p.startswith(("/web/vendor/", "/web/tex/", "/web/img/")):
            self.send_header("Cache-Control", "max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        # The app lives under web/; the project root is served so /web/ assets AND
        # /anno data both resolve, but that means bare "/" hits SimpleHTTPRequestHandler's
        # directory listing instead of the app. Land the root on the app.
        if self.path in ("", "/"):
            self.send_response(302)
            self.send_header("Location", "/web/")
            self.end_headers()
            return
        super().do_GET()

    # The bench POSTs its annotations here so they land on disk in a readable form --
    # points/pairs as mm and px -- instead of living only in the browser's localStorage.
    # One file per part, anno/<sku>.json, so the marks can be read straight off the disk.
    def do_POST(self):
        if self.path.rstrip("/") != "/anno":
            self.send_error(404)
            return
        if not self.allow_anno:
            self.send_error(403, "annotation writes are off -- start serve.py --anno to annotate")
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self.send_error(400, "bad json")
            return
        sku = str(payload.get("sku", "")).strip()
        if not SKU_RE.fullmatch(sku):          # no path traversal via the filename
            self.send_error(400, "bad sku")
            return
        ANNO.mkdir(exist_ok=True)
        (ANNO / f"{sku}.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False), "utf-8")
        self.send_response(204)
        self.end_headers()

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    """One request at a time was fine when the only client was the tab in front of you.

    `TCPServer.serve_forever` handles requests strictly one after another -- that is what the class
    IS, not a tuning question. It stopped being fine the moment this went on the tailnet, where a
    phone, a laptop and a forgotten tab all ask at once, and the planner opens with four catalog
    fetches before it draws anything. One slow client would have been the whole server.

    daemon_threads so Ctrl-C actually exits instead of waiting on whoever is still connected.
    """

    daemon_threads = True
    # Deliberately NOT allow_reuse_address: on Windows it lets a second process bind a port someone
    # else already owns, and then the OTHER server answers your requests. That is a confusing 404 to
    # debug -- failing loudly here is the whole point.
    allow_reuse_address = False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8791)
    # On the tailnet the default bind is right: Tailscale proxies from 127.0.0.1, and this server has
    # no auth of its own, so it should not be reachable from the LAN just because it is reachable
    # from the tailnet.
    ap.add_argument("--host", default="127.0.0.1",
                    help="interface to bind (default 127.0.0.1; use '' for every interface)")
    ap.add_argument("--anno", action="store_true",
                    help="accept POST /anno writes (the part bench). Off by default: the tailnet instance is read-only")
    ap.add_argument("--root", default=str(ROOT),
                    help="directory to serve (default: the repo). `--root dist` serves the public build")
    args = ap.parse_args()
    Handler.allow_anno = args.anno or os.environ.get("IGT_ANNO") == "1"

    try:
        with Server((args.host, args.port), partial(Handler, directory=args.root)) as httpd:
            print(f"IGT planner -> http://localhost:{args.port}/web/")
            httpd.serve_forever()
    except OSError as e:
        raise SystemExit(f"port {args.port} is taken ({e}). Pass --port.")


if __name__ == "__main__":
    main()
