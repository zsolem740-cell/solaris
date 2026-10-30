/* P7 · Akusztikus szonifikáció (Web Audio)
   Alaphang 144 Hz (szinusz), amelynek szűrő-vágási frekvenciáját a P5 hálózati stressz (GSI) emeli,
   a P6 breakout pedig diszharmonikus fűrészfogat kever hozzá. Hang csak felhasználói koppintás után indul. */
(function(){
"use strict";
const CFG={baseCarrierHz:144,dissonanceHz:203.6,filterRange:{min:200,max:3500},masterGain:.15};
class YantraAudioEngine{
 constructor(){this.ctx=null;this.isInitialized=false}
 init(){
  if(this.isInitialized)return;
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
  const c=this.ctx=new AC();
  this.master=c.createGain();this.master.gain.setValueAtTime(0,c.currentTime);this.master.gain.linearRampToValueAtTime(CFG.masterGain,c.currentTime+1.5);
  this.filter=c.createBiquadFilter();this.filter.type="lowpass";this.filter.frequency.setValueAtTime(CFG.filterRange.min,c.currentTime);
  this.carrier=c.createOscillator();this.carrier.type="sine";this.carrier.frequency.setValueAtTime(CFG.baseCarrierHz,c.currentTime);
  this.dis=c.createOscillator();this.disGain=c.createGain();this.dis.type="sawtooth";this.dis.frequency.setValueAtTime(CFG.dissonanceHz,c.currentTime);this.disGain.gain.setValueAtTime(0,c.currentTime);
  this.dis.connect(this.disGain);this.disGain.connect(this.filter);
  this.carrier.connect(this.filter);this.filter.connect(this.master);this.master.connect(c.destination);
  this.carrier.start();this.dis.start();this.isInitialized=true;
 }
 update(msg){
  if(!this.isInitialized)return;
  if(this.ctx.state==="suspended")this.ctx.resume();
  const now=this.ctx.currentTime;
  if(msg.pillar===5&&msg.metrics){
   const gsi=Math.max(0,msg.metrics.gridStressIndex||0);
   this.filter.frequency.setTargetAtTime(Math.min(CFG.filterRange.max,CFG.filterRange.min+gsi*800),now,1);
  }
  if(msg.pillar===6)this.disGain.gain.setTargetAtTime(msg.type==="P6_SYSTEM_BREAKOUT"?.05:0,now,.2);
 }
 stop(){
  if(!this.isInitialized)return;
  const n=this.ctx.currentTime;this.master.gain.setTargetAtTime(0,n,.2);
  setTimeout(()=>{try{this.carrier.stop();this.dis.stop();this.ctx.close()}catch(e){}this.isInitialized=false},800);
 }
}
window.yantraAudio=new YantraAudioEngine();
YC.ready(()=>{YC.listen(m=>window.yantraAudio.update(m))});
})();
