/* P3 · Prediktív trend: EMA-k és légnyomás-tendencia
   Valós adat: Open-Meteo óránkénti tengerszinti légnyomás (14 nap). A szórás a mintából számolódik. */
(function(){
"use strict";
const CFG={emaPeriods:{fast:24,medium:72,slow:336},derivativeThreshold:-1.5,zBreakoutThreshold:2.5};
const buf=new YC.CircularBuffer(336);

function ema(a,period){
 if(!a.length)return 0;
 const k=2/(period+1);let e=a[0];
 for(let i=1;i<a.length;i++)e=a[i]*k+e*(1-k);
 return e;
}
async function run(){
 const z=YC.zone;
 const d=await YC.getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${z.lat}&longitude=${z.lon}&hourly=pressure_msl&past_days=14&forecast_days=1&timezone=UTC`);
 const t=d.hourly.time,p=d.hourly.pressure_msl,now=Date.now();
 buf.clear();
 for(let i=0;i<t.length;i++){const ts=Date.parse(t[i]+"Z");if(ts<=now&&Number.isFinite(p[i]))buf.push(p[i])}
 evaluate();
}
function evaluate(){
 const a=buf.array,n=a.length;
 if(n<24)return YC.send({pillar:3,type:"P3_TREND_INERTIAL",sector:YC.zone.id,reason:"kevés óradat"});
 const e24=ema(a,CFG.emaPeriods.fast),e72=ema(a,CFG.emaPeriods.medium),e336=ema(a,CFG.emaPeriods.slow);
 const cur=a[n-1],p3=a[Math.max(0,n-4)],dpdt=(cur-p3)/3;
 const sd=Math.max(YC.std(a),2),z=Math.abs(cur-e336)/sd;
 let regime="NEUTRAL";
 if(dpdt<CFG.derivativeThreshold)regime="CYCLONIC_SPIKE";
 else if(e72>1020&&Math.abs(dpdt)<.2)regime="BLOCKING_HIGH";
 const isBreakout=z>=CFG.zBreakoutThreshold&&regime==="BLOCKING_HIGH";
 YC.send({
  pillar:3,type:isBreakout?"P3_TREND_BREAKOUT":"P3_TREND_UPDATE",sector:YC.zone.id,
  metrics:{currentPressure:+cur.toFixed(1),ema24h:+e24.toFixed(1),ema72h:+e72.toFixed(1),ema14d:+e336.toFixed(1),pressureDerivative:+dpdt.toFixed(2),pressureStd:+sd.toFixed(2),zScore:+z.toFixed(2)},
  signal:{regime,isBreakout,confidence:Math.min(100,Math.round(n/336*100))}
 });
}
YC.ready(()=>{
 YC.every(run,15*60*1000);
 YC.onZone(()=>run().catch(()=>{}));
});
})();
