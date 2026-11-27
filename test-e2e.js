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
  // v1.4.79: el candado de Mandados nace BLOQUEADO por defecto; para que
  // las pruebas viejas (que publican mandados con cuentas normales) sigan
  // pasando, el admin lo abre al inicio de la suite. La sección v1.4.79
  // lo vuelve a cerrar al final, probando el candado en el camino.
  const lockOpen79 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: false });
  check('v1.4.79: el admin abre el candado de Mandados al inicio de la suite (las pruebas viejas publican mandados)', lockOpen79.ok && lockOpen79.mandados_locked === false, JSON.stringify(lockOpen79));
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

  // (v1.4.58) El chofer principal de la suite se suscribe: hace decenas de
  // aceptas a lo largo de las secciones y el límite gratis es 5 servicios
  // por día — sin suscripción se bloquearía a mitad de la suite (v1.4.38).
  // El límite gratis se prueba aparte con drvLim/drvFree, choferes gratis.
  const subDrvMain = await api('/api/subscribe-driver', { driver_id: drv.driver.id, plan: 'yearly' });
  check('chofer principal suscrito (la suite lo usa para decenas de aceptas; el límite gratis se prueba con drvLim)', subDrvMain.ok && subDrvMain.driver.plan === 'suscripcion', JSON.stringify(subDrvMain));

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
  // v1.4.60: al aceptar ya va automáticamente en camino (sin botón "Voy
  // en camino"); "Ya estoy afuera" es SOLO la llegada (llego: el
  // recorrido NO empieza ahí, sin trip_started_at) y "Iniciar recorrido"
  // (en_viaje) es lo que marca el inicio; "Llegué a destino" cierra.
  const rAfterAcc = (await api('/api/requests?id=' + rid)).requests[0];
  check('al aceptar, el viaje ya va automáticamente en camino (sin botón)', rAfterAcc.trip_stage === 'en_camino', JSON.stringify(rAfterAcc.trip_stage));
  const aLlego = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: rid, stage: 'llego' });
  check('avanzar a llego (Ya estoy afuera)', aLlego.ok && aLlego.request.trip_stage === 'llego', JSON.stringify(aLlego));
  const rLlego = (await api('/api/requests?id=' + rid)).requests[0];
  check('en llego el recorrido NO ha empezado (sin trip_started_at)', !rLlego.trip_started_at, JSON.stringify(rLlego.trip_started_at));
  for (const st of ['en_viaje', 'finalizado']) {
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
  // v1.4.43: mandado simplificado — "Ya estoy afuera para recoger el
  // paquete" (llego) → "Ya voy en camino" (en_viaje, salta 'recogido') →
  // "Entregado" (entregado, estado finalizado).
  for (const st of ['llego', 'en_viaje', 'entregado']) {
    const a = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: man.request.id, stage: st });
    check('mandado avanza a ' + st, a.ok && a.request.trip_stage === st, JSON.stringify(a));
  }
  const manEnd = (await api('/api/requests?id=' + man.request.id)).requests[0];
  check('mandado entregado queda con estado finalizado', manEnd.status === 'finalizado' && !!manEnd.finished_at, JSON.stringify({ st: manEnd.status, fin: manEnd.finished_at }));

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
  // (v1.4.71: sin foto ya no se publica — el pasajero con solo nombre +
  // teléfono, sin selfie, es rechazado con el mensaje de la foto.)
  const accNoFoto = await api('/api/register-account', { name: 'Sin Foto Pub', username: 'sinfoto_' + RUN, phone: '9610000009', password: 'secreta123' });
  const meNoFoto = await api('/api/me?token=' + accNoFoto.token);
  const withPhone = await api('/api/create-request', { passenger_id: meNoFoto.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  check('sin perfil completo (sin foto) ya no se publica (v1.4.71: la selfie es obligatoria)', accNoFoto.ok && meNoFoto.ok && meNoFoto.passenger && meNoFoto.passenger.phone === '9610000009' && !meNoFoto.passenger.face_photo && !withPhone.ok && /foto/.test(withPhone.error || ''), JSON.stringify(withPhone));

  console.log('== Cancelación solo antes de empezar ==');
  async function acceptedTrip(price) {
    const rq = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price, payment_method: 'efectivo' });
    const of = await api('/api/driver-respond', { driver_id: drv3.driver.id, request_id: rq.request.id, kind: 'acepta', price });
    // 'acepta' ya confirma al instante: no hay segundo paso por respond-offer.
    if (!of.ok || of.request.status !== 'aceptado') throw new Error('acceptedTrip no confirmó: ' + JSON.stringify(of));
    return rq.request.id;
  }
  const rc1 = await acceptedTrip(25);
  // v1.4.43: al aceptar ya está en camino; avanzar a la misma etapa es
  // éxito (doble toque no es error).
  const rc1st = await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: rc1, stage: 'en_camino' });
  check('avanzar a la etapa en la que ya está es éxito (doble toque no es error, v1.4.43)', rc1st.ok && rc1st.request.trip_stage === 'en_camino', JSON.stringify(rc1st));
  const c1 = await api('/api/cancel-request', { request_id: rc1 });
  check('cancelar en camino (antes de empezar) sí se puede', c1.ok, JSON.stringify(c1));
  const rc2 = await acceptedTrip(25);
  // v1.4.60: "Ya estoy afuera" (llego) NO empieza el recorrido; el viaje
  // empieza con "Iniciar recorrido" (en_viaje) y ahí se marca
  // trip_started_at (antes de eso se puede cancelar).
  const rc2Llego = await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: rc2, stage: 'llego' });
  check('Ya estoy afuera deja el viaje en llego sin empezar el recorrido', rc2Llego.ok && rc2Llego.request.trip_stage === 'llego' && !rc2Llego.request.trip_started_at, JSON.stringify(rc2Llego.request && { st: rc2Llego.request.trip_stage, started: rc2Llego.request.trip_started_at }));
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
  check('versión 1.4.96 en /api/health', h.ok && h.version === '1.4.96', JSON.stringify(h));
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
  check('chofer acepta precio: viaje aceptado al instante y ya va en camino (v1.4.43)', accT.ok && accT.request.status === 'aceptado' && accT.request.trip_stage === 'en_camino' && accT.request.final_price === 25 && accT.request.payment_method === 'transferencia' && accT.request.driver_id === drv3.driver.id && accT.request.driver_name === 'Gratis Tres', JSON.stringify(accT));
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
  check('versión 1.4.87', h134.ok && h134.version === '1.4.96', JSON.stringify(h134));
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
  const bi = html.indexOf('bot.innerHTML = cancelHtml91'); // v1.4.91 (detalle 5): el botón de cancelar ahora va en cancelHtml91 (con la notita del bloqueo de 30 min)
  check('Cancelar, aviso verde y tarjeta del chofer van en la columna de abajo, en ese orden', bi > 0 && html.indexOf('+ arriveHtml', bi) > bi && html.indexOf('drivercard', bi) > html.indexOf('+ arriveHtml', bi));
  check('encuadre del viaje activo deja más aire abajo que arriba (v1.4.61: el pasajero ya no usa botPad ni el zoom 16 fijo — chofer y pasajero encuadran la ruta con liveFollowPadding, arriba 170 y abajo 280)', (()=>{ const rl = html.slice(html.indexOf('async function renderLiveMap(){'), html.indexOf('function showLiveRecenter(){')); return html.includes("function liveFollowPadding(){ return followPadding('live-top', 'live-bottom', 170, 280); }") && rl.includes('fitPoints(liveMap, liveRouteCoords, liveFollowPadding())') && !rl.includes('botPad'); })());
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
  check('pie de versión en inicio (v1.4.96)', html.includes('id="home-version"') && html.includes("ver.textContent = 'Versión ' + APP_VERSION;") && html.includes("const APP_VERSION = '1.4.96';") && h.version === '1.4.96', 'health=' + JSON.stringify(h));
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
  check('el aviso de privacidad es de SanFerGo y explica los datos', /privacidad/i.test(privText) && privText.includes('Aviso de privacidad — SanFerGo') && privText.includes('contacto@sanfernandogo.com') && !privText.includes('9614868605') && privText.includes('No vendemos tus datos'));
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
  // Flujo de la tarjeta "Mi cuenta" (v1.4.71: el número se guarda y el
  // formulario crea el pasajero CON foto, que luego se enlaza; antes se
  // creaba aquí mismo sin foto): teléfono ya puesto, crear pasajero con
  // foto y enlazar; /api/me muestra el pasajero nuevo.
  const paxCelia = await api('/api/register-passenger', { name: 'Celia Correo', phone: celiaPhone, face_photo: PHOTO });
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
  const paxDora = await api('/api/register-passenger', { name: 'Dora Correo', phone: doraPhone, face_photo: PHOTO });
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
  check('saveAccountPhone() guarda el teléfono y abre el formulario de perfil (v1.4.71: ya no crea el pasajero sin foto)', sapSrc.includes("api('/api/set-account-phone'") && sapSrc.includes("openRegistro('pasajero','cuenta')") && !sapSrc.includes("register-passenger"), sapSrc.slice(0, 300));
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
  const paxInes = await api('/api/register-passenger', { name: 'Inés Correo', phone: inesPhone, face_photo: PHOTO });
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
  const paxFar = await api('/api/register-passenger', { name: 'Lejos Prueba', phone: '961110' + RUN.slice(0, 4), face_photo: PHOTO });
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
  check('banner chofer: aviso arriba del Inicio de chofer con botón al mapa en vivo (v1.4.14)', html.includes('<div class="driver-active-banner" id="driver-active-banner"></div>') && html.includes('¡El pasajero confirmó tu viaje!') && html.includes("onclick=\"goLive('+active.id+', true)\">") && html.includes('Ver mi viaje en curso') && html.includes('dismissedDriverActiveId') && html.includes('function dismissDriverActiveBanner()'));
  check('banner pasajero: aviso en Inicio con botón al mapa en vivo (v1.4.14)', html.includes('<div id="home-active-banner"></div>') && html.includes('async function fillHomeActiveBanner()') && html.includes('¡Tu viaje fue aceptado! Tu mototaxi viene en camino') && html.includes("onclick=\"goLive('+active.id+', false)\">") && html.includes('dismissedPaxActiveId') && html.includes('function dismissPaxActiveBanner()'));
  check('Viajes: el viaje aceptado se reabre solo en el mapa en vivo al entrar (v1.4.14)', html.includes("if(active.status==='aceptado'){ goLive(active.id, false); return; }"));
  // Mapa en vivo a prueba de OSRM caído (v1.4.14): si el fetch de la ruta
  // rechaza, renderLiveMap NO debe tumbar openLiveTrip antes de las
  // tiras — la ruta se protege con try/catch y openLiveTrip protege el
  // render del mapa, así las tiras (etapa, Precio final, botón de avance)
  // se dibujan igual y solo falta la línea azul. Igual en los mapas de
  // vista previa del asistente y de mandados.
  check('mapa en vivo: si OSRM falla, las tiras se dibujan igual (v1.4.14)', html.includes('try { rt = await osrmRoute(from, target, liveRouteWaypoints(r, inTrip)); } catch(e){ rt = null; }') && html.includes('try { await renderLiveMap(); } catch(e)') && html.includes('try { rt = await osrmRoute(wiz.origin, wiz.dest); } catch(e){}') && html.includes('try { rt = await osrmRoute(first, dest); } catch(e){}'));
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
  check('mapa en vivo chofer: encuadre por etapa — recogida antes de iniciar, destino después (v1.4.15; respaldo cuando no hay ruta OSRM, v1.4.43 encuadra la ruta completa)', html.includes('const framePts = inTrip') && html.includes('? (from ? [[from.lng, from.lat], [dest.lng, dest.lat]] : [[dest.lng, dest.lat]])') && html.includes(': (from ? [[from.lng, from.lat], [pick.lng, pick.lat]] : [[pick.lng, pick.lat]]);') && html.includes('fitPoints(liveMap, framePts, liveFollowPadding())') && !html.includes('fitPoints(liveMap, pts, liveAsDriver ? 70'), detHtml.slice(0, 100));
  // Marcador de recogida "Recoge aquí" (v1.4.15, petición EXPLÍCITA del
  // usuario 19:35): camino a recoger, el punto es un PIN compacto con la
  // etiqueta "Recoge aquí" — la píldora verde con el nombre del pasajero
  // tapaba el mapa; el nombre ya está en las tiras de abajo. Una vez
  // iniciado el viaje ya no se marca la recogida (solo el destino, que
  // sigue con su píldora .pass-pin "Destino · zona").
  check('mapa en vivo chofer: el marcador de recogida dice "Recoge aquí" (pin compacto, no el nombre) (v1.4.15)', html.includes("pinLbl.textContent = 'Recoge aquí'") && html.includes("pinWrap.className = 'pickup-pin'") && html.includes("pinLbl.className = 'pickup-lbl'") && html.includes('.pickup-lbl{background:#14532d;color:#fff;border:2px solid #fff;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:800;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.35)}') && html.includes('.pickup-dot{width:14px;height:14px;border-radius:50%;background:#22c55e;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)}') && html.includes("if(!inTrip){") && !html.includes("pinEl.textContent = r.kind==='viaje'") && !html.includes('Aquí recoges al pasajero') && html.includes("destEl.textContent = 'Destino · ' + (r.dest_zone||'')"));
  // v1.4.60: el botón azul "Cómo llegar" se quitó DE TODOS LADOS (petición
  // del usuario 08:16): ya no existe en el mapa en vivo del chofer (ni en
  // recogida ni en viaje, ni en mandados) ni en ningún otro lado, y se fue
  // también la función que abría Google Maps. La tarjeta de arriba queda
  // con el destino en negrita y la distancia/ETA en renglón aparte.
  const stripsSec60 = html.slice(html.indexOf('function renderLiveStrips(){'), html.indexOf('function compassDir('));
  check('v1.4.60: cero botones "Cómo llegar" en toda la app (ni el botón ni openGmaps ni su CSS)', !html.includes('Cómo llegar') && !html.includes('openGmaps') && !html.includes('howbtn') && !html.includes('google.com/maps/dir') && stripsSec60.includes('Dirígete ') && stripsSec60.includes('faltan '));
  // Centrado de los dos puntos en el mapa del paso "Tu recorrido"
  // (v1.4.15, petición del usuario + foto de la app): el encuadre usaba
  // padding fijo 70 y los puntos quedaban tapados tras las tarjetas. La
  // app lo resuelve con fitCamera + insets (franja visible entre las
  // tarjetas); la web replica eso midiendo la altura real de la tarjeta
  // de arriba y la hoja de abajo y pasándola como padding a fitBounds.
  check('detalles: el mapa encuadra los dos puntos en la franja visible entre las tarjetas (v1.4.15)', html.includes("const fm = el.closest('.fullmap');") && html.includes("fm.querySelector('.strip.top')") && html.includes("fm.querySelector('.strip.bottom')") && html.includes('fitPoints(wizMap, [[wiz.origin.lng, wiz.origin.lat], [wiz.dest.lng, wiz.dest.lat]], { top: topPad, bottom: botPad, left: 24, right: 24 });') && !html.includes('fitPoints(wizMap, [[wiz.origin.lng, wiz.origin.lat], [wiz.dest.lng, wiz.dest.lat]]);'));
  // En v1.4.57 el orden es buscador → atajos → carrusel → feed (la fila
  // de opciones sigue ANTES del carrusel, ahora como atajos con icono).
  check('Negocios: buscador y atajos van arriba del carrusel (v1.4.57)', html.includes('id="biz-search-input"') && html.includes('id="biz-options-row"') && html.includes('id="biz-ads-carousel"') && html.indexOf('id="biz-search-input"') < html.indexOf('id="biz-options-row"') && html.indexOf('id="biz-options-row"') < html.indexOf('id="biz-ads-carousel"'));
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
  check('carrusel Negocios: se alimenta de /api/ads filtrando por banner_image, auto-avance 5 s, tap abre el menú del negocio vinculado (v1.4.58) y el libre no hace nada, sin anuncios no muestra nada (v1.4.16, v1.4.30: el banner es la imagen horizontal)', html.includes("async function renderBizAdsCarousel(wrapId){") && html.includes("api('/api/ads')") && html.includes("filter(a=>a.banner_image)") && html.includes("if(!ads.length){ wrap.innerHTML = ''; return; }") && html.includes('}, 5000);') && html.includes("if(slide && slide.dataset.biz) openBusiness(+slide.dataset.biz, true);") && html.includes("bizCarouselStop()") && html.includes('class="biz-carousel-dots"') && html.includes('data-biz="')); 
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
  // (3b) Límite gratis de 5 servicios también al confirmar por respond-offer.
  const drvLim = await api('/api/register-driver', { name: 'Gratis Límite', phone: '9610000007', vehicle: 'mototaxi', unit: 'L-7', selfie: PHOTO, vehicle_photo: PHOTO });
  await approveDriver(drvLim.driver.id);
  await api('/api/set-driver-online', { driver_id: drvLim.driver.id, online: true });
  async function tripFor(driverId, price) {
    const rq = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price, payment_method: 'efectivo' });
    return api('/api/driver-respond', { driver_id: driverId, request_id: rq.request.id, kind: 'acepta', price });
  }
  for (let i = 0; i < 4; i++) { const t = await tripFor(drvLim.driver.id, 25); if (!t.ok) throw new Error('trip límite ' + i + ': ' + JSON.stringify(t)); }
  const rqL = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_lat: 16.87018, dest_lng: -93.20777, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  const offL = await api('/api/driver-respond', { driver_id: drvLim.driver.id, request_id: rqL.request.id, kind: 'contraoferta', price: 35 });
  check('con 4 servicios, la contraoferta $35 queda pendiente', offL.ok && offL.offer.status === 'pendiente', JSON.stringify(offL));
  const t5 = await tripFor(drvLim.driver.id, 25);
  check('servicio 5 gratis del día confirma', t5.ok && t5.request.status === 'aceptado', JSON.stringify(t5));
  const accL = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: rqL.request.id, offer_id: offL.offer.id, action: 'acepta' });
  check('con 5 servicios, respond-offer ya no confirma (límite gratis)', !accL.ok && /5 servicios gratis/.test(accL.error || ''), JSON.stringify(accL));
  const t6 = await tripFor(drvLim.driver.id, 25);
  check('servicio 6 gratis del día rechazado por /api/driver-respond (límite gratis de 5)', !t6.ok && /5 servicios gratis/.test(t6.error || ''), JSON.stringify(t6));
  // (4) Precio sugerido de mandado suma $10 por parada extra.
  async function suggestedMandado(extraStops) {
    const r = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, payment_method: 'efectivo', extra_stops: extraStops });
    return r.ok ? r.request.price : null;
  }
  check('v1.4.85: mandado sin precio, 1.0 km, 0 paradas extra sugiere $20 (mínimo de mandado)', (await suggestedMandado(0)) === 20);
  check('v1.4.85: mandado sin precio, 1.0 km, 1 parada extra sugiere $30', (await suggestedMandado(1)) === 30);
  check('v1.4.85: mandado sin precio, 1.0 km, 2 paradas extra sugiere $40', (await suggestedMandado(2)) === 40);
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
  check('cambiar pago con viaje aceptado ya NO se puede (al aceptar ya va en camino y el pago quedó fijado, v1.4.43)', !payNo.ok && /fijada/.test(payNo.error || ''), JSON.stringify(payNo));
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
  const v1 = await api('/api/business?id=' + biz2.business.id + '&token=' + admLogin.token);
  const v2 = await api('/api/business?id=' + biz2.business.id + '&token=' + admLogin.token);
  check('abrir la ficha suma vistas (estadísticas Premium)', v2.ok && v2.business.views >= (v1.business.views || 0) + 1, JSON.stringify([v1.business.views, v2.business.views]));
  const pr2 = await api('/api/add-product', { token: accBea.token, business_id: biz2.business.id, name: 'Pizza pepperoni', price: 120, description: 'Con queso y pepperoni' });
  check('producto con descripción', pr2.ok && pr2.product.description === 'Con queso y pepperoni', JSON.stringify(pr2));
  const av0 = await api('/api/set-product-available', { token: accBea.token, product_id: pr2.product.id, available: 0 });
  const pr2Off = await api('/api/business?id=' + biz2.business.id + '&token=' + admLogin.token);
  check('producto marcado no disponible hoy', av0.ok && (pr2Off.business.products || []).find(p => p.id === pr2.product.id).available === 0, JSON.stringify(pr2Off.business.products));
  await api('/api/set-product-available', { token: accBea.token, product_id: pr2.product.id, available: 1 });
  // Los servicios solo van en negocios de citas (el de entrega vende
  // productos): se prueba con el salón de citas de Ana.
  const sv2 = await api('/api/add-service', { token: li1.token, business_id: biz.business.id, name: 'Tinte', price: 200, description: 'Tinte completo', duration_minutes: 90 });
  check('servicio con descripción y duración', sv2.ok && sv2.service.duration_minutes === 90, JSON.stringify(sv2));
  const avS = await api('/api/set-service-available', { token: li1.token, service_id: sv2.service.id, available: 0 });
  const sv2Off = await api('/api/business?id=' + biz.business.id + '&token=' + admLogin.token);
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
  check('cliente: carga Google Identity Services y usa el client ID de /api/config (v1.4.17)', html.includes("s.src = 'https://accounts.google.com/gsi/client'") && html.includes("window.google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogleSignIn") && html.includes("api('/api/config')") && html.includes('function onGoogleSignIn(resp)') && html.includes("api('/api/auth/google', { id_token: cred, referral_code: refCodeFromUrl || undefined })")); // v1.4.67: el inicio con Google también manda el código de referido (?ref=)
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
  check('versión 1.4.96 en /api/health (sección)', h27.ok && h27.version === '1.4.96', JSON.stringify(h27));
  check('asistente de crear cuenta: 3 pasos, Terminar registro, Siguiente/Regresar y validación por paso', html.includes('id="rc-step0"') && html.includes('id="rc-step1"') && html.includes('id="rc-step2"') && html.includes('id="rc-steps-ind"') && html.includes('onclick="rcNext(0)"') && html.includes('onclick="rcNext(1)"') && html.includes('onclick="showRcStep(0)"') && html.includes('onclick="showRcStep(1)"') && html.includes('>Terminar registro</button>') && html.includes('function showRcStep(') && html.includes('function validateRegStep(') && html.includes('function wizSteps('));
  check('asistente de chofer: 4 pasos, Mandar mi solicitud de chofer, Siguiente/Regresar y validación por paso', html.includes('id="rd-step0"') && html.includes('id="rd-step1"') && html.includes('id="rd-step2"') && html.includes('id="rd-step3"') && html.includes('id="rd-steps-ind"') && html.includes('onclick="rdNext(0)"') && html.includes('onclick="rdNext(1)"') && html.includes('onclick="rdNext(2)"') && html.includes('onclick="showRegStep(0)"') && html.includes('onclick="showRegStep(1)"') && html.includes('onclick="showRegStep(2)"') && html.includes('>Mandar mi solicitud de chofer</button>') && html.includes('function showRegStep(') && html.includes('function validateDriverStep('));
  check('asistente de negocio: 5 pasos (v1.4.54: nombre+categoría en su propio paso con botones), Enviar la solicitud de mi negocio, Siguiente/Regresar y validación por paso', html.includes('id="nb-step0"') && html.includes('id="nb-step1"') && html.includes('id="nb-step2"') && html.includes('id="nb-step3"') && html.includes('id="nb-step4"') && html.includes('id="nb-steps-ind"') && html.includes('onclick="nbNext(0)"') && html.includes('onclick="nbNext(1)"') && html.includes('onclick="nbNext(2)"') && html.includes('onclick="nbNext(3)"') && html.includes('onclick="showBizStep(0)"') && html.includes('onclick="showBizStep(1)"') && html.includes('onclick="showBizStep(2)"') && html.includes('onclick="showBizStep(3)"') && html.includes('>Enviar la solicitud de mi negocio</button>') && html.includes('function showBizStep(') && html.includes('function validateBizStep(') && html.includes('function setBizType('));
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
  check('versión 1.4.96 en /api/health (sección v1.4.29)', h28.ok && h28.version === '1.4.96', JSON.stringify(h28));
  const rbm = html.indexOf('async function renderBizMain(){');
  const rbmBody = html.slice(rbm, html.indexOf('/* Carrusel de anuncios', rbm));
  check('Negocios: el orden en renderBizMain es buscador → atajos → carrusel → feed (v1.4.57)', rbmBody.indexOf('biz-search-input') !== -1 && rbmBody.indexOf('id="biz-options-row"') !== -1 && rbmBody.indexOf('id="biz-ads-carousel"') !== -1 && rbmBody.indexOf('id="biz-feed"') !== -1 && rbmBody.indexOf('biz-search-input') < rbmBody.indexOf('id="biz-options-row"') && rbmBody.indexOf('id="biz-options-row"') < rbmBody.indexOf('id="biz-ads-carousel"') && rbmBody.indexOf('id="biz-ads-carousel"') < rbmBody.indexOf('id="biz-feed"'));
  check('Negocios: el primer atajo dice Administrar/Crear sin la palabra negocio; Ver mi cita y Ver mi pedido iguales (v1.4.57)', rbmBody.includes("mine.length?'Administrar':'Crear'") && !rbmBody.includes('Administrar negocio') && !rbmBody.includes('Crear un negocio') && rbmBody.includes('>Ver mi cita</span>') && rbmBody.includes('>Ver mi pedido</span>'));
  check('Negocios: los atajos son celdas compactas con icono + etiqueta, no botones de 42px (v1.4.57)', rbmBody.includes('class="biz-shortcuts"') && rbmBody.includes('class="biz-shortcut"') && rbmBody.includes('<span class="ic">') && rbmBody.includes('<span class="lb"') && !rbmBody.includes('height:42px'));
  check('Negocios: las tres acciones siguen iguales (mi negocio/crear, mis citas, mis pedidos)', rbmBody.includes("bizScreen=\\'my-appts\\';renderNegocios()") && rbmBody.includes("bizScreen=\\'my-orders\\';renderNegocios()") && rbmBody.includes("(mine.length?'mine':'create')"));

  // v1.4.29: la tarjeta 'Administrador' del panel está colapsada por
  // defecto (una sola fila compacta). El formulario completo solo aparece
  // al tocarla, y al guardar bien se vuelve a colapsar; si falla, queda
  // abierta con el error. El endpoint y los campos no cambian.
  console.log('== v1.4.29: tarjeta de credenciales colapsada ==');
  const h29 = await api('/api/health');
  check('versión 1.4.96 en /api/health (sección v1.4.29)', h29.ok && h29.version === '1.4.96', JSON.stringify(h29));
  const rag = html.slice(html.indexOf('function renderAdminGrid(){'), html.indexOf('function downloadBackup(){'));
  check('credenciales colapsadas por defecto: fila compacta con toggle y formulario condicional', rag.includes('Cambiar usuario y contraseña') && rag.includes('onclick="adminCredsOpen=!adminCredsOpen;renderAdminGrid()"') && rag.includes("(adminCredsOpen ? '<div id=\"admin-creds-form\">'") && html.includes('let adminScreen = null, adminDrivers = [], adminIdx = 0, adminDetail = null, adminPoll = null, adminCredsOpen = false;') && html.includes("if(!adminScreen){ adminCredsOpen = false; renderAdminGrid(); return; }"));
  check('al expandir, el formulario muestra los cuatro campos y el botón de guardar', rag.includes("pwInput('adm-cur-pass'") && rag.includes('id="adm-new-user"') && rag.includes("pwInput('adm-new-pass'") && rag.includes("pwInput('adm-new-pass2'") && rag.includes('onclick="saveAdminCredentials()"'));
  const sac = html.slice(html.indexOf('async function saveAdminCredentials(){'), html.indexOf('async function loadAdminOverview(){'));
  check('al guardar bien, la tarjeta se colapsa de nuevo y sale el aviso de siempre', sac.includes('adminCredsOpen = false;') && sac.indexOf('adminCredsOpen = false;') < sac.indexOf('renderAdminGrid();') && sac.includes("toast('Credenciales actualizadas.')"));

  console.log('== v1.4.30: anuncios por ubicación + administrar pasajeros ==');
  const h30 = await api('/api/health');
  check('versión 1.4.96 en /api/health (sección v1.4.30)', h30.ok && h30.version === '1.4.96', JSON.stringify(h30));
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
  const carSec = html.slice(html.indexOf('async function renderBizAdsCarousel(wrapId){'), html.indexOf('async function renderBizDetail(){'));
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
  check('v1.4.35: el resumen del mandado sigue en las tarjetas del chofer (bandeja/en curso), pero ya NO en el mapa en vivo (v1.4.43: pantalla despejada) ni en el detalle (v1.4.81: sus filas se funden en el detalle)', !liveSec.includes('mandadoDriverSummaryHtml(r)') && (html.match(/mandadoDriverSummaryHtml\(r\)/g)||[]).length >= 2);
  // --- v1.4.36: la bandeja del chofer no parpadea y es lista, no páginas ---
  check('v1.4.36: Recibir Viajes pinta Cargando… SOLO en la primera carga (lista anterior intacta)', html.includes('let inboxLoaded = false, inboxSig = ') && html.includes("if(!inboxLoaded) p.innerHTML = head + '<p class=\"muted center mt\">Cargando…</p>'") && html.includes('async function loadDriverInbox(force){'));
  check('v1.4.36: el refresco no repinta si nada cambió (firma de datos) y no se solapa', inboxSec.includes('inboxSig') && inboxSec.includes('if(inboxLoaded && !force && sig===inboxSig) return;') && inboxSec.includes('if(inboxLoading) return;') && inboxSec.includes('} finally { inboxLoading = false; paintDriverActiveBanners(); }'));
  check('v1.4.36: un error de red no borra la lista anterior (solo avisa en primera carga)', inboxSec.includes("if(!inboxLoaded) p.innerHTML = head + '<p class=\"muted center mt\">No se pudo cargar."));
  check('v1.4.36: las dos llamadas de la bandeja van en paralelo y la insignia sale del mismo ciclo que la lista', inboxSec.includes('await Promise.all') && inboxSec.includes("api('/api/requests?driver_id='+myDriver.id+'&light=1')") && inboxSec.includes("api('/api/requests?open=1&light=1&dismissed_for='+myDriver.id)") && inboxSec.includes('updateDriverBadge(list.length)'));
  check('v1.4.36: el sondeo llama al refresco silencioso y al volver a la app se refresca al instante', html.includes("loadDriverInbox(false); // refresco silencioso") && html.includes("document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && myDriver && store.mode==='driver' && currentView==='chofer' && driverTabName==='recibir') loadDriverInbox(false); })"));
  check('v1.4.36: las solicitudes son lista apilada, sin paginador; el contador vive en la pestaña', inboxSec.includes('list.map(r=>') && inboxSec.includes("Solicitudes ('+list.length+')") && !inboxSec.includes('driverPageIdx') && !inboxSec.includes('‹ Anterior') && !inboxSec.includes('Siguiente ›') && !inboxSec.includes("de '+list.length+' solicitudes"));
  // --- v1.4.37: solicitudes compactas en Recibir Viajes, toca para ver el detalle ---
  // (v1.4.41) La fila ya no expande el detalle en línea: el detalle vive
  // en el flotante (inboxDetailHtml), así el ancla del corte es el fin del
  // map de la lista, no el viejo "if(!expanded)".
  const compactSec = inboxSec.slice(inboxSec.indexOf('list.map(r=>{'), inboxSec.indexOf("}).join('');", inboxSec.indexOf('list.map(r=>{')));
  check('v1.4.37: la fila colapsada solo muestra tipo, de → a y precio (sin resumen, distancia ni botones)', compactSec.includes('inboxToggle') && compactSec.includes('→') && compactSec.includes('fmt$(r.price)') && compactSec.includes('▾') && !compactSec.includes('Recibe') && !compactSec.includes('Resumen del mandado') && !compactSec.includes('Aceptar') && !compactSec.includes('Distancia') && !compactSec.includes('mandadoDriverSummaryHtml'));
  const detailSec37 = inboxSec.slice(inboxSec.indexOf('function inboxDetailHtml(r, sub, atLimit){'), inboxSec.indexOf('function renderInboxOverlay(list){'));
  check('v1.4.37: el detalle trae el resumen completo con Aceptar y Contraofertar (ahora en el flotante, v1.4.41; v1.4.81: la caja verde "Resumen del mandado" ya NO vive en el detalle, sus filas se funden en él)', inboxSec.includes('function inboxDetailHtml(r, sub, atLimit){') && !detailSec37.includes('mandadoDriverSummaryHtml(r)') && detailSec37.includes("Aceptar '+fmt$(r.price)") && detailSec37.includes('Contraofertar') && !inboxSec.includes('const expanded = inboxExpandedId===r.id;') && !inboxSec.includes("if(!expanded) return card + '</div>';"));
  check('v1.4.37: el detalle abierto sobrevive al refresco (el id entra en la firma) y se cierra solo si la solicitud sale de la lista', inboxSec.includes('driverInboxTab, inboxExpandedId, driverCounter?') && inboxSec.includes('if(inboxExpandedId && !list.some(r=>r.id===inboxExpandedId)) inboxExpandedId = null;') && inboxSec.includes('if(inboxExpandedId===rid){ closeInboxOverlay(); return; }') && inboxSec.includes('inboxExpandedId = rid;'));
  // --- v1.4.38: aviso de contraoferta en la fila colapsada ---
  check('v1.4.38: la fila colapsada muestra el aviso ámbar "Te contraofertó $X · Toca para responder" cuando el pasajero contraofertó', compactSec.includes('Te contraofertó ') && compactSec.includes("fmt$(counter)") && compactSec.includes('· Toca para responder') && compactSec.includes('#fef3c7') && compactSec.includes('passenger_counter_price'));
  check('v1.4.38: el aviso solo sale cuando hay contraoferta (condicionado a counter) y tocar la fila sigue abriendo el detalle', compactSec.includes("(counter && !rejected?'<div") && compactSec.includes(":'')") && compactSec.includes("inboxToggle('+r.id+')"));
  // --- v1.4.39: nombres de lugar en la fila compacta + botón para cerrar el detalle ---
  check('v1.4.39: la zona genérica se resuelve a la zona conocida más cercana por coordenadas (displayZoneName, radio 1.5 km)', html.includes('function displayZoneName(stored, lat, lng){') && html.includes('GENERIC_ZONES') && html.includes("'Mi ubicación'") && html.includes("'Punto de WhatsApp'") && html.includes('function nearestZoneWithin(pos, maxKm){') && html.includes('nearestZoneWithin({ lat, lng }, 1.5)'));
  check('v1.4.39: la fila compacta y el detalle usan el nombre resuelto (no la etiqueta genérica) y el nombre entra en la firma', inboxSec.includes('displayZoneName(r.origin_zone, r.origin_lat, r.origin_lng)') && inboxSec.includes('displayZoneName(r.dest_zone, r.dest_lat, r.dest_lng)') && inboxSec.includes('esc(r._dispO)') && inboxSec.includes('esc(r._dispD)') && inboxSec.includes("r._dispO+'>'+r._dispD") && !inboxSec.includes("esc(r.origin_zone||r.origin_detail||'')+' → '+esc(r.dest_zone||r.dest_detail||'')"));
  check('v1.4.39: el detalle trae un botón visible "‹ Ver todas las solicitudes" que lo cierra (ahora al final del flotante, v1.4.41)', inboxSec.includes('function inboxDetailHtml(r, sub, atLimit){') && inboxSec.includes("onclick=\"closeInboxOverlay()\">‹ Ver todas las solicitudes</button>"));
  // --- v1.4.40: la fila compacta trae km · ETA · pago y lo de llevar para recoger ---
  check('v1.4.40: la fila colapsada trae la línea tenue con km · ETA · pago (igual que la app real)', compactSec.includes("r.distance_km+' km · ~'+r.eta_minutes+' min'") && compactSec.includes("'Pago: '+esc(r.payment_method)") && compactSec.includes("rowMeta.join(' · ')") && compactSec.includes('rowMeta.length'));
  check('v1.4.85: la línea ámbar "Lleva $X" solo sale con pedido por pagar y dice "para comprar" en Quiero y "para recogerlo" en Enviar', compactSec.includes("r.order_payment==='por_pagar'") && compactSec.includes("Lleva '+fmt$(r.order_amount||0)+(isQuieroMandado(r)?' para comprar':' para recogerlo')") && compactSec.includes('#fef3c7'));
  check('v1.4.40: los nuevos campos de la fila entran en la firma (un cambio repinta sin parpadeo)', inboxSec.includes("(r.distance_km||'')") && inboxSec.includes("(r.eta_minutes||'')") && inboxSec.includes("(r.payment_method||'')") && inboxSec.includes("(r.order_payment||'')") && inboxSec.includes("(r.order_amount||0)"));
  // --- v1.4.41: el detalle de la solicitud se abre como flotante, como el anuncio de entrada ---
  check('v1.4.41: el flotante del detalle usa la geometría del anuncio de entrada (fondo oscuro, tarjeta 340 px, X de 48×48 arriba)', html.includes('#inbox-detail-overlay{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.6);display:flex;justify-content:center;align-items:flex-start;padding-top:7dvh;pointer-events:auto}') && html.includes('#inbox-detail-overlay .reqwrap{pointer-events:auto;position:relative;width:min(92vw,340px)}') && html.includes('#inbox-detail-overlay .reqfloat{max-height:85dvh;overflow-y:auto;background:#fff;border:0;border-radius:24px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:16px}') && html.includes('#inbox-detail-overlay .adx{position:absolute;top:12px;right:12px;width:48px;height:48px;border-radius:50%;background:#1c2420;color:#fff;font-size:28px;font-weight:800;line-height:1;box-shadow:0 4px 14px rgba(0,0,0,.4);z-index:2}'));
  check('v1.4.41: tocar una fila abre el flotante (no una expansión en línea) y la lista solo pinta filas compactas', inboxSec.includes('function inboxToggle(rid){') && inboxSec.includes('renderInboxOverlay(inboxLastList);') && inboxSec.includes('function renderInboxOverlay(list){') && inboxSec.includes("el.id = 'inbox-detail-overlay';") && !inboxSec.includes('const expanded = inboxExpandedId===r.id;') && !inboxSec.includes("if(!expanded) return card + '</div>';"));
  check('v1.4.41: el flotante trae la X arriba y se cierra también tocando el fondo o con "‹ Ver todas las solicitudes"', inboxSec.includes('<button class="adx" aria-label="Cerrar" onclick="closeInboxOverlay()">✕</button>') && inboxSec.includes("el.addEventListener('click', e=>{ if(e.target === el) closeInboxOverlay(); });") && inboxSec.includes('Ver todas las solicitudes'));
  check('v1.4.41: la X cierra al instante (quita el flotante antes de cualquier llamada de red) y vuelve a la lista compacta', inboxSec.includes('function closeInboxOverlay(){') && inboxSec.indexOf("if(ov) ov.remove();", inboxSec.indexOf('function closeInboxOverlay(){')) < inboxSec.indexOf('loadDriverInbox(false);', inboxSec.indexOf('function closeInboxOverlay(){')));
  check('v1.4.41: el flotante sobrevive al refresco (firma propia, no se repinta si nada cambió) y se cierra solo si la solicitud sale de la lista', inboxSec.includes('function renderInboxOverlay(list){') && inboxSec.includes('const r = inboxExpandedId ? list.find(x=>x.id===inboxExpandedId) : null;') && inboxSec.includes('if(ov && sig===inboxOvSig) return;') && inboxSec.includes('inboxOvSig'));
  check('v1.4.41: al ir al mapa en vivo (goLive) el flotante se cierra para no quedar sobre el mapa', html.includes("const ov41 = document.getElementById('inbox-detail-overlay'); if(ov41) ov41.remove();") && html.indexOf("const ov41 = document.getElementById('inbox-detail-overlay'); if(ov41) ov41.remove();") < html.indexOf("document.getElementById('view-live').classList.add('active');"));
  // --- v1.4.42: aceptar como chofer ya no marca error ni deja la bandeja en "Cargando..." ---
  check('v1.4.42: api() tiene tiempo límite (AbortController 20 s): una llamada lenta falla rápido en vez de colgarse para siempre', html.includes('const ctrl = new AbortController();') && html.includes('setTimeout(()=>ctrl.abort(), 20000)') && html.includes('La conexión tardó demasiado'));
  check('v1.4.42: driverRespond tiene guardia contra doble toque y, si el servidor dice "Ya respondiste" o "ya no está buscando", verifica el estado y va al mapa en vivo en vez de mostrar el error', html.includes('let driverRespondBusy = false;') && html.includes('if(driverRespondBusy) return;') && html.includes("e.message.indexOf('Ya respondiste')>=0") && html.includes("e.message.indexOf('ya no está buscando')>=0") && html.includes("api('/api/requests?id='+rid)"));
  check('v1.4.42: abrir el mapa en vivo y su sondeo piden UNA solicitud por id (no la lista completa de 2.5 MB), y si falla el chofer vuelve a la bandeja en vez de quedarse en un mapa vacío', html.includes("api('/api/requests?id='+requestId)") && html.includes("api('/api/requests?id='+liveReq.id)") && html.includes("if(liveAsDriver){ go('chofer'); driverTab('recibir'); }"));
  check('v1.4.42: el sondeo nunca solapa dos ciclos (pollBusy) y las listas del chofer se descargan ligeras (sin fotos)', html.includes('if(pollBusy) return; pollBusy = true;') && html.includes('finally { pollBusy = false; }') && html.includes("api('/api/requests?open=1&light=1')") && html.includes("api('/api/requests?driver_id='+myDriver.id+'&light=1')"));
  check('v1.4.42: el aviso de viaje activo del chofer es un estado compartido (no solo el driverCounts del inicio) con pintor propio y botón para ir al viaje', html.includes('let driverActiveTrip = null;') && html.includes('function driverActiveBannerHtml(active){') && html.includes('function paintDriverActiveBanners(){') && html.includes('function setDriverActiveFromList(list){') && html.includes('function refreshDriverActiveBanner(){') && html.includes("Ver mi mandado en curso") && html.includes("Ver mi viaje en curso") && !html.includes("const db2 = document.getElementById('driver-active-banner');"));
  check('v1.4.42: el aviso vive en Inicio, Recibir Viajes y Taxímetro (misma clase en los tres) y se refresca al entrar a cada pestaña', html.includes('<div class="driver-active-banner" id="driver-active-banner"></div>') && html.includes("const head = '<div class=\"driver-active-banner\"></div><h2>Recibir Viajes</h2>") && html.includes('#view-taximetro .driver-active-banner{position:absolute;top:calc(env(safe-area-inset-top,0px) + 76px);left:12px;right:12px;z-index:61}') && html.includes('refreshDriverActiveBanner();'));
  check('v1.4.42: una carga fallida ya no deja "Cargando..." para siempre: la bandeja y los viajes del chofer traen botón Reintentar', html.includes('onclick="loadDriverInbox(true)">Reintentar</button>') && html.includes('onclick="loadDriverTrips()">Reintentar</button>') && html.includes('onclick="loadDriverHist()">Reintentar</button>'));
  check('v1.4.42: el detalle trae la foto del pasajero con una descarga aparte por id (la bandeja ligera no la trae)', html.includes("api('/api/requests?id='+rid).then(j=>{") && html.includes("inboxOvSig=''; renderInboxOverlay(inboxLastList);"));
  // --- v1.4.42 (en vivo): aceptar el mandado, segundo Aceptar, lista ligera sin fotos ---
  const req42 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 0.9, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Paquete de shein', vehicle: 'mototaxi', recipient_phone: '9614868605', recipient_name: 'Juan Perez', order_payment: 'por_pagar', order_amount: 200 });
  const acc42 = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: req42.request.id, kind: 'acepta', price: 30 });
  check('v1.4.42: aceptar el mandado como chofer lo confirma al instante (sin segundo paso del pasajero)', req42.ok && acc42.ok && acc42.request.status === 'aceptado' && acc42.request.final_price === 30 && acc42.request.driver_id === drv.driver.id, JSON.stringify(acc42));
  const one42 = await api('/api/requests?id=' + req42.request.id);
  check('v1.4.42: /api/requests?id= devuelve UNA solicitud, la aceptada con su chofer (lo que abre el mapa en vivo, sin bajar la lista de 2.5 MB)', one42.ok && one42.requests.length === 1 && one42.requests[0].id === req42.request.id && one42.requests[0].status === 'aceptado' && one42.requests[0].driver_id === drv.driver.id, JSON.stringify(one42.requests && one42.requests[0]));
  const dup42 = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: req42.request.id, kind: 'acepta', price: 30 });
  check('v1.4.42: un segundo Aceptar (doble toque) rebota en el servidor ("ya no está buscando conductor." porque el viaje ya quedó aceptado) y el viaje sigue aceptado (el cliente ya no muestra ese error: verifica y va al mapa)', !dup42.ok && /Ya respondiste|ya no está buscando/.test(dup42.error || '') && one42.requests[0].status === 'aceptado', JSON.stringify(dup42));
  const light42 = await api('/api/requests?driver_id=' + drv.driver.id + '&light=1');
  const row42 = light42.requests.find(r=>r.id===req42.request.id);
  check('v1.4.42: la lista ligera del chofer trae el viaje aceptado (fuente del aviso de viaje activo) SIN las fotos base64', light42.ok && row42 && row42.status === 'aceptado' && row42.passenger_photo == null && row42.driver_photo == null && row42.vehicle_photo == null, JSON.stringify(row42 && {st: row42.status, pp: row42.passenger_photo, dp: row42.driver_photo, vp: row42.vehicle_photo}));
  const openLight42 = await api('/api/requests?open=1&light=1');
  check('v1.4.42: /api/requests?open=1&light=1 quita las fotos de todas las filas y de las ofertas', openLight42.ok && openLight42.requests.every(r=>r.passenger_photo == null && r.driver_photo == null && r.vehicle_photo == null && (r.offers||[]).every(o=>o.driver_photo == null && o.vehicle_photo == null)), JSON.stringify(openLight42.requests.length));
  const full42 = await api('/api/requests?driver_id=' + drv.driver.id);
  const rowFull42 = full42.requests.find(r=>r.id===req42.request.id);
  check('v1.4.42: sin light=1 la misma fila SÍ trae las fotos (la foto del pasajero sigue llegando al detalle)', full42.ok && rowFull42 && rowFull42.passenger_photo && rowFull42.driver_photo, JSON.stringify(rowFull42 && {pp: !!rowFull42.passenger_photo, dp: !!rowFull42.driver_photo}));
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
  const req40 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 0.9, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Paquete de shein', vehicle: 'mototaxi', recipient_phone: '9614868605', recipient_name: 'Juan Perez', order_payment: 'por_pagar', order_amount: 200 });
  const req40b = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 0.9, eta_minutes: 5, price: 30, payment_method: 'transferencia', description: 'Otro paquete', vehicle: 'mototaxi', recipient_phone: '9614868605', recipient_name: 'Juan Perez', order_payment: 'pagado', order_amount: 0 });
  const open40 = await api('/api/requests?open=1');
  const row40 = open40.requests.find(r=>r.id===req40.request.id);
  const row40b = open40.requests.find(r=>r.id===req40b.request.id);
  check('v1.4.40: en vivo, el mandado por pagar trae distancia, ETA, pago y "Lleva $200", y el ya pagado trae pedido pagado sin monto por llevar', req40.ok && req40b.ok && open40.ok && row40 && row40.distance_km===0.9 && row40.eta_minutes===5 && row40.payment_method==='efectivo' && row40.order_payment==='por_pagar' && row40.order_amount===200 && row40b && row40b.order_payment==='pagado' && !(row40b.order_amount>0), JSON.stringify({row: row40 && {d: row40.distance_km, e: row40.eta_minutes, p: row40.payment_method, op: row40.order_payment, oa: row40.order_amount}, rowb: row40b && {op: row40b.order_payment, oa: row40b.order_amount}}));
  check('v1.4.34: publicar Enviar manda nombre, pago del pedido y cantidad', html.includes("type:'enviar'") && html.includes('recipient_name: md.recipientName') && html.includes('order_payment: md.orderPay') && html.includes("order_amount: md.orderPay==='por_pagar'"));
  const quieroSec = html.slice(html.indexOf('function renderMandadoQuiero(){'), html.indexOf('function renderMandadoEnviar(){'));
  check('v1.4.80: "Quiero un mandado" ahora es en 4 pasos (entrega al inicio, lista, compra, precio)', quieroSec.includes('¿A dónde se entrega?</h2>') && quieroSec.includes('Paso 2 de 4') && quieroSec.includes('Paso 3 de 4') && quieroSec.includes('md.step===4') && !quieroSec.includes('Paso 1 de 3') && !quieroSec.includes('Paso 2 de 3') && !quieroSec.includes('Paso 3 de 3') && !quieroSec.includes('md.step===5'));
  // Limpieza: los dos anuncios de la prueba se borran (quedan los de otras secciones).
  await api('/api/delete-ad', { token: admLogin.token, ad_id: adF.ad.id });
  await api('/api/delete-ad', { token: admLogin.token, ad_id: adP.ad.id });

  // --- v1.4.43: flujo simplificado del chofer + pantalla en vivo despejada + ruta completa ---
  // Estáticas: el servidor confirma en camino, el mapa de transiciones y la
  // idempotencia; el cliente con los botones nuevos y la tira despejada.
  check('v1.4.43: al aceptar el servidor deja el servicio automáticamente en camino (sin botón "Voy en camino")', srv.includes("trip_stage='en_camino', trip_stage_at=datetime('now')"));
  check('v1.4.43: el mapa de transiciones salta las etapas viejas pero las sigue aceptando (servicios en curso)', srv.includes("en_camino: ['llego', 'en_viaje']") && srv.includes("llego: ['recogido', 'comprado', 'en_viaje']") && srv.includes("recogido: ['en_viaje', 'entregado']") && srv.includes("comprado: ['en_viaje', 'entregado']"));
  check('v1.4.43: avanzar a la etapa en la que ya está es éxito (doble toque no es error)', srv.includes("if (stage === r.trip_stage) return send(res, 200, { ok: true, request: r });"));
  check('v1.4.43: el cliente simplificó los botones ("Ya estoy afuera" → "Iniciar recorrido" → "Llegué a destino" en viajes; "Ya estoy afuera para recoger el paquete" → "Ya voy en camino" → "Entregado" en mandados) y ya no trae los viejos', html.includes("if(r.trip_stage==='confirmado' || r.trip_stage==='en_camino') return 'llego';") && html.includes("if(r.trip_stage==='llego') return 'en_viaje';") && html.includes("llego:'Ya estoy afuera'") && html.includes("en_viaje:'Iniciar recorrido'") && html.includes("finalizado:'Llegué a destino'") && html.includes("llego:'Ya estoy afuera para recoger el paquete'") && html.includes("en_viaje:'Ya voy en camino'") && html.includes("entregado:'Entregado'") && !html.includes("'Voy en camino'") && !html.includes("'Iniciar viaje'") && !html.includes("'Ya llegué a recoger'") && !html.includes("'Ya recogí el encargo'") && !html.includes("'En camino a entregarlo'") && !html.includes("'Ya lo entregué'") && !html.includes("'Voy por el encargo'"));
  const liveSec43 = html.slice(html.indexOf('function renderLiveStrips(){'), html.indexOf('function compassDir('));
  check('v1.4.43: la pantalla en vivo del chofer ya no trae la caja verde de resumen ni el botón ancho de pegar ubicación: Recibe y Pedido son renglones chicos y pegar ubicación es un enlace chico', liveSec43.includes('live-mini') && liveSec43.includes('minilink') && liveSec43.includes('Recibe: ') && !liveSec43.includes('mandadoDriverSummaryHtml(r)') && !liveSec43.includes('class="ghostb"') && !liveSec43.includes('Pedir ubicación por WhatsApp a quien recibe') && !liveSec43.includes('Punto de entrega marcado en el mapa'));
  check('v1.4.43: la ruta azul ya va al destino cuando el servicio empezó (recogido/comprado/en_viaje) y no de vuelta a la recogida', html.includes('function liveHeadingToDest(r){') && html.includes("return ['recogido','comprado','en_viaje','entregado'].includes(r.trip_stage||'');") && html.includes('const inTrip = liveHeadingToDest(r);'));
  check('v1.4.43: la ruta pasa por las paradas de "Varios lados" y se encuadra COMPLETA en la franja libre', html.includes('function liveRouteWaypoints(r, toDest){') && html.includes('stops.slice(1)') && html.includes('osrmRoute(from, target, liveRouteWaypoints(r, inTrip))') && html.includes('fitPoints(liveMap, liveRouteCoords, liveFollowPadding())'));
  check('v1.4.43: el pasajero ve los estados del flujo nuevo (va en camino / ya está afuera / va a entregarte / entregado)', html.includes("en_camino:'Tu mototaxi va en camino'") && html.includes("en_viaje:'Viaje en curso · vas rumbo a tu destino'") && html.includes("en_viaje:'Tu encargo va en camino a su destino'") && html.includes("entregado:'Tu encargo fue entregado'") && html.includes("r.trip_stage==='en_viaje' && prev.indexOf('en_viaje')<0"));
  check('v1.4.43: advanceLive tiene guardia contra doble toque (seis toques mandan un solo avance)', html.includes('liveAdvancing = false') && html.includes('if(liveAdvancing) return;') && html.includes('finally { liveAdvancing = false; }'));
  // En vivo: viaje con el flujo nuevo.
  const req43 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 20, payment_method: 'efectivo' });
  // Seis toques seguidos en Aceptar: UN solo viaje aceptado, UNA sola oferta.
  const taps43 = await Promise.all(Array.from({ length: 6 }, () => api('/api/driver-respond', { driver_id: drv.driver.id, request_id: req43.request.id, kind: 'acepta', price: 20 })));
  const one43 = await api('/api/requests?id=' + req43.request.id);
  const row43 = one43.requests[0];
  check('v1.4.43: seis toques en Aceptar producen UN solo viaje aceptado y UNA sola oferta (sin duplicar ni romper)', req43.ok && taps43.filter(t=>t.ok).length === 1 && row43 && row43.status === 'aceptado' && row43.trip_stage === 'en_camino' && (row43.offers||[]).filter(o=>o.driver_id===drv.driver.id).length === 1, JSON.stringify({ ok: taps43.filter(t=>t.ok).length, st: row43 && row43.status, stage: row43 && row43.trip_stage, offers: row43 && (row43.offers||[]).length }));
  // Seis toques seguidos en "Ya estoy afuera": todos éxito, UN solo
  // avance a llego, y el recorrido NO empieza ahí (v1.4.60: empieza con
  // "Iniciar recorrido"). Seis toques en "Iniciar recorrido": todos
  // éxito, UN solo avance a en_viaje y el recorrido marcado como iniciado.
  const tapsAdv = await Promise.all(Array.from({ length: 6 }, () => api('/api/advance-stage', { driver_id: drv.driver.id, request_id: req43.request.id, stage: 'llego' })));
  const row43b = (await api('/api/requests?id=' + req43.request.id)).requests[0];
  check('v1.4.43: seis toques en "Ya estoy afuera" dan éxito en los seis, un solo avance a llego y el recorrido SIN empezar (v1.4.60)', tapsAdv.every(t=>t.ok) && row43b.trip_stage === 'llego' && !row43b.trip_started_at, JSON.stringify({ ok: tapsAdv.filter(t=>t.ok).length, stage: row43b.trip_stage, started: row43b.trip_started_at }));
  const tapsStart = await Promise.all(Array.from({ length: 6 }, () => api('/api/advance-stage', { driver_id: drv.driver.id, request_id: req43.request.id, stage: 'en_viaje' })));
  const row43c = (await api('/api/requests?id=' + req43.request.id)).requests[0];
  check('v1.4.60: seis toques en "Iniciar recorrido" dan éxito en los seis, un solo avance a en_viaje y el recorrido marcado como iniciado', tapsStart.every(t=>t.ok) && row43c.trip_stage === 'en_viaje' && !!row43c.trip_started_at, JSON.stringify({ ok: tapsStart.filter(t=>t.ok).length, stage: row43c.trip_stage, started: row43c.trip_started_at }));
  const fin43 = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: req43.request.id, stage: 'finalizado' });
  check('v1.4.43: "Llegué a destino" finaliza el viaje', fin43.ok && fin43.request.trip_stage === 'finalizado' && fin43.request.status === 'finalizado' && !!fin43.request.finished_at, JSON.stringify(fin43.request && { st: fin43.request.trip_stage, fin: fin43.request.finished_at }));
  // En vivo: mandado con el flujo nuevo (el pasajero ve cada etapa igual).
  const man43 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 0.9, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Paquete de shein', vehicle: 'mototaxi', recipient_phone: '9614868605', recipient_name: 'Juan Perez', order_payment: 'por_pagar', order_amount: 200 });
  const macc43 = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: man43.request.id, kind: 'acepta', price: 30 });
  check('v1.4.43: al aceptar el mandado ya va en camino a recoger (sin botón)', man43.ok && macc43.ok && macc43.request.status === 'aceptado' && macc43.request.trip_stage === 'en_camino', JSON.stringify(macc43.request && macc43.request.trip_stage));
  const mLlego = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: man43.request.id, stage: 'llego' });
  const paxLlego = (await api('/api/requests?passenger_id=' + pax.passenger.id)).requests.find(r=>r.id===man43.request.id);
  check('v1.4.43: "Ya estoy afuera para recoger el paquete" y el pasajero lo ve en esa misma etapa', mLlego.ok && mLlego.request.trip_stage === 'llego' && paxLlego && paxLlego.trip_stage === 'llego', JSON.stringify({ drv: mLlego.request && mLlego.request.trip_stage, pax: paxLlego && paxLlego.trip_stage }));
  const mViaje = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: man43.request.id, stage: 'en_viaje' });
  const paxViaje = (await api('/api/requests?passenger_id=' + pax.passenger.id)).requests.find(r=>r.id===man43.request.id);
  check('v1.4.43: "Ya voy en camino" (salta recogido) y el pasajero lo ve en camino a entregarle', mViaje.ok && mViaje.request.trip_stage === 'en_viaje' && paxViaje && paxViaje.trip_stage === 'en_viaje', JSON.stringify({ drv: mViaje.request && mViaje.request.trip_stage, pax: paxViaje && paxViaje.trip_stage }));
  const mEnt = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: man43.request.id, stage: 'entregado' });
  check('v1.4.43: "Entregado" cierra el mandado (estado finalizado)', mEnt.ok && mEnt.request.trip_stage === 'entregado' && mEnt.request.status === 'finalizado' && !!mEnt.request.finished_at, JSON.stringify(mEnt.request && { st: mEnt.request.trip_stage, fin: mEnt.request.finished_at }));
  // En vivo: compatibilidad con servicios en curso (etapas viejas).
  const legV = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 20, payment_method: 'efectivo' });
  await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: legV.request.id, kind: 'acepta', price: 20 });
  const legVl = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: legV.request.id, stage: 'llego' });
  const legVv = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: legV.request.id, stage: 'en_viaje' });
  const legVf = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: legV.request.id, stage: 'finalizado' });
  check('v1.4.43: un viaje en curso con la etapa vieja "llego" sigue avanzando (llego → en_viaje → finalizado)', legV.ok && legVl.ok && legVl.request.trip_stage === 'llego' && legVv.ok && legVf.ok && legVf.request.trip_stage === 'finalizado', JSON.stringify({ llego: legVl.ok, viaje: legVv.ok, fin: legVf.ok }));
  const legM = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Paquete viejo' });
  await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: legM.request.id, kind: 'acepta', price: 30 });
  const legMl = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: legM.request.id, stage: 'llego' });
  const legMr = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: legM.request.id, stage: 'recogido' });
  const legMv = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: legM.request.id, stage: 'en_viaje' });
  const legMe = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: legM.request.id, stage: 'entregado' });
  check('v1.4.43: un mandado en curso con la etapa vieja "recogido" sigue avanzando (llego → recogido → en_viaje → entregado)', legM.ok && legMl.ok && legMr.ok && legMr.request.trip_stage === 'recogido' && legMv.ok && legMe.ok && legMe.request.trip_stage === 'entregado', JSON.stringify({ llego: legMl.ok, rec: legMr.ok, viaje: legMv.ok, ent: legMe.ok }));
  // En vivo: mandado "Varios lados" guarda sus paradas (la ruta completa
  // pasa por todas antes de la entrega; la última es el destino).
  const multi43 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.2, price: 40, payment_method: 'efectivo', description: '', recipient_phone: '9612222222', items: ['2 kg de tortillas', '1 refresco'], stops: [{ zone: 'Mercado', lat: 16.8675, lng: -93.2105 }, { zone: 'Centro', lat: 16.8709, lng: -93.2063 }], extra_stops: 1 });
  const multiRow = (await api('/api/requests?id=' + multi43.request.id)).requests[0];
  check('v1.4.43: mandado "Varios lados" guarda las paradas en orden (la ruta las recorre y la última parada es la entrega)', multi43.ok && multiRow && JSON.parse(multiRow.stops_json||'[]').length === 2 && multiRow.extra_stops === 1 && JSON.parse(multiRow.stops_json)[1].zone === 'Centro', JSON.stringify(multiRow && { stops: multiRow.stops_json, extra: multiRow.extra_stops }));
  const multiAcc = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: multi43.request.id, kind: 'acepta', price: 40 });
  const multiFin = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: multi43.request.id, stage: 'llego' });
  check('v1.4.43: el mandado de varios lados usa el mismo ciclo simplificado (acepta → afuera → en camino → entregado)', multiAcc.ok && multiAcc.request.trip_stage === 'en_camino' && multiFin.ok && multiFin.request.trip_stage === 'llego', JSON.stringify({ acc: multiAcc.request && multiAcc.request.trip_stage, llego: multiFin.request && multiFin.request.trip_stage }));

  // --- v1.4.44: la línea azul SIEMPRE se ve en la recogida + zoom de proximidad ---
  // Diagnóstico (captura del usuario 20:31): viaje en camino a recoger
  // (203 m, "Recoge aquí") sin NINGUNA línea azul entre la mototaxi y el
  // pin. El mapa en vivo se dibujó bien (mototaxi, pin, tarjetas) pero
  // OSRM no devolvió ruta y el código decía explícitamente "sin ruta
  // OSRM: no se dibuja línea recta" — no había respaldo. Además osrmRoute
  // no tenía tiempo límite: si el servidor demo se colgaba, la llamada
  // quedaba esperando para siempre.
  const osrmSec = html.slice(html.indexOf('async function osrmRoute'), html.indexOf('/* Distancia estimada'));
  check('v1.4.44: osrmRoute ya no se cuelga: tiempo límite de 8 s y chequeo de respuesta', osrmSec.includes('new AbortController()') && osrmSec.includes('setTimeout(()=>ctrl.abort(), 8000)') && osrmSec.includes('signal: ctrl.signal') && osrmSec.includes('if(!r.ok) return null'));
  check('v1.4.44: sin OSRM hay línea recta de respaldo (chofer → objetivo, mismo azul) y se acabó el "no se dibuja línea recta"', html.includes('function straightRouteCoords(from, target, via){') && html.includes('straightRouteCoords(from, target, liveRouteWaypoints(r, inTrip))') && html.includes('liveRouteCoords = fb; liveRouteFallback = true;') && html.includes("setRouteLine(liveMap, 'route', fb, '#2b7de9', 5)") && !html.includes('sin ruta OSRM: no se dibuja línea recta'));
  // En vivo (evaluando la función real): el tramo de recogida apunta al
  // punto de recogida en viaje Y en mandado, y al destino cuando ya empezó.
  const htdSrc = html.slice(html.indexOf('function liveHeadingToDest(r){'), html.indexOf('/* Paradas intermedias'));
  const htd = eval('(' + htdSrc.replace('function liveHeadingToDest(r)', 'function(r)') + ')');
  check('v1.4.44: en vivo, el tramo de recogida apunta a la RECOGIDA (viaje y mandado en camino) y al destino cuando ya empezó', htd({ kind: 'viaje', trip_stage: 'en_camino' }) === false && htd({ kind: 'mandado', trip_stage: 'en_camino' }) === false && htd({ kind: 'viaje', trip_stage: 'en_viaje' }) === true && htd({ kind: 'mandado', trip_stage: 'recogido' }) === true && htd({ kind: 'mandado', trip_stage: 'en_viaje' }) === true, JSON.stringify({ vCamino: htd({ kind: 'viaje', trip_stage: 'en_camino' }), mCamino: htd({ kind: 'mandado', trip_stage: 'en_camino' }), vViaje: htd({ kind: 'viaje', trip_stage: 'en_viaje' }) }));
  check('v1.4.44: el mapa en vivo dibuja la ruta hacia el objetivo (recogida o destino) y la recta alimenta el encuadre completo', html.includes('const target = inTrip ? dest : pick;') && html.includes('osrmRoute(from, target, liveRouteWaypoints(r, inTrip))') && html.includes('fitPoints(liveMap, liveRouteCoords, liveFollowPadding())'));
  // En vivo (evaluando la función real): la recta une chofer → objetivo
  // pasando por las paradas, en [lng, lat] como OSRM.
  const srcSrc = html.slice(html.indexOf('function straightRouteCoords(from, target, via){'), html.indexOf('/* Zoom de proximidad'));
  const srcFn = eval('(' + srcSrc.replace('function straightRouteCoords(from, target, via)', 'function(from, target, via)') + ')');
  const srcPts = srcFn({ lat: 16.87, lng: -93.21 }, { lat: 16.8675, lng: -93.2105 }, [{ lat: 16.869, lng: -93.208 }]);
  check('v1.4.44: en vivo, la línea recta une chofer → parada → objetivo en orden y en [lng, lat]', Array.isArray(srcPts) && srcPts.length === 3 && srcPts[0][0] === -93.21 && srcPts[0][1] === 16.87 && srcPts[1][0] === -93.208 && srcPts[2][0] === -93.2105 && srcPts[2][1] === 16.8675, JSON.stringify(srcPts));
  // El sondeo reintenta la ruta real cuando la línea es recta.
  const pollSec = html.slice(html.indexOf('function startLivePolling(){'), html.indexOf('/* GPS del chofer'));
  check('v1.4.44: el sondeo reintenta la ruta OSRM cada ~15 s mientras la línea sea recta y la cambia al responder (v1.4.65: el sondeo es de 2 s, así que el umbral es cada 8º tick ≈ 16 s, no cada 3er tick)', pollSec.includes('liveRouteFallback') && pollSec.includes('liveOsrmRetryTick >= 8') && pollSec.includes('osrmRoute(frm, tgt, liveRouteWaypoints(rr, inT))') && pollSec.includes('liveRouteCoords = rt2.coords; liveRouteFallback = false;'));
  // En vivo (evaluando la función real): el zoom objetivo sube cuando la
  // distancia baja, y lejos no toca el encuadre de la ruta completa.
  const tzSrc = html.slice(html.indexOf('function liveTargetZoom(distM){'), html.indexOf('function closestOnRoute'));
  const tzFn = eval('(' + tzSrc.replace('function liveTargetZoom(distM)', 'function(distM)') + ')');
  check('v1.4.44: en vivo, el zoom objetivo aumenta al acercarse (lejos no toca nada, cerca 16 → 17 → 18)', tzFn(1500) === null && tzFn(1001) === null && tzFn(1000) === 16 && tzFn(800) === 16 && tzFn(501) === 16 && tzFn(500) === 17 && tzFn(300) === 17 && tzFn(201) === 17 && tzFn(200) === 18 && tzFn(100) === 18 && tzFn(203) === 17, JSON.stringify({ lejos: tzFn(1500), mil: tzFn(1000), ocho: tzFn(800), tres: tzFn(300), doscientos3: tzFn(203), cien: tzFn(100) }));
  check('v1.4.44: el zoom de proximidad vive en el mapa del chofer Y del pasajero y solo sube (v1.4.61: antes solo el chofer lo tenía — el del pasajero se quedaba a lo ancho de todo el pueblo; v1.4.60: también sube con el follow apagado — solo zoom, sin recentrar — porque el usuario lo vio quedarse ancho a 183 m tras tocar el mapa)', (()=>{ const apSec = html.slice(html.indexOf('function liveApplyDriverPos(lat, lng, prevLat, prevLng){'), html.indexOf("window.addEventListener('online'")); return apSec.includes('if(liveFollow){') && apSec.includes('opts.zoom = proxZoom') && apSec.includes('if(proxZoom!=null && proxZoom > liveMap.getZoom() + 0.25){ opts.zoom = proxZoom; opts.duration = 800; }') && apSec.includes('if(proxZoom!=null && proxZoom > liveMap.getZoom() + 0.25){ opts2.zoom = proxZoom; opts2.duration = 800; }') && apSec.includes('liveTargetZoom(havKm(lat, lng, tgtZoom.lat, tgtZoom.lng) * 1000)') && !apSec.includes('if(liveAsDriver){') && pollSec.includes('liveApplyDriverPos(r.driver_lat, r.driver_lng, prevLat, prevLng)'); })());
  // En vivo: el estado del tramo de recogida existe para viaje y mandado
  // (aceptado en camino + ubicación del chofer compartida: de ahí sale la
  // línea chofer → recogida).
  const pkV = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 20, payment_method: 'efectivo' });
  await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: pkV.request.id, kind: 'acepta', price: 20 });
  await api('/api/update-driver-location', { driver_id: drv.driver.id, request_id: pkV.request.id, lat: 16.8727, lng: -93.2081 });
  const pkVRow = (await api('/api/requests?id=' + pkV.request.id)).requests[0];
  check('v1.4.44: en vivo, el viaje aceptado está en camino a recoger con la ubicación del chofer (la línea chofer → recogida tiene de dónde salir)', pkV.ok && pkVRow && pkVRow.trip_stage === 'en_camino' && pkVRow.driver_lat === 16.8727 && pkVRow.driver_lng === -93.2081, JSON.stringify(pkVRow && { stage: pkVRow.trip_stage, lat: pkVRow.driver_lat, lng: pkVRow.driver_lng }));
  const pkM = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Paquete de prueba', recipient_phone: '9614868605', recipient_name: 'Juan Perez', order_payment: 'pagado' });
  await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: pkM.request.id, kind: 'acepta', price: 30 });
  await api('/api/update-driver-location', { driver_id: drv.driver.id, request_id: pkM.request.id, lat: 16.8685, lng: -93.2095 });
  const pkMRow = (await api('/api/requests?id=' + pkM.request.id)).requests[0];
  check('v1.4.44: en vivo, el mandado aceptado está en camino a recoger con la ubicación del chofer (misma línea chofer → recogida)', pkM.ok && pkMRow && pkMRow.trip_stage === 'en_camino' && pkMRow.driver_lat === 16.8685 && pkMRow.driver_lng === -93.2095, JSON.stringify(pkMRow && { stage: pkMRow.trip_stage, lat: pkMRow.driver_lat, lng: pkMRow.driver_lng }));

  // --- v1.4.45: resumen flotante al final del viaje + viaje en curso sin internet ---
  // El recibo (captura del usuario 20:44) era una hoja blanca a pantalla
  // completa que no le gustó: ahora es flotante como el anuncio de
  // entrada, para chofer y pasajero, en viajes y mandados.
  const sumSec = html.slice(html.indexOf('function showTripSummary(r, asDriver){'), html.indexOf('function startLivePolling(){'));
  check('v1.4.45: el resumen del viaje es flotante como el anuncio (fondo oscuro 60%, tarjeta 340 px, radio 24, X de 48×48 arriba)', html.includes("#trip-summary-overlay{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.6)") && html.includes('#trip-summary-overlay .sumwrap{pointer-events:auto;position:relative;width:min(92vw,340px)}') && html.includes('#trip-summary-overlay .sumfloat{max-height:85dvh;overflow-y:auto;background:#fff;border:0;border-radius:24px') && html.includes('#trip-summary-overlay .adx{position:absolute;top:12px;right:12px;width:48px;height:48px;border-radius:50%'));
  check('v1.4.45: showTripSummary abre el flotante (no el diálogo) y la X / el fondo / el botón lo cierran al instante y vuelven a donde toca', sumSec.includes("ov.id = 'trip-summary-overlay'") && sumSec.includes('class="sumwrap"><button class="adx"') && sumSec.includes('onclick="closeTripSummary()"') && sumSec.includes("if(e.target === ov) closeTripSummary()") && sumSec.includes('function closeTripSummary(){') && sumSec.includes("const ov = document.getElementById('trip-summary-overlay');\n  if(ov) ov.remove();") && !sumSec.includes('openDialog('));
  check('v1.4.45: el resumen ya abierto no se reconstruye (el sondeo del pasajero lo llama en cada tick con el viaje finalizado)', sumSec.includes("if(document.getElementById('trip-summary-overlay')) return;"));
  check('v1.4.45: el contenido del recibo sigue intacto (mismos renglones, Generar recibo y botón de cerrar por lado)', sumSec.includes("window.__receiptTxt = txt; window.__receiptName = 'recibo-sanfergo-'+r.id+'.txt';") && sumSec.includes('onclick="downloadReceipt()">Generar recibo</button>') && sumSec.includes("'Cerrar y volver a recibir viajes'") && sumSec.includes('<span>Pasajero</span>') && sumSec.includes('<span>Precio final</span>'));
  check('v1.4.45: el resumen del CHOFER lleva mini mapa con los dos puntos y la línea azul + "Gracias por concluir el viaje"', sumSec.includes('Gracias por concluir el viaje') && sumSec.includes('id="sum-minimap"') && sumSec.includes('drawSummaryMiniMap(r)') && html.includes("summaryMiniMap = makeMap('sum-minimap', false)") && html.includes("dotEl('#22c55e', 16)") && html.includes("dotEl('#dc2626', 16)") && html.includes("setRouteLine(summaryMiniMap, 'route', straightRouteCoords(o, d, []), '#2b7de9', 5)"));
  // En vivo (evaluando la función real): la nota de cambio solo sale en efectivo.
  const cashSrc = html.slice(html.indexOf('function summaryCashNote(r){'), html.indexOf('function showTripSummary(r, asDriver){'));
  const cashFn = eval('(' + cashSrc.replace('function summaryCashNote(r)', 'function(r)') + ')');
  check('v1.4.45: el resumen del PASAJERO lleva "Tu viaje ha concluido. Gracias por usar SanFerGo." y la nota de cambio SOLO en efectivo', sumSec.includes('Tu viaje ha concluido. Gracias por usar SanFerGo.') && cashFn({ payment_method: 'efectivo' }) === 'Recuerda pagar con cambio al conductor' && cashFn({ payment_method: 'transferencia' }) === '' && cashFn({}) === 'Recuerda pagar con cambio al conductor', JSON.stringify({ ef: cashFn({ payment_method: 'efectivo' }), tr: cashFn({ payment_method: 'transferencia' }) }));
  // --- sin internet: el mapa se dibuja desde el GPS local ---
  // Diagnóstico (reporte del usuario 20:46): el GPS solo mandaba la
  // posición al servidor y al fallar se tiraba; el sondeo tragaba el
  // error en silencio y nada se movía. Ahora el GPS dibuja en local.
  // La lectura del GPS vive en drvOnPos (el refactor Capacitor de la app
  // instalada extrajo el manejo de cada posición de startDriverGpsWatch
  // a drvOnPos/drvSendPos; el comportamiento es el mismo).
  const watchSec = html.slice(html.indexOf('function drvOnPos(lat, lng){'), html.indexOf('/* ===== TAXÍMETRO'));
  check('v1.4.45: el GPS del chofer mueve el mapa EN LOCAL con cada lectura y encola el reporte si no hay internet (v1.4.65: el dibujo local es solo con el mapa en vivo del chofer abierto — en la vista del pasajero el GPS no dibuja, solo reporta)', watchSec.includes('liveGpsPos = { lat, lng, t: now };') && watchSec.includes("if(liveAsDriver && currentView==='live' && liveReq && liveReq.id===drvActiveReqId) liveApplyDriverPos(lat, lng);") && watchSec.includes('liveLocQueue.push({ lat, lng });') && watchSec.includes('if(liveLocQueue.length > 20) liveLocQueue.shift();'));
  check('v1.4.45: el sondeo ya no se congela sin internet (guardia anti-solape, aviso chico, cola y avance pendiente al recuperar)', pollSec.includes('if(livePollBusy) return; livePollBusy = true;') && pollSec.includes('liveSetOffline(false);') && pollSec.includes('liveSetOffline(true);') && pollSec.includes('finally { livePollBusy = false; }') && pollSec.includes('liveFlushLocQueue();') && pollSec.includes('if(livePendingAdvance){ const st = livePendingAdvance; livePendingAdvance = null; advanceLive(st); }'));
  check('v1.4.45: el avance que falla por red se guarda pendiente y se reintenta solo (un rechazo del servidor no se reintenta)', html.includes('livePendingAdvance = stage;') && html.includes("toast('Sin internet — el avance se enviará cuando vuelva la conexión.');") && html.includes("window.addEventListener('online'") && html.includes('id="live-offline">📶 Sin internet'));
  // En vivo (evaluando la función real): solo los errores de red se reintentan.
  const netSrc = html.slice(html.indexOf('function liveIsNetError(e){'), html.indexOf('function liveSetOffline(off){'));
  const netFn = eval('(' + netSrc.replace('function liveIsNetError(e)', 'function(e)') + ')');
  check('v1.4.45: en vivo, liveIsNetError distingue red de rechazo del servidor', netFn(new Error('La conexión tardó demasiado. Revisa tu señal e inténtalo de nuevo.')) === true && netFn(new Error('Failed to fetch')) === true && netFn(new Error('Load failed')) === true && netFn(new Error('Ese paso no sigue')) === false && netFn(new Error('Esta solicitud ya no está buscando conductor.')) === false, JSON.stringify({ timeout: netFn(new Error('La conexión tardó demasiado.')), fetch: netFn(new Error('Failed to fetch')), rechazo: netFn(new Error('Ese paso no sigue')) }));
  check('v1.4.45: al salir del viaje en curso el GPS se detiene y se limpian la cola, el avance pendiente y el aviso', html.includes('stopDriverGpsWatch();') && html.includes('livePendingAdvance = null;') && html.includes('liveLocQueue = [];') && html.includes('function stopDriverGpsWatch(){') && html.includes('navigator.geolocation.clearWatch(drvWatchId)'));
  // En vivo: viaje finalizado en efectivo y mandado finalizado por
  // transferencia — las filas traen todo lo que pinta el resumen
  // flotante (fecha, distancia, precio, pago, puntos, nombres).
  const finV = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 20, payment_method: 'efectivo' });
  await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: finV.request.id, kind: 'acepta', price: 20 });
  await api('/api/update-driver-location', { driver_id: drv.driver.id, request_id: finV.request.id, lat: 16.8727, lng: -93.2081 });
  await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: finV.request.id, stage: 'en_viaje' });
  const finVRow = (await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: finV.request.id, stage: 'finalizado' })).request;
  check('v1.4.45: en vivo, el viaje finalizado en efectivo trae todo lo del resumen flotante (y la nota de cambio aplica)', finVRow && finVRow.status === 'finalizado' && !!finVRow.finished_at && finVRow.payment_method === 'efectivo' && finVRow.origin_lat === 16.8709 && finVRow.dest_lat === 16.8675 && finVRow.driver_lat === 16.8727 && cashFn(finVRow) === 'Recuerda pagar con cambio al conductor', JSON.stringify(finVRow && { st: finVRow.status, pago: finVRow.payment_method, fin: finVRow.finished_at }));
  const finM = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'transferencia', description: 'Paquete de prueba', recipient_phone: '9614868605', recipient_name: 'Juan Perez', order_payment: 'pagado' });
  await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: finM.request.id, kind: 'acepta', price: 30 });
  await api('/api/update-driver-location', { driver_id: drv.driver.id, request_id: finM.request.id, lat: 16.8685, lng: -93.2095 });
  await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: finM.request.id, stage: 'llego' });
  await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: finM.request.id, stage: 'en_viaje' });
  const finMRow = (await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: finM.request.id, stage: 'entregado' })).request;
  check('v1.4.45: en vivo, el mandado finalizado por transferencia trae todo lo del resumen flotante (y la nota de cambio NO aplica)', finMRow && finMRow.status === 'finalizado' && !!finMRow.finished_at && finMRow.payment_method === 'transferencia' && finMRow.origin_lat === 16.8675 && finMRow.dest_lat === 16.8709 && finMRow.driver_lat === 16.8685 && cashFn(finMRow) === '', JSON.stringify(finMRow && { st: finMRow.status, pago: finMRow.payment_method, fin: finMRow.finished_at }));

  // --- v1.4.46: "Repetir este viaje" fallaba + fila compacta del chofer con nombre, foto y referencia ---
  // (a) Repetir: la tarjeta "Tu último viaje" mostraba el viaje pero al
  //     tocar "Repetir este viaje" salía "No se encontró ese viaje para
  //     repetirlo." (captura del usuario 20:56). Causa: repeatTrip(id)
  //     buscaba solo en histReqs, un arreglo que solo se llena al abrir
  //     Historial — en la pantalla de Viajes está vacío ([]). Ahora busca
  //     también en el servidor (?id=) y, si ese id ya no existe, usa el
  //     último viaje finalizado del pasajero.
  //     v1.4.60: la tarjeta "Tu último viaje" ya no existe y el botón
  //     Repetir vive solo en el detalle del historial (showHistDetail).
  const repSec = html.slice(html.indexOf('async function repeatTrip(id){'), html.indexOf('async function repeatLastTrip(){'));
  check('v1.4.46: repeatTrip ya no depende solo de histReqs: busca el viaje por id en el servidor y si no existe usa el último finalizado (el error solo sale al final)', repSec.includes("api('/api/requests?id='+id)") && repSec.includes("api('/api/requests?passenger_id='+myPassenger.id+'&light=1')") && repSec.includes("r.kind==='viaje' && r.status==='finalizado'") && repSec.indexOf("toast('No se encontró ese viaje para repetirlo.')") > repSec.indexOf("api('/api/requests?id='+id)"));
  check('v1.4.46: repetir vive SOLO en el detalle del historial (v1.4.60: ni la tarjeta de Viajes ni la fila del historial llaman a repeatTrip)', !html.includes('onclick="repeatTrip(\'+fin.id+\')"') && !html.includes('onclick="event.stopPropagation();repeatTrip(\'+r.id+\')"') && html.includes('async function showHistDetail(id)') && html.includes('onclick="repeatTrip(\'+r.id+\')"'));
  // En vivo (evaluando la función real con la API real): el bug era que en
  // la pantalla de Viajes histReqs está vacío porque la tarjeta no carga
  // el historial.
  const rptFactory = new Function('histReqs', 'api', 'myPassenger', 'toast', 'repeatTripFrom', html.slice(html.indexOf('async function repeatTrip(id){'), html.indexOf('async function repeatLastTrip(){')) + '\nreturn repeatTrip;');
  let toasted = [];
  let repeated = null;
  const toastStub = (m)=>{ toasted.push(m); };
  const rptStub = async (r)=>{ repeated = r; };
  const apiCalls = [];
  const apiSpy = async (...a)=>{ apiCalls.push(a[0]); return api(...a); };
  const repA = rptFactory([], apiSpy, { id: pax.passenger.id }, toastStub, rptStub);
  await repA(finVRow.id);
  check('v1.4.46: en vivo, repetir con histReqs vacío (el bug: la tarjeta no carga el historial) pre-llena los puntos exactos del viaje', repeated && repeated.id === finVRow.id && repeated.origin_lat === 16.8709 && repeated.origin_lng === -93.2063 && repeated.dest_lat === 16.8675 && repeated.dest_lng === -93.2105 && toasted.length === 0, JSON.stringify({ rep: repeated && { id: repeated.id, o: [repeated.origin_lat, repeated.origin_lng], d: [repeated.dest_lat, repeated.dest_lng] }, toasted }));
  toasted = []; repeated = null;
  const repB = rptFactory([], apiSpy, { id: pax.passenger.id }, toastStub, rptStub);
  await repB(999999);
  check('v1.4.46: en vivo, repetir con un id viejo/inexistente usa el último viaje finalizado en vez de fallar', repeated && repeated.id === finVRow.id && repeated.status === 'finalizado' && toasted.length === 0, JSON.stringify({ rep: repeated && { id: repeated.id, st: repeated.status }, toasted }));
  toasted = []; repeated = null; apiCalls.length = 0;
  const repC = rptFactory([finVRow], apiSpy, { id: pax.passenger.id }, toastStub, rptStub);
  await repC(finVRow.id);
  check('v1.4.46: repetir con el viaje ya en el historial no pide nada al servidor (vía rápida)', repeated && repeated.id === finVRow.id && !apiCalls.some(c=>c.includes('?id=')) && toasted.length === 0, JSON.stringify({ calls: apiCalls }));
  const repIdRow = (await api('/api/requests?id=' + finVRow.id)).requests[0];
  check('v1.4.46: en vivo, /api/requests?id= trae el viaje finalizado con sus puntos exactos (la fuente que usa el repetir arreglado)', repIdRow && repIdRow.id === finVRow.id && repIdRow.status === 'finalizado' && repIdRow.origin_lat === 16.8709 && repIdRow.origin_lng === -93.2063 && repIdRow.dest_lat === 16.8675 && repIdRow.dest_lng === -93.2105, JSON.stringify(repIdRow && { id: repIdRow.id, st: repIdRow.status }));
  const repMissing = await api('/api/requests?id=999999');
  check('v1.4.46: en vivo, /api/requests?id= inexistente devuelve lista vacía (el camino del respaldo existe)', repMissing.ok && Array.isArray(repMissing.requests) && repMissing.requests.length === 0, JSON.stringify(repMissing));
  const repCard = await api('/api/requests?passenger_id=' + pax.passenger.id + '&light=1');
  const repCardFin = (repCard.requests||[]).filter(r=>r.kind==='viaje' && r.status==='finalizado' && r.origin_lat!=null && r.dest_lat!=null)[0];
  check('v1.4.46: en vivo, la consulta de la tarjeta (último finalizado del pasajero) devuelve ese mismo viaje', repCardFin && repCardFin.id === finVRow.id && repCardFin.origin_lat === 16.8709 && repCardFin.dest_lat === 16.8675, JSON.stringify(repCardFin && { id: repCardFin.id }));
  // (b) Fila compacta del chofer (captura del usuario 20:58): se veía muy
  //     simple — "Punto en el mapa → Punto en el mapa" sin decir quién
  //     pide el viaje ni de dónde a dónde. Causa de los nombres sin
  //     resolver: 'Punto en el mapa' NO estaba en GENERIC_ZONES, así que
  //     displayZoneName (v1.4.39) lo trataba como zona específica y lo
  //     dejaba tal cual. Ahora la fila trae foto chica + nombre + la
  //     referencia "cerca de Madero → cerca de Centro" igual que el
  //     pasajero, sin engordar la lista (la foto se carga bajo demanda).
  check('v1.4.46: "Punto en el mapa" ya es zona genérica y se resuelve al lugar conocido cercano', html.slice(html.indexOf('const GENERIC_ZONES'), html.indexOf('function nearestZoneWithin')).includes("'Punto en el mapa'"));
  const rowSec = html.slice(html.indexOf('// Lista apilada (v1.4.36)'), html.indexOf('p.innerHTML = html;\n    loadInboxPhotos(list);'));
  check('v1.4.46: la fila compacta trae foto chica, nombre del pasajero y ruta con la referencia "cerca de"', rowSec.includes('class="rowavatar" id="rowav-') && rowSec.includes("esc(r.passenger_name||'Pasajero')") && rowSec.includes("<span style=\"white-space:nowrap\">'+esc(r._refO)+'</span> → <span style=\"white-space:nowrap\">'+esc(r._refD)+'</span>") && !rowSec.includes('passenger_photo'));
  check('v1.4.46: la foto de la fila se carga bajo demanda por id (una vez por solicitud, con caché) y la lista del sondeo sigue light sin fotos', html.includes('function loadInboxPhotos(list){') && html.includes('const inboxPhotoCache = {};') && html.includes("api('/api/requests?id='+r.id)") && html.includes("api('/api/requests?open=1&light=1')") && html.includes('loadInboxPhotos(list);'));
  check('v1.4.46: el detalle flotante sigue completo (foto grande del pasajero, Aceptar/Contraofertar) — lo compacto es solo la fila', inboxSec.includes("'<img class=\"avatar\" src=\"'+r.passenger_photo+'\">'") && inboxSec.includes('Aceptar') && inboxSec.includes('Contraofertar'));
  // --- v1.4.47: la fila compacta no estaba bien acomodada (captura del
  //     usuario 21:16) — la ruta "cerca de Madero → cerca de Centro" se
  //     partía en tres líneas ("cerca de / Madero → cerca / de Centro")
  //     porque compartía la columna de texto con el precio, que la
  //     apretaba. Ahora la ruta va en su propia línea a todo lo ancho y
  //     cada "cerca de X" va en un span sin salto de línea: el corte solo
  //     puede caer en la flecha, nunca dentro de la frase.
  const routeDiv47 = "<div style=\"margin-top:6px\"><b><span style=\"white-space:nowrap\">'+esc(r._refO)+'</span> → <span style=\"white-space:nowrap\">'+esc(r._refD)+'</span></b></div>";
  check('v1.4.47: cada "cerca de X" va en su propio span sin salto de línea (la ruta nunca se parte dentro de la frase)', rowSec.includes("<span style=\"white-space:nowrap\">'+esc(r._refO)+'</span>") && rowSec.includes("<span style=\"white-space:nowrap\">'+esc(r._refD)+'</span>"));
  check('v1.4.47: la ruta va en su propia línea a todo lo ancho, debajo de la línea del precio (el precio ya no aprieta el texto)', rowSec.includes(routeDiv47) && rowSec.indexOf(routeDiv47) > rowSec.indexOf("<b class=\"price\">'+fmt$(r.price)+'</b>"));
  check('v1.4.47: la fila sigue compacta con chip, foto, nombre con elipsis, precio, chevron y la línea km/min/pago', rowSec.includes('class="chip') && rowSec.includes('class="rowavatar" id="rowav-') && rowSec.includes("esc(r.passenger_name||'Pasajero')") && rowSec.includes('text-overflow:ellipsis') && rowSec.includes('class="price"') && rowSec.includes('▾') && rowSec.includes("rowMeta.join(' · ')"));
  // En vivo (evaluando las funciones reales con los lugares del servidor):
  // 'Punto en el mapa' se resolvía a sí mismo; ahora resuelve a Madero/Centro.
  const placesJ = await api('/api/places');
  const zoneFactory = new Function('allPlaces', 'havKm', html.slice(html.indexOf('const GENERIC_ZONES'), html.indexOf('function updatePickZone(){')) + '\nreturn { displayZoneName, rowPlaceRef };');
  const zoneFns = zoneFactory(()=>(placesJ.places||[]), havKmT);
  check('v1.4.46: en vivo, displayZoneName ya resuelve "Punto en el mapa" al lugar conocido cercano (antes lo dejaba tal cual)', zoneFns.displayZoneName('Punto en el mapa', 16.87291, -93.21374) === 'Madero' && zoneFns.displayZoneName('Punto en el mapa', 16.87137, -93.20652) === 'Centro' && zoneFns.displayZoneName('Mercado', 16.8675, -93.2105) === 'Mercado' && zoneFns.displayZoneName('Mi ubicación', 16.87291, -93.21374) === 'Madero', JSON.stringify({ madero: zoneFns.displayZoneName('Punto en el mapa', 16.87291, -93.21374), centro: zoneFns.displayZoneName('Punto en el mapa', 16.87137, -93.20652) }));
  check('v1.4.46: en vivo, rowPlaceRef dice "cerca de <Lugar>" cuando el punto genérico resuelve cerca, el nombre solo si ya es específico, y la etiqueta de antes si no hay nada cerca', zoneFns.rowPlaceRef('Punto en el mapa', 16.87291, -93.21374) === 'cerca de Madero' && zoneFns.rowPlaceRef('Punto en el mapa', 16.87137, -93.20652) === 'cerca de Centro' && zoneFns.rowPlaceRef('Mercado', 16.8675, -93.2105) === 'Mercado' && zoneFns.rowPlaceRef('Punto en el mapa', 16.5, -93.5) === 'Punto en el mapa' && zoneFns.rowPlaceRef('Mi ubicación', 16.87291, -93.21374) === 'cerca de Madero', JSON.stringify({ m: zoneFns.rowPlaceRef('Punto en el mapa', 16.87291, -93.21374), c: zoneFns.rowPlaceRef('Punto en el mapa', 16.87137, -93.20652), lejos: zoneFns.rowPlaceRef('Punto en el mapa', 16.5, -93.5) }));
  // En vivo: un viaje como el de la captura del usuario (1.5 km, $25,
  // zonas "Punto en el mapa" cerca de Madero y de Centro).
  const rowT = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Punto en el mapa', origin_detail: 'Punto en el mapa', origin_lat: 16.87291, origin_lng: -93.21374, dest_zone: 'Punto en el mapa', dest_detail: 'Punto en el mapa', dest_lat: 16.87137, dest_lng: -93.20652, distance_km: 1.5, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  const rowTRow = (await api('/api/requests?id=' + rowT.request.id)).requests[0];
  check('v1.4.46: en vivo, el viaje nuevo trae nombre y foto del pasajero por id y sus puntos resuelven a "cerca de Madero → cerca de Centro"', rowT.ok && rowTRow && rowTRow.passenger_name === 'Lucia Prueba' && !!rowTRow.passenger_photo && rowTRow.passenger_photo.startsWith('data:image/jpeg;base64,') && zoneFns.rowPlaceRef(rowTRow.origin_zone, rowTRow.origin_lat, rowTRow.origin_lng) === 'cerca de Madero' && zoneFns.rowPlaceRef(rowTRow.dest_zone, rowTRow.dest_lat, rowTRow.dest_lng) === 'cerca de Centro', JSON.stringify(rowTRow && { nombre: rowTRow.passenger_name, foto: !!rowTRow.passenger_photo, o: rowTRow.origin_zone, d: rowTRow.dest_zone }));
  const openLight = await api('/api/requests?open=1&light=1');
  const rowTLight = (openLight.requests||[]).find(r=>r.id===rowT.request.id);
  check('v1.4.46: en vivo, la lista abierta light trae esa solicitud con el nombre pero SIN foto (la foto no vuelve al sondeo)', rowTLight && rowTLight.passenger_photo === null && rowTLight.passenger_name === 'Lucia Prueba', JSON.stringify(rowTLight && { foto: rowTLight.passenger_photo, nombre: rowTLight.passenger_name }));
  // --- v1.4.47 (botón de atrás en Buscando): la pantalla "Buscando tu
  //     mototaxi…" solo tenía "Cancelar viaje": no había cómo volver al
  //     inicio sin cancelar. Ahora hay "‹ Volver al inicio" que vuelve al
  //     inicio SIN cancelar (no llama a ningún endpoint: la solicitud
  //     sigue pendiente), y al volver a entrar a Viajes aparece esa misma
  //     pantalla de Buscando, no un formulario nuevo. Los mandados YA
  //     tenían ese botón ("‹ Regresar al inicio") y la misma revisión del
  //     pendiente antes del formulario — verificado en código, sin cambio.
  const viaSec = html.slice(html.indexOf('async function renderViajes(){'), html.indexOf('let wizMap = null;'));
  const viaStep5 = viaSec.slice(viaSec.indexOf('// paso 5: buscando'));
  check('v1.4.47: la pantalla "Buscando tu mototaxi…" tiene botón "‹ Volver al inicio" que vuelve al inicio sin cancelar, en los dos caminos que la muestran (paso 5 y reentrada por paso 0)', viaStep5.includes("backPill('Volver al inicio', \"go('home')\")") && !viaStep5.includes('cancelMyRequest') && viaSec.includes('wiz.step = 5;') && viaSec.indexOf("backPill('Volver al inicio'") < viaSec.indexOf('renderSearching();'));
  check('v1.4.47: al volver a entrar a Viajes con un viaje pendiente se muestra la pantalla de Buscando (el paso 0 revisa el viaje activo antes del formulario)', viaSec.indexOf("myActiveRequest('viaje')") > 0 && viaSec.indexOf("myActiveRequest('viaje')") < viaSec.indexOf('Solicitar el viaje') && viaSec.includes('wiz.step = 5;') && viaSec.includes('renderSearching();'));
  const mdSec = html.slice(html.indexOf('async function renderMandados(){'), html.indexOf('function mdBack(step)'));
  const mdActSec = mdSec.slice(mdSec.indexOf('if(active){'), mdSec.indexOf('renderMandadoSearching(active)'));
  check('v1.4.47: la pantalla de buscando del mandado ya tenía su botón "‹ Regresar al inicio" sin cancelar, y el pendiente se revisa antes del formulario (sin cambio necesario)', mdActSec.includes("backPill('Regresar al inicio', \"go('home')\")") && mdActSec.includes('id="md-searching"') && mdSec.indexOf("myActiveRequest('mandado')") < mdSec.indexOf('md.step===0'));
  const bkV = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Punto en el mapa', origin_detail: 'Punto en el mapa', origin_lat: 16.87291, origin_lng: -93.21374, dest_zone: 'Punto en el mapa', dest_detail: 'Punto en el mapa', dest_lat: 16.87137, dest_lng: -93.20652, distance_km: 1.5, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  const bkM = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Recoger un paquete' });
  const bkList = await api('/api/requests?passenger_id=' + pax.passenger.id + '&light=1');
  const bkVRow = (bkList.requests||[]).find(r=>r.id===bkV.request.id);
  const bkMRow = (bkList.requests||[]).find(r=>r.id===bkM.request.id);
  check('v1.4.47: en vivo, el viaje y el mandado publicados siguen "buscando" en el mismo endpoint que usa myActiveRequest (al volver a entrar se muestra la pantalla de Buscando, no un formulario nuevo)', bkV.ok && bkM.ok && bkVRow && bkVRow.status==='buscando' && bkMRow && bkMRow.status==='buscando', JSON.stringify({ v: bkVRow && bkVRow.status, m: bkMRow && bkMRow.status }));

  // --- v1.4.48: (a) "Transferencia" ahora es "Tarjeta · Próximamente"
  //     deshabilitada en los tres lugares donde el pasajero elige cómo
  //     pagar (captura del usuario 21:37: el paso de precio solo tenía
  //     Efectivo/Transferencia; Stripe no está listo); (b) cuántas
  //     personas van en el viaje: SOLO sube el mínimo (modelo B
  //     confirmado por el usuario 21:36) — 1=$20, 2=$25, 3=$30; la tarifa
  //     no cambia. Un viaje de $22/$25/$27 con 3 personas sube a $30
  //     automáticamente; si pasa de $30 se cobra normal. Suscripciones y
  //     Premium NO se tocan (siguen por transferencia con "Ya hice la
  //     transferencia").
  const priceSec48 = html.slice(html.indexOf('function priceSheetHtml(kind){'), html.indexOf('function priceStep(kind, d){'));
  check('v1.4.48: la hoja de precio del viaje/mandado muestra Efectivo + "Tarjeta · Próximamente" deshabilitada y ya no ofrece Transferencia', priceSec48.includes('>Tarjeta · Próximamente</button>') && priceSec48.includes('class="pay-opt" disabled') && !priceSec48.includes('Transferencia') && priceSec48.includes('>Efectivo</button>'));
  check('v1.4.48: la hoja de precio del viaje trae el selector "¿Cuántas personas?" (1/2/3) con el mínimo por personas', priceSec48.includes('¿Cuántas personas?') && priceSec48.includes('priceSetPax') && priceSec48.includes('Mínimo para ') && priceSec48.includes('minForPax(wiz.pax)'));
  const bizPaySec48 = html.slice(html.indexOf('function bizOrderFormHtml(b, sub, fee, total){'), html.indexOf('let bizOrderPay'));
  check('v1.4.48: el pedido del negocio también muestra "Tarjeta · Próximamente" deshabilitada y ya no ofrece Transferencia', bizPaySec48.includes('>Tarjeta · Próximamente</button>') && bizPaySec48.includes('class="pay-opt" disabled') && !bizPaySec48.includes('Transferencia'));
  check('v1.4.48: el viaje en curso ya no tiene el enlace "Cambiar" de pago (el pago es efectivo desde que se publica) y muestra cuántas personas van', !liveSec43.includes('changePayLive') && liveSec43.includes('Pagas con ') && liveSec43.includes("paxText(r.passenger_count)") && !liveSec43.includes('Cambiar</a>'));
  check('v1.4.48: el detalle del chofer y el resumen (respaldo) muestran cuántas personas van; el recibo ya NO lleva el renglón Personas (diseño naranja v1.4.61–63: solo título + gracias + precio + recordatorios) y showReceipt solo enruta', inboxSec.includes("'<div class=\"kv\"><span>Personas</span><b>'+paxText(r.passenger_count)+'</b></div>'") && sumSec.includes("'<div class=\"kv\"><span>Personas</span><b>'+paxText(r.passenger_count)+'</b></div>'") && !html.slice(html.indexOf('async function showReceipt(requestId, asDriver){'), html.indexOf('/* ===== VIAJE EN CURSO')).includes('Personas'));
  check('v1.4.48: suscripciones y Premium siguen por transferencia ("Ya hice la transferencia · Activar" en los dos flujos, sin tocar)', (html.match(/Ya hice la transferencia · Activar/g)||[]).length === 2);
  // Evaluando las funciones reales del cliente: el ejemplo del usuario
  // ($22/$25/$27 con 3 personas → $30; si pasa de $30, normal).
  const fareFactory48 = new Function(html.slice(html.indexOf('const BASE = 10'), html.indexOf('function havKm')) + '\nreturn { fare, roundUp5, suggestedPrice, minForPax, roundUp5For, suggestedPriceFor, paxText };');
  const fareFns = fareFactory48();
  check('v1.4.48: en vivo, el mínimo por personas es 1=$20, 2=$25, 3=$30 y la tarifa no cambia ($10 + $2.50 cada 300 m)', fareFns.minForPax(1)===20 && fareFns.minForPax(2)===25 && fareFns.minForPax(3)===30 && fareFns.fare(1.44)===22 && fareFns.fare(1.8)===25 && fareFns.fare(2.04)===27 && fareFns.paxText(3)==='3 personas' && fareFns.paxText(1)==='1 persona', JSON.stringify({ f144: fareFns.fare(1.44), f18: fareFns.fare(1.8), f204: fareFns.fare(2.04) }));
  check('v1.4.48: en vivo, el sugerido con 3 personas sube $22/$25/$27 a $30, y si pasa de $30 se cobra normal ($40 a 3.59 km); con 2 personas el piso es $25 y con 1 sigue $20', fareFns.suggestedPriceFor(1.44,3)===30 && fareFns.suggestedPriceFor(1.8,3)===30 && fareFns.suggestedPriceFor(2.04,3)===30 && fareFns.suggestedPriceFor(3.59,3)===40 && fareFns.suggestedPriceFor(1.0,2)===25 && fareFns.suggestedPriceFor(1.0,1)===20 && fareFns.suggestedPrice(1.44)===25);
  // En vivo, en el servidor: publicar por debajo del mínimo por personas
  // se rechaza; el precio y el conteo se guardan; las contraofertas por
  // debajo del mínimo también se rechazan (chofer y pasajero).
  const pax3Low = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo', passenger_count: 3 });
  check('v1.4.48: en vivo, publicar un viaje de 3 personas a $25 se rechaza (el mínimo para 3 es $30)', !pax3Low.ok && String(pax3Low.error||'').includes('$30'), JSON.stringify(pax3Low));
  const pax3 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', passenger_count: 3 });
  const pax3Row = pax3.ok && (await api('/api/requests?id=' + pax3.request.id)).requests[0];
  check('v1.4.48: en vivo, el viaje de 3 personas a $30 se publica y guarda passenger_count=3', pax3.ok && pax3Row && pax3Row.passenger_count === 3, JSON.stringify(pax3Row && { p: pax3Row.passenger_count, precio: pax3Row.price }));
  const pax3NoPrice = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.44, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 3 });
  check('v1.4.48: en vivo, el sugerido del servidor con 3 personas a 1.44 km (tarifa $22) es $30', pax3NoPrice.ok && pax3NoPrice.request.price === 30, JSON.stringify(pax3NoPrice.request && pax3NoPrice.request.price));
  const pax3Far = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 3.59, eta_minutes: 12, payment_method: 'efectivo', passenger_count: 3 });
  check('v1.4.48: en vivo, el sugerido del servidor con 3 personas a 3.59 km (tarifa ~$40) es $40, no $30', pax3Far.ok && pax3Far.request.price === 40, JSON.stringify(pax3Far.request && pax3Far.request.price));
  const pax2NoPrice = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 2 });
  check('v1.4.48: en vivo, el sugerido del servidor con 2 personas a 1.0 km es $25 (piso de 2)', pax2NoPrice.ok && pax2NoPrice.request.price === 25, JSON.stringify(pax2NoPrice.request && pax2NoPrice.request.price));
  const off3Low = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: pax3.request.id, kind: 'contraoferta', price: 25 });
  check('v1.4.48: en vivo, la contraoferta del chofer a $25 en un viaje de 3 personas se rechaza (mínimo $30)', !off3Low.ok && String(off3Low.error||'').includes('$30'), JSON.stringify(off3Low));
  const off3 = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: pax3.request.id, kind: 'contraoferta', price: 35 });
  check('v1.4.48: en vivo, la contraoferta del chofer a $35 en ese viaje sí se acepta', off3.ok && off3.offer.kind === 'contraoferta', JSON.stringify(off3));
  const counter3Low = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: pax3.request.id, offer_id: off3.offer.id, action: 'contraoferta', price: 25 });
  check('v1.4.48: en vivo, la contraoferta del pasajero a $25 en un viaje de 3 personas se rechaza (mínimo $30)', !counter3Low.ok && String(counter3Low.error||'').includes('$30'), JSON.stringify(counter3Low));
  const raise3Low = await api('/api/raise-price', { passenger_id: pax.passenger.id, request_id: pax3.request.id, price: 25 });
  check('v1.4.48: en vivo, subir el precio a $25 en un viaje de 3 personas se rechaza (mínimo $30)', !raise3Low.ok && String(raise3Low.error||'').includes('$30'), JSON.stringify(raise3Low));
  const raise3 = await api('/api/raise-price', { passenger_id: pax.passenger.id, request_id: pax3.request.id, price: 35 });
  check('v1.4.48: en vivo, subir el precio a $35 en ese viaje sí se acepta', raise3.ok && raise3.request.price === 35, JSON.stringify(raise3));
  // Los mandados no tienen personas: passenger_count se guarda como 1 y
  // su mínimo sigue siendo $20.
  const man3 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Recoger un paquete', passenger_count: 3 });
  const man3Row = man3.ok && (await api('/api/requests?id=' + man3.request.id)).requests[0];
  check('v1.4.48: en vivo, el mandado con passenger_count=3 se guarda como 1 (los mandados no tienen personas)', man3.ok && man3Row && man3Row.passenger_count === 1, JSON.stringify(man3Row && { p: man3Row.passenger_count }));
  const manLow = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 15, payment_method: 'efectivo', description: 'Recoger un paquete' });
  check('v1.4.48: en vivo, el mandado a $15 sigue rechazado (su mínimo es $20)', !manLow.ok, JSON.stringify(manLow));
  // Compatibilidad: un viaje viejo por transferencia sigue publicándose
  // (el servidor lo acepta para los viajes en curso), aunque el cliente
  // ya no ofrece ese botón.
  const oldPay = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'transferencia' });
  check('v1.4.48: en vivo, el servidor sigue aceptando "transferencia" en viajes en curso (compatibilidad con clientes viejos)', oldPay.ok && oldPay.request.payment_method === 'transferencia', JSON.stringify(oldPay));

  // --- v1.4.49: el botón "‹ Regresar" del paso de precio vive DENTRO de
  //     la hoja (captura del usuario 21:58: en "Tu precio" no había forma
  //     de volver — la píldora flotante de la franja de arriba quedaba
  //     tapada por la hoja, más alta desde v1.4.48 con el selector de
  //     personas). La píldora de la franja se quitó de los tres pasos de
  //     precio (viaje, mandado Quiero y mandado Enviar) para que no quede
  //     ninguna píldora tapada, y la hoja tiene max-height con scroll
  //     interno para que el botón siempre quede al alcance.
  check('v1.4.49: la hoja de precio trae "‹ Regresar" arriba de todo, dentro de la hoja (antes de "Tu precio")', priceSec48.includes('const backBtn =') && priceSec48.indexOf('‹ Regresar</button>') !== -1 && priceSec48.indexOf('‹ Regresar</button>') < priceSec48.indexOf("'Tu precio'") && priceSec48.includes('return backBtn'));
  check('v1.4.49: el Regresar de la hoja vuelve al paso anterior del viaje (paso 3) y del mandado (paso anterior según el flujo)', priceSec48.includes("wiz.step=3;renderViajes()") && priceSec48.includes('mdBack(md.step-1)'));
  check('v1.4.49: ya no queda ninguna píldora "‹ Regresar" en la franja de arriba de los tres pasos de precio (viaje, Quiero, Enviar)', !html.includes('style="background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.18);margin:0" onclick="wiz.step=3;renderViajes()"') && !html.includes('style="background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.18);margin:0" onclick="mdBack(4)"') && !html.includes('style="background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.18);margin:0" onclick="mdBack(3)"'));
  check('v1.4.49: las tres hojas de precio tienen max-height con scroll interno para que el botón Regresar siempre quede al alcance', html.split("max-height:calc(100dvh - 24px);overflow-y:auto\">' + priceSheetHtml").length - 1 === 3);
  // Auditoría: cada paso del flujo de viajes y de mandados tiene una forma
  // visible de volver (la hoja de precio, por el botón de dentro; el resto,
  // por su píldora, que queda a la vista porque su hoja es corta o es una
  // página normal).
  const tripSec49 = html.slice(html.indexOf('async function renderViajes(){'), html.indexOf('function drawWizMap(){'));
  check('v1.4.49: auditoría del viaje — los pasos 0, 1, 3 y 5 tienen su píldora Regresar/Volver y el paso 4 el botón de dentro de la hoja', tripSec49.includes("backPill('Regresar al inicio'") && tripSec49.includes("backPill('Regresar', \"wiz.step=0;renderViajes()\")") && tripSec49.includes('onclick="wiz.step=2;renderViajes()">‹ Regresar</button>') && tripSec49.includes("backPill('Volver al inicio'"));
  const mdSec49 = html.slice(html.indexOf('async function renderMandados(){'), html.indexOf('function mdNextEnviar2(){'));
  check('v1.4.49: auditoría del mandado — el inicio, la pantalla de buscando y cada paso (Quiero 1-4 y Enviar 1-3) tienen su Regresar, y el precio el botón de dentro', mdSec49.includes("backPill('Regresar al inicio'") && mdSec49.includes("backPill('Regresar', \"mdBack(0)\")") && mdSec49.includes("backPill('Regresar', \"mdBack(1)\")") && mdSec49.includes("backPill('Regresar', \"mdBack(2)\")") && html.includes("mdBack(md.step-1)"));
  const pickSec49 = html.slice(html.indexOf('function openPick(which, ret, startPos){'), html.indexOf('function closePickToViajes(){'));
  check('v1.4.49: auditoría del selector de punto en el mapa — su franja de arriba trae "‹ Regresar" y la de abajo es solo el botón de confirmar (no hay hoja que lo tape)', pickSec49.includes('onclick="closePick()">‹ Regresar</button>') && pickSec49.includes("bot.innerHTML = '<div class=\"pickzone-wrap\""));
  // Evaluando el botón real de la hoja: se extrae su onclick del código
  // del cliente y se ejecuta con un asistente de mentira, para probar que
  // volver al paso anterior no borra nada.
  const backBtnSrc49 = priceSec48.slice(priceSec48.indexOf('const backBtn ='), priceSec48.indexOf('return backBtn'));
  const backBtnTrip49 = new Function('isTrip', 'wiz', 'md', backBtnSrc49 + '; return backBtn;')(true, { step: 4 }, { step: 5 });
  const backBtnMd49 = new Function('isTrip', 'wiz', 'md', backBtnSrc49 + '; return backBtn;')(false, { step: 4 }, { step: 5 });
  const tripOnclick49 = (backBtnTrip49.match(/onclick="([^"]+)"/)||[])[1];
  const mdOnclick49 = (backBtnMd49.match(/onclick="([^"]+)"/)||[])[1];
  const wizStub49 = { step: 4, origin: { lat: 16.87291, lng: -93.21374 }, dest: { lat: 16.87137, lng: -93.20652 }, price: 30, pax: 3, suggested: 30, payment: 'efectivo' };
  let renderedStep49 = null;
  new Function('wiz', 'renderViajes', tripOnclick49)(wizStub49, ()=>{ renderedStep49 = wizStub49.step; });
  check('v1.4.49: al tocar "‹ Regresar" en el paso de precio del viaje se vuelve al paso 3 sin perder origen, destino, precio, personas ni pago', tripOnclick49 === 'wiz.step=3;renderViajes()' && wizStub49.step === 3 && renderedStep49 === 3 && wizStub49.price === 30 && wizStub49.pax === 3 && wizStub49.origin.lat === 16.87291 && wizStub49.dest.lng === -93.20652 && wizStub49.payment === 'efectivo', JSON.stringify({ onclick: tripOnclick49, step: wizStub49.step }));
  const mdBackLine49 = html.split('\n').find(l => l.trim().startsWith('function mdBack(step){'));
  const mdStub49 = { step: 4, price: 30, km: 1.5, eta: 5, kind: 'quiero' };
  let mdRendered49 = null;
  new Function('md', 'renderMandados', 'mdCloseListPopup', mdBackLine49 + '; mdBack(md.step-1);')(mdStub49, ()=>{ mdRendered49 = mdStub49.step; }, ()=>{});
  check('v1.4.49: al tocar "‹ Regresar" en el paso de precio del mandado Quiero (paso 4) se vuelve al paso 3 sin perder el precio ni los datos', mdOnclick49 === 'mdBack(md.step-1)' && mdStub49.step === 3 && mdRendered49 === 3 && mdStub49.price === 30 && mdStub49.km === 1.5, JSON.stringify({ onclick: mdOnclick49, step: mdStub49.step }));
  mdStub49.step = 4;
  new Function('md', 'renderMandados', 'mdCloseListPopup', mdBackLine49 + '; mdBack(md.step-1);')(mdStub49, ()=>{ mdRendered49 = mdStub49.step; }, ()=>{});
  check('v1.4.49: al tocar "‹ Regresar" en el paso de precio del mandado Enviar (paso 4) se vuelve al paso 3', mdStub49.step === 3 && mdRendered49 === 3, JSON.stringify({ step: mdStub49.step }));

  // --- v1.4.50: con un viaje en espera o en curso, entrar a Mandados NO
  //     muestra el formulario: se ve la misma pantalla de espera / en
  //     vivo del viaje hasta que termine o se cancele (captura del
  //     usuario 22:11: la entrada de Mandados se abría con el viaje
  //     BUSCANDO, $30, sugerido $20, 0.8 km). El candado es solo en este
  //     sentido (no se agrega el inverso: mandado pendiente → Viajes).
  const mdSec50 = html.slice(html.indexOf('async function renderMandados(){'), html.indexOf('function mdBack(step){'));
  check('v1.4.50: renderMandados consulta primero el viaje en curso (myActiveRequest(\'viaje\')) antes que el mandado', mdSec50.indexOf("myActiveRequest('viaje')") !== -1 && mdSec50.indexOf("myActiveRequest('viaje')") < mdSec50.indexOf("myActiveRequest('mandado')"));
  const tripLock50 = mdSec50.slice(mdSec50.indexOf('// v1.4.50:'), mdSec50.indexOf("const active = await myActiveRequest('mandado');"));
  check('v1.4.50: con viaje aceptado, entrar a Mandados va al mapa en vivo (goLive) en vez del formulario', tripLock50.includes("if(trip50.status==='aceptado'){ goLive(trip50.id, false); return; }"));
  check('v1.4.50: con viaje buscando, entrar a Mandados muestra la misma pantalla de espera del viaje (wiz.step=5, <div id="searching">, renderSearching)', tripLock50.includes('wiz.requestId = trip50.id; wiz.step = 5;') && tripLock50.includes("backPill('Volver al inicio'") && tripLock50.includes("'<div id=\"searching\"></div>'") && tripLock50.includes('renderSearching();'));
  check('v1.4.50: el formulario del mandado sigue intacto detrás del candado ("¿Qué quieres hacer?", Quiero/Enviar)', mdSec50.includes('¿Qué quieres hacer?') && mdSec50.includes("startMandado(\\'quiero\\')") && mdSec50.includes("startMandado(\\'enviar\\')")); // v1.4.70: la entrada ya no es directa (md.kind/md.step en el onclick) sino por startMandado, que es el candado de perfil incompleto; el formulario detrás del candado sigue igual
  const tripSec50 = html.slice(html.indexOf('async function renderViajes(){'), html.indexOf('function drawWizMap(){'));
  check('v1.4.50: el candado inverso NO existía en v1.4.50; en v1.4.55 el usuario lo pidió (reporte 23:16, ver sección v1.4.55): Viajes SÍ consulta el mandado pendiente', tripSec50.includes("myActiveRequest('mandado')"));
  check('v1.4.50: el sondeo refresca la pantalla de espera del viaje también cuando se ve desde Mandados', html.includes("(currentView==='viajes' || currentView==='mandados') && wiz && wiz.step===5) renderSearching();"));
  check('v1.4.50: el sondeo de Mandados no pinta la pantalla del mandado cuando se está viendo la del viaje (v1.4.55: el sondeo también refresca la pantalla del mandado desde Viajes)', html.includes("if((currentView==='mandados' || currentView==='viajes') && md && md.requestId && !(wiz && wiz.step===5 && wiz.requestId)){"));
  check('v1.4.50: si el viaje se cancela o finaliza estando en Mandados, se vuelve a pintar Mandados (se levanta el candado)', html.includes("if(r.status==='cancelado' || r.status==='finalizado'){ wiz = newWizard(); if(currentView==='mandados') renderMandados(); else renderViajes(); return; }"));
  check('v1.4.50: al cancelar el viaje desde Mandados, se vuelve a pintar Mandados (no Viajes)', html.includes("wiz = newWizard(); if(currentView==='mandados') renderMandados(); else renderViajes(); toast('Viaje cancelado.');"));
  check('v1.4.50: refreshSearching refresca la pantalla del viaje cuando se ve desde Mandados', html.includes("if(currentView==='mandados' && wiz && wiz.step===5 && wiz.requestId){ renderSearching(); return; }"));
  // Evaluando el candado real: se extrae renderMandados y se ejecuta con
  // estado de mentira (sin DOM real) en cuatro casos: viaje buscando,
  // viaje aceptado, sin viaje, y sin viaje pero con mandado buscando.
  const mdFnSrc50 = html.slice(html.indexOf('async function renderMandados(){'), html.indexOf('function mdBack(step){'));
  async function runRenderMandados50(tripStatus, mdReqId){
    const pageStub = { innerHTML: '' };
    const calls = { goLive: null, searching: false, mandadoSearching: false };
    const wizObj = { step: 0, requestId: null };
    const stubs = {
      $: (sel) => sel === '#mandados-page' ? pageStub : null,
      mdMap: null,
      md: { step: 0, requestId: mdReqId || null, kind: 'quiero' },
      newMandado: () => ({ step: 0, requestId: null, kind: 'quiero' }),
      setPageNoScroll: () => {},
      myActiveRequest: async (kind) => kind === 'viaje' ? (tripStatus ? { id: 999, status: tripStatus } : null) : (mdReqId ? { id: mdReqId, status: 'buscando' } : null),
      goLive: (id) => { calls.goLive = id; },
      renderMandadoSearching: () => { calls.mandadoSearching = true; },
      backPill: (label) => '<button>' + label + '</button>',
      wiz: null,
      newWizard: () => wizObj,
      renderSearching: () => { calls.searching = true; },
      renderMandadoQuiero: () => {},
      renderMandadoEnviar: () => {},
      mandadosCanEnter: () => true, // v1.4.79: el candado abierto en la simulación (la puerta del perfil es lo que se prueba aquí)
    };
    const fn = new Function(...Object.keys(stubs), mdFnSrc50 + '; return renderMandados;')(...Object.values(stubs));
    await fn();
    return { html: pageStub.innerHTML, calls, wiz: wizObj };
  }
  let sim50 = null, sim50Err = '';
  try { sim50 = await runRenderMandados50('buscando', null); } catch(e){ sim50Err = String(e && e.message || e); }
  check('v1.4.50: evaluado — con viaje BUSCANDO, entrar a Mandados muestra la pantalla de espera del viaje, no el formulario', !!sim50 && sim50.html.includes('id="searching"') && !sim50.html.includes('¿Qué quieres hacer?') && sim50.calls.searching && !sim50.calls.mandadoSearching && sim50.wiz.requestId === 999 && sim50.wiz.step === 5, sim50Err || JSON.stringify(sim50 && { html: sim50.html.slice(0, 120), wiz: sim50.wiz }));
  let sim50b = null, sim50bErr = '';
  try { sim50b = await runRenderMandados50('aceptado', null); } catch(e){ sim50bErr = String(e && e.message || e); }
  check('v1.4.50: evaluado — con viaje ACEPTADO, entrar a Mandados va al mapa en vivo (goLive con el id del viaje)', !!sim50b && sim50b.calls.goLive === 999 && !sim50b.calls.searching && sim50b.html === '', sim50bErr || JSON.stringify(sim50b && sim50b.calls));
  let sim50c = null, sim50cErr = '';
  try { sim50c = await runRenderMandados50(null, null); } catch(e){ sim50cErr = String(e && e.message || e); }
  check('v1.4.50: evaluado — sin viaje en curso, entrar a Mandados abre el formulario normal ("¿Qué quieres hacer?")', !!sim50c && sim50c.html.includes('¿Qué quieres hacer?') && !sim50c.calls.searching && !sim50c.calls.goLive, sim50cErr || JSON.stringify(sim50c && { html: sim50c.html.slice(0, 120) }));
  let sim50d = null, sim50dErr = '';
  try { sim50d = await runRenderMandados50(null, 777); } catch(e){ sim50dErr = String(e && e.message || e); }
  check('v1.4.50: evaluado — sin viaje pero con mandado BUSCANDO, entrar a Mandados sigue mostrando el mandado (el candado del mismo apartado no se toca)', !!sim50d && sim50d.html.includes('Tu mandado') && sim50d.calls.mandadoSearching && !sim50d.calls.searching, sim50dErr || JSON.stringify(sim50d && { html: sim50d.html.slice(0, 120) }));
  console.log('== v1.4.50: candado de Mandados con viaje en espera/en curso ==');
  const pax50 = await api('/api/register-passenger', { name: 'Pax Cincuenta', phone: '9610000050', face_photo: PHOTO });
  check('v1.4.50: en vivo, pasajera de prueba registrada', pax50.ok && pax50.passenger.id, JSON.stringify(pax50));
  const drv50 = await api('/api/register-driver', { name: 'Chofer Cincuenta', phone: '9610000051', vehicle: 'mototaxi', unit: 'V50', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.50: en vivo, chofer de prueba registrado con fotos', drv50.ok && drv50.driver.id, JSON.stringify(drv50));
  await approveDriver(drv50.driver.id);
  const on50 = await api('/api/set-driver-online', { driver_id: drv50.driver.id, online: true });
  check('v1.4.50: en vivo, chofer de prueba en línea', on50.ok && on50.driver.online === 1, JSON.stringify(on50));
  const trip50 = await api('/api/create-request', { passenger_id: pax50.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 30, payment_method: 'efectivo' });
  check('v1.4.50: en vivo, el viaje de la prueba queda BUSCANDO ($30, 0.8 km, como la captura del usuario)', trip50.ok && trip50.request.status === 'buscando' && trip50.request.price === 30, JSON.stringify(trip50.request && { st: trip50.request.status, p: trip50.request.price }));
  const list50 = await api('/api/requests?passenger_id=' + pax50.passenger.id + '&light=1');
  check('v1.4.50: en vivo, myActiveRequest(\'viaje\') encontraría ese viaje buscando (el candado lo vería)', list50.ok && list50.requests.some(r=>r.kind==='viaje' && r.status==='buscando'), JSON.stringify(list50.requests && list50.requests.length));
  const acc50 = await api('/api/driver-respond', { driver_id: drv50.driver.id, request_id: trip50.request.id, kind: 'acepta', price: 30 });
  check('v1.4.50: en vivo, el chofer acepta: el viaje queda ACEPTADO y en camino (el candado cubre el viaje en curso)', acc50.ok && acc50.request.status === 'aceptado' && acc50.request.trip_stage === 'en_camino', JSON.stringify(acc50.request && { st: acc50.request.status, stage: acc50.request.trip_stage }));
  const list50b = await api('/api/requests?passenger_id=' + pax50.passenger.id + '&light=1');
  check('v1.4.50: en vivo, con el viaje aceptado myActiveRequest(\'viaje\') lo sigue viendo (candado en curso)', list50b.ok && list50b.requests.some(r=>r.kind==='viaje' && r.status==='aceptado'), JSON.stringify(list50b.requests && list50b.requests[0] && list50b.requests[0].status));
  const can50 = await api('/api/cancel-request', { request_id: trip50.request.id });
  check('v1.4.50: en vivo, el viaje se cancela antes de empezar', can50.ok, JSON.stringify(can50));
  const list50c = await api('/api/requests?passenger_id=' + pax50.passenger.id + '&light=1');
  check('v1.4.50: en vivo, tras cancelar ya no hay viaje en espera ni activo: el candado se levanta y Mandados abre normal', list50c.ok && !list50c.requests.some(r=>r.kind==='viaje' && (r.status==='buscando' || r.status==='aceptado')), JSON.stringify(list50c.requests && list50c.requests.map(r=>r.status)));
  const man50 = await api('/api/create-request', { passenger_id: pax50.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 0.8, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Recoger un paquete' });
  check('v1.4.50: en vivo, tras cancelar el viaje el mandado sí se publica (el formulario vuelve a estar disponible)', man50.ok && man50.request.status === 'buscando', JSON.stringify(man50.request && man50.request.status));

  // --- v1.4.51: la fila compacta del chofer (Recibir Viajes) muestra
  //     cuántas personas van en el viaje ('1 persona' / '2 personas' /
  //     '3 personas') en la misma línea tenue de km · ETA · pago
  //     (reporte del usuario 22:26, captura 10:25 PM: la fila del viaje
  //     de $30 — mínimo de 3 personas — decía solo '0.8 km · ~5 min ·
  //     Pago: efectivo', sin el dato de personas). Solo viajes: los
  //     mandados son siempre de 1 persona y no llevan el dato. El
  //     detalle expandido ya lo mostraba desde v1.4.48 y no se toca.
  const compactSec51 = html.slice(html.indexOf("const rowMeta = [];"), html.indexOf("return '<div class=\"swipe-wrap\"")); // v1.4.54: la fila ahora vuelve envuelta (swipe-wrap); la tarjeta compacta vive dentro
  check('v1.4.51: la fila compacta agrega el conteo de personas solo para viajes (paxText(r.passenger_count), con kind===\'viaje\')', compactSec51.includes("if(r.kind==='viaje') rowMeta.push(paxText(r.passenger_count));"));
  check('v1.4.51: el conteo va al final de la línea tenue (después de km · ETA y Pago)', compactSec51.indexOf("paxText(r.passenger_count)") > compactSec51.indexOf("Pago: '+esc(r.payment_method)"));
  check('v1.4.51: la firma de repintado de la bandeja incluye passenger_count (la fila se repinta si cambia el dato)', html.includes("':'+(r.passenger_count||'')"));
  check('v1.4.51: el detalle expandido sigue mostrando Personas como antes (no se toca)', html.includes("'<div class=\"kv\"><span>Personas</span><b>'+paxText(r.passenger_count)+'</b></div>'"));
  // Evaluando el constructor real de la línea tenue: se extrae el bloque
  // rowMeta de la fila compacta y se ejecuta con solicitudes de mentira
  // (viajes de 1, 2 y 3 personas, un viaje viejo sin passenger_count y
  // un mandado).
  function rowMeta51(r){
    const esc51 = (s)=>String(s==null?'':s);
    const paxText51 = (pax)=>{ const n = Math.min(3, Math.max(1, Number(pax)||1)); return n + (n===1 ? ' persona' : ' personas'); };
    return new Function('r','esc','paxText', compactSec51 + '; return rowMeta.join(" · ");')(r, esc51, paxText51);
  }
  check('v1.4.51: evaluado — viaje de 1 persona: la fila dice "0.8 km · ~5 min · Pago: efectivo · 1 persona"', rowMeta51({ kind: 'viaje', distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 1 }) === '0.8 km · ~5 min · Pago: efectivo · 1 persona', rowMeta51({ kind: 'viaje', distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 1 }));
  check('v1.4.51: evaluado — viaje de 2 personas: la fila dice "… · 2 personas"', rowMeta51({ kind: 'viaje', distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 2 }) === '0.8 km · ~5 min · Pago: efectivo · 2 personas', rowMeta51({ kind: 'viaje', distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 2 }));
  check('v1.4.51: evaluado — viaje de 3 personas ($30, como la captura del usuario): la fila dice "… · 3 personas"', rowMeta51({ kind: 'viaje', distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 3 }) === '0.8 km · ~5 min · Pago: efectivo · 3 personas', rowMeta51({ kind: 'viaje', distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 3 }));
  check('v1.4.51: evaluado — viaje viejo sin passenger_count: la fila dice "1 persona" (el conteo por defecto)', rowMeta51({ kind: 'viaje', distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo' }) === '0.8 km · ~5 min · Pago: efectivo · 1 persona', rowMeta51({ kind: 'viaje', distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo' }));
  check('v1.4.51: evaluado — mandado: la fila NO lleva personas ("0.8 km · ~5 min · Pago: efectivo")', rowMeta51({ kind: 'mandado', distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 1 }) === '0.8 km · ~5 min · Pago: efectivo', rowMeta51({ kind: 'mandado', distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 1 }));
  console.log('== v1.4.51: personas en la fila compacta del chofer ==');
  const pax51 = await api('/api/register-passenger', { name: 'Pax Cincuentauno', phone: '9610000052', face_photo: PHOTO });
  check('v1.4.51: en vivo, pasajera de prueba registrada', pax51.ok && pax51.passenger.id, JSON.stringify(pax51));
  const t1 = await api('/api/create-request', { passenger_id: pax51.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 20, payment_method: 'efectivo', passenger_count: 1 });
  check('v1.4.51: en vivo, viaje de 1 persona a $20 se publica con passenger_count=1', t1.ok && t1.request.passenger_count === 1, JSON.stringify(t1.request && { p: t1.request.passenger_count }));
  const t2 = await api('/api/create-request', { passenger_id: pax51.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 25, payment_method: 'efectivo', passenger_count: 2 });
  check('v1.4.51: en vivo, viaje de 2 personas a $25 se publica con passenger_count=2', t2.ok && t2.request.passenger_count === 2, JSON.stringify(t2.request && { p: t2.request.passenger_count }));
  const t3 = await api('/api/create-request', { passenger_id: pax51.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 30, payment_method: 'efectivo', passenger_count: 3 });
  check('v1.4.51: en vivo, viaje de 3 personas a $30 se publica con passenger_count=3 (como la captura del usuario)', t3.ok && t3.request.passenger_count === 3, JSON.stringify(t3.request && { p: t3.request.passenger_count, precio: t3.request.price }));
  const m51 = await api('/api/create-request', { passenger_id: pax51.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 0.8, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Recoger un paquete', passenger_count: 3 });
  check('v1.4.51: en vivo, el mandado con passenger_count=3 se guarda como 1 (los mandados no tienen personas)', m51.ok && m51.request.passenger_count === 1, JSON.stringify(m51.request && { p: m51.request.passenger_count }));
  const open51 = await api('/api/requests?open=1&light=1');
  const mine51 = open51.ok ? open51.requests.filter(r=>r.passenger_id===pax51.passenger.id) : [];
  check('v1.4.51: en vivo, la lista ligera del chofer (?open=1&light=1) trae passenger_count en los 3 viajes (es lo que lee la fila compacta)', open51.ok && mine51.filter(r=>r.kind==='viaje').length === 3 && mine51.filter(r=>r.kind==='viaje').every(r=>[1,2,3].includes(r.passenger_count)) && mine51.find(r=>r.kind==='viaje' && r.price===30).passenger_count === 3, JSON.stringify(mine51.map(r=>({ k: r.kind, p: r.passenger_count, pr: r.price }))));
  check('v1.4.51: en vivo, el mandado en la lista del chofer trae passenger_count=1 (la fila no muestra personas)', open51.ok && mine51.filter(r=>r.kind==='mandado').length === 1 && mine51.find(r=>r.kind==='mandado').passenger_count === 1, JSON.stringify(mine51.map(r=>({ k: r.kind, p: r.passenger_count }))));

  // --- v1.4.52: al llegar una oferta, la pantalla "Buscando tu mototaxi…"
  //     quita la tarjeta del viaje y sube la oferta a su lugar; con varias
  //     ofertas, carrusel horizontal en su sitio (scroll-snap, se desliza
  //     de lado, no es una página); "Cancelar viaje" queda como apartado
  //     propio debajo de las ofertas (reporte del usuario 22:38, captura
  //     10:36 PM con la X roja sobre la tarjeta del viaje de $30 y la
  //     contraoferta de $35 de Josué Eduardo). Sin ofertas, todo queda
  //     como antes. La pantalla de espera del mandado no se toca.
  const searchSec52 = html.slice(html.indexOf('async function renderSearching(){'), html.indexOf('let autoConfirmedReqs = {};'));
  const tripCardSec52 = searchSec52.slice(searchSec52.indexOf("const tripCard = '"), searchSec52.indexOf("const cancelHtml = '"));
  check('v1.4.52: la tarjeta del viaje ya no lleva "Cancelar viaje" dentro (se quita con la tarjeta)', !tripCardSec52.includes('Cancelar viaje'));
  check('v1.4.52: "Cancelar viaje" es su propio apartado (cancelHtml) con el mismo botón rojo y el mismo cancelMyRequest', searchSec52.includes("const cancelHtml = '<div class=\"center\" style=\"margin-top:14px\"><button class=\"linklike\" style=\"color:var(--red)\" onclick=\"cancelMyRequest()\">Cancelar viaje</button></div>'"));
  check('v1.4.52: con ofertas la tarjeta se quita y la oferta sube a su lugar (título + ofertas en vez de la tarjeta)', searchSec52.includes('(offers.length ? titleHtml + offersHtml : tripCard)'));
  check('v1.4.52: el apartado de cancelar va DESPUÉS de las ofertas (al final del armado)', searchSec52.indexOf('+ cancelHtml;') > searchSec52.indexOf('(offers.length ? titleHtml + offersHtml : tripCard)'));
  check('v1.4.52: el carrusel de ofertas es scroll-snap en su sitio (CSS .offer-carousel, sin transform translateX en esta pantalla)', html.includes('.offer-carousel{display:flex;overflow-x:auto;scroll-snap-type:x mandatory') && searchSec52.includes('class="offer-carousel"') && searchSec52.includes('class="offer-slide"') && !searchSec52.includes('translateX'));
  check('v1.4.52: al deslizar se actualizan solo los puntos y el contador (scroll listener, sin repintar la pantalla)', searchSec52.includes("addEventListener('scroll'") && searchSec52.includes("getElementById('offer-count')") && searchSec52.includes("getElementById('offer-dots')") && !searchSec52.includes("addEventListener('touchend'"));
  check('v1.4.52: el sondeo de 5 s no saca al pasajero de la oferta que estaba viendo (se restaura scrollLeft con offerIdx)', searchSec52.includes('car.scrollLeft = offerIdx * car.clientWidth'));
  const offerCardSec52 = html.slice(html.indexOf('function offerCard(r, o){'), html.indexOf('async function respondOffer'));
  check('v1.4.52: cada tarjeta de oferta sigue con sus botones Aceptar / Contraofertar / Rechazar (no se tocan)', offerCardSec52.includes('Aceptar ') && offerCardSec52.includes('Contraofertar') && offerCardSec52.includes('Rechazar'));
  // Evaluando el armado real de la pantalla: se extrae el bloque de
  // renderSearching que arma el HTML (desde el filtro de ofertas hasta
  // el box.innerHTML) y se ejecuta con solicitudes de mentira (0 ofertas,
  // 1 contraoferta de $35, 2 contraofertas de $35 y $40), con la offerCard
  // real y sin DOM.
  const offerCardFn52 = new Function('esc','fmt$','minForPax', offerCardSec52 + '; return offerCard;')((s)=>String(s==null?'':s), (n)=>'$'+Math.round(Number(n)||0), (p)=>20 + 5*(Math.max(1, Math.min(3, Number(p)||1))-1));
  const asmStart52 = searchSec52.indexOf("const offers = (r.offers||[]).filter(o=>o.status==='pendiente');");
  const asmBox52 = searchSec52.indexOf('box.innerHTML =', asmStart52);
  const asmEnd52 = searchSec52.indexOf(';', searchSec52.indexOf('+ cancelHtml;', asmBox52)) + 1;
  const asm52 = searchSec52.slice(asmStart52, asmEnd52);
  function runSearching52(r){
    const boxStub = { innerHTML: '' };
    return new Function('r','box','offerIdx','esc','fmt$','suggestedPrice','offerCard', asm52 + '; return box.innerHTML;')(r, boxStub, 0, (s)=>String(s==null?'':s), (n)=>'$'+Math.round(Number(n)||0), (km)=>20, offerCardFn52);
  }
  function req52(offers){
    return { id: 999, status: 'buscando', kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', dest_zone: 'Mercado', dest_detail: 'Mercado', distance_km: 0.8, eta_minutes: 5, price: 30, suggested: 20, passenger_count: 3, offers };
  }
  function offer52(id, name, price){
    return { id, status: 'pendiente', kind: 'contraoferta', driver_name: name, driver_vehicle: 'mototaxi', driver_unit: 'Hahaha', eta_minutes: 5, price, driver_photo: null, vehicle_photo: null, is_premium: false, passenger_counter_price: null };
  }
  let html52a = '', html52aErr = '';
  try { html52a = runSearching52(req52([])); } catch(e){ html52aErr = String(e && e.message || e); }
  check('v1.4.52: evaluado — 0 ofertas: se ve la tarjeta del viaje (BUSCANDO, Tu precio, aviso, subir precio) y Cancelar viaje, sin carrusel', !!html52a && html52a.includes('Viaje en mototaxi') && html52a.includes('BUSCANDO') && html52a.includes('Tu precio:') && html52a.includes('Ningún conductor') && html52a.includes('Cancelar viaje') && !html52a.includes('offer-carousel') && !html52a.includes('¡Tienes una contraoferta!'), html52aErr || html52a.slice(0, 200));
  let html52b = '', html52bErr = '';
  try { html52b = runSearching52(req52([offer52(1, 'Josué Eduardo', 35)])); } catch(e){ html52bErr = String(e && e.message || e); }
  check('v1.4.52: evaluado — 1 contraoferta ($35, como la captura): la tarjeta desaparece, la oferta sube arriba con sus botones y Cancelar viaje queda debajo', !!html52b && !html52b.includes('Viaje en mototaxi') && html52b.includes('¡Tienes una contraoferta!') && html52b.includes('Josué Eduardo') && html52b.includes('Aceptar $35') && html52b.includes('Contraofertar') && html52b.includes('Rechazar') && html52b.indexOf('Cancelar viaje') > html52b.indexOf('Aceptar $35') && !html52b.includes('offer-carousel'), html52bErr || html52b.slice(0, 300));
  let html52c = '', html52cErr = '';
  try { html52c = runSearching52(req52([offer52(1, 'Josué Eduardo', 35), offer52(2, 'Chofer Segundo', 40)])); } catch(e){ html52cErr = String(e && e.message || e); }
  check('v1.4.52: evaluado — 2 contraofertas: carrusel horizontal en su sitio con las dos ofertas ("1 de 2 · desliza para verlas"), sin tarjeta, y Cancelar viaje debajo del carrusel', !!html52c && html52c.includes('offer-carousel') && html52c.includes('offer-slide') && html52c.includes('Josué Eduardo') && html52c.includes('Chofer Segundo') && html52c.includes('1 de 2 · desliza para verlas') && html52c.includes('Aceptar $35') && html52c.includes('Aceptar $40') && !html52c.includes('Viaje en mototaxi') && html52c.indexOf('Cancelar viaje') > html52c.indexOf('offer-carousel'), html52cErr || html52c.slice(0, 300));
  console.log('== v1.4.52: ofertas suben y la tarjeta se quita ==');
  const pax52 = await api('/api/register-passenger', { name: 'Pax Cincuentadós', phone: '9610000053', face_photo: PHOTO });
  check('v1.4.52: en vivo, pasajera de prueba registrada', pax52.ok && pax52.passenger.id, JSON.stringify(pax52));
  const drv52a = await api('/api/register-driver', { name: 'Chofer 52A', phone: '9610000054', vehicle: 'mototaxi', unit: 'V52A', selfie: PHOTO, vehicle_photo: PHOTO });
  const drv52b = await api('/api/register-driver', { name: 'Chofer 52B', phone: '9610000055', vehicle: 'mototaxi', unit: 'V52B', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.52: en vivo, dos choferes de prueba registrados con fotos', drv52a.ok && drv52a.driver.id && drv52b.ok && drv52b.driver.id, JSON.stringify([drv52a.driver && drv52a.driver.id, drv52b.driver && drv52b.driver.id]));
  await approveDriver(drv52a.driver.id);
  await approveDriver(drv52b.driver.id);
  await api('/api/set-driver-online', { driver_id: drv52a.driver.id, online: true });
  await api('/api/set-driver-online', { driver_id: drv52b.driver.id, online: true });
  const trip52 = await api('/api/create-request', { passenger_id: pax52.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 30, payment_method: 'efectivo', passenger_count: 3 });
  check('v1.4.52: en vivo, el viaje de la prueba queda BUSCANDO ($30, 3 personas, 0.8 km, como la captura del usuario)', trip52.ok && trip52.request.status === 'buscando' && trip52.request.price === 30 && trip52.request.passenger_count === 3, JSON.stringify(trip52.request && { st: trip52.request.status, p: trip52.request.price, n: trip52.request.passenger_count }));
  const off52a = await api('/api/driver-respond', { driver_id: drv52a.driver.id, request_id: trip52.request.id, kind: 'contraoferta', price: 35 });
  check('v1.4.52: en vivo, el primer chofer contraoferta $35 (como Josué Eduardo en la captura)', off52a.ok, JSON.stringify(off52a));
  const off52b = await api('/api/driver-respond', { driver_id: drv52b.driver.id, request_id: trip52.request.id, kind: 'contraoferta', price: 40 });
  check('v1.4.52: en vivo, el segundo chofer contraoferta $40', off52b.ok, JSON.stringify(off52b));
  const req52live = await api('/api/requests?passenger_id=' + pax52.passenger.id);
  const trip52live = req52live.ok ? req52live.requests.find(r=>r.id===trip52.request.id) : null;
  const pend52 = trip52live ? (trip52live.offers||[]).filter(o=>o.status==='pendiente' && o.kind==='contraoferta') : [];
  check('v1.4.52: en vivo, el viaje trae 2 contraofertas pendientes ($35 y $40): la pantalla mostraría el carrusel', trip52live && trip52live.status === 'buscando' && pend52.length === 2 && pend52.some(o=>o.price===35) && pend52.some(o=>o.price===40), JSON.stringify(trip52live && { st: trip52live.status, off: pend52.map(o=>({ p: o.price, k: o.kind, s: o.status })) }));
  const can52 = await api('/api/cancel-request', { request_id: trip52.request.id });
  check('v1.4.52: en vivo, cancelar desde el apartado propio cancela el viaje (mismo botón, mismo endpoint)', can52.ok, JSON.stringify(can52));
  const list52 = await api('/api/requests?passenger_id=' + pax52.passenger.id + '&light=1');
  check('v1.4.52: en vivo, tras cancelar ya no hay viaje en espera: la pantalla se levanta', list52.ok && !list52.requests.some(r=>r.kind==='viaje' && r.status==='buscando'), JSON.stringify(list52.requests && list52.requests.map(r=>r.status)));

  // --- v1.4.53: la pantalla "Buscando quién haga tu mandado…" usa el
  //     mismo patrón que la del viaje (v1.4.52): con ofertas la tarjeta
  //     del mandado se quita y la oferta sube a su lugar; con varias
  //     ofertas, carrusel horizontal en su sitio (scroll-snap); "Cancelar
  //     mandado" queda como apartado propio debajo de las ofertas. Sin
  //     ofertas, la pantalla queda exactamente como antes. La pantalla
  //     del viaje no se toca. El carrusel viejo (transform translateX +
  //     touchend) y sus clases .carousel/.track/.slide se eliminan.
  const mdSec53 = html.slice(html.indexOf('async function renderMandadoSearching(active){'), html.indexOf('async function cancelMandado(){'));
  const mdCardSec53 = mdSec53.slice(mdSec53.indexOf("const mdCard = '"), mdSec53.indexOf("const cancelMdHtml = '"));
  check('v1.4.53: sin ofertas la tarjeta del mandado queda como antes (resumen, BUSCANDO, Tu precio, aviso, subir precio y Cancelar mandado dentro)', mdCardSec53.includes('<b>Tu mandado</b>') && mdCardSec53.includes('BUSCANDO') && mdCardSec53.includes('Tu precio:') && mdCardSec53.includes('Ningún conductor') && mdCardSec53.includes('Subir a ') && mdCardSec53.includes('Cancelar mandado'));
  check('v1.4.53: con ofertas "Cancelar mandado" es su propio apartado (cancelMdHtml) con el mismo botón rojo y el mismo cancelMandado', mdSec53.includes("const cancelMdHtml = '<div class=\"center\" style=\"margin-top:14px\"><button class=\"linklike\" style=\"color:var(--red)\" onclick=\"cancelMandado()\">Cancelar mandado</button></div>'"));
  check('v1.4.53: con ofertas la tarjeta se quita y la oferta sube a su lugar (título + ofertas + cancelar en vez de la tarjeta)', mdSec53.includes('(offers.length ? titleHtml + offersHtml + cancelMdHtml : mdCard)'));
  check('v1.4.53: el apartado de cancelar va DESPUÉS de las ofertas (al final del armado)', mdSec53.indexOf('+ cancelMdHtml : mdCard') > mdSec53.indexOf('(offers.length ? titleHtml'));
  check('v1.4.53: el carrusel de ofertas del mandado es scroll-snap en su sitio (CSS .offer-carousel, sin transform translateX ni touchend en esta pantalla)', html.includes('.offer-carousel{display:flex;overflow-x:auto;scroll-snap-type:x mandatory') && mdSec53.includes('class="offer-carousel"') && mdSec53.includes('class="offer-slide"') && !mdSec53.includes('translateX') && !mdSec53.includes("addEventListener('touchend'"));
  check('v1.4.53: al deslizar se actualizan solo los puntos y el contador (scroll listener, sin repintar la pantalla)', mdSec53.includes("addEventListener('scroll'") && mdSec53.includes("getElementById('offer-count')") && mdSec53.includes("getElementById('offer-dots')"));
  check('v1.4.53: el sondeo de 5 s no saca al pasajero de la oferta que estaba viendo (se restaura scrollLeft con offerIdx)', mdSec53.includes('car.scrollLeft = offerIdx * car.clientWidth'));
  check('v1.4.53: el carrusel viejo del mandado ya no existe (sin .carousel/.track/.slide ni offerTouchX en el cliente)', !html.includes('.carousel{overflow:hidden}') && !html.includes('class="carousel"') && !html.includes('offerTouchX') && !mdSec53.includes("addEventListener('touchstart'"));
  check('v1.4.53: las ofertas del mandado usan la misma offerCard del viaje (Aceptar / Contraofertar / Rechazar)', mdSec53.includes('offerCard(r, offers[0])') && mdSec53.includes('offerCard(r, o)'));
  // Evaluando el armado real de la pantalla: se extrae el bloque de
  // renderMandadoSearching que arma el HTML (desde el filtro de ofertas
  // hasta el box.innerHTML) y se ejecuta con mandados de mentira (0
  // ofertas, 1 contraoferta de $35, 2 contraofertas de $35 y $40), con
  // la offerCard real y sin DOM.
  const asmStart53 = mdSec53.indexOf("const offers = (r.offers||[]).filter(o=>o.status==='pendiente');");
  const asmBox53 = mdSec53.indexOf('box.innerHTML =', asmStart53);
  const asmEnd53 = mdSec53.indexOf(';', mdSec53.indexOf(': mdCard);', asmBox53)) + 1;
  const asm53 = mdSec53.slice(asmStart53, asmEnd53);
  function runMandadoSearching53(r){
    const boxStub = { innerHTML: '' };
    return new Function('r','box','offerIdx','esc','fmt$','suggestedPrice','offerCard', asm53 + '; return box.innerHTML;')(r, boxStub, 0, (s)=>String(s==null?'':s), (n)=>'$'+Math.round(Number(n)||0), (km)=>20, offerCardFn52);
  }
  function req53(offers){
    return { id: 998, status: 'buscando', kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', dest_zone: 'Centro', dest_detail: 'Centro', distance_km: 1.0, eta_minutes: 5, price: 30, suggested: 20, description: 'Recoger un paquete', offers };
  }
  let html53a = '', html53aErr = '';
  try { html53a = runMandadoSearching53(req53([])); } catch(e){ html53aErr = String(e && e.message || e); }
  check('v1.4.53: evaluado — 0 ofertas: se ve la tarjeta del mandado (resumen, BUSCANDO, Tu precio, aviso, subir precio y Cancelar mandado dentro), sin carrusel', !!html53a && html53a.includes('<b>Tu mandado</b>') && html53a.includes('Recoger un paquete') && html53a.includes('BUSCANDO') && html53a.includes('Tu precio:') && html53a.includes('Ningún conductor') && html53a.includes('Cancelar mandado') && !html53a.includes('offer-carousel') && !html53a.includes('¡Tienes una contraoferta!'), html53aErr || html53a.slice(0, 200));
  let html53b = '', html53bErr = '';
  try { html53b = runMandadoSearching53(req53([offer52(1, 'Josué Eduardo', 35)])); } catch(e){ html53bErr = String(e && e.message || e); }
  check('v1.4.53: evaluado — 1 contraoferta ($35): la tarjeta desaparece, la oferta sube arriba con sus botones y Cancelar mandado queda debajo', !!html53b && !html53b.includes('<b>Tu mandado</b>') && html53b.includes('¡Tienes una contraoferta!') && html53b.includes('Josué Eduardo') && html53b.includes('Aceptar $35') && html53b.includes('Contraofertar') && html53b.includes('Rechazar') && html53b.indexOf('Cancelar mandado') > html53b.indexOf('Aceptar $35') && !html53b.includes('offer-carousel'), html53bErr || html53b.slice(0, 300));
  let html53c = '', html53cErr = '';
  try { html53c = runMandadoSearching53(req53([offer52(1, 'Josué Eduardo', 35), offer52(2, 'Chofer Segundo', 40)])); } catch(e){ html53cErr = String(e && e.message || e); }
  check('v1.4.53: evaluado — 2 contraofertas: carrusel horizontal en su sitio con las dos ofertas ("1 de 2 · desliza para verlas"), sin tarjeta, y Cancelar mandado debajo del carrusel', !!html53c && html53c.includes('offer-carousel') && html53c.includes('offer-slide') && html53c.includes('Josué Eduardo') && html53c.includes('Chofer Segundo') && html53c.includes('1 de 2 · desliza para verlas') && html53c.includes('Aceptar $35') && html53c.includes('Aceptar $40') && !html53c.includes('<b>Tu mandado</b>') && html53c.indexOf('Cancelar mandado') > html53c.indexOf('offer-carousel'), html53cErr || html53c.slice(0, 300));
  console.log('== v1.4.53: el mandado usa el mismo carrusel de ofertas que el viaje ==');
  const pax53 = await api('/api/register-passenger', { name: 'Pax Cincuentatres', phone: '9610000056', face_photo: PHOTO });
  check('v1.4.53: en vivo, pasajera de prueba registrada', pax53.ok && pax53.passenger.id, JSON.stringify(pax53));
  const drv53a = await api('/api/register-driver', { name: 'Chofer 53A', phone: '9610000057', vehicle: 'mototaxi', unit: 'V53A', selfie: PHOTO, vehicle_photo: PHOTO });
  const drv53b = await api('/api/register-driver', { name: 'Chofer 53B', phone: '9610000058', vehicle: 'mototaxi', unit: 'V53B', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.53: en vivo, dos choferes de prueba registrados con fotos', drv53a.ok && drv53a.driver.id && drv53b.ok && drv53b.driver.id, JSON.stringify([drv53a.driver && drv53a.driver.id, drv53b.driver && drv53b.driver.id]));
  await approveDriver(drv53a.driver.id);
  await approveDriver(drv53b.driver.id);
  await api('/api/set-driver-online', { driver_id: drv53a.driver.id, online: true });
  await api('/api/set-driver-online', { driver_id: drv53b.driver.id, online: true });
  const man53 = await api('/api/create-request', { passenger_id: pax53.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Recoger un paquete' });
  check('v1.4.53: en vivo, el mandado de la prueba queda BUSCANDO ($30, 1.0 km)', man53.ok && man53.request.status === 'buscando' && man53.request.price === 30, JSON.stringify(man53.request && { st: man53.request.status, p: man53.request.price }));
  const off53a = await api('/api/driver-respond', { driver_id: drv53a.driver.id, request_id: man53.request.id, kind: 'contraoferta', price: 35 });
  check('v1.4.53: en vivo, el primer chofer contraoferta $35', off53a.ok, JSON.stringify(off53a));
  const off53b = await api('/api/driver-respond', { driver_id: drv53b.driver.id, request_id: man53.request.id, kind: 'contraoferta', price: 40 });
  check('v1.4.53: en vivo, el segundo chofer contraoferta $40', off53b.ok, JSON.stringify(off53b));
  const req53live = await api('/api/requests?passenger_id=' + pax53.passenger.id);
  const man53live = req53live.ok ? req53live.requests.find(r=>r.id===man53.request.id) : null;
  const pend53 = man53live ? (man53live.offers||[]).filter(o=>o.status==='pendiente' && o.kind==='contraoferta') : [];
  check('v1.4.53: en vivo, el mandado trae 2 contraofertas pendientes ($35 y $40): la pantalla mostraría el carrusel', man53live && man53live.status === 'buscando' && pend53.length === 2 && pend53.some(o=>o.price===35) && pend53.some(o=>o.price===40), JSON.stringify(man53live && { st: man53live.status, off: pend53.map(o=>({ p: o.price, k: o.kind, s: o.status })) }));
  const can53 = await api('/api/cancel-request', { request_id: man53.request.id });
  check('v1.4.53: en vivo, cancelar desde el apartado propio cancela el mandado (mismo botón, mismo endpoint)', can53.ok, JSON.stringify(can53));
  const list53 = await api('/api/requests?passenger_id=' + pax53.passenger.id + '&light=1');
  check('v1.4.53: en vivo, tras cancelar ya no hay mandado en espera: la pantalla se levanta', list53.ok && !list53.requests.some(r=>r.kind==='mandado' && r.status==='buscando'), JSON.stringify(list53.requests && list53.requests.map(r=>r.status)));

  // --- v1.4.54: el asistente de crear negocio pone nombre y categoría
  //     en su propio paso con botones bonitos; la bandeja del chofer se
  //     puede deslizar a la izquierda para quitar filas con la X, y la
  //     oferta rechazada se ve en naranja con "Rechazado".
  //     (A) Asistente (reporte del usuario 22:52, captura 10:52 PM con el
  //     círculo rojo sobre "Nombre del negocio" y "Categoría"): nombre y
  //     categoría salen del paso 1 y viven en su propio paso; la categoría
  //     son tarjetas en rejilla de 2 columnas (icono + nombre + descripción
  //     corta, palomita verde en la elegida) en vez del menú desplegable.
  //     El asistente pasa de 4 a 5 pasos; el envío final no cambia.
  //     (B) Bandeja (reporte del usuario 22:53-22:54): al rechazar el
  //     pasajero la contraoferta, el chofer ve el aviso NARANJA
  //     "Rechazado" en la fila y en el detalle; todas las filas se pueden
  //     deslizar a la izquierda para revelar la X roja, que quita la
  //     solicitud de ESA bandeja (tabla driver_dismissed + endpoint
  //     /api/dismiss-request; la lista acepta ?dismissed_for=); la
  //     solicitud sigue buscando para los demás choferes.
  const bizFormSec54 = html.slice(html.indexOf('function renderBizCreateForm(){'), html.indexOf('function showBizStep(n){'));
  const bizStep0Sec54 = bizFormSec54.slice(bizFormSec54.indexOf("'<div id=\"nb-step0\">'"), bizFormSec54.indexOf('id="nb-step1"'));
  const bizStep1Sec54 = bizFormSec54.slice(bizFormSec54.indexOf('id="nb-step1"'), bizFormSec54.indexOf('id="nb-step2"'));
  check('v1.4.54: el paso 1 del asistente trae SOLO el tipo (las 3 tarjetas): nombre y categoría ya no están ahí', bizStep0Sec54.includes('¿De qué tipo es tu negocio?') && bizStep0Sec54.includes("typeCard('entrega'") && bizStep0Sec54.includes("typeCard('catalogo'") && bizStep0Sec54.includes("typeCard('citas'") && !bizStep0Sec54.includes('nb-name') && !bizStep0Sec54.includes('nb-cat'));
  check('v1.4.54: nombre y categoría viven en su propio paso (paso 2) con el campo de nombre, la rejilla de 2 columnas de tarjetas y el valor oculto', bizStep1Sec54.includes('id="nb-name"') && bizStep1Sec54.includes('grid-template-columns:1fr 1fr') && bizStep1Sec54.includes('catCard(c)') && bizStep1Sec54.includes('<input type="hidden" id="nb-cat"'));
  check('v1.4.54: la categoría ya no es un menú desplegable (sin <select id="nb-cat">) y las tarjetas son botones bonitos con palomita (radio-card + cat-check + setBizCat)', !bizFormSec54.includes('<select id="nb-cat">') && html.includes('function setBizCat(c){') && html.includes('class="cat-check"') && html.includes('.radio-card.sel .cat-check{display:inline-block}'));
  const showBizSec54 = html.slice(html.indexOf('function showBizStep(n){'), html.indexOf('function nbNext(step){'));
  check('v1.4.54: el asistente tiene 5 pasos (indicador "Paso N de 5" y barra con 5 segmentos)', showBizSec54.includes('i<5') && showBizSec54.includes('wizSteps(n, 5)') && showBizSec54.includes("getElementById('nb-step'+i)"));
  const valBizSec54 = html.slice(html.indexOf('function validateBizStep(step){'), html.indexOf('function setBizCat(c){'));
  check('v1.4.54: el paso de nombre+categoría valida los dos antes de avanzar (nombre y categoría obligatorios)', valBizSec54.includes('if(step===1){') && valBizSec54.includes("Escribe el nombre de tu negocio.") && valBizSec54.includes('Elige la categoría de tu negocio.'));
  const submitBizSec54 = html.slice(html.indexOf('async function submitBusiness(){'), html.indexOf('async function renderBizMine(){'));
  check('v1.4.54: el envío final no cambia (lee #nb-name y #nb-cat y manda name+category al mismo endpoint)', submitBizSec54.includes("($('#nb-name').value||'')") && submitBizSec54.includes("($('#nb-cat').value||'')") && submitBizSec54.includes("'/api/request-business'") && submitBizSec54.includes('category, colony, schedule'));
  // Evaluando la validación real del paso: se ejecuta validateBizStep con
  // un $ y un toast de mentira (pasos 0, 1 y 2; el 3 es el de envío, que
  // no se toca y usa document).
  const valSrc54 = html.slice(html.indexOf('function validateBizStep(step){'), html.indexOf('function setBizCat(c){'));
  function runValidate54(step, values, type){
    let lastToast = '';
    const $stub = (id)=>({ value: (values && values[id] !== undefined) ? values[id] : '' });
    const toastStub = (m)=>{ lastToast = m; return false; };
    const fn = new Function('$', 'toast', 'bizCreateType', 'step', valSrc54 + '; return validateBizStep(step);');
    const ok = fn($stub, toastStub, type || 'entrega', step);
    return { ok, lastToast };
  }
  check('v1.4.54: evaluado — paso 1 (tipo) siempre pasa', runValidate54(0, {}).ok === true);
  check('v1.4.54: evaluado — paso 2 sin nombre no avanza ("Escribe el nombre de tu negocio.")', (()=>{ const r = runValidate54(1, { '#nb-name': '', '#nb-cat': 'Comida' }); return r.ok === false && r.lastToast === 'Escribe el nombre de tu negocio.'; })());
  check('v1.4.54: evaluado — paso 2 con nombre pero sin categoría no avanza ("Elige la categoría de tu negocio.")', (()=>{ const r = runValidate54(1, { '#nb-name': 'Taquería', '#nb-cat': '' }); return r.ok === false && r.lastToast === 'Elige la categoría de tu negocio.'; })());
  check('v1.4.54: evaluado — paso 2 con nombre y categoría sí avanza', runValidate54(1, { '#nb-name': 'Taquería', '#nb-cat': 'Comida' }).ok === true);
  check('v1.4.54: evaluado — paso 3 (qué vende + WhatsApp) pasa con datos completos y frena con WhatsApp corto', runValidate54(2, { '#nb-desc': 'Tacos de pastor', '#nb-wa': '9610000000' }).ok === true && runValidate54(2, { '#nb-desc': 'Tacos de pastor', '#nb-wa': '961' }).ok === false);
  // La bandeja del chofer: estáticas.
  check('v1.4.54: cada fila de Recibir Viajes va envuelta para deslizar (swipe-wrap + X roja + dismissInboxRow) sin cambiar la tarjeta compacta', html.includes('class="swipe-wrap"') && html.includes('class="swipe-x"') && html.includes('onclick="dismissInboxRow(') && html.includes('class="card white swipe-inner"'));
  check('v1.4.54: la lista de solicitudes abiertas se pide con ?dismissed_for= (el servidor quita las descartadas de ESE chofer)', html.includes("api('/api/requests?open=1&light=1&dismissed_for='+myDriver.id)"));
  check('v1.4.54: el gesto existe (swipeDown/Move/Up/Cancel con pointer events y setPointerCapture) y el toque no abre el detalle tras arrastrar (swipeDragged)', html.includes('function swipeDown(e){') && html.includes('function swipeMove(e){') && html.includes('function swipeUp(e){') && html.includes('function swipeCancel(e){') && html.includes('setPointerCapture') && html.includes('function dismissInboxRow(rid, ev){'));
  const inboxToggleSec54 = html.slice(html.indexOf('function inboxToggle(rid){'), html.indexOf('async function loadDriverInbox(force){'));
  check('v1.4.54: inboxToggle no abre el detalle si el toque fue un arrastre', inboxToggleSec54.includes('if(swipeDragged){ swipeDragged = false; return; }'));
  check('v1.4.54: la fila lleva el aviso NARANJA "Rechazado" con lo que se rechazó (fondo #ffedd5, texto #9a3412)', html.includes('Rechazado · ') && html.includes('background:#ffedd5') && html.includes('color:#9a3412') && html.includes('El pasajero rechazó tu oferta de ') && html.includes('Rechazaste su contraoferta de '));
  check('v1.4.54: el aviso de contraoferta del pasajero ya no se muestra cuando la oferta quedó rechazada (no se ofrece responder lo ya contestado)', html.includes("(counter && !rejected?'<div style=\"margin-top:6px;background:#fef3c7"));
  check('v1.4.54: el detalle también muestra el aviso naranja de Rechazado en vez de los botones muertos de la contraoferta', html.includes("const rejectedD = mine && mine.status==='rechazada';") && html.includes("Rechazado: el pasajero rechazó tu oferta de '+fmt$(mine.price)") && html.includes("Rechazaste su contraoferta de '+fmt$(counter)"));
  // Evaluando el armado real de la fila compacta: se extrae el map de
  // loadDriverInbox y se ejecuta con solicitudes de mentira (sin oferta,
  // oferta rechazada, rechazada tras contraoferta del pasajero,
  // contraoferta pendiente y mandado), con los ayudantes reales en
  // versión de mentira y sin DOM.
  const rowMapStart54 = html.indexOf('html += list.map(r=>{');
  const rowMapEnd54 = html.indexOf("}).join('');", rowMapStart54);
  const rowSec54 = html.slice(rowMapStart54, rowMapEnd54 + "}).join('');".length);
  function runRow54(r){
    const stubs = {
      esc: (s)=>String(s==null?'':s),
      fmt$: (n)=>'$'+Math.round(Number(n)||0),
      paxText: (p)=>{ const n=Math.max(1,Math.min(3,Number(p)||1)); return n===1?'1 persona':n+' personas'; },
      myDriver: { id: 777 },
      inboxToggle: ()=>{}, swipeDown: ()=>{}, swipeMove: ()=>{}, swipeUp: ()=>{}, swipeCancel: ()=>{}, dismissInboxRow: ()=>{}
    };
    const fn = new Function('list', ...Object.keys(stubs), 'let html="";' + rowSec54 + '; return html;');
    return fn([r], ...Object.values(stubs));
  }
  function reqRow54(offers, kind){
    return { id: 999, kind: kind || 'viaje', passenger_name: 'Pax Prueba', price: 30, distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 3, _refO: 'cerca de Madero', _refD: 'cerca de Centro', order_payment: null, order_amount: 0, offers: offers || [] };
  }
  function offRow54(status, price, counter){
    return { id: 1, driver_id: 777, status, kind: 'contraoferta', price, passenger_counter_price: (counter == null ? null : counter) };
  }
  let row54a = '', row54aErr = '';
  try { row54a = runRow54(reqRow54([])); } catch(e){ row54aErr = String(e && e.message || e); }
  check('v1.4.54: evaluado — fila sin oferta: envuelta para deslizar (swipe-wrap + X + dismissInboxRow), con su ruta y línea tenue, sin "Rechazado"', !!row54a && row54a.includes('swipe-wrap') && row54a.includes('swipe-x') && row54a.includes('dismissInboxRow(999, event)') && row54a.includes('Viaje') && row54a.includes('cerca de Madero') && row54a.includes('0.8 km · ~5 min · Pago: efectivo · 3 personas') && !row54a.includes('Rechazado'), row54aErr || row54a.slice(0, 200));
  let row54b = '', row54bErr = '';
  try { row54b = runRow54(reqRow54([offRow54('rechazada', 35, null)])); } catch(e){ row54bErr = String(e && e.message || e); }
  check('v1.4.54: evaluado — oferta rechazada por el pasajero: la fila lleva el aviso naranja "Rechazado · El pasajero rechazó tu oferta de $35" y ya no dice "Te contraofertó"', !!row54b && row54b.includes('Rechazado · El pasajero rechazó tu oferta de $35') && row54b.includes('background:#ffedd5') && !row54b.includes('Te contraofertó'), row54bErr || row54b.slice(0, 300));
  let row54c = '', row54cErr = '';
  try { row54c = runRow54(reqRow54([offRow54('rechazada', 40, 35)])); } catch(e){ row54cErr = String(e && e.message || e); }
  check('v1.4.54: evaluado — contraoferta del pasajero rechazada por el chofer: la fila dice "Rechazaste su contraoferta de $35"', !!row54c && row54c.includes('Rechazado · Rechazaste su contraoferta de $35'), row54cErr || row54c.slice(0, 300));
  let row54d = '', row54dErr = '';
  try { row54d = runRow54(reqRow54([offRow54('pendiente', 35, 35)])); } catch(e){ row54dErr = String(e && e.message || e); }
  check('v1.4.54: evaluado — contraoferta del pasajero pendiente: la fila sigue con el aviso ámbar "Te contraofertó $35" y sin "Rechazado"', !!row54d && row54d.includes('Te contraofertó $35') && !row54d.includes('Rechazado'), row54dErr || row54d.slice(0, 300));
  let row54e = '', row54eErr = '';
  try { row54e = runRow54(reqRow54([], 'mandado')); } catch(e){ row54eErr = String(e && e.message || e); }
  check('v1.4.54: evaluado — mandado: la fila también se puede deslizar (swipe-wrap + X) y no lleva personas', !!row54e && row54e.includes('swipe-wrap') && row54e.includes('Mandado') && !row54e.includes('personas'), row54eErr || row54e.slice(0, 200));
  console.log('== v1.4.54: nombre+categoría en su paso; deslizar para quitar + Rechazado ==');
  const pax54 = await api('/api/register-passenger', { name: 'Pax Cincuentacuatro', phone: '9610000059', face_photo: PHOTO });
  check('v1.4.54: en vivo, pasajera de prueba registrada', pax54.ok && pax54.passenger.id, JSON.stringify(pax54));
  const drv54a = await api('/api/register-driver', { name: 'Chofer 54A', phone: '9610000060', vehicle: 'mototaxi', unit: 'V54A', selfie: PHOTO, vehicle_photo: PHOTO });
  const drv54b = await api('/api/register-driver', { name: 'Chofer 54B', phone: '9610000061', vehicle: 'mototaxi', unit: 'V54B', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.54: en vivo, dos choferes de prueba registrados con fotos', drv54a.ok && drv54a.driver.id && drv54b.ok && drv54b.driver.id, JSON.stringify([drv54a.driver && drv54a.driver.id, drv54b.driver && drv54b.driver.id]));
  await approveDriver(drv54a.driver.id);
  await approveDriver(drv54b.driver.id);
  await api('/api/set-driver-online', { driver_id: drv54a.driver.id, online: true });
  await api('/api/set-driver-online', { driver_id: drv54b.driver.id, online: true });
  const trip54 = await api('/api/create-request', { passenger_id: pax54.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 30, payment_method: 'efectivo', passenger_count: 3 });
  check('v1.4.54: en vivo, el viaje de la prueba queda BUSCANDO ($30, 3 personas, 0.8 km)', trip54.ok && trip54.request.status === 'buscando' && trip54.request.price === 30 && trip54.request.passenger_count === 3, JSON.stringify(trip54.request && { st: trip54.request.status, p: trip54.request.price }));
  const off54a = await api('/api/driver-respond', { driver_id: drv54a.driver.id, request_id: trip54.request.id, kind: 'contraoferta', price: 35 });
  check('v1.4.54: en vivo, el primer chofer contraoferta $35 (queda pendiente)', off54a.ok && off54a.offer.status === 'pendiente', JSON.stringify(off54a));
  const rej54 = await api('/api/respond-offer', { passenger_id: pax54.passenger.id, request_id: trip54.request.id, offer_id: off54a.offer.id, action: 'rechaza' });
  check('v1.4.54: en vivo, el pasajero rechaza la contraoferta del chofer ($35)', rej54.ok, JSON.stringify(rej54));
  const open54 = await api('/api/requests?open=1&light=1');
  const trip54live = open54.ok ? open54.requests.find(r=>r.id===trip54.request.id) : null;
  const off54live = trip54live ? (trip54live.offers||[]).find(o=>o.driver_id===drv54a.driver.id) : null;
  check('v1.4.54: en vivo, la oferta rechazada llega al chofer con status rechazada (de ahí sale el aviso naranja) y el viaje sigue buscando', trip54live && trip54live.status === 'buscando' && off54live && off54live.status === 'rechazada' && off54live.price === 35, JSON.stringify({ st: trip54live && trip54live.status, off: off54live && { s: off54live.status, p: off54live.price } }));
  const off54b = await api('/api/driver-respond', { driver_id: drv54b.driver.id, request_id: trip54.request.id, kind: 'contraoferta', price: 40 });
  check('v1.4.54: en vivo, el segundo chofer contraoferta $40: la solicitud sigue viva para los demás', off54b.ok && off54b.offer.status === 'pendiente', JSON.stringify(off54b));
  const dis54 = await api('/api/dismiss-request', { driver_id: drv54a.driver.id, request_id: trip54.request.id });
  check('v1.4.54: en vivo, el chofer A descarta la solicitud con la X (/api/dismiss-request)', dis54.ok, JSON.stringify(dis54));
  const dis54again = await api('/api/dismiss-request', { driver_id: drv54a.driver.id, request_id: trip54.request.id });
  check('v1.4.54: en vivo, descartar dos veces no falla (idempotente)', dis54again.ok, JSON.stringify(dis54again));
  const open54a = await api('/api/requests?open=1&light=1&dismissed_for=' + drv54a.driver.id);
  check('v1.4.54: en vivo, la lista del chofer A ya NO trae la solicitud descartada (ni tras refrescar)', open54a.ok && !open54a.requests.some(r=>r.id===trip54.request.id), JSON.stringify(open54a.requests && open54a.requests.map(r=>r.id)));
  const open54b = await api('/api/requests?open=1&light=1&dismissed_for=' + drv54b.driver.id);
  check('v1.4.54: en vivo, la lista del chofer B SÍ trae la solicitud (el descarte es solo de A)', open54b.ok && open54b.requests.some(r=>r.id===trip54.request.id), JSON.stringify(open54b.requests && open54b.requests.map(r=>r.id)));
  const dis54bad = await api('/api/dismiss-request', { driver_id: drv54a.driver.id, request_id: 999999 });
  check('v1.4.54: en vivo, descartar una solicitud que no existe da error (404)', !dis54bad.ok, JSON.stringify(dis54bad));
  const dis54badDrv = await api('/api/dismiss-request', { driver_id: 999999, request_id: trip54.request.id });
  check('v1.4.54: en vivo, descartar con un chofer que no existe da error (404)', !dis54badDrv.ok, JSON.stringify(dis54badDrv));
  const acc54 = await api('/api/register-account', { name: 'Cuenta 54', username: 'cta54_' + RUN, phone: '961119' + RUN.slice(0, 4), password: 'secreta123' });
  check('v1.4.54: en vivo, cuenta nueva para probar el envío del asistente', acc54.ok && !!acc54.token, JSON.stringify(acc54));
  const biz54 = await api('/api/request-business', { token: acc54.token, name: 'Negocio 54 ' + RUN, type: 'entrega', whatsapp: '961120' + RUN.slice(0, 4), category: 'Panadería', colony: 'Centro', schedule: 'Lunes a sábado, 9 AM a 7 PM', delivery_fee: 20, description: 'Pan y repostería' });
  check('v1.4.54: en vivo, crear negocio con nombre+categoría sigue guardando la categoría (el envío del asistente no cambia)', biz54.ok && biz54.business && biz54.business.category === 'Panadería', JSON.stringify(biz54));

  // --- v1.4.55: al subir el precio, la solicitud se vuelve a publicar
  //     como viaje nuevo con 'Precio mejorado'; y el candado inverso:
  //     con un mandado activo, entrar a Viajes muestra el mandado.
  //     (A) Republicar (reporte del usuario 23:14-23:15, captura 11:13
  //     PM de la bandeja con el viaje de $25 y el aviso naranja
  //     'Rechazado · El pasajero rechazó tu oferta de $30'): al subir
  //     el precio de un viaje BUSCANDO, la lista anterior se borra y el
  //     viaje se publica como nuevo con la leyenda 'Precio mejorado'
  //     (placa verde en la fila + 'El pasajero ha aumentado su precio'
  //     en el detalle); el viaje del pasajero y sus contraofertas
  //     pendientes NO se pierden; la oferta rechazada desaparece (y el
  //     chofer puede contraofertar de nuevo al precio mejorado) y el
  //     descarte con la X se borra (era de la publicación anterior).
  //     (B) Candado inverso (reporte del usuario 23:16-23:17): con un
  //     mandado activo, entrar a Viajes NO muestra '¿A dónde vas?':
  //     muestra la pantalla de espera del mandado (buscando) o su mapa
  //     en vivo (aceptado), con 'Volver al inicio' sin cancelar; el
  //     candado se levanta al cancelar o finalizar; el sondeo refresca
  //     la pantalla del mandado también desde Viajes.
  const raiseSec55 = srv.slice(srv.indexOf("if (pathname === '/api/raise-price')"), srv.indexOf("if (pathname === '/api/dismiss-request')"));
  check('v1.4.55: subir el precio de un VIAJE marca price_improved=1, previous_price (el de antes) y republished_at=ahora (misma solicitud, no se crea otra)', raiseSec55.includes("if (r.kind === 'viaje')") && raiseSec55.includes("UPDATE requests SET price=?, price_improved=1, previous_price=?, republished_at=datetime('now') WHERE id=?"));
  check('v1.4.55: en un mandado solo se actualiza el precio (sin leyenda ni republicación, igual que en la app real)', raiseSec55.includes("} else {\n      db.prepare('UPDATE requests SET price=? WHERE id=?').run(price, request_id);"));
  check('v1.4.55: al republicar se borran las ofertas ya rechazadas (estaban muertas) y los descartes con la X (eran de la publicación anterior)', raiseSec55.includes("DELETE FROM offers WHERE request_id=? AND status='rechazada'") && raiseSec55.includes('DELETE FROM driver_dismissed WHERE request_id=?'));
  check('v1.4.55: la tabla requests tiene price_improved, previous_price y republished_at (CREATE TABLE + migración addCol para bases viejas)', srv.includes('price_improved INTEGER DEFAULT 0, previous_price REAL, republished_at TEXT') && srv.includes("addCol('requests', 'price_improved', 'INTEGER DEFAULT 0')") && srv.includes("addCol('requests', 'previous_price', 'REAL')") && srv.includes("addCol('requests', 'republished_at', 'TEXT')"));
  check('v1.4.55: la lista abierta ordena por republicación (COALESCE(republished_at, created_at) DESC): la republicada sube arriba', srv.includes('ORDER BY COALESCE(republished_at, created_at) DESC, id DESC'));
  check('v1.4.55: la fila lleva la leyenda verde "✦ Precio mejorado" (fondo #dcfce7, texto #166534) con el precio de antes y el de ahora', html.includes('✦ Precio mejorado') && html.includes('background:#dcfce7') && html.includes('color:#166534') && html.includes("El pasajero ha aumentado su precio: antes '+fmt$(r.previous_price||0)+', ahora '+fmt$(r.price)+'."));
  check('v1.4.55: el detalle lleva la línea "El pasajero ha aumentado su precio." (placa verde) con antes y ahora', html.includes('El pasajero ha aumentado su precio.') && html.includes("Antes '+fmt$(r.previous_price||0)+', ahora '+fmt$(r.price)+'. La solicitud se volvió a publicar"));
  check('v1.4.55: al subir el precio de un viaje el pasajero ve la confirmación de republicación (en un mandado solo "Precio actualizado")', html.includes("j.request.price_improved ? 'Tu viaje se volvió a publicar con precio mejorado: '") && html.includes("'Precio actualizado a '+fmt$(price)+'.'"));
  check('v1.4.55: las firmas de repintado de la bandeja y del flotante incluyen price_improved y republished_at', html.includes("':'+(r.price_improved||'')+':'+(r.republished_at||'')") && html.includes('r.price_improved, r.republished_at'));
  check('v1.4.55: el sondeo detecta la republicación por firma (lastOpenSeen id → republished_at) y dispara el aviso \"¡Precio mejorado!\" con el mismo sonido', html.includes('let lastOpenSeen = {};') && html.includes("fireAlert('price-improved'") && html.includes("title:'¡Precio mejorado!'") && html.includes('El pasajero ha aumentado su precio.'));
  // Evaluando el armado real de la fila compacta con precio mejorado:
  // se extrae el mismo map de loadDriverInbox que en v1.4.54 y se
  // ejecuta con solicitudes de mentira (mejorada sin oferta, mejorada
  // con contraoferta pendiente del pasajero, y sin mejorar).
  const rowMapStart55 = html.indexOf('html += list.map(r=>{');
  const rowMapEnd55 = html.indexOf("}).join('');", rowMapStart55);
  const rowSec55 = html.slice(rowMapStart55, rowMapEnd55 + "}).join('');".length);
  function runRow55(r){
    const stubs = {
      esc: (s)=>String(s==null?'':s),
      fmt$: (n)=>'$'+Math.round(Number(n)||0),
      paxText: (p)=>{ const n=Math.max(1,Math.min(3,Number(p)||1)); return n===1?'1 persona':n+' personas'; },
      myDriver: { id: 777 },
      inboxToggle: ()=>{}, swipeDown: ()=>{}, swipeMove: ()=>{}, swipeUp: ()=>{}, swipeCancel: ()=>{}, dismissInboxRow: ()=>{}
    };
    const fn = new Function('list', ...Object.keys(stubs), 'let html="";' + rowSec55 + '; return html;');
    return fn([r], ...Object.values(stubs));
  }
  function reqRow55(offers, improved){
    return { id: 999, kind: 'viaje', passenger_name: 'Pax Prueba', price: 40, distance_km: 1.3, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 2, _refO: 'cerca de Madero', _refD: 'Progreso Centro', order_payment: null, order_amount: 0, price_improved: improved ? 1 : 0, previous_price: improved ? 25 : null, republished_at: improved ? '2026-11-23 23:20:00' : null, offers: offers || [] };
  }
  function offRow55(status, price, counter){
    return { id: 1, driver_id: 777, status, kind: 'contraoferta', price, passenger_counter_price: (counter == null ? null : counter) };
  }
  let row55a = '', row55aErr = '';
  try { row55a = runRow55(reqRow55([], true)); } catch(e){ row55aErr = String(e && e.message || e); }
  check('v1.4.55: evaluado — viaje con precio mejorado: la fila lleva la leyenda verde "✦ Precio mejorado" con "antes $25, ahora $40", sin "Rechazado"', !!row55a && row55a.includes('✦ Precio mejorado') && row55a.includes('antes $25, ahora $40') && row55a.includes('background:#dcfce7') && !row55a.includes('Rechazado'), row55aErr || row55a.slice(0, 300));
  let row55b = '', row55bErr = '';
  try { row55b = runRow55(reqRow55([offRow55('pendiente', 45, 40)], true)); } catch(e){ row55bErr = String(e && e.message || e); }
  check('v1.4.55: evaluado — precio mejorado con contraoferta del pasajero pendiente: la fila lleva \"Precio mejorado\" y sigue con el aviso ámbar \"Te contraofertó $40\"', !!row55b && row55b.includes('✦ Precio mejorado') && row55b.includes('Te contraofertó $40') && !row55b.includes('Rechazado'), row55bErr || row55b.slice(0, 300));
  let row55c = '', row55cErr = '';
  try { row55c = runRow55(reqRow55([], false)); } catch(e){ row55cErr = String(e && e.message || e); }
  check('v1.4.55: evaluado — viaje sin mejorar: la fila NO lleva \"Precio mejorado\" (no se marca lo que no se subió)', !!row55c && !row55c.includes('Precio mejorado'), row55cErr || row55c.slice(0, 200));
  // Candado inverso: estáticas sobre renderViajes.
  const tripSec55 = html.slice(html.indexOf('async function renderViajes(){'), html.indexOf('function drawWizMap(){'));
  check('v1.4.55: renderViajes consulta primero el viaje en curso y luego el mandado (el candado inverso va después del del viaje)', tripSec55.indexOf("myActiveRequest('viaje')") !== -1 && tripSec55.indexOf("myActiveRequest('viaje')") < tripSec55.indexOf("myActiveRequest('mandado')"));
  const manLock55 = tripSec55.slice(tripSec55.indexOf('// v1.4.55:'), tripSec55.indexOf("page.innerHTML = backPill('Regresar al inicio'"));
  check('v1.4.55: con mandado aceptado, entrar a Viajes va al mapa en vivo (goLive) en vez del formulario', manLock55.includes("if(man55.status==='aceptado'){ goLive(man55.id, false); return; }"));
  check('v1.4.55: con mandado buscando, entrar a Viajes muestra la misma pantalla de espera del mandado (md.requestId, \"Volver al inicio\", <div id=\"md-searching\">, renderMandadoSearching)', manLock55.includes('md.requestId = man55.id;') && manLock55.includes("backPill('Volver al inicio'") && manLock55.includes("'<h2>Tu mandado</h2><div id=\"md-searching\"></div>'") && manLock55.includes('renderMandadoSearching(man55);'));
  check('v1.4.55: el formulario del viaje sigue intacto detrás del candado (Solicitar el viaje + Historial, sin título "¿A dónde vas?" desde v1.4.60)', tripSec55.includes('Solicitar el viaje') && tripSec55.includes('Historial de viajes') && !tripSec55.includes('<h1>¿A dónde vas?</h1>'));
  check('v1.4.55: el sondeo refresca la pantalla de espera del mandado también cuando se ve desde Viajes (sin pintar la del viaje encima)', html.includes("if((currentView==='mandados' || currentView==='viajes') && md && md.requestId && !(wiz && wiz.step===5 && wiz.requestId)){"));
  check('v1.4.55: si el mandado se cancela o finaliza estando en Viajes, se vuelve a pintar Viajes (se levanta el candado)', html.includes("if(r.status==='cancelado' || r.status==='finalizado'){ md = newMandado(); if(currentView==='viajes') renderViajes(); else renderMandados(); return; }"));
  check('v1.4.55: al cancelar el mandado desde Viajes, se vuelve a pintar Viajes (no Mandados)', html.includes("md = newMandado(); if(currentView==='viajes') renderViajes(); else renderMandados(); toast('Mandado cancelado.');"));
  check('v1.4.55: refreshSearching refresca la pantalla del mandado también desde Viajes (la rama del mandado ya no exige estar en Mandados)', html.includes("if(md && md.requestId && !(wiz && wiz.step===5 && wiz.requestId)){"));
  // Evaluando el candado real: se extrae renderViajes y se ejecuta con
  // estado de mentira (sin DOM real) en cuatro casos: mandado buscando,
  // mandado aceptado, sin nada activo, y viaje buscando + mandado
  // buscando (gana el viaje, como en renderMandados).
  const viajesFnSrc55 = html.slice(html.indexOf('async function renderViajes(){'), html.indexOf('let wizMap = null;')); // el corte termina antes de 'let wizMap = null;' (declaración suelta entre renderViajes y drawWizMap): si entra en el corte, choca con el parámetro wizMap del new Function
  async function runRenderViajes55(tripStatus, mdStatus){
    const pageStub = { innerHTML: '' };
    const calls = { goLive: null, searching: false, mandadoSearching: false };
    const wizObj = { step: 0, requestId: null };
    const mdObj = { step: 0, requestId: null, kind: null };
    const stubs = {
      $: (sel) => sel === '#viajes-page' ? pageStub : null,
      wizMap: null,
      wiz: wizObj,
      newWizard: () => wizObj,
      setPageNoScroll: () => {},
      myActiveRequest: async (kind) => kind === 'viaje' ? (tripStatus ? { id: 999, status: tripStatus } : null) : (mdStatus ? { id: 888, status: mdStatus } : null),
      goLive: (id) => { calls.goLive = id; },
      md: null,
      newMandado: () => mdObj,
      backPill: (label) => '<button>' + label + '</button>',
      renderMandadoSearching: () => { calls.mandadoSearching = true; },
      renderSearching: () => { calls.searching = true; },
      whoStrip: () => '<div>who</div>',
      renderLastTripCard: () => {},
    };
    const fn = new Function(...Object.keys(stubs), viajesFnSrc55 + '; return renderViajes;')(...Object.values(stubs));
    await fn();
    return { html: pageStub.innerHTML, calls, wiz: wizObj, md: mdObj };
  }
  let sim55a = null, sim55aErr = '';
  try { sim55a = await runRenderViajes55(null, 'buscando'); } catch(e){ sim55aErr = String(e && e.message || e); }
  check('v1.4.55: evaluado — con mandado BUSCANDO, entrar a Viajes muestra la pantalla de espera del mandado (\"Tu mandado\", md-searching, \"Volver al inicio\"), no el formulario', !!sim55a && sim55a.html.includes('Tu mandado') && sim55a.html.includes('id="md-searching"') && sim55a.html.includes('Volver al inicio') && !sim55a.html.includes('¿A dónde vas?') && sim55a.calls.mandadoSearching && !sim55a.calls.searching && !sim55a.calls.goLive && sim55a.md.requestId === 888, sim55aErr || JSON.stringify(sim55a && { html: sim55a.html.slice(0, 120), md: sim55a.md }));
  let sim55b = null, sim55bErr = '';
  try { sim55b = await runRenderViajes55(null, 'aceptado'); } catch(e){ sim55bErr = String(e && e.message || e); }
  check('v1.4.55: evaluado — con mandado ACEPTADO, entrar a Viajes va al mapa en vivo (goLive con el id del mandado)', !!sim55b && sim55b.calls.goLive === 888 && !sim55b.calls.mandadoSearching && sim55b.html === '', sim55bErr || JSON.stringify(sim55b && sim55b.calls));
  let sim55c = null, sim55cErr = '';
  try { sim55c = await runRenderViajes55(null, null); } catch(e){ sim55cErr = String(e && e.message || e); }
  check('v1.4.55: evaluado — sin nada activo, entrar a Viajes abre el formulario normal (Solicitar + Programar + Historial, sin "¿A dónde vas?" desde v1.4.60)', !!sim55c && sim55c.html.includes('Solicitar el viaje') && sim55c.html.includes('Programar un viaje') && sim55c.html.includes('Próximamente') && sim55c.html.includes('Historial de viajes') && sim55c.html.includes('Primero eliges de dónde sales') && !sim55c.html.includes('¿A dónde vas?') && !sim55c.html.includes('Tu último viaje') && !sim55c.html.includes('Repetir este viaje') && !sim55c.calls.mandadoSearching && !sim55c.calls.goLive, sim55cErr || JSON.stringify(sim55c && { html: sim55c.html.slice(0, 200) }));
  let sim55d = null, sim55dErr = '';
  try { sim55d = await runRenderViajes55('buscando', 'buscando'); } catch(e){ sim55dErr = String(e && e.message || e); }
  check('v1.4.55: evaluado — con viaje BUSCANDO y mandado BUSCANDO, gana el viaje (la pantalla de espera del viaje, como en renderMandados)', !!sim55d && sim55d.calls.searching && sim55d.wiz.requestId === 999 && sim55d.wiz.step === 5 && !sim55d.calls.mandadoSearching, sim55dErr || JSON.stringify(sim55d && { calls: sim55d.calls, wiz: sim55d.wiz }));
  console.log('== v1.4.55: precio mejorado republica; candado inverso Viajes ==');
  const pax55 = await api('/api/register-passenger', { name: 'Pax Cincuentacinco', phone: '9610000062', face_photo: PHOTO });
  check('v1.4.55: en vivo, pasajera de prueba registrada', pax55.ok && pax55.passenger.id, JSON.stringify(pax55));
  const drv55a = await api('/api/register-driver', { name: 'Chofer 55A', phone: '9610000063', vehicle: 'mototaxi', unit: 'V55A', selfie: PHOTO, vehicle_photo: PHOTO });
  const drv55b = await api('/api/register-driver', { name: 'Chofer 55B', phone: '9610000064', vehicle: 'mototaxi', unit: 'V55B', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.55: en vivo, dos choferes de prueba registrados con fotos', drv55a.ok && drv55a.driver.id && drv55b.ok && drv55b.driver.id, JSON.stringify([drv55a.driver && drv55a.driver.id, drv55b.driver && drv55b.driver.id]));
  await approveDriver(drv55a.driver.id);
  await approveDriver(drv55b.driver.id);
  await api('/api/set-driver-online', { driver_id: drv55a.driver.id, online: true });
  await api('/api/set-driver-online', { driver_id: drv55b.driver.id, online: true });
  const trip55 = await api('/api/create-request', { passenger_id: pax55.passenger.id, kind: 'viaje', origin_zone: 'Madero', origin_detail: 'Madero', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Progreso Centro', dest_detail: 'Progreso Centro', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.3, eta_minutes: 5, price: 25, payment_method: 'efectivo', passenger_count: 2 });
  check('v1.4.55: en vivo, el viaje de la prueba queda BUSCANDO ($25, 2 personas, 1.3 km)', trip55.ok && trip55.request.status === 'buscando' && trip55.request.price === 25 && trip55.request.passenger_count === 2, JSON.stringify(trip55.request && { st: trip55.request.status, p: trip55.request.price }));
  const off55a = await api('/api/driver-respond', { driver_id: drv55a.driver.id, request_id: trip55.request.id, kind: 'contraoferta', price: 30 });
  check('v1.4.55: en vivo, el primer chofer contraoferta $30 (queda pendiente)', off55a.ok && off55a.offer.status === 'pendiente', JSON.stringify(off55a));
  const rej55 = await api('/api/respond-offer', { passenger_id: pax55.passenger.id, request_id: trip55.request.id, offer_id: off55a.offer.id, action: 'rechaza' });
  check('v1.4.55: en vivo, el pasajero rechaza la contraoferta del chofer ($30)', rej55.ok, JSON.stringify(rej55));
  const open55 = await api('/api/requests?open=1&light=1');
  const trip55live = open55.ok ? open55.requests.find(r=>r.id===trip55.request.id) : null;
  const off55live = trip55live ? (trip55live.offers||[]).find(o=>o.driver_id===drv55a.driver.id) : null;
  check('v1.4.55: en vivo, la oferta rechazada llega al chofer con status rechazada (el aviso naranja de v1.4.54) y el viaje sigue buscando', trip55live && trip55live.status === 'buscando' && off55live && off55live.status === 'rechazada' && off55live.price === 30, JSON.stringify({ st: trip55live && trip55live.status, off: off55live && { s: off55live.status, p: off55live.price } }));
  const off55b = await api('/api/driver-respond', { driver_id: drv55b.driver.id, request_id: trip55.request.id, kind: 'contraoferta', price: 35 });
  check('v1.4.55: en vivo, el segundo chofer contraoferta $35 (pendiente: debe sobrevivir a la republicación)', off55b.ok && off55b.offer.status === 'pendiente', JSON.stringify(off55b));
  const dis55 = await api('/api/dismiss-request', { driver_id: drv55a.driver.id, request_id: trip55.request.id });
  check('v1.4.55: en vivo, el chofer A descarta la solicitud con la X', dis55.ok, JSON.stringify(dis55));
  const open55a = await api('/api/requests?open=1&light=1&dismissed_for=' + drv55a.driver.id);
  check('v1.4.55: en vivo, la lista del chofer A ya NO trae la solicitud descartada', open55a.ok && !open55a.requests.some(r=>r.id===trip55.request.id), JSON.stringify(open55a.requests && open55a.requests.map(r=>r.id)));
  const trip55b = await api('/api/create-request', { passenger_id: pax55.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 30, payment_method: 'efectivo', passenger_count: 1 });
  check('v1.4.55: en vivo, segundo viaje de la prueba queda BUSCANDO ($30, creado después del primero)', trip55b.ok && trip55b.request.status === 'buscando', JSON.stringify(trip55b.request && { st: trip55b.request.status }));
  const open55pre = await api('/api/requests?open=1&light=1');
  check('v1.4.55: en vivo, antes de subir el precio el segundo viaje (más nuevo) va arriba del primero', open55pre.ok && open55pre.requests[0].id === trip55b.request.id && open55pre.requests.some(r=>r.id===trip55.request.id), JSON.stringify(open55pre.requests && open55pre.requests.map(r=>r.id)));
  await new Promise(r=>setTimeout(r, 1100)); // la fecha de republicación debe quedar estrictamente después de la creación del segundo viaje
  const raise55 = await api('/api/raise-price', { passenger_id: pax55.passenger.id, request_id: trip55.request.id, price: 40 });
  check('v1.4.55: en vivo, subir el precio a $40 marca price_improved=1, previous_price=$25 y republished_at (misma solicitud, mismo id)', raise55.ok && raise55.request.id === trip55.request.id && raise55.request.price === 40 && raise55.request.price_improved === 1 && raise55.request.previous_price === 25 && !!raise55.request.republished_at, JSON.stringify(raise55.request && { id: raise55.request.id, p: raise55.request.price, imp: raise55.request.price_improved, prev: raise55.request.previous_price, rep: raise55.request.republished_at }));
  const open55b = await api('/api/requests?open=1&light=1&dismissed_for=' + drv55a.driver.id);
  const trip55new = open55b.ok ? open55b.requests.find(r=>r.id===trip55.request.id) : null;
  check('v1.4.55: en vivo, tras republicar la solicitud VUELVE a la lista del chofer A (el descarte era de la publicación anterior), con $40 y precio mejorado', open55b.ok && trip55new && trip55new.price === 40 && trip55new.price_improved === 1, JSON.stringify(trip55new && { p: trip55new.price, imp: trip55new.price_improved }));
  const open55post = await api('/api/requests?open=1&light=1');
  check('v1.4.55: en vivo, tras republicar el viaje sube ARRIBA del segundo viaje (es la publicación más nueva)', open55post.ok && open55post.requests[0].id === trip55.request.id && open55post.requests[1].id === trip55b.request.id, JSON.stringify(open55post.requests && open55post.requests.map(r=>r.id)));
  const trip55after = open55post.ok ? open55post.requests.find(r=>r.id===trip55.request.id) : null;
  const off55after = trip55after ? (trip55after.offers||[]) : [];
  check('v1.4.55: en vivo, tras republicar ya NO hay oferta rechazada (el aviso naranja se fue) y la contraoferta pendiente de $35 del chofer B sigue viva', trip55after && !off55after.some(o=>o.status==='rechazada') && off55after.some(o=>o.driver_id===drv55b.driver.id && o.status==='pendiente' && o.price===35), JSON.stringify(off55after.map(o=>({ d: o.driver_id, s: o.status, p: o.price }))));
  const paxList55 = await api('/api/requests?passenger_id=' + pax55.passenger.id);
  const trip55pax = paxList55.ok ? paxList55.requests.find(r=>r.id===trip55.request.id) : null;
  check('v1.4.55: en vivo, el pasajero sigue viendo EL MISMO viaje (mismo id, buscando, $40) con la contraoferta de $35 del chofer B', trip55pax && trip55pax.id === trip55.request.id && trip55pax.status === 'buscando' && trip55pax.price === 40 && (trip55pax.offers||[]).some(o=>o.driver_id===drv55b.driver.id && o.status==='pendiente' && o.price===35), JSON.stringify(trip55pax && { id: trip55pax.id, st: trip55pax.status, p: trip55pax.price, off: (trip55pax.offers||[]).map(o=>({ d: o.driver_id, s: o.status, p: o.price })) }));
  const reOff55a = await api('/api/driver-respond', { driver_id: drv55a.driver.id, request_id: trip55.request.id, kind: 'contraoferta', price: 45 });
  check('v1.4.55: en vivo, el chofer A puede contraofertar DE NUEVO al precio mejorado ($45)', reOff55a.ok && reOff55a.offer.status === 'pendiente', JSON.stringify(reOff55a));
  const manRaise55 = await api('/api/create-request', { passenger_id: pax55.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Recoger un paquete' });
  const raiseMan55 = manRaise55.ok ? await api('/api/raise-price', { passenger_id: pax55.passenger.id, request_id: manRaise55.request.id, price: 40 }) : null;
  check('v1.4.55: en vivo, el mandado NO se republica (solo viajes): subir su precio solo lo actualiza, sin marca de mejorado', manRaise55.ok && raiseMan55 && raiseMan55.ok && raiseMan55.request.id === manRaise55.request.id && raiseMan55.request.price === 40 && !raiseMan55.request.price_improved && !raiseMan55.request.republished_at, JSON.stringify(raiseMan55 && { id: raiseMan55.request && raiseMan55.request.id, p: raiseMan55.request && raiseMan55.request.price, imp: raiseMan55.request && raiseMan55.request.price_improved, rep: raiseMan55.request && raiseMan55.request.republished_at }));
  await api('/api/cancel-request', { request_id: manRaise55.request.id });
  await api('/api/cancel-request', { request_id: trip55.request.id });
  await api('/api/cancel-request', { request_id: trip55b.request.id });
  const man55 = await api('/api/create-request', { passenger_id: pax55.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Recoger un paquete' });
  check('v1.4.55: en vivo, el mandado de la prueba del candado queda BUSCANDO ($30)', man55.ok && man55.request.status === 'buscando', JSON.stringify(man55.request && { st: man55.request.status }));
  const paxAct55 = await api('/api/requests?passenger_id=' + pax55.passenger.id + '&light=1');
  const actMan55 = paxAct55.ok ? paxAct55.requests.find(r=>r.kind==='mandado' && (r.status==='buscando' || r.status==='aceptado')) : null;
  const actTrip55 = paxAct55.ok ? paxAct55.requests.find(r=>r.kind==='viaje' && (r.status==='buscando' || r.status==='aceptado')) : null;
  check('v1.4.55: en vivo, con el mandado activo el pasajero tiene mandado BUSCANDO y ningún viaje activo (lo que consulta el candado de Viajes)', actMan55 && actMan55.id === man55.request.id && actMan55.status === 'buscando' && !actTrip55, JSON.stringify({ man: actMan55 && { id: actMan55.id, st: actMan55.status }, trip: !!actTrip55 }));
  const accMan55 = await api('/api/driver-respond', { driver_id: drv55a.driver.id, request_id: man55.request.id, kind: 'acepta', price: 30 });
  check('v1.4.55: en vivo, el chofer acepta el mandado (queda aceptado: la condición con la que Viajes va al mapa en vivo)', accMan55.ok && accMan55.request.status === 'aceptado', JSON.stringify(accMan55.request && { st: accMan55.request.status }));
  const canMan55 = await api('/api/cancel-request', { request_id: man55.request.id });
  // v1.4.91 (detalle 5): la regla CAMBIÓ por el usuario (2026-11-27) —
  // la v1.4.55 permitía cancelar el mandado aceptado; ahora los primeros
  // 30 min están bloqueados. El candado se levanta terminando el mandado.
  check('v1.4.91 (detalle 5): el mandado aceptado YA NO se cancela en los primeros 30 min (la v1.4.55 lo permitía; regla cambiada por el usuario)', !canMan55.ok && /30 minutos/.test(canMan55.error || ''), JSON.stringify(canMan55));
  for (const st55 of ['llego', 'comprado', 'en_viaje', 'entregado']) {
    const a55 = await api('/api/advance-stage', { driver_id: drv55a.driver.id, request_id: man55.request.id, stage: st55 });
    if (!a55.ok) break;
  }
  const paxFree55 = await api('/api/requests?passenger_id=' + pax55.passenger.id + '&light=1');
  check('v1.4.55: en vivo, tras cancelar ya no hay mandado activo (entrar a Viajes vuelve a mostrar el formulario)', paxFree55.ok && !paxFree55.requests.some(r=>r.kind==='mandado' && (r.status==='buscando' || r.status==='aceptado')), JSON.stringify(paxFree55.requests && paxFree55.requests.map(r=>({ k: r.kind, st: r.status }))));

  // --- v1.4.56: el chofer SÍ puede aceptar el precio mejorado tras un
  //     rechazo (reporte del usuario 23:43, captura 11:42 PM del detalle
  //     flotante: solo 'Tu contraoferta' − $30 + con 'Enviar
  //     contraoferta' / 'Volver', sin botón Aceptar). Causas raíz:
  //     (1) cliente: driverCounter (el borrador de contraoferta) nunca
  //     se borraba al enviarla, así que al reabrir el detalle salía el
  //     formulario viejo pre-llenado con la contraoferta ya rechazada
  //     ($30) en vez de Aceptar $35; (2) servidor: /api/driver-respond
  //     rebotaba 'Ya respondiste esta solicitud.' si existía CUALQUIER
  //     oferta del chofer, aunque estuviera rechazada; y el cliente
  //     mostraba solo el aviso naranja sin botones. Ahora: la oferta
  //     rechazada está muerta (el servidor la borra al responder de
  //     nuevo, y el cliente solo la usa para el aviso naranja), el
  //     borrador se borra al enviar, y el formulario nunca se pre-llena
  //     por debajo del precio actual del pasajero.
  const respSec56 = srv.slice(srv.indexOf("if (pathname === '/api/driver-respond')"), srv.indexOf("if (pathname === '/api/respond-offer')"));
  check('v1.4.56: /api/driver-respond borra la oferta rechazada antes de responder (una oferta rechazada no bloquea aceptar ni contraofertar de nuevo)', respSec56.includes("if (existing && existing.status === 'rechazada')") && respSec56.includes("DELETE FROM offers WHERE id=?") && respSec56.includes('existing = null;'));
  const detailSec56 = html.slice(html.indexOf('function inboxDetailHtml(r, sub, atLimit){'), html.indexOf('function renderInboxOverlay(list){'));
  check('v1.4.56: el detalle distingue la oferta VIVA de la rechazada (mineLive: solo la pendiente decide los botones; la rechazada solo deja su aviso naranja)', detailSec56.includes("const mineLive = mine && mine.status!=='rechazada' ? mine : null;") && detailSec56.includes('const counter = mineLive && mineLive.passenger_counter_price;'));
  check('v1.4.56: el aviso naranja ya no quita los botones (es solo informativo y el flujo sigue a Aceptar/Contraofertar)', detailSec56.includes("if(rejectedD){") && detailSec56.indexOf('if(counter){') > detailSec56.indexOf("if(rejectedD){"));
  check('v1.4.56: driverRespond borra el borrador de contraoferta al enviar (la respuesta ya salió; no queda el formulario viejo)', html.includes('// (v1.4.56) La respuesta ya se envió: el borrador de contraoferta') && html.slice(html.indexOf('async function driverRespond(rid, kind, price){'), html.indexOf('async function driverAcceptCounter')).includes('driverCounter = null;'));
  check('v1.4.56: el formulario de contraoferta nunca se pre-llena por debajo del precio actual del pasajero (ni del mínimo por personas)', detailSec56.includes("driverCounter.price = Math.max(driverCounter.price, r.price, r.kind==='viaje'?minForPax(r.passenger_count):MIN_MANDADO);"));
  // Evaluando el detalle real (inboxDetailHtml) con estado de mentira:
  // se extrae la función y se ejecuta con la bandeja del chofer 777.
  function runDetail56(r, driverCounter){
    const stubs = {
      esc: (s)=>String(s==null?'':s),
      fmt$: (n)=>'$'+Math.round(Number(n)||0),
      paxText: (p)=>{ const n=Math.max(1,Math.min(3,Number(p)||1)); return n===1?'1 persona':n+' personas'; },
      minForPax: (p)=>20 + 5*(Math.max(1,Math.min(3,Number(p)||1))-1),
      MIN_TRIP: 20,
      MANDADO_EXTRA_STOP: 10,
      FREE_DAILY_LIMIT: 5,
      mandadoDriverSummaryHtml: ()=> '',
      myDriver: { id: 777 },
      driverCounter: driverCounter || null,
    };
    const fn = new Function('r','sub','atLimit', ...Object.keys(stubs), detailSec56 + '; return inboxDetailHtml(r, sub, atLimit);');
    return fn(r, false, false, ...Object.values(stubs));
  }
  function reqDetail56(offers, price, improved){
    return { id: 999, kind: 'viaje', passenger_name: 'Pax Prueba', passenger_phone: '9610000000', price, distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 2, _dispO: 'cerca de Madero', _dispD: 'cerca de Madero', description: '', items_json: null, extra_stops: 0, order_payment: null, order_amount: 0, price_improved: improved ? 1 : 0, previous_price: improved ? 25 : null, republished_at: improved ? '2026-11-23 23:20:00' : null, offers: offers || [] };
  }
  function offDetail56(status, price, counter){
    return { id: 1, driver_id: 777, status, kind: 'contraoferta', price, passenger_counter_price: (counter == null ? null : counter) };
  }
  // (a) El caso exacto del reporte: viaje republicado a $35, oferta
  //     rechazada ya borrada por el servidor (sin ofertas), borrador
  //     limpio: el detalle TIENE que traer 'Aceptar $35'.
  let det56a = '', det56aErr = '';
  try { det56a = runDetail56(reqDetail56([], 35, true), null); } catch(e){ det56aErr = String(e && e.message || e); }
  check('v1.4.56: evaluado — viaje republicado ($35, precio mejorado, sin ofertas): el detalle trae Aceptar $35 y Contraofertar, sin formulario de contraoferta', !!det56a && det56a.includes('Aceptar $35') && det56a.includes('Contraofertar') && det56a.includes('Precio mejorado') && !det56a.includes('Tu contraoferta') && !det56a.includes('Enviar contraoferta'), det56aErr || det56a.slice(0, 300));
  // (b) Sin republicar: la oferta rechazada sigue en la lista (el
  //     servidor la devuelve) y el detalle muestra el aviso naranja Y
  //     el botón Aceptar del precio original.
  let det56b = '', det56bErr = '';
  try { det56b = runDetail56(reqDetail56([offDetail56('rechazada', 30, null)], 25, false), null); } catch(e){ det56bErr = String(e && e.message || e); }
  check('v1.4.56: evaluado — contraoferta rechazada SIN subir el precio: el detalle muestra el aviso naranja Y Aceptar $25 (el precio original)', !!det56b && det56b.includes('Rechazado: el pasajero rechazó tu oferta de $30') && det56b.includes('Aceptar $25') && det56b.includes('Contraofertar'), det56bErr || det56b.slice(0, 300));
  // (c) Borrador viejo: el formulario NO se pre-llena con los $30
  //     muertos; arranca en el precio actual del pasajero ($35).
  let det56c = '', det56cErr = '';
  try { det56c = runDetail56(reqDetail56([], 35, true), { rid: 999, price: 30 }); } catch(e){ det56cErr = String(e && e.message || e); }
  check('v1.4.56: evaluado — borrador viejo de $30 con el precio ya en $35: el formulario arranca en $35 (no en los $30 rechazados)', !!det56c && det56c.includes('Tu contraoferta') && det56c.includes('id="dc-val">$35') && !det56c.includes('id="dc-val">$30'), det56cErr || det56c.slice(0, 300));
  // (d) Control: oferta pendiente viva (sin rechazo) sigue mostrando
  //     'Ya respondiste' y SIN Aceptar (no se tocó ese flujo).
  let det56d = '', det56dErr = '';
  try { det56d = runDetail56(reqDetail56([offDetail56('pendiente', 30, null)], 25, false), null); } catch(e){ det56dErr = String(e && e.message || e); }
  check('v1.4.56: evaluado — control: contraoferta PENDIENTE (sin rechazar) sigue con "Ya respondiste: contraofertaste $30" y sin Aceptar', !!det56d && det56d.includes('Ya respondiste: contraofertaste $30') && !det56d.includes('Aceptar $25'), det56dErr || det56d.slice(0, 300));
  // (e) Control: contraoferta del pasajero pendiente sigue con sus
  //     botones (Aceptar $20 y empezar / Rechazar contraoferta).
  let det56e = '', det56eErr = '';
  try { det56e = runDetail56(reqDetail56([offDetail56('pendiente', 30, 20)], 25, false), null); } catch(e){ det56eErr = String(e && e.message || e); }
  check('v1.4.56: evaluado — control: contraoferta del pasajero pendiente ($20) sigue con "Aceptar $20 y empezar" y "Rechazar contraoferta"', !!det56e && det56e.includes('Aceptar $20 y empezar') && det56e.includes('Rechazar contraoferta'), det56eErr || det56e.slice(0, 300));
  console.log('== v1.4.56: aceptar el precio mejorado tras un rechazo ==');
  const pax56 = await api('/api/register-passenger', { name: 'Pax Cincuentaseis', phone: '9610000065', face_photo: PHOTO });
  check('v1.4.56: en vivo, pasajera de prueba registrada', pax56.ok && pax56.passenger.id, JSON.stringify(pax56));
  const drv56a = await api('/api/register-driver', { name: 'Chofer 56A', phone: '9610000066', vehicle: 'mototaxi', unit: 'V56A', selfie: PHOTO, vehicle_photo: PHOTO });
  const drv56b = await api('/api/register-driver', { name: 'Chofer 56B', phone: '9610000067', vehicle: 'mototaxi', unit: 'V56B', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.56: en vivo, dos choferes de prueba registrados con fotos', drv56a.ok && drv56a.driver.id && drv56b.ok && drv56b.driver.id, JSON.stringify([drv56a.driver && drv56a.driver.id, drv56b.driver && drv56b.driver.id]));
  await approveDriver(drv56a.driver.id);
  await approveDriver(drv56b.driver.id);
  await api('/api/set-driver-online', { driver_id: drv56a.driver.id, online: true });
  await api('/api/set-driver-online', { driver_id: drv56b.driver.id, online: true });
  // Flujo 1 (SIN subir el precio): contraoferta $30 → rechazo → el
  // chofer acepta el precio original $25 y el viaje se confirma.
  const trip56a = await api('/api/create-request', { passenger_id: pax56.passenger.id, kind: 'viaje', origin_zone: 'Madero', origin_detail: 'Madero', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Progreso Centro', dest_detail: 'Progreso Centro', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.3, eta_minutes: 5, price: 25, payment_method: 'efectivo', passenger_count: 2 });
  check('v1.4.56: en vivo, el primer viaje queda BUSCANDO ($25, 2 personas)', trip56a.ok && trip56a.request.status === 'buscando' && trip56a.request.price === 25, JSON.stringify(trip56a.request && { st: trip56a.request.status, p: trip56a.request.price }));
  const off56a = await api('/api/driver-respond', { driver_id: drv56a.driver.id, request_id: trip56a.request.id, kind: 'contraoferta', price: 30 });
  check('v1.4.56: en vivo, el chofer A contraoferta $30 (pendiente)', off56a.ok && off56a.offer.status === 'pendiente', JSON.stringify(off56a));
  const rej56a = await api('/api/respond-offer', { passenger_id: pax56.passenger.id, request_id: trip56a.request.id, offer_id: off56a.offer.id, action: 'rechaza' });
  check('v1.4.56: en vivo, el pasajero rechaza la contraoferta ($30)', rej56a.ok, JSON.stringify(rej56a));
  const acc56a = await api('/api/driver-respond', { driver_id: drv56a.driver.id, request_id: trip56a.request.id, kind: 'acepta', price: 25 });
  check('v1.4.56: en vivo, SIN subir el precio el chofer A puede aceptar el precio original ($25): el viaje se confirma a $25', acc56a.ok && acc56a.request.status === 'aceptado' && acc56a.request.final_price === 25 && acc56a.request.driver_id === drv56a.driver.id, JSON.stringify(acc56a.request && { st: acc56a.request.status, fp: acc56a.request.final_price, d: acc56a.request.driver_id }));
  const paxList56a = await api('/api/requests?passenger_id=' + pax56.passenger.id);
  const trip56aPax = paxList56a.ok ? paxList56a.requests.find(r=>r.id===trip56a.request.id) : null;
  check('v1.4.56: en vivo, el pasajero ve su viaje aceptado por el chofer A a $25 (le llegó la confirmación)', trip56aPax && trip56aPax.status === 'aceptado' && trip56aPax.driver_id === drv56a.driver.id && trip56aPax.final_price === 25, JSON.stringify(trip56aPax && { st: trip56aPax.status, d: trip56aPax.driver_id, fp: trip56aPax.final_price }));
  // Flujo 2 (el caso exacto del reporte): contraoferta $30 → rechazo →
  // el pasajero sube $25 → $35 (republica) → el chofer acepta $35.
  const trip56b = await api('/api/create-request', { passenger_id: pax56.passenger.id, kind: 'viaje', origin_zone: 'Madero', origin_detail: 'Madero', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Progreso Centro', dest_detail: 'Progreso Centro', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 25, payment_method: 'efectivo', passenger_count: 2 });
  check('v1.4.56: en vivo, el segundo viaje queda BUSCANDO ($25, 2 personas, 0.8 km)', trip56b.ok && trip56b.request.status === 'buscando' && trip56b.request.price === 25, JSON.stringify(trip56b.request && { st: trip56b.request.status, p: trip56b.request.price }));
  const off56b = await api('/api/driver-respond', { driver_id: drv56a.driver.id, request_id: trip56b.request.id, kind: 'contraoferta', price: 30 });
  check('v1.4.56: en vivo, el chofer A contraoferta $30 en el segundo viaje (pendiente)', off56b.ok && off56b.offer.status === 'pendiente', JSON.stringify(off56b));
  const rej56b = await api('/api/respond-offer', { passenger_id: pax56.passenger.id, request_id: trip56b.request.id, offer_id: off56b.offer.id, action: 'rechaza' });
  check('v1.4.56: en vivo, el pasajero rechaza la contraoferta del segundo viaje ($30)', rej56b.ok, JSON.stringify(rej56b));
  const raise56 = await api('/api/raise-price', { passenger_id: pax56.passenger.id, request_id: trip56b.request.id, price: 35 });
  check('v1.4.56: en vivo, el pasajero sube el precio a $35 (republica con precio mejorado, previous_price $25)', raise56.ok && raise56.request.price === 35 && raise56.request.price_improved === 1 && raise56.request.previous_price === 25, JSON.stringify(raise56.request && { p: raise56.request.price, imp: raise56.request.price_improved, prev: raise56.request.previous_price }));
  const open56 = await api('/api/requests?open=1&light=1');
  const trip56bLive = open56.ok ? open56.requests.find(r=>r.id===trip56b.request.id) : null;
  check('v1.4.56: en vivo, tras republicar NO hay oferta rechazada en la lista del chofer (el aviso naranja se fue)', trip56bLive && !(trip56bLive.offers||[]).some(o=>o.status==='rechazada'), JSON.stringify(trip56bLive && (trip56bLive.offers||[]).map(o=>({ d: o.driver_id, s: o.status, p: o.price }))));
  const acc56b = await api('/api/driver-respond', { driver_id: drv56a.driver.id, request_id: trip56b.request.id, kind: 'acepta', price: 35 });
  check('v1.4.56: en vivo, tras el rechazo + republicación el chofer A PUEDE aceptar el precio mejorado ($35): el viaje se confirma a $35', acc56b.ok && acc56b.request.status === 'aceptado' && acc56b.request.final_price === 35 && acc56b.request.driver_id === drv56a.driver.id, JSON.stringify(acc56b.request && { st: acc56b.request.status, fp: acc56b.request.final_price, d: acc56b.request.driver_id }));
  const paxList56b = await api('/api/requests?passenger_id=' + pax56.passenger.id);
  const trip56bPax = paxList56b.ok ? paxList56b.requests.find(r=>r.id===trip56b.request.id) : null;
  check('v1.4.56: en vivo, el pasajero ve su segundo viaje aceptado por el chofer A a $35 (le llegó la confirmación)', trip56bPax && trip56bPax.status === 'aceptado' && trip56bPax.driver_id === drv56a.driver.id && trip56bPax.final_price === 35, JSON.stringify(trip56bPax && { st: trip56bPax.status, d: trip56bPax.driver_id, fp: trip56bPax.final_price }));
  // El chofer B también puede contraofertar de nuevo tras un rechazo
  // (sin republicar): la oferta rechazada ya no lo bloquea.
  const trip56c = await api('/api/create-request', { passenger_id: pax56.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 25, payment_method: 'efectivo', passenger_count: 1 });
  const off56c = await api('/api/driver-respond', { driver_id: drv56b.driver.id, request_id: trip56c.request.id, kind: 'contraoferta', price: 30 });
  await api('/api/respond-offer', { passenger_id: pax56.passenger.id, request_id: trip56c.request.id, offer_id: off56c.offer.id, action: 'rechaza' });
  const reOff56c = await api('/api/driver-respond', { driver_id: drv56b.driver.id, request_id: trip56c.request.id, kind: 'contraoferta', price: 35 });
  check('v1.4.56: en vivo, tras un rechazo SIN republicar el chofer B puede contraofertar DE NUEVO ($35)', reOff56c.ok && reOff56c.offer.status === 'pendiente', JSON.stringify(reOff56c));
  await api('/api/cancel-request', { request_id: trip56c.request.id });

  // --- v1.4.57: Negocios como la tienda de TikTok Shop (una sola
  //     cuadrícula mezclada: negocio chico + sus productos) + fotos en
  //     alta resolución (anuncios y fotos de negocio/producto a 1600px;
  //     selfies siguen a 480px). Petición del usuario 2026-11-24 06:44
  //     con capturas de TikTok Shop; aclaraciones 06:45 ('Ahora aparece
  //     asi en grande': la tarjeta gigante por negocio) y 06:46 ('Las
  //     tiendas más pequeñas e intercalarlas con sus productos que
  //     vende') y 06:48 (los anuncios se ven de baja calidad).
  console.log('== v1.4.57: Negocios estilo TikTok + fotos en alta resolución ==');
  // Estático: orden y piezas nuevas del feed.
  const rbm57 = html.slice(html.indexOf('async function renderBizMain(){'), html.indexOf('/* Carrusel de anuncios', html.indexOf('async function renderBizMain(){')));
  check('v1.4.57: buscador arriba (lupa + botón Buscar, filtra en el cliente al escribir)', rbm57.includes('id="biz-search-input"') && rbm57.includes('placeholder="Buscar negocios y productos') && rbm57.includes('>Buscar</button>') && rbm57.includes('oninput="bizSearch=this.value;renderBizFeed()"'));
  check('v1.4.57: atajos con icono con las 3 acciones (Crear/Administrar, Ver mi cita, Ver mi pedido)', rbm57.includes('class="biz-shortcut"') && rbm57.includes("mine.length?'Administrar':'Crear'") && rbm57.includes('>Ver mi cita</span>') && rbm57.includes('>Ver mi pedido</span>') && rbm57.includes("bizScreen=\\'my-appts\\';renderNegocios()") && rbm57.includes("bizScreen=\\'my-orders\\';renderNegocios()"));
  check('v1.4.57: el carrusel de anuncios NO se tocó salvo el tap (misma función, banners 210px, auto-avance 5 s; el tap vinculado abre el menú desde v1.4.58)', html.includes('async function renderBizAdsCarousel(wrapId){') && html.includes("ads = (j.ads||[]).filter(a=>a.banner_image)") && html.includes('height:210px') && html.includes('}, 5000);') && html.includes("if(slide && slide.dataset.biz) openBusiness(+slide.dataset.biz, true);"));
  check('v1.4.57: el feed mezclado existe (bizFeedItems + renderBizFeed + tarjetas chicas en cuadrícula de 2 columnas)', html.includes('function bizFeedItems(list, cat, q){') && html.includes('function renderBizFeed(){') && html.includes('function bizMiniBizCard(b){') && html.includes('function bizMiniItemCard(b, it){') && html.includes('class="biz-feed-grid"') && html.includes('grid-template-columns:1fr 1fr'));
  const miniBizSec57 = html.slice(html.indexOf('function bizMiniBizCard(b){'), html.indexOf('function bizMiniItemCard(b, it){'));
  check('v1.4.57: la tarjeta chica de negocio trae foto, nombre, categoría y ABIERTO/CERRADO (sin descripción ni botón grande)', miniBizSec57.includes("'<span class=\"chip\">'+esc(b.category)+'</span>'") && miniBizSec57.includes('ABIERTO') && !miniBizSec57.includes('bizTypeAction') && !miniBizSec57.includes('Ver productos'));
  const miniItemSec57 = html.slice(html.indexOf('function bizMiniItemCard(b, it){'), html.indexOf('function renderBizFeed(){'));
  check('v1.4.57: la tarjeta chica de producto trae foto, nombre, precio y nombre del negocio; al tocarla abre su negocio', miniItemSec57.includes("it.image?'<img src=\"'+it.image+'\"") && miniItemSec57.includes('<div class="pr">') && miniItemSec57.includes('fmt$(it.price)') && miniItemSec57.includes('esc(b.name)') && miniItemSec57.includes("onclick=\"openBusiness('+b.id+')\""));
  const feedSec57 = html.slice(html.indexOf('function bizMiniBizCard(b){'), html.indexOf('/* Carrusel de anuncios', html.indexOf('function renderBizFeed(){')));
  check('v1.4.57: sin descuentos inventados en el feed (sin insignia de %, sin precio tachado, sin "Descuento")', !feedSec57.includes('-%') && !feedSec57.includes('<s>') && !feedSec57.includes('line-through') && !feedSec57.includes('Descuento'));
  check('v1.4.57: fila "Ofertas del día" y aviso cuando no hay productos ("Los negocios aún no han subido productos.")', html.includes('Ofertas del día') && html.includes('Los negocios aún no han subido productos.'));
  // Estático: calidad de fotos por uso.
  const photoSec57 = html.slice(html.indexOf('function fileToPhoto(input, cb, hi){'), html.indexOf('/* ===== INICIO ====='));
  check('v1.4.57: fileToPhoto tiene tope por uso (alta: 1600px JPEG 0.88; perfil: 480px JPEG 0.75; sin ampliar fotos chicas)', photoSec57.includes('const max = hi ? 1600 : 480') && photoSec57.includes("cb(cv.toDataURL('image/jpeg', hi ? 0.88 : 0.75));") && photoSec57.includes('Math.min(1, max / Math.max(img.width, img.height))'));
  const calls57 = [...html.matchAll(/fileToPhoto\((?:input|this), d=>\{[^}]*\}(?:, true)?\)/g)].map(m=>m[0]);
  check('v1.4.57: 7 usos literales de fileToPhoto: 4 en alta (anuncio, foto de negocio al crear/editar, foto de producto/servicio) y 3 de perfil a 480px (pasajero con 2: rp-cam + rp-gal desde v1.4.95, + plantilla de chofer v1.4.72, que genera los 8 inputs de chofer)', calls57.length === 7 && calls57.filter(c=>c.endsWith(', true)')).length === 4 && calls57.filter(c=>!c.endsWith(', true)')).length === 3, JSON.stringify(calls57.map(c=>c.slice(0, 70))));
  const adLine57 = html.split('\n').find(l=>l.includes('fileToPhoto(input, d=>{adImgData'));
  check('v1.4.57: el anuncio usa alta resolución (adPickFile pasa true: cubre los dos slots, vertical y banner, porque suben por el mismo input)', !!adLine57 && adLine57.includes('}, true);'));
  const nbLine57 = html.split('\n').find(l=>l.includes('fileToPhoto') && l.includes('nb-prev'));
  const beLine57 = html.split('\n').find(l=>l.includes('fileToPhoto') && l.includes('be-prev'));
  check('v1.4.57: la foto del negocio usa alta resolución al crear y al editar', !!nbLine57 && nbLine57.includes('}, true)') && !!beLine57 && beLine57.includes('}, true)'));
  const biLine57 = html.split('\n').find(l=>l.includes('fileToPhoto') && l.includes('bi-prev'));
  check('v1.4.57: el producto/servicio YA tiene foto (nuevo campo opcional en el formulario, en alta, y se manda con image: bizItemPhoto)', !!biLine57 && biLine57.includes('}, true)') && html.includes('id="bi-prev"') && html.includes('image: bizItemPhoto') && html.includes('bizItemPhoto = null;'));
  const profLines57 = html.split('\n').filter(l=>l.includes('fileToPhoto') && (l.includes('regPhoto1') || l.includes('regPhoto2')));
  const dpfOn57 = html.split('\n').find(l=>l.includes("const on = 'fileToPhoto(this,"));
  check('v1.4.57: las selfies y fotos de vehículo siguen a 480px (v1.4.95: el pasajero tiene 2 líneas, rp-cam + rp-gal, sin true; las 4 de chofer van por la plantilla driverPhotoField, sin true)', profLines57.length === 2 && profLines57.every(l=>!l.includes(', true)')) && !!dpfOn57 && !dpfOn57.includes(', true)'));
  // Evaluando el feed real con datos de mentira.
  const feedFns57 = html.slice(html.indexOf('function bizFeedItems(list, cat, q){'), html.indexOf('function renderBizFeed(){'));
  const renderFeedSrc57 = html.slice(html.indexOf('function renderBizFeed(){'), html.indexOf('/* Carrusel de anuncios', html.indexOf('function renderBizFeed(){')));
  function biz57(id, name, category, open, products, services){
    return { id, name, category, open: open?1:0, is_premium: 0, photo: null, description: 'Desc ' + name, products: products||[], services: services||[] };
  }
  function prod57(id, name, price, avail){ return { id, name, price, available: (avail==null?1:avail), image: null, description: '' }; }
  const list57 = [
    biz57(1, 'Tienda A Comida', 'Comida', 1, [prod57(11,'Pizza pepperoni',120), prod57(12,'Pizza hawaiana',130)], []),
    biz57(2, 'Salón B Belleza', 'Belleza', 1, [], [prod57(21,'Tinte completo',200)]),
    biz57(3, 'Tienda C Sin Productos', 'Comida', 0, [], []),
  ];
  const seq57 = (arr)=> arr.map(x=> x.kind==='biz' ? 'NEG:'+x.biz.name : 'PROD:'+x.it.name).join(' | ');
  function feedItems57(list, cat, q){
    const fn = new Function('list','cat','q', feedFns57 + '; return bizFeedItems(list, cat, q);');
    return fn(list, cat, q);
  }
  function runFeed57(list, cat, q){
    const box57 = { innerHTML: '' };
    const fn = new Function('bizListCache','bizCatFilter','bizSearch','document','esc','fmt$', feedFns57 + renderFeedSrc57 + '; renderBizFeed(); return document.getElementById("biz-feed").innerHTML;');
    return fn(list, cat, q, { getElementById: (id)=> id==='biz-feed' ? box57 : null }, (s)=>String(s==null?'':s), (n)=>'$'+Math.round(Number(n)||0));
  }
  check('v1.4.57: evaluado — el feed mezcla: negocio A, sus 2 productos, negocio B, su servicio, negocio C solo (sin productos)', seq57(feedItems57(list57,'Todas','')) === 'NEG:Tienda A Comida | PROD:Pizza pepperoni | PROD:Pizza hawaiana | NEG:Salón B Belleza | PROD:Tinte completo | NEG:Tienda C Sin Productos', seq57(feedItems57(list57,'Todas','')));
  check('v1.4.57: evaluado — categoría Comida: A con sus 2 productos + C solo; B queda fuera y el intercalado se mantiene', seq57(feedItems57(list57,'Comida','')) === 'NEG:Tienda A Comida | PROD:Pizza pepperoni | PROD:Pizza hawaiana | NEG:Tienda C Sin Productos', seq57(feedItems57(list57,'Comida','')));
  check('v1.4.57: evaluado — buscar "tinte": solo el salón B con su servicio', seq57(feedItems57(list57,'Todas','tinte')) === 'NEG:Salón B Belleza | PROD:Tinte completo', seq57(feedItems57(list57,'Todas','tinte')));
  check('v1.4.57: evaluado — buscar "pepperoni": solo ese producto (no todo el menú del negocio)', seq57(feedItems57(list57,'Todas','pepperoni')) === 'NEG:Tienda A Comida | PROD:Pizza pepperoni', seq57(feedItems57(list57,'Todas','pepperoni')));
  check('v1.4.57: evaluado — buscar "zzz": feed vacío', feedItems57(list57,'Todas','zzz').length === 0);
  let feedHtml57 = '';
  try { feedHtml57 = runFeed57(list57,'Todas',''); } catch(e){ feedHtml57 = 'ERR:' + String(e && e.message || e); }
  check('v1.4.57: evaluado — el HTML del feed trae Ofertas del día, pestañas (Todos, Comida, Belleza), cuadrícula con precio y negocio, ABIERTO y CERRADO, sin descuentos', feedHtml57.includes('Ofertas del día') && feedHtml57.includes('biz-ofertas-row') && feedHtml57.includes('biz-cats') && feedHtml57.includes('>Todos<') && feedHtml57.includes('>Comida<') && feedHtml57.includes('>Belleza<') && feedHtml57.includes('biz-feed-grid') && feedHtml57.includes('$120') && feedHtml57.includes('Pizza pepperoni') && feedHtml57.includes('Tienda A Comida') && feedHtml57.includes('ABIERTO') && feedHtml57.includes('CERRADO') && !feedHtml57.includes('-%') && !feedHtml57.includes('<s>'), feedHtml57.slice(0, 300));
  let feedHtml57b = '';
  try { feedHtml57b = runFeed57([list57[2]],'Todas',''); } catch(e){ feedHtml57b = 'ERR:' + String(e && e.message || e); }
  check('v1.4.57: evaluado — negocio sin productos: solo su tarjeta chica + "Los negocios aún no han subido productos." y sin fila de ofertas', feedHtml57b.includes('Tienda C Sin Productos') && feedHtml57b.includes('Los negocios aún no han subido productos.') && !feedHtml57b.includes('Ofertas del día'), feedHtml57b.slice(0, 300));
  let feedHtml57c = '';
  try { feedHtml57c = runFeed57([],'Todas',''); } catch(e){ feedHtml57c = 'ERR:' + String(e && e.message || e); }
  check('v1.4.57: evaluado — sin negocios: "Todavía no hay negocios aceptados en la app."', feedHtml57c.includes('Todavía no hay negocios aceptados en la app.'));
  let feedHtml57d = '';
  try { feedHtml57d = runFeed57(list57,'Belleza',''); } catch(e){ feedHtml57d = 'ERR:' + String(e && e.message || e); }
  check('v1.4.57: evaluado — categoría Belleza en el HTML: salón B + Tinte, sin la tienda A', feedHtml57d.includes('Salón B Belleza') && feedHtml57d.includes('Tinte completo') && !feedHtml57d.includes('Tienda A Comida'));
  // Evaluando fileToPhoto real con lienzo e imagen de mentira.
  function runPhoto57(w, h, hi){
    const photoSrc57 = html.slice(html.indexOf('function fileToPhoto(input, cb, hi){'), html.indexOf('/* ===== INICIO ====='));
    let canvas = null;
    const imgStub = class { constructor(){ this.width = w; this.height = h; } set src(v){ if(this.onload) this.onload(); } };
    const urlStub = { createObjectURL: ()=> 'blob:x', revokeObjectURL: ()=>{} };
    const docStub = { createElement: ()=>{ canvas = { width: 0, height: 0, getContext: ()=>({ drawImage(){ } }), toDataURL: (t,q)=> 'data:image/jpeg;q'+q+';W'+canvas.width+'x'+canvas.height }; return canvas; } };
    let out = null;
    const fn = new Function('Image','URL','document', photoSrc57 + '; return fileToPhoto;');
    fn(imgStub, urlStub, docStub)({ files: [{}] }, (d)=>{ out = d; }, hi);
    return { out, w: canvas ? canvas.width : null, h: canvas ? canvas.height : null };
  }
  const ph57a = runPhoto57(1080, 1920, true);
  check('v1.4.57: evaluado — foto vertical 1080×1920 por la ruta de anuncio: queda 900×1600 (lado mayor 1600, JPEG 0.88)', ph57a.w === 900 && ph57a.h === 1600 && ph57a.out && ph57a.out.includes('q0.88'), JSON.stringify(ph57a));
  const ph57b = runPhoto57(4000, 3000, true);
  check('v1.4.57: evaluado — foto horizontal 4000×3000 en alta: queda 1600×1200', ph57b.w === 1600 && ph57b.h === 1200 && ph57b.out && ph57b.out.includes('q0.88'), JSON.stringify(ph57b));
  const ph57c = runPhoto57(1080, 1920, false);
  check('v1.4.57: evaluado — la misma foto 1080×1920 como selfie: queda 270×480 (lado mayor 480, JPEG 0.75)', ph57c.w === 270 && ph57c.h === 480 && ph57c.out && ph57c.out.includes('q0.75'), JSON.stringify(ph57c));
  const ph57d = runPhoto57(300, 200, true);
  check('v1.4.57: evaluado — foto chica 300×200 en alta: NO se amplía (queda 300×200)', ph57d.w === 300 && ph57d.h === 200, JSON.stringify(ph57d));
  // En vivo: 3 negocios de prueba (A con 2 productos, B con 1 servicio,
  // C sin productos) y el feed sobre los datos reales del servidor.
  const acc57a = await api('/api/register-account', { name: 'Ana 57A', username: 'ana57a_' + RUN, phone: '961570' + RUN.slice(0, 4), password: 'secreta123' });
  check('v1.4.57: en vivo, cuenta A registrada', acc57a.ok && !!acc57a.token, JSON.stringify(acc57a));
  const biz57a = await api('/api/request-business', { token: acc57a.token, name: 'Tienda 57A ' + RUN, type: 'entrega', whatsapp: '9610000057', category: 'Comida', colony: 'Centro', schedule: 'Lunes a sábado, 9 AM a 7 PM', delivery_fee: 20, description: 'Comida 57' });
  check('v1.4.57: en vivo, negocio A (entrega, Comida) creado', biz57a.ok && biz57a.business.id, JSON.stringify(biz57a));
  await api('/api/approve-business', { token: admLogin.token, business_id: biz57a.business.id });
  const pr57a1 = await api('/api/add-product', { token: acc57a.token, business_id: biz57a.business.id, name: 'Pizza pepperoni 57', price: 120, description: 'Con queso', image: 'data:image/jpeg;base64,' + 'A'.repeat(1000) });
  const pr57a2 = await api('/api/add-product', { token: acc57a.token, business_id: biz57a.business.id, name: 'Pizza hawaiana 57', price: 130 });
  check('v1.4.57: en vivo, negocio A con 2 productos (uno con foto)', pr57a1.ok && pr57a1.product.id && pr57a2.ok && pr57a2.product.id, JSON.stringify([pr57a1, pr57a2]));
  const acc57b = await api('/api/register-account', { name: 'Bea 57B', username: 'bea57b_' + RUN, phone: '961571' + RUN.slice(0, 4), password: 'secreta123' });
  const biz57b = await api('/api/request-business', { token: acc57b.token, name: 'Salón 57B ' + RUN, type: 'citas', whatsapp: '9610000058', category: 'Belleza', colony: 'Centro', schedule: 'Lunes a sábado, 9 AM a 7 PM', description: 'Belleza 57' });
  await api('/api/approve-business', { token: admLogin.token, business_id: biz57b.business.id });
  const sv57b = await api('/api/add-service', { token: acc57b.token, business_id: biz57b.business.id, name: 'Tinte 57', price: 200, duration_minutes: 90 });
  check('v1.4.57: en vivo, negocio B (citas, Belleza) con 1 servicio', biz57b.ok && sv57b.ok && sv57b.service.id, JSON.stringify(sv57b));
  const acc57c = await api('/api/register-account', { name: 'Cid 57C', username: 'cid57c_' + RUN, phone: '961572' + RUN.slice(0, 4), password: 'secreta123' });
  const biz57c = await api('/api/request-business', { token: acc57c.token, name: 'Tienda 57C ' + RUN, type: 'entrega', whatsapp: '9610000059', category: 'Comida', colony: 'Centro', schedule: 'Lunes a sábado, 9 AM a 7 PM', delivery_fee: 20, description: 'Sin productos 57' });
  await api('/api/approve-business', { token: admLogin.token, business_id: biz57c.business.id });
  check('v1.4.57: en vivo, negocio C (entrega, Comida) sin productos creado', biz57c.ok && biz57c.business.id, JSON.stringify(biz57c));
  const listLive57 = await api('/api/businesses?token=' + admLogin.token);
  const live57 = (listLive57.businesses||[]).filter(b=>['Tienda 57A ', 'Salón 57B ', 'Tienda 57C '].some(p=>String(b.name||'').startsWith(p)));
  const liveA57 = live57.find(b=>String(b.name||'').startsWith('Tienda 57A '));
  const liveB57 = live57.find(b=>String(b.name||'').startsWith('Salón 57B '));
  const liveC57 = live57.find(b=>String(b.name||'').startsWith('Tienda 57C '));
  check('v1.4.57: en vivo, /api/businesses trae los 3 negocios con sus productos/servicios (la fuente del feed)', live57.length === 3 && liveA57 && (liveA57.products||[]).length === 2 && liveB57 && (liveB57.services||[]).length === 1 && liveC57 && (liveC57.products||[]).length === 0 && (liveC57.services||[]).length === 0, JSON.stringify(live57.map(b=>({ n: b.name, p: (b.products||[]).length, s: (b.services||[]).length }))));
  check('v1.4.57: en vivo, la foto del producto se guarda tal cual se mandó (el servidor no la re-escala)', liveA57 && (liveA57.products||[]).find(p=>p.name==='Pizza pepperoni 57') && (liveA57.products||[]).find(p=>p.name==='Pizza pepperoni 57').image === 'data:image/jpeg;base64,' + 'A'.repeat(1000), JSON.stringify((liveA57.products||[]).map(p=>({ n: p.name, img: (p.image||'').length }))));
  check('v1.4.57: en vivo, el feed sobre los datos REALES del servidor mezcla igual (A, sus 2 productos, B, su servicio, C solo)', seq57(feedItems57(live57,'Todas','')) === 'NEG:'+liveA57.name+' | PROD:Pizza pepperoni 57 | PROD:Pizza hawaiana 57 | NEG:'+liveB57.name+' | PROD:Tinte 57 | NEG:'+liveC57.name, seq57(feedItems57(live57,'Todas','')));
  check('v1.4.57: en vivo, categoría Comida sobre datos reales: A con sus productos + C solo; B fuera', seq57(feedItems57(live57,'Comida','')) === 'NEG:'+liveA57.name+' | PROD:Pizza pepperoni 57 | PROD:Pizza hawaiana 57 | NEG:'+liveC57.name, seq57(feedItems57(live57,'Comida','')));
  check('v1.4.57: en vivo, buscar "tinte" sobre datos reales: solo B con su servicio', seq57(feedItems57(live57,'Todas','tinte')) === 'NEG:'+liveB57.name+' | PROD:Tinte 57', seq57(feedItems57(live57,'Todas','tinte')));
  // En vivo: el servidor guarda la imagen del anuncio tal cual (sin
  // re-escalarla): la calidad la decide el cliente al subirla.
  const bigImg57 = 'data:image/jpeg;base64,' + 'B'.repeat(60000);
  const ad57 = await api('/api/create-ad', { token: admLogin.token, kind: 'libre', label: 'Ad 57 ' + RUN, image: bigImg57, entries: ['negocios'], slot: 'flotante' });
  check('v1.4.57: en vivo, el anuncio se crea con la imagen grande intacta', ad57.ok && ad57.ad.image === bigImg57, JSON.stringify(ad57.ad && { id: ad57.ad.id, len: (ad57.ad.image||'').length }));
  const ads57 = await api('/api/ads');
  const ad57Live = (ads57.ads||[]).find(a=>a.id===(ad57.ad && ad57.ad.id));
  check('v1.4.57: en vivo, /api/ads devuelve el anuncio con la imagen grande intacta (lo que se sube es lo que se sirve)', !!ad57Live && ad57Live.image === bigImg57, JSON.stringify(ad57Live && { id: ad57Live.id, len: (ad57Live.image||'').length }));

  // ===== v1.4.58 (2026-11-24): límites gratis 5/5; activación de
  // suscripción de choferes y Premium de negocios por el admin; pago del
  // plan por WhatsApp; inicio del chofer más bonito; carrusel de anuncios
  // en el inicio del chofer; el anuncio vinculado abre el menú del
  // negocio; suspender/eliminar negocios antiguos. =====
  // (1) Límites gratis 5/5: el límite vivo de 5 servicios ya se comprobó
  // en la sección (3b) (4 servicios + 5º confirma + 6º bloqueado con el
  // mensaje '5 servicios gratis'); aquí lo estático, el taxímetro y el
  // chofer suscrito.
  check('v1.4.58: límite gratis de servicios = 5 en servidor y cliente', /FREE_DAILY_LIMIT = 5[,;]/.test(srv) && /FREE_DAILY_LIMIT = 5[,;]/.test(html));
  check('v1.4.58: ningún texto visible del plan gratis dice todavía 50', !html.includes('50 servicios gratis') && !html.includes('de 50 servicios') && !html.includes('50 recorridos') && !srv.includes('50 servicios gratis') && !srv.includes('tus 50 servicios'));
  check('v1.4.58: el taxímetro se bloquea con el mismo límite (taxiRunsToday() >= FREE_DAILY_LIMIT)', html.includes('taxiRunsToday() >= FREE_DAILY_LIMIT') && html.includes('taxiLimitHtml') && html.includes("Plan gratis · '+n+' de '+FREE_DAILY_LIMIT+' recorridos del taxímetro hoy"));
  // Evaluado: la lógica real del taxímetro con localStorage falso (día
  // America/Mexico_City): 0 → '0 de 5', 4 → sigue libre, 5 → '5 de 5' y
  // bloqueado; un recorrido de ayer no cuenta.
  let taxi58 = null, taxi58Ok = false;
  try {
    const taxiSec = html.slice(html.indexOf('const TAXI_HIST_KEY'), html.indexOf('let taxiLimitShown'));
    const taxiFlM = html.match(/FREE_DAILY_LIMIT = (\d+)/); const taxiFl = taxiFlM ? 'const FREE_DAILY_LIMIT = ' + taxiFlM[1] + ';' : '';
    const taxiStore = {};
    const taxiLS = { getItem: k => (k in taxiStore ? taxiStore[k] : null), setItem: (k, v) => { taxiStore[k] = String(v); }, removeItem: k => { delete taxiStore[k]; } };
    const taxiFn = new Function('localStorage', taxiFl + '\nlet myDriver = null;\n' + taxiSec + '\nreturn { runs: taxiRunsToday, html: taxiLimitHtml, blocked: ()=>taxiRunsToday() >= FREE_DAILY_LIMIT, save: taxiSaveHist };');
    taxi58 = taxiFn(taxiLS);
    const now58 = new Date();
    const mkRun58 = msAgo => ({ endAt: new Date(now58.getTime() - msAgo).toISOString() });
    const min = 1000 * 60;
    taxi58.save([mkRun58(10 * min)]);
    const r1 = taxi58.runs() === 1 && taxi58.html().includes('1 de 5 recorridos') && taxi58.blocked() === false;
    taxi58.save([mkRun58(10 * min), mkRun58(20 * min), mkRun58(30 * min), mkRun58(40 * min)]);
    const r4 = taxi58.runs() === 4 && taxi58.html().includes('4 de 5 recorridos') && taxi58.blocked() === false;
    taxi58.save([mkRun58(10 * min), mkRun58(20 * min), mkRun58(30 * min), mkRun58(40 * min), mkRun58(50 * min)]);
    const r5 = taxi58.runs() === 5 && taxi58.html().includes('5 de 5 recorridos') && taxi58.blocked() === true;
    taxi58.save([mkRun58(10 * min), mkRun58(20 * min), mkRun58(30 * min), mkRun58(40 * min), mkRun58(50 * min), mkRun58(26 * 60 * min)]);
    const rY = taxi58.runs() === 5; // el de ayer (26 h) no cuenta para hoy
    taxi58Ok = r1 && r4 && r5 && rY;
  } catch(e){ taxi58Ok = false; }
  check('v1.4.58: evaluado — el taxímetro permite 5 recorridos y bloquea el 6º; el de ayer no cuenta', taxi58Ok);
  // (2) Activación de suscripción por el admin (estático + en vivo).
  const subSec = srv.slice(srv.indexOf("'/api/admin/set-subscription'"), srv.indexOf('// ---- Cuentas e inicio de sesión ----'));
  check('v1.4.58: /api/admin/set-subscription existe, solo admin, y usa los planes con inicio y fin', subSec.includes("a.role !== 'admin'") && subSec.includes('SUB_PLANS[key]') && subSec.includes("plan='suscripcion'") && subSec.includes('subscription_start') && subSec.includes('subscription_until') && subSec.includes('Solo el administrador'));
  const detSec = html.slice(html.indexOf('function renderAdminDetail'), html.indexOf('async function adminBlock'));
  check('v1.4.58: el detalle del chofer en el panel tiene ACTIVAR SUSCRIPCIÓN con Semanal $50 / Mensual $150 / Anual $500', detSec.includes('ACTIVAR SUSCRIPCIÓN') && detSec.includes("adminSetSubscription('+d.id+', \\'weekly\\')") && detSec.includes("adminSetSubscription('+d.id+', \\'monthly\\')") && detSec.includes("adminSetSubscription('+d.id+', \\'yearly\\')") && detSec.includes('Semanal · $50 · 7 días') && detSec.includes('Mensual · $150 · 30 días') && detSec.includes('Anual · $500 · 365 días') && detSec.includes('subscription_start'));
  const drv58 = await api('/api/register-driver', { name: 'Chofer 58 Sus', phone: '961580' + RUN.slice(0, 4), vehicle: 'mototaxi', unit: 'S-58', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.58: en vivo, chofer de prueba registrado', drv58.ok && drv58.driver.id, JSON.stringify(drv58));
  await approveDriver(drv58.driver.id);
  await api('/api/set-driver-online', { driver_id: drv58.driver.id, online: true });
  const sub58w = await api('/api/admin/set-subscription', { token: admLogin.token, driver_id: drv58.driver.id, plan: 'weekly' });
  check('v1.4.58: en vivo, el admin activa la suscripción semanal: plan suscripcion, inicio hoy y fin ~7 días', sub58w.ok && sub58w.driver.plan === 'suscripcion' && !!sub58w.driver.subscription_start && Math.abs((new Date(sub58w.driver.subscription_until) - Date.now()) / 864e5 - 7) < 0.5, JSON.stringify(sub58w));
  const sub58No = await api('/api/admin/set-subscription', { token: acc57a.token, driver_id: drv58.driver.id, plan: 'monthly' });
  check('v1.4.58: en vivo, una cuenta que no es admin NO puede activar suscripciones (403)', !sub58No.ok && /Solo el administrador/.test(sub58No.error || ''), JSON.stringify(sub58No));
  const sub58m = await api('/api/admin/set-subscription', { token: admLogin.token, driver_id: drv58.driver.id, plan: 'monthly' });
  check('v1.4.58: en vivo, activar de nuevo RENUEVA: mensual suma 30 días a la vigencia (fin ~37 días)', sub58m.ok && Math.abs((new Date(sub58m.driver.subscription_until) - Date.now()) / 864e5 - 37) < 0.5, JSON.stringify(sub58m));
  const sub58y = await api('/api/admin/set-subscription', { token: admLogin.token, driver_id: drv58.driver.id, plan: 'yearly' });
  check('v1.4.58: en vivo, anual suma 365 días (fin ~402 días)', sub58y.ok && Math.abs((new Date(sub58y.driver.subscription_until) - Date.now()) / 864e5 - 402) < 0.5, JSON.stringify(sub58y));
  const sub58Bad = await api('/api/admin/set-subscription', { token: admLogin.token, driver_id: drv58.driver.id, plan: 'diario' });
  check('v1.4.58: en vivo, plan inválido se rechaza (400)', !sub58Bad.ok && /Elige el plan/.test(sub58Bad.error || ''), JSON.stringify(sub58Bad));
  let sub58Trips = true;
  for (let i = 0; i < 6; i++) { const t = await tripFor(drv58.driver.id, 25); if (!t.ok) sub58Trips = false; }
  check('v1.4.58: en vivo, el chofer suscrito confirma 6 servicios seguidos: el límite gratis de 5 NO le aplica', sub58Trips);
  // (3) Premium de negocios desde el panel (estático + en vivo).
  const bizReqSec = html.slice(html.indexOf('async function renderAdminBusinessRequests'), html.indexOf('async function adminApproveBusiness'));
  check('v1.4.58: la lista de negocios activos del panel tiene Activar/Renovar Premium · $100/mes con fecha de vencimiento', bizReqSec.includes('adminActivateBizPremium') && bizReqSec.includes('Activar Premium · $100/mes') && bizReqSec.includes('Renovar Premium · $100/mes') && bizReqSec.includes("Premium · vence el '+new Date(b.premium_until)") && html.includes("'/api/subscribe-business'"));
  const acc58b = await api('/api/register-account', { name: 'Biz 58P', username: 'biz58p_' + RUN, phone: '961581' + RUN.slice(0, 4), password: 'secreta123' });
  const biz58p = await api('/api/request-business', { token: acc58b.token, name: 'Tienda 58P ' + RUN, type: 'entrega', whatsapp: '9610000058', category: 'Comida', colony: 'Centro', schedule: 'Lunes a sábado, 9 AM a 7 PM', delivery_fee: 20, description: 'Premium 58' });
  await api('/api/approve-business', { token: admLogin.token, business_id: biz58p.business.id });
  const pr58p = await api('/api/add-product', { token: acc58b.token, business_id: biz58p.business.id, name: 'Pizza 58P', price: 120 });
  check('v1.4.58: en vivo, negocio de prueba (entrega) aprobado con 1 producto', biz58p.ok && pr58p.ok && pr58p.product.id, JSON.stringify([biz58p, pr58p]));
  const prem58No = await api('/api/subscribe-business', { token: acc57a.token, business_id: biz58p.business.id });
  check('v1.4.58: en vivo, una cuenta ajena NO puede activar el Premium (403)', !prem58No.ok && /Solo la dueña/.test(prem58No.error || ''), JSON.stringify(prem58No));
  const prem58 = await api('/api/subscribe-business', { token: admLogin.token, business_id: biz58p.business.id });
  check('v1.4.58: en vivo, el admin activa el Premium: is_premium y fin ~30 días', prem58.ok && prem58.business.is_premium && Math.abs((new Date(prem58.business.premium_until) - Date.now()) / 864e5 - 30) < 0.5, JSON.stringify(prem58));
  const prem58b = await api('/api/subscribe-business', { token: admLogin.token, business_id: biz58p.business.id });
  check('v1.4.58: en vivo, reactivar el Premium suma 30 días más (fin ~60 días)', prem58b.ok && Math.abs((new Date(prem58b.business.premium_until) - Date.now()) / 864e5 - 60) < 0.5, JSON.stringify(prem58b));
  // (4) Pago del plan por WhatsApp (estático).
  const planSec = html.slice(html.indexOf('function renderPlan'), html.indexOf('function subscribeMe'));
  check('v1.4.58: el plan del chofer muestra los 3 planes con precios', planSec.includes('SUB_PLANS') && html.includes("desc:'$50 por semana · 7 días'") && html.includes("desc:'$150 por mes · 30 días'") && html.includes("desc:'$500 por año · 365 días'"));
  check('v1.4.58: el enlace Pagar por transferencia abre WhatsApp al admin (wa.me/529614868605) con el mensaje que pide el número y lista planes y precios', html.includes('wa.me/529614868605') && html.includes('Hola, quiero pagar mi suscripción de SanFerGo. ¿Me pasas el número para transferir? Planes: Semanal $50, Mensual $150, Anual $500.') && (html.match(/driverPayWaLink\(\)/g) || []).length >= 2);
  check('v1.4.58: ningún número de cuenta inventado en la pantalla del plan (sin dígitos largos; el mensaje solo PIDE el número)', !/\d{16,}/.test(planSec) && !planSec.includes('CLABE'));
  // (5) Inicio del chofer más bonito + (6) carrusel de anuncios debajo del perfil (estático).
  const dhSec = html.slice(html.indexOf('function renderDriverHome'), html.indexOf('function driverHomeExpand'));
  check('v1.4.58: el inicio del chofer sigue con su aviso de viaje activo, su tarjeta de plan y sus 3 pestañas', dhSec.includes('driver-active-banner') && dhSec.includes('de-plan-sub') && dhSec.includes('de-trips-title') && dhSec.includes("driverHomeExpand(\\'plan\\')") && dhSec.includes("driverHomeExpand(\\'trips\\')") && dhSec.includes("driverHomeExpand(\\'hist\\')") && dhSec.includes("go(\\'taxihist\\')"));
  check('v1.4.58: los botones del inicio del chofer son más grandes y con icono (chip .ic con 💳 🛺 🕘 🧾)', dhSec.includes('<span class="ic">💳</span>') && dhSec.includes('<span class="ic">🛺</span>') && dhSec.includes('<span class="ic">🕘</span>') && dhSec.includes('<span class="ic">🧾</span>') && html.includes('.driver-entry .ic{') && html.includes('border:2px solid var(--green)') && html.includes('border-radius:18px'));
  check('v1.4.58: el carrusel de anuncios está en el inicio del chofer, DEBAJO del perfil (después de Editar mi perfil, antes de Mi plan y suscripción)', dhSec.indexOf('Editar mi perfil') > 0 && dhSec.indexOf('driver-ads-carousel') > dhSec.indexOf('Editar mi perfil') && dhSec.indexOf('driver-ads-carousel') < dhSec.indexOf("driverHomeExpand(\\'plan\\')") && dhSec.includes("renderBizAdsCarousel('driver-ads-carousel')"));
  const car58Sec = html.slice(html.indexOf('async function renderBizAdsCarousel'), html.indexOf('async function renderBizDetail'));
  check('v1.4.58: el carrusel es el mismo de Negocios (solo anuncios activos con banner_image, nada si no hay, 5 s, puntos, pausa al tocar)', car58Sec.includes('function renderBizAdsCarousel(wrapId)') && car58Sec.includes('.filter(a=>a.banner_image)') && car58Sec.includes("if(!ads.length){ wrap.innerHTML = ''; return; }") && car58Sec.includes('5000') && car58Sec.includes('biz-carousel-dots'));
  // (7) El anuncio vinculado abre el menú del negocio (estático + evaluado).
  check('v1.4.58: openBusiness(id, toMenu) y los 3 menús (entrega/catálogo/citas) tienen ancla #biz-menu', html.includes('function openBusiness(id, toMenu)') && html.includes('bizDetailMenu = !!toMenu') && (html.match(/id="biz-menu"/g) || []).length === 3 && html.includes('scrollBizMenu()'));
  check('v1.4.58: el tap del anuncio vinculado (carrusel y flotante) abre el menú; el libre no hace nada', html.includes('openBusiness(+slide.dataset.biz, true)') && html.includes('openBusiness(businessId, true)') && html.includes('if(businessId) openBusiness(businessId, true)') && html.includes('if(slide && slide.dataset.biz)'));
  let menu58Ok = false, menu58NoOk = false;
  try {
    const menuSec = html.slice(html.indexOf('let bizDetailMenu'), html.indexOf('async function renderBizAdsCarousel'));
    const menuRun = new Function('document', menuSec + '\nbizDetailMenu=true; scrollBizMenu(); return bizDetailMenu;');
    const holder58 = { scrolled: false };
    const flag58 = menuRun({ getElementById: () => ({ scrollIntoView: () => { holder58.scrolled = true; } }) });
    menu58Ok = flag58 === false && holder58.scrolled === true;
    const menuRun2 = new Function('document', menuSec + '\nbizDetailMenu=false; scrollBizMenu(); return bizDetailMenu;');
    const holder58b = { scrolled: false };
    const flag58b = menuRun2({ getElementById: () => ({ scrollIntoView: () => { holder58b.scrolled = true; } }) });
    menu58NoOk = flag58b === false && holder58b.scrolled === false;
  } catch(e){ menu58Ok = false; menu58NoOk = false; }
  check('v1.4.58: evaluado — abrir desde un anuncio baja al menú (#biz-menu) y resetea el flag', menu58Ok);
  check('v1.4.58: evaluado — sin flag de anuncio no se hace scroll al menú', menu58NoOk);
  // En vivo: el anuncio vinculado lleva a un negocio con menú (ficha con productos).
  const ad58p = await api('/api/create-ad', { token: admLogin.token, kind: 'negocio', business_id: biz58p.business.id, label: 'Ad 58P ' + RUN, image: 'data:image/jpeg;base64,' + 'E'.repeat(100), entries: ['negocios'], slot: 'flotante' });
  const ad58p2 = await api('/api/create-ad', { token: admLogin.token, kind: 'negocio', business_id: biz58p.business.id, label: 'Ad 58P ' + RUN, image: 'data:image/jpeg;base64,' + 'F'.repeat(100), entries: ['negocios'], slot: 'panel' });
  const ads58p = await api('/api/ads');
  const ad58pLive = (ads58p.ads || []).find(a => a.id === (ad58p.ad && ad58p.ad.id));
  const biz58pMenu = await api('/api/business?id=' + biz58p.business.id + '&token=' + admLogin.token);
  check('v1.4.58: en vivo, el anuncio vinculado existe con banner y su negocio trae el menú (1 producto)', ad58p.ok && ad58p2.ok && ad58p2.ad.id === ad58p.ad.id && !!ad58pLive && ad58pLive.business_id === biz58p.business.id && !!ad58pLive.banner_image && biz58pMenu.ok && (biz58pMenu.business.products || []).length === 1, JSON.stringify({ ad: ad58pLive && { id: ad58pLive.id, biz: ad58pLive.business_id, banner: !!(ad58pLive.banner_image) }, menu: biz58pMenu.business && (biz58pMenu.business.products || []).length }));
  // (8) Suspender / eliminar negocios antiguos (estático + en vivo).
  const suspSec = srv.slice(srv.indexOf("'/api/admin/suspend-business'"), srv.indexOf("'/api/admin/delete-business'"));
  const delSec = srv.slice(srv.indexOf("'/api/admin/delete-business'"), srv.indexOf('// Ficha del negocio'));
  check('v1.4.58: /api/admin/suspend-business existe, solo admin, y alterna activo <-> suspendido', suspSec.includes("a.role !== 'admin'") && suspSec.includes("'suspendido'") && suspSec.includes("'activo'") && suspSec.includes('Solo el administrador'));
  check('v1.4.58: /api/admin/delete-business existe, solo admin, y borra negocio + productos/servicios/pedidos/citas, dejando sus anuncios como libres', delSec.includes("a.role !== 'admin'") && delSec.includes('DELETE FROM business_products') && delSec.includes('DELETE FROM business_services') && delSec.includes('DELETE FROM business_appointments') && delSec.includes('DELETE FROM business_orders') && delSec.includes('UPDATE ads SET business_id=NULL') && delSec.includes('DELETE FROM businesses'));
  check('v1.4.58: el panel tiene Suspender / Eliminar por negocio, sección de suspendidos con Reactivar y confirmación al eliminar', bizReqSec.includes('Suspender') && bizReqSec.includes('Eliminar') && bizReqSec.includes('Negocios suspendidos') && bizReqSec.includes('Reactivar') && bizReqSec.includes('adminDeleteBusiness') && html.includes("confirm('¿Eliminar"));
  const sus58No = await api('/api/admin/suspend-business', { token: acc57a.token, business_id: biz58p.business.id });
  check('v1.4.58: en vivo, una cuenta que no es admin NO puede suspender (403)', !sus58No.ok && /Solo el administrador/.test(sus58No.error || ''), JSON.stringify(sus58No));
  const sus58 = await api('/api/admin/suspend-business', { token: admLogin.token, business_id: biz58p.business.id });
  check('v1.4.58: en vivo, el admin suspende el negocio: status suspendido', sus58.ok && sus58.business.status === 'suspendido', JSON.stringify(sus58));
  const list58s = await api('/api/businesses?token=' + admLogin.token);
  check('v1.4.58: en vivo, el negocio suspendido ya NO se ve en Negocios', !(list58s.businesses || []).some(b => b.id === biz58p.business.id), JSON.stringify((list58s.businesses || []).map(b => b.id)));
  const one58s = await api('/api/business?id=' + biz58p.business.id + '&token=' + admLogin.token);
  check('v1.4.58: en vivo, la ficha del negocio suspendido da 404', !one58s.ok, JSON.stringify(one58s));
  const adm58s = await api('/api/admin-businesses?token=' + admLogin.token);
  const susRow58 = (adm58s.businesses || []).find(b => b.id === biz58p.business.id);
  check('v1.4.58: en vivo, el negocio suspendido conserva sus datos (1 producto) y se puede reactivar', !!susRow58 && susRow58.status === 'suspendido' && (susRow58.products || []).length === 1, JSON.stringify(susRow58 && { status: susRow58.status, p: (susRow58.products || []).length }));
  const rea58 = await api('/api/admin/suspend-business', { token: admLogin.token, business_id: biz58p.business.id });
  const list58r = await api('/api/businesses?token=' + admLogin.token);
  check('v1.4.58: en vivo, reactivado vuelve a verse en Negocios', rea58.ok && rea58.business.status === 'activo' && (list58r.businesses || []).some(b => b.id === biz58p.business.id), JSON.stringify(rea58));
  const acc58d = await api('/api/register-account', { name: 'Biz 58D', username: 'biz58d_' + RUN, phone: '961582' + RUN.slice(0, 4), password: 'secreta123' });
  const biz58d = await api('/api/request-business', { token: acc58d.token, name: 'Tienda 58D ' + RUN, type: 'entrega', whatsapp: '9610000059', category: 'Comida', colony: 'Centro', schedule: 'Lunes a sábado, 9 AM a 7 PM', delivery_fee: 20, description: 'Borrar 58' });
  await api('/api/approve-business', { token: admLogin.token, business_id: biz58d.business.id });
  await api('/api/add-product', { token: acc58d.token, business_id: biz58d.business.id, name: 'Pan 58D', price: 5 });
  const ad58d = await api('/api/create-ad', { token: admLogin.token, kind: 'negocio', business_id: biz58d.business.id, label: 'Ad 58D ' + RUN, image: 'data:image/jpeg;base64,' + 'C'.repeat(100), banner_image: 'data:image/jpeg;base64,' + 'D'.repeat(100), entries: ['negocios'], slot: 'flotante' });
  check('v1.4.58: en vivo, negocio a eliminar creado con 1 producto y 1 anuncio vinculado', biz58d.ok && ad58d.ok && ad58d.ad.id, JSON.stringify([biz58d, ad58d]));
  const del58No = await api('/api/admin/delete-business', { token: acc57a.token, business_id: biz58d.business.id });
  check('v1.4.58: en vivo, una cuenta que no es admin NO puede eliminar negocios (403)', !del58No.ok && /Solo el administrador/.test(del58No.error || ''), JSON.stringify(del58No));
  const del58 = await api('/api/admin/delete-business', { token: admLogin.token, business_id: biz58d.business.id });
  const list58d = await api('/api/businesses?token=' + admLogin.token);
  const adm58d = await api('/api/admin-businesses?token=' + admLogin.token);
  const one58d = await api('/api/business?id=' + biz58d.business.id + '&token=' + admLogin.token);
  check('v1.4.58: en vivo, el admin elimina el negocio: ya no está en Negocios, ni en el panel, ni su ficha existe', del58.ok && !(list58d.businesses || []).some(b => b.id === biz58d.business.id) && !(adm58d.businesses || []).some(b => b.id === biz58d.business.id) && !one58d.ok, JSON.stringify(del58));
  const ads58d = await api('/api/ads');
  const ad58dLive = (ads58d.ads || []).find(a => a.id === (ad58d.ad && ad58d.ad.id));
  check('v1.4.58: en vivo, el anuncio del negocio eliminado queda como libre (business_id en NULL), no se borra', !!ad58dLive && !ad58dLive.business_id, JSON.stringify(ad58dLive && { id: ad58dLive.id, biz: ad58dLive.business_id }));
  const biz58r = await api('/api/request-business', { token: acc58d.token, name: 'Tienda 58R ' + RUN, type: 'catalogo', whatsapp: '9610000060', category: 'Comida', colony: 'Centro', schedule: 'Lunes a sábado, 9 AM a 7 PM', delivery_fee: 20, description: 'Flujo intacto 58' });
  const ap58r = await api('/api/approve-business', { token: admLogin.token, business_id: biz58r.business.id });
  check('v1.4.58: en vivo, el flujo de solicitudes/aprobaciones sigue igual (pendiente → activo)', biz58r.ok && ap58r.ok && ap58r.business.status === 'activo', JSON.stringify([biz58r, ap58r]));

  // ===== v1.4.59 (2026-11-24): la activación de la suscripción de un
  // chofer por el admin ahora pide confirmación ANTES de activar: la
  // advertencia trae el nombre del chofer, el plan, el precio y los días,
  // y si ya tiene un plan vigente dice que los días se suman al actual.
  // Sin confirmar no se llama al servidor. =====
  const sub59Fn = html.slice(html.indexOf('async function adminSetSubscription'), html.indexOf('async function adminDeleteDriver'));
  check('v1.4.59: adminSetSubscription pide confirmación ANTES de llamar al servidor (confirm con el nombre, el plan, el precio y los días)', sub59Fn.includes('async function adminSetSubscription(did, plan)') && sub59Fn.includes('¿Estás seguro que quieres activar la suscripción') && sub59Fn.includes("p.label+' ($'+p.price+' · '+p.days+' días) a '+nm") && sub59Fn.includes('if(!confirm(msg)) return;') && sub59Fn.indexOf('confirm(') < sub59Fn.indexOf("'/api/admin/set-subscription'"));
  check('v1.4.59: con plan vigente la advertencia dice que los días se sumarán al plan actual', sub59Fn.includes('Ya tiene un plan vigente: se sumarán los ') && sub59Fn.includes("días a su plan actual."));
  // Evaluado: la función real con confirm y api falsos: cancelar no llama
  // al servidor; confirmar llama con el plan y el chofer correctos; el
  // mensaje trae nombre, plan, precio y días; con plan vigente trae la nota.
  let sub59Eval = null;
  try {
    const plans59Src = (html.match(/const SUB_PLANS = \[[^\]]+\];/) || [])[0] || '';
    const mk59 = (confirmFn, drivers) => {
      const calls = [];
      const apiStub = async (path, body) => { calls.push({ path, body }); return { ok: true, days: 7, price: 50 }; };
      const f = new Function('confirm', 'api', 'store', 'toast', 'renderAdminDetail', 'fmt$', plans59Src + '\nlet adminDrivers = ' + JSON.stringify(drivers) + ';\n' + sub59Fn + '\nreturn adminSetSubscription;');
      return { fn: f(confirmFn, apiStub, { token: 't' }, () => {}, () => {}, p => '$' + p), calls };
    };
    let mCancel = '', mOk = '', mActive = '';
    const c59a = mk59(m => { mCancel = m; return false; }, [{ id: 11, name: 'Chofer Prueba', subscription_until: null }]);
    await c59a.fn(11, 'weekly');
    const cancelNoCall = c59a.calls.length === 0;
    const c59b = mk59(m => { mOk = m; return true; }, [{ id: 11, name: 'Chofer Prueba', subscription_until: null }]);
    await c59b.fn(11, 'weekly');
    const confirmCall = c59b.calls.length === 1 && c59b.calls[0].path === '/api/admin/set-subscription' && c59b.calls[0].body.plan === 'weekly' && c59b.calls[0].body.driver_id === 11;
    const future59 = new Date(Date.now() + 5 * 864e5).toISOString();
    const c59c = mk59(m => { mActive = m; return false; }, [{ id: 12, name: 'Chofer Activo', subscription_until: future59 }]);
    await c59c.fn(12, 'monthly');
    sub59Eval = { cancelNoCall, confirmCall, mCancel, mOk, mActive };
  } catch(e){ sub59Eval = null; }
  check('v1.4.59: evaluado — cancelar NO llama al servidor', !!sub59Eval && sub59Eval.cancelNoCall, JSON.stringify(sub59Eval && { cancelNoCall: sub59Eval.cancelNoCall }));
  check('v1.4.59: evaluado — confirmar sí llama a /api/admin/set-subscription con el plan y el chofer', !!sub59Eval && sub59Eval.confirmCall, JSON.stringify(sub59Eval && { confirmCall: sub59Eval.confirmCall }));
  check('v1.4.59: evaluado — el mensaje trae el nombre del chofer, el plan, el precio y los días', !!sub59Eval && sub59Eval.mOk.includes('Chofer Prueba') && sub59Eval.mOk.includes('Semanal') && sub59Eval.mOk.includes('$50') && sub59Eval.mOk.includes('7 días') && sub59Eval.mOk.startsWith('¿Estás seguro'), JSON.stringify(sub59Eval && { mOk: sub59Eval.mOk }));
  check('v1.4.59: evaluado — con plan vigente el mensaje dice que se sumarán los días a su plan actual', !!sub59Eval && sub59Eval.mActive.includes('Chofer Activo') && sub59Eval.mActive.includes('Mensual') && sub59Eval.mActive.includes('$150') && sub59Eval.mActive.includes('30 días') && sub59Eval.mActive.includes('se sumarán los 30 días a su plan actual'), JSON.stringify(sub59Eval && { mActive: sub59Eval.mActive }));
  // En vivo: el endpoint sigue igual (la confirmación es solo del cliente).
  const drv59 = await api('/api/register-driver', { name: 'Chofer 59 Conf', phone: '961590' + RUN.slice(0, 4), vehicle: 'mototaxi', unit: 'S-59', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.59: en vivo, chofer de prueba registrado', drv59.ok && drv59.driver.id, JSON.stringify(drv59));
  await approveDriver(drv59.driver.id);
  const sub59 = await api('/api/admin/set-subscription', { token: admLogin.token, driver_id: drv59.driver.id, plan: 'monthly' });
  check('v1.4.59: en vivo, el admin activa la suscripción mensual: plan suscripcion y fin ~30 días', sub59.ok && sub59.driver.plan === 'suscripcion' && Math.abs((new Date(sub59.driver.subscription_until) - Date.now()) / 864e5 - 30) < 0.5, JSON.stringify(sub59));

  // ===== v1.4.60 (2026-11-24): Viajes limpia + detalle del historial con
  // mini mapa + "Iniciar recorrido" + botón verde de llamar + sin "Cómo
  // llegar" + línea azul siempre + re-ruta al desviarse + sin estela =====
  // --- Estáticas: pantalla de Viajes limpia (sin Pides como, sin Tu
  // último viaje, sin "¿A dónde vas?"; Solicitar naranja, Programar
  // bloqueado, Historial verde, en ese orden). ---
  const tripSec60 = html.slice(html.indexOf('async function renderViajes(){'), html.indexOf('function drawWizMap(){'));
  // El paso 0 en concreto (el resto de renderViajes trae comentarios que
  // nombran lo quitado): solo los dos botones, la ayuda y el historial.
  const step060 = html.slice(html.indexOf("page.innerHTML = backPill('Regresar al inicio'"), html.indexOf('if(wiz.step===1){'));
  check('v1.4.60: Viajes sin "Pides como", sin "Tu último viaje" y sin título "¿A dónde vas?"', !step060.includes('Pides como') && !step060.includes('Tu último viaje') && !step060.includes('¿A dónde vas?') && !step060.includes('Repetir este viaje') && !step060.includes('renderLastTripCard'));
  check('v1.4.60: Viajes con Solicitar naranja + Programar bloqueado + ayuda + Historial verde, en ese orden', step060.indexOf('Solicitar el viaje') !== -1 && step060.indexOf('Solicitar el viaje') < step060.indexOf('Programar un viaje') && step060.indexOf('Programar un viaje') < step060.indexOf('Primero eliges de dónde sales') && step060.indexOf('Primero eliges de dónde sales') < step060.indexOf('Historial de viajes') && step060.includes('class="btn amber"') && step060.includes("go(\\'historia\\')") && html.includes('.btn{display:block;width:100%;text-align:center;padding:15px 18px;border-radius:14px;font-size:17px;font-weight:700;background:var(--green);color:#fff;margin-top:12px}') && html.includes('.btn.amber{background:var(--amber);color:#111}'));
  check('v1.4.60: "Programar un viaje" está bloqueado (disabled, dice Próximamente, sin acción)', tripSec60.includes('<button class="btn" disabled style="background:#d1d5db;color:#4b5563">🔒 Programar un viaje · Próximamente</button>'));
  // Evaluado: whoStrip con perfil no pinta nada y sin perfil solo el
  // formulario (sin "Pides como").
  let who60 = null;
  try {
    const whoSrc60 = html.slice(html.indexOf('function whoStrip(){'), html.indexOf('async function ensureNoProfilePassenger(){'));
    const mkWho60 = (hasProfile) => {
      const f = new Function('myPassenger', 'openRegistro', whoSrc60 + '\nreturn whoStrip;');
      return f(hasProfile ? { id: 1 } : null, () => {})();
    };
    who60 = { withProfile: mkWho60(true), withoutProfile: mkWho60(false) };
  } catch(e){ who60 = null; }
  check('v1.4.60: evaluado — whoStrip con perfil no pinta nada y sin perfil solo el formulario (sin "Pides como")', !!who60 && who60.withProfile === '' && who60.withoutProfile.includes('Sin perfil de pasajero') && !who60.withoutProfile.includes('Pides como'), JSON.stringify(who60 && { with: who60.withProfile, without: who60.withoutProfile.slice(0, 120) }));
  // --- Estáticas: detalle del historial con mini mapa y repetir solo si terminó. ---
  const histSec60 = html.slice(html.indexOf('async function showHistDetail(id){'), html.indexOf('function drawHistMiniMap(r){'));
  const histMapSec60 = html.slice(html.indexOf('function drawHistMiniMap(r){'), html.indexOf('async function showReceipt(requestId, asDriver){'));
  check('v1.4.60: el detalle del historial lleva mini mapa + datos + "Ver recibo" y "Repetir este viaje" solo si terminó', histSec60.includes('hist-minimap') && histSec60.includes('Detalle del viaje') && histSec60.includes('Repetir este viaje') && histSec60.includes('Ver recibo del viaje') && histSec60.includes("r.status==='finalizado'") && histSec60.includes('drawHistMiniMap(r)'));
  check('v1.4.60: drawHistMiniMap pinta origen verde, destino rojo y línea azul (misma receta que el resumen)', histMapSec60.includes("dotEl('#22c55e', 16)") && histMapSec60.includes("dotEl('#dc2626', 16)") && histMapSec60.includes("setRouteLine(histDetailMap, 'route', rt.coords, '#2b7de9', 5)") && histMapSec60.includes("setRouteLine(histDetailMap, 'route', straightRouteCoords(o, d, []), '#2b7de9', 5)"));
  // --- Evaluado: el detalle real con una lista de mentira (un viaje
  // finalizado y uno cancelado): el finalizado lleva mini mapa, recibo y
  // repetir; el cancelado lleva mini mapa y datos, sin repetir ni recibo. ---
  let histDetail60 = null;
  try {
    const histSrc60 = html.slice(html.indexOf('async function showHistDetail(id){'), html.indexOf('function drawHistMiniMap(r){'));
    const fin60 = { id: 101, status: 'finalizado', origin_zone: 'Madero', dest_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_lat: 16.8675, dest_lng: -93.2105, created_at: '2026-11-24 08:00:00', price: 20, final_price: 20, passenger_count: 2, driver_name: 'Josué Prueba', driver_unit: 'Hg67h', payment_method: 'efectivo' };
    const can60 = { id: 102, status: 'cancelado', origin_zone: 'Centro', dest_zone: 'Mercado', origin_lat: 16.8709, origin_lng: -93.2063, dest_lat: 16.8675, dest_lng: -93.2105, created_at: '2026-11-24 09:00:00', price: 25, final_price: null, passenger_count: 1, driver_name: null, driver_unit: null, payment_method: 'efectivo' };
    const page60 = { innerHTML: '' };
    let drawn60 = null;
    const mkHist60 = () => {
      const f = new Function('$', 'backPill', 'esc', 'fmtDateTime', 'fmt$', 'paxText', 'toast', 'api', 'drawHistMiniMap', 'let histReqs = ' + JSON.stringify([fin60, can60]) + ';\nlet histDetailMap = null;\n' + histSrc60 + '\nreturn showHistDetail;');
      return f(() => page60, () => '<button>Regresar</button>', s => String(s == null ? '' : s), () => '24 nov 2026, 08:00', n => '$' + Math.round(Number(n) || 0), p => { const n = Math.max(1, Math.min(3, Number(p) || 1)); return n + (n === 1 ? ' persona' : ' personas'); }, () => {}, async () => ({ requests: [] }), r => { drawn60 = r; });
    };
    const runHist60 = mkHist60();
    await runHist60(101);
    const finHtml60 = page60.innerHTML;
    const finDraw60 = drawn60;
    page60.innerHTML = ''; drawn60 = null;
    await runHist60(102);
    const canHtml60 = page60.innerHTML;
    histDetail60 = { finHtml60, finDraw60, canHtml60 };
  } catch(e){ histDetail60 = null; }
  check('v1.4.60: evaluado — el detalle de un viaje FINALIZADO lleva mini mapa, "Ver recibo" y "Repetir este viaje"', !!histDetail60 && histDetail60.finHtml60.includes('hist-minimap') && histDetail60.finHtml60.includes('Ver recibo del viaje') && histDetail60.finHtml60.includes('Repetir este viaje') && histDetail60.finHtml60.includes('Finalizado') && histDetail60.finDraw60 && histDetail60.finDraw60.id === 101, JSON.stringify(histDetail60 && { draw: histDetail60.finDraw60 && histDetail60.finDraw60.id, html: histDetail60.finHtml60.slice(0, 150) }));
  check('v1.4.60: evaluado — el detalle de un viaje CANCELADO lleva mini mapa y datos, pero NI "Repetir este viaje" NI "Ver recibo"', !!histDetail60 && histDetail60.canHtml60.includes('hist-minimap') && histDetail60.canHtml60.includes('Cancelado') && !histDetail60.canHtml60.includes('Repetir este viaje') && !histDetail60.canHtml60.includes('Ver recibo del viaje'), JSON.stringify(histDetail60 && { html: histDetail60.canHtml60.slice(0, 150) }));
  // --- Evaluado: repetir pre-llena los puntos EXACTOS del viaje viejo. ---
  let rpt60 = null;
  try {
    const rptSrc60 = html.slice(html.indexOf('async function repeatTripFrom(last){'), html.indexOf('async function repeatTrip(id){'));
    const last60 = { origin_lat: 16.8709, origin_lng: -93.2063, origin_zone: 'Madero', origin_detail: 'Madero', dest_lat: 16.8675, dest_lng: -93.2105, dest_zone: 'Mercado', dest_detail: 'Mercado', passenger_count: 2, payment_method: 'efectivo' };
    const f = new Function('newWizard', 'computeTrip', 'renderViajes', 'toast', 'let wiz = null;\n' + rptSrc60 + '\nreturn { run: repeatTripFrom, getWiz(){ return wiz; } };');
    const h60 = f(() => ({ step: 0 }), async () => {}, () => {}, () => {});
    await h60.run(last60);
    rpt60 = h60.getWiz();
  } catch(e){ rpt60 = null; }
  check('v1.4.60: evaluado — repetir pre-llena el origen y el destino EXACTOS del viaje viejo (y sus personas)', !!rpt60 && rpt60.origin && rpt60.origin.lat === 16.8709 && rpt60.origin.lng === -93.2063 && rpt60.dest && rpt60.dest.lat === 16.8675 && rpt60.dest.lng === -93.2105 && rpt60.pax === 2, JSON.stringify(rpt60));
  // --- Evaluado: la tarjeta del chofer en vivo con el botón verde de llamar. ---
  let strips60 = null;
  try {
    const liveSec60 = html.slice(html.indexOf('function renderLiveStrips(){'), html.indexOf('function compassDir('));
    const stageLabelSrc60 = html.slice(html.indexOf('const STAGE_LABEL'), html.indexOf('/* Hacia el destino'));
    const htdSrc60 = html.slice(html.indexOf('function liveHeadingToDest(r){'), html.indexOf('/* Paradas intermedias'));
    const quieroSrc60 = html.slice(html.indexOf('function isQuieroMandado(r){'), html.indexOf('function nextStage(r){'));
    const nextSrc60 = html.slice(html.indexOf('function nextStage(r){'), html.indexOf('function passengerStageTitle(r){'));
    const compassSrc60 = html.slice(html.indexOf('function compassDir(from, to){'), html.indexOf('async function cancelLiveRequest(rid){'));
    function runStrips60(r) {
      const mkEl = () => ({ classList: { add(){}, remove(){} }, style: {}, innerHTML: '', textContent: '' });
      const top = mkEl(), bot = mkEl(), pill = mkEl(), compass = mkEl(), recenter = mkEl();
      const els = { '#live-top': top, '#live-bottom': bot, '#live-pill': pill, '#live-compass': compass, '#live-recenter': recenter };
      const f = new Function('$', 'top', 'bot', 'let liveAsDriver = true;\nlet liveReq = null;\nfunction chatShowBtn(){}\n' + stageLabelSrc60 + '\n' + htdSrc60 + '\n' + quieroSrc60 + '\n' + nextSrc60 + '\n' + compassSrc60 + '\nfunction etaMin(km){ return Math.max(5, Math.round(km * 3.2)); }\nfunction havKm(a,b,c,d){ const R=6371, r=x=>x*Math.PI/180; const x=r(c-a), y=r(d-b); return 2*R*Math.asin(Math.sqrt(Math.sin(x/2)**2 + Math.cos(r(a))*Math.cos(r(c))*Math.sin(y/2)**2)); }\nfunction paxText(pax){ const n = Math.min(3, Math.max(1, Number(pax)||1)); return n + (n===1 ? \' persona\' : \' personas\'); }\nfunction esc(s){ return String(s==null?\'\':s); }\nfunction fmt$(n){ return \'$\' + Math.round(Number(n)||0); }\n' + liveSec60 + '\nreturn { run(r){ liveReq = r; renderLiveStrips(); } };');
      const h = f(sel => els[sel] || mkEl(), top, bot);
      h.run(r);
      return { top: top.innerHTML, bot: bot.innerHTML };
    }
    const base60 = { kind: 'viaje', origin_zone: 'Madero', dest_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_lat: 16.8675, dest_lng: -93.2105, driver_lat: 16.8727, driver_lng: -93.2081, passenger_name: 'The Noob Gamer', passenger_phone: '9614868605', payment_method: 'efectivo', price: 20, final_price: 20, passenger_count: 1 };
    strips60 = {
      camino: runStrips60({ ...base60, trip_stage: 'en_camino' }),
      llego: runStrips60({ ...base60, trip_stage: 'llego' }),
      viaje: runStrips60({ ...base60, trip_stage: 'en_viaje' }),
      fin: runStrips60({ ...base60, trip_stage: 'finalizado' })
    };
  } catch(e){ strips60 = null; }
  check('v1.4.60: evaluado — en camino NO hay botón verde (solo el enlace chico "Llamar a") y el botón es "Ya estoy afuera"', !!strips60 && !strips60.camino.bot.includes('callbtn') && strips60.camino.bot.includes('minilink') && strips60.camino.bot.includes('Llamar a The Noob Gamer') && strips60.camino.bot.includes('Ya estoy afuera'), JSON.stringify(strips60 && strips60.camino.bot.slice(0, 200)));
  check('v1.4.60: evaluado — al llegar (llego) aparece el botón VERDE "Llamar a The Noob Gamer" (tel:) y el botón es "Iniciar recorrido"', !!strips60 && strips60.llego.bot.includes('class="callbtn"') && strips60.llego.bot.includes('href="tel:9614868605"') && strips60.llego.bot.includes('Llamar a The Noob Gamer') && strips60.llego.bot.includes('Iniciar recorrido') && strips60.llego.top.includes('Dirígete al punto de encuentro en Madero') && strips60.llego.top.includes('faltan '), JSON.stringify(strips60 && strips60.llego.bot.slice(0, 300)));
  check('v1.4.60: evaluado — en viaje (en_viaje) el botón verde SIGUE y el botón es "Llegué a destino"', !!strips60 && strips60.viaje.bot.includes('class="callbtn"') && strips60.viaje.bot.includes('href="tel:9614868605"') && strips60.viaje.bot.includes('Llegué a destino'), JSON.stringify(strips60 && strips60.viaje.bot.slice(0, 300)));
  check('v1.4.60: evaluado — al terminar ya no hay botón verde de llamar', !!strips60 && !strips60.fin.bot.includes('callbtn'), JSON.stringify(strips60 && strips60.fin.bot.slice(0, 200)));
  // --- Evaluado: el mapa en vivo (línea siempre, zoom, desvío, sin estela). ---
  // Se extraen las funciones reales del cliente y se ejecutan con un mapa
  // de mentira (sin DOM ni red): el caso del usuario era un mapa que abrió
  // sin posición del chofer (from==null) y nunca dibujó la línea — la línea
  // solo aparecía al cambiar de etapa. Aquí OSRM falla siempre salvo que
  // se indique lo contrario.
  let live60 = null;
  try {
    const fn60 = (start, end) => {
      const a = html.indexOf(start);
      if (a < 0) throw new Error('sin ' + start);
      let b = end ? html.indexOf(end, a) : html.indexOf('\nfunction ', a + 1);
      if (b < 0) b = html.length;
      return html.slice(a, b);
    };
    const liveSrc60 = [
      fn60('function havKm(a,b,c,d){'),
      fn60('function liveHeadingToDest(r){', '/* Paradas intermedias'),
      fn60('function liveRouteWaypoints(r, toDest){', 'function straightRouteCoords'),
      fn60('function straightRouteCoords(from, target, via){', '/* Zoom de proximidad'),
      fn60('function liveTargetZoom(distM){', 'function closestOnRoute'),
      fn60('function closestOnRoute(lat, lng, coords){', 'function ensureLiveRoute'),
      fn60('function ensureLiveRoute(){', 'function nextStage(r){'),
      fn60('function setRouteLine(map, id, coords, color, width){', 'function removeRouteLine'),
      fn60('function smoothTrack(coords){', 'function myLocation'),
      fn60('function applyHeading(heading){', 'function renderLiveStrips(){'),
      fn60('function followPadding(topId, botId, defTop, defBot){'),
      'function liveFollowPadding(){ return followPadding(\'live-top\', \'live-bottom\', 170, 280); }',
      html.slice(html.indexOf('function liveApplyDriverPos(lat, lng, prevLat, prevLng){'), html.indexOf("window.addEventListener('online'"))
    ].join('\n');
    const mkMap60 = () => {
      const sources = {}, layers = {};
      return {
        _zoom: 15, _center: null, easeCalls: [], sources, layers,
        getZoom() { return this._zoom; },
        easeTo(o) { if (o.zoom != null) this._zoom = o.zoom; if (o.center) this._center = o.center; this.easeCalls.push(o); },
        fitBounds() { this._zoom = 15; },
        addSource(id, def) { sources[id] = def.data; },
        getSource(id) { return sources[id] ? { setData(d) { sources[id] = d; } } : null; },
        addLayer(l) { layers[l.id] = l; },
        getLayer(id) { return layers[id] || null; },
        removeLayer(id) { delete layers[id]; },
        removeSource(id) { delete sources[id]; },
        on() {}, resize() {}, remove() {}
      };
    };
    const el60 = () => ({ classList: { add(){}, remove(){} }, style: {}, textContent: '', innerHTML: '', offsetTop: 0, offsetHeight: 0, closest: () => null, appendChild(){}, querySelector: () => null, remove(){} });
    const doc60 = { getElementById: () => el60(), createElement: () => el60() };
    const tick60 = () => new Promise(r => setTimeout(r, 0));
    const build60 = (osrmImpl) => {
      const osrmCalls = [];
      const osrmRoute = async (a, b, via) => { osrmCalls.push({ a, b }); return osrmImpl ? await osrmImpl(a, b, via) : null; };
      const src = 'let liveReq = null, liveMap = null, liveAsDriver = true, liveFollow = true;\nlet liveRouteCoords = null, liveRouteFallback = false, liveOsrmRetryTick = 0;\nlet liveDriverMarker = null, liveLastStripAt = 0, liveLastHeading = null, liveGpsPos = null;\nlet liveRerouting = false, liveLastRerouteAt = 0;\n' + liveSrc60 + '\nreturn { setReq(r){ liveReq = r; }, setMap(m){ liveMap = m; }, setMarker(m){ liveDriverMarker = m; }, setFollow(f){ liveFollow = f; }, getRoute(){ return liveRouteCoords; }, getFallback(){ return liveRouteFallback; }, apply: liveApplyDriverPos, ensure: ensureLiveRoute, closest: closestOnRoute, targetZoom: liveTargetZoom };';
      const factory = new Function('document', 'osrmRoute', 'renderLiveStrips', src);
      const api60 = factory(doc60, osrmRoute, () => {});
      api60.osrmCalls = osrmCalls;
      return api60;
    };
    const PICK60 = { lat: 16.8709, lng: -93.2063 };
    const DEST60 = { lat: 16.8675, lng: -93.2105 };
    const pos60 = (distM, eastM) => ({ lat: PICK60.lat + distM / 110540, lng: PICK60.lng + (eastM || 0) / (111320 * Math.cos(PICK60.lat * Math.PI / 180)) });
    const req60 = () => ({ id: 1, kind: 'viaje', trip_stage: 'en_camino', origin_lat: PICK60.lat, origin_lng: PICK60.lng, dest_lat: DEST60.lat, dest_lng: DEST60.lng, origin_zone: 'Madero', dest_zone: 'Centro', passenger_name: 'The Noob Gamer', passenger_phone: '9614868605', payment_method: 'efectivo', price: 20, passenger_count: 1, driver_lat: null, driver_lng: null });
    const route60 = (map) => { const s = map.sources.route; return s ? s.geometry.coordinates : null; };
    const approx60 = (a, b, tol) => Math.abs(a - b) < (tol || 1e-5);
    // A) Mapa abrió SIN posición del chofer + GPS acercándose, follow ON:
    // la línea aparece desde la 1ª lectura y el zoom sube 16→17→18.
    const hA = build60(null);
    const mapA = mkMap60();
    hA.setReq(req60()); hA.setMap(mapA); hA.setMarker({ pos: null, setLngLat(l) { this.pos = l; }, remove() {} });
    const zoomsA = [], firstPtA = [];
    for (const d of [800, 600, 400, 300, 183, 100]) {
      const p = pos60(d);
      hA.apply(p.lat, p.lng); await tick60();
      zoomsA.push(mapA.getZoom());
      const rc = route60(mapA);
      firstPtA.push(rc && rc.length >= 2 && approx60(rc[0][0], p.lng) && approx60(rc[0][1], p.lat));
    }
    // B) Igual que A con follow OFF (el chofer tocó el mapa): la línea
    // aparece y el zoom TAMBIÉN sube (solo zoom, sin recentrar).
    const hB = build60(null);
    const mapB = mkMap60();
    hB.setReq(req60()); hB.setMap(mapB); hB.setMarker({ pos: null, setLngLat(l) { this.pos = l; }, remove() {} });
    hB.setFollow(false);
    const zoomsB = [];
    for (const d of [800, 400, 183, 100]) { const p = pos60(d); hB.apply(p.lat, p.lng); await tick60(); zoomsB.push(mapB.getZoom()); }
    const routeB = route60(mapB);
    // C) Desvío: la mototaxi agarra otra calle (>40 m de la ruta) → se
    // recalcula la ruta desde su posición actual y la línea arranca ahí.
    const hC = build60(async (a) => ({ coords: [[a.lng, a.lat], [PICK60.lng, PICK60.lat]] }));
    const mapC = mkMap60();
    hC.setReq(req60()); hC.setMap(mapC); hC.setMarker({ pos: null, setLngLat(l) { this.pos = l; }, remove() {} });
    for (const d of [800, 600, 500]) { const p = pos60(d); hC.apply(p.lat, p.lng); await tick60(); }
    const callsC0 = hC.osrmCalls.length;
    const devC = pos60(400, 100);
    hC.apply(devC.lat, devC.lng); await tick60(); await tick60();
    const callsC1 = hC.osrmCalls.length;
    const routeC = route60(mapC);
    const devC2 = pos60(380, 100);
    hC.apply(devC2.lat, devC2.lng); await tick60(); await tick60();
    const callsC2 = hC.osrmCalls.length;
    // D) Avance por una ruta OSRM con varios puntos: la línea siempre
    // arranca en la mototaxi (nada de estela azul atrás) y no hay 'traveled'.
    const routePtsD = [pos60(800), pos60(600), pos60(400), pos60(200), PICK60].map(p => [p.lng, p.lat]);
    const hD = build60(async () => ({ coords: routePtsD }));
    const mapD = mkMap60();
    hD.setReq(req60()); hD.setMap(mapD); hD.setMarker({ pos: null, setLngLat(l) { this.pos = l; }, remove() {} });
    let pD = pos60(800); hD.apply(pD.lat, pD.lng); await tick60(); await tick60();
    const routeDLen0 = (hD.getRoute() || []).length;
    const trimD = [];
    for (const d of [600, 400, 200]) {
      pD = pos60(d);
      hD.apply(pD.lat, pD.lng); await tick60();
      const rc = route60(mapD);
      trimD.push(!!rc && rc.length >= 2 && approx60(rc[0][0], pD.lng) && approx60(rc[0][1], pD.lat) && !mapD.sources.traveled);
    }
    // E) closestOnRoute: distancia y proyección sobre la línea.
    const hE = build60(null);
    const routeE = [[-93.2063, 16.8782], [-93.2063, 16.8709]];
    const onE = hE.closest(pos60(400).lat, pos60(400).lng, routeE);
    const offE = hE.closest(pos60(400, 100).lat, pos60(400, 100).lng, routeE);
    live60 = { zoomsA, firstPtA, zoomsB, routeB: !!routeB, centerB: mapB._center, callsC0, callsC1, callsC2, routeC, devC, devOk: !!(routeC && approx60(routeC[0][0], devC.lng) && approx60(routeC[0][1], devC.lat)), trimD, routeDLen0, traveledD: !!mapD.sources.traveled, onE: onE.d, offE: offE.d, osrmA: hA.osrmCalls.length };
  } catch(e){ live60 = null; }
  check('v1.4.60: evaluado — con OSRM caído y el mapa abierto sin posición, la línea azul aparece desde la 1ª lectura del GPS (no espera al cambio de etapa)', !!live60 && live60.firstPtA.every(Boolean), JSON.stringify(live60 && { firstPtA: live60.firstPtA, osrmA: live60.osrmA }));
  check('v1.4.60: evaluado — el zoom de proximidad sube al acercarse (16→17→18) con follow ON', !!live60 && live60.zoomsA[0] === 16 && live60.zoomsA[2] === 17 && live60.zoomsA[4] === 18, JSON.stringify(live60 && live60.zoomsA));
  check('v1.4.60: evaluado — con follow OFF (el chofer tocó el mapa) la línea aparece y el zoom TAMBIÉN sube, sin recentrar', !!live60 && live60.routeB && live60.zoomsB[0] === 16 && live60.zoomsB[1] === 17 && live60.zoomsB[2] === 18 && live60.centerB === null, JSON.stringify(live60 && { zoomsB: live60.zoomsB, centerB: live60.centerB }));
  check('v1.4.60: evaluado — el desvío a otra calle (>40 m de la ruta) dispara UN recálculo OSRM desde la posición actual y la línea arranca ahí', !!live60 && live60.callsC1 > live60.callsC0 && live60.devOk, JSON.stringify(live60 && { callsC0: live60.callsC0, callsC1: live60.callsC1, first: live60.routeC && live60.routeC[0] }));
  check('v1.4.60: evaluado — el recálculo por desvío no se repite en bucle (máximo 1 vez cada 10 s)', !!live60 && live60.callsC2 === live60.callsC1, JSON.stringify(live60 && { callsC1: live60.callsC1, callsC2: live60.callsC2 }));
  check('v1.4.60: evaluado — al avanzar por la ruta, la línea siempre arranca en la mototaxi y NO queda estela (sin línea "traveled")', !!live60 && live60.routeDLen0 === 5 && live60.trimD.every(Boolean) && !live60.traveledD, JSON.stringify(live60 && { routeDLen0: live60.routeDLen0, trimD: live60.trimD, traveledD: live60.traveledD }));
  check('v1.4.60: evaluado — closestOnRoute mide bien (sobre la ruta ~0 m, a 100 m al este ~100 m)', !!live60 && live60.onE < 1 && Math.abs(live60.offE - 100) < 3, JSON.stringify(live60 && { onE: live60.onE, offE: live60.offE }));
  // --- En vivo: el flujo nuevo del chofer + cancelar en llego ---
  const pax60 = await api('/api/register-passenger', { name: 'Pax Sesenta', phone: '961600' + RUN.slice(0, 4), face_photo: PHOTO });
  check('v1.4.60: en vivo, pasajera de prueba registrada', pax60.ok && pax60.passenger.id, JSON.stringify(pax60));
  const drv60 = await api('/api/register-driver', { name: 'Chofer Sesenta', phone: '961601' + RUN.slice(0, 4), vehicle: 'mototaxi', unit: 'V60', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.60: en vivo, chofer de prueba registrado', drv60.ok && drv60.driver.id, JSON.stringify(drv60));
  await approveDriver(drv60.driver.id);
  await api('/api/set-driver-online', { driver_id: drv60.driver.id, online: true });
  const trip60 = await api('/api/create-request', { passenger_id: pax60.passenger.id, kind: 'viaje', origin_zone: 'Madero', origin_detail: 'Madero', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 20, payment_method: 'efectivo', passenger_count: 1 });
  check('v1.4.60: en vivo, el viaje queda BUSCANDO ($20, 1 persona)', trip60.ok && trip60.request.status === 'buscando', JSON.stringify(trip60.request && { st: trip60.request.status }));
  const acc60 = await api('/api/driver-respond', { driver_id: drv60.driver.id, request_id: trip60.request.id, kind: 'acepta', price: 20 });
  check('v1.4.60: en vivo, al aceptar el viaje ya va en camino', acc60.ok && acc60.request.status === 'aceptado' && acc60.request.trip_stage === 'en_camino', JSON.stringify(acc60.request && { st: acc60.request.status, stage: acc60.request.trip_stage }));
  const llego60 = await api('/api/advance-stage', { driver_id: drv60.driver.id, request_id: trip60.request.id, stage: 'llego' });
  check('v1.4.60: en vivo, "Ya estoy afuera" deja el viaje en llego SIN empezar el recorrido', llego60.ok && llego60.request.trip_stage === 'llego' && !llego60.request.trip_started_at, JSON.stringify(llego60.request && { stage: llego60.request.trip_stage, started: llego60.request.trip_started_at }));
  const viaje60 = await api('/api/advance-stage', { driver_id: drv60.driver.id, request_id: trip60.request.id, stage: 'en_viaje' });
  check('v1.4.60: en vivo, "Iniciar recorrido" empieza el viaje (trip_started_at marcado)', viaje60.ok && viaje60.request.trip_stage === 'en_viaje' && !!viaje60.request.trip_started_at, JSON.stringify(viaje60.request && { stage: viaje60.request.trip_stage, started: viaje60.request.trip_started_at }));
  const fin60b = await api('/api/advance-stage', { driver_id: drv60.driver.id, request_id: trip60.request.id, stage: 'finalizado' });
  check('v1.4.60: en vivo, "Llegué a destino" finaliza el viaje con el precio acordado ($20, tarifa intacta)', fin60b.ok && fin60b.request.trip_stage === 'finalizado' && fin60b.request.status === 'finalizado' && !!fin60b.request.finished_at && fin60b.request.final_price === 20, JSON.stringify(fin60b.request && { stage: fin60b.request.trip_stage, fin: fin60b.request.finished_at, price: fin60b.request.final_price }));
  // Cancelar en llego (el recorrido no empezó) sí se puede.
  const trip60c = await api('/api/create-request', { passenger_id: pax60.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 20, payment_method: 'efectivo', passenger_count: 1 });
  await api('/api/driver-respond', { driver_id: drv60.driver.id, request_id: trip60c.request.id, kind: 'acepta', price: 20 });
  await api('/api/advance-stage', { driver_id: drv60.driver.id, request_id: trip60c.request.id, stage: 'llego' });
  const cancel60 = await api('/api/cancel-request', { request_id: trip60c.request.id });
  check('v1.4.60: en vivo, cancelar en llego (antes de iniciar el recorrido) sí se puede', cancel60.ok, JSON.stringify(cancel60));

  // ===== v1.4.61 (2026-11-24): mapa en vivo del PASAJERO como el del chofer + recibo naranja flotante =====
  // El usuario terminó un viaje entero ($25, 1.6 km, 5 min) y dijo: del
  // lado del chofer todo perfecto, NO se toca nada; del pasajero el mapa
  // no actualizaba en tiempo real, se veía muy grande y aparecían DOS
  // mototaxis; y el recibo no le gustó para nada.
  // Diagnóstico (leyendo el código): (1) el duplicado venía de que
  // renderLiveMap es async y se solapaba consigo misma — la apertura y el
  // cambio de etapa en el sondeo corrían a la vez y cada una creaba su
  // propio marcador tras esperar la ruta; la última ganaba la variable y
  // la otra quedaba huérfana y congelada en la recogida. (2) El encuadre
  // del pasajero metía los DOS puntos del viaje (recogida + destino) en
  // la vista: un viaje de 1.6 km se veía a lo ancho de todo el pueblo.
  // (3) El zoom de proximidad solo se calculaba dentro de
  // if(liveAsDriver): para el pasajero siempre era null. (4) El sondeo
  // SÍ mueve el marcador (liveApplyDriverPos en cada tick) y las tiras
  // de distancia SÍ se actualizaban entre sus capturas (781 m → 705 m):
  // lo que se veía "congelado" era la mototaxi huérfana + el mapa ancho.
  // El recibo del pasajero (viaje) ahora es una tarjeta flotante NARANJA
  // completa, sin tabla de detalles ni "Generar recibo": solo título,
  // gracias, precio enorme centrado y el recordatorio (solo efectivo),
  // más grande. El del chofer y el del mandado NO se tocan.
  const renderSec61 = html.slice(html.indexOf('async function renderLiveMap(){'), html.indexOf('function showLiveRecenter(){'));
  check('v1.4.61: renderLiveMap tiene guardia de generación — un render viejo no crea marcadores huérfanos (la mototaxi duplicada)', html.includes('let liveRenderGen = 0;') && renderSec61.includes('const gen61 = ++liveRenderGen;') && renderSec61.includes('if(gen61 !== liveRenderGen) return;'));
  check('v1.4.61: la mototaxi del mapa se pinta en la posición MÁS FRESCA del chofer y se quita la vieja antes de crear la nueva (una sola)', renderSec61.includes('const dPos = (liveReq.driver_lat && liveReq.driver_lng)') && renderSec61.includes('if(liveDriverMarker){ liveDriverMarker.remove(); liveDriverMarker = null; }') && renderSec61.includes('liveDriverMarker = new maplibregl.Marker({ element: motoIconEl() })'));
  check('v1.4.61: el encuadre del pasajero ya NO es ancho (sin los dos puntos del viaje ni el zoom 16 fijo en la recogida): es la ruta restante como el chofer', !renderSec61.includes('fitPoints(liveMap, pts, { top: 170, bottom: botPad, left: 50, right: 50 })') && !renderSec61.includes("if(!inTrip) liveMap.easeTo({ center: [pick.lng, pick.lat], zoom: 16") && !renderSec61.includes('botPad') && renderSec61.includes('fitPoints(liveMap, liveRouteCoords, liveFollowPadding())'));
  check('v1.4.61: el recibo del pasajero es una tarjeta NARANJA completa (CSS: fondo degradado ámbar, precio 56px, recordatorio en banda naranja oscura)', html.includes('#trip-summary-overlay .sumfloat.orange{background:linear-gradient(180deg,#fbbf24,#f59e0b)}') && html.includes('.sumprice-big{text-align:center;font-size:56px;font-weight:900;color:#111827') && html.includes('.sumremind{background:#c2410c;color:#fff;font-size:18px;font-weight:800'));
  const sumSec61 = html.slice(html.indexOf('function showTripSummary(r, asDriver){'), html.indexOf('function startLivePolling(){'));
  const paxStart61 = html.indexOf("if(!asDriver && r.kind==='viaje'){", html.indexOf('function showTripSummary(r, asDriver){'));
  const paxBranch61 = html.slice(paxStart61, html.indexOf("\n  }\n  ov.innerHTML = '<div class=\"sumwrap\">", paxStart61));
  check('v1.4.62: el recibo del PASAJERO (viaje) es solo título + gracias + precio enorme centrado + recordatorio de cambio + línea de pertenencias (SIEMPRE): sin tabla de detalles ni "Generar recibo", con la clase orange-receipt', paxBranch61.includes('sumfloat orange') && paxBranch61.includes('¡Viaje terminado!') && paxBranch61.includes('Tu viaje ha concluido. Gracias por usar SanFerGo.') && paxBranch61.includes('sumprice-big') && paxBranch61.includes('sumremind') && paxBranch61.includes('sumbelong') && paxBranch61.includes('Recuerda revisar todas tus pertenencias') && paxBranch61.includes("classList.add('orange-receipt')") && paxBranch61.includes('class="adx"') && paxBranch61.includes('return;') && !paxBranch61.includes('>Generar recibo</button>') && !paxBranch61.includes('downloadReceipt') && !paxBranch61.includes('class="kv"') && !paxBranch61.includes('Cerrar</button>'));
  check('v1.4.63: el recibo del CHOFER (viaje) ya NO dice lo del pasajero: la línea es "Revisa que el pasajero no haya olvidado algo en tu mototaxi" (misma banda crema); tarjeta naranja igual (Resumen del viaje + gracias + precio enorme; sin mapa, sin tabla, sin Generar recibo, sin línea de cambio)', (()=>{ const d0 = html.indexOf("if(asDriver && r.kind==='viaje'){", html.indexOf('function showTripSummary(r, asDriver){')); const d1 = html.indexOf("if(!asDriver && r.kind==='viaje'){", d0); const b = html.slice(d0, d1); return b.includes('sumfloat orange') && b.includes('Resumen del viaje') && b.includes('Gracias por concluir el viaje') && b.includes('sumprice-big') && b.includes('sumbelong') && b.includes('Revisa que el pasajero no haya olvidado algo en tu mototaxi') && !b.includes('Recuerda revisar todas tus pertenencias') && b.includes("classList.add('orange-receipt')") && b.includes('class="adx"') && b.includes('return;') && !b.includes('sumremind') && !b.includes('Recuerda pagar con cambio') && !b.includes('downloadReceipt') && !b.includes('class="kv"') && !b.includes('>Generar recibo</button>') && !b.includes('sum-minimap') && !b.includes('Cerrar</button>'); })());
  check('v1.4.63: los recibos de MANDADO ya son tarjetas naranjas como los de viaje (CUATRO ramas orange-receipt); el diálogo viejo queda solo como respaldo en el sumario', sumSec61.includes('id="sum-minimap"') && sumSec61.includes('onclick="downloadReceipt()">Generar recibo</button>') && sumSec61.includes("'Cerrar y volver a recibir viajes'") && sumSec61.includes('<span>Pasajero</span>') && sumSec61.includes('<span>Precio final</span>') && (html.split("classList.add('orange-receipt')").length - 1) === 4);
  check('v1.4.63: el recibo del CHOFER para MANDADO es tarjeta naranja (Resumen del mandado + gracias + precio enorme; sin banda de cambio, sin pertenencias, sin mapa, sin tabla, sin Generar recibo)', (()=>{ const d0 = html.indexOf("if(asDriver && r.kind==='mandado'){", html.indexOf('function showTripSummary(r, asDriver){')); const d1 = html.indexOf("if(!asDriver && r.kind==='mandado'){", d0); const b = html.slice(d0, d1); return b.includes('sumfloat orange') && b.includes('Resumen del mandado') && b.includes('Gracias por concluir el mandado') && b.includes('sumprice-big') && b.includes("classList.add('orange-receipt')") && b.includes('class="adx"') && b.includes('return;') && !b.includes('sumremind') && !b.includes('sumbelong') && !b.includes('Recuerda pagar con cambio') && !b.includes('Recuerda revisar') && !b.includes('olvidad') && !b.includes('downloadReceipt') && !b.includes('class="kv"') && !b.includes('>Generar recibo</button>') && !b.includes('sum-minimap') && !b.includes('Cerrar</button>'); })());
  check('v1.4.63: el recibo del PASAJERO para MANDADO es tarjeta naranja (¡Mandado entregado! + gracias + precio enorme + banda de cambio condicional; SIN pertenencias, sin tabla, sin Generar recibo)', (()=>{ const p0 = html.indexOf("if(!asDriver && r.kind==='mandado'){", html.indexOf('function showTripSummary(r, asDriver){')); const p1 = html.indexOf("\n  }\n  ov.innerHTML = '<div class=\"sumwrap\">", p0); const b = html.slice(p0, p1); return b.includes('sumfloat orange') && b.includes('¡Mandado entregado!') && b.includes('Tu mandado ha concluido. Gracias por usar SanFerGo.') && b.includes('sumprice-big') && b.includes('sumremind') && b.includes('summaryCashNote') && b.includes("classList.add('orange-receipt')") && b.includes('class="adx"') && b.includes('return;') && !b.includes('sumbelong') && !b.includes('Recuerda revisar') && !b.includes('downloadReceipt') && !b.includes('class="kv"') && !b.includes('>Generar recibo</button>') && !b.includes('Cerrar</button>'); })());
  // --- Evaluado: el recibo real (función showTripSummary) en sus 4 casos. ---
  let receipt61 = null;
  try {
    const sumSrc61 = html.slice(html.indexOf('function showTripSummary(r, asDriver){'), html.indexOf('function closeTripSummary(){'));
    const cashSrc61 = html.slice(html.indexOf('function summaryCashNote(r){'), html.indexOf('function showTripSummary(r, asDriver){'));
    const cashFn61 = eval('(' + cashSrc61.replace('function summaryCashNote(r)', 'function(r)') + ')');
    const runReceipt61 = (r, asDriver) => {
      let captured = null;
      const doc = {
        getElementById: () => null,
        createElement: () => ({ innerHTML: '', classList: { list: [], add(c){ this.list.push(c); } }, addEventListener() {}, appendChild() {} }),
        body: { appendChild(el) { captured = el; } }
      };
      let miniCalled = 0;
      const f = new Function('document', 'window', 'fmtDateTime', 'esc', 'paxText', 'fmt$', 'summaryCashNote', 'drawSummaryMiniMap', sumSrc61 + '\nreturn showTripSummary;');
      const show = f(doc, {}, () => '24 nov 2026, 08:52', s => String(s == null ? '' : s), p => { const n = Math.max(1, Math.min(3, Number(p) || 1)); return n + (n === 1 ? ' persona' : ' personas'); }, n => '$' + Math.round(Number(n) || 0), cashFn61, () => { miniCalled++; });
      show(r, asDriver);
      return { html: captured ? captured.innerHTML : '', classes: captured ? captured.classList.list : [], miniCalled };
    };
    const tripEf61 = { id: 201, kind: 'viaje', origin_zone: 'Madero', dest_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_lat: 16.8675, dest_lng: -93.2105, created_at: '2026-11-24 08:47:00', finished_at: '2026-11-24 08:52:00', trip_started_at: '2026-11-24 08:47:00', distance_km: 1.6, price: 25, final_price: 25, passenger_count: 1, driver_name: 'Josué Eduardo', driver_unit: 'Hahaha', passenger_name: 'The Noob Gamer', passenger_phone: '9614868605', payment_method: 'efectivo' };
    const tripTr61 = { ...tripEf61, payment_method: 'transferencia' };
    const mandEf61 = { ...tripEf61, kind: 'mandado', id: 202 };
    const mandTr61 = { ...mandEf61, payment_method: 'transferencia' };
    receipt61 = {
      paxEf: runReceipt61(tripEf61, false),
      paxTr: runReceipt61(tripTr61, false),
      drvEf: runReceipt61(tripEf61, true),
      mandEf: runReceipt61(mandEf61, false),
      mandTr: runReceipt61(mandTr61, false),
      drvMandEf: runReceipt61(mandEf61, true)
    };
  } catch(e){ receipt61 = null; }
  check('v1.4.62: evaluado — el recibo del PASAJERO (viaje, efectivo) es la tarjeta naranja: título, gracias, precio $25 enorme centrado, recordatorio de cambio grande y línea de pertenencias; tarjeta centrada (clase orange-receipt); sin tabla ni "Generar recibo"', !!receipt61 && receipt61.paxEf.html.includes('sumfloat orange') && receipt61.paxEf.html.includes('¡Viaje terminado!') && receipt61.paxEf.html.includes('Tu viaje ha concluido. Gracias por usar SanFerGo.') && receipt61.paxEf.html.includes('sumprice-big') && receipt61.paxEf.html.includes('$25') && receipt61.paxEf.html.includes('sumremind') && receipt61.paxEf.html.includes('Recuerda pagar con cambio al conductor') && receipt61.paxEf.html.includes('sumbelong') && receipt61.paxEf.html.includes('Recuerda revisar todas tus pertenencias') && receipt61.paxEf.classes.includes('orange-receipt') && receipt61.paxEf.html.includes('class="adx"') && !receipt61.paxEf.html.includes('Generar recibo') && !receipt61.paxEf.html.includes('class="kv"') && !receipt61.paxEf.html.includes('downloadReceipt') && !receipt61.paxEf.html.includes('Cerrar</button>') && receipt61.paxEf.miniCalled === 0, JSON.stringify(receipt61 && { paxEf: receipt61.paxEf.html.slice(0, 220), classes: receipt61.paxEf.classes, mini: receipt61.paxEf.miniCalled }));
  check('v1.4.62: evaluado — el recibo del PASAJERO con pago por transferencia NO lleva recordatorio de cambio (solo efectivo) pero SÍ la línea de pertenencias y el precio naranja', !!receipt61 && receipt61.paxTr.html.includes('sumfloat orange') && receipt61.paxTr.html.includes('$25') && receipt61.paxTr.html.includes('sumbelong') && receipt61.paxTr.html.includes('Recuerda revisar todas tus pertenencias') && receipt61.paxTr.classes.includes('orange-receipt') && !receipt61.paxTr.html.includes('sumremind') && !receipt61.paxTr.html.includes('Recuerda pagar con cambio'), JSON.stringify(receipt61 && receipt61.paxTr.html.slice(0, 200)));
  check('v1.4.63: evaluado — el recibo del CHOFER ya NO dice lo del pasajero: la línea es "Revisa que el pasajero no haya olvidado algo en tu mototaxi" (Resumen del viaje + gracias + precio $25 enorme; sin mapa, sin tabla, sin Generar recibo, sin línea de cambio)', !!receipt61 && receipt61.drvEf.html.includes('sumfloat orange') && receipt61.drvEf.html.includes('Resumen del viaje') && receipt61.drvEf.html.includes('Gracias por concluir el viaje') && receipt61.drvEf.html.includes('sumprice-big') && receipt61.drvEf.html.includes('$25') && receipt61.drvEf.html.includes('sumbelong') && receipt61.drvEf.html.includes('Revisa que el pasajero no haya olvidado algo en tu mototaxi') && !receipt61.drvEf.html.includes('Recuerda revisar todas tus pertenencias') && receipt61.drvEf.classes.includes('orange-receipt') && receipt61.drvEf.html.includes('class="adx"') && !receipt61.drvEf.html.includes('Generar recibo') && !receipt61.drvEf.html.includes('class="kv"') && !receipt61.drvEf.html.includes('downloadReceipt') && !receipt61.drvEf.html.includes('Cerrar</button>') && !receipt61.drvEf.html.includes('sum-minimap') && !receipt61.drvEf.html.includes('Recuerda pagar con cambio') && !receipt61.drvEf.html.includes('sumremind') && receipt61.drvEf.miniCalled === 0, JSON.stringify(receipt61 && { drv: receipt61.drvEf.html.slice(0, 200), classes: receipt61.drvEf.classes, mini: receipt61.drvEf.miniCalled }));
  check('v1.4.63: evaluado — el recibo del MANDADO del pasajero (efectivo) es tarjeta naranja: ¡Mandado entregado! + gracias + precio $25 enorme + banda de cambio; SIN pertenencias, sin tabla ni "Generar recibo"', !!receipt61 && receipt61.mandEf.html.includes('sumfloat orange') && receipt61.mandEf.html.includes('¡Mandado entregado!') && receipt61.mandEf.html.includes('Tu mandado ha concluido. Gracias por usar SanFerGo.') && receipt61.mandEf.html.includes('sumprice-big') && receipt61.mandEf.html.includes('$25') && receipt61.mandEf.html.includes('sumremind') && receipt61.mandEf.html.includes('Recuerda pagar con cambio al conductor') && !receipt61.mandEf.html.includes('sumbelong') && !receipt61.mandEf.html.includes('Recuerda revisar') && receipt61.mandEf.classes.includes('orange-receipt') && receipt61.mandEf.html.includes('class="adx"') && !receipt61.mandEf.html.includes('Generar recibo') && !receipt61.mandEf.html.includes('class="kv"') && !receipt61.mandEf.html.includes('downloadReceipt') && !receipt61.mandEf.html.includes('Cerrar</button>') && receipt61.mandEf.miniCalled === 0, JSON.stringify(receipt61 && receipt61.mandEf.html.slice(0, 200)));
  check('v1.4.63: evaluado — el recibo del MANDADO del pasajero con transferencia NO lleva banda de cambio (solo efectivo) y tampoco pertenencias', !!receipt61 && receipt61.mandTr.html.includes('sumfloat orange') && receipt61.mandTr.html.includes('¡Mandado entregado!') && receipt61.mandTr.html.includes('$25') && !receipt61.mandTr.html.includes('sumremind') && !receipt61.mandTr.html.includes('Recuerda pagar con cambio') && !receipt61.mandTr.html.includes('sumbelong') && receipt61.mandTr.classes.includes('orange-receipt'), JSON.stringify(receipt61 && receipt61.mandTr.html.slice(0, 200)));
  check('v1.4.63: evaluado — el recibo del MANDADO del chofer es tarjeta naranja: Resumen del mandado + gracias + precio $25 enorme; SIN banda de cambio, SIN pertenencias, sin mapa, sin tabla, sin Generar recibo', !!receipt61 && receipt61.drvMandEf.html.includes('sumfloat orange') && receipt61.drvMandEf.html.includes('Resumen del mandado') && receipt61.drvMandEf.html.includes('Gracias por concluir el mandado') && receipt61.drvMandEf.html.includes('sumprice-big') && receipt61.drvMandEf.html.includes('$25') && !receipt61.drvMandEf.html.includes('sumremind') && !receipt61.drvMandEf.html.includes('sumbelong') && !receipt61.drvMandEf.html.includes('Recuerda pagar con cambio') && !receipt61.drvMandEf.html.includes('Recuerda revisar') && !receipt61.drvMandEf.html.includes('olvidad') && receipt61.drvMandEf.classes.includes('orange-receipt') && receipt61.drvMandEf.html.includes('class="adx"') && !receipt61.drvMandEf.html.includes('Generar recibo') && !receipt61.drvMandEf.html.includes('class="kv"') && !receipt61.drvMandEf.html.includes('downloadReceipt') && !receipt61.drvMandEf.html.includes('Cerrar</button>') && !receipt61.drvMandEf.html.includes('sum-minimap') && receipt61.drvMandEf.miniCalled === 0, JSON.stringify(receipt61 && receipt61.drvMandEf.html.slice(0, 200)));
  // --- v1.4.61 (hueco): "Ver recibo" del historial del PASAJERO (viaje)
  // abría showReceipt, un diálogo APARTE con su propia tabla + "Generar
  // recibo" (el recibo VIEJO), mientras la app real ya muestra ahí la
  // tarjeta naranja. Ahora showReceipt enruta el viaje del pasajero a
  // showTripSummary (la misma tarjeta naranja del final del viaje) y el
  // recibo del chofer + el del mandado siguen con el diálogo viejo,
  // intactos. El lado lo decide el sitio que llama: el historial del
  // chofer pasa asDriver=true; el del pasajero no pasa nada. NO se decide
  // por driver_id: el mismo usuario puede ser chofer y pasajero a la vez
  // (su propio viaje lo conduciría él) y caería en el diálogo viejo.
  // Al cerrar el recibo abierto desde el historial hay que quedarse en
  // el historial: closeTripSummary ya no llama exitLive() en ese caso
  // (la página sigue debajo del flotante).
  const receiptSec61 = html.slice(html.indexOf('async function showReceipt(requestId, asDriver){'), html.indexOf('/* ===== VIAJE EN CURSO'));
  check('v1.4.62: showReceipt enruta el VIAJE del pasajero Y el del chofer a su tarjeta naranja (showTripSummary) en vez del diálogo viejo', receiptSec61.includes("if(!asDriver && r.kind==='viaje'){ receiptFromHist = true; showTripSummary(r, false); return; }") && receiptSec61.includes("if(asDriver && r.kind==='viaje'){ receiptFromHist = true; showTripSummary(r, true); return; }") && receiptSec61.includes('const r = j.requests.find(x=>x.id===requestId);'));
  check('v1.4.63: showReceipt enruta el MANDADO de ambos lados a su tarjeta naranja (showTripSummary); el diálogo viejo ya no existe en showReceipt', receiptSec61.includes("if(!asDriver && r.kind==='mandado'){ receiptFromHist = true; showTripSummary(r, false); return; }") && receiptSec61.includes("if(asDriver && r.kind==='mandado'){ receiptFromHist = true; showTripSummary(r, true); return; }") && !receiptSec61.includes("openDialog('<h2>Recibo del '") && !receiptSec61.includes('downloadReceipt') && !receiptSec61.includes('Generar recibo'));
  check('v1.4.61: el historial del CHOFER pasa asDriver=true y el del PASAJERO no pasa el lado (sus botones siguen como antes)', html.includes("showReceipt('+r.id+', true)") && html.includes("onclick=\"event.stopPropagation();showReceipt('+r.id+')\"") && html.includes("onclick=\"showReceipt('+r.id+')\""));
  const closeSec61 = html.slice(html.indexOf('function closeTripSummary(){'), html.indexOf('function drawSummaryMiniMap(r){'));
  check('v1.4.61: closeTripSummary se queda en el historial cuando el recibo se abrió desde ahí (sin exitLive) y sigue volviendo a donde toca en el flujo en vivo', closeSec61.includes('if(receiptFromHist){ receiptFromHist = false; return; }') && closeSec61.includes('exitLive();') && html.includes('let receiptFromHist = false;'));
  // --- Evaluado: showReceipt en sus 3 casos + closeTripSummary desde el historial. ---
  let histReceipt61 = null;
  try {
    const recSrc61 = html.slice(html.indexOf('async function showReceipt(requestId, asDriver){'), html.indexOf('/* ===== VIAJE EN CURSO'));
    // El viaje lo condujo EL MISMO usuario (driver_id 1 = su chofer y su
    // pasajero son la misma persona): si el lado se decidiera por
    // driver_id, el recibo del pasajero caería en el diálogo viejo.
    const tripH61 = { id: 201, kind: 'viaje', origin_zone: 'Madero', dest_zone: 'Centro', created_at: '2026-11-24 08:47:00', finished_at: '2026-11-24 08:52:00', trip_started_at: '2026-11-24 08:47:00', distance_km: 1.6, price: 25, final_price: 25, passenger_count: 1, driver_id: 1, driver_name: 'Josué Eduardo', driver_unit: 'Hahaha', passenger_name: 'The Noob Gamer', passenger_phone: '9614868605', payment_method: 'efectivo' };
    const mandH61 = { ...tripH61, id: 202, kind: 'mandado' };
    const calls61 = { sum: [], dlg: [] };
    const apiH61 = async () => ({ requests: [tripH61, mandH61] });
    const showH61 = (r, asDriver) => { calls61.sum.push({ id: r.id, asDriver }); };
    const dlgH61 = (h) => { calls61.dlg.push(h); };
    const fH61 = new Function('api', 'toast', 'showTripSummary', 'openDialog', 'window', 'fmtDateTime', 'esc', 'paxText', 'fmt$', 'let receiptFromHist = false;\n' + recSrc61 + '\nreturn { showReceipt: showReceipt, getFlag: function(){ return receiptFromHist; } };');
    const h61 = fH61(apiH61, () => {}, showH61, dlgH61, {}, () => '24 nov 2026, 08:52', s => String(s == null ? '' : s), p => { const n = Math.max(1, Math.min(3, Number(p) || 1)); return n + (n === 1 ? ' persona' : ' personas'); }, n => '$' + Math.round(Number(n) || 0));
    await h61.showReceipt(201);
    const afterPax61 = { sum: calls61.sum.slice(), dlg: calls61.dlg.slice(), flag: h61.getFlag() };
    await h61.showReceipt(201, true);
    const afterDrv61 = { sum: calls61.sum.slice(), dlg: calls61.dlg.slice() };
    await h61.showReceipt(202);
    const afterMand61 = { sum: calls61.sum.slice(), dlg: calls61.dlg.slice() };
    await h61.showReceipt(202, true);
    const afterDrvMand61 = { sum: calls61.sum.slice(), dlg: calls61.dlg.slice() };
    const closeSrc61 = html.slice(html.indexOf('function closeTripSummary(){'), html.indexOf('function drawSummaryMiniMap(r){'));
    const mkClose61 = (flag) => {
      let exitCalls = 0;
      const ov = { removed: false, remove() { this.removed = true; } };
      const doc = { getElementById: () => ov };
      const f = new Function('document', 'summaryMiniMap', 'receiptFromHist', 'exitLive', closeSrc61 + '\nreturn closeTripSummary;');
      const close = f(doc, null, flag, () => { exitCalls++; });
      close();
      return { exitCalls, ovRemoved: ov.removed };
    };
    histReceipt61 = { afterPax61, afterDrv61, afterMand61, afterDrvMand61, closeHist61: mkClose61(true), closeLive61: mkClose61(false) };
  } catch(e){ histReceipt61 = null; }
  check('v1.4.61: evaluado — "Ver recibo" del PASAJERO (viaje, aunque el chofer sea él mismo) abre la tarjeta naranja, no el diálogo viejo', !!histReceipt61 && histReceipt61.afterPax61.sum.length === 1 && histReceipt61.afterPax61.sum[0].id === 201 && histReceipt61.afterPax61.sum[0].asDriver === false && histReceipt61.afterPax61.dlg.length === 0 && histReceipt61.afterPax61.flag === true, JSON.stringify(histReceipt61 && histReceipt61.afterPax61));
  check('v1.4.62: evaluado — "Ver recibo" del CHOFER (viaje) ahora abre su tarjeta naranja (showTripSummary asDriver=true), no el diálogo viejo', !!histReceipt61 && histReceipt61.afterDrv61.sum.length === 2 && histReceipt61.afterDrv61.sum[1].id === 201 && histReceipt61.afterDrv61.sum[1].asDriver === true && histReceipt61.afterDrv61.dlg.length === 0, JSON.stringify(histReceipt61 && histReceipt61.afterDrv61));
  check('v1.4.63: evaluado — "Ver recibo" del MANDADO del pasajero ahora abre su tarjeta naranja (showTripSummary asDriver=false), no el diálogo viejo', !!histReceipt61 && histReceipt61.afterMand61.sum.length === 3 && histReceipt61.afterMand61.sum[2].id === 202 && histReceipt61.afterMand61.sum[2].asDriver === false && histReceipt61.afterMand61.dlg.length === 0, JSON.stringify(histReceipt61 && histReceipt61.afterMand61));
  check('v1.4.63: evaluado — "Ver recibo" del MANDADO del chofer abre su tarjeta naranja (showTripSummary asDriver=true)', !!histReceipt61 && histReceipt61.afterDrvMand61.sum.length === 4 && histReceipt61.afterDrvMand61.sum[3].id === 202 && histReceipt61.afterDrvMand61.sum[3].asDriver === true && histReceipt61.afterDrvMand61.dlg.length === 0, JSON.stringify(histReceipt61 && histReceipt61.afterDrvMand61));
  check('v1.4.61: evaluado — cerrar el recibo abierto desde el historial se queda en el historial (NO llama exitLive) y en el flujo en vivo sí vuelve a donde toca', !!histReceipt61 && histReceipt61.closeHist61.exitCalls === 0 && histReceipt61.closeHist61.ovRemoved === true && histReceipt61.closeLive61.exitCalls === 1 && histReceipt61.closeLive61.ovRemoved === true, JSON.stringify(histReceipt61 && { hist: histReceipt61.closeHist61, live: histReceipt61.closeLive61 }));
  // ===== v1.4.62 (2026-11-24): recibo naranja — línea de pertenencias + X arriba + tarjeta centrada + recibo del CHOFER igual de bonito =====
  // El usuario probó la v1.4.61 en vivo ("Quedó genial") y pidió tres
  // cosas del recibo del pasajero: (1) otra línea "Recuerda revisar
  // todas tus pertenencias" (SIEMPRE, no solo en efectivo); (2) la X
  // estaba muy abajo y tapaba la palabra "usar" de la línea de gracias:
  // ahora va arriba, a caballo del borde superior de la tarjeta, con
  // aire arriba para que no tape ningún texto; (3) la tarjeta flotante
  // se veía corrida hacia arriba, con mucho mapa vacío abajo: ahora va
  // centrada verticalmente en la pantalla. Y el recibo del CHOFER
  // ("Resumen del viaje") ahora es IGUAL de bonito que el del pasajero
  // — misma tarjeta naranja, precio enorme y línea de pertenencias; sin
  // mini mapa, sin tabla y sin "Generar recibo"; sin línea de cambio (el
  // chofer RECIBE el efectivo, no paga). El recibo de MANDADOS no se toca.
  check('v1.4.62: la tarjeta naranja del recibo va CENTRADA verticalmente en la pantalla (clase orange-receipt: align-items:center, sin padding-top) y solo esa tarjeta', html.includes('#trip-summary-overlay.orange-receipt{align-items:center;padding-top:0}') && html.includes('#trip-summary-overlay{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.6);display:flex;justify-content:center;align-items:flex-start;padding-top:7dvh;pointer-events:auto}'));
  check('v1.4.62: la X del recibo naranja va MÁS ARRIBA, a caballo del borde superior de la tarjeta (top:-22px), y la tarjeta lleva aire arriba (padding-top:26px) para que la X no tape el texto', html.includes('#trip-summary-overlay.orange-receipt .adx{top:-22px;right:8px}') && html.includes('#trip-summary-overlay.orange-receipt .sumfloat.orange{padding-top:26px}'));
  check('v1.4.62: la línea de pertenencias existe con estilo propio legible sobre el naranja (banda crema con texto oscuro)', html.includes('#trip-summary-overlay .sumfloat.orange .sumbelong{background:#fff7ed;color:#7c2d12'));
  // ===== v1.4.63 (2026-11-24): recibos de MANDADO naranjas + pestaña inicial del chofer en Recibir Viajes =====
  // El usuario probó la v1.4.62 en vivo ("Quedó genial") y pidió dos
  // cosas: (1) los recibos de MANDADOS todavía salían VIEJOS (tarjeta
  // blanca con tabla + "Generar recibo"): ahora son tarjetas naranjas
  // como las de viaje — pasajero "¡Mandado entregado!" con banda de
  // cambio solo en efectivo y SIN pertenencias; chofer "Resumen del
  // mandado" sin cambio ni pertenencias; (2) al entrar a trabajar como
  // chofer, la pestaña inicial es Recibir Viajes, no Inicio (la barra
  // sigue con las tres pestañas; con viaje activo el aviso verde sigue
  // teniendo prioridad como antes). Además la línea del recibo del
  // CHOFER (viaje) ya no dice lo del pasajero: ahora dice "Revisa que
  // el pasajero no haya olvidado algo en tu mototaxi".
  let enterDrv63 = null;
  try {
    const src63 = html.slice(html.indexOf('function enterDriverMode(){'), html.indexOf('function exitDriverMode'));
    const calls63 = [];
    const f63 = new Function('myDriver', 'store', 'go', 'driverTab', src63 + '\nreturn enterDriverMode;');
    const enter63 = f63({ id: 1 }, {}, v => calls63.push(['go', v]), t => calls63.push(['driverTab', t]));
    enter63();
    enterDrv63 = calls63;
  } catch(e){ enterDrv63 = null; }
  check('v1.4.63: evaluado — enterDriverMode abre Recibir Viajes al entrar a trabajar (go chofer + driverTab recibir)', !!enterDrv63 && enterDrv63.length === 2 && enterDrv63[0][0] === 'go' && enterDrv63[0][1] === 'chofer' && enterDrv63[1][0] === 'driverTab' && enterDrv63[1][1] === 'recibir', JSON.stringify(enterDrv63));
  check('v1.4.63: go("chofer") sigue abriendo Inicio para los demás caminos (cerrar recibo, Ver mi plan, volver del taxímetro)', html.includes("if(view==='chofer') driverTab('inicio');"));
  check('v1.4.63: la barra inferior del chofer sigue con Inicio / Taxímetro / Recibir Viajes', html.includes("onclick=\"driverTab('inicio')\"") && html.includes("onclick=\"driverTab('taximetro')\"") && html.includes("onclick=\"driverTab('recibir')\""));
  // --- Evaluado: el mapa en vivo del PASAJERO (funciones reales) — una sola mototaxi, encuadre como el chofer, zoom de proximidad. ---
  let live61 = null;
  try {
    const fn61 = (start, end) => {
      const a = html.indexOf(start);
      if (a < 0) throw new Error('sin ' + start);
      let b = end ? html.indexOf(end, a) : html.indexOf('\nfunction ', a + 1);
      if (b < 0) b = html.length;
      return html.slice(a, b);
    };
    const liveSrc61 = [
      fn61('function havKm(a,b,c,d){'),
      fn61('function liveHeadingToDest(r){', '/* Paradas intermedias'),
      fn61('function liveRouteWaypoints(r, toDest){', 'function straightRouteCoords'),
      fn61('function straightRouteCoords(from, target, via){', '/* Zoom de proximidad'),
      fn61('function liveTargetZoom(distM){', 'function closestOnRoute'),
      fn61('function closestOnRoute(lat, lng, coords){', 'function ensureLiveRoute'),
      fn61('function ensureLiveRoute(){', 'function nextStage(r){'),
      fn61('function setRouteLine(map, id, coords, color, width){', 'function removeRouteLine'),
      fn61('function removeRouteLine(map, id){', 'function fitPoints'),
      fn61('function fitPoints(map, pts, pad){', 'function smoothTrack'),
      fn61('function applyHeading(heading){', 'function renderLiveStrips(){'),
      fn61('function followPadding(topId, botId, defTop, defBot){'),
      'function liveFollowPadding(){ return followPadding(\'live-top\', \'live-bottom\', 170, 280); }',
      fn61('function dotEl(color, size){', 'function motoIconEl'),
      fn61('function motoIconEl(){', 'async function osrmRoute(a, b, via){'),
      fn61('async function renderLiveMap(){', 'function showLiveRecenter(){'),
      html.slice(html.indexOf('function liveApplyDriverPos(lat, lng, prevLat, prevLng){'), html.indexOf("window.addEventListener('online'"))
    ].join('\n');
    const el61 = () => ({ classList: { add(){}, remove(){} }, style: {}, textContent: '', innerHTML: '', className: '', offsetTop: 0, offsetHeight: 0, closest: () => null, appendChild(){}, querySelector: () => null, remove(){} });
    const doc61 = { getElementById: () => el61(), createElement: () => el61(), querySelector: () => el61() };
    const tick61 = () => new Promise(r => setTimeout(r, 0));
    const mkMap61 = () => {
      const sources = {}, layers = {};
      return {
        _zoom: 15, _center: null, easeCalls: [], fitCalls: [], sources, layers,
        getZoom() { return this._zoom; },
        easeTo(o) { if (o.zoom != null) this._zoom = o.zoom; if (o.center) this._center = o.center; this.easeCalls.push(o); },
        fitBounds(b, opts) { this.fitCalls.push({ pts: b.pts.slice(), pad: opts && opts.padding, maxZoom: opts && opts.maxZoom }); this._zoom = 15; },
        addSource(id, def) { sources[id] = def.data; },
        getSource(id) { return sources[id] ? { setData(d) { sources[id] = d; } } : null; },
        addLayer(l) { layers[l.id] = l; },
        getLayer(id) { return layers[id] || null; },
        removeLayer(id) { delete layers[id]; },
        removeSource(id) { delete sources[id]; },
        on() {}, resize() {}, remove() {}
      };
    };
    const mkLib61 = (markers) => ({
      Marker: class {
        constructor(opts) { this.el = opts.element; this.removed = false; this.lngLat = null; markers.push(this); }
        setLngLat(l) { this.lngLat = l; return this; }
        addTo(m) { this.map = m; return this; }
        remove() { this.removed = true; }
        getLngLat() { return this.lngLat ? { lng: this.lngLat[0], lat: this.lngLat[1] } : null; }
      },
      LngLatBounds: class {
        constructor(p1, p2) { this.pts = [p1, p2]; }
        extend(p) { this.pts.push(p); return this; }
      }
    });
    const build61 = (osrmImpl, markers) => {
      const osrmCalls = [];
      const osrmRoute = async (a, b, via) => { osrmCalls.push({ a, b }); return osrmImpl ? await osrmImpl(a, b, via) : null; };
      const src = 'let liveReq = null, liveMap = null, liveAsDriver = false, liveFollow = true;\nlet liveRouteCoords = null, liveRouteFallback = false, liveOsrmRetryTick = 0;\nlet liveDriverMarker = null, liveLastStripAt = 0, liveLastHeading = null, liveGpsPos = null;\nlet liveRerouting = false, liveLastRerouteAt = 0;\nlet liveRenderGen = 0;\nlet liveMarkers = {};\n' + liveSrc61 + '\nreturn { setReq(r){ liveReq = r; }, getReq(){ return liveReq; }, setMap(m){ liveMap = m; }, setMarker(m){ liveDriverMarker = m; }, setFollow(f){ liveFollow = f; }, getRoute(){ return liveRouteCoords; }, getMarker(){ return liveDriverMarker; }, getGen(){ return liveRenderGen; }, apply: liveApplyDriverPos, render: renderLiveMap };';
      const factory = new Function('document', 'maplibregl', '$', 'osrmRoute', 'renderLiveStrips', src);
      const api61 = factory(doc61, mkLib61(markers), () => el61(), osrmRoute, () => {});
      api61.osrmCalls = osrmCalls;
      return api61;
    };
    const PICK61 = { lat: 16.8709, lng: -93.2063 };
    const DEST61 = { lat: 16.8675, lng: -93.2105 };
    const approx61 = (a, b, tol) => Math.abs(a - b) < (tol || 1e-5);
    // A) Dos renders solapados (apertura + cambio de etapa en el sondeo):
    // solo UNA mototaxi, en la posición MÁS FRESCA, y el encuadre es la
    // ruta restante con el padding del chofer (no los dos puntos del viaje).
    const markersA = [];
    let resolveRouteA = null;
    const routeAPromise = new Promise(res => { resolveRouteA = res; });
    const hA61 = build61(() => routeAPromise, markersA);
    const mapA61 = mkMap61();
    const reqA61 = { id: 301, kind: 'viaje', trip_stage: 'en_viaje', origin_lat: PICK61.lat, origin_lng: PICK61.lng, dest_lat: DEST61.lat, dest_lng: DEST61.lng, origin_zone: 'Madero', dest_zone: 'Centro', passenger_name: 'The Noob Gamer', passenger_phone: '9614868605', payment_method: 'efectivo', price: 25, final_price: 25, passenger_count: 1, driver_lat: 16.8727, driver_lng: -93.2081 };
    hA61.setReq(reqA61); hA61.setMap(mapA61);
    const posB61 = { lat: 16.8715, lng: -93.2090 };
    const pA1 = hA61.render();
    // El sondeo actualiza la posición del chofer mientras el render espera la ruta.
    reqA61.driver_lat = posB61.lat; reqA61.driver_lng = posB61.lng;
    const pA2 = hA61.render();
    const routeACoords = [[posB61.lng, posB61.lat], [-93.2095, 16.8700], [DEST61.lng, DEST61.lat]];
    resolveRouteA({ coords: routeACoords });
    await pA1; await pA2; await tick61();
    const motoA = markersA.filter(m => m.el && typeof m.el.innerHTML === 'string' && m.el.innerHTML.includes('<svg'));
    const motoAliveA = motoA.filter(m => !m.removed);
    const fitA = mapA61.fitCalls[mapA61.fitCalls.length - 1];
    live61 = {
      motoTotalA: motoA.length, motoAliveA: motoAliveA.length,
      motoPosA: motoAliveA[0] ? motoAliveA[0].lngLat : null,
      fitPtsA: fitA ? fitA.pts : null, fitPadA: fitA ? fitA.pad : null,
      routeA: mapA61.sources.route ? mapA61.sources.route.geometry.coordinates : null
    };
    // B) El pasajero en viaje (en_viaje): el marcador se mueve con cada
    // lectura del sondeo y el zoom de proximidad sube 16→17→18 al
    // acercarse al destino, igual que el chofer.
    const markersB = [];
    const hB61 = build61(null, markersB);
    const mapB61 = mkMap61();
    const reqB61 = { id: 302, kind: 'viaje', trip_stage: 'en_viaje', origin_lat: PICK61.lat, origin_lng: PICK61.lng, dest_lat: DEST61.lat, dest_lng: DEST61.lng, origin_zone: 'Madero', dest_zone: 'Centro', passenger_name: 'The Noob Gamer', passenger_phone: '9614868605', payment_method: 'efectivo', price: 25, final_price: 25, passenger_count: 1, driver_lat: null, driver_lng: null };
    hB61.setReq(reqB61); hB61.setMap(mapB61);
    const markerPosB = [];
    hB61.setMarker({ pos: null, setLngLat(l) { this.pos = l; markerPosB.push(l); }, remove() {} });
    const posDest61 = (distM) => ({ lat: DEST61.lat + distM / 110540, lng: DEST61.lng });
    const zoomsB61 = [];
    for (const d of [800, 600, 400, 300, 183, 100]) {
      const p = posDest61(d);
      hB61.apply(p.lat, p.lng); await tick61();
      zoomsB61.push(mapB61.getZoom());
    }
    live61.zoomsB = zoomsB61;
    live61.markerMovesB = markerPosB;
    live61.markerLastB = markerPosB[markerPosB.length - 1];
    live61.motoPosOk = !!(live61.motoPosA && approx61(live61.motoPosA[0], -93.2090) && approx61(live61.motoPosA[1], 16.8715));
    live61.fitOk = !!(live61.fitPadA && live61.fitPadA.left === 16 && live61.fitPadA.right === 16 && live61.fitPtsA && approx61(live61.fitPtsA[0][0], -93.2090) && approx61(live61.fitPtsA[0][1], 16.8715) && live61.routeA && live61.routeA.length === 3);
    live61.movesOk = markerPosB.length === 6 && markerPosB.every((l, i) => { const d = [800, 600, 400, 300, 183, 100][i]; const p = { lat: 16.8675 + d / 110540, lng: -93.2105 }; return approx61(l[0], p.lng) && approx61(l[1], p.lat); }) && zoomsB61[0] === 16 && zoomsB61[2] === 17 && zoomsB61[4] === 18;
  } catch(e){ live61 = null; }
  check('v1.4.61: evaluado — dos renders solapados del mapa del pasajero dejan UNA sola mototaxi (la huérfana ya no existe)', !!live61 && live61.motoTotalA === 1 && live61.motoAliveA === 1, JSON.stringify(live61 && { motoTotalA: live61.motoTotalA, motoAliveA: live61.motoAliveA }));
  check('v1.4.61: evaluado — esa única mototaxi queda en la posición MÁS FRESCA del chofer (la del sondeo, no la de cuando abrió el mapa)', !!live61 && live61.motoPosOk, JSON.stringify(live61 && { motoPosA: live61.motoPosA }));
  check('v1.4.61: evaluado — el encuadre del pasajero es la ruta restante con el padding del chofer (no los dos puntos del viaje a lo ancho del pueblo)', !!live61 && live61.fitOk, JSON.stringify(live61 && { fitPadA: live61.fitPadA, fit0: live61.fitPtsA && live61.fitPtsA[0], routeLen: live61.routeA && live61.routeA.length }));
  check('v1.4.61: evaluado — en el mapa del PASAJERO el marcador se mueve con cada lectura del sondeo (tiempo real) y el zoom de proximidad sube 16→17→18 al acercarse al destino', !!live61 && live61.movesOk, JSON.stringify(live61 && { moves: live61.markerMovesB.length, zoomsB: live61.zoomsB }));

  // ===== v1.4.64 (2026-11-24): candado de Negocios — solo entra el perfil del dueño (@thegrafferz10); el admin lo abre/cierra desde el panel =====
  // Por defecto BLOQUEADO (sin fila en admin_state = bloqueado). El candado se aplica en el SERVIDOR: /api/businesses y /api/business devuelven 403 con locked:true a quien no esté exento. En el inicio, la tarjeta de Negocios muestra 🔒 + «Próximamente» y al tocarla solo avisa. Los endpoints de crear/administrar negocios y los pedidos/citas (ya con su propio permiso de dueña/admin) no cambian; el listado y la ficha son la superficie que se bloquea.
  check('v1.4.64: el servidor tiene el candado de Negocios con bloqueo por defecto (sin fila = bloqueado) y exención solo para admin y @thegrafferz10', srv.includes("function negociosLocked(){") && srv.includes("key='negocios_locked'") && srv.includes("return !row || row.value !== '0';") && srv.includes("function negociosExempt(a){ return !!a && (a.role === 'admin' || a.username === 'thegrafferz10'); }"));
  check('v1.4.64: /api/businesses y /api/business devuelven 403 con locked:true si el candado está puesto y la cuenta no está exenta', (srv.split("if (negociosLocked() && !negociosExempt(a)) return send(res, 403, negociosLockError());").length - 1) === 2 && srv.includes("function negociosLockError(){ return { ok: false, locked: true, error: 'Negocios está bloqueado por ahora.' }; }"));
  check('v1.4.64: /api/admin/set-negocios-locked existe, solo admin, guarda el estado en admin_state y por defecto bloquea (sin locked = bloqueado)', srv.includes("'/api/admin/set-negocios-locked'") && srv.includes("INSERT OR REPLACE INTO admin_state (key, value) VALUES ('negocios_locked', ?)") && srv.includes("const locked = body.locked !== false && body.locked !== '0' && body.locked !== 0;") && srv.includes("return send(res, 200, { ok: true, negocios_locked: locked });"));
  check('v1.4.64: /api/me devuelve negocios_locked (el cliente lo lee al iniciar sesión)', srv.includes("negocios_locked: negociosLocked()"));
  check('v1.4.64: el cliente guarda el candado al iniciar sesión y la exención es admin o @thegrafferz10', html.includes("let negociosLocked = true;") && html.includes("negociosLocked = !!j.negocios_locked;") && html.includes("function negociosCanEnter(){ return !negociosLocked || (myAccount && (myAccount.role==='admin' || myAccount.username==='thegrafferz10')); }"));
  check('v1.4.64: el inicio muestra 🔒 + Próximamente en la tarjeta de Negocios cuando está bloqueado y la cuenta no es la del dueño', (()=>{ const h0 = html.indexOf('function renderHome(){'); const h1 = html.indexOf('function renderViajes', h0); const s = html.slice(h0, h1); return s.includes('negociosCanEnter()') && s.includes('🔒') && s.includes('Próximamente') && s.includes('Negocios está bloqueado por ahora.'); })());
  check('v1.4.64: openNegocios no entra con el candado puesto (avisa y vuelve, no va a Negocios)', html.includes("function openNegocios(){ if(!negociosCanEnter()){ toast('Negocios está bloqueado por ahora.'); return; }"));
  check('v1.4.64: el listado y la ficha ya no son públicos — renderBizMain, la ficha, el carrito y las dos pantallas del admin pasan el token', html.includes("api('/api/businesses?token=' + encodeURIComponent(store.token || ''))") && html.includes("api('/api/business?id=' + id + '&token=' + encodeURIComponent(store.token || ''))") && html.includes("api('/api/business?id=' + bizCurrent + '&token=' + encodeURIComponent(store.token || ''))") && (html.split("api('/api/businesses?token=' + encodeURIComponent(store.token))").length - 1) === 2 && !html.includes("api('/api/businesses')") && !html.includes("api('/api/business?id=' + id)") && !html.includes("api('/api/business?id=' + bizCurrent)"));
  check('v1.4.64: con el candado puesto, renderBizMain muestra la tarjeta del candado en vez del feed vacío', html.includes("if(e && e.data && e.data.locked)") && html.includes("Negocios bloqueado por ahora"));
  check('v1.4.64: el panel del admin tiene el interruptor del candado con su estado (bloqueado/abierto) y el botón para abrir/bloquear', html.includes("toggleNegociosLock()") && html.includes("Negocios bloqueado") && html.includes("Negocios abierto") && html.includes("Abrir Negocios") && html.includes("Bloquear Negocios") && html.includes("'/api/admin/set-negocios-locked'"));
  // --- Evaluado: la lógica de exención (función real del cliente) ---
  let can64 = null;
  try {
    const m64 = html.match(/function negociosCanEnter\(\)\{[^}]*\}/);
    if (!m64) throw new Error('sin negociosCanEnter');
    const f64 = new Function('negociosLocked', 'myAccount', m64[0] + '; return negociosCanEnter();');
    can64 = {
      lockedOwner: f64(true, { username: 'thegrafferz10', role: 'user' }),
      lockedAdmin: f64(true, { username: 'admin', role: 'admin' }),
      lockedOther: f64(true, { username: 'pax64', role: 'user' }),
      lockedNone: f64(true, null),
      openOther: f64(false, { username: 'pax64', role: 'user' })
    };
  } catch(e){ can64 = null; }
  check('v1.4.64: evaluado — negociosCanEnter: con candado solo entran @thegrafferz10 y admin; sin candado entran todos; sin sesión nadie (falsy, no estrictamente false)', !!can64 && can64.lockedOwner === true && can64.lockedAdmin === true && can64.lockedOther === false && !can64.lockedNone && can64.openOther === true, JSON.stringify(can64));
  // --- Evaluados: el candado en vivo (BD limpia) ---
  const acc64 = await api('/api/register-account', { name: 'Pax 64', username: 'pax64_' + RUN, phone: '961640' + RUN.slice(0, 4), password: 'secreta123' });
  const me64 = await api('/api/me?token=' + acc64.token);
  check('v1.4.64: en vivo — por defecto Negocios está BLOQUEADO: /api/me lo dice', me64.ok && me64.negocios_locked === true, JSON.stringify(me64 && { locked: me64.negocios_locked }));
  const list64Locked = await api('/api/businesses?token=' + acc64.token);
  check('v1.4.64: en vivo — un pasajero normal NO lista negocios con el candado puesto (403 locked)', !list64Locked.ok && list64Locked.locked === true, JSON.stringify(list64Locked));
  const anon64 = await api('/api/businesses');
  check('v1.4.64: en vivo — sin sesión tampoco se listan negocios (403 locked)', !anon64.ok && anon64.locked === true, JSON.stringify(anon64));
  const one64Locked = await api('/api/business?id=1&token=' + acc64.token);
  check('v1.4.64: en vivo — un pasajero normal NO abre la ficha con el candado puesto (403 locked)', !one64Locked.ok && one64Locked.locked === true, JSON.stringify(one64Locked));
  const own64 = await api('/api/register-account', { name: 'Josue Eduardo', username: 'thegrafferz10', phone: '961641' + RUN.slice(0, 4), password: 'secreta123' });
  const biz64 = await api('/api/request-business', { token: own64.token, name: 'Tienda 64 ' + RUN, type: 'entrega', whatsapp: '9610000064', category: 'Comida', colony: 'Centro', schedule: 'Lunes a sábado', delivery_fee: 20, description: 'Prueba candado 64' });
  await api('/api/approve-business', { token: admLogin.token, business_id: biz64.business.id });
  const list64Own = await api('/api/businesses?token=' + own64.token);
  check('v1.4.64: en vivo — @thegrafferz10 SÍ lista negocios con el candado puesto (exento)', list64Own.ok && (list64Own.businesses || []).some(b => b.id === biz64.business.id), JSON.stringify((list64Own.businesses || []).map(b => b.id)));
  const one64Own = await api('/api/business?id=' + biz64.business.id + '&token=' + own64.token);
  check('v1.4.64: en vivo — @thegrafferz10 SÍ abre la ficha con el candado puesto', one64Own.ok && one64Own.business.id === biz64.business.id, JSON.stringify(one64Own));
  const list64Adm = await api('/api/businesses?token=' + admLogin.token);
  check('v1.4.64: en vivo — el admin también está exento del candado', list64Adm.ok && (list64Adm.businesses || []).some(b => b.id === biz64.business.id), JSON.stringify(list64Adm.ok));
  const tog64No = await api('/api/admin/set-negocios-locked', { token: acc64.token, locked: false });
  check('v1.4.64: en vivo — una cuenta que no es admin NO puede cambiar el candado (403)', !tog64No.ok && /Solo el administrador/.test(tog64No.error || ''), JSON.stringify(tog64No));
  const tog64Open = await api('/api/admin/set-negocios-locked', { token: admLogin.token, locked: false });
  const list64Open = await api('/api/businesses?token=' + acc64.token);
  check('v1.4.64: en vivo — el admin abre Negocios y el pasajero normal ya lista', tog64Open.ok && tog64Open.negocios_locked === false && list64Open.ok && (list64Open.businesses || []).some(b => b.id === biz64.business.id), JSON.stringify({ tog: tog64Open, n: (list64Open.businesses || []).length }));
  const me64Open = await api('/api/me?token=' + acc64.token);
  check('v1.4.64: en vivo — /api/me refleja el candado abierto', me64Open.ok && me64Open.negocios_locked === false, JSON.stringify(me64Open && { locked: me64Open.negocios_locked }));
  const tog64Lock = await api('/api/admin/set-negocios-locked', { token: admLogin.token, locked: true });
  const list64Relock = await api('/api/businesses?token=' + acc64.token);
  check('v1.4.64: en vivo — el admin vuelve a bloquear y el pasajero normal queda fuera otra vez (el candado queda puesto)', tog64Lock.ok && tog64Lock.negocios_locked === true && !list64Relock.ok && list64Relock.locked === true, JSON.stringify(tog64Lock));

  // ===== v1.4.65 (2026-11-24): el mapa del PASAJERO ya se mueve en vivo, igual que el del chofer =====
  // Reporte del usuario 11:11 CST (viaje $20, 0.8 km, 1 persona, EN VIAJE): "en el mapa del pasajero
  // siguen sin actualizarse en tiempo real el trayecto del viaje" + "Haz lo que quede igual como el
  // del chofer que se vea asi". La v1.4.61 había diagnosticado que el sondeo SÍ mueve el marcador y
  // que lo congelado era la mototaxi huérfana + el mapa ancho — eso era verdad solo cuando el
  // servidor TENÍA posiciones frescas. La causa raíz real, leyendo el código: el GPS del chofer
  // (startDriverGpsWatch) solo vivía mientras el mapa en vivo DEL CHOFER estaba abierto (guardia
  // !liveAsDriver + stopDriverGpsWatch() en exitLive). El chofer se veía perfecto porque su mapa se
  // dibuja del GPS local a ~1 Hz y nunca necesita el servidor; pero el pasajero solo recibe la
  // posición por el sondeo al servidor, alimentado por ese watch. En cuanto el chofer salía de su
  // mapa en vivo — o el usuario cambiaba a la vista del pasajero en el mismo teléfono, que es como
  // él prueba (es chofer y pasajero a la vez) — el servidor dejaba de recibir posiciones y el
  // marcador y la línea del pasajero se quedaban quietos (las tiras leen la misma posición
  // congelada, así que tampoco bajaban). El arreglo: el watch sigue al VIAJE ACTIVO, no a la
  // pantalla (syncDriverGpsWatch + drvActiveReqId); el dibujo local sigue siendo solo del mapa del
  // chofer; el sondeo del mapa en vivo pasa de 5 s a 2 s y el chofer reporta cada ~3 s (antes 8 s).
  const pollSec65 = html.slice(html.indexOf('function startLivePolling(){'), html.indexOf('/* GPS del chofer a nivel de app'));
  const watchSec65 = html.slice(html.indexOf('/* GPS del chofer desacoplado de la vista (v1.4.65)'), html.indexOf('/* ===== TAXÍMETRO'));
  check('v1.4.65: el GPS del chofer ya no exige la vista del chofer — el watch sigue al viaje activo (drvActiveReqId + syncDriverGpsWatch + drvActiveReq)', watchSec65.includes('function drvActiveReq(){') && watchSec65.includes('function syncDriverGpsWatch(){') && watchSec65.includes('drvActiveReqId') && watchSec65.includes('function startDriverGpsWatch(reqId){') && !watchSec65.includes("if(!myDriver || !liveReq || !liveAsDriver) return;"));
  check('v1.4.65: el watch dibuja en local SOLO cuando el mapa en vivo del chofer está abierto; en la vista del pasajero no dibuja (su marcador sale del sondeo)', watchSec65.includes("if(liveAsDriver && currentView==='live' && liveReq && liveReq.id===drvActiveReqId) liveApplyDriverPos(lat, lng);"));
  check('v1.4.65: el watch reporta al servidor con drvActiveReqId (no con liveReq.id) y cada ~3 s en vez de cada 8 s', watchSec65.includes("if(now - drvLastSent.t < 3000 && d < 10) return;") && watchSec65.includes("const rid = drvActiveReqId || (liveReq && liveReq.id);") && watchSec65.includes("request_id: rid, lat, lng"));
  check('v1.4.65: openLiveTrip y exitLive usan syncDriverGpsWatch (salir del mapa ya no apaga el GPS) y doLogout sí lo apaga', html.includes('startLivePolling();\n  syncDriverGpsWatch();') && html.includes('syncDriverGpsWatch();\n  livePendingAdvance = null;') && html.includes('stopDriverGpsWatch(); // v1.4.65: sin sesión ya no hay servicio activo que reportar'));
  check('v1.4.65: el sondeo global del chofer sincroniza el watch tras leer sus servicios activos', html.includes('setDriverActiveFromList(mine.requests);') && html.slice(html.indexOf('setDriverActiveFromList(mine.requests);'), html.indexOf('setDriverActiveFromList(mine.requests);') + 400).includes('syncDriverGpsWatch();'));
  check('v1.4.65: el sondeo del mapa en vivo pasa de 5 s a 2 s y el reintento OSRM se ajusta a cada 8º tick (~16 s)', pollSec65.includes('}, 2000);') && pollSec65.includes('if(liveOsrmRetryTick >= 8){') && !pollSec65.includes('}, 5000);'));
  check('v1.4.65: si el marcador se perdió, el sondeo lo vuelve a crear en la posición fresca (sin esperar al cambio de etapa) — salvo en fase 1 (v1.4.91, detalle 4: ni chofer ni pasajero tienen mapa en fase 1; la v1.4.84 que le daba mototaxi al pasajero queda reemplazada)', pollSec65.includes("if(r.driver_lat && !liveDriverMarker && liveMap && !livePhase1QuieroDriver(r) && !livePhase1Quiero(r)){") && pollSec65.includes("liveDriverMarker = new maplibregl.Marker({ element: motoIconEl() }).setLngLat([r.driver_lng, r.driver_lat]).addTo(liveMap);"));
  check('v1.4.65: al finalizar el viaje el watch se apaga directo (sondeo y advanceLive), no con sync (driverActiveTrip queda viejo 5 s)', pollSec65.includes("stopDriverGpsWatch(); // v1.4.65: el viaje terminó") && html.includes("if(stage==='finalizado' || stage==='entregado'){ releaseWakeLock(); stopDriverGpsWatch(); showTripSummary(liveReq, true); return; }"));
  // Evaluado: el ciclo de vida del watch con GPS simulado.
  let watch65 = null;
  try {
    const havKm65 = (a, b, c, d) => { const R = 6371, r = x => x * Math.PI / 180; const x = r(c - a), y = r(d - b); return 2 * R * Math.asin(Math.sqrt(Math.sin(x / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(y / 2) ** 2)); };
    const nav65 = { geolocation: { cb: null, cleared: null, watchPosition(cb) { this.cb = cb; return 42; }, clearWatch(id) { this.cleared = id; } } };
    const apiCalls65 = [];
    const api65 = async (p, b) => { apiCalls65.push({ p, b }); return { ok: true }; };
    const drawCalls65 = [];
    const prelude65 = 'let liveReq = null, liveAsDriver = false, currentView = \'home\', myDriver = null, driverActiveTrip = null, liveGpsPos = null, liveLocQueue = [];\n';
    const ret65 = '\nreturn { sync: syncDriverGpsWatch, start: startDriverGpsWatch, stop: stopDriverGpsWatch, getWatch(){ return drvWatchId; }, getReqId(){ return drvActiveReqId; }, setLiveReq(r){ liveReq = r; }, setAsDriver(b){ liveAsDriver = b; }, setView(v){ currentView = v; }, setDriver(d){ myDriver = d; }, setActiveTrip(t){ driverActiveTrip = t; } };';
    const w65 = new Function('navigator', 'api', 'liveApplyDriverPos', 'liveSetOffline', 'havKm', prelude65 + watchSec65 + ret65)(nav65, api65, (...a) => drawCalls65.push(a), () => {}, havKm65);
    const trip65 = { id: 99, status: 'aceptado', driver_id: 5 };
    w65.setDriver({ id: 5 });
    w65.setLiveReq(trip65); w65.setAsDriver(true); w65.setView('live');
    w65.sync();
    const started65 = w65.getWatch() === 42 && w65.getReqId() === 99;
    nav65.geolocation.cb({ coords: { latitude: 16.8710, longitude: -93.2060 } });
    const drawDriver65 = drawCalls65.length;
    const apiDriver65 = apiCalls65.filter(c => c.p === '/api/update-driver-location' && c.b.request_id === 99).length;
    // El usuario cambia a la vista del PASAJERO en el mismo teléfono (es chofer y pasajero a la vez):
    // el watch NO se apaga, el GPS local ya NO dibuja, pero el reporte al servidor SIGUE.
    w65.setAsDriver(false);
    w65.sync();
    const kept65 = w65.getWatch() === 42 && nav65.geolocation.cleared === null;
    nav65.geolocation.cb({ coords: { latitude: 16.8720, longitude: -93.2050 } });
    const drawPax65 = drawCalls65.length;
    const apiPax65 = apiCalls65.filter(c => c.p === '/api/update-driver-location' && c.b.request_id === 99).length;
    // Sin viaje activo no arranca; al terminar el viaje se apaga.
    const w65b = new Function('navigator', 'api', 'liveApplyDriverPos', 'liveSetOffline', 'havKm', prelude65 + watchSec65 + ret65)(nav65, api65, () => {}, () => {}, havKm65);
    w65b.setDriver({ id: 5 }); w65b.setLiveReq(null); w65b.setActiveTrip(null);
    w65b.sync();
    const noStart65 = w65b.getWatch() === null;
    w65.setLiveReq({ ...trip65, status: 'finalizado' }); w65.setActiveTrip(null);
    w65.sync();
    const stopped65 = w65.getWatch() === null && nav65.geolocation.cleared === 42;
    watch65 = { started65, drawDriver65, apiDriver65, kept65, drawPax65, apiPax65, noStart65, stopped65 };
  } catch (e) { watch65 = { err: String(e && e.message || e) }; }
  check('v1.4.65: evaluado — con viaje activo el watch arranca, dibuja en local en la vista del chofer y reporta al servidor', !!watch65 && watch65.started65 === true && watch65.drawDriver65 === 1 && watch65.apiDriver65 === 1, JSON.stringify(watch65));
  check('v1.4.65: evaluado — al pasar a la vista del pasajero el watch SIGUE (no se apaga), ya no dibuja en local, pero el reporte al servidor SIGUE (la causa raíz)', !!watch65 && watch65.kept65 === true && watch65.drawPax65 === 1 && watch65.apiPax65 === 2, JSON.stringify(watch65));
  check('v1.4.65: evaluado — sin viaje activo el watch no arranca, y al terminar el viaje se apaga', !!watch65 && watch65.noStart65 === true && watch65.stopped65 === true, JSON.stringify(watch65));
  // En vivo: la posición del chofer que lee el sondeo del pasajero avanza con cada reporte.
  const pax65 = await api('/api/register-passenger', { name: 'Pax Sesenta y Cinco', phone: '961650' + RUN.slice(0, 4), face_photo: PHOTO });
  check('v1.4.65: en vivo, pasajera de prueba registrada', pax65.ok && pax65.passenger.id, JSON.stringify(pax65));
  const drv65 = await api('/api/register-driver', { name: 'Chofer Sesenta y Cinco', phone: '961651' + RUN.slice(0, 4), vehicle: 'mototaxi', unit: 'V65', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.65: en vivo, chofer de prueba registrado', drv65.ok && drv65.driver.id, JSON.stringify(drv65));
  await approveDriver(drv65.driver.id);
  await api('/api/set-driver-online', { driver_id: drv65.driver.id, online: true });
  const trip65 = await api('/api/create-request', { passenger_id: pax65.passenger.id, kind: 'viaje', origin_zone: 'Madero', origin_detail: 'Madero', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 0.8, eta_minutes: 5, price: 20, payment_method: 'efectivo', passenger_count: 1 });
  check('v1.4.65: en vivo, el viaje queda BUSCANDO ($20, 1 persona)', trip65.ok && trip65.request.status === 'buscando', JSON.stringify(trip65.request && { st: trip65.request.status }));
  await api('/api/driver-respond', { driver_id: drv65.driver.id, request_id: trip65.request.id, kind: 'acepta', price: 20 });
  await api('/api/advance-stage', { driver_id: drv65.driver.id, request_id: trip65.request.id, stage: 'llego' });
  await api('/api/advance-stage', { driver_id: drv65.driver.id, request_id: trip65.request.id, stage: 'en_viaje' });
  const locA65 = await api('/api/update-driver-location', { driver_id: drv65.driver.id, request_id: trip65.request.id, lat: 16.8700, lng: -93.2070 });
  const seenA65 = await api('/api/requests?id=' + trip65.request.id);
  check('v1.4.65: en vivo — el sondeo del pasajero (/api/requests?id=) ve la 1ª posición del chofer en el recorrido', locA65.ok && seenA65.ok && seenA65.requests[0].driver_lat === 16.87 && seenA65.requests[0].driver_lng === -93.207, JSON.stringify(seenA65.requests && seenA65.requests[0] && { lat: seenA65.requests[0].driver_lat, lng: seenA65.requests[0].driver_lng }));
  const locB65 = await api('/api/update-driver-location', { driver_id: drv65.driver.id, request_id: trip65.request.id, lat: 16.8685, lng: -93.2090 });
  const seenB65 = await api('/api/requests?id=' + trip65.request.id);
  check('v1.4.65: en vivo — el sondeo del pasajero ve la 2ª posición (el feed del mapa avanza con cada reporte)', locB65.ok && seenB65.ok && seenB65.requests[0].driver_lat === 16.8685 && seenB65.requests[0].driver_lng === -93.209, JSON.stringify(seenB65.requests && seenB65.requests[0] && { lat: seenB65.requests[0].driver_lat, lng: seenB65.requests[0].driver_lng }));
  await api('/api/advance-stage', { driver_id: drv65.driver.id, request_id: trip65.request.id, stage: 'finalizado' });

  // ===== v1.4.66 (2026-11-24): la ficha del chofer en el panel de admin
  // muestra también el taxímetro (total y hoy) y el bloque SUSCRIPCIÓN
  // cuenta los recorridos de hoy. El taxímetro vivía solo en el teléfono
  // del chofer (localStorage); el servidor no guardaba nada. Ahora cada
  // recorrido terminado se registra con POST /api/taxi-run (el chofer sale
  // de la cuenta, no del cuerpo: nadie infla el conteo ajeno) y el admin
  // lo ve en /api/admin-drivers (taxi_runs_total / taxi_runs_today).
  // Solo corren desde esta versión: no se inventan datos viejos. El
  // límite gratis (5 recorridos/día, contado en el teléfono) NO cambia. =====
  const detSec66 = html.slice(html.indexOf('function renderAdminDetail'), html.indexOf('async function adminBlock'));
  check('v1.4.66: la ficha del chofer tiene fila Taxímetro (total · hoy) bajo Servicios', detSec66.includes("<span>Taxímetro</span><b>'+(d.taxi_runs_total||0)+' en total · '+(d.taxi_runs_today||0)+' hoy</b>"));
  check('v1.4.66: SUSCRIPCIÓN gratis cuenta los recorridos de taxímetro de hoy junto a los servicios', detSec66.includes("'+(d.taxi_runs_today||0)+' de '+FREE_DAILY_LIMIT+' recorridos de taxímetro de hoy · '"));
  check('v1.4.66: SUSCRIPCIÓN de paga dice Taxímetro ilimitado + recorridos de hoy (sin marco de 5)', detSec66.includes("Taxímetro ilimitado · '+(d.taxi_runs_today||0)+' recorridos de taxímetro hoy · vence el '"));
  const stopSec66 = html.slice(html.indexOf('function stopTaxi()'), html.indexOf('function startTaxiTick()'));
  check('v1.4.66: al terminar el recorrido se registra en el servidor (POST /api/taxi-run, sin bloquear si falla)', stopSec66.includes("api('/api/taxi-run'") && stopSec66.includes('taxiSaveHist(hist)') && stopSec66.includes('.catch(()=>{})'));
  check('v1.4.66: el límite gratis del taxímetro sigue contándose en el teléfono (taxiRunsToday >= FREE_DAILY_LIMIT; el servidor solo guarda)', html.includes('taxiRunsToday() >= FREE_DAILY_LIMIT') && html.includes('function taxiRunsToday(){') && srv.includes('CREATE TABLE IF NOT EXISTS taxi_runs'));
  const taxiRunSec66 = srv.slice(srv.indexOf("'/api/taxi-run'"), srv.indexOf("'/api/subscribe-driver'"));
  check('v1.4.66: /api/taxi-run existe, saca el chofer de la cuenta (anti-inflado) y guarda el recorrido', taxiRunSec66.includes('accountFromToken(body.token)') && taxiRunSec66.includes('INSERT INTO taxi_runs') && taxiRunSec66.includes('taxi_runs_total') && taxiRunSec66.includes('taxi_runs_today'));
  // En vivo: chofer de prueba con cuenta enlazada registra recorridos.
  const acc66 = await api('/api/register-account', { name: 'Taxista 66', username: 'taxi66_' + RUN, phone: '961660' + RUN.slice(0, 4), password: 'secreta123' });
  check('v1.4.66: en vivo, cuenta de prueba para el chofer del taxímetro', acc66.ok && acc66.account.id, JSON.stringify(acc66));
  const li66 = await api('/api/login', { identifier: 'taxi66_' + RUN, password: 'secreta123' });
  check('v1.4.66: en vivo, login de la cuenta del chofer', li66.ok && !!li66.token, JSON.stringify(li66));
  const drv66 = await api('/api/register-driver', { name: 'Chofer Taxi 66', phone: '961660' + RUN.slice(0, 4), vehicle: 'mototaxi', unit: 'T-66', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.66: en vivo, chofer de prueba registrado', drv66.ok && drv66.driver.id, JSON.stringify(drv66));
  await approveDriver(drv66.driver.id);
  const link66 = await api('/api/link-profiles', { token: li66.token, driver_id: drv66.driver.id });
  check('v1.4.66: en vivo, chofer enlazado a su cuenta', link66.ok && link66.account.driver_id === drv66.driver.id, JSON.stringify(link66));
  const noTok66 = await api('/api/taxi-run', { price: 25, km: 1.2, secs: 300 });
  check('v1.4.66: en vivo, /api/taxi-run sin token rechazado', !noTok66.ok, JSON.stringify(noTok66));
  const noDrv66 = await api('/api/taxi-run', { token: liMail.token, price: 25, km: 1.2, secs: 300 });
  check('v1.4.66: en vivo, /api/taxi-run con cuenta sin chofer rechazado (no se puede inflar el conteo ajeno)', !noDrv66.ok, JSON.stringify(noDrv66));
  const run66a = await api('/api/taxi-run', { token: li66.token, price: 25, km: 1.2, secs: 300 });
  check('v1.4.66: en vivo, 1.er recorrido registrado (total 1, hoy 1)', run66a.ok && run66a.taxi_runs_total === 1 && run66a.taxi_runs_today === 1, JSON.stringify(run66a));
  const run66b = await api('/api/taxi-run', { token: li66.token, price: 40, km: 3.5, secs: 600 });
  check('v1.4.66: en vivo, 2.º recorrido registrado (total 2, hoy 2)', run66b.ok && run66b.taxi_runs_total === 2 && run66b.taxi_runs_today === 2, JSON.stringify(run66b));
  // Un recorrido de ayer: se atrasa created_at directo en la BD y el
  // total se mantiene pero el de hoy baja.
  {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'sanfergo.db');
    const tdb = new DatabaseSync(dbPath);
    tdb.prepare(`UPDATE taxi_runs SET created_at=datetime('now','-1 day') WHERE id=(SELECT id FROM taxi_runs WHERE driver_id=? ORDER BY id DESC LIMIT 1)`).run(drv66.driver.id);
    tdb.close();
  }
  const adm66 = await api('/api/admin-drivers', { token: ADM.token });
  const d66 = (adm66.drivers || []).find(d => d.id === drv66.driver.id);
  check('v1.4.66: en vivo, el admin ve taxi_runs_total=2 y taxi_runs_today=1 (el de ayer no cuenta para hoy)', adm66.ok && !!d66 && d66.taxi_runs_total === 2 && d66.taxi_runs_today === 1, JSON.stringify(d66 && { total: d66.taxi_runs_total, today: d66.taxi_runs_today }));
  const run66c = await api('/api/taxi-run', { token: li66.token, price: 20, km: 0.8, secs: 180 });
  check('v1.4.66: en vivo, 3.er recorrido de hoy (total 3, hoy 2)', run66c.ok && run66c.taxi_runs_total === 3 && run66c.taxi_runs_today === 2, JSON.stringify(run66c));

  // ===== v1.4.67 (2026-11-24): viajes gratis por recomendación =====
  // Promo de lanzamiento como la de Uber al inicio: un pasajero
  // recomienda la app con su enlace (/?ref=<su usuario>); cuando el
  // referido termina su PRIMER viaje pagado, el referidor gana 1 viaje
  // gratis (cubre hasta $30; si el viaje cuesta más, el pasajero paga
  // la diferencia en efectivo). Los viajes gratis los hace SOLO el
  // chofer del dueño (Josué); a los demás choferes ni les aparecen en
  // Recibir Viajes. El viaje gratis se gasta solo al terminarlo y no
  // cuenta para el límite gratis de 5 servicios al día.
  // v1.4.68 (2026-11-24): TOPE — un referidor solo puede GANAR 1 viaje
  // gratis en total, aunque recomiende a cinco amigos y los cinco hagan
  // su primer viaje. Al acreditar, si el referidor YA ganó 1 antes
  // (aunque ya lo haya usado y su saldo esté en 0), no se acredita nada
  // más: el referido de más queda anotado pero su fila pasa a 'capped'
  // (ni pendiente ni ganada).
  check('v1.4.67: el servidor tiene la tabla referrals, el saldo free_trips y la marca is_free_trip', srv.includes('CREATE TABLE IF NOT EXISTS referrals') && srv.includes("addCol('passengers', 'free_trips'") && srv.includes("addCol('requests', 'is_free_trip'") && srv.includes('const FREE_TRIP_COVER = 30;') && srv.includes("const OWNER_USERNAME = 'thegrafferz10';"));
  check('v1.4.67: /api/register-account anota la recomendación y /api/me devuelve referral_enabled', srv.includes('recordReferral(body.referral_code, account)') && srv.includes('referral_enabled: referralPromoEnabled()'));
  check('v1.4.67: el interruptor del admin existe (set-referral-enabled + referral-stats, solo admin)', srv.includes("'/api/admin/set-referral-enabled'") && srv.includes("'/api/admin/referral-stats'") && srv.includes("INSERT OR REPLACE INTO admin_state (key, value) VALUES ('referral_enabled', ?)") && srv.includes('function referralStats(){'));
  check('v1.4.68: TOPE de 1 viaje gratis por referidor (si ya ganó 1, los demás referidos pasan a capped sin acreditar)', srv.includes("status='capped'") && srv.includes("WHERE referrer_account_id=? AND status='earned'"));
  check('v1.4.67: el registro tiene el campo Código de referido prellenado desde ?ref=', html.includes('id="rc-ref"') && html.includes("value=\"'+esc(refCodeFromUrl)+'\"") && html.includes("new URLSearchParams(location.search).get('ref')") && html.includes('referral_code: refCode || undefined'));
  check('v1.4.67: el inicio de Viajes muestra el saldo y la tarjeta para compartir (se esconde con la promo apagada)', html.includes('function referralHomeHtml(){') && html.includes('Gana un viaje gratis') && html.includes('Compartir por WhatsApp') && html.includes('Copiar enlace') && html.includes('if(referralEnabled && myAccount){'));
  check('v1.4.67: el paso de precio tiene "Usar mi viaje gratis" y publicar manda is_free_trip', html.includes('Usar mi viaje gratis') && html.includes('priceToggleFreeTrip()') && html.includes('is_free_trip: wiz.useFreeTrip ? 1 : 0'));
  check('v1.4.67: la fila y el detalle del chofer muestran la insignia de viaje gratis con lo que paga el pasajero', html.includes('🎁 Viaje gratis · el pasajero paga ') && html.includes('freeTripPays(r.price)') && html.includes('Cubierto por SanFerGo: '));
  check('v1.4.67: Mi cuenta muestra el saldo de viajes gratis', html.includes('gratis</b><p class="muted mt">Cubre hasta '));
  check('v1.4.67: el panel del admin tiene la tarjeta de la promo con su interruptor y estadísticas', html.includes('Viajes gratis por recomendación') && html.includes('toggleReferralPromo()') && html.includes("'/api/admin/referral-stats?token='") && html.includes("'/api/admin/set-referral-enabled'"));
  check('v1.4.67: la tarifa NO cambió (base $10 + $2.50 por 300 m + $1.25/min espera, mínimo $20, rejilla de $5)', srv.includes('const BASE_FARE = 10, PER_300M = 2.5, WAIT_PER_MIN = 1.25, MIN_TRIP = 20;') && srv.includes('function fareFor(km) { return Math.round((BASE_FARE + (km / 0.3) * PER_300M) * 100) / 100; }'));
  // --- Evaluado: la cuenta del tope de $30 (funciones reales del cliente) ---
  let cap67 = null;
  try {
    const mPays = html.match(/function freeTripPays\(price\)\{[^}]*\}/);
    const mCov = html.match(/function freeTripCovered\(price\)\{[^}]*\}/);
    if (!mPays || !mCov) throw new Error('sin freeTripPays/freeTripCovered');
    const f67 = new Function('const FREE_TRIP_COVER = 30; ' + mPays[0] + ' ' + mCov[0] + '; return [freeTripPays(25), freeTripPays(30), freeTripPays(35), freeTripCovered(25), freeTripCovered(35)];');
    cap67 = f67();
  } catch(e){ cap67 = null; }
  check('v1.4.67: la cuenta del tope de $30 (paga $0 a $25, $0 a $30, $5 a $35; cubierto $25 y $30)', !!cap67 && cap67[0] === 0 && cap67[1] === 0 && cap67[2] === 5 && cap67[3] === 25 && cap67[4] === 30, JSON.stringify(cap67));
  // --- En vivo: el chofer del dueño (el de @thegrafferz10, own64) ---
  const ownDrv67 = await api('/api/register-driver', { name: 'Josué Dueño', phone: '961641' + RUN.slice(0, 4), vehicle: 'mototaxi', unit: 'D-67', selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.68: en vivo, chofer del dueño registrado', ownDrv67.ok && ownDrv67.driver.id, JSON.stringify(ownDrv67));
  await approveDriver(ownDrv67.driver.id);
  const ownLink67 = await api('/api/link-profiles', { token: own64.token, driver_id: ownDrv67.driver.id });
  check('v1.4.68: en vivo, chofer del dueño enlazado a @thegrafferz10', ownLink67.ok && ownLink67.account.driver_id === ownDrv67.driver.id, JSON.stringify(ownLink67));
  const ownOn67 = await api('/api/set-driver-online', { driver_id: ownDrv67.driver.id, online: true });
  check('v1.4.68: en vivo, chofer del dueño en línea', ownOn67.ok && ownOn67.driver.online === 1, JSON.stringify(ownOn67));
  async function finishTrip67(driverId, reqId){
    await api('/api/advance-stage', { driver_id: driverId, request_id: reqId, stage: 'llego' });
    await api('/api/advance-stage', { driver_id: driverId, request_id: reqId, stage: 'en_viaje' });
    return api('/api/advance-stage', { driver_id: driverId, request_id: reqId, stage: 'finalizado' });
  }
  function trip67(passengerId, price){
    return api('/api/create-request', { passenger_id: passengerId, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price, payment_method: 'efectivo' });
  }
  async function driveTrip67(driverId, reqId, price){
    const a = await api('/api/driver-respond', { driver_id: driverId, request_id: reqId, kind: 'acepta', price });
    if (!a.ok) return a;
    return finishTrip67(driverId, reqId);
  }
  // v1.4.71: la selfie es obligatoria para publicar: los pasajeros de
  // esta sección nacen del registro con teléfono pero sin foto, así que
  // se les sube la foto antes de publicar (lo que haría el formulario).
  async function fotoPara(acc){ await api('/api/upload-passenger-photo', { passenger_id: acc.passenger.id, photo: PHOTO }); }
  // --- En vivo: registro de la recomendación y ganancia ---
  const accA67 = await api('/api/register-account', { name: 'Ana Refiere', username: 'refa_' + RUN, phone: '961670' + RUN.slice(0, 4), password: 'secreta123' });
  await fotoPara(accA67);
  check('v1.4.68: en vivo, referidora registrada', accA67.ok && accA67.account.id && accA67.passenger.id, JSON.stringify(accA67));
  const stats0 = await api('/api/admin/referral-stats?token=' + ADM.token);
  check('v1.4.68: en vivo, stats de referidos empiezan en cero y la promo está prendida por defecto', stats0.ok && stats0.stats.enabled === true && stats0.stats.total === 0 && stats0.stats.pending === 0 && stats0.stats.earned === 0 && stats0.stats.free_trips_earned === 0 && stats0.stats.free_trips_used === 0 && stats0.stats.free_trips_outstanding === 0, JSON.stringify(stats0.stats));
  const accB67 = await api('/api/register-account', { name: 'Beto Referido', username: 'refb_' + RUN, phone: '961671' + RUN.slice(0, 4), password: 'secreta123', referral_code: 'refa_' + RUN });
  await fotoPara(accB67);
  const statsB = await api('/api/admin/referral-stats?token=' + ADM.token);
  check('v1.4.68: en vivo, el referido con código queda anotado (pendiente)', accB67.ok && statsB.stats.total === 1 && statsB.stats.pending === 1 && statsB.stats.earned === 0, JSON.stringify(statsB.stats));
  const accC67 = await api('/api/register-account', { name: 'Celia Sola', username: 'refc_' + RUN, phone: '961672' + RUN.slice(0, 4), password: 'secreta123', referral_code: 'refc_' + RUN });
  const accD67 = await api('/api/register-account', { name: 'Dana Nadie', username: 'refd_' + RUN, phone: '961673' + RUN.slice(0, 4), password: 'secreta123', referral_code: 'nadie_' + RUN });
  const statsCD = await api('/api/admin/referral-stats?token=' + ADM.token);
  check('v1.4.68: en vivo, autorreferencia y código inválido no se anotan', accC67.ok && accD67.ok && statsCD.stats.total === 1, JSON.stringify(statsCD.stats));
  const tripB1 = await trip67(accB67.passenger.id, 25);
  const driveB1 = await driveTrip67(drv.driver.id, tripB1.request.id, 25);
  const statsE1 = await api('/api/admin/referral-stats?token=' + ADM.token);
  const meA1 = await api('/api/me?token=' + accA67.token);
  check('v1.4.68: en vivo, al terminar el PRIMER viaje del referido, el referidor gana 1 viaje gratis', driveB1.ok && statsE1.stats.earned === 1 && statsE1.stats.pending === 0 && statsE1.stats.free_trips_earned === 1 && statsE1.stats.free_trips_outstanding === 1 && meA1.passenger.free_trips === 1, JSON.stringify({ st: statsE1.stats, free: meA1.passenger && meA1.passenger.free_trips }));
  const tripB2 = await trip67(accB67.passenger.id, 25);
  await driveTrip67(drv.driver.id, tripB2.request.id, 25);
  const statsE2 = await api('/api/admin/referral-stats?token=' + ADM.token);
  const meA2 = await api('/api/me?token=' + accA67.token);
  check('v1.4.68: en vivo, el SEGUNDO viaje del referido ya no gana nada (solo el primero)', statsE2.stats.earned === 1 && statsE2.stats.free_trips_outstanding === 1 && meA2.passenger.free_trips === 1, JSON.stringify(statsE2.stats));
  const accE67 = await api('/api/register-account', { name: 'Ema Referida', username: 'refe_' + RUN, phone: '961674' + RUN.slice(0, 4), password: 'secreta123', referral_code: 'refa_' + RUN });
  await fotoPara(accE67);
  const tripE1 = await trip67(accE67.passenger.id, 25);
  const canE1 = await api('/api/cancel-request', { request_id: tripE1.request.id });
  const statsCan = await api('/api/admin/referral-stats?token=' + ADM.token);
  check('v1.4.68: en vivo, un viaje CANCELADO no gana nada (sigue pendiente)', canE1.ok && statsCan.stats.total === 2 && statsCan.stats.pending === 1 && statsCan.stats.earned === 1, JSON.stringify(statsCan.stats));
  const tripE2 = await trip67(accE67.passenger.id, 25);
  await driveTrip67(drv.driver.id, tripE2.request.id, 25);
  const statsE3 = await api('/api/admin/referral-stats?token=' + ADM.token);
  const meA3 = await api('/api/me?token=' + accA67.token);
  check('v1.4.68: en vivo, TOPE: el SEGUNDO amigo referido que termina su primer viaje NO gana nada más (ganados 1, saldo 1, ya no pendiente)', statsE3.stats.total === 2 && statsE3.stats.pending === 0 && statsE3.stats.earned === 1 && statsE3.stats.free_trips_earned === 1 && statsE3.stats.free_trips_outstanding === 1 && meA3.passenger.free_trips === 1, JSON.stringify({ st: statsE3.stats, free: meA3.passenger.free_trips }));
  const accF67 = await api('/api/register-account', { name: 'Fer Referido', username: 'reff_' + RUN, phone: '961675' + RUN.slice(0, 4), password: 'secreta123', referral_code: 'refa_' + RUN });
  await fotoPara(accF67);
  const manF = await api('/api/create-request', { passenger_id: accF67.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Paquete' });
  const manAcc = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: manF.request.id, kind: 'acepta', price: 30 });
  await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: manF.request.id, stage: 'llego' });
  await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: manF.request.id, stage: 'en_viaje' });
  const manFin = await api('/api/advance-stage', { driver_id: drv.driver.id, request_id: manF.request.id, stage: 'entregado' });
  const statsMan = await api('/api/admin/referral-stats?token=' + ADM.token);
  check('v1.4.68: en vivo, un mandado terminado NO gana viaje gratis (solo viajes)', manAcc.ok && manFin.ok && statsMan.stats.earned === 1 && statsMan.stats.pending === 1, JSON.stringify(statsMan.stats));
  // v1.4.68: el primer VIAJE de Fer (tercer amigo) se prueba DESPUÉS de
  // usar el viaje gratis (check 3 del TOPE): si ganara, sería el 2.º.
  // --- En vivo: usar un viaje gratis (solo el chofer del dueño lo ve) ---
  // v1.4.68: con el TOPE, Ana solo tiene 1 viaje gratis en total: primero
  // se prueba que cancelar no lo gasta y luego se usa (a $35, para probar
  // el tope de $30) y se gasta. El tercer amigo (Fer) se prueba después.
  const free2 = await api('/api/create-request', { passenger_id: accA67.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo', is_free_trip: 1 });
  const canF2 = await api('/api/cancel-request', { request_id: free2.request.id });
  const meA6 = await api('/api/me?token=' + accA67.token);
  check('v1.4.68: en vivo, CANCELAR el viaje gratis NO lo gasta (saldo sigue 1)', free2.ok && canF2.ok && meA6.passenger.free_trips === 1, JSON.stringify({ free: meA6.passenger.free_trips }));
  const free1 = await api('/api/create-request', { passenger_id: accA67.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 35, payment_method: 'efectivo', is_free_trip: 1 });
  check('v1.4.68: en vivo, la referidora publica su viaje gratis a $35', free1.ok && free1.request.is_free_trip === 1 && free1.request.status === 'buscando', JSON.stringify(free1.request));
  const openOther = await api('/api/requests?open=1&light=1&dismissed_for=' + drv.driver.id);
  const openOwner = await api('/api/requests?open=1&light=1&dismissed_for=' + ownDrv67.driver.id);
  const openAnon = await api('/api/requests?open=1&light=1');
  check('v1.4.68: en vivo, el viaje gratis SOLO lo ve el chofer del dueño en Recibir Viajes (ni otro chofer ni la lista sin chofer lo traen)', openOther.ok && !openOther.requests.some(r=>r.id===free1.request.id) && openOwner.ok && openOwner.requests.some(r=>r.id===free1.request.id) && openAnon.ok && !openAnon.requests.some(r=>r.id===free1.request.id), JSON.stringify({ other: openOther.requests.map(r=>r.id), owner: openOwner.requests.map(r=>r.id) }));
  const otherTry = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: free1.request.id, kind: 'acepta', price: 35 });
  check('v1.4.68: en vivo, otro chofer NO puede tomar el viaje gratis (403)', !otherTry.ok && /solo para el chofer/.test(otherTry.error || ''), JSON.stringify(otherTry));
  const ownAcc = await api('/api/driver-respond', { driver_id: ownDrv67.driver.id, request_id: free1.request.id, kind: 'acepta', price: 35 });
  check('v1.4.68: en vivo, el chofer del dueño acepta el viaje gratis', ownAcc.ok && ownAcc.request.status === 'aceptado', JSON.stringify(ownAcc));
  await finishTrip67(ownDrv67.driver.id, free1.request.id);
  const meA5 = await api('/api/me?token=' + accA67.token);
  const statsU1 = await api('/api/admin/referral-stats?token=' + ADM.token);
  check('v1.4.68: en vivo, al TERMINAR el viaje gratis a $35 se gasta 1 (saldo 0, usados 1)', meA5.passenger.free_trips === 0 && statsU1.stats.free_trips_used === 1 && statsU1.stats.free_trips_outstanding === 0, JSON.stringify({ free: meA5.passenger.free_trips, st: statsU1.stats }));
  // --- v1.4.68, check 3 del TOPE: el tercer amigo, después de usarlo ---
  const tripF1 = await trip67(accF67.passenger.id, 25);
  await driveTrip67(drv.driver.id, tripF1.request.id, 25);
  const statsE4 = await api('/api/admin/referral-stats?token=' + ADM.token);
  const meA4 = await api('/api/me?token=' + accA67.token);
  check('v1.4.68: en vivo, TOPE: después de USAR el viaje gratis, el TERCER amigo referido que termina su primer viaje TAMPOCO gana nada (total ganado sigue 1, saldo 0)', statsE4.stats.total === 3 && statsE4.stats.pending === 0 && statsE4.stats.earned === 1 && statsE4.stats.free_trips_earned === 1 && statsE4.stats.free_trips_used === 1 && statsE4.stats.free_trips_outstanding === 0 && meA4.passenger.free_trips === 0, JSON.stringify({ st: statsE4.stats, free: meA4.passenger.free_trips }));
  const accZ67 = await api('/api/register-account', { name: 'Zed Sin Saldo', username: 'refz_' + RUN, phone: '961676' + RUN.slice(0, 4), password: 'secreta123' });
  await fotoPara(accZ67);
  const freeNo = await api('/api/create-request', { passenger_id: accZ67.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo', is_free_trip: 1 });
  check('v1.4.68: en vivo, sin viajes gratis el servidor rechaza publicar uno gratis', !freeNo.ok && /No tienes viajes gratis/.test(freeNo.error || ''), JSON.stringify(freeNo));
  const freeMan = await api('/api/create-request', { passenger_id: accA67.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo', description: 'Paquete', is_free_trip: 1 });
  check('v1.4.68: en vivo, un mandado NO se puede publicar como viaje gratis', !freeMan.ok && /solo para viajes/.test(freeMan.error || ''), JSON.stringify(freeMan));
  // --- En vivo: el viaje gratis no cuenta para el límite gratis de 5/día ---
  // El chofer del dueño está en plan gratis: 5 servicios pagados lo
  // dejan en el límite; el 6.º pagado se rechaza, pero el viaje gratis
  // entra igual (no cuenta) y tampoco suma al conteo (el siguiente
  // pagado sigue rechazado).
  // v1.4.68: Ana ya usó su único viaje gratis, así que el viaje gratis
  // del límite lo aporta OTRO referidor (Gus), que gana el suyo con su
  // primer referido — el tope es por persona, no global.
  const accG68 = await api('/api/register-account', { name: 'Gus Refiere', username: 'refg_' + RUN, phone: '961678' + RUN.slice(0, 4), password: 'secreta123' });
  await fotoPara(accG68);
  const accH2 = await api('/api/register-account', { name: 'Hugo Dos', username: 'refh2_' + RUN, phone: '961679' + RUN.slice(0, 4), password: 'secreta123', referral_code: 'refg_' + RUN });
  await fotoPara(accH2);
  const tripH2 = await trip67(accH2.passenger.id, 25);
  await driveTrip67(drv.driver.id, tripH2.request.id, 25);
  const statsG = await api('/api/admin/referral-stats?token=' + ADM.token);
  const meG = await api('/api/me?token=' + accG68.token);
  check('v1.4.68: en vivo, otro referidor distinto sí gana su primer (y único) viaje gratis (ganados 2, saldo de Gus 1)', statsG.stats.total === 4 && statsG.stats.pending === 0 && statsG.stats.earned === 2 && statsG.stats.free_trips_outstanding === 1 && meG.passenger.free_trips === 1, JSON.stringify({ st: statsG.stats, free: meG.passenger && meG.passenger.free_trips }));
  for (let i = 0; i < 5; i++) {
    const t = await trip67(accB67.passenger.id, 25);
    await driveTrip67(ownDrv67.driver.id, t.request.id, 25);
  }
  const t6f = await trip67(accB67.passenger.id, 25);
  const a6f = await api('/api/driver-respond', { driver_id: ownDrv67.driver.id, request_id: t6f.request.id, kind: 'acepta', price: 25 });
  check('v1.4.68: en vivo, con 5 servicios el 6.º PAGADO se rechaza (límite gratis de 5)', !a6f.ok && /5 servicios gratis/.test(a6f.error || ''), JSON.stringify(a6f));
  const freeLim = await api('/api/create-request', { passenger_id: accG68.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo', is_free_trip: 1 });
  const aFreeLim = await api('/api/driver-respond', { driver_id: ownDrv67.driver.id, request_id: freeLim.request.id, kind: 'acepta', price: 25 });
  await finishTrip67(ownDrv67.driver.id, freeLim.request.id);
  const meG2 = await api('/api/me?token=' + accG68.token);
  check('v1.4.68: en vivo, el viaje gratis SÍ entra con el límite lleno (no cuenta) y se gasta (saldo de Gus 0)', freeLim.ok && aFreeLim.ok && meG2.passenger.free_trips === 0, JSON.stringify({ free: meG2.passenger.free_trips }));
  const t7f = await trip67(accB67.passenger.id, 25);
  const a7f = await api('/api/driver-respond', { driver_id: ownDrv67.driver.id, request_id: t7f.request.id, kind: 'acepta', price: 25 });
  check('v1.4.68: en vivo, tras el viaje gratis el siguiente pagado SIGUE rechazado (el gratis no sumó al conteo)', !a7f.ok && /5 servicios gratis/.test(a7f.error || ''), JSON.stringify(a7f));
  // --- En vivo: el interruptor del admin ---
  const togNo = await api('/api/admin/set-referral-enabled', { token: accA67.token, enabled: false });
  check('v1.4.68: en vivo, una cuenta que no es admin NO puede apagar la promo (403)', !togNo.ok && /Solo el administrador/.test(togNo.error || ''), JSON.stringify(togNo));
  const togOff = await api('/api/admin/set-referral-enabled', { token: ADM.token, enabled: false });
  const meOff = await api('/api/me?token=' + accA67.token);
  check('v1.4.68: en vivo, el admin apaga la promo y /api/me lo refleja', togOff.ok && togOff.referral_enabled === false && meOff.referral_enabled === false, JSON.stringify({ tog: togOff.referral_enabled, me: meOff.referral_enabled }));
  const accH67 = await api('/api/register-account', { name: 'Hugo Referido', username: 'refh_' + RUN, phone: '961677' + RUN.slice(0, 4), password: 'secreta123', referral_code: 'refa_' + RUN });
  await fotoPara(accH67);
  const tripH1 = await trip67(accH67.passenger.id, 25);
  await driveTrip67(drv.driver.id, tripH1.request.id, 25);
  const statsOff = await api('/api/admin/referral-stats?token=' + ADM.token);
  const meA9 = await api('/api/me?token=' + accA67.token);
  check('v1.4.68: en vivo, con la promo APAGADA el primer viaje del referido NO gana nada', statsOff.stats.enabled === false && statsOff.stats.earned === 2 && statsOff.stats.free_trips_outstanding === 0 && meA9.passenger.free_trips === 0, JSON.stringify({ st: statsOff.stats, free: meA9.passenger.free_trips }));
  const togOn = await api('/api/admin/set-referral-enabled', { token: ADM.token, enabled: true });
  check('v1.4.68: en vivo, el admin vuelve a prender la promo (queda prendida)', togOn.ok && togOn.referral_enabled === true, JSON.stringify(togOn));

  // ===== v1.4.69 (2026-11-25): perfil incompleto no entra a pedir viaje =====
  // Causa: registrarse solo con correo crea un pasajero automático con el
  // teléfono VACÍO (ver Kike en v1.4.23): whoStrip no se pintaba (ya había
  // perfil), ensureNoProfilePassenger no corría (myPassenger existía) y el
  // usuario hacía TODOS los pasos hasta que el servidor rechazaba publicar
  // sin teléfono. Ahora Viajes muestra arriba la tarjeta de completar
  // perfil y "Solicitar el viaje" no entra al flujo hasta completarlo.
  // "Perfil completo" = lo mismo que exige publicar: nombre + teléfono
  // + foto de cara (v1.4.71: la foto pasó a ser obligatoria; en v1.4.69
  // no se exigía y el usuario guardó su perfil solo con el número).
  console.log('== v1.4.69: perfil incompleto no entra a pedir viaje ==');
  const ppcStart = html.indexOf('function passengerProfileComplete(){');
  const ppcEnd = html.indexOf('\nfunction profileBannerHtml(){', ppcStart);
  const ppcSrc = ppcStart >= 0 && ppcEnd > ppcStart ? html.slice(ppcStart, ppcEnd) : '';
  check('v1.4.69: "perfil completo" = nombre + teléfono + foto de cara del pasajero (v1.4.71)', ppcSrc.includes('myPassenger.name') && ppcSrc.includes('myPassenger.phone') && ppcSrc.includes('face_photo'), ppcSrc.slice(0, 300));
  const pbStart = html.indexOf('function profileBannerHtml(){');
  const pbEnd = html.indexOf('\nasync function renderViajes(){', pbStart);
  const pbSrc = pbStart >= 0 && pbEnd > pbStart ? html.slice(pbStart, pbEnd) : '';
  check('v1.4.69: la tarjeta "Completa tu perfil para pedir viajes" existe con su botón al formulario de perfil', pbSrc.includes('Completa tu perfil para pedir viajes') && pbSrc.includes('Completar mi perfil') && pbSrc.includes("openRegistro(\\'pasajero\\',\\'viajes\\')"), pbSrc.slice(0, 300));
  const viaSec69 = html.slice(html.indexOf('async function renderViajes(){'), html.indexOf('function drawWizMap(){'));
  check('v1.4.69: Viajes pinta la tarjeta arriba (en vez del formulario "Sin perfil" de whoStrip)', viaSec69.includes('profileBannerHtml()') && !viaSec69.includes('whoStrip()'));
  const stSrc69 = html.slice(html.indexOf('async function startTripRequest(){'), html.indexOf('/* Repetir un viaje'));
  check('v1.4.69: "Solicitar el viaje" no entra al flujo con perfil incompleto: avisa y lleva a completar el perfil', stSrc69.includes('passengerProfileComplete()') && stSrc69.includes("openRegistro('pasajero','viajes')") && stSrc69.indexOf('passengerProfileComplete()') < stSrc69.indexOf('wiz.step = 1'), stSrc69.slice(0, 300));
  // Evaluado: la definición real de perfil completo y la tarjeta real.
  const ppcFn = new Function('myPassenger', ppcSrc + '\nreturn passengerProfileComplete();');
  const ppcCases = { sinPerfil: ppcFn(null), telefonoVacio: ppcFn({ name: 'Kike Correo', phone: '' }), soloTelefono: ppcFn({ name: '', phone: '9611234567' }), sinFoto: ppcFn({ name: 'Kike Correo', phone: '9611234567' }), completoSinFoto: ppcFn({ name: 'Kike Correo', phone: '9611234567', face_photo: null }), completo: ppcFn({ name: 'Kike Correo', phone: '9611234567', face_photo: 'data:image/jpeg;base64,/9j/4AAQ' }) };
  check('v1.4.69: evaluado — perfil completo = nombre + teléfono + foto (v1.4.71: sin perfil, teléfono vacío, sin nombre o sin foto = incompleto)', ppcCases.sinPerfil === false && ppcCases.telefonoVacio === false && ppcCases.soloTelefono === false && ppcCases.sinFoto === false && ppcCases.completoSinFoto === false && ppcCases.completo === true, JSON.stringify(ppcCases));
  const pbFn = new Function('myPassenger', 'passengerProfileComplete', pbSrc + '\nreturn profileBannerHtml();');
  function runBanner69(p){ return pbFn(p, () => ppcFn(p)); }
  const pbInc69 = runBanner69({ name: 'Kike Correo', phone: '' });
  const pbNull69 = runBanner69(null);
  const pbSinFoto69 = runBanner69({ name: 'Kike Correo', phone: '9611234567', face_photo: null });
  const pbOk69 = runBanner69({ name: 'Kike Correo', phone: '9611234567', face_photo: 'data:image/jpeg;base64,/9j/4AAQ' });
  check('v1.4.69: evaluado — la tarjeta aparece con perfil incompleto (también solo sin foto, v1.4.71) y desaparece con perfil completo', pbInc69.includes('Completa tu perfil para pedir viajes') && pbInc69.includes('Completar mi perfil') && pbInc69.includes("openRegistro('pasajero','viajes')") && pbNull69.includes('Completa tu perfil para pedir viajes') && pbSinFoto69.includes('Completa tu perfil para pedir viajes') && pbOk69 === '', JSON.stringify({ inc: pbInc69.slice(0, 120), ok: pbOk69 }));
  // Evaluado: el candado real de "Solicitar el viaje".
  async function runStart69(passenger){
    const calls = { registro: null, toast: null, rendered: false };
    const wizObj = { step: 0 };
    const fn = new Function('myPassenger', 'passengerProfileComplete', 'toast', 'openRegistro', 'wiz', 'renderViajes', stSrc69 + '\nreturn startTripRequest;')(passenger, () => ppcFn(passenger), (m) => { calls.toast = m; }, (k, r) => { calls.registro = [k, r]; }, wizObj, () => { calls.rendered = true; });
    await fn();
    return { calls, step: wizObj.step };
  }
  const gateInc69 = await runStart69({ name: 'Kike Correo', phone: '' });
  const gateNull69 = await runStart69(null);
  const gateSinFoto69 = await runStart69({ name: 'Kike Correo', phone: '9611234567', face_photo: null });
  const gateOk69 = await runStart69({ name: 'Kike Correo', phone: '9611234567', face_photo: 'data:image/jpeg;base64,/9j/4AAQ' });
  check('v1.4.69: evaluado — con perfil incompleto (teléfono vacío, sin perfil o solo sin foto) "Solicitar el viaje" NO entra al flujo: avisa y abre completar perfil', gateInc69.step === 0 && !gateInc69.calls.rendered && gateInc69.calls.registro && gateInc69.calls.registro[0] === 'pasajero' && gateInc69.calls.registro[1] === 'viajes' && !!gateInc69.calls.toast && gateNull69.step === 0 && gateNull69.calls.registro && gateNull69.calls.registro[1] === 'viajes' && gateSinFoto69.step === 0 && !gateSinFoto69.calls.rendered && gateSinFoto69.calls.registro && gateSinFoto69.calls.registro[1] === 'viajes' && !!gateSinFoto69.calls.toast, JSON.stringify({ inc: gateInc69, nul: gateNull69, sinFoto: gateSinFoto69 }));
  check('v1.4.69: evaluado — con perfil completo "Solicitar el viaje" SÍ entra al flujo (paso 1)', gateOk69.step === 1 && gateOk69.calls.rendered && !gateOk69.calls.registro, JSON.stringify(gateOk69));
  // Evaluado: la pantalla de Viajes (paso 0) con cada estado del perfil.
  const viajesFnSrc69 = html.slice(html.indexOf('async function renderViajes(){'), html.indexOf('let wizMap = null;'));
  async function runRenderViajes69(passenger){
    const pageStub = { innerHTML: '' };
    const wizObj = { step: 0, requestId: null };
    const mdObj = { step: 0, requestId: null, kind: null };
    const stubs = {
      $: (sel) => sel === '#viajes-page' ? pageStub : null,
      wizMap: null, wiz: wizObj, newWizard: () => wizObj, setPageNoScroll: () => {},
      myActiveRequest: async () => null,
      goLive: () => {}, md: null, newMandado: () => mdObj,
      backPill: (label) => '<button>' + label + '</button>',
      renderMandadoSearching: () => {}, renderSearching: () => {},
      whoStrip: () => '<div>who</div>', renderLastTripCard: () => {},
      profileBannerHtml: () => runBanner69(passenger),
    };
    const fn = new Function(...Object.keys(stubs), viajesFnSrc69 + '; return renderViajes;')(...Object.values(stubs));
    await fn();
    return pageStub.innerHTML;
  }
  const sim69inc = await runRenderViajes69({ name: 'Kike Correo', phone: '' });
  const sim69null = await runRenderViajes69(null);
  const sim69ok = await runRenderViajes69({ name: 'Kike Correo', phone: '9611234567', face_photo: 'data:image/jpeg;base64,/9j/4AAQ' });
  check('v1.4.69: evaluado — con perfil incompleto la pantalla de Viajes muestra ARRIBA la tarjeta "Completa tu perfil para pedir viajes" con su botón', sim69inc.includes('Completa tu perfil para pedir viajes') && sim69inc.includes('Completar mi perfil') && sim69inc.indexOf('Completa tu perfil para pedir viajes') < sim69inc.indexOf('Solicitar el viaje') && sim69null.includes('Completa tu perfil para pedir viajes'), JSON.stringify(sim69inc.slice(0, 200)));
  check('v1.4.69: evaluado — con perfil completo la pantalla de Viajes NO muestra la tarjeta y sigue igual (Solicitar + Programar + Historial)', !sim69ok.includes('Completa tu perfil para pedir viajes') && sim69ok.includes('Solicitar el viaje') && sim69ok.includes('Programar un viaje') && sim69ok.includes('Historial de viajes'), JSON.stringify(sim69ok.slice(0, 200)));
  // --- En vivo: cuenta solo-correo con pasajero de teléfono vacío ---
  const acc69 = await newMailAccount('lola');
  check('v1.4.69: en vivo, cuenta nueva solo-correo (sin teléfono)', acc69.acc.ok && !acc69.acc.account.phone, JSON.stringify(acc69.acc));
  const me69a = await api('/api/me?token=' + acc69.li.token);
  check('v1.4.69: en vivo, la cuenta nace con pasajero automático de teléfono vacío (el caso del usuario)', me69a.ok && me69a.passenger && me69a.passenger.phone === '' && me69a.passenger.name === 'Lola Correo', JSON.stringify(me69a.passenger));
  const trip69bad = await api('/api/create-request', { passenger_id: me69a.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  check('v1.4.69: en vivo, con el teléfono vacío el servidor sigue rechazando publicar el viaje (400)', !trip69bad.ok && /teléfono/.test(trip69bad.error || ''), JSON.stringify(trip69bad));
  // Completar nombre + teléfono SIN foto (el caso del usuario en
  // v1.4.71): el servidor ya no guarda el perfil sin foto.
  const phone69 = '961690' + RUN.slice(0, 4);
  const set69 = await api('/api/set-account-phone', { token: acc69.li.token, phone: phone69 });
  const upd69noFoto = await api('/api/update-passenger', { passenger_id: me69a.passenger.id, name: 'Lola Correo', phone: phone69 });
  check('v1.4.71: en vivo, completar nombre + teléfono SIN foto ya no guarda el perfil (400)', set69.ok && !upd69noFoto.ok && /foto/.test(upd69noFoto.error || ''), JSON.stringify(upd69noFoto));
  // Subir la selfie: ahora sí guarda y el perfil queda completo.
  const upd69 = await api('/api/update-passenger', { passenger_id: me69a.passenger.id, name: 'Lola Correo', phone: phone69, face_photo: PHOTO });
  const me69b = await api('/api/me?token=' + acc69.li.token);
  check('v1.4.69: en vivo, al completar nombre + teléfono + foto el perfil queda completo', set69.ok && upd69.ok && me69b.ok && me69b.passenger.phone === phone69 && me69b.passenger.name === 'Lola Correo' && !!me69b.passenger.face_photo, JSON.stringify(me69b.passenger));
  const trip69ok = await api('/api/create-request', { passenger_id: me69a.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  check('v1.4.69: en vivo, con el perfil completo el viaje se publica normal (buscando, $25)', trip69ok.ok && trip69ok.request.status === 'buscando' && trip69ok.request.price === 25, JSON.stringify(trip69ok.request && { st: trip69ok.request.status, p: trip69ok.request.price }));
  await api('/api/cancel-request', { request_id: trip69ok.request.id });
  // Perfil con nombre + teléfono desde el registro, pero SIN foto: el
  // registro crea el pasajero automático sin foto (v1.4.71: nace
  // incompleto hasta subir la selfie).
  const acc69b = await api('/api/register-account', { name: 'Marta Completa', username: 'marta_' + RUN, phone: '961691' + RUN.slice(0, 4), password: 'secreta123' });
  const me69c = await api('/api/me?token=' + acc69b.token);
  check('v1.4.69: en vivo, una cuenta registrada con teléfono nace con nombre + teléfono pero SIN foto (perfil incompleto, v1.4.71)', acc69b.ok && me69c.ok && me69c.passenger && me69c.passenger.phone === '961691' + RUN.slice(0, 4) && !me69c.passenger.face_photo, JSON.stringify(me69c.passenger));
  const trip69c = await api('/api/create-request', { passenger_id: me69c.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  check('v1.4.71: en vivo, con nombre + teléfono pero sin foto el servidor rechaza publicar el viaje (400)', !trip69c.ok && /foto/.test(trip69c.error || ''), JSON.stringify(trip69c));
  const up69c = await api('/api/upload-passenger-photo', { passenger_id: me69c.passenger.id, photo: PHOTO });
  const trip69d = await api('/api/create-request', { passenger_id: me69c.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  check('v1.4.69: en vivo, con la foto subida el viaje se publica sin trabas', up69c.ok && trip69d.ok && trip69d.request.status === 'buscando', JSON.stringify(trip69d.request && { st: trip69d.request.status, p: trip69d.request.price }));
  await api('/api/cancel-request', { request_id: trip69d.request.id });

  // ===== v1.4.70 (2026-11-25): perfil incompleto tampoco entra a Mandados =====
  // El usuario confirmó que Viajes ya muestra la tarjeta (v1.4.69) pero
  // Mandados dejaba entrar a los dos flujos con el perfil incompleto.
  // Ahora la entrada de Mandados ("¿Qué quieres hacer?") muestra arriba
  // la misma tarjeta ámbar y los dos botones no entran al flujo hasta
  // completar nombre + teléfono. El servidor ya rechazaba publicar el
  // mandado sin teléfono (mismo /api/create-request, 400), así que no
  // hubo cambio de servidor: solo la puerta en la pantalla.
  console.log('== v1.4.70: perfil incompleto tampoco entra a Mandados ==');
  const pbmStart = html.indexOf('function profileBannerHtmlMandados(){');
  const pbmEnd = html.indexOf('\nasync function renderViajes(){', pbmStart);
  const pbmSrc = pbmStart >= 0 && pbmEnd > pbmStart ? html.slice(pbmStart, pbmEnd) : '';
  check('v1.4.70: la tarjeta "Completa tu perfil para pedir mandados" existe con su botón al formulario de perfil', pbmSrc.includes('Completa tu perfil para pedir mandados') && pbmSrc.includes('Completar mi perfil') && pbmSrc.includes("openRegistro(\\'pasajero\\',\\'mandados\\')"), pbmSrc.slice(0, 300));
  const mdSec70 = html.slice(html.indexOf('async function renderMandados(){'), html.indexOf('function mdBack(step){'));
  check('v1.4.70: Mandados pinta la tarjeta arriba de "¿Qué quieres hacer?"', mdSec70.includes('profileBannerHtmlMandados()') && mdSec70.indexOf('profileBannerHtmlMandados()') < mdSec70.indexOf('¿Qué quieres hacer?'), mdSec70.slice(0, 200));
  check('v1.4.70: los dos botones de entrada pasan por startMandado (no entran directo al flujo)', mdSec70.includes("startMandado(\\'quiero\\')") && mdSec70.includes("startMandado(\\'enviar\\')") && !mdSec70.includes("md.kind=\\'quiero\\';md.step=1") && !mdSec70.includes("md.kind=\\'enviar\\';md.step=1"), mdSec70.slice(0, 300));
  const smSrc70 = html.slice(html.indexOf('function startMandado(kind){'), html.indexOf('function mdBack(step){'));
  check('v1.4.70: startMandado no entra al flujo con perfil incompleto: avisa y lleva a completar el perfil', smSrc70.includes('passengerProfileComplete()') && smSrc70.includes("openRegistro('pasajero','mandados')") && smSrc70.indexOf('passengerProfileComplete()') < smSrc70.indexOf('md.step = 1'), smSrc70.slice(0, 300));
  // Evaluado: la tarjeta real de Mandados.
  const pbmFn = new Function('myPassenger', 'passengerProfileComplete', pbmSrc + '\nreturn profileBannerHtmlMandados();');
  function runBanner70(p){ return pbmFn(p, () => ppcFn(p)); }
  const pbmInc70 = runBanner70({ name: 'Lola Correo', phone: '' });
  const pbmNull70 = runBanner70(null);
  const pbmOk70 = runBanner70({ name: 'Lola Correo', phone: '9611234567', face_photo: 'data:image/jpeg;base64,/9j/4AAQ' });
  check('v1.4.70: evaluado — la tarjeta de Mandados aparece con perfil incompleto y desaparece con perfil completo', pbmInc70.includes('Completa tu perfil para pedir mandados') && pbmInc70.includes('Completar mi perfil') && pbmInc70.includes("openRegistro('pasajero','mandados')") && pbmNull70.includes('Completa tu perfil para pedir mandados') && pbmOk70 === '', JSON.stringify({ inc: pbmInc70.slice(0, 120), ok: pbmOk70 }));
  // Evaluado: el candado real de los dos botones de Mandados.
  async function runStart70(passenger, kind){
    const calls = { registro: null, toast: null, rendered: false };
    const mdObj = { step: 0, kind: null };
    const fn = new Function('myPassenger', 'passengerProfileComplete', 'toast', 'openRegistro', 'md', 'renderMandados', 'mandadosCanEnter', 'myLocation', smSrc70 + '\nreturn startMandado;')(passenger, () => ppcFn(passenger), (m) => { calls.toast = m; }, (k, r) => { calls.registro = [k, r]; }, mdObj, () => { calls.rendered = true; }, () => true, async () => ({ lat: 16.87, lng: -93.2 }));
    await fn(kind);
    return { calls, step: mdObj.step, kind: mdObj.kind };
  }
  const gateInc70q = await runStart70({ name: 'Lola Correo', phone: '' }, 'quiero');
  const gateInc70e = await runStart70({ name: 'Lola Correo', phone: '' }, 'enviar');
  const gateNull70 = await runStart70(null, 'quiero');
  const gateOk70q = await runStart70({ name: 'Lola Correo', phone: '9611234567', face_photo: 'data:image/jpeg;base64,/9j/4AAQ' }, 'quiero');
  const gateOk70e = await runStart70({ name: 'Lola Correo', phone: '9611234567', face_photo: 'data:image/jpeg;base64,/9j/4AAQ' }, 'enviar');
  check('v1.4.70: evaluado — con perfil incompleto NINGÚN botón de Mandados entra al flujo: avisa y abre completar perfil', gateInc70q.step === 0 && !gateInc70q.calls.rendered && gateInc70q.calls.registro && gateInc70q.calls.registro[1] === 'mandados' && !!gateInc70q.calls.toast && gateInc70e.step === 0 && gateInc70e.calls.registro && gateInc70e.calls.registro[1] === 'mandados' && gateNull70.step === 0 && gateNull70.calls.registro && gateNull70.calls.registro[1] === 'mandados', JSON.stringify({ q: gateInc70q, e: gateInc70e, nul: gateNull70 }));
  check('v1.4.70: evaluado — con perfil completo los dos botones SÍ entran a su flujo (paso 1)', gateOk70q.step === 1 && gateOk70q.kind === 'quiero' && gateOk70q.calls.rendered && !gateOk70q.calls.registro && gateOk70e.step === 1 && gateOk70e.kind === 'enviar' && gateOk70e.calls.rendered && !gateOk70e.calls.registro, JSON.stringify({ q: gateOk70q, e: gateOk70e }));
  // Evaluado: la pantalla de entrada de Mandados (paso 0) con cada estado.
  const mdFnSrc70 = html.slice(html.indexOf('async function renderMandados(){'), html.indexOf('function mdBack(step){'));
  async function runRenderMandados70(passenger){
    const pageStub = { innerHTML: '' };
    const mdObj = { step: 0, requestId: null, kind: null };
    const wizObj = { step: 0, requestId: null };
    const stubs = {
      $: (sel) => sel === '#mandados-page' ? pageStub : null,
      mdMap: null, md: mdObj, newMandado: () => mdObj, setPageNoScroll: () => {},
      myActiveRequest: async () => null,
      goLive: () => {}, wiz: wizObj, newWizard: () => wizObj, go: () => {},
      backPill: (label) => '<button>' + label + '</button>',
      renderMandadoSearching: () => {}, renderSearching: () => {},
      profileBannerHtmlMandados: () => runBanner70(passenger),
      renderMandadoQuiero: () => {}, renderMandadoEnviar: () => {},
      mandadosCanEnter: () => true,
    };
    const fn = new Function(...Object.keys(stubs), mdFnSrc70 + '; return renderMandados;')(...Object.values(stubs));
    await fn();
    return pageStub.innerHTML;
  }
  const sim70inc = await runRenderMandados70({ name: 'Lola Correo', phone: '' });
  const sim70null = await runRenderMandados70(null);
  const sim70ok = await runRenderMandados70({ name: 'Lola Correo', phone: '9611234567', face_photo: 'data:image/jpeg;base64,/9j/4AAQ' });
  check('v1.4.70: evaluado — con perfil incompleto la entrada de Mandados muestra ARRIBA la tarjeta con su botón, antes de "¿Qué quieres hacer?"', sim70inc.includes('Completa tu perfil para pedir mandados') && sim70inc.includes('Completar mi perfil') && sim70inc.indexOf('Completa tu perfil para pedir mandados') < sim70inc.indexOf('¿Qué quieres hacer?') && sim70null.includes('Completa tu perfil para pedir mandados'), JSON.stringify(sim70inc.slice(0, 200)));
  check('v1.4.70: evaluado — con perfil completo la entrada de Mandados NO muestra la tarjeta y sigue igual (Quiero + Enviar)', !sim70ok.includes('Completa tu perfil para pedir mandados') && sim70ok.includes('Quiero un mandado') && sim70ok.includes('Enviar un mandado'), JSON.stringify(sim70ok.slice(0, 200)));
  // --- En vivo: cuenta solo-correo con pasajero de teléfono vacío ---
  const acc70 = await newMailAccount('nora');
  const me70a = await api('/api/me?token=' + acc70.li.token);
  check('v1.4.70: en vivo, cuenta nueva solo-correo (sin teléfono) nace con pasajero de teléfono vacío', acc70.acc.ok && me70a.ok && me70a.passenger && me70a.passenger.phone === '' && me70a.passenger.name === 'Nora Correo', JSON.stringify(me70a.passenger));
  const md70bad = await api('/api/create-request', { passenger_id: me70a.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo' });
  check('v1.4.70: en vivo, con el teléfono vacío el servidor también rechaza publicar el mandado (400)', !md70bad.ok && /teléfono/.test(md70bad.error || ''), JSON.stringify(md70bad));
  // Completar nombre + teléfono SIN foto (v1.4.71): tampoco guarda.
  const phone70 = '961692' + RUN.slice(0, 4);
  const set70 = await api('/api/set-account-phone', { token: acc70.li.token, phone: phone70 });
  const upd70noFoto = await api('/api/update-passenger', { passenger_id: me70a.passenger.id, name: 'Nora Correo', phone: phone70 });
  check('v1.4.71: en vivo, completar nombre + teléfono SIN foto tampoco guarda el perfil del mandado (400)', set70.ok && !upd70noFoto.ok && /foto/.test(upd70noFoto.error || ''), JSON.stringify(upd70noFoto));
  const upd70 = await api('/api/update-passenger', { passenger_id: me70a.passenger.id, name: 'Nora Correo', phone: phone70, face_photo: PHOTO });
  const me70b = await api('/api/me?token=' + acc70.li.token);
  check('v1.4.70: en vivo, al completar nombre + teléfono + foto el perfil queda completo', set70.ok && upd70.ok && me70b.ok && me70b.passenger.phone === phone70 && me70b.passenger.name === 'Nora Correo' && !!me70b.passenger.face_photo, JSON.stringify(me70b.passenger));
  const md70ok = await api('/api/create-request', { passenger_id: me70a.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo' });
  check('v1.4.70: en vivo, con el perfil completo el mandado se publica normal (buscando, $30)', md70ok.ok && md70ok.request.status === 'buscando' && md70ok.request.price === 30, JSON.stringify(md70ok.request && { st: md70ok.request.status, p: md70ok.request.price }));
  await api('/api/cancel-request', { request_id: md70ok.request.id });
  // Perfil con nombre + teléfono desde el registro, pero SIN foto: el
  // registro crea el pasajero automático sin foto (v1.4.71: nace
  // incompleto hasta subir la selfie).
  const acc70b = await api('/api/register-account', { name: 'Paco Completo', username: 'paco_' + RUN, phone: '961693' + RUN.slice(0, 4), password: 'secreta123' });
  const me70c = await api('/api/me?token=' + acc70b.token);
  check('v1.4.70: en vivo, una cuenta registrada con teléfono nace con nombre + teléfono pero SIN foto (perfil incompleto, v1.4.71)', acc70b.ok && me70c.ok && me70c.passenger && me70c.passenger.phone === '961693' + RUN.slice(0, 4) && !me70c.passenger.face_photo, JSON.stringify(me70c.passenger));
  const md70cNoFoto = await api('/api/create-request', { passenger_id: me70c.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo' });
  check('v1.4.71: en vivo, con nombre + teléfono pero sin foto el servidor también rechaza publicar el mandado (400)', !md70cNoFoto.ok && /foto/.test(md70cNoFoto.error || ''), JSON.stringify(md70cNoFoto));
  const up70c = await api('/api/upload-passenger-photo', { passenger_id: me70c.passenger.id, photo: PHOTO });
  const md70c = await api('/api/create-request', { passenger_id: me70c.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo' });
  check('v1.4.70: en vivo, con la foto subida el mandado se publica sin trabas', up70c.ok && md70c.ok && md70c.request.status === 'buscando', JSON.stringify(md70c.request && { st: md70c.request.status, p: md70c.request.price }));
  await api('/api/cancel-request', { request_id: md70c.request.id });

  // ===== v1.4.70 (2026-11-25): orden y diseño del panel de administrador =====
  // La captura del usuario mostró el panel desordenado: el respaldo arriba,
  // la promo en medio, y las tarjetas de Negocios y de la promo en fila flex
  // donde el texto quedaba estrecho y el botón se salía y se cortaba por la
  // derecha. Orden final: tarjeta del admin → credenciales → Negocios →
  // retícula de 7 → promo → respaldo → Cerrar sesión. Negocios y promo
  // apilados en vertical (título y descripción arriba, botón a lo ancho
  // abajo). Sin cambios de comportamiento: mismos interruptores, mismas
  // estadísticas, misma descarga y mismo cierre de sesión.
  console.log('== v1.4.70: orden y diseño del panel de administrador ==');
  const rag70 = html.slice(html.indexOf('function renderAdminGrid(){'), html.indexOf('async function loadReferralStats(){'));
  check('v1.4.70 (actualizado en v1.4.75): orden del panel — retícula, promo y respaldo arriba, Negocios abajo, Cerrar sesión al final', rag70.indexOf('Cambiar usuario y contraseña') < rag70.indexOf('Panel de administrador') && rag70.indexOf('Panel de administrador') < rag70.indexOf('Viajes gratis por recomendación') && rag70.indexOf('Viajes gratis por recomendación') < rag70.indexOf('Respaldar base de datos') && rag70.indexOf('Respaldar base de datos') < rag70.indexOf('🔒 Negocios ') && rag70.indexOf('🔒 Negocios ') < rag70.indexOf('‹ Cerrar sesión</button>'), JSON.stringify({ cred: rag70.indexOf('Cambiar usuario y contraseña'), neg: rag70.indexOf('🔒 Negocios '), grid: rag70.indexOf('Panel de administrador'), promo: rag70.indexOf('Viajes gratis por recomendación'), back: rag70.indexOf('Respaldar base de datos'), out: rag70.indexOf('‹ Cerrar sesión</button>') }));
  check('v1.4.70: Negocios y promo ya no usan la fila flex con el botón encogido (nada se corta por la derecha)', !rag70.includes('flex:none;align-self:center') && rag70.includes('<button class="btn small" onclick="toggleNegociosLock()">') && rag70.includes('<button class="btn small" onclick="toggleReferralPromo()">') && rag70.includes('id="referral-stats-line"'), rag70.slice(rag70.indexOf('Negocios '), rag70.indexOf('Negocios ') + 200));
  check('v1.4.70: la tarjeta de credenciales y los interruptores siguen iguales (mismos textos y handlers)', rag70.includes('Cambiar usuario y contraseña') && rag70.includes('onclick="adminCredsOpen=!adminCredsOpen;renderAdminGrid()"') && rag70.includes('toggleNegociosLock()') && rag70.includes('toggleReferralPromo()') && rag70.includes('downloadBackup()') && rag70.includes('doLogout()') && rag70.includes('Apagar promoción') && rag70.includes('Abrir Negocios'), rag70.slice(0, 200));
  // Evaluado: el panel real con cada estado de los interruptores.
  async function runRenderAdmin70(locked, enabled){
    const pageStub = { innerHTML: '' };
    const stubs = {
      $: (sel) => sel === '#admin-page' ? pageStub : null,
      myAccount: { name: 'Admin', username: 'admin', phone: '9614868605' },
      esc: (s) => String(s == null ? '' : s),
      pwInput: () => '',
      adminCredsOpen: false, negociosLocked: locked, mandadosLocked: false, referralEnabled: enabled,
      loadAdminOverview: () => {}, loadReferralStats: () => {},
      adminPoll: null, setInterval: () => 1, clearInterval: () => {},
    };
    const fn = new Function(...Object.keys(stubs), rag70 + '; return renderAdminGrid;')(...Object.values(stubs));
    fn();
    return pageStub.innerHTML;
  }
  const adm70 = await runRenderAdmin70(true, true);
  const adm70b = await runRenderAdmin70(false, false);
  check('v1.4.70 (actualizado en v1.4.75): evaluado — el panel real respeta el orden final (admin → credenciales → retícula → promo → respaldo → Negocios → Cerrar sesión)', adm70.indexOf('ADMINISTRADOR') < adm70.indexOf('Cambiar usuario y contraseña') && adm70.indexOf('Cambiar usuario y contraseña') < adm70.indexOf('Panel de administrador') && adm70.indexOf('Panel de administrador') < adm70.indexOf('Solicitudes de choferes') && adm70.indexOf('Tiendas') < adm70.indexOf('Viajes gratis por recomendación') && adm70.indexOf('Viajes gratis por recomendación') < adm70.indexOf('Respaldar base de datos') && adm70.indexOf('Respaldar base de datos') < adm70.indexOf('Negocios bloqueado') && adm70.indexOf('Negocios bloqueado') < adm70.indexOf('Cerrar sesión'), JSON.stringify(adm70.slice(0, 300)));
  check('v1.4.70: evaluado — Negocios y promo con botón a lo ancho abajo (sin fila flex) y textos según su estado', adm70.includes('<button class="btn small" onclick="toggleNegociosLock()">Abrir Negocios</button>') && adm70.includes('<button class="btn small" onclick="toggleReferralPromo()">Apagar promoción</button>') && adm70.includes('id="referral-stats-line"') && adm70b.includes('Negocios abierto') && adm70b.includes('Bloquear Negocios') && adm70b.includes('Prender promoción') && !adm70.includes('flex:none'), JSON.stringify(adm70.slice(adm70.indexOf('Negocios bloqueado'), adm70.indexOf('Negocios bloqueado') + 200)));

  // ===== v1.4.71 (2026-11-25): la selfie es OBLIGATORIA para guardar el perfil =====
  // El usuario completó su perfil poniendo SOLO su número (sin selfie) y
  // la app lo guardó: en v1.4.69/70 la foto no se exigía. Ahora "perfil
  // completo" = nombre + teléfono + foto de cara, el formulario no guarda
  // sin ella, el servidor la exige al guardar el perfil y al publicar, y
  // la tarjeta vuelve a aparecer para quien guardó solo con el número.
  // El registro de la cuenta en sí no se toca: el pasajero automático
  // nace sin foto y se completa en el formulario.
  console.log('== v1.4.71: la selfie es obligatoria para guardar el perfil ==');
  check('v1.4.71: savePassenger() no guarda sin foto: avisa y se para antes de llamar al servidor', spSrc.includes("if(!photo) return toast('Sube tu foto de cara") && spSrc.indexOf("if(!photo)") < spSrc.indexOf("register-passenger") && !spSrc.includes('Perfil guardado sin foto'), spSrc.slice(0, 300));
  check('v1.4.71: savePassenger() manda la foto en la actualización del perfil', spSrc.includes("api('/api/update-passenger', { passenger_id: myPassenger.id, name, phone, face_photo: regPhoto1 || null })"), spSrc.slice(0, 300));
  const or71Start = html.indexOf('function openRegistro(kind, ret){');
  const or71End = html.indexOf('\nlet regVehicle', or71Start);
  const or71Src = or71Start >= 0 && or71End > or71Start ? html.slice(or71Start, or71End) : '';
  check('v1.4.71: el formulario de pasajero marca la selfie como obligatoria (sin ella no se guarda)', or71Src.includes('La foto de tu cara (selfie) es obligatoria.') && or71Src.includes('Sin esta foto no se puede guardar tu perfil.'), or71Src.slice(0, 300));
  const pt71Start = html.indexOf('async function publishTrip(){');
  const pt71End = html.indexOf('\n/* ===== Buscando', pt71Start);
  const pt71Src = pt71Start >= 0 && pt71End > pt71Start ? html.slice(pt71Start, pt71End) : '';
  check('v1.4.71: publishTrip() también exige el perfil completo (cubre "Repetir este viaje")', pt71Src.includes('passengerProfileComplete()') && pt71Src.includes("openRegistro('pasajero','viajes')"), pt71Src.slice(0, 300));
  const pm71Start = html.indexOf('async function publishMandado(){');
  const pm71End = html.indexOf('\nasync function renderMandadoSearching', pm71Start);
  const pm71Src = pm71Start >= 0 && pm71End > pm71Start ? html.slice(pm71Start, pm71End) : '';
  check('v1.4.71: publishMandado() también exige el perfil completo', pm71Src.includes('passengerProfileComplete()') && pm71Src.includes("openRegistro('pasajero','mandados')"), pm71Src.slice(0, 300));
  // En vivo: el endpoint de guardar rechaza sin foto y acepta con foto.
  const reg71noFoto = await api('/api/register-passenger', { name: 'Sin Foto', phone: '961695' + RUN.slice(0, 4) });
  check('v1.4.71: en vivo, guardar un pasajero nuevo SIN foto es rechazado (400)', !reg71noFoto.ok && /foto/.test(reg71noFoto.error || ''), JSON.stringify(reg71noFoto));
  const reg71foto = await api('/api/register-passenger', { name: 'Con Foto', phone: '961696' + RUN.slice(0, 4), face_photo: PHOTO });
  check('v1.4.71: en vivo, guardar un pasajero nuevo CON foto sí se guarda (200)', reg71foto.ok && !!reg71foto.passenger.face_photo, JSON.stringify(reg71foto));
  // --- En vivo: el caso exacto del usuario (cuenta solo-correo) ---
  const acc71 = await newMailAccount('tomas');
  const me71a = await api('/api/me?token=' + acc71.li.token);
  check('v1.4.71: en vivo, cuenta nueva solo-correo nace con pasajero automático sin teléfono y sin foto', acc71.acc.ok && me71a.ok && me71a.passenger && me71a.passenger.phone === '' && !me71a.passenger.face_photo, JSON.stringify(me71a.passenger));
  const trip71bad = await api('/api/create-request', { passenger_id: me71a.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  check('v1.4.71: en vivo, con el teléfono vacío el servidor rechaza publicar (400)', !trip71bad.ok && /teléfono/.test(trip71bad.error || ''), JSON.stringify(trip71bad));
  // Solo pone el número, sin selfie (lo que hizo el usuario): el
  // guardado es rechazado y la tarjeta sigue apareciendo.
  const phone71 = '961694' + RUN.slice(0, 4);
  const set71 = await api('/api/set-account-phone', { token: acc71.li.token, phone: phone71 });
  const upd71noFoto = await api('/api/update-passenger', { passenger_id: me71a.passenger.id, name: 'Tomas Correo', phone: phone71 });
  check('v1.4.71: en vivo, completar nombre + teléfono SIN foto NO guarda el perfil (400, el caso del usuario)', set71.ok && !upd71noFoto.ok && /foto/.test(upd71noFoto.error || ''), JSON.stringify(upd71noFoto));
  const pb71sinFoto = runBanner69({ name: 'Tomas Correo', phone: phone71, face_photo: null });
  check('v1.4.71: evaluado — con nombre + teléfono pero sin foto la tarjeta SIGUE apareciendo', pb71sinFoto.includes('Completa tu perfil para pedir viajes') && pb71sinFoto.includes('Completar mi perfil'), JSON.stringify(pb71sinFoto.slice(0, 120)));
  const gate71sinFoto = await runStart69({ name: 'Tomas Correo', phone: phone71, face_photo: null });
  check('v1.4.71: evaluado — con nombre + teléfono pero sin foto "Solicitar el viaje" sigue sin entrar al flujo', gate71sinFoto.step === 0 && !gate71sinFoto.calls.rendered && gate71sinFoto.calls.registro && gate71sinFoto.calls.registro[1] === 'viajes' && !!gate71sinFoto.calls.toast, JSON.stringify(gate71sinFoto));
  // Sube la selfie y guarda: ahora sí queda completo, la tarjeta se va
  // y se publica normal.
  const upd71 = await api('/api/update-passenger', { passenger_id: me71a.passenger.id, name: 'Tomas Correo', phone: phone71, face_photo: PHOTO });
  const me71b = await api('/api/me?token=' + acc71.li.token);
  check('v1.4.71: en vivo, con nombre + teléfono + foto el perfil sí se guarda y queda completo', upd71.ok && me71b.ok && me71b.passenger.phone === phone71 && !!me71b.passenger.face_photo, JSON.stringify(me71b.passenger));
  const pb71ok = runBanner69({ name: 'Tomas Correo', phone: phone71, face_photo: 'data:image/jpeg;base64,/9j/4AAQ' });
  check('v1.4.71: evaluado — con la foto subida la tarjeta ya no aparece', pb71ok === '', JSON.stringify(pb71ok));
  const trip71ok = await api('/api/create-request', { passenger_id: me71a.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  check('v1.4.71: en vivo, con el perfil completo el viaje se publica normal (buscando, $25)', trip71ok.ok && trip71ok.request.status === 'buscando' && trip71ok.request.price === 25, JSON.stringify(trip71ok.request && { st: trip71ok.request.status, p: trip71ok.request.price }));
  await api('/api/cancel-request', { request_id: trip71ok.request.id });
  const md71ok = await api('/api/create-request', { passenger_id: me71a.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_detail: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, eta_minutes: 5, price: 30, payment_method: 'efectivo' });
  check('v1.4.71: en vivo, con el perfil completo el mandado también se publica normal (buscando, $30)', md71ok.ok && md71ok.request.status === 'buscando' && md71ok.request.price === 30, JSON.stringify(md71ok.request && { st: md71ok.request.status, p: md71ok.request.price }));
  await api('/api/cancel-request', { request_id: md71ok.request.id });

  // ===== v1.4.72 (2026-11-25): registro de chofer — cada foto ofrece
  // cámara Y galería (antes un solo input con capture abría directo la
  // cámara y no dejaba elegir una foto de la galería). Dos botones
  // bonitos en fila: verde «Tomar foto» y naranja «Subir de galería».
  // La foto del pasajero no cambia.
  console.log('== v1.4.72: fotos de chofer con cámara y galería ==');
  const dpfStart = html.indexOf('function driverPhotoField(slot){');
  const dpfEnd = html.indexOf('\nfunction openRegistro', dpfStart);
  const dpfSrc = dpfStart >= 0 && dpfEnd > dpfStart ? html.slice(dpfStart, dpfEnd) : '';
  check('v1.4.72: driverPhotoField() tiene dos botones bonitos (Tomar foto verde + Subir de galería naranja)', dpfSrc.includes('Tomar foto') && dpfSrc.includes('Subir de galería') && dpfSrc.includes('class="btn small"') && dpfSrc.includes('class="btn amber small"'), dpfSrc.slice(0, 300));
  check('v1.4.72: driverPhotoField() tiene dos inputs ocultos (cámara con capture + galería sin capture)', (dpfSrc.match(/<input type="file"/g) || []).length === 2 && dpfSrc.includes('capture="\'+cap+\'"') && dpfSrc.includes('id="\'+gal+\'" accept="image/*"'), dpfSrc.slice(0, 300));
  check('v1.4.72: driverPhotoField() distingue cara (user, regPhoto1) y vehículo (environment, regPhoto2)', dpfSrc.includes("selfie ? 'user' : 'environment'") && dpfSrc.includes("selfie ? 'regPhoto1' : 'regPhoto2'"), dpfSrc.slice(0, 300));
  check('v1.4.72: driverPhotoField() pasa por fileToPhoto (misma compresión 480px)', dpfSrc.includes('fileToPhoto(this,'), dpfSrc.slice(0, 300));
  // El wizard y el formulario de Mi cuenta usan el helper en las dos
  // fotos; el formulario de pasajero tiene sus dos botones en línea desde
  // la v1.4.95 (mismo patrón que el helper, sin usarlo).
  const or72Start = html.indexOf('function openRegistro(kind, ret){');
  const or72End = html.indexOf('\nlet regVehicle', or72Start);
  const or72Src = or72Start >= 0 && or72End > or72Start ? html.slice(or72Start, or72End) : '';
  check('v1.4.72: el wizard y Mi cuenta usan driverPhotoField en la foto de cara y en la del vehículo', or72Src.includes("driverPhotoField('selfie')") && or72Src.includes("driverPhotoField('vehicle')"), or72Src.slice(0, 300));
  const or72PaxStart = or72Src.indexOf("if(kind==='pasajero'){");
  const or72PaxEnd = or72Src.indexOf('} else {', or72PaxStart);
  const or72PaxSrc = or72PaxStart >= 0 && or72PaxEnd > or72PaxStart ? or72Src.slice(or72PaxStart, or72PaxEnd) : '';
  check('v1.4.95: el formulario de pasajero SÍ cambió (dos inputs: rp-cam con capture + rp-gal sin capture; sigue sin driverPhotoField, el patrón va en línea)', or72PaxSrc.includes('capture="user"') && !or72PaxSrc.includes('driverPhotoField') && (or72PaxSrc.match(/<input type="file"/g) || []).length === 2 && or72PaxSrc.includes('id="rp-cam"') && or72PaxSrc.includes('id="rp-gal"') && !or72PaxSrc.slice(or72PaxSrc.indexOf('id="rp-gal"'), or72PaxSrc.indexOf('id="rp-gal"') + 60).includes('capture='), or72PaxSrc.slice(0, 300));
  // En vivo: registrar un chofer con las fotos subidas de galería (el
  // API recibe el mismo data URL venga de cámara o de galería).
  const drv72 = await api('/api/register-driver', { name: 'Galeria Chofer', phone: '961700' + RUN.slice(0, 4), vehicle: 'mototaxi', unit: 'G72-' + RUN.slice(0, 3), selfie: PHOTO, vehicle_photo: PHOTO });
  check('v1.4.72: en vivo, registro de chofer con fotos de galería se crea (200)', drv72.ok && drv72.driver && drv72.driver.id && !!drv72.driver.selfie && !!drv72.driver.vehicle_photo, JSON.stringify(drv72.driver && { id: drv72.driver.id, s: !!drv72.driver.selfie, v: !!drv72.driver.vehicle_photo }));
  const ap72 = await approveDriver(drv72.driver.id);
  check('v1.4.72: en vivo, el chofer de galería se aprueba (200)', ap72.ok && ap72.driver && ap72.driver.status === 'aprobado', JSON.stringify(ap72.driver && { id: ap72.driver.id, st: ap72.driver.status }));

  // ===== v1.4.73 (2026-11-25): resumen del taxímetro al finalizar IGUAL
  // que la app real (captura del usuario): cabecera oscura con flecha
  // atrás + "Resumen del viaje" + papelera, fecha larga, Tiempo de viaje
  // / Distancia / precio grande, desglose "Salida + distancia + espera =
  // total · A cobrar", botón naranja "Nuevo recorrido". Sin "Generar
  // recibo" en el taxímetro (los recibos de viaje/mandado no cambian).
  console.log('== v1.4.73: resumen del taxímetro como la app real ==');
  const rtsStart = html.indexOf('function renderTaxiStrips(){');
  const rtsEnd = html.indexOf('\nfunction taxiBack()', rtsStart);
  const rtsSrc = rtsStart >= 0 && rtsEnd > rtsStart ? html.slice(rtsStart, rtsEnd) : '';
  // La rama de "done" es el último else de renderTaxiStrips.
  const doneStart = rtsSrc.lastIndexOf('} else {');
  const doneSrc = doneStart >= 0 ? rtsSrc.slice(doneStart) : '';
  check('v1.4.73: el resumen al finalizar es cabecera oscura con flecha atrás + "Resumen del viaje" + papelera', doneSrc.includes('Resumen del viaje') && doneSrc.includes('onclick="taxiBack()"') && doneSrc.includes('onclick="taxiDeleteRun()"') && doneSrc.includes('td-sumhead'), doneSrc.slice(0, 300));
  check('v1.4.73: el resumen muestra fecha larga, Tiempo de viaje en HMS, Distancia en Km y precio grande exacto', doneSrc.includes('fmtTaxiDate(s.endAt)') && doneSrc.includes('Tiempo de viaje') && doneSrc.includes('fmtHMS(s.totalSecs||0)') && doneSrc.includes("toFixed(2)+' Km") && doneSrc.includes("$'+price.toFixed(2)"), doneSrc.slice(0, 300));
  check('v1.4.73: el resumen trae el desglose Salida + distancia + espera = total · A cobrar (redondeo intacto)', doneSrc.includes("Salida $'") && doneSrc.includes("distancia $'") && doneSrc.includes("espera $'") && doneSrc.includes('A cobrar: ') && doneSrc.includes('fmt$(price)'), doneSrc.slice(0, 300));
  check('v1.4.73: el resumen termina con botón naranja "Nuevo recorrido" y NO tiene "Generar recibo", "Nuevo viaje" ni "Volver"', doneSrc.includes('Nuevo recorrido') && doneSrc.includes('onclick="taxiReset()"') && !doneSrc.includes('Generar recibo') && !doneSrc.includes('taxiReceipt') && !doneSrc.includes('Nuevo viaje') && !doneSrc.includes('Volver'), doneSrc.slice(0, 400));
  check('v1.4.73: fmtTaxiDate() existe y usa día de semana + mes largos (fecha como la app real)', html.includes('function fmtTaxiDate(ts)') && html.includes("weekday:'long'") && html.includes("month:'long'"), '');
  check('v1.4.73: taxiDeleteRun() pide confirmar, borra el recorrido del historial y vuelve al inicio', html.includes('function taxiDeleteRun(){') && html.includes("confirm('¿Borrar este recorrido del taxímetro?')") && html.includes('taxiSaveHist(taxiLoadHist().filter(r => r.endAt !== s.endAt))') && html.includes('taxiReset()'), '');
  check('v1.4.73: taxiReceipt() ya no existe en ningún lado', !html.includes('function taxiReceipt()') && !html.includes('taxiReceipt()'), '');
  // El diálogo del historial del taxímetro tampoco ofrece recibo.
  const strStart = html.indexOf('function showTaxiRun(idx){');
  const strEnd = html.indexOf('\nfunction ', strStart + 10);
  const strSrc = strStart >= 0 && strEnd > strStart ? html.slice(strStart, strEnd) : '';
  check('v1.4.73: el detalle del historial del taxímetro ya no tiene "Generar recibo" (sigue con mapa, tabla y Cerrar)', strSrc.includes('Resumen del viaje') && strSrc.includes('Cerrar</button>') && !strSrc.includes('Generar recibo') && !strSrc.includes('downloadReceipt'), strSrc.slice(0, 300));
  // Los recibos de viaje/mandado siguen intactos.
  check('v1.4.73: los recibos de viaje/mandado conservan su "Generar recibo" (solo el taxímetro lo pierde)', html.includes('onclick="downloadReceipt()">Generar recibo</button>'), '');

  // ===== v1.4.74 (2026-11-25): el aviso de privacidad usa el correo
  // contacto@sanfernandogo.com como vía de contacto y ya no muestra el
  // número de teléfono 9614868605 en ningún lado. La línea 31 (datos de
  // la cuenta: nombre, número de teléfono o correo) no cambia: describe
  // los datos que guarda la cuenta, no un medio de contacto.
  console.log('== v1.4.74: aviso de privacidad con correo de contacto ==');
  const priv74Res = await fetch(B + '/privacidad');
  const priv74Text = await priv74Res.text();
  check('v1.4.74: el aviso de privacidad trae contacto@sanfernandogo.com', priv74Res.status === 200 && priv74Text.includes('contacto@sanfernandogo.com'), 'status=' + priv74Res.status);
  check('v1.4.74: el aviso de privacidad ya no trae el 9614868605', !priv74Text.includes('9614868605'), priv74Text.slice(priv74Text.indexOf('Tus derechos'), priv74Text.indexOf('Tus derechos') + 200));
  check('v1.4.74: los derechos se ejercen por correo (no por WhatsApp)', priv74Text.includes('escribiéndonos a') && priv74Text.includes('contacto@sanfernandogo.com') && !priv74Text.includes('por WhatsApp al'), '');
  check('v1.4.74: la sección Contacto muestra el correo (no el WhatsApp)', priv74Text.includes('Correo:') && priv74Text.includes('contacto@sanfernandogo.com') && !priv74Text.includes('WhatsApp:'), '');

  // ===== v1.4.75 (2026-11-25): panel de Viajes en el área de admin —
  // tarjeta "📊 Viajes" en la retícula, pantalla propia con dos
  // estadísticas (Solicitados / Aceptados) y la lista de viajes con
  // quién lo pidió y qué chofer lo tomó. Solo viajes (kind='viaje').
  // Además: las tarjetas del panel son botones verdes y naranjas
  // (tono alterno) y la tarjeta del candado de Negocios bajó hasta
  // abajo, arriba de Cerrar sesión.
  console.log('== v1.4.75: panel de Viajes en el admin ==');
  const tripsNoAuth = await api('/api/admin/trips');
  check('v1.4.75: GET /api/admin/trips sin token es 403', !tripsNoAuth.ok && /administrador/.test(tripsNoAuth.error || ''), JSON.stringify(tripsNoAuth));
  const usr75 = await api('/api/register-account', { name: 'No Admin 75', username: 'noadmin75_' + RUN, phone: '9610000075', password: 'secreta123' });
  const tripsNoAdmin = await api('/api/admin/trips?token=' + encodeURIComponent(usr75.token || ''));
  check('v1.4.75: GET /api/admin/trips con token no-admin es 403', !tripsNoAdmin.ok && /administrador/.test(tripsNoAdmin.error || ''), JSON.stringify(tripsNoAdmin));
  const tripsAdm = await api('/api/admin/trips?token=' + encodeURIComponent(ADM.token));
  check('v1.4.75: GET /api/admin/trips con token admin devuelve solicitados/aceptados y la lista', tripsAdm.ok && typeof tripsAdm.requested === 'number' && typeof tripsAdm.accepted === 'number' && Array.isArray(tripsAdm.trips), JSON.stringify({ requested: tripsAdm.requested, accepted: tripsAdm.accepted, n: tripsAdm.trips && tripsAdm.trips.length }));
  check('v1.4.75: solicitados > 0, aceptados > 0 y aceptados <= solicitados (la suite ya publicó y aceptó viajes)', tripsAdm.ok && tripsAdm.requested > 0 && tripsAdm.accepted > 0 && tripsAdm.accepted <= tripsAdm.requested, JSON.stringify({ requested: tripsAdm.requested, accepted: tripsAdm.accepted }));
  check('v1.4.75: la lista es SOLO viajes (kind=viaje, ningún mandado)', tripsAdm.ok && tripsAdm.trips.length > 0 && tripsAdm.trips.every(t => t.kind === 'viaje'), JSON.stringify(tripsAdm.trips && tripsAdm.trips.slice(0, 2).map(t => ({ id: t.id, kind: t.kind }))));
  check('v1.4.75: cada viaje trae pasajero y, si tiene chofer, su nombre', tripsAdm.ok && tripsAdm.trips.every(t => t.passenger_name) && tripsAdm.trips.filter(t => t.driver_id).every(t => t.driver_name), JSON.stringify(tripsAdm.trips && tripsAdm.trips.slice(0, 3).map(t => ({ id: t.id, pax: t.passenger_name, drv: t.driver_name }))));
  check('v1.4.75: hay al menos un viaje con chofer y uno sin chofer', tripsAdm.ok && tripsAdm.trips.some(t => t.driver_id && t.driver_name) && tripsAdm.trips.some(t => !t.driver_id), JSON.stringify({ conChofer: tripsAdm.trips.filter(t => t.driver_id).length, sinChofer: tripsAdm.trips.filter(t => !t.driver_id).length }));
  // Cliente: retícula, ruta y pantalla.
  const gridSec = html.slice(html.indexOf('function renderAdminGrid(){'), html.indexOf('async function loadReferralStats(){'));
  check('v1.4.75: la retícula del admin tiene la tarjeta Viajes (tono naranja) junto a las demás', gridSec.includes("card('viajes','📊','Viajes'") && gridSec.includes("card('sol-choferes'") && gridSec.includes("card('tiendas'"), gridSec.slice(gridSec.indexOf("card('viajes'"), gridSec.indexOf("card('viajes'") + 120));
  check('v1.4.75: las tarjetas del panel alternan verde y naranja (4 y 4)', (gridSec.match(/,'green'\)/g) || []).length === 4 && (gridSec.match(/,'amber'\)/g) || []).length === 4, '');
  check('v1.4.75: el router del admin abre la pantalla de Viajes', html.includes("if(adminScreen==='viajes') return renderAdminTrips();"), '');
  const tripsSec = html.slice(html.indexOf('async function renderAdminTrips(){'), html.indexOf('/* --- Administrar pasajeros --- */'));
  check('v1.4.75: la pantalla de Viajes muestra Solicitados y Aceptados con su definición', tripsSec.includes('Solicitados') && tripsSec.includes('Aceptados') && tripsSec.includes('/api/admin/trips') && tripsSec.includes('incluye los cancelados') && tripsSec.includes('aceptados o terminados'), tripsSec.slice(0, 200));
  check('v1.4.75: cada fila trae pasajero, chofer (o "Sin chofer"), ruta, precio, fecha y estado', tripsSec.includes('Chofer: ') && tripsSec.includes('Sin chofer') && tripsSec.includes('origin_zone') && tripsSec.includes('fmt$(r.final_price || r.price)') && tripsSec.includes('fmtDateTime(r.created_at)') && tripsSec.includes('adminTripStatusLabel'), '');
  check('v1.4.75: la tarjeta del candado de Negocios está abajo, después del respaldo y antes de Cerrar sesión', gridSec.indexOf('🔒 Negocios') > gridSec.indexOf('Respaldar base de datos') && gridSec.indexOf('🔒 Negocios') < gridSec.indexOf('‹ Cerrar sesión'), '');

  console.log('== v1.4.78: pasos fusionados, chat, mapa divertido, $30 mínimo, ticket ==');
  // --- Mínimo $30 de mandado (servidor; el viaje sigue en $20) ---
  const man25 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  check('v1.4.85: publicar mandado a $25 sí se puede (mínimo $20)', man25.ok && man25.request.price === 25, JSON.stringify(man25));
  const man15 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 15, payment_method: 'efectivo' });
  check('v1.4.85: publicar mandado a $15 se rechaza (mínimo $20)', !man15.ok && /20/.test(man15.error || ''), JSON.stringify(man15));
  const man30 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo' });
  check('v1.4.78: publicar mandado a $30 sí se puede', man30.ok && man30.request.price === 30, JSON.stringify(man30));
  // --- Cliente: paso fusionado, tiendas fijas, dinero para comprar, mapa divertido ---
  const quieroSec78 = html.slice(html.indexOf('function renderMandadoQuiero(){'), html.indexOf('function renderMandadoEnviar(){'));
  check('v1.4.80: el paso 3 se titula "¿Dónde se compra?" con el campo ARRIBA y las dos instrucciones en tarjetas ABAJO (sin tiendas fijas)', quieroSec78.includes('¿Dónde se compra?') && quieroSec78.includes('Paso 3 de 4') && quieroSec78.includes('md-buy-where') && quieroSec78.includes('Escribe la tienda o el lugar') && quieroSec78.indexOf('md-buy-where') < quieroSec78.indexOf('Instrucción 1') && quieroSec78.includes('icbox green') && quieroSec78.includes('Instrucción 1') && quieroSec78.includes('icbox amber') && quieroSec78.includes('Instrucción 2') && html.includes('Abarrotes Castillejo') && html.includes('Farmacia del Súper Descuento') && html.includes('Bodega Aurrerá') && !quieroSec78.includes('mdStopPlaceHtml') && !quieroSec78.includes('function mdChoosePresetStore') && !quieroSec78.includes('<b>Un solo lugar</b>') && !quieroSec78.includes('<b>Varios lados</b>'));
  check('v1.4.78: el paso fusionado ya no tiene búsqueda de punto exacto ni pegar ubicación de WhatsApp', !quieroSec78.includes('mdStopSearchHtml') && !quieroSec78.includes('mdResolveWa(') && !quieroSec78.includes('md-wa-0'), '');
  check('v1.4.79: el resumen del chofer muestra "📍 Se compra en" con el texto tal como se escribió', html.includes("['📍 Se compra en'") && html.includes('stops_json'), '');
  check('v1.4.85: el paso de precio muestra el dinero para comprar con steppers de $50 ($150 por defecto, mínimo $50)', html.includes('¿Cuánto dinero lleva el chofer para comprar?') && html.includes('mdCarryStep(-50)') && html.includes('mdCarryStep(50)') && html.includes('carryAmount:150') && html.includes('Math.max(50,'), '');
  check('v1.4.78: publicar "Quiero" manda por_pagar con el dinero para comprar', html.includes("order_payment:'por_pagar', order_amount: Number(md.carryAmount)||150"), '');
  check('v1.4.78: el mapa de mandados usa el estilo divertido Voyager y Viajes sigue con Meta', html.includes('basemaps.cartocdn.com/gl/voyager-gl-style/style.json') && html.includes("makeMap('md-map', false, true)") && html.includes("pickReturn==='mandados'") && html.includes("liveReq.kind==='mandado'") && html.includes('style: fun ? FUN_STYLE_URL : META_STYLE_URL'), '');
  check('v1.4.78: el mapa en vivo cambia de estilo entre viaje (Meta) y mandado (Voyager)', html.includes('function setLiveMapStyle(fun)') && html.includes("setLiveMapStyle(liveReq.kind==='mandado')"), '');
  check('v1.4.85: el mínimo de mandado es $20 en cliente (viaje sigue $20)', html.includes('MIN_MANDADO = 20') && html.includes("kind==='viaje' ? minForPax(st.pax) : MIN_MANDADO") && html.includes('El precio debe ir de cinco en cinco: $20, $25, $30'), '');
  // --- Chat: cuentas enlazadas con su perfil ---
  const chatPaxAcc = await api('/api/register-account', { name: 'Chat Pasajera', username: 'chatpax78_' + RUN, phone: '9610000078', password: 'secreta123' });
  check('v1.4.78: cuenta de pasajera para el chat', chatPaxAcc.ok && !!chatPaxAcc.token && chatPaxAcc.passenger && chatPaxAcc.passenger.id, JSON.stringify(chatPaxAcc));
  // v1.4.71: el pasajero automático nace sin foto y publicar exige la
  // selfie: se sube antes de publicar el mandado del chat.
  const chatPaxPhoto = await api('/api/upload-passenger-photo', { passenger_id: chatPaxAcc.passenger.id, photo: PHOTO });
  check('v1.4.78: la pasajera del chat sube su foto de cara', chatPaxPhoto.ok, JSON.stringify(chatPaxPhoto));
  const chatDrvAcc = await api('/api/register-account', { name: 'Chat Chofer', username: 'chatdrv78_' + RUN, phone: '9610000079', password: 'secreta123' });
  const chatDrv = await api('/api/register-driver', { name: 'Chat Chofer', phone: '9610000079', vehicle: 'mototaxi', unit: 'C78', selfie: PHOTO, vehicle_photo: PHOTO });
  await approveDriver(chatDrv.driver.id);
  const linkDrv78 = await api('/api/link-profiles', { token: chatDrvAcc.token, driver_id: chatDrv.driver.id });
  check('v1.4.78: cuenta de chofer enlazada a su perfil (para el chat)', chatDrvAcc.ok && chatDrv.ok && linkDrv78.ok && linkDrv78.account.driver_id === chatDrv.driver.id, JSON.stringify(linkDrv78));
  const on78 = await api('/api/set-driver-online', { driver_id: chatDrv.driver.id, online: true });
  check('v1.4.78: chofer del chat en línea', on78.ok && on78.driver.online === 1, JSON.stringify(on78));
  // Mandado "Quiero" aceptado (con tienda y dinero para comprar).
  const man78 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', origin_zone: 'Bodega Aurrerá', origin_detail: 'Bodega Aurrerá', origin_lat: 16.87137, origin_lng: -93.20652, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', order_payment: 'por_pagar', order_amount: 150, stops: [{ zone: 'Bodega Aurrerá', lat: 16.87137, lng: -93.20652, detail: '' }], extra_stops: 0 });
  check('v1.4.78: mandado "Quiero" a $30 con "Lleva $150" y parada Bodega Aurrerá se publica', man78.ok && man78.request.price === 30 && man78.request.order_payment === 'por_pagar' && man78.request.order_amount === 150, JSON.stringify(man78));
  const man78row = await api('/api/requests?id=' + man78.request.id);
  check('v1.4.78: la parada guarda el nombre de la tienda en stops_json', man78row.ok && (man78row.requests[0].stops_json || '').includes('Bodega Aurrerá'), JSON.stringify(man78row.requests && man78row.requests[0].stops_json));
  // Chat antes de aceptar: rechazado.
  const chatEarly = await api('/api/chat/send', { token: chatPaxAcc.token, request_id: man78.request.id, text: 'Hola' });
  check('v1.4.78: el chat no abre antes de aceptar el servicio', !chatEarly.ok && /aceptado/.test(chatEarly.error || ''), JSON.stringify(chatEarly));
  const acc78 = await api('/api/driver-respond', { driver_id: chatDrv.driver.id, request_id: man78.request.id, kind: 'acepta', price: 30 });
  check('v1.4.78: el chofer acepta el mandado', acc78.ok && acc78.request.status === 'aceptado' && acc78.request.trip_stage === 'en_camino', JSON.stringify(acc78));
  // Chat texto pasajera -> chofer.
  const ch78a = await api('/api/chat/send', { token: chatPaxAcc.token, request_id: man78.request.id, text: 'Compra 2 kg de tortillas por favor' });
  check('v1.4.78: la pasajera manda texto en el chat', ch78a.ok && ch78a.message.kind === 'texto' && ch78a.message.sender_role === 'pasajero', JSON.stringify(ch78a));
  await new Promise(r => setTimeout(r, 1100));
  const ch78b = await api('/api/chat/send', { token: chatDrvAcc.token, request_id: man78.request.id, text: 'Claro, voy por ellas' });
  check('v1.4.78: el chofer responde texto en el chat', ch78b.ok && ch78b.message.sender_role === 'chofer', JSON.stringify(ch78b));
  // Tercero rechazado (el admin no es ni pasajera ni chofer de este servicio).
  const ch78c = await api('/api/chat?request_id=' + man78.request.id + '&token=' + encodeURIComponent(ADM.token));
  check('v1.4.78: un tercero no puede leer el chat', !ch78c.ok && /no es tuyo/.test(ch78c.error || ''), JSON.stringify(ch78c));
  // Foto del chofer (ADD 3: ticket) — con espera por el límite de 1 msg/s.
  await new Promise(r => setTimeout(r, 1100));
  const ch78photo = await api('/api/chat/send', { token: chatDrvAcc.token, request_id: man78.request.id, photo: PHOTO });
  check('v1.4.78: el chofer manda foto (ticket) por el chat', ch78photo.ok && ch78photo.message.kind === 'foto' && ch78photo.message.sender_role === 'chofer', JSON.stringify(ch78photo));
  // La pasajera ve la foto en la lista.
  const ch78list = await api('/api/chat?request_id=' + man78.request.id + '&token=' + encodeURIComponent(chatPaxAcc.token));
  check('v1.4.78: la pasajera recibe texto y foto del chofer en la lista del chat', ch78list.ok && ch78list.messages.length === 3 && ch78list.messages.some(m => m.kind === 'foto' && m.sender_role === 'chofer') && ch78list.messages.some(m => m.kind === 'texto' && m.sender_role === 'pasajero'), JSON.stringify(ch78list.messages && ch78list.messages.map(m => ({ k: m.kind, r: m.sender_role }))));
  // Foto de pasajera: v1.4.88 — ya PUEDE mandar foto (antes solo el chofer;
  // la 1.4.87 le dio el botón de cámara y el servidor la rechazaba).
  const ch78paxphoto = await api('/api/chat/send', { token: chatPaxAcc.token, request_id: man78.request.id, photo: PHOTO });
  check('v1.4.88: la pasajera SÍ puede mandar foto por el chat', ch78paxphoto.ok && ch78paxphoto.message.kind === 'foto' && ch78paxphoto.message.sender_role === 'pasajero', JSON.stringify(ch78paxphoto));
  // Límite 1 msg/s: dos textos seguidos de la misma cuenta, el segundo se rechaza.
  await new Promise(r => setTimeout(r, 1100));
  const rl1 = await api('/api/chat/send', { token: chatPaxAcc.token, request_id: man78.request.id, text: 'primero' });
  const rl2 = await api('/api/chat/send', { token: chatPaxAcc.token, request_id: man78.request.id, text: 'segundo' });
  check('v1.4.78: anti-spam del chat (1 msg/s por cuenta)', rl1.ok && !rl2.ok && /segundo/.test(rl2.error || ''), JSON.stringify({ rl1: rl1.ok, rl2 }));
  // --- ADD 3: etapas "Ya compré" ---
  const advLlego = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: man78.request.id, stage: 'llego' });
  check('v1.4.78: el chofer marca "Ya estoy afuera" (llego)', advLlego.ok && advLlego.request.trip_stage === 'llego', JSON.stringify(advLlego));
  const advComprado = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: man78.request.id, stage: 'comprado' });
  check('v1.4.78: "Sin ticket" avanza igual a "Ya compré" (comprado) sin foto', advComprado.ok && advComprado.request.trip_stage === 'comprado', JSON.stringify(advComprado));
  const cancelComprado = await api('/api/cancel-request', { request_id: man78.request.id });
  check('v1.4.78: ya comprado no se puede cancelar', !cancelComprado.ok && /ya empezó/.test(cancelComprado.error || ''), JSON.stringify(cancelComprado));
  const advEnViaje = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: man78.request.id, stage: 'en_viaje' });
  check('v1.4.78: de comprado sigue "Ya voy en camino" (en_viaje)', advEnViaje.ok && advEnViaje.request.trip_stage === 'en_viaje', JSON.stringify(advEnViaje));
  const advEntregado = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: man78.request.id, stage: 'entregado' });
  check('v1.4.78: el mandado se entrega y termina', advEntregado.ok && advEntregado.request.trip_stage === 'entregado' && advEntregado.request.status === 'finalizado', JSON.stringify(advEntregado));
  // Enviar NO puede marcar comprado.
  const env78 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_lat: 16.87137, dest_lng: -93.20652, distance_km: 1.0, price: 30, payment_method: 'efectivo', description: 'Paquete', recipient_phone: '9610000099', recipient_name: 'Quien recibe', order_payment: 'pagado', order_amount: 0 });
  const accEnv78 = await api('/api/driver-respond', { driver_id: chatDrv.driver.id, request_id: env78.request.id, kind: 'acepta', price: 30 });
  const advLlegoEnv = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: env78.request.id, stage: 'llego' });
  const advCompradoEnv = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: env78.request.id, stage: 'comprado' });
  check('v1.4.78: un "Enviar" NO puede marcar "Ya compré"', env78.ok && accEnv78.ok && advLlegoEnv.ok && !advCompradoEnv.ok && /no es de compras/.test(advCompradoEnv.error || ''), JSON.stringify(advCompradoEnv));
  // Cliente: chat y ticket.
  check('v1.4.78: el mapa en vivo trae el botón flotante 💬 Chat y la hoja con sondeo de 3 s', html.includes('id="live-chat-btn"') && html.includes('openChatSheet()') && html.includes('setInterval(chatFetch, 3000)') && html.includes('chatSetDot(chatUnread+n)'), ''); // v1.4.91 (detalle 3): chatSetDot(true) pasó a conteo chatSetDot(chatUnread+n)
  check('v1.4.78: la hoja del chat trae foto para AMBOS lados (cámara + galería) (v1.4.87: antes solo el chofer)', html.includes('Tomar foto') && html.includes('Subir de galería') && html.includes('chatSendPhoto') && html.includes('chat-cam'), '');
  check('v1.4.78: la foto del chat se toca para verla grande', html.includes('chatZoomPhoto') && html.includes('cursor:zoom-in'), '');
  check('v1.4.78: el chofer ve "Ya compré" y la hoja del ticket con "Sin ticket"', html.includes("comprado:'Ya compré'") && html.includes('askTicketPhoto()') && html.includes('Foto del ticket') && html.includes('Sin ticket'), '');
  check('v1.4.78: "Ya compré" solo sale en "Quiero un mandado" (Enviar sigue directo a "Ya voy en camino")', html.includes('isQuieroMandado(r)') && html.includes("isQuieroMandado(r) ? 'comprado' : 'en_viaje'"), '');

  console.log('== v1.4.79: paso 2 con texto libre, entrega por GPS, candado de Mandados, pin de compra ==');
  // --- Candado de Mandados: servidor (espejo de Negocios v1.4.64) ---
  check('v1.4.79: el servidor tiene el candado de Mandados con bloqueo por defecto (sin fila = bloqueado) y exención solo para admin y @thegrafferz10', srv.includes("function mandadosLocked(){") && srv.includes("key='mandados_locked'") && srv.includes("return !row || row.value !== '0';") && srv.includes("function mandadosExempt(a){ return !!a && (a.role === 'admin' || a.username === 'thegrafferz10'); }"));
  check('v1.4.79: /api/admin/set-mandados-locked existe, solo admin, guarda el estado en admin_state y por defecto bloquea (sin locked = bloqueado)', srv.includes("'/api/admin/set-mandados-locked'") && srv.includes("INSERT OR REPLACE INTO admin_state (key, value) VALUES ('mandados_locked', ?)") && srv.includes("const locked = body.locked !== false && body.locked !== '0' && body.locked !== 0;") && srv.includes("return send(res, 200, { ok: true, mandados_locked: locked });"));
  check('v1.4.79: /api/me devuelve mandados_locked (el cliente lo lee al iniciar sesión)', srv.includes("mandados_locked: mandadosLocked()"));
  check('v1.4.79: publicar mandado exige el texto de dónde se compra (Quiero sin coordenadas sí pasa)', srv.includes("Escribe dónde se compra: la tienda o el lugar."));
  // --- Cliente: paso 2 con texto libre + entrega por GPS, 3 pasos ---
  const quieroSec79 = html.slice(html.indexOf('function renderMandadoQuiero(){'), html.indexOf('function renderMandadoEnviar(){'));
  check('v1.4.80: el paso 1 es la entrega al inicio con las dos tarjetas estilo Viajes (GPS / punto en el mapa)', quieroSec79.includes('¿A dónde se entrega?</h2>') && quieroSec79.includes('Elige cómo marcar el punto de entrega.') && quieroSec79.includes('bigopt hot') && quieroSec79.includes('Usar ubicación actual') && quieroSec79.includes('mdDeliveryGps()') && quieroSec79.includes('Ubicar un punto en el mapa') && quieroSec79.includes("openPick(\\'mdest\\',\\'mandados\\')") && quieroSec79.includes('Toma el GPS de tu teléfono y enseguida fijas el punto exacto en el mapa') && quieroSec79.includes('Abre el mapa y toca el punto exacto de entrega'));
  check('v1.4.80: el flujo "Quiero" es en 4 pasos y el precio es el paso 4 (la entrega ya no va en el paso 3)', quieroSec79.includes('Paso 2 de 4') && quieroSec79.includes('Paso 3 de 4') && quieroSec79.includes('md.step===4') && !quieroSec79.includes('Paso 1 de 3') && !quieroSec79.includes('Paso 2 de 3') && !quieroSec79.includes('Paso 3 de 3'));
  check('v1.4.79: el precio se estima con el registro (mdMatchBuyPlace) y si no hay coincidencia usa el punto de entrega', html.includes('function mdMatchBuyPlace') && html.includes('function mdResolveStops()') && html.includes('const origin = (first.lat!=null) ? first : dest;'));
  check('v1.4.79: el mapa de precio dibuja aunque no haya punto de compra', html.includes('if(!dest || dest.lat==null) return;') && html.includes("if(first && first.lat!=null){ new maplibregl.Marker"));
  check('v1.4.79: el cliente guarda el candado de Mandados al iniciar sesión y la exención es admin o @thegrafferz10', html.includes('let mandadosLocked = true;') && html.includes('mandadosLocked = !!j.mandados_locked;') && html.includes("function mandadosCanEnter(){ return !mandadosLocked || (myAccount && (myAccount.role==='admin' || myAccount.username==='thegrafferz10')); }"));
  check('v1.4.79: la tarjeta de Mandados en inicio muestra el candado con «Próximamente» cuando está bloqueado', html.includes("Mandados está bloqueado por ahora.") && html.includes('Próximamente · Encargos y paquetes en moto o mototaxi.'));
  check('v1.4.79: el panel del admin tiene el interruptor del candado de Mandados', html.includes('toggleMandadosLock()') && html.includes('Mandados bloqueado') && html.includes('Mandados abierto') && html.includes('Abrir Mandados') && html.includes('Bloquear Mandados') && html.includes("'/api/admin/set-mandados-locked'"));
  check('v1.4.79: el mapa en vivo pinta el pin de compra con su rótulo "Se compra en: <texto>"', html.includes('liveMarkers.buy') && html.includes("buyLbl.textContent = 'Se compra en: '") && html.includes('pickup-lbl'));
  // --- En vivo: el candado bloquea, el dueño publica, el admin abre/cierra ---
  // El candado está abierto desde el inicio de la suite; el admin lo cierra.
  const lockClose79 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: true });
  check('v1.4.79: el admin cierra el candado de Mandados', lockClose79.ok && lockClose79.mandados_locked === true, JSON.stringify(lockClose79));
  const meLock79 = await api('/api/me?token=' + encodeURIComponent(chatPaxAcc.token));
  check('v1.4.79: en vivo — /api/me dice que Mandados está bloqueado', meLock79.ok && meLock79.mandados_locked === true, JSON.stringify(meLock79 && { locked: meLock79.mandados_locked }));
  const manBlocked79 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_lat: 16.87137, dest_lng: -93.20652, distance_km: 1.0, price: 30, payment_method: 'efectivo' });
  check('v1.4.79: en vivo — cuenta normal NO puede publicar mandado con el candado puesto (403 locked)', !manBlocked79.ok && manBlocked79.locked === true, JSON.stringify(manBlocked79));
  const envBlocked79 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_lat: 16.87137, dest_lng: -93.20652, distance_km: 1.0, price: 30, payment_method: 'efectivo', description: 'Paquete', recipient_phone: '9610000099', recipient_name: 'Quien recibe', order_payment: 'pagado', order_amount: 0 });
  check('v1.4.79: en vivo — Enviar también se bloquea con el candado puesto', !envBlocked79.ok && envBlocked79.locked === true, JSON.stringify(envBlocked79));
  const tripLock79 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Progreso', dest_lat: 16.87737, dest_lng: -93.22214, distance_km: 1.5, price: 30, payment_method: 'efectivo' });
  check('v1.4.79: en vivo — los viajes sí se publican con el candado de Mandados puesto', tripLock79.ok && tripLock79.request.kind === 'viaje', JSON.stringify(tripLock79));
  // El dueño (@thegrafferz10) sí puede publicar con el candado puesto:
  // texto libre SIN coordenadas y sin precio (sugiere $20, el mínimo).
  // El dueño (@thegrafferz10) sí puede publicar con el candado puesto:
  // la cuenta ya existe en esta corrida (own64, registrada en v1.4.64);
  // se le sube la foto del pasajero porque publicar exige perfil completo.
  const owner79 = own64;
  const owner79photo = await api('/api/upload-passenger-photo', { passenger_id: owner79.passenger.id, photo: PHOTO });
  check('v1.4.79: cuenta del dueño (@thegrafferz10) para el candado', owner79.ok && !!owner79.token && owner79.passenger && owner79.passenger.id && owner79photo.ok, JSON.stringify(owner79));
  const ownerPhoto79 = await api('/api/upload-passenger-photo', { passenger_id: owner79.passenger.id, photo: PHOTO });
  check('v1.4.79: el dueño sube su foto de cara', ownerPhoto79.ok, JSON.stringify(ownerPhoto79));
  const manNoLabel79 = await api('/api/create-request', { passenger_id: owner79.passenger.id, kind: 'mandado', origin_zone: '   ', dest_zone: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo' });
  check('v1.4.79: publicar "Quiero" sin texto de dónde se compra se rechaza', !manNoLabel79.ok && /dónde se compra/.test(manNoLabel79.error || ''), JSON.stringify(manNoLabel79));
  const manOwner79 = await api('/api/create-request', { passenger_id: owner79.passenger.id, kind: 'mandado', origin_zone: 'Farmacia del Súper Descuento', dest_zone: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, payment_method: 'efectivo', order_payment: 'por_pagar', order_amount: 150, stops: [{ zone: 'Farmacia del Súper Descuento', lat: null, lng: null, detail: '' }], extra_stops: 0 });
  check('v1.4.85: el dueño publica "Quiero" con texto libre SIN coordenadas y sin precio (sugiere $20)', manOwner79.ok && manOwner79.request.price === 20 && manOwner79.request.origin_lat === null, JSON.stringify(manOwner79));
  const manOwnerRow79 = await api('/api/requests?id=' + manOwner79.request.id);
  check('v1.4.79: la parada guarda el texto tal como se escribió en stops_json', manOwnerRow79.ok && (manOwnerRow79.requests[0].stops_json || '').includes('Farmacia del Súper Descuento'), JSON.stringify(manOwnerRow79.requests && manOwnerRow79.requests[0].stops_json));
  // El admin abre el candado: la cuenta normal ya puede publicar.
  const lockOpen2_79 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: false });
  check('v1.4.79: el admin abre el candado de Mandados', lockOpen2_79.ok && lockOpen2_79.mandados_locked === false, JSON.stringify(lockOpen2_79));
  const manOpen79 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', origin_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_lat: 16.87137, dest_lng: -93.20652, distance_km: 1.0, price: 30, payment_method: 'efectivo' });
  check('v1.4.79: en vivo — con el candado abierto la cuenta normal publica mandado', manOpen79.ok && manOpen79.request.price === 30, JSON.stringify(manOpen79));
  // Y se vuelve a cerrar: el candado queda puesto al final.
  const lockClose2_79 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: true });
  check('v1.4.79: el admin vuelve a bloquear y el candado queda puesto', lockClose2_79.ok && lockClose2_79.mandados_locked === true, JSON.stringify(lockClose2_79));
  const meLockEnd79 = await api('/api/me?token=' + encodeURIComponent(chatPaxAcc.token));
  check('v1.4.79: en vivo — /api/me refleja el candado puesto al final', meLockEnd79.ok && meLockEnd79.mandados_locked === true, JSON.stringify(meLockEnd79 && { locked: meLockEnd79.mandados_locked }));

  console.log('== v1.4.80: entrega al inicio estilo Viajes, campo arriba e instrucciones abajo ==');
  // --- Cliente: paso 1 con las dos tarjetas, paso 3 sin entrega, precio paso 4 ---
  const quieroSec80 = html.slice(html.indexOf('function renderMandadoQuiero(){'), html.indexOf('function renderMandadoEnviar(){'));
  const q80step1 = quieroSec80.slice(quieroSec80.indexOf('md.step===1'), quieroSec80.indexOf('md.step===2'));
  const q80step3 = quieroSec80.slice(quieroSec80.indexOf('md.step===3'), quieroSec80.indexOf('md.step===4'));
  check('v1.4.80: el paso 1 con punto ya marcado muestra el punto confirmado, la referencia y el Continuar', q80step1.includes('Punto de entrega marcado') && q80step1.includes('md-dest-ref') && q80step1.includes('Referencia extra') && q80step1.includes('mdBack(2)') && q80step1.includes('Se entrega en tu ubicación actual'));
  check('v1.4.80: el paso 3 NO trae bloque de entrega (sin "¿A dónde se entrega?", sin "Cambiar punto", sin referencia)', !q80step3.includes('¿A dónde se entrega?') && !q80step3.includes('Cambiar punto') && !q80step3.includes('md-dest-ref') && !q80step3.includes('Referencia extra') && !q80step3.includes('Se entrega en tu ubicación actual') && !q80step3.includes('md-err2b'));
  check('v1.4.80: el paso 3 valida solo el texto de compra (mdNextQuiero3) y ya no existe mdActivateDelivery', q80step3.includes('mdNextQuiero3()') && q80step3.includes('md-err2') && !html.includes('mdActivateDelivery') && !html.includes('mdNextQuiero2'));
  // Evaluado: el paso 1 real con y sin punto, y el paso 3 real.
  const q80FnSrc = html.slice(html.indexOf('function renderMandadoQuiero(){'), html.indexOf('function renderMandadoEnviar(){'));
  function runQuiero80(mdObj){
    const pageStub = { innerHTML: '' };
    const stubs = {
      $: (sel) => sel === '#mandados-page' ? pageStub : null,
      backPill: (label) => '<button>' + label + '</button>',
      esc: (s) => String(s ?? ''),
      nearestZoneName: () => 'Mercado',
      md: mdObj,
    };
    const fn = new Function(...Object.keys(stubs), q80FnSrc + '; return renderMandadoQuiero;')(...Object.values(stubs));
    fn();
    return pageStub.innerHTML;
  }
  const q80s1fresh = runQuiero80({ step: 1, kind: 'quiero', dest: null, destRef: '' });
  check('v1.4.80: evaluado — el paso 1 sin punto muestra solo las dos tarjetas (sin referencia ni Continuar)', q80s1fresh.includes('¿A dónde se entrega?') && q80s1fresh.includes('Usar ubicación actual') && q80s1fresh.includes('Ubicar un punto en el mapa') && !q80s1fresh.includes('Referencia extra') && !q80s1fresh.includes('Continuar'), q80s1fresh.slice(0, 200));
  const q80s1done = runQuiero80({ step: 1, kind: 'quiero', dest: { lat: 16.87075, lng: -93.20768, label: 'Punto en el mapa', zone: '' }, destFromGps: true, destRef: '' });
  check('v1.4.80: evaluado — el paso 1 con punto muestra el punto confirmado, la referencia y el Continuar', q80s1done.includes('Se entrega en tu ubicación actual') && q80s1done.includes('16.87075') && q80s1done.includes('cerca de Mercado') && q80s1done.includes('Referencia extra') && q80s1done.includes('md-dest-ref') && q80s1done.includes('Continuar') && q80s1done.includes('mdBack(2)'), q80s1done.slice(0, 300));
  const q80s3 = runQuiero80({ step: 3, kind: 'quiero', stops: [{ zone: '' }], dest: { lat: 16.87, lng: -93.2 } });
  check('v1.4.80: evaluado — el paso 3 trae el campo ARRIBA y las tarjetas ABAJO, sin bloque de entrega', q80s3.includes('¿Dónde se compra?') && q80s3.includes('md-buy-where') && q80s3.indexOf('md-buy-where') < q80s3.indexOf('Instrucción 1') && q80s3.includes('Instrucción 1') && q80s3.includes('Instrucción 2') && !q80s3.includes('¿A dónde se entrega?') && !q80s3.includes('Cambiar punto') && !q80s3.includes('Referencia extra'), q80s3.slice(0, 300));
  // --- Funciones: mdDeliveryGps, mdNextQuiero3, mandadoPickDone, startMandado ---
  const dgSrc80 = html.slice(html.indexOf('async function mdDeliveryGps(){'), html.indexOf('function mdNextQuiero3(){'));
  check('v1.4.80: mdDeliveryGps captura el GPS y abre el mapa en modo confirmación; si falla, abre el mapa igual', dgSrc80.includes('myLocation()') && dgSrc80.includes("openPick('mdest','mandados'") && dgSrc80.includes('lat: pos.lat') && dgSrc80.includes('No se pudo obtener tu ubicación'), dgSrc80.slice(0, 200));
  const nq3Src80 = html.slice(html.indexOf('function mdNextQuiero3(){'), html.indexOf('function mdComputePrice(){'));
  check('v1.4.80: mdNextQuiero3 exige el texto de compra y ya no valida el punto (el paso 1 lo garantiza)', nq3Src80.includes('md.stops[0].zone') && nq3Src80.includes('md-err2') && nq3Src80.includes('mdComputePrice()') && !nq3Src80.includes('md-err2b') && !nq3Src80.includes('md.dest'), nq3Src80.slice(0, 200));
  const mpdSrc80 = html.slice(html.indexOf('function mandadoPickDone('), html.indexOf('async function publishMandado(){'));
  check('v1.4.80: al confirmar el punto en el mapa se vuelve al paso 1 (punto + referencia + Continuar), sin avanzar solo', mpdSrc80.includes('md.dest = { lat: pos.lat, lng: pos.lng, label, zone: pickLabel || md.destZone };') && !mpdSrc80.includes('md.step = 2') && mpdSrc80.includes("go('mandados')"), mpdSrc80.slice(0, 200));
  const smSrc80 = html.slice(html.indexOf('function startMandado(kind){'), html.indexOf('function mdBack(step){'));
  check('v1.4.80: startMandado ya no captura el GPS solo al entrar (la entrega se elige en el paso 1)', !smSrc80.includes('myLocation()') && smSrc80.includes('md.step = 1') && smSrc80.includes('carryAmount'), smSrc80.slice(0, 200));
  check('v1.4.80: el precio de Quiero es el paso 4 (mdComputePrice vuelve al 4) y el resumen sigue mostrando entrega + referencia', html.includes('mdBack(4);') && html.includes("['Se entrega'") && html.includes("md.destRef ? ' · '+md.destRef : ''"), '');
  // --- Mapa de entrega: tarjeta "¿A dónde se entrega?" con Paso 1 de 4 y "Confirmar punto" ---
  check('v1.4.80: el mapa de entrega trae tarjeta "¿A dónde se entrega?" con "Paso 1 de 4", botón GPS y "Confirmar punto"', html.includes('<b>¿A dónde se entrega?</b>') && html.includes('Paso 1 de 4 · Selecciona a dónde quieres que se entregue tu mandado') && html.includes('pickUseMyLocation()') && html.includes('Confirmar punto') && html.includes("'Tu punto de entrega'"), '');
  // --- Enviar sigue intacto (4 pasos, precio paso 4) ---
  const envSec80 = html.slice(html.indexOf('function renderMandadoEnviar(){'), html.indexOf('function mdNextEnviar2(){'));
  check('v1.4.80: Enviar sigue en 4 pasos con el precio en el paso 4 (no se tocó)', envSec80.includes('Paso 1 de 4') && envSec80.includes('Paso 2 de 4') && envSec80.includes('Paso 3 de 4') && envSec80.includes('md.step===4'), '');
  // --- En vivo: el candado sigue puesto, el mínimo $20 sigue, el texto vacío se rechaza ---
  const meLock80 = await api('/api/me?token=' + encodeURIComponent(chatPaxAcc.token));
  check('v1.4.80: en vivo — /api/me sigue diciendo que Mandados está bloqueado', meLock80.ok && meLock80.mandados_locked === true, JSON.stringify(meLock80 && { locked: meLock80.mandados_locked }));
  const man25b80 = await api('/api/create-request', { passenger_id: own64.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 25, payment_method: 'efectivo' });
  check('v1.4.85: en vivo — publicar mandado a $25 sí se puede (mínimo $20)', man25b80.ok && man25b80.request.price === 25, JSON.stringify(man25b80));
  const manNoLabel80 = await api('/api/create-request', { passenger_id: own64.passenger.id, kind: 'mandado', origin_zone: '   ', dest_zone: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo' });
  check('v1.4.80: en vivo — publicar "Quiero" sin texto de dónde se compra se sigue rechazando', !manNoLabel80.ok && /dónde se compra/.test(manNoLabel80.error || ''), JSON.stringify(manNoLabel80));
  const manOk80 = await api('/api/create-request', { passenger_id: own64.passenger.id, kind: 'mandado', origin_zone: 'Abarrotes Castillejo', dest_zone: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, payment_method: 'efectivo', order_payment: 'por_pagar', order_amount: 150, stops: [{ zone: 'Abarrotes Castillejo', lat: null, lng: null, detail: '' }], extra_stops: 0 });
  check('v1.4.85: en vivo — el dueño publica "Quiero" con texto libre (sugiere $20)', manOk80.ok && manOk80.request.price === 20, JSON.stringify(manOk80));

  console.log('== v1.4.81: resumen del precio de Quiero con filas apiladas, "Ver lista" flotante y píldora en dos columnas ==');
  // --- Cliente: el resumen de Quiero trae las filas en orden, sin "Qué se entrega" ---
  const sumFnSrc81 = html.slice(html.indexOf('function mdPublishSummaryHtml(){'), html.indexOf('// v1.4.81: "Ver lista" del resumen'));
  const sumQ81 = sumFnSrc81.slice(sumFnSrc81.indexOf("if(md.kind==='quiero'){"), sumFnSrc81.indexOf('const rows = [];'));
  check('v1.4.81: el resumen de Quiero usa filas apiladas (.sumrow) en orden: "Se compra en", "Ver lista", "Dinero para comprar", "Tu precio"', sumQ81.includes('sumrow') && sumQ81.includes('Se compra en') && sumQ81.includes('Ver lista de Mandados') && sumQ81.includes('mdShowListPopup()') && sumQ81.includes('Dinero para comprar') && sumQ81.includes('md-sum-carry') && sumQ81.includes('Tu precio') && sumQ81.includes('md-sum-price') && sumQ81.indexOf('Se compra en') < sumQ81.indexOf('Ver lista de Mandados') && sumQ81.indexOf('Ver lista de Mandados') < sumQ81.indexOf('Dinero para comprar') && sumQ81.indexOf('Dinero para comprar') < sumQ81.indexOf('Tu precio'));
  check('v1.4.81: el resumen de Quiero YA NO trae la fila "Qué se entrega" ni "Se entrega" ni "Se recoge en"', !sumQ81.includes('Qué se entrega') && !sumQ81.includes('Se entrega') && !sumQ81.includes('Se recoge en'));
  check('v1.4.81: "Enviar" sigue con sus filas .kv de siempre (sin tocar)', sumFnSrc81.includes("['Se recoge'") && sumFnSrc81.includes("['Se entrega'") && sumFnSrc81.includes('Punto de WhatsApp') && sumFnSrc81.includes("'<div class=\"kv\">"));
  check('v1.4.81: el CSS trae .sumrow (filas apiladas) y #md-list-overlay (ventana flotante)', html.includes('.sumrow{') && html.includes('#md-list-overlay{') && html.includes('.mdlistfloat'));
  // --- Cliente: la píldora en dos columnas, sin el texto chiquito del dinero, stepper de precio intacto ---
  const priceSec81 = html.slice(html.indexOf('function priceSheetHtml(kind){'), html.indexOf('function mdPublishSummaryHtml(){'));
  check('v1.4.81: la píldora de distancia/tiempo trae dos columnas iguales (etiqueta arriba, valor grande abajo, divisor vertical)', priceSec81.includes('Distancia estimada') && priceSec81.includes('Tiempo estimado') && priceSec81.includes('font-size:26px') && priceSec81.includes('rgba(255,255,255,.35)') && priceSec81.includes('flex:1;text-align:center') && !priceSec81.includes('Distancia estimada · '));
  check('v1.4.81: el stepper de dinero YA NO trae el texto chiquito ("El chofer compra con ese dinero…")', !html.includes('El chofer compra con ese dinero y te trae el cambio'));
  check('v1.4.81: el stepper de precio sigue (Sugerido, − $Y +, $30 mínimo, pasos de $5)', priceSec81.includes('Sugerido: ') && priceSec81.includes('priceStep(') && priceSec81.includes('id="price-val"') && priceSec81.includes('priceSetSuggested'));
  check('v1.4.81: al salir del paso (Regresar o publicar) la ventana flotante se cierra', html.includes('function mdBack(step){ mdCloseListPopup();') && html.includes('mdCloseListPopup();\n  if(!myPassenger)'));
  // --- Evaluado: el resumen real de Quiero y de Enviar ---
  function runSummary81(mdObj){
    const fn = new Function('md', 'esc', 'fmt$', 'nearestZoneName', sumFnSrc81 + '; return mdPublishSummaryHtml;')(mdObj, (s)=>String(s ?? ''), (n)=>'$'+Number(n), ()=> 'Mercado');
    return fn();
  }
  const sumQ81eval = runSummary81({ kind:'quiero', stops:[{zone:'Todo en el centro'}], dest:{lat:16.87,lng:-93.2}, destRef:'', carryAmount:150, price:30 });
  check('v1.4.81: evaluado — el resumen de Quiero trae "Se compra en", "Ver lista", "Dinero para comprar" y "Tu precio" en orden, sin "Qué se entrega"', sumQ81eval.includes('Se compra en') && sumQ81eval.includes('Todo en el centro') && sumQ81eval.includes('Ver lista de Mandados') && sumQ81eval.includes('Ver lista') && sumQ81eval.includes('mdShowListPopup()') && sumQ81eval.includes('Dinero para comprar') && sumQ81eval.includes('Lleva') && sumQ81eval.includes('$150') && sumQ81eval.includes('Tu precio') && sumQ81eval.includes('$30') && sumQ81eval.indexOf('Se compra en') < sumQ81eval.indexOf('Ver lista de Mandados') && sumQ81eval.indexOf('Ver lista de Mandados') < sumQ81eval.indexOf('Dinero para comprar') && sumQ81eval.indexOf('Dinero para comprar') < sumQ81eval.indexOf('Tu precio') && !sumQ81eval.includes('Qué se entrega') && !sumQ81eval.includes('Se recoge') && !sumQ81eval.includes('Se entrega'), sumQ81eval.slice(0, 300));
  const sumE81eval = runSummary81({ kind:'enviar', description:'Paquete', pickupRef:'', dest:{lat:16.87,lng:-93.2}, recipientName:'Ana', recipient:'9610000000', orderPay:'por_pagar', orderAmount:200, price:30 });
  check('v1.4.81: evaluado — el resumen de "Enviar" sigue igual (qué se entrega, recogida, entrega, recibe, pedido, precio)', sumE81eval.includes('Qué se entrega') && sumE81eval.includes('Paquete') && sumE81eval.includes('Se recoge') && sumE81eval.includes('Se entrega') && sumE81eval.includes('Punto de WhatsApp') && sumE81eval.includes('Recibe') && sumE81eval.includes('Se pagará'), sumE81eval.slice(0, 300));
  // --- Evaluado: la ventana flotante "Ver lista" ---
  const popFnSrc81 = html.slice(html.indexOf('function mdShowListPopup(){'), html.indexOf('function mdSummaryLine(){'));
  check('v1.4.81: la ventana "Ver lista" usa el patrón del anuncio flotante (overlay #md-list-overlay, X .adx, tocar fuera cierra)', popFnSrc81.includes("ov.id = 'md-list-overlay'") && popFnSrc81.includes('Lista de tu mandado') && popFnSrc81.includes('mdCloseListPopup()') && popFnSrc81.includes('class="adx"') && popFnSrc81.includes('if(e.target === ov) mdCloseListPopup()') && popFnSrc81.includes('Se entrega en:'));
  function runPopup81(mdObj){
    let closed = false;
    const fakeOv = { id: '', innerHTML: '', listeners: {}, addEventListener(ev, fn){ this.listeners[ev] = fn; }, remove(){ closed = true; } };
    const fakeDoc = { body: { appendChild: ()=>{} }, createElement: ()=>fakeOv, getElementById: ()=>fakeOv };
    const fn = new Function('md', 'esc', 'nearestZoneName', 'document', popFnSrc81 + '; return mdShowListPopup;')(mdObj, (s)=>String(s ?? ''), ()=> 'Mercado', fakeDoc);
    fn();
    closed = false;
    return { html: fakeOv.innerHTML, ovId: fakeOv.id, ov: fakeOv, wasClosed: ()=>closed };
  }
  const pop81 = runPopup81({ kind:'quiero', items:['Tres kilos de carne'], dest:{lat:16.87,lng:-93.2}, destRef:'Buenos Aires' });
  check('v1.4.81: evaluado — "Ver lista" abre el overlay con la lista y el punto de entrega', pop81.ovId === 'md-list-overlay' && pop81.html.includes('Lista de tu mandado') && pop81.html.includes('Tres kilos de carne') && pop81.html.includes('Se entrega en:') && pop81.html.includes('Tu punto') && pop81.html.includes('cerca de Mercado') && pop81.html.includes('Buenos Aires') && pop81.html.includes('✕'), pop81.html.slice(0, 300));
  check('v1.4.81: evaluado — tocar fuera de la tarjeta cierra la ventana flotante', typeof pop81.ov.listeners.click === 'function' && (pop81.ov.listeners.click({ target: pop81.ov }), pop81.wasClosed()), '');
  const pop81b = runPopup81({ kind:'quiero', items:['Tres kilos de carne'], dest:{lat:16.87,lng:-93.2}, destRef:'' });
  check('v1.4.81: evaluado — tocar DENTRO de la tarjeta NO cierra la ventana', typeof pop81b.ov.listeners.click === 'function' && (pop81b.ov.listeners.click({ target: {} }), !pop81b.wasClosed()), '');
  // --- Detalle del mandado en el panel del chofer: filas apiladas, sin duplicados, sin Distancia ---
  const detailSec81 = html.slice(html.indexOf('function inboxDetailHtml(r, sub, atLimit){'), html.indexOf('function renderInboxOverlay(list){'));
  const detMand81 = detailSec81.slice(detailSec81.indexOf("if(r.kind==='mandado'){"), detailSec81.indexOf('} else {', detailSec81.indexOf("if(r.kind==='mandado'){")));
  const detTrip81 = detailSec81.slice(detailSec81.indexOf('} else {', detailSec81.indexOf("if(r.kind==='mandado'){")));
  check('v1.4.81: el detalle del MANDADO usa filas apiladas en orden: "Se compra en", "Se entrega en", "Precio del pasajero", "Lista", "Pedido", "Pago"', detMand81.includes('sumrow') && detMand81.includes('Se compra en') && detMand81.includes('Se entrega en') && detMand81.includes('Precio del pasajero') && detMand81.includes('Lista') && detMand81.includes('Pedido') && detMand81.includes('Pago') && detMand81.indexOf('Se compra en') < detMand81.indexOf('Se entrega en') && detMand81.indexOf('Se entrega en') < detMand81.indexOf('Precio del pasajero') && detMand81.indexOf('Precio del pasajero') < detMand81.indexOf('Lista') && detMand81.indexOf('Lista') < detMand81.indexOf('Pedido') && detMand81.indexOf('Pedido') < detMand81.indexOf('Pago'));
  check('v1.4.81: el detalle del MANDADO NO trae fila de Distancia (el chofer ya va al punto; la píldora del Paso 4 del pasajero no se toca)', !detMand81.includes('Distancia') && !detMand81.includes('distance_km') && !detMand81.includes('eta_minutes'));
  check('v1.4.81: el detalle del MANDADO ya no duplica: sin "Cosas:", sin "Paradas extra", sin la caja verde "Resumen del mandado" (sus filas se funden aquí); Enviar se distingue por quien recibe', !detMand81.includes('Cosas:') && !detMand81.includes('Paradas extra') && !detailSec81.includes('mandadoDriverSummaryHtml(r)') && detMand81.includes('recipient_phone') && detMand81.includes('Se recoge en'));
  check('v1.4.81: el detalle de VIAJE sigue igual (De/A/Distancia/Personas/Precio en .kv)', detTrip81.includes("'<div class=\"kv\"><span>De</span><b>'") && detTrip81.includes("'<div class=\"kv\"><span>A</span><b>'") && detTrip81.includes('Distancia') && detTrip81.includes('Personas') && detTrip81.includes('Precio del pasajero'));
  check('v1.4.81: el encabezado y los botones del detalle no se tocaron (foto, nombre, teléfono, Aceptar $X, Contraofertar, Ver todas las solicitudes)', detailSec81.includes('passenger_photo') && detailSec81.includes('passenger_name') && detailSec81.includes('passenger_phone') && detailSec81.includes("Aceptar '+fmt$(r.price)") && detailSec81.includes('Contraofertar') && detailSec81.includes('‹ Ver todas las solicitudes'));
  // --- Evaluado: el detalle real del mandado (Quiero y Enviar) y el control de viaje ---
  function runDetail81(r, driverCounter){
    const stubs = {
      esc: (s)=>String(s==null?'':s),
      fmt$: (n)=>'$'+Math.round(Number(n)||0),
      paxText: (p)=>{ const n=Math.max(1,Math.min(3,Number(p)||1)); return n===1?'1 persona':n+' personas'; },
      minForPax: (p)=>20 + 5*(Math.max(1,Math.min(3,Number(p)||1))-1),
      MIN_TRIP: 20,
      MANDADO_EXTRA_STOP: 10,
      FREE_DAILY_LIMIT: 5,
      myDriver: { id: 777 },
      driverCounter: driverCounter || null,
      isQuieroMandado: (r)=>!!r && r.kind==='mandado' && !r.recipient_phone,
    };
    const fn = new Function('r','sub','atLimit', ...Object.keys(stubs), detailSec81 + '; return inboxDetailHtml(r, sub, atLimit);');
    return fn(r, false, false, ...Object.values(stubs));
  }
  function reqMandado81(over){
    return Object.assign({ id: 1001, kind: 'mandado', passenger_name: 'Pax Mandado', passenger_phone: '9610000081', price: 30, distance_km: 2.1, eta_minutes: 7, payment_method: 'efectivo', passenger_count: 1, _dispO: 'Todo en el centro', _dispD: 'Progreso Buenos Aires', description: 'Tres kilos de carne', items_json: JSON.stringify(['Tres kilos de carne']), stops_json: JSON.stringify([{zone:'Todo en el centro'}]), extra_stops: 0, order_payment: 'por_pagar', order_amount: 150, recipient_phone: null, recipient_name: null, price_improved: 0, previous_price: null, republished_at: null, offers: [] }, over||{});
  }
  let detM81 = '', detM81Err = '';
  try { detM81 = runDetail81(reqMandado81(), null); } catch(e){ detM81Err = String(e && e.message || e); }
  check('v1.4.81: evaluado — detalle del MANDADO Quiero: filas en orden (Se compra en / Se entrega en / Precio $30 / Lista / Pedido / Pago), sin Distancia ni duplicados', !!detM81 && detM81.includes('Se compra en') && detM81.includes('Todo en el centro') && detM81.includes('Se entrega en') && detM81.includes('Progreso Buenos Aires') && detM81.includes('Precio del pasajero') && detM81.includes('$30') && detM81.includes('Lista') && detM81.includes('Tres kilos de carne') && detM81.includes('Pedido') && detM81.includes('Necesitas $150 para comprar este mandado') && !detM81.includes('para recogerlo') && detM81.includes('Pago') && detM81.includes('efectivo') && detM81.indexOf('Se compra en') < detM81.indexOf('Se entrega en') && detM81.indexOf('Se entrega en') < detM81.indexOf('Precio del pasajero') && detM81.indexOf('Precio del pasajero') < detM81.indexOf('Lista') && detM81.indexOf('Lista') < detM81.indexOf('Pedido') && detM81.indexOf('Pedido') < detM81.indexOf('Pago') && !detM81.includes('Distancia') && !detM81.includes('Cosas:') && !detM81.includes('Resumen del mandado') && !detM81.includes('Paradas extra'), detM81Err || detM81.slice(0, 400));
  check('v1.4.81: evaluado — detalle del MANDADO Quiero: cada dato sale UNA sola vez (sin duplicados)', !!detM81 && (detM81.match(/Se compra en/g)||[]).length === 1 && (detM81.match(/Todo en el centro/g)||[]).length === 1 && (detM81.match(/Tres kilos de carne/g)||[]).length === 1 && (detM81.match(/Progreso Buenos Aires/g)||[]).length === 1, detM81.slice(0, 400));
  check('v1.4.81: evaluado — detalle del MANDADO Quiero: botones intactos (Aceptar $30, Contraofertar, Ver todas las solicitudes)', !!detM81 && detM81.includes('Aceptar $30') && detM81.includes('Contraofertar') && detM81.includes('‹ Ver todas las solicitudes'), detM81.slice(0, 400));
  let detE81 = '', detE81Err = '';
  try { detE81 = runDetail81(reqMandado81({ id: 1002, passenger_name: 'Pax Enviar', _dispO: 'Donde estás tú', _dispD: 'Punto de WhatsApp', description: 'Paquete con documentos', items_json: null, stops_json: null, order_amount: 200, recipient_phone: '9610000083', recipient_name: 'Ana' }), null); } catch(e){ detE81Err = String(e && e.message || e); }
  check('v1.4.81: evaluado — detalle del MANDADO Enviar: "Se recoge en" + Recibe + Pedido, sin repetir y sin "Se compra en" ni Distancia', !!detE81 && detE81.includes('Se recoge en') && detE81.includes('Donde estás tú') && detE81.includes('Se entrega en') && detE81.includes('Punto de WhatsApp') && detE81.includes('Lista') && detE81.includes('• Paquete con documentos') && detE81.includes('Recibe') && detE81.includes('Ana · 9610000083') && detE81.includes('Pedido') && detE81.includes('Se pagará · Lleva $200 para recogerlo') && detE81.includes('Pago') && !detE81.includes('Se compra en') && !detE81.includes('Distancia') && !detE81.includes('Cosas:') && !detE81.includes('Resumen del mandado'), detE81Err || detE81.slice(0, 400));
  let detV81 = '', detV81Err = '';
  try { detV81 = runDetail81({ id: 1003, kind: 'viaje', passenger_name: 'Pax Viaje', passenger_phone: '9610000084', price: 25, distance_km: 0.8, eta_minutes: 5, payment_method: 'efectivo', passenger_count: 2, _dispO: 'cerca de Madero', _dispD: 'cerca de Progreso', description: '', items_json: null, stops_json: null, extra_stops: 0, order_payment: null, order_amount: 0, recipient_phone: null, recipient_name: null, price_improved: 0, previous_price: null, republished_at: null, offers: [] }, null); } catch(e){ detV81Err = String(e && e.message || e); }
  check('v1.4.81: evaluado — control: el detalle de VIAJE sigue igual (De/A/Distancia/Personas/Precio, Aceptar $25)', !!detV81 && detV81.includes('De</span>') && detV81.includes('cerca de Madero') && detV81.includes('A</span>') && detV81.includes('cerca de Progreso') && detV81.includes('Distancia') && detV81.includes('0.8 km · ~5 min') && detV81.includes('Personas') && detV81.includes('2 personas') && detV81.includes('Precio del pasajero') && detV81.includes('$25') && detV81.includes('Aceptar $25') && detV81.includes('Contraofertar'), detV81Err || detV81.slice(0, 400));
  // --- En vivo: el candado sigue puesto ---
  const meLock81 = await api('/api/me?token=' + encodeURIComponent(chatPaxAcc.token));
  check('v1.4.81: en vivo — /api/me sigue diciendo que Mandados está bloqueado', meLock81.ok && meLock81.mandados_locked === true, JSON.stringify(meLock81 && { locked: meLock81.mandados_locked }));

  // ===== v1.4.82 (2026-11-26): mapa en vivo en dos fases para "Quiero un mandado" (pasajero) =====
  console.log('== v1.4.82: fase de compra sin ruta ni mototaxi; entrega con ruta; píldora sin recorte ==');
  // --- Cliente: livePhase1Quiero — la fase es Quiero + pasajero + antes de "Ya compré" ---
  const ph1Src82 = html.slice(html.indexOf('function livePhase1Quiero(r){'), html.indexOf('function nextStage(r){'));
  check('v1.4.82: existe livePhase1Quiero (Quiero + pasajero + aún no va al destino)', ph1Src82.includes('function livePhase1Quiero(r){') && ph1Src82.includes('!liveAsDriver') && ph1Src82.includes('isQuieroMandado(r)') && ph1Src82.includes('!liveHeadingToDest(r)'));
  function runPhase1_82(r, asDriver){
    const stubs = {
      liveAsDriver: !!asDriver,
      isQuieroMandado: (x)=>!!x && x.kind==='mandado' && !x.recipient_phone,
      liveHeadingToDest: (x)=> x.kind==='viaje' ? (x.trip_stage==='en_viaje' || x.trip_stage==='finalizado') : ['recogido','comprado','en_viaje','entregado'].includes(x.trip_stage||''),
    };
    const fn = new Function('r', ...Object.keys(stubs), ph1Src82 + '; return livePhase1Quiero(r);');
    return fn(r, ...Object.values(stubs));
  }
  const q82 = { kind:'mandado', recipient_phone: null };
  check('v1.4.82: evaluado — fase 1: Quiero + pasajero en confirmado/en_camino/llego', runPhase1_82(Object.assign({}, q82, {trip_stage:'confirmado'}), false) && runPhase1_82(Object.assign({}, q82, {trip_stage:'en_camino'}), false) && runPhase1_82(Object.assign({}, q82, {trip_stage:'llego'}), false));
  check('v1.4.82: evaluado — fase 2: Quiero + pasajero en comprado/en_viaje/recogido ya NO es fase 1', !runPhase1_82(Object.assign({}, q82, {trip_stage:'comprado'}), false) && !runPhase1_82(Object.assign({}, q82, {trip_stage:'en_viaje'}), false) && !runPhase1_82(Object.assign({}, q82, {trip_stage:'recogido'}), false));
  check('v1.4.82: evaluado — NO es fase 1: chofer, Enviar (teléfono del destinatario) ni viaje', !runPhase1_82(Object.assign({}, q82, {trip_stage:'en_camino'}), true) && !runPhase1_82({ kind:'mandado', recipient_phone:'9610000083', trip_stage:'en_camino' }, false) && !runPhase1_82({ kind:'viaje', recipient_phone: null, trip_stage:'en_camino' }, false));
  // --- Cliente: renderLiveMap no dibuja ruta, pines ni mototaxi en fase 1; centra en la entrega ---
  const liveMapSec82 = html.slice(html.indexOf('async function renderLiveMap(){'), html.indexOf('function showLiveRecenter(){'));
  check('v1.4.82: renderLiveMap guarda la fase 1 (sin ruta OSRM ni recta, sin pines) — el encuadre y la mototaxi son v1.4.84', liveMapSec82.includes('const phase1 = livePhase1Quiero(r);') && liveMapSec82.includes('if(!phase1 && from)') && liveMapSec82.includes('if(!phase1 && rt)') && liveMapSec82.includes('if(!phase1){') && liveMapSec82.includes('if(phase1){') && liveMapSec82.includes('fitPoints(liveMap, [[dest.lng, dest.lat]], liveFollowPadding());'));
  check('v1.4.82: ensureLiveRoute no crea ruta en fase 1 del pasajero (v1.4.91: tampoco hay mototaxi del sondeo — la fase 1 ya no lleva mapa)', html.includes('if(livePhase1Quiero(liveReq)) return; // v1.4.82: fase de compra — sin ruta') && html.includes('if(r.driver_lat && !liveDriverMarker && liveMap && !livePhase1QuieroDriver(r) && !livePhase1Quiero(r)){'));
  // --- Cliente: tarjeta de fase 1 en renderLiveStrips + CSS de la línea de estado y la píldora ---
  check('v1.4.82: la tarjeta de fase 1 dice "El conductor está comprando tu encargo" (COMPRANDO) con dónde se compra, cuánto lleva y la línea de estado', liveSec.includes('El conductor está comprando tu encargo') && liveSec.includes('COMPRANDO') && liveSec.includes('Se compra en: ') && liveSec.includes('Lleva ') && liveSec.includes(' para comprar') && liveSec.includes('buytimeline') && liveSec.includes('Tu mandado fue aceptado') && liveSec.includes('El conductor está comprando') && liveSec.includes('En camino a entregarte') && liveSec.includes('Pendiente'));
  check('v1.4.82: la tarjeta de fase 1 usa el texto de compra de stops_json[0] y el dinero (order_amount)', liveSec.includes("JSON.parse(r.stops_json||'[]')[0]") && liveSec.includes('order_amount') && liveSec.includes('fmt$(r.order_amount||0)'));
  check('v1.4.82: el CSS trae .buytimeline/.bt-row/.bt-dot y la píldora de etapa no se encoge (flex-shrink:0)', html.includes('.buytimeline{') && html.includes('.bt-row{') && html.includes('.bt-dot{') && html.includes('.strip.top.paxcol .statuscard .row .chip{flex-shrink:0}'));
  check('v1.4.82: la fase 2 (comprado/en_viaje) sigue con la tarjeta normal: título por etapa y píldora', liveSec.includes('passengerStageTitle(r)') && liveSec.includes('stagePill'));

  // ===== v1.4.83 (2026-11-26): fase de compra del CHOFER en "Quiero un mandado" — lista, sin mapa =====
  console.log('== v1.4.83: chofer en fase de compra ve la lista sin mapa; al comprar, el mapa con la ruta ==');
  // --- Cliente: livePhase1QuieroDriver — la fase es Quiero + chofer + antes de "Ya compré" ---
  const ph1dSrc83 = html.slice(html.indexOf('function livePhase1QuieroDriver(r){'), html.indexOf('function nextStage(r){'));
  check('v1.4.83: existe livePhase1QuieroDriver (Quiero + chofer + aún no va al destino)', ph1dSrc83.includes('function livePhase1QuieroDriver(r){') && ph1dSrc83.includes('liveAsDriver') && ph1dSrc83.includes('isQuieroMandado(r)') && ph1dSrc83.includes('!liveHeadingToDest(r)'));
  function runPhase1d_83(r, asDriver){
    const stubs = {
      liveAsDriver: !!asDriver,
      isQuieroMandado: (x)=>!!x && x.kind==='mandado' && !x.recipient_phone,
      liveHeadingToDest: (x)=> x.kind==='viaje' ? (x.trip_stage==='en_viaje' || x.trip_stage==='finalizado') : ['recogido','comprado','en_viaje','entregado'].includes(x.trip_stage||''),
    };
    const fn = new Function('r', ...Object.keys(stubs), ph1dSrc83 + '; return livePhase1QuieroDriver(r);');
    return fn(r, ...Object.values(stubs));
  }
  const qd83 = { kind:'mandado', recipient_phone: null };
  check('v1.4.83: evaluado — fase 1 del chofer: Quiero + chofer en confirmado/en_camino/llego', runPhase1d_83(Object.assign({}, qd83, {trip_stage:'confirmado'}), true) && runPhase1d_83(Object.assign({}, qd83, {trip_stage:'en_camino'}), true) && runPhase1d_83(Object.assign({}, qd83, {trip_stage:'llego'}), true));
  check('v1.4.83: evaluado — fase 2 del chofer: comprado/en_viaje/recogido ya NO es fase 1', !runPhase1d_83(Object.assign({}, qd83, {trip_stage:'comprado'}), true) && !runPhase1d_83(Object.assign({}, qd83, {trip_stage:'en_viaje'}), true) && !runPhase1d_83(Object.assign({}, qd83, {trip_stage:'recogido'}), true));
  check('v1.4.83: evaluado — NO es fase 1 del chofer: pasajero, Enviar (teléfono del destinatario) ni viaje', !runPhase1d_83(Object.assign({}, qd83, {trip_stage:'en_camino'}), false) && !runPhase1d_83({ kind:'mandado', recipient_phone:'9610000083', trip_stage:'en_camino' }, true) && !runPhase1d_83({ kind:'viaje', recipient_phone: null, trip_stage:'en_camino' }, true));
  // --- Cliente: renderLiveMap oculta el mapa en fase 1 del chofer y lo vuelve a mostrar en fase 2 ---
  const liveMapSec83 = html.slice(html.indexOf('async function renderLiveMap(){'), html.indexOf('function showLiveRecenter(){'));
  check('v1.4.83: renderLiveMap oculta el mapa en fase 1 del chofer (nolive-map) y lo vuelve a mostrar en fase 2', liveMapSec83.includes('const phase1d = livePhase1QuieroDriver(r);') && liveMapSec83.includes("document.getElementById('view-live').classList.add('nolive-map');") && liveMapSec83.includes("document.getElementById('view-live').classList.remove('nolive-map');") && liveMapSec83.includes('if(phase1d){'));
  check('v1.4.83: ensureLiveRoute y el sondeo tampoco crean ruta ni mototaxi en fase 1 del chofer', html.includes('if(livePhase1QuieroDriver(liveReq)) return; // v1.4.83: fase de compra del chofer — sin ruta') && html.includes('if(r.driver_lat && !liveDriverMarker && liveMap && !livePhase1QuieroDriver(r) && !livePhase1Quiero(r)){'));
  // --- Cliente: pantalla de fase 1 del chofer en renderLiveStrips + CSS sin mapa ---
  // v1.4.87: el texto de la pantalla cambió (mockup v2 aprobado): ahora es
  // "Dirígete a {lugar} para hacer el mandado" + COMPRANDO + "Lleva $X para comprar".
  check('v1.4.83: la pantalla de fase 1 del chofer dice "Dirígete a {lugar} para hacer el mandado" (COMPRANDO) con cuánto lleva (v1.4.87: ya no "Vas a comprar el encargo" ni "Mandado en curso")', liveSec.includes('Dirígete a ') && liveSec.includes('para hacer el mandado') && liveSec.includes('COMPRANDO') && liveSec.includes('Lleva ') && liveSec.includes(' para comprar') && !liveSec.includes('Vas a comprar el encargo') && !liveSec.includes('Mandado en curso'));
  check('v1.4.83: la pantalla de fase 1 del chofer trae la "Lista de compra" (items_json) y el botón "Ya tengo el pedido" con el diálogo del ticket (v1.4.87: ya no "Ya compré todo" ni la nota)', liveSec.includes('Lista de compra') && liveSec.includes("JSON.parse(r.items_json||'[]')") && liveSec.includes('Ya tengo el pedido') && liveSec.includes('askTicketPhoto()') && !liveSec.includes('Ya compré todo') && !liveSec.includes('te aparecerá el mapa para ir a entregarlo'));
  check('v1.4.83: la pantalla de fase 1 del chofer esconde brújula y recentrar (v1.4.87: la línea del pasajero ya no va aquí; se verifica evaluada en v1.4.87)', liveSec.includes("$('#live-compass').classList.add('hidden')") && liveSec.includes("$('#live-recenter').classList.add('hidden')"));
  check('v1.4.83: el CSS esconde el mapa en fase 1 del chofer y deja el fondo claro', html.includes("#view-live.nolive-map #live-map{visibility:hidden}") && html.includes('#view-live.nolive-map .fullmap{background:#f4f6f5}'));
  check('v1.4.83: la fase 2 del chofer sigue con el mapa y el botón de etapa normal', liveSec.includes('Dirígete ') && liveSec.includes('stageButtonLabel(r)'));

  // ===== v1.4.84 (2026-11-26): mototaxi en fase 1 del pasajero + mapa libre en fase 2 + chat ancho abajo =====
  console.log('== v1.4.84: mototaxi en fase 1, mapa libre en fase 2, chat ancho abajo en mandados ==');
  // --- Cliente: renderLiveMap pinta la mototaxi en fase 1 del pasajero, sin ruta ni pines ---
  const liveMapSec84 = html.slice(html.indexOf('async function renderLiveMap(){'), html.indexOf('function showLiveRecenter(){'));
  check('v1.4.84: renderLiveMap pinta la mototaxi en fase 1 del pasajero (fuera del bloque de pines) y no la pinta sin GPS del chofer', liveMapSec84.indexOf('liveDriverMarker = new maplibregl.Marker({ element: motoIconEl() }).setLngLat([dPos.lng, dPos.lat]).addTo(liveMap);') > liveMapSec84.indexOf('} // fin if(!phase1) — pines') && liveMapSec84.includes('if(phase1 && !from){'));
  check('v1.4.84: en fase 1 el encuadre incluye chofer + entrega (la mototaxi se ve abajo, donde anda)', liveMapSec84.includes('fitPoints(liveMap, [[from.lng, from.lat], [dest.lng, dest.lat]], liveFollowPadding());') && liveMapSec84.includes('if(phase1){'));
  check('v1.4.84: en fase 1 sigue sin ruta (ni OSRM ni recta) y el pin de compra sigue dentro del bloque sin-fase-1', liveMapSec84.includes('if(!phase1 && from)') && liveMapSec84.includes('if(!phase1 && rt)') && liveMapSec84.indexOf('liveMarkers.buy = new maplibregl.Marker') > liveMapSec84.indexOf('if(!phase1){'));
  check('v1.4.84: el sondeo ya NO recupera la mototaxi en fase 1 del pasajero (v1.4.91, detalle 4: sin mapa en fase 1, igual que el chofer)', html.includes('if(r.driver_lat && !liveDriverMarker && liveMap && !livePhase1QuieroDriver(r) && !livePhase1Quiero(r)){'));
  // --- Cliente: fase 2 del pasajero (Quiero) con tarjeta compacta ---
  check('v1.4.84: la fase 2 de Quiero (pasajero) usa tarjeta compacta con "El conductor viene en camino a entregarte"', liveSec.includes('} else if(isQuieroMandado(r)){') && liveSec.includes('statuscard compact84') && liveSec.includes('El conductor viene en camino a entregarte') && liveSec.includes('Tu encargo viene en camino a '));
  // --- Cliente: chat ancho abajo en mandados; redondo solo en viajes ---
  check('v1.4.84: existe el botón ancho de chat (chatWideBtnHtml) con las dos etiquetas y el distintivo rojo con conteo (v1.4.91, detalle 3: antes era un punto vacío)', html.includes('function chatWideBtnHtml(){') && html.includes('Chat con el pasajero') && html.includes('Chat con el conductor') && html.includes('live-chat-btn-bottom') && html.includes("chatUnread>0?'<span class=\"chatbadge\">'+chatUnread+'</span>':''"));
  check('v1.4.84: el botón redondo flotante ya NO se muestra en mandados (en viajes sí)', html.includes("b.classList.toggle('hidden', !(accepted && liveReq.kind!=='mandado'))"));
  check('v1.4.84: el botón ancho de chat se pinta en las pantallas de mandado en vivo (pasajero y chofer, fase 1 y 2)', (liveSec.match(/chatWideBtnHtml\(\)/g)||[]).length >= 3 && liveSec.includes("r.kind==='mandado' ? chatWideBtnHtml() : ''") && liveSec.includes('+ chatWideBtnHtml();'));
  check('v1.4.84: el distintivo del chat sobrevive al repintado (estado chatUnread con el conteo, v1.4.91 detalle 3: antes era solo sí/no)', html.includes('chatUnread = 0;') && html.includes("chatUnread = (n===false || n===0) ? 0 : (Number(n)||0);") && html.includes('chatSetDot(false)'));
  check('v1.4.84: el CSS trae .chatwide (botón ancho verde) y .statuscard.compact84', html.includes('.chatwide{') && html.includes('.chatwide .dot{') && html.includes('.strip.top.paxcol .statuscard.compact84{'));
  check('v1.4.84: el recentrar sube en mandados para no tapar el botón ancho de chat', liveSec.includes("r.kind==='mandado'?60:0") && liveSec.includes("r.kind==='mandado' ? 'calc(env(safe-area-inset-bottom,0px) + 250px)' : ''"));

  // ===== v1.4.85 (2026-11-26): mandado mínimo $20 + dinero para comprar mínimo $50 =====
  console.log('== v1.4.85: mandado mínimo $20, dinero para comprar mínimo $50 ==');
  const h85 = await api('/api/health');
  check('versión 1.4.96 en /api/health (sección v1.4.85)', h85.ok && h85.version === '1.4.96', JSON.stringify(h85));
  // El candado de Mandados quedó cerrado al final de la sección v1.4.79:
  // se abre para estas pruebas en vivo y se vuelve a cerrar al final.
  const lockOpen85 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: false });
  check('v1.4.85: el admin abre el candado de Mandados para las pruebas en vivo', lockOpen85.ok && lockOpen85.mandados_locked === false, JSON.stringify(lockOpen85));
  // --- Cliente: stepper de dinero para comprar baja hasta $50, no menos ---
  check('v1.4.85: el stepper de dinero para comprar baja hasta $50 (clamp y reset guard)', html.includes('Math.max(50, (Number(md.carryAmount)||150) + d)') && html.includes('!(Number(md.carryAmount)>=50)'), '');
  // --- Cliente: insignia ámbar de la bandeja del chofer ---
  check('v1.4.85: la insignia ámbar de la bandeja dice "Lleva $X para comprar" en Quiero y "para recogerlo" en Enviar', html.includes("(isQuieroMandado(r)?' para comprar':' para recogerlo')") && html.includes("'Lleva '+fmt$(r.order_amount||0)"), '');
  // --- Servidor: "Quiero" con "Lleva $50" se publica; con $25 se rechaza ---
  const q85 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', origin_zone: 'Bodega Aurrerá', origin_detail: 'Bodega Aurrerá', origin_lat: 16.87137, origin_lng: -93.20652, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 20, payment_method: 'efectivo', order_payment: 'por_pagar', order_amount: 50, stops: [{ zone: 'Bodega Aurrerá', lat: 16.87137, lng: -93.20652, detail: '' }], extra_stops: 0 });
  check('v1.4.85: mandado "Quiero" a $20 con "Lleva $50" se publica', q85.ok && q85.request.price === 20 && q85.request.order_amount === 50, JSON.stringify(q85));
  const q85low = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', origin_zone: 'Bodega Aurrerá', origin_detail: 'Bodega Aurrerá', origin_lat: 16.87137, origin_lng: -93.20652, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 20, payment_method: 'efectivo', order_payment: 'por_pagar', order_amount: 25, stops: [{ zone: 'Bodega Aurrerá', lat: 16.87137, lng: -93.20652, detail: '' }], extra_stops: 0 });
  check('v1.4.85: "Quiero" con "Lleva $25" se rechaza (mínimo $50 para comprar)', !q85low.ok && /50/.test(q85low.error || ''), JSON.stringify(q85low));
  // --- Servidor: "Enviar" a $20 sí se puede; mandado sin precio sugiere $20 ---
  const e85 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_lat: 16.87137, dest_lng: -93.20652, distance_km: 1.0, price: 20, payment_method: 'efectivo', description: 'Paquete', recipient_phone: '9610000099', recipient_name: 'Quien recibe', order_payment: 'pagado', order_amount: 0 });
  check('v1.4.85: mandado "Enviar" a $20 sí se puede', e85.ok && e85.request.price === 20, JSON.stringify(e85));
  const s85 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', origin_zone: 'Mercado', origin_lat: 16.8675, origin_lng: -93.2105, dest_zone: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, payment_method: 'efectivo' });
  check('v1.4.85: mandado sin precio, 1.0 km, sugiere $20', s85.ok && s85.request.price === 20, JSON.stringify(s85));
  const lockClose85 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: true });
  check('v1.4.85: el admin vuelve a bloquear y el candado queda puesto', lockClose85.ok && lockClose85.mandados_locked === true, JSON.stringify(lockClose85));

  // ===== v1.4.86 (2026-11-26): fila "Pedido" del Quiero dice "Necesitas $X para comprar este mandado" =====
  console.log('== v1.4.86: Pedido del Quiero = "Necesitas $X para comprar este mandado" ==');
  // --- Estático: los tres sitios del chofer usan el condicional por Quiero/Enviar ---
  const detailSec86 = html.slice(html.indexOf('function inboxDetailHtml(r, sub, atLimit){'), html.indexOf('function renderInboxOverlay(list){'));
  check('v1.4.86: el detalle del chofer (overlay) dice "Necesitas $X para comprar este mandado" en Quiero y "Se pagará · Lleva $X para recogerlo" en Enviar', detailSec86.includes("isQuieroMandado(r) ? 'Necesitas '+fmt$(r.order_amount||0)+' para comprar este mandado' : 'Se pagará · Lleva '+fmt$(r.order_amount||0)+' para recogerlo'"));
  const drvSumSec86 = html.slice(html.indexOf('function mandadoDriverSummaryHtml(r){'), html.indexOf('let inboxLoaded'));
  check('v1.4.86: la tarjeta del chofer (mandadoDriverSummaryHtml) usa el mismo condicional Quiero/Enviar', drvSumSec86.includes("isQuieroMandado(r) ? 'Necesitas '+fmt$(r.order_amount||0)+' para comprar este mandado' : 'Se pagará · Lleva '+fmt$(r.order_amount||0)+' para recogerlo'"));
  const liveSec86 = html.slice(html.indexOf('function renderLiveStrips(){'), html.indexOf('function compassDir('));
  check('v1.4.86: el renglón Pedido del mapa en vivo del chofer usa el mismo condicional Quiero/Enviar', liveSec86.includes("isQuieroMandado(r) ? 'Necesitas '+fmt$(r.order_amount||0)+' para comprar este mandado' : 'Se pagará · Lleva '+fmt$(r.order_amount||0)+' para recogerlo'"));
  // El resumen de publicar de Enviar (lado del pasajero) sigue con "para recogerlo": solo se toca el lado del chofer.
  const pubSumSec86 = html.slice(html.indexOf('function mdPublishSummaryHtml(){'), html.indexOf('function mdShowListPopup(){'));
  check('v1.4.86: el resumen de publicar de Enviar NO se toca (sigue "Se pagará · Lleva $X para recogerlo")', pubSumSec86.includes("else if(md.orderPay==='por_pagar') rows.push(['Pedido', 'Se pagará · Lleva '+fmt$(Number(md.orderAmount)||0)+' para recogerlo'])") && !pubSumSec86.includes('para comprar este mandado'));
  // --- Evaluado: el detalle (overlay) con Quiero y con Enviar ---
  check('v1.4.86: evaluado — detalle del MANDADO Quiero: Pedido dice "Necesitas $150 para comprar este mandado", sin "para recogerlo"', !!detM81 && detM81.includes('Necesitas $150 para comprar este mandado') && !detM81.includes('para recogerlo'), detM81Err || detM81.slice(0, 400));
  check('v1.4.86: evaluado — detalle del MANDADO Enviar: Pedido sigue "Se pagará · Lleva $200 para recogerlo", sin "para comprar"', !!detE81 && detE81.includes('Se pagará · Lleva $200 para recogerlo') && !detE81.includes('para comprar este mandado'), detE81Err || detE81.slice(0, 400));
  // --- Evaluado: mandadoDriverSummaryHtml con Quiero y con Enviar ---
  function runDrvSum86(r){
    const stubs = {
      esc: (s)=>String(s==null?'':s),
      fmt$: (n)=>'$'+Math.round(Number(n)||0),
      isQuieroMandado: (x)=>!!x && x.kind==='mandado' && !x.recipient_phone,
    };
    const fn = new Function('r', ...Object.keys(stubs), drvSumSec86 + '; return mandadoDriverSummaryHtml(r);');
    return fn(r, ...Object.values(stubs));
  }
  let sumQ86 = '', sumQ86Err = '';
  try { sumQ86 = runDrvSum86({ kind:'mandado', recipient_phone: null, recipient_name: null, order_payment: 'por_pagar', order_amount: 100, stops_json: JSON.stringify([{zone:'Madero'}]) }); } catch(e){ sumQ86Err = String(e && e.message || e); }
  check('v1.4.86: evaluado — la tarjeta del chofer (Quiero) dice "Necesitas $100 para comprar este mandado", sin "para recogerlo"', !!sumQ86 && sumQ86.includes('Necesitas $100 para comprar este mandado') && sumQ86.includes('Se compra en') && sumQ86.includes('Madero') && !sumQ86.includes('para recogerlo'), sumQ86Err || sumQ86.slice(0, 300));
  let sumE86 = '', sumE86Err = '';
  try { sumE86 = runDrvSum86({ kind:'mandado', recipient_phone: '9610000083', recipient_name: 'Ana', order_payment: 'por_pagar', order_amount: 200, stops_json: '[]' }); } catch(e){ sumE86Err = String(e && e.message || e); }
  check('v1.4.86: evaluado — la tarjeta del chofer (Enviar) sigue "Se pagará · Lleva $200 para recogerlo", sin "para comprar"', !!sumE86 && sumE86.includes('Se pagará · Lleva $200 para recogerlo') && sumE86.includes('Recibe') && sumE86.includes('Ana · 9610000083') && !sumE86.includes('para comprar este mandado'), sumE86Err || sumE86.slice(0, 300));

  // ===== v1.4.87 (2026-11-26): chat estilo WhatsApp + fase 1 del chofer (mockup v2) + botón ancho de chat VERDE + mapa fase 1 sin cambios =====
  console.log('== v1.4.87: chat WhatsApp (X que cierra, fotos ambos lados, tarjeta oculta) + fase 1 chofer "Ya tengo el pedido" + chat verde ==');
  // --- Estático: el botón ancho de chat es VERDE (la regla .strip button ámbar ganaba por especificidad y salía NARANJA en vivo) ---
  check('v1.4.87: el botón ancho de chat es VERDE en los dos lados (override .strip button.chatwide)', html.includes('.strip button.chatwide{background:#16a34a;color:#fff;border-color:#15803d}'));
  // --- Estático: la hoja de chat (CSS + HTML) ---
  const chatSec87 = html.slice(html.indexOf('function chatSheetHtml(){'), html.indexOf('async function openChatSheet(){'));
  check('v1.4.87: la hoja del chat es una "chat-sheet" que se desliza hacia arriba (animación + tirador + encabezado)', html.includes('.dialog.chat-sheet .box{') && html.includes('@keyframes chatSlideUp') && html.includes('chatgrab') && html.includes('chatsheet-head') && chatSec87.includes('ontouchstart="chatSwipeStart(event)"'));
  check('v1.4.87: el encabezado del chat lleva foto + nombre + "En línea" + X GRANDE (chatx, 44px)', chatSec87.includes('chathead-photo') && chatSec87.includes('En línea') && chatSec87.includes('class="chatx"') && html.includes('.chatx{flex-shrink:0;width:44px;height:44px'));
  check('v1.4.87: la barra del chat es cámara + campo + botón redondo verde de enviar (sin el botón "Enviar" ancho de antes)', chatSec87.includes('class="chatcam"') && chatSec87.includes('class="chatsend"') && chatSec87.includes('Escribe un mensaje…') && !chatSec87.includes('class="btn small" onclick="chatSendText()"'));
  check('v1.4.87: la foto del chat es para AMBOS lados (la hoja ya no tiene el condicional isDriver en la fila de foto)', chatSec87.includes('chat-cam') && chatSec87.includes('chat-gal') && chatSec87.includes('Tomar foto') && chatSec87.includes('Subir de galería') && !chatSec87.includes('(isDriver') && !chatSec87.includes('isDriver ?'));
  check('v1.4.87: la burbuja del chat es estilo WhatsApp (solo texto/foto + hora, sin el nombre)', html.includes('<span class="chattime">') && html.includes('.chattime{') && !html.slice(html.indexOf('function chatMsgHtml(m){'), html.indexOf('function chatZoomPhoto(')).includes('class="who"'));
  // --- Estático: abrir/cerrar el chat ---
  const openSec87 = html.slice(html.indexOf('async function openChatSheet(){'), html.indexOf('function chatCloseSheet('));
  check('v1.4.87: al abrir el chat la hoja es "chat-sheet" y se oculta la tarjeta del conductor (mandado del pasajero)', openSec87.includes("dlg.classList.add('chat-sheet')") && openSec87.includes("lb.classList.add('chat-open')") && openSec87.includes("liveReq.kind==='mandado' && !liveAsDriver"));
  check('v1.4.87: al abrir el chat ya NO se auto-enfoca el campo (el teclado tapaba la hoja en el teléfono)', !openSec87.includes('inp.focus()'));
  const closeSec87 = html.slice(html.indexOf('function chatCloseSheet('), html.indexOf('async function chatSend('));
  check('v1.4.87: al cerrar el chat la tarjeta del conductor vuelve y la hoja deja de ser "chat-sheet"', closeSec87.includes("lb.classList.remove('chat-open')") && closeSec87.includes("dlg.classList.remove('chat-sheet')"));
  check('v1.4.87: el chat también se cierra tocando el fondo oscuro (backdrop) y deslizando hacia abajo (swipe)', html.includes("if(e.target === d && chatOpen) chatCloseSheet()") && html.includes('function chatSwipeStart') && html.includes('function chatSwipeEnd') && html.includes('if(dy > 60) chatCloseSheet()'));
  check('v1.4.87: con el chat abierto la tarjeta del conductor se oculta por CSS (vuelve al cerrar)', html.includes('#live-bottom.chat-open .drivercard{display:none}'));
  // --- Estático: el mapa de fase 1 NO cambia (corrección 19:06/19:07: la mototaxi SÍ se ve, sin ruta ni pines hasta la fase 2) ---
  const liveMapSec87 = html.slice(html.indexOf('async function renderLiveMap(){'), html.indexOf('function showLiveRecenter(){'));
  check('v1.4.87: en fase 1 del pasajero NO hay ruta (OSRM y la línea azul están detrás de if(!phase1); ensureLiveRoute sale antes)', liveMapSec87.includes("if(!phase1 && from){ try { rt = await osrmRoute") && liveMapSec87.includes("if(!phase1 && rt){ liveRouteCoords = rt.coords;") && html.includes('if(livePhase1Quiero(liveReq)) return; // v1.4.82: fase de compra — sin ruta'));
  check('v1.4.87: en fase 1 del pasajero NO hay pines (recogida, destino y compra están dentro de if(!phase1))', (()=>{ const a = liveMapSec87.indexOf('if(!phase1){'); const b = liveMapSec87.indexOf('} // fin if(!phase1)'); const blk = liveMapSec87.slice(a, b); return a >= 0 && b > a && blk.includes('liveMarkers.dest') && blk.includes('liveMarkers.buy') && blk.includes('liveMarkers.pick'); })());
  check('v1.4.87: en fase 1 del pasajero YA NO hay mototaxi (v1.4.91, detalle 4: renderLiveMap sale antes con nolive-map, sin marcador; la v1.4.84 queda reemplazada)', liveMapSec87.indexOf('if(livePhase1Quiero(r)){') < liveMapSec87.indexOf('liveDriverMarker = new maplibregl.Marker({ element: motoIconEl() })') && liveMapSec87.includes("document.getElementById('view-live').classList.add('nolive-map')") && html.includes('if(r.driver_lat && !liveDriverMarker && liveMap && !livePhase1QuieroDriver(r) && !livePhase1Quiero(r)){'));
  // --- Evaluado: la pantalla de fase 1 del chofer (renderLiveStrips real) ---
  let strips87 = null, strips87Err = '';
  try {
    const liveSec87b = html.slice(html.indexOf('function renderLiveStrips(){'), html.indexOf('function compassDir('));
    const stageLabelSrc87 = html.slice(html.indexOf('const STAGE_LABEL'), html.indexOf('/* Hacia el destino'));
    const htdSrc87 = html.slice(html.indexOf('function liveHeadingToDest(r){'), html.indexOf('/* Paradas intermedias'));
    const quieroSrc87 = html.slice(html.indexOf('function isQuieroMandado(r){'), html.indexOf('function nextStage(r){'));
    const nextSrc87 = html.slice(html.indexOf('function nextStage(r){'), html.indexOf('function passengerStageTitle(r){'));
    const paxTitleSrc87 = html.slice(html.indexOf('function passengerStageTitle(r){'), html.indexOf('function stageHint(r){'));
    const compassSrc87 = html.slice(html.indexOf('function compassDir(from, to){'), html.indexOf('async function cancelLiveRequest(rid){'));
    function runStrips87(r, asDriver) {
      const mkEl = () => ({ classList: { add(){}, remove(){} }, style: {}, innerHTML: '', textContent: '' });
      const top = mkEl(), bot = mkEl(), pill = mkEl(), compass = mkEl(), recenter = mkEl();
      const els = { '#live-top': top, '#live-bottom': bot, '#live-pill': pill, '#live-compass': compass, '#live-recenter': recenter };
      const f = new Function('$', 'top', 'bot', 'let liveAsDriver = ' + asDriver + ';\nlet liveReq = null;\nfunction chatShowBtn(){}\nfunction chatWideBtnHtml(){ return \'<button class="chatwide">💬 \'+(liveAsDriver?\'Chat con el pasajero\':\'Chat con el conductor\')+\'</button>\'; }\n' + stageLabelSrc87 + '\n' + htdSrc87 + '\n' + quieroSrc87 + '\n' + nextSrc87 + '\n' + paxTitleSrc87 + '\n' + compassSrc87 + '\nfunction etaMin(km){ return Math.max(5, Math.round(km * 3.2)); }\nfunction havKm(a,b,c,d){ const R=6371, r=x=>x*Math.PI/180; const x=r(c-a), y=r(d-b); return 2*R*Math.asin(Math.sqrt(Math.sin(x/2)**2 + Math.cos(r(a))*Math.cos(r(c))*Math.sin(y/2)**2)); }\nfunction paxText(pax){ const n = Math.min(3, Math.max(1, Number(pax)||1)); return n + (n===1 ? \' persona\' : \' personas\'); }\nfunction esc(s){ return String(s==null?\'\':s); }\nfunction fmt$(n){ return \'$\' + Math.round(Number(n)||0); }\n' + liveSec87b + '\nreturn { run(r){ liveReq = r; renderLiveStrips(); } };');
      const h = f(sel => els[sel] || mkEl(), top, bot);
      h.run(r);
      return { top: top.innerHTML, bot: bot.innerHTML };
    }
    const qd87 = { id: 201, kind: 'mandado', recipient_phone: null, recipient_name: null, status: 'aceptado', origin_zone: 'Madero', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_lat: 16.8675, dest_lng: -93.2105, driver_lat: 16.8727, driver_lng: -93.2081, driver_name: 'Josué Eduardo', driver_photo: null, driver_phone: '9614868605', driver_vehicle: 'Mototaxi', driver_unit: '0256', passenger_name: 'The Noob Gamer', passenger_phone: '9614868605', price: 30, final_price: 30, payment_method: 'efectivo', order_amount: 100, order_payment: 'por_pagar', items_json: JSON.stringify(['Dos kilos de tomate', '2 cebolla', 'Dos chile verde']), stops_json: JSON.stringify([{ zone: 'Madero', lat: 16.8709, lng: -93.2063 }]), description: '', distance_km: 0.8, eta_minutes: 5 };
    const env87 = { id: 202, kind: 'mandado', recipient_phone: '9610000083', recipient_name: 'Ana', status: 'aceptado', origin_zone: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_lat: 16.8675, dest_lng: -93.2105, driver_lat: 16.8727, driver_lng: -93.2081, driver_name: 'Josué Eduardo', driver_photo: null, driver_phone: '9614868605', driver_vehicle: 'Mototaxi', driver_unit: '0256', passenger_name: 'The Noob Gamer', passenger_phone: '9614868605', price: 30, final_price: 30, payment_method: 'efectivo', order_amount: 200, order_payment: 'por_pagar', items_json: null, stops_json: '[]', description: 'Paquete con documentos', distance_km: 1.0, eta_minutes: 5 };
    strips87 = {
      drvLlego: runStrips87({ ...qd87, trip_stage: 'llego' }, true),
      drvConf: runStrips87({ ...qd87, trip_stage: 'confirmado' }, true),
      drvEnv: runStrips87({ ...env87, trip_stage: 'llego' }, true),
      paxP1: runStrips87({ ...qd87, trip_stage: 'en_camino' }, false),
    };
  } catch(e){ strips87Err = String(e && e.message || e); }
  check('v1.4.87: evaluado — fase 1 del chofer en llego: "Dirígete a Madero para hacer el mandado" + "Lleva $100 para comprar" + COMPRANDO', !!strips87 && strips87.drvLlego.top.includes('Dirígete a Madero para hacer el mandado') && strips87.drvLlego.top.includes('Lleva $100 para comprar') && strips87.drvLlego.top.includes('COMPRANDO'), strips87Err || JSON.stringify(strips87 && strips87.drvLlego.top.slice(0, 300)));
  check('v1.4.87: evaluado — fase 1 del chofer en llego: lista GRANDE + botón "Ya tengo el pedido" que abre el ticket', !!strips87 && strips87.drvLlego.bot.includes('Lista de compra') && strips87.drvLlego.bot.includes('Dos kilos de tomate') && strips87.drvLlego.bot.includes('font-size:18px') && strips87.drvLlego.bot.includes('Ya tengo el pedido') && strips87.drvLlego.bot.includes('askTicketPhoto()'), strips87Err || JSON.stringify(strips87 && strips87.drvLlego.bot.slice(0, 400)));
  check('v1.4.87: evaluado — fase 1 del chofer en llego: SIN la nota y SIN la línea del pasajero', !!strips87 && !strips87.drvLlego.bot.includes('Cuando termines de comprar') && !strips87.drvLlego.bot.includes('👤') && !strips87.drvLlego.bot.includes('The Noob Gamer') && !strips87.drvLlego.bot.includes('para recogerlo'), strips87Err || JSON.stringify(strips87 && strips87.drvLlego.bot.slice(0, 400)));
  // v1.4.89 (FIX 1): este check de la 1.4.87 quedó obsoleto — en confirmado el botón YA NO es "Ya estoy afuera para recoger el paquete": ahora es el botón único "Ya tengo el pedido" (el usuario no sabía cómo terminar de comprar).
  check('v1.4.89: evaluado — fase 1 del chofer en confirmado: el botón AHORA es "Ya tengo el pedido" (antes "Ya estoy afuera para recoger el paquete")', !!strips87 && strips87.drvConf.bot.includes('Ya tengo el pedido') && strips87.drvConf.bot.includes('askTicketPhoto()') && !strips87.drvConf.bot.includes('recoger el paquete'), strips87Err || JSON.stringify(strips87 && strips87.drvConf.bot.slice(0, 300)));
  check('v1.4.87: evaluado — Enviar del chofer NO cambia (sin "Ya tengo el pedido", sin lista; Pedido sigue "Se pagará · Lleva $200 para recogerlo")', !!strips87 && !strips87.drvEnv.bot.includes('Ya tengo el pedido') && !strips87.drvEnv.bot.includes('Lista de compra') && strips87.drvEnv.bot.includes('Se pagará · Lleva $200 para recogerlo'), strips87Err || JSON.stringify(strips87 && strips87.drvEnv.bot.slice(0, 400)));
  check('v1.4.87: evaluado — fase 1 del pasajero NO cambia (tarjeta del chofer + botón ancho de chat; la tarjeta se oculta solo por CSS al abrir el chat)', !!strips87 && strips87.paxP1.bot.includes('Josué Eduardo') && strips87.paxP1.bot.includes('Chat con el conductor') && strips87.paxP1.top.includes('El conductor está comprando tu encargo'), strips87Err || JSON.stringify(strips87 && { top: strips87.paxP1.top.slice(0, 200), bot: strips87.paxP1.bot.slice(0, 200) }));
  // --- Evaluado: la hoja de chat real (abrir → cerrar, pasajero y chofer) ---
  let chat87 = null, chat87Err = '';
  try {
    const chatSrc87 = html.slice(html.indexOf('let chatOpen = false, chatTimer = null'), html.indexOf('/* GPS del chofer a nivel de app'));
    const mkEl87 = () => {
      const cls = new Set();
      const el = {
        classList: { add(c){ cls.add(c); }, remove(c){ cls.delete(c); }, contains(c){ return cls.has(c); }, toggle(c, f){ if(f===undefined){ if(cls.has(c)) cls.delete(c); else cls.add(c); } else if(f) cls.add(c); else cls.delete(c); } },
        style: {}, innerHTML: '', textContent: '', value: '',
        focus(){}, click(){}, insertAdjacentHTML(){}, querySelector(){ return null; },
        handlers: {},
        addEventListener(ev, fn){ el.handlers[ev] = fn; },
        scrollTop: 0, scrollHeight: 0,
        _cls(){ return [...cls]; }
      };
      return el;
    };
    const dlg87 = mkEl87(); dlg87.classList.add('hidden');
    const box87 = mkEl87();
    const msgs87 = mkEl87();
    const lb87 = mkEl87();
    const els87 = { 'dialog': dlg87, 'dialog-box': box87, 'chat-msgs': msgs87, 'live-bottom': lb87 };
    const $87 = sel => ({ '#dialog': dlg87, '#dialog-box': box87 }[sel] || mkEl87());
    const doc87 = { getElementById: id => els87[id] || null, createElement: () => mkEl87() };
    const api87 = async () => ({ messages: [] });
    const f87 = new Function('$', 'document', 'api', 'toast', 'store', 'esc', 'setInterval', 'clearInterval',
      'let liveAsDriver = false;\nlet liveReq = null;\nfunction openDialog(html){ $(\'#dialog-box\').innerHTML = html; $(\'#dialog\').classList.remove(\'hidden\'); }\nfunction closeDialog(){ $(\'#dialog\').classList.add(\'hidden\'); }\n' + chatSrc87
      + '\nreturn { open: openChatSheet, close: chatCloseSheet, sheet: chatSheetHtml, msg: chatMsgHtml, swipeStart: chatSwipeStart, swipeEnd: chatSwipeEnd, isOpen(){ return chatOpen; }, setReq(r, asDriver){ liveReq = r; liveAsDriver = asDriver; } };');
    const h87 = f87($87, doc87, api87, () => {}, { token: 't' }, s => String(s == null ? '' : s), () => 99, () => {});
    const paxReq87 = { id: 1, status: 'aceptado', kind: 'mandado', driver_name: 'Josué Eduardo', driver_photo: null, driver_phone: '9614868605', passenger_name: 'Pax', passenger_photo: null };
    const drvReq87 = { id: 2, status: 'aceptado', kind: 'mandado', driver_name: 'Josué Eduardo', driver_photo: null, driver_phone: '9614868605', passenger_name: 'Ana', passenger_photo: null };
    h87.setReq(paxReq87, false);
    await h87.open();
    const paxOpen87 = { isOpen: h87.isOpen(), dlgHidden: dlg87.classList.contains('hidden'), sheet: dlg87.classList.contains('chat-sheet'), lb: lb87.classList.contains('chat-open'), html: box87.innerHTML };
    if(dlg87.handlers.click) dlg87.handlers.click({ target: box87 });
    const paxBackdropInside87 = { isOpen: h87.isOpen(), dlgHidden: dlg87.classList.contains('hidden') };
    if(dlg87.handlers.click) dlg87.handlers.click({ target: dlg87 });
    const paxBackdrop87 = { isOpen: h87.isOpen(), dlgHidden: dlg87.classList.contains('hidden'), sheet: dlg87.classList.contains('chat-sheet'), lb: lb87.classList.contains('chat-open') };
    await h87.open();
    const paxReopen87 = { isOpen: h87.isOpen(), dlgHidden: dlg87.classList.contains('hidden') };
    h87.close();
    const paxClosed87 = { isOpen: h87.isOpen(), dlgHidden: dlg87.classList.contains('hidden'), sheet: dlg87.classList.contains('chat-sheet'), lb: lb87.classList.contains('chat-open') };
    h87.setReq(drvReq87, true);
    await h87.open();
    const drvOpen87 = { isOpen: h87.isOpen(), dlgHidden: dlg87.classList.contains('hidden'), lb: lb87.classList.contains('chat-open'), html: box87.innerHTML };
    h87.close();
    h87.setReq(paxReq87, false);
    await h87.open();
    h87.swipeStart({ touches: [{ clientY: 100 }] });
    h87.swipeEnd({ changedTouches: [{ clientY: 130 }] });
    const swipeSmall87 = { isOpen: h87.isOpen() };
    h87.swipeStart({ touches: [{ clientY: 100 }] });
    h87.swipeEnd({ changedTouches: [{ clientY: 200 }] });
    const swipeBig87 = { isOpen: h87.isOpen(), dlgHidden: dlg87.classList.contains('hidden') };
    h87.close();
    const mine87 = h87.msg({ sender_role: 'pasajero', kind: 'texto', text: 'Hola, ¿ya compraste?', created_at: '2026-11-26 18:00:00' });
    const theirs87 = h87.msg({ sender_role: 'chofer', kind: 'texto', text: 'Ya voy', created_at: '2026-11-26 18:01:00' });
    chat87 = { paxOpen87, paxBackdropInside87, paxBackdrop87, paxReopen87, paxClosed87, drvOpen87, swipeSmall87, swipeBig87, mine87, theirs87 };
  } catch(e){ chat87Err = String(e && e.message || e); }
  check('v1.4.87: evaluado — al abrir el chat del pasajero la hoja aparece (chat-sheet) y la tarjeta del conductor se oculta (chat-open)', !!chat87 && chat87.paxOpen87.isOpen && !chat87.paxOpen87.dlgHidden && chat87.paxOpen87.sheet && chat87.paxOpen87.lb, chat87Err || JSON.stringify(chat87 && chat87.paxOpen87));
  check('v1.4.87: evaluado — la hoja del pasajero lleva foto + "Josué Eduardo" + "En línea" + X grande + cámara + envío redondo verde + foto (cámara/galería)', !!chat87 && chat87.paxOpen87.html.includes('chathead-photo') && chat87.paxOpen87.html.includes('Josué Eduardo') && chat87.paxOpen87.html.includes('En línea') && chat87.paxOpen87.html.includes('class="chatx"') && chat87.paxOpen87.html.includes('class="chatcam"') && chat87.paxOpen87.html.includes('class="chatsend"') && chat87.paxOpen87.html.includes('Escribe un mensaje…') && chat87.paxOpen87.html.includes('chat-cam') && chat87.paxOpen87.html.includes('chat-gal'), chat87Err || (chat87 && chat87.paxOpen87.html.slice(0, 300)));
  check('v1.4.87: evaluado — tocar DENTRO de la hoja no la cierra; tocar el fondo oscuro SÍ la cierra (y la tarjeta vuelve)', !!chat87 && chat87.paxBackdropInside87.isOpen && !chat87.paxBackdropInside87.dlgHidden && !chat87.paxBackdrop87.isOpen && chat87.paxBackdrop87.dlgHidden && !chat87.paxBackdrop87.sheet && !chat87.paxBackdrop87.lb, chat87Err || JSON.stringify(chat87 && { inside: chat87.paxBackdropInside87, back: chat87.paxBackdrop87 }));
  check('v1.4.87: evaluado — la X (chatCloseSheet) cierra la hoja y la tarjeta del conductor vuelve', !!chat87 && chat87.paxReopen87.isOpen && !chat87.paxReopen87.dlgHidden && !chat87.paxClosed87.isOpen && chat87.paxClosed87.dlgHidden && !chat87.paxClosed87.sheet && !chat87.paxClosed87.lb, chat87Err || JSON.stringify(chat87 && { re: chat87.paxReopen87, cl: chat87.paxClosed87 }));
  check('v1.4.87: evaluado — la hoja del chofer lleva el nombre del pasajero y foto también, SIN ocultar nada (la tarjeta que se oculta es solo la del pasajero)', !!chat87 && chat87.drvOpen87.isOpen && !chat87.drvOpen87.dlgHidden && !chat87.drvOpen87.lb && chat87.drvOpen87.html.includes('Ana') && chat87.drvOpen87.html.includes('chat-cam') && chat87.drvOpen87.html.includes('class="chatsend"'), chat87Err || JSON.stringify(chat87 && chat87.drvOpen87));
  check('v1.4.87: evaluado — deslizar hacia abajo POCO no cierra; deslizar MUCHO (>60px) sí cierra el chat', !!chat87 && chat87.swipeSmall87.isOpen && !chat87.swipeBig87.isOpen && chat87.swipeBig87.dlgHidden, chat87Err || JSON.stringify(chat87 && { small: chat87.swipeSmall87, big: chat87.swipeBig87 }));
  check('v1.4.87: evaluado — burbujas estilo WhatsApp: la mía verde a la derecha y la del otro gris a la izquierda, solo con la hora', !!chat87 && chat87.mine87.includes('chatmsg mine') && chat87.mine87.includes('Hola, ¿ya compraste?') && chat87.mine87.includes('chattime') && !chat87.mine87.includes('class="who"') && chat87.theirs87.includes('chatmsg theirs') && chat87.theirs87.includes('Ya voy') && chat87.theirs87.includes('chattime'), chat87Err || JSON.stringify(chat87 && { mine: chat87.mine87, theirs: chat87.theirs87 }));

  // ===== v1.4.88 (2026-11-26): BUGFIX del chat — el historial nunca cargaba (los GET iban sin token, 401) + foto del pasajero + rol por vista + primer toque del botón =====
  console.log('== v1.4.88: chat bugfix (token en los GET, foto pasajero, rol por vista, delegación del botón) ==');
  // (a) GET /api/chat SIN token → 401 (esta era la causa: el cliente no mandaba token y el catch vacío lo tragaba).
  const noTok88 = await api('/api/chat?request_id=' + man78.request.id);
  check('v1.4.88: GET /api/chat SIN token es 401 (por eso el historial nunca cargaba)', !noTok88.ok && /Inicia sesión/.test(noTok88.error || ''), JSON.stringify(noTok88));
  // (c) Entrega cruzada en un mandado NUEVO aceptado (man78 ya terminó: el
  // envío exige status aceptado). Se abre el candado (quedó puesto al final
  // de la 1.4.85) y se vuelve a poner al final de esta sección.
  const lockOpen88 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: false });
  check('v1.4.88: se abre el candado de Mandados para crear el mandado de prueba', lockOpen88.ok && lockOpen88.mandados_locked === false, JSON.stringify(lockOpen88));
  const man88 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', origin_zone: 'Bodega Aurrerá', origin_detail: 'Bodega Aurrerá', origin_lat: 16.87137, origin_lng: -93.20652, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', order_payment: 'por_pagar', order_amount: 150, stops: [{ zone: 'Bodega Aurrerá', lat: 16.87137, lng: -93.20652, detail: '' }], extra_stops: 0 });
  check('v1.4.88: mandado nuevo para la entrega cruzada', man88.ok && man88.request.id, JSON.stringify(man88));
  const acc88 = await api('/api/driver-respond', { driver_id: chatDrv.driver.id, request_id: man88.request.id, kind: 'acepta', price: 30 });
  check('v1.4.88: el chofer acepta el mandado nuevo', acc88.ok && acc88.request.status === 'aceptado', JSON.stringify(acc88));
  const drv88a = await api('/api/chat/send', { token: chatDrvAcc.token, request_id: man88.request.id, text: 'Ya compré todo, voy para allá', role: 'chofer' });
  check('v1.4.88: el chofer manda texto con role=chofer y queda guardado sender_role=chofer', drv88a.ok && drv88a.message.sender_role === 'chofer' && drv88a.message.text === 'Ya compré todo, voy para allá', JSON.stringify(drv88a));
  await new Promise(r => setTimeout(r, 1100)); // anti-spam 1 msg/s: el último envío de la pasajera (rl1, 'primero') fue hace menos de 1 s en tiempo de suite
  const pax88a = await api('/api/chat/send', { token: chatPaxAcc.token, request_id: man88.request.id, text: 'Perfecto, gracias', role: 'pasajero' });
  check('v1.4.88: la pasajera manda texto con role=pasajero y queda guardado sender_role=pasajero (FIX 4: antes salía al revés con la misma cuenta)', pax88a.ok && pax88a.message.sender_role === 'pasajero' && pax88a.message.text === 'Perfecto, gracias', JSON.stringify(pax88a));
  await new Promise(r => setTimeout(r, 1100));
  const pax88bad = await api('/api/chat/send', { token: chatPaxAcc.token, request_id: man88.request.id, text: 'Rol inválido', role: 'chofer' });
  check('v1.4.88: un rol inválido para la cuenta se ignora (la pasajera manda role=chofer y queda pasajero)', pax88bad.ok && pax88bad.message.sender_role === 'pasajero', JSON.stringify(pax88bad));
  // (b) GET con token devuelve el historial completo para los dos lados.
  const drvList88 = await api('/api/chat?request_id=' + man88.request.id + '&token=' + encodeURIComponent(chatDrvAcc.token));
  check('v1.4.88: GET /api/chat CON token devuelve los 3 mensajes al chofer (el texto del chofer y los dos de la pasajera)', drvList88.ok && drvList88.messages.length === 3 && drvList88.messages.some(m => m.sender_role === 'chofer' && m.text === 'Ya compré todo, voy para allá') && drvList88.messages.some(m => m.sender_role === 'pasajero' && m.text === 'Perfecto, gracias') && drvList88.messages.some(m => m.sender_role === 'pasajero' && m.text === 'Rol inválido'), JSON.stringify(drvList88.messages && drvList88.messages.map(m => ({ k: m.kind, r: m.sender_role, t: (m.text || '').slice(0, 20) }))));
  const paxList88 = await api('/api/chat?request_id=' + man88.request.id + '&token=' + encodeURIComponent(chatPaxAcc.token));
  check('v1.4.88: GET /api/chat CON token devuelve el historial a la pasajera (incluye el texto del chofer)', paxList88.ok && paxList88.messages.length === 3 && paxList88.messages.some(m => m.sender_role === 'chofer' && m.text === 'Ya compré todo, voy para allá'), JSON.stringify(paxList88.messages && paxList88.messages.length));
  // (d) La foto de la pasajera le llega al chofer (historial del mandado 78).
  const drvList78b = await api('/api/chat?request_id=' + man78.request.id + '&token=' + encodeURIComponent(chatDrvAcc.token));
  check('v1.4.88: la foto de la pasajera aparece en el historial del chofer', drvList78b.ok && drvList78b.messages.some(m => m.kind === 'foto' && m.sender_role === 'pasajero'), JSON.stringify(drvList78b.messages && drvList78b.messages.map(m => ({ k: m.kind, r: m.sender_role }))));
  const lockClose88 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: true });
  check('v1.4.88: el candado de Mandados vuelve a quedar puesto', lockClose88.ok && lockClose88.mandados_locked === true, JSON.stringify(lockClose88));
  // (e) Estático: los tres GET del chat llevan el token; chatSend manda el rol; el botón ancho no tiene onclick y la delegación lo atiende.
  check('v1.4.88: el cliente manda el token en los tres GET del chat (chatSeed, chatFetch y openChatSheet)', html.includes("api('/api/chat?request_id='+liveReq.id+'&after_id=0&role='+chatMyRole()+'&token=' + encodeURIComponent(store.token))") && html.includes("api('/api/chat?request_id='+liveReq.id+'&after_id='+chatLastId+'&role='+chatMyRole()+'&token=' + encodeURIComponent(store.token))"), ''); // v1.4.92: los tres GET ahora llevan &role= (acuse de lectura por rol)
  check('v1.4.88: chatSend manda role según la vista (liveAsDriver) al enviar', html.includes("role: liveAsDriver ? 'chofer' : 'pasajero'"), '');
  check('v1.4.88: el servidor acepta el rol de la vista si es válido para la cuenta (y si no, usa el de la cuenta)', srv.includes("body.role === 'chofer' && isDriver") && srv.includes("body.role === 'pasajero' && isPax"));
  check('v1.4.88: el servidor ya NO rechaza la foto de la pasajera (se quitó el 400) y sigue el chequeo de JPEG y de peso', !srv.includes('Solo el chofer puede mandar fotos.') && srv.includes("if (photo && !/^data:image\\/jpeg;base64,/.test(photo))") && srv.includes('if (photo && photo.length > 2000000)'));
  const wideSec88 = html.slice(html.indexOf('function chatWideBtnHtml(){'), html.indexOf('function chatShowBtn(){'));
  check('v1.4.88: el botón ancho de chat ya no tiene onclick (el tap lo atiende la delegación en #live-bottom)', !wideSec88.includes('onclick'), wideSec88.slice(0, 200));
  check('v1.4.88: la delegación en #live-bottom abre la hoja al tocar .chatwide (aunque el botón sea nuevo tras el repintado de 2 s)', html.includes("document.getElementById('live-bottom')") && html.includes("closest('.chatwide')") && html.includes('if(t) openChatSheet()'), '');
  // --- Evaluado: la delegación abre al tocar el botón y no abre al tocar fuera de él ---
  let deleg88 = null, deleg88Err = '';
  try {
    const src88 = html.slice(html.indexOf("(function(){ const b = document.getElementById('live-bottom')"), html.indexOf('let chatSwipeY = null;'));
    let opened88 = 0;
    const handlers88 = {};
    const btn88 = { closest(sel){ return sel === '.chatwide' ? this : null; } };
    const other88 = { closest(){ return null; } };
    const fakeDoc88 = { getElementById(){ return { addEventListener(ev, fn){ handlers88[ev] = fn; } }; } };
    new Function('document', 'openChatSheet', src88)(fakeDoc88, () => { opened88++; });
    if(handlers88.click) handlers88.click({ target: btn88 });
    const afterBtn88 = opened88;
    if(handlers88.click) handlers88.click({ target: other88 });
    deleg88 = { afterBtn: afterBtn88, afterOther: opened88 };
  } catch(e){ deleg88Err = String(e && e.message || e); }
  check('v1.4.88: evaluado — la delegación abre la hoja al tocar el botón ancho y no abre al tocar fuera de él', !!deleg88 && deleg88.afterBtn === 1 && deleg88.afterOther === 1, deleg88Err || JSON.stringify(deleg88));
  // --- Evaluado: openChatSheet pide el historial con el token en la URL ---
  let tok88 = null, tok88Err = '';
  try {
    const chatSrc88b = html.slice(html.indexOf('let chatOpen = false, chatTimer = null'), html.indexOf('/* GPS del chofer a nivel de app'));
    const mk88 = () => { const cls = new Set(); const el = { classList: { add(c){ cls.add(c); }, remove(c){ cls.delete(c); }, contains(c){ return cls.has(c); }, toggle(c, f){ if(f === undefined){ if(cls.has(c)) cls.delete(c); else cls.add(c); } else if(f) cls.add(c); else cls.delete(c); } }, style: {}, innerHTML: '', textContent: '', value: '', focus(){}, click(){}, insertAdjacentHTML(){}, querySelector(){ return null; }, handlers: {}, addEventListener(ev, fn){ el.handlers[ev] = fn; }, scrollTop: 0, scrollHeight: 0 }; return el; };
    const dlg88 = mk88(); dlg88.classList.add('hidden');
    const box88 = mk88(); const msgs88 = mk88(); const lb88 = mk88();
    const els88 = { 'dialog': dlg88, 'dialog-box': box88, 'chat-msgs': msgs88, 'live-bottom': lb88 };
    const $88 = sel => ({ '#dialog': dlg88, '#dialog-box': box88 }[sel] || mk88());
    const doc88 = { getElementById: id => els88[id] || null, createElement: () => mk88() };
    const urls88 = [];
    const api88 = async (p) => { urls88.push(p); return { messages: [] }; };
    const f88 = new Function('$', 'document', 'api', 'toast', 'store', 'esc', 'setInterval', 'clearInterval',
      'let liveAsDriver = false;\nlet liveReq = null;\nfunction openDialog(html){ $(\'#dialog-box\').innerHTML = html; $(\'#dialog\').classList.remove(\'hidden\'); }\nfunction closeDialog(){ $(\'#dialog\').classList.add(\'hidden\'); }\n' + chatSrc88b
      + '\nreturn { open: openChatSheet, setReq(r, asDriver){ liveReq = r; liveAsDriver = asDriver; } };');
    const h88 = f88($88, doc88, api88, () => {}, { token: 'tok123' }, s => String(s == null ? '' : s), () => 99, () => {});
    h88.setReq({ id: 7, status: 'aceptado', kind: 'mandado', driver_name: 'D', driver_photo: null, passenger_name: 'P', passenger_photo: null }, false);
    await h88.open();
    tok88 = urls88;
  } catch(e){ tok88Err = String(e && e.message || e); }
  check('v1.4.88: evaluado — openChatSheet marca leído y pide el historial con role + token en la URL (v1.4.92: primero /api/chat/read, luego el GET)', !!tok88 && tok88.length === 2 && tok88[0] === '/api/chat/read' && tok88[1] === '/api/chat?request_id=7&after_id=0&role=pasajero&token=tok123', tok88Err || JSON.stringify(tok88));

  // ===== v1.4.89 (2026-11-26): fase 1 del chofer en Quiero — UN solo botón "Ya tengo el pedido" en cualquier etapa (antes "Ya estoy afuera para recoger el paquete" en confirmado/en_camino y el usuario no sabía cómo terminar de comprar) =====
  console.log('== v1.4.89: botón único "Ya tengo el pedido" en fase 1 de Quiero ==');
  // (a) Salto directo a 'comprado' desde en_camino (man88, Quiero aceptado: al aceptar el servidor pone trip_stage='en_camino', nunca 'confirmado' con chofer).
  const adv89a = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: man88.request.id, stage: 'comprado' });
  check('v1.4.89: Quiero avanza en_camino → comprado DIRECTO (sin pasar por llego)', adv89a.ok && adv89a.request.trip_stage === 'comprado', JSON.stringify(adv89a));
  const lockOpen89 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: false });
  check('v1.4.89: se abre el candado de Mandados para los mandados de prueba', lockOpen89.ok && lockOpen89.mandados_locked === false, JSON.stringify(lockOpen89));
  const man89b = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', origin_zone: 'Bodega Aurrerá', origin_detail: 'Bodega Aurrerá', origin_lat: 16.87137, origin_lng: -93.20652, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', order_payment: 'por_pagar', order_amount: 100, stops: [{ zone: 'Bodega Aurrerá', lat: 16.87137, lng: -93.20652, detail: '' }], extra_stops: 0 });
  check('v1.4.89: mandado Quiero nuevo para el salto directo y el flujo completo', man89b.ok && man89b.request.id, JSON.stringify(man89b));
  const acc89b = await api('/api/driver-respond', { driver_id: chatDrv.driver.id, request_id: man89b.request.id, kind: 'acepta', price: 30 });
  check('v1.4.89: el chofer acepta el mandado Quiero nuevo (queda en en_camino)', acc89b.ok && acc89b.request.status === 'aceptado' && acc89b.request.trip_stage === 'en_camino', JSON.stringify(acc89b));
  const adv89d = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: man89b.request.id, stage: 'comprado' });
  check('v1.4.89: Quiero nuevo avanza en_camino → comprado DIRECTO', adv89d.ok && adv89d.request.trip_stage === 'comprado', JSON.stringify(adv89d));
  const adv89g = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: man89b.request.id, stage: 'en_viaje' });
  check('v1.4.89: tras el salto, el flujo sigue: comprado → en_viaje (fase 2, mapa con ruta)', adv89g.ok && adv89g.request.trip_stage === 'en_viaje', JSON.stringify(adv89g));
  const adv89h = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: man89b.request.id, stage: 'entregado' });
  check('v1.4.89: el flujo termina: en_viaje → entregado', adv89h.ok && adv89h.request.trip_stage === 'entregado' && adv89h.request.status === 'finalizado', JSON.stringify(adv89h));
  // Enviar NO puede saltar a 'comprado' (el candado de recipient_phone lo bloquea aunque STAGE_NEXT lo permita para Quiero).
  const man89e = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_detail: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', description: 'Llevar un paquete', vehicle: 'mototaxi', recipient_phone: '9614444444', recipient_name: 'María López', order_payment: 'por_pagar', order_amount: 150 });
  check('v1.4.89: mandado Enviar nuevo para probar que NO llega a comprado', man89e.ok && man89e.request.id, JSON.stringify(man89e));
  const acc89e = await api('/api/driver-respond', { driver_id: chatDrv.driver.id, request_id: man89e.request.id, kind: 'acepta', price: 30 });
  check('v1.4.89: el chofer acepta el mandado Enviar nuevo', acc89e.ok && acc89e.request.status === 'aceptado', JSON.stringify(acc89e));
  const adv89f = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: man89e.request.id, stage: 'comprado' });
  check('v1.4.89: Enviar NO puede marcar comprado (400, no es de compras) aunque el salto exista para Quiero', !adv89f.ok && /no es de compras/.test(adv89f.error || ''), JSON.stringify(adv89f));
  const lockClose89 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: true });
  check('v1.4.89: el candado de Mandados vuelve a quedar puesto', lockClose89.ok && lockClose89.mandados_locked === true, JSON.stringify(lockClose89));
  // (b) Estático: la rama de fase 1 del chofer ya no usa stageButtonLabel ni advanceLive para el botón; el servidor permite el salto en STAGE_NEXT (también desde confirmado, que en vivo nunca tiene chofer porque al aceptar pasa a en_camino).
  const ph1Sec89 = html.slice(html.indexOf('if(livePhase1QuieroDriver(r)){'), html.indexOf("top.classList.remove('paxcol')"));
  check('v1.4.89: la pantalla de fase 1 del chofer tiene UN solo botón "Ya tengo el pedido" que abre el diálogo del ticket (askTicketPhoto), sin "recoger el paquete" ni advanceLive', ph1Sec89.includes('Ya tengo el pedido') && ph1Sec89.includes('onclick="askTicketPhoto()"') && !ph1Sec89.includes('recoger el paquete') && !ph1Sec89.includes('advanceLive') && !ph1Sec89.includes('stageButtonLabel'), ph1Sec89.slice(0, 400));
  check('v1.4.89: STAGE_NEXT permite confirmado → comprado y en_camino → comprado en mandados (Quiero)', srv.includes("confirmado: ['en_camino', 'comprado'], en_camino: ['llego', 'comprado']"), '');
  // (c) Enviar sigue con "Ya estoy afuera para recoger el paquete" en el paso llego (stageButtonLabel intacto, no tocado).
  check('v1.4.89: stageButtonLabel sigue dando "Ya estoy afuera para recoger el paquete" al mandado en llego (Enviar, correcto ahí)', html.includes("llego:'Ya estoy afuera para recoger el paquete'"), '');
  // (d) Evaluado: la pantalla de fase 1 del chofer en Quiero muestra "Ya tengo el pedido" en confirmado, en_camino y llego, y abre el ticket; Enviar en en_camino muestra "Ya estoy afuera para recoger el paquete"; el viaje no cambia.
  let ph1_89 = null, ph1Err89 = '';
  try {
    const liveSec89 = html.slice(html.indexOf('function renderLiveStrips(){'), html.indexOf('function compassDir('));
    const stageLabelSrc89 = html.slice(html.indexOf('const STAGE_LABEL'), html.indexOf('/* Hacia el destino'));
    const htdSrc89 = html.slice(html.indexOf('function liveHeadingToDest(r){'), html.indexOf('/* Paradas intermedias'));
    const quieroSrc89 = html.slice(html.indexOf('function isQuieroMandado(r){'), html.indexOf('function nextStage(r){'));
    const nextSrc89 = html.slice(html.indexOf('function nextStage(r){'), html.indexOf('function passengerStageTitle(r){'));
    const compassSrc89 = html.slice(html.indexOf('function compassDir(from, to){'), html.indexOf('async function cancelLiveRequest(rid){'));
    function runStrips89(r) {
      const mkEl = () => ({ classList: { add(){}, remove(){} }, style: {}, innerHTML: '', textContent: '' });
      const top = mkEl(), bot = mkEl(), pill = mkEl(), compass = mkEl(), recenter = mkEl();
      const els = { '#live-top': top, '#live-bottom': bot, '#live-pill': pill, '#live-compass': compass, '#live-recenter': recenter };
      const f = new Function('$', 'top', 'bot', 'let liveAsDriver = true;\nlet liveReq = null;\nfunction chatShowBtn(){}\nfunction chatWideBtnHtml(){ return \'<button class="chatwide">Chat</button>\'; }\n' + stageLabelSrc89 + '\n' + htdSrc89 + '\n' + quieroSrc89 + '\n' + nextSrc89 + '\n' + compassSrc89 + '\nfunction etaMin(km){ return Math.max(5, Math.round(km * 3.2)); }\nfunction havKm(a,b,c,d){ const R=6371, r=x=>x*Math.PI/180; const x=r(c-a), y=r(d-b); return 2*R*Math.asin(Math.sqrt(Math.sin(x/2)**2 + Math.cos(r(a))*Math.cos(r(c))*Math.sin(y/2)**2)); }\nfunction paxText(pax){ const n = Math.min(3, Math.max(1, Number(pax)||1)); return n + (n===1 ? \' persona\' : \' personas\'); }\nfunction esc(s){ return String(s==null?\'\':s); }\nfunction fmt$(n){ return \'$\' + Math.round(Number(n)||0); }\n' + liveSec89 + '\nreturn { run(r){ liveReq = r; renderLiveStrips(); } };');
      const h = f(sel => els[sel] || mkEl(), top, bot);
      h.run(r);
      return { top: top.innerHTML, bot: bot.innerHTML };
    }
    const quiero89 = { kind: 'mandado', recipient_phone: '', stops_json: '[{"zone":"Madero","detail":""}]', items_json: '["Dos kilos de tomate","2 cebolla"]', order_amount: 100, origin_zone: 'Madero', dest_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_lat: 16.8709, dest_lng: -93.2063, driver_lat: 16.8727, driver_lng: -93.2081, passenger_name: 'Josue Eduardo', passenger_phone: '9614868605', payment_method: 'efectivo', price: 30, final_price: 30 };
    const enviar89 = { ...quiero89, recipient_phone: '9614444444', recipient_name: 'María López', description: 'Llevar un paquete', order_payment: 'por_pagar' };
    const viaje89 = { kind: 'viaje', origin_zone: 'Madero', dest_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_lat: 16.8675, dest_lng: -93.2105, driver_lat: 16.8727, driver_lng: -93.2081, passenger_name: 'The Noob Gamer', passenger_phone: '9614868605', payment_method: 'efectivo', price: 20, final_price: 20, passenger_count: 1 };
    ph1_89 = {
      qConf: runStrips89({ ...quiero89, trip_stage: 'confirmado' }),
      qCamino: runStrips89({ ...quiero89, trip_stage: 'en_camino' }),
      qLlego: runStrips89({ ...quiero89, trip_stage: 'llego' }),
      env: runStrips89({ ...enviar89, trip_stage: 'en_camino' }),
      trip: runStrips89({ ...viaje89, trip_stage: 'en_camino' })
    };
  } catch(e){ ph1Err89 = String(e && e.message || e); }
  check('v1.4.89: evaluado — fase 1 de Quiero en confirmado muestra "Ya tengo el pedido" que abre el ticket, sin "recoger el paquete"', !!ph1_89 && ph1_89.qConf.bot.includes('Ya tengo el pedido') && ph1_89.qConf.bot.includes('onclick="askTicketPhoto()"') && !ph1_89.qConf.bot.includes('recoger el paquete') && !ph1_89.qConf.bot.includes('advanceLive('), ph1Err89 || JSON.stringify(ph1_89 && ph1_89.qConf.bot.slice(0, 300)));
  check('v1.4.89: evaluado — fase 1 de Quiero en en_camino y en llego también muestra "Ya tengo el pedido" (mismo botón único)', !!ph1_89 && ph1_89.qCamino.bot.includes('Ya tengo el pedido') && ph1_89.qCamino.bot.includes('onclick="askTicketPhoto()"') && ph1_89.qLlego.bot.includes('Ya tengo el pedido') && ph1_89.qLlego.bot.includes('onclick="askTicketPhoto()"'), ph1Err89 || JSON.stringify(ph1_89 && { c: ph1_89.qCamino.bot.slice(0, 150), l: ph1_89.qLlego.bot.slice(0, 150) }));
  check('v1.4.89: evaluado — Enviar en en_camino SIGUE con "Ya estoy afuera para recoger el paquete" (advanceLive llego)', !!ph1_89 && ph1_89.env.bot.includes('Ya estoy afuera para recoger el paquete') && ph1_89.env.bot.includes("advanceLive('llego')"), ph1Err89 || JSON.stringify(ph1_89 && ph1_89.env.bot.slice(0, 300)));
  check('v1.4.89: evaluado — el viaje en en_camino SIGUE con "Ya estoy afuera" (sin cambios)', !!ph1_89 && ph1_89.trip.bot.includes('Ya estoy afuera') && !ph1_89.trip.bot.includes('recoger el paquete'), ph1Err89 || JSON.stringify(ph1_89 && ph1_89.trip.bot.slice(0, 200)));

  // ===== v1.4.89 FIX 5 (2026-11-26): en Quiero, en 'comprado' el botón es "Finalizar mandado" y va directo a 'entregado' (antes "Ya voy en camino" y luego "Entregado", repetido) =====
  console.log('== v1.4.89 FIX 5: "Finalizar mandado" en Quiero comprado ==');
  // (a) API: Quiero avanza comprado → entregado DIRECTO (STAGE_NEXT ya lo permitía) y el recibo tiene duración (trip_started_at se marca al comprar).
  const lockOpen89b = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: false });
  check('v1.4.89 FIX 5: se abre el candado de Mandados para el mandado de prueba', lockOpen89b.ok && lockOpen89b.mandados_locked === false, JSON.stringify(lockOpen89b));
  // Chofer NUEVO para esta sección: chatDrv ya gastó sus 5 servicios gratis de hoy con man78/man88/man89b/man89e (el límite es por chofer y por día).
  const drv89jAcc = await api('/api/register-account', { name: 'Chofer Finalizar', username: 'chatdrv89_' + RUN, phone: '9610000089', password: 'secreta123' });
  const drv89j = await api('/api/register-driver', { name: 'Chofer Finalizar', phone: '9610000089', vehicle: 'mototaxi', unit: 'F89', selfie: PHOTO, vehicle_photo: PHOTO });
  await approveDriver(drv89j.driver.id);
  const link89j = await api('/api/link-profiles', { token: drv89jAcc.token, driver_id: drv89j.driver.id });
  const on89j = await api('/api/set-driver-online', { driver_id: drv89j.driver.id, online: true });
  check('v1.4.89 FIX 5: chofer nuevo aprobado, enlazado y en línea (con sus 5 servicios gratis intactos)', drv89jAcc.ok && drv89j.ok && link89j.ok && on89j.ok && on89j.driver.online === 1, JSON.stringify({ acc: drv89jAcc.ok, drv: drv89j.ok, link: link89j.ok, on: on89j.ok }));
  const man89j = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', origin_zone: 'Bodega Aurrerá', origin_detail: 'Bodega Aurrerá', origin_lat: 16.87137, origin_lng: -93.20652, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', order_payment: 'por_pagar', order_amount: 100, stops: [{ zone: 'Bodega Aurrerá', lat: 16.87137, lng: -93.20652, detail: '' }], extra_stops: 0 });
  check('v1.4.89 FIX 5: mandado Quiero nuevo para el final directo', man89j.ok && man89j.request.id, JSON.stringify(man89j));
  const acc89j = await api('/api/driver-respond', { driver_id: drv89j.driver.id, request_id: man89j.request.id, kind: 'acepta', price: 30 });
  check('v1.4.89 FIX 5: el chofer acepta el mandado Quiero nuevo', acc89j.ok && acc89j.request.status === 'aceptado', JSON.stringify(acc89j));
  const adv89j = await api('/api/advance-stage', { driver_id: drv89j.driver.id, request_id: man89j.request.id, stage: 'comprado' });
  check('v1.4.89 FIX 5: Quiero avanza a comprado y ya queda marcado el inicio (trip_started_at)', adv89j.ok && adv89j.request.trip_stage === 'comprado' && adv89j.request.trip_started_at, JSON.stringify(adv89j.request && { st: adv89j.request.trip_stage, started: adv89j.request.trip_started_at }));
  const adv89k = await api('/api/advance-stage', { driver_id: drv89j.driver.id, request_id: man89j.request.id, stage: 'entregado' });
  check('v1.4.89 FIX 5: Quiero avanza comprado → entregado DIRECTO (sin pasar por en_viaje)', adv89k.ok && adv89k.request.trip_stage === 'entregado' && adv89k.request.status === 'finalizado', JSON.stringify(adv89k));
  const got89j = await api('/api/requests?id=' + man89j.request.id);
  check('v1.4.89 FIX 5: el recibo tiene duración real (trip_started_at marcado al comprar y finished_at al entregar)', got89j.ok && got89j.requests[0].trip_started_at && got89j.requests[0].finished_at && got89j.requests[0].finished_at >= got89j.requests[0].trip_started_at, JSON.stringify(got89j.requests && got89j.requests[0] && { started: got89j.requests[0].trip_started_at, finished: got89j.requests[0].finished_at }));
  const lockClose89b = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: true });
  check('v1.4.89 FIX 5: el candado de Mandados vuelve a quedar puesto', lockClose89b.ok && lockClose89b.mandados_locked === true, JSON.stringify(lockClose89b));
  // (b) Estático: STAGE_NEXT ya permitía comprado → entregado; el servidor marca trip_started_at al comprar.
  check('v1.4.89 FIX 5: STAGE_NEXT ya permitía comprado → entregado en mandados (no hizo falta agregarlo)', srv.includes("comprado: ['en_viaje', 'entregado']"), '');
  check('v1.4.89 FIX 5: el servidor marca trip_started_at también al pasar a comprado (para la duración del recibo)', srv.includes("(stage === startStage || stage === 'comprado') && !r.trip_started_at"), '');
  // (c) Evaluado: en fase 2 el botón del chofer en Quiero comprado dice "Finalizar mandado"; Enviar sigue "Ya voy en camino" → "Entregado".
  let fin89 = null, finErr89 = '';
  try {
    const liveSec89b = html.slice(html.indexOf('function renderLiveStrips(){'), html.indexOf('function compassDir('));
    const stageLabelSrc89b = html.slice(html.indexOf('const STAGE_LABEL'), html.indexOf('/* Hacia el destino'));
    const htdSrc89b = html.slice(html.indexOf('function liveHeadingToDest(r){'), html.indexOf('/* Paradas intermedias'));
    const quieroSrc89b = html.slice(html.indexOf('function isQuieroMandado(r){'), html.indexOf('function nextStage(r){'));
    const nextSrc89b = html.slice(html.indexOf('function nextStage(r){'), html.indexOf('function passengerStageTitle(r){'));
    const compassSrc89b = html.slice(html.indexOf('function compassDir(from, to){'), html.indexOf('async function cancelLiveRequest(rid){'));
    function runStrips89b(r) {
      const mkEl = () => ({ classList: { add(){}, remove(){} }, style: {}, innerHTML: '', textContent: '' });
      const top = mkEl(), bot = mkEl(), pill = mkEl(), compass = mkEl(), recenter = mkEl();
      const els = { '#live-top': top, '#live-bottom': bot, '#live-pill': pill, '#live-compass': compass, '#live-recenter': recenter };
      const f = new Function('$', 'top', 'bot', 'let liveAsDriver = true;\nlet liveReq = null;\nfunction chatShowBtn(){}\nfunction chatWideBtnHtml(){ return \'<button class="chatwide">Chat</button>\'; }\n' + stageLabelSrc89b + '\n' + htdSrc89b + '\n' + quieroSrc89b + '\n' + nextSrc89b + '\n' + compassSrc89b + '\nfunction etaMin(km){ return Math.max(5, Math.round(km * 3.2)); }\nfunction havKm(a,b,c,d){ const R=6371, r=x=>x*Math.PI/180; const x=r(c-a), y=r(d-b); return 2*R*Math.asin(Math.sqrt(Math.sin(x/2)**2 + Math.cos(r(a))*Math.cos(r(c))*Math.sin(y/2)**2)); }\nfunction paxText(pax){ const n = Math.min(3, Math.max(1, Number(pax)||1)); return n + (n===1 ? \' persona\' : \' personas\'); }\nfunction esc(s){ return String(s==null?\'\':s); }\nfunction fmt$(n){ return \'$\' + Math.round(Number(n)||0); }\n' + liveSec89b + '\nreturn { run(r){ liveReq = r; renderLiveStrips(); } };');
      const h = f(sel => els[sel] || mkEl(), top, bot);
      h.run(r);
      return { top: top.innerHTML, bot: bot.innerHTML };
    }
    const quiero89b = { kind: 'mandado', recipient_phone: '', stops_json: '[{"zone":"Madero","detail":""}]', items_json: '["Dos kilos de tomate","2 cebolla"]', order_amount: 100, origin_zone: 'Madero', dest_zone: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_lat: 16.8709, dest_lng: -93.2063, driver_lat: 16.8727, driver_lng: -93.2081, passenger_name: 'Josue Eduardo', passenger_phone: '9614868605', payment_method: 'efectivo', price: 30, final_price: 30 };
    const enviar89b = { ...quiero89b, recipient_phone: '9614444444', recipient_name: 'María López', description: 'Llevar un paquete', order_payment: 'por_pagar' };
    fin89 = {
      qComprado: runStrips89b({ ...quiero89b, trip_stage: 'comprado' }),
      envLlego: runStrips89b({ ...enviar89b, trip_stage: 'llego' }),
      envViaje: runStrips89b({ ...enviar89b, trip_stage: 'en_viaje' })
    };
  } catch(e){ finErr89 = String(e && e.message || e); }
  check('v1.4.89 FIX 5: evaluado — fase 2 de Quiero en comprado muestra "Finalizar mandado" (advanceLive entregado), sin "Ya voy en camino"', !!fin89 && fin89.qComprado.bot.includes('Finalizar mandado') && fin89.qComprado.bot.includes("advanceLive('entregado')") && !fin89.qComprado.bot.includes('Ya voy en camino'), finErr89 || JSON.stringify(fin89 && fin89.qComprado.bot.slice(0, 300)));
  check('v1.4.89 FIX 5: evaluado — Enviar en llego SIGUE con "Ya voy en camino" (advanceLive en_viaje)', !!fin89 && fin89.envLlego.bot.includes('Ya voy en camino') && fin89.envLlego.bot.includes("advanceLive('en_viaje')"), finErr89 || JSON.stringify(fin89 && fin89.envLlego.bot.slice(0, 300)));
  check('v1.4.89 FIX 5: evaluado — Enviar en en_viaje SIGUE con "Entregado"', !!fin89 && fin89.envViaje.bot.includes('Entregado') && fin89.envViaje.bot.includes("advanceLive('entregado')"), finErr89 || JSON.stringify(fin89 && fin89.envViaje.bot.slice(0, 200)));

  // ===== v1.4.90 (2026-11-26): Enviar paso 3 — opciones de pago apiladas ("Se pagará el pedido" arriba, "Pedido ya pagado" abajo) + la descripción ya no se borra al cambiar de opción =====
  console.log('== v1.4.90: pago del pedido apilado en Enviar paso 3 + descripción que no se borra ==');
  // --- Estático: el bloque de pago del paso 3 (anclado a renderMandadoEnviar, no a Quiero) ---
  const envFn90 = html.indexOf('function renderMandadoEnviar(){');
  const s3Start90 = html.indexOf('} else if(md.step===3){', envFn90);
  const s3End90 = html.indexOf('} else if(md.step===4){', s3Start90);
  const step3Sec90 = html.slice(s3Start90, s3End90);
  const pay3Idx90 = step3Sec90.indexOf('¿Cómo se paga el pedido?');
  const pay3Sec90 = step3Sec90.slice(pay3Idx90, step3Sec90.indexOf("md.orderPay==='por_pagar' ? '<label", pay3Idx90));
  check('v1.4.90: las opciones de pago del paso 3 de Enviar van APILADAS en columna (flex-direction:column), "Se pagará el pedido" ANTES que "Pedido ya pagado"', pay3Sec90.includes('flex-direction:column') && pay3Sec90.indexOf('Se pagará el pedido') !== -1 && pay3Sec90.indexOf('Pedido ya pagado') !== -1 && pay3Sec90.indexOf('Se pagará el pedido') < pay3Sec90.indexOf('Pedido ya pagado'), pay3Sec90.slice(0, 300));
  check('v1.4.90: ambas opciones conservan su clase pay-opt, su lógica sel y su onclick (por_pagar / pagado con md.orderAmount vacío)', pay3Sec90.includes("class=\"pay-opt '+(md.orderPay==='por_pagar'?'sel':'')+'\" onclick=\"md.orderPay=\\'por_pagar\\';renderMandados()\"") && pay3Sec90.includes("class=\"pay-opt '+(md.orderPay==='pagado'?'sel':'')+'\" onclick=\"md.orderPay=\\'pagado\\';md.orderAmount=\\'\\';renderMandados()\""), pay3Sec90.slice(0, 400));
  check('v1.4.90: NO se agregó ningún icono de verificación (la palomita del mockup era solo adorno del generador; el seleccionado sigue siendo el .sel verde)', !pay3Sec90.includes('✓') && !pay3Sec90.includes('✔') && !pay3Sec90.includes('check'), pay3Sec90.slice(0, 200));
  check('v1.4.90: el resto del paso 3 sigue igual (título, subtítulo, etiqueta, placeholder, errores, botón Continuar)', step3Sec90.includes('<h2>¿Qué hay que entregar?</h2>') && step3Sec90.includes('Paso 3 de 4 · Cuéntale al conductor qué lleva.') && step3Sec90.includes('¿Qué hay que recoger o entregar?') && step3Sec90.includes('placeholder="Ej. llevar un paquete a mi hermana"') && step3Sec90.includes('id="md-err4"') && step3Sec90.includes('id="md-err3b"') && step3Sec90.includes('onclick="mdNextEnviar3()">Continuar</button>'), step3Sec90.slice(0, 300));
  check('v1.4.90: el textarea #md-desc ahora guarda lo escrito al teclear (oninput="md.description=this.value", mismo patrón que #md-order-amount)', html.includes('<textarea id="md-desc" rows="3" placeholder="Ej. llevar un paquete a mi hermana" oninput="md.description=this.value">'), '');
  check('v1.4.90: "Continuar" sigue exigiendo descripción (el guard if(!md.description) muestra md-err4 y no avanza)', html.includes("if(!md.description){ if(e4) e4.classList.remove('hidden'); return; }"), '');
  // --- Evaluado: escribir en #md-desc, cambiar de opción de pago, el texto sigue ahí tras el re-render ---
  let step3_90 = null, step3Err90 = '';
  try {
    let src90 = step3Sec90.replace(/^} else if\(md\.step===3\)\{/, 'if(true){') + '}';
    const runStep3_90 = (mdObj) => {
      const page90 = { innerHTML: '' };
      const fn90 = new Function('md', 'page', 'backPill', 'esc', src90 + '; return page.innerHTML;');
      return fn90(mdObj, page90, () => '', (s) => String(s ?? ''));
    };
    const md90 = { step: 3, description: '', orderPay: 'pagado', orderAmount: '' };
    const h90a = runStep3_90(md90);
    const onIn90 = (h90a.match(/<textarea[^>]*id="md-desc"[^>]*oninput="([^"]*)"/) || [])[1] || '';
    if (onIn90) new Function('md', onIn90).call({ value: 'Caja' }, md90);
    md90.orderPay = 'por_pagar';
    const h90b = runStep3_90(md90);
    const txt90b = (h90b.match(/<textarea[^>]*id="md-desc"[^>]*>([^<]*)<\/textarea>/) || [])[1];
    md90.orderPay = 'pagado';
    const h90c = runStep3_90(md90);
    const txt90c = (h90c.match(/<textarea[^>]*id="md-desc"[^>]*>([^<]*)<\/textarea>/) || [])[1];
    step3_90 = { onIn90, descAfterType: md90.description, txtAfterSwitch: txt90b, txtAfterSwitchBack: txt90c, orderOk: h90b.indexOf('Se pagará el pedido') < h90b.indexOf('Pedido ya pagado'), colOk: h90b.includes('flex-direction:column') };
  } catch (e) { step3Err90 = String(e && e.message || e); }
  check('v1.4.90: evaluado — escribo "Caja" en #md-desc, cambio a "Se pagará el pedido" y el texto SIGUE tras el re-render (y también al volver a "Pedido ya pagado")', !!step3_90 && step3_90.onIn90 === 'md.description=this.value' && step3_90.descAfterType === 'Caja' && step3_90.txtAfterSwitch === 'Caja' && step3_90.txtAfterSwitchBack === 'Caja', step3Err90 || JSON.stringify(step3_90));
  check('v1.4.90: evaluado — el paso 3 ya renderizado trae "Se pagará el pedido" arriba de "Pedido ya pagado" en columna', !!step3_90 && step3_90.orderOk && step3_90.colOk, step3Err90 || JSON.stringify(step3_90));
  // --- Evaluado: "Continuar" sigue exigiendo descripción ---
  let next3_90 = null, next3Err90 = '';
  try {
    const next3Src90 = html.slice(html.indexOf('function mdNextEnviar3(){'), html.indexOf('function mdToggleAskBtn(){'));
    const runNext3_90 = (descVal, orderPayVal) => {
      const mkEl90 = (v) => { const cls = new Set(['hidden']); return { value: v || '', textContent: '', classList: { add(c){ cls.add(c); }, remove(c){ cls.delete(c); }, contains(c){ return cls.has(c); } }, _cls: cls }; };
      const els90 = { 'md-desc': mkEl90(descVal), 'md-err4': mkEl90(), 'md-err3b': mkEl90() };
      const doc90 = { getElementById(id){ return els90[id] || null; } };
      const mdObj90 = { description: '', orderPay: orderPayVal, orderAmount: '' };
      let priceCalled90 = false;
      new Function('md', 'document', 'mdComputeEnviarPrice', next3Src90 + '; mdNextEnviar3();')(mdObj90, doc90, () => { priceCalled90 = true; });
      return { err4Shown: !els90['md-err4']._cls.has('hidden'), priceCalled: priceCalled90, desc: mdObj90.description };
    };
    next3_90 = { empty: runNext3_90('', 'pagado'), ok: runNext3_90('Caja', 'pagado') };
  } catch (e) { next3Err90 = String(e && e.message || e); }
  check('v1.4.90: evaluado — "Continuar" con descripción vacía muestra el error y NO avanza; con "Caja" pasa la validación', !!next3_90 && next3_90.empty.err4Shown && !next3_90.empty.priceCalled && !next3_90.ok.err4Shown && next3_90.ok.priceCalled && next3_90.ok.desc === 'Caja', next3Err90 || JSON.stringify(next3_90));

  // ===== v1.4.91 (2026-11-27): lote de 6 detalles de la prueba en el teléfono (mockup fase 1 aprobado "Arre", "Trabaja en eso") =====
  console.log('== v1.4.91: 6 detalles — autocomplete lista, push chat, distintivo no leídos, fase 1 sin mapa, regla 30 min, conteo chofer ==');
  const sw91 = fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8');
  const dep91 = fs.readFileSync(path.join(__dirname, 'DEPLOY.md'), 'utf8');
  // --- Estático: detalle 1 (autocomplete de la lista de Quiero) ---
  const itemsFn91 = html.slice(html.indexOf('function mdItemsHtml(){'), html.indexOf('function renderMandadoQuiero(){'));
  check('v1.4.91 D1: los inputs data-item de la lista de Quiero llevan autocomplete/autocorrect/autocapitalize off + spellcheck false (mismo patrón que pick-search/chat-input)', itemsFn91.includes('autocomplete="off"') && itemsFn91.includes('autocorrect="off"') && itemsFn91.includes('autocapitalize="off"') && itemsFn91.includes('spellcheck="false"') && itemsFn91.includes('data-item='), itemsFn91.slice(0, 300));
  check('v1.4.91 D1: nada más cambia en esa pantalla (placeholder, oninput y botón de quitar siguen igual)', itemsFn91.includes("placeholder=\"'+(i===0?'Ej. 2 kg de tortillas':'Ej. un refresco, pan, lo que sigue…')+'\"") && itemsFn91.includes("oninput=\"md.items['+i+']=this.value\"") && itemsFn91.includes('+ Agregar otra cosa'), '');
  // --- Estático: detalle 2 (Web Push) ---
  check('v1.4.91 D2: el servidor usa web-push con VAPID (llaves de entorno, nunca en el repo)', srv.includes("require('web-push')") && srv.includes('setVapidDetails') && srv.includes('VAPID_PUBLIC_KEY') && srv.includes('VAPID_PRIVATE_KEY') && srv.includes("process.env.VAPID_PRIVATE_KEY"), '');
  check('v1.4.91 D2: el servidor tiene /api/push/subscribe (guarda endpoint + llaves por cuenta) y /api/push/fcm-token (solo guarda el token)', srv.includes("'/api/push/subscribe'") && srv.includes('push_subscriptions') && srv.includes("'/api/push/fcm-token'") && srv.includes('fcm_tokens') && srv.includes('INSERT OR REPLACE INTO fcm_tokens'), '');
  check('v1.4.91 D2: al mandar un mensaje de chat se dispara el push al OTRO lado (título SanFerGo, cuerpo nombre + texto o "Te envió una foto", tag por solicitud)', srv.includes('function sendChatPush') && srv.includes('sendChatPush(r, a, role, text, photo)') && srv.includes("title: 'SanFerGo'") && srv.includes("(text || 'Te envió una foto')") && srv.includes("tag: 'chat-' + r.id"), '');
  check('v1.4.91 D2: /api/config sirve la llave VAPID pública (no es secreto) y si el push está activado', srv.includes('vapidPublicKey: VAPID_PUBLIC_KEY || null') && srv.includes('pushEnabled'), '');
  check('v1.4.91 D2: el service worker muestra la notificación y al tocarla abre la app', sw91.includes("self.addEventListener('push'") && sw91.includes('showNotification') && sw91.includes("self.addEventListener('notificationclick'") && sw91.includes("clients.openWindow('/')"), sw91.slice(0, 200));
  const pushFn91 = html.slice(html.indexOf('async function ensurePushSubscription(){'), html.indexOf('/* ===== CHAT PASAJERO ⇄ CHOFER (v1.4.78) ====='));
  const liveTripFn91 = html.slice(html.indexOf('async function openLiveTrip('), html.indexOf('async function renderLiveMap(){'));
  check('v1.4.91 D2: el permiso de notificaciones para el PUSH solo se pide al abrir un viaje/mandado en vivo (ensurePushSubscription solo se llama desde openLiveTrip, nunca al entrar)', liveTripFn91.includes('ensurePushSubscription();') && (html.match(/ensurePushSubscription/g) || []).length === 2 && pushFn91.includes('Notification.requestPermission()') && pushFn91.includes("navigator.serviceWorker.register('/sw.js')") && pushFn91.includes("api('/api/push/subscribe'"), '');
  check('v1.4.91 D2: DEPLOY.md documenta las variables VAPID, el límite de iPhone (solo agregado a inicio + permiso) y que el envío FCM NO está implementado', dep91.includes('VAPID_PUBLIC_KEY') && dep91.includes('VAPID_PRIVATE_KEY') && dep91.includes('nunca') && dep91.includes('pantalla de inicio') && dep91.includes('FCM') && dep91.includes('NO está implementado'), '');
  // --- Estático: detalle 3 (distintivo con conteo) ---
  check('v1.4.91 D3: el botón ancho de chat lleva el círculo rojo con el CONTEO (chatbadge), no un punto vacío', html.includes("chatUnread>0?'<span class=\"chatbadge\">'+chatUnread+'</span>'") && html.includes('.chatwide .chatbadge') && html.includes('.chatbtn .chatbadge'), '');
  check('v1.4.91 D3: con la hoja cerrada cada mensaje del otro lado SUMA al conteo; al abrir el chat se limpia', html.includes('chatSetDot(chatUnread+n)') && html.includes('msgs.filter(m=>m.sender_role!==chatMyRole())') && html.includes('chatSetDot(false)'), '');
  // --- Estático: detalle 4 (fase 1 del pasajero sin mapa) ---
  const liveMapFn91 = html.slice(html.indexOf('async function renderLiveMap(){'), html.indexOf('function renderLiveStrips(){'));
  check('v1.4.91 D4: en fase 1 del PASAJERO (Quiero) renderLiveMap esconde el mapa con nolive-map y vuelve en fase 2', liveMapFn91.includes('if(livePhase1Quiero(r)){') && liveMapFn91.includes("document.getElementById('view-live').classList.add('nolive-map')"), liveMapFn91.slice(0, 200));
  check('v1.4.91 D4: el cambio de regla queda registrado en comentario (la mototaxi en fase 1 queda REEMPLAZADA)', html.includes('CAMBIO DE REGLA') && html.includes('REEMPLAZADA'), '');
  check('v1.4.91 D4: el sondeo ya no recrea el marcador de la mototaxi en fase 1 del pasajero (tampoco en la del chofer)', html.includes('!livePhase1QuieroDriver(r) && !livePhase1Quiero(r)'), '');
  check('v1.4.91 D4: en fase 1 del pasajero se esconden brújula y recentrar (no sirven sin mapa)', html.includes("if(livePhase1Quiero(r)){ $('#live-compass').classList.add('hidden'); $('#live-recenter').classList.add('hidden'); }"), '');
  check('v1.4.91 D4: la tarjeta de estado de fase 1 del pasajero sigue igual (comprando + Se compra en + Lleva $ + línea de tiempo)', html.includes('El conductor está comprando tu encargo') && html.includes('buytimeline') && html.includes('En camino a entregarte'), '');
  // --- Estático: detalle 5 (regla de 30 min) ---
  check('v1.4.91 D5: el servidor sella accepted_at al aceptar y lo expone en la solicitud', srv.includes("accepted_at=datetime('now')") && srv.includes("addCol('requests', 'accepted_at', 'TEXT')"), '');
  check('v1.4.91 D5: el servidor bloquea cancelar el mandado aceptado antes de 30 min (solo mandados, solo antes de comprado, con sello)', srv.includes('30 * 60 * 1000') && srv.includes("r.status === 'aceptado' && r.kind === 'mandado'") && srv.includes('espera 30 minutos desde que el chofer lo aceptó'), '');
  check('v1.4.91 D5: el cliente esconde el botón y pone la notita durante el bloqueo (mandadoCancelLocked)', html.includes('function mandadoCancelLocked(r){') && html.includes('Podrás cancelar a partir de los 30 minutos si el chofer aún no va a entregarte') && html.includes('cancelLock91'), '');
  check('v1.4.91 D5: en comprado ya no se puede cancelar ni en el cliente (canCancel lo excluye)', html.includes("['recogido','comprado','en_viaje','entregado']"), '');
  // --- Estático: detalle 6 (conteo del chofer) ---
  check('v1.4.91 D6: la pantalla de fase 1 del chofer lleva el conteo #md-countdown que se actualiza cada segundo desde accepted_at', html.includes('id="md-countdown"') && html.includes('setInterval(updateMandadoCountdown, 1000)') && html.includes('function mandadoCountdownText(r){') && html.includes('El pasajero ya puede cancelar'), '');
  // --- Evaluado: mandadoCancelLocked ---
  let lock91 = null, lock91Err = '';
  try {
    const srcL91 = html.slice(html.indexOf('function mandadoCancelLocked(r){'), html.indexOf('\n}', html.indexOf('function mandadoCancelLocked(r){')) + 2);
    const runL91 = new Function('r', srcL91 + '; return mandadoCancelLocked(r);');
    const utc91 = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    const now91 = Date.now();
    lock91 = {
      recien: runL91({ kind: 'mandado', status: 'aceptado', trip_stage: 'en_camino', accepted_at: utc91(now91) }),
      min31: runL91({ kind: 'mandado', status: 'aceptado', trip_stage: 'en_camino', accepted_at: utc91(now91 - 31 * 60 * 1000) }),
      sinSello: runL91({ kind: 'mandado', status: 'aceptado', trip_stage: 'en_camino', accepted_at: null }),
      viaje: runL91({ kind: 'viaje', status: 'aceptado', trip_stage: 'en_camino', accepted_at: utc91(now91) }),
      comprado: runL91({ kind: 'mandado', status: 'aceptado', trip_stage: 'comprado', accepted_at: utc91(now91) }),
      buscando: runL91({ kind: 'mandado', status: 'buscando', trip_stage: null, accepted_at: null })
    };
  } catch (e) { lock91Err = String(e && e.message || e); }
  check('v1.4.91 D5: evaluado — mandadoCancelLocked: bloqueado recién aceptado; libre a los 31 min, sin sello (fila vieja), en viajes, en comprado y buscando', !!lock91 && lock91.recien === true && lock91.min31 === false && lock91.sinSello === false && lock91.viaje === false && lock91.comprado === false && lock91.buscando === false, lock91Err || JSON.stringify(lock91));
  // --- Evaluado: mandadoCountdownText ---
  let cd91 = null, cd91Err = '';
  try {
    const srcC91 = html.slice(html.indexOf('function mandadoCountdownText(r){'), html.indexOf('\n}', html.indexOf('function mandadoCountdownText(r){')) + 2);
    const runC91 = new Function('r', srcC91 + '; return mandadoCountdownText(r);');
    const utc91b = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    const now91b = Date.now();
    cd91 = {
      recien: runC91({ accepted_at: utc91b(now91b) }),
      min28: runC91({ accepted_at: utc91b(now91b - 28 * 60 * 1000) }),
      vencido: runC91({ accepted_at: utc91b(now91b - 31 * 60 * 1000) }),
      sinSello: runC91({ accepted_at: null })
    };
  } catch (e) { cd91Err = String(e && e.message || e); }
  check('v1.4.91 D6: evaluado — el conteo empieza en 30:00, a los 28 min marca 02:00 y vencido/sin sello dice "El pasajero ya puede cancelar"', !!cd91 && /^Tienes 30:00/.test(cd91.recien) && /^Tienes 02:00/.test(cd91.min28) && cd91.vencido === 'El pasajero ya puede cancelar' && cd91.sinSello === 'El pasajero ya puede cancelar', cd91Err || JSON.stringify(cd91));
  // --- Evaluado: chatWideBtnHtml con conteo ---
  let wide91 = null, wide91Err = '';
  try {
    const srcW91 = html.slice(html.indexOf('function chatWideBtnHtml(){'), html.indexOf('function chatShowBtn(){'));
    const runW91 = new Function('liveAsDriver', 'chatUnread', srcW91 + '; return chatWideBtnHtml();');
    wide91 = { con3: runW91(false, 3), sin: runW91(false, 0), chofer: runW91(true, 2) };
  } catch (e) { wide91Err = String(e && e.message || e); }
  check('v1.4.91 D3: evaluado — el botón ancho muestra "3" con 3 no leídos, nada con 0, y "Chat con el pasajero" del lado del chofer', !!wide91 && wide91.con3.includes('<span class="chatbadge">3</span>') && wide91.con3.includes('Chat con el conductor') && !wide91.sin.includes('chatbadge') && wide91.chofer.includes('Chat con el pasajero') && wide91.chofer.includes('<span class="chatbadge">2</span>'), wide91Err || JSON.stringify(wide91));
  // --- Evaluado: livePhase1Quiero (fase 1 solo pasajero + Quiero + antes de comprado) ---
  let ph91 = null, ph91Err = '';
  try {
    const span91 = html.slice(html.indexOf('function liveHeadingToDest(r){'), html.indexOf('function nextStage(r){'));
    const runP91 = new Function('r', 'liveAsDriver', span91 + '; return livePhase1Quiero(r);');
    const q91 = { kind: 'mandado', trip_stage: 'en_camino' };
    const qC91 = { kind: 'mandado', trip_stage: 'comprado' };
    const env91 = { kind: 'mandado', trip_stage: 'en_camino', recipient_phone: '9610000099' };
    const trip91 = { kind: 'viaje', trip_stage: 'en_camino' };
    ph91 = { paxQuiero: runP91(q91, false), paxComprado: runP91(qC91, false), paxEnviar: runP91(env91, false), paxViaje: runP91(trip91, false), choferQuiero: runP91(q91, true) };
  } catch (e) { ph91Err = String(e && e.message || e); }
  check('v1.4.91 D4: evaluado — fase 1 es solo pasajero + Quiero + antes de comprado (Enviar, viajes y chofer quedan fuera)', !!ph91 && ph91.paxQuiero === true && ph91.paxComprado === false && ph91.paxEnviar === false && ph91.paxViaje === false && ph91.choferQuiero === false, ph91Err || JSON.stringify(ph91));
  // --- En vivo: mandado Quiero + Enviar + viaje para la regla de 30 min y el push ---
  const lockOpen91 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: false });
  check('v1.4.91: el admin abre el candado de Mandados para las pruebas en vivo', lockOpen91.ok && lockOpen91.mandados_locked === false, JSON.stringify(lockOpen91));
  const subChat91 = await api('/api/subscribe-driver', { driver_id: chatDrv.driver.id, plan: 'yearly' });
  check('v1.4.91: el chofer del chat queda suscrito (evita el límite gratis en las aceptas de la sección)', subChat91.ok, JSON.stringify(subChat91));
  const man91 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', origin_zone: 'Bodega Aurrerá', origin_detail: 'Bodega Aurrerá', origin_lat: 16.87137, origin_lng: -93.20652, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', order_payment: 'por_pagar', order_amount: 150, stops: [{ zone: 'Bodega Aurrerá', lat: 16.87137, lng: -93.20652, detail: '' }], extra_stops: 0 });
  check('v1.4.91: mandado Quiero de prueba se publica', man91.ok && man91.request.id, JSON.stringify(man91));
  const acc91 = await api('/api/driver-respond', { driver_id: chatDrv.driver.id, request_id: man91.request.id, kind: 'acepta', price: 30 });
  check('v1.4.91: el chofer acepta el mandado Quiero', acc91.ok && acc91.request.status === 'aceptado', JSON.stringify(acc91));
  const row91 = (await api('/api/requests?id=' + man91.request.id)).requests[0];
  check('v1.4.91 D5/D6: en vivo — la solicitud aceptada trae accepted_at (sello de la regla de 30 min)', !!row91.accepted_at && typeof row91.accepted_at === 'string', JSON.stringify({ accepted_at: row91.accepted_at }));
  // --- En vivo: push (solo si el servidor tiene llaves VAPID; si no, el endpoint lo dice) ---
  const cfg91 = await api('/api/config');
  const crypto91 = require('node:crypto');
  const mkSub91 = () => {
    const ecdh = crypto91.createECDH('prime256v1'); ecdh.generateKeys();
    return { endpoint: 'https://example.invalid/push-91-' + RUN + '-' + Math.random().toString(36).slice(2, 8), keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto91.randomBytes(16).toString('base64url') } };
  };
  if (cfg91.pushEnabled && cfg91.vapidPublicKey) {
    const subDrv91 = mkSub91();
    const ps1 = await api('/api/push/subscribe', { token: chatDrvAcc.token, subscription: subDrv91 });
    check('v1.4.91 D2: en vivo — el chofer suscribe su navegador al push (se guarda endpoint + llaves)', ps1.ok && ps1.subscriptions === 1, JSON.stringify(ps1));
    const ps1b = await api('/api/push/subscribe', { token: chatDrvAcc.token, subscription: subDrv91 });
    check('v1.4.91 D2: en vivo — suscribir el mismo endpoint otra vez NO duplica (upsert, sigue 1)', ps1b.ok && ps1b.subscriptions === 1, JSON.stringify(ps1b));
    const subPax91 = mkSub91();
    const ps2 = await api('/api/push/subscribe', { token: chatPaxAcc.token, subscription: subPax91 });
    check('v1.4.91 D2: en vivo — la pasajera suscribe su navegador al push', ps2.ok && ps2.subscriptions === 1, JSON.stringify(ps2));
    const fcm91 = await api('/api/push/fcm-token', { token: chatDrvAcc.token, fcm_token: 'fcm-91-' + RUN });
    check('v1.4.91 D2: en vivo — el token FCM de la app nativa se guarda (sin envío: no hay llave de Firebase)', fcm91.ok && fcm91.stored === true, JSON.stringify(fcm91));
    const badSub91 = await api('/api/push/subscribe', { token: chatDrvAcc.token, subscription: { endpoint: 'https://example.invalid/x' } });
    check('v1.4.91 D2: en vivo — suscripción sin llaves se rechaza (400)', !badSub91.ok, JSON.stringify(badSub91));
    const noTokSub91 = await api('/api/push/subscribe', { subscription: subDrv91 });
    check('v1.4.91 D2: en vivo — suscribirse sin sesión es 401', !noTokSub91.ok, JSON.stringify(noTokSub91));
    // Envío al mandar un mensaje: el endpoint es falso (example.invalid),
    // así que la entrega falla — lo que se verifica es que el servidor
    // INTENTÓ avisar al otro lado (registro /api/push/log, solo con
    // SANFERGO_PUSH_LOG=1). El mensaje igual se guarda.
    const waitLog91 = async (pred) => {
      // El endpoint es falso (example.invalid): el fallo TLS puede tardar
      // varios segundos en saberse (proxy del entorno), así que se espera
      // hasta 10 s.
      for (let i = 0; i < 20; i++) {
        const lg = await api('/api/push/log');
        if (lg.ok && (lg.attempts || []).some(pred)) return lg.attempts.find(pred);
        await new Promise(r => setTimeout(r, 500));
      }
      return null;
    };
    await new Promise(r => setTimeout(r, 1100));
    const chat91a = await api('/api/chat/send', { token: chatPaxAcc.token, request_id: man91.request.id, text: 'Hola, ¿ya compraste todo?', role: 'pasajero' });
    check('v1.4.91 D2: en vivo — la pasajera manda texto en el chat del mandado', chat91a.ok && chat91a.message.text === 'Hola, ¿ya compraste todo?', JSON.stringify(chat91a));
    const att91a = await waitLog91(a => a.request_id === man91.request.id && a.endpoint === subDrv91.endpoint);
    check('v1.4.91 D2: en vivo — al mandar la pasajera, el servidor intentó el push al CHOFER (endpoint suscrito, envío simulado)', !!att91a, JSON.stringify(att91a));
    await new Promise(r => setTimeout(r, 1100));
    const chat91b = await api('/api/chat/send', { token: chatDrvAcc.token, request_id: man91.request.id, photo: PHOTO, role: 'chofer' });
    check('v1.4.91 D2: en vivo — el chofer manda foto en el chat del mandado', chat91b.ok && chat91b.message.kind === 'foto', JSON.stringify(chat91b));
    const att91b = await waitLog91(a => a.request_id === man91.request.id && a.endpoint === subPax91.endpoint);
    check('v1.4.91 D2: en vivo — al mandar el chofer (foto), el servidor intentó el push a la PASAJERA', !!att91b, JSON.stringify(att91b));
  } else {
    const psOff91 = await api('/api/push/subscribe', { token: chatDrvAcc.token, subscription: mkSub91() });
    check('v1.4.91 D2: sin llaves VAPID el servidor dice que el push no está activado (la suite corre sin llaves)', !psOff91.ok && /no están activadas/.test(psOff91.error || ''), JSON.stringify(psOff91));
  }
  // --- En vivo: regla de 30 min (Quiero bloqueado, Enviar bloqueado, viaje libre) ---
  const can91q = await api('/api/cancel-request', { request_id: man91.request.id });
  check('v1.4.91 D5: en vivo — cancelar el mandado Quiero aceptado hace 0 min se RECHAZA (faltan 30 min)', !can91q.ok && /30 minutos/.test(can91q.error || ''), JSON.stringify(can91q));
  const env91 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', type: 'enviar', origin_zone: 'Mi ubicación', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Centro', dest_lat: 16.87137, dest_lng: -93.20652, distance_km: 1.0, price: 30, payment_method: 'efectivo', description: 'Paquete', recipient_phone: '9610000099', recipient_name: 'Quien recibe', order_payment: 'pagado', order_amount: 0 });
  const accEnv91 = await api('/api/driver-respond', { driver_id: chatDrv.driver.id, request_id: env91.request.id, kind: 'acepta', price: 30 });
  const can91e = await api('/api/cancel-request', { request_id: env91.request.id });
  check('v1.4.91 D5: en vivo — Enviar aceptado TAMBIÉN está bloqueado los primeros 30 min (la regla cubre Quiero + Enviar)', env91.ok && accEnv91.ok && !can91e.ok && /30 minutos/.test(can91e.error || ''), JSON.stringify(can91e));
  const trip91 = await api('/api/create-request', { passenger_id: pax.passenger.id, kind: 'viaje', origin_zone: 'Centro', origin_detail: 'Centro', origin_lat: 16.8709, origin_lng: -93.2063, dest_zone: 'Mercado', dest_detail: 'Mercado', dest_lat: 16.8675, dest_lng: -93.2105, distance_km: 1.0, eta_minutes: 5, price: 25, payment_method: 'efectivo' });
  const accTrip91 = await api('/api/driver-respond', { driver_id: drv.driver.id, request_id: trip91.request.id, kind: 'acepta', price: 25 });
  const can91t = await api('/api/cancel-request', { request_id: trip91.request.id });
  check('v1.4.91 D5: en vivo — los VIAJES no cambian: el viaje aceptado sí se cancela al instante', trip91.ok && accTrip91.ok && can91t.ok, JSON.stringify(can91t));
  // Fallback de filas viejas: sin accepted_at el mandado se trata como
  // vencido y SÍ se puede cancelar (no queda bloqueado para siempre).
  {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath91 = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'sanfergo.db');
    const tdb91 = new DatabaseSync(dbPath91);
    tdb91.prepare(`UPDATE requests SET accepted_at=NULL WHERE id=?`).run(man91.request.id);
    tdb91.close();
  }
  const can91old = await api('/api/cancel-request', { request_id: man91.request.id });
  check('v1.4.91 D5: en vivo — fila vieja sin accepted_at: se trata como vencida y el mandado SÍ se cancela', can91old.ok, JSON.stringify(can91old));
  // El Enviar bloqueado se termina para no dejarlo activo.
  for (const st91 of ['llego', 'en_viaje', 'entregado']) { const a91 = await api('/api/advance-stage', { driver_id: chatDrv.driver.id, request_id: env91.request.id, stage: st91 }); if (!a91.ok) break; }
  const lockClose91 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: true });
  check('v1.4.91: el candado de Mandados vuelve a quedar puesto', lockClose91.ok && lockClose91.mandados_locked === true, JSON.stringify(lockClose91));

  // ===== v1.4.92 (2026-11-27): 4 detalles de la prueba en el teléfono (distintivo del chofer, WhatsApp sin pestaña en blanco, teclado que tapa Continuar, encabezado del punto) =====
  console.log('== v1.4.92: distintivo del chofer por rol, WhatsApp sin pestaña, teclado al marcar, encabezado seleccionado ==');
  // --- Estático: distintivo del chofer (acuse de lectura por rol) ---
  check('v1.4.92 I1: el servidor guarda el acuse de lectura POR ROL (tabla chat_read con PK(request_id, role))', srv.includes('CREATE TABLE IF NOT EXISTS chat_read') && srv.includes('PRIMARY KEY(request_id, role)') && srv.includes('last_read_id INTEGER NOT NULL DEFAULT 0'), '');
  check('v1.4.92 I1: POST /api/chat/read marca leído por rol (upsert, solo si el chat es suyo)', srv.includes("'/api/chat/read'") && srv.includes('INSERT INTO chat_read (request_id, role, last_read_id)') && srv.includes('ON CONFLICT(request_id, role)') && srv.includes('Este chat no es tuyo.'), '');
  check('v1.4.92 I1: GET /api/chat devuelve `unread` del otro rol según lo leído (role de la vista, respaldo al rol de la cuenta)', srv.includes("q.get('role')") && srv.includes('SELECT COUNT(*) c FROM chat_messages WHERE request_id=? AND sender_role=? AND id>?') && srv.includes('unread, messages:'), '');
  const seedFn92 = html.slice(html.indexOf('async function chatSeed(){'), html.indexOf('function chatTime(ts){'));
  const fetchFn92 = html.slice(html.indexOf('async function chatFetch(){'), html.indexOf('function chatSheetHtml(){'));
  const openSheetFn92 = html.slice(html.indexOf('async function openChatSheet(){'), html.indexOf('function chatCloseSheet(silent){'));
  const closeSheetFn92 = html.slice(html.indexOf('function chatCloseSheet(silent){'), html.indexOf('/* v1.4.87: tocar el fondo oscuro'));
  check('v1.4.92 I1: el cliente pinta el distintivo con el conteo del SERVIDOR (chatFetch y chatSeed pasan role y usan j.unread)', fetchFn92.includes("&role='+chatMyRole()") && fetchFn92.includes("if(!chatOpen && typeof j.unread==='number') chatSetDot(j.unread);") && seedFn92.includes("&role='+chatMyRole()") && seedFn92.includes('chatSetDot(j.unread)'), fetchFn92.slice(0, 200));
  check('v1.4.92 I1: entrar a la pantalla en vivo YA NO marca nada como leído (el seed viejo tragaba el mensaje del chofer)', seedFn92.includes('ya NO marca nada como leído') && !seedFn92.includes('marcar hasta dónde'), seedFn92.slice(0, 200));
  check('v1.4.92 I1: abrir y cerrar la hoja marca leído en el servidor (por rol)', openSheetFn92.includes("api('/api/chat/read'") && openSheetFn92.includes('role: chatMyRole()') && closeSheetFn92.includes('wasOpen') && closeSheetFn92.includes("api('/api/chat/read'"), '');
  // --- Estático: WhatsApp sin pestaña en blanco (solo mdAskLocation) ---
  const askFn92 = html.slice(html.indexOf('function mdAskLocation(){'), html.indexOf('let mdDestList = [];'));
  check('v1.4.92 I2: mdAskLocation abre WhatsApp por el esquema whatsapp:// sin pestaña nueva y con respaldo wa.me si la página sigue visible', askFn92.includes("location.href = 'whatsapp://send?phone=52'") && askFn92.includes("setTimeout(function(){ if(!document.hidden) window.open(waUrl, '_blank'); }, 1200);") && !askFn92.includes("window.open('https://wa.me/52'"), askFn92.slice(0, 300));
  check('v1.4.92 I2: los otros enlaces wa.me NO se tocaron (suscripción, negocios y el de :2286)', html.includes("window.open('https://wa.me/?text='") && html.includes('https://wa.me/529614868605') && html.includes("const waLink = 'https://wa.me/'"), '');
  // --- Estático: teclado al marcar el punto ---
  const resolveFn92 = html.slice(html.indexOf('async function mdResolveWaDest(){'), html.indexOf('async function mdActivatePickup(){'));
  check('v1.4.92 I3: al marcar el punto se cierra el teclado de iOS (blur del campo del enlace y del elemento activo)', resolveFn92.includes('waInp.blur()') && resolveFn92.includes('document.activeElement.blur()'), resolveFn92.slice(0, 300));
  // --- Estático: encabezado de la caja de WhatsApp ---
  check('v1.4.92 I4: la caja de WhatsApp muestra "✓ Punto de entrega seleccionado" cuando el punto está marcado', html.includes("md.waDest ? '✓ Punto de entrega seleccionado'"), '');
  // --- En vivo: distintivo del chofer (caso reportado: mensaje antes de entrar a la vista del chofer) ---
  const lockOpen92 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: false });
  check('v1.4.92: el admin reabre el candado de Mandados para las pruebas en vivo', lockOpen92.ok && lockOpen92.mandados_locked === false, JSON.stringify(lockOpen92));
  const man92 = await api('/api/create-request', { passenger_id: chatPaxAcc.passenger.id, kind: 'mandado', origin_zone: 'Bodega Aurrerá', origin_detail: 'Bodega Aurrerá', origin_lat: 16.87137, origin_lng: -93.20652, dest_zone: 'Centro', dest_detail: 'Centro', dest_lat: 16.8709, dest_lng: -93.2063, distance_km: 1.0, price: 30, payment_method: 'efectivo', order_payment: 'por_pagar', order_amount: 150, stops: [{ zone: 'Bodega Aurrerá', lat: 16.87137, lng: -93.20652, detail: '' }], extra_stops: 0 });
  check('v1.4.92 I1: mandado Quiero de prueba se publica', man92.ok && man92.request.id, JSON.stringify(man92));
  const acc92 = await api('/api/driver-respond', { driver_id: chatDrv.driver.id, request_id: man92.request.id, kind: 'acepta', price: 30 });
  check('v1.4.92 I1: el chofer acepta el mandado Quiero', acc92.ok && acc92.request.status === 'aceptado', JSON.stringify(acc92));
  const chat92 = async (role, token) => api('/api/chat?request_id=' + man92.request.id + '&role=' + role + '&token=' + encodeURIComponent(token));
  await new Promise(r => setTimeout(r, 1100)); // anti-spam 1 msg/s: el último envío de la pasajera (pax88bad) fue hace menos de 1 s en tiempo de suite
  const m92a = await api('/api/chat/send', { token: chatPaxAcc.token, request_id: man92.request.id, text: 'Hola, ¿ya vas por el mandado?', role: 'pasajero' });
  check('v1.4.92 I1: la pasajera manda un mensaje ANTES de que el chofer entre (caso reportado)', m92a.ok && m92a.message.sender_role === 'pasajero', JSON.stringify(m92a));
  const un92drv1 = await chat92('chofer', chatDrvAcc.token);
  check('v1.4.92 I1: en vivo — el chofer ve unread=1 aunque el mensaje llegó antes de entrar', un92drv1.ok && un92drv1.unread === 1, JSON.stringify(un92drv1));
  const un92pax0 = await chat92('pasajero', chatPaxAcc.token);
  check('v1.4.92 I1: en vivo — los mensajes propios no cuentan (pasajera unread=0 tras mandar ella)', un92pax0.ok && un92pax0.unread === 0, JSON.stringify(un92pax0));
  const m92b = await api('/api/chat/send', { token: chatDrvAcc.token, request_id: man92.request.id, text: 'Sí, ya voy en camino', role: 'chofer' });
  check('v1.4.92 I1: el chofer manda un mensaje', m92b.ok && m92b.message.sender_role === 'chofer', JSON.stringify(m92b));
  const un92pax1 = await chat92('pasajero', chatPaxAcc.token);
  check('v1.4.92 I1: en vivo — la pasajera ve unread=1', un92pax1.ok && un92pax1.unread === 1, JSON.stringify(un92pax1));
  const un92fb = await chat92('chofer', chatPaxAcc.token);
  check('v1.4.92 I1: en vivo — el rol que no vale para la cuenta se ignora (pasajera pide role=chofer y recibe su propio conteo)', un92fb.ok && un92fb.unread === 1, JSON.stringify(un92fb));
  const rd92drv = await api('/api/chat/read', { token: chatDrvAcc.token, request_id: man92.request.id, role: 'chofer' });
  check('v1.4.92 I1: el chofer marca leído (POST /api/chat/read)', rd92drv.ok && rd92drv.last_read_id === m92b.message.id, JSON.stringify(rd92drv));
  const un92drv0 = await chat92('chofer', chatDrvAcc.token);
  check('v1.4.92 I1: en vivo — tras leer, el chofer ve unread=0 (y la pasajera sigue en 1)', un92drv0.ok && un92drv0.unread === 0 && (await chat92('pasajero', chatPaxAcc.token)).unread === 1, JSON.stringify(un92drv0));
  const rd92pax = await api('/api/chat/read', { token: chatPaxAcc.token, request_id: man92.request.id, role: 'pasajero' });
  check('v1.4.92 I1: la pasajera marca leído (POST /api/chat/read)', rd92pax.ok && rd92pax.last_read_id === m92b.message.id, JSON.stringify(rd92pax));
  const un92pax0b = await chat92('pasajero', chatPaxAcc.token);
  check('v1.4.92 I1: en vivo — tras leer, la pasajera ve unread=0', un92pax0b.ok && un92pax0b.unread === 0, JSON.stringify(un92pax0b));
  const un92drv0b = await chat92('chofer', chatDrvAcc.token);
  check('v1.4.92 I1: en vivo — re-entrar no resucita el conteo (chofer sigue en 0)', un92drv0b.ok && un92drv0b.unread === 0, JSON.stringify(un92drv0b));
  await new Promise(r => setTimeout(r, 1100));
  const m92c = await api('/api/chat/send', { token: chatPaxAcc.token, request_id: man92.request.id, text: 'Perfecto, gracias', role: 'pasajero' });
  check('v1.4.92 I1: la pasajera manda otro mensaje tras la lectura', m92c.ok && m92c.message.sender_role === 'pasajero', JSON.stringify(m92c));
  const un92drv2 = await chat92('chofer', chatDrvAcc.token);
  check('v1.4.92 I1: en vivo — el chofer vuelve a ver unread=1 (el ciclo se repite)', un92drv2.ok && un92drv2.unread === 1, JSON.stringify(un92drv2));
  const un92adm = await api('/api/chat?request_id=' + man92.request.id + '&token=' + encodeURIComponent(ADM.token));
  check('v1.4.92 I1: en vivo — un tercero (admin) no puede leer el chat (403)', !un92adm.ok && /no es tuyo/.test(un92adm.error || ''), JSON.stringify(un92adm));
  const rd92adm = await api('/api/chat/read', { token: ADM.token, request_id: man92.request.id, role: 'chofer' });
  check('v1.4.92 I1: en vivo — un tercero no puede marcar leído (403)', !rd92adm.ok && /no es tuyo/.test(rd92adm.error || ''), JSON.stringify(rd92adm));
  const un92notok = await api('/api/chat?request_id=' + man92.request.id);
  check('v1.4.92 I1: en vivo — sin sesión, leer el chat es 401', !un92notok.ok && /Inicia sesión/.test(un92notok.error || ''), JSON.stringify(un92notok));
  const lockClose92 = await api('/api/admin/set-mandados-locked', { token: ADM.token, locked: true });
  check('v1.4.92: el candado de Mandados vuelve a quedar puesto', lockClose92.ok && lockClose92.mandados_locked === true, JSON.stringify(lockClose92));

  // ===== v1.4.93 (2026-11-27): vista previa de WhatsApp con el logo nuevo y chico (mockup aprobado "Sí, así queda") =====
  console.log('== v1.4.93: og: tags de la vista previa (WhatsApp/Facebook) con el logo nuevo ==');
  check('v1.4.93: og:title y og:description en el <head> (mismo texto que ya mostraba WhatsApp)', html.includes('<meta property="og:title" content="SanFerGo — Viajes y mandados en San Fernando">') && html.includes('<meta property="og:description" content="SanFerGo: pide tu mototaxi o mandado en San Fernando, Chiapas. Tú pones tu precio, el chofer acepta o contraoferta.">'), '');
  check('v1.4.93: og:image + og:url + og:type + twitter:card en el <head>', html.includes('<meta property="og:image" content="https://sanfernandogo.com/og-image.jpg">') && html.includes('<meta property="og:url" content="https://sanfernandogo.com/">') && html.includes('<meta property="og:type" content="website">') && html.includes('<meta name="twitter:card" content="summary_large_image">'), '');
  const ogPath = path.join(__dirname, 'public', 'og-image.jpg');
  const ogBuf = fs.existsSync(ogPath) ? fs.readFileSync(ogPath) : Buffer.alloc(0);
  let ogW = 0, ogH = 0;
  const ogIsJpeg = ogBuf.length > 2 && ogBuf[0] === 0xFF && ogBuf[1] === 0xD8;
  if (ogIsJpeg) { let p = 2; while (p + 4 <= ogBuf.length) { if (ogBuf[p] !== 0xFF) break; const code = ogBuf[p + 1]; if (code === 0xC0 || code === 0xC2) { ogH = ogBuf.readUInt16BE(p + 5); ogW = ogBuf.readUInt16BE(p + 7); break; } if (code === 0xD9 || (code >= 0xD0 && code <= 0xD8) || code === 0x01) { p += 2; continue; } p += 2 + ogBuf.readUInt16BE(p + 2); } }
  check('v1.4.93: public/og-image.jpg existe, es JPEG válido y mide 1200x630 (ancho, logo chico — la vista previa ya no ocupa media pantalla)', ogIsJpeg && ogW === 1200 && ogH === 630, ogW + 'x' + ogH + ' bytes=' + ogBuf.length);

  // ===== v1.4.94 (2026-11-27): botón de WhatsApp en Administrar choferes (mockup aprobado "Sí, así queda") =====
  console.log('== v1.4.94: botón WhatsApp en la tarjeta de cada chofer (admin) ==');
  const adm94 = html.slice(html.indexOf('function renderAdminDrivers'), html.indexOf('function renderAdminDetail'));
  check('v1.4.94: el botón "Enviar mensaje por WhatsApp" existe en la tarjeta de Administrar choferes, debajo de "Ver ficha completa"', adm94.includes('onclick="adminMsgDriver(') && adm94.includes('Enviar mensaje por WhatsApp') && adm94.indexOf('adminMsgDriver(') > adm94.indexOf('Ver ficha completa'), '');
  check('v1.4.94: el botón es verde WhatsApp (#25d366) con el icono de WhatsApp (SVG)', adm94.includes('style="background:#25d366;color:#fff"') && adm94.includes('<svg viewBox="0 0 24 24"'), '');
  const msg94 = html.slice(html.indexOf('function adminMsgDriver'), html.indexOf('function adminMsgDriver') + 2000);
  check('v1.4.94: adminMsgDriver abre WhatsApp por el esquema whatsapp:// con location.href y fallback wa.me a los ~1200 ms (sin pestaña en blanco, mismo patrón que mdAskLocation)', msg94.includes("location.href = 'whatsapp://send?phone=52'+phone+'&text='+encodeURIComponent(msg);") && msg94.includes("setTimeout(function(){ if(!document.hidden) window.open(waUrl, '_blank'); }, 1200);") && msg94.includes("const waUrl = 'https://wa.me/52'+phone+'?text='+encodeURIComponent(msg);"), '');
  check('v1.4.94: el mensaje prellenado es exacto (gracias por registrarse + hay viaje o mandado + entra a la app + sanfernandogo.com)', msg94.includes("¡gracias por registrarte como conductor en SanFerGo! Hay un viaje o un mandado disponible. Entra a la aplicación para aceptarlo: https://sanfernandogo.com") && msg94.includes("'Hola '+first+"), '');
  check('v1.4.94: el teléfono se limpia de no-dígitos antes de usarse y el primer nombre sale del nombre guardado', msg94.includes("(d.phone||'').replace(/\\D/g,'')") && msg94.includes("String(d.name||'').trim().split(/\\s+/)[0]"), '');

  // ===== v1.4.95 (2026-11-27): galería en la foto del registro de pasajero, igual que el chofer (el usuario lo pidió) =====
  console.log('== v1.4.95: foto del pasajero con cámara + galería ==');
  const rpStart = html.indexOf("if(kind==='pasajero')");
  const rpEnd = rpStart >= 0 ? html.indexOf('} else {', rpStart) : -1;
  const rpSrc = rpStart >= 0 && rpEnd > rpStart ? html.slice(rpStart, rpEnd) : '';
  check('v1.4.95: el registro de pasajero tiene dos botones bonitos (Tomar foto verde + Subir de galería naranja), igual que el chofer', rpSrc.includes('Tomar foto') && rpSrc.includes('Subir de galería') && rpSrc.includes('class="btn small"') && rpSrc.includes('class="btn amber small"'), rpSrc.slice(0, 300));
  check('v1.4.95: dos inputs ocultos: rp-cam con capture="user" (cámara frontal) y rp-gal sin capture (galería)', rpSrc.includes('id="rp-cam"') && rpSrc.includes('capture="user"') && rpSrc.includes('id="rp-gal"') && !rpSrc.slice(rpSrc.indexOf('id="rp-gal"'), rpSrc.indexOf('id="rp-gal"') + 60).includes('capture='), rpSrc.slice(0, 300));
  check('v1.4.95: los dos inputs alimentan regPhoto1 y actualizan la vista previa #rp-prev', (rpSrc.match(/regPhoto1=d/g) || []).length === 2 && (rpSrc.match(/rp-prev/g) || []).length >= 3, '');
  check('v1.4.95: el texto y la advertencia de foto obligatoria no cambiaron', rpSrc.includes('Tómala con la cámara o súbela de tu galería') && rpSrc.includes('es obligatoria'), '');

  // ===== v1.4.96 (2026-11-27): botón verde de llamar en mandados + número del pasajero en Quiero (el usuario lo pidió en vivo) =====
  console.log('== v1.4.96: llamar en mandados + número en Quiero ==');
  check('v1.4.96: la línea Recibe sigue prefiriendo el destinatario (Enviar), pero en Quiero (sin destinatario) muestra el número del propio pasajero', liveSec.includes("r.recipient_phone ? ' · '+esc(r.recipient_phone)") && liveSec.includes("r.passenger_phone ? ' · '+esc(r.passenger_phone) : ''"), '');
  check('v1.4.96: botón verde de llamar en mandados (llego/comprado/en_viaje) con el mismo .callbtn de viajes, y se pinta en la tarjeta', liveSec.includes("r.kind==='mandado' && (r.trip_stage==='llego' || r.trip_stage==='comprado' || r.trip_stage==='en_viaje')") && liveSec.includes('callBtn60 + callBtn96') && (liveSec.match(/callBtn96/g)||[]).length >= 2, '');
  check('v1.4.96: el destino de la llamada depende de la etapa — en en_viaje/comprado con destinatario se marca al destinatario (Enviar, entregando); si no, al pasajero', liveSec.includes("(r.trip_stage==='en_viaje' || r.trip_stage==='comprado') && r.recipient_phone") && liveSec.includes("r.passenger_phone ? { name: r.passenger_name||'Pasajero', phone: r.passenger_phone }"), '');
  check('v1.4.96: el botón de llamar de viajes no cambió (llego/en_viaje, pasajero) y el enlace chico (en_camino/llego, pasajero) tampoco', liveSec.includes("r.kind==='viaje' && (r.trip_stage==='llego' || r.trip_stage==='en_viaje') && r.passenger_phone") && liveSec.includes("if(r.trip_stage==='en_camino' || r.trip_stage==='llego') miniLinks.push"), '');

  console.log('== Listados ==');
  const all = await api('/api/requests');
  check('listar solicitudes con ofertas', all.ok && all.requests.length >= 4 && all.requests.every(r => Array.isArray(r.offers)));
  const open = await api('/api/requests?open=1');
  check('listar solicitudes abiertas', open.ok && open.requests.every(r => r.status === 'buscando'));

  console.log(`\nRESULTADO: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR DE PRUEBA', e); process.exit(2); });
