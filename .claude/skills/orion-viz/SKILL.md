---
name: orion-viz
description: Conventions de rendu de la carte cosmos Orion — renderer découplé qui ne consomme QUE le Modèle de Domaine Orion, Three.js/WebGL recommandé (InstancedMesh, Points, LOD, object pooling) avec abstraction permettant un fallback Canvas 2D, animations d'événements sécurité en phénomènes célestes, perf à grande échelle (milliers de corps), et mode analyste. À utiliser pour tout travail frontend de visualisation Orion.
origin: Orion
---

# Orion — Rendu du Cosmos (Frontend Viz)

Comment dessiner le cosmos Orion : performant, modulaire, beau, et **honnête**
(chaque pixel veut dire quelque chose). Respecte le lore figé dans `orion-cosmology`.

## Principe : le rendu est un consommateur pur

Le moteur de rendu ne connaît **que** le Modèle de Domaine Orion (`Body`, `Flux`,
`Event`, `Zone`). Il ne fait aucune requête, ne parse aucun log, n'a aucune logique
sécu. Il reçoit un flux d'événements normalisés et un état, et il dessine. Ce
découplage est ce qui rend Orion vendable et embarquable chez n'importe quel client.

```
[ store d'état Orion ] ──► RendererAdapter ──► écran
        ▲
   WebSocket/SSE d'Events Orion (voir orion-ingest)
```

## Stack recommandée

- **Primaire : Three.js (WebGL)** — vraie 3D, profondeur, manipulation (orbit/pan/zoom),
  shaders pour les halos/traînées. C'est le différenciateur visuel.
- **Abstraction `RendererAdapter`** : une interface (`mount`, `upsertBody`, `removeBody`,
  `drawFlux`, `spawnEvent`, `setBodyStatus`, `tick`) implémentée par `ThreeRenderer` et,
  si besoin, `Canvas2DRenderer`. Le reste de l'app ne dépend que de l'interface → on peut
  livrer une version 2D légère pour clients à faible GPU sans réécrire la logique.
- **Framework UI** : libre (React/Svelte/vanilla), mais le canvas vit **hors** du cycle
  de re-render du framework (impératif), seul le HUD/overlay est déclaratif.

## Architecture en couches (z-order)

1. **Starfield** — fond statique en parallaxe (purement décoratif, assumé). `Points`.
2. **Zones** — halos doux délimitant les systèmes solaires (segments réseau).
3. **Bodies** — corps célestes (actifs). `InstancedMesh` + sprites à distance (LOD).
4. **Flux** — trajectoires/orbites entre corps. Lignes + traînées (trails).
5. **Events** — phénomènes transitoires (comètes, astéroïdes, supernovae). Pool d'objets.
6. **HUD / overlay** — couche data déclarative (labels, panneau analyste, légende).

## Performance (objectif : des milliers de corps fluides à 60 fps)

- **`InstancedMesh`** pour les corps : un seul draw call pour tous les `Body` d'un type.
  Couleur/taille via `instanceColor` et matrices d'instance.
- **`Points` / sprites** pour les corps lointains (LOD) et le starfield.
- **Object pooling** pour les `Event` transitoires (comètes/astéroïdes) : on recycle, on
  n'alloue jamais dans la boucle de rendu. Cap dur sur le nombre de particules simultanées.
- **Frustum culling** + ne mettre à jour que les corps visibles.
- **Budget de frame** : `requestAnimationFrame` avec un budget ms ; au-delà, on dégrade
  (moins de particules, traînées plus courtes) au lieu de laguer.
- **Pas de re-création** d'objets/géométries au runtime — préallouer au mount.
- Throttle des updates d'état entrantes (coalescer les `Event` en rafale).

## Mapping événement → animation

La table canonique vit dans `orion-cosmology`. Côté rendu, chaque `Event.cosmic` a une
animation pré-câblée :

| `cosmic` | Animation |
|---|---|
| étoile lointaine (info) | apparition discrète d'un point pâle, pas de mouvement |
| météore (low) | streak rapide cyan, fade < 1s |
| comète (medium) | trajectoire courbe + traînée suivie jusqu'à la cible |
| astéroïde (high) | trajectoire d'impact orange vers le `Body` cible, le corps rougeoie |
| supernova (critical) | flash blanc→rouge + onde de choc radiale + alerte HUD |
| trou noir (exfiltration) | vortex sortant qui aspire des particules de masse du corps |

Les transitions de `status` d'un `Body` sont **interpolées** (lerp de couleur/halo) sur
quelques centaines de ms : un `nominal → compromised` rougit progressivement.

## Modularité commerciale

- Le composant racine `<OrionCosmos>` prend en entrée : (a) une URL/abonnement d'`Event`
  Orion (WS/SSE), (b) un snapshot d'état initial. **Zéro** couplage au backend.
- Thématisation : palette et `constellation` injectables (white-label par client).
- Embarquable : doit pouvoir tourner en `<iframe>` ou web component isolé.

## Mode analyste & accessibilité

- Toggle **« mode data »** : révèle labels (hostname/IP), ports, technique ATT&CK,
  règle déclenchée — superposés aux corps. Le SOC reste opérable même sans la métaphore.
- Tout `Event`/`Body` est cliquable → panneau latéral avec le `raw` d'origine.
- Respecter `prefers-reduced-motion` : couper traînées/parallaxe, garder l'information.
- Ne jamais coder une info **uniquement** par la couleur (forme/icône en complément) —
  daltonisme. La sévérité a une forme distincte, pas qu'une teinte.

## Anti-patterns

- ❌ Lire de la donnée brute dans le renderer (il ne connaît que le Modèle de Domaine).
- ❌ Allouer/instancier dans la boucle `tick()`.
- ❌ Un draw call par corps (utiliser l'instancing).
- ❌ Faire passer l'esthétique avant la lisibilité opérationnelle.
- ❌ Coupler le renderer à un framework UI spécifique au point de ne plus pouvoir l'embarquer.
