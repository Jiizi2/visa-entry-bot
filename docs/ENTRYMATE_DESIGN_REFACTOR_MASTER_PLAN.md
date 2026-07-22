# EntryMate Desktop UI/UX Redesign Master Plan

Status: **approved for implementation — foundation dan migrasi visual fase pertama selesai**  
Tanggal baseline: 22 Juli 2026  
Target aplikasi: `passport-desktop` (Tauri 2, React 19, TypeScript, Zustand)  
Workflow yang dikunci: **Import Folder → Prepare Photos → OCR Scan → Review → Export**

---

## 1. Executive Summary

EntryMate perlu diubah dari kumpulan halaman bergaya web-card menjadi sebuah **desktop operations workstation**. Arah yang diusulkan adalah _quiet workstation_: layout berbasis pane, hierarchy rapat tetapi mudah dipindai, permukaan Pearl dan Mineral Green, fondasi Graphite, aksen Gold yang hemat, status yang tidak bergantung pada warna, dan command placement yang konsisten.

Redesign ini tidak boleh menyentuh business logic. ID halaman internal seperti `validation` dan `entry`, state Zustand, handler, payload IPC, Tauri event, proses OCR, aturan review, export, dan automation harus dipertahankan. UI baru harus menjadi lapisan presentasi di atas kontrak yang ada.

Lima hasil utama yang ditargetkan:

1. Satu App Shell desktop yang konsisten: title bar, workflow rail, page command bar, workspace, contextual inspector, dan status bar.
2. Satu design system yang terukur, memakai semantic tokens dan komponen dengan kontrak state yang sama.
3. Lima page blueprint yang mempertahankan urutan dan fungsi saat ini.
4. Keyboard, focus, scaling, high contrast, dan screen-reader behavior sebagai bagian dari definisi selesai.
5. Migrasi bertahap dengan _behavior parity gate_ pada setiap fase, bukan penggantian frontend sekaligus.

### Keputusan arah awal

- Bahasa visual: **EntryMate Quiet Workstation**.
- Core brand palette: Graphite `#1A1D1E`, Gold `#D9A94F`, Light Gold `#F7D883`, Dark Gold `#A66C2D`, Mineral Green `#E7EFE8`, dan Pearl `#F9F9F9`.
- Tema implementasi pertama: light theme; struktur token disiapkan untuk theme lain, tetapi dark theme bukan scope awal.
- Font UI: Inter; font mono sistem untuk log dan identifier.
- Ikon: Lucide melalui dependency `lucide-react` yang sudah ada; hentikan campuran Material Symbols dan SVG inline setelah migrasi.
- Grid: 4 px.
- Layout: fluid berdasarkan ukuran window, bukan ukuran monitor.
- Density: compact/comfortable desktop, bukan density mobile.
- Bahasa UI: Indonesia; istilah teknis yang memang nama protokol atau produk boleh tetap English.

---

## 2. Scope Guardrail

### 2.1 Boleh berubah

- UI dan visual hierarchy.
- UX presentation dan discoverability.
- Design tokens dan styling architecture.
- Struktur komponen presentational.
- Layout, pane behavior, dan desktop responsiveness.
- Keyboard access untuk aksi yang **sudah ada**.
- Feedback, motion, notification, loading, empty, dan error presentation.
- Accessibility semantics dan focus management.

### 2.2 Tidak boleh berubah

- Urutan workflow.
- Business rules dan validasi data.
- Struktur atau lifecycle state Zustand.
- Nama page internal yang dipakai state.
- Payload, command, event, port, atau behavior IPC/Tauri.
- OCR mode, pipeline, worker, dan automation.
- Aturan review, companion, export eligibility, atau batch selection.
- Format manifest dan output JSON.
- Timing autosave atau side effect yang ada, kecuali ada approval terpisah.

### 2.3 Aturan implementasi parity

Untuk setiap handler UI lama harus ada pemetaan satu-ke-satu:

```text
Old visible action
  → existing handler
  → existing store update / invoke / event
  → same result and error behavior
  → new visible action
```

Komponen baru boleh mengganti cara aksi ditampilkan, tetapi tidak boleh mengubah isi rantai tersebut.

---

## 3. Source of Truth dan Gap Audit

### 3.1 Hierarki sumber

1. Dokumen audit frontend yang disebut di brief.
2. Source code aktif pada `passport-desktop/src`.
3. Brief redesign terlampir.
4. Screenshot lama hanya sebagai konteks historis, bukan baseline aktif.

### 3.2 Gap yang ditemukan

Dokumen audit frontend terpisah belum tersedia di repo atau lampiran. Lampiran yang ada merupakan brief redesign. Karena brief menyatakan source code harus diikuti bila terjadi ketidaksesuaian, dokumen ini menggunakan source aktif sebagai baseline sementara.

Dokumen audit frontend terpisah belum ditemukan. Setelah source aktif dan folder `public` diaudit, pengguna memberi instruksi eksplisit untuk melanjutkan eksekusi. Source aktif menjadi baseline parity sementara; audit historis tetap dapat direkonsiliasi kemudian tanpa membatalkan implementasi visual yang sudah berjalan.

### 3.3 Baseline source yang diperiksa

- App shell: `App.tsx`, `TitleBar.tsx`, `Sidebar.tsx`, `PageTransition.tsx`.
- Global styling: `global.css`, `Forms.css`, `StatusChips.css`.
- Pages: `ImportPage.tsx`, `PreparePage.tsx`, `ScanPage.tsx`, `ReviewPage.tsx`, `EntryPage.tsx`.
- Feature components: review viewer/form/dropdown, entry console/table/summary, crop tool, date picker, update dialog.
- State and runtime constraints: `store.ts`, `tauri.conf.json`, frontend package configuration.

---

## 4. Current UI Audit

## 4.1 Hal yang sudah menjadi fondasi baik

- Workflow lima tahap sudah eksplisit di state dan navigation.
- Page berat sudah di-lazy-load.
- Inter sudah tersedia lokal.
- Ada token dasar untuk color, radius, focus, font, dan title bar.
- Button, form, modal, card, dan status memiliki sebagian class bersama.
- Custom title bar sudah menyediakan minimize, maximize/restore, close, dan drag.
- Review viewer sudah memiliki zoom dan pan.
- Prepare sudah mempunyai contextual multi-select, crop, rotate, compress, delete, dan endorsement.
- Scan dan automation sudah menerima event real-time tanpa perlu desain ulang backend.

Fondasi tersebut harus dipertahankan dan distandardisasi, bukan ditulis ulang dari nol.

## 4.2 Temuan utama

| Area | Kondisi saat ini | Dampak UX | Arah perbaikan terukur |
|---|---|---|---|
| App shell | Sidebar berupa floating rounded card 280 px dengan margin besar | Terasa seperti dashboard web; ruang kerja berkurang | Workflow rail 56/192 px yang menempel ke shell dan dapat collapse |
| Page width | Banyak halaman dibatasi `max-width: 1200px` | 1920 px dan ultrawide membuang ruang | Pane fluid; batasi panjang teks/form, bukan seluruh workspace |
| Hierarchy | Header besar berbentuk card berulang di hampir semua page | Konten operasional turun dan membutuhkan scroll | Page command bar 48–56 px yang konsisten |
| Card usage | Hampir setiap section berupa rounded card + blur + shadow | Semua bagian tampak setara dan noisy | Gunakan border/pane; elevation hanya untuk overlay atau floating surface |
| Styling | Token global bercampur utility panjang, inline styles, dan raw colors | Sulit menjaga konsistensi serta theme/accessibility | Primitive → semantic → component tokens; larang static inline style |
| Radius | Banyak `rounded-2xl` dan pill | Karakter marketing/template | Radius utama 6–8 px; pill hanya status/tag |
| Elevation | Shadow dan backdrop blur dipakai sebagai default | Hierarchy tidak jelas dan render cost meningkat | Tiga level elevation dengan usage rule |
| Typography | Ukuran, weight, casing, dan bahasa campur | Scanability dan tone tidak konsisten | Satu type ramp desktop dan writing guide Indonesia |
| Icons | Material Symbols, Lucide dependency, CSS-drawn icon, SVG inline | Stroke/weight/optical size tidak konsisten | Satu icon set Lucide, ukuran 12/16/20/24 |
| Status | Banyak status berupa dot/warna saja | Sulit untuk color-vision deficiency dan scan cepat | Ikon + label + warna; satu vocabulary global |
| Navigation | Klik step langsung, tanpa semantic current/availability state | Progress workflow kurang terbaca | `aria-current`, state visual konsisten; behavior klik lama tetap dipertahankan |
| Actions | Primary/destructive actions tersebar di card/footer/overlay | Operator perlu mencari aksi tiap page | Page command bar + contextual toolbar + sticky action area |
| Loading | Spinner, label, dan skeleton berbeda-beda | Tidak ada expectation yang konsisten | Loading taxonomy: inline, region, blocking; `aria-busy` dan live message |
| Notifications | Toast diimplementasikan ulang dengan inline style; error juga memakai `alert()` | Focus dan announcement tidak terkendali | Satu Toast Center + inline Alert + Dialog component |
| Modal | Overlay tidak memiliki dialog semantics, focus trap, Escape, atau focus restore | Keyboard dan screen reader terputus | Dialog contract bersama dengan focus lifecycle |
| Motion | Page slide/fade dan hover translate tidak menghormati reduced motion | Dapat mengganggu dan terasa web-like | Motion token singkat; non-essential movement dimatikan saat reduced motion |
| Z-index | Terdapat 50, 80, 100, 1000, 9999, dan 99999 | Overlay stacking rapuh | Skala z-index bernama 0–60 |
| Scrolling | Beberapa nested scroll container per page | Wheel/focus position membingungkan | Satu workspace scroll owner; pane scroll hanya bila jelas |
| Empty/error | Banyak berupa teks kosong di tengah atau browser alert | Tidak actionable | EmptyState/AlertState dengan title, cause, dan aksi yang memang sudah ada |
| Desktop density | Header/card/padding besar; data table relatif longgar | Efisiensi operator rendah | Control 32/36 px, row 36/40 px, gutter 12–20 px |
| Responsiveness | `sm/md/lg/xl` web breakpoints dan reflow satu kolom | Tidak memodelkan window desktop | Breakpoint berdasarkan window: compact/standard/large/wide |

