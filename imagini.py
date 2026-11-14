"""Imagini satelit pentru o zonă: dale Esri la zoom 18 (~0,43 m/pixel în București), lipite într-o singură imagine,
plus conversii pixel <-> lon/lat. Dacă zoom-ul cerut are dale gri („Map data not yet available”), coboară un nivel.
"""
import math, time, urllib.request
from io import BytesIO

ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
UA = "gridtwin-hackathon (research)"


def tile_xy(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def get(url, timeout=30, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def is_blank(im):
    h = im.convert("L").histogram(); pk = max(range(256), key=lambda i: h[i])
    return sum(h[max(pk - 4, 0): pk + 5]) / max(sum(h), 1) > 0.85


class Mozaic:
    """imaginea + georeferința ei (coloana/rândul dalei din colțul stânga-sus, zoom)"""

    def __init__(self, img, tx0, ty0, z):
        self.img, self.tx0, self.ty0, self.z = img, tx0, ty0, z

    def to_px(self, lon, lat):
        X, Y = tile_xy(lon, lat, self.z)
        return (X - self.tx0) * 256, (Y - self.ty0) * 256

    def to_lonlat(self, x, y):
        n = 2 ** self.z
        X, Y = self.tx0 + x / 256, self.ty0 + y / 256
        return X / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * Y / n))))

    def gsd(self):
        lat = self.to_lonlat(self.img.width / 2, self.img.height / 2)[1]
        return 156543.03392 * math.cos(math.radians(lat)) / 2 ** self.z


def mozaic(box, zooms=(18, 17), url=ESRI, max_tiles=900, pause=0.03):
    """box = (lon0, lat0, lon1, lat1) -> Mozaic. Ridică RuntimeError dacă nu se poate descărca."""
    from PIL import Image
    lon0, lat0, lon1, lat1 = box
    last = None
    for z in zooms:
        tx0, ty0 = (int(v) for v in tile_xy(lon0, lat1, z))
        tx1, ty1 = (int(v) for v in tile_xy(lon1, lat0, z))
        n = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
        if n > max_tiles:
            raise RuntimeError(f"zona e prea mare ({n} dale); împarte-o în bucăți")
        img = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
        bad = 0
        for tx in range(tx0, tx1 + 1):
            for ty in range(ty0, ty1 + 1):
                try:
                    t = Image.open(BytesIO(get(url.format(z=z, x=tx, y=ty)))).convert("RGB")
                    bad += is_blank(t)
                    img.paste(t, ((tx - tx0) * 256, (ty - ty0) * 256))
                except Exception as e:
                    bad += 1; last = e
                time.sleep(pause)
        if bad <= 0.1 * n:
            return Mozaic(img, tx0, ty0, z)
    raise RuntimeError(f"nu am putut descărca imaginea din satelit ({last or 'dale gri'})")
