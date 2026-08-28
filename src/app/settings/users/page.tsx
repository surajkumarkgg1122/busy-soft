"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, query, Timestamp, where } from "firebase/firestore";
import Sidebar from "../../Components/Sidebar/page";
import TopNav from "../../Components/TopNav/page";
import AuthGate from "../../Components/Auth/AuthGate";
import { firestoreDb, firebaseAuth } from "../../../lib/firebase";
import { useBusiness } from "../../../context/BusinessContext";
import type { BusinessInvitation, BusinessMemberRole, GranularPermissions } from "../../../types";

type MemberRow = { uid: string; role: BusinessMemberRole; status: "active" | "invited" | "disabled"; joinedAt?: Timestamp; name?: string; email?: string };

const ROLES: BusinessMemberRole[] = ["admin", "manager", "accountant", "sales", "inventory", "viewer"];
const ROLE_PERMISSIONS: Record<string, GranularPermissions> = {
  admin: { sales:{view:true,create:true,edit:true,delete:true,print:true,export:true,approve:true}, purchases:{view:true,create:true,edit:true,delete:true,print:true,export:true,approve:true}, inventory:{view:true,create:true,edit:true,delete:true,print:true,export:true}, payments:{view:true,create:true,edit:true,delete:true,print:true,export:true}, expenses:{view:true,create:true,edit:true,delete:true,print:true,export:true}, reports:{view:true,print:true,export:true}, settings:{view:true,create:true,edit:true}, parties:{view:true,create:true,edit:true,delete:true,export:true}, items:{view:true,create:true,edit:true,delete:true,export:true}, cashBank:{view:true,create:true,edit:true,delete:true,print:true,export:true}, gst:{view:true,create:true,edit:true,delete:true,export:true} },
  manager: { sales:{view:true,create:true,edit:true,print:true,export:true}, purchases:{view:true,create:true,edit:true,print:true,export:true}, inventory:{view:true,create:true,edit:true,print:true,export:true}, payments:{view:true,create:true,edit:true,print:true}, expenses:{view:true,create:true,edit:true}, reports:{view:true,print:true,export:true}, parties:{view:true,create:true,edit:true}, items:{view:true,create:true,edit:true}, cashBank:{view:true,create:true,edit:true,print:true}, gst:{view:true,export:true} },
  accountant: { sales:{view:true,create:true,edit:true,print:true,export:true}, purchases:{view:true,create:true,edit:true,print:true,export:true}, inventory:{view:true,export:true}, payments:{view:true,create:true,edit:true,print:true,export:true}, expenses:{view:true,create:true,edit:true,print:true,export:true}, reports:{view:true,print:true,export:true}, parties:{view:true,create:true,edit:true,export:true}, items:{view:true,export:true}, cashBank:{view:true,create:true,edit:true,print:true,export:true}, gst:{view:true,export:true} },
  sales: { sales:{view:true,create:true,edit:true,print:true}, parties:{view:true,create:true,edit:true}, items:{view:true}, payments:{view:true,create:true,print:true} },
  inventory: { inventory:{view:true,create:true,edit:true,print:true}, items:{view:true,create:true,edit:true}, parties:{view:true} },
  viewer: { sales:{view:true,print:true}, purchases:{view:true,print:true}, inventory:{view:true}, payments:{view:true}, expenses:{view:true}, reports:{view:true,print:true}, parties:{view:true}, items:{view:true}, cashBank:{view:true}, gst:{view:true} },
};

