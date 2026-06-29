# State Machine Specification: EntryMate Automation Session

Dokumen ini mendefinisikan dua mesin status (*state machine*) terpisah untuk mengelola jalannya otomatisasi input di sisi Desktop (`automation_service.rs`) dan melacak sinkronisasi status di sisi Extension.

---

## 1. Connection State Machine (Mesin Status Koneksi)

Mesin status ini mengurusi siklus hidup jaringan fisik WebSocket lokal. Putusnya koneksi **tidak boleh** langsung menghancurkan data sesi otomatisasi yang sedang berjalan di memori (*Session State*).

```text
Disconnected ◄─────────────────────────┐
    │                                  │ (Error / Disconnect)
    ▼ (Search Port 9001-9005)          │
Connecting                             │
    │                                  │
    ▼ (TCP Socket Open)                │
Connected                              │
    │                                  │
    ▼ (HELLO -> HELLO_ACK)             │
Handshake                              │
    │                                  │
    ▼ (READY)                          │
  Ready ───────────────────────────────┘
```

### Aturan Transisi Status Koneksi

| Status Awal | Trigger / Event | Status Akhir | Deskripsi |
| :--- | :--- | :--- | :--- |
| **`Disconnected`** | Pencarian Port | **`Connecting`** | Mulai mencari port server `9001-9005`. |
| **`Connecting`** | Soket Terbuka | **`Connected`** | Koneksi TCP lokal berhasil terhubung. |
| **`Connected`** | Kirim `HELLO` | **`Handshake`** | Extension memperkenalkan diri, menunggu `HELLO_ACK`. |
| **`Handshake`** | Terima `HELLO_ACK` & Kirim `READY` | **`Ready`** | Handshake sukses, browser siap menerima perintah. |
| *Status apa pun* | Soket Terputus | **`Disconnected`** | Koneksi fisik hilang. Sesi otomatisasi dipindahkan ke mode tunggu. |

---

## 2. Session State Machine (Mesin Status Sesi)

Mesin status ini mengurusi alur orkestrasi pengerjaan data batch mutamer secara terisolasi.

```text
       Idle
        │
        ▼ (CREATE_SESSION)
     Created
        │
        ▼ (LOAD_BATCH)
   BatchLoaded ◄───────┐
        │              │ (NEXT)
        ▼ (START)      │
     Running ──────────┘
        │
        ├────────► Paused
        │              │
        │              ▼
        └────────► Running
        │
        ▼ (SESSION_COMPLETED)
     Completed
```

### Aturan Transisi Status Sesi

| Status Awal | Trigger / Command | Status Akhir | Deskripsi |
| :--- | :--- | :--- | :--- |
| **`Idle`** | `CREATE_SESSION` | **`Created`** | Desktop berhasil menginisialisasi sesi baru. |
| **`Created`** | `LOAD_BATCH` | **`BatchLoaded`** | Klien berhasil memuat data batch jamaah. |
| **`BatchLoaded`** | `START` | **`Running`** | Desktop memulai pengerjaan mutamer pertama. |
| **`Running`** | `PAUSE` | **`Paused`** | Proses dihentikan sementara waktu. |
| **`Paused`** | `START` (Resume) | **`Running`** | Melanjutkan pengerjaan mutamer dari posisi pause. |
| **`Running`** | `MEMBER_COMPLETED` | **`BatchLoaded`** | Mutamer aktif selesai diinput. Menunggu perintah `NEXT`. |
| **`BatchLoaded`** | `NEXT` | **`Running`** | Memulai pengerjaan mutamer berikutnya. |
| **`BatchLoaded`** | `SESSION_COMPLETED` | **`Completed`** | Seluruh batch mutamer berhasil dimasukkan. |
| *Status apa pun* | `STOP` | **`Stopped`** | Sesi dihentikan paksa (kembali ke status `Idle`). |
| *Status apa pun* | `ERROR` (Fatal) | **`Failed`** | Terjadi kesalahan fatal yang tidak dapat dipulihkan. |

---

## 3. Tabel Validasi Transisi Status Sesi (State Transition Validation Table)

Untuk mempermudah verifikasi logika di dalam `AutomationService`, berikut adalah tabel pemetaan transisi legal vs ilegal untuk seluruh perintah/event utama:

| Current State (Status Awal) | Message / Trigger | Target State | Valid? | Kode Error Jika Ilegal |
| :--- | :--- | :--- | :---: | :--- |
| **`Idle`** | `CREATE_SESSION` | `Created` | **YA** | - |
| **`Idle`** | `START` | `Running` | **TIDAK**| `ERR_NO_BATCH` |
| **`Created`** | `LOAD_BATCH` | `BatchLoaded` | **YA** | - |
| **`Created`** | `START` | `Running` | **TIDAK**| `ERR_NO_BATCH` |
| **`BatchLoaded`** | `START` | `Running` | **YA** | - |
| **`BatchLoaded`** | `NEXT` | `Running` | **YA** | - |
| **`Running`** | `START` | `Running` | **TIDAK**| `ERR_ALREADY_RUNNING` |
| **`Running`** | `PAUSE` | `Paused` | **YA** | - |
| **`Running`** | `MEMBER_COMPLETED` | `BatchLoaded` | **YA** | - |
| **`Paused`** | `START` (Resume) | `Running` | **YA** | - |
| **`Paused`** | `NEXT` | `Running` | **TIDAK**| `ERR_ILLEGAL_TRANSITION` |
| **`BatchLoaded`** | `SESSION_COMPLETED`| `Completed` | **YA** | - |
| *Status apa pun* | `STOP` | `Stopped` (Idle) | **YA** | - |
| *Status apa pun* | `ERROR` | `Failed` | **YA** | - |
