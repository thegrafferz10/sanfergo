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
  for (const st of ['a_recoger', 'llego', 'recogido', 'en_camino', 'entregado']) {
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
  await api('/api/advance-stage', { driver_id: drv3.driver.id, request_id: m2.request.id, stage: 'a_recoger' });
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
  const accMail = await api('/api/register-account', { name: 'Beto Correo', username: 'beto_' + RUN, email: 'beto' + RUN + '@prueba.mx', password: 'secreta123' });
  check('crear cuenta solo con correo (crea perfil de pasajero)', accMail.ok && accMail.account.email === 'beto' + RUN + '@prueba.mx' && !!accMail.passenger, JSON.stringify(accMail));
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
  const entryV = await api('/api/entry-ad?entry=viajes&token=' + admLogin.token);
  check('anuncio de entrada flotante en Viajes (v1.3.5)', entryV.ok && entryV.ad && entryV.ad.id === ad.ad.id, JSON.stringify(entryV));
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
  check('versión 1.3.6 en /api/health', h.ok && h.version === '1.3.6', JSON.stringify(h));
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
  check('versión 1.3.6', h134.ok && h134.version === '1.3.6', JSON.stringify(h134));
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
  check('mapas sin llave en cliente y servidor (nada de MapTiler ni api_key)', !/maptiler/i.test(html + srv) && !/api[_-]?key/i.test(html + srv));
  // Corrección del orden del viaje activo (v1.3.4): el aviso verde ya NO va
  // arriba; va en la columna de abajo, debajo de Cancelar, sobre la tarjeta.
  check('orden corregido del viaje activo: aviso verde en la columna de abajo, no arriba', html.includes('.strip.bottom.paxbot .arrive') && !html.includes('.strip.top.paxcol .arrive') && !/top\.innerHTML = \(showArrive/.test(html));
  const bi = html.indexOf('bot.innerHTML = (canCancel');
  check('Cancelar, aviso verde y tarjeta del chofer van en la columna de abajo, en ese orden', bi > 0 && html.indexOf('+ arriveHtml', bi) > bi && html.indexOf('drivercard', bi) > html.indexOf('+ arriveHtml', bi));
  check('encuadre del viaje activo deja más aire abajo que arriba', html.includes('bottom: botPad') && html.includes('offset: [0, -60]'));

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
  check('quinto servicio gratis del día confirma', t5.ok && t5.request.status === 'aceptado', JSON.stringify(t5));
  const accL = await api('/api/respond-offer', { passenger_id: pax.passenger.id, request_id: rqL.request.id, offer_id: offL.offer.id, action: 'acepta' });
  check('con 5 servicios, respond-offer ya no confirma (límite gratis)', !accL.ok && /5 servicios gratis/.test(accL.error || ''), JSON.stringify(accL));
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
  check('cambiar pago con viaje aceptado rechazado (ya quedó fijada)', !payNo.ok && /fijada/.test(payNo.error || ''), JSON.stringify(payNo));
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
  const adB = await api('/api/create-ad', { token: admLogin.token, label: 'Anuncio libre ' + RUN, image: ADIMG, kind: 'libre', entries: ['viajes'] });
  check('anuncio libre para el sorteo', adB.ok && adB.ad.id, JSON.stringify(adB));
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const e = await api('/api/entry-ad?entry=viajes&token=' + li1.token);
    if (e.ok && e.ad) seen.add(e.ad.id);
  }
  check('entry-ad con historial devuelve AMBOS anuncios en 40 sorteos (al azar, no solo el del historial)', seen.has(adA.ad.id) && seen.has(adB.ad.id), 'vistos: ' + [...seen].join(','));

  console.log('== Listados ==');
  const all = await api('/api/requests');
  check('listar solicitudes con ofertas', all.ok && all.requests.length >= 4 && all.requests.every(r => Array.isArray(r.offers)));
  const open = await api('/api/requests?open=1');
  check('listar solicitudes abiertas', open.ok && open.requests.every(r => r.status === 'buscando'));

  console.log(`\nRESULTADO: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR DE PRUEBA', e); process.exit(2); });
