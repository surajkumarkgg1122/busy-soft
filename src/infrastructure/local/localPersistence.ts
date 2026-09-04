"use client";

import { requireLocalDb } from "./localDb";

export async function initializeLocalPersistence() {
  const db = requireLocalDb();
  await db.open();
  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch { /* best effort; browser policy controls persistence */ }
  }
  return {
    persisted: navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false,
  };
}
