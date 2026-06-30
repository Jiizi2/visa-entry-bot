# Benchmark Performance Report

Laporan ini menyajikan hasil evaluasi kinerja baseline terperinci untuk ekstraksi MRZ menggunakan RapidOCR.

* **Tanggal Pembuatan**: 2026-06-30 14:59:40
* **Profil OCR**: legacy
* **Jumlah Paspor**: 115 (Sukses: 115, Gagal: 0)

---

## 1. Distribusi Waktu Eksekusi (Runtime)

| Parameter | Waktu (ms) |
| :--- | :---: |
| **Rata-rata (Average)** | 7545.7 ms |
| **Median** | 1536.0 ms |
| **Persentil 95 (P95)** | 38423.0 ms |
| **Persentil 99 (P99)** | 40090.0 ms |
| **Minimum** | 650 ms |
| **Maksimum** | 43889 ms |

### Histogram Distribusi Runtime
```text
0s - 1s : ███████████████                (23)
1s - 2s : ██████████████████████████████ (45)
2s - 3s : ███                            (5)
3s - 4s : █                              (2)
4s - 5s :                                (0)
5s+    : ██████████████████████████     (40)
```

---

## 2. Detail Stage Timing Breakdown

| Stage | Call Count | Total Duration (ms) | Average Duration (ms) | Minimum (ms) | Maximum (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **load_image** | 135 | 642.0 | 5.6 | 0.6 | 13.5 |
| **document_detection** | 116 | 1554.4 | 13.5 | 1.0 | 82.6 |
| **resize** | 488 | 244.9 | 2.1 | 0.0 | 4.8 |
| **rotation** | 33 | 3.0 | 0.3 | 0.0 | 0.2 |
| **crop** | 223 | 0.0 | 0.0 | 0.0 | 0.0 |
| **variant_generation** | 372 | 77027.3 | 669.8 | 91.2 | 765.3 |
| **ocr** | 1152 | 782967.6 | 6808.4 | 201.2 | 3863.0 |
| **candidate_selection** | 837 | 8.8 | 0.1 | 0.0 | 0.3 |
| **repair** | 401 | 24.8 | 0.2 | 0.0 | 0.3 |
| **validation** | 115 | 0.0 | 0.0 | 0.0 | 0.0 |
| **serialization** | 230 | 0.0 | 0.0 | 0.0 | 0.0 |

---

## 3. Efektivitas Rotasi (Orientation Effectiveness)

| Orientation | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **0°** | 624 | 115 | 505680.7 ms |
| **90°** | 176 | 0 | 106889.1 ms |
| **180°** | 176 | 0 | 70571.1 ms |
| **270°** | 176 | 0 | 99841.4 ms |

---

## 4. Efektivitas Preprocessing Varian (Variant Effectiveness)

| Variant | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **gray** | 372 | 108 | 298539.7 ms |
| **clahe** | 264 | 5 | 165607.7 ms |
| **otsu** | 259 | 2 | 160626.4 ms |
| **adaptive** | 257 | 0 | 158208.5 ms |

---

## 5. Efektivitas Ukuran Citra (Width Effectiveness)

| Width | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **1600px** | 639 | 114 | 474711.1 ms |
| **2000px** | 513 | 1 | 308271.2 ms |

---

## 6. Analisis Fallback (Fallback Statistics)

* **Fallback Triggered**: 19 kali
* **Success After Fallback**: 19 kali
* **Additional OCR Runs Caused**: 228 runs
* **Additional Runtime**: 426590.1 ms

---

## 7. Siklus Hidup Kandidat (Candidate Lifecycle)

* **Candidate Found**: 148 kali
* **Candidate Repaired**: 148 kali
* **Candidate Checksum OK**: 128 kali
* **Candidate Selected**: 115 kali

---

## 8. Outlier Investigation: Top 10 Slowest Passports

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (5)

* **Total Runtime**: 43.89 s
* **OCR Runs**: 43
* **Orientation Attempts**: 0°: 43 atts
* **Variant Attempts**: gray: 11 atts, clahe: 11 atts, otsu: 11 atts, adaptive: 10 atts
* **Repair Count**: 6
* **Fallback Used**: YES
* **Selected Variant**: otsu
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 2.94 s
  * ocr: 40.87 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (2)

* **Total Runtime**: 40.09 s
* **OCR Runs**: 66
* **Orientation Attempts**: 0°: 18 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 17 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: clahe
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.98 s
  * ocr: 36.02 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.51 (1)

* **Total Runtime**: 39.37 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.50 s
  * ocr: 35.76 s

### Passport: 45 PAX_RIKA

* **Total Runtime**: 39.00 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.32 s
  * ocr: 35.53 s

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.36

* **Total Runtime**: 38.89 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.78 s
  * ocr: 35.02 s

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.35

* **Total Runtime**: 38.42 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.79 s
  * ocr: 34.54 s

### Passport: 45 PAX_HERLINES 1

* **Total Runtime**: 37.00 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.35 s
  * ocr: 33.56 s

### Passport: 45 PAX_PUJI

* **Total Runtime**: 36.98 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.46 s
  * ocr: 33.44 s

### Passport: 45 PAX_JUMARNI 1

* **Total Runtime**: 36.85 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.37 s
  * ocr: 33.37 s

### Passport: thirdTest_HERLINES 1

* **Total Runtime**: 36.75 s
* **OCR Runs**: 65
* **Orientation Attempts**: 0°: 17 atts, 180°: 16 atts, 90°: 16 atts, 270°: 16 atts
* **Variant Attempts**: gray: 17 atts, clahe: 16 atts, otsu: 16 atts, adaptive: 16 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 3.39 s
  * ocr: 33.28 s


---

## 9. Outlier Investigation: Top 10 Fastest Passports

### Passport: 45 PAX_YUSUP

* **Total Runtime**: 0.65 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.22 s
  * ocr: 0.42 s

### Passport: FirstTest_SUDARWATI 1

* **Total Runtime**: 0.76 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.21 s
  * ocr: 0.53 s

### Passport: FirstTest_NURHIDAYAH 1

* **Total Runtime**: 0.78 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.22 s
  * ocr: 0.54 s

### Passport: 45 PAX_MUH HANIF

* **Total Runtime**: 0.87 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.20 s
  * ocr: 0.64 s

### Passport: FirstTest_AHMAD

* **Total Runtime**: 0.89 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.17 s
  * ocr: 0.70 s

### Passport: 45 PAX_ARIF

* **Total Runtime**: 0.89 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.18 s
  * ocr: 0.69 s

### Passport: 45 PAX_MAISARAH 1

* **Total Runtime**: 0.89 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.22 s
  * ocr: 0.65 s

### Passport: 45 PAX_ADIBAH 1

* **Total Runtime**: 0.93 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.22 s
  * ocr: 0.70 s

### Passport: 45 PAX_ISMINI 1

* **Total Runtime**: 0.94 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.22 s
  * ocr: 0.70 s

### Passport: 45 PAX_MASKURDI

* **Total Runtime**: 0.95 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.21 s
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
| **rotation_90** | 106889.1 ms | 176 | 0 | 0 | 13.65% |
| **rotation_180** | 70571.1 ms | 176 | 0 | 0 | 9.01% |
| **rotation_270** | 99841.4 ms | 176 | 0 | 0 | 12.75% |
| **gray** | 298539.7 ms | 372 | 108 | 104 | 38.13% |
| **clahe** | 165607.7 ms | 264 | 5 | 5 | 21.15% |
| **otsu** | 160626.4 ms | 259 | 2 | 2 | 20.51% |
| **adaptive** | 158208.5 ms | 257 | 0 | 0 | 20.21% |
| **width_1600** | 474711.1 ms | 639 | 114 | 111 | 60.63% |
| **width_2000** | 308271.2 ms | 513 | 1 | 0 | 39.37% |
| **fallback** | 67535.5 ms | 46 | 19 | 19 | 8.63% |

---

## Risk Matrix

Matriks tingkat risiko optimasi jika fitur dieliminasi dari pipeline:

| Feature | Saved Passports | Risk Level | Runtime Cost (%) |
| :--- | :---: | :---: | :---: |
| **rotation_90** | 0 | **LOW** | 13.65% |
| **rotation_180** | 0 | **LOW** | 9.01% |
| **rotation_270** | 0 | **LOW** | 12.75% |
| **gray** | 104 | **VERY_HIGH** | 38.13% |
| **clahe** | 5 | **HIGH** | 21.15% |
| **otsu** | 2 | **MEDIUM** | 20.51% |
| **adaptive** | 0 | **LOW** | 20.21% |
| **width_1600** | 111 | **VERY_HIGH** | 60.63% |
| **width_2000** | 0 | **LOW** | 39.37% |
| **fallback** | 19 | **VERY_HIGH** | 8.63% |

---

## Key Findings

* **Rotation (90°/180°/270°)**: Total 528 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Adaptive Variant**: Total 257 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Width 2000px**: Total 513 attempts, 1 success count, 0 saved passports. Risk level is **LOW**.
* **Fallback Stage**: Total 46 attempts, 19 success count, 19 saved passports. Risk level is **VERY_HIGH**.
