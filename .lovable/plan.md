# Spațiul demo partajat PTAB 7812

## Ce păstrăm
- Login cu nume și rol, fără parole sau conturi verificate. **Admin există deja în listă**; îi activăm toate operațiunile demo.
- Datele existente, fotografiile și fluxul Teren → Validare.
- „Hartă” rămâne numele existent al Biroului; Admin vede și Teren, Validare, Import și Administrare.

## Ce construim
1. **Aceleași date pentru toți:** straturi GIS/OSM, propuneri, scoruri, documente și rapoarte salvate în spațiul demo comun, cu actualizări live între dispozitive. Schimbarea rolului nu restabilește fișierele inițiale.
2. **Operațiuni Admin:** importuri, aprobări, respingeri, anulări, verificarea unui contract sau a tuturor clienților și export. Păstrăm dovezile și jurnalul.
3. **Contracte:** activăm în demo verificarea conservatoare pe documentele importate și salvarea rezultatului, fără cont verificat. Nu inventăm branșamente dacă lipsesc geometria sau dovezile. Analiza AI existentă își păstrează circuitul; verificarea demonstrativă funcționează prin regulile existente fără să depindă de AI.
4. **Harta PTAB:** GIS are prioritate la încadrare, inclusiv după import; antet „PTAB 7812 · rețea JT”. Cabluri subterane punctate, noduri mici gri, branșamente subțiri și cele subterane punctate maro. Legenda separă tipul cablului de Sigur / Partial Sigur / Nesigur.
5. **Importuri:** păstrăm cele zece tipuri de propuneri și câmpurile suplimentare din `propus`. Adăugăm alias `line_scores` și o zonă pentru rapoarte de teren JSON, separată de contractele/rapoartele TXT.
6. **Export:** presupunerea este JSON/GeoJSON al datelor demo curente, inclusiv documente, rapoarte și decizii. Export KML/KMZ și reconstrucția completă a rețelei nu sunt incluse în această cerere.

## Formate și ghid final
Importul GIS rămâne JSON/GeoJSON. KMZ-ul organizatorilor este sursa; importul direct KML/KMZ nu este inclus, deoarece nu a fost cerut aici.

La final precizez exact **Login → Admin → Import**, zona fiecărui upload, numele recunoscute și alegerea destinației pentru fișiere redenumite.

## Detalii tehnice
- Păstrăm stocarea publică fictivă separată de colecțiile private; nu deschidem global accesul la acestea și nu ștergem date.
- Adăugăm colecțiile demo lipsă și preluăm numai înregistrările confirmate fictive, păstrând datele și rapoartele demo existente.
- Un modul comun gestionează citirea/importurile/deciziile demo. Notificările live invalidează datele afișate pe toate dispozitivele.
- Deciziile și verificările se salvează tranzacțional, cu dovezi și anulare, pentru a evita suprascrieri simultane.
- Testăm tipurile și câmpurile cerute, simbolurile GIS, prioritatea încadrării și păstrarea datelor. Verificăm în browser import → al doilea dispozitiv → contract → decizie/anulare → export, plus Teren → Validare.

## Limita accesului demo
Fără conturi sau cod de acces, spațiul este public și modificabil. Rolurile controlează meniurile, nu oferă securitate pentru date reale; folosim numai datele fictive/publice descrise.