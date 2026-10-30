/* P1 · Geofizika + közös mag (YC) + 3D földgömb
   - YC: a modulok közös magja (adatbusz, CircularBuffer, hálózati és gyorsítótár-segédek, zóna)
   - élő adatok: NOAA SWPC (Kp, napszél, Bz, napkitörés)
   - a P1 üzenet a "solaris_yantra_core" buszra megy: {pillar:1, metrics:{kpIndex, windSpeed, bz, flareClass}} */
(function(){
"use strict";
const BUS="solaris_yantra_core",D=Math.PI/180;

class CircularBuffer{
 constructor(n){this.size=n;this.mem=[]}
 push(v){if(this.mem.length>=this.size)this.mem.shift();this.mem.push(v)}
 clear(){this.mem=[]}
 get array(){return this.mem}
 get length(){return this.mem.length}
}

const tx=new BroadcastChannel(BUS);
const YC=window.YC={
 BUS,CircularBuffer,
 zone:{id:"D25_AGRI_ZONE",name:"Körmend",lat:46.9833,lon:16.6,gps:false},
 send(p){p.timestamp=p.timestamp||Date.now();try{tx.postMessage(p)}catch(e){console.warn("[YC] küldés:",e)}},
 listen(fn){const ch=new BroadcastChannel(BUS);ch.onmessage=e=>{if(e.data&&typeof e.data.pillar==="number")fn(e.data)};return ch},
 async getJSON(url,ms){
  const ac=new AbortController(),t=setTimeout(()=>ac.abort(),ms||12000);
  try{const r=await fetch(url,{signal:ac.signal});if(!r.ok)throw new Error("HTTP "+r.status);return await r.json()}
  finally{clearTimeout(t)}
 },
 every(fn,ms){const run=()=>Promise.resolve().then(fn).catch(e=>console.warn("[YC]",e&&e.message||e));run();return setInterval(run,ms)},
 mean:a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0,
 std(a){if(a.length<2)return 0;const m=this.mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1))},
 clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),
 async cache(key,ttl,fn){
  try{const raw=localStorage.getItem("yc:"+key);if(raw){const o=JSON.parse(raw);if(Date.now()-o.t<ttl)return o.v}}catch(e){}
  const v=await fn();
  try{localStorage.setItem("yc:"+key,JSON.stringify({t:Date.now(),v}))}catch(e){}
  return v;
 },
 ready(fn){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fn);else fn()},
 setZone(lat,lon,name,gps){
  this.zone={id:"D25_AGRI_ZONE",name:name||"Egyedi hely",lat,lon,gps:!!gps};
  this.send({pillar:0,type:"ZONE",zone:this.zone});
 },
 onZone(fn){return this.listen(m=>{if(m.pillar===0&&m.type==="ZONE"){this.zone=m.zone;fn(m.zone)}})}
};

/* --- geofizikai adatok (NOAA SWPC) --- */
const NOAA="https://services.swpc.noaa.gov/";
function toObjs(d){
 if(!Array.isArray(d)||!d.length)return[];
 if(Array.isArray(d[0])){const h=d[0];return d.slice(1).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])))}
 return d;
}
function lastNum(rows,keys){
 for(let i=rows.length-1;i>=0;i--){for(const k of keys){const v=Number(rows[i][k]);if(rows[i][k]!==null&&rows[i][k]!==""&&Number.isFinite(v))return v}}
 return null;
}
function flareClass(d){
 const l=Array.isArray(d)?d.filter(i=>i.energy==="0.1-0.8nm").pop():null,f=l&&Number(l.flux);
 if(!(f>0))return null;
 const k=f>=1e-4?["X",1e-4]:f>=1e-5?["M",1e-5]:f>=1e-6?["C",1e-6]:f>=1e-7?["B",1e-7]:["A",1e-8];
 return k[0]+(f/k[1]).toFixed(1);
}
const GEO={kpIndex:null,windSpeed:null,bz:null,flareClass:null};
async function pollGeo(){
 await Promise.allSettled([
  YC.getJSON(NOAA+"products/noaa-planetary-k-index.json").then(d=>{GEO.kpIndex=lastNum(toObjs(d),["Kp","kp","estimated_kp"])}),
  YC.getJSON(NOAA+"products/solar-wind/plasma-2-hour.json").then(d=>{GEO.windSpeed=lastNum(toObjs(d),["speed"])}),
  YC.getJSON(NOAA+"products/solar-wind/mag-2-hour.json").then(d=>{GEO.bz=lastNum(toObjs(d),["bz_gsm","bz"])}),
  YC.getJSON(NOAA+"json/goes/primary/xrays-6-hour.json").then(d=>{GEO.flareClass=flareClass(d)})
 ]);
 YC.send({pillar:1,type:"P1_GEO_UPDATE",metrics:{...GEO}});
 if(window.__P1_GLOBE)window.__P1_GLOBE.onGeo(GEO);
}

