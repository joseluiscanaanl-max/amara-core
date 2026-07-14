'use client';

import { FormEvent, useMemo, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

type MenuItem = {
  dishCode: string;
  name: string;
  description?: string;
  serviceDate: string;
  presentationName: string;
  price: number;
  availableQuantity: number;
};

type Location = {
  location_code: string;
  alias: string;
  is_covered: boolean;
  delivery_fee: string | number;
  minimum_order: string | number;
};

export default function OrderPage() {
  const [haid, setHaid] = useState('');
  const [menu, setMenu] = useState<any>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationCode, setLocationCode] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [windowStart, setWindowStart] = useState('12:00');
  const [windowEnd, setWindowEnd] = useState('13:00');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const itemsForDate: MenuItem[] = useMemo(
    () => (menu?.items ?? []).filter((item: MenuItem) => String(item.serviceDate).slice(0, 10) === serviceDate),
    [menu, serviceDate],
  );
  const selectedLocation = locations.find((location) => location.location_code === locationCode);
  const subtotal = itemsForDate.reduce(
    (sum, item) => sum + item.price * (quantities[item.dishCode] ?? 0),
    0,
  );
  const deliveryFee = Number(selectedLocation?.delivery_fee ?? 0);
  const total = subtotal + deliveryFee;

  async function load(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const [menuResponse, locationResponse] = await Promise.all([
        fetch(`${API}/menus/households/${encodeURIComponent(haid)}/current`),
        fetch(`${API}/households/${encodeURIComponent(haid)}/locations`),
      ]);
      const menuJson = await menuResponse.json();
      const locationJson = await locationResponse.json();
      if (!menuResponse.ok || !menuJson.success || !menuJson.data) throw new Error('No hay un menú publicado para este Hogar.');
      if (!locationResponse.ok || !locationJson.success) throw new Error('No fue posible consultar los domicilios.');
      const covered = (locationJson.data as Location[]).filter((location) => location.is_covered);
      if (!covered.length) throw new Error('Este Hogar no tiene un domicilio con cobertura activa.');
      setMenu(menuJson.data);
      setLocations(covered);
      setLocationCode(covered[0].location_code);
      const firstDate = String(menuJson.data.items[0]?.serviceDate ?? '').slice(0, 10);
      setServiceDate(firstDate);
      setQuantities({});
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Error inesperado.');
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    setLoading(true);
    setError('');
    try {
      const items = itemsForDate
        .filter((item) => (quantities[item.dishCode] ?? 0) > 0)
        .map((item) => ({ dishCode: item.dishCode, quantity: quantities[item.dishCode] }));
      if (!items.length) throw new Error('Selecciona al menos un platillo.');
      const minimum = Number(selectedLocation?.minimum_order ?? 0);
      if (subtotal < minimum) throw new Error(`El pedido mínimo para esta zona es $${minimum.toFixed(2)}.`);
      const response = await fetch(`${API}/orders/scheduled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          haid,
          locationCode,
          serviceDate,
          deliveryWindowStart: `${serviceDate}T${windowStart}:00-06:00`,
          deliveryWindowEnd: `${serviceDate}T${windowEnd}:00-06:00`,
          items,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json?.error?.message ?? 'No fue posible confirmar el pedido.');
      setResult(json.data);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Error inesperado.');
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <main className="shell">
        <section className="card success-card">
          <div className="success-mark">✓</div>
          <p className="eyebrow">Pedido confirmado</p>
          <h1>Tu comida ya está organizada.</h1>
          <div className="result-box"><span>Folio</span><strong>{result.orderCode}</strong></div>
          <p>{new Date(result.deliveryWindowStart).toLocaleString('es-MX')} – {new Date(result.deliveryWindowEnd).toLocaleTimeString('es-MX')}</p>
          <h2>Total: ${result.total.toFixed(2)}</h2>
          <button className="secondary" onClick={() => setResult(null)}>Crear otro pedido</button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="card order-card">
        <p className="eyebrow">AMARA CORE · Pedido programado</p>
        <h1>Organiza tu próxima comida.</h1>
        <form onSubmit={load}>
          <label htmlFor="haid">HAID</label>
          <input id="haid" value={haid} onChange={(e) => setHaid(e.target.value.toUpperCase())} placeholder="HA-00000001" />
          <button className="primary" disabled={loading || haid.length < 5}>{loading ? 'Consultando…' : 'Consultar disponibilidad'}</button>
        </form>

        {menu && (
          <div className="order-flow">
            <label>Domicilio</label>
            <select value={locationCode} onChange={(e) => setLocationCode(e.target.value)}>
              {locations.map((location) => <option key={location.location_code} value={location.location_code}>{location.alias}</option>)}
            </select>

            <label>Fecha de servicio</label>
            <select value={serviceDate} onChange={(e) => { setServiceDate(e.target.value); setQuantities({}); }}>
              {[...new Set((menu.items as MenuItem[]).map((item) => String(item.serviceDate).slice(0, 10)))].map((date) => (
                <option key={date} value={date}>{new Date(`${date}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}</option>
              ))}
            </select>

            <div className="member-list">
              {itemsForDate.map((item) => (
                <article className="member-card order-item" key={item.dishCode}>
                  <div><strong>{item.name}</strong><span>{item.presentationName} · ${item.price.toFixed(2)}</span><span>Disponibles: {item.availableQuantity}</span></div>
                  <input
                    aria-label={`Cantidad de ${item.name}`}
                    type="number"
                    min="0"
                    max={item.availableQuantity}
                    value={quantities[item.dishCode] ?? 0}
                    onChange={(e) => setQuantities({ ...quantities, [item.dishCode]: Math.max(0, Number(e.target.value)) })}
                  />
                </article>
              ))}
            </div>

            <div className="coordinate-grid">
              <div><label>Inicio de ventana</label><input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} /></div>
              <div><label>Fin de ventana</label><input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} /></div>
            </div>

            <div className="order-summary">
              <span>Subtotal <strong>${subtotal.toFixed(2)}</strong></span>
              <span>Entrega <strong>${deliveryFee.toFixed(2)}</strong></span>
              <span>Total <strong>${total.toFixed(2)}</strong></span>
            </div>
            <button className="primary" type="button" disabled={loading || subtotal <= 0} onClick={confirm}>{loading ? 'Confirmando…' : 'Confirmar pedido'}</button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
