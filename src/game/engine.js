// Moteur 3D de Brume des Silhouettes : monde, titans, bêtes, héros et niveau.
// L'interface (menus, guide, carte, sort) est en React ; elle parle au moteur par le store et l'objet renvoyé ici.
import * as THREE from 'three';
import { createAudio } from './audio.js';
import { fitHead, buildHair, buildCap } from './hair.js';
import { buildOutfit, disposeOutfit, DEFAULT_OUTFIT } from './outfit.js';

const ASSET = path => import.meta.env.BASE_URL + path;

export function createEngine(canvas, store){
  const T = THREE;
  if (T.ColorManagement) T.ColorManagement.enabled = false;   // les couleurs de la palette arrivent telles quelles dans les shaders
  const cleanups = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
  const renderer = new T.WebGLRenderer({canvas, antialias:true, logarithmicDepthBuffer:true});
  renderer.outputColorSpace = T.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(50, 1, 0.15, 900000);

  /* ================= Relief ================= */
  const perm = new Uint8Array(512);
  (function(){ let s = 7; const p=[...Array(256).keys()];
    for(let i=255;i>0;i--){ s=(s*16807)%2147483647; const j=s%(i+1); [p[i],p[j]]=[p[j],p[i]]; }
    for(let i=0;i<512;i++) perm[i]=p[i&255]; })();
  const hash=(x,z)=>perm[(perm[x&255]+z)&255]/255;
  function noise(x,z){
    const ix=Math.floor(x), iz=Math.floor(z), fx=x-ix, fz=z-iz;
    const u=fx*fx*(3-2*fx), v=fz*fz*(3-2*fz);
    const a=hash(ix,iz), b=hash(ix+1,iz), c=hash(ix,iz+1), d=hash(ix+1,iz+1);
    return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
  }
  function fbm(x,z,o){ let s=0,a=.5,f=1,n=0; for(let i=0;i<o;i++){ s+=a*noise(x*f,z*f); n+=a; a*=.5; f*=2.03; } return s/n; }
  function rawHeight(x,z){
    const plaine = (fbm(x*.0022, z*.0022, 4)-.5)*26;
    const zone   = Math.max(0, fbm(x*.0011+40, z*.0011-17, 3)-.42)/.58;
    const coll   = Math.pow(fbm(x*.0055+90, z*.0055+12, 5), 2.4)*150*zone*zone;
    const herbe  = (fbm(x*.04, z*.04, 2)-.5)*1.2;
    return plaine + coll + herbe;
  }
  // le petit lac : une cuvette creusée dans la plaine, devant à gauche du départ
  const LAKE = (() => { const fx = Math.sin(.6), fz = Math.cos(.6), rx = -fz, rz = fx, fw = 42, rt = -30;
    return { x: fx*fw + rx*rt, z: fz*fw + rz*rt, R: 13 }; })();
  LAKE.base = rawHeight(LAKE.x, LAKE.z); LAKE.water = LAKE.base - .5;
  function height(x,z){
    const h = rawHeight(x,z);
    const d = Math.hypot(x-LAKE.x, z-LAKE.z);
    if(d > LAKE.R + 9) return h;
    const t = 1 - Math.min(1, Math.max(0, (d - (LAKE.R - 3)) / 12)), s = t*t*(3-2*t);
    return h + (LAKE.base - 2.4 - h) * s;
  }

  const N = 240, SIZE = 1400, STEP = SIZE/N;
  const geo = new T.BufferGeometry();
  const pos = new Float32Array((N+1)*(N+1)*3);
  const idx = [];
  for(let j=0;j<=N;j++) for(let i=0;i<=N;i++){ const k=(j*(N+1)+i)*3; pos[k]=i*STEP-SIZE/2; pos[k+2]=j*STEP-SIZE/2; }
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){ const a=j*(N+1)+i, b=a+1, c=a+N+1, d=c+1; idx.push(a,c,b, b,c,d); }
  geo.setIndex(idx);
  geo.setAttribute('position', new T.BufferAttribute(pos,3));
  let cellX=null, cellZ=null;
  const ground = new T.Mesh(geo, null);
  function rebuild(cx, cz){
    for(let j=0;j<=N;j++) for(let i=0;i<=N;i++){ const k=(j*(N+1)+i)*3; pos[k+1] = height(cx*STEP+pos[k], cz*STEP+pos[k+2]); }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    ground.position.set(cx*STEP, 0, cz*STEP);
  }

  /* ================= Lumières ================= */
  const looks = {
    aube:{ sun:[-.85,.22,.35], sky:'#f1d9bf', top:'#9db6d6', ink:'#1a1816', stone:'#8f887d', sand:'#d9cbb3', light:'#f3eee5', fog:[60,620], fl:45000 },
    midi:{ sun:[.25,.85,.35],  sky:'#d6e4ec', top:'#7ba6cf', ink:'#1d1c1a', stone:'#a7a39b', sand:'#d8d0c2', light:'#f6f4ef', fog:[90,680], fl:62000 },
    soir:{ sun:[.9,.16,-.25],  sky:'#efb98f', top:'#5a6b9b', ink:'#0e0d0c', stone:'#7e786e', sand:'#c4b69f', light:'#ebe3d4', fog:[40,560], fl:32000 },
  };
  const U = {
    uSun:{value:new T.Vector3()}, uInk:{value:new T.Color()}, uStone:{value:new T.Color()},
    uSand:{value:new T.Color()}, uLight:{value:new T.Color()}, uSky:{value:new T.Color()},
    uTop:{value:new T.Color()}, uFog:{value:new T.Vector2()}, uCam:{value:new T.Vector3()},
    uTime:{value:0}, uPx:{value:500}, uFL:{value:30000},
  };
  const target = {};
  function setLook(name, instant){
    const L = looks[name];
    target.sun = new T.Vector3(...L.sun).normalize();
    ['ink','stone','sand','light','sky','top'].forEach(k=>target[k]=new T.Color(L[k]));
    target.fog = new T.Vector2(...L.fog); target.fl = L.fl;
    if(instant) easeLook(1);
  }
  function easeLook(k){
    U.uSun.value.lerp(target.sun,k).normalize();
    U.uInk.value.lerp(target.ink,k); U.uStone.value.lerp(target.stone,k); U.uSand.value.lerp(target.sand,k);
    U.uLight.value.lerp(target.light,k); U.uSky.value.lerp(target.sky,k); U.uTop.value.lerp(target.top,k);
    U.uFog.value.lerp(target.fog,k);
    U.uFL.value += (target.fl - U.uFL.value)*k;
  }

  const GRAIN = `
#include <logdepthbuf_pars_fragment>
    float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
      return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
    float grain(){
#include <logdepthbuf_fragment>
      return h21(gl_FragCoord.xy + floor(uTime*10.)*17.31); }
  `;
  // voile lointain + nappe de brouillard au ras du sol où se perdent les pieds des titans
  const HAZE = `
    uniform float uFL;
    float haze(vec3 w){
      float d = distance(w, uCam);
      float h = 1. - exp(-pow(d/uFL, 1.15));
      float m = (1. - smoothstep(-300., 2400., w.y)) * smoothstep(500., 5000., d);
      return clamp(max(h, m*.96), 0., 1.);
    }`;
  const LVP = `#include <common>
#include <logdepthbuf_pars_vertex>
`;
  const LV = `
#include <logdepthbuf_vertex>
`;

  // Matériau "pierre" : sol, pierres du foyer, balle des titans
  const stoneMat = new T.ShaderMaterial({
    uniforms: Object.assign({ uMode:{ value:0 } }, U),
    vertexShader: `
${LVP}
      varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix*viewMatrix*w; ${LV} }`,
    fragmentShader: `
      precision highp float;
      varying vec3 vW; varying vec3 vN;
      uniform vec3 uSun,uInk,uStone,uSand,uLight,uSky,uCam; uniform vec2 uFog; uniform float uTime, uMode;
      ${GRAIN}
      void main(){
        vec3 n = normalize(vN);
        float l = dot(n, uSun);
        float brosse = vn(vW.xz*.018) * .6 + vn(vW.xz*vec2(.09,.012)) * .4;
        float t = clamp(l*.95 + .08 + (brosse-.5)*.22, 0., 1.);
        t = clamp(t + (grain()-.5)*.42, 0., 1.);
        // savane : terre de latérite et herbe sèche (0) · rochers (1) · murs en banco (2)
        vec3 e0 = vec3(.24,.16,.09), e1 = vec3(.56,.38,.2), e2 = vec3(.78,.62,.36), e3 = vec3(.93,.84,.62);
        if(uMode > .5 && uMode < 1.5){ e0 = vec3(.16,.14,.12); e1 = vec3(.4,.35,.3); e2 = vec3(.58,.52,.45); e3 = vec3(.78,.73,.65); }
        else if(uMode > 1.5){ e0 = vec3(.26,.1,.05); e1 = vec3(.55,.26,.14); e2 = vec3(.71,.41,.24); e3 = vec3(.86,.63,.44); }
        vec3 c = mix(e0, e1, smoothstep(.0,.38,t));
        c = mix(c, e2, smoothstep(.36,.66,t));
        c = mix(c, e3, smoothstep(.70,.98,t));
        if(uMode < .5){   // plaques d'herbe verte dans la savane
          float g = smoothstep(.42, .7, vn(vW.xz*.006)*.7 + vn(vW.xz*.03)*.3);
          c = mix(c, c*vec3(.62,.95,.42)*1.05, g*.75);
        }
        float d = distance(vW, uCam);
        float f = smoothstep(uFog.x, uFog.y, d);
        f = clamp(f + (grain()-.5)*.18*f*(1.-f)*4., 0., 1.);
        gl_FragColor = vec4(mix(c, uSky, f), 1.);
      }`
  });
  ground.material = stoneMat;
  scene.add(ground);
  const rockMat = new T.ShaderMaterial({ uniforms: Object.assign({ uMode:{ value:1 } }, U), vertexShader: stoneMat.vertexShader, fragmentShader: stoneMat.fragmentShader });

  /* ================= Ciel ================= */
  const sky = new T.Mesh(new T.SphereGeometry(400000, 48, 24), new T.ShaderMaterial({
    side: T.BackSide, depthWrite:false, depthTest:false, uniforms: U,
    vertexShader:`${LVP}
      varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); ${LV} }`,
    fragmentShader:`
      precision highp float; varying vec3 vD;
      uniform vec3 uSky,uTop,uSun,uLight; uniform float uTime;
      ${GRAIN}
      void main(){
        float y = clamp(vD.y,0.,1.);
        vec3 c = mix(uSky, uTop, smoothstep(.0,.55,y));
        float s = max(dot(normalize(vD), normalize(uSun)), 0.);
        c = mix(c, uLight, pow(s, 18.)*.55);
        c += (grain()-.5)*.035;
        gl_FragColor = vec4(c,1.);
      }`
  }));
  sky.renderOrder = -1; sky.frustumCulled = false;
  scene.add(sky);

  /* ================= Herbes ================= */
  const GR = 95, GW = GR*2, GN = 32000;
  function groundH(wx, wz){
    let lx = (wx - ground.position.x + SIZE/2)/STEP, lz = (wz - ground.position.z + SIZE/2)/STEP;
    let i = Math.min(N-1, Math.max(0, Math.floor(lx))), j = Math.min(N-1, Math.max(0, Math.floor(lz)));
    const fx = Math.min(1, Math.max(0, lx-i)), fz = Math.min(1, Math.max(0, lz-j));
    const H = (a,b)=>pos[(b*(N+1)+a)*3+1];
    const h0 = H(i,j)+(H(i+1,j)-H(i,j))*fx, h1 = H(i,j+1)+(H(i+1,j+1)-H(i,j+1))*fx;
    return h0 + (h1-h0)*fz;
  }
  const blade = new T.InstancedBufferGeometry();
  { const SEG = 5, bp = [], bi = [];
    for(let s=0;s<=SEG;s++){ const y=s/SEG, w=(1-y)*(1-y*.15)*.5; bp.push(-w,y,0, w,y,0); }
    for(let s=0;s<SEG;s++){ const a=s*2; bi.push(a,a+1,a+2, a+1,a+3,a+2); }
    blade.setIndex(bi); blade.setAttribute('position', new T.Float32BufferAttribute(bp,3)); }
  const gOX = new Float32Array(GN), gOZ = new Float32Array(GN);
  const gBase = new Float32Array(GN*4), gRnd = new Float32Array(GN*4);
  { let i = 0;
    while(i < GN){
      const cx = Math.random()*GW, cz = Math.random()*GW, n = 6 + (Math.random()*14|0), r = .25 + Math.random()*.7;
      for(let k=0;k<n && i<GN;k++,i++){
        const a = Math.random()*6.283, d = Math.sqrt(Math.random())*r;
        gOX[i] = cx + Math.cos(a)*d; gOZ[i] = cz + Math.sin(a)*d;
        gRnd[i*4] = Math.random()*6.283; gRnd[i*4+1] = .3 + Math.pow(Math.random(),1.6)*1.1;
        gRnd[i*4+2] = .025 + Math.random()*.05; gRnd[i*4+3] = Math.random()*6.283;
      } } }
  const aBase = new T.InstancedBufferAttribute(gBase, 4); aBase.setUsage(T.DynamicDrawUsage);
  blade.setAttribute('aBase', aBase);
  blade.setAttribute('aRnd', new T.InstancedBufferAttribute(gRnd, 4));
  blade.instanceCount = GN;
  function updateGrass(px, pz){
    const nearHuts = obstacles.filter(o => o.kind === 'hut' && Math.hypot(o.x - px, o.z - pz) < GR + o.r + 5);
    for(let i=0;i<GN;i++){
      const wx = gOX[i] + GW*Math.round((px - gOX[i])/GW);
      const wz = gOZ[i] + GW*Math.round((pz - gOZ[i])/GW);
      const dens = fbm(wx*.012, wz*.012, 2);
      const k = i*4;
      gBase[k] = wx; gBase[k+1] = groundH(wx,wz); gBase[k+2] = wz;
      gBase[k+3] = Math.max(0, Math.min(1, (dens-.36)*3.2)) * clearMask(wx, wz, nearHuts);
    }
    aBase.needsUpdate = true;
  }
  const grass = new T.Mesh(blade, new T.ShaderMaterial({
    uniforms: Object.assign({ uGR:{value:GR}, uHero:{value:new T.Vector3()} }, U), side: T.DoubleSide,
    vertexShader: `
${LVP}
      attribute vec4 aBase; attribute vec4 aRnd;
      uniform vec3 uCam, uHero; uniform float uTime, uGR;
      varying float vY; varying vec3 vW;
      void main(){
        float d = distance(aBase.xz, uCam.xz);
        float h = aRnd.y * aBase.w * (1. - smoothstep(uGR*.6, uGR, d));
        h *= mix(.3, 1., smoothstep(.5, 3., distance(aBase.xz, uHero.xz)));   // l'herbe se couche autour du garçon
        float y = position.y;
        float c = cos(aRnd.x), s = sin(aRnd.x);
        vec3 lp = vec3(position.x*aRnd.z*c, y*h, position.x*aRnd.z*s);
        float gust = sin(uTime*.9 - aBase.x*.06 - aBase.z*.025)*.5 + .5;
        float sway = gust*.7 + sin(uTime*2.6 + aRnd.w)*.12 + (fract(aRnd.w*3.7)-.5)*.5;
        float bend = sway * y*y * h * .55;
        lp.xz += normalize(vec2(1., .35)) * bend;
        lp.y -= abs(bend) * y * .3;
        vec3 wp = aBase.xyz + lp; wp.y -= .12;
        vY = y; vW = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.);
        ${LV}
      }`,
    fragmentShader: `
      precision highp float;
      varying float vY; varying vec3 vW;
      uniform vec3 uInk,uStone,uSand,uLight,uSky,uCam; uniform vec2 uFog; uniform float uTime;
      ${GRAIN}
      ${HAZE}
      void main(){
        float t = clamp(mix(.02, .62, vY*vY) + (grain()-.5)*.55, 0., 1.);
        vec3 c = mix(vec3(.12,.2,.07), vec3(.36,.5,.18), smoothstep(.0,.42,t));   // pied vert sombre
        c = mix(c, vec3(.78,.7,.38), smoothstep(.45,.75,t));                       // pointes dorées
        float f = smoothstep(uFog.x, uFog.y, distance(vW, uCam));
        gl_FragColor = vec4(mix(c, uSky, f), 1.);
      }`
  }));
  grass.frustumCulled = false;
  scene.add(grass);

  /* ================= Titans ================= */
  // Corps noir dense qui s'effrite en grain sur les bords, visible de loin à travers la brume
  const titanMat = new T.ShaderMaterial({
    uniforms: U,
    vertexShader: `
${LVP}
      varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix*viewMatrix*w; ${LV} }`,
    fragmentShader: `
      precision highp float;
      varying vec3 vW; varying vec3 vN;
      uniform vec3 uSun,uInk,uStone,uSand,uSky,uCam; uniform vec2 uFog; uniform float uTime;
      ${GRAIN}
      ${HAZE}
      void main(){
        vec3 n = normalize(vN); vec3 v = normalize(uCam - vW);
        float fac = abs(dot(n, v));
        float core = smoothstep(.04, .55, fac + (grain()-.5)*.38);
        vec3 c = mix(uStone, uInk, core);
        float l = max(dot(n, uSun), 0.);
        c = mix(c, uSand, pow(1.-fac, 3.) * l * .45);
        float f = haze(vW);
        gl_FragColor = vec4(mix(c, uSky, f), 1.);
      }`
  });

  // Masques africains peints sur toile, blanc et noir
  const MW = '#f0ece4', MK = '#151413';
  function features(g, cx, cy, rx, ry, lips){
    g.strokeStyle = MK; g.fillStyle = MK; g.lineCap = 'round';
    g.lineWidth = rx*.07;
    for(const s of [-1,1]){ g.beginPath(); g.arc(cx+s*rx*.36, cy-ry*.06, rx*.34, Math.PI*1.12, Math.PI*1.88); g.stroke(); }
    for(const s of [-1,1]){ g.beginPath(); g.ellipse(cx+s*rx*.36, cy-ry*.03, rx*.22, ry*.026, 0, 0, 7); g.fill(); }
    g.lineWidth = rx*.06; g.beginPath(); g.moveTo(cx, cy-ry*.1); g.lineTo(cx, cy+ry*.32); g.stroke();
    g.beginPath(); g.ellipse(cx, cy+ry*.34, rx*.11, ry*.035, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(cx, cy+ry*.58, rx*(lips?.24:.13), ry*(lips?.075:.045), 0, 0, 7); g.fill();
    if(lips){ g.strokeStyle = MW; g.lineWidth = 3; g.beginPath(); g.moveTo(cx-rx*.2, cy+ry*.58); g.lineTo(cx+rx*.2, cy+ry*.58); g.stroke(); }
  }
  function scarif(g, cx, cy, s){ g.fillStyle = MK; for(let i=-1;i<=1;i++) for(let j=0;j<3;j++) g.fillRect(cx+i*s*1.6-s/2, cy+j*s*1.6, s, s); }
  function oval(g, cx, cy, rx, ry, fill){ g.fillStyle = fill; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.fill(); }
  function maskTexture(kind){
    const c = document.createElement('canvas'); c.width = 256; c.height = 384;
    const g = c.getContext('2d');
    if(kind === 0){                 // Baoulé à coiffe striée
      g.fillStyle = MK; g.beginPath(); g.ellipse(128, 175, 122, 160, 0, 0, 7); g.fill();
      g.save(); g.clip(); g.strokeStyle = MW; g.lineWidth = 2.5;
      for(let i=-400;i<400;i+=13){ g.beginPath(); g.moveTo(i, 0); g.lineTo(i+260, 384); g.stroke(); }
      g.restore();
      oval(g, 128, 222, 78, 120, MW); features(g, 128, 222, 78, 120, false); scarif(g, 128, 140, 6);
    } else if(kind === 1){          // Dan, ovale lisse aux lèvres pleines
      oval(g, 128, 196, 94, 152, MW); features(g, 128, 190, 94, 150, true);
    } else if(kind === 2){          // Fang, long visage en cœur
      g.fillStyle = MK; g.beginPath(); g.ellipse(128, 60, 70, 50, 0, Math.PI, 0); g.fill();
      g.fillStyle = MW; g.beginPath(); g.moveTo(40, 70);
      g.bezierCurveTo(40, 30, 216, 30, 216, 70); g.bezierCurveTo(216, 220, 160, 340, 128, 376);
      g.bezierCurveTo(96, 340, 40, 220, 40, 70); g.fill();
      g.strokeStyle = MK; g.lineWidth = 7; g.beginPath();
      g.moveTo(60, 120); g.quadraticCurveTo(100, 70, 128, 130); g.quadraticCurveTo(156, 70, 196, 120); g.stroke();
      g.lineWidth = 9; g.beginPath(); g.moveTo(128, 130); g.lineTo(128, 290); g.stroke();
      g.fillStyle = MK;
      for(const s of [-1,1]){ g.beginPath(); g.ellipse(128+s*40, 150, 18, 4, 0, 0, 7); g.fill(); }
      g.beginPath(); g.ellipse(128, 322, 14, 6, 0, 0, 7); g.fill();
    } else if(kind === 3){          // Kplé kplé à cornes en croissant
      g.strokeStyle = MK; g.lineCap = 'round';
      for(const s of [-1,1]){ g.lineWidth = 30; g.beginPath(); g.moveTo(128+s*60, 210);
        g.bezierCurveTo(128+s*130, 150, 128+s*110, 40, 128+s*40, 22); g.stroke(); }
      oval(g, 128, 255, 72, 108, MW); features(g, 128, 255, 72, 108, false);
    } else if(kind === 4){          // Gouro à crête dentelée
      g.fillStyle = MK; g.beginPath(); g.moveTo(44, 150);
      for(let i=0;i<=8;i++){ const x = 44 + i*21; g.lineTo(x, i%2 ? 70 : 20 + Math.abs(i-4)*14); }
      g.lineTo(212, 150); g.fill();
      for(const s of [-1,1]){ g.beginPath(); g.arc(128+s*80, 230, 20, 0, 7); g.fill(); }
      oval(g, 128, 238, 72, 122, MW); features(g, 128, 238, 72, 122, false); scarif(g, 128, 160, 5);
    } else {                        // Soleil à dents
      g.fillStyle = MK; g.beginPath();
      for(let i=0;i<72;i++){ const a = i/72*Math.PI*2, r = i%2 ? 108 : 124; g.lineTo(128+Math.cos(a)*r, 200+Math.sin(a)*r); }
      g.fill(); oval(g, 128, 200, 94, 94, MW); features(g, 128, 196, 94, 94, false);
      g.fillStyle = MK; g.beginPath(); g.ellipse(128, 40, 16, 34, 0, 0, 7); g.fill();
    }
    return new T.CanvasTexture(c);
  }
  const maskMats = [0,1,2,3,4,5].map(k => new T.ShaderMaterial({
    uniforms: Object.assign({ map:{value: maskTexture(k)} }, U),
    vertexShader: `
${LVP}
      varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix*viewMatrix*w; ${LV} }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      uniform sampler2D map; uniform vec3 uSun,uSky,uCam; uniform vec2 uFog; uniform float uTime;
      ${GRAIN}
      ${HAZE}
      void main(){
        vec4 tx = texture2D(map, vUv);
        if(tx.a < .5) discard;
        float l = .78 + .22*max(dot(normalize(vN), uSun), 0.);
        vec3 c = tx.rgb * l + (grain()-.5)*.14;
        float f = haze(vW);
        gl_FragColor = vec4(mix(c, uSky, f), 1.);
      }`,
    side: T.DoubleSide,
  }));

  // Géométries partagées (unité = hauteur du titan). Silhouette : un gros bulbe penché sur deux jambes très fines.
  const V2 = (x,y)=>new T.Vector2(x,y);
  const bodyGeo = new T.LatheGeometry([V2(0,-.02),V2(.07,0),V2(.1,.04),V2(.115,.12),V2(.12,.22),V2(.115,.32),V2(.1,.4),V2(.085,.44),V2(.0,.45)], 36);
  const headGeo = new T.LatheGeometry([V2(0,-.03),V2(.085,0),V2(.082,.06),V2(.064,.12),V2(.042,.165),V2(.026,.195),V2(0,.215)], 32);
  const thighGeo = new T.CylinderGeometry(.03, .02, .23, 12); thighGeo.translate(0, -.115, 0);
  const shinGeo  = new T.CylinderGeometry(.02, .004, .25, 12); shinGeo.translate(0, -.125, 0);
  const armGeo   = new T.CylinderGeometry(.022, .007, .4, 12); armGeo.translate(0, -.2, 0);
  const maskGeo  = new T.PlaneGeometry(1, 1, 14, 14);
  { const p = maskGeo.attributes.position; for(let i=0;i<p.count;i++){ const x = p.getX(i); p.setZ(i, -x*x*.9); } maskGeo.computeVertexNormals(); }

  function makeTitan(S, variant){
    const root = new T.Group(), pelvis = new T.Group(), torso = new T.Group(), head = new T.Group();
    root.add(pelvis); pelvis.add(torso);
    const body = new T.Mesh(bodyGeo, titanMat); body.scale.z = .8; torso.add(body);
    head.position.y = .42; torso.add(head);
    const hm = new T.Mesh(headGeo, titanMat); hm.scale.z = .8; head.add(hm);
    const mask = new T.Mesh(maskGeo, maskMats[variant]); mask.scale.set(.15, .225, .15); mask.position.set(0, .075, .072); head.add(mask);
    const arm = side => { const p = new T.Group(); p.position.set(side*.105, .33, 0); p.add(new T.Mesh(armGeo, titanMat)); torso.add(p); return p; };
    const leg = side => { const h = new T.Group(); h.position.set(side*.052, .01, 0); h.add(new T.Mesh(thighGeo, titanMat));
      const k = new T.Group(); k.position.y = -.23; k.add(new T.Mesh(shinGeo, titanMat)); h.add(k); pelvis.add(h); return [h,k]; };
    const armL = arm(-1), armR = arm(1);
    const [hipL, kneeL] = leg(-1), [hipR, kneeR] = leg(1);
    root.scale.setScalar(S);
    root.traverse(o => { o.frustumCulled = false; });
    scene.add(root);
    return { root, pelvis, torso, head, armL, armR, hipL, kneeL, hipR, kneeR, S, x:0, z:0, yaw:0 };
  }

  const DEF = { py:.47, lean:.08, sway:0, head:0, nod:0, aLx:0, aLz:-.12, aRx:0, aRz:.12, hLx:0, hLz:0, kL:0, hRx:0, hRz:0, kR:0, fwd:0 };
  function pose(J, o){
    o = Object.assign({}, DEF, o);
    if(J.ov) J.ov(J, o);          // action en cours (écraser, attraper) par-dessus le comportement de la scène
    J.pelvis.position.set(0, o.py, o.fwd);
    J.torso.rotation.set(o.lean, 0, o.sway);
    J.head.rotation.set(o.nod, o.head, 0);
    J.armL.rotation.set(o.aLx, 0, o.aLz); J.armR.rotation.set(o.aRx, 0, o.aRz);
    J.hipL.rotation.set(o.hLx, 0, o.hLz); J.kneeL.rotation.x = o.kL;
    J.hipR.rotation.set(o.hRx, 0, o.hRz); J.kneeR.rotation.x = o.kR;
    const f = J.pelvis.position.z * J.S;
    const sx = J.x + Math.sin(J.yaw)*f, sz = J.z + Math.cos(J.yaw)*f;
    J.root.position.set(J.x, height(sx, sz) - .006*J.S, J.z);
    J.root.rotation.y = J.yaw;
  }
  const SIT = { py:.02, lean:.18, hLx:-2.02, kL:1.42, hRx:-2.02, kR:1.42, hLz:-.18, hRz:.18, aLx:-.75, aRx:-.75, aLz:-.2, aRz:.2 };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const faceTo = (J, x, z) => Math.atan2(x - J.x, z - J.z);

  /* ================= Le héros : petit garçon en pagne, avec sa texture d'origine ================= */
  const heroTex = new T.TextureLoader().load(ASSET('hero.jpg'));
  const heroMat = new T.ShaderMaterial({ uniforms: Object.assign({ map:{value: heroTex}, uPagne:{value: new T.Color('#2c3e8f')}, uPagneOn:{value: 0}, uSkin:{value: new T.Color('#5a3622')}, uSkinOn:{value: 0} }, U),
    vertexShader: `${LVP}
#include <skinning_pars_vertex>
      varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){
        vUv = uv;
#include <skinbase_vertex>
#include <beginnormal_vertex>
#include <skinnormal_vertex>
#include <begin_vertex>
#include <skinning_vertex>
        vec4 w = modelMatrix*vec4(transformed,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*objectNormal);
        gl_Position = projectionMatrix*viewMatrix*w; ${LV} }`,
    fragmentShader: `
      precision highp float;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      uniform sampler2D map; uniform vec3 uSun,uSky,uCam,uPagne,uSkin; uniform float uTime,uPagneOn,uSkinOn;
      ${GRAIN}
      ${HAZE}
      void main(){
        vec3 tx = texture2D(map, vUv).rgb;
        // le pagne est la seule zone claire de la texture : on la teinte en gardant ses plis et ses ombres
        float lum = dot(tx, vec3(.299, .587, .114));
        float cloth = smoothstep(.50, .60, lum);
        tx = mix(tx, uPagne * clamp(lum/.72, 0., 1.25), cloth*uPagneOn);
        // la peau : tout ce qui n'est pas le pagne ; la teinte garde les ombres et les détails du visage
        tx = mix(tx, uSkin * clamp(lum/.36, 0., 1.7), (1. - cloth)*uSkinOn);
        float l = .72 + .38*max(dot(normalize(vN), uSun), 0.);
        vec3 c = tx * l + (grain()-.5)*.05;
        gl_FragColor = vec4(mix(c, uSky, haze(vW)), 1.);
      }` });
  // cheveux : twists générés par le code, accrochés à l'os de la tête
  const hairMat = new T.ShaderMaterial({ uniforms: Object.assign({ uHair:{value: new T.Color('#1d1714')} }, U),
    vertexShader: `${LVP}
      attribute float aAlong; varying vec3 vW; varying vec3 vN; varying float vA;
      void main(){ vA = aAlong; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix*viewMatrix*w; ${LV} }`,
    fragmentShader: `
      precision highp float; varying vec3 vW; varying vec3 vN; varying float vA;
      uniform vec3 uHair, uSun, uSky, uCam; uniform float uTime;
      ${GRAIN}
      ${HAZE}
      void main(){
        vec3 n = normalize(vN), v = normalize(uCam - vW);
        float l = .42 + .62*max(dot(n, uSun), 0.);
        float rim = pow(1. - abs(dot(n, v)), 2.)*.22;
        vec3 c = uHair*l*(.9 + .25*vA) + rim*mix(uHair, vec3(1.), .35) + (grain()-.5)*.05;
        gl_FragColor = vec4(mix(c, uSky, haze(vW)), 1.);
      }`, side: T.DoubleSide });
  const capMat = new T.ShaderMaterial({ uniforms: hairMat.uniforms, vertexShader: hairMat.vertexShader.replace('attribute float aAlong;', '').replace('vA = aAlong;', 'vA = 0.;'),
    fragmentShader: hairMat.fragmentShader });
  const hair = { style: 'aucune', size: 'moyen', color: '#1d1714', group: null };
  function applyHair(){
    if(!hero.obj) return;
    if(!hero.head) hero.head = fitHead(hero.obj);
    const head = hero.head; if(!head) return;
    if(hair.group){ head.bone.remove(hair.group); hair.group.traverse(o => o.geometry && o.geometry.dispose()); hair.group = null; }
    hairMat.uniforms.uHair.value.set(hair.color);
    const geo = buildHair(head, hair.style, hair.size);
    if(!geo) return;
    const g = new T.Group();
    g.add(new T.Mesh(buildCap(head), capMat), new T.Mesh(geo, hairMat));
    g.traverse(o => o.frustumCulled = false);
    head.bone.add(g); hair.group = g;
  }

  // tenue et bijoux : vêtements découpés dans le corps (même rigging), bijoux accrochés aux os
  const garmentV = `${LVP}
#include <skinning_pars_vertex>
      attribute vec3 aRest; varying vec3 vW; varying vec3 vN; varying vec3 vR;
      void main(){
        vR = aRest;
#include <skinbase_vertex>
#include <beginnormal_vertex>
#include <skinnormal_vertex>
#include <begin_vertex>
#include <skinning_vertex>
        vec4 w = modelMatrix*vec4(transformed,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*objectNormal);
        gl_Position = projectionMatrix*viewMatrix*w; ${LV} }`;
  const garmentF = `
      precision highp float; varying vec3 vW; varying vec3 vN; varying vec3 vR;
      uniform vec3 uCol, uSun, uSky, uCam; uniform float uTime, uKind, uHips;
      ${GRAIN}
      ${HAZE}
      void main(){
        vec3 cream = vec3(.93,.88,.78), leather = vec3(.43,.27,.15), dark = vec3(.2,.12,.07);
        float y = vR.y - uHips;
        vec3 base = uCol;
        if(uKind < .5){            // tunique de guerrier : bandes crème et chevrons sur la poitrine
          float band = step(abs(y - .05), .007) + step(abs(y - .2), .005);
          float chev = step(.5, fract((y + abs(vR.x)*.9)*60.)) * step(abs(y - .125), .024);
          base = mix(uCol, cream, clamp(band + chev*.85, 0., 1.));
        } else if(uKind < 1.5){    // harnais de cuir piqué
          base = leather*(.82 + .3*step(.5, fract(vR.y*150. + vR.x*40.)));
        } else if(uKind < 2.5){    // gilet de chasseur : liseré crème au bord
          base = mix(uCol*.95, cream, step(.5, fract(y*90.))*step(abs(y - .02), .01));
        } else if(uKind < 3.5){    // bandes de cuir enroulées sur les avant-bras
          base = mix(leather, dark, step(.55, fract((vR.y*1.4 + vR.x + vR.z)*70.)));
        } else {                   // manches longues avec poignets crème
          base = mix(uCol, cream, step(.5, fract(vR.y*55.))*.15);
        }
        vec3 n = normalize(vN);
        float l = .5 + .62*max(dot(n, uSun), 0.);
        vec3 c = base*l*1.08 + (grain()-.5)*.05;
        gl_FragColor = vec4(mix(c, uSky, haze(vW)), 1.);
      }`;
  const jewelMat = new T.ShaderMaterial({ uniforms: U,
    vertexShader: `${LVP}
      attribute vec4 aCol; varying vec3 vW; varying vec3 vN; varying vec4 vC;
      void main(){ vC = aCol; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix*viewMatrix*w; ${LV} }`,
    fragmentShader: `
      precision highp float; varying vec3 vW; varying vec3 vN; varying vec4 vC;
      uniform vec3 uSun, uSky, uCam; uniform float uTime;
      ${GRAIN}
      ${HAZE}
      void main(){
        vec3 n = normalize(vN), v = normalize(uCam - vW);
        float l = .45 + .65*max(dot(n, uSun), 0.);
        float spec = pow(max(dot(reflect(-uSun, n), v), 0.), 24.)*vC.a;
        vec3 c = vC.rgb*l + spec*mix(vec3(1.), vC.rgb, .4)*.9 + (grain()-.5)*.04;
        gl_FragColor = vec4(mix(c, uSky, haze(vW)), 1.);
      }` });
  const outfit = { ...DEFAULT_OUTFIT, made: [] };
  function applyOutfit(){
    if(!hero.obj) return;
    disposeOutfit(outfit.made);
    const hipsY = (hero.obj.getObjectByName('mixamorigHips') || { position: { y: .57 } }).position.y;
    const mats = {
      jewel: jewelMat,
      head: hero.head || (hero.head = fitHead(hero.obj)),
      garment: (kind, color) => new T.ShaderMaterial({
        uniforms: Object.assign({ uCol:{ value: new T.Color(color) }, uKind:{ value: kind }, uHips:{ value: hipsY } }, U),
        vertexShader: garmentV, fragmentShader: garmentF }),
    };
    outfit.made = buildOutfit(hero.obj, outfit, mats);
  }

  const WALK = 1.36, RUN = 2.38;   // vitesses réelles des animations (m/s), pour que les pieds ne glissent pas
  const hero = { obj:null, mixer:null, acts:{}, cur:null,
    play(name, fade){ const a = this.acts[name]; if(!a || this.cur === a) return; a.reset().fadeIn(fade).play(); if(this.cur) this.cur.fadeOut(fade); this.cur = a; },
    update(dt, v){
      if(!this.mixer) return;
      if(v < .08) this.play('idle', .35);
      else if(v < (WALK+RUN)/2){ this.play('walk', .25); this.acts.walk.timeScale = Math.max(.5, v/WALK); }
      else { this.play('run', .25); this.acts.run.timeScale = Math.min(1.1, v/RUN); }
      this.mixer.update(dt);
    } };
  fetch(ASSET('hero.json')).then(r => { if(!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(async b => {
      const u = new Uint8Array(b);
      const txt = (u[0] === 0x1f && u[1] === 0x8b)
        ? await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : new TextDecoder().decode(u);
      const obj = new T.ObjectLoader().parse(JSON.parse(txt));
      obj.traverse(o => { if(o.isSkinnedMesh){ o.material = heroMat; o.frustumCulled = false; } });
      obj.scale.setScalar(1.35 / 1.1036);            // environ 1,35 m : un enfant face à des géants de 10 km
      scene.add(obj);
      hero.mixer = new T.AnimationMixer(obj);
      for(const c of obj.animations) hero.acts[c.name] = hero.mixer.clipAction(c);
      hero.obj = obj;
      applyHair();
      applyOutfit();
    })
    .catch(e => console.warn('Héros non chargé', e));

  /* ================= Poussière, feu et fumée ================= */
  const PN = 1800;
  const pPos = new Float32Array(PN*3), pVel = new Float32Array(PN*3), pLife = new Float32Array(PN), pMax = new Float32Array(PN);
  const pS0 = new Float32Array(PN), pS1 = new Float32Array(PN), pToneA = new Float32Array(PN);
  const pSize = new Float32Array(PN), pAlpha = new Float32Array(PN), pTone = new Float32Array(PN), pDrag = new Float32Array(PN), pGrav = new Float32Array(PN);
  let pHead = 0;
  const pGeo = new T.BufferGeometry();
  pGeo.setAttribute('position', new T.BufferAttribute(pPos,3).setUsage(T.DynamicDrawUsage));
  pGeo.setAttribute('aSize', new T.BufferAttribute(pSize,1).setUsage(T.DynamicDrawUsage));
  pGeo.setAttribute('aAlpha', new T.BufferAttribute(pAlpha,1).setUsage(T.DynamicDrawUsage));
  pGeo.setAttribute('aTone', new T.BufferAttribute(pTone,1).setUsage(T.DynamicDrawUsage));
  const particles = new T.Points(pGeo, new T.ShaderMaterial({
    uniforms: U,
    vertexShader: `
${LVP}
      attribute float aSize, aAlpha, aTone; uniform float uPx;
      varying float vA, vT; varying vec3 vW;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vA = aAlpha; vT = aTone; vW = position;
        gl_PointSize = aAlpha > 0. ? min(aSize * uPx / max(-mv.z, 1.), 900.) : 0.; gl_Position = projectionMatrix*mv; ${LV} }`,
    fragmentShader: `
      precision highp float;
      varying float vA, vT; varying vec3 vW;
      uniform vec3 uInk,uStone,uSand,uLight,uSky,uCam; uniform vec2 uFog; uniform float uTime;
      ${GRAIN}
      ${HAZE}
      void main(){
        float d = length(gl_PointCoord - .5);
        float a = smoothstep(.5, .08, d) * vA;
        if(grain() > a) discard;                 // particules en pointillé, comme un fusain
        vec3 c;
        if(vT > 1.5) c = vec3(1., .38, .07);                       // braises
        else if(vT > .9){                                           // flammes : seule couleur du monde
          float k = smoothstep(.5, .0, d);
          c = mix(vec3(.72, .1, .03), vec3(1., .5, .06), smoothstep(.0, .55, k));
          c = mix(c, vec3(1., .92, .55), smoothstep(.6, 1., k));
        }
        else c = mix(vec3(.24,.17,.11), vec3(.74,.6,.44), vT*1.6);   // poussière de latérite
        float f = haze(vW) * (vT > .9 ? .55 : 1.);
        gl_FragColor = vec4(mix(c, uSky, f), 1.);
      }`
  }));
  particles.frustumCulled = false;
  scene.add(particles);
  function emit(x,y,z, vx,vy,vz, life, s0, s1, tone, drag, grav){
    const i = pHead; pHead = (pHead+1) % PN;
    pPos[i*3]=x; pPos[i*3+1]=y; pPos[i*3+2]=z; pVel[i*3]=vx; pVel[i*3+1]=vy; pVel[i*3+2]=vz;
    pLife[i]=0; pMax[i]=life; pS0[i]=s0; pS1[i]=s1; pToneA[i]=tone; pDrag[i]=drag; pGrav[i]=grav;
  }
  function dust(x, z, S, n, strength){
    const y = height(x, z);
    for(let i=0;i<n;i++){
      const a = Math.random()*6.283, v = (.08 + Math.random()*.18)*S*strength;
      emit(x + Math.cos(a)*S*.05, y + Math.random()*S*.02, z + Math.sin(a)*S*.05,
           Math.cos(a)*v, (.03 + Math.random()*.08)*S*strength, Math.sin(a)*v,
           2.2 + Math.random()*1.8, S*.03, S*(.09 + Math.random()*.08), .35, 1.4, .05*S);
    }
  }
  function updateParticles(dt){
    for(let i=0;i<PN;i++){
      if(pLife[i] >= pMax[i]){ pAlpha[i] = 0; continue; }
      pLife[i] += dt;
      const k = pLife[i]/pMax[i];
      const dr = Math.exp(-pDrag[i]*dt);
      pVel[i*3]*=dr; pVel[i*3+1]=pVel[i*3+1]*dr - pGrav[i]*dt; pVel[i*3+2]*=dr;
      pPos[i*3]+=pVel[i*3]*dt; pPos[i*3+1]+=pVel[i*3+1]*dt; pPos[i*3+2]+=pVel[i*3+2]*dt;
      pSize[i] = pS0[i] + (pS1[i]-pS0[i])*k;
      pAlpha[i] = Math.min(1, k*8) * (1-k) * (pToneA[i] > .9 ? 1 : .75);
      pTone[i] = pToneA[i];
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.aSize.needsUpdate = true;
    pGeo.attributes.aAlpha.needsUpdate = true; pGeo.attributes.aTone.needsUpdate = true;
  }

  /* ================= Tremblements ================= */
  const shakes = [];
  let camX = 0, camZ = 0;
  function quake(x, z, s, S){
    const R = S*10;                       // un titan de 10 km se fait sentir à 100 km
    shakes.push({x, z, s, age:0, R});
    const d = Math.hypot(x-camX, z-camZ);
    if(audio.on) audio.boom(s * Math.max(0, 1 - d/(R*1.3)));
  }
  function shakeAmount(dt){
    let a = 0;
    for(let i=shakes.length-1;i>=0;i--){
      const q = shakes[i]; q.age += dt;
      if(q.age > 2.5){ shakes.splice(i,1); continue; }
      const d = Math.hypot(q.x-camX, q.z-camZ);
      const fall = Math.pow(Math.max(0, 1 - d/q.R), 2);
      a += q.s * fall * Math.exp(-q.age*2.6);
    }
    return Math.min(a, 2.2);
  }

  /* ================= Scènes ================= */
  const K = 100;   // échelle des titans : de 7 à 11 km de haut
  function rng(seed){ let a = seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  const LABELS = { regard:'Les veilleurs qui vous fixent', feu:'Le conte autour du feu', combat:'Le combat des titans',
                   danse:'La danse', jeu:'Le jeu de la pierre', marche:'Les marcheurs' };

  function buildSite(def){
    const R = rng(def.seed), site = { ...def, titans:[], extras:[], label: LABELS[def.type], t0: R()*20 };
    const S = () => (70 + R()*40) * K;
    const V = () => (R()*6)|0;
    const T_ = (s, ang, r) => { const J = makeTitan(s, V()); J.x = def.x + Math.sin(ang)*r; J.z = def.z + Math.cos(ang)*r; site.titans.push(J); return J; };

    if(def.type === 'regard'){
      for(let i=0;i<4;i++){ const J = T_(S(), 0, 0); J.r = (25 + i*12)*K; J.dir = R() < .5 ? -1 : 1; J.a0 = R()*6.283; J.lastStep = 0; }
    }
    if(def.type === 'feu'){
      const n = 5;
      for(let i=0;i<n;i++){ const J = T_(S(), i/n*Math.PI*2 + R()*.2, 52*K); J.yaw = faceTo(J, def.x, def.z); J.breath = R()*6; }
      for(let i=0;i<9;i++){ const a = i/9*Math.PI*2, st = new T.Mesh(new T.SphereGeometry(1, 10, 8), stoneMat);
        st.scale.set(3.4*K, 2.2*K, 3.4*K); st.position.set(def.x + Math.cos(a)*9*K, height(def.x, def.z) + .6*K, def.z + Math.sin(a)*9*K);
        scene.add(st); site.extras.push(st); }
      site.acc = 0;
    }
    if(def.type === 'combat'){
      site.A = T_(S()+10, 0, 0); site.B = T_(S()+10, 0, 0); site.spin = R()*6;
    }
    if(def.type === 'danse'){
      for(let i=0;i<4;i++){ const J = T_(S(), 0, 0); J.slot = i; }
    }
    if(def.type === 'jeu'){
      for(let i=0;i<3;i++){ const J = T_(S(), i/3*Math.PI*2, 48*K); J.yaw = faceTo(J, def.x, def.z); }
      const ball = new T.Mesh(new T.SphereGeometry(1, 24, 16), stoneMat); ball.scale.setScalar(5.5*K);
      scene.add(ball); site.extras.push(ball); site.ball = ball;
    }
    if(def.type === 'marche'){
      for(let i=0;i<3;i++){ const J = T_(S(), 0, 0); J.r = (35 + i*15)*K; J.dir = R() < .5 ? -1 : 1; J.a0 = R()*6.283; J.lastStep = 0; }
    }
    return site;
  }

  function updateSite(site, time, dt){
    const t = time + site.t0;
    if(site.type === 'regard'){
      // ils marchent, mais la tête reste tournée vers le héros
      for(const J of site.titans) walk(J, site, t, true);
    }
    if(site.type === 'feu'){
      const teller = site.titans[0];
      site.titans.forEach((J, i) => {
        if(i === 0){
          pose(J, Object.assign({}, SIT, { lean:.28 + Math.sin(t*.9)*.06, nod: Math.sin(t*1.7)*.12,
            aRx: -1.3 + Math.sin(t*1.3)*.5, aRz: .5 + Math.sin(t*.8)*.25, aLx: -1 + Math.sin(t*1.1+1)*.35, aLz:-.4,
            head: Math.sin(t*.35)*.6 }));
        } else {
          const look = Math.max(-1, Math.min(1, wrap(faceTo(J, teller.x, teller.z) - J.yaw)));
          pose(J, Object.assign({}, SIT, { head: look*.8, nod:.12 + Math.sin(t*.6+i)*.03, lean:.24 }));
        }
      });
      // flammes claires et colonne de fumée
      site.acc += dt;
      const y0 = height(site.x, site.z), k = K, r = Math.random;
      while(site.acc > .016){ site.acc -= .016;
        for(let m=0;m<2;m++) emit(site.x + (r()-.5)*10*k, y0 + k, site.z + (r()-.5)*10*k,
             (r()-.5)*3*k, (9 + r()*10)*k, (r()-.5)*3*k, .7 + r()*.6, 10*k, 2*k, 1, .6, -2*k);
        if(r() < .25) emit(site.x + (r()-.5)*6*k, y0 + 4*k, site.z + (r()-.5)*6*k,
             (r()-.5)*5*k, (16 + r()*10)*k, (r()-.5)*5*k, 2 + r()*1.5, 1.1*k, .3*k, 2, .25, -.8*k);
        if(r() < .35) emit(site.x + (r()-.5)*4*k, y0 + 12*k, site.z + (r()-.5)*4*k,
             (2.5 + r()*2)*k, (7 + r()*4)*k, (1 + r())*k, 7 + r()*4, 6*k, (38 + r()*20)*k, .15, .15, -.4*k);
      }
    }
    if(site.type === 'combat'){
      const {A, B} = site;
      const ang = site.spin + t*.06, gap = (A.S + B.S)*.2;
      A.x = site.x - Math.sin(ang)*gap; A.z = site.z - Math.cos(ang)*gap;
      B.x = site.x + Math.sin(ang)*gap; B.z = site.z + Math.cos(ang)*gap;
      A.yaw = faceTo(A, B.x, B.z); B.yaw = faceTo(B, A.x, A.z);
      const P = 3.4, ph = (t % (P*2)) / P, first = ph < 1, q = first ? ph : ph - 1;
      const att = first ? A : B, def = first ? B : A;
      const wind = smooth(0,.35,q) * (1 - smooth(.35,.5,q));
      const strike = smooth(.35,.5,q) * (1 - smooth(.62,1,q));
      const hit = smooth(.48,.56,q) * (1 - smooth(.62,1,q));
      const stance = { hLx:.28, hRx:-.28, kL:.25, kR:.25, py:.455 };
      pose(att, Object.assign({}, stance, { lean:.08 - .28*wind + .5*strike, aRx: .9*wind - 1.85*strike, aRz:.15,
        aLx: -.7 - .5*strike, aLz:-.25, fwd: .12*strike, head: .1*Math.sin(t*3) }));
      pose(def, Object.assign({}, stance, { lean:.12 - .45*hit, nod: -.3*hit, aLx:-1.1, aRx:-.9, aLz:-.3, aRz:.3, fwd:-.06*hit, sway:.15*hit }));
      const prev = site.lastQ ?? q;
      if(prev < .5 && q >= .5){
        const mx = (A.x+B.x)/2, mz = (A.z+B.z)/2;
        quake(mx, mz, 1.5, att.S); dust(mx, mz, att.S, 34, 1.2);
      }
      if(prev < .1 && q >= .1) quake(att.x, att.z, .35, att.S);
      site.lastQ = q;
    }
    if(site.type === 'danse'){
      const beat = t * 1.6;                       // 96 battements par minute
      site.titans.forEach(J => {
        const a = t*.15 + J.slot*Math.PI/2, R = J.S*.62;
        J.x = site.x + Math.sin(a)*R; J.z = site.z + Math.cos(a)*R; J.yaw = faceTo(J, site.x, site.z);
        const b = Math.abs(Math.sin(Math.PI*beat)), alt = Math.sin(Math.PI*beat*.5 + J.slot);
        pose(J, { py:.47 - .05*b, lean:.1 + .08*b, sway:.18*alt, head:.3*alt, nod:.1*b,
          aLz: -(1.5 + .9*Math.max(0, alt)), aRz: 1.5 + .9*Math.max(0, -alt), aLx:-.3*b, aRx:-.3*b,
          hLx: .45*Math.max(0, alt), kL: .7*Math.max(0, alt), hRx: .45*Math.max(0,-alt), kR: .7*Math.max(0,-alt) });
      });
      const k = Math.floor(beat);
      if(site.lastBeat !== undefined && k !== site.lastBeat && k % 2 === 0){
        quake(site.x, site.z, .4, site.titans[0].S);
        site.titans.forEach(J => dust(J.x, J.z, J.S, 4, .5));
      }
      site.lastBeat = k;
    }
    if(site.type === 'jeu'){
      const P = 2.4, k = Math.floor(t/P) % 3, q = (t % P)/P, n = site.titans.length;
      const thr = site.titans[k], rec = site.titans[(k+1)%n];
      const hand = J => new T.Vector3(J.x + Math.sin(J.yaw)*J.S*.16, height(J.x, J.z) + J.S*.62, J.z + Math.cos(J.yaw)*J.S*.16);
      const h0 = hand(thr), h1 = hand(rec);
      const f = smooth(.22,.78,q);
      const p = h0.clone().lerp(h1, f); p.y += Math.sin(Math.PI*f) * thr.S*.45;
      site.ball.position.copy(p);
      site.titans.forEach((J, i) => {
        let o = { lean:.12, head: Math.max(-.8, Math.min(.8, wrap(Math.atan2(p.x-J.x, p.z-J.z) - J.yaw))) };
        if(J === thr){ const w = smooth(0,.2,q)*(1-smooth(.2,.35,q)), s = smooth(.2,.3,q)*(1-smooth(.4,.8,q));
          o = Object.assign(o, { aRx: .8*w - 2.6*s, aLx: -.4, lean:.12 - .15*w + .3*s, hLx:.2, hRx:-.2 }); }
        if(J === rec){ const c = smooth(.5,.78,q); o = Object.assign(o, { aRx:-1.5*c, aLx:-1.5*c, aLz:-.3, aRz:.3, lean:.12 - .1*c }); }
        pose(J, o);
      });
    }
    if(site.type === 'marche'){
      for(const J of site.titans) walk(J, site, t, false);
    }
  }
  function walk(J, site, t, stare){
    const v = J.S*.07, stride = J.S*.55, w = J.dir * v / J.r;
    const a = J.a0 + t*w;
    J.x = site.x + Math.sin(a)*J.r; J.z = site.z + Math.cos(a)*J.r;
    J.yaw = a + J.dir*Math.PI/2;
    const ph = (t*v / stride) * Math.PI, s = Math.sin(ph);
    const head = stare ? Math.max(-1.3, Math.min(1.3, wrap(faceTo(J, camX, camZ) - J.yaw))) : .15*Math.sin(ph*.25);
    pose(J, { py:.47 - .02*Math.abs(Math.cos(ph)), lean:.14, sway:.05*s,
      hLx: .38*s, kL: .55*Math.max(0, -s), hRx: -.38*s, kR: .55*Math.max(0, s),
      aLx: -.3*s, aRx: .3*s, head });
    const step = Math.sign(s);
    if(step !== J.lastStep && J.lastStep !== 0){ quake(J.x, J.z, .3, J.S); dust(J.x, J.z, J.S, 5, .4); }
    J.lastStep = step;
  }
  function smooth(a, b, x){ const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); }

  // Les premières scènes jalonnent le chemin ; au-delà, d'autres titans apparaissent partout dans la plaine
  const START_YAW = 0.6;
  // toutes les scènes sont posées en éventail devant le promeneur, visibles dès le départ
  const FAN = [['regard',0,280],['feu',-.32,360],['combat',.32,350],['danse',-.62,460],['jeu',.62,470],['marche',.04,620]];
  const curated = FAN.map(([type, off, dist], i) => {
    const a = START_YAW + off, d = dist*K;
    const x = Math.sin(a)*d, z = Math.cos(a)*d;
    return { key:'c'+i, type, x, z, seed: 101 + i*17, face: Math.atan2(-x, -z) };
  });
  const TYPES = ['regard','feu','combat','danse','jeu','marche'];
  function gridSite(i, j){
    const h = n => { const s = Math.sin(i*127.1 + j*311.7 + n*74.7)*43758.5453; return s - Math.floor(s); };
    if(h(0) < .5) return null;
    const x = (i + .2 + h(1)*.6)*650*K, z = (j + .2 + h(2)*.6)*650*K;
    if(Math.hypot(x, z) < 400*K) return null;
    for(const c of curated) if(Math.hypot(c.x-x, c.z-z) < 520*K) return null;
    return { key:`g${i}_${j}`, type: TYPES[(h(3)*6)|0], x, z, seed: (h(4)*1e9)|0, face: h(5)*6.283 };
  }
  const live = new Map();
  function manageSites(){
    const want = new Map();
    for(const c of curated) if(Math.hypot(c.x-camX, c.z-camZ) < 1300*K) want.set(c.key, c);
    const ci = Math.floor(camX/(650*K)), cj = Math.floor(camZ/(650*K));
    for(let i=ci-2;i<=ci+2;i++) for(let j=cj-2;j<=cj+2;j++){
      const g = gridSite(i, j);
      if(g && Math.hypot(g.x-camX, g.z-camZ) < 1300*K) want.set(g.key, g);
    }
    for(const [k, s] of live) if(!want.has(k) && Math.hypot(s.x-camX, s.z-camZ) > 1500*K){
      s.titans.forEach(J => scene.remove(J.root)); s.extras.forEach(e => scene.remove(e)); live.delete(k);
    }
    for(const [k, d] of want) if(!live.has(k)) live.set(k, buildSite(d));
  }


  /* ================= Son ================= */
  const audio = createAudio(store, ASSET('nalesonko.mp3'));

  /* ================= Le lac, les cases, les rochers et les bêtes masquées ================= */
  const FWD = [Math.sin(.6), Math.cos(.6)], RGT = [-Math.cos(.6), Math.sin(.6)];
  const P = (fw, rt) => [FWD[0]*fw + RGT[0]*rt, FWD[1]*fw + RGT[1]*rt];
  const R7 = rng(77);

  // l'eau : le bleu est, avec le feu, la seule couleur du monde
  // toits de paille et feuilles (les titans et les bêtes restent en noir et blanc)
  const litF = body => `
      precision highp float; varying vec3 vW; varying vec3 vN;
      uniform vec3 uSun, uSky, uCam; uniform float uTime;
      ${GRAIN}
      ${HAZE}
      void main(){
        vec3 n = normalize(vN);
        float l = .45 + .65*max(dot(n, uSun), 0.);
        ${body}
        c = c*l + (grain()-.5)*.06;
        gl_FragColor = vec4(mix(c, uSky, haze(vW)), 1.);
      }`;
  const THATCH_F = litF('vec3 c = mix(vec3(.38,.27,.13), vec3(.8,.64,.34), vn(vec2(atan(vN.x, vN.z)*40., vW.y*3.)));');
  const thatchMat = new T.ShaderMaterial({ uniforms: U, vertexShader: stoneMat.vertexShader, fragmentShader: THATCH_F });
  const leafMat = new T.ShaderMaterial({ uniforms: U, vertexShader: stoneMat.vertexShader,
    fragmentShader: litF('vec3 c = vec3(.22,.42,.17)*(.85 + .3*vn(vW.xz*7.));'), side: T.DoubleSide });

  const waterMat = new T.ShaderMaterial({ uniforms: U,
    vertexShader: `${LVP}
      varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; ${LV} }`,
    fragmentShader: `
      precision highp float; varying vec3 vW; uniform vec3 uCam, uSky; uniform float uTime;
      ${GRAIN}
      ${HAZE}
      void main(){
        vec3 v = normalize(uCam - vW);
        float fres = pow(1. - max(v.y, 0.), 3.);
        float rip = vn(vW.xz*.45 + vec2(uTime*.3, uTime*.17))*.6 + vn(vW.xz*1.3 - uTime*.4)*.4;
        vec3 c = mix(vec3(.12,.32,.52), vec3(.56,.76,.9), clamp(fres*.9 + (rip-.5)*.4, 0., 1.));
        c += (grain()-.5)*.06;
        gl_FragColor = vec4(mix(c, uSky, haze(vW)), 1.);
      }` });
  const water = new T.Mesh(new T.CircleGeometry(LAKE.R + 11, 72), waterMat);
  water.rotation.x = -Math.PI/2; water.position.set(LAKE.x, LAKE.water, LAKE.z); scene.add(water);

  // obstacles : rochers et cases (on peut se cacher derrière les uns, dans les autres)
  const obstacles = [];
  const rockGeo = new T.SphereGeometry(1, 18, 12);
  { const p = rockGeo.attributes.position;
    for(let i=0;i<p.count;i++){ const x=p.getX(i), y=p.getY(i), z=p.getZ(i), n = 1 + (noise(x*2.1+5, z*2.1+y*1.7)-.5)*.5;
      p.setXYZ(i, x*n, Math.max(y, -.35)*n, z*n); }
    rockGeo.computeVertexNormals(); }
  for(const [fw, rt] of [[14,-7],[22,8],[31,-14],[36,27],[47,4],[55,-12],[62,22],[70,-3],[79,14],[24,-42],[52,-36],[86,30],[40,46],[66,40],[18,36],[90,-6]]){
    const [x, z] = P(fw, rt), s = 1.5 + R7()*1.5;
    const m = new T.Mesh(rockGeo, rockMat); m.scale.set(s, s*(.8 + R7()*.35), s*1.1); m.rotation.y = R7()*6.28;
    m.position.set(x, height(x, z) - .25*s, z); scene.add(m);
    obstacles.push({ x, z, r: s*1.05, kind:'rock' });
  }
  const wallMat = new T.ShaderMaterial({ uniforms: Object.assign({ uMode:{ value:2 } }, U), vertexShader: stoneMat.vertexShader, fragmentShader: stoneMat.fragmentShader, side: T.DoubleSide });
  const HR = 2.6;
  for(const [fw, rt] of [[16,14],[23,22],[12,25],[29,13]]){
    const [x, z] = P(fw, rt), door = Math.atan2(-x, -z) + (R7()-.5)*.8, y = height(x, z) - .15;
    const wall = new T.Mesh(new T.CylinderGeometry(HR, HR, 2.3, 44, 1, true, door + .45, Math.PI*2 - .9), wallMat);
    wall.position.set(x, y + 1.15, z); scene.add(wall);
    const roof = new T.Mesh(new T.ConeGeometry(HR + .75, 2.5, 44), thatchMat); roof.position.set(x, y + 2.3 + 1.2, z); scene.add(roof);
    obstacles.push({ x, z, r: HR, kind:'hut', door });
  }
  // ---- le Village-Visage : des centaines de cases dessinent un grand visage autour des veilleurs ----
  const FACE = { x: curated[0].x, z: curated[0].z };
  const FL = (u, w) => [FACE.x + RGT[0]*u + FWD[0]*w, FACE.z + RGT[1]*u + FWD[1]*w];
  const villageHuts = [];
  {
    const R9 = rng(909);
    const add = (u, w, r, palace) => { const [x, z] = FL(u, w); villageHuts.push({ x, z, r, palace: !!palace }); };
    for(let a = 0; a < Math.PI*2; a += .031) add(Math.sin(a)*1300 + (R9()-.5)*20, Math.cos(a)*1600 + (R9()-.5)*20, 6 + R9()*7);   // contour
    for(const s of [-1, 1]){
      add(s*480, 380, 110, true);                                                                                    // œil : palais géant
      for(let a = 0; a < Math.PI*2; a += Math.PI/8) add(s*480 + Math.sin(a)*190, 380 + Math.cos(a)*150, 16 + R9()*6); // paupières
      for(let i = 0; i < 9; i++){ const t = i/8; add(s*(250 + t*450), 640 + Math.sin(t*Math.PI)*90, 12 + R9()*4); }   // sourcils
      for(let i = 0; i < 3; i++) for(let j = 0; j < 3; j++) add(s*(780 + i*55), -150 - j*70 - i*20, 9);           // scarifications
    }
    for(let i = 0; i < 8; i++){ const t = i/7; add((R9()-.5)*10, 220 - t*440, 10 + t*20); }                         // nez
    for(const s of [-1, 1]) add(s*95, -305, 45, true);                                                               // narines-palais
    for(let i = 0; i <= 22; i++){ const u = -620 + i*(1240/22); if(Math.abs(u) > 120) add(u, -700 + u*u/1900, 17 + R9()*5); }   // bouche
    add(0, -735, 70, true);                                                                                          // palais de la bouche
  }
  {
    const instV = `${LVP}
      varying vec3 vW; varying vec3 vN;
      void main(){ mat4 m = modelMatrix * instanceMatrix; vec4 w = m*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(m)*normal);
        gl_Position = projectionMatrix*viewMatrix*w; ${LV} }`;
    const wallInst = new T.ShaderMaterial({ uniforms: Object.assign({ uMode:{ value:2 } }, U), vertexShader: instV, fragmentShader: stoneMat.fragmentShader, side: T.DoubleSide });
    const roofInst = new T.ShaderMaterial({ uniforms: U, vertexShader: instV, fragmentShader: THATCH_F });
    const unitWall = new T.CylinderGeometry(1, 1, .88, 40, 1, true, .45, Math.PI*2 - .9); unitWall.translate(0, .44, 0);
    const unitRoof = new T.ConeGeometry(1.29, .96, 40); unitRoof.translate(0, .88 + .48, 0);
    const n = villageHuts.length;
    const walls = new T.InstancedMesh(unitWall, wallInst, n), roofs = new T.InstancedMesh(unitRoof, roofInst, n);
    const M4 = new T.Matrix4(), Q = new T.Quaternion(), V3 = new T.Vector3(), SC = new T.Vector3(), YA = new T.Vector3(0, 1, 0);
    const toStart = Math.atan2(-FWD[0], -FWD[1]);
    villageHuts.forEach((h, i) => {
      h.door = h.palace ? toStart : Math.atan2(FACE.x - h.x, FACE.z - h.z) + (R7()-.5)*.6;
      const y = height(h.x, h.z) - .04*h.r, sy = h.palace ? .8 : 1;
      M4.compose(V3.set(h.x, y, h.z), Q.setFromAxisAngle(YA, h.door), SC.set(h.r, h.r*sy, h.r));
      walls.setMatrixAt(i, M4); roofs.setMatrixAt(i, M4);
      obstacles.push({ x:h.x, z:h.z, r:h.r, kind:'hut', door:h.door, village:true, palace:h.palace });
      if(h.palace){   // un masque géant au-dessus de la porte du palais
        const m = new T.Mesh(maskGeo, maskMats[i % 6]);
        m.position.set(h.x + Math.sin(h.door)*(h.r + .6), y + h.r*.55, h.z + Math.cos(h.door)*(h.r + .6));
        m.rotation.y = h.door; m.scale.set(h.r*.5, h.r*.75, h.r*.5); m.frustumCulled = false; scene.add(m);
      }
    });
    walls.frustumCulled = roofs.frustumCulled = false; scene.add(walls, roofs);
  }
  function clearMask(x, z, list = obstacles){
    if(Math.hypot(x-LAKE.x, z-LAKE.z) < LAKE.R + 1) return 0;
    for(const o of list) if(o.kind === 'hut' && Math.hypot(x-o.x, z-o.z) < o.r + .2) return 0;
    return 1;
  }
  function blocked(ax, az, bx, bz){
    const dx = bx-ax, dz = bz-az, L2 = dx*dx + dz*dz || 1;
    for(const o of obstacles){
      const t = ((o.x-ax)*dx + (o.z-az)*dz) / L2; if(t <= 0 || t >= 1) continue;
      const px = ax + dx*t - o.x, pz = az + dz*t - o.z;
      if(px*px + pz*pz < (o.r*.85)**2) return true;
    }
    return false;
  }
  function inHut(x, z){ for(const o of obstacles) if(o.kind === 'hut' && Math.hypot(x-o.x, z-o.z) < o.r - .35) return o; return null; }
  function resolveHero(x, z){
    for(const o of obstacles){
      const dx = x-o.x, dz = z-o.z, d = Math.hypot(dx, dz) || .001;
      if(o.kind === 'rock'){ const m = o.r + .35; if(d < m){ x = o.x + dx/d*m; z = o.z + dz/d*m; } }
      else if(Math.abs(wrap(Math.atan2(dx, dz) - o.door)) > .42 && Math.abs(d - o.r) < .4){
        const m = d < o.r ? o.r - .4 : o.r + .4; x = o.x + dx/d*m; z = o.z + dz/d*m; }
    }
    const dl = Math.hypot(x-LAKE.x, z-LAKE.z) || .001, ml = LAKE.R - .6;
    if(dl < ml){ x = LAKE.x + (x-LAKE.x)/dl*ml; z = LAKE.z + (z-LAKE.z)/dl*ml; }
    return [x, z];
  }

  // cochons masqués, plus grands que le garçon
  const ballGeo = new T.SphereGeometry(1, 24, 16);
  const legGeo = new T.CylinderGeometry(.13, .08, .78, 10); legGeo.translate(0, -.39, 0);
  const earGeo = new T.ConeGeometry(.16, .42, 8);
  function makePig(variant){
    const root = new T.Group();
    const body = new T.Mesh(ballGeo, titanMat); body.scale.set(.8, .74, 1.32); body.position.y = 1.2; root.add(body);
    const head = new T.Group(); head.position.set(0, 1.32, 1.28); root.add(head);
    const hm = new T.Mesh(ballGeo, titanMat); hm.scale.set(.52, .5, .5); head.add(hm);
    for(const s of [-1,1]){ const e = new T.Mesh(earGeo, titanMat); e.position.set(s*.36, .5, -.05); e.rotation.z = -s*.5; head.add(e); }
    const mask = new T.Mesh(maskGeo, maskMats[variant]); mask.scale.set(.9, 1.35, .9); mask.position.set(0, .05, .52); head.add(mask);
    const legs = [];
    for(const [lx, lz] of [[-.42,.78],[.42,.78],[-.42,-.78],[.42,-.78]]){ const g = new T.Group(); g.position.set(lx, .8, lz); g.add(new T.Mesh(legGeo, titanMat)); root.add(g); legs.push(g); }
    const tail = new T.Mesh(earGeo, titanMat); tail.position.set(0, 1.4, -1.32); tail.rotation.x = -2.2; root.add(tail);
    root.traverse(o => o.frustumCulled = false); scene.add(root);
    return { root, head, legs, phase:0 };
  }
  const pigs = [[64,8,1],[72,-10,4],[58,31,0]].map(([fw, rt, v], i) => {
    const h = P(fw, rt), p = makePig(v);
    return Object.assign(p, { home:h, x:h[0], z:h[1], yaw:i*2.1, state:'flane', tx:h[0], tz:h[1], wait:R7()*3, lastX:0, lastZ:0, v:0 });
  });

  // bêtes masquées du Village-Visage (certaines énormes), et gardiens devant les palais des yeux
  {
    const R8 = rng(4242);
    const addBeast = (bx, bz, big, v) => {
      const p = makePig(v); p.root.scale.setScalar(big); p.root.position.set(bx, height(bx, bz), bz);
      pigs.push(Object.assign(p, { home:[bx, bz], x:bx, z:bz, yaw:R8()*6.28, state:'flane', tx:bx, tz:bz, wait:R8()*3, lastX:0, lastZ:0, v:0, big, village:true }));
    };
    let n = 0, tries = 0;
    while(n < 26 && tries < 800){
      tries++;
      const u = (R8()-.5)*2400, w = (R8()-.5)*3000;
      if((u/1250)**2 + (w/1550)**2 > 1) continue;
      const [bx, bz] = FL(u, w);
      if(obstacles.some(o => Math.hypot(o.x - bx, o.z - bz) < o.r + 8)) continue;
      addBeast(bx, bz, R8() < .3 ? 1.8 : 1 + R8()*.3, [0,1,3,4,5][n % 5]); n++;
    }
    for(const h of villageHuts) if(h.palace && h.r > 100)
      for(const s of [-1, 1]){ const d = h.r + 22, side = s*30;
        addBeast(h.x + Math.sin(h.door)*d + Math.cos(h.door)*side, h.z + Math.cos(h.door)*d - Math.sin(h.door)*side, 1.6, 4); }
  }

  // le gros poisson masqué du lac
  const fish = (() => {
    const root = new T.Group(); root.rotation.order = 'YXZ';
    const body = new T.Mesh(ballGeo, titanMat); body.scale.set(1.15, 1.05, 3.2); root.add(body);
    const tail = new T.Mesh(new T.ConeGeometry(1.15, 1.9, 4), titanMat); tail.rotation.x = Math.PI/2; tail.scale.set(.22, 1, 1); tail.position.z = -3.6; root.add(tail);
    const fin = new T.Mesh(new T.ConeGeometry(.5, 1.7, 4), titanMat); fin.position.set(0, 1.4, -.4); fin.scale.set(.2, 1, 2.2); root.add(fin);
    const mask = new T.Mesh(maskGeo, maskMats[2]); mask.scale.set(2.3, 3.2, 2.3); mask.position.z = 3.32; root.add(mask);
    root.traverse(o => o.frustumCulled = false); scene.add(root);
    return { root, state:'nage', t:0, a:0, cd:2, x:LAKE.x, z:LAKE.z };
  })();

  const game = { t:0, lock:0, respawn:false, msg:'', heroHidden:false, stomper:null,
    spotted(){ if(audio.on) audio.boom(.3); },
    catch(msg, delay = 0){ if(this.lock > 0) return; this.lock = 2.6 + delay; this.msg = msg; if(audio.on) audio.boom(1); } };

  // ---- les titans tentent d'écraser le garçon ; ceux du feu l'attrapent et le jettent dans les flammes ----
  const marker = new T.Mesh(new T.CircleGeometry(1, 48), new T.MeshBasicMaterial({ color: 0x161514, transparent: true, opacity: .45, depthWrite: false }));
  marker.rotation.x = -Math.PI/2; marker.visible = false; marker.renderOrder = 2; scene.add(marker);
  const CRUSH = 6, T_LOCK = 1.6, T_IMP = 4.4, T_END = 6.4;
  function stompOv(J, o){
    const st = J.st, t = st.t;
    const bx = st.persist ? st.bx : J.x, bz = st.persist ? st.bz : J.z, byaw = st.persist ? st.byaw : J.yaw;
    const w = smooth(0, 1.6, t) * (1 - smooth(T_IMP + .4, T_END, t));
    const yaw = Math.atan2(st.tx - bx, st.tz - bz);
    const lx = .052*J.S, rx = st.tx - lx*Math.cos(yaw), rz = st.tz + lx*Math.sin(yaw);   // le pied droit tombe sur la cible
    J.x = bx + (rx - bx)*w; J.z = bz + (rz - bz)*w; J.yaw = byaw + wrap(yaw - byaw)*w;
    const r = smooth(0, 1.4, t) * (1 - smooth(T_IMP - .45, T_IMP, t));
    Object.assign(o, { py:.47 - .03*r, lean:.06 + .12*r, sway:0, nod:.4*r, head:0, fwd:0,
      hRx:-1.25*r, kR:1.5*r, hRz:0, hLx:.1*r, kL:.25*r, hLz:0, aLx:-.2*r, aRx:-.2*r, aLz:-.12 - .6*r, aRz:.12 + .6*r });
  }
  function grabOv(J, o){
    const g = J.grab, t = g.t;
    const r = smooth(0, 1.5, t) * (1 - smooth(2.4, 3.6, t)), s = smooth(1.6, 2.8, t);
    const toHero = Math.atan2(g.hx - J.x, g.hz - J.z), toFire = Math.atan2(g.fx - J.x, g.fz - J.z);
    const aim = toHero + wrap(toFire - toHero)*s;
    J.yaw = g.yaw0 + wrap(aim - g.yaw0)*.55*r;
    Object.assign(o, { lean: o.lean + .75*r, nod: .45*r, head: wrap(aim - J.yaw)*r, aRx: -1.3 - .9*r + 1.4*s*r, aRz: .25, aLx: -.9 });
  }
  function updateGiants(dt, hx, hz){
    const hidden = !!inHut(hx, hz);
    for(const s of live.values()){
      if(s.type !== 'feu') continue;
      if(!s.grab && game.lock <= 0 && Math.hypot(hx - s.x, hz - s.z) < 1800){
        let best = null, bd = 1e12;
        for(const J of s.titans){ const d = Math.hypot(J.x-hx, J.z-hz); if(d < bd){ bd = d; best = J; } }
        best.grab = { t:0, hx, hz, fx:s.x, fz:s.z, yaw0:best.yaw }; best.ov = grabOv; s.grab = { t:0, J:best };
        game.catch('Les titans t’ont jeté dans le feu', 1.4);
      }
      if(s.grab){
        const g = s.grab, Jg = g.J; g.t += dt; Jg.grab.t = g.t;
        if(g.t > 1.5) game.heroHidden = true;
        if(g.t > 2.6 && !g.burst){
          g.burst = true; const y0 = height(s.x, s.z), r = Math.random;
          for(let i=0;i<140;i++) emit(s.x + (r()-.5)*12*K, y0 + K, s.z + (r()-.5)*12*K,
            (r()-.5)*8*K, (14 + r()*22)*K, (r()-.5)*8*K, 1 + r(), 18*K, 3*K, 1, .5, -2*K);
          quake(s.x, s.z, 1.2, Jg.S);
        }
        if(g.t > 4.2){ Jg.yaw = Jg.grab.yaw0; Jg.grab = null; Jg.ov = null; s.grab = null; }
      }
    }
    if(!game.stomper && game.lock <= 0 && !hidden){
      let best = null, bd = 1e12, site = null;
      for(const s of live.values()){ if(s.type === 'feu') continue;
        for(const J of s.titans){ J.cd = (J.cd || 0) - dt; const d = Math.hypot(J.x-hx, J.z-hz);
          if(J.cd <= 0 && d < 1.3*J.S && d < bd){ bd = d; best = J; site = s; } } }
      if(best){ best.st = { t:0, tx:hx, tz:hz, persist: site.type === 'jeu', bx:best.x, bz:best.z, byaw:best.yaw }; best.ov = stompOv; game.stomper = best; }
    }
    const J = game.stomper;
    if(J){
      const st = J.st; st.t += dt;
      if(st.t < T_LOCK && game.lock <= 0){ st.tx = hx; st.tz = hz; }
      const k = smooth(.3, T_LOCK, st.t) * (1 - smooth(T_IMP, T_IMP + .5, st.t));
      marker.visible = k > .01; marker.position.set(st.tx, height(st.tx, st.tz) + .12, st.tz);
      marker.scale.setScalar(CRUSH * (st.t < T_LOCK ? 1.4 : 1));
      marker.material.opacity = k * (st.t > T_LOCK ? .45 + .15*Math.sin(game.t*14) : .3);
      if(st.t >= T_IMP && !st.hit){
        st.hit = true; quake(st.tx, st.tz, 2.2, J.S); dust(st.tx, st.tz, 220, 40, 1);
        if(game.lock <= 0 && Math.hypot(hx - st.tx, hz - st.tz) < CRUSH) game.catch('Un titan t’a écrasé');
      }
      if(st.t >= T_END){
        if(st.persist){ J.x = st.bx; J.z = st.bz; J.yaw = st.byaw; }
        J.st = null; J.ov = null; J.cd = 8; game.stomper = null; marker.visible = false;
      }
    }
  }

  function updatePig(p, dt, hx, hz, hidden){
    const dx = hx-p.x, dz = hz-p.z, d = Math.hypot(dx, dz);
    const ahead = Math.abs(wrap(Math.atan2(dx, dz) - p.yaw)) < 1.1;
    const far = Math.hypot(p.x-p.home[0], p.z-p.home[1]) > 95;
    const sees = !hidden && game.lock <= 0 && !far && d < 26 && (ahead || d < 7 || p.state === 'chasse') && !blocked(p.x, p.z, hx, hz);
    if(sees){ if(p.state !== 'chasse') game.spotted(); p.state = 'chasse'; p.lastX = hx; p.lastZ = hz; }
    else if(p.state === 'chasse'){ p.state = far ? 'flane' : 'cherche'; p.wait = 3.5; }
    let tx = p.tx, tz = p.tz, sp = 0;
    if(p.state === 'chasse'){ tx = hx; tz = hz; sp = 2.15; }
    else if(p.state === 'cherche'){
      tx = p.lastX; tz = p.lastZ; sp = 1.5;
      if(Math.hypot(tx-p.x, tz-p.z) < 1.8){ sp = 0; p.wait -= dt; if(p.wait <= 0) p.state = 'flane'; }
    } else {
      if(Math.hypot(p.tx-p.x, p.tz-p.z) < 1.5){
        p.wait -= dt;
        if(p.wait <= 0){ const a = R7()*6.283, r = R7()*28; p.tx = p.home[0] + Math.sin(a)*r; p.tz = p.home[1] + Math.cos(a)*r; p.wait = 2 + R7()*4; }
      } else sp = .9;
      tx = p.tx; tz = p.tz;
    }
    p.v += (sp - p.v) * Math.min(1, dt*3);
    if(p.v > .02){ p.yaw += wrap(Math.atan2(tx-p.x, tz-p.z) - p.yaw) * Math.min(1, dt*4);
      p.x += Math.sin(p.yaw)*p.v*dt; p.z += Math.cos(p.yaw)*p.v*dt; }
    for(const o of obstacles){ const ox = p.x-o.x, oz = p.z-o.z, od = Math.hypot(ox, oz) || .001, m = o.r + 1.1*(p.big || 1);
      if(od < m){ p.x = o.x + ox/od*m; p.z = o.z + oz/od*m; } }
    { const ox = p.x-LAKE.x, oz = p.z-LAKE.z, od = Math.hypot(ox, oz) || .001, m = LAKE.R + .5;
      if(od < m){ p.x = LAKE.x + ox/od*m; p.z = LAKE.z + oz/od*m; } }
    p.phase += p.v*dt*4.2;
    p.legs.forEach((l, i) => { l.rotation.x = Math.sin(p.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * Math.min(.7, p.v*.35); });
    p.head.rotation.x = (p.state === 'cherche' && p.v < .1) ? .35 + Math.sin(game.t*6)*.12 : Math.sin(p.phase*.5)*.05;
    p.root.position.set(p.x, height(p.x, p.z), p.z); p.root.rotation.y = p.yaw;
    if(p.state === 'chasse' && d < 1.9*(p.big || 1)) game.catch('Un cochon masqué t’a attrapé');
  }

  function updateFish(dt, hx, hz, hidden){
    const f = fish, W = LAKE.water, hd = Math.hypot(hx-LAKE.x, hz-LAKE.z) || .001;
    f.cd -= dt;
    if(f.state === 'nage'){
      f.a += dt*.35;
      const x = LAKE.x + Math.sin(f.a)*LAKE.R*.5, z = LAKE.z + Math.cos(f.a)*LAKE.R*.5;
      f.root.position.set(x, W - .95 + Math.sin(game.t*1.3)*.08, z); f.root.rotation.set(0, f.a + Math.PI/2, 0);
      f.x = x; f.z = z;
      if(!hidden && game.lock <= 0 && f.cd <= 0 && hd < LAKE.R + 7 && !blocked(LAKE.x, LAKE.z, hx, hz)){
        f.state = 'approche'; f.t = 0; f.sx = x; f.sz = z;
        f.ex = LAKE.x + (hx-LAKE.x)/hd*(LAKE.R-2.5); f.ez = LAKE.z + (hz-LAKE.z)/hd*(LAKE.R-2.5); game.spotted();
      }
    } else if(f.state === 'approche'){
      f.t += dt/.9; const k = Math.min(1, f.t), s = k*k*(3-2*k);
      const x = f.sx + (f.ex-f.sx)*s, z = f.sz + (f.ez-f.sz)*s;
      f.root.position.set(x, W - .95, z); f.root.rotation.set(0, Math.atan2(hx-x, hz-z), 0);
      if(k >= 1){ f.state = 'saut'; f.t = 0; f.sx = x; f.sz = z;
        const dd = Math.hypot(hx-x, hz-z) || .001, reach = Math.min(dd + 1, 12);
        f.tx = x + (hx-x)/dd*reach; f.tz = z + (hz-z)/dd*reach; }
    } else if(f.state === 'saut'){
      f.t += dt/1.15; const k = Math.min(1, f.t);
      const x = f.sx + (f.tx-f.sx)*k, z = f.sz + (f.tz-f.sz)*k, gy = Math.max(height(x, z), W);
      const y = (W - .95)*(1-k) + (gy + 1.1)*k + Math.sin(Math.PI*k)*5.5, yaw = Math.atan2(f.tx-f.sx, f.tz-f.sz);
      f.root.position.set(x, y, z); f.root.rotation.set(-Math.cos(Math.PI*k)*.9, yaw, 0);
      const mx = x + Math.sin(yaw)*3, mz = z + Math.cos(yaw)*3;
      if(k > .55 && Math.hypot(hx-mx, hz-mz) < 2.6 && y < height(hx, hz) + 4) game.catch('Le poisson masqué t’a avalé');
      if(k >= 1){ f.state = 'echoue'; f.t = 0; quake(x, z, .25, 40); }
    } else if(f.state === 'echoue'){
      f.t += dt; f.root.rotation.z = Math.sin(game.t*14)*.35*Math.max(0, 1 - f.t/1.6);
      if(f.t > 1.6){ f.state = 'retour'; f.t = 0; f.sx = f.root.position.x; f.sz = f.root.position.z; f.sy = f.root.position.y; }
    } else if(f.state === 'retour'){
      f.t += dt/1.4; const k = Math.min(1, f.t);
      const ex = LAKE.x + (f.sx-LAKE.x)*.3, ez = LAKE.z + (f.sz-LAKE.z)*.3;
      const x = f.sx + (ex-f.sx)*k, z = f.sz + (ez-f.sz)*k;
      f.root.position.set(x, f.sy + (W - .95 - f.sy)*k, z); f.root.rotation.set(.3*(1-k), Math.atan2(ex-f.sx, ez-f.sz), 0);
      if(k >= 1){ f.state = 'nage'; f.a = Math.atan2(x-LAKE.x, z-LAKE.z); f.cd = 2.5; }
    }
  }

  function updateGame(dt, hx, hz){
    game.t += dt;
    const hidden = !!inHut(hx, hz);
    for(const p of pigs) if(!p.village || Math.hypot(p.x - hx, p.z - hz) < 700) updatePig(p, dt, hx, hz, hidden);
    updateFish(dt, hx, hz, hidden);
    updateGiants(dt, hx, hz);
    if(game.lock > 0){
      game.lock -= dt;
      if(game.lock <= 2.6 && game.msg && !store.get().mange) store.set({ mange: game.msg });
      if(game.lock <= 0){ game.respawn = true; store.set({ mange:'' }); game.msg = ''; game.heroHidden = false; }
    }
    const chased = pigs.some(p => p.state === 'chasse') || fish.state === 'approche' || fish.state === 'saut' || !!game.stomper;
    let txt = '';
    if(game.stomper && game.lock <= 0) txt = 'Un titan veut t’écraser ! Sors de son ombre';
    else if(chased) txt = 'Repéré ! Fuis et cache-toi';
    else if(hidden) txt = 'Caché dans la case';
    else if(pigs.some(p => p.state === 'cherche')) txt = 'Ils te cherchent…';
    const et = store.get().etat;
    if(et.text !== txt || et.alerte !== chased) store.set({ etat: { text: txt, alerte: chased } });
  }
  function respawnBeasts(){
    pigs.forEach(p => { p.x = p.home[0]; p.z = p.home[1]; p.tx = p.x; p.tz = p.z; p.state = 'flane'; p.v = 0; });
    fish.state = 'nage'; fish.cd = 3;
    for(const s of live.values()){
      for(const J of s.titans){
        if(J.st && J.st.persist){ J.x = J.st.bx; J.z = J.st.bz; J.yaw = J.st.byaw; }
        if(J.grab) J.yaw = J.grab.yaw0;
        J.st = null; J.grab = null; J.ov = null; J.cd = 6;
      }
      s.grab = null;
    }
    game.stomper = null; marker.visible = false;
  }

  /* ================= Niveau 1 : rallumer le feu (trois morceaux de bois) ================= */
  const woodMat = new T.ShaderMaterial({ uniforms: U, vertexShader: stoneMat.vertexShader,
    fragmentShader: `
      precision highp float; varying vec3 vW; varying vec3 vN; uniform vec3 uSun, uSky, uCam; uniform float uTime;
      ${GRAIN}
      ${HAZE}
      void main(){
        float l = .55 + .55*max(dot(normalize(vN), uSun), 0.);
        float veine = vn(vec2(vW.y*38., (vW.x + vW.z)*2.5));
        vec3 c = mix(vec3(.34,.21,.11), vec3(.63,.43,.24), veine) * l + (grain()-.5)*.06;
        gl_FragColor = vec4(mix(c, uSky, haze(vW)), 1.);
      }` });
  const logGeo = new T.CylinderGeometry(.09, .1, .78, 10); logGeo.rotateZ(Math.PI/2);
  function makeWood(){
    const g = new T.Group();
    for(const [y, z, ry] of [[.1,-.1,.3],[.1,.12,-.4],[.27,0,1.2]]){ const m = new T.Mesh(logGeo, woodMat); m.position.set(0, y, z); m.rotation.y = ry; g.add(m); }
    g.scale.setScalar(1.25); g.traverse(o => o.frustumCulled = false); scene.add(g); return g;
  }
  const homeHut = obstacles.find(o => o.kind === 'hut');
  const level = { items: [], got: 0, done: false, elapsed: 0, fire: false, acc: 0 };
  {
    const a = Math.atan2(-LAKE.x, -LAKE.z) - 1.1, rr = LAKE.R - 1.1;
    const spots = [
      { label:'au bord du lac', x: LAKE.x + Math.sin(a)*rr, z: LAKE.z + Math.cos(a)*rr, float:true },
      { label:'chez les cochons', x: P(66, 4)[0], z: P(66, 4)[1] },
      { label:'dans le palais de l’œil gauche', x: FL(-480, 380)[0], z: FL(-480, 380)[1] },
    ];
    for(const s of spots){
      const it = Object.assign(s, { mesh: makeWood(), taken:false, phase: R7()*6 });
      if(s.float){ const pad = new T.Mesh(new T.CircleGeometry(.95, 24), leafMat); pad.rotation.x = -Math.PI/2; pad.position.set(s.x, LAKE.water + .03, s.z); scene.add(pad); }
      level.items.push(it);
    }
  }
  function hud(pop = false){
    const t = level.done ? 'Le feu de ta case brûle' :
      level.got < 3 ? `Rallume le feu de ta case · bois ${level.got}/3` : 'Rapporte le bois dans ta case';
    const st = store.get();
    if(st.obj !== t || pop) store.set({ obj: t, objPop: st.objPop + (pop ? 1 : 0) });
  }
  function resetLevel(){
    level.got = 0; level.done = false; level.elapsed = 0; level.fire = false;
    for(const it of level.items){ it.taken = false; it.mesh.visible = true; }
    hud();
  }
  let finTimer = 0;
  function updateLevel(dt, hx, hz){
    if(!level.done) level.elapsed += dt;
    for(const it of level.items){
      if(it.taken) continue;
      it.phase += dt;
      const gy = it.float ? LAKE.water + .05 : height(it.x, it.z);
      it.mesh.position.set(it.x, gy + .1 + Math.sin(it.phase*2)*.06, it.z); it.mesh.rotation.y += dt*.6;
      if(game.lock <= 0 && Math.hypot(hx - it.x, hz - it.z) < 1.7){
        it.taken = true; it.mesh.visible = false; level.got++; hud(true);
        if(audio.on) audio.boom(.25);
      }
    }
    if(!level.done && level.got >= 3 && inHut(hx, hz) === homeHut){
      level.done = true; level.fire = true; hud();
      const m = Math.floor(level.elapsed/60), s = Math.floor(level.elapsed % 60);
      finTimer = setTimeout(() => store.set({ fin: `Temps : ${m} min ${String(s).padStart(2,'0')} s` }), 1600);
    }
    if(level.fire){                       // petit feu orange au centre de la case
      level.acc += dt; const y0 = height(homeHut.x, homeHut.z), r = Math.random;
      while(level.acc > .03){ level.acc -= .03;
        emit(homeHut.x + (r()-.5)*.5, y0 + .15, homeHut.z + (r()-.5)*.5, (r()-.5)*.4, 1.4 + r()*1.4, (r()-.5)*.4, .5 + r()*.4, .8, .15, 1, .6, -1);
        if(r() < .2) emit(homeHut.x, y0 + 1.2, homeHut.z, (r()-.5)*.3, 1 + r(), (r()-.5)*.3, 3, .5, 2.5, .15, .2, -.2);
      }
    }
  }
  hud();

  /* ================= Contrôle du garçon (troisième personne) ================= */
  // ZQSD / WASD / flèches : se déplacer par rapport à la caméra · Maj : courir · glisser : tourner la caméra · molette : zoom
  let x = 0, z = 0, heroYaw = START_YAW, camYaw = START_YAW, camPitch = .16, camDist = 6, camY = height(0,0)+2;
  let walked = 0, boost = 1, rush = false, lastBuild = -1, curV = 0, runHold = false;
  const keys = {};
  const stick = { x:0, y:0 };
  const paused = () => { const s = store.get(); return s.spell || s.map || s.perso || !!s.fin; };
  function clearKeys(){ for(const k in keys) keys[k] = false; stick.x = stick.y = 0; }
  on(window, 'keydown', e => {
    const tag = e.target && e.target.tagName;
    if(tag === 'INPUT' || tag === 'TEXTAREA') return;
    if(store.get().intro) return;
    if(e.key === 'Escape'){ api.closeSpell(); api.closeMap(); return; }
    if(e.key.toLowerCase() === 't' && !paused()){ e.preventDefault(); api.openSpell(); return; }
    keys[e.key.toLowerCase()] = true;
    if(e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
  });
  on(window, 'keyup', e => { keys[e.key.toLowerCase()] = false; });
  on(window, 'blur', clearKeys);
  let drag = false, px = 0, py = 0;
  on(canvas, 'pointerdown', e => { drag = true; px = e.clientX; py = e.clientY; canvas.classList.add('drag'); canvas.setPointerCapture(e.pointerId); });
  on(canvas, 'pointermove', e => { if(!drag) return;
    camYaw -= (e.clientX-px)*0.005; camPitch = Math.max(-0.12, Math.min(1.1, camPitch + (e.clientY-py)*0.004)); px = e.clientX; py = e.clientY; });
  const endDrag = () => { drag = false; canvas.classList.remove('drag'); };
  on(canvas, 'pointerup', endDrag); on(canvas, 'pointercancel', endDrag);
  on(canvas, 'wheel', e => { e.preventDefault(); camDist = Math.max(2.5, Math.min(18, camDist * Math.pow(1.0015, e.deltaY))); }, { passive:false });

  /* ================= Le sort de téléportation et la carte ================= */
  const SPELL = 'Brume, ouvre la route';
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const SHORT = { regard:'Veilleurs', feu:'Feu', combat:'Combat', danse:'Danse', jeu:'Jeu', marche:'Marcheurs' };
  const clampR = r => Math.max(40, Math.min(220000, r));
  function mapView(name){
    if(name === 'proche') return { cx:x, cz:z, r:150 };
    if(name === 'village') return { cx:FACE.x, cz:FACE.z, r:1900 };
    const c = P(31000, 0); return { cx:c[0], cz:c[1], r:72000 };
  }
  function toScreen(W, v, wx, wz){
    const S = W/2*.92, dx = wx - v.cx, dz = wz - v.cz;
    return [W/2 + (dx*RGT[0] + dz*RGT[1])/v.r*S, W/2 - (dx*FWD[0] + dz*FWD[1])/v.r*S];
  }
  function toWorld(cv, v, sx, sy){
    const W = cv.width, S = W/2*.92, u = (sx - W/2)/S*v.r, w = -(sy - W/2)/S*v.r;
    return [v.cx + RGT[0]*u + FWD[0]*w, v.cz + RGT[1]*u + FWD[1]*w];
  }
  function niceLen(m){ const p = Math.pow(10, Math.floor(Math.log10(m))), f = m/p; return (f >= 5 ? 5 : f >= 2 ? 2 : 1)*p; }
  function drawMap(cv, v, hover){
    const g = cv.getContext('2d'), W = cv.width, d = W/(cv.clientWidth || W);
    const px = n => n*d, rad = m => m/v.r*W/2*.92, ts = (wx, wz) => toScreen(W, v, wx, wz);
    const inView = (sx, sy, m = 0) => sx > -m && sy > -m && sx < W + m && sy < W + m;
    g.fillStyle = '#ebe7df'; g.fillRect(0, 0, W, W);
    g.strokeStyle = 'rgba(22,21,20,.07)'; g.lineWidth = px(1);
    for(let i = 1; i < 8; i++){ const q = i*W/8; g.beginPath(); g.moveTo(q, 0); g.lineTo(q, W); g.moveTo(0, q); g.lineTo(W, q); g.stroke(); }
    const label = (t, sx, sy, col = '#3d3a35', size = 11) => { g.fillStyle = col; g.font = `${px(size)}px "IBM Plex Mono", monospace`; g.textAlign = 'center'; g.fillText(t, sx, sy); };
    const dot = (sx, sy, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(sx, sy, r, 0, 7); g.fill(); };
    const titan = (sx, sy, k = 1) => { g.fillStyle = '#161514'; g.beginPath(); g.ellipse(sx, sy - px(7*k), px(4*k), px(9*k), 0, 0, 7); g.fill();
      g.fillRect(sx - px(3*k), sy, px(1.5*k), px(7*k)); g.fillRect(sx + px(1.5*k), sy, px(1.5*k), px(7*k)); };
    let sx, sy;
    [sx, sy] = ts(LAKE.x, LAKE.z); dot(sx, sy, Math.max(px(3), rad(LAKE.R)), '#5f90b9');
    if(v.r < 400) label('lac', sx, sy + px(4), '#eef3f7');
    for(const o of obstacles){
      if(o.kind === 'rock' && v.r > 2500) continue;
      [sx, sy] = ts(o.x, o.z); if(!inView(sx, sy, rad(o.r) + 10)) continue;
      if(o.kind === 'rock') dot(sx, sy, Math.max(px(1.5), rad(o.r)), '#a7a29a');
      else {
        dot(sx, sy, Math.max(px(o.palace ? 2.5 : 1.2), rad(o.r)), '#2a2826');
        if(o.palace && rad(o.r) > px(14)) dot(sx, sy, rad(o.r)*.55, '#5e5a53');
        if(o === homeHut && v.r < 3000) label('ta case', sx, sy - Math.max(px(8), rad(o.r)) - px(5));
      }
    }
    if(v.r < 6000) for(const p of pigs){ [sx, sy] = ts(p.x, p.z); if(inView(sx, sy)) dot(sx, sy, px(p.state === 'chasse' ? 4.5 : 3.2)*(v.r < 600 ? 1.3 : 1), p.state === 'chasse' ? '#9a3b1c' : '#161514'); }
    const seen = new Set();
    for(const s of live.values()){
      seen.add(s.key);
      if(v.r < 26000){ for(const J of s.titans){ [sx, sy] = ts(J.x, J.z); if(inView(sx, sy, 20)) titan(sx, sy, .8); } }
      [sx, sy] = ts(s.x, s.z); if(!inView(sx, sy, 40)) continue;
      if(v.r >= 26000) titan(sx, sy);
      if(s.type === 'feu') dot(sx, sy + px(10), px(3.5), '#f07a1d');
      if(v.r > 2600) label(SHORT[s.type], sx, sy + px(s.type === 'feu' ? 26 : 20));
    }
    const cs = 650*K, i0 = Math.floor((v.cx - v.r*1.5)/cs), i1 = Math.floor((v.cx + v.r*1.5)/cs), j0 = Math.floor((v.cz - v.r*1.5)/cs), j1 = Math.floor((v.cz + v.r*1.5)/cs);
    if((i1 - i0)*(j1 - j0) < 400) for(let i = i0; i <= i1; i++) for(let j = j0; j <= j1; j++){
      const gs = gridSite(i, j); if(!gs || seen.has(gs.key)) continue;
      [sx, sy] = ts(gs.x, gs.z); if(!inView(sx, sy, 20)) continue;
      g.globalAlpha = .55; titan(sx, sy, .8); if(gs.type === 'feu') dot(sx, sy + px(8), px(3), '#f07a1d'); g.globalAlpha = 1;
      if(v.r > 2600) label(SHORT[gs.type], sx, sy + px(17), '#77726a', 10);
    }
    for(const c of curated) if(!seen.has(c.key)){ [sx, sy] = ts(c.x, c.z); if(inView(sx, sy, 20)){ titan(sx, sy); if(v.r > 2600) label(SHORT[c.type], sx, sy + px(20)); } }
    if(v.r > 900){ [sx, sy] = ts(0, 0); label('village', sx, sy + px(16));
      [sx, sy] = ts(FACE.x, FACE.z); if(v.r < 30000) label('Village-Visage', sx, sy - rad(1650) - px(8), '#161514', 12); }
    level.items.forEach((it, i) => { if(it.taken) return; [sx, sy] = ts(it.x, it.z); if(!inView(sx, sy)) return;
      g.fillStyle = '#8a5a30'; g.fillRect(sx - px(6), sy - px(6), px(12), px(12)); label('bois ' + (i+1), sx, sy - px(10), '#6b4423'); });
    [sx, sy] = ts(x, z);
    if(inView(sx, sy)){ dot(sx, sy, px(7), '#ebe7df'); dot(sx, sy, px(5), '#161514');
      const hx = Math.sin(heroYaw)*RGT[0] + Math.cos(heroYaw)*RGT[1], hy = Math.sin(heroYaw)*FWD[0] + Math.cos(heroYaw)*FWD[1];
      g.strokeStyle = '#161514'; g.lineWidth = px(2); g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + hx*px(14), sy - hy*px(14)); g.stroke();
      label('toi', sx, sy + px(20), '#161514'); }
    const L = niceLen(v.r*.45), txt = L >= 1000 ? (L/1000) + ' km' : L + ' m';
    g.fillStyle = 'rgba(235,231,223,.85)'; g.fillRect(0, W - px(40), rad(L) + px(40), px(40));
    g.fillStyle = '#161514'; g.fillRect(px(12), W - px(26), rad(L), px(2)); label(txt, px(12) + rad(L)/2, W - px(12));
    if(hover){ g.strokeStyle = '#161514'; g.lineWidth = px(1.5); g.beginPath(); g.arc(hover[0], hover[1], px(11), 0, 7); g.stroke();
      g.beginPath(); g.moveTo(hover[0] - px(17), hover[1]); g.lineTo(hover[0] + px(17), hover[1]); g.moveTo(hover[0], hover[1] - px(17)); g.lineTo(hover[0], hover[1] + px(17)); g.stroke(); }
  }

  /* ================= Guide du joueur ================= */
  const guide = { moved:false, acc:1 };
  const fmtD = d => d < 1000 ? Math.round(d) + ' m' : (d/1000).toFixed(d < 10000 ? 1 : 0).replace('.', ',') + ' km';
  function whereAmI(hx, hz){
    const hut = inHut(hx, hz);
    if(hut === homeHut) return 'Dans ta case';
    if(hut && hut.palace) return 'Dans un palais du Village-Visage';
    if(hut && hut.village) return 'Dans une case du Village-Visage';
    if(hut) return 'Dans une case du village';
    const du = (hx-FACE.x)*RGT[0] + (hz-FACE.z)*RGT[1], dw = (hx-FACE.x)*FWD[0] + (hz-FACE.z)*FWD[1];
    if((du/1350)**2 + (dw/1650)**2 < 1) return 'Dans les rues du Village-Visage';
    if(Math.hypot(hx-LAKE.x, hz-LAKE.z) < LAKE.R + 15) return 'Au bord du lac';
    const ph = P(64, 8); if(Math.hypot(hx-ph[0], hz-ph[1]) < 55) return 'Chez les cochons masqués';
    if(Math.hypot(hx, hz) < 70) return 'Au village, près de ta case';
    let best = null, bd = 1e12; for(const s of live.values()){ const d = Math.hypot(s.x-hx, s.z-hz); if(d < bd){ bd = d; best = s; } }
    if(best && bd < 9000) return 'Près de : ' + LABELS[best.type].toLowerCase();
    return 'Dans la plaine';
  }
  function updateGuide(dt, hx, hz){
    if(curV > .3) guide.moved = true;
    if((guide.acc += dt) < .2) return; guide.acc = 0;
    const TOUCH = store.get().touch;
    let tx = null, tz = null, tname = '';
    if(!level.done){
      if(level.got >= 3){ tx = homeHut.x; tz = homeHut.z; tname = 'ta case'; }
      else { let bd = 1e12; level.items.forEach((it, i) => { if(it.taken) return; const d = Math.hypot(it.x-hx, it.z-hz); if(d < bd){ bd = d; tx = it.x; tz = it.z; tname = 'bois ' + (i+1); } }); }
    }
    let dist = 0, compass = null;
    if(tx !== null){
      dist = Math.hypot(tx-hx, tz-hz);
      compass = { rot: -(Math.atan2(tx-hx, tz-hz) - camYaw), text: `${tname} · ${fmtD(dist)}` };
    }
    const lieu = whereAmI(hx, hz);
    const hut = inHut(hx, hz);
    const chased = pigs.some(p => p.state === 'chasse'), searching = pigs.some(p => p.state === 'cherche');
    const fishAlert = fish.state === 'approche' || fish.state === 'saut';
    let nearFire = false; for(const s of live.values()) if(s.type === 'feu' && Math.hypot(s.x-hx, s.z-hz) < 7000) nearFire = true;
    const sortKey = TOUCH ? 'bouton Sort' : 'touche T';
    let tip;
    if(level.done) tip = 'Bravo ! Le feu brûle dans ta case.';
    else if(game.lock > 0) tip = 'Tu as été attrapé… Retour au départ, tu gardes le bois déjà ramassé.';
    else if(game.stomper && !hut) tip = 'Un titan lève le pied sur toi : sors vite de l’ombre noire au sol, ou entre dans une case.';
    else if(fishAlert) tip = 'Le poisson masqué bondit ! Éloigne-toi de la rive en courant.';
    else if(chased) tip = `Une bête te poursuit : cours (${TOUCH ? 'bouton Courir' : 'Maj'}) et cache-toi derrière un rocher ou dans une case.`;
    else if(hut && searching) tip = 'Ils te cherchent dehors. Reste caché quelques secondes.';
    else if(nearFire) tip = 'Attention : trop près du grand feu, les titans vont t’attraper et t’y jeter. Fais demi-tour.';
    else if(!guide.moved) tip = TOUCH ? 'Pousse le joystick pour marcher, glisse l’écran pour tourner la caméra.' : 'Marche avec ZQSD ou les flèches, tourne la caméra en glissant la souris.';
    else if(level.got >= 3 && hut === homeHut) tip = 'Tu y es : le feu va se rallumer.';
    else if(level.got >= 3) tip = dist > 2000 ? `Tu as tout le bois ! Lance le sort (${sortKey}) et touche « ta case » sur la carte.` : 'Tu as tout le bois ! Suis la flèche jusqu’à ta case et entre par la porte.';
    else if(dist > 2000) tip = `Le ${tname} est loin : lance le sort de téléportation (${sortKey}), puis touche le carré marron sur la carte.`;
    else if(searching) tip = 'Ils te cherchent : reste derrière un rocher ou dans une case.';
    else if(Math.hypot(hx-LAKE.x, hz-LAKE.z) < LAKE.R + 10 && !level.items[0].taken) tip = 'Le poisson guette la rive. Attends qu’il nage de l’autre côté, puis prends le bois sur le nénuphar.';
    else if(hut && hut.palace) tip = 'Ici, personne ne te voit. Le bois est au centre du palais.';
    else if(lieu.includes('Village-Visage')) tip = 'Les bêtes rôdent dans les rues. Avance de case en case, et cours si l’une d’elles te voit.';
    else if(hut) tip = 'Caché : les bêtes et les titans ne peuvent pas te voir ici.';
    else tip = `Suis la flèche jusqu’au ${tname}. Ramasse-le en marchant dessus.`;
    const st = store.get();
    const patch = { compass };
    if(st.guide.lieu !== lieu || st.guide.tip !== tip) patch.guide = { lieu, tip };
    store.set(patch);
  }

  /* ================= Commandes envoyées par l'interface React ================= */
  const api = {
    SPELL,
    start(){ store.set({ intro:false }); },
    setLook(name){ setLook(name, false); store.set({ look:name }); },
    toggleRush(){ rush = !rush; store.set({ rush }); },
    toggleAudio(){ audio.toggle(); },
    setStick(sx, sy){ stick.x = sx; stick.y = sy; },
    setRun(v){ runHold = v; },
    openSpell(){ const s = store.get(); if(s.intro || paused()) return; clearKeys(); store.set({ spell:true }); },
    closeSpell(){ if(store.get().spell) store.set({ spell:false }); },
    castSpell(text){
      if(norm(text) !== norm(SPELL)) return false;
      clearKeys(); store.set({ spell:false, map:true }); return true;
    },
    closeMap(){ if(store.get().map) store.set({ map:false }); },
    teleport(wx, wz){
      [x, z] = resolveHero(wx, wz); curV = 0; boost = 1; camY = height(x, z) + 2.4;
      store.set({ map:false, flash: store.get().flash + 1 });
      dust(x, z, 7, 12, .5); if(audio.on) audio.boom(.4);
    },
    replay(){ store.set({ fin:null }); resetLevel(); game.respawn = true; },
    openPerso(){ const s = store.get(); if(s.intro || paused()) return; clearKeys(); store.set({ perso:true }); },
    closePerso(){ store.set({ perso:false }); },
    setHair({ style, size, color } = {}){
      const OLD = { courts:'petit', milongs:'moyen', longs:'grand' };          // anciens réglages sauvegardés
      if(style && OLD[style]){ size = size || OLD[style]; style = 'twists'; }
      if(style) hair.style = style;
      if(size) hair.size = size;
      if(color) hair.color = color;
      const h = { style: hair.style, size: hair.size, color: hair.color };
      store.set({ hair: h });
      try { localStorage.setItem('brume.hair', JSON.stringify(h)); } catch(e) {}
      applyHair();
    },
    setOutfit(patch){
      Object.assign(outfit, patch);
      const o = {}; for(const k in DEFAULT_OUTFIT) o[k] = outfit[k];
      store.set({ outfit: o });
      try { localStorage.setItem('brume.outfit', JSON.stringify(o)); } catch(e) {}
      applyOutfit();
    },
    setSkin(hex){
      if(hex){ heroMat.uniforms.uSkin.value.set(hex); heroMat.uniforms.uSkinOn.value = 1; }
      else heroMat.uniforms.uSkinOn.value = 0;
      store.set({ skin: hex || null });
      try { if(hex) localStorage.setItem('brume.skin', hex); else localStorage.removeItem('brume.skin'); } catch(e) {}
    },
    setPagne(hex){
      if(hex){ heroMat.uniforms.uPagne.value.set(hex); heroMat.uniforms.uPagneOn.value = 1; }
      else heroMat.uniforms.uPagneOn.value = 0;
      store.set({ pagne: hex || null });
      try { if(hex) localStorage.setItem('brume.pagne', hex); else localStorage.removeItem('brume.pagne'); } catch(e) {}
    },
    bubbleAnchor(){
      const v = new T.Vector3(x, height(x, z) + 1.75, z).project(camera), r = canvas.getBoundingClientRect();
      return { x:(v.x*.5 + .5)*r.width, y:(-v.y*.5 + .5)*r.height, w:r.width, h:r.height };
    },
    map: { view: mapView, clampR, draw: drawMap, toWorld, RGT, FWD },
    dispose(){
      cancelAnimationFrame(raf); clearTimeout(finTimer);
      cleanups.forEach(f => f()); audio.dispose(); renderer.dispose();
    },
  };

  function resize(){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w/h; camera.updateProjectionMatrix();
    U.uPx.value = h * renderer.getPixelRatio() / (2*Math.tan(camera.fov*Math.PI/360));
  }
  on(window, 'resize', resize);

  setLook('midi', true);
  try { const saved = localStorage.getItem('brume.pagne'); if(saved) api.setPagne(saved); } catch(e) {}
  try { const sk = localStorage.getItem('brume.skin'); if(sk) api.setSkin(sk); } catch(e) {}
  try { const h = JSON.parse(localStorage.getItem('brume.hair') || 'null'); if(h) api.setHair(h); } catch(e) {}
  try { const o = JSON.parse(localStorage.getItem('brume.outfit') || 'null'); if(o) api.setOutfit(o); } catch(e) {}
  resize();
  manageSites();

  let last = performance.now(), infoT = 0, siteT = 0, clock = 0, raf = 0;
  function frame(now){
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now-last)/1000); last = now;
    clock += dt;
    U.uTime.value = clock;
    easeLook(1 - Math.pow(0.02, dt));
    if(paused()){                       // le temps s'arrête pendant le sort, la carte et la personnalisation
      if(store.get().perso){            // la caméra tourne lentement autour du garçon pour le montrer
        camYaw += dt*.35;
        const hy = height(x, z), d = 3.1, bx = x - Math.sin(camYaw)*d, bz = z - Math.cos(camYaw)*d;
        camera.position.set(bx, hy + 1.45, bz); camera.lookAt(x, hy + .95, z);
        U.uCam.value.copy(camera.position); sky.position.copy(camera.position);
        hero.update(dt, 0);
      }
      renderer.render(scene, camera); return;
    }

    // direction voulue, relative à la caméra
    const k = n => keys[n] ? 1 : 0;
    const inF = k('z') + k('w') + k('arrowup') - k('s') - k('arrowdown') - stick.y;
    const inR = k('d') + k('arrowright') - k('q') - k('a') - k('arrowleft') + stick.x;
    const mag = Math.min(1, Math.hypot(inF, inR));
    const cfx = Math.sin(camYaw), cfz = Math.cos(camYaw);        // avant de la caméra
    const crx = -cfz, crz = cfx;                                  // droite de la caméra
    let target = 0;
    if(mag > .12 && !store.get().intro){
      const dx = cfx*inF + crx*inR, dz = cfz*inF + crz*inR;
      heroYaw += wrap(Math.atan2(dx, dz) - heroYaw) * (1 - Math.pow(.0005, dt));   // le garçon pivote en douceur vers sa direction
      const running = keys['shift'] || runHold || rush;
      target = (running ? RUN : WALK) * Math.max(mag, .35);
    }
    // Foncer : pour traverser la plaine jusqu'aux titans (montée progressive jusqu'à ~140 m/s)
    boost = (rush && target > 0) ? Math.min(60, Math.max(1, boost * Math.pow(1.6, dt) + dt*.5)) : Math.max(1, boost * Math.pow(.05, dt));
    curV += (target*boost - curV) * (1 - Math.pow(target > curV ? .02 : .0008, dt));
    if(target === 0 && curV < .02) curV = 0;
    if(game.lock > 0) curV = 0;
    const v = curV;
    const fx = Math.sin(heroYaw), fz = Math.cos(heroYaw);
    x += fx*v*dt; z += fz*v*dt; walked += v*dt;
    [x, z] = resolveHero(x, z);
    if(game.respawn){ game.respawn = false; x = 0; z = 0; heroYaw = camYaw = START_YAW; curV = 0; respawnBeasts(); }
    updateGame(dt, x, z);
    updateLevel(dt, x, z);
    updateGuide(dt, x, z);
    camX = x; camZ = z;

    // caméra en orbite autour du garçon, qui le suit sans à-coups
    const heroY = height(x, z);
    const cp = Math.cos(camPitch), d = camDist + Math.min(10, v*.02);
    const bx = x - cfx*cp*d, bz = z - cfz*cp*d;
    const wantY = Math.max(heroY + 1.2 + Math.sin(camPitch)*d, height(bx, bz) + .6);
    camY += (wantY - camY) * (1 - Math.pow(0.0005, dt));

    const cx = Math.round(x/STEP), cz = Math.round(z/STEP);
    if((cx !== cellX || cz !== cellZ) && clock - lastBuild > (v > 20 ? .12 : 0)){ cellX = cx; cellZ = cz; lastBuild = clock; rebuild(cx, cz); updateGrass(x, z); }

    if((siteT += dt) > .5){ siteT = 0; manageSites(); }
    for(const s of live.values()) updateSite(s, clock, dt);
    updateParticles(dt);

    // la terre tremble quand les titans frappent ou marchent près de vous
    const sh = shakeAmount(dt);
    const jx = (Math.sin(clock*41.3)+Math.sin(clock*23.7))*.5*sh, jy = (Math.sin(clock*37.1)+Math.sin(clock*19.3))*.5*sh;
    camera.position.set(bx + jx*.6, camY + jy*.5, bz);
    camera.lookAt(x + cfx*2 + jx*.15, heroY + 1.5 + jy*.2, z + cfz*2);
    camera.rotation.z += jx*.012;
    U.uCam.value.copy(camera.position);
    grass.material.uniforms.uHero.value.set(x, heroY, z);
    if(hero.obj){ hero.obj.position.set(x, heroY, z); hero.obj.rotation.y = heroYaw; hero.obj.visible = !game.heroHidden; }
    hero.update(dt, v);
    sky.position.copy(camera.position);

    if((infoT += dt) > .25){ infoT = 0;
      let best = null, bd = 1e9;
      for(const s of live.values()){ const dd = Math.hypot(s.x-x, s.z-z); if(dd < bd){ bd = dd; best = s; } }
      const fmt = dd => dd < 1000 ? Math.round(dd/10)*10 + ' m' : (dd/1000).toFixed(dd < 10000 ? 1 : 0).replace('.', ',') + ' km';
      const sceneTxt = best && bd < 1300*K ? `${best.label} · ${fmt(bd)}` : '';
      const infoTxt = 'Altitude ' + Math.round(height(x,z)+40) + ' m · ' + (walked/1000).toFixed(1).replace('.',',') + ' km parcourus';
      const st = store.get();
      if(st.scene !== sceneTxt || st.info !== infoTxt) store.set({ scene: sceneTxt, info: infoTxt });
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  return api;
}
