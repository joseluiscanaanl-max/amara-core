'use client';

import { FormEvent, useMemo, useState } from 'react';

type Step = 'phone' | 'otp' | 'household' | 'responsible' | 'members' | 'care' | 'location' | 'complete';
type ApiError = { message?: string | string[]; error?: { code?: string; message?: string } };
type MemberSummary = {
  memberCode: string;
  firstName: string;
  lastName?: string | null;
  alias?: string | null;
  isPrimaryResponsible: boolean;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

const messages: Record<string, string> = {
  CONSENT_REQUIRED: 'Debes aceptar el aviso de privacidad para continuar.',
  PHONE_INVALID: 'Revisa que el número móvil tenga 10 dígitos.',
  PHONE_ALREADY_REGISTERED: 'Este número ya está relacionado con un Hogar AMARA.',
  REGISTRATION_NOT_FOUND: 'No encontramos este proceso de registro. Inicia nuevamente.',
  OTP_INVALID: 'El código no coincide. Revísalo e inténtalo otra vez.',
  OTP_EXPIRED: 'El código venció. Inicia un nuevo registro para solicitar otro.',
  OTP_ALREADY_USED: 'Este código ya fue utilizado.',
  OTP_MAX_ATTEMPTS: 'Alcanzaste el máximo de intentos permitidos.',
  HOUSEHOLD_NAME_INVALID: 'Escribe un nombre de Hogar de 2 a 100 caracteres.',
  HOUSEHOLD_MEMBER_COUNT_INVALID: 'El número de integrantes debe estar entre 1 y 20.',
  HOUSEHOLD_PROFILE_INCOMPLETE: 'Completa primero los datos básicos del Hogar.',
  MEMBER_NAME_INVALID: 'Escribe un nombre de integrante válido.',
  PRIMARY_RESPONSIBLE_ALREADY_EXISTS: 'Este Hogar ya tiene una persona responsable principal.',
  HOUSEHOLD_MEMBER_LIMIT_REACHED: 'Ya registraste el número estimado de integrantes.',
  PREFERENCE_CATEGORY_REQUIRED: 'Selecciona el tipo de preferencia.',
  PREFERENCE_VALUE_REQUIRED: 'Indica una preferencia.',
  SENSITIVE_DATA_CONSENT_REQUIRED: 'Debes autorizar el tratamiento de esta información sensible.',
  RESTRICTION_DATA_REQUIRED: 'Indica el tipo y el alimento o restricción.',
  MEMBER_NOT_IN_HOUSEHOLD: 'No encontramos al integrante dentro de este Hogar.',
  LOCATION_COORDINATES_REQUIRED: 'Confirma la latitud y longitud del punto de entrega.',
  LOCATION_NOT_FOUND: 'No encontramos esta ubicación.',
  REPRESENTATIVE_REQUIRED: 'Selecciona a la persona representante.',
  REPRESENTATIVE_NOT_FOUND: 'No encontramos a la persona representante seleccionada.',
};

export default function RegistrationPage() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [registrationId, setRegistrationId] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [developmentCode, setDevelopmentCode] = useState('');
  const [code, setCode] = useState('');
  const [haid, setHaid] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [householdTypeCode, setHouseholdTypeCode] = useState('FAMILY_WITH_CHILDREN');
  const [estimatedMembers, setEstimatedMembers] = useState(1);
  const [originChannelCode, setOriginChannelCode] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [responsibleFirstName, setResponsibleFirstName] = useState('');
  const [responsibleLastName, setResponsibleLastName] = useState('');
  const [responsibleAgeRange, setResponsibleAgeRange] = useState('');
  const [canAuthorizeDependents, setCanAuthorizeDependents] = useState(false);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [memberFirstName, setMemberFirstName] = useState('');
  const [memberLastName, setMemberLastName] = useState('');
  const [memberRole, setMemberRole] = useState('OTHER');
  const [memberAgeRange, setMemberAgeRange] = useState('');
  const [careIndex, setCareIndex] = useState(0);
  const [spiceLevel, setSpiceLevel] = useState('MILD');
  const [avoidedFood, setAvoidedFood] = useState('');
  const [hasRestriction, setHasRestriction] = useState(false);
  const [restrictionType, setRestrictionType] = useState('ALLERGY');
  const [restrictionSubject, setRestrictionSubject] = useState('');
  const [restrictionSeverity, setRestrictionSeverity] = useState('MEDIUM');
  const [crossContaminationRisk, setCrossContaminationRisk] = useState(false);
  const [sensitiveConsent, setSensitiveConsent] = useState(false);
  const [locationAlias, setLocationAlias] = useState('Casa');
  const [street, setStreet] = useState('');
  const [exteriorNumber, setExteriorNumber] = useState('');
  const [interiorNumber, setInteriorNumber] = useState('');
  const [colonyName, setColonyName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('Tampico');
  const [stateName, setStateName] = useState('Tamaulipas');
  const [betweenStreets, setBetweenStreets] = useState('');
  const [references, setReferences] = useState('');
  const [latitude, setLatitude] = useState('22.2331');
  const [longitude, setLongitude] = useState('-97.8611');
  const [coverage, setCoverage] = useState<{covered:boolean;zoneCode?:string|null;cppCode?:string|null;deliveryFee?:number|null;minimumOrder?:number|null} | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const digits = useMemo(() => phone.replace(/\D/g, '').slice(0, 10), [phone]);
  const progress = step === 'phone' || step === 'otp' ? 'Paso 1 de 6' : step === 'household' ? 'Paso 2 de 6' : step === 'responsible' || step === 'members' ? 'Paso 3 de 6' : step === 'care' ? 'Paso 4 de 6' : step === 'location' ? 'Paso 5 de 6' : 'Paso 6 de 6';

  async function startRegistration(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const body = await request<{ registrationId: string; maskedPhone: string; developmentCode?: string }>(
        `${API_URL}/households/registration/start`,
        { method: 'POST', body: JSON.stringify({ countryCode: 'MX', phone: digits, privacyConsent }) },
      );
      setRegistrationId(body.registrationId);
      setMaskedPhone(body.maskedPhone);
      setDevelopmentCode(body.developmentCode ?? '');
      setStep('otp');
    });
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const body = await request<{ haid: string }>(`${API_URL}/households/registration/verify-otp`, {
        method: 'POST',
        body: JSON.stringify({ registrationId, code }),
      });
      setHaid(body.haid);
      setStep('household');
    });
  }

  async function saveHousehold(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await request(`${API_URL}/households/${haid}/profile`, {
        method: 'PATCH',
        body: JSON.stringify({ householdName, householdTypeCode, estimatedMembers, originChannelCode, referralCode }),
      });
      setStep('responsible');
    });
  }

  async function saveResponsible(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const created = await request<{ memberCode: string }>(`${API_URL}/households/${haid}/members`, {
        method: 'POST',
        body: JSON.stringify({
          firstName: responsibleFirstName,
          lastName: responsibleLastName,
          ageRangeCode: responsibleAgeRange || undefined,
          householdRoleCode: 'PRIMARY_RESPONSIBLE',
          isPrimaryResponsible: true,
          isAccountManager: true,
          canAuthorizeDependents,
        }),
      });
      setMembers([{ memberCode: created.memberCode, firstName: responsibleFirstName, lastName: responsibleLastName, isPrimaryResponsible: true }]);
      setStep(estimatedMembers > 1 ? 'members' : 'care');
    });
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const created = await request<{ memberCode: string; memberCount: number }>(`${API_URL}/households/${haid}/members`, {
        method: 'POST',
        body: JSON.stringify({
          firstName: memberFirstName,
          lastName: memberLastName,
          ageRangeCode: memberAgeRange || undefined,
          householdRoleCode: memberRole,
          isPrimaryResponsible: false,
          isAccountManager: false,
        }),
      });
      setMembers((current) => [...current, { memberCode: created.memberCode, firstName: memberFirstName, lastName: memberLastName, isPrimaryResponsible: false }]);
      setMemberFirstName('');
      setMemberLastName('');
      setMemberAgeRange('');
      setMemberRole('OTHER');
      if (created.memberCount >= estimatedMembers) setStep('care');
    });
  }


  async function saveCare(event: FormEvent) {
    event.preventDefault();
    const member = members[careIndex];
    if (!member) return;
    await run(async () => {
      await request(`${API_URL}/households/${haid}/members/${member.memberCode}/preferences`, {
        method: 'POST', body: JSON.stringify({ categoryCode: 'SPICE_LEVEL', valueCode: spiceLevel }),
      });
      if (avoidedFood.trim()) {
        await request(`${API_URL}/households/${haid}/members/${member.memberCode}/preferences`, {
          method: 'POST', body: JSON.stringify({ categoryCode: 'AVOIDED_FOOD', valueText: avoidedFood.trim() }),
        });
      }
      if (hasRestriction) {
        await request(`${API_URL}/households/${haid}/members/${member.memberCode}/restrictions`, {
          method: 'POST',
          body: JSON.stringify({
            typeCode: restrictionType,
            subject: restrictionSubject,
            declaredSeverityCode: restrictionSeverity,
            crossContaminationRisk,
            consentAccepted: sensitiveConsent,
            noticeVersion: 'NUTRITION-2027-01',
          }),
        });
      }
      setSpiceLevel('MILD'); setAvoidedFood(''); setHasRestriction(false); setRestrictionSubject('');
      setCrossContaminationRisk(false); setSensitiveConsent(false);
      if (careIndex + 1 < members.length) setCareIndex(careIndex + 1); else setStep('location');
    });
  }

  async function saveLocation(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await request<{locationCode:string;covered:boolean;zoneCode?:string|null;cppCode?:string|null;deliveryFee?:number|null;minimumOrder?:number|null}>(`${API_URL}/households/${haid}/locations`, {
        method: 'POST',
        body: JSON.stringify({
          alias: locationAlias, street, exteriorNumber, interiorNumber, colonyName, postalCode,
          city, stateName, betweenStreets, references,
          latitude: Number(latitude), longitude: Number(longitude), isPrimary: true,
        }),
      });
      setCoverage(result);
    });
  }

  async function run(action: () => Promise<void>) {
    setError('');
    setLoading(true);
    try { await action(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'No pudimos completar la operación.'); }
    finally { setLoading(false); }
  }



  if (step === 'location') {
    return (
      <main className="shell">
        <form className="card" onSubmit={saveLocation}>
          <p className="eyebrow">{progress}</p>
          <h1>¿Dónde entregaremos?</h1>
          <p className="lead">El domicilio y las coordenadas permiten asignar la zona y el CPP que atenderá al Hogar.</p>
          <label htmlFor="location-alias">Alias</label><input id="location-alias" value={locationAlias} onChange={(e)=>setLocationAlias(e.target.value)} />
          <label htmlFor="street">Calle</label><input id="street" value={street} onChange={(e)=>setStreet(e.target.value)} />
          <label htmlFor="ext">Número exterior</label><input id="ext" value={exteriorNumber} onChange={(e)=>setExteriorNumber(e.target.value)} />
          <label htmlFor="int">Número interior, opcional</label><input id="int" value={interiorNumber} onChange={(e)=>setInteriorNumber(e.target.value)} />
          <label htmlFor="colony">Colonia</label><input id="colony" value={colonyName} onChange={(e)=>setColonyName(e.target.value)} />
          <label htmlFor="postal">Código postal</label><input id="postal" inputMode="numeric" maxLength={5} value={postalCode} onChange={(e)=>setPostalCode(e.target.value.replace(/\D/g,'').slice(0,5))} />
          <label htmlFor="city">Ciudad</label><input id="city" value={city} onChange={(e)=>setCity(e.target.value)} />
          <label htmlFor="state">Estado</label><input id="state" value={stateName} onChange={(e)=>setStateName(e.target.value)} />
          <label htmlFor="between">Entre calles, opcional</label><input id="between" value={betweenStreets} onChange={(e)=>setBetweenStreets(e.target.value)} />
          <label htmlFor="references">Referencias, opcional</label><input id="references" value={references} onChange={(e)=>setReferences(e.target.value)} />
          <div className="coordinate-grid"><div><label htmlFor="lat">Latitud</label><input id="lat" inputMode="decimal" value={latitude} onChange={(e)=>setLatitude(e.target.value)} /></div><div><label htmlFor="lng">Longitud</label><input id="lng" inputMode="decimal" value={longitude} onChange={(e)=>setLongitude(e.target.value)} /></div></div>
          <p className="fine">En el MVP las coordenadas se capturan manualmente. Después se integrará un mapa para mover el marcador al acceso exacto.</p>
          {coverage && <div className={coverage.covered ? 'coverage covered' : 'coverage uncovered'}>{coverage.covered ? <><strong>Ubicación con cobertura</strong><span>Zona: {coverage.zoneCode} · CPP: {coverage.cppCode}</span><span>Entrega: ${coverage.deliveryFee} · Pedido mínimo: ${coverage.minimumOrder}</span></> : <><strong>Aún no tenemos cobertura</strong><span>La ubicación quedará registrada para expansión territorial.</span></>}</div>}
          {error && <p className="error" role="alert">{error}</p>}
          {!coverage ? <button className="primary" disabled={loading || street.trim().length<2 || !exteriorNumber.trim() || colonyName.trim().length<2 || postalCode.length!==5 || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))} type="submit">{loading ? 'Evaluando…' : 'Guardar y evaluar cobertura'}</button> : <button className="primary" type="button" onClick={()=>setStep('complete')}>Continuar</button>}
        </form>
      </main>
    );
  }

  if (step === 'care') {
    const member = members[careIndex];
    return (
      <main className="shell">
        <form className="card" onSubmit={saveCare}>
          <p className="eyebrow">{progress}</p>
          <h1>Preferencias de {member?.firstName}</h1>
          <p className="lead">Estas preferencias son declaradas por el Hogar. Las alergias se registran por separado y requieren autorización.</p>
          <label htmlFor="spice-level">Nivel de picante</label>
          <select id="spice-level" value={spiceLevel} onChange={(event) => setSpiceLevel(event.target.value)}>
            <option value="NONE">Sin picante</option><option value="MILD">Poco</option><option value="MEDIUM">Medio</option><option value="HIGH">Alto</option>
          </select>
          <label htmlFor="avoided-food">Alimentos que evita, opcional</label>
          <input id="avoided-food" value={avoidedFood} onChange={(event) => setAvoidedFood(event.target.value)} placeholder="Ej. cebolla cruda" />
          <label className="check"><input type="checkbox" checked={hasRestriction} onChange={(event) => setHasRestriction(event.target.checked)} />Tiene una alergia, intolerancia o restricción importante.</label>
          {hasRestriction && <div className="sensitive-panel">
            <label htmlFor="restriction-type">Tipo</label>
            <select id="restriction-type" value={restrictionType} onChange={(event) => setRestrictionType(event.target.value)}>
              <option value="ALLERGY">Alergia</option><option value="INTOLERANCE">Intolerancia</option><option value="INGREDIENT_AVOIDED">Ingrediente excluido</option><option value="PROFESSIONAL_INDICATION">Indicación profesional</option><option value="OTHER">Otra</option>
            </select>
            <label htmlFor="restriction-subject">Alimento o restricción</label>
            <input id="restriction-subject" value={restrictionSubject} onChange={(event) => setRestrictionSubject(event.target.value)} />
            <label htmlFor="restriction-severity">Severidad declarada</label>
            <select id="restriction-severity" value={restrictionSeverity} onChange={(event) => setRestrictionSeverity(event.target.value)}>
              <option value="LOW">Baja</option><option value="MEDIUM">Media</option><option value="HIGH">Alta</option>
            </select>
            <label className="check"><input type="checkbox" checked={crossContaminationRisk} onChange={(event) => setCrossContaminationRisk(event.target.checked)} />Existe riesgo de contaminación cruzada.</label>
            <label className="check"><input type="checkbox" checked={sensitiveConsent} onChange={(event) => setSensitiveConsent(event.target.checked)} />Autorizo a AMARA a tratar esta información para evaluar la preparación segura.</label>
            <p className="warning-note">Registrar la restricción no garantiza que AMARA pueda atender todas las preparaciones. Primero se realizará una revisión operativa.</p>
          </div>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" disabled={loading || (hasRestriction && (!restrictionSubject.trim() || !sensitiveConsent))} type="submit">{loading ? 'Guardando…' : careIndex + 1 < members.length ? 'Guardar y continuar' : 'Finalizar registro'}</button>
        </form>
      </main>
    );
  }

  if (step === 'complete') {
    return (
      <main className="shell">
        <section className="card success-card">
          <div className="success-mark">✓</div>
          <p className="eyebrow">{progress}</p>
          <h1>Tu Hogar AMARA está activo.</h1>
          <p className="lead">Creamos el perfil del Hogar y registramos a {members.length} {members.length === 1 ? 'integrante' : 'integrantes'}.</p>
          <div className="result-box"><span>Hogar</span><strong>{householdName}</strong></div>
          <div className="result-box"><span>HAID</span><strong>{haid}</strong></div>
          <a className="primary" href="/">Ir al inicio</a>
        </section>
      </main>
    );
  }

  if (step === 'members') {
    return (
      <main className="shell">
        <section className="card">
          <p className="eyebrow">{progress}</p>
          <h1>Integrantes del Hogar</h1>
          <div className="member-list">
            {members.map((member) => (
              <div className="member-card" key={member.memberCode}>
                <strong>{member.firstName} {member.lastName}</strong>
                <span>{member.isPrimaryResponsible ? 'Responsable principal' : 'Integrante'}</span>
              </div>
            ))}
          </div>
          {members.length < estimatedMembers && (
            <form onSubmit={addMember}>
              <h2>Agregar integrante {members.length + 1} de {estimatedMembers}</h2>
              <label htmlFor="member-first-name">Nombre o alias</label>
              <input id="member-first-name" value={memberFirstName} onChange={(event) => setMemberFirstName(event.target.value)} />
              <label htmlFor="member-last-name">Apellido, opcional</label>
              <input id="member-last-name" value={memberLastName} onChange={(event) => setMemberLastName(event.target.value)} />
              <label htmlFor="member-role">Rol en el Hogar</label>
              <select id="member-role" value={memberRole} onChange={(event) => setMemberRole(event.target.value)}>
                <option value="PARTNER">Pareja</option><option value="CHILD">Hijo o hija</option><option value="PARENT">Padre o madre</option><option value="OTHER">Otro</option>
              </select>
              <label htmlFor="member-age">Rango de edad</label>
              <AgeRangeSelect id="member-age" value={memberAgeRange} onChange={setMemberAgeRange} />
              {error && <p className="error" role="alert">{error}</p>}
              <button className="primary" disabled={loading || memberFirstName.trim().length < 2} type="submit">{loading ? 'Guardando…' : 'Guardar integrante'}</button>
            </form>
          )}
          <button className="secondary" type="button" onClick={() => setStep('care')}>Continuar a preferencias</button>
        </section>
      </main>
    );
  }

  if (step === 'responsible') {
    return (
      <main className="shell">
        <form className="card" onSubmit={saveResponsible}>
          <p className="eyebrow">{progress}</p>
          <h1>¿Quién administrará AMARA?</h1>
          <p className="lead">Esta persona podrá gestionar integrantes, pedidos y datos del Hogar.</p>
          <label htmlFor="responsible-first-name">Nombre</label>
          <input id="responsible-first-name" value={responsibleFirstName} onChange={(event) => setResponsibleFirstName(event.target.value)} />
          <label htmlFor="responsible-last-name">Apellido, opcional</label>
          <input id="responsible-last-name" value={responsibleLastName} onChange={(event) => setResponsibleLastName(event.target.value)} />
          <label htmlFor="responsible-age">Rango de edad</label>
          <AgeRangeSelect id="responsible-age" value={responsibleAgeRange} onChange={setResponsibleAgeRange} />
          <label className="check"><input type="checkbox" checked={canAuthorizeDependents} onChange={(event) => setCanAuthorizeDependents(event.target.checked)} />Puede autorizar información de integrantes dependientes.</label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" disabled={loading || responsibleFirstName.trim().length < 2} type="submit">{loading ? 'Guardando…' : 'Guardar responsable'}</button>
        </form>
      </main>
    );
  }

  if (step === 'household') {
    return (
      <main className="shell">
        <form className="card" onSubmit={saveHousehold}>
          <p className="eyebrow">{progress}</p>
          <h1>Cuéntanos sobre tu hogar</h1>
          <label htmlFor="household-name">Nombre de referencia</label>
          <input id="household-name" placeholder="Hogar Canaan" value={householdName} onChange={(event) => setHouseholdName(event.target.value)} />
          <label htmlFor="household-type">Tipo de Hogar</label>
          <select id="household-type" value={householdTypeCode} onChange={(event) => setHouseholdTypeCode(event.target.value)}>
            <option value="SINGLE_PERSON">Vivo solo</option><option value="COUPLE">Pareja</option><option value="FAMILY_WITH_CHILDREN">Familia con hijos</option><option value="FAMILY_WITHOUT_CHILDREN">Familia sin hijos</option><option value="MULTIGENERATIONAL">Hogar multigeneracional</option><option value="OTHER">Otro</option>
          </select>
          <label htmlFor="estimated-members">¿Cuántas personas integran el Hogar?</label>
          <input id="estimated-members" type="number" min={1} max={20} value={estimatedMembers} onChange={(event) => setEstimatedMembers(Number(event.target.value))} />
          <label htmlFor="origin-channel">¿Cómo conociste AMARA?</label>
          <select id="origin-channel" value={originChannelCode} onChange={(event) => setOriginChannelCode(event.target.value)}>
            <option value="">Seleccionar</option><option value="REFERRAL">Recomendación</option><option value="SOCIAL_MEDIA">Redes sociales</option><option value="WHATSAPP">WhatsApp</option><option value="OTHER">Otro</option>
          </select>
          <label htmlFor="referral-code">Código de invitación, opcional</label>
          <input id="referral-code" value={referralCode} onChange={(event) => setReferralCode(event.target.value)} />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" disabled={loading || householdName.trim().length < 2 || estimatedMembers < 1} type="submit">{loading ? 'Guardando…' : 'Continuar'}</button>
        </form>
      </main>
    );
  }

  if (step === 'otp') {
    return (
      <main className="shell"><form className="card" onSubmit={verifyOtp}>
        <p className="eyebrow">{progress}</p><h1>Escribe el código</h1><p className="lead">Enviamos un SMS al número terminado en {maskedPhone.slice(-4)}.</p>
        <label htmlFor="otp">Código de seis dígitos</label>
        <input id="otp" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="otp-input" />
        {developmentCode && <p className="dev-code">Código de desarrollo: <strong>{developmentCode}</strong></p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={loading || code.length !== 6} type="submit">{loading ? 'Verificando…' : 'Verificar'}</button>
        <button className="link-button" type="button" onClick={() => { setStep('phone'); setCode(''); setError(''); }}>Cambiar número</button>
      </form></main>
    );
  }

  return (
    <main className="shell"><form className="card" onSubmit={startRegistration}>
      <p className="eyebrow">{progress}</p><h1>Verifica tu número</h1><p className="lead">Usaremos tu teléfono para proteger tu cuenta y comunicarnos contigo.</p>
      <label htmlFor="country">País</label><select id="country" defaultValue="MX" disabled><option value="MX">México +52</option></select>
      <label htmlFor="phone">Número móvil</label><input id="phone" autoComplete="tel-national" inputMode="numeric" placeholder="833 123 4567" value={phone} onChange={(event) => setPhone(event.target.value)} />
      <label className="check"><input type="checkbox" checked={privacyConsent} onChange={(event) => setPrivacyConsent(event.target.checked)} />Acepto el aviso de privacidad.</label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={loading || digits.length !== 10 || !privacyConsent} type="submit">{loading ? 'Enviando…' : 'Enviar código'}</button>
    </form></main>
  );
}

function AgeRangeSelect({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Seleccionar</option><option value="0_12">0 a 12 años</option><option value="13_17">13 a 17 años</option><option value="18_29">18 a 29 años</option><option value="30_44">30 a 44 años</option><option value="45_59">45 a 59 años</option><option value="60_74">60 a 74 años</option><option value="75_PLUS">75 años o más</option></select>;
}

async function request<T = object>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const body = (await response.json()) as ApiError & { data?: T };
  if (!response.ok || !body.data) throw new Error(extractError(body));
  return body.data;
}

function extractError(body: ApiError): string {
  const raw = body.error?.code ?? body.error?.message ?? body.message ?? 'UNKNOWN_ERROR';
  if (Array.isArray(raw)) return raw.join(' ');
  const code = String(raw);
  return messages[code] ?? 'No pudimos completar la operación. Inténtalo nuevamente.';
}
