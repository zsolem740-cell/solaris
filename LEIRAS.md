# Solaris-Yantra 3D (GitHub Pages, PWA)

Fő app: `index.html` (3D földgömb, élő adatok, AI-konzol) · Digital Twin: `twin.html` + `p1`–`p8` modulok.
Gyorsítótár: `sw.js` (saját fájlok hálózat-előszörös, így a frissítés azonnal látszik).

Fontos:
- A tárolóban NINCS API-kulcs. Az AI-kulcsot az app konzoljában add meg (`/kulcs gemini ...`), a böngésző őrzi.
- A GPS és a külső szolgáltatások csak a https-címen működnek: https://zsolem740-cell.github.io/solaris/
- Frissítés: azonos nevű fájlokat tölts fel a feltöltő oldalon, azok felülíródnak.
