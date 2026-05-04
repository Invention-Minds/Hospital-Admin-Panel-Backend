# LAMA / DAMA Frontend — Sprint 3e Step 0 Audit

Audit date: 2026-04-19. Information-gathering only. **No code changes have been made.** Purpose: surface existing architecture before the Sprint 3e build decision.

---

## 1. Existing code inventory

### 1.1 Component

**Single combined component** at [src/app/discharge/lama-dama.component.ts](../../../Frontend/Hospital-Admin-Panel/src/app/discharge/lama-dama.component.ts) (137 lines):

- Shared page header: "LAMA / DAMA Records"
- 4-card stats grid: Total · LAMA · DAMA · Compliance rate (two numbers: "X% / Y%" LAMA / DAMA).
- **Tab navigation** between LAMA and DAMA (client-side state `activeTab: 'lama' | 'dama'`).
- Per-tab data table. Distinct columns:

| LAMA columns | DAMA columns |
|---|---|
| `ID` · `Emergency ID` · `LAMA Time` · `Risk Explained (Yes/No badge)` · `Reason` · `Witness` · `Signatures (4 dots)` · `Actions` | `ID` · `Emergency ID` · `Discharge Time` · `Patient Declined (Yes/No badge)` · `Recommendation` · `Witness` · `Signatures (4 dots)` · `Actions` |

- Signature-status uses four `<span class="sig-dot">` pips (patient sig present/missing + witness sig present/missing). Hardcoded-color CSS.
- Row actions: `verifyDocumentation` (uses `alert()` for result — same legacy UX issue MLC had with `prompt()`) + `downloadReport` (PDF).
- No register form. No detail view.
- Empty state: inline `<div class="empty-state">No LAMA records.</div>` (legacy, not P4).

### 1.2 Service

Single shared [lama-dama.service.ts](../../../Frontend/Hospital-Admin-Panel/src/app/services/lama-dama.service.ts). Exports two interfaces + one service class with **both** record types' methods:

- `createLamaRecord / createDamaRecord` — `POST /lama-dama/lama` + `POST /lama-dama/dama`
- `updateLamaRecord / updateDamaRecord` — `PUT /lama-dama/lama/:id` + `PUT /lama-dama/dama/:id`
- `getLamaRecord / getDamaRecord` — single by id
- `getLamaRecordByEmergency / getDamaRecordByEmergency`
- `getAllLamaRecords / getAllDamaRecords`
- `uploadLama{Patient,Witness}Signature / uploadDama{Patient,Witness}Signature`
- `downloadLamaDocumentation / downloadDamaDocumentation`
- `generateLamaReport / generateDamaReport`
- `verifyDocumentation(type, id)` — single method with discriminator
- `getStats / getComplianceReport` — shared stats endpoints

Interfaces (typed already):

```ts
interface LamaRecord {
  id?: string; emergencyId: string; lamaTime: Date;
  doctorAdvice: string; riskExplained: boolean;
  patientSignature?: string; witnessName?: string; witnessSignature?: string;
  reasonForLama: string; createdAt?: Date;
}

interface DamaRecord {
  id?: string; emergencyId: string; dischargeTime: Date;
  doctorRecommendation: string; patientDeclinesAdvice: boolean;
  patientSignature?: string; witnessName?: string; witnessSignature?: string;
  followUpAdvice?: string; createdAt?: Date;
}
```

**Gap**: interfaces don't carry `hmisLamaId` / `hmisDamaId` (added to the schema in Sprint 2f). Those need adding to use the backend's returned shape.

### 1.3 Route

Single entry at [app-routing.module.ts:120](../../../Frontend/Hospital-Admin-Panel/src/app/app-routing.module.ts):

```ts
{ path: 'lama-dama', component: LamaDamaComponent, canActivate:[authGuard] },
```

No `/lama-dama/new`, no `/lama-dama/:id`, no `/lama`, no `/dama`.

### 1.4 Backend (from Sprint 2f + schema)

**Two separate Prisma models** ([schema.prisma:1323-1367](../../prisma/schema.prisma)):
- `LamaRecord` (id Int, emergencyId Int @unique, lamaTime, doctorAdvice, riskExplained, patientSignature, witnessName, witnessSignature, reasonForLama, **hmisLamaId String?**, createdAt, createdBy) — FK to Emergency.
- `DamaRecord` (id Int, emergencyId Int @unique, dischargeTime, doctorRecommendation, patientDeclinesAdvice, patientSignature, witnessName, witnessSignature, followUpAdvice, **hmisDamaId String?**, createdAt, createdBy) — FK to Emergency.

