#!/usr/bin/env bash
# Tes scripts/garage-platform.sh, garage-app.sh, garage-backup.sh dengan docker TIRUAN (tanpa Docker/Garage asli).
# Jalankan: bash scripts/tests/garage.test.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0
t() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   - $1"; else FAIL=$((FAIL+1)); echo "  GAGAL - $1 (diharapkan '$3', dapat '$2')"; fi; }

SIM="$(mktemp -d)"; trap 'rm -rf "$SIM"' EXIT
H="$SIM/home"; R="$H/Maung-Wo-Inv"; S="$SIM/state"
mkdir -p "$SIM/bin" "$R/scripts" "$R/platform/garage" "$S"
cp "$ROOT"/scripts/garage-platform.sh "$ROOT"/scripts/garage-app.sh "$ROOT"/scripts/garage-backup.sh "$R/scripts/"
cp "$ROOT"/platform/garage/docker-compose.yml "$ROOT"/platform/garage/garage.toml "$R/platform/garage/"
printf 'WEB_DOMAIN=wo.test.id\nSEED_PASSWORD=rahasia-wo\n' > "$R/.env"
cat > "$SIM/bin/hostname" <<'EOF'
#!/bin/bash
echo maung-apps
EOF
cat > "$SIM/bin/id" <<'EOF'
#!/bin/bash
case "$1" in -u) echo 1000;; -g) echo 1000;; *) echo ithero;; esac
EOF
cat > "$SIM/bin/openssl" <<'EOF'
#!/bin/bash
echo 00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
EOF
cat > "$SIM/bin/docker" <<'EOF'
#!/bin/bash
a="$*"; L="$SIMLOG"; S="$SIMSTATE"
case "$1" in
  info) exit 0;;
  ps)
    if [[ "$a" == *"service=garage"* ]]; then [ "${CRM_GARAGE_EXISTS:-1}" = 1 ] && echo maung-crm-garage-1; exit 0; fi
    if [[ "$a" == *"service=crm-api"* ]]; then [ "${CRM_API:-1}" = 1 ] && echo maung-crm-crm-api-1; exit 0; fi
    if [[ "$a" == *"project=maung-wo-inv"* ]]; then printf 'maung-wo-inv-api-1 a1 running\nmaung-wo-inv-web-1 b2 running\n'; exit 0; fi
    exit 0;;
  volume)
    case "$2" in
      inspect) [ -n "${MISSING_VOL:-}" ] && [[ "$a" == *"$MISSING_VOL"* ]] && exit 1; exit 0;;
      create) echo "volume create $3" >> "$L"; exit 0;;
    esac; exit 0;;
  network)
    case "$2" in
      inspect) if [[ "$a" == *"maung_storage"* ]] && [ ! -f "$S/net_storage" ]; then exit 1; fi; [ "${NO_CRM_NET:-0}" = 1 ] && [[ "$a" == *"maung-crm_default"* ]] && exit 1; exit 0;;
      create) touch "$S/net_storage"; echo "network create $3" >> "$L"; exit 0;;
      connect) [ "${ALIAS_FAIL:-0}" = 1 ] && exit 1; touch "$S/alias"; echo "network connect $a" >> "$L"; exit 0;;
      disconnect) rm -f "$S/alias"; echo "network disconnect $a" >> "$L"; exit 0;;
    esac; exit 0;;
  stop) rm -f "$S/crm_running"; echo "stop $2" >> "$L"; exit 0;;
  start) touch "$S/crm_running"; echo "start $2" >> "$L"; exit 0;;
  inspect)
    last="${@: -1}"
    if [ "$2" != "-f" ]; then [ "$2" = maung-garage ] && { [ -f "$S/platform_exists" ] && exit 0 || exit 1; }; exit 0; fi
    fmt="$3"
    case "$fmt" in
      *State.Running*) case "$last" in maung-crm-garage-1) [ -f "$S/crm_running" ] && echo true || echo false;; maung-garage) [ -f "$S/platform_running" ] && echo true || echo false;; *) echo true;; esac;;
      *State.Health*) [ "${UNHEALTHY:-0}" = 1 ] && echo starting || { [ -f "$S/platform_running" ] && echo healthy || echo none; };;
      *State.Status*) echo running;;
      *Networks*) case "$last" in maung-garage) printf 'maung_storage '; [ -f "$S/alias" ] && printf 'maung-crm_default '; echo;; *) printf 'maung-crm_default '; [ "${CRM_API_STORAGE:-0}" = 1 ] && printf 'maung_storage '; echo;; esac;;
      *Config.Env*) if [ "${CRM_API_NEWEP:-0}" = 1 ]; then echo "S3_ENDPOINT=http://maung-garage:3900"; else echo "S3_ENDPOINT=http://garage:3900"; fi;;
      *Mounts*) if [[ "$fmt" == *meta* ]]; then echo maung-garage_meta; else echo maung-garage_data; fi;;
      *) echo true;;
    esac; exit 0;;
  exec)
    if [[ "$a" == *"node -e"* ]]; then echo "HTTP 403"; exit 0; fi
    if [[ "$a" == "exec maung-crm-garage-1 /garage "* ]]; then
      case "${a#exec maung-crm-garage-1 /garage }" in
        status) echo "${OLD_NODE_ID:-0123456789abcdef}  maung-apps  127.0.0.1:3901  [dc1]";;
        "layout show") echo "==== CURRENT CLUSTER LAYOUT ===="; echo "${OLD_NODE_ID:-0123456789abcdef}  dc1  10 GB";;
      esac; exit 0
    fi
    sub="${a#exec maung-garage /garage }"
    echo "garage $sub" >> "$L"
    case "$sub" in
      "status") echo "0123456789abcdef  maung-apps  127.0.0.1:3901  [dc1]";;
      "layout show") if [ "${NO_LAYOUT:-0}" = 1 ]; then echo "(kosong)"; else echo "0123456789abcdef  dc1  10 GB"; [ "${SLOW_OUT:-0}" = 1 ] && { sleep 0.3; i=0; while [ $i -lt 5000 ]; do echo "baris-tambahan-setelah-kecocokan-$i"; i=$((i+1)); done; }; fi;;
      "bucket list") [ "${NO_BUCKET:-0}" = 1 ] || echo "crm-photos"; [ -f "$S/buckets" ] && cat "$S/buckets";;
      "key list") echo "crm-key"; [ -f "$S/keys" ] && cat "$S/keys";;
      "meta snapshot") [ "${SNAP_FAIL:-0}" = 1 ] && exit 1;;
      "bucket create "*) echo "${sub#bucket create }" >> "$S/buckets";;
      "key create "*) echo "${sub#key create }" >> "$S/keys"; printf 'Key name: x\nKey ID: GKTESTKEYID12345\nSecret key: SECRET-RAHASIA-XYZ\nCan create buckets: false\n';;
      "key info "*) printf 'Key name: x\nKey ID: GKTESTKEYID12345\nSecret key: SECRET-RAHASIA-XYZ\nCan create buckets: false\n';;
      "bucket allow "*|"bucket set-quotas "*|"layout assign "*|"layout apply "*) ;;
    esac; exit 0;;
  run)
    if [ "${RUN_FAIL:-0}" = 1 ] && [[ "$a" == *"tar czf"* ]]; then exit 1; fi
    if [[ "$a" == *"ls -1 /m/snapshots"* ]]; then echo "2026-10-12T10:00:00Z"; exit 0; fi
    if [[ "$a" == *"tar czf"* ]]; then
      d="$(echo "$a" | grep -o '\-v [^ ]*:/b' | cut -d' ' -f2 | cut -d: -f1)"; f="$(echo "$a" | grep -o '/b/[^ ]*\.tgz' | head -1)"
      tar czf "$d/$(basename "$f")" -C /etc hostname 2>/dev/null; chmod 600 "$d/$(basename "$f")"; exit 0
    fi; exit 0;;
  compose)
    case "$a" in
      *" config"*) [ "${CONFIG_FAIL:-0}" = 1 ] && exit 1; exit 0;;
      *" up "*|*" up") [ "${UP_FAIL:-0}" = 1 ] && exit 1; touch "$S/platform_exists" "$S/platform_running"; echo "compose up" >> "$L"; exit 0;;
      *" down"*) rm -f "$S/platform_exists" "$S/platform_running"; echo "compose down" >> "$L"; exit 0;;
      *) exit 0;;
    esac;;
