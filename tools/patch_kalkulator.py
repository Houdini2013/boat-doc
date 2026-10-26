"""Erzeugt app/kalkulator.html aus dem bestehenden Eigner-Kalkulator (src/kalkulator.orig.html).
Ändert nur: Anbindung an die Marina (Preise, Name, Farbe, Sprache), 6 Sprachen, Finanzierungszeile,
Anzahlungstexte, Absenden an das Backend. Alles andere bleibt wie im Original."""
import sys, re
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf8").read()
def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n < 1: raise SystemExit("Nicht gefunden: " + old[:80])
    if count == 1 and n != 1: raise SystemExit(f"Mehrdeutig ({n}x): " + old[:80])
    s = s.replace(old, new)

rep('<title>BOATSDOC</title>', '<title>Antifouling-Rechner</title>')
rep('<div class="logo"><i></i>BOATSDOC</div>', '<div class="logo" id="pLogo"><i></i><span id="pName">&nbsp;</span></div>')
rep('<div class="payrow"><span class="kpi-l" data-i18n="payT"></span><span data-i18n="payLine"></span></div>',
    '<div class="payrow"><span class="kpi-l" data-i18n="payT"></span><span data-i18n="payLine"></span></div>\n        <div class="finrow" id="finLine" hidden></div>')
rep('  <footer class="eyebrow" data-i18n="footer"></footer>',
    '  <footer class="eyebrow"><span data-i18n="footer"></span><span class="by" id="pBy"></span></footer>')
# CSS-Ergänzungen
rep('</style>\n</head>', '''  .finrow{margin-top:8px;padding:11px 14px;border:1px solid var(--line);border-left:2px solid var(--ok);border-radius:4px;font-size:.92rem;color:var(--txt)}
  .finrow b{font-family:var(--mono);color:var(--ok)}
  .finrow small{display:block;color:var(--mut);font-size:.78rem;margin-top:2px}
  footer .by{display:block;margin-top:6px;opacity:.7}
  .ok a{color:var(--txt)}
  .ok .code{display:block;margin-top:10px;font-family:var(--mono);font-size:.8rem;word-break:break-all;color:var(--mut)}
  body.lade main{opacity:.35;pointer-events:none}
  .gone{padding:40px 16px;text-align:center;color:var(--mut)}
  .probeban{max-width:1040px;margin:12px auto 0;padding:10px 14px;border:1px dashed var(--accsoft);border-radius:4px;font-size:.88rem;color:var(--txt);background:rgba(255,157,110,.06)}
  .probeban b{font-family:var(--mono);font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:var(--accsoft);margin-right:8px}
  .logo img{height:30px;width:auto;display:block;border-radius:3px;background:#fff;padding:2px 4px}
</style>
</head>''')
rep('<body>\n', '<body class="lade">\n')
rep('<div class="strap"><div class="eyebrow" data-i18n="claim"></div></div>', '<div class="strap"><div class="eyebrow" data-i18n="claim"></div></div>\n<div class="probeban" id="probeBan" hidden></div>')
rep('<script>\n"use strict";', '<script src="core.js"></script>\n<script src="store.js"></script>\n<script>\n"use strict";')

# Sprachen auf 6 begrenzen
rep('$("langSel").innerHTML = Object.keys(I18N).map(', '$("langSel").innerHTML = SPR6.filter(l=>I18N[l]).map(')
rep('let LANG = "de", PROD = "uws", letzteKalkulation = null;',
    'let LANG = "de", PROD = "uws", letzteKalkulation = null;\nconst SPR6 = ["de","en","sv","no","da","fi"];\nlet PARTNER = null, SLUG = null;')

# Leistungen der Marina: Pakete und Detailing filtern
rep('chips($("prodChips"), Object.keys(t.prods).map(k=>[k,t.prods[k]]), PROD,',
    'chips($("prodChips"), Object.keys(t.prods).filter(k=>k!=="det"||!PARTNER||(PARTNER.detailing&&PARTNER.detailing.aktiv)).map(k=>[k,t.prods[k]]), PROD,')
rep('chips($("pkgChips"), Object.entries(pk()).map(([k,v])=>[k,v.t]), pkg(),',
    'chips($("pkgChips"), Object.entries(pk()).filter(([k])=>PROD==="det"||!PARTNER||PARTNER.pakete[k]!==false).map(([k,v])=>[k,v.t]), pkg(),')