## 4.3 Accessibility audit

### Critical

- Folder picker memakai `div role="button" tabindex="0"` tanpa handler Enter/Space.
- OCR mode memakai clickable `div`, bukan radio group atau button dengan state terprogram.
- Dialog tidak memiliki `role="dialog"`, `aria-modal`, accessible title, focus trap, Escape handling, atau focus return.
- Custom date picker tidak memiliki calendar/grid semantics dan keyboard calendar navigation yang lengkap.
- Scan progress tidak diekspos sebagai `progressbar`, dan event penting belum memakai live region.
- Toast tidak memiliki announcement semantics dan timeout yang dapat dikelola.

### High

- Banyak icon-only button hanya mengandalkan `title`; beberapa tidak mempunyai `aria-label`.
- Status dot mengandalkan warna.
- Focus style global belum mencakup semua custom control dan popup item.
- Tidak ada `prefers-reduced-motion` strategy.
- Image crop merupakan pointer-first workflow tanpa keyboard alternative yang didefinisikan.
- Dropdown member tidak mempunyai combobox/listbox keyboard contract.

### Medium

- 24 px pagination controls berada tepat pada batas minimum dan labelnya tidak eksplisit.
- Banyak label 10–11 px dan text slate yang berpotensi gagal pada scaling/contrast tertentu.
- Native `alert()` memutus visual system dan tidak menyediakan recovery action terstruktur.
- Empty state image/file belum selalu menyebut file aktif atau cause kegagalan.

Target baseline aksesibilitas adalah WCAG 2.2 AA, ditambah target internal focus appearance yang jelas dan Windows keyboard behavior. WCAG 2.2 menetapkan target pointer minimum 24×24 CSS px; EntryMate menetapkan standar internal lebih tinggi: minimum 32×32 px untuk command biasa dan 36×36 px untuk aksi penting/berisiko.

## 4.4 Temuan per page

### Import

- Layout paling berbeda dari page lain dan memakai card besar bergaya dashboard.
- Folder area memiliki aksi nested yang tumpang tindih dengan click parent.
- Label `LANGKAH 2` muncul di bagian OCR pada page workflow pertama dan membingungkan hierarchy.
- OCR mode tidak semantic.
- "Terapkan Default" hanya memberi feedback visual lokal; perubahan behavior tidak boleh diasumsikan tanpa audit.
- Recent folder error masih memakai browser alert.

### Prepare

- File sangat besar dan mencampur data loading, canvas processing, IPC, selection, modal, serta presentation.
- Toolbar menutupi bagian atas image canvas.
- Thumbnail rail terlalu sempit untuk filename/status dan bergantung pada tooltip.
- Aksi single dan bulk memakai visual rules berbeda.
- Error ditempatkan di footer di antara info dan actions sehingga layout dapat bergeser.
- Crop overlay memiliki overlay ganda dan z-index hardcoded.

### Scan

- Page menggunakan vertical stack yang kemungkinan scroll pada 1366×768.
- Label dan copy bercampur Indonesia/English.
- Tiga summary card mengambil ruang besar untuk data sederhana.
- Log terbaru ditaruh di atas, sementara console lain memakai reverse order; mental model tidak konsisten.
- `Completed` menampilkan `validCount`; label harus diverifikasi dengan audit agar tidak menyatakan arti yang salah.

### Review

- Member selection memakai dropdown, sehingga operator sulit memindai keseluruhan antrean.
- Source viewer dan form sudah split, tetapi belum mempunyai splitter/width policy.
- Header dan footer form memakan ruang vertikal besar.
- Confidence lebih banyak ditunjukkan dengan dot warna.
- `Flag as Error` terlihat aktif namun tidak memiliki handler. Ini adalah product decision gate; redesign tidak boleh menciptakan business behavior baru.
- Delete-blocked case masih memakai `alert()`.

### Export

- Internal page `entry` menggabungkan connected automation dan legacy JSON; nav tetap wajib bernama Export sesuai brief.
- Help card, console, empat summary cards, dan table membuat hierarchy panjang.
- Legacy mode berupa toggle kecil walau mengubah primary task yang terlihat.
- Toast diimplementasikan ulang.
- Automation console memakai icon/status/progress/log language yang berbeda dari Scan.

## 4.5 Out-of-scope anomaly log

Temuan berikut harus dicatat, tetapi tidak boleh diperbaiki sebagai bagian dari visual refactor tanpa approval behavior terpisah:

- Tombol `Flag as Error` tanpa handler.
- Makna `Completed` versus `validCount` di Scan.
- Behavior "Terapkan Default" dan apakah memerlukan aksi eksplisit.
- Navigasi langsung ke semua workflow step dari Sidebar.
- Welcome/scan/review/export image overlay di `App.tsx` dikonfirmasi harus dipertahankan. Trigger dan urutan existing menjadi behavior contract.

Plan visual boleh menawarkan presentation baru, tetapi keputusan behavior harus berasal dari audit/product owner.

---

## 5. Design Principles

### 5.1 Workflow first

Posisi elemen ditentukan oleh frekuensi dan urutan kerja operator. Setiap page mempunyai satu primary action yang berada pada posisi konsisten.

### 5.2 Desktop native, web technology

Walaupun dibangun dengan React, UI mengikuti pola window, command bar, panes, inspector, shortcuts, focus, dan status bar aplikasi desktop.

### 5.3 Dense, not cramped

Density diperoleh dari hierarchy, alignment, dan control height yang tepat, bukan dari font terlalu kecil. Informasi sekunder boleh lebih rapat; tindakan penting tetap mudah ditarget.

### 5.4 Quiet surfaces

Border dan tonal surface menjadi pemisah utama. Shadow, blur, gradient, dan pill dipakai hanya jika mempunyai fungsi hierarchy yang jelas.

### 5.5 State is visible

Loading, dirty/saved, selected, active, warning, error, disconnected, dan completed selalu mempunyai visual serta accessible label.

### 5.6 Keyboard is a first-class input

Semua task utama yang sudah ada harus dapat dicapai tanpa mouse. Shortcut ditampilkan pada tooltip/menu dan tidak aktif saat user mengetik kecuali kombinasi modifier.

### 5.7 Progressive disclosure

Primary action selalu terlihat. Tool jarang digunakan masuk ke contextual toolbar atau overflow, bukan memenuhi workspace.

### 5.8 Preserve behavior, replace presentation

Setiap perubahan harus dapat dijelaskan sebagai pemetaan tampilan lama ke tampilan baru tanpa mengubah hasil proses.

---

## 6. Design Language: EntryMate Quiet Workstation

### 6.1 Visual character

- Pearl sebagai work surface utama dan Mineral Green sebagai canvas/surface lembut.
- Graphite sebagai text utama, title bar, workflow rail, log console, dan high-contrast anchor.
- Gold sebagai warna brand dan primary action; Light Gold sebagai highlight/icon di atas Graphite; Dark Gold sebagai border, focus, dan aksen terkontrol.
- Emas tidak dipakai sebagai dekorasi besar atau warna teks kecil di atas permukaan terang.
- Status memakai semantic foreground dan subtle tinted background.
- Border 1 px lebih dominan daripada shadow.
- Radius kecil-menengah.
- Tidak ada hover lift/scale pada card atau gambar operasional.
- Typography ringkas dengan angka/identifier yang mudah dipindai.

