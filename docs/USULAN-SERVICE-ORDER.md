# Usulan Tahap 2 — Order Jasa/Produk (SERVICE_ORDER) dari Quotation CRM

Status: **USULAN, belum ada kode — menunggu persetujuan pemilik.**
Dasar: `docs/PERMINTAAN-PERUBAHAN-WO.md` (repo CRM) bagian B–D, keputusan pemilik 2026-10-12, dan mesin WO yang ada (`workflows.ts`: `newInstall`, `stockRequest`, `maintenance`; PR di `PurchaseRequest`).

## Keputusan pemilik yang menjadi dasar
1. Semua permintaan dipicu dari **Marketing**.
2. **BA (Berita Acara) tetap wajib.**
3. Hanya untuk **jasa non-internet**: tiap order punya pilihan sumber barang —
   **(a) Pakai stok** (mis. WiFi/router dari stok berjalan/gudang), atau
   **(b) Buat PR baru sebagai proyek** sesuai isi quotation.
   Jasa murni (tanpa barang) juga mungkin → **(c) Tanpa barang**.
4. Harga ikut dikirim ke WO, tetapi **tidak** masuk Export API.
5. Order jasa **tidak** membuat/ mengubah data internet pelanggan (status, paket MSRadius).

## Alur usulan

```
 CRM: quotation ACCEPTED  ──(PUT quotations/:crmId, status WON)──▶  WO SERVICE_ORDER dibuat sistem
                                                                      │
                                    SO_NEW (MKT)  ◀───────────────────┘
                            MKT memeriksa & memilih sumber barang per baris
                     ┌──────────────┬────────────────────┬──────────────────┐
                     ▼ (a) STOK     ▼ (b) PROYEK/PR      ▼ (c) TANPA BARANG │
              SO_STOCK_CHECK     SO_PR_PENDING (GA)                         │
              cukup │ kurang     PR dibuat otomatis,                         │
                    │   ▼        GA/Procurement proses                       │
                    │ STOCK_REQUEST (anak, GA)  PR→PO→barang diterima        │
                    │   ▼                         ▼                          │
                    └──▶ SO_SCHEDULING (FOC supervisor/manager) ◀────────────┘
                              tugaskan teknisi + jadwal
                                          ▼
                              SO_IN_PROGRESS (FOC)
                  ambil material (mode a/b) → kerjakan → laporan: foto, material,
                  SN perangkat yang dipasang/diserahkan, catatan
                                          ▼
                              SO_AWAITING_BA (MKT)
                  kirim BA Digital ke pelanggan (Email/WA/Telegram) + pengingat invoice ke FIN
                                          ▼
                                       SO_DONE
        (batal kapan pun sebelum BA: SO_CANCELLED oleh MKT/Lead, alasan wajib, stok/ PR dikembalikan)
```

### Rincian tiap tahap
| Tahap | Pemilik | Isi & aturan |
|---|---|---|
| `SO_NEW` | MKT | Dibuat sistem dari quotation (pembuat tercatat = marketing di quotation bila akun cocok, selain itu akun sistem). MKT menentukan **sumber barang per baris** (STOK / PROYEK / TANPA BARANG) dan memetakan baris produk ke **barang di Master Barang** bila mode STOK. Baris jasa murni otomatis TANPA BARANG. Aksi: `Konfirmasi`, `Batalkan`. |
| `SO_STOCK_CHECK` (otomatis) | – | Memakai pengecekan stok yang sama dengan Pasang Baru. Cukup → `SO_SCHEDULING`. Kurang → membuat **WO Permintaan Barang** (anak) ke GA, status `SO_STOCK_PENDING` sampai stok masuk (pola yang sudah ada). |
| `SO_PR_PENDING` | GA | Sistem membuat **PR draf** (`woId` = WO ini, baris dari quotation: deskripsi, qty, satuan). GA/Procurement melanjutkan alur PR yang sudah ada (terbit → setuju → PO → penerimaan). Aksi `Barang sudah diterima` memindahkan ke `SO_SCHEDULING`. PR yang ditolak/batal → WO kembali ke `SO_NEW` dengan catatan. |
| `SO_SCHEDULING` | FOC (supervisor/manager) | Pilih tim teknisi + jadwal (pola `scheduleAction`/`resolveTeam` Maintenance). |
| `SO_IN_PROGRESS` | FOC | Mulai (ambil material ke Stok Berjalan untuk mode STOK/PROYEK), lalu **laporan**: foto wajib, material terpakai, SN perangkat terpasang, catatan, tanda tangan/ketersediaan pelanggan. Perangkat ber-SN yang diserahkan/ disewakan ditautkan ke **pelanggan** (aset `customerId`) agar tercatat di Aset. |
| `SO_AWAITING_BA` | MKT | **BA Digital wajib**: nomor BA dari `baNumber` (pola yang sama), isi memuat nomor quotation, ringkasan baris, tanggal selesai. Kirim lewat Email/WhatsApp/Telegram; lalu pengingat ke FIN untuk menagih sesuai quotation. |
| `SO_DONE` / `SO_CANCELLED` | – | Final. Selesai → CRM diberi tahu (lihat Pemberitahuan balik). |

