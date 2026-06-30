# Benchmark Performance Report

Laporan ini menyajikan hasil evaluasi kinerja baseline terperinci untuk ekstraksi MRZ menggunakan RapidOCR.

* **Tanggal Pembuatan**: 2026-06-30 16:33:12
* **Profil OCR**: optimized
* **Jumlah Paspor**: 115 (Sukses: 115, Gagal: 0)

---

## 1. Distribusi Waktu Eksekusi (Runtime)

| Parameter | Waktu (ms) |
| :--- | :---: |
| **Rata-rata (Average)** | 2657.5 ms |
| **Median** | 1424.0 ms |
| **Persentil 95 (P95)** | 6989.0 ms |
| **Persentil 99 (P99)** | 9141.0 ms |
| **Minimum** | 745 ms |
| **Maksimum** | 16962 ms |

### Histogram Distribusi Runtime
```text
0s - 1s : █████████████████████████      (32)
1s - 2s : ██████████████████████████████ (38)
2s - 3s : ██                             (3)
3s - 4s : █████████                      (12)
4s - 5s : ██████████                     (13)
5s+    : █████████████                  (17)
```

---

## 2. Detail Stage Timing Breakdown

| Stage | Call Count | Total Duration (ms) | Average Duration (ms) | Minimum (ms) | Maximum (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **load_image** | 134 | 614.8 | 5.3 | 0.6 | 13.3 |
| **document_detection** | 116 | 1475.9 | 12.8 | 1.0 | 82.3 |
| **resize** | 293 | 77.8 | 0.7 | 0.0 | 4.3 |
| **rotation** | 0 | 0 | 0.0 | 0.0 | 0.0 |
| **crop** | 158 | 0.0 | 0.0 | 0.0 | 0.0 |
| **variant_generation** | 177 | 34379.6 | 299.0 | 89.9 | 751.6 |
| **ocr** | 312 | 264458.0 | 2299.6 | 210.7 | 3021.1 |
| **candidate_selection** | 369 | 3.6 | 0.0 | 0.0 | 0.1 |
| **repair** | 372 | 23.3 | 0.2 | 0.0 | 0.2 |
| **validation** | 115 | 0.1 | 0.0 | 0.0 | 0.1 |
| **serialization** | 230 | 0.0 | 0.0 | 0.0 | 0.0 |

---

## 3. Efektivitas Rotasi (Orientation Effectiveness)

| Orientation | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **0°** | 312 | 115 | 264462.3 ms |
| **90°** | 0 | 0 | 0 ms |
| **180°** | 0 | 0 | 0 ms |
| **270°** | 0 | 0 | 0 ms |

---

## 4. Efektivitas Preprocessing Varian (Variant Effectiveness)

| Variant | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **gray** | 177 | 108 | 168019.1 ms |
| **clahe** | 70 | 5 | 51237.3 ms |
| **otsu** | 65 | 2 | 45205.9 ms |
| **adaptive** | 0 | 0 | 0 ms |

---

## 5. Efektivitas Ukuran Citra (Width Effectiveness)

| Width | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
| **1600px** | 312 | 115 | 264462.3 ms |

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

* **Total Runtime**: 16.96 s
* **OCR Runs**: 18
* **Orientation Attempts**: 0°: 18 atts
* **Variant Attempts**: gray: 6 atts, clahe: 6 atts, otsu: 6 atts
* **Repair Count**: 6
* **Fallback Used**: YES
* **Selected Variant**: otsu
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 1.17 s
  * ocr: 15.73 s

### Passport: nusuk-crops

* **Total Runtime**: 9.14 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.82 s
  * ocr: 7.88 s

### Passport: nusuk-crops_Copy-of-Arif-Maulana-2fd7173f-crop

* **Total Runtime**: 8.25 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.82 s
  * ocr: 7.00 s

### Passport: PASSPOR_ADEN BUSTOMI

* **Total Runtime**: 7.55 s
* **OCR Runs**: 6
* **Orientation Attempts**: 0°: 6 atts
* **Variant Attempts**: gray: 2 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 5
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.31 s
  * ocr: 7.19 s

### Passport: PASSPOR_NANAG RIDWAN IYUN

* **Total Runtime**: 7.54 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 1.12 s
  * ocr: 5.92 s

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.35

* **Total Runtime**: 6.99 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.68 s
  * ocr: 6.24 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (2)

* **Total Runtime**: 6.64 s
* **OCR Runs**: 8
* **Orientation Attempts**: 0°: 8 atts
* **Variant Attempts**: gray: 3 atts, clahe: 3 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: clahe
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.79 s
  * ocr: 5.77 s

### Passport: 45 PAX_IHSAN 1

* **Total Runtime**: 6.29 s
* **OCR Runs**: 4
* **Orientation Attempts**: 0°: 4 atts
* **Variant Attempts**: gray: 2 atts, clahe: 1 atts, otsu: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.36 s
  * ocr: 5.91 s

### Passport: batch3_WhatsApp Image 2026-06-15 at 00.33.36

* **Total Runtime**: 6.28 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 3
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.66 s
  * ocr: 5.56 s

### Passport: 45 PAX_AISYAH

* **Total Runtime**: 5.95 s
* **OCR Runs**: 7
* **Orientation Attempts**: 0°: 7 atts
* **Variant Attempts**: gray: 3 atts, clahe: 2 atts, otsu: 2 atts
* **Repair Count**: 4
* **Fallback Used**: YES
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.73 s
  * ocr: 5.09 s


---

## 9. Outlier Investigation: Top 10 Fastest Passports

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

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.51 (3)

* **Total Runtime**: 0.75 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.13 s
  * ocr: 0.61 s

### Passport: 45 PAX_YUSUP

* **Total Runtime**: 0.75 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.14 s
  * ocr: 0.60 s

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
  * ocr: 0.55 s

### Passport: 45 PAX_YUNITA

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
  * ocr: 0.64 s

### Passport: entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49

* **Total Runtime**: 0.82 s
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

### Passport: 45 PAX_MAISARAH 1

* **Total Runtime**: 0.83 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.22 s
  * ocr: 0.59 s

### Passport: 45 PAX_MUH HANIF

* **Total Runtime**: 0.83 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.21 s
  * ocr: 0.60 s

### Passport: 45 PAX_MASKURDI

* **Total Runtime**: 0.84 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.21 s
  * ocr: 0.61 s

### Passport: 45 PAX_ISMINI 1

* **Total Runtime**: 0.85 s
* **OCR Runs**: 1
* **Orientation Attempts**: 0°: 1 atts
* **Variant Attempts**: gray: 1 atts
* **Repair Count**: 3
* **Fallback Used**: NO
* **Selected Variant**: gray
* **Selected Orientation**: 0°
* **Stage Timing Breakdown**:
  * variant_generation: 0.23 s
  * ocr: 0.61 s


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
| **gray** | 168019.1 ms | 177 | 108 | 105 | 63.53% |
| **clahe** | 51237.3 ms | 70 | 5 | 5 | 19.37% |
| **otsu** | 45205.9 ms | 65 | 2 | 2 | 17.09% |
| **adaptive** | 0 ms | 0 | 0 | 0 | 0.0% |
| **width_1600** | 264462.3 ms | 312 | 115 | 115 | 100.0% |
| **width_2000** | 0 ms | 0 | 0 | 0 | 0.0% |
| **fallback** | 2053.7 ms | 2 | 18 | 18 | 0.78% |

---

## Risk Matrix

Matriks tingkat risiko optimasi jika fitur dieliminasi dari pipeline:

| Feature | Saved Passports | Risk Level | Runtime Cost (%) |
| :--- | :---: | :---: | :---: |
| **rotation_90** | 0 | **LOW** | 0.0% |
| **rotation_180** | 0 | **LOW** | 0.0% |
| **rotation_270** | 0 | **LOW** | 0.0% |
| **gray** | 105 | **VERY_HIGH** | 63.53% |
| **clahe** | 5 | **HIGH** | 19.37% |
| **otsu** | 2 | **MEDIUM** | 17.09% |
| **adaptive** | 0 | **LOW** | 0.0% |
| **width_1600** | 115 | **VERY_HIGH** | 100.0% |
| **width_2000** | 0 | **LOW** | 0.0% |
| **fallback** | 18 | **VERY_HIGH** | 0.78% |

---

## Key Findings

* **Rotation (90°/180°/270°)**: Total 528 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Adaptive Variant**: Total 0 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.
* **Width 2000px**: Total 0 attempts, 1 success count, 0 saved passports. Risk level is **LOW**.
* **Fallback Stage**: Total 2 attempts, 18 success count, 18 saved passports. Risk level is **VERY_HIGH**.
