# BUSY Soft Accounting Core v1

This directory is the domain layer for BUSY Soft. UI pages must not calculate balances, mutate stock, or write ledger documents directly.

## Hardened invariants

1. Money is stored as integer minor units (INR = paise).
2. Every posted voucher is double-entry and must balance.
3. Posted vouchers are immutable; corrections use reversal/correcting vouchers.
4. Party balances are derived from ledger entries; allocations are persisted atomically.
5. Stock is derived from stock movements; sale COGS is calculated from historical stock using FIFO or weighted average.
6. Financial-year locks and date boundaries are enforced by the voucher engine.
7. Voucher numbers are allocated transactionally by business, financial year and voucher type.
8. Sale/purchase accounting and stock movements are committed in one repository transaction.
9. Sales and purchases support idempotent atomic posting when an idempotency key is supplied.
10. Reports derive from ledger data; P&L uses the requested period, while balance sheet uses balances through the report end date.
11. Trial balance and balance sheet reconciliation expose explicit differences and integrity assertions.
12. Party allocations cannot exceed the source or target voucher's party amount and require opposite outstanding directions.
13. FIFO and weighted-average valuation reject negative stock.

## Modules

- `types.ts` - storage-independent domain contracts.
- `money.ts` - safe money and quantity primitives.
- `accounts.ts` - chart/account validation.
- `ledger.ts` - double-entry validation and balances.
- `voucher.ts` - voucher posting, numbering, financial-year checks and reversal.
- `transactions.ts` - journal, receipt, payment, contra, opening, expense, sale and purchase.
- `returns.ts` - sale and purchase returns.
- `inventory.ts` - stock movement creation.
- `valuation.ts` - FIFO, weighted-average and outgoing-cost calculation.
- `gst.ts` - deterministic CGST/SGST/IGST/cess calculation.
- `party.ts` - party allocation validation and outstanding calculations.
- `partyTransaction.ts` - atomic persisted party allocation command.
- `reports.ts` - trial balance, P&L, balance sheet and party statement.
- `reconciliation.ts` - accounting integrity checks.
- `atomic.ts` - idempotent accounting command boundary.
- `firestoreRepository.ts` - Firestore transactional adapter.
- `inMemoryRepository.ts` - deterministic test adapter.

## Sale/Purchase integration

Sale posting validates stock lines, reads historical item/warehouse movements, calculates COGS through the configured valuation method, creates the corresponding ledger entries, and writes stock OUT in the same repository transaction.

Purchase posting validates stock-line valuation against the taxable value, creates Inventory/Input GST/Supplier or Cash/Bank accounting, and writes stock IN atomically.

An optional `totalCost` supplied by a caller is treated only as a consistency check; it is not the accounting authority.

## Reporting

For a report period, P&L includes only transactions inside the period. Trial balance includes opening balances plus activity through the report end date. Balance sheet includes balances through the report end date plus the period's current profit. `assertAccountingIntegrity()` can fail a command/report pipeline when the books do not reconcile.

## Party allocation

Allocations are persisted as first-class records and validated against both source and target voucher party amounts. The transaction reads the relevant vouchers and existing allocations before saving the new allocation and audit event.

## Atomicity boundary

Firestore repository operations are transactional. Sale/purchase accounting and stock writes are atomic inside that repository transaction. To make a UI/business document itself atomic with accounting, the application must persist that document through the same transaction boundary; the Core does not pretend that an unrelated client-side write is atomic.

## Production boundary

The browser must not be trusted as the final accounting authority. Production deployment should put accounting commands behind a trusted server/Electron-main boundary and enforce business membership and permissions there. A real CI test runner/build must still execute before production release.
