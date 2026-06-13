// Orion — serveur (SQLite natif + crypto natif, sinon zéro dépendance).
// Frontend + SSE + persistance + API REST + ingestion + AUTH/RBAC + multi-tenant.
// Déploiement : `node server.js` (auth activée). `ORION_AUTH=off node server.js` pour désactiver.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Simulator } from './sim/simulator.js';
import { SuricataReplay, normalizeEve } from './sim/adapters/suricata.js';
import { makeEvent } from './sim/orion-model.js';
import { OrionDB } from './sim/db.js';
import { enrich } from './sim/threatintel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, 'web');
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ORION_API_KEY || null;
const API_TENANT = process.env.ORION_API_TENANT || 'orion-demo';
const AUTH = process.env.ORION_AUTH !== 'off';
const SIM_TENANT = 'orion-demo';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const db = new OrionDB(process.env.ORION_DB || join(__dirname, 'orion.db'));

/** clients SSE : { res, tenant } */
const clients = new Set();

function broadcast(type, data, tenant) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (tenant && c.tenant !== tenant) continue;       // isolation multi-tenant
    try { c.res.write(payload); } catch { clients.delete(c); }
  }
}

// emit() : enrichit, tague le tenant, persiste, puis diffuse (scopé au tenant).
function emit(type, data, tenant = SIM_TENANT) {
  if (type === 'event') {
    data.tenant = tenant;
    enrich(data);
    try { db.insertEvent(data); } catch (e) { console.error('db:', e.message); }
  }
  broadcast(type, data, tenant);
}

const sim = new Simulator(emit, { seed: 1337 });
sim.start();

if (process.env.EVE_FILE) {
  const replay = new SuricataReplay((t, d) => emit(t, d, API_TENANT), { file: process.env.EVE_FILE });
  replay.load().then((n) => { replay.start(); console.log(`  ✦ Adapter Suricata actif : ${n} événements EVE → tenant ${API_TENANT}`); })
    .catch((e) => console.error('  ✦ Adapter Suricata: échec —', e.message));
}

// ---------- helpers ----------
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(b)); req.on('error', reject);
  });
}
function parseCookies(req) {
  const out = {}; const h = req.headers.cookie;
  if (h) for (const part of h.split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
// Utilisateur courant (ou identité démo si auth désactivée).
function currentUser(req) {
  if (!AUTH) return { username: 'demo', role: 'admin', tenant: SIM_TENANT };
  return db.getSession(parseCookies(req).orion_session);
}
const can = (user, ...roles) => user && roles.includes(user.role);

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = normalize(join(WEB, urlPath));
  if (!filePath.startsWith(WEB)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); }
}

// ---------- ingestion universelle ----------
async function handleIngest(req, res) {
  const user = currentUser(req);
  const keyOk = API_KEY && req.headers['x-api-key'] === API_KEY;
  if (!keyOk && !can(user, 'admin')) return json(res, 401, { error: 'clé API ou session admin requise' });
  const tenant = keyOk ? API_TENANT : user.tenant;
  let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'JSON invalide' }); }
  const items = Array.isArray(body) ? body : [body];
  const ids = [];
  for (const item of items) {
    let out;
    if (item.event_type) out = normalizeEve(item, item.incident || null);
    else if (item.severity) out = { type: 'event', data: makeEvent(item) };
    if (out?.type === 'event') { emit('event', out.data, tenant); ids.push(out.data.id); }
    else if (out?.type === 'flux') emit('flux', out.data, tenant);
  }
  json(res, 202, { ok: true, ingested: ids.length, ids });
}

