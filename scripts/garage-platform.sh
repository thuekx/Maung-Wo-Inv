#!/usr/bin/env bash
# MAUNG — Garage bersama (S3). Berfase; backup dulu; rollback otomatis; tidak menyentuh .env WO/CRM (hanya platform/garage/.env milik stack ini).
#   bash scripts/garage-platform.sh status        # baca-saja
#   bash scripts/garage-platform.sh up            # Garage baru (volume baru + layout awal)
#   bash scripts/garage-platform.sh adopt-crm     # adopsi volume Garage CRM (tanpa menyalin data); CRM tetap jalan lewat alias sementara
#   bash scripts/garage-platform.sh finalize      # lepas alias sementara setelah CRM memakai maung-garage di maung_storage
# Selalu jalankan dengan:  </dev/null   (tanpa sudo, dari ~/Maung-Wo-Inv)
set -uo pipefail

MODE="${1:-}"
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
APP_DIR="${APP_DIR:-$HOME/Maung-Wo-Inv}"
PDIR="$APP_DIR/platform/garage"
LOG_DIR="$HOME/maung-wo-logs"; BK_DIR="$HOME/maung-garage-backups"
TS="$(date +%Y%m%d-%H%M%S)"; LOG="$LOG_DIR/garage-platform-$MODE-$TS.log"
CRM_PROJECT="${CRM_PROJECT:-maung-crm}"
CRM_META="${CRM_PROJECT}_garage_meta"; CRM_DATA="${CRM_PROJECT}_garage_data"; CRM_NET="${CRM_PROJECT}_default"
BUCKET="${CRM_BUCKET:-crm-photos}"; KEYNAME="${CRM_KEY:-crm-key}"
GC=maung-garage
N=8
STATUS="FAIL"; REASON="-"; ROLLED="no"; STOPPED_CRM=""; STARTED_PLATFORM=0; ALIAS_ADDED=0
V_NODE="n/a"; V_BUCKET="n/a"; V_KEY="n/a"; V_REACH="n/a"; V_BACKUP="-"; V_ADOPT="n/a"; V_WO="n/a"; V_ENV="n/a"

banner() { printf '\n==================================================================\n  %s\n==================================================================\n' "$1"; }
phase()  { printf '\n[%s/%s] %s\n' "$1" "$N" "$2"; }
ok()     { printf '  ✓ %s\n' "$*"; }
warn()   { printf '  ! %s\n' "$*"; }
bad()    { printf '  ✗ %s\n' "$*"; }
mask()   { sed -E 's#(://[^:/@ ]+:)[^@ ]+@#\1***@#g; s/((secret|password|token|passwd|key)[A-Za-z_]*[=:] *)[^ ,"]+/\1***/Ig'; }

result() {
  banner "RESULT"
  cat <<EOF
status=$STATUS
reason=$REASON
mode=${MODE:--}
host=$(hostname)
adopsi_volume_crm=$V_ADOPT
garage_node=$V_NODE
bucket_${BUCKET}=$V_BUCKET
kunci_${KEYNAME}=$V_KEY
terjangkau_dari_crm_api=$V_REACH
container_wo_tidak_berubah=$V_WO
rolled_back=$ROLLED
backup=$V_BACKUP
log_file=$LOG
EOF
  sleep 1
}