/* --- 3D földgömb (three.js r128) --- */
function ll(lat,lon,r){const f=lat*D,l=lon*D;return new THREE.Vector3(r*Math.cos(f)*Math.sin(l),r*Math.sin(f),r*Math.cos(f)*Math.cos(l))}
function subsolar(d){
 d=d||new Date();
 const N=Math.floor((d-Date.UTC(d.getUTCFullYear(),0,0))/864e5);
 const decl=-23.44*Math.cos(2*Math.PI/365*(N+10));
 const hrs=d.getUTCHours()+d.getUTCMinutes()/60+d.getUTCSeconds()/3600;
 return{lat:decl,lon:((-(hrs-12)*15+540)%360)-180};
}
function ring(poleLat,poleLon,radDeg,seg){
 const f1=poleLat*D,l1=poleLon*D,r=radDeg*D,pts=[];
 for(let i=0;i<=seg;i++){
  const th=i/seg*2*Math.PI;
  const f2=Math.asin(Math.sin(f1)*Math.cos(r)+Math.cos(f1)*Math.sin(r)*Math.cos(th));
  const l2=l1+Math.atan2(Math.sin(th)*Math.sin(r)*Math.cos(f1),Math.cos(r)-Math.sin(f1)*Math.sin(f2));
  pts.push(ll(f2/D,l2/D,1.012));
 }
 return pts;
}
function initGlobe(){
 const el=document.getElementById("globe-container");
 if(!el||!window.THREE){return}
 const scene=new THREE.Scene(),cam=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.1,100);
 cam.position.set(0,0,3.6);
 let ren;try{ren=new THREE.WebGLRenderer({antialias:true,alpha:true})}catch(e){console.warn("[P1] WebGL nem elérhető");return}
 ren.setPixelRatio(Math.min(2,devicePixelRatio||1));ren.setSize(innerWidth,innerHeight);el.appendChild(ren.domElement);
 const grp=new THREE.Group();scene.add(grp);
 const earth=new THREE.Mesh(new THREE.SphereGeometry(1,64,48),new THREE.MeshPhongMaterial({color:0x2a4a6a,shininess:6}));
 earth.rotation.y=-Math.PI/2;grp.add(earth);
 const tl=new THREE.TextureLoader();tl.setCrossOrigin("anonymous");
 tl.load("https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/planets/earth_atmos_2048.jpg",t=>{earth.material.map=t;earth.material.color.set(0xffffff);earth.material.needsUpdate=true});
 grp.add(new THREE.AmbientLight(0x445566,.9));
 const sun=new THREE.DirectionalLight(0xffffff,1.1);grp.add(sun);
 const mark=new THREE.Mesh(new THREE.SphereGeometry(.018,12,12),new THREE.MeshBasicMaterial({color:0xd4af37}));grp.add(mark);
 const halo=new THREE.Mesh(new THREE.SphereGeometry(1.06,48,32),new THREE.MeshBasicMaterial({color:0x4466aa,transparent:true,opacity:.07,side:THREE.BackSide,depthWrite:false}));grp.add(halo);
 const rings=[0,1].map(()=>{const l=new THREE.LineLoop(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x34d399,transparent:true,opacity:.85}));l.frustumCulled=false;grp.add(l);return l});
 let spin=true,targetY=-YC.zone.lon*D,dragging=false,lx=0;
 grp.rotation.y=targetY;
 function placeMarker(){mark.position.copy(ll(YC.zone.lat,YC.zone.lon,1.012));targetY=-YC.zone.lon*D}
 function sunUpdate(){const s=subsolar();sun.position.copy(ll(s.lat,s.lon,5))}
 function auroraUpdate(kp){
  const k=kp===null||kp===undefined?2:kp;
  /* közelítés: az aurórazóna határa kb. 66,5° − 2°·Kp geomágneses szélességen; a geomágneses pólus kb. (80,7°É, 72,7°NY) */
  const b=YC.clamp(66.5-2*k,40,70),rad=90-b;
  rings[0].geometry.setFromPoints(ring(80.65,-72.68,rad,96));
  rings[1].geometry.setFromPoints(ring(-80.65,107.32,rad,96));
  const c=new THREE.Color().setHSL(YC.clamp(.38-k/9*.38,0,.38),.9,.55);
  rings.forEach(r=>r.material.color.copy(c));
 }
 placeMarker();sunUpdate();auroraUpdate(null);
 setInterval(sunUpdate,60000);
 const cv=ren.domElement;
 cv.addEventListener("pointerdown",e=>{dragging=true;spin=false;lx=e.clientX});
 addEventListener("pointerup",()=>{dragging=false;setTimeout(()=>{if(!dragging)spin=true},4000)});
 addEventListener("pointermove",e=>{if(dragging){grp.rotation.y+=(e.clientX-lx)*.006;lx=e.clientX}});
 addEventListener("resize",()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();ren.setSize(innerWidth,innerHeight)});
 YC.onZone(()=>placeMarker());
 (function loop(){
  requestAnimationFrame(loop);if(document.hidden)return;
  if(spin)grp.rotation.y+=.0012;
  ren.render(scene,cam);
 })();
 window.__P1_GLOBE={onGeo:g=>auroraUpdate(g.kpIndex)};
}

YC.ready(()=>{
 initGlobe();
 /* GPS csak biztonságos (https) címen; különben marad Körmend */
 if(navigator.geolocation&&window.isSecureContext){
  navigator.geolocation.getCurrentPosition(p=>YC.setZone(p.coords.latitude,p.coords.longitude,"GPS-pozíciód",true),()=>{},{timeout:12000,maximumAge:6e5});
 }
 YC.every(pollGeo,60000);
});
})();
