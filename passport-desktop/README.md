# EntryMate By Ghaniya — Desktop App

Aplikasi desktop berbasis **Tauri 2 + Rust** dengan frontend **React 19 + TypeScript** yang menjalankan OCR passport via Python worker (RapidOCR).

---

## Alur Kerja

1. **Pilih Dokumen** — Pilih folder passport (foto .jpg/.png/.pdf) atau load manifest hasil scan sebelumnya.
2. **Siapkan Foto** _(opsional)_ — Preview semua foto, crop area passport, rotasi jika perlu, sebelum scan dimulai.
3. **Scan Berjalan** — Python OCR worker memproses setiap foto. Progress ditampilkan real-time via event Tauri.
4. **Review Data** — Cek dan edit data hasil OCR untuk setiap anggota. Konfirmasi data yang sudah benar.
5. **Export JSON** — Generate `nusuk-entry-batch.json` yang siap diupload ke extension.

**Output:** User mengupload JSON ke browser extension **EntryMate By Ghaniya**, lalu extension menjalankan autofill di tab Nusuk tanpa komunikasi langsung dengan desktop app.

---

## Struktur Folder

```
passport-desktop/
├── src/                        # Frontend React + TypeScript
│   ├── main.tsx                # Entry point React
│   ├── App.tsx                 # Root component + routing halaman + watchdog heartbeat
│   ├── store.ts                # Zustand global state (semua state app)
│   ├── pages/
│   │   ├── ImportPage.tsx      # Halaman 1: Pilih folder / load manifest
│   │   ├── PreparePage.tsx     # Halaman 2: Preview & crop foto
│   │   ├── ScanPage.tsx        # Halaman 3: Progress OCR real-time
│   │   ├── ReviewPage.tsx      # Halaman 4: Validasi & edit data
│   │   └── EntryPage.tsx       # Halaman 5: Export JSON
│   ├── components/
│   │   ├── TitleBar.tsx        # Custom title bar (minimize/maximize/close)
│   │   ├── Sidebar.tsx         # Navigasi antar halaman
│   │   ├── PassportForm.tsx    # Form edit data anggota
│   │   ├── CropTool.tsx        # Tool crop gambar passport
│   │   ├── CustomDatePicker.tsx
│   │   ├── MemberList.tsx
│   │   ├── PageTransition.tsx
│   │   └── UpdateDialog.tsx    # Dialog auto-update
│   └── utils/
│       ├── export.ts           # Logic filter & build batch JSON
│       ├── fields.ts           # Definisi field passport
│       ├── helpers.ts          # Fungsi utilitas umum
│       ├── members.ts          # Helper data member
│       ├── paths.ts            # Utilitas path file
│       └── transliterator.ts   # Transliterasi nama
└── src-tauri/
    ├── src/lib.rs              # Semua Tauri commands (backend Rust, ~1941 baris)
    ├── Cargo.toml              # Rust dependencies
    └── tauri.conf.json         # Konfigurasi app
```

---

## Menjalankan (Development)

### Prasyarat

- Node.js ≥ 20
- Rust toolchain (`rustup`, `cargo`, `rustc` ≥ 1.95)
- Python 3.12 + virtualenv di `python-ocr/.venv`
- Tesseract OCR _(opsional, hanya untuk fallback MRZ via passporteye)_
- **Windows**: Visual Studio Build Tools 2022 dengan workload C++/MSVC

### Perintah

```powershell
cd passport-desktop
npm install
npm run dev
```