dc() { docker compose -p maung-garage -f "$PDIR/docker-compose.yml" --env-file "$PDIR/.env" "$@"; }
G() { docker exec "$GC" /garage "$@"; }
wo_ids() { docker ps -a --filter "label=com.docker.compose.project=maung-wo-inv" --format '{{.Names}} {{.ID}} {{.State}}' 2>/dev/null | sort; }
crm_garage_name() { docker ps -a --filter "label=com.docker.compose.project=$CRM_PROJECT" --filter "label=com.docker.compose.service=garage" --format '{{.Names}}' 2>/dev/null | head -1; }
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
healthy() { [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null)" = healthy ]; }
wait_healthy() { local i; for i in $(seq 1 "${WAIT_N:-30}"); do healthy "$GC" && return 0; sleep "${POLL:-3}"; done; return 1; }

rollback() {
  [ "$STARTED_PLATFORM" = 1 ] || [ -n "$STOPPED_CRM" ] || return 0
  warn "ROLLBACK: mengembalikan keadaan sebelum perubahan"
  if [ "$ALIAS_ADDED" = 1 ]; then docker network disconnect "$CRM_NET" "$GC" >/dev/null 2>&1 && ok "alias sementara dilepas"; fi
  if [ "$STARTED_PLATFORM" = 1 ]; then dc down >/dev/null 2>&1 && ok "Garage bersama dihentikan (volume tidak dihapus)"; fi
  if [ -n "$STOPPED_CRM" ]; then docker start "$STOPPED_CRM" >/dev/null 2>&1 && ok "Garage CRM ($STOPPED_CRM) dinyalakan kembali" || warn "Garage CRM gagal dinyalakan — jalankan: docker start $STOPPED_CRM"; fi
  ROLLED="ya"
}
die() { REASON="$1"; bad "$1"; rollback; result; exit 1; }
abort() { STATUS=ABORT; REASON="$1"; bad "$1"; result; exit 2; }

# ───────────────────────── 1. Guard ─────────────────────────
banner "MAUNG — Garage bersama (${MODE:-?})  ($TS)"
phase 1 "Guard host, direktori, argumen"
case "$MODE" in status|up|adopt-crm|finalize) ok "mode: $MODE" ;; *) abort "mode tidak dikenal '$MODE' (status | up | adopt-crm | finalize)" ;; esac
[ "$(hostname)" = "$EXPECT_HOST" ] || abort "host '$(hostname)' ≠ '$EXPECT_HOST' — dihentikan"
ok "host = $EXPECT_HOST"
[ "$(id -u)" != 0 ] || abort "jangan jalankan sebagai root/sudo"
ok "dijalankan sebagai $(id -un)"
[ -f "$PDIR/docker-compose.yml" ] || abort "$PDIR/docker-compose.yml tidak ada (git pull dulu)"
docker info >/dev/null 2>&1 || abort "tidak bisa mengakses Docker (jangan pakai sudo)"
ok "Docker dapat diakses; berkas stack ada"
mkdir -p "$LOG_DIR" "$BK_DIR" && chmod 700 "$LOG_DIR" "$BK_DIR"
exec > >(tee -a "$LOG") 2>&1
ok "log audit: $LOG"

# ───────────────────────── 2. Snapshot ─────────────────────────
phase 2 "Snapshot keadaan (baca-saja)"
WO_IDS_BEFORE="$(wo_ids)"; ok "container WO tercatat: $(printf '%s\n' "$WO_IDS_BEFORE" | grep -c .) buah"
if [ -f "$APP_DIR/.env" ]; then ENV_BEFORE="$(sha256sum "$APP_DIR/.env" | cut -d' ' -f1)"; ok "checksum .env WO dicatat"; else ENV_BEFORE=""; fi

if [ "$MODE" = status ]; then
  phase 3 "Status Garage bersama"
  if docker inspect "$GC" >/dev/null 2>&1; then
    echo "  container: $(docker inspect -f '{{.State.Status}}' "$GC")/$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$GC")"
    echo "  jaringan : $(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$GC")"
    echo "  volume   : $(docker inspect -f '{{range .Mounts}}{{.Name}} {{end}}' "$GC")"
    if running "$GC"; then
      V_NODE="$(G status 2>/dev/null | awk '/^[0-9a-f]{16}/{print $1; exit}')"; echo "  node     : ${V_NODE:-(tidak terbaca)}"
      echo "  bucket   :"; G bucket list 2>/dev/null | sed 's/^/    /' | head -20
      echo "  kunci (hanya nama):"; G key list 2>/dev/null | sed 's/^/    /' | head -20
    fi
  else warn "container $GC belum ada (jalankan: up atau adopt-crm)"; fi
  echo "  Garage CRM lama: $(crm_garage_name | sed 's/^$/(tidak ada)/')"
  STATUS=OK; result; exit 0
fi

