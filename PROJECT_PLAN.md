# EntryMate By Ghaniya Project Plan

## Ringkasan Tujuan

Project ini akan dirapikan menjadi dua bagian yang berdiri sendiri:

1. Aplikasi desktop Rust/Tauri menjalankan proses scan passport dan menghasilkan file JSON.
2. Browser extension membaca file JSON tersebut dari upload manual user, lalu menjalankan autofill di website Nusuk.

Aplikasi desktop dan extension tidak perlu saling berkomunikasi. User menjadi penghubung manual dengan cara mengambil hasil JSON dari aplikasi desktop lalu menguploadnya ke extension.

## Arsitektur Target

```text
Folder passport
  -> EntryMate By Ghaniya Desktop App
  -> OCR scan
  -> manifest.json / nusuk-entry-batch.json
  -> User upload JSON ke extension
  -> Extension autofill Nusuk
```

### Desktop App

Tanggung jawab desktop app:

- Memilih folder passport.
- Menjalankan scan.
- Menampilkan hasil scan dan review.
- Mengekspor JSON final untuk dipakai extension.

Yang tidak lagi menjadi tanggung jawab desktop app:

- Membuka browser Nusuk.
- Menjalankan Playwright automation.
- Mengirim command ke extension.
- Menunggu event dari extension.

### Browser Extension

Tanggung jawab extension:

- Menerima upload JSON dari user.
- Menampilkan daftar member.
- Menjalankan autofill pada tab Nusuk aktif.
- Mengelola upload file passport dari pilihan user.
- Untuk release cepat/internal, `chrome.debugger` tetap menjadi dependency aktif untuk fallback upload file ke halaman Nusuk.

Yang tidak lagi menjadi tanggung jawab extension:

- Native messaging ke app desktop.
- Polling command dari app.

## Hasil Scan Repo

Area penting yang ditemukan:

- `passport-desktop/`: aplikasi Tauri/Rust dan frontend desktop.
- `passport-desktop/src-tauri/src/lib.rs`: command Rust untuk scan, load manifest, dan export JSON.
- `passport-desktop/src/`: frontend desktop vanilla JS.
- `python-ocr/`: OCR worker dan generator manifest.
- `chrome-extension/`: extension lama dengan panel upload JSON dan automation DOM.
- Cleanup 2026-05-03: jalur Playwright/CDP, native-host, bridge extension skeleton, dan `bridge-contract` sudah dihapus dari desktop app.

## Baseline Sebelum Refactor

Baseline sudah diverifikasi pada 2026-05-03:

```powershell
cd passport-desktop
npm test
cargo check --manifest-path .\src-tauri\Cargo.toml

cd ..\python-ocr
.\.venv\Scripts\python.exe -m pytest tests\test_scan_session.py tests\test_parser.py tests\test_validator_manifest.py
```

Hasil:

- `npm test`: 5 passed.
- `cargo check`: passed.
- `pytest` subset OCR/manifest: 7 passed.

Toolchain tersedia:

- Node.js `v20.13.1`
- npm `10.5.2`
- cargo `1.95.0`
- Python `3.12.4`
- `python-ocr/.venv/Scripts/python.exe`

## Keputusan Teknis

### 1. JSON adalah kontrak utama

File JSON menjadi satu-satunya kontrak antara desktop app dan extension. Tidak ada API lokal, native host, WebSocket, HTTP bridge, atau polling command.

### OCR production readiness

Rencana peningkatan OCR passport Indonesia dicatat di `python-ocr/PARTIAL_REFACTOR_PLAN.md`. Dokumen tersebut menjadi acuan untuk refactor bertahap: mulai dari golden dataset dan benchmark, lalu MRZ validation, field evidence, mode OCR hemat resource, layout profile Indonesia, dan failure handling production.

### 2. Extension utama memakai `chrome-extension`

Folder `chrome-extension/` lebih cocok dijadikan basis karena sudah memiliki:

- Panel upload JSON.
- Penyimpanan state di `chrome.storage.local`.
- Preview member.
- Automation DOM yang cukup lengkap.

Skeleton bridge di dalam desktop app sudah dihapus; extension utama tetap `chrome-extension/`.

### 3. Browser debug dipertahankan untuk release internal

Flow lama yang memakai Playwright/CDP dan browser debug profile tetap tidak dipakai. Namun permission extension `chrome.debugger` dipertahankan untuk release cepat/internal karena upload file passport di halaman Nusuk membutuhkan fallback `DOM.setFileInputFiles`.

Target release internal:

- Edge/Chrome dengan remote debugging.
- Browser dev/debug profile.
- Native messaging host.

Hal yang tetap aktif:

- Permission `debugger` di `chrome-extension/manifest.json`.
- Message `NUSUK_DEBUGGER_SET_FILE` di `chrome-extension/background.js`.
- Fallback debugger dari `chrome-extension/content/upload-manager.js`.

