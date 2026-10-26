/* Nimmt die Anleitungsvideos vom laufenden System auf.
   node tools/videos.cjs <ausgabeordner> <medienordner>   (Server muss auf BASE laufen, frische Daten) */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const B = process.env.BASE || 'http://localhost:8099', OUT = process.argv[2], MEDIA = process.argv[3];
const W = 1280, H = 800;
const LANG = process.env.LANG_VIDEO || 'de';
const TX = JSON.parse(JSON.stringify(require('./video-texte.cjs')[LANG])); let capNr = 0;
/* Szenario je Sprache: Schweden mit GBM Marin, Norwegen mit Ravns Garage (Pilotpartner), sonst deutsche Beispiel-Marina */
const SZ = {
  sv: { neu: true, land: 'SE', marina: { name: 'GBM Marin', email: 'gbm-marin@demo.boatsdoc.com', farbe: '#1F4E8C', kontakt: { adresse: 'Havstenssund, Bohuslän' } },
        laser: { slug: 'bohusvarvet', email: 'demo@bohusvarvet.se', name: 'Bohusvarvet' },
        plz: ['45772', '45773'], namen: ['Johan Berg', 'Lars Nilsson'], tel: '+46 70 000 00 00', nachricht: 'Står på trailern vid hall 2.' },
  no: { neu: true, land: 'NO', marina: { name: 'Ravns Garage', email: 'ravns-garage@demo.boatsdoc.com', farbe: '#7A2E1F', kontakt: {} },
        laser: { neu: true, name: 'Fjord Båtservice', email: 'fjord-batservice@demo.boatsdoc.com', plz: ['31'] },
        plz: ['3110', '3111'], namen: ['Ola Nordmann', 'Lars Haugen'], tel: '+47 400 00 000', nachricht: 'Står på hengeren ved hall 2.' },
}[LANG] || { land: 'DE', marina: { slug: 'marina-schleibucht', email: 'demo@marina-schleibucht.de' }, laser: { slug: 'bootsservice-foerde', email: 'demo@bootsservice-foerde.de', name: 'Bootsservice Förde' },
  plz: ['24376', '24399'], namen: ['Jens Petersen', 'Lars Brodersen'], tel: '+49 170 0000000', nachricht: 'Steht auf dem Trailer, Halle 2.' };
TX.caps = TX.caps.map(([a, b]) => [a, b.replace('Bootsservice Förde', SZ.laser.name)]);
const LOCALE = { de: 'de-DE', en: 'en-GB', sv: 'sv-SE', no: 'nb-NO', da: 'da-DK', fi: 'fi-FI' }[LANG];

/* Untertitel + sichtbarer Mauszeiger, in jede Seite eingespielt */
const OVERLAY = `
(() => {
  if (window.__bdOv) return; window.__bdOv = true;
  const add = () => {
    const st = document.createElement('style');
    st.textContent = '#__cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:min(860px,92vw);background:rgba(16,32,31,.94);color:#fff;font:600 19px/1.35 "Source Sans 3",system-ui,sans-serif;padding:14px 22px;border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.35);text-align:center;transition:opacity .25s;border-left:4px solid #C24A21}#__cap small{display:block;font:500 11px/1.4 "IBM Plex Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:#E8A386;margin-bottom:4px}#__cur{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(194,74,33,.35);border:2px solid #C24A21;pointer-events:none;transition:transform .12s}#__cur.dn{transform:scale(.7);background:rgba(194,74,33,.7)}';
    document.head.appendChild(st);
    const c = document.createElement('div'); c.id = '__cur'; c.style.left = '-40px'; c.style.top = '-40px'; document.body.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => c.classList.add('dn'), true); addEventListener('mouseup', () => c.classList.remove('dn'), true);
  };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', add) : add();
})();`;

