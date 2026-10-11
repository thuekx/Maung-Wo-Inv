# Handoff untuk developer maung-crm — integrasi dengan Maung WO (jalur satu domain)

> Dokumen ini berdiri sendiri (tidak perlu akses repo Maung-Wo-Inv). Ini **menggantikan** rencana lama "CRM di domain/subdomain sendiri": keputusan pemilik = **satu domain, satu login, CRM di jalur `/crm`**.
> Aturan kerja pemilik: Bahasa Indonesia; identitas git `thuekx <thuekx@kolu.web.id>` tanpa trailer/atribusi AI; hanya branch `main`; uji sungguhan sebelum push; jangan menambah fitur di luar yang diminta; **jangan menempel token/secret/API key di chat**.

## 1. Gambaran
- Satu alamat: **`https://maung.liv.net.id`**. Pengguna login **sekali** di Maung WO (halaman `/login`), lalu `/apps` = beranda berisi ikon aplikasi (WO, CRM, dst.). Ikon CRM membuka **`/crm/`**.
- Satu VM (`maung-apps`), Docker Compose per aplikasi. **Caddy milik stack WO** satu-satunya yang membuka port 80/443; CRM **tidak** menjalankan proxy sendiri dan **tidak** membuka port ke host.
- WO = penerbit identitas (login, peran, divisi/sub-role). CRM memercayai token WO dan memetakan peran ke hak aksesnya sendiri. Database CRM terpisah dari WO (tidak saling melihat).

## 2. Yang harus dibangun di sisi CRM

### 2.1 Next.js di bawah `/crm`
- `next.config`: `basePath: '/crm'` (aset otomatis di `/crm/_next/…`). Container web **bernama `crm-web`**, mendengarkan **port 3000**.
- ⚠️ **`/api` dan `/uploads` di domain ini MILIK WO.** API & unggahan CRM harus ada di bawah `/crm/…` (mis. `/crm/api/...`, `/crm/uploads/...`). `fetch('/crm/api/x')` — path manual **tidak** otomatis diberi prefix basePath; hanya `next/link`/`next/image`/aset yang otomatis.
- Bila CRM punya container API terpisah (mis. `crm-api:4000`), arahkan lewat berkas Caddy (lihat 2.4) dengan aturan yang lebih spesifik **lebih dulu**.

### 2.2 Jaringan Docker
Container web (dan API bila perlu diakses Caddy) bergabung ke jaringan eksternal **`maung_edge`** (sudah dibuat oleh deploy WO) dengan **nama service yang unik**; database/Redis CRM tetap di jaringan privat CRM:
```yaml
services:
  crm-web:
    networks: [default, edge]
    # tidak ada `ports:` (tidak membuka port host)
networks:
  edge: { name: maung_edge, external: true }
```
Nama project/volume CRM harus berbeda dari WO (jangan memakai nama `web`, `api`, `postgres`, `redis` yang bisa bentrok di jaringan bersama — sebab itu hanya `crm-web` yang masuk `maung_edge`).

### 2.3 Auth (satu login) — kontrak sesi
Token login WO disimpan browser **per alamat** (karena satu domain, otomatis terbaca CRM):
- Kunci: **`maung_token`** di `localStorage` (login "ingat saya") atau `sessionStorage`.
- Tidak ada token / respons 401 → arahkan ke **`/login?next=<jalur CRM saat ini>`**; setelah login WO mengembalikan pengguna ke jalur itu (hanya jalur internal yang diterima).
- Validasi di **server CRM**: `GET https://maung.liv.net.id/api/auth/introspect` dengan `Authorization: Bearer <token dari browser>` →
  `200 {"active":true,"sub":"<userId>","name":"…","email":"…","role":"MKT","subRole":"SUPERVISOR","exp":1760000000}`; `401` bila tidak valid/kedaluwarsa. Cache singkat (±60 dtk).
