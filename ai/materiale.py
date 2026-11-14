"""Materialul stâlpilor din poze de stradă: Mapillary + model vizual deschis (CLIP), fără API plătit.

    python materiale.py --geojson rulari/<rulare>/<localitate>.geojson --out materiale_<localitate>.json --max 300

Token Mapillary: variabila MAPILLARY_TOKEN (secret GitHub, nu se scrie în cod).

Pentru fiecare stâlp (întâi cei văzuți în satelit):
 1. Mapillary are deja detecții proprii de stâlpi: dacă e unul la max 8 m, stâlpul e confirmat de la sol;
 2. luăm 1-3 poze de stradă orientate spre stâlp (max 35 m, unghi max 60°);
 3. tăiem fâșia din direcția stâlpului și o dăm modelului CLIP cu descrieri în engleză:
    beton / lemn / metal / niciun stâlp, plus tipul liniei (torsadat / conductoare neizolate).
Rezultatul e o estimare automată, neverificată pe date reale; fiecare stâlp are link la poze.
"""
import argparse, io, json, math, os, sys, time, urllib.parse, urllib.request

GRAPH = "https://graph.mapillary.com"
POLE_VALUES = "object--support--utility-pole,object--support--pole"
UA = "KnownPower-AI/1.0"
FOV = 70.0          # unghiul de vedere aproximativ al unei poze obișnuite

MATERIAL = {
    "beton": ["a photo of a grey concrete electricity pole", "a reinforced concrete utility pole next to a street",
              "a tall grey concrete pole with power lines"],
    "lemn": ["a photo of a wooden electricity pole", "a brown wooden utility pole with power lines",
             "an old wooden telegraph pole"],
    "metal": ["a photo of a metal lattice electricity pylon", "a steel tubular utility pole", "a metal street light pole"],
    "fara": ["a photo of a street without any pole", "a house facade and a fence", "trees, bushes and sky",
             "a parked car on a street"],
}
LINIE = {
    "torsadat": ["a single black twisted aerial bundled cable hanging between poles",
                 "a thick black insulated bundled power cable on a pole"],
    "neizolat": ["several separate thin bare overhead wires on insulators", "four parallel bare power wires on a pole crossarm"],
}


def _get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def dist_m(a, b):
    k = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 110540)


def bearing(a, b):
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return (math.degrees(math.atan2((b[0] - a[0]) * k, b[1] - a[1])) + 360) % 360


def bbox(p, m):
    dl = m / 110540; dk = m / (111320 * math.cos(math.radians(p[1])))
    return f"{p[0] - dk:.7f},{p[1] - dl:.7f},{p[0] + dk:.7f},{p[1] + dl:.7f}"


class Mapillary:
    def __init__(self, token):
        self.token = token

    def q(self, path, **params):
        params["access_token"] = self.token
        for i in range(3):
            try:
                return json.loads(_get(f"{GRAPH}/{path}?{urllib.parse.urlencode(params)}")).get("data", [])
            except Exception as e:
                if i == 2:
                    raise
                time.sleep(2 * (i + 1))

    def pole_near(self, p, r=8):
        fs = self.q("map_features", bbox=bbox(p, r + 5), object_values=POLE_VALUES, fields="id,object_value,geometry")
        ds = [dist_m(p, f["geometry"]["coordinates"]) for f in fs]
        return min(ds) if ds and min(ds) <= r else None

    def images_toward(self, p, r=35, n=3, max_angle=60):
        ims = self.q("images", bbox=bbox(p, r), limit=80,
                     fields="id,thumb_1024_url,computed_geometry,geometry,compass_angle,computed_compass_angle,captured_at,is_pano")
        good = []
        for im in ims:
            g = (im.get("computed_geometry") or im.get("geometry") or {}).get("coordinates")
            ang = im.get("computed_compass_angle", im.get("compass_angle"))
            if not g or ang is None or not im.get("thumb_1024_url"):
                continue
            d = dist_m(g, p)
            if d > r or d < 3:
                continue
            rel = (bearing(g, p) - ang + 180) % 360 - 180
            if not im.get("is_pano") and abs(rel) > min(max_angle, FOV / 2 - 5):
                continue
            good.append((d + abs(rel) / 6, d, rel, im))
        good.sort(key=lambda x: x[0])
        return [{"id": im["id"], "url": im["thumb_1024_url"], "dist_m": round(d, 1), "rel": rel, "pano": bool(im.get("is_pano")),
                 "data": im.get("captured_at")} for _, d, rel, im in good[:n]]


