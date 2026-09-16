---
name: EntryMate By Ghaniya
description: A calm, precise graphite-and-gold workstation for high-volume passport and visa operations.
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
  muted-ink: "#4d5354"
  success: "#25624f"
  danger: "#b42318"
typography:
  display:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.285
    letterSpacing: "-0.015em"
  subtitle:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  input:
    backgroundColor: "{colors.pearl}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.md}"
    height: "40px"
  workflow-navigation-expanded:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.pearl}"
    width: "176px"
  workflow-navigation-collapsed:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.pearl}"
    width: "60px"
  folder-intake:
    backgroundColor: "{colors.mineral-green}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.lg}"
  status-capsule:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.pearl}"
    rounded: "12px"
    padding: "9px 12px"
    height: "46px"
---

# Design System: EntryMate By Ghaniya

## Overview

**Creative North Star: "The Operator's Desk"**

EntryMate is a composed operations workstation built from graphite, muted gold, mineral green, and pearl. Important work receives physical room, supporting tools remain close but quiet, and state is communicated without decoration competing with the task. The character is professional, calm, and exact rather than corporate-generic or promotional.

The system favors predictable workflow, continuous work surfaces, and information density that remains breathable through long desktop sessions. Gold behaves as a scarce operational signal; graphite provides the stable frame; mineral and pearl surfaces reduce glare and establish hierarchy.

**Key Characteristics:**

- Dark graphite application chrome around pearl and mineral operational surfaces.
- Muted gold reserved for active workflow, selection, and primary action.
- Dominant task surfaces paired with visibly quieter utility regions.
- Compact Inter typography, restrained depth, and explicit accessible states.
- A stable workflow spine that remains legible without becoming decorative.

## Colors

Graphite establishes authority, pearl and mineral green keep long sessions comfortable, and gold marks the action or workflow state that deserves attention. Light gold carries readable emphasis on graphite; accessible gold is used where gold-toned text must hold contrast on light surfaces.

**The Rare Gold Rule.** Gold identifies primary action, selection, or active progress; it does not decorate every container.

**The Material Hierarchy Rule.** Graphite frames the application, pearl holds primary work, and mineral or soft neutral tones distinguish supporting states and utilities.

## Typography

Inter is the system font, with Segoe UI and system sans-serif fallbacks. Titles are semibold with slightly tightened tracking; body copy is neutral and compact; labels and supporting text use the 12px/16px caption step without becoming faint.

The shipped scale is 12/16 for labels, 14/20 for body, 20/28 for subtitles, 28/36 for titles, and 40/52 for display. Use semibold (600) for hierarchy and regular (400) for supporting copy.

**The Readable Secondary Rule.** On graphite, subtitles use pearl at 64% opacity and brand/version text uses pearl at 58% opacity; do not lower these values for decorative quietness.

## Layout

Desktop workflows use a stable navigation spine and asymmetric work areas based on task priority. The global workflow rail is 176px when expanded and 60px when collapsed. It collapses automatically at viewport widths of 1279px and below, preserving content width while keeping every stage directly reachable.

The Import workspace makes its batch setup the dominant continuous surface and places PDF controls plus folder history in a quieter utility rail. Its wide layout uses approximately a two-thirds/one-third split (`2.08fr / 0.92fr`); the utility rail stacks after the task surface at 959px and below. The folder intake, five shared defaults, and continuation action remain one logical task region, with the continuation action anchored to its lower edge when height allows.

Spacing follows a 4px-derived rhythm. Prefer alignment, dividers, and continuous regions over nested cards. At compact widths, preserve source order: task setup first, utilities and history second.

Application status does not reserve layout space. When present, it floats 16px from the bottom-right as a transient capsule and stays within the viewport up to a 480px maximum width.

**The Task Owns the Space Rule.** The most frequent action receives the largest continuous surface, not merely the strongest color.

**The Quiet Utility Rail Rule.** Supporting options remain visible and nearby, but their narrower, softer surface must not compete with the primary task.

## Elevation & Depth

Depth is restrained. Wide soft shadows distinguish workstation surfaces from the mineral background, while one-pixel dividers handle internal separation. Most navigation and utility states are expressed through tonal fills rather than elevation. Hover lift is subtle and reserved for tactile actions such as the folder intake icon and primary buttons. The transient status capsule uses a soft offset shadow (`0 10px 28px rgba(26, 29, 30, 0.22)`) so it reads above work without resembling a modal.

### Shadow Vocabulary

- **Ambient soft:** A diffuse two-part shadow separates pearl panes from the mineral canvas without making them float heavily.
- **Overlay:** A deeper, broad shadow is reserved for dialogs and true overlays.
- **Focus:** A pearl inner separation followed by a dark-gold outer ring keeps keyboard focus visible on both light and dark surfaces.

