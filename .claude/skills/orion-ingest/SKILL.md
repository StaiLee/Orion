---
name: orion-ingest
description: Ingestion et normalisation des données sécurité vers le Modèle de Domaine Orion, + générateur de simulation. Adapters sources (syslog/JSON, Suricata EVE, Zeek, NetFlow/IPFIX, Wazuh/Elastic, webhook), pipeline de normalisation, enrichissement sévérité/ATT&CK, broadcast WS/SSE, et faux trafic réaliste rejouable pour développer le visuel. À utiliser pour tout travail data/backend Orion.
origin: Orion
---

# Orion — Ingestion & Simulation (Data/Backend)

Transforme n'importe quelle source de sécurité en objets du Modèle de Domaine Orion
(`Body`, `Flux`, `Event`, `Zone` — définis dans `orion-cosmology`) et les diffuse au
rendu. Inclut un simulateur, car **Orion se développe en simulation d'abord**.

## Pipeline

```
Source Adapter  ──►  Normalizer  ──►  State Reducer  ──►  Broadcast (WS/SSE)  ──►  Renderer
 (brut natif)      (→ Orion Event)   (état du cosmos)        (diffuse)            (dessine)
```

1. **Source Adapter** : connaît UN format source, en sort des `Event`/`Flux` Orion bruts.
2. **Normalizer** : enrichit (sévérité, mapping ATT&CK, résolution `Body`/`Zone`, `cosmic`).
3. **State Reducer** : maintient l'état courant du cosmos (corps connus, statuts, orbites).
4. **Broadcast** : pousse les deltas aux clients (WebSocket ou SSE).

## Le contrat : tout adapter produit des objets Orion

Un adapter ne renvoie **jamais** sa donnée brute au reste du système. Il mappe vers le
Modèle de Domaine et conserve l'original dans `Event.raw` (pour le mode analyste). C'est
ce contrat qui rend les sources interchangeables.

## Adapters cibles (feuille de route commerciale)

| Adapter | Source | Produit |
|---|---|---|
| `syslog-json` | logs applicatifs / syslog structuré | Event |
| `suricata-eve` | Suricata EVE JSON (IDS/IPS) | Event (alert) + Flux (flow) |
| `zeek-conn` | Zeek `conn.log` | Flux (connexions) |
| `netflow` | NetFlow / IPFIX | Flux (volumétrie → `mass`) |
| `wazuh` / `elastic` | alertes SIEM | Event enrichi |
| `webhook` | source générique JSON | Event (mapping déclaratif) |

Chaque adapter est un **plugin** enregistré dans un registry, activable par config
déclarative (YAML/JSON). Ajouter une source = ajouter un plugin, sans toucher au cœur.

## Enrichissement (Normalizer)

- **Sévérité** : mappe le score natif de la source vers `info|low|medium|high|critical`
  (table par source, configurable). La sévérité détermine `Event.cosmic` (voir cosmology).
- **ATT&CK** : si la source fournit une technique, la propager dans `Event.mitre` ; sinon
  table de correspondance type→technique quand elle est fiable.
- **Résolution de corps** : `src`/`dst` IP → `Body.id` stable (`host-<ip>`). Inconnu/externe
  → `Body` `kind=external`, `cosmic=rogue` (corps errant du vide). Subnet → `Zone`.
- **Statut de corps** : un `Event` met à jour le `status` du `Body` cible (ex. exploit
  réussi → `compromised`, scan → `scanning`).

## Simulation d'abord (priorité actuelle)

Un générateur produit un **cosmos vivant** pour bâtir et régler le visuel sans source réelle :

- **Trafic de fond nominal** : flux `meteor`/`orbit` entre corps existants, faible sévérité,
  pour que le ciel respire.
- **Scénarios d'attaque scriptés** : kill chains complètes pour tester CHAQUE phénomène —
  `recon (scanning) → initial access (comète) → execution (impact) → lateral (saut d'orbite)
  → exfiltration (trou noir) → impact (supernova)`. Un scénario = un fichier déclaratif.
- **Seed déterministe** : rejouable à l'identique (démo commerciale reproductible, tests).
- **Vitesse réglable** : temps réel, accéléré, pas-à-pas (utile pour démos et debug visuel).

Le simulateur est juste un adapter de plus (`sim`) : il produit les mêmes `Event` Orion.
Donc tout ce qu'on règle en simulation marche tel quel sur données réelles.

## Modularité & déploiement

- Adapters = plugins ; cœur stable. Config déclarative active les sources par client.
- Le broadcast (WS/SSE) est le seul point de contact avec le frontend → backend swappable.
- Penser « simple à déployer » : un binaire/conteneur, config en un fichier, démarre avec
  l'adapter `sim` par défaut pour une démo instantanée out-of-the-box.

## Anti-patterns

- ❌ Laisser fuiter de la donnée brute au-delà de l'adapter (toujours mapper vers Orion).
- ❌ `id` de corps aléatoires (doivent être stables et dérivés de l'identité réseau).
- ❌ Logique de rendu ou de sévérité dans un adapter (séparation des responsabilités).
- ❌ Un simulateur qui produit un format différent des données réelles (il doit être un adapter comme les autres).
- ❌ Coupler le frontend à un format de source : il ne voit que le Modèle de Domaine Orion.
