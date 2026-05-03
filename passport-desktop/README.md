# Passport Entry Assistant

Desktop shell berbasis `Tauri + Rust` yang memakai worker `Python OCR` dari repo ini.

## Flow

1. User memilih folder passport atau folder grup.
2. Aplikasi desktop menjalankan `python-ocr/scan_worker.py`.
3. Worker Python memproses passport dan menulis `manifest.json`.
4. Frontend Tauri menampilkan hasil scan dalam tabel dan panel detail.
5. User mengekspor `nusuk-entry-batch.json` dari hasil scan terpilih.
6. User mengupload JSON tersebut ke browser extension Nusuk Autofill.
7. Extension menjalankan autofill di tab Nusuk normal, tanpa komunikasi langsung dengan aplikasi desktop.

## Struktur

- `src/`: frontend vanilla HTML/CSS/JS
- `src-tauri/src/lib.rs`: command Rust, export JSON, dan pemanggilan worker Python
- `../python-ocr/scan_worker.py`: worker OCR untuk Tauri
- `../python-ocr/scan_session.py`: helper scan reusable
- `../chrome-extension`: extension Nusuk Autofill berbasis upload JSON manual

## Menjalankan Saat Development

Prasyarat:

- Node.js
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- Virtualenv OCR di `python-ocr/.venv`
- Windows: Visual Studio Build Tools dengan workload `Microsoft.VisualStudio.Workload.VCTools`

Perintah:

```powershell
cd passport-desktop
npm install
npm run dev
```

## Catatan Windows

Pada sesi ini, `cargo check` belum bisa selesai karena mesin ini belum punya linker MSVC (`link.exe`). Log error terakhir menunjukkan Build Tools Windows butuh approval/UAC saat instalasi.

Kalau Build Tools sudah terpasang, verifikasi ulang dengan:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cd passport-desktop
cargo check --manifest-path src-tauri\Cargo.toml
npm run dev
```

## Catatan Fungsional

- Tombol `Export JSON` membuat `nusuk-entry-batch.json` di folder hasil scan.
- Desktop app tidak membuka browser, tidak menjalankan Playwright, dan tidak mengirim command ke extension.
- User membuka Nusuk secara normal, lalu memakai extension `chrome-extension` untuk upload JSON dan menjalankan autofill.
- Extension tidak memakai `chrome.debugger`. Untuk upload passport, user memilih folder/file passport dari panel extension, lalu extension mencocokkan file berdasarkan `fileName` atau `passportImagePath`.

## Legacy

Folder berikut masih ada sebagai referensi lama, tetapi bukan flow utama:

- `scripts/nusuk-automation/`
- `scripts/nusuk-click-automation.mjs`
- `browser-extension/nusuk-bridge-extension/`
- `scripts/native-host/`
- `bridge-contract/`
