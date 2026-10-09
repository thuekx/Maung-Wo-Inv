# Studi API MSRadius (radius.liv.net.id) untuk integrasi Maung

Sumber: dokumen "Authentication API" (15 hal) dari pemilik proyek. **PDF tidak ada di repo**; ringkasan lengkap field di bawah ini adalah acuannya.

## Ketentuan umum
| | |
|---|---|
| Base URL | `http://radius.liv.net.id/api/radius` (**HTTP polos, bukan HTTPS** → token terkirim tanpa enkripsi; perlu jalur jaringan aman: VPN/allowlist IP, atau minta HTTPS) |
| Auth | header `X-TOKEN: <API_TOKEN_USER>`; token dari User Panel: *Setting → User → Panel* |
| Rate limit | maks **10 request/60 dtk per token**, **60 request/60 dtk untuk semua token** |
| Galat | `{"code":500,"title":"Warning","msg":"invalid API Token / To Many Request"}` (cek `code` di body, bukan hanya status HTTP) |
| Syarat | langganan **MSRadius Gold** + config API master aktif |
| Semua endpoint | `GET`; respons `{code, title, msg, count?, data}` (`code` 200 = sukses) |

## Endpoint
| Endpoint | Isi | Parameter |
|---|---|---|
| `masterdata/users/list` | `data{ id_user: nama }` (reseller/partner/mitra) | – |
| `masterdata/nas/list` | `data{ ip_router: nama NAS }` (mis. `172.30.0.255: KALUKUANG`) | – |
| `masterdata/area/list` | `data{ id_area: nama }` | – |
| `datavoucher/profile` | profil voucher (HS/EV): `profile_name, price_*, speed, active_period, quota_limit, time_limit, on_sale, …` | – |
| `datavoucher/report` | laporan penjualan voucher | `date_start`,`date_end` (wajib, **maks 7 hari**, data hari ini baru tersedia lewat tengah malam), filter depositor/reseller/partner/owner/AssignTo/Router/ProfileName/Kode/Username/IsDeposit |
| `databilling/profile` | **profil/paket billing**: `type(PPP…), profile_name, price_display, price_capital, price_commission, price_commission_partner, price_sell, color, shared, active_period, speed, groupm, address_list, quota_limit, time_limit, on_sale, created_at, name_asign_to, name_created_by` | – |
| `databilling/report` | transaksi billing per periode | `date_start`,`date_end` wajib; `t_ppp/t_member/t_dhcp`, Depositor/Reseller/Partner/Owner/AssignTo/Area/Router/ProfileName/ViaBank/IsDeposit |
| `databilling/data` | **pelanggan billing aktif** (contoh `count: 2320`), tanpa paginasi — satu panggilan mengembalikan semua | opsional `name`, `profile` |

### Field `databilling/data` (sumber data pelanggan)
`kode` (kode pelanggan/billing, mis. `260705044930`) · `type` (PPP…) · `profile_name` · `name_kurir` (kurir/sales) · `name_mitra` (reseller/mitra) · `deposit` · `price_sell` · `first_bill` · `next_bill_date` (angka/teks) · `lockmac` · `disabled_username` (null/int) · `ip_address_set` (**IP statis**, nullable) · `last_mac` · `last_login` · `last_logout` · `first_login` (teks, bisa `"NOT SET"`) · `expired_at` · `prorate` · `whatsapp` · `name` (contoh `PANJI_AGUNG` → tampak seperti nama akun/username) · `address` (bisa `"-"`) · `lat`/`lng` (string, nullable) · `unique_code` · `notess` (contoh `"Tanggal Daftar : 2026-07-05"`) · `items[]{repeat_bill, code(PROFILE/RESELLER/PARTNER…), name, qty, price, amount}`.

**Tidak ada di API:** email, ODP, port, VLAN, cabang/gudang, area per pelanggan, status "aktif/isolir" eksplisit (hanya `disabled_username` dan `expired_at`), ID numerik stabil selain `kode`.

## Pemetaan ke Maung (DITERAPKAN — default; dapat diubah bila pemilik mengoreksi)
> Status: diimplementasikan di `apps/api/src/radius.ts`. Hanya **2 endpoint** yang dipakai: `databilling/data` (pelanggan) dan `databilling/profile` (paket); `masterdata/users/list` hanya untuk *Uji koneksi*. Keputusan pemilik: Maung **hanya membaca** MSRadius (tidak menulis/menghapus), data pelanggan **satu sumber** = MSRadius, akses HTTP polos.
### Data pelanggan (`databilling/data` → tabel `Customer`)
| Field API | Field Maung | Catatan |
|---|---|---|
| `kode` | `Customer.code` (ID pelanggan) | kunci sinkron (upsert). Pelanggan baru yang belum ada di API: kode diketik manual (butir 28) |
| `name` | `name` | perlu dipastikan: nama orang atau username PPPoE? |
| `whatsapp` | `phone` | `""` → kosong |
| `address` | `address` | `"-"` dianggap kosong |
| `lat`,`lng` | `lat`,`lng` | string → angka; **boleh kosong** (butir 3). Jangan menimpa GPS hasil survei FOC dengan null |
| `profile_name` | `packageName` | memakai master paket yang juga ditarik dari API |
| `ip_address_set` | `ip` | hanya IP statis; dipakai cek/isi otomatis saat NOC mengisi VLAN+IP (butir 30) |
| `expired_at` | `expiredAt` (kolom baru) | jatuh tempo; kandidat suspend |
| `disabled_username` | status | `1` → SUSPENDED; selain itu mengikuti WO Maung |
| `notess` ("Tanggal Daftar: …") | `activatedAt` | di-parse |
| `name_mitra`, `name_kurir` | `resellerName`, `salesName` (kolom baru, opsional) | informasi saja |
| `last_login/last_logout/last_mac` | `lastOnline…` (opsional) | berguna untuk diagnosa NOC pada Trouble Ticket |
| `deposit`,`price_sell`,`first_bill`,`next_bill_date`,`items[]` | **tidak disimpan** (data keuangan) | Finance punya sistem sendiri; bisa ditampilkan read-only bila diminta |
| (tidak ada) | `email`, `odp`, `port`, `vlan`, `warehouseId` | tetap milik Maung, tidak ditimpa sinkron |

