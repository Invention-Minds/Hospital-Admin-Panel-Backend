# Design Tokens — Docminds Admin Panel

Extraction date: 2026-04-19 (Sprint 2.5 Part A).

## Status: PROVISIONAL

The source Figma file (`S2gYoiH41ihtLjxcAUoYHq` / "Invention Minds LLP") has **no Figma Variables defined** and **no design-system library is subscribed** (verified via `get_variable_defs` returning `{}` on 9 key frames, and `get_libraries.libraries_added_to_file = []`). Values in this document were observed in the rendered output of `get_design_context` across the frames listed in §1.

**When the designer ships Figma Variables, this document should be regenerated via `get_variable_defs` and token names reconciled with the variable names Figma ships.** Until then, names are role-based role assignments (e.g. `--color-brand-primary`, `--color-text-heading`) rather than Figma names.

Files emitted:

- [src/styles/_tokens.scss](../../../Frontend/Hospital-Admin-Panel/src/styles/_tokens.scss) — SCSS partial (source of truth). Exports SCSS vars for static SCSS consumption AND emits `:root` CSS custom properties.
- [src/styles/_tokens.css](../../../Frontend/Hospital-Admin-Panel/src/styles/_tokens.css) — CSS-only mirror (same `:root` block). Registered in `angular.json` `architect.build.options.styles[]` so custom properties are globally available.
- [angular.json](../../../Frontend/Hospital-Admin-Panel/angular.json) — Added `src/styles/_tokens.css` to both `build` and `test` `styles` arrays.

No existing component file was modified. Sprint 3+ modules adopt tokens as they are rebuilt.

---

## 1. Source frames

Ten frames contributed observations (9 rendered, 1 image-only):

