---
name: EntryMate By Ghaniya
description: A calm, precise desktop workstation for passport and visa operations.
colors:
  graphite: "#1a1d1e"
  gold: "#d9a94f"
  light-gold: "#f7d883"
  dark-gold: "#a66c2d"
  accessible-gold: "#965b24"
  mineral-green: "#e7efe8"
  pearl: "#f9f9f9"
  surface-soft: "#f1f4f1"
  surface-muted: "#e2e8e3"
  surface-strong: "#d2d9d3"
  muted-ink: "#4d5354"
  line: "rgba(26, 29, 30, 0.12)"
  ghost-line: "rgba(26, 29, 30, 0.08)"
  border-strong: "#a8b1aa"
  primary-soft: "#f8edcf"
  success: "#25624f"
  success-subtle: "#e2f1e9"
  warning: "#965b24"
  warning-subtle: "#f8edcf"
  danger: "#b42318"
  danger-hover: "#912018"
  danger-subtle: "#fdecea"
  success-tint: "rgba(37, 98, 79, 0.12)"
  info-tint: "rgba(217, 169, 79, 0.18)"
  warning-tint: "rgba(166, 108, 45, 0.14)"
  danger-tint: "rgba(180, 35, 24, 0.12)"
  chrome-secondary: "rgba(249, 249, 249, 0.66)"
  chrome-subtitle: "rgba(249, 249, 249, 0.64)"
  chrome-muted: "rgba(249, 249, 249, 0.58)"
  chrome-line: "rgba(249, 249, 249, 0.12)"
  chrome-hover: "rgba(249, 249, 249, 0.06)"
  chrome-active: "rgba(249, 249, 249, 0.08)"
  chrome-pressed: "rgba(249, 249, 249, 0.12)"
  scrim: "rgba(26, 29, 30, 0.60)"
typography:
  display:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: "3.25rem"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: "2.25rem"
    letterSpacing: "-0.015em"
  subtitle:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.015em"
  body-large:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  body-strong:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: "1.25rem"
  body:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
  scan-progress:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "3.5rem"
    fontWeight: 600
    lineHeight: "4rem"
    letterSpacing: "-0.015em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  '1': "4px"
  '2': "8px"
  '3': "12px"
  '4': "16px"
  '5': "20px"
  '6': "24px"
  '8': "32px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.graphite}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.light-gold}"
  button-primary-active:
    backgroundColor: "{colors.gold}"
  button-secondary:
    backgroundColor: "{colors.pearl}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.graphite}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-compact:
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "32px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.pearl}"
    rounded: "{rounded.md}"
    height: "40px"
  input:
    backgroundColor: "{colors.pearl}"
    textColor: "{colors.graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.pearl}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.lg}"
    padding: "24px"
  workflow-navigation-expanded:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.pearl}"
    width: "176px"
  workflow-navigation-collapsed:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.pearl}"
    width: "60px"
  status-chip:
    rounded: "{rounded.md}"
    typography: "{typography.label}"
    padding: "5px 12px"
  folder-intake:
    backgroundColor: "{colors.mineral-green}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.lg}"
  status-capsule:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.pearl}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
    height: "46px"
---

# Design System: EntryMate By Ghaniya

## Overview

**Creative North Star: "The Operator's Desk"**

EntryMate is a composed operations workstation built from graphite, muted gold, mineral green, and pearl. Important work receives physical room, supporting tools remain close but quiet, and state is communicated without decoration competing with the task. The character is professional, calm, and exact rather than corporate-generic or promotional.

The system favors predictable workflow, continuous work surfaces, and information density that remains breathable through long desktop sessions. Gold behaves as a scarce operational signal; graphite provides the stable frame; mineral and pearl surfaces reduce glare and establish hierarchy.

The approved calm Scan image at `docs/design/scan-reference.png` anchors this shared system; its provenance is `docs/design/scan-reference.prompt.txt`. The subsequently approved sidebar at `docs/design/sidebar-reference.png` defines navigation composition; its provenance is `docs/design/sidebar-reference.prompt.txt`. This is a desktop/laptop Tauri application. Mobile design is outside the supported scope. Each of the five task pages adapts the common materials and components to its own work.

**Key Characteristics:**

