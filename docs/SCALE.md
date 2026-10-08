# Skala data (Tahap 2)

Tujuan: waktu respons dan memori tidak ikut membengkak saat data tumbuh ke ratusan ribu baris.

## Hasil ukur
Data uji lokal (tidak ikut di repo): **100 ribu pelanggan, 150 ribu aset, 300 ribu WO, 200 ribu notifikasi** pada Postgres 16 biasa (satu mesin, tanpa tuning). Latensi terbaik dari 3 percobaan setelah pemanasan.

| Endpoint | Sebelum | Sesudah |
|---|---:|---:|
| Dashboard (Admin) | **29.220 ms** | **≈ 50 ms** |
| Dashboard (NOC) | 29.361 ms | ≈ 45 ms |
| Pelanggan, pencarian nama | 102 ms | 7 ms |
| Pelanggan, pencarian IP | 90 ms | 5 ms |
| Pelanggan, halaman 2 urut nama | (tidak berpaginasi, 37 KB) | 55 ms (9 KB) |
| Pelanggan, halaman 3000 | (tidak ada) | 145 ms |
| WO, semua terbuka | 50 ms (101 KB, mentok 200 baris) | 16 ms |
| WO, halaman 1 semua urut nomor | 84 ms | 26 ms (15 KB) |
| WO, pencarian "massal 4000" | 198 ms | 18 ms |
| Aset, pencarian SN | 101 ms | 18 ms |
| Notifikasi admin, halaman 5 | (tidak ada) | 19 ms |
| Ekspor Excel 100 ribu pelanggan | 15.837 ms (semua di memori) | 5.997 ms (dialirkan per batch) |

Di UI: halaman Pelanggan terbuka dalam ±240 ms dan Dashboard ±290 ms pada data sebesar itu.

## Yang diubah
1. **Paginasi, urut, dan pencarian di server** untuk Pelanggan, Work Order, Aset, Purchase Order, Log notifikasi, dan Log audit. Panggil dengan `?page=1&pageSize=25&sort=name&dir=asc&q=…`; respons `{ rows, total, page, pageSize, pageCount }`. Tanpa `page` respons tetap array lama (untuk pemanggil lama), dibatasi 100–200 baris.
2. **Dashboard memakai agregasi SQL** (`GROUP BY`, `COUNT FILTER`, `generate_series`), bukan memuat ribuan WO dan menghitung di memori, dan bukan satu query per item stok. Filter "tugas saya" sekarang dikerjakan di database memakai pemetaan status→divisi dari definisi workflow.
3. **Indeks**: pencarian teks `ILIKE %kata%` memakai indeks **pg_trgm** (nama/kode/telepon/IP pelanggan, SN/kode aset, nomor/judul WO) dan indeks tanggal/status untuk urutan dan filter (`createdAt`, `closedAt+createdAt`, `itemId+status`). Pencarian nama item/merk/pelanggan pada aset dan WO diselesaikan lewat tabel kecil dulu, lalu `IN (...)`.
4. **Ekspor Excel dialirkan** per 2.000 baris (cursor) sehingga memori tetap kecil.
5. **Komponen `DataTable`** (web) yang seragam: pencarian ber-debounce, urut per kolom, ukuran halaman 10/25/50/100 (diingat per browser), lompat halaman, pilihan lintas halaman (mis. cetak QR massal hingga 5.000 aset), dan respons lama diabaikan bila filter berubah cepat.
6. Perbaikan perilaku: daftar "Tugas saya" untuk FOC kini hanya menampilkan WO yang ditugaskan padanya atau belum ditugaskan (sebelumnya menampilkan milik semua teknisi).

## Batas yang perlu diketahui
- Halaman sangat dalam memakai `OFFSET` (halaman 3000 ≈ 145 ms); wajar untuk UI. Pengambilan massal gunakan **Export API** (cursor).
- Total baris dihitung dengan `COUNT(*)` di setiap permintaan berpaginasi; nyaman sampai jutaan baris dengan indeks di atas.
- Migrasi `20261010000000_scale_indexes` membuat ekstensi `pg_trgm` dan beberapa indeks GIN. Pada tabel besar pembuatan indeks mengunci tulis sebentar; jalankan di luar jam sibuk bila datanya sudah jutaan.
- Mengulang pengukuran: isi data uji dengan `generate_series` lalu jalankan skrip ukur; data uji tidak disimpan di repo.
