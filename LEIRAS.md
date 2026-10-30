# Solaris-Yantra 3D (GitHub Pages, PWA)

Fő app: `index.html` (3D földgömb, élő adatok, AI-konzol, 📶 Források nézet) · Digital Twin: `twin.html` + `p1`–`p8` modulok.
Gyorsítótár: `sw.js` (saját fájlok hálózat-előszörös, így a frissítés azonnal látszik).
Háttérfigyelő: `watch.mjs` + `csi.mjs` + `score.mjs` + `alert-config.json` + `.github/workflows/watch.yml` (lásd `BEALLITAS.md`), adatai a `data/` mappában.

Fontos:
- A tárolóban NINCS API-kulcs és ntfy-téma. Az AI-kulcsot az app konzoljában add meg (`/kulcs gemini ...`), az ntfy-témát GitHub-titokként (`NTFY_TOPIC`).
- A GPS és a külső szolgáltatások csak a https-címen működnek: https://zsolem740-cell.github.io/solaris/
- Frissítés: azonos nevű fájlokat tölts fel a feltöltő oldalon, azok felülíródnak ("Commit directly to the main branch").
- Csendes órák (alapból 22–7 óra): a kisebb riasztás hangtalanul érkezik, csak a nagyok (Kp ≥ 7, M5+ napkitörés, Bz ≤ −15 nT, −3 °C alatti fagy, −8 hPa/3 óra nyomásesés, 90 km/h-s széllökés, M5+ rengés) szólalnak meg. Az `alert-config.json` `quiet` részében állítható.
- Modell-skórkártya: a figyelő óránként elmenti 4 modell 6/12/24 órás jóslatát (`data/forecasts.json`), 7 nap múlva az ERA5-höz méri (`data/scorecard.json`). Az eredmény az app Előrejelzés nézetében látszik.
