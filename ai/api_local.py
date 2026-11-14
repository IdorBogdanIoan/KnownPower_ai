"""Motorul AI local pentru site (secțiunea „Caută zonă”).

Pornire:  python api_local.py      (sau dublu-click pe porneste_ai.bat)
Ascultă doar pe calculatorul tău: http://127.0.0.1:8765

  GET  /stare               -> e pornit? ce model folosește?
  POST /analiza {lon, lat, raza}
       străzi + case (OSM, plus clădirile din satelit dacă le avem), imagine satelit + stâlpi găsiți de model,
       rețeaua cunoscută din zonă și rețeaua probabilă propusă de agent pentru casele neacoperite
  POST /salveaza {rezultat}  -> păstrează propunerile în zones/cautari.json (site-ul le citește de la /cautari)
  GET  /cautari             -> toate căutările salvate, gata de pus pe hartă
"""
import json, math, os, sys, threading, time, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import agent  # noqa: E402
import retea_prezisa  # noqa: E402
import run_zone  # noqa: E402

PORT = int(os.environ.get("GRIDTWIN_API_PORT", "8765"))
MODEL = os.environ.get("GRIDTWIN_MODEL", "grid_best_ro_B.pt")
TTA = os.environ.get("GRIDTWIN_TTA", "none")   # "d4" e puțin mai bun, dar de ~8 ori mai lent
CONF = float(os.environ.get("GRIDTWIN_CONF", "0.1"))
ZONE_DIR = os.path.join(HERE, "zones", "ptab7812")
EXTRA_BUILDINGS = os.path.join(HERE, "data_ptab7812", "cladiri_ms.geojson")
ZONE_OSM = os.path.join(HERE, "data_ptab7812", "osm.geojson")
SAVED = os.path.join(HERE, "zones", "cautari.json")
MAX_RAZA = 400

_models = None
_lock = threading.Lock()


def models():
    global _models
    if _models is None:
        import yolo_plus
        path = os.path.join(HERE, MODEL)
        if not os.path.exists(path):
            path = os.path.join(HERE, "grid_best_v2.pt")
        _models = (yolo_plus, yolo_plus.load(path), os.path.basename(path))
    return _models


def load_fc(p):
    if not os.path.exists(p):
        return []
    return json.load(open(p, encoding="utf-8")).get("features", [])


def in_box(c, box):
    return box[0] <= c[0] <= box[2] and box[1] <= c[1] <= box[3]


def centroid(ring):
    return (sum(c[0] for c in ring) / len(ring), sum(c[1] for c in ring) / len(ring))


# ----------------------------------------------------------------------------- pași
def osm_for(lat, lon, raza, box):
    """străzi + case din OSM; dacă serverele OSM nu răspund, folosește exportul local (doar pentru zona lui)"""
    try:
        fc = run_zone.fetch_osm(lat, lon, raza + 60)["features"]
        return fc, "OpenStreetMap (live)"
    except BaseException as e:  # fetch_osm iese cu SystemExit când nu răspunde niciun server
        local = []
        for f in load_fc(ZONE_OSM):
            g, p = f.get("geometry") or {}, f.get("properties") or {}
            if g.get("type") == "Polygon" and "building" in p and any(in_box(c, box) for c in g["coordinates"][0]):
                local.append(f)
            elif g.get("type") == "LineString" and "highway" in p and any(in_box(c, box) for c in g["coordinates"]):
                local.append(f)
        return local, f"export OSM local (serverele OSM nu au răspuns: {str(e)[:80]})"


