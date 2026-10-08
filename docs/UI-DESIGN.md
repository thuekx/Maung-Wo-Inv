# Desain antarmuka (Tahap 1): dasar, sumber, dan lisensi

Desain MAUNG by LIV = **panduan brand** (warna, font, tombol, login) + pola **TailAdmin** (kerangka & kartu) + pola **Tabler** (kepadatan data). Semua ditulis ulang sendiri dengan Tailwind v3 milik proyek ini; **tidak ada kode, gambar, atau ikon yang disalin** dari template. Keduanya berlisensi MIT, tetapi karena tidak disalin tidak ada kewajiban atribusi dan tidak ada dependensi baru.

## Pemetaan: apa diambil dari mana

| Elemen | Asal pola | Referensi di repo sumber | Penerapan di proyek ini |
|---|---|---|---|
| Sidebar bisa diciutkan (lebar penuh ↔ ikon), grup menu berjudul kecil, penanda item aktif, drawer di HP | **TailAdmin** | `src/partials/sidebar.html`, `css/style.css` (`menu-item`, `menu-item-active`) | `(app)/layout.tsx`, kelas `.menu-item`; status diingat per browser; penanda aktif = garis emas (brand) |
| Header lengket dengan tombol hamburger/ciutkan, kotak cari dengan pintasan, ikon tema, lonceng notifikasi, menu akun | **TailAdmin** | `src/partials/header.html` | Top bar navy (sesuai panduan brand) + `SearchBox` (pintasan `/`), `ThemeToggle`, lonceng = jumlah tugas, menu akun |
| Kartu metrik: ikon dalam kotak lembut, angka besar, label, lencana tren | **TailAdmin** | `partials/metric-group/metric-group-01.html` | `MetricCard` (dashboard) |
| Kartu membulat, bayangan tipis, mode gelap berlapis | **TailAdmin** | `rounded-2xl border … dark:` pada kartu | `.card`, token navy gelap |
| Halaman masuk dua panel | **TailAdmin** (struktur) + mockup brand | `signin.html` | `login/page.tsx` mengikuti mockup MAUNG |
| Tabel padat: header kecil kapital berjarak, baris rapat, hover halus, footer paginasi | **Tabler** | `core/scss/ui/_tables.scss`, `_cards.scss` | `.th`/`.td`, `DataTable` |
| Pretitle kecil di atas judul halaman + aksi di kanan | **Tabler** | page header (`page-pretitle`) | `PageHeader` (`pretitle`) |
| Daftar label–nilai rapat untuk halaman detail | **Tabler** | `core/scss/ui/_datagrid.scss` | `DataGrid` (detail pelanggan) |
| Status dengan titik berwarna, lencana lembut, avatar inisial | **Tabler** | `_badges.scss`, `_avatars.scss` | `Badge` (titik), `Avatar` |
| Keadaan kosong (ikon + judul + penjelasan) | **Tabler** | `core/scss/ui/_empty.scss` | `EmptyState` |

Yang **bukan** dari template: palet navy/emas, Playfair Display + Inter, tombol utama emas / sekunder navy / outline / teks, top bar navy bergaris emas, pola kontur gunung di login — semuanya dari panduan brand (`docs/BRANDING.md`).

## Lisensi & aset
- Tabler (MIT) dan TailAdmin free (MIT). Versi PRO TailAdmin (demo.tailadmin.com) berbayar: tidak dijadikan acuan aset/kode.
- Font: **Inter** dan **Playfair Display** (SIL OFL 1.1), dikemas lewat paket `@fontsource-variable/*` — dilayani dari server sendiri, tanpa Google Fonts.
- Ikon: gambar garis sederhana buatan sendiri (`components/icons.tsx`).
- Logo, tagline, dan teks login: milik brand; dapat diganti Admin tanpa deploy.

## Brand yang dapat diatur Admin (Admin → Pengaturan → Tampilan & brand)
Logo horizontal (latar gelap), ikon ringkas (top bar), logo tegak, gambar latar login, nama brand, tagline, sub-judul, teks login, warna utama/aksen, dan enam warna grafik; lengkap dengan pratinjau dan tombol "Kembalikan ke bawaan MAUNG". Perubahan berlaku langsung (warna diturunkan menjadi skala Tailwind lewat CSS variable; tersimpan di browser agar tidak berkedip saat muat). Logo horizontal juga dipakai sebagai banner pada foto lapangan teknisi.

Penyimpanan logo: saat logo diganti atau dihapus, file lama dan catatan attachment-nya ikut dihapus otomatis (termasuk sisa file brand dari versi sebelumnya yang tidak lagi dipakai). Foto lapangan yang sudah dibubuhi logo tidak terpengaruh karena logo tertanam di piksel foto.

Tips logo: unggah logo horizontal **tanpa tagline** (tagline tampil terpisah dan bisa diganti) dan ikon ringkas tanpa teks; contoh ikon yang dipotong dari logo Anda ada di `docs/branding/logo-mark.png`.

## Login dengan username
Kolom login menerima email lengkap atau username (bagian sebelum `@`) selama hanya satu akun yang cocok. "Ingat saya" menyimpan sesi di localStorage; tanpa centang, sesi hilang saat tab/browser ditutup.
