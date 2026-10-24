import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store.js';

// bulle du sort de téléportation, accrochée au-dessus de la tête du garçon
export function Bulle({ engine }){
  const open = useGame(s => s.spell);
  return open ? <BulleOuverte engine={engine} /> : null;
}

function BulleOuverte({ engine }){
  const ref = useRef(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let id;
    const follow = () => {
      const a = engine.bubbleAnchor(), el = ref.current;
      if(el){
        el.style.left = Math.max(150, Math.min(a.w - 150, a.x)) + 'px';
        el.style.top = Math.max(190, a.y) + 'px';
      }
      id = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(id);
  }, [engine]);

  return (
    <div className="bulle" ref={ref}>
      <button className="bulle-x" type="button" aria-label="Fermer" onClick={() => engine.closeSpell()}>×</button>
      <p className="bulle-k">Écris le sort pour te téléporter</p>
      <p className="bulle-sort">« {engine.SPELL} »</p>
      <input
        autoFocus type="text" autoComplete="off" autoCapitalize="off" spellCheck={false}
        placeholder="écris le sort ici…" aria-label="Sort" value={value}
        onChange={e => { setValue(e.target.value); setError(false); engine.castSpell(e.target.value); }}
        onKeyDown={e => {
          if(e.key === 'Escape'){ e.preventDefault(); engine.closeSpell(); }
          if(e.key === 'Enter'){ e.preventDefault(); if(!engine.castSpell(value)) setError(true); }
        }}
      />
      {error && <p className="bulle-err">Ce n’est pas tout à fait ça. Réessaie.</p>}
    </div>
  );
}
