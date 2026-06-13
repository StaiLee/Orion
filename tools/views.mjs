// Capture les vues Matrice ATT&CK et Incidents (clique la nav).
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
await sleep(14000); // laisse 2 kill chains se dérouler pour peupler matrice + incidents
const click = (v) => page.evaluate((vv) => document.querySelector(`#views button[data-view="${vv}"]`).click(), v);
await click('matrix'); await sleep(800); await page.screenshot({ path: '.shots/v-matrix.png' });
await click('incidents'); await sleep(800); await page.screenshot({ path: '.shots/v-incidents.png' });
await browser.close();
console.log('vues: .shots/v-matrix.png, .shots/v-incidents.png');