### 6.2 Layout grammar

```text
Window
├─ Title Bar (36)
└─ App Body
   ├─ Workflow Rail (56 collapsed / 192 expanded)
   └─ Page Region
      ├─ Page Command Bar (48–56)
      ├─ Workspace (fluid panes)
      └─ Status Bar (28)
```

Contextual inspector bukan elemen wajib di semua page. Ia muncul hanya bila ada active object atau field set yang perlu diedit.

### 6.3 Density model

- Compact toolbar control: 32 px.
- Default input/button: 36 px.
- High-emphasis primary action: 40 px bila ruang memungkinkan.
- Table row: 36 px compact, 40 px default.
- Pane header: 36–40 px.
- Page command bar: 48 px compact-height, 56 px default-height.
- Status bar: 28 px.

Tidak ada density switch pada fase awal. Seluruh UI memakai default desktop density yang sama.

---

## 7. Design Tokens

Token memakai tiga lapisan:

1. **Primitive:** raw color, spacing, type size.
2. **Semantic:** canvas, surface, text, accent, danger, border.
3. **Component:** button-primary-bg, input-border-focus, table-row-selected.

Page tidak boleh mengakses primitive color secara langsung.

## 7.1 Core brand palette — approved direction

| Warna | Value | Fungsi utama |
|---|---:|---|
| Graphite | `#1A1D1E` | Title bar/rail/log background, primary text, professional anchor |
| Gold | `#D9A94F` | Primary brand, primary button background, active highlight |
| Light Gold | `#F7D883` | Icon/highlight di atas Graphite, hover highlight, selected emphasis |
| Dark Gold | `#A66C2D` | Focus ring, border kuat, large label, dan aksen |
| Mineral Green | `#E7EFE8` | Window canvas, subtle panel, calm contextual background |
| Pearl | `#F9F9F9` | Main pane, input, table, dan clean working surface |

Keenam warna tersebut adalah sumber identitas visual. Design system tetap memerlukan warna turunan netral dan status agar setiap pasangan foreground/background lulus contrast serta error tidak terlihat seperti brand highlight.

## 7.2 Semantic color tokens — light theme

| Token | Value | Penggunaan |
|---|---:|---|
| `color.canvas` | `#E7EFE8` | Background window/workspace (Mineral Green) |
| `color.surface` | `#F9F9F9` | Pane dan control surface (Pearl) |
| `color.surface.raised` | `#FFFFFF` | Dialog/dropdown only |
| `color.surface.subtle` | `#F1F4F1` | Header row dan hover ringan |
| `color.surface.sunken` | `#DFE6E0` | Image canvas surround |
| `color.surface.inverse` | `#1A1D1E` | Rail, title bar, log console |
| `color.border` | `#D2D9D3` | Divider dan control border |
| `color.border.strong` | `#A8B1AA` | Active divider dan resize handle |
| `color.text` | `#1A1D1E` | Primary text (Graphite) |
| `color.text.muted` | `#4D5354` | Secondary text |
| `color.text.subtle` | `#686F70` | Metadata non-critical |
| `color.text.inverse` | `#F9F9F9` | Text di atas Graphite |
| `color.brand` | `#D9A94F` | Gold brand/action background |
| `color.brand.highlight` | `#F7D883` | Light Gold di atas Graphite |
| `color.brand.dark` | `#A66C2D` | Dark Gold border/focus/large accent |
| `color.brand.text` | `#965B24` | Derived accessible gold text di atas Pearl/Mineral Green |
| `color.brand.subtle` | `#F8EDCF` | Selected/brand-tinted surface |
| `color.action.primary.bg` | `#D9A94F` | Primary button background |
| `color.action.primary.fg` | `#1A1D1E` | Primary button text/icon |
| `color.action.primary.hover` | `#F7D883` | Primary button hover |
| `color.action.primary.pressed` | `#BE8B3E` | Derived pressed background dengan Graphite foreground |
| `color.focus.light` | `#A66C2D` | Focus outline di light surface |
| `color.focus.dark` | `#F7D883` | Focus outline di Graphite surface |
| `color.success` | `#25624F` | Operational success foreground/icon |
| `color.success.subtle` | `#E2F1E9` | Success surface |
| `color.warning` | `#965B24` | Operational warning foreground/icon |
| `color.warning.subtle` | `#F8EDCF` | Warning surface |
| `color.danger` | `#B42318` | Destructive/error foreground |
| `color.danger.subtle` | `#FDECEA` | Error surface |
| `color.info` | `#4D5354` | Neutral informational foreground |
| `color.info.subtle` | `#E7EFE8` | Informational surface |

### Contrast and usage rules

- Graphite di atas Pearl: sekitar **16.11:1**; aman untuk primary text.
- Gold di atas Graphite: sekitar **7.86:1**; aman untuk icon/text/highlight di dark surface.
- Light Gold di atas Graphite: sekitar **12.20:1**; aman untuk active icon dan focus pada dark surface.
- Graphite di atas Mineral Green: sekitar **14.46:1**; aman untuk long-form UI text.
- Gold di atas Pearl hanya sekitar **2.05:1**; tidak boleh digunakan sebagai text, thin icon, atau focus indicator di light surface.
- Dark Gold di atas Pearl sekitar **4.15:1**; cukup untuk large text/non-text accent, tetapi tidak untuk normal/small text. Gunakan `color.brand.text` (`#965B24`) untuk label emas kecil.
- Mineral Green adalah surface brand yang menenangkan, bukan pengganti semantic Success. Success, Warning, dan Danger tetap dibedakan dengan icon, label, dan warna status khusus.
- Target final: normal text ≥4.5:1; large text dan non-text boundary/state indicator ≥3:1.

### Distribution guideline

- 70–80%: Pearl dan Mineral Green sebagai working surfaces.
- 15–20%: Graphite untuk shell, text, log, dan structural anchors.
- Maksimum sekitar 10%: Gold family untuk brand, selection, focus, dan primary actions.
- Hindari gradient Gold, metallic effect, glow, atau shadow berwarna; kesan premium dibangun dari proportion dan contrast.

## 7.3 Typography tokens

| Token | Size / line-height / weight | Penggunaan |
|---|---|---|
| `type.caption` | 12 / 16 / 400 | Metadata dan secondary copy |
| `type.caption-strong` | 12 / 16 / 600 | Compact status dan form label |
| `type.body` | 14 / 20 / 400 | Default UI copy dan table cell |
| `type.body-strong` | 14 / 20 / 600 | Emphasis dan compact section title |
| `type.body-large` | 18 / 24 / 400 atau 600 | Dialog dan section title lapang |
| `type.subtitle` | 20 / 28 / 600 | Page title dan heading workstation |
| `type.title` | 28 / 36 / 600 | Completion atau empty state khusus |
| `type.display` | 40 / 52 / 600 | Angka progress utama |
| `type.mono` | 12 / 16 / 400 | Path, passport number, port, dan timestamp |

Rules:

- Sentence case untuk title, button, dan label.
- Uppercase hanya untuk kode data yang memang case-sensitive; label dan table header tetap sentence case.
- Path, passport number, port, timestamp, dan log memakai font mono.
- Inter Regular 400 dan Semibold 600 adalah dua weight UI utama; weight sintetis/interpolasi tidak digunakan.
- Teks UI informatif tidak boleh di bawah 12 px; 12 px hanya untuk caption, metadata, dan ruang yang benar-benar terbatas.
- Ukuran memakai `rem` agar browser/WebView dapat memperbesar teks; container harus reflow tanpa clipping saat text scale meningkat.

## 7.4 Spacing tokens

Structural spacing mengikuti kelipatan empat:

| Token | Value |
|---|---:|
| `space.0` | 0 |
| `space.1` | 4 px |
| `space.2` | 8 px |
| `space.3` | 12 px |
| `space.4` | 16 px |
| `space.5` | 20 px |
| `space.6` | 24 px |
| `space.8` | 32 px |
| `space.10` | 40 px |

Default rules:

- Icon-label gap: 8 px.
- Related controls: 8–12 px.
- Form field row gap: 12 px.
- Pane padding: 12–16 px.
- Page gutter: 12 px compact, 16 px standard, 20 px large.
- Major section gap: 20–24 px.

## 7.5 Radius tokens

| Token | Value | Penggunaan |
|---|---:|---|
| `radius.1` | 4 px | Checkbox, small badge |
| `radius.2` | 6 px | Button, input, row selection |
| `radius.3` | 8 px | Panel, popup, dialog sections |
| `radius.4` | 12 px | Dialog outer shell, rare hero empty state |
| `radius.pill` | 999 px | Status/badge only |

