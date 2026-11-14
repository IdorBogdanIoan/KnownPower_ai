"""O comanda, mai multe zone: OSM -> retea simulata -> agent -> evaluare -> harta HTML (+ optional modelul YOLO real).

Exemple (din folderul gridtwin, pe un calculator cu internet):
  python run_zone.py "Chitila, Ilfov" "Mogosoaia, Ilfov" "Buftea, Ilfov"
  python run_zone.py "Chitila, Ilfov" --model grid_best_v2.pt          # + detectii reale pe imagine satelit
  python run_zone.py --geojson export.geojson --name "Chitila"         # fara internet, dintr-un export overpass-turbo

Iese in zones/:
  index.html                     toate zonele, cu cifrele principale
  <zona>/harta.html              harta (deschide direct in Chrome: are si satelit)
  <zona>/data, <zona>/out        datele si propunerile agentului
  <zona>/tiles_for_labeling/     bucati de 512 px la 0,3 m/pixel, de etichetat in Roboflow (doar cu --model)

Doar biblioteca standard Python, in afara de --model (pip install ultralytics pillow).
Surse: Nominatim si Overpass (OpenStreetMap, © OpenStreetMap contributors, ODbL), folosite rar si politicos.
Imagini (--model): implicit Esri World Imagery. Termenii Esri permit vizualizarea; rularea unui model e zona gri,
ok pentru demo. In productie: ortofoto ANCPI, imaginile companiei sau drona (--tiles-url).
"""
import argparse, datetime, json, math, os, re, subprocess, sys, time, unicodedata, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "GridTwin-hackathon/0.1 (AI Validation Bootcamp x LSAC, demo)"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
GSD_M = 0.3          # rezolutia la care a fost antrenat modelul


# ----------------------------------------------------------------------------- internet
def http(url, data=None, timeout=120, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"   reincerc ({e})"); time.sleep(3 * (i + 1))


def geocode(q):
    url = NOMINATIM + "?" + urllib.parse.urlencode({"q": q, "format": "json", "limit": 1, "countrycodes": "ro"})
    r = json.loads(http(url))
    time.sleep(1.1)   # politica Nominatim: maximum 1 cerere pe secunda
    if not r:
        raise SystemExit(f"Nu gasesc localitatea: {q}")
    return float(r[0]["lat"]), float(r[0]["lon"]), r[0]["display_name"]


def fetch_osm(lat, lon, radius_m):
    dlat = radius_m / 111320; dlon = radius_m / (111320 * math.cos(math.radians(lat)))
    bb = f"{lat - dlat:.6f},{lon - dlon:.6f},{lat + dlat:.6f},{lon + dlon:.6f}"
    q = (f'[out:json][timeout:90];(way["highway"~"residential|living_street|unclassified|tertiary|secondary|primary|service"]({bb});'
         f'way["building"]({bb}););out tags geom;')
    last = None
    for ep in OVERPASS:
        try:
            raw = http(ep, data=urllib.parse.urlencode({"data": q}).encode(), timeout=180)
            return overpass_to_geojson(json.loads(raw))
        except Exception as e:
            last = e; print(f"   {ep} nu raspunde ({e}), incerc alt server")
    raise SystemExit(f"Overpass nu raspunde: {last}")


def overpass_to_geojson(j):
    feats = []
    for el in j.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        cs = [[p["lon"], p["lat"]] for p in el["geometry"]]
        tags = el.get("tags", {})
        if tags.get("building") and len(cs) >= 4 and cs[0] == cs[-1]:
            feats.append({"type": "Feature", "properties": tags, "geometry": {"type": "Polygon", "coordinates": [cs]}})
        elif tags.get("highway") and len(cs) >= 2:
            feats.append({"type": "Feature", "properties": tags, "geometry": {"type": "LineString", "coordinates": cs}})
    return {"type": "FeatureCollection", "features": feats}


