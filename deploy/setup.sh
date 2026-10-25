#!/usr/bin/env bash
# Boatsdoc — einmalige Einrichtung eines frischen Ubuntu-24.04-Servers (IONOS VPS).
# Läuft als root, aufgerufen vom GitHub-Workflow „Server einrichten“ (oder von Hand im Repo-Ordner).
# Wiederholbar: bestehende Daten und /etc/boatsdoc.env bleiben erhalten.
set -euo pipefail

DOMAIN="${DOMAIN:-boatsdoc.com}"
APP=/srv/boatsdoc/app
cd "$(dirname "$0")/.."

echo "== Pakete =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg ufw unattended-upgrades rsync debian-keyring debian-archive-keyring apt-transport-https

echo "== Node.js 22 (eingebautes SQLite) =="
if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -e 'require("node:sqlite"); console.log("Node", process.version, "mit SQLite")'

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
chown -R boatsdoc:boatsdoc /srv/boatsdoc

echo "== Einstellungen (/etc/boatsdoc.env) =="
if [ ! -f /etc/boatsdoc.env ]; then
  cat > /etc/boatsdoc.env <<EOF
PORT=8080
DATA_DIR=/srv/boatsdoc/data
PUBLIC_DIR=$APP
BASE_URL=https://$DOMAIN
COOKIE_SECURE=1
SEED_DEMO=0
SALES_EMAIL=
EOF
  chmod 640 /etc/boatsdoc.env; chgrp boatsdoc /etc/boatsdoc.env
fi

echo "== Dienste =="
install -m 644 deploy/boatsdoc.service /etc/systemd/system/boatsdoc.service
install -m 644 deploy/boatsdoc-backup.service /etc/systemd/system/boatsdoc-backup.service
install -m 644 deploy/boatsdoc-backup.timer /etc/systemd/system/boatsdoc-backup.timer
install -m 755 deploy/backup.sh /usr/local/bin/boatsdoc-backup
sed "s/{{DOMAIN}}/$DOMAIN/g" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now boatsdoc.service boatsdoc-backup.timer
systemctl restart boatsdoc.service
systemctl enable caddy
systemctl restart caddy

echo "== Firewall und Updates =="
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable
echo 'Unattended-Upgrade::Automatic-Reboot "false";' > /etc/apt/apt.conf.d/52boatsdoc
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== SSH: nur noch Schlüssel, wenn einer hinterlegt ist =="
if [ -s /root/.ssh/authorized_keys ]; then
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl reload ssh || systemctl reload sshd || true
fi

sleep 2
curl -fsS http://127.0.0.1:8080/api/ping && echo
echo "Fertig. Seite erreichbar unter https://$DOMAIN, sobald die Domain auf diesen Server zeigt."
