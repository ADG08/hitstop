# Hitstop

Jeu de combat 2D en ligne, jouable dans le navigateur, avec une IA entraînée par auto-jeu.

**Statut :** en développement. Jouable à deux en local ou en ligne (M3) : serveur autoritaire, rollback, reconnexion automatique.

## Prérequis

- Node.js 24
- pnpm 12
- Docker (pour PostgreSQL et Redis)

## Démarrer

```bash
pnpm install
pnpm dev           # serveur de jeu + client : http://localhost:5173
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

## Jouer en ligne

« Créer un salon en ligne » donne un code (ex. `K7QF`) et un lien à envoyer ; l'autre joueur ouvre le lien ou saisit le code. Pour essayer en mauvaises conditions : ajouter `?latency=150&jitter=20&loss=0.05` à l'adresse (latence = aller-retour ajouté, en ms). Une coupure de connexion est rattrapée automatiquement (30 s).

## Structure

```
packages/sim       simulation déterministe, partagée par le client, le serveur et l'entraînement
packages/protocol  messages et netcode partagés (confirmation serveur, prédiction et rollback client)
apps/server        serveur de jeu (Fastify, WebSocket)
apps/web           client navigateur (Vite, PixiJS, React)
infra/             Docker Compose
tools/biome/       règle de lint : pas d'opération non déterministe dans la simulation
```

## Licence

[MIT](LICENSE)
