# DRAF Panduan Pengguna — MAUNG by LIV (Work Order & Inventori)

> **Status: draf mentah** untuk pengguna awam, disusun dari fitur yang ada di aplikasi per 2026-10-17. Nama menu mengikuti tampilan aplikasi; menu yang terlihat tergantung divisi dan jabatan Anda.

## 1. Apa itu MAUNG?
MAUNG adalah aplikasi kerja bersama untuk semua divisi ISP. Setiap pekerjaan, seperti pasang baru, gangguan pelanggan, atau permintaan barang, dicatat sebagai **Work Order (WO)**. WO berpindah dari satu divisi ke divisi berikutnya sampai selesai. Setiap kali WO pindah tahap, divisi berikutnya langsung mendapat pemberitahuan lewat lonceng di aplikasi, email, Telegram, atau WhatsApp.

Aplikasi bisa dibuka dari komputer maupun HP di **https://maung.liv.net.id**. Teknisi di lapangan memakai kamera HP untuk scan nomor seri perangkat dan mengambil foto bertanda lokasi.

## 2. Siapa melakukan apa
| Divisi | Peran utama di aplikasi |
|---|---|
| **MKT** (Marketing) | Membuat WO Pasang Baru, mengisi Formulir Berlangganan, mengelola pelanggan & paket, mengirim BA digital ke pelanggan |
| **NOC** | Mengaktifkan layanan, menangani gangguan dari jarak jauh, isolir/buka isolir, memutus layanan |
| **FOC** (teknisi lapangan) | Validasi lokasi (ODP/port), memasang dan memperbaiki di lapangan, membawa stok sendiri ("Stok Saya"), mengirim laporan + foto |
| **GA** (General Affair & Pengadaan) | Gudang, barang, aset, cek kualitas (QC) perangkat bekas, Purchase Request & Purchase Order |
| **FIN** (Finance) | Mendapat pengingat untuk membuat invoice, menutup proses pemutusan layanan |
| **Admin** | Mengelola pengguna, hak akses, tampilan, notifikasi, backup |

Setiap divisi bisa memiliki jabatan **Manager, Supervisor, atau Staff**. Di FOC, penjadwalan teknisi dilakukan supervisor/manager.

## 3. Masuk ke aplikasi
1. Buka alamat aplikasi, lalu masuk dengan email dan password.
2. Bila Admin baru saja me-reset password Anda, aplikasi akan meminta Anda menggantinya dulu di halaman **Profil**.
3. Lupa password: pakai tautan **Lupa password** di halaman login. Tautan yang dikirim berlaku 30 menit.
4. Setelah masuk, halaman **Beranda** menampilkan ikon aplikasi (mis. WO dan CRM). Pilih WO untuk masuk ke aplikasi ini.

## 4. Mengenal tampilan
- **Menu kiri**: Dashboard, Work Order, Form Berlangganan, Stok Saya, Pelanggan, Tim Saya, Inventori & Aset, Purchase Request, Purchase Order, Master Data, Laporan. Menu hanya muncul bila Anda berhak memakainya. Menu bisa diciutkan.
- **Pencarian** di atas: cari WO, pelanggan, atau nomor seri dari satu kotak.
- **Lonceng**: pemberitahuan terbaru; klik salah satu untuk langsung membuka WO-nya. **Lihat semua notifikasi** membuka daftar lengkap.
- **Tema**: terang, gelap, atau mengikuti HP/komputer (ikon di kanan atas).
- **Dashboard**: ringkasan WO per tahap dan WO yang belum ditangani lebih dari 7 hari (ditandai merah), dirinci per divisi.

## 5. Alur pekerjaan sehari-hari

### Pasang baru
1. **MKT** membuat WO *Pasang Baru*: nama, telepon, alamat, paket, area. Bisa juga dibuat dari Formulir Berlangganan yang sudah diisi.
2. **FOC** memvalidasi lokasi dan mencatat ODP, port, dan POP. Bila tidak ada jaringan, WO ditolak.
3. **Aplikasi mengecek stok** perangkat dan kabel di gudang area pelanggan. Bila kurang, otomatis dibuat permintaan barang ke GA.
4. **Supervisor FOC** menjadwalkan teknisi. Teknisi menekan *Mulai & ambil material* sehingga barang pindah ke Stok Saya.
5. **Teknisi** mengirim laporan: scan nomor seri ONT/router, jumlah kabel dan material terpakai, dan foto. Foto otomatis diberi logo, nomor WO, lokasi GPS, dan waktu.
6. **NOC** mengaktifkan layanan (profil, VLAN, IP). Finance otomatis diingatkan untuk menyiapkan invoice.
7. **MKT** mengirim **BA digital** ke pelanggan, lalu WO selesai.

