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

export function Perso({ engine }){
  const open = useGame(s => s.perso), pagne = useGame(s => s.pagne);
  if(!open) return null;
  const custom = pagne && !COULEURS.some(([hex]) => hex === pagne);
  return (
    <div className="perso" role="dialog" aria-label="Personnaliser le personnage">
      <p className="k">Ton personnage</p>
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
      <p className="note">Ton choix est gardé pour tes prochaines parties.</p>
      <button type="button" className="ok" onClick={() => engine.closePerso()}>Terminé</button>
    </div>
  );
}
