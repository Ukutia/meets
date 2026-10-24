import {
  LayoutDashboard,
  Package,
  Users,
  ShoppingCart,
  FileText,
  Warehouse,
  TrendingUp,
  Truck,
  Image,
  ArrowLeftRight,
  Wallet,
  KeyRound,
  Plus,
  Landmark,
} from 'lucide-react';

export type NavItem = { title: string; url: string; icon: React.ComponentType<{ className?: string }> };
export type NavGroup = { label: string; items: NavItem[] };

// Fuente única del menú: el Sidebar lo dibuja agrupado y el encabezado del
// Layout usa el mismo título, así el nombre del menú y el de la página coinciden.
export const NAV_GROUPS: NavGroup[] = [
  { label: 'General', items: [{ title: 'Resumen', url: '/', icon: LayoutDashboard }] },
  {
    label: 'Ventas',
    items: [
      { title: 'Pedidos', url: '/pedidos', icon: ShoppingCart },
      { title: 'Clientes', url: '/clientes', icon: Users },
      { title: 'Pagos de Vendedores', url: '/gestion-pagos', icon: Wallet },
      { title: 'Flyer de Precios', url: '/flyer', icon: Image },
    ],
  },
  {
    label: 'Compras',
    items: [
      { title: 'Facturas de Compra', url: '/facturas', icon: FileText },
      { title: 'Proveedores', url: '/proveedores', icon: Truck },
    ],
  },
  {
    label: 'Inventario',
    items: [
      { title: 'Stock', url: '/stock', icon: Warehouse },
      { title: 'Movimientos', url: '/flujos-de-inventario', icon: ArrowLeftRight },
      { title: 'Productos', url: '/productos', icon: Package },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { title: 'Tesorería', url: '/tesoreria', icon: Landmark },
      { title: 'Reportes', url: '/reportes', icon: TrendingUp },
    ],
  },
];

const EXTRA: Record<string, { group: string; title: string; icon: NavItem['icon'] }> = {
  '/pedidos/nuevo': { group: 'Ventas', title: 'Nuevo Pedido', icon: Plus },
  '/cuenta': { group: 'Cuenta', title: 'Mi Cuenta', icon: KeyRound },
};

export function navInfo(pathname: string): { group: string; title: string } | null {
  if (EXTRA[pathname]) return EXTRA[pathname];
  for (const g of NAV_GROUPS) {
    const item = g.items.find((i) => i.url === pathname);
    if (item) return { group: g.label, title: item.title };
  }
  return null;
}
