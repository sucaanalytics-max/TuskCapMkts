"""Minimal test handler to isolate FUNCTION_INVOCATION_FAILED root cause.
Will be replaced once we know which import is the problem.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        body = {
            "ok": True,
            "stage": "minimal_handler",
            "python_version": sys.version,
            "cwd": os.getcwd(),
            "sys_path": sys.path[:10],
            "var_task_files": sorted(os.listdir("/var/task"))[:30] if os.path.isdir("/var/task") else None,
        }
        # Probe each import in isolation and report which fails.
        probes = {}
        for mod in [
            "lib",
            "lib.mcx_config",
            "lib.mcx_handlers",
            "lib.mcx_handlers.refresh",
            "lib.mcx_handlers.history",
            "lib.mcx_handlers.price",
            "lib.mcx_handlers.commodities",
        ]:
            try:
                __import__(mod)
                probes[mod] = "ok"
            except Exception as e:
                probes[mod] = f"{type(e).__name__}: {str(e)[:200]}"
        body["import_probes"] = probes

        payload = json.dumps(body, default=str).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
