"""Analiza AI pe multe localități, în loturi (GitHub Actions).

  python lot.py plan  --localitati "Bragadiru, Ilfov;Chiajna, Ilfov" --chunks 10 --out plan.json
  python lot.py run   --plan plan.json --chunk 3 --out part_3.json
  python lot.py merge --parts parts/ --rulare periferie-2026-11-15 --out rezultate/

Fiecare localitate e împărțită în pătrate de CELL_M; păstrăm doar pătratele cu case (amprente Microsoft).
Pentru fiecare pătrat rulează aceeași analiză ca pe site (api_local.analiza): străzi + case + stâlpi din satelit
+ rețea probabilă. Păstrăm doar ce cade în interiorul pătratului (fără dubluri la margini), apoi la merge:
dedublare, verificări, rolul stâlpilor și câte un GeoJSON pe localitate.
"""
import argparse, json, math, os, sys, time, traceback, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

CELL_M = 700
MIN_CASE = 30           # pătrate cu mai puține case nu merită analizate
RAZA = CELL_M / 2       # analiza acoperă pătratul (+40 m margine din api_local)
DET_MIN = float(os.environ.get("LOT_DET_MIN", "0.2"))   # stâlpi doar-din-satelit sub prag nu intră
DEDUP_M = 3.0
URBAN_CASE = int(os.environ.get("LOT_URBAN_CASE", "700"))  # peste atâtea clădiri pe pătrat: blocuri, rețea probabil subterană
BUCURESTI_ILFOV = (25.70, 44.20, 26.50, 44.75)


def kx(lat):
    return 111320 * math.cos(math.radians(lat))


KY = 110540


# ----------------------------------------------------------------------------- plan
def bbox_localitate(nume):
    import run_zone
    url = run_zone.NOMINATIM + "?" + urllib.parse.urlencode({"q": nume, "format": "json", "limit": 1, "countrycodes": "ro"})
    r = json.loads(run_zone.http(url)); time.sleep(1.2)
    if not r:
        raise ValueError(f"nu găsesc {nume}")
    s, n, w, e = map(float, r[0]["boundingbox"])
    w, s, e, n = max(w, BUCURESTI_ILFOV[0]), max(s, BUCURESTI_ILFOV[1]), min(e, BUCURESTI_ILFOV[2]), min(n, BUCURESTI_ILFOV[3])
    return (w, s, e, n)


def osm_localitate(box, out):
    """străzile + clădirile OSM pentru toată localitatea, o singură cerere (nu una pe pătrat)"""
    import run_zone
    os.makedirs(os.path.dirname(out), exist_ok=True)
    w, s_, e, n = box[0] - 0.002, box[1] - 0.002, box[2] + 0.002, box[3] + 0.002
    bb = f"{s_:.6f},{w:.6f},{n:.6f},{e:.6f}"
    q = (f'[out:json][timeout:240][maxsize:536870912];(way["highway"~"residential|living_street|unclassified|tertiary|secondary|primary|service"]({bb});'
         f'way["building"]({bb}););out tags geom;')
    for ep in run_zone.OVERPASS * 2:
        try:
            raw = run_zone.http(ep, data=urllib.parse.urlencode({"data": q}).encode(), timeout=300)
            fc = run_zone.overpass_to_geojson(json.loads(raw))
            json.dump(fc, open(out, "w"), separators=(",", ":"))
            print(f"  OSM: {len(fc['features'])} obiecte -> {out}")
            return
        except Exception as ex:
            print("  Overpass:", ep, ex); time.sleep(10)
    print("  OSM nu a răspuns; pătratele vor încerca live")


