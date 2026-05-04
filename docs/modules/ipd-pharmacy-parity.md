# Visual Consistency Check — IPD Pharmacy + MAR (Sprint 3c)

Pattern-transfer check. No dedicated Figma frames exist for either Pharmacy Review or MAR. Comparison is against:

1. `docs/ui-patterns.md §1 FORM` — Modify + Administer modals
2. `docs/ui-patterns.md §2 TABLE/LIST` — row layout, status badges, empty states
3. `docs/ui-patterns.md §3 MODAL 3a` — Discontinue confirmation (P1)
4. `docs/ui-patterns.md §4 BUTTON` — primary / secondary-outline / icon-destructive
5. `docs/ui-patterns.md §5c Page heading` — now componentised as **P2**
6. The sibling screens already built in this Sprint 3 run: **Progress Notes (3a-2)** and **Discharge (3b)** — consistency check

## 1. Status pill — extrapolation (flagged)

The "Active IPD prescriptions" section shows a status pill per row: `active` · `paused` · `discontinued`. No Figma frame defines these three states for prescription status. Narrow extrapolation from the §2 status-badge convention already used on the Doctors list:

| State | Background | Text | Source/reasoning |
|---|---|---|---|
| `active` | `--color-success-bg` (#79cfa6) | `--color-text-on-dark` (white) | Mirrors the "Available" badge on the Doctors list |
| `paused` | `--color-warning-bg` (#fce35f) | `--color-text-body` (black) | Yellow → caution / temporary halt |
| `discontinued` | `--color-surface-alt` (#f4f4f4) | `--color-text-muted` (#7b7b7b) | Neutral / inactive — uses Gap #17 (disabled) tokens |

**Shape**: rectangular pill, `--radius-md` (8px), `--font-size-xs`, `--font-weight-medium`. Consistent with existing "Available / Absend" pills from the Dashboard (§2) — same radius, same font weight, same text-on-dark for colored variants.

**Flagged for designer**. All three states use existing tokens; no new tokens invented.

## 2. Carryover row action scope — intentional deviation

The original Sprint 3c brief listed **Continue / Modify / Discontinue** as per-carryover-row actions. Implementation exposes only **Continue** on carryover rows. Reasoning:

- Backend `modifyPrescription(prescriptionId)` operates on `IpdPrescription.id`. A carryover row is an *OPD* prescription tablet — it has no `IpdPrescription.id` yet.
- Backend `discontinuePrescription(prescriptionId)` same constraint — requires IPD side.
- Offering Modify / Discontinue on an OPD row would either need new backend endpoints (out of scope for a frontend sprint) or would fail with HTTP 404 at the UI layer.

**Implementation**: carryover = "Continue" only. Users who want to continue-with-modifications flow: Continue → the new IPD row appears in the Active section below → Modify it there.

Flagged for future UX review if clinicians prefer a combined "Continue & edit" modal.

## 3. Modify modal — no reason-for-change field

The brief mentioned a "reason-for-change" field in the Modify modal. Backend `modifyPrescription` **does not persist a modification reason** — `IpdPrescription` has no `modificationReason` column, only `updatedBy`.

**Implementation**: dose / frequency / duration / route / instructions, matching the backend's accepted fields. No reason field.

**Flagged**: if clinical governance requires reason-tracking, that's a Sprint 4 schema patch (add `modificationReason` + history table). Not in 3c scope.

## 4. MAR "Administer" modal — `quantity` label, not `dose`

The backend's `administerMedication` endpoint takes `{ quantity, route, remarks }`. `IpdMedicationLog.quantity` is an Int.

**Implementation**: the form label reads **"Quantity"**, not "Dose". The wire payload maps UI `quantity` → service-layer `dose` field (the `MedicationAdminLog` interface still uses the legacy `dose` key), which the controller accepts as `quantity` on the body. Backend ends up with `quantity: Int` in the DB.

**Flagged** per the user's earlier correction: "Do NOT add a ghost 'dose' column anywhere." Quantity is what the form shows and what the DB stores; the label matches reality. The legacy `MedicationAdminLog.dose: string` field on the frontend service interface is a Sprint-4 cleanup candidate (rename to `quantity`).

## 5. Field/visual consistency — Pharmacy + MAR vs Progress Notes + Discharge

All four screens now share the admission-scoped shell:

| Aspect | Progress Notes (3a-2) | Discharge (3b) | Pharmacy (3c) | MAR (3c) | Match? |
|---|---|---|---|---|---|
| Page root padding | 40px 20px | same | same | same | ✅ |
| Page background | `--color-surface-page` | same | same | same | ✅ |
| Heading font | Kanit Medium 2xl navy | same | same | same | ✅ |
| Section card shell | white, radius-4xl, elevation-1, 20px pad | same | same | same | ✅ |
| Section title | Kanit Medium xl heading | same | same | same | ✅ |
| List/row card | 1px border-input + radius-xl + 16px pad | (n/a — form) | same | same | ✅ |
| Primary CTA | orange (`--color-brand-primary`) | same | same | same | ✅ |
| Destructive icon button | red square (`--color-danger-strong`) + `--radius-md` | same (row Delete) | same | (n/a — no destructive in MAR) | ✅ |
| ConfirmDialog for destructive | danger severity | same | same (Discontinue) | (n/a) | ✅ |
| Focus state on inputs | 2px navy (Gap #1) | same | same | same | ✅ |
| Error state on inputs | 1px danger-strong (Gap #2) | same | same | (n/a — no required fields trigger) | ✅ |
| Disabled button | `--color-surface-alt` + muted (Gap #17) | same | same | same | ✅ |
| Page heading | inline h1 + subheading | inline | **`<app-page-header>`** (P2) | **`<app-page-header>`** | ⚠️ see below |

**Tokenised consistency: ✅ all four screens look like siblings.**

**`<app-page-header>` rollout**: Progress Notes and Discharge currently have inline headings (built before P2 existed). Their page heading shape is visually identical (same tokens, same HTML structure). They'll be migrated to `<app-page-header>` opportunistically when next touched (no Sprint 4 cleanup sprint scheduled yet).

## 6. Sprint 3 visual baseline vs legacy OPD forms

The IPD Pharmacy + MAR pages extend the same visual baseline as Progress Notes / Discharge: token-only, zero hardcoded hex. The legacy OPD Prescription form remains pre-token (hardcoded `#2563eb`, `#dc2626`, etc.) — cleanup candidate scheduled for Sprint 3g or later.

## 7. Intentional omissions (flagged)

1. **No "Skip this carryover" local-dismiss action** — carryover rows stay visible until Continue is called. No backend dismiss exists; adding a local-only hide state would diverge from server state on refresh.
2. **No pagination UI in MAR administered section** — backend supports `?page=&limit=`, frontend always requests defaults. Revisit if admissions show >10 log entries (cap in practice is ~10/day for typical ward rounds).
3. **No MAR date-filter UI** — brief says "today's by default; no date filter required in 3c". Honored.
4. **No "create new IPD Rx" button on Pharmacy screen** — backend has `POST /admission/:id/prescription` but the UI doesn't expose it. New Rx creation would need its own modal similar to Modify; scoped out of 3c per brief's silence on the capability.

## 8. Verdict

Ready for user review. All four Sprint 3 admission-scoped screens share the same tokens, same page-heading shape, same list-card / row-card / modal / confirm / toast / empty-state vocabulary. Pattern transfer successful. Hard rules hold (zero hardcoded hex in new CSS, zero `any`, zero `@ts-ignore`, reusables built once and imported).
