// Orion — Simulateur (adapter "sim")
// Produit un cosmos vivant : topologie + trafic de fond nominal + kill chains scriptées.
// C'est un adapter comme les autres : il émet les MÊMES objets Orion que les sources réelles.
// Voir .claude/skills/orion-ingest/SKILL.md

import { makeEvent, makeFlux, ATTACK_PHASES } from './orion-model.js';

// PRNG déterministe (mulberry32) → démos rejouables à l'identique
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Topologie : systèmes solaires (segments) + corps (actifs) ----
function buildTopology() {
  const zones = [
    { id: 'sys-vega',  label: '10.0.1.0/24 — DMZ',  star: 'host-10.0.1.1',  constellation: 'Véga' },
    { id: 'sys-orion', label: '10.0.2.0/24 — Prod', star: 'host-10.0.2.1',  constellation: 'Orion-A' },
    { id: 'sys-lyra',  label: '10.0.3.0/24 — Corp', star: 'host-10.0.3.1',  constellation: 'Lyra' },
  ];

  const bodies = [
    // DMZ (Véga)
    b('host-10.0.1.1',  'gw-dmz',      'gateway', 'sys-vega', 2, 0.4),
    b('host-10.0.1.20', 'web-front-01','server',  'sys-vega', 2, 0.6),
    b('host-10.0.1.21', 'web-front-02','server',  'sys-vega', 2, 0.5),
    b('host-10.0.1.30', 'proxy-01',    'service', 'sys-vega', 1, 0.3),
    // Prod (Orion-A)
    b('host-10.0.2.1',  'gw-prod',     'gateway', 'sys-orion',2, 0.4),
    b('host-10.0.2.10', 'srv-db-01',   'server',  'sys-orion',3, 0.9),  // joyau de la couronne
    b('host-10.0.2.11', 'srv-db-02',   'server',  'sys-orion',3, 0.8),
    b('host-10.0.2.20', 'srv-api-01',  'server',  'sys-orion',2, 0.6),
    b('host-10.0.2.40', 'k8s-node-01', 'service', 'sys-orion',2, 0.7),
    // Corp (Lyra)
    b('host-10.0.3.1',  'gw-corp',     'gateway', 'sys-lyra', 2, 0.4),
    b('host-10.0.3.50', 'ws-rh-07',    'endpoint','sys-lyra', 1, 0.2),
    b('host-10.0.3.51', 'ws-fin-03',   'endpoint','sys-lyra', 1, 0.2),
    b('host-10.0.3.52', 'ws-dev-12',   'endpoint','sys-lyra', 1, 0.3),
    b('host-10.0.3.99', 'dc-01',       'server',  'sys-lyra', 3, 0.85), // contrôleur de domaine
    // Externe (le vide interstellaire)
    b('ext-185.x.x.x',  '185.220.101.x','external','external',1, 0.5, 'rogue'),
  ];

  return { zones, bodies };

  function b(id, label, kind, zone, criticality, mass, cosmic) {
    return {
      id, label, kind, zone, criticality, mass,
      cosmic: cosmic ?? (kind === 'gateway' || criticality === 3 ? 'star'
        : kind === 'endpoint' ? 'moon'
        : kind === 'service' ? 'station' : 'planet'),
      status: 'nominal',
      tags: [],
    };
  }
}

export class Simulator {
  constructor(emit, { seed = 1337 } = {}) {
    this.emit = emit;                 // (type, data) => void
    this.rand = rng(seed);
    this.topo = buildTopology();
    this.bodies = this.topo.bodies;
    this.internal = this.bodies.filter((x) => x.kind !== 'external').map((x) => x.id);
    this.timers = [];
  }

  snapshot() {
    return { zones: this.topo.zones, bodies: this.bodies, ts: Date.now() };
  }

  pick(arr) { return arr[Math.floor(this.rand() * arr.length)]; }

  start() {
    // Trafic de fond nominal : le ciel respire
    this.timers.push(setInterval(() => this.backgroundTraffic(), 700));
    // Bruit de sécurité faible (info/low) sporadique
    this.timers.push(setInterval(() => this.minorNoise(), 2600));
    // Kill chain scriptée toutes les ~22 s
    this.timers.push(setInterval(() => this.launchKillChain(), 22000));
    setTimeout(() => this.launchKillChain(), 4000); // une rapidement pour la démo
    // Découverte d'actifs : quelques nouveaux corps apparaissent (topologie dynamique),
    // plafonné pour garder une scène propre.
    this.discovered = 0;
    this.timers.push(setInterval(() => this.discoverAsset(), 40000));
    setTimeout(() => this.discoverAsset(), 13000);
  }

  stop() { this.timers.forEach(clearInterval); this.timers = []; }

  backgroundTraffic() {
    const src = this.pick(this.internal);
    let dst = this.pick(this.internal);
    if (dst === src) return;
    this.emit('flux', makeFlux({
      src, dst,
      protocol: this.pick(['tcp/443', 'tcp/22', 'tcp/5432', 'udp/53', 'tcp/80']),
      bytes: Math.floor(this.rand() * 50000),
      kind: this.rand() > 0.7 ? 'orbit' : 'meteor',
      status: 'nominal',
    }));
  }

