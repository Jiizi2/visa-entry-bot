# Rencana Peningkatan Akurasi OCR Tanpa Regresi Kecepatan

> **Status:** Implemented dan diverifikasi; rollout default aktif dengan rollback env
> **Tanggal:** 2026-07-22
> **Scope:** `python-ocr/`
> **Engine produksi yang dipertahankan pada fase utama:** `rapidocr-onnxruntime==1.4.4` / PP-OCRv4 Mobile / ONNX Runtime CPU
> **Target platform:** Windows desktop, CPU-only, worker standalone PyInstaller

## 0. Status Eksekusi per 2026-07-22

Implementasi inti sudah selesai dan strategi `spatial` telah menjadi default. Rollback tetap tersedia tanpa perubahan kode melalui `PASSPORT_OCR_LOCATION_STRATEGY=legacy`; mode `spatial_shadow` juga tetap tersedia.

Hasil verifikasi utama:

| Verifikasi | Hasil |
|---|---:|
| Golden training end-to-end | 17/17 valid, 0 error, 0 mismatch |
| Akurasi `birthCity` training | 16/16 (100%) |
| Akurasi `cityOfIssued` training | 16/16 (100%) |
| Latency training kandidat | avg 5.631 ms, P95 7.056 ms, max 7.622 ms |
| RapidOCR call training kandidat | 43 call |
| Baseline eksplorasi sebelum perubahan | avg 7.819 ms, P95 9.546 ms, 77 call, 17 mismatch |
| Regresi lokasi SecondTest | `birthCity` 44/44, `cityOfIssued` 43/43 setelah koreksi anchor |
| MRZ regression | 115/115 sukses; validator seluruh gate PASS |
| Unit/regression suite | 342 passed, 1 skipped |
| PyInstaller | build sukses; executable standalone memproses satu JPEG valid |

Perubahan kandidat memberi penurunan latency rata-rata sekitar 28%, penurunan P95 sekitar 26%, dan penurunan jumlah OCR call sekitar 44% terhadap baseline eksplorasi 17 gambar. Angka benchmark disimpan di `.review/` dan sengaja diabaikan release/Git karena berisi evidence lokal.

Gate yang masih terbuka bukan regresi OCR:

- `reviewCount=0` belum tercapai karena profile `speed` memang selalu menambahkan `FAST_SCAN_REVIEW`; seluruh 17 hasil akurat tetapi tetap ditandai review oleh kebijakan produk lama.
- Proyeksi laptop lambat 3x menghasilkan avg sekitar 16.893 ms dan P95 sekitar 21.168 ms, di atas target absolut 12.000/18.000 ms, walaupun kandidat jauh lebih cepat daripada baseline. Target atau kebijakan profile perlu diputuskan terpisah.
- Tiga measured run untuk median lintas-run belum dijalankan; script agregasi sudah tersedia di `scripts/compare_ocr_benchmarks.py`.
- Eksperimen PP-OCRv6 di Fase 6 tetap opsional dan tidak dipromosikan ke produksi.

## 1. Ringkasan Keputusan

Peningkatan kualitas scan akan dilakukan dengan memperbaiki cara pipeline memakai hasil OCR, bukan dengan langsung mengganti engine.

Urutan solusi yang dipilih:

1. Pertahankan RapidOCR PP-OCRv4 sebagai engine produksi selama fase utama.
2. Pertahankan MRZ sebagai sumber utama field identitas yang memiliki checksum.
3. Tambahkan hasil OCR terstruktur yang mempertahankan teks, confidence, dan bounding box.
4. Jalankan OCR visual terdeteksi paling banyak satu kali pada halaman paspor yang sudah disejajarkan, lalu gunakan hasil yang sama untuk beberapa field.
5. Ambil `placeOfBirth` dan `issuingOffice` berdasarkan relasi spasial terhadap label, bukan hanya daftar kandidat teks.
6. Gunakan recognition-only (`use_det=False`) pada crop satu baris hanya jika field belum ditemukan atau belum valid.
7. Jalankan CLAHE, sharpen, denoise, dan varian mahal hanya sebagai recovery selektif.
8. Uji PP-OCRv6 kembali hanya setelah pipeline baru stabil, melalui feature flag terpisah.

Desain target:

```text
Input image/PDF page
  -> direct MRZ lower-band OCR
  -> checksum and country validation
  -> aligned passport page
  -> one structured visual OCR pass
  -> spatial field resolver
  -> all required fields valid?
       |-- yes -> serialize result
       `-- no  -> targeted recognition-only crop
                    -> field-specific validation
                    -> selective preprocessing fallback
                    -> review/error decision
