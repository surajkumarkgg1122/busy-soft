import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminServices } from "@/infrastructure/firebase/admin";

export const runtime = "nodejs";

const ROLE_DEFAULTS = {
  owner: {
    sales:{view:true,create:true,edit:true,delete:true,print:true,export:true,approve:true},
    purchases:{view:true,create:true,edit:true,delete:true,print:true,export:true,approve:true},
    inventory:{view:true,create:true,edit:true,delete:true,print:true,export:true},
    payments:{view:true,create:true,edit:true,delete:true,print:true,export:true},
    expenses:{view:true,create:true,edit:true,delete:true,print:true,export:true},
    reports:{view:true,print:true,export:true},
    settings:{view:true,create:true,edit:true,delete:true},
    parties:{view:true,create:true,edit:true,delete:true,export:true},
    items:{view:true,create:true,edit:true,delete:true,export:true},
    cashBank:{view:true,create:true,edit:true,delete:true,print:true,export:true},
    gst:{view:true,create:true,edit:true,delete:true,export:true},
  },
} as const;

type RegistrationType = "regular" | "composition" | "unregistered" | "other";

type AccountSeed = {
  id: string; code: string; name: string; type: "asset" | "liability" | "equity" | "income" | "expense" | "contra_revenue"; parentCode?: string;
};

const ACCOUNT_SEEDS: AccountSeed[] = [
  { id:"acct-cash", code:"1000", name:"Cash", type:"asset" },
  { id:"acct-bank", code:"1010", name:"Bank Accounts", type:"asset" },
  { id:"acct-debtors", code:"1200", name:"Sundry Debtors", type:"asset" },
  { id:"acct-inventory", code:"1300", name:"Inventory", type:"asset" },
  { id:"acct-input-cgst", code:"1401", name:"Input CGST", type:"asset" },
  { id:"acct-input-sgst", code:"1402", name:"Input SGST", type:"asset" },
  { id:"acct-input-igst", code:"1403", name:"Input IGST", type:"asset" },
  { id:"acct-input-cess", code:"1404", name:"Input Cess", type:"asset" },
  { id:"acct-creditors", code:"2000", name:"Sundry Creditors", type:"liability" },
  { id:"acct-output-cgst", code:"2101", name:"Output CGST", type:"liability" },
  { id:"acct-output-sgst", code:"2102", name:"Output SGST", type:"liability" },
  { id:"acct-output-igst", code:"2103", name:"Output IGST", type:"liability" },
  { id:"acct-output-cess", code:"2104", name:"Output Cess", type:"liability" },
  { id:"acct-capital", code:"3000", name:"Capital Account", type:"equity" },
  { id:"acct-opening-balance", code:"3100", name:"Opening Balance Adjustment", type:"equity" },
  { id:"acct-sales", code:"4000", name:"Sales", type:"income" },
  { id:"acct-other-income", code:"4100", name:"Other Income", type:"income" },
  { id:"acct-sales-return", code:"4900", name:"Sales Return", type:"contra_revenue" },
  { id:"acct-purchases", code:"5000", name:"Purchases", type:"expense" },
  { id:"acct-cogs", code:"5100", name:"Cost of Goods Sold", type:"expense" },
  { id:"acct-purchase-return", code:"5900", name:"Purchase Return", type:"expense" },
  { id:"acct-general-expense", code:"6000", name:"General Expenses", type:"expense" },
  { id:"acct-discount-allowed", code:"6100", name:"Discount Allowed", type:"expense" },
  { id:"acct-discount-received", code:"6200", name:"Discount Received", type:"income" },
  { id:"acct-round-off", code:"6900", name:"Round Off", type:"expense" },
  { id:"acct-stock-gain", code:"7300", name:"Stock Adjustment Gain", type:"income" },
  { id:"acct-stock-loss", code:"7400", name:"Stock Adjustment Loss", type:"expense" },
];