- Peran: `role` ∈ `ADMIN | MKT | NOC | FOC | GA | FIN`, `subRole` ∈ `MANAGER | SUPERVISOR | STAFF`. Pemetaan ke hak akses CRM = keputusan CRM.
- Cara selaras dengan panel **Hak Akses** WO: `GET /api/auth/me` (Bearer) mengembalikan `features: string[]`; CRM boleh mensyaratkan fitur **`app.crm`** — itulah centang yang diatur Admin per divisi/sub-role di WO (Admin selalu punya). Menyembunyikan ikon bukan pengamanan: **CRM tetap wajib memeriksa sendiri**.
- **Sesi diam (penting):** WO mengeluarkan pengguna setelah batas diam (bawaan **30 menit**; token JWT berumur sama). Selama pengguna aktif di CRM, CRM harus memperpanjang: `POST /api/auth/refresh` (Bearer, body `{}`) → `{token}`, simpan ke penyimpanan yang sama (localStorage bila ada di sana, jika tidak sessionStorage), dan tulis `localStorage.maung_last_active = Date.now()` pada aktivitas. Panggil paling sering tiap ±5 menit saat ada aktivitas. Token kedaluwarsa tidak bisa diperpanjang.
- Keluar (logout) = hapus `maung_token` dari `localStorage` dan `sessionStorage`, lalu `location.href = '/login'`. Tautan "Beranda Maung" → **`/apps`**.
- Contoh kode klien lengkap ada di docs WO (`docs/SUPER-APPS.md`, "Kontrak sesi"):
```ts
const TOK = 'maung_token';
const store = () => (localStorage.getItem(TOK) ? localStorage : sessionStorage);
export const token = () => localStorage.getItem(TOK) ?? sessionStorage.getItem(TOK);
export const toLogin = () => { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; };
export async function keepAlive() {
  try { localStorage.setItem('maung_last_active', String(Date.now())); } catch {}
  const r = await fetch('/api/auth/refresh', { method: 'POST', headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' }, body: '{}' });
  if (r.ok) store().setItem(TOK, (await r.json()).token); else if (r.status === 401) toLogin();
}
```
- Server CRM memanggil WO lewat alamat publik. Bila dari dalam container alamat itu tidak terjangkau (hairpin), tambahkan di compose CRM: `extra_hosts: ["maung.liv.net.id:host-gateway"]` (menuju Caddy di host).

### 2.4 Berkas Caddy yang diserahkan ke pemilik
CRM **tidak** menyentuh Caddy/WO. Serahkan isi berkas **`crm.caddy`** (pemilik menaruhnya di `proxy/apps/crm.caddy` di repo WO pada VM, lalu memuat ulang Caddy). Berkas ini di-import **di dalam** blok situs WO, jadi hanya berisi direktif `handle`:
```
# aturan lebih spesifik lebih dulu (hanya bila CRM punya container API terpisah)
handle /crm/api/* {
	reverse_proxy crm-api:4000
}
handle /crm/* {
	reverse_proxy crm-web:3000
}
```
Muat ulang (`caddy --watch` tidak memantau berkas import):
`docker compose -f docker-compose.yml -f docker-compose.caddy.yml exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` (dijalankan di `~/Maung-Wo-Inv`). Jalur ikon di Admin WO harus sama (`/crm`); jalur satu segmen, huruf kecil.

