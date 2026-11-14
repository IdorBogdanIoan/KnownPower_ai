"""Racorduri subterane din rapoarte text (ATR, procese-verbale, fișe de intervenție).

Tipul racordului (aerian / subteran) apare de obicei doar în documente scrise de mână sau în Word, nu în GIS.
Modulul ăsta:
  1. citește rapoartele (.txt; un PDF se convertește întâi în text);
  2. din fiecare scoate adresa, tipul racordului, dovada (fraza exactă), data, cablul și stâlpul/nodul pomenit;
  3. pentru fiecare clădire păstrează concluzia din documentul cel mai recent care spune ceva clar.

Două extractoare:
  - reguli (implicit, fără internet): cuvinte cheie cu ponderi, negații („nu se poate subteran”),
    înlocuiri („se înlocuiește branșamentul aerian cu unul subteran”);
  - LLM (--llm, cu ANTHROPIC_API_KEY): același rezultat JSON, mai bun pe formulări neprevăzute.
Ambele întorc „necunoscut” când textul nu spune clar; atunci clientul merge la echipa din teren.

Partea de generare (genereaza) face rapoarte de TEST, cu formulări variate și capcane. Sunt simulate.
"""
import datetime, glob, json, os, re, unicodedata, urllib.request

# ----------------------------------------------------------------------------- text
def plain(s):
    """fără diacritice, litere mici; păstrează punctuația"""
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()


TIP_STRADA = r"(?:strada|str|aleea|al|calea|soseaua|sos|bulevardul|bd|bdul|intrarea|int|drumul|ds)"


def street_key(name):
    s = plain(name)
    s = re.sub(rf"\b{TIP_STRADA}\b\.?", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


# ----------------------------------------------------------------------------- reguli
SUB = [(r"\bsubteran\w*", 3), (r"\bsubt\.", 2), (r"\bles\b", 2), (r"\bacyaby\b|\bacyabys?\b|\bcyaby\b", 3),
       (r"pozat\w* (?:direct )?in pamant|\bingropat\w*", 3), (r"\bin cablu\b", 1),
       (r"coborare\w* (?:pe|de pe) stalp", 2), (r"teava de protectie|tub de protectie", 1),
       (r"pozat\w* (?:in|prin) (?:sant|canal\w*|tub\w*)", 3), (r"\bcanalizati\w*", 2)]
AER = [(r"\baerian\w*", 3), (r"\btyir\b", 3), (r"\btorsadat\w*", 2), (r"\blea\b", 2), (r"pe fatada", 1),
       (r"\bconductor\w* izolat\w*", 1), (r"\bpe stalp\b", 1)]
NEG = r"\b(?:nu|fara|respins\w*|neaprobat\w*|nerealizat\w*|refuzat\w*|renuntat\w*|nu (?:a fost|este|s-a) (?:acceptat|aprobat|posibil|realizat)\w*|nu exista|imposibil\w*|desfiintat\w*|demontat\w*|dezafectat\w*)\b"
INLOC = r"inlocu\w*|trecere\w*.{0,30}\b(?:din|de la)\b|transformare\w*|mutare\w*|modificare\w*"


def _clauses(t):
    return [c.strip() for c in re.split(r"[\n;]|(?<!\bnr)(?<!\bsubt)(?<!\bstr)(?<!\bjud)(?<!\bbl)(?<!\bsc)(?<!\bap)\.(?!\d)", t) if c.strip()]


def _cues(c):
    """indiciile din fraza, în ordine: [(poziție, tip, pondere)]"""
    out = []
    for tip, pats in (("subteran", SUB), ("aerian", AER)):
        for p, wt in pats:
            out += [(m.start(), tip, wt) for m in re.finditer(p, c)]
    return sorted(out)


def tip_reguli(text):
    """-> (tip | None, incredere, dovada)"""
    score = {"subteran": 0.0, "aerian": 0.0}
    best = (0, "")
    other = {"subteran": "aerian", "aerian": "subteran"}
    for c in _clauses(plain(text)):
        # bucăți separate de virgulă / „așa că” / „iar”: negația se aplică doar în bucata ei
        for part in re.split(r",|\basa ca\b|\bdeci\b|\biar\b", c):
            cues = _cues(part)
            if not cues:
                continue
            if re.search(NEG, part):
                # „varianta subterană nu a fost acceptată”, „nu există rețea subterană”: argument slab pentru celălalt tip
                for _, tip, wt in cues:
                    score[other[tip]] += 0.5
                continue
            if re.search(INLOC, part):
                # „înlocuit aerian cu subteran”, „trecere din aerian în subteran”: contează ultimul tip pomenit
                _, tip, wt = cues[-1]
                score[tip] += wt + 2
                best = max(best, (wt + 2, c))
                continue
            for _, tip, wt in cues:
                score[tip] += wt
                best = max(best, (wt, c))
    diff = score["subteran"] - score["aerian"]
    if abs(diff) < 2:
        return None, round(0.3 + 0.1 * abs(diff), 2), best[1][:200]
    return ("subteran" if diff > 0 else "aerian"), round(min(0.95, 0.55 + 0.07 * abs(diff)), 2), best[1][:200]


def data_doc(text):
    t = plain(text)
    m = re.search(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})", t)
    if m:
        d, mo, y = map(int, m.groups())
    else:
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", t)
        if not m:
            return None
        y, mo, d = map(int, m.groups())
    try:
        return datetime.date(y, mo, d).isoformat()
    except ValueError:
        return None


