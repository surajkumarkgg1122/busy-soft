# BUSY Soft Accounting Core

This directory is the domain layer for BUSY Soft. UI pages must not calculate balances, mutate stock, or write ledger documents directly.

## Rules

1. Money is stored as integer minor units (INR = paise).
2. Every posted voucher is double-entry and must balance: total debit === total credit.
3. Posted vouchers are immutable. Corrections use reversal/correcting vouchers.
4. Party balances are derived from ledger entries; never treat `party.balance` as accounting truth.
5. Stock is derived from `stockMovements`; an item `stock` field may only be a cache.
6. Financial-year lock blocks posting and reversal.
7. Voucher numbers are allocated transactionally by `(business, financialYear, voucherType)`.
8. Sale/purchase posting and stock movements are committed in one repository transaction.
9. Reports must read vouchers/ledger/stock ledgers, not reconstruct accounting from UI documents.
10. Audit events belong to the same transaction as the business operation.

## Modules

- `types.ts` - domain contracts and storage-independent entities.
- `ledger.ts` - double-entry validation, account balances and party balances.
- `voucher.ts` - voucher posting, numbering, financial-year checks and reversal.
- `transactions.ts` - journal, receipt, payment, contra, expense, opening, sale and purchase.
- `returns.ts` - sale and purchase returns with stock movements.
- `inventory.ts` - stock movement and stock balance calculations.
- `gst.ts` - deterministic CGST/SGST/IGST/cess calculation.
- `firestoreRepository.ts` - business-scoped Firestore adapter. Treat this as a transitional adapter; production posting should move behind a trusted service before exposing unrestricted accounting writes to browsers.
- `inMemoryRepository.ts` and `selfTest.ts` - domain smoke-test support.

## Required account setup

A business should have system accounts such as:

- Cash
- Bank accounts
- Customers / Sundry Debtors control
- Suppliers / Sundry Creditors control
- Sales
- Purchase
- Inventory
- Cost of Goods Sold
- Output CGST / SGST / IGST / Cess
- Input CGST / SGST / IGST / Cess
- Opening Balance Equity
- Expense groups

The transaction builders receive concrete account IDs through `AccountMap`; this avoids hard-coding IDs into UI components.

## Sale example

A credit sale of taxable value Rs. 10,000 with 18% intra-state GST produces:

- Customer Dr 11,800
- Sales Cr 10,000
- Output CGST Cr 900
- Output SGST Cr 900

If COGS is Rs. 6,000, the same voucher also posts:

- COGS Dr 6,000
- Inventory Cr 6,000

and the stock engine records the item quantities as OUT.

## Integration pattern

```text
React page
  -> application service
    -> accounting core
      -> repository transaction
        -> voucher + voucher lines + ledger entries + stock movements + audit
```

Never call Firestore directly from a sales page for accounting state after migration. The page should submit a command to an application service.

## Future Electron + SQLite

The accounting core intentionally contains no Firebase-specific types. The same `AccountingRepository` contract can be implemented by SQLite/Drizzle for the Electron desktop application, while the Firestore adapter can remain a cloud/sync adapter.
