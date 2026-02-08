import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  History, Image as ImageIcon, 
  BadgeDollarSign, ExternalLink 
} from 'lucide-react';
import { getVendedores, getPedidos, getPagosVendedor, createPagoVendedor } from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from 'sonner';

export default function GestionPagosVendedor() {
  const queryClient = useQueryClient();
  const [vendedorId, setVendedorId] = useState<string>("todos");
  const [tipoMovimiento, setTipoMovimiento] = useState<string>("pago");
  const [form, setForm] = useState({ monto: "", comentario: "" });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [imgModal, setImgModal] = useState<{ open: boolean; url: string }>({ open: false, url: "" });

// --- LÓGICA DE URLS PARA TU ESTRUCTURA ---
  const getImageUrl = (path: string | null) => {
    if (!path) return "";
    if (path.startsWith('http')) return path;
    
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

    // Tu backend devuelve "comprobantes_pagos/aa.jpg"
    // Pero Django ahora lo servirá bajo "/media/"
    // Necesitamos que quede: http://localhost:8000/media/aa.jpg
    
    // Extraemos solo el nombre del archivo si viene con la carpeta
    const fileName = path.split('/').pop(); 
    
    return `${cleanBase}/media/${fileName}`;
  };

  /* ... resto del componente igual ... */



  // 1. Cargas de datos
  const { data: respVendedores } = useQuery({ queryKey: ['vendedores'], queryFn: getVendedores });
  const { data: respPedidos } = useQuery({ queryKey: ['pedidos-todos'], queryFn: getPedidos });
  const { data: respPagos } = useQuery({ queryKey: ['pagos-todos'], queryFn: () => getPagosVendedor() });

  const vendedores = useMemo(() => Array.isArray(respVendedores?.data) ? respVendedores.data : [], [respVendedores]);
  const todosPedidos = useMemo(() => Array.isArray(respPedidos?.data) ? respPedidos.data : [], [respPedidos]);
  
  const todosPagos = useMemo(() => {
    if (!respPagos) return [];
    if (Array.isArray(respPagos.data)) return respPagos.data;
    if (respPagos.data && Array.isArray(respPagos.data.data)) return respPagos.data.data;
    return [];
  }, [respPagos]);

  // 2. Lógica de Resumen y Totales
  const resumenGeneral = useMemo(() => {
    return vendedores.map(v => {
      const vId = v.id.toString();
      const ventas = todosPedidos
        .filter((p: any) => (p.vendedor?.toString() === vId || p.vendedor_id?.toString() === vId))
        .reduce((acc: number, p: any) => acc + Number(p.total || 0), 0);
      
      const pagosRealizados = todosPagos
        .filter((p: any) => p.vendedor?.toString() === vId && p.tipo === 'pago')
        .reduce((acc: number, p: any) => acc + Number(p.monto || 0), 0);

      const adelantosAcumulados = todosPagos
        .filter((p: any) => p.vendedor?.toString() === vId && p.tipo === 'adelanto')
        .reduce((acc: number, p: any) => acc + Number(p.monto || 0), 0);

      return { 
        ...v, 
        ventas, 
        pagos: pagosRealizados, 
        adelantos: adelantosAcumulados,
        deudaNeta: ventas - pagosRealizados 
      };
    });
  }, [vendedores, todosPedidos, todosPagos]);

  const totalesGlobales = useMemo(() => {
    return resumenGeneral.reduce((acc, curr) => ({
      ventas: acc.ventas + curr.ventas,
      pagos: acc.pagos + curr.pagos,
      deuda: acc.deuda + curr.deudaNeta,
      adelantos: acc.adelantos + curr.adelantos
    }), { ventas: 0, pagos: 0, deuda: 0, adelantos: 0 });
  }, [resumenGeneral]);

  // 3. Mutación
  const mutation = useMutation({
    mutationFn: createPagoVendedor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pagos-todos'] });
      toast.success(`${tipoMovimiento === 'pago' ? 'Pago' : 'Adelanto'} registrado`);
      setForm({ monto: "", comentario: "" });
      setArchivo(null);
    },
    onError: () => toast.error("Error al registrar")
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (vendedorId === "todos" || !form.monto) return toast.error("Faltan datos");
    
    const formData = new FormData();
    formData.append('vendedor', vendedorId);
    formData.append('monto', form.monto);
    formData.append('comentario', form.comentario);
    formData.append('tipo', tipoMovimiento);
    if (archivo) formData.append('comprobante', archivo);
    
    mutation.mutate(formData);
  };

  const abrirModalImagen = (url: string) => {
    if (!url) return toast.info("No hay comprobante");
    setImgModal({ open: true, url: getImageUrl(url) });
  };

  return (
    <div className="space-y-6 p-4">
      {/* MODAL VISOR */}
      <Dialog open={imgModal.open} onOpenChange={(o) => setImgModal({ ...imgModal, open: o })}>
        <DialogContent className="max-w-3xl bg-white">
          <DialogHeader><DialogTitle>Comprobante Adjunto</DialogTitle></DialogHeader>
          <div className="flex justify-center bg-slate-50 p-2 rounded-lg border min-h-[300px] items-center">
            <img 
                src={imgModal.url} 
                alt="Comprobante" 
                className="max-h-[70vh] object-contain shadow-md"
                onError={(e) => {
                    (e.target as HTMLImageElement).src = "https://placehold.co/600x400?text=Error+al+cargar+imagen";
                }}
            />
          </div>
          <Button variant="outline" onClick={() => window.open(imgModal.url, '_blank')} className="w-full">
            <ExternalLink className="h-4 w-4 mr-2" /> Abrir en pestaña nueva
          </Button>
        </DialogContent>
      </Dialog>

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl shadow-sm border">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BadgeDollarSign className="text-primary" /> Finanzas de Vendedores
          </h1>
        </div>
        <Select value={vendedorId} onValueChange={setVendedorId}>
          <SelectTrigger className="w-full md:w-72 border-2 border-primary/20">
            <SelectValue placeholder="Seleccionar Vendedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">📋 Ver Resumen General</SelectItem>
            {vendedores.map((v: any) => (
              <SelectItem key={v.id} value={v.id.toString()}>{v.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {vendedorId === "todos" ? (
        <Card className="border-none shadow-lg overflow-hidden">
          <CardHeader className="bg-slate-900 text-white"><CardTitle>Consolidado General</CardTitle></CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Ventas</TableHead>
                  <TableHead className="text-right text-green-700">Pagado</TableHead>
                  <TableHead className="text-right text-orange-600">Deuda</TableHead>
                  <TableHead className="text-right text-blue-600">Adelantos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resumenGeneral.map((v: any) => (
                  <TableRow key={v.id} className="hover:bg-muted/50 cursor-pointer" onClick={() => setVendedorId(v.id.toString())}>
                    <TableCell className="font-bold">{v.nombre}</TableCell>
                    <TableCell className="text-right">${v.ventas.toLocaleString('es-CL')}</TableCell>
                    <TableCell className="text-right text-green-600 font-medium">${v.pagos.toLocaleString('es-CL')}</TableCell>
                    <TableCell className="text-right font-bold text-orange-600">${v.deudaNeta.toLocaleString('es-CL')}</TableCell>
                    <TableCell className="text-right font-bold text-blue-600 bg-blue-50/30">${v.adelantos.toLocaleString('es-CL')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter className="bg-slate-100 font-black">
                <TableRow>
                  <TableCell>TOTALES</TableCell>
                  <TableCell className="text-right">${totalesGlobales.ventas.toLocaleString('es-CL')}</TableCell>
                  <TableCell className="text-right text-green-600">${totalesGlobales.pagos.toLocaleString('es-CL')}</TableCell>
                  <TableCell className="text-right text-orange-600">${totalesGlobales.deuda.toLocaleString('es-CL')}</TableCell>
                  <TableCell className="text-right text-blue-600">${totalesGlobales.adelantos.toLocaleString('es-CL')}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-500">
          <div className="lg:col-span-1 space-y-4">
            <Card className="shadow-md border-t-4 border-t-primary">
              <CardContent className="pt-6">
                <Tabs value={tipoMovimiento} onValueChange={setTipoMovimiento} className="w-full">
                  <TabsList className="grid grid-cols-2 mb-4">
                    <TabsTrigger value="pago" className="data-[state=active]:bg-green-600 data-[state=active]:text-white">Pago</TabsTrigger>
                    <TabsTrigger value="adelanto" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">Adelanto</TabsTrigger>
                  </TabsList>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Monto</Label>
                      <Input type="number" required value={form.monto} onChange={e => setForm({...form, monto: e.target.value})} className="text-xl font-bold text-center" />
                    </div>
                    <div className="space-y-2">
                      <Label>Comentario</Label>
                      <Input value={form.comentario} onChange={e => setForm({...form, comentario: e.target.value})} placeholder="Referencia de pago..." />
                    </div>
                    <div className="space-y-2">
                      <Label>Comprobante</Label>
                      <Input type="file" accept="image/*" onChange={e => setArchivo(e.target.files?.[0] || null)} />
                    </div>
                    <Button type="submit" className="w-full" disabled={mutation.isPending}>
                      {mutation.isPending ? "Guardando..." : "Confirmar Movimiento"}
                    </Button>
                  </form>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-md flex items-center gap-2"><History className="h-4 w-4" /> Movimientos</CardTitle>
                <Badge variant="outline">{vendedores.find((v:any) => v.id.toString() === vendedorId)?.nombre}</Badge>
              </CardHeader>
              <div className="max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Detalle</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {todosPagos
                      .filter((p:any) => p.vendedor?.toString() === vendedorId)
                      .map((p: any) => (
                        <TableRow 
                            key={p.id} 
                            className="hover:bg-muted/50 cursor-pointer" 
                            onClick={() => abrirModalImagen(p.comprobante)}
                        >
                          <TableCell className="text-xs">{new Date(p.fecha).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={p.tipo === 'pago' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}>
                              {p.tipo?.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">{p.comentario || '-'}</TableCell>
                          <TableCell className="text-right font-bold">${Number(p.monto).toLocaleString('es-CL')}</TableCell>
                          <TableCell>
                            {p.comprobante && <ImageIcon className="h-4 w-4 text-primary animate-pulse" />}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}