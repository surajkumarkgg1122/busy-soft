"use client";

import { useEffect } from "react";
import { startSyncEngine } from "@/infrastructure/local/syncEngine";

export default function SyncBootstrap() {
  useEffect(() => startSyncEngine(), []);
  return null;
}
