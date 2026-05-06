# Chrome Extension Feature Matrix

Dokumen ini adalah sumber rujukan fitur aktif untuk `chrome-extension`.
Setiap update fitur extension harus menjaga fitur-fitur di bawah ini tetap berjalan.

## Keputusan Teknis Penting

- Upload file Nusuk membutuhkan `chrome.debugger`.
- Permission `debugger` di `manifest.json` adalah dependency aktif, bukan legacy.
- Jangan hapus flow `NUSUK_DEBUGGER_SET_FILE` kecuali ada mekanisme upload baru yang sudah terbukti di halaman Nusuk asli.
- Desktop app dan Python OCR berada di luar scope dokumen ini.

## Fitur Aktif

| Area | Fitur | File Utama | Risiko Regresi |
| --- | --- | --- | --- |
| Panel | Buka panel dari extension action | `background.js`, `content/panel-bridge.js`, `content/panel-shell.js` | Medium |
| Panel | Upload JSON manifest | `panel.js`, `content/panel-bridge.js` | High |
| Panel | Pilih jamaah awal | `panel.js`, `content/panel-bridge.js` | Medium |
| Panel | Preview data jamaah | `panel.js`, `panel.html` | Low |
| Panel | Pilih folder/file passport | `panel.js`, `panel.html`, `content/upload-file-store.js` | High |
| Panel | Start, pause, reset automation | `panel.js`, `content/autofill-session.js`, `content/execution-control.js` | High |
| Panel | Progress dan log aktivitas | `panel.js`, `content/panel-state-store.js`, `content/step-progress.js` | Medium |
| State | Simpan dan restore state panel | `content/panel-state-store.js`, `content.js` | Medium |
| Upload | Mapping file dari `fileName` dan `passportImagePath` | `content/upload-file-store.js`, `content/path-utils.js` | High |
| Upload | Cache file upload via IndexedDB | `content/upload-file-store.js` | Medium |
| Upload | Pilih input passport yang benar | `content/upload-inputs.js`, `content/attachment-utils.js` | High |
| Upload | Pasang file ke input via DataTransfer | `content/upload-manager.js` | High |
| Upload | Fallback upload via Chrome debugger | `content/upload-manager.js`, `background.js`, `manifest.json` | Critical |
| Upload | Deteksi error upload dari halaman | `content/step-upload-actions.js` | High |
| Upload | Normalisasi/kompres file image | `content/upload-manager.js`, `content/constants.js` | Medium |
| Automation | Buka Add Mutamer form | `content/step-basic-actions.js`, `content/nusuk-navigation.js` | High |
| Automation | Deteksi stage halaman Nusuk | `content/nusuk-navigation.js` | Critical |
| Automation | Urutan step per jamaah | `content/automation-steps.js` | Critical |
| Automation | Runner per jamaah dan multi-jamaah | `content/automation-runner.js` | Critical |
| Automation | Resume setelah reload | `content/automation-runner.js`, `content/autofill-session.js` | High |
| Automation | Retry dan skip jamaah gagal | `content/automation-runner.js` | High |
| Automation | Deteksi session expired | `content/automation-runner.js` | Medium |
| Automation | Screenshot failure | `background.js`, `content/automation-runner.js` | Medium |
| Form | Passport details | `content/automation-steps.js`, `content/dropdown-actions.js`, `content/calendar-actions.js` | High |
| Form | Nama Arab dan Inggris | `content/automation-steps.js`, `content/step-basic-actions.js` | High |
| Form | Birth country, birth city, profession | `content/automation-steps.js`, `content/dropdown-actions.js` | High |
| Form | Marital status | `content/automation-steps.js`, `content/dropdown-actions.js` | Medium |
| Form | Upload vaccination opsional | `content/automation-steps.js`, `content/upload-inputs.js`, `content/step-upload-actions.js` | Medium |
| Form | Email dan phone | `content/automation-steps.js`, `content/phone-fields.js`, `content/phone-country.js` | High |
| Form | Add Companion untuk jamaah anak-anak sebelum lanjut dari Member Form | `content/automation-steps.js`, `content/step-basic-actions.js`, `content/step-runner.js` | High |
| Form | Disclosure semua No | `content/automation-steps.js`, `content/step-form-actions.js` | Medium |
| Submit | Submit summary dan popup sukses | `content/automation-steps.js`, `content/nusuk-navigation.js`, `content/step-basic-actions.js` | High |
| Submit | Add Another Mutamer / companion berikutnya | `content/step-basic-actions.js`, `content/automation-runner.js` | High |

