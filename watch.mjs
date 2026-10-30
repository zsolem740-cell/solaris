/* Solaris-Yantra háttérfigyelő · GitHub Actions (Node 20), a telefon nélkül is fut.
   Élő forrásokat néz (NOAA SWPC, Open-Meteo, USGS), és ntfy-értesítést küld, ha egy küszöböt átlépnek.
   Az ntfy-téma titok: a GitHub "NTFY_TOPIC" titkából jön, a kódban sehol nem szerepel.
   Nem hivatalos figyelmeztetés, csak tájékoztatás. */
import fs from "node:fs";
import { computeCSI } from "./csi.mjs";
import { recordForecast, verifyForecasts, eraTruth, TRACKS } from "./score.mjs";
import { updateObs, obsTruth } from "./obs.mjs";
import { rulesConfig, evaluateRules, describeRule, verifyRules, RULE_COOLDOWN } from "./rules.mjs";

const CFG = JSON.parse(fs.readFileSync("alert-config.json", "utf8"));
const TH = CFG.thresholds, CD = CFG.cooldownHours;
const TOPIC = (process.env.NTFY_TOPIC || "").trim();
const TEST = process.env.TEST === "1";
const NOW = Date.now();
const NOAA = "https://services.swpc.noaa.gov/";
/* csendes órák: a kisebb riasztás ilyenkor hangtalanul (ntfy 1-es prioritás) érkezik, csak a nagyok szólalnak meg */
const Q = CFG.quiet || { enabled: true, from: 22, to: 7 };
const LOCAL_HOUR = Number(new Intl.DateTimeFormat("en-GB", { timeZone: CFG.timezone, hour: "2-digit", hour12: false }).format(NOW)) % 24;
const IS_QUIET = !!Q.enabled && !TEST && (Q.from > Q.to ? (LOCAL_HOUR >= Q.from || LOCAL_HOUR < Q.to) : (LOCAL_HOUR >= Q.from && LOCAL_HOUR < Q.to));

fs.mkdirSync("data", { recursive: true });
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const STATE = Object.assign({ cool: {}, seenQuakes: [], lastDigest: "", lastHist: "", recent: [], lastCsi: null }, readJ("data/state.json", {}));
const HIST = readJ("data/history.json", []);
const SOURCES = {};