## 7.6 Elevation/shadow tokens

| Token | Intent |
|---|---|
| `elevation.0` | No shadow; default pane/card |
| `elevation.1` | Popup/toolbar floating; subtle 1–2 px separation |
| `elevation.2` | Dropdown, tooltip, toast |
| `elevation.overlay` | Dialog only |

Backdrop blur tidak digunakan pada page card atau sidebar. Blur hanya diperbolehkan pada modal scrim bila performance tetap stabil.

## 7.7 Motion tokens

| Token | Duration | Penggunaan |
|---|---:|---|
| `motion.instant` | 0 ms | Reduced motion / immediate state |
| `motion.fast` | 80 ms | Pressed, hover color |
| `motion.normal` | 120 ms | Focus, expand small control |
| `motion.panel` | 180 ms | Rail/inspector open-close |
| `motion.overlay` | 200 ms | Dialog/toast enter-exit |

Easing:

- Standard: `cubic-bezier(0.2, 0, 0, 1)`.
- Exit: `cubic-bezier(0.4, 0, 1, 1)`.
- Tidak ada bounce, scale hover, atau card lift.
- Progress yang mewakili proses boleh bergerak; decorative pulse harus dihentikan ketika reduced motion aktif.

## 7.8 Z-index rules

| Token | Value | Layer |
|---|---:|---|
| `z.base` | 0 | Workspace |
| `z.sticky` | 10 | Sticky pane/command header |
| `z.rail` | 20 | Workflow rail/title integration |
| `z.popover` | 30 | Dropdown, date picker, tooltip |
| `z.toast` | 40 | Toast region |
| `z.modal` | 50 | Dialog and scrim |
| `z.system` | 60 | Update/restart critical overlay |

Raw numeric z-index di component/page tidak diperbolehkan.

## 7.9 Iconography

- Satu set: Lucide outline.
- Default size: 16 px control, 20 px toolbar/pane, 24 px empty state.
- Stroke default 1.75; active boleh 2 jika diperlukan.
- Default icon memakai Graphite/muted; active icon pada Graphite shell memakai Light Gold.
- Ikon dekoratif `aria-hidden`; icon-only action wajib accessible name.
- Jangan memakai ikon sebagai satu-satunya penanda status/destructive action.
- Product logo hanya muncul di workflow rail/titlebar, bukan di setiap page.

---

## 8. Component Architecture

## 8.1 Layering

```text
Application composition
├─ App Shell
│  ├─ WindowTitleBar
│  ├─ WorkflowRail
│  ├─ PageCommandBar
│  ├─ WorkspaceFrame
│  └─ AppStatusBar
├─ Workstation patterns
│  ├─ Pane / PaneHeader / SplitPane
│  ├─ InspectorPanel
│  ├─ ContextualToolbar
│  ├─ ImageViewer
│  ├─ ItemQueue
│  └─ LogConsole
├─ Feedback and overlays
│  ├─ Alert
│  ├─ Progress
│  ├─ ToastCenter
│  ├─ Tooltip
│  ├─ Popover / Dropdown
│  └─ Dialog
└─ Primitives
   ├─ Button / IconButton
   ├─ Input / Select / Checkbox / RadioGroup
   ├─ Badge / StatusBadge
   ├─ Tabs
   ├─ Table
   └─ Card (limited usage)
```

Pages mengomposisikan komponen dan menghubungkan handler yang ada. Primitive tidak boleh memanggil store atau IPC secara langsung.

## 8.2 Component contracts

### Layout / WorkspaceFrame

- Satu scroll owner per major region.
- Menyediakan slots: command bar, primary pane, optional inspector, status bar.
- Menyimpan focus order sesuai urutan visual.
- Tidak memaksakan `max-width: 1200px` pada workstation.

### Navigation / WorkflowRail

- Expanded 192 px; collapsed 56 px.
- Menampilkan lima step yang sama dan urutan yang sama.
- State: current, available, completed, attention; state hanya presentational berdasarkan data yang sudah ada.
- `aria-current="step"` pada step aktif.
- Collapse state boleh lokal/persisted UI preference, tanpa memengaruhi workflow.

### PageCommandBar

- Kiri: step label kecil, page title, optional selection/context.
- Tengah: contextual toolbar bila perlu.
- Kanan: primary dan secondary page actions.
- Tinggi konsisten 48/56 px.
- Primary action tidak berpindah posisi tanpa alasan breakpoint.

### Button / IconButton

- Variants: primary, secondary, subtle, danger, icon-only.
- Sizes: 32, 36, 40.
- States: default, hover, pressed, focus-visible, disabled, loading.
- Loading mempertahankan lebar dan label agar layout tidak bergeser.
- Disabled action yang penting memiliki reason yang terlihat atau tooltip.

### Input

- Height 36 px, label selalu visible.
- Optional hint, error, warning, confidence, and source-value slots.
- Error message terhubung dengan `aria-describedby`.
- State tidak hanya dibedakan oleh border color.

### Select / Dropdown

- Native select tetap boleh untuk simple fixed choices.
- Custom dropdown wajib mengikuti combobox/listbox keyboard pattern.
- Arrow keys bergerak, Enter memilih, Escape menutup, Home/End ke batas.
- Popup tidak boleh terpotong pane overflow.

### Dialog

- Variants: confirmation, destructive, progress/blocking, information.
- Wajib: accessible title, optional description, focus trap, initial focus, Escape policy, focus restore.
- Destructive confirmation menempatkan default focus pada Cancel.
- Tidak menggunakan dialog untuk passive success.

### Toast

- Variants: success, info, warning, error.
- Maksimal tiga visible; berikutnya masuk queue.
- Success auto-dismiss 4–6 detik; error persisten sampai dismiss atau action.
- `aria-live="polite"` untuk info/success; assertive hanya untuk blocking error.
- Tidak memuat informasi yang hanya dapat diakses selama timeout.

### Tooltip

- Untuk icon explanation dan shortcut discoverability.
- Muncul saat hover dan keyboard focus.
- Tidak menjadi satu-satunya tempat untuk disabled reason yang kritis.

### Card

- Hanya untuk grouped summary atau empty state yang benar-benar berdiri sendiri.
- Default tanpa shadow.
- Tidak dipakai untuk membungkus setiap section.

### Panel / Pane

- Border-based surface dengan header 36–40 px.
- Optional actions, counter, and scroll body.
- Splitter mendapat target pointer dan keyboard resize behavior.

### Table

- Sticky header, 36/40 px row, numeric alignment, truncation dengan accessible full value.
- Selection dan current row dibedakan dengan background, indicator, dan semantics.
- Empty/error/loading row memakai full-span state.
- Horizontal scroll hanya jika kolom esensial memang tidak dapat dipadatkan.

### Toolbar

- Group action berdasarkan scope.
- Separator hanya di antara group.
- Icon-only action mempunyai tooltip berisi label + shortcut.
- Contextual bulk toolbar mengganti, bukan menumpuk, toolbar default.

### Status Bar

- Tinggi 28 px dan selalu berada di bawah page region.
- Menampilkan: active folder/session, engine/connection state, progress singkat, dan app version/update state bila relevan.
- Bukan tempat primary action atau error panjang.

### Progress

- Variants: determinate bar, indeterminate bar/spinner, compact inline.
- Wajib mempunyai accessible name, current value, dan status text.
- Angka dan label selalu tampil untuk long-running process.

### Badge / StatusBadge

- Status vocabulary: Neutral, Active, Ready, Success, Warning, Error, Disconnected.
- Setiap badge: icon/dot shape + text + color.
- Pill hanya untuk status pendek; bukan button.

### Tabs

- Dipakai hanya untuk peer views pada konteks yang sama, bukan untuk menyembunyikan urutan workflow.
- Arrow key mengubah active tab sesuai keyboard convention.
- Connected automation vs Manual JSON boleh memakai mode switch/segmented control, bukan workflow step baru.

### Image Viewer

- Canvas netral/sunken, fit-to-window default.
- Toolbar: zoom out, zoom value/menu, zoom in, fit, reset bila behavior sudah tersedia.
- Pointer pan dan keyboard pan.
- Active filename, dimensions/size, dan state selalu terlihat.
- Tidak memakai hover scale pada image.

### Inspector Panel

- Lebar 360–440 px; compact minimum 400 px untuk Review form bila memungkinkan.
- Sticky identity/status header dan sticky action footer.
- Section memakai heading/divider, bukan nested card.
- Form body satu-satunya scroll owner di panel.

### Log Console