const DEFAULT_SETTINGS = {
  general: { businessName:"", legalName:"", phone:"", email:"", address:"", city:"", state:"", pincode:"", financialYearStart:"04-01", currency:"INR" },
  transactions: { invoicePrefix:"", nextInvoiceNumber:1001, quotationPrefix:"", orderPrefix:"", returnPrefix:"", allowNegativeStock:false, showItemStockOnSale:true, autoCalculateBalance:true },
  print: { paperSize:"A4", printFormat:"Detailed", showLogo:true, showBusinessAddress:true, showSignature:false, footerMessage:"Thank you for your business." },
  taxes: { gstEnabled:false, gstin:"", taxType:"unregistered", defaultTaxRate:0, placeOfSupply:"", reverseCharge:false },
  users: { allowInvitingUsers:true, defaultRole:"Staff", requireApprovalForDelete:true },
  messages: { invoiceMessage:"Thank you for your business.", quotationMessage:"We look forward to serving you.", paymentMessage:"Payment received. Thank you.", reminderMessage:"This is a friendly reminder for your outstanding balance." },
  party: { defaultCustomerCreditLimit:0, requirePhone:false, requireAddress:false, allowDuplicatePhone:false, showOpeningBalance:true },
  items: { defaultUnit:"Piece", allowDuplicateSku:false, requireSku:false, lowStockThreshold:0, showPurchasePrice:true },
} as const;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function normalizeRegistrationType(value: unknown, gstEnabled: boolean, gstin: string): RegistrationType {
  const raw = String(value || "").trim().toLowerCase();
  const allowed: RegistrationType[] = ["regular", "composition", "unregistered", "other"];
  if (allowed.includes(raw as RegistrationType)) return raw as RegistrationType;
  return gstEnabled || gstin ? "regular" : "unregistered";
}

function validatePincode(value: string): string {
  if (!/^\d{6}$/.test(value)) throw new Error("Enter a valid 6-digit Indian pincode.");
  return value;
}

function validateGstin(value: string): string {
  const gstin = value.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new Error("Enter a valid 15-character GSTIN.");
  return gstin;
}

function fyFor(startMonth: number, startDay: number, now: Date) {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const startYear = month > startMonth || (month === startMonth && now.getDate() >= startDay) ? year : year - 1;
  const end = new Date(startYear + 1, startMonth - 1, startDay);
  end.setDate(end.getDate() - 1);
  return {
    id: `fy-${startYear}-${String(startYear + 1).slice(-2)}`,
    name: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
    startDate: `${startYear}-${String(startMonth).padStart(2,"0")}-${String(startDay).padStart(2,"0")}`,
    endDate: `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,"0")}-${String(end.getDate()).padStart(2,"0")}`,
  };
}

async function authenticate(request: Request) {
  const { auth, db } = getAdminServices();
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw new Error("Authentication is required.");
  const token = await auth.verifyIdToken(header.slice(7));
  return { auth, db, token };
}

export async function GET(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const membershipSnap = await db.collection("users").doc(token.uid).collection("businessMemberships").get();
    const memberships = [] as Array<Record<string, unknown>>;
    for (const membershipDoc of membershipSnap.docs) {
      const membership = membershipDoc.data() as Record<string, unknown>;
      if (membership.status !== "active") continue;
      const businessId = String(membership.businessId || membershipDoc.id);
      const businessSnap = await db.collection("businesses").doc(businessId).get();
      if (!businessSnap.exists) continue;
      memberships.push({ ...membership, businessId, business: businessSnap.data() });
    }
    const userSnap = await db.collection("users").doc(token.uid).get();
    return NextResponse.json({ success: true, user: userSnap.exists ? userSnap.data() : null, memberships });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load workspace.";
    return errorResponse(message, /authentication|token|credential/i.test(message) ? 401 : 400);
  }
}