def cablu(text):
    m = re.search(r"\b(acyabys?|tyir|cyaby|acyaby)\b\s*[\dx+,\s]{2,20}(?:mmp|mm2|mm²)?", plain(text))
    return m.group(0).strip().upper() if m else None


def coduri(text):
    """coduri de stâlp/nod pomenite în text: S045, NOU-03, 7675523, PT-101"""
    return re.findall(r"\b(?:S\d{3}|NOU-\d{2}|PT-\d{3}|[5-7]\d{6})\b", text.upper())


# ----------------------------------------------------------------------------- adresa
class Adrese:
    """index pe clădiri: strada (fără „Strada/Str./Aleea”) -> număr -> clădire"""

    def __init__(self, buildings):
        self.idx = {}
        for bid, b in buildings.items():
            adr = b.get("adresa")
            if not adr:
                continue
            m = re.match(r"(.*?)\s*(?:nr\.?)?\s*(\d+[A-Za-z]?)\s*$", adr)
            if not m:
                continue
            self.idx.setdefault(street_key(m.group(1)), {})[m.group(2).lower()] = bid
        self.keys = sorted(self.idx, key=len, reverse=True)  # „Fagului Nou” înaintea lui „Fagului”

    def gaseste(self, text):
        """-> (cladire, adresa găsită) sau (None, None). Preferă adresa de după „loc de consum/adresa/imobil”."""
        t = re.sub(r"[^a-z0-9]+", " ", plain(text))
        anchor = min((m.start() for m in re.finditer(r"loc de consum|adresa|imobil\w*|amplasament|situat\w*", t)), default=0)
        found = []
        for k in self.keys:
            for m in re.finditer(rf"\b{re.escape(k)}\b", t):
                after = t[m.end(): m.end() + 14]
                n = re.match(r"\s*(?:nr|numar|numarul)?\s*(\d+[a-z]?)\b", after)
                if n and n.group(1) in self.idx[k]:
                    found.append((m.start() < anchor, m.start(), self.idx[k][n.group(1)], f"{k} {n.group(1)}"))
        if not found:
            return None, None
        found.sort()
        return found[0][2], found[0][3]


# ----------------------------------------------------------------------------- LLM (optional)
PROMPT = """Ești un inginer de distribuție. Din documentul de mai jos extrage, în JSON strict:
{"adresa": "strada și numărul locului de consum", "tip_racord": "subteran" | "aerian" | "necunoscut",
 "dovada": "fraza exactă din text care arată tipul", "incredere": 0-1}
Reguli: dacă textul spune că varianta subterană a fost respinsă sau nu e posibilă, nu e subteran.
Dacă un branșament aerian a fost înlocuit cu unul subteran, e subteran. Dacă nu se spune clar, "necunoscut".
Document:
"""


