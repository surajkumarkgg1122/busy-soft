# BUSY SOFT — MASTER EXECUTION STRATEGY & PROMPT LIBRARY
> Contract Reference: [MASTER ENGINEERING EXECUTION CONTRACT](#) (user-session-defined)
> Repository Root: `d:\nextjs\erp-application`
> Architecture: UI → Application Command → Authorization → Domain Validation → Transaction Engine → (Accounting | Inventory | Party | GST/Tax) → Audit → Projections → Reports/UI
> Domain Layer: [src/core/accounting/README.md](file:///d:/nextjs/erp-application/src/core/accounting/README.md#L1-L63) — 20 hardened invariants

---

## PART 0 — LIVING RULES OF ENGAGEMENT (MANDATORY PRE-READ)

These rules apply to EVERY implementation prompt in this document. If a prompt seems to conflict with these rules, **these rules win**.

### 0.1 Inspection Mandate
Before writing any new code, issue:
```
Grep across src/ for every relevant keyword. Read the touched files, their callers in application/core.ts, the domain types, and the firestore.rules permissions that gate the collection. Do NOT guess at an API.
```

### 0.2 Engine Reuse Mandate
For a financial feature you MUST re-use:
- Posting + Ledger + Double-entry → [voucher.ts](file:///d:/nextjs/erp-application/src/core/accounting/voucher.ts) + [ledger.ts](file:///d:/nextjs/erp-application/src/core/accounting/ledger.ts)
- Money (paise integer) → [money.ts](file:///d:/nextjs/erp-application/src/core/accounting/money.ts)
- FIFO / WAC inventory layers → [inventoryValuation.ts](file:///d:/nextjs/erp-application/src/core/accounting/inventoryValuation.ts) + [valuation.ts](file:///d:/nextjs/erp-application/src/core/accounting/valuation.ts)
- Stock IN/OUT movement atomicity → [inventory.ts](file:///d:/nextjs/erp-application/src/core/accounting/inventory.ts) + [stockOperations.ts](file:///d:/nextjs/erp-application/src/core/accounting/stockOperations.ts)
- GST (CGST/SGST/IGST/cess, composition, RCM, place-of-supply) → [gst.ts](file:///d:/nextjs/erp-application/src/core/accounting/gst.ts)
- Party outstanding + allocation → [party.ts](file:///d:/nextjs/erp-application/src/core/accounting/party.ts) + [partyTransaction.ts](file:///d:/nextjs/erp-application/src/core/accounting/partyTransaction.ts)
- Voucher reversal / cancellation → [voucherReversal.ts](file:///d:/nextjs/erp-application/src/core/accounting/voucherReversal.ts) + [documentCancellation.ts](file:///d:/nextjs/erp-application/src/core/accounting/documentCancellation.ts)
- Authorization (role×permission) → [authorization.ts](file:///d:/nextjs/erp-application/src/core/accounting/authorization.ts)
- Idempotency → [atomic.ts](file:///d:/nextjs/erp-application/src/core/accounting/atomic.ts)
- Firestore transactional repository adapter → [src/infrastructure/firebase/](file:///d:/nextjs/erp-application/src/infrastructure/firebase/) + [firestore.rules](file:///d:/nextjs/erp-application/firestore.rules)
- Application Command orchestration (command → permission → domain) → [src/application/core.ts](file:///d:/nextjs/erp-application/src/application/core.ts#L1-L63)

### 0.3 Module Completeness Contract
A module is DONE only when:
```
☑ UI
☑ Input Validation (domain, not client-only)
☑ Authorization (core/authorization + firestore.rules)
☑ Domain logic (re-use existing engines above)
☑ Persistence (one Firestore transaction across ALL effects)
☑ Accounting (Debit==Credit, voucher immutable after post)
☑ Inventory (if applicable — movement + COGS layer)
☑ Party (if applicable — allocation + outstanding)
☑ GST (if applicable — deterministic gst.ts result)
☑ Audit (auditLogs entry + voucher mutation history)
☑ Lifecycle (draft → posted → cancel/reversal)
☑ Reports (ledger + trial balance + p&l + bs reconcile cleanly)
☑ Error handling (classified errors, UI banner, no silent failures)
☑ Automated tests (vitest; at least happy-path + 2 negative-path)
☑ Type safety (tsconfig strict mode clean)
☑ Lint (eslint.config.mjs clean)
```

### 0.4 File & Layer Access Matrix (READ ONLY FOR EACH LAYER)
| Layer | May Read | May Write |
|-------|----------|-----------|
| UI `src/app/**/page.tsx` + `src/components/**` | Projections, cached optimistic writes | ONLY via `src/application/*` command functions. NEVER call Firestore SDK directly for authoritative writes. |
| API `src/app/api/**/route.ts` | Any domain via repository | Execute Application Command; verify Firebase ID token server-side; check business membership; check permission; pass `ctx`. |
| Application `src/application/**` | Domain exports ONLY | Call domain functions; assemble `CommandContext`; return `CommandResult`. MUST NOT import Firestore SDK directly. |
| Domain `src/core/accounting/**` | Its own pure types + primitives | Its own in-memory repository objects + throws ValidationError/AuthorizationError. MUST NEVER import Firebase/Next/React. |
| Infrastructure `src/infrastructure/firebase/**` | Domain `AccountingRepository` interface | Firestore admin SDK; materialize domain objects from documents; run admin transaction; write auditLogs; NEVER compute business logic. |

---

## PART 1 — PHASE ROADMAP (WITH DEPENDENCY ORDER)
```
Phase 1 (0-3 months) : Table-Stakes Survival Kit
  ├─ Module P1-0  ⮕ TypeScript Strict + JS→TS migration
  ├─ Module P1-1  ⮕ Offline Stack (Firestore Persistence + Dexie Cache + Optimistic Store + Offline Status UI)
  ├─ Module P1-2  ⮕ PDF Invoice Generation (Puppeteer server-rendered, 3 templates)
  ├─ Module P1-3  ⮕ IRP E-Invoicing (IRN + QR) + GSTR-1 JSON Export
  └─ Module P1-4  ⮕ WhatsApp Cloud API + SMS (MSG91) + Dunning Automation

Phase 2 (3-9 months) : Competitive Parity + Vyapaar Beat
  ├─ Module P2-1  ⮕ POS Route (/pos) — Counter Billing Mode
  ├─ Module P2-2  ⮕ PWA + Mobile-First Bottom-Nav UX + Camera Barcode Scanner
  ├─ Module P2-3  ⮕ Bank Statement CSV Import + Fuzzy Auto-Match Reconciliation
  ├─ Module P2-4  ⮕ MSME Section 43B(h) 45-Day Tracker + Statutory Report (Vyapaar beat)
  └─ Module P2-5  ⮕ Document Lifecycle Conversion (SO→DC→Invoice, PO→GRN→PB)

Phase 3 (9-18 months) : Dominance + Better-Than-Tally
  ├─ Module P3-1  ⮕ GSTR-2B Purchase Register Reconciliation (Auto-Match + ITC Mismatch)
  ├─ Module P3-2  ⮕ Barcode Generation + Label Printing (bwip-js + ESC/ZPL)
  ├─ Module P3-3  ⮕ Tally XML Migration Wizard (Masters + Opening Balances + Vouchers)
  └─ Module P3-4  ⮕ CA White-Label Agency SaaS (Sub-Tenant + Usage Billing)
```

### Cross-Cutting Prompts (Apply to EVERY Phase/Module)

#### CROSS-01 — New Domain Entity Bootstrapping Prompt
```text
Task: Add a NEW business entity type <ENTITY_NAME> (e.g. deliveryChallan, grn, ewayBill, msmeTracker, bankStatement, posTransaction, labelPrint, tallyImportBatch, agencyTenant).

Steps:
1. Inspect [src/types/index.ts](file:///d:/nextjs/erp-application/src/types/index.ts), [src/core/accounting/types.ts](file:///d:/nextjs/erp-application/src/core/accounting/types.ts), plus the most analogous existing entity in `src/core/accounting/<existing>.ts` (e.g. for GRN read purchase patterns in [transactions.ts](file:///d:/nextjs/erp-application/src/core/accounting/transactions.ts)).
2. Add a domain type + status enum + validation function in `src/core/accounting/<entity>.ts`. The function must accept Repository + AuthorizationContext, assert role/permission via [authorization.ts](file:///d:/nextjs/erp-application/src/core/accounting/authorization.ts), validate businessId match, validate financialYearId match + unlocked FY per [financialYear.ts](file:///d:/nextjs/erp-application/src/core/accounting/financialYear.ts), and accept an optional idempotencyKey that consults [atomic.ts](file:///d:/nextjs/erp-application/src/core/accounting/atomic.ts).
3. If the entity has accounting effects (e.g. GRN may accrue provision, DC has no accounting but may reserve stock), implement those effects BY CALLING existing domain functions — do NOT duplicate voucher/ledger posting. For a pure logistics document (DC, GRN without bill), write ONLY inventory movements via [inventory.ts](file:///d:/nextjs/erp-application/src/core/accounting/inventory.ts) and reference the downstream bill voucher with a `linkId` field so the lifecycle engine can assemble the chain.
4. Persistence adapter: extend `AccountingRepository` interface in [types.ts](file:///d:/nextjs/erp-application/src/core/accounting/types.ts), implement read/write in [inMemoryRepository.ts](file:///d:/nextjs/erp-application/src/core/accounting/inMemoryRepository.ts) and `firestoreAccountingRepository.ts`.
5. Application command: add one `execute<Entity>(deps,ctx,input)` in the style of [application/core.ts](file:///d:/nextjs/erp-application/src/application/core.ts#L34-L61), mapping permission name correctly.
6. API route: create `src/app/api/<entity-plural>/route.ts` in the style of [dashboard/route.ts](file:///d:/nextjs/erp-application/src/app/api/dashboard/route.ts#L17-L23) `authorize()` block. It MUST: (a) parse Bearer ID token, (b) verify business membership active status, (c) check permission, (d) body validation, (e) delegate to Application Command, (f) catch + re-throw via `normalizeApplicationError`, (g) return `{success:true, value}`.
7. firestore.rules: Add one `match /businesses/{businessId}/<entityPlural>/{entityId}` block in the style of [firestore.rules#L61-L105](file:///d:/nextjs/erp-application/firestore.rules#L61-L105). Create is forbidden from client; only API/admin path may create, since authoritative writes go through server commands. Read permission must match module permission + businessId guard.
8. Module registry: append one entry in [config/moduleRegistry.ts](file:///d:/nextjs/erp-application/src/config/moduleRegistry.ts#L18-L40) with status:"partial" initially, then status:"active" after tests pass; add navigation entry via existing [config/navigation.ts](file:///d:/nextjs/erp-application/src/config/navigation.ts#L1-L26) derivation logic.
9. Tests: Add `src/core/accounting/<entity>.test.ts` with at least: (a) happy path creates entity + inventory/accounting effects, (b) permission denied throws AuthorizationError, (c) locked FY rejects, (d) duplicate idempotencyKey returns same result, (e) cross-businessId read/write rejected.
10. Module audit: Run `npm run test:critical` + `npm run lint` + `npx tsc --noEmit` before claiming done.
```

#### CROSS-02 — UI Page Bootstrapping Prompt
```text
Task: Create a new React client page `src/app/<route>/page.tsx` + `src/components/<Module>/<Module>Page.tsx` for <MODULE_NAME>.

Constraints (MANDATORY):
- MUST use AuthGate + Sidebar + TopNav layout exactly like [DashboardPage.jsx](file:///d:/nextjs/erp-application/src/components/dashboard/DashboardPage.jsx#L64) + [SalesPage.tsx](file:///d:/nextjs/erp-application/src/components/sales/SalesPage.tsx#L103-L105).
- MUST derive permissions from `const {can, hasRole, activeBusinessId} = useBusiness()` (see [BusinessContext.tsx](file:///d:/nextjs/erp-application/src/context/BusinessContext.tsx#L10-L21)).
- MUST NOT compute authoritative totals in the browser. All totals come from an API route that queries the domain via repository + reports engine.
- MUST show an optimistic-write banner (created by `useOfflineStore()` hook) if the user saved while offline; banner MUST show: "Queued locally, will sync when online."
- MUST have a status column using Dashboard's `<Status>` component pattern; green "Posted" only when voucher engine reports status==="posted".
- MUST preserve the MUI/Tailwind palette: accent #465fff (brand blue), success #12b76a, danger #f04438, amber warning #f5b544.

Steps:
1. Read [DashboardPage.jsx](file:///d:/nextjs/erp-application/src/components/dashboard/DashboardPage.jsx#L1-L77) and [SalesPage.tsx](file:///d:/nextjs/erp-application/src/components/sales/SalesPage.tsx#L1-L106) to copy layout + Metric + Status + money formatter.
2. Create `src/app/api/<module>/route.ts` GET handler returning `{success:true, data:<projected-list + totals>}`. Totals must be computed server-side using the reports engine (not iterating on client).
3. If the page creates a transaction: submit POST to the application command API; on success invalidate route cache; if offline enqueue via `useOfflineStore().enqueue(command, input)` — optimistic queue must carry the idempotencyKey to avoid duplication on reconnect.
4. Accessibility: buttons have aria-label, tables have thead/tbody, error banners have role="alert", loading states have aria-busy.
5. Keyboard shortcuts: Ctrl+S triggers save handler by dispatching `busy-soft:save` event (per existing pattern [SalesPage.tsx#L95-L101](file:///d:/nextjs/erp-application/src/components/sales/SalesPage.tsx#L95-L101)).
```

#### CROSS-03 — Test Hardening Prompt (Apply to every new module)
```text
Task: Add hardening tests for <MODULE>.

Add test file `src/core/accounting/__tests__/<module>Hardening.test.ts` with the following cases. Reuse [__tests__/accountingCoreHardening.test.ts](file:///d:/nextjs/erp-application/src/core/accounting/__tests__/accountingCoreHardening.test.ts) pattern + inMemoryRepository adapter:

Cases:
  1. Authorization: non-owner/non-permitted user throws AuthorizationError.
  2. Financial Year lock: posting to locked FY throws.
  3. Idempotency: same idempotencyKey twice returns identical CommandResult, zero additional ledger/stock entries.
  4. Business isolation: userId belongs to business A, cannot mutate business B.
  5. Atomicity: simulate a repo write failure mid-operation — verify there are ZERO half-written ledger entries, stock movements, or voucher fragments.
  6. Accounting balance: totalDebit === totalCredit; trial balance builds clean difference 0.
  7. Inventory reconciliation: stock movements value = inventory GL account delta (for documents with both effects).
  8. Deterministic GST: given same TaxCalculationInput, `calculateTax()` yields identical result twice (regression guard).
  9. Negative stock guard: issue > available throws in FIFO and WAC.
  10. Reverse/cancel flow: posting then voucherReversal yields net 0 effect on all balances.

Run: `npm run test:critical` must include the new test file before merge.
```

---

## PART 2 — PHASE 1 IMPLEMENTATION PROMPTS

### MODULE P1-0: TYPECRIPT STRICT + JS→TS MIGRATION (Week 0, 1 Sprint)
**Prompt for Agent:**
```text
Task: Enable TypeScript strict mode and migrate remaining JS/JSX files to TS/TSX. Must preserve 100% behaviour; no logic changes.

Step 1 — Enable strict:
Edit [tsconfig.json](file:///d:/nextjs/erp-application/tsconfig.json#L17) → change "strict": false to true. Do NOT add "noImplicitAny": false escape hatches globally.

Step 2 — Convert remaining JS/JSX files:
Glob pattern: `src/**/*.{js,jsx}` excluding `node_modules`. Currently includes:
  - [src/app/layout.js](file:///d:/nextjs/erp-application/src/app/layout.js)
  - [src/app/page.js](file:///d:/nextjs/erp-application/src/app/page.js)
  - [src/components/dashboard/DashboardPage.jsx](file:///d:/nextjs/erp-application/src/components/dashboard/DashboardPage.jsx)
  - [src/app/Components/Auth/AuthForm.jsx](file:///d:/nextjs/erp-application/src/app/Components/Auth/AuthForm.jsx)
  - [src/app/Components/Auth/AuthGate.jsx](file:///d:/nextjs/erp-application/src/app/Components/Auth/AuthGate.jsx)
  - [src/lib/firebase.js](file:///d:/nextjs/erp-application/src/lib/firebase.js)
Conversion rule: rename file, add types for function parameters + return values, type hooks properly (`useState<Customer[]>`, `useMemo<number>(()=>...)`), remove any prop drilling that becomes unsafe.

Step 3 — Fix all escape hatches in TS files:
  a) SalesPage `repo: null as never` at [SalesPage.tsx#L89](file:///d:/nextjs/erp-application/src/components/sales/SalesPage.tsx#L89) MUST be replaced by a proper dependency: the page must call a new exported `callSaleCommand({...input})` helper in `src/application/sales/service.ts` which resolves repo + ids + clock from admin, NOT from client.
  b) Any `as any` / `as unknown` / `as never` in src/application, src/app/api, src/components → replace with narrowed typed helpers.
  c) Firestore `doc.data() as Record<string,unknown>` casts are allowed ONLY in map functions (dashboard/route.ts pattern); never flow untyped data into domain functions.

Step 4 — Verify:
Run `npx tsc --noEmit` until 0 errors. Run `npm run lint`. Run `npm run test`.
```

---

### MODULE P1-1: OFFLINE STACK — Firestore Persistence + Dexie + Optimistic UI + TopNav Status
**Prompt for Agent:**
```text
Task: Implement a 4-layer offline stack in 5 working days. NO new accounting engines. All authoritative writes remain server-administered; offline only caches reads and queues commands.

LAYER A — Firestore SDK Offline Persistence (1 day)
Edit [src/lib/firebase.js](file:///d:/nextjs/erp-application/src/lib/firebase.js#L29-L34). After getFirestore() call, add:
  if (typeof window !== "undefined") enableMultiTabIndexedDbPersistence(firestoreDb).catch(err => warn only)
This gives free offline reads for any onSnapshot query. Do NOT remove the server ID-token verification in route handlers.

LAYER B — Dexie IndexedDB OfflineDB (2 days)
Create `src/lib/offline/offlineDb.ts` (new file).
  - Import Dexie (already in phase dependencies).
  - Schema v1 stores PER-USER+PER-BUSINESS by prefixing `{uid}_{businessId}__`:
      + `cachedLists` — primary key [storeKey]; fields {storeKey, items, fetchedAt, etag}
      + `commandQueue` — autoincrement id; fields {id, endpoint, method, body, idempotencyKey, createdAt, retryCount, lastError, status:queued|running|failed}
      + `optimisticRecords` — [businessId, collection, docId]; fields {syntheticDoc, serverDoc, dirty, mergedAt}
  - Exports: offlineDb singleton + helper types.

LAYER C — Optimistic Command Store (1.5 days)
Create `src/lib/offline/optimisticStore.ts` + `src/lib/offline/useOfflineStore.ts` hook.
  - Context provider `<OfflineStoreProvider>` wraps children in layout.
  - API:
    + enqueue(endpoint, method, body, {idempotencyKey, optimisticPatch})
    + onOnline: flush queue in FIFO order with exponential backoff 2s,4s,8s cap 30s.
    + optimisticPatch: a function applied to `optimisticRecords` so UI reads merged view BEFORE server roundtrip.
    + Conflict resolution: LAST-WRITE-WINS by `updatedAt`. If server returns doc newer than optimistic client patch → accept server (Firestore already does timestamp ordering via admin write). Show small orange badge: "Your local edit was overwritten by a newer server change."
  - Inventory-specific: For stock movements, queue must carry `(businessId, itemId, warehouseId, qtyDelta, unitCostHint)` and optimisticPatch modifies `optimisticRecords["stock"]` so low-stock alerts are realistic offline. Recomputation client-side is a projection, NOT authoritative.
  - Integrity guard: any command that would cause negative stock in optimistic view must show a CONFIRM dialog (it's still rejected server-side by inventoryValuation.ts, but user can decide).

LAYER D — Offline Status UI (0.5 days)
Create `src/components/offline/OfflineStatusIndicator.tsx` + integrate into [TopNav.tsx](file:///d:/nextjs/erp-application/src/app/Components/TopNav/page.tsx#L65-L72) to the LEFT of BusinessSelector.
Indicator rules:
  - 🟢 ONLINE (sync idle): green dot, "Sync: up to date" (per existing Sidebar pattern).
  - 🟡 ONLINE (sync flushing): yellow pulse, "Syncing X items…" + progress bar.
  - 🔴 OFFLINE: red dot, "Working offline — X queued changes". Hover tooltip shows queue size + ETA.
  - Click indicator → popover shows queue list + retry button per failed entry + "Force Sync Now".
Create `src/components/offline/OfflineBanner.tsx` that shows a sticky top banner only when offline > 30 seconds; dismissible with localstorage flag, but auto re-appears next session.

Integration: Update [layout.tsx](./src/app/layout.tsx) → wrap children with <OfflineStoreProvider>. Update DashboardPage + SalesPage reads: use `useOfflineStore().getMergedList<T>(storeKey, fallbackFromFetch)` so cached optimistic changes appear instantly.
```

---

### MODULE P1-2: PDF INVOICE GENERATION (Server-Rendered via Puppeteer)
**Prompt for Agent:**
```text
Task: Add 3 production invoice templates + ESC/POS thermal mini-template. Authoritative data from domain reports engine; must not duplicate calculation.

Step 1 — Add Puppeteer dependency (no globals; import in route only).

Step 2 — Build PDF rendering engine at `src/lib/pdf/invoiceRenderer.ts`:
  - Pure function `renderInvoiceToHtml(voucher, templateKey, businessSettings, logoDataUri?)` → HTML string.
  - Data source: voucher + lines MUST come from domain (voucher + ledger lines + party allocation); totals MUST be the same values stored/reported by reports engine. Compute NOTHING in renderer except layout.
  - Three templates:
    1) `professional` — A4, letterhead, GSTIN highlighted, HSN summary table, signature block, bank details, T&Cs.
    2) `retail` — 2-column compact, UPI QR code + "Scan to Pay" overlay.
    3) `minimal` — 1/2 A4, plain, for SMS/WhatsApp delivery.
  - Thermal template `thermal_80mm` — plain text with ESC/POS escape codes for bold/underline/cut; return Buffer, NOT PDF.

Step 3 — Build API route `src/app/api/invoices/[voucherId]/pdf/route.ts` and `/thermal/route.ts`:
  - Auth: authorize() like dashboard. Verify user can view sales.
  - On GET /pdf: call renderInvoiceToHtml → pipe into Puppeteer page.pdf({format:'A4', printBackground:true}) → stream response Content-Type application/pdf.
  - On GET /thermal: return 80mm ESC/POS buffer Content-Type application/vnd.escpos.
  - Caching: ETag by voucherId + voucher.updatedAt; 304 if client has same PDF.

Step 4 — Wire into SalesPage + InvoiceDocument:
  - Add "Download PDF" dropdown (3 templates) + "Print Thermal" button + "Send via WhatsApp" (calls P1-4 helper) + "Send via Email" (uses Resend or SMTP env vars; if not configured show "Configure in Settings").

Step 5 — Tests:
  - Snapshot test: html string output stable for a seeded voucher.
  - Verify: every number on PDF == domain voucher fields (no drift: use exact equality on paise integers).
```

---

### MODULE P1-3: IRP E-INVOICING (IRN + QR) + GSTR-1 JSON EXPORT
**Prompt for Agent:**
```text
Task: Integrate ASP-based e-invoicing for B2B invoices (turnover > ₹5Cr mandate). Use ClearTax / MastersIndia-style REST wrapper. NO new tax calculation — gst.ts is authoritative.

Step 1 — New types & domain entity:
Add `src/core/accounting/eInvoice.ts` (pure logic, no HTTP). Expose:
  - `buildEinvoicePayload(voucher, business, party, items)` — produces valid schema JSON per NIC 1.03. Source every field from domain. Use gst.ts inference for place-of-supply. MUST validate: B2B + taxInvoice + HSN mandatory.
  - `attachIrnResult(voucher, irn, qrBase64, signedInvoice, ackNo, ackDate)` — returns a voucher metadata object; do NOT mutate voucher directly; instead return link doc saved separately under `businesses/{bid}/einvoices/{vid}` so voucher engine remains untouched (correct separation: accounting immutable; IRN is metadata about it).

Step 2 — ASP adapter:
`src/lib/irp/aspClient.ts`:
  - Environment vars: `IRP_BASE_URL`, `IRP_USERNAME`, `IRP_PASSWORD`, `IRP_GSTIN`.
  - Methods: `generateIRN(payload)`, `cancelIRN(irn, reason)`, `printIRN(irn)` — wrap with retries.
  - Sandbox mode: if env not set, behave as stub with deterministic fake IRN ("SANDBOX-"+sha256(payload)).slice(0,64) so tests pass offline.

Step 3 — Application command:
`src/application/commands/issueIrn.ts` → permission SALE_EDIT (owner/admin), asserts FY open, asserts document not already cancelled; calls aspClient.generateIRN then attachIrnResult then repository.saveEinvoiceMeta().

Step 4 — API routes:
POST `/api/accounting/sales/[id]/irn` (trigger generation); DELETE `/irn` (cancel); GET `/irn/qr.png` returns PNG.

Step 5 — Integrate invoice PDF renderer:
If IRN exists → embed QR + IRN + Ack No + Signed Date next to GSTIN block.
Step 6 — GSTR-1 JSON export:
New route GET `/api/reports/gstr-1?period=YYYY-MM`:
  - Build GSTR-1 JSON section-wise (B2B, B2CS, B2CL, Export, CDNR, HSN) by iterating posted vouchers of that FY+month.
  - Every tax field equals gst.ts output from the stored voucher (re-read voucher, call calculateTax on stored input, compare hash to ensure no drift; throw IntegrityError if mismatch).
  - Response: JSON + download filename `GSTR1_GSTIN_YYYYMM.json`.

Step 7 — Tests:
  - Schema validation of buildEinvoicePayload against a snapshot of NIC 1.03 required fields.
  - GSTR-1: if 1 B2B invoice posted for a month, B2B[0] totals match the voucher stored values (paise equality).
```

---

### MODULE P1-4: WHATSAPP CLOUD API + SMS (MSG91) + DUNNING AUTOMATION
**Prompt for Agent:**
```text
Task: Unified notification service + 3-7-15 dunning. Must NEVER expose secrets to client.

Step 1 — Notification abstraction:
`src/lib/notifications/notifier.ts` — export interface Notifier with `sendWhatsApp`, `sendSms`, `sendEmail`. Implement 3 concrete adapters:
  - WhatsAppCloudAdapter: POST https://graph.facebook.com/vXX.0/<WHATSAPP_PHONE_ID>/messages with bearer from env. Supports (a) simple text (b) PDF document via mediaId upload (c) invoice template with parameters.
  - Msg91SmsAdapter: templateId + sender from env. Indian DLT headers. Unicode Hindi support.
  - ResendEmailAdapter (optional): if RESEND_API_KEY present; else stub.
  - ConsoleAdapter (stub fallback): logs instead of sending if the above env not set.

Step 2 — Invoice delivery API:
POST `/api/sales/[id]/send` body: {channels:['whatsapp','sms','email'], phone?, email?}.
Auth: sales create permission.
Flow:
  1) Render PDF (P1-2 engine) → upload to WhatsApp media if channel included → send to customer.phone from party master.
  2) SMS body: "Dear {name}, your Invoice {no} for ₹{amount_inr} is due on {dueDate}. Pay via UPI: {upi_link_id}. — {bizName}"
  3) Persist deliveryAttempt in `businesses/{bid}/notifications/{nid}` so 30 day history shows in customer view.

Step 3 — Dunning automation:
New route POST `/api/reports/run-dunning` (admin/owner). For every customer with outstanding balance > 0:
  - due date < today - 3 days → reminder_3 template SMS + WhatsApp.
  - due date < today - 7 days → reminder_7 + add ₹50 late fee record (as a SEPARATE debit note via domain returns/party engine; do NOT modify original invoice).
  - due date < today - 15 days → reminder_15 + flag in customer master "atRisk": true.
Dunning MUST be idempotent (per customer + bucket) using atomic.ts pattern.

Step 4 — UI in Customers Advanced page:
Per customer: Timeline of sent notifications + "Send Reminder Now" dropdown + "Preview Templates" tab in Settings → Communication.

Step 5 — Tests:
  - Message payloads exactly match DLT-registered template variable count (enforced by placeholder count validation in adapter tests; not runtime since we don't have real DLT API).
  - Dunning idempotency: run twice → one late fee, not two.
```

---

## PART 3 — PHASE 2 IMPLEMENTATION PROMPTS

### MODULE P2-1: POS ROUTE `/pos` (Counter Billing Mode)
**Prompt for Agent:**
```text
Task: Build a full-screen POS mode for retail counter billing. Sales domain engine is 100% reused; only presentation + scanning new.

Step 1 — Route + shell:
Create `src/app/pos/page.tsx` → renders `<PosPage />`. Full screen dark theme; HIDE TopNav/Sidebar (only show a slim top bar with logo, business name, offline status, cashier initials, exit button).

Step 2 — Cart engine (client-side only projection; final post uses domain):
`src/lib/pos/cart.ts` — useState structure:
  Cart = {lines:{itemId, qty, rate, discount, taxRate}[], customerId?, payment:{mode:'cash'|'bank'|'credit'|'upi', tendered, bankId?}}
  Rules: (a) negative qty → return line; (b) per-line + bill discount like SalesPage but without recalculation of authoritative figures until submit.

Step 3 — Scanner input:
`<BarcodeScannerInput>` component — listens to native keyboard (barcode scanners == rapid key presses ending with Enter). Buffer and match against items by ean/sku field (add ean + sku to items if missing — data migration via settings API). Fallback: ZXing-js WASM camera scanner (only when user clicks camera button; never auto-enable camera without user gesture for privacy).

Step 4 — Submit flow:
Click "PAY" → choose payment mode → if cash shows "₹tendered, ₹change" → submit via existing executeSale command + optimistic offline queue. Instant print thermal 80mm (calls P1-2 thermal route). Auto open cash drawer if ESC/POS printer supports it (pulse pin2).

Step 5 — Shift / session tracking (new domain entity):
Use CROSS-01 bootstrapping prompt for `posSession` entity. Fields: {cashierUid, openedAt, openingCashFloat, closedAt?, closingCash?, closingDifference}. Every POS sale carries sessionId. Close shift report = sum sales + expenses paid in cash → should match closing cash. Reconciliation mismatch is logged but never auto-adjusted (owner must journal difference).

Step 6 — Hardening: Keyboard accessibility. Touch-friendly ≥48px buttons. No jank even with 200-item cart.
```

---

### MODULE P2-2: PWA + MOBILE-FIRST UX + CAMERA BARCODE
**Prompt for Agent:**
```text
Task: Installable PWA + bottom navigation on mobile + hardware barcode scanning. Must NOT break desktop layout.

Step 1 — next-pwa:
Add `@ducanh2912/next-pwa` (Next.js 16 compatible) as devDep. Configure in next.config.mjs:
  - dest: "public"
  - register: true
  - skipWaiting: true (only after we have promptForUpdate banner)
  - cache strategies: API routes → NetworkFirst with offline fallback to cache; images → StaleWhileRevalidate; fonts → CacheFirst.
Create `public/manifest.json` → name, short_name, theme_color: "#101828", background_color, icons 192+512 maskable, scope "/", start_url "/", display: "standalone".
Add <link rel=manifest>, meta theme-color in layout.tsx head.

Step 2 — Mobile bottom navigation:
Create `src/components/layout/BottomNavMobile.tsx` — only visible on ≤768px (media query). Icons: Dashboard, Parties, Items, Sales, More (More opens a drawer). Match Sidebar navigation modules.

Step 3 — Mobile-only entry points:
  - Floating action button (FAB) on Sales / Parties pages to add record.
  - Swipe left on any list row → Delete/Cancel/Share quick actions.
  - Native date picker + number inputs (inputMode decimal) in all mobile forms.

Step 4 — Camera barcode:
Page `src/app/scan/route.tsx` → `@zxing/browser` + `@zxing/library`. Scans EAN-13 / QR → redirects to appropriate action (GSTIN → add party; IRN QR → fetch e-invoice details; barcode → open items POS).

Step 5 — Tests: Lighthouse PWA score ≥ 90; offline load for dashboard + invoice list works.
```

---

### MODULE P2-3: BANK STATEMENT CSV IMPORT + FUZZY AUTO-MATCH
**Prompt for Agent:**
```text
Task: Automated bank reconciliation module. Bank statement lines are matched to voucher payments/receipts; unmatched either suggest create or manual reconcile.

Step 1 — Parser:
`src/lib/bankReconciliation/parsers.ts` — export `parseSbiCsv`, `parseHdfcCsv`, `parseIciciCsv`, `parseAxisCsv`, `parseKotakCsv`. Each returns `BankStatementLine[] = {date, description, withdrawal, deposit, balance, instrumentType?, chequeNo?, refNo?}`. Parser MUST tolerate header variations ("Txn Date" vs "Date") using fuzzy column matching.

Step 2 — Matching engine (PURE, testable):
`src/lib/bankReconciliation/matcher.ts`:
Input: (lines:BankStatementLine[], vouchers:Voucher[]). Output: `MatchCandidate[] = {line, voucherIds[], score:0-100, matchType:'exact_amount_date'|'fuzzy_amount_party'|'weak_amount_only', unresolved:true}`.
Rules:
  exact_amount_date: amount matches exactly ± ₹0.01; voucher.date within ±1 day. Score 100.
  fuzzy_amount_party: same amount ± ₹10; voucher.party name fuzzy (Levenshtein similarity ≥ 0.75 with line.description). Score 85.
  weak_amount_only: same amount. Score 60.
User can accept match, reject, or create new payment/receipt directly from the line with one click.

Step 3 — Reconciliation UI:
Route `/reports/bank-reconciliation`. Select bank account + period → side-by-side: LEFT = unmatched statement lines (with match suggestions), RIGHT = unmatched book vouchers → bottom: reconciled table with checkbox. Accepting a match writes a `reconciliation` link entity (use CROSS-01 prompt) but DOES NOT touch ledger entries (link only).

Step 4 — Hardening: Parser must return sensible errors for corrupt CSV; parser must never throw if trailing blank rows exist. Matcher deterministic: same inputs → same output order.
```

---

### MODULE P2-4: MSME SECTION 43B(h) 45-DAY TRACKER + STATUTORY REPORT
**VYAPAAR-BEATING MODULE — High Priority Compliance Differentiator**

**Prompt for Agent:**
```text
Task: Section 43B(h) of Income Tax Act mandates MSME payments within 45 days from GRN OR Bill date whichever is later; if delayed, compound interest @ MSME notified rate (currently ~12% p.a.) applies, and the sum is disallowed as deduction until paid. Your software must track AUTOMATICALLY — neither Vyapaar nor Tally Prime have a reliable out-of-the-box tracker.

Step 1 — Data model:
Add to party master (suppliers) fields: {isMSME: boolean, udyamRegistrationNo?: string, msmeClassification?:'micro'|'small'|'medium'} (via CROSS-01 + migration script). Add `msmeStartDate` (date from which 45-day timer runs; should default to max(purchaseBill.date, grn.receivedAt) — so requires GRN document link from P2-5).

Step 2 — Engine:
`src/core/accounting/msme43B.ts` pure functions:
  - identifyOverdues(purchaseBillsWithAllocations[]) → OverdueRecord[] = {billId, supplier, grnDate, billDate, startDate, dueDate, daysOverdue, principalPending, interestDueCalc(simpleOrCompound), totalPayablePending}.
  - allowedDisallowanceDiff(incomeTaxPeriod) → amount disallowed u/s 43B(h) for tax return.
  - interestLedgerEntrySuggestion(overdueRecord) → returns a `SuggestedJournalEntry` for user to approve (NEVER auto-post; interest must be manually confirmed).

Step 3 — Reports:
New route `/reports/msme-43bh` with:
  - Filter by FY + Classification (Micro/Small/Medium).
  - Table + export CSV.
  - Dashboard KPIs: "Amount at risk of disallowance this year", "MSME payments due in 7 days".
  - Action: "Email reminder to supplier", "Post suggested interest journal".

Step 4 — Hardening tests:
  - Bill dated 1 Apr, GRN 3 Apr → startDate=3 Apr, due=18 May (correct 45-day math).
  - Part payment on 10 May → remaining principal computed correctly, interest applied only on overdue amount from due date onwards.
  - Non-MSME supplier NEVER appears in this report.
```

---

### MODULE P2-5: DOCUMENT LIFECYCLE CONVERSION (SO→DC→INVOICE, PO→GRN→PURCHASE BILL)
**Prompt for Agent:**
```text
Task: Document conversion pipeline. 3-way match for purchases. MUST reuse existing voucher posting for Invoice/PB. MUST NOT duplicate domain logic. Conversion only copies a subset of fields and creates a link entity.

Step 1 — Link entity:
Create `src/core/accounting/documentLinks.ts` (domain entity, use CROSS-01). Type `DocumentLink = {sourceDoc:{type, id, voucherNo}, targetDoc:{type, id, voucherNo}, status:'pending'|'converted'|'cancelled', conversionParams, createdAt}`. Also add `links[]` array field to voucher metadata.

Step 2 — Conversion rules (PURE):
`src/core/accounting/documentConversion.ts`:
  convertSaleOrderToDeliveryChallan(so, {shipDate, warehouse, qtyOverrides?}) → DC draft
    - Copies party, items, qty (allow partial ship: qty < ordered).
    - Does NOT touch accounting; ONLY creates inventory movements of type "reserved → dispatched".
    - Creates documentLink SO→DC.
  convertDeliveryChallanToInvoice(dc, {invoiceDate, finalPrices?}) → calls postSaleEntry() authoritative engine. Final prices override DC unit rates on the invoice (DC is logistics-only; invoice IS accounting authority).
  convertPurchaseOrderToGRN(po, {receivedAt, actualQtyReceived, batchInfo?, expiryDate?}) → GRN
    - Stock IN with batch/expiry via inventoryValuation layers.
  convertGRNToPurchaseBill(grn, {billDate, billNumber, taxesFinal}) → calls postPurchase() authoritative; computes 3-way match diff = PO qty vs GRN qty vs PB billed qty; PO rate vs PB rate; flags variance if > 5% or ₹100; variance alert written to report but NEVER auto-reconciled.

Step 3 — Application commands: `executeConvertDocument(deps,ctx,{fromId,toType,params})`.

Step 4 — UI:
Every document page → top-right "CONVERT TO" dropdown with valid next states. Status ribbon shows "Linked to PO-001, GRN-007, PB-203".
3-way match panel in Purchase Bill: side-by-side PO vs GRN vs PB with green/red per-line variance indicators.

Step 5 — Hardening:
  - Partial conversion of same SO to 3 separate DCs → total shipped never exceeds ordered.
  - Cancelling an invoice created from DC → CANCELS the accounting only; DC itself remains "invoiced (cancelled)" and user can re-convert.
```

---

## PART 4 — PHASE 3 IMPLEMENTATION PROMPTS

### MODULE P3-1: GSTR-2B PURCHASE REGISTER AUTO-RECONCILIATION
**Prompt for Agent:**
```text
Task: GSTR-2B JSON download → auto-match to purchase register → flag ITC mismatches. Biggest pain point for Indian CAs.

Step 1 — ASP downloader:
`src/lib/gstn/gstr2bClient.ts` — download GSTR-2B via authorized ASP API (similar to P1-3 irp pattern). If env vars absent → sandbox allows user to manually upload the GSTR-2B JSON from GST Portal (fallback path works 100% without ASP).

Step 2 — Reconciliation engine:
`src/core/accounting/gstrReconciliation.ts` (PURE, testable):
Input: (gstr2bJson, purchaseBills[]). Output:
  matched: [{billDoc, b2bItem, score:100, i_tax_matched, action:"claim"}]
  rateMismatch: [{billDoc, b2bItem, diff_tax, action:"reject + supplier follow-up"}]
  notIn2B: [{billDoc, reason:"Supplier not filed → ITC blocked"}]
  notInBooks: [{b2bItem, reason:"Supplier filed but bill not in our books → create bill draft"}]
Match key: GSTIN of supplier + Invoice No + Invoice Date.

Step 3 — Actions:
  "Claim ITC" → records ITC eligibility flag on the bill (2B available = claimable in 3B).
  "Provisional claim under Rule 36(4)" → if supplier not filed, user can claim up to a statutory limit; tracked separately.
  "Create purchase draft from 2B" → fills bill form; user clicks save to finalize via postPurchase.

Step 4 — UI: Route `/reports/gstr-2b-recon` with tabs: Matched, Rate Mismatch, Not in 2B, Not in Books. Export Excel.
```

---

### MODULE P3-2: BARCODE GENERATION + LABEL PRINTING
**Prompt for Agent:**
```text
Task: Barcode generation (EAN-13 / Code128 / QR) + label sheet print + ZPL/ESC label printer.

Step 1 — Engine:
`src/lib/barcode/generator.ts` — using `bwip-js` (pure npm). Export `renderBarcodeToPng(type, data, {scale, height})`, `renderLabelPdf(labelConfigs[], sheetFormat)`.

Step 2 — Item master:
Add 3 nullable fields to items: {ean13, upcA, sku}. If ean13 not set, auto-generate a dummy GTIN-13 (00 + 10-digit internal id + check digit) ONLY for internal use, with red warning "DO NOT use externally — purchase official GS1 GTINs for retail sale".

Step 3 — Label sheet templates:
"40x30mm (21-up A4)", "50x25mm (27-up A4)", "Thermal 40x30 roll". Grid layout; each label has: Logo/Name (top), MRP ₹ (big middle), Barcode (bottom), Batch+Expiry (micro).

Step 4 — ZPL/ESC support:
`src/lib/barcode/zplLabel.ts` → output ZPL II string for TSC/Zebra. USB Printer Class via WebUSB if browser supported; fallback: save .zpl file user sends to printer manually.

Step 5 — UI on Items list:
Checkbox multi-select items → "Print Labels" → choose template + preview + print. Stock Transfer page also prints "bin labels" with warehouse location + qty.
```

---

### MODULE P3-3: TALLY XML MIGRATION WIZARD
**Prompt for Agent:**
```text
Task: Import Tally Prime exported data (masters + opening balances + vouchers). Validation + idempotent batch import.

Step 1 — XML Parser:
`src/lib/tally/xmlParser.ts` — fast-xml-parser → JS objects. Support Tally's standard export format for: Groups, Ledgers, Stock Items, Stock Groups, Units, Vouchers (all 18 types: Sales, Purchase, Payment, Receipt, Journal, Contra, Debit Note, Credit Note, Stock Journal, Physical Stock, etc.).

Step 2 — Mapper:
`src/lib/tally/mapper.ts` — maps Tally objects to Busy Soft domain entities. Rules:
  - Tally Cash/Bank ledger → cashBank account with opening balance.
  - Tally Sundry Debtor/Creditor → party with GSTIN parsed from ledger Mailing details.
  - Tally Stock Item → item with opening stock qty + value.
  - Tally Sales Voucher → map to SaleEntryInput then call postSaleEntry() authoritative (domain reuse!). MUST validate totalDebit==totalCredit in Tally XML BEFORE writing anything.

Step 3 — Wizard UI:
`/settings/migration/tally` → Step1 Upload XML → Step2 Preview (counts per type, duplicates flagged, errors listed) → Step3 Mapping corrections (user re-assigns ledgers to accounts) → Step4 Dry Run (simulate, no writes) → Step5 Commit in batched Firestore transactions (100 vouchers per batch with idempotency key per voucher TallyGUID).

Step 4 — Hardening:
  - If any voucher in step 1 fails to parse → abort entire commit, nothing written (atomic per-batch).
  - Import batch entity for audit log: who, when, tallyFileChecksum, counts, errors.
  - Rollback = "Delete import batch" command that reverses every voucher posted in that batch via reversal engine (NOT Firestore delete, since posted vouchers are immutable).
```

---

### MODULE P3-4: CA WHITE-LABEL AGENCY SAAS (SUB-TENANT + USAGE BILLING)
**Prompt for Agent:**
```text
Task: Multi-tenant white-label for Chartered Accountant firms. One agency manages 50+ client businesses. Must preserve strict business isolation; no cross-read.

Step 1 — New top-level collection (outside business subpath):
`/agencies/{agencyId}` — agency name, GSTIN of CA firm, plan, billingCycle, whiteLabel:{brandName, brandLogo, accentColorOverride, domainWhitelist[], customCssUri}.
`/agencies/{aid}/members/{uid}` — staff of CA firm. Has `agencyRole: partner|manager|article`. Can switch into ANY business under that agency with "Impersonate" mode (STRICT: impersonate writes are audit-logged with both UIDs).
`/businesses/{bid}/.agencyId` — optional foreign key. If present, the agency + its members MAY access this business IF business owner enabled the agency linkage via consent invitation flow.

Step 2 — Permission inheritance:
Business member who is also agency member → union of (business permissions) + (agency-assigned role permissions minus USER_MANAGE on business owners).

Step 3 — Billing:
`/agencies/{aid}/usage/{month}` — counters: apiCalls, businessCount, voucherPostedCount, storageBytes. Generate invoice monthly via Stripe. Plan tiers: Starter 25 businesses ₹999/mo, Pro 100 ₹2999, Enterprise 500 custom.

Step 4 — Agency dashboard:
`/agency/portal` — KPIs per client: GSTR filing status, 43B(h) exposure, outstanding, ITC claims, cash position, anomalies (red: negative stock, unbalanced TB, e-invoice overdue). Export "Review Packet" zip per client: TB + PL + BS + party ageing + GSTR1 JSON + GSTR2B recon.

Step 5 — Hardening:
  - Impersonate mode banner MUST always be visible at top with different accent (red) to prevent confusion.
  - businessId isolation: ANY query that doesn't include `where businessId==X` is rejected server-side in repository layer (add guard).
```

---

## PART 5 — SHARED INFRASTRUCTURE & QUICK REFERENCE

### 5.1 Environment Variables Contract
Add these (with .example in repo)
```dotenv
# ---- Firebase ----
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON_BASE64=

# ---- IRP / E-Invoice ASP (ClearTax/MastersIndia) ----
IRP_BASE_URL=
IRP_USERNAME=
IRP_PASSWORD=
IRP_GSTIN=

# ---- WhatsApp Cloud API ----
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_API_VERSION=v20.0

# ---- SMS MSG91 ----
MSG91_SENDER_ID=
MSG91_TEMPLATE_ID_REMINDER_3=
MSG91_TEMPLATE_ID_REMINDER_7=
MSG91_TEMPLATE_ID_REMINDER_15=
MSG91_TEMPLATE_ID_INVOICE_NEW=
MSG91_API_KEY=

# ---- Email (Resend) ----
RESEND_API_KEY=
SMTP_FROM_EMAIL="Ganpati Neer <billing@example.com>"

# ---- Payments (Razorpay / UPI) ----
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
UPI_VPA=

# ---- PWA / Branding ----
NEXT_PUBLIC_BRAND_NAME="Ganpati Neer ERP"
NEXT_PUBLIC_ACCENT="#465fff"
NEXT_PUBLIC_SUPPORT_EMAIL="support@example.com"
```

### 5.2 Firestore Rules Precondition Check Prompt (before any new feature)
```text
Before shipping any new entity collection, run:
1. Write simulation of `firestore.rules` for read/write using Firebase Rules Unit Test library (already pattern in __tests__/firestoreRulesSecurity.test.ts).
2. Verify: an authenticated user from business B CANNOT read or list any document of business A even if they guess the ID.
3. Verify: create/update/delete of authoritative collections is ALWAYS false for client SDK; writes only happen via admin in route handlers.
```

### 5.3 Release Checklist Template
```
Pre-Merge Gate:
  ☐ npx tsc --noEmit                0 errors
  ☐ npm run lint                    0 warnings
  ☐ npm run test:critical           all passed
  ☐ npm run test:coverage           ≥ 80% (domain layer ≥ 90%)
  ☐ npm run build                   success
  ☐ npm run smoke accounting        (see scripts/accounting-smoke.ts)
  ☐ Firestore rules simulation      (__tests__/firestoreRulesSecurity.test.ts)
  ☐ Manual offline smoke            DevTools → Offline + save + online → data persisted
  ☐ Accessibility axe-core scan     dashboard, sales/new, reports/gstr-1
  ☐ Lighthouse PWA (if PWA shipped) score ≥ 90

Post-Merge Gate (staging):
  ☐ Seeded 20-voucher dataset → audit trail complete
  ☐ TB diff = 0, BS diff = 0, inventory diff = 0
  ☐ Idempotency: submit same sale twice → one voucher only
  ☐ Cross-business isolation: User B cannot read Business A data via curl with valid token
```

---

## PART 6 — PROMPT TEMPLATES FOR COMMON ENGINEERING TASKS

### TASK-T01: Fix a bug in existing module
```text
Bug Title: <copy>
Reproduction: <steps>

Apply the Engineering Contract workflow:
1) Reproduce locally; write a failing vitest case FIRST (TDD).
2) Trace root cause through Application → Domain → Infrastructure. Identify exact layer where invariant broke.
3) Fix ONLY the lowest layer that is broken; add defensive asserts at that boundary.
4) Run the failing test → passes. Run full `npm run test:critical` → all green.
5) `tsc --noEmit` + lint.
6) Inspect other callers of the fixed function for same bug pattern.
7) Document: bug cause (2 sentences), fix diff, test added, regressions checked.
```

### TASK-T02: Add a new report (no new transactions)
```text
New Report: <name>

Report generation rule: since reports are PROJECTIONS only, NEVER write voucher or ledger. Steps:
1) Read reports engine in [src/core/accounting/reports.ts](file:///d:/nextjs/erp-application/src/core/accounting/reports.ts).
2) Add a new builder function that takes (accounts, entries, movements, vouchers, filters) and returns typed rows + totals.
3) If report needs a new KPI that requires aggregation across vouchers — write that aggregation PURE (same inputs → same outputs).
4) Expose via new `GET /api/reports/<slug>/route.ts` with authorize pattern.
5) UI page using CROSS-02 prompt.
6) Tests: seeded dataset → rows + totals exact-match snapshot.
```

### TASK-T03: Add new GST tax feature (composition, RCM, TCS, TDS)
```text
New GST Feature: <name>

Flow:
1) Read existing [gst.ts](file:///d:/nextjs/erp-application/src/core/accounting/gst.ts) + [gstPolicy.ts](file:///d:/nextjs/erp-application/src/core/accounting/gstPolicy.ts) + __tests__/gstHardening.
2) Add new classification types. Keep `calculateTax(input)` the single entry point; it MUST remain deterministic.
3) Extend voucher ledger account mapping to include new ledger heads (e.g. TDS Payable, TCS Payable).
4) Extend GSTR-1/P1-3 JSON output if the feature changes statutory reports.
5) Hardening tests: (a) known input → known GST output (IRL examples from GSTN portal), (b) illegal combination throws, (c) invoice print shows the new tax line with correct label.
```

---

## PART 7 — EXECUTION CADENCE (FOR A HUMAN TEAM OR PERSISTENT AGENT)
```
Week 1-2:   P1-0 (TS Strict) + P1-1 (Offline Stack + TopNav status)
Week 3:     P1-2 (PDF Invoices 3 templates)
Week 4:     P1-3 (IRP E-Invoice + GSTR-1 JSON)
Week 5-6:   P1-4 (WhatsApp + SMS + Dunning)
Week 7:     P2-4 (MSME 43B(h)) ← Compliance differentiator, ship this first in Phase 2 for marketing
Week 8-9:   P2-1 (POS Route)
Week 10-11: P2-2 (PWA + Mobile + Barcode)
Week 12-13: P2-5 (Document Conversion)
Week 14-15: P2-3 (Bank Reconciliation)
Month 10:   P3-3 (Tally Migration) ← Needed for serious sales — nobody switches without migration
Month 11:   P3-1 (GSTR-2B Reconciliation)
Month 12:   P3-2 (Barcode + Labels)
Month 13+:  P3-4 (CA White-label) + Enterprise Pilots
```

---

*End of Strategy Document v1.0. Every prompt above MUST be executed under the Absolute Rules of the Master Engineering Execution Contract defined in the user session. When in doubt: inspect, reuse, repair — never rebuild.*
