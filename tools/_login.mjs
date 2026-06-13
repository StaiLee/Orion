// helper : connexion via la page de login
export async function login(page, base = 'http://localhost:3000', username = 'admin', password = 'orion') {
  await page.goto(base + '/login.html', { waitUntil: 'networkidle2' });
  await page.type('#u', username);
  await page.type('#p', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.click('button[type=submit]'),
  ]);
}
