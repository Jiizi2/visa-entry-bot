# Retry Policy: Shared Protocol Connection

Tabel di bawah ini menetapkan aturan batas maksimum pengiriman ulang pesan (*max retry attempts*) untuk setiap pesan asinkron yang dikirim melalui jaringan WebSocket lokal:

| Message (Tipe Pesan) | Max Retry | Deskripsi Kebijakan / Batasan |
| :--- | :---: | :--- |
| **`HELLO`** | **3** | Jika handshake gagal karena server belum siap, klien diperbolehkan mencoba kembali maksimal 3 kali sebelum menampilkan indikator terputus. |
| **`LOAD_BATCH`** | **3** | Pengiriman data antrean mutamer dapat diulang maksimal 3 kali jika terjadi korupsi data atau jika Extension membalas dengan error parsing. |
| **`NEXT`** | **1** | Desktop boleh mengirim ulang perintah `NEXT` maksimal 1 kali jika Extension tidak memberikan respons `ACK` dalam waktu 5 detik. |
| **`CREATE_SESSION`** | **0** | Tidak boleh diulang secara otomatis untuk menghindari terciptanya sesi ganda di memori server. Jika gagal, user harus memicunya secara manual. |
| **`START`** | **0** | Tidak boleh diulang untuk mencegah duplikasi eksekusi pengisian form mutamer pertama. |
| **`PAUSE`** | **0** | Tidak boleh diulang. Pengguna dapat mengeklik jeda kembali jika status transisi gagal. |
| **`STOP`** | **0** | Tidak boleh diulang. Jika koneksi terputus, sesi dibersihkan secara lokal di masing-masing sisi secara independen. |
| **`PING`** | **0** | Keep-alive dikirim berkala (misal tiap 10 detik). Jika gagal, sistem langsung memicu alur reconnect. |
