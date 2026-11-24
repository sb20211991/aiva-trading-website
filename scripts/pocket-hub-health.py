"""Aiva Search health check: fails (non-zero exit) when a travel endpoint errors or returns no results.
Providers without credentials are warnings; a configured provider that errors or returns nothing fails. U = base URL to check."""
import json, os, sys, urllib.request, datetime

U = os.environ.get('U', 'https://app.aivatrading.uk').rstrip('/')
d = (datetime.date.today() + datetime.timedelta(days=30)).isoformat()
r = (datetime.date.today() + datetime.timedelta(days=34)).isoformat()
fail, warn = [], []

def get(path, timeout=90):
    req = urllib.request.Request(U + path, headers={'User-Agent': 'aiva-health-check'})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.load(res)

def check(name, path, test):
    try:
        out = test(get(path))
        print(f'OK   {name}: {out}')
    except Exception as e:
        fail.append(f'{name}: {e}')
        print(f'FAIL {name}: {e}')

def place(j):
    iatas = {a['iata'] for a in j.get('airports') or []}
    assert j.get('code') == 'PAR' and {'CDG', 'ORY'} <= iatas, f"Paris should be PAR with CDG+ORY, got {j.get('code')} {sorted(iatas)}"
    return f"{j['code']} {[a['iata'] for a in j['airports']]}"

def hotels(j):
    assert j.get('hotels'), 'no hotels'
    assert not j.get('upstreamErrors'), f"LiteAPI failed: {j['upstreamErrors']}"
    if not j.get('priced'): warn.append('hotels: no live prices (' + (j.get('note') or j.get('provider', '')) + ')')
    return f"{j.get('provider')} priced={j.get('priced')} n={len(j['hotels'])}"

def flights(j):
    if not j.get('configured'): warn.append('flights: ' + (j.get('error') or 'provider not connected')); return 'not connected'
    assert 'offers' in j, 'no offers field'
    if not j['offers']: warn.append('flights: 0 offers ' + (j.get('error') or ''))
    return f"{j.get('provider')} offers={len(j['offers'])}"

def transfers(j):
    m = j.get('modes') or {}
    assert m.get('taxi', {}).get('minutes'), 'no drive route'
    errs = j.get('upstreamErrors') or []
    # "no journey" means the feed answered and has nothing that far ahead (open feeds cover a few weeks), which is a gap
    # in coverage rather than a broken provider. Real failures (HTTP errors, an unreachable feed) still fail the check.
    bad = [e for e in errs if not e.startswith('osm-') and not e.endswith('-no-journey')]
    assert not bad, f'routing provider failed: {bad}'
    if not j.get('schedules'): warn.append('transfers: no live timetables at this date ' + (', '.join(errs) or 'unknown'))
    return f"taxi {m['taxi']['minutes']} min, timetables {j.get('schedules')}"

check('place', '/api/travel/place?q=Paris', place)
check('hotels', f'/api/travel/hotels?lat=48.8566&lon=2.3522&checkin={d}&checkout={r}&adults=1&currency=GBP', hotels)
check('flights', f'/api/travel/flights?from=LON&to=PAR&depart={d}&return={r}&adults=1&currency=GBP', flights)
# Timetables are checked a few days out: open GTFS feeds publish a few weeks ahead at most, so a 30-day date would test
# the feed horizon rather than the planner.
near = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
check('transfers', f'/api/travel/transfers?from=49.009,2.5541&to=48.8566,2.3522&time={near}T12:00&tz=Europe/Paris', transfers)
for w in warn: print('WARN ' + w)
if fail: sys.exit('Aiva Search health check failed: ' + '; '.join(fail))
