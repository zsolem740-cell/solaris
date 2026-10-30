/* P4 · Agrár-stressz motor
   Bemenet: P2 (aszály-hőstressz Z-pontszám, vízmérleg) és P3 (légnyomási rezsim).
   Kimenet: ASI (0–100) és minőségi stressz-osztály. Terméscsökkenést vagy árváltozást NEM becsül:
   ehhez nincs élő, kulcs nélküli adatforrás, és a régi fix együtthatók nem voltak alátámasztva. */
(function(){
"use strict";
const CFG={asiScale:20,asiThreshold:50};
const S={p2:null,p3:null};
function stressClass(a){return a<20?"nincs jelentős":a<40?"enyhe":a<60?"mérsékelt":"súlyos"}
function evaluate(){
 if(!S.p2||!S.p2.metrics)return;
 const z2=S.p2.metrics.zScore||0;
 let w=1;
 const reg=S.p3&&S.p3.signal&&S.p3.signal.regime;
 if(reg==="BLOCKING_HIGH")w=1.25;else if(reg==="CYCLONIC_SPIKE")w=.7;
 const zEff=z2*w,asi=YC.clamp(zEff*CFG.asiScale,0,100),isBreakout=asi>=CFG.asiThreshold;
 YC.send({
  pillar:4,type:isBreakout?"P4_AGRI_BREAKOUT":"P4_AGRI_NORMAL",sector:YC.zone.id,
  metrics:{asiIndex:+asi.toFixed(1),zEff:+zEff.toFixed(2),regimeWeight:w,stressClass:stressClass(asi),waterBalanceMm:S.p2.metrics.waterBalanceMm,zWaterBalance:S.p2.metrics.zWaterBalance,heatDays30:S.p2.metrics.heatDays30},
  marketImpact:{isBreakout}
 });
}
YC.ready(()=>{
 YC.listen(m=>{
  if(m.pillar===2&&m.metrics){S.p2=m;evaluate()}
  if(m.pillar===3&&m.signal){S.p3=m;evaluate()}
 });
});
})();
