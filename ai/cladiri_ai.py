"""Găsește casele dintr-o zonă cu modelul nostru (cladiri_best.pt, antrenat pe Kaggle) și le scrie ca GeoJSON,
în același format ca cladiri_ms.py, ca să le poată folosi agentul (real_zone.py --cladiri-extra) și motorul AI.

    python cladiri_ai.py --bbox 26.0575,44.2740,26.0715,44.2875 --out data_ptab7812\\cladiri_ai.geojson
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import imagini  # noqa: E402

MODEL = os.path.join(HERE, "cladiri_best.pt")
_model = None


def model():
    global _model
    if _model is None:
        from ultralytics import YOLO
        _model = YOLO(MODEL)
    return _model


def _centroid(p):
    return sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)


def _inside(pt, ring):
    x, y, ok = pt[0], pt[1], False
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i - 1], ring[i]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            ok = not ok
    return ok


def cladiri(box, conf=0.25, M=None):
    """-> listă de Feature GeoJSON (poligoane) cu casele găsite de model în box"""
    if not os.path.exists(MODEL):
        raise FileNotFoundError("lipsește cladiri_best.pt (îl descarci de pe Kaggle, din /kaggle/working/final)")
    M = M or imagini.mozaic(box)
    W, H = M.img.size
    found = []
    for y in range(0, max(H - 128, 1), 512):
        for x in range(0, max(W - 128, 1), 512):
            crop = M.img.crop((x, y, min(x + 640, W), min(y + 640, H)))
            r = model().predict(crop, imgsz=640, conf=conf, verbose=False)[0]
            if r.masks is None:
                continue
            for poly, c in zip(r.masks.xy, r.boxes.conf.tolist()):
                if len(poly) >= 3:
                    found.append(([(px + x, py + y) for px, py in poly.tolist()], c))
    found.sort(key=lambda t: -t[1])
    keep = []
    for p, c in found:   # dubluri din suprapunerea bucăților
        if not any(_inside(_centroid(p), k[0]) for k in keep):
            keep.append((p, c))
    feats = []
    for p, c in keep:
        ring = [list(M.to_lonlat(*q)) for q in p]
        ring.append(ring[0])
        cx, cy = _centroid(ring[:-1])
        if box[0] <= cx <= box[2] and box[1] <= cy <= box[3]:
            feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[round(a, 7), round(b, 7)] for a, b in ring]]},
                          "properties": {"sursa": "model GridTwin (case din satelit)", "conf": round(c, 3)}})
    return feats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", required=True, help="lon0,lat0,lon1,lat1")
    ap.add_argument("--out", required=True)
    ap.add_argument("--conf", type=float, default=0.25)
    a = ap.parse_args()
    feats = cladiri(tuple(map(float, a.bbox.split(","))), a.conf)
    json.dump({"type": "FeatureCollection", "features": feats}, open(a.out, "w", encoding="utf-8"))
    print(f"{len(feats)} case găsite de model -> {a.out}")


if __name__ == "__main__":
    main()
