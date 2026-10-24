import { useGame } from '../store.js';

// couleurs de pagne proposées ; « D'origine » garde le blanc cassé du modèle
const COULEURS = [
  [null, 'D’origine', '#e9e4da'],
  ['#2c3e8f', 'Indigo', '#2c3e8f'],
  ['#b8322a', 'Rouge', '#b8322a'],
  ['#c98a2b', 'Ocre', '#c98a2b'],
  ['#2f7a4b', 'Vert', '#2f7a4b'],
  ['#1f8a8a', 'Turquoise', '#1f8a8a'],
  ['#6b3a8c', 'Violet', '#6b3a8c'],
  ['#d9b23a', 'Or', '#d9b23a'],
  ['#2a2826', 'Noir', '#2a2826'],
];

const COIFFURES = [['aucune', 'Rasé'], ['twists', 'Twists'], ['afro', 'Afro'], ['locs', 'Locs']];
const TAILLES = {
  twists: [['petit', 'Courts'], ['moyen', 'Mi-longs'], ['grand', 'Longs']],
  locs:   [['petit', 'Courtes'], ['moyen', 'Mi-longues'], ['grand', 'Longues']],
  afro:   [['petit', 'Petit'], ['moyen', 'Moyen'], ['grand', 'Grand']],
};
const CHEVEUX = [['#1d1714', 'Noir'], ['#3b2a20', 'Brun'], ['#5a3a24', 'Châtain'], ['#6e2f1e', 'Auburn'], ['#a9823c', 'Doré'], ['#8f8b86', 'Gris']];

export function Perso({ engine }){
  const open = useGame(s => s.perso), pagne = useGame(s => s.pagne), hair = useGame(s => s.hair);
  if(!open) return null;
  const custom = pagne && !COULEURS.some(([hex]) => hex === pagne);
  return (
    <div className="perso" role="dialog" aria-label="Personnaliser le personnage">
      <p className="k">Ton personnage</p>
      <h2>Coiffure</h2>
      <div className="nuancier">
        {COIFFURES.map(([id, name]) => (
          <button key={id} type="button" className="nuance texte" aria-pressed={hair.style === id} onClick={() => engine.setHair({ style: id })}>{name}</button>
        ))}
      </div>
      {TAILLES[hair.style] && (
        <div className="tailles" role="group" aria-label={hair.style === 'afro' ? 'Volume' : 'Longueur'}>
          <span>{hair.style === 'afro' ? 'Volume' : 'Longueur'}</span>
          {TAILLES[hair.style].map(([id, name]) => (
            <button key={id} type="button" aria-pressed={hair.size === id} onClick={() => engine.setHair({ size: id })}>{name}</button>
          ))}
        </div>
      )}
      {hair.style !== 'aucune' && (
        <div className="pastilles" role="group" aria-label="Couleur des cheveux">
          {CHEVEUX.map(([hex, name]) => (
            <button key={hex} type="button" className="pastille" aria-pressed={hair.color === hex} aria-label={name} title={name}
              style={{ background: hex }} onClick={() => engine.setHair({ color: hex })} />
          ))}
        </div>
      )}
      <h2>Couleur du pagne</h2>
      <div className="nuancier">
        {COULEURS.map(([hex, name, swatch]) => (
          <button key={name} type="button" className="nuance" aria-pressed={pagne === hex} onClick={() => engine.setPagne(hex)}>
            <span style={{ background: swatch }} />
            {name}
          </button>
        ))}
        <label className="nuance libre" data-on={custom || undefined}>
          <input type="color" value={pagne || '#2c3e8f'} onChange={e => engine.setPagne(e.target.value)} aria-label="Choisir une autre couleur" />
          <span style={{ background: custom ? pagne : 'conic-gradient(#b8322a, #d9b23a, #2f7a4b, #1f8a8a, #2c3e8f, #6b3a8c, #b8322a)' }} />
          Autre
        </label>
      </div>
      <p className="note">Tes choix sont gardés pour tes prochaines parties.</p>
      <button type="button" className="ok" onClick={() => engine.closePerso()}>Terminé</button>
    </div>
  );
}
