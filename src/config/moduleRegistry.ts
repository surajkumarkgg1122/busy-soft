import type { AccountingPermission } from "../core/accounting/authorization";

export type ModuleStatus = "active" | "partial" | "planned" | "hidden" | "deprecated";
export interface ModuleDefinition {
  id: string;
  name: string;
  route: string;
  icon?: string;
  parent?: string;
  sidebarVisible: boolean;
  permissions: readonly AccountingPermission[];
  featureFlag?: string;
  status: ModuleStatus;
  breadcrumb: readonly string[];
  order: number;
}

export const moduleRegistry: readonly ModuleDefinition[] = [
  { id:"dashboard", name:"Dashboard", route:"/", icon:"dashboard", sidebarVisible:true, permissions:["REPORT_VIEW"], status:"active", breadcrumb:["Dashboard"], order:10 },
  { id:"parties", name:"Parties", route:"/customers", icon:"parties", sidebarVisible:true, permissions:["PARTY_VIEW"], status:"partial", breadcrumb:["Parties"], order:20 },
  { id:"customers", name:"Customers", route:"/customers", parent:"parties", sidebarVisible:true, permissions:["PARTY_VIEW"], status:"active", breadcrumb:["Parties","Customers"], order:21 },
  { id:"suppliers", name:"Suppliers", route:"/suppliers", parent:"parties", sidebarVisible:true, permissions:["PARTY_VIEW"], status:"active", breadcrumb:["Parties","Suppliers"], order:22 },
  { id:"items", name:"Items", route:"/items", icon:"items", sidebarVisible:true, permissions:["INVENTORY_VIEW"], status:"active", breadcrumb:["Items"], order:30 },
  { id:"inventory", name:"Inventory", route:"/inventory", icon:"inventory", sidebarVisible:true, permissions:["INVENTORY_VIEW"], status:"partial", breadcrumb:["Inventory"], order:40 },
  { id:"sales", name:"Sales", route:"/sales", icon:"sales", sidebarVisible:true, permissions:["SALE_CREATE"], status:"partial", breadcrumb:["Sales"], order:50 },
  { id:"payment-in", name:"Payment In", route:"/payment-in", parent:"sales", sidebarVisible:true, permissions:["RECEIPT_CREATE"], status:"partial", breadcrumb:["Sales","Payment In"], order:51 },
  { id:"quotations", name:"Quotations", route:"/quotations", parent:"sales", sidebarVisible:true, permissions:["SALE_CREATE"], status:"partial", breadcrumb:["Sales","Quotations"], order:52 },
  { id:"sales-return", name:"Sales Return / Credit Note", route:"/sales-return", parent:"sales", sidebarVisible:true, permissions:["RETURN_CREATE"], status:"partial", breadcrumb:["Sales","Sales Return / Credit Note"], order:53 },
  { id:"purchases", name:"Purchases", route:"/purchases", icon:"purchases", sidebarVisible:true, permissions:["PURCHASE_CREATE"], status:"partial", breadcrumb:["Purchases"], order:60 },
  { id:"expenses", name:"Expenses", route:"/expenses", icon:"expenses", sidebarVisible:true, permissions:["JOURNAL_CREATE"], status:"partial", breadcrumb:["Expenses"], order:70 },
  { id:"cash-bank", name:"Cash & Bank", route:"/cash-bank", icon:"cash-bank", sidebarVisible:true, permissions:["CASH_BANK_VIEW"], status:"partial", breadcrumb:["Cash & Bank"], order:80 },
  { id:"payments", name:"Payments", route:"/payments", icon:"payments", sidebarVisible:true, permissions:["PAYMENT_CREATE"], status:"partial", breadcrumb:["Payments"], order:90 },
  { id:"manufacturing", name:"Manufacturing", route:"/manufacturing/planning", icon:"inventory", sidebarVisible:true, permissions:["PRODUCTION_CREATE"], status:"partial", breadcrumb:["Manufacturing"], order:100 },
  { id:"production", name:"Production", route:"/production", parent:"manufacturing", sidebarVisible:true, permissions:["PRODUCTION_CREATE"], status:"partial", breadcrumb:["Manufacturing","Production"], order:101 },
  { id:"reports", name:"Reports", route:"/reports/party-wise-statement", icon:"reports", sidebarVisible:true, permissions:["REPORT_VIEW"], status:"partial", breadcrumb:["Reports"], order:110 },
  { id:"party-wise-statement", name:"Party Wise Statement", route:"/reports/party-wise-statement", parent:"reports", sidebarVisible:true, permissions:["REPORT_VIEW"], status:"active", breadcrumb:["Reports","Party Wise Statement"], order:111 },
  { id:"day-book", name:"Day Book", route:"/reports/day-book", parent:"reports", sidebarVisible:true, permissions:["REPORT_VIEW"], status:"active", breadcrumb:["Reports","Day Book"], order:112 },
  { id:"inventory-reports", name:"Inventory Reports", route:"/reports/inventory", parent:"reports", sidebarVisible:true, permissions:["REPORT_VIEW","INVENTORY_VIEW"], status:"partial", breadcrumb:["Reports","Inventory Reports"], order:113 },
  { id:"settings", name:"Settings", route:"/settings", icon:"settings", sidebarVisible:true, permissions:["SETTINGS_VIEW"], status:"partial", breadcrumb:["Settings"], order:120 },
];

export const moduleById = Object.fromEntries(moduleRegistry.map(m => [m.id, m])) as Record<string, ModuleDefinition>;
export const moduleByRoute = Object.fromEntries(moduleRegistry.map(m => [m.route, m])) as Record<string, ModuleDefinition>;
export function visibleModules() { return moduleRegistry.filter(m => m.sidebarVisible && m.status !== "deprecated").sort((a,b) => a.order-b.order); }
export function findModuleByRoute(route: string) { return moduleRegistry.find(m => m.route === route); }
export function moduleHasPermission(module: ModuleDefinition, permission: AccountingPermission) { return module.permissions.includes(permission); }

export interface ModuleRegistryAudit { routeWithoutNavigation:string[]; navigationWithoutRoute:string[]; permissionWithoutModule:string[]; moduleWithoutPermission:string[]; duplicateRoutes:string[]; deadRoutes:string[]; hiddenCompletedModules:string[]; }
export function auditModuleRegistry(routePaths: readonly string[], permissionNames: readonly string[]): ModuleRegistryAudit {
  const registeredRoutes = new Set(moduleRegistry.map(m => m.route));
  const duplicateRoutes = moduleRegistry.map(m=>m.route).filter((r,i,a)=>a.indexOf(r)!==i).filter((r,i,a)=>a.indexOf(r)===i);
  const routeWithoutNavigation = routePaths.filter(r => !registeredRoutes.has(r));
  const navigationWithoutRoute = [...registeredRoutes].filter(r => !routePaths.includes(r));
  const knownPermissions = new Set(permissionNames);
  const permissionWithoutModule = permissionNames.filter(p => !moduleRegistry.some(m => m.permissions.includes(p as AccountingPermission)));
  const moduleWithoutPermission = moduleRegistry.filter(m => m.permissions.length===0).map(m=>m.id);
  const deadRoutes = navigationWithoutRoute;
  const hiddenCompletedModules = moduleRegistry.filter(m => m.status === "active" && !m.sidebarVisible).map(m=>m.id);
  void knownPermissions;
  return { routeWithoutNavigation, navigationWithoutRoute, permissionWithoutModule, moduleWithoutPermission, duplicateRoutes, deadRoutes, hiddenCompletedModules };
}
