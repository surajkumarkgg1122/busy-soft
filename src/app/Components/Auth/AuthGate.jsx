"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import AuthForm from "./AuthForm";
import { firebaseAuth, firebaseConfigured } from "../../../lib/firebase";
import { useBusiness } from "../../../context/BusinessContext";

export default function AuthGate({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { memberships, loading: businessLoading } = useBusiness();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(firebaseConfigured);

  useEffect(() => {
    if (!firebaseConfigured || !firebaseAuth) {
      setLoading(false);
      return undefined;
    }

    return onAuthStateChanged(firebaseAuth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (loading || businessLoading || !user) return;
    if (pathname !== "/" || memberships.length > 0) return;
    router.replace("/onboarding/business");
  }, [loading, businessLoading, user, memberships.length, pathname, router]);

  if (loading || (user && businessLoading)) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] text-sm text-[#667085]">Loading your workspace...</div>;
  }

  if (!user) return <AuthForm />;

  if (pathname === "/" && memberships.length === 0) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] text-sm text-[#667085]">Opening business setup...</div>;
  }

  return children;
}
