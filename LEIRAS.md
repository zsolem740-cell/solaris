# Solaris-Yantra 3D (GitHub Pages, PWA)

Fő app: `index.html` (3D földgömb, élő adatok, AI-konzol, 📶 Források nézet) · Digital Twin: `twin.html` + `p1`–`p8` modulok.
Gyorsítótár: `sw.js` (saját fájlok hálózat-előszörös, így a frissítés azonnal látszik).
Háttérfigyelő: `watch.mjs` + `csi.mjs` + `score.mjs` + `obs.mjs` + `rules.mjs` + `alert-config.json` + `.github/workflows/watch.yml` (lásd `BEALLITAS.md`), adatai a `data/` mappában.

Fontos:
- A tárolóban NINCS API-kulcs és ntfy-téma. Az AI-kulcsot az app konzoljában add meg (`/kulcs gemini ...`), az ntfy-témát GitHub-titokként (`NTFY_TOPIC`).
- A GPS és a külső szolgáltatások csak a https-címen működnek: https://zsolem740-cell.github.io/solaris/
- Frissítés: azonos nevű fájlokat tölts fel a feltöltő oldalon, azok felülíródnak ("Commit directly to the main branch").
- Csendes órák (alapból 22–7 óra): a kisebb riasztás hangtalanul érkezik, csak a nagyok (Kp ≥ 7, M5+ napkitörés, Bz ≤ −15 nT, −3 °C alatti fagy, −8 hPa/3 óra nyomásesés, 90 km/h-s széllökés, M5+ rengés) szólalnak meg. Az `alert-config.json` `quiet` részében állítható.
- Modell-skórkártya: a figyelő óránként elmenti 4 modell 6/12/24 órás jóslatát (`data/forecasts.json`), 7 nap múlva az ERA5-höz méri (`data/scorecard.json`). Az eredmény az app Előrejelzés nézetében látszik.
- Mért valóság (v17): a háttérfigyelő óránként letölti a HungaroMet (odp.met.hu) automata állomásainak óránkénti mérését, kiválasztja a legközelebbi állomást (legfeljebb 60 km), és a 4 modell jóslatát az állomás pontjára is elmenti. 25 óra múlva a mért értékhez méri (`data/scorecard_obs.json`), így a ranglista 7 nap helyett kb. 1 nap múlva megvan, és a javított előrejelzés hőmérsékletre és légnyomásra már a mért adatból kalibrálódik. Az ERA5 a felhőzethez és tartaléknak megmarad. Forrás: Database: Meteorological Database, HungaroMet Nonprofit Zrt.
- Közlekedési és szabadtéri figyelmeztetések (v18): `rules.mjs` négy küszöbszabályt értékel a következő 24 órára (fekete jég, heves eső, sínhőmérséklet, folyóparti széllökés), ntfy-értesítéssel, a reggeli összefoglalóban és az app Előrejelzés nézetének alján. Az eredményt a mért állomási adat ellenőrzi (`data/rules.json`). Heurisztika, nem hivatalos útellenőrzés.
- Mért adat visszatöltése: az óránkénti HungaroMet fájl csak az aktuális órát adja, ezért a figyelő az állomás fix nevű „now” fájljából pótolja az előző napot is.
- Források nézet (v19): ha egy elsődleges forrás kiesik, de a tartaléka él (például a 2 órás NOAA fájl helyett az 1 perces folyam), a sor „↪ tartalék aktív” jelzést kap, nem hibát. A csapadékot nem mérő állomásnál a heves eső ellenőrzése „nincs adat” lesz, nem tévedés.
- Főképernyős jelzés (v20): az összkép-sor elejére (és a kinyitott kártya külön sorába) kerül a háttérfigyelő aktív figyelmeztetése, például „⚠ fekete jég ma 02–06 óra”. Adatforrás: `data/rules.json`.
- Heti jelentés (v20): vasárnap 8:00-kor ntfy-üzenet (életjel + összefoglaló: mérések száma, modell-ranglista, figyelmeztetések találati aránya, mért állomás, források). Az `alert-config.json` `weekly` részével állítható: `{ "enabled": true, "day": 0, "hour": 8 }`.
- Folyó (v21–v22): a hely körüli 5×5-ös GloFAS rácspontból (kb. 11 km-en belül) a legnagyobb hozamút választja, kiírja a távolságát. A szintet a folyó saját elmúlt 30 napjához méri (normál, megemelkedett, alacsony, áradás várható), nem „rekordhoz”: a GloFAS max és p75 mezői az előrejelzés ensemble-tagjainak statisztikái, nem történelmi értékek. 1 m³/s alatti kis vízfolyásnál nem jelez szintet.
- ISS-átvonulás iránya (v23): minden átvonulás mellett látszik, merre kel és merre nyugszik (például „DNy → ÉK, csúcs: D”), és hogy a pálya hány százaléka esik a déli égre (100–260°), vagyis déli fekvésű ablakból vagy erkélyről mennyi látszik belőle. A kelés a 10°-os magasságtól értendő.
