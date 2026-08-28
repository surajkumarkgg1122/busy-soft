"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, Timestamp, writeBatch } from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import Sidebar from "../../../Components/Sidebar/page";
import TopNav from "../../../Components/TopNav/page";
import AuthGate from "../../../Components/Auth/AuthGate";
import { firebaseAuth, firestoreDb } from "../../../../lib/firebase";
import { useBusiness } from "../../../../context/BusinessContext";
import type { BusinessMemberRole, GranularPermissions, MemberPermissions, PermissionAction, PermissionModule } from "../../../../types";

const ROLES: BusinessMemberRole[] = ["admin", "manager", "accountant", "sales", "inventory", "viewer"];
const ACTIONS: PermissionAction[] = ["view", "create", "edit", "delete", "print", "export", "approve"];
const MODULES: { key: PermissionModule; label: string; actions: PermissionAction[] }[] = [
  { key: "sales", label: "Sales", actions: ACTIONS },
  { key: "purchases", label: "Purchases", actions: ACTIONS },
  { key: "inventory", label: "Inventory", actions: ACTIONS.filter((a) => a !== "approve") },
  { key: "payments", label: "Payments", actions: ACTIONS.filter((a) => a !== "approve") },
  { key: "expenses", label: "Expenses", actions: ACTIONS.filter((a) => a !== "approve") },
  { key: "reports", label: "Reports", actions: ["view", "print", "export"] },
  { key: "settings", label: "Settings", actions: ["view", "create", "edit", "delete"] },
  { key: "parties", label: "Parties", actions: ["view", "create", "edit", "delete", "export"] },
  { key: "items", label: "Items", actions: ["view", "create", "edit", "delete", "export"] },
  { key: "cashBank", label: "Cash & Bank", actions: ["view", "create", "edit", "delete", "print", "export"] },
  { key: "gst", label: "GST", actions: ["view", "create", "edit", "delete", "export"] },
];

const ROLE_DEFAULTS: Record<string, GranularPermissions> = {
  admin: Object.fromEntries(MODULES.map((m) => [m.key, Object.fromEntries(m.actions.map((a) => [a, true]))])),
  manager: { sales:{view:true,create:true,edit:true,print:true,export:true}, purchases:{view:true,create:true,edit:true,print:true,export:true}, inventory:{view:true,create:true,edit:true,print:true,export:true}, payments:{view:true,create:true,edit:true,print:true}, expenses:{view:true,create:true,edit:true}, reports:{view:true,print:true,export:true}, parties:{view:true,create:true,edit:true}, items:{view:true,create:true,edit:true}, cashBank:{view:true,create:true,edit:true,print:true}, gst:{view:true,export:true} },
  accountant: { sales:{view:true,create:true,edit:true,print:true,export:true}, purchases:{view:true,create:true,edit:true,print:true,export:true}, inventory:{view:true,export:true}, payments:{view:true,create:true,edit:true,print:true,export:true}, expenses:{view:true,create:true,edit:true,print:true,export:true}, reports:{view:true,print:true,export:true}, parties:{view:true,create:true,edit:true,export:true}, items:{view:true,export:true}, cashBank:{view:true,create:true,edit:true,print:true,export:true}, gst:{view:true,export:true} },
  sales: { sales:{view:true,create:true,edit:true,print:true}, parties:{view:true,create:true,edit:true}, items:{view:true}, payments:{view:true,create:true,print:true} },
  inventory: { inventory:{view:true,create:true,edit:true,print:true}, items:{view:true,create:true,edit:true}, parties:{view:true} },
  viewer: Object.fromEntries(MODULES.map((m) => [m.key, Object.fromEntries(m.actions.filter((a) => ["view", "print"].includes(a)).map((a) => [a, true]))])),
};

function cloneDefaults(role: BusinessMemberRole): GranularPermissions {
  return JSON.parse(JSON.stringify(ROLE_DEFAULTS[role] || {}));
}

function legacyFrom(permissions: GranularPermissions): MemberPermissions {
  return {
    sales: !!permissions.sales?.view,
    purchases: !!permissions.purchases?.view,
    inventory: !!permissions.inventory?.view,
    payments: !!permissions.payments?.view,
    expenses: !!permissions.expenses?.view,
    reports: !!permissions.reports?.view,
    settings: !!permissions.settings?.view,
  };
}

function normalizePermissions(value: unknown, role: BusinessMemberRole): GranularPermissions {
  const permissions = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (permissions.sales && typeof permissions.sales === "object") return permissions as GranularPermissions;
  return cloneDefaults(role);
}

