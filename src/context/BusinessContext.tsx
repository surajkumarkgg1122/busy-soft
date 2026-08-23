"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth, firestoreDb } from "../lib/firebase";
import type { Business, BusinessMember } from "../types";

interface BusinessMembership extends BusinessMember {
  business: Business;
}

interface BusinessContextValue {
  user: User | null;
  memberships: BusinessMembership[];
  activeBusiness: BusinessMembership | null;
  activeBusinessId: string | null;
  loading: boolean;
  selectBusiness: (businessId: string) => void;
  refreshBusinesses: () => Promise<void>;
  createBusiness: (input: CreateBusinessInput) => Promise<string>;
}

export interface CreateBusinessInput {
  name: string;
  legalName?: string;
  businessType?: string;
  phone?: string;
  email?: string;
  state?: string;
  district?: string;
  city?: string;
  pincode?: string;
  gstin?: string;
  gstEnabled?: boolean;
}

const BusinessContext = createContext<BusinessContextValue | undefined>(undefined);
const ACTIVE_BUSINESS_KEY = "erp.activeBusinessId";

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<BusinessMembership[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshBusinesses = useCallback(async () => {
    if (!firebaseAuth || !firestoreDb || !firebaseAuth.currentUser) {
      setMemberships([]);
      setActiveBusinessId(null);
      return;
    }

    const uid = firebaseAuth.currentUser.uid;
    const membershipSnapshot = await getDocs(
      collection(firestoreDb, "users", uid, "businessMemberships"),
    );

    const loaded: BusinessMembership[] = [];

    for (const membershipDoc of membershipSnapshot.docs) {
      const membership = membershipDoc.data() as BusinessMember;
      if (membership.status !== "active") continue;

      const businessSnapshot = await getDoc(
        doc(firestoreDb, "businesses", membershipDoc.id),
      );

      if (!businessSnapshot.exists()) continue;

      loaded.push({
        ...membership,
        business: businessSnapshot.data() as Business,
      });
    }

    setMemberships(loaded);

    const stored = window.localStorage.getItem(ACTIVE_BUSINESS_KEY);
    const storedExists = Boolean(stored && loaded.some((item) => item.business.businessId === stored));

    if (storedExists) {
      setActiveBusinessId(stored);
    } else {
      const first = loaded[0]?.business.businessId ?? null;
      setActiveBusinessId(first);
      if (first) window.localStorage.setItem(ACTIVE_BUSINESS_KEY, first);
      else window.localStorage.removeItem(ACTIVE_BUSINESS_KEY);
    }
  }, []);

  useEffect(() => {
    if (!firebaseAuth) {
      setLoading(false);
      return undefined;
    }

    return onAuthStateChanged(firebaseAuth, async (nextUser) => {
      setUser(nextUser);
      setLoading(true);
      try {
        await refreshBusinesses();
      } catch (error) {
        console.error("Could not load businesses:", error);
        setMemberships([]);
        setActiveBusinessId(null);
      } finally {
        setLoading(false);
      }
    });
  }, [refreshBusinesses]);

  const selectBusiness = useCallback((businessId: string) => {
    const exists = memberships.some((item) => item.business.businessId === businessId);
    if (!exists) return;

    setActiveBusinessId(businessId);
    window.localStorage.setItem(ACTIVE_BUSINESS_KEY, businessId);
  }, [memberships]);

  const createBusiness = useCallback(async (input: CreateBusinessInput) => {
    if (!firebaseAuth || !firestoreDb || !firebaseAuth.currentUser) {
      throw new Error("You must be signed in to create a business.");
    }

    const uid = firebaseAuth.currentUser.uid;
    const businessRef = doc(collection(firestoreDb, "businesses"));
    const membershipRef = doc(firestoreDb, "businesses", businessRef.id, "members", uid);
    const userMembershipRef = doc(firestoreDb, "users", uid, "businessMemberships", businessRef.id);
    const now = Timestamp.now();

    const business: Business = {
      businessId: businessRef.id,
      name: input.name.trim(),
      legalName: input.legalName?.trim() || input.name.trim(),
      businessType: input.businessType?.trim() || "general",
      phone: input.phone?.trim() || "",
      email: input.email?.trim() || firebaseAuth.currentUser.email || "",
      address: {
        line1: "",
        line2: "",
        city: input.city?.trim() || "",
        district: input.district?.trim() || "",
        state: input.state?.trim() || "",
        pincode: input.pincode?.trim() || "",
        country: "India",
      },
      gst: {
        enabled: input.gstEnabled ?? Boolean(input.gstin),
        gstin: input.gstin?.trim() || "",
        registrationType: input.gstin ? "regular" : "unregistered",
      },
      financialYear: { startMonth: 4, startDay: 1 },
      currency: "INR",
      timezone: "Asia/Kolkata",
      ownerId: uid,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    const membership: BusinessMember = {
      uid,
      role: "owner",
      status: "active",
      permissions: {
        sales: true,
        purchases: true,
        inventory: true,
        payments: true,
        expenses: true,
        reports: true,
        settings: true,
      },
      joinedAt: now,
    };

    const batch = writeBatch(firestoreDb);
    batch.set(businessRef, business);
    batch.set(membershipRef, membership);
    batch.set(userMembershipRef, membership);
    await batch.commit();

    await refreshBusinesses();
    selectBusiness(businessRef.id);
    return businessRef.id;
  }, [refreshBusinesses, selectBusiness]);

  const activeBusiness = useMemo(
    () => memberships.find((item) => item.business.businessId === activeBusinessId) ?? null,
    [memberships, activeBusinessId],
  );

  const value = useMemo<BusinessContextValue>(() => ({
    user,
    memberships,
    activeBusiness,
    activeBusinessId,
    loading,
    selectBusiness,
    refreshBusinesses,
    createBusiness,
  }), [user, memberships, activeBusiness, activeBusinessId, loading, selectBusiness, refreshBusinesses, createBusiness]);

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (!context) throw new Error("useBusiness must be used inside BusinessProvider");
  return context;
}
