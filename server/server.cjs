/* Boatsdoc Server — Node.js ≥ 22.5, ohne externe Pakete.
   Liefert boatsdoc.com komplett aus: Website, Eigner-Rechner, Marina-Backend und API — eine Domain.
   Start:  node server/server.cjs        (Port über PORT, Daten über DATA_DIR)
   Speichert alles in SQLite (DATA_DIR/boatsdoc.db), Uploads in DATA_DIR/uploads. */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const Core = require("../core.js");

const PORT = Number(process.env.PORT || 8080);
const APP = path.resolve(process.env.PUBLIC_DIR || path.join(__dirname, ".."));   // Repo-Wurzel = Website
/* Nur diese Dateitypen werden ausgeliefert, interne Ordner nie */
const OEFFENTLICH = /\.(html|js|css|jpg|jpeg|png|webp|svg|ico|mp4|webm|pdf|woff2?)$/i;
const GESPERRT = /^\/(server|deploy|tools|src|data|node_modules|\.git|\.github)(\/|$)|^\/\./;
const SALES_EMAIL = process.env.SALES_EMAIL || "";
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, "../data"));
const UPL = path.join(DATA, "uploads");
const MAX_UPLOAD = { foto: 15 * 1024 * 1024, video: 150 * 1024 * 1024 };
const BASIS_URL = process.env.BASE_URL || "";            // z. B. https://app.boatsdoc.com — für Links in E-Mails
const SICHER = process.env.COOKIE_SECURE === "1";        // hinter HTTPS auf 1 setzen
fs.mkdirSync(UPL, { recursive: true });
/* Hauptdomain (aus BASE_URL). Alles andere, was auf diesen Server zeigt, ist ein White-Label-Rechner. */
const HAUPT = (() => { try { return new URL(BASIS_URL).hostname.replace(/^www\./, ""); } catch (_) { return "boatsdoc.com"; } })();
const EIGENE = new Set([HAUPT, "www." + HAUPT, "neu." + HAUPT, "localhost", "127.0.0.1"]);

