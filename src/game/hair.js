// Coiffure de twists (vanilles torsadées) générée par le code et accrochée à l'os de la tête.
// Chaque mèche part du cuir chevelu et se compose de deux brins enroulés l'un autour de l'autre jusqu'aux pointes.
import * as T from 'three';

// trois tailles par coiffure : petit / moyen / grand
export const HAIR = {
  twists: {
    petit: { len: .5,  count: 190, gravity: .18, width: .085 },
    moyen: { len: 1.05, count: 170, gravity: .6, width: .078 },
    grand: { len: 1.8, count: 160, gravity: .85, width: .072 },
  },
  locs: {
    petit: { len: .8,  count: 120, gravity: .55, width: .115, locs: true },
    moyen: { len: 1.5, count: 120, gravity: .8,  width: .11,  locs: true },
    grand: { len: 2.5, count: 115, gravity: 1.0, width: .105, locs: true },
  },
  afro: {
    petit: { volume: .38 },
    moyen: { volume: .72 },
    grand: { volume: 1.15 },
  },
};

// mesure la tête du personnage (dans le repère de l'os de la tête) à partir des sommets qu'elle anime
export function fitHead(obj){
  obj.updateMatrixWorld(true);
  let mesh = null; obj.traverse(o => { if(o.isSkinnedMesh) mesh = o; });
  if(!mesh) return null;
  const bones = mesh.skeleton.bones;
  const bone = bones.find(b => /Head$/.test(b.name)) || bones.find(b => /Head/.test(b.name));
  if(!bone) return null;
  const ids = new Set(bones.map((b, i) => /Head/.test(b.name) ? i : -1).filter(i => i >= 0));
  const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const inv = new T.Matrix4().copy(bone.matrixWorld).invert();
  const m3 = new T.Matrix3().setFromMatrix4(inv);
  const up = new T.Vector3(0, 1, 0).applyMatrix3(m3).normalize();
  const fwd = new T.Vector3(0, 0, 1).applyMatrix3(m3).normalize();
  const right = new T.Vector3().crossVectors(up, fwd).normalize();
  fwd.crossVectors(right, up).normalize();
  const pts = [], v = new T.Vector3();
  for(let i = 0; i < pos.count; i++){
    let w = 0; for(let k = 0; k < 4; k++) if(ids.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
    if(w < .6) continue;
    v.fromBufferAttribute(pos, i); mesh.applyBoneTransform(i, v);
    pts.push(v.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(inv));
  }
  if(pts.length < 50) return null;
  const range = axis => { let lo = Infinity, hi = -Infinity; for(const p of pts){ const d = p.dot(axis); if(d < lo) lo = d; if(d > hi) hi = d; } return [lo, hi]; };
  const [ul, uh] = range(up), [fl, fh] = range(fwd), [rl, rh] = range(right);
  // le crâne : on prend le haut de la tête (sans le menton) pour l'ellipsoïde
  const rU = (uh - ul)*.42, rF = (fh - fl)*.5, rR = (rh - rl)*.5;
  const center = new T.Vector3()
    .addScaledVector(up, uh - rU*1.0)
    .addScaledVector(fwd, (fh + fl)/2 - rF*.06)
    .addScaledVector(right, (rh + rl)/2);
  return { bone, up, fwd, right, center, rU, rF, rR };
}

function rng(seed){ let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; }; }

const line = df => -.14 + .42*Math.max(df, 0) - .38*Math.max(-df, 0);   // ligne d'implantation : front haut, côtés et nuque plus bas

