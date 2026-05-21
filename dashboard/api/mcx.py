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

Top-level imports (instead of lazy) so Vercel's Python tracer bundles lib/.
Cold-start delta is negligible (~10-50ms) and worth the deployment correctness.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json, os, sys, traceback

# Module-level imports so Vercel's Python tracer bundles lib/. Wrapped in
# try/except so an import failure surfaces as a 500 with the traceback in the
# body instead of an opaque FUNCTION_INVOCATION_FAILED.
_IMPORT_ERROR = None
_HANDLER_MAP = {}
try:
    from lib.mcx_handlers.refresh     import handler as _RefreshHandler
    from lib.mcx_handlers.history     import handler as _HistoryHandler
    from lib.mcx_handlers.price       import handler as _PriceHandler
    from lib.mcx_handlers.commodities import handler as _CommoditiesHandler
    _HANDLER_MAP = {
        "refresh":     _RefreshHandler,
        "history":     _HistoryHandler,
        "price":       _PriceHandler,
        "commodities": _CommoditiesHandler,
    }
except Exception:
    _IMPORT_ERROR = traceback.format_exc()


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
        return _HANDLER_MAP.get(resource)

    def _delegate(self, method):
        inner_cls = self._resolve_handler()
        if inner_cls is None:
            self._send_error(400, "Invalid resource (expected: refresh|history|price|commodities)")
            return
        target = getattr(inner_cls, f"do_{method}", None)
        if target is None:
            self._send_error(405, f"Method {method} not allowed for this resource")
            return
        # Call the inner method bound to this request handler. BaseHTTPRequestHandler
        # methods only use self.path / headers / rfile / wfile, all live on `self`.
        target(self)

    def _maybe_report_import_error(self):
        """If module-level imports failed, return a 500 with the traceback."""
        if _IMPORT_ERROR is None:
            return False
        cwd = os.getcwd()
        body = json.dumps({
            "success": False,
            "error": "Module import failed at function load",
            "traceback": _IMPORT_ERROR,
            "cwd": cwd,
            "sys_path": sys.path,
            "cwd_listing": sorted(os.listdir(cwd))[:50] if os.path.isdir(cwd) else None,
            "task_listing": sorted(os.listdir("/var/task"))[:50] if os.path.isdir("/var/task") else None,
        }).encode("utf-8")
        self.send_response(500)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return True

    def do_GET(self):
        if self._maybe_report_import_error():
            return
        self._delegate("GET")

    def do_POST(self):
        if self._maybe_report_import_error():
            return
        self._delegate("POST")

    def do_OPTIONS(self):
        inner_cls = self._resolve_handler()
        if inner_cls and getattr(inner_cls, "do_OPTIONS", None):
            inner_cls.do_OPTIONS(self)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
