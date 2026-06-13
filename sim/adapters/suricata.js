// Adapter Suricata EVE JSON → Modèle de Domaine Orion.
// Preuve de modularité : une source RÉELLE produit exactement les mêmes objets Orion
// que le simulateur. Le rendu ne voit aucune différence.
// Voir .claude/skills/orion-ingest/SKILL.md

import { readFile } from 'node:fs/promises';
import { makeEvent, makeFlux } from '../orion-model.js';

// Suricata : severity 1 (la plus grave) → 3. On mappe vers l'échelle Orion.
const SEV_MAP = { 1: 'high', 2: 'medium', 3: 'low' };
// Quelques catégories Suricata qui méritent une escalade.
const CRITICAL_CATS = [/ransom/i, /malware c2/i, /trojan/i];

// Technique ATT&CK → tactique (sous-ensemble couvrant la kill chain).
const TECH_TACTIC = {
  T1595: 'Reconnaissance', T1190: 'Initial Access', T1203: 'Execution',
  T1068: 'Privilege Escalation', T1021: 'Lateral Movement', T1110: 'Credential Access',
  T1003: 'Credential Access', T1041: 'Exfiltration', T1486: 'Impact',
};

function ipToBody(ip) {
  if (!ip) return 'external';
  return /^10\.0\./.test(ip) ? `host-${ip}` : 'ext-185.x.x.x';
}

// Normalise une ligne EVE en objet Orion (ou null si non pertinent).
export function normalizeEve(obj, incident) {
  if (obj.event_type === 'flow') {
    return { type: 'flux', data: makeFlux({
      src: ipToBody(obj.src_ip), dst: ipToBody(obj.dest_ip),
      protocol: `${(obj.proto || 'tcp').toLowerCase()}/${obj.dest_port || 0}`,
      bytes: (obj.flow?.bytes_toserver || 0) + (obj.flow?.bytes_toclient || 0),
      kind: 'meteor', status: 'nominal',
    }) };
  }
  if (obj.event_type !== 'alert' || !obj.alert) return null;
  const a = obj.alert;
  let severity = SEV_MAP[a.severity] || 'medium';
  if (CRITICAL_CATS.some((re) => re.test(a.category || ''))) severity = 'critical';
  if (a.severity === 1 && /encrypt|ransom|destruction/i.test(a.signature || '')) severity = 'critical';
  const mitre = a.metadata?.mitre_technique_id?.[0] || null;
  const stage = mitre ? TECH_TACTIC[mitre] || null : null;
  const type = stage ? stage.toLowerCase().split(' ')[0] : 'alert';
  return { type: 'event', data: makeEvent({
    ts: obj.timestamp ? Date.parse(obj.timestamp) : Date.now(),
    severity, type, mitre, stage, incident,
    src: ipToBody(obj.src_ip), dst: ipToBody(obj.dest_ip),
    title: a.signature || 'Alerte Suricata',
    raw: { source: 'suricata', signature: a.signature, category: a.category, severity: a.severity, src_ip: obj.src_ip, dest_ip: obj.dest_ip, proto: obj.proto },
  }) };
}

// Rejoue un fichier EVE (.json lines) à intervalle régulier, en boucle.
export class SuricataReplay {
  constructor(emit, { file, intervalMs = 2200, loop = true } = {}) {
    this.emit = emit; this.file = file; this.intervalMs = intervalMs; this.loop = loop;
    this.lines = []; this.idx = 0; this.timer = null; this.incident = null;
  }

  async load() {
    const txt = await readFile(this.file, 'utf8');
    this.lines = txt.split('\n').map((l) => l.trim()).filter(Boolean);
    return this.lines.length;
  }

  start() {
    this.timer = setInterval(() => this._tick(), this.intervalMs);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  _tick() {
    if (this.idx >= this.lines.length) {
      if (!this.loop) return this.stop();
      this.idx = 0; this.incident = null;
    }
    if (this.idx === 0) this.incident = `EVE-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    let obj;
    try { obj = JSON.parse(this.lines[this.idx]); } catch { this.idx++; return; }
    this.idx++;
    const out = normalizeEve(obj, this.incident);
    if (!out) return;
    this.emit(out.type, out.data);
    // un alerte grave fait évoluer le statut du corps cible (comme une vraie console SOC)
    if (out.type === 'event') {
      const ev = out.data;
      if (ev.severity === 'critical') this.emit('body_status', { id: ev.dst, status: 'compromised' });
      else if (ev.severity === 'high') this.emit('body_status', { id: ev.dst, status: 'under_attack' });
      else if (ev.type === 'reconnaissance') this.emit('body_status', { id: ev.dst, status: 'scanning' });
    }
  }
}
