# Benchmark Performance Report

Laporan ini menyajikan hasil evaluasi kinerja baseline untuk ekstraksi MRZ menggunakan RapidOCR.

* **Tanggal Pembuatan**: 2026-06-30 01:41:11
* **Profil OCR**: balanced
* **Jumlah Paspor**: 115 (Sukses: 115, Gagal: 0)

---

## 1. Distribusi Waktu Eksekusi (Runtime)

| Parameter | Waktu (ms) |
| :--- | :---: |
| **Rata-rata (Average)** | 7021.2 ms |
| **Median** | 1436.0 ms |
| **Persentil 95 (P95)** | 35608.0 ms |
| **Persentil 99 (P99)** | 38346.0 ms |
| **Minimum** | 630 ms |
| **Maksimum** | 39136 ms |

### Histogram Distribusi Runtime
```text
0s - 1s : ███████████████████████████    (36)
1s - 2s : █████████████████████████      (34)
2s - 3s : ██                             (3)
3s - 4s : █                              (2)
4s - 5s :                                (0)
5s+    : ██████████████████████████████ (40)
```

---

## 2. Metrik Pemanggilan OCR & Alur Kerja

| Parameter | Nilai / Distribusi |
| :--- | :--- |
| **Rata-rata Pemanggilan RapidOCR** | 10.02 runs |
| **Maksimum Pemanggilan RapidOCR** | 66 runs |
| **Fallback Rate** | 16.52% (19 paspor) |
| **Direct Success Count** | 96 paspor |
| **Fallback Success Count** | 19 paspor |
| **Early Exit (Indonesian Fast Path)** | 115 paspor |

---

## 3. Distribusi Orientasi & Varian Sukses

### Distribusi Orientasi yang Diproses (Attempts)
* **0 derajat**: 624 kali
* **90 derajat**: 176 kali
* **180 derajat**: 176 kali
* **270 derajat**: 176 kali

### Distribusi Orientasi Sukses Akhir
* **0 derajat**: 115 paspor
* **90 derajat**: 0 paspor
* **180 derajat**: 0 paspor
* **270 derajat**: 0 paspor
* **Tidak Terdeteksi**: 0 paspor

### Distribusi Varian Biner Sukses Akhir
* **gray**: 108 paspor
* **clahe**: 5 paspor
* **otsu**: 2 paspor
* **adaptive**: 0 paspor
* **Tidak Terdeteksi**: 0 paspor

---

## 4. Ekstremum Paspor

* **Paspor Paling Cepat**: `45 PAX_YUSUP` (630 ms) - `[data/example-group/passports/SecondTest/45 PAX/YUSUP.png](file:///C:/visa-entry-bot/data/example-group/passports/SecondTest/45 PAX/YUSUP.png)`
* **Paspor Paling Lambat**: `entrmate2.0_WhatsApp Image 2026-06-14 at 23.03.49 (5)` (39136 ms) - `[data/example-group/passports/entrmate2.0/WhatsApp Image 2026-06-14 at 23.03.49 (5).jpeg](file:///C:/visa-entry-bot/data/example-group/passports/entrmate2.0/WhatsApp Image 2026-06-14 at 23.03.49 (5).jpeg)`
