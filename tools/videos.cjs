/* Nimmt die Anleitungsvideos vom laufenden System auf.
   node tools/videos.cjs <ausgabeordner> <medienordner>   (Server muss auf BASE laufen, frische Daten) */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const B = process.env.BASE || 'http://localhost:8099', OUT = process.argv[2], MEDIA = process.argv[3];
const W = 1280, H = 800;

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
  const ctx = await br.newContext({ viewport: { width: W, height: H }, locale: 'de-DE', timezoneId: 'Europe/Berlin', recordVideo: { dir: OUT + '/raw-' + name, size: { width: W, height: H } } });
  await ctx.addInitScript(OVERLAY);
  return ctx;
}

(async () => {
  const br = await chromium.launch();
  const api = await (await chromium.launch()).newContext();   // für Vorbereitung ohne Video

  /* ---------- Vorbereitung: zwei frühere Anfragen, damit das Backend realistisch aussieht ---------- */
  const r0 = await api.request.post(B + '/api/public/marina-schleibucht/anfragen', { data: { eigner: { name: 'Jens Petersen', email: 'jens@example.de', plz: '24376', sprache: 'de' },
    kalkulation: { land: 'DE', flaeche_m2: 33, preis_netto_von: 3480, preis_netto_bis: 4430, preis_brutto_von: 4140, preis_brutto_bis: 5270, paket: 'af', material: 'gfk', tage: '4-5', boot: { lwl: 8.5, breite: 3.0, tiefgang: 0.9, rumpf: 'motorboot', zustand: 'mittel' } }, wunschtermin: '2027-03-15', medien: [] } });
  const a0 = await r0.json();
  const login = async (email) => { const c = await (await chromium.launch()).newContext(); await c.request.post(B + '/api/auth/login', { data: { email, passwort: 'demo1234' } }); return c; };
  const mApi = await login('demo@marina-schleibucht.de');
  await mApi.request.post(B + '/api/anfragen/' + a0.id + '/angebot', { data: { festpreis_netto: 3900, termin: '2027-03-15', tage: 5 } });
  await api.request.post(B + '/api/angebot/' + a0.token + '/annehmen', { data: { zahlart: 'anzahlung' } });
  const fotos = [];
  for (const i of [1, 2, 3]) { const r = await api.request.put(B + '/api/upload?name=finnmaster-' + i + '.jpg', { headers: { 'Content-Type': 'image/jpeg' }, data: fs.readFileSync(MEDIA + '/finnmaster-' + i + '.jpg') }); fotos.push(await r.json()); }
  await api.request.post(B + '/api/public/marina-schleibucht/anfragen', { data: { eigner: { name: 'Lars Brodersen', email: 'lars@example.de', plz: '24399', telefon: '+49 170 0000000', sprache: 'de', nachricht: 'Steht auf dem Trailer, Halle 2.' },
    kalkulation: { land: 'DE', produkt: 'unterwasserschiff', flaeche_m2: 19.0, preis_netto_von: 2390, preis_netto_bis: 3040, preis_brutto_von: 2840, preis_brutto_bis: 3620, paket: 'af', material: 'gfk', tage: '3-4', boot: { lwl: 6.4, breite: 2.4, tiefgang: 0.6, rumpf: 'motorboot', zustand: 'stark' } },
    wunschtermin: '2027-04-06', medien: fotos, bestaetigungen: { osmosefrei: true } } });

  /* ================= VIDEO 1: Eigner (Frontend) ================= */
  const c1 = await neueSeite(br, 'eigner'); const p = await c1.newPage();
  await p.goto(B + '/kalkulator.html?p=marina-schleibucht'); await p.waitForSelector('body:not(.lade)'); await pause(p, 600);
  await p.mouse.move(W / 2, H / 2);
  await cap(p, 'Eigner · Schritt 1', 'Der Eigner scannt den QR-Code seiner Marina und landet auf ihrem Rechner, mit Namen, Farbe und Preisen der Marina.'); await pause(p, 3800);
  await cap(p, 'Schritt 2', 'Er wählt die Leistung: Antifouling erneuern.'); await klick(p, '#pkgChips .chip >> nth=0', { nach: 1400 });
  await scrolle(p, 330);
  await cap(p, 'Schritt 3', 'Bootstyp und Größe aus der Liste, dann die Maße genau einstellen.');
  await zu(p, '#bootSelect'); await p.selectOption('#bootSelect', '1'); await pause(p, 900);
  await slider(p, '#lwl', 7.6); await slider(p, '#breite', 2.8);
  await cap(p, 'Schritt 4', 'Zustand der alten Beschichtung angeben. Der Preis rechnet live mit.'); await klick(p, '#condChips .chip >> nth=1', { nach: 1200 });
  await scrolle(p, 420);
  await cap(p, 'Schritt 5', 'Sofort sichtbar: Preisspanne inkl. MwSt., Dauer, 50 % Anzahlung (erstattbar bis zur Bestätigung) und die Monatsrate mit Klarna.');
  await zu(p, '#preisSpanne'); await pause(p, 2600); await zu(p, '#finLine'); await pause(p, 3000);
  await cap(p, 'Zweites Produkt', 'Im selben Rechner: Detailing & Versiegelung. Gleiche Buchung, gleiche Anzahlung.');
  await klick(p, '#prodChips .chip >> nth=1', { nach: 1200 }); await klick(p, '#pkgChips .chip >> nth=2', { nach: 1400 });
  await zu(p, '#preisSpanne'); await pause(p, 2800);
  await cap(p, 'Zurück zum Unterwasserschiff', 'Anna bucht das Antifouling.'); await klick(p, '#prodChips .chip >> nth=0', { nach: 1400 });
  await scrolle(p, 700);
  await cap(p, 'Schritt 6', 'Fotos hochladen: mindestens 3 Fotos oder 1 Video vom Unterwasserschiff.');
  await zu(p, '#drop'); await pause(p, 600);
  await p.setInputFiles('#fileInput', [1, 2, 3].map(i => MEDIA + '/pilot8-' + i + '.jpg')); await pause(p, 2200);
  await scrolle(p, 340);
  await cap(p, 'Schritt 7', 'Wunschtermin wählen. Das voraussichtliche Zeitfenster wird markiert.');
  await klick(p, '#calNext', { nach: 600 }); await klick(p, '#calNext', { nach: 600 }); await klick(p, '#calNext', { nach: 600 }); await klick(p, '#calNext', { nach: 700 });
  await klick(p, '#cal .cal-d.ok >> nth=8', { nach: 1500 });
  await scrolle(p, 330);
  await cap(p, 'Schritt 8', 'Kontaktdaten eintragen und bestätigen.');
  await tippe(p, '#lName', 'Anna Lindqvist'); await tippe(p, '#lEmail', 'anna.lindqvist@example.de'); await tippe(p, '#lPlz', '24376');
  await scrolle(p, 220);
  for (const c of await p.locator('#checks input').all()) await klick(p, c, { nach: 350 });
  await cap(p, 'Schritt 9', 'Anfrage senden. Fotos und Daten gehen direkt an die Marina.'); await klick(p, '#leadBtn', { nach: 2400 });
  await p.waitForSelector('#leadOk a');
  await cap(p, 'Fertig', 'Der Eigner bekommt einen Link, unter dem er jederzeit den Stand seiner Anfrage sieht.'); await zu(p, '#leadOk a'); await pause(p, 3200);
  const link = await p.getAttribute('#leadOk a', 'href');
  const token = new URL(link).searchParams.get('t');

  /* Marina schickt im Hintergrund das Angebot (wird in Video 2 gezeigt) */
  const liste = await (await mApi.request.get(B + '/api/anfragen')).json();
  const neu = liste.find(a => a.token === token);
  await mApi.request.post(B + '/api/anfragen/' + neu.id + '/angebot', { data: { festpreis_netto: 2600, termin: neu.wunschtermin, tage: 5, notiz: 'Kranen und Aufbocken sind im Preis enthalten.' } });

  await p.goto(link); await p.waitForSelector('#ja'); await pause(p, 500);
  await cap(p, 'Einige Stunden später', 'Die Marina hat die Fotos geprüft. Per E-Mail kommt das Festpreisangebot mit festem Termin.'); await pause(p, 4200);
  await scrolle(p, 330);
  await cap(p, 'Schritt 10', 'Der Eigner wählt: 50 % Anzahlung oder Finanzierung mit Klarna.'); await klick(p, '[data-w=finanzierung]', { nach: 1800 });
  await cap(p, 'Schritt 11', 'Angebot annehmen. Bis der ausführende Betrieb den Termin bestätigt, kann er kostenlos stornieren.'); await klick(p, '#ja', { nach: 2200 });
  await p.waitForSelector('#st'); await zu(p, '.note.good'); await pause(p, 3800);
  await capAus(p); await pause(p, 600);
  await c1.close();

  /* ================= VIDEO 2: Marina (Backend) ================= */
  const c2 = await neueSeite(br, 'marina'); const q = await c2.newPage();
  await q.goto(B + '/partner.html'); await q.waitForSelector('#lgEmail'); await q.mouse.move(W / 2, H / 2);
  await cap(q, 'Marina · Schritt 1', 'Die Marina meldet sich in ihrem Backend an.'); await pause(q, 2200);
  await tippe(q, '#lgEmail', 'demo@marina-schleibucht.de', { delay: 35 }); await tippe(q, '#lgPw', 'demo1234', { delay: 60 });
  await klick(q, '#loginForm button[type=submit]', { nach: 1500 }); await q.waitForSelector('.test');
  await cap(q, 'Übersicht', 'Der 6-Wochen-Test: Anfragen, Buchungen und was sie bringen. Weitergeben gegen Provision oder selbst ausführen mit eigenem Laser.');
  await zu(q, '.test .cmp'); await pause(q, 5200);
  await cap(q, 'Übersicht', 'Darunter der Stand aller Aufträge und die reservierten Anzahlungen.'); await scrolle(q, 300); await pause(q, 2600);
  await scrolle(q, -300);
  await cap(q, 'Schritt 2', 'Unter „Anfragen“ liegt jede Anfrage aus dem Rechner, mit Fotos und Richtpreis.'); await klick(q, 'nav.side button[data-v=anfragen]', { nach: 1600 });
  await klick(q, '.chip[data-f=alle]', { nach: 1200 });
  await klick(q, '.item:has-text("Lars Brodersen")', { nach: 1400 });
  await q.waitForSelector('#drawerIn .photos');
  await cap(q, 'Schritt 3', 'Fotos ansehen und den Zustand beurteilen. Eine Besichtigung vor Ort ist nicht nötig.');
  await q.locator('#drawerIn').evaluate(e => e.scrollTo({ top: e.querySelector('.photos').offsetTop - 120, behavior: 'smooth' })); await pause(q, 1200);
  await klick(q, '#drawerIn .photos button >> nth=0', { nach: 2200 }); await q.mouse.move(80, 80, { steps: 10 }); await q.mouse.down(); await q.mouse.up(); await pause(q, 800);
  await q.locator('#drawerIn').evaluate(e => e.scrollTo({ top: e.querySelector('.grid').offsetTop - 80, behavior: 'smooth' })); await pause(q, 900);
  await cap(q, 'Schritt 3', 'Bootsdaten, Richtpreis aus dem Rechner, Wunschtermin und Kontakt auf einen Blick.'); await pause(q, 3600);
  await q.locator('#drawerIn').evaluate(e => e.scrollTo({ top: 0, behavior: 'smooth' })); await pause(q, 900);
  await cap(q, 'Schritt 4', 'Festpreis, Termin und Dauer eintragen. Brutto, Anzahlung und Plattformgebühr rechnen sich mit.');
  await klick(q, '#anNetto', { nach: 200 }); await q.keyboard.press('Control+A'); await q.keyboard.type('2750', { delay: 140 }); await pause(q, 900);
  await tippe(q, '#anNotiz', 'Bitte den Trailer bis 8 Uhr vor Halle 2 stellen.', { delay: 28 });
  await zu(q, '#anCalc'); await pause(q, 2600);
  await cap(q, 'Schritt 4', 'Angebot senden. Der Eigner bekommt es per E-Mail und nimmt online an.'); await klick(q, '#fAngebot button[type=submit]', { nach: 2000 });
  await klick(q, '#dzu', { nach: 900 });
  await cap(q, 'Schritt 5', 'Anna Lindqvist hat ihr Angebot bereits mit Klarna angenommen. Die Anzahlung ist reserviert und noch erstattbar.');
  await klick(q, '.item:has-text("Anna Lindqvist")', { nach: 1400 }); await pause(q, 3400);
  await zu(q, '#wgZiel');
  await cap(q, 'Schritt 6', 'Ohne eigenen Laser gibt die Marina den Auftrag an den Laser-Partner im Gebiet weiter. Dort gilt Gebietsschutz. Die Marina erhält 15 % Provision.'); await pause(q, 4400);
  await klick(q, '#wgBtn', { nach: 2200 });
  await cap(q, 'Schritt 6', 'Weitergegeben. Ab jetzt bestätigt der Laser-Partner den Termin.'); await pause(q, 2600);
  await klick(q, '#dzu', { nach: 900 });
  await cap(q, 'Schritt 7', 'Unter „Preise & Leistungen“ legt die Marina ihre eigenen Preise fest. Die Boatsdoc-Empfehlung steht daneben.');
  await klick(q, 'nav.side button[data-v=preise]', { nach: 1400 });
  await klick(q, '#pr_laser_h', { nach: 200 }); await q.keyboard.press('Control+A'); await q.keyboard.type('185', { delay: 120 }); await pause(q, 600);
  await zu(q, '#bsp'); await cap(q, 'Schritt 7', 'Rechts sieht sie sofort, was ihr Eigner für typische Boote angezeigt bekommt.'); await pause(q, 3400);
  await klick(q, '#prSave', { nach: 1600 });
  await cap(q, 'Schritt 8', 'Unter „Auftritt & Teilen“: Link, QR-Code, Einbettung für die Website, Flyer und E-Mail an die Liegeplatzkunden.');
  await klick(q, 'nav.side button[data-v=teilen]', { nach: 1600 }); await zu(q, '#qr'); await pause(q, 2800);
  await scrolle(q, 560); await pause(q, 3200);
  await cap(q, 'Schritt 9', 'Unter „Finanzierung“: Klarna für die Eigner, mit den Grenzen je Land, und GRENKE-Leasing für den eigenen Laser.');
  await klick(q, 'nav.side button[data-v=finanzierung]', { nach: 1600 }); await scrolle(q, 260); await pause(q, 3400);
  await scrolle(q, -260);

  /* Laser-Partner bestätigt und schließt ab */
  await cap(q, 'Laser-Partner', 'Jetzt die Sicht des Laser-Partners: Bootsservice Förde.'); await klick(q, '#logout', { nach: 1200 });
  await q.waitForSelector('#lgEmail');
  await tippe(q, '#lgEmail', 'demo@bootsservice-foerde.de', { delay: 30 }); await tippe(q, '#lgPw', 'demo1234', { delay: 50 }); await klick(q, '#loginForm button[type=submit]', { nach: 1500 });
  await q.waitForSelector('.test');
  await klick(q, 'nav.side button[data-v=anfragen]', { nach: 1200 }); await klick(q, '.item:has-text("Anna Lindqvist")', { nach: 1400 });
  await cap(q, 'Schritt 10', 'Der Laser-Partner bestätigt den Termin. Damit wird die Anzahlung verbindlich.'); await pause(q, 2400);
  await klick(q, '#bsBtn', { nach: 2000 });
  await cap(q, 'Schritt 11', 'Nach der Arbeit und der Abnahme: Auftrag abschließen.'); await klick(q, '#abBtn', { nach: 2000 }); await klick(q, '#dzu', { nach: 800 });
  await cap(q, 'Abrechnung', 'Die Abrechnung entsteht automatisch: 15 % Provision an die Marina, 5 % an Boatsdoc. Keine Grundgebühr.');
  await klick(q, 'nav.side button[data-v=abrechnung]', { nach: 1400 }); await pause(q, 4400);
  await capAus(q); await pause(q, 600);
  await c2.close();
  await br.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