Both have unique `emergencyId` → one LAMA or DAMA per Emergency (mutually exclusive flow).

Endpoints (per service + routes):
- 2 creates (POST) — inline-await HMIS push.
- 2 updates (PUT) — inline-await HMIS push with opportunistic `hmisLamaId` / `hmisDamaId` backfill.
- 2 reads by id, 2 reads by emergency, 2 list-all.
- 4 signature uploads (1 per signature type × 2 record types).
- 2 PDF downloads, 2 PDF reports.
- 1 verify per type, shared stats + compliance report.

### 1.5 Backend emergency link

Emergency has 1:0..1 relations to both:
```prisma
emergency Emergency @relation(fields: [emergencyId], references: [id], onDelete: Cascade)
```
on both LamaRecord and DamaRecord, with `emergencyId @unique` — so Emergency → LAMA and Emergency → DAMA are both at-most-one, and they share no other relation. Creating one doesn't block creating the other in the schema (though clinically it would be unusual).

### 1.6 Completion level — true 50% or partial?

**Honest call: ~55%, same shape as the brief's "50%"** but leaning list-complete.
- List: **fully functional** with stats, tab nav, row actions (download + verify), signature pip indicators.
- Register: **missing** (0%).
- Detail: **missing** (0%).
- HMIS sync indicator: **missing** (existing interfaces don't even expose `hmisLamaId` / `hmisDamaId`).
- Signature uploads: backend endpoints exist, UI does not.

---

## 2. Architectural decision needed

### Question

**Separate per-type screens (one LAMA set, one DAMA set)** vs **combined screen with type toggle**?

### Existing code suggests

**Combined.** The built list already uses the combined-with-tabs pattern, single route, shared service. This is the strongest cue.

### Trade-offs

| | Separate screens | Combined screens |
|---|---|---|
| URL taxonomy | `/lama-dama` · `/lama/new` · `/dama/new` · `/lama/:id` · `/dama/:id` — clear per-type addresses | `/lama-dama` · `/lama-dama/new?type=lama|dama` · `/lama-dama/:type/:id` — URL carries the discriminator |
| Component count | 4 new (LamaRegister, DamaRegister, LamaDetail, DamaDetail) + keep existing list | 2 new (LamaDamaRegisterComponent, LamaDamaDetailComponent) + enhance existing list |
| Test count | 4 components × ~5 tests = ~20 + list × 3 = ~23 | 2 components × ~7 tests = ~14 + list × 3 = ~17 |
| Form overlap | LAMA + DAMA share 5 of 8 fields (`emergencyId, patientSignature, witnessName, witnessSignature, timestamp`) and differ on 2 (doctorAdvice/riskExplained + reasonForLama vs. doctorRecommendation/patientDeclinesAdvice + followUpAdvice). Two forms ≠ two totally different forms. | Single form with a type-discriminator at the top; dynamic field block below. Slight `*ngIf` complexity in the template. |
| Consistency with sibling 3 sprints | MLC (3d) shipped **separate** register + detail routes (`/mlc/new`, `/mlc/:id`). Following that pattern = separate per-type here too. | Existing LAMA/DAMA code is combined. Keeping it combined = consistency-with-self. |
| Deep linking | Easier — emergency flow links directly to `/lama/new?emergencyId=7` | Slightly awkward — `/lama-dama/new?type=lama&emergencyId=7` |
| Future divergence risk | Already separate — can evolve independently with zero refactor | Small refactor risk if LAMA and DAMA diverge materially later |

### My recommendation: **combined, with sub-routes**

```
/lama-dama                              (existing list, enhanced)
/lama-dama/new?type=<lama|dama>         (combined register form, type-discriminated)
/lama-dama/:type/:id  (where type ∈ 'lama'|'dama')   (combined detail view)
```

**Reasoning**:
1. **Existing code strongly suggests combined.** Rewriting to separate would contradict the "enhance, don't rewrite" discipline that made 3d work.
2. **Backend confirms mutual exclusivity at the data layer** (Emergency can have at most one LAMA AND at most one DAMA — both are keyed by `emergencyId @unique`). Single entrypoint → pick-your-type naturally reflects the clinical decision point ("patient's going against advice — which bucket?").
3. **The two forms overlap substantially** (emergencyId, both signatures, witness name, timestamp). A combined form with ~5 shared fields + a type-switch revealing the ~3 type-specific fields is less code and less test surface than two parallel forms. Real differences (doctor-advice vs. doctor-recommendation copy, LAMA's risk-explained checkbox vs. DAMA's patient-declines checkbox) are a small conditional block.
4. **Consistency with the codebase's current state** — users already navigate to `/lama-dama` as a single destination. Making the register/detail routes siblings of that path keeps mental model intact.
5. **MLC (3d) chose separate routes** because MLC has exactly one record type per case. Here we have two. The precedent doesn't carry.

**Alternate if you'd rather mirror MLC's shape**: separate routes. That's a legitimate call — slightly more code, slightly more tests, but clearer per-type addresses. Needs your decision.

---

## 3. Enhance vs. rewrite per existing component

### Recommendation: **enhance, don't rewrite** (same discipline as 3d MLC)

| Component | Verdict | Reasoning |
|---|---|---|
| `LamaDamaComponent` (list) | **Enhance** | Stats grid, tabs, tables, actions all functional. Needs: Create buttons, HMIS sync column, verify→toast migration, P4 empty states, row→detail navigation. |
| `LamaDamaService` | **Extend** (not replace) | Already has CRUD for both types + uploads + downloads + verify + stats. Add `hmisLamaId` / `hmisDamaId` to interfaces; otherwise unchanged. |
| Existing CSS (hardcoded hex, `.sig-dot`, stats colors) | **Leave alone** | Same rule as 3d list enhancement — don't sweep legacy hexes in a feature sprint; Sprint 3g+ cleanup candidate. New elements added in 3e will be token-based. |

### New reusable consideration (per brief Step 1)

The **HMIS sync indicator** from Sprint 3d was intentionally kept feature-local (restraint appreciated). In 3e it gets its second use with the identical visual shape (`pi-check-circle` synced vs. `pi-circle` pending, `--color-success-strong` vs. `--color-text-muted`, "Synced · HMIS-XXX-nn" copy). **Two uses clear the extraction bar.**

**Recommend extracting** to `shared/ui/hmis-sync-indicator/` as a new reusable this sprint. Props would be:
```ts
@Input() hmisId: string | null;          // null = pending
@Input() prefix: string = 'HMIS';        // e.g. "HMIS-MLC" or "HMIS-LAMA"
```
Document in ui-patterns.md. MLC detail screen can migrate opportunistically (3.5 backlog alongside P2 migration) — OR can migrate in 3e since it's one template swap.

**Sub-decision needed**: migrate MLC Detail's inline indicator to the new reusable in 3e (+1 file touched, +0 tests since P2-pattern reusable is already covered), or defer to Sprint 3.5?

---

## 4. Summary — decisions requested

Before I proceed with Sprint 3e build work, please confirm:

**D1. Architecture** — combined screens with sub-routes (my recommendation), or separate per-type screens?

**D2. HMIS sync indicator extraction** — extract to `shared/ui/hmis-sync-indicator/` this sprint? (Y/N)

**D3. If D2=Y, MLC migration timing** — migrate MLC Detail to the new reusable in 3e (one inline template change + zero new tests), or defer to Sprint 3.5? (3e / 3.5)

---

## 5. Plan-dependent details (answered at the time of Step 1)

These are not decisions — just notes on what the plan doc will cover once the architecture is approved:

- Emergency pre-fill: same path as 3d MLC (accept `?emergencyId=<id>`, pre-fetch via `HttpClient` direct GET on `/api/emergency/:id`, surface patient name + PRN in header).
- ConfirmDialog on submit: P1 severity=danger. Copy specific to LAMA vs. DAMA at render time.
- Signatures: schema stores URLs. UI will accept text/URL input in v1, NOT file uploads (consistent with MLC 3d scope decision — file uploads are a separate flagged gap).
- Opportunistic-backfill test: reproduce the MLC 3d pattern — first `getLama` returns `hmisLamaId: null`, `updateLama` returns populated, second `getLama` surfaces it.
- Patient context: `emergency.prn → PatientDetails` via `AppointmentConfirmService.getDetailsByPRN`.

**Awaiting your answers to D1 · D2 · D3.** No code written yet.
