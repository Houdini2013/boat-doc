/* Boatsdoc Kern — gemeinsame Geschäftslogik und API für Server (Node) und Demo (Browser).
   Eine Implementierung, zwei Speicher: SQLite auf dem Server, localStorage in der Demo.
   db-Schnittstelle: all(tabelle) · get(tabelle,id) · put(tabelle,obj) · del(tabelle,id) — alle synchron. */
(function (root) {
  "use strict";

  /* ---------- Konstanten ---------- */
  const GEBUEHR = 0.05;          // Plattformgebühr auf Netto-Auftragswert
  const PROVISION = 0.15;        // Provision Ausführender → vermittelnde Marina
  const ANZAHLUNG = 0.5;         // Anteil Anzahlung bei Annahme
  const SCHUTZ_JAHRE = 2;        // Gebietsschutz für Launch-Partner
  const SPRACHEN = ["de", "en", "sv", "no", "da", "fi"];
  const LAND_SPRACHE = { DE: "de", SE: "sv", NO: "no", DK: "da", FI: "fi" };
  const MWST = { DE: 0.19, SE: 0.25, NO: 0.25, DK: 0.25, FI: 0.255 };
  const WAEHRUNG = { DE: "EUR", SE: "SEK", NO: "NOK", DK: "DKK", FI: "EUR" };
  /* Anzeige-Kurse (wie im Eigner-Kalkulator). Abgerechnet wird in EUR; Kronen nur zur Orientierung. */
  const KURS = { EUR: 1, SEK: 11.17, NOK: 10.67, DKK: 7.475 };

  /* Klarna-Ratenfinanzierung: Rahmen je Land in EUR (aus Landeswährung umgerechnet, gerundet).
     Quelle: Stripe-Dokumentation zu Klarna, Stand 10/2026. DK: keine Ratenfinanzierung gelistet. */
  const FINANZIERER = {
    klarna: { name: "Klarna", laufzeiten: [6, 12, 24, 36],
      rahmen: { DE: [25, 10000], SE: [25, 8900], NO: [25, 7000], FI: [25, 3000] } },
    keine: { name: "", laufzeiten: [], rahmen: {} }
  };

  /* Boatsdoc-Empfehlung (= Grundwerte des Eigner-Kalkulators) und sinnvolle Spannen */
  const PREIS_EMPFEHLUNG = {
    ruest:      { wert: 150,  von: 120, bis: 400 },   // Rüst-/Anfahrtspauschale je Auftrag, €
    laser_h:    { wert: 170,  von: 140, bis: 200 },   // Laserabtrag €/h (inkl. Gerät)
    laser_m2h:  { wert: 2.0,  von: 1.5, bis: 3.5 },   // Flächenleistung m²/h
    schliff_h:  { wert: 68,   von: 55,  bis: 85 },    // Handarbeit €/h (Schliff, Beschichtung)
    primer_l:   { wert: 28,   von: 22,  bis: 40 },    // Material €/l
    af_l:       { wert: 42,   von: 35,  bis: 60 },
    lack_l:     { wert: 48,   von: 40,  bis: 65 },
    km:         { wert: 0.70, von: 0.50, bis: 1.20 }, // Anfahrt €/km
    spanne:     { wert: 12,   von: 5,   bis: 20 },    // ± % Richtpreisspanne
    det_h:      { wert: 100,  von: 80,  bis: 130 },   // Detailing €/h
    det_min:    { wert: 900,  von: 500, bis: 1500 }   // Mindestauftrag Detailing €
  };
  const grundpreise = () => Object.fromEntries(Object.entries(PREIS_EMPFEHLUNG).map(([k, v]) => [k, v.wert]));

  /* Preise der Marina → Rechenbasis des Eigner-Kalkulators (eine Formel für Kalkulator und Backend) */
  function kalkCfg(pr) {
    pr = Object.assign(grundpreise(), pr || {});
    return {
      ruestpauschale_eur: pr.ruest, spanne: pr.spanne / 100, anfahrt_eur_pro_km: pr.km,
      entfernung: { laser: { eur_h: pr.laser_h, m2_h: Math.max(0.2, pr.laser_m2h), mat_m2: 0 }, handschliff: { eur_h: pr.schliff_h, m2_h: 2.0, mat_m2: 1.5 } },
      aufbau: {
        primer: { l_m2: 0.12, eur_l: pr.primer_l, m2_h: 18, eur_h: pr.schliff_h },
        antifouling: { l_m2: 0.10, eur_l: pr.af_l, m2_h: 18, eur_h: pr.schliff_h },
        lack_2k: { l_m2: 0.11, eur_l: pr.lack_l, m2_h: 12, eur_h: pr.schliff_h }
      },
      det_h: pr.det_h, det_min: pr.det_min
    };
  }
  const PAKETE = {
    af: { entfernung: ["laser"], aufbau: { primer: 2, antifouling: 2 } },
    full: { entfernung: ["laser", "handschliff"], aufbau: { primer: 2, lack_2k: 2, antifouling: 2 } },
    strip: { entfernung: ["laser"], aufbau: {} }
  };
  /* Richtpreis netto (von–bis) für eine Fläche — identisch zur Formel im Eigner-Kalkulator */
  function richtpreis(pr, flaeche, paket, zustandFaktor) {
    const c = kalkCfg(pr), p = PAKETE[paket] || PAKETE.af, z = zustandFaktor || 1;
    let k = 0;
    for (const e of p.entfernung) { const m = c.entfernung[e]; k += flaeche / m.m2_h * z * m.eur_h + flaeche * m.mat_m2; }
    for (const [a, s] of Object.entries(p.aufbau)) { const m = c.aufbau[a]; k += flaeche / m.m2_h * s * m.eur_h + flaeche * m.l_m2 * s * m.eur_l; }
    const netto = k + c.ruestpauschale_eur;
    return { netto: r10(netto), von: r10(netto * (1 - c.spanne)), bis: r10(netto * (1 + c.spanne)) };
  }

  /* Detailing & Versiegelung — identisch zu CFG.detailing im Eigner-Kalkulator (dort die Quelle; tools/check_parity.cjs prüft Gleichheit) */
  const DETAILING = {
    arbeitsstunden_pro_tag: 6, mindestauftrag_eur: 900,
    zustand: { leicht: 0.7, mittel: 1.0, stark: 1.6 },
    formeln: { motorboot: 1.6, kurzkieler: 1.2, langkieler: 1.4 },
    schritte: {
      wash: { eur_h: 100, m2_h: 20, mat_m2: 0.3, z: false },
      schliff: { eur_h: 100, m2_h: 5, mat_m2: 1.5, z: true },
      polish1: { eur_h: 100, m2_h: 6, mat_m2: 1.5, z: true },
      polish2: { eur_h: 100, m2_h: 10, mat_m2: 1.0, z: true },
      sealant: { eur_h: 100, m2_h: 15, mat_m2: 2.5, z: false },
      keramik: { eur_h: 140, m2_h: 4.5, mat_m2: 35, z: false }
    },
    pakete: {
      pflege: { schritte: ["wash", "polish1", "sealant"], trocknungstage: 0 },
      restau: { schritte: ["wash", "schliff", "polish1", "sealant"], trocknungstage: 0 },
      keramik: { schritte: ["wash", "schliff", "polish1", "polish2", "keramik"], trocknungstage: 2 }
    }
  };
  /* Richtpreis Detailing netto (von–bis): Außenfläche = Faktor × Länge × Breite; Stundensätze skaliert mit det_h/100 */
  function richtpreisDet(pr, L, B, typ, paket, zustand) {
    pr = Object.assign(grundpreise(), pr || {});
    const D = DETAILING, p = D.pakete[paket] || D.pakete.pflege, z = D.zustand[zustand || "mittel"];
    const a = Math.round(D.formeln[typ || "kurzkieler"] * L * B * 10) / 10, f = pr.det_h / 100;
    let k = 0;
    for (const st of p.schritte) { const m = D.schritte[st]; k += a / m.m2_h * (m.z ? z : 1) * Math.round(m.eur_h * f) + a * m.mat_m2; }
    const netto = k + pr.ruest, sp = pr.spanne / 100, min = pr.det_min;
    return { flaeche: a, netto: r10(Math.max(min, netto)), von: r10(Math.max(min, netto * (1 - sp))), bis: r10(Math.max(min, netto * (1 + sp))) };
  }

  /* Geräte und GRENKE (Faktoren aus dem Partnerrechner, 60 Monate) */
  const GERAETE = {
    bd500:  { name: "BD-500",  preis: 20000, faktor60: 2.02, stundenFaktor: 33 / 65 },
    bd1000: { name: "BD-1000", preis: 40000, faktor60: 2.00, stundenFaktor: 13 / 65 }
  };

  /* Statusfluss */
  const STATUS = ["neu", "angebot", "angenommen", "bestaetigt", "abgeschlossen", "abgelehnt", "storniert"];
  const OFFEN = ["neu", "angebot", "angenommen", "bestaetigt"];

  /* ---------- Hilfen ---------- */
  const jetzt = () => new Date().toISOString();
  const r2 = x => Math.round(x * 100) / 100;
  const r10 = x => Math.round(x / 10) * 10;
  function zufall(n) {
    const a = "abcdefghijkmnpqrstuvwxyz23456789"; let s = "";
    const c = (root.crypto && root.crypto.getRandomValues) ? root.crypto.getRandomValues(new Uint8Array(n)) : null;
    for (let i = 0; i < n; i++) s += a[(c ? c[i] : Math.floor(Math.random() * 256)) % a.length];
    return s;
  }
  const neueId = p => p + "_" + zufall(10);
  function slugify(s) {
    return String(s || "").toLowerCase()
      .replace(/[äå]/g, "a").replace(/[öø]/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").replace(/æ/g, "ae")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "partner";
  }
  function fehler(status, code, text) { const e = new Error(text || code); e.status = status; e.code = code; return e; }
  const istEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ""));

  /* Annuitätenrate */
  function rate(betrag, zinsProzent, monate) {
    if (!monate) return 0;
    const i = (zinsProzent || 0) / 100 / 12;
    if (i === 0) return betrag / monate;
    return betrag * i / (1 - Math.pow(1 + i, -monate));
  }
  /* Finanzierungsangebot für einen Bruttobetrag (EUR) in einem Land */
  function finanzierung(partner, land, brutto) {
    const f = partner && partner.finanzierung || {};
    const an = FINANZIERER[f.anbieter || "keine"];
    if (!an || !an.rahmen[land]) return null;
    const [min, max] = an.rahmen[land];
    if (brutto < min) return null;
    const lz = Math.min(f.laufzeit || 36, Math.max.apply(null, an.laufzeiten));
    const finanzierbar = Math.min(brutto, max);
    return { anbieter: an.name, zins: f.zins, laufzeit: lz, finanzierbar: r2(finanzierbar),
      rest: r2(brutto - finanzierbar), monatsrate: r2(rate(finanzierbar, f.zins, lz)) };
  }

  /* Gebühren und Provisionen eines abgeschlossenen Auftrags */
  function abrechnung(anfrage) {
    const netto = anfrage.angebot ? anfrage.angebot.festpreis_netto : 0;
    const vermittelt = !!(anfrage.ausfuehrer_id && anfrage.ausfuehrer_id !== anfrage.partner_id);
    const p = [];
    if (vermittelt) {
      p.push({ partner_id: anfrage.ausfuehrer_id, typ: "provision_gezahlt", betrag: -r2(netto * PROVISION) });
      p.push({ partner_id: anfrage.partner_id, typ: "provision_erhalten", betrag: r2(netto * PROVISION) });
      p.push({ partner_id: anfrage.partner_id, typ: "plattformgebuehr", betrag: -r2(netto * GEBUEHR) });
    } else {
      p.push({ partner_id: anfrage.partner_id, typ: "plattformgebuehr", betrag: -r2(netto * GEBUEHR) });
    }
    return { netto, vermittelt, posten: p };
  }

  /* Gebietsschutz: welcher Laser-Partner bekommt eine Anfrage aus Land/PLZ? */
  function schutzAktiv(p, heute) { return !!(p.gebietsschutz_bis && p.gebietsschutz_bis >= (heute || jetzt()).slice(0, 10)); }
  function plzPasst(p, plz) {
    const z = String(plz || "").replace(/\D/g, "");
    return (p.region && p.region.plz || []).some(pre => pre && z.startsWith(String(pre)));
  }
  function laserPartnerFuer(partner, land, plz, ausserId) {
    const kandidaten = partner.filter(p => p.rolle === "ausfuehrend" && p.land === land && p.id !== ausserId && p.aktiv !== false);
    const geschuetzt = kandidaten.filter(p => schutzAktiv(p) && plzPasst(p, plz));
    if (geschuetzt.length) return { exklusiv: true, liste: geschuetzt };
    const passend = kandidaten.filter(p => plzPasst(p, plz));
    const rest = kandidaten.filter(p => !plzPasst(p, plz));
    return { exklusiv: false, liste: passend.concat(rest) };
  }

  /* Öffentliche Sicht auf einen Partner (für den Eigner-Kalkulator) */
  function oeffentlich(p) {
    return { slug: p.slug, name: p.name, farbe: p.farbe, logo: p.logo || null, land: p.land, sprache: p.sprache, modus: p.modus || "live",
      kontakt: p.kontakt || {}, preise: p.preise, pakete: p.pakete, detailing: p.detailing,
      finanzierung: p.finanzierung, kalender: p.kalender, rolle: p.rolle,
      design: p.design || {}, impressum: p.impressum && p.impressum.firma ? p.impressum : null, domain: (p.domains || [])[0] || null };
  }
  /* Partner ohne Geheimnisse (für das eigene Backend) */
  function privat(p) { const c = Object.assign({}, p); delete c.pw; return c; }

  function neuerPartner(d) {
    const land = MWST[d.land] !== undefined ? d.land : "DE";
    return {
      id: neueId("p"), slug: d.slug || slugify(d.name), name: String(d.name || "").trim(), email: String(d.email || "").trim().toLowerCase(),
      pw: d.pw || null, rolle: d.rolle === "ausfuehrend" ? "ausfuehrend" : "vermittler", admin: !!d.admin, aktiv: true,
      land, sprache: SPRACHEN.includes(d.sprache) ? d.sprache : (LAND_SPRACHE[land] || "en"),
      farbe: d.farbe || "#0E6E6A", logo: null,
      kontakt: Object.assign({ tel: "", web: "", adresse: "", ansprechpartner: "" }, d.kontakt || {}),
      region: { name: (d.region && d.region.name) || "", plz: (d.region && d.region.plz) || [] },
      gebietsschutz_bis: d.gebietsschutz_bis || null,
      preise: Object.assign(grundpreise(), d.preise || {}),
      pakete: Object.assign({ af: true, full: true, strip: true }, d.pakete || {}),
      detailing: Object.assign({ aktiv: true }, d.detailing || {}),
      finanzierung: Object.assign({ anbieter: "klarna", zins: 9.9, laufzeit: 36 }, d.finanzierung || {}),
      kalender: Object.assign({ vorlauf_tage: 14, gesperrt: [] }, d.kalender || {}),
      test: Object.assign({ start: jetzt().slice(0, 10), wochen: 6 }, d.test || {}),
      /* Selbstbedienung: Probezugang ohne Konto → Konto gesichert → live */
      sandbox: !!d.sandbox, modus: d.modus === "live" ? "live" : "probe", live_seit: d.modus === "live" ? jetzt() : null,
      liegeplaetze: Number(d.liegeplaetze) || null, quelle: d.quelle || null,
      onboarding: Object.assign({}, d.onboarding || {}), akzeptiert: null,
      /* White-Label: Darstellung, Impressum, eigene Adressen (Domains setzt Boatsdoc) */
      design: Object.assign({ bg: "", akzent2: "", schrift: "" }, d.design || {}),
      impressum: Object.assign({ firma: "", orgnr: "", adresse: "", vertreten: "", email: "", telefon: "", ust: "" }, d.impressum || {}),
      domains: Array.isArray(d.domains) ? d.domains : [],
      erstellt: jetzt(), zuletzt_aktiv: jetzt()
    };
  }

  /* Startassistent: Schritte in Reihenfolge */
  const SCHRITTE = ["profil", "preise", "rechner", "probeanfrage", "angebot", "teilen"];
  const TESTLASER = "__testlaser";
  const BEISPIEL = "beispiel-marina";   // öffentlicher Beispiel-Rechner der Website (Probebetrieb, ohne Login)
  const beispielMarina = () => neuerPartner({ name: "Beispiel-Marina", slug: BEISPIEL, land: "DE", modus: "probe", farbe: "#0E6E6A",
    kontakt: { tel: "", web: "boatsdoc.com", adresse: "" }, region: { name: "Beispiel", plz: [] } });

  /* ---------- API ---------- */
  function createApi(db, opt) {
    opt = opt || {};
    const hash = opt.hash || (pw => "demo:" + pw);
    const pruefe = opt.verify || ((pw, h) => h === "demo:" + pw);

    const partnerAlle = () => db.all("partner");
    const partnerBySlug = s => partnerAlle().find(p => p.slug === s);
    const anfragenAlle = () => db.all("anfragen");
    function ausfuehrerVon(a) { return a.ausfuehrer_id || a.partner_id; }
    function darfSehen(p, a) { return p && (p.admin || a.partner_id === p.id || a.ausfuehrer_id === p.id); }
    function log(a, ereignis, von, extra) { (a.verlauf = a.verlauf || []).push(Object.assign({ t: jetzt(), ereignis, von }, extra || {})); }
    function eindeutigerSlug(basis) {
      let s = slugify(basis), i = 2; const belegt = new Set(partnerAlle().map(p => p.slug));
      while (belegt.has(s)) s = slugify(basis) + "-" + i++;
      return s;
    }
    function mitNamen(a) {
      const pn = id => { if (id === TESTLASER) return "Test-Laser-Partner"; const p = id && db.get("partner", id); return p ? p.name : null; };
      return Object.assign({}, a, { partner_name: pn(a.partner_id), ausfuehrer_name: pn(a.ausfuehrer_id) });
    }
    function brauchtLogin(s) {
      if (!s || !s.partner) throw fehler(401, "login", "Bitte anmelden.");
      const p = s.partner;   // Aktivität für das Sales-Cockpit (höchstens alle 5 Minuten schreiben)
      if (!p.zuletzt_aktiv || Date.now() - Date.parse(p.zuletzt_aktiv) > 300000) { const c = Object.assign({}, db.get("partner", p.id) || p, { zuletzt_aktiv: jetzt() }); db.put("partner", c); s.partner = c; }
      return s.partner;
    }
    function schritt(pid, name) {
      const p = db.get("partner", pid); if (!p || (p.onboarding && p.onboarding[name])) return p;
      const c = Object.assign({}, p, { onboarding: Object.assign({}, p.onboarding, { [name]: jetzt() }) }); db.put("partner", c); return c;
    }
    /* Beispielanfragen für einen neuen Probezugang (Fotos liegen unter media/) */
    function beispiele(p) {
      const tag = n => new Date(Date.now() - n * 864e5).toISOString(), plus = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      const satz = MWST[p.land] || 0.19;
      const B = [
        { eigner: { name: "Anna Lindqvist", email: "anna@example.com", plz: "", sprache: p.sprache }, tage: 1,
          k: { produkt: "unterwasserschiff", paket: "af", material: "gfk", flaeche_m2: 20.1, land: p.land, tage: "4-5", boot: { lwl: 7.6, breite: 2.8, tiefgang: 0.7, rumpf: "motorboot", zustand: "mittel" } },
          medien: [1, 2, 3].map(i => ({ url: "media/pilot8-" + i + ".jpg", name: "pilot8-" + i + ".jpg", typ: "foto" })), angebot: null },
        { eigner: { name: "Lars Brodersen", email: "lars@example.com", plz: "", sprache: p.sprache }, tage: 4,
          k: { produkt: "detailing", paket: "restau", material: "gfk", flaeche_m2: 24.6, land: p.land, tage: "3-4", boot: { lwl: 6.4, breite: 2.4, tiefgang: 0.6, rumpf: "motorboot", zustand: "stark" } },
          medien: [1, 2, 3].map(i => ({ url: "media/finnmaster-" + i + ".jpg", name: "finnmaster-" + i + ".jpg", typ: "foto" })), angebot: 2450 }
      ];
      for (const b of B) {
        const pr = b.k.produkt === "detailing" ? richtpreisDet(p.preise, b.k.boot.lwl, b.k.boot.breite, b.k.boot.rumpf, b.k.paket, b.k.boot.zustand) : richtpreis(p.preise, b.k.flaeche_m2, b.k.paket, 1);
        Object.assign(b.k, { preis_netto_von: pr.von, preis_netto_bis: pr.bis, preis_brutto_von: r10(pr.von * (1 + satz)), preis_brutto_bis: r10(pr.bis * (1 + satz)), mwst_satz: satz });
        const a = { id: neueId("a"), token: zufall(24), partner_id: p.id, ausfuehrer_id: null, status: "neu", erstellt: tag(b.tage), probe: true, beispiel: true,
          eigner: Object.assign({ telefon: "", nachricht: "" }, b.eigner), wunschtermin: plus(150), groesse_freitext: "", bestaetigungen: { osmosefrei: true },
          kalkulation: b.k, medien: b.medien, angebot: null, zahlung: null, verlauf: [{ t: tag(b.tage), ereignis: "anfrage", von: "eigner" }] };
        if (b.angebot) {
          a.angebot = { festpreis_netto: b.angebot, mwst_satz: satz, brutto: r2(b.angebot * (1 + satz)), anzahlung: r2(b.angebot * (1 + satz) * ANZAHLUNG), termin: plus(160), tage: 3, notiz: "", von: p.id, erstellt: tag(2) };
          a.status = "angebot"; a.verlauf.push({ t: tag(2), ereignis: "angebot", von: p.name });
        }
        db.put("anfragen", a);
      }
    }

    const routes = [];
    const R = (m, pfad, fn) => routes.push({ m, re: new RegExp("^" + pfad.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn });

    /* --- Konto --- */
    R("POST", "/api/auth/register", ({ body }) => {
      if (!body.name || !istEmail(body.email) || String(body.passwort || "").length < 8)
        throw fehler(400, "eingabe", "Name, gültige E-Mail und ein Passwort mit mindestens 8 Zeichen angeben.");
      if (partnerAlle().some(p => p.email === String(body.email).toLowerCase())) throw fehler(409, "vorhanden", "Für diese E-Mail gibt es schon ein Konto.");
      const p = neuerPartner({ name: body.name, email: body.email, land: body.land, sprache: body.sprache, rolle: body.rolle,
        slug: eindeutigerSlug(body.name), pw: hash(body.passwort) });
      db.put("partner", p);
      return { status: 201, data: { partner: privat(p) }, login: p.id };
    });
    R("POST", "/api/auth/login", ({ body }) => {
      const p = partnerAlle().find(x => x.email === String(body.email || "").toLowerCase());
      if (!p || !p.pw || !pruefe(String(body.passwort || ""), p.pw)) throw fehler(401, "login", "E-Mail oder Passwort stimmt nicht.");
      return { data: { partner: privat(p) }, login: p.id };
    });
    R("POST", "/api/auth/logout", () => ({ data: { ok: true }, logout: true }));

    /* --- Selbstbedienung --- */
    R("POST", "/api/probe", ({ body }) => {
      const name = String(body.name || "").trim().slice(0, 80);
      if (name.length < 2) throw fehler(400, "eingabe", "Bitte den Namen Ihres Betriebs angeben.");
      const p = neuerPartner({ name, land: body.land, sprache: body.sprache, rolle: body.rolle, slug: eindeutigerSlug(name),
        sandbox: true, liegeplaetze: body.liegeplaetze, quelle: String(body.quelle || "website").slice(0, 40) });
      db.put("partner", p); beispiele(p);
      return { status: 201, data: { partner: privat(p) }, login: p.id, mail: { intern: true, typ: "neuer_probezugang", partner: p.name } };
    });
    R("POST", "/api/konto/sichern", ({ session, body }) => {
      const p = Object.assign({}, brauchtLogin(session));
      const email = String(body.email || "").trim().toLowerCase();
      if (!istEmail(email) || String(body.passwort || "").length < 8) throw fehler(400, "eingabe", "Gültige E-Mail und ein Passwort mit mindestens 8 Zeichen angeben.");
      if (partnerAlle().some(x => x.email === email && x.id !== p.id)) throw fehler(409, "vorhanden", "Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.");
      Object.assign(p, { email, pw: hash(String(body.passwort)), sandbox: false });
      if (body.telefon) p.kontakt = Object.assign({}, p.kontakt, { tel: String(body.telefon).slice(0, 40) });
      db.put("partner", p);
      return { data: privat(p), mail: { intern: true, typ: "konto_gesichert", partner: p.name } };
    });
    R("POST", "/api/live", ({ session, body }) => {
      const p = Object.assign({}, brauchtLogin(session));
      if (p.sandbox || !p.email) throw fehler(409, "konto", "Bitte zuerst Ihr Konto mit E-Mail und Passwort sichern.");
      if (!body.agb || !body.avv) throw fehler(400, "eingabe", "Bitte AGB und Auftragsverarbeitungsvertrag bestätigen.");
      Object.assign(p, { modus: "live", live_seit: jetzt(), akzeptiert: { agb: true, avv: true, t: jetzt(), version: String(body.version || "2026-10") } });
      db.put("partner", p);
      return { data: privat(p), mail: { intern: true, typ: "live", partner: p.name } };
    });
    R("POST", "/api/schritt/:name", ({ session, params }) => {
      const p = brauchtLogin(session);
      if (!["rechner", "teilen"].includes(params.name)) throw fehler(400, "eingabe", "Unbekannter Schritt.");
      return { data: privat(schritt(p.id, params.name)) };
    });
    R("GET", "/api/me", ({ session }) => ({ data: { partner: session && session.partner ? privat(session.partner) : null } }));

    /* --- Eigene Einstellungen --- */
    R("GET", "/api/partner", ({ session }) => ({ data: privat(brauchtLogin(session)) }));
    R("PUT", "/api/partner", ({ session, body }) => {
      const p = Object.assign({}, brauchtLogin(session));
      const erlaubt = ["name", "farbe", "logo", "sprache", "kontakt", "preise", "pakete", "detailing", "finanzierung", "kalender", "rolle", "region", "test", "design", "impressum"];
      for (const k of erlaubt) if (body[k] !== undefined) {
        p[k] = (typeof body[k] === "object" && body[k] && !Array.isArray(body[k])) ? Object.assign({}, p[k], body[k]) : body[k];
      }
      if (p.rolle !== "ausfuehrend") p.rolle = "vermittler";
      if (!SPRACHEN.includes(p.sprache)) p.sprache = "de";
      if (!/^#[0-9a-fA-F]{6}$/.test(p.farbe || "")) p.farbe = "#0E6E6A";
      if (p.design) for (const k of ["bg", "akzent2"]) if (p.design[k] && !/^#[0-9a-fA-F]{6}$/.test(p.design[k])) p.design[k] = "";
      if (p.impressum) for (const k of Object.keys(p.impressum)) p.impressum[k] = String(p.impressum[k] || "").slice(0, 300);
      for (const [k, v] of Object.entries(p.preise || {})) { const n = Number(v); p.preise[k] = isFinite(n) && n >= 0 ? n : PREIS_EMPFEHLUNG[k] ? PREIS_EMPFEHLUNG[k].wert : 0; }
      if (p.finanzierung && !FINANZIERER[p.finanzierung.anbieter]) p.finanzierung.anbieter = "keine";
      p.name = String(p.name || "").trim() || session.partner.name;
      if (body.liegeplaetze !== undefined) p.liegeplaetze = Number(body.liegeplaetze) || null;
      p.onboarding = Object.assign({}, p.onboarding);
      if (["name", "farbe", "logo", "kontakt"].some(k => body[k] !== undefined) && !p.onboarding.profil) p.onboarding.profil = jetzt();
      if (body.preise !== undefined && !p.onboarding.preise) p.onboarding.preise = jetzt();
      db.put("partner", p);
      return { data: privat(p) };
    });

    /* --- Öffentlich: Kalkulator --- */
    /* White-Label: zu welcher Marina gehört dieser Hostname? <slug>.<hauptdomain> oder eingetragene Domain */
    R("GET", "/api/host/:host", ({ params }) => {
      const h = String(params.host || "").toLowerCase();
      const p = partnerAlle().find(x => x.aktiv !== false && (x.domains || []).includes(h));
      if (!p) throw fehler(404, "unbekannt", "Keine Marina für diese Adresse.");
      return { data: { slug: p.slug } };
    });
    R("GET", "/api/public/:slug", ({ params }) => {
      const p = partnerBySlug(params.slug);
      if (!p || p.aktiv === false) throw fehler(404, "unbekannt", "Diesen Rechner gibt es nicht.");
      return { data: oeffentlich(p) };
    });
    R("POST", "/api/public/:slug/anfragen", ({ params, body }) => {
      const p = partnerBySlug(params.slug);
      if (!p) throw fehler(404, "unbekannt", "Diesen Rechner gibt es nicht.");
      const e = body.eigner || {};
      if (!String(e.name || "").trim() || !istEmail(e.email)) throw fehler(400, "eingabe", "Name und gültige E-Mail angeben.");
      const medien = (body.medien || []).slice(0, 12).filter(m => m && typeof m.url === "string").map(m => ({ url: m.url, name: String(m.name || "").slice(0, 80), typ: m.typ === "video" ? "video" : "foto" }));
      const a = {
        id: neueId("a"), token: zufall(24), partner_id: p.id, ausfuehrer_id: null, status: "neu", erstellt: jetzt(),
        eigner: { name: String(e.name).trim().slice(0, 120), email: String(e.email).trim().slice(0, 160), plz: String(e.plz || "").slice(0, 10),
          telefon: String(e.telefon || "").slice(0, 40), nachricht: String(e.nachricht || "").slice(0, 1000), sprache: SPRACHEN.includes(e.sprache) ? e.sprache : p.sprache },
        wunschtermin: body.wunschtermin || null, groesse_freitext: String(body.groesse_freitext || "").slice(0, 300),
        bestaetigungen: body.bestaetigungen || {}, kalkulation: body.kalkulation || {}, medien,
        angebot: null, zahlung: null, verlauf: [],
        /* Probe: Marina noch nicht live oder bewusst als Eigner getestet → keine Mails, keine Abrechnung */
        probe: p.modus !== "live" || body.probe === true
      };
      log(a, "anfrage", "eigner");
      db.put("anfragen", a);
      if (a.probe) { schritt(p.id, "probeanfrage"); schritt(p.id, "rechner"); }
      const mails = a.probe ? undefined : [
        { an: a.eigner.email, typ: "eigner_anfrage", token: a.token, partner_id: p.id },
        { an: (p.impressum && p.impressum.email) || p.email, typ: "marina_anfrage", anfrage_id: a.id, partner_id: p.id }];
      return { status: 201, data: { id: a.id, token: a.token, probe: a.probe }, mail: mails };
    });

    /* --- Eigner: Angebotsseite per Token --- */
    function perToken(t) { const a = anfragenAlle().find(x => x.token === t); if (!a) throw fehler(404, "unbekannt", "Diese Anfrage gibt es nicht."); return a; }
    function eignerSicht(a) {
      const p = db.get("partner", a.partner_id), ax = a.ausfuehrer_id === TESTLASER ? { id: TESTLASER, name: "Test-Laser-Partner" } : db.get("partner", ausfuehrerVon(a));
      const land = (a.kalkulation && a.kalkulation.land) || p.land;
      const fin = a.angebot ? finanzierung(p, land, a.angebot.brutto) : null;
      return { status: a.status, erstellt: a.erstellt, probe: !!a.probe, eigner: { name: a.eigner.name, sprache: a.eigner.sprache },
        partner: oeffentlich(p), ausfuehrer: ax && ax.id !== p.id ? { name: ax.name } : null,
        kalkulation: a.kalkulation, wunschtermin: a.wunschtermin, angebot: a.angebot, zahlung: a.zahlung,
        finanzierung: fin, erstattbar: a.status === "angenommen",
        waehrung: { code: WAEHRUNG[land] || "EUR", kurs: KURS[WAEHRUNG[land] || "EUR"] || 1, land }, verlauf: a.verlauf.map(v => ({ t: v.t, ereignis: v.ereignis })) };
    }
    R("GET", "/api/angebot/:token", ({ params }) => ({ data: eignerSicht(perToken(params.token)) }));
    R("POST", "/api/angebot/:token/annehmen", ({ params, body }) => {
      const a = Object.assign({}, perToken(params.token));
      if (a.status !== "angebot") throw fehler(409, "status", "Dieses Angebot kann gerade nicht angenommen werden.");
      const art = body.zahlart === "finanzierung" ? "finanzierung" : "anzahlung";
      const p = db.get("partner", a.partner_id);
      let betrag = r2(a.angebot.brutto * ANZAHLUNG), fin = null;
      if (art === "finanzierung") {
        fin = finanzierung(p, (a.kalkulation && a.kalkulation.land) || p.land, a.angebot.brutto);
        if (!fin) throw fehler(400, "finanzierung", "Für diesen Betrag oder dieses Land ist keine Finanzierung möglich.");
        betrag = fin.finanzierbar;
      }
      /* Klarna-Rahmen kleiner als der Preis (z. B. Finnland bis 3.000 €): Rest zahlt der Eigner bei Annahme */
      const rest = fin ? fin.rest : 0;
      a.zahlung = { art, betrag, rest_bei_annahme: rest, status: "reserviert", datum: jetzt(), finanzierung: fin, referenz: opt.zahlung ? opt.zahlung(a, art, betrag) : "DEMO-" + zufall(6).toUpperCase() };
      a.status = "angenommen";
      log(a, "angenommen", "eigner", { zahlart: art });
      if (a.ausfuehrer_id === TESTLASER) { a.status = "bestaetigt"; a.zahlung.status = "gebunden"; log(a, "bestaetigt", "Test-Laser-Partner"); }
      db.put("anfragen", a);
      return { data: eignerSicht(a) };
    });
    R("POST", "/api/angebot/:token/ablehnen", ({ params }) => {
      const a = Object.assign({}, perToken(params.token));
      if (a.status !== "angebot") throw fehler(409, "status", "Nicht möglich.");
      a.status = "abgelehnt"; log(a, "abgelehnt_eigner", "eigner"); db.put("anfragen", a);
      return { data: eignerSicht(a) };
    });
    R("POST", "/api/angebot/:token/stornieren", ({ params }) => {
      const a = Object.assign({}, perToken(params.token));
      if (a.status !== "angenommen") throw fehler(409, "status", "Der Auftrag ist bereits bestätigt und kann nicht mehr kostenfrei storniert werden.");
      a.status = "storniert"; a.zahlung = Object.assign({}, a.zahlung, { status: "erstattet", erstattet: jetzt() });
      log(a, "storniert", "eigner"); db.put("anfragen", a);
      return { data: eignerSicht(a) };
    });

    /* --- Partner: Anfragen --- */
    R("GET", "/api/anfragen", ({ session }) => {
      const p = brauchtLogin(session);
      const liste = anfragenAlle().filter(a => darfSehen(p, a)).sort((x, y) => y.erstellt.localeCompare(x.erstellt)).map(mitNamen);
      return { data: liste };
    });
    R("GET", "/api/anfragen/:id", ({ session, params }) => {
      const p = brauchtLogin(session), a = db.get("anfragen", params.id);
      if (!a || !darfSehen(p, a)) throw fehler(404, "unbekannt", "Anfrage nicht gefunden.");
      const kand = laserPartnerFuer(partnerAlle(), db.get("partner", a.partner_id).land, a.eigner.plz, a.partner_id);
      let liste = kand.liste.map(x => ({ id: x.id, name: x.name, region: x.region, geschuetzt: schutzAktiv(x) }));
      if (a.probe) liste = [{ id: TESTLASER, name: "Test-Laser-Partner", region: { name: "Simulation" }, geschuetzt: false }].concat(liste);
      return { data: Object.assign(mitNamen(a), { laserpartner: liste, exklusiv: kand.exklusiv && !a.probe }) };
    });
    function ladeFuer(p, id) { const a = db.get("anfragen", id); if (!a || !darfSehen(p, a)) throw fehler(404, "unbekannt", "Anfrage nicht gefunden."); return Object.assign({}, a); }

    R("POST", "/api/anfragen/:id/angebot", ({ session, params, body }) => {
      const p = brauchtLogin(session), a = ladeFuer(p, params.id);
      if (!["neu", "angebot"].includes(a.status)) throw fehler(409, "status", "Ein Angebot ist in diesem Status nicht möglich.");
      const netto = Number(body.festpreis_netto);
      if (!(netto > 0)) throw fehler(400, "eingabe", "Festpreis (netto) angeben.");
      if (!body.termin) throw fehler(400, "eingabe", "Termin angeben.");
      const land = (a.kalkulation && a.kalkulation.land) || db.get("partner", a.partner_id).land;
      const satz = MWST[land] !== undefined ? MWST[land] : 0;
      a.angebot = { festpreis_netto: r2(netto), mwst_satz: satz, brutto: r2(netto * (1 + satz)), anzahlung: r2(netto * (1 + satz) * ANZAHLUNG),
        termin: body.termin, tage: Number(body.tage) || null, notiz: String(body.notiz || "").slice(0, 1000), von: p.id, erstellt: jetzt() };
      a.status = "angebot";
      log(a, "angebot", p.name);
      db.put("anfragen", a);
      if (a.probe) { schritt(a.partner_id, "angebot"); return { data: mitNamen(a) }; }
      return { data: mitNamen(a), mail: { an: a.eigner.email, typ: "angebot", token: a.token, partner_id: a.partner_id } };
    });
    R("POST", "/api/anfragen/:id/ablehnen", ({ session, params, body }) => {
      const p = brauchtLogin(session), a = ladeFuer(p, params.id);
      if (!["neu", "angebot"].includes(a.status)) throw fehler(409, "status", "In diesem Status nicht möglich.");
      a.status = "abgelehnt"; log(a, "abgelehnt", p.name, { grund: String(body.grund || "").slice(0, 300) });
      db.put("anfragen", a);
      return { data: mitNamen(a) };
    });
    R("POST", "/api/anfragen/:id/weitergeben", ({ session, params, body }) => {
      const p = brauchtLogin(session), a = ladeFuer(p, params.id);
      if (a.partner_id !== p.id) throw fehler(403, "recht", "Nur die Marina, bei der die Anfrage einging, kann sie weitergeben.");
      if (!["neu", "angebot", "angenommen"].includes(a.status)) throw fehler(409, "status", "In diesem Status nicht möglich.");
      if (body.an === TESTLASER) {
        if (!a.probe) throw fehler(400, "eingabe", "Der Test-Laser-Partner gilt nur für Probe-Anfragen.");
        a.ausfuehrer_id = TESTLASER; log(a, "weitergegeben", p.name, { an: "Test-Laser-Partner" });
        if (a.status === "angenommen") { a.status = "bestaetigt"; a.zahlung = Object.assign({}, a.zahlung, { status: "gebunden" }); log(a, "bestaetigt", "Test-Laser-Partner"); }
        db.put("anfragen", a); return { data: mitNamen(a) };
      }
      const ziel = db.get("partner", body.an);
      if (!ziel || ziel.rolle !== "ausfuehrend") throw fehler(400, "eingabe", "Bitte einen Laser-Partner wählen.");
      const k = laserPartnerFuer(partnerAlle(), p.land, a.eigner.plz, p.id);
      if (k.exklusiv && !k.liste.some(x => x.id === ziel.id)) throw fehler(409, "gebietsschutz", "In diesem Gebiet gilt Gebietsschutz. Die Anfrage geht an den geschützten Partner.");
      a.ausfuehrer_id = ziel.id;
      log(a, "weitergegeben", p.name, { an: ziel.name });
      db.put("anfragen", a);
      return { data: mitNamen(a) };
    });
    R("POST", "/api/anfragen/:id/bestaetigen", ({ session, params }) => {
      const p = brauchtLogin(session), a = ladeFuer(p, params.id);
      if (a.status !== "angenommen") throw fehler(409, "status", "Bestätigen geht erst, wenn der Eigner angenommen hat.");
      if (ausfuehrerVon(a) !== p.id) throw fehler(403, "recht", "Nur der ausführende Betrieb bestätigt den Termin.");
      if (p.rolle !== "ausfuehrend") throw fehler(409, "kein_laser", "Bestätigen kann nur ein Betrieb mit Laser. Geben Sie die Anfrage an einen Laser-Partner weiter oder stellen Sie unter Konto auf „führe selbst aus“ um.");
      a.status = "bestaetigt"; a.zahlung = Object.assign({}, a.zahlung, { status: "gebunden" });
      log(a, "bestaetigt", p.name); db.put("anfragen", a);
      return { data: mitNamen(a), mail: a.probe ? undefined : { an: a.eigner.email, typ: "bestaetigt", token: a.token } };
    });
    R("POST", "/api/anfragen/:id/abschliessen", ({ session, params }) => {
      const p = brauchtLogin(session), a = ladeFuer(p, params.id);
      if (a.status !== "bestaetigt") throw fehler(409, "status", "Abschließen geht erst nach der Bestätigung.");
      if (ausfuehrerVon(a) !== p.id) throw fehler(403, "recht", "Nur der ausführende Betrieb schließt ab.");
      a.status = "abgeschlossen"; log(a, "abgeschlossen", p.name);
      const ab = abrechnung(a);
      if (!a.probe) for (const x of ab.posten) db.put("buchungen", Object.assign({ id: neueId("b"), anfrage_id: a.id, datum: jetzt(), netto: ab.netto }, x));
      db.put("anfragen", a);
      return { data: mitNamen(a) };
    });

    /* --- Partner: Abrechnung, Übersicht, Laser-Partner --- */
    R("GET", "/api/abrechnung", ({ session }) => {
      const p = brauchtLogin(session);
      const b = db.all("buchungen").filter(x => p.admin ? true : x.partner_id === p.id).sort((x, y) => y.datum.localeCompare(x.datum));
      const summe = t => r2(b.filter(x => x.typ === t && (p.admin || x.partner_id === p.id)).reduce((s, x) => s + x.betrag, 0));
      return { data: { buchungen: b, gebuehren: summe("plattformgebuehr"), provision_erhalten: summe("provision_erhalten"), provision_gezahlt: summe("provision_gezahlt") } };
    });
    R("GET", "/api/uebersicht", ({ session }) => {
      const p = brauchtLogin(session);
      const meine = anfragenAlle().filter(a => darfSehen(p, a));
      const z = s => meine.filter(a => a.status === s).length;
      const start = (p.test && p.test.start) || p.erstellt.slice(0, 10);
      const ende = new Date(new Date(start).getTime() + ((p.test && p.test.wochen) || 6) * 7 * 864e5).toISOString().slice(0, 10);
      const imTest = meine.filter(a => !a.probe && a.partner_id === p.id && a.erstellt.slice(0, 10) >= start && a.erstellt.slice(0, 10) <= ende);
      const gebucht = imTest.filter(a => ["angenommen", "bestaetigt", "abgeschlossen"].includes(a.status));
      const wert = a => a.angebot ? a.angebot.festpreis_netto : (a.kalkulation && (a.kalkulation.preis_netto_von + a.kalkulation.preis_netto_bis) / 2) || 0;
      const umsatz = r2(gebucht.reduce((s, a) => s + wert(a), 0));
      const pipeline = r2(imTest.filter(a => ["neu", "angebot"].includes(a.status)).reduce((s, a) => s + wert(a), 0));
      const geraete = Object.fromEntries(Object.entries(GERAETE).map(([k, g]) => [k, { name: g.name, preis: g.preis, monatsrate: r2(g.preis * g.faktor60 / 100), jahresrate: r2(g.preis * g.faktor60 / 100 * 12) }]));
      return { data: {
        zaehler: { neu: z("neu"), angebot: z("angebot"), angenommen: z("angenommen"), bestaetigt: z("bestaetigt"), abgeschlossen: z("abgeschlossen") },
        reserviert: r2(meine.filter(a => a.status === "angenommen" && a.zahlung).reduce((s, a) => s + a.zahlung.betrag, 0)),
        test: { start, ende, anfragen: imTest.length, gebucht: gebucht.length, umsatz_gebucht: umsatz, umsatz_offen: pipeline,
          provision_bei_weitergabe: r2(umsatz * (PROVISION - GEBUEHR)), geraete },
        rolle: p.rolle, gebietsschutz_bis: p.gebietsschutz_bis,
        start: { modus: p.modus || "live", sandbox: !!p.sandbox, schritte: SCHRITTE.map(k => ({ k, erledigt: !!(p.onboarding && p.onboarding[k]) })) },
        probe_anfragen: meine.filter(a => a.probe).length
      } };
    });

    /* --- Boatsdoc (Admin) --- */
    R("GET", "/api/admin/partner", ({ session }) => {
      const p = brauchtLogin(session); if (!p.admin) throw fehler(403, "recht", "Nur für Boatsdoc.");
      const a = anfragenAlle();
      const tage = t => t ? (Date.now() - Date.parse(t)) / 864e5 : 999;
      return { data: partnerAlle().filter(x => !x.admin && x.slug !== BEISPIEL).map(x => {
        const eig = a.filter(y => y.partner_id === x.id), erledigt = SCHRITTE.filter(k => x.onboarding && x.onboarding[k]).length;
        const stufe = x.modus === "live" ? "live" : x.sandbox ? "probe" : "konto";
        /* Hängt fest: noch nicht live und seit 2 Tagen nichts getan (Probezugang ohne Konto: ab 1 Tag) */
        const haengt = stufe !== "live" && tage(x.zuletzt_aktiv) > (stufe === "probe" ? 1 : 2);
        return Object.assign(privat(x), { anfragen: eig.filter(y => !y.probe).length, probe_anfragen: eig.filter(y => y.probe && !y.beispiel).length,
          schutz: schutzAktiv(x), stufe, fortschritt: erledigt, schritte_gesamt: SCHRITTE.length, haengt, tage_inaktiv: Math.floor(tage(x.zuletzt_aktiv)) });
      }).sort((x, y) => (y.haengt - x.haengt) || String(y.zuletzt_aktiv).localeCompare(String(x.zuletzt_aktiv))) };
    });
    R("PUT", "/api/admin/partner/:id", ({ session, params, body }) => {
      const p = brauchtLogin(session); if (!p.admin) throw fehler(403, "recht", "Nur für Boatsdoc.");
      const x = db.get("partner", params.id); if (!x) throw fehler(404, "unbekannt", "Partner nicht gefunden.");
      const c = Object.assign({}, x);
      if (body.gebietsschutz === true) { const d = new Date(); d.setFullYear(d.getFullYear() + SCHUTZ_JAHRE); c.gebietsschutz_bis = d.toISOString().slice(0, 10); }
      if (body.gebietsschutz === false) c.gebietsschutz_bis = null;
      if (body.region) c.region = Object.assign({}, c.region, body.region);
      if (body.aktiv !== undefined) c.aktiv = !!body.aktiv;
      if (Array.isArray(body.domains)) c.domains = body.domains.map(d => String(d).trim().toLowerCase()).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
      db.put("partner", c);
      return { data: privat(c) };
    });

    /* Dispatcher: liefert {status, data, login?, logout?, mail?} oder wirft {status, code, message} */
    function handle(method, pfad, ctx) {
      for (const r of routes) {
        if (r.m !== method) continue;
        const m = r.re.exec(pfad);
        if (m) return r.fn(Object.assign({ body: {}, params: m.groups || {} }, ctx || {}));
      }
      throw fehler(404, "route", "Unbekannter Pfad.");
    }
    /* Probezugänge ohne Konto nach 30 Tagen löschen (mit ihren Anfragen) */
    function aufraeumen(tage) {
      const grenze = Date.now() - (tage || 30) * 864e5; let n = 0;
      /* Probe-Anfragen an die Beispiel-Marina der Website nach 7 Tagen löschen */
      const bsp = partnerAlle().find(p => p.slug === BEISPIEL);
      if (bsp) for (const a of anfragenAlle()) if (a.partner_id === bsp.id && Date.parse(a.erstellt) < Date.now() - 7 * 864e5) { db.del("anfragen", a.id); n++; }
      for (const p of partnerAlle()) if (p.sandbox && !p.email && Date.parse(p.zuletzt_aktiv || p.erstellt) < grenze) {
        for (const a of anfragenAlle()) if (a.partner_id === p.id) db.del("anfragen", a.id);
        db.del("partner", p.id); n++;
      }
      return n;
    }
    return { handle, partnerAlle, aufraeumen };
  }

  /* Demo-Partner (fiktiv) */
  function demoDaten() {
    const heute = new Date(), plus = j => { const d = new Date(heute); d.setFullYear(d.getFullYear() + j); return d.toISOString().slice(0, 10); };
    const testStart = new Date(heute.getTime() - 9 * 864e5).toISOString().slice(0, 10);
    return [
      neuerPartner({ name: "Marina Schleibucht", slug: "marina-schleibucht", email: "demo@marina-schleibucht.de", pw: "demo:demo1234", land: "DE", rolle: "vermittler", modus: "live",
        farbe: "#0E6E6A", kontakt: { tel: "+49 4642 000000", web: "marina-schleibucht.de", adresse: "Am Hafen 1, 24376 Kappeln", ansprechpartner: "Hafenmeister" },
        region: { name: "Schlei", plz: ["243"] }, test: { start: testStart, wochen: 6 } }),
      neuerPartner({ name: "Bootsservice Förde", slug: "bootsservice-foerde", email: "demo@bootsservice-foerde.de", pw: "demo:demo1234", land: "DE", rolle: "ausfuehrend", modus: "live",
        farbe: "#B5461F", kontakt: { tel: "+49 461 000000", web: "bootsservice-foerde.de", adresse: "Werftstraße 5, 24939 Flensburg", ansprechpartner: "Werkstatt" },
        region: { name: "Flensburger Förde bis Schlei", plz: ["24"] }, gebietsschutz_bis: plus(2) }),
      neuerPartner({ name: "Bohusvarvet", slug: "bohusvarvet", email: "demo@bohusvarvet.se", pw: "demo:demo1234", land: "SE", rolle: "ausfuehrend", modus: "live",
        farbe: "#1F4E8C", kontakt: { tel: "+46 525 000000", web: "bohusvarvet.se", adresse: "Hamnvägen 2, 457 00 Grebbestad" },
        region: { name: "Bohuslän", plz: ["45"] }, gebietsschutz_bis: plus(2) }),
      beispielMarina(),
      neuerPartner({ name: "Boatsdoc", slug: "boatsdoc-admin", email: "admin@boatsdoc.com", pw: "demo:demo1234", land: "DE", rolle: "vermittler", admin: true, modus: "live", farbe: "#C24A21" })
    ];
  }

  const Core = { createApi, neuerPartner, demoDaten, finanzierung, abrechnung, laserPartnerFuer, rate, slugify, zufall, kalkCfg, richtpreis, PAKETE, SCHRITTE, TESTLASER, BEISPIEL, beispielMarina, DETAILING, richtpreisDet, KURS,
    GEBUEHR, PROVISION, ANZAHLUNG, SCHUTZ_JAHRE, SPRACHEN, MWST, WAEHRUNG, FINANZIERER, PREIS_EMPFEHLUNG, GERAETE, STATUS, OFFEN, grundpreise };
  if (typeof module !== "undefined" && module.exports) module.exports = Core; else root.BoatsdocCore = Core;
})(typeof globalThis !== "undefined" ? globalThis : this);
