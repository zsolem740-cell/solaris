/* Solaris-Yantra service worker. Verzió: növeld, ha új index.html-t töltesz fel. */
const V="solaris-v4",SHELL=["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 const u=new URL(e.request.url);
 /* élő adat: mindig a hálózatról, soha nem gyorsítótárból */
 if(/open-meteo|swpc\.noaa|usgs|eonet|opensky|wheretheiss|nominatim|googleapis|anthropic|openai|openrouter/.test(u.hostname))return;
 const lib=/cdnjs|jsdelivr|raw\.githubusercontent/.test(u.hostname);
 if(lib||u.origin===location.origin){
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
