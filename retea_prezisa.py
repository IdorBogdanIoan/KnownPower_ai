"""Rețea prezisă pentru casele aflate în afara rețelei primite.

KMZ-ul acoperă un singur post (PTAB 7812). Casele mai departe de 60 m de orice element al lui sunt alimentate
aproape sigur din alt post, a cărui rețea nu o avem. Ca să nu rămână „gol” pe hartă, agentul propune o rețea
probabilă: o linie aeriană pe partea străzii cu cele mai multe case, stâlpi la ~35 m, branșament de la fiecare
casă la cel mai apropiat stâlp. Unde o detecție din satelit cade lângă un stâlp prezis, stâlpul e mutat pe ea
și încrederea crește.

Totul e marcat „prezis”: nu sunt date ale companiei, ci propuneri de confirmat în teren.
"""
import math
from collections import Counter, defaultdict

SPACING_M = 35.0      # distanța tipică între stâlpi JT în localități
SIDE_M = 3.5          # stâlpul stă la marginea drumului, nu pe ax
HOUSE_STREET_M = 45.0  # casa trebuie să fie la cel mult atât de stradă ca s-o legăm de linia ei
RUN_GAP_M = 90.0      # case mai rare de atât pe aceeași stradă -> linii separate
SNAP_M = 10.0         # detecție la sub 10 m de un stâlp prezis -> stâlpul e probabil acolo
MIN_HOUSES = 2        # o linie prezisă doar dacă servește cel puțin 2 case
REUSE_M = 15.0        # stâlp prezis la sub 15 m de altul deja propus -> același stâlp
BASE_CONF, DET_BONUS = 0.30, 0.25


def _d(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _project(p, pts):
    """(distanța, poziția pe linie în m de la început, latura +1/-1, punctul proiectat)"""
    best, s0 = None, 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ax, ay = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ax, ay)
        if L == 0:
            continue
        t = max(0.0, min(1.0, ((p[0] - a[0]) * ax + (p[1] - a[1]) * ay) / (L * L)))
        q = (a[0] + t * ax, a[1] + t * ay)
        dd = _d(p, q)
        side = 1 if ax * (p[1] - a[1]) - ay * (p[0] - a[0]) >= 0 else -1
        if best is None or dd < best[0]:
            best = (dd, s0 + t * L, side, q)
        s0 += L
    return best


def _at(pts, s, offset):
    """punctul de pe linie la distanța s, deplasat lateral cu offset (stânga = +)"""
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        L = _d(a, b)
        if L == 0:
            continue
        if s <= L or i == len(pts) - 2:
            t = max(0.0, min(1.0, s / L))
            nx, ny = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
            return (a[0] + t * (b[0] - a[0]) + nx * offset, a[1] + t * (b[1] - a[1]) + ny * offset)
        s -= L
    return pts[-1]