- Satu behavior untuk Scan dan Export.
- Urutan waktu konsisten; default oldest-to-newest dengan auto-follow saat user berada di bawah.
- User dapat pause auto-follow, clear visual log bila handler ada, dan copy selection.
- Level icon + label + timestamp; warna sebagai reinforcement.
- Mono 12 px, row 18 px.

---

## 9. App Shell Blueprint

## 9.1 Window Title Bar

- Tinggi 36 px; kontrol window tetap 46 px lebar agar sesuai muscle memory Windows.
- Kiri: app icon 16 px, `EntryMate`, optional active batch name.
- Tengah kosong/draggable, bukan badge dekoratif `Desktop`.
- Kanan: update indicator bila ada, lalu minimize/maximize/close.
- Double click dan drag behavior lama dipertahankan.
- Pada scaling 150–200%, title tetap tidak terpotong oleh window controls.

## 9.2 Workflow Rail

- Menempel ke sisi kiri, tidak floating.
- Lima step selalu berada dalam satu urutan vertikal.
- Expanded menampilkan label + status pendek; collapsed menampilkan icon + tooltip.
- Product update masuk ke bottom utility area.
- Tidak ada card shadow/backdrop blur.

## 9.3 Page Command Bar

- Menggantikan card header besar di setiap page.
- Primary action selalu di kanan.
- Progress/selection context di tengah atau tepat di bawah title.
- Sticky di dalam page region.

## 9.4 Workspace

- Mengisi seluruh sisa window.
- Mendukung one-, two-, dan three-pane layout.
- Pane width mempunyai minimum dan sensible maximum; center canvas menyerap extra width.
- Divider/splitter 1 px dengan interactive hit target minimal 8 px.

## 9.5 Inspector

- Dipakai pada Prepare dan Review.
- Dapat collapse pada compact desktop hanya bila seluruh command tetap tersedia melalui contextual toolbar/popup.
- Collapse preference tidak memengaruhi selection atau data.

## 9.6 Status Bar

Informasi yang diusulkan:

- Kiri: folder/batch aktif atau `Belum ada folder`.
- Tengah: OCR/automation connection state sesuai page.
- Kanan: item count/progress, zoom bila relevan, version/update status.

Status bar hanya menampilkan state yang sudah tersedia. Tidak menambah polling atau backend behavior.

---

## 10. Page Blueprints

## 10.1 Import Folder

### Layout

```text
Command Bar: Import folder                         [Pilih folder] [Lanjut]
Workspace
├─ Main setup pane
│  ├─ Selected folder row
│  ├─ OCR mode radio group
│  └─ Batch default form
└─ Recent folders pane
Status Bar: folder aktif · OCR mode · default state
```

- Standard/large: 2-column 65/35.
- Compact: recent folders menjadi lower pane, bukan mobile card stack yang terlalu panjang.
- Folder path memakai mono, satu baris ellipsis, tooltip/copy bila tersedia tanpa backend baru.

### Hierarchy

1. Pilih/lihat folder.
2. Pilih OCR mode dan PDF option.
3. Isi nilai rombongan.
4. Lanjut ke Prepare.

Tidak ada label `Langkah 2` di dalam page Import.

### Components

- FolderPickerRow.
- OCRModeRadioGroup.
- Checkbox.
- BatchDefaultsForm.
- RecentFolderList.
- Inline Alert / Dialog untuk broken recent path.

### Interaction

- Klik row recent folder menjalankan behavior existing.
- Delete recent memakai confirmation dialog; tidak menghapus file asli.
- Folder picker adalah real button, bukan clickable container.
- OCR mode memakai radio semantics.
- Primary action `Lanjut` disabled bila existing condition belum terpenuhi; reason terlihat.

### Keyboard

- `Ctrl+O`: pilih folder.
- Arrow keys: berpindah OCR mode saat focus di radio group.
- `Ctrl+Enter`: lanjut jika aksi tersedia.
- Delete recent hanya melalui focused row action, bukan global Delete.

### States

- Loading: folder chooser pending atau state existing `isChoosingFolder` bila digunakan.
- Empty: belum ada folder; satu CTA `Pilih folder`.
- Error: recent path/manifest tidak ditemukan; inline alert + remove-history behavior existing.
- Success: folder aktif terlihat di row dan status bar; tidak perlu success toast berulang.

## 10.2 Prepare Photos

### Layout

```text
Command Bar: Prepare · n photos                    [Start scan]
Workspace
├─ Asset rail/list (88–220)
├─ Image canvas (flex)
└─ Inspector tools (260–320)
Status Bar: filename · index/total · size · edited state
```

- Compact width: asset rail icon/thumbnail mode 80 px, inspector menjadi contextual flyout bila perlu.
- Standard+: asset list dapat menampilkan thumbnail, filename, dan selection state.
- Image action tidak menutupi canvas.

### Components

- PhotoQueue.
- ImageViewer/Canvas.
- ImageInspector.
- ContextualBulkToolbar.
- CropDialog.
- ConfirmationDialog.
- Inline Alert.

### Interaction

- Single selection menampilkan crop/rotate/endorsement/compress/delete yang memang tersedia.
- Bulk selection mengganti command group dengan Select all/Clear/Endorsement/Delete.
- Destructive dan move-to-endorsement selalu menjelaskan count serta effect.
- File size warning berada di inspector/status bar, bukan overlay besar di image.
- Pagination boleh tetap dipertahankan untuk parity; visualnya menjadi queue navigation yang jelas.

### Keyboard

- Up/Down atau Left/Right pada queue: active item.
- `Ctrl+A` dalam queue/select mode: pilih semua.
- `C`: crop hanya ketika focus bukan input dan image aktif.
- `Ctrl+R` / `Ctrl+Shift+R`: rotate kanan/kiri.
- `Delete`: membuka confirmation untuk selection aktif.
- `Ctrl+Enter`: Start scan jika tersedia.

Shortcut final harus diuji terhadap shortcut browser/WebView dan hanya didaftarkan dalam scope page.

### States

- Loading: queue skeleton + indeterminate canvas message.
- Empty: folder tidak menghasilkan image; CTA kembali ke Import.
- Image loading error: filename + cause + retry action hanya jika handler retry existing/approved.
- Processing save: active tool loading, selection tetap stabil.
- Error: persistent inline alert di bawah command bar, bukan layout-shifting footer.

## 10.3 OCR Scan

### Layout

```text
Command Bar: Scan · current stage                  [Stop scan]
Workspace
├─ Progress header: file · n/total · percent · ETA
├─ Metrics strip: total · valid · review · errors
└─ Log Console (fills remaining height)
Status Bar: engine mode · elapsed · worker state
```

Semua informasi inti harus terlihat tanpa page scroll pada 1366×768. Log console menyerap sisa tinggi.

### Components

- ScanProgress.
- MetricStrip (bukan empat hero cards).
- LogConsole.
- StopConfirmation bila audit mensyaratkan confirmation; jangan menambah confirmation tanpa keputusan behavior.
- Inline fatal/nonfatal Alert.

### Interaction

- Progress bar determinate berdasarkan state current/total yang sama.
- Event stage ditampilkan sebagai secondary progress text.
- Stop adalah danger-secondary, bukan primary merah besar kecuali scan aktif.
- Nonfatal error masuk log dan summary; fatal error mendapat persistent alert.

### Keyboard

- F6/Shift+F6 berpindah command bar, progress region, log console, status bar.
- Stop tidak memakai naked `Esc`; hindari accidental cancellation.
- Log console mendukung keyboard scroll dan text selection.

### States

- Starting: indeterminate progress, `Menyiapkan antrean`.
- Running: determinate.
- Stopping: stop action loading/disabled, existing state bila tersedia.
- Complete: success state kemudian navigation existing tetap berjalan.
- Failed/stopped: persistent alert dengan message existing.

## 10.4 Review

### Layout

```text
Command Bar: Review · reviewed/total            [Approve & next]
Workspace
├─ Member queue (220–260)
├─ Source image viewer (flex, min 380)
└─ Inspector form (400–460)
Status Bar: member index · required fields · review status · zoom
```

- Compact width: member queue menjadi combobox pada command bar; image dan form tetap split.
- Height <800: section descriptions disembunyikan, form action footer tetap visible.
- Form line length dibatasi oleh inspector, bukan seluruh workspace.

### Components

- MemberQueue / compact MemberCombobox.
- ReviewImageViewer.
- ReviewInspector.
- FieldGroup.
- FieldWithEvidence.
- StatusBadge.
- Delete confirmation/block alert.

### Hierarchy

1. Identitas active member dan review state.
2. Source image.
3. Required fields/missing/low confidence.
4. Approve & next.
5. Destructive/exception actions.

### Interaction

