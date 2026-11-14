"""Validare: compară stâlpii găsiți de AI în satelit cu stâlpi reali.

Surse de adevăr:
  1. PTAB 7812 (datele companiei, KMZ). Atenție: o parte din zonă a fost folosită la antrenarea modelului,
     deci cifrele de aici sunt optimiste.
  2. OpenStreetMap power=pole în Ilfov, cartografiați de voluntari. Independent de model.
     OSM nu are toți stâlpii, deci precizia măsurată aici e o limită de jos.

Precizia se calculează doar pentru detecțiile aflate la max 15 m de o linie cunoscută (altfel am număra
ca greșeli stâlpii reali din rețelele vecine, care nu sunt în datele de adevăr).

    python valideaza.py --out validare
"""
import argparse, json, math, os, sys, time, urllib.parse

os.environ.setdefault("GRIDTWIN_CONF", "0.05")   # luăm toate detecțiile, alegem pragul după
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import api_local, run_zone  # noqa: E402

MATCH_M = 10.0
NEAR_LINE_M = 15.0
ILFOV = (25.70, 44.20, 26.50, 44.75)       # lon0, lat0, lon1, lat1
CELL_M = 1000
MAX_CELLS = 6
MIN_POLES = 8


# ----------------------------------------------------------------------------- geometrie
class Proj:
    def __init__(self, lon0, lat0):
        self.lon0, self.lat0 = lon0, lat0
        self.kx = 111320 * math.cos(math.radians(lat0)); self.ky = 110540

    def xy(self, c):
        return ((c[0] - self.lon0) * self.kx, (c[1] - self.lat0) * self.ky)


def seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def near_lines(p, lines, r):
    return any(seg_dist(p, l[i], l[i + 1]) <= r for l in lines for i in range(len(l) - 1))


def dedup(pts, r):
    out = []
    for p in pts:
        if all(math.hypot(p[0] - q[0], p[1] - q[1]) > r for q in out):
            out.append(p)
    return out


def match(dets, truth, r):
    """greedy după distanță -> perechi (i_det, i_truth, d)"""
    pairs = sorted((math.hypot(d[0] - t[0], d[1] - t[1]), i, j)
                   for i, d in enumerate(dets) for j, t in enumerate(truth))
    ud, ut, out = set(), set(), []
    for d, i, j in pairs:
        if d > r:
            break
        if i in ud or j in ut:
            continue
        ud.add(i); ut.add(j); out.append((i, j, d))
    return out


# ----------------------------------------------------------------------------- zone de adevăr
def zona_ptab():
    fc = json.load(open(os.path.join(HERE, "zones", "ptab7812", "data", "gis_company.geojson"), encoding="utf-8"))
    pts, lines = [], []
    for f in fc["features"]:
        g, p = f["geometry"], f["properties"]
        if g["type"] == "Point" and (p.get("kind") == "stalp" or p.get("rol") == "capat_aerian"):
            pts.append((g["coordinates"], p.get("rol", "stalp")))
        elif g["type"] == "LineString" and p.get("kind") == "tronson":
            lines.append(g["coordinates"])
    xs = [c[0] for c, _ in pts]; ys = [c[1] for c, _ in pts]
    box = (min(xs) - 0.0003, min(ys) - 0.0002, max(xs) + 0.0003, max(ys) + 0.0002)
    return {"nume": "PTAB 7812 (date companie; parțial văzută la antrenare)", "box": box,
            "stalpi": pts, "linii": lines, "independent": False}