### 2.5 Data dari WO (baca-saja, server-ke-server)
Export API WO, header `x-api-key: <EXPORT_API_KEY>` (atau `Authorization: Bearer`). **Kunci diberikan pemilik lewat env server CRM — jangan pernah di chat/commit.** Batas 120 permintaan/menit.
- Base: `https://maung.liv.net.id/api/export/<resource>`; parameter: `limit` (1–5000, bawaan 1000), `cursor` (= `nextCursor` respons / header `X-Next-Cursor`), `since` (ISO; memfilter `createdAt`), `format=json|csv`. Respons: `{resource,count,nextCursor,generatedAt,data:[…]}`.
- **`customers`** (sudah memuat): `code, name, phone, status, radiusStatus, salesName, createdAt, areaName` (+ alamat, paket, ODP/port/VLAN/IP, `activatedAt`, `warehouseCode`, dll.). `status` ∈ `PROSPECT | INSTALLING | ACTIVE | NEED_CHECK | SUSPENDED | TERMINATING | TERMINATED`; `radiusStatus` ∈ `WAITING | ONLINE | OFFLINE | ISOLIR | DISABLE` (nilai dari MSRadius; Offline → status `NEED_CHECK`, Waiting → `PROSPECT`).
- **`subscriptions`** (Formulir Berlangganan; **tanpa data biaya**): `regNo, formDate, name, phone, packageName, source (MANUAL|RADIUS), marketingName, customerCode, woNumber, createdAt`.
- Pola sinkron: tarik inkremental dengan `since` + `cursor`, upsert menurut `code` / `regNo`. Pelanggan MSRadius bersifat baca-saja di WO (nama/telepon/alamat/paket dikelola MSRadius).

## 3. Cara memberikan hasil / mendeploy (konvensi pemilik)
- Server: VM `maung-apps`, user `ithero` (anggota grup `docker`; **jangan `sudo`** untuk docker/compose). Repo WO di `~/Maung-Wo-Inv` (**jangan pernah membuat/menimpa/mengubah `.env` WO**).
- Perintah server diberikan sebagai **skrip `.sh` di repo CRM** + satu perintah salin-tempel (mis. `cd ~/Maung-CRM && git pull --ff-only origin main && bash scripts/<nama>.sh </dev/null`). Skrip berfase: banner `====`, `[n/N] nama fase`, baris `✓ / ! / ✗`, blok **RESULT** berisi `kunci=nilai`, log audit di `~/…-logs`, **guard host/direktori di awal** (`hostname` = `maung-apps`, bukan root), backup sebelum mengubah, bisa rollback. Contoh yang baik: `scripts/update-safe.sh` di repo WO.
- Rahasia CRM (DB password, API key export, dsb.) hanya di `.env` **CRM** di server — dibuat/diisi pemilik, tidak ditempel di chat.
- Minta pemilik mendaftarkan CRM: Admin WO → Pengaturan → **Aplikasi (Beranda)** (ID `crm`, jalur `/crm`, ikon, tampil) lalu **Hak Akses** (kelompok "Aplikasi") untuk divisi/sub-role yang boleh melihat ikonnya. Hingga itu dilakukan, hanya Admin yang melihat ikon.

## 4. Pemeriksaan setelah deploy (cantumkan di RESULT skrip Anda)
1. `https://maung.liv.net.id/crm/` tanpa login → diarahkan ke `/login?next=/crm/`; setelah login kembali ke CRM.
2. `https://maung.liv.net.id/login` dan `/api/branding` tetap **200** (WO tidak terganggu).
3. Container `crm-web` ada di jaringan `maung_edge`; tidak ada port CRM terbuka di host.
4. Token WO diterima server CRM (introspect 200); token salah → 401 dan CRM mengarahkan ke login.
5. Setelah ±35 menit aktif di CRM, sesi tidak habis (keepAlive berfungsi); diam 30 menit → keluar.
6. Kamera/GPS bekerja (HTTPS sudah aktif di domain).

## 5. Jangan
- Jangan memakai `/api`, `/uploads`, atau jalur halaman WO untuk CRM; jangan menjalankan Caddy/proxy lain atau membuka port 80/443.
- Jangan menyalin/ membagikan `JWT_SECRET` WO ke CRM (validasi lewat introspect, bukan verifikasi JWT lokal).
- Jangan menulis ke database WO; satu-satunya jalur data WO → CRM adalah Export API (baca-saja).
- Jangan menempel secret di chat; jangan commit `.env`.

## 6. Keputusan yang masih terbuka di sisi CRM (bukan WO)
Lokasi object storage foto (MinIO/Garage di VM yang sama vs volume), penggunaan PostGIS, apakah master pelanggan CRM mengikuti pelanggan WO atau modul sendiri (lihat `docs/maung-crm/*` dan spesifikasi Field Activities).
