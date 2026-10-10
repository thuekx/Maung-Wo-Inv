# Export API (baca-saja)

API untuk **menarik data keluar** dari Maung-Wo-Inv ke spreadsheet, BI, atau sistem lain (mis. MSRadius di masa depan). Hanya `GET`; tidak ada operasi tulis.

## Autentikasi

Set `EXPORT_API_KEY` di `.env` (kosong = API nonaktif, respons `503`). `scripts/deploy.sh` membuat nilai acak otomatis pada instalasi baru; untuk `.env` lama tambahkan manual: `echo "EXPORT_API_KEY=$(openssl rand -hex 24)" >> .env && docker compose up -d`.

Kirim kunci lewat salah satu header:

```
x-api-key: <EXPORT_API_KEY>
Authorization: Bearer <EXPORT_API_KEY>
```

Kunci memberi akses baca ke **seluruh** data (termasuk data pribadi pelanggan): simpan seperti password, hanya pakai lewat HTTPS, dan rotasi dengan mengganti nilainya di `.env` lalu `docker compose up -d`. Batas 120 request/menit per IP. Kunci salah → `401`.

## Endpoint

Base URL: `https://<domain-aplikasi>` (mode SSL satu domain; web meneruskan `/api` ke API) — atau `http://<ip>:3000` tanpa SSL.

| Path | Isi | Filter `since` |
|---|---|---|
| `GET /api/export` | Daftar resource dan parameter | – |
| `GET /api/export/customers` | Pelanggan: kode, kontak, alamat, paket, status, ODP/port/VLAN/IP, `activatedAt`, `warehouseCode` | `createdAt` |
| `GET /api/export/work-orders` | WO + `customerCode/Name`, pembuat, teknisi, `data` (JSON isian form). `?include=events` menambah riwayat transisi | `updatedAt` |
| `GET /api/export/items` | Master barang: SKU, kategori, satuan, `tracked`, `minStock` | – |
| `GET /api/export/warehouses` | Gudang (pusat/cabang/mobile) | – |
| `GET /api/export/stock` | Stok kuantitas per gudang per barang (`qty`, `minStock`) | – |
| `GET /api/export/assets` | Aset ber-SN: merk, tipe, status, lokasi, pelanggan, jadwal maintenance | `createdAt` |
| `GET /api/export/movements` | Riwayat mutasi stok/aset | `createdAt` |
| `GET /api/export/purchase-orders` | PO + baris barang | `createdAt` |

## Parameter query

| Parameter | Default | Keterangan |
|---|---|---|
| `format` | `json` | `json` atau `csv` (UTF-8 + BOM, langsung bisa dibuka di Excel; kolom bersarang diratakan `a.b`, array jadi string JSON) |
| `limit` | `1000` | 1–5000 baris per halaman |
| `cursor` | – | Nilai `nextCursor` dari respons sebelumnya |
| `since` | – | Tanggal ISO (`2026-10-01` atau `2026-10-01T00:00:00Z`); hanya baris dengan kolom waktu ≥ nilai ini (lihat tabel). Dipakai untuk sinkronisasi inkremental |
| `include` | – | Khusus `work-orders`: `events` |

## Paginasi

Respons JSON:

```json
{
  "resource": "customers",
  "count": 2,
  "nextCursor": "cmuyz7dxz0011jj7d5kaxbsql",
  "generatedAt": "2026-10-08T04:53:56.138Z",
  "data": [ { "id": "…", "code": "CUST-001", "name": "…" } ]
}
```

Ulangi permintaan dengan `cursor=<nextCursor>` sampai `nextCursor` bernilai `null`. Untuk `format=csv` cursor ada di header respons `X-Next-Cursor` (kosong = halaman terakhir). Urutan data stabil (berdasarkan `id`).

## Contoh

```bash
KEY=xxxx; API=https://wo.contoh.co.id

# 1) Semua pelanggan ke CSV (satu halaman)
curl -H "x-api-key: $KEY" "$API/api/export/customers?format=csv&limit=5000" -o customers.csv

# 2) WO yang berubah sejak kemarin, lengkap dengan riwayat
curl -H "x-api-key: $KEY" "$API/api/export/work-orders?since=2026-10-07&include=events"

# 3) Tarik semua halaman (bash + jq)
cursor=""; while :; do
  r=$(curl -s -H "x-api-key: $KEY" "$API/api/export/assets?limit=1000${cursor:+&cursor=$cursor}")
  echo "$r" | jq -c '.data[]' >> assets.ndjson
  cursor=$(echo "$r" | jq -r '.nextCursor // empty'); [ -z "$cursor" ] && break
done
```

