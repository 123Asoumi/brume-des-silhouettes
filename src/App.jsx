import { useEffect, useRef, useState } from 'react';
import { createEngine } from './game/engine.js';
import { store, useGame } from './store.js';
import { Cartel, Objectif, Boussole, Etat, Guide } from './components/Hud.jsx';
import { Lum, Stick, Courir } from './components/Controls.jsx';
import { Bulle } from './components/Spell.jsx';
import { Carte } from './components/MapOverlay.jsx';
import { Mange, Flash, Intro, Fin } from './components/Screens.jsx';
import { Perso } from './components/Perso.jsx';

export default function App(){
  const canvasRef = useRef(null);
  const [engine, setEngine] = useState(null);
  const touch = useGame(s => s.touch);

  useEffect(() => { document.documentElement.classList.toggle('touch', touch); }, [touch]);

  useEffect(() => {
    const e = createEngine(canvasRef.current, store);
    setEngine(e);
    return () => { e.dispose(); setEngine(null); };
  }, []);

  return (
    <>
      <canvas id="c" ref={canvasRef} />
      {engine && (
        <>
          <Cartel />
          <Objectif />
          <Boussole />
          <Etat />
          <Guide />
          <Lum engine={engine} />
          {touch && <Stick engine={engine} />}
          {touch && <Courir engine={engine} />}
          <Bulle engine={engine} />
          <Carte engine={engine} />
          <Perso engine={engine} />
          <Mange />
          <Flash />
          <Intro engine={engine} />
          <Fin engine={engine} />
        </>
      )}
    </>
  );
}
