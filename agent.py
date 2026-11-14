"""Agentul GridTwin: compara GIS-ul companiei cu sursele externe si propune corectii.

Citeste din data/: gis_company, detections, buildings, streets, unknown, pv_detections.
NU citeste truth.geojson si _errors_injected.json (alea sunt doar pentru evaluate.py).

Scrie in out/:
  proposals.json     lista de propuneri (id, tip, obiect, geometrie, propus, sursa, incredere, motiv, status)
  proposals.geojson  aceleasi propuneri, direct pentru harta
  scores.geojson     scorul de incredere pe fiecare tronson (verde / galben / rosu)

Agentul doar propune. Nimic nu se scrie in GIS fara aprobarea unui om.

python agent.py [--data data] [--out out] [--azi 2026-11-14]
"""
import argparse, datetime, json, math, os, re, unicodedata
from collections import Counter, defaultdict
import rapoarte

# Praguri. Toate sunt presupuneri, de calibrat pe date reale si cu mentorii.
CONF_MIN = 0.40      # sub asta ignoram detectia
CONF_NEW = 0.40      # pentru stalp nou sau mutat cerem mai mult decat pentru confirmare (modelul are precizie mica la prag mic)
STREET_M = 10.0      # stalpii JT stau langa drum; o detectie mai departe e probabil copac / stalp de iluminat
MATCH_M = 8.0        # detectie <-> stalp GIS la sub 8 m: acelasi stalp, confirmat
MOVE_M = 30.0        # 8-30 m: probabil acelasi stalp, desenat in alt loc in GIS
SUSPECT_M = 8.0      # stalp GIS mai departe de atat fata de axul drumului: pozitie suspecta
NEIGH_M = 55.0       # distanta maxima intre doi stalpi vecini (la colturi, diagonala ajunge la ~50 m)
BRANS_MAX_M = 60.0   # bransament mai lung de atat nu il propunem automat
ATTRS = ("conductor_type", "section_mm2", "material")
DROP_HOUSE_M = 9.0   # un capat al cablului vazut trebuie sa fie la casa (centrul cladirii)
DROP_POLE_M = 8.0    # celalalt capat la un stalp


# ----------------------------------------------------------------------------- geometrie
class Proj:
    """lon/lat <-> metri locali (echirectangular). La cativa km eroarea e neglijabila."""

    def __init__(self, lon0, lat0):
        self.lon0, self.lat0 = lon0, lat0
        self.mlat = 111_320.0
        self.mlon = 111_320.0 * math.cos(math.radians(lat0))

    def xy(self, c):
        return ((c[0] - self.lon0) * self.mlon, (c[1] - self.lat0) * self.mlat)

    def ll(self, p):
        return [round(self.lon0 + p[0] / self.mlon, 7), round(self.lat0 + p[1] / self.mlat, 7)]


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def dist_seg(p, a, b):
    ax, ay = b[0] - a[0], b[1] - a[1]
    L2 = ax * ax + ay * ay
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * ax + (p[1] - a[1]) * ay) / L2))
    return dist(p, (a[0] + t * ax, a[1] + t * ay))


