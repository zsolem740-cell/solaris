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
A kicsomagolt mappából a feltöltő oldalon (Commit directly to the main branch): `index.html`, `watch.mjs`, `csi.mjs`, `score.mjs`, `obs.mjs`, `rules.mjs`, `alert-config.json`, `LEIRAS.md`, `BEALLITAS.md`. A `watch.yml` fájlt NEM kell feltölteni, azt a 4. lépésben kézzel hozod létre.

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

## Újdonságok (v15)
- **Csendes órák:** az `alert-config.json` `quiet` részében (`from`, `to`, `enabled`) állítható. Éjjel a kisebb riasztások hangtalanul jönnek (ntfy 1-es prioritás), a nagyok megszólalnak.
- **Modell-skórkártya:** nem kell beállítani. Az első ranglista kb. 8 nap múlva jelenik meg az app Előrejelzés nézetében (a jóslatokat az ERA5 újraelemzéshez méri, ami nem állomási mérés).

## v17
- **Mért adat (HungaroMet):** nem kell beállítani. A háttérfigyelő magától választja a legközelebbi állomást. Ha az automatikus keresés nem működik, az `alert-config.json` fájlba felvehető egy `"obsStation": "15310"` sor (az állomás 5 jegyű száma).
- **Ellenőrzés:** a 📶 Források nézetben megjelenik a „HungaroMet mért adat” sor az állomás nevével, távolságával és az utolsó mérés idejével. Ha nem elérhető, ott a hiba oka.
- **Skórkártya:** az Előrejelzés nézet alján a „Mért összevetés” szakasz mutatja a modellek hibáját a valódi állomási méréshez képest.

## v18
- **Figyelmeztetések:** nem kell beállítani, az alapértelmezett küszöbök a kódban vannak. Átírni az `alert-config.json` fájl `rules` részével lehet, például: `"rules": { "riverCorridor": false, "heavyRainMmH": 20 }`.
- **Ellenőrzés:** az Előrejelzés nézet alján, a modellek összevetése után a „Figyelmeztetések a következő 24 órára” szakasz; nyugodt időben azt írja, hogy nincs jelzés.

## v20
- **Heti jelentés:** nem kell beállítani. Vasárnap 8:00-kor ntfy-üzenetet kapsz. **Ha egy vasárnap nem érkezik meg, a háttérfigyelő leállt**: nézd meg az Actions fület, és indítsd újra a Háttérfigyelőt (Run workflow).
- **Főképernyő:** az összkép-sor elején megjelenik a ⚠ jelzés, ha van aktív figyelmeztetés; kinyitva külön sorban látszik, koppintásra az Előrejelzés nézet nyílik.
