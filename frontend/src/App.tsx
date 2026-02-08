import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Layout } from "./components/layout/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Productos from "./pages/Productos";
import Clientes from "./pages/Clientes";
import Pedidos from "./pages/Pedidos";
import PedidoNuevo from "./pages/PedidoNuevo";
import MovimientosInventarios from "./pages/MovimientosInventario";
import Facturas from "./pages/Facturas";
import Stock from "./pages/Stock";
import NotFound from "./pages/NotFound";
import FormularioPedido from "./pages/FormularioPedido";
import GestionPagosVendedor from "./pages/GestioPagosVendedor";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Dashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/productos"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Productos />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/clientes"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Clientes />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/pedidos"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Pedidos />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/gestion-pagos"
              element={
                <ProtectedRoute>
                  <Layout>
                    <GestionPagosVendedor />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/pedidos/nuevo"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PedidoNuevo />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/facturas"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Facturas />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/flujos-de-inventario"
              element={
                <ProtectedRoute>
                  <Layout>
                    <MovimientosInventarios />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/stock"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Stock />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