// ---------- workflow d'incident ----------
async function handleIncidentAction(req, res, id, user) {
  if (!can(user, 'analyst', 'admin')) return json(res, 403, { error: 'rôle analyste requis' });
  let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'JSON invalide' }); }
  let inc = db.getIncident(id);
  if (!inc || inc.tenant !== user.tenant) return json(res, 404, { error: 'incident inconnu' });
  const { action, value } = body;
  const who = value || user.username;
  switch (action) {
    case 'ack': inc = db.updateIncident(id, { status: 'ack', owner: who }); break;
    case 'assign': inc = db.updateIncident(id, { owner: value }); break;
    case 'resolve': inc = db.updateIncident(id, { status: 'resolved' }); break;
    case 'false_positive': inc = db.updateIncident(id, { status: 'false_positive' }); break;
    case 'reopen': inc = db.updateIncident(id, { status: 'open' }); break;
    case 'note': inc = db.addNote(id, { author: user.username, text: value || '' }); break;
    case 'contain':
      inc = db.updateIncident(id, { status: 'ack', owner: who });
      if (inc.target?.startsWith('host-')) {
        broadcast('body_status', { id: inc.target, status: 'offline' }, inc.tenant);
        emit('event', makeEvent({ severity: 'medium', type: 'response', src: 'orion-soar', dst: inc.target, incident: id,
          title: `Confinement : hôte ${inc.target.replace('host-', '')} isolé du réseau`, raw: { playbook: 'isolate-host', by: user.username } }), inc.tenant);
      }
      break;
    default: return json(res, 400, { error: 'action inconnue' });
  }
  broadcast('incident_update', { ...inc, action }, inc.tenant);
  json(res, 200, { ok: true, incident: inc });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // --- auth (public) ---
  if (p === '/api/login' && req.method === 'POST') {
    let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'JSON invalide' }); }
    const user = db.verifyLogin(b.username || '', b.password || '');
    if (!user) return json(res, 401, { error: 'identifiants invalides' });
    const token = db.createSession(user.id);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `orion_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` });
    return res.end(JSON.stringify({ user: { username: user.username, role: user.role, tenant: user.tenant } }));
  }
  if (p === '/api/logout' && req.method === 'POST') {
    db.deleteSession(parseCookies(req).orion_session);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'orion_session=; HttpOnly; Path=/; Max-Age=0' });
    return res.end('{"ok":true}');
  }
  if (p === '/api/me') {
    const u = currentUser(req);
    return u ? json(res, 200, { user: u, auth: AUTH }) : json(res, 401, { error: 'non authentifié' });
  }

  // --- au-delà : authentification requise (si activée) ---
  const user = currentUser(req);
  if (AUTH && !user && (p === '/stream' || p.startsWith('/api/'))) return json(res, 401, { error: 'non authentifié' });
  const tenant = user ? user.tenant : SIM_TENANT;

  if (p === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    // snapshot : topologie sim uniquement pour le tenant démo ; sinon cosmos vierge (se peuple via ingestion)
    const snap = tenant === SIM_TENANT ? sim.snapshot() : { zones: [], bodies: [], ts: Date.now() };
    res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
    res.write(`event: history\ndata: ${JSON.stringify(db.recentEvents(tenant, 150))}\n\n`);
    res.write(`event: incidents\ndata: ${JSON.stringify(db.listIncidents(tenant))}\n\n`);
    const client = { res, tenant };
    clients.add(client);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(client); });
    return;
  }

  // --- API (authentifiée) ---
  if (p === '/api/health') return json(res, 200, { status: 'ok', clients: clients.size, tenant, ...db.stats(tenant) });
  if (p === '/api/events') return json(res, 200, db.recentEvents(tenant, Math.min(+url.searchParams.get('limit') || 100, 1000)));
  if (p === '/api/incidents') return json(res, 200, db.listIncidents(tenant));
  if (p.startsWith('/api/incidents/') && p.endsWith('/action') && req.method === 'POST') {
    return handleIncidentAction(req, res, p.slice('/api/incidents/'.length, -'/action'.length), user);
  }
  if (p.startsWith('/api/incidents/')) {
    const inc = db.getIncident(p.slice('/api/incidents/'.length));
    if (!inc || inc.tenant !== tenant) return json(res, 404, { error: 'incident inconnu' });
    return json(res, 200, { incident: inc, events: db.incidentEvents(inc.id) });
  }
  if (p === '/api/stats') return json(res, 200, db.stats(tenant));
  if (p === '/api/admin/users') {
    if (!can(user, 'admin')) return json(res, 403, { error: 'rôle admin requis' });
    if (req.method === 'POST') {
      let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'JSON invalide' }); }
      if (!b.username || !b.password) return json(res, 400, { error: 'username et password requis' });
      try { return json(res, 201, db.createUser({ ...b, tenant: user.tenant })); }
      catch { return json(res, 409, { error: 'utilisateur déjà existant' }); }
    }
    return json(res, 200, db.listUsers(user.tenant));
  }
  if (p === '/ingest' && req.method === 'POST') return handleIngest(req, res);

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  ✦ ORION — SOC cosmos`);
  console.log(`  ✦ http://localhost:${PORT}  ·  auth: ${AUTH ? 'ACTIVÉE' : 'désactivée'}  ·  tenant sim: ${SIM_TENANT}`);
  if (AUTH && db._seededPw) {
    console.log(`  ✦ Comptes créés (tenant orion-demo, mot de passe « ${db._seededPw} ») :`);
    console.log(`      admin / analyste / observateur   (rôles : admin · analyst · viewer)`);
  }
  console.log(`  ✦ API: /api/health /api/events /api/incidents  ·  Ingestion: POST /ingest\n`);
});
