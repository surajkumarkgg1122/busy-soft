"use client";

import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth, firebaseConfigured } from "../../../lib/firebase";

const provider = new GoogleAuthProvider();

function getAuthMessage(error) {
  const messages = {
    "auth/email-already-in-use": "An account already exists for this email.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/user-not-found": "No account exists for this email.",
    "auth/wrong-password": "The email or password is incorrect.",
    "auth/configuration-not-found": "Firebase Authentication is not configured for this project.",
    "auth/operation-not-allowed": "This sign-in method is disabled in Firebase Authentication.",
    "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
    "auth/network-request-failed": "Network error. Check your internet connection and try again.",
    "auth/weak-password": "Use a stronger password with at least six characters.",
    "auth/popup-closed-by-user": "The Google sign-in window was closed.",
  };

  return messages[error?.code] || `Authentication failed (${error?.code || "unknown error"}).`;
}

function BrandMark() {
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f5b544] text-[#182230] shadow-[0_10px_28px_rgba(245,181,68,0.18)]">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3ZM4.5 7.5l7.5 4 7.5-4M12 11.5V21" />
      </svg>
    </div>
  );
}

export default function AuthForm() {
  const [mode, setMode] = useState("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  const isSignUp = mode === "signUp";
  const isForgotPassword = mode === "forgotPassword";

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setNotice("");
    setPassword("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!firebaseAuth) {
      setError("Firebase Authentication is unavailable. Check your configuration.");
      return;
    }

    setPending(true);

    try {
      if (isForgotPassword) {
        await sendPasswordResetEmail(firebaseAuth, email.trim());
        setNotice("Password reset instructions have been sent to your email.");
        setPending(false);
        return;
      }

      if (isSignUp) {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
        if (name.trim()) {
          await updateProfile(credential.user, { displayName: name.trim() });
        }
      } else {
        await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      }
    } catch (authError) {
      console.error("Firebase authentication failed:", authError?.code, authError?.message);
      setError(getAuthMessage(authError));
    } finally {
      setPending(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setNotice("");

    if (!firebaseAuth) {
      setError("Firebase Authentication is unavailable. Check your configuration.");
      return;
    }

    setPending(true);

    try {
      await signInWithPopup(firebaseAuth, provider);
    } catch (authError) {
      console.error("Firebase Google authentication failed:", authError?.code, authError?.message);
      setError(getAuthMessage(authError));
    } finally {
      setPending(false);
    }
  };

  if (!firebaseConfigured) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-6">
        <section className="w-full max-w-lg rounded-2xl border border-[#e4e7ec] bg-white p-8 shadow-[0_12px_40px_rgba(16,24,40,0.06)]">
          <div className="flex items-center gap-3"><BrandMark /><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#98a2b3]">Business Soft</p><p className="text-sm font-semibold text-[#101828]">Ganpati Neer ERP</p></div></div>
          <h1 className="mt-8 text-2xl font-semibold tracking-[-0.03em] text-[#101828]">Firebase setup required</h1>
          <p className="mt-3 text-sm leading-6 text-[#667085]">Add the Firebase web app values to your local environment file, then restart the development server.</p>
          <code className="mt-5 block rounded-xl border border-[#e4e7ec] bg-[#f9fafb] p-4 text-xs leading-6 text-[#344054]">.env.local</code>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] lg:grid lg:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#182230] px-10 py-10 text-white lg:flex lg:flex-col xl:px-14">
        <div className="absolute -right-28 top-20 h-72 w-72 rounded-full bg-[#243247] blur-3xl" />
        <div className="absolute -bottom-32 left-10 h-80 w-80 rounded-full bg-[#202c3d] blur-3xl" />

        <div className="relative flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#8392a8]">Business Soft</p>
            <p className="mt-0.5 text-sm font-semibold text-white">Ganpati Neer ERP</p>
          </div>
        </div>

        <div className="relative my-auto max-w-xl py-16">
          <div className="inline-flex items-center rounded-full border border-[#344258] bg-[#202c3d] px-3 py-1.5 text-xs font-medium text-[#b8c5d4]">Modern business management</div>
          <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-[-0.04em] xl:text-5xl">Run your business from one focused workspace.</h1>
          <p className="mt-5 max-w-lg text-sm leading-7 text-[#aebbc9]">Sales, customers, inventory, payments and reports—organized around your business and ready for multi-user growth.</p>

          <div className="mt-10 space-y-4">
            {[
              ["Secure workspace", "Business data stays separated by workspace."],
              ["Built for teams", "Invite staff and control access by role."],
              ["Ready to scale", "Add more businesses and features as you grow."],
            ].map(([title, detail]) => (
              <div key={title} className="flex items-start gap-3">
                <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f5b544] text-[#182230]">
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m5 10 3 3 7-7" /></svg>
                </span>
                <div><p className="text-sm font-semibold text-white">{title}</p><p className="mt-1 text-xs leading-5 text-[#8392a8]">{detail}</p></div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-[#718198]">© {new Date().getFullYear()} Business Soft · Secure business workspace</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-8 lg:px-12 xl:px-16">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><div className="flex items-center gap-3"><BrandMark /><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#98a2b3]">Business Soft</p><p className="text-sm font-semibold text-[#101828]">Ganpati Neer ERP</p></div></div></div>

          <div className="rounded-2xl border border-[#e4e7ec] bg-white p-6 shadow-[0_10px_35px_rgba(16,24,40,0.06)] sm:p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#465fff]">{isForgotPassword ? "Account recovery" : isSignUp ? "New workspace user" : "Welcome back"}</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#101828]">{isForgotPassword ? "Reset your password" : isSignUp ? "Create your account" : "Sign in to your workspace"}</h2>
              <p className="mt-2 text-sm leading-6 text-[#667085]">{isForgotPassword ? "Enter your email and we’ll send you a secure reset link." : isSignUp ? "Create an account, then set up your first business." : "Continue to your business dashboard."}</p>
            </div>

            <form onSubmit={handleSubmit} className="mt-7 space-y-4">
              {isSignUp && (
                <label className="block text-sm font-medium text-[#344054]">
                  Full name
                  <input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="mt-2 h-11 w-full rounded-lg border border-[#d0d5dd] bg-white px-3 text-sm text-[#101828] outline-none transition focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10" placeholder="Your name" />
                </label>
              )}

              <label className="block text-sm font-medium text-[#344054]">
                Email address
                <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="mt-2 h-11 w-full rounded-lg border border-[#d0d5dd] bg-white px-3 text-sm text-[#101828] outline-none transition focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10" placeholder="you@company.com" />
              </label>

              {!isForgotPassword && (
                <label className="block text-sm font-medium text-[#344054]">
                  Password
                  <input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isSignUp ? "new-password" : "current-password"} className="mt-2 h-11 w-full rounded-lg border border-[#d0d5dd] bg-white px-3 text-sm text-[#101828] outline-none transition focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10" placeholder="••••••••" />
                </label>
              )}

              {!isSignUp && !isForgotPassword && (
                <div className="flex justify-end"><button type="button" onClick={() => switchMode("forgotPassword")} className="text-xs font-semibold text-[#465fff] hover:text-[#3648d8]">Forgot password?</button></div>
              )}

              {error && <div role="alert" className="rounded-lg border border-[#fecdca] bg-[#fef3f2] px-3 py-2.5 text-sm text-[#b42318]">{error}</div>}
              {notice && <div role="status" className="rounded-lg border border-[#abefc6] bg-[#ecfdf3] px-3 py-2.5 text-sm text-[#067647]">{notice}</div>}

              <button disabled={pending} type="submit" className="h-11 w-full rounded-lg bg-[#465fff] px-4 text-sm font-semibold text-white shadow-[0_7px_16px_rgba(70,95,255,0.18)] transition hover:bg-[#3648d8] disabled:cursor-not-allowed disabled:opacity-60">
                {pending ? "Please wait..." : isForgotPassword ? "Send reset link" : isSignUp ? "Create account" : "Sign in"}
              </button>
            </form>

            {!isForgotPassword && (
              <>
                <div className="my-6 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.12em] text-[#98a2b3]"><span className="h-px flex-1 bg-[#eaecf0]" />or<span className="h-px flex-1 bg-[#eaecf0]" /></div>
                <button disabled={pending} type="button" onClick={handleGoogleSignIn} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#d0d5dd] bg-white text-sm font-semibold text-[#344054] transition hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-60">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><path fill="currentColor" d="M21.8 12.23c0-.7-.06-1.37-.18-2.02H12v3.82h5.5a4.7 4.7 0 0 1-2.04 3.08v2.57h3.3c1.93-1.78 3.04-4.4 3.04-7.45Z" /><path fill="currentColor" d="M12 22c2.76 0 5.08-.91 6.77-2.32l-3.3-2.57c-.92.62-2.1.99-3.47.99-2.67 0-4.94-1.8-5.75-4.22H2.84v2.65A10.23 10.23 0 0 0 12 22Z" opacity=".82" /><path fill="currentColor" d="M6.25 13.88A6.16 6.16 0 0 1 5.93 12c0-.65.11-1.28.32-1.88V7.47H2.84A10 10 0 0 0 2 12c0 1.64.39 3.18 1.09 4.53l3.16-2.65Z" opacity=".64" /><path fill="currentColor" d="M12 5.9c1.5 0 2.84.52 3.9 1.54l2.92-2.92C17.08 2.91 14.76 2 12 2A10.23 10.23 0 0 0 2.84 7.47L6.25 10.1C7.06 7.68 9.33 5.9 12 5.9Z" opacity=".9" /></svg>
                  Continue with Google
                </button>
              </>
            )}

            <div className="mt-6 text-center text-sm text-[#667085]">
              {isForgotPassword ? (
                <button type="button" onClick={() => switchMode("signIn")} className="font-semibold text-[#465fff] hover:text-[#3648d8]">Back to sign in</button>
              ) : (
                <>{isSignUp ? "Already have an account?" : "New to Business Soft?"}{" "}<button type="button" onClick={() => switchMode(isSignUp ? "signIn" : "signUp")} className="font-semibold text-[#465fff] hover:text-[#3648d8]">{isSignUp ? "Sign in" : "Create an account"}</button></>
              )}
            </div>
          </div>

          <p className="mt-5 text-center text-xs leading-5 text-[#98a2b3]">By continuing, you agree to use this workspace only for authorized business activity.</p>
        </div>
      </section>
    </main>
  );
}
