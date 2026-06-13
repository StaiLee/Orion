# Orion

**Orion est un SOC (Security Operations Center) réimaginé en cosmos vivant.**
Là où les concurrents affichent des tableaux et des paquets réseau, Orion montre un ciel
où chaque actif est un corps céleste, chaque flux une trajectoire, chaque menace une
comète ou un astéroïde qui fonce. La couche cosmos est le différenciateur ; le SOC
en dessous est un **vrai** outil de supervision, utile et opérable.

## North star (toute décision se juge à cette aune)

Un vrai SOC **utile** + une **lentille cosmos** qui sort de la concurrence + **modulaire**
+ **déploiement très simple** (objectif : commercialisable).

> Principe directeur : **le cosmos est une lentille, jamais du bruit.** Chaque objet
> céleste correspond 1:1 à un primitive de sécurité lisible en une seconde.

## Architecture (3 couches découplées par un contrat unique)

```
 Sources sécu  ──►  INGESTION  ──►  [ Modèle de Domaine Orion ]  ──►  RENDU cosmos
 (logs/SIEM/      (normalise)        Body · Flux · Event · Zone     (Three.js / Canvas)
  Suricata/sim)                      ▲ LE CONTRAT UNIQUE ▲
```

Le **Modèle de Domaine Orion** (`Body`, `Flux`, `Event`, `Zone`) est le seul vocabulaire
partagé. Le rendu ne lit jamais de donnée brute ; l'ingestion ne fait jamais de rendu.
Conséquence : on change de source de données ou de moteur de rendu sans toucher au reste.
C'est ce qui rend Orion modulaire et déployable.

## Skills du projet (dans `.claude/skills/`)

- **`orion-cosmology`** — source de vérité : le Modèle de Domaine + lore (sécu↔cosmos),
  échelle de sévérité, états des corps, mapping MITRE ATT&CK. **À lire avant tout mapping.**
- **`orion-viz`** — rendu frontend (Three.js/WebGL, instancing, LOD, pooling, fallback 2D,
  mode analyste). Le renderer consomme uniquement le Modèle de Domaine.
- **`orion-ingest`** — adapters sources + normalisation vers Orion + simulateur rejouable.
- **`orion-workflow`** — rythme de session et quels skills ECC enchaîner.

## Phase courante

**Simulation d'abord.** On bâtit et on règle le visuel sur du faux trafic réaliste
(adapter `sim`, scénarios d'attaque scriptés, seed déterministe) avant de brancher des
sources réelles. Le simulateur produit les mêmes objets Orion que les sources réelles —
donc tout ce qui est réglé en sim marche tel quel en prod.

## Stack

- Rendu : **Three.js / WebGL** recommandé (manipulation 3D, profondeur), derrière une
  abstraction `RendererAdapter` permettant un fallback Canvas 2D pour clients légers.
  Décision 2D/3D non définitivement figée — voir `orion-viz`.
- Backend/ingestion : à définir ; viser un déploiement simple (conteneur, config 1 fichier,
  démarre sur l'adapter `sim` pour une démo instantanée).

## Conventions

- Toute nouvelle correspondance sécu↔céleste s'ajoute d'abord dans `orion-cosmology`,
  puis se propage à `orion-ingest` et `orion-viz`.
- `id` des corps stables et dérivés de l'identité réseau (`host-<ip>`) — jamais aléatoires.
- Toujours un chemin vers la donnée brute (mode analyste / tooltip) : la métaphore
  n'efface jamais l'IP, le port, la règle, la technique ATT&CK.