- Dark graphite application chrome around flat pearl and mineral operational surfaces.
- Muted gold reserved for active workflow, selection, progress, and primary action.
- Continuous task surfaces with quieter supporting regions.
- Compact Inter typography, outline icons, and explicit accessible states.
- Stable icon-and-label navigation across desktop window sizes.

The frontmatter is the portable normative token record. Runtime values live in `passport-desktop/src/styles/tokens.css`; component behavior is defined by `passport-desktop/src/styles/components/Forms.css`, `Workstation.css`, `Scan.css`, and `StatusChips.css`. `passport-desktop/src/styles/global.css` provides the base layout. `passport-desktop/src/main.tsx` loads Workstation and Scan after global styles, so their overrides define the final presentation. `.impeccable/design.json` extends this record with depth, motion, desktop thresholds, and live component snippets; it does not introduce a second primitive token catalog.

## Colors

Graphite establishes the frame, pearl and mineral tones keep work calm, and gold marks operational attention. Semantic status colors communicate outcomes rather than a second decorative palette.

### Primary

- **Operator Gold** (`gold`): primary action, active navigation icon and label, selected date, and progress fill.
- **Light Gold** (`light-gold`): primary-button hover and readable emphasis on graphite.
- **Dark Gold** (`dark-gold`): stronger borders and the normal focus ring.
- **Accessible Gold** (`accessible-gold`): active or informative text on light surfaces. Do not use the primary fill color for small text on pearl.
- **Pale Gold** (`primary-soft`): selected rows, category tabs, and select options.

### Tertiary

- **Verified Green** (`success`, `success-subtle`): completed or ready states and confirmed folder intake.
- **Attention Gold** (`warning`, `warning-subtle`): warnings and caution fields.
- **Error Red** (`danger`, `danger-hover`, `danger-subtle`): invalid fields, failures, and destructive actions. A normal secondary stop action can use the red foreground without becoming a filled destructive button.
- The compact status labels use their recorded translucent `success-tint`, `info-tint`, `warning-tint`, and `danger-tint` backgrounds. Form and larger state regions use the subtle opaque semantic surfaces. These are different roles, not interchangeable fill values.

### Neutral

- **Graphite** (`graphite`): title bar, rail, and primary light-surface text. Runtime `ink` resolves here.
- **Pearl** (`pearl`): main work surfaces and controls. Runtime `surface` and `surface-card` resolve here.
- **Mineral Green** (`mineral-green`): application background and folder intake.
- **Soft, Muted, and Strong Surface** (`surface-soft`, `surface-muted`, `surface-strong`): supporting panes, tracks, and stronger neutral separation.
- **Muted Ink** (`muted-ink`): supporting text and secondary icons. Runtime `muted` resolves here.
- **Line / Ghost Line** (`line`, `ghost-line`): regular and faint one-pixel separation; `border-strong` supplies readable hover boundaries.
- **Chrome Secondary / Subtitle / Muted**: established pearl opacity levels for dark-frame text; use the documented roles rather than lowering opacity arbitrarily.
- **Chrome Line / Hover / Active / Pressed**: pearl-based neutral separation and interaction fills on graphite. Sidebar selection uses `chrome-active`; gold belongs to the icon and label.
- **Scrim** (`scrim`): a neutral dimming field above the full application.

**The Rare Gold Rule.** Gold identifies primary action, selection, or active progress; it does not decorate every container.

**The Material Hierarchy Rule.** Graphite frames the application, pearl holds primary work, and mineral or soft neutral tones distinguish supporting states and utilities.

## Typography

**Display and Body Font:** Inter, with Segoe UI Variable, Segoe UI, and system sans-serif fallbacks. Titles and operational metrics are semibold; body text is regular. Semibold body and large-body variants may use the shared weight (600) without adding a new size. Technical log output retains the runtime monospace stack; it is not a display face.

### Hierarchy

| Role | Runtime tokens | Use |
| --- | --- | --- |
| Label / caption | `--type-caption-size`, `--type-caption-line` | Captions, metadata, statuses, and supporting labels (12/16). |
| Body | `--type-body-size`, `--type-body-line` | Operational copy, form values, and controls (14/20). |
| Large body | `--type-body-large-size`, `--type-body-large-line` | Document filename or a modest subheading (18/24). |
| Subtitle | `--type-subtitle-size`, `--type-subtitle-line` | Section headings and timing metrics (20/28). |
| Title | `--type-title-size`, `--type-title-line` | One plain page title (28/36). |
| Display | `--type-display-size`, `--type-display-line` | Available rare display step (40/52); never substitute it for the standard page title. |
| Scan progress | `--type-progress-size`, `--type-progress-line` | Approved focal progress exception (56/64), not a new general heading size. |