export async function POST(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const body = await request.json() as Record<string, unknown>;
    const input = (body.input || {}) as Record<string, unknown>;
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) return errorResponse("A valid onboarding request key is required.");

    const name = String(input.name || "").trim();
    if (!name) return errorResponse("Business name is required.");

    const state = String(input.state || "").trim();
    const city = String(input.city || "").trim();
    const pincode = String(input.pincode || "").trim();
    if (!state) return errorResponse("State is required.");
    if (!city) return errorResponse("City is required.");
    validatePincode(pincode);

    const gstEnabled = Boolean(input.gstEnabled);
    const registrationType = normalizeRegistrationType(input.registrationType, gstEnabled, String(input.gstin || ""));
    let gstin = String(input.gstin || "").trim();
    if (registrationType === "regular" || registrationType === "composition") {
      if (!gstEnabled) return errorResponse("GST must be enabled for a registered business.");
      gstin = validateGstin(gstin);
    } else {
      gstin = "";
    }

    const fyStartMonth = Number(input.financialYearStartMonth || 4);
    const fyStartDay = Number(input.financialYearStartDay || 1);
    if (fyStartMonth !== 4 || fyStartDay !== 1) return errorResponse("Only 1-April financial year start is supported for now.");

    const requestRef = db.collection("users").doc(token.uid).collection("businessCreationRequests").doc(idempotencyKey);
    const now = Timestamp.now();
    const jsNow = now.toDate();
    const fy = fyFor(fyStartMonth, fyStartDay, jsNow);

    const result = await db.runTransaction(async (tx) => {
      const existing = await tx.get(requestRef);
      if (existing.exists) {
        const data = existing.data() as { businessId?: string; name?: string; state?: string; city?: string; pincode?: string };
        if (data.name !== name || data.state !== state || data.city !== city || data.pincode !== pincode) {
          throw new Error("This onboarding request key was already used for different business details.");
        }
        return { businessId: String(data.businessId) };
      }

      const businessRef = db.collection("businesses").doc();
      const membershipRef = businessRef.collection("members").doc(token.uid);
      const userMembershipRef = db.collection("users").doc(token.uid).collection("businessMemberships").doc(businessRef.id);
      const fyRef = businessRef.collection("financialYears").doc(fy.id);
      const settingsRef = businessRef.collection("settings").doc("business");
      const userRef = db.collection("users").doc(token.uid);
      const auditRef = businessRef.collection("auditEvents").doc();

      const business = {
        businessId: businessRef.id,
        name,
        legalName: String(input.legalName || name).trim(),
        businessType: String(input.businessType || "general").trim(),
        phone: String(input.phone || "").trim(),
        email: String(input.email || token.email || "").trim(),
        address: {
          line1: String(input.address || "").trim(),
          line2: String(input.addressLine2 || "").trim(),
          city,
          district: String(input.district || "").trim(),
          state,
          pincode,
          country: "India",
        },
        gst: { enabled: gstEnabled, gstin, registrationType },
        financialYear: { startMonth: fyStartMonth, startDay: fyStartDay },
        currency: "INR",
        timezone: "Asia/Kolkata",
        ownerId: token.uid,
        trial: { status: "active", planId: "trial", startsAt: now, expiresAt: Timestamp.fromMillis(now.toMillis() + 14 * 86400000) },
        status: "active",
        setupStatus: "ready",
        accountingVersion: 1,
        createdAt: now,
        updatedAt: now,
      };

      const permissions = { ...ROLE_DEFAULTS.owner };
      const membership = { uid:token.uid, role:"owner", status:"active", permissions, joinedAt:now };
      const userMembership = { ...membership, businessId:businessRef.id };
      const userData = { uid:token.uid, name:token.name || token.email?.split("@")[0] || "User", email:token.email || "", phone:"", photoURL:null, status:"active", createdAt:now, updatedAt:now, lastLoginAt:now };

      tx.set(businessRef, business);
      tx.set(membershipRef, membership);
      tx.set(userMembershipRef, userMembership);
      tx.set(fyRef, { id:fy.id, businessId:businessRef.id, ...fy, locked:false, createdAt:now, updatedAt:now });
      tx.set(settingsRef, {
        ...DEFAULT_SETTINGS,
        general: { ...DEFAULT_SETTINGS.general, businessName:name, legalName:String(input.legalName || name).trim(), phone:String(input.phone || "").trim(), email:String(input.email || token.email || "").trim(), address:String(input.address || "").trim(), city, state, pincode, financialYearStart:"04-01", currency:"INR" },
        taxes: { ...DEFAULT_SETTINGS.taxes, gstEnabled, gstin, taxType:registrationType },
        createdAt:now,
        updatedAt:now,
      });

      const accountMap = new Map(ACCOUNT_SEEDS.map((account) => [account.code, account.id]));
      for (const account of ACCOUNT_SEEDS) {
        tx.set(businessRef.collection("accounts").doc(account.id), {
          id:account.id,
          businessId:businessRef.id,
          code:account.code,
          name:account.name,
          type:account.type,
          parentId:account.parentCode ? accountMap.get(account.parentCode) || null : null,
          systemAccount:true,
          active:true,
          openingDebit:0,
          openingCredit:0,
          createdAt:now,
          updatedAt:now,
        });
      }

      tx.set(auditRef, {
        id:auditRef.id,
        businessId:businessRef.id,
        entityType:"business",
        entityId:businessRef.id,
        action:"BUSINESS_CREATED",
        userId:token.uid,
        timestamp:now,
        metadata:{ idempotencyKey, accountingVersion:1, financialYearId:fy.id },
      });

      tx.set(requestRef, {
        idempotencyKey,
        businessId:businessRef.id,
        name,
        state,
        city,
        pincode,
        createdAt:now,
        status:"completed",
      });

      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) tx.set(userRef, userData);

      return { businessId: businessRef.id };
    });

    return NextResponse.json({ success:true, businessId:result.businessId, setupStatus:"ready" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create business.";
    const status = /authentication|token|credential/i.test(message) ? 401 : /already used|different business|pincode|GST|State|City|business name|onboarding/i.test(message) ? 400 : 500;
    return errorResponse(message, status);
  }
}
