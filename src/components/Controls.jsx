import { useRef, useState } from 'react';
import { useGame } from '../store.js';

const LOOKS = [['aube', 'Aube'], ['midi', 'Midi'], ['soir', 'Soir']];

export function Lum({ engine }){
  const look = useGame(s => s.look), rush = useGame(s => s.rush);
  const audioOn = useGame(s => s.audioOn), loading = useGame(s => s.audioLoading);
  return (
    <div className="lum" role="group" aria-label="Lumière et son">
      {LOOKS.map(([id, name]) => (
        <button key={id} type="button" aria-pressed={look === id} onClick={() => engine.setLook(id)}>{name}</button>
      ))}
      <span className="sep" />
      <button type="button" onClick={() => engine.openSpell()}>Sort</button>
      <button type="button" aria-pressed={rush} onClick={() => engine.toggleRush()}>Foncer</button>
      <button type="button" aria-pressed={audioOn} onClick={() => engine.toggleAudio()}>{loading ? 'Kora · chargement' : 'Kora'}</button>
    </div>
  );
}

// joystick tactile
export function Stick({ engine }){
  const ref = useRef(null), knob = useRef(null), id = useRef(null);
  const intro = useGame(s => s.intro);
  const move = e => {
    const r = ref.current.getBoundingClientRect(), R = r.width/2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const m = Math.hypot(dx, dy); if(m > R){ dx *= R/m; dy *= R/m; }
    knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    engine.setStick(dx/R, dy/R);
  };
  const end = e => {
    if(e.pointerId !== id.current) return;
    id.current = null; knob.current.style.transform = ''; engine.setStick(0, 0);
  };
  return (
    <div className="stick" ref={ref} aria-hidden="true"
      onPointerDown={e => { if(intro) return; id.current = e.pointerId; ref.current.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={e => { if(e.pointerId === id.current) move(e); }}
      onPointerUp={end} onPointerCancel={end}>
      <div className="knob" ref={knob} />
    </div>
  );
}

// bouton Courir (à maintenir)
export function Courir({ engine }){
  const [on, setOn] = useState(false);
  const set = v => { setOn(v); engine.setRun(v); };
  return (
    <button type="button" className={'courir' + (on ? ' on' : '')}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); set(true); }}
      onPointerUp={() => set(false)} onPointerCancel={() => set(false)}
      onContextMenu={e => e.preventDefault()}>
      Courir
    </button>
  );
}
