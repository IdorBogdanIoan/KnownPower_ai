# KnownPower AI

Motorul AI din pagina „Caută zonă” a site-ului KnownPower.

Site-ul pornește workflow-ul `Analiza zona AI` (prin funcția de server `startAiAnalysis`). Workflow-ul:
1. descarcă străzile și casele (OpenStreetMap + Microsoft Building Footprints),
2. descarcă imaginea din satelit și caută stâlpii cu modelul YOLO `grid_best_ro_B.pt`,
3. propune rețeaua probabilă (`retea_prezisa.py`),
4. trimite rezultatul înapoi la site (funcția SQL `ai_job_complete`, protejată de tokenul jobului).

Test manual: Actions → Analiza zona AI → Run workflow (fără callback, rezultatul apare în log).
Rulare locală: `python api_local.py` (server pe 127.0.0.1:8765).
