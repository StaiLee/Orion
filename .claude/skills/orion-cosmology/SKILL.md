---
name: orion-cosmology
description: Modèle de domaine et lore canonique d'Orion — règles de traduction sécurité↔cosmos (asset=corps céleste, flux=trajectoire, menace=comète, sévérité=magnitude/phénomène, ATT&CK=phases cosmiques). À consulter AVANT tout nommage, mapping, choix visuel ou décision de cohérence dans Orion. C'est le contrat central que l'ingestion et le rendu doivent respecter.
origin: Orion
---

# Orion — Cosmologie & Modèle de Domaine

Orion est un SOC (Security Operations Center) réimaginé en cosmos vivant. Ce skill
fige le **lore canonique** et le **contrat de données** que toutes les autres couches
(`orion-ingest`, `orion-viz`) doivent respecter.

## Principe directeur (non négociable)

> **Le cosmos est une lentille, jamais du bruit.**

Chaque élément céleste affiché DOIT correspondre 1:1 à un primitive de sécurité qu'un
analyste lit en une seconde. Si une animation ne porte aucune information opérationnelle,
elle n'a pas sa place (sauf le starfield de fond, purement décoratif et assumé comme tel).
Orion est un *vrai* outil de supervision — la beauté est au service de la lisibilité, pas
l'inverse. C'est ce qui le rend vendable.

Corollaire : **toujours** un chemin vers la vérité opérationnelle brute (tooltip, mode
analyste, panneau data) montrant IP, port, hostname, règle déclenchée, technique ATT&CK.
La métaphore n'efface jamais la donnée.

## Le Modèle de Domaine Orion (le contrat)

Quatre entités. C'est le **seul** vocabulaire que le rendu connaît. L'ingestion traduit
toute source vers ces objets ; le rendu ne lit que ça.

### `Body` — un corps céleste = un actif supervisé

```jsonc
{
  "id": "host-10.0.1.20",          // identifiant stable de l'actif
  "label": "srv-db-01",             // vérité opérationnelle (hostname / IP)
  "kind": "server",                 // host | server | gateway | endpoint | service | external
  "cosmic": "planet",               // planet | star | moon | station | rogue (voir table)
  "zone": "sys-vega",               // système solaire (segment/subnet)
  "criticality": 3,                 // 0..3 → taille & luminosité
  "mass": 0.42,                     // 0..1 → volume de données / importance relative
  "status": "nominal",             // nominal | scanning | under_attack | compromised | offline
  "tags": ["pci", "prod"]
}
```

### `Flux` — une trajectoire = une connexion / un flux réseau

```jsonc
{
  "id": "flux-8821",
  "src": "host-10.0.1.20",
  "dst": "host-10.0.1.55",
  "protocol": "tcp/443",
  "bytes": 18422,
  "kind": "orbit",                  // meteor (ponctuel) | orbit (persistant)
  "status": "nominal"              // nominal | suspicious | blocked
}
```

### `Event` — un phénomène = un événement/alerte/menace de sécurité

```jsonc
{
  "id": "evt-77f2",
  "ts": 1718280000,
  "severity": "high",              // info | low | medium | high | critical
  "type": "exploit_attempt",
  "src": "external",                // peut être "external" = vide interstellaire
  "dst": "host-10.0.1.20",
  "mitre": "T1190",                // technique ATT&CK si connue
  "cosmic": "asteroid",            // dérivé de severity+type (voir tables)
  "title": "Tentative d'exploitation CVE-2024-XXXX",
  "raw": { }                        // payload source d'origine (pour le mode data)
}
```

### `Zone` — un système solaire = un segment réseau / subnet

```jsonc
{
  "id": "sys-vega",
  "label": "10.0.1.0/24 — DMZ",
  "star": "host-10.0.1.1",          // l'étoile = la passerelle/routeur du segment
  "constellation": "Véga"          // thème de nommage cosmétique (optionnel)
}
```

> **La galaxie Orion** = tout le réseau supervisé. **Le vide interstellaire** = l'Internet
> externe / `src: "external"`. Les menaces viennent de l'espace profond.

## Table de traduction canonique (sécurité → cosmos)

