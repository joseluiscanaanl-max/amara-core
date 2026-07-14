'use client';

import { useState } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

type PackingSummary = {
  packingOrderCode: string; orderCode: string; haid: string; householdName: string;
  cppCode: string; serviceDate: string; status: string; requiredUnits: number; allocatedUnits: number;
};
type PackingDetail = PackingSummary & {
  location: { alias: string; street: string; exteriorNumber: string; neighborhood: string };
  items: Array<{ packingItemId: string; dishName: string; presentation: string; requiredQuantity: number;
    allocatedQuantity: number; labelCode: string; memberName?: string | null; allocations: Array<{ lotCode: string; quantity: number }> }>;
  checks: Array<{ checkCode: string; label: string; mandatory: boolean; result?: string | null }>;
};

export default function PackingPage() {
  const [cppCode, setCppCode] = useState('CPP-TAM-01');
  const [serviceDate, setServiceDate] = useState('');
  const [orders, setOrders] = useState<PackingSummary[]>([]);
  const [detail, setDetail] = useState<PackingDetail | null>(null);
  const [orderCode, setOrderCode] = useState('');
  const [lotCodes, setLotCodes] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  async function createPackingOrder() {
    const response = await fetch(`${apiUrl}/packing/orders/from-order/${orderCode}`, { method: 'POST' });
    const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudo crear la orden de empaque.');
    setDetail(json.data); setMessage(`Orden ${json.data.packingOrderCode} creada.`); await loadOrders();
  }
  async function loadOrders() {
    const params = new URLSearchParams();
    if (cppCode) params.set('cppCode', cppCode);
    if (serviceDate) params.set('serviceDate', serviceDate);
    const response = await fetch(`${apiUrl}/packing/orders?${params}`);
    const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudieron consultar las órdenes.');
    setOrders(json.data); setMessage(`${json.data.length} órdenes encontradas.`);
  }
  async function open(code: string) {
    const response = await fetch(`${apiUrl}/packing/orders/${code}`); const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudo abrir la orden.');
    setDetail(json.data);
  }
  async function start() {
    if (!detail) return;
    const response = await fetch(`${apiUrl}/packing/orders/${detail.packingOrderCode}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    const json = await response.json(); if (!response.ok) return setMessage(json?.message ?? 'No se pudo iniciar.');
    setDetail(json.data); setMessage('Empaque iniciado.');
  }
  async function allocate(itemId: string) {
    if (!detail) return;
    const response = await fetch(`${apiUrl}/packing/orders/${detail.packingOrderCode}/items/${itemId}/allocate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lotCode: lotCodes[itemId], quantity: Number(quantities[itemId]) }),
    });
    const json = await response.json(); if (!response.ok) return setMessage(json?.message ?? 'No se pudo asignar el lote.');
    setDetail(json.data); setMessage('Lote asignado.');
  }
  async function check(checkCode: string, result: 'PASS' | 'FAIL') {
    if (!detail) return;
    const response = await fetch(`${apiUrl}/packing/orders/${detail.packingOrderCode}/checks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkCode, result }),
    });
    const json = await response.json(); if (!response.ok) return setMessage(json?.message ?? 'No se pudo guardar el control.');
    setDetail(json.data);
  }
  async function close() {
    if (!detail) return;
    const response = await fetch(`${apiUrl}/packing/orders/${detail.packingOrderCode}/close`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    const json = await response.json(); if (!response.ok) return setMessage(json?.message ?? 'No se pudo cerrar el empaque.');
    setDetail(json.data); setMessage('Pedido listo para Logística.'); await loadOrders();
  }

  return (
    <main style={{ maxWidth: 1200, margin: '40px auto', padding: 24, fontFamily: 'Arial, sans-serif' }}>
      <h1>Empaque</h1>
      <p>Asigna únicamente lotes liberados, verifica cada componente y cierra el pedido para Logística.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} placeholder="Folio PED-" />
        <button onClick={createPackingOrder}>Crear orden desde pedido</button>
        <input value={cppCode} onChange={(e) => setCppCode(e.target.value)} placeholder="CPP" />
        <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
        <button onClick={loadOrders}>Consultar</button>
      </div>
      {message && <p>{message}</p>}
      <div style={{ display: 'grid', gap: 10, marginBottom: 24 }}>
        {orders.map((order) => <article key={order.packingOrderCode} style={{ background: '#fff', padding: 14, borderRadius: 12 }}>
          <strong>{order.packingOrderCode} · {order.householdName}</strong>
          <p>{order.orderCode} · {order.serviceDate} · {order.allocatedUnits}/{order.requiredUnits} unidades · {order.status}</p>
          <button onClick={() => open(order.packingOrderCode)}>Abrir</button>
        </article>)}
      </div>
      {detail && <section style={{ background: '#f4f4f4', padding: 18, borderRadius: 14 }}>
        <h2>{detail.packingOrderCode} · {detail.householdName}</h2>
        <p>{detail.location.alias} · {detail.location.street} {detail.location.exteriorNumber}, {detail.location.neighborhood}</p>
        <p>Estado: {detail.status}</p>
        {detail.status === 'PENDING' && <button onClick={start}>Iniciar empaque</button>}
        <h3>Partidas</h3>
        {detail.items.map((item) => <article key={item.packingItemId} style={{ background: '#fff', padding: 12, marginBottom: 8 }}>
          <strong>{item.dishName} · {item.presentation}</strong>
          <p>Etiqueta {item.labelCode} · Integrante: {item.memberName ?? 'Consumo general'} · {item.allocatedQuantity}/{item.requiredQuantity}</p>
          <p>Lotes: {item.allocations.map((a) => `${a.lotCode} (${a.quantity})`).join(', ') || 'Sin asignar'}</p>
          {item.allocatedQuantity < item.requiredQuantity && <div style={{ display: 'flex', gap: 8 }}>
            <input value={lotCodes[item.packingItemId] ?? ''} onChange={(e) => setLotCodes({ ...lotCodes, [item.packingItemId]: e.target.value })} placeholder="LOT-" />
            <input type="number" min="1" value={quantities[item.packingItemId] ?? ''} onChange={(e) => setQuantities({ ...quantities, [item.packingItemId]: e.target.value })} placeholder="Cantidad" />
            <button onClick={() => allocate(item.packingItemId)}>Asignar lote</button>
          </div>}
        </article>)}
        <h3>Checklist</h3>
        {detail.checks.map((checkItem) => <div key={checkItem.checkCode} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ flex: 1 }}>{checkItem.label}{checkItem.mandatory ? ' *' : ''} · {checkItem.result ?? 'Pendiente'}</span>
          <button onClick={() => check(checkItem.checkCode, 'PASS')}>Cumple</button>
          <button onClick={() => check(checkItem.checkCode, 'FAIL')}>No cumple</button>
        </div>)}
        {['PENDING', 'IN_PROGRESS'].includes(detail.status) && <button onClick={close} style={{ marginTop: 14 }}>Cerrar y enviar a Logística</button>}
      </section>}
    </main>
  );
}
