# BUSY Soft Accounting Core v1

This directory is the domain layer for BUSY Soft. UI pages must not calculate balances, mutate stock, or write ledger documents directly.

## v1 invariants

1. Money is stored as integer minor units (INR = paise).
2. Every posted voucher is double-entry and must balance: total debit === total credit.
3. Posted vouchers are immutable. Corrections use reversal/correcting vouchers.
4. Party balances are derived from ledger entries; `party.balance` is only a cache.
5. Stock is derived from stock movements; an item `stock` field is only a cache.
6. Financial-year lock blocks posting and reversal.
7. Voucher numbers are allocated transactionally by `(business, financialYear, voucherType)`.
8. Sale/purchase posting and their stock movements are committed in one repository transaction.
9. Reports read accounting ledgers rather than reconstructing accounting from UI documents.
10. Audit events are part of the accounting transaction.
11. Account IDs and financial years are business-scoped.
12. Allocation amounts may never exceed the outstanding amount being allocated.
13. FIFO and weighted-average valuation reject negative stock.

## Modules

- `types.ts` - storage-independent domain contracts.
- `money.ts` - safe minor-unit money and quantity primitives.
- `accounts.ts` - chart/account validation and hierarchy rules.
- `ledger.ts` - double-entry validation and balances.
- `voucher.ts` - posting, numbering, financial-year checks and reversal.
- `transactions.ts` - journal, receipt, payment, contra, opening, expense, sale and purchase.
- `returns.ts` - sale and purchase returns with stock movements.
- `inventory.ts` - stock movement and basic stock balance.
- `valuation.ts` - FIFO and weighted-average ending inventory valuation.
- `gst.ts` - deterministic CGST/SGST/IGST/cess calculation.
- `party.ts` - party allocation and outstanding primitives.
- `reports.ts` - trial balance, P&L, balance sheet and party statement.
- `reconciliation.ts` - trial-balance and balance-sheet invariants.
- `firestoreRepository.ts` - Firestore persistence adapter.
- `inMemoryRepository.ts` - deterministic domain-test adapter.
- `selfTest.ts` / `testCases.ts` - smoke and invariant test support.

## Accounting boundaries

The core deliberately does not silently invent GST/HSN/place-of-supply policy, inventory valuation policy, or account mappings. Application configuration must supply these explicitly.

The browser must not be trusted as the final accounting authority. Production deployment should put accounting commands behind a trusted server/Electron-main boundary and enforce business membership + permissions there.

## Transaction rule

A business operation is complete only when its document, voucher, ledger entries, stock movements, party allocations and audit event are committed atomically. The repository contract is therefore intentionally extensible; document persistence must be included by the application transaction when a module is migrated.

## Supported transaction shapes

### Credit sale

- Customer Dr total
- Sales Cr taxable value
- Output GST Cr
- COGS Dr / Inventory Cr when cost is supplied
- Stock OUT

### Sales return

- Sales Return Dr taxable value
- Output GST Dr
- Customer Cr total
- Stock IN

### Purchase

- Purchase Dr taxable value
- Input GST Dr
- Supplier Cr total
- Stock IN

### Payment / receipt

- Payment: expense/party Dr, cash/bank Cr
- Receipt: cash/bank Dr, party Cr

## Testing expectation

`runAccountingInvariantTests()` covers balanced/unbalanced vouchers, GST, party allocation, FIFO and weighted-average valuation. These are domain smoke tests; the project must add a real test runner before CI can enforce them automatically.

## Electron + SQLite

The accounting core has no Firebase-specific types. A SQLite/Drizzle repository can implement the same contracts for Electron, while Firestore remains a cloud/sync adapter.
