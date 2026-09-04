// Repository factory: admin / client / dexie(SQLite) / memory.
// Keeps Application/Domain layers blissfully unaware of the persistence backend.
import type { AccountingRepository } from "@/core/accounting/types";
import { InMemoryAccountingRepository } from "@/core/accounting/inMemoryRepository";
import { SqliteAccountingRepository, BusySoftOfflineDb, getOfflineDb } from "@/lib/offline/sqliteAccountingRepository";

export type RepositoryKind = "memory" | "admin" | "client" | "dexie";

export interface RepositoryOptions {
  kind: RepositoryKind;
  businessId: string;
  userId?: string;
  adminDb?: any; // firebase-admin Firestore instance, injected by server
  clientDb?: any; // firebase client Firestore instance, injected by browser
  dexieDb?: BusySoftOfflineDb;
}

export function createAccountingRepository(options: RepositoryOptions): AccountingRepository {
  if (!options.businessId) throw new Error("createAccountingRepository requires businessId.");
  switch (options.kind) {
    case "memory": return new InMemoryAccountingRepository(options.businessId);
    case "dexie": {
      const db = options.dexieDb ?? (options.userId ? getOfflineDb(options.userId, options.businessId) : null);
      if (!db) throw new Error("Dexie DB not provided and no userId given to open.");
      return new SqliteAccountingRepository(db, options.businessId);
    }
    case "admin": {
      if (!options.adminDb) throw new Error("Admin DB not provided for admin repository.");
      // Lazy import to avoid pulling admin SDK into browser bundles.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { AdminAccountingRepository } = require("@/infrastructure/firebase/adminAccountingRepository");
      return new AdminAccountingRepository(options.adminDb, options.businessId);
    }
    case "client": {
      if (!options.clientDb) throw new Error("Client DB not provided for client repository.");
      const { ClientAccountingRepository } = require("@/infrastructure/firebase/firestoreAccountingRepository");
      return new ClientAccountingRepository(options.clientDb, options.businessId);
    }
    default: throw new Error(`Unknown repository kind: ${options.kind}`);
  }
}

// Utility: build offline repository in browser from current session (userId + activeBusinessId)
export async function openOfflineRepositoryForCurrentSession(
  userId: string, businessId: string
): Promise<{ repo: AccountingRepository; db: BusySoftOfflineDb }> {
  if (typeof window === "undefined") throw new Error("Offline repository is browser-only.");
  const db = getOfflineDb(userId, businessId);
  const repo = createAccountingRepository({ kind: "dexie", businessId, userId, dexieDb: db });
  // Ensure singleton device-id row first time
  try {
    const row = await db.deviceId.get("singleton");
    if (!row) {
      const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await db.deviceId.add({ id: "singleton", deviceId: `DEV-${uuid.slice(0, 8).toUpperCase()}`, createdAt: new Date().toISOString() });
    }
  } catch { /* ignore table not ready errors on first run */ }
  return { repo, db };
}
