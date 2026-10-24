import { useGame } from '../store.js';

export function Cartel(){
  const scene = useGame(s => s.scene), info = useGame(s => s.info), credit = useGame(s => s.credit);
  return (
    <div className="cartel">
      <p className="scene">{scene}</p>
      <h1>Plaines</h1>
      <p>{info}</p>
      {credit && <p>Musique : Ballaké Sissoko · Nalesonko (live)</p>}
    </div>
  );
}

export function Objectif(){
  const text = useGame(s => s.obj), pop = useGame(s => s.objPop);
  return <p key={pop} className={'obj' + (pop ? ' pop' : '')}>{text}</p>;
}

export function Boussole(){
  const c = useGame(s => s.compass);
  if(!c) return null;
  return (
    <div className="boussole">
      <span className="fleche" style={{ transform: `rotate(${c.rot}rad)` }} />
      <span>{c.text}</span>
    </div>
  );
}

export function Etat(){
  const e = useGame(s => s.etat);
  if(!e.text) return null;
  return <p className={'etat' + (e.alerte ? ' alerte' : '')}>{e.text}</p>;
}

export function Guide(){
  const g = useGame(s => s.guide);
  if(!g.tip) return null;
  return (
    <div className="guide" aria-live="polite">
      <p className="lieu">{g.lieu}</p>
      <p className="conseil">{g.tip}</p>
    </div>
  );
}