def satellite_poles(box):
    """imaginea Esri la ~0,3 m/pixel și stâlpii găsiți de model -> [(lon, lat, conf)], zoom folosit"""
    from PIL import Image
    yolo_plus, ms, name = models()
    lon0, lat0, lon1, lat1 = box

    def blank(t):
        h = t.convert("L").histogram(); pk = max(range(256), key=lambda i: h[i])
        return sum(h[max(pk - 4, 0): pk + 5]) / max(sum(h), 1) > 0.85
    for z in (18, 17):
        tx0, ty0 = run_zone.tile_xy(lon0, lat1, z); tx1, ty1 = run_zone.tile_xy(lon1, lat0, z)
        tx0, ty0, tx1, ty1 = int(tx0), int(ty0), int(tx1), int(ty1)
        W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
        mosaic = Image.new("RGB", (W, H)); n = bad = 0
        for tx in range(tx0, tx1 + 1):
            for ty in range(ty0, ty1 + 1):
                n += 1
                try:
                    im = Image.open(BytesIO(run_zone.http(run_zone.ESRI.format(z=z, x=tx, y=ty), timeout=30))).convert("RGB")
                    bad += blank(im)
                    mosaic.paste(im, ((tx - tx0) * 256, (ty - ty0) * 256))
                except Exception:
                    bad += 1
        if bad <= 0.1 * n:
            break
    if bad >= n:
        raise RuntimeError("nu am putut descărca imaginea din satelit (internet?)")
    gsd = 156543.03392 * math.cos(math.radians((lat0 + lat1) / 2)) / 2 ** z
    f = gsd / run_zone.GSD_M
    img = mosaic.resize((max(1, int(W * f)), max(1, int(H * f))), Image.BILINEAR)
    tile, ov, dets = 512, 64, []
    with _lock:
        for y in range(0, max(img.height - ov, 1), tile - ov):
            for x in range(0, max(img.width - ov, 1), tile - ov):
                crop = img.crop((x, y, min(x + tile, img.width), min(y + tile, img.height)))
                if crop.width < 128 or crop.height < 128:
                    continue
                for cx, cy, c, _nv in yolo_plus.predict_points(ms, crop, tta=TTA, conf=min(CONF, 0.05)):
                    if c >= CONF:
                        dets.append(((x + cx) / f + tx0 * 256, (y + cy) / f + ty0 * 256, c))
    dets.sort(key=lambda d: -d[2]); keep = []
    for d in dets:
        if all(math.hypot(d[0] - k[0], d[1] - k[1]) * gsd > 3 for k in keep):
            keep.append(d)
    out = []
    for X, Y, c in keep:
        lon, lat = run_zone.pix_lonlat(X, Y, z)
        if in_box((lon, lat), box):
            out.append((lon, lat, c))
    return out, z, name


def ms_buildings(box):
    """case Microsoft: live (pentru orice zonă) când GRIDTWIN_MS_LIVE=1, altfel exportul local al zonei"""
    if os.environ.get("GRIDTWIN_MS_LIVE") == "1":
        try:
            import cladiri_ms
            return cladiri_ms.cladiri(box)
        except Exception as e:
            print("Microsoft live a eșuat:", e, flush=True)
    return load_fc(EXTRA_BUILDINGS)


def known_network(box):
    feats = load_fc(os.path.join(ZONE_DIR, "data", "gis_company.geojson"))
    pts, lines = [], 0
    for f in feats:
        g = f["geometry"]
        if g["type"] == "Point" and in_box(g["coordinates"], box):
            pts.append(g["coordinates"])
        elif g["type"] == "LineString" and f["properties"].get("kind") == "tronson" and any(in_box(c, box) for c in g["coordinates"]):
            lines += 1
            pts += [c for c in g["coordinates"] if in_box(c, box)]
    return pts, lines