function formatDate(value?: Timestamp) {
  if (!value) return "—";
  return value.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ManageUserPage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const { activeBusiness, activeBusinessId, loading: businessLoading, canManageUsers } = useBusiness();
  const [member, setMember] = useState<Record<string, unknown> | null>(null);
  const [role, setRole] = useState<BusinessMemberRole>("viewer");
  const [status, setStatus] = useState<"active" | "disabled">("active");
  const [permissions, setPermissions] = useState<GranularPermissions>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const userId = params.userId;
  const ownerId = activeBusiness?.business.ownerId;
  const isOwner = userId === ownerId;
  const displayName = (member?.name as string) || (member?.email as string) || `User ${userId?.slice(0, 8) || ""}`;
  const memberEmail = member?.email as string | undefined;
  const memberJoinedAt = member?.joinedAt as Timestamp | undefined;

  useEffect(() => {
    async function loadMember() {
      if (businessLoading) return;
      if (!firestoreDb || !activeBusinessId || !userId) return;
      setLoading(true);
      setError("");
      try {
        const snapshot = await getDoc(doc(firestoreDb, "businesses", activeBusinessId, "members", userId));
        if (!snapshot.exists()) {
          setMember(null);
          setError("This user is not a member of the active business.");
          return;
        }
        const data = snapshot.data() as Record<string, unknown>;
        const memberRole = (data.role as BusinessMemberRole) || "viewer";
        setMember(data);
        setRole(memberRole);
        setStatus((data.status as "active" | "disabled") || "active");
        setPermissions(normalizePermissions(data.permissions, memberRole));
      } catch (err) {
        console.error(err);
        setError("Could not load this user.");
      } finally {
        setLoading(false);
      }
    }
    void loadMember();
  }, [activeBusinessId, businessLoading, userId]);

  const selectedCount = useMemo(
    () => MODULES.reduce((total, module) => total + module.actions.filter((action) => permissions[module.key]?.[action]).length, 0),
    [permissions],
  );

  function toggle(module: PermissionModule, action: PermissionAction) {
    setPermissions((current) => ({
      ...current,
      [module]: {
        ...(current[module] || {}),
        [action]: !current[module]?.[action],
      },
    }));
  }

  function toggleModule(module: PermissionModule, enabled: boolean) {
    const config = MODULES.find((item) => item.key === module);
    if (!config) return;
    setPermissions((current) => ({
      ...current,
      [module]: Object.fromEntries(config.actions.map((action) => [action, enabled])),
    }));
  }

  async function save() {
    if (!canManageUsers || !firestoreDb || !activeBusinessId || !member || isOwner) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const mergedPermissions = { ...legacyFrom(permissions), ...permissions };
      const now = Timestamp.now();
      const batch = writeBatch(firestoreDb);
      batch.update(doc(firestoreDb, "businesses", activeBusinessId, "members", userId), {
        role,
        status,
        permissions: mergedPermissions,
        updatedAt: now,
      });
      batch.update(doc(firestoreDb, "users", userId, "businessMemberships", activeBusinessId), {
        role,
        status,
        permissions: mergedPermissions,
        updatedAt: now,
      });
      await batch.commit();
      setMessage("User access was updated successfully.");
    } catch (err) {
      console.error(err);
      setError("Could not save the user. Check Firestore permissions and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function removeUser() {
    if (!canManageUsers || !firestoreDb || !activeBusinessId || !member || isOwner) return;
    if (!window.confirm(`Remove ${displayName} from this business?`)) return;
    setSaving(true);
    setError("");
    try {
      const batch = writeBatch(firestoreDb);
      batch.delete(doc(firestoreDb, "businesses", activeBusinessId, "members", userId));
      batch.delete(doc(firestoreDb, "users", userId, "businessMemberships", activeBusinessId));
      await batch.commit();
      router.replace("/settings/users");
    } catch (err) {
      console.error(err);
      setError("Could not remove this user.");
      setSaving(false);
    }
  }

  return (
    <AuthGate>
      <div className="flex min-h-screen bg-[#f8f7f4]">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 pb-10 sm:px-6 lg:px-8">
          <TopNav />
          <div className="mx-auto max-w-[1450px] py-5">
            <Link href="/settings/users" className="text-sm font-semibold text-[#4f46e5]">← Users & Roles</Link>

            {loading ? (
              <div className="mt-6 rounded-2xl border border-[#e7e5e4] bg-white p-10 text-sm text-[#667085]">Loading user…</div>
            ) : !member ? (
              <div className="mt-6 rounded-2xl border border-[#fecdca] bg-[#fef3f2] p-6 text-sm text-[#b42318]">{error || "User not found."}</div>
            ) : (
              <>
                <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-[#e7e5e4] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eeedff] text-xl font-bold text-[#4f46e5]">{displayName[0]?.toUpperCase() || "U"}</div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#98a2b3]">User access</p>
                      <h1 className="mt-1 text-2xl font-bold text-[#182230]">{displayName}</h1>
                      <p className="mt-1 text-sm text-[#667085]">{memberEmail || `UID: ${userId}`}</p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xs text-[#98a2b3]">Joined</p>
                    <p className="mt-1 text-sm font-semibold text-[#344054]">{formatDate(memberJoinedAt)}</p>
                  </div>
                </div>

                {error && <div className="mt-4 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
                {message && <div className="mt-4 rounded-xl border border-[#abefc6] bg-[#ecfdf3] px-4 py-3 text-sm text-[#067647]">{message}</div>}

                {!canManageUsers && <div className="mt-4 rounded-xl border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm text-[#b54708]">You can view this member, but only the business owner or an administrator can change access.</div>}
                {isOwner && <div className="mt-4 rounded-xl border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm text-[#b54708]">This is the business owner. The owner account is protected from role, permission, status and removal changes.</div>}

                <div className="mt-5 grid gap-5 xl:grid-cols-[.7fr_1.3fr]">
                  <section className="rounded-2xl border border-[#e7e5e4] bg-white p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-bold text-[#182230]">Access</h2>
                        <p className="mt-1 text-xs text-[#98a2b3]">Role and account status.</p>
                      </div>
                      <span className="rounded-full bg-[#f2f4f7] px-2.5 py-1 text-xs font-semibold text-[#667085]">{selectedCount} permissions</span>
                    </div>

                    <label className="mt-6 block text-xs font-semibold text-[#344054]">Role<select value={role} disabled={!canManageUsers || isOwner || saving} onChange={(e) => { const nextRole = e.target.value as BusinessMemberRole; setRole(nextRole); setPermissions(cloneDefaults(nextRole)); }} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm disabled:bg-[#f2f4f7]">{ROLES.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label>

                    <label className="mt-4 block text-xs font-semibold text-[#344054]">Status<select value={status} disabled={!canManageUsers || isOwner || saving} onChange={(e) => setStatus(e.target.value as "active" | "disabled")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm disabled:bg-[#f2f4f7]"><option value="active">Active</option><option value="disabled">Disabled</option></select></label>

                    <button type="button" disabled={!canManageUsers || isOwner || saving} onClick={() => setPermissions(cloneDefaults(role))} className="mt-4 h-10 w-full rounded-xl border border-[#d0d5dd] text-xs font-semibold text-[#344054] disabled:opacity-40">Reset to role defaults</button>
                  </section>

                  <section className="rounded-2xl border border-[#e7e5e4] bg-white">
                    <div className="flex items-center justify-between border-b border-[#eaecf0] px-5 py-4">
                      <div>
                        <h2 className="font-bold text-[#182230]">Permissions</h2>
                        <p className="mt-1 text-xs text-[#98a2b3]">Fine-grained permissions for this business only.</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px] text-left text-xs">
                        <thead className="bg-[#f8f9fc] text-[#667085]">
                          <tr><th className="px-4 py-3">Module</th>{ACTIONS.map((action) => <th key={action} className="px-3 py-3 text-center capitalize">{action}</th>)}<th className="px-3 py-3 text-center">All</th></tr>
                        </thead>
                        <tbody className="divide-y divide-[#f2f4f7]">
                          {MODULES.map((module) => {
                            const enabledCount = module.actions.filter((action) => permissions[module.key]?.[action]).length;
                            const allEnabled = enabledCount === module.actions.length;
                            return <tr key={module.key}>
                              <td className="px-4 py-3 font-semibold text-[#344054]">{module.label}</td>
                              {ACTIONS.map((action) => module.actions.includes(action) ? <td key={action} className="px-3 py-3 text-center"><input aria-label={`${module.label} ${action}`} type="checkbox" checked={!!permissions[module.key]?.[action]} disabled={!canManageUsers || isOwner || saving} onChange={() => toggle(module.key, action)} className="h-4 w-4 accent-[#4f46e5]" /></td> : <td key={action} />)}
                              <td className="px-3 py-3 text-center"><input aria-label={`${module.label} all`} type="checkbox" checked={allEnabled} disabled={!canManageUsers || isOwner || saving} onChange={(e) => toggleModule(module.key, e.target.checked)} className="h-4 w-4 accent-[#4f46e5]" /></td>
                            </tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>

                <div className="mt-5 flex flex-col-reverse gap-3 border-t border-[#e7e5e4] pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <button type="button" onClick={removeUser} disabled={!canManageUsers || isOwner || saving} className="rounded-xl border border-[#fecdca] px-4 py-2.5 text-sm font-semibold text-[#b42318] disabled:cursor-not-allowed disabled:opacity-40">Remove from business</button>
                  <div className="flex gap-3">
                    <Link href="/settings/users" className="rounded-xl border border-[#d0d5dd] px-4 py-2.5 text-sm font-semibold text-[#344054]">Cancel</Link>
                    <button type="button" onClick={save} disabled={!canManageUsers || isOwner || saving} className="rounded-xl bg-[#4f46e5] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Saving…" : "Save changes"}</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </AuthGate>
  );
}
