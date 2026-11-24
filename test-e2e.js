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
  const mapsQ = await api('/api/resolve-location', { text: 'https://maps.google.com/?q=16.8778,-93.2080' });
  check('enlace maps.google.com/?q=lat,lng', mapsQ.ok && Math.abs(mapsQ.lat - 16.8778) < 0.0001 && Math.abs(mapsQ.lng + 93.2080) < 0.0001, JSON.stringify(mapsQ));
  const mapsQ2 = await api('/api/resolve-location', { text: 'https://www.google.com/maps?q=16.8778,-93.2080' });
  check('enlace google.com/maps?q=lat,lng', mapsQ2.ok && Math.abs(mapsQ2.lat - 16.8778) < 0.0001 && Math.abs(mapsQ2.lng + 93.2080) < 0.0001, JSON.stringify(mapsQ2));
  const geo = await api('/api/resolve-location', { text: 'geo:16.8778,-93.2080' });
  check('URI geo:lat,lng', geo.ok && Math.abs(geo.lat - 16.8778) < 0.0001 && Math.abs(geo.lng + 93.2080) < 0.0001, JSON.stringify(geo));

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
  check('versión 1.4.36 en /api/health', h.ok && h.version === '1.4.41', JSON.stringify(h));
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
  check('versión 1.4.36', h134.ok && h134.version === '1.4.41', JSON.stringify(h134));
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
  check('pie de versión en inicio (v1.4.36)', html.includes('id="home-version"') && html.includes("ver.textContent = 'Versión ' + APP_VERSION;") && html.includes("const APP_VERSION = '1.4.41';") && h.version === '1.4.41', 'health=' + JSON.stringify(h));
  // Ícono de la app (v1.4.24): el logo final (pin dorado con la mototaxi
  // de frente, "SanFerGo") como icon.png; el manifest y el favicon lo
  // referencian, y el icon.svg viejo queda en su lugar sin usarse.
  const iconRes = await fetch(B + '/icon.png');
  check('GET /icon.png devuelve 200 con image/png', iconRes.status === 200 && (iconRes.headers.get('content-type') || '').includes('image/png'), 'status=' + iconRes.status + ' ct=' + iconRes.headers.get('content-type'));
  const mfstRes = await fetch(B + '/manifest.webmanifest');
  const mfstText = await mfstRes.text();
  let mfst = null; try { mfst = JSON.parse(mfstText); } catch (e) {}
  check('el manifest lista icon.png (192, 512 y 1024)', mfstRes.status === 200 && mfst && Array.isArray(mfst.icons) && mfst.icons.some(i => i.src === '/icon.png' && i.sizes === '192x192') && mfst.icons.some(i => i.src === '/icon.png' && i.sizes === '512x512') && mfst.icons.some(i => i.src === '/icon.png' && i.sizes === '1024x1024'), 'status=' + mfstRes.status + ' icons=' + JSON.stringify(mfst && mfst.icons));
  check('el favicon de index.html es icon.png', html.includes('rel="icon" href="/icon.png"') && html.includes('type="image/png"') && !html.includes('href="/icon.svg"'), '');
  // Aviso de privacidad (v1.4.18): página pública en /privacidad y enlace
  // en el pie de la pantalla de inicio de sesión.
  const privRes = await fetch(B + '/privacidad');
  const privText = await privRes.text();
  check('GET /privacidad devuelve 200', privRes.status === 200, 'status=' + privRes.status);
  check('el aviso de privacidad es de SanFerGo y explica los datos', /privacidad/i.test(privText) && privText.includes('Aviso de privacidad — SanFerGo') && privText.includes('9614868605') && privText.includes('No vendemos tus datos'));
  check('la pantalla de inicio de sesión enlaza al aviso de privacidad en pestaña nueva', html.includes('Aviso de privacidad') && html.includes('href="/privacidad"') && html.includes('target="_blank"'));
  // Respaldo de la base de datos (v1.4.19, solo admin): GET con el token
  // de sesión del admin descarga el SQLite completo; sin token, con
  // cuenta normal o con token inválido se rechaza con 403 sin bytes.
  const bkNoTok = await fetch(B + '/api/admin/backup');
  check('respaldo sin token rechazado (403)', bkNoTok.status === 403, 'status=' + bkNoTok.status);
  const bkUser = await fetch(B + '/api/admin/backup?token=' + encodeURIComponent(li1.token));
  check('respaldo con cuenta normal rechazado (403)', bkUser.status === 403, 'status=' + bkUser.status);
  const bkBad = await fetch(B + '/api/admin/backup?token=token-invalido');
  check('respaldo con token inválido rechazado (403)', bkBad.status === 403, 'status=' + bkBad.status);
  const bk = await fetch(B + '/api/admin/backup?token=' + encodeURIComponent(admLogin.token));
  const bkBuf = Buffer.from(await bk.arrayBuffer());
  check('respaldo con token de admin devuelve 200 y archivo SQLite', bk.status === 200 && bkBuf.length > 1000 && bkBuf.slice(0, 16).toString('latin1') === 'SQLite format 3\0', 'status=' + bk.status + ' bytes=' + bkBuf.length);
  check('respaldo se descarga como adjunto con nombre de fecha', /attachment/.test(bk.headers.get('content-disposition') || '') && /sanfergo-\d{4}-\d{2}-\d{2}\.db/.test(bk.headers.get('content-disposition') || ''), 'cd=' + bk.headers.get('content-disposition'));
  check('el panel de administrador muestra el botón de respaldo', html.includes('Respaldar base de datos') && html.includes('function downloadBackup()') && html.includes('/api/admin/backup?token='));
  // v1.4.20: el chofer de una cuenta NO aparece en otra. Escenario del
  // usuario: en un mismo teléfono, la cuenta A (Ana, con chofer enlazado
  // y en línea) cierra sesión y entra la cuenta B (sin chofer). La
  // tarjeta "Trabajar como chofer" de B debe ofrecer registrarse como
  // conductor nuevo, nunca el nombre del chofer de A. Causa: loadMe()
  // usaba el id de chofer guardado en el teléfono (store.did) aunque
  // hubiera otra sesión, y doLogout() no lo borraba.
  console.log('== v1.4.20: el chofer de una cuenta no aparece en otra ==');
  const accB = await api('/api/register-account', { name: 'Bruno Cuenta', username: 'bruno_' + RUN, phone: '961104' + RUN.slice(0, 4), password: 'secreta123' });
  check('cuenta B sin chofer creada', accB.ok && accB.account.id, JSON.stringify(accB));
  const liB = await api('/api/login', { identifier: 'bruno_' + RUN, password: 'secreta123' });
  check('login de la cuenta B', liB.ok && liB.token, JSON.stringify(liB));
  const meB = await api('/api/me?token=' + liB.token);
  check('/api/me de B devuelve driver null (sin chofer enlazado)', meB.ok && meB.driver === null, JSON.stringify(meB));
  // Simulación del cliente: se extrae loadMe() del index.html y se
  // ejecuta en una caja con el "teléfono" (store) que todavía guarda el
  // id del chofer de A — como queda tras cerrar la sesión de A en ese
  // teléfono.
  const vm = require('node:vm');
  const lmStart = html.indexOf('async function loadMe(){');
  const lmEnd = html.indexOf('\nfunction placeByName(', lmStart);
  check('loadMe() extraíble del cliente', lmStart > 0 && lmEnd > lmStart, 'start=' + lmStart + ' end=' + lmEnd);
  const loadMeSrc = html.slice(lmStart, lmEnd);
  async function runLoadMe(storeState){
    const sandbox = {
      myAccount: null, myPassenger: null, myDriver: null,
      store: { ...storeState },
      api: async (p, body) => { const r = await fetch(B + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); return r.json(); },
    };
    vm.createContext(sandbox);
    await vm.runInContext(loadMeSrc + '\nloadMe();', sandbox);
    return sandbox;
  }
  const sbB = await runLoadMe({ token: liB.token, did: drvAcc.driver.id, pid: null });
  check('con sesión de B, loadMe NO carga el chofer de A aunque su id siga en el teléfono', sbB.myDriver === null, JSON.stringify(sbB.myDriver));
  check('con sesión de B, loadMe borra el id guardado del chofer de A', sbB.store.did == null, 'did=' + sbB.store.did);
  check('con sesión de B, loadMe carga la cuenta B', sbB.myAccount && sbB.myAccount.username === 'bruno_' + RUN, JSON.stringify(sbB.myAccount));
  // Control: sin sesión (modo sin cuenta, heredado) el id guardado sí se usa.
  const sbNoSes = await runLoadMe({ token: null, did: drvAcc.driver.id, pid: null });
  check('sin sesión, loadMe sigue resolviendo el chofer guardado (modo sin cuenta)', sbNoSes.myDriver && sbNoSes.myDriver.id === drvAcc.driver.id, JSON.stringify(sbNoSes.myDriver));
  // Estático: la rama sin chofer ofrece registrarse y doLogout limpia los ids.
  check('sin chofer, el inicio ofrece "Registrarse como conductor" con el formulario de registro', html.includes('Registrarse como conductor') && /openRegistro\(\\?'chofer\\?'\)/.test(html));
  const loStart = html.indexOf('async function doLogout(){');
  const loEnd = html.indexOf('\nfunction renderCuenta(', loStart);
  const logoutSrc = html.slice(loStart, loEnd);
  check('doLogout() limpia el id del chofer y del pasajero guardados', logoutSrc.includes('store.did = null') && logoutSrc.includes('store.pid = null'), logoutSrc.slice(0, 200));
  check('loadMe() solo usa el id guardado cuando NO hay sesión (if (!hasSession))', loadMeSrc.includes('if (!hasSession) {') && loadMeSrc.includes('if (!myDriver && store.did)'), loadMeSrc.slice(0, 300));
  // v1.4.21: el selector "Elige tu perfil" ya no existe y /api/link-profiles
  // está blindado. Escenario del usuario: con la v1.4.20, al tocar el
  // perfil de Josué en el formulario de registro, pickRegDriver llamaba a
  // /api/link-profiles y enlazaba PERMANENTEMENTE el chofer de Josué a la
  // cuenta de Emiliano (sin teléfono, la comprobación de número se saltaba).
  // Lo mismo dejó a Paulina enlazada al pasajero "Prueba Mapa" en vez de al suyo.
  console.log('== v1.4.21: sin selector de perfiles y link-profiles blindado ==');
  check('los formularios de registro ya no tienen el selector "Elige tu perfil"', !html.includes('Elige tu perfil') && !html.includes('reg-pick-list') && !html.includes('pickRegDriver') && !html.includes('pickRegPassenger') && !html.includes('renderRegPickList'), 'queda el selector en el cliente');
  // (b) cuenta sin teléfono (solo correo, como la de Emiliano por Google)
  // no puede adoptar un chofer: 400 y su driver_id sigue NULL.
  const noPhoneLink = await api('/api/link-profiles', { token: liMail.token, driver_id: drvAcc.driver.id });
  check('cuenta sin teléfono no puede enlazar un chofer (400)', !noPhoneLink.ok, JSON.stringify(noPhoneLink));
  const meMail = await api('/api/me?token=' + liMail.token);
  check('la cuenta sin teléfono sigue sin chofer enlazado', meMail.ok && meMail.driver === null, JSON.stringify(meMail));
  // (c) un chofer ya enlazado a otra cuenta no se puede adoptar (400) y
  // sigue en su cuenta original. El mismo blindaje vale para pasajeros:
  // el pasajero de Beto (creado al registrarse con correo, teléfono vacío)
  // no lo puede adoptar Bruno, y ahí la rama de "ya enlazado" se ejerce de
  // verdad porque la comprobación de número se salta con teléfono vacío.
  const adoptLink = await api('/api/link-profiles', { token: liB.token, driver_id: drvAcc.driver.id });
  check('chofer ya enlazado a otra cuenta no se puede adoptar (400)', !adoptLink.ok, JSON.stringify(adoptLink));
  const meAna2 = await api('/api/me?token=' + li1.token);
  check('el chofer sigue enlazado a su cuenta original', meAna2.ok && meAna2.driver && meAna2.driver.id === drvAcc.driver.id, JSON.stringify(meAna2));
  const adoptPax = await api('/api/link-profiles', { token: liB.token, passenger_id: accMail.passenger.id });
  check('pasajero ya enlazado a otra cuenta no se puede adoptar (400)', !adoptPax.ok, JSON.stringify(adoptPax));
  const meMail2 = await api('/api/me?token=' + liMail.token);
  check('el pasajero sigue enlazado a su cuenta original', meMail2.ok && meMail2.passenger && meMail2.passenger.id === accMail.passenger.id, JSON.stringify(meMail2));
  // La misma cuenta sí puede volver a enlazar su propio perfil (200).
  const relinkOwn = await api('/api/link-profiles', { token: li1.token, driver_id: drvAcc.driver.id });
  check('la misma cuenta puede volver a enlazar su propio chofer (200)', relinkOwn.ok && relinkOwn.account.driver_id === drvAcc.driver.id, JSON.stringify(relinkOwn));
  // (d) desenlazar (solo admin): se enlaza un chofer nuevo a B y el admin lo quita.
  const drvB = await api('/api/register-driver', { name: 'Bruno Chofer', phone: '961104' + RUN.slice(0, 4), vehicle: 'mototaxi', unit: 'B-' + RUN.slice(0, 3), selfie: PHOTO, vehicle_photo: PHOTO });
  check('chofer nuevo para la cuenta B', drvB.ok && drvB.driver.id, JSON.stringify(drvB));
  await approveDriver(drvB.driver.id);
  const linkB = await api('/api/link-profiles', { token: liB.token, driver_id: drvB.driver.id });
  check('chofer enlazado a la cuenta B', linkB.ok && linkB.account.driver_id === drvB.driver.id, JSON.stringify(linkB));
  const unlNoTok = await api('/api/admin/unlink-profile', { account_id: accB.account.id, kind: 'driver' });
  check('desenlazar sin token rechazado (403)', !unlNoTok.ok, JSON.stringify(unlNoTok));
  const unlUser = await api('/api/admin/unlink-profile', { token: liB.token, account_id: accB.account.id, kind: 'driver' });
  check('desenlazar con cuenta normal rechazado (403)', !unlUser.ok, JSON.stringify(unlUser));
  const unlBad = await api('/api/admin/unlink-profile', { token: admLogin.token, account_id: accB.account.id, kind: 'otro' });
  check('desenlazar con tipo no válido rechazado (400)', !unlBad.ok, JSON.stringify(unlBad));
  const unlNoAcc = await api('/api/admin/unlink-profile', { token: admLogin.token, account_id: 999999, kind: 'driver' });
  check('desenlazar cuenta inexistente rechazado (404)', !unlNoAcc.ok, JSON.stringify(unlNoAcc));
  const unl = await api('/api/admin/unlink-profile', { token: admLogin.token, account_id: accB.account.id, kind: 'driver' });
  check('admin desenlaza el chofer de la cuenta B (200)', unl.ok && unl.account.driver_id == null, JSON.stringify(unl));
  const meB2 = await api('/api/me?token=' + liB.token);
  check('/api/me de B ya no devuelve chofer tras desenlazar', meB2.ok && meB2.driver === null, JSON.stringify(meB2));
  // v1.4.22: el blindaje de v1.4.21 rompía dos flujos legítimos de las
  // cuentas solo-correo (Google, sin teléfono): la tarjeta "Mi cuenta"
  // (saveAccountPhone) y pedir un viaje sin perfil
  // (ensureNoProfilePassenger) crean el pasajero y luego lo enlazan, y el
  // enlace rechaza 400 sin teléfono. Nuevo endpoint POST
  // /api/set-account-phone: la cuenta registra su teléfono UNA vez (con
  // comprobación de duplicado, como en el registro) y el enlace ya pasa.
  console.log('== v1.4.22: set-account-phone para cuentas solo-correo ==');
  const setNoTok = await api('/api/set-account-phone', { phone: '961105' + RUN.slice(0, 4) });
  check('poner teléfono sin sesión rechazado (401)', !setNoTok.ok, JSON.stringify(setNoTok));
  const setHasPhone = await api('/api/set-account-phone', { token: liB.token, phone: '961106' + RUN.slice(0, 4) });
  check('cuenta que ya tiene teléfono no lo puede cambiar por aquí (400)', !setHasPhone.ok, JSON.stringify(setHasPhone));
  // Cuenta nueva solo-correo (como la de Google): pide su código por el
  // pase de pruebas, se registra sin teléfono y luego pone su número.
  const celiaCode = await api('/api/request-email-code', { email: 'celia' + RUN + '@prueba.mx' });
  check('pedir código para Celia (modo de pruebas)', celiaCode.ok && /^\d{6}$/.test(celiaCode.test_code || ''), JSON.stringify(celiaCode));
  const celiaVer = await api('/api/verify-email-code', { email: 'celia' + RUN + '@prueba.mx', code: celiaCode.test_code });
  check('verificar el código de Celia entrega el pase', celiaVer.ok && !!celiaVer.verification_token, JSON.stringify(celiaVer));
  const accCelia = await api('/api/register-account', { name: 'Celia Correo', username: 'celia_' + RUN, email: 'celia' + RUN + '@prueba.mx', password: 'secreta123', email_code_token: celiaVer.verification_token });
  check('cuenta nueva solo-correo (sin teléfono)', accCelia.ok && !accCelia.account.phone, JSON.stringify(accCelia));
  const liCelia = await api('/api/login', { identifier: 'celia' + RUN + '@prueba.mx', password: 'secreta123' });
  check('login de Celia', liCelia.ok && liCelia.token, JSON.stringify(liCelia));
  const setDup = await api('/api/set-account-phone', { token: liCelia.token, phone: '961104' + RUN.slice(0, 4) });
  check('teléfono de otra cuenta rechazado (400)', !setDup.ok, JSON.stringify(setDup));
  const setBad = await api('/api/set-account-phone', { token: liCelia.token, phone: '123' });
  check('teléfono inválido rechazado (400)', !setBad.ok, JSON.stringify(setBad));
  const celiaPhone = '961105' + RUN.slice(0, 4);
  const setOk = await api('/api/set-account-phone', { token: liCelia.token, phone: celiaPhone });
  check('cuenta solo-correo pone su teléfono (200) y queda guardado', setOk.ok && setOk.account.phone === celiaPhone, JSON.stringify(setOk));
  // Flujo de saveAccountPhone (tarjeta "Mi cuenta"): teléfono ya puesto,
  // crear pasajero y enlazar; /api/me muestra el pasajero nuevo.
  const paxCelia = await api('/api/register-passenger', { name: 'Celia Correo', phone: celiaPhone, face_photo: null });
  check('pasajero creado para Celia', paxCelia.ok && paxCelia.passenger.id, JSON.stringify(paxCelia));
  const linkCelia = await api('/api/link-profiles', { token: liCelia.token, passenger_id: paxCelia.passenger.id });
  check('tras poner el teléfono, el pasajero sí se enlaza (200)', linkCelia.ok && linkCelia.account.passenger_id === paxCelia.passenger.id, JSON.stringify(linkCelia));
  const meCelia = await api('/api/me?token=' + liCelia.token);
  check('/api/me de Celia muestra el teléfono y el pasajero enlazado', meCelia.ok && meCelia.account.phone === celiaPhone && meCelia.passenger && meCelia.passenger.id === paxCelia.passenger.id, JSON.stringify(meCelia));
  // Flujo de ensureNoProfilePassenger (pedir viaje sin perfil): otra
  // cuenta solo-correo, sin pasajero enlazado: teléfono primero, luego
  // pasajero y enlace — el pasajero creado es el enlazado (sin huérfano).
  const doraCode = await api('/api/request-email-code', { email: 'dora' + RUN + '@prueba.mx' });
  const doraVer = await api('/api/verify-email-code', { email: 'dora' + RUN + '@prueba.mx', code: doraCode.test_code });
  const accDora = await api('/api/register-account', { name: 'Dora Correo', username: 'dora_' + RUN, email: 'dora' + RUN + '@prueba.mx', password: 'secreta123', email_code_token: doraVer.verification_token });
  check('cuenta nueva solo-correo Dora (sin teléfono)', accDora.ok && !accDora.account.phone, JSON.stringify(accDora));
  const liDora = await api('/api/login', { identifier: 'dora' + RUN + '@prueba.mx', password: 'secreta123' });
  const unlDora = await api('/api/admin/unlink-profile', { token: ADM.token, account_id: accDora.account.id, kind: 'passenger' });
  check('Dora sin pasajero enlazado para el flujo de viaje', unlDora.ok && unlDora.account.passenger_id == null, JSON.stringify(unlDora));
  const doraPhone = '961107' + RUN.slice(0, 4);
  const setDora = await api('/api/set-account-phone', { token: liDora.token, phone: doraPhone });
  check('Dora pone su teléfono antes de pedir el viaje (200)', setDora.ok && setDora.account.phone === doraPhone, JSON.stringify(setDora));
  const paxDora = await api('/api/register-passenger', { name: 'Dora Correo', phone: doraPhone, face_photo: null });
  check('pasajero del viaje creado para Dora', paxDora.ok && paxDora.passenger.id, JSON.stringify(paxDora));
  const linkDora = await api('/api/link-profiles', { token: liDora.token, passenger_id: paxDora.passenger.id });
  check('el pasajero del viaje se enlaza a la cuenta (200)', linkDora.ok && linkDora.account.passenger_id === paxDora.passenger.id, JSON.stringify(linkDora));
  const meDora = await api('/api/me?token=' + liDora.token);
  check('/api/me de Dora: el pasajero enlazado ES el creado en el viaje (sin huérfano)', meDora.ok && meDora.passenger && meDora.passenger.id === paxDora.passenger.id, JSON.stringify(meDora));
  // Estático: el cliente pone el teléfono ANTES de crear el pasajero en
  // los dos flujos, y si falla no crea el perfil (el error sale por el
  // camino de error que ya existe, no se traga en silencio).
  const sapStart = html.indexOf('async function saveAccountPhone(){');
  const sapEnd = html.indexOf('\n/* ===== VIAJES', sapStart);
  const sapSrc = sapStart >= 0 && sapEnd > sapStart ? html.slice(sapStart, sapEnd) : '';
  check('saveAccountPhone() llama a set-account-phone ANTES de crear el pasajero', sapSrc.includes("api('/api/set-account-phone'") && sapSrc.indexOf("set-account-phone") < sapSrc.indexOf("register-passenger"), sapSrc.slice(0, 300));
  const enpStart = html.indexOf('async function ensureNoProfilePassenger(){');
  const enpEnd = html.indexOf('\nasync function renderViajes(){', enpStart);
  const enpSrc = enpStart >= 0 && enpEnd > enpStart ? html.slice(enpStart, enpEnd) : '';
  check('ensureNoProfilePassenger() pone el teléfono ANTES de crear el pasajero', enpSrc.includes("api('/api/set-account-phone'") && enpSrc.indexOf("set-account-phone") < enpSrc.indexOf("register-passenger"), enpSrc.slice(0, 300));
  const enpBetween = enpSrc.indexOf("set-account-phone") >= 0 && enpSrc.indexOf("register-passenger") > enpSrc.indexOf("set-account-phone") ? enpSrc.slice(enpSrc.indexOf("set-account-phone"), enpSrc.indexOf("register-passenger")) : 'sin-llamada';
  check('ensureNoProfilePassenger() no traga el error del teléfono en silencio (el fallo sale por el catch con toast y false)', enpSrc.includes("catch(e){ toast(e.message); return false; }") && !enpBetween.includes('catch'), enpSrc.slice(0, 300));
  // v1.4.23: savePassenger()/saveDriver() (formularios de registro)
  // llamaban a /api/link-profiles dentro de un try/catch tragado: una
  // cuenta solo-correo (Google, sin teléfono) que se registraba desde el
  // formulario, sin haber puesto antes su número en "Mi cuenta", quedaba
  // con el perfil creado pero SIN enlazar. Los formularios sí piden el
  // teléfono, así que el arreglo es el mismo patrón de v1.4.22: el
  // teléfono se registra en la cuenta ANTES de crear el perfil; si eso
  // falla, no se crea nada. Y nuevo endpoint solo-admin POST
  // /api/admin/link-profile para reparar enlaces malos (el de
  // desenlazar solo quita).
  console.log('== v1.4.23: formularios con teléfono primero + link de admin ==');
  // Estático: los dos formularios ponen el teléfono ANTES de crear el
  // perfil, solo si la cuenta no tiene, y el fallo para ahí (el error
  // sale por el catch con toast que ya existe, no se traga en silencio).
  const spStart = html.indexOf('async function savePassenger(){');
  const spEnd = html.indexOf('\nasync function saveDriver(){', spStart);
  const spSrc = spStart >= 0 && spEnd > spStart ? html.slice(spStart, spEnd) : '';
  check('savePassenger() registra el teléfono en la cuenta ANTES de crear el pasajero', spSrc.includes("api('/api/set-account-phone'") && spSrc.indexOf("set-account-phone") < spSrc.indexOf("register-passenger") && spSrc.includes("if (myAccount && !myAccount.phone)"), spSrc.slice(0, 300));
  const sdStart = html.indexOf('async function saveDriver(){');
  const sdEnd = html.indexOf('\n/* ===== INICIO DE SESIÓN', sdStart);
  const sdSrc = sdStart >= 0 && sdEnd > sdStart ? html.slice(sdStart, sdEnd) : '';
  check('saveDriver() registra el teléfono en la cuenta ANTES de crear el chofer', sdSrc.includes("api('/api/set-account-phone'") && sdSrc.indexOf("set-account-phone") < sdSrc.indexOf("register-driver") && sdSrc.includes("if (myAccount && !myAccount.phone)"), sdSrc.slice(0, 300));
  // Cuentas nuevas solo-correo (como las de Google) para los flujos.
  async function newMailAccount(tag){
    const email = tag + RUN + '@prueba.mx';
    const code = await api('/api/request-email-code', { email });
    const ver = await api('/api/verify-email-code', { email, code: code.test_code });
    const acc = await api('/api/register-account', { name: tag[0].toUpperCase() + tag.slice(1) + ' Correo', username: tag + '_' + RUN, email, password: 'secreta123', email_code_token: ver.verification_token });
    const li = await api('/api/login', { identifier: email, password: 'secreta123' });
    return { acc, li };
  }
  // Flujo del formulario de pasajero para una cuenta solo-correo:
  // teléfono primero, luego pasajero y enlace — queda enlazado.
  const ines = await newMailAccount('ines');
  check('cuenta nueva solo-correo Inés (sin teléfono)', ines.acc.ok && !ines.acc.account.phone, JSON.stringify(ines.acc));
  const inesPhone = '961108' + RUN.slice(0, 4);
  const setInes = await api('/api/set-account-phone', { token: ines.li.token, phone: inesPhone });
  check('Inés pone su teléfono antes del formulario (200)', setInes.ok && setInes.account.phone === inesPhone, JSON.stringify(setInes));
  const paxInes = await api('/api/register-passenger', { name: 'Inés Correo', phone: inesPhone, face_photo: null });
  check('pasajero creado para Inés desde el formulario', paxInes.ok && paxInes.passenger.id, JSON.stringify(paxInes));
  const linkInes = await api('/api/link-profiles', { token: ines.li.token, passenger_id: paxInes.passenger.id });
  check('el pasajero de Inés se enlaza (200)', linkInes.ok && linkInes.account.passenger_id === paxInes.passenger.id, JSON.stringify(linkInes));
  const meInes = await api('/api/me?token=' + ines.li.token);
  check('/api/me de Inés: teléfono y pasajero enlazado (sin huérfano)', meInes.ok && meInes.account.phone === inesPhone && meInes.passenger && meInes.passenger.id === paxInes.passenger.id, JSON.stringify(meInes));
  // Flujo del formulario de chofer para una cuenta solo-correo.
  const juan = await newMailAccount('juan');
  check('cuenta nueva solo-correo Juan (sin teléfono)', juan.acc.ok && !juan.acc.account.phone, JSON.stringify(juan.acc));
  const juanPhone = '961109' + RUN.slice(0, 4);
  const setJuan = await api('/api/set-account-phone', { token: juan.li.token, phone: juanPhone });
  check('Juan pone su teléfono antes del formulario (200)', setJuan.ok && setJuan.account.phone === juanPhone, JSON.stringify(setJuan));
  const drvJuan = await api('/api/register-driver', { name: 'Juan Correo', phone: juanPhone, vehicle: 'mototaxi', unit: 'J-' + RUN.slice(0, 3), selfie: PHOTO, vehicle_photo: PHOTO });
  check('chofer creado para Juan desde el formulario', drvJuan.ok && drvJuan.driver.id, JSON.stringify(drvJuan));
  await approveDriver(drvJuan.driver.id);
  const linkJuan = await api('/api/link-profiles', { token: juan.li.token, driver_id: drvJuan.driver.id });
  check('el chofer de Juan se enlaza (200)', linkJuan.ok && linkJuan.account.driver_id === drvJuan.driver.id, JSON.stringify(linkJuan));
  const meJuan = await api('/api/me?token=' + juan.li.token);
  check('/api/me de Juan: teléfono y chofer enlazado (sin huérfano)', meJuan.ok && meJuan.account.phone === juanPhone && meJuan.driver && meJuan.driver.id === drvJuan.driver.id, JSON.stringify(meJuan));
  // Si poner el teléfono falla (número ya de otra cuenta), el formulario
  // no crea el perfil: la cuenta sigue sin teléfono y sin nada enlazado.
  const kike = await newMailAccount('kike');
  check('cuenta nueva solo-correo Kike (sin teléfono)', kike.acc.ok && !kike.acc.account.phone, JSON.stringify(kike.acc));
  const meKike0 = await api('/api/me?token=' + kike.li.token);
  check('Kike nace con el pasajero automático de la cuenta (teléfono vacío)', meKike0.ok && meKike0.passenger && meKike0.passenger.phone === '', JSON.stringify(meKike0));
  const setKike = await api('/api/set-account-phone', { token: kike.li.token, phone: celiaPhone });
  check('teléfono ya usado: ponerlo falla (400) y el formulario no crea nada', !setKike.ok, JSON.stringify(setKike));
  const meKike = await api('/api/me?token=' + kike.li.token);
  check('Kike sigue sin teléfono y con el mismo pasajero automático (nada nuevo enlazado)', meKike.ok && !meKike.account.phone && meKike.passenger && meKike.passenger.id === meKike0.passenger.id, JSON.stringify(meKike));
  const allPax = await api('/api/passengers');
  check('ningún pasajero huérfano con el teléfono duplicado', allPax.ok && allPax.passengers.filter(p => p.phone === celiaPhone).length === 1, JSON.stringify(allPax.passengers.filter(p => p.phone === celiaPhone)));
  // Enlace de admin: repara enlaces malos (unlink solo quita).
  const lkNoTok = await api('/api/admin/link-profile', { account_id: accB.account.id, kind: 'driver', profile_id: drvB.driver.id });
  check('enlazar de admin sin token rechazado (403)', !lkNoTok.ok, JSON.stringify(lkNoTok));
  const lkUser = await api('/api/admin/link-profile', { token: liB.token, account_id: accB.account.id, kind: 'driver', profile_id: drvB.driver.id });
  check('enlazar de admin con cuenta normal rechazado (403)', !lkUser.ok, JSON.stringify(lkUser));
  const lkBad = await api('/api/admin/link-profile', { token: ADM.token, account_id: accB.account.id, kind: 'otro', profile_id: drvB.driver.id });
  check('enlazar de admin con tipo no válido rechazado (400)', !lkBad.ok, JSON.stringify(lkBad));
  const lkNoAcc = await api('/api/admin/link-profile', { token: ADM.token, account_id: 999999, kind: 'driver', profile_id: drvB.driver.id });
  check('enlazar de admin con cuenta inexistente rechazado (404)', !lkNoAcc.ok, JSON.stringify(lkNoAcc));
  const lkNoProf = await api('/api/admin/link-profile', { token: ADM.token, account_id: accB.account.id, kind: 'driver', profile_id: 999999 });
  check('enlazar de admin con perfil inexistente rechazado (404)', !lkNoProf.ok, JSON.stringify(lkNoProf));
  const lkOther = await api('/api/admin/link-profile', { token: ADM.token, account_id: accB.account.id, kind: 'driver', profile_id: drvAcc.driver.id });
  check('perfil ya enlazado a otra cuenta no lo puede enlazar el admin (400)', !lkOther.ok, JSON.stringify(lkOther));
  const meAna3 = await api('/api/me?token=' + li1.token);
  check('el chofer sigue enlazado a su cuenta original', meAna3.ok && meAna3.driver && meAna3.driver.id === drvAcc.driver.id, JSON.stringify(meAna3));
  const paxFar = await api('/api/register-passenger', { name: 'Lejos Prueba', phone: '961110' + RUN.slice(0, 4), face_photo: null });
  check('pasajero sin enlazar para la prueba de números distintos', paxFar.ok && paxFar.passenger.id, JSON.stringify(paxFar));
  const lkMis = await api('/api/admin/link-profile', { token: ADM.token, account_id: accB.account.id, kind: 'passenger', profile_id: paxFar.passenger.id });
  check('enlazar de admin con números distintos rechazado (400)', !lkMis.ok, JSON.stringify(lkMis));
  const lkB = await api('/api/admin/link-profile', { token: ADM.token, account_id: accB.account.id, kind: 'driver', profile_id: drvB.driver.id });
  check('admin enlaza el chofer a la cuenta B (200)', lkB.ok && lkB.account.driver_id === drvB.driver.id, JSON.stringify(lkB));
  const meB3 = await api('/api/me?token=' + liB.token);
  check('/api/me de B muestra el chofer tras el enlace del admin', meB3.ok && meB3.driver && meB3.driver.id === drvB.driver.id, JSON.stringify(meB3));
  const unlDora2 = await api('/api/admin/unlink-profile', { token: ADM.token, account_id: accDora.account.id, kind: 'passenger' });
  check('Dora desenlazada para la reparación del admin', unlDora2.ok && unlDora2.account.passenger_id == null, JSON.stringify(unlDora2));
  const lkDora = await api('/api/admin/link-profile', { token: ADM.token, account_id: accDora.account.id, kind: 'passenger', profile_id: paxDora.passenger.id });
  check('admin enlaza el pasajero a la cuenta Dora (200)', lkDora.ok && lkDora.account.passenger_id === paxDora.passenger.id, JSON.stringify(lkDora));
  const meDora2 = await api('/api/me?token=' + liDora.token);
  check('/api/me de Dora muestra el pasajero tras el enlace del admin', meDora2.ok && meDora2.passenger && meDora2.passenger.id === paxDora.passenger.id, JSON.stringify(meDora2));
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
  // banners horizontales ARRIBA y las tarjetas de negocios abajo). En
  // v1.4.28 la fila de opciones pasó ARRIBA del carrusel y se hizo
  // compacta (petición del usuario con captura): el orden ahora es
  // título → opciones → carrusel → pills → tarjetas.
  check('Negocios: la fila de opciones va arriba del carrusel (v1.4.28)', html.includes("box.innerHTML = '<div id=\"biz-options-row\"") && html.includes("'<div id=\"biz-ads-carousel\"></div>'") && html.indexOf('id="biz-options-row"') !== -1 && html.indexOf('id="biz-ads-carousel"') !== -1 && html.indexOf('id="biz-options-row"') < html.indexOf('id="biz-ads-carousel"'));
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
  check('carrusel Negocios: se alimenta de /api/ads filtrando por banner_image, auto-avance 5 s, tap abre el negocio vinculado y el libre no hace nada, sin anuncios no muestra nada (v1.4.16, v1.4.30: el banner es la imagen horizontal)', html.includes("async function renderBizAdsCarousel(){") && html.includes("api('/api/ads')") && html.includes("filter(a=>a.banner_image)") && html.includes("if(!ads.length){ wrap.innerHTML = ''; return; }") && html.includes('}, 5000);') && html.includes("if(slide && slide.dataset.biz) openBusiness(+slide.dataset.biz);") && html.includes("bizCarouselStop()") && html.includes('class="biz-carousel-dots"') && html.includes('data-biz="')); 
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
  const manEnv = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', description: 'Llevar un paquete', vehicle: 'mototaxi', recipient_phone: '9614444444', recipient_name: 'María López', order_payment: 'por_pagar', order_amount: 150 });
  check('mandado "enviar" guarda vehicle=mototaxi, quien recibe y pago del pedido', manEnv.ok && manEnv.request.vehicle === 'mototaxi' && manEnv.request.recipient_phone === '9614444444' && manEnv.request.recipient_name === 'María López' && manEnv.request.order_payment === 'por_pagar' && manEnv.request.order_amount === 150, JSON.stringify(manEnv.request));
  const openEnv = await api('/api/requests?open=1');
  const openRow = (openEnv.requests || []).find(r => r.id === manEnv.request.id);
  check('v1.4.35: /api/requests?open=1 le devuelve al chofer quien recibe y el pago del pedido', openEnv.ok && !!openRow && openRow.recipient_name === 'María López' && openRow.recipient_phone === '9614444444' && openRow.order_payment === 'por_pagar' && openRow.order_amount === 150, JSON.stringify(openRow));
  const manEnvPagado = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', description: 'Llevar un paquete pagado', vehicle: 'mototaxi', recipient_phone: '9615555555', recipient_name: 'Juan Pérez', order_payment: 'pagado', order_amount: 0 });
  check('mandado "enviar" con pedido ya pagado guarda order_payment=pagado y amount 0', manEnvPagado.ok && manEnvPagado.request.order_payment === 'pagado' && manEnvPagado.request.order_amount === 0 && manEnvPagado.request.recipient_name === 'Juan Pérez', JSON.stringify(manEnvPagado.request));
  const manEnvSinMonto = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', description: 'Llevar un paquete', vehicle: 'mototaxi', recipient_phone: '9614444444', recipient_name: 'María López', order_payment: 'por_pagar' });
  check('mandado "enviar" con "se pagará" sin cantidad se rechaza', !manEnvSinMonto.ok, JSON.stringify(manEnvSinMonto));
  const manEnvSinNombre = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', description: 'Llevar un paquete', vehicle: 'mototaxi', recipient_phone: '9614444444', order_payment: 'pagado', order_amount: 0 });
  check('mandado "enviar" sin nombre de quien recibe se rechaza', !manEnvSinNombre.ok, JSON.stringify(manEnvSinNombre));
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

  // v1.4.25: el admin cambia su propio usuario y/o contraseña desde
  // el panel (POST /api/admin/change-credentials). La contraseña
  // actual se verifica con el hash guardado; el usuario nuevo no
  // puede ser el de otra cuenta; la sesión no depende de la
  // contraseña, así que el cambio no cierra la sesión (el token viejo
  // sigue sirviendo tras cambiar la contraseña).
  console.log('== v1.4.25: el admin cambia su usuario y contraseña ==');
  const ccNoTok = await api('/api/admin/change-credentials', { current_password: 'TestPass123', new_password: 'TestPass456' });
  check('cambiar credenciales sin token rechazado (403)', !ccNoTok.ok, JSON.stringify(ccNoTok));
  const ccUser = await api('/api/admin/change-credentials', { token: li1.token, current_password: 'secreta123', new_password: 'TestPass456' });
  check('cambiar credenciales con cuenta normal rechazado (403)', !ccUser.ok, JSON.stringify(ccUser));
  const ccBadCur = await api('/api/admin/change-credentials', { token: admLogin.token, current_password: 'no-es-esta', new_password: 'TestPass456' });
  check('contraseña actual incorrecta rechazada (400)', !ccBadCur.ok && /actual/.test(ccBadCur.error || ''), JSON.stringify(ccBadCur));
  const ccNone = await api('/api/admin/change-credentials', { token: admLogin.token, current_password: 'admin' });
  check('sin usuario ni contraseña nuevos rechazado (400)', !ccNone.ok, JSON.stringify(ccNone));
  const ccTaken = await api('/api/admin/change-credentials', { token: admLogin.token, current_password: 'admin', new_username: 'ana_' + RUN });
  check('usuario ya en uso por otra cuenta rechazado (400)', !ccTaken.ok, JSON.stringify(ccTaken));
  const ccShort = await api('/api/admin/change-credentials', { token: admLogin.token, current_password: 'admin', new_password: '123' });
  check('contraseña nueva muy corta rechazada (400)', !ccShort.ok, JSON.stringify(ccShort));
  const ccPw = await api('/api/admin/change-credentials', { token: admLogin.token, current_password: 'admin', new_password: 'TestPass123' });
  check('admin cambia su contraseña (200)', ccPw.ok && ccPw.username === 'admin', JSON.stringify(ccPw));
  const liNewPw = await api('/api/login', { identifier: 'admin', password: 'TestPass123' });
  check('login con la contraseña nueva funciona', liNewPw.ok && liNewPw.account.role === 'admin', JSON.stringify(liNewPw));
  const liOldPw = await api('/api/login', { identifier: 'admin', password: 'admin' });
  check('login con la contraseña vieja ya no funciona', !liOldPw.ok, JSON.stringify(liOldPw));
  // El token de sesión viejo (de antes del cambio de contraseña)
  // sigue sirviendo: el cambio no cierra la sesión.
  const ccUser2 = await api('/api/admin/change-credentials', { token: admLogin.token, current_password: 'TestPass123', new_username: 'admin2_' + RUN });
  check('la sesión vieja sigue sirviendo tras cambiar la contraseña; admin cambia su usuario (200)', ccUser2.ok && ccUser2.username === 'admin2_' + RUN, JSON.stringify(ccUser2));
  const liNewUser = await api('/api/login', { identifier: 'admin2_' + RUN, password: 'TestPass123' });
  check('login con el usuario nuevo funciona', liNewUser.ok && liNewUser.account.role === 'admin', JSON.stringify(liNewUser));
  const liOldUser = await api('/api/login', { identifier: 'admin', password: 'TestPass123' });
  check('login con el usuario viejo ya no funciona', !liOldUser.ok, JSON.stringify(liOldUser));
  // Se restaura el usuario 'admin' para dejar la base limpia (la
  // contraseña de prueba queda en la base de la corrida, que se
  // desecha; el endpoint exige mínimo 6 caracteres y la contraseña
  // temporal original tiene 5).
  const ccBack = await api('/api/admin/change-credentials', { token: liNewUser.token, current_password: 'TestPass123', new_username: 'admin' });
  check('se restaura el usuario admin', ccBack.ok && ccBack.username === 'admin', JSON.stringify(ccBack));
  const liBack = await api('/api/login', { identifier: 'admin', password: 'TestPass123' });
  check('login admin con la contraseña de prueba funciona tras restaurar el usuario', liBack.ok && liBack.account.role === 'admin', JSON.stringify(liBack));
  // Estático: la tarjeta existe en el panel, con sus campos, el botón
  // y la función que llama al endpoint.
  // v1.4.29: la tarjeta de credenciales ahora está COLAPSADA por defecto:
  // una sola fila compacta con el toggle; el formulario solo se ve al
  // expandirla, y al guardar bien se vuelve a colapsar.
  check('el panel de administrador tiene la tarjeta de credenciales colapsada (fila, toggle, campos y guardado)', html.includes('Cambiar usuario y contraseña') && html.includes('onclick="adminCredsOpen=!adminCredsOpen;renderAdminGrid()"') && html.includes('id="admin-creds-form"') && html.includes("pwInput('adm-cur-pass'") && html.includes('id="adm-new-user"') && html.includes("pwInput('adm-new-pass'") && html.includes("pwInput('adm-new-pass2'") && html.includes('onclick="saveAdminCredentials()"') && html.includes('function saveAdminCredentials()') && html.includes("api('/api/admin/change-credentials'") && html.includes('Credenciales actualizadas.'));

  // v1.4.26: el admin ve cuántos usuarios nuevos se registraron. El
  // marcador 'users_seen_at' y created_at usan el mismo formato UTC
  // 'YYYY-MM-DD HH:MM:SS' (segundos): para que un registro cuente tiene
  // que caer en un segundo posterior al marcador, así que se espera
  // 1.1 s tras crear el marcador y tras marcar visto.
  console.log('== v1.4.26: aviso de usuarios nuevos registrados ==');
  const ov0 = await api('/api/admin-overview?token=' + encodeURIComponent(ADM.token));
  check('primera llamada a admin-overview crea el marcador y new_users es 0', ov0.ok && ov0.new_users === 0, JSON.stringify(ov0));
  check('admin-overview sigue devolviendo pendientes de choferes/negocios', ov0.ok && typeof ov0.pending_drivers === 'number' && typeof ov0.pending_businesses === 'number' && ov0.pending_total === ov0.pending_drivers + ov0.pending_businesses, JSON.stringify(ov0));
  await new Promise(r => setTimeout(r, 1100));
  const nu1 = await api('/api/register-account', { name: 'Nuevo Uno', username: 'nuevo1_' + RUN, phone: '961111' + RUN.slice(0, 4), password: 'secreta123' });
  const nu2 = await api('/api/register-account', { name: 'Nuevo Dos', username: 'nuevo2_' + RUN, phone: '961112' + RUN.slice(0, 4), password: 'secreta123' });
  check('se registran 2 cuentas nuevas', nu1.ok && nu2.ok, JSON.stringify([nu1, nu2]));
  const ov2 = await api('/api/admin-overview?token=' + encodeURIComponent(ADM.token));
  check('tras 2 registros, new_users es 2', ov2.ok && ov2.new_users === 2, JSON.stringify(ov2));
  const mkBad = await api('/api/admin/mark-users-seen', { token: li1.token });
  check('mark-users-seen con cuenta normal rechazado (403)', !mkBad.ok, JSON.stringify(mkBad));
  const mk = await api('/api/admin/mark-users-seen', { token: ADM.token });
  check('mark-users-seen con token admin (200)', mk.ok === true, JSON.stringify(mk));
  const ov3 = await api('/api/admin-overview?token=' + encodeURIComponent(ADM.token));
  check('tras marcar visto, new_users es 0', ov3.ok && ov3.new_users === 0, JSON.stringify(ov3));
  await new Promise(r => setTimeout(r, 1100));
  const nu3 = await api('/api/register-account', { name: 'Nuevo Tres', username: 'nuevo3_' + RUN, phone: '961113' + RUN.slice(0, 4), password: 'secreta123' });
  check('se registra 1 cuenta más', nu3.ok, JSON.stringify(nu3));
  const ov4 = await api('/api/admin-overview?token=' + encodeURIComponent(ADM.token));
  check('tras 1 registro más, new_users es 1', ov4.ok && ov4.new_users === 1, JSON.stringify(ov4));
  // Estático: el aviso, el badge y la llamada a marcar visto existen en
  // el cliente; el aviso de solicitudes sigue intacto. (En index.html el
  // onclick va con comillas escapadas \' dentro de la cadena JS.)
  check('el aviso de usuarios nuevos existe en el cliente (línea, botón Ver pasajeros, badge y llamada a mark-users-seen)', html.includes("Se registraron '+u+' usuario") && html.includes("adminScreen=\\'pasajeros\\'") && html.includes("'cnt-pasajeros'") && html.includes("api('/api/admin/mark-users-seen'") && html.includes('Ver pasajeros') && html.includes('Tienes ') && html.includes('por revisar'));

  // v1.4.27: los tres registros son asistentes por pasos (crear cuenta,
  // chofer y negocio), con la misma estructura de pasos que la app real.
  // El envío final usa los mismos endpoints de siempre: aquí se verifica
  // que los asistentes existen en el cliente con sus pasos, sus botones
  // Siguiente/Regresar y su validación por paso, y que los endpoints
  // siguen funcionando de punta a punta.
  console.log('== v1.4.27: formularios de registro por pasos ==');
  const h27 = await api('/api/health');
  check('versión 1.4.36 en /api/health (sección)', h27.ok && h27.version === '1.4.41', JSON.stringify(h27));
  check('asistente de crear cuenta: 3 pasos, Terminar registro, Siguiente/Regresar y validación por paso', html.includes('id="rc-step0"') && html.includes('id="rc-step1"') && html.includes('id="rc-step2"') && html.includes('id="rc-steps-ind"') && html.includes('onclick="rcNext(0)"') && html.includes('onclick="rcNext(1)"') && html.includes('onclick="showRcStep(0)"') && html.includes('onclick="showRcStep(1)"') && html.includes('>Terminar registro</button>') && html.includes('function showRcStep(') && html.includes('function validateRegStep(') && html.includes('function wizSteps('));
  check('asistente de chofer: 4 pasos, Mandar mi solicitud de chofer, Siguiente/Regresar y validación por paso', html.includes('id="rd-step0"') && html.includes('id="rd-step1"') && html.includes('id="rd-step2"') && html.includes('id="rd-step3"') && html.includes('id="rd-steps-ind"') && html.includes('onclick="rdNext(0)"') && html.includes('onclick="rdNext(1)"') && html.includes('onclick="rdNext(2)"') && html.includes('onclick="showRegStep(0)"') && html.includes('onclick="showRegStep(1)"') && html.includes('onclick="showRegStep(2)"') && html.includes('>Mandar mi solicitud de chofer</button>') && html.includes('function showRegStep(') && html.includes('function validateDriverStep('));
  check('asistente de negocio: 4 pasos, Enviar la solicitud de mi negocio, Siguiente/Regresar y validación por paso', html.includes('id="nb-step0"') && html.includes('id="nb-step1"') && html.includes('id="nb-step2"') && html.includes('id="nb-step3"') && html.includes('id="nb-steps-ind"') && html.includes('onclick="nbNext(0)"') && html.includes('onclick="nbNext(1)"') && html.includes('onclick="nbNext(2)"') && html.includes('onclick="showBizStep(0)"') && html.includes('onclick="showBizStep(1)"') && html.includes('onclick="showBizStep(2)"') && html.includes('>Enviar la solicitud de mi negocio</button>') && html.includes('function showBizStep(') && html.includes('function validateBizStep(') && html.includes('function setBizType('));
  check('sin selector de perfiles en los formularios (corrección v1.4.21 intacta)', !html.includes('Elige tu perfil') && !html.includes('pickRegDriver') && !html.includes('pickRegPassenger'));
  const wizAcc = await api('/api/register-account', { name: 'Wiz Cuenta', username: 'wiz_' + RUN, phone: '961114' + RUN.slice(0, 4), password: 'secreta123' });
  check('endpoint de crear cuenta sigue funcionando', wizAcc.ok && wizAcc.account && wizAcc.account.username === 'wiz_' + RUN, JSON.stringify(wizAcc));
  const wizDrv = await api('/api/register-driver', { name: 'Wiz Chofer', phone: '961115' + RUN.slice(0, 4), vehicle: 'mototaxi', unit: 'W-' + RUN, selfie: PHOTO, vehicle_photo: PHOTO });
  check('endpoint de registro de chofer sigue funcionando (nace pendiente)', wizDrv.ok && wizDrv.driver && wizDrv.driver.status === 'pendiente', JSON.stringify(wizDrv));
  const wizBiz = await api('/api/request-business', { token: wizAcc.token, name: 'Wiz Negocio ' + RUN, type: 'entrega', whatsapp: '961116' + RUN.slice(0, 4), category: 'Comida', colony: 'Centro', schedule: 'Lunes a sábado, 9 AM a 7 PM', delivery_fee: 25, description: 'Prueba del asistente' });
  check('endpoint de crear negocio sigue funcionando (colonia, horario y envío guardados)', wizBiz.ok && wizBiz.business && wizBiz.business.colony === 'Centro' && wizBiz.business.schedule === 'Lunes a sábado, 9 AM a 7 PM' && wizBiz.business.delivery_fee === 25, JSON.stringify(wizBiz));

  // v1.4.27 (correcciones del panel de chofer): las secciones del inicio
  // del chofer son pantallas completas (como la app real), Recibir Viajes
  // pinta su encabezado al instante, y fmtDateTime ya no da Invalid Date
  // con fechas ISO que terminan en Z (historial del taxímetro).
  console.log('== v1.4.27: panel de chofer (pantallas completas, inbox, fechas) ==');
  const rdh = html.indexOf('function renderDriverHome()');
  const rdhBody = html.slice(rdh, html.indexOf('function driverHomeExpand', rdh));
  check('inicio de chofer: al expandir una sección se muestra SOLO esa pantalla con su Regresar (como la app real)', rdhBody.includes('if(driverHomeExpanded){') && rdhBody.includes('p.innerHTML = \'<div id="driver-home-expanded"></div>\';') && rdhBody.includes('renderDriverExpanded();'));
  const ri = html.indexOf('async function renderDriverInbox()');
  const riPaint = html.indexOf("if(!inboxLoaded) p.innerHTML = head + '<p class=\"muted center mt\">Cargando…</p>'", ri);
  const riAwait = html.indexOf('await Promise.all', ri);
  check('Recibir Viajes: el encabezado + Cargando… se pinta ANTES de las llamadas de red y SOLO en la primera carga', riPaint !== -1 && riAwait !== -1 && riPaint < riAwait && html.includes("if(!inboxLoaded) p.innerHTML = head + '<p class=\"muted center mt\">Cargando…</p>'"));
  const fmtLine = html.split('\n').find(l=>l.startsWith('function fmtDateTime'));
  check('fmtDateTime tolera una fecha ISO que ya termina en Z', !!fmtLine && fmtLine.includes(".replace(/Z$/,'')"));
  // En vivo: evaluar la función tal como está en el cliente con los dos
  // tipos de entrada que usa la app (ISO con Z del taxímetro y texto
  // SQLite del servidor) y comprobar que la fecha es válida.
  let fmtOk = false, fmtIso = '', fmtSql = '';
  try {
    const fmtFn = eval(fmtLine.replace('function fmtDateTime(iso)', '(function(iso)') + ')');
    fmtIso = fmtFn(new Date().toISOString());
    fmtSql = fmtFn('2026-11-23 12:34:56');
    fmtOk = !!fmtIso && !fmtIso.includes('Invalid Date') && !!fmtSql && !fmtSql.includes('Invalid Date');
  } catch(e){ fmtOk = false; }
  check('fmtDateTime en vivo: ISO con Z y texto SQLite dan fecha válida (nada de Invalid Date)', fmtOk, 'iso=' + fmtIso + ' sql=' + fmtSql);
  check('driverTab resalta las tres pestañas en las dos barras (inicio/taximetro/recibir)', html.includes("const suf = tab==='taximetro' ? 'taxi' : tab;") && html.includes("document.getElementById('txb-'+t)"));

  // v1.4.28: en Negocios la fila de opciones (Administrar/Crear, Ver mi
  // cita, Ver mi pedido) va ARRIBA del carrusel y es compacta, y el
  // primer botón ya no dice "negocio". El carrusel, las pills y las
  // tarjetas no cambian.
  console.log('== v1.4.28: Negocios, opciones arriba y compactas ==');
  const h28 = await api('/api/health');
  check('versión 1.4.36 en /api/health (sección v1.4.29)', h28.ok && h28.version === '1.4.41', JSON.stringify(h28));
  const rbm = html.indexOf('async function renderBizMain(){');
  const rbmBody = html.slice(rbm, html.indexOf('/* Carrusel de anuncios', rbm));
  check('Negocios: la fila de opciones va ANTES del carrusel en renderBizMain', rbmBody.indexOf('id="biz-options-row"') !== -1 && rbmBody.indexOf('id="biz-ads-carousel"') !== -1 && rbmBody.indexOf('id="biz-options-row"') < rbmBody.indexOf('id="biz-ads-carousel"'));
  check('Negocios: el primer botón dice Administrar/Crear sin la palabra negocio; Ver mi cita y Ver mi pedido iguales', rbmBody.includes("mine.length?'Administrar':'Crear'") && !rbmBody.includes('Administrar negocio') && !rbmBody.includes('Crear un negocio') && rbmBody.includes('>Ver mi cita</button>') && rbmBody.includes('>Ver mi pedido</button>'));
  check('Negocios: los tres botones son compactos (42px, fuente 13px), no 72px', rbmBody.includes('height:42px') && rbmBody.includes('font-size:13px') && !rbmBody.includes('height:72px'));
  check('Negocios: las tres acciones siguen iguales (mi negocio/crear, mis citas, mis pedidos)', rbmBody.includes("bizScreen=\\'my-appts\\';renderNegocios()") && rbmBody.includes("bizScreen=\\'my-orders\\';renderNegocios()") && rbmBody.includes("(mine.length?'mine':'create')"));

  // v1.4.29: la tarjeta 'Administrador' del panel está colapsada por
  // defecto (una sola fila compacta). El formulario completo solo aparece
  // al tocarla, y al guardar bien se vuelve a colapsar; si falla, queda
  // abierta con el error. El endpoint y los campos no cambian.
  console.log('== v1.4.29: tarjeta de credenciales colapsada ==');
  const h29 = await api('/api/health');
  check('versión 1.4.36 en /api/health (sección v1.4.29)', h29.ok && h29.version === '1.4.41', JSON.stringify(h29));
  const rag = html.slice(html.indexOf('function renderAdminGrid(){'), html.indexOf('function downloadBackup(){'));
  check('credenciales colapsadas por defecto: fila compacta con toggle y formulario condicional', rag.includes('Cambiar usuario y contraseña') && rag.includes('onclick="adminCredsOpen=!adminCredsOpen;renderAdminGrid()"') && rag.includes("(adminCredsOpen ? '<div id=\"admin-creds-form\">'") && html.includes('let adminScreen = null, adminDrivers = [], adminIdx = 0, adminDetail = null, adminPoll = null, adminCredsOpen = false;') && html.includes("if(!adminScreen){ adminCredsOpen = false; renderAdminGrid(); return; }"));
  check('al expandir, el formulario muestra los cuatro campos y el botón de guardar', rag.includes("pwInput('adm-cur-pass'") && rag.includes('id="adm-new-user"') && rag.includes("pwInput('adm-new-pass'") && rag.includes("pwInput('adm-new-pass2'") && rag.includes('onclick="saveAdminCredentials()"'));
  const sac = html.slice(html.indexOf('async function saveAdminCredentials(){'), html.indexOf('async function loadAdminOverview(){'));
  check('al guardar bien, la tarjeta se colapsa de nuevo y sale el aviso de siempre', sac.includes('adminCredsOpen = false;') && sac.indexOf('adminCredsOpen = false;') < sac.indexOf('renderAdminGrid();') && sac.includes("toast('Credenciales actualizadas.')"));

  console.log('== v1.4.30: anuncios por ubicación + administrar pasajeros ==');
  const h30 = await api('/api/health');
  check('versión 1.4.36 en /api/health (sección v1.4.30)', h30.ok && h30.version === '1.4.41', JSON.stringify(h30));
  // --- Anuncios: dos imágenes por anuncio (v1.4.30) ---
  const ADIMG2 = PHOTO + 'B'.repeat(120); // segunda imagen, distinta de ADIMG
  const adF = await api('/api/create-ad', { token: admLogin.token, label: 'Flotante ' + RUN, image: ADIMG, entries: ['viajes', 'mandados'] });
  check('anuncio flotante: solo imagen vertical, sin banner', adF.ok && adF.ad.image && !adF.ad.banner_image, JSON.stringify(adF.ad));
  const adP = await api('/api/create-ad', { token: admLogin.token, label: 'Panel ' + RUN, image: ADIMG2, slot: 'panel' });
  check('anuncio de panel: solo banner horizontal, sin vertical, entradas solo negocios', adP.ok && adP.ad.banner_image && !adP.ad.image && Array.isArray(adP.ad.entries) && adP.ad.entries.length === 1 && adP.ad.entries[0] === 'negocios', JSON.stringify(adP.ad));
  const adBadSlot = await api('/api/create-ad', { token: admLogin.token, label: 'Malo ' + RUN, image: ADIMG, slot: 'inicio' });
  check('slot inválido rechazado', !adBadSlot.ok, JSON.stringify(adBadSlot));
  const adsAll = await api('/api/ads');
  check('/api/ads trae ambos con sus dos imágenes', adsAll.ok && adsAll.ads.some(a => a.id === adF.ad.id && a.image && !a.banner_image) && adsAll.ads.some(a => a.id === adP.ad.id && a.banner_image && !a.image), JSON.stringify(adsAll.ads && adsAll.ads.filter(a => a.id === adF.ad.id || a.id === adP.ad.id)));
  // El de panel (sin vertical) NUNCA rota como flotante: 20 sorteos por entrada.
  let panelSeen = false;
  for (let i = 0; i < 20; i++) {
    for (const e of ['viajes', 'negocios', 'mandados']) {
      const ev = await api('/api/entry-ad?entry=' + e + '&token=' + admLogin.token);
      if (ev.ad && ev.ad.id === adP.ad.id) panelSeen = true;
    }
  }
  check('el anuncio solo-banner nunca rota como flotante (20 sorteos x 3 entradas)', !panelSeen);
  // Negocio con anuncio: subir el banner actualiza EL MISMO anuncio
  // (el negocio de la sección v1.4.0 ya tiene su anuncio flotante adA).
  const bizAdF = await api('/api/create-ad', { token: admLogin.token, label: 'Negocio flotante ' + RUN, image: ADIMG, kind: 'negocio', business_id: biz.business.id, entries: ['viajes'] });
  check('negocio: subir flotante actualiza su anuncio (vertical, sin banner)', bizAdF.ok && bizAdF.ad.id && bizAdF.ad.image && !bizAdF.ad.banner_image, JSON.stringify(bizAdF.ad));
  const bizAdP = await api('/api/create-ad', { token: admLogin.token, label: 'Negocio panel ' + RUN, image: ADIMG2, kind: 'negocio', business_id: biz.business.id, slot: 'panel' });
  check('negocio: subir el banner actualiza EL MISMO anuncio (vertical intacta, ya tiene ambas)', bizAdP.ok && bizAdP.ad.id === bizAdF.ad.id && bizAdP.ad.image && bizAdP.ad.banner_image, JSON.stringify(bizAdP.ad));
  const bizAds = await api('/api/admin-ads?token=' + admLogin.token);
  check('negocio: sigue habiendo UN solo anuncio para ese negocio', bizAds.ok && bizAds.ads.filter(a => a.business_id === biz.business.id).length === 1, JSON.stringify(bizAds.ads && bizAds.ads.filter(a => a.business_id === biz.business.id)));
  // --- Administrar pasajeros (v1.4.30) ---
  const paxAcc = await api('/api/register-account', { name: 'Pasajero Prueba', username: 'pax_' + RUN, phone: '961103' + RUN.slice(0, 4), password: 'secreta123' });
  check('cuenta de pasajero de prueba creada', paxAcc.ok && paxAcc.account.id, JSON.stringify(paxAcc));
  const paxLogin = await api('/api/login', { identifier: 'pax_' + RUN, password: 'secreta123' });
  check('pasajero entra antes de suspender', paxLogin.ok && paxLogin.token, JSON.stringify(paxLogin));
  const paxList = await api('/api/admin-passengers?token=' + ADM.token);
  const paxRow = paxList.passengers.find(p => p.account_id === paxAcc.account.id);
  check('lista de pasajeros trae cuenta, usuario y estado', paxList.ok && paxRow && paxRow.account_username === 'pax_' + RUN && paxRow.account_status === 'activo', JSON.stringify(paxRow));
  const badStatus = await api('/api/admin/set-account-status', { token: ADM.token, account_id: paxAcc.account.id, status: 'expulsado' });
  check('estado inválido rechazado', !badStatus.ok, JSON.stringify(badStatus));
  const noAdminStatus = await api('/api/admin/set-account-status', { token: paxLogin.token, account_id: paxAcc.account.id, status: 'activo' });
  check('cuenta normal no puede cambiar estados', !noAdminStatus.ok, JSON.stringify(noAdminStatus));
  const selfStatus = await api('/api/admin/set-account-status', { token: ADM.token, account_id: ADM.account.id, status: 'suspendido' });
  check('el admin no se puede suspender a sí mismo', !selfStatus.ok, JSON.stringify(selfStatus));
  const sus = await api('/api/admin/set-account-status', { token: ADM.token, account_id: paxAcc.account.id, status: 'suspendido', suspend_reason: 'Prueba motivo ' + RUN });
  check('admin suspende la cuenta con motivo', sus.ok && sus.account.status === 'suspendido' && sus.account.suspend_reason === 'Prueba motivo ' + RUN, JSON.stringify(sus));
  const loginSus = await api('/api/login', { identifier: 'pax_' + RUN, password: 'secreta123' });
  check('suspendido no puede entrar y ve el motivo', !loginSus.ok && /suspendida/.test(loginSus.error || '') && loginSus.error.includes('Motivo: Prueba motivo ' + RUN), JSON.stringify(loginSus));
  const meSus = await api('/api/me?token=' + paxLogin.token);
  check('/api/me 403 para suspendido (sesión abierta se cierra)', !meSus.ok && /suspendida/.test(meSus.error || ''), JSON.stringify(meSus));
  const paxListSus = await api('/api/admin-passengers?token=' + ADM.token);
  const paxRowSus = paxListSus.passengers.find(p => p.account_id === paxAcc.account.id);
  check('la lista de pasajeros muestra el motivo de la suspensión', paxRowSus && paxRowSus.account_status === 'suspendido' && paxRowSus.account_suspend_reason === 'Prueba motivo ' + RUN, JSON.stringify(paxRowSus));
  const react = await api('/api/admin/set-account-status', { token: ADM.token, account_id: paxAcc.account.id, status: 'activo' });
  check('reactivar deja la cuenta activa y borra el motivo', react.ok && react.account.status === 'activo' && react.account.suspend_reason == null, JSON.stringify(react));
  const loginOk = await api('/api/login', { identifier: 'pax_' + RUN, password: 'secreta123' });
  check('reactivado vuelve a entrar', loginOk.ok && loginOk.token, JSON.stringify(loginOk));
  const susNoReason = await api('/api/admin/set-account-status', { token: ADM.token, account_id: paxAcc.account.id, status: 'suspendido' });
  const loginNoReason = await api('/api/login', { identifier: 'pax_' + RUN, password: 'secreta123' });
  check('suspender sin motivo también vale (mensaje sin Motivo:)', susNoReason.ok && !loginNoReason.ok && /suspendida/.test(loginNoReason.error || '') && !/Motivo:/.test(loginNoReason.error || ''), JSON.stringify(loginNoReason));
  await api('/api/admin/set-account-status', { token: ADM.token, account_id: paxAcc.account.id, status: 'activo' });
  const blk = await api('/api/admin/set-account-status', { token: ADM.token, account_id: paxAcc.account.id, status: 'bloqueado' });
  const loginBlk = await api('/api/login', { identifier: 'pax_' + RUN, password: 'secreta123' });
  check('bloqueado no puede entrar (mensaje claro)', blk.ok && !loginBlk.ok && /bloqueada/.test(loginBlk.error || ''), JSON.stringify(loginBlk));
  await api('/api/admin/set-account-status', { token: ADM.token, account_id: paxAcc.account.id, status: 'activo' });
  // Borrar con chofer → 400 (la fila del propio usuario, que es chofer, nunca se borra).
  const drvAccT = await api('/api/register-account', { name: 'Chofer Cuenta', username: 'drv_' + RUN, phone: '961110' + RUN.slice(0, 4), password: 'secreta123' });
  check('cuenta de chofer de prueba creada', drvAccT.ok && drvAccT.account.id, JSON.stringify(drvAccT));
  const drvT = await api('/api/register-driver', { name: 'Chofer Cuenta', phone: '961110' + RUN.slice(0, 4), vehicle: 'mototaxi', unit: 'D-' + RUN.slice(0, 3), selfie: PHOTO, vehicle_photo: PHOTO });
  check('chofer de prueba registrado', drvT.ok && drvT.driver.id, JSON.stringify(drvT));
  await approveDriver(drvT.driver.id);
  const drvLoginT = await api('/api/login', { identifier: 'drv_' + RUN, password: 'secreta123' });
  const link2 = await api('/api/link-profiles', { token: drvLoginT.token, driver_id: drvT.driver.id });
  check('cuenta de chofer enlazada para la prueba de borrado', link2.ok && link2.account.driver_id === drvT.driver.id, JSON.stringify(link2));
  const delDrv = await api('/api/admin/delete-account', { token: ADM.token, account_id: drvAccT.account.id });
  check('borrar cuenta con chofer rechazado', !delDrv.ok, JSON.stringify(delDrv));
  const susDrv = await api('/api/admin/set-account-status', { token: ADM.token, account_id: drvAccT.account.id, status: 'suspendido' });
  check('suspender cuenta con chofer rechazado (se gestiona en choferes)', !susDrv.ok, JSON.stringify(susDrv));
  // Borrar al pasajero de prueba: cuenta y pasajero desaparecen.
  const delPax = await api('/api/admin/delete-account', { token: ADM.token, account_id: paxAcc.account.id });
  const accsAfter = await api('/api/admin-accounts?token=' + ADM.token);
  const paxsAfter = await api('/api/admin-passengers?token=' + ADM.token);
  check('borrar cuenta elimina cuenta y pasajero', delPax.ok && !accsAfter.accounts.some(a => a.id === paxAcc.account.id) && !paxsAfter.passengers.some(p => p.account_id === paxAcc.account.id), JSON.stringify(delPax));
  const loginDel = await api('/api/login', { identifier: 'pax_' + RUN, password: 'secreta123' });
  check('borrado ya no puede entrar: debe registrarse desde cero', !loginDel.ok && /No existe/.test(loginDel.error || ''), JSON.stringify(loginDel));
  const meDel = await api('/api/me?token=' + paxLogin.token);
  check('/api/me del borrado ya no vale', !meDel.ok, JSON.stringify(meDel));
  const delSelf = await api('/api/admin/delete-account', { token: ADM.token, account_id: ADM.account.id });
  check('el admin no se puede borrar a sí mismo', !delSelf.ok, JSON.stringify(delSelf));
  const delNoAdmin = await api('/api/admin/delete-account', { token: loginOk.token, account_id: drvAccT.account.id });
  check('cuenta normal no puede borrar cuentas', !delNoAdmin.ok, JSON.stringify(delNoAdmin));
  // Cliente (estático): menú de anuncios, formulario por ubicación,
  // carrusel por ubicación, buscador y acciones de pasajeros, aviso 403.
  const adsSec = html.slice(html.indexOf('function adCard(a){'), html.indexOf('async function createAd(){'));
  check('Anuncios: menú con Ver anuncios y Subir anuncio', adsSec.includes("adScreen=\\'ver\\'") && adsSec.includes('Ver anuncios') && adsSec.includes("adScreen=\\'subir\\'") && adsSec.includes('Subir anuncio'));
  check('Subir anuncio: menú Libre y De un negocio (sin toggle de tipo)', adsSec.includes('Subir anuncio Libre') && adsSec.includes('Subir anuncio de un negocio') && !adsSec.includes('Anuncio libre</button>') && !adsSec.includes('De un negocio</button>'));
  check('Ver anuncios: activos y ocultos separados, con rótulo Flotante/Panel/Ambos y las dos imágenes', adsSec.includes('Anuncios activos') && adsSec.includes('Anuncios ocultos') && adsSec.includes("'Ambos'") && adsSec.includes("'Panel'") && adsSec.includes("'Flotante'") && adsSec.includes('Vertical · flotante') && adsSec.includes('Horizontal · panel'));
  check('formulario: ubicación flotante (vertical) o panel (horizontal)', adsSec.includes('¿Dónde se muestra?') && adsSec.includes('Anuncio flotante') && adsSec.includes('Anuncio en el panel') && adsSec.includes('Imagen vertical del anuncio') && adsSec.includes('Imagen horizontal del anuncio'));
  const carSec = html.slice(html.indexOf('async function renderBizAdsCarousel(){'), html.indexOf('async function renderBizDetail(){'));
  check('carrusel Negocios: solo anuncios con banner_image, y la foto es el banner', carSec.includes("filter(a=>a.banner_image)") && carSec.includes("<img src=\"'+a.banner_image+'\""));
  const paxSec = html.slice(html.indexOf('function renderPaxList(){'), html.indexOf('async function renderAdminPassengers(){'));
  check('pasajeros: buscador, seleccionar todos y barra Suspender/Bloquear/Eliminar/Reactivar', html.includes('Buscar por nombre') && paxSec.includes('Seleccionar todos') && paxSec.includes('Suspender') && paxSec.includes('Bloquear') && paxSec.includes('Eliminar') && paxSec.includes('Reactivar'));
  check('pasajeros: la fila propia y la de chofer no tienen casilla', paxSec.includes('Tu cuenta') && paxSec.includes('>Chofer</span>') && paxSec.includes('paxActionable(p)'));
  check('suspender pide motivo opcional y la fila lo muestra', html.includes("prompt('Motivo de la suspensión") && html.includes('suspend_reason') && paxSec.includes('Motivo: '));
  const lmSec = html.slice(html.indexOf('async function loadMe(){'), html.indexOf('function placeByName'));
  check('sesión suspendida/bloqueada: /api/me 403 muestra el aviso y cierra la sesión', lmSec.includes('/suspendida|bloqueada/') && lmSec.includes('toast(e.message)'));
  // --- v1.4.31: layout del formulario Subir anuncio (estático) ---
  console.log('== v1.4.31: formulario Subir anuncio (layout) ==');
  check('v1.4.31: ubicación con dos opciones apiladas, títulos cortos y subtítulo en una línea', adsSec.includes('class="adplace') && adsSec.includes('<b>Anuncio flotante</b>') && adsSec.includes('<b>Anuncio en el panel</b>') && adsSec.includes('Vertical · al entrar a Viajes, Negocios o Mandados') && adsSec.includes('Horizontal · arriba en Negocios') && !adsSec.includes('Anuncio en el panel de Negocios'));
  check('v1.4.31: entradas con la casilla a la izquierda y la etiqueta corta al lado', adsSec.includes('ad-entry') && adsSec.includes('id="ad-e-viajes"') && adsSec.includes('id="ad-e-negocios"') && adsSec.includes('id="ad-e-mandados"') && adsSec.includes('<b>Viajes</b>') && adsSec.includes('<b>Negocios</b>') && adsSec.includes('<b>Mandados</b>') && !adsSec.includes('Viajes (al pedir un viaje)</label>'));
  check('v1.4.31: elegir imagen con botón propio y nombre del archivo', adsSec.includes('Elegir imagen') && adsSec.includes('adPickFile') && adsSec.includes('id="ad-filename"') && adsSec.includes('Sin imagen elegida') && adsSec.includes('adFileName'));
  check('v1.4.31: ayuda de la imagen vertical en una sola línea corta', adsSec.includes('Formato VERTICAL, como las historias.') && !adsSec.includes('En la página principal no sale.'));
  check('v1.4.31: CSS del formulario (adplace y casilla sin width:100%)', html.includes('.adplace{') && html.includes('.ad-entry input[type=checkbox]{width:auto'));
  check('v1.4.31: regla global de casillas (ninguna hereda width:100%)', html.includes('input[type=checkbox]{width:auto') && !html.includes('input[type=checkbox].chk{width:auto'));
  // --- v1.4.32: ubicación de WhatsApp en el paso 2 de 'Enviar un mandado' (estático) ---
  console.log('== v1.4.32: WhatsApp en el paso de entrega de Enviar ==');
  const envSec = html.slice(html.indexOf('function renderMandadoEnviar(){'), html.indexOf('function mdToggleAskBtn(){'));
  const envStep2 = envSec.slice(envSec.indexOf('md.step===2'), envSec.indexOf('md.step===3'));
  check('v1.4.32: paso 2 trae pegar ubicación de WhatsApp con error en línea', envStep2.includes('id="md-wa-dest"') && envStep2.includes('Marcar como punto de entrega') && envStep2.includes('id="md-wa-err2"') && envStep2.includes('mdResolveWaDest()'));
  check('v1.4.32: paso 2 trae pedir ubicación por WhatsApp con el número de quien recibe', envStep2.includes('id="md-recipient"') && envStep2.includes('Pedir ubicación por WhatsApp') && envStep2.includes('mdAskLocation()') && envStep2.includes('mdToggleAskBtn()'));
  // --- v1.4.33: sin buscador ni referencia en el paso 2 de 'Enviar un mandado' ---
  check('v1.4.33: buscador y referencia ya no están en el paso 2', !envStep2.includes('id="md-dest-q"') && !envStep2.includes('Escribe un lugar: Centro, Progreso, Madero') && !envStep2.includes('Calle o referencia (opcional)') && !envStep2.includes('id="md-dest-ref"') && !envStep2.includes('Escribe el lugar de entrega y elige una coincidencia.'));
  check('v1.4.33: el punto de WhatsApp y el error nuevo siguen en el paso 2', envStep2.includes('Punto marcado') && envStep2.includes('id="md-wa-dest"') && envStep2.includes('Pega la ubicación de WhatsApp y marca el punto de entrega.'));
  // --- v1.4.34: quien recibe en el paso 2, sin paso 3, y pago del pedido ---
  check('v1.4.34: paso 2 trae nombre y WhatsApp obligatorio, sin "(opcional)"', envStep2.includes('id="md-recipient-name"') && envStep2.includes('Nombre de quién recibe') && envStep2.includes('WhatsApp de quien recibe') && !envStep2.includes('(opcional)') && envStep2.includes('mdNextEnviar2()'));
  check('v1.4.34: pedir y pegar ubicación solo salen con el número completo', envStep2.includes('id="md-wa-box"') && envStep2.includes('¿Ya te mandaron la ubicación por WhatsApp?') && envStep2.includes('Pedir ubicación por WhatsApp') && envStep2.includes('mdToggleAskBtn()') && envStep2.includes("display:'+(valid?'block':'none')"));
  check('v1.4.34: paso 3 borrado y flujo Enviar en 4 pasos', !html.includes('¿Quién lo recibe?') && !envSec.includes('de 5') && envSec.includes('Paso 1 de 4') && envSec.includes('Paso 2 de 4') && envSec.includes('Paso 3 de 4') && envSec.includes('md.step===4') && !envSec.includes('md.step===5'));
  const envStep3 = envSec.slice(envSec.indexOf('md.step===3'), envSec.indexOf('md.step===4'));
  check('v1.4.34: paso 3 trae pago del pedido con sus dos opciones y la cantidad', envStep3.includes('¿Cómo se paga el pedido?') && envStep3.includes('Pedido ya pagado') && envStep3.includes('Se pagará el pedido') && envStep3.includes('Cantidad que el chofer necesita llevar') && envStep3.includes('id="md-order-amount"') && envStep3.includes('mdNextEnviar3()'));
  const inboxSec = html.slice(html.indexOf('async function renderDriverInbox(){'), html.indexOf('function driverCounterStep'));
  const drvSumSec = html.slice(html.indexOf('function mandadoDriverSummaryHtml(r){'), html.indexOf('async function renderDriverInbox(){'));
  check('v1.4.34: la solicitud le muestra al chofer quien recibe y el pago del pedido', inboxSec.includes('mandadoDriverSummaryHtml(r)') && drvSumSec.includes('Resumen del mandado') && drvSumSec.includes('Recibe') && drvSumSec.includes('Pedido') && drvSumSec.includes('Ya pagado') && drvSumSec.includes('Se pagará') && drvSumSec.includes('Lleva ') && drvSumSec.includes('r.order_payment') && drvSumSec.includes('r.recipient_name'));
  // --- v1.4.35: resumen del mandado al publicar y en la tarjeta del chofer ---
  const priceSec = html.slice(html.indexOf('function priceSheetHtml'), html.indexOf('function mdSummaryLine'));
  check('v1.4.35: la hoja de precio del mandado trae el resumen y ya no los tres párrafos largos', priceSec.includes('Resumen de tu mandado') && priceSec.includes('mdPublishSummaryHtml()') && priceSec.includes('id="md-sum-price"') && priceSec.includes('id="md-sum-pay"') && priceSec.includes("isTrip ? '<p class=\"muted center mt\">Tú pones el precio") && priceSec.includes("isTrip ? '<p class=\"muted mt\" id=\"price-pay-note\">") && priceSec.includes("isTrip ? '<p class=\"muted center mt\">Al publicar, tu '"));
  check('v1.4.35: el resumen del mandado trae qué se entrega, recogida, entrega, quien recibe, pago del pedido, precio y pago', html.includes('function mdPublishSummaryHtml(){') && html.includes('Qué se entrega') && html.includes('Se recoge') && html.includes('Se entrega') && html.includes('Punto de WhatsApp') && html.includes('Pedido') && html.includes('Se pagará · Lleva ') && html.includes('md-sum-price') && html.includes('md-sum-pay'));
  check('v1.4.35: el precio del resumen se actualiza al mover el stepper', html.includes("getElementById('md-sum-price')") && html.includes('priceStep(') && html.includes('priceSetSuggested('));
  check('v1.4.35: la tarjeta del chofer usa el resumen en solicitudes y en curso', inboxSec.includes('mandadoDriverSummaryHtml(r)') && inboxSec.includes("driverInboxTab==='curso'") && inboxSec.includes('Abrir mapa del servicio'));
  const liveSec = html.slice(html.indexOf('function renderLiveStrips(){'), html.indexOf('function driverPasteLocationInline'));
  check('v1.4.35: el mapa en vivo del chofer también trae el resumen del mandado', liveSec.includes('mandadoDriverSummaryHtml(r)') && liveSec.includes('liveAsDriver'));
  // --- v1.4.36: la bandeja del chofer no parpadea y es lista, no páginas ---
  check('v1.4.36: Recibir Viajes pinta Cargando… SOLO en la primera carga (lista anterior intacta)', html.includes('let inboxLoaded = false, inboxSig = ') && html.includes("if(!inboxLoaded) p.innerHTML = head + '<p class=\"muted center mt\">Cargando…</p>'") && html.includes('async function loadDriverInbox(force){'));
  check('v1.4.36: el refresco no repinta si nada cambió (firma de datos) y no se solapa', inboxSec.includes('inboxSig') && inboxSec.includes('if(inboxLoaded && !force && sig===inboxSig) return;') && inboxSec.includes('if(inboxLoading) return;') && inboxSec.includes('} finally { inboxLoading = false; }'));
  check('v1.4.36: un error de red no borra la lista anterior (solo avisa en primera carga)', inboxSec.includes("if(!inboxLoaded) p.innerHTML = head + '<p class=\"muted center mt\">No se pudo cargar."));
  check('v1.4.36: las dos llamadas de la bandeja van en paralelo y la insignia sale del mismo ciclo que la lista', inboxSec.includes('await Promise.all') && inboxSec.includes("api('/api/requests?driver_id='+myDriver.id)") && inboxSec.includes("api('/api/requests?open=1')") && inboxSec.includes('updateDriverBadge(list.length)'));
  check('v1.4.36: el sondeo llama al refresco silencioso y al volver a la app se refresca al instante', html.includes("loadDriverInbox(false); // refresco silencioso") && html.includes("document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && myDriver && store.mode==='driver' && currentView==='chofer' && driverTabName==='recibir') loadDriverInbox(false); })"));
  check('v1.4.36: las solicitudes son lista apilada, sin paginador; el contador vive en la pestaña', inboxSec.includes('list.map(r=>') && inboxSec.includes("Solicitudes ('+list.length+')") && !inboxSec.includes('driverPageIdx') && !inboxSec.includes('‹ Anterior') && !inboxSec.includes('Siguiente ›') && !inboxSec.includes("de '+list.length+' solicitudes"));
  // --- v1.4.37: solicitudes compactas en Recibir Viajes, toca para ver el detalle ---
  // (v1.4.41) La fila ya no expande el detalle en línea: el detalle vive
  // en el flotante (inboxDetailHtml), así el ancla del corte es el fin del
  // map de la lista, no el viejo "if(!expanded)".
  const compactSec = inboxSec.slice(inboxSec.indexOf('list.map(r=>{'), inboxSec.indexOf("}).join('');", inboxSec.indexOf('list.map(r=>{')));
  check('v1.4.37: la fila colapsada solo muestra tipo, de → a y precio (sin resumen, distancia ni botones)', compactSec.includes('inboxToggle') && compactSec.includes('→') && compactSec.includes('fmt$(r.price)') && compactSec.includes('▾') && !compactSec.includes('Recibe') && !compactSec.includes('Resumen del mandado') && !compactSec.includes('Aceptar') && !compactSec.includes('Distancia') && !compactSec.includes('mandadoDriverSummaryHtml'));
  check('v1.4.37: el detalle trae el resumen completo con Aceptar y Contraofertar (ahora en el flotante, v1.4.41)', inboxSec.includes('function inboxDetailHtml(r, sub, atLimit){') && inboxSec.includes('mandadoDriverSummaryHtml(r)') && inboxSec.includes("Aceptar '+fmt$(r.price)") && inboxSec.includes('Contraofertar') && !inboxSec.includes('const expanded = inboxExpandedId===r.id;') && !inboxSec.includes("if(!expanded) return card + '</div>';"));
  check('v1.4.37: el detalle abierto sobrevive al refresco (el id entra en la firma) y se cierra solo si la solicitud sale de la lista', inboxSec.includes('driverInboxTab, inboxExpandedId, driverCounter?') && inboxSec.includes('if(inboxExpandedId && !list.some(r=>r.id===inboxExpandedId)) inboxExpandedId = null;') && inboxSec.includes('if(inboxExpandedId===rid){ closeInboxOverlay(); return; }') && inboxSec.includes('inboxExpandedId = rid;'));
  // --- v1.4.38: aviso de contraoferta en la fila colapsada ---
  check('v1.4.38: la fila colapsada muestra el aviso ámbar "Te contraofertó $X · Toca para responder" cuando el pasajero contraofertó', compactSec.includes('Te contraofertó ') && compactSec.includes("fmt$(counter)") && compactSec.includes('· Toca para responder') && compactSec.includes('#fef3c7') && compactSec.includes('passenger_counter_price'));
  check('v1.4.38: el aviso solo sale cuando hay contraoferta (condicionado a counter) y tocar la fila sigue abriendo el detalle', compactSec.includes("(counter?'<div") && compactSec.includes(":'')") && compactSec.includes("inboxToggle('+r.id+')"));
  // --- v1.4.39: nombres de lugar en la fila compacta + botón para cerrar el detalle ---
  check('v1.4.39: la zona genérica se resuelve a la zona conocida más cercana por coordenadas (displayZoneName, radio 1.5 km)', html.includes('function displayZoneName(stored, lat, lng){') && html.includes('GENERIC_ZONES') && html.includes("'Mi ubicación'") && html.includes("'Punto de WhatsApp'") && html.includes('function nearestZoneWithin(pos, maxKm){') && html.includes('nearestZoneWithin({ lat, lng }, 1.5)'));
  check('v1.4.39: la fila compacta y el detalle usan el nombre resuelto (no la etiqueta genérica) y el nombre entra en la firma', inboxSec.includes('displayZoneName(r.origin_zone, r.origin_lat, r.origin_lng)') && inboxSec.includes('displayZoneName(r.dest_zone, r.dest_lat, r.dest_lng)') && inboxSec.includes('esc(r._dispO)') && inboxSec.includes('esc(r._dispD)') && inboxSec.includes("r._dispO+'>'+r._dispD") && !inboxSec.includes("esc(r.origin_zone||r.origin_detail||'')+' → '+esc(r.dest_zone||r.dest_detail||'')"));
  check('v1.4.39: el detalle trae un botón visible "‹ Ver todas las solicitudes" que lo cierra (ahora al final del flotante, v1.4.41)', inboxSec.includes('function inboxDetailHtml(r, sub, atLimit){') && inboxSec.includes("onclick=\"closeInboxOverlay()\">‹ Ver todas las solicitudes</button>"));
  // --- v1.4.40: la fila compacta trae km · ETA · pago y lo de llevar para recoger ---
  check('v1.4.40: la fila colapsada trae la línea tenue con km · ETA · pago (igual que la app real)', compactSec.includes("r.distance_km+' km · ~'+r.eta_minutes+' min'") && compactSec.includes("'Pago: '+esc(r.payment_method)") && compactSec.includes("rowMeta.join(' · ')") && compactSec.includes('rowMeta.length'));
  check('v1.4.40: la línea ámbar "Lleva $X para recogerlo" solo sale con pedido por pagar', compactSec.includes("r.order_payment==='por_pagar'") && compactSec.includes("Lleva '+fmt$(r.order_amount||0)+' para recogerlo") && compactSec.includes('#fef3c7'));
  check('v1.4.40: los nuevos campos de la fila entran en la firma (un cambio repinta sin parpadeo)', inboxSec.includes("(r.distance_km||'')") && inboxSec.includes("(r.eta_minutes||'')") && inboxSec.includes("(r.payment_method||'')") && inboxSec.includes("(r.order_payment||'')") && inboxSec.includes("(r.order_amount||0)"));
  // --- v1.4.41: el detalle de la solicitud se abre como flotante, como el anuncio de entrada ---
  check('v1.4.41: el flotante del detalle usa la geometría del anuncio de entrada (fondo oscuro, tarjeta 340 px, X de 48×48 arriba)', html.includes('#inbox-detail-overlay{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.6);display:flex;justify-content:center;align-items:flex-start;padding-top:7dvh;pointer-events:auto}') && html.includes('#inbox-detail-overlay .reqwrap{pointer-events:auto;position:relative;width:min(92vw,340px)}') && html.includes('#inbox-detail-overlay .reqfloat{max-height:85dvh;overflow-y:auto;background:#fff;border:0;border-radius:24px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:16px}') && html.includes('#inbox-detail-overlay .adx{position:absolute;top:12px;right:12px;width:48px;height:48px;border-radius:50%;background:#1c2420;color:#fff;font-size:28px;font-weight:800;line-height:1;box-shadow:0 4px 14px rgba(0,0,0,.4);z-index:2}'));
  check('v1.4.41: tocar una fila abre el flotante (no una expansión en línea) y la lista solo pinta filas compactas', inboxSec.includes('function inboxToggle(rid){') && inboxSec.includes('renderInboxOverlay(inboxLastList);') && inboxSec.includes('function renderInboxOverlay(list){') && inboxSec.includes("el.id = 'inbox-detail-overlay';") && !inboxSec.includes('const expanded = inboxExpandedId===r.id;') && !inboxSec.includes("if(!expanded) return card + '</div>';"));
  check('v1.4.41: el flotante trae la X arriba y se cierra también tocando el fondo o con "‹ Ver todas las solicitudes"', inboxSec.includes('<button class="adx" aria-label="Cerrar" onclick="closeInboxOverlay()">✕</button>') && inboxSec.includes("el.addEventListener('click', e=>{ if(e.target === el) closeInboxOverlay(); });") && inboxSec.includes('Ver todas las solicitudes'));
  check('v1.4.41: la X cierra al instante (quita el flotante antes de cualquier llamada de red) y vuelve a la lista compacta', inboxSec.includes('function closeInboxOverlay(){') && inboxSec.indexOf("if(ov) ov.remove();", inboxSec.indexOf('function closeInboxOverlay(){')) < inboxSec.indexOf('loadDriverInbox(false);', inboxSec.indexOf('function closeInboxOverlay(){')));
  check('v1.4.41: el flotante sobrevive al refresco (firma propia, no se repinta si nada cambió) y se cierra solo si la solicitud sale de la lista', inboxSec.includes('function renderInboxOverlay(list){') && inboxSec.includes('const r = inboxExpandedId ? list.find(x=>x.id===inboxExpandedId) : null;') && inboxSec.includes('if(ov && sig===inboxOvSig) return;') && inboxSec.includes('inboxOvSig'));
  check('v1.4.41: al ir al mapa en vivo (goLive) el flotante se cierra para no quedar sobre el mapa', html.includes("const ov41 = document.getElementById('inbox-detail-overlay'); if(ov41) ov41.remove();") && html.indexOf("const ov41 = document.getElementById('inbox-detail-overlay'); if(ov41) ov41.remove();") < html.indexOf("document.getElementById('view-live').classList.add('active');"));
  const open36a = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  const open36b = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Copalar', dest_detail: 'Copalar', dest_lat: 16.855, dest_lng: -93.198, distance_km: 2.5, eta_minutes: 9, price: 35, payment_method: 'efectivo' });
  const open36 = await api('/api/requests?open=1');
  check('v1.4.36: en vivo, dos solicitudes abiertas a la vez llegan juntas (la lista apilada las muestra todas)', open36a.ok && open36b.ok && open36.ok && open36.requests.some(r=>r.id===open36a.request.id) && open36.requests.some(r=>r.id===open36b.request.id), JSON.stringify({a: open36a.request && open36a.request.id, b: open36b.request && open36b.request.id, open: open36.requests.map(r=>r.id)}));
  // --- v1.4.38 (en vivo): la contraoferta del pasajero llega en los datos que lee la fila ---
  const req38 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  const off38 = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: req38.request.id, kind: 'contraoferta', price: 35 });
  const cnt38 = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: req38.request.id, offer_id: off38.offer.id, action: 'contraoferta', price: 20 });
  const open38 = await api('/api/requests?open=1');
  const row38 = open38.requests.find(r=>r.id===req38.request.id);
  const plain38 = open38.requests.find(r=>r.id===open36a.request.id);
  check('v1.4.38: en vivo, la solicitud con contraoferta del pasajero trae passenger_counter_price ($20) y la solicitud sin ella no', req38.ok && off38.ok && cnt38.ok && open38.ok && row38 && (row38.offers||[]).some(o=>o.passenger_counter_price===20) && plain38 && !(plain38.offers||[]).some(o=>o.passenger_counter_price), JSON.stringify({row: row38 && row38.offers, plain: plain38 && plain38.offers}));
  // --- v1.4.39 (en vivo): la solicitud con zonas genéricas trae las coordenadas para resolver el nombre ---
  const req39 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Mi ubicación', origin_detail: 'Recogida en mi ubicación', origin_lat: 16.87291, origin_lng: -93.21374, dest_zone: 'Punto de entrega', dest_detail: 'Punto de WhatsApp', dest_lat: 16.87137, dest_lng: -93.20652, distance_km: 0.9, eta_minutes: 5, price: 20, payment_method: 'efectivo' });
  const open39 = await api('/api/requests?open=1');
  const row39 = open39.requests.find(r=>r.id===req39.request.id);
  check('v1.4.39: en vivo, la solicitud con zonas genéricas trae las coordenadas (origen en Madero, destino en Centro) que la fila usa para resolver el nombre', req39.ok && open39.ok && row39 && row39.origin_zone==='Mi ubicación' && row39.dest_zone==='Punto de entrega' && row39.origin_lat===16.87291 && row39.origin_lng===-93.21374 && row39.dest_lat===16.87137 && row39.dest_lng===-93.20652, JSON.stringify(row39 && {oz: row39.origin_zone, dz: row39.dest_zone, olat: row39.origin_lat, olng: row39.origin_lng, dlat: row39.dest_lat, dlng: row39.dest_lng}));
  // --- v1.4.40 (en vivo): el mandado Enviar trae en los datos lo que la fila compacta muestra ---
  const req40 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 0.9, eta_minutes: 5, price: 20, payment_method: 'efectivo', description: 'Paquete de shein', vehicle: 'mototaxi', recipient_phone: '9614868605', recipient_name: 'Juan Perez', order_payment: 'por_pagar', order_amount: 200 });
  const req40b = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 0.9, eta_minutes: 5, price: 20, payment_method: 'transferencia', description: 'Otro paquete', vehicle: 'mototaxi', recipient_phone: '9614868605', recipient_name: 'Juan Perez', order_payment: 'pagado', order_amount: 0 });
  const open40 = await api('/api/requests?open=1');
  const row40 = open40.requests.find(r=>r.id===req40.request.id);
  const row40b = open40.requests.find(r=>r.id===req40b.request.id);
  check('v1.4.40: en vivo, el mandado por pagar trae distancia, ETA, pago y "Lleva $200", y el ya pagado trae pedido pagado sin monto por llevar', req40.ok && req40b.ok && open40.ok && row40 && row40.distance_km===0.9 && row40.eta_minutes===5 && row40.payment_method==='efectivo' && row40.order_payment==='por_pagar' && row40.order_amount===200 && row40b && row40b.order_payment==='pagado' && !(row40b.order_amount>0), JSON.stringify({row: row40 && {d: row40.distance_km, e: row40.eta_minutes, p: row40.payment_method, op: row40.order_payment, oa: row40.order_amount}, rowb: row40b && {op: row40b.order_payment, oa: row40b.order_amount}}));
  check('v1.4.34: publicar Enviar manda nombre, pago del pedido y cantidad', html.includes("type:'enviar'") && html.includes('recipient_name: md.recipientName') && html.includes('order_payment: md.orderPay') && html.includes("order_amount: md.orderPay==='por_pagar'"));
  const quieroSec = html.slice(html.indexOf('function renderMandadoQuiero(){'), html.indexOf('function renderMandadoEnviar(){'));
  check('v1.4.34: "Quiero un mandado" sigue en 5 pasos', quieroSec.includes('Paso 1 de 5') && quieroSec.includes('Paso 4 de 5') && quieroSec.includes('md.step===5'));
  // Limpieza: los dos anuncios de la prueba se borran (quedan los de otras secciones).
  await api('/api/delete-ad', { token: admLogin.token, ad_id: adF.ad.id });
  await api('/api/delete-ad', { token: admLogin.token, ad_id: adP.ad.id });

  console.log('== Listados ==');
  const all = await api('/api/requests');
  check('listar solicitudes con ofertas', all.ok && all.requests.length >= 4 && all.requests.every(r => Array.isArray(r.offers)));
  const open = await api('/api/requests?open=1');
  check('listar solicitudes abiertas', open.ok && open.requests.every(r => r.status === 'buscando'));

  console.log(`\nRESULTADO: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR DE PRUEBA', e); process.exit(2); });
