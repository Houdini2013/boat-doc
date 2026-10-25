/* Selbstbedienungs-Ablauf Ende zu Ende: node tools/selbstbedienung.cjs <ausgabeordner>
   Startseite „Jetzt testen“ → Startassistent → Logo → Preise → Probeanfrage als Eigner → Festpreis → Annahme
   → Zugang sichern → Live schalten → Sales-Cockpit. Server auf BASE (Standard Port 8099). */
const { chromium } = require('playwright');
const path = require('path');
const B = process.env.BASE || 'http://localhost:8099', OUT = process.argv[2];
const MEDIA = path.join(__dirname, '..', 'media');
(async () => {
  const br = await chromium.launch(); const fehler = [];
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const watch = (p, n) => { p.on('pageerror', e => fehler.push(n + ' ' + e.message)); p.on('console', m => m.type() === 'error' && fehler.push(n + ' console ' + m.text())); };
  const p = await ctx.newPage(); watch(p, 'site');
  await p.goto(B + '/'); await p.waitForSelector('#teForm');
  await p.locator('#testen').scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + '/1-testen.png' });
  await p.fill('#teName', 'Marina Probehafen'); await p.selectOption('#teLand', 'SE'); await p.fill('#tePl', '240');
  await p.click('#teBtn'); await p.waitForURL(/partner\.html#start/); await p.waitForSelector('.stp');
  await p.screenshot({ path: OUT + '/2-start.png', fullPage: true });
  /* Schritt 1: Auftritt mit Logo */
  await p.click('[data-go=teilen]'); await p.waitForSelector('#logoIn', { state: 'attached' });
  await p.setInputFiles('#logoIn', MEDIA + '/pilot8-1.jpg'); await p.waitForSelector('#logoWeg');
  await p.fill('#aTel', '+46 31 000000'); await p.click('#aSave'); await p.waitForTimeout(600);
  /* Schritt 2: Preise speichern */
  await p.click('nav.side button[data-v=preise]'); await p.waitForSelector('#prSave'); await p.fill('#pr_laser_h', '180'); await p.click('#prSave'); await p.waitForTimeout(500);
  /* Schritt 3+4: eigener Rechner, Probeanfrage als Eigner */
  const me = await p.evaluate(() => S.me.slug);
  const k = await ctx.newPage(); watch(k, 'kalk');
  await k.goto(B + '/kalkulator.html?p=' + me + '&probe=1'); await k.waitForSelector('body:not(.lade)');
  await k.screenshot({ path: OUT + '/3-rechner-probe.png' });
  await k.setInputFiles('#fileInput', [1, 2, 3].map(i => MEDIA + '/finnmaster-' + i + '.jpg'));
  await k.locator('.cal-d.ok').first().click();
  await k.fill('#lName', 'Test Eigner'); await k.fill('#lEmail', 'ich@marina.se'); await k.fill('#lPlz', '45131');
  for (const c of await k.locator('#checks input').all()) await c.check();
  await k.click('#leadBtn'); await k.waitForSelector('#leadOk a', { timeout: 15000 });
  const link = await k.getAttribute('#leadOk a', 'href');
  /* Schritt 5: Festpreis senden */
  await p.bringToFront(); await p.click('nav.side button[data-v=anfragen]'); await p.waitForTimeout(500);
  await p.click('.item:has-text("Test Eigner")'); await p.waitForSelector('#fAngebot');
  await p.screenshot({ path: OUT + '/4-probeanfrage.png' });
  await p.fill('#anNetto', '2400'); await p.click('#fAngebot button[type=submit]'); await p.waitForTimeout(800);
  await p.click('#wgBtn'); await p.waitForTimeout(600);   // an Test-Laser-Partner
  await p.click('#dzu');
  /* Eigner nimmt an */
  const a = await ctx.newPage(); watch(a, 'angebot'); await a.goto(link); await a.waitForSelector('#ja');
  await a.screenshot({ path: OUT + '/5-angebot-probe.png', fullPage: true });
  await a.click('#ja'); await a.waitForTimeout(800);
  const st = await a.evaluate(() => D.status); console.log('Status nach Annahme:', st);
  /* Startassistent: Teilen + Zugang sichern + live */
  await p.bringToFront(); await p.click('nav.side button[data-v=teilen]'); await p.waitForTimeout(500);
  await p.click('nav.side button[data-v=start]'); await p.waitForSelector('#kontoForm');
  await p.screenshot({ path: OUT + '/6-start-fast-fertig.png', fullPage: true });
  await p.fill('#ksMail', 'hafen' + Date.now() + '@probehafen.se'); await p.fill('#ksPw', 'sicher-12345'); await p.click('#kontoForm button[type=submit]');
  await p.waitForSelector('#liveForm'); await p.check('#lvAgb'); await p.check('#lvAvv'); await p.click('#liveForm button[type=submit]');
  await p.waitForSelector('.test'); const modus = await p.evaluate(() => S.me.modus); console.log('Modus:', modus);
  /* Sales-Cockpit */
  const c2 = await br.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' }); const adm = await c2.newPage(); watch(adm, 'admin');
  await adm.goto(B + '/partner.html'); await adm.fill('#lgEmail', 'admin@boatsdoc.com'); await adm.fill('#lgPw', 'demo1234'); await adm.click('#loginForm button[type=submit]');
  await adm.waitForSelector('nav.side'); await adm.click('nav.side button[data-v=admin]'); await adm.waitForSelector('.kpis');
  await adm.screenshot({ path: OUT + '/7-cockpit.png', fullPage: true });
  /* Handy */
  const m = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE' }); const mp = await m.newPage(); watch(mp, 'mobil');
  await mp.goto(B + '/'); await mp.waitForSelector('#teForm'); await mp.fill('#teName', 'Hafen Mobil'); await mp.click('#teBtn'); await mp.waitForSelector('.stp');
  await mp.screenshot({ path: OUT + '/8-start-mobil.png', fullPage: true });
  console.log('Überbreite mobil:', await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  console.log('FEHLER', JSON.stringify(fehler, null, 1));
  await br.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