### Gangguan pelanggan (Trouble Ticket)
MKT atau NOC membuat tiket. NOC mencoba memperbaiki dari jarak jauh. Bila tidak berhasil, tiket diteruskan ke teknisi lapangan. Setelah teknisi selesai, NOC memeriksa dan MKT mengonfirmasi ke pelanggan.

### Isolir, buka isolir, dan putus layanan
- **Isolir / buka isolir**: dibuat MKT atau FIN, dikerjakan NOC.
- **Putus layanan (Terminate)**: NOC menonaktifkan layanan, teknisi menarik perangkat (scan nomor seri), GA memeriksa kondisi perangkat (bagus / rusak / dibuang), lalu Finance menutup prosesnya.

### Barang dan stok
- **Permintaan barang**: GA memenuhi lewat pindah gudang atau pembelian (PO).
- **Stok Saya** (teknisi): melihat barang yang sedang dibawa. Sisa material dikembalikan ke gudang lewat WO *Serah-terima sisa material*. GA bisa menerima semua, sebagian, atau menolak.
- **Maintenance**: supervisor/manager FOC dapat membuat pekerjaan perawatan sendiri tanpa tiket.
- **Order jasa dari CRM**: penawaran yang dimenangkan di CRM otomatis menjadi WO di sini (siapkan barang → jadwal → kerjakan → BA jasa).

## 6. Pelanggan
- **Tambah manual** atau **impor dari Excel** (unduh template dulu, periksa file, lalu impor). Baris yang bermasalah ditampilkan beserta alasannya dan dilewati.
- **Ekspor Excel** sesuai filter yang sedang dipakai.
- Data pelanggan dari **MSRadius** disinkronkan otomatis. Status online/offline ikut tampil, dan nama/telepon/alamat/paket dari MSRadius dikunci.
- Aplikasi menolak IP atau ODP+port yang sudah dipakai pelanggan lain.

## 7. Inventori, aset, dan pengadaan (GA)
- **Gudang**: gudang cabang dan gudang bergerak per teknisi.
- **Barang**: tiga jenis, yaitu habis pakai (meter/qty), perangkat jaringan (wajib nomor seri + QR), dan aset kantor (kode aset otomatis, jadwal perawatan).
- **Aset & SN**: registrasi aset, merk/tipe, **cetak QR massal** di kertas label A4. Scan QR pada label membuka info aset.
- **Stock opname**: menyesuaikan stok fisik (khusus manager GA/FIN). Selisihnya tercatat.
- **Purchase Request**: bandingkan minimal 2 vendor per barang, ajukan, terbitkan, setujui, lalu cetak PDF berkop. **Purchase Order** dicatat dari Accurate, lalu barang diterima dan diperiksa (QC).

## 8. Formulir Berlangganan (MKT)
Isi formulir digital pelanggan (nomor registrasi otomatis), lalu cetak atau simpan sebagai PDF. Formulir bisa langsung dijadikan WO Pasang Baru.

## 9. Untuk Admin
Panel **Admin** berisi:
- **Pengguna & Hak Akses**: tambah/ubah pengguna, reset password (satuan atau massal). Hak akses diatur per divisi dan jabatan.
- **Pemberitahuan**: atur email (SMTP), Telegram (bot + grup per divisi), dan WhatsApp, masing-masing dengan tombol tes. Admin juga bisa melihat log notifikasi.
- **Tampilan & brand**: logo, warna, teks login, kop dokumen, tanda tangan.
- **Aplikasi (Beranda)**: ikon aplikasi yang tampil di Beranda.
- **SSL & Domain**: lihat dan ganti domain serta sertifikat.
- **Log audit**: siapa mengubah atau menghapus apa.
- **Data & Backup**: backup otomatis setiap malam, unduh/pulihkan backup.
- **Bertindak sebagai**: Admin bisa mencoba aplikasi dari sudut pandang divisi lain. Selama mode ini aktif, muncul banner kuning.

Sebagai tambahan, server menyalin backup otomatis setiap malam ke NAS kantor (UGREEN). Pengguna tidak perlu melakukan apa pun untuk ini.

## 10. Tips & pertanyaan umum
- **Foto ditolak karena tidak ada GPS**: izinkan akses lokasi di browser HP dan pastikan alamat aplikasi diawali `https://`.
- **Kamera tidak mau scan**: izinkan akses kamera. Nomor seri juga bisa diketik manual, lalu tekan **Tambah**.
- **Menu tidak muncul**: menu tersebut tidak termasuk hak akses divisi/jabatan Anda. Hubungi Admin.
- **Tidak menerima Telegram**: tautkan akun di **Profil** dengan mengirim `/link KODE` ke bot.
- **Barang tidak bisa dilaporkan**: hanya material yang diambil saat *Mulai & ambil material* yang bisa dilaporkan, dan jumlahnya tidak boleh melebihi yang diambil.

---
*Belum tercakup dalam draf ini (usulan): tangkapan layar per langkah, panduan per divisi dalam halaman terpisah, dan daftar istilah.*
