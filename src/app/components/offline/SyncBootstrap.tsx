"use client";

import { useEffect } from "react";
import { startSyncEngine } from "@/infrastructure/local/syncEngine";
import { initializeLocalPersistence } from "@/infrastructure/local/localPersistence";
import { hydrateSyncState } from "@/infrastructure/local/syncStateHydrator";

export default function SyncBootstrap() {
  useEffect(() => {
    let cleanup = () => undefined;
    void initializeLocalPersistence().then(async () => {
      await hydrateSyncState();
      cleanup = startSyncEngine();
    });
    return () => cleanup();
  }, []);
  return null;
}