async function get(name, url, ms = 20000) {
  const t0 = Date.now(), ac = new AbortController(), to = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "solaris-yantra-watch" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    SOURCES[name] = { ok: true, ms: Date.now() - t0 };
    return j;
  } catch (e) {
    SOURCES[name] = { ok: false, ms: Date.now() - t0, error: String((e && e.message) || e) };
    return null;
  } finally { clearTimeout(to); }
}
const num = v => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
function toObjs(d) {
  if (!Array.isArray(d) || !d.length) return [];
  if (Array.isArray(d[0])) { const h = d[0].map(x => String(x)); return d.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }
  return d;
}
function lastVals(d, keys, n) {
  const rows = toObjs(d), out = [];
  for (let i = rows.length - 1; i >= 0 && out.length < n; i--) {
    if (rows[i].active === false) continue;
    for (const k of keys) { const v = num(rows[i][k]); if (v !== null) { out.push(v); break; } }
  }
  return out;
}
const EXP = { A: -8, B: -7, C: -6, M: -5, X: -4 };
const fluxOf = s => { const m = String(s).match(/^([ABCMX])(\d+(?:\.\d+)?)$/i); return m ? Number(m[2] + "e" + EXP[m[1].toUpperCase()]) : null; };
const fcls = f => { const k = f >= 1e-4 ? ["X", 1e-4] : f >= 1e-5 ? ["M", 1e-5] : f >= 1e-6 ? ["C", 1e-6] : f >= 1e-7 ? ["B", 1e-7] : ["A", 1e-8]; return k[0] + (f / k[1]).toFixed(1); };
const rScale = f => f >= 2e-3 ? "R5" : f >= 1e-3 ? "R4" : f >= 1e-4 ? "R3" : f >= 5e-5 ? "R2" : f >= 1e-5 ? "R1" : "R0";
const hhmm = t => new Date(t).toLocaleTimeString("hu-HU", { timeZone: CFG.timezone, hour: "2-digit", minute: "2-digit" });
const km = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, dx = (c - a) * r, dy = (d - b) * r; const h = Math.sin(dx / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dy / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

const PLA = [NOAA + "products/solar-wind/plasma-2-hour.json", NOAA + "json/rtsw/rtsw_wind_1m.json", NOAA + "products/summary/solar-wind-speed.json"];
const MAG = [NOAA + "products/solar-wind/mag-2-hour.json", NOAA + "json/rtsw/rtsw_mag_1m.json", NOAA + "products/summary/solar-wind-mag-field.json"];
async function chain(name, urls, keys, n) {
  for (const u of urls) {
    const d = await get(name, u);
    if (!d) continue;
    const vals = Array.isArray(d) ? lastVals(d, keys, n) : [num(d.WindSpeed ?? d.Bz ?? d.speed ?? d.bz)].filter(v => v !== null);
    if (vals.length) return vals;
  }
  return [];
}

async function collect() {
  const C = {};
  const [kpD, kpF, flD, spd, bzv, wx, qk] = await Promise.all([
    get("noaa_kp", NOAA + "products/noaa-planetary-k-index.json"),
    get("noaa_kp_forecast", NOAA + "products/noaa-planetary-k-index-forecast.json"),
    get("noaa_goes_flux", NOAA + "json/goes/primary/xrays-6-hour.json"),
    chain("noaa_wind", PLA, ["speed", "proton_speed"], 3),
    chain("noaa_mag", MAG, ["bz_gsm"], 10),
    get("open_meteo", `https://api.open-meteo.com/v1/forecast?latitude=${CFG.lat}&longitude=${CFG.lon}&hourly=temperature_2m,pressure_msl,wind_gusts_10m,cloud_cover,wind_speed_10m,precipitation,relative_humidity_2m,dew_point_2m,shortwave_radiation,soil_temperature_0cm&past_days=1&forecast_days=2&timezone=UTC`),
    get("usgs", `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${CFG.lat}&longitude=${CFG.lon}&maxradiuskm=${TH.quakeRadiusKm}&minmagnitude=${TH.quakeMag}&starttime=${new Date(NOW - 3 * 36e5).toISOString()}`)
  ]);
  C.kp = kpD ? lastVals(kpD, ["Kp", "kp", "estimated_kp"], 1)[0] ?? null : null;
  C.kpMax24 = null;
  if (kpF) for (const r of toObjs(kpF)) {
    const t = Date.parse(String(r.time_tag).replace(" ", "T") + "Z"), k = num(r.kp);
    if (k !== null && Number.isFinite(t) && t > NOW - 3 * 36e5 && t <= NOW + 24 * 36e5) C.kpMax24 = Math.max(C.kpMax24 ?? 0, k);
  }
  C.flux = null;
  if (Array.isArray(flD)) for (const r of flD) {
    if (r.energy !== "0.1-0.8nm") continue;
    const t = Date.parse(r.time_tag), f = Number(r.flux);
    if (f > 0 && (!Number.isFinite(t) || t > NOW - 60 * 6e4)) C.flux = Math.max(C.flux ?? 0, f);
  }
  C.speed = spd.length ? spd[0] : null;
  C.bz = bzv.length ? bzv.reduce((a, b) => a + b, 0) / bzv.length : null;
  C.bzN = bzv.length;
  if (wx && wx.hourly) {
    const h = wx.hourly, tm = h.time.map(t => Date.parse(t + "Z"));
    let i0 = 0; tm.forEach((t, i) => { if (t <= NOW) i0 = i; });
    const idx = []; for (let i = i0; i <= Math.min(i0 + 12, tm.length - 1); i++) idx.push(i);
    const T = idx.map(i => h.temperature_2m[i]).filter(Number.isFinite);
    if (T.length) { C.tmin12 = Math.min(...T); C.tmax12 = Math.max(...T); C.tminAt = tm[idx.find(i => h.temperature_2m[i] === C.tmin12)]; }
    const G = idx.map(i => h.wind_gusts_10m[i]).filter(Number.isFinite);
    if (G.length) C.gust12 = Math.max(...G);
    let dp = null;
    for (let i = i0; i <= Math.min(i0 + 9, tm.length - 4); i++) { const d = h.pressure_msl[i + 3] - h.pressure_msl[i]; if (Number.isFinite(d)) dp = dp === null ? d : Math.min(dp, d); }
    C.dp3 = dp;
    C.wxH = h; C.wxI0 = i0;
    C.p0 = h.pressure_msl[i0]; C.t0 = h.temperature_2m[i0];
    C.cl0 = h.cloud_cover ? h.cloud_cover[i0] : null; C.ws0 = h.wind_speed_10m ? h.wind_speed_10m[i0] : null;
    C.gu0 = h.wind_gusts_10m[i0]; C.pr0 = h.precipitation ? h.precipitation[i0] : null; C.rh0 = h.relative_humidity_2m ? h.relative_humidity_2m[i0] : null;
  }
  C.quakes = (qk && qk.features) || [];
  return C;
}

const alerts = [];
const RC = rulesConfig(CFG), RCD = { ...RULE_COOLDOWN, ...(CFG.cooldownHours || {}) };
let RULES = {};
const RULES_LOG = readJ("data/rules.json", { log: [], stats: {} });
if (!Array.isArray(RULES_LOG.log)) RULES_LOG.log = [];
function maybe(key, hours, make) {
  if (!TEST && NOW - (STATE.cool[key] || 0) < hours * 36e5) return;
  const a = make();
  if (a) alerts.push({ key, ...a });
}
function evaluate(C) {
  maybe("kp", CD.kp, () => C.kp !== null && C.kp >= TH.kp ? { title: `Geomágneses vihar: Kp ${C.kp.toFixed(1)}`, message: `NOAA becsült Kp ${C.kp.toFixed(1)} (G${Math.max(1, Math.floor(C.kp) - 4)}). Sarki fény és műholdas/GPS-zavar lehetséges. Részletek az appban.`, priority: C.kp >= 7 ? 5 : 4, tags: ["zap"] } : null);
  maybe("kpForecast", CD.kpForecast, () => C.kpMax24 !== null && C.kpMax24 >= TH.kpForecast && !(C.kp !== null && C.kp >= TH.kp) ? { title: `Kp ${C.kpMax24} várható 24 órán belül`, message: `A NOAA előrejelzése szerint a következő 24 órában a Kp elérheti a ${C.kpMax24}-öt. Jelenleg: ${C.kp ?? "--"}.`, priority: 3, tags: ["warning"] } : null);
  maybe("flare", CD.flare, () => { const th = fluxOf(TH.flareClass); return C.flux !== null && th !== null && C.flux >= th ? { title: `Napkitörés: ${fcls(C.flux)} (${rScale(C.flux)})`, message: `Az elmúlt órában a GOES röntgenfluxus elérte a ${fcls(C.flux)} osztályt. HF rádiós zavar (rádió-blackout, ${rScale(C.flux)}) lehetséges a nappali oldalon.`, priority: C.flux >= 1e-4 ? 5 : 4, tags: ["sunny"] } : null; });
  maybe("bz", CD.bz, () => C.bz !== null && C.bz <= TH.bz ? { title: `Erősen déli Bz: ${C.bz.toFixed(1)} nT`, message: `Az utolsó ${C.bzN} perc átlaga ${C.bz.toFixed(1)} nT${C.speed ? ", napszél " + Math.round(C.speed) + " km/s" : ""}. Ilyenkor a geomágneses vihar esélye megnő.`, priority: 4, tags: ["zap"] } : null);
  maybe("frost", CD.frost, () => C.tmin12 !== undefined && C.tmin12 <= TH.frostC ? { title: `Fagyveszély: ${C.tmin12.toFixed(1)} °C`, message: `${CFG.place}: a következő 12 órában a legalacsonyabb előrejelzett hőmérséklet ${C.tmin12.toFixed(1)} °C (${hhmm(C.tminAt)}).`, priority: C.tmin12 <= -3 ? 4 : 3, tags: ["snowflake"] } : null);
  maybe("pressure", CD.pressure, () => C.dp3 !== null && C.dp3 !== undefined && C.dp3 <= TH.pressureDrop3h ? { title: `Gyors nyomásesés: ${C.dp3.toFixed(1)} hPa / 3 óra`, message: `${CFG.place}: a modell gyors légnyomásesést jelez a következő órákra, ami gyakran front vagy vihar előjele.`, priority: 3, tags: ["chart_with_downwards_trend"] } : null);
  maybe("gust", CD.gust, () => C.gust12 !== undefined && C.gust12 >= TH.gustKmh ? { title: `Erős széllökés: ${Math.round(C.gust12)} km/h`, message: `${CFG.place}: a következő 12 órában a modell szerint a széllökés elérheti a ${Math.round(C.gust12)} km/h-t.`, priority: 4, tags: ["dash"] } : null);
  /* közlekedési és szabadtéri szabályok az óránkénti előrejelzésből */
  RULES = C.wxH ? evaluateRules({ h: C.wxH, i0: C.wxI0, cfg: RC }) : {};
  for (const [key, res] of Object.entries(RULES)) {
    maybe(key, RCD[key] ?? 6, () => {
      if (key === "riverGust" && (alerts.some(a => a.key === "gust") || NOW - (STATE.cool.gust || 0) < (CD.gust || 8) * 36e5)) return null;   /* nem kettőzi az általános széllökés-riasztást */
      const d = describeRule(key, res, CFG, NOW);
      if (!TEST) RULES_LOG.log.push({ key, issued: new Date(NOW).toISOString(), start: res.start, end: res.end, status: "pending" });
      return d;
    });
  }
  let n = 0;
  for (const f of C.quakes) {
    if (STATE.seenQuakes.includes(f.id) || n >= 3) continue;
    const m = f.properties.mag, [lo, la] = f.geometry.coordinates, d = Math.round(km(CFG.lat, CFG.lon, la, lo));
    alerts.push({ key: "quake:" + f.id, quakeId: f.id, title: `Földrengés: M${m} (${d} km-re)`, message: `${f.properties.place}. Idő: ${hhmm(f.properties.time)}. Forrás: USGS.`, priority: m >= 5 ? 4 : 3, tags: ["earth_africa"], mag: m });
    n++;
  }
  if (TEST) alerts.splice(0, alerts.length, { key: "test", title: "Teszt: a háttérfigyelő működik", message: `Kp ${C.kp ?? "--"}, napszél ${C.speed ? Math.round(C.speed) : "--"} km/s, ${CFG.place}: ${C.t0 !== undefined ? C.t0.toFixed(1) + " °C" : "--"}. Ha ezt látod, az értesítések rendben vannak.`, priority: 3, tags: ["white_check_mark"] });
}
async function digest(C) {
  if (!CFG.digest || !CFG.digest.enabled || TEST) return;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CFG.timezone }).format(NOW);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: CFG.timezone, hour: "2-digit", hour12: false }).format(NOW));
  if (hour !== CFG.digest.hour || STATE.lastDigest === day) return;
  const f = v => v === null || v === undefined ? "--" : v;
  alerts.push({ key: "digest", digest: day, title: `Reggeli összefoglaló · ${CFG.place}`, priority: 2, tags: ["sunrise"], message:
    `Űridőjárás: Kp ${f(C.kp)} (24 h max ${f(C.kpMax24)}), napszél ${C.speed ? Math.round(C.speed) : "--"} km/s, Bz ${C.bz !== null ? C.bz.toFixed(1) : "--"} nT, napkitörés ${C.flux ? fcls(C.flux) : "nincs"}.\n` +
    `Időjárás (12 óra): ${C.tmin12 !== undefined ? C.tmin12.toFixed(0) + "…" + C.tmax12.toFixed(0) + " °C" : "--"}, széllökés max ${C.gust12 !== undefined ? Math.round(C.gust12) : "--"} km/h, nyomás ${C.p0 !== undefined ? Math.round(C.p0) : "--"} hPa.\n` +
    `Fagy: ${C.tmin12 !== undefined && C.tmin12 <= TH.frostC ? "igen" : "nem várható"}.\n` +
    `Közlekedés, szabadtér (24 óra): ${Object.keys(RULES).length ? Object.entries(RULES).map(([k, r]) => describeRule(k, r, CFG, NOW).short).join("; ") : "nincs jelzés"}.` });
}
function isLoud(a, C) {
  if (a.severe) return true;
  if (a.key === "kp") return C.kp >= 7;
  if (a.key === "flare") return C.flux >= 5e-5;
  if (a.key === "bz") return C.bz <= -15;
  if (a.key === "frost") return C.tmin12 <= -3;
  if (a.key === "pressure") return C.dp3 <= -8;
  if (a.key === "gust") return C.gust12 >= 90;
  if (a.key && a.key.startsWith("quake:")) return a.mag >= 5;
  return false;
}
async function ntfy(a) {
  if (!TOPIC) return false;
  const quietNow = IS_QUIET && !a.loud && a.key !== "digest";
  try {
    const r = await fetch("https://ntfy.sh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: TOPIC, title: a.title, message: a.message, priority: quietNow ? 1 : (a.priority || 3), tags: quietNow ? [...(a.tags || []), "zzz"] : (a.tags || []), click: CFG.appUrl }) });
    return r.ok;
  } catch (e) { return false; }
}

const C = await collect();
evaluate(C);
await digest(C);
for (const a of alerts) a.loud = isLoud(a, C);
const sent = [];
for (const a of alerts) {
  const ok = await ntfy(a);
  if (ok) {
    sent.push({ t: new Date(NOW).toISOString(), key: a.key.startsWith("quake:") ? "quake" : a.key, title: a.title });
    if (a.quakeId) STATE.seenQuakes.push(a.quakeId);
    else if (a.digest) STATE.lastDigest = a.digest;
    else if (a.key !== "test") STATE.cool[a.key] = NOW;
  }
}
STATE.seenQuakes = STATE.seenQuakes.slice(-200);
STATE.recent = [...sent, ...(STATE.recent || [])].slice(0, 20);

const hourKey = new Date(NOW).toISOString().slice(0, 13);
let climUpdated = false, rowAdded = false;
if (STATE.lastHist !== hourKey) {
  /* óránként egyszer: az összevont stresszindex (CSI) a P8 tanuló modul számára */
  try {
    const r = await computeCSI({ get, CFG, NOW, kp: C.kp, clim: readJ("data/clim.json", null) });
    if (r.climUpdated && r.clim) { fs.writeFileSync("data/clim.json", JSON.stringify(r.clim)); climUpdated = true; }
    STATE.lastCsi = r.csi !== null ? { t: new Date(NOW).toISOString(), csi: r.csi, comp: r.comp } : null;
  } catch (e) { SOURCES.csi = { ok: false, ms: 0, error: String((e && e.message) || e) }; STATE.lastCsi = null; }
  const row = { t: new Date(NOW).toISOString().slice(0, 16) + "Z", kp: C.kp, speed: C.speed !== null ? Math.round(C.speed) : null, bz: C.bz !== null ? +C.bz.toFixed(2) : null, flux: C.flux, p: C.p0 ?? null, tmp: C.t0 ?? null, cl: C.cl0 ?? null, ws: C.ws0 != null ? Math.round(C.ws0) : null, gu: C.gu0 != null ? Math.round(C.gu0) : null, pr: C.pr0 ?? null, rh: C.rh0 != null ? Math.round(C.rh0) : null };
  if (STATE.lastCsi) { row.csi = STATE.lastCsi.csi; row.comp = STATE.lastCsi.comp; }
  HIST.push(row);
  rowAdded = true;
  while (HIST.length > 24 * 14) HIST.shift();
  STATE.lastHist = hourKey;
}

let SCORE = readJ("data/scorecard.json", { models: {}, verified: 0 });
let SCORE_OBS = readJ("data/scorecard_obs.json", { models: {}, verified: 0 });
let PENDING = readJ("data/forecasts.json", []);
let PENDING_OBS = readJ("data/forecasts_obs.json", []);
let OBS = readJ("data/obs.json", null);
const note = (name, ok, ms, err) => { SOURCES[name] = { ok, ms, ...(err ? { error: err } : {}) }; };
if (STATE.lastScore !== hourKey) {
  /* óránként: a HungaroMet mérések frissítése, a 4 modell jóslatának elmentése és kiértékelése (ERA5 és mért állomás) */
  try { OBS = await updateObs({ CFG, NOW, prev: OBS, note }); } catch (e) { note("hungaromet", false, 0, String((e && e.message) || e)); }
  try { RULES_LOG.stats = verifyRules({ log: RULES_LOG.log, obsRows: OBS && OBS.rows, now: NOW, cfg: RC }); } catch (e) { SOURCES.rules = { ok: false, ms: 0, error: String((e && e.message) || e) }; }
  const scs = [{ id: "obs", sc: SCORE_OBS }, { id: "era5", sc: SCORE }];
  try {
    const rf = await recordForecast({ get, CFG, NOW, scs, track: TRACKS.era5 });
    if (rf) { PENDING.push(rf.rec); fs.writeFileSync("data/blend.json", JSON.stringify(rf.blend)); }
    const v = await verifyForecasts({ get, CFG, NOW, pending: PENDING, sc: SCORE, track: TRACKS.era5, truth: eraTruth(get, CFG) });
    PENDING = v.pending; SCORE = v.sc;
  } catch (e) { SOURCES.score = { ok: false, ms: 0, error: String((e && e.message) || e) }; }
  if (OBS && OBS.station && OBS.rows && OBS.rows.length) {
    try {   /* a mért állomás pontjára külön jóslat, hogy a mérés és a modell ugyanarra a helyre vonatkozzon */
      const tag = String(OBS.station.id);
      const rf2 = await recordForecast({ get, CFG, NOW, scs: [{ id: "obs", sc: SCORE_OBS }], track: TRACKS.obs, lat: OBS.station.lat, lon: OBS.station.lon, tag });
      if (rf2) PENDING_OBS.push(rf2.rec);
      const v2 = await verifyForecasts({ get, CFG, NOW, pending: PENDING_OBS, sc: SCORE_OBS, track: TRACKS.obs, truth: obsTruth(OBS), lagMs: 25 * 36e5, maxAgeMs: 5 * 864e5, tag });
      PENDING_OBS = v2.pending; SCORE_OBS = v2.sc;
    } catch (e) { SOURCES.score_obs = { ok: false, ms: 0, error: String((e && e.message) || e) }; }
  }
  PENDING = PENDING.slice(-24 * 21);
  PENDING_OBS = PENDING_OBS.slice(-24 * 6);
  STATE.lastScore = hourKey;
}
fs.writeFileSync("data/forecasts.json", JSON.stringify(PENDING));
fs.writeFileSync("data/scorecard.json", JSON.stringify(SCORE));
fs.writeFileSync("data/forecasts_obs.json", JSON.stringify(PENDING_OBS));
fs.writeFileSync("data/scorecard_obs.json", JSON.stringify(SCORE_OBS));
if (OBS) fs.writeFileSync("data/obs.json", JSON.stringify(OBS));
RULES_LOG.log = RULES_LOG.log.slice(-80);
RULES_LOG.updated = new Date(NOW).toISOString();
RULES_LOG.active = Object.entries(RULES).map(([k, r]) => { const d = describeRule(k, r, CFG, NOW); return { key: k, title: d.title, text: d.short, message: d.message, start: r.start, end: r.end, severe: !!r.severe }; });
fs.writeFileSync("data/rules.json", JSON.stringify(RULES_LOG));

const anyOk = Object.values(SOURCES).some(s => s.ok);
const status = {
  updated: new Date(NOW).toISOString(), ok: anyOk, place: CFG.place,
  notify: { configured: !!TOPIC, attempted: alerts.length, sent: sent.length },
  sources: SOURCES,
  current: { kp: C.kp, kpMax24: C.kpMax24, flux: C.flux, flare: C.flux ? fcls(C.flux) : null, speed: C.speed, bz: C.bz, tmin12: C.tmin12 ?? null, gust12: C.gust12 ?? null, dp3: C.dp3 ?? null, pressure: C.p0 ?? null },
  csi: STATE.lastCsi,
  score: { records: PENDING.length, verified: SCORE.verified || 0, since: SCORE.since || null },
  rules: { active: Object.keys(RULES), stats: RULES_LOG.stats || {} },
  scoreObs: { records: PENDING_OBS.length, verified: SCORE_OBS.verified || 0, since: SCORE_OBS.since || null },
  obs: OBS ? { station: OBS.station, last: OBS.rows && OBS.rows.length ? OBS.rows[OBS.rows.length - 1].h : null, rows: OBS.rows ? OBS.rows.length : 0, via: OBS.via, stale: !!OBS.stale, error: OBS.error || null } : null,
  quiet: { enabled: !!Q.enabled, from: Q.from, to: Q.to, now: IS_QUIET },
  history: { rows: HIST.length, withCsi: HIST.filter(h => typeof h.csi === "number").length, since: HIST[0] ? HIST[0].t : null },
  recent: STATE.recent,
  thresholds: TH
};
fs.writeFileSync("data/status.json", JSON.stringify(status, null, 1));
fs.writeFileSync("data/state.json", JSON.stringify(STATE));
fs.writeFileSync("data/history.json", JSON.stringify(HIST));

/* mentés: óránként egyszer (az óra első futásánál, bármelyik percben), riasztásnál, teszt-módban és új klimatológiánál */
const commit = rowAdded || sent.length > 0 || TEST || climUpdated;
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `commit=${commit}\n`);
console.log(`Kész: források ${Object.values(SOURCES).filter(s => s.ok).length}/${Object.keys(SOURCES).length}, riasztás ${alerts.length}, elküldve ${sent.length}, ntfy ${TOPIC ? "beállítva" : "NINCS beállítva"}.`);
