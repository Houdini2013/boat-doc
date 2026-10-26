/* Minimaler SMTP-Versand ohne externe Pakete: SMTPS (Port 465, TLS von Anfang an) mit AUTH LOGIN.
   Konfiguration über Umgebung: SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS, MAIL_FROM (Standard = SMTP_USER). */
"use strict";
const tls = require("node:tls");
const crypto = require("node:crypto");

const CFG = () => ({
  host: process.env.SMTP_HOST || "", port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || "", pass: process.env.SMTP_PASS || "",
  from: process.env.MAIL_FROM || process.env.SMTP_USER || ""
});
const aktiv = () => { const c = CFG(); return !!(c.host && c.user && c.pass && c.from); };

const b64 = s => Buffer.from(String(s), "utf8").toString("base64");
const kopf = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;   // Umlaute in Betreff/Namen
const adresse = (name, mail) => name ? `${kopf(String(name).replace(/["\r\n]/g, ""))} <${mail}>` : `<${mail}>`;
const sauber = s => String(s || "").replace(/[\r\n]/g, "").trim();

/* m = { an, betreff, text, absenderName, antwortAn } */
function nachricht(c, m) {
  const id = `<${crypto.randomUUID()}@${c.from.split("@")[1] || "boatsdoc.com"}>`;
  const zeilen = [
    `From: ${adresse(m.absenderName || "Boatsdoc", c.from)}`,
    `To: <${sauber(m.an)}>`,
    m.antwortAn ? `Reply-To: <${sauber(m.antwortAn)}>` : null,
    `Subject: ${kopf(sauber(m.betreff))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${id}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "", (b64(m.text).match(/.{1,76}/g) || []).join("\r\n"), ""
  ].filter(z => z !== null);
  return zeilen.join("\r\n");
}

function senden(m) {
  const c = CFG();
  if (!aktiv()) return Promise.reject(new Error("SMTP nicht eingerichtet"));
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sauber(m.an))) return Promise.reject(new Error("Ungültige Empfängeradresse"));
  return new Promise((ok, nein) => {
    const s = tls.connect({ host: c.host, port: c.port, servername: c.host });
    s.setEncoding("utf8"); s.setTimeout(20000, () => { s.destroy(); nein(new Error("SMTP Zeitüberschreitung")); });
    let puffer = "", schritt = 0;
    const schritte = [
      [220, () => `EHLO boatsdoc.com`],
      [250, () => "AUTH LOGIN"],
      [334, () => b64(c.user)],
      [334, () => b64(c.pass)],
      [235, () => `MAIL FROM:<${c.from}>`],
      [250, () => `RCPT TO:<${sauber(m.an)}>`],
      [250, () => "DATA"],
      [354, () => nachricht(c, m).replace(/\r\n\./g, "\r\n..") + "\r\n."],
      [250, () => "QUIT"],
    ];
    s.on("data", d => {
      puffer += d;
      /* vollständige Antwort: letzte Zeile "NNN text" (ohne Bindestrich) */
      const zeilen = puffer.split("\r\n").filter(Boolean);
      const letzte = zeilen[zeilen.length - 1] || "";
      if (!/^\d{3} /.test(letzte) || !puffer.endsWith("\r\n")) return;
      puffer = "";
      const code = +letzte.slice(0, 3);
      if (schritt >= schritte.length) { s.end(); return ok(); }
      const [erwartet, befehl] = schritte[schritt];
      if (code !== erwartet) { s.destroy(); return nein(new Error(`SMTP ${code}: ${letzte.slice(4, 200)}`)); }
      schritt++;
      s.write(befehl() + "\r\n");
      if (schritt === schritte.length) setTimeout(() => { s.end(); ok(); }, 300);
    });
    s.on("error", nein);
  });
}

module.exports = { senden, aktiv, nachricht, CFG };