- Queue memperlihatkan Reviewed/Needs review/Error dengan icon + label.
- Active member selalu sinkron dengan source viewer dan inspector.
- Missing field menampilkan label, icon, border, dan error text.
- OCR source value ditampilkan konsisten bila final value berubah.
- `Approve & next` tetap menjalankan handler existing dan autosave behavior tidak diubah.
- Delete masuk overflow/danger zone, tetap mudah ditemukan tetapi tidak bersebelahan dengan primary approve.
- `Flag as Error` tidak diberi behavior baru. Pilihan visual menunggu product decision: hilangkan bila memang dead affordance, atau tampilkan disabled dengan penjelasan.

### Keyboard

- `Alt+Up` / `Alt+Down`: member sebelumnya/berikutnya.
- `Ctrl+Enter`: Approve & next jika semua required fields terisi.
- F6: queue → viewer → inspector → actions.
- Viewer focus: `+`, `-`, `0/Fit`, arrow pan.
- Form: standard Tab/Shift+Tab; custom date picker mengikuti calendar keyboard pattern.

### States

- Empty manifest: page-level EmptyState dengan kembali ke Import atau Export hanya sesuai existing behavior.
- Image loading: skeleton/label dengan filename.
- Missing image: persistent source-pane error; form tetap dapat diakses.
- Save error: persistent alert; jangan menampilkan false-success.
- All reviewed: existing transition ke `entry` tetap dipertahankan.

## 10.5 Export

### Layout

```text
Command Bar: Export · readiness                  [Buka Nusuk] [Primary mode action]
Workspace
├─ Mode switch: Connected extension | Manual JSON
├─ Readiness/connection strip
├─ Batch table (flex)
└─ Automation/log pane (docked or lower pane)
Status Bar: connected state · selected/ready count · progress
```

Mode switch menggunakan state `legacyMode` yang sama. Ini bukan workflow step baru.

### Connected extension mode

- Connection state terlihat di command bar/status strip.
- `Load batch` dan `Start` berada pada action sequence yang jelas.
- Current member/step/progress menjadi compact process pane.
- Log console memakai komponen yang sama dengan Scan.
- Petunjuk lima langkah menjadi collapsible Help, bukan large always-visible card.

### Manual JSON mode

- Primary action `Export JSON`.
- Last output path dan `Buka folder JSON` terlihat sebagai result region.
- Eligibility/error reason ditampilkan sebelum user menekan export jika data sudah tersedia di `exportPreview`.

### Components

- ModeSwitch.
- ConnectionStatus.
- ReadinessStrip.
- BatchTable.
- AutomationProcessPane.
- LogConsole.
- ResultBanner.

### Keyboard

- `Ctrl+L`: Load batch saat connected mode dan action tersedia.
- `Ctrl+Enter`: Start automation saat action tersedia.
- `Ctrl+E`: Export JSON saat manual mode.
- Shortcut tidak aktif saat focus berada di editable control dan selalu muncul di tooltip.

### States

- Disconnected: clear cause/instruction; Load/Start disabled dengan reason.
- Connected idle: ready state.
- Running: active member, step, and determinate progress.
- Complete: persistent completion summary tetap tersedia di page, disertai celebratory image overlay yang dipertahankan sesuai trigger existing.
- Export success: result banner + path action.
- Error: persistent alert + log detail; no ephemeral-only error.

---

## 11. Global Interaction Rules

## 11.1 Pointer and visual states

| State | Rule |
|---|---|
| Hover | Color/border change 80 ms; no lift or scale |
| Active/pressed | Darker/tinted pressed surface; optional 1 px inset, no movement |
| Focus-visible | 2 px solid focus outline, 2 px offset, minimum 3:1 against adjacent colors |
| Disabled | Reduced emphasis, cursor default/not-allowed, state remains readable |
| Loading | Preserve label/width; spinner 16 px; set busy semantics |
| Selected | Accent-subtle background + leading/outline indicator + semantic selected state |
| Current | Stronger than selected; use current marker and label |
| Error | Icon + title/message + semantic foreground/surface, not color alone |

## 11.2 Selection and bulk action

- Click selects current item.
- Ctrl+click toggles item bila multi-select memang tersedia.
- Shift range selection hanya ditambahkan jika parity/behavior sudah disetujui; tidak diasumsikan.
- `Ctrl+A` scope lokal pada queue/table, bukan global app.
- Bulk toolbar menyebut count dan mengganti contextual actions.
- Sesudah bulk delete/move, focus pindah ke next valid item atau queue heading.

## 11.3 Drag and drop

- Crop rectangle tetap memakai pointer capture yang sudah ada.
- Drag state: cursor/outline berubah, target jelas, Escape membatalkan bila aman.
- Folder drag-and-drop bukan scope awal karena belum terlihat sebagai behavior aktif pada source. Jangan menambahkannya dalam visual refactor tanpa behavior approval.

## 11.4 Notifications

- Toast: feedback singkat non-blocking.
- Inline alert: masalah yang harus dibaca atau diperbaiki dalam context.
- Dialog: keputusan/destructive/blocking.
- Status bar: passive continuous state.
- Browser `alert()` harus dipetakan ke Alert/Dialog tanpa mengubah condition atau result.

## 11.5 Keyboard model global

| Shortcut | Scope | Action |
|---|---|---|
| `Alt+1…5` | Global | Focus/navigate ke workflow step yang sama dengan click existing |
| `Ctrl+O` | Import | Pilih folder |
| `Ctrl+Enter` | Page | Primary safe action sesuai page |
| `F6` / `Shift+F6` | Page | Cycle major regions |
| `Esc` | Overlay/context | Close popover/dialog/cancel selection bila tidak destructive |
| `Enter` / `Space` | Focused control | Activate/toggle sesuai control semantics |
| Arrow keys | Composite control | Navigate list, radio, tab, menu, calendar |

Global shortcut tidak boleh menangkap event saat user mengetik kecuali menggunakan modifier yang memang dimaksudkan.

## 11.6 Focus lifecycle

- Page navigation: focus ke page title/command bar heading, tanpa scroll jump.
- Dialog open: focus ke title/first safe action; destructive dialog ke Cancel.
- Dialog close: focus kembali ke trigger.
- Item deletion: focus ke next item, previous item, atau queue heading.
- Toast tidak mengambil focus.
- Popup close mengembalikan focus ke trigger.

---

## 12. Accessibility Standard

Target resmi: **WCAG 2.2 AA**, dengan tambahan quality bar desktop Windows.

### 12.1 Keyboard

- Semua primary workflow dapat selesai dengan keyboard saja.
- Tab order mengikuti visual order.
- Composite widgets memakai arrow navigation, bukan membuat setiap child masuk ke tab order.
- Shortcut discoverable melalui tooltip/menu/shortcut help.

### 12.2 Focus

- Visible pada semua interactive control.
- Tidak tertutup sticky header/footer atau popup.
- 2 px outline minimum; target internal mengejar WCAG focus appearance yang jelas.
- Tidak ada perubahan context hanya karena focus.

### 12.3 Contrast and color

- Normal text ≥4.5:1.
- Large text dan non-text boundary/state indicator ≥3:1.
- Status tidak pernah mengandalkan warna saja.
- Forced-colors/Windows High Contrast harus mempertahankan border, focus, current, selected, dan error state.

### 12.4 Target size

- WCAG AA minimum 24×24 CSS px.
- EntryMate default 32×32 px.
- Frequent, sequential, atau destructive action 36×36 px atau lebih.
- Title bar window controls tetap 46 px lebar.

### 12.5 Semantics

- Landmark: title bar/header, navigation, main, complementary/inspector, status.
- Dialog, table, progressbar, combobox/listbox, tabs, radio group, dan alerts memakai semantic pattern yang sesuai.
- Decorative icon/image disembunyikan dari accessibility tree.
- Source passport image mempunyai alt yang menyebut active filename/context, bukan generic text.

### 12.6 Scaling and display

- Validasi pada 100%, 125%, 150%, 175%, dan 200% Windows scaling.
- Tidak ada critical clipping atau action yang hilang pada minimum window 1120×760.
- Saat window berpindah antar-monitor/DPI, pane reflow berdasarkan CSS/effective pixels.
- Jangan menyimpan pixel position popup/dialog lintas monitor.

### 12.7 Motion

- Hormati `prefers-reduced-motion`.
- Non-essential page slide, scale, pulse, parallax, dan hover movement dimatikan.
- Progress essential tetap dapat berubah tanpa decorative sweep.

### 12.8 Accessibility verification

- Automated: semantic/contrast/focus rule checks.
- Manual: keyboard-only lima workflow, Narrator smoke test, 200% scaling, Windows High Contrast, reduced motion.
- Test focus restore untuk semua dialog/dropdown.
- Test live announcement untuk scan, error, connection, dan export result tanpa spam event.

---

## 13. Responsive Desktop Strategy