phase 3 "Prasyarat per mode"
case "$MODE" in
  adopt-crm)
    CRM_GC="$(crm_garage_name)"; [ -n "$CRM_GC" ] || abort "container Garage CRM (project $CRM_PROJECT, service garage) tidak ditemukan"
    docker volume inspect "$CRM_META" >/dev/null 2>&1 && docker volume inspect "$CRM_DATA" >/dev/null 2>&1 || abort "volume $CRM_META / $CRM_DATA tidak ada"
    ok "Garage CRM: $CRM_GC; volume $CRM_META & $CRM_DATA ada"
    docker inspect "$GC" >/dev/null 2>&1 && abort "container $GC sudah ada — adopsi sudah dilakukan? (pakai: status)"
    ok "belum ada Garage bersama (aman)"
    META_VOL="$CRM_META"; DATA_VOL="$CRM_DATA"; V_ADOPT="ya ($CRM_META, $CRM_DATA)"
    ;;
  up)
    docker inspect "$GC" >/dev/null 2>&1 && abort "container $GC sudah ada"
    [ -z "$(crm_garage_name)" ] || warn "ada Garage CRM ($(crm_garage_name)) — untuk memindahkannya pakai 'adopt-crm', bukan 'up'"
    META_VOL="maung-garage_meta"; DATA_VOL="maung-garage_data"; V_ADOPT="tidak (volume baru)"
    ;;
  finalize)
    docker inspect "$GC" >/dev/null 2>&1 || abort "Garage bersama belum ada — jalankan adopt-crm dulu"
    running "$GC" || abort "Garage bersama tidak berjalan"
    CRMAPI="$(docker ps --filter "label=com.docker.compose.project=$CRM_PROJECT" --filter "label=com.docker.compose.service=crm-api" --format '{{.Names}}' | head -1)"
    [ -n "$CRMAPI" ] || abort "container crm-api tidak berjalan"
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CRMAPI" | grep -q '^S3_ENDPOINT=http://maung-garage:3900' || abort "crm-api belum memakai S3_ENDPOINT=http://maung-garage:3900 — update CRM dulu (lihat ringkasan cutover)"
    docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$CRMAPI" | grep -qw maung_storage || abort "crm-api belum tergabung ke maung_storage"
    ok "crm-api memakai maung-garage dan tergabung ke maung_storage"
    CRM_GC_NOW="$(crm_garage_name)"; if [ -n "$CRM_GC_NOW" ] && running "$CRM_GC_NOW"; then abort "Garage CRM lama ($CRM_GC_NOW) MASIH berjalan — dua Garage pada volume yang sama berbahaya; hentikan dulu"; fi
    ok "tidak ada Garage CRM lama yang berjalan"
    ;;
esac

if [ "$MODE" = finalize ]; then
  phase 4 "Lepas alias sementara dari jaringan CRM"
  if docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$GC" | grep -qw "$CRM_NET"; then docker network disconnect "$CRM_NET" "$GC" >/dev/null 2>&1 && ok "$GC dilepas dari $CRM_NET" || die "gagal melepas $GC dari $CRM_NET"; else ok "alias sementara sudah tidak ada"; fi
  phase 5 "Bukti"
  R="$(docker exec "$CRMAPI" node -e "fetch('http://maung-garage:3900/').then(r=>{console.log('HTTP '+r.status);process.exit(0)}).catch(e=>{console.log('ERR');process.exit(1)})" 2>/dev/null | tr -d '\r\n')"; V_REACH="${R:-ERR}"
  case "$V_REACH" in HTTP*) ok "crm-api → http://maung-garage:3900 menjawab ($V_REACH)" ;; *) die "crm-api tidak menjangkau maung-garage ($V_REACH)" ;; esac
  V_BUCKET="$(G bucket list 2>/dev/null | grep -c "$BUCKET")"; V_KEY="$(G key list 2>/dev/null | grep -c "$KEYNAME")"
  [ "$V_BUCKET" -ge 1 ] && [ "$V_KEY" -ge 1 ] && ok "bucket $BUCKET dan kunci $KEYNAME ada" || die "bucket/kunci tidak ditemukan"
  [ "$(wo_ids)" = "$WO_IDS_BEFORE" ] && V_WO=ya || V_WO=TIDAK
  STATUS=OK; result; exit 0
fi

# ───────────────────────── 4. Jaringan, .env, stop CRM garage, backup ─────────────────────────
phase 4 "Jaringan maung_storage dan konfigurasi stack (.env milik stack ini)"
docker network inspect maung_storage >/dev/null 2>&1 || { docker network create maung_storage >/dev/null && ok "jaringan maung_storage dibuat"; }
ok "jaringan maung_storage ada"
for v in "$META_VOL" "$DATA_VOL"; do docker volume inspect "$v" >/dev/null 2>&1 || { docker volume create "$v" >/dev/null && ok "volume $v dibuat"; }; done
if [ -f "$PDIR/.env" ]; then
  V_ENV="sudah-ada (tidak diubah)"; ok "platform/garage/.env sudah ada — dipertahankan"
  grep -q "^GARAGE_META_VOLUME=$META_VOL\$" "$PDIR/.env" && grep -q "^GARAGE_DATA_VOLUME=$DATA_VOL\$" "$PDIR/.env" || abort "platform/garage/.env memuat nama volume yang berbeda dari yang akan dipakai ($META_VOL/$DATA_VOL) — periksa manual (tidak diubah)"
