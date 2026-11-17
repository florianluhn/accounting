#!/usr/bin/env bash
# Update the accounting app on the Raspberry Pi.
# Safe to run again. On failure, restores the previous git commit and the backup.
set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { printf "${GREEN}%s${NC}\n" "$*"; }
warn() { printf "${YELLOW}%s${NC}\n" "$*"; }
die() { printf "${RED}%s${NC}\n" "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if ! git diff --quiet || ! git diff --cached --quiet; then
	die "Tracked files have local changes. Commit or stash them before updating. Untracked files such as .env and data/ are left alone."
fi

PREVIOUS="$(git rev-parse HEAD)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT/backups/pre-update-$STAMP"
mkdir -p "$BACKUP_DIR"

rollback() {
	warn "Update failed. Restoring $PREVIOUS and the backup from $BACKUP_DIR"
	git reset --hard "$PREVIOUS" || true
	if [[ -f "$BACKUP_DIR/accounting.db" ]]; then
		mkdir -p "$ROOT/data"
		cp -a "$BACKUP_DIR/accounting.db" "${DATABASE_PATH:-$ROOT/data/accounting.db}"
	fi
	if [[ -d "$BACKUP_DIR/attachments" ]]; then
		rm -rf "${ATTACHMENTS_PATH:-$ROOT/data/attachments}"
		cp -a "$BACKUP_DIR/attachments" "${ATTACHMENTS_PATH:-$ROOT/data/attachments}"
	fi
	if [[ -f package-lock.json ]]; then
		npm ci || true
	fi
	npm run build || true
	if command -v pm2 >/dev/null 2>&1; then
		pm2 restart ecosystem.config.cjs || true
	fi
	die "Rolled back to $PREVIOUS"
}
trap rollback ERR

set -e
info "Backing up database and attachments"
DB_PATH="${DATABASE_PATH:-$ROOT/data/accounting.db}"
ATT_PATH="${ATTACHMENTS_PATH:-$ROOT/data/attachments}"
if [[ -f "$DB_PATH" ]]; then
	cp -a "$DB_PATH" "$BACKUP_DIR/accounting.db"
else
	warn "No database at $DB_PATH yet"
fi
if [[ -d "$ATT_PATH" ]]; then
	cp -a "$ATT_PATH" "$BACKUP_DIR/attachments"
fi

info "Updating main"
git fetch origin main
git checkout main
git pull --ff-only origin main

info "Installing dependencies"
if [[ ! -f package-lock.json ]]; then
	die "package-lock.json is missing. npm ci needs it."
fi
npm ci

info "Building"
npm run build

info "Applying database migrations"
NODE_ENV=production npx tsx scripts/apply-migrations.ts

info "Restarting PM2"
if ! command -v pm2 >/dev/null 2>&1; then
	die "pm2 is not installed"
fi
if pm2 describe "${PM2_BACKEND_NAME:-accounting-backend}" >/dev/null 2>&1; then
	pm2 restart ecosystem.config.cjs --update-env
else
	pm2 start ecosystem.config.cjs
	pm2 save
fi

info "Waiting for the API"
PORT="${BACKEND_PORT:-3000}"
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
	if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
		ok=1
		break
	fi
	sleep 1
done
if [[ "$ok" != 1 ]]; then
	die "Health check failed on http://127.0.0.1:${PORT}/api/health"
fi

trap - ERR
info "Update complete at $(git rev-parse --short HEAD). Backup kept in $BACKUP_DIR"
