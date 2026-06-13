// Capture : modal d'incident (workflow), panneau threat-intel d'un événement, palette.
import puppeteer from 'puppeteer-core';
import { login } from './_login.mjs';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--window-size=1600,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await login(page);
await sleep(14000);

// 1) Modal d'incident avec workflow
await page.evaluate(() => { const o = window.__orion; const id = o.store.incidentList()[0]?.id; if (id) o.hud.openIncident(id); });
await sleep(700);
await page.screenshot({ path: '.shots/f-incident.png' });

// 2) Panneau threat-intel : ouvre le détail d'un événement IOC s'il y en a un
await page.evaluate(() => {
  const o = window.__orion;
  document.getElementById('modal').classList.remove('open');
  const ev = o.store.events.find((e) => e.intel?.match) || o.store.events.find((e) => e.geo) || o.store.events[0];
  if (ev) o.hud.showEvent(ev);
});
await sleep(500);
await page.screenshot({ path: '.shots/f-intel.png' });

// 3) Command palette
await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
await sleep(250); await page.type('#palette-input', 'inc');
await sleep(350); await page.screenshot({ path: '.shots/f-palette.png' });

await browser.close();
console.log('f-incident.png, f-intel.png, f-palette.png');
console.log(logs.length ? logs.join('\n') : '(aucune erreur page)');
