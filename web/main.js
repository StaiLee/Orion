// Orion — point d'entrée. Câble : SSE → store → (renderer + HUD + son).
// C'est le seul endroit qui connaît à la fois le réseau, l'état, le rendu et le son.

import { OrionStore } from './store.js';
import { ThreeRenderer } from './cosmos.js';
import { Hud } from './hud.js';
import { SoundEngine } from './sound.js';

const store = new OrionStore();
const renderer = new ThreeRenderer(document.getElementById('scene'));
renderer.mount();
const hud = new Hud(store, renderer);
const sound = new SoundEngine();
window.__orion = { store, renderer, hud, sound }; // introspection / outillage de dev

// Toggle son (le clic = geste utilisateur requis pour démarrer l'AudioContext)
const soundBtn = document.getElementById('sound');
soundBtn.addEventListener('click', () => {
  const on = soundBtn.getAttribute('aria-pressed') !== 'true';
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.classList.toggle('active', on);
  on ? sound.enable() : sound.disable();
});

// La supernova déclenche aussi un son (en plus du flash câblé par le HUD).
const _prevSupernova = renderer.onSupernova;
renderer.onSupernova = () => { if (_prevSupernova) _prevSupernova(); sound.supernova(); };

// Le store notifie : on relaie vers le rendu, le HUD et le son.
store.subscribe((kind, payload) => {
  switch (kind) {
    case 'snapshot':
      renderer.buildFromSnapshot(payload);
      hud.onSnapshot();
      hideBoot();
      break;
    case 'event':
      renderer.spawnEvent(payload);
      hud.onEvent(payload);
      if (payload.severity === 'high' || payload.severity === 'critical') sound.alert(payload.severity);
      break;
    case 'body_status':
      renderer.setBodyStatus(payload.id, payload.status);
      hud.onBodyStatus(payload);
      break;
    case 'body_add':
      renderer.addBodyDynamic(payload);
      hud.onBodyAdd(payload);
      break;
    case 'flux':
      renderer.drawFlux(payload);
      break;
    case 'history':
      hud.onHistory(payload); // peuple le HUD sans rejouer les animations cosmos
      break;
    case 'incidents_meta':
      hud.onIncidentsMeta();
      break;
    case 'incident_update':
      hud.onIncidentUpdate(payload);
      break;
  }
});

// Séquence de boot : disparaît dès que le cosmos est bâti (min ~1.6 s pour l'effet).
const _bootStart = Date.now();
let _bootDone = false;
function hideBoot() {
  if (_bootDone) return; _bootDone = true;
  const wait = Math.max(0, 1600 - (Date.now() - _bootStart));
  setTimeout(() => {
    const b = document.getElementById('boot');
    if (b) { b.classList.add('hide'); setTimeout(() => b.remove(), 900); }
  }, wait);
}

// Abonnement SSE (le composant ne connaît que le flux d'Events Orion).
function connect() {
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
connect();