| Concept sécurité | Objet Orion | Représentation céleste |
|---|---|---|
| Actif critique (DC, DB prod) | `Body` kind=server, criticality 3 | **Étoile** (massive, lumineuse, ancre du système) |
| Serveur / host standard | `Body` kind=host/server | **Planète** |
| Endpoint / poste utilisateur | `Body` kind=endpoint | **Lune** (gravite autour d'un host) |
| Service / conteneur | `Body` kind=service | **Station orbitale** |
| Passerelle / routeur de segment | `Body` kind=gateway | **Étoile du système** (Zone.star) |
| Segment / subnet | `Zone` | **Système solaire** |
| Hôte externe / inconnu | `Body` kind=external, cosmic=rogue | **Corps errant** venu du vide |
| Connexion ponctuelle | `Flux` kind=meteor | **Météore** (trace brève) |
| Connexion persistante | `Flux` kind=orbit | **Orbite / sillage** entre deux corps |
| Exfiltration de données | `Event` type=exfiltration | **Trou noir** (aspire la masse du corps) |
| Mouvement latéral | `Event` type=lateral | **Saut d'orbite** (flux corps→corps qui s'allume) |
| Vulnérabilité ouverte | tag sur `Body` | **Fissure** lumineuse sur la surface |
| Remédiation / patch | transition d'état | **Cicatrisation / bouclier** qui se referme |

## Échelle de sévérité → phénomène + magnitude

La sévérité pilote **et** le type de phénomène **et** son intensité visuelle (magnitude :
plus c'est brillant/gros/rapide, plus c'est grave). Couleurs canoniques figées ici.

| Severity | Phénomène (`cosmic`) | Couleur | Comportement |
|---|---|---|---|
| `info` | étoile lointaine | bleu pâle `#6f8fd0` | point fixe discret, pas d'alerte |
| `low` | météore | cyan `#46c8ff` | trace brève, s'éteint vite |
| `medium` | comète | cyan→vert `#3ad6a0` | trajectoire suivie, traînée visible |
| `high` | astéroïde | orange `#ff9b3d` | trajectoire d'impact vers la cible |
| `critical` | supernova / impact | rouge `#ff3b46` | flash + onde de choc, alerte plein écran |

## États d'un corps (cycle de vie d'un `Body`)

| `status` | Sens sécu | Rendu |
|---|---|---|
| `nominal` | sain | halo calme bleu/vert, orbite stable |
| `scanning` | recon détecté sur la cible | balayage lumineux (sonde qui scrute) |
| `under_attack` | attaque active en cours | astéroïde entrant + rougeoiement croissant |
| `compromised` | hôte compromis | surface corrompue (veines rouges), éclipse partielle |
| `offline` | hors-ligne / down | corps éteint, gris, effondré |

Les transitions sont **animées** (un corps qui passe `nominal → compromised` rougit
progressivement) — la transition raconte l'incident.

## MITRE ATT&CK → phases cosmiques

Pour la crédibilité opérationnelle (et la vente), chaque tactique ATT&CK a une phase
cosmique. Une kill chain devient une **histoire céleste** lisible.

| Tactique ATT&CK | Phase cosmique |
|---|---|
| Reconnaissance | sonde lointaine qui balaie le système |
| Initial Access | entrée dans l'atmosphère (comète qui pénètre la zone) |
| Execution | impact sur le corps cible |
| Persistence | corps parasite en orbite stable autour de la cible |
| Privilege Escalation | ascension orbitale (le parasite grimpe vers l'étoile) |
| Defense Evasion | comète furtive (magnitude faible, traînée masquée) |
| Credential Access | arrimage forcé / siphon sur le corps |
| Lateral Movement | saut d'orbite vers un corps voisin |
| Exfiltration | **trou noir** : flux sortant qui aspire la masse vers le vide |
| Impact | **supernova** : le corps explose (rouge plein écran) |

## Règles de nommage

- Le `label` d'un `Body` est **toujours** la vérité opérationnelle (hostname ou IP).
  On n'invente jamais de faux nom qui masque l'identité.
- Le thème cosmétique (`constellation`) habille la **Zone**, pas l'identité de l'actif.
  Ex : subnet DMZ → « Système Véga », réseau prod → « Système Orion-A ».
- Les identifiants `id` sont stables et dérivés de la source (`host-<ip>`), jamais aléatoires
  entre deux rafraîchissements — sinon le rendu perd la continuité des corps.

## Anti-patterns (ce qu'on ne fait JAMAIS)

- ❌ Un effet cosmique décoratif sans correspondance sécu (hors starfield de fond).
- ❌ Masquer la donnée opérationnelle derrière la métaphore (toujours un mode data).
- ❌ Une couleur incohérente avec l'échelle de sévérité ci-dessus.
- ❌ Le rendu qui lit de la donnée brute : il ne connaît QUE le Modèle de Domaine Orion.
- ❌ Des `id` instables entre rafraîchissements (casse les transitions animées).
- ❌ Inventer une nouvelle entité hors {Body, Flux, Event, Zone} sans mettre à jour ce skill.

## Quand modifier ce skill

Ce fichier est la source de vérité. Toute nouvelle correspondance (nouveau type de
menace, nouvelle tactique, nouvel état) s'ajoute ICI d'abord, puis se propage à
`orion-ingest` (production de l'objet) et `orion-viz` (rendu de l'objet).
