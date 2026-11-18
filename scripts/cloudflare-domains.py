"""Attach aivatrading.uk and www.aivatrading.uk to the aiva-trading Pages project and point DNS at it.
Prints the before/after state (no secrets). Leaves app.aivatrading.uk untouched."""
import json, os, urllib.request, urllib.error

ACC = os.environ["CLOUDFLARE_ACCOUNT_ID"].strip()
TOK = os.environ["CLOUDFLARE_API_TOKEN"].strip()
PROJECT = os.environ.get("PROJECT", "aiva-trading")
API = "https://api.cloudflare.com/client/v4"
TARGET = PROJECT + ".pages.dev"


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            p = json.loads(e.read() or b"{}")
        except Exception:
            p = {}
        print(f"HTTP {e.code} {method} {path} errors={[(x.get('code'), x.get('message')) for x in p.get('errors', [])]}")
        return e.code, p


dom_base = f"/accounts/{ACC}/pages/projects/{PROJECT}/domains"
_, p = call("GET", dom_base)
existing = {d["name"]: d for d in p.get("result") or []}
for name, d in existing.items():
    print("before:", name, d.get("status"), (d.get("verification_data") or {}).get("error_message", ""))

_, z = call("GET", "/zones?name=aivatrading.uk")
zones = z.get("result") or []
zone = zones[0]["id"] if zones else None
print("zone found:", bool(zone))
if zone:
    _, routes = call("GET", f"/zones/{zone}/workers/routes")
    for r in routes.get("result") or []:
        print("worker route:", r.get("pattern"), "->", r.get("script"))
    for host in ("aivatrading.uk", "www.aivatrading.uk"):
        _, recs = call("GET", f"/zones/{zone}/dns_records?name={host}")
        recs = recs.get("result") or []
        for r in recs:
            print("dns before:", host, r["type"], r["content"], "proxied" if r.get("proxied") else "dns-only")
        if any(r["type"] == "CNAME" and r["content"] == TARGET for r in recs):
            continue
        for r in recs:
            if r["type"] in ("A", "AAAA", "CNAME"):
                call("DELETE", f"/zones/{zone}/dns_records/{r['id']}")
        code, res = call("POST", f"/zones/{zone}/dns_records",
                         {"type": "CNAME", "name": host, "content": TARGET, "proxied": True, "ttl": 1,
                          "comment": "Aiva Pages (square checkout)"})
        print("dns set:", host, "->", TARGET, code, res.get("success"))

for host in ("aivatrading.uk", "www.aivatrading.uk"):
    d = existing.get(host)
    if d and d.get("status") in ("deactivated", "error", "blocked"):
        call("DELETE", f"{dom_base}/{host}")
        d = None
    if not d:
        code, res = call("POST", dom_base, {"name": host})
        print("attach:", host, code, (res.get("result") or {}).get("status"))
    else:
        call("PATCH", f"{dom_base}/{host}")  # retry validation

_, p = call("GET", dom_base)
for d in p.get("result") or []:
    print("after:", d["name"], d.get("status"), (d.get("verification_data") or {}).get("error_message", ""))
