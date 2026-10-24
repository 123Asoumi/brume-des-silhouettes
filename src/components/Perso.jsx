import { useState } from 'react';
import { useGame } from '../store.js';

const PAGNES = [
  [null, 'D’origine', '#e9e4da'], ['#2c3e8f', 'Indigo', '#2c3e8f'], ['#b8322a', 'Rouge', '#b8322a'],
  ['#c98a2b', 'Ocre', '#c98a2b'], ['#2f7a4b', 'Vert', '#2f7a4b'], ['#1f8a8a', 'Turquoise', '#1f8a8a'],
  ['#6b3a8c', 'Violet', '#6b3a8c'], ['#d9b23a', 'Or', '#d9b23a'], ['#2a2826', 'Noir', '#2a2826'],
];
const COIFFURES = [['aucune', 'Rasé'], ['twists', 'Twists'], ['afro', 'Afro'], ['locs', 'Locs']];
const TAILLES = {
  twists: [['petit', 'Courts'], ['moyen', 'Mi-longs'], ['grand', 'Longs']],
  locs:   [['petit', 'Courtes'], ['moyen', 'Mi-longues'], ['grand', 'Longues']],
  afro:   [['petit', 'Petit'], ['moyen', 'Moyen'], ['grand', 'Grand']],
};
const CHEVEUX = [['#1d1714', 'Noir'], ['#3b2a20', 'Brun'], ['#5a3a24', 'Châtain'], ['#6e2f1e', 'Auburn'], ['#a9823c', 'Doré'], ['#8f8b86', 'Gris']];
const HAUTS = [['aucun', 'Torse nu'], ['tunique', 'Tunique de guerrier'], ['harnais', 'Harnais de cuir'], ['gilet', 'Gilet de chasseur']];
const MANCHES = [['aucune', 'Sans'], ['bandes', 'Bandes de cuir'], ['longues', 'Manches longues']];
const TENUES = [['#2c3e8f', 'Indigo'], ['#8e2b22', 'Rouge sombre'], ['#b07a2a', 'Ocre'], ['#3f5a2c', 'Kaki'], ['#2a2826', 'Noir'], ['#e7e0d2', 'Écru']];
const BIJOUX = [['bracelets', 'Bracelets'], ['perles', 'Perles de taille et chevilles'], ['collier', 'Collier de cauris'], ['boucles', 'Boucles d’oreilles'], ['chaines', 'Chaînes brisées']];

function Choix({ items, value, onPick, label }){
  return (
    <div className="tailles" role="group" aria-label={label}>
      {items.map(([id, name]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onPick(id)}>{name}</button>)}
    </div>
  );
}

export function Perso({ engine }){
  const open = useGame(s => s.perso), pagne = useGame(s => s.pagne), hair = useGame(s => s.hair), outfit = useGame(s => s.outfit);
  const [tab, setTab] = useState('corps');
  if(!open) return null;
  const custom = pagne && !PAGNES.some(([h]) => h === pagne);
  return (
    <div className="perso" role="dialog" aria-label="Personnaliser le personnage">
      <p className="k">Ton personnage</p>
      <div className="onglets" role="tablist">
        {[['corps', 'Corps'], ['tenue', 'Tenue'], ['bijoux', 'Bijoux']].map(([id, name]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}>{name}</button>
        ))}
      </div>

      {tab === 'corps' && <>
        <h2>Coiffure</h2>
        <div className="nuancier">
          {COIFFURES.map(([id, name]) => (
            <button key={id} type="button" className="nuance texte" aria-pressed={hair.style === id} onClick={() => engine.setHair({ style: id })}>{name}</button>
          ))}
        </div>
        {TAILLES[hair.style] && <Choix label={hair.style === 'afro' ? 'Volume' : 'Longueur'} items={TAILLES[hair.style]} value={hair.size} onPick={id => engine.setHair({ size: id })} />}
        {hair.style !== 'aucune' && (
          <div className="pastilles" role="group" aria-label="Couleur des cheveux">
            {CHEVEUX.map(([h, name]) => (
              <button key={h} type="button" className="pastille" aria-pressed={hair.color === h} aria-label={name} title={name}
                style={{ background: h }} onClick={() => engine.setHair({ color: h })} />
            ))}
          </div>
        )}
        <h2>Pagne</h2>
        <div className="nuancier">
          {PAGNES.map(([h, name, swatch]) => (
            <button key={name} type="button" className="nuance" aria-pressed={pagne === h} onClick={() => engine.setPagne(h)}>
              <span style={{ background: swatch }} />{name}
            </button>
          ))}
          <label className="nuance libre" data-on={custom || undefined}>
            <input type="color" value={pagne || '#2c3e8f'} onChange={e => engine.setPagne(e.target.value)} aria-label="Choisir une autre couleur" />
            <span style={{ background: custom ? pagne : 'conic-gradient(#b8322a, #d9b23a, #2f7a4b, #1f8a8a, #2c3e8f, #6b3a8c, #b8322a)' }} />
            Autre
          </label>
        </div>
      </>}

      {tab === 'tenue' && <>
        <h2>Haut</h2>
        <div className="nuancier">
          {HAUTS.map(([id, name]) => (
            <button key={id} type="button" className="nuance texte" aria-pressed={outfit.top === id} onClick={() => engine.setOutfit({ top: id })}>{name}</button>
          ))}
        </div>
        <h2>Manches</h2>
        <Choix label="Manches" items={MANCHES} value={outfit.sleeves} onPick={id => engine.setOutfit({ sleeves: id })} />
        <h2>Couleur de la tenue</h2>
        <div className="pastilles" role="group" aria-label="Couleur de la tenue">
          {TENUES.map(([h, name]) => (
            <button key={h} type="button" className="pastille" aria-pressed={outfit.color === h} aria-label={name} title={name}
              style={{ background: h }} onClick={() => engine.setOutfit({ color: h })} />
          ))}
        </div>
      </>}

      {tab === 'bijoux' && <>
        <h2>Accessoires</h2>
        <div className="coches">
          {BIJOUX.map(([id, name]) => (
            <button key={id} type="button" className="coche" aria-pressed={!!outfit[id]} onClick={() => engine.setOutfit({ [id]: !outfit[id] })}>
              <span aria-hidden="true" />{name}
            </button>
          ))}
        </div>
      </>}

      <p className="note">Tes choix sont gardés pour tes prochaines parties.</p>
      <button type="button" className="ok" onClick={() => engine.closePerso()}>Terminé</button>
    </div>
  );
}
