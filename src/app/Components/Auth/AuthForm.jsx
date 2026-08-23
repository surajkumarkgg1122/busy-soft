"use client";

import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { firebaseAuth, firebaseConfigured } from "../../../lib/firebase";

const provider = new GoogleAuthProvider();

function getAuthMessage(error) {
  const messages = {
    "auth/email-already-in-use": "An account already exists for this email.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/user-not-found": "No account exists for this email. Create an account first.",
    "auth/wrong-password": "The email or password is incorrect.",
    "auth/configuration-not-found": "Firebase Authentication is not configured for this project. Enable Authentication and Email/Password sign-in in the Firebase Console.",
    "auth/operation-not-allowed": "Email/password sign-in is disabled in Firebase Authentication.",
    "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
    "auth/network-request-failed": "Network error. Check your internet connection and try again.",
    "auth/weak-password": "Use a password with at least six characters.",
    "auth/popup-closed-by-user": "The Google sign-in window was closed.",
  };

  return messages[error.code] || `Authentication failed (${error.code || "unknown error"}).`;
}

export default function AuthForm() {
  const [mode, setMode] = useState("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      if (mode === "signIn") {
        await signInWithEmailAndPassword(firebaseAuth, email, password);
      } else {
        await createUserWithEmailAndPassword(firebaseAuth, email, password);
      }
    } catch (authError) {
      console.error("Firebase email authentication failed:", authError.code, authError.message);
      setError(getAuthMessage(authError));
    } finally {
      setPending(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setPending(true);

    try {
      await signInWithPopup(firebaseAuth, provider);
    } catch (authError) {
      console.error("Firebase Google authentication failed:", authError.code, authError.message);
      setError(getAuthMessage(authError));
    } finally {
      setPending(false);
    }
  };

  if (!firebaseConfigured) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8fc] px-6">
        <section className="w-full max-w-md rounded-2xl border border-[#e6e9f0] bg-white p-8 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-[#465fff]">Ganpati Neer</p>
          <h1 className="text-2xl font-bold text-[#1c2940]">Firebase setup required</h1>
          <p className="mt-3 text-sm leading-6 text-[#667085]">
            Add the Firebase web app values to your local environment file, then restart the development server.
          </p>
          <code className="mt-5 block rounded-lg bg-[#f4f6fa] p-4 text-xs leading-6 text-[#344054]">
            .env.local
          </code>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fc] px-6 py-12">
      <section className="w-full max-w-md rounded-2xl border border-[#e6e9f0] bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold text-[#465fff]">Ganpati Neer</p>
          <h1 className="text-2xl font-bold text-[#1c2940]">
            {mode === "signIn" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-[#667085]">
            {mode === "signIn" ? "Sign in to continue to your dashboard." : "Start managing your workspace today."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-[#344054]">
            Email
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[#d0d5dd] px-3 outline-none transition focus:border-[#465fff] focus:ring-2 focus:ring-[#465fff]/15" />
          </label>
          <label className="block text-sm font-medium text-[#344054]">
            Password
            <input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[#d0d5dd] px-3 outline-none transition focus:border-[#465fff] focus:ring-2 focus:ring-[#465fff]/15" />
          </label>
          {error && <p role="alert" className="text-sm text-[#d92d20]">{error}</p>}
          <button disabled={pending} type="submit" className="h-11 w-full rounded-lg bg-[#465fff] text-sm font-semibold text-white transition hover:bg-[#364bd9] disabled:cursor-not-allowed disabled:opacity-60">
            {pending ? "Please wait..." : mode === "signIn" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-[#98a2b3]"><span className="h-px flex-1 bg-[#eaecf0]" />OR<span className="h-px flex-1 bg-[#eaecf0]" /></div>
        <button disabled={pending} type="button" onClick={handleGoogleSignIn} className="h-11 w-full rounded-lg border border-[#d0d5dd] text-sm font-semibold text-[#344054] transition hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-60">Continue with Google</button>
        <p className="mt-6 text-center text-sm text-[#667085]">
          {mode === "signIn" ? "New here?" : "Already have an account?"}{" "}
          <button type="button" onClick={() => { setMode(mode === "signIn" ? "signUp" : "signIn"); setError(""); }} className="font-semibold text-[#465fff]">{mode === "signIn" ? "Create an account" : "Sign in"}</button>
        </p>
      </section>
    </main>
  );
}