else
  umask 077
  { echo "GARAGE_RPC_SECRET=$(openssl rand -hex 32)"; echo "GARAGE_META_VOLUME=$META_VOL"; echo "GARAGE_DATA_VOLUME=$DATA_VOL"; } > "$PDIR/.env"
  chmod 600 "$PDIR/.env"; V_ENV="dibuat (izin 600, rahasia tidak ditampilkan)"; ok "platform/garage/.env dibuat (izin 600; rahasia tidak ditampilkan)"
fi
dc config >/dev/null 2>&1 && ok "docker compose config valid" || abort "docker compose config tidak valid"

phase 5 "Hentikan Garage CRM (konsisten) lalu backup volume"
if [ "$MODE" = adopt-crm ]; then
  OLD_NODE=""; OLD_LAYOUT=""
  if running "$CRM_GC"; then
    OLD_NODE="$(docker exec "$CRM_GC" /garage status 2>/dev/null | awk '/^[0-9a-f]{16}/{print $1; exit}')"
    OLD_LAYOUT="$(docker exec "$CRM_GC" /garage layout show 2>/dev/null | head -25)"
    ok "Garage CRM lama: ID node ${OLD_NODE:-(tidak terbaca)}"
    printf '%s\n' "$OLD_LAYOUT" | sed 's/^/      [layout lama] /' | head -12
  fi
  if running "$CRM_GC"; then docker stop "$CRM_GC" >/dev/null 2>&1 && STOPPED_CRM="$CRM_GC" && ok "Garage CRM dihentikan ($CRM_GC) — foto CRM sementara tidak terlayani sampai langkah 7" || die "gagal menghentikan $CRM_GC"; else ok "Garage CRM sudah berhenti"; STOPPED_CRM="$CRM_GC"; fi
  BF="$BK_DIR/garage-adopt-$TS.tgz"
  if docker run --rm -v "$META_VOL":/m:ro -v "$DATA_VOL":/d:ro -v "$BK_DIR":/b alpine sh -c "tar czf /b/garage-adopt-$TS.tgz -C / m d && chown $(id -u):$(id -g) /b/garage-adopt-$TS.tgz && chmod 600 /b/garage-adopt-$TS.tgz" >/dev/null 2>&1 && [ -s "$BF" ]; then V_BACKUP="$BF ($(du -h "$BF" | cut -f1))"; ok "backup volume (konsisten, Garage berhenti): $V_BACKUP"; else die "backup volume gagal — tidak dilanjutkan (Garage CRM dinyalakan kembali)"; fi
else ok "mode up: volume baru, tidak ada yang perlu dibackup"; fi

# ───────────────────────── 6. Start ─────────────────────────
phase 6 "Nyalakan Garage bersama"
dc up -d >/dev/null 2>&1 && STARTED_PLATFORM=1 && ok "stack maung-garage dinyalakan" || { STARTED_PLATFORM=1; die "docker compose up gagal"; }
wait_healthy && ok "Garage bersama sehat" || { dc logs --no-color --tail 20 2>&1 | mask | sed 's/^/    /'; die "Garage bersama tidak sehat"; }

# ───────────────────────── 7. Verifikasi ─────────────────────────
phase 7 "Verifikasi data & akses"
V_NODE="$(G status 2>/dev/null | awk '/^[0-9a-f]{16}/{print $1; exit}')"; [ -n "$V_NODE" ] && ok "node Garage: $V_NODE" || die "ID node tidak terbaca"
if [ "$MODE" = up ]; then
  G layout show 2>/dev/null | grep -q "$V_NODE" || { G layout assign -z dc1 -c 10G "$V_NODE" >/dev/null 2>&1 && G layout apply --version 1 >/dev/null 2>&1 && ok "layout awal diterapkan" || die "layout awal gagal"; }
