# OCR Migration Audit: Tesseract to RapidOCR

> **Status dokumen:** Arsip audit migrasi. Temuan yang menyebut PassportEye/Tesseract sebagai dependency aktif menggambarkan kondisi saat audit dibuat dan sudah tidak berlaku pada runtime terkini. `requirements.txt` dan `services/mrz_extractor.py` saat ini menggunakan RapidOCR tanpa PassportEye/Tesseract.

Laporan ini mendokumentasikan kondisi pada saat migrasi engine OCR dari **Tesseract** ke **RapidOCR (ONNX Runtime)**. Audit ini dipertahankan untuk riwayat keputusan dan tidak lagi menjadi sumber kebenaran runtime.

---

## 1. Fully Migrated

Daftar modul dan fungsi yang telah sepenuhnya menggunakan **RapidOCR** sebagai engine OCR utama:

* **Visual Field OCR Engine (`python-ocr/services/indonesia_field_ocr.py`)**:
  * Semua ekstraksi data visual paspor Indonesia (seperti `fullName`, `nationality`, `dob`, `gender`, `placeOfBirth`, `issueDate`, `expiryDate`, dan `issuingOffice`) menggunakan RapidOCR melalui sub-modul helper `collect_ocr_lines` dan `scan_region_texts`.
* **Visual Region Scanner (`python-ocr/services/visual_region_scanner.py`)**:
  * Fungsi inti `scan_region_texts` telah sepenuhnya dialihkan untuk memproses variant gambar dengan memanggil `run_rapid_ocr` dari module `ocr_runner.py`.
* **PDF Preflight Parser (`python-ocr/services/pdf_image_converter.py`)**:
  * Proses seleksi halaman paspor dalam PDF (`_score_pdf_page`) menggunakan RapidOCR (`_ocr_pdf_preflight_image` memanggil `run_rapid_ocr`) untuk mencari keyword paspor dan validasi struktur MRZ.
* **Direct MRZ Extraction (`python-ocr/services/mrz_extractor.py`)**:
  * Langkah awal pendeteksian MRZ (`_read_direct_mrz` -> `_extract_direct_mrz_from_region`) menggunakan RapidOCR untuk mengekstrak string MRZ secara langsung dari area bawah dokumen.

---

## 2. Partially Migrated

Daftar modul yang menggunakan kombinasi **RapidOCR** dan **Tesseract**:

* **MRZ Extractor (`python-ocr/services/mrz_extractor.py`)**:
  * **Aliran Proses**: Menggunakan RapidOCR sebagai pencarian MRZ langsung (`_read_direct_mrz`). Jika gagal atau tidak memenuhi batas kepercayaan tinggi (high confidence), sistem akan menggunakan library `passporteye` sebagai fallback (`_read_best_mrz` -> `_read_mrz`).
  * **Dependency**: Library `passporteye` secara internal bergantung penuh pada Tesseract untuk melakukan OCR pada area MRZ (membaca data via CLI `tesseract` or `pytesseract`).

---

## 3. Not Yet Migrated

Daftar modul yang masih sepenuhnya bergantung pada **Tesseract**:

* **PassportEye Library (`passporteye==2.2.2`)**:
  * Library pihak ketiga ini digunakan untuk ekstraksi MRZ cadangan (fallback). Tidak ada modul buatan sendiri (custom) yang 100% bergantung pada Tesseract, melainkan ketergantungan ini dijembatani lewat `passporteye`.

---

## 4. Legacy / Dead Code

Kode, konfigurasi, dependency, atau dokumentasi yang masih berkaitan dengan Tesseract tetapi sudah tidak digunakan lagi:

1. **Dead Imports & Functions di `pdf_image_converter.py`**:
   * Menampung import `pytesseract` (baris 11-14) dan fungsi helper `_resolve_tesseract_cmd` (baris 263-274) yang sama sekali tidak dipanggil di dalam file tersebut.
