/* P2 · Szektorális mikroklíma és aszály-/hőstressz (D25 zóna)
   Valós adatok: Open-Meteo előrejelző API (az utolsó 30 nap) + Open-Meteo archívum (11 év, ERA5).
   A Z-pontszám a SAJÁT helyi klimatológiához mér: ugyanazon naptári ablak az előző 11 évben. */
(function(){
"use strict";
const CFG={zThreshold:2.5,windowDays:30,climYears:11,heatBase:25,cddBase:18};
const buf=new YC.CircularBuffer(CFG.windowDays);
const fin=v=>Number.isFinite(v);
const integralOf=days=>days.reduce((s,d)=>s+Math.max(0,d.tmax-CFG.heatBase)*(1/((d.precip||0)+1)),0);
const wbOf=days=>days.reduce((s,d)=>s+((d.precip||0)-(d.et0||0)),0);
const cddOf=days=>days.slice(-7).reduce((s,d)=>s+Math.max(0,d.tmean-CFG.cddBase),0);

async function loadClimatology(z,dates){
 const Y=new Date().getUTCFullYear(),y0=Y-CFG.climYears;
 const key=`clim:${z.lat.toFixed(1)},${z.lon.toFixed(1)}:${dates[0].slice(5)}:${Y}`;
 return YC.cache(key,7*864e5,async()=>{
  const d=await YC.getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${z.lat}&longitude=${z.lon}&start_date=${y0}-01-01&end_date=${Y-1}-12-31&daily=temperature_2m_max,temperature_2m_mean,precipitation_sum,et0_fao_evapotranspiration&timezone=UTC`,40000);
  const idx=new Map(d.daily.time.map((t,i)=>[t,i])),out=[];
  for(let y=y0;y<=Y-1;y++){
   const days=[];
   for(const ds of dates){
    let s=y+ds.slice(4);if(!idx.has(s)&&ds.slice(5)==="02-29")s=y+"-02-28";
    const i=idx.get(s);if(i===undefined)continue;
    const tmax=d.daily.temperature_2m_max[i],tmean=d.daily.temperature_2m_mean[i];
    if(!fin(tmax)||!fin(tmean))continue;
    days.push({tmax,tmean,precip:d.daily.precipitation_sum[i]||0,et0:d.daily.et0_fao_evapotranspiration[i]||0});
   }
   if(days.length>=Math.floor(dates.length*.9))out.push({y,integral:integralOf(days),wb:wbOf(days),cdd7:cddOf(days)});
  }
  return out;
 });
}

async function run(){
 const z=YC.zone;
 const f=await YC.getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${z.lat}&longitude=${z.lon}&daily=temperature_2m_max,temperature_2m_mean,precipitation_sum,et0_fao_evapotranspiration&hourly=soil_temperature_6cm&past_days=${CFG.windowDays}&forecast_days=1&timezone=auto`);
 const dt=f.daily.time.slice(0,CFG.windowDays),days=[];
 dt.forEach((t,i)=>{
  const tmax=f.daily.temperature_2m_max[i],tmean=f.daily.temperature_2m_mean[i];
  if(fin(tmax)&&fin(tmean))days.push({date:t,tmax,tmean,precip:f.daily.precipitation_sum[i]||0,et0:f.daily.et0_fao_evapotranspiration[i]||0});
 });
 if(days.length<20)return emitInertial("kevés napi adat");
 buf.clear();days.forEach(d=>buf.push(d));
 const win=buf.array;
 const soil=(f.hourly.soil_temperature_6cm||[]).slice(0,CFG.windowDays*24).filter(fin);
 const droughtIntegral=integralOf(win),wb=wbOf(win),cdd7=cddOf(win);
 let clim=null;
 try{clim=await loadClimatology(z,win.map(d=>d.date))}catch(e){return emitInertial("klimatológia nem elérhető: "+e.message)}
 if(!clim||clim.length<5)return emitInertial("kevés klimatológiai év");
 const iv=clim.map(c=>c.integral),wv=clim.map(c=>c.wb),cv=clim.map(c=>c.cdd7);
 /* szórás-padló: hideg évszakban a klimatológiai szórás ~0, ez nélküle értelmetlen Z-t adna */
 const zScore=YC.clamp((droughtIntegral-YC.mean(iv))/Math.max(YC.std(iv),3),-5,8);
 const zWb=YC.clamp((YC.mean(wv)-wb)/Math.max(YC.std(wv),5),-5,8);
 const isBreakout=zScore>=CFG.zThreshold;
 YC.send({
  pillar:2,type:isBreakout?"P2_SECTOR_BREAKOUT":"P2_SECTOR_IDLE",sector:z.id,
  metrics:{
   droughtIntegral:+droughtIntegral.toFixed(2),zScore:+zScore.toFixed(2),zWaterBalance:+zWb.toFixed(2),
   waterBalanceMm:+wb.toFixed(1),precip30:+win.reduce((s,d)=>s+d.precip,0).toFixed(1),
   heatDays30:win.filter(d=>d.tmax>=30).length,soilTemp6cmMean:soil.length?+YC.mean(soil).toFixed(1):null,
   cdd7:+cdd7.toFixed(1),cdd7Baseline:+YC.mean(cv).toFixed(1),climYears:clim.length
  },
  marketContext:null,
  prediction:{isBreakout}
 });
}
function emitInertial(why){YC.send({pillar:2,type:"P2_SECTOR_INERTIAL",sector:YC.zone.id,reason:why})}

YC.ready(()=>{
 YC.every(run,30*60*1000);
 YC.onZone(()=>run().catch(()=>{}));
});
})();
