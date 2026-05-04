# Sprint 3 — Post-feature backlog

Cleanup items parked while Sprint 3 feature work proceeds. Don't start these until the feature sprints (3d–3g) are complete.

---

## Sprint 3.5 — Reusable migrations (completed 2026-04-20)

Three migrations executed. Parity report: [docs/modules/sprint-3.5-parity/README.md](modules/sprint-3.5-parity/README.md).

- **Progress Notes → P2 PageHeader** ✅
- **Discharge → P2 PageHeader** ✅
- **MLC Detail → P6 HmisSyncIndicator** ✅ (kept `hmisSyncIsSynced` getter as a spec-facing shim; dropped `hmisSyncLabel`)

Tests: 25/25 module subset + full suite unchanged at 155/128. Zero new tests, zero regressions. Three specs got one-line `declarations: [...]` additions for the newly-imported reusable child components — assertion code is byte-identical.

Flagged for designer: admission-id color shifts from `--color-text-accent` to `--color-text-muted` on P2-migrated screens (matches P2's existing pattern across Sprint 3c/3d/3e/3f). Cosmetic; see parity §1 flags.

---

## Other open flags (for Sprint 4+ tracking, not 3.5)

These are captured across sync / parity docs — listed here for single-view visibility. **Not in 3.5 scope.**

| Source sprint | Flag | Target |
|---|---|---|
| 3a-2 | `IpdDischarge.doctorSignature` field missing (NABH MRD.3) | Sprint 4 schema |
| 3b | `dischargeType = 'DAMA'` not in backend enum (has own flow) | No action; documented |
| 3b | p-calendar popup styling punted | designer review |
| 3c | `modificationReason` column on `IpdPrescription` | Sprint 4 schema |
| 3c | Legacy `MedicationAdminLog.dose: string` wire name drift (UI reads as quantity) | Sprint 4 rename |
| 3c | Status pill `active/paused/discontinued` colors are narrow extrapolations | designer review |
| 3c | `IpdMedicationLog → IpdPrescription` lacks named Prisma relation (currently branch-c stitch) | Sprint 4 schema + migration |
| Sprint 2.5 Part A | 13 design gaps (empty state, button hover, toast variants, etc.) | designer review |
| Shared (spanning 3a-2+) | 129 CLI-scaffold broken specs in the Angular test suite | Standalone cleanup sprint |
| Sprint 3c | `follow-up-automation.ts:138` writes `PatientDetails.id` into FK-to-Patient column | Sprint 4 FK cleanup |
| Sprint 3f | `convertOpdToIpd` writes generic `"OPD Referral from {doctor}"` as diagnosis — doesn't accept a `diagnosis` param. Clinicians update via first IPD Progress Note. | Sprint 4 helper signature extension |
| Sprint 3f | No `diagnosis`/`roomType`/`department` override on either conversion helper; modal respects this | Sprint 4 (same ticket) |
| Sprint 3f | No HMIS-id backfill on admission-update (unlike MLC/LAMA/DAMA patterns) — if HMIS push fails at admit, no retry path from UI | Sprint 4+ if HMIS flakiness observed |
| Sprint 3f | `<select formControlName="bedId">` uses template `[disabled]` — emits Angular reactive-forms warnings | Sprint 3g/4 polish |
| Sprint 3f | Admit modal can stack 3 deep (TodayConsultations → OPD → Admit → Confirm) — accessibility concern | Sprint 4+ a11y review |
| Sprint 3f | `IpdAdmissionComponent` is orphaned (form exists, not routed, not declared). Intended for direct-admission flow (walk-ins, planned electives, external transfers). No new component needed — route it + add a launch point from dashboard or IPD list. | Sprint 3g / 4 direct-admission flow |
| Sprint 3f | Pre-existing `:deep(...)` unclosed-parens bug in `emergency-list.component.css` fixed to `::ng-deep` during this sprint. Worth auditing CSS across the frontend for other such issues | Sprint 3.5 polish |

---

## Sprint 4 — Addition from Sprint 3f report

Four of the five items originally listed here (CSS selector audit, OPD diagnosis param, 3-level modal a11y, `<select>` `[disabled]`) were duplicates of entries already in "Other open flags" above — deduplicated during Sprint 4a Phase 0 (2026-04-20). Only the non-duplicate entry remains:

1. **Prisma client consolidation.** `emergency.controller.ts` and `opd.controller.ts` both instantiate their own `new PrismaClient()` (see top-of-file imports) separately from the `src/service/prisma-client` singleton used by the conversion helpers. Audit all controllers, consolidate to the singleton. **Runtime impact:** connection-pool duplication, impossibility of cross-controller transactions, read-your-writes risk when a controller handler reads via its local client after the helper writes via the singleton. ~4–8 files.

---

## Sprint 4 — Additions from Sprint 3g report

Four items flagged during 3g that warrant their own tickets:

6. **SSE auto-reconnect has no backoff or cap.** [critical-values.service.ts:60-65](../../Frontend/Hospital-Admin-Panel/src/app/services/critical-values.service.ts) reconnects via `setTimeout(..., 5000)` unconditionally on `onerror`. Under a persistent backend outage this spams the server every 5 s indefinitely. Sprint 4: implement exponential backoff (5s→10s→30s→60s, cap at 5 retries, then show a terminal "reconnection failed" state with a manual Reconnect button). Deferred from Sprint 3g per Step 0 Q8.

7. **Critical-values mute state is per-browser, not per-user.** `localStorage['critical-values-muted']` key is per-origin. Mute choice doesn't follow the user across devices. Acceptable for a pure UX preference; revisit if per-user preferences become a feature.

8. **Critical-values dismiss doesn't hit the server-side ack endpoint.** `CriticalValuesService.acknowledgeAlert(alertId, acknowledgedBy)` exists + is tested, but `clearAlert(id)` on the dismiss button only updates local state. Wiring is a one-liner, skipped in 3g to avoid coupling dismiss UX to network success until we have a "tried to ack, server failed" story.

9. **PrimeNG button color override via `:host ::ng-deep`.** `.alert-button.connected` / `.disconnected` override `p-button` bg via the discouraged `::ng-deep` selector. PrimeNG 17 doesn't expose a cleaner per-instance color API. Revisit if we adopt a custom theming layer.

---

## Sprint 4+ — Estimation & OT integration (speculative)

**Trigger condition:** only becomes Sprint 4 scope IF hospital operational workflow or HMIS vendor requirements force Estimation / OT to join the HMIS-aware clinical flow. Currently speculative — Sprint 3f decided to ship Admit-to-IPD as **direct admission** (Option A / E per [estimation-ot-ipd-discovery.md](audits/estimation-ot-ipd-discovery.md)) with Estimation + OT kept as a parallel legacy island.

### Rationale for deferral

- Estimation / OT workflow (creation → submission → approval → PAC → OT execution → completion, with WhatsApp + PDF + 5 follow-up dates) is **fully built** in legacy Docminds. Staff use it. Rebuilding would be disruptive without a concrete HMIS vendor requirement.
- Original `HMIS_Integration_Plan.html` does not scope Estimation / OT. Billing is mentioned only as a placeholder `HmisAuditLog.module` enum value (never implemented).
- Admitting through Estimation would gate emergency admissions on a bureaucratic approval — clinically wrong for trauma cases.
- Sprint 2a's `IpdAdmission.sourceModule` + `referralOpdId` + `referralEmergencyId` pattern already supports direct admission end-to-end with `pushIpdAdmission` HMIS audit coverage.

### Deferred questions (from audit Part 6)

Only become relevant if Estimation modernization is greenlit:

1. **Legacy vs canonical** — is `EstimationDetails` workflow the go-forward, or slated for replacement? Decides whether modernization is in-place or a rewrite.
2. **`estimationType` enum meaning** — what do `"MM"` and `"SM"` stand for? (Likely Major / Minor surgery, unconfirmed.)
3. **`statusOfEstimation` vs `estimationStatus` duplication** — confirm which is canonical, deprecate the other.
4. **`patientUHID: Int?` vs PRN** — resolve identifier strategy (same ID needing type migration, or separate hospital-legacy identifier).
5. **`estimationId = "emergency"` magic string** — replace with proper Emergency↔OT link or standalone-OT record type.
6. **PAC semantics** — insurance TPA approval (→ belongs in billing push) vs internal hospital approval (→ pure UX gate).
7. **Approval role** — who actually approves in production: sub_admin → admin, or sub_admin alone?

### Integrity concerns carried forward from audit §4.4

Data-model cleanup items to address if / when modernization starts:

1. **Type mismatch** — `EstimationDetails.patientUHID` is `Int?` while `PatientDetails.prn` is `String @unique`. Any FK migration needs a backfill + type change.
2. **`consultantId: Int` has no `@relation`** — orphan risk if a doctor row is deleted.
3. **IpdAdmission referral pointers are loose `String?`** — `referralOpdId`, `referralEmergencyId`, `referralMlcId` have no `@relation` directive. Prisma enforces no integrity; dangling references on source-row deletion are possible.
4. **`OTDetails.estimationId = "emergency"` magic string** — collides with legitimate `@unique` estimationId values theoretically; needs a proper "standalone OT" mechanism.

### Scope if it ever happens

Net-new work: `pushEstimation*` + `pushOt*` HMIS client methods, HmisAuditLog enum extension (`estimation`, `ot` or consolidated `billing`), FK additions between Estimation/OT and IpdAdmission, `patientUHID` type migration, role enforcement on estimation write endpoints, auth middleware on `POST /generate-pdf`.

**Not committed.** Parked here purely so the deferral is traceable.
