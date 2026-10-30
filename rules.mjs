/* Közlekedési és szabadtéri figyelmeztetések az óránkénti előrejelzésből: fekete jég, heves eső (akvaplaning),
   sínhőmérséklet és folyóparti széllökés. Egyszerű, ellenőrizhető küszöbszabályok, heurisztikák: nem hivatalos útellenőrzés.
   Az eredményt a háttérfigyelő a HungaroMet mért adatához méri (a találati arány az appban látszik). Ár- és piaci mutatót nem számol. */
const fin = Number.isFinite;

export const RULE_DEFAULTS = {
  enabled: true,
  riverCorridor: true,          /* a hely folyóparton van-e (Körmend: Rába) */
  roadIce: { surfC: 0.5, dewSpreadC: 1.0, rhPct: 88, precipMm: 0.1, precipAirC: 1.0 },
  heavyRainMmH: 15,
  trackHeat: { airC: 31, ghiWm2: 750 },
  riverGustMs: 15,
  verifyTolerance: { iceAirC: 1.5, rainMmH: 7.5, heatAirC: 29, gustMs: 12 }
};
export const RULE_COOLDOWN = { roadIce: 6, heavyRain: 6, trackHeat: 12, riverGust: 8 };

export function rulesConfig(CFG) {
  const u = CFG.rules || {};
  return { ...RULE_DEFAULTS, ...u, roadIce: { ...RULE_DEFAULTS.roadIce, ...(u.roadIce || {}) }, trackHeat: { ...RULE_DEFAULTS.trackHeat, ...(u.trackHeat || {}) }, verifyTolerance: { ...RULE_DEFAULTS.verifyTolerance, ...(u.verifyTolerance || {}) } };
}

const first = (idx) => {   /* a legkorábbi összefüggő ablak; egy órás rés még összetartozik */
  if (!idx.length) return null;
  let s = idx[0], e = idx[0];
  for (let k = 1; k < idx.length; k++) { if (idx[k] - e <= 2) e = idx[k]; else break; }
  return { s, e };
};

/* h: az Open-Meteo óránkénti tömbjei (UTC), i0: az aktuális óra indexe. Visszaad: { kulcs: { start, end, ... } } */
export function evaluateRules({ h, i0, cfg }) {
  const out = {};
  if (!cfg.enabled || !h || !h.time) return out;
  const tm = h.time.map(t => Date.parse(t + "Z")), last = Math.min(i0 + 24, tm.length - 1);
  const at = (k, i) => (h[k] ? h[k][i] : undefined);
  const idxs = (pred) => { const a = []; for (let i = i0; i <= last; i++) if (pred(i)) a.push(i); return a; };
  const win = (w, extra) => ({ start: tm[w.s], end: tm[w.e] + 36e5, ...extra });

  /* 1) Fekete jég: nedves, fagypont körüli felszín (csapadék) vagy dér/zúzmara ülepedése (harmatpont-közelség) */
  const R = cfg.roadIce;
  const iceA = idxs(i => fin(at("precipitation", i)) && fin(at("temperature_2m", i)) && at("precipitation", i) >= R.precipMm && at("temperature_2m", i) <= R.precipAirC);
  const iceB = idxs(i => {
    const T = at("temperature_2m", i), Td = at("dew_point_2m", i), RH = at("relative_humidity_2m", i);
    if (!fin(T) || !fin(Td) || !fin(RH)) return false;
    const ts = fin(at("soil_temperature_0cm", i)) ? at("soil_temperature_0cm", i) : T - 1;   /* ha nincs felszíni hőmérséklet: a levegő 1 fokkal hidegebbje */
    return ts <= R.surfC && (T - Td) <= R.dewSpreadC && RH >= R.rhPct;
  });
  const iceAll = [...new Set([...iceA, ...iceB])].sort((a, b) => a - b), wi = first(iceAll);
  if (wi) {
    const ids = iceAll.filter(i => i >= wi.s && i <= wi.e);
    const tmin = Math.min(...ids.map(i => at("temperature_2m", i)).filter(fin));
    const psum = ids.reduce((s, i) => s + (fin(at("precipitation", i)) ? at("precipitation", i) : 0), 0);
    const wet = iceA.some(i => i >= wi.s && i <= wi.e);
    out.roadIce = win(wi, { tmin, precip: psum, kind: wet ? "csapadék fagypont körül" : "dér, párás hideg levegő", severe: wet && tmin <= -1 });
  }
  /* 2) Heves eső: akvaplaning-veszély */
  const wr = first(idxs(i => fin(at("precipitation", i)) && at("precipitation", i) >= cfg.heavyRainMmH));
  if (wr) { const mx = Math.max(...idxs(i => i >= wr.s && i <= wr.e).map(i => at("precipitation", i))); out.heavyRain = win(wr, { max: mx, severe: mx >= 30 }); }
  /* 3) Sínhőmérséklet: nagy meleg és erős napsugárzás */
  const H = cfg.trackHeat;
  const wh = first(idxs(i => fin(at("temperature_2m", i)) && fin(at("shortwave_radiation", i)) && at("temperature_2m", i) >= H.airC && at("shortwave_radiation", i) >= H.ghiWm2));
  if (wh) { const mx = Math.max(...idxs(i => i >= wh.s && i <= wh.e).map(i => at("temperature_2m", i))); out.trackHeat = win(wh, { tmax: mx, severe: mx >= 35 }); }
  /* 4) Folyóparti széllökés */
  if (cfg.riverCorridor) {
    const lim = cfg.riverGustMs * 3.6;   /* az Open-Meteo km/h-ban adja */
    const wg = first(idxs(i => fin(at("wind_gusts_10m", i)) && at("wind_gusts_10m", i) >= lim));
    if (wg) { const mx = Math.max(...idxs(i => i >= wg.s && i <= wg.e).map(i => at("wind_gusts_10m", i))); out.riverGust = win(wg, { gustKmh: mx, severe: mx >= 80 }); }
  }
  return out;
}

