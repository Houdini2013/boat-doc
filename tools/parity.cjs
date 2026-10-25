/* Prüft: Eigner-Kalkulator rechnet mit den Preisen der Marina exakt wie core.js (Backend/Website),
   MwSt. und Währung kommen vom Land der Marina. Demo-Modus (statischer Server auf BASE). */
const { chromium } = require('playwright');
const Core = require('../core.js');
const B = process.env.BASE || 'http://localhost:8100';
const PREISE = { ruest: 260, laser_h: 185, laser_m2h: 2.4, schliff_h: 72, primer_l: 31, af_l: 47, lack_l: 52, km: 0.8, spanne: 10, det_h: 110, det_min: 950 };
(async () => {
  const br = await chromium.launch(); const fehler = []; let n = 0;
  const ctx = await br.newContext({ locale: 'de-DE' }); const p = await ctx.newPage();
  p.on('pageerror', e => fehler.push('pageerror ' + e.message));
  await p.goto(B + '/partner.html'); await p.waitForSelector('[data-demo]');
  await p.evaluate(async (pr) => {
    await Boatsdoc.call('POST', '/api/auth/login', { email: 'demo@marina-schleibucht.de', passwort: 'demo1234' });
    await Boatsdoc.call('PUT', '/api/partner', { preise: pr, detailing: { aktiv: true } });
  }, PREISE);
  const pruefe = async (slug, land, lang) => {
    await p.goto(B + '/kalkulator.html?p=' + slug + (lang ? '&lang=' + lang : '')); await p.waitForSelector('body:not(.lade)'); await p.waitForTimeout(300);
    const partner = await p.evaluate(() => PARTNER);
    for (const prod of ['uws', 'det']) {
      const pakete = prod === 'uws' ? ['af', 'full', 'strip'] : ['pflege', 'restau', 'keramik'];
      for (const pk of pakete) for (const boot of ['2', '6', '9']) for (const z of ['leicht', 'mittel', 'stark']) {
        const k = await p.evaluate(([prod, pk, boot, z]) => {
          PROD = prod; SEL[prod] = pk; document.getElementById('bootSelect').value = boot;
          const b = CFG.boote[+boot]; document.getElementById('lwl').value = b.lwl; document.getElementById('breite').value = b.b; document.getElementById('tiefgang').value = b.t; document.getElementById('bootstyp').value = b.typ;
          document.getElementById('zustand').value = z; render(); return letzteKalkulation;
        }, [prod, pk, boot, z]);
        n++;
        const b = k.boot;
        const soll = prod === 'uws'
          ? Core.richtpreis(partner.preise, k.flaeche_m2, pk, { leicht: 0.85, mittel: 1, stark: 1.35 }[z])
          : Core.richtpreisDet(partner.preise, b.lwl, b.breite, b.rumpf, pk, z);
        if (soll.von !== k.preis_netto_von || soll.bis !== k.preis_netto_bis) fehler.push(`${slug} ${prod}/${pk}/${boot}/${z}: Kalkulator ${k.preis_netto_von}–${k.preis_netto_bis}, Kern ${soll.von}–${soll.bis}`);
        if (k.land !== land) fehler.push(`${slug} ${lang}: Land ${k.land} statt ${land}`);
      }
    }
    const w = await p.evaluate(() => [letzteKalkulation.waehrung, letzteKalkulation.mwst_satz, document.getElementById('preisSpanne').textContent]);
    console.log(slug, lang || '-', 'Währung', w[0], 'MwSt', w[1], 'Anzeige', w[2]);
  };
  await pruefe('marina-schleibucht', 'DE');
  await pruefe('marina-schleibucht', 'DE', 'sv');
  await pruefe('bohusvarvet', 'SE', 'de');
  await pruefe('bohusvarvet', 'SE', 'en');
  console.log('Kombinationen geprüft:', n);
  console.log('FEHLER', JSON.stringify(fehler, null, 1));
  await br.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