  minorNoise() {
    const dst = this.pick(this.internal);
    const sev = this.rand() > 0.5 ? 'low' : 'info';
    this.emit('event', makeEvent({
      severity: sev,
      type: 'telemetry',
      src: 'ext-185.x.x.x',
      dst,
      title: sev === 'low' ? 'Connexion refusée par le pare-feu' : 'Sonde de port isolée',
      raw: { rule: 'fw-default-drop', proto: this.pick(['tcp/3389', 'tcp/445', 'tcp/23']) },
    }));
  }

  // Kill chain complète : recon → initial → execution → lateral → exfiltration → (impact)
  launchKillChain() {
    const incident = `INC-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    const ext = 'ext-185.x.x.x';
    const entry = this.pick(['host-10.0.1.20', 'host-10.0.1.21']); // serveur exposé DMZ
    const crown = this.pick(['host-10.0.2.10', 'host-10.0.2.11', 'host-10.0.3.99']);
    const goSupernova = this.rand() > 0.55;

    const steps = [
      { dt: 0,     stage: 'recon',        sev: 'low',      src: ext,   dst: entry,
        title: `Balayage de ports sur ${this.lbl(entry)}` },
      { dt: 3200,  stage: 'initial',      sev: 'medium',   src: ext,   dst: entry,
        title: `Tentative d'exploitation web sur ${this.lbl(entry)} (CVE-2024-2961)` },
      { dt: 6400,  stage: 'execution',    sev: 'high',     src: ext,   dst: entry,
        title: `Exécution de code à distance sur ${this.lbl(entry)}`, compromise: entry },
      { dt: 9800,  stage: 'lateral',      sev: 'high',     src: entry, dst: crown,
        title: `Mouvement latéral ${this.lbl(entry)} → ${this.lbl(crown)}` },
      { dt: 13200, stage: 'exfiltration', sev: 'high',     src: crown, dst: ext,
        title: `Exfiltration de données depuis ${this.lbl(crown)}`, compromise: crown },
    ];
    if (goSupernova) {
      steps.push({ dt: 16800, stage: 'impact', sev: 'critical', src: ext, dst: crown,
        title: `Chiffrement de masse (rançongiciel) sur ${this.lbl(crown)}`, compromise: crown });
    }

    for (const s of steps) {
      const t = setTimeout(() => {
        const phase = ATTACK_PHASES[s.stage];
        this.emit('event', makeEvent({
          severity: s.sev, type: s.stage, src: s.src, dst: s.dst,
          mitre: phase.mitre, incident, stage: phase.tactic,
          title: s.title,
          raw: { incident, tactic: phase.tactic, mitre: phase.mitre, attacker: '185.220.101.x' },
        }));
        // L'événement fait évoluer le statut du corps cible
        if (s.stage === 'recon')  this.emit('body_status', { id: s.dst, status: 'scanning' });
        if (s.stage === 'initial' || s.stage === 'lateral') this.emit('body_status', { id: s.dst, status: 'under_attack' });
        if (s.compromise) this.emit('body_status', { id: s.compromise, status: 'compromised' });
      }, s.dt);
      this.timers.push(t);
    }

    // Remédiation : on "soigne" les corps après l'incident (cicatrisation)
    const heal = setTimeout(() => {
      for (const id of [entry, crown]) this.emit('body_status', { id, status: 'nominal' });
    }, (goSupernova ? 16800 : 13200) + 11000);
    this.timers.push(heal);
  }

  // Découverte d'un nouvel actif sur le réseau → topologie dynamique
  discoverAsset() {
    if (this.discovered >= 6) return;   // plafond : scène propre
    this.discovered++;
    const zones = this.topo.zones;
    const z = this.pick(zones);
    const seg = z.label.match(/10\.0\.(\d+)\./)?.[1] || '9';
    this._discN = (this._discN || 60) + 1;
    const ip = `10.0.${seg}.${this._discN}`;
    const id = `host-${ip}`;
    if (this.bodies.find((b) => b.id === id)) return;
    const kinds = [['endpoint', 'moon', 1], ['service', 'station', 2], ['server', 'planet', 2]];
    const [kind, cosmic, crit] = this.pick(kinds);
    const names = { endpoint: 'ws', service: 'svc', server: 'node' };
    const body = {
      id, label: `${names[kind]}-${this._discN}`, kind, zone: z.id,
      criticality: crit, mass: 0.2 + this.rand() * 0.5, cosmic, status: 'nominal', tags: ['auto-discovered'],
    };
    this.bodies.push(body);
    this.internal.push(id);
    this.emit('body_add', body);
    this.emit('event', makeEvent({
      severity: 'info', type: 'discovery', src: 'external', dst: id,
      title: `Nouvel actif détecté sur ${z.label} — ${body.label} (${ip})`,
      raw: { ip, zone: z.label, discovery: true },
    }));
  }

  lbl(id) { return this.bodies.find((b) => b.id === id)?.label ?? id; }
}
