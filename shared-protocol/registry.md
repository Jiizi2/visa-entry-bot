# Message Registry: Shared Protocol Contract

Daftar berikut adalah tabel rujukan resmi seluruh tipe pesan yang diizinkan mengalir dalam jaringan komunikasi WebSocket lokal EntryMate:

| Message (Tipe Pesan) | Kategori | Direction (Arah Aliran) | Reply (Respon Balasan) | Retry |
| :--- | :--- | :--- | :--- | :---: |
| **`HELLO`** | Event | Extension → Desktop | `HELLO_ACK` | Ya (Max 3) |
| **`HELLO_ACK`** | Command | Desktop → Extension | - | Tidak |
| **`READY`** | Event | Extension → Desktop | - | Tidak |
| **`CREATE_SESSION`** | Command | Desktop → Extension | `SESSION_CREATED` | Tidak |
| **`SESSION_CREATED`** | Response | Extension → Desktop | - | Tidak |
| **`LOAD_BATCH`** | Command | Desktop → Extension | `BATCH_LOADED` | Ya (Max 3) |
| **`BATCH_LOADED`** | Response | Extension → Desktop | - | Tidak |
| **`START`** | Command | Desktop → Extension | `ACK` | Tidak |
| **`NEXT`** | Command | Desktop → Extension | `ACK` | Ya (Max 1) |
| **`ACK`** | Response | Lintas Arah | - | Tidak |
| **`CURRENT_MEMBER`** | Event | Extension → Desktop | - | Tidak |
| **`CURRENT_STEP`** | Event | Extension → Desktop | - | Tidak |
| **`PROGRESS`** | Event | Extension → Desktop | - | Tidak |
| **`MEMBER_COMPLETED`**| Event | Extension → Desktop | - | Tidak |
| **`SESSION_COMPLETED`**| Event | Extension → Desktop | - | Tidak |
| **`PAUSE`** | Command | Desktop → Extension | `ACK` | Tidak |
| **`STOP`** | Command | Desktop → Extension | `ACK` | Tidak |
| **`PING`** | Command | Desktop → Extension | `PONG` | Tidak |
| **`PONG`** | Response | Extension → Desktop | - | Tidak |
| **`ERROR`** | Error | Lintas Arah | - | Tidak |
