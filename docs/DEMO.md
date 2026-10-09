# Data demo & skenario uji per user

Membuat data contoh untuk **semua proses** (6 alur WO di setiap tahapnya) dengan menjalankan engine sebenarnya, sehingga status, stok, aset, dan riwayat konsisten.

```bash
# setelah deploy (seed dasar sudah jalan):
docker compose exec api node dist/prisma/seed-demo.js
# atau saat deploy:  DEMO=1 bash scripts/deploy.sh
```
- Dijalankan **sekali**; panggilan kedua berhenti dengan pesan "sudah pernah dibuat".
- Notifikasi yang terbentuk **tidak dikirim** (status `SKIPPED` di Log notifikasi), jadi aman walau SMTP/Telegram sudah aktif.
- Jangan dipakai di produksi sungguhan. Untuk mengulang dari nol: `docker compose down -v` (menghapus semua data) lalu deploy lagi.
- Foto demo berupa gambar placeholder bertanda GPS/"LOGO"; foto asli dibuat dari aplikasi.

## Akun
Semua akun `*@l1v.local` (peran Procurement sudah digabung ke GA; pada database lama akun `proc@l1v.local` otomatis menjadi peran GA), password = nilai `SEED_PASSWORD` di `.env` (default `Passw0rd!`; `deploy.sh` membuat acak dan menampilkannya di akhir).

| Login | Peran | Yang bisa dicoba |
|---|---|---|
| `admin@l1v.local` | Admin | Melihat semuanya; **Admin → Pengaturan** (logo PT, SMTP, Telegram); Log notifikasi |
| `mkt@l1v.local` | Marketing | *Hendra Gunawan*: Kirim BA Digital · *Apotek Murni*: konfirmasi ke pelanggan (Trouble) · buat WO Pasang Baru/Trouble/Suspend/Terminate |
| `noc@l1v.local` | NOC | Aktivasi (VLAN/IP/Ping-Latency/jitter): *Maya Putri* · Diagnosa: *Toko Maju Jaya* · Verifikasi: *Bengkel Sinar* · Isolir: *Kos Putri Asri* · Pulihkan: *Laundry Bersih* · Deaktivasi: *CV Karya Utama* |
| `citra@l1v.local` | FOC **Manager** | **Validasi teknis awal** (ODP/Port/POP): *Budi Santoso* · Menjadwalkan tim (≥1 teknisi) · membuat WO **Maintenance/Troubleshoot** mandiri · Menjadwalkan teknisi (WO Pasang Baru *Siti Rahma*, Trouble, Penarikan); membuat Purchase Request |
| `budi@l1v.local` | FOC **Supervisor** | Mulai & ambil material: *Dewi Lestari* · Progres + laporan instalasi: *Rudi Hartono* (sudah ada 1 foto progres) · Trouble terjadwal: *Kafe Senja* · Penarikan terjadwal: *Rumah Makan Padang* · jadwalkan: *Siti Rahma* |
| `andi@l1v.local` | FOC **Staff** (tidak bisa menjadwalkan) | **Stok Saya**: minta material / kembalikan sisa (ada 1 serah-terima menunggu GA, 1 sebagian) ·  Laporan perbaikan: *Klinik Sehat* · Laporan penarikan: *Studio Foto Lensa* · jadwalkan Trouble: *Warnet Bintang* |
| `ga@l1v.local` | GA / Procurement (satu peran) | Review 2 Permintaan Barang (mutasi atau terbitkan PO) · *Agus Wijaya* menunggu stok (WO anak otomatis) · terima barang PO (menu Purchase Order) · QC aset hasil penarikan: *Kantor Notaris* · aset GA dengan jadwal maintenance (3, 10, 45 hari dan 1 aset **terlambat**) · master merk/tipe · cetak QR massal |
| `fin@l1v.local` | Finance | Tutup akun: *Toko Buku Pelita* · buat Suspend/Unsuspend · Log notifikasi menampilkan pengingat invoice |

Data lain yang terbentuk: 8 pelanggan baru berstatus beragam, 20+ WO selesai (agar persentase penyelesaian dan tren di dashboard terisi), WO tertunda > 7 hari, stok **habis** (Pigtail) dan **menipis** (Fast Connector, stok cabang A), 30 ONT tambahan ber-SN di Gudang Pusat, foto lapangan bertanda GPS.

