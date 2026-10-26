/* Ende-zu-Ende-Test mit Bildschirmfotos: node tools/e2e.cjs <ausgabeordner> <medienordner> */
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8099', OUT = process.argv[2], MEDIA = process.argv[3];
(async () => {
  const br = await chromium.launch(); const errs = [];
  const watch = (p, n) => { p.on('pageerror', e => errs.push(n + ' pageerror ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push(n + ' console ' + m.text())); };
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const pg = await ctx.newPage(); watch(pg, 'kalk');
  await pg.goto(B + '/kalkulator.html?p=marina-schleibucht'); await pg.waitForSelector('body:not(.lade)');
  await pg.screenshot({ path: OUT + '/k1.png' });
  await pg.setInputFiles('#fileInput', [1, 2, 3].map(i => MEDIA + '/pilot8-' + i + '.jpg'));
  await pg.locator('.cal-d.ok').first().click();
  await pg.fill('#lName', 'Anna Lindqvist'); await pg.fill('#lEmail', 'anna@example.de'); await pg.fill('#lPlz', '24376');
  for (const c of await pg.locator('#checks input').all()) await c.check();
  await pg.locator('#calc').screenshot({ path: OUT + '/k2.png' });
  await pg.click('#leadBtn'); await pg.waitForSelector('#leadOk a', { timeout: 15000 });
  const link = await pg.getAttribute('#leadOk a', 'href');
  await pg.locator('#leadOk').screenshot({ path: OUT + '/k3.png' });
  const p2 = await ctx.newPage(); watch(p2, 'partner');
  await p2.goto(B + '/partner.html'); await p2.fill('#lgEmail', 'demo@marina-schleibucht.de'); await p2.fill('#lgPw', 'demo1234'); await p2.click('#loginForm button[type=submit]');
  await p2.waitForSelector('.test'); await p2.screenshot({ path: OUT + '/p1.png', fullPage: true });
  await p2.click('.item[data-id]'); await p2.waitForSelector('#fAngebot'); await p2.waitForTimeout(300);
  await p2.screenshot({ path: OUT + '/p2.png' });
  await p2.fill('#anNetto', '2600'); await p2.click('#fAngebot button[type=submit]'); await p2.waitForTimeout(800);
  const p3 = await ctx.newPage(); watch(p3, 'angebot');
  await p3.goto(link); await p3.waitForSelector('#ja'); await p3.screenshot({ path: OUT + '/a1.png', fullPage: true });
  await p3.click('[data-w=finanzierung]'); await p3.click('#ja'); await p3.waitForSelector('#st'); await p3.screenshot({ path: OUT + '/a2.png', fullPage: true });
  for (const v of ['preise', 'teilen', 'finanzierung', 'abrechnung', 'konto']) { await p2.goto(B + '/partner.html#' + v); await p2.waitForTimeout(1000); await p2.screenshot({ path: OUT + '/v_' + v + '.png', fullPage: true }); }
  const m = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const mp = await m.newPage(); watch(mp, 'mobile');
  await mp.goto(B + '/partner.html'); await mp.fill('#lgEmail', 'demo@marina-schleibucht.de'); await mp.fill('#lgPw', 'demo1234'); await mp.click('#loginForm button[type=submit]'); await mp.waitForSelector('.test');
  await mp.screenshot({ path: OUT + '/m1.png', fullPage: true });
  console.log('mobile overflow', await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  console.log('ERRORS', JSON.stringify(errs, null, 1)); await br.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
