// Orion — serveur (SQLite natif, sinon zéro dépendance).
// Sert le frontend + diffuse les Events Orion via SSE + persiste + API REST + ingestion.
// Déploiement : `node server.js` puis http://localhost:3000
//
// SSE est choisi volontairement (vs WebSocket) : flux serveur→client unidirectionnel,
// natif navigateur (EventSource), aucune dépendance, aucun build.

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
const API_KEY = process.env.ORION_API_KEY || null; // si défini, /ingest l'exige

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const db = new OrionDB(process.env.ORION_DB || join(__dirname, 'orion.db'));

/** @type {Set<http.ServerResponse>} */
const clients = new Set();

function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch { clients.delete(res); } }
}

// Tout passe par emit() : on ENRICHIT, on PERSISTE, puis on diffuse. Les adapters n'appellent que ça.
function emit(type, data) {
  if (type === 'event') {
    enrich(data);                                  // threat intel : géo + réputation IOC
    try { db.insertEvent(data); } catch (e) { console.error('db:', e.message); }
  }
  broadcast(type, data);
}

// Le simulateur émet des objets Orion ; le serveur persiste + relaie.
const sim = new Simulator(emit, { seed: 1337 });
sim.start();

// Adapter source réelle (optionnel) : EVE_FILE=sim/samples/eve.sample.jsonl node server.js
if (process.env.EVE_FILE) {
  const replay = new SuricataReplay(emit, { file: process.env.EVE_FILE });
  replay.load()
    .then((n) => { replay.start(); console.log(`  ✦ Adapter Suricata actif : ${n} événements EVE`); })
    .catch((e) => console.error('  ✦ Adapter Suricata: échec —', e.message));
}

// ---------- helpers ----------
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(b)); req.on('error', reject);
  });
}

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
// POST /ingest : accepte un Event Orion natif OU une ligne Suricata EVE (auto-détecté).
// Header x-api-key requis si ORION_API_KEY est défini. → n'importe quel outil peut pousser.
async function handleIngest(req, res) {
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) return json(res, 401, { error: 'clé API invalide' });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'JSON invalide' }); }
  const items = Array.isArray(body) ? body : [body];
  const ids = [];
  for (const item of items) {
    let out;
    if (item.event_type) out = normalizeEve(item, item.incident || null); // format Suricata EVE
    else if (item.severity) out = { type: 'event', data: makeEvent(item) }; // Event Orion natif
    if (out?.type === 'event') { emit('event', out.data); ids.push(out.data.id); }
    else if (out?.type === 'flux') emit('flux', out.data);
  }
  json(res, 202, { ok: true, ingested: ids.length, ids });
}

// Workflow d'incident : prise en charge, assignation, résolution, faux positif, note, confinement.
async function handleIncidentAction(req, res, id) {
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) return json(res, 401, { error: 'clé API invalide' });
  let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'JSON invalide' }); }
  const { action, value, author } = body;
  let inc = db.getIncident(id);
  if (!inc) return json(res, 404, { error: 'incident inconnu' });

  switch (action) {
    case 'ack': inc = db.updateIncident(id, { status: 'ack', owner: value || author || 'analyste' }); break;
    case 'assign': inc = db.updateIncident(id, { owner: value }); break;
    case 'resolve': inc = db.updateIncident(id, { status: 'resolved' }); break;
    case 'false_positive': inc = db.updateIncident(id, { status: 'false_positive' }); break;
    case 'reopen': inc = db.updateIncident(id, { status: 'open' }); break;
    case 'note': inc = db.addNote(id, { author: author || 'analyste', text: value || '' }); break;
    case 'contain': {
      // SOAR-lite : isole l'hôte cible (containment) — visible dans le cosmos + journalisé
      inc = db.updateIncident(id, { status: 'ack', owner: value || author || 'analyste' });
      if (inc.target?.startsWith('host-')) {
        broadcast('body_status', { id: inc.target, status: 'offline' });
        emit('event', makeEvent({
          severity: 'medium', type: 'response', src: 'orion-soar', dst: inc.target,
          incident: id, title: `Confinement : hôte ${inc.target.replace('host-', '')} isolé du réseau`,
          raw: { playbook: 'isolate-host', action: 'quarantine', by: value || author || 'analyste' },
        }));
      }
      break;
    }
    default: return json(res, 400, { error: 'action inconnue' });
  }
  broadcast('incident_update', { ...inc, action });
  json(res, 200, { ok: true, incident: inc });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // Flux temps réel
  if (p === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    res.write(`event: snapshot\ndata: ${JSON.stringify(sim.snapshot())}\n\n`);
    res.write(`event: history\ndata: ${JSON.stringify(db.recentEvents(150))}\n\n`); // backfill : dashboard non vide
    res.write(`event: incidents\ndata: ${JSON.stringify(db.listIncidents())}\n\n`); // statuts/propriétaires/notes
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  // API REST
  if (p === '/api/health') return json(res, 200, { status: 'ok', clients: clients.size, ...db.stats() });
  if (p === '/api/events') return json(res, 200, db.recentEvents(Math.min(+url.searchParams.get('limit') || 100, 1000)));
  if (p === '/api/incidents') return json(res, 200, db.listIncidents());
  if (p.startsWith('/api/incidents/') && p.endsWith('/action') && req.method === 'POST') {
    return handleIncidentAction(req, res, p.slice('/api/incidents/'.length, -'/action'.length));
  }
  if (p.startsWith('/api/incidents/')) {
    const id = p.slice('/api/incidents/'.length);
    const inc = db.getIncident(id);
    if (!inc) return json(res, 404, { error: 'incident inconnu' });
    return json(res, 200, { incident: inc, events: db.incidentEvents(id) });
  }
  if (p === '/api/stats') return json(res, 200, db.stats());
  if (p === '/ingest' && req.method === 'POST') return handleIngest(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-api-key', 'Access-Control-Allow-Methods': 'GET,POST' }); return res.end(); }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  ✦ ORION — SOC cosmos`);
  console.log(`  ✦ http://localhost:${PORT}  ·  API: /api/health /api/events /api/incidents`);
  console.log(`  ✦ Ingestion : POST /ingest ${API_KEY ? '(clé API requise)' : '(ouvert — définir ORION_API_KEY pour sécuriser)'}`);
  console.log(`  ✦ Persistance : ${process.env.ORION_DB || 'orion.db'} · simulateur actif\n`);
});
