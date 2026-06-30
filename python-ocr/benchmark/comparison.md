# Benchmark Profile Comparison Report

Laporan ini membandingkan kinerja dan akurasi antara pipeline **Legacy** (Baseline) dan pipeline **Optimized** (Hasil Optimasi).

---

## 1. Executive Summary

* **Legacy Runtime (Total)**: 879.37 s
* **Optimized Runtime (Total)**: 331.16 s
* **Runtime Saving**: **548.20 s (62.34%)**
* **Akurasi Legacy**: 100.00% (115/115)
* **Akurasi Optimized**: 100.00% (115/115)
* **Status Regresi**: **PASSED**

---

## 2. Performance Comparison

| Metric | Legacy | Optimized | Difference | Change (%) |
| :--- | :---: | :---: | :---: | :---: |
| **Total Runtime** | 879365.0 ms | 331161.0 ms | -548204.0 ms | -62.34% |
| **Average Runtime** | 7646.7 ms | 2879.7 ms | -4767.0 ms | -62.34% |
| **Total OCR Runs** | 1152 | 312 | -840 | -72.92% |
| **Average Runs / Image** | 10.02 | 2.71 | -7.30 | |

---

## 3. Accuracy & Fallback Comparison

| Metric | Legacy | Optimized | Difference |
| :--- | :---: | :---: | :---: |
| **Success Rate (Accuracy)** | 100.00% | 100.00% | 0.00% |
| **Fallback Triggered** | 19 | 18 | -1 |
| **Candidates Found** | 148 | 129 | -19 |

---

## 4. Regression Analysis

Berikut adalah paspor yang berhasil pada Legacy tetapi gagal pada Optimized:

| Passport ID | Legacy Status | Optimized Status | Reason |
| :--- | :---: | :---: | :--- |
| *None* | | | |

---

## 5. Candidate Difference Analysis

Berikut adalah paspor yang sukses pada kedua profil tetapi menggunakan kandidat variant, width, atau orientation yang berbeda:

| Passport ID | Legacy Candidate | Optimized Candidate | Reason / Difference |
| :--- | :--- | :--- | :--- |
| **45 PAX_SUTRIS 1** | Width: 2000<br>Variant: gray<br>Orient: 0° | Width: 1600<br>Variant: gray<br>Orient: 0° | Width changed from 2000px to 1600px |

---

## 6. Conclusion & Recommendation

Profil `optimized` menunjukkan penghematan runtime yang signifikan sebesar **62.34%** (548.20 detik) dan pengurangan OCR runs sebesar **840** tanpa adanya regresi akurasi (0 regresi dari 115 paspor). **DIREKOMENDASIKAN** untuk mengaktifkan profil optimized di produksi dengan menyetel variabel lingkungan `PASSPORT_OCR_PROFILE=optimized`.