| Node ID | Name | Why chosen |
|---|---|---|
| `9142:371` | Dashboard | Primary dashboard — sidebar, header, stat cards, tables, status badges, avatar chip, search bar. Richest token source. |
| `9475:449` | DocMinds LogIn (form variant) | Only form surface with primary CTA and form fields. Source of brand orange (#fb9c2a), form-field border, glass card. |
| `9475:471` | DocMinds LogIn (image variant) | Same frame rendered as flat PNG — no extractable code. Listed for audit trail only. |
| `9149:1813` | Profile Drop Down | Modal/dropdown surface. Confirms danger red `#d20006` (Log Out). |
| `10329:621` | Notification | Toast / notification panel. Confirms `#d20006` delete-icon button. Shows dim-layer pattern (opacity-60 on dimmed background card). |
| `9149:1991` | Doctors Available | Tabular list surface. Confirms `#169458` secondary green variant. Introduces `#f4f4f4` alternate surface. |
| `9149:2208` | Doctors Unavailable | List with **warning modal** overlay. Source of `#e9c400` warning-strong and `rgba(0,0,0,0.3)` overlay. |
| `9149:2349` | Doctors Absent | List with **danger modal** overlay. Reconfirms `#d20006` as danger-strong used on modal headers. |
| `9142:866` | Setting — Profile | Sub-navigation within modal (`#0e2970`), inline log-out CTA with danger color, large-icon CTA pattern. |
| `14467:1031` | Setting — Locked IDs | Secondary button ("Unlock") with `#169458` border+text, checkbox rows (`#000000` border), translucent row alternation. |

### Surface-type coverage

| Required surface | Covered by |
|---|---|
| Dashboard | 9142:371 ✅ |
| Form | 9475:449 ✅ |
| Settings / detail | 9142:866, 14467:1031 ✅ |
| List / table | 9149:1991, 9149:2208, 9149:2349 ✅ |
| Modal / dropdown | 9149:1813, 9149:2208 (modal), 9149:2349 (modal), 14467:1031 (modal) ✅ |
| Notification / toast | 10329:621 ✅ |
| Primary CTA in context | 9475:449 (Sign in orange) ✅ |
| Data card | 9142:371 stat cards ✅ |
| Navigation | Sidebar reused across all admin frames ✅ |
| **Empty state** | ❌ Not present in seeded frames — see §4 Gaps |
| **Error state** | Partial — danger modal (9149:2349) but no inline form-field error ❌ |
| **Form field with error** | ❌ Not present in seeded frames — see §4 Gaps |

---

## 2. Token list (A. name | B. category | C. value | D. source frame — element)

### 2.1 Color — Brand

| Token | Category | Value | Source |
|---|---|---|---|
| `--color-brand-primary` | color / brand | `#fb9c2a` | 9475:449 — "Sign in" button background (node 9475:469) |
| `--color-brand-navy-900` | color / brand | `#001345` | 9142:371 — sidebar background (node 9142:373); 10329:621 — notification panel title text |
| `--color-brand-navy-700` | color / brand | `#0e2970` | 9142:866 — settings modal sub-nav (node 9142:1024); 14467:1031 — Locked-IDs header bar |
| `--color-brand-purple-900` | color / brand | `#271e4a` | 9142:371 — "Dashboard" heading text (node 9142:398), stat label text |

### 2.2 Color — Surface

| Token | Category | Value | Source |
|---|---|---|---|
| `--color-surface-page` | color / surface | `#f0f3ff` | 9142:371 — page root (node 9142:371); same across all admin frames |
| `--color-surface-card` | color / surface | `#ffffff` | 9142:371 — stat card, Doctors List card, Appointment Request card |
| `--color-surface-table-head` | color / surface | `#edf4fc` | 9142:371 — Doctors List header strip (node 9142:416); Appointment Request header strip |
| `--color-surface-alt` | color / surface | `#f4f4f4` | 9149:1991 — observed as alternate surface fill |
| `--color-surface-overlay` | color / surface | `rgba(0, 0, 0, 0.3)` | 9149:2208 / 9149:2349 — modal scrim (node 9149:2496 / 9149:2498) |
| `--color-surface-glass-fill` | color / surface | `rgba(88, 130, 193, 0.28)` | 9475:449 — Login glass card fill (node 9475:452) |
| `--color-surface-glass-border` | color / surface | `rgba(88, 130, 193, 0.49)` | 9475:449 — Login glass card border (node 9475:452) |
| `--color-surface-row-alt` | color / surface | `rgba(255, 255, 255, 0.1)` | 9149:2208 — translucent list rows in modal (node 9149:2190 and siblings); 14467:1031 — alternating Locked-IDs rows |

### 2.3 Color — Text

| Token | Category | Value | Source |
|---|---|---|---|
| `--color-text-heading` | color / text | `#271e4a` | 9142:371 — "Dashboard" H1, "Doctors List" card title |
| `--color-text-body` | color / text | `#000000` | 9142:371 — table row text (patient name, dates) |
| `--color-text-muted` | color / text | `#7b7b7b` | 9142:371 — stat card top-number line (node 9142:402) |
| `--color-text-accent` | color / text | `#3f779b` | 9142:371 — "See all" links, doctor-name links |
| `--color-text-on-dark` | color / text | `#ffffff` | 9475:449 — Login labels over dark bg; 9142:866 — sub-nav item text |
| `--color-text-placeholder` | color / text | `#bcbec0` | 9475:449 — Login input placeholder ("Enter User ID") |

### 2.4 Color — Feedback

| Token | Category | Value | Source |
|---|---|---|---|
| `--color-success-bg` | color / feedback | `#79cfa6` | 9142:371 — "Available" badge fill (node 9142:421 and others) |
| `--color-success-strong` | color / feedback | `#169458` | 14467:1031 — "Unlock" button border + text (node 14469:1603 / 14469:1606) |
| `--color-warning-bg` | color / feedback | `#fce35f` | 9142:371 — slot time pill (node 9142:513 etc.) |
| `--color-warning-strong` | color / feedback | `#e9c400` | 9149:2208 — "Doctors Unavailable" modal header (node 9149:2188); status text (node 9149:2193) |
| `--color-danger-bg` | color / feedback | `#ff706f` | 9142:371 — "Absend" badge fill (node 9142:441) |
| `--color-danger-strong` | color / feedback | `#d20006` | 9149:1813 — "Log Out" text (node 9149:1980); 10329:621 — delete-icon button bg (node 10329:705); 9149:2349 — "Doctors Absent" modal header (node 9149:2198) |

**Added in Sprint 3g — flagged for designer review.** These four tokens extend the feedback set to cover clinical-severity states (low-critical lab values) and subtle connection-status strips. No new color family introduced — info tones reuse the navy family; subtle backgrounds are light tints of the existing success/danger hues.

| Token | Category | Value | Sprint 3g source | Notes |
|---|---|---|---|---|
| `--color-info-strong` | color / feedback | `#0e2970` (alias of `--color-brand-navy-700`) | Critical-Values widget — "low" severity indicator | Kept in navy family per user direction; replaces Bootstrap teal `#17a2b8` seen in legacy CSS |
| `--color-info-bg` | color / feedback | `#e8f0fe` | Critical-Values widget — info-tone surface | Light navy tint |
| `--color-success-bg-subtle` | color / feedback | `#ecfaf2` | Critical-Values widget — "Connected to alert stream" strip | `--color-success-bg` (`#79cfa6`) is badge-saturation, too strong for a strip |
| `--color-danger-bg-subtle` | color / feedback | `#ffeeee` | Critical-Values widget — "Disconnected" strip | `--color-danger-bg` (`#ff706f`) is badge-saturation, too strong for a strip |

### 2.5 Color — Border

| Token | Category | Value | Source |
|---|---|---|---|
| `--color-border-input` | color / border | `#bcbec0` | 9475:449 — Login input border (node 9475:459) |
| `--color-border-checkbox` | color / border | `#000000` | 14467:1031 — Locked-IDs checkbox border (node 14469:1609) |

### 2.6 Typography

| Token | Category | Value | Source |
|---|---|---|---|
| `--font-family-primary` | typography / family | `'Kanit', sans-serif` | All rendered frames — every text node uses Kanit variants |
| `--font-weight-light` | typography / weight | `300` | 9142:371 — badge text ("Available"), table column headers — `font-['Kanit:Light']` |
| `--font-weight-regular` | typography / weight | `400` | 9142:371 — body text — `font-['Kanit:Regular']` |
| `--font-weight-medium` | typography / weight | `500` | 9142:371 — titles, doctor names — `font-['Kanit:Medium']` |
| `--font-weight-semibold` | typography / weight | `600` | 9475:449 — "Sign in" button label, Login "Login" title — `font-['Kanit:SemiBold']` |
| `--font-size-xs` | typography / size | `12px` | 9142:371 — badges, table body rows |
| `--font-size-sm` | typography / size | `13px` | 9475:449 — Login form labels and input text |
| `--font-size-base` | typography / size | `14px` | 9142:371 — "Admin" subtitle under user name (node 9142:493) |
| `--font-size-md` | typography / size | `16px` | 9142:371 — stat card primary number/label (node 9142:402) |
| `--font-size-lg` | typography / size | `18px` | 9142:371 — search bar text "Rashtrotthana Hospital - Bangalore" |
| `--font-size-xl` | typography / size | `20px` | 9142:371 — card titles "Doctors List", "Appointment Request" |
| `--font-size-2xl` | typography / size | `24px` | 9142:371 — page H1 "Dashboard" (node 9142:398); 9475:449 — "Login" title |

### 2.7 Radius

| Token | Category | Value | Source |
|---|---|---|---|
| `--radius-xs` | radius | `4px` | 14467:1031 — Locked-IDs checkbox (node 14469:1601) |
| `--radius-sm` | radius | `5px` | 9475:449 — Login input (node 9475:459) — ⚠️ see §3 |
| `--radius-md` | radius | `8px` | 9142:371 — search bar (node 9142:496), row thumb (node 9142:423), badge corners |
| `--radius-lg` | radius | `10px` | 9142:371 — sidebar active tile (node 9142:376), header avatar/icon tiles |
| `--radius-xl` | radius | `12px` | 9142:866 — settings modal shell (node 9142:1023) |
| `--radius-2xl` | radius | `14px` | 9142:371 — stat card (node 9142:400) |
| `--radius-3xl` | radius | `16px` | 14467:1031 — Locked-IDs row card; 9149:2208 — modal row |
| `--radius-4xl` | radius | `18px` | 9142:371 — large content card "Doctors List" (node 9142:413), "Appointment Request" (node 9142:447) |
| `--radius-5xl` | radius | `20px` | 10329:621 — notification panel (node 10329:743) |
| `--radius-login-glass` | radius | `28.458px` | 9475:449 — Login glass card (node 9475:452) — ⚠️ see §3 |
| `--radius-login-button` | radius | `7.115px` | 9475:449 — Login "Sign in" button (node 9475:469) — ⚠️ see §3 |

### 2.8 Shadow

| Token | Category | Value | Source |
|---|---|---|---|
| `--shadow-elevation-1` | shadow | `0 4px 15px 0 rgba(216, 210, 252, 0.64)` | 9142:371 — every white card/stat card elevation |
| `--shadow-elevation-2` | shadow | `0 4px 15px 0 rgba(185, 178, 226, 0.64)` | 9142:371 — row avatars (node 9142:423), small icon tiles |
| `--shadow-glow-success` | shadow | `0 4px 15px 0 #79cfa6` | 9142:371 — "Available" pill glow (node 9142:421 etc.) |
| `--shadow-glow-danger` | shadow | `0 4px 15px 0 #ff706f` | 9142:371 — "Absend" pill glow (node 9142:441) |

### 2.9 Spacing (literal values observed in padding / gap)

| Token | Category | Value | Source |
|---|---|---|---|
| `--space-8` | spacing | `8px` | 9475:449 — Login form label-to-input gap (node 9475:457 `gap-[8px]`) |
| `--space-10` | spacing | `10px` | 9142:866 — Log-out row icon-to-text gap (node 9142:1032 `gap-[10px]`) |
| `--space-12` | spacing | `12px` | Component1 (shared) — compact card padding (node 7780:837 `p-[12px]`) |
| `--space-13` | spacing | `13px` | 9142:371 — search bar vertical padding (node 9142:496 `py-[13px]`) |
| `--space-16` | spacing | `16px` | 9475:449 — input internal padding (node 9475:459 `p-[16px]`); button vertical (node 9475:469 `py-[16px]`) |
| `--space-20` | spacing | `20px` | 9142:371 — search bar horizontal padding (node 9142:496 `px-[20px]`) |
| `--space-30` | spacing | `30px` | 9475:449 — Login form block gap (node 9475:454 `gap-[30px]`) |
| `--space-35` | spacing | `35px` | 9142:371 — sidebar nav item gap (node 9142:374 `gap-[35px]`) |
| `--space-40` | spacing | `40px` | 9475:449 — Login card gap + py (node 9475:452 `gap-[40px]` / `py-[40px]`) |

### 2.10 Sizes (component dimensions — geometry, not design tokens per se, but tokenised for reuse)

| Token | Category | Value | Source |
|---|---|---|---|
| `--size-sidebar-width` | size | `80px` | 9142:371 — sidebar (node 9142:373) |
| `--size-sidebar-item` | size | `44px` | 9142:371 — active nav tile (node 9142:376) |
| `--size-icon-sm` | size | `14px` | 10329:621 — delete icon (node 10329:706) |
| `--size-icon-md` | size | `18px` | 14467:1031 — unlock-button icon (node 14469:1656) |
| `--size-icon-lg` | size | `24px` | 9142:371 — sidebar nav icons, page icons |
| `--size-stat-icon` | size | `36px` | 9142:371 — stat card icons (node 9142:401 etc.) |
| `--size-avatar-row` | size | `28px` | 9142:371 — Doctors List row avatars (node 9142:423) |
| `--size-avatar-header` | size | `42px` | 9142:371 — header profile avatar + notification bell tile |
| `--size-avatar-logo` | size | `60px` | 9142:371 — sidebar logo (node 9142:396) |
| `--size-avatar-login` | size | `100px` | 9475:449 — Login logo (node 9475:453) |

---

## 3. Near-duplicates flagged for designer review

| Flag | Values | Finding | Recommendation |
|---|---|---|---|
| Radii with decimals | `5px`, `7.115px`, `28.458px` | `7.115 = 10 × 0.7115` and `28.458 = 40 × 0.7115` — strongly suggest the Login frame is scaled to 71.15% in Figma, so the underlying intended radii are **8px (sign-in button), 40px (glass card)**, and **7.115px/28.458px are scale artifacts**. `5px` on the Login input may similarly be a scaled `7px`. | Confirm with designer: are these intentional decimals, or scale artifacts from a transformed frame? If artifacts, consolidate to `--radius-md (8px)` and introduce `--radius-4xl-plus (40px)` or reuse `--radius-5xl (20px)` × 2 — whichever matches. Left literal for now. |
| Two greens | `#79cfa6` (success-bg) vs `#169458` (success-strong) | Both are "green" but used for different roles — light soft fill on pills vs. darker outline/text on secondary buttons. Not a duplicate, but flagged for intentional naming. | Keep both. Consider adding `--color-success-fg` if the pill gets outlined variant. |
| Two yellows | `#fce35f` (warning-bg) vs `#e9c400` (warning-strong) | Same — soft fill on time-slot pill vs. stronger yellow on "Unavailable" modal header. | Keep both. |
| Two reds | `#ff706f` (danger-bg) vs `#d20006` (danger-strong) | Same — soft absent-badge fill vs. strong log-out/delete/modal-header red. | Keep both. |
| Two navies | `#001345` (navy-900) vs `#0e2970` (navy-700) | Darker sidebar vs. mid sub-nav. Not duplicates. | Keep both. |
| Opacity dimming | `opacity-60` on dashboard card (9142:866 node 9142:934 `opacity-60`) | One-off raw Tailwind opacity, no equivalent hex. | Add `--opacity-dimmed: 0.6` if designer confirms this is a state token; otherwise inline. |

---

## 4. Gaps flagged for designer (frames we need to round out the token set)

### 4.0 Decisions (Sprint 3 / 2026-04-19)

Five gaps answered by narrow extrapolation from the existing token set, per Design Gaps Policy. **Approved for Sprint 3 by inline decision; flagged for designer confirmation in Sprint 4.**

| # | Gap | Decision | Rationale |
|---|---|---|---|
| 1 | Input focus state | 2px solid `var(--color-brand-navy-900)` (#001345); no outer glow | Brand navy is the primary-brand color in this file; no Figma frame shows an outer glow, so none is added |
| 2 | Input error state | 1px solid `var(--color-danger-strong)` (#d20006) | Error must be immediately visible; the soft `--color-danger-bg` is for filled status badges, not for indicating invalid input |
| 5 | Inline error caption | Placed directly below input; `var(--color-danger-strong)`; `var(--font-size-xs)` (12px); margin-top 4px | Matches standard Material / PrimeNG conventions and stays within the token set |
| 9 | Table empty state | Centered layout: icon + primary text + optional secondary text; icon = PrimeIcon `pi pi-inbox`; text = `var(--color-text-muted)`; min 48px vertical padding | `pi-inbox` is neutral and widely understood; muted text matches the card-interior neutrality elsewhere |
| 17 | Button disabled state | bg = `var(--color-surface-alt)` (#f4f4f4); text = `var(--color-text-muted)` (#7b7b7b); border none; `cursor: not-allowed`; no opacity hacks | Uses existing tokens — `--color-surface-alt` was observed on one alternate-surface use; tests whether that extends to disabled controls (flag for designer) |

These decisions are in effect from Sprint 3a-2 onward. Reference them when consuming the corresponding token set in any component SCSS/CSS.

Observations below suggest additional incomplete states that need designer attention. Each item is either **(a)** a state we'd expect but did not see, or **(b)** a token that's been observed once and may have siblings.

| Gap | Detail | Ask designer |
|---|---|---|
| **Empty state** | No frame in the provided seed list shows "no data" copy, illustration, or muted CTA treatment. | Provide an empty-state frame (e.g., "No Doctors" list, "No Appointments Today"). We'll extract empty-state icon/text tokens from it. |
| **Form field — error state** | No red-border / error-caption field was observed. Only Login's normal-state `#bcbec0` border. | Provide a field with validation error shown: red border, error caption color, icon. |
| **Form field — focus state** | Only default-state fields were captured. | Provide a focused-state field (hover / keyboard focus). |
| **Button — secondary / destructive / disabled** | Only primary (orange `#fb9c2a`) and secondary outlined (green `#169458`) observed. No destructive button, no disabled state. | Provide a destructive-button example (e.g., "Delete Account" in Settings) and disabled states. |
| **Button — hover / active** | No interactive states captured. | Provide hover/active states for primary + secondary buttons. |
| **Success state feedback** | Only fill+glow on "Available" pill. No success toast / success banner. | Provide a success banner or confirmation toast example. |
| **Typography — line-height / letter-spacing** | Every text node uses `leading-[normal]`. No line-height tokens extractable. | Confirm text-style tokens (line-heights for body/heading) — or leave as browser default. |
| **Typography — link decoration** | `#3f779b` accent text used in "See all" without underline/hover indicator. | Confirm hover treatment for links. |
| **Full opacity scale** | Only `opacity-60` (dimmed card) and `opacity-90` (muted column headers) observed. | Confirm discrete opacity states or inline. |
| **Spacing scale** | Only 9 literal spacing values observed (8, 10, 12, 13, 16, 20, 30, 35, 40). Gaps at 4, 6, 24, 32 — standard scale points. | Did we miss frames, or does the product genuinely use an irregular scale? |
| **Color — info (blue)** | No pure-info blue observed. `#3f779b` is used as *text accent*, not as a status color. | If there's an "info" status (pending, processing), provide the frame. |
| **Border — neutral** | Only input `#bcbec0` and checkbox `#000000` observed. Dividers render from raster lines, not strokes. | Confirm divider/row-border color. |
| **Logout modal / confirmation dialog** | Log-out is a plain text CTA, no confirmation dialog was pulled. | Provide a destructive-confirmation modal pattern. |

---

## 5. How to use these tokens

From any component `.scss`:

```scss
@use 'styles/tokens' as tokens;

.my-card {
  background: tokens.$color-surface-card;
  border-radius: tokens.$radius-4xl;
  box-shadow: tokens.$shadow-elevation-1;
  padding: tokens.$space-20;
  color: tokens.$color-text-heading;
  font: tokens.$font-weight-medium tokens.$font-size-xl tokens.$font-family-primary;
}
```

From any component template or plain CSS:

```css
.my-card {
  background: var(--color-surface-card);
  border-radius: var(--radius-4xl);
  box-shadow: var(--shadow-elevation-1);
  padding: var(--space-20);
  color: var(--color-text-heading);
  font: var(--font-weight-medium) var(--font-size-xl) var(--font-family-primary);
}
```

**No existing component was refactored as part of Sprint 2.5.** Adopt tokens as modules are rebuilt during Sprint 3+.

---

## 6. Regeneration checklist (when designer ships Figma Variables)

1. Call `get_variable_defs` against the same frames listed in §1.
2. Where a variable exists for an observed value, replace the role-based name with the Figma-exact name.
3. Add any modes Figma ships (light/dark, density) as `[data-theme="..."]` scopes in `_tokens.css` / `_tokens.scss`.
4. Move "Status: PROVISIONAL" → "Status: Figma-sourced".
5. Remove the `_tokens.scss` provisional header.
6. Notify component owners so any custom value overrides can be mapped.
