# Dokumentasi Engine Automation (Chrome Extension)

Bagian inti dari Chrome Extension `EntryMate By Ghaniya` adalah **Automation Engine** yang bertugas mengeksekusi autofill data ke platform Nusuk secara presisi dan tahan terhadap error (resilient).

Engine ini dipecah ke dalam beberapa modul terpisah dengan pola desain *Declarative Steps* & *Interpreter*.

---

## 1. Arsitektur Modul Automation

```
[ panel.js / content.js ] ── Memicu ──> [ automation-runner.js ] (Orchestrator Utama)
                                                │
       ┌────────────────────────────────────────┼──────────────────────────────────┐
       ▼                                        ▼                                  ▼
[ automation-steps.js ]                 [ step-runner.js ]                [ nusuk-navigation.js ]
(Definisi Urutan Aksi)                 (Interpreter Aksi)                 (Stage & Page Detection)
       │                                        │
       │                                        ▼
       │                    ┌───────────────────┼────────────────────┐
       │                    ▼                   ▼                    ▼
       │         [ step-basic-actions ] [ step-form-actions ] [ step-upload-actions ]
       │            (Wait, Click, Fill)   (Dropdown, Date)      (Passport, Vaccine)
       │
       └─> JSON/Data Mapping ─> (Menentukan input berdasarkan "manifest" dari Desktop App)
```

---

## 2. Siklus Eksekusi Utama (`automation-runner.js`)

Orkestrator loop berada di fungsi `runAutomation`. Siklus kerjanya:
1. Menerima batch yang sudah divalidasi dari file `nusuk-entry-batch.json`, melalui drag-and-drop atau pemilih file pada panel extension.
2. Melakukan iterasi per jamaah (`for member of members`).
3. Menjalankan fungsi **`runMemberWithRetry`** untuk setiap jamaah.
4. Gangguan yang masih aman untuk diulang, termasuk data identitas yang belum tampil setelah menunggu, menggunakan *exponential backoff delay*, maksimal 3x per jamaah. Nomor paspor atau lampiran yang berbeda, nama hasil pengisian yang tetap salah, langkah yang macet, dan penyimpanan yang belum terkonfirmasi menghentikan batch; jamaah berikutnya tidak diproses. Perbedaan nama OCR Nusuk menjadi catatan, bukan alasan menghentikan pengisian dari data yang sudah direview.
5. Jika error yang terjadi adalah "Session Expired", automation akan menunggu user login ulang secara manual tanpa menggagalkan queue (antrean) jamaah lainnya.
6. Menyimpan antrean yang tersisa sebelum memproses setiap paspor, serta mencatat sukses setelah konfirmasi Nusuk. Setelah menutup popup sukses, automation menunggu halaman upload atau daftar jamaah siap sebelum memulai paspor berikutnya. Form upload yang disembunyikan dari jamaah sebelumnya tidak dipakai sebagai tanda siap. Refresh pada tab yang sama memulihkan antrean tersebut dan melewati paspor yang sudah tersimpan.

### Sumber Command dan Data

- Desktop membuat `nusuk-entry-batch.json` secara otomatis ketika operator membuka halaman 5 setelah menyelesaikan review.
- Area file desktop memakai native drag dengan operasi copy. Panel menerima file di mode ringkas maupun detail, serta menyediakan **Pilih file JSON**.
- File dibaca dan divalidasi sebelum dikirim ke content script tab tujuan. Konfirmasi berhasil diberikan setelah batch disimpan. Import yang gagal mempertahankan batch lama; import yang berhasil membersihkan checkpoint, kegagalan, dan pilihan foto lama.
- Batch aktif, dijeda, atau memiliki pengiriman yang belum terkonfirmasi tidak dapat diganti. Import yang masih berlangsung memblokir start, pergantian jamaah, dan import berikutnya.
- Batch, checkpoint pengiriman, serta cache foto pilihan manual disimpan untuk tab dan batch masing-masing. Panel menyimpan preferensi tampilan terpisah dari data entry.
- Tidak ada WebSocket, heartbeat koneksi desktop, atau pemulihan batch dari desktop. Progress dan kontrol berada di extension.

### Perpindahan dari aplikasi ke Nusuk