Breakpoint mengikuti **ukuran app window**, bukan resolusi fisik monitor.

| Window class | Width | Shell behavior | Workspace behavior |
|---|---:|---|---|
| Compact desktop | 1120–1279 | Rail 56, command bar compact | 2-pane priority; queue/inspector dapat menjadi compact surface |
| Standard desktop | 1280–1599 | Rail 192 atau user-collapsed | 2–3 panes; gutters 16 |
| Large desktop | 1600–2199 | Rail 192 | 3 panes; inspector 400–440; canvas menyerap lebar |
| Wide/ultrawide | ≥2200 | Rail 192 | 3 panes + docked log/auxiliary region; text measure tetap dibatasi |

### 13.1 Target resolution behavior

#### 1366×768

- Compact rail 56 px.
- Title bar 36, command bar 48, status bar 28.
- Gutter 12 px.
- Header description non-essential disembunyikan.
- Scan tidak memerlukan page scroll.
- Review memakai member combobox + viewer/form split.
- Primary action selalu terlihat.

#### 1440×900

- Expanded rail 192 px diperbolehkan.
- Gutter 16 px.
- Prepare: thumbnail queue + canvas + compact inspector.
- Review: 3 pane jika minimum widths terpenuhi; jika tidak, queue compact.

#### 1920×1080

- Full 3-pane workstation.
- Inspector 420–440 px.
- Queue 220–260 px.
- Extra width diberikan ke image/table, bukan memperlebar form tanpa batas.

#### 2560×1440

- Canvas/table memakai ruang tambahan.
- Auxiliary log dapat didock di kanan/bawah tanpa menutupi core workflow.
- Content informasional dibatasi sekitar 72 karakter per baris.

#### Ultrawide

- Hindari single centered 1200 px column.
- Gunakan pane tambahan/docked log hanya untuk informasi yang sudah tersedia.
- Jangan menduplikasi primary action.
- Max functional workspace dapat dibatasi sekitar 2160–2240 px bila stretching mulai merusak scanability; sisa menjadi canvas margin, bukan giant card.

### 13.2 Height rules

- `<800 px`: compact vertical density, single-line command bar, descriptions collapsed.
- `800–999 px`: default density.
- `≥1000 px`: pane body tumbuh; jangan memperbesar header/card secara proporsional.

---

## 14. Motion Guidelines

- Motion menjelaskan state change, bukan menghias.
- Page change: opacity 120 ms maksimum; slide hanya 4 px jika tidak reduced-motion.
- Rail/inspector resize: 180 ms; content tidak boleh blur.
- Dropdown/dialog: opacity + 2–4 px position 120–200 ms.
- Toast: enter 180 ms, exit 120 ms.
- Hover: color/border 80 ms.
- Progress: smooth 120–240 ms ketika value berubah; tidak membuat fake progress.
- Loading spinner hanya untuk proses yang benar-benar berjalan.
- Celebration image modal saat welcome/completion dipertahankan sesuai keputusan product. Presentation dimigrasikan ke `CompletionOverlay` yang responsif dan accessible tanpa mengubah trigger: welcome saat startup, scan complete pada `scan → validation`, review complete pada `validation → entry`, dan export complete setelah `isEntryRunning` berubah dari aktif menjadi selesai di page `entry`.
- Karena asset berukuran portrait 1536×2730, overlay memakai image fit-contain, batas tinggi window, Graphite scrim, tombol close yang jelas, Escape handling, focus trap/restore, dan reduced-motion entry. Asset tidak di-crop, tidak diubah, dan tidak diganti.

---

## 15. Migration Roadmap

Setiap fase adalah mergeable dan dapat dihentikan tanpa memaksa migrasi page berikutnya.

## Phase 0 — Audit Reconciliation and Behavior Freeze

Deliverables:

- Dapatkan dokumen audit frontend yang hilang.
- Reconcile setiap temuan dan tandai: confirmed, superseded by source, unknown.
- Buat inventory seluruh visible action → handler → store/IPC mapping.
- Catat state matrix per page: empty, loading, active, success, error, disabled.
- Ambil baseline screenshot lima page pada 1366×768, 1440×900, 1920×1080, 2560×1440, ultrawide.
- Tetapkan decision untuk anomaly log.

Exit criteria:

- Tidak ada unknown behavior pada primary actions.
- Workflow/IPC parity checklist disetujui.
- Plan ini diperbarui dan berstatus `approved for implementation`.

## Phase 1 — Foundations and Tokens

Deliverables:

- Token primitive/semantic/component.
- Typography, icon, focus, density, motion, z-index foundations.
- CSS layering/naming rules.
- Reduced motion, forced colors, global scrollbar policy.

Exit criteria:

- Tidak ada visual page migration.
- Existing UI tetap berfungsi.
- Token contrast matrix lulus.
- Tidak ada raw z-index baru atau static inline visual styles pada foundation baru.

## Phase 2 — Core Components

Build order:

1. Button/IconButton.
2. Input/Select/Checkbox/RadioGroup.
3. Badge/StatusBadge/Alert/Progress.
4. Tooltip/Popover/Dropdown.
5. Dialog/ToastCenter.
6. Pane/Toolbar/Table/Tabs.
7. ImageViewer/Inspector/LogConsole patterns.

Exit criteria:

- Semua state contract terdokumentasi.
- Keyboard and focus behavior lulus component tests.
- Komponen tidak memanggil store/IPC langsung.

## Phase 3 — App Shell

Deliverables:

- New title bar presentation dengan behavior window yang sama.
- Workflow rail.
- Page command bar frame.
- Workspace/status bar.
- Breakpoint rules.

Exit criteria:

- Semua lima page lama dapat dirender di shell baru.
- Navigation behavior identik.
- Minimum window dan target scaling lulus.
- Drag, double-click maximize, minimize, restore, dan close parity lulus.

## Phase 4 — Import

Deliverables:

- Folder picker, OCR mode, defaults, recent folders, confirmation/error presentation.

Exit criteria:

- Folder selection, recent loading/removal, mode/default state, and next action menghasilkan state yang identik.
- Full keyboard completion.
- 1366×768 primary action visible.

## Phase 5 — Prepare

Deliverables:

- Asset queue, viewer, tool inspector, bulk toolbar, crop/confirm dialogs.

Exit criteria:

- Prepare IPC payload dan result identik.
- Crop/rotate/compress/delete/endorsement single and bulk parity lulus.
- Selection tidak hilang saat layout berubah.
- Image operations tetap responsif pada target resolutions.

## Phase 6 — Scan

Deliverables:

- Unified progress, metric strip, log console, error presentation.

Exit criteria:

- Seluruh `scan-event` mapping identik.
- Stop behavior identik.
- No dropped visible state saat event burst.
- Live announcements tidak spam.

## Phase 7 — Review

Deliverables:

- Member queue/compact selector, viewer, inspector, field states, action footer.

Exit criteria:

- Field normalization, Arabic auto-update, autosave, companion logic, required-field gate, approve-next, delete, and transition parity lulus.
- No manifest/schema changes.
- Keyboard-only review scenario lulus.

## Phase 8 — Export

Deliverables:

- Mode switch presentation, readiness/batch table, connected automation console, manual JSON result.

Exit criteria:

- `legacyMode`, export eligibility, companion validation, batch payload, connection events, Load Batch, Start, and result path parity lulus.
- Connected/disconnected/running/complete/error states teruji.

## Phase 9 — Cross-page Polish and Accessibility

Deliverables:

- Copy consistency.
- Shortcut help and tooltips.
- All overlays migrated.
- Responsive and scaling polish.
- High contrast, Narrator, reduced motion.
- Visual regression suite.

Exit criteria:

- Semua quality gates pada bagian 16 lulus.
- Tidak ada old visual primitive yang masih dipakai tanpa documented exception.
- No business/IPC/OCR/automation diff.

---

## 16. Quality Gates and Definition of Done

## 16.1 Behavior parity

- Workflow tetap tepat lima step dan urutan sama.
- Semua handler lama terpetakan.
- Store update keys dan value semantics sama.
- IPC command names, arguments, payload, and result handling sama.
- Event listeners dan transition outcome sama.
- Manifest/export output tidak berubah.
- Tidak ada backend, OCR, automation, atau shared protocol diff.

## 16.2 Visual consistency

- 100% component/page color memakai semantic token, kecuali canvas image data.
- Tidak ada raw z-index.
- Tidak ada static inline style pada migrated UI.
- Satu icon family.
- Satu type ramp.
- Radius/elevation sesuai usage rules.
- Primary action placement konsisten.

## 16.3 Desktop responsiveness

