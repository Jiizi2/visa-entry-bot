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
1. Menerima payload batch jamaah (dari `nusuk-entry-batch.json`).
2. Melakukan iterasi per jamaah (`for member of members`).
3. Menjalankan fungsi **`runMemberWithRetry`** untuk setiap jamaah.
4. Jika gagal (timeout, page freeze, session expired), runner akan melakukan *retry* dengan *exponential backoff delay*. Maksimal retry default adalah 3x per jamaah.
5. Jika error yang terjadi adalah "Session Expired", automation akan menunggu user login ulang secara manual tanpa menggagalkan queue (antrean) jamaah lainnya.
6. Menyimpan *checkpoint* secara berkala agar jika halaman di-refresh, proses bisa *resume* tepat dari step terakhir.

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
- `Stage 5`: Success Popup / List Mutamer.

Hal ini krusial untuk fitur **Resume**. Saat runner mati dan dihidupkan lagi, ia akan mengecek stage aktif dan melompat (skip) ke step yang sesuai dengan stage tersebut (misalnya, skip proses upload passport jika form data diri sudah terbuka).

Fungsi `waitForEnabledNextButton` dan `clickNextButtonRobust` juga dirancang khusus di sini untuk mengecek apakah form sudah valid (semua input wajib terisi) sebelum mencoba memaksakan klik "Next", sehingga menghindari *validation error popup* dari Nusuk.

---

## 6. Penanganan Error yang Resilien

Sistem tidak hanya sekadar `document.querySelector().click()`. Jika ada masalah, runner memiliki strategi recovery:
- **`watchdog_timeout`**: Setiap step dipagari batas waktu. Jika macet, halaman akan direfresh dan otomatis *resume* ulang.
- **`session_expired`**: Sistem mendeteksi login page Nusuk atau popup session expired, lalu menunggu user tanpa aborting the queue.
- **`validation_blocked`**: Memeriksa kembali apa ada field wajib yang belum terisi (e.g. nomor telepon kurang) menggunakan fungsi `describeMissingMemberFormFields()`.

## Kesimpulan
Sistem ini menggunakan desain yang decoupled (urutan aksi terpisah dari mekanisme eksekusi) untuk menjaga fleksibilitas. Jika Nusuk mengubah urutan form, kita cukup mengubah array di `automation-steps.js`. Jika UI framework Nusuk berubah (misal dari PrimeNG ke native HTML), kita cukup memperbaiki interpreter di `step-form-actions.js` tanpa menyentuh alur besar aplikasi.
