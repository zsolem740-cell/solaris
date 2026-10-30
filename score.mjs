/* Előrejelzés-skórkártya két „valósággal": az ERA5 újraelemzéssel (7 nap késéssel, a Körmendi pontra) és a HungaroMet
   mért állomási adataival (kb. 1 nap késéssel, a legközelebbi állomás pontjára). Óránként elmenti, mit jósolt 4 modell
   6, 12 és 24 órára, később a valósághoz méri. A modellek hibáiból torzításmentesített, pontosság-súlyozott
   „javított előrejelzés" készül, amely saját pontszámot is kap. */
const fin = Number.isFinite;
export const MODELS = [["ecmwf_ifs025", "ECMWF IFS"], ["gfs_seamless", "NOAA GFS"], ["icon_seamless", "DWD ICON"], ["meteofrance_seamless", "Météo-France"]];
export const LEADS = [6, 12, 24];
export const NAMES = Object.fromEntries([...MODELS, ["mean", "Egyszerű átlag"], ["blend", "Javított (súlyozott)"]]);
const N_MIN = 96;   /* legalább ~4 nap óránkénti kiértékelt jóslat, hogy ne egyetlen időjárási helyzethez igazodjon a súly */
export const TRACKS = {
  era5: { vars: [["temperature_2m", "temp", 1], ["pressure_msl", "pres", 1], ["cloud_cover", "cloud", 0]], extra: "" },
  obs: { vars: [["temperature_2m", "temp", 1], ["pressure_msl", "pres", 1], ["relative_humidity_2m", "hum", 0], ["wind_speed_10m", "wind", 1]], extra: "&wind_speed_unit=ms" }
};
const rd = (v, d) => fin(v) ? Number(v.toFixed(d)) : null;
const tsOf = r => Date.parse(r.t + ":00:00Z");
const bucket = h => h <= 9 ? 6 : h <= 18 ? 12 : 24;

function acc(sc, id, L, key, err) {
  const name = NAMES[id] || id;
  const m = (sc.models[id] ||= { name, lead: {} });
  const v = ((m.lead[L] ||= {})[key] ||= { n: 0, sumAbs: 0, sumErr: 0, sumSq: 0 });
  v.n++; v.sumAbs += Math.abs(err); v.sumErr += err; v.sumSq += err * err;
}

/* A skórkártyákból (scs = [{id, sc}], a megbízhatóbb elöl) kiolvassa egy modell torzítását és négyzetes hibáját. */
function stat(scs, id, L, key) {
  for (const s of scs || []) {
    const v = s.sc && s.sc.models && s.sc.models[id] && s.sc.models[id].lead && s.sc.models[id].lead[L] && s.sc.models[id].lead[L][key];
    if (v && v.n >= N_MIN) return { bias: v.sumErr / v.n, mse: v.sumSq !== undefined ? v.sumSq / v.n : (v.sumAbs / v.n) ** 2, src: s.id };
  }
  return null;
}
export function blendAt(vals, scs, h, key) {
  const L = bucket(h), ids = Object.keys(vals).filter(id => fin(vals[id]));
  if (!ids.length) return null;
  const st = ids.map(id => stat(scs, id, L, key));
  const cal = st.every(x => x);
  let num = 0, den = 0;
  ids.forEach((id, i) => {
    const w = cal ? 1 / Math.max(st[i].mse, 1e-3) : 1;
    num += w * (vals[id] - (cal ? st[i].bias : 0)); den += w;
  });
  let v = num / den;
  if (key === "cloud") v = Math.max(0, Math.min(100, v));
  const all = ids.map(id => vals[id]);
  return { v, cal, src: cal ? [...new Set(st.map(x => x.src))] : [], raw: all.reduce((a, b) => a + b, 0) / all.length, spread: Math.max(...all) - Math.min(...all) };
}

