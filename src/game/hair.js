// Coiffure de twists (vanilles torsadées) générée par le code et accrochée à l'os de la tête.
// Chaque mèche part du cuir chevelu et se compose de deux brins enroulés l'un autour de l'autre jusqu'aux pointes.
import * as T from 'three';

export const HAIR_STYLES = {
  aucune:  null,
  courts:  { len: .5,  count: 190, gravity: .18, width: .085 },
  milongs: { len: 1.05, count: 170, gravity: .6, width: .078 },
  longs:   { len: 1.8, count: 160, gravity: .85, width: .072 },
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

export function buildHair(head, styleName){
  const st = HAIR_STYLES[styleName];
  if(!head || !st) return null;
  const { up, fwd, right, center, rU, rF, rR } = head;
  const R = rng(1234 + styleName.length);
  const unit = (rU + rF + rR)/3;
  const L = st.len*unit, W = st.width*unit, SR = W*.62;
  const S = styleName === 'courts' ? 8 : 12, RAD = 5;
  const positions = [], normals = [], along = [], index = [];
  const onSkull = (du, df, dr, k = 1) => new T.Vector3().copy(center)
    .addScaledVector(up, du*rU*k).addScaledVector(fwd, df*rF*k).addScaledVector(right, dr*rR*k);
  // racines réparties sur le crâne (spirale de Fibonacci), au-dessus de la ligne d'implantation
  const roots = [], M = st.count*2.4;
  for(let i = 0; i < M && roots.length < st.count; i++){
    const yy = 1 - (i + .5)/M*2, rr = Math.sqrt(1 - yy*yy), th = i*2.39996;
    const du = yy, df = Math.cos(th)*rr, dr = Math.sin(th)*rr;
    const line = -.14 + .42*Math.max(df, 0) - .38*Math.max(-df, 0);   // front haut, côtés et nuque plus bas
    if(du < line) continue;
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
    for(let s = 1; s <= S; s++){
      const t = s/S;
      dir.addScaledVector(up, -grav*(.55 + .6*t)).addScaledVector(n, .08*(1 - t)).addScaledVector(fwd, -.22*Math.max(df, 0)).normalize();   // les mèches retombent ; celles du front partent vers l'arrière
      const q = path[s-1].clone().addScaledVector(dir, len/S);
      // pas de mèche qui rentre dans la tête
      const lu = tmp.copy(q).sub(center).dot(up)/rU, lf = tmp.copy(q).sub(center).dot(fwd)/rF, lr = tmp.copy(q).sub(center).dot(right)/rR;
      const e = Math.hypot(lu, lf, lr);
      if(e < 1.08) q.copy(onSkull(lu/e, lf/e, lr/e, 1.08));
      path.push(q);
    }
    for(let k = 0; k < 2; k++){
      const base = positions.length/3;
      for(let s = 0; s <= S; s++){
        const t = s/S, c = path[s];
        const tg = new T.Vector3().subVectors(path[Math.min(S, s+1)], path[Math.max(0, s-1)]).normalize();
        ref.copy(Math.abs(tg.dot(up)) > .9 ? fwd : up);
        const nn = new T.Vector3().crossVectors(tg, ref).normalize(), bb = new T.Vector3().crossVectors(tg, nn).normalize();
        const a = phase + t*turns*Math.PI*2 + k*Math.PI, taper = 1 - .4*t;
        const sc = c.clone().addScaledVector(nn, Math.cos(a)*W*.5*taper).addScaledVector(bb, Math.sin(a)*W*.5*taper);
        const sr = SR*(s === S ? .45 : taper);
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
