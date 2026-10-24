// État partagé entre le moteur 3D et l'interface React.
// Le moteur écrit (objectif, guide, alertes…), React lit et se redessine seulement quand une valeur change.
import { useSyncExternalStore } from 'react';

function createStore(initial){
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch){
      let changed = false;
      for(const k in patch) if(state[k] !== patch[k]){ changed = true; break; }
      if(!changed) return;
      state = { ...state, ...patch };
      subs.forEach(f => f());
    },
    subscribe(f){ subs.add(f); return () => subs.delete(f); },
  };
}

const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export const store = createStore({
  intro: true, spell: false, map: false, fin: null,
  obj: '', objPop: 0,
  guide: { lieu: '', tip: '' }, compass: null,
  etat: { text: '', alerte: false },
  mange: '', flash: 0,
  scene: '', info: '',
  audioOn: false, audioLoading: false, credit: false,
  rush: false, look: 'midi',
  perso: false, pagne: null,
  touch: isTouch,
});

export const useGame = select => useSyncExternalStore(store.subscribe, () => select(store.get()));