def plan(a):
    import cladiri_ms
    cells = []
    for nume in [x.strip() for x in a.localitati.split(";") if x.strip()]:
        try:
            box = bbox_localitate(nume)
        except Exception as e:
            print("sar peste", nume, e); continue
        lat0 = (box[1] + box[3]) / 2
        dlon, dlat = CELL_M / kx(lat0), CELL_M / KY
        cnt = {}
        for f in cladiri_ms.cladiri(box):
            ring = f["geometry"]["coordinates"][0]
            cx = sum(c[0] for c in ring) / len(ring); cy = sum(c[1] for c in ring) / len(ring)
            k = (int((cx - box[0]) / dlon), int((cy - box[1]) / dlat))
            cnt[k] = cnt.get(k, 0) + 1
        loc = nume.split(",")[0].strip()
        if a.osm_dir:
            osm_localitate(box, os.path.join(a.osm_dir, slug(loc) + ".json"))
        keep = 0
        for (i, j), n in sorted(cnt.items()):
            if n < MIN_CASE:
                continue
            w, s = box[0] + i * dlon, box[1] + j * dlat
            cells.append({"id": f"{slug(loc)}-{i:02d}-{j:02d}", "localitate": loc, "case_ms": n,
                          "box": [round(w, 6), round(s, 6), round(w + dlon, 6), round(s + dlat, 6)]})
            keep += 1
        print(f"{loc}: {keep} pătrate cu case (din {len(cnt)})")
    # lotul: pătrate amestecate între localități, ca joburile să termine cam deodată
    cells.sort(key=lambda c: -c["case_ms"])
    k = max(1, min(a.chunks, len(cells)))
    chunks = [cells[i::k] for i in range(k)]
    json.dump({"cells": cells, "chunks": chunks, "cell_m": CELL_M}, open(a.out, "w"), ensure_ascii=False)
    print(f"total: {len(cells)} pătrate în {k} loturi")
    if os.environ.get("GITHUB_OUTPUT"):
        open(os.environ["GITHUB_OUTPUT"], "a").write(f"chunks={json.dumps(list(range(k)))}\n")


def slug(s):
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return "".join(ch if ch.isalnum() else "-" for ch in s).strip("-")


