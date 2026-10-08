# Panduan fitur: master data, edit/hapus, impor Excel, QR massal

## Peran
Tujuh peran → enam peran: **ADMIN, MKT, NOC, FOC, GA (GA + Procurement digabung), FIN**. Pada database lama peran `PROC` otomatis menjadi `GA` oleh migrasi; chat grup Telegram "PROC" dipakai untuk GA bila GA belum diisi.

## 1. Reset password user (Admin)
*Admin → User*: tombol **Reset PW** per baris, atau centang beberapa user → **Reset password terpilih**.
- Password **acak per user** (ditampilkan **sekali** ke Admin, bisa diunduh CSV) atau **satu password sama**.
- Opsi: *wajib ganti saat login berikutnya* (user dialihkan ke Profil dan tidak bisa membuka menu lain sebelum mengganti), *kirim notifikasi* (email + Telegram), dan *sertakan password sementara di pesan* (default **mati** — kurang aman).
- Tercatat di *Log audit*.

## 2. Cetak massal QR (A4)
*Inventori → Aset & SN* → centang aset (atau **Pilih semua yang tampil**) → **Cetak QR terpilih**. Juga muncul setelah registrasi aset dan di halaman PO setelah penerimaan.
- Pilih ukuran label: 3×8 (24/lembar), 3×7 (21, label standar 63,5×38,1), 4×10 (40), 5×13 (65), 2×4 (8, besar).
- **Salinan per aset**, **Mulai dari label ke-N** (melanjutkan lembar stiker yang sebagian terpakai), garis potong, dan isi label (nama item, merk/tipe, kode aset, nama PT).
- Cetak dengan kertas A4, skala 100%, margin None. QR berisi serial number.

## 3. Edit & 10. Hapus
| Data | Edit | Hapus | Syarat hapus |
|---|---|---|---|
| Pelanggan | MKT, NOC (status: NOC/Admin) | MKT, Admin | tanpa WO & tanpa aset terpasang |
| Paket/jasa | MKT, NOC, Admin | MKT, NOC, Admin | tidak dipakai pelanggan (jika dipakai: nonaktifkan) |
| Item | GA, Admin | GA, Admin | tanpa aset, stok, baris PO |
| Gudang | GA, Admin | GA, Admin | kosong dan tanpa pelanggan (Mobile tidak dihapus) |
| Aset | GA, Admin | GA, Admin | tidak sedang terpasang di pelanggan |
| Merk/tipe | GA, Admin | GA, Admin | tidak dipakai aset |
| PO | GA, Admin (status ISSUED) | GA, Admin | belum ada penerimaan, WO terkait tidak berjalan |
| User | Admin | Admin | tidak terkait WO (jika terkait: nonaktifkan) |
| WO | judul & catatan: pembuat/Admin | Admin | tanpa WO/PO turunan |

- Setiap **edit** menyimpan nilai sebelum/sesudah, setiap **hapus** menyimpan salinan data, keduanya di *Admin → Log audit*.
- Penghapusan oleh peran selain Admin otomatis mengirim **notifikasi ke Admin** (email + Telegram pribadi + grup Telegram Admin bila diisi).

## 5. Merk & tipe aset
*Master Data → Merk & tipe aset* (GA/Admin) atau langsung dari form Registrasi aset (**+ Merk**, **+ Tipe**). Tampil di daftar aset, label QR, Export API, dan dapat diubah lewat Edit aset. Pada penerimaan PO, merk/tipe dapat diisi per baris barang.

## 6. Impor pelanggan dari Excel (sementara sebelum API MSRadius)
*Pelanggan → Impor Excel*:
1. **Unduh template** (.xlsx) — kolom: Kode, Nama, Telepon, Email, Alamat, Latitude, Longitude, Paket, Status, Gudang, ODP, Port, VLAN, IP, Aktif Sejak. Header Indonesia atau Inggris diterima (mis. *No HP*, *Cabang*, *Layanan*).
2. Isi/tempel data pelanggan lama; **Periksa file** menampilkan pratinjau, jumlah baru/diperbarui, paket baru, dan **error per baris** (IP/port dobel, gudang tidak ada, telepon kosong, …).
3. **Impor**: baris valid disimpan, baris error dilewati. Aman diulang: kode yang sama (atau Nama+Telepon yang sama) **memperbarui**, bukan menggandakan. Paket yang belum ada otomatis masuk Master Paket. Maks 5000 baris/file; .csv juga diterima.
Juga ada **Ekspor Excel** (sesuai filter) dengan kolom yang sama, sehingga bisa diedit lalu diimpor kembali.

## 7. WO belum tertangani > 7 hari
Dashboard: KPI merah, panel dengan rincian **per divisi penanggung jawab**, dan tautan *Lihat semua* ke daftar WO terfilter (`/work-orders?overdue=7`).

## 8. Pelanggan ketik manual
*Pelanggan → + Tambah pelanggan*: tanpa WO dan tanpa menarik data; kode otomatis (atau isi kode sendiri), status awal ACTIVE. IP dan ODP+Port dicek agar tidak dobel.

## 9. Master paket/jasa
*Master Data → Paket / jasa* (MKT, NOC, Admin): tambah, ubah nama (ikut memperbarui pelanggan), urutan, nonaktifkan, hapus. Menjadi pilihan di WO Pasang Baru dan form pelanggan.

## Notifikasi dalam aplikasi (lonceng)
- Klik lonceng membuka **kotak notifikasi** (8 terbaru; yang belum dibaca bergaris emas dan tebal) — tidak langsung pindah halaman. Klik satu notifikasi untuk membuka WO terkait (otomatis ditandai dibaca). Hover lonceng menampilkan jumlah yang belum dibaca.
- Tombol **Lihat semua notifikasi** membuka halaman `/notifications` (paginasi, cari, filter belum dibaca, "Tandai semua dibaca"). Tombol **WO saya** membuka daftar tugas Anda.
- Setiap notifikasi tahap WO tersimpan per pengguna di tabel `Inbox` (terpisah dari email/Telegram; tetap muncul walau pengiriman gagal). Disegarkan tiap 60 detik dan saat tab kembali aktif; dibersihkan otomatis setelah 90 hari. Notifikasi sebelum fitur ini tidak ikut (hanya yang baru).
- Pilihan tema di top bar kini tiga ikon yang langsung terlihat (terang / ikuti sistem / gelap) dengan tooltip saat hover dan sorotan pada pilihan aktif; di layar kecil menjadi satu tombol siklus.