async function cap(p, step, text) {
  await p.evaluate(([s, t]) => {
    let d = document.getElementById('__cap'); if (!d) { d = document.createElement('div'); d.id = '__cap'; document.body.appendChild(d); }
    d.innerHTML = (s ? '<small>' + s + '</small>' : '') + t; d.style.opacity = 1;
  }, [step, text]);
}
async function capAus(p) { await p.evaluate(() => { const d = document.getElementById('__cap'); if (d) d.style.opacity = 0; }); }
const pause = (p, ms) => p.waitForTimeout(ms);
let MX = W / 2, MY = H / 2;
async function zu(p, loc, opt = {}) {
  const l = typeof loc === 'string' ? p.locator(loc).first() : loc;
  await l.scrollIntoViewIfNeeded(); await pause(p, 150);
  let b = await l.boundingBox(); if (!b) throw new Error('kein Element ' + loc);
  /* Element nicht unter dem Untertitel: in die Bildmitte holen */
  if (!opt.fix && (b.y + b.height > H - 170 || b.y < 70)) {
    await l.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'smooth' })); await pause(p, 700);
    b = await l.boundingBox();
  }
  const x = b.x + b.width * (opt.fx ?? 0.5), y = b.y + b.height * (opt.fy ?? 0.5);
  await p.mouse.move(x, y, { steps: opt.steps ?? 22 }); MX = x; MY = y; await pause(p, opt.vor ?? 250);
}
async function klick(p, loc, opt = {}) { await zu(p, loc, opt); await p.mouse.down(); await pause(p, 90); await p.mouse.up(); await pause(p, opt.nach ?? 700); }
async function tippe(p, sel, text, opt = {}) { await klick(p, sel, { nach: 200 }); await p.locator(sel).fill(''); await p.keyboard.type(text, { delay: opt.delay ?? 55 }); await pause(p, 300); }
async function scrolle(p, dy, schritte = 12) { for (let i = 0; i < schritte; i++) { await p.mouse.wheel(0, dy / schritte); await pause(p, 35); } await pause(p, 400); }
async function slider(p, sel, ziel) {
  const l = p.locator(sel); await l.scrollIntoViewIfNeeded();
  const b = await l.boundingBox(); const [mn, mx, v0] = await l.evaluate(e => [+e.min, +e.max, +e.value]);
  const x0 = b.x + (v0 - mn) / (mx - mn) * b.width, x1 = b.x + (ziel - mn) / (mx - mn) * b.width, y = b.y + b.height / 2;
  await p.mouse.move(x0, y, { steps: 15 }); await p.mouse.down(); await p.mouse.move(x1, y, { steps: 25 }); await p.mouse.up(); await pause(p, 500);
}

async function neueSeite(br, name) {
  const ctx = await br.newContext({ viewport: { width: W, height: H }, locale: LOCALE, timezoneId: 'Europe/Berlin', recordVideo: { dir: OUT + '/raw-' + name, size: { width: W, height: H } } });
  await ctx.addInitScript(OVERLAY); await ctx.addInitScript(l => { try { localStorage.setItem('bd_lang', l); } catch (_) {} }, LANG);
  return ctx;
}

