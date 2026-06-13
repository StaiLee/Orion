// Outil de dev : pilote Chrome, attend le rendu WebGL, capture des frames.
// Usage : node tools/shoot.mjs [burst]   (le serveur doit tourner sur :3000)
import puppeteer from 'puppeteer-core';
import { login } from './_login.mjs';

const CHROME = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.ORION_URL || 'http://localhost:3000';
const BURST = process.argv.includes('burst');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox',
    '--window-size=1600,900',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await login(page, URL);

if (BURST) {
  // kill chain lancée à ~4s ; étapes ~4,7.2,10.4,13.8,17.2,20.8s → on rafale dessus
  await sleep(4000);
  for (let i = 0; i < 16; i++) {
    await sleep(1100);
    await page.screenshot({ path: `.shots/b${String(i).padStart(2, '0')}.png` });
  }
  console.log('burst: .shots/b00..b15.png');
} else {
  await sleep(6000);
  await page.screenshot({ path: '.shots/01-calm.png' });
  await sleep(9000);
  await page.screenshot({ path: '.shots/02-attack.png' });
  console.log('shots: .shots/01-calm.png, .shots/02-attack.png');
}
console.log(logs.length ? logs.join('\n') : '(aucune erreur page)');
await browser.close();
