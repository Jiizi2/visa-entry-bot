# EntryMate By Ghaniya

> Versi desktop: **1.0.21** | Extension manifest: **1.0.19** | Windows · macOS · Linux

Sistem otomasi entry data visa Haji/Umrah ke platform [Nusuk (masar.nusuk.sa)](https://masar.nusuk.sa). Terdiri dari aplikasi desktop, worker OCR lokal, dan browser extension. Desktop dan extension terhubung melalui WebSocket lokal; ekspor/upload file JSON tetap tersedia sebagai mode legacy.

> **OCR Engine**: RapidOCR (ONNX Runtime) — ringan, cepat, dan tidak membutuhkan instalasi Tesseract di device target.

---

## Arsitektur

```
Folder Passport (foto .jpg / .png / .pdf)
  ↓
[1] Desktop App (Tauri + Rust + React)
    → Scan OCR via Python worker
    → Review & edit data
    → Kirim batch melalui WebSocket lokal
  ↓  (ws://127.0.0.1:9001-9005)
[2] Chrome Extension (MV3)
    → Terima batch dan perintah Start dari desktop
    → Autofill form Nusuk otomatis

Jalur fallback:
Desktop → Export nusuk-entry-batch.json → upload manual ke extension (Legacy Mode)
```

WebSocket hanya dibuka pada loopback `127.0.0.1`, bukan pada jaringan eksternal. Payload yang dikirim tetap mengikuti kontrak data member yang sama dengan batch JSON. Extension juga membutuhkan akses ke file passport: melalui path lokal yang dikirim desktop saat mode WebSocket, atau melalui pilihan folder/file user pada mode JSON manual.

---

## Komponen

| Komponen | Lokasi | Teknologi |
|---|---|---|
| Desktop App | `passport-desktop/` | Tauri 2 · Rust · React 19 · TypeScript · TailwindCSS 4 |
| OCR Worker | `python-ocr/` | Python 3.12 · RapidOCR (ONNX Runtime) · OpenCV |
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
6. Halaman **Otomatisasi Entry Nusuk** → kirim batch melalui WebSocket dan jalankan automation.
7. Bila WebSocket tidak digunakan, aktifkan **Legacy Mode** lalu export `nusuk-entry-batch.json`.

### 2. Autofill Nusuk via WebSocket (Mode Utama)

1. Buka Nusuk di browser, login seperti biasa.
2. Klik ikon extension **EntryMate By Ghaniya**.
3. Pastikan indikator extension pada halaman **Otomatisasi Entry Nusuk** di desktop berubah menjadi **Terhubung**.
4. Klik **Load Batch** di desktop untuk mengirim jamaah yang sudah direview.
5. Klik **Start** di desktop.
6. Extension mengisi form Nusuk dan mengirim progress kembali ke desktop.

Desktop menjalankan WebSocket lokal pada port pertama yang tersedia di rentang `9001-9005`. Panel extension mencoba rentang port yang sama dan melakukan handshake protokol sebelum menerima batch.

### 3. Autofill Nusuk via JSON (Legacy Mode)

1. Pada halaman terakhir desktop, aktifkan **Legacy Mode (JSON Manual)**.
2. Klik **Export to JSON** untuk membuat `nusuk-entry-batch.json`.
3. Upload file tersebut melalui panel extension.
4. Pilih folder/file passport agar extension dapat memetakan gambar berdasarkan `fileName` atau `passportImagePath`.
5. Pilih jamaah awal lalu mulai automation dari panel extension.

---

## Quickstart Development

### Prasyarat

- Node.js ≥ 20
- Rust / cargo ≥ 1.95 (install via [rustup](https://rustup.rs))
- Python 3.12 + virtualenv di `python-ocr/.venv`
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
- **`entrymate-by-ghaniya-desktop-<version>-setup.exe`** — Installer desktop, sudah membawa OCR worker executable (RapidOCR). Device target tidak perlu install Python atau dependency OCR lainnya.

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

Engine utama: **RapidOCR (ONNX Runtime)** — OCR berbasis deep learning yang berjalan lokal tanpa GPU.

| Mode | Budget | Cocok Untuk |
|---|---|---|
| `speed` | target 15-20 detik/foto | First pass ringan; panel lokasi mahal dilewati, second pass hanya memulihkan field identitas yang belum lengkap |
| `balanced` | 30 detik/foto | Penggunaan sehari-hari |
| `heavy` | 90 detik/foto | Foto buram, pencahayaan buruk |

---

## Catatan Penting

- **Data lokal**: Passport, manifest, dan review artifact **tidak diupload ke GitHub**. Simpan di device masing-masing.
- **`chrome.debugger`**: Permission ini adalah dependency aktif extension, bukan legacy. Dibutuhkan sebagai fallback upload file passport di form Nusuk.
- **Automation berada di extension**: Desktop tidak memakai Playwright atau memanipulasi DOM Nusuk. Desktop hanya membuka URL Nusuk bila diminta user, mengirim command/batch melalui WebSocket lokal, dan menerima event progress.
- **Dua mode transport**: WebSocket lokal adalah mode utama; export/upload JSON manual dipertahankan sebagai Legacy Mode.
- **Loopback saja**: server WebSocket bind ke `127.0.0.1` pada port `9001-9005`.

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
│       ├── src/lib.rs       # Tauri commands, OCR process, WebSocket orchestration
│       ├── src/transport/   # WebSocket loopback transport
│       └── src/protocol.rs  # Envelope dan tipe pesan automation
├── python-ocr/              # OCR worker (RapidOCR + OpenCV)
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
├── shared-protocol/         # Kontrak pesan WebSocket desktop-extension
├── data/                    # Folder data lokal (tidak di-git kecuali fixture)
├── .local-release/          # Output release lokal (tidak di-git)
└── PROJECT_PLAN.md          # Status arsitektur dan prioritas lanjutan
```

---

## Dokumentasi Lanjutan

- [`passport-desktop/README.md`](passport-desktop/README.md) — Detail desktop app
- [`chrome-extension/FEATURE_MATRIX.md`](chrome-extension/FEATURE_MATRIX.md) — Feature matrix dan checklist manual extension
- [`python-ocr/OCR_BASELINE.md`](python-ocr/OCR_BASELINE.md) — Baseline akurasi OCR
- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — Status arsitektur aktif dan prioritas lanjutan
- [`shared-protocol/`](shared-protocol/) — Registry pesan, state machine, sequence, dan retry WebSocket