### Master lain
| Endpoint | Usulan |
|---|---|
| `databilling/profile` | **Master Paket** (`Package`): kunci `profile_name`; simpan `type`, `price_sell`, `speed`, `active_period`, `on_sale`→aktif. **Tidak** menyimpan `price_capital`/komisi (sensitif, tak relevan WO) |
| `masterdata/nas/list` | opsional **Master NAS/Router** untuk referensi NOC (`ip → nama`); `databilling/data` tidak menyebut NAS per pelanggan, jadi hanya referensi |
| `masterdata/area/list` | opsional; tidak ada area per pelanggan di `/data` → tunda |
| `masterdata/users/list` | tidak dipakai |
| `datavoucher/*` | **tidak dipakai** (voucher hotspot, di luar lingkup WO/aset) |
| `databilling/report` | **tidak dipakai sekarang** (laporan keuangan); kandidat nanti: deteksi tunggakan untuk usulan Suspend otomatis |

## Rancangan sinkronisasi (butir 30, 35)
- **Pengaturan Admin → Integrasi MSRadius**: URL dasar (bawaan `http://radius.liv.net.id/api/radius`), **token API** (disimpan terenkripsi seperti SMTP/Telegram), sakelar sinkron otomatis + interval, tombol **Uji koneksi** (memanggil `masterdata/users/list`, murah), status/riwayat sinkron terakhir, tombol **Tarik data sekarang** (juga untuk MKT).
- **Otomatis**: cron BullMQ (mis. tiap 30–60 mnt, dapat diatur) + tombol manual (MKT & Admin). Satu panggilan `databilling/data` sudah memberi semua pelanggan → 1–2 request per putaran, jauh di bawah rate limit (10/mnt). Kunci "satu sinkron berjalan", jeda ≥ 7 dtk antar-panggilan, hormati galat `code 500`.
- **Upsert** berdasarkan `kode`; kolom milik Maung (ODP/port/VLAN/gudang/email) tidak ditimpa; pelanggan yang hilang dari API **tidak dihapus** (ditandai `missingFromApi`); tabel `SyncRun` mencatat waktu, jumlah baru/diubah/dilewati, galat.
- Keamanan: HTTP polos → rekomendasikan VPN/allowlist; token tidak pernah ditampilkan ulang; semua panggilan dari server (bukan browser).


## Implementasi (Batch E)
- **Admin → Pengaturan → Integrasi MSRadius**: URL dasar, token (terenkripsi AES-GCM, tidak pernah ditampilkan ulang), sinkron otomatis + interval (min. 5 mnt), opsi "Rapikan nama", tombol **Uji koneksi**, riwayat sinkron (`SyncRun`).
- **Sinkron**: worker menjalankan job `radius-tick` tiap 5 mnt (otomatis bila aktif & jatuh tempo) dan `radius-sync-now` (tombol **Tarik data MSRadius**, MKT & Admin). Satu putaran = 2 request (`databilling/profile` → jeda 7 dtk → `databilling/data`) dengan kunci Redis agar tidak ganda.
- **Upsert by `kode`** → `Customer.code`. Bersumber API (tidak bisa diedit manual, diubah di MSRadius): nama, telepon (`whatsapp`), alamat, paket. Diisi bila kosong: lat/lng, tanggal aktif (dari `notess`). Selalu diperbarui: `radiusIp` (IP statis, rujukan NOC), `expiredAt`, reseller/sales, status ACTIVE↔SUSPENDED (`disabled_username`; tidak disentuh bila ada WO berjalan). **Milik Maung, tidak ditimpa**: email, ODP, port, VLAN, IP internal, IP publik, gudang.
- Pelanggan yang hilang dari API hanya ditandai `missingFromApi` (tidak dihapus). Paket baru dari `databilling/profile` masuk Master Paket (tanpa harga modal/komisi); paket yang dipakai pelanggan otomatis dibuat bila belum ada.
- **Pelanggan baru (belum ada di MSRadius)**: input manual dengan kode sendiri (juga di form WO Pasang Baru, kolom *ID pelanggan MSRadius*). Setelah akunnya dibuat di MSRadius dengan kode yang sama, tombol **Tarik dari MSRadius** di halaman pelanggan menautkan & mengisi datanya.
- **NOC**: form validasi memprefill IP/VLAN/ODP; IP dari MSRadius yang privat → kolom IP internal, yang publik → IP Publik. Cek duplikat IP juga membandingkan IP dari MSRadius.
