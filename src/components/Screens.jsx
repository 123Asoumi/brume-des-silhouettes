import { useGame } from '../store.js';

export function Mange(){
  const msg = useGame(s => s.mange);
  if(!msg) return null;
  return <div className="mange"><p>{msg}</p><span>Retour au départ…</span></div>;
}

export function Flash(){
  const n = useGame(s => s.flash);
  return <div key={n} className={'flash' + (n ? ' go' : '')} />;
}

export function Intro({ engine }){
  const open = useGame(s => s.intro), touch = useGame(s => s.touch);
  if(!open) return null;
  return (
    <div className="carton">
      <div>
        <p className="k">Niveau 1</p>
        <h2>Rallumer le feu</h2>
        <p>Le feu de ta case s’est éteint pendant la nuit. Rapporte trois morceaux de bois : un au bord du lac, un chez les cochons masqués, et le dernier dans le palais de l’œil gauche du Village-Visage, au pied des titans. Ses rues grouillent de bêtes masquées.</p>
        <p className="small">Pour aller loin, lance le sort de téléportation : {touch ? 'bouton Sort' : 'bouton Sort, ou touche T'}.</p>
        <button type="button" onClick={() => engine.start()}>Commencer</button>
      </div>
    </div>
  );
}

export function Fin({ engine }){
  const time = useGame(s => s.fin);
  if(!time) return null;
  return (
    <div className="carton">
      <div>
        <p className="k">Niveau 1 terminé</p>
        <h2>Le village dormira au chaud ce soir</h2>
        <p>{time}</p>
        <button type="button" onClick={() => engine.replay()}>Rejouer</button>
      </div>
    </div>
  );
}
