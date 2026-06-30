# Benchmark Performance Report

Laporan ini menyajikan hasil evaluasi kinerja baseline terperinci untuk ekstraksi MRZ menggunakan RapidOCR.

* **Tanggal Pembuatan**: 2026-06-30 14:34:01
* **Profil OCR**: legacy
* **Jumlah Paspor**: 115 (Sukses: 115, Gagal: 0)

---

## 1. Distribusi Waktu Eksekusi (Runtime)

| Parameter | Waktu (ms) |
| :--- | :---: |
| **Rata-rata (Average)** | 7646.7 ms |
| **Median** | 1635.0 ms |
| **Persentil 95 (P95)** | 39021.0 ms |
| **Persentil 99 (P99)** | 40729.0 ms |
| **Minimum** | 649 ms |
| **Maksimum** | 45079 ms |

### Histogram Distribusi Runtime
```text
0s - 1s : ████████████████               (24)
1s - 2s : ██████████████████████████████ (45)
2s - 3s : ███                            (5)
3s - 4s : ░                              (1)
4s - 5s :                                (0)
5s+    : ██████████████████████████     (40)
```

---

## 2. Detail Stage Timing Breakdown

| Stage | Call Count | Total Duration (ms) | Average Duration (ms) | Minimum (ms) | Maximum (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **load_image** | 135 | 681.7 | 5.9 | 0.6 | 14.3 |
| **document_detection** | 116 | 1724.9 | 15.0 | 0.9 | 95.4 |
| **resize** | 488 | 245.7 | 2.1 | 0.0 | 4.9 |
| **rotation** | 33 | 5.1 | 0.5 | 0.0 | 2.1 |
| **crop** | 223 | 0.0 | 0.0 | 0.0 | 0.0 |
| **variant_generation** | 372 | 75789.4 | 659.0 | 100.1 | 694.5 |
| **ocr** | 1152 | 795263.5 | 6915.3 | 187.6 | 3583.3 |
| **candidate_selection** | 837 | 8.6 | 0.1 | 0.0 | 0.1 |
| **repair** | 401 | 24.5 | 0.2 | 0.0 | 0.2 |
| **validation** | 115 | 0.0 | 0.0 | 0.0 | 0.0 |
| **serialization** | 230 | 0.0 | 0.0 | 0.0 | 0.0 |

---

## 3. Efektivitas Rotasi (Orientation Effectiveness)

| Orientation | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **0°** | 624 | 115 | 514441.0 ms |
| **90°** | 176 | 0 | 106934.0 ms |
| **180°** | 176 | 0 | 72730.6 ms |
| **270°** | 176 | 0 | 101173.9 ms |

---

## 4. Efektivitas Preprocessing Varian (Variant Effectiveness)

| Variant | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **gray** | 372 | 108 | 305026.3 ms |
| **clahe** | 264 | 5 | 167806.4 ms |
| **otsu** | 259 | 2 | 162081.0 ms |
| **adaptive** | 257 | 0 | 160365.9 ms |

---

## 5. Efektivitas Ukuran Citra (Width Effectiveness)

| Width | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **1600px** | 639 | 114 | 482780.6 ms |
| **2000px** | 513 | 1 | 312498.8 ms |

---

## 6. Analisis Fallback (Fallback Statistics)

* **Fallback Triggered**: 19 kali
* **Success After Fallback**: 19 kali
* **Additional OCR Runs Caused**: 228 runs
* **Additional Runtime**: 444017.3 ms

---

## 7. Siklus Hidup Kandidat (Candidate Lifecycle)

* **Candidate Found**: 148 kali
* **Candidate Repaired**: 148 kali
* **Candidate Checksum OK**: 128 kali
* **Candidate Selected**: 115 kali

---

## 8. Outlier Investigation: Top 10 Slowest Passports

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (5)

* **Total Runtime**: 45.08 s
* **OCR Runs**: 43
* **Orientation Attempts**: 0°: 43 atts
* **Variant Attempts**: gray: 11 atts, clahe: 11 atts, otsu: 11 atts, adaptive: 10 atts
* **Repair Count**: 6
* **Fallback Used**: YES
* **Selected Variant**: otsu
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 2.75 s
  * ocr: 42.25 s

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.36

* **Total Runtime**: 40.73 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.98 s
  * ocr: 36.66 s

### Passport: 45 PAX_RIKA

* **Total Runtime**: 40.39 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.55 s
  * ocr: 36.68 s

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.35

* **Total Runtime**: 39.76 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.81 s
  * ocr: 35.85 s

### Passport: 45 PAX_HERLINES 1

* **Total Runtime**: 39.18 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.62 s
  * ocr: 35.47 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.51 (1)

* **Total Runtime**: 39.02 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.35 s
  * ocr: 35.58 s

### Passport: 45 PAX_JUMARNI 1

* **Total Runtime**: 38.93 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.52 s
  * ocr: 35.28 s

### Passport: 45 PAX_AISYAH

* **Total Runtime**: 38.60 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 4
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.50 s
  * ocr: 34.93 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (2)

* **Total Runtime**: 36.92 s
* **OCR Runs**: 66
* **Orientation Attempts**: 0°: 18 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 17 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: clahe
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.55 s
  * ocr: 33.26 s

### Passport: 45 PAX_PUJI

* **Total Runtime**: 36.62 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.47 s
  * ocr: 33.07 s


---

## 9. Outlier Investigation: Top 10 Fastest Passports

### Passport: FirstTest_NURHIDAYAH 1

* **Total Runtime**: 0.65 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.16 s
  * ocr: 0.46 s

### Passport: 45 PAX_YUSUP

* **Total Runtime**: 0.71 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.21 s
  * ocr: 0.49 s

### Passport: FirstTest_SUDARWATI 1

* **Total Runtime**: 0.78 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.21 s
  * ocr: 0.55 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.51 (3)

* **Total Runtime**: 0.83 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.13 s
  * ocr: 0.69 s

### Passport: FirstTest_MUH DARIAN

* **Total Runtime**: 0.90 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.17 s
  * ocr: 0.71 s

### Passport: BATCH 2_WhatsApp Image 2026-06-15 at 00.19.01

* **Total Runtime**: 0.91 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.13 s
  * ocr: 0.77 s

### Passport: FirstTest_HALIMAH 1

* **Total Runtime**: 0.91 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.15 s
  * ocr: 0.75 s

### Passport: FirstTest_KAMILA

* **Total Runtime**: 0.91 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.14 s
  * ocr: 0.74 s

### Passport: PASSPOR_HANI HANIFAH

* **Total Runtime**: 0.92 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.20 s
  * ocr: 0.67 s

### Passport: 45 PAX_ISMINI 1

* **Total Runtime**: 0.92 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.20 s
  * ocr: 0.71 s


---

## Decision Tree Analysis

Pohon keputusan pipeline MRZ direkonstruksi untuk menganalisis jalur eksekusi:
* **Direct Path (0° / gray)**: 69 paspor sukses langsung pada upaya pertama.
* **Rotation Path (90° / 180° / 270°)**: Rotasi diuji ketika direct path gagal.
* **Fallback Path**: Fallback terpicu jika seluruh kombinasi direct scan tidak menghasilkan MRZ yang valid.

---

## Dependency Analysis

Analisis dependensi eksklusif paspor terhadap fitur tertentu (15 paspor pertama ditampilkan):

| Passport ID | Depends On |
| :--- | :--- |
| **45 PAX_ABDULLAH** | independent |
| **45 PAX_ACHMAD** | independent |
| **45 PAX_ADIBAH 1** | independent |
| **45 PAX_AISYAH** | fallback |
| **45 PAX_ARIF** | independent |
| **45 PAX_DJUMADI** | independent |
| **45 PAX_FAITH 1** | independent |
| **45 PAX_HERLINES 1** | fallback |
| **45 PAX_IHSAN 1** | independent |
| **45 PAX_ISMINI 1** | independent |
| **45 PAX_JARIAH 1** | independent |
| **45 PAX_JUMARNI 1** | fallback |
| **45 PAX_KAHARRUDDIN 1** | fallback |
| **45 PAX_KARIM** | independent |
| **45 PAX_MAISARAH 1** | independent |
*Seluruh dependensi detail tercatat lengkap di [dependency_analysis.json](file:///C:\visa-entry-bot\python-ocr\benchmark\legacy\dependency_analysis.json).*

---

## Impact Simulation

Simulasi matematis dampak terhadap hasil ekstraksi jika fitur dihapus:

| Scenario | Passport Changed | Passport Failed | Passport Unaffected |
| :--- | :---: | :---: | :---: |
| **disable_rotation_90** | 0 | 0 | 115 |
| **disable_rotation_180** | 0 | 0 | 115 |
| **disable_rotation_270** | 0 | 0 | 115 |
| **disable_all_rotations** | 0 | 0 | 115 |
| **disable_adaptive** | 0 | 0 | 115 |
| **disable_otsu** | 0 | 2 | 113 |
| **disable_clahe** | 0 | 5 | 110 |
| **gray_only** | 0 | 7 | 108 |
| **disable_width_2000** | 1 | 0 | 114 |
| **width_1600_only** | 1 | 0 | 114 |
| **disable_fallback** | 0 | 19 | 96 |

---

## Cost vs Value

Perbandingan biaya runtime terhadap nilai kontribusi fitur:

| Feature | Runtime Cost (ms) | Attempt Count | Success Count | Saved Passports | Runtime Percentage |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **rotation_90** | 106934.0 ms | 176 | 0 | 0 | 13.45% |
| **rotation_180** | 72730.6 ms | 176 | 0 | 0 | 9.15% |
| **rotation_270** | 101173.9 ms | 176 | 0 | 0 | 12.72% |
| **gray** | 305026.3 ms | 372 | 108 | 104 | 38.35% |
| **clahe** | 167806.4 ms | 264 | 5 | 5 | 21.1% |
| **otsu** | 162081.0 ms | 259 | 2 | 2 | 20.38% |
| **adaptive** | 160365.9 ms | 257 | 0 | 0 | 20.16% |
| **width_1600** | 482780.6 ms | 639 | 114 | 111 | 60.71% |
| **width_2000** | 312498.8 ms | 513 | 1 | 0 | 39.29% |
| **fallback** | 68815.8 ms | 46 | 19 | 19 | 8.65% |

---

## Risk Matrix

Matriks tingkat risiko optimasi jika fitur dieliminasi dari pipeline:

| Feature | Saved Passports | Risk Level | Runtime Cost (%) |
| :--- | :---: | :---: | :---: |
| **rotation_90** | 0 | **LOW** | 13.45% |
| **rotation_180** | 0 | **LOW** | 9.15% |
| **rotation_270** | 0 | **LOW** | 12.72% |
| **gray** | 104 | **VERY_HIGH** | 38.35% |
| **clahe** | 5 | **HIGH** | 21.1% |
| **otsu** | 2 | **MEDIUM** | 20.38% |
| **adaptive** | 0 | **LOW** | 20.16% |
| **width_1600** | 111 | **VERY_HIGH** | 60.71% |
| **width_2000** | 0 | **LOW** | 39.29% |
| **fallback** | 19 | **VERY_HIGH** | 8.65% |

---

## Key Findings

* **Rotation (90°/180°/270°)**: Total 528 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Adaptive Variant**: Total 257 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Width 2000px**: Total 513 attempts, 1 success count, 0 saved passports. Risk level is **LOW**.
* **Fallback Stage**: Total 46 attempts, 19 success count, 19 saved passports. Risk level is **VERY_HIGH**.
