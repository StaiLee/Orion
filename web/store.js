// Orion — store d'état (le cosmos courant).
// Consomme les objets du Modèle de Domaine Orion et maintient l'état.
// Ni rendu, ni réseau ici : pure logique d'état + notifications.

export class OrionStore {
  constructor() {
    this.zones = new Map();
    this.bodies = new Map();
    this.events = [];                 // plus récents en tête, capés
    this.incidents = new Map();       // id → { id, stages:[], severityMax, lastTs }
    this.maxEvents = 200;
    this._subs = new Set();
    this._evRate = [];                // timestamps pour events/min
  }

  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _notify(kind, payload) { for (const fn of this._subs) fn(kind, payload, this); }

  applySnapshot(snap) {
    this.zones.clear(); this.bodies.clear();
    for (const z of snap.zones) this.zones.set(z.id, z);
    for (const b of snap.bodies) this.bodies.set(b.id, { ...b });
    this._notify('snapshot', snap);
  }

  applyEvent(ev) {
    this.events.unshift(ev);
    if (this.events.length > this.maxEvents) this.events.pop();
    this._evRate.push(ev.ts);
    this._evRate = this._evRate.filter((t) => t >= Date.now() - 60000);
    this._ingestIncident(ev);
    this._notify('event', ev);
  }

  // Backfill historique (au chargement) : reconstruit l'état sans animer le cosmos.
  applyHistory(events) {
    this.events = [];
    this.incidents.clear();
    this._evRate = [];
    for (const ev of events) {                 // ordre ascendant (ancien → récent)
      this.events.unshift(ev);
      this._evRate.push(ev.ts);
      this._ingestIncident(ev);
    }
    if (this.events.length > this.maxEvents) this.events.length = this.maxEvents;
    this._evRate = this._evRate.filter((t) => t >= Date.now() - 60000);
    this._notify('history', events);
  }

  _ingestIncident(ev) {
    if (!ev.incident) return;
    let inc = this.incidents.get(ev.incident);
    if (!inc) {
      inc = { id: ev.incident, stages: [], events: [], assets: new Set(), severityMax: 'info', firstTs: ev.ts, lastTs: ev.ts, target: ev.dst, status: 'open', owner: null, notes: [] };
      this.incidents.set(ev.incident, inc);
    }
    if (ev.stage && !inc.stages.find((s) => s.tactic === ev.stage)) {
      inc.stages.push({ tactic: ev.stage, mitre: ev.mitre, ts: ev.ts, severity: ev.severity, title: ev.title });
    }
    inc.events.unshift(ev);
    if (ev.src?.startsWith('host-')) inc.assets.add(ev.src);
    if (ev.dst?.startsWith('host-')) inc.assets.add(ev.dst);
    inc.severityMax = this._maxSev(inc.severityMax, ev.severity);
    inc.lastTs = Math.max(inc.lastTs, ev.ts);
  }

  applyBodyStatus({ id, status }) {
    const b = this.bodies.get(id);
    if (!b) return;
    b.status = status;
    this._notify('body_status', { id, status });
  }

  applyFlux(flux) { this._notify('flux', flux); }

  applyBodyAdd(body) {
    if (this.bodies.has(body.id)) return;
    this.bodies.set(body.id, { ...body });
    this._notify('body_add', body);
  }

  // Métadonnées d'incidents (statut/propriétaire/notes) reçues à la connexion.
  applyIncidentsMeta(list) {
    for (const m of list) {
      let inc = this.incidents.get(m.id);
      if (!inc) {
        inc = { id: m.id, stages: m.stages || [], events: [], assets: new Set(m.assets || []),
          severityMax: m.severityMax, firstTs: m.firstTs, lastTs: m.lastTs, target: m.target };
        this.incidents.set(m.id, inc);
      }
      inc.status = m.status; inc.owner = m.owner; inc.notes = m.notes || [];
    }
    this._notify('incidents_meta', list);
  }

  applyIncidentUpdate(inc) {
    let cur = this.incidents.get(inc.id);
    if (!cur) { cur = { ...inc, assets: new Set(inc.assets || []), events: [] }; this.incidents.set(inc.id, cur); }
    cur.status = inc.status; cur.owner = inc.owner; cur.notes = inc.notes || [];
    cur.severityMax = inc.severityMax; cur.lastTs = inc.lastTs;
    this._notify('incident_update', cur);
  }

  // ---- dérivés pour le HUD ----
  kpis() {
    let compromised = 0, attacked = 0;
    for (const b of this.bodies.values()) {
      if (b.status === 'compromised') compromised++;
      if (b.status === 'under_attack' || b.status === 'scanning') attacked++;
    }
    return {
      supervised: [...this.bodies.values()].filter((b) => b.kind !== 'external').length,
      compromised,
      threats: attacked,
      eventsPerMin: this._evRate.length,
      incidents: this.incidents.size,
    };
  }

  analytics() {
    const sev = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
    const targets = {};
    const countries = {};
    let iocMatches = 0;
    for (const e of this.events) {
      sev[e.severity] = (sev[e.severity] || 0) + 1;
      if (e.dst && e.dst !== 'external') targets[e.dst] = (targets[e.dst] || 0) + 1;
      if (e.intel?.match) iocMatches++;
      if (e.geo?.country) countries[e.geo.country] = (countries[e.geo.country] || 0) + 1;
    }
    const topCountries = Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const topTargets = Object.entries(targets).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, c]) => ({ id, c, label: this.bodies.get(id)?.label || id, status: this.bodies.get(id)?.status || 'nominal' }));
    let active = 0, contained = 0, spanSum = 0, spanN = 0;
    const now = Date.now();
    for (const inc of this.incidents.values()) {
      if (now - inc.lastTs < 20000) active++; else contained++;
      if (inc.stages.length > 1) { spanSum += inc.stages.at(-1).ts - inc.stages[0].ts; spanN++; }
    }
    return { sev, topTargets, topCountries, iocMatches, active, contained, avgSpan: spanN ? spanSum / spanN : 0 };
  }

  rateSeries() {
    const now = Date.now();
    const buckets = new Array(20).fill(0);
    for (const t of this._evRate) {
      const idx = Math.floor((now - t) / 3000);
      if (idx >= 0 && idx < 20) buckets[19 - idx]++;
    }
    return buckets;
  }

  incidentList() {
    return [...this.incidents.values()].sort((a, b) => b.lastTs - a.lastTs);
  }

  _maxSev(a, b) {
    const order = ['info', 'low', 'medium', 'high', 'critical'];
    return order.indexOf(b) > order.indexOf(a) ? b : a;
  }
}