class Clip:
    def __init__(self):
        import open_clip, torch
        self.torch = torch
        self.model, _, self.prep = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
        self.model.eval()
        tok = open_clip.get_tokenizer("ViT-B-32")

        def enc(groups):
            names, vecs = [], []
            with torch.no_grad():
                for k, ps in groups.items():
                    e = self.model.encode_text(tok(ps)); e = e / e.norm(dim=-1, keepdim=True)
                    m = e.mean(0); vecs.append(m / m.norm()); names.append(k)
            return names, torch.stack(vecs)
        self.mat = enc(MATERIAL)
        self.lin = enc(LINIE)

    def probs(self, img, which):
        names, T = which
        with self.torch.no_grad():
            x = self.model.encode_image(self.prep(img).unsqueeze(0)); x = x / x.norm(dim=-1, keepdim=True)
            p = (100 * x @ T.T).softmax(-1)[0].tolist()
        return dict(zip(names, p))


def crop_toward(img, rel, pano, dist):
    W, H = img.size
    if pano:
        x = W / 2 + rel / 360 * W
        half = max(W * 0.06, W * (12 / max(dist, 4)) / 360 * 2)
    else:
        x = W / 2 + rel / FOV * W
        half = max(W * 0.12, min(W * 0.35, W * (180 / max(dist, 4)) / 100))
    x0, x1 = int(max(0, x - half)), int(min(W, x + half))
    if x1 - x0 < 64:
        return None
    return img.crop((x0, 0, x1, H))


def analizeaza(mp, clip, p):
    from PIL import Image
    out = {"lon": p[0], "lat": p[1], "material": "necunoscut", "material_incredere": None, "stalp_vazut_strada": None,
           "linie": None, "linie_incredere": None, "mapillary_stalp_m": None, "imagini": []}
    try:
        out["mapillary_stalp_m"] = mp.pole_near(p)
        ims = mp.images_toward(p)
    except Exception as e:
        out["eroare"] = str(e)[:120]; return out
    if not ims:
        return out
    acc_m, acc_l, wsum = {}, {}, 0.0
    for im in ims:
        try:
            img = Image.open(io.BytesIO(_get(im["url"]))).convert("RGB")
        except Exception:
            continue
        crop = crop_toward(img, im["rel"], im["pano"], im["dist_m"])
        if crop is None:
            continue
        w = 1 / max(im["dist_m"], 5)
        for k, v in clip.probs(crop, clip.mat).items():
            acc_m[k] = acc_m.get(k, 0) + w * v
        for k, v in clip.probs(crop, clip.lin).items():
            acc_l[k] = acc_l.get(k, 0) + w * v
        wsum += w
        out["imagini"].append({"link": f"https://www.mapillary.com/app/?pKey={im['id']}", "dist_m": im["dist_m"], "data": im["data"]})
    if not wsum:
        return out
    pm = {k: v / wsum for k, v in acc_m.items()}
    pl = {k: v / wsum for k, v in acc_l.items()}
    vazut = pm["fara"] < 0.5 or out["mapillary_stalp_m"] is not None
    out["stalp_vazut_strada"] = vazut
    if vazut:
        mats = {k: pm[k] for k in ("beton", "lemn", "metal")}
        tot = sum(mats.values()); best = max(mats, key=mats.get); conf = mats[best] / tot
        out["material_incredere"] = round(conf, 2)
        out["material"] = best if conf >= 0.5 else "necunoscut"
        lb = max(pl, key=pl.get)
        out["linie_incredere"] = round(pl[lb], 2)
        out["linie"] = lb if pl[lb] >= 0.6 else None
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--geojson", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max", type=int, default=300)
    a = ap.parse_args()
    token = os.environ.get("MAPILLARY_TOKEN", "").strip()
    if not token:
        sys.exit("Lipsește MAPILLARY_TOKEN (pune-l ca secret în GitHub: Settings → Secrets and variables → Actions).")
    fc = json.load(open(a.geojson, encoding="utf-8"))
    poles = [f for f in fc["features"] if f["geometry"]["type"] == "Point"]
    order = {"satelit": 0, "prezis+satelit": 0, "prezis": 1}
    poles.sort(key=lambda f: (order.get(f["properties"].get("sursa"), 2), -(f["properties"].get("incredere") or 0)))
    mp, clip = Mapillary(token), Clip()
    res, t0 = [], time.time()
    for i, f in enumerate(poles[:a.max], 1):
        r = analizeaza(mp, clip, f["geometry"]["coordinates"])
        res.append(r)
        if i % 25 == 0:
            print(f"  {i}/{min(len(poles), a.max)} stâlpi, {sum(1 for x in res if x['imagini'])} cu poze, {time.time() - t0:.0f} s", flush=True)
    stats = {"stalpi_analizati": len(res), "cu_poze": sum(1 for x in res if x["imagini"]),
             "vazuti_strada": sum(1 for x in res if x["stalp_vazut_strada"]),
             "material": {m: sum(1 for x in res if x["material"] == m) for m in ("beton", "lemn", "metal", "necunoscut")},
             "metoda": "Mapillary + CLIP ViT-B-32 (zero-shot), estimare neverificată"}
    json.dump({"stats": stats, "stalpi": res}, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
