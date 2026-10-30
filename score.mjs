/* Előrejelzés-skórkártya: a háttérfigyelő óránként elmenti, mit jósolt 4 időjárási modell a helyedre
   6, 12 és 24 órára, és 7 nap múlva az ERA5 újraelemzéshez méri (nem állomási mérés, de független a modellektől).
   A pontszám minden modellre, minden előretekintésre és minden változóra (hőmérséklet, légnyomás, felhő) külön gyűlik. */
const fin = Number.isFinite;
export const MODELS = [["ecmwf_ifs025", "ECMWF IFS"], ["gfs_seamless", "NOAA GFS"], ["icon_seamless", "DWD ICON"], ["meteofrance_seamless", "Météo-France"]];
export const LEADS = [6, 12, 24];
const VARS = [["temperature_2m", "temp", 1], ["pressure_msl", "pres", 1], ["cloud_cover", "cloud", 0]];
const rd = (v, d) => fin(v) ? Number(v.toFixed(d)) : null;
const tsOf = r => Date.parse(r.t + ":00:00Z");

export async function recordForecast({ get, CFG, NOW }) {
  const ids = MODELS.map(m => m[0]).join(",");
  const d = await get("om_models", `https://api.open-meteo.com/v1/forecast?latitude=${CFG.lat}&longitude=${CFG.lon}&hourly=temperature_2m,pressure_msl,cloud_cover&models=${ids}&forecast_days=3&timezone=UTC`);
  if (!d || !d.hourly) return null;
  const t0 = Math.floor(NOW / 36e5) * 36e5, idx = new Map(d.hourly.time.map((t, i) => [Date.parse(t + "Z"), i]));
  const m = {};
  for (const [id] of MODELS) {
    const per = {};
    for (const L of LEADS) {
      const i = idx.get(t0 + L * 36e5);
      if (i === undefined) continue;
      const row = VARS.map(([k, , dec]) => rd((d.hourly[k + "_" + id] || [])[i], dec));
      if (row.some(v => v !== null)) per[L] = row;
    }
    if (Object.keys(per).length) m[id] = per;
  }
  return Object.keys(m).length ? { t: new Date(t0).toISOString().slice(0, 13), m } : null;
}

function acc(sc, id, L, key, err) {
  const name = (MODELS.find(x => x[0] === id) || [id, id])[1];
  const m = (sc.models[id] ||= { name, lead: {} });
  const v = ((m.lead[L] ||= {})[key] ||= { n: 0, sumAbs: 0, sumErr: 0 });
  v.n++; v.sumAbs += Math.abs(err); v.sumErr += err;
}

export async function verifyForecasts({ get, CFG, NOW, pending, sc }) {
  const LAG = 7 * 864e5;
  let keep = pending.filter(r => NOW - tsOf(r) < 30 * 864e5);
  const ready = keep.filter(r => tsOf(r) + LAG <= NOW).sort((a, b) => tsOf(a) - tsOf(b)).slice(0, 48);
  if (!ready.length) return { pending: keep, sc, verified: 0 };
  const sd = new Date(tsOf(ready[0])).toISOString().slice(0, 10), ed = new Date(tsOf(ready[ready.length - 1]) + 24 * 36e5).toISOString().slice(0, 10);
  const a = await get("om_era5", `https://archive-api.open-meteo.com/v1/archive?latitude=${CFG.lat}&longitude=${CFG.lon}&start_date=${sd}&end_date=${ed}&hourly=temperature_2m,pressure_msl,cloud_cover&timezone=UTC`, 40000);
  if (!a || !a.hourly) return { pending: keep, sc, verified: 0 };
  const idx = new Map(a.hourly.time.map((t, i) => [Date.parse(t + "Z"), i]));
  const done = [];
  for (const r of ready) {
    let cmp = 0;
    for (const [id, per] of Object.entries(r.m)) {
      for (const [L, row] of Object.entries(per)) {
        const i = idx.get(tsOf(r) + Number(L) * 36e5);
        if (i === undefined) continue;
        VARS.forEach(([k, key], j) => {
          const obs = a.hourly[k][i], pr = row[j];
          if (fin(obs) && pr !== null) { acc(sc, id, L, key, pr - obs); cmp++; }
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
