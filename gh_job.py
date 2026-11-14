"""Rulează o analiză de zonă în GitHub Actions și trimite rezultatul înapoi la site.

    python gh_job.py --job <id> --lon 26.06 --lat 44.28 --raza 250 --callback <url> --token <token>

Fără --callback afișează doar rezultatul (pentru test).
"""
import argparse, json, os, sys, traceback, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# zona permisă: București + Ilfov (cu margine)
BOX = (25.70, 44.20, 26.50, 44.75)


def post(url, body, token, apikey):
    """trimite rezultatul la funcția Supabase ai_job_complete (verifică tokenul jobului)"""
    payload = {"p_id": body["job_id"], "p_token": token, "p_status": body["status"],
               "p_rezultat": body.get("rezultat"), "p_eroare": body.get("eroare")}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json", "apikey": apikey}
    if apikey and not apikey.startswith("sb_"):
        headers["Authorization"] = f"Bearer {apikey}"
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        print("callback:", r.status, r.read()[:300].decode("utf-8", "replace"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--raza", type=float, default=250)
    ap.add_argument("--callback", default="")
    ap.add_argument("--token", default="")
    ap.add_argument("--apikey", default=os.environ.get("SUPABASE_KEY", ""))
    a = ap.parse_args()

    try:
        if not (BOX[0] <= a.lon <= BOX[2] and BOX[1] <= a.lat <= BOX[3]):
            raise ValueError("Punctul e în afara zonei București + Ilfov.")
        import api_local
        rez = api_local.analiza(a.lon, a.lat, a.raza)
        body = {"job_id": a.job, "status": "done", "rezultat": rez}
        print(json.dumps(rez["rezumat"], ensure_ascii=False), rez["numere"], f"{rez['durata_s']} s")
    except Exception as e:
        traceback.print_exc()
        body = {"job_id": a.job, "status": "error", "eroare": str(e)[:300]}

    if a.callback:
        post(a.callback, body, a.token, a.apikey)
    else:
        print(json.dumps(body, ensure_ascii=False)[:2000])
    if body["status"] != "done":
        sys.exit(1)


if __name__ == "__main__":
    main()
