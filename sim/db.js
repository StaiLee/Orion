// Orion — persistance (SQLite natif Node, zéro dépendance externe, un seul fichier).
// Stocke événements + incidents (avec workflow : statut, propriétaire, notes) pour :
// historique, enquête, conformité, replay. Abstraction simple → remplaçable par Postgres.

import { DatabaseSync } from 'node:sqlite';

const SEV_ORDER = ['info', 'low', 'medium', 'high', 'critical'];
const maxSev = (a, b) => (SEV_ORDER.indexOf(b) > SEV_ORDER.indexOf(a) ? b : a);

export class OrionDB {
  constructor(path = 'orion.db') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, ts INTEGER, severity TEXT, type TEXT,
        src TEXT, dst TEXT, mitre TEXT, cosmic TEXT, incident TEXT, stage TEXT,
        title TEXT, raw TEXT, geo TEXT, intel TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_events_incident ON events(incident);
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY, target TEXT, severity_max TEXT,
        first_ts INTEGER, last_ts INTEGER, stages TEXT, assets TEXT,
        status TEXT DEFAULT 'open', owner TEXT, notes TEXT DEFAULT '[]'
      );
    `);
    // migration douce pour les bases existantes
    this._addCol('events', 'geo', 'TEXT');
    this._addCol('events', 'intel', 'TEXT');
    this._addCol('incidents', 'status', "TEXT DEFAULT 'open'");
    this._addCol('incidents', 'owner', 'TEXT');
    this._addCol('incidents', 'notes', "TEXT DEFAULT '[]'");

    this._insEvent = this.db.prepare(
      `INSERT OR IGNORE INTO events (id,ts,severity,type,src,dst,mitre,cosmic,incident,stage,title,raw,geo,intel)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    this._getInc = this.db.prepare('SELECT * FROM incidents WHERE id = ?');
    this._upsertInc = this.db.prepare(
      `INSERT INTO incidents (id,target,severity_max,first_ts,last_ts,stages,assets,status,notes)
       VALUES (?,?,?,?,?,?,?, 'open', '[]')
       ON CONFLICT(id) DO UPDATE SET severity_max=excluded.severity_max, last_ts=excluded.last_ts,
       stages=excluded.stages, assets=excluded.assets`);
    this._inserts = 0;
  }

  _addCol(table, col, decl) { try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); } catch { /* existe déjà */ } }

  insertEvent(ev) {
    this._insEvent.run(ev.id, ev.ts, ev.severity, ev.type, ev.src, ev.dst,
      ev.mitre ?? null, ev.cosmic ?? null, ev.incident ?? null, ev.stage ?? null,
      ev.title ?? '', JSON.stringify(ev.raw ?? {}),
      ev.geo ? JSON.stringify(ev.geo) : null, ev.intel ? JSON.stringify(ev.intel) : null);
    if (ev.incident) this._touchIncident(ev);
    if (++this._inserts % 500 === 0) this._prune();
  }

  _touchIncident(ev) {
    const row = this._getInc.get(ev.incident);
    let stages = [], assets = new Set(), sev = 'info', first = ev.ts, target = ev.dst;
    if (row) {
      stages = JSON.parse(row.stages); assets = new Set(JSON.parse(row.assets));
      sev = row.severity_max; first = row.first_ts; target = row.target;
    }
    if (ev.stage && !stages.find((s) => s.tactic === ev.stage)) {
      stages.push({ tactic: ev.stage, mitre: ev.mitre, ts: ev.ts, severity: ev.severity, title: ev.title });
    }
    if (ev.src?.startsWith('host-')) assets.add(ev.src);
    if (ev.dst?.startsWith('host-')) assets.add(ev.dst);
    this._upsertInc.run(ev.incident, target, maxSev(sev, ev.severity), first, ev.ts,
      JSON.stringify(stages), JSON.stringify([...assets]));
  }

  // --- workflow d'incident ---
  getIncident(id) {
    const r = this._getInc.get(id);
    return r ? this._hydrateInc(r) : null;
  }

  updateIncident(id, fields) {
    const r = this._getInc.get(id);
    if (!r) return null;
    const status = fields.status ?? r.status ?? 'open';
    const owner = fields.owner !== undefined ? fields.owner : r.owner;
    this.db.prepare('UPDATE incidents SET status=?, owner=? WHERE id=?').run(status, owner, id);
    return this.getIncident(id);
  }

  addNote(id, note) {
    const r = this._getInc.get(id);
    if (!r) return null;
    const notes = JSON.parse(r.notes || '[]');
    notes.push({ ts: Date.now(), author: note.author || 'analyste', text: note.text || '' });
    this.db.prepare('UPDATE incidents SET notes=? WHERE id=?').run(JSON.stringify(notes), id);
    return this.getIncident(id);
  }

  recentEvents(limit = 150) {
    return this.db.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT ?').all(limit).reverse().map(this._hydrate);
  }

  listIncidents(limit = 50) {
    return this.db.prepare('SELECT * FROM incidents ORDER BY last_ts DESC LIMIT ?').all(limit).map(this._hydrateInc);
  }

  incidentEvents(id) {
    return this.db.prepare('SELECT * FROM events WHERE incident = ? ORDER BY ts ASC').all(id).map(this._hydrate);
  }

  stats(sinceMs = 24 * 3600 * 1000) {
    const since = Date.now() - sinceMs;
    const sev = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
    for (const r of this.db.prepare('SELECT severity, COUNT(*) c FROM events WHERE ts > ? GROUP BY severity').all(since)) sev[r.severity] = r.c;
    const iocMatches = this.db.prepare("SELECT COUNT(*) c FROM events WHERE intel LIKE '%\"match\":true%' AND ts > ?").get(since).c;
    const totalEvents = this.db.prepare('SELECT COUNT(*) c FROM events').get().c;
    const totalIncidents = this.db.prepare('SELECT COUNT(*) c FROM incidents').get().c;
    return { sev, iocMatches, totalEvents, totalIncidents, windowMs: sinceMs };
  }

  _hydrate = (r) => ({
    id: r.id, ts: r.ts, severity: r.severity, type: r.type, src: r.src, dst: r.dst,
    mitre: r.mitre, cosmic: r.cosmic, incident: r.incident, stage: r.stage,
    title: r.title, raw: safeParse(r.raw), geo: safeParse(r.geo, null), intel: safeParse(r.intel, null),
  });

  _hydrateInc = (r) => ({
    id: r.id, target: r.target, severityMax: r.severity_max, firstTs: r.first_ts, lastTs: r.last_ts,
    stages: JSON.parse(r.stages), assets: JSON.parse(r.assets),
    status: r.status || 'open', owner: r.owner || null, notes: safeParse(r.notes, []),
  });

  _prune() { this.db.exec('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY ts DESC LIMIT 5000)'); }
}

function safeParse(s, fallback = {}) { if (s == null) return fallback; try { return JSON.parse(s); } catch { return fallback; } }
