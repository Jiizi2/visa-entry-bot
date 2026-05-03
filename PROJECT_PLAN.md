# Visa Entry Bot Project Plan

## Ringkasan Tujuan

Project ini akan dirapikan menjadi dua bagian yang berdiri sendiri:

1. Aplikasi desktop Rust/Tauri menjalankan proses scan passport dan menghasilkan file JSON.
2. Browser extension membaca file JSON tersebut dari upload manual user, lalu menjalankan autofill di website Nusuk.

Aplikasi desktop dan extension tidak perlu saling berkomunikasi. User menjadi penghubung manual dengan cara mengambil hasil JSON dari aplikasi desktop lalu menguploadnya ke extension.

## Arsitektur Target

```text
Folder passport
  -> Passport Desktop App
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
- Mengelola upload file passport dengan input manual user, bukan debugger browser.

Yang tidak lagi menjadi tanggung jawab extension:

- Native messaging ke app desktop.
- Polling command dari app.
- Menggunakan `chrome.debugger`.

## Hasil Scan Repo

Area penting yang ditemukan:

- `passport-desktop/`: aplikasi Tauri/Rust dan frontend desktop.
- `passport-desktop/src-tauri/src/lib.rs`: command Rust untuk scan, batch, automation, dan bridge.
- `passport-desktop/src/`: frontend desktop vanilla JS.
- `python-ocr/`: OCR worker dan generator manifest.
- `chrome-extension/`: extension lama dengan panel upload JSON dan automation DOM.
- `passport-desktop/browser-extension/nusuk-bridge-extension/`: extension bridge/native-host skeleton.
- `passport-desktop/scripts/nusuk-automation/`: Playwright automation yang masih punya mode browser debug/CDP.

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

### 2. Extension utama memakai `chrome-extension`

Folder `chrome-extension/` lebih cocok dijadikan basis karena sudah memiliki:

- Panel upload JSON.
- Penyimpanan state di `chrome.storage.local`.
- Preview member.
- Automation DOM yang cukup lengkap.

Folder `passport-desktop/browser-extension/nusuk-bridge-extension/` akan dianggap legacy/skeleton bridge.

### 3. Browser debug harus dihapus dari flow user

Flow lama yang memakai Playwright/CDP/browser debug tidak praktis untuk user. Target baru tidak boleh mewajibkan:

- Edge/Chrome dengan remote debugging.
- Browser dev/debug profile.
- `chrome.debugger`.
- Native messaging host.

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

- Ubah copy dan UI dari `Siapkan Data` menjadi export JSON untuk extension.
- Stop pemanggilan `run_nusuk_automation` dari frontend.
- Pertahankan `create_nusuk_batch` jika masih dipakai sebagai exporter.
- Nonaktifkan command automation yang tidak lagi dipakai dari UI.
- Update README desktop agar tidak mengarahkan user ke Playwright/CDP.

### Fase 3: Bersihkan jalur bridge/native-host

- Tandai `nusuk-bridge-extension` sebagai legacy atau pindahkan ke dokumentasi arsip.
- Hapus instruksi native-host dari flow utama.
- Jangan gunakan `contract_bridge_*` pada flow baru.

### Fase 4: Refactor extension agar tanpa debugger

- Hapus permission `debugger` dari `chrome-extension/manifest.json`.
- Hapus `chrome.debugger` flow dari `chrome-extension/background.js`.
- Tambahkan input folder/file passport di panel extension.
- Simpan file handle atau daftar file yang dipilih user di session extension.
- Mapping file berdasarkan `fileName` atau basename dari `passportImagePath`.
- Jalankan autofill DOM seperti sekarang, tetapi upload file memakai file yang dipilih user.

### Fase 5: Verifikasi end-to-end

- Scan folder passport dari desktop app.
- Export JSON.
- Upload JSON di extension.
- Pilih folder/file passport di extension.
- Buka Nusuk normal, bukan browser debug.
- Jalankan autofill untuk minimal satu member.
- Pastikan tidak ada permission `debugger` dan tidak ada kebutuhan remote debugging.

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

Legacy/cleanup:

- `passport-desktop/scripts/nusuk-click-automation.mjs`
- `passport-desktop/scripts/nusuk-automation/`
- `passport-desktop/browser-extension/nusuk-bridge-extension/`
- `passport-desktop/scripts/native-host/`
- `passport-desktop/bridge-contract/`

## Definition of Done

Project dianggap sesuai target ketika:

- Desktop app bisa scan dan menghasilkan JSON.
- Desktop app tidak menjalankan browser automation.
- Extension bisa menerima JSON dari user.
- Extension bisa autofill di browser normal.
- Extension tidak memakai `chrome.debugger`.
- Tidak ada kewajiban menjalankan Chrome/Edge dengan remote debugging.
- Dokumentasi utama menjelaskan alur manual app -> JSON -> extension.

