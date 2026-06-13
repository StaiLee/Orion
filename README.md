<div align="center">

<img src="docs/banner.svg" alt="ORION — Security Operations Center Cosmos" width="100%"/>

<br/>

**Le premier SOC où le réseau devient un cosmos vivant.**
Chaque actif est un corps céleste · chaque flux une trajectoire · chaque menace une comète qui fonce.

<br/>

![Licence](https://img.shields.io/badge/Licence-Propri%C3%A9taire-ff3b46?style=for-the-badge)
![Node](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-r160-000000?style=for-the-badge&logo=threedotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-natif-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![MITRE ATT&CK](https://img.shields.io/badge/MITRE-ATT%26CK-c0392b?style=for-the-badge)
![Dépendances runtime](https://img.shields.io/badge/d%C3%A9pendances%20runtime-0-3ad6a0?style=for-the-badge)

**[Fonctionnalités](#-fonctionnalités) · [Démarrage](#-démarrage-rapide) · [Architecture](#-architecture) · [API](#-intégration--api) · [Aperçu](#-aperçu) · [Roadmap](#-feuille-de-route)**

</div>

---

> **Les SOC montrent des tableaux et des paquets. Orion montre un ciel — qui veut dire quelque chose.**
> Sous la beauté, un vrai outil de supervision : ingestion temps réel, corrélation d'incidents,
> kill chain MITRE ATT&CK, threat intelligence et réponse SOAR. La couche cosmos est ce qui te
> sort de toute la concurrence ; le moteur en dessous est ce qui le rend vendable.

<br/>

## 🛰️ Pourquoi Orion

| | |
|---|---|
| 🪐 **Conscience de situation incomparable** | Un cosmos 3D où l'état de tout ton réseau se lit d'un coup d'œil. Une planète qui rougit = un hôte compromis. Une supernova = un incident critique. |
| 🎯 **Un vrai SOC, pas un économiseur d'écran** | Feed d'alertes, triage, corrélation d'incidents, matrice ATT&CK live, analyse, threat intel — chaque pixel porte une information opérationnelle. |
| 🔌 **Branchable sur n'importe quelle infra** | Pointe ton SIEM / IDS / EDR vers une URL. Auto-détection du format. Zéro code côté client. |
| ⚡ **Déploiement en une commande** | `node server.js`. Zéro dépendance runtime, un seul fichier de base de données. |

<br/>

## 🪐 Aperçu

<div align="center">

| Cosmos temps réel | Gros plan système |
|:---:|:---:|
| <img src="docs/screenshots/cosmos.png" width="100%"/> | <img src="docs/screenshots/closeup.png" width="100%"/> |
| **Console d'incident (workflow + réponse)** | **Threat Intelligence** |
| <img src="docs/screenshots/incident-console.png" width="100%"/> | <img src="docs/screenshots/threat-intel.png" width="100%"/> |
| **Matrice MITRE ATT&CK (live)** | **Incidents corrélés** |
| <img src="docs/screenshots/matrix.png" width="100%"/> | <img src="docs/screenshots/incidents.png" width="100%"/> |

</div>

<br/>

## ✦ Fonctionnalités

### 🌌 Visualisation cosmos
- Rendu **Three.js / WebGL** cinématique : bloom, tone mapping ACES, vignette
- **5 types de planètes** procédurales (terrestre à lumières de ville, géante gazeuse, glace, monde océan, rogue volcanique)
- **Systèmes solaires = segments réseau**, orbites concentriques, étoiles à couronne
- Trafic de données vivant, comètes/astéroïdes à traînée, supernova sur incident critique
- Intro caméra cinématique, séquence de boot, **son** synthétisé (toggle)

### 🎯 Centre opérationnel
- **3 vues** : Cosmos · Matrice MITRE ATT&CK live · Incidents corrélés
- Feed d'alertes filtrable, **toasts**, KPI temps réel, horloge UTC
- Panneau **Analyse** : distribution de sévérité, top cibles, span de kill chain, sparkline
- **Command palette** `Ctrl/Cmd+K`, mode analyste, **export de rapport** Markdown

### 🌍 Threat Intelligence
- Enrichissement automatique des acteurs externes : **géolocalisation, ASN, réputation IOC** (score + catégories)
- Visible dans le feed (drapeau + badge ⚠ IOC), le triage et l'analyse

### ⛔ Workflow & réponse (console SOC)
- Prise en charge · assignation · résolution · faux positif · **notes d'investigation**
- **Confinement SOAR** : isole l'hôte cible → il passe hors-ligne dans le cosmos
- Statuts **persistés** et **synchronisés en direct** entre tous les postes

### 📦 Plateforme
- **Persistance SQLite** (historique, enquête, conformité) + backfill au chargement
- **API REST** complète + **ingestion universelle** `POST /ingest`
- **Topologie dynamique** : les actifs découverts apparaissent en live

<br/>

## ⚡ Démarrage rapide

```bash
node server.js
```

Puis ouvre **http://localhost:3000**. Aucune dépendance à installer (Node 18+, idéalement 22+ pour SQLite natif).
Le simulateur démarre tout seul : trafic de fond, kill chains complètes, découverte d'actifs.

> 💡 Dans l'interface : laisse l'intro caméra plonger, active le 🔊 son, tape `Ctrl+K`, ouvre un incident et exporte son rapport.

<br/>

## 🌌 Architecture

```
 Sources sécu  ──►  INGESTION  ──►  [ Modèle de Domaine Orion ]  ──►  RENDU cosmos
 (SIEM/IDS/EDR/      (normalise)       Body · Flux · Event · Zone     (Three.js)
  Suricata/sim)                        ▲  LE CONTRAT UNIQUE  ▲
                                       │
                              Persistance · API · Threat Intel · Workflow
```

Le **Modèle de Domaine Orion** est le seul vocabulaire partagé. Le rendu ne lit jamais de
donnée brute ; l'ingestion ne fait jamais de rendu. On change de source ou de moteur de
rendu sans toucher au reste — c'est ce qui rend Orion modulaire et vendable.

| Couche | Fichiers |
|---|---|
| Modèle de domaine + simulateur | `sim/orion-model.js`, `sim/simulator.js` |
| Adapter source réelle (Suricata) | `sim/adapters/suricata.js`, `sim/samples/eve.sample.jsonl` |
| Persistance (SQLite natif) | `sim/db.js` |
| Threat intelligence (géo + IOC) | `sim/threatintel.js` |
| Serveur (statique + SSE + API + ingestion) | `server.js` |
| Rendu cosmos (Three.js, bloom/vignette, shaders) | `web/cosmos.js`, `web/sound.js` |
| HUD SOC (vues, matrice, incidents, analyse, palette) | `web/hud.js`, `web/index.html`, `web/styles.css` |
| État + analytics | `web/store.js` |

<br/>

## 📡 Intégration & API

### Ingestion universelle — pointe n'importe quel outil vers Orion

```bash
# Alerte Suricata EVE JSON (auto-détectée)
curl -X POST http://localhost:3000/ingest -H 'content-type: application/json' -d '{
  "event_type":"alert","src_ip":"45.83.12.9","dest_ip":"10.0.2.10","proto":"TCP",
  "alert":{"signature":"ET SSH Brute Force","category":"Attempted Admin","severity":1,
           "metadata":{"mitre_technique_id":["T1110"]}}}'

# Événement Orion natif
curl -X POST http://localhost:3000/ingest -H 'content-type: application/json' -d '{
  "severity":"high","type":"alert","src":"external","dst":"host-10.0.3.99",
  "title":"Connexion admin anormale","mitre":"T1078"}'
```

Sécuriser : `ORION_API_KEY=secret node server.js` → ajoute `-H 'x-api-key: secret'`.

| Route | Réponse |
|---|---|
| `GET /api/health` | statut, clients, stats |
| `GET /api/events?limit=N` | derniers événements |
| `GET /api/incidents` | incidents corrélés |
| `GET /api/incidents/:id` | un incident + ses événements |
| `GET /api/stats` | sévérité, correspondances IOC, totaux |
| `POST /ingest` | ingestion (Suricata EVE ou Event natif) |
| `POST /api/incidents/:id/action` | `ack` · `assign` · `resolve` · `false_positive` · `reopen` · `note` · `contain` |

<br/>

## 🔭 Données réelles — adapter Suricata

```bash
EVE_FILE=sim/samples/eve.sample.jsonl node server.js
```

Le pipeline `source → Modèle de Domaine Orion → cosmos` est identique à la simu.
Ajouter une source (Zeek, NetFlow, Wazuh…) = écrire un normalizer comme `sim/adapters/suricata.js`.

<br/>

## 🗺️ Feuille de route

- [x] Visualisation cosmos cinématique
- [x] Centre opérationnel (3 vues, feed, analyse, palette)
- [x] Matrice MITRE ATT&CK live + corrélation d'incidents
- [x] Persistance SQLite + API REST + ingestion universelle
- [x] Threat intelligence (géo + IOC)
- [x] Workflow d'incident + réponse SOAR (confinement)
- [x] Topologie dynamique (découverte d'actifs)
- [ ] RBAC · multi-tenant · authentification SSO
- [ ] Flux IOC / GeoIP réels (MaxMind, MISP, AbuseIPDB)
- [ ] Champs analyste avancés (identité, process, SLA)
- [ ] Playbooks SOAR étendus + intégration ticketing

<br/>

## 🧭 Skills Claude Code

Le projet embarque des skills `.claude/skills/orion-*` (cosmologie/lore, rendu, ingestion,
workflow) qui font connaître Orion par cœur à l'agent à chaque session.

<br/>

## 📜 Licence

**Propriétaire** — © 2026 Ilyes Staili. Tous droits réservés. Source visible pour évaluation.
Usage commercial sur licence. Voir [LICENSE](LICENSE).

<div align="center">
<br/>

**✦ ORION** — *le réseau devient un cosmos*

</div>