1. Selesaikan Review dan buka tahap Entry. Tunggu file JSON siap.
2. Buka Nusuk pada Chrome dan buka panel extension. Seret file JSON dari desktop ke **Letakkan file JSON di sini**.
3. Periksa jumlah jamaah, folder, dan jamaah pertama yang diterima. Biarkan folder hasil scan berada di lokasi yang sama.
4. Pilih **Mulai pengisian** di widget atau panel. Dari Group List, tab yang sama otomatis menuju Mu'tamer List, memulihkan batch milik tab tersebut, lalu memulai automation. Login atau halaman yang masih dimuat menonaktifkan tombol mulai.
5. Jika batch berhenti, gunakan **Lanjutkan sisa** untuk mencoba jamaah yang gagal dan meneruskan jamaah berikutnya. Hasil sukses tetap dipertahankan. Pada batch yang sudah selesai, **Ulangi yang gagal** hanya menjalankan jamaah gagal. Untuk batch berikutnya, periksa pekerjaan, reset jika diperlukan, lalu seret JSON yang baru.

### Melanjutkan batch setelah Nusuk error

- Contoh: 9 dari 15 paspor sudah tersimpan, lalu paspor ke-10 gagal. Panel menampilkan **Tersimpan 9 / 15** dan 6 paspor tersisa. Pulihkan halaman Nusuk atau login ulang pada tab yang sama, lalu pilih **Lanjutkan sisa**. Paspor 1–9 tidak dikirim ulang; proses mulai dari paspor ke-10 dan berlanjut sampai ke-15.
- Jika error terjadi sesudah tombol simpan diklik, hasilnya bisa belum jelas meski Nusuk sudah menerima data. Extension tetap memblokir pengiriman ulang. Periksa nomor paspor yang ditampilkan di daftar jamaah Nusuk, lalu pilih **Sudah tersimpan** atau **Belum tersimpan** pada panel. Pilihan pertama mencatat sukses dan melewati paspor itu; pilihan kedua menahannya di awal antrean untuk dicoba lagi. Keduanya mempertahankan hasil sukses sebelumnya dan tidak langsung menjalankan pengisian.
- Setelah hasil pemeriksaan dicatat, pilih **Lanjutkan sisa**. Widget yang diminimalkan menawarkan **Periksa hasil simpan** untuk membuka panel ketika ada hasil yang belum jelas.
- Progress menghitung paspor yang sudah terkonfirmasi tersimpan, bukan paspor yang baru sedang diproses atau gagal. Konfirmasi manual berdasarkan pemeriksaan operator juga dicatat sebagai sukses.
- Pemulihan berlaku untuk batch pada tab Nusuk yang sama dalam sesi browser yang sama, termasuk setelah refresh dan login ulang. Menutup tab, mereset batch, atau memulai sesi browser baru tidak memulihkan antrean lama.

Extension yang diperbarui pada tab Nusuk yang sudah lama terbuka memerlukan satu kali refresh agar content script baru aktif. Jika drag native tidak tersedia, gunakan **Buka folder file** di desktop dan seret dari Explorer, atau **Pilih file JSON** di panel.

### Pemeriksaan identitas dan hasil simpan