2. **Dead Guards di Date Extractors**:
   * Di dalam `issue_date_extractor.py` (baris 129) dan `expiry_date_extractor.py` (baris 188), fungsi `_collect_legacy_candidates` melakukan pengecekan `if cv2 is None or pytesseract is None: return []`. Namun, di dalam fungsi tersebut, pemanggilan OCR dilakukan melalui `collect_ocr_lines` (yang di bawahnya memanggil RapidOCR). Import dan pengecekan `pytesseract` di file-file ini adalah dead code.
3. **Outdated File References di `master_files.txt`**:
   * File `master_files.txt` masih mencantumkan `python-ocr/services/tesseract_runner.py` dan `python-ocr/tests/test_tesseract_runner.py` meskipun kedua file tersebut sudah dihapus dari repositori.
4. **Variabel & Mocking di Unit Test**:
   * Di `python-ocr/tests/test_ocr_performance_guards.py` (baris 1230), mock objek untuk `run_rapid_ocr` diberi nama variabel `tesseract`, yang merupakan sisa penamaan (legacy) dari kode lama.
5. **Konfigurasi PSM & OEM di `indonesia_field_ocr.py`**:
   * Pendefinisian parameter Tesseract seperti `psm` (Page Segmentation Mode) dan `oem` (OCR Engine Mode) di `FIELD_CONFIG` (baris 27-34) tetap ada, meskipun RapidOCR mengabaikan parameter tersebut. Begitu pula fungsi `_field_psm_values` yang secara hardcode mengembalikan `(1,)` dan loop `for psm in (1,):` yang hanya berjalan sekali.

---

## 5. Optimization Opportunities

Beberapa area logika yang sebelumnya dibuat khusus untuk keterbatasan Tesseract, tetapi tidak lagi relevan atau dapat dioptimalkan pasca migrasi RapidOCR:

### ⚠️ Duplikasi Pemanggilan RapidOCR pada Direct MRZ (Critical)
* **Kondisi Saat Ini**: Di `mrz_extractor.py` (fungsi `_extract_direct_mrz_from_region` baris 249-251):
  ```python
  for variant in _build_direct_mrz_variants(gray):
      for psm in (6, 7, 13):
          config = build_ocr_config(whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<", dpi=300)
          text = run_rapid_ocr(variant, config)
  ```
* **Masalah**: Karena engine di bawahnya adalah RapidOCR, parameter `psm` diabaikan sepenuhnya. Loop `for psm in (6, 7, 13)` menyebabkan RapidOCR dipanggil **3 kali** untuk setiap varian gambar dengan hasil teks yang identik. Jika ada 4 varian gambar, RapidOCR dipanggil **12 kali** secara berurutan.
* **Rekomendasi**: Hapus loop `for psm` agar RapidOCR hanya dieksekusi **1 kali** per varian gambar (total 4 kali panggilan). Hal ini akan mempercepat deteksi direct MRZ hingga **3x lipat**.

### ⚙️ Pemetaan Config String Tesseract (Medium)
* **Kondisi Saat Ini**: Logika `build_ocr_config` di `ocr_runner.py` merangkai argumen CLI Tesseract (seperti `--user-words`, `-c tessedit_char_whitelist=...`). Kemudian `run_rapid_ocr` menggunakan Regular Expression untuk mencari substring whitelist dalam config string tersebut guna menyaring output secara manual.
* **Rekomendasi**: Sederhanakan parameter fungsi `run_rapid_ocr` untuk menerima whitelist secara langsung sebagai parameter `whitelist: str = ""` daripada membungkus dan mengurai string opsi Tesseract.

### 🧹 Pembersihan Sisa Parameter PSM / OEM (Low)
* **Kondisi Saat Ini**: Parameter seperti `include_psm_fallback`, `oem`, dan `psm` diteruskan sepanjang rantai pemanggilan fungsi di `indonesia_field_ocr.py` dan `visual_region_scanner.py`, bahkan ikut dimasukkan ke dalam cache key regional.
* **Rekomendasi**: Hapus parameter-parameter ini secara bertahap dari tanda tangan fungsi untuk merapikan kode sumber dan mempermudah pemeliharaan jangka panjang.

---

## 6. Speed & Resource Optimizations for Speed Mode

Berikut adalah beberapa pendekatan yang diusulkan untuk meningkatkan kecepatan (speed) dan mengurangi konsumsi resources CPU/Memori pada **Speed Mode**:

### ⚡ Mengurangi Faktor Scaling Gambar (Downscaling/Resizing)
* **Masalah**: Pada `visual_region_scanner.py`, region gambar selalu di-scale sebesar 4.0x (`fx=4.0, fy=4.0`) sebelum dimasukkan ke RapidOCR. Ini meningkatkan resolusi gambar sebanyak **16 kali lipat** secara pixel. Hal ini adalah legacy pattern dari Tesseract yang sangat sensitif terhadap DPI/stroke. Model deep learning RapidOCR tidak memerlukan scaling sebesar ini.
* **Solusi**: Di mode `SPEED`, kurangkan scale factor dari 4.0x menjadi **1.5x atau 2.0x** (atau bahkan **1.0x** untuk region yang sudah cukup besar). Hal ini akan mempercepat inferensi ONNX Runtime hingga **60-80%** dan memangkas penggunaan memory secara drastis.

### ⚡ Pemrosesan Gambar Varian Tunggal (Single-Pass OCR)
* **Masalah**: Fungsi `_build_variants` di `visual_region_scanner.py` menghasilkan 2 varian gambar (gambar scaled biasa dan gambar CLAHE) untuk mode `SPEED`. Hal ini menyebabkan RapidOCR mengeksekusi region tersebut 2 kali.
* **Solusi**: Batasi hanya **1 varian gambar** (misalnya hanya varian gambar normal hasil scale) khusus untuk mode `SPEED`. Ini akan mengurangi pemanggilan RapidOCR sebesar **50%** per field regional.

### ⚡ Melewati Fallback Tesseract / PassportEye Secara Aman
* **Masalah & Temuan Review**: Pada percobaan bypass sebelumnya, menonaktifkan fallback Tesseract menyebabkan seluruh proses pemindaian dilewati (crash/skip).
* **Penyebab**: Di `mrz_extractor.py` (baris 80-88), terdapat **strict initialization guards** di awal fungsi `extract_mrz_data`:
  ```python
  if pytesseract is None:
      raise RuntimeError("pytesseract is not installed.")
  tesseract_cmd = _resolve_tesseract_cmd()
  if tesseract_cmd is None:
      raise RuntimeError("Tesseract executable is not installed...")
  ```
  Pengecekan ini langsung melempar `RuntimeError` jika Tesseract tidak terinstall pada sistem, menyebabkan kegagalan instan pada tahap awal scan sekalipun user memilih mode `speed`.
* **Solusi**: Buat inisialisasi pengecekan Tesseract di `mrz_extractor.py` menjadi **kondisional**. Lakukan verifikasi `pytesseract` dan `tesseract_cmd` hanya jika mode scan saat ini adalah non-speed (`balanced` atau `heavy`) ATAU jika RapidOCR gagal mengekstrak direct MRZ dan terpaksa memicu fallback. Jika profilnya adalah `speed`, abaikan pengecekan awal ini secara aman.

### ⚡ Pembatasan CPU Threading ONNX Runtime yang Bersifat Opsional (Konfigurasi Dinamis)
* **Temuan Review**: Membatasi core thread secara ketat (`OMP_NUM_THREADS=1`) di laptop dengan komputasi/spesifikasi CPU terbatas justru akan membuat waktu pemrosesan menjadi sangat lambat karena hilangnya pemrosesan multi-threaded.
* **Solusi**: Jangan hardcode pembatasan thread di runtime. Biarkan ONNX Runtime beroperasi secara default (menggunakan multi-thread penuh) agar laptop dengan performa terbatas tetap cepat. Namun, sediakan environment variable opsional (misalnya `PASSPORT_OCR_MAX_THREADS`) sehingga lingkungan low-power/VPS murah yang butuh kestabilan CPU tetap bisa membatasi konsumsi core logical secara manual tanpa mengganggu client normal.

---

## 7. Performance Review

### Skema Metrik (Mismatch Naming)
* Metrik performa yang dihasilkan oleh Python worker (`main.py` dan `pipeline_stages.py`) masih dikirimkan ke aplikasi desktop Tauri dengan label key `"tesseract"`.
* Contoh output metrik:
  ```json
  "processingMetrics": {
      "tesseract": {
          "callCount": 146,
          "errorCount": 0,
          "totalMs": 123808,
          "maxMs": 3244
      }
  }
  ```
