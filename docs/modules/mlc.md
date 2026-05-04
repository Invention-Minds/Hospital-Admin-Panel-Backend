# Sprint 2e — MLC (Medico Legal Case) backend HMIS push wiring

Source rows: `docs/GAP_ANALYSIS.md` Module 2.
Scope: wire the 4 MLC write endpoints through the Sprint-1 wrapper with **inline-await** (regulatory paperwork, not high-frequency). Add additive `hmisMlcId` column. No frontend. No Figma.

---

## Step 1 — Plan

### Endpoints in scope (5)

| Actual route | Handler | Type | HMIS push? |
|---|---|---|---|
| `POST /api/mlc/register` | `registerMlcCase` | create | **Yes** (inline-await, persist `hmisMlcId`) |
| `PUT /api/mlc/:id/examination` | `recordExamination` | update | **Yes** (inline-await, persist `hmisMlcId` if not already set) |
| `PUT /api/mlc/:id/samples` | `recordSampleCollection` | update | **Yes** (inline-await) |
| `PUT /api/mlc/:id/report` | `submitReport` | update | **Yes** (inline-await) |
| `GET /api/mlc/pending-reports` | `getPendingReports` | read | No — contract test only |

### Gap analysis findings
- All 4 writes have silent-stub `createHmisAuditLog({ status: 'success' })` blocks with no actual HMIS call. Same stub pattern we've fixed in 2a/2b/2c.
- `MlcCase` schema has no `hmisMlcId` field. Must be added.
- Field names diverge from the plan (`fir_No`/`firstExaminationDone`/`photographsTaken`/`photoUrls`) — previously accepted in CURRENT_STATE.md; mapping happens at the HMIS boundary (payload builder), not via rename.
- 0 `(req as any)` / `(prisma as any)` / `@ts-ignore` — Sprint 1 cleanup stuck. Pre-existing `: any` on local `where` filter objects at lines 170 and 597 are minor and out of 2e scope.

### What I will CREATE

- **Schema** additive column: `hmisMlcId String?` on `MlcCase`. Migration file written manually per policy: `prisma/migrations/20260418120000_add_hmismlcid_to_mlc_case/migration.sql`.
- **2 push methods in [hmis-client.ts](../../src/api/hmis-sync/hmis-client.ts)** (smaller surface than 4; more consistent with CREATE/UPDATE REST patterns HMIS likely exposes):
  - `pushMlcCase(data)` → `POST /mlc/register` — initial MLC creation
  - `pushMlcUpdate(data)` → `PUT /mlc/:hmisMlcId` — partial update for examination/samples/report events, discriminated by `event` field in payload
- **4 exported typed payload builders** in [mlc.controller.ts](../../src/api/mlc/mlc.controller.ts): `buildMlcRegisterPayload`, `buildMlcExaminationPayload`, `buildMlcSamplesPayload`, `buildMlcReportPayload`.
- **Test suite** `src/api/mlc/__tests__/mlc.test.ts`: 12 write-endpoint tests + 1 read contract = 13 total. Single file (≤25 per split threshold).

### What I will PATCH

- `registerMlcCase`: replace silent stub with `syncWithHmis(...)` wrapping `pushMlcCase`. On HMIS success with `id`, persist to `mlcCase.hmisMlcId` via a follow-up `update`.
- `recordExamination`: replace silent stub with `syncWithHmis(...)` wrapping `pushMlcUpdate(payload, 'examination')`. If `hmisMlcId` isn't yet on the row (register-push failed earlier) AND HMIS now returns an `id`, persist it as part of the follow-up. Otherwise, just audit the event.
- `recordSampleCollection`: same pattern — `pushMlcUpdate(payload, 'samples_collected')`.
- `submitReport`: same pattern — `pushMlcUpdate(payload, 'report_submitted')`. Preserves existing 400 guard on missing `finalReport`.

### What I will NOT CHANGE

- `getPendingReports` handler body (locked in by contract test only).
- Other handlers: `getMlcCase`, `getMlcCaseList`, `getMlcCaseByNumber`, `getMlcCaseByEmergency`, `getMlcCasesByDate`, `updateMlcCase`, `uploadMlcPhotos`, `uploadExaminerSignature`, `uploadSubmissionProof`, `getMlcStats`, `closeMlcCase`, `getMlcCaseHistory`, `downloadMlcDocumentation`, `generateMlcReportPdf` — out of 2e 5-endpoint scope.
- `registerMlcCase`'s existing 400 on duplicate-MLC-for-emergency. Semantically 409 would be more accurate, but changing HTTP status is a client-facing contract change. Preserving 400 and will flag in the report if you want 409 in a follow-up.
- Upload handlers (photos / signatures / submission proof) — even though they're MLC-side, they're not in the 5 endpoints listed; Sprint 4 can wire them separately.
- `closeMlcCase` silent audit stub — out of 2e scope; it's the lifecycle-terminus, not one of the 4 writes in scope.

