// Vue du dessus + vue large pour juger l'espacement de la topologie.
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--window-size=1600,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
await sleep(15000); // laisse quelques découvertes d'actifs peupler la scène
// vue du dessus
await page.evaluate(() => {
  const o = window.__orion; const cam = o.renderer.camera, ctl = o.renderer.controls;
  o.renderer._introT = 1; ctl.enabled = true; ctl.autoRotate = false;
  cam.position.set(0, 320, 0.1); ctl.target.set(0, 0, 0); ctl.update();
});
await sleep(1200);
await page.screenshot({ path: '.shots/top.png' });
// vue large 3/4
await page.evaluate(() => {
  const o = window.__orion; const cam = o.renderer.camera, ctl = o.renderer.controls;
  cam.position.set(0, 150, 240); ctl.target.set(0, 0, 0); ctl.update();
});
await sleep(1000);
await page.screenshot({ path: '.shots/wide.png' });
await browser.close();
console.log('top.png + wide.png');
