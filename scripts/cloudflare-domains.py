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


print("account is dashboard account b2c18cf1...:", ACC == "b2c18cf1451c6d64889a0b1f6e885f33")
_, v = call("GET", "/user/tokens/verify")
print("token status:", (v.get("result") or {}).get("status"))
_, za = call("GET", "/zones?per_page=50")
print("zones visible to token:", [(x.get("name"), x.get("account", {}).get("id") == ACC) for x in za.get("result") or []])
_, ws = call("GET", f"/accounts/{ACC}/workers/scripts")
print("workers scripts:", [x.get("id") for x in ws.get("result") or []])
_, wd = call("GET", f"/accounts/{ACC}/workers/domains")
for d in wd.get("result") or []:
    print("worker custom domain:", d.get("hostname"), "->", d.get("service"), d.get("environment"))
    if d.get("hostname") in ("aivatrading.uk", "www.aivatrading.uk") and os.environ.get("DETACH_WORKER_DOMAINS") == "1":
        st, _ = call("DELETE", f"/accounts/{ACC}/workers/domains/{d.get('id')}")
        print("  detached from worker:", st == 200)

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
        removed = []
        for r in recs:
            if r["type"] in ("A", "AAAA", "CNAME"):
                st, _ = call("DELETE", f"/zones/{zone}/dns_records/{r['id']}")
                if st == 200:
                    removed.append(r)
        code, res = call("POST", f"/zones/{zone}/dns_records",
                         {"type": "CNAME", "name": host, "content": TARGET, "proxied": True, "ttl": 1,
                          "comment": "Aiva Pages"})
        print("dns set:", host, "->", TARGET, code, res.get("success"))
        if not res.get("success"):
            for r in removed:
                rc, rr = call("POST", f"/zones/{zone}/dns_records", {k: r[k] for k in ("type", "name", "content", "proxied", "ttl") if k in r})
                print("dns restored:", host, r["type"], r["content"], rc, rr.get("success"))
            raise SystemExit(f"DNS replacement failed for {host}; previous records restored.")

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
