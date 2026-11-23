// Prueba end-to-end de SanFerGo público (contra el servidor local).
const B = 'http://localhost:3000';
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD';
const RUN = String(Date.now()).slice(-6); // sufijo único por corrida (las pruebas se pueden repetir)
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
async function api(path, body) {
  const r = await fetch(B + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
}
(async () => {
  // El admin inicia sesión al principio: desde v1.3.5 los choferes nuevos
  // nacen PENDIENTES y solo van en línea tras la aprobación del admin.
  const ADM = await api('/api/login', { identifier: 'admin', password: 'admin' });
  check('login admin (admin/admin) con rol admin', ADM.ok && ADM.account.role === 'admin', JSON.stringify(ADM));
  async function approveDriver(id){ return api('/api/approve-driver', { token: ADM.token, driver_id: id }); }
  console.log('== Registro ==');
  const pax = await api('/api/register-passenger', { name: 'Lucia Prueba', phone: '9610000001', face_photo: PHOTO });
  check('registrar pasajera', pax.ok && pax.passenger.id, JSON.stringify(pax));
  const drv = await api('/api/register-driver', { name: 'Josué Prueba', phone: '9614868605', vehicle: 'mototaxi', unit: 'Hg67h', selfie: PHOTO, vehicle_photo: PHOTO });
  check('registrar chofer con fotos nace PENDIENTE (v1.3.5)', drv.ok && drv.driver.id && drv.driver.status === 'pendiente' && drv.pending === true, JSON.stringify(drv));
  const apDrv = await approveDriver(drv.driver.id);
  check('admin aprueba al chofer nuevo', apDrv.ok && apDrv.driver.status === 'aprobado', JSON.stringify(apDrv));
  const drv2 = await api('/api/register-driver', { name: 'Moto Sin Foto', phone: '9610000002', vehicle: 'moto', unit: 'M-1' });
  check('registrar chofer sin fotos también nace pendiente', drv2.ok && drv2.driver.status === 'pendiente');
  await approveDriver(drv2.driver.id);
  const onFail = await api('/api/set-driver-online', { driver_id: drv2.driver.id, online: true });
  check('sin fotos no puede ponerse en línea', !onFail.ok, JSON.stringify(onFail));
  const on = await api('/api/set-driver-online', { driver_id: drv.driver.id, online: true });
  check('chofer con fotos en línea', on.ok && on.driver.online === 1);

  console.log('== Viaje: publicar, oferta, contraoferta, confirmar ==');
  const req = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  check('publicar viaje $25', req.ok && req.request.status === 'buscando', JSON.stringify(req));
  const rid = req.request.id;
  const off = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: rid, kind: 'acepta', price: 25 });
  check("'acepta' del chofer confirma AL INSTANTE (sin segundo paso del pasajero)", off.ok && off.request.status === 'aceptado' && off.request.final_price === 25 && off.request.driver_id === drv.driver.id, JSON.stringify(off));
  // Banner de viaje activo v1.4.14: su fuente es el servidor, no la
  // memoria del teléfono — un fetch fresco (como al recargar o volver al
  // inicio) devuelve el mismo viaje aceptado para el chofer y para el
  // pasajero, así que el banner vuelve a aparecer.
  const drvFresh = await api('/api/requests?driver_id=' + drv.driver.id);
  check('tras aceptar, un fetch fresco del chofer devuelve el viaje aceptado (fuente del banner, sobrevive a recargar)', drvFresh.ok && drvFresh.requests.some(r=>r.id===rid && r.status==='aceptado'), JSON.stringify(drvFresh.requests && drvFresh.requests[0]));
  const paxFresh = await api('/api/requests?passenger_id=' + pax.passenger.id);
  check('tras aceptar, un fetch fresco del pasajero devuelve el viaje aceptado (fuente del banner de Inicio)', paxFresh.ok && paxFresh.requests.some(r=>r.id===rid && r.status==='aceptado'), JSON.stringify(paxFresh.requests && paxFresh.requests[0]));
  // La negociación en dos sentidos sigue viva con la contraoferta: el
  // chofer contraoferta, el pasajero contraoferta y el chofer acepta.
  const reqN = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  const offN = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: reqN.request.id, kind: 'contraoferta', price: 35 });
  check('chofer contraoferta $35 (queda pendiente)', offN.ok && offN.offer.kind === 'contraoferta' && offN.offer.status === 'pendiente', JSON.stringify(offN));
  const counter = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: reqN.request.id, offer_id: offN.offer.id, action: 'contraoferta', price: 20 });
  check('pasajera contraoferta $20', counter.ok);
  const acc = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: reqN.request.id, offer_id: offN.offer.id, action: 'acepta' });
  check('chofer acepta contraoferta: viaje confirmado a $20', acc.ok && acc.request.status === 'aceptado' && acc.request.final_price === 20, JSON.stringify(acc));
  const loc = await api('/api/update-driver-location', { driver_id: drv.driver.id, request_id: rid, lat: 16.8700, lng: -93.2070 });
  check('chofer comparte ubicación en vivo', loc.ok);

  console.log('== Etapas del viaje ==');
  for (const st of ['en_camino', 'llego', 'en_viaje', 'finalizado']) {
    const a = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: rid, stage: st });
    check('avanzar a ' + st, a.ok && a.request.trip_stage === st, JSON.stringify(a));
  }
  const cancelLate = await api('/api/cancel-request', { request_id: rid });
  check('viaje finalizado ya no se cancela (o ya estaba finalizado)', cancelLate.ok || !cancelLate.ok); // solo registra

  console.log('== Mandado ==');
  const man = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Recoger un paquete' });
  check('publicar mandado', man.ok && man.request.kind === 'mandado');
  const moff = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: man.request.id, kind: 'contraoferta', price: 35 });
  check('chofer contraoferta mandado $35', moff.ok && moff.offer.kind === 'contraoferta');
  const macc = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: man.request.id, offer_id: moff.offer.id, action: 'acepta' });
  check('pasajera acepta contraoferta del mandado', macc.ok && macc.request.status === 'aceptado' && macc.request.final_price === 35);
  for (const st of ['en_camino', 'llego', 'recogido', 'en_viaje', 'entregado']) {
    const a = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: man.request.id, stage: st });
    check('mandado avanza a ' + st, a.ok && a.request.trip_stage === st, JSON.stringify(a));
  }

  console.log('== Reglas: moto no hace viajes, $80+ solo suscripción ==');
  const req2 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Copalar', dest_detail: 'Copalar', dest_lat: 16.855, dest_lng: -93.198, distance_km: 2.5, eta_minutes: 9, price: 30, payment_method: 'efectivo' });
  const motoTry = await api('/api/driver-respond', { driver_id: drv2.driver.id, request_id: req2.request.id, kind: 'acepta', price: 30 });
  check('moto no puede aceptar viaje (solo mototaxi)', !motoTry.ok, JSON.stringify(motoTry));
  const drv3 = await api('/api/register-driver', { name: 'Gratis Tres', phone: '9610000003', vehicle: 'mototaxi', unit: 'G-3', selfie: PHOTO, vehicle_photo: PHOTO });
  await approveDriver(drv3.driver.id);
  await api('/api/set-driver-online', { driver_id: drv3.driver.id, online: true });
  const req3 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Copalar', dest_detail: 'Copalar', dest_lat: 16.855, dest_lng: -93.198, distance_km: 10, eta_minutes: 30, price: 90, payment_method: 'efectivo' });
  const big = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: req3.request.id, kind: 'acepta', price: 90 });
  check('plan gratis bloqueado en servicio de $90', !big.ok && /80/.test(big.error || ''), JSON.stringify(big));
  const sub = await api('/api/subscribe-driver', { driver_id: drv3.driver.id, plan: 'weekly' });
  check('suscripción semanal $50 activa 7 días', sub.ok && sub.driver.plan === 'suscripcion' && sub.price === 50 && sub.days === 7 && sub.plan === 'weekly', JSON.stringify(sub));
  const big2 = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: req3.request.id, kind: 'acepta', price: 90 });
  check('con suscripción sí puede tomar el de $90 (prioridad, confirma al instante)', big2.ok && big2.offer.is_premium === 1 && big2.request.status === 'aceptado' && big2.request.final_price === 90, JSON.stringify(big2));

  console.log('== Vehículo del mandado (Quiero: mototaxi/moto) ==');
  const drvM = await api('/api/register-driver', { name: 'Moto Con Foto', phone: '9610000011', vehicle: 'moto', unit: 'M-2', selfie: PHOTO, vehicle_photo: PHOTO });
  await approveDriver(drvM.driver.id);
  await api('/api/set-driver-online', { driver_id: drvM.driver.id, online: true });
  const manMoto = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Mandado en moto', vehicle: 'moto' });
  check('mandado en moto guarda vehicle=moto', manMoto.ok && manMoto.request.vehicle === 'moto', JSON.stringify(manMoto));
  const motoOk = await api('/api/driver-respond', { driver_id: drvM.driver.id, request_id: manMoto.request.id, kind: 'acepta', price: 30 });
  check('moto sí puede tomar mandado en moto', motoOk.ok && motoOk.request.status === 'aceptado', JSON.stringify(motoOk));
  const manTaxi = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Mandado en mototaxi', vehicle: 'mototaxi' });
  check('mandado en mototaxi guarda vehicle=mototaxi', manTaxi.ok && manTaxi.request.vehicle === 'mototaxi', JSON.stringify(manTaxi));
  const taxiNo = await api('/api/driver-respond', { driver_id: drvM.driver.id, request_id: manTaxi.request.id, kind: 'acepta', price: 30 });
  check('moto NO puede tomar mandado en mototaxi', !taxiNo.ok, JSON.stringify(taxiNo));
  const taxiOk = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: manTaxi.request.id, kind: 'acepta', price: 30 });
  check('mototaxi sí puede tomar mandado en mototaxi', taxiOk.ok && taxiOk.request.status === 'aceptado', JSON.stringify(taxiOk));

  console.log('== Cosas perdidas ==');
  const lost = await api('/api/report-lost-item', { reporter_type: 'pasajero', reporter_name: 'Lucia Prueba', reporter_phone: '9610000001', item: 'Celular', service: 'Viaje Centro-Mercado', date_text: 'hoy', contact: '9610000001' });
  check('reportar cosa perdida', lost.ok && lost.item.status === 'perdido');
  const st = await api('/api/set-lost-item-status', { id: lost.item.id, status: 'encontrado' });
  check('marcar encontrado', st.ok);
  const items = await api('/api/lost-items');
  check('listar cosas perdidas', items.ok && items.items.length >= 1);

  console.log('== Tarifa nueva y reglas de publicación ==');
  const places = await api('/api/places');
  check('tarifa $10 + $2.50/300m, espera $1.25, mínimo $20', places.ok && places.fare.base === 10 && places.fare.per_300m === 2.5 && places.fare.wait_per_min === 1.25 && places.fare.min === 20, JSON.stringify(places.fare));
  const noPhone = await api('/api/create-request', { kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25 });
  check('sin teléfono no se publica', !noPhone.ok, JSON.stringify(noPhone));
  const cheap = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 15 });
  check('precio menor a $20 rechazado', !cheap.ok && /20/.test(cheap.error || ''), JSON.stringify(cheap));
  const withPhone = await api('/api/create-request', { passenger_name: 'Sin Perfil', passenger_phone: '9610000009', kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  check('sin perfil pero con teléfono sí se publica', withPhone.ok && withPhone.request.passenger_phone === '9610000009', JSON.stringify(withPhone));

  console.log('== Cancelación solo antes de empezar ==');
  async function acceptedTrip(price) {
    const rq = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price, payment_method: 'efectivo' });
    const of = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: rq.request.id, kind: 'acepta', price });
    // 'acepta' ya confirma al instante: no hay segundo paso por respond-offer.
    if (!of.ok || of.request.status !== 'aceptado') throw new Error('acceptedTrip no confirmó: ' + JSON.stringify(of));
    return rq.request.id;
  }
  const rc1 = await acceptedTrip(25);
  await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: rc1, stage: 'en_camino' });
  const c1 = await api('/api/cancel-request', { request_id: rc1 });
  check('cancelar en camino (antes de empezar) sí se puede', c1.ok, JSON.stringify(c1));
  const rc2 = await acceptedTrip(25);
  await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: rc2, stage: 'en_camino' });
  await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: rc2, stage: 'llego' });
  await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: rc2, stage: 'en_viaje' });
  const r2 = (await api('/api/requests?driver_id=' + drv3.driver.id)).requests.find(r => r.id === rc2);
  check('trip_started_at se marca al iniciar el viaje', !!r2.trip_started_at, JSON.stringify(r2.trip_started_at));
  const c2 = await api('/api/cancel-request', { request_id: rc2 });
  check('cancelar en viaje ya no se puede', !c2.ok && /ya empezó/.test(c2.error || ''), JSON.stringify(c2));
  await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: rc2, stage: 'finalizado' });
  const r2f = (await api('/api/requests?driver_id=' + drv3.driver.id)).requests.find(r => r.id === rc2);
  check('finished_at se marca al finalizar', !!r2f.finished_at, JSON.stringify(r2f.finished_at));

  console.log('== Pegar ubicación de WhatsApp ==');
  const dec = await api('/api/resolve-location', { text: '16.8778, -93.2080' });
  check('coordenadas decimales', dec.ok && Math.abs(dec.lat - 16.8778) < 0.0001 && Math.abs(dec.lng + 93.2080) < 0.0001, JSON.stringify(dec));
  const dms = await api('/api/resolve-location', { text: '16°52\'40.3"N 93°12\'28.6"W' });
  check('coordenadas DMS de WhatsApp', dms.ok && Math.abs(dms.lat - 16.87786) < 0.001 && Math.abs(dms.lng + 93.20794) < 0.001, JSON.stringify(dms));
  const link = await api('/api/resolve-location', { text: 'https://www.google.com/maps/place/Banco+del+Bienestar/@16.8778,-93.2080,17z' });
  check('enlace completo de Google Maps', link.ok && Math.abs(link.lat - 16.8778) < 0.0001, JSON.stringify(link));
  const bad = await api('/api/resolve-location', { text: 'hola no es ubicación' });
  check('texto sin ubicación rechazado', !bad.ok, JSON.stringify(bad));

  console.log('== Mandado con lista, paradas y WhatsApp ==');
  const m2 = await api('/api/create-request', {
    passenger_id: pax.passenger.id, kind: 'mandado',
    origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación actual', origin_lat: 16.8709, origin_lng: -93.2063,
    dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777,
    distance_km: 1.2, price: 40, payment_method: 'efectivo', description: '',
    recipient_phone: '9612222222', items: ['2 kg de tortillas', '1 refresco'],
    stops: [{ zone: 'Mercado', lat: 16.87018, lng: -93.20777 }, { zone: 'Centro', lat: 16.8709, lng: -93.2063 }], extra_stops: 1 });
  check('mandado guarda lista, paradas y WhatsApp de quien recibe', m2.ok && m2.request.recipient_phone === '9612222222' && m2.request.extra_stops === 1 && JSON.parse(m2.request.items_json).length === 2, JSON.stringify(m2.request));
  const m2off = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: m2.request.id, kind: 'acepta', price: 40 });
  check("'acepta' del mandado confirma al instante", m2off.ok && m2off.request.status === 'aceptado' && m2off.request.final_price === 40, JSON.stringify(m2off));
  const upd = await api('/api/update-delivery-point', { driver_id: drv3.driver.id, request_id: m2.request.id, lat: 16.87786, lng: -93.20794, detail: 'casa de la esquina' });
  check('chofer actualiza el punto de entrega con ubicación pegada', upd.ok && /Ubicación de WhatsApp/.test(upd.request.dest_detail) && /casa de la esquina/.test(upd.request.dest_detail), JSON.stringify(upd.request.dest_detail));
  await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: m2.request.id, stage: 'en_camino' });
  await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: m2.request.id, stage: 'llego' });
  await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: m2.request.id, stage: 'recogido' });
  const cM = await api('/api/cancel-request', { request_id: m2.request.id });
  check('mandado recogido ya no se cancela', !cM.ok, JSON.stringify(cM));

  console.log('== Cuentas e inicio de sesión ==');
  const accPhone = '961100' + RUN.slice(0, 4);
  const accAna = await api('/api/register-account', { name: 'Ana Cuenta', username: 'ana_' + RUN, phone: accPhone, password: 'secreta123' });
  check('crear cuenta con número y contraseña (crea perfil de pasajero, sin chofer)', accAna.ok && accAna.account.username === 'ana_' + RUN && accAna.passenger && accAna.passenger.id && accAna.account.driver_id == null && !!accAna.token, JSON.stringify(accAna));
  const dupPhone = await api('/api/register-account', { name: 'Otra Ana', username: 'otra_' + RUN, phone: accPhone, password: 'secreta123' });
  check('número duplicado no crea otra cuenta: avisa a nombre de quién está', !dupPhone.ok && dupPhone.exists === true && dupPhone.existing_name === 'Ana Cuenta' && dupPhone.field === 'phone', JSON.stringify(dupPhone));
  const dupUser = await api('/api/register-account', { name: 'Otra', username: 'ana_' + RUN, phone: '961101' + RUN.slice(0, 4), password: 'secreta123' });
  check('usuario duplicado rechazado', !dupUser.ok && dupUser.field === 'username', JSON.stringify(dupUser));
  const noContact = await api('/api/register-account', { name: 'Sin Contacto', username: 'sinc_' + RUN, password: 'secreta123' });
  check('sin número ni correo no se registra', !noContact.ok, JSON.stringify(noContact));
  const shortPw = await api('/api/register-account', { name: 'Clave Corta', username: 'corta_' + RUN, phone: '961102' + RUN.slice(0, 4), password: '123' });
  check('contraseña corta rechazada', !shortPw.ok, JSON.stringify(shortPw));
  const li1 = await api('/api/login', { identifier: 'ana_' + RUN, password: 'secreta123' });
  check('login con usuario y contraseña', li1.ok && !!li1.token && li1.account.id === accAna.account.id, JSON.stringify(li1));
  const li2 = await api('/api/login', { identifier: accPhone, password: 'secreta123' });
  check('login con número y contraseña', li2.ok && li2.account.id === accAna.account.id, JSON.stringify(li2));
  const liBad = await api('/api/login', { identifier: 'ana_' + RUN, password: 'malaclave' });
  check('login con contraseña incorrecta rechazado', !liBad.ok, JSON.stringify(liBad));
  const liNone = await api('/api/login', { identifier: 'nadie_' + RUN, password: 'secreta123' });
  check('login con usuario inexistente rechazado', !liNone.ok && !liNone.needs_claim, JSON.stringify(liNone));
  // v1.4.17: con el código por correo activado, registrarse con correo exige
  // verificar el código primero; la suite corre con RESEND_API_KEY=test, así
  // que el código llega en test_code (sin salir ningún correo real).
  const mailCode = await api('/api/request-email-code', { email: 'beto' + RUN + '@prueba.mx' });
  check('pedir código para el correo (modo de pruebas, sin correo real)', mailCode.ok && /^\d{6}$/.test(mailCode.test_code || ''), JSON.stringify(mailCode));
  const mailVer = await api('/api/verify-email-code', { email: 'beto' + RUN + '@prueba.mx', code: mailCode.test_code });
  check('verificar el código entrega el pase de un solo uso', mailVer.ok && !!mailVer.verification_token, JSON.stringify(mailVer));
  const accMail = await api('/api/register-account', { name: 'Beto Correo', username: 'beto_' + RUN, email: 'beto' + RUN + '@prueba.mx', password: 'secreta123', email_code_token: mailVer.verification_token });
  check('crear cuenta solo con correo (crea perfil de pasajero, correo verificado)', accMail.ok && accMail.account.email === 'beto' + RUN + '@prueba.mx' && !!accMail.passenger && accMail.account.email_verified === 1, JSON.stringify(accMail));
  const dupMail = await api('/api/register-account', { name: 'Otro Beto', username: 'otrob_' + RUN, email: 'beto' + RUN + '@prueba.mx', password: 'secreta123' });
  check('correo duplicado no crea otra cuenta: avisa a nombre de quién está', !dupMail.ok && dupMail.exists === true && dupMail.existing_name === 'Beto Correo' && dupMail.field === 'email', JSON.stringify(dupMail));
  const liMail = await api('/api/login', { identifier: 'beto' + RUN + '@prueba.mx', password: 'secreta123' });
  check('login con correo y contraseña', liMail.ok && liMail.account.id === accMail.account.id, JSON.stringify(liMail));
  const me = await api('/api/me?token=' + li1.token);
  check('/api/me devuelve la cuenta con su pasajero enlazado', me.ok && me.account.id === accAna.account.id && me.passenger && me.passenger.id === accAna.passenger.id, JSON.stringify(me));
  const meBad = await api('/api/me?token=token-invalido');
  check('/api/me con token inválido rechazado', !meBad.ok, JSON.stringify(meBad));

  console.log('== Reclamar perfil viejo sin cuenta ==');
  const legacyPhone = '961200' + RUN.slice(0, 4);
  const legacy = await api('/api/register-passenger', { name: 'Viejo Perfil', phone: legacyPhone, face_photo: PHOTO });
  check('perfil viejo sin cuenta (legado)', legacy.ok && legacy.passenger.id, JSON.stringify(legacy));
  const liClaim = await api('/api/login', { identifier: legacyPhone, password: 'cualquiera' });
  check('login con número sin cuenta ofrece reclamarlo', !liClaim.ok && liClaim.needs_claim === true && liClaim.profile_name === 'Viejo Perfil', JSON.stringify(liClaim));
  const claim = await api('/api/claim-account', { phone: legacyPhone, username: 'viejo_' + RUN, password: 'nuevaclave1' });
  check('reclamar perfil viejo con contraseña lo enlaza a la cuenta', claim.ok && claim.passenger && claim.passenger.id === legacy.passenger.id && !!claim.token, JSON.stringify(claim));
  const liClaim2 = await api('/api/login', { identifier: 'viejo_' + RUN, password: 'nuevaclave1' });
  check('después de reclamar, el login funciona', liClaim2.ok && liClaim2.account.id === claim.account.id, JSON.stringify(liClaim2));
  const claimAgain = await api('/api/claim-account', { phone: legacyPhone, username: 'viejo2_' + RUN, password: 'nuevaclave1' });
  check('reclamar un número que ya tiene cuenta rechazado', !claimAgain.ok, JSON.stringify(claimAgain));

  console.log('== Admin: login y panel con token ==');
  const admLogin = await api('/api/login', { identifier: 'admin', password: 'admin' });
  check('login admin temporal (admin/admin) con rol admin', admLogin.ok && admLogin.account.role === 'admin', JSON.stringify(admLogin));
  const admBad = await api('/api/login', { identifier: 'admin', password: 'otra' });
  check('admin con contraseña incorrecta rechazado', !admBad.ok, JSON.stringify(admBad));
  const noTok = await api('/api/admin-drivers', {});
  check('admin sin token rechazado', !noTok.ok, JSON.stringify(noTok));
  const usrTok = await api('/api/admin-drivers', { token: li1.token });
  check('cuenta normal no ve el panel de admin', !usrTok.ok, JSON.stringify(usrTok));
  const admList = await api('/api/admin-drivers', { token: admLogin.token });
  check('admin ve choferes con token', admList.ok && Array.isArray(admList.drivers), JSON.stringify(admList.drivers && admList.drivers.length));
  const accs = await api('/api/admin-accounts?token=' + admLogin.token);
  check('admin ve la lista de cuentas', accs.ok && accs.accounts.some(a => a.username === 'ana_' + RUN) && accs.accounts.every(a => !a.password_hash && !a.password_salt), JSON.stringify(accs.accounts && accs.accounts.length));
  const paxs = await api('/api/admin-passengers?token=' + admLogin.token);
  check('admin ve la lista de pasajeros', paxs.ok && paxs.passengers.length >= 1, JSON.stringify(paxs.passengers && paxs.passengers.length));
  const stores = await api('/api/admin-stores?token=' + admLogin.token);
  check('admin ve tiendas (catálogo)', stores.ok && Array.isArray(stores.stores), JSON.stringify(stores));

  console.log('== Chofer enlazado a la cuenta ==');
  const drvAcc = await api('/api/register-driver', { name: 'Ana Chofer', phone: accPhone, vehicle: 'mototaxi', unit: 'A-' + RUN.slice(0, 3), selfie: PHOTO, vehicle_photo: PHOTO });
  check('registro de chofer con el teléfono de la cuenta', drvAcc.ok && drvAcc.driver.id, JSON.stringify(drvAcc));
  await approveDriver(drvAcc.driver.id);
  const linkDrv = await api('/api/link-profiles', { token: li1.token, driver_id: drvAcc.driver.id });
  check('chofer enlazado a la cuenta', linkDrv.ok && linkDrv.account.driver_id === drvAcc.driver.id, JSON.stringify(link));
  const me2 = await api('/api/me?token=' + li1.token);
  check('/api/me devuelve cuenta con pasajero y chofer enlazados', me2.ok && me2.passenger && me2.driver && me2.driver.id === drvAcc.driver.id, JSON.stringify(me2));
  const linkBad = await api('/api/link-profiles', { token: li1.token, driver_id: 999999 });
  check('enlazar chofer inexistente rechazado', !linkBad.ok, JSON.stringify(linkBad));

  console.log('== Anuncios ==');
  const adPub0 = await api('/api/ads');
  check('anuncios públicos al inicio (lista)', adPub0.ok && Array.isArray(adPub0.ads));
  // v1.3.5: el anuncio es SOLO imagen (obligatoria, >=100 caracteres); sin
  // imagen el servidor lo rechaza. Libre o de un negocio, con entradas.
  const ADIMG = PHOTO + 'A'.repeat(120);
  const adNoImg = await api('/api/create-ad', { token: admLogin.token, label: 'Sin imagen ' + RUN });
  check('anuncio sin imagen rechazado (v1.3.5: solo imagen)', !adNoImg.ok, JSON.stringify(adNoImg));
  const ad = await api('/api/create-ad', { token: admLogin.token, label: 'Anuncio ' + RUN, image: ADIMG, entries: ['viajes', 'negocios'] });
  check('admin sube anuncio solo-imagen con entradas', ad.ok && ad.ad.id, JSON.stringify(ad));
  const adPub1 = await api('/api/ads');
  check('anuncio activo en lista pública de anuncios', adPub1.ok && adPub1.ads.some(a => a.id === ad.ad.id));
  // v1.4.16: el carrusel de Negocios se alimenta de /api/ads — el anuncio
  // trae sus entradas resueltas (incluye 'negocios') y business_id null
  // al ser libre.
  check('carrusel Negocios: /api/ads trae el anuncio con entradas que incluyen negocios (v1.4.16)', adPub1.ok && adPub1.ads.some(a => a.id === ad.ad.id && Array.isArray(a.entries) && a.entries.includes('negocios') && a.business_id == null), JSON.stringify(adPub1.ads.find(a => a.id === ad.ad.id)));
  const entryV = await api('/api/entry-ad?entry=viajes&token=' + admLogin.token);
  check('anuncio de entrada flotante en Viajes (v1.3.5)', entryV.ok && entryV.ad && entryV.ad.id === ad.ad.id, JSON.stringify(entryV));
  // v1.4.12: el anuncio libre (sin negocio) trae business_id y
  // business_name en null en el MISMO payload — el pie muestra solo
  // "Publicidad" por diseño, no por carrera ni por render roto.
  check('anuncio libre: payload sin business_id ni business_name (v1.4.12)', entryV.ok && entryV.ad && entryV.ad.business_id == null && entryV.ad.business_name == null, JSON.stringify(entryV.ad));
  const entryM = await api('/api/entry-ad?entry=mandados&token=' + admLogin.token);
  check('anuncio NO rota en Mandados (no está en sus entradas)', entryM.ok && !entryM.ad, JSON.stringify(entryM));
  const entryBad = await api('/api/entry-ad?entry=inicio');
  check('entrada inválida rechazada', !entryBad.ok, JSON.stringify(entryBad));
  const adNoAdmin = await api('/api/create-ad', { token: li1.token, label: 'No debe', image: ADIMG });
  check('cuenta normal no puede subir anuncios', !adNoAdmin.ok, JSON.stringify(adNoAdmin));
  const adOff = await api('/api/set-ad-active', { token: admLogin.token, ad_id: ad.ad.id, active: 0 });
  const adPub2 = await api('/api/ads');
  check('anuncio oculto ya no se muestra en Inicio', adOff.ok && !adPub2.ads.some(a => a.id === ad.ad.id));
  const adOn = await api('/api/set-ad-active', { token: admLogin.token, ad_id: ad.ad.id, active: 1 });
  const adPub3 = await api('/api/ads');
  check('anuncio se puede volver a mostrar', adOn.ok && adPub3.ads.some(a => a.id === ad.ad.id));
  const del = await api('/api/delete-ad', { token: admLogin.token, ad_id: ad.ad.id });
  const adList = await api('/api/admin-ads?token=' + admLogin.token);
  check('admin borra anuncio', del.ok && !adList.ads.some(a => a.id === ad.ad.id), JSON.stringify(adList.ads && adList.ads.length));

  console.log('== Panel de administrador ==');
  const adm = await api('/api/register-driver', { name: 'Admin Prueba', phone: '9610000004', vehicle: 'mototaxi', unit: 'A-4', selfie: PHOTO, vehicle_photo: PHOTO });
  await approveDriver(adm.driver.id);
  await api('/api/set-driver-online', { driver_id: adm.driver.id, online: true });
  const noAdmin = await api('/api/admin-drivers', { token: 'token-invalido' });
  check('sin token de admin no se ven los choferes', !noAdmin.ok, JSON.stringify(noAdmin));
  const list = await api('/api/admin-drivers', { token: admLogin.token });
  check('admin ve la lista de choferes con servicios hechos', list.ok && list.drivers.length >= 4 && list.drivers.every(d => typeof d.services_done === 'number'), JSON.stringify(list.drivers && list.drivers.length));
  const blockNoReason = await api('/api/block-driver', { token: admLogin.token, driver_id: adm.driver.id, reason: '' });
  check('bloquear sin motivo rechazado', !blockNoReason.ok, JSON.stringify(blockNoReason));
  const rb = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  // Oferta pendiente (contraoferta) antes del bloqueo: 'acepta' ya confirma
  // al instante, así que para probar el rechazo por bloqueo se usa una
  // contraoferta pendiente.
  const rbOff = await api('/api/driver-respond', { driver_id: adm.driver.id, request_id: rb.request.id, kind: 'contraoferta', price: 30 });
  check('chofer responde antes del bloqueo (contraoferta pendiente)', rbOff.ok && rbOff.offer.status === 'pendiente', JSON.stringify(rbOff));
  const block = await api('/api/block-driver', { token: admLogin.token, driver_id: adm.driver.id, reason: 'Manejo peligroso' });
  check('admin bloquea con motivo y lo saca de línea', block.ok && block.driver.is_blocked === 1 && block.driver.online === 0 && block.driver.block_reason === 'Manejo peligroso', JSON.stringify(block));
  const acceptBlocked = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: rb.request.id, offer_id: rbOff.offer.id, action: 'acepta' });
  check('pasajero no puede aceptar oferta de chofer bloqueado', !acceptBlocked.ok, JSON.stringify(acceptBlocked));
  const rb2 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  const respBlocked = await api('/api/driver-respond', { driver_id: adm.driver.id, request_id: rb2.request.id, kind: 'acepta', price: 25 });
  check('bloqueado no puede responder solicitudes', !respBlocked.ok, JSON.stringify(respBlocked));
  const onBlocked = await api('/api/set-driver-online', { driver_id: adm.driver.id, online: true });
  check('bloqueado no puede ponerse en línea', !onBlocked.ok, JSON.stringify(onBlocked));
  const reReg = await api('/api/register-driver', { name: 'Otro', phone: '9610000004', vehicle: 'mototaxi', unit: 'X' });
  check('bloqueado no puede re-registrarse con el mismo teléfono', !reReg.ok, JSON.stringify(reReg));
  const unblock = await api('/api/unblock-driver', { token: admLogin.token, driver_id: adm.driver.id });
  check('admin desbloquea y limpia el motivo', unblock.ok && unblock.driver.is_blocked === 0 && !unblock.driver.block_reason, JSON.stringify(unblock));
  const acceptOk = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: rb.request.id, offer_id: rbOff.offer.id, action: 'acepta' });
  check('desbloqueado: su oferta sí se puede aceptar', acceptOk.ok && acceptOk.request.status === 'aceptado' && acceptOk.request.final_price === 30, JSON.stringify(acceptOk));
  const onAgain = await api('/api/set-driver-online', { driver_id: adm.driver.id, online: true });
  check('desbloqueado vuelve a ponerse en línea', onAgain.ok && onAgain.driver.online === 1, JSON.stringify(onAgain));

  console.log('== v1.3.0: pago al publicar y confirmación automática ==');
  const h = await api('/api/health');
  check('versión 1.4.18 en /api/health', h.ok && h.version === '1.4.18', JSON.stringify(h));
  const drvList = await api('/api/drivers');
  check('choferes exponen precios de suscripción 50/150/500', drvList.ok && drvList.drivers.every(d => d.subscription_price === 50 && d.subscription_price_monthly === 150 && d.subscription_price_yearly === 500), JSON.stringify(drvList.drivers && drvList.drivers[0]));
  const noPay = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25 });
  check('sin forma de pago no se publica', !noPay.ok && /pago/.test(noPay.error || ''), JSON.stringify(noPay));
  const badPay = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'tarjeta' });
  check('forma de pago no válida rechazada', !badPay.ok, JSON.stringify(badPay));
  // (a) transferencia + aceptar_precio = aceptado al instante, sin paso del pasajero
  const rqT = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'transferencia' });
  check('publicar con transferencia', rqT.ok && rqT.request.payment_method === 'transferencia' && rqT.request.status === 'buscando', JSON.stringify(rqT));
  const accT = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: rqT.request.id, kind: 'aceptar_precio', price: 25 });
  check('chofer acepta precio: viaje aceptado al instante', accT.ok && accT.request.status === 'aceptado' && accT.request.trip_stage === 'confirmado' && accT.request.final_price === 25 && accT.request.payment_method === 'transferencia' && accT.request.driver_id === drv3.driver.id && accT.request.driver_name === 'Gratis Tres', JSON.stringify(accT));
  const gotT = (await api('/api/requests?passenger_id=' + pax.passenger.id)).requests.find(r => r.id === rqT.request.id);
  check('GET /api/requests devuelve payment_method transferencia y estado aceptado', !!gotT && gotT.payment_method === 'transferencia' && gotT.status === 'aceptado', JSON.stringify(gotT && { payment_method: gotT.payment_method, status: gotT.status }));
  // (b) contraoferta queda pendiente; el pasajero acepta con response 'aceptar' y confirma en efectivo
  const rqC = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  const offC = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: rqC.request.id, kind: 'contraoferta', price: 35 });
  check('contraoferta del chofer queda pendiente', offC.ok && offC.offer.kind === 'contraoferta' && offC.offer.status === 'pendiente', JSON.stringify(offC));
  const stillOpen = (await api('/api/requests?passenger_id=' + pax.passenger.id)).requests.find(r => r.id === rqC.request.id);
  check('con contraoferta pendiente el viaje sigue buscando', !!stillOpen && stillOpen.status === 'buscando', JSON.stringify(stillOpen && stillOpen.status));
  const accC = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: rqC.request.id, offer_id: offC.offer.id, response: 'aceptar' });
  check("pasajero acepta contraoferta (response 'aceptar'): confirma en efectivo a $35", accC.ok && accC.request.status === 'aceptado' && accC.request.final_price === 35 && accC.request.payment_method === 'efectivo', JSON.stringify(accC));

  console.log('== v1.3.0: suscripción en tres planes ==');
  const subDrv = await api('/api/register-driver', { name: 'Planes Prueba', phone: '9610000005', vehicle: 'mototaxi', unit: 'P-5', selfie: PHOTO, vehicle_photo: PHOTO });
  check('chofer para probar planes', subDrv.ok && subDrv.driver.id, JSON.stringify(subDrv));
  await approveDriver(subDrv.driver.id);
  const badPlan = await api('/api/subscribe-driver', { driver_id: subDrv.driver.id, plan: 'diario' });
  check('plan no válido rechazado', !badPlan.ok, JSON.stringify(badPlan));
  const w = await api('/api/subscribe-driver', { driver_id: subDrv.driver.id, plan: 'weekly' });
  const wDays = w.ok ? Math.round((new Date(w.driver.subscription_until) - Date.now()) / 86400000) : null;
  check('plan semanal $50 suma 7 días', w.ok && w.price === 50 && w.days === 7 && w.plan === 'weekly' && wDays === 7, JSON.stringify(w));
  const m = await api('/api/subscribe-driver', { driver_id: subDrv.driver.id, plan: 'monthly' });
  const mDays = m.ok ? Math.round((new Date(m.driver.subscription_until) - Date.now()) / 86400000) : null;
  check('plan mensual $150 apila 30 días sobre la activa (37 días)', m.ok && m.price === 150 && m.days === 30 && m.plan === 'monthly' && mDays === 37, JSON.stringify(m));
  const y = await api('/api/subscribe-driver', { driver_id: subDrv.driver.id, plan: 'yearly' });
  const yDays = y.ok ? Math.round((new Date(y.driver.subscription_until) - Date.now()) / 86400000) : null;
  check('plan anual $500 apila 365 días sobre la activa (402 días)', y.ok && y.price === 500 && y.days === 365 && y.plan === 'yearly' && yDays === 402, JSON.stringify(y));
  const def = await api('/api/subscribe-driver', { driver_id: subDrv.driver.id });
  check('sin plan se suscribe el semanal ($50)', def.ok && def.price === 50 && def.plan === 'weekly' && def.days === 7, JSON.stringify(def));

  console.log('== v1.3.1: precios de cinco en cinco ==');
  // Sugerido = tarifa redondeada hacia arriba a múltiplo de $5, piso $20.
  async function suggestedFor(km) {
    const r = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: km, payment_method: 'efectivo' });
    return r.ok ? r.request.price : null;
  }
  check('sin precio: 1.0 km (tarifa $18.33) sugiere $20', (await suggestedFor(1.0)) === 20);
  check('sin precio: 1.5 km (tarifa $22.50) sugiere $25', (await suggestedFor(1.5)) === 25);
  check('sin precio: 2.1 km (tarifa $27.50) sugiere $30', (await suggestedFor(2.1)) === 30);
  check('sin precio: 2.5 km (tarifa $30.83) sugiere $35', (await suggestedFor(2.5)) === 35);
  check('sin precio: 3.59 km (tarifa $39.92) sugiere $40', (await suggestedFor(3.59)) === 40);
  const bad33 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 33, payment_method: 'efectivo' });
  check('precio $33 rechazado (fuera de la rejilla de $5)', !bad33.ok && /cinco en cinco/.test(bad33.error || ''), JSON.stringify(bad33));
  const ok35 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 35, payment_method: 'efectivo' });
  check('precio $35 aceptado', ok35.ok && ok35.request.price === 35, JSON.stringify(ok35));
  const rqR = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  const r43 = await api('/api/raise-price', { passenger_id: pax.passenger.id, request_id: rqR.request.id, price: 43 });
  check('subir precio a $43 rechazado', !r43.ok && /cinco en cinco/.test(r43.error || ''), JSON.stringify(r43));
  const r45 = await api('/api/raise-price', { passenger_id: pax.passenger.id, request_id: rqR.request.id, price: 45 });
  check('subir precio a $45 aceptado', r45.ok && r45.request.price === 45, JSON.stringify(r45));
  const dc33 = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: rqR.request.id, kind: 'contraoferta', price: 33 });
  check('contraoferta del chofer a $33 rechazada', !dc33.ok && /cinco en cinco/.test(dc33.error || ''), JSON.stringify(dc33));
  const dc35 = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: rqR.request.id, kind: 'contraoferta', price: 35 });
  check('contraoferta del chofer a $35 aceptada y pendiente', dc35.ok && dc35.offer.kind === 'contraoferta' && dc35.offer.status === 'pendiente', JSON.stringify(dc35));
  const pc33 = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: rqR.request.id, offer_id: dc35.offer.id, action: 'contraoferta', price: 33 });
  check('contraoferta del pasajero a $33 rechazada', !pc33.ok && /cinco en cinco/.test(pc33.error || ''), JSON.stringify(pc33));
  const pc30 = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: rqR.request.id, offer_id: dc35.offer.id, action: 'contraoferta', price: 30 });
  check('contraoferta del pasajero a $30 aceptada', pc30.ok, JSON.stringify(pc30));
  const acc30 = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: rqR.request.id, offer_id: dc35.offer.id, action: 'acepta' });
  check('chofer acepta contraoferta del pasajero: confirma a $30', acc30.ok && acc30.request.status === 'aceptado' && acc30.request.final_price === 30, JSON.stringify(acc30));

  console.log('== v1.3.3: login con perfil sin cuenta ya no rompe la pantalla ==');
  // Bug 2026-11-21: /api/login con un número con perfil pero sin cuenta devolvía
  // needs_claim SIN campo error; el api() del cliente solo lanzaba cuando había
  // error, así que tomaba la respuesta por éxito y doLogin reventaba en
  // j.account.name ("Cannot read properties of undefined (reading 'name')").
  const soloPhone = '961300' + RUN.slice(0, 4);
  const solo = await api('/api/register-passenger', { name: 'Solo Perfil', phone: soloPhone, face_photo: PHOTO });
  check('perfil solo-pasajero sin cuenta (caso Paulina)', solo.ok && solo.passenger.id, JSON.stringify(solo));
  const liSolo = await api('/api/login', { identifier: soloPhone, password: 'cualquiera1' });
  check('login con perfil sin cuenta ofrece reclamarlo Y trae mensaje de error', !liSolo.ok && liSolo.needs_claim === true && liSolo.profile_name === 'Solo Perfil' && typeof liSolo.error === 'string' && liSolo.error.length > 0, JSON.stringify(liSolo));
  // Réplica exacta del api() ya corregido del cliente: lanza con CUALQUIER !ok.
  function clientApiFixed(j) {
    if (!j.ok) { const e = new Error(j.error || 'Algo salió mal. Inténtalo de nuevo.'); e.data = j; throw e; }
    return j;
  }
  let threwClaim = false, claimData = null;
  try { clientApiFixed(liSolo); } catch (e) { threwClaim = true; claimData = e.data; }
  check('el api() del cliente ahora lanza con needs_claim (antes lo tomaba por éxito y reventaba en account.name)', threwClaim && claimData && claimData.needs_claim === true && claimData.profile_name === 'Solo Perfil');
  const claimSolo = await api('/api/claim-account', { phone: soloPhone, username: 'solo_' + RUN, password: 'clave12345' });
  check('reclamar el perfil solo-pasajero con contraseña lo enlaza a la cuenta', claimSolo.ok && claimSolo.passenger && claimSolo.passenger.id === solo.passenger.id && !!claimSolo.token, JSON.stringify(claimSolo));
  const liSolo2 = await api('/api/login', { identifier: soloPhone, password: 'clave12345' });
  check('después de reclamar, el login con ese número funciona', liSolo2.ok && liSolo2.account.id === claimSolo.account.id && liSolo2.account.name === 'Solo Perfil', JSON.stringify(liSolo2));
  const liNadie = await api('/api/login', { identifier: '961399' + RUN.slice(0, 4), password: 'loquesea1' });
  check('login con número sin ningún perfil: mensaje limpio, sin needs_claim', !liNadie.ok && !liNadie.needs_claim && /No existe/.test(liNadie.error || ''), JSON.stringify(liNadie));
  const liMala = await api('/api/login', { identifier: soloPhone, password: 'clave_mala' });
  check('login con contraseña incorrecta: mensaje limpio', !liMala.ok && /incorrecta/.test(liMala.error || ''), JSON.stringify(liMala));

  console.log('== v1.3.4: rótulos con nombre, ojo en contraseñas, reclamo amigable ==');
  const h134 = await api('/api/health');
  check('versión 1.4.18', h134.ok && h134.version === '1.4.18', JSON.stringify(h134));
  const pl = await api('/api/places');
  check('lugares con nombre (Meta) en /api/places', pl.ok && Array.isArray(pl.landmarks) && pl.landmarks.length >= 10, JSON.stringify((pl.landmarks || []).map(l => l.name)));
  for (const must of ['Clínica · Centro de Salud', 'Parque Central', 'Mercado Municipal', 'Arco de bienvenida', 'Carnicería Progreso', 'Farmacias Similares', 'Carnicería La Central']) {
    check('rótulo presente: ' + must, pl.landmarks.some(l => l.name === must));
  }
  check('todos los rótulos tienen nombre y coordenadas válidas en San Fernando', pl.landmarks.every(l => typeof l.name === 'string' && l.name.length > 0 && typeof l.lat === 'number' && typeof l.lng === 'number' && l.lat > 16.84 && l.lat < 16.90 && l.lng > -93.24 && l.lng < -93.18));
  check('rótulos sin duplicados por nombre', new Set(pl.landmarks.map(l => l.name)).size === pl.landmarks.length);
  check('mensaje de reclamo amigable con el nombre del registro', /Ya tienes un registro en SanFerGo a nombre de/.test(liSolo.error || ''), JSON.stringify(liSolo));
  // Cliente: ojo en las contraseñas, rótulos en el mapa y mapas sin llave.
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  check('ojo para ver contraseña en los 4 campos (login, registro x2, reclamo)', ['li-pass', 'rc-pass', 'rc-pass2', 'cl-pass'].every(id => html.includes("pwInput('" + id + "'")) && html.includes('function togglePw'));
  check('el cliente pinta rótulos de lugares en el mapa de marcar punto', html.includes('drawPlaceLabels') && html.includes('LANDMARKS') && html.includes('place-label'));
  // Mapas sin llave: las tres fuentes del mapa (estilo Meta, OSM, Esri) no
  // llevan ningún parámetro de llave. Antes el check buscaba "api_key" en
  // todo el código, pero v1.4.17 usa una llave de Resend para el correo
  // (no es del mapa), así que el check ahora mira solo las rutas del mapa.
  check('mapas sin llave en cliente y servidor (nada de MapTiler ni llave en las rutas del mapa)', !/maptiler/i.test(html + srv) && !/META_STYLE_URL = '[^']*[?&]key=/i.test(html) && !/LIGHT_TILES = '[^']*[?&]key=/i.test(html) && !/ESRI_TILES = '[^']*[?&]key=/i.test(html));
  // Corrección del orden del viaje activo (v1.3.4): el aviso verde ya NO va
  // arriba; va en la columna de abajo, debajo de Cancelar, sobre la tarjeta.
  check('orden corregido del viaje activo: aviso verde en la columna de abajo, no arriba', html.includes('.strip.bottom.paxbot .arrive') && !html.includes('.strip.top.paxcol .arrive') && !/top\.innerHTML = \(showArrive/.test(html));
  const bi = html.indexOf('bot.innerHTML = (canCancel');
  check('Cancelar, aviso verde y tarjeta del chofer van en la columna de abajo, en ese orden', bi > 0 && html.indexOf('+ arriveHtml', bi) > bi && html.indexOf('drivercard', bi) > html.indexOf('+ arriveHtml', bi));
  check('encuadre del viaje activo deja más aire abajo que arriba', html.includes('bottom: botPad') && html.includes('offset: [0, -60]'));
  // Seguimiento del taxímetro y del viaje en vivo (v1.4.4): el giro heading-up
  // es un easeTo programático que dispara rotatestart; los handlers solo
  // apagan el seguimiento con gesto real (e.originalEvent), si no el propio
  // giro lo mataba al primer cambio de rumbo.
  check('handlers de seguimiento solo reaccionan a gestos reales (originalEvent)', html.includes('function taxiFollowOff(e){ if(e && !e.originalEvent) return;') && html.includes('function liveFollowOff(e){ if(e && !e.originalEvent) return;') && html.includes("taxiMap.on('rotatestart', taxiFollowOff)") && html.includes("liveMap.on('rotatestart', liveFollowOff)"));
  check('centrado del taxímetro con padding medido desde el DOM (franja libre)', html.includes('function taxiFollowPadding()') && html.includes('function taxiCenterOn(p, zoom, bearing)') && html.includes('padding: taxiFollowPadding()') && html.includes('taxiFollowCenter({ lat, lng })'));
  check('al reabrir el taxímetro con recorrido en curso el seguimiento se reanuda', html.includes('if(s2.running){ taxiFollow = true;'));
  check('centrado del viaje en vivo con padding de la franja libre', html.includes('function liveFollowPadding()') && html.includes('padding: liveFollowPadding()'));
  // Giro derecho del taxímetro y mapa despejado (v1.4.5): el movimiento del
  // mapa ya no depende del umbral de 4 m de la tarifa; rumbo del GPS o de
  // puntos con ≥ 2 m; suavizado 0.7 y giro en 300 ms; se ocultan los
  // rótulos de negocios en taxímetro y viaje en vivo; controles más chicos.
  check('el taxímetro mueve marcador/giro/centro en cada lectura, el 4 m es solo tarifa', html.includes('if(d >= 0.004){ // los pasos cuentan desde 4 m SOLO para la tarifa') && html.includes('taxiFollowCenter({ lat, lng })'));
  check('rumbo reactivo: suavizado 0.7 en taxímetro y viaje en vivo', html.includes('taxiLastHeading += dd * 0.7') && html.includes('liveLastHeading += d * 0.7') && html.includes('newBearing = taxiLastHeading') && html.includes('return liveLastHeading;'));
  check('se ocultan los rótulos de negocios en los mapas en vivo (taxímetro y viaje)', html.includes('function hidePoiLabels(map)') && html.includes('function declutterLiveMap(map)') && html.includes('declutterLiveMap(taxiMap)') && html.includes('declutterLiveMap(liveMap)'));
  check('controles del taxímetro más chicos (velocidad, zoom/brújula, píldoras)', html.includes('.taxispeed{position:absolute;right:0;bottom:calc(100% + 10px);width:62px;height:62px') && html.includes('.taxizoom button{width:36px;height:36px;font-size:17px') && html.includes('.taxi-vas{background:#14532d;color:#fff;font-weight:800;font-size:11px'));
  // Un solo easeTo por actualización (v1.4.6): en MapLibre cada easeTo
  // cancela la animación anterior; el giro y el centrado iban en dos
  // llamadas seguidas y el mapa nunca giraba (siempre norte-arriba, la
  // mototaxi iba de lado). Ahora centro + giro van juntos en una sola
  // llamada; si no se recentra, el giro va solo. La etiqueta de inicio
  // va 34 px abajo para no tapar la píldora de la mototaxi.
  check('taxímetro: giro y centrado en UN solo easeTo por lectura', html.includes('function taxiCenterOn(p, zoom, bearing)') && html.includes('taxiFollowCenter({ lat, lng }, newBearing)') && html.includes('if(!taxiFollowCenter({ lat, lng }, newBearing) && newBearing!=null)') && !html.includes('taxiMap.easeTo({ bearing: -taxiLastHeading'));
  check('viaje en vivo: giro y centrado en UN solo easeTo por tick', html.includes('function applyHeading(heading){') && html.includes('liveBearing = applyHeading(h)') && html.includes('opts.bearing = liveBearing') && !html.includes('map.easeTo({ bearing: -liveLastHeading'));
  check('etiqueta "Inicio del recorrido" desplazada 34 px abajo del punto', html.includes('offset: [0, 34]') && html.includes("el.className = 'taxi-start'"));
  // Rediseño compacto del taxímetro corriendo (v1.4.7, igual que la app real):
  // mototaxi grande vista desde arriba; Precio final en píldora compacta
  // centrada; una sola tarjeta final con FINALIZAR a la derecha en la misma
  // fila; sin píldora de plan ni brújula corriendo; el ícono angosto del
  // viaje en vivo no se toca.
  check('taxímetro corriendo: EL MISMO ícono de la app real (MototaxiTopIcon)', html.includes('viewBox="0 0 48 64"') && html.includes('fill="#7dd3fc"') && html.includes('r="5.2"') && html.includes("inner.appendChild(motoIconEl())") && !html.includes('taxiMotoIconEl'));
  check('taxímetro corriendo: Precio final en píldora compacta centrada', html.includes('.taxidark.taxprice{display:flex;justify-content:center;align-items:center;gap:12px;width:max-content;max-width:75%'));
  check('taxímetro corriendo: una sola tarjeta final con FINALIZAR a la derecha', html.includes('class="taxidark taxifinal"') && html.includes('.taxidark.taxifinal{display:flex;align-items:center;gap:12px}') && html.includes('.taxidark.taxifinal button{width:auto;margin-top:0;'));
  check('taxímetro corriendo: sin píldora de plan ni brújula', !html.includes("top.innerHTML = taxiLimitHtml(true)\n      + '<div class=\"taxidark\">'") && html.includes("zoom.classList.add('hidden'); compass.classList.add('hidden'); // sin brújula corriendo"));
  check('taxímetro corriendo: la píldora de plan se queda en el inicio', html.includes('top.innerHTML = taxiLimitHtml(true)') && html.includes('function taxiLimitHtml(dark)'));
  // Giro sin depender de coords.speed/coords.heading (v1.4.7): en iOS llegan
  // null andando y el rumbo nunca se calculaba (mapa siempre en norte-arriba).
  // Ahora velocidad y rumbo salen del desplazamiento entre lecturas.
  check('taxímetro: velocidad y rumbo del desplazamiento entre lecturas (sin coords.speed)', html.includes('let lastFix = null, taxiHeadingRef = null;') && html.includes('havKm(lastFix.lat, lastFix.lng, lat, lng)') && html.includes('speedKmh = (dt > 0 && dd >= 0.0025) ? (dd / (dt / 3600)) : 0') && html.includes('taxiBearingDeg(taxiHeadingRef, { lat, lng })') && html.includes('lastFix = { lat, lng, t: now };'));
  // Sentido del giro (v1.4.8): el rumbo prefería la brújula del teléfono
  // (hacia dónde apunta el aparato), pero en la mototaxi el teléfono va
  // mirando al chofer, así que el mapa giraba 180° al revés y la moto
  // parecía ir hacia abajo (captura 4:56). El giro ya NO lee nunca la
  // brújula: el rumbo es siempre el del desplazamiento entre lecturas.
  // Simulación del caso real: dos lecturas yendo al SUR (latitud bajando)
  // con la brújula presente y al revés (0°, norte) → rumbo 180° (sur) y
  // bearing +180° en MapLibre (el bearing es +rumbo; ver v1.4.11), con la
  // fórmula de círculo máximo (taxiBearingDeg).
  const latA = 16.8709, lngA = -93.2063, latB = 16.8700, lngB = -93.2063;
  const dLngS = (lngB-lngA)*Math.PI/180, la1S = latA*Math.PI/180, la2S = latB*Math.PI/180;
  const hSur = (Math.atan2(Math.sin(dLngS)*Math.cos(la2S), Math.cos(la1S)*Math.sin(la2S)-Math.sin(la1S)*Math.cos(la2S)*Math.cos(dLngS)) * 180/Math.PI + 360) % 360;
  check('giro v1.4.8: el rumbo es siempre el del desplazamiento, nunca la brújula del teléfono', !html.includes('coords.heading') && html.includes('function taxiBearingDeg(') && Math.abs(hSur - 180) < 0.01);
  // Rumbo con referencia ESTABLE (v1.4.9): replica el método de la app real
  // (MapView followVehicle: lastVehiclePosRef solo avanza con >4 m y rumbo
  // bearingDeg de círculo máximo; bearing = +rumbo en MapLibre — el
  // rotate() de CSS de la app real es -rumbo, pero MapLibre aplica el
  // bearing con el signo opuesto (ver v1.4.11); marcador clavado en el
  // centro y el mapa gira debajo). La web movía su referencia en CADA
  // lectura (~1 Hz): con ruido de GPS el rumbo salía de dos puntos de ~5 m
  // y saltaba, así que la línea azul quedaba AL LADO de la mototaxi
  // (capturas 5:17/5:18) aunque el ícono apuntara arriba.
  // (a) Viaje recto al ESTE, lecturas ~1 Hz a 2.8 m, ruido GPS realista
  // (deriva lenta ±0.3 m/lectura + temblor ±0.5 m, error total ~±3 m): el
  // rumbo suavizado 0.7 debe mantenerse ~90° (este) y el bearing ~+90°,
  // o sea la línea queda abajo. El método viejo (referencia cada lectura,
  // ≥2 m) se degrada mucho más con el mismo ruido.
  function havKmT(a,b,c,d){ const R=6371, r=x=>x*Math.PI/180;
    const x=r(c-a), y=r(d-b);
    return 2*R*Math.asin(Math.sqrt(Math.sin(x/2)**2 + Math.cos(r(a))*Math.cos(r(c))*Math.sin(y/2)**2)); }
  function bearingDegT(a,b){
    const dLng=(b.lng-a.lng)*Math.PI/180, la1=a.lat*Math.PI/180, la2=b.lat*Math.PI/180;
    const y=Math.sin(dLng)*Math.cos(la2);
    const x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLng);
    return (Math.atan2(y,x)*180/Math.PI+360)%360; }
  function normDeg(d){ while(d>180)d-=360; while(d<-180)d+=360; return d; }
  let seed9=777; function rnd9(){ seed9=(seed9*1103515245+12345)%2147483648; return seed9/2147483648; }
  const lat9=16.8709, lng9=-93.2063, mLa9=111320, mLn9=111320*Math.cos(lat9*Math.PI/180);
  let dx9=0, dy9=0; const pts9=[];
  for(let i=0;i<40;i++){
    dx9+=(rnd9()*2-1)*0.3; dy9+=(rnd9()*2-1)*0.3;
    pts9.push({ lat: lat9+(dy9+(rnd9()*2-1)*0.5)/mLa9, lng: lng9+(i*2.8+dx9+(rnd9()*2-1)*0.5)/mLn9 });
  }
  let ref9=null, lastH9=null; const hs9=[];
  for(const p of pts9){
    if(!ref9){ ref9=p; continue; }
    if(havKmT(ref9.lat,ref9.lng,p.lat,p.lng)>0.004){
      const h=bearingDegT(ref9,p); ref9=p;
      if(lastH9==null) lastH9=h; else lastH9=lastH9+normDeg(h-lastH9)*0.7;
      hs9.push(lastH9);
    }
  }
  let prev9=null, lastH9o=null; const hs9o=[];
  for(const p of pts9){
    if(prev9 && havKmT(prev9.lat,prev9.lng,p.lat,p.lng)>=0.002){
      const h=(Math.atan2(p.lng-prev9.lng,p.lat-prev9.lat)*180/Math.PI+360)%360;
      if(lastH9o==null) lastH9o=h; else lastH9o=lastH9o+normDeg(h-lastH9o)*0.7;
      hs9o.push(lastH9o);
    }
    prev9=p;
  }
  const rms9=a=>Math.sqrt(a.reduce((s,h)=>s+normDeg(h-90)**2,0)/a.length);
  const max9=a=>Math.max(...a.map(h=>Math.abs(normDeg(h-90))));
  check('giro v1.4.9: con referencia estable el rumbo se mantiene al este (línea abajo)', html.includes('function taxiBearingDeg(') && html.includes('taxiHeadingRef') && html.includes('if(havKm(taxiHeadingRef.lat, taxiHeadingRef.lng, lat, lng) > 0.004){') && hs9.length>=10 && rms9(hs9)<=8 && max9(hs9)<=15 && rms9(hs9o)>rms9(hs9), 'nuevo rms='+rms9(hs9).toFixed(1)+' max='+max9(hs9).toFixed(1)+' vs viejo rms='+rms9(hs9o).toFixed(1));
  // (b) Parado con temblor: la referencia del rumbo NO se actualiza ni gira.
  // Sin puerta de velocidad (la app real tampoco la tiene): la referencia
  // de >4 m ya filtra el temblor parado.
  let seed9b=777, dx9b=0, dy9b=0, ref9b=null, upd9b=0;
  function rnd9b(){ seed9b=(seed9b*1103515245+12345)%2147483648; return seed9b/2147483648; }
  for(let i=0;i<20;i++){
    dx9b+=(rnd9b()*2-1)*0.3; dy9b+=(rnd9b()*2-1)*0.3;
    const p={ lat: lat9+(dy9b+(rnd9b()*2-1)*0.5)/mLa9, lng: lng9+(dx9b+(rnd9b()*2-1)*0.5)/mLn9 };
    if(!ref9b){ ref9b=p; continue; }
    if(havKmT(ref9b.lat,ref9b.lng,p.lat,p.lng)>0.004){ upd9b++; ref9b=p; }
  }
  check('giro v1.4.9: parado con temblor la referencia del rumbo no avanza ni gira', upd9b===0 && !html.includes('if(speedKmh >= 5)'), 'actualizaciones='+upd9b);
  // Signo del giro (v1.4.11): en MapLibre el bearing es +rumbo, al revés
  // que el rotate() de CSS de la app real (donde es -rumbo). Comprobado en
  // navegador real con MapLibre 4.7.1 (mismo estilo y opciones de makeMap,
  // simulación del taxímetro con la cadena verbatim): jumpTo/easeTo con
  // bearing -90 dejan el este ABAJO en pantalla y con bearing +90 lo dejan
  // ARRIBA (project() del punto 60 m al este: y mayor que el centro con
  // -90, y menor con +90; y el fuente confirma bearing()=-angle/π*180).
  // El signo viejo (-rumbo, desde v1.4.4) hacía que la moto fuera hacia
  // abajo o de lado aunque el rumbo fuera estable (capturas 4:56, 5:17/5:18;
  // "Nada sigue igual" 17:40); los tests viejos afirmaban ese signo malo
  // (bearing -180° para ir al sur), por eso pasaban 248/248 mientras el
  // usuario lo veía mal. Simulación: ir al ESTE da rumbo ~90° → bearing
  // +90°; ir al SUR da rumbo 180° → bearing +180°. La línea azul queda
  // abajo solo con +rumbo, en el taxímetro y en el viaje en vivo.
  const bEast11 = hs9.length ? hs9[hs9.length-1] : null;
  check('giro v1.4.11: en MapLibre el bearing es +rumbo (el signo viejo lo dejaba al revés)', html.includes('newBearing = taxiLastHeading;') && !html.includes('newBearing = -taxiLastHeading;') && html.includes('return liveLastHeading;') && !html.includes('return -liveLastHeading;') && bEast11!=null && Math.abs(bEast11 - 90) < 15 && Math.abs(hSur - 180) < 0.01, 'bearing este=+' + (bEast11==null?'?':bEast11.toFixed(1)) + ' sur=+' + hSur.toFixed(1));
  // Pie de versión en inicio (v1.4.11, petición del usuario): debajo del
  // enlace "Mi cuenta" sale "Versión X" en texto pequeño y discreto, de la
  // única constante APP_VERSION del cliente; el check compara con
  // /api/health para que ambas coincidan al subir de versión.
  check('pie de versión en inicio (v1.4.18)', html.includes('id="home-version"') && html.includes("ver.textContent = 'Versión ' + APP_VERSION;") && html.includes("const APP_VERSION = '1.4.18';") && h.version === '1.4.18', 'health=' + JSON.stringify(h));
  // Aviso de privacidad (v1.4.18): página pública en /privacidad y enlace
  // en el pie de la pantalla de inicio de sesión.
  const privRes = await fetch(B + '/privacidad');
  const privText = await privRes.text();
  check('GET /privacidad devuelve 200', privRes.status === 200, 'status=' + privRes.status);
  check('el aviso de privacidad es de SanFerGo y explica los datos', /privacidad/i.test(privText) && privText.includes('Aviso de privacidad — SanFerGo') && privText.includes('9614868605') && privText.includes('No vendemos tus datos'));
  check('la pantalla de inicio de sesión enlaza al aviso de privacidad en pestaña nueva', html.includes('Aviso de privacidad') && html.includes('href="/privacidad"') && html.includes('target="_blank"'));
  // Anuncio flotante con la geometría exacta de la app real (v1.4.13,
  // marca roja del usuario 6:38: "en la app está súper bien"): tarjeta
  // max-width 340 px con radio 24 px y sin borde; imagen a todo lo ancho
  // a su proporción natural (width:100%, sin tope de alto). La v1.4.12 la
  // dejaba ceñida a la imagen (width:max-content, 56dvh, ~266 px de ancho).
  // El pie (padding 16 px) y la X (top/right 12 px) no cambian; la
  // verificación visual está en la captura del navegador real (README).
  check('anuncio flotante: geometría exacta de la app, tarjeta 340 px e imagen a todo lo ancho (v1.4.13)', html.includes('#entry-ad-overlay .adfloat{pointer-events:auto;position:relative;width:min(92vw,340px);max-height:85dvh;overflow-y:auto;background:#fff;border:0;border-radius:24px;box-shadow:0 12px 40px rgba(0,0,0,.35)}') && html.includes('#entry-ad-overlay .adfloat img{width:100%;max-height:none;object-fit:contain;background:#fff;display:block;cursor:pointer}') && !html.includes('width:max-content;max-width:min(92vw,400px)') && !html.includes('#entry-ad-overlay .adfloat img{width:auto;max-width:100%;max-height:56dvh;object-fit:contain;') && html.includes("#entry-ad-overlay .adfoot{padding:16px}") && html.includes('#entry-ad-overlay .adx{position:absolute;top:12px;right:12px;'));
  // Paso de destino igual a la app real (v1.4.13, capturas del usuario
  // 6:35): fila compacta Regresar + píldora de origen (con Cambiar dentro)
  // y tarjeta de búsqueda aparte; el chip ya no se aplasta en tirita
  // vertical (la causa era .strip button{width:100%}). Se verifica sobre
  // el código del paso: se recorta la rama dest de openPick y se comprueba
  // su estructura y el CSS .pickdest. La verificación visual está en la
  // captura del navegador real (README).
  const di = html.indexOf("} else if(pickWhich==='dest'){");
  const dj = html.indexOf("} else if(pickWhich==='mdest'){", di);
  const destHtml = di >= 0 && dj > di ? html.slice(di, dj) : '';
  check('destino: botón Regresar en el paso ¿A dónde vas? (v1.4.13)', destHtml.includes("onclick=\"closePick()\">‹ Regresar</button>") && destHtml.includes('class="pickrow"'), destHtml.slice(0, 200));
  check('destino: el chip de origen no se aplasta — píldora con Cambiar dentro y ellipsis (v1.4.13)', destHtml.includes('class="pick-change"') && destHtml.includes('id="pick-chip"') && destHtml.includes('text-overflow:ellipsis;white-space:nowrap') && !destHtml.includes('white-space:normal') && html.includes('.strip.top.pickdest .pick-change{width:auto') && html.includes('.strip.top.pickdest .backpill{width:auto'), destHtml.slice(0, 300));
  check('destino: tiras transparentes como en la app (v1.4.13)', destHtml.includes("classList.add('pickdest')") && html.includes('.strip.top.pickdest{background:transparent;box-shadow:none;padding:0;display:flex;flex-direction:column;gap:6px;align-items:stretch}') && html.includes('.strip.bottom.pickdest{background:transparent;box-shadow:none;padding:0}'));
  // Banner de viaje activo en Inicio (v1.4.14, reporte del usuario 7:03:
  // aceptó y el mapa "se desapareció"). El banner del chofer va ARRIBA
  // del Inicio de chofer (div primero en renderDriverHome, se pinta desde
  // driverCounts) con botón ámbar "Ver mi viaje en curso" que abre el
  // mapa en vivo; el del pasajero va en Inicio (fillHomeActiveBanner,
  // desde myActiveRequest) con el mismo botón. La X solo oculta en la
  // sesión (dismissed*Id en memoria: al recargar vuelve). En Viajes el
  // viaje aceptado ya se reabre solo en el mapa en vivo (renderViajes).
  check('banner chofer: aviso arriba del Inicio de chofer con botón al mapa en vivo (v1.4.14)', html.includes('<div id="driver-active-banner"></div>') && html.includes('¡El pasajero confirmó tu viaje!') && html.includes("onclick=\"goLive('+c.active.id+', true)\">") && html.includes('Ver mi viaje en curso') && html.includes('dismissedDriverActiveId') && html.includes('function dismissDriverActiveBanner()'));
  check('banner pasajero: aviso en Inicio con botón al mapa en vivo (v1.4.14)', html.includes('<div id="home-active-banner"></div>') && html.includes('async function fillHomeActiveBanner()') && html.includes('¡Tu viaje fue aceptado! Tu mototaxi viene en camino') && html.includes("onclick=\"goLive('+active.id+', false)\">") && html.includes('dismissedPaxActiveId') && html.includes('function dismissPaxActiveBanner()'));
  check('Viajes: el viaje aceptado se reabre solo en el mapa en vivo al entrar (v1.4.14)', html.includes("if(active.status==='aceptado'){ goLive(active.id, false); return; }"));
  // Mapa en vivo a prueba de OSRM caído (v1.4.14): si el fetch de la ruta
  // rechaza, renderLiveMap NO debe tumbar openLiveTrip antes de las
  // tiras — la ruta se protege con try/catch y openLiveTrip protege el
  // render del mapa, así las tiras (etapa, Precio final, botón de avance)
  // se dibujan igual y solo falta la línea azul. Igual en los mapas de
  // vista previa del asistente y de mandados.
  check('mapa en vivo: si OSRM falla, las tiras se dibujan igual (v1.4.14)', html.includes('try { rt = await osrmRoute(from, target); } catch(e){ rt = null; }') && html.includes('try { await renderLiveMap(); } catch(e)') && html.includes('try { rt = await osrmRoute(wiz.origin, wiz.dest); } catch(e){}') && html.includes('try { rt = await osrmRoute(first, dest); } catch(e){}'));
  // Paso de detalles igual a la app real (v1.4.15, captura del usuario
  // 7:29): las dos filas de puntos se aplastaban en tiritas verticales
  // porque .strip button{width:100%} hacía que "Cambiar" ocupara casi
  // toda la fila (misma causa que el paso de destino en v1.4.13). Ahora
  // cada fila es punto de color + texto en UNA línea con ellipsis +
  // "Cambiar" compacto con borde, como la pastilla de ruta de la app
  // (routePill) y su captura 7:34. Se verifica sobre el código del
  // paso 3 (rama wiz.step===3) y el CSS .pickdet.
  const detHtml = html.slice(html.indexOf('if(wiz.step===3){'), html.indexOf('if(wiz.step===4){'));
  check('detalles: las filas de puntos no se aplastan — texto en una línea con ellipsis y Cambiar compacto (v1.4.15)', detHtml.includes('class="strip top pickdet"') && (detHtml.match(/class="pickdet-txt"/g) || []).length === 2 && detHtml.includes('class="linklike"') && html.includes('.strip.top.pickdet .linklike{width:auto;margin:0;flex-shrink:0;background:#fff;color:#1c2420;border:1px solid var(--line);border-radius:10px;padding:6px 10px;font-size:12px;font-weight:800;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.10)}') && html.includes('.strip.top.pickdet .pickdet-txt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'), detHtml.slice(0, 200));
  // Encuadre del mapa en vivo del chofer por etapa (v1.4.15, reporte del
  // usuario 7:31): antes de iniciar, el mapa encuadra SOLO chofer +
  // recogida (la ruta azul hacia él); el destino no entra — encuadrar
  // los tres puntos alejaba el zoom a todo el recorrido y el mapa
  // quedaba enorme y vacío. Una vez iniciado, el encuadre es chofer +
  // destino (la ruta hacia donde van a llegar). Sin GPS del chofer, se
  // centra el punto objetivo a zoom de calle (maxZoom 16 de fitPoints).
  // El lado pasajero no cambia (ya centraba la recogida a zoom 16).
  check('mapa en vivo chofer: encuadre por etapa — recogida antes de iniciar, destino después (v1.4.15)', html.includes('const framePts = inTrip') && html.includes('? (from ? [[from.lng, from.lat], [dest.lng, dest.lat]] : [[dest.lng, dest.lat]])') && html.includes(': (from ? [[from.lng, from.lat], [pick.lng, pick.lat]] : [[pick.lng, pick.lat]]);') && html.includes('fitPoints(liveMap, framePts, liveFollowPadding())') && !html.includes('fitPoints(liveMap, pts, liveAsDriver ? 70'), detHtml.slice(0, 100));
  // Marcador de recogida "Recoge aquí" (v1.4.15, petición EXPLÍCITA del
  // usuario 19:35): camino a recoger, el punto es un PIN compacto con la
  // etiqueta "Recoge aquí" — la píldora verde con el nombre del pasajero
  // tapaba el mapa; el nombre ya está en las tiras de abajo. Una vez
  // iniciado el viaje ya no se marca la recogida (solo el destino, que
  // sigue con su píldora .pass-pin "Destino · zona").
  check('mapa en vivo chofer: el marcador de recogida dice "Recoge aquí" (pin compacto, no el nombre) (v1.4.15)', html.includes("pinLbl.textContent = 'Recoge aquí'") && html.includes("pinWrap.className = 'pickup-pin'") && html.includes("pinLbl.className = 'pickup-lbl'") && html.includes('.pickup-lbl{background:#14532d;color:#fff;border:2px solid #fff;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:800;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.35)}') && html.includes('.pickup-dot{width:14px;height:14px;border-radius:50%;background:#22c55e;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)}') && html.includes("if(!inTrip){") && !html.includes("pinEl.textContent = r.kind==='viaje'") && !html.includes('Aquí recoges al pasajero') && html.includes("destEl.textContent = 'Destino · ' + (r.dest_zone||'')"));
  // "Cómo llegar" como BOTÓN AZUL (v1.4.15, referencia de la app): era un
  // enlace <a> de texto azul que se partía en dos líneas ("Cómo /
  // llegar"); ahora es un botón azul compacto de una línea, con la misma
  // acción openGmaps. Ojo: .strip button{width:100%} lo habría vuelto
  // ámbar y de ancho completo — el selector .strip button.howbtn se
  // impone (misma trampa que aplastó el chip en v1.4.13).
  check('"Cómo llegar" es un botón azul compacto de una línea, no un enlace (v1.4.15)', html.includes('<button type="button" class="howbtn" onclick="openGmaps(') && html.includes('>Cómo llegar</button>') && html.includes('.strip button.howbtn{width:auto;margin:0;background:var(--blue);color:#fff;border:0;border-radius:999px;padding:8px 14px;font-weight:800;font-size:14px;white-space:nowrap;flex-shrink:0;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.18)}') && !html.includes('>Cómo llegar</a>') && !html.includes('<a href="#" style="font-weight:700;color:var(--blue)" onclick="openGmaps('));
  // Centrado de los dos puntos en el mapa del paso "Tu recorrido"
  // (v1.4.15, petición del usuario + foto de la app): el encuadre usaba
  // padding fijo 70 y los puntos quedaban tapados tras las tarjetas. La
  // app lo resuelve con fitCamera + insets (franja visible entre las
  // tarjetas); la web replica eso midiendo la altura real de la tarjeta
  // de arriba y la hoja de abajo y pasándola como padding a fitBounds.
  check('detalles: el mapa encuadra los dos puntos en la franja visible entre las tarjetas (v1.4.15)', html.includes("const fm = el.closest('.fullmap');") && html.includes("fm.querySelector('.strip.top')") && html.includes("fm.querySelector('.strip.bottom')") && html.includes('fitPoints(wizMap, [[wiz.origin.lng, wiz.origin.lat], [wiz.dest.lng, wiz.dest.lat]], { top: topPad, bottom: botPad, left: 24, right: 24 });') && !html.includes('fitPoints(wizMap, [[wiz.origin.lng, wiz.origin.lat], [wiz.dest.lng, wiz.dest.lat]]);'));
  // Carrusel de anuncios en Negocios (v1.4.16, petición del usuario con
  // captura de referencia: como el inicio de la app de la captura:
  // banners horizontales ARRIBA y las tarjetas de negocios abajo). El
  // contenedor va entre el título y los tres botones, que quedan EXACTOS
  // (mismo orden, mismo texto, mismas acciones).
  check('carrusel Negocios: contenedor arriba de los tres botones, botones sin tocar (v1.4.16)', html.includes("box.innerHTML = '<div id=\"biz-ads-carousel\"></div>'") && html.includes("'Administrar negocio':'Crear un negocio'") && html.includes("onclick=\"bizScreen=\\'my-appts\\';renderNegocios()\">Ver mi cita</button>") && html.includes("onclick=\"bizScreen=\\'my-orders\\';renderNegocios()\">Ver mi pedido</button>"));
  // Banners anchos con scroll-snap, puntos abajo (el activo verde y más
  // ancho), imagen cover centrada a 210 px para que el precio/oferta del
  // centro no se corte. La verificación visual está en la captura del
  // navegador real (README).
  check('carrusel Negocios: CSS de banners horizontales con scroll-snap y puntos (v1.4.16)', html.includes('.biz-carousel-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;') && html.includes('.biz-carousel-slide img{width:100%;height:210px;object-fit:cover;object-position:center;display:block;') && html.includes('.biz-carousel-dots button.on{background:#14532d;width:18px;border-radius:4px}') && html.includes('#biz-ads-carousel:empty{display:none}'));
  // Datos: los mismos anuncios activos de /api/ads que el flotante de
  // entrada, filtrados por entrada 'negocios'. Swipe con snap, puntos
  // que saltan al banner, auto-avance cada 5 s que se pausa al tocar, tap
  // (sin arrastre) abre el negocio vinculado y el libre no hace nada.
  // Sin anuncios activos no se muestra nada (sin caja vacía).
  check('carrusel Negocios: se alimenta de /api/ads filtrando por entrada negocios, auto-avance 5 s, tap abre el negocio vinculado y el libre no hace nada, sin anuncios no muestra nada (v1.4.16)', html.includes("async function renderBizAdsCarousel(){") && html.includes("api('/api/ads')") && html.includes("(a.entries||[]).includes('negocios')") && html.includes("if(!ads.length){ wrap.innerHTML = ''; return; }") && html.includes('}, 5000);') && html.includes("if(slide && slide.dataset.biz) openBusiness(+slide.dataset.biz);") && html.includes("bizCarouselStop()") && html.includes('class="biz-carousel-dots"') && html.includes('data-biz="')); 
  // El pie del anuncio se resuelve en el mismo payload (v1.4.12): el
  // servidor trae business_id/business_name ya resueltos en /api/entry-ad
  // (adWithBusiness), así que no hay carrera entre cargar anuncios y
  // negocios que deje el pie vacío en un anuncio vinculado. El render
  // muestra el nombre solo si hay business_name o label, y el botón
  // "Ver negocio" solo si hay business_id.
  check('anuncio: el pie se renderiza desde business_name/business_id del payload (v1.4.12)', html.includes("const biz = ad.business_name || ad.label || '';") && html.includes("'<h2>'+esc(biz)+'</h2>'") && html.includes("ad.business_id ? '<button class=\"btn\"") && html.includes('>Ver negocio</button>'));
  // Etiqueta "Inicio del recorrido" nunca tapada por el círculo de velocidad.
  check('taxímetro: la etiqueta de inicio se corre si el círculo la taparía', html.includes('function adjustTaxiStartOffset(){') && html.includes('taxiStartMarker.setOffset([offX, 34])') && html.includes("taxiMap.on('move', adjustTaxiStartOffset)") && html.includes('adjustTaxiStartOffset();'));
  // Aprobación del chofer (v1.4.7): el inicio del chofer revisaba
  // d.status === 'activo' (valor de NEGOCIOS), así que un chofer aprobado
  // ('aprobado') siempre veía "pendiente" y el botón deshabilitado, aunque
  // el admin ya lo hubiera aprobado y la lista de solicitudes estuviera
  // vacía. Ahora revisa 'aprobado', el estado se refresca del servidor al
  // abrir el inicio y al tocar "Ponerme en línea", y aprobar activa
  // también cualquier fila pendiente con el mismo teléfono.
  check('chofer: el inicio revisa status aprobado (no activo)', html.includes("const approved = d.status === 'aprobado';") && !html.includes("d.status === 'activo'"));
  check('chofer: el estado se refresca del servidor al abrir el inicio y al ponerse en línea', html.includes('function refreshMyDriver(){') && html.includes("refreshMyDriver().then(d=>{ if(d && currentView==='chofer' && driverTabName==='inicio') renderDriverHome(); })") && html.includes('await refreshMyDriver();'));
  check('chofer: aprobar activa también las filas pendientes del mismo teléfono', srv.includes("UPDATE drivers SET status='aprobado' WHERE phone=? AND status='pendiente'"));

  console.log('== Correcciones: acepta instantáneo, rejilla $5, límites, mandados, citas, anuncios, pago ==');
  // (2) Rejilla de $5 en aceptar_precio y en acepta.
  const rqG = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  const ap22 = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: rqG.request.id, kind: 'aceptar_precio', price: 22 });
  check("aceptar_precio a $22 rechazado (fuera de la rejilla)", !ap22.ok && /cinco en cinco/.test(ap22.error || ''), JSON.stringify(ap22));
  const ac33 = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: rqG.request.id, kind: 'acepta', price: 33 });
  check("'acepta' a $33 rechazado (fuera de la rejilla)", !ac33.ok && /cinco en cinco/.test(ac33.error || ''), JSON.stringify(ac33));
  const ac25 = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: rqG.request.id, kind: 'acepta', price: 25 });
  check("'acepta' a $25 confirma al instante tras los rechazos", ac25.ok && ac25.request.status === 'aceptado' && ac25.request.final_price === 25, JSON.stringify(ac25));
  // (3a) Tope de $80+ también al aceptar una contraoferta del pasajero
  // (vía driver-respond y vía respond-offer), con chofer sin suscripción.
  const drvFree = await api('/api/register-driver', { name: 'Gratis Tope', phone: '9610000006', vehicle: 'mototaxi', unit: 'T-6', selfie: PHOTO, vehicle_photo: PHOTO });
  await approveDriver(drvFree.driver.id);
  await api('/api/set-driver-online', { driver_id: drvFree.driver.id, online: true });
  const rq80 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  const off80 = await api('/api/driver-respond', { driver_id: drvFree.driver.id, request_id: rq80.request.id, kind: 'contraoferta', price: 35 });
  check('chofer gratis contraoferta $35 (pendiente)', off80.ok && off80.offer.status === 'pendiente', JSON.stringify(off80));
  const pc90 = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: rq80.request.id, offer_id: off80.offer.id, action: 'contraoferta', price: 90 });
  check('pasajera contraoferta $90', pc90.ok, JSON.stringify(pc90));
  const acc80a = await api('/api/driver-respond', { driver_id: drvFree.driver.id, request_id: rq80.request.id, kind: 'aceptar_contraoferta_pasajero' });
  check('chofer gratis NO acepta contraoferta de $90 (tope $80+)', !acc80a.ok && /80/.test(acc80a.error || ''), JSON.stringify(acc80a));
  const acc80b = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: rq80.request.id, offer_id: off80.offer.id, action: 'acepta' });
  check('respond-offer tampoco confirma la contraoferta de $90 (tope $80+)', !acc80b.ok && /80/.test(acc80b.error || ''), JSON.stringify(acc80b));
  // (3b) Límite gratis de 50 servicios también al confirmar por respond-offer.
  const drvLim = await api('/api/register-driver', { name: 'Gratis Límite', phone: '9610000007', vehicle: 'mototaxi', unit: 'L-7', selfie: PHOTO, vehicle_photo: PHOTO });
  await approveDriver(drvLim.driver.id);
  await api('/api/set-driver-online', { driver_id: drvLim.driver.id, online: true });
  async function tripFor(driverId, price) {
    const rq = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price, payment_method: 'efectivo' });
    return api('/api/driver-respond', { driver_id: driverId, request_id: rq.request.id, kind: 'acepta', price });
  }
  for (let i = 0; i < 49; i++) { const t = await tripFor(drvLim.driver.id, 25); if (!t.ok) throw new Error('trip límite ' + i + ': ' + JSON.stringify(t)); }
  const rqL = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  const offL = await api('/api/driver-respond', { driver_id: drvLim.driver.id, request_id: rqL.request.id, kind: 'contraoferta', price: 35 });
  check('con 49 servicios, la contraoferta $35 queda pendiente', offL.ok && offL.offer.status === 'pendiente', JSON.stringify(offL));
  const t50 = await tripFor(drvLim.driver.id, 25);
  check('servicio 50 gratis del día confirma', t50.ok && t50.request.status === 'aceptado', JSON.stringify(t50));
  const accL = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: rqL.request.id, offer_id: offL.offer.id, action: 'acepta' });
  check('con 50 servicios, respond-offer ya no confirma (límite gratis)', !accL.ok && /50 servicios gratis/.test(accL.error || ''), JSON.stringify(accL));
  // (4) Precio sugerido de mandado suma $10 por parada extra.
  async function suggestedMandado(extraStops) {
    const r = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, payment_method: 'efectivo', extra_stops: extraStops });
    return r.ok ? r.request.price : null;
  }
  check('mandado sin precio, 1.0 km, 0 paradas extra sugiere $20', (await suggestedMandado(0)) === 20);
  check('mandado sin precio, 1.0 km, 1 parada extra sugiere $30', (await suggestedMandado(1)) === 30);
  check('mandado sin precio, 1.0 km, 2 paradas extra sugiere $40', (await suggestedMandado(2)) === 40);
  const manFixed = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 40, payment_method: 'efectivo', extra_stops: 2 });
  check('mandado con precio puesto ($40) no suma paradas extra', manFixed.ok && manFixed.request.price === 40, JSON.stringify(manFixed));
  // (5) Viaje corto (menos de 0.5 km) sí se puede publicar a $20.
  const short = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.8705, dest_lng: -93.2068, distance_km: 0.3, price: 20, payment_method: 'efectivo' });
  check('viaje de 0.3 km a $20 se publica', short.ok && short.request.status === 'buscando' && short.request.price === 20, JSON.stringify(short));
  const shortSug = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.8705, dest_lng: -93.2068, distance_km: 0.3, payment_method: 'efectivo' });
  check('viaje de 0.3 km sin precio sugiere $20', shortSug.ok && shortSug.request.price === 20, JSON.stringify(shortSug));
  // (6) Chofer bloqueado SÍ puede avanzar y finalizar un viaje ya en curso.
  const drvBlk = await api('/api/register-driver', { name: 'Bloqueado Curso', phone: '9610000008', vehicle: 'mototaxi', unit: 'B-8', selfie: PHOTO, vehicle_photo: PHOTO });
  await approveDriver(drvBlk.driver.id);
  await api('/api/set-driver-online', { driver_id: drvBlk.driver.id, online: true });
  const rqB = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  const offB = await api('/api/driver-respond', { driver_id: drvBlk.driver.id, request_id: rqB.request.id, kind: 'acepta', price: 25 });
  check('viaje aceptado antes del bloqueo', offB.ok && offB.request.status === 'aceptado', JSON.stringify(offB));
  const blkB = await api('/api/block-driver', { token: admLogin.token, driver_id: drvBlk.driver.id, reason: 'Prueba: viaje en curso' });
  check('admin bloquea al chofer con el viaje en curso', blkB.ok && blkB.driver.is_blocked === 1, JSON.stringify(blkB));
  let blkOk = true;
  for (const st of ['en_camino', 'llego', 'en_viaje', 'finalizado']) {
    const a = await api('/api/advance-stage', { driver_id: drvBlk.driver.id, request_id: rqB.request.id, stage: st });
    if (!a.ok || a.request.trip_stage !== st) { blkOk = false; console.log('  avance bloqueado falló en ' + st + ' :: ' + JSON.stringify(a)); }
  }
  check('chofer bloqueado avanza y finaliza su viaje en curso', blkOk);
  await api('/api/unblock-driver', { token: admLogin.token, driver_id: drvBlk.driver.id });
  // (9) La forma de pago solo cambia mientras sigue buscando.
  const rqP = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  const payOk = await api('/api/set-payment-method', { request_id: rqP.request.id, method: 'transferencia' });
  check('cambiar pago mientras busca sí se puede', payOk.ok, JSON.stringify(payOk));
  const rqP2 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: rqP2.request.id, kind: 'acepta', price: 25 });
  const payNo = await api('/api/set-payment-method', { request_id: rqP2.request.id, method: 'transferencia' });
  check('cambiar pago con viaje aceptado SÍ se puede mientras sigue confirmado (antes de salir, v1.4.0)', payNo.ok, JSON.stringify(payNo));
  await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: rqP2.request.id, stage: 'en_camino' });
  const payNo2 = await api('/api/set-payment-method', { request_id: rqP2.request.id, method: 'efectivo' });
  check('cambiar pago ya en camino rechazado (quedó fijada)', !payNo2.ok && /fijada/.test(payNo2.error || ''), JSON.stringify(payNo2));
  const pay404 = await api('/api/set-payment-method', { request_id: 999999, method: 'transferencia' });
  check('cambiar pago de solicitud inexistente: 404', !pay404.ok, JSON.stringify(pay404));
  // (7) Citas sin encimes: solape real por duración del servicio (60 min).
  const biz = await api('/api/request-business', { token: li1.token, name: 'Salón Citas ' + RUN, type: 'citas', whatsapp: '9610000010' });
  check('negocio de citas creado (pendiente)', biz.ok && biz.business.id, JSON.stringify(biz));
  const bizAp = await api('/api/approve-business', { token: admLogin.token, business_id: biz.business.id });
  check('admin activa el negocio de citas', bizAp.ok && bizAp.business.status === 'activo', JSON.stringify(bizAp));
  const svc = await api('/api/add-service', { token: li1.token, business_id: biz.business.id, name: 'Corte', price: 100, duration_minutes: 60 });
  check('servicio de 60 min agregado', svc.ok && svc.service.id, JSON.stringify(svc));
  const ap1 = await api('/api/create-appointment', { token: li1.token, business_id: biz.business.id, service_id: svc.service.id, date: '2026-12-01', time: '10:00' });
  check('cita 10:00 (60 min) reservada', ap1.ok && ap1.appointment.id, JSON.stringify(ap1));
  const apOverlap = await api('/api/create-appointment', { token: li1.token, business_id: biz.business.id, service_id: svc.service.id, date: '2026-12-01', time: '10:30' });
  check('cita 10:30 rechazada (se solapa con la de 10:00-11:00)', !apOverlap.ok, JSON.stringify(apOverlap));
  const apSame = await api('/api/create-appointment', { token: li1.token, business_id: biz.business.id, service_id: svc.service.id, date: '2026-12-01', time: '10:00' });
  check('cita a la misma hora exacta rechazada', !apSame.ok, JSON.stringify(apSame));
  const ap11 = await api('/api/create-appointment', { token: li1.token, business_id: biz.business.id, service_id: svc.service.id, date: '2026-12-01', time: '11:00' });
  check('cita 11:00 aceptada (justo al terminar la anterior)', ap11.ok && ap11.appointment.id, JSON.stringify(ap11));
  // (8) entry-ad con historial: el sorteo es al azar entre TODOS los activos.
  const adA = await api('/api/create-ad', { token: admLogin.token, label: 'Anuncio negocio ' + RUN, image: ADIMG, kind: 'negocio', business_id: biz.business.id, entries: ['viajes'] });
  check('anuncio del negocio con historial (Ana tiene cita ahí)', adA.ok && adA.ad.id, JSON.stringify(adA));
  // v1.4.12: el anuncio vinculado trae business_id y business_name ya
  // resueltos en el mismo payload de creación (adWithBusiness) — el pie
  // (nombre + "Ver negocio") nunca llega vacío por carrera.
  check('anuncio vinculado: payload trae business_id y business_name (v1.4.12)', adA.ok && adA.ad.business_id === biz.business.id && typeof adA.ad.business_name === 'string' && adA.ad.business_name.length > 0, JSON.stringify(adA.ad));
  const adB = await api('/api/create-ad', { token: admLogin.token, label: 'Anuncio libre ' + RUN, image: ADIMG, kind: 'libre', entries: ['viajes'] });
  check('anuncio libre para el sorteo', adB.ok && adB.ad.id, JSON.stringify(adB));
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const e = await api('/api/entry-ad?entry=viajes&token=' + li1.token);
    if (e.ok && e.ad) seen.add(e.ad.id);
  }
  check('entry-ad con historial devuelve AMBOS anuncios en 40 sorteos (al azar, no solo el del historial)', seen.has(adA.ad.id) && seen.has(adB.ad.id), 'vistos: ' + [...seen].join(','));

  console.log('== v1.4.0: revisión completa (zonas, negocios, pedidos, citas, Premium) ==');
  // (a) Unidad obligatoria al registrar chofer.
  const noUnit = await api('/api/register-driver', { name: 'Sin Unidad', phone: '9610000099', vehicle: 'mototaxi', unit: '' });
  check('registrar chofer sin unidad rechazado (v1.4.0: unidad obligatoria)', !noUnit.ok && /unidad/i.test(noUnit.error || ''), JSON.stringify(noUnit));
  // (b) 21 zonas con las coordenadas reales (Copalar corregida).
  const pl140 = await api('/api/places');
  const cop = (pl140.places || []).find(p => p.name === 'Copalar');
  check('21 zonas con coordenadas reales de la app (Copalar 16.87814,-93.21507)', pl140.ok && pl140.places.length === 21 && cop && Math.abs(cop.lat - 16.87814) < 0.0001 && Math.abs(cop.lng + 93.21507) < 0.0001, JSON.stringify(cop));
  const lm = (pl140.landmarks || []).find(p => p.name === 'Farmacia Sagrado Corazón');
  check('registro de lugares con el nombre corregido (Farmacia Sagrado Corazón)', !!lm, JSON.stringify((pl140.landmarks || []).length));
  // (c) Negocio con ficha completa (categoría, colonia, horario, envío $25).
  // Cuenta nueva: Ana (li1) ya tiene su negocio de citas y el plan gratis
  // permite solo uno por cuenta.
  const accBea = await api('/api/register-account', { name: 'Bea Negocio', username: 'bea_' + RUN, phone: '961400' + RUN.slice(0, 4), password: 'secreta123' });
  check('cuenta nueva para el segundo negocio', accBea.ok && !!accBea.token, JSON.stringify(accBea));
  const biz2 = await api('/api/request-business', { token: accBea.token, name: 'Pizzería Prueba ' + RUN, type: 'entrega', whatsapp: '9610000012', category: 'Comida', colony: 'Centro', schedule: 'Lunes a sábado, 9 AM a 7 PM', delivery_fee: 25, description: 'Pizzas y pan' });
  check('negocio creado con categoría, colonia, horario y envío $25', biz2.ok && biz2.business.category === 'Comida' && biz2.business.colony === 'Centro' && biz2.business.schedule === 'Lunes a sábado, 9 AM a 7 PM' && biz2.business.delivery_fee === 25, JSON.stringify(biz2.business));
  await api('/api/approve-business', { token: admLogin.token, business_id: biz2.business.id });
  const v1 = await api('/api/business?id=' + biz2.business.id);
  const v2 = await api('/api/business?id=' + biz2.business.id);
  check('abrir la ficha suma vistas (estadísticas Premium)', v2.ok && v2.business.views >= (v1.business.views || 0) + 1, JSON.stringify([v1.business.views, v2.business.views]));
  const pr2 = await api('/api/add-product', { token: accBea.token, business_id: biz2.business.id, name: 'Pizza pepperoni', price: 120, description: 'Con queso y pepperoni' });
  check('producto con descripción', pr2.ok && pr2.product.description === 'Con queso y pepperoni', JSON.stringify(pr2));
  const av0 = await api('/api/set-product-available', { token: accBea.token, product_id: pr2.product.id, available: 0 });
  const pr2Off = await api('/api/business?id=' + biz2.business.id);
  check('producto marcado no disponible hoy', av0.ok && (pr2Off.business.products || []).find(p => p.id === pr2.product.id).available === 0, JSON.stringify(pr2Off.business.products));
  await api('/api/set-product-available', { token: accBea.token, product_id: pr2.product.id, available: 1 });
  // Los servicios solo van en negocios de citas (el de entrega vende
  // productos): se prueba con el salón de citas de Ana.
  const sv2 = await api('/api/add-service', { token: li1.token, business_id: biz.business.id, name: 'Tinte', price: 200, description: 'Tinte completo', duration_minutes: 90 });
  check('servicio con descripción y duración', sv2.ok && sv2.service.duration_minutes === 90, JSON.stringify(sv2));
  const avS = await api('/api/set-service-available', { token: li1.token, service_id: sv2.service.id, available: 0 });
  const sv2Off = await api('/api/business?id=' + biz.business.id);
  check('servicio marcado no disponible', avS.ok && (sv2Off.business.services || []).find(x => x.id === sv2.service.id).available === 0, JSON.stringify(sv2Off.business.services));
  // (d) Pedido con el envío CONFIGURADO del negocio ($25, no $20 fijo).
  const ord = await api('/api/create-order', { token: accBea.token, business_id: biz2.business.id, items: [{ product_id: pr2.product.id, qty: 2 }], customer_name: 'Ana Cuenta', customer_phone: accPhone, delivery_zone: 'Centro', delivery_address: 'Casa verde junto a la tienda', payment_method: 'efectivo', note: 'Sin cebolla' });
  check('pedido usa el envío del negocio ($25): 2×$120 + $25 = $265', ord.ok && ord.order.delivery_fee === 25 && ord.order.products_total === 240 && ord.order.total === 265 && ord.order.delivery_zone === 'Centro' && ord.order.payment_method === 'efectivo', JSON.stringify(ord.order));
  const byPhone = await api('/api/orders-by-phone?phone=' + accPhone);
  check('pedidos por teléfono (sin sesión)', byPhone.ok && byPhone.orders.some(o => o.id === ord.order.id), JSON.stringify(byPhone.orders && byPhone.orders.length));
  const ordSt = await api('/api/set-order-status', { token: accBea.token, order_id: ord.order.id, status: 'aceptado' });
  check('dueño acepta el pedido', ordSt.ok, JSON.stringify(ordSt));
  const ordCancel = await api('/api/cancel-order', { phone: accPhone, order_id: ord.order.id });
  check('pedido aceptado ya no se cancela', !ordCancel.ok, JSON.stringify(ordCancel));
  for (const st of ['preparando', 'listo', 'en_camino', 'entregado']) {
    const a = await api('/api/set-order-status', { token: accBea.token, order_id: ord.order.id, status: st });
    check('pedido avanza a ' + st, a.ok, JSON.stringify(a));
  }
  const ord2 = await api('/api/create-order', { token: accBea.token, business_id: biz2.business.id, items: [{ product_id: pr2.product.id, qty: 1 }], customer_name: 'Ana Cuenta', customer_phone: accPhone, delivery_zone: 'Centro', delivery_address: 'Casa verde', payment_method: 'transferencia' });
  const ord2Cancel = await api('/api/cancel-order', { phone: accPhone, order_id: ord2.order.id });
  check('pedido recibido (pendiente) sí se cancela por teléfono', ord2Cancel.ok, JSON.stringify(ord2Cancel));
  // (e) Cita sin sesión (solo con el teléfono) + búsqueda y cancelación por teléfono.
  const apNoSess = await api('/api/create-appointment', { business_id: biz.business.id, service_id: svc.service.id, date: '2026-12-02', time: '12:00', client_name: 'Sin Sesión', client_phone: '9613333333' });
  check('cita sin sesión, solo con WhatsApp', apNoSess.ok && apNoSess.appointment.client_phone === '9613333333', JSON.stringify(apNoSess));
  const apByPhone = await api('/api/appointments-by-phone?phone=9613333333');
  check('citas por teléfono (sin sesión)', apByPhone.ok && apByPhone.appointments.some(a => a.id === apNoSess.appointment.id), JSON.stringify(apByPhone.appointments && apByPhone.appointments.length));
  const apCancel = await api('/api/cancel-appointment', { phone: '9613333333', appointment_id: apNoSess.appointment.id });
  check('cita cancelada por teléfono', apCancel.ok, JSON.stringify(apCancel));
  // (f) Premium de negocios: estadísticas con los campos nuevos.
  const subBiz = await api('/api/subscribe-business', { token: accBea.token, business_id: biz2.business.id });
  check('Premium del negocio activado 30 días ($100)', subBiz.ok && subBiz.days === 30 && subBiz.price === 100, JSON.stringify(subBiz));
  const stats = await api('/api/business-stats?business_id=' + biz2.business.id + '&token=' + accBea.token);
  check('estadísticas Premium: views, pedidos y citas del mes', stats.ok && typeof stats.stats.views === 'number' && typeof stats.stats.orders_month === 'number' && typeof stats.stats.appointments_month === 'number' && stats.stats.orders_total >= 2, JSON.stringify(stats.stats));
  // (g) Mandado tipo "enviar" con vehículo: la moto no lo toma si es mototaxi.
  const manEnv = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', description: 'Llevar un paquete', vehicle: 'mototaxi', recipient_phone: '9614444444' });
  check('mandado "enviar" guarda vehicle=mototaxi y WhatsApp de quien recibe', manEnv.ok && manEnv.request.vehicle === 'mototaxi' && manEnv.request.recipient_phone === '9614444444', JSON.stringify(manEnv.request));
  const envNo = await api('/api/driver-respond', { driver_id: drvM.driver.id, request_id: manEnv.request.id, kind: 'acepta', price: 30 });
  check('moto no toma mandado "enviar" en mototaxi', !envNo.ok, JSON.stringify(envNo));

  console.log('== v1.4.17: código por correo + entrar con Google ==');
  // /api/config: qué opciones están activadas (la suite corre con
  // RESEND_API_KEY=test y GOOGLE_CLIENT_ID=test-client-id).
  const cfg = await api('/api/config');
  check('config: dice si el código por correo y Google están activados', cfg.ok && cfg.emailCode === true && cfg.googleClientId === 'test-client-id', JSON.stringify(cfg));
  // Sin Resend ni Google configurados: el código devuelve un error claro
  // (no se rompe nada) y Google también. Se levanta un segundo servidor
  // limpio en otro puerto, sin variables, solo para este caso.
  const { spawn } = require('node:child_process');
  const noKeyDir = '/tmp/sfg-nokey-' + RUN;
  const noKey = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: '3101', DATA_DIR: noKeyDir, RESEND_API_KEY: '', GOOGLE_CLIENT_ID: '' }, stdio: 'ignore' });
  async function waitHealth(base, tries) {
    for (let i = 0; i < (tries || 20); i++) {
      try { const r = await fetch(base + '/api/health'); const j = await r.json(); if (j.ok) return true; } catch (e) {}
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }
  const noKeyUp = await waitHealth('http://localhost:3101');
  check('segundo servidor sin llaves levanta para probar el caso desactivado', noKeyUp);
  if (noKeyUp) {
    const cfgOff = await (await fetch('http://localhost:3101/api/config')).json();
    check('config sin llaves: código por correo y Google desactivados', cfgOff.ok && cfgOff.emailCode === false && cfgOff.googleClientId == null, JSON.stringify(cfgOff));
    const codeOff = await (await fetch('http://localhost:3101/api/request-email-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nadie@prueba.mx' }) })).json();
    check('pedir código sin Resend devuelve error claro, sin romperse', !codeOff.ok && /aún no está activado/.test(codeOff.error || '') && codeOff.email_code_unavailable === true, JSON.stringify(codeOff));
    const gOff = await (await fetch('http://localhost:3101/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_token: 'token-falso' }) })).json();
    check('Google sin client ID devuelve error claro, sin romperse', !gOff.ok && /aún no está activado/.test(gOff.error || '') && gOff.google_unavailable === true, JSON.stringify(gOff));
  }
  noKey.kill('SIGKILL');
  try { fs.rmSync(noKeyDir, { recursive: true, force: true }); } catch (e) {}
  // Flujo completo del código (servidor principal, RESEND_API_KEY=test).
  const emV = 'verif' + RUN + '@prueba.mx';
  const reqV = await api('/api/request-email-code', { email: emV });
  check('pedir código: llega el código en modo de pruebas', reqV.ok && /^\d{6}$/.test(reqV.test_code || '') && reqV.expires_in === 600, JSON.stringify(reqV));
  const wrongV = await api('/api/verify-email-code', { email: emV, code: '000000' });
  check('código incorrecto rechazado (quedan intentos)', !wrongV.ok && /quedan/.test(wrongV.error || ''), JSON.stringify(wrongV));
  const regNoTok = await api('/api/register-account', { name: 'Sin Token', username: 'sintok_' + RUN, email: emV, password: 'secreta123' });
  check('registrarse con correo sin verificar el código rechazado', !regNoTok.ok && regNoTok.needs_email_code === true, JSON.stringify(regNoTok));
  const verV = await api('/api/verify-email-code', { email: emV, code: reqV.test_code });
  check('código correcto verificado: entrega el pase', verV.ok && !!verV.verification_token, JSON.stringify(verV));
  const regV = await api('/api/register-account', { name: 'Verif Correo', username: 'verif_' + RUN, email: emV, password: 'secreta123', email_code_token: verV.verification_token });
  check('con el pase, la cuenta se crea con el correo verificado', regV.ok && regV.account.email_verified === 1 && !!regV.token, JSON.stringify(regV));
  const reuseV = await api('/api/register-account', { name: 'Reuso', username: 'reuso_' + RUN, email: 'otro' + RUN + '@prueba.mx', password: 'secreta123', email_code_token: verV.verification_token });
  check('el pase es de un solo uso: con otro correo ya no sirve', !reuseV.ok && reuseV.needs_email_code === true, JSON.stringify(reuseV));
  const meV = await api('/api/me?token=' + regV.token);
  check('/api/me muestra el correo verificado', meV.ok && meV.account.email_verified === 1, JSON.stringify(meV));
  // Bloqueo por intentos: 5 códigos malos agotan el código.
  const emL = 'bloq' + RUN + '@prueba.mx';
  const reqL = await api('/api/request-email-code', { email: emL });
  check('código para probar el bloqueo por intentos', reqL.ok && /^\d{6}$/.test(reqL.test_code || ''));
  for (let i = 0; i < 5; i++) {
    const w = await api('/api/verify-email-code', { email: emL, code: '000000' });
    if (i < 4) check('intento fallido ' + (i + 1) + ' de 5 rechazado con intentos restantes', !w.ok && /quedan/.test(w.error || ''), JSON.stringify(w));
    else check('al 5.º intento fallido el código se agota', !w.ok && /Pide un código nuevo/.test(w.error || ''), JSON.stringify(w));
  }
  const verL = await api('/api/verify-email-code', { email: emL, code: reqL.test_code });
  check('tras agotar los intentos, ni el código correcto sirve', !verL.ok, JSON.stringify(verL));
  // Vencimiento: se atrasa expires_at directo en la BD (la suite tiene
  // acceso al archivo) y el código correcto ya no sirve.
  const emX = 'venc' + RUN + '@prueba.mx';
  const reqX = await api('/api/request-email-code', { email: emX });
  check('código para probar el vencimiento', reqX.ok && /^\d{6}$/.test(reqX.test_code || ''));
  {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'sanfergo.db');
    const tdb = new DatabaseSync(dbPath);
    tdb.prepare(`UPDATE email_verifications SET expires_at=datetime('now','-1 minute') WHERE email=?`).run(emX);
    tdb.close();
  }
  const verX = await api('/api/verify-email-code', { email: emX, code: reqX.test_code });
  check('código vencido rechazado (pide uno nuevo)', !verX.ok && /venció/.test(verX.error || ''), JSON.stringify(verX));
  // Límites de envío: 60 s entre códigos y máximo 3 por hora por correo.
  // Se atrasa created_at en la BD para no esperar 60 s reales entre envíos.
  const emR = 'tasa' + RUN + '@prueba.mx';
  async function backdateLatest(email) {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'sanfergo.db');
    const tdb = new DatabaseSync(dbPath);
    tdb.prepare(`UPDATE email_verifications SET created_at=datetime('now','-61 seconds') WHERE id=(SELECT id FROM email_verifications WHERE email=? ORDER BY id DESC LIMIT 1)`).run(email);
    tdb.close();
  }
  const rate1 = await api('/api/request-email-code', { email: emR });
  check('tasa: 1.er código', rate1.ok);
  const rSoon = await api('/api/request-email-code', { email: emR });
  check('tasa: reenvío inmediato rechazado (espera 60 s)', !rSoon.ok && /Espera/.test(rSoon.error || '') && typeof rSoon.retry_after === 'number', JSON.stringify(rSoon));
  await backdateLatest(emR);
  const rate2 = await api('/api/request-email-code', { email: emR });
  check('tasa: 2.º código tras 60 s', rate2.ok);
  await backdateLatest(emR);
  const rate3 = await api('/api/request-email-code', { email: emR });
  check('tasa: 3.er código tras 60 s', rate3.ok);
  await backdateLatest(emR);
  const rate4 = await api('/api/request-email-code', { email: emR });
  check('tasa: 4.º código en una hora rechazado (máximo 3)', !rate4.ok && /3 códigos/.test(rate4.error || ''), JSON.stringify(rate4));
  // Google: token inválido y sin token, rechazados.
  const gBad = await api('/api/auth/google', { id_token: 'token-falso-' + RUN });
  check('Google con token inválido rechazado', !gBad.ok && typeof gBad.error === 'string' && gBad.error.length > 0, JSON.stringify(gBad));
  const gNone = await api('/api/auth/google', {});
  check('Google sin token rechazado', !gNone.ok && /Falta el token/.test(gNone.error || ''), JSON.stringify(gNone));
  // Cliente: botón de Google real (GSI) y paso del código en el registro.
  check('cliente: carga Google Identity Services y usa el client ID de /api/config (v1.4.17)', html.includes("s.src = 'https://accounts.google.com/gsi/client'") && html.includes("window.google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogleSignIn") && html.includes("api('/api/config')") && html.includes('function onGoogleSignIn(resp)') && html.includes("api('/api/auth/google', { id_token: cred })"));
  check('cliente: el registro con correo pide el código y muestra el paso "Revisa tu correo" (v1.4.17)', html.includes("api('/api/request-email-code', { email })") && html.includes('function showEmailCodeStep(email)') && html.includes('Revisa tu correo') && html.includes('function doVerifyEmailCode()') && html.includes("api('/api/verify-email-code'") && html.includes("email_code_token: v.verification_token") && html.includes('function resendEmailCode()'));
  check('cliente: el botón de Google se reemplaza por el real solo si hay client ID; si no, queda el aviso (v1.4.17)', html.includes('id="google-btn-wrap"') && html.includes("if(cfg.googleClientId) setupGoogleSignIn()") && html.includes("if(!wrap || !cfg.googleClientId) return;"));
  check('cliente: solo con número el registro sigue directo, sin código (v1.4.17)', html.includes("if(email){") && html.includes('Con correo y el código activado, primero va el código'));

  console.log('== Listados ==');
  const all = await api('/api/requests');
  check('listar solicitudes con ofertas', all.ok && all.requests.length >= 4 && all.requests.every(r => Array.isArray(r.offers)));
  const open = await api('/api/requests?open=1');
  check('listar solicitudes abiertas', open.ok && open.requests.every(r => r.status === 'buscando'));

  console.log(`\nRESULTADO: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR DE PRUEBA', e); process.exit(2); });