### Pemberitahuan balik ke CRM (opsional, kecil)
Respons idempoten `quotations/:crmId` sudah memuat `woNumber`. Untuk status lanjutan, CRM cukup membaca Export API `work-orders?type=SERVICE_ORDER` (sudah tersedia di Tahap 1) — WO memuat `data.crmQuotation.number` sehingga CRM dapat mencocokkan dan menampilkan progres tanpa endpoint tambahan.

## Perubahan teknis (ringkasan)
- **Enum** `WoType` + `SERVICE_ORDER` (migrasi `ALTER TYPE … ADD VALUE`), prefix `WO-SO`, label "Order Jasa/Produk".
- **`Package`**: `kind` (INTERNET bawaan | SERVICE | PRODUCT), `unit`, `crmId` unik nullable; sumber `CRM` hanya-baca di UI Master Paket (guard sinkron sudah ada sejak Tahap 1).
- **Tabel baru** `CrmQuotation` (nomor, `crmId`, `rev`, status QUOTED/WON/LOST, total, baris sebagai JSON, `woId`, `prId`). Idempoten menurut `crmId`; `rev` lebih kecil → abaikan.
- **Endpoint** (kunci terpisah `CRM_INTEGRATION_KEY`, diisi pemilik di `.env`, tidak pernah lewat chat; batas laju; audit sumber "CRM"): `PUT /api/integrations/crm/catalog/:crmId` dan `PUT /api/integrations/crm/quotations/:crmId`.
- **Mesin WO**: workflow `serviceOrder` di `workflows.ts` memakai ulang `scheduleAction`, `resolveTeam`, `pickup`, `consume`, `installAvailability`, pembuatan WO anak `STOCK_REQUEST`, dan kirim BA. Tidak ada mesin baru.
- **Hak akses**: fitur `wo.create.SERVICE_ORDER` mengikuti pola yang ada (pembuat sistem; tampil bagi MKT). UI: form detail WO sudah data-driven; tambahan kecil untuk panel quotation dan pemilih sumber barang.
- **Pelanggan existing**: bila `customer.code` terisi → tautkan WO ke pelanggan itu tanpa mengubah `status`/`packageName`/data MSRadius; kode tidak ada → 404. Pelanggan baru → buat pelanggan `source='CRM'` (status PROSPECT, `packageName` = nama jasa utama).
- **Tes**: `node:test` untuk intake idempoten (`rev`), pemetaan status, guard pelanggan existing, cabang STOK/PROYEK/TANPA BARANG, dan skenario BA.

## Usulan urutan kerja
- **2a** — intake: kunci, katalog (`Package.kind/unit/crmId`), `CrmQuotation`, endpoint, pelanggan CRM. Belum membuat WO. Aman diuji CRM lebih dulu.
- **2b** — workflow `SERVICE_ORDER` lengkap + UI. Dikerjakan setelah alur di bawah disetujui.

## Yang perlu diputuskan pemilik (jawaban singkat cukup)
1. **Siapa MKT yang memegang `SO_NEW`?** Usulan: marketing yang tercantum di quotation bila akun cocok; jika tidak, antrean seluruh MKT (supervisor/manager menugaskan).
2. **Pemetaan baris produk → Master Barang** (mode STOK): dipilih manual oleh MKT per order (usulan), atau katalog CRM memuat kolom `sku` barang WO sehingga otomatis?
3. **PR proyek**: apakah satu quotation = **satu PR** berisi semua baris barang (usulan), dan siapa penyetuju PR proyek — alur PR yang ada (Procurement → persetujuan) tanpa perubahan?
4. **Campuran**: boleh satu order berisi baris STOK dan baris PROYEK sekaligus (usulan: boleh; WO lanjut ke jadwal setelah **semua** baris siap)?
5. **Perangkat sewa/hak milik**: perangkat ber-SN yang diserahkan ditautkan ke pelanggan di Aset (usulan), dan status asetnya apa (mis. `INSTALLED`/`DEPLOYED` — mengikuti yang ada)?
6. **BA**: format sama dengan BA internet (usulan) atau perlu template khusus jasa (mis. memuat daftar barang & garansi)?
7. **Pembatalan setelah barang dibeli (mode PROYEK)**: barang masuk stok gudang biasa (usulan), PR tidak dibatalkan otomatis bila sudah menjadi PO.
