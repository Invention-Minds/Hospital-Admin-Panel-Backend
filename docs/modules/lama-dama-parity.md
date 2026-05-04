# Visual Consistency Check — LAMA / DAMA Completion (Sprint 3e)

Pattern-transfer check. No dedicated Figma frames exist for LAMA / DAMA Register / Detail / List enhancements. Comparison is against:

1. `docs/ui-patterns.md` §1 FORM, §2 TABLE, §3 MODAL 3a, §4 BUTTON, §5c Page heading, §6 EMPTY, §7 CARD, **§8 P6 HmisSyncIndicator** (added this sprint)
2. Sibling Sprint 3 screens: Progress Notes (3a-2), Discharge (3b), Pharmacy + MAR (3c), MLC (3d)
3. The existing `LamaDamaComponent` list at [src/app/discharge/lama-dama.component.*](../../../Frontend/Hospital-Admin-Panel/src/app/discharge/) (enhanced in-place, not rewritten)

## 1. P6 HmisSyncIndicator — extracted + reused

First Sprint 3 reusable extracted from a **proven** feature-local implementation (MLC Detail, 3d). Extraction justified by two concurrent consumers this sprint:

| Consumer | size | prefix | Location |
|---|---|---|---|
| `LamaDamaDetailComponent` summary card | `default` | `HMIS-LAMA` / `HMIS-DAMA` | per-record detail |
| `LamaDamaComponent` list — LAMA + DAMA tables | `small` | `HMIS-LAMA` / `HMIS-DAMA` | one column per row |

A third consumer (MLC Detail) remains on the feature-local copy, **tracked in [sprint-3-backlog.md](../sprint-3-backlog.md) for Sprint 3.5 migration** — extract-and-leave-legacy-in-place avoids a simultaneous 3d + 3e regression risk.

Smart prefix handling: the component tolerates both id storage conventions the backend uses (`HMIS-LAMA-501` stored whole vs `501` stored bare). If the id already starts with the prefix, it's rendered as-is; otherwise the prefix is prepended. Four tests cover this ([hmis-sync-indicator.component.spec.ts](../../../Frontend/Hospital-Admin-Panel/src/app/shared/ui/hmis-sync-indicator/hmis-sync-indicator.component.spec.ts)).

## 2. Combined Register + Detail (single screen each, type-discriminated)

Decision D1 from the frontend audit: rather than four screens (LamaRegister + LamaDetail + DamaRegister + DamaDetail) we built two — each with a `type` discriminator.

| Screen | Route | Discriminator source |
|---|---|---|
| Register | `/lama-dama/new?type=lama\|dama` | Query param, defaults to `lama`. A P-dropdown at the top lets the user toggle. |
| Detail | `/lama-dama/:type/:id` | Path param. Type is fixed once loaded. |

**Reasoning**:
- LAMA and DAMA share 5 of 8 form fields (emergencyId, timestamp, witnessName, witnessSignature, patientSignature). The only divergent section is three fields each.
- One codepath for patient-context lookup, one for HMIS indicator, one for signature upload — half the future-maintenance surface.
- Template keeps `*ngIf="type === 'lama'"` / `*ngIf="type === 'dama'"` sections side-by-side, so visual diff is still legible to designers.
- Users arriving from the list's "New LAMA" / "New DAMA" buttons land on the right preset; dropdown is a safety net, not the primary entry.

## 3. Enhance-don't-rewrite on the legacy list

Per the standing rule, `LamaDamaComponent` (and its CSS) was **enhanced in place** rather than replaced. Sprint 3e additions:

| Addition | How |
|---|---|
| "New LAMA" / "New DAMA" buttons | Appended to existing `.page-header__actions` (two buttons — LAMA and DAMA are semantically distinct, a single combined button would be unclear at this header level) |
| HMIS sync column | Added `<th>HMIS sync</th>` + `<td><app-hmis-sync-indicator>...</app-hmis-sync-indicator></td>` in both tables |
| Row-click navigation | `(click)="openDetail('lama' \| 'dama', r.id)"` on `<tr>`, with `$event.stopPropagation()` on in-row action buttons |
| Toast instead of `alert()` | `verifyRecord` migrated from `window.alert()` to PrimeNG `MessageService` (severity=success/warn/error) |
| Empty state | Inline `<div class="empty-state">` replaced with `<app-empty-state>` (P4) on both tabs |

The existing stat cards, tabs, date/time formatting, signature dots, badge classes, and stats service calls are **untouched**. Pre-existing hardcoded hexes in `lama-dama.component.css` (e.g., header colors, table borders) are **not migrated** — Sprint 3g+ cleanup candidate, consistent with 3d's MLC list treatment.

## 4. Field/visual consistency — LAMA/DAMA Register + Detail vs siblings

