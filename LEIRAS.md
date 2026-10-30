# Solaris-Yantra 3D (GitHub Pages, PWA)

Fő app: `index.html` (3D földgömb, élő adatok, AI-konzol, 📶 Források nézet) · Digital Twin: `twin.html` + `p1`–`p8` modulok.
Gyorsítótár: `sw.js` (saját fájlok hálózat-előszörös, így a frissítés azonnal látszik).
Háttérfigyelő: `watch.mjs` + `alert-config.json` + `.github/workflows/watch.yml` (lásd `BEALLITAS.md`), adatai a `data/` mappában.

Fontos:
- A tárolóban NINCS API-kulcs és ntfy-téma. Az AI-kulcsot az app konzoljában add meg (`/kulcs gemini ...`), az ntfy-témát GitHub-titokként (`NTFY_TOPIC`).
- A GPS és a külső szolgáltatások csak a https-címen működnek: https://zsolem740-cell.github.io/solaris/
- Frissítés: azonos nevű fájlokat tölts fel a feltöltő oldalon, azok felülíródnak ("Commit directly to the main branch").