# ----------------------------------------------------------------------------- run
def point_in_ring(pt, ring):
    x, y, ok = pt[0], pt[1], False
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i - 1][:2], ring[i][:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            ok = not ok
    return ok


def inside(c, box):
    return box[0] <= c[0] < box[2] and box[1] <= c[1] < box[3]


def run(a):
    os.environ.setdefault("GRIDTWIN_MS_LIVE", "1")
    import api_local, cladiri_ms
    P = json.load(open(a.plan))
    cells = P["chunks"][a.chunk]
    # case Microsoft citite o singură dată pentru tot lotul (fișierele sunt mari)
    if cells:
        big = (min(c["box"][0] for c in cells) - 0.01, min(c["box"][1] for c in cells) - 0.01,
               max(c["box"][2] for c in cells) + 0.01, max(c["box"][3] for c in cells) + 0.01)
        ms = cladiri_ms.cladiri(big)
        print(f"case Microsoft în lot: {len(ms)}")
        grid = {}
        for f in ms:
            r = f["geometry"]["coordinates"][0]
            grid.setdefault((int(r[0][0] / 0.005), int(r[0][1] / 0.005)), []).append(f)

        def ms_box(box):
            out = []
            for gx in range(int(box[0] / 0.005) - 1, int(box[2] / 0.005) + 2):
                for gy in range(int(box[1] / 0.005) - 1, int(box[3] / 0.005) + 2):
                    for f in grid.get((gx, gy), []):
                        r = f["geometry"]["coordinates"][0]
                        cx = sum(c[0] for c in r) / len(r); cy = sum(c[1] for c in r) / len(r)
                        if box[0] <= cx <= box[2] and box[1] <= cy <= box[3]:
                            out.append(f)
            return out
        api_local.ms_buildings = ms_box

    acceleratii(api_local, a.osm_dir)
    out = {"cells": [], "stalpi": [], "linii": [], "erori": []}
    for n, c in enumerate(cells, 1):
        t0 = time.time()
        box = c["box"]
        lon, lat = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        try:
            TIMP.clear()
            prefetch_dale(lon, lat, RAZA + 60)
            TIMP["dale"] = round(time.time() - t0, 1)
            rez = api_local.analiza(lon, lat, RAZA)
        except Exception as e:
            traceback.print_exc()
            out["erori"].append({"celula": c["id"], "eroare": str(e)[:200]}); continue
        S = rez["straturi"]
        rings = [f["geometry"]["coordinates"][0] for f in S["cladiri"]["features"]]
        verif = {"in_casa": 0, "in_afara": 0}

        def ok_pole(pt):
            if not inside(pt, box):
                verif["in_afara"] += 1; return False
            if any(point_in_ring(pt, r) for r in rings if abs(r[0][0] - pt[0]) < 0.002 and abs(r[0][1] - pt[1]) < 0.002):
                verif["in_casa"] += 1; return False
            return True

        pref = c["id"] + ":"
        prez = []
        for f in S["retea_prezisa"]["features"]:
            p, g = f["properties"], f["geometry"]
            if p.get("kind") == "stalp":
                pt = g["coordinates"]
                if ok_pole(pt):
                    det = p.get("detectie")
                    out["stalpi"].append({"lon": round(pt[0], 7), "lat": round(pt[1], 7),
                                          "sursa": "prezis+satelit" if det else "prezis", "incredere": p.get("incredere"),
                                          "detectie": det, "localitate": c["localitate"], "celula": c["id"], "ext_id": pref + p["id"]})
                    prez.append(pt)
            elif p.get("kind") in ("tronson", "bransament"):
                cs = g["coordinates"]
                mid = cs[len(cs) // 2] if len(cs) > 2 else [(cs[0][0] + cs[-1][0]) / 2, (cs[0][1] + cs[-1][1]) / 2]
                if inside(mid, box):
                    out["linii"].append({"kind": p["kind"], "coords": [[round(x, 7), round(y, 7)] for x, y in cs],
                                         "from": pref + p["from"] if p.get("from") else None,
                                         "to": pref + p["to"] if p.get("to") else (pref + p["pole"] if p.get("pole") else None),
                                         "lungime_m": p.get("lungime_m"), "localitate": c["localitate"]})
        # stâlpi văzuți în satelit care nu au intrat în rețeaua prezisă
        for f in S["detectii"]["features"]:
            pt, conf = f["geometry"]["coordinates"], f["properties"]["conf"]
            if conf < DET_MIN or any(abs(pt[0] - q[0]) < 5e-5 and abs(pt[1] - q[1]) < 4e-5 for q in prez):
                continue
            if ok_pole(pt):
                out["stalpi"].append({"lon": pt[0], "lat": pt[1], "sursa": "satelit", "incredere": conf, "detectie": conf,
                                      "localitate": c["localitate"], "celula": c["id"], "ext_id": None})
        nr = rez["numere"]
        out["cells"].append({**c, "case": nr["case"], "strazi": nr["strazi"], "stalpi_imagine": nr["stalpi_imagine"],
                             "verificari": verif, "durata_s": round(time.time() - t0, 1), "timp": dict(TIMP)})
        print(f"[{n}/{len(cells)}] {c['id']}: {nr['case']} case, {nr['stalpi_imagine']} stâlpi în imagine, "
              f"{nr['stalpi_propusi']} prezisi, scoși: {verif} ({time.time() - t0:.0f} s; {dict(TIMP)})", flush=True)
    json.dump(out, open(a.out, "w"), ensure_ascii=False)



# ----------------------------------------------------------------------------- accelerări pentru loturi
TIMP = {}
_DALE = {}


def prefetch_dale(lon, lat, raza_m, zooms=(18, 17)):
    """descarcă în paralel dalele Esri ale pătratului; modelele le iau apoi din memorie"""
    import run_zone
    from concurrent.futures import ThreadPoolExecutor
    _DALE.clear()
    dlat = raza_m / KY; dlon = raza_m / kx(lat)
    urls = []
    for z in zooms[:1]:
        tx0, ty0 = (int(v) for v in run_zone.tile_xy(lon - dlon, lat + dlat, z))
        tx1, ty1 = (int(v) for v in run_zone.tile_xy(lon + dlon, lat - dlat, z))
        urls += [run_zone.ESRI.format(z=z, x=x, y=y) for x in range(tx0 - 1, tx1 + 2) for y in range(ty0 - 1, ty1 + 2)]

    def one(u):
        for i in range(3):
            try:
                req = urllib.request.Request(u, headers={"User-Agent": run_zone.UA})
                with urllib.request.urlopen(req, timeout=30) as r:
                    return u, r.read()
            except Exception:
                time.sleep(1 + i)
        return u, None
    with ThreadPoolExecutor(16) as ex:
        for u, b in ex.map(one, urls):
            if b:
                _DALE[u] = b


def acceleratii(api_local, osm_dir):
    import run_zone, imagini
    import urllib.request as _ur
    # 1. dalele din memorie (ambele modele le cer, fiecare cu propriul downloader)
    orig_http, orig_get = run_zone.http, imagini.get

    def http(url, data=None, timeout=120, tries=3):
        if data is None and url in _DALE:
            return _DALE[url]
        return orig_http(url, data=data, timeout=timeout, tries=tries)

    def get(url, timeout=30, tries=3):
        return _DALE[url] if url in _DALE else orig_get(url, timeout=timeout, tries=tries)
    run_zone.http, imagini.get = http, get
    imagini.mozaic.__defaults__ = tuple(0 if isinstance(d, float) and d < 1 else d for d in imagini.mozaic.__defaults__)  # fără pauză între dale
    # 2. OSM din fișierul localității, cu index pe grilă
    idx = {}
    if osm_dir and os.path.isdir(osm_dir):
        for fn in os.listdir(osm_dir):
            for f in json.load(open(os.path.join(osm_dir, fn)))["features"]:
                g = f["geometry"]
                cs = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"]
                for k in {(int(x / 0.005), int(y / 0.005)) for x, y in cs}:
                    idx.setdefault(k, []).append(f)
        print(f"OSM local: {sum(len(v) for v in idx.values())} intrări în index")
    orig_osm = api_local.osm_for

    def osm_for(lat, lon, raza, box):
        if not idx:
            return orig_osm(lat, lon, raza, box)
        m = (raza + 60) / KY
        bb = (lon - m * KY / kx(lat), lat - m, lon + m * KY / kx(lat), lat + m)
        seen, out = set(), []
        for gx in range(int(bb[0] / 0.005) - 1, int(bb[2] / 0.005) + 2):
            for gy in range(int(bb[1] / 0.005) - 1, int(bb[3] / 0.005) + 2):
                for f in idx.get((gx, gy), []):
                    if id(f) in seen:
                        continue
                    g = f["geometry"]
                    cs = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"]
                    if any(bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3] for x, y in cs):
                        seen.add(id(f)); out.append(f)
        return out, "OpenStreetMap (descărcat pe localitate)"
    api_local.osm_for = osm_for
    # 3. cronometru pe pași
    for name in ("osm_for", "ms_buildings", "satellite_poles"):
        fn = getattr(api_local, name)

        def wrap(*args, _fn=fn, _n=name, **kw):
            t = time.time()
            try:
                return _fn(*args, **kw)
            finally:
                TIMP[_n] = round(TIMP.get(_n, 0) + time.time() - t, 1)
        setattr(api_local, name, wrap)
    import retea_prezisa, cladiri_ai
    for mod, name in ((retea_prezisa, "prezice"), (cladiri_ai, "cladiri")):
        fn = getattr(mod, name)

        def wrap(*args, _fn=fn, _n=name, **kw):
            t = time.time()
            try:
                return _fn(*args, **kw)
            finally:
                TIMP[_n] = round(TIMP.get(_n, 0) + time.time() - t, 1)
        setattr(mod, name, wrap)

# ----------------------------------------------------------------------------- merge
def merge(a):
    import glob
    cells, stalpi, linii, erori = [], [], [], []
    for p in sorted(glob.glob(os.path.join(a.parts, "**", "*.json"), recursive=True)):
        d = json.load(open(p))
        cells += d["cells"]; stalpi += d["stalpi"]; linii += d["linii"]; erori += d["erori"]
    print(f"pătrate: {len(cells)}, stâlpi: {len(stalpi)}, linii: {len(linii)}, erori: {len(erori)}")

    # zone urbane dense (blocuri): fără rețea prezisă, păstrăm doar ce se vede în satelit
    urban = {c["id"] for c in cells if c["case"] >= URBAN_CASE}
    boxes = {c["id"]: c["box"] for c in cells}

    def cell_of(pt):
        for cid, b in boxes.items():
            if inside(pt, b):
                return cid
        return None
    st2, scoase_urban = [], 0
    for s in stalpi:
        if s["celula"] in urban:
            if s["sursa"] == "prezis":
                scoase_urban += 1; continue
            if s["sursa"] == "prezis+satelit":
                s = {**s, "sursa": "satelit", "incredere": s["detectie"], "ext_id": None}
        st2.append(s)
    stalpi = st2
    li2 = []
    for l in linii:
        cs = l["coords"]
        mid = cs[len(cs) // 2] if len(cs) > 2 else [(cs[0][0] + cs[-1][0]) / 2, (cs[0][1] + cs[-1][1]) / 2]
        if cell_of(mid) in urban:
            continue
        li2.append(l)
    print(f"pătrate urbane dense: {len(urban)}; stâlpi prezisi scoși acolo: {scoase_urban}; linii scoase: {len(linii) - len(li2)}")
    linii = li2

    # verificare: transformarea metri <-> grade dus-întors
    for s in stalpi[:200]:
        x = (s["lon"] - 26) * kx(44.4); y = (s["lat"] - 44.4) * KY
        assert abs(26 + x / kx(44.4) - s["lon"]) < 1e-9 and abs(44.4 + y / KY - s["lat"]) < 1e-9

    # dedublare: prezis > prezis+satelit? păstrăm cel mai sigur; grilă de 3 m
    order = {"prezis+satelit": 0, "prezis": 1, "satelit": 2}
    stalpi.sort(key=lambda s: (order.get(s["sursa"], 3), -(s["incredere"] or 0)))
    grid, keep, alias, dup = {}, [], {}, 0
    for s in stalpi:
        x = (s["lon"] - 26) * kx(44.4); y = (s["lat"] - 44.4) * KY
        gx, gy = int(x // DEDUP_M), int(y // DEDUP_M)
        hit = None
        for i in (gx - 1, gx, gx + 1):
            for j in (gy - 1, gy, gy + 1):
                for k in grid.get((i, j), []):
                    if math.hypot(k[0] - x, k[1] - y) <= DEDUP_M:
                        hit = k[2]; break
        if hit is not None:
            dup += 1
            if s.get("ext_id") and hit.get("ext_id"):
                alias[s["ext_id"]] = hit["ext_id"]
            continue
        grid.setdefault((gx, gy), []).append((x, y, s)); keep.append(s)

    # rolul stâlpilor prezisi, din tronsoanele care pleacă din ei
    deg, dirs = {}, {}
    for l in linii:
        if l["kind"] != "tronson":
            continue
        a_, b_ = alias.get(l["from"], l["from"]), alias.get(l["to"], l["to"])
        cs = l["coords"]
        for pid, p0, p1 in ((a_, cs[0], cs[1]), (b_, cs[-1], cs[-2])):
            if pid:
                deg[pid] = deg.get(pid, 0) + 1
                dirs.setdefault(pid, []).append(math.atan2((p1[1] - p0[1]) * KY, (p1[0] - p0[0]) * kx(44.4)))
    for s in keep:
        if s["sursa"] == "satelit":
            s["rol"] = "izolat"; continue
        d = deg.get(s["ext_id"], 0)
        if d == 0:
            s["rol"] = "izolat"
        elif d == 1:
            s["rol"] = "capat"
        elif d == 2:
            a1, a2 = dirs[s["ext_id"]][:2]
            ang = abs((math.degrees(a1 - a2) + 180) % 360 - 180)
            s["rol"] = "linie" if ang > 150 else "colt"
        else:
            s["rol"] = "derivatie"

    # câte un fișier pe localitate
    os.makedirs(a.out, exist_ok=True)
    locs = sorted({c["localitate"] for c in cells})
    rezumat = []
    for loc in locs:
        sl = [s for s in keep if s["localitate"] == loc]
        ll = [l for l in linii if l["localitate"] == loc]
        cl = [c for c in cells if c["localitate"] == loc]
        feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [s["lon"], s["lat"]]},
                  "properties": {k: s[k] for k in ("sursa", "incredere", "detectie", "rol")}} for s in sl]
        feats += [{"type": "Feature", "geometry": {"type": "LineString", "coordinates": l["coords"]},
                   "properties": {"kind": l["kind"], "lungime_m": l["lungime_m"]}} for l in ll]
        for c in cl:
            if c["id"] in urban:
                w, s_, e, n = c["box"]
                feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[w, s_], [e, s_], [e, n], [w, n], [w, s_]]]},
                              "properties": {"kind": "zona_urbana", "case": c["case"],
                                             "nota": "zonă de blocuri: rețea probabil subterană, arătăm doar stâlpii văzuți în satelit"}})
        f = f"{slug(loc)}.geojson"
        json.dump({"type": "FeatureCollection", "features": feats}, open(os.path.join(a.out, f), "w"), ensure_ascii=False, separators=(",", ":"))
        km = sum(sum(math.hypot((q[0] - p[0]) * kx(p[1]), (q[1] - p[1]) * KY) for p, q in zip(l["coords"], l["coords"][1:]))
                 for l in ll if l["kind"] == "tronson") / 1000
        boxes = [c["box"] for c in cl]
        rezumat.append({"localitate": loc, "fisier": f, "patrate": len(cl), "case": sum(c["case"] for c in cl),
                        "stalpi": len(sl), "stalpi_satelit": sum(1 for s in sl if "satelit" in s["sursa"]),
                        "km_retea_propusa": round(km, 1), "bransamente": sum(1 for l in ll if l["kind"] == "bransament"),
                        "roluri": {r: sum(1 for s in sl if s["rol"] == r) for r in ("linie", "colt", "capat", "derivatie", "izolat")},
                        "bbox": [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)],
                        "scoase_in_casa": sum(c["verificari"]["in_casa"] for c in cl),
                        "patrate_urbane": sum(1 for c in cl if c["id"] in urban)})
        print(f"  {loc}: {len(sl)} stâlpi, {km:.1f} km rețea propusă")
    idx = {"rulare": a.rulare, "data": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()),
           "model": os.environ.get("GRIDTWIN_MODEL", "grid_best_ro_B.pt"),
           "model_case": "cladiri_best.pt" if os.path.exists(os.path.join(HERE, "cladiri_best.pt")) else "OSM + Microsoft",
           "prag_satelit": DET_MIN, "celula_m": CELL_M, "prag_urban_case": URBAN_CASE, "stalpi_prezisi_scosi_urban": scoase_urban, "dubluri_scoase": dup, "erori": erori, "localitati": rezumat,
           "total": {"stalpi": len(keep), "km_retea_propusa": round(sum(r["km_retea_propusa"] for r in rezumat), 1),
                     "case": sum(r["case"] for r in rezumat), "patrate": len(cells)}}
    json.dump(idx, open(os.path.join(a.out, "index.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(idx["total"], ensure_ascii=False))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        t = [f"## Rulare {a.rulare}", "", "| localitate | pătrate | case | stâlpi | din satelit | km rețea | branșamente |", "|---|---|---|---|---|---|---|"]
        t += [f"| {r['localitate']} | {r['patrate']} | {r['case']} | {r['stalpi']} | {r['stalpi_satelit']} | {r['km_retea_propusa']} | {r['bransamente']} |" for r in rezumat]
        t += ["", f"Pătrate urbane dense (fără rețea prezisă): {len(urban)}. Dubluri scoase: {dup}. Stâlpi scoși pentru că picau în case: {sum(r['scoase_in_casa'] for r in rezumat)}. Erori: {len(erori)}."]
        open(os.environ["GITHUB_STEP_SUMMARY"], "a").write("\n".join(t) + "\n")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("--localitati", required=True); p.add_argument("--chunks", type=int, default=10); p.add_argument("--out", default="plan.json"); p.add_argument("--osm-dir", default="osm")
    r = sub.add_parser("run"); r.add_argument("--plan", required=True); r.add_argument("--chunk", type=int, required=True); r.add_argument("--out", required=True); r.add_argument("--osm-dir", default="osm")
    m = sub.add_parser("merge"); m.add_argument("--parts", required=True); m.add_argument("--rulare", required=True); m.add_argument("--out", required=True)
    a = ap.parse_args()
    {"plan": plan, "run": run, "merge": merge}[a.cmd](a)


if __name__ == "__main__":
    main()
