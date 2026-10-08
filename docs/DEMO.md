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
| `noc@l1v.local` | NOC | Validasi: *Budi Santoso* · Aktivasi: *Maya Putri* · Diagnosa: *Toko Maju Jaya* · Verifikasi: *Bengkel Sinar* · Isolir: *Kos Putri Asri* · Pulihkan: *Laundry Bersih* · Deaktivasi: *CV Karya Utama* |
| `budi@l1v.local` | FOC (Teknisi) | Mulai & ambil material: *Dewi Lestari* · Progres + laporan instalasi: *Rudi Hartono* (sudah ada 1 foto progres) · Trouble terjadwal: *Kafe Senja* · Penarikan terjadwal: *Rumah Makan Padang* · jadwalkan: *Siti Rahma* |
| `andi@l1v.local` | FOC (Teknisi) | Laporan perbaikan: *Klinik Sehat* · Laporan penarikan: *Studio Foto Lensa* · jadwalkan Trouble: *Warnet Bintang* |
| `ga@l1v.local` | GA / Procurement (satu peran) | Review 2 Permintaan Barang (mutasi atau terbitkan PO) · *Agus Wijaya* menunggu stok (WO anak otomatis) · terima barang PO (menu Purchase Order) · QC aset hasil penarikan: *Kantor Notaris* · aset GA dengan jadwal maintenance (3, 10, 45 hari dan 1 aset **terlambat**) · master merk/tipe · cetak QR massal |
| `fin@l1v.local` | Finance | Tutup akun: *Toko Buku Pelita* · buat Suspend/Unsuspend · Log notifikasi menampilkan pengingat invoice |

Data lain yang terbentuk: 8 pelanggan baru berstatus beragam, 20+ WO selesai (agar persentase penyelesaian dan tren di dashboard terisi), WO tertunda > 7 hari, stok **habis** (Pigtail) dan **menipis** (Fast Connector, stok cabang A), 30 ONT tambahan ber-SN di Gudang Pusat, foto lapangan bertanda GPS.

## Menguji foto GPS teknisi
Login sebagai `budi@l1v.local` → buka WO *Rudi Hartono* → **Update progres lapangan** → ambil foto. Browser akan meminta izin lokasi; hasilnya foto dengan banner logo PT, koordinat, dan waktu, tampil di kartu **Foto lapangan** WO dengan tautan peta.

**GPS browser hanya aktif di HTTPS** (atau `localhost`). Di VM dengan alamat `http://172.x.x.x:3000` upload foto FOC akan ditolak; untuk uji coba matikan sementara **Admin → Pengaturan → "Wajibkan GPS pada foto teknisi"**, atau jalankan mode Caddy/HTTPS.