def analiza(lon, lat, raza):
    t0 = time.time()
    raza = max(50, min(MAX_RAZA, float(raza)))
    m = raza + 40
    dlat = m / 111320; dlon = m / (111320 * math.cos(math.radians(lat)))
    box = (lon - dlon, lat - dlat, lon + dlon, lat + dlat)
    pasi = []

    osm, sursa_osm = osm_for(lat, lon, raza, box)
    streets = [f for f in osm if f["geometry"]["type"] == "LineString"]
    blds = [f for f in osm if f["geometry"]["type"] == "Polygon"]
    pasi.append({"nume": "Străzi și case", "ok": bool(streets or blds), "detalii": f"{len(streets)} străzi, {len(blds)} case din {sursa_osm}"})

    extra = 0
    osm_c = [centroid(f["geometry"]["coordinates"][0]) for f in blds]
    for f in ms_buildings(box):
        c = centroid(f["geometry"]["coordinates"][0])
        if in_box(c, box) and all(abs(c[0] - o[0]) > 8e-5 or abs(c[1] - o[1]) > 6e-5 for o in osm_c):
            blds.append({"type": "Feature", "geometry": f["geometry"], "properties": {"sursa": "satelit (Microsoft)"}})
            extra += 1
    if extra:
        pasi.append({"nume": "Case din satelit (Microsoft)", "ok": True, "detalii": f"{extra} case care lipseau din OSM"})

    # modelul nostru de case (cladiri_best.pt, antrenat pe Kaggle), dacă există
    if os.path.exists(os.path.join(HERE, "cladiri_best.pt")):
        try:
            import cladiri_ai
            with _lock:
                mine = cladiri_ai.cladiri(box)
            rings = [f["geometry"]["coordinates"][0] for f in blds]
            def _inside(pt, ring):
                x, y, ok = pt[0], pt[1], False
                for i in range(len(ring)):
                    (x1, y1), (x2, y2) = ring[i - 1], ring[i]
                    if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                        ok = not ok
                return ok
            new_ones = [f for f in mine if not any(_inside(centroid(f["geometry"]["coordinates"][0]), r) for r in rings)]
            blds += new_ones
            extra += len(new_ones)
            pasi.append({"nume": "Case găsite de modelul nostru", "ok": True,
                         "detalii": f"{len(mine)} case în imagine, dintre care {len(new_ones)} lipseau din OSM și Microsoft"})
        except Exception as e:
            pasi.append({"nume": "Case găsite de modelul nostru", "ok": False, "detalii": str(e)[:120]})

    try:
        poles, z, model_name = satellite_poles(box)
        pasi.append({"nume": "Imagine satelit + model AI", "ok": True,
                      "detalii": f"zoom {z}, model {model_name} (TTA {TTA}): {len(poles)} stâlpi probabili"})
    except Exception as e:
        poles, model_name = [], None
        pasi.append({"nume": "Imagine satelit + model AI", "ok": False, "detalii": f"nu am putut rula modelul: {str(e)[:120]}"})

    known_pts, known_lines = known_network(box)
    pasi.append({"nume": "Rețeaua din datele companiei", "ok": True,
                 "detalii": f"{known_lines} tronsoane și {len(known_pts)} puncte de rețea în zonă" if known_lines else "nimic în zona asta"})

    # rețeaua probabilă: structura de date a agentului, în metri locali
    P = agent.Proj(lon, lat)
    D = {"P": P, "conn": {}, "lines": {}, "det": [], "buildings": {}, "streets": []}
    for f in streets:
        D["streets"].append((f["properties"].get("name") or "drum fără nume", [P.xy(c) for c in f["geometry"]["coordinates"]]))
    for i, f in enumerate(blds):
        ring = [P.xy(c) for c in f["geometry"]["coordinates"][0]]
        D["buildings"][f"C{i:03d}"] = {"id": f"C{i:03d}", "xy": centroid(ring)}
    for lo, la, c in poles:
        xy = P.xy((lo, la))
        sd = min((agent.dist_polyline(xy, pts) for _, pts in D["streets"] if len(pts) > 1), default=0)
        if sd <= agent.STREET_M:
            D["det"].append({"xy": xy, "conf": c})
    known = {f"K{i}": P.xy(c) for i, c in enumerate(known_pts)}
    # nu repropunem rețea pentru casele care au deja rețea prezisă de rularea agentului pe zonă
    for name in ("out", "out_v3"):
        pred = load_fc(os.path.join(ZONE_DIR, name, "retea_prezisa.geojson"))
        if pred:
            for i, f in enumerate(pred):
                if f["geometry"]["type"] == "Point" and in_box(f["geometry"]["coordinates"], box):
                    known[f"Z{i}"] = P.xy(f["geometry"]["coordinates"])
            break
    known = known or {"_": (1e9, 1e9)}
    props, scores, feats, nfar = retea_prezisa.prezice(D, known, agent.BRANS_MAX_M, CONF) if D["streets"] else ([], [], [], 0)

    stamp = time.strftime("%H%M%S")
    pref = f"AI{stamp}-"
    for i, p in enumerate(props, 1):
        p["id"] = f"{pref}P{i:02d}"
    sc = [{"id": s["id"], "scor": s["scor"], "culoare": s["culoare"], "motive": s["motive"],
           "geometry": {"type": "LineString", "coordinates": [P.ll(p) for p in s["pts"]]}} for s in scores]
    blob = json.dumps({"p": props, "s": sc, "f": feats}, ensure_ascii=False).replace("PRZ-", pref)
    blob = json.loads(blob)
    props, sc, feats = blob["p"], blob["s"], blob["f"]

    n_case = len(blds)
    n_conf = sum(1 for f in feats if f["properties"]["kind"] == "stalp" and f["properties"].get("detectie"))
    rez = []
    if known_lines:
        rez.append(f"Zona e acoperită parțial de rețeaua din datele companiei ({known_lines} tronsoane).")
    else:
        rez.append("În datele companiei nu există rețea în zona asta.")
    rez.append(f"Am găsit {n_case} case" + (f" ({extra} doar din satelit)" if extra else "") + f" și {len(streets)} străzi.")
    if poles:
        best = max(c for _, _, c in poles)
        rez.append(f"Modelul AI a văzut {len(poles)} stâlpi probabili în imaginea din satelit (cel mai sigur: {round(best * 100)}%).")
    elif model_name:
        rez.append("Modelul AI nu a văzut stâlpi în imagine (copaci, umbre sau rețea subterană).")
    if props:
        npol = sum(1 for f in feats if f["properties"]["kind"] == "stalp")
        nbr = sum(1 for f in feats if f["properties"]["kind"] == "bransament")
        rez.append(f"Propun {len(props)} linii probabile cu {npol} stâlpi ({n_conf} confirmați de imagine) și {nbr} branșamente.")
    elif n_case and known_lines:
        rez.append("Casele de aici sunt deja aproape de rețeaua cunoscută: nu e nevoie de rețea nouă.")
    elif not n_case:
        rez.append("Nu sunt case aici, deci nu propun rețea.")
    rez.append("Tot ce e propus e de confirmat în teren.")

    to_fc = lambda fs: {"type": "FeatureCollection", "features": fs}
    return {
        "ok": True, "centru": [lon, lat], "raza": raza, "durata_s": round(time.time() - t0, 1),
        "pasi": pasi, "rezumat": rez,
        "numere": {"strazi": len(streets), "case": n_case, "case_satelit": extra, "stalpi_imagine": len(poles),
                   "tronsoane_cunoscute": known_lines, "linii_propuse": len(props),
                   "stalpi_propusi": sum(1 for f in feats if f["properties"]["kind"] == "stalp"),
                   "bransamente_propuse": sum(1 for f in feats if f["properties"]["kind"] == "bransament")},
        "straturi": {
            "detectii": to_fc([{"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(a, 6), round(b, 6)]},
                                "properties": {"conf": round(c, 3)}} for a, b, c in poles]),
            "cladiri": to_fc([{"type": "Feature", "geometry": f["geometry"], "properties": {"sursa": f["properties"].get("sursa", "OpenStreetMap")}} for f in blds]),
            "strazi": to_fc([{"type": "Feature", "geometry": f["geometry"], "properties": {"name": f["properties"].get("name", "")}} for f in streets]),
            "retea_prezisa": to_fc(feats),
        },
        "propuneri": props, "scoruri": sc,
    }


