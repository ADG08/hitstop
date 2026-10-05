# Hitstop

Jeu de combat 2D en ligne, jouable dans le navigateur, avec une IA entraînée par auto-jeu.

**Statut :** en développement. Jouable à deux en local (M2) : un personnage, 8 actions, 2 manches gagnantes, clavier ou manettes.

## Prérequis

- Node.js 22 (≥ 22.12)
- pnpm 12
- Docker (pour PostgreSQL et Redis)

## Démarrer

```bash
pnpm install
pnpm dev           # le jeu sur http://localhost:5173
pnpm test          # tests
pnpm e2e           # tests navigateur (Chromium, Firefox, WebKit)
pnpm typecheck     # vérification des types
pnpm check         # lint et formatage (Biome)
pnpm db:up         # PostgreSQL + pgvector et Redis en local
pnpm db:down       # arrêt
```

## Contrôles

| | Joueur 1 | Joueur 2 |
|---|---|---|
| Déplacements | Z Q S D (AZERTY) / W A S D (QWERTY) | Flèches |
| Coup léger / lourd | F / G | 1 / 2 (pavé numérique) |

Manettes acceptées (croix ou stick gauche, A/X léger, B/Y lourd). Garde : maintenir arrière. Projectile : bas, bas-avant, avant + coup. Ruée : bas, bas-arrière, arrière + coup. **F2** affiche les boîtes de collision et l'état de la simulation.

## Structure

```
packages/sim       simulation déterministe, partagée par le client, le serveur et l'entraînement
packages/protocol  types partagés (messages réseau)
apps/web           client navigateur (Vite, PixiJS)
infra/             Docker Compose
tools/biome/       règle de lint : pas d'opération non déterministe dans la simulation
```

## Licence

[MIT](LICENSE)
