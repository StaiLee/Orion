---
name: orion-workflow
description: Rythme de travail et conventions de session pour le projet Orion — quand sauvegarder la session, planifier, revoir le code, et tenir la mémoire à jour ; et quels skills ECC existants enchaîner. À utiliser au démarrage/clôture de session Orion et avant tout chantier multi-étapes.
origin: Orion
---

# Orion — Workflow de projet

Comment enchaîner les sessions Orion sans perdre le fil. Ce skill ne réinvente pas
l'outillage ECC déjà présent — il dit **quand** s'en servir dans le contexte Orion.

## Au démarrage d'une session

1. Lire `CLAUDE.md` (racine) — north star, architecture, phase courante.
2. Charger la mémoire projet (`MEMORY.md` + `memory/`).
3. Si chantier visuel → activer `orion-viz` ; data/backend → `orion-ingest` ; toute
   décision de mapping/nommage → `orion-cosmology` (la source de vérité).

## Pendant le travail

- **Planifier** un chantier multi-étapes : skill `plan` (ou `/plan`) avant d'écrire du code.
- **Cohérence cosmos** : toute nouvelle correspondance sécu↔céleste s'ajoute d'abord dans
  `orion-cosmology`, puis se propage à `orion-ingest` (production) et `orion-viz` (rendu).
- **Revue de code** : skill `code-review` après une tranche significative.
- **Vérifier que ça tourne** : skill `verify` / `run` pour voir le cosmos bouger pour de vrai,
  pas juste les tests verts.

## En fin de session

- **Sauvegarder l'état** : skill `save-session` — capture ce qui a été bâti, ce qui marche,
  ce qui reste. Indispensable pour reprendre à froid.
- **Mémoriser le durable** : ce qui n'est pas déductible du code (décisions d'archi,
  contraintes commerciales, choix de stack) → fichier mémoire + ligne dans `MEMORY.md`.
  Ne pas mémoriser ce que le repo dit déjà.

## Garde-fous Orion

- La phase courante est **simulation d'abord** : on bâtit et règle le visuel sur faux trafic.
- Tout passe par le **Modèle de Domaine Orion** (contrat de `orion-cosmology`). Si une couche
  veut court-circuiter le contrat, c'est un signal d'alerte.
- Objectif produit constant : **vrai SOC utile + lentille cosmos + modulaire + déploiement simple**.
  Toute décision se juge à cette aune.
