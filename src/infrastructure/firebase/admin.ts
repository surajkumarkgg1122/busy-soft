import "server-only";
import { cert, getApps, getApp, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function credentials() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json) as { projectId?: string; clientEmail?: string; privateKey?: string };
      if (!parsed.projectId || !parsed.clientEmail || !parsed.privateKey) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is incomplete.");
      return cert({ projectId: parsed.projectId, clientEmail: parsed.clientEmail, privateKey: parsed.privateKey.replace(/\\n/g, "\n") });
    } catch (error) {
      throw new Error(error instanceof Error ? `Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${error.message}` : "Invalid FIREBASE_SERVICE_ACCOUNT_JSON.");
    }
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) throw new Error("Firebase Admin credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY in .env.local.");
  return cert({ projectId, clientEmail, privateKey });
}

let cached: { auth: Auth; db: Firestore } | null = null;

export function getAdminServices() {
  if (cached) return cached;
  const app = getApps().length ? getApp() : initializeApp({ credential: credentials() });
  cached = { auth: getAuth(app), db: getFirestore(app) };
  return cached;
}
