/* P8 · Önkalibráló előrejelző (tanuló modul)
   Mit tanul: azt, hogy a P1–P5 pillér mostani értékeiből melyik súlykombináció jelzi a legjobban az ÖSSZEVONT STRESSZINDEX (P6 CSI) 24 órával későbbi, MÉRT értékét.
   Az igazság forrása maga a rendszer: a 24 órával későbbi pillanatfelvétel a P6 rögzített referencia-súlyaival számolt CSI-je.
   A P6 jelentett indexét ez NEM változtatja meg; a P8 külön 24 órás előrejelzést ad, és kiírja, jobb-e a naiv "holnap ugyanannyi" (perzisztencia) becslésnél.
   Tárolás: IndexedDB (pillanatfelvételek), localStorage (súlyok, statisztika). Csak akkor gyűjt, amikor az oldal nyitva van. */
(function(){
"use strict";
const CFG={db:"SolarisYantraDB",store:"snapshots",horizonH:24,tolH:3,saveEveryMin:10,eta:.15,minW:.05,maxW:.5,maxPerRun:300,keepDays:30,emaAlpha:.05,minPairs:10};
const KEYS=["p1","p2","p3","p4","p5"],REF={p1:.15,p2:.30,p3:.15,p4:.25,p5:.15};
const lsGet=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
let W=lsGet("yc8:weights",null);
if(!W||KEYS.some(k=>!(k in W)))W={...REF};
let ST=lsGet("yc8:stats",{n:0,collected:0,srv:0,maeL:null,maeP:null});
let store=null,busy=false,lastSave=0,lastPub=0,latest=null;

/* --- tároló (IndexedDB) --- */
function idbStore(){
 return new Promise((res,rej)=>{
  if(!window.indexedDB)return rej(new Error("nincs IndexedDB"));
  const rq=indexedDB.open(CFG.db,1);
  rq.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains(CFG.store))db.createObjectStore(CFG.store,{keyPath:"id",autoIncrement:true})};
  rq.onerror=()=>rej(rq.error);
  rq.onsuccess=()=>{
   const db=rq.result;
   const tx=(mode,fn)=>new Promise((r,j)=>{const t=db.transaction([CFG.store],mode),q=fn(t.objectStore(CFG.store));t.oncomplete=()=>r(q&&q.result);t.onerror=()=>j(t.error);t.onabort=()=>j(t.error)});
   res({add:o=>tx("readwrite",s=>s.add(o)),put:o=>tx("readwrite",s=>s.put(o)),getAll:()=>tx("readonly",s=>s.getAll()),del:id=>tx("readwrite",s=>s.delete(id))});
  };
 });
}

/* --- segédek --- */
function fullComp(c){const o={};KEYS.forEach(k=>{const v=Number(c&&c[k]);o[k]=Number.isFinite(v)?v:0});return o}
function nearest(ts,x){let lo=0,hi=ts.length-1;while(lo<hi){const m=(lo+hi)>>1;if(ts[m]<x)lo=m+1;else hi=m}return lo>0&&Math.abs(ts[lo-1]-x)<=Math.abs(ts[lo]-x)?lo-1:lo}
function ema(prev,x){const a=Math.max(CFG.emaAlpha,1/(ST.n+1));return prev===null?x:prev+(x-prev)*a}
function project(){
 for(let it=0;it<30;it++){
  KEYS.forEach(k=>{W[k]=Math.min(CFG.maxW,Math.max(CFG.minW,W[k]))});
  const s=KEYS.reduce((a,k)=>a+W[k],0);
  if(Math.abs(s-1)<1e-9)break;
  KEYS.forEach(k=>{W[k]/=s});
 }
 KEYS.forEach(k=>{W[k]=Number(W[k].toFixed(4))});
}
function predict(comp){const z=fullComp(comp);return KEYS.reduce((a,k)=>a+W[k]*z[k],0)}

/* --- egy tanulási lépés: normált LMS (a gradiens az egyes pillérek z-értékével arányos) --- */
function learnOne(s,y){
 const z=KEYS.map(k=>s.comp[k]||0),yhat=KEYS.reduce((a,k,i)=>a+W[k]*z[i],0),err=yhat-y,norm=1+z.reduce((a,x)=>a+x*x,0);
 ST.maeL=ema(ST.maeL,Math.abs(err));ST.maeP=ema(ST.maeP,Math.abs(s.csi-y));ST.n++;
 KEYS.forEach((k,i)=>{W[k]-=CFG.eta*err*z[i]/norm});
 project();
}

