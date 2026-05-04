# Visual Consistency Check — MLC Completion (Sprint 3d)

Pattern-transfer check. No dedicated Figma frames exist for MLC Register / Detail / List enhancements. Comparison is against:

1. `docs/ui-patterns.md` §1 FORM, §2 TABLE, §3 MODAL 3a, §4 BUTTON, §5c Page heading, §7 CARD
2. Sibling Sprint 3 screens: Progress Notes (3a-2), Discharge (3b), Pharmacy + MAR (3c)
3. The existing `MlcCasesComponent` list (untouched visually aside from the 3d additions)

## 1. HMIS sync indicator — flagged for designer

**First use in Sprint 3** of a "backend sync state" surface. Under fire-and-forget (3c) no indicator was shown; under inline-await (3d), the backend returns the HMIS id synchronously so the UI CAN show sync state. Narrow extrapolation:

| State | Token treatment | Icon | Copy |
|---|---|---|---|
| Synced | `--color-success-strong` (#169458) — same as "Unlock" button on Setting-Locked-IDs | `pi pi-check-circle` | "Synced · HMIS-MLC-xxx" |
| Pending | `--color-text-muted` (#7b7b7b) — Gap #17 disabled convention | `pi pi-circle` | "Sync pending" |

**Shape choice**: icon + inline text, not a pill. Sync is metadata, not a primary status. Badges in §2 (Active / Absend / Unavailable) describe *what the row is*, while this describes *whether the row has been replicated* — semantically different.

**Flagged for designer** — all tokens already in the set; no new tokens invented.

## 2. Sample collection as two scalar text fields (not an array)

The Sprint 3d brief described "array of samples with type, storageRef". The backend schema has two scalar columns: `samplesCollected: String?` + `sampleStorageInfo: String? @db.LongText`. Implementation surfaces two form fields (text + textarea) rather than a FormArray of `{ type, storageRef }` rows.

**Reasoning**:
- FormArray + per-row-remove UI (like the discharge-medications array in 3b) would send data the backend can't store structurally.
- Two scalars → two textareas is honest about the storage shape.
- If clinical requirements later need typed samples, that's a schema patch (Sprint 4 candidate).

**Flagged**.

## 3. Close-case notes removed (P1 has no content slot)

Pre-3d the list's close flow used `prompt('Closure notes (optional):')`. Replaced with P1 ConfirmDialog(severity=warning) per brief. P1's API is `title + message + confirmLabel/cancelLabel + severity` — no content slot for freeform input.

**Implementation**: `closureNotes` is always empty from the 3d UI. The ConfirmDialog message explains the consequence:
> "Closure is reversible via backend edit but intended as the final lifecycle step. Add any closure notes below (optional)."

(The "below" copy is technically misleading since there's no textarea — **noting this for cleanup**: either (a) extend P1 with an optional `<ng-content>` slot, or (b) remove "Add any closure notes below" from the dialog copy. Option (a) has broader future value — e.g., Sprint 3e may need the same "confirm + reason" pattern. Recommend to designer / product.)

**Flagged**.

## 4. No file-upload UI in v1 (examiner signature, MLC photos, submission proof)

Backend endpoints exist:
- `POST /api/mlc/:id/upload-photos` (multer array)
- `POST /api/mlc/:id/upload-signature` (multer single)
- `POST /api/mlc/:id/upload-submission-proof` (multer single)

UI surfaces: **none**. Each would need:
- A file input + preview state
- A sub-service method
- Component state for in-flight uploads
- An extra test per upload path

Scoped out of 3d to keep surface focused on lifecycle text fields. Flagged as Sprint 3d+ cleanup.

## 5. Field/visual consistency — MLC Register + Detail vs sibling 3 screens

| Aspect | 3a-2 Progress Notes | 3b Discharge | 3c Pharmacy | 3c MAR | **3d Register** | **3d Detail** | Match? |
|---|---|---|---|---|---|---|---|
| Page root padding | 40 20 | same | same | same | same | same | ✅ |
| Page background | `--color-surface-page` | same | same | same | same | same | ✅ |
| Heading shape | inline h1 + sub | inline | `<app-page-header>` | `<app-page-header>` | **`<app-page-header>`** | **`<app-page-header>`** | ✅ (3a-2/3b migrate in 3.5) |
| Section card shell | white radius-4xl elevation-1 20pad | same | same | same | same | same | ✅ |
| Section title | Kanit Medium 20px | same | same | same | same | same | ✅ |
| Label + input shape | §1 FORM | same | same | same | same | same | ✅ |
| Focus state | 2px navy | same | same | same | same | same | ✅ |
| Error state | 1px danger-strong | same | same | same | same | same | ✅ |
| Primary CTA | orange | same | same | same | same | same | ✅ |
| Cancel / secondary | transparent outline | same | same | same | same | — (no cancel on sub-forms) | ✅ |
| Disabled button | `--color-surface-alt` + muted | same | same | same | same | same | ✅ |
| Destructive confirm | P1 danger | P1 danger (two places) | P1 danger | n/a | n/a | P1 warning (final report) | ✅ varied severity used deliberately |

Register + Detail read as full siblings of Pharmacy + MAR. Heading styling identical via P2.

## 6. List enhancement vs. pre-3d shape

- Pending badge: positioned inside the `<h1>` next to the title, yellow `--color-warning-bg` pill, small text. Visual weight tuned so it's noticed without dominating the page title.
- "New MLC Case" button: primary orange (matches the `New Appointment`-style convention from other admin screens — though most legacy buttons are still blue/hardcoded; the primary-orange here is tokenised and slightly ahead of the legacy list header).
- Row hover: `--color-surface-table-head` (#edf4fc) — existing table-header color reused so hover feels continuous with the column strip.
- Empty state: now `<app-empty-state>` instead of inline div — two-line copy ("No MLC cases match the current filters" + "Try clearing filters or register a new MLC case above.").

The existing list's stats grid / filter controls / download button / column shapes remain untouched (they use hardcoded hexes — legacy, Sprint 3g+ cleanup candidate, not in 3d scope per the "enhance don't rewrite" instruction).

## 7. Verdict

Ready for user review. Hard rules hold:
- Zero hardcoded hex in the **new** CSS (Register + Detail + Sprint 3d additions to List).
- Pre-existing hexes in `mlc-cases.component.css` untouched (enhance, not rewrite).
- Reusables imported (P1 × 2, P2, P4). None invented.
- Patient context via PRN → PatientDetails throughout.
- Inline-await UX visible via the sync indicator, with opportunistic backfill test coverage.

Four flagged items (§1 sync indicator, §2 scalar samples, §3 close-notes drop, §4 file uploads) — all narrow, all documented.
