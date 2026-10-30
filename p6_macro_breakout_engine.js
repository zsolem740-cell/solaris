/* P6 · Makro-breakout: az öt pillér összevont stresszindexe (CSI)
   CSI = a rendelkezésre álló pillérek súlyozott átlaga (σ-jellegű értékek).
   Nem tartalmaz árelőrejelzést. A hatás-lánc a mért/számolt értékekből épül. */
(function(){
"use strict";
const CFG={csiThreshold:2.0,weights:{p1:.15,p2:.30,p3:.15,p4:.25,p5:.15}};
const S={p1:null,p2:null,p3:null,p4:null,p5:null};
let last=null,timer=null;

function evaluate(){
 const zs={},chain=[];
 const kp=S.p1&&S.p1.metrics&&S.p1.metrics.kpIndex;
 if(kp!==null&&kp!==undefined)zs.p1=kp>=5?kp-4:0;
 if(S.p2&&S.p2.metrics)zs.p2=Math.max(0,S.p2.metrics.zScore||0);
 if(S.p3&&S.p3.metrics)zs.p3=S.p3.metrics.zScore||0;
 if(S.p4&&S.p4.metrics)zs.p4=(S.p4.metrics.asiIndex||0)/20;
 if(S.p5&&S.p5.metrics)zs.p5=S.p5.metrics.gridStressIndex||0;
 if(!("p2" in zs))return;
 let num=0,den=0;
 for(const k of Object.keys(zs)){num+=zs[k]*CFG.weights[k];den+=CFG.weights[k]}
 const csi=den?num/den:0,isBreakout=csi>=CFG.csiThreshold;
 if(zs.p1>=1)chain.push(`P1: geomágneses aktivitás Kp ${kp}`);
 if(zs.p2>=1.5)chain.push(`P2: aszály-hőstressz Z=${zs.p2.toFixed(2)} a 11 éves helyi átlaghoz képest`);
 if(zs.p3>=1.5)chain.push(`P3: légnyomási anomália Z=${zs.p3.toFixed(2)} (${S.p3.signal.regime})`);
 if(zs.p4>=1.5)chain.push(`P4: agrár-stressz ASI ${S.p4.metrics.asiIndex} (${S.p4.metrics.stressClass})`);
 if(zs.p5>=1.5)chain.push(`P5: hálózati stressz GSI ${S.p5.metrics.gridStressIndex}`);
 const used=Object.keys(zs).map(k=>k.toUpperCase()).join("+");
 const summaryText=isBreakout
  ?`[P6 RIASZTÁS · ${YC.zone.name}] Összevont stresszindex: ${csi.toFixed(2)} σ (küszöb ${CFG.csiThreshold}). A jelzést adó pillérek a láncban láthatók. Források: ${used}.`
  :`[P6 NORMÁL · ${YC.zone.name}] Összevont stresszindex: ${csi.toFixed(2)} σ (küszöb ${CFG.csiThreshold}). Nincs rendszerszintű kiugrás. Források: ${used}.`;
 last={pillar:6,type:isBreakout?"P6_SYSTEM_BREAKOUT":"P6_SYSTEM_IDLE",targetSector:YC.zone.id,combinedStressIndex:+csi.toFixed(2),summaryText,cascadeChain:chain,components:zs};
 YC.send({...last});
}
function later(){clearTimeout(timer);timer=setTimeout(evaluate,300)}
YC.ready(()=>{
 YC.listen(m=>{
  if(m.pillar>=1&&m.pillar<=5){S["p"+m.pillar]=m;later()}
 });
 /* a későn csatlakozó HUD is megkapja az utolsó állapotot */
 setInterval(()=>{if(last)YC.send({...last,timestamp:Date.now()})},20000);
});
})();
