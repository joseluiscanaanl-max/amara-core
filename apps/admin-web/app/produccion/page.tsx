'use client';

import { FormEvent, useState } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

type ProductionOrder = {
  productionOrderCode: string;
  masterOrderCode: string;
  cppCode: string;
  serviceDate: string;
  dishName: string;
  presentation: string;
  plannedQuantity: number;
  actualQuantity: number | null;
  wasteQuantity: number;
  status: string;
  lotCode?: string | null;
  lotStatus?: string | null;
};

export default function ProductionPage() {
  const [ompCode, setOmpCode] = useState('');
  const [cppCode, setCppCode] = useState('CPP-TAM-01');
  const [serviceDate, setServiceDate] = useState('');
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [message, setMessage] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [waste, setWaste] = useState<Record<string, string>>({});

  async function release(event: FormEvent) {
    event.preventDefault();
    setMessage('Liberando órdenes de producción...');
    const response = await fetch(`${apiUrl}/production/master-orders/${ompCode}/release`, { method: 'POST' });
    const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudo liberar la OMP.');
    setOrders(json.data);
    setMessage('Órdenes de producción creadas.');
  }

  async function load() {
    const params = new URLSearchParams();
    if (cppCode) params.set('cppCode', cppCode);
    if (serviceDate) params.set('serviceDate', serviceDate);
    const response = await fetch(`${apiUrl}/production/orders?${params.toString()}`);
    const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudieron consultar las órdenes.');
    setOrders(json.data);
    setMessage(`${json.data.length} órdenes encontradas.`);
  }

  async function start(code: string) {
    const response = await fetch(`${apiUrl}/production/orders/${code}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudo iniciar.');
    setOrders((current) => current.map((item) => item.productionOrderCode === code ? json.data : item));
    setMessage(`${code} iniciada.`);
  }

  async function complete(order: ProductionOrder) {
    const actualQuantity = Number(quantities[order.productionOrderCode] ?? order.plannedQuantity);
    const wasteQuantity = Number(waste[order.productionOrderCode] ?? 0);
    const response = await fetch(`${apiUrl}/production/orders/${order.productionOrderCode}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actualQuantity,
        wasteQuantity,
        wasteReasonCode: wasteQuantity > 0 ? 'PROCESS_WASTE' : undefined,
      }),
    });
    const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudo terminar la producción.');
    await load();
    setMessage(`Lote ${json.data.lotCode} creado y enviado a Calidad.`);
  }

  return (
    <main style={{ maxWidth: 1150, margin: '40px auto', padding: 24, fontFamily: 'Arial, sans-serif' }}>
      <h1>Producción y lotes</h1>
      <p>Convierte la OMP aprobada en órdenes, registra ejecución y crea lotes pendientes de Calidad.</p>
      <form onSubmit={release} style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <input value={ompCode} onChange={(e) => setOmpCode(e.target.value)} placeholder="OMP-00000001" required />
        <button type="submit">Liberar OMP</button>
      </form>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input value={cppCode} onChange={(e) => setCppCode(e.target.value)} placeholder="CPP" />
        <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
        <button onClick={load}>Consultar órdenes</button>
      </div>
      {message && <p>{message}</p>}
      <div style={{ display: 'grid', gap: 12 }}>
        {orders.map((order) => (
          <article key={order.productionOrderCode} style={{ background: '#fff', padding: 18, borderRadius: 12 }}>
            <strong>{order.productionOrderCode} · {order.dishName}</strong>
            <p>{order.presentation} · Planeado: {order.plannedQuantity} · Estado: {order.status}</p>
            {order.lotCode && <p>Lote: {order.lotCode} · {order.lotStatus}</p>}
            {order.status === 'READY' && <button onClick={() => start(order.productionOrderCode)}>Iniciar</button>}
            {order.status === 'IN_PROGRESS' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label>Producido <input type="number" min="1" value={quantities[order.productionOrderCode] ?? order.plannedQuantity}
                  onChange={(e) => setQuantities({ ...quantities, [order.productionOrderCode]: e.target.value })} /></label>
                <label>Merma <input type="number" min="0" value={waste[order.productionOrderCode] ?? 0}
                  onChange={(e) => setWaste({ ...waste, [order.productionOrderCode]: e.target.value })} /></label>
                <button onClick={() => complete(order)}>Terminar y crear lote</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
