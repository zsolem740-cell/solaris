/* P5 · Energetika, hidrológia és GIC-kockázat
   Valós adatok: Open-Meteo árvíz/vízhozam API (GloFAS modell, nem mérőállomás), a P2 hűtési fokosnapjai (CDD) és a P1 Kp-indexe.
   A folyóhőmérséklet-adat kulcs nélkül nem elérhető, ezért nem szerepel (régebben fix érték volt). */
(function(){
"use strict";
const CFG={gsiThreshold:2.5};
const S={p1:null,p2:null,hydro:null};
let timer=null;
async function loadHydro(){
 const z=YC.zone;
 const d=await YC.getJSON(`https://flood-api.open-meteo.com/v1/flood?latitude=${z.lat}&longitude=${z.lon}&daily=river_discharge&past_days=30&forecast_days=1`);
 const v=(d.daily&&d.daily.river_discharge||[]).filter(Number.isFinite);
 if(v.length<10){S.hydro=null;return}
 const cur=v[v.length-1],mean=YC.mean(v);
 S.hydro={current:cur,mean,ratio:mean>0?cur/mean:1};
}
function evaluate(){
 const m2=S.p2&&S.p2.metrics,kp=S.p1&&S.p1.metrics&&S.p1.metrics.kpIndex;
 const ratio=S.hydro?S.hydro.ratio:1;
 const riverWeight=ratio<.4?1.25:ratio<.7?1.1:1.0;
 const cddRatio=m2?Math.min(4,(m2.cdd7+1)/(m2.cdd7Baseline+1)):1;
 const gic=kp!==null&&kp!==undefined&&kp>=6?(kp-5)*.4:0;
 const gsi=cddRatio*riverWeight+gic,isBreakout=gsi>=CFG.gsiThreshold;
 YC.send({
  pillar:5,type:isBreakout?"P5_ENERGY_BREAKOUT":"P5_ENERGY_NORMAL",sector:YC.zone.id,
  metrics:{gridStressIndex:+gsi.toFixed(2),cddRatio:+cddRatio.toFixed(2),riverFlowRatio:S.hydro?+ratio.toFixed(2):null,gicRisk:+gic.toFixed(2),kpIndex:kp??null},
  marketImpact:{isBreakout}
 });
}
function later(){clearTimeout(timer);timer=setTimeout(evaluate,400)}
YC.ready(()=>{
 YC.listen(m=>{
  if(m.pillar===1&&m.metrics){S.p1=m;later()}
  if(m.pillar===2&&m.metrics){S.p2=m;later()}
 });
 YC.every(async()=>{await loadHydro();later()},30*60*1000);
 YC.onZone(()=>loadHydro().then(later).catch(()=>{}));
});
})();