# ----------------------------------------------------------------------------- server
def saved():
    if not os.path.exists(SAVED):
        return {"cautari": []}
    return json.load(open(SAVED, encoding="utf-8"))


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")   # site-ul online poate vorbi cu motorul de pe laptop
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self.path.startswith("/stare"):
            self._send(200, {"ok": True, "model": MODEL, "tta": TTA, "prag": CONF, "raza_max": MAX_RAZA})
        elif self.path.startswith("/cautari"):
            self._send(200, saved())
        else:
            self._send(404, {"ok": False, "eroare": "necunoscut"})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n > 20_000_000:
                return self._send(413, {"ok": False, "eroare": "prea mare"})
            req = json.loads(self.rfile.read(n) or b"{}")
            if self.path.startswith("/analiza"):
                lon, lat = float(req["lon"]), float(req["lat"])
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    return self._send(400, {"ok": False, "eroare": "coordonate invalide"})
                print(f"analiză {lat:.5f}, {lon:.5f}, raza {req.get('raza', 200)} m", flush=True)
                self._send(200, analiza(lon, lat, req.get("raza", 200)))
            elif self.path.startswith("/salveaza"):
                r = req["rezultat"]
                data = saved()
                data["cautari"] = [c for c in data["cautari"] if c.get("id") != r.get("id")]
                data["cautari"].append({"id": r.get("id") or time.strftime("%Y%m%d%H%M%S"), "salvat": time.strftime("%Y-%m-%d %H:%M"),
                                        "centru": r["centru"], "raza": r["raza"], "propuneri": r["propuneri"],
                                        "scoruri": r["scoruri"], "retea_prezisa": r["straturi"]["retea_prezisa"],
                                        "detectii": r["straturi"]["detectii"]})
                os.makedirs(os.path.dirname(SAVED), exist_ok=True)
                json.dump(data, open(SAVED, "w", encoding="utf-8"), ensure_ascii=False)
                self._send(200, {"ok": True, "salvate": len(data["cautari"])})
            else:
                self._send(404, {"ok": False, "eroare": "necunoscut"})
        except Exception as e:
            traceback.print_exc()
            self._send(500, {"ok": False, "eroare": str(e)[:300]})

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    print(f"Motorul AI GridTwin pornit pe http://127.0.0.1:{PORT}  (model {MODEL}, TTA {TTA}, prag {CONF})")
    print("Lasă fereastra deschisă cât folosești „Caută zonă” pe site. Ctrl+C pentru oprire.")
    ThreadingHTTPServer((os.environ.get("GRIDTWIN_API_HOST", "127.0.0.1"), PORT), H).serve_forever()