def tip_llm(text, model="claude-haiku-5-5"):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("lipsește ANTHROPIC_API_KEY")
    body = json.dumps({"model": model, "max_tokens": 400,
                       "messages": [{"role": "user", "content": PROMPT + text[:6000]}]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.loads(r.read())["content"][0]["text"]
    j = json.loads(re.search(r"\{.*\}", out, re.S).group(0))
    tip = j.get("tip_racord") if j.get("tip_racord") in ("subteran", "aerian") else None
    return tip, float(j.get("incredere") or 0.5), (j.get("dovada") or "")[:200], j.get("adresa")


# ----------------------------------------------------------------------------- rulare
def citeste(folder):
    docs = []
    for p in sorted(glob.glob(os.path.join(folder, "*.txt"))):
        docs.append({"doc": os.path.splitext(os.path.basename(p))[0], "text": open(p, encoding="utf-8", errors="replace").read()})
    return docs


def extrage(docs, adrese, llm=False):
    """-> rezultate per document și concluzia per clădire (documentul cel mai recent cu tip clar)"""
    rows = []
    for d in docs:
        if llm:
            try:
                tip, conf, dovada, adr_llm = tip_llm(d["text"])
                bid, adr = adrese.gaseste((adr_llm or "") + "\n" + d["text"])
                metoda = "llm"
            except Exception as e:
                print(f"   LLM indisponibil pentru {d['doc']} ({e}); folosesc regulile")
                llm = False
        if not llm:
            tip, conf, dovada = tip_reguli(d["text"])
            bid, adr = adrese.gaseste(d["text"])
            metoda = "reguli"
        rows.append({"doc": d["doc"], "cladire": bid, "adresa_gasita": adr, "tip_racord": tip, "incredere": conf,
                     "dovada": dovada, "data": data_doc(d["text"]), "cablu": cablu(d["text"]),
                     "coduri": coduri(d["text"]), "metoda": metoda})
    per = {}
    for r in sorted(rows, key=lambda r: r["data"] or ""):
        if r["cladire"] and r["tip_racord"]:
            per[r["cladire"]] = r   # ultimul document clar câștigă
    for r in rows:
        if r["cladire"] and r["cladire"] not in per:
            per[r["cladire"]] = r   # documente fără tip: măcar știm că există
    return rows, per


# ----------------------------------------------------------------------------- generare (TEST, simulat)
SOL_SUB = [
    "Soluția de racordare: branșament subteran trifazat cu cablu ACYAbY 4x25 mmp, pozat în pământ la 0,8 m, din firida de distribuție.",
    "Racordarea se face în cablu LES 0,4 kV până la BMPT montat la limita de proprietate.",
    "Coborâre pe stâlpul {pole} în țeavă de protecție, apoi cablu ACYAbY 4x16 până la firida de branșament.",
    "brans. subt. cablu ACYAbY 4x16 Al, l=22 m",
    "Se va realiza un branșament îngropat, cu cablu ACYAbY 2x16, între stâlpul {pole} și BMPT.",
    "S-a executat racord subteran monofazat; cablul a fost pozat direct în pământ, cu bandă avertizoare.",
]
SOL_AER = [
    "Soluția de racordare: branșament aerian cu conductor torsadat TYIR 2x16 mmp din stâlpul {pole}.",
    "Racord aerian trifazat TYIR 4x16, lungime 18 m, BMPT montat pe fațadă.",
    "Alimentare din LEA 0,4 kV existentă, branșament cu conductor izolat torsadat.",
    "brans. aerian TYIR 2x16 din st. {pole}",
]
TRAP_AER = [  # pomenesc subteranul, dar racordul e aerian
    "Varianta în cablu subteran nu a fost acceptată de beneficiar; se realizează branșament aerian TYIR 4x16.",
    "Nu există rețea subterană în zonă, așa că racordul este aerian, din stâlpul {pole}.",
    "Solicitarea de trecere în subteran a fost respinsă. Branșamentul rămâne aerian.",
]
TRAP_SUB = [  # pomenesc aerianul, dar racordul e subteran
    "S-a înlocuit branșamentul aerian existent cu un branșament subteran ACYAbY 4x16.",
    "Lucrare: trecerea branșamentului din aerian în cablu subteran, la cererea primăriei.",
]
FARA_TIP = [
    "Lucrare: înlocuire contor monofazat cu contor inteligent. Sigilii aplicate.",
    "Verificare instalație de utilizare, fără neconformități. Putere absorbită conformă.",
    "Intervenție: lipsă tensiune pe o fază, remediat prin strângere conexiuni în BMPT.",
]


def _accente(s, rng):
    r = rng.random()
    if r < 0.25:
        return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()   # fără diacritice
    if r < 0.35:
        return s.upper()
    return s


def genereaza(items, rng):
    """items: [{building, adresa, tip, pole, pod, data, kw}] -> (docs [{doc, text}], adevar {doc: {...}})"""
    docs, truth = [], {}
    n = 0
    for it in items:
        tip, pole = it["tip"], it["pole"]
        an = int(it["data"][:4])
        plan = []
        r = rng.random()
        if r < 0.80:   # un ATR sau un PV care spune tipul
            if rng.random() < 0.12:
                txt = rng.choice(TRAP_AER if tip == "aerian" else TRAP_SUB)
            else:
                txt = rng.choice(SOL_SUB if tip == "subteran" else SOL_AER)
            plan.append((rng.choice(["ATR", "PV-PIF"]), an, txt, tip))
        elif r < 0.88 and tip == "subteran":  # istoric: întâi aerian, apoi înlocuit cu subteran
            plan.append(("ATR", an, rng.choice(SOL_AER), "aerian"))
            plan.append(("PV-LUCRARE", min(an + rng.randint(3, 12), 2026), rng.choice(TRAP_SUB), "subteran"))
        else:          # documentul nu spune tipul
            plan.append(("FISA", min(an + rng.randint(0, 10), 2026), rng.choice(FARA_TIP), None))
        if rng.random() < 0.25:
            plan.append(("FISA", min(an + rng.randint(1, 15), 2026), rng.choice(FARA_TIP), None))
        for kind, year, txt, tip_doc in plan:
            n += 1
            doc = f"{kind}-{n:04d}"
            dt = f"{rng.randint(1, 28):02d}.{rng.randint(1, 12):02d}.{year}"
            adr = it["adresa"]
            head = {
                "ATR": f"AVIZ TEHNIC DE RACORDARE nr. {rng.randint(1000, 9999)}/{dt}\nBeneficiar: [anonimizat]\n"
                       f"Loc de consum: {adr}, jud. Ilfov\nPutere aprobată: {it['kw']} kW\n",
                "PV-PIF": f"PROCES-VERBAL DE PUNERE ÎN FUNCȚIUNE\nData: {dt}\nPOD: {it['pod']}\nImobilul situat la adresa {adr}.\n",
                "PV-LUCRARE": f"PROCES-VERBAL DE RECEPȚIE LUCRARE din {dt}\nAmplasament: {adr}\n",
                "FISA": f"FIȘĂ DE INTERVENȚIE {dt}\nEchipa JT {rng.randint(1, 6)}\nAdresa: {adr}\n",
            }[kind]
            body = txt.format(pole=pole)
            if rng.random() < 0.3:
                body += "\nObservații: lucrare executată conform normativ, fără deranjamente."
            docs.append({"doc": doc, "text": _accente(head + body, rng)})
            truth[doc] = {"cladire": it["building"], "tip_doc": tip_doc, "tip_real": tip, "an": year}
    return docs, truth


def scrie(folder, docs, truth):
    os.makedirs(folder, exist_ok=True)
    for d in docs:
        open(os.path.join(folder, d["doc"] + ".txt"), "w", encoding="utf-8").write(d["text"])
    json.dump(truth, open(os.path.join(os.path.dirname(folder.rstrip("/\\")), "_rapoarte_truth.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