# ----------------------------------------------------------------------------- alegerea cartierului
def densest_window(fc, size_m):
    """fereastra patrata cu cele mai multe case (blocurile si zonele industriale scad scorul)"""
    hs, bad, pts = [], [], []
    for f in fc["features"]:
        p, g = f["properties"], f["geometry"]
        if g["type"] != "Polygon" or not p.get("building"):
            continue
        r = g["coordinates"][0]; c = (sum(x[0] for x in r) / len(r), sum(x[1] for x in r) / len(r))
        if p["building"] in ("apartments", "industrial", "commercial", "retail", "warehouse"):
            bad.append(c)
        elif p["building"] in ("house", "yes", "terrace", "detached", "semidetached_house"):
            hs.append((c, p["building"] == "house", bool(p.get("addr:housenumber"))))
    if not hs:
        raise SystemExit("Nu am gasit case in zona.")
    lat0 = sum(h[0][1] for h in hs) / len(hs); lon0 = sum(h[0][0] for h in hs) / len(hs)
    MX, MY = 111320 * math.cos(math.radians(lat0)), 111320
    H = [((c[0] - lon0) * MX, (c[1] - lat0) * MY, hou, adr) for c, hou, adr in hs]
    B = [((c[0] - lon0) * MX, (c[1] - lat0) * MY) for c in bad]
    xs = [h[0] for h in H]; ys = [h[1] for h in H]
    best = None
    for x0 in range(int(min(xs)), int(max(xs)), 50):
        for y0 in range(int(min(ys)), int(max(ys)), 50):
            n = [h for h in H if x0 <= h[0] < x0 + size_m and y0 <= h[1] < y0 + size_m]
            if len(n) < 20:
                continue
            nb = sum(1 for b in B if x0 <= b[0] < x0 + size_m and y0 <= b[1] < y0 + size_m)
            s = len(n) + 0.5 * sum(h[2] for h in n) + 0.5 * sum(h[3] for h in n) - 5 * nb
            if best is None or s > best[0]:
                best = (s, x0, y0, len(n))
    if best is None:
        raise SystemExit("Zona e prea rara: nicio fereastra cu cel putin 20 de case.")
    _, x0, y0, n = best
    return (lon0 + x0 / MX, lat0 + y0 / MY, lon0 + (x0 + size_m) / MX, lat0 + (y0 + size_m) / MY), n


# ----------------------------------------------------------------------------- modelul pe imagine reala
def tile_xy(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def pix_lonlat(X, Y, z):
    n = 256 * 2 ** z
    return X / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * Y / n))))


