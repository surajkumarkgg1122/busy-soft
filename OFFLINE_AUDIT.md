# BUSY SOFT — OFFLINE-FIRST / ONLINE-FIRST ARCHITECTURE FORENSIC AUDIT
> Contract: Master Engineering Execution Contract (session)
> Produced: 2026-09-04
> Scope: Architectural audit only. No changes made during this audit.
> Domain Entry: [src/core/accounting/README.md](file:///d:/nextjs/erp-application/src/core/accounting/README.md)
> Repository: `d:\nextjs\erp-application`

---

## A. CURRENT ARCHITECTURE

### A.1 Layered Software Architecture (verified)

```
 ┌───────────────────────────────────────────────────────────────┐
 │ UI Layer: src/app/**/page.tsx + src/components/**             │
 │  (Next.js App Router, React 19, MUI 9, Tailwind 4)            │
 │   ⚠  6 remaining .js/.jsx files (layout.js, page.js,          │
 │      AuthForm, AuthGate, DashboardPage, firebase.js)          │
 │      → strict mode disabled in tsconfig                        │
 └─────────────────────┬─────────────────────────────────────────┘
                       │ HTTP + Bearer Firebase ID token
                       │ (cache:"no-store" everywhere: no client cache)
 ┌─────────────────────▼─────────────────────────────────────────┐
 │ API Server Routes: src/app/api/**/route.ts (nodejs runtime)   │
 │  ├─ Token verification + active membership check             │
 │  ├─ Permission assertion (role === owner/admin                │
 │    || permissions[module].action === true)                    │
 │  ├─ Application Command dispatch                             │
 └─────────────────────┬─────────────────────────────────────────┘
                       │ TrustedCommandContext { businessId,
                       │   userId, financialYearId, idempotencyKey,
                       │   permissions[] }
 ┌─────────────────────▼─────────────────────────────────────────┐
 │ Application Layer: src/application/**                         │
 │   core.ts: execute{Sale,Purchase,Expense,Receipt,Payment}()   │
 │   * Single canonical command per transaction                  │
 │   * assertTrustedContext → assertTrustedPostingBoundary       │
 │   *   → assertAuthorized(permission)                          │
 │   context.ts: TrustedCommandContext definition (16-128 idem.) │
 │   errors.ts: normalizeApplicationError                        │
 │   index.ts: barrel export                                     │
 └─────────────────────┬─────────────────────────────────────────┘
                       │ invoke `postSaleEntry` / `postPurchase` /
                       │ `postExpenseEntry` / settlements.* etc.
                       │ with AccountingRepository abstraction
 ┌─────────────────────▼─────────────────────────────────────────┐
 │ Domain Layer: src/core/accounting/**                          │
 │   ┌─────────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────┐  │
 │   │ voucher.ts  │ │ transactions │ │ gst.ts   │ │party.ts  │  │
 │   │ post+revers.│ │ sales/purch. │ │ determin.│ │ allocat. │  │
 │   └─────┬───────┘ └──────┬───────┘ └────┬─────┘ └────┬─────┘  │
 │         │                │               │             │       │
 │   ledger.ts (balance)  inventory*.ts   settlements  returns.ts│
 │   atomic.ts (idempotent voucher posting)                     │
 │   idempotency.ts (SHA-256 fingerprint on normalized payload) │
 │   financialYear.ts (FY resolver + assert date in FY)         │
 │   authorization.ts (32 permissions × 5 roles)                │
 │   reports.ts (pure TB/PL/BS/Reconciliation builders)         │
 │   manufacturing* / stockOps / inventoryValuation FIFO-WAC    │
 │   cashBank*.ts / expenseEntry / documentLifecycle            │
 │   integrityChecker.ts (TB diff + BS diff + inventory↔GL)     │
 │   trust: NO Firebase/Next/React imports here. PURE domain.   │
 └─────────────────────┬─────────────────────────────────────────┘
                       │ AccountingRepository interface
                       │  (see types.ts: runInTransaction +
                       │   14 getXxx + 12 saveXxx methods +
                       │   allocateVoucherNumber)
 ┌─────────────────────▼─────────────────────────────────────────┐
 │ Infrastructure / Persistence Layer                            │
 │  2 implementations of AccountingRepository, 1 in-memory test  │
 │  ┌────────────────────────────────────────────────────────┐  │
 │  │ Admin Firestore Adapter (server-side, firebase-admin)  │  │
 │  │ [adminAccountingRepository.ts]                         │  │
 │  │ ─> db.runTransaction(raw => AdminAccountingTx)        │  │
 │  │ ─> allocateVoucherNumber updates                       │  │
 │  │      `businesses/{bid}/voucherSequences/{fy}_{type}`   │  │
 │  │      atomically inside the admin tx                    │  │
 │  │ ─> getBusinessDocument scopes by `name` regex          │  │
 │  │      [A-Za-z0-9_-]{1,64} (defense against injections) │  │
 │  └────────────────────────────────────────────────────────┘  │
 │  ┌────────────────────────────────────────────────────────┐  │
 │  │ Client Firestore Adapter (browser firebase/firestore)  │  │
 │  │ [firestoreAccountingRepository.ts]                     │  │
 │  │ ─> Uses firebase/firestore runTransaction              │  │
 │  │ ─> Currently only used by settings/users [userId]/page │  │
 │  │      where direct client batch writes to members/*     │  │
 │  │      & businessMemberships/* via writeBatch(firestoreDb)│ │
 │  └────────────────────────────────────────────────────────┘  │
 │  ┌────────────────────────────────────────────────────────┐  │
 │  │ In-Memory Adapter (Vitest only)                        │  │
 │  │ [inMemoryRepository.ts]                                │  │
 │  │ ─> snapshot-rollback transactions via Map+promise-queue│  │
 │  │ ─> used by ALL hardening tests (30+ .test.ts files)    │  │
 │  └────────────────────────────────────────────────────────┘  │
 └───────────────────────────────────────────────────────────────┘
                        │ Firestore Rules gate
 ┌──────────────────────▼────────────────────────────────────────┐
 │ Data Layer: Firestore Collections Schema                     │
 │   /users/{uid}/businessMemberships/{bid}                      │
 │   /businesses/{bid}/                                          │
 │     ├─ members/{uid}                                          │
 │     ├─ financialYears/{fyid}                                  │
 │     ├─ voucherSequences/{fyid}_{type} ← SEQ ALLOCATION POINT │
 │     ├─ accounts/{acid}                                        │
 │     ├─ parties/{pid}                                          │
 │     ├─ items/{itemid}                                         │
 │     ├─ vouchers/{vchid}     ← AUTHORITATIVE DOCUMENT        │
 │     ├─ voucherLines/{lineid}                                  │
 │     ├─ ledgerEntries/{lineid} ← PROJECTED FROM VOUCHER       │
 │     ├─ stockMovements/{mvid}                                  │
 │     ├─ partyAllocations/{allid}                               │
 │     ├─ returnDocuments/{retid}                                │
 │     ├─ accountingDocuments/{docid}  ← idempotency lookup     │
 │     ├─ auditLogs/{evtid}                                      │
 │     └─ parties/ items/ bankAccounts/ etc. (masters, settings)│
 └───────────────────────────────────────────────────────────────┘

### A.2 Authoritative Data Chain
1. `Voucher` + `VoucherLine` in transaction → AUTHORITATIVE
2. `LedgerEntry[]` (same content + financialYearId + voucher metadata) → PROJECTED DERIVED
3. `StockMovement[]` → AUTHORITATIVE (must equal voucher inventory accounting)
4. `PartyAllocation[]` → AUTHORITATIVE metadata (cross-voucher settlement)
5. All reports (TB, PL, BS, party statements, inventory, GST) are **pure aggregation rebuilds over these 4 + accounts + financial year.**

**KEY FINDING A.2a:** There are NO precomputed balance summary documents (no "accountBalances", no "partyBalances"). Every report is an on-demand aggregation projection. This is a **critical architectural advantage for offline sync** because projections are deterministic — we can always rebuild them locally if we have the authoritative docs.

### A.3 Deployment Target
- `next dev/build/start` only. `package.json` [scripts](file:///d:/nextjs/erp-application/package.json#L5-L14) reveal no Electron, no Tauri, no Capacitor, no React Native.
- Strict Vercel/Node.js server runtime only (see `runtime="nodejs"` in [sales/route.ts](file:///d:/nextjs/erp-application/src/app/api/accounting/sales/route.ts#L8)).

---

## B. EXISTING OFFLINE CAPABILITIES

| Capability | Status | Location | Evidence |
|---|---|---|---|
| Firebase Auth session persistence | ✅ | [firebase.js#L31-L35](file:///d:/nextjs/erp-application/src/lib/firebase.js#L31-L35) | `setPersistence(firebaseAuth, browserLocalPersistence)` → user stays signed in across browser restarts even without network |
| UI state survival across navigation | ⚠ Partial (client hooks only) | pages `useState` | All list data is fetched per-page with `cache:"no-store"` in [BusinessContext.request()](file:///d:/nextjs/erp-application/src/context/BusinessContext.tsx#L14). No on-disk caching → navigating back to dashboard requires network. |
| Offline navigation (route cache) | ✅ | Next 16 App Router default | Static/Shared layout chunks cached by Next. Pages that rendered at least once may open without network but **data cells show skeleton/error**. |
| Active business preference persistence | ✅ | [BusinessContext.tsx#L12](file:///d:/nextjs/erp-application/src/context/BusinessContext.tsx#L12) `localStorage.setItem("erp.activeBusinessId")` | Survives refresh. |
| Sidebar collapsed state persistence | ✅ | [Sidebar/page.tsx#L56](file:///d:/nextjs/erp-application/src/app/Components/Sidebar/page.tsx#L56) | `erp.sidebar.collapsed`. |
| Firestore client offline cache | ❌ **NOT ENABLED** | [firebase.js](file:///d:/nextjs/erp-application/src/lib/firebase.js#L1-L35) | No call to `enableIndexedDbPersistence(db)` or `enableMultiTabIndexedDbPersistence(db)`. |
| Offline command queue | ❌ ABSENT | n/a | Any POST that fails is lost. No retry queue. No idempotency key preservation across restart. |
| Optimistic UI updates | ❌ ABSENT | n/a | UI shows loading spinner → server success → re-fetch list. No optimistic insert. |
| Connectivity detection | ❌ RELIES ON BROWSER DEFAULT ONLY | n/a | No explicit checks against server liveness endpoint, no `navigator.onLine` listeners. |
| Sync status UI | ❌ ABSENT | [TopNav/page.tsx](file:///d:/nextjs/erp-application/src/app/Components/TopNav/page.tsx), [Sidebar/page.tsx](file:///d:/nextjs/erp-application/src/app/Components/Sidebar/page.tsx) | No component shows "synced" / "syncing" / "offline X pending". |

**Findings B.1:** The only offline persistence is Firebase auth + 2 user preferences. All authoritative reads and writes are **strictly network-required on every call**.

---

## C. EXISTING SQLITE CAPABILITIES

| Item | Finding |
|---|---|
| SQLite package installed | ❌ None. No `better-sqlite3`, `sql.js`, `expo-sqlite`, `@sqlite.org/sqlite-wasm`. |
| Electron present | ❌ No `electron*` / `tauri*` / `capacitor` packages in [package.json](file:///d:/nextjs/erp-application/package.json#L15-L37). Grep confirmed 0 results. |
| IndexedDB / Dexie installed | ✅ `dexie@^4.4.5` + `dexie-react-hooks@^4.4.0` installed, but **0 code files import Dexie** (grep: only package.json/package-lock/EXECUTION_STRATEGY.md hit). Packages are **declared but unused wiring stubs**. |
| localStorage volume used | 2 keys only: `erp.activeBusinessId`, `erp.sidebar.collapsed`. No data caching in localStorage. |
| SessionStorage usage | 0 references. |
| OPFS (origin-private-file-system) | 0 references. |

**Conclusions C.1:**
- **NO durable offline transaction database exists.**
- **SQLite-as-a-browser-library (sql.js / SQLite Wasm) is architecturally feasible** since project is pure Next.js serverless web stack. However browser SQLite/WASM is **tab-sandboxed and not guaranteed durable** (storage quotas, user can clear, some private modes wipe).
- **For true durable local-first SQLite, an Electron or Tauri shell shell is required**, but the current deployment target is 100% Next.js/Node.js/Vercel serverless.
- **Recommended pragmatic path:** Use **Dexie.js + IndexedDB** (not raw SQLite) as the browser offline cache for **projections + command queue**, and keep **Firestore + Admin SDK** as the cloud authority. For a future Desktop SKU, introduce Tauri later with rusqlite/`sqlite3` crate.

---

## D. EXISTING SYNC CAPABILITIES

| Dimension | Finding |
|---|---|
| Inbound (cloud → browser) cache | ❌ None. Every list fetch is a fresh server fetch. |
| Outbound (browser → cloud) queue | ❌ None. `fetch(request, ... cache:"no-store")` only. |
| Conflict detection | ❌ None. |
| Conflict resolution | ❌ None. |
| Device ID | ❌ None. No stable per-device UUID stored. |
| Sync metadata | ❌ No `sync_status`, no `server_updated_at`, no `local_updated_at`. |
| Ordering guarantees | ⚠ **Admin-only**: voucher number allocation in [adminAccountingRepository.ts#L25](file:///d:/nextjs/erp-application/src/infrastructure/firebase/adminAccountingRepository.ts#L25) is transactionally serialized by Firestore admin tx. This means **server ordering of authoritative numbers is guaranteed** — but offline devices cannot produce authoritative numbers (see §9 Numbering Audit). |
| Server ACK | ✅ HTTP 200 `{success:true, result}` with `CommandResult.value` + `CommandResult.idempotencyKey` from [application/core.ts#L13](file:///d:/nextjs/erp-application/src/application/core.ts#L13). |
| Automatic retries after timeout | ❌ None. User must resubmit manually (risk of double-posting despite server idempotency). |
| Crash recovery for sync state | ❌ N/A — there is no sync state. |
| Multi-device eventual convergence | ❌ None. Without Firestore multi-tab persistence or a sync engine, 2 open tabs already drift apart in memory only. |

---

## E. WHAT CAN BE REUSED

### E.1 Domain Engines — 100% REUSABLE OFFLINE
The entire `src/core/accounting/**` package:
- Zero imports from Firebase/Next/React/anything platform.
- Accepts any `AccountingRepository` implementation → we can build a **Dexie-backed AccountingRepository** for offline use **without touching a single line of domain code.**
- Specifically reusable:
  - Posting: [voucher.ts](file:///d:/nextjs/erp-application/src/core/accounting/voucher.ts#L8), [atomic.ts](file:///d:/nextjs/erp-application/src/core/accounting/atomic.ts#L6-L28)
  - Reversal: [voucher.ts#L9](file:///d:/nextjs/erp-application/src/core/accounting/voucher.ts#L9)
  - Double-entry validation: [ledger.ts#L6-L8](file:///d:/nextjs/erp-application/src/core/accounting/ledger.ts#L6-L8)
  - Transactions (Sale/Purchase/Expense/Settlement): [transactions.ts](file:///d:/nextjs/erp-application/src/core/accounting/transactions.ts#L12-L32)
  - Idempotency SHA-256 fingerprint: [idempotency.ts](file:///d:/nextjs/erp-application/src/core/accounting/idempotency.ts#L23-L57)
  - Inventory FIFO/WAC: [inventoryValuation.ts](file:///d:/nextjs/erp-application/src/core/accounting/inventoryValuation.ts)
  - GST deterministic calc: [gst.ts](file:///d:/nextjs/erp-application/src/core/accounting/gst.ts)
  - Party allocation + reconciliation: [party.ts](file:///d:/nextjs/erp-application/src/core/accounting/party.ts#L52-L68)
  - Reports (pure projection builders): [reports.ts](file:///d:/nextjs/erp-application/src/core/accounting/reports.ts#L15-L22)

### E.2 Application Commands — 100% REUSABLE OFFLINE
- `ApplicationDeps = { repo, ids, clock }` only → swap Dexie repo for offline runs → **exact same code path online vs offline**.
- Permission → authorization check: offline can re-use `assertAuthorized(ctx, permission)` against cached membership (need a cached Permission snapshot, see §11).

### E.3 Idempotency Engine — 100% REUSABLE
- Existing server flow: `getVoucherByIdempotencyKey → (exists ? replay result : postVoucher)`. This exact flow works on Dexie offline.
- Offline command MUST carry the **same idempotencyKey it would send to server**. When syncing, if offline already posted locally, the server will see the key and return the same replay-safe `CommandResult`. No double-posting.

### E.4 Repository Interface — 100% REUSABLE
- The `AccountingRepository` + `AccountingTransaction` interfaces defined at [types.ts#L12-L13](file:///d:/nextjs/erp-application/src/core/accounting/types.ts#L12-L13) can be implemented by Dexie (IndexedDB). We already have 2 proven implementations (Firestore admin, client, InMemory). A 3rd (Dexie) is purely mechanical.

### E.5 Firestore Rules Business Isolation — REUSABLE VERBATIM
- All 20 domain invariants hold whether data is stored in Firestore or IndexedDB. The rules engine only needs a **Dexie equivalent at the repository wrapper layer** (assert `entity.businessId === activeBusinessId` on every save; we already do this in adminAccountingRepository — same guard can be added to Dexie adapter).

### E.6 Hardening Tests — 90% REUSABLE
- All `src/core/accounting/__tests__/*.test.ts` currently use `InMemoryAccountingRepository`. We can introduce a test parameterization that runs the EXACT same test suite against a `DexieAccountingRepository` (via vitest workspace or an abstraction) to gain offline persistence correctness for free.

### E.7 Voucher Sequence Allocation — REUSABLE AS-A-SERVICE ONLY
- AllocateVoucherNumber MUST remain server-administered. Offline cannot. However the server-allocation HTTP endpoint can be **refactored from a method inside repository transaction into a dedicated idempotent `/api/accounting/sequences/next` route**. Offline requests it in advance to reserve numbers (see §9).

---

## F. WHAT IS MISSING

### F.1 Layer 1: Persistence Primitives
1. **`AccountingRepository` implementation over Dexie/IndexedDB** — missing, must be created.
2. **Server vs Offline repository factory selector** (`createAccountingRepository(adapter: 'admin' | 'client' | 'dexie' | 'memory')`) — missing.
3. **Master data cache hydrator** (download initial snapshot of parties/items/accounts/settings/FYs into Dexie) — missing.
4. **Incremental sync watcher** listening to Firestore `onSnapshot` for masters + recent vouchers, writing to Dexie cache.

### F.2 Layer 2: Sync Engine
5. **Durable sync queue** (Dexie table + retry worker).
6. **Sync status state machine**: PENDING → SYNCING → {SYNCED, FAILED, CONFLICT, BLOCKED} (§5).
7. **Device ID** (stable UUID in localStorage/IndexedDB at first app open).
8. **Connectivity state machine** with heartbeat: NETWORK_UNKNOWN, ONLINE, OFFLINE, SERVER_UNREACHABLE, SYNCING.
9. **Dependency ordering** before sync: (Party) → (Item) → (Voucher that refers to both) → (Payment against voucher).

### F.3 Layer 3: Lifecycle + Numbering
10. **Extended offline voucher lifecycle**: DRAFT → VALIDATED → **LOCAL_COMMITTED** → SYNC_PENDING → SYNCING → SERVER_VALIDATED → **SERVER_COMMITTED (AUTHORITATIVE)** → SYNCED. Current lifecycle stops at draft/validated/posted/cancelled.
11. **Temporary device-local display numbers** pattern + reconciliation after server assigns authoritative numbers.
12. **Number reservation HTTP endpoint**: allow offline devices to reserve a block of N voucher numbers from server sequence (in a single Firestore transaction that bumps `nextNumber` by N) when network is available.

### F.4 Layer 4: Conflict Resolution
13. **Conflict detection strategy**: compare `(serverUpdatedAt, localUpdatedAt, entityType, fieldMask)` — missing.
14. **Merge rules per entity-class** (§7: Masters vs Drafts vs Posted vs Stock vs Accounting vs Config).

### F.5 Layer 5: Authorization Offline
15. **Permission + role cache TTL**: Store `membership snapshot` (role + permissions map) encrypted in Dexie with `cachedAt:iso, expiresAt:iso`. Expiry = 24h. If expired and offline → allow "view only" on already cached data; reject new writes with `BLOCKED: authorization cache expired`.
16. **Server-side re-validation** of every command on sync, EVEN if offline accepted it. (This already exists in API routes; nothing to add, but must not be removed.)

### F.6 Layer 6: UI Components
17. **Global sync state store** (React context + Dexie listener). One source of truth, consumed by Sidebar Status + Sync Center panel.
18. **Sidebar sync indicator** (§17).
19. **Sync Center modal** (§18).
20. **LOCAL / PENDING vs SERVER CONFIRMED badges** on list rows and voucher detail screens (§21).
21. **Dashboard KPIs dual labels**: "Local (includes pending)" badge next to each KPI.

### F.7 Layer 7: Tests
22. Offline test harness simulating: browser restart, network toggle, duplicate retry, concurrent multi-tab, conflict, queue size 100+, IndexedDB quota exceeded, DB corruption seed + recovery.

---

## G. CRITICAL ARCHITECTURAL RISKS

| # | Risk | Impact | Likelihood | Mitigation Strategy |
|---|---|---|---|---|
| G.1 | **Browser storage eviction**. IndexedDB storage quota varies (Chrome = ~6% disk, Firefox = ~10%, Safari = ~1GB cap). User can "Clear site data" which wipes offline transactions irrecoverably. | DATA LOSS of unsynced transactions → financial → **High** | Medium | (1) Warn user prominently before storage is full; (2) Aggressively sync whenever online; (3) Offer export-queue-as-JSON backup before wipe; (4) For serious desktop use later, ship Tauri/Electron with real SQLite file the user explicitly backs up. **Most importantly, SQLite as a web-WASM is NOT durable.** Use Dexie/IndexedDB as cache-only and tell users "un-synced data may be lost if browser storage is cleared." |
| G.2 | **Two offline devices create conflicting offline postings with same local number.** Without pre-reservation, both devices use INV-2024-00042 locally. When they sync, server resolves to different numbers, confusing users who emailed the PDF. | UX DISASTER → **High** | High (multi-device scenario) | §9 — pre-reserve blocks of authoritative numbers from server sequence endpoint; if device has no reservation, show UGLY non-final display numbers like `DEV-{UUID_SHORT}-PENDING` that nobody would mistake for a real invoice number. Final authoritative number applied at SERVER_COMMITTED. |
| G.3 | **Offline creates a sale referencing a party master that another device deleted.** Offline has stale party master → sync → server rejects. | Correct server behaviour, but **confusing user outcome** | Medium | §7 Master conflict resolution: party deletion is SOFT (status=inactive), not hard delete. Sale referencing an inactive party still syncs (accounting must be complete), but shows warning "Customer X was archived on another device — review." |
| G.4 | **Offline `postVoucher` passes validation → server rejects for concurrent sequence/fy-lock/permission change.** → local state already advanced to LOCAL_COMMITTED with optimistic UI. | User sees invoice was "created" then disappears/marked blocked. **Financial confusion** | Low-Medium | §8 Lifecycle: upon server failure, transition from **SYNCING → BLOCKED with server error**, keep local data intact so user can edit. **Never silently delete an offline transaction because the server rejected it.** |
| G.5 | **Firebase Auth token expired + offline.** User cannot refresh ID token without network → BizContext `authHeaders()` will throw in 1 hour (default token TTL). Business app essentially useless beyond viewing cached data. | ACCEPTABLE. Never allow offline new transactions when auth is unverifiable for > 24h. This is a security boundary. | High certainty / expected behaviour | §11 Offline Auth: keep 24h hard cutoff after last successful `/api/profile` call. |
| G.6 | **Optimistic local projections diverge from server.** Reports engine locally re-runs over "LOCAL_COMMITTED + SERVER_CONFIRMED" docs → user sees different numbers on different tabs. | Confusion (NOT accounting risk, since authoritative=server) | Medium | §21 Reporting: Always show 2 badges per KPI if divergence exists. Banner on dashboard when offline state is present. Always add `[LOCAL PENDING] watermark` to PDF printed when offline. |
| G.7 | **Dual AccountingRepository drift between Firestore admin implementation vs Dexie implementation.** If methods behave slightly differently (e.g. ordering, sequence allocation side-effects), subtle bugs occur only offline. | Integrity bugs offline → data loss/inaccuracy on sync | Medium-Low | §E.6: Parameterize the entire hardening test suite to run against BOTH adapters. Zero divergence is contract-enforced by tests. |

---

## H. ACCOUNTING RISKS

### H.1 Risk: Offline Domain Validation Runs Against Stale Master Data
Accounting domain performs runtime lookups:
```
postPurchase → tx.getBusinessDocument("parties", supplierId)
```
If offline cache has a stale party master (e.g. status=active, but server already archived), offline will post successfully, server rejects during sync → blocked doc.

**Severity:** Medium.
**Resolution:** On sync, server re-runs the exact same `postPurchase` code path against real masters. **Offline "posted" vouchers are ALWAYS provisional.** The only AUTHORITATIVE voucher is a voucher that reached `SERVER_COMMITTED`. Name states unambiguously: see §8.

### H.2 Risk: Duplicate Voucher Effects After Retry + Connection Loss
Scenario: Client sends Sale POST → server commits → HTTP response dropped on network timeout → client thinks "failed" → enqueues retry → server idempotency returns same result. **This case is ALREADY handled correctly** by the existing `postIdempotentVoucher` in [atomic.ts](file:///d:/nextjs/erp-application/src/core/accounting/atomic.ts#L6-L28).

**Severity: Low — mitigated by existing architecture.**
**Still needed:** Enforce that the sync worker ALWAYS uses the same original idempotencyKey of the operation. Never generate a new key on retry.

### H.3 Risk: Inventory Negative Stock Offline, Server Has Different Stock
The negative-stock guard in inventoryValuation guards only on `StockMovement[]` currently visible. If device A (offline) has 10 qty cached, device B (online) sold 8 → B's sale is server authoritative → A's offline sale for 4 passes locally but fails server-side.

**Severity:** Medium (correct server rejection, but user invoice is BLOCKED).
**Resolution:** §7 Stock: on sync, server re-validates; on BLOCKED status, UI shows cause: "Not enough stock (sold on another device)." This is CORRECT inventory semantics. Also, when online, we pre-flush cache with server snapshot before accepting new transactions.

### H.4 Risk: Ledger Projection Offline Differs From Server (Replay Order)
Reports are pure aggregation over LedgerEntry[] sorted by date/voucherId — not dependent on insertion order.

**Severity: Zero. Pure aggregation is order-invariant.**
Confirmed in [reports.ts buildTrialBalance](file:///d:/nextjs/erp-application/src/core/accounting/reports.ts#L15) uses filter+reduce.

### H.5 Risk: Double Allocation of Voucher Numbers in Two Tabs
Current allocateVoucherNumber admin-in-tx is serialized by Firestore transaction → **zero risk server-side.** Offline risk is §9 / G.2 mitigation via reservation endpoint.

---

## I. INVENTORY RISKS

| # | Risk | Why Serious | Mitigation |
|---|---|---|---|
| I.1 | FIFO layer mismatch between offline and server. When Device A does a FIFO issue offline, Device B also issues against same layers → server re-issue from merged layers will pick different COGS lines than offline. → Offline COGS ≠ Server COGS → P&L discrepancy. | Inventory value in financial statements must reconcile. | **Offline FIFO issue is always provisional.** At SERVER_VALIDATED, server re-runs `inventoryValuation.issueStockLayers()` against the authoritative movement timeline. The provisional layers in client Dexie are OVERWRITTEN with server returned COGS references. UI reflects correction as non-destructive reconciliation note. |
| I.2 | Serial number double-claim. Device A claims serial S/N-42 offline. Device B claims same via online → server wins claim → A blocked. | Audit/serial/regulatory failure for pharma/electronics. | Server re-validates in `buildSerialStock` path → on conflict, BLOCK with message "Serial X already received on [date] via voucher Y". |
| I.3 | Expired batch sold offline. Batch expiry is state on server that offline cache missed. | FMCG/pharma non-compliance. | Periodic cache refresh of master+batches; on sync, server re-validates expiry flag. If violated: BLOCK with explicit reason, never auto-unbatch. |
| I.4 | Multi-warehouse transfer race. Two devices simultaneously create Transfer from WH-A → WH-B. | Double-spend. | Transfer creates paired OUT then IN movement. Server must atomically check both warehouses, server always wins. Offline provisional only. |

---

## J. SECURITY RISKS

### J.1 Offline Permission Bypass
Offline: Authorization is enforced against **cached membership snapshot**. If admin demotes a user from owner→staff on another device, user's offline cache still has the old permission map.

**Risk rating: Medium** → user can temporarily "self-authorize" offline.
**Mitigations (ALL required together):**
1. Max TTL 24h on permission cache. Past expiry, no new writes.
2. On sync, server ALWAYS re-checks authorization. If offline write was later revoked at sync time → BLOCK. Audit log created.
3. 15-min heartbeat `POST /api/heartbeat` that refreshes cache. If network available for 15 min+ cache always fresh.
4. Sensitive permissions (USER_MANAGE, FY_LOCK, ROLE_CHANGE) are never allowed offline. Whitelist of offline-allowed commands only: [SALE_CREATE, PURCHASE_CREATE, EXPENSE_CREATE, PAYMENT_CREATE, RECEIPT_CREATE, RETURN_CREATE, JOURNAL_CREATE, MASTER_EDIT_PARTY, MASTER_EDIT_ITEM].

### J.2 Cross-Business Leak in Dexie
Offline Database stores data for `(userId, businessId)`. If user switches business, cached data from Business A must not be readable in Business B context.

**Mitigations:**
1. Every Dexie table has compound `[userId+businessId]` prefix in its key, OR separate Dexie databases per `{uid}_{bid}`.
2. Dexie adapter has the same `businessId` guard as `adminAccountingRepository`: every save operation must fail `if (entity.businessId !== this.businessId) throw ValidationError("business mismatch")`. (Already implemented in Firestore adapters; 100% copy-paste into new Dexie adapter.)

### J.3 Sensitive Data in IndexedDB
Party GSTINs, phone numbers, bank account numbers, full ledger are ALL persisted in cleartext in IndexedDB. **Browser IndexedDB is readable with DevTools.** Same risk as any SPA — data is accessible via DevTools regardless.

**Mitigations (non-negotiable for Enterprise SKU):**
1. Add a master-password WebCrypto AES-GCM wrapper around the Dexie DB. User must enter PIN once per session. Entries in IndexedDB are ciphertext. Only unlocked during session in-memory. (Acceptable UX if it's optional: "Local Encryption" toggle under Settings.)
2. Never store Firebase ID token refresh token in Dexie. Use only built-in browserLocalPersistence Firebase manages. Never cache raw `Authorization: Bearer ...` in Dexie.

### J.4 Server Replay with Stolen Idempotency Key
Idempotency key is stored client-side. If stolen, can attacker replay to retrieve the existing voucher result?

**Mitigation ALREADY EXISTS:** `atomic.ts` looks up by `(businessId, financialYearId, idempotencyKey)`. Route handler re-verifies business membership before handing the result back. Even if an attacker has the key, they cannot read data across businesses. Additionally, `idempotency.fingerprint(payload)` assertion ensures the same key cannot be reused for materially different transactions (see [idempotency.ts#L52-L56](file:///d:/nextjs/erp-application/src/core/accounting/idempotency.ts#L52-L56)).

---

## K. SYNC / CONCURRENCY RISKS

| # | Scenario | Outcome if Unmitigated | Correct Resolution |
|---|---|---|---|
| K.1 | Same offline command sent TWICE (network flips) | Server de-dupes via idempotency → ✅ safe | Ensure sync worker: same `operationId` NEVER leaves queue twice in-flight. Server layer MUST remain final idempotency arbiter. |
| K.2 | Two devices edit the SAME party master address fields. | Data loss with LWW on whole doc | §7 Masters → Field-level merge with `updatedAt per field`. Address.line1 vs gstin vs phone updated independently. gstin changes require SERVER confirmation because tax regime changes are too dangerous for offline merge. |
| K.3 | User opens app on Device A, makes sale offline; then opens Device B (desktop) with SAME account; does NOT see the Device A sale (Device A still offline). | User thinks they lost the sale → re-creates duplicate → sync → two duplicates (both valid, same products) → double income. | (a) When either device comes online, sync center shows on Device B: "You created a sale on [Device A name] 45 min ago — review potential duplicate." (b) User-facing server de-dupe heuristic: same business + same customer + same items + same amount within 4h → flag as "possibly duplicate". (c) Domain idempotency can't catch this because users intentionally re-create the sale. Requires UX nudges only. |
| K.4 | Voucher 101 was cancelled (reverse + cancel chain) on online Device B. Offline Device A still has Voucher 101 as "Posted" and creates a Payment against it. | Server must accept payment (payment posted against cancelled voucher's reversal can still allocate; OR server allocates to other outstanding). If server rejects payment → blocked. | Always allow server to book payment; add warning banner "Payment was allocated to next outstanding bill because Invoice 101 was reversed on another device." Never drop a recorded payment (cash actually moved). |
| K.5 | Queue size grows to 2000 operations without network. Performance: app becomes laggy, IndexedDB writes slow, user panics. | UX degradation | Sync worker flushes in batches of 25 ordered FIFO, updates progress in Sidebar indicator. Auto-block new writes if queue > 1000 UNLESS user explicitly dismisses warning. |
| K.6 | Mid-sync crash (after syncing 13/25 batch). Next app start must resume exactly from #14. | Duplicate #1-13 on restart if no acks. | Sync queue statuses are persisted. Each operation transition PENDING→SYNCING→SYNCED is an atomic Dexie transaction. On boot, any operation stuck in SYNCING for >5 min is reset to PENDING (server re-handshake under same idempotencyKey — dupe-safe). |

---

## L. SIDEBAR / UI REQUIREMENTS

### L.1 Global Sync State Source of Truth
**Implement `SyncProvider` React context** at top of layout (next to `BusinessProvider`). Export `useSyncState()` hook that returns:
```ts
type NetState = "unknown" | "online" | "offline" | "server_unreachable";
type SyncAggregate = {
  net: NetState;
  heartbeat: string | null;        // last successful /api/heartbeat (ISO)
  lastSuccessfulSyncAt: string | null;
  counts: { pending: number; syncing: number; synced: number; failed: number; conflict: number; blocked: number; };
  flushInProgress: boolean;
  flushProgressPercent: number;
};
```

### L.2 Sidebar Sync Indicator (MANDATORY PER §17)
**Placement:** Inserted at the very BOTTOM of [Sidebar/page.tsx](file:///d:/nextjs/erp-application/src/app/Components/Sidebar/page.tsx#L48-L54) between Administration section and the collapsed toggle.

**Four defined states (verbatim per §17 audit request):**
1. 🟢 **Synced** → `Last sync: 2 min ago`. Tooltip: "All changes saved to cloud."
2. 🔄 **Syncing…** → `12 pending`. Animated indeterminate progress bar. Tooltip: flushProgressPercent.
3. 🟡 **Offline** → `12 changes waiting`. Tooltip: "You are offline. Changes will sync when online."
4. 🔴 **Sync failed** → `3 failed · Retry`. Click = open Sync Center directly to failed tab.

**Rule:** ONE indicator. No page-level indicators. Click ANYWHERE on the status widget → open Sync Center modal.

### L.3 Sync Center Panel (§18)
- Route: `/tools/sync-center` (in the Tools nav section) + open modal shortcut.
- 6 Tabs: **Overview | Pending | Synced | Failed | Conflicts | Blocked**
  - Failed tab: per-row "Retry" button. Shows server error **sanitized** (no stack traces, only ValidationError.message + HTTP 403/409/500 class).
  - Conflicts tab: 2-column diff (Server version | Local version) + 3 resolution buttons: **Keep Server | Keep Local | Manual Edit → Save**
  - Blocked tab: per-row "Open document → Edit → Re-submit" navigation link.
- History table (last 100 sync operations + timestamps + user + device).

### L.4 LOCAL vs SERVER Badges (§21)
- In Sales list `src/app/sales/page.tsx`, every row with syncStatus != SYNCED renders a colored chip:
  - `[LOCAL]` (blue) = LOCAL_COMMITTED. Click tooltip: "Created offline — not yet synced."
  - `[PENDING]` (amber) = SYNC_PENDING (enqueued)
  - `[CONFLICT]` (orange)
  - `[BLOCKED]` (red) → click chip navigates to Sync Center filtering to that operation.
- On Dashboard KPIs: When ANY pending operation affects financial aggregates, banner shows: "Includes 12 local pending transactions." AND secondary small grey number shows the confirmed server value next to it.
- On InvoiceDocument PDF: if status != SERVER_COMMITTED, add watermark diagonally in 30% opacity: **"PREVIEW — NOT YET FILED — NO OFFICIAL VOUCHER NUMBER"** to prevent users from sending provisional PDFs as legal invoices.

---

## M. REQUIRED DATABASE CHANGES

### M.1 New IndexedDB / Dexie Schema (local only)
New files `src/lib/offline/dexieDb.ts` + `src/lib/offline/DexieAccountingRepository.ts`.

Dexie database v1:
```ts
interface OfflineDb extends Dexie {
  // Authoritative document caches (mirror of Firestore per business)
  accounts: Table<Account & {_syncedAt:string, _serverUpdatedAt:string}, string>;
  financialYears: Table<FinancialYear & {_syncedAt:string}, string>;
  vouchers: Table<Voucher & {_syncStatus:SyncStatus, _localSeq:number, _serverAckAt?:string, _error?:string}, string>;
  voucherLines: Table<VoucherLine & {_syncedAt:string}, string>;
  ledgerEntries: Table<LedgerEntry & {_syncedAt:string}, string>;
  stockMovements: Table<StockMovement & {_syncStatus:SyncStatus}, string>;
  partyAllocations: Table<PartyAllocation & {_syncStatus:SyncStatus}, string>;
  returnDocuments: Table<ReturnDocument & {_syncStatus:SyncStatus}, string>;
  accountingDocuments: Table<AtomicAccountingDocument, string>;
  auditLogs: Table<AuditEvent & {_upstreamed:boolean}, string>;
  // Master caches
  parties: Table<PartyMaster & {_syncedAt, _updatedAtField:{[k:string]:string}}>;
  items: Table<ItemMaster & {_syncedAt, stock:number, stockValue:number}>;
  warehouses: Table<Warehouse & {_syncedAt}>;
  taxRates: Table<TaxRate & {_syncedAt}>;
  settings: Table<{key:string; value:unknown; updatedAt:string;} , string>;
  // Sync metadata (NEW — §5)
  syncOperations: Table<SyncOperation, number>;   // primary key auto-increment
  syncHeartbeats: Table<{ts:string; state:NetState; err? : string} , number>;
  syncCursors: Table<{collection:string; lastDocId:string; checkpoint:string} , string>;
}
```

### M.2 SyncOperations Row Contract (§5)
```ts
type SyncStatus = "PENDING"|"SYNCING"|"SYNCED"|"FAILED"|"CONFLICT"|"BLOCKED";
interface SyncOperation {
  id?: number;                 // SQLite/Dexie autoincrement (durable)
  operationId: string;         // client UUID (stable)
  commandId: string;           // AccountingCommandName (SALE_CREATE etc.)
  businessId: string;
  financialYearId: string;
  deviceId: string;
  userId: string;
  entityType: string;          // voucher | party | item | ...
  entityId: string;            // matches voucher.id / party.id / ...
  operationType: "CREATE"|"UPDATE"|"DELETE"|"CANCEL"|"REVERSE";
  idempotencyKey: string;      // ← CRITICAL. NEVER change on retry.
  payloadFingerprint: string;  // match idempotency.fingerprint
  payload: string;             // JSON-stringified command input
  localSequence: number;       // device-local monotonic (per command type)
  createdAt: string;           // ISO
  syncedAt?: string;
  lastAttemptAt?: string;
  lastError?: string;          // sanitized
  serverAck?: {http:number; body:string};
  status: SyncStatus;
  retryCount: number;          // starts at 0, cap 15 then BLOCKED
  nextRetryAt?: string;        // exponential backoff
  dependsOnOperationIds: string[]; // must be SYNCED before this one runs
  conflictMeta?: {
    serverDocJson?:string, localDocJson?:string, fieldMask:string[]
  };
}
```

### M.3 Cloud Firestore Schema — Zero structural changes
- All business-owned collections remain identical. Only **new optional field** `_deviceId` and `_localOperationId` stored as metadata in vouchers/accountingDocuments for **tracing and de-duplication only** (not used for accounting). No migrations required; fields are nullable and ignored by domain logic via `firestoreSafe` filter if added.
- NEW COLLECTION: `businesses/{bid}/voucherReservations/{deviceId}` — deviceId → { blockSize, firstNumber, lastNumber, claimedAt:iso, expiresAt:iso }.

### M.4 SQLite Schema for Future Desktop SKU (Optional, Not in Current Scope)
- Mirror the Dexie v1 schema 1:1 into a `better-sqlite3` file with `WAL=ON`, `journal_mode=WAL`, `synchronous=NORMAL`, `PRAGMA foreign_keys=ON`. Create `idx_vouchers_fyid_type_status` composite index, `idx_stockMovements_itemId_warehouse_date` index. Backup strategy: `VACUUM INTO 'daily-backup.db'` on app close every day; keep last 7 backups, encrypted if master password set.

---

## N. REQUIRED DOMAIN / APPLICATION CHANGES

### N.1 Domain Layer — 99% NO CHANGES
Only **optional additive change:**
1. Extend `VoucherStatus` from `draft|validated|posted|cancelled` to `draft|validated|posted|cancelled` but keep `posted` as the sole authoritative state. The offline states (LOCAL_COMMITTED, SYNC_PENDING, ...) live in the **metadata overlay `_syncStatus`**, they are NOT first-class Voucher.status values. This prevents the domain engine from accidentally branching on offline state. **DO NOT modify VoucherStatus type in [types.ts#L1](file:///d:/nextjs/erp-application/src/core/accounting/types.ts#L1).** §8 maps to the lifecycle on top of the existing 4 states.

### N.2 Application Layer Changes
2. **`src/application/**` → every `executeXxx(deps, ctx, input)` already returns `CommandResult={value, idempotencyKey}`. This API is SUFFICIENT. Only add:**
   - New exported helper in `src/application/core.ts`:
     ```ts
     export function offlineAllowedCommands(): AccountingCommandName[] {
       // matches whitelist from §J.1
       return ["SALE_CREATE","PURCHASE_CREATE","RETURN_CREATE","RECEIPT_CREATE","PAYMENT_CREATE","JOURNAL_CREATE","EXPENSE_CREATE"];
     }
     ```
     Sync worker calls this before enqueueing sensitive commands. USER_MANAGE / FY_LOCK / etc. can never be queued offline.

### N.3 Numbering API (§9)
3. **New route `POST /api/accounting/voucher-sequences/reserve`** →
   - Request: `{ businessId, financialYearId, voucherType, prefix?, blockSize:10|25|50|100 }`
   - Auth: owner/admin/accountant only
   - Server: single Firestore admin transaction, reads `voucherSequences/{fy}_{type}.nextNumber`, increments by blockSize, writes a reservation doc (see M.3), returns `{ first, last, expiresAt }`. If blockSize > 100, reject. Expires after 30 days; unclaimed numbers returned to sequence on expiry (nightly cleanup function).

---

## O. REQUIRED PERSISTENCE CHANGES

### O.1 Build `DexieAccountingRepository`
- Location: `src/lib/offline/DexieAccountingRepository.ts`
- Implements `AccountingRepository` verbatim from [types.ts](file:///d:/nextjs/erp-application/src/core/accounting/types.ts#L12-L13).
- `runInTransaction<T>(work)` → `db.transaction('rw', [...all tables], () => work(tx))`. Dexie has native transactions; map exactly 1:1.
- Every `save*` method MUST include the same `if(entity.businessId !== this.businessId) throw new ValidationError("Business mismatch")` guard as adminAccountingRepository.
- **allocateVoucherNumber inside the offline repository MUST throw.** Offline never generates authoritative numbers. Allocation happens via reservation endpoint from M.3 / N.3 OR local uses a non-final PENDING display number.
- Tests must pass the entire hardening suite against Dexie adapter (§E.6).

### O.2 Refactor existing Repository Factory
- New file: `src/infrastructure/repositoryFactory.ts` exporting:
  ```ts
  export function createRepository(
    kind: "admin" | "client" | "dexie" | "memory",
    options: { businessId: string; db?: Firestore; dexie?: OfflineDb }
  ): AccountingRepository
  ```
  Keeps call sites from having conditional imports.

---

## P. REQUIRED SERVER CHANGES

1. **`/api/heartbeat` (GET)** → Returns `{ ok, ts, permissions: {...} , activeBusinessMembership:{role,status,permissionsUpdatedAt} }`. Used for permission cache freshness + connectivity detection.

2. **`/api/accounting/voucher-sequences/reserve` (POST)** → see §N.3.

3. **`/api/sync/pull-incremental` (POST)** → Input: `{cursors: {collection:lastCheckpoint}}`. Returns new or updated documents per collection since cursors, with new checkpoints. Offline hydrator calls this instead of downloading entire collection every time. **Reduces egress 100x for daily active users.**

4. **`/api/sync/operation/batch` (POST)** → Batch endpoint: `{operations: SyncOperation[]}`. Server executes up to 25 in dependency order within its own idempotency envelopes. Returns `{perOperationId: {status, error?, result?}}`. This is **OPTIONAL perf optimization**; initially, sync worker can just call the existing per-command routes sequentially (same behavior, fewer new endpoints).

5. **Hardened server filter on `_deviceId/_localOperationId`**: If a Sync HTTP request carries a device ID, the server may use it for logging only. It MUST NOT skip the idempotency check (idempotencyKey remains the final arbiter per §K.1).

---

## Q. REQUIRED TESTS (§22 TEST MATRIX)

Create a NEW hardening test file: `src/core/accounting/__tests__/offlineSyncHardening.test.ts` that covers:

```
 Q1  Online sale (baseline)
 Q2  Offline sale → reconnect → exactly one posted voucher
 Q3  Offline sale enqueued → kill app mid-execution → restart → sale present in syncOperations table
 Q4  Offline sale reconnect, duplicate HTTP POST simulated (same idempotencyKey) → one voucher only
 Q5  Timeout after server commit (response dropped) → client retries → idempotent replay returns same voucher
 Q6  Application crash points (before SQLite commit, after SQLite commit before sync, after server commit before client ack) → each point recovers cleanly
 Q7  Two devices create sales → server assigns contiguous invoice numbers from sequence (no collision)
 Q8  Two devices edit Party A master: Device A renames, Device B edits GSTIN → field-level merged correctly (name + gstin both applied)
 Q9  Device A changes Party GSTIN offline + Device B changes address online → GSTIN change BLOCKED (tax-critical) with user resolution
 Q10 Offline posts sale for ₹10,000 → another device ONLINE locks FY → offline sync → BLOCKED (FY locked server error propagated clearly)
 Q11 User creates business B but tries to sync a BIZ-A transaction → server 403, blocked
 Q12 Duplicate payment offline → same idempotency key → exactly one payment posted, one allocation
 Q13 Duplicate sale return offline → one return, one reversal chain
 Q14 Duplicate stock adjustment → one movement only
 Q15 Network flapping (offline/online every 2s) → sync worker retries with backoff, no stuck syncing states
 Q16 Server 503 for 10 minutes → retries backoff 2s→4s→8s→16s→30s cap; after 15 attempts operation.status = FAILED with "Unavailable — retry later"
 Q17 Partial batch of 25 (18 success, 7 failed) → next flush contains ONLY 7 remaining, no re-sending 18
 Q18 Offline queue grows to 500 operations → app still responsive (enqueue <20ms per op)
 Q19 Dexie corruption (DB seed with bad checksum) → recovery UI: "Local DB corrupted, force re-download from server + upload unsynced JSON queue"
 Q20 Inventory conflict: A sells 10 offline, B sells 6 online (stock is 12). Server commits B (stock 6). When A syncs → BLOCKED with cause "Insufficient stock (6 available, requested 10)" — blocked document preserved offline for edit.
```

### Q.2 UI Manual Checklist
```
 Q21 Sidebar status shows 🟢 SYNCED with timestamp on fresh page.
 Q22 Disconnect Wi-Fi → within 5 seconds status changes to 🟡 OFFLINE + 0 changes.
 Q23 Create 3 new sales offline → status changes to "🟡 Offline 3 changes waiting". Sales list shows 3 new rows with [LOCAL] chips.
 Q24 Dashboard totals show [LOCAL] numbers with grey "Server Confirmed" sub-numbers.
 Q25 Click Sidebar Status → Sync Center Overview matches counts.
 Q26 Print invoice while offline → PDF has PROVISIONAL watermark + PENDING voucher number placeholder.
 Q27 Reconnect Wi-Fi. Within 30s all 3 sales become SYNCED (idempotency ok, no duplicates created).
 Q28 Refresh server in 2nd browser → same 3 sales visible with real voucher numbers.
 Q29 Conflict: on Dev1 edit party A name = "X" offline; Dev2 online edit name = "Y". Synced → both devices offer "Resolve conflict: X / Y / merge manually."
 Q30 Permission demotion (owner → staff) on Dev2. Dev1 is offline. Dev1 tries SALE_CREATE while offline. Dev1 reconnects → permission cache refreshes on heartbeat. New future sales are BLOCKED at enqueue-time until permissions refreshed. The offline sale already queued is RE-VALIDATED by server during sync → either accepted (if permission was already valid at server time) OR BLOCKED with clear "Permission revoked".
```

---

## R. IMPLEMENTATION ORDER (CRITICAL PATH — STRICT DEPENDENCY)

```
 R1. INFRASTRUCTURE (Week 1 — Must Be First)
    R1.1 Create OfflineDB Dexie schema + OfflineDb types (§M.1-M.2)
    R1.2 Create SyncStatus enum + NetState enum constants
    R1.3 DeviceID generator + first-boot persistence
    R1.4 DexieAccountingRepository fully implements AccountingRepository
         → parameterize & pass full __tests__/ hardening suite against it

 R2. DOMAIN-APP SAFETY (Week 2)
    R2.1 offlineAllowedCommands() whitelist + offline auth cache 24h envelope
    R2.2 New route POST /api/accounting/voucher-sequences/reserve  (§N.3)
    R2.3 New route GET  /api/heartbeat                              (§P.1)
    R2.4 New route POST /api/sync/pull-incremental                 (§P.3)
    R2.5 Sequence Reservation claim + local PENDING display numbers

 R3. SYNC ENGINE (Week 3)
    R3.1 SyncOperation enqueue/dequeue Dexie tables
    R3.2 Dependency graph walker (dependsOnOperationIds)
    R3.3 Exponential backoff worker + status lifecycle (PENDING→SYNCING→{SYNCED/FAILED/CONFLICT/BLOCKED})
    R3.4 Crash recovery: on boot, reset any SYNCING stale ops to PENDING
    R3.5 Conflict detection: if server doc _updatedAt > local baseUpdatedAt → mark CONFLICT, stash server/local docs

 R4. UI LAYER (Week 4 — depends on R1 + R3 done)
    R4.1 SyncProvider (React context) + useSyncState() hook
    R4.2 Sidebar sync indicator (4 states, §L.2) in Sidebar
    R4.3 Sync Center panel (6 tabs, §L.3) with routing + modal
    R4.4 List page badges: [LOCAL]/[PENDING]/[CONFLICT]/[BLOCKED]
    R4.5 Dashboard KPI "LOCAL pending" annotation + banner
    R4.6 InvoiceDocument provisional watermark when voucher._syncStatus != SYNCED

 R5. MASTER DATA HYDROGRAPHY (Week 5)
    R5.1 Bootstrap master cache hydrator (parties/items/accounts/FYs/warehouses/taxes/settings)
    R5.2 Firestore onSnapshot() listeners for incremental updates (wired to Dexie)
    R5.3 Permission cache refresh from heartbeat
    R5.4 Cache expiry (24h) + blocked-writes UX if expired + offline

 R6. INTEGRATION + HARDENING (Week 6-7)
    R6.1 offlineSyncHardening.test.ts — all Q1-Q20 passing
    R6.2 UI manual regression Q21-Q30 passing against a staging Firestore project
    R6.3 Browser storage quota warnings + Export queue JSON backup
    R6.4 tsconfig strict=true conversion & JS→TS files (P1-0 from EXECUTION_STRATEGY.md)
         ↑ This reduces type risks in the new offline layer; HIGHLY RECOMMENDED BEFORE SHIPPING
    R6.5 Performance: 1000 vouchers, 5000 stock movements still render dashboard in <1200ms (Dexie query perf tuning with indexes)
```

---

## S. P0 / P1 / P2 / P3 PRIORITIZED REPAIR PLAN

### P0 — BLOCKERS BEFORE MERGE OF ANY OFFLINE CODE (Non-Negotiable)
```
 S.P0.1 DexieAccountingRepository passes parameterized version of every hardening
        test that currently passes against InMemoryAccountingRepository.
        FAILURE TO ACHIEVE → DO NOT SHIP OFFLINE.
 S.P0.2 Idempotency keys match client-side persisted key == server key 100% of time.
        Add explicit unit test: Sale created offline, synced → server returns
        same idempotencyKey, no duplicate voucher.  (§K.1 requirement)
 S.P0.3 Server ALWAYS re-validates authorization + business membership + FY lock
        on every synced operation.  (Verification: try to bypass and sync biz-A data
        as user of biz-B → 403 or BLOCKED)
 S.P0.4 No authoritative voucher numbers generated client-side.
        Search codebase for calls to allocateVoucherNumber from Dexie repo → ZERO.
 S.P0.5 Offline-allowed command whitelist is enforced (§J.1). USER_MANAGE,
        FY_LOCK, ROLE_CHANGE commands MUST NOT have a code path to be enqueued.
 S.P0.6 Sidebar indicator is SINGLE source of truth. No per-page sync spinners.
 S.P0.7 PDF printed offline MUST show PROVISIONAL watermark. (legal/compliance)
 S.P0.8 App-crash scenario (§19 / Q6-Q7) tested at least for SALE_CREATE end-to-end
        with IndexedDB cleared mid-flow, restart, and document-preserving recovery.
```

### P1 — MUST SHIP IN V1 OF OFFLINE FEATURE
```
 S.P1.1 Reservation-based number block claims with 30-day expiry.
 S.P1.2 Heartbeat route + permission cache 24h expiry enforcement.
 S.P1.3 Failed / Conflict / Blocked tabs working in Sync Center.
        (Each status navigable. Users can retry failed.)
 S.P1.4 Sync operations dependency ordering on party → item → voucher → payment.
 S.P1.5 Inventory conflict (§I.1) properly overwrites provisional COGS on
        server → propagated as reconciliation notice to UI (not silent).
 S.P1.6 Exponential backoff up to 30s, 15 attempts, then FAILED.
 S.P1.7 Dashboard dual values (local vs server-confirmed) rendered correctly.
 S.P1.8 Master field-level merge resolution with gstin/address separate updates.
```

### P2 — HIGH PRIORITY POST-V1
```
 S.P2.1 Batch sync endpoint for 25+ operations perf.
 S.P2.2 IndexedDB near-quota warnings UI (browser.storage.estimate).
 S.P2.3 Export-queue-as-JSON + re-import on another device (disaster-recovery
        of unsynced transactions for user whose storage gets wiped).
 S.P2.4 Firestore multi-tab persistence enableMultiTabIndexedDbPersistence() in
        firebase.js alongside Dexie. This keeps online-Firestore reads snappy when
        connection returns; complements our sync queue.
 S.P2.5 Optional Master-password WebCrypto AES-GCM local encryption (Enterprise).
 S.P2.6 Detailed operation audit log: who submitted from which device at what time.
```

### P3 — LONG-TERM ENHANCEMENTS
```
 S.P3.1 Tauri/Electron shell with real durable SQLite (WAL, backups, encrypted).
 S.P3.2 Multi-master CRDT for party/items masters (yjs/automerge) instead of
        field-level timestamps (reduces UX merge prompts).
 S.P3.3 Real-time collaborative POS (multiple cashiers on same business).
 S.P3.4 Native Android/iOS Capacitor shell with offline SQLite.
 S.P3.5 Serverless per-device email/SMS alert if sync queue >100 for >8 hours.
```

---

## T. EXPLICIT "DO NOT CHANGE" LIST

THE FOLLOWING THINGS **MUST NOT BE MODIFIED** BY THE OFFLINE FEATURE.
**Any deviation creates architectural corruption.**

```
 T.1 DO NOT MODIFY src/core/accounting/types.ts VoucherStatus enum.
     Offline lifecycle lives in _syncStatus metadata, not Voucher.status.
     Domain must never branch on offline state.

 T.2 DO NOT MODIFY calculateTax / gst.ts. Offline cannot "pick" a tax regime.
     gst.ts is AUTHORITATIVE and deterministic. If offline disagrees with
     server due to regime change (rare), server value wins. No per-device branches.

 T.3 DO NOT REMOVE OR BYPASS any of the 14 existing guard checks in
     postVoucher (voucher.ts#L8):
        - businessId, financialYearId, voucherType, createdBy required
        - date format
        - dueDate >= date
        - FY existence
        - FY belongs to business
        - FY NOT locked
        - date + dueDate within FY
        - lines not empty
        - every line accountId exists, belongs to business, validateAccount()
        - voucher number allocated via allocateVoucherNumber
        - validateVoucherLines() → 2 lines min, non-negative paise, per line 1 sided,
                                    totalDebit === totalCredit
     Offline repository MUST also run these EXACT checks. (It will because same
     postVoucher() is invoked with the Dexie repo in Application executeSale.)

 T.4 DO NOT REMOVE firestore.rules business isolation guards. Keep them even
     if you think "client won't write to Firestore directly anymore." Defense in depth.

 T.5 DO NOT INTRODUCE a separate or alternative "calculatePartyBalance" for
     offline mode. Reuse [party.ts](file:///d:/nextjs/erp-application/src/core/accounting/party.ts)
     buildPartyReconciliation. Offline uses the same function with Dexie repo output.

 T.6 DO NOT persist Firebase ID tokens or refresh tokens in Dexie/localStorage.
     Firebase SDK's browserLocalPersistence is the ONLY storage for auth material.
     Security boundary.

 T.7 DO NOT ADD authoritative balance summaries (e.g. a "partyBalances" table
     that gets incrementally updated). Reports are always rebuilt over
     LedgerEntry[]. Keep §A.2 architecture "projections = rebuild from docs" invariant.

 T.8 DO NOT ALLOCATE VOUCHER NUMBERS IN DEXIE REPOSITORY.
     allocateVoucherNumber() in Dexie adapter MUST throw.
     Authoritative numbers = server sequences. Period.

 T.9 DO NOT CREATE a second or parallel Inventory FIFO engine.
     Reuse inventoryValuation.ts verbatim. Even if server overwrites COGS later,
     the engine code is the same — only input (server authoritative movement list)
     differs.

 T.10 DO NOT DELETE / REPLACE / REWRITE existing InMemoryAccountingRepository or
      adminAccountingRepository or firestoreAccountingRepository. They are correct
      and battle-tested. ADD the Dexie adapter alongside them; don't touch them.

 T.11 DO NOT REMOVE "cache: no-store" in BusinessContext.ts request() for API calls
      when online. Online = live data. Offline reads go through Dexie, not through
      accidentally-cached stale HTTP responses.

 T.12 DO NOT set allowNegativeStock = true on the domain just to "make offline work".
      Negative stock is a domain violation and must be blocked at the lowest layer
      regardless of online vs offline. If a conflict arises, the resolution is
      BLOCKED status + user edit. No accounting rule relaxation.

 T.13 DO NOT silently "fix" blocked offline transactions on sync.
      If server rejects, keep operation visible with error.
      Manual review required; user must either edit and re-submit or delete.
      Financial data is not a place for silent AI-style merges.
```

---

## AUDIT COMPLETE
Status: Audit output A..T delivered. Zero code changes have been made. Repository is preserved in original state.

### Recommended Next Action
Start with **R.P0.1 (DexieAccountingRepository + parameterized hardening tests against it).** This delivers maximum risk reduction per engineering day: if the adapter cannot pass the same tests as InMemoryAccountingRepository, **scrap the offline plan immediately** because the alternative (parallel domain logic) would violate the Master Engineering Execution Contract Absolute Rules #11, #13, and #15.
