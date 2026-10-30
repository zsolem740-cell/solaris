/* Solaris-Yantra service worker v6: a saját fájlok HÁLÓZAT-ELŐSZÖR (mindig a legfrissebb), hálózat nélkül a mentett példány. */
const V="solaris-v6",SHELL=["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
function networkFirst(req){
 return new Promise(res=>{
  let done=false;
  const t=setTimeout(()=>{caches.match(req).then(h=>{if(h&&!done){done=true;res(h)}})},4000);
  fetch(req).then(r=>{
   if(r&&r.ok){const cp=r.clone();caches.open(V).then(c=>c.put(req,cp))}
   if(!done){done=true;clearTimeout(t);res(r)}
  }).catch(()=>caches.match(req).then(h=>{if(!done){done=true;clearTimeout(t);res(h||Response.error())}}));
 });
}
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 const u=new URL(e.request.url);
 /* élő adat: mindig a hálózatról, soha nem gyorsítótárból */
 if(/open-meteo|swpc\.noaa|usgs|eonet|opensky|wheretheiss|nominatim|googleapis|anthropic|openai|openrouter|coastwatch|gfz-potsdam|seismicportal|api\.met\.no|adsb\.lol|sosrff|weserv|windy|google\.com/.test(u.hostname))return;
 if(u.origin===location.origin){e.respondWith(networkFirst(e.request));return}
 if(/cdnjs|jsdelivr|raw\.githubusercontent/.test(u.hostname)){
  e.respondWith(caches.match(e.request).then(hit=>{
   const net=fetch(e.request).then(r=>{if(r&&(r.ok||r.type==="opaque")){const cp=r.clone();caches.open(V).then(c=>c.put(e.request,cp))}return r}).catch(()=>hit);
   return hit||net;
  }));
 }
});
self.addEventListener("notificationclick",e=>{
 e.notification.close();
 e.waitUntil(clients.matchAll({type:"window"}).then(l=>l[0]?l[0].focus():clients.openWindow("./")));
});