Use the heading tracking token for titles, subtitles, and the Scan value. Progress, timing, and batch counts use tabular numerals where alignment matters. The scale assumes the normal desktop root font size; preserve rem values from frontmatter when implementing it.

**The Quiet Title Rule.** A page header contains one title, optional short context, and nearby actions; no step eyebrow or decorative icon tile competes with the title.

**The Readable Secondary Rule.** On graphite, inactive navigation and utility labels use chrome-secondary; version text uses chrome-muted. Do not lower those opacities for decorative quietness.

## Layout

The native window opens at 1440 by 920 and has a minimum of 1120 by 760, as configured in `passport-desktop/src-tauri/tauri.conf.json`. Desktop rendering is reviewed at 1440 by 900, 1366 by 768, 1280 by 760, and 1120 by 760. These are desktop fit checks, not mobile breakpoints.

The workflow rail is expanded (176px) or collapsed (60px). It automatically collapses below 1280px. Use the runtime rail variables, which preserve the rem-aware minimum widths. Page and panel padding use the shared space-6 step; page padding changes to space-5 below 1280px. Spacing uses the recorded 4px rhythm. One-pixel separation and deliberate grouping create hierarchy within continuous surfaces.

Different tasks retain different compositions:

- **Import:** broad main batch setup and quieter utility pane, with a `2.08fr / 0.92fr` split and a 320px minimum utility track. Folder intake, batch defaults, and continuation remain one task region. Below 800px window height, intake becomes a compact horizontal composition; the main region scrolls, its content cannot shrink past the panel boundary, and the continuation retains the standard control height.
- **Prepare:** a narrow document thumbnail rail, a large source viewer, compact tools, and an attached continuation region. Selection uses a quiet tonal/border treatment, not a thick side stripe.
- **Scan:** the same broad-main/quiet-utility proportion as Import, with progress, timing, and a flat queue in the main region. The active-document detail scrolls internally and reserves an 80px bottom region so transient status cannot cover its note.
- **Review:** source inspection and editable data share the workspace. Below 1500px, the member navigator becomes a compact selector above the two columns; larger windows can retain the member queue. Preserve source visibility and the inspector's independent scroll region.
- **Entry:** readiness, handoff actions, and tabular member information share a scrollable work region. It does not inherit Scan's progress-first composition.

Status floats at the bottom-right, 16px from the window edges; it does not allocate a permanent footer. Long filenames, paths, table content, and opened controls must remain usable at the minimum desktop size. Legacy CSS rules below the minimum native width are not mobile guidance for new work.

**The Task Owns the Space Rule.** The most frequent action receives the largest continuous surface, not merely the strongest color.

**The Quiet Utility Rail Rule.** Supporting options remain visible and nearby, but their narrower, softer surface must not compete with the primary task.

## Elevation & Depth

Work surfaces, cards, and normal controls are flat at rest and on hover. Tone and faint one-pixel boundaries provide separation. Do not inherit obsolete ambient pane shadows or hover translation from earlier base declarations. A focus ring is an accessibility state, not ambient elevation.

### Shadow Vocabulary

- **Popover** (`--shadow-popover`): anchored select and calendar menus only.
- **Overlay** (`--shadow-overlay`): dialogs and the floating status capsule. Use the runtime value; no separate card shadow is approved.
- **Focus** (`--focus-ring`, `--focus-ring-danger`, `--focus-ring-warning`): pearl separation with the appropriate normal, error, or warning outer color.

Popovers use the shared layer (1500); blocking overlays use the shared top layer (10000) and neutral scrim. UpdateDialog and the calendar render through a portal so parent clipping and local stacking do not defeat this hierarchy. Calendar anchoring flips above when space requires it, clamps to the viewport, and updates on scroll/resize. A menu inside a future modal must share its dialog layer or use an explicit higher layer; do not assume a normal page popover layer will clear a modal scrim.

