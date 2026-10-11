# Menuju Super Apps (MAUNG)

Tujuan: beberapa aplikasi (WO + Inventori, **Sales Tracking**, dst.) terasa satu produk — satu login, satu menu, data saling merujuk — tanpa menggabungkan kode.

## Prinsip
1. **Satu identitas** — pengguna, divisi (`role`) dan sub-role (`subRole`) dikelola sekali di aplikasi inti (WO). Aplikasi lain *tidak* membuat tabel user sendiri.
2. **Satu alamat** — semua aplikasi di belakang satu domain (mis. `maung.perusahaan.co.id/wo`, `/sales`) lewat reverse proxy (Caddy/Nginx). Karena satu origin, token login dapat dipakai bersama dan tak perlu CORS.
3. **Data saling merujuk lewat ID** — mis. Sales Tracking menyimpan `customerId` milik WO, bukan menyalin data pelanggan. Baca data lewat API, bukan lewat database langsung.
4. **Tiap aplikasi tetap deploy sendiri** (container sendiri, database sendiri). Mudah di-update, gagal satu tidak menjatuhkan yang lain.

## Langkah bertahap
| Tahap | Pekerjaan | Keluaran |
|---|---|---|
| 0 (sudah) | WO punya API sistem + dokumentasi (Admin → API Sistem), API MSRadius baca-saja, URL aplikasi bisa diatur Admin | Aplikasi lain dapat membaca data WO |
| 1 | **Login terpusat**: aplikasi baru memvalidasi token WO lewat `GET /api/auth/introspect` (atau memverifikasi JWT dengan `JWT_SECRET` yang sama) | Satu akun, tanpa user ganda |
| 2 | **Reverse proxy satu domain** + halaman *Launcher* (kartu aplikasi sesuai peran) | Satu pintu masuk |
| 3 | **Navigasi bersama**: top bar/sidebar seragam (paket UI kecil dipakai bersama) | Terasa satu aplikasi |
| 4 | **Event antar-aplikasi** (webhook/antrian): mis. kontrak sales disetujui → WO Pasang Baru terbentuk | Alur lintas aplikasi |
| 5 | Pencarian global & dashboard gabungan | Super apps penuh |

## Satu pintu (launcher) — SUDAH ADA, jalur satu domain
Pengguna hanya mengenal **satu alamat (`maung.liv.net.id`) dan satu login**. Setelah login mereka melihat **beranda** (`/apps`) berisi ikon aplikasi; hanya satu aplikasi (WO) → langsung masuk seperti biasa. Aplikasi lain berjalan di **jalur yang sama** (`/crm`, dst.), sehingga token login (disimpan browser per-alamat) otomatis berlaku — tanpa penukaran token.

**Cara kerja**
1. **Identitas tunggal** — WO menerbitkan login/peran; aplikasi lain memvalidasi token lewat `GET /api/auth/introspect` (di bawah).
2. **Jalur satu domain** — Caddy meneruskan `maung.liv.net.id/<jalur>/*` ke container aplikasi lewat berkas `proxy/apps/<nama>.caddy` (di-import DI DALAM blok situs WO; tidak ditimpa penulisan otomatis Admin). Container aplikasi bergabung ke jaringan `maung_edge` (hanya web-nya; database/Redis tetap privat).
3. **Daftar & akses ikon** — Admin → Pengaturan → **Aplikasi (Beranda)** mendaftarkan aplikasi (ID, nama, jalur satu segmen mis. `/crm`, ikon, tampil/tidak). Siapa yang melihat ikonnya diatur di **Hak Akses** (kelompok "Aplikasi", per divisi & sub-role; bawaan: hanya Admin). Aplikasi itu tetap WAJIB memeriksa token dan perannya sendiri — menyembunyikan ikon bukan pengamanan.
4. `GET /api/launcher` (login) mengembalikan `{apps:[{id,name,description,icon,iconUrl,path}], home:{title,subtitle,backLabel,alwaysShow}}` untuk pengguna ini. **Teks beranda, ubin WO, dan ikon** diatur Admin di Pengaturan → Aplikasi (Beranda): judul/kalimat (placeholder `{nama}`, `{nama_depan}`), nama tombol kembali (bawaan "Menu Utama"), opsi "selalu tampilkan beranda", serta ikon bawaan (Lucide) atau **unggah ikon sendiri** (PNG/JPEG/WebP ≤ 2 MB → dinormalkan PNG 192 px; SVG ditolak karena dapat memuat skrip).
5. **Kembali ke beranda dari dalam aplikasi:** WO menampilkan tombol (header + menu samping) bernama `home.backLabel` bila ada >1 aplikasi atau `alwaysShow`. Aplikasi lain WAJIB menyediakan tautan serupa ke **`/apps`** — label boleh diambil dari `GET /api/launcher` → `home.backLabel` agar seragam.