| Aspect | 3a-2 Progress Notes | 3b Discharge | 3c Pharmacy | 3c MAR | 3d MLC R | 3d MLC D | **3e LAMA/DAMA R** | **3e LAMA/DAMA D** | Match? |
|---|---|---|---|---|---|---|---|---|---|
| Page root padding | 40 20 | same | same | same | same | same | same | same | ✅ |
| Page background | `--color-surface-page` | same | same | same | same | same | same | same | ✅ |
| Heading shape | inline h1 + sub | inline | `<app-page-header>` | `<app-page-header>` | `<app-page-header>` | `<app-page-header>` | **`<app-page-header>`** | **inline h1** (summary card instead) | ✅ (intentional: detail is card-first) |
| Section card shell | white radius-4xl elevation-1 20pad | same | same | same | same | same | same | same | ✅ |
| Section title weight / size | Kanit Medium 20px | same | same | same | same | same | same | same | ✅ |
| Label + input shape | §1 FORM | same | same | same | same | same | same | same | ✅ |
| Focus state | 2px navy | same | same | same | same | same | same | same | ✅ |
| Error state | 1px danger-strong | same | same | same | same | same | same | n/a (read-mostly) | ✅ |
| Primary CTA | orange | same | same | same | same | same | same | same | ✅ |
| Cancel / secondary | transparent outline | same | same | same | same | same | same | same | ✅ |
| Disabled button | `--color-surface-alt` + muted | same | same | same | same | same | same | same | ✅ |
| Destructive confirm | P1 danger | P1 danger (×2) | P1 danger | n/a | P1 warning (report) | n/a | **P1 danger (record LAMA/DAMA)** | n/a | ✅ severity intentional — LAMA/DAMA record is irreversible from this screen |

Register + Detail read as full siblings of 3d MLC Register + Detail. P2 PageHeader reused on the Register screen for patient context display.

## 5. LAMA vs DAMA visual symmetry

The two type-specific sections (§ LAMA details / § DAMA details) use identical section shell, identical `form__field` / `form__textarea` / `p-checkbox` markup, and identical error styling. The only visual differentiator is the label copy ("Doctor's advice" vs "Doctor's recommendation", "Risks explained" vs "Patient declines recommendation"). This is intentional — LAMA and DAMA are legally and clinically distinct events but **structurally** matched under NABH ACC.6.

## 6. Flagged items

### 6a. Signature capture is a text reference, not a drawing pad

Sprint 3e register form exposes `patientSignature` and `witnessSignature` as plain text inputs (labelled "URL or GCS reference"). The backend supports signature file uploads via `POST /lama-dama/lama/:id/upload-patient-signature` etc., but Sprint 3e does not surface an `<input type="file">` for these.

**Reasoning**: same as 3d flag #4. File-upload UIs require preview, in-flight state, per-upload test coverage. Scoped out to keep the sprint focused on the text-field lifecycle. Flagged as Sprint 3g+ cleanup candidate — shared signature-pad component could serve MLC, LAMA, DAMA, and future consent forms.

### 6b. No patient-lookup in Register

Unlike MLC Register (3d), the LAMA/DAMA Register does **not** call `AppointmentConfirmService.getDetailsByPRN` to populate patient context from the emergency case. It only calls `/api/emergency/:id` which surfaces `patientName + prn + age` — enough for the P2 header but narrower than the MLC pattern.

**Reasoning**: LAMA/DAMA entry always comes from an active emergency screen (the list's "New" button, or a direct patient-flow link). The emergency endpoint already has the patient identifiers inline. Adding a second lookup would duplicate work already done by the backend join. Flagged as a **deliberate departure**, not a gap — reviewed in audit, approved.

### 6c. Detail edit form is narrow

The detail screen's inline edit covers only clinical text fields (`doctorAdvice` / `reasonForLama` / `doctorRecommendation` / `followUpAdvice`) + witness + signatures. It does **not** let users edit `riskExplained` / `patientDeclinesAdvice` or the timestamp.

**Reasoning**: these are regulatory attestations captured at the time of the event. Editing them post-hoc has audit implications the backend hasn't ratified. Flagged — if edit scope is later broadened, re-evaluate.

### 6d. Confirm dialog copy

The Register ConfirmDialog message reads:
> "Recording LAMA for this patient updates the Emergency case status and cannot be reversed from this screen. Continue?"

(Same template, substituting DAMA for LAMA.) This is accurate but slightly stern — flagged for copy review alongside the 3d MLC confirm-dialog close-notes issue. Both would benefit from a once-over by whoever owns clinical copy.

## 7. Verdict

Ready for user review. Hard rules hold:
- Zero hardcoded hex in the **new** CSS (Register + Detail + Sprint 3e additions to List + extracted HmisSyncIndicator).
- Pre-existing hexes in `lama-dama.component.css` untouched (enhance, not rewrite).
- Reusables imported (P1, P2, P4, **P6** — new); none invented.
- P6 extracted at the natural second-use moment, not prematurely.
- Patient context via emergency → PRN (narrower than MLC's direct PatientDetails lookup, reviewed + approved).
- Inline-await UX visible via P6 sync indicator, with opportunistic backfill test coverage.

Four flagged items (§6a signature upload, §6b patient-lookup departure, §6c edit-scope, §6d confirm copy) — all narrow, all documented. §6b is a deliberate approved departure; §6a and §6c are Sprint 3g+ candidates; §6d is a copy review.