const hourLocal = (ms, tz) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(ms)) % 24;
const dayLocal = (ms, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(ms);
const pad = n => String(n).padStart(2, "0");
export function whenText(start, end, tz, now) {
  const d0 = dayLocal(start, tz), dn = dayLocal(now, tz), dt = dayLocal(now + 864e5, tz);
  const name = d => d === dn ? "ma" : d === dt ? "holnap" : d;
  const e = end - 36e5;
  const d1 = dayLocal(e, tz), a = pad(hourLocal(start, tz)), b = pad(hourLocal(e, tz) + 1 > 23 ? 0 : hourLocal(e, tz) + 1);
  return d0 === d1 ? `${name(d0)} ${a}–${b} óra között` : `${name(d0)} ${a} óra és ${name(d1)} ${pad(hourLocal(e, tz))} óra között`;
}

/* A figyelmeztetés szövege (ntfy és app). */
export function describeRule(key, r, CFG, now) {
  const w = whenText(r.start, r.end, CFG.timezone, now), p = CFG.place;
  if (key === "roadIce") return { title: "Fekete jég veszély", short: `fekete jég ${w}`, message: `${p}: ${w} síkosság-veszély (${r.kind}), legalacsonyabb előrejelzett hőmérséklet ${r.tmin.toFixed(1)} °C${r.precip > 0 ? ", csapadék " + r.precip.toFixed(1) + " mm" : ""}. Előrejelzés és heurisztika, nem útellenőrzés.`, priority: r.severe ? 4 : 3, tags: ["snowflake", "warning"], severe: r.severe };
  if (key === "heavyRain") return { title: `Heves eső: ${Math.round(r.max)} mm/h`, short: `heves eső ${w}`, message: `${p}: ${w} az előrejelzett csapadékintenzitás eléri a ${Math.round(r.max)} mm/h-t. Akvaplaning-veszély, vezess óvatosan. Előrejelzés.`, priority: r.severe ? 4 : 3, tags: ["cloud_with_rain", "warning"], severe: r.severe };
  if (key === "trackHeat") return { title: `Sínhőmérséklet-veszély: ${Math.round(r.tmax)} °C`, short: `nagy hőség, sínhőmérséklet ${w}`, message: `${p}: ${w} ${Math.round(r.tmax)} °C és erős napsugárzás várható, a sínek jóval a levegőnél melegebbek lehetnek. Előrejelzés.`, priority: r.severe ? 4 : 3, tags: ["hot_face", "warning"], severe: r.severe };
  return { title: `Folyóparti széllökés: ${Math.round(r.gustKmh)} km/h`, short: `folyóparti széllökés ${w}`, message: `${p}: ${w} a folyóparton ${Math.round(r.gustKmh)} km/h-s széllökés várható. Előrejelzés.`, priority: r.severe ? 4 : 3, tags: ["dash", "warning"], severe: r.severe };
}

/* Ellenőrzés a mért állomási adattal. A találat tágabb küszöbű, mert az állomás nem pontosan a te helyeden áll;
   a fekete jégnél csak a hőmérsékleti feltétel mérhető, a jég maga nem. */
export function verifyRules({ log, obsRows, now, cfg }) {
  const stats = {};
  if (!obsRows || !obsRows.length) return stats;
  const rows = obsRows.map(r => ({ ms: Date.parse(r.h + ":00:00Z"), ...r })), lastMs = rows[rows.length - 1].ms, T = cfg.verifyTolerance;
  for (const e of log) {
    if (e.status !== "pending") continue;
    if (e.end + 2 * 36e5 > lastMs) { if (now - e.end > 4 * 864e5) e.status = "nodata"; continue; }
    const w = rows.filter(r => r.ms >= e.start - 36e5 && r.ms <= e.end + 36e5);
    if (!w.length) { e.status = "nodata"; continue; }
    const mx = k => Math.max(...w.map(r => r[k]).filter(fin)), mn = k => Math.min(...w.map(r => r[k]).filter(fin));
    let hit = false;
    if (e.key === "roadIce") hit = mn("t") <= T.iceAirC;
    else if (e.key === "heavyRain") hit = mx("r") >= T.rainMmH;
    else if (e.key === "trackHeat") hit = mx("t") >= T.heatAirC;
    else if (e.key === "riverGust") hit = mx("fx") >= T.gustMs;
    e.status = hit ? "hit" : "miss";
  }
  for (const e of log) if (e.status === "hit" || e.status === "miss") { const s = (stats[e.key] ||= { n: 0, hit: 0 }); s.n++; if (e.status === "hit") s.hit++; }
  return stats;
}
