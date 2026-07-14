'use client';

import { FormEvent, useState } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

type QualityLot = {
  lotCode: string;
  productionOrderCode: string;
  cppCode: string;
  serviceDate: string;
  dishName: string;
  presentation: string;
  quantityProduced: number;
  quantityAvailable: number;
  quantityRejected: number;
  status: string;
  inspectionCode?: string | null;
  inspectionStatus?: string | null;
  decision?: string | null;
};

type Check = {
  checkCode: string;
  label: string;
  valueType: string;
  defaultUnit?: string | null;
  mandatory: boolean;
  result?: string | null;
  numericValue?: number | null;
  notes?: string | null;
};

type Inspection = {
  inspectionCode: string;
  status: string;
  decision?: string | null;
  lot: QualityLot;
  checks: Check[];
};

export default function QualityPage() {
  const [cppCode, setCppCode] = useState('CPP-TAM-01');
  const [serviceDate, setServiceDate] = useState('');
  const [lots, setLots] = useState<QualityLot[]>([]);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});
  const [numericValues, setNumericValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [partialApproved, setPartialApproved] = useState('');
  const [decisionReason, setDecisionReason] = useState('');

  async function loadLots() {
    const params = new URLSearchParams();
    if (cppCode) params.set('cppCode', cppCode);
    if (serviceDate) params.set('serviceDate', serviceDate);
    const response = await fetch(`${apiUrl}/quality/lots?${params.toString()}`);
    const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudieron consultar los lotes.');
    setLots(json.data);
    setMessage(`${json.data.length} lotes encontrados.`);
  }

  async function openInspection(lotCode: string) {
    const response = await fetch(`${apiUrl}/quality/lots/${lotCode}/inspections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudo abrir la inspección.');
    setInspection(json.data);
    hydrateChecks(json.data.checks);
    setMessage(`Inspección ${json.data.inspectionCode} abierta.`);
  }

  function hydrateChecks(checks: Check[]) {
    setResults(Object.fromEntries(checks.filter((c) => c.result).map((c) => [c.checkCode, c.result!] )));
    setNumericValues(Object.fromEntries(checks.filter((c) => c.numericValue !== null && c.numericValue !== undefined).map((c) => [c.checkCode, String(c.numericValue)])));
    setNotes(Object.fromEntries(checks.filter((c) => c.notes).map((c) => [c.checkCode, c.notes!] )));
  }

  async function saveCheck(event: FormEvent, check: Check) {
    event.preventDefault();
    const result = results[check.checkCode];
    if (!result) return setMessage(`Selecciona un resultado para ${check.label}.`);
    const response = await fetch(`${apiUrl}/quality/inspections/${inspection?.inspectionCode}/checks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkCode: check.checkCode,
        result,
        numericValue: check.valueType === 'NUMERIC' ? Number(numericValues[check.checkCode]) : undefined,
        unitCode: check.defaultUnit ?? undefined,
        notes: notes[check.checkCode] || undefined,
      }),
    });
    const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? 'No se pudo guardar el control.');
    setInspection(json.data);
    hydrateChecks(json.data.checks);
    setMessage(`${check.label} registrado.`);
  }

  async function decide(decision: 'APPROVE' | 'PARTIAL_RELEASE' | 'REJECT' | 'HOLD') {
    if (!inspection) return;
    const body: Record<string, unknown> = { decision, reason: decisionReason || undefined };
    if (decision === 'PARTIAL_RELEASE') {
      const approved = Number(partialApproved);
      body.approvedQuantity = approved;
      body.rejectedQuantity = inspection.lot.quantityProduced - approved;
    }
    const response = await fetch(`${apiUrl}/quality/inspections/${inspection.inspectionCode}/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) return setMessage(json?.message ?? json?.code ?? 'No se pudo registrar la decisión.');
    setInspection(json.data);
    await loadLots();
    setMessage(`Decisión ${decision} registrada para ${inspection.lot.lotCode}.`);
  }

  return (
    <main style={{ maxWidth: 1200, margin: '40px auto', padding: 24, fontFamily: 'Arial, sans-serif' }}>
      <h1>Control de Calidad</h1>
      <p>Inspecciona lotes, registra controles y libera únicamente las cantidades aprobadas.</p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input value={cppCode} onChange={(e) => setCppCode(e.target.value)} placeholder="CPP" />
        <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
        <button onClick={loadLots}>Consultar lotes</button>
      </div>
      {message && <p>{message}</p>}
      <div style={{ display: 'grid', gap: 10, marginBottom: 28 }}>
        {lots.map((lot) => (
          <article key={lot.lotCode} style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
            <strong>{lot.lotCode} · {lot.dishName}</strong>
            <p>{lot.presentation} · Producido: {lot.quantityProduced} · Disponible: {lot.quantityAvailable} · Rechazado: {lot.quantityRejected}</p>
            <p>Estado: {lot.status} {lot.inspectionCode ? `· Inspección ${lot.inspectionCode}` : ''}</p>
            {['PENDING_QUALITY', 'ON_HOLD', 'IN_QUALITY'].includes(lot.status) && (
              <button onClick={() => openInspection(lot.lotCode)}>{lot.inspectionCode ? 'Abrir inspección' : 'Iniciar inspección'}</button>
            )}
          </article>
        ))}
      </div>

      {inspection && (
        <section style={{ background: '#f4f4f4', padding: 20, borderRadius: 14 }}>
          <h2>{inspection.inspectionCode} · {inspection.lot.lotCode}</h2>
          <p>{inspection.lot.dishName} · {inspection.lot.quantityProduced} unidades · Estado {inspection.status}</p>
          <div style={{ display: 'grid', gap: 12 }}>
            {inspection.checks.map((check) => (
              <form key={check.checkCode} onSubmit={(event) => saveCheck(event, check)} style={{ background: '#fff', padding: 14, borderRadius: 10 }}>
                <strong>{check.label}{check.mandatory ? ' *' : ''}</strong>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <select value={results[check.checkCode] ?? ''} onChange={(e) => setResults({ ...results, [check.checkCode]: e.target.value })}>
                    <option value="">Resultado</option>
                    <option value="PASS">Cumple</option>
                    <option value="FAIL">No cumple</option>
                    {!check.mandatory && <option value="NOT_APPLICABLE">No aplica</option>}
                  </select>
                  {check.valueType === 'NUMERIC' && (
                    <input type="number" step="0.01" value={numericValues[check.checkCode] ?? ''}
                      onChange={(e) => setNumericValues({ ...numericValues, [check.checkCode]: e.target.value })}
                      placeholder={`Valor ${check.defaultUnit ?? ''}`} required />
                  )}
                  <input value={notes[check.checkCode] ?? ''} onChange={(e) => setNotes({ ...notes, [check.checkCode]: e.target.value })} placeholder="Observaciones" />
                  <button type="submit">Guardar</button>
                </div>
              </form>
            ))}
          </div>
          {['OPEN', 'ON_HOLD'].includes(inspection.status) && (
            <div style={{ marginTop: 20, display: 'grid', gap: 10 }}>
              <input value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} placeholder="Motivo u observaciones de decisión" />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => decide('APPROVE')}>Aprobar lote completo</button>
                <input type="number" min="1" max={inspection.lot.quantityProduced - 1} value={partialApproved}
                  onChange={(e) => setPartialApproved(e.target.value)} placeholder="Cantidad aprobada" />
                <button onClick={() => decide('PARTIAL_RELEASE')}>Liberar parcialmente</button>
                <button onClick={() => decide('HOLD')}>Retener</button>
                <button onClick={() => decide('REJECT')}>Rechazar lote</button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
