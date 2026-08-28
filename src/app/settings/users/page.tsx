"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, query, Timestamp, updateDoc, where } from "firebase/firestore";
import Sidebar from "../../Components/Sidebar/page";
import TopNav from "../../Components/TopNav/page";
import AuthGate from "../../Components/Auth/AuthGate";
import { firestoreDb, firebaseAuth } from "../../../lib/firebase";
import { useBusiness } from "../../../context/BusinessContext";
import type { BusinessInvitation, BusinessMemberRole, MemberPermissions } from "../../../types";

const ROLES: BusinessMemberRole[] = ["admin", "manager", "accountant", "sales", "inventory", "viewer"];
const PERMISSIONS: { key: keyof MemberPermissions; label: string }[] = [
  { key: "sales", label: "Sales" }, { key: "purchases", label: "Purchases" }, { key: "inventory", label: "Inventory" },
  { key: "payments", label: "Payments" }, { key: "expenses", label: "Expenses" }, { key: "reports", label: "Reports" }, { key: "settings", label: "Settings" },
];
const DEFAULT_PERMISSIONS: MemberPermissions = { sales: true, purchases: true, inventory: true, payments: true, expenses: false, reports: true, settings: false };

export default function UsersPage() {
  const { activeBusiness, activeBusinessId, loading: businessLoading } = useBusiness();
  const [members, setMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<BusinessInvitation[]>([]);
  const [email, setEmail] = useState(""); const [role, setRole] = useState<BusinessMemberRole>("sales");
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [editRole, setEditRole] = useState<BusinessMemberRole>("sales");
  const [editPermissions, setEditPermissions] = useState<MemberPermissions>(DEFAULT_PERMISSIONS);

  const isManager = useMemo(() => members.some(m => m.uid === firebaseAuth?.currentUser?.uid && ["owner", "admin"].includes(m.role)), [members]);

  async function load() {
    if (!firestoreDb || !activeBusinessId) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const memberSnap = await getDocs(collection(firestoreDb, "businesses", activeBusinessId, "members"));
      setMembers(memberSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      const invitationSnap = await getDocs(query(collection(firestoreDb, "invitations"), where("businessId", "==", activeBusinessId)));
      setInvitations(invitationSnap.docs.map(d => d.data() as BusinessInvitation).filter(i => i.status === "pending"));
    } catch (e) { console.error(e); setError("Could not load users and invitations."); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (!businessLoading) load(); }, [activeBusinessId, businessLoading]);

  function openMember(member: any) {
    setSelected(member); setEditRole(member.role); setEditPermissions({ ...DEFAULT_PERMISSIONS, ...(member.permissions || {}) }); setMessage(""); setError("");
  }
  async function saveMember() {
    if (!selected || !activeBusinessId || !firestoreDb || !isManager) return;
    if (selected.uid === activeBusiness?.business.ownerId) { setError("The business owner cannot be changed from this screen."); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      const memberRef = doc(firestoreDb, "businesses", activeBusinessId, "members", selected.uid);
      const userMembershipRef = doc(firestoreDb, "users", selected.uid, "businessMemberships", activeBusinessId);
      await updateDoc(memberRef, { role: editRole, permissions: editPermissions, updatedAt: Timestamp.now() });
      // The user-side membership is an index used by the company selector. Keep it synchronized.
      await updateDoc(userMembershipRef, { role: editRole, permissions: editPermissions });
      setSelected(null); setMessage("User role and permissions updated."); await load();
    } catch (e) { console.error(e); setError("Could not update this user. Check your permissions."); }
    finally { setSaving(false); }
  }
  async function setStatus(member: any, status: "active" | "disabled") {
    if (!activeBusinessId || !firestoreDb || !isManager || member.uid === activeBusiness?.business.ownerId) return;
    setSaving(true); setError("");
    try {
      await updateDoc(doc(firestoreDb, "businesses", activeBusinessId, "members", member.uid), { status });
      await updateDoc(doc(firestoreDb, "users", member.uid, "businessMemberships", activeBusinessId), { status });
      setMessage(status === "disabled" ? "User access disabled." : "User access restored."); await load();
    } catch (e) { console.error(e); setError("Could not change user status."); }
    finally { setSaving(false); }
  }

  async function invite() {
    const invitedEmail = email.trim().toLowerCase();
    if (!invitedEmail || !activeBusinessId || !firebaseAuth?.currentUser || !firestoreDb || !isManager) return;
    if (!/^\S+@\S+\.\S+$/.test(invitedEmail)) { setError("Enter a valid email address."); return; }
    if (invitedEmail === firebaseAuth.currentUser.email?.toLowerCase()) { setError("You are already a member of this business."); return; }
    if (invitations.some(i => i.invitedEmail === invitedEmail)) { setError("A pending invitation already exists for this email."); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      const invitationRef = doc(collection(firestoreDb, "invitations")); const now = Timestamp.now();
      const invitation: BusinessInvitation = { invitationId: invitationRef.id, businessId: activeBusinessId, invitedEmail, role, permissions: DEFAULT_PERMISSIONS, status: "pending", invitedBy: firebaseAuth.currentUser.uid, createdAt: now, expiresAt: Timestamp.fromMillis(now.toMillis() + 7 * 86400000) };
      const { setDoc } = await import("firebase/firestore"); await setDoc(invitationRef, invitation);
      setEmail(""); setMessage("Invitation created. Share the invitation link with the user."); await load();
    } catch (e) { console.error(e); setError("Could not create invitation. Check your permissions."); }
    finally { setSaving(false); }
  }
  function invitationLink(id: string) { return `${window.location.origin}/join/${id}`; }

  return <AuthGate><div className="flex min-h-screen bg-[#f8f7f4]"><Sidebar/><main className="min-w-0 flex-1 px-4 pb-10 sm:px-6 lg:px-8"><TopNav/><div className="mx-auto max-w-[1450px] py-5">
    <div className="mb-6"><p className="text-sm font-semibold text-[#4f46e5]">Administration</p><h1 className="mt-1 text-3xl font-bold text-[#182230]">Users & Roles</h1><p className="mt-2 text-sm text-[#667085]">Manage access to {activeBusiness?.business.name || "this business"}.</p></div>
    {message && <div className="mb-4 rounded-xl border border-[#abefc6] bg-[#ecfdf3] px-4 py-3 text-sm text-[#067647]">{message}</div>}{error && <div className="mb-4 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
    <div className="grid gap-5 xl:grid-cols-[1.4fr_.8fr]">
      <section className="rounded-2xl border border-[#e7e5e4] bg-white"><div className="flex items-center justify-between border-b border-[#eaecf0] px-5 py-4"><div><h2 className="font-bold text-[#182230]">Business members</h2><p className="text-xs text-[#98a2b3]">Click a member to manage role and permissions.</p></div><span className="rounded-full bg-[#f2f4f7] px-2.5 py-1 text-xs font-semibold text-[#667085]">{members.length} users</span></div><div className="divide-y divide-[#f2f4f7]">
        {loading ? <div className="p-8 text-sm text-[#667085]">Loading…</div> : members.map(member => <div key={member.id} className="flex items-center gap-4 px-5 py-4"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eeedff] text-sm font-bold text-[#4f46e5]">{member.role?.slice(0,1).toUpperCase()}</div><button type="button" onClick={()=>openMember(member)} className="min-w-0 flex-1 text-left"><p className="text-sm font-semibold capitalize text-[#344054]">{member.uid === activeBusiness?.business.ownerId ? "Owner" : member.role}</p><p className="truncate text-xs text-[#98a2b3]">{member.uid}</p></button><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${member.status === "active" ? "bg-[#ecfdf3] text-[#067647]" : "bg-[#fef3f2] text-[#b42318]"}`}>{member.status}</span><button type="button" onClick={()=>openMember(member)} className="rounded-lg border border-[#d0d5dd] px-3 py-2 text-xs font-semibold text-[#344054]">Manage</button></div>)}
      </div></section>
      <section className="rounded-2xl border border-[#e7e5e4] bg-white p-5"><h2 className="font-bold text-[#182230]">Invite user</h2><p className="mt-1 text-xs leading-5 text-[#667085]">Create a secure invitation and assign the initial role.</p><div className="mt-5 space-y-4"><label className="block text-sm font-semibold text-[#344054]">Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="employee@example.com" disabled={!isManager} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal outline-none focus:border-[#4f46e5] disabled:bg-[#f2f4f7]"/></label><label className="block text-sm font-semibold text-[#344054]">Role<select value={role} onChange={e=>setRole(e.target.value as BusinessMemberRole)} disabled={!isManager} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal disabled:bg-[#f2f4f7]">{ROLES.map(r=><option key={r}>{r[0].toUpperCase()+r.slice(1)}</option>)}</select></label><button onClick={invite} disabled={saving || !email.trim() || !isManager} className="h-11 w-full rounded-xl bg-[#4f46e5] text-sm font-semibold text-white disabled:opacity-50">{saving?"Working…":"Create invitation"}</button></div></section>
    </div>
    <section className="mt-5 rounded-2xl border border-[#e7e5e4] bg-white"><div className="border-b border-[#eaecf0] px-5 py-4"><h2 className="font-bold text-[#182230]">Pending invitations</h2></div>{invitations.length===0?<p className="p-6 text-sm text-[#98a2b3]">No pending invitations.</p>:<div className="divide-y divide-[#f2f4f7]">{invitations.map(inv=><div key={inv.invitationId} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[#344054]">{inv.invitedEmail}</p><p className="text-xs capitalize text-[#98a2b3]">{inv.role} · expires {inv.expiresAt?.toDate?.().toLocaleDateString("en-IN") || "—"}</p></div><button onClick={()=>navigator.clipboard.writeText(invitationLink(inv.invitationId))} className="rounded-lg border border-[#d0d5dd] px-3 py-2 text-xs font-semibold text-[#344054]">Copy invite link</button></div>)}</div>}</section>
    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#eaecf0] px-5 py-4"><div><h2 className="font-bold text-[#182230]">Manage user</h2><p className="mt-1 text-xs text-[#98a2b3]">{selected.uid}</p></div><button onClick={()=>setSelected(null)} className="text-xl text-[#667085]">×</button></div><div className="space-y-5 p-5"><label className="block text-sm font-semibold text-[#344054]">Role<select value={editRole} onChange={e=>setEditRole(e.target.value as BusinessMemberRole)} disabled={selected.uid === activeBusiness?.business.ownerId || !isManager} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 disabled:bg-[#f2f4f7]">{["owner", ...ROLES].map(r=><option key={r}>{r[0].toUpperCase()+r.slice(1)}</option>)}</select></label><div><p className="text-sm font-semibold text-[#344054]">Permissions</p><div className="mt-2 grid grid-cols-2 gap-2">{PERMISSIONS.map(p=><label key={p.key} className="flex items-center gap-2 rounded-lg border border-[#eaecf0] px-3 py-2 text-sm text-[#475467]"><input type="checkbox" checked={Boolean(editPermissions[p.key])} onChange={e=>setEditPermissions(v=>({...v,[p.key]:e.target.checked}))} disabled={selected.uid === activeBusiness?.business.ownerId || !isManager}/>{p.label}</label>)}</div></div><div className="flex gap-2"><button onClick={saveMember} disabled={saving || !isManager || selected.uid === activeBusiness?.business.ownerId} className="flex-1 rounded-xl bg-[#4f46e5] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?"Saving…":"Save changes"}</button>{selected.uid !== activeBusiness?.business.ownerId && <button onClick={()=>setStatus(selected, selected.status === "active" ? "disabled" : "active")} disabled={saving || !isManager} className="rounded-xl border border-[#d0d5dd] px-4 py-2.5 text-sm font-semibold text-[#344054]">{selected.status === "active" ? "Disable access" : "Enable access"}</button>}</div></div></div></div>}
  </div></main></div></AuthGate>;
}
