// Gros plan : rapproche la caméra pour inspecter le détail de surface des planètes.
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
await login(page);
await sleep(5000);
await page.evaluate(() => {
  const o = window.__orion; if (!o) return;
  o.renderer._introT = 1; o.renderer.controls.enabled = true; o.renderer.controls.autoRotate = false;
  o.renderer.focusBody('host-10.0.2.1'); // passerelle Prod = centre du système Orion-A
});
await sleep(1500);
await page.screenshot({ path: '.shots/closeup.png' });
await browser.close();
console.log('closeup: .shots/closeup.png');
