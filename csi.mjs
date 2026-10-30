/* Az összevont stresszindex (CSI) számítása a GitHub-szerveren.
   A Twin P1–P6 modulok képleteinek Node-ra átírt változata, hogy a P8 tanuló modul akkor is kapjon adatot,
   amikor az oldal zárva van. Ugyanazok a képletek, ugyanazok a súlyok, élő adatok. */
const fin = Number.isFinite;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const r1 = v => Math.round(v * 10) / 10;
const WEIGHTS = { p1: .15, p2: .30, p3: .15, p4: .25, p5: .15 };
const CLIM_YEARS = 11;

const integralOf = d => d.reduce((s, x) => s + Math.max(0, x.tmax - 25) * (1 / ((x.precip || 0) + 1)), 0);
const wbOf = d => d.reduce((s, x) => s + ((x.precip || 0) - (x.et0 || 0)), 0);
const cddOf = d => d.slice(-7).reduce((s, x) => s + Math.max(0, x.tmean - 18), 0);

/* 11 év napi adata (ERA5, Open-Meteo archívum), évente egyszer frissül; a tárolóban a data/clim.json őrzi. */
async function fetchClim(get, CFG, Y) {
  const y0 = Y - CLIM_YEARS;
  const d = await get("om_archive", `https://archive-api.open-meteo.com/v1/archive?latitude=${CFG.lat}&longitude=${CFG.lon}&start_date=${y0}-01-01&end_date=${Y - 1}-12-31&daily=temperature_2m_max,temperature_2m_mean,precipitation_sum,et0_fao_evapotranspiration&timezone=UTC`, 60000);
  if (!d || !d.daily) return null;
  const days = {};
  d.daily.time.forEach((t, i) => {
    const y = Number(t.slice(0, 4)), md = t.slice(5), yi = y - y0;
    if (yi < 0 || yi >= CLIM_YEARS) return;
    const tmax = d.daily.temperature_2m_max[i], tmean = d.daily.temperature_2m_mean[i];
    if (!fin(tmax) || !fin(tmean)) return;
    if (!days[md]) days[md] = Array(CLIM_YEARS).fill(null);
    days[md][yi] = [r1(tmax), r1(tmean), r1(d.daily.precipitation_sum[i] || 0), r1(d.daily.et0_fao_evapotranspiration[i] || 0)];
  });
  return { year: Y, lat: CFG.lat, lon: CFG.lon, days };
}
function windowClim(clim, dates) {
  const out = [];
  for (let yi = 0; yi < CLIM_YEARS; yi++) {
    const w = [];
    for (const ds of dates) {
      let md = ds.slice(5), row = clim.days[md] && clim.days[md][yi];
      if (!row && md === "02-29") row = clim.days["02-28"] && clim.days["02-28"][yi];
      if (row) w.push({ tmax: row[0], tmean: row[1], precip: row[2], et0: row[3] });
    }
    if (w.length >= Math.floor(dates.length * .9)) out.push({ integral: integralOf(w), wb: wbOf(w), cdd7: cddOf(w) });
  }
  return out;
}
async function calcP2(get, CFG, clim) {
  const f = await get("om_daily", `https://api.open-meteo.com/v1/forecast?latitude=${CFG.lat}&longitude=${CFG.lon}&daily=temperature_2m_max,temperature_2m_mean,precipitation_sum,et0_fao_evapotranspiration&past_days=30&forecast_days=1&timezone=auto`);
  if (!f || !f.daily) return null;
  const days = [];
  f.daily.time.slice(0, 30).forEach((t, i) => {
    const tmax = f.daily.temperature_2m_max[i], tmean = f.daily.temperature_2m_mean[i];
    if (fin(tmax) && fin(tmean)) days.push({ date: t, tmax, tmean, precip: f.daily.precipitation_sum[i] || 0, et0: f.daily.et0_fao_evapotranspiration[i] || 0 });
  });
  if (days.length < 20) return null;
  const c = windowClim(clim, days.map(d => d.date));
  if (c.length < 5) return null;
  const integral = integralOf(days), wb = wbOf(days), cdd7 = cddOf(days);
  const iv = c.map(x => x.integral), wv = c.map(x => x.wb), cv = c.map(x => x.cdd7);
  return {
    zScore: clamp((integral - mean(iv)) / Math.max(std(iv), 3), -5, 8),
    zWb: clamp((mean(wv) - wb) / Math.max(std(wv), 5), -5, 8),
    wb, cdd7, cdd7Baseline: mean(cv)
  };
}
function ema(a, period) { if (!a.length) return 0; const k = 2 / (period + 1); let e = a[0]; for (let i = 1; i < a.length; i++) e = a[i] * k + e * (1 - k); return e; }
async function calcP3(get, CFG, NOW) {
  const d = await get("om_pressure", `https://api.open-meteo.com/v1/forecast?latitude=${CFG.lat}&longitude=${CFG.lon}&hourly=pressure_msl&past_days=14&forecast_days=1&timezone=UTC`);
  if (!d || !d.hourly) return null;
  const a = [];
  d.hourly.time.forEach((t, i) => { const ts = Date.parse(t + "Z"), p = d.hourly.pressure_msl[i]; if (ts <= NOW && fin(p)) a.push(p); });
  const buf = a.slice(-336), n = buf.length;
  if (n < 24) return null;
  const e72 = ema(buf, 72), e336 = ema(buf, 336), cur = buf[n - 1], dpdt = (cur - buf[Math.max(0, n - 4)]) / 3;
  const sd = Math.max(std(buf), 2);
  const regime = dpdt < -1.5 ? "CYCLONIC_SPIKE" : (e72 > 1020 && Math.abs(dpdt) < .2 ? "BLOCKING_HIGH" : "NEUTRAL");
  return { zScore: Math.abs(cur - e336) / sd, regime, pressure: cur };
}
async function calcHydro(get, CFG) {
  const d = await get("om_flood", `https://flood-api.open-meteo.com/v1/flood?latitude=${CFG.lat}&longitude=${CFG.lon}&daily=river_discharge&past_days=30&forecast_days=1`);
  const v = ((d && d.daily && d.daily.river_discharge) || []).filter(fin);
  if (v.length < 10) return null;
  const cur = v[v.length - 1], m = mean(v);
  return { ratio: m > 0 ? cur / m : 1 };
}

