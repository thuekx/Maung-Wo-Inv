# Setup notifikasi: Telegram & Email (SMTP)

Semua pengaturan dikelola **Admin dari aplikasi**: menu **Admin → Pengaturan**. Tidak perlu mengedit `.env` atau restart container (perubahan aktif ≤ 10 detik). Nilai di menu ini menimpa `.env`; rahasia (token bot, password SMTP) disimpan **terenkripsi** di database dan tidak pernah ditampilkan ulang.

> Tanpa pengaturan apa pun aplikasi tetap berjalan dalam mode **dry-run**: notifikasi hanya tercatat di *Admin → Log notifikasi*, tidak dikirim.

## A. Bot Telegram

### 1. Buat bot (sekali)
1. Buka Telegram, cari **@BotFather**, kirim `/newbot`.
2. Isi nama tampilan (mis. `L1V WO`) lalu username unik berakhiran `bot` (mis. `l1v_wo_bot`).
3. BotFather membalas **token** berbentuk `123456789:AAH…`. Simpan rahasia ini.
4. (Opsional) `/setprivacy` → pilih bot → **Disable**, bila bot akan dipakai di grup dan harus membaca semua pesan.

### 2. Masukkan token ke aplikasi
*Admin → Pengaturan → Bot Telegram* → tempel token → **Simpan** → **Cek bot**. Jika benar, tampil `@username` bot.

### 3. Pasang webhook (agar user bisa menautkan akun)
Telegram hanya mengirim pesan ke alamat **HTTPS publik**:
- Pakai mode Caddy (`bash scripts/deploy.sh --caddy wo.contoh.co.id api-wo.contoh.co.id`) sehingga API punya `https://api-wo.contoh.co.id`.
- Isi kolom **URL API publik** dengan alamat itu → **Pasang webhook**. Aplikasi membuat secret acak dan mendaftarkan `https://…/api/telegram/webhook/<secret>` ke Telegram. Tombol **Cek bot** menampilkan status webhook dan error terakhir.
- Tanpa HTTPS publik (mis. VM lokal) webhook tidak bisa dipasang; **notifikasi keluar tetap jalan** (hanya `/link` yang tidak bisa dipakai). Alternatif: isi *Telegram chat ID* user langsung di *Admin → User*.

### 4. Tautkan akun tiap user
1. User login → **Profil** → **Buat kode tautan**.
2. Buka bot (tautan `@username` tampil di halaman), tekan **Start**, lalu kirim `/link KODE` (berlaku 10 menit).
3. Bot membalas ✅ dan notifikasi tahap WO masuk ke chat pribadi itu.

### 5. Grup per divisi (opsional)
Buat grup (mis. "NOC L1V"), tambahkan bot, kirim `/id` di grup → bot membalas **Chat ID** (angka negatif, mis. `-1001234567890`). Tempel di kolom divisi terkait pada *Pengaturan → Bot Telegram* → **Simpan**. Notifikasi untuk divisi itu (termasuk pengingat invoice ke **Finance**) ikut dikirim ke grup.

### 6. Uji
Isi **chat ID untuk tes** (chat pribadi atau grup) → **Kirim tes**.

### Masalah umum
| Gejala | Solusi |
|---|---|
| `Token tidak valid` saat Cek bot | Salin ulang token dari BotFather (tanpa spasi); server harus bisa keluar ke `api.telegram.org`. |
| `Telegram mewajibkan HTTPS publik` | Webhook butuh domain HTTPS (Caddy). Port yang didukung Telegram: 443, 80, 88, 8443. |
| `/link` tidak dibalas | Webhook belum terpasang (lihat Cek bot) atau kode kedaluwarsa; buat kode baru. |
| Pesan ke grup gagal `chat not found` | Bot belum ada di grup, atau chat ID salah; kirim `/id` di grup. |
| `403 bot was blocked by the user` | User memblokir bot; minta user menekan **Start** lagi. |

## B. Email (SMTP)

*Admin → Pengaturan → Email (SMTP pengirim)*. Isi, **Simpan SMTP**, lalu **Kirim tes** ke alamat Anda.

| Penyedia | Server | Port | Opsi | Catatan |
|---|---|---|---|---|
| Gmail / Google Workspace | `smtp.gmail.com` | 587 | – | Aktifkan 2-Step Verification, buat **App Password** (16 huruf) dan pakai sebagai password. Username = alamat lengkap. |
| Microsoft 365 | `smtp.office365.com` | 587 | – | Akun harus mengaktifkan *Authenticated SMTP*. |
| Zoho | `smtp.zoho.com` | 587 | – | Pakai App Password bila 2FA aktif. |
| Mailgun / SendGrid / Brevo / SES | sesuai dasbor | 587 | – | Username/password berupa kredensial SMTP, bukan login web. Verifikasi domain pengirim (SPF/DKIM). |
| Server mail sendiri | `mail.perusahaan.co.id` | 587 / 465 | centang *SSL langsung* untuk 465 | Pastikan akun boleh mengirim sebagai alamat **From**. |

Kolom **From** berformat `L1V WO <noreply@perusahaan.co.id>`; alamatnya harus diizinkan oleh akun SMTP (kebanyakan penyedia menolak From yang bukan milik akun/domain terverifikasi). Agar tidak masuk spam: gunakan domain sendiri dengan SPF + DKIM + DMARC.

### Masalah umum
| Gejala | Solusi |
|---|---|
| `Invalid login` / `535` | Password salah atau butuh App Password; cek kebijakan 2FA penyedia. |
| `ETIMEDOUT` / `ECONNREFUSED` | Port diblokir firewall/ISP; coba 587 vs 465, atau penyedia relay. |
| `self signed certificate` | Server mail memakai sertifikat tidak tepercaya; pakai sertifikat valid. |
| Terkirim tapi masuk spam | Lengkapi SPF/DKIM/DMARC untuk domain pengirim. |

## C. Pengingat Finance
Finance tidak terhubung ke aplikasi billing. Saat NOC menekan *Service Active* dan saat Marketing mengirim BA, semua user Finance (email + Telegram pribadi) dan grup Telegram Finance menerima pengingat **"segera siapkan invoice"**. Pastikan minimal satu user FIN punya email valid dan/atau Telegram tertaut, atau isi chat ID grup Finance.

## D. Fallback `.env`
Jika menu Pengaturan tidak diisi, aplikasi memakai variabel `.env` (`SMTP_*`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ROLE_CHATS`). Mengosongkan **Server SMTP** lalu menyimpan di menu mengembalikan ke `.env`/dry-run.

> Mengganti `JWT_SECRET` membuat rahasia tersimpan di database tidak terbaca (kunci enkripsi diturunkan darinya); isi ulang token/password di menu Pengaturan.