# Finanzierungszeile im Ergebnis
rep('  $("dauer").textContent = `${d.tageVon}–${d.tageBis}`;',
'''  zeigeFinanzierung(d);
  $("dauer").textContent = `${d.tageVon}–${d.tageBis}`;''')

# Absenden an das Backend
alt = s[s.index('  const fd = new FormData();'):s.index('  else fail(t.errSend);\n});') + len('  else fail(t.errSend);\n});')]
s = s.replace(alt, '''  $("leadBtn").disabled = true;
  const fertig = () => { $("leadBtn").disabled = false; $("leadBtn").textContent = t.fSend; };
  try {
    const medien = [];
    for (let i = 0; i < FILES.length; i++){
      $("leadBtn").textContent = (NEU[LANG]||NEU.de).up.replace("{i}", i+1).replace("{n}", FILES.length);
      medien.push(await Boatsdoc.upload(FILES[i]));
    }
    data.eigner = {name:data.name, email:data.email, plz:data.plz, telefon:data.telefon, nachricht:data.nachricht, sprache:LANG};
    data.medien = medien;
    data.probe = PROBE;
    const r = await Boatsdoc.call("POST", "/api/public/" + encodeURIComponent(SLUG) + "/anfragen", data);
    const link = Boatsdoc.url("angebot.html", {t:r.token});
    $("leadForm").style.display = "none";
    $("leadOk").style.display = "";
    $("leadOk").innerHTML = `${t.fThanks}<span class="code"><a href="${link}" target="_blank" rel="noopener">${(NEU[LANG]||NEU.de).status}</a></span>`;
    fertig();
  } catch(e){ fertig(); fail(e.message || t.errSend); }
});''')

# Init: Sprache aus 6, Partner laden
rep('''const nav = (navigator.language||"de").slice(0,2).toLowerCase();
if (I18N[nav]) LANG = nav;''', '''const nav = (navigator.language||"de").slice(0,2).toLowerCase();
if (SPR6.includes(nav) && I18N[nav]) LANG = nav;''')
rep('''render();
Promise.all([regionErkennen(), fxLaden()]).then(()=>zeigeErgebnis(pkg()));''', '''render();
ladePartner().then(ok => { if (!ok) return; render(); document.body.classList.remove("lade"); return fxLaden(); }).then(()=>{ if (PARTNER) zeigeErgebnis(pkg()); });''')

