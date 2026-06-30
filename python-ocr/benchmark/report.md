# Benchmark Performance Report

Laporan ini menyajikan hasil evaluasi kinerja baseline terperinci untuk ekstraksi MRZ menggunakan RapidOCR.

* **Tanggal Pembuatan**: 2026-06-30 13:55:18
* **Profil OCR**: balanced
* **Jumlah Paspor**: 115 (Sukses: 115, Gagal: 0)

---

## 1. Distribusi Waktu Eksekusi (Runtime)

| Parameter | Waktu (ms) |
| :--- | :---: |
| **Rata-rata (Average)** | 7696.0 ms |
| **Median** | 1614.0 ms |
| **Persentil 95 (P95)** | 39321.0 ms |
| **Persentil 99 (P99)** | 41230.0 ms |
| **Minimum** | 565 ms |
| **Maksimum** | 43139 ms |

### Histogram Distribusi Runtime
```text
0s - 1s : ████████████                   (20)
1s - 2s : ██████████████████████████████ (48)
2s - 3s : ███                            (5)
3s - 4s : █                              (2)
4s - 5s :                                (0)
5s+    : █████████████████████████      (40)
```

---

## 2. Detail Stage Timing Breakdown

| Stage | Call Count | Total Duration (ms) | Average Duration (ms) | Minimum (ms) | Maximum (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **load_image** | 135 | 657.6 | 5.7 | 0.7 | 16.0 |
| **document_detection** | 116 | 1694.8 | 14.7 | 1.0 | 93.4 |
| **resize** | 488 | 272.1 | 2.4 | 0.0 | 16.5 |
| **rotation** | 33 | 3.5 | 0.3 | 0.0 | 1.0 |
| **crop** | 223 | 0.0 | 0.0 | 0.0 | 0.0 |
| **variant_generation** | 372 | 74734.5 | 649.9 | 111.2 | 797.0 |
| **ocr** | 1152 | 802108.0 | 6974.9 | 220.1 | 3404.7 |
| **candidate_selection** | 837 | 8.5 | 0.1 | 0.0 | 0.1 |
| **repair** | 401 | 24.5 | 0.2 | 0.0 | 0.3 |
| **validation** | 115 | 0.0 | 0.0 | 0.0 | 0.0 |
| **serialization** | 230 | 0.6 | 0.0 | 0.0 | 0.6 |

---

## 3. Efektivitas Rotasi (Orientation Effectiveness)

| Orientation | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **0°** | 624 | 115 | 516614.5 ms |
| **90°** | 176 | 0 | 108693.1 ms |
| **180°** | 176 | 0 | 74664.8 ms |
| **270°** | 176 | 0 | 102149.8 ms |

---

## 4. Efektivitas Preprocessing Varian (Variant Effectiveness)

| Variant | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **gray** | 372 | 108 | 306332.5 ms |
| **clahe** | 264 | 5 | 169223.2 ms |
| **otsu** | 259 | 2 | 164373.1 ms |
| **adaptive** | 257 | 0 | 162193.4 ms |

---

## 5. Efektivitas Ukuran Citra (Width Effectiveness)

| Width | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **1600px** | 639 | 114 | 485287.1 ms |
| **2000px** | 513 | 1 | 316835.1 ms |

---

## 6. Analisis Fallback (Fallback Statistics)

* **Fallback Triggered**: 19 kali
* **Success After Fallback**: 19 kali
* **Additional OCR Runs Caused**: 228 runs
* **Additional Runtime**: 436068.6 ms

---

## 7. Siklus Hidup Kandidat (Candidate Lifecycle)

* **Candidate Found**: 148 kali
* **Candidate Repaired**: 148 kali
* **Candidate Checksum OK**: 128 kali
* **Candidate Selected**: 115 kali

---

## 8. Outlier Investigation: Top 10 Slowest Passports

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (5)

* **Total Runtime**: 43.14 s
* **OCR Runs**: 43
* **Orientation Attempts**: 0°: 43 atts
* **Variant Attempts**: gray: 11 atts, clahe: 11 atts, otsu: 11 atts, adaptive: 10 atts
* **Repair Count**: 6
* **Fallback Used**: YES
* **Selected Variant**: otsu
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 2.89 s
  * ocr: 40.17 s

### Passport: 45 PAX_AISYAH

* **Total Runtime**: 41.23 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 4
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.55 s
  * ocr: 37.52 s

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.36

* **Total Runtime**: 40.44 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.85 s
  * ocr: 36.50 s

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.35

* **Total Runtime**: 40.08 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.95 s
  * ocr: 36.04 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (2)

* **Total Runtime**: 39.66 s
* **OCR Runs**: 66
* **Orientation Attempts**: 0°: 18 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 17 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: clahe
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.87 s
  * ocr: 35.69 s

### Passport: 45 PAX_HERLINES 1

* **Total Runtime**: 39.32 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.46 s
  * ocr: 35.78 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.51 (1)

* **Total Runtime**: 38.99 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.33 s
  * ocr: 35.58 s

### Passport: 45 PAX_PUJI

* **Total Runtime**: 38.88 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.42 s
  * ocr: 35.39 s

### Passport: 45 PAX_JUMARNI 1

* **Total Runtime**: 38.48 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.41 s
  * ocr: 34.96 s

### Passport: 45 PAX_RIKA

* **Total Runtime**: 36.06 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 2.76 s
  * ocr: 33.14 s


---

## 9. Outlier Investigation: Top 10 Fastest Passports

### Passport: 45 PAX_YUSUP

* **Total Runtime**: 0.57 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.13 s
  * ocr: 0.42 s

### Passport: FirstTest_NURHIDAYAH 1

* **Total Runtime**: 0.74 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.21 s
  * ocr: 0.52 s

### Passport: FirstTest_SUDARWATI 1

* **Total Runtime**: 0.75 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.21 s
  * ocr: 0.52 s

### Passport: 45 PAX_YUNITA

* **Total Runtime**: 0.83 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.12 s
  * ocr: 0.69 s

### Passport: 45 PAX_SITI 1

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

### Passport: 45 PAX_SUWARTO 1

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

### Passport: 45 PAX_TAUFIK

* **Total Runtime**: 0.84 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.13 s
  * ocr: 0.70 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.51 (3)

* **Total Runtime**: 0.85 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.13 s
  * ocr: 0.70 s

### Passport: 45 PAX_RASID 1

* **Total Runtime**: 0.85 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.13 s
  * ocr: 0.71 s

### Passport: 45 PAX_SUPARDIN 1

* **Total Runtime**: 0.86 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.13 s
  * ocr: 0.72 s


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
*Seluruh dependensi detail tercatat lengkap di [dependency_analysis.json](file:///C:\visa-entry-bot\python-ocr\benchmark\dependency_analysis.json).*

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
| **rotation_90** | 108693.1 ms | 176 | 0 | 0 | 13.55% |
| **rotation_180** | 74664.8 ms | 176 | 0 | 0 | 9.31% |
| **rotation_270** | 102149.8 ms | 176 | 0 | 0 | 12.73% |
| **gray** | 306332.5 ms | 372 | 108 | 104 | 38.19% |
| **clahe** | 169223.2 ms | 264 | 5 | 5 | 21.1% |
| **otsu** | 164373.1 ms | 259 | 2 | 2 | 20.49% |
| **adaptive** | 162193.4 ms | 257 | 0 | 0 | 20.22% |
| **width_1600** | 485287.1 ms | 639 | 114 | 111 | 60.5% |
| **width_2000** | 316835.1 ms | 513 | 1 | 0 | 39.5% |
| **fallback** | 67941.4 ms | 46 | 19 | 19 | 8.47% |

---

## Risk Matrix

Matriks tingkat risiko optimasi jika fitur dieliminasi dari pipeline:

| Feature | Saved Passports | Risk Level | Runtime Cost (%) |
| :--- | :---: | :---: | :---: |
| **rotation_90** | 0 | **LOW** | 13.55% |
| **rotation_180** | 0 | **LOW** | 9.31% |
| **rotation_270** | 0 | **LOW** | 12.73% |
| **gray** | 104 | **VERY_HIGH** | 38.19% |
| **clahe** | 5 | **HIGH** | 21.1% |
| **otsu** | 2 | **MEDIUM** | 20.49% |
| **adaptive** | 0 | **LOW** | 20.22% |
| **width_1600** | 111 | **VERY_HIGH** | 60.5% |
| **width_2000** | 0 | **LOW** | 39.5% |
| **fallback** | 19 | **VERY_HIGH** | 8.47% |

---

## Key Findings

* **Rotation (90°/180°/270°)**: Total 528 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Adaptive Variant**: Total 257 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Width 2000px**: Total 513 attempts, 1 success count, 0 saved passports. Risk level is **LOW**.
* **Fallback Stage**: Total 46 attempts, 19 success count, 19 saved passports. Risk level is **VERY_HIGH**.
