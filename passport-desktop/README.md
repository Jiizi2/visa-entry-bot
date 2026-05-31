# EntryMate By Ghaniya

Desktop shell berbasis `Tauri + Rust` yang memakai worker `Python OCR` dari repo ini.

## Flow

1. User memilih folder passport atau folder grup.
2. Aplikasi desktop menjalankan `python-ocr/scan_worker.py`.
3. Worker Python memproses passport dan menulis `manifest.json`.
4. Frontend Tauri menampilkan hasil scan dalam tabel dan panel detail.
5. User mengekspor `nusuk-entry-batch.json` dari hasil scan terpilih.
6. User mengupload JSON tersebut ke browser extension EntryMate By Ghaniya.
7. Extension menjalankan autofill di tab Nusuk normal, tanpa komunikasi langsung dengan aplikasi desktop.

## Struktur

- `src/`: frontend vanilla HTML/CSS/JS
- `src-tauri/src/lib.rs`: command Rust untuk scan, load manifest, dan export JSON
- `../python-ocr/scan_worker.py`: worker OCR untuk Tauri
- `../python-ocr/scan_session.py`: helper scan reusable
- `../chrome-extension`: extension EntryMate By Ghaniya berbasis upload JSON manual

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

Build desktop membutuhkan linker MSVC (`link.exe`). Jika belum tersedia, install Visual Studio Build Tools 2022 dengan workload C++/MSVC.

Kalau Build Tools sudah terpasang, verifikasi dengan:

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
- Untuk release cepat/internal, extension tetap memakai permission `chrome.debugger` sebagai fallback upload file passport di halaman Nusuk.
- User memilih folder/file passport dari panel extension, lalu extension mencocokkan file berdasarkan `fileName` atau `passportImagePath`.
- Passport asli, manifest hasil scan, dan review artifact disimpan lokal per device dan tidak perlu diupload ke GitHub.

## Packaging Lokal

Build desktop installer:

```powershell
npm run desktop:build
```

Build paket lokal lengkap dari root repo:

```powershell
npm run package:local
```

Output berada di `.local-release/entrymate-by-ghaniya-<version>-<timestamp>/` dan berisi:

- satu file installer desktop `.exe` yang sudah membawa `scan_worker.exe` dan Tesseract
- ZIP extension untuk di-extract lalu dipasang dengan `Load unpacked`
- README singkat instalasi lokal

Paket lokal tidak menyertakan passport, review artifact, atau data group lokal.
Device target tidak perlu install Python atau Tesseract manual. Untuk kebutuhan debug portable, jalankan `powershell -ExecutionPolicy Bypass -File scripts/package-local-release.ps1 -IncludePortable` dari root repo.

## Cleanup

Flow lama berbasis Playwright/CDP, native-host, dan bridge command sudah dihapus dari desktop app. Flow utama sekarang tetap sederhana: scan, export JSON, lalu upload JSON ke extension.
