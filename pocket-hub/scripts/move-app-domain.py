"""Move ONLY app.aivatrading.uk from the website Pages project (aiva-trading) to aiva-pocket-hub.
aivatrading.uk and www.aivatrading.uk are never touched. Rolls back domain + DNS if the app does not come up.
Idempotent: exits early when app.aivatrading.uk already serves Pocket Hub. No secrets are printed."""
import json, os, time, urllib.request, urllib.error

ACC = os.environ["CLOUDFLARE_ACCOUNT_ID"].strip()
TOK = os.environ["CLOUDFLARE_API_TOKEN"].strip()
HOST, APP, SITE = "app.aivatrading.uk", "aiva-pocket-hub", "aiva-trading"
API = "https://api.cloudflare.com/client/v4"
MARK = "<title>Aiva Pocket Hub"


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
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"network error {method} {path}: {type(e).__name__}")
        return 0, {}


def page(url):
    try:
        req = urllib.request.Request(url + ("&" if "?" in url else "?") + "cb=" + str(time.time()), headers={"User-Agent": "aiva-deploy-check"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read(200000).decode("utf8", "replace")
    except Exception as e:
        return getattr(e, "code", 0), ""


def domains(project):
    _, r = call("GET", f"/accounts/{ACC}/pages/projects/{project}/domains")
    return {d["name"]: d for d in r.get("result") or []}


def serves_app():
    st, body = page(f"https://{HOST}/")
    return st == 200 and MARK in body


app_domains, site_domains = domains(APP), domains(SITE)
print("pocket hub domains:", {k: v.get("status") for k, v in app_domains.items()})
print("website domains:", {k: v.get("status") for k, v in site_domains.items()})
if app_domains.get(HOST, {}).get("status") == "active" and serves_app():
    print(f"{HOST} already serves Aiva Pocket Hub. Nothing to do.")
    raise SystemExit(0)

st, body = page(f"https://{APP}.pages.dev/")
if st != 200 or MARK not in body:
    raise SystemExit(f"{APP}.pages.dev is not serving Pocket Hub (HTTP {st}); refusing to move {HOST}.")
for must in ("aivatrading.uk", "www.aivatrading.uk"):
    if must not in site_domains:
        print(f"note: {must} is not on {SITE}; leaving it untouched as instructed.")

_, z = call("GET", "/zones?name=aivatrading.uk")
zone = (z.get("result") or [{}])[0].get("id")
old_dns = []
if not zone:
    print("Zone aivatrading.uk not visible to token: DNS left as is, relying on Pages domain verification.")
else:
    st, recs = call("GET", f"/zones/{zone}/dns_records?name={HOST}")
    if st != 200 or not recs.get("success"):
        raise SystemExit(f"Could not read current DNS for {HOST}; nothing changed.")
    old_dns = [r for r in recs.get("result") or [] if r["type"] in ("A", "AAAA", "CNAME")]
for r in old_dns:
    print("dns before:", HOST, r["type"], r["content"], "proxied" if r.get("proxied") else "dns-only")
had_site = HOST in site_domains


def set_dns(target_records):
    for r in call("GET", f"/zones/{zone}/dns_records?name={HOST}")[1].get("result") or []:
        if r["type"] in ("A", "AAAA", "CNAME"):
            call("DELETE", f"/zones/{zone}/dns_records/{r['id']}")
    ok = True
    for r in target_records:
        code, res = call("POST", f"/zones/{zone}/dns_records", {k: r[k] for k in ("type", "name", "content", "proxied", "ttl", "comment") if k in r})
        ok = ok and bool(res.get("success"))
    return ok


def rollback(reason):
    print("ROLLBACK:", reason)
    call("DELETE", f"/accounts/{ACC}/pages/projects/{APP}/domains/{HOST}")
    if had_site:
        call("POST", f"/accounts/{ACC}/pages/projects/{SITE}/domains", {"name": HOST})
    if zone:
        print("dns restored:", set_dns(old_dns))
    raise SystemExit(f"Move failed ({reason}); {HOST} restored to {SITE}.")


if had_site:
    st, _ = call("DELETE", f"/accounts/{ACC}/pages/projects/{SITE}/domains/{HOST}")
    print(f"detached {HOST} from {SITE}:", st == 200)
    if st != 200:
        raise SystemExit("Could not detach domain from website project; nothing changed.")
if HOST not in app_domains:
    st, res = call("POST", f"/accounts/{ACC}/pages/projects/{APP}/domains", {"name": HOST})
    print(f"attached {HOST} to {APP}:", st, res.get("success"))
    if not res.get("success"):
        rollback("attach failed")
if zone:
    if not set_dns([{"type": "CNAME", "name": HOST, "content": f"{APP}.pages.dev", "proxied": True, "ttl": 1, "comment": "Aiva Pocket Hub Pages"}]):
        rollback("dns update failed")
    print("dns set:", HOST, "->", f"{APP}.pages.dev")

deadline = time.time() + 600
status = ""
while time.time() < deadline:
    _, d = call("GET", f"/accounts/{ACC}/pages/projects/{APP}/domains/{HOST}")
    status = (d.get("result") or {}).get("status", "")
    if status == "active" and serves_app():
        print(f"{HOST} is active on {APP} and serves Aiva Pocket Hub.")
        break
    if status in ("error", "blocked"):
        rollback("domain status " + status)
    print("waiting… status:", status, ((d.get("result") or {}).get("verification_data") or {}).get("error_message", ""))
    time.sleep(20)
else:
    rollback("timed out, last status " + status)

for h in ("aivatrading.uk", "www.aivatrading.uk"):
    st, body = page(f"https://{h}/")
    print(h, "HTTP", st, "website" if "Aiva Trading Limited" in body else "UNEXPECTED")