### 4. Upload file tidak bisa hanya dari path JSON

Browser extension normal tidak bisa memasukkan file lokal ke `<input type="file">` hanya dari path string di JSON. Karena itu opsi praktis adalah:

- User upload JSON ke extension.
- User memilih folder/file passport sekali di extension.
- Extension melakukan mapping berdasarkan `fileName` atau `passportImagePath`.

Alternatif lain adalah memasukkan file sebagai base64 di JSON, tetapi ini tidak direkomendasikan karena JSON menjadi besar dan berat.

## Rencana Implementasi

### Fase 1: Rapikan kontrak JSON

- Pastikan output JSON punya struktur konsisten.
- Tambahkan `schemaVersion` jika belum ada.
- Pastikan setiap member punya `id`, `fileName`, `passportImagePath`, `passportExtracted`, `resolvedProfile`, dan `status`.
- Pastikan batch JSON final hanya berisi member yang siap entry.

### Fase 2: Ubah desktop app menjadi scan/export only

- Selesai: UI mengarah ke export JSON untuk extension.
- Selesai: command automation desktop sudah dilepas dari backend.
- Selesai: exporter JSON tetap memakai command batch.
- Selesai: README desktop tidak mengarahkan user ke Playwright/CDP.

### Fase 3: Bersihkan jalur bridge/native-host

- Selesai: skeleton bridge, native-host, dan runtime bridge contract dihapus.
- Selesai: command bridge backend dihapus.

### Fase 4: Stabilkan extension internal dengan debugger aktif

- Pertahankan permission `debugger` di `chrome-extension/manifest.json`.
- Pertahankan flow `NUSUK_DEBUGGER_SET_FILE` di `chrome-extension/background.js`.
- Pertahankan input folder/file passport di panel extension.
- Simpan file handle atau daftar file yang dipilih user di session extension.
- Mapping file berdasarkan `fileName` atau basename dari `passportImagePath`.
- Jalankan autofill DOM seperti sekarang, dengan fallback debugger hanya saat upload normal tidak cukup.

### Fase 5: Data lokal per device

- Passport asli, review artifact, dan manifest hasil scan disimpan lokal di device masing-masing.
- Jangan upload folder passport atau hasil review ke GitHub.
- Repo hanya perlu menyimpan kode, fixture yang memang aman, dan dokumentasi.
- Folder release lokal dibuat di `.local-release/` dan tidak ikut git.

### Fase 6: Verifikasi end-to-end manual

- Scan folder passport dari desktop app.
- Export JSON.
- Upload JSON di extension.
- Pilih folder/file passport di extension.
- Buka Nusuk normal, tanpa remote debugging browser.
- Jalankan autofill untuk minimal satu member.
- Pastikan upload passport berhasil; fallback `chrome.debugger` boleh aktif.

### Fase 7: Packaging lokal

- Build desktop installer:

```powershell
npm run desktop:build
```

- Build paket lokal lengkap:

```powershell
npm run package:local
```

- Output lokal berada di `.local-release/entrymate-by-ghaniya-<version>-<timestamp>/`.
- Paket berisi satu file installer desktop yang sudah membawa OCR worker executable + Tesseract, dan ZIP extension.
- Paket tidak berisi passport, review artifact, atau manifest group lokal.

## File Kandidat Perubahan

Desktop app:

- `passport-desktop/src/main.js`
- `passport-desktop/src/index.html`
- `passport-desktop/src/styles.css`
- `passport-desktop/src-tauri/src/lib.rs`
- `passport-desktop/README.md`

Extension:

- `chrome-extension/manifest.json`
- `chrome-extension/background.js`
- `chrome-extension/content.js`
- `chrome-extension/panel.html`
- `chrome-extension/panel.js`
- `chrome-extension/panel.css`
- `chrome-extension/popup.html`
- `chrome-extension/popup.js`

Legacy/cleanup yang sudah dibersihkan:

- Playwright/CDP automation desktop.
- Native-host bridge.
- Skeleton extension bridge.
- Runtime JSON `bridge-contract`.

## Definition of Done

Project dianggap sesuai target ketika:

- Desktop app bisa scan dan menghasilkan JSON.
- Desktop app tidak menjalankan browser automation.
- Extension bisa menerima JSON dari user.
- Extension bisa autofill di browser normal.
- Extension tetap memakai permission `chrome.debugger` sebagai dependency upload internal.
- Tidak ada kewajiban menjalankan Chrome/Edge dengan remote debugging.
- Dokumentasi utama menjelaskan alur manual app -> JSON -> extension.
- Packaging lokal menghasilkan satu file installer desktop dan ZIP extension tanpa data passport/review.