/* ---------- Datenbank: Dokumente je Tabelle ---------- */
const sql = new DatabaseSync(path.join(DATA, "boatsdoc.db"));
sql.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;");
const TABELLEN = ["partner", "anfragen", "buchungen", "sitzungen", "postausgang"];
for (const t of TABELLEN) sql.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, data TEXT NOT NULL, geaendert TEXT NOT NULL)`);
const st = {};
for (const t of TABELLEN) st[t] = {
  all: sql.prepare(`SELECT data FROM ${t}`),
  get: sql.prepare(`SELECT data FROM ${t} WHERE id = ?`),
  put: sql.prepare(`INSERT INTO ${t} (id, data, geaendert) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, geaendert = excluded.geaendert`),
  del: sql.prepare(`DELETE FROM ${t} WHERE id = ?`)
};
const db = {
  all: t => st[t].all.all().map(r => JSON.parse(r.data)),
  get: (t, id) => { const r = st[t].get.get(id); return r ? JSON.parse(r.data) : null; },
  put: (t, o) => st[t].put.run(o.id, JSON.stringify(o), new Date().toISOString()),
  del: (t, id) => st[t].del.run(id)
};

/* ---------- Passwörter ---------- */
function hash(pw) { const salt = crypto.randomBytes(16); return "scrypt$" + salt.toString("hex") + "$" + crypto.scryptSync(pw, salt, 32).toString("hex"); }
function verify(pw, h) {
  if (!h || !h.startsWith("scrypt$")) return h === "demo:" + pw && process.env.SEED_DEMO !== "0";
  const [, s, d] = h.split("$"); const a = crypto.scryptSync(pw, Buffer.from(s, "hex"), 32), b = Buffer.from(d, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const api = Core.createApi(db, { hash, verify });

/* Demo-Partner beim ersten Start (abschalten mit SEED_DEMO=0) */
if (!db.all("partner").length && process.env.SEED_DEMO !== "0") {
  for (const p of Core.demoDaten()) db.put("partner", p);
  console.log("Demo-Partner angelegt (Passwort: demo1234).");
}
/* Beispiel-Rechner der Website gibt es immer (Probebetrieb, kein Login) */
if (!db.all("partner").some(p => p.slug === Core.BEISPIEL)) db.put("partner", Core.beispielMarina());

/* ---------- Sitzungen ---------- */
const COOKIE = "bd_s";
function cookies(req) { return Object.fromEntries((req.headers.cookie || "").split(/;\s*/).filter(Boolean).map(c => { const i = c.indexOf("="); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; })); }
function sitzung(req) {
  const t = cookies(req)[COOKIE]; if (!t) return null;
  const s = db.get("sitzungen", crypto.createHash("sha256").update(t).digest("hex"));
  if (!s || s.bis < new Date().toISOString()) return null;
  const p = db.get("partner", s.partner_id);
  return p && p.aktiv !== false ? { partner: p, id: s.id } : null;
}
function neueSitzung(partnerId) {
  const t = crypto.randomBytes(32).toString("base64url");
  db.put("sitzungen", { id: crypto.createHash("sha256").update(t).digest("hex"), partner_id: partnerId, bis: new Date(Date.now() + 30 * 864e5).toISOString() });
  return `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${SICHER ? "; Secure" : ""}`;
}

/* ---------- E-Mail (Postausgang) ----------
   Mails landen in der Tabelle postausgang und im Log. Für echten Versand hier einen SMTP-/API-Dienst anbinden. */
const BETREFF = { angebot: "Ihr Festpreisangebot", bestaetigt: "Ihr Termin ist bestätigt" };
const Mailer = require("./mailer.cjs");
const MAILTEXTE = require("./mailtexte.cjs");
/* Basisadresse für Links in Mails: eigene Adresse der Marina (White-Label), sonst die Hauptdomain */
function basisFuer(partner, req) {
  if (partner && partner.domains && partner.domains[0]) return "https://" + partner.domains[0];
  if (partner && partner.modus === "live" && BASIS_URL && /^https:/.test(BASIS_URL)) return `https://${partner.slug}.${HAUPT}`;
  return BASIS_URL || `http://${req.headers.host}`;
}
function protokoll(eintrag) { db.put("postausgang", Object.assign({ id: Core.zufall(12), t: new Date().toISOString() }, eintrag)); }
function mail(m, req) {
  if (Array.isArray(m)) return m.forEach(x => mail(x, req));
  if (m.intern) {   // Benachrichtigung an den Vertrieb (neuer Probezugang, Konto gesichert, live)
    const betreff = `Boatsdoc: ${m.typ} – ${m.partner}`;
    protokoll({ an: SALES_EMAIL || "(Vertrieb)", typ: m.typ, betreff });
    console.log(`[Vertrieb] ${m.typ}: ${m.partner}`);
    if (SALES_EMAIL && Mailer.aktiv()) Mailer.senden({ an: SALES_EMAIL, betreff, text: `${m.typ}: ${m.partner}\n\n${BASIS_URL || ""}/partner.html#admin`, absenderName: "Boatsdoc" })
      .catch(e => console.error("[Mail] Fehler:", e.message));
    return;
  }
  const partner = m.partner_id ? db.get("partner", m.partner_id) : null;
  const marina = partner ? partner.name : "Boatsdoc";
  const basis = basisFuer(partner, req);
  let sprache, link, ersetzen = {};
  if (m.typ === "marina_anfrage") {
    const a = db.get("anfragen", m.anfrage_id) || {};
    sprache = (partner && partner.sprache) || "de";
    link = `${BASIS_URL || basis}/partner.html#anfragen`;
    const b = (a.kalkulation && a.kalkulation.boot) || {};
    ersetzen = { name: (a.eigner && a.eigner.name) || "", boot: [b.rumpf, b.lwl ? b.lwl + " m" : ""].filter(Boolean).join(" ") };
  } else {
    const a = Object.values(db.all("anfragen")).find(x => x.token === m.token) || {};
    sprache = (a.eigner && a.eigner.sprache) || (partner && partner.sprache) || "de";
    link = `${basis}/angebot.html?t=${m.token}`;
    ersetzen = { name: (a.eigner && a.eigner.name) || "" };
  }
  const T = MAILTEXTE[sprache] || MAILTEXTE.de, vorlage = T[m.typ];
  if (!vorlage) { console.log(`[Mail] unbekannter Typ ${m.typ}`); return; }
  const fuell = s => s.replace(/\{marina\}/g, marina).replace(/\{link\}/g, link).replace(/\{name\}/g, ersetzen.name || "").replace(/\{boot\}/g, ersetzen.boot || "");
  const betreff = fuell(vorlage[0]), text = fuell(vorlage[1]) + (m.typ === "marina_anfrage" ? "" : "\n\n--\n" + fuell(T.fuss));
  const antwortAn = m.typ === "marina_anfrage" ? (SALES_EMAIL || undefined) : ((partner && partner.impressum && partner.impressum.email) || (partner && partner.email) || undefined);
  const eintrag = { an: m.an, typ: m.typ, betreff, link, status: "protokolliert" };
  console.log(`[Mail] an ${m.an}: ${betreff} → ${link}`);
  if (!Mailer.aktiv()) return protokoll(eintrag);
  Mailer.senden({ an: m.an, betreff, text, absenderName: m.typ === "marina_anfrage" ? "Boatsdoc" : marina, antwortAn })
    .then(() => protokoll(Object.assign(eintrag, { status: "gesendet" })))
    .catch(e => { console.error("[Mail] Fehler:", e.message); protokoll(Object.assign(eintrag, { status: "fehler", fehler: e.message })); });
}