esac
exit 0
EOF
chmod +x "$SIM/bin/"*
export SIMLOG="$SIM/log" SIMSTATE="$S"
reset() { rm -rf "$S"; mkdir -p "$S"; touch "$S/crm_running"; : > "$SIMLOG"; rm -f "$R/platform/garage/.env"; rm -rf "$H/maung-wo-logs" "$H/maung-garage-backups"; }
run() { script="$1"; shift; ( cd /tmp && PATH="$SIM/bin:$PATH" HOME="$H" APP_DIR="$R" WAIT_N=2 POLL=0 LAYOUT_TRIES="${LAYOUT_TRIES:-2}" bash "$R/scripts/$script" "$@" </dev/null 2>&1 ); }
res() { printf '%s\n' "$1" | sed -n 's/^'"$2"'=//p' | head -1; }
ENVSUM="$(sha256sum "$R/.env" | cut -d' ' -f1)"

echo "== A1. adopt-crm sukses"
reset; O="$(run garage-platform.sh adopt-crm)"
t "status OK" "$(res "$O" status)" OK
t "volume CRM diadopsi" "$(res "$O" adopsi_volume_crm | cut -c1-2)" ya
t "Garage CRM dihentikan (tidak jalan)" "$([ -f "$S/crm_running" ] && echo jalan || echo berhenti)" berhenti
t "Garage bersama jalan" "$([ -f "$S/platform_running" ] && echo ya)" ya
t "bucket crm-photos terverifikasi" "$(res "$O" bucket_crm-photos)" 1
t "kunci crm-key terverifikasi" "$(res "$O" kunci_crm-key)" 1
t "alias sementara terpasang" "$([ -f "$S/alias" ] && echo ya)" ya
t "crm-api menjangkau lewat alias" "$(res "$O" terjangkau_dari_crm_api | cut -c1-4)" HTTP
t "container WO tidak berubah" "$(res "$O" container_wo_tidak_berubah)" ya
t ".env platform dibuat" "$([ -f "$R/platform/garage/.env" ] && echo ya)" ya
t ".env platform izin 600" "$(stat -c %a "$R/platform/garage/.env")" 600
t ".env platform memuat volume CRM" "$(grep -c 'GARAGE_META_VOLUME=maung-crm_garage_meta' "$R/platform/garage/.env")" 1
t "rahasia RPC tidak ada di log" "$(grep -rc '00112233445566778899' "$H/maung-wo-logs" | awk -F: '{s+=$2} END{print s+0}')" 0
t "backup volume dibuat" "$(ls "$H/maung-garage-backups" | grep -c 'garage-adopt')" 1
t "peringatan jangan update.sh CRM lama" "$(printf '%s\n' "$O" | grep -c 'JANGAN jalankan update.sh CRM VERSI LAMA')" 1
t ".env WO tidak berubah" "$(sha256sum "$R/.env" | cut -d' ' -f1)" "$ENVSUM"

