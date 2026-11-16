# KnownPower

**AI that keeps a low-voltage power grid map up to date.**

Utility GIS maps of the low-voltage (0.4 kV) network are often wrong or incomplete: poles drawn in the wrong place, missing lines, houses connected to the wrong transformer. KnownPower compares the company's map with satellite imagery and proposes corrections that a human operator approves or rejects.

Built in 24 hours at the **AI Validation Bootcamp × LSAC** hackathon (November 2026, Challenge 2: "A grid model that keeps itself up to date"), team of 3.

## What it does

- **Finds errors in the company map.** For each pole and line in the GIS, an agent checks the satellite image and proposes a fix: wrong position, missing attributes, uncertain lines. An operator approves or rejects each proposal.
- **Searches any area.** Pick a point in Bucharest or Ilfov and the AI looks at the satellite image: streets, houses, visible poles and the probable network, even where the company has no data.
- **Maps the periphery.** Batch analysis of whole localities (Bragadiru, Chiajna, Pantelimon, Popești-Leordeni, Voluntari, Chitila), shown on a map with filters and export.
- **Field feedback.** Field teams confirm or reject poles on site, and their answers can become training data.

## How it works

| Part | What it is |
|---|---|
| Web app | TanStack Start + React, Leaflet maps, Supabase database |
| Pole detection | YOLO model on aerial imagery (~0.3 m/pixel) |
| Building detection | YOLO11s-seg model trained on Bucharest + Ilfov imagery |
| Houses and streets | OpenStreetMap + Microsoft Building Footprints + our model |
| AI engine | Python, runs in GitHub Actions (no server needed) |
| Results | Saved on the `rezultate` branch, read by the web app |

The `ai/` folder holds the AI engine. The GitHub workflows in `.github/workflows/` run it:

- `analiza.yml`: one area, started from the web app ("Caută zonă")
- `analiza_lot.yml`: whole localities, split into 700 m squares and processed in parallel
- `reuneste.yml`: merges the results of a batch run again, without re-running the analysis
- `valideaza.yml`: compares detected poles with real utility data
- `materiale.yml`: estimates pole material from street-level photos (Mapillary)

## How good it is (measured)

| Model | Result |
|---|---|
| Poles (on real utility data, one area of about 1 km²) | precision 30%, recall 48%, median position error 4.6 m |
| Buildings (validation set) | precision 58%, recall 39%; in the test area it found 253 houses missing from OpenStreetMap and Microsoft |

**Limits, stated openly:**
- Pole validation covers a single small area, partly seen during training, so these numbers are optimistic.
- The "predicted network" is a rule (a pole about every 35 m along streets with houses), not something the AI observed.
- Pole material from street photos has not been validated yet.
- Everything the AI proposes must be confirmed in the field before it changes the company map.

## Run locally

Web app (Node.js 18+):

```bash
npm install
npm run dev
```

AI engine (Python 3.11):

```bash
cd ai
pip install -r requirements.txt
python api_local.py   # local engine on http://127.0.0.1:8765
```

## Data and licences

- Satellite imagery: Esri World Imagery (demo use only; production should use official orthophotos or the utility's own imagery)
- Maps: © OpenStreetMap contributors (ODbL); Microsoft Building Footprints (ODbL)
- Street-level photos: Mapillary (CC BY-SA)

Utility network data in this repository belongs to the company and is not for public use.
