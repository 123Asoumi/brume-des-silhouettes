// Son du monde : vent, grondements des titans et musique de fond (kora).
// La musique part toute seule si le navigateur l'accepte, sinon au premier geste du joueur.
export function createAudio(store, musicUrl){
  const audio = { on:false, ctx:null, timer:0, boom(){}, toggle, wake, dispose };
  let muted = false;

  function start(){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return false;
    const ctx = new AC(), master = ctx.createGain(); master.gain.value = .75; master.connect(ctx.destination);
    const nb = ctx.createBuffer(1, ctx.sampleRate*2, ctx.sampleRate), nd = nb.getChannelData(0);
    for(let i = 0; i < nd.length; i++) nd[i] = Math.random()*2 - 1;
    const wind = ctx.createBufferSource(); wind.buffer = nb; wind.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 450; bp.Q.value = .6;
    const wg = ctx.createGain(); wg.gain.value = .05;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = .07; lg.gain.value = 250;
    lfo.connect(lg).connect(bp.frequency); wind.connect(bp).connect(wg).connect(master); wind.start(); lfo.start();
    function drum(t, f0, f1, dec, g){
      const o = ctx.createOscillator(), e = ctx.createGain();
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dec*.4);
      e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(.001, t + dec);
      o.connect(e).connect(master); o.start(t); o.stop(t + dec + .05);
    }
    function hiss(t, dec, g, freq, type){
      const s = ctx.createBufferSource(); s.buffer = nb;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const e = ctx.createGain(); e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(.001, t + dec);
      s.connect(f).connect(e).connect(master); s.start(t, Math.random()); s.stop(t + dec + .05);
    }
    // Kora de secours : cordes pincées (Karplus-Strong), ostinato kumbengo et envolées birimintingo
    const sr = ctx.sampleRate;
    const korBus = ctx.createGain(); korBus.gain.value = .9;
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 220; body.Q.value = 1.2; body.gain.value = 5;
    const echo = ctx.createDelay(1); echo.delayTime.value = .29;
    const fb = ctx.createGain(); fb.gain.value = .32;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2400;
    korBus.connect(body); body.connect(master); body.connect(echo);
    echo.connect(damp); damp.connect(fb); fb.connect(echo); damp.connect(master);
    const NOTE = { F2:87.31, Bb2:116.54, C3:130.81, D3:146.83, E3:164.81, F3:174.61, G3:196, A3:220, Bb3:233.08,
      C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392, A4:440, Bb4:466.16, C5:523.25, D5:587.33, F5:698.46 };
    function pluckBuf(f){
      const len = Math.floor(sr*3), out = new Float32Array(len), N = Math.max(2, Math.round(sr/f));
      const ring = new Float32Array(N); let prev = 0;
      for(let i = 0; i < N; i++){ prev = prev*.55 + (Math.random()*2 - 1)*.45; ring[i] = prev; }
      const dec = f < 150 ? .9985 : .997;
      for(let i = 0, p = 0; i < len; i++){ const a = ring[p], b = ring[(p+1)%N]; out[i] = a; ring[p] = (a+b)*.5*dec; p = (p+1)%N; }
      const buf = ctx.createBuffer(1, len, sr); buf.copyToChannel(out, 0); return buf;
    }
    const bufs = {}; for(const n in NOTE) bufs[n] = pluckBuf(NOTE[n]);
    function play(t, n, g, pan){
      const s = ctx.createBufferSource(); s.buffer = bufs[n];
      const e = ctx.createGain(); e.gain.value = g; s.connect(e);
      if(ctx.createStereoPanner){ const p = ctx.createStereoPanner(); p.pan.value = pan; e.connect(p); p.connect(korBus); } else e.connect(korBus);
      s.start(t); s.stop(t + 3);
    }
    const HI = ['C4','D4','F4','G4','A4','Bb4','C5','D5','F5'];
    const PROG = ['F','C','Bb','C'], DUR = 60/100/3;
    const CH = { F:{b:'F2', m:['F3','A3','C4','A3'], h:['A4','C5']}, C:{b:'C3', m:['E3','G3','C4','G3'], h:['G4','C5']},
                 Bb:{b:'Bb2', m:['Bb3','D4','F3','D4'], h:['F4','Bb4']} };
    let next = ctx.currentTime + .15, step = 0, solo = false, si = 0;
    const tick = () => {
      while(next < ctx.currentTime + .2){
        const s = step % 12, bar = Math.floor(step/12), c = CH[PROG[bar % 4]];
        if(s === 0){ solo = bar > 3 && Math.random() < .4; si = HI.length - 1 - ((Math.random()*3)|0); }
        if(s === 0 || s === 6) play(next, c.b, s ? .42 : .6, -.2);
        if(s % 2 === 0 && s % 6 !== 0) play(next, c.m[(s/2)%4], .32, .15);
        if(solo && s % 6 !== 0){ play(next, HI[si], .26, .35); si = Math.min(HI.length-1, Math.max(0, si + (Math.random() < .75 ? -1 : 1))); }
        else if(s === 3 || s === 9) play(next, c.h[s === 3 ? 0 : 1], .22, .3);
        next += DUR * (s % 2 ? .94 : 1.06); step++;
      }
    };
    // morceau de fond en boucle ; la kora synthétisée prend le relais s'il ne charge pas
    const music = ctx.createGain(); music.gain.value = 0; music.connect(master);
    store.set({ audioLoading:true });
    fetch(musicUrl).then(r => { if(!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b => new Promise((ok, ko) => ctx.decodeAudioData(b, ok, ko)))
      .then(buf => {
        if(ctx.state === 'closed') return;
        const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(music); s.start();
        music.gain.setTargetAtTime(.95, ctx.currentTime, 1.5); wg.gain.value = .025;
        store.set({ audioLoading:false, credit:true });
      })
      .catch(() => { store.set({ audioLoading:false }); if(ctx.state !== 'closed') audio.timer = setInterval(tick, 40); });
    audio.boom = s => { if(s < .02) return; const t = ctx.currentTime; drum(t, 70, 26, 1.6, Math.min(1, s*.7)); hiss(t, 1.2, Math.min(.6, s*.4), 180, 'lowpass'); };
    audio.ctx = ctx;
    return true;
  }

  function sync(){ store.set({ audioOn: audio.on }); }
  function wake(){
    if(muted) return;
    if(!audio.ctx && !start()) return;
    audio.ctx.resume().then(() => { audio.on = audio.ctx.state === 'running'; sync(); }).catch(() => {});
  }
  function toggle(){
    if(audio.on){ muted = true; audio.ctx.suspend(); audio.on = false; sync(); }
    else { muted = false; wake(); }
  }
  const firstGesture = () => {
    wake();
    if(audio.on){ removeEventListener('pointerdown', firstGesture, true); removeEventListener('keydown', firstGesture, true); }
  };
  addEventListener('pointerdown', firstGesture, true);
  addEventListener('keydown', firstGesture, true);
  wake();

  function dispose(){
    removeEventListener('pointerdown', firstGesture, true); removeEventListener('keydown', firstGesture, true);
    clearInterval(audio.timer);
    if(audio.ctx) audio.ctx.close();
    audio.on = false;
  }
  return audio;
}
