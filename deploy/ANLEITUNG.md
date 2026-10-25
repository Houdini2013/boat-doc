# Boatsdoc auf eigenen Server bringen (IONOS VPS)

Ziel: Alles läuft unter **boatsdoc.com**: Website, Demo, „Jetzt testen“, Rechner, Backend und Sales-Cockpit.
Betreiber bleibt die ISC Industrie-Service-Czech GmbH.

## Wer macht was

| Schritt | Wer |
|---|---|
| 1. Claude GitHub App installieren, **nur für houdini2013/boat-doc** | Alexander |
| 2. Bei IONOS einloggen | Alexander (Passwort sieht Claude nie) |
| 3. VPS konfigurieren: VPS S oder M, Ubuntu 24.04, Standort Deutschland, SSH-Schlüssel eintragen | Claude im Browser |
| 4. „Zahlungspflichtig bestellen“ klicken | Alexander |
| 5. Secrets in GitHub eintragen: `VPS_HOST` (IP des Servers), `VPS_SSH_KEY` (privater Schlüssel) | Claude im Browser |
| 6. Actions → „Server einrichten“ → Run workflow | Claude |
| 7. Testen unter neu.boatsdoc.com (DNS-Eintrag `neu` → Server-IP) | Claude, Freigabe Alexander |
| 8. Hauptdomain umstellen: A-Records `@` und `www` → Server-IP | nur nach Bestätigung durch Alexander |

Danach rollt **jeder Push auf `main`** automatisch aus (Workflow „Auf Server ausrollen“).
Solange `VPS_HOST` fehlt, überspringt der Workflow das Ausrollen; GitHub Pages läuft bis zur Umstellung unverändert weiter.

## Was der Server bekommt

- Node.js 22 (keine weiteren Pakete), Dienst `boatsdoc` als eigener Benutzer ohne Login
- Caddy für HTTPS (Zertifikate automatisch), `www` leitet auf die Hauptdomain um
- Firewall: nur SSH, 80, 443; automatische Sicherheitsupdates; SSH nur mit Schlüssel
- Daten: `/srv/boatsdoc/data` (Datenbank + Uploads), wird beim Ausrollen nie überschrieben
- Backup jede Nacht 3:15 nach `/srv/boatsdoc/backup`, 14 Tage aufbewahrt

## Einstellungen auf dem Server

Datei `/etc/boatsdoc.env` (liegt nicht im Repo, wird beim ersten Einrichten angelegt):

```
BASE_URL=https://boatsdoc.com
COOKIE_SECURE=1
SEED_DEMO=0          # keine Demo-Marinas im Livebetrieb; die Beispiel-Marina gibt es immer
SALES_EMAIL=         # hier landet „neuer Probezugang“, z. B. sales@boatsdoc.com
PROBE_PRO_MINUTE=5   # optional: Schutz vor massenhaften Testzugängen
```

Nach Änderungen: `systemctl restart boatsdoc`.

## Noch offen (Phase 3)

- Mailversand über IONOS SMTP (noreply@boatsdoc.com); bis dahin stehen Mails im Postausgang der Datenbank und im Log
- Zahlungen: Stripe Connect + Klarna für die ISC
- AGB, AVV und Datenschutz anwaltlich prüfen (die Entwürfe sind als solche gekennzeichnet)
- Externes Backup (z. B. IONOS S3 Object Storage)