def detect(zdir, bbox, model_path, conf, tiles_url, z=19, margin_m=30, tta="none"):
    from io import BytesIO
    from PIL import Image
    import yolo_plus
    lon0, lat0, lon1, lat1 = bbox
    dlat = margin_m / 111320; dlon = margin_m / (111320 * math.cos(math.radians(lat0)))
    lon0, lat0, lon1, lat1 = lon0 - dlon, lat0 - dlat, lon1 + dlon, lat1 + dlat

    def _blank(t):
        h = t.convert("L").histogram(); pk = max(range(256), key=lambda i: h[i])
        return sum(h[max(pk - 4, 0): pk + 5]) / max(sum(h), 1) > 0.85
    for z in range(z, 16, -1):   # daca sursa nu are imagine la zoom-ul cerut (dale gri), coboram
        tx0, ty0 = tile_xy(lon0, lat1, z); tx1, ty1 = tile_xy(lon1, lat0, z)
        tx0, ty0, tx1, ty1 = int(tx0), int(ty0), int(tx1), int(ty1)
        W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
        n = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
        print(f"   descarc {n} dale de imagine (zoom {z})")
        mosaic = Image.new("RGB", (W, H)); blank = 0
        for tx in range(tx0, tx1 + 1):
            for ty in range(ty0, ty1 + 1):
                try:
                    im = Image.open(BytesIO(http(tiles_url.format(z=z, x=tx, y=ty), timeout=30))).convert("RGB")
                    blank += _blank(im)
                    mosaic.paste(im, ((tx - tx0) * 256, (ty - ty0) * 256))
                except Exception as e:
                    blank += 1
                    print(f"   dala {tx},{ty} lipsa ({e})")
                time.sleep(0.05)
        if blank <= 0.1 * n:
            break
        print(f"   {blank}/{n} dale fara imagine (gri) la zoom {z}; incerc mai jos")
    lat_c = (lat0 + lat1) / 2
    gsd = 156543.03392 * math.cos(math.radians(lat_c)) / 2 ** z
    f = gsd / GSD_M                                        # < 1: micsoram imaginea la 0,3 m/pixel
    img = mosaic.resize((int(W * f), int(H * f)), Image.BILINEAR)
    img.save(os.path.join(zdir, "imagine_0.3m.jpg"), quality=90)
    lab = os.path.join(zdir, "tiles_for_labeling"); os.makedirs(lab, exist_ok=True)
    models = yolo_plus.load(model_path)          # unul sau mai multe modele (ansamblu), separate prin virgulă
    tile, ov = 512, 64
    dets = []
    for y in range(0, max(img.height - ov, 1), tile - ov):
        for x in range(0, max(img.width - ov, 1), tile - ov):
            crop = img.crop((x, y, min(x + tile, img.width), min(y + tile, img.height)))
            if crop.width < 128 or crop.height < 128:
                continue
            crop.save(os.path.join(lab, f"t_{x}_{y}.jpg"), quality=92)
            for cx, cy, c, nv in yolo_plus.predict_points(models, crop, tta=tta, conf=min(conf, 0.05)):
                if c < conf:
                    continue
                px, py = x + cx, y + cy                                   # pixel in imaginea la 0,3 m
                dets.append((px / f + tx0 * 256, py / f + ty0 * 256, c, "DT"))
    dets.sort(key=lambda d: -d[2]); keep = []
    for d in dets:   # dubluri din suprapunerea bucatilor
        if all(math.hypot(d[0] - k[0], d[1] - k[1]) * gsd > 3 for k in keep):
            keep.append(d)
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": list(pix_lonlat(X, Y, z))},
              "properties": {"class": k, "conf": round(c, 3), "model": "+".join(os.path.basename(m) for m in model_path.split(",")) + (f" (tta {tta})" if tta != "none" else ""), "sursa": "imagine reala"}}
             for X, Y, c, k in keep]
    json.dump({"type": "FeatureCollection", "features": feats},
              open(os.path.join(zdir, "data", "detections_yolo.geojson"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"   {len(feats)} detectii reale (prag {conf}), {len(os.listdir(lab))} bucati de etichetat in {lab}")
    return len(feats)


# ----------------------------------------------------------------------------- o zona
def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40]


def run_zone(name, a, fc=None):
    print(f"\n== {name}")
    zdir = os.path.join(a.out, slug(name)); os.makedirs(zdir, exist_ok=True)
    osm = os.path.join(zdir, "osm.geojson")
    if fc is None and os.path.exists(osm) and not a.refresh:
        print("   folosesc datele OSM salvate la rularea anterioara (--refresh ca sa le descarc din nou)")
        fc = json.load(open(osm, encoding="utf-8"))
    if fc is None:
        lat, lon, full = geocode(name)
        print(f"   {full}")
        fc = fetch_osm(lat, lon, a.radius)
    json.dump(fc, open(osm, "w", encoding="utf-8"), ensure_ascii=False)
    bbox, n = densest_window(fc, a.size)
    print(f"   cartier ales: {n} case, bbox {','.join(f'{v:.5f}' for v in bbox)}")
    py = lambda *args: subprocess.run([sys.executable, *args], check=True, cwd=HERE)
    data, out = os.path.join(zdir, "data"), os.path.join(zdir, "out")
    py("generate_real.py", osm, "--bbox", ",".join(f"{v:.6f}" for v in bbox), "--out", data, "--max-poles", "200", "--seed", str(a.seed))
    nyolo = None
    if a.model:
        nyolo = detect(zdir, bbox, a.model, a.conf, a.tiles_url, tta=a.tta)
    py("agent.py", "--data", data, "--out", out, "--azi", datetime.date.today().isoformat(), *(["--conf-min", str(a.conf)] if a.model else []))
    if a.streetview:
        # ce nu s-a putut confirma din aer: verificam in pozele de strada (Mapillary), apoi rulam agentul din nou
        try:
            py("streetview.py", "--data", data, "--out", out, *(["--vision"] if a.vision else []))
            py("agent.py", "--data", data, "--out", out, "--azi", datetime.date.today().isoformat(), *(["--conf-min", str(a.conf)] if a.model else []))
        except subprocess.CalledProcessError as e:
            print(f"   street view sarit ({e})")
    py("evaluate.py", "--data", data, "--out", out)
    sys.path.insert(0, os.path.join(HERE, "ui"))
    from build_map import build
    label = f"{name} · străzi și clădiri reale (OSM), rețea simulată"
    build(data, out, label, os.path.join(zdir, "harta.html"))
    ev = json.load(open(os.path.join(out, "eval.json"), encoding="utf-8"))
    nb = len(json.load(open(os.path.join(data, "buildings.geojson"), encoding="utf-8"))["features"])
    npol = sum(1 for f in json.load(open(os.path.join(data, "truth.geojson"), encoding="utf-8"))["features"] if f["properties"]["kind"] == "stalp")
    return {"zona": name, "dir": slug(name), "cladiri": nb, "stalpi": npol, "propuneri": sum(ev["total_propuneri"].values()),
            "clienti_lipsa": ev["clienti"]["lipsa_din_GIS"], "fara_deplasare": ev["clienti"]["rezolvat_fara_deplasare"],
            "la_echipa": ev["clienti"]["trimis_la_echipa"],
            "stalpi_lipsa": f'{ev["stalp_lipsa"]["corecte"]}/{ev["stalp_lipsa"]["din_total"]}',
            "mutati": f'{ev["corectie_pozitie"]["corecte"]}/{ev["corectie_pozitie"]["din_total"]}',
            "detectii_reale": nyolo}


def write_index(rows, out):
    head = ["Zonă", "Clădiri", "Stâlpi (sim.)", "Propuneri", "Clienți lipsă", "Fără deplasare", "La echipă", "Stâlpi lipsă găsiți", "Mutați corectați", "Detecții reale"]
    tr = "".join(
        f'<tr><td><a href="{r["dir"]}/harta.html">{r["zona"]}</a></td><td>{r["cladiri"]}</td><td>{r["stalpi"]}</td><td>{r["propuneri"]}</td>'
        f'<td>{r["clienti_lipsa"]}</td><td>{r["fara_deplasare"]}</td><td>{r["la_echipa"]}</td><td>{r["stalpi_lipsa"]}</td>'
        f'<td>{r["mutati"]}</td><td>{"" if r["detectii_reale"] is None else r["detectii_reale"]}</td></tr>' for r in rows)
    html = f"""<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8"><title>GridTwin zone</title>
<style>body{{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#17212b}}table{{border-collapse:collapse}}
td,th{{border-bottom:1px solid #d5dce3;padding:6px 12px;text-align:left;font-variant-numeric:tabular-nums}}th{{color:#5b6b7a;font-weight:500}}</style></head>
<body><h1>GridTwin: zone rulate</h1><p>Străzi și clădiri reale din OpenStreetMap (© OpenStreetMap contributors). Rețeaua, GIS-ul,
contractele și cablurile sunt simulate. „Detecții reale” = modelul grid_best_v2 pe imaginea satelit a zonei.</p>
<table><tr>{"".join(f"<th>{h}</th>" for h in head)}</tr>{tr}</table><p>Generat {datetime.datetime.now():%Y-%m-%d %H:%M}.</p></body></html>"""
    open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(html)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zones", nargs="*", help='localitati, ex. "Chitila, Ilfov"')
    ap.add_argument("--geojson", help="export overpass-turbo in loc de descarcare (o singura zona)")
    ap.add_argument("--name", default="Zona", help="numele zonei pentru --geojson")
    ap.add_argument("--out", default=os.path.join(HERE, "zones"))
    ap.add_argument("--size", type=int, default=450, help="latura cartierului ales, in metri")
    ap.add_argument("--radius", type=int, default=1500, help="cat descarc in jurul localitatii, in metri")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--streetview", action="store_true", help="verifica in poze de strada (Mapillary, MAPILLARY_TOKEN) ce nu se vede de sus")
    ap.add_argument("--vision", action="store_true", help="cu --streetview: citeste pozele cu un model vizual (ANTHROPIC_API_KEY)")
    ap.add_argument("--refresh", action="store_true", help="descarca din nou datele OSM chiar daca exista salvate")
    ap.add_argument("--model", help="grid_best_v2.pt: ruleaza modelul real pe imaginea satelit a zonei")
    ap.add_argument("--conf", type=float, default=0.35, help="pragul ales la evaluare (F1 maxim)")
    ap.add_argument("--tta", default="none", choices=["none", "flip", "d4"], help="rotiri/oglindiri la inferență (d4 = 8 vederi, mai lent)")
    ap.add_argument("--tiles-url", default=ESRI, help="sursa de imagini XYZ, cu {z} {x} {y}")
    a = ap.parse_args()
    if not a.zones and not a.geojson:
        ap.error('da cel putin o localitate, ex. python run_zone.py "Chitila, Ilfov"')
    os.makedirs(a.out, exist_ok=True)
    rows = []
    if a.geojson:
        rows.append(run_zone(a.name, a, json.load(open(a.geojson, encoding="utf-8"))))
    for z in a.zones:
        try:
            rows.append(run_zone(z, a))
        except SystemExit as e:
            print(f"   sar peste {z}: {e}")
    write_index(rows, a.out)
    print(f"\nGata: {os.path.join(a.out, 'index.html')}")


if __name__ == "__main__":
    main()