echo "== A2. verifikasi gagal (bucket hilang) = rollback penuh"
reset; O="$(NO_BUCKET=1 run garage-platform.sh adopt-crm)"
t "FAIL" "$(res "$O" status)" FAIL
t "rolled_back" "$(res "$O" rolled_back)" ya
t "Garage CRM dinyalakan kembali" "$([ -f "$S/crm_running" ] && echo jalan)" jalan
t "Garage bersama dihentikan" "$([ -f "$S/platform_running" ] && echo jalan || echo berhenti)" berhenti
t "alias dilepas" "$([ -f "$S/alias" ] && echo ada || echo tidak)" tidak

echo "== A1b. regresi SIGPIPE: keluaran layout panjang & lambat setelah kecocokan (grep -q berhenti awal) tetap lolos"
reset; O="$(SLOW_OUT=1 run garage-platform.sh adopt-crm)"
t "status OK walau keluaran panjang" "$(res "$O" status)" OK

echo "== A2b. ID node berbeda dari Garage CRM lama = rollback + pesan jelas"
reset; O="$(OLD_NODE_ID=fedcba9876543210 run garage-platform.sh adopt-crm)"
t "FAIL" "$(res "$O" status)" FAIL
t "alasan: ID node berubah" "$(res "$O" reason)" "ID node berubah setelah adopsi"
t "pesan ID berbeda dicetak" "$(printf '%s\n' "$O" | grep -c 'ID node BERBEDA')" 1
t "rolled_back + Garage CRM hidup" "$(res "$O" rolled_back)/$([ -f "$S/crm_running" ] && echo jalan)" ya/jalan
t "ID lama dicatat sebelum stop" "$(printf '%s\n' "$O" | grep -c 'Garage CRM lama: ID node fedcba9876543210')" 1

