/* Prüft die veröffentlichte Fassung im Demo-Modus (ohne Server): node tools/demo_check.cjs <out> <publishdir> */
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2], PUB = process.argv[3], B = 'http://localhost:8100';
(async () => {
  /* Startseite wie im Artifact: mit Gerüst umhüllen */
  const s = fs.readFileSync(PUB + '/index.html', 'utf8');
  fs.writeFileSync(PUB + '/_test_index.html', /^<!doctype/i.test(s) ? s : '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + s + '</body></html>');
  const br = await chromium.launch(); const errs = [];
  const watch = (p, n) => { p.on('pageerror', e => errs.push(n + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/api\/(ping|region|fx)|laser-|404/.test(m.text())) errs.push(n + ' console ' + m.text()); }); };
  for (const [name, vp, scheme] of [['d-light', { width: 1280, height: 860 }, 'light'], ['m-dark', { width: 390, height: 844 }, 'dark']]) {
    const c = await br.newContext({ viewport: vp, colorScheme: scheme, locale: 'de-DE', deviceScaleFactor: vp.width < 500 ? 2 : 1 });
    const p = await c.newPage(); watch(p, name);
    await p.goto(B + '/_test_index.html'); await p.waitForTimeout(1200);
    await p.screenshot({ path: OUT + '/site-' + name + '.png', fullPage: true });
    console.log(name, 'overflow', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    await c.close();
  }
  /* Demo: Kalkulator → Backend → Angebot */
  const c = await br.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-DE' });
  const k = await c.newPage(); watch(k, 'kalk');
  await k.goto(B + '/kalkulator.html?p=marina-schleibucht'); await k.waitForSelector('body:not(.lade)');
  await k.setInputFiles('#fileInput', [1, 2, 3].map(i => '/home/claude/boatsdoc/media/pilot8-' + i + '.jpg'));
  await k.locator('.cal-d.ok').first().click();
  await k.fill('#lName', 'Demo Eigner'); await k.fill('#lEmail', 'demo@example.de'); await k.fill('#lPlz', '24376');
  for (const x of await k.locator('#checks input').all()) await x.check();
  await k.click('#leadBtn'); await k.waitForSelector('#leadOk a', { timeout: 15000 });
  const link = await k.getAttribute('#leadOk a', 'href');
  const p = await c.newPage(); watch(p, 'partner');
  await p.goto(B + '/partner.html'); await p.waitForSelector('[data-demo]');
  await p.click('[data-demo="demo@marina-schleibucht.de"]'); await p.waitForSelector('.test');
  await p.screenshot({ path: OUT + '/demo-partner.png' });
  await p.click('nav.side button[data-v=anfragen]'); await p.waitForTimeout(500);
  await p.click('.item:has-text("Demo Eigner")'); await p.waitForSelector('#fAngebot');
  await p.click('#fAngebot button[type=submit]'); await p.waitForTimeout(700);
  const a = await c.newPage(); watch(a, 'angebot'); await a.goto(link); await a.waitForSelector('#ja'); await a.click('#ja'); await a.waitForSelector('#st');
  console.log('demo flow ok');
  console.log('ERRORS', JSON.stringify(errs, null, 1));
  fs.unlinkSync(PUB + '/_test_index.html'); await br.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
