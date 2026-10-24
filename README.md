# Brume des Silhouettes

Monde 3D en noir et blanc : un petit garçon en pagne traverse des plaines peuplées de titans aux masques africains, fuit les bêtes masquées et se cache derrière les rochers ou dans les cases. Niveau 1 : rallumer le feu de sa case.

## Lancer le projet

```bash
npm install
npm run dev      # développement sur http://localhost:5173
npm run build    # version de production dans dist/
```

## Organisation

- `src/game/engine.js` — moteur 3D (three.js) : relief, titans, Village-Visage, bêtes, héros, niveau, carte.
- `src/game/audio.js` — vent, grondements et musique de fond.
- `src/store.js` — état partagé entre le moteur et l'interface.
- `src/components/` — interface React : guide, boussole, sort, carte, écrans de début et de fin, commandes tactiles.
- `public/` — personnage (`hero.json`, `hero.jpg`) et musique (`nalesonko.mp3`, Ballaké Sissoko, *Nalesonko* live).

Déployé sur Vercel à chaque push sur `main`.
