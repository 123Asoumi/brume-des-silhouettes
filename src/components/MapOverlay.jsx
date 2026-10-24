import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGame } from '../store.js';

const VIEWS = [['proche', 'Autour de toi'], ['village', 'Village-Visage'], ['univers', 'L’univers']];
let lastView = 'proche';

// carte de téléportation : glisser pour se déplacer, molette ou pincement pour zoomer, toucher pour s'y rendre
export function Carte({ engine }){
  const open = useGame(s => s.map);
  return open ? <CarteOuverte engine={engine} /> : null;
}

function CarteOuverte({ engine }){
  const [view, setView] = useState(lastView);
  const cv = useRef(null);
  const ms = useRef(engine.map.view(lastView));
  const hover = useRef(null), pts = useRef(new Map()), moved = useRef(0), pinch = useRef(null);
  const { RGT, FWD, clampR, toWorld } = engine.map;

  const draw = useCallback(() => { if(cv.current) engine.map.draw(cv.current, ms.current, hover.current); }, [engine]);
  const pt = e => { const c = cv.current, r = c.getBoundingClientRect(), k = c.width / r.width; return [(e.clientX - r.left)*k, (e.clientY - r.top)*k]; };

  useLayoutEffect(() => {
    const size = () => {
      const s = Math.max(240, Math.min(innerWidth - 40, innerHeight - 190, 720)), dpr = Math.min(devicePixelRatio || 1, 2), c = cv.current;
      c.style.width = c.style.height = s + 'px'; c.width = c.height = Math.round(s*dpr); draw();
    };
    size();
    addEventListener('resize', size);
    return () => removeEventListener('resize', size);
  }, [draw]);

  useEffect(() => {
    const c = cv.current;
    const wheel = e => {
      e.preventDefault();
      const q = pt(e), before = toWorld(c, ms.current, ...q);
      ms.current.r = clampR(ms.current.r * Math.pow(1.0018, e.deltaY));
      const after = toWorld(c, ms.current, ...q);
      ms.current.cx += before[0] - after[0]; ms.current.cz += before[1] - after[1]; draw();
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, [draw, clampR, toWorld]);

  const pick = name => { lastView = name; setView(name); ms.current = engine.map.view(name); draw(); };
  const zoom = f => { ms.current.r = clampR(ms.current.r * f); draw(); };

  const onDown = e => {
    cv.current.setPointerCapture(e.pointerId); pts.current.set(e.pointerId, pt(e));
    if(pts.current.size === 1) moved.current = 0;
    if(pts.current.size === 2){ const [a, b] = [...pts.current.values()]; pinch.current = { d: Math.hypot(a[0]-b[0], a[1]-b[1]) || 1, r: ms.current.r }; }
  };
  const onMove = e => {
    const q = pt(e), P = pts.current, m = ms.current; hover.current = q;
    if(P.has(e.pointerId)){
      const prev = P.get(e.pointerId); P.set(e.pointerId, q);
      if(P.size === 1){
        const S = cv.current.width/2*.92, du = (q[0]-prev[0])/S*m.r, dw = -(q[1]-prev[1])/S*m.r;
        m.cx -= RGT[0]*du + FWD[0]*dw; m.cz -= RGT[1]*du + FWD[1]*dw; moved.current += Math.hypot(q[0]-prev[0], q[1]-prev[1]);
      } else if(P.size === 2 && pinch.current){
        const [a, b] = [...P.values()]; m.r = clampR(pinch.current.r * pinch.current.d / (Math.hypot(a[0]-b[0], a[1]-b[1]) || 1)); moved.current += 999;
      }
    }
    draw();
  };
  const onUp = e => {
    const P = pts.current, had = P.has(e.pointerId); P.delete(e.pointerId);
    if(P.size < 2) pinch.current = null;
    if(had && e.type === 'pointerup' && P.size === 0 && moved.current < 8*(cv.current.width / cv.current.clientWidth)){
      const [wx, wz] = toWorld(cv.current, ms.current, ...pt(e)); engine.teleport(wx, wz);
    }
  };

  return (
    <div className="carte">
      <div className="carte-box">
        <div className="carte-top">
          <h2>Où veux-tu aller ?</h2>
          <div className="tabs">
            {VIEWS.map(([id, name]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => pick(id)}>{name}</button>)}
          </div>
          <div className="tabs">
            <button type="button" aria-label="Dézoomer" onClick={() => zoom(2)}>−</button>
            <button type="button" aria-label="Zoomer" onClick={() => zoom(.5)}>+</button>
          </div>
          <button className="carte-x" type="button" onClick={() => engine.closeMap()}>Fermer</button>
        </div>
        <canvas id="carte-c" ref={cv}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onPointerLeave={() => { hover.current = null; draw(); }} />
        <p className="carte-note">Glisse pour te déplacer, molette ou pincement pour zoomer. Touche un endroit : tu y seras téléporté.</p>
      </div>
    </div>
  );
}