def dist_polyline(p, pts):
    return min(dist_seg(p, pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def inside(p, ring):
    x, y, ok = p[0], p[1], False
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i - 1], ring[i]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            ok = not ok
    return ok


def centroid(ring):
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def crosses(a, b, c, d):
    """segmentele ab si cd se intersecteaza strict (nu doar se ating la capete)"""
    def o(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    d1, d2, d3, d4 = o(c, d, a), o(c, d, b), o(a, b, c), o(a, b, d)
    return d1 * d2 < -1e-6 and d3 * d4 < -1e-6


def angle_deg(o, a, b):
    v1, v2 = (a[0] - o[0], a[1] - o[1]), (b[0] - o[0], b[1] - o[1])
    c = (v1[0] * v2[0] + v1[1] * v2[1]) / (math.hypot(*v1) * math.hypot(*v2) + 1e-9)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


# ----------------------------------------------------------------------------- date
def load(data_dir, rap_dir=None, llm=False):
    def fc(name):
        return json.load(open(os.path.join(data_dir, name), encoding="utf-8"))["features"]

    gis = fc("gis_company.geojson")
    streets = fc("streets.geojson")
    all_coords = [c for f in streets for c in f["geometry"]["coordinates"]]
    P = Proj(sum(c[0] for c in all_coords) / len(all_coords), sum(c[1] for c in all_coords) / len(all_coords))

    D = {"P": P, "poles": {}, "lines": {}, "conn": {}}
    for f in gis:
        pr, g = f["properties"], f["geometry"]
        if pr["kind"] in ("stalp", "post_transformare"):
            D["poles"][pr["id"]] = dict(pr, xy=P.xy(g["coordinates"]))
        elif pr["kind"] == "tronson":
            D["lines"][pr["id"]] = dict(pr, pts=[P.xy(c) for c in g["coordinates"]])
        elif pr["kind"] == "bransament":
            D["conn"][pr["building"]] = dict(pr)
    D["streets"] = [(f["properties"]["name"], [P.xy(c) for c in f["geometry"]["coordinates"]]) for f in streets]
    D["buildings"] = {f["properties"]["id"]: dict(f["properties"], xy=centroid([P.xy(c) for c in f["geometry"]["coordinates"][0]]))
                      for f in fc("buildings.geojson")}
    D["det"] = [dict(f["properties"], xy=P.xy(f["geometry"]["coordinates"])) for f in fc("detections.geojson")]
    D["unknown"] = [dict(f["properties"], ring=[P.xy(c) for c in f["geometry"]["coordinates"][0]]) for f in fc("unknown.geojson")]
    D["pv"] = {f["properties"]["building"]: f["properties"] for f in fc("pv_detections.geojson")}
    # optionale: cabluri de bransament vazute in imagine si contractele din facturare
    p = os.path.join(data_dir, "drop_detections.geojson")
    D["drops"] = [dict(f["properties"], a=P.xy(f["geometry"]["coordinates"][0]), b=P.xy(f["geometry"]["coordinates"][-1]))
                  for f in json.load(open(p, encoding="utf-8"))["features"]] if os.path.exists(p) else []
    p = os.path.join(data_dir, "contracts.json")
    D["contracts"] = {}
    for c in (json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []):
        D["contracts"].setdefault(norm_addr(c["adresa"]), c)
    # verificarea de la nivelul strazii (streetview.py, optional)
    p = os.path.join(data_dir, "streetview.geojson")
    D["sv"] = [dict(f["properties"], xy=P.xy(f["geometry"]["coordinates"]))
               for f in json.load(open(p, encoding="utf-8"))["features"]] if os.path.exists(p) else []
    # rapoartele text (ATR, PV, fise): tipul racordului apare doar aici
    rap_dir = rap_dir or os.path.join(data_dir, "rapoarte")
    docs = rapoarte.citeste(rap_dir) if os.path.isdir(rap_dir) else []
    D["rap_rows"], D["rap"] = rapoarte.extrage(docs, rapoarte.Adrese(D["buildings"]), llm=llm) if docs else ([], {})
    return D


def norm_addr(s):
    """adrese scrise diferit -> aceeasi cheie: "Str. Teilor nr. 12" = "STRADA TEILOR 12" = "teilor, nr 12" """
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(str|strada|nr|numar|numarul)\b\.?", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def sv_at(D, xy, r=6.0):
    """rezultatul street view cel mai apropiat de un punct (sau None)"""
    best = min(((dist(xy, s["xy"]), s) for s in D.get("sv", [])), key=lambda t: t[0], default=None)
    return best[1] if best and best[0] <= r else None


def sv_confirms(s):
    v = (s or {}).get("vizual") or {}
    return bool(s) and (s.get("mapillary_stalp") or (v.get("stalp_vizibil") == "da" and float(v.get("incredere") or 0) >= 0.5))


def street_dist(D, p):
    return min((dist_polyline(p, pts), name) for name, pts in D["streets"])


def in_unknown(D, p):
    return next((u for u in D["unknown"] if inside(p, u["ring"])), None)


# ----------------------------------------------------------------------------- pasii agentului
def match_detections(D):
    """Potrivire in doi pasi. Intai <= MATCH_M (confirmat), apoi <= MOVE_M (stalp desenat gresit)."""
    det = []
    for i, d in enumerate(D["det"]):
        sd, sname = street_dist(D, d["xy"])
        d.update(i=i, street_d=sd, street=sname)
        if d["conf"] < CONF_MIN:
            d["drop"] = f"încredere {d['conf']:.2f}, sub pragul {CONF_MIN}"
        elif sd > STREET_M:
            d["drop"] = f"la {sd:.0f} m de cel mai apropiat drum (probabil copac sau stâlp de iluminat)"
        else:
            det.append(d)

    poles = {k: p for k, p in D["poles"].items() if p["kind"] == "stalp"}
    free_p, free_d = set(poles), {d["i"] for d in det}
    confirmed, moved = {}, {}
    for max_d, out in ((MATCH_M, confirmed), (MOVE_M, moved)):
        pairs = sorted((dist(poles[k]["xy"], d["xy"]), k, d["i"]) for k in free_p for d in det
                       if d["i"] in free_d and (out is confirmed or d["conf"] >= CONF_NEW))
        for dd, k, i in pairs:
            if dd > max_d:
                break
            if k in free_p and i in free_d:
                out[k] = (D["det"][i], dd)
                free_p.discard(k); free_d.discard(i)
    weak = [i for i in sorted(free_d) if D["det"][i]["conf"] < CONF_NEW]
    for i in weak:
        D["det"][i]["drop"] = f"încredere {D['det'][i]['conf']:.2f}: ajunge pentru confirmare, nu pentru stâlp nou (prag {CONF_NEW})"
    return confirmed, moved, [D["det"][i] for i in sorted(free_d) if i not in weak], sorted(free_p)


def across_street(D, p, q):
    return any(crosses(p, q, pts[i], pts[i + 1]) for _, pts in D["streets"] for i in range(len(pts) - 1))


def neighbours(D, p, nodes):
    """cel mai apropiat nod si, daca exista, unul aflat 'de partea cealalta' (stalpii vecini pe linie).
    Pe JT linia merge pe o parte a strazii, deci nu legam peste ax (doar postul de transformare face exceptie)."""
    cand = sorted((dist(p, xy), k) for k, xy in nodes.items()
                  if dist(p, xy) <= NEIGH_M and (k.startswith("PT") or not across_street(D, p, xy)))
    if not cand:
        return []
    out = [cand[0][1]]
    for _, k in cand[1:]:
        if angle_deg(p, nodes[out[0]], nodes[k]) > 75:   # 75 si nu 180 ca sa prindem si colturile de strada
            out.append(k)
            break
    return out


def feeder_attrs(D, line_ids):
    """valorile atributelor pe o lista de tronsoane: {atribut: Counter}"""
    vals = {a: Counter() for a in ATTRS}
    for lid in line_ids:
        for a in ATTRS:
            v = D["lines"][lid].get(a)
            if v is not None:
                vals[a][v] += 1
    return vals


def infer(vals, base_conf, source):
    """cea mai frecventa valoare, cu incredere = base_conf * acord, mai mica daca avem un singur exemplu"""
    out = {}
    for a, cnt in vals.items():
        if not cnt:
            continue
        v, n = cnt.most_common(1)[0]
        tot = sum(cnt.values())
        conf = base_conf * n / tot - (0.1 if tot == 1 else 0.0)
        out[a] = {"valoare": v, "sursa": source, "incredere": round(max(conf, 0.1), 2), "exemple": f"{n}/{tot}"}
    return out


def run(D, today):
    P = D["P"]
    props = []

    def add(tip, obiect, geom, propus, sursa, incredere, motiv):
        props.append({"tip": tip, "obiect": obiect, "geometrie": geom, "propus": propus, "sursa": sursa,
                      "incredere": round(min(max(incredere, 0.05), 0.99), 2), "motiv": motiv, "status": "in_asteptare"})

    def pt(xy):
        return {"type": "Point", "coordinates": P.ll(xy)}

    def ln(*xys):
        return {"type": "LineString", "coordinates": [P.ll(p) for p in xys]}

    lines_at = defaultdict(list)
    for lid, L in D["lines"].items():
        lines_at[L["from"]].append(lid); lines_at[L["to"]].append(lid)

    confirmed, moved, free_det, free_poles = match_detections(D)
    pos = {k: p["xy"] for k, p in D["poles"].items()}      # pozitiile dupa corectii
    pole_state = {k: "confirmat" for k in confirmed}

    # 1. stalpi desenati in alt loc
    for k, (d, dd) in sorted(moved.items()):
        old = D["poles"][k]["xy"]
        pos[k] = d["xy"]; pole_state[k] = "mutat"
        add("corectie_pozitie", k, ln(old, d["xy"]),
            {"pozitie_noua": P.ll(d["xy"]), "tronsoane_afectate": sorted(lines_at[k]),
             "bransamente_afectate": sorted(b for b, c in D["conn"].items() if c["pole"] == k)},
            "imagine aeriana (YOLO) + GIS companie", 0.9 * d["conf"],
            f"Stâlpul {k} nu are detecție în 8 m, dar are una la {dd:.0f} m, lângă {d['street']} "
            f"({d['street_d']:.0f} m de ax). Probabil desenat greșit în GIS.")

    # 2. stalpi care lipsesc din GIS
    new_nodes = {}
    for n, d in enumerate(sorted(free_det, key=lambda d: (round(d["xy"][0]), round(d["xy"][1]))), 1):
        if in_unknown(D, d["xy"]):
            continue
        nid = f"NOU-{n:02d}"
        new_nodes[nid] = (d, d["xy"])
    # stalpii izolati (fara tronsoane) si nedetectati nu sunt vecini buni: probabil nu mai exista
    linked = {k: xy for k, xy in pos.items() if lines_at[k] or k not in free_poles}
    nodes = dict(linked, **{k: v[1] for k, v in new_nodes.items()})
    for nid, (d, xy) in new_nodes.items():
        nb = neighbours(D, xy, {k: v for k, v in nodes.items() if k != nid})
        gap = len(nb) == 2 and all(25 <= dist(xy, nodes[k]) <= NEIGH_M for k in nb)
        feeder = next((D["poles"][k].get("feeder") for k in nb if k in D["poles"] and D["poles"][k].get("feeder") not in (None, "?")), None)
        new_nodes[nid] = (d, xy, nb, feeder)
        add("stalp_lipsa", nid, pt(xy),
            {"kind": "stalp", "feeder": feeder, "street": d["street"], "vecini": nb},
            "imagine aeriana (YOLO)", d["conf"] + (0.1 if gap else 0.0),
            f"Detecție YOLO ({d['conf']:.2f}) fără niciun stâlp GIS în {MOVE_M:.0f} m, la {d['street_d']:.0f} m de {d['street']}."
            + (" Umple un gol între doi stâlpi vecini." if gap else ""))

    # 3. tronsoane pentru stalpii noi (o singura data pe fiecare pereche)
    by_feeder = defaultdict(list)
    for lid, L in D["lines"].items():
        by_feeder[L.get("feeder")].append(lid)
    done = set()
    for nid, (d, xy, nb, feeder) in new_nodes.items():
        for k in nb:
            e = tuple(sorted((nid, k)))
            if e in done:
                continue
            done.add(e)
            attrs = infer(feeder_attrs(D, by_feeder.get(feeder, [])), 0.7, f"dedus (circuitul {feeder})") if feeder else {}
            add("tronson_lipsa", f"{e[0]}–{e[1]}", ln(nodes[e[0]], nodes[e[1]]),
                {"kind": "tronson", "from": e[0], "to": e[1], "feeder": feeder, "lungime_m": round(dist(nodes[e[0]], nodes[e[1]]), 1),
                 **attrs},
                "geometrie (stâlpi vecini)", 0.6 * d["conf"] + 0.2,
                f"Leagă stâlpul propus {nid} de vecinul {k}. Atributele sunt deduse din circuitul {feeder}.")

    # 4. topologie: tot ce nu e legat de post (prin tronsoanele din GIS + cele propuse) ascunde un gol
    reach, gaps = connectivity(D, new_nodes, props, nodes, free_poles)
    for comp, (a, b, dd) in gaps:
        add("gol_retea", f"{a}–{b}", ln(nodes[a], nodes[b]),
            {"stalpi_neconectati": comp, "actiune": "verificare în teren (poză la stâlp + foaia de lucrări)"},
            "topologie GIS + imagine aeriana", 0.6,
            (f"Stâlpii {', '.join(comp)} nu ajung" if len(comp) > 1 else f"Stâlpul {comp[0]} nu ajunge")
            + f" la post prin nicio linie din GIS. Cel mai probabil lipsește un stâlp "
            f"sau un tronson între {a} și {b} ({dd:.0f} m), pe care imaginea nu-l vede.")

    # 5. stalpi din GIS fara nicio detectie
    for k in free_poles:
        p = D["poles"][k]
        xy = p["xy"]
        sd, sname = street_dist(D, xy)
        year = int(str(p.get("last_verified", "2000"))[:4])
        sv = sv_at(D, xy)
        if sv_confirms(sv):
            pole_state[k] = "confirmat_sv"     # nu se vede de sus, dar se vede din strada
            continue
        u = in_unknown(D, xy)
        if u:
            pole_state[k] = "neverificabil"
            continue
        if not lines_at[k]:
            pole_state[k] = "posibil_demontat"
            add("posibil_demontat", k, pt(xy), {"actiune": "verificare în teren, apoi scoatere din GIS"},
                "imagine aeriana (YOLO) + GIS companie", 0.55 + (0.15 if year < 2018 else 0) + (0.1 if sd > SUSPECT_M else 0),
                f"Nicio detecție în {MOVE_M:.0f} m, niciun tronson legat de el, verificat ultima dată în {year}"
                + (f", la {sd:.0f} m de drum." if sd > SUSPECT_M else "."))
        elif sd > SUSPECT_M:
            pole_state[k] = "suspect"
            add("pozitie_suspecta", k, pt(xy), {"actiune": "verificare în teren (poză la stâlp)"},
                "GIS companie + drumuri OSM", 0.45,
                f"Nicio detecție și stâlpul e la {sd:.0f} m de axul {sname}, mult mai departe decât vecinii. "
                f"Imaginea nu-l vede (umbră, copac sau poziție greșită în GIS).")
        else:
            pole_state[k] = "neconfirmat"

    # 5b. tronsoane care se termina fara nod (in GIS-ul real: cablu desenat pana „in aer”)
    for lid, L in sorted(D["lines"].items()):
        for end, pts_end in ((L["from"], L["pts"][0]), (L["to"], L["pts"][-1])):
            if str(end).startswith("X-"):
                add("gol_retea", lid, pt(pts_end),
                    {"tronson": lid, "capat": "fără nod", "actiune": "verificare în teren: ce e la capătul cablului (firidă, manșon, client?)"},
                    "topologie GIS", 0.6,
                    f"Tronsonul {lid} ({L.get('tip_retea') or 'rețea'}) se termină fără niciun nod în GIS. "
                    "Probabil lipsește o îmbinare, o firidă sau un client.")

    # 6. atribute lipsa pe tronsoanele existente
    for lid, L in sorted(D["lines"].items()):
        miss = [a for a in ATTRS if L.get(a) is None]
        if not miss:
            continue
        # vecinii conteaza doar daca sunt de acelasi fel: aerian cu aerian, cablu subteran cu cablu subteran
        same = lambda x: D["lines"][x].get("tip_retea") == L.get("tip_retea")
        adj = [x for x in set(lines_at[L["from"]] + lines_at[L["to"]]) if x != lid and D["lines"][x].get("feeder") == L.get("feeder") and same(x)]
        near = infer(feeder_attrs(D, adj), 0.85, "dedus (tronsoane vecine, același circuit)")
        wide = infer(feeder_attrs(D, [x for x in by_feeder[L.get("feeder")] if x != lid and same(x)]), 0.7, f"dedus (circuitul {L.get('feeder')})")
        fill = {a: near.get(a) or wide.get(a) for a in miss if near.get(a) or wide.get(a)}
        # tipul conductorului din poza de strada, la unul din capete
        v = next(((sv_at(D, D["poles"][e]["xy"]) or {}).get("vizual") for e in (L["from"], L["to"])
                  if e in D["poles"] and (sv_at(D, D["poles"][e]["xy"]) or {}).get("vizual")), None)
        tip_sv = {"torsadat_izolat": "TYIR (torsadat)", "conductoare_neizolate": "conductor neizolat"}.get((v or {}).get("tip_linie"))
        if tip_sv and "conductor_type" in miss:
            c_sv = round(0.75 * float(v.get("incredere") or 0.5), 2)
            have = fill.get("conductor_type")
            if not have:
                fill["conductor_type"] = {"valoare": tip_sv, "incredere": c_sv, "sursa": "street view (Mapillary)", "exemple": "1 poză"}
            elif ("TYIR" in str(have.get("valoare")).upper()) != tip_sv.startswith("TYIR"):
                have["incredere"] = round(max(have["incredere"] - 0.25, 0.1), 2)
                have["conflict"] = f"poza de stradă arată {tip_sv}"
        if not fill:
            continue
        add("atribute_lipsa", lid, ln(*L["pts"]), fill, "dedus de agent",
            min(v["incredere"] for v in fill.values()),
            f"Lipsesc {', '.join(miss)}. Completate din " + ("tronsoanele vecine." if all(a in near for a in fill) else "restul circuitului."))

    # 7. clienti racordati in teren dar lipsa din GIS: intai imaginea, apoi contractul, altfel echipa in teren
    usable = {k: v for k, v in nodes.items() if pole_state.get(k) not in ("posibil_demontat", "suspect") and not k.startswith("PT")}

    # fiecare cablu vazut apartine o singura data: casei celei mai apropiate de unul din capete
    owner = {}
    for i, d in enumerate(D["drops"]):
        dd_, bid_, end = min((dist(e, bb["xy"]), k_, e) for k_, bb in D["buildings"].items() for e in (d["a"], d["b"]))
        if dd_ <= DROP_HOUSE_M:
            owner[i] = (bid_, end)

    def seen_drop(b):
        """un cablu vazut in imagine intre casa asta si un stalp"""
        best = None
        for i, d in enumerate(D["drops"]):
            if owner.get(i, (None,))[0] != b["id"]:
                continue
            house = owner[i][1]
            for pole_end in ((d["b"],) if house is d["a"] else (d["a"],)):
                dk, k = min((dist(pole_end, xy), k) for k, xy in usable.items())
                if dk <= DROP_POLE_M and (best is None or d["conf"] > best[0]["conf"]):
                    best = (d, k)
        return best

    for bid, b in sorted(D["buildings"].items()):
        pv = D["pv"].get(bid)
        if bid in D["conn"]:
            if pv and not D["conn"][bid].get("prosumator"):
                add("prosumator_neinregistrat", bid, pt(b["xy"]), {"prosumator": True},
                    "imagine aeriana (PV)", pv["conf"],
                    f"Panouri fotovoltaice detectate ({pv['conf']:.2f}) pe o clădire care nu e prosumator în GIS.")
            continue
        adresa = b.get("adresa") or b.get("street", "")
        c = D["contracts"].get(norm_addr(adresa)) if b.get("adresa") else None
        dd, k = min((dist(b["xy"], xy), k) for k, xy in usable.items())
        if dd > BRANS_MAX_M:
            continue   # departe de rețeaua JT din zonă: nu e (probabil) clientul ei
        extra = (" Are și panouri PV." if pv else "")

        # a) se vede cablul din aer
        sd = seen_drop(b)
        if sd:
            d, k = sd
            cut = k not in reach
            add("bransament_lipsa", bid, ln(b["xy"], usable[k]),
                {"kind": "bransament", "building": bid, "adresa": adresa, "pole": k, "lungime_m": round(dist(b["xy"], usable[k]), 1),
                 "tip_racord": "aerian", "verificare": "imagine", "contract": c["pod"] if c else None, "prosumator": bool(pv)},
                "imagine aeriana (cablu bransament)" + (" + contract" if c else ""),
                0.9 * d["conf"] + 0.1 - (0.15 if k.startswith("NOU") else 0.0) - (0.2 if cut else 0.0),
                f"{adresa}: nu e în GIS, dar în imagine se vede cablul de la stâlpul {k} la casă ({d['conf']:.2f}). Racord aerian."
                + (f" Are și contract ({c['pod']})." if c else " Nu am găsit contract după adresă.") + extra)
            continue

        # a2) poza de strada: se vede firul de la stalp la casa (model vizual pe Mapillary)
        sv = sv_at(D, b["xy"], r=12)
        v = (sv or {}).get("vizual") or {}
        if sv and sv.get("kind") == "client" and v.get("fir_catre_casa") == "da" and float(v.get("incredere") or 0) >= 0.5:
            add("bransament_lipsa", bid, ln(b["xy"], usable[k]),
                {"kind": "bransament", "building": bid, "adresa": adresa, "pole": k, "lungime_m": round(dd, 1),
                 "tip_racord": "aerian", "verificare": "street view", "detalii": v.get("fir_detalii"),
                 "poza": (sv.get("imagini") or [{}])[0].get("link"), "contract": c["pod"] if c else None, "prosumator": bool(pv)},
                "poză de stradă (Mapillary) + model vizual", 0.85 * float(v["incredere"]) - (0.15 if k.startswith("NOU") else 0.0),
                f"{adresa}: nu e în GIS, dar în poza de stradă se vede firul tras spre casă ({v.get('fir_detalii') or 'branșament aerian'}). Racord aerian." + extra)
            continue
        r = D["rap"].get(bid)
        if not (r and r["tip_racord"]) and sv and sv.get("kind") == "client" and v.get("semne_subteran") is True \
                and float(v.get("incredere") or 0) >= 0.5:
            r = {"doc": "street view", "tip_racord": "subteran", "incredere": 0.6 * float(v["incredere"]) + 0.2,
                 "dovada": v.get("observatii") or "firidă la gard / cablu care coboară pe stâlp", "data": None,
                 "cablu": None, "coduri": [], "metoda": "model vizual"}

        # b) nu se vede din aer: raportul (ATR/PV) sau poza de strada spune subteran -> e normal, il trecem in model
        if r and r["tip_racord"] == "subteran":
            k2 = next((x for x in r["coduri"] if x in usable), None)   # stalpul/nodul pomenit in raport
            kk = k2 or k
            add("bransament_lipsa", bid, ln(b["xy"], usable[kk]),
                {"kind": "bransament", "building": bid, "adresa": adresa, "pole": kk, "lungime_m": round(dist(b["xy"], usable[kk]), 1),
                 "tip_racord": "subteran", "verificare": "raport", "raport": r["doc"], "data_raport": r["data"],
                 "dovada": r["dovada"], "cablu": r["cablu"], "metoda_extragere": r["metoda"],
                 "contract": c["pod"] if c else None, "prosumator": bool(pv),
                 "nota": ("stâlpul e pomenit în raport" if k2 else "traseul cablului nu e în raport; legătura spre cel mai apropiat stâlp e logică")},
                f"raport {r['doc']} ({r['metoda']})", min(0.9, r["incredere"]) - (0.15 if kk.startswith("NOU") else 0.0),
                f"{adresa}: nu e în GIS și nu se vede cablu din aer, dar raportul {r['doc']}"
                + (f" din {r['data'][:4]}" if r["data"] else "") + f" spune racord subteran: „{r['dovada'][:120]}”." + extra)
            continue
        if c and c.get("tip_racord") == "subteran":   # date vechi: contract cu tipul completat
            add("bransament_lipsa", bid, ln(b["xy"], usable[k]),
                {"kind": "bransament", "building": bid, "adresa": adresa, "pole": k, "lungime_m": round(dd, 1),
                 "tip_racord": "subteran", "verificare": "contract", "contract": c["pod"], "prosumator": bool(pv),
                 "nota": "traseul cablului subteran nu e cunoscut; legătura spre cel mai apropiat stâlp e logică"},
                "contract (" + c["pod"] + ") + ANCPI/OSM", 0.75 - (0.15 if k.startswith("NOU") else 0.0),
                f"{adresa}: nu e în GIS și nu se vede cablu în imagine, dar contractul {c['pod']} spune racord subteran "
                f"(racordat {c.get('data_racordare', '?')[:4]}). E normal să nu se vadă din aer." + extra)
            continue

        # c) altfel: steag pentru echipa din teren
        if r and r["tip_racord"] == "aerian":
            cod, why, conf = "raport_aerian_nevazut", f"raportul {r['doc']} spune racord aerian („{r['dovada'][:80]}”), dar cablul nu se vede în imagine (vegetație, unghi sau date vechi)", 0.6
        elif r:
            cod, why, conf = "raport_fara_tip", f"am găsit raportul {r['doc']}, dar nu spune clar dacă racordul e aerian sau subteran", 0.6
        elif c and c.get("tip_racord") == "aerian":
            cod, why, conf = "contract_aerian_nevazut", f"contractul {c['pod']} spune racord aerian, dar cablul nu se vede în imagine (vegetație, unghi sau date vechi)", 0.6
        elif c:
            cod, why, conf = "contract_fara_raport", f"există contractul {c['pod']}, dar niciun raport care să spună cum e racordat", 0.6
        else:
            cod, why, conf = "fara_contract", "nu am găsit niciun contract pe adresa asta și nu se vede cablu; poate fi neracordat sau racordat fără contract", 0.3
        add("verificare_teren", bid, pt(b["xy"]),
            {"building": bid, "adresa": adresa, "motiv_cod": cod, "contract": c["pod"] if c else None, "raport": r["doc"] if r else None,
             "stalp_probabil": k if dd <= BRANS_MAX_M else None, "prosumator": bool(pv),
             "actiune": "deplasare: confirmă dacă e racordat și cum (poză la firidă/contor și la stâlp)"},
            "imagine aeriana + contracte", conf,
            f"{adresa}: clădire fără loc de consum în GIS; {why}. Trimite o echipă." + extra)

    for i, p in enumerate(props, 1):
        p["id"] = f"P{i:03d}"

    scores = score_lines(D, pole_state, new_nodes, reach, today)
    return props, scores, {"confirmati": len(confirmed), "detectii_ignorate": [d for d in D["det"] if "drop" in d],
                           "stare_stalpi": Counter(pole_state.values())}


def connectivity(D, new_nodes, props, nodes, undetected):
    """BFS de la post pe tronsoanele din GIS plus cele propuse. Grupurile de stalpi neconectate se leaga
    pe rand, cel mai scurt salt intai (fara sa traverseze strada): fiecare salt = locul probabil al unui gol."""
    adj = defaultdict(set)
    for L in D["lines"].values():
        adj[L["from"]].add(L["to"]); adj[L["to"]].add(L["from"])
    for p in props:
        if p["tip"] == "tronson_lipsa":
            a, b = p["propus"]["from"], p["propus"]["to"]
            adj[a].add(b); adj[b].add(a)
    start = [k for k, p in D["poles"].items() if p["kind"] == "post_transformare"]
    reach, todo = set(start), list(start)
    while todo:
        for n in adj[todo.pop()]:
            if n not in reach:
                reach.add(n); todo.append(n)
    # un stalp fara tronsoane SI fara detectie e tratat separat (posibil demontat), nu ca gol
    left = {k for k in nodes if k not in reach and (adj[k] or k not in undetected)}
    groups = []
    while left:
        comp, todo = set(), [left.pop()]
        while todo:
            n = todo.pop(); comp.add(n)
            for m in adj[n]:
                if m in left:
                    left.discard(m); todo.append(m)
        groups.append(comp)
    connected = {k for k in reach if k in nodes}
    gaps = []
    while groups:
        best = None
        for gi, g in enumerate(groups):
            others = connected.union(*(h for hj, h in enumerate(groups) if hj != gi))
            for a in g:
                for b in others:
                    d = dist(nodes[a], nodes[b])
                    if (best is None or d < best[0]) and (b.startswith("PT") or not across_street(D, nodes[a], nodes[b])):
                        best = (d, a, b, gi)
        if best is None:
            break
        d, a, b, gi = best
        g = groups.pop(gi)
        gaps.append((sorted(g), (a, b, d)))
        if b in connected:
            connected |= g
        else:
            next(h for h in groups if b in h).update(g)
    return reach, gaps


def score_lines(D, pole_state, new_nodes, reach, today):
    """Scor 0-1 pe tronson: cat ne putem baza pe el. Euristica, de calibrat:
    vechimea verificarii, atribute lipsa, starea stalpilor de la capete, goluri in apropiere."""
    out = []
    for lid, L in sorted(D["lines"].items()):
        why = []
        if L.get("last_verified"):
            age = today.year - int(str(L["last_verified"])[:4])
            s = max(0.3, 1.0 - 0.05 * age)
            why.append("verificat anul acesta" if age <= 0 else "verificat acum 1 an" if age == 1 else f"verificat acum {age} ani")
        else:
            s = 0.75; why.append("data verificării nu e în GIS")
        if any(L.get(a) is None for a in ATTRS):
            s -= 0.2; why.append("atribute lipsă")
        for end in (L["from"], L["to"]):
            st = pole_state.get(end, "confirmat" if end.startswith("PT") else "neconfirmat")
            pen = {"confirmat": -0.05, "confirmat_sv": -0.05, "neconfirmat": 0.1, "neverificabil": 0.1, "mutat": 0.3, "suspect": 0.3}.get(st, 0.3)
            s -= pen
            if pen > 0:
                why.append(f"{end}: {st}")
        mid = ((L["pts"][0][0] + L["pts"][-1][0]) / 2, (L["pts"][0][1] + L["pts"][-1][1]) / 2)
        if L["from"] not in reach:
            s -= 0.2; why.append("nu ajunge la post în GIS")
        if any(dist(mid, v[1]) < 40 for v in new_nodes.values()):
            s -= 0.2; why.append("stâlp lipsă în apropiere")
        s = round(min(max(s, 0.0), 1.0), 2)
        out.append({"id": lid, "pts": L["pts"], "scor": s, "culoare": "verde" if s >= 0.7 else "galben" if s >= 0.4 else "rosu",
                    "motive": why, **({"tip_retea": L["tip_retea"]} if L.get("tip_retea") else {})})
    return out


# ----------------------------------------------------------------------------- iesire
def subteran_layer(D):
    """toate cladirile pe care rapoartele le dau racordate subteran (in GIS sau nu), cu punctul de legare"""
    P = D["P"]
    poles = {k: v["xy"] for k, v in D["poles"].items()}
    fs = []
    for bid, r in sorted(D["rap"].items()):
        if r["tip_racord"] != "subteran" or bid not in D["buildings"]:
            continue
        b = D["buildings"][bid]
        k = next((x for x in r["coduri"] if x in poles), None)
        via = "pomenit în raport" if k else None
        if not k and bid in D["conn"] and D["conn"][bid].get("pole") in poles:
            k, via = D["conn"][bid]["pole"], "din GIS"
        if not k and poles:
            k, via = min(poles, key=lambda q: dist(poles[q], b["xy"])), "cel mai apropiat (estimat)"
        pr = {"building": bid, "adresa": b.get("adresa"), "raport": r["doc"], "data": r["data"], "dovada": r["dovada"],
              "cablu": r["cablu"], "incredere": r["incredere"], "metoda": r["metoda"], "in_gis": bid in D["conn"],
              "legat_de": k, "legatura": via}
        fs.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": P.ll(b["xy"])}, "properties": dict(pr, kind="client_subteran")})
        if k:
            fs.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [P.ll(b["xy"]), P.ll(poles[k])]},
                       "properties": dict(pr, kind="cablu_subteran_estimat")})
    return {"type": "FeatureCollection", "features": fs}