## Area Critical

File berikut tidak boleh diubah tanpa menjalankan checklist manual:

- `manifest.json`
- `background.js`
- `content/automation-steps.js`
- `content/automation-runner.js`
- `content/autofill-session.js`
- `content/nusuk-navigation.js`
- `content/step-runner.js`
- `content/step-upload-actions.js`
- `content/upload-file-store.js`
- `content/upload-inputs.js`
- `content/upload-manager.js`

## Checklist Manual Sebelum Merge

Jalankan checklist ini setiap ada update di `chrome-extension`.

- Panel bisa dibuka di halaman Nusuk.
- JSON manifest bisa diupload.
- Daftar jamaah muncul.
- Preview data jamaah tampil.
- Folder/file passport bisa dipilih.
- Tombol `Mulai` aktif setelah JSON dan file passport tersedia.
- Automation bisa membuka form Add Mutamer.
- Upload passport berhasil.
- Popup `Proceed` muncul setelah upload passport.
- Klik `Proceed` berhasil masuk ke Passport Details.
- Passport type terpilih.
- Issue date terisi.
- City of issue terisi.
- Lanjut ke Member Form.
- Nama Arab dan Inggris terisi.
- Profession terisi.
- Birth country terpilih.
- Birth city terisi.
- Marital status terpilih.
- Upload vaccination opsional tidak menghalangi flow.
- Email terisi.
- Phone terisi.
- Add Companion diklik jika jamaah anak-anak dan tombol/aksi companion muncul.
- Lanjut ke Disclosure Form.
- Disclosure terisi semua `No`.
- Lanjut ke Summary.
- Submit berhasil.
- Popup sukses muncul.
- Tombol Add Another Mutamer bekerja untuk companion/jamaah berikutnya.
- Multi-jamaah lanjut ke jamaah berikutnya.
- Pause tidak merusak state.
- Reset mengembalikan state automation.
- Jika halaman reload saat running, resume masih bisa lanjut.

## Checklist Khusus Upload

Jalankan ini setiap ada perubahan pada upload, file mapping, panel file picker, atau debugger.

- Permission `debugger` masih ada di `manifest.json`.
- `background.js` masih menangani `NUSUK_DEBUGGER_SET_FILE`.
- `content/upload-manager.js` masih bisa memanggil fallback debugger.
- File dari pilihan panel bisa ditemukan dari basename.
- File dari pilihan panel bisa ditemukan dari `passportImagePath`.
- Duplikat nama file memberi pesan yang jelas.
- File image di atas batas ukuran diproses/ditolak dengan pesan jelas.
- Error upload dari halaman Nusuk muncul di log.

## Aturan Update Fitur

- Satu perubahan fitur besar sebaiknya tidak dicampur dengan refactor navigation/upload.
- Jika mengubah stage detection, uji ulang upload passport dari awal.
- Jika mengubah upload, uji ulang flow sampai popup sukses.
- Jika mengubah panel state, uji ulang pause, reset, dan resume.
- Jika mengubah automation steps, uji ulang satu jamaah penuh dan minimal dua jamaah berurutan.
- Jangan menghapus kode yang tampak legacy sebelum dicek terhadap matrix ini.

## Target Test Otomatis Berikutnya

Prioritas test untuk mengurangi regresi:

- Unit test `path-utils` dan `upload-file-store`.
- DOM fixture test untuk `upload-inputs`.
- DOM fixture test untuk `nusuk-navigation` stage detection.
- Step order snapshot untuk `automation-steps`.
- Smoke harness untuk memastikan `manifest.json` memuat semua script sesuai dependency order.
