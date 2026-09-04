// Server: Number reservation endpoint. Bumps server-controlled sequence by blockSize atomically.
import { NextResponse } from "next/server";
import { getFirestoreAdmin, createAuthorizedContext } from "@/infrastructure/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await createAuthorizedContext(req);
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized", code: 401 }, { status: 401 });
    const body = await req.json();
    const businessId = body.businessId || ctx.activeBusinessId;
    if (!businessId) return NextResponse.json({ error: "Business ID required", code: 400 }, { status: 400 });
    if (ctx.activeBusinessId && businessId !== ctx.activeBusinessId) return NextResponse.json({ error: "Business mismatch", code: 403 }, { status: 403 });
    const { financialYearId, voucherType, prefix = "", blockSize = 10 } = body;
    if (!financialYearId || !voucherType) return NextResponse.json({ error: "financialYearId and voucherType required", code: 400 }, { status: 400 });
    const safeBlock = Math.max(1, Math.min(100, Number(blockSize) || 10));
    const db = getFirestoreAdmin();
    const seqRef = db.collection("businesses").doc(businessId).collection("voucherSequences").doc(`${financialYearId}_${voucherType}`);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const reservationRef = db.collection("businesses").doc(businessId).collection("voucherReservations").doc();
    const [firstNumber] = await db.runTransaction(async (tx) => {
      const snap = await tx.get(seqRef);
      let nextNumber = Number(snap.data()?.nextNumber ?? 1);
      const seqDoc = snap.data();
      if (seqDoc?.financialYearId && seqDoc.financialYearId !== financialYearId) return [null];
      const first = nextNumber;
      nextNumber += safeBlock;
      tx.set(seqRef, { nextNumber, financialYearId, voucherType, prefix, updatedAt: new Date().toISOString() }, { merge: true });
      tx.create(reservationRef, {
        businessId, financialYearId, voucherType, prefix,
        first, last: first + safeBlock - 1, cursor: first,
        claimedAt: new Date().toISOString(), expiresAt, deviceId: body.deviceId ?? `DEV-${ctx.userId.slice(0, 4).toUpperCase()}`,
        userId: ctx.userId,
      });
      return [first];
    });
    if (firstNumber == null) return NextResponse.json({ error: "FY mismatch in sequence", code: 409 }, { status: 409 });
    const lastNumber = firstNumber + safeBlock - 1;
    return NextResponse.json({
      success: true, result: {
        reservationId: reservationRef.id, businessId, financialYearId, voucherType, prefix,
        first: firstNumber, last: lastNumber, blockSize: safeBlock,
        expiresAt, cursor: firstNumber,
        examples: Array.from({ length: Math.min(safeBlock, 3) }, (_, i) => {
          const n = firstNumber + i;
          return prefix ? `${prefix}/${n}` : n.toString();
        }),
      },
    });
  } catch (err: any) {
    const code = err?.status ?? 500;
    return NextResponse.json({ error: String(err?.message || err), code }, { status: code >= 400 ? code : 500 });
  }
}
