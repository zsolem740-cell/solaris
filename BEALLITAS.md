# Háttérfigyelő beállítása (telefonról, számítógép nélkül)

A figyelő a GitHub szerverén fut (GitHub Actions), a telefonod és az app zárva lehet. Óránként kétszer megnézi az élő forrásokat, és ha küszöböt lép át (Kp, napkitörés, déli Bz, fagy, gyors nyomásesés, erős szél, közeli földrengés), értesítést küld az ntfy alkalmazásba. Reggel 7-kor rövid összefoglalót is küld.

## 1. Értesítés-alkalmazás (ntfy)
1. Telepítsd az **ntfy** alkalmazást (Play Áruház).
2. Koppints a **+** gombra, és add meg a téma nevét: hosszú, kitalált szöveg, például `solaris-` és utána 12 véletlen betű/szám. **Ez a jelszavad, ne oszd meg.**
3. Iratkozz fel rá.

## 2. A téma elmentése titokként a GitHubon
1. Tároló, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**.
2. Name: `NTFY_TOPIC` · Secret: ugyanaz a téma-név. Mentés.

## 3. Fájlok feltöltése
A kicsomagolt mappából a feltöltő oldalon (Commit directly to the main branch): `index.html`, `watch.mjs`, `csi.mjs`, `alert-config.json`, `LEIRAS.md`, `BEALLITAS.md`. A `watch.yml` fájlt NEM kell feltölteni, azt a 4. lépésben kézzel hozod létre.

## 4. A munkafolyamat létrehozása
1. Tároló főoldal, **Add file**, **Create new file**.
2. A névmezőbe írd be pontosan: `.github/workflows/watch.yml` (a perjelek mappát hoznak létre).
3. Másold be a `watch.yml` teljes tartalmát, **Commit directly to the main branch**.

## 5. Teszt
1. Tároló, **Actions**, bal oldalt **Háttérfigyelő**, **Run workflow**, `test` mezőbe `1`, **Run workflow**.
2. 1–2 percen belül megjelenik a „Teszt: a háttérfigyelő működik" értesítés a telefonodon.
3. Az appban a **📶 Források** gombbal látod az utolsó futást és a riasztásokat.

## Tudnivalók
- A küszöbök és a hely az `alert-config.json` fájlban szerkeszthetők.
- A tároló nyilvános: a `data/status.json` és `data/history.json` nyilvános adatokat tartalmaz (Kp, napszél, Körmend időjárása). A téma-neved nem szerepel sehol, és a GPS-pozíciód sem kerül a tárolóba.
- Az ütemezés órán belül késhet. A GitHub 60 nap tevékenység nélkül leállíthatja az ütemezést; a figyelő saját mentései ezt általában megelőzik.
- Nem hivatalos figyelmeztetés, csak tájékoztatás. Nem helyettesíti a hivatalos viharjelzéseket.
