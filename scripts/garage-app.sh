#!/usr/bin/env bash
# MAUNG — siapkan bucket + kunci S3 untuk satu aplikasi di Garage bersama (idempoten, tanpa mencetak rahasia).
#   bash scripts/garage-app.sh <app> [--quota 10GiB] [--bucket nama] [--key nama] [--env-file /jalur/.env-aplikasi] </dev/null
# Bucket bawaan <app>-photos, kunci bawaan <app>-key (izin baca/tulis HANYA pada bucket itu). Kunci ditulis ke --env-file
# (S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET/S3_ENDPOINT/S3_REGION) HANYA bila isian itu belum ada/kosong; tidak pernah menimpa.
set -uo pipefail
APP="${1:-}"; shift || true
QUOTA=""; BUCKET=""; KEYNAME=""; ENVF=""
while [ $# -gt 0 ]; do case "$1" in --quota) QUOTA="${2:-}"; shift 2;; --bucket) BUCKET="${2:-}"; shift 2;; --key) KEYNAME="${2:-}"; shift 2;; --env-file) ENVF="${2:-}"; shift 2;; *) echo "argumen tidak dikenal: $1"; exit 2;; esac; done
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
LOG_DIR="$HOME/maung-wo-logs"; TS="$(date +%Y%m%d-%H%M%S)"; LOG="$LOG_DIR/garage-app-${APP:-x}-$TS.log"
GC=maung-garage; N=5
STATUS=FAIL; REASON="-"; V_BUCKET=n/a; V_KEY=n/a; V_ALLOW=n/a; V_QUOTA="-"; V_ENV="-"
banner() { printf '\n==================================================================\n  %s\n==================================================================\n' "$1"; }
phase()  { printf '\n[%s/%s] %s\n' "$1" "$N" "$2"; }
ok()     { printf '  ✓ %s\n' "$*"; }
warn()   { printf '  ! %s\n' "$*"; }
bad()    { printf '  ✗ %s\n' "$*"; }
G() { docker exec "$GC" /garage "$@"; }
# Jalankan perintah, tampung keluarannya PENUH, lalu cari pola — tanpa pipa. (Pipa `cmd | grep -q` di bawah `set -o pipefail`
# gagal bila grep berhenti lebih awal dan `cmd` menerima SIGPIPE, walau polanya ketemu.)
out_has()  { local p="$1" o; shift; o="$("$@" 2>/dev/null)"; grep -q  -- "$p" <<<"$o"; }
out_hasw() { local p="$1" o; shift; o="$("$@" 2>/dev/null)"; grep -qw -- "$p" <<<"$o"; }
out_hasi() { local p="$1" o; shift; o="$("$@" 2>/dev/null)"; grep -qi -- "$p" <<<"$o"; }
result() { banner "RESULT"; cat <<EOF
status=$STATUS
reason=$REASON
app=${APP:--}
bucket=${BUCKET:--}
bucket_status=$V_BUCKET
key=${KEYNAME:--}
key_status=$V_KEY
izin_bucket_saja=$V_ALLOW
kuota=$V_QUOTA
env_file=$V_ENV
endpoint_s3=http://maung-garage:3900 (region garage, path-style)
log_file=$LOG
EOF
sleep 1; }
abort() { STATUS=ABORT; REASON="$1"; bad "$1"; result; exit 2; }
die() { REASON="$1"; bad "$1"; result; exit 1; }
getv() { grep -m1 "^$1=" "$ENVF" 2>/dev/null | cut -d= -f2- | tr -d "'\"" || true; }
setv() { # setv KEY VALUE → hanya bila kosong/tidak ada
  local cur; cur="$(getv "$1")"
  if [ -n "$cur" ]; then return 1; fi
  if grep -q "^$1=" "$ENVF"; then sed -i "s|^$1=.*|$1=$2|" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi; return 0; }

banner "MAUNG — bucket & kunci Garage untuk aplikasi '${APP:-?}'  ($TS)"
phase 1 "Guard"
[[ "$APP" =~ ^[a-z][a-z0-9-]{1,23}$ ]] || abort "nama aplikasi tidak valid (huruf kecil/angka/strip, 2–24): '$APP'"
[ "$(hostname)" = "$EXPECT_HOST" ] || abort "host '$(hostname)' ≠ '$EXPECT_HOST'"
[ "$(id -u)" != 0 ] || abort "jangan jalankan sebagai root/sudo"
docker info >/dev/null 2>&1 || abort "tidak bisa mengakses Docker"
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"; exec > >(tee -a "$LOG") 2>&1
[ "$(docker inspect -f '{{.State.Running}}' "$GC" 2>/dev/null)" = true ] || abort "Garage bersama ($GC) tidak berjalan — jalankan scripts/garage-platform.sh dulu"
BUCKET="${BUCKET:-$APP-photos}"; KEYNAME="${KEYNAME:-$APP-key}"
[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]{2,62}$ ]] || abort "nama bucket tidak valid: $BUCKET"
[[ "$KEYNAME" =~ ^[a-z0-9][a-z0-9-]{1,40}$ ]] || abort "nama kunci tidak valid: $KEYNAME"
if [ -n "$QUOTA" ]; then [[ "$QUOTA" =~ ^[0-9]+(\.[0-9]+)?(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)$ ]] || abort "format kuota tidak valid (contoh 10GiB): $QUOTA"; fi
if [ -n "$ENVF" ]; then [ -f "$ENVF" ] && [ -w "$ENVF" ] || abort "--env-file tidak ada/tidak bisa ditulis: $ENVF"; case "$(basename "$ENVF")" in .env|*.env) ;; *) abort "--env-file harus berkas .env";; esac; fi
ok "aplikasi $APP → bucket $BUCKET, kunci $KEYNAME${QUOTA:+, kuota $QUOTA}"

