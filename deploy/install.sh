#!/usr/bin/env bash
# Boatsdoc — Ersteinrichtung eines frischen Ubuntu-24.04-Servers mit einem einzigen Befehl (als root):
#   curl -fsSL https://raw.githubusercontent.com/houdini2013/boat-doc/main/deploy/install.sh | BRANCH=main bash
# Danach holt sich der Server neue Stände selbst von GitHub (alle 2 Minuten), es braucht keine Schlüssel.
set -euo pipefail
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-boatsdoc.com}"
REPO_URL="https://github.com/houdini2013/boat-doc"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git rsync curl
if [ ! -d /srv/boatsdoc/repo/.git ]; then
  mkdir -p /srv/boatsdoc
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" /srv/boatsdoc/repo
fi
BRANCH="$BRANCH" DOMAIN="$DOMAIN" bash /srv/boatsdoc/repo/deploy/setup.sh
