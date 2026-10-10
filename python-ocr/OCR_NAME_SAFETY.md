# Stabilitas OCR dan pemeriksaan nama paspor

Evaluasi 7 Oktober 2026, pada working tree. Seluruh jalur produksi tetap memakai RapidOCR. Perubahan ini memperbaiki pemilihan hasil, pemulihan field, dan pemeriksaan identitas; model OCR tidak diganti.

Checksum MRZ sekarang hanya memperkuat field yang memang diperiksa: nomor paspor, tanggal lahir, dan tanggal kedaluwarsa. Nama tidak lagi dianggap terverifikasi hanya karena checksum MRZ lolos. Bukti nama dari area visual disimpan, termasuk nama satu kata, teks yang belum berhasil dipisahkan menjadi beberapa kata, serta observasi yang saling bertentangan.

Pemulihan tidak berhenti hanya karena tujuh field identitas terisi. MRZ yang tidak valid, bukti nama yang belum lengkap, dan lokasi wajib yang kosong tetap memerlukan pemulihan. Budget pemulihan menjadi 30 detik; jalur ringan tetap memakai 15 detik dan dapat memakai sisa budget pemulihan untuk pemeriksaan visual. Budget ini mengatur penjadwalan tahap, bukan hard timeout untuk inference ONNX.

Pemulihan nama bekerja pada salinan data. Nama panjang dapat melebar melewati pusat label selama kotak teks masih berada pada kolom yang sama. Pemisahan kata menggunakan jarak pada gambar dan bacaan ulang setiap potongan. Potongan kecil dapat diulang sekali pada ukuran dua kali lebih besar; hasil hanya diterima jika gabungan hurufnya sama persis dengan observasi nama lengkap. Pembagian sebelumnya dipertahankan ketika huruf MRZ asli cocok dengan observasi visual; MRZ yang rusak tidak mengunci batas kata yang salah. Kandidat pemulihan dan perapian terakhir yang menambah atau menghilangkan huruf dari nama visual ditolak. Jika sebuah tahap gagal setelah mengubah identitas, data identitas dikembalikan ke keadaan sebelumnya dan record ditandai untuk review.

Pemilihan kota penerbit sekarang menghabiskan awalan label yang paling cocok, termasuk label utuh yang salah dibaca OCR. Akhiran label seperti `ROKAN`, `RICAN`, dan `ICE` tidak lagi diperlakukan sebagai nilai kota. Nilai kota tetap diambil dari teks pada gambar, di bawah label atau benar-benar menempel setelah label.

Manifest mempunyai `nameVerification` dengan status `VERIFIED`, `CONFLICT`, atau `UNVERIFIED`. `VERIFIED` menyatakan kecocokan antara bacaan OCR pada dua area dan hasil akhir, bukan pemeriksaan manusia. Confidence nama dan field visual menggunakan bukti visual yang tersedia; hasil tanpa confidence yang dapat ditelusuri tetap mendapat skor konservatif.

Semua hasil scan tetap berstatus `reviewStatus=NEEDS_REVIEW` sampai diperiksa dan dikonfirmasi di desktop. Flag `OCR_REVIEW_REQUIRED` kini mengikuti catatan pipeline yang sebelumnya sudah meminta review tetapi belum diproses oleh pembentuk flag. `status=VALID` masih menyatakan kelengkapan dan format data, sehingga tidak boleh digunakan sendirian untuk menentukan kesiapan entry. Filter export desktop dan validator ekstensi yang sudah ada mensyaratkan `reviewStatus=VALID` serta `reviewConfirmed=true`.

Hasil berikut memakai fixture yang sama dengan audit awal, setelah dua koreksi acuan yang dijelaskan di bawah. Baseline berasal dari working tree sebelum perbaikan ini. Angka ini bukan perbandingan executable v1.0.19.

| Pemeriksaan | Sebelum | Sesudah |
|---|---:|---:|
| Gambar dengan seluruh field acuan cocok | 64/84 | 83/84 |
| Gambar dengan perbedaan field acuan | 20 | 1 |
| Gambar dengan perbedaan field nama | 16 | 0 |
| Record ERROR | 2 | 0 |
| TrainingData cocok seluruh field acuan | 17/17 | 17/17 |

Satu perbedaan tersisa adalah penulisan `KOTA BARU` dan `KOTABARU` pada `FirstTest:01`. Seluruh nama, nomor paspor, tanggal, gender, kewarganegaraan, dan kota penerbit cocok dengan acuan. Tiga kasus nama (`SecondTest:27`, `SecondTest:30`, `SecondTest:37`) dan dua kota penerbit (`SecondTest:24`, `SecondTest:39`) yang sebelumnya salah kini cocok setelah perbaikan pembacaan; acuan kelima kasus tersebut tidak diubah.