- Target screenshots lulus pada lima window classes.
- Tidak ada app-level horizontal scroll pada minimum window.
- Primary action terlihat tanpa scroll pada 1366×768 untuk Import, Prepare, Scan, Review.
- Ultrawide tidak menjadi centered narrow website.
- 200% scaling tidak menghilangkan task-critical controls.

## 16.4 Accessibility

- Keyboard-only workflow end-to-end.
- Focus visible, logical, restored, dan tidak tertutup.
- Dialog/dropdown/date picker semantics lulus.
- Text and non-text contrast lulus.
- Status tidak color-only.
- Reduced motion and forced colors lulus.
- Narrator smoke test untuk page title, navigation, progress, form errors, dialog, toast, table.

## 16.5 Performance and stability

- Visual response terhadap input lokal terasa ≤100 ms.
- Page/pane transition ≤200 ms.
- No layout shift ketika button masuk loading state.
- Log event burst tidak menyebabkan entire page rerender yang terlihat.
- Image viewer/crop tetap usable pada file besar yang saat ini didukung.
- Backdrop blur tidak dipakai sebagai default surface.

## 16.6 Maintainability

- Page berfungsi sebagai orchestration, bukan tempat mendefinisikan visual primitive.
- Component props typed; `any` reduction dilakukan hanya bila tidak mengubah contract dan disetujui sebagai refactor terpisah.
- Shared component tidak mengetahui page-specific Zustand state.
- Setiap exception token/component rule didokumentasikan.

---

## 17. Risks and Mitigations

| Risk | Dampak | Mitigasi |
|---|---|---|
| Audit frontend belum tersedia | Plan dapat melewatkan requirement historis | Phase 0 reconciliation mandatory |
| Handler dan presentation bercampur di page besar | Refactor visual dapat mengubah side effect | Characterization/action map sebelum ekstraksi |
| Prepare 700+ lines | Konflik dan regression tinggi | Migrasi per region: queue → viewer → toolbar → dialogs |
| Review autosave tiap field | Component replacement dapat mengubah timing/value | Keep callback boundary dan event semantics identik |
| Custom title bar | Window behavior dapat rusak | Separate shell visual test + native parity checklist |
| Z-index/overflow lama | Popup terpotong atau salah layer | Overlay portal/layer contract dan scroll owner rule |
| Mixed language/status semantics | Label baru bisa mengubah makna | Copy glossary + audit review, bukan sekadar translate |
| Feature temptation saat redesign | Scope creep ke workflow/business | Anomaly log; UI-only decision gate |
| Large-bang rollout | Sulit rollback | Phase per page dan optional migration flag |

---

## 18. Implementation Decisions

1. **Resolved:** source aktif menjadi baseline parity karena audit frontend terpisah belum tersedia; pengguna telah menyetujui eksekusi.
2. **Resolved:** celebratory welcome/completion image overlay dipertahankan dengan file dan trigger existing, lalu diberi presentation dialog yang accessible.
3. **Resolved:** kontrol `Flag as Error` yang tidak memiliki handler dihapus dari footer Review agar tidak menampilkan affordance palsu; tidak ada behavior baru yang dibuat.
4. **Resolved:** metric Scan memakai label faktual `Data valid`, tidak memakai istilah `Completed` yang ambigu.
5. **Resolved:** direct navigation ke setiap step dipertahankan sesuai behavior lama dan dipresentasikan sebagai workflow rail.
6. **Resolved:** tombol `Terapkan Default` dipertahankan agar action parity tetap eksplisit.
7. **Resolved:** light theme menjadi scope redesign fase pertama.

Jika audit historis tersedia kemudian, hasilnya masuk sebagai reconciliation pass dan bukan alasan untuk mengubah kontrak business logic secara diam-diam.

---

## 19. Proposed Component Migration Map

| Existing surface | Target presentation | Logic ownership |
|---|---|---|
| `TitleBar` | `WindowTitleBar` | Existing Tauri invokes tetap di adapter/composition |
| `Sidebar` | `WorkflowRail` | Existing `currentPage`/`onChangePage` |
| Per-page card header | `PageCommandBar` | Page composition only |
| `.primary-action` | `Button variant="primary"` | Caller handler unchanged |
| `.secondary-button` | `Button variant="secondary"` | Caller handler unchanged |
| `.modal-*` | `Dialog` | Caller open/confirm/cancel state unchanged |
| Inline toast implementations | `ToastCenter` | Existing result/error trigger unchanged |
| Prepare thumbnail aside | `PhotoQueue` | Existing active/selected IDs |
| Prepare canvas | `ImageViewer` + tool adapter | Existing image data and handlers |
| Review dropdown | `MemberQueue` + compact combobox | Existing active member selection |
| Review form | `ReviewInspector` | Existing `handleFieldChange` |
| Scan log + automation log | `LogConsole` | Existing event/log data |
| Entry summary cards | `ReadinessStrip` | Existing `exportPreview` |
| Entry table | `BatchTable` | Existing preview/member helpers |

Target architecture harus mengurangi duplikasi presentation tanpa memindahkan business decision ke design-system components.

---

## 20. Standards References

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [W3C: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [W3C: Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
- [W3C: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
- [W3C: Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)
- [W3C: Resize Text to 200%](https://www.w3.org/WAI/WCAG22/Techniques/general/G178.html)
- [Microsoft: Windows app design guidelines](https://learn.microsoft.com/en-us/windows/apps/design/guidelines-overview)
- [Microsoft: Windows app typography](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography)
- [Microsoft: Text scaling](https://learn.microsoft.com/en-us/windows/apps/develop/input/text-scaling)
- [Microsoft: Keyboard accelerators](https://learn.microsoft.com/en-us/windows/apps/develop/input/keyboard-accelerators)
- [Microsoft: Screen sizes and breakpoints](https://learn.microsoft.com/en-us/windows/apps/design/layout/screen-sizes-and-breakpoints-for-responsive-design)

---

## 21. Execution Status

Pengguna memberi izin eksplisit untuk melanjutkan implementasi setelah audit penggunaan folder `public`. Status saat ini adalah `approved for implementation` dengan hasil fase pertama berikut:

- App shell, custom title bar, workflow rail, page command bar, workspace, dan status bar sudah dimigrasikan.
- Semantic palette Graphite–Gold–Mineral Green–Pearl sudah diterapkan pada token global, form, chip status, loading screen, dan alias utility lama.
- Import, Prepare, Scan, Review, dan Export sudah dipindahkan ke layout workstation tanpa mengubah handler, store contract, invoke, atau listener.
- Empat asset `public` tetap utuh dan tetap terhubung ke momen welcome, scan selesai, review selesai, dan export selesai.
- Ikon aktif sudah dikonsolidasikan ke Lucide; import Material Symbols/Hanken yang tidak dipakai sudah dilepas dari runtime.
- Audit visual polish kedua merapikan Import menjadi grid 2:1, menghapus aksi pilih folder yang duplikat, menyegarkan Scan dengan progress hero, dan menjadikan form Review area utama dengan preview passport yang lebih kecil.
- Halaman Scan pengguna tidak lagi menampilkan log sistem atau istilah pipeline internal; event teknis dipetakan menjadi tiga tahap sederhana dan log event tidak lagi memicu render presentasi.
- Picker passport pada layout compact Review sudah memakai dropdown custom yang selaras dengan palette EntryMate, dilengkapi pencarian nama/nomor passport, status review, progress, active state, outside click, Escape, dan navigasi keyboard.
- Field `Anggota Pendamping` dan `Hubungan` pada Review sudah memakai form-select custom dengan menu portal, pencarian, active state, validasi, dan navigasi keyboard tanpa mengubah nilai yang disimpan.
- Typography sudah distandardisasi ke Inter Regular 400/Semibold 600 dan ramp 12/16, 14/20, 18/24, 20/28, 28/36, serta 40/52; arbitrary size/weight, label uppercase, dan teks informatif di bawah 12 px sudah dihapus. Shell ikut berkembang dengan `rem`, dan smoke test pembesaran teks 200% tidak menemukan clipping atau overflow horizontal pada halaman Import.
- Halaman Export sudah disusun ulang menjadi area proses utama, panel kesiapan batch, dan tabel passport yang ringkas. Mode extension dan JSON memakai satu switch yang jelas; log, port, WebSocket, serta label backend tidak lagi ditampilkan kepada pengguna, sementara listener dan command automasi tetap dipertahankan.
- Layout hasil polish kedua diperiksa pada viewport desktop 1600x1000; breakpoint Review memindahkan workspace ke satu kolom sebelum minimum track terpotong.
- Type-check, test unit, production build, dan visual smoke test pada window lebar serta compact sudah lulus.

Validasi lanjutan yang tetap disarankan sebelum release produksi: workflow end-to-end memakai batch passport representatif, Narrator/keyboard smoke test penuh, serta pemeriksaan semua state error dengan data nyata.
