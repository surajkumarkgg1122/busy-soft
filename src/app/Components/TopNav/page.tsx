"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { firebaseAuth } from "../../../lib/firebase";
import BusinessSelector from "../BusinessSelector/page";

const pageNames = {
  "/": "Dashboard",
  "/customers": "Customers",
  "/items": "Items",
  "/sales": "Sales",
  "/payments": "Payments",
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

export default function TopNav() {
  const pathname = usePathname();
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [user, setUser] = useState(null);
  const [profileImageError, setProfileImageError] = useState(false);
  const pageName = pageNames[pathname] || "Workspace";
  const greeting = getGreeting();

  useEffect(() => {
    if (!firebaseAuth) return undefined;
    return onAuthStateChanged(firebaseAuth, (currentUser) => {
      setUser(currentUser);
      setProfileImageError(false);
    });
  }, []);

  async function handleLogout() {
    if (!firebaseAuth) return;
    try {
      setLogoutError("");
      await signOut(firebaseAuth);
    } catch (error) {
      console.error("Could not log out:", error);
      setLogoutError("Could not log out. Please try again.");
    }
  }

  const userName = user?.displayName || user?.email?.split("@")[0] || "User";
  const userInitials = userName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const profileImageUrl = user?.photoURL || user?.providerData?.find((provider) => provider.photoURL)?.photoURL;

  return (
    <header className="sticky top-0 z-20 -mx-5 mb-7 border-b border-[#e4e7ec] bg-white/95 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
      <div className="flex min-h-11 items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-[#98a2b3]"><span>Workspace</span><span aria-hidden="true">/</span><span className="truncate font-medium text-[#667085]">{pageName}</span></div>
          <p className="mt-0.5 truncate text-sm font-semibold text-[#101828]">{pageName === "Dashboard" ? greeting : pageName}</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <BusinessSelector />
          <label className="relative hidden md:block">
            <span className="sr-only">Search workspace</span>
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98a2b3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></svg>
            <input placeholder="Search workspace" className="h-9 w-48 rounded-lg border border-[#e4e7ec] bg-[#f9fafb] pl-9 pr-3 text-sm text-[#344054] outline-none placeholder:text-[#98a2b3] focus:border-[#465fff] focus:bg-white lg:w-60" />
          </label>
          <button type="button" aria-label="Notifications" className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[#e4e7ec] text-[#667085] transition-colors hover:bg-[#f4f6fa] hover:text-[#465fff]"><svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#f04438]" /></button>
          <div className="relative">
            <button type="button" aria-label="Open account menu" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)} className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-[#f4f6fa]"><span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[#edf2ff] text-xs font-bold text-[#465fff]">{profileImageUrl && !profileImageError ? <img src={profileImageUrl} alt={`${userName} profile`} referrerPolicy="no-referrer" onError={() => setProfileImageError(true)} className="h-full w-full object-cover" /> : userInitials}</span><span className="hidden max-w-36 text-left sm:block"><span className="block truncate text-xs font-semibold text-[#344054]">{userName}</span><span className="block truncate text-[11px] text-[#98a2b3]">{user?.email || "Administrator"}</span></span><svg className="hidden h-4 w-4 text-[#98a2b3] sm:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button>
            {profileOpen && <div className="absolute right-0 top-12 z-30 w-48 rounded-lg border border-[#e4e7ec] bg-white p-1 shadow-lg"><Link href="/" className="block rounded px-3 py-2 text-sm text-[#344054] hover:bg-[#f9fafb]" onClick={() => setProfileOpen(false)}>Dashboard</Link><button type="button" onClick={() => setProfileOpen(false)} className="block w-full rounded px-3 py-2 text-left text-sm text-[#344054] hover:bg-[#f9fafb]">Close menu</button><button type="button" onClick={handleLogout} className="block w-full rounded px-3 py-2 text-left text-sm font-medium text-[#b42318] hover:bg-[#fef3f2]">Log out</button>{logoutError && <p className="px-3 py-1 text-xs text-[#b42318]">{logoutError}</p>}</div>}
          </div>
        </div>
      </div>
    </header>
  );
}