def _length(pts):
    return sum(_d(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def prezice(D, known_xy, max_from_known, conf_min, start_id=1):
    """known_xy: {id: (x, y)} nodurile rețelei primite. Întoarce (propuneri, scoruri, features geojson)."""
    P = D["P"]
    far = {bid: b for bid, b in D["buildings"].items()
           if bid not in D["conn"] and min(_d(b["xy"], xy) for xy in known_xy.values()) > max_from_known}

    # atributele cele mai frecvente pe liniile aeriene primite (pentru linia prezisă)
    aer = [L for L in D["lines"].values() if L.get("tip_retea", "aerian") == "aerian"]
    attrs = {}
    for k in ("conductor_type", "section_mm2", "material"):
        vals = Counter(L.get(k) for L in aer if L.get(k) is not None)
        if vals:
            attrs[k] = vals.most_common(1)[0][0]

    # 1. fiecare casă pe strada cea mai apropiată
    by_street = defaultdict(list)
    for bid, b in far.items():
        cand = []
        for si, (name, pts) in enumerate(D["streets"]):
            if len(pts) < 2:
                continue
            pr = _project(b["xy"], pts)
            if pr:
                cand.append((pr[0], si, pr))
        if not cand:
            continue
        dd, si, (_, s, side, _q) = min(cand, key=lambda c: c[0])
        if dd <= HOUSE_STREET_M:
            by_street[si].append((s, side, bid))

    dets = [d for d in D["det"] if d.get("conf", 0) >= conf_min]
    props, scores, feats = [], [], []
    n = start_id
    all_runs = []
    for si, houses in sorted(by_street.items()):
        houses.sort()
        cur = [houses[0]]
        for h in houses[1:]:
            if h[0] - cur[-1][0] > RUN_GAP_M:
                all_runs.append((si, cur)); cur = [h]
            else:
                cur.append(h)
        all_runs.append((si, cur))
    # liniile cu cele mai multe case primele; o stradă desenată în OSM ca două benzi nu primește două linii:
    # un stâlp nou la sub REUSE_M de unul deja propus îl refolosește
    all_runs.sort(key=lambda r: -len(r[1]))
    placed = []          # (pid, xy, conf, det, index propunere)
    seg_done = set()
    if True:
        for si, run in all_runs:
            name, pts = D["streets"][si]
            total = _length(pts)
            if len(run) < MIN_HOUSES:
                continue
            side = 1 if sum(h[1] for h in run) >= 0 else -1
            s0, s1 = max(0.0, run[0][0] - 10), min(total, run[-1][0] + 10)
            k = max(1, math.ceil((s1 - s0) / SPACING_M))
            rid = f"PRZ-{n:02d}"; n += 1
            poles = []
            used = set()
            for j in range(k + 1):
                xy = _at(pts, s0 + (s1 - s0) * j / k, side * SIDE_M)
                reuse = min(((_d(xy, q[1]), q) for q in placed), default=(1e9, None), key=lambda t: t[0])
                if reuse[0] <= REUSE_M:
                    if not poles or poles[-1][0] != reuse[1][0]:
                        poles.append(reuse[1][:4])
                    continue
                near = sorted((_d(xy, d["xy"]), i) for i, d in enumerate(dets) if i not in used)
                conf, det = BASE_CONF, None
                if near and near[0][0] <= SNAP_M:
                    used.add(near[0][1]); det = dets[near[0][1]]
                    xy, conf = det["xy"], min(0.6, BASE_CONF + DET_BONUS * (0.5 + det["conf"]))
                pid = f"{rid}-S{j + 1:02d}"
                poles.append((pid, xy, conf, det))
                placed.append((pid, xy, conf, det, len(props)))
                feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": P.ll(xy)},
                              "properties": {"id": pid, "kind": "stalp", "prezis": True, "incredere": round(conf, 2),
                                             "detectie": round(det["conf"], 2) if det else None,
                                             "sursa": "prezis de agent" + (" + detecție satelit" if det else "")}})
            # tronsoane între stâlpii consecutivi
            line_ids = []
            new_here = [p for p in poles if p[0].startswith(rid + "-")]
            if not new_here:
                # toți stâlpii există deja în altă linie prezisă: casele se adaugă la acea propunere
                owner = next(q[4] for q in placed if q[0] == poles[0][0])
                for _s, _side, bid in run:
                    b = D["buildings"][bid]
                    dd, pid, xy = min((_d(b["xy"], q), p, q) for p, q, _c, _d0 in poles)
                    props[owner]["propus"]["case"].append(bid)
                    feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [P.ll(b["xy"]), P.ll(xy)]},
                                  "properties": {"id": f"{rid}-B-{bid}", "kind": "bransament", "building": bid, "pole": pid,
                                                 "tip_racord": "aerian (presupus)", "prezis": True, "lungime_m": round(dd, 1),
                                                 "sursa": "prezis de agent"}})
                n -= 1
                continue
            for (pa, a, ca, _), (pb, b, cb, _) in zip(poles, poles[1:]):
                if (pa, pb) in seg_done or (pb, pa) in seg_done:
                    continue
                seg_done.add((pa, pb))
                lid = f"{pa}-{pb.split('-')[-1]}" if pb.startswith(pa.rsplit("-", 1)[0] + "-") else f"{pa}-{pb}"
                c = round((ca + cb) / 2, 2)
                line_ids.append(lid)
                why = ["prezis de agent: zona nu e în rețeaua primită (alt post)", f"pe {name}"]
                why += [f"{p}: confirmat de imagine" for p, _, cc, d in ((pa, a, ca, None), (pb, b, cb, None)) if cc > BASE_CONF]
                scores.append({"id": lid, "pts": [a, b], "scor": c, "culoare": "verde" if c >= 0.7 else "galben" if c >= 0.4 else "rosu",
                               "motive": why, "tip_retea": "aerian", "prezis": True})
                feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [P.ll(a), P.ll(b)]},
                              "properties": {"id": lid, "kind": "tronson", "tip_retea": "aerian", "prezis": True,
                                             "from": pa, "to": pb, **attrs, "sursa": "prezis de agent"}})
            # branșamente: fiecare casă la cel mai apropiat stâlp prezis
            case = []
            for _s, _side, bid in run:
                b = D["buildings"][bid]
                dd, pid, xy = min((_d(b["xy"], q), p, q) for p, q, _c, _d0 in poles)
                case.append(bid)
                feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [P.ll(b["xy"]), P.ll(xy)]},
                              "properties": {"id": f"{rid}-B-{bid}", "kind": "bransament", "building": bid, "pole": pid,
                                             "tip_racord": "aerian (presupus)", "prezis": True, "lungime_m": round(dd, 1),
                                             "sursa": "prezis de agent"}})
            nconf = sum(1 for p in new_here if p[3])
            conf = round(sum(p[2] for p in poles) / len(poles), 2)
            geom = {"type": "LineString", "coordinates": [P.ll(p[1]) for p in poles]}
            props.append({
                "tip": "tronson_lipsa", "obiect": line_ids[0] if line_ids else rid, "geometrie": geom,
                "propus": {"prezis": True, "retea": rid, "strada": name, "stalpi": [p[0] for p in poles],
                           "tronsoane_afectate": line_ids, "case": case, "post": "necunoscut (alt post decât cel din KMZ)",
                           "stalpi_confirmati_imagine": nconf, "lungime_m": round(s1 - s0, 1), **attrs},
                "sursa": "prezis: străzi OSM + case" + (" + detecții satelit" if nconf else ""),
                "incredere": conf,
                "motiv": (f"{len(case)} case de pe {name} sunt la peste {max_from_known:.0f} m de rețeaua primită, deci "
                          f"sunt alimentate din alt post. Rețea probabilă: {len(poles)} stâlpi pe {s1 - s0:.0f} m"
                          + (f", dintre care {nconf} văzuți în imagine" if nconf else ", niciunul văzut încă în imagine")
                          + ". De confirmat în teren sau cu GIS-ul postului vecin."),
                "status": "in_asteptare"})
    return props, scores, feats, len(far)