export async function recordForecast({ get, CFG, NOW, scs = [], track = TRACKS.era5, lat, lon, tag }) {
  const ids = MODELS.map(m => m[0]).join(",");
  const vars = track.vars;
  const d = await get("om_models" + (tag ? "_" + tag : ""), `https://api.open-meteo.com/v1/forecast?latitude=${lat ?? CFG.lat}&longitude=${lon ?? CFG.lon}&hourly=${vars.map(v => v[0]).join(",")}&models=${ids}&forecast_days=3&timezone=UTC${track.extra}`);
  if (!d || !d.hourly) return null;
  const t0 = Math.floor(NOW / 36e5) * 36e5, idx = new Map(d.hourly.time.map((t, i) => [Date.parse(t + "Z"), i]));
  const m = {};
  for (const [id] of MODELS) {
    const per = {};
    for (const L of LEADS) {
      const i = idx.get(t0 + L * 36e5);
      if (i === undefined) continue;
      const row = vars.map(([k, , dec]) => rd((d.hourly[k + "_" + id] || [])[i], dec));
      if (row.some(v => v !== null)) per[L] = row;
    }
    if (Object.keys(per).length) m[id] = per;
  }
  if (!Object.keys(m).length) return null;
  const hours = [], blendPer = {}, meanPer = {}, srcs = {}, uncal = new Set();
  let calLead = true;
  for (let h = 1; h <= 24; h++) {
    const i = idx.get(t0 + h * 36e5);
    if (i === undefined) continue;
    const row = { h, t: new Date(t0 + h * 36e5).toISOString().slice(0, 13) };
    vars.forEach(([k, key, dec]) => {
      const vals = {};
      for (const [id] of MODELS) vals[id] = (d.hourly[k + "_" + id] || [])[i];
      const r = blendAt(vals, scs, h, key);
      if (r) {
        row[key] = rd(r.v, dec); row[key + "Sp"] = rd(r.spread, dec); row[key + "Raw"] = rd(r.raw, dec);
        if (!r.cal) { uncal.add(key); if (LEADS.includes(h)) calLead = false; } else (srcs[key] ||= new Set()), r.src.forEach(s => srcs[key].add(s));
      }
    });
    hours.push(row);
    if (LEADS.includes(h)) { blendPer[h] = vars.map(([, key]) => row[key] ?? null); meanPer[h] = vars.map(([, key]) => row[key + "Raw"] ?? null); }
  }
  if (Object.keys(blendPer).length) { m.blend = blendPer; m.mean = meanPer; }
  const calSrc = {};
  vars.forEach(([, key]) => { calSrc[key] = uncal.has(key) || !srcs[key] ? null : [...srcs[key]].join("+"); });
  return {
    rec: { t: new Date(t0).toISOString().slice(0, 13), m, cal: calLead, ...(tag ? { st: tag } : {}) },
    blend: { issued: new Date(t0).toISOString().slice(0, 13) + ":00Z", calibrated: !uncal.size, calSrc, verifiedRuns: Math.max(0, ...scs.map(s => (s.sc && s.sc.verified) || 0)), hours }
  };
}

/* A valóság az ERA5 újraelemzés (Open-Meteo archívum): egy kérés az érintett napokra. */
export function eraTruth(get, CFG) {
  return async (ready) => {
    const sd = new Date(tsOf(ready[0])).toISOString().slice(0, 10), ed = new Date(tsOf(ready[ready.length - 1]) + 24 * 36e5).toISOString().slice(0, 10);
    const a = await get("om_era5", `https://archive-api.open-meteo.com/v1/archive?latitude=${CFG.lat}&longitude=${CFG.lon}&start_date=${sd}&end_date=${ed}&hourly=temperature_2m,pressure_msl,cloud_cover&timezone=UTC`, 40000);
    if (!a || !a.hourly) return null;
    const idx = new Map(a.hourly.time.map((t, i) => [Date.parse(t + "Z"), i])), name = { temp: "temperature_2m", pres: "pressure_msl", cloud: "cloud_cover" };
    return (tms, key) => { const i = idx.get(tms); return i === undefined || !name[key] ? undefined : a.hourly[name[key]][i]; };
  };
}

export async function verifyForecasts({ get, CFG, NOW, pending, sc, track = TRACKS.era5, truth, lagMs = 7 * 864e5, maxAgeMs = 30 * 864e5, tag }) {
  let keep = pending.filter(r => NOW - tsOf(r) < maxAgeMs && (tag === undefined || r.st === tag));
  const ready = keep.filter(r => tsOf(r) + lagMs <= NOW).sort((a, b) => tsOf(a) - tsOf(b)).slice(0, 48);
  if (!ready.length) return { pending: keep, sc, verified: 0 };
  const T = await (truth || eraTruth(get, CFG))(ready);
  if (!T) return { pending: keep, sc, verified: 0 };
  const done = [];
  for (const r of ready) {
    let cmp = 0;
    for (const [id, per] of Object.entries(r.m)) {
      if (id === "blend" && r.cal === false) continue;   /* a még nem kalibrált időszak nem számít a javított előrejelzés pontszámába */
      for (const [L, row] of Object.entries(per)) {
        track.vars.forEach(([, key], j) => {
          const obs = T(tsOf(r) + Number(L) * 36e5, key), pr = row[j];
          if (fin(obs) && pr !== null && pr !== undefined) { acc(sc, id, L, key, pr - obs); cmp++; }
        });
      }
    }
    if (cmp > 0) done.push(r);
  }
  keep = keep.filter(r => !done.includes(r));
  sc.verified = (sc.verified || 0) + done.length;
  if (done.length && !sc.since) sc.since = done[0].t;
  sc.updated = new Date(NOW).toISOString();
  return { pending: keep, sc, verified: done.length };
}
