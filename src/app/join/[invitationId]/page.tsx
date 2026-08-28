"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, runTransaction, Timestamp } from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import { firestoreDb, firebaseAuth } from "../../../lib/firebase";
import { useBusiness } from "../../../context/BusinessContext";
import type { BusinessInvitation, BusinessMember, UserBusinessMembership } from "../../../types";

export default function JoinBusinessPage() {
  const params = useParams<{ invitationId: string }>();
  const router = useRouter();
  const { user, loading: businessLoading, refreshBusinesses, selectBusiness } = useBusiness();
  const [invitation, setInvitation] = useState<BusinessInvitation | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (businessLoading) return;
      if (!firebaseAuth?.currentUser) { router.replace("/"); return; }
      if (!firestoreDb || !params.invitationId) return;
      try {
        const snap = await getDoc(doc(firestoreDb, "invitations", params.invitationId));
        if (!snap.exists()) { setError("This invitation does not exist."); return; }
        const data = snap.data() as BusinessInvitation;
        if (data.status !== "pending") { setError(`This invitation is already ${data.status}.`); return; }
        if (data.expiresAt.toMillis() < Date.now()) { setError("This invitation has expired."); return; }
        if (data.invitedEmail.toLowerCase() !== (firebaseAuth.currentUser.email || "").toLowerCase()) { setError("This invitation was sent to a different email address."); return; }
        const businessSnap = await getDoc(doc(firestoreDb, "businesses", data.businessId));
        if (!businessSnap.exists()) { setError("The business no longer exists."); return; }
        setInvitation(data); setBusinessName((businessSnap.data().name as string) || "Business");
      } catch (e) { console.error(e); setError("Could not load this invitation."); }
      finally { setLoading(false); }
    }
    load();
  }, [params.invitationId, businessLoading, router]);

  async function respond(accept: boolean) {
    if (!invitation || !firebaseAuth?.currentUser || !firestoreDb) return;
    setSaving(true); setError("");
    try {
      const uid = firebaseAuth.currentUser.uid;
      await runTransaction(firestoreDb, async tx => {
        const invitationRef = doc(firestoreDb, "invitations", invitation.invitationId);
        const businessRef = doc(firestoreDb, "businesses", invitation.businessId);
        const memberRef = doc(firestoreDb, "businesses", invitation.businessId, "members", uid);
        const userMembershipRef = doc(firestoreDb, "users", uid, "businessMemberships", invitation.businessId);
        const [invSnap, businessSnap] = await Promise.all([tx.get(invitationRef), tx.get(businessRef)]);
        if (!invSnap.exists() || !businessSnap.exists()) throw new Error("Invitation is no longer available.");
        const current = invSnap.data() as BusinessInvitation;
        if (current.status !== "pending" || current.expiresAt.toMillis() < Date.now()) throw new Error("This invitation is no longer valid.");
        if (current.invitedEmail.toLowerCase() !== (firebaseAuth.currentUser?.email || "").toLowerCase()) throw new Error("This invitation belongs to another email.");
        const now = Timestamp.now();
        tx.update(invitationRef, { status: accept ? "accepted" : "rejected", respondedAt: now });
        if (accept) {
          const name = user?.displayName?.trim() || firebaseAuth.currentUser.email?.split("@")[0] || "User";
          const email = firebaseAuth.currentUser.email || current.invitedEmail;
          const member: BusinessMember & { name: string; email: string } = { uid, role: current.role, status: "active", permissions: current.permissions, joinedAt: now, invitedBy: current.invitedBy, invitationId: current.invitationId, name, email };
          const index: UserBusinessMembership & { name: string; email: string } = { ...member, businessId: current.businessId };
          tx.set(memberRef, member);
          tx.set(userMembershipRef, index);
        }
      });
      if (accept) { await refreshBusinesses(); selectBusiness(invitation.businessId); router.replace("/"); }
      else router.replace("/");
    } catch (e) { console.error(e); setError(e instanceof Error ? e.message : "Could not process invitation."); }
    finally { setSaving(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#f8f7f4] px-5"><section className="w-full max-w-md rounded-3xl border border-[#e7e5e4] bg-white p-8 text-center shadow-xl"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eeedff] text-xl font-black text-[#4f46e5]">B</div><p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-[#4f46e5]">Business Soft</p><h1 className="mt-2 text-2xl font-bold text-[#182230]">Join {businessName || "business"}</h1>{loading?<p className="mt-4 text-sm text-[#667085]">Checking invitation…</p>:error?<div className="mt-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] p-4 text-sm text-[#b42318]">{error}</div>:invitation&&<><p className="mt-3 text-sm text-[#667085]">You have been invited as <strong className="capitalize text-[#344054]">{invitation.role}</strong>.</p><div className="mt-6 grid grid-cols-2 gap-3"><button onClick={()=>respond(false)} disabled={saving} className="h-11 rounded-xl border border-[#d0d5dd] text-sm font-semibold text-[#344054]">Decline</button><button onClick={()=>respond(true)} disabled={saving} className="h-11 rounded-xl bg-[#4f46e5] text-sm font-semibold text-white">{saving?"Joining…":"Accept & join"}</button></div></>}</section></main>;
}
