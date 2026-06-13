import puppeteer from 'puppeteer-core';
import { login } from './_login.mjs';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--window-size=1600,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:3000/login.html', { waitUntil: 'networkidle2' });
await sleep(800); await page.screenshot({ path: '.shots/login.png' });
await login(page);
await sleep(7000); await page.screenshot({ path: '.shots/dashboard-auth.png' });
await browser.close();
console.log(errs.length ? ('ERREURS: ' + errs.join(' | ')) : 'auth OK, aucune erreur page');
