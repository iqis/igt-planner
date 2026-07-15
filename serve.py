#!/usr/bin/env python3
"""Serve the planner. Static files, project root, so web/ can read ../catalog/.

  py serve.py            -> http://localhost:8791/web/
  py serve.py --port N
"""

import argparse
import http.server
import json
import re
import socketserver
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ANNO = ROOT / "anno"
SKU_RE = re.compile(r"[A-Za-z0-9._-]{1,40}")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # The catalog is rebuilt underneath a long-lived tab; a cached copy is a
        # confusing way to debug a scraper.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # The bench POSTs its annotations here so they land on disk in a readable form --
    # points/pairs as mm and px -- instead of living only in the browser's localStorage.
    # One file per part, anno/<sku>.json, so the marks can be read straight off the disk.
    def do_POST(self):
        if self.path.rstrip("/") != "/anno":
            self.send_error(404)
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8791)
    args = ap.parse_args()

    # Deliberately NOT setting allow_reuse_address: on Windows it lets a second
    # process bind a port someone else already owns, and then the other server
    # answers your requests. That is a confusing 404 to debug -- better to fail here.
    try:
        with socketserver.TCPServer(("", args.port), partial(Handler, directory=str(ROOT))) as httpd:
            print(f"IGT planner -> http://localhost:{args.port}/web/")
            httpd.serve_forever()
    except OSError as e:
        raise SystemExit(f"port {args.port} is taken ({e}). Pass --port.")


if __name__ == "__main__":
    main()
