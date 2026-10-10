# EntryMate By Ghaniya

> Versi desktop: **1.0.25** | Extension manifest: **1.0.26** | Windows · macOS · Linux

Sistem otomasi entry data visa Haji/Umrah ke platform [Nusuk (masar.nusuk.sa)](https://masar.nusuk.sa). Terdiri dari aplikasi desktop, worker OCR lokal, dan browser extension. Desktop membuat file JSON otomatis setelah semua passport direview. Seret file dari halaman Entry langsung ke panel extension untuk memuat batch.

> **OCR Engine**: RapidOCR (ONNX Runtime) — ringan, cepat, dan tidak membutuhkan instalasi Tesseract di device target.

---

## Arsitektur

```
Folder Passport (foto .jpg / .png / .pdf)
  ↓
[1] Desktop App (Tauri + Rust + React)
    → Scan OCR via Python worker
    → Review & edit data
    -> Buat nusuk-entry-batch.json otomatis pada halaman 5
  (seret file JSON ke panel extension)
[2] Chrome Extension (MV3)
    -> Validasi dan simpan batch pada tab Nusuk tujuan
    -> Mulai pengisian dari panel atau widget extension
    -> Autofill form Nusuk otomatis
```

File JSON menyertakan data jamaah yang sudah direview dan path gambar passport dari batch yang sama. Folder hasil scan harus tetap berada di lokasi yang sama selama entry. Panel juga menyediakan pemilih file JSON dan tindakan tambahan untuk memilih folder/file passport bila diperlukan.

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
6. Buka halaman **Entry ke Nusuk** (halaman 5). `nusuk-entry-batch.json` dibuat otomatis; area seret aktif setelah file selesai dibuat.

### 2. Autofill Nusuk melalui file JSON

1. Buka Nusuk di Chrome, login, lalu buka panel extension **EntryMate By Ghaniya**.
2. Tahan dan seret file pada halaman Entry desktop ke area **Letakkan file JSON di sini** di panel extension.
3. Tunggu konfirmasi jumlah jamaah dan periksa folder serta jamaah pertama.
4. Pilih **Mulai pengisian** di panel atau widget extension. Dari Group List, extension membuka Mu'tamer List pada tab yang sama sebelum memulai.
5. Periksa status setiap jamaah di **Daftar nama entry**. Jika proses berhenti, pilih **Lanjutkan sisa** untuk mencoba jamaah yang sama atau **Lewati & lanjutkan** untuk mengerjakan nama berikutnya. Saat proses masih berjalan, pilih **Jeda** terlebih dahulu. Setelah antrean selesai, gunakan **Ulangi gagal / dilewati** untuk mencoba kembali nama yang ditunda.

**Pilih file JSON** tetap tersedia sebagai alternatif. Di desktop, **Buka folder file** langsung menampilkan lokasi file sehingga operator tidak perlu mencari sendiri. File yang tidak valid ditolak sebelum batch diganti. Batch aktif, dijeda, atau memiliki hasil simpan yang belum terkonfirmasi harus diperiksa dan direset sebelum menerima file baru. Batch dan checkpoint disimpan per tab; tab lain tidak memulihkan batch tersebut.

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
.\.venv\Scripts\python.exe scan_worker.py <path-folder-passport> [prepared-inputs.json]
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

## Pipeline OCR

Engine utama: **RapidOCR (ONNX Runtime)** — OCR berbasis deep learning yang berjalan lokal tanpa GPU.

Pipeline berjalan otomatis tanpa pilihan mode, dengan prioritas kualitas hasil. Foto yang sudah terbaca lengkap dapat selesai cepat; foto sulit mendapat budget OCR hingga 60 detik per foto. Fast path ringan membaca MRZ dan field visual; adaptive recovery berjalan ketika identitas belum lengkap, checksum per field gagal, atau bukti visual belum memadai. Fast path tetap memakai budget awal 15 detik dan dapat memakai sisa budget pemulihan. Pembacaan MRZ dibatasi 30 detik agar masih tersedia waktu untuk field visual dan pemeriksaan identitas. Inference dibatasi 15 detik per panggilan (dapat diatur melalui `OCR_TIMEOUT_SECONDS`), selalu mengikuti sisa budget tahap dan foto. Proses engine dihentikan ketika inference melewati batas waktu dan dibuat ulang pada panggilan berikutnya. Budget ini membatasi OCR; persiapan gambar, validasi, dan penyimpanan dapat menambah sedikit waktu proses. Semua hasil tetap memerlukan review manusia.

Foto paspor terbuka dua halaman diproses dengan rotasi otomatis dan pemisahan halaman identitas dari halaman lain serta latar kosong. OCR mencari dua baris MRZ agar kode tetap terbaca saat terdapat bingkai atau footer besar. Orientasi lain tetap dicoba jika pembacaan MRZ belum terverifikasi.

Deteksi halaman juga menangani foto dengan latar meja atau tangan, teks sedikit miring, dan gambar berukuran besar. Pencarian MRZ menyisakan waktu untuk membaca kolom visual. Jika MRZ terpotong atau tertutup, nama, nomor paspor, kewarganegaraan, jenis kelamin, dan tanggal dapat dipulihkan dari bukti yang terlihat. Nama tambahan pada halaman pengesahan tidak menggantikan nama halaman identitas. Nilai tempat lahir dan kantor perwakilan luar negeri yang terbaca jelas dipertahankan; MRZ yang tidak dapat diverifikasi dan perbedaan nama tetap memerlukan review.

Build release menjalankan tes Python dan memvalidasi snapshot benchmark terhadap kode, fixture, versi engine, serta hash model saat ini. Setelah mengubah OCR, refresh bukti agregat menggunakan foto fixture lokal:

```powershell
cd python-ocr
.\.venv\Scripts\python.exe scripts/verify_ocr_release.py --refresh
.\.venv\Scripts\python.exe scripts/verify_ocr_release.py
```

Snapshot agregat disimpan di `python-ocr/benchmark/ocr_release_validation.json`. Hasil per orang tetap di direktori lokal yang diabaikan Git, `python-ocr/.review/ocr-release-full.json`. CI memvalidasi snapshot dan menjalankan tes; benchmark foto asli dijalankan lokal sebelum memperbarui snapshot.

---

## Catatan Penting

- **Data lokal**: Passport, manifest, dan review artifact **tidak diupload ke GitHub**. Simpan di device masing-masing.
- **`chrome.debugger`**: Permission ini adalah dependency aktif extension, bukan legacy. Dibutuhkan sebagai fallback upload file passport di form Nusuk.
- **Automation berada di extension**: Desktop membuat JSON dan dapat membuka Nusuk. Kontrol pengisian dan progress berada di extension.
- **Pengiriman file lokal**: Tidak ada server atau koneksi WebSocket. Seret file native menyalin file hasil review, sehingga JSON asli tetap berada di folder hasil scan.
- **Isolasi batch**: Data, checkpoint, dan cache foto pilihan manual dibatasi per tab dan batch.

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
│       ├── src/lib.rs       # Tauri commands, OCR process, JSON export, native file handoff
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
├── shared-protocol/         # Arsip protokol lama (tidak digunakan)
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
