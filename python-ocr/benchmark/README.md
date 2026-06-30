# MRZ Extraction Benchmark & Quality Gate Guide

Panduan ini mendokumentasikan alur pengujian kinerja, pembandingan profil, serta mekanisme pintu kualitas otomatis (*quality gate*) pada modul ekstraksi MRZ.

---

## 1. Alur Pengujian Kinerja (Benchmarking Workflow)

Untuk kolaborator baru atau pengujian continuous integration (CI), jalankan rangkaian perintah berikut secara berurutan:

### Langkah A: Menjalankan Benchmark
Eksekusi benchmark pada profil `optimized` (default produksi):
```bash
python scripts/benchmark_dataset.py --profile optimized --no-resume
```
Untuk menguji profil `legacy` (mode kompatibilitas):
```bash
python scripts/benchmark_dataset.py --profile legacy --no-resume
```
*Catatan: Setiap eksekusi otomatis memanggil penganalisis luring `analyze_evidence.py` untuk profil yang bersangkutan.*

### Langkah B: Membandingkan Kedua Profil
Jika kedua profil (`legacy` dan `optimized`) sudah dijalankan, jalankan pembanding untuk memproduksi berkas `comparison.json` dan `comparison.md`:
```bash
python scripts/compare_profiles.py
```

### Langkah C: Validasi Terhadap Performance Budget
Eksekusi validator pintu kualitas otomatis (Quality Gate) untuk mengecek kepatuhan optimized pipeline terhadap performance budget dan baseline snapshot:
```bash
python scripts/validate_benchmark.py --profile optimized
```

---

## 2. Struktur Direktori Benchmark

Seluruh keluaran benchmark diisolasi pada subfolder terpisah:
```text
python-ocr/
    benchmark/
        performance_budget.json  # Batas atas metrik OCR & Fallback
        baseline_snapshot.json   # Snapshot referensi historis Commit 10
        comparison.json          # File data perbandingan profil
        comparison.md            # Laporan markdown perbandingan visual
        legacy/                  # Artefak mentah & laporan profil Legacy
            report.md
            summary.json
            ocr_attempts.json
        optimized/               # Artefak mentah & laporan profil Optimized
            report.md
            summary.json
            ocr_attempts.json
```

---

## 3. Cara Kerja Validator (`validate_benchmark.py`)

Validator digunakan di CI/CD untuk memastikan tidak ada perubahan kode yang menurunkan akurasi atau mengembalikan bottleneck kinerja. 

### Kode Status Keluaran (Exit Codes)
* **`0`**: **PASS** atau **WARNING**. Semua budget akurasi, ocr attempts, dan fallback terpenuhi.
* **`1`**: **FAIL**. Terjadi regresi akurasi (ada paspor yang gagal dibaca), regresi fungsional dibanding legacy, atau total OCR attempts/fallback melebihi batas budget.
* **`2`**: **Missing Artifacts**. Berkas data benchmark tidak lengkap/belum dijalankan.

### Status Evaluasi
1. **Artifacts (PASS/FAIL)**: Memastikan semua file log ocr attempts dan per-image results lengkap. Jika FAIL $\rightarrow$ exit code 2.
2. **Accuracy (PASS/FAIL)**: Menguji apakah akurasi ekstraksi $\ge 100\%$ (sesuai budget). Jika akurasi turun $\rightarrow$ FAIL, exit code 1.
3. **OCR Attempts (PASS/FAIL)**: Menguji apakah jumlah RapidOCR runs $\le 320$ attempts (sesuai budget). Jika boros runs $\rightarrow$ FAIL, exit code 1.
4. **Fallback (PASS/FAIL)**: Menguji apakah pemanggilan fallback $\le 20$ kali (sesuai budget). Jika terlalu sering fallback $\rightarrow$ FAIL, exit code 1.
5. **Regression (PASS/FAIL)**: Memastikan tidak ada paspor yang sukses di legacy namun gagal di optimized. Jika ada $\rightarrow$ FAIL, exit code 1.
6. **Runtime (PASS/WARNING)**: Membandingkan total average/P95 runtime terhadap baseline snapshot. Jika runtime membengkak $> 1.5\times$ baseline, status bernilai WARNING (peringatan tertulis di console, namun exit code tetap 0 / lulus).

---

## 4. Pembaruan Baseline Snapshot

### Kapan baseline snapshot boleh diperbarui?
Baseline snapshot (`baseline_snapshot.json`) **hanya boleh diperbarui** apabila:
1. Anda sengaja melakukan perubahan algoritma/logika produksi yang meningkatkan akurasi secara riil.
2. Spesifikasi hardware mesin benchmark resmi berubah secara permanen (sehingga runtime rata-rata berubah).
3. Anda sengaja melakukan optimasi baru yang menurunkan baseline runtime secara signifikan dan ingin "mengunci" target performa baru tersebut.

### Cara memperbarui baseline snapshot:
Ubah nilai numerik di file [`benchmark/baseline_snapshot.json`](file:///c:/visa-entry-bot/python-ocr/benchmark/baseline_snapshot.json) secara manual sesuai metrik baru yang sukses divalidasi oleh benchmark runner.
