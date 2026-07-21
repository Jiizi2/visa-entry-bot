# EntryMate By Ghaniya: Status Arsitektur dan Rencana Lanjutan

Dokumen ini mencatat arsitektur yang benar-benar aktif pada runtime saat ini. Rencana lama yang menjadikan file JSON sebagai satu-satunya penghubung desktop dan extension sudah digantikan oleh integrasi WebSocket lokal. Export JSON manual tetap tersedia sebagai Legacy Mode.

## Tujuan Sistem

EntryMate membantu operator memproses foto atau PDF passport, memeriksa hasil OCR, lalu mengotomatisasi entry jamaah ke Nusuk.

Tanggung jawab dibagi menjadi tiga komponen:

1. Desktop app memilih dokumen, menjalankan OCR, menyediakan review, dan mengoordinasikan automation.
2. Python OCR worker mengekstrak data passport dan menghasilkan manifest lokal.
3. Chrome extension menjalankan seluruh interaksi DOM dan upload dokumen pada website Nusuk.

## Arsitektur Aktif

```text
Folder passport
  -> Desktop App (Tauri + React)
  -> Python OCR Worker
  -> manifest.json
  -> Review dan konfirmasi operator
  -> LOAD_BATCH melalui WebSocket loopback
  -> Chrome Extension
  -> Autofill Nusuk
  -> Progress dan status kembali ke Desktop
```

WebSocket server berjalan di desktop dan hanya bind ke `127.0.0.1`. Server memilih port pertama yang tersedia pada rentang `9001-9005`; panel extension mencoba rentang yang sama.

### Jalur Legacy JSON

```text
manifest.json
  -> Desktop: aktifkan Legacy Mode
  -> nusuk-entry-batch.json
  -> User upload JSON ke extension
  -> User memilih folder/file passport
  -> Autofill Nusuk
```

Jalur ini dipertahankan sebagai fallback bila koneksi WebSocket tidak digunakan. Browser extension tidak dapat mengakses file hanya dari path relatif dalam JSON manual, sehingga user tetap harus memilih folder/file passport.

## Batas Tanggung Jawab

### Desktop App

Desktop bertanggung jawab untuk:

- Memilih folder dan menyiapkan gambar passport.
- Menjalankan dan menghentikan Python OCR worker.
- Menampilkan progress scan serta hasil review.
- Menyimpan perubahan manifest.
- Memastikan hanya member yang valid dan sudah dikonfirmasi yang dikirim.
- Menjalankan WebSocket loopback dan menjaga state sesi automation.
- Mengirim `LOAD_BATCH` dan `START` ke extension.
- Menampilkan progress yang diterima dari extension.
- Mengekspor `nusuk-entry-batch.json` pada Legacy Mode.

Desktop tidak menjalankan Playwright dan tidak memanipulasi DOM Nusuk. Tombol untuk membuka Nusuk hanya membuka URL melalui shell sistem.

### Python OCR Worker

Worker bertanggung jawab untuk:

- Menemukan input JPG, JPEG, PNG, dan PDF.
- Mengonversi PDF dan menggunakan prepared image bila tersedia.
- Menjalankan pipeline MRZ, panel OCR, visual OCR, dan recovery fields.
- Menghasilkan status `VALID`, `NEEDS_REVIEW`, atau `ERROR` beserta evidence dan metrik.
- Menulis `manifest.json` dengan `schemaVersion: passport-manifest-v1` dan `contractVersion: passport-extracted-resolved-profile-v4`.

Engine OCR, termasuk pembacaan MRZ, menggunakan RapidOCR melalui ONNX Runtime. PassportEye/Tesseract sudah tidak menjadi dependency runtime.

### Chrome Extension

Extension bertanggung jawab untuk:

- Terhubung ke WebSocket desktop dan melakukan handshake protocol.
- Menerima batch dan command automation.
- Mendukung upload batch JSON manual pada Legacy Mode.
- Menyimpan dan memulihkan state automation.
- Memetakan gambar passport dari path desktop atau file yang dipilih user.
- Menjalankan seluruh navigasi, autofill, upload, retry, pause, reset, dan resume pada Nusuk.
- Mengirim progress, completion, dan error kembali ke desktop.

Permission `chrome.debugger` merupakan dependency aktif untuk fallback `DOM.setFileInputFiles`. Permission ini bukan sisa Playwright/CDP desktop.

## Kontrak Data dan Protocol

Ada dua kontrak yang saling melengkapi:

1. Kontrak data passport/member:
   - OCR manifest: `passport-manifest-v1`.
   - Batch extension: `nusuk-entry-batch-v1`.
   - Resolved profile contract: `passport-extracted-resolved-profile-v4`.
2. Envelope WebSocket:
   - `protocolVersion: 1`.
   - Tipe pesan, sequence, correlation, retry, dan state transition berada di `shared-protocol/` dan modul Rust `src-tauri/src/protocol.rs`.

Batch automation hanya boleh memuat member dengan `reviewStatus === "VALID"` dan `reviewConfirmed === true`. Member anak harus mempunyai companion dewasa yang valid.

## State Runtime

Urutan normal integrasi adalah:

```text
Extension connect
  -> HELLO / HELLO_ACK
  -> READY
  -> Desktop LOAD_BATCH
  -> Extension BATCH_LOADED
  -> Desktop START
  -> CURRENT_MEMBER / CURRENT_STEP / PROGRESS
  -> MEMBER_COMPLETED
  -> SESSION_COMPLETED
```

Session manager menyimpan snapshot dan resume token agar extension dapat memulihkan automation setelah reload atau reconnect. Detail state machine berada di `shared-protocol/state-machine.md`.

## Status Implementasi

Sudah aktif:

- Desktop Tauri/React dengan lima halaman workflow.
- Python worker berbasis RapidOCR.
- Review dan koreksi manifest.
- Export batch JSON tervalidasi.
- WebSocket loopback desktop-extension.
- Console desktop untuk connection, Load Batch, Start, dan progress.
- Automation multi-member di extension.
- Retry, watchdog, pause/reset, resume, dan failure screenshot.
- Upload passport melalui DataTransfer dengan fallback `chrome.debugger`.
- Installer desktop yang membawa worker OCR standalone.
- GitHub Actions untuk build, signing updater, dan release Windows.

Sudah dihapus atau tidak digunakan:

- Playwright automation dari desktop.
- Browser remote-debug profile sebagai mekanisme orchestration desktop.
- Native messaging host.
- HTTP/polling bridge.

## Verifikasi

### Otomatis

```powershell
npm run desktop:test
npm --prefix chrome-extension test

cd python-ocr
.\.venv\Scripts\python.exe -m pytest tests\

cargo check --manifest-path passport-desktop\src-tauri\Cargo.toml
```

Test otomatis extension belum menggantikan verifikasi terhadap DOM Nusuk asli.

### End-to-End WebSocket

1. Jalankan desktop app dan buka halaman Nusuk yang sudah login.
2. Buka side panel extension.
3. Pastikan indikator desktop berubah menjadi Terhubung.
4. Scan atau load manifest, lalu selesaikan review semua member yang akan dikirim.
5. Pada halaman Entry, klik Load Batch.
6. Klik Start.
7. Pastikan current member, current step, progress, completion, dan error tampil di desktop.
8. Verifikasi upload passport dan seluruh form hingga success popup.
9. Uji minimal dua member, termasuk companion bila ada jamaah anak.

### End-to-End Legacy JSON

1. Aktifkan Legacy Mode di halaman Entry.
2. Export `nusuk-entry-batch.json`.
3. Upload JSON tersebut di panel extension.
4. Pilih folder/file passport.
5. Jalankan automation dari panel dan verifikasi hasilnya.

## Prioritas Lanjutan

1. Sinkronkan nomor versi desktop package, Tauri config, Cargo package, dan extension manifest.
2. Tambahkan integration test untuk handshake, Load Batch, Start, reconnect, dan session resume.
3. Hilangkan payload dummy atau komentar sprint/test yang masih tersisa di message router.
4. Tambahkan DOM fixture test untuk navigation, upload input, dan urutan automation steps.
5. Perluas golden dataset OCR, khususnya normalisasi `birthCity` dan `cityOfIssued`.
6. Dokumentasikan threat model data passport, IndexedDB extension, WebSocket loopback, dan permission debugger.

## Definition of Done Saat Ini

Project dianggap siap untuk release internal bila:

- Desktop dapat memproses folder passport dan menghasilkan manifest.
- Semua member yang dikirim sudah valid serta dikonfirmasi operator.
- Extension dapat terhubung ke WebSocket loopback dan menerima batch.
- Load Batch dan Start dari desktop menjalankan automation Nusuk.
- Progress dan hasil automation kembali ke desktop.
- Upload passport berhasil, termasuk fallback debugger bila diperlukan.
- Legacy JSON tetap dapat digunakan sebagai fallback.
- Installer membawa worker OCR dan tidak membawa data passport atau artifact review lokal.