def zone_osm():
    q = (f"[out:json][timeout:120];(node[\"power\"=\"pole\"]({ILFOV[1]},{ILFOV[0]},{ILFOV[3]},{ILFOV[2]});"
         f"way[\"power\"~\"^(minor_line|line)$\"]({ILFOV[1]},{ILFOV[0]},{ILFOV[3]},{ILFOV[2]}););out geom;")
    j = None
    for ep in run_zone.OVERPASS:
        try:
            j = json.loads(run_zone.http(ep, data=urllib.parse.urlencode({"data": q}).encode(), timeout=200))
            break
        except Exception as e:
            print("Overpass:", ep, e)
    if j is None:
        print("Overpass nu a răspuns, sar peste OSM"); return []
    poles = [(el["lon"], el["lat"]) for el in j["elements"] if el["type"] == "node"]
    lines = [[(p["lon"], p["lat"]) for p in el["geometry"]] for el in j["elements"] if el["type"] == "way" and "geometry" in el]
    print(f"OSM Ilfov: {len(poles)} stâlpi, {len(lines)} linii")
    P = Proj(ILFOV[0], ILFOV[1])
    cells = {}
    for c in poles:
        x, y = P.xy(c)
        cells.setdefault((int(x // CELL_M), int(y // CELL_M)), []).append(c)
    best = sorted(cells.items(), key=lambda kv: -len(kv[1]))
    zones, used = [], []
    for (cx, cy), pts in best:
        if len(pts) < MIN_POLES or len(zones) >= MAX_CELLS:
            break
        if any(abs(cx - ux) <= 2 and abs(cy - uy) <= 2 for ux, uy in used):
            continue          # zone depărtate între ele, ca să acopere locuri diferite
        used.append((cx, cy))
        lon0 = ILFOV[0] + cx * CELL_M / P.kx; lat0 = ILFOV[1] + cy * CELL_M / P.ky
        box = (lon0, lat0, lon0 + CELL_M / P.kx, lat0 + CELL_M / P.ky)
        cl = [l for l in lines if any(box[0] - 0.001 <= x <= box[2] + 0.001 and box[1] - 0.001 <= y <= box[3] + 0.001 for x, y in l)]
        zones.append({"nume": f"OSM {lat0 + CELL_M / P.ky / 2:.4f},{lon0 + CELL_M / P.kx / 2:.4f}", "box": box,
                      "stalpi": [(c, "osm") for c in pts], "linii": cl, "independent": True})
    return zones


# ----------------------------------------------------------------------------- evaluare
def evalueaza(z):
    t0 = time.time()
    dets, zoom, model = api_local.satellite_poles(z["box"])
    P = Proj((z["box"][0] + z["box"][2]) / 2, (z["box"][1] + z["box"][3]) / 2)
    truth = dedup([P.xy(c) for c, _ in z["stalpi"]], 2.0)
    lines = [[P.xy(c) for c in l] for l in z["linii"]]
    D = [(*P.xy((lo, la)), c) for lo, la, c in dets]
    D_near = [d for d in D if near_lines(d[:2], lines, NEAR_LINE_M)]
    print(f"  {z['nume']}: {len(truth)} stâlpi reali, {len(D)} detecții ({len(D_near)} lângă linii), {time.time() - t0:.0f} s")
    return {"nume": z["nume"], "independent": z["independent"], "box": z["box"], "truth": truth,
            "dets": D, "dets_near": D_near, "P": P, "zoom": zoom}


def scor(results, thr, shift=(0.0, 0.0)):
    tp = fp = fn = 0; dist = []; vec = []
    for r in results:
        dn = [(d[0] - shift[0], d[1] - shift[1]) for d in r["dets_near"] if d[2] >= thr]
        m = match(dn, r["truth"], MATCH_M)
        tp += len(m); fp += len(dn) - len(m); fn += len(r["truth"]) - len(m)
        for i, j, d in m:
            dist.append(d); vec.append((dn[i][0] - r["truth"][j][0], dn[i][1] - r["truth"][j][1]))
    p = tp / max(tp + fp, 1); rc = tp / max(tp + fn, 1); f1 = 2 * p * rc / max(p + rc, 1e-9)
    dist.sort()
    med = dist[len(dist) // 2] if dist else None
    return {"prag": thr, "tp": tp, "fp": fp, "fn": fn, "precizie": round(p, 3), "recall": round(rc, 3), "f1": round(f1, 3),
            "eroare_mediana_m": round(med, 2) if med is not None else None,
            "sub_3m": round(sum(d <= 3 for d in dist) / max(len(dist), 1), 3),
            "sub_5m": round(sum(d <= 5 for d in dist) / max(len(dist), 1), 3),
            "decalaj_mediu_m": [round(sum(v[0] for v in vec) / max(len(vec), 1), 2), round(sum(v[1] for v in vec) / max(len(vec), 1), 2)]}


def raport(results, eticheta):
    if not results:
        return None
    grid = [scor(results, t / 100) for t in range(5, 60, 5)]
    best = max(grid, key=lambda s: s["f1"])
    # decalajul: estimat pe jumătate din zone, aplicat pe cealaltă jumătate (fără să ne mințim singuri)
    shifted = None
    if len(results) >= 2:
        a, b = results[::2], results[1::2]
        sh = scor(a, best["prag"])["decalaj_mediu_m"]
        shifted = {"decalaj_aplicat_m": sh, "fara": scor(b, best["prag"]), "cu": scor(b, best["prag"], tuple(sh))}
    return {"eticheta": eticheta, "zone": [r["nume"] for r in results], "cel_mai_bun_prag": best,
            "toate_pragurile": grid, "corectie_decalaj": shifted}


def geojson(results, thr):
    feats = []
    for r in results:
        P = r["P"]
        ll = lambda x, y: [round(P.lon0 + x / P.kx, 7), round(P.lat0 + y / P.ky, 7)]
        dn = [d for d in r["dets_near"] if d[2] >= thr]
        m = match([d[:2] for d in dn], r["truth"], MATCH_M)
        mi = {i for i, _, _ in m}; mj = {j for _, j, _ in m}
        for j, t in enumerate(r["truth"]):
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": ll(*t)},
                          "properties": {"tip": "real", "gasit": j in mj, "zona": r["nume"]}})
        for i, d in enumerate(dn):
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": ll(d[0], d[1])},
                          "properties": {"tip": "ai", "conf": round(d[2], 3), "corect": i in mi, "zona": r["nume"]}})
        for i, j, d in m:
            feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [ll(*dn[i][:2]), ll(*r["truth"][j])]},
                          "properties": {"tip": "potrivire", "distanta_m": round(d, 2), "zona": r["nume"]}})
    return {"type": "FeatureCollection", "features": feats}


