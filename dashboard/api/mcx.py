"""
/api/mcx — consolidated MCX router. Dispatches to handlers in lib/mcx_handlers/
based on the `resource` query param.

This consolidates 5 separate MCX Vercel functions (refresh, history, mcxlive,
mcxprice, commodities) into 1 to stay under the Hobby 12-function cap when
combined with NSE/BSE's /api/live and /api/revenue.

Resources:
  refresh      — latest intraday snapshot + projection (read from mcx_snapshots)
  history      — 45-day rolling revenue history
  price        — share price + analytics
  commodities  — per-commodity breakdown

Lazy imports keep cold start light: only the requested resource's module is
loaded per request.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json


class handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass

    def _send_error(self, status, message):
        body = json.dumps({"success": False, "error": message}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _resolve_handler(self):
        qs = parse_qs(urlparse(self.path).query)
        resource = (qs.get("resource") or ["refresh"])[0].lower()
        if resource == "refresh":
            from lib.mcx_handlers.refresh import handler as inner
            return inner
        if resource == "history":
            from lib.mcx_handlers.history import handler as inner
            return inner
        if resource == "price":
            from lib.mcx_handlers.price import handler as inner
            return inner
        if resource == "commodities":
            from lib.mcx_handlers.commodities import handler as inner
            return inner
        return None

    def _delegate(self, method):
        inner_cls = self._resolve_handler()
        if inner_cls is None:
            self._send_error(400, "Invalid resource (expected: refresh|history|price|commodities)")
            return
        # Bind inner methods to self so they use this request's rfile/wfile/headers
        # rather than instantiating a new handler (which would re-parse the socket).
        target = getattr(inner_cls, f"do_{method}", None)
        if target is None:
            self._send_error(405, f"Method {method} not allowed for this resource")
            return
        target(self)

    def do_GET(self):
        self._delegate("GET")

    def do_POST(self):
        self._delegate("POST")

    def do_OPTIONS(self):
        # CORS preflight — delegate to inner if it supports it, else minimal response
        inner_cls = self._resolve_handler()
        if inner_cls and getattr(inner_cls, "do_OPTIONS", None):
            inner_cls.do_OPTIONS(self)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