- Nomor paspor diperiksa pada Passport Details. Nama yang dibaca Nusuk dicatat sebelum kolom nama diisi dari hasil review EntryMate. Nama Inggris dan Arab, termasuk kolom tengah yang kosong, diperiksa lagi sebelum melanjutkan.
- Kolom nomor paspor dibaca dari variasi control/name/id, placeholder, label, tabel, dan pasangan label/nilai yang terlihat. Titik dua/tanda wajib pada label, huruf besar/kecil, spasi, tanda arah teks, serta angka Arab/Persia/fullwidth yang setara diterima. Nomor berbeda, pertukaran huruf/angka seperti O/0, atau digit yang hilang tetap diblokir. Pembacaan identitas menunggu maksimal 15 detik agar nilai lama atau kolom kosong sempat diperbarui oleh Nusuk. Data yang tetap berbeda diblokir; data yang belum tersedia boleh diperiksa ulang pada jamaah yang sama. Kolom nomor yang kosong atau disembunyikan pada Member Form boleh memakai nomor yang sudah diverifikasi untuk jamaah aktif, tetapi ringkasan sebelum simpan tetap harus menampilkan nomor yang cocok.
- Nama dari profil EntryMate berstatus VALID dan `reviewConfirmed: true` menjadi acuan. Perbedaan nama OCR Nusuk, termasuk SUHERMAN yang terbaca LUZERMAN, nama kosong, kata terpotong, atau pembagian kolom berbeda, tidak menahan pengisian. Tidak ada ambang kemiripan nama. Nomor paspor tetap harus cocok; file terpilih harus sesuai path yang diminta. Upload yang diterima dicatat untuk jamaah aktif. Lampiran yang terlihat pada Member Form diperiksa jika tersedia; pada resume tanpa tampilan lampiran, pemeriksaan file wajib dilakukan di Summary sebelum simpan. Kolom yang diperlukan untuk mengisi data review harus ditemukan.
- Setelah pengisian, seluruh kolom Inggris/Arab harus cocok dengan profil review, termasuk kolom tengah kosong dan nama satu kata yang dipetakan ke dua kolom wajib. Nilai yang ditolak saat pengisian dicoba ulang paling banyak dua kali. Sebelum Next, nama yang berubah dicoba dikoreksi dua kali pada Member Form yang sama, dengan memeriksa kembali nomor paspor dan lampiran yang tersedia. Koreksi tidak berjalan pada paspor berbeda, halaman yang berubah, kolom yang tidak dikenali, atau pengisian yang dibatalkan.
- Nama OCR asli dan nama review dicatat sekali per jamaah, disimpan dalam checkpoint, dan dilaporkan di log setelah batch selesai. Catatan tidak memicu popup error atau dimasukkan sebagai jamaah gagal; reset dan import batch baru membersihkannya.
- Ringkasan harus menampilkan nomor paspor, nama hasil review, dan nama file lampiran yang cocok dengan jamaah aktif. Bukti yang hilang atau berbeda menghentikan entry. Konfirmasi review yang dicabut juga memblokir simpan. Nama OCR yang masih salah pada Summary tidak diterima sebagai hasil akhir.
- Nama file pada ringkasan boleh berbeda huruf besar/kecil, bentuk Unicode setara, atau spasi/underscore karena format tampilan Nusuk. Nama dasar, nomor urut, tanda hubung, dan ekstensi tetap harus sesuai. Perbedaan tampilan yang membuat file ambigu dengan file lain dalam seluruh batch, termasuk jamaah yang sudah disimpan, menghentikan entry. Pencarian file di disk dan path sumber tidak memakai aturan tampilan ini.
- Tombol simpan akhir diklik satu kali. Checkpoint pengiriman disimpan sebelum klik; hasil yang belum terkonfirmasi memblokir retry, resume setelah refresh, dan penggantian batch. Kembali ke daftar saja tidak dihitung sebagai sukses; harus ada popup konfirmasi Nusuk untuk pengiriman jamaah yang sama.
- Jika hasil simpan belum jelas, periksa daftar Nusuk berdasarkan nomor paspor terlebih dahulu, lalu catat **Sudah tersimpan** atau **Belum tersimpan** di panel tanpa mereset batch. Keputusan harus cocok dengan identitas dan waktu pengiriman yang masih aktif. Kegagalan menyimpan keputusan mempertahankan checkpoint dan blokir sebelumnya. Reset tetap meminta konfirmasi pemeriksaan jika hasil simpan belum diselesaikan.
- Data seluruh batch divalidasi sebelum pengisian dimulai. Resume di Disclosure atau Summary langsung melanjutkan ke pemeriksaan akhir, tanpa bergantung pada catatan pemeriksaan sementara yang hilang setelah refresh atau proses dimulai ulang. Disclosure tidak memeriksa identitas. Sebelum simpan, nomor paspor, nama lengkap, kolom nama yang ditampilkan, dan lampiran pada Summary harus cocok dengan jamaah aktif; data yang belum tampil ditunggu dan perbedaan nyata tetap memblokir penyimpanan. Perubahan field pada aplikasi membatalkan tanda sudah direview; cocokkan ulang dengan gambar paspor sebelum mengonfirmasi review.

Jalankan `npm test` dan `npm run test:browser` dari folder `chrome-extension`. Uji browser memakai Chrome/Edge lokal dan halaman tiruan tanpa mengakses akun Nusuk. Gunakan `CHROME_PATH` jika executable browser berada di lokasi lain. Uji ini mencakup SUHERMAN/LUZERMAN, seluruh batch 16 paspor dengan nama OCR salah, pengisian ulang nama yang berubah, respons simpan lambat, lampiran tertukar, nama Summary salah, pergantian batch, dan checkpoint pengiriman.

---

## 3. Definisi Langkah / Steps (`automation-steps.js`)

Semua interaksi di Nusuk tidak di-hardcode ke dalam kode prosedural panjang, melainkan didefinisikan sebagai array JSON objek (Declarative Steps). Fungsi utamanya adalah `buildPerMemberSteps()`.