def md(rep):
    if not rep:
        return ""
    b = rep["cel_mai_bun_prag"]
    s = [f"### {rep['eticheta']}", f"Zone: {', '.join(rep['zone'])}", "",
         "| prag | precizie | recall | F1 | eroare mediană | sub 3 m | sub 5 m | decalaj mediu (x,y) |",
         "|---|---|---|---|---|---|---|---|",
         f"| {b['prag']} | {b['precizie']} | {b['recall']} | {b['f1']} | {b['eroare_mediana_m']} m | {b['sub_3m']} | {b['sub_5m']} | {b['decalaj_mediu_m']} m |"]
    c = rep.get("corectie_decalaj")
    if c:
        s += ["", f"Corecție de decalaj {c['decalaj_aplicat_m']} m (învățată pe jumătate din zone, testată pe cealaltă jumătate): "
              f"eroare mediană {c['fara']['eroare_mediana_m']} m → {c['cu']['eroare_mediana_m']} m, "
              f"sub 5 m {c['fara']['sub_5m']} → {c['cu']['sub_5m']}, F1 {c['fara']['f1']} → {c['cu']['f1']}"]
    return "\n".join(s) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="validare")
    ap.add_argument("--fara-osm", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    zones = [zona_ptab()] + ([] if a.fara_osm else zone_osm())
    res = []
    for z in zones:
        try:
            res.append(evalueaza(z))
        except Exception as e:
            print("  eroare la", z["nume"], e)
    ptab = [r for r in res if not r["independent"]]
    osm = [r for r in res if r["independent"]]
    out = {"model": api_local.MODEL, "potrivire_m": MATCH_M, "data": time.strftime("%Y-%m-%d %H:%M"),
           "ptab": raport(ptab, "PTAB 7812, date companie (optimist: zonă văzută parțial la antrenare)"),
           "osm": raport(osm, "OpenStreetMap Ilfov (independent; OSM incomplet, deci precizia e o limită de jos)")}
    json.dump(out, open(os.path.join(a.out, "raport.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    thr = (out["osm"] or out["ptab"])["cel_mai_bun_prag"]["prag"]
    json.dump(geojson(res, thr), open(os.path.join(a.out, "comparatie.geojson"), "w", encoding="utf-8"))
    text = "## Validare stâlpi AI vs. realitate\n\n" + md(out["ptab"]) + "\n" + md(out["osm"])
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8").write(text)


if __name__ == "__main__":
    main()
