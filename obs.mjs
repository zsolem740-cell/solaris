/* HungaroMet mért állomási adatok (odp.met.hu, ingyenes nyílt adat, kulcs nélkül).
   Forrásmegjelölés: „Database: Meteorological Database, HungaroMet Nonprofit Zrt."
   Az óránkénti automata állomási fájlból kiválasztja a Körmendhez legközelebbi állomást, és egy 4 napos gördülő
   idősort tart fenn a skórkártya „valóságának". Az adat nem módosul, csak kiolvasott, kerekítetlen értékek maradnak. */
import zlib from "node:zlib";

export const OBS_SOURCE = "Database: Meteorological Database, HungaroMet Nonprofit Zrt.";
const SYNOP_BASE = "https://odp.met.hu/weather/weather_reports/synoptic/hungary/hourly/";
const NOW_BASE = "https://odp.met.hu/climate/observations_hungary/hourly/now/";
const MAX_KM = 60, KEEP_H = 96;
const fin = Number.isFinite;

async function fetchBuf(url, ms = 30000) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "user-agent": "solaris-watch (github.com/zsolem740-cell/solaris)" } });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + url.replace("https://odp.met.hu", ""));
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(tm); }
}

/* Függőség nélküli ZIP-olvasó: az első fájlt csomagolja ki (tárolt vagy deflate). */
export function unzipFirst(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("nem ZIP fájl");
  const cd = buf.readUInt32LE(e + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error("hibás ZIP-könyvtár");
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), nlen = buf.readUInt16LE(cd + 28), lho = buf.readUInt32LE(cd + 42);
  const name = buf.toString("utf8", cd + 46, cd + 46 + nlen);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28), data = buf.subarray(start, start + csize);
  if (method !== 0 && method !== 8) throw new Error("ismeretlen ZIP-tömörítés: " + method);
  return { name, text: (method === 0 ? data : zlib.inflateRawSync(data)).toString("utf8") };
}

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const num = s => { if (s === undefined || s === null) return null; const v = parseFloat(String(s).trim().replace(",", ".")); return fin(v) && v !== -999 ? v : null; };
const ymdhm = s => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +(s.slice(8, 10) || 0), +(s.slice(10, 12) || 0));

/* Rugalmas CSV-olvasó: a fejléc oszlopnevei alapján, a ## és # metasorokat is kezeli (a „now" fájlokban a meta a # sorokban van). */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  let meta = null, header = null, start = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("##")) continue;
    if (l.startsWith("#")) {
      const c = l.slice(1).split(";").map(s => s.trim());
      if (/^\d+$/.test(c[0]) && c.length >= 7) meta = { id: c[0], lat: num(c[3]), lon: num(c[4]), elev: num(c[5]), name: c[6] };
      continue;
    }
    const n = l.split(";").map(norm);
    if (n.includes("time") && (n.includes("t") || n.includes("p0") || n.includes("ta"))) { header = n; start = i + 1; break; }
  }
  if (!header) throw new Error("nem találom a CSV fejlécét");
  const ix = k => header.indexOf(k), I = { time: ix("time"), st: ix("stationnumber"), name: ix("stationname"), lat: ix("latitude"), lon: ix("longitude"), elev: ix("elevation") };
  const P = Object.fromEntries(["t", "p0", "u", "r", "f", "fs", "fx"].map(k => [k, ix(k)]));
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    if (lines[i].startsWith("#")) continue;
    const c = lines[i].split(";").map(s => s.trim());
    const ts = c[I.time];
    if (!ts || !/^\d{10,12}$/.test(ts)) continue;
    rows.push({
      id: I.st >= 0 ? c[I.st].replace(/^0+/, "") || c[I.st] : (meta ? meta.id : ""),
      name: I.name >= 0 ? c[I.name] : (meta ? meta.name : ""),
      lat: I.lat >= 0 ? num(c[I.lat]) : (meta ? meta.lat : null), lon: I.lon >= 0 ? num(c[I.lon]) : (meta ? meta.lon : null),
      elev: I.elev >= 0 ? num(c[I.elev]) : (meta ? meta.elev : null),
      ms: Math.round(ymdhm(ts) / 36e5) * 36e5,
      t: P.t >= 0 ? num(c[P.t]) : null, p0: P.p0 >= 0 ? num(c[P.p0]) : null, u: P.u >= 0 ? num(c[P.u]) : null, r: P.r >= 0 ? num(c[P.r]) : null,
      f: (P.f >= 0 ? num(c[P.f]) : null) ?? (P.fs >= 0 ? num(c[P.fs]) : null), fx: P.fx >= 0 ? num(c[P.fx]) : null
    });
  }
  return rows;
}

