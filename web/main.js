// Orion — point d'entrée. Vérifie la session, puis câble SSE → store → (renderer + HUD + son).

import { OrionStore } from './store.js';
import { ThreeRenderer } from './cosmos.js';
import { Hud } from './hud.js';
import { SoundEngine } from './sound.js';

init();

async function init() {
  // Garde d'accès : pas de session → page de connexion.
  let me;
  try { const r = await fetch('/api/me'); if (!r.ok) return redirectLogin(); me = await r.json(); }
  catch { return redirectLogin(); }

  const store = new OrionStore();
  const renderer = new ThreeRenderer(document.getElementById('scene'));
  renderer.mount();
  const hud = new Hud(store, renderer);
  const sound = new SoundEngine();
  hud.setUser(me.user);
  window.__orion = { store, renderer, hud, sound, user: me.user };

  // Barre : identité + déconnexion
  const chip = document.getElementById('user-chip');
  if (chip) chip.textContent = `${me.user.username} · ${roleLabel(me.user.role)}`;
  const logout = document.getElementById('logout');
  if (logout) {
    logout.style.display = me.auth ? '' : 'none';
    logout.addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); redirectLogin(); });
  }

  // Toggle son
  const soundBtn = document.getElementById('sound');
  soundBtn.addEventListener('click', () => {
    const on = soundBtn.getAttribute('aria-pressed') !== 'true';
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.classList.toggle('active', on);
    on ? sound.enable() : sound.disable();
  });

  const _prevSupernova = renderer.onSupernova;
  renderer.onSupernova = () => { if (_prevSupernova) _prevSupernova(); sound.supernova(); };

  store.subscribe((kind, payload) => {
    switch (kind) {
      case 'snapshot': renderer.buildFromSnapshot(payload); hud.onSnapshot(); hideBoot(); break;
      case 'event':
        renderer.spawnEvent(payload); hud.onEvent(payload);
        if (payload.severity === 'high' || payload.severity === 'critical') sound.alert(payload.severity);
        break;
      case 'body_status': renderer.setBodyStatus(payload.id, payload.status); hud.onBodyStatus(payload); break;
      case 'body_add': renderer.addBodyDynamic(payload); hud.onBodyAdd(payload); break;
      case 'flux': renderer.drawFlux(payload); break;
      case 'history': hud.onHistory(payload); break;
      case 'incidents_meta': hud.onIncidentsMeta(); break;
      case 'incident_update': hud.onIncidentUpdate(payload); break;
    }
  });

  connect(store, hud);
}

function connect(store, hud) {
  const es = new EventSource('/stream');
  es.addEventListener('open', () => hud.setConnected(true));
  es.addEventListener('error', () => hud.setConnected(false));
  es.addEventListener('snapshot', (e) => store.applySnapshot(JSON.parse(e.data)));
  es.addEventListener('history', (e) => store.applyHistory(JSON.parse(e.data)));
  es.addEventListener('incidents', (e) => store.applyIncidentsMeta(JSON.parse(e.data)));
  es.addEventListener('incident_update', (e) => store.applyIncidentUpdate(JSON.parse(e.data)));
  es.addEventListener('event', (e) => store.applyEvent(JSON.parse(e.data)));
  es.addEventListener('body_status', (e) => store.applyBodyStatus(JSON.parse(e.data)));
  es.addEventListener('body_add', (e) => store.applyBodyAdd(JSON.parse(e.data)));
  es.addEventListener('flux', (e) => store.applyFlux(JSON.parse(e.data)));
}

function redirectLogin() { location.href = '/login.html'; }
function roleLabel(r) { return { admin: 'Admin', analyst: 'Analyste', viewer: 'Observateur' }[r] || r; }

const _bootStart = Date.now();
let _bootDone = false;
function hideBoot() {
  if (_bootDone) return; _bootDone = true;
  const wait = Math.max(0, 1600 - (Date.now() - _bootStart));
  setTimeout(() => { const b = document.getElementById('boot'); if (b) { b.classList.add('hide'); setTimeout(() => b.remove(), 900); } }, wait);
}
