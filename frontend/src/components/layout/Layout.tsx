import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './Sidebar';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <SidebarProvider>
      {/* h-screen asegura que el contenedor ocupe exactamente el alto de la pantalla */}
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <AppSidebar />
        
        {/* flex-col y overflow-y-auto permiten que el contenido scrolee mientras el sidebar queda fijo */}
        <main className="flex flex-1 flex-col min-w-0 overflow-hidden">
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background/95 backdrop-blur px-6">
            <SidebarTrigger />
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Sistema de Gestión</h2>
            </div>
          </header>
          
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
              {children}
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}