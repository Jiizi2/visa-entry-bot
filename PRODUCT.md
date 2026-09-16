# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pengguna utama adalah operator travel atau visa yang bekerja di desktop dan memproses banyak passport dalam satu rombongan.

## Product Purpose

EntryMate mengubah folder foto atau PDF passport menjadi data jamaah yang siap direview dan dimasukkan ke Nusuk. Keberhasilan berarti operator dapat memulai batch dengan cepat, memeriksa data secara efisien, dan menyelesaikan entry dengan lebih sedikit pekerjaan manual.

## Operating Context

Operator bekerja dengan folder dokumen passport, nilai bersama untuk satu rombongan, hasil OCR lokal, proses review dan edit per anggota, serta entry Nusuk melalui aplikasi desktop dan browser extension.

## Capabilities and Constraints

- Workflow utama: pilih folder, siapkan foto, jalankan OCR, review data, lalu entry Nusuk.
- Halaman pertama harus mendukung pemilihan folder, opsi PDF multi-passport, default rombongan, riwayat folder, dan navigasi ke Prepare.
- OCR berjalan lokal melalui satu pipeline otomatis; pengguna tidak memilih mode pemrosesan.
- Redesign halaman pertama tidak boleh mengubah fungsi, kontrak data, atau urutan workflow utama.

## Brand Commitments

Nama EntryMate By Ghaniya, aset aplikasi yang sudah ada, serta identitas produk graphite, gold, mineral green, dan pearl dipertahankan.

## Evidence on Hand

Repository berisi implementasi desktop Tauri/React, worker OCR lokal, browser extension, aset identitas aplikasi, serta automated tests. Tidak ada klaim pemasaran atau bukti eksternal yang boleh dibuat-buat.

## Product Principles

- Minimalkan keputusan dan langkah sebelum pemrosesan dimulai.
- Optimalkan pekerjaan batch yang berulang.
- Pertahankan visibilitas terhadap sumber dokumen dan data yang akan diterapkan.
- Utamakan kejelasan operasional, kecepatan, dan pemulihan dari kesalahan.
- Pertahankan workflow yang dapat diprediksi dari Import hingga Entry.

## Accessibility & Inclusion

Kontrol utama harus dapat digunakan dengan keyboard, memiliki fokus yang terlihat, serta mempertahankan keterbacaan dan urutan yang logis pada ukuran layar desktop yang berbeda.
