import { moduleRegistry } from "./moduleRegistry";

export type NavigationItem = {
  label: string;
  href: string;
  icon?: string;
  description?: string;
  children?: NavigationItem[];
};

const roots = moduleRegistry.filter(m => !m.parent && m.sidebarVisible && m.status !== "deprecated").sort((a,b) => a.order-b.order);

export const navigation: NavigationItem[] = roots.map(module => {
  const children = moduleRegistry.filter(m => m.parent === module.id && m.sidebarVisible && m.status !== "deprecated").sort((a,b) => a.order-b.order);
  return {
    label: module.name,
    href: module.route,
    icon: module.icon,
    children: children.length ? children.map(child => ({ label: child.name, href: child.route })) : undefined,
  };
});

export function isNavigationActive(pathname: string, item: NavigationItem) {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
