// Tenue et accessoires du héros, fabriqués par le code.
// · Vêtements (haut, manches) : découpés dans le corps lui-même puis légèrement décollés de la peau.
//   Ils gardent les poids de rigging du corps, donc ils suivent exactement chaque mouvement.
// · Bijoux et chaînes : petits objets accrochés aux os (poignets, chevilles, cou, tête).
import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const DEFAULT_OUTFIT = {
  top: 'aucun', sleeves: 'aucune', color: '#2c3e8f',
  bracelets: false, perles: false, collier: false, boucles: false, chaines: false,
};

const B = name => 'mixamorig' + name;

function bodyMesh(obj){ let m = null; obj.traverse(o => { if(o.isSkinnedMesh && !o.userData.garment) m = o; }); return m; }

/* ---------- mesures sur le corps ---------- */
// sommets du corps animés par certains os, exprimés dans le repère de l'os « into »
function pointsFor(mesh, names, minW, into){
  const bones = mesh.skeleton.bones, ids = new Set(names.map(n => bones.findIndex(b => b.name === B(n))).filter(i => i >= 0));
  const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const inv = new T.Matrix4().copy(into.matrixWorld).invert(), v = new T.Vector3(), out = [];
  for(let i = 0; i < pos.count; i++){
    let w = 0; for(let k = 0; k < 4; k++) if(ids.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
    if(w < minW) continue;
    v.fromBufferAttribute(pos, i); mesh.applyBoneTransform(i, v);
    out.push(v.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(inv));
  }
  return out;
}
// anneau autour d'un membre à la hauteur y (l'axe y de l'os suit le membre)
function ringAt(points, y, band){
  const sel = points.filter(p => Math.abs(p.y - y) < band);
  if(sel.length < 6) return null;
  let cx = 0, cz = 0; for(const p of sel){ cx += p.x; cz += p.z; } cx /= sel.length; cz /= sel.length;
  const d = sel.map(p => Math.hypot(p.x - cx, p.z - cz)).sort((a, b) => a - b);
  return { cx, cz, y, r: d[Math.floor(d.length*.85)] };
}
// directions du monde (haut, avant du personnage) dans le repère d'un os
function axesIn(bone, obj){
  const m3 = new T.Matrix3().setFromMatrix4(new T.Matrix4().copy(bone.matrixWorld).invert());
  const q = new T.Quaternion(); obj.getWorldQuaternion(q);
  return { up: new T.Vector3(0, 1, 0).applyMatrix3(m3).normalize(), fwd: new T.Vector3(0, 0, 1).applyQuaternion(q).applyMatrix3(m3).normalize() };
}

/* ---------- petites pièces (perles, anneaux) fusionnées en une géométrie colorée ---------- */
const hex = h => { const c = new T.Color(h); return [c.r, c.g, c.b]; };
function piece(geo, color, metal = 0){
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count, col = new Float32Array(n*4), [r, gg, b] = hex(color);
  for(let i = 0; i < n; i++){ col[i*4] = r; col[i*4+1] = gg; col[i*4+2] = b; col[i*4+3] = metal; }
  g.setAttribute('aCol', new T.BufferAttribute(col, 4));
  if(!g.attributes.uv) g.setAttribute('uv', new T.BufferAttribute(new Float32Array(n*2), 2));
  return g;
}
function bead(r, color, at){ const g = piece(new T.IcosahedronGeometry(r, 1), color); g.translate(at.x, at.y, at.z); return g; }
function hoop(R, tube, color, metal = 1){ return piece(new T.TorusGeometry(R, tube, 8, 32), color, metal); }

// anneaux (bracelets, chaînes) : le tore est couché dans le plan xz de l'os, centré sur le membre
function ringGeo(ring, R, tube, color, metal, dy = 0, sy = 1){
  const g = hoop(R, tube, color, metal); g.rotateX(Math.PI/2); g.scale(1, sy, 1); g.translate(ring.cx, ring.y + dy, ring.cz); return g;
}
function beadRing(ring, count, size, palette, dy = 0, k = 1.05){
  const parts = [];
  for(let i = 0; i < count; i++){
    const a = i/count*Math.PI*2;
    parts.push(bead(size, palette[i % palette.length], new T.Vector3(ring.cx + Math.cos(a)*ring.r*k, ring.y + dy, ring.cz + Math.sin(a)*ring.r*k)));
  }
  return parts;
}

/* ---------- vêtements découpés dans le corps ---------- */
function garment(mesh, pick, thick, mat){
  const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const map = new Int32Array(pos.count).fill(-1), P = [], N = [], SI = [], SW = [], REST = [];
  let n = 0;
  for(let i = 0; i < pos.count; i++){
    if(!pick(i)) continue;
    map[i] = n++;
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    P.push(x + nx*thick, y + ny*thick, z + nz*thick); N.push(nx, ny, nz); REST.push(x, y, z);
    for(let k = 0; k < 4; k++){ SI.push(si.getComponent(i, k)); SW.push(sw.getComponent(i, k)); }
  }
  const idx = g.index.array, I = [];
  for(let t = 0; t < idx.length; t += 3){
    const a = map[idx[t]], b = map[idx[t+1]], c = map[idx[t+2]];
    if(a >= 0 && b >= 0 && c >= 0) I.push(a, b, c);
  }
  if(!I.length) return null;
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
  geo.setAttribute('aRest', new T.Float32BufferAttribute(REST, 3));
  geo.setAttribute('skinIndex', new T.Uint16BufferAttribute(SI, 4));
  geo.setAttribute('skinWeight', new T.Float32BufferAttribute(SW, 4));
  geo.setIndex(I);
  const sm = new T.SkinnedMesh(geo, mat);
  sm.userData.garment = true; sm.frustumCulled = false;
  sm.position.copy(mesh.position); sm.quaternion.copy(mesh.quaternion); sm.scale.copy(mesh.scale);   // même place que le corps
  sm.bind(mesh.skeleton, mesh.bindMatrix);
  return sm;
}

/* ---------- construction de toute la tenue ---------- */
export function buildOutfit(obj, outfit, mats){
  const mesh = bodyMesh(obj);
  if(!mesh) return [];
  obj.updateMatrixWorld(true);
  const made = [];   // { node, parent }
  const bones = mesh.skeleton.bones, bone = n => bones.find(b => b.name === B(n));
  const idOf = n => bones.findIndex(b => b.name === B(n));
  const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const W = (i, names) => { let w = 0; for(let k = 0; k < 4; k++){ const id = si.getComponent(i, k); if(names.has(id)) w += sw.getComponent(i, k); } return w; };
  const set = (...n) => new Set(n.map(idOf).filter(i => i >= 0));
  const TORSO = set('Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder'), HIPS = set('Hips');
  const NECK = set('Neck', 'Head'), ARMS = set('LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand');
  const FORE = set('LeftForeArm', 'RightForeArm'), UPPER = set('LeftArm', 'RightArm'), HANDS = set('LeftHand', 'RightHand');
  const hipsY = bone('Hips').position.y, waist = hipsY + .02;

  // ---- haut ----
  const torso = i => {
    const y = pos.getY(i);
    return (W(i, TORSO) >= .5 || (W(i, HIPS) >= .5 && y > waist)) && W(i, NECK) < .3 && W(i, ARMS) < .4;
  };
  if(outfit.top !== 'aucun'){
    let pick = torso, kind = 0, thick = .006;
    if(outfit.top === 'harnais'){
      kind = 1; thick = .008;
      pick = i => { if(!torso(i)) return false;
        const x = pos.getX(i), y = pos.getY(i), c = hipsY + .16;
        return Math.abs(x - .95*(y - c)) < .022 || Math.abs(x + .95*(y - c)) < .022 || Math.abs(y - (hipsY + .05)) < .016; };
    } else if(outfit.top === 'gilet'){
      kind = 2; thick = .007;
      pick = i => torso(i) && !(pos.getZ(i) > 0 && Math.abs(pos.getX(i)) < .022 + Math.max(0, pos.getY(i) - waist)*.22);
    }
    const sm = garment(mesh, pick, thick, mats.garment(kind, outfit.color));
    if(sm) made.push({ node: sm, parent: mesh.parent });
  }
  // ---- manches ----
  if(outfit.sleeves !== 'aucune'){
    const longues = outfit.sleeves === 'longues';
    const pick = i => longues ? (W(i, FORE) + W(i, UPPER) >= .5 && W(i, HANDS) < .4) : (W(i, FORE) >= .55 && W(i, HANDS) < .3);
    const sm = garment(mesh, pick, longues ? .006 : .008, mats.garment(longues ? 4 : 3, outfit.color));
    if(sm) made.push({ node: sm, parent: mesh.parent });
  }

  const parts = {};   // os → liste de géométries
  const add = (b, geos) => { if(!b) return; (parts[b.uuid] ||= { bone: b, geos: [] }).geos.push(...[].concat(geos)); };

  // ---- poignets : bracelets et chaînes ----
  for(const side of ['Left', 'Right']){
    const fore = bone(side + 'ForeArm'), hand = bone(side + 'Hand');
    if(!fore || !hand) continue;
    const L = hand.position.length(), pts = pointsFor(mesh, [side + 'ForeArm', side + 'Hand'], .4, fore);
    const wrist = ringAt(pts, L*.9, L*.06), cuffRing = ringAt(pts, L*.8, L*.07);
    if(outfit.bracelets && wrist){
      add(fore, [ringGeo(wrist, wrist.r*1.08, wrist.r*.07, '#c9a24a', 1, -L*.02),
                 ringGeo(wrist, wrist.r*1.1, wrist.r*.06, '#b06a3b', 1, -L*.06),
                 ringGeo(wrist, wrist.r*1.13, wrist.r*.07, '#c9a24a', 1, -L*.1)]);
    }
    if(outfit.chaines && cuffRing){
      const r = cuffRing.r, iron = '#9a958c', geos = [ringGeo(cuffRing, r*1.22, r*.25, iron, 1, 0, 2.1)];   // acier usé, clair pour ressortir sur la peau
      // maillons d'une chaîne brisée qui pendent du bracelet de fer
      const ax = new T.Vector3(cuffRing.cx, 0, cuffRing.cz).normalize().multiplyScalar(r*1.3);
      for(let k = 0; k < 8; k++){
        const link = hoop(r*.4, r*.1, iron, 1);
        link.scale(1, 1.5, 1);
        if(k % 2) link.rotateY(Math.PI/2);
        link.translate(cuffRing.cx + ax.x, cuffRing.y + r*.7 + k*r*.72, cuffRing.cz + ax.z);
        geos.push(link);
      }
      add(fore, geos);
    }
  }
  // ---- perles : à la taille et aux chevilles ----
  if(outfit.perles){
    const spine = bone('Spine'), hips = bone('Hips');
    if(spine && hips){
      const pts = pointsFor(mesh, ['Hips', 'Spine'], .4, hips);
      const y0 = (bone('Spine').position.y)*.55, w = ringAt(pts, y0, .012);
      if(w){
        const pal1 = ['#b8322a', '#efe8da', '#b8322a', '#d9b23a'], pal2 = ['#2c3e8f', '#efe8da', '#1f8a8a'];
        add(hips, [...beadRing(w, 46, w.r*.045, pal1, 0, 1.04), ...beadRing(w, 44, w.r*.04, pal2, .014, 1.03)]);
      }
    }
    for(const side of ['Left', 'Right']){
      const leg = bone(side + 'Leg'), foot = bone(side + 'Foot');
      if(!leg || !foot) continue;
      const L = foot.position.length(), pts = pointsFor(mesh, [side + 'Leg'], .5, leg), a = ringAt(pts, L*.86, L*.05);
      if(a) add(leg, beadRing(a, 22, a.r*.14, ['#efe8da', '#b8322a', '#efe8da', '#d9b23a'], 0, 1.08));
    }
  }
  // ---- collier de perles et cauris ----
  if(outfit.collier){
    const neck = bone('Neck');
    if(neck){
      const pts = pointsFor(mesh, ['Neck', 'Spine2'], .4, neck), base = ringAt(pts, .004, .012);
      if(base){
        const { up, fwd } = axesIn(neck, obj), right = new T.Vector3().crossVectors(up, fwd).normalize();
        const R = base.r*1.12, geos = [], center = new T.Vector3(base.cx, base.y, base.cz), N = 34;
        for(let i = 0; i < N; i++){
          const a = i/N*Math.PI*2, dir = new T.Vector3().addScaledVector(right, Math.cos(a)).addScaledVector(fwd, Math.sin(a));
          const front = Math.max(0, Math.sin(a)), sag = Math.pow(front, 1.6)*R*1.3;
          const p = center.clone().addScaledVector(dir, R*(1 + front*.35)).addScaledVector(up, -sag);
          const cowrie = front > .9 && i % 2 === 0;
          if(cowrie){ const c = piece(new T.SphereGeometry(R*.11, 10, 8), '#f1ead8'); c.scale(1, 1.5, .8); c.translate(p.x, p.y, p.z); geos.push(c); }
          else geos.push(bead(R*.07, ['#b8322a', '#d9b23a', '#2a2826'][i % 3], p));
        }
        add(neck, geos);
      }
    }
  }
  // ---- boucles d'oreilles ----
  if(outfit.boucles && mats.head){
    const h = mats.head, geos = [];
    for(const s of [-1, 1]){
      const p = h.center.clone().addScaledVector(h.right, s*h.rR*.98).addScaledVector(h.up, -h.rU*.42).addScaledVector(h.fwd, -h.rF*.06);
      const ring = hoop(h.rR*.13, h.rR*.022, '#c9a24a', 1);
      ring.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), h.right));
      ring.translate(p.x, p.y - h.rR*.12, p.z);
      geos.push(ring, bead(h.rR*.035, '#b8322a', p.clone().addScaledVector(h.up, -h.rR*.25)));
    }
    add(h.bone, geos);
  }
  for(const k in parts){
    const { bone: b, geos } = parts[k];
    const m = new T.Mesh(mergeGeometries(geos), mats.jewel);
    m.frustumCulled = false;
    made.push({ node: m, parent: b });
  }
  for(const { node, parent } of made) parent.add(node);
  return made;
}

export function disposeOutfit(made){
  for(const { node, parent } of made){ parent.remove(node); node.geometry.dispose(); if(node.userData.garment) node.material.dispose(); }
}
