"""
/api/mcx — consolidated MCX router. Dispatches to handlers in lib/mcx_handlers/
based on the `resource` query param. Resources:
  refresh      — latest intraday snapshot + projection (read from mcx_snapshots)
  history      — 45-day rolling revenue history
  price        — share price + analytics
  commodities  — per-commodity breakdown

This consolidates 5 separate MCX Vercel functions (refresh, history, mcxlive,
mcxprice, commodities) into 1 to stay under the Hobby 12-function cap.

Single-method handler with inline dispatch — matches the shape that worked
during diagnostic at commit 9c76f15.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
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
                body = json.dumps({"success": False, "error": f"Unknown resource: {resource}"}).encode("utf-8")
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            inner.do_GET(self)

        except Exception as e:
            import traceback
            body = json.dumps({
                "success": False,
                "error": str(e)[:300],
                "traceback": traceback.format_exc(),
            }).encode("utf-8")
            try:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception:
                pass

    def do_POST(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            resource = (qs.get("resource") or ["refresh"])[0].lower()
            if resource == "refresh":
                from lib.mcx_handlers.refresh import handler as inner
            else:
                body = json.dumps({"success": False, "error": "POST only valid for resource=refresh"}).encode("utf-8")
                self.send_response(405)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(body)
                return
            inner.do_POST(self)
        except Exception as e:
            import traceback
            body = json.dumps({"success": False, "error": str(e)[:300], "traceback": traceback.format_exc()}).encode("utf-8")
            try:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(body)
            except Exception:
                pass