else
  if [ -n "${OLD_NODE:-}" ] && [ "$OLD_NODE" != "$V_NODE" ]; then
    bad "ID node BERBEDA: lama=$OLD_NODE baru=$V_NODE (node_key tidak teradopsi — volume meta yang terpasang bukan milik Garage CRM?)"
    echo "  isi volume meta yang terpasang di Garage bersama:"; docker run --rm -v "$META_VOL":/m:ro alpine sh -c 'ls -la /m; ls -la /m/*/ 2>/dev/null | head -20' 2>&1 | sed 's/^/      /'
    die "ID node berubah setelah adopsi"
  fi
  LAY_OK=0; for i in $(seq 1 "${LAYOUT_TRIES:-10}"); do G layout show 2>/dev/null | grep -q "$V_NODE" && { LAY_OK=1; break; }; sleep "${POLL:-3}"; done
  if [ "$LAY_OK" = 1 ]; then ok "layout lama terbaca (node punya peran)"
  else
    bad "layout tidak memuat node $V_NODE — keluaran untuk diagnosis:"
    echo "      [status baru]"; G status 2>&1 | head -12 | sed 's/^/      /'
    echo "      [layout show baru]"; G layout show 2>&1 | head -25 | sed 's/^/      /'
    echo "      [isi volume meta]"; docker run --rm -v "$META_VOL":/m:ro alpine sh -c 'ls -la /m; ls -la /m/*/ 2>/dev/null | head -20' 2>&1 | sed 's/^/      /'
    die "layout lama tidak terbaca — volume tidak teradopsi dengan benar"
  fi
  V_BUCKET="$(G bucket list 2>/dev/null | grep -c "$BUCKET")"; V_KEY="$(G key list 2>/dev/null | grep -c "$KEYNAME")"
  [ "$V_BUCKET" -ge 1 ] && ok "bucket $BUCKET ada (data utuh)" || die "bucket $BUCKET tidak ada setelah adopsi"
  [ "$V_KEY" -ge 1 ] && ok "kunci $KEYNAME ada (kredensial CRM tetap berlaku)" || die "kunci $KEYNAME tidak ada setelah adopsi"
  # CRM tetap berjalan tanpa perubahan: alias sementara `garage` di jaringan CRM
  if docker network inspect "$CRM_NET" >/dev/null 2>&1; then
    docker network connect --alias garage "$CRM_NET" "$GC" >/dev/null 2>&1 && ALIAS_ADDED=1 && ok "alias sementara 'garage' dipasang di $CRM_NET (CRM tetap bekerja tanpa perubahan)" || die "gagal memasang alias sementara di $CRM_NET"
    CRMAPI="$(docker ps --filter "label=com.docker.compose.project=$CRM_PROJECT" --filter "label=com.docker.compose.service=crm-api" --format '{{.Names}}' | head -1)"
    if [ -n "$CRMAPI" ]; then
      R="$(docker exec "$CRMAPI" node -e "fetch('http://garage:3900/').then(r=>{console.log('HTTP '+r.status);process.exit(0)}).catch(e=>{console.log('ERR');process.exit(1)})" 2>/dev/null | tr -d '\r\n')"; V_REACH="${R:-ERR}"
      case "$V_REACH" in HTTP*) ok "crm-api → http://garage:3900 (alias sementara) menjawab ($V_REACH)" ;; *) die "crm-api tidak menjangkau Garage lewat alias ($V_REACH)" ;; esac
    else warn "crm-api tidak berjalan — pemeriksaan keterjangkauan dilewati"; V_REACH="dilewati"; fi
  else warn "jaringan $CRM_NET tidak ada — alias sementara dilewati"; fi
fi

phase 8 "Bukti WO tidak terganggu dan ringkasan"
[ "$(wo_ids)" = "$WO_IDS_BEFORE" ] && { V_WO=ya; ok "container WO sama (nama, ID, status)"; } || { V_WO=TIDAK; die "container WO berubah selama proses"; }
if [ -n "$ENV_BEFORE" ] && [ "$(sha256sum "$APP_DIR/.env" | cut -d' ' -f1)" != "$ENV_BEFORE" ]; then die ".env WO BERUBAH"; fi
STATUS=OK; STARTED_PLATFORM=0; STOPPED_CRM=""; ALIAS_ADDED=0
ok "selesai tanpa kesalahan"
if [ "$MODE" = adopt-crm ]; then cat <<'NOTE'

  PENTING (sampai CRM selesai diperbarui):
   • JANGAN jalankan update.sh CRM VERSI LAMA — itu akan menyalakan Garage CRM kedua pada volume yang sama (berbahaya).
   • Langkah berikut: jalankan update.sh CRM versi BARU (compose tanpa service garage; crm-api di maung_storage
     dengan S3_ENDPOINT=http://maung-garage:3900), lalu:  bash scripts/garage-platform.sh finalize </dev/null
NOTE
fi
result
