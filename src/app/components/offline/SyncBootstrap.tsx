"use client";

import { useEffect } from "react";
import { startSyncEngine } from "@/infrastructure/local/syncEngine";
import { initializeLocalPersistence } from "@/infrastructure/local/localPersistence";

export default function SyncBootstrap() {
  useEffect(() => {
    let cleanup = () => undefined;
    void initializeLocalPersistence().then(() => { cleanup = startSyncEngine(); });
    return () => cleanup();
  }, []);
  return null;
}
