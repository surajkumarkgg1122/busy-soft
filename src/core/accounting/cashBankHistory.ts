import { randomUUID } from "node:crypto";

export type CashBankHistoryRow = {
  lineId: string;
  voucherId: string;
  date: string;
  voucherNumber: string;
  voucherType: string;
  accountId: string;
  partyId?: string;
  description: string;
  debit: number;
  credit: number;
};

function normalize(row: any, fallback: Record<string, unknown> = {}): CashBankHistoryRow {
  return {
    lineId: String(row.lineId ?? row.id ?? fallback.lineId ?? randomUUID()),
    voucherId: String(row.voucherId ?? fallback.voucherId ?? ""),
    date: String(row.date ?? fallback.date ?? ""),
    voucherNumber: String(row.voucherNumber ?? fallback.voucherNumber ?? ""),
    voucherType: String(row.voucherType ?? fallback.voucherType ?? ""),
    accountId: String(row.accountId ?? fallback.accountId ?? ""),
    partyId: row.partyId ?? fallback.partyId,
    description: String(row.description ?? fallback.description ?? ""),
    debit: Number(row.debit ?? 0),
    credit: Number(row.credit ?? 0),
  };
}

/**
 * Builds the Cash/Bank history from the canonical ledger. Older data may not
 * have ledgerEntries, so voucherLines are used only for lines missing from
 * the canonical ledger. Opening vouchers are deliberately excluded because
 * the account opening balance is already stored on the bankAccounts master.
 */
export async function buildCashBankLedgerHistory(db: any, ref: any, financialYearId: string, ledgerAccountIds: string[]) {
  if (!ledgerAccountIds.length) return { rows: [] as CashBankHistoryRow[], source: "ledgerEntries" };

  const ledgerSnapshot = await ref.collection("ledgerEntries").where("financialYearId", "==", financialYearId).get();
  const canonical = ledgerSnapshot.docs
    .map((doc: any) => normalize({ lineId: doc.id, ...doc.data() }))
    .filter((row: CashBankHistoryRow) => ledgerAccountIds.includes(row.accountId) && row.voucherType.toUpperCase() !== "OPENING");

  const canonicalIds = new Set(canonical.map((row) => row.lineId));
  const lineDocs: any[] = [];
  for (let i = 0; i < ledgerAccountIds.length; i += 30) {
    const chunk = ledgerAccountIds.slice(i, i + 30);
    const snapshot = await ref.collection("voucherLines").where("accountId", "in", chunk).get();
    lineDocs.push(...snapshot.docs);
  }

  const voucherIds = [...new Set(lineDocs.map((doc: any) => String(doc.data()?.voucherId ?? "")).filter(Boolean))];
  const vouchers = new Map<string, any>();
  await Promise.all(voucherIds.map(async (voucherId) => {
    const snap = await ref.collection("vouchers").doc(voucherId).get();
    if (snap.exists && String(snap.data()?.financialYearId ?? "") === financialYearId) {
      vouchers.set(voucherId, { id: snap.id, ...snap.data() });
    }
  }));

  const fallback = lineDocs
    .map((doc: any) => {
      const line = doc.data() ?? {};
      const voucherId = String(line.voucherId ?? "");
      const voucher = vouchers.get(voucherId);
      return normalize({ lineId: doc.id, ...line }, {
        voucherId,
        accountId: line.accountId,
        partyId: line.partyId,
        date: voucher?.date,
        voucherNumber: voucher?.voucherNumber,
        voucherType: voucher?.voucherType,
        description: line.description ?? voucher?.narration,
      });
    })
    .filter((row: CashBankHistoryRow) =>
      row.voucherId &&
      !canonicalIds.has(row.lineId) &&
      row.voucherType.toUpperCase() !== "OPENING" &&
      vouchers.has(row.voucherId),
    );

  const rows = [...canonical, ...fallback];
  rows.sort((a, b) => `${a.date}:${a.voucherNumber}:${a.lineId}`.localeCompare(`${b.date}:${b.voucherNumber}:${b.lineId}`));
  return { rows, source: fallback.length ? "ledgerEntries+voucherLines-fallback" : "ledgerEntries" };
}
