# Verificarea clienților din contracte și rapoarte

## Rezultat
Păstrăm funcționalitățile existente și interfața în română. Adăugăm importul documentelor, verificarea individuală și în lot a clienților, carduri compacte și simboluri distincte pe hartă.

## Ce construim
1. Acceptăm propunerile `verificare_teren`, cu eticheta „Client de verificat”, fără să pierdem câmpurile agentului.
2. Adăugăm „Contracte și rapoarte” în Import: mai multe fișiere TXT și `contracts.json`, identificatori stabili, extragerea primei date valide, normalizarea textului și numărul documentelor importate.
3. Verificăm adresa prin potrivire exactă de cuvinte, inclusiv numărul: „Fagului 4” nu se potrivește cu „Fagului 41”. Documentele se analizează cronologic, cu cele mai recente ultimele.
4. Analiza AI returnează racordul, documentul și dovada; o regulă locală conservatoare, cu negații și înlocuiri, asigură alternativa când AI nu răspunde. Rezultatele ambigue nu confirmă racordarea.
5. Pentru subteran, aprobăm automat branșamentul conform cererii explicite, în aceeași operație cu jurnalul. Folosim stâlpul indicat dacă există; altfel cel mai apropiat stâlp identificabil în GIS. Fără clădire sau stâlp valid nu inventăm geometria și trimitem cazul la echipă. Păstrăm anularea deciziei existente.
6. Pentru aerian, necunoscut sau document absent, păstrăm cazul în așteptare și îl marcăm pentru echipa din teren.
7. Cardul arată adresa, o stare, „Verifică contractul”, „Arată pe hartă” și „Detalii” închise implicit. Păstrăm anularea pentru conexiunile aprobate. Verificarea tuturor clienților neverificați rulează secvențial, cu progres și rezumat.
8. Harta și legenda disting branșamentele subterane aprobate prin linie maro punctată și cazurile trimise la echipă prin cerc portocaliu. Acestea nu reprezintă urmărirea persoanelor.

## Acces și mod de test
- Nu reintroducem politicile demo permisive: documentele pot conține date private. Importul este pentru admin; verificarea este pentru admin și Validation team, cu identitatea verificată pe server.
- Loginul doar cu nume/rol rămâne pentru testarea interfeței, fără citirea documentelor private sau modificarea datelor reale.
- Cu zero documente afișăm „Importă întâi contractele și rapoartele”, cu acces spre Import pentru admin; echipa de validare vede că importul trebuie făcut de admin.
- Aprobarea automată este limitată la acest flux cerut explicit; nu schimbăm regulile celorlalte propuneri sau inspecțiilor OSM.

## Detalii tehnice
- Tabel nou `public.client_documents`, cu coloanele cerute, permisiuni explicite și RLS; textele normalizate sunt calculate pe server.
- Parser și reguli browser-safe comune; căutare SQL cu limite de cuvânt și adresă normalizată, fără interpolare SQL.
- `verifyClient` este o funcție server autentificată, cu control de rol. Modelul și SDK-ul rămân aceleași ca la extragerea fotografiilor; dacă apelul nu este disponibil folosim regulile, fără schimbare de model.
- Salvarea rezultatului, aprobarea și auditul sunt tranzacționale; verificăm că propunerea și documentele nu s-au schimbat în timpul analizei. Păstrăm sursele originale și dovezile pentru anulare.

## Verificări
Teste locale cu un raport scurt scris de mână, fără inserarea lui în baza de date: importul noului tip, normalizare, numere distincte, date, prioritatea documentelor, negații, înlocuirea aerianului cu subteran, lipsa geometriei, clasificări, permisiuni și anulare. Verificăm cardurile, progresul și legenda pe calculator și telefon. Verificarea integrală cu salvare reală necesită un cont autentificat cu rol acordat și documente reale; dacă lipsesc, raportăm această limită.