**The Tonal-First Rule.** Use surface tone and one-pixel separation before adding shadow; elevation must communicate interaction or stacking.

## Shapes

Containers use gently rounded corners up to 14px. Inputs and controls use 6–10px corners. The transient status capsule uses a compact 12px radius. Circular forms are reserved for workflow markers, checks, and compact statuses; pills are limited to status labels and switches, not general containers or primary buttons.

## Components

### Buttons

Primary buttons use muted gold with graphite text and a 10px radius. Hover shifts to light gold with a slight one-pixel lift; disabled controls lower opacity without changing layout. Secondary actions use pearl, a quiet line, and a pale gold hover fill. Every button exposes the shared high-contrast focus-visible ring.

### Cards / Containers

Workstation panes use pearl backgrounds, restrained one-pixel borders, and soft ambient elevation where separation from the mineral canvas is necessary. Related controls share a continuous surface instead of becoming nested cards.

### Inputs / Fields

Fields use a 40px control height, 10px corners, clear labels, graphite text, and explicit focus treatment. Supporting icons remain secondary to the input value. In repeated batch-default rows, inputs align in a consistent final column for rapid scanning.

### Navigation

The global workflow navigation is a calm graphite spine: 176px expanded and 60px collapsed. Expanded steps show one 26px numbered or completed-check marker plus a label and subtitle. Collapsed steps show that same marker only; each button must retain an accessible name and informative title.

All five markers sit on a single 1px connector. The marker is the only step symbol—do not add a second decorative icon. Inactive steps use contrast-compliant pearl text; completed steps replace the number with a check. The active step has no outer border: a restrained gold-tinted tonal fill identifies the row, while its marker becomes solid gold with graphite content.

The brand block stays clean at the top with only the product mark, name, and short descriptor. Collapse and update controls live together at the bottom, followed by version text. At 1279px and below the rail automatically presents the collapsed marker-only form.

**The One Marker Rule.** Every workflow stage gets exactly one numbered or checked marker on the connector; never pair it with a decorative step icon.

**The Borderless Active Rule.** Active navigation uses a gold-tinted tonal fill and gold marker, not an outline, inset rail, or additional badge.

### Import Task Surface

The folder intake is the signature action: a large mineral panel transforms in place from an invitation into a confirmed success state without navigating away. Shared defaults stay immediately below it, and the primary continuation action remains attached to this setup. PDF multi-passport controls and recent folders belong to the quieter utility rail, where rows are compact and history remains subordinate to starting a new batch.

### Status Capsule

Application status is transient feedback, never a permanent full-width footer. It is absent while idle, appears at the bottom-right for active work or a newly published status, remains visible for the entire working state, and dismisses non-working updates after 4200ms.

The capsule uses a graphite surface, pearl headline, readable pearl secondary copy, a 12px radius, and a soft offset shadow. A green dot marks a settled update; a pulsing gold dot marks ongoing work. During Scan, an optional compact metric may show current/total progress with tabular numerals. Entrance motion runs for 220ms with exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`). Announce changes with a polite live region (`role="status"`, `aria-live="polite"`).

**The Status Is Event, Not Chrome Rule.** Render the capsule only for active work or a new status; never occupy permanent footer space with an idle message.

## Do's and Don'ts

### Do:

- **Do** make the highest-frequency task immediately visible and directly actionable.
- **Do** give Import a dominant continuous task surface and a quieter utility rail.
- **Do** keep the workflow rail at 176px expanded, 60px collapsed, and automatically collapsed at 1279px and below.
- **Do** use one numbered or checked marker per workflow step on a 1px connector.
- **Do** show labels and subtitles when expanded, then preserve an accessible name and title when only the marker remains.
- **Do** keep brand presentation clean and place utility controls plus version information at the bottom of the rail.
- **Do** preserve keyboard order, visible focus, and the established pearl opacity for readable secondary text.
- **Do** keep active work visible in the bottom-right status capsule, then auto-dismiss non-working updates after 4200ms.
- **Do** expose transient application status through a polite live region and use tabular numerals for an optional Scan metric.

### Don't:

- **Don't** turn every setting into an equal card or let utilities compete with the primary task.
- **Don't** use gold as ambient decoration.
- **Don't** add a decorative icon beside a workflow step's numbered or checked marker.
- **Don't** outline the active workflow row; use its borderless gold-tinted tonal fill and gold marker.
- **Don't** hide labels without preserving the collapsed step's accessible name and informative title.
- **Don't** reserve a permanent full-width footer or render the status capsule while the application is idle.
- **Don't** introduce promotional hero patterns into operational screens.
- **Don't** invent data, capabilities, or workflow steps for visual fullness.
