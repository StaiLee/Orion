// Capture la séquence de boot + des frames rapprochées pendant une attaque.
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
await sleep(700);
await page.screenshot({ path: '.shots/boot.png' });
// fenêtre d'attaque : kill chain à ~4s, étapes ~3.2s, comètes ralenties
await sleep(5300);
for (let i = 0; i < 14; i++) { await sleep(550); await page.screenshot({ path: `.shots/d${String(i).padStart(2, '0')}.png` }); }
await browser.close();
console.log('drama: .shots/boot.png + d00..d13.png');
console.log(logs.length ? logs.join('\n') : '(aucune erreur page)');
