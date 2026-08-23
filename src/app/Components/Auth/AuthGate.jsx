"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import AuthForm from "./AuthForm";
import { firebaseAuth, firebaseConfigured } from "../../../lib/firebase";

export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(firebaseConfigured);

  useEffect(() => {
    if (!firebaseConfigured) {
      return undefined;
    }

    return onAuthStateChanged(firebaseAuth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-[#667085]">Loading...</div>;
  if (!user) return <AuthForm />;

  return children;
}