```

## 2. Latar Belakang dan Evidence

### 2.1 Baseline eksplorasi 17 golden image

Angka berikut berasal dari pengujian lokal pada 2026-07-22. Angka ini harus direproduksi dan disimpan oleh benchmark harness sebelum menjadi baseline resmi.

| Metrik | PP-OCRv4 produksi | PP-OCRv6 Small via adapter sementara |
|---|---:|---:|
| Valid record | 17/17 | 16/17 |
| Error record | 0 | 1 |
| Total mismatch | 17 | 25 |
| Rata-rata total | 7,819 ms | 7,965 ms |
| P95 total | 9,546 ms | 11,829 ms |
| Maksimum total | 10,492 ms | 18,863 ms |
| RapidOCR call | 77 | 102 |
| RapidOCR total | 50,255 ms | 40,258 ms |
| `birthCity` | 3/16 | 3/16 |
| `cityOfIssued` | 12/16 | 7/16 |

Smoke test full-page menunjukkan:

- PP-OCRv4 membaca nilai `birthCity` pada 16/16 label yang tersedia.
- PP-OCRv4 membaca nilai `cityOfIssued` pada 16/16 label yang tersedia.
- Rata-rata satu full-page inference PP-OCRv4 sekitar 2,155 ms.
- PP-OCRv6 lebih cepat untuk satu full-page inference, sekitar 1,202 ms, tetapi memicu recovery lebih banyak ketika dipasang ke pipeline lama.
- PP-OCRv6 menghasilkan variasi Unicode seperti `RÉDEB`; tanpa normalisasi yang benar, whitelist ASCII dapat mengubahnya menjadi kandidat yang tidak dikenal.
- PP-OCRv6 menghasilkan MRZ ber-confidence tinggi pada 17/17 sampel, tetapi belum drop-in compatible dengan crop, threshold, dan fallback PP-OCRv4.

### 2.2 Kesimpulan evidence

Kegagalan lokasi terutama terjadi setelah teks berhasil dibaca. Sumber masalah yang paling mungkin adalah:

- crop tidak mencakup nilai yang benar;
- label dan nilai tidak dipasangkan berdasarkan posisi;
- kandidat dari field lain masuk ke area pencarian;
- normalisasi menghapus karakter sebelum transliterasi Unicode;
- confidence dan validator domain belum digunakan bersama;
- detector dijalankan kembali pada crop yang sebenarnya sudah merupakan satu baris teks;
- fallback bertingkat menambah call tanpa selalu menambah informasi baru.

Karena itu, mengganti engine sebelum memperbaiki konsumsi hasil OCR berisiko menambah kompleksitas tanpa memperbaiki hasil akhir.

### 2.3 Baseline resmi yang sudah ada

Repo sudah mempunyai:

- `OCR_BASELINE.md` sebagai snapshot historis;
- `benchmark/baseline_snapshot.json` untuk baseline MRZ;
- `benchmark/performance_budget.json` untuk budget OCR attempts dan fallback;
- `tests/fixtures/ocr_benchmark_targets.json` untuk target akurasi dan latency;
- `tests/fixtures/ocr_low_power_assumption_targets.json` untuk proyeksi laptop lambat.

Snapshot historis tidak boleh langsung dianggap mewakili kode terkini. Fase 0 wajib menghasilkan baseline baru dari commit yang sama dengan implementasi yang akan dibandingkan.

## 3. Tujuan dan Non-Tujuan

### 3.1 Tujuan

- Meningkatkan `birthCity` dan `cityOfIssued` tanpa menurunkan field MRZ yang sudah stabil.
- Mengurangi OCR call berulang dengan memakai ulang satu hasil visual terstruktur.
- Menjaga average dan P95 latency dalam guardrail yang disepakati.
- Mempertahankan worker lokal, offline, CPU-only, dan kompatibel dengan PyInstaller.
- Menyediakan evidence field-level agar penyebab fallback dapat diaudit.
- Menyediakan rollback satu konfigurasi tanpa perubahan kontrak manifest.

### 3.2 Non-tujuan fase utama

- Mengganti runtime dengan PaddlePaddle, PyTorch, cloud OCR, atau GPU-only engine.
- Melatih model OCR baru dengan dataset 17 gambar.
- Mengubah schema manifest atau contract extension.
- Mengubah UI review secara besar.
- Menghapus legacy location extractor sebelum strategi baru terbukti selama rollout.
- Menyimpan raw OCR passport ke log produksi.

## 4. Guardrail dan Definition of Success

### 4.1 Quality gate utama

Gate akhir mengikuti target yang sudah ada di `tests/fixtures/ocr_benchmark_targets.json`:

| Area | Target akhir |
|---|---:|
| `status` | 100% |
| `passportNumber` | 100% |
| `nationality` | 100% |
| `dob` | 100% |
| `expiryDate` | 100% |
| `gender` | 100% |
| `issueDate` | >= 98% |
| `firstName` | >= 98% |
| `familyName` | >= 98% |
| `birthCity` | >= 95% |
| `cityOfIssued` | >= 95% |

Untuk fixture 17 gambar saat ini, target lokasi operasional minimum adalah 15/16. Target release tetap `mismatchCount == 0` untuk semua expected value yang sudah direview; bila target ini belum tercapai, perubahan tidak boleh menggantikan default lama.

### 4.2 Performance gate terhadap baseline reproduksi

Benchmark harus dijalankan minimal tiga kali setelah satu warm-up. Gunakan median antarrun untuk keputusan. Hard gate:

- average total tidak lebih lambat dari baseline lebih dari 5%;
- P95 total tidak lebih lambat dari baseline lebih dari 10%;
- max total tidak lebih lambat dari baseline lebih dari 10%;
- RapidOCR call tidak bertambah lebih dari 10%;
- target optimasi adalah call count lebih rendah atau sama dengan baseline;
- fallback tidak lebih banyak dari baseline;
- tidak ada record baru yang berubah dari `VALID` menjadi `ERROR` atau `NEEDS_REVIEW`.

Berdasarkan angka eksplorasi, batas sementara sampai baseline resmi dibuat adalah:

| Metrik | Baseline eksplorasi | Hard limit sementara |
|---|---:|---:|
| Average | 7,819 ms | 8,210 ms |
| P95 | 9,546 ms | 10,501 ms |
| Max | 10,492 ms | 11,541 ms |
| RapidOCR call / 17 image | 77 | 85 |

Budget laptop lambat tetap harus lolos target existing:

- average <= 12,000 ms;
- P95 <= 18,000 ms;
- max <= 25,000 ms setelah proyeksi multiplier yang dikonfigurasi.

### 4.3 Reliability gate

- Tidak ada exception OCR yang disembunyikan tanpa metric/error reason.
- Cache tidak boleh bocor antarfile atau antarsesi.
- Hasil harus deterministik untuk input dan konfigurasi yang sama.
- Manifest contract tidak berubah.
- Worker hasil PyInstaller dapat start dan memproses minimal satu JPG dan satu PDF.
- Installer tidak membawa fixture, review artifact, atau data passport.

## 5. Arsitektur Target

### 5.1 Structured OCR result

Tambahkan API baru tanpa merusak caller lama:

```python
@dataclass(frozen=True)
class OcrObservation:
    text: str
    normalized_text: str
    confidence: float
    box: tuple[tuple[float, float], ...]
    normalized_box: tuple[tuple[float, float], ...]
    center_x: float
    center_y: float
    width: float
    height: float

@dataclass(frozen=True)
class OcrDetailedResult:
    observations: tuple[OcrObservation, ...]
    elapsed_ms: int
    detector_used: bool
    classifier_used: bool
    source: str
```

Perubahan yang direncanakan:

- `services/ocr_runner.py`
  - tambah `run_rapid_ocr_detailed()`;
  - dukung `use_det`, `use_cls`, dan `use_rec` secara eksplisit;
  - pertahankan `run_rapid_ocr()` sebagai compatibility wrapper;
  - pindahkan whitelist filtering setelah Unicode normalization;
  - catat call type: `det_rec`, `rec_only`, atau `det_only`;
  - pertahankan exception boundary dan metrics existing.
- `services/models.py` atau modul baru `services/ocr_observation.py`
  - definisikan immutable observation/result model;
  - sediakan helper box normalization.

Compatibility rule:

- Semua caller existing tetap menerima string sampai dimigrasikan.
- Detailed API tidak mengubah output manifest.
- Tidak ada import model PP-OCRv6 pada fase ini.

### 5.2 Unicode dan text normalization

Urutan normalisasi wajib:

1. Unicode NFKD.
2. Hapus combining marks atau transliterasi ke ASCII untuk field yang memang ASCII.
3. Uppercase.
4. Normalisasi dash, slash, punctuation, dan whitespace.
5. Terapkan whitelist field.
6. Terapkan confusion repair hanya sesuai konteks field.

Contoh:

```text
TANJUNG RÉDEB
  -> NFKD
  -> TANJUNG REDEB
  -> whitelist
  -> TANJUNG REDEB
```

Larangan:

- Jangan mengganti huruf menjadi digit secara global.
- Jangan fuzzy-match lokasi sebelum kandidat spasial dipilih.
- Jangan mengubah output raw yang dipakai untuk evidence; simpan raw dan normalized secara terpisah di memori.

### 5.3 Full-page observation index

Tambahkan `PassportOcrIndex` per file/aligned page:

```python
@dataclass(frozen=True)
class PassportOcrIndex:
    observations: tuple[OcrObservation, ...]
    page_width: int
    page_height: int
    rotation_degrees: int
    source_key: str
```

Kemampuan minimum:

- query box yang overlap dengan normalized region;
- query baris di kanan label;
- query baris terdekat di bawah label;
- gabungkan box satu baris berdasarkan vertical overlap;
- pisahkan label dan value jika detector menggabungkannya;
- urutkan hasil berdasarkan reading order;
- cache berdasarkan file identity, transform, size, dan engine configuration.

Lokasi implementasi yang disarankan:

- modul baru `services/passport_ocr_index.py`;
- perluasan `services/ocr_result_cache.py` atau cache terpisah yang scope-nya jelas;
- integrasi dengan `services/passport_page.py` setelah alignment.

Semua koordinat yang dipakai oleh resolver disimpan dalam rasio `0.0..1.0` agar tetap valid setelah resize.

### 5.4 Spatial field resolver

Tambahkan resolver khusus untuk field visual, dimulai dari lokasi:

- `placeOfBirth` labels:
  - `PLACE OF BIRTH`;
  - `TEMPAT LAHIR`;
  - variasi OCR yang disetujui fixture.
- `issuingOffice` labels:
  - `ISSUING OFFICE`;
  - `KANTOR YANG MENGELUARKAN`;
  - variasi OCR yang disetujui fixture.

Candidate scoring mempertimbangkan:

1. exact/normalized label match;
2. posisi kandidat terhadap label;
3. jarak horizontal dan vertikal;
4. kesesuaian dengan layout profile;
5. OCR confidence;
6. keberadaan dalam location dictionary;
7. penalti noise/label text/date/nationality;
8. konsistensi kandidat dari full-page dan targeted recovery.

Scoring harus deterministik dan setiap komponen score dapat dijelaskan dalam debug evidence. Bobot tidak di-hardcode tersebar; letakkan dalam satu config atau helper yang diuji.

Urutan pemilihan:

```text
exact label + valid nearby value
  > layout-zone valid value
  > recognition-only recovery value
  > legacy location extractor
  > empty + review reason