phase 2 "Bucket"
if out_hasw "$BUCKET" G bucket list; then V_BUCKET="sudah-ada"; ok "bucket $BUCKET sudah ada"; else G bucket create "$BUCKET" >/dev/null 2>&1 && { V_BUCKET="dibuat"; ok "bucket $BUCKET dibuat"; } || die "gagal membuat bucket $BUCKET"; fi

phase 3 "Kunci (rahasia tidak dicetak)"
AK=""; SK=""
if out_hasw "$KEYNAME" G key list; then
  V_KEY="sudah-ada"; ok "kunci $KEYNAME sudah ada"
  if [ -n "$ENVF" ] && [ -z "$(getv S3_SECRET_KEY)" ]; then OUT="$(G key info "$KEYNAME" --show-secret 2>/dev/null)"; fi
else
  OUT="$(G key create "$KEYNAME" 2>/dev/null)" || die "gagal membuat kunci $KEYNAME"; V_KEY="dibuat"; ok "kunci $KEYNAME dibuat"
fi
if [ -n "${OUT:-}" ]; then AK="$(printf '%s\n' "$OUT" | awk -F': *' '/Key ID/{print $2; exit}')"; SK="$(printf '%s\n' "$OUT" | awk -F': *' '/Secret key/{print $2; exit}')"; fi
OUT=""
G bucket allow --read --write --owner "$BUCKET" --key "$KEYNAME" >/dev/null 2>&1 && { V_ALLOW=ya; ok "kunci $KEYNAME diberi izin baca/tulis pada bucket $BUCKET"; } || die "gagal memberi izin pada bucket"
out_hasi 'create.*buckets: *false' G key info "$KEYNAME" && ok "kunci tidak boleh membuat bucket lain" || warn "periksa: kunci mungkin boleh membuat bucket (jangan dibagikan)"

phase 4 "Kuota bucket"
if [ -n "$QUOTA" ]; then G bucket set-quotas "$BUCKET" --max-size "$QUOTA" >/dev/null 2>&1 && { V_QUOTA="$QUOTA"; ok "kuota $QUOTA dipasang"; } || die "gagal memasang kuota"; else warn "tanpa kuota (disarankan: --quota 10GiB agar satu aplikasi tidak menghabiskan disk)"; V_QUOTA="tidak ada"; fi

phase 5 "Kunci ke .env aplikasi (hanya bila kosong)"
if [ -n "$ENVF" ]; then
  W=0
  if [ -n "$AK" ] && [ -n "$SK" ]; then setv S3_ACCESS_KEY "$AK" && W=$((W+1)); setv S3_SECRET_KEY "$SK" && W=$((W+1)); else warn "rahasia kunci tidak tersedia (kunci sudah ada & .env sudah terisi?) — kunci tidak ditulis"; fi
  setv S3_BUCKET "$BUCKET" && W=$((W+1)); setv S3_ENDPOINT "http://maung-garage:3900" && W=$((W+1)); setv S3_REGION garage && W=$((W+1))
  V_ENV="$ENVF ($W isian ditulis, isian yang sudah terisi tidak diubah)"; ok "$V_ENV"
else V_ENV="tidak diminta"; ok "tanpa --env-file: tidak ada yang ditulis (rahasia tidak ditampilkan; ambil lewat 'garage key info $KEYNAME --show-secret' bila perlu)"; fi
AK=""; SK=""
STATUS=OK; REASON="-"; result
