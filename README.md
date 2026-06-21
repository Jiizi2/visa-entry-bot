# EntryMate By Ghaniya

> Versi: **1.0.19** | Windows · macOS · Linux

Sistem otomasi entry data visa Haji/Umrah ke platform [Nusuk (masar.nusuk.sa)](https://masar.nusuk.sa). Terdiri dari tiga komponen yang beroperasi secara mandiri dan berkomunikasi lewat file JSON.

> **OCR Engine**: RapidOCR (ONNX Runtime) — ringan, cepat, dan tidak membutuhkan instalasi Tesseract di device target.

---

## Arsitektur

```
Folder Passport (foto .jpg / .png / .pdf)
  ↓
[1] Desktop App (Tauri + Rust + React)
    → Scan OCR via Python worker
    → Review & edit data
    → Export nusuk-entry-batch.json
  ↓  (manual: user ambil JSON, upload ke extension)
[2] Chrome Extension (MV3)
    → Upload JSON manifest
    → Pilih folder/file passport
    → Autofill form Nusuk otomatis
```

Desktop app dan extension **tidak berkomunikasi secara langsung**. JSON adalah satu-satunya kontrak.

---

## Komponen

| Komponen | Lokasi | Teknologi |
|---|---|---|
| Desktop App | `passport-desktop/` | Tauri 2 · Rust · React 19 · TypeScript · TailwindCSS 4 |
| OCR Worker | `python-ocr/` | Python 3.12 · RapidOCR (ONNX Runtime) · OpenCV · passporteye |
| Browser Extension | `chrome-extension/` | Chrome MV3 · Vanilla JS |
| Packaging | `scripts/` | PowerShell |

---

## Alur Kerja

### 1. Scan Passport (Desktop App)

1. Buka desktop app.
2. Halaman **Pilih Dokumen** → pilih folder passport atau load manifest lama.
3. Halaman **Siapkan Foto** (opsional) → preview, crop, dan rotasi foto sebelum scan.
4. Halaman **Scan Berjalan** → OCR otomatis berjalan, progress tampil real-time.
5. Halaman **Review Data** → cek dan edit data tiap anggota.
6. Halaman **Export JSON** → konfirmasi dan klik **Export to JSON**.
7. File `nusuk-entry-batch.json` tersimpan di folder hasil scan.

### 2. Autofill Nusuk (Browser Extension)

1. Buka Nusuk di browser, login seperti biasa.
2. Klik ikon extension **EntryMate By Ghaniya**.
3. Upload `nusuk-entry-batch.json`.
4. Pilih folder/file passport agar extension bisa mapping file gambar.
5. Pilih jamaah awal, klik **Mulai**.
6. Extension mengisi form Nusuk secara otomatis.

---

## Quickstart Development

### Prasyarat

- Node.js ≥ 20
- Rust / cargo ≥ 1.95 (install via [rustup](https://rustup.rs))
- Python 3.12 + virtualenv di `python-ocr/.venv`
- Tesseract OCR terinstall di sistem _(opsional, hanya untuk fallback MRZ via passporteye)_
- **Windows**: Visual Studio Build Tools 2022 dengan workload C++/MSVC

### Menjalankan Desktop App

```powershell
cd passport-desktop
npm install
npm run dev
```

### Menjalankan Python OCR Saja (CLI)

```powershell
cd python-ocr
.\.venv\Scripts\python.exe scan_worker.py <path-folder-passport> [speed|balanced|heavy]
```

### Test

```powershell
# Frontend tests
npm run desktop:test

# Rust check
cargo check --manifest-path passport-desktop\src-tauri\Cargo.toml

# Python tests
cd python-ocr
.\.venv\Scripts\python.exe -m pytest tests\
```

---

## Packaging Lokal

Build paket release lokal lengkap (installer desktop + extension):

```powershell
npm run package:local
```

Output di `.local-release/entrymate-by-ghaniya-<version>-<timestamp>/`:
- **`entrymate-by-ghaniya-desktop-<version>-setup.exe`** — Installer desktop, sudah membawa OCR worker executable (RapidOCR) dan Tesseract (untuk fallback MRZ). Device target tidak perlu install Python, Tesseract, atau dependency OCR lainnya.

Dengan flag portable:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-local-release.ps1 -IncludePortable
```

---

## Scripts

| Script | Perintah | Keterangan |
|---|---|---|
| Desktop dev | `npm run desktop:browser` | Browser backend dev mode |
| Desktop build | `npm run desktop:build` | Build desktop app release |
| Desktop test | `npm run desktop:test` | Jalankan test frontend |
| Package lokal | `npm run package:local` | Build paket release lokal lengkap |

---

## Mode OCR

Engine utama: **RapidOCR (ONNX Runtime)** — OCR berbasis deep learning yang berjalan lokal tanpa GPU. Tesseract hanya digunakan sebagai fallback untuk ekstraksi MRZ via library `passporteye`.

| Mode | Budget | Cocok Untuk |
|---|---|---|
| `speed` | 15 detik/foto | Batch besar, kualitas foto bagus |
| `balanced` | 30 detik/foto | Penggunaan sehari-hari |
| `heavy` | 90 detik/foto | Foto buram, pencahayaan buruk |

---

## Catatan Penting

- **Data lokal**: Passport, manifest, dan review artifact **tidak diupload ke GitHub**. Simpan di device masing-masing.
- **`chrome.debugger`**: Permission ini adalah dependency aktif extension, bukan legacy. Dibutuhkan sebagai fallback upload file passport di form Nusuk.
- **Tidak ada browser automation**: Desktop app tidak membuka browser, tidak menjalankan Playwright, dan tidak mengirim command ke extension.

---

## Struktur Repositori

```
visa-entry-bot/
├── passport-desktop/        # Desktop app (Tauri + React)
│   ├── src/                 # Frontend React/TypeScript
│   │   ├── pages/           # ImportPage, PreparePage, ScanPage, ReviewPage, EntryPage
│   │   ├── components/      # TitleBar, Sidebar, PassportForm, CropTool, dll
│   │   ├── store.ts         # Zustand global state
│   │   └── utils/           # export, fields, helpers, members, transliterator
│   └── src-tauri/           # Rust backend
│       └── src/lib.rs       # Semua Tauri commands (1941 baris)
├── python-ocr/              # OCR worker (RapidOCR + passporteye)
│   ├── scan_worker.py       # Entry point (dipanggil Rust)
│   ├── scan_session.py      # Session management
│   ├── main.py              # Pipeline OCR per file
│   └── services/            # 30 modul OCR (MRZ, panel, visual, name, date, dll)
├── chrome-extension/        # Browser extension MV3
│   ├── manifest.json        # Extension manifest
│   ├── background.js        # Service worker (debugger handler)
│   ├── content.js           # Content script entry
│   ├── content/             # 28 modul automation
│   ├── panel.html/js/css    # Panel UI
│   └── popup.html/js        # Popup UI
├── scripts/
│   └── package-local-release.ps1  # Packaging script
├── data/                    # Folder data lokal (tidak di-git kecuali fixture)
├── .local-release/          # Output release lokal (tidak di-git)
└── PROJECT_PLAN.md          # Rencana implementasi
```

---

## Dokumentasi Lanjutan

- [`passport-desktop/README.md`](passport-desktop/README.md) — Detail desktop app
- [`chrome-extension/FEATURE_MATRIX.md`](chrome-extension/FEATURE_MATRIX.md) — Feature matrix dan checklist manual extension
- [`python-ocr/OCR_BASELINE.md`](python-ocr/OCR_BASELINE.md) — Baseline akurasi OCR
- [`python-ocr/PARTIAL_REFACTOR_PLAN.md`](python-ocr/PARTIAL_REFACTOR_PLAN.md) — Roadmap peningkatan OCR
- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — Rencana arsitektur dan fase implementasi
