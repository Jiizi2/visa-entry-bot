# Benchmark Performance Report

Laporan ini menyajikan hasil evaluasi kinerja baseline terperinci untuk ekstraksi MRZ menggunakan RapidOCR.

* **Tanggal Pembuatan**: 2026-06-30 16:25:58
* **Profil OCR**: legacy
* **Jumlah Paspor**: 115 (Sukses: 115, Gagal: 0)

---

## 1. Distribusi Waktu Eksekusi (Runtime)

| Parameter | Waktu (ms) |
| :--- | :---: |
| **Rata-rata (Average)** | 6954.3 ms |
| **Median** | 1418.0 ms |
| **Persentil 95 (P95)** | 34153.0 ms |
| **Persentil 99 (P99)** | 39331.0 ms |
| **Minimum** | 519 ms |
| **Maksimum** | 40195 ms |

### Histogram Distribusi Runtime
```text
0s - 1s : ████████████████████████████   (38)
1s - 2s : ████████████████████████       (32)
2s - 3s : ██                             (3)
3s - 4s : █                              (2)
4s - 5s :                                (0)
5s+    : ██████████████████████████████ (40)
```

---

## 2. Detail Stage Timing Breakdown

| Stage | Call Count | Total Duration (ms) | Average Duration (ms) | Minimum (ms) | Maximum (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **load_image** | 135 | 602.8 | 5.2 | 0.6 | 14.9 |
| **document_detection** | 116 | 1466.9 | 12.8 | 1.1 | 86.0 |
| **resize** | 488 | 274.8 | 2.4 | 0.0 | 23.2 |
| **rotation** | 33 | 2.7 | 0.2 | 0.0 | 0.2 |
| **crop** | 223 | 0.0 | 0.0 | 0.0 | 0.0 |
| **variant_generation** | 372 | 65029.9 | 565.5 | 89.0 | 733.4 |
| **ocr** | 1152 | 727255.8 | 6324.0 | 189.4 | 3135.3 |
| **candidate_selection** | 837 | 8.0 | 0.1 | 0.0 | 0.1 |
| **repair** | 401 | 24.0 | 0.2 | 0.0 | 0.2 |
| **validation** | 115 | 0.2 | 0.0 | 0.0 | 0.1 |
| **serialization** | 230 | 0.0 | 0.0 | 0.0 | 0.0 |

---

## 3. Efektivitas Rotasi (Orientation Effectiveness)

| Orientation | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **0°** | 624 | 115 | 468381.8 ms |
| **90°** | 176 | 0 | 97826.5 ms |
| **180°** | 176 | 0 | 67970.4 ms |
| **270°** | 176 | 0 | 93091.4 ms |

---

## 4. Efektivitas Preprocessing Varian (Variant Effectiveness)

| Variant | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **gray** | 372 | 108 | 273902.9 ms |
| **clahe** | 264 | 5 | 154787.4 ms |
| **otsu** | 259 | 2 | 150173.0 ms |
| **adaptive** | 257 | 0 | 148406.7 ms |

---

## 5. Efektivitas Ukuran Citra (Width Effectiveness)

| Width | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **1600px** | 639 | 114 | 437656.2 ms |
| **2000px** | 513 | 1 | 289613.8 ms |

---

## 6. Analisis Fallback (Fallback Statistics)

* **Fallback Triggered**: 19 kali
* **Success After Fallback**: 19 kali
* **Additional OCR Runs Caused**: 228 runs
* **Additional Runtime**: 383516.1 ms

---

## 7. Siklus Hidup Kandidat (Candidate Lifecycle)

* **Candidate Found**: 148 kali
* **Candidate Repaired**: 148 kali
* **Candidate Checksum OK**: 128 kali
* **Candidate Selected**: 115 kali

---

## 8. Outlier Investigation: Top 10 Slowest Passports

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.35

* **Total Runtime**: 40.20 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 4.09 s
  * ocr: 36.01 s

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.36

* **Total Runtime**: 39.33 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.94 s
  * ocr: 35.30 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.51 (1)

* **Total Runtime**: 39.07 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.39 s
  * ocr: 35.58 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (5)

* **Total Runtime**: 38.43 s
* **OCR Runs**: 43
* **Orientation Attempts**: 0°: 43 atts
* **Variant Attempts**: gray: 11 atts, clahe: 11 atts, otsu: 11 atts, adaptive: 10 atts
* **Repair Count**: 6
* **Fallback Used**: YES
* **Selected Variant**: otsu
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 2.19 s
  * ocr: 36.16 s

### Passport: 45 PAX_AISYAH

* **Total Runtime**: 34.28 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 4
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 2.72 s
  * ocr: 31.41 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (2)

* **Total Runtime**: 34.15 s
* **OCR Runs**: 66
* **Orientation Attempts**: 0°: 18 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 17 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: clahe
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.22 s
  * ocr: 30.83 s

### Passport: 45 PAX_RIKA

* **Total Runtime**: 33.83 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 2.67 s
  * ocr: 31.00 s

### Passport: 45 PAX_JUMARNI 1

* **Total Runtime**: 33.75 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 2.80 s
  * ocr: 30.84 s

### Passport: 45 PAX_HERLINES 1

* **Total Runtime**: 33.48 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 2.69 s
  * ocr: 30.71 s

### Passport: 45 PAX_PUJI

* **Total Runtime**: 32.85 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 2.78 s
  * ocr: 30.00 s


---

## 9. Outlier Investigation: Top 10 Fastest Passports

### Passport: 45 PAX_YUSUP

* **Total Runtime**: 0.52 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.12 s
  * ocr: 0.38 s

### Passport: 45 PAX_MUH HANIF

* **Total Runtime**: 0.72 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.12 s
  * ocr: 0.58 s

### Passport: FirstTest_SUDARWATI 1

* **Total Runtime**: 0.73 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.21 s
  * ocr: 0.51 s

### Passport: 45 PAX_ISMINI 1

* **Total Runtime**: 0.76 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.12 s
  * ocr: 0.62 s

### Passport: FirstTest_NURHIDAYAH 1

* **Total Runtime**: 0.77 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.23 s
  * ocr: 0.53 s

### Passport: 45 PAX_MAISARAH 1

* **Total Runtime**: 0.78 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.12 s
  * ocr: 0.63 s

### Passport: 45 PAX_ARIF

* **Total Runtime**: 0.78 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.12 s
  * ocr: 0.65 s

### Passport: 45 PAX_SITI 1

* **Total Runtime**: 0.79 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.12 s
  * ocr: 0.66 s

### Passport: 45 PAX_SUWARTO 1

* **Total Runtime**: 0.80 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.12 s
  * ocr: 0.67 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (4)

* **Total Runtime**: 0.81 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.13 s
  * ocr: 0.67 s


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
| **rotation_90** | 97826.5 ms | 176 | 0 | 0 | 13.45% |
| **rotation_180** | 67970.4 ms | 176 | 0 | 0 | 9.35% |
| **rotation_270** | 93091.4 ms | 176 | 0 | 0 | 12.8% |
| **gray** | 273902.9 ms | 372 | 108 | 104 | 37.66% |
| **clahe** | 154787.4 ms | 264 | 5 | 5 | 21.28% |
| **otsu** | 150173.0 ms | 259 | 2 | 2 | 20.65% |
| **adaptive** | 148406.7 ms | 257 | 0 | 0 | 20.41% |
| **width_1600** | 437656.2 ms | 639 | 114 | 111 | 60.18% |
| **width_2000** | 289613.8 ms | 513 | 1 | 0 | 39.82% |
| **fallback** | 60277.2 ms | 46 | 19 | 19 | 8.29% |

---

## Risk Matrix

Matriks tingkat risiko optimasi jika fitur dieliminasi dari pipeline:

| Feature | Saved Passports | Risk Level | Runtime Cost (%) |
| :--- | :---: | :---: | :---: |
| **rotation_90** | 0 | **LOW** | 13.45% |
| **rotation_180** | 0 | **LOW** | 9.35% |
| **rotation_270** | 0 | **LOW** | 12.8% |
| **gray** | 104 | **VERY_HIGH** | 37.66% |
| **clahe** | 5 | **HIGH** | 21.28% |
| **otsu** | 2 | **MEDIUM** | 20.65% |
| **adaptive** | 0 | **LOW** | 20.41% |
| **width_1600** | 111 | **VERY_HIGH** | 60.18% |
| **width_2000** | 0 | **LOW** | 39.82% |
| **fallback** | 19 | **VERY_HIGH** | 8.29% |

---

## Key Findings

* **Rotation (90°/180°/270°)**: Total 528 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Adaptive Variant**: Total 257 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Width 2000px**: Total 513 attempts, 1 success count, 0 saved passports. Risk level is **LOW**.
* **Fallback Stage**: Total 46 attempts, 19 success count, 19 saved passports. Risk level is **VERY_HIGH**.