Contoh struktur definisi step:
```javascript
{
  action: "fill",
  selector: "input[formcontrolname='profession']",
  value: "{{member.resolvedProfile.profession}}",
}
```

Urutan Step Utama:
1. **Upload Passport:** `set_files` gambar ke `PASSPORT_UPLOAD_SELECTOR`, tunggu popup "Proceed", klik Proceed.
2. **Passport Details:** Isi Previous Nationality, Passport Type, Date of Issue, City of Issue.
3. **Member Form:** Isi Nama Arabic/English (4 suku kata), Profesi, Negara Lahir, Kota Lahir, Status Pernikahan, Vaksinasi (opsional), Email, Nomor Handphone.
4. **Companion:** Klik Add Companion jika ini adalah Mutamer anak (minor) sebelum lanjut.
5. **Disclosure Form:** Centang opsi "No" pada semua pertanyaan medis/kriminal.
6. **Summary & Submit:** Submit form dan tunggu popup "Mutamer has been added successfully".

---

## 4. Interpreter Langkah (`step-runner.js`)

Interpreter membaca deklarasi dari `automation-steps.js` dan mendelegasikannya ke *action handlers* khusus.
- Mengubah string templat `"{{member.resolvedProfile.profession}}"` menjadi nilai asli dari payload.
- Mengatur human-like delay di setiap aksi via `slowModeDelayBeforeStep`.
- Merouting aksi seperti:
  - `action: "wait_for_selector"` → delegasi ke `basicActions`.
  - `action: "select_primeng_dropdown"` → delegasi ke `formActions` (Logika spesifik drop-down UI PrimeNG milik Nusuk).
  - `action: "set_files"` → delegasi ke `uploadActions`.

---

## 5. Navigasi Cerdas (`nusuk-navigation.js`)

Karena halaman Nusuk bertipe *Single Page Application* (SPA / Angular), perubahan URL tidak selalu bisa diandalkan. Modul `nusuk-navigation.js` menggunakan *DOM Signature Detection*.

**Fungsi Kunci:** `detectNusukStage()`
Mendeteksi kita sedang berada di stage mana berdasarkan elemen unik yang tampak:
- `Stage 1`: Passport Details Form.
- `Stage 2`: Member Form (Muncul field Nama dan Profesi).
- `Stage 3`: Disclosure Form (Muncul form deklarasi Yes/No).
- `Stage 4`: Summary Page.
- `Stage 5`: Success Popup.

Hal ini krusial untuk fitur **Resume**. Saat runner mati dan dihidupkan lagi, ia akan mengecek stage aktif dan melompat (skip) ke step yang sesuai dengan stage tersebut (misalnya, skip proses upload passport jika form data diri sudah terbuka).

Fungsi `waitForEnabledNextButton` dan `clickNextButtonRobust` juga dirancang khusus di sini untuk mengecek apakah form sudah valid (semua input wajib terisi) sebelum mencoba memaksakan klik "Next", sehingga menghindari *validation error popup* dari Nusuk.

---

## 6. Penanganan Error yang Resilien

Sistem tidak hanya sekadar `document.querySelector().click()`. Jika ada masalah, runner memiliki strategi recovery:
- **`watchdog_timeout`**: Batas tiga menit mengukur langkah yang macet dan diperbarui setiap langkah selesai. Paspor yang terus maju boleh membutuhkan total waktu lebih lama; jeda operator tidak memicu timeout. Jika satu langkah benar-benar macet, token eksekusi dibatalkan dan batch dihentikan agar pekerjaan yang terlambat tidak menulis ke form jamaah berikutnya.
- **`session_expired`**: Sistem mendeteksi login page Nusuk atau popup session expired, lalu menunggu user tanpa aborting the queue.
- **`validation_blocked`**: Memeriksa kembali apa ada field wajib yang belum terisi (e.g. nomor telepon kurang) menggunakan fungsi `describeMissingMemberFormFields()`.

## Kesimpulan
Sistem ini menggunakan desain yang decoupled (urutan aksi terpisah dari mekanisme eksekusi) untuk menjaga fleksibilitas. Jika Nusuk mengubah urutan form, kita cukup mengubah array di `automation-steps.js`. Jika UI framework Nusuk berubah (misal dari PrimeNG ke native HTML), kita cukup memperbaiki interpreter di `step-form-actions.js` tanpa menyentuh alur besar aplikasi.
