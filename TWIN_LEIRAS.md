# Solaris-Yantra Digital Twin Core Node (twin.html + 7 modul)

Belépési pont: `twin.html` (nem `index.html`, hogy ne írja felül a fő Solaris-Yantra 3D appot).
A modulok egy közös adatbuszon (`BroadcastChannel("solaris_yantra_core")`) beszélgetnek.

| Fájl | Szerep | Valós adatforrás |
|---|---|---|
| p1_geophysics_globe.js | közös mag (busz, zóna, CircularBuffer), 3D gömb, geofizika | NOAA SWPC: Kp, napszél, Bz, napkitörés |
| p2_microclimate_engine.js | aszály-/hőstressz, vízmérleg, talajhő | Open-Meteo előrejelző + archívum (11 év, ERA5) |
| p3_predictive_engine.js | EMA 24/72/336 h, légnyomás-tendencia, rezsim | Open-Meteo óránkénti légnyomás |
| p4_agri_engine.js | agrár-stressz index (ASI) | P2 + P3 |
| p5_energy_engine.js | hálózati stressz (GSI), vízhozam, GIC | Open-Meteo árvíz-API, P1, P2 |
| p6_macro_breakout_engine.js | összevont stresszindex (CSI), hatás-lánc | P1–P5 |
| p7_audio_engine.js | Web Audio szonifikáció (144 Hz alaphang) | P5, P6 |

## Mi tér el az eredeti specifikációtól, és miért
- **Fix helyőrző értékek helyett élő adat:** a régi `historicalMean 12.5 / StdDev 4.2`, a folyó hőmérséklete (26,5 °C) és a CDD (8,5 / 4,2) kitalált számok voltak. Most a Z-pontszám a hely saját, 11 éves klimatológiájához mér; a vízhozam és a hűtési fokosnap valós adatból jön.
- **Árupiaci rész kikerült:** a műtrágya/gáz szorzó és a réz/arany arány élő, kulcs nélküli forrás híján nem számolható, a „+35% árelmozdulás" és a „terméscsökkenés %" fix együtthatókra épült. Ezeket nem becsüli a rendszer; helyette minőségi stressz-osztály van. Ez nem pénzügyi tanács.
- **Egy zóna:** a P5 régi „SEC_NORTH_SEA_EU" azonosítója soha nem egyezett a P2-vel, ezért minden modul egy közös zónát használ (GPS, ha https-en engedélyezed; különben Körmend).
- **P1 hiányzott a specifikációból,** megírtam: geofizikai adatok + 3D földgömb (terminátor-közelítés, aurórazóna-közelítés a Kp-ból).
- **Küszöbök:** CSI-küszöb 2,0 (az eredeti 2,5 a súlyok miatt gyakorlatilag elérhetetlen volt); az ASI 20-szoros Z-skálázású, küszöb 50.
- **Hang:** csak koppintás után indul, vagy „hang nélkül" is indítható.
