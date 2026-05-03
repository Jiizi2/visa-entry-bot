# Arabic Name Overrides

File utama:
- `arabic_name_overrides.json`

Tujuan:
- Menyimpan override transliterasi nama Latin -> Arab.
- Dipakai otomatis oleh `services/transliterator.py` saat startup (load sekali ke memori).

Aturan penulisan:
- Key harus uppercase, tanpa spasi, hanya `A-Z` dan `0-9`.
- Value harus teks Arab (boleh mengandung spasi).
- Satu key mewakili satu token nama, contoh: `MAULANA`.

Contoh:
```json
{
  "MAULANA": "مولانا",
  "NURHIDAYAH": "نور هداية"
}
```

Cara update:
1. Edit `arabic_name_overrides.json`.
2. Jalankan validasi:
   - `python python-ocr/scripts/validate_arabic_overrides.py`
3. Jalankan test transliterasi:
   - `python -m unittest python-ocr/tests/test_transliterator.py`

Catatan:
- Jika key sama dengan override bawaan di kode, nilai dari file JSON akan menang.
- Menambah banyak entry tidak signifikan mempengaruhi performa karena lookup dictionary di memori.