```

`location_normalizer.py` tetap dipakai untuk validasi dan canonicalization. Dictionary tidak boleh menjadi sumber nilai tanpa OCR evidence.

### 5.5 Recognition-only recovery

RapidOCR versi produksi mendukung parameter:

```python
engine(image, use_det=False, use_cls=False, use_rec=True)
```

Recognition-only digunakan bila:

- crop diperkirakan hanya berisi satu baris;
- label ditemukan tetapi value tidak valid;
- layout profile memberi region value yang cukup presisi;
- detector sebelumnya menghasilkan box yang bisa diperluas menjadi value crop.

Recognition-only tidak digunakan pada full page atau crop multibaris yang belum tersegmentasi.

Recovery ladder:

1. raw grayscale crop, satu recognition call;
2. CLAHE hanya jika hasil kosong/tidak valid;
3. sharpen atau threshold hanya untuk field dan quality condition yang relevan;
4. legacy det+rec fallback hanya jika budget masih tersedia;
5. stop segera setelah validator domain menerima nilai.

### 5.6 Adaptive preprocessing

`variant_mode` harus benar-benar memengaruhi `_build_variants()`.

Mode yang direncanakan:

| Mode | Fast variant | Conditional fallback |
|---|---|---|
| `mrz` | grayscale/resized | CLAHE, Otsu |
| `location` | grayscale 1.5x-2x | CLAHE, mild sharpen |
| `date` | grayscale single-line | Otsu jika contrast rendah |
| `name` | grayscale dengan spasi | CLAHE jika confidence rendah |
| `full_page` | resize down ke target | satu higher-resolution retry |

Aturan:

- jangan membuat semua varian di awal;
- generate fallback secara lazy;
- ukur image quality sebelum memilih varian;
- setiap fallback harus mempunyai reason code;
- adaptive threshold tidak dipakai jika benchmark menunjukkan zero contribution.

### 5.7 Source precedence dan validation

Field MRZ:

- nomor paspor;
- nama;
- nationality;
- DOB;
- expiry;
- gender.

Jika MRZ lolos checksum dan country validation, visual OCR tidak boleh menimpa field tersebut dengan kandidat lebih lemah.

Field visual:

- place of birth;
- issuing office;
- issue date jika tidak dapat diinfer atau belum valid.

Setiap resolved field menyimpan evidence internal:

- source (`MRZ`, `SPATIAL_FULL_PAGE`, `REC_ONLY`, `LEGACY_PANEL`);
- confidence;
- validation state;
- recovery reason;
- elapsed/call contribution.

Evidence yang mengandung PII tidak ditulis ke log produksi.

## 6. Rencana Implementasi Bertahap

### Fase 0 — Reproducible baseline dan benchmark hygiene

**Estimasi:** 1-2 hari
**Risiko:** rendah

#### Pekerjaan

- [x] Jalankan baseline dari commit aktif dengan PP-OCRv4.
- [x] Tambahkan metadata benchmark:
  - git commit;
  - Python version;
  - RapidOCR dan ONNX Runtime version;
  - CPU/logical core;
  - OCR profile;
  - dataset/fixture hash;
  - warm/cold run marker.
- [ ] Jalankan satu warm-up dan tiga measured runs.
- [ ] Simpan hasil per run dan aggregate median.
- [x] Pisahkan benchmark golden field dari benchmark MRZ 115 image.
- [x] Audit `modern_ocr_evaluation.py`; nama engine harus sesuai engine yang benar-benar dipanggil.
- [x] Tambahkan command tunggal untuk baseline vs candidate comparison.
- [x] Pastikan artifact benchmark tidak masuk release installer.

#### File utama

- `scripts/benchmark_ocr.py`
- `scripts/benchmark_dataset.py`
- `scripts/benchmark_utils.py`
- `scripts/compare_profiles.py`
- `benchmark/baseline_snapshot.json`
- `tests/fixtures/ocr_benchmark_targets.json`

#### Exit criteria

- Baseline dapat diulang dengan variasi median latency <= 10%.
- Field accuracy, OCR calls, fallback, average, P95, dan max tercatat.
- Semua perbandingan selanjutnya memakai baseline commit dan fixture yang sama.

### Fase 1 — Structured OCR API dan normalization

**Estimasi:** 1-2 hari
**Risiko:** rendah-menengah

#### Pekerjaan

- [x] Tambahkan `OcrObservation` dan `OcrDetailedResult`.
- [x] Implementasikan `run_rapid_ocr_detailed()`.
- [x] Jadikan `run_rapid_ocr()` compatibility wrapper.
- [x] Tambahkan Unicode NFKD normalization sebelum whitelist.
- [x] Tambahkan call-type metrics.
- [x] Tangani bentuk return RapidOCR untuk det+rec dan rec-only.
- [x] Pastikan timeout/error behavior tidak berubah diam-diam.

#### Test

- [x] Mapping tuple RapidOCR menjadi observation.
- [x] Box normalization untuk grayscale/BGR dan berbagai ukuran.
- [x] `RÉDEB -> REDEB`.
- [x] Whitelist berjalan setelah transliterasi.
- [x] Empty detector result tidak menyebabkan exception.
- [x] Rec-only output dapat diubah menjadi detailed result.
- [x] Compatibility string identik untuk fixture unit existing.

#### Exit criteria

- Seluruh unit test existing lulus.
- Pipeline default menghasilkan output yang sama dengan baseline.
- Overhead wrapper tanpa strategi baru <= 2%.

### Fase 2 — Full-page index dan spatial location resolver

**Estimasi:** 3-4 hari
**Risiko:** menengah

#### Pekerjaan

- [x] Implementasikan `PassportOcrIndex`.
- [x] Cache satu structured full-page result per aligned page.
- [x] Gunakan normalized coordinates.
- [x] Tambahkan label matcher bilingual.
- [ ] Tambahkan right-of-label dan below-label queries.
- [x] Tangani label+value dalam satu OCR box.
- [x] Implementasikan candidate scoring terpusat.
- [x] Gunakan `location_normalizer` sebagai validator/canonicalizer.
- [x] Tambahkan evidence reason tanpa raw PII log.
- [x] Integrasikan resolver dalam shadow mode tanpa mengubah output produksi.

#### File utama

- baru: `services/ocr_observation.py`
- baru: `services/passport_ocr_index.py`
- baru: `services/spatial_field_resolver.py`
- `services/passport_page.py`
- `services/location_normalizer.py`
- `services/indonesia_field_ocr.py`
- `services/ocr_result_cache.py`

#### Test

- [ ] Kandidat kanan label dipilih di atas kandidat yang lebih jauh.
- [x] Kandidat bawah label bekerja untuk layout alternatif.
- [x] Label tidak dapat dipilih sebagai value.
- [x] Nama/kota lain di halaman tidak bocor ke issuing office.
- [x] Box tetap benar setelah rotation/alignment.
- [x] Old dan new passport layout fixtures.
- [x] Candidate scoring deterministik.
- [x] Cache terpisah antarfile, rotation, resize, dan profile.

#### Exit criteria

- Shadow resolver menemukan expected `birthCity` dan `cityOfIssued` >= 95%.
- Tidak ada tambahan OCR call dalam shadow comparison yang memakai cached result.
- Semua disagreement menghasilkan reason yang bisa dianalisis.

### Fase 3 — Integrasi adaptive pipeline dan source precedence

**Estimasi:** 2-3 hari
**Risiko:** menengah-tinggi

#### Pekerjaan

- [x] Tambahkan strategi `legacy`, `spatial_shadow`, dan `spatial`.
- [x] Integrasikan spatial result ke `pipeline_stages.py`.
- [x] Terapkan source precedence MRZ > validated spatial > recovery > legacy.
- [x] Jalankan legacy location fallback hanya jika spatial result kosong/tidak valid.
- [x] Stop recovery setelah semua required field valid.
- [x] Pertahankan OCR budget existing.
- [ ] Tambahkan review reason khusus bila label ditemukan tetapi value tidak valid.
- [x] Pastikan status tidak berubah hanya karena source evidence berubah.

#### Feature flag

Gunakan satu flag implementasi yang terpisah dari quality profile:

```text
PASSPORT_OCR_LOCATION_STRATEGY=legacy|spatial_shadow|spatial
```

`PASSPORT_OCR_PROFILE=speed|balanced|heavy` tetap mengatur budget/quality, bukan memilih implementasi lama atau baru.

#### Test

- [x] MRZ valid tidak ditimpa visual result.
- [x] Spatial valid menghindari legacy fallback.
- [x] Spatial invalid memicu legacy fallback selama rollout.
- [x] Budget exhausted menghasilkan review reason yang benar.
- [x] Manifest contract identik.
- [x] Metrics source counts benar.

#### Exit criteria

- 17/17 record tetap valid.
- Tidak ada regresi field MRZ.
- Location accuracy >= 95%.
- Average/P95 masih dalam hard gate.

### Fase 4 — Recognition-only dan lazy preprocessing

**Estimasi:** 2-3 hari
**Risiko:** menengah

#### Pekerjaan

- [x] Tambahkan rec-only runner dengan adapter return yang stabil.
- [x] Buat crop satu baris dari label/value geometry.
- [x] Migrasikan targeted location recovery terlebih dahulu.
- [x] Gunakan `variant_mode` di `_build_variants()`.
- [x] Generate CLAHE/sharpen/threshold secara lazy.
- [x] Tambahkan early stop berdasarkan validator.
- [ ] Catat kontribusi tiap variant dan reason fallback.
- [ ] Hapus hanya loop/variant yang terbukti zero-value setelah benchmark.

#### Test

- [x] Rec-only tidak dipakai untuk region multibaris.
- [x] Empty rec-only result berlanjut ke fallback berikutnya.
- [x] Valid location menghentikan fallback.
- [x] Variant order sesuai field mode.
- [x] Speed mode tidak menghasilkan heavy variants.
- [x] Cache key membedakan det+rec dan rec-only.

#### Exit criteria

- Akurasi minimal sama dengan Fase 3.
- OCR calls <= baseline atau menunjukkan tradeoff yang masih dalam hard gate.
- P95 tidak bertambah lebih dari 10%.
- Tidak ada detector-empty recovery storm.

### Fase 5 — Tuning, packaging, dan rollout

**Estimasi:** 2-3 hari
**Risiko:** menengah

#### Pekerjaan

- [ ] Jalankan golden benchmark tiga kali.
- [x] Jalankan benchmark MRZ 115 image.
- [ ] Jalankan low-power projection.
- [x] Jalankan unit dan regression suite penuh.
- [x] Build PyInstaller worker dengan workflow yang sama seperti CI.
- [x] Smoke test worker dari folder release, bukan source venv.
- [ ] Uji JPG/JPEG/PNG/PDF.
- [ ] Uji speed, balanced, dan heavy.
- [x] Verifikasi ukuran installer dan startup time.
- [x] Promosikan `spatial` setelah gate akurasi, regresi, dan packaging lulus; caveat review/low-power dicatat terpisah.

#### Exit criteria

- Seluruh quality, performance, reliability, dan packaging gate lulus.
- Rollback flag diverifikasi.
- Dokumentasi baseline diperbarui dengan commit dan tanggal.
- Artifact passport tidak ada di bundle release.

### Fase 6 — Eksperimen PP-OCRv6 opsional

**Estimasi:** 2-4 hari setelah Fase 5
**Risiko:** tinggi
**Tidak memblokir release pipeline baru.**

#### Pekerjaan

- [ ] Tambahkan engine adapter versi baru di branch eksperimen.
- [ ] Normalisasi Unicode wajib aktif.
- [ ] Retune detector threshold untuk crop kecil.
- [ ] Bandingkan V6 Tiny, Small, dan V4 Mobile sesuai use case.
- [ ] Pertimbangkan V6 hanya untuk rec-only, bukan full replacement.
- [ ] Ukur wheel/model/bundle size dan cold start.
- [ ] Jalankan full gate yang sama; jangan memakai benchmark raw-only untuk keputusan.

#### Adoption gate tambahan

- Tidak boleh ada status error baru.
- Location accuracy minimal sama dengan PP-OCRv4 pipeline baru.
- Average atau P95 harus memberi keuntungan material minimal 10%, bukan sekadar lebih cepat per-call.
- OCR call dan fallback tidak boleh bertambah.
- Tambahan ukuran installer harus didokumentasikan dan disetujui.

Jika gate gagal, PP-OCRv4 tetap menjadi default.

## 7. Work Breakdown dan Dependency

| ID | Pekerjaan | Dependency | Deliverable |
|---|---|---|---|
| OCR-001 | Reproduce baseline | - | Baseline report + metadata |
| OCR-002 | Aggregate 3-run benchmark | OCR-001 | Median comparison report |
| OCR-003 | Structured OCR models | OCR-001 | Observation/result dataclass |
| OCR-004 | Detailed runner | OCR-003 | Backward-compatible OCR API |
| OCR-005 | Unicode normalization | OCR-004 | Normalization helper + tests |
| OCR-006 | Detailed result cache | OCR-004 | Session-scoped cache |
| OCR-007 | Passport OCR index | OCR-006 | Spatial query index |
| OCR-008 | Label matcher | OCR-007 | Bilingual label rules |
| OCR-009 | Spatial location scorer | OCR-008 | Deterministic candidate resolver |
| OCR-010 | Shadow mode | OCR-009 | Disagreement metrics |
| OCR-011 | Pipeline integration | OCR-010 | Feature-flagged spatial strategy |
| OCR-012 | Source precedence | OCR-011 | Stable merge/validation rules |
| OCR-013 | Recognition-only adapter | OCR-004 | Rec-only OCR path |
| OCR-014 | Lazy field variants | OCR-013 | Adaptive preprocessing |
| OCR-015 | Performance metrics | OCR-011, OCR-014 | Call/source/fallback evidence |
| OCR-016 | Golden regression | OCR-015 | Candidate benchmark report |
| OCR-017 | MRZ 115 regression | OCR-015 | MRZ comparison report |
| OCR-018 | PyInstaller smoke | OCR-016, OCR-017 | Bundled-worker validation |
| OCR-019 | Rollout default | OCR-018 | Default strategy promotion |
| OCR-020 | PP-OCRv6 experiment | OCR-019 | Optional adoption report |

Critical path:

```text
OCR-001 -> OCR-003 -> OCR-004 -> OCR-006 -> OCR-007
        -> OCR-008 -> OCR-009 -> OCR-010 -> OCR-011
        -> OCR-015 -> OCR-016/OCR-017 -> OCR-018 -> OCR-019
```

## 8. Test Matrix

### 8.1 Unit tests

Tambahkan atau perluas:

- `tests/test_ocr_runner.py`
- `tests/test_ocr_result_cache.py`
- `tests/test_panel_fallback.py`
- `tests/test_ocr_performance_guards.py`
- `tests/test_ocr_profile_regression.py`
- baru: `tests/test_ocr_observation.py`
- baru: `tests/test_passport_ocr_index.py`
- baru: `tests/test_spatial_field_resolver.py`
- baru: `tests/test_recognition_only.py`

Kasus minimum:

- Unicode accents;
- whitespace dan punctuation;
- label+value satu box;
- label dan value beda box;
- value di kanan dan di bawah;
- rotated/aligned page;
- duplicate candidate;
- unknown location;
- known location dengan OCR confusion;
- empty detector;
- empty recognizer;
- cache collision prevention;
- budget exhaustion;
- legacy fallback;
- deterministic tie-break.

### 8.2 Image regression

Dataset:

- golden training fixture 17 image;
- first/second/third test fixtures;
- MRZ benchmark 115 image;
- PDF batch fixture;
- sampel layout paspor lama dan baru;
- sampel glare, blur, shadow, crop miring, dan resolusi rendah yang sudah diizinkan untuk testing.

Jangan menambahkan data passport baru ke git tanpa proses sanitasi dan persetujuan data.

### 8.3 Performance tests

Ukur:

- cold model initialization;
- warm per-image total;
- OCR time;
- preprocessing time;
- observation-index time;
- spatial resolver time;
- det+rec call count;
- rec-only call count;
- fallback variant count;
- cache hit/miss;
- average, median, P95, P99, max;
- estimated peak memory;
- PyInstaller worker startup.

### 8.4 Packaging tests

- Model ONNX ditemukan di `_internal` bundle.
- Worker tidak mencoba download model saat runtime.
- Worker berjalan tanpa Python/Tesseract/PaddlePaddle terpasang global.
- Windows path dengan spasi bekerja.
- Worker stop/cancel tetap bekerja.
- Release validation di GitHub Actions diperbarui hanya jika module package berubah.

## 9. Metrics dan Observability

Tambahkan metrics internal tanpa mengubah contract publik yang tidak perlu:

```json
{
  "ocrStrategy": "spatial",
  "fullPageOcr": {
    "used": true,
    "elapsedMs": 0,
    "observationCount": 0,
    "cacheHit": false
  },
  "ocrCallTypes": {
    "detRec": 0,
    "recOnly": 0,
    "detOnly": 0
  },
  "fieldSources": {
    "placeOfBirth": "SPATIAL_FULL_PAGE",
    "issuingOffice": "REC_ONLY"
  },
  "locationRecovery": {
    "legacyFallbackUsed": false,
    "variantCalls": 0,
    "reasonCodes": []
  }
}
```

Reason codes yang disarankan:

- `LABEL_NOT_FOUND`;
- `VALUE_NOT_FOUND_NEAR_LABEL`;
- `LOW_OCR_CONFIDENCE`;
- `UNKNOWN_LOCATION`;
- `AMBIGUOUS_LOCATION_CANDIDATES`;
- `REC_ONLY_EMPTY`;
- `DETECTOR_EMPTY`;
- `OCR_BUDGET_EXCEEDED`;
- `LEGACY_FALLBACK_USED`.

Production log hanya menulis nama field, source, reason, dan timing. Raw text/value passport tidak ditulis.

## 10. Rollout dan Rollback

### 10.1 Rollout

1. **Development only:** `spatial_shadow` menghitung resolver baru dan lama, tetapi output tetap legacy.
2. **Offline benchmark:** analisis disagreement pada golden dan MRZ dataset.
3. **Internal canary:** `spatial` menjadi output untuk operator internal; legacy fallback tetap aktif.
4. **Default candidate:** aktifkan pada speed profile setelah seluruh gate lulus.
5. **Production default:** promosi setelah minimal satu siklus release internal tanpa regresi.
6. **Cleanup:** pertimbangkan penghapusan legacy location path setelah dua release stabil dan hanya jika rollback tidak lagi diperlukan.

Shadow mode tidak boleh dipakai pada produksi reguler karena dapat menggandakan pekerjaan.

### 10.2 Rollback

Rollback harus dapat dilakukan tanpa rebuild:

```text
PASSPORT_OCR_LOCATION_STRATEGY=legacy
```

Rollback trigger:

- valid/error regression;
- location accuracy di bawah baseline;
- P95 naik > 10%;
- OCR call naik > 10%;
- memory/startup regression material;
- bundled worker gagal menemukan model;
- disagreement baru pada layout yang sebelumnya stabil.

Manifest dan review edits tetap kompatibel saat rollback.

## 11. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Box berubah setelah rotation/warp | Field salah dipasangkan | Normalized coordinates dan test transform |
| Label/value digabung satu box | Value tidak ditemukan | Split berdasarkan known label prefix |
| Full-page resolution terlalu rendah | Teks kecil hilang | Satu higher-resolution retry bersyarat |
| Full-page resolution terlalu tinggi | Latency naik | Target-side resize dan benchmark |
| Confidence tidak terkalibrasi | Kandidat benar ditolak | Gabungkan confidence dengan validator domain |
| Dictionary terlalu agresif | Nilai diganti kota lain | Dictionary hanya validate/canonicalize OCR evidence |
| Cache stale/collision | Data antarpassport tercampur | Session/file/transform/engine-aware cache key |
| Rec-only menerima crop multibaris | Output tidak stabil | Geometry precondition dan fallback det+rec |
| Recovery storm | P95/max memburuk | Budget, early stop, per-field max attempts |
| PP-OCRv6 Unicode output | Kandidat gagal whitelist | NFKD sebelum whitelist |
| PyInstaller kehilangan model/data | Worker gagal di client | Release-resource validation dan smoke test |
| Benchmark overfit 17 image | Produksi regresi | MRZ 115 set, layout sets, dan canary internal |
| PII masuk artifact/log | Risiko privasi | Redaction, local-only review, release exclusion |

## 12. Perintah Verifikasi yang Direncanakan

### Unit dan regression tests

```powershell
cd python-ocr
.\.venv\Scripts\python.exe -m pytest tests\
```

### Golden benchmark

```powershell
cd python-ocr
.\.venv\Scripts\python.exe scripts\benchmark_ocr.py `
  ..\data\example-group\passports\trainingData `
  --golden tests\fixtures\ocr_training_golden.json `
  --targets tests\fixtures\ocr_benchmark_targets.json `
  --output .review\ocr-spatial-candidate.json
