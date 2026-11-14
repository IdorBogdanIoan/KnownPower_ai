"""Clădiri din Microsoft Global ML Building Footprints (detectate din imagini satelit, licență ODbL).
Completează casele care lipsesc din OpenStreetMap. Fișierele mari se descarcă o singură dată în cache_ms/.

Rulare (din folderul agent):
    python cladiri_ms.py --bbox 26.0575,44.2740,26.0715,44.2875 --out data_ptab7812\\cladiri_ms.geojson
"""
import argparse, csv, gzip, io, json, math, os, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LINKS = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"
CACHE = os.path.join(HERE, "cache_ms")


def quadkey(lon, lat, z=9):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    q = ""
    for i in range(z, 0, -1):
        m = 1 << (i - 1)
        q += str((1 if x & m else 0) + (2 if y & m else 0))
    return q


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "gridtwin-hackathon"})
    return urllib.request.urlopen(req, timeout=300).read()


def _cached(name, url):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        print(f"  descarc {name} (o singură dată)", flush=True)
        data = get(url)
        open(p + ".part", "wb").write(data)
        os.replace(p + ".part", p)
    return p


def cladiri(box):
    """box = (lon0, lat0, lon1, lat1) -> listă de Feature GeoJSON (poligoane) cu centrul în box"""
    lon0, lat0, lon1, lat1 = box
    qks = {quadkey(lo, la) for lo in (lon0, (lon0 + lon1) / 2, lon1) for la in (lat0, (lat0 + lat1) / 2, lat1)}
    rows = list(csv.DictReader(io.StringIO(open(_cached("dataset-links.csv", LINKS), encoding="utf-8").read())))
    pick = [r for r in rows if r["QuadKey"] in qks and r["Location"].strip() == "Romania"] or [r for r in rows if r["QuadKey"] in qks]
    feats = []
    for r in pick:
        p = _cached(f"{r['Location'].strip()}_{r['QuadKey']}_{os.path.basename(r['Url'])}", r["Url"])
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                f = json.loads(line)
                ring = f["geometry"]["coordinates"][0]
                cx = sum(c[0] for c in ring) / len(ring); cy = sum(c[1] for c in ring) / len(ring)
                if lon0 <= cx <= lon1 and lat0 <= cy <= lat1:
                    feats.append({"type": "Feature", "geometry": f["geometry"],
                                  "properties": {"sursa": "Microsoft Building Footprints (satelit)"}})
    return feats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", required=True, help="lon0,lat0,lon1,lat1")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    box = tuple(map(float, a.bbox.split(",")))
    feats = cladiri(box)
    json.dump({"type": "FeatureCollection", "features": feats}, open(a.out, "w", encoding="utf-8"))
    print(f"{len(feats)} clădiri în zonă -> {a.out}")


if __name__ == "__main__":
    main()
