# Benchmark Performance Report

Laporan ini menyajikan hasil evaluasi kinerja baseline untuk ekstraksi MRZ menggunakan RapidOCR.

* **Tanggal Pembuatan**: 2026-06-30 02:08:55
* **Profil OCR**: balanced
* **Jumlah Paspor**: 115 (Sukses: 115, Gagal: 0)

---

## 1. Distribusi Waktu Eksekusi (Runtime)

| Parameter | Waktu (ms) |
| :--- | :---: |
| **Rata-rata (Average)** | 6965.1 ms |
| **Median** | 1402.0 ms |
| **Persentil 95 (P95)** | 36252.0 ms |
| **Persentil 99 (P99)** | 37201.0 ms |
| **Minimum** | 654 ms |
| **Maksimum** | 39548 ms |

### Histogram Distribusi Runtime
```text
0s - 1s : ██████████████████████████████ (42)
1s - 2s : ███████████████████            (27)
2s - 3s : ███                            (5)
3s - 4s : ░                              (1)
4s - 5s :                                (0)
5s+    : ████████████████████████████   (40)
```

---

## 2. Metrik Pemanggilan OCR & Alur Kerja

| Parameter | Nilai / Distribusi |
| :--- | :--- |
| **Rata-rata Pemanggilan RapidOCR** | 10.02 runs |
| **Median Pemanggilan RapidOCR** | 1.0 runs |
| **Persentil 95 (P95) OCR Runs** | 65.0 runs |
| **Maksimum Pemanggilan RapidOCR** | 66 runs |
| **Fallback Frequency** | 16.52% (19 paspor) |

---

## 3. Distribusi Orientasi & Varian Sukses

### Distribusi Orientasi Sukses Akhir
* **0 derajat**: 115 paspor
* **90 derajat**: 0 paspor
* **180 derajat**: 0 paspor
* **270 derajat**: 0 paspor

### Distribusi Varian Biner Sukses Akhir
* **gray**: 108 paspor
* **clahe**: 5 paspor
* **otsu**: 2 paspor
* **adaptive**: 0 paspor

---

## 4. Top 10 Slowest Images
```text
1.
entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (5)
39.5 sec
43 OCR Runs

2.
45 PAX_AISYAH
37.2 sec
65 OCR Runs

3.
45 PAX_RIKA
37.2 sec
65 OCR Runs

4.
45 PAX_JUMARNI 1
36.7 sec
65 OCR Runs

5.
45 PAX_HERLINES 1
36.3 sec
65 OCR Runs

6.
batch3_WhatsApp Image 2026-06-15 at 00.33.35
36.3 sec
65 OCR Runs

7.
batch3_WhatsApp Image 2026-06-15 at 00.33.36
35.7 sec
65 OCR Runs

8.
entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.51 (1)
35.3 sec
65 OCR Runs

9.
45 PAX_PUJI
35.0 sec
65 OCR Runs

10.
entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (2)
34.7 sec
66 OCR Runs

```

---

## 5. Top 10 Fastest Images
```text
1.
FirstTest_SUDARWATI 1
0.7 sec
1 OCR Runs

2.
45 PAX_YUSUP
0.7 sec
1 OCR Runs

3.
FirstTest_NURHIDAYAH 1
0.7 sec
1 OCR Runs

4.
PASSPOR_HANI HANIFAH
0.8 sec
1 OCR Runs

5.
45 PAX_SUWARTO 1
0.8 sec
1 OCR Runs

6.
45 PAX_ISMINI 1
0.8 sec
1 OCR Runs

7.
FirstTest_AHMAD
0.8 sec
1 OCR Runs

8.
45 PAX_SITI 1
0.8 sec
1 OCR Runs

9.
45 PAX_MAISARAH 1
0.8 sec
1 OCR Runs

10.
45 PAX_MUH HANIF
0.8 sec
1 OCR Runs

```
