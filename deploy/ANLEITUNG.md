# Boatsdoc auf eigenen Server bringen (IONOS VPS)

Ziel: Alles läuft unter **boatsdoc.com**: Website, Demo, „Jetzt testen“, Rechner, Backend und Sales-Cockpit.
Betreiber bleibt die ISC Industrie-Service-Czech GmbH.

## So funktioniert das Ausrollen

Der Server holt sich neue Stände **selbst** von GitHub (alle 2 Minuten, `deploy/update.sh`).
Es braucht keine Schlüssel und keine Geheimnisse in GitHub, weil das Repo öffentlich ist.
Geheimes (Datenbank, Uploads, `/etc/boatsdoc.env`) liegt nur auf dem Server.

- Zum Testen verfolgt der Server einen Zweig (z. B. `plattform-selbstbedienung`).
- Sobald dieser Zweig in `main` übernommen ist, wechselt der Server von selbst auf `main`.
- Ab dann geht jeder Stand auf `main` innerhalb von 2 Minuten live.

## Einmalige Einrichtung

1. IONOS Cloud Panel → Server → **Remotekonsole (KVM)** öffnen, mit `root` und dem Passwort aus dem Cloud Panel anmelden.
2. Diesen einen Befehl eintippen und ausführen (dauert ca. 3–5 Minuten):

```
curl -fsSL https://raw.githubusercontent.com/houdini2013/boat-doc/plattform-selbstbedienung/deploy/install.sh | BRANCH=plattform-selbstbedienung bash
```

3. Am Ende steht „FERTIG. Boatsdoc läuft“.
4. DNS bei IONOS: A-Record `neu` → IP des Servers. Dann unter https://neu.boatsdoc.com testen.
5. Erst nach Freigabe: Pull Request in `main` übernehmen und A-Records `@` und `www` → IP des Servers.
   GitHub Pages wird danach nicht mehr gebraucht.

## Was der Server bekommt

- Node.js 22 (keine weiteren Pakete), Dienst `boatsdoc` als eigener Benutzer ohne Login
- Caddy für HTTPS (Zertifikate automatisch), `www` leitet auf die Hauptdomain um
- Firewall: nur SSH, 80, 443; automatische Sicherheitsupdates
- Daten: `/srv/boatsdoc/data` (Datenbank + Uploads), wird beim Ausrollen nie überschrieben
- Backup jede Nacht 3:15 nach `/srv/boatsdoc/backup`, 14 Tage aufbewahrt

## Einstellungen auf dem Server

Datei `/etc/boatsdoc.env` (liegt nicht im Repo):

```
BASE_URL=https://boatsdoc.com
COOKIE_SECURE=1
SEED_DEMO=0          # keine Demo-Marinas im Livebetrieb; die Beispiel-Marina gibt es immer
SALES_EMAIL=         # hier landet „neuer Probezugang“, z. B. sales@boatsdoc.com
ADMIN_EMAILS=        # Konten mit Sales-Cockpit, kommagetrennt (Konto vorher normal über „Jetzt testen“ anlegen und sichern)
BRANCH=main          # welcher Zweig ausgerollt wird
PROBE_PRO_MINUTE=5   # optional: Schutz vor massenhaften Testzugängen
```

Nach Änderungen: `systemctl restart boatsdoc`. Sofort ausrollen: `boatsdoc-update --force`.
Protokoll: `journalctl -u boatsdoc -u boatsdoc-update -n 100`.

## Noch offen (Phase 3)

- Mailversand über IONOS SMTP, Port 587 (Port 25 ist bei IONOS gesperrt); bis dahin stehen Mails im Postausgang der Datenbank und im Log
- Zahlungen: Stripe Connect + Klarna für die ISC
- AGB, AVV und Datenschutz anwaltlich prüfen (die Entwürfe sind als solche gekennzeichnet)
- Externes Backup (z. B. IONOS S3 Object Storage)
- SSH nur noch mit Schlüssel (Passwort-Login abschalten)
