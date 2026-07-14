'use client';

import { FormEvent, useState } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

type Plan = {
  ompCode: string;
  cppCode: string;
  serviceDate: string;
  status: string;
  sourceOrderCount: number;
  totalConfirmedUnits: number;
  totalReserveUnits: number;
  totalProductionUnits: number;
  lines: Array<{
    dishCode: string;
    dishName: string;
    presentation: string;
    confirmedQuantity: number;
    strategicReserveQuantity: number;
    productionRequiredQuantity: number;
  }>;
  alerts: Array<{ code: string; severity: string; message: string }>;
};

export default function PlanningPage() {
  const [cppCode, setCppCode] = useState('CPP-TAM-01');
  const [serviceDate, setServiceDate] = useState('');
  const [reserve, setReserve] = useState('0');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [message, setMessage] = useState('');

  async function generate(event: FormEvent) {
    event.preventDefault();
    setMessage('Generando orden maestra...');
    const response = await fetch(`${apiUrl}/planning/master-orders/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cppCode, serviceDate, strategicReservePercent: Number(reserve) }),
    });
    const json = await response.json();
    if (!response.ok) {
      setMessage(json?.message ?? json?.error?.message ?? 'No se pudo generar la planeación.');
      return;
    }
    setPlan(json.data);
    setMessage('Orden Maestra generada.');
  }

  async function approve() {
    if (!plan) return;
    const response = await fetch(`${apiUrl}/planning/master-orders/${plan.ompCode}/approve`, { method: 'POST' });
    const json = await response.json();
    if (!response.ok) {
      setMessage(json?.message ?? json?.error?.message ?? 'No se pudo aprobar.');
      return;
    }
    setPlan(json.data);
    setMessage('Orden Maestra aprobada.');
  }

  return (
    <main style={{ maxWidth: 1050, margin: '40px auto', padding: 24, fontFamily: 'Arial, sans-serif' }}>
      <h1>Planeación de producción</h1>
      <p>Consolida únicamente pedidos confirmados y genera la Orden Maestra de Producción.</p>
      <form onSubmit={generate} style={{ display: 'grid', gap: 12, gridTemplateColumns: '2fr 2fr 1fr auto' }}>
        <input value={cppCode} onChange={(e) => setCppCode(e.target.value)} placeholder="CPP" required />
        <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} required />
        <input type="number" min="0" max="30" step="0.5" value={reserve} onChange={(e) => setReserve(e.target.value)} />
        <button type="submit">Generar OMP</button>
      </form>
      {message && <p>{message}</p>}
      {plan && (
        <section style={{ marginTop: 28 }}>
          <h2>{plan.ompCode} · {plan.status}</h2>
          <p>{plan.cppCode} · {String(plan.serviceDate).slice(0, 10)} · {plan.sourceOrderCount} pedidos</p>
          <p>Confirmadas: {plan.totalConfirmedUnits} · Reserva: {plan.totalReserveUnits} · A producir: {plan.totalProductionUnits}</p>
          {plan.alerts.length > 0 && (
            <div style={{ border: '1px solid #a33', padding: 12 }}>
              {plan.alerts.map((alert) => <p key={alert.code}><strong>{alert.severity}:</strong> {alert.message}</p>)}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <thead><tr><th>Platillo</th><th>Presentación</th><th>Confirmado</th><th>Reserva</th><th>A producir</th></tr></thead>
            <tbody>
              {plan.lines.map((line) => (
                <tr key={`${line.dishCode}-${line.presentation}`}>
                  <td>{line.dishName}</td><td>{line.presentation}</td><td>{line.confirmedQuantity}</td>
                  <td>{line.strategicReserveQuantity}</td><td>{line.productionRequiredQuantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.status === 'DRAFT' && <button onClick={approve} style={{ marginTop: 20 }}>Aprobar Orden Maestra</button>}
        </section>
      )}
    </main>
  );
}