Control feedback and popovers use the fast duration (140ms) and standard ease; progress changes use the slow duration (180ms). Workflow pages and their opening artwork enter with a short 12px horizontal movement and fade over the page duration (400ms), using a gentler decelerating page ease that keeps movement perceptible during the first half of the transition. Forward steps arrive from the right; backward steps arrive from the left; the initial page only fades. A single neutral sidebar highlight moves continuously to the active step with the same timing. Navigation renders the new page immediately without an exit delay. Other dialogs use the entrance duration (220ms) with a subtle scale; status retains its brief entrance (220ms) and static gold working dot. Progress fills and the scan line animate transforms rather than layout properties. Animations pause while the application is hidden; the scan line also pauses when its document scrolls out of view. Reduced-motion rules remove entrances, sidebar movement, and loops, show a static scan line, and shorten control transitions. Do not add movement to stationary cards or controls.

**The Flat Work Rule.** Use tone and one-pixel separation for task surfaces; reserve shadows for popovers, overlays, and transient status.

## Shapes

The shared shape scale is small for compact menu items and icon buttons, medium for fields/buttons/status capsules, and large for panels/dialogs (6/10/14px). Use thin boundaries; selected rows receive a pale-gold fill. Circles belong to workflow markers and status dots. A pill remains appropriate for switches and a compact numerical status metric; it is not the general button or card shape.

Icons come from Lucide through `passport-desktop/src/components/ui/AppIcon.tsx`: compact/status (16px), controls (18px), sections (20px), and standalone document/state illustration (32px), with stroke width 1.8. Use the same outline family. Icons supplement visible text, and icon-only controls need an accessible name. Do not reintroduce glyph icon fonts or add a second decorative workflow symbol.

## Components

### Shared implementation

Reuse `PageHeader.tsx`, `Button.tsx`, and `AppIcon.tsx` in `passport-desktop/src/components/ui/`. `Button` exposes primary/secondary/ghost plus compact and danger variants; native props preserve handlers and disabled behavior. Existing `CustomSelect.tsx` in that directory and `CustomDatePicker.tsx` in `passport-desktop/src/components/` retain their selection/value contracts. The shared visual system changes presentation without changing workflow, validation, persistence, OCR, or IPC behavior.

### Buttons

Gold primary, pearl outlined secondary, and transparent ghost actions share medium corners, body text, semibold weight, and an icon/text gap from space-2. Standard actions use the 40px minimum height and space-2/space-4 padding; compact toolbar actions use the 32px minimum height and space-1/space-3 padding. These component height tokens describe minimum height, so text can grow without clipping.

Primary hover uses light gold and pressed state returns to gold. Secondary/ghost hover uses the soft surface and stronger border; pressed state uses the muted surface. None lifts or gains a resting shadow. Keyboard focus uses the shared focus ring. Disabled buttons lower opacity to 0.45 and retain their layout. Filled destructive actions use danger/pearl and danger-hover; secondary/ghost danger actions use a red foreground and subtle red hover surface, with the danger focus ring.

### Inputs / Fields

Fields use the standard control minimum height, medium corners, pearl fill, body text, and space-3 horizontal padding. Hover strengthens the boundary; focus uses the dark-gold boundary and shared ring. Disabled fields use soft fill, muted text, opacity 0.6, and a blocked cursor. Read-only fields use soft fill. Placeholder text stays at muted ink with full opacity.

Invalid fields combine a red boundary, subtle red surface, error text, and danger focus ring; warning fields use the matching warning treatments. Keep the label and state message visible so color is not the only cue. Textareas may grow vertically and start at an 80px minimum height. Checkboxes, radios, range controls, and tiny calendar navigation items are semantic geometry exceptions, not new general field heights.

Selects keep their descriptive option copy in the opened menu and trigger title, while the closed field stays compact. Selected options use pale gold; search and supporting copy retain readable foregrounds. The calendar preserves editable date values and month/year navigation while its portal protects the grid from inspector clipping.

### Cards / Containers

Cards and bounded workstation panes use pearl, large corners, ghost-line separation, and no shadow. Card padding uses panel-padding. Supporting work regions use soft/mineral tone. Use a bounded card when content has a real independent boundary; related fields and rows share a continuous task surface. Avoid equal nested cards around every setting.

### Status Labels

