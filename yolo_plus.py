"""Inferență YOLO mai robustă, fără reantrenare (idei luate din Lunar: TTA ales pe validare + ansamblu de modele).

- TTA D4: imaginea văzută de sus nu are „sus”, deci rulăm modelul pe cele 8 rotiri/oglindiri (sau 2 pentru „flip”),
  aducem centrele înapoi și le comasăm. Un stâlp găsit în 6 din 8 vederi e mult mai sigur decât unul găsit într-una.
- Ansamblu: mai multe modele (ex. grid_best_v2.pt + grid_best_ro.pt), comasate la fel.
- Fuziunea: punctele la mai puțin de --merge-m (implicit 3 m) se unesc; încrederea finală = suma încrederilor / numărul
  total de vederi (modele × transformări). Așa, detecțiile instabile scad sub prag.

Folosit de run_zone.py (--tta, --model a.pt,b.pt), ro_dataset.py (--tta, --compare-tta) și notebook-ul Kaggle.
"""
import math

GSD_M = 0.3
TTA_SETS = {
    "none": [(0, False)],
    "flip": [(0, False), (0, True)],
    "d4": [(k, f) for k in range(4) for f in (False, True)],
}


def _forward(img, k, flip):
    from PIL import Image
    im = img.transpose(Image.FLIP_LEFT_RIGHT) if flip else img
    for _ in range(k):
        im = im.transpose(Image.ROTATE_90)       # în sens trigonometric
    return im


def _back(x, y, W, H, k, flip):
    """punct din imaginea transformată -> imaginea originală (W×H)"""
    # anulăm rotirile: o rotire CCW duce (x,y) din w×h în (y, w-x) în h×w; inversa: (x',y') -> (w - y', x')
    dims = [(W, H)]
    for _ in range(k):
        w, h = dims[-1]; dims.append((h, w))
    for i in range(k, 0, -1):
        w, h = dims[i - 1]            # dimensiunile înainte de rotirea i
        x, y = w - y, x
    if flip:
        x = W - x
    return x, y


def load(paths):
    from ultralytics import YOLO
    if isinstance(paths, str):
        paths = [p for p in paths.split(",") if p]
    return [YOLO(p) for p in paths]


def predict_points(models, img, tta="none", imgsz=1024, conf=0.05, merge_m=3.0, cls_keep=(0,)):
    """-> [(x, y, încredere fuzionată, nr. vederi)] în pixelii lui img (0,3 m/pixel)"""
    W, H = img.size
    views = TTA_SETS[tta]
    pts = []
    for m in models:
        for k, flip in views:
            r = m.predict(_forward(img, k, flip), imgsz=imgsz, conf=conf, verbose=False)[0]
            for b, c, cl in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist(), r.boxes.cls.tolist()):
                if cls_keep and int(cl) not in cls_keep:
                    continue
                x, y = _back((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, W, H, k, flip)
                pts.append((x, y, c))
    return fuse(pts, len(models) * len(views), merge_m / GSD_M)


def fuse(pts, n_views, r_px):
    """grupare lacomă după încredere; centrul = media ponderată; încrederea = suma / n_views"""
    pts = sorted(pts, key=lambda p: -p[2])
    groups = []
    for x, y, c in pts:
        for g in groups:
            if math.hypot(g["x"] - x, g["y"] - y) <= r_px:
                g["sx"] += x * c; g["sy"] += y * c; g["s"] += c; g["n"] += 1
                g["x"], g["y"] = g["sx"] / g["s"], g["sy"] / g["s"]
                break
        else:
            groups.append({"x": x, "y": y, "sx": x * c, "sy": y * c, "s": c, "n": 1})
    return [(g["x"], g["y"], min(g["s"] / n_views, 1.0), g["n"]) for g in groups]