### Emergency → MLC auto-fill — scope note

User spec: "if the referenced Emergency case exists, copy initial fields into the MLC register payload."

**My reading: no backend auto-fill code is needed in 2e.** Rationale:
- The MlcCase ↔ Emergency FK relationship already exists (`MlcCase.emergencyId` → `Emergency.id`).
- `getMlcCase`/`getMlcCaseByEmergency` handlers already include Emergency details via `include: { emergency: ... }`, so downstream consumers have full auto-fill context.
- The `Emergency` model contains no MLC-specific fields (no `investigatingOfficer`, no `fir_No`, no `injuries`). There's literally nothing MLC-shaped to copy from Emergency into MlcCase other than the FK.
- The frontend MLC register form (Sprint 3d) will pre-populate from the Emergency by fetching both resources — this is the correct separation.

If a later sprint adds e.g. `Emergency.suspectedCauseOfInjury`, that could auto-populate `MlcCase.injuries` at register time. Not the case today. Flagging this interpretation in the report so it can be overruled.

### HMIS push contracts

| Handler | direction | module | entityType | action |
|---|---|---|---|---|
| `registerMlcCase` | push | `mlc` | mlc-case | `mlc_registered` |
| `recordExamination` | push | `mlc` | mlc-case | `mlc_examination` |
| `recordSampleCollection` | push | `mlc` | mlc-case | `mlc_samples_collected` |
| `submitReport` | push | `mlc` | mlc-case | `mlc_report_submitted` |

- `swallowErrors: true` (default) — HMIS failure must NOT block regulatory paperwork; the MLC row already committed locally at push time.
- `maxRetries: 0` (default) — hmis-client internal retry (3× exponential) still active.

### Inline-await pattern (per Sprint 2 latency policy)

```typescript
// 1. Local DB mutation completes (awaited)
const mlcCase = await prisma.mlcCase.create({...}); // or .update

// 2. HMIS push awaited (blocks until audit row + local hmisMlcId write complete)
const outcome = await syncWithHmis({
  direction: 'push', module: 'mlc', entityType: 'mlc-case',
  action: 'mlc_registered', payload: mlcCase,
  operation: () => pushMlcCase(buildMlcRegisterPayload(mlcCase)),
});

// 3. If HMIS returned an id, persist hmisMlcId
let finalMlc = mlcCase;
if (outcome.success && outcome.result) {
  const hmisResult = outcome.result as { id?: string | number };
  if (hmisResult.id != null) {
    finalMlc = await prisma.mlcCase.update({
      where: { id: mlcCase.id },
      data: { hmisMlcId: String(hmisResult.id) },
    });
  }
}

// 4. Respond
res.status(201).json({ data: finalMlc });
```

For examination/samples/report, if `hmisMlcId` is still null on the MLC row (because register-push failed) AND the HMIS update returns an id, persist it on this call. Otherwise no follow-up update — just the wrapper's audit row.

### Schema decision & migration

**Add** `hmisMlcId String?` to `MlcCase`. Optional, nullable, no default, no backfill.

**Migration:** `prisma/migrations/20260418120000_add_hmismlcid_to_mlc_case/migration.sql`:
```sql
ALTER TABLE `MlcCase` ADD COLUMN `hmisMlcId` VARCHAR(191) NULL;
```

No index — queries that join via `hmisMlcId` are not anticipated in 2e scope; can add later if a reconciliation workflow needs it.

