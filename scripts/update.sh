#!/usr/bin/env bash
# Update the accounting app on the Raspberry Pi.
# Safe to run again. On failure, restores the commit from before this pull,
# rebuilds that commit, and restarts only the accounting PM2 processes if the rebuild works.
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

BACKEND_NAME="${PM2_BACKEND_NAME:-accounting-backend}"
FRONTEND_NAME="${PM2_FRONTEND_NAME:-accounting-frontend}"

if ! git diff --quiet || ! git diff --cached --quiet; then
	die "Tracked files have local changes. Commit or stash them before updating. Untracked files such as .env and data/ are left alone."
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT/backups/pre-update-$STAMP"
LOG_DIR="$ROOT/logs"
LOG_FILE="$LOG_DIR/update-$STAMP.log"
mkdir -p "$BACKUP_DIR" "$LOG_DIR"

# Record the commit before any fetch or pull, and keep it on disk so rollback
# cannot accidentally target the commit we just pulled.
PRE_UPDATE_COMMIT="$(git rev-parse HEAD)"
printf '%s\n' "$PRE_UPDATE_COMMIT" > "$BACKUP_DIR/pre-update-commit"

exec > >(tee -a "$LOG_FILE") 2>&1

summarize_failure() {
	printf "${RED}Error summary (a11y warnings omitted). Full log: %s${NC}\n" "$LOG_FILE"
	if [[ ! -f "$LOG_FILE" ]]; then
		return
	fi
	grep -E 'error during build|Could not load|An impossible|ELIFECYCLE|npm error|Build failed|✗|fatal:|error:' "$LOG_FILE" \
		| grep -v -E 'a11y_|slot_element_deprecated|state_referenced_locally' \
		| tail -n 40 \
		|| true
	printf "${YELLOW}Full log: %s${NC}\n" "$LOG_FILE"
}

restart_accounting() {
	if ! command -v pm2 >/dev/null 2>&1; then
		warn "pm2 is not installed; not restarting anything"
		return 1
	fi
	# Re-read ecosystem.config.cjs. A plain `pm2 restart --update-env` keeps the
	# ORIGIN and BODY_SIZE_LIMIT PM2 stored on the previous start, so attachment
	# uploads stay broken. This file only defines the accounting processes.
	pm2 startOrReload ecosystem.config.cjs --update-env
}

rollback() {
	trap - ERR
	set +e
	warn "Update failed. Returning to $PRE_UPDATE_COMMIT (the commit before this pull)."
	git reset --hard "$PRE_UPDATE_COMMIT"
	if [[ -f "$BACKUP_DIR/accounting.db" ]]; then
		mkdir -p "$ROOT/data"
		cp -a "$BACKUP_DIR/accounting.db" "${DATABASE_PATH:-$ROOT/data/accounting.db}"
		warn "Restored the database from $BACKUP_DIR/accounting.db"
	fi
	if [[ -d "$BACKUP_DIR/attachments" ]]; then
		rm -rf "${ATTACHMENTS_PATH:-$ROOT/data/attachments}"
		mkdir -p "$(dirname "${ATTACHMENTS_PATH:-$ROOT/data/attachments}")"
		cp -a "$BACKUP_DIR/attachments" "${ATTACHMENTS_PATH:-$ROOT/data/attachments}"
	fi
	if [[ -f package-lock.json ]]; then
		npm ci || warn "npm ci during rollback failed"
	fi
	if npm run build; then
		warn "Previous commit rebuilt. Restarting only $BACKEND_NAME and $FRONTEND_NAME."
		restart_accounting || true
	else
		warn "Rebuild of $PRE_UPDATE_COMMIT failed. PM2 was not restarted, so other apps and the previous accounting processes were left running."
	fi
	summarize_failure
	exit 1
}
trap rollback ERR

set -e
info "Log: $LOG_FILE"
info "Commit before update: $PRE_UPDATE_COMMIT"
info "Backing up database and attachments to $BACKUP_DIR"
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
NEW_COMMIT="$(git rev-parse HEAD)"
if [[ "$NEW_COMMIT" == "$PRE_UPDATE_COMMIT" ]]; then
	info "Already at $NEW_COMMIT. No new commits; rebuilding the current checkout."
else
	info "Moved $PRE_UPDATE_COMMIT -> $NEW_COMMIT"
fi

info "Installing dependencies"
if [[ ! -f package-lock.json ]]; then
	die "package-lock.json is missing. npm ci needs it."
fi
npm ci

info "Building (Vite builds the browser bundle and the server bundle; both must succeed)"
npm run build

info "Applying database migrations"
NODE_ENV=production npx tsx scripts/apply-migrations.ts

info "Restarting only $BACKEND_NAME and $FRONTEND_NAME"
if ! command -v pm2 >/dev/null 2>&1; then
	die "pm2 is not installed"
fi
restart_accounting

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
info "Update complete at $(git rev-parse --short HEAD)."
info "Backup: $BACKUP_DIR"
info "Full log: $LOG_FILE"