Excel: *Data → From Web*, isi URL dengan `format=csv`, tambahkan header `x-api-key` di *Advanced*.

## Kesalahan

| Kode | Arti |
|---|---|
| `400` | Parameter tidak valid (pesan menyebut kolomnya) |
| `401` | API key salah/tidak ada |
| `404` | Resource tidak dikenal |
| `429` | Terlalu banyak request |
| `503` | `EXPORT_API_KEY` belum diisi di server |

Sel CSV yang diawali `= + - @` diberi awalan `'` untuk mencegah formula injection di Excel.

---

## Pembaruan (UAT v2, 2026-10-10)

Daftar ini juga tampil langsung di aplikasi: **Sidebar → Sistem → API Sistem** (Admin), lengkap dengan tombol *Ambil contoh* (respons nyata, 1 data). Dokumen ini diperbarui setiap ada perubahan endpoint.

### Integrasi Billing (dua arah, kunci `BILLING_API_KEY`)
| Endpoint | Arah | Fungsi |
|---|---|---|
| `POST /api/integrations/billing/events` | Billing → Maung | Membuat WO otomatis. Body: `{"event":"suspend\|unsuspend\|terminate","customerCode":"…","reason":"…","invoiceRef":"…"}`. Header `x-api-key`. Idempoten (WO terbuka yang sama → `{"duplicate":true}`) |
| `GET /api/integrations/billing/customers/{kode}` | Billing → Maung | Status layanan pelanggan (`status`, `activatedAt`, `packageName`) |

```bash
curl -X POST https://<domain-aplikasi>/api/integrations/billing/events \
  -H "x-api-key: <BILLING_API_KEY>" -H "content-type: application/json" \
  -d '{"event":"suspend","customerCode":"260705044930","reason":"Tunggakan 2 bulan","invoiceRef":"INV-2610-045"}'
```

### Publik (tanpa kunci)
| Endpoint | Fungsi |
|---|---|
| `GET /api/public/asset/{SN}` | Info aset untuk halaman label QR (`/a/{SN}`): nama barang, merk/tipe, status, lokasi gudang, kalimat info & tombol kontak yang diatur Admin. **Tidak** memuat data pelanggan. Dibatasi 60 permintaan/menit/IP |

### Keluar dari Maung (konfigurasi di Admin → Pengaturan)
- **WhatsApp** (gateway pihak ketiga, berbiaya per pesan; sakelar ON/OFF, bawaan MATI): penyedia *Fonnte* (`POST {baseUrl}/send`, header `Authorization: <token>`, form `target`, `message`, `countryCode=62`) atau *gateway umum* (URL + nama header + templat body JSON memuat `{{to}}` dan `{{message}}`).
- **Telegram Bot API** dan **SMTP**: lihat `docs/NOTIFIKASI.md`.
- **MSRadius** (baca-saja): lihat `docs/RADIUS-API.md`.

### Khusus Admin (memerlukan login Admin, bukan untuk aplikasi lain)
`GET /api/admin/reports` dan `GET /api/admin/reports/{key}?from=YYYY-MM-DD&to=YYYY-MM-DD` (menu *Sistem → Laporan*), `GET /api/admin/system-api`, `GET /api/admin/radius/endpoints`.


## Tambahan UAT v2.1
| Endpoint | Peran | Keterangan |
|---|---|---|
| `GET /api/img?u=/uploads/x.png&w=400&trim=1` | publik | Versi webp terkompresi (cache); berkas asli tidak diubah |
| `GET /api/auth/introspect` | token | Identitas & peran dari token (untuk aplikasi lain) |
| `GET /api/admin/trouble-history?customerId=` | Admin | Riwayat TROUBLE + MAINTENANCE satu pelanggan beserta laporan |
| `GET/POST /api/team`, `PATCH /api/team/:id` | Manager divisi | Kelola supervisor/staf divisinya |
| `PUT /api/admin/settings/app` | Admin | `requireGps`, `optimizeImages`, `publicUrl` |
| `GET /api/admin/kanca/overview` | Admin | Konfigurasi Kanca + info, wallet, template, 20 pesan terbaru (tiap bagian dengan status sendiri) |
| `GET /api/admin/kanca/broadcast/:id` | Admin | Status broadcast Kanca (id atau nama) |
| `PUT /api/admin/kanca/template` | Admin | Pilih template notifikasi |