export async function computeCSI({ get, CFG, NOW, kp, clim }) {
  const Y = new Date(NOW).getUTCFullYear();
  let climUpdated = false;
  if (!clim || clim.year !== Y || Math.abs(clim.lat - CFG.lat) > 1e-6 || Math.abs(clim.lon - CFG.lon) > 1e-6) {
    clim = await fetchClim(get, CFG, Y);
    climUpdated = !!clim;
  }
  const p2 = clim ? await calcP2(get, CFG, clim) : null;
  const p3 = await calcP3(get, CFG, NOW);
  const hy = await calcHydro(get, CFG);
  const zs = {};
  if (kp !== null && kp !== undefined) zs.p1 = kp >= 5 ? kp - 4 : 0;
  if (p2) zs.p2 = Math.max(0, p2.zScore);
  if (p3) zs.p3 = p3.zScore;
  if (p2) {
    const w = p3 ? (p3.regime === "BLOCKING_HIGH" ? 1.25 : p3.regime === "CYCLONIC_SPIKE" ? .7 : 1) : 1;
    zs.p4 = clamp(p2.zScore * w * 20, 0, 100) / 20;
  }
  if (p2 || (kp !== null && kp !== undefined)) {
    const ratio = hy ? hy.ratio : 1, rw = ratio < .4 ? 1.25 : ratio < .7 ? 1.1 : 1;
    const cdd = p2 ? Math.min(4, (p2.cdd7 + 1) / (p2.cdd7Baseline + 1)) : 1;
    const gic = kp !== null && kp !== undefined && kp >= 6 ? (kp - 5) * .4 : 0;
    zs.p5 = cdd * rw + gic;
  }
  if (!("p2" in zs)) return { csi: null, comp: null, clim: climUpdated ? clim : null, climUpdated };
  let num = 0, den = 0;
  for (const k of Object.keys(zs)) { num += zs[k] * WEIGHTS[k]; den += WEIGHTS[k]; }
  const comp = Object.fromEntries(Object.entries(zs).map(([k, v]) => [k, +v.toFixed(3)]));
  return { csi: +(num / den).toFixed(3), comp, clim: climUpdated ? clim : null, climUpdated };
}
