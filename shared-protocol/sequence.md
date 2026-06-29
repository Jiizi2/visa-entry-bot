# Message Sequence Diagram: EntryMate Session Flow

Dokumen ini menjelaskan alur kronologis pertukaran pesan asinkron antara Chrome Extension (Klien) dan Desktop App (Server).

---

## 1. Handshake & Inisialisasi Koneksi

```text
Extension (Klien)                             Desktop (Server)
       │                                             │
       ├─────────────── [1. CONNECT] ───────────────>│  (TCP Socket Open)
       │                                             │
       │<────────────── [2. HELLO_ACK] (Command) ────┤  (Auth Token)
       │                                             │
       ├─────────────── [3. READY] (Event) ─────────>│  (Extension di URL Nusuk)
       │                                             │
```

---

## 2. Inisialisasi Sesi & Pemuatan Batch

```text
Extension (Klien)                             Desktop (Server)
       │                                             │
       │<────────────── [4. CREATE_SESSION] ─────────┤  (Bawa sessionId baru)
       │                                             │
       ├─────────────── [5. SESSION_CREATED] ───────>│  (replyTo: CREATE_SESSION)
       │                                             │
       │<─────────────  [6. LOAD_BATCH] ─────────────┤  (Kirim data members)
       │                                             │
       ├─────────────── [7. BATCH_LOADED] ──────────>│  (replyTo: LOAD_BATCH)
       │                                             │
```

---

## 3. Eksekusi Otomatisasi (Loop Iterasi NEXT)

Untuk setiap mutamer dalam antrean, alur pengerjaan dikontrol secara halus:

```text
Extension (Klien)                             Desktop (Server)
       │                                             │
       │<────────────── [8. START] ──────────────────┤  (Mulai pengerjaan mutamer ke-1)
       │                                             │
       ├─────────────── [9. ACK] ───────────────────>│  (replyTo: START)
       │                                             │
       ├─────────────── [10. CURRENT_MEMBER] ───────>│  (correlationId = START)
       ├─────────────── [11. CURRENT_STEP] ─────────>│  (Langkah pengisian aktif)
       ├─────────────── [12. PROGRESS] ─────────────>│  (Rasio pengerjaan form)
       ├─────────────── [13. MEMBER_COMPLETED] ──────>│  (Pengerjaan ke-1 rampung)
       │                                             │
       │              (Berhenti Sementara)           │
       │                                             │
       │<────────────── [14. NEXT] ──────────────────┤  (Perintah lanjut ke mutamer ke-2)
       │                                             │
       ├─────────────── [15. ACK] ───────────────────>│  (replyTo: NEXT)
       │                                             │
       ├─────────────── [16. CURRENT_MEMBER] ───────>│  (correlationId = START)
       │                                             │  ... (Ulangi langkah 11 s/d 13)
       │                                             │
       ├─────────────── [17. SESSION_COMPLETED] ─────>│  (Seluruh batch tuntas terinput)
```
*Catatan: Parameter `correlationId` tetap sama di sepanjang alur pengerjaan satu batch mulai dari pesan `START` hingga `SESSION_COMPLETED` dikirim.*