* **Dampak**: Meskipun engine yang berjalan adalah RapidOCR, monitoring di frontend Tauri tetap membaca key `"tesseract"`. Hal ini membingungkan bagi developer baru yang membaca kode monitoring visual.

---

## 8. Rekomendasi pada Saat Audit (Historis)

Daftar berikut adalah rekomendasi ketika audit dibuat. Sebagian atau seluruh item dapat sudah selesai dan harus diverifikasi terhadap kode terkini sebelum dijadikan pekerjaan baru.

| Prioritas | Deskripsi Peningkatan | Dampak | Tingkat Kesulitan (Effort) | Lokasi File |
| :--- | :--- | :--- | :--- | :--- |
| **Critical** | Hapus loop redundant `for psm in (6, 7, 13)` pada direct MRZ extraction. | **Sangat Tinggi** (Mempercepat runtime direct MRZ scan hingga 3x lipat). | **Sangat Rendah** (Hanya menghapus satu baris indentasi loop). | [`mrz_extractor.py`](python-ocr/services/mrz_extractor.py) |
| **High** | Ubah pengecekan Tesseract di `extract_mrz_data` menjadi kondisional. | **Tinggi** (Mencegah scan skipped/crash saat Tesseract tidak terpasang di target machine). | **Rendah** (Bungkus validasi awal dengan pengecekan profile/fallback). | [`mrz_extractor.py`](python-ocr/services/mrz_extractor.py) |
| **High** | Turunkan scale factor ke 2.0x dan hilangkan varian CLAHE untuk Speed Mode. | **Tinggi** (Mengurangi beban CPU/RAM dan mempercepat visual field scan hingga 70% di Speed mode). | **Rendah** (Modifikasi logic kondisional profile di visual scanner). | [`visual_region_scanner.py`](python-ocr/services/visual_region_scanner.py) |
| **High** | Lewati fallback Tesseract/PassportEye secara kondisional jika profile disetel ke `speed`. | **Tinggi** (Menghilangkan bottleneck runtime & dependency Tesseract di Speed mode). | **Rendah** (Pemeriksaan environment variable di MRZ extractor). | [`mrz_extractor.py`](python-ocr/services/mrz_extractor.py) |
| **High** | Hapus dead import dan fungsi pembantu Tesseract yang tidak digunakan. | **Sedang** (Merapikan kode & menghilangkan kebingungan dependency). | **Rendah** (Pembersihan baris import dan kode mati). | [`pdf_image_converter.py`](python-ocr/services/pdf_image_converter.py)<br>[`issue_date_extractor.py`](python-ocr/services/issue_date_extractor.py)<br>[`expiry_date_extractor.py`](python-ocr/services/expiry_date_extractor.py) |
| **Medium** | Dukung opsi konfigurasi dinamis `PASSPORT_OCR_MAX_THREADS` via env variable. | **Sedang** (Mengizinkan limitasi thread pada VPS murah tanpa memperlambat laptop client). | **Rendah** (Konfigurasi session options RapidOCR opsional). | [`ocr_runner.py`](python-ocr/services/ocr_runner.py) |
| **Medium** | Ubah nama key metrik dari `"tesseract"` menjadi `"rapidocr"` secara end-to-end. | **Rendah** (Klarifikasi data metrik pada dashboard monitoring). | **Sedang** (Memerlukan penyelarasan skema JSON antara Python worker dan parser Rust/TypeScript di Tauri). | [`main.py`](python-ocr/main.py)<br>[`pipeline_stages.py`](python-ocr/services/pipeline_stages.py)<br>[`lib.rs`](passport-desktop/src-tauri/src/lib.rs) |
| **Low** | Hapus parsing whitelist bergaya Tesseract di `ocr_runner.py` dan ganti dengan parameter langsung. | **Rendah** (Keterbacaan dan kesederhanaan kode). | **Rendah** (Refactor minor tanda tangan fungsi). | [`ocr_runner.py`](python-ocr/services/ocr_runner.py) |
