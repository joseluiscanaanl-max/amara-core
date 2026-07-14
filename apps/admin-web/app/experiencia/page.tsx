'use client';

import { useState } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

type Incident = { incidentCode:string; householdName:string; haid:string; orderCode?:string|null; cppCode?:string|null; categoryCode:string; severity:string; status:string; description:string; assignedUserCode?:string|null; openedAt:string; dueAt?:string|null };
type Detail = Incident & { updates:Array<{updateCode:string;type:string;note:string;statusBefore?:string|null;statusAfter?:string|null;createdAt:string}>; compensations:Array<{compensationCode:string;type:string;amount?:number|null;description:string;status:string}>; resolutionSummary?:string|null };

export default function ExperiencePage(){
  const [status,setStatus]=useState(''); const [cppCode,setCppCode]=useState('CPP-TAM-01'); const [incidents,setIncidents]=useState<Incident[]>([]);
  const [detail,setDetail]=useState<Detail|null>(null); const [userCode,setUserCode]=useState(''); const [note,setNote]=useState('');
  const [resolution,setResolution]=useState(''); const [message,setMessage]=useState('');

  async function load(){const q=new URLSearchParams();if(status)q.set('status',status);if(cppCode)q.set('cppCode',cppCode);
    const r=await fetch(`${apiUrl}/experience/incidents?${q}`);const j=await r.json();if(!r.ok)return setMessage(j?.message??'No se pudieron consultar incidencias.');setIncidents(j.data);setMessage(`${j.data.length} incidencias encontradas.`)}
  async function open(code:string){const r=await fetch(`${apiUrl}/experience/incidents/${code}`);const j=await r.json();if(!r.ok)return setMessage(j?.message??'No se pudo abrir la incidencia.');setDetail(j.data)}
  async function post(path:string,body:Record<string,unknown>){if(!detail)return;const r=await fetch(`${apiUrl}/experience/incidents/${detail.incidentCode}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)return setMessage(j?.message??'No se pudo completar la acción.');setDetail(j.data);setMessage('Incidencia actualizada.');await load()}

  return <main style={{maxWidth:1200,margin:'40px auto',padding:24,fontFamily:'Arial, sans-serif'}}>
    <h1>Experiencia e Incidencias</h1><p>Da seguimiento a problemas posteriores a la entrega y documenta su resolución.</p>
    <section style={{background:'#f4f4f4',padding:16,borderRadius:14,marginBottom:20}}><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <input value={cppCode} onChange={e=>setCppCode(e.target.value)} placeholder="CPP" />
      <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos los estados</option><option>OPEN</option><option>ACKNOWLEDGED</option><option>IN_PROGRESS</option><option>WAITING_HOUSEHOLD</option><option>RESOLVED</option><option>CLOSED</option></select>
      <button onClick={load}>Consultar incidencias</button></div></section>{message&&<p>{message}</p>}
    <div style={{display:'grid',gap:10,marginBottom:22}}>{incidents.map(i=><article key={i.incidentCode} style={{background:'#fff',padding:14,borderRadius:12}}>
      <strong>{i.incidentCode} · {i.severity} · {i.status}</strong><p>{i.householdName} · {i.orderCode??'Sin pedido'} · {i.categoryCode}</p><p>{i.description}</p><button onClick={()=>open(i.incidentCode)}>Abrir</button>
    </article>)}</div>
    {detail&&<section style={{background:'#f4f4f4',padding:18,borderRadius:14}}><h2>{detail.incidentCode} · {detail.status}</h2><p><strong>{detail.householdName}</strong> · {detail.haid} · {detail.orderCode??'Sin pedido'}</p><p>{detail.description}</p>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}><input value={userCode} onChange={e=>setUserCode(e.target.value)} placeholder="Código de responsable"/><button onClick={()=>post('/assign',{assignedUserCode:userCode,note:note||undefined})}>Asignar</button></div>
      <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Nota de seguimiento" style={{width:'100%',minHeight:80}}/><div style={{display:'flex',gap:8,margin:'8px 0'}}>
        <button onClick={()=>post('/updates',{note,status:'IN_PROGRESS',userCode:userCode||undefined})}>Registrar seguimiento</button><button onClick={()=>post('/updates',{note,status:'WAITING_HOUSEHOLD',userCode:userCode||undefined})}>Esperando al Hogar</button></div>
      <textarea value={resolution} onChange={e=>setResolution(e.target.value)} placeholder="Resumen de solución" style={{width:'100%',minHeight:80}}/><div style={{display:'flex',gap:8,margin:'8px 0'}}>
        <button onClick={()=>post('/resolve',{resolutionSummary:resolution,userCode:userCode||undefined})}>Resolver</button>{detail.status==='RESOLVED'&&<button onClick={()=>post('/close',{note:note||'Seguimiento completado',userCode:userCode||undefined})}>Cerrar</button>}</div>
      <h3>Historial</h3>{detail.updates.map(u=><p key={u.updateCode}><strong>{u.type}</strong> · {u.note}</p>)}
      <h3>Compensaciones</h3>{detail.compensations.map(c=><p key={c.compensationCode}>{c.compensationCode} · {c.type} · {c.status} · {c.description}</p>)}
    </section>}
  </main>
}
