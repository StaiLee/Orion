// Orion — persistance (SQLite natif Node, zéro dépendance externe, un seul fichier).
// Événements + incidents (workflow) + utilisateurs/sessions (auth, RBAC) + multi-tenant.
// Abstraction simple → remplaçable par Postgres pour le multi-nœuds.

import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SEV_ORDER = ['info', 'low', 'medium', 'high', 'critical'];
const maxSev = (a, b) => (SEV_ORDER.indexOf(b) > SEV_ORDER.indexOf(a) ? b : a);
const SESSION_TTL = 8 * 3600 * 1000; // 8 h

export class OrionDB {
  constructor(path = 'orion.db') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, ts INTEGER, severity TEXT, type TEXT,
        src TEXT, dst TEXT, mitre TEXT, cosmic TEXT, incident TEXT, stage TEXT,
        title TEXT, raw TEXT, geo TEXT, intel TEXT, tenant TEXT DEFAULT 'orion-demo'
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_events_incident ON events(incident);
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY, target TEXT, severity_max TEXT,
        first_ts INTEGER, last_ts INTEGER, stages TEXT, assets TEXT,
        status TEXT DEFAULT 'open', owner TEXT, notes TEXT DEFAULT '[]',
        tenant TEXT DEFAULT 'orion-demo'
      );
      CREATE TABLE IF NOT EXISTS tenants ( id TEXT PRIMARY KEY, name TEXT, created INTEGER );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE, salt TEXT, hash TEXT,
        role TEXT, tenant TEXT, created INTEGER
      );
      CREATE TABLE IF NOT EXISTS sessions ( token TEXT PRIMARY KEY, user_id TEXT, expires INTEGER );
    `);
    // migrations douces (bases existantes)
    this._addCol('events', 'geo', 'TEXT'); this._addCol('events', 'intel', 'TEXT');
    this._addCol('events', 'tenant', "TEXT DEFAULT 'orion-demo'");
    this._addCol('incidents', 'status', "TEXT DEFAULT 'open'"); this._addCol('incidents', 'owner', 'TEXT');
    this._addCol('incidents', 'notes', "TEXT DEFAULT '[]'"); this._addCol('incidents', 'tenant', "TEXT DEFAULT 'orion-demo'");
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_tenant ON events(tenant)'); // après migration de la colonne

    this._insEvent = this.db.prepare(
      `INSERT OR IGNORE INTO events (id,ts,severity,type,src,dst,mitre,cosmic,incident,stage,title,raw,geo,intel,tenant)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    this._getInc = this.db.prepare('SELECT * FROM incidents WHERE id = ?');
    this._upsertInc = this.db.prepare(
      `INSERT INTO incidents (id,target,severity_max,first_ts,last_ts,stages,assets,status,notes,tenant)
       VALUES (?,?,?,?,?,?,?, 'open', '[]', ?)
       ON CONFLICT(id) DO UPDATE SET severity_max=excluded.severity_max, last_ts=excluded.last_ts,
       stages=excluded.stages, assets=excluded.assets`);
    this._inserts = 0;
    this.seedDefaults();
  }

  _addCol(table, col, decl) { try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); } catch { /* existe déjà */ } }

  // ---------- événements ----------
  insertEvent(ev) {
    this._insEvent.run(ev.id, ev.ts, ev.severity, ev.type, ev.src, ev.dst,
      ev.mitre ?? null, ev.cosmic ?? null, ev.incident ?? null, ev.stage ?? null,
      ev.title ?? '', JSON.stringify(ev.raw ?? {}),
      ev.geo ? JSON.stringify(ev.geo) : null, ev.intel ? JSON.stringify(ev.intel) : null,
      ev.tenant || 'orion-demo');
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
      JSON.stringify(stages), JSON.stringify([...assets]), ev.tenant || 'orion-demo');
  }

  recentEvents(tenant, limit = 150) {
    return this.db.prepare('SELECT * FROM events WHERE tenant = ? ORDER BY ts DESC LIMIT ?').all(tenant, limit).reverse().map(this._hydrate);
  }

  listIncidents(tenant, limit = 50) {
    return this.db.prepare('SELECT * FROM incidents WHERE tenant = ? ORDER BY last_ts DESC LIMIT ?').all(tenant, limit).map(this._hydrateInc);
  }

  incidentEvents(id) {
    return this.db.prepare('SELECT * FROM events WHERE incident = ? ORDER BY ts ASC').all(id).map(this._hydrate);
  }

  stats(tenant, sinceMs = 24 * 3600 * 1000) {
    const since = Date.now() - sinceMs;
    const sev = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
    for (const r of this.db.prepare('SELECT severity, COUNT(*) c FROM events WHERE tenant=? AND ts > ? GROUP BY severity').all(tenant, since)) sev[r.severity] = r.c;
    const iocMatches = this.db.prepare("SELECT COUNT(*) c FROM events WHERE tenant=? AND intel LIKE '%\"match\":true%' AND ts > ?").get(tenant, since).c;
    const totalEvents = this.db.prepare('SELECT COUNT(*) c FROM events WHERE tenant=?').get(tenant).c;
    const totalIncidents = this.db.prepare('SELECT COUNT(*) c FROM incidents WHERE tenant=?').get(tenant).c;
    return { sev, iocMatches, totalEvents, totalIncidents, windowMs: sinceMs };
  }

  // ---------- workflow d'incident ----------
  getIncident(id) { const r = this._getInc.get(id); return r ? this._hydrateInc(r) : null; }

  updateIncident(id, fields) {
    const r = this._getInc.get(id); if (!r) return null;
    const status = fields.status ?? r.status ?? 'open';
    const owner = fields.owner !== undefined ? fields.owner : r.owner;
    this.db.prepare('UPDATE incidents SET status=?, owner=? WHERE id=?').run(status, owner, id);
    return this.getIncident(id);
  }

  addNote(id, note) {
    const r = this._getInc.get(id); if (!r) return null;
    const notes = JSON.parse(r.notes || '[]');
    notes.push({ ts: Date.now(), author: note.author || 'analyste', text: note.text || '' });
    this.db.prepare('UPDATE incidents SET notes=? WHERE id=?').run(JSON.stringify(notes), id);
    return this.getIncident(id);
  }

  // ---------- authentification / RBAC / tenants ----------
  seedDefaults() {
    const n = this.db.prepare('SELECT COUNT(*) c FROM users').get().c;
    if (n > 0) return;
    this.db.prepare('INSERT OR IGNORE INTO tenants (id,name,created) VALUES (?,?,?)').run('orion-demo', 'Orion Demo', Date.now());
    const pw = process.env.ORION_SEED_PASSWORD || 'orion';
    this.createUser({ username: 'admin', password: pw, role: 'admin', tenant: 'orion-demo' });
    this.createUser({ username: 'analyste', password: pw, role: 'analyst', tenant: 'orion-demo' });
    this.createUser({ username: 'observateur', password: pw, role: 'viewer', tenant: 'orion-demo' });
    this._seededPw = pw;
  }

  createUser({ username, password, role = 'viewer', tenant = 'orion-demo' }) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    const id = 'usr-' + randomBytes(6).toString('hex');
    this.db.prepare('INSERT INTO users (id,username,salt,hash,role,tenant,created) VALUES (?,?,?,?,?,?,?)')
      .run(id, username, salt, hash, role, tenant, Date.now());
    return { id, username, role, tenant };
  }

  verifyLogin(username, password) {
    const u = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!u) return null;
    const h = scryptSync(password, u.salt, 64);
    if (!timingSafeEqual(Buffer.from(u.hash, 'hex'), h)) return null;
    return { id: u.id, username: u.username, role: u.role, tenant: u.tenant };
  }

  createSession(userId) {
    const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sessions (token,user_id,expires) VALUES (?,?,?)').run(token, userId, Date.now() + SESSION_TTL);
    return token;
  }

  getSession(token) {
    if (!token) return null;
    const s = this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!s || s.expires < Date.now()) return null;
    const u = this.db.prepare('SELECT id,username,role,tenant FROM users WHERE id = ?').get(s.user_id);
    return u || null;
  }

  deleteSession(token) { try { this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token); } catch {} }

  listUsers(tenant) {
    return this.db.prepare('SELECT id,username,role,tenant,created FROM users WHERE tenant = ? ORDER BY created').all(tenant);
  }

  // ---------- hydratation ----------
  _hydrate = (r) => ({
    id: r.id, ts: r.ts, severity: r.severity, type: r.type, src: r.src, dst: r.dst,
    mitre: r.mitre, cosmic: r.cosmic, incident: r.incident, stage: r.stage,
    title: r.title, raw: safeParse(r.raw), geo: safeParse(r.geo, null), intel: safeParse(r.intel, null),
  });

  _hydrateInc = (r) => ({
    id: r.id, target: r.target, severityMax: r.severity_max, firstTs: r.first_ts, lastTs: r.last_ts,
    stages: JSON.parse(r.stages), assets: JSON.parse(r.assets),
    status: r.status || 'open', owner: r.owner || null, notes: safeParse(r.notes, []), tenant: r.tenant || 'orion-demo',
  });

  _prune() { this.db.exec('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY ts DESC LIMIT 5000)'); }
}

function safeParse(s, fallback = {}) { if (s == null) return fallback; try { return JSON.parse(s); } catch { return fallback; } }