## Menguji foto GPS teknisi
Login sebagai `budi@l1v.local` → buka WO *Rudi Hartono* → **Update progres lapangan** → ambil foto. Browser akan meminta izin lokasi; hasilnya foto dengan banner logo PT, koordinat, dan waktu, tampil di kartu **Foto lapangan** WO dengan tautan peta.

**GPS browser hanya aktif di HTTPS** (atau `localhost`). Di VM dengan alamat `http://172.x.x.x:3000` upload foto FOC akan ditolak; untuk uji coba matikan sementara **Admin → Pengaturan → "Wajibkan GPS pada foto teknisi"**, atau jalankan mode Caddy/HTTPS.

**Pengadaan (login `ga@l1v.local`):** menu *Purchase Request* — ada draft (budi), diajukan (citra), diterbitkan (GA, bisa dicatat keputusan), ditolak (noc), dan satu PR disetujui yang POnya (`PO-ACC-2610-017`) siap diterima di *Purchase Order*. Master vendor di *Master Data → Vendor*. Cetak PDF berkop: buka PR → **Cetak PDF**.
**Admin sebagai peran lain:** menu akun (kanan atas) → *Bertindak sebagai* → pilih peran & sub-role → Terapkan (banner kuning; "Kembali sebagai Admin").

**Formulir Berlangganan (login `mkt@l1v.local`):** menu *Form Berlangganan* — 3 contoh (`SM026…`, termasuk satu dengan isian minimal). Reg. No. = awalan `SM` + 3 digit tahun otomatis (2026 → `026`, 2027 → `027`) + nomor isian. Pembayaran bawaan Transfer, Manager Marketing bawaan *M Gugi Granada* (ubah di Admin → Pengaturan → Formulir Berlangganan). Cetak: buka formulir → **Cetak / PDF** (Simpan sebagai PDF, A4, margin Tidak ada).
**Area:** Master Data → Area (area dari MSRadius muncul setelah sinkron; hubungkan tiap area ke gudangnya).

## Alur & fitur terbaru (UAT 2026-10-09)
- **Pasang Baru**: validasi teknis awal oleh **FOC supervisor/manager** (ODP, Port, POP) → cek stok → jadwal tim → instalasi (laporan: ODP/Port/POP aktual, Main splitter, Koordinat, Signal, Redaman, foto) → **Aktivasi NOC** (VLAN, IP internal, IP publik, Ping/Latency, Jitter) → BA Digital (khusus Marketing).
- **Tim pelaksana**: supervisor/manager menugaskan 1 atau lebih teknisi (supervisor tidak dapat menugaskan manager). Salah satu anggota tim yang mengirim laporan. **Ganti tim** hanya bisa setelah ada laporan progres lapangan. Supervisor/manager tetap melihat WO di *Tugas saya* sampai WO keluar dari tahap FOC.
- **Laporan PDF berkop**: tombol *Laporan Instalasi (PDF)* / *Laporan Troubleshooting (PDF)* di WO setelah laporan dikirim — nomor `FOC/INS-{ALIAS}/…`, `FOC/TBS-{ALIAS}/…`; BA `BAA/{ALIAS}/…`; PR `…/L1V/PNJ-{ALIAS}/…`. Singkatan area diatur di Master Data → Area.
- **Maintenance/Troubleshoot mandiri**: *Work Order → Buat WO → Maintenance / Troubleshoot* (supervisor/manager FOC).
- **Purchase Request**: pengaju non-GA hanya mengisi item; **GA** mengisi perbandingan harga + PPN dan dapat langsung *Simpan & terbitkan PR* tanpa diajukan.
- **Label QR** berisi tautan `/a/{SN}` (halaman info aset publik, tanpa login). Pindai di aplikasi mengambil nomor seri saja. Kamera langsung butuh HTTPS; di HTTP pakai tombol *Foto barcode* atau scanner USB/Bluetooth (mengetik ke kolom SN).
- **Admin**: sidebar *API MSRadius* (contoh respons nyata), sakelar email aktif/nonaktif, nama aplikasi untuk email.