echo "== A3. layout lama tidak terbaca = rollback"
reset; O="$(NO_LAYOUT=1 LAYOUT_TRIES=2 run garage-platform.sh adopt-crm)"
t "diagnosis layout dicetak" "$(printf '%s\n' "$O" | grep -c 'layout show baru')" 1
t "FAIL + rolled_back" "$(res "$O" status)/$(res "$O" rolled_back)" FAIL/ya
t "Garage CRM hidup lagi" "$([ -f "$S/crm_running" ] && echo jalan)" jalan

echo "== A4. backup gagal = tidak lanjut, CRM dinyalakan kembali"
reset; O="$(RUN_FAIL=1 run garage-platform.sh adopt-crm)"
t "FAIL" "$(res "$O" status)" FAIL
t "Garage bersama tidak pernah dinyalakan" "$(grep -c 'compose up' "$SIMLOG")" 0
t "Garage CRM hidup lagi" "$([ -f "$S/crm_running" ] && echo jalan)" jalan

echo "== A5. Garage tidak sehat = rollback"
reset; O="$(UNHEALTHY=1 run garage-platform.sh adopt-crm)"
t "FAIL + rolled_back" "$(res "$O" status)/$(res "$O" rolled_back)" FAIL/ya
t "Garage CRM hidup lagi" "$([ -f "$S/crm_running" ] && echo jalan)" jalan

echo "== A6. prasyarat"
reset; O="$(MISSING_VOL=maung-crm_garage_data run garage-platform.sh adopt-crm)"; t "volume hilang → ABORT" "$(res "$O" status)" ABORT
t "Garage CRM tetap jalan" "$([ -f "$S/crm_running" ] && echo jalan)" jalan
reset; touch "$S/platform_exists" "$S/platform_running"; O="$(run garage-platform.sh adopt-crm)"; t "sudah ada → ABORT" "$(res "$O" status)" ABORT
reset; O="$(CRM_GARAGE_EXISTS=0 run garage-platform.sh adopt-crm)"; t "tanpa Garage CRM → ABORT" "$(res "$O" status)" ABORT
reset; O="$(EXPECT_HOST=lain run garage-platform.sh adopt-crm)"; t "host salah → ABORT" "$(res "$O" status)" ABORT
reset; O="$(run garage-platform.sh ngawur)"; t "mode salah → ABORT" "$(res "$O" status)" ABORT
reset; mkdir -p "$R/platform/garage"; printf 'GARAGE_RPC_SECRET=lama\nGARAGE_META_VOLUME=lain\nGARAGE_DATA_VOLUME=lain2\n' > "$R/platform/garage/.env"; O="$(run garage-platform.sh adopt-crm)"
t ".env platform beda volume → ABORT (tidak diubah)" "$(res "$O" status)" ABORT

echo "== B. up (volume baru)"
reset; O="$(CRM_GARAGE_EXISTS=0 MISSING_VOL=maung-garage_ NO_LAYOUT=1 run garage-platform.sh up)"
t "status OK" "$(res "$O" status)" OK
t "layout awal diterapkan" "$(grep -c 'layout apply' "$SIMLOG")" 1
t "volume baru dibuat" "$(grep -c 'volume create maung-garage_' "$SIMLOG")" 2

echo "== C. finalize"
reset; touch "$S/platform_exists" "$S/platform_running" "$S/alias"; O="$(run garage-platform.sh finalize)"
t "crm-api belum pakai endpoint baru → ABORT" "$(res "$O" status)" ABORT
t "alias tidak dilepas" "$([ -f "$S/alias" ] && echo ada)" ada
reset; touch "$S/platform_exists" "$S/platform_running" "$S/alias"; O="$(CRM_API_NEWEP=1 CRM_API_STORAGE=1 run garage-platform.sh finalize)"
t "Garage CRM lama masih jalan → ABORT" "$(res "$O" status)" ABORT
reset; rm -f "$S/crm_running"; touch "$S/platform_exists" "$S/platform_running" "$S/alias"; O="$(CRM_API_NEWEP=1 CRM_API_STORAGE=1 run garage-platform.sh finalize)"
t "OK" "$(res "$O" status)" OK
t "alias dilepas" "$([ -f "$S/alias" ] && echo ada || echo tidak)" tidak
t "bucket terverifikasi" "$(res "$O" bucket_crm-photos)" 1
reset; rm -f "$S/crm_running"; touch "$S/platform_exists" "$S/platform_running" "$S/alias"; O="$(CRM_API_NEWEP=1 run garage-platform.sh finalize)"; t "crm-api belum di maung_storage → ABORT" "$(res "$O" status)" ABORT