/* ---------- Hilfen ---------- */
function json(res, status, data, headers) {
  const b = JSON.stringify(data);
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, headers || {}));
  res.end(b);
}
function body(req, max) {
  return new Promise((ok, nein) => {
    let n = 0; const teile = [];
    req.on("data", c => { n += c.length; if (n > max) { nein(Object.assign(new Error("Zu groß"), { status: 413 })); req.destroy(); } else teile.push(c); });
    req.on("end", () => ok(Buffer.concat(teile)));
    req.on("error", nein);
  });
}
const TYPEN = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4",
  ".mov": "video/quicktime", ".webm": "video/webm", ".pdf": "application/pdf", ".ico": "image/x-icon", ".heic": "image/heic" };
function datei(req, res, voll) {
  fs.stat(voll, (err, s) => {
    if (err || !s.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Nicht gefunden"); }
    const typ = TYPEN[path.extname(voll).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && typ.startsWith("video/")) {
      const a = range[1] ? +range[1] : 0, e = range[2] ? +range[2] : s.size - 1;
      res.writeHead(206, { "Content-Type": typ, "Content-Range": `bytes ${a}-${e}/${s.size}`, "Accept-Ranges": "bytes", "Content-Length": e - a + 1 });
      return fs.createReadStream(voll, { start: a, end: e }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": typ, "Content-Length": s.size, "Cache-Control": voll.startsWith(UPL) ? "private, max-age=86400" : "no-cache" });
    fs.createReadStream(voll).pipe(res);
  });
}
function sicherPfad(basis, rel) { const p = path.normalize(path.join(basis, rel)); return p.startsWith(basis + path.sep) || p === basis ? p : null; }

/* Einfache Drosselung für öffentliche Schreibzugriffe (je IP, pro Minute) */
const zaehler = new Map();
function gedrosselt(req, limit) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const k = ip + ":" + Math.floor(Date.now() / 60000), n = (zaehler.get(k) || 0) + 1;
  zaehler.set(k, n); if (zaehler.size > 5000) zaehler.clear();
  return n > limit;
}

/* ---------- Upload (roh, eine Datei je Anfrage) ---------- */
function upload(req, res, url) {
  if (gedrosselt(req, 40)) return json(res, 429, { code: "langsam", message: "Zu viele Uploads. Bitte kurz warten." });
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  const typ = ct.startsWith("video/") ? "video" : ct.startsWith("image/") ? "foto" : null;
  if (!typ) return json(res, 415, { code: "typ", message: "Nur Fotos oder Videos." });
  const name = String(url.searchParams.get("name") || "datei").slice(0, 80);
  const ext = (path.extname(name).toLowerCase().match(/^\.(jpe?g|png|webp|heic|heif|mp4|mov|m4v|webm)$/) || [typ === "video" ? ".mp4" : ".jpg"])[0];
  const id = crypto.randomBytes(15).toString("base64url") + ext;
  const ziel = path.join(UPL, id), out = fs.createWriteStream(ziel);
  let n = 0, abbruch = false;
  req.on("data", c => { n += c.length; if (n > MAX_UPLOAD[typ] && !abbruch) { abbruch = true; out.destroy(); fs.rm(ziel, () => {}); json(res, 413, { code: "gross", message: "Datei zu groß." }); req.destroy(); } });
  req.pipe(out);
  out.on("finish", () => { if (!abbruch) json(res, 201, { url: "/uploads/" + id, name, typ }); });
  out.on("error", () => { if (!abbruch) json(res, 500, { code: "speicher", message: "Speichern fehlgeschlagen." }); });
}

/* ---------- White-Label ---------- */
/* <slug>.boatsdoc.com oder eine beim Partner eingetragene Domain (z. B. boatsdoc.gbm.se) → Rechner dieser Marina */
function whiteLabel(hostHeader) {
  const h = String(hostHeader || "").toLowerCase().replace(/:\d+$/, "");
  if (!h || EIGENE.has(h)) return null;
  const alle = db.all("partner").filter(p => p.aktiv !== false);
  const perDomain = alle.find(p => (p.domains || []).includes(h));
  if (perDomain) return perDomain;
  if (h.endsWith("." + HAUPT)) { const sub = h.slice(0, -(HAUPT.length + 1)); return alle.find(p => p.slug === sub && p.modus === "live") || null; }
  return null;
}
function rechnerFuer(res, p) {
  fs.readFile(path.join(APP, "kalkulator.html"), "utf8", (err, html) => {
    if (err) { res.writeHead(500); return res.end(); }
    const tag = `<script>window.BD_PARTNER=${JSON.stringify(p.slug)};</script>`;
    const out = Buffer.from(html.replace("<head>", "<head>\n" + tag), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": out.length, "Cache-Control": "no-cache" });
    res.end(out);
  });
}

/* ---------- Server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = decodeURIComponent(url.pathname);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  /* Der Eigner-Rechner darf auf der Website der Marina eingebettet werden, alles andere nicht */
  if (!/^\/(kalkulator\.html|impressum\.html|core\.js|store\.js|api\/|uploads\/)/.test(p) && p !== "/") res.setHeader("X-Frame-Options", "SAMEORIGIN");
  try {
    if (p === "/api/ping") return json(res, 200, { boatsdoc: true, version: 1 });
    /* Caddy fragt vor dem Ausstellen eines Zertifikats, ob die Adresse zu uns gehört */
    if (p === "/api/tls-ok") { const d = String(url.searchParams.get("domain") || "").toLowerCase(); return json(res, EIGENE.has(d) || whiteLabel(d) ? 200 : 404, {}); }
    const wl = whiteLabel(req.headers.host);
    if (wl && (p === "/" || p === "/index.html")) return rechnerFuer(res, wl);
    if (wl && p === "/impressum") { res.writeHead(302, { Location: "/impressum.html?p=" + wl.slug }); return res.end(); }
    /* Land für die MwSt.: aus dem CDN-Header (z. B. Cloudflare), sonst leer → der Kalkulator nutzt Zeitzone/Sprache */
    if (p === "/api/region") return json(res, 200, { land: String(req.headers["cf-ipcountry"] || req.headers["x-country"] || "").toUpperCase() || null });
    /* Wechselkurse: hier kann ein EZB-Abruf angebunden werden; ohne Angabe nutzt der Kalkulator seine hinterlegten Kurse */
    if (p === "/api/fx") return json(res, 200, { kurse: {}, quelle: "config" });
    if (p === "/api/upload" && req.method === "PUT") return upload(req, res, url);
    if (p.startsWith("/api/")) {
      if (req.method !== "GET" && p.startsWith("/api/public/") && gedrosselt(req, 20)) return json(res, 429, { code: "langsam", message: "Zu viele Anfragen. Bitte kurz warten." });
      if (p === "/api/probe" && req.method === "POST" && gedrosselt(req, Number(process.env.PROBE_PRO_MINUTE || 5))) return json(res, 429, { code: "langsam", message: "Zu viele neue Probezugänge. Bitte eine Minute warten." });
      if (p.startsWith("/api/auth/login") && gedrosselt(req, 10)) return json(res, 429, { code: "langsam", message: "Zu viele Versuche. Bitte eine Minute warten." });
      let b = {};
      if (req.method !== "GET") { const raw = await body(req, 1024 * 1024); b = raw.length ? JSON.parse(raw.toString("utf8")) : {}; }
      const s = sitzung(req);
      const r = api.handle(req.method, p, { body: b, session: s });
      const h = {};
      if (r.login) { adminsSetzen(); h["Set-Cookie"] = neueSitzung(r.login); }
      if (r.logout) { if (s) db.del("sitzungen", s.id); h["Set-Cookie"] = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }
      if (r.mail) mail(r.mail, req);
      return json(res, r.status || 200, r.data, h);
    }
    if (p.startsWith("/uploads/")) { const f = sicherPfad(UPL, p.slice(9)); return f ? datei(req, res, f) : json(res, 404, {}); }
    /* Kurz-Links: /k/<slug> → Kalkulator der Marina, /a/<token> → Angebotsseite */
    let m;
    if ((m = /^\/k\/([a-z0-9-]+)\/?$/.exec(p))) { res.writeHead(302, { Location: "/kalkulator.html?p=" + m[1] }); return res.end(); }
    if ((m = /^\/a\/([a-z0-9]+)\/?$/.exec(p))) { res.writeHead(302, { Location: "/angebot.html?t=" + m[1] }); return res.end(); }
    if (p === "/partner" || p === "/backend") { res.writeHead(302, { Location: "/partner.html" }); return res.end(); }
    if (p === "/testen") { res.writeHead(302, { Location: "/#testen" }); return res.end(); }
    const rel = p === "/" ? "/index.html" : p;
    if (GESPERRT.test(rel) || !OEFFENTLICH.test(rel) && rel !== "/texte.json") { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Nicht gefunden"); }
    const f = sicherPfad(APP, rel.slice(1));
    if (!f) return json(res, 404, {});
    return datei(req, res, f);
  } catch (e) {
    const status = e.status || (e instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error(e);
    return json(res, status, { code: e.code || "fehler", message: status >= 500 ? "Interner Fehler." : e.message });
  }
});
/* Boatsdoc-Team: Konten mit diesen E-Mails (ADMIN_EMAILS, kommagetrennt) bekommen das Sales-Cockpit.
   Ablauf: ganz normal über „Jetzt testen“ ein Konto anlegen und sichern, E-Mail in /etc/boatsdoc.env eintragen. */
const ADMINS = String(process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map(x => x.trim()).filter(Boolean);
function adminsSetzen() {
  if (!ADMINS.length) return;
  for (const x of db.all("partner")) if (ADMINS.includes(x.email) && !x.admin) { db.put("partner", Object.assign({}, x, { admin: true, modus: "live" })); console.log("Sales-Cockpit freigeschaltet für", x.email); }
}
adminsSetzen();
/* Probezugänge ohne Konto nach 30 Tagen entfernen: beim Start und täglich */
const aufraeumen = () => { try { const n = api.aufraeumen(30); if (n) console.log(`Aufgeräumt: ${n} alte Probezugänge`); } catch (e) { console.error(e); } };
aufraeumen(); setInterval(aufraeumen, 864e5).unref();
server.listen(PORT, () => console.log(`Boatsdoc läuft auf http://localhost:${PORT}  ·  Daten: ${DATA}`));
module.exports = server;