export function buildHair(head, style, size = 'moyen'){
  const st = HAIR[style] && HAIR[style][size];
  if(!head || !st) return null;
  if(style === 'afro') return buildAfro(head, st.volume);
  const { up, fwd, right, center, rU, rF, rR } = head;
  const R = rng(1234 + style.length*7 + size.length);
  const unit = (rU + rF + rR)/3;
  const L = st.len*unit, W = st.width*unit, SR = W*.62;
  const S = st.len < .6 ? 8 : st.len > 2 ? 16 : 12, RAD = st.locs ? 7 : 5;
  const positions = [], normals = [], along = [], index = [];
  const onSkull = (du, df, dr, k = 1) => new T.Vector3().copy(center)
    .addScaledVector(up, du*rU*k).addScaledVector(fwd, df*rF*k).addScaledVector(right, dr*rR*k);
  // racines réparties sur le crâne (spirale de Fibonacci), au-dessus de la ligne d'implantation
  const roots = [], M = st.count*2.4;
  for(let i = 0; i < M && roots.length < st.count; i++){
    const yy = 1 - (i + .5)/M*2, rr = Math.sqrt(1 - yy*yy), th = i*2.39996;
    const du = yy, df = Math.cos(th)*rr, dr = Math.sin(th)*rr;
    if(du < line(df)) continue;
    if(Math.abs(dr) > .8 && du < .12 && df > -.5) continue;            // dégage les oreilles
    roots.push([du, df, dr]);
  }
  const tmp = new T.Vector3(), ref = new T.Vector3();
  for(const [du, df, dr] of roots){
    const p = onSkull(du, df, dr, .96);
    const n = new T.Vector3().addScaledVector(up, du/rU).addScaledVector(fwd, df/rF).addScaledVector(right, dr/rR).normalize();
    const len = L*(.8 + R()*.4), grav = st.gravity*(.8 + R()*.4), turns = len/(W*3.3), phase = R()*6.28;
    // chemin de la mèche : elle sort du crâne puis retombe avec la gravité
    const path = [p.clone()], dir = n.clone();
    // mèches longues du front : elles partent vers l'arrière dès la racine pour dégager le visage
    if(df > .1 && (st.locs || st.len > .9)) dir.addScaledVector(fwd, -1.4*df).addScaledVector(up, .35).normalize();
    for(let s = 1; s <= S; s++){
      const t = s/S;
      dir.addScaledVector(up, -grav*(.55 + .6*t)).addScaledVector(n, .08*(1 - t)).addScaledVector(fwd, -(st.locs ? .7 : .22)*Math.max(df, 0)*(1 - .5*t)).normalize();   // les mèches retombent ; celles du front partent vers l'arrière
      const q = path[s-1].clone().addScaledVector(dir, len/S);
      // pas de mèche qui rentre dans la tête
      const lu = tmp.copy(q).sub(center).dot(up)/rU, lf = tmp.copy(q).sub(center).dot(fwd)/rF, lr = tmp.copy(q).sub(center).dot(right)/rR;
      const e = Math.hypot(lu, lf, lr);
      if(e < 1.08) q.copy(onSkull(lu/e, lf/e, lr/e, 1.08));
      path.push(q);
    }
    for(let k = 0; k < (st.locs ? 1 : 2); k++){
      const base = positions.length/3;
      for(let s = 0; s <= S; s++){
        const t = s/S, c = path[s];
        const tg = new T.Vector3().subVectors(path[Math.min(S, s+1)], path[Math.max(0, s-1)]).normalize();
        ref.copy(Math.abs(tg.dot(up)) > .9 ? fwd : up);
        const nn = new T.Vector3().crossVectors(tg, ref).normalize(), bb = new T.Vector3().crossVectors(tg, nn).normalize();
        const a = phase + t*turns*Math.PI*2 + k*Math.PI, taper = 1 - .4*t;
        let sc, sr;
        if(st.locs){   // une loc : un seul cordon épais, un peu bosselé, au bout arrondi
          sc = c; sr = W*.55*(1 - .18*t)*(1 + .1*Math.sin(t*23 + phase*3))*(s === S ? .55 : 1);
        } else {
          sc = c.clone().addScaledVector(nn, Math.cos(a)*W*.5*taper).addScaledVector(bb, Math.sin(a)*W*.5*taper);
          sr = SR*(s === S ? .45 : taper);
        }
        for(let j = 0; j < RAD; j++){
          const b = j/RAD*Math.PI*2, ox = Math.cos(b), oy = Math.sin(b);
          const nx = nn.x*ox + bb.x*oy, ny = nn.y*ox + bb.y*oy, nz = nn.z*ox + bb.z*oy;
          positions.push(sc.x + nx*sr, sc.y + ny*sr, sc.z + nz*sr); normals.push(nx, ny, nz); along.push(t);
        }
      }
      for(let s = 0; s < S; s++) for(let j = 0; j < RAD; j++){
        const a0 = base + s*RAD + j, a1 = base + s*RAD + (j+1)%RAD, b0 = a0 + RAD, b1 = a1 + RAD;
        index.push(a0, b0, a1, a1, b0, b1);
      }
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aAlong', new T.Float32BufferAttribute(along, 1));
  geo.setIndex(index);
  return geo;
}

// calotte sombre sous les mèches, pour que le crâne ne se voie pas entre elles
export function buildCap(head){
  const { up, fwd, right, center, rU, rF, rR } = head;
  const geo = new T.SphereGeometry(1, 28, 14, 0, Math.PI*2, 0, 1.35);
  geo.applyMatrix4(new T.Matrix4().makeRotationX(-.3));            // plus bas à l'arrière, plus haut au front
  const m = new T.Matrix4().makeBasis(right.clone().multiplyScalar(rR*1.01), up.clone().multiplyScalar(rU*1.01), fwd.clone().multiplyScalar(rF*1.01));
  m.setPosition(center);
  geo.applyMatrix4(m);
  return geo;
}

// afro : un grand volume arrondi autour du crâne, à la surface bouclée, qui dégage le visage
function hash3(x, y, z){ const h = Math.sin(x*127.1 + y*311.7 + z*74.7)*43758.5453; return h - Math.floor(h); }
function vnoise(x, y, z){
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx*fx*(3-2*fx), v = fy*fy*(3-2*fy), w = fz*fz*(3-2*fz);
  const L = (a, b, t) => a + (b - a)*t;
  return L(L(L(hash3(ix,iy,iz), hash3(ix+1,iy,iz), u), L(hash3(ix,iy+1,iz), hash3(ix+1,iy+1,iz), u), v),
           L(L(hash3(ix,iy,iz+1), hash3(ix+1,iy,iz+1), u), L(hash3(ix,iy+1,iz+1), hash3(ix+1,iy+1,iz+1), u), v), w);
}
function buildAfro(head, vol){
  const { up, fwd, right, center, rU, rF, rR } = head;
  const geo = new T.SphereGeometry(1, 128, 96);
  const pos = geo.attributes.position, along = new Float32Array(pos.count);
  for(let i = 0; i < pos.count; i++){
    const dr = pos.getX(i), du = pos.getY(i), df = pos.getZ(i);
    // plein volume au-dessus de la ligne d'implantation, collé au crâne (donc caché) en dessous
    const h = du - line(df);
    const s = Math.min(1, Math.max(0, (h + .06)/.12)), k = s*s*(3 - 2*s);                 // bord net à la ligne des cheveux
    const g = Math.min(1, Math.max(0, h/.75)), grow = Math.sqrt(g);                      // le volume monte en douceur : forme ronde
    const lift = 1 + vol*grow*(.95 + .3*Math.max(du, 0) + .12*Math.max(-df, 0));
    const coil = vnoise(dr*7, du*7, df*7)*.45 + vnoise(dr*19, du*19, df*19)*.35 + vnoise(dr*47, du*47, df*47)*.2;   // boucles serrées
    const r = (1 - k)*.93 + k*(lift + (coil - .5)*(.12 + .22*vol)*grow + .02);
    along[i] = k*(.15 + coil);
    const p = new T.Vector3().copy(center)
      .addScaledVector(right, dr*rR*r).addScaledVector(up, du*rU*r + k*grow*vol*rU*.12).addScaledVector(fwd, df*rF*r - k*grow*vol*rF*.1);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.setAttribute('aAlong', new T.BufferAttribute(along, 1));
  geo.computeVertexNormals();
  return geo;
}