echo "== D. status (baca-saja)"
reset; touch "$S/platform_exists" "$S/platform_running"; : > "$SIMLOG"; O="$(run garage-platform.sh status)"
t "OK" "$(res "$O" status)" OK
t "tidak ada perubahan (tanpa stop/start/up/down/connect)" "$(grep -cE '^(stop|start|compose|network connect|network disconnect|volume create)' "$SIMLOG")" 0

echo "== E. garage-app"
reset; touch "$S/platform_exists" "$S/platform_running"; printf 'DB_URL=x\nS3_BUCKET=\n' > "$SIM/app.env"
O="$(run garage-app.sh foto --quota 10GiB --env-file "$SIM/app.env")"
t "status OK" "$(res "$O" status)" OK
t "bucket dibuat" "$(res "$O" bucket_status)" dibuat
t "kunci dibuat" "$(res "$O" key_status)" dibuat
t "izin bucket saja" "$(res "$O" izin_bucket_saja)" ya
t "kuota dipasang" "$(res "$O" kuota)" 10GiB
t "S3_ACCESS_KEY ditulis" "$(grep -c '^S3_ACCESS_KEY=GKTESTKEYID12345' "$SIM/app.env")" 1
t "S3_SECRET_KEY ditulis" "$(grep -c '^S3_SECRET_KEY=SECRET-RAHASIA-XYZ' "$SIM/app.env")" 1
t "S3_BUCKET kosong → diisi" "$(grep -c '^S3_BUCKET=foto-photos' "$SIM/app.env")" 1
t "rahasia TIDAK ada di keluaran" "$(printf '%s' "$O" | grep -c 'SECRET-RAHASIA-XYZ')" 0
t "rahasia TIDAK ada di log" "$(grep -rc 'SECRET-RAHASIA-XYZ' "$H/maung-wo-logs" | awk -F: '{s+=$2} END{print s+0}')" 0
printf 'DB_URL=x\nS3_BUCKET=punya-saya\nS3_ACCESS_KEY=SUDAH-ADA\nS3_SECRET_KEY=SUDAH-ADA2\n' > "$SIM/app.env"
O="$(run garage-app.sh foto --env-file "$SIM/app.env")"
t "idempoten: bucket sudah-ada" "$(res "$O" bucket_status)" sudah-ada
t "idempoten: kunci sudah-ada" "$(res "$O" key_status)" sudah-ada
t "isian terisi tidak ditimpa (kunci)" "$(grep -c '^S3_ACCESS_KEY=SUDAH-ADA$' "$SIM/app.env")" 1
t "isian terisi tidak ditimpa (bucket)" "$(grep -c '^S3_BUCKET=punya-saya$' "$SIM/app.env")" 1
O="$(run garage-app.sh 'Foto Besar')"; t "nama app tidak valid → ABORT" "$(res "$O" status)" ABORT
O="$(run garage-app.sh foto --quota banyak)"; t "kuota tidak valid → ABORT" "$(res "$O" status)" ABORT
O="$(run garage-app.sh foto --env-file "$SIM/tidak-ada.env")"; t "env-file hilang → ABORT" "$(res "$O" status)" ABORT
reset; O="$(run garage-app.sh foto)"; t "Garage tidak jalan → ABORT" "$(res "$O" status)" ABORT

echo "== F. garage-backup"
reset; touch "$S/platform_exists" "$S/platform_running"
for i in 1 2 3 4; do O="$(run garage-backup.sh)"; sleep 1; done
t "status OK" "$(res "$O" status)" OK
t "snapshot dicatat" "$(res "$O" snapshot)" "2026-10-12T10:00:00Z"
t "retensi 3 arsip" "$(ls "$H/maung-garage-backups"/garage-2*.tgz | wc -l)" 3
t "arsip izin 600" "$(stat -c %a "$(ls "$H/maung-garage-backups"/garage-2*.tgz | tail -1)")" 600
O="$(SNAP_FAIL=1 run garage-backup.sh)"; t "snapshot gagal → FAIL" "$(res "$O" status)" FAIL
O="$(RUN_FAIL=1 run garage-backup.sh)"; t "arsip gagal → FAIL" "$(res "$O" status)" FAIL
reset; O="$(run garage-backup.sh)"; t "Garage tidak jalan → ABORT" "$(res "$O" status)" ABORT

echo; echo "Hasil: $PASS lulus, $FAIL gagal"; [ "$FAIL" = 0 ]
