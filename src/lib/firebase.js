import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);

const firebaseApp = firebaseConfigured
  ? getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
export const auth = firebaseAuth;

// Temporary compatibility export: existing UI modules still use the client
// Firestore SDK. Accounting writes must continue to use the Admin SDK/API.
// This will be removed only after every remaining client Firestore consumer
// has been migrated to a server/API data path.
export const firestoreDb = firebaseApp ? getFirestore(firebaseApp) : null;

if (firebaseAuth) {
  void setPersistence(firebaseAuth, browserLocalPersistence).catch(() => {
    // Persistence can be unavailable in restricted browser environments.
  });
}
