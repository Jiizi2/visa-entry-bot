# Nusuk Bridge Extension (JSON Contract)

Extension ini memakai pola **JSON contract files** (tanpa API HTTP). Komunikasi extension dilakukan lewat **Native Messaging host**, lalu host baca/tulis folder contract.

## Folder Contract

Default:

`C:\visa-entry-bot\passport-desktop\bridge-contract`

Struktur:

- `commands/*.json` (app -> extension)
- `events/*.json` (extension -> app)

## Cara load extension

1. Buka `edge://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**.
4. Pilih folder:
   `passport-desktop/browser-extension/nusuk-bridge-extension`
5. Catat `Extension ID`.

## Install Native Host (Windows)

Jalankan PowerShell:

```powershell
cd passport-desktop
.\scripts\native-host\install-native-host.ps1 -ExtensionId "<EXTENSION_ID>"
```

Script ini:

- Generate manifest host dari template.
- Register host ke:
  - `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.visaentry.nusuk_bridge`
  - `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.visaentry.nusuk_bridge`

## API Tauri untuk JSON Contract

Di app Tauri tersedia command:

- `contract_bridge_init`
- `contract_bridge_status`
- `contract_bridge_queue_command`
- `contract_bridge_get_events`

Contoh dari DevTools:

```js
await window.__TAURI__.core.invoke("contract_bridge_init");
await window.__TAURI__.core.invoke("contract_bridge_queue_command", {
  commandType: "ping",
  payload: {},
  targetClientId: null
});
await window.__TAURI__.core.invoke("contract_bridge_get_events", {
  limit: 20,
  consume: false
});
```
