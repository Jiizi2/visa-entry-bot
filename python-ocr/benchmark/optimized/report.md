# Benchmark Performance Report

Laporan ini menyajikan hasil evaluasi kinerja baseline terperinci untuk ekstraksi MRZ menggunakan RapidOCR.

* **Tanggal Pembuatan**: 2026-06-30 14:40:24
* **Profil OCR**: optimized
* **Jumlah Paspor**: 115 (Sukses: 115, Gagal: 0)

---

## 1. Distribusi Waktu Eksekusi (Runtime)

| Parameter | Waktu (ms) |
| :--- | :---: |
| **Rata-rata (Average)** | 2879.7 ms |
| **Median** | 1558.0 ms |
| **Persentil 95 (P95)** | 6979.0 ms |
| **Persentil 99 (P99)** | 11227.0 ms |
| **Minimum** | 687 ms |
| **Maksimum** | 19040 ms |

### Histogram Distribusi Runtime
```text
0s - 1s : ████████████████████           (28)
1s - 2s : ██████████████████████████████ (41)
2s - 3s : ██                             (4)
3s - 4s : █████                          (7)
4s - 5s : ██████████                     (14)
5s+    : ███████████████                (21)
```

---

## 2. Detail Stage Timing Breakdown

| Stage | Call Count | Total Duration (ms) | Average Duration (ms) | Minimum (ms) | Maximum (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **load_image** | 134 | 694.9 | 6.0 | 0.6 | 43.8 |
| **document_detection** | 116 | 1621.4 | 14.1 | 1.1 | 82.8 |
| **resize** | 293 | 80.0 | 0.7 | 0.0 | 5.0 |
| **rotation** | 0 | 0 | 0.0 | 0.0 | 0.0 |
| **crop** | 158 | 0.0 | 0.0 | 0.0 | 0.0 |
| **variant_generation** | 177 | 36327.3 | 315.9 | 90.4 | 705.7 |
| **ocr** | 312 | 287537.9 | 2500.3 | 199.2 | 3815.9 |
| **candidate_selection** | 369 | 3.4 | 0.0 | 0.0 | 0.1 |
| **repair** | 372 | 23.5 | 0.2 | 0.0 | 0.2 |
| **validation** | 115 | 0.0 | 0.0 | 0.0 | 0.0 |
| **serialization** | 230 | 0.1 | 0.0 | 0.0 | 0.1 |

---

## 3. Efektivitas Rotasi (Orientation Effectiveness)

| Orientation | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **0°** | 312 | 115 | 287542.3 ms |
| **90°** | 0 | 0 | 0 ms |
| **180°** | 0 | 0 | 0 ms |
| **270°** | 0 | 0 | 0 ms |

---

## 4. Efektivitas Preprocessing Varian (Variant Effectiveness)

| Variant | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **gray** | 177 | 108 | 185870.2 ms |
| **clahe** | 70 | 5 | 54040.1 ms |
| **otsu** | 65 | 2 | 47632.1 ms |
| **adaptive** | 0 | 0 | 0 ms |

---

## 5. Efektivitas Ukuran Citra (Width Effectiveness)

| Width | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **1600px** | 312 | 115 | 287542.3 ms |

---

## 6. Analisis Fallback (Fallback Statistics)

* **Fallback Triggered**: 18 kali
* **Success After Fallback**: 18 kali
* **Additional OCR Runs Caused**: 0 runs
* **Additional Runtime**: 0 ms

---

## 7. Siklus Hidup Kandidat (Candidate Lifecycle)

* **Candidate Found**: 129 kali
* **Candidate Repaired**: 130 kali
* **Candidate Checksum OK**: 120 kali
* **Candidate Selected**: 115 kali

---

## 8. Outlier Investigation: Top 10 Slowest Passports

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (5)

* **Total Runtime**: 19.04 s
* **OCR Runs**: 18
* **Orientation Attempts**: 0°: 18 atts
* **Variant Attempts**: gray: 6 atts, clahe: 6 atts, otsu: 6 atts
* **Repair Count**: 6
* **Fallback Used**: YES
* **Selected Variant**: otsu
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 1.61 s
  * ocr: 17.36 s

### Passport: nusuk-crops

* **Total Runtime**: 11.23 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 1.06 s
  * ocr: 9.68 s

### Passport: nusuk-crops_Copy-of-Arif-Maulana-2fd7173f-crop

* **Total Runtime**: 9.93 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.99 s
  * ocr: 8.47 s

### Passport: PASSPOR_ADEN BUSTOMI

* **Total Runtime**: 7.64 s
* **OCR Runs**: 6
* **Orientation Attempts**: 0°: 6 atts
* **Variant Attempts**: gray: 2 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 5
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.31 s
  * ocr: 7.28 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (2)

* **Total Runtime**: 7.30 s
* **OCR Runs**: 8
* **Orientation Attempts**: 0°: 8 atts
* **Variant Attempts**: gray: 3 atts, clahe: 3 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: clahe
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.83 s
  * ocr: 6.39 s

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.35

* **Total Runtime**: 6.98 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.72 s
  * ocr: 6.18 s

### Passport: PASSPOR_NANAG RIDWAN IYUN

* **Total Runtime**: 6.77 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.80 s
  * ocr: 5.51 s

### Passport: 45 PAX_KAHARRUDDIN 1

* **Total Runtime**: 6.65 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 10
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.62 s
  * ocr: 5.96 s

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.36

* **Total Runtime**: 6.64 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.66 s
  * ocr: 5.90 s

### Passport: BATCH 2_WhatsApp Image 2026-06-15 at 00.19.00

* **Total Runtime**: 6.33 s
* **OCR Runs**: 4
* **Orientation Attempts**: 0°: 4 atts
* **Variant Attempts**: gray: 2 atts, clahe: 1 atts, otsu: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.42 s
  * ocr: 5.90 s


---

## 9. Outlier Investigation: Top 10 Fastest Passports

### Passport: FirstTest_NURHIDAYAH 1

* **Total Runtime**: 0.69 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.21 s
  * ocr: 0.47 s

### Passport: 45 PAX_ARIF

* **Total Runtime**: 0.79 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.13 s
  * ocr: 0.64 s

### Passport: PASSPOR_HANI HANIFAH

* **Total Runtime**: 0.82 s
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

### Passport: 45 PAX_ADIBAH 1

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
  * ocr: 0.69 s

### Passport: FirstTest_SUDARWATI 1

* **Total Runtime**: 0.85 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.22 s
  * ocr: 0.61 s

### Passport: 45 PAX_ISMINI 1

* **Total Runtime**: 0.87 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.14 s
  * ocr: 0.72 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.51 (3)

* **Total Runtime**: 0.88 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.16 s
  * ocr: 0.71 s

### Passport: 45 PAX_ACHMAD

* **Total Runtime**: 0.89 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.14 s
  * ocr: 0.73 s

### Passport: 45 PAX_MASKURDI

* **Total Runtime**: 0.89 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.19 s
  * ocr: 0.67 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (3)

* **Total Runtime**: 0.92 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.16 s
  * ocr: 0.75 s


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
*Seluruh dependensi detail tercatat lengkap di [dependency_analysis.json](file:///C:\visa-entry-bot\python-ocr\benchmark\optimized\dependency_analysis.json).*

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
| **disable_width_2000** | 0 | 0 | 115 |
| **width_1600_only** | 0 | 0 | 115 |
| **disable_fallback** | 0 | 18 | 97 |

---

## Cost vs Value

Perbandingan biaya runtime terhadap nilai kontribusi fitur:

| Feature | Runtime Cost (ms) | Attempt Count | Success Count | Saved Passports | Runtime Percentage |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **rotation_90** | 0 ms | 0 | 0 | 0 | 0.0% |
| **rotation_180** | 0 ms | 0 | 0 | 0 | 0.0% |
| **rotation_270** | 0 ms | 0 | 0 | 0 | 0.0% |
| **gray** | 185870.2 ms | 177 | 108 | 105 | 64.64% |
| **clahe** | 54040.1 ms | 70 | 5 | 5 | 18.79% |
| **otsu** | 47632.1 ms | 65 | 2 | 2 | 16.57% |
| **adaptive** | 0 ms | 0 | 0 | 0 | 0.0% |
| **width_1600** | 287542.3 ms | 312 | 115 | 115 | 100.0% |
| **width_2000** | 0 ms | 0 | 0 | 0 | 0.0% |
| **fallback** | 2444.1 ms | 2 | 18 | 18 | 0.85% |

---

## Risk Matrix

Matriks tingkat risiko optimasi jika fitur dieliminasi dari pipeline:

| Feature | Saved Passports | Risk Level | Runtime Cost (%) |
| :--- | :---: | :---: | :---: |
| **rotation_90** | 0 | **LOW** | 0.0% |
| **rotation_180** | 0 | **LOW** | 0.0% |
| **rotation_270** | 0 | **LOW** | 0.0% |
| **gray** | 105 | **VERY_HIGH** | 64.64% |
| **clahe** | 5 | **HIGH** | 18.79% |
| **otsu** | 2 | **MEDIUM** | 16.57% |
| **adaptive** | 0 | **LOW** | 0.0% |
| **width_1600** | 115 | **VERY_HIGH** | 100.0% |
| **width_2000** | 0 | **LOW** | 0.0% |
| **fallback** | 18 | **VERY_HIGH** | 0.85% |

---

## Key Findings

* **Rotation (90°/180°/270°)**: Total 528 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Adaptive Variant**: Total 0 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Width 2000px**: Total 0 attempts, 1 success count, 0 saved passports. Risk level is **LOW**.
* **Fallback Stage**: Total 2 attempts, 18 success count, 18 saved passports. Risk level is **VERY_HIGH**.