**Data-preservation verification (per policy):**
- `ALTER TABLE … ADD COLUMN … NULL` is additive. MySQL 8.0+ uses the INSTANT algorithm for this — metadata-only change, no row rewrite, no table lock.
- Every existing `MlcCase` row gets `hmisMlcId = NULL`.
- No UPDATE, no DELETE, no DROP.
- No `--shadow-database-url`. No reset.
- Preview: `npx prisma migrate diff --from-schema-datasource ./prisma/schema.prisma --to-schema-datamodel ./prisma/schema.prisma --script` (no shadow; introspection only) to confirm no unexpected SQL is produced.
- Apply: `npx prisma migrate deploy` (applies pending migrations by inserting into `_prisma_migrations`; no DDL beyond what's in the file).

### Test plan (13 tests)

| Handler | Happy | HMIS failure | Sanity |
|---|---|---|---|
| `registerMlcCase` | ✓ 201, persists hmisMlcId | ✓ 201, no hmisMlcId, failure audit | ✓ duplicate MLC for emergency → 400, no HMIS |
| `recordExamination` | ✓ 200 | ✓ 200, failure audit | ✓ MLC not found (update throws) → 500, no HMIS |
| `recordSampleCollection` | ✓ 200 | ✓ 200, failure audit | ✓ MLC not found → 500, no HMIS |
| `submitReport` | ✓ 200 | ✓ 200, failure audit | ✓ missing `finalReport` → 400, no HMIS |
| `getPendingReports` | — | — | ✓ contract: filters by status in [documented, examination-done, samples-collected], includes emergency fields, ordered asc by createdAt |

**Audit JSON capture target:** `registerMlcCase` happy + failure rows for the sync-check doc (most representative; kicks off the full MLC lifecycle).

### Hard-rule checks

- [ ] No new `any` / `@ts-ignore`
- [ ] Wrapper used for every HMIS push (no raw `pushMlc*` outside wrapper)
- [ ] Audit log on success AND failure (wrapper behavior)
- [ ] Schema change is additive only (nullable column add)
- [ ] Migration data-preservation verified (INSTANT ALGORITHM, no row rewrite)
- [ ] No `--shadow-database-url` used
- [ ] Tests: ≥2 per write endpoint; I have 13 total (12 writes + 1 read)
- [ ] Inline-await per Sprint 2 latency policy
- [ ] Persist `hmisMlcId` from HMIS response on success
- [ ] Test isolation: mocks only, no dev-DB connection

---

# Sprint 3d — MLC Completion (frontend)

Phase A audit: the frontend has a working list at [`src/app/mlc/mlc-cases.component.ts`](../../../Frontend/Hospital-Admin-Panel/src/app/mlc/mlc-cases.component.ts) with stats / filters / search / download / close. No register form, no detail view. Backend is fully wired from Sprint 2e above.

This sprint completes the UI to 100%.

## Step 1 — Plan

### Screens

| Screen | Route | Status | Purpose |
|---|---|---|---|
| A — Register form | `/mlc/new` | **new** | Register MLC case, optionally pre-filled from Emergency (`?emergencyId=<id>`) |
| B — Detail / Lifecycle | `/mlc/:id` | **new** | View + record examination / samples / report |
| C — Case list | `/mlc` | **enhanced (not rewritten)** | Existing list + Create button + pending-reports badge + row-click navigation + P4 empty state |

### Existing list — enhancement plan (not rewrite)

Current list ([mlc-cases.component.html](../../../Frontend/Hospital-Admin-Panel/src/app/mlc/mlc-cases.component.html)) has a functional stats grid + 3-way filters + table + per-row download/close actions. **Enhance in place**:
1. Add **"New MLC Case"** button next to Refresh → routes to `/mlc/new`.
2. Add **pending-reports badge** next to the title (count from `GET /api/mlc/pending-reports`).
3. Add **row click** → navigates to `/mlc/:id`.
4. Replace the existing `prompt()`-based close flow with **P1 ConfirmDialog** (severity=warning). Minor UX lift while the file is touched.
5. Replace the inline "No MLC cases match" div with **`<app-empty-state>`**.

Stats cards, filter dropdowns, column set, download action: **unchanged.**

### Patient context lookup

- Register (Screen A): when `?emergencyId=<id>` is present, fetch the emergency → surface `emergency.patientName` + `emergency.prn`.
- Detail (Screen B): `GET /api/mlc/:id` already includes `emergency: { prn, patientName, phoneNumber, age, presentingComplaint }`. Use `AppointmentConfirmService.getDetailsByPRN(prn)` to fetch `PatientDetails` for the canonical patient context. `<app-page-header>` renders it.

### Patterns composed (ui-patterns.md)

| UI element | Pattern | Notes |
|---|---|---|
| Page heading w/ patient + MLC context | §5c — **P2 PageHeader** | Both new screens |
| Register form | §1 FORM | Focus/error/caption states (Gaps #1, #2, #5) |
| Case-type select | §1 FORM dropdown (same style as 3b) | 5-value enum |
| Lifecycle sections | §7 CARD | One card per lifecycle step; no modal |
| Lifecycle forms | §1 FORM inline | Edit-in-place per section |
| Final Report confirm | §3 MODAL-3a warning — **P1 ConfirmDialog severity=warning** | Regulatory event |
| Close case confirm | §3 MODAL-3a warning — **P1 ConfirmDialog** | Replaces `prompt()` |
| List empty state | §2 — **P4 EmptyState** | Replaces inline div |
| **HMIS sync indicator** | NEW — feature-local | "Synced · HMIS-MLC-xxx" vs "Sync pending" |
| Toast | §6 | `MessageService` |

### Reusables imported

- **P1** `ConfirmDialogComponent` — Final Report + Close case.
- **P2** `PageHeaderComponent` — Register + Detail.
- **P4** `EmptyStateComponent` — enhanced list.
- Existing `MlcService`, `AppointmentConfirmService`, `MessageService`.

### New reusables built

**None.** The HMIS sync indicator is feature-local for now — extract only if Sprint 3e LAMA/DAMA (also inline-await) needs the identical shape.

### Inline-await UX contract (different from 3c's fire-and-forget)

- **Register submit**: spinner on Save while HMIS push is awaited inline (~0-7s worst case). Response's `data.hmisMlcId` either populated or null.
- **Detail view HMIS sync badge**:
  - `hmisMlcId` populated → `pi pi-check-circle` `--color-success-strong` + text `"Synced · <hmisMlcId>"`
  - `hmisMlcId` null → `pi pi-circle` `--color-text-muted` + text `"Sync pending"`
- **Lifecycle submits (examination / samples / report)**: spinner on section button + success toast + refresh detail (post-backfill `hmisMlcId` may now be populated per Sprint 2e's opportunistic-backfill helper).
- **Backend error**: error toast, form values preserved.

### Gaps invoked (Design Gaps Policy)

**New minor extrapolation** — HMIS sync indicator visual:

| State | Treatment | Rationale |
|---|---|---|
| Synced | `pi pi-check-circle`, `--color-success-strong` (#169458), `--font-size-sm` + `HMIS-MLC-xxx` in `--color-text-body` | Strong-green token is already used for Unlock ("verified" semantic) |
| Pending | `pi pi-circle`, `--color-text-muted` + "Sync pending" | Neutral pending semantic |

Shape choice: **icon + inline text**, not a pill — sync is metadata, not a primary status. Flagged for designer review.

Other gaps (#1, #2, #5, #9, #17) applied as already decided.

### Testing plan (~21 tests)

**Service tests — 7** (new file `mlc.service.spec.ts`):
1. `registerMlcCase` happy (POST `/mlc/register`, body shape)
2. `registerMlcCase` 400 (duplicate emergency)
3. `registerMlcCase` 500
4. `recordExamination` happy (PUT `/mlc/:id/examination`)
5. `recordSampleCollection` happy (PUT `/mlc/:id/samples`)
6. `submitFinalReport` happy (PUT `/mlc/:id/report`)
7. `getMlcCase` 404

**Register component — 5**
1. Renders with empty `emergencyId`
2. Renders pre-filled emergency context from `?emergencyId=`
3. Submit → service + success toast + navigates to `/mlc/:id`
4. Backend error → toast, form preserved
5. Required-field validation (emergencyId + caseType)

**Detail component — 6**
1. Renders case summary with "Sync pending" when `hmisMlcId` null
2. Renders case summary with "Synced · HMIS-MLC-xxx" when `hmisMlcId` present
3. Sync indicator updates after lifecycle push (opportunistic backfill)
4. Each section renders existing data when present + empty form when not
5. Final Report opens ConfirmDialog (warning); confirm calls service
6. Error toast on lifecycle push failure

**List enhancement — 3**
1. Pending-reports badge renders correct count
2. "New MLC Case" button navigates to `/mlc/new`
3. Row click navigates to `/mlc/:id`

**Total: 21 new tests.**

### Hard-rule checks

- [ ] Zero hardcoded hex in new component CSS
- [ ] Zero `any` / `@ts-ignore`
- [ ] Tokens via `var(--…)` exclusively
- [ ] P1 ConfirmDialog for Final Report + Close (warning)
- [ ] P2 PageHeader on Register + Detail
- [ ] P4 EmptyState on list (replace inline div)
- [ ] Patient context via `prn → PatientDetails` (not Appointment.patientId)
- [ ] Inline-await UX: sync-indicator visible, opportunistic backfill surfaced
- [ ] Existing `mlc-cases.component.spec.ts` still compiles if present
- [ ] HMIS sync indicator flagged in parity doc
- [ ] Full test counts reported before/after
