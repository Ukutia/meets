import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Users,
  ShoppingCart,
  FileText,
  Warehouse,
  LogOut,
  Feather,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

const menuItems = [
  { title: 'Dashboard', url: '/', icon: LayoutDashboard },
  { title: 'Productos', url: '/productos', icon: Package },
  { title: 'Clientes', url: '/clientes', icon: Users },
  { title: 'Pedidos', url: '/pedidos', icon: ShoppingCart },
  { title: 'Facturas', url: '/facturas', icon: FileText },
  { title: 'Stock', url: '/stock', icon: Warehouse },
  { title: 'Flujos de Inventario', url: '/flujos-de-inventario', icon: Feather },
  { title: 'Gestión de Pagos', url: '/gestion-pagos', icon: Feather },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { logout, user } = useAuth();
  const collapsed = state === 'collapsed';

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-lg font-bold text-primary">MeatME</span>
              <span className="text-xs text-muted-foreground">Gestión Cárnica</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menú Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === '/'}
                      className={({ isActive }) =>
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-primary font-medium'
                          : 'hover:bg-sidebar-accent/50'
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border p-4">
        {!collapsed && user && (
          <div className="mb-2 rounded-lg bg-muted p-3">
            <p className="text-sm font-medium">{user.username}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        )}
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'default'}
          onClick={logout}
          className="w-full"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Cerrar Sesión</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