### Verifikasi toolchain

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cargo check --manifest-path src-tauri\Cargo.toml
npm run dev
```

---

## Tauri Commands (Rust Backend)

| Command | Input | Output | Keterangan |
|---|---|---|---|
| `renderer_heartbeat` | — | `Ok(())` | Watchdog: React kirim sinyal hidup tiap 10 detik |
| `window_minimize` | — | `Ok(())` | Minimize jendela |
| `window_start_dragging` | — | `Ok(())` | Drag jendela (custom titlebar) |
| `window_toggle_maximize` | — | `bool` (status maximize) | Toggle maximize |
| `window_close` | — | `Ok(())` | Tutup jendela |
| `prepare_passport_images` | `selectedDir` | `Value` (session JSON) | Enumerate & konversi PDF → foto, sinkron |
| `start_scan` | `selectedDir`, `ocrMode`, `preparedManifestPath?` | `Ok(())` | Spawn OCR worker, stream event ke `scan-event` |
| `stop_scan` | — | `Ok(())` | Kill OCR worker (taskkill /T /F di Windows) |
| `open_path_location` | `path` | `Ok(())` | Buka file/folder di Explorer/Finder |
| `load_manifest` | `manifestPath` | `Value` (JSON) | Baca manifest.json |
| `save_manifest` | `manifestPath`, `manifestData` | `Ok(())` | Simpan manifest.json |
| `find_manifest_path` | `basePath` | `Option<String>` | Cari manifest.json di dalam folder (depth ≤ 6) |
| `resolve_passport_image_path` | `manifestPath`, `imagePath`, `fileName` | `Option<String>` | Cari path gambar passport |
| `load_passport_image_data` | `manifestPath`, `imagePath`, `fileName` | `Option<PassportImageData>` | Baca gambar → base64 data URL |
| `save_cropped_passport_image` | `manifestPath`, `memberId`, `fileName`, `dataUrl`, `crop` | `SavedPassportCrop` | Simpan crop ke `nusuk-crops/` |
| `save_prepared_passport_image` | `preparedManifestPath`, `itemId`, `dataUrl`, `crop`, `rotationDegrees?` | `Value` | Simpan foto edited ke `edited-images/` |
| `remove_prepared_passport_image` | `preparedManifestPath`, `itemId` | `Value` | Hapus item prepared, pindah file ke `removed-images/` |
| `create_nusuk_batch` | `manifestPath`, `selectedIds`, `manifestData?` | `String` (path) | Filter VALID+confirmed → tulis `nusuk-entry-batch.json` |

---

## Event Tauri (`scan-event`)

Event dikirim dari Rust ke frontend saat scan berjalan:

| Event | Payload | Keterangan |
|---|---|---|
| `scan_started` | `groupId`, `totalFiles`, `ocrProfile` | Scan mulai |
| `scan_progress` | `current`, `total`, `fileName` | Satu file selesai |
| `scan_stage` | `current`, `total`, `fileName`, `stage`, `message`, `fileProgress` | Sub-step per file |
| `scan_metric` | `current`, `total`, `fileName`, `metrics` | Metrik performa per file |
| `scan_perf_summary` | `summary` | Ringkasan performa setelah semua file selesai |
| `scan_complete` | `groupId`, `manifestPath`, `totalFiles`, `validCount`, `errorCount`, `reviewCount` | Scan selesai |
| `scan_error` | `code`, `message`, `stage`, `fatal` | Error non-fatal |
| `scan_failed` | `message` | Error fatal, scan berhenti |
| `scan_stopped` | `message` | Scan dibatalkan user |
| `scan_log` | `message` | Log teks umum dari worker |
| `scan_cancel_requested` | `message` | Konfirmasi stop diterima |

---

## Resiliensi & Stabilitas

### Renderer Watchdog (Rust)

- React mengirim `renderer_heartbeat` setiap **10 detik** via Tauri invoke.
- Rust memantau heartbeat setiap **15 detik**.
- Jika tidak ada heartbeat selama **75 detik**:
  1. Attempt 1: Reload window (`window.reload()`).
  2. Attempt 2: Restart seluruh app (`app.restart()`).
- Log ditulis ke `%LOCALAPPDATA%/entrymate-by-ghaniya/diagnostics.log`.

### WebView2 Hardening (Windows)

Menonaktifkan fitur-fitur Microsoft Edge enterprise (MAM, DLP, SSO, profil integrasi, dll) via env var `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` untuk menghindari interferensi dengan WebView2 di environment korporat.

---

## OCR Worker Discovery

Saat `start_scan` dipanggil, Rust mencari worker secara bertingkat:

1. **Release bundle**: `<repo>/python-ocr-dist/scan_worker.exe` (atau tanpa `.exe` di non-Windows)
2. **Development**: `<repo>/python-ocr/.venv/Scripts/python.exe` + `scan_worker.py`

Engine OCR utama adalah **RapidOCR (ONNX Runtime)** yang sudah ter-bundle di dalam worker executable. Tesseract hanya digunakan sebagai fallback oleh library `passporteye` untuk ekstraksi MRZ.

Tesseract (fallback) dicari di:
1. `<repo>/tesseract/tesseract.exe`
2. `<repo>/Tesseract-OCR/tesseract.exe`
3. `<repo>/python-ocr/tesseract/tesseract.exe`

---

## Packaging Lokal

### Build installer desktop saja

```powershell
npm run desktop:build
```

### Build paket lokal lengkap (dari root repo)

```powershell
npm run package:local
```

Output di `.local-release/entrymate-by-ghaniya-<version>-<timestamp>/`:
- `entrymate-by-ghaniya-desktop-<version>-setup.exe` — NSIS installer, membawa OCR worker (RapidOCR) + Tesseract (fallback MRZ)
- `README_LOCAL_RELEASE.md` — Panduan instalasi

Device target **tidak perlu install Python, Tesseract, atau dependency OCR lainnya**. Untuk portable debug:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-local-release.ps1 -IncludePortable
```

---

## Catatan Fungsional

- Tombol **Export JSON** membuat `nusuk-entry-batch.json` di folder hasil scan.
- Hanya member dengan `reviewStatus === "VALID"` dan `reviewConfirmed === true` yang masuk batch.
- Desktop app tidak membuka browser, tidak menjalankan Playwright, dan tidak mengirim command ke extension.
- User membuka Nusuk secara normal, lalu memakai extension `chrome-extension` untuk upload JSON dan menjalankan autofill.
- Untuk release cepat/internal, extension tetap memakai permission `chrome.debugger` sebagai fallback upload file passport di halaman Nusuk.
- Passport asli, manifest hasil scan, dan review artifact disimpan lokal per device dan tidak perlu diupload ke GitHub.

---

## Cleanup

Flow lama berbasis Playwright/CDP, native-host, dan bridge command sudah dihapus dari desktop app. Flow utama sekarang tetap sederhana: **scan → export JSON → upload JSON ke extension**.