```

Jalankan satu warm-up dan tiga run terukur dengan nama output berbeda, lalu aggregate menggunakan script comparison yang dibuat pada Fase 0.

### MRZ benchmark

```powershell
cd python-ocr
.\.venv\Scripts\python.exe scripts\benchmark_dataset.py --profile optimized --no-resume
.\.venv\Scripts\python.exe scripts\validate_benchmark.py
```

### Profile comparison

```powershell
cd python-ocr
.\.venv\Scripts\python.exe scripts\compare_profiles.py
```

### PyInstaller parity dengan CI

Gunakan command dan `--collect-all` yang sama dengan `.github/workflows/release.yml`, kemudian jalankan worker dari folder `.dist`, bukan dari source tree.

## 13. Definition of Done

Rencana dianggap selesai diimplementasikan bila:

- [x] Baseline current commit reproducible dan terdokumentasi.
- [x] Structured OCR result tersedia dan backward compatible.
- [x] Unicode normalization terjadi sebelum whitelist.
- [x] Full-page observation hanya dihitung sekali per page/transform.
- [x] Spatial resolver lokasi aktif dan mempunyai evidence deterministik.
- [x] Recognition-only hanya dipakai pada crop satu baris yang memenuhi precondition.
- [x] Heavy preprocessing bersifat lazy dan budget-aware.
- [x] 17/17 golden record valid.
- [x] Tidak ada regresi field MRZ.
- [x] `birthCity` dan `cityOfIssued` memenuhi target >= 95% serta target mismatch release pada golden utama.
- [ ] Average, P95, max, call count, fallback, dan low-power gate lulus.
- [x] MRZ 115 image tidak mengalami regresi.
- [x] Unit, regression, benchmark validation, dan PyInstaller smoke test lulus.
- [x] Rollback ke legacy telah diuji.
- [x] Manifest contract tidak berubah.
- [x] Tidak ada raw PII baru di production logs atau release artifact.
- [ ] PP-OCRv6 tetap feature-flagged sampai adoption gate terpisah lulus.

## 14. Rekomendasi Eksekusi

Urutan delivery yang paling aman:

1. Fase 0 dan Fase 1 dalam satu perubahan kecil.
2. Fase 2 masuk sebagai shadow-only.
3. Review disagreement dan perbaiki spatial scoring tanpa menyentuh output produksi.
4. Fase 3 mengaktifkan output baru di balik flag dengan legacy fallback.
5. Fase 4 mengoptimalkan call count setelah akurasi stabil.
6. Fase 5 mempromosikan default hanya berdasarkan quality gate.
7. Fase 6 dilakukan terpisah agar keputusan engine tidak bercampur dengan keputusan pipeline.

Prinsip keputusan akhir: **akurasi field final dan latency end-to-end lebih penting daripada benchmark satu inference atau popularitas engine.**