def write(D, props, scores, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    P = D["P"]
    json.dump(subteran_layer(D), open(os.path.join(out_dir, "subteran_rapoarte.geojson"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(D["rap_rows"], open(os.path.join(out_dir, "rapoarte_extrase.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(props, open(os.path.join(out_dir, "proposals.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    feats = [{"type": "Feature", "geometry": p["geometrie"], "properties": {k: v for k, v in p.items() if k != "geometrie"}}
             for p in props]
    json.dump({"type": "FeatureCollection", "features": feats},
              open(os.path.join(out_dir, "proposals.geojson"), "w", encoding="utf-8"), ensure_ascii=False)
    feats = [{"type": "Feature", "geometry": {"type": "LineString", "coordinates": [P.ll(p) for p in s["pts"]]},
              "properties": {k: v for k, v in s.items() if k != "pts"}} for s in scores]
    json.dump({"type": "FeatureCollection", "features": feats},
              open(os.path.join(out_dir, "scores.geojson"), "w", encoding="utf-8"), ensure_ascii=False)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(here, "data"))
    ap.add_argument("--out", default=os.path.join(here, "out"))
    ap.add_argument("--azi", default=datetime.date.today().isoformat())
    ap.add_argument("--rapoarte", help="folder cu rapoarte .txt (implicit <data>/rapoarte)")
    ap.add_argument("--fara-prezis", action="store_true", help="nu propune rețea pentru casele din afara rețelei primite")
    ap.add_argument("--conf-new", type=float, default=0.4, help="prag pentru stâlp nou / mutat (confirmarea folosește --conf-min)")
    ap.add_argument("--conf-min", type=float, help="pragul detecțiilor (implicit 0,4; cu TTA d4 folosește pragul ales pe validare)")
    ap.add_argument("--suspect-m", type=float, default=SUSPECT_M, help="distanța stâlp-ax drum peste care e suspect (date reale: 15)")
    ap.add_argument("--llm", action="store_true", help="citește rapoartele cu un LLM (ANTHROPIC_API_KEY), nu cu reguli")
    a = ap.parse_args()
    globals()["SUSPECT_M"] = a.suspect_m
    if a.conf_min is not None:
        globals()["CONF_MIN"] = a.conf_min
    globals()["CONF_NEW"] = max(a.conf_new, CONF_MIN)

    D = load(a.data, a.rapoarte, a.llm)
    props, scores, info = run(D, datetime.date.fromisoformat(a.azi))
    if not a.fara_prezis:
        import retea_prezisa
        known = {k: p["xy"] for k, p in D["poles"].items()}
        for lid, L in D["lines"].items():
            known[lid + ":a"], known[lid + ":b"] = L["pts"][0], L["pts"][-1]
        pp, ps, pf, nfar = retea_prezisa.prezice(D, known, BRANS_MAX_M, CONF_MIN)
        for i, p in enumerate(pp, len(props) + 1):
            p["id"] = f"P{i:03d}"
        props += pp; scores += ps
        os.makedirs(a.out, exist_ok=True)
        json.dump({"type": "FeatureCollection", "features": pf},
                  open(os.path.join(a.out, "retea_prezisa.geojson"), "w", encoding="utf-8"), ensure_ascii=False)
        npol = sum(1 for f in pf if f["properties"]["kind"] == "stalp")
        nconf = sum(1 for f in pf if f["properties"]["kind"] == "stalp" and f["properties"]["detectie"])
        print(f"rețea prezisă: {nfar} case în afara rețelei primite -> {len(pp)} linii, {npol} stâlpi "
              f"({nconf} văzuți în imagine), {sum(1 for f in pf if f['properties']['kind'] == 'bransament')} branșamente")
    write(D, props, scores, a.out)

    print(f"stâlpi confirmați de imagine: {info['confirmati']} | stare: {dict(info['stare_stalpi'])}")
    ign = info["detectii_ignorate"]
    if ign:
        why = Counter("departe de drum" if "drum" in d["drop"] else "prea slabă pentru stâlp nou" if "confirmare" in d["drop"] else "sub prag" for d in ign)
        print(f"  detecții ignorate: {len(ign)} ({', '.join(f'{v} {k}' for k, v in why.items())}); lista e în out/detectii_ignorate.json")
        json.dump([{"conf": round(d["conf"], 3), "lon_lat": D["P"].ll(d["xy"]), "motiv": d["drop"]} for d in ign],
                  open(os.path.join(a.out, "detectii_ignorate.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("propuneri:", dict(Counter(p["tip"] for p in props)), f"| total {len(props)}")
    print("scor tronsoane:", dict(Counter(s["culoare"] for s in scores)))
    if D["rap_rows"]:
        print(f"rapoarte: {len(D['rap_rows'])} citite, adresă găsită la {sum(1 for r in D['rap_rows'] if r['cladire'])}, "
              f"tip: {dict(Counter(r['tip_racord'] or 'necunoscut' for r in D['rap_rows']))}, "
              f"clădiri racordate subteran: {sum(1 for r in D['rap'].values() if r['tip_racord'] == 'subteran')}")
    print("scris în", a.out)


if __name__ == "__main__":
    main()