Compact labels use caption semibold text and medium corners. Neutral, ready, info, warning, and danger treatments pair the semantic foreground with the relevant neutral/tinted background; include a word or icon that describes the state. A status label is passive information, so do not add button hover or pressed behavior to it. Category tabs are interactive controls: soft hover, pale-gold active state, and visible keyboard focus.

### Navigation

The graphite rail carries five destinations: Import, Prepare, Scan, Review, and Entry. Each expanded row contains one Lucide outline icon (18px, stroke 1.8) and one body label (14/20). Use folder, image, scan frame, clipboard check, and send icons respectively. Navigation starts at the shared page-padding offset, with 12px horizontal inset, 40px row minimum height, 8px row gaps, 12px icon-to-label gap, and 10px corners. Collapsed rows center the same icons and retain accessible names and native titles.

Inactive labels use regular weight and chrome-secondary; hover uses chrome-hover and pearl. The active row uses chrome-active with a gold icon and semibold gold label, identified by `aria-current="page"`. Active hover and pressed rows use chrome-pressed. Keyboard focus uses the shared focus ring. Do not infer completed stages from the selected destination.

Branding appears in the native title bar. The sidebar does not repeat the logo or product descriptor. Bottom utilities use flat ghost rows, 32px minimum height, 8px icon gaps, 12/16 regular labels, and one faint separator. Keep collapse/expand, check for updates, and the version accessible through the existing behaviors.

**The One Icon Rule.** Every destination has one outline icon and one label; no numbered circles, completion checks, subtitles, icon tiles, or connecting line.

**The Borderless Active Rule.** Active navigation uses a subtle neutral fill with gold icon and label, without an outline, side stripe, or additional badge.

### Scan Progress and Document Queue

The approved Scan number is the sole progress-type exception. Its flat track uses the shared 8px progress height and muted neutral remainder; the gold fill does not glow. Timing metrics align in three columns. Queue rows use thin separation, outline document/status icons, pale-gold current selection, and readable completion/active/pending labels.

In the active-document timeline, success checks require a completed stage. An error uses a red marker and leaves unproven stages neutral; do not infer success from a stopped operation. The small document illustration is flat CSS geometry with one fine scan line, not a new image system.

### Status Capsule and Dialogs

Status is absent while idle, remains visible during active work, and dismisses a non-working update after 4200ms. It uses graphite, pearl headline, readable secondary copy, medium corners, and overlay depth. Working status shows a gold dot; a settled update uses green. Optional Scan counts use tabular numerals. Changes announce through `role="status"` and `aria-live="polite"`.

The capsule's 46px minimum height and 9px/12px padding are a feedback-container exception, not a form-control size. Dialogs use large corners, panel-padding, the shared overlay layer, and the neutral scrim; footer actions use ordinary Button variants.

**The Status Is Event, Not Chrome Rule.** Render the capsule only for active work or a new status; never occupy permanent footer space with an idle message.

## Do's and Don'ts

### Do:

- **Do** reuse the runtime tokens and shared PageHeader, Button, AppIcon, select, and date controls across all five pages.
- **Do** give each task its own coherent layout within the shared graphite, gold, mineral, and pearl system.
- **Do** use standard 40px actions/fields and the 32px compact toolbar variant; allow necessary text growth.
- **Do** preserve one quiet title, readable labels, keyboard order, focus, and semantic status messages.
- **Do** verify complete actions, source inspection, internal scrolling, and opened overlays at the minimum desktop window.
- **Do** use one outline icon and one label per navigation destination, with a subtle neutral active fill.
- **Do** use true completion, warning, and error treatments rather than decorative state color.
- **Do** preserve transient live status and keep it clear of task content.

### Don't:

- **Don't** add mobile layout rules to this desktop/laptop design contract.
- **Don't** use gold as ambient decoration or as low-contrast small text on pearl.
- **Don't** add ambient card shadows, hover lift, gradients, glows, or glass to flat task surfaces.
- **Don't** add page eyebrows, decorative title icon tiles, a thick selection stripe, or a second workflow symbol.
- **Don't** create new icon families, intermediate radii, or type sizes to solve a local spacing issue.
- **Don't** promote semantic geometry exceptions into general control tokens.
- **Don't** let menus inherit clipping or render a dialog below active controls.
- **Don't** reserve a permanent footer for idle status or show success for an unproven failed stage.
- **Don't** invent data, capabilities, or workflow steps for visual fullness.
