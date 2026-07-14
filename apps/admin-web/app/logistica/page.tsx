'use client';

import { useState } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

type Stop = {
  stopId: string; sequence: number; orderCode: string; deliveryCode: string; status: string;
  householdName: string; receiverName?: string | null; failureReasonCode?: string | null;
  location: { alias: string; street: string; exteriorNumber: string; neighborhood: string; references?: string | null };
};
type RouteDetail = {
  routeCode: string; cppCode: string; serviceDate: string; deliveryWindowStart: string; deliveryWindowEnd: string;
  status: string; hostUserCode?: string | null; vehicleCode?: string | null; stops: Stop[];
};
type RouteSummary = {
  routeCode: string; cppCode: string; serviceDate: string; status: string; stopCount: number; deliveredCount: number; failedCount: number;
};

export default function LogisticsPage() {
  const [cppCode, setCppCode] = useState('CPP-TAM-01');
  const [serviceDate, setServiceDate] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [hostUserCode, setHostUserCode] = useState('');
  const [orderCode, setOrderCode] = useState('');
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  const [receiverNames, setReceiverNames] = useState<Record<string, string>>({});
  const [failureReasons, setFailureReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  async function createRoute() {
    const response = await fetch(`${apiUrl}/logistics/routes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cppCode, serviceDate, deliveryWindowStart: windowStart, deliveryWindowEnd: windowEnd,
        hostUserCode: hostUserCode || undefined, maxStops: 20 }),
    });
    const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudo crear la ruta.');
    setDetail(json.data); setMessage(`Ruta ${json.data.routeCode} creada.`); await loadRoutes();
  }

  async function loadRoutes() {
    const params = new URLSearchParams();
    if (cppCode) params.set('cppCode', cppCode);
    if (serviceDate) params.set('serviceDate', serviceDate);
    const response = await fetch(`${apiUrl}/logistics/routes?${params}`); const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudieron consultar las rutas.');
    setRoutes(json.data); setMessage(`${json.data.length} rutas encontradas.`);
  }

  async function open(routeCode: string) {
    const response = await fetch(`${apiUrl}/logistics/routes/${routeCode}`); const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudo abrir la ruta.');
    setDetail(json.data);
  }

  async function addStop() {
    if (!detail) return;
    const response = await fetch(`${apiUrl}/logistics/routes/${detail.routeCode}/stops`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderCode }),
    });
    const json = await response.json(); if (!response.ok) return setMessage(json?.message ?? 'No se pudo agregar el pedido.');
    setDetail(json.data); setOrderCode(''); setMessage('Pedido agregado a la ruta.');
  }

  async function action(path: string, body: Record<string, unknown> = {}) {
    if (!detail) return;
    const response = await fetch(`${apiUrl}/logistics/routes/${detail.routeCode}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await response.json(); if (!response.ok) return setMessage(json?.message ?? 'No se pudo completar la acción.');
    setDetail(json.data); await loadRoutes();
  }

  return <main style={{ maxWidth: 1200, margin: '40px auto', padding: 24, fontFamily: 'Arial, sans-serif' }}>
    <h1>Logística y Entrega</h1>
    <p>Crea rutas con pedidos empacados, registra salida, arribo y resultado de cada entrega.</p>
    <section style={{ background: '#f4f4f4', padding: 16, borderRadius: 14, marginBottom: 20 }}>
      <h2>Nueva ruta</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={cppCode} onChange={(e) => setCppCode(e.target.value)} placeholder="CPP" />
        <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
        <input type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
        <input type="datetime-local" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
        <input value={hostUserCode} onChange={(e) => setHostUserCode(e.target.value)} placeholder="Código del anfitrión" />
        <button onClick={createRoute}>Crear ruta</button>
        <button onClick={loadRoutes}>Consultar rutas</button>
      </div>
    </section>
    {message && <p>{message}</p>}
    <div style={{ display: 'grid', gap: 10, marginBottom: 22 }}>
      {routes.map((r) => <article key={r.routeCode} style={{ background: '#fff', padding: 14, borderRadius: 12 }}>
        <strong>{r.routeCode} · {r.serviceDate} · {r.status}</strong>
        <p>{r.stopCount} paradas · {r.deliveredCount} entregadas · {r.failedCount} fallidas</p>
        <button onClick={() => open(r.routeCode)}>Abrir</button>
      </article>)}
    </div>
    {detail && <section style={{ background: '#f4f4f4', padding: 18, borderRadius: 14 }}>
      <h2>{detail.routeCode} · {detail.status}</h2>
      <p>{detail.cppCode} · {detail.serviceDate} · {new Date(detail.deliveryWindowStart).toLocaleTimeString()}–{new Date(detail.deliveryWindowEnd).toLocaleTimeString()}</p>
      {detail.status === 'DRAFT' && <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} placeholder="PED-" />
          <button onClick={addStop}>Agregar pedido empacado</button>
        </div>
        <button onClick={() => action('/publish', { hostUserCode: hostUserCode || undefined })}>Publicar ruta</button>
      </>}
      {detail.status === 'PUBLISHED' && <button onClick={() => action('/start')}>Iniciar ruta</button>}
      <h3>Paradas</h3>
      {detail.stops.map((s) => <article key={s.stopId} style={{ background: '#fff', padding: 12, marginBottom: 10, borderRadius: 10 }}>
        <strong>{s.sequence}. {s.householdName} · {s.orderCode}</strong>
        <p>{s.location.alias}: {s.location.street} {s.location.exteriorNumber}, {s.location.neighborhood}</p>
        <p>Estado: {s.status} · Entrega: {s.deliveryCode}</p>
        {detail.status === 'IN_PROGRESS' && !['DELIVERED', 'FAILED'].includes(s.status) && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {s.status !== 'ARRIVED' && <button onClick={() => action(`/stops/${s.stopId}/arrive`, {})}>Registrar arribo</button>}
          <input value={receiverNames[s.stopId] ?? ''} onChange={(e) => setReceiverNames({ ...receiverNames, [s.stopId]: e.target.value })} placeholder="Nombre de quien recibe" />
          <button onClick={() => action(`/stops/${s.stopId}/complete`, { receiverName: receiverNames[s.stopId] || 'Responsable del Hogar', receiverType: 'HOUSEHOLD_MEMBER', evidence: {} })}>Entregado</button>
          <input value={failureReasons[s.stopId] ?? ''} onChange={(e) => setFailureReasons({ ...failureReasons, [s.stopId]: e.target.value })} placeholder="Motivo de falla" />
          <button onClick={() => action(`/stops/${s.stopId}/fail`, { reasonCode: 'DELIVERY_NOT_COMPLETED', notes: failureReasons[s.stopId] || 'Entrega no completada', evidence: {} })}>No entregado</button>
        </div>}
      </article>)}
    </section>}
  </main>;
}