(async () => {
  const br = await chromium.launch();
  const api = await (await chromium.launch()).newContext();   // für Vorbereitung ohne Video

  /* ---------- Vorbereitung: zwei frühere Anfragen, damit das Backend realistisch aussieht ---------- */
  /* Pilotpartner als Video-Konten anlegen (nur auf dem Aufnahme-Server) */
  const neuesKonto = async (name, email, extra) => { const c = await (await chromium.launch()).newContext();
    await c.request.post(B + '/api/auth/register', { data: { name, email, passwort: 'demo1234', land: SZ.land, sprache: LANG, rolle: extra.rolle } });
    await c.request.put(B + '/api/partner', { data: extra.daten }); await c.request.post(B + '/api/live', { data: { agb: true, avv: true } }); return (await (await c.request.get(B + '/api/partner')).json()); };
  const testStart = new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10);
  if (SZ.neu) {
    const m = await neuesKonto(SZ.marina.name, SZ.marina.email, { rolle: 'vermittler', daten: { farbe: SZ.marina.farbe, kontakt: SZ.marina.kontakt, test: { start: testStart, wochen: 6 }, region: { plz: [SZ.plz[0].slice(0, 2)] } } });
    SZ.marina.slug = (m.partner || m).slug;
    if (SZ.laser.neu) {
      const l = await neuesKonto(SZ.laser.name, SZ.laser.email, { rolle: 'ausfuehrend', daten: { farbe: '#1F6E4A', region: { name: '', plz: SZ.laser.plz } } });
      const adm = await (await chromium.launch()).newContext(); await adm.request.post(B + '/api/auth/login', { data: { email: 'admin@boatsdoc.com', passwort: 'demo1234' } });
      await adm.request.put(B + '/api/admin/partner/' + (l.partner || l).id, { data: { gebietsschutz: true } });
    }
  }
  const r0 = await api.request.post(B + '/api/public/' + SZ.marina.slug + '/anfragen', { data: { eigner: { name: SZ.namen[0], email: 'kunde1@example.com', plz: SZ.plz[0], sprache: LANG },
    kalkulation: { land: SZ.land, flaeche_m2: 33, preis_netto_von: 3480, preis_netto_bis: 4430, preis_brutto_von: 4140, preis_brutto_bis: 5270, paket: 'af', material: 'gfk', tage: '4-5', boot: { lwl: 8.5, breite: 3.0, tiefgang: 0.9, rumpf: 'motorboot', zustand: 'mittel' } }, wunschtermin: '2027-03-15', medien: [] } });
  const a0 = await r0.json();
  const login = async (email) => { const c = await (await chromium.launch()).newContext(); await c.request.post(B + '/api/auth/login', { data: { email, passwort: 'demo1234' } }); return c; };
  const mApi = await login(SZ.marina.email);
  await mApi.request.post(B + '/api/anfragen/' + a0.id + '/angebot', { data: { festpreis_netto: 3900, termin: '2027-03-15', tage: 5 } });
  await api.request.post(B + '/api/angebot/' + a0.token + '/annehmen', { data: { zahlart: 'anzahlung' } });
  const fotos = [];
  for (const i of [1, 2, 3]) { const r = await api.request.put(B + '/api/upload?name=finnmaster-' + i + '.jpg', { headers: { 'Content-Type': 'image/jpeg' }, data: fs.readFileSync(MEDIA + '/finnmaster-' + i + '.jpg') }); fotos.push(await r.json()); }
  await api.request.post(B + '/api/public/' + SZ.marina.slug + '/anfragen', { data: { eigner: { name: SZ.namen[1], email: 'kunde2@example.com', plz: SZ.plz[1], telefon: SZ.tel, sprache: LANG, nachricht: SZ.nachricht },
    kalkulation: { land: SZ.land, produkt: 'unterwasserschiff', flaeche_m2: 19.0, preis_netto_von: 2390, preis_netto_bis: 3040, preis_brutto_von: 2840, preis_brutto_bis: 3620, paket: 'af', material: 'gfk', tage: '3-4', boot: { lwl: 6.4, breite: 2.4, tiefgang: 0.6, rumpf: 'motorboot', zustand: 'stark' } },
    wunschtermin: '2027-04-06', medien: fotos, bestaetigungen: { osmosefrei: true } } });

  /* ================= VIDEO 1: Eigner (Frontend) ================= */
  const c1 = await neueSeite(br, 'eigner'); const p = await c1.newPage();
  await p.goto(B + '/kalkulator.html?p=' + SZ.marina.slug + '&lang=' + LANG); await p.waitForSelector('body:not(.lade)'); await pause(p, 600);
  await p.mouse.move(W / 2, H / 2);
  await cap(p, ...TX.caps[capNr++]); await pause(p, 3800);
  await cap(p, ...TX.caps[capNr++]); await klick(p, '#pkgChips .chip >> nth=0', { nach: 1400 });
  await scrolle(p, 330);
  await cap(p, ...TX.caps[capNr++]);
  await zu(p, '#bootSelect'); await p.selectOption('#bootSelect', '1'); await pause(p, 900);
  await slider(p, '#lwl', 7.6); await slider(p, '#breite', 2.8);
  await cap(p, ...TX.caps[capNr++]); await klick(p, '#condChips .chip >> nth=1', { nach: 1200 });
  await scrolle(p, 420);
  await cap(p, ...TX.caps[capNr++]);
  await zu(p, '#preisSpanne'); await pause(p, 2600); await zu(p, '#finLine'); await pause(p, 3000);
  await cap(p, ...TX.caps[capNr++]);
  await klick(p, '#prodChips .chip >> nth=1', { nach: 1200 }); await klick(p, '#pkgChips .chip >> nth=2', { nach: 1400 });
  await zu(p, '#preisSpanne'); await pause(p, 2800);
  await cap(p, ...TX.caps[capNr++]); await klick(p, '#prodChips .chip >> nth=0', { nach: 1400 });
  await scrolle(p, 700);
  await cap(p, ...TX.caps[capNr++]);
  await zu(p, '#drop'); await pause(p, 600);
  await p.setInputFiles('#fileInput', [1, 2, 3].map(i => MEDIA + '/pilot8-' + i + '.jpg')); await pause(p, 2200);
  await scrolle(p, 340);
  await cap(p, ...TX.caps[capNr++]);
  await klick(p, '#calNext', { nach: 600 }); await klick(p, '#calNext', { nach: 600 }); await klick(p, '#calNext', { nach: 600 }); await klick(p, '#calNext', { nach: 700 });
  await klick(p, '#cal .cal-d.ok >> nth=8', { nach: 1500 });
  await scrolle(p, 330);
  await cap(p, ...TX.caps[capNr++]);
  await tippe(p, '#lName', 'Anna Lindqvist'); await tippe(p, '#lEmail', 'anna.lindqvist@example.de'); await tippe(p, '#lPlz', SZ.plz[0]);
  await scrolle(p, 220);
  for (const c of await p.locator('#checks input').all()) await klick(p, c, { nach: 350 });
  await cap(p, ...TX.caps[capNr++]); await klick(p, '#leadBtn', { nach: 2400 });
  await p.waitForSelector('#leadOk a');
  await cap(p, ...TX.caps[capNr++]); await zu(p, '#leadOk a'); await pause(p, 3200);
  const link = await p.getAttribute('#leadOk a', 'href');
  const token = new URL(link).searchParams.get('t');

  /* Marina schickt im Hintergrund das Angebot (wird in Video 2 gezeigt) */
  const liste = await (await mApi.request.get(B + '/api/anfragen')).json();
  const neu = liste.find(a => a.token === token);
  await mApi.request.post(B + '/api/anfragen/' + neu.id + '/angebot', { data: { festpreis_netto: 2600, termin: neu.wunschtermin, tage: 5, notiz: 'Kranen und Aufbocken sind im Preis enthalten.' } });

  await p.goto(link); await p.waitForSelector('#ja'); await pause(p, 500);
  await cap(p, ...TX.caps[capNr++]); await pause(p, 4200);
  await scrolle(p, 330);
  await cap(p, ...TX.caps[capNr++]); await klick(p, '[data-w=finanzierung]', { nach: 1800 });
  await cap(p, ...TX.caps[capNr++]); await klick(p, '#ja', { nach: 2200 });
  await p.waitForSelector('#st'); await zu(p, '.note.good'); await pause(p, 3800);
  await capAus(p); await pause(p, 600);
  await c1.close();

  /* ================= VIDEO 2: Marina (Backend) ================= */
  const c2 = await neueSeite(br, 'marina'); const q = await c2.newPage();
  await q.goto(B + '/partner.html'); await q.waitForSelector('#lgEmail'); await q.mouse.move(W / 2, H / 2);
  await cap(q, ...TX.caps[capNr++]); await pause(q, 2200);
  await tippe(q, '#lgEmail', SZ.marina.email, { delay: 35 }); await tippe(q, '#lgPw', 'demo1234', { delay: 60 });
  await klick(q, '#loginForm button[type=submit]', { nach: 1500 }); await q.waitForSelector('.test');
  await cap(q, ...TX.caps[capNr++]);
  await zu(q, '.test .cmp'); await pause(q, 5200);
  await cap(q, ...TX.caps[capNr++]); await scrolle(q, 300); await pause(q, 2600);
  await scrolle(q, -300);
  await cap(q, ...TX.caps[capNr++]); await klick(q, 'nav.side button[data-v=anfragen]', { nach: 1600 });
  await klick(q, '.chip[data-f=alle]', { nach: 1200 });
  await klick(q, '.item:has-text("' + SZ.namen[1] + '")', { nach: 1400 });
  await q.waitForSelector('#drawerIn .photos');
  await cap(q, ...TX.caps[capNr++]);
  await q.locator('#drawerIn').evaluate(e => e.scrollTo({ top: e.querySelector('.photos').offsetTop - 120, behavior: 'smooth' })); await pause(q, 1200);
  await klick(q, '#drawerIn .photos button >> nth=0', { nach: 2200 }); await q.mouse.move(80, 80, { steps: 10 }); await q.mouse.down(); await q.mouse.up(); await pause(q, 800);
  await q.locator('#drawerIn').evaluate(e => e.scrollTo({ top: e.querySelector('.grid').offsetTop - 80, behavior: 'smooth' })); await pause(q, 900);
  await cap(q, ...TX.caps[capNr++]); await pause(q, 3600);
  await q.locator('#drawerIn').evaluate(e => e.scrollTo({ top: 0, behavior: 'smooth' })); await pause(q, 900);
  await cap(q, ...TX.caps[capNr++]);
  await klick(q, '#anNetto', { nach: 200 }); await q.keyboard.press('Control+A'); await q.keyboard.type('2750', { delay: 140 }); await pause(q, 900);
  await tippe(q, '#anNotiz', TX.notiz, { delay: 28 });
  await zu(q, '#anCalc'); await pause(q, 2600);
  await cap(q, ...TX.caps[capNr++]); await klick(q, '#fAngebot button[type=submit]', { nach: 2000 });
  await klick(q, '#dzu', { nach: 900 });
  await cap(q, ...TX.caps[capNr++]);
  await klick(q, '.item:has-text("Anna Lindqvist")', { nach: 1400 }); await pause(q, 3400);
  await zu(q, '#wgZiel');
  await cap(q, ...TX.caps[capNr++]); await pause(q, 4400);
  await klick(q, '#wgBtn', { nach: 2200 });
  await cap(q, ...TX.caps[capNr++]); await pause(q, 2600);
  await klick(q, '#dzu', { nach: 900 });
  await cap(q, ...TX.caps[capNr++]);
  await klick(q, 'nav.side button[data-v=preise]', { nach: 1400 });
  await klick(q, '#pr_laser_h', { nach: 200 }); await q.keyboard.press('Control+A'); await q.keyboard.type('185', { delay: 120 }); await pause(q, 600);
  await zu(q, '#bsp'); await cap(q, ...TX.caps[capNr++]); await pause(q, 3400);
  await klick(q, '#prSave', { nach: 1600 });
  await cap(q, ...TX.caps[capNr++]);
  await klick(q, 'nav.side button[data-v=teilen]', { nach: 1600 }); await zu(q, '#qr'); await pause(q, 2800);
  await scrolle(q, 560); await pause(q, 3200);
  await cap(q, ...TX.caps[capNr++]);
  await klick(q, 'nav.side button[data-v=finanzierung]', { nach: 1600 }); await scrolle(q, 260); await pause(q, 3400);
  await scrolle(q, -260);

  /* Laser-Partner bestätigt und schließt ab */
  await cap(q, ...TX.caps[capNr++]); await klick(q, '#logout', { nach: 1200 });
  await q.waitForSelector('#lgEmail');
  await tippe(q, '#lgEmail', SZ.laser.email, { delay: 30 }); await tippe(q, '#lgPw', 'demo1234', { delay: 50 }); await klick(q, '#loginForm button[type=submit]', { nach: 1500 });
  await q.waitForSelector('.test');
  await klick(q, 'nav.side button[data-v=anfragen]', { nach: 1200 }); await klick(q, '.item:has-text("Anna Lindqvist")', { nach: 1400 });
  await cap(q, ...TX.caps[capNr++]); await pause(q, 2400);
  await klick(q, '#bsBtn', { nach: 2000 });
  await cap(q, ...TX.caps[capNr++]); await klick(q, '#abBtn', { nach: 2000 }); await klick(q, '#dzu', { nach: 800 });
  await cap(q, ...TX.caps[capNr++]);
  await klick(q, 'nav.side button[data-v=abrechnung]', { nach: 1400 }); await pause(q, 4400);
  await capAus(q); await pause(q, 600);
  await c2.close();
  await br.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