# Neue Funktionen vor dem Init-Block
rep('/* Init: Browsersprache erkennen */', r'''/* ===== Anbindung an die Marina (Boatsdoc-Backend) ===== */
const NEU = {
 de:{payLine:"50 % Anzahlung bei Annahme des Festpreisangebots. Sie wird voll erstattet, solange der Termin noch nicht vom ausführenden Betrieb bestätigt ist.",
  cPay:"Ich nehme zur Kenntnis: 50 % Anzahlung bei Annahme des Angebots, voll erstattbar, bis der ausführende Betrieb den Termin bestätigt.",
  step3:"Verbindliches Angebot mit festem Termin. Bei Annahme 50 % Anzahlung oder Finanzierung; erstattbar, bis der Termin bestätigt ist.",
  fThanks:"Vielen Dank! Wir prüfen Ihre Fotos und schicken Ihnen ein Festpreisangebot mit Termin. Den Stand Ihrer Anfrage sehen Sie jederzeit hier:",
  status:"Stand meiner Anfrage öffnen →", up:"Lade Datei {i} von {n} hoch …", fin:"oder <b>{r}</b> im Monat mit {a}", finS:"{m} Monate · eff. Jahreszins {z} % · Beispiel für den mittleren Preis", finRest:"Finanzierbar bis {m}, den Rest zahlen Sie bei Annahme.",
  by:"Rechner von Boatsdoc", gone:"Diesen Rechner gibt es nicht oder er ist gerade nicht aktiv."},
 en:{payLine:"50% deposit when you accept the fixed-price quote. Fully refunded as long as the business doing the work has not yet confirmed the date.",
  cPay:"I acknowledge: 50% deposit on accepting the quote, fully refundable until the business doing the work confirms the date.",
  step3:"Binding quote with a fixed date. On acceptance a 50% deposit or financing; refundable until the date is confirmed.",
  fThanks:"Thank you! We'll review your photos and send you a fixed-price quote with a date. You can check the status of your request here at any time:",
  status:"Open my request status →", up:"Uploading file {i} of {n} …", fin:"or <b>{r}</b> per month with {a}", finS:"{m} months · APR {z}% · example for the middle price", finRest:"Financeable up to {m}; you pay the rest on acceptance.",
  by:"Calculator by Boatsdoc", gone:"This calculator doesn't exist or isn't active right now."},
 sv:{payLine:"50 % handpenning när du accepterar fastprisofferten. Den återbetalas helt så länge det utförande företaget inte har bekräftat datumet.",
  cPay:"Jag noterar: 50 % handpenning vid accept av offerten, helt återbetalningsbar tills det utförande företaget bekräftar datumet.",
  step3:"Bindande offert med fast datum. Vid accept 50 % handpenning eller finansiering; återbetalas tills datumet är bekräftat.",
  fThanks:"Tack! Vi granskar dina bilder och skickar en fastprisoffert med datum. Status för din förfrågan ser du här:",
  status:"Öppna status för min förfrågan →", up:"Laddar upp fil {i} av {n} …", fin:"eller <b>{r}</b> per månad med {a}", finS:"{m} månader · effektiv ränta {z} % · exempel för mittpriset", finRest:"Finansierbart upp till {m}, resten betalar du vid accept.",
  by:"Kalkylator från Boatsdoc", gone:"Den här kalkylatorn finns inte eller är inte aktiv just nu."},
 no:{payLine:"50 % forskudd når du aksepterer fastpristilbudet. Det refunderes helt så lenge bedriften som utfører jobben ikke har bekreftet datoen.",
  cPay:"Jeg tar til etterretning: 50 % forskudd ved aksept av tilbudet, fullt refunderbart til bedriften som utfører jobben bekrefter datoen.",
  step3:"Bindende tilbud med fast dato. Ved aksept 50 % forskudd eller finansiering; refunderbart til datoen er bekreftet.",
  fThanks:"Takk! Vi ser på bildene og sender et fastpristilbud med dato. Status for forespørselen ser du her:",
  status:"Åpne status for forespørselen →", up:"Laster opp fil {i} av {n} …", fin:"eller <b>{r}</b> per måned med {a}", finS:"{m} måneder · effektiv rente {z} % · eksempel for midtprisen", finRest:"Kan finansieres opptil {m}, resten betaler du ved aksept.",
  by:"Kalkulator fra Boatsdoc", gone:"Denne kalkulatoren finnes ikke eller er ikke aktiv nå."},
 da:{payLine:"50 % depositum, når du accepterer fastpristilbuddet. Det refunderes fuldt, så længe den udførende virksomhed ikke har bekræftet datoen.",
  cPay:"Jeg tager til efterretning: 50 % depositum ved accept af tilbuddet, fuldt refunderbart, indtil den udførende virksomhed bekræfter datoen.",
  step3:"Bindende tilbud med fast dato. Ved accept 50 % depositum eller finansiering; refunderbart, indtil datoen er bekræftet.",
  fThanks:"Tak! Vi gennemgår dine fotos og sender et fastpristilbud med dato. Status for din forespørgsel ser du her:",
  status:"Åbn status for min forespørgsel →", up:"Uploader fil {i} af {n} …", fin:"eller <b>{r}</b> om måneden med {a}", finS:"{m} måneder · ÅOP {z} % · eksempel for midterprisen", finRest:"Kan finansieres op til {m}; resten betaler du ved accept.",
  by:"Beregner fra Boatsdoc", gone:"Denne beregner findes ikke eller er ikke aktiv lige nu."},
 fi:{payLine:"50 % ennakkomaksu, kun hyväksyt kiinteähintaisen tarjouksen. Se palautetaan kokonaan niin kauan kuin työn tekevä yritys ei ole vahvistanut ajankohtaa.",
  cPay:"Otan huomioon: 50 % ennakko tarjouksen hyväksymisen yhteydessä, palautetaan kokonaan, kunnes työn tekevä yritys vahvistaa ajankohdan.",
  step3:"Sitova tarjous kiinteällä ajankohdalla. Hyväksyttäessä 50 % ennakko tai rahoitus; palautetaan, kunnes ajankohta on vahvistettu.",
  fThanks:"Kiitos! Tarkistamme kuvasi ja lähetämme kiinteähintaisen tarjouksen ajankohtineen. Pyyntösi tilan näet täältä:",
  status:"Avaa pyyntöni tila →", up:"Ladataan tiedostoa {i}/{n} …", fin:"tai <b>{r}</b> kuukaudessa: {a}", finS:"{m} kk · todellinen vuosikorko {z} % · esimerkki keskihinnalle", finRest:"Rahoitettavissa {m} asti, loput maksat hyväksyessäsi.",
  by:"Laskuri: Boatsdoc", gone:"Tätä laskuria ei ole tai se ei ole nyt käytössä."}
};
for (const l in NEU){ const x = NEU[l], t = I18N[l]; if (!t) continue;
  t.payLine = x.payLine; t.cPay = x.cPay; t.fThanks = x.fThanks;
  if (PROC[l]) PROC[l].steps[2] = [PROC[l].steps[2][0], x.step3];
}
async function ladePartner(){
  const q = new URLSearchParams(location.search);
  SLUG = q.get("p") || window.BD_PARTNER || "marina-schleibucht";
  try { PARTNER = await Boatsdoc.call("GET", "/api/public/" + encodeURIComponent(SLUG)); }
  catch(e){ document.querySelector("main").innerHTML = `<p class="gone">${(NEU[LANG]||NEU.de).gone}</p>`; document.body.classList.remove("lade"); return false; }
  const P = PARTNER, K = Boatsdoc.core.kalkCfg(P.preise);
  CFG.ruestpauschale_eur = K.ruestpauschale_eur; CFG.spanne = K.spanne; CFG.anfahrt_eur_pro_km = K.anfahrt_eur_pro_km;
  CFG.entfernung = K.entfernung; CFG.aufbau = K.aufbau;
  const f = (K.det_h || 100) / 100;
  for (const st of Object.values(CFG.detailing.schritte)) { st.eur_h_basis = st.eur_h_basis || st.eur_h; st.eur_h = Math.round(st.eur_h_basis * f); }
  CFG.detailing.mindestauftrag_eur = K.det_min || CFG.detailing.mindestauftrag_eur;
  /* MwSt. und Währung nach dem Ort der Arbeit (Land der Marina), nicht nach der Sprache des Eigners */
  for (const l in CFG.sprache_land) CFG.sprache_land[l] = P.land;
  REGION = {land:P.land, quelle:"marina"};
  CFG.kalender.vorlauf_tage = (P.kalender && P.kalender.vorlauf_tage) || 14;
  CFG.kalender.gesperrt = (P.kalender && P.kalender.gesperrt) || [];
  if (P.pakete && P.pakete[SEL.uws] === false) SEL.uws = ["af","full","strip"].find(k => P.pakete[k] !== false) || "af";
  if (!(P.detailing && P.detailing.aktiv)) PROD = "uws";
  if (!q.get("lang") && !localStorageLang() && SPR6.includes(P.sprache)) LANG = P.sprache;
  if (q.get("lang") && SPR6.includes(q.get("lang"))) LANG = q.get("lang");
  document.getElementById("pName").textContent = P.name;
  if (P.logo) { const im = document.createElement("img"); im.src = P.logo; im.alt = ""; const lg = document.getElementById("pLogo"); lg.querySelector("i").replaceWith(im); }
  PROBE = q.get("probe") === "1";
  zeigeProbe();
  document.title = P.name + " · Antifouling";
  const r = document.documentElement.style;
  r.setProperty("--acc", P.farbe); r.setProperty("--acc2", `color-mix(in srgb, ${P.farbe} 80%, #fff)`); r.setProperty("--accsoft", `color-mix(in srgb, ${P.farbe} 50%, #fff)`);
  /* White-Label: Hintergrundfarbe und Schrift des Partners */
  const D = P.design || {};
  if (/^#[0-9a-fA-F]{6}$/.test(D.bg || "")) {
    const m = (p, w) => `color-mix(in srgb, ${D.bg} ${p}%, ${w})`;
    r.setProperty("--bg", D.bg); r.setProperty("--bg2", m(92, "#fff")); r.setProperty("--panel", m(86, "#fff")); r.setProperty("--panel2", m(80, "#fff"));
    r.setProperty("--line", m(70, "#fff")); r.setProperty("--line2", m(62, "#fff"));
    const top = document.querySelector(".top"); if (top) top.style.background = `color-mix(in srgb, ${D.bg} 92%, transparent)`;
  }
  if (D.akzent2 && /^#[0-9a-fA-F]{6}$/.test(D.akzent2)) r.setProperty("--ok", D.akzent2);
  const SCHRIFTEN = ["Catamaran","Playfair Display","Source Sans 3","Open Sans","Lato","Montserrat","Roboto","Nunito Sans","Raleway","Work Sans"];
  if (SCHRIFTEN.includes(D.schrift)) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(D.schrift) + ":wght@400;600;700;800&display=swap"; document.head.appendChild(l);
    r.setProperty("--sans", `"${D.schrift}", system-ui, sans-serif`);
  }
  /* Impressum des Betreibers dieses Rechners */
  if (P.impressum && P.impressum.firma) {
    const f = document.querySelector("footer"); const a = document.createElement("a");
    a.href = "impressum.html?p=" + encodeURIComponent(P.slug); a.className = "by"; a.style.color = "inherit";
    a.textContent = ({de:"Impressum",en:"Legal notice",sv:"Företagsuppgifter",no:"Firmaopplysninger",da:"Virksomhedsoplysninger",fi:"Yritystiedot"})[LANG] || "Impressum";
    f.appendChild(a);
  }
  return true;
}
let PROBE = false;
const PROBE_TXT = {
 de:{t:"Probe",a:"Sie testen Ihren Rechner als Eigner. Die Anfrage landet als Probe-Anfrage in Ihrem Backend, es geht keine E-Mail raus.",b:"Vorschau: Dieser Rechner ist noch im Probebetrieb. Anfragen werden erst nach der Freischaltung bearbeitet."},
 en:{t:"Trial",a:"You are testing your calculator as an owner. The request arrives in your back office as a trial request; no email is sent.",b:"Preview: this calculator is still in trial mode. Requests are only processed once it goes live."},
 sv:{t:"Prov",a:"Du testar din kalkylator som båtägare. Förfrågan hamnar som provförfrågan i ditt backoffice, inget e-postmeddelande skickas.",b:"Förhandsvisning: kalkylatorn är fortfarande i provläge. Förfrågningar behandlas först när den är live."},
 no:{t:"Prøve",a:"Du tester kalkulatoren din som båteier. Forespørselen havner som prøveforespørsel i backoffice, ingen e-post sendes.",b:"Forhåndsvisning: kalkulatoren er fortsatt i prøvemodus. Forespørsler behandles først når den er live."},
 da:{t:"Prøve",a:"Du tester din beregner som bådejer. Forespørgslen lander som prøveforespørgsel i dit backoffice, der sendes ingen e-mail.",b:"Forhåndsvisning: beregneren er stadig i prøvetilstand. Forespørgsler behandles først, når den er live."},
 fi:{t:"Koe",a:"Testaat laskuriasi veneilijänä. Pyyntö tulee hallintapaneeliisi koepyyntönä, sähköpostia ei lähetetä.",b:"Esikatselu: laskuri on vielä kokeilutilassa. Pyyntöjä käsitellään vasta käyttöönoton jälkeen."}};
function zeigeProbe(){
  const el = document.getElementById("probeBan"), x = PROBE_TXT[LANG] || PROBE_TXT.de;
  if (!PARTNER || (!PROBE && PARTNER.modus === "live")) { el.hidden = true; return; }
  el.innerHTML = `<b>${x.t}</b>${PROBE ? x.a : x.b}`; el.hidden = false;
}
function localStorageLang(){ try { return localStorage.getItem("bd_k_lang"); } catch(_){ return null; } }
$("langSel").addEventListener("change", e => { try { localStorage.setItem("bd_k_lang", e.target.value); } catch(_){} zeigeProbe(); });
function zeigeFinanzierung(d){
  const el = $("finLine"), x = NEU[LANG] || NEU.de;
  $("pBy").textContent = x.by;
  if (!PARTNER || d.mwst_satz === null) { el.hidden = true; return; }
  const brutto = (d.von + d.bis) / 2, f = Boatsdoc.core.finanzierung(PARTNER, d.land, brutto);
  if (!f) { el.hidden = true; return; }
  const r = Math.round(f.monatsrate * kurs());
  el.innerHTML = x.fin.replace("{r}", money(r)).replace("{a}", f.anbieter)
    + `<small>${x.finS.replace("{m}", f.laufzeit).replace("{z}", f.zins.toLocaleString(T().locale))}${f.rest > 0 ? " · " + x.finRest.replace("{m}", money(conv(f.finanzierbar))) : ""}</small>`;
  el.hidden = false;
  if (letzteKalkulation) letzteKalkulation.finanzierung_beispiel = f;
}

/* Init: Browsersprache erkennen */''')
open(dst, "w", encoding="utf8").write(s)
print("ok", len(s))