function formatDate(value?: Timestamp) { return value ? value.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"; }
function rolePermissions(role: BusinessMemberRole): GranularPermissions { return JSON.parse(JSON.stringify(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer)); }

export default function UsersPage() {
  const { activeBusiness, activeBusinessId, loading: businessLoading, canManageUsers } = useBusiness();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<BusinessInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<BusinessMemberRole>("sales");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const currentUid = firebaseAuth?.currentUser?.uid;
  const ownerId = activeBusiness?.business.ownerId;
  const activeCount = useMemo(() => members.filter((m) => m.status === "active").length, [members]);

  async function load() {
    if (!firestoreDb || !activeBusinessId) { setMembers([]); setInvitations([]); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const memberSnapshot = await getDocs(collection(firestoreDb, "businesses", activeBusinessId, "members"));
      setMembers(memberSnapshot.docs.map((snapshot) => { const data = snapshot.data() as Record<string, unknown>; return { uid: snapshot.id, role: (data.role as BusinessMemberRole) || "viewer", status: (data.status as MemberRow["status"]) || "active", joinedAt: data.joinedAt as Timestamp | undefined, name: data.name as string | undefined, email: data.email as string | undefined }; }));
      const invitationSnapshot = await getDocs(query(collection(firestoreDb, "invitations"), where("businessId", "==", activeBusinessId)));
      setInvitations(invitationSnapshot.docs.map((snapshot) => snapshot.data() as BusinessInvitation).filter((invitation) => invitation.status === "pending" && invitation.expiresAt.toMillis() > Date.now()));
    } catch (err) { console.error(err); setError("Could not load users and invitations. Check your Firestore rules and active business."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (!businessLoading) void load(); }, [activeBusinessId, businessLoading]);

  async function createInvitation() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!canManageUsers || !firestoreDb || !activeBusinessId || !currentUid) return;
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) { setError("Enter a valid email address."); return; }
    if (members.some((member) => member.email?.toLowerCase() === normalizedEmail && member.status === "active")) { setError("This email is already a member of the business."); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      const invitationRef = doc(collection(firestoreDb, "invitations"));
      const now = Timestamp.now();
      const { setDoc } = await import("firebase/firestore");
      await setDoc(invitationRef, { invitationId: invitationRef.id, businessId: activeBusinessId, invitedEmail: normalizedEmail, role, permissions: rolePermissions(role), status: "pending", invitedBy: currentUid, createdAt: now, expiresAt: Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000) });
      setEmail(""); setMessage("Invitation created. Copy the invitation link and send it to the user."); await load();
    } catch (err) { console.error(err); setError("Could not create the invitation."); }
    finally { setSaving(false); }
  }

  async function copyInviteLink(invitationId: string) { try { await navigator.clipboard.writeText(`${window.location.origin}/join/${invitationId}`); setMessage("Invitation link copied."); } catch { setError("Could not copy the invitation link."); } }

  return <AuthGate><div className="flex min-h-screen bg-[#f8f7f4]"><Sidebar/><main className="min-w-0 flex-1 px-4 pb-10 sm:px-6 lg:px-8"><TopNav/><div className="mx-auto max-w-[1450px] py-5"><div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-semibold text-[#4f46e5]">Administration</p><h1 className="mt-1 text-3xl font-bold text-[#182230]">Users & Roles</h1><p className="mt-2 text-sm text-[#667085]">Control who can access {activeBusiness?.business.name || "this business"} and what they can do.</p></div><div className="flex gap-2 text-xs font-semibold"><span className="rounded-full bg-white px-3 py-2 text-[#475467] shadow-sm ring-1 ring-[#e4e7ec]">{members.length} members</span><span className="rounded-full bg-[#ecfdf3] px-3 py-2 text-[#067647]">{activeCount} active</span></div></div>{!canManageUsers&&<div className="mb-5 rounded-xl border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm text-[#b54708]">You have view-only access. Only the business owner or an administrator can manage users.</div>}{message&&<div className="mb-4 rounded-xl border border-[#abefc6] bg-[#ecfdf3] px-4 py-3 text-sm text-[#067647]">{message}</div>}{error&&<div className="mb-4 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}<div className="grid gap-5 xl:grid-cols-[1.5fr_.5fr]"><section className="overflow-hidden rounded-2xl border border-[#e7e5e4] bg-white"><div className="flex items-center justify-between border-b border-[#eaecf0] px-5 py-4"><div><h2 className="font-bold text-[#182230]">Business members</h2><p className="mt-1 text-xs text-[#98a2b3]">Manage role, status and granular permissions from the member page.</p></div><span className="rounded-full bg-[#f2f4f7] px-2.5 py-1 text-xs font-semibold text-[#667085]">{members.length}</span></div>{loading?<div className="p-8 text-sm text-[#667085]">Loading members…</div>:members.length===0?<div className="p-10 text-center text-sm text-[#667085]">No members found for the active business.</div>:<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-[#f8f9fc] text-xs font-semibold uppercase tracking-wide text-[#667085]"><tr><th className="px-5 py-3">User</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Joined</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-[#f2f4f7] text-sm">{members.map((member)=>{const isOwner=member.uid===ownerId;const displayName=isOwner?"Business Owner":member.name||member.email||`User ${member.uid.slice(0,8)}`;return <tr key={member.uid} className="hover:bg-[#fafafa]"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eeedff] text-sm font-bold text-[#4f46e5]">{(displayName[0]||"U").toUpperCase()}</div><div className="min-w-0"><p className="truncate font-semibold text-[#344054]">{displayName}</p><p className="truncate text-xs text-[#98a2b3]">{member.email||`UID: ${member.uid}`}</p></div></div></td><td className="px-4 py-4"><span className="rounded-lg bg-[#f2f4f7] px-2.5 py-1 text-xs font-semibold capitalize text-[#475467]">{isOwner?"Owner":member.role}</span></td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${member.status==="active"?"bg-[#ecfdf3] text-[#067647]":"bg-[#fef3f2] text-[#b42318]"}`}>{member.status}</span></td><td className="px-4 py-4 text-xs text-[#667085]">{formatDate(member.joinedAt)}</td><td className="px-5 py-4 text-right">{isOwner?<span className="text-xs font-semibold text-[#98a2b3]">Protected</span>:<Link href={`/settings/users/${member.uid}`} className={`inline-flex rounded-lg border px-3 py-2 text-xs font-semibold ${canManageUsers?"border-[#d0d5dd] text-[#344054] hover:bg-[#f8f9fc]":"border-[#eaecf0] text-[#98a2b3]"}`}>{canManageUsers?"Manage":"View"}</Link>}</td></tr>})}</tbody></table></div>}</section><section className="rounded-2xl border border-[#e7e5e4] bg-white p-5"><h2 className="font-bold text-[#182230]">Invite user</h2><p className="mt-1 text-xs text-[#667085]">Invite another person to this business without giving them access to your other companies.</p><div className="mt-5 space-y-4"><label className="block text-xs font-semibold text-[#344054]">Email address<input value={email} onChange={(e)=>setEmail(e.target.value)} type="email" placeholder="employee@example.com" disabled={!canManageUsers||saving} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#4f46e5] disabled:bg-[#f2f4f7]"/></label><label className="block text-xs font-semibold text-[#344054]">Initial role<select value={role} onChange={(e)=>setRole(e.target.value as BusinessMemberRole)} disabled={!canManageUsers||saving} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm disabled:bg-[#f2f4f7]">{ROLES.map((item)=><option key={item} value={item}>{item[0].toUpperCase()+item.slice(1)}</option>)}</select></label><button type="button" onClick={createInvitation} disabled={!canManageUsers||saving||!email.trim()} className="h-11 w-full rounded-xl bg-[#4f46e5] text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving?"Creating…":"Create invitation"}</button></div></section></div><section className="mt-5 overflow-hidden rounded-2xl border border-[#e7e5e4] bg-white"><div className="border-b border-[#eaecf0] px-5 py-4"><h2 className="font-bold text-[#182230]">Pending invitations</h2><p className="mt-1 text-xs text-[#98a2b3]">Invitations expire after 7 days.</p></div>{invitations.length===0?<p className="p-6 text-sm text-[#98a2b3]">No pending invitations.</p>:<div className="divide-y divide-[#f2f4f7]">{invitations.map((invitation)=><div key={invitation.invitationId} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-[#344054]">{invitation.invitedEmail}</p><p className="mt-1 text-xs capitalize text-[#98a2b3]">Role: {invitation.role} · Expires {formatDate(invitation.expiresAt)}</p></div><button type="button" onClick={()=>copyInviteLink(invitation.invitationId)} disabled={!canManageUsers} className="rounded-lg border border-[#d0d5dd] px-3 py-2 text-xs font-semibold text-[#344054] disabled:opacity-40">Copy invite link</button></div>)}</div>}</section></div></main></div></AuthGate>;
}