| Kumpulan | Cocok seluruh field acuan | Perbedaan | ERROR |
|---|---:|---:|---:|
| FirstTest | 19/20 | 1 | 0 |
| SecondTest | 45/45 | 0 | 0 |
| thirdTest | 2/2 | 0 | 0 |
| trainingData | 17/17 | 0 | 0 |

Pengujian penuh terbaru menjalankan seluruh 84 gambar dari awal dengan satu snapshot sumber yang tetap (`a8227d186c47c6b84f4723e40c5f3d0862f4a6550f42abc7afa7b3c2af2458bd`). Rata-rata sekitar 6,0 detik per gambar, p95 11,3 detik, maksimum 18,2 detik pada mesin pengujian ini. Tidak ada exception engine, stage crash, tahap terlewat, budget terlampaui, atau pasangan path gambar yang salah. SHA-256 gambar dan fixture disimpan bersama hasil. Ada 82 file gambar unik berdasarkan SHA-256; foto berbeda dapat tetap berasal dari orang yang sama.

Dua belas kasus rawan juga dijalankan dua kali lagi, sehingga masing-masing diperiksa tiga kali termasuk pengujian penuh. Pengulangan memakai proses engine yang baru, urutan terbalik, lalu urutan acak dengan seed tetap. Seluruh 24 pengulangan cocok dengan acuan dan hasil sebelumnya: data paspor, pembagian nama English/Arabic pada `resolvedProfile`, confidence, validasi MRZ, dan flag review tidak berubah. Seluruh pasangan path gambar benar dan semua pengaman pengulangan lolos. Tidak ada exception atau tahap terlewat; maksimum waktu pengulangan 19,3 detik. Pengujian penuh dan pengulangan menggunakan fingerprint sumber yang sama.

Seluruh 84 record memerlukan konfirmasi manusia sebelum entry. Jumlah hasil berbeda yang tidak memerlukan review menjadi nol karena kebijakan review wajib; angka itu bukan klaim deteksi kesalahan OCR sebesar 100%.

Fixture `SecondTest:01` dan `thirdTest:01` sebelumnya menambahkan huruf K pada nama depan. Gambar asli memperlihatkan `ABDULLAH YAZID AL FATIH`; SHA-256 kedua file identik (`a058de5e86f0192b804aee20706c1aa4d22e79a3b34de708b0558e21b407d0df`). Kedua acuan dikoreksi dari `ABDULLAH KYAZID AL` menjadi `ABDULLAH YAZID AL`. Dua ketidaksesuaian acuan tersebut juga dikeluarkan dari angka baseline agar perbandingan konsisten. Laporan audit awal dipertahankan.

Validasi kode: 359 tes Python lolos, satu tes gambar yang bersifat opt-in tidak dijalankan oleh pytest biasa; pengujian 84 gambar dan 24 pengulangan dilakukan terpisah. Sebanyak 74 tes ekstensi, 18 pemeriksaan browser lokal untuk pengaman identitas, 11 tes utilitas export desktop, dan tiga tes Rust untuk filter batch juga lolos. Filter batch diuji terhadap status yang belum valid serta review yang belum dikonfirmasi. Pengaman ekstensi yang sudah ada memeriksa nama dan nomor paspor sebelum pengisian, memeriksa nilai formulir dan file paspor pada ringkasan, serta mengunci pengiriman yang belum terkonfirmasi. Pengujian browser menggunakan DOM lokal, bukan pengiriman visa melalui akun Nusuk.

Artefak lokal:

- `.review/rapidocr-deep-audit-2026-10-07.json`: baseline 67 gambar tambahan sebelum perubahan.
- `.review/ocr-stability-2026-10-07-working-tree.json`: baseline trainingData.
- `.review/rapidocr-stability-full-2026-10-07.json`: pengujian penuh terbaru, 84 gambar dari snapshot final yang sama.
- `.review/rapidocr-stability-repeats-2026-10-07.json`: 24 pengulangan, perbandingan keluaran, dan pemeriksaan pengaman.
- `.review/rapidocr-stability-remaining-traces-final.json`: penelusuran lima kasus nama/kota yang kini cocok.

Perbaikan sudah diterapkan dan diperiksa pada working tree; installer belum dibuat ulang pada pemeriksaan ini. Hasil ini belum membuktikan kesetaraan dengan executable v1.0.19, kestabilan semua perangkat pengguna, atau hasil penerbitan visa pada akun Nusuk. Validasi berikutnya adalah menjalankan contoh gagal dari pengguna dan executable v1.0.19 pada gambar yang sama, lalu melakukan pilot dengan pemeriksaan nama lengkap, nomor paspor, dan lampiran sebelum penyimpanan. Review manusia tetap wajib, termasuk ketika hasil OCR cocok dengan acuan pengujian.
