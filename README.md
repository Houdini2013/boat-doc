# boat-doc

Boatsdoc: eine Seite, ein Geschäftsmodell, zwei Einstiege (Marina vermittelt, Werkstatt mit Laser).
Betreiber: ISC Industrie-Service-Czech GmbH.

## Inhalt

| Datei | Zweck |
|---|---|
| `index.html` | Startseite mit Ablauf, Videos, „Jetzt testen“, Detailing, Finanzierung, FAQ |
| `kalkulator.html` | Eigner-Rechner mit Preisen, Logo, MwSt. und Währung der jeweiligen Marina (`?p=<slug>`) |
| `partner.html` | Backend: Startassistent, Anfragen, Angebote, Preise, Teilen, Konto, Sales-Cockpit |
| `angebot.html` | Angebotsseite für den Eigner (Annahme, Anzahlung, Klarna) |
| `core.js` | Gemeinsame Logik für Server und Browser-Demo |
| `store.js` | Erkennt Server (`/api/ping`) oder läuft als Demo im Browser |
| `server/server.cjs` | Node-22-Server (SQLite eingebaut, keine Pakete) |
| `deploy/` | IONOS VPS: Einrichtung mit einem Befehl, Selbst-Aktualisierung von GitHub, Caddy, Backup, siehe `deploy/ANLEITUNG.md` |
| `.github/workflows/` | „Prüfen“: Server startet und liefert aus (bei jedem Push) |
| `tools/` | Tests und Video-Aufnahme, `patch_kalkulator.py` erzeugt den Rechner aus `src/` |

## Lokal starten

```
node server/server.cjs          # http://localhost:8080, mit Demo-Daten
```

Ohne Server (Doppelklick oder GitHub Pages) läuft alles als Demo im Browser.

Demo-Zugang: `demo@marina-schleibucht.de` / `demo1234`

## Tests

```
NODE_PATH=$(npm root -g) node tools/selbstbedienung.cjs out   # Server auf :8099 (PROBE_PRO_MINUTE=100)
NODE_PATH=$(npm root -g) node tools/e2e.cjs out media          # Server auf :8099
NODE_PATH=$(npm root -g) node tools/parity.cjs                 # statisch auf :8100
NODE_PATH=$(npm root -g) node tools/demo_check.cjs out .       # statisch auf :8100
```