export function distKm(a, b, c, d) {
  const R = 6371, r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/* A legközelebbi, hőmérsékletet mérő állomás; a korábban választottat megtartja, ha nincs nála sokkal közelebbi. */
function pickStation(rows, CFG, prev) {
  const st = new Map();
  for (const r of rows) {
    if (r.t === null || !fin(r.lat) || !fin(r.lon)) continue;
    st.set(r.id, { id: r.id, name: r.name, lat: r.lat, lon: r.lon, elev: r.elev, distKm: distKm(CFG.lat, CFG.lon, r.lat, r.lon) });
  }
  const all = [...st.values()].sort((a, b) => a.distKm - b.distKm);
  if (!all.length) return null;
  let best = all[0];
  const old = prev && prev.station && st.get(prev.station.id);
  if (old && old.distKm <= best.distKm + 15) best = old;
  return best.distKm <= MAX_KM ? best : { tooFar: best };
}

async function findLatestSynop(errs) {
  const seen = new Set(), queue = [[SYNOP_BASE, 0]], cands = [];
  while (queue.length && seen.size < 8) {
    const [dir, depth] = queue.shift();
    if (seen.has(dir)) continue;
    seen.add(dir);
    let html;
    try { html = (await fetchBuf(dir, 20000)).toString("utf8"); } catch (e) { errs.push(String(e.message || e)); continue; }
    for (const m of html.matchAll(/href="([^"#?]+)"/g)) {
      const l = m[1], z = l.match(/HABP_1H_SYNOP_(\d{14})\.csv\.zip$/);
      if (z) cands.push({ ts: z[1], url: new URL(l, dir).href });
      else if (depth < 2 && l.endsWith("/") && !l.startsWith("/") && !l.startsWith("..") && !l.startsWith("http")) queue.push([new URL(l, dir).href, depth + 1]);
    }
    if (cands.length) break;
  }
  if (!cands.length) throw new Error("SYNOP: nem található óránkénti fájl a listában");
  cands.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return cands[0];
}

export async function updateObs({ CFG, NOW, prev, note }) {
  const t0 = Date.now(), errs = [];
  let chosen = null, rows = null, via = "";
  try {
    const f = await findLatestSynop(errs);
    rows = parseCsv(unzipFirst(await fetchBuf(f.url)).text);
    chosen = pickStation(rows, CFG, prev);
    via = "SYNOP órás fájl";
    if (chosen && chosen.tooFar) { errs.push(`a legközelebbi állomás ${chosen.tooFar.name} ${chosen.tooFar.distKm.toFixed(0)} km-re van`); chosen = null; }
  } catch (e) { errs.push(String((e && e.message) || e)); }
  if (!chosen) {
    try {   /* tartalék: egy megadott állomás fix nevű fájlja (alapból Szombathely, a config obsStation mezőjével átírható) */
      const id = String(CFG.obsStation || "15310");
      const all = parseCsv(unzipFirst(await fetchBuf(`${NOW_BASE}HABP_1H_${id}_now.zip`)).text);
      const first = all.find(r => fin(r.lat) && fin(r.lon));
      if (first) {
        const s = { id: first.id || id, name: first.name, lat: first.lat, lon: first.lon, elev: first.elev, distKm: distKm(CFG.lat, CFG.lon, first.lat, first.lon) };
        if (s.distKm <= MAX_KM) { chosen = s; rows = all; via = "állomási „now” fájl"; }
      }
    } catch (e) { errs.push(String((e && e.message) || e)); }
  }
  const ms = Date.now() - t0;
  if (!chosen || !rows) {
    const err = errs.join(" | ").slice(0, 300) || "ismeretlen hiba";
    note("hungaromet", false, ms, err);
    return prev ? { ...prev, error: err } : null;
  }
  const mine = rows.filter(r => r.id === chosen.id || via.startsWith("állomási"));
  const map = new Map();
  if (prev && prev.station && prev.station.id === chosen.id) for (const r of prev.rows || []) map.set(Date.parse(r.h + ":00:00Z"), r);
  for (const r of mine) map.set(r.ms, { h: new Date(r.ms).toISOString().slice(0, 13), t: r.t, p0: r.p0, u: r.u, r: r.r, f: r.f, fx: r.fx });
  const out = [...map.entries()].sort((a, b) => a[0] - b[0]).slice(-KEEP_H).map(e => e[1]);
  const last = out.length ? Date.parse(out[out.length - 1].h + ":00:00Z") : 0;
  const stale = NOW - last > 6 * 36e5;
  note("hungaromet", true, ms, stale ? "az utolsó mérés több mint 6 órás" : undefined);
  return { source: OBS_SOURCE, updated: new Date(NOW).toISOString(), via, stale, station: chosen, rows: out };
}

/* A skórkártya valósága: a mért óránkénti érték a kért időpontra. */
export function obsTruth(obs) {
  const m = new Map(), key = { temp: "t", pres: "p0", hum: "u", wind: "f" };
  for (const r of obs.rows) m.set(Date.parse(r.h + ":00:00Z"), r);
  return async () => (tms, k) => { const r = m.get(tms); if (!r) return undefined; const v = r[key[k]]; return v === null || v === undefined ? undefined : v; };
}
