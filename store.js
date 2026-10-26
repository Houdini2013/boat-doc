/* Boatsdoc Store — eine Schnittstelle für alle Seiten.
   Server-Modus: echte REST-API (/api/…).  Demo-Modus: dieselbe Logik (core.js) im Browser mit localStorage.
   Der Modus wird automatisch erkannt: antwortet /api/ping mit {boatsdoc:true}, läuft der Server. */
(function () {
  "use strict";
  const Core = window.BoatsdocCore;
  const LS = "boatsdoc_demo_v3";
  let modus = null, api = null, bereit = null;

  /* ---------- Demo-Speicher ---------- */
  function ladeDb() {
    try { const s = localStorage.getItem(LS); if (s) return JSON.parse(s); } catch (_) {}
    return null;
  }
  let MEM = null;
  function speichere() {
    try { localStorage.setItem(LS, JSON.stringify(MEM)); }
    catch (e) { console.warn("Demo-Speicher voll", e); throw Object.assign(new Error("Der Demo-Speicher im Browser ist voll. Unter „Demo zurücksetzen“ leeren."), { status: 507 }); }
  }
  const demoDb = {
    all: t => Object.values(MEM[t] || {}),
    get: (t, id) => (MEM[t] || {})[id] || null,
    put: (t, o) => { (MEM[t] = MEM[t] || {})[o.id] = JSON.parse(JSON.stringify(o)); speichere(); },
    del: (t, id) => { if (MEM[t]) delete MEM[t][id]; speichere(); }
  };
  function demoStart() {
    MEM = ladeDb();
    if (!MEM || !MEM.partner) {
      MEM = { partner: {}, anfragen: {}, buchungen: {}, sitzung: null };
      for (const p of Core.demoDaten()) MEM.partner[p.id] = p;
      speichere();
      demoBeispiele();
    }
    api = Core.createApi(demoDb);
  }
  /* Zwei ältere Beispielanfragen, damit die Übersicht nicht leer ist */
  function demoBeispiele() {
    const tmp = Core.createApi(demoDb);
    const m = Object.values(MEM.partner).find(p => p.slug === "marina-schleibucht");
    if (!m) return;
    const tage = n => new Date(Date.now() - n * 864e5).toISOString();
    const beispiele = [
      { eigner: { name: "Jens Petersen", email: "jens.petersen@example.de", plz: "24376", telefon: "", sprache: "de" },
        kalk: { flaeche_m2: 25.7, preis_netto_von: 3790, preis_netto_bis: 4820, land: "DE", boot: { lwl: 8.6, breite: 3.1, tiefgang: 1.7, rumpf: "kurzkieler", zustand: "mittel" }, paket: "af", produkt: "unterwasserschiff", material: "gfk", tage: "3-4" },
        tag: 6, angebot: 4200 },
      { eigner: { name: "Birte Hansen", email: "birte.hansen@example.de", plz: "24340", telefon: "", sprache: "de" },
        kalk: { flaeche_m2: 33.2, preis_netto_von: 4450, preis_netto_bis: 5670, land: "DE", boot: { lwl: 8.5, breite: 3.0, tiefgang: 0.9, rumpf: "motorboot", zustand: "stark" }, paket: "af", produkt: "unterwasserschiff", material: "gfk", tage: "4-5" },
        tag: 3, angebot: null }
    ];
    for (const b of beispiele) {
      const r = tmp.handle("POST", "/api/public/" + m.slug + "/anfragen", { body: { eigner: b.eigner, kalkulation: b.kalk, wunschtermin: tage(-40).slice(0, 10), medien: [] } });
      const a = demoDb.get("anfragen", r.data.id);
      a.erstellt = tage(b.tag); a.verlauf[0].t = a.erstellt;
      demoDb.put("anfragen", a);
      if (b.angebot) {
        tmp.handle("POST", "/api/anfragen/" + a.id + "/angebot", { session: { partner: m }, body: { festpreis_netto: b.angebot, termin: tage(-150).slice(0, 10), tage: 4 } });
        tmp.handle("POST", "/api/angebot/" + a.token + "/annehmen", { body: { zahlart: "anzahlung" } });
      }
    }
  }
  function demoSession() { const id = MEM.sitzung; const p = id && MEM.partner[id]; return p ? { partner: p } : null; }

  /* ---------- Modus erkennen ---------- */
  async function erkennen() {
    try {
      const r = await fetch("/api/ping", { signal: AbortSignal.timeout(1500), cache: "no-store" });
      if (r.ok) { const j = await r.json(); if (j && j.boatsdoc) { modus = "server"; return; } }
    } catch (_) {}
    modus = "demo"; demoStart();
  }
  function init() { return bereit || (bereit = erkennen()); }

  /* ---------- Aufruf ---------- */
  async function call(method, pfad, body) {
    await init();
    if (modus === "server") {
      const r = await fetch(pfad, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.message || "Fehler " + r.status), { status: r.status, code: j.code });
      return j;
    }
    MEM = ladeDb() || MEM;   // andere Tabs (Kalkulator ↔ Backend) sehen Änderungen
    try {
      const res = api.handle(method, pfad, { body: body || {}, session: demoSession() });
      if (res.login) { MEM.sitzung = res.login; speichere(); }
      if (res.logout) { MEM.sitzung = null; speichere(); }
      if (res.mail) demoPost(res.mail);
      return JSON.parse(JSON.stringify(res.data));
    } catch (e) {
      throw Object.assign(new Error(e.message), { status: e.status || 500, code: e.code });
    }
  }
  /* E-Mails gehen in der Demo in ein Postfach, das die Angebotsseite verlinkt */
  function demoPost(m) { (MEM.post = MEM.post || []).push(Object.assign({ t: new Date().toISOString() }, m)); speichere(); }

  /* ---------- Dateien ---------- */
  function verkleinern(file, max, q) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", q));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Bild nicht lesbar")); };
      img.src = url;
    });
  }
  async function upload(file, onProgress) {
    await init();
    const video = (file.type || "").startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
    if (modus === "server") {
      return new Promise((res, rej) => {
        const x = new XMLHttpRequest();
        x.open("PUT", "/api/upload?name=" + encodeURIComponent(file.name));
        x.setRequestHeader("Content-Type", file.type || (video ? "video/mp4" : "image/jpeg"));
        x.upload.onprogress = e => onProgress && e.lengthComputable && onProgress(e.loaded / e.total);
        x.onload = () => { try { const j = JSON.parse(x.responseText); x.status < 300 ? res(j) : rej(new Error(j.message || "Upload fehlgeschlagen")); } catch (e) { rej(e); } };
        x.onerror = () => rej(new Error("Upload fehlgeschlagen"));
        x.send(file);
      });
    }
    if (video) return { url: "", name: file.name, typ: "video" };   // Demo speichert keine Videos
    return { url: await verkleinern(file, 1100, 0.78), name: file.name, typ: "foto" };
  }

  function demoReset() { try { localStorage.removeItem(LS); } catch (_) {} MEM = null; bereit = null; modus = null; }
  function demoPostfach() { MEM = ladeDb() || MEM; return (MEM && MEM.post) || []; }

  window.Boatsdoc = {
    init, call, upload, demoReset, demoPostfach,
    get modus() { return modus; },
    core: Core,
    /* Basis-URL für Links (Kalkulator, Angebotsseite) — funktioniert auf dem Server und in der Vorschau */
    url(seite, params) {
      const u = new URL(seite, location.href);
      for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
      return u.toString();
    }
  };
})();
