"""Bounded read-only inventory. Print resource names/status, never secret values."""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
if not re.fullmatch(r"[a-fA-F0-9]{32}", account) or not token:
    raise SystemExit("Cloudflare inventory unavailable: deployment credential configuration missing.")


def get(path):
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4" + path,
        headers={"Authorization": "Bearer " + token},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            payload = json.load(response)
        if payload.get("success") is not True:
            return None
        return payload.get("result")
    except urllib.error.HTTPError as error:
        print("INVENTORY_READ_BLOCKED", path.split("?")[0], "HTTP", error.code)
    except Exception:
        print("INVENTORY_READ_UNAVAILABLE", path.split("?")[0])
    return None


prefix = "/accounts/" + account
pages_projects = []
for page in range(1, 4):
    batch = get(prefix + "/pages/projects?" + urllib.parse.urlencode({"page": page, "per_page": 10}))
    if not isinstance(batch, list):
        break
    pages_projects.extend(batch)
    if len(batch) < 10:
        break
    if page == 3:
        print("PAGES_INVENTORY_TRUNCATED_AT", 30)
print("PAGES_PROJECTS_INSPECTED", len(pages_projects))
for item in pages_projects:
    name = item.get("name", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
        continue
    print("EXISTING_PAGES_PROJECT", json.dumps({
        "name": name,
        "domains": item.get("domains"),
        "production_branch": item.get("production_branch"),
        "production_url": (item.get("canonical_deployment") or {}).get("url"),
        "repository": (item.get("source") or {}).get("config", {}).get("repo_name"),
    }))
    registered = get(prefix + "/pages/projects/" + name + "/domains")
    if isinstance(registered, list):
        print("PAGES_REGISTERED_DOMAINS", name, json.dumps([
            {"name": domain.get("name"), "status": domain.get("status")}
            for domain in registered
        ]))
        if any(domain.get("name") == "aivatrading.uk" for domain in registered):
            details = get(prefix + "/pages/projects/" + name)
            if isinstance(details, dict):
                for environment, config in (details.get("deployment_configs") or {}).items():
                    print("ROOT_PROJECT_PAYMENT_CONFIGURATION", name, environment, json.dumps({
                        "variables": {key: value.get("type") for key, value in (config.get("env_vars") or {}).items()
                                      if key.startswith(("STRIPE_", "CHECKOUT_"))},
                        "database_bindings": sorted((config.get("d1_databases") or {}).keys()),
                    }))
project = get(prefix + "/pages/projects/aiva-trading")
if isinstance(project, dict):
    print("PAGES_TARGET", json.dumps({
        "name": project.get("name"),
        "subdomain": project.get("subdomain"),
        "production_branch": project.get("production_branch"),
        "domains": project.get("domains"),
    }))
    names = (
        "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_TEST_ORIGIN",
        "STRIPE_TEST_CHECKOUT_ENABLED", "STRIPE_MODE", "STRIPE_LIVE_SECRET_KEY",
        "STRIPE_LIVE_WEBHOOK_SECRET", "STRIPE_LIVE_PAYMENTS_APPROVED",
    )
    for environment in ("preview", "production"):
        config = (project.get("deployment_configs") or {}).get(environment) or {}
        variables = config.get("env_vars") or {}
        print("PAYMENT_CONFIGURATION", environment, json.dumps({
            "variables": {name: (variables[name].get("type") if name in variables else "MISSING")
                          for name in names},
            "database_bindings": sorted((config.get("d1_databases") or {}).keys()),
        }))

databases = get(prefix + "/d1/database")
if isinstance(databases, list):
    print("DATABASE_INVENTORY_FIRST_PAGE", json.dumps([
        {"name": item.get("name"), "uuid": item.get("uuid")} for item in databases
    ]))
domains = get(prefix + "/workers/domains")
if isinstance(domains, list):
    print("WORKER_DOMAIN_TARGETS", json.dumps([
        {key: item.get(key) for key in ("hostname", "service", "environment")}
        for item in domains if item.get("hostname") in ("aivatrading.uk", "www.aivatrading.uk", "app.aivatrading.uk")
    ]))
zones = get("/zones?name=aivatrading.uk")
if isinstance(zones, list):
    print("APEX_ZONE_MATCH_COUNT", len(zones))
if isinstance(zones, list) and len(zones) == 1:
    zone_id = zones[0].get("id", "")
    if re.fullmatch(r"[a-f0-9]{32}", zone_id):
        records = get("/zones/" + zone_id + "/dns_records?name=aivatrading.uk")
        if isinstance(records, list):
            print("APEX_DNS_TARGETS", json.dumps([
                {key: item.get(key) for key in ("type", "name", "content", "proxied")}
                for item in records if item.get("type") in ("A", "AAAA", "CNAME")
            ]))
        routes = get("/zones/" + zone_id + "/workers/routes")
        if isinstance(routes, list):
            print("WORKER_ROUTE_TARGETS", json.dumps([
                {key: item.get(key) for key in ("pattern", "script")} for item in routes
            ]))
print("INVENTORY_FINISHED_READ_ONLY")