/* --- ellenőrzés: a 24 órával későbbi pillanatfelvétel a cél --- */
async function verify(){
 if(busy||!store)return;busy=true;
 try{
  const all=(await store.getAll()).sort((a,b)=>a.t-b.t);
  const H=CFG.horizonH*36e5,tol=CFG.tolH*36e5,now=Date.now(),ts=all.map(r=>r.t);
  let done=0;
  for(const s of all){
   if(s.used||s.t+H>now)continue;
   const q=all[nearest(ts,s.t+H)];
   if(q&&q!==s&&Math.abs(q.t-(s.t+H))<=tol){learnOne(s,q.csi);s.used=true;await store.put(s);done++}
   else if(s.t+H+tol<now){s.used=true;s.skipped=true;await store.put(s)}
   if(done>=CFG.maxPerRun)break;
  }
  const cut=now-CFG.keepDays*864e5;
  for(const r of all)if(r.t<cut&&r.used)await store.del(r.id);
  if(done){lsSet("yc8:weights",W);lsSet("yc8:stats",ST);publish(true)}
 }catch(e){console.warn("[P8]",e&&e.message||e)}
 busy=false;
}

/* --- üzenetek --- */
function publish(force){
 const now=Date.now();if(!force&&now-lastPub<6e4)return;lastPub=now;
 if(!latest)return;
 const skill=ST.n>=CFG.minPairs&&ST.maeP>0?1-ST.maeL/ST.maeP:null;
 YC.send({pillar:8,type:"P8_FORECAST",forecast24h:+predict(latest).toFixed(3),weights:{...W},stats:{n:ST.n,collected:ST.collected,srv:ST.srv||0,maeL:ST.maeL===null?null:+ST.maeL.toFixed(3),maeP:ST.maeP===null?null:+ST.maeP.toFixed(3),skill:skill===null?null:+skill.toFixed(3)}});
}
async function ingest(m){
 if(!m||!m.components)return;
 latest=m.components;
 const now=Date.now();
 if(store&&now-lastSave>=CFG.saveEveryMin*6e4){
  lastSave=now;
  try{await store.add({t:now,csi:Number(m.combinedStressIndex)||0,comp:fullComp(m.components),used:false});ST.collected++;lsSet("yc8:stats",ST)}catch(e){console.warn("[P8]",e&&e.message||e)}
 }
 publish(false);
}

/* A GitHub háttérfigyelő óránként elmenti a CSI-t és a pillér-értékeket (data/history.json).
   Ezeket betöltjük, így a tanulás akkor is halad, amikor az oldal zárva volt. */
async function pullServerHistory(){
 if(!store)return 0;
 try{
  const r=await fetch("data/history.json?t="+Date.now(),{cache:"no-store"});
  if(!r.ok)return 0;
  const rows=await r.json();
  let last=lsGet("yc8:srvLast",0),n=0;
  for(const h of rows){
   const t=Date.parse(h.t);
   if(!Number.isFinite(t)||t<=last||!h.comp||typeof h.csi!=="number")continue;
   await store.add({t,csi:h.csi,comp:fullComp(h.comp),used:false,src:"server"});
   last=t;n++;
  }
  if(n){ST.srv=(ST.srv||0)+n;lsSet("yc8:srvLast",last);lsSet("yc8:stats",ST)}
  return n;
 }catch(e){return 0}
}
window.yantraLearning={
 ingest,verify,pullServerHistory,
 state:()=>({weights:{...W},stats:{...ST}}),
 reset(){W={...REF};ST={n:0,collected:0,srv:0,maeL:null,maeP:null};lsSet("yc8:weights",W);lsSet("yc8:stats",ST);lsSet("yc8:srvLast",0)}
};

YC.ready(async()=>{
 try{store=window.__P8_STORE||await idbStore()}catch(e){console.warn("[P8] tároló nem elérhető:",e&&e.message||e)}
 YC.listen(m=>{if(m.pillar===6)ingest(m)});
 await pullServerHistory();
 setTimeout(verify,3000);setInterval(verify,10*60*1000);
 setInterval(()=>pullServerHistory().then(verify),30*60*1000);
});
})();
