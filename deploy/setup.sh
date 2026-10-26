#!/usr/bin/env bash
# Boatsdoc — Einrichtung eines Ubuntu-24.04-Servers (IONOS VPS). Läuft als root, aufgerufen von install.sh.
# Wiederholbar: bestehende Daten und /etc/boatsdoc.env bleiben erhalten.
set -euo pipefail

DOMAIN="${DOMAIN:-boatsdoc.com}"
BRANCH="${BRANCH:-main}"
REPO=/srv/boatsdoc/repo
cd "$REPO"

echo "== Pakete =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg ufw unattended-upgrades rsync git debian-keyring debian-archive-keyring apt-transport-https

echo "== Node.js 22 (eingebautes SQLite) =="
if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --disable-warning=ExperimentalWarning -e 'require("node:sqlite"); console.log("Node", process.version, "mit SQLite")'

echo "== Caddy (HTTPS) =="
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== Benutzer und Ordner =="
id boatsdoc >/dev/null 2>&1 || useradd --system --home-dir /srv/boatsdoc --shell /usr/sbin/nologin boatsdoc
mkdir -p /srv/boatsdoc/{app,data,backup}
chown -R boatsdoc:boatsdoc /srv/boatsdoc/app /srv/boatsdoc/data /srv/boatsdoc/backup

echo "== Einstellungen (/etc/boatsdoc.env) =="
if [ ! -f /etc/boatsdoc.env ]; then
  cat > /etc/boatsdoc.env <<EOF
PORT=8080
DATA_DIR=/srv/boatsdoc/data
PUBLIC_DIR=/srv/boatsdoc/app
BASE_URL=https://$DOMAIN
COOKIE_SECURE=1
SEED_DEMO=0
SALES_EMAIL=
BRANCH=$BRANCH
EOF
  chmod 640 /etc/boatsdoc.env; chgrp boatsdoc /etc/boatsdoc.env
fi

echo "== Dienste =="
install -m 644 deploy/boatsdoc.service /etc/systemd/system/boatsdoc.service
install -m 644 deploy/boatsdoc-backup.service /etc/systemd/system/boatsdoc-backup.service
install -m 644 deploy/boatsdoc-backup.timer /etc/systemd/system/boatsdoc-backup.timer
install -m 644 deploy/boatsdoc-update.service /etc/systemd/system/boatsdoc-update.service
install -m 644 deploy/boatsdoc-update.timer /etc/systemd/system/boatsdoc-update.timer
install -m 755 deploy/backup.sh /usr/local/bin/boatsdoc-backup
install -m 755 deploy/update.sh /usr/local/bin/boatsdoc-update
sed "s/{{DOMAIN}}/$DOMAIN/g" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable boatsdoc.service
/usr/local/bin/boatsdoc-update --force
systemctl enable --now boatsdoc-backup.timer boatsdoc-update.timer
systemctl enable caddy
systemctl restart caddy

echo "== Firewall und Updates =="
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable
echo 'Unattended-Upgrade::Automatic-Reboot "false";' > /etc/apt/apt.conf.d/52boatsdoc
dpkg-reconfigure -f noninteractive unattended-upgrades

echo
echo "FERTIG. Boatsdoc läuft ($(cat /srv/boatsdoc/ausgerollt))."
echo "Erreichbar unter https://$DOMAIN bzw. https://neu.$DOMAIN, sobald die Domain auf diesen Server zeigt."
