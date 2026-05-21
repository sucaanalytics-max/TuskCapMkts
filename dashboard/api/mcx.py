"""
/api/mcx — consolidated MCX router. Dispatches to handlers in lib/mcx_handlers/
based on the `resource` query param.

Resources:
  refresh      — latest intraday snapshot + projection (read from mcx_snapshots)
  history      — 45-day rolling revenue history
  price        — share price + analytics
  commodities  — per-commodity breakdown

The inner handlers call `self.send_json(...)` and `self._cors()` — helpers that
each inner class defines on itself. Since we pass our router's `Handler`
instance as `self` to the inner do_GET, those helpers must also live on the
router class. Definitions below mirror the ones in lib/mcx_handlers/*.py.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json


class handler(BaseHTTPRequestHandler):

    # ── Helpers expected by inner handlers ──────────────────────────────────

    def _cors(self):
        # Permissive CORS — the dashboard is same-origin so this is mostly
        # defensive. Lazy-import to avoid module-load issues on Vercel.
        try:
            from lib.mcx_config import make_cors_headers
            origin = self.headers.get("Origin", "")
            hdrs = make_cors_headers(origin)
            for k, v in hdrs.items():
                self.send_header(k, v)
        except Exception:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, data, status=200):
        body = json.dumps(data, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass

    # ── Dispatch ────────────────────────────────────────────────────────────

    def _dispatch(self, method):
        try:
            qs = parse_qs(urlparse(self.path).query)
            resource = (qs.get("resource") or ["refresh"])[0].lower()
            if resource == "refresh":
                from lib.mcx_handlers.refresh import handler as inner
            elif resource == "history":
                from lib.mcx_handlers.history import handler as inner
            elif resource == "price":
                from lib.mcx_handlers.price import handler as inner
            elif resource == "commodities":
                from lib.mcx_handlers.commodities import handler as inner
            else:
                self.send_json({"success": False, "error": f"Unknown resource: {resource}"}, 400)
                return

            target = getattr(inner, f"do_{method}", None)
            if target is None:
                self.send_json({"success": False, "error": f"Method {method} not allowed for {resource}"}, 405)
                return
            target(self)

        except Exception as e:
            import traceback
            try:
                self.send_json({
                    "success": False,
                    "error": str(e)[:300],
                    "traceback": traceback.format_exc(),
                }, 500)
            except Exception:
                pass

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()