**Menambah aplikasi baru (mis. CRM) — langkah**
1. Di compose aplikasi itu: container web bernama **unik** (mis. `crm-web`) bergabung ke jaringan eksternal `maung_edge`:
   ```yaml
   services:
     crm-web:
       networks: [default, edge]
   networks:
     edge: { name: maung_edge, external: true }
   ```
2. Next.js aplikasi: `basePath: '/crm'` (dan `assetPrefix` bila perlu), jalankan di port 3000 dalam container.
3. Di repo Maung-Wo-Inv pada VM: taruh `proxy/apps/crm.caddy` (tanpa menghapus prefix — aplikasi memakai `basePath`):
   ```
   handle /crm/* {
   	reverse_proxy crm-web:3000
   }
   ```
   lalu muat ulang Caddy: `docker compose -f docker-compose.yml -f docker-compose.caddy.yml exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` (`caddy --watch` tidak memantau berkas import). Jalur harus unik dan tidak memakai jalur halaman WO (Admin menolak yang bentrok, mis. `/api`, `/admin`, `/customers`).
4. Admin → Pengaturan → Aplikasi (Beranda): tambahkan `crm` + jalur `/crm`; Hak Akses: centang divisi/sub-role yang melihat ikonnya.

**Kontrak sesi untuk aplikasi di jalur yang sama** (contoh TypeScript sisi browser)
```ts
const TOK = 'maung_token'; // localStorage (login "ingat saya") atau sessionStorage
const store = () => (localStorage.getItem(TOK) ? localStorage : sessionStorage);
export const token = () => localStorage.getItem(TOK) ?? sessionStorage.getItem(TOK);
export const toLogin = () => { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; }; // WO kembali ke sini setelah login
export async function maungFetch(path: string, init: RequestInit = {}) { // panggil API WO (/api/...) atau API CRM sendiri dengan token yang sama
  const r = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token()}` } });
  if (r.status === 401) toLogin();
  return r;
}
// Sesi diam: WO mengeluarkan pengguna setelah batas diam (Admin → Keamanan, bawaan 30 mnt). Selama pengguna aktif di aplikasi Anda:
export async function keepAlive() { // panggil saat ada aktivitas, paling sering tiap ±5 menit
  try { localStorage.setItem('maung_last_active', String(Date.now())); } catch {}
  const r = await fetch('/api/auth/refresh', { method: 'POST', headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' }, body: '{}' });
  if (r.ok) store().setItem(TOK, (await r.json()).token); else if (r.status === 401) toLogin();
}
```
Server aplikasi memvalidasi token yang dikirim browser lewat `GET /api/auth/introspect` (di bawah). Kembali ke beranda: tautan ke `/apps`.

## Validasi token (tahap 1)
```
GET /api/auth/introspect
Authorization: Bearer <token dari POST /api/auth/login>
→ 200 {"active":true,"sub":"<userId>","name":"…","email":"…","role":"MKT","subRole":"SUPERVISOR","exp":1760000000}
→ 401 bila token salah/kedaluwarsa
```
Aplikasi baru cukup memanggil ini (cache singkat, mis. 60 dtk) lalu memetakan `role`/`subRole` ke hak aksesnya sendiri.

## Untuk project Sales Tracking (berikutnya)
- Stack disarankan sama (Express + Prisma + Next) agar paket UI & pola auth bisa dipakai ulang.
- Jangan salin tabel `User`/`Customer`; rujuk `userId`/`customerId` WO lewat API Sistem.
- Peran sales memakai divisi **Marketing** yang sudah ada; sub-role Manager/Supervisor/Staff tetap.

## Konfigurasi tanpa IP
- Web berjalan **satu alamat**: browser hanya ke `http://<host>:3000`; `/api` dan `/uploads` diteruskan Next ke container `api` lewat nama host docker (`API_INTERNAL_URL`, bawaan `http://api:4000`). Tidak ada IP/port API yang tertanam saat build → ganti IP/domain server tanpa build ulang.
- Tautan di email/WhatsApp/Telegram memakai **URL aplikasi** yang diatur di *Admin → Pengaturan → Tampilan & brand* (kosong = `WEB_URL` di `.env`). Label QR aset memakai alamat yang sedang dibuka.
- `deploy.sh` tidak lagi menimpa `WEB_URL` yang sudah ada kecuali diberi `--host`.

## Penyimpanan berkas (MinIO / Garage)
Saat ini foto & logo disimpan di volume `uploads` pada container api (asli utuh; versi tampil dibuat on-demand di `uploads/.cache`). Bila kelak butuh object storage:
- **Gunakan container terpisah di VM yang sama** (bukan VM baru) — MinIO atau Garage (lebih ringan, cocok VM kecil) dengan volume sendiri. Pisahkan ke VM sendiri hanya bila berkas sangat besar atau API perlu multi-node.
- Perlu perubahan kecil di API (adapter unggah S3 + `/api/img` membaca dari S3). Belum dikerjakan karena volume lokal masih memadai; backup cukup `uploads` + dump Postgres.
