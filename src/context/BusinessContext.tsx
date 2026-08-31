"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth } from "../lib/firebase";
import type { AppUser, Business, BusinessMember, UserBusinessMembership, MemberPermissions, PermissionModule, PermissionAction, GranularPermissions } from "../types";

interface BusinessMembership extends BusinessMember { business: Business; }
export type PermissionKey = keyof MemberPermissions;
export interface PermissionCheck { module: PermissionModule; action?: PermissionAction; }

interface BusinessContextValue {
  user: User | null; memberships: BusinessMembership[]; activeBusiness: BusinessMembership | null; activeBusinessId: string | null; loading: boolean;
  selectBusiness: (businessId: string) => void; refreshBusinesses: () => Promise<void>; createBusiness: (input: CreateBusinessInput) => Promise<string>;
  hasPermission: (permission: PermissionKey) => boolean;
  can: (module: PermissionModule, action?: PermissionAction) => boolean;
  hasRole: (...roles: BusinessMember["role"][]) => boolean;
  canManageUsers: boolean; canManageSettings: boolean;
}

export interface CreateBusinessInput { name: string; legalName?: string; businessType?: string; phone?: string; email?: string; state?: string; district?: string; city?: string; pincode?: string; gstin?: string; gstEnabled?: boolean; }
const BusinessContext = createContext<BusinessContextValue | undefined>(undefined);
const ACTIVE_BUSINESS_KEY = "erp.activeBusinessId";

async function authHeaders() {
  if (!firebaseAuth?.currentUser) throw new Error("You must be signed in.");
  const token = await firebaseAuth.currentUser.getIdToken();
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function workspaceRequest(path: string, init?: RequestInit) {
  const headers = await authHeaders();
  const response = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers || {}) }, cache: "no-store" });
  const payload = await response.json().catch(() => ({ success:false, error:"Invalid server response." }));
  if (!response.ok || !payload.success) throw new Error(String(payload.error || "Workspace request failed."));
  return payload;
}

const BusinessProvider = ({children}:{children:ReactNode}) => {
  const [user,setUser]=useState<User|null>(null); const [memberships,setMemberships]=useState<BusinessMembership[]>([]); const [activeBusinessId,setActiveBusinessId]=useState<string|null>(null); const [loading,setLoading]=useState(true);

  const refreshBusinesses=useCallback(async()=>{
    if(!firebaseAuth?.currentUser){setMemberships([]);setActiveBusinessId(null);return;}
    const payload=await workspaceRequest("/api/workspace");
    const loaded=(payload.memberships||[]) as BusinessMembership[];
    setMemberships(loaded);
    const stored=window.localStorage.getItem(ACTIVE_BUSINESS_KEY);
    if(stored&&loaded.some(i=>i.business.businessId===stored)) setActiveBusinessId(stored);
    else { const first=loaded[0]?.business.businessId??null; setActiveBusinessId(first); if(first)window.localStorage.setItem(ACTIVE_BUSINESS_KEY,first); else window.localStorage.removeItem(ACTIVE_BUSINESS_KEY); }
  },[]);

  useEffect(()=>{
    if(!firebaseAuth){setLoading(false);return undefined;}
    return onAuthStateChanged(firebaseAuth,async nextUser=>{
      setUser(nextUser);setLoading(true);
      try { if(nextUser) await refreshBusinesses(); else {setMemberships([]);setActiveBusinessId(null);} }
      catch(error){console.error("Could not initialize user workspace:",error);setMemberships([]);setActiveBusinessId(null);}
      finally{setLoading(false);}
    });
  },[refreshBusinesses]);

  const selectBusiness=useCallback((businessId:string)=>{if(!memberships.some(i=>i.business.businessId===businessId))return;setActiveBusinessId(businessId);window.localStorage.setItem(ACTIVE_BUSINESS_KEY,businessId);},[memberships]);

  const createBusiness=useCallback(async(input:CreateBusinessInput)=>{
    const payload=await workspaceRequest("/api/workspace",{method:"POST",body:JSON.stringify({input})});
    await refreshBusinesses(); selectBusiness(String(payload.businessId)); return String(payload.businessId);
  },[refreshBusinesses,selectBusiness]);

  const activeBusiness=useMemo(()=>memberships.find(i=>i.business.businessId===activeBusinessId)??null,[memberships,activeBusinessId]);
  const hasPermission=useCallback((permission:PermissionKey)=>activeBusiness?.role==="owner"||activeBusiness?.role==="admin"||activeBusiness?.permissions?.[permission]===true,[activeBusiness]);
  const can=useCallback((module:PermissionModule,action:PermissionAction="view")=>{if(!activeBusiness)return false;if(activeBusiness.role==="owner")return true;if(activeBusiness.role==="admin"&&module!=="settings")return true;const granular=activeBusiness.permissions as GranularPermissions;return granular?.[module]?.[action]===true;},[activeBusiness]);
  const hasRole=useCallback((...roles:BusinessMember["role"][])=>!!activeBusiness&&roles.includes(activeBusiness.role),[activeBusiness]);
  const canManageUsers=!!activeBusiness&&(activeBusiness.role==="owner"||activeBusiness.role==="admin"); const canManageSettings=!!activeBusiness&&(activeBusiness.role==="owner"||activeBusiness.role==="admin");
  const value=useMemo<BusinessContextValue>(()=>({user,memberships,activeBusiness,activeBusinessId,loading,selectBusiness,refreshBusinesses,createBusiness,hasPermission,can,hasRole,canManageUsers,canManageSettings}),[user,memberships,activeBusiness,activeBusinessId,loading,selectBusiness,refreshBusinesses,createBusiness,hasPermission,can,hasRole,canManageUsers,canManageSettings]);
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
};

export { BusinessProvider };
export function useBusiness(){const context=useContext(BusinessContext);if(!context)throw new Error("useBusiness must be used inside BusinessProvider");return context;}
