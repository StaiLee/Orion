// Orion — Modèle de Domaine (côté serveur)
// Source de vérité du lore : voir .claude/skills/orion-cosmology/SKILL.md
// Ce module ne produit QUE des objets {Body, Flux, Event, Zone}. C'est le contrat.

export const SEVERITY = ['info', 'low', 'medium', 'high', 'critical'];

// Sévérité → phénomène céleste + couleur canonique (figées dans orion-cosmology)
export const COSMIC_BY_SEVERITY = {
  info:     { cosmic: 'farstar',  color: '#6f8fd0' },
  low:      { cosmic: 'meteor',   color: '#46c8ff' },
  medium:   { cosmic: 'comet',    color: '#3ad6a0' },
  high:     { cosmic: 'asteroid', color: '#ff9b3d' },
  critical: { cosmic: 'supernova',color: '#ff3b46' },
};

// Type d'événement → tactique ATT&CK → phase cosmique (sous-ensemble utile)
export const ATTACK_PHASES = {
  recon:        { tactic: 'Reconnaissance',      mitre: 'T1595', phase: 'sonde lointaine' },
  initial:      { tactic: 'Initial Access',      mitre: 'T1190', phase: "entrée dans l'atmosphère" },
  execution:    { tactic: 'Execution',           mitre: 'T1203', phase: 'impact' },
  persistence:  { tactic: 'Persistence',         mitre: 'T1543', phase: 'corps en orbite stable' },
  privesc:      { tactic: 'Privilege Escalation',mitre: 'T1068', phase: 'ascension orbitale' },
  lateral:      { tactic: 'Lateral Movement',    mitre: 'T1021', phase: "saut d'orbite" },
  exfiltration: { tactic: 'Exfiltration',        mitre: 'T1041', phase: 'trou noir' },
  impact:       { tactic: 'Impact',              mitre: 'T1486', phase: 'supernova' },
};

let _seq = 0;
const nextId = (p) => `${p}-${(++_seq).toString(36)}-${Date.now().toString(36).slice(-4)}`;

export function makeEvent({ ts, severity, type, src, dst, mitre, title, raw, incident, stage }) {
  const c = COSMIC_BY_SEVERITY[severity] || COSMIC_BY_SEVERITY.info;
  return {
    id: nextId('evt'),
    ts: ts ?? Date.now(),
    severity,
    type,
    src,
    dst,
    mitre: mitre ?? null,
    cosmic: type === 'exfiltration' ? 'blackhole' : c.cosmic,
    color: c.color,
    title,
    incident: incident ?? null,
    stage: stage ?? null,
    raw: raw ?? {},
  };
}

export function makeFlux({ src, dst, protocol, bytes, kind, status }) {
  return {
    id: nextId('flux'),
    src, dst,
    protocol: protocol ?? 'tcp/443',
    bytes: bytes ?? 0,
    kind: kind ?? 'meteor',
    status: status ?? 'nominal',
  };
}
