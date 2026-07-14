'use client';

import { useState } from 'react';
const apiUrl=process.env.NEXT_PUBLIC_API_URL??'http://localhost:3001/v1';
export default function HouseholdExperiencePage(){
  const [haid,setHaid]=useState('');const [orderCode,setOrderCode]=useState('');const [ease,setEase]=useState(5);const [punctuality,setPunctuality]=useState(5);
  const [quality,setQuality]=useState(5);const [tranquility,setTranquility]=useState(5);const [comment,setComment]=useState('');const [reportProblem,setReportProblem]=useState(false);const [message,setMessage]=useState('');
  async function submit(){const r=await fetch(`${apiUrl}/experience/orders/${orderCode}/evaluations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({haid,easeScore:ease,punctualityScore:punctuality,qualityScore:quality,tranquilityScore:tranquility,comment:comment||undefined,reportProblem})});const j=await r.json();if(!r.ok)return setMessage(j?.message??'No pudimos guardar tu evaluación.');setMessage(j.data.incidentCode?`Gracias. Abrimos el caso ${j.data.incidentCode} para darte seguimiento.`:'Gracias. Tu evaluación quedó registrada.')}
  const score=(label:string,value:number,setter:(n:number)=>void)=><label style={{display:'grid',gap:6}}>{label}<select value={value} onChange={e=>setter(Number(e.target.value))}>{[5,4,3,2,1].map(n=><option key={n} value={n}>{n}</option>)}</select></label>;
  return <main style={{maxWidth:560,margin:'32px auto',padding:20,fontFamily:'Arial, sans-serif'}}><h1>¿AMARA hizo más fácil tu comida?</h1><p>Tu respuesta nos ayuda a mejorar y a resolver cualquier problema.</p>
    <div style={{display:'grid',gap:12}}><input value={haid} onChange={e=>setHaid(e.target.value)} placeholder="HA-"/><input value={orderCode} onChange={e=>setOrderCode(e.target.value)} placeholder="PED-"/>
      {score('Facilidad',ease,setEase)}{score('Puntualidad',punctuality,setPunctuality)}{score('Calidad',quality,setQuality)}{score('Tranquilidad',tranquility,setTranquility)}
      <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Cuéntanos brevemente" style={{minHeight:100}}/><label><input type="checkbox" checked={reportProblem} onChange={e=>setReportProblem(e.target.checked)}/> Necesito que AMARA me contacte por un problema</label>
      <button onClick={submit}>Enviar evaluación</button>{message&&<p>{message}</p>}</div></main>
}
