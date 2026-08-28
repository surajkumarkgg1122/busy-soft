"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDocs, query, serverTimestamp, setDoc, Timestamp, where } from "firebase/firestore";
import Sidebar from "../../Components/Sidebar/page";
import TopNav from "../../Components/TopNav/page";
import AuthGate from "../../Components/Auth/AuthGate";
import { firestoreDb, firebaseAuth } from "../../../lib/firebase";
import { useBusiness } from "../../../context/BusinessContext";
import type { BusinessInvitation, BusinessMemberRole, MemberPermissions } from "../../../types";

const ROLES: BusinessMemberRole[] = ["admin", "manager", "accountant", "sales", "inventory", "viewer"];
const DEFAULT_PERMISSIONS: MemberPermissions = { sales: true, purchases: true, inventory: true, payments: true, expenses: false, reports: true, settings: false };

function formatDate(value: Timestamp | undefined) {
  if (!value) return "—";
  return value.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function UsersPage() {
  const { activeBusiness, activeBusinessId, loading: businessLoading } = useBusiness();
  const [members, setMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<BusinessInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<BusinessMemberRole>("sales");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    if (!firestoreDb || !activeBusinessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const memberSnap = await getDocs(collection(firestoreDb, "businesses", activeBusinessId, "members"));
      setMembers(memberSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      const invitationSnap = await getDocs(query(collection(firestoreDb, "invitations"), where("businessId", "==", activeBusinessId)));
      setInvitations(invitationSnap.docs.map(d => d.data() as BusinessInvitation).filter(i => i.status === "pending"));
    } catch (e) { console.error(e); setError("Could not load users and invitations."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (!businessLoading) load(); }, [activeBusinessId, businessLoading]);

  async function invite() {
    const invitedEmail = email.trim().toLowerCase();
    if (!invitedEmail || !activeBusinessId || !firebaseAuth?.currentUser || !firestoreDb) return;
    if (!/^\S+@\S+\.\S+$/.test(invitedEmail)) { setError("Enter a valid email address."); return; }
    if (invitedEmail === firebaseAuth.currentUser.email?.toLowerCase()) { setError("You are already a member of this business."); return; }
    if (invitations.some(i => i.invitedEmail === invitedEmail)) { setError("A pending invitation already exists for this email."); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      const invitationRef = doc(collection(firestoreDb, "invitations"));
      const now = Timestamp.now();
      const invitation: BusinessInvitation = {
        invitationId: invitationRef.id,
        businessId: activeBusinessId,
        invitedEmail,
        role,
        permissions: DEFAULT_PERMISSIONS,
        status: "pending",
        invitedBy: firebaseAuth.currentUser.uid,
        createdAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000),
      };
      await setDoc(invitationRef, invitation);
      setEmail("");
      setMessage("Invitation created. Share the invitation link with the user.");
      await load();
    } catch (e) { console.error(e); setError("Could not create invitation. Check your permissions."); }
    finally { setSaving(false); }
  }

  function invitationLink(id: string) { return `${window.location.origin}/join/${id}`; }

  return <AuthGate><div className="flex min-h-screen bg-[#f8f7f4]"><Sidebar/><main className="min-w-0 flex-1 px-4 pb-10 sm:px-6 lg:px-8"><TopNav/><div className="mx-auto max-w-[1450px] py-5">
    <div className="mb-6"><p className="text-sm font-semibold text-[#4f46e5]">Administration</p><h1 className="mt-1 text-3xl font-bold text-[#182230]">Users & Roles</h1><p className="mt-2 text-sm text-[#667085]">Manage who can access {activeBusiness?.business.name || "this business"}.</p></div>
    {message && <div className="mb-4 rounded-xl border border-[#abefc6] bg-[#ecfdf3] px-4 py-3 text-sm text-[#067647]">{message}</div>}{error && <div className="mb-4 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
    <div className="grid gap-5 xl:grid-cols-[1.4fr_.8fr]">
      <section className="rounded-2xl border border-[#e7e5e4] bg-white"><div className="border-b border-[#eaecf0] px-5 py-4"><h2 className="font-bold text-[#182230]">Business members</h2></div><div className="divide-y divide-[#f2f4f7]">{loading ? <div className="p-8 text-sm text-[#667085]">Loading…</div> : members.map(member => <div key={member.id} className="flex items-center gap-4 px-5 py-4"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eeedff] text-sm font-bold text-[#4f46e5]">{member.role?.slice(0,1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold capitalize text-[#344054]">{member.role}</p><p className="text-xs text-[#98a2b3]">{member.uid === activeBusiness?.business.ownerId ? "Owner" : member.uid}</p></div><span className="rounded-full bg-[#ecfdf3] px-2.5 py-1 text-xs font-semibold text-[#067647]">{member.status}</span></div>)}</div></section>
      <section className="rounded-2xl border border-[#e7e5e4] bg-white p-5"><h2 className="font-bold text-[#182230]">Invite user</h2><p className="mt-1 text-xs leading-5 text-[#667085]">Create a secure invitation for someone to join this business.</p><div className="mt-5 space-y-4"><label className="block text-sm font-semibold text-[#344054]">Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="employee@example.com" className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal outline-none focus:border-[#4f46e5]"/></label><label className="block text-sm font-semibold text-[#344054]">Role<select value={role} onChange={e=>setRole(e.target.value as BusinessMemberRole)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal">{ROLES.map(r=><option key={r} value={r}>{r[0].toUpperCase()+r.slice(1)}</option>)}</select></label><button onClick={invite} disabled={saving || !email.trim()} className="h-11 w-full rounded-xl bg-[#4f46e5] text-sm font-semibold text-white disabled:opacity-50">{saving?"Creating…":"Create invitation"}</button></div></section>
    </div>
    <section className="mt-5 rounded-2xl border border-[#e7e5e4] bg-white"><div className="border-b border-[#eaecf0] px-5 py-4"><h2 className="font-bold text-[#182230]">Pending invitations</h2></div>{invitations.length===0?<p className="p-6 text-sm text-[#98a2b3]">No pending invitations.</p>:<div className="divide-y divide-[#f2f4f7]">{invitations.map(inv=><div key={inv.invitationId} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[#344054]">{inv.invitedEmail}</p><p className="text-xs text-[#98a2b3]">{inv.role} · expires {formatDate(inv.expiresAt)}</p></div><button onClick={()=>navigator.clipboard.writeText(invitationLink(inv.invitationId))} className="rounded-lg border border-[#d0d5dd] px-3 py-2 text-xs font-semibold text-[#344054]">Copy invite link</button></div>)}</div>}</section>
  </div></main></div></AuthGate>;
}
