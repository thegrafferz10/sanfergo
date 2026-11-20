// SanFerGo — servidor público (Node.js sin dependencias, SQLite persistente)
// Uso:  node server.js        (PORT=3000, datos en ./data/sanfergo.db)
//       PORT=8080 DATA_DIR=/ruta node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'sanfergo.db'));
db.exec('PRAGMA journal_mode=WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, phone TEXT NOT NULL, vehicle TEXT NOT NULL,
  unit TEXT, online INTEGER DEFAULT 0, plan TEXT DEFAULT 'gratis',
  subscription_until TEXT, selfie TEXT, vehicle_photo TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS passengers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, phone TEXT NOT NULL, face_photo TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL, passenger_id INTEGER, passenger_name TEXT, passenger_phone TEXT, passenger_photo TEXT,
  origin_zone TEXT, origin_detail TEXT, origin_lat REAL, origin_lng REAL,
  dest_zone TEXT, dest_detail TEXT, dest_lat REAL, dest_lng REAL,
  distance_km REAL, eta_minutes INTEGER, price REAL, final_price REAL,
  payment_method TEXT, description TEXT,
  status TEXT DEFAULT 'buscando', trip_stage TEXT, trip_stage_at TEXT,
  driver_id INTEGER, driver_name TEXT, driver_phone TEXT, driver_photo TEXT,
  driver_unit TEXT, driver_vehicle TEXT, vehicle_photo TEXT,
  driver_lat REAL, driver_lng REAL, driver_loc_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL, driver_id INTEGER NOT NULL,
  driver_name TEXT, driver_phone TEXT, driver_photo TEXT, driver_plan TEXT,
  driver_unit TEXT, driver_vehicle TEXT, vehicle_photo TEXT,
  eta_minutes INTEGER, kind TEXT NOT NULL, price REAL NOT NULL,
  status TEXT DEFAULT 'pendiente', passenger_counter_price REAL,
  is_premium INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_type TEXT NOT NULL, reporter_name TEXT, reporter_phone TEXT,
  item TEXT NOT NULL, service TEXT, date_text TEXT, contact TEXT,
  status TEXT DEFAULT 'perdido',
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ---- Lugares de San Fernando, Chiapas (16 destinos) ----
// Centro y Parque: verificados. Guerrero (calle Vicente Guerrero), Clínica
// (Clínica San Luis) y Centro de Salud: geocodificados. Arco, Madero y
// Las Isabeles: puntos GPS reales de viajes del usuario. El resto son
// puntos distintos colocados alrededor del pueblo; si alguno queda mal,
// se corrige en este archivo (PLACES).
const PLACES = [
  { name: 'Centro', lat: 16.8709, lng: -93.2063 },
  { name: 'Parque', lat: 16.87137, lng: -93.20652 },
  { name: 'Mercado', lat: 16.8675, lng: -93.2105 },
  { name: 'Arco', lat: 16.8605, lng: -93.2059 },
  { name: 'Madero', lat: 16.8704, lng: -93.2188 },
  { name: 'Copalar', lat: 16.8550, lng: -93.1980 },
  { name: 'Terrero Copalar', lat: 16.8580, lng: -93.2020 },
  { name: 'Guerrero', lat: 16.87793, lng: -93.20806 },
  { name: 'La Esperanza', lat: 16.8730, lng: -93.2140 },
  { name: 'La Gloria', lat: 16.8660, lng: -93.1990 },
  { name: 'Progreso Centro', lat: 16.8840, lng: -93.1960 },
  { name: 'Progreso Buenos Aires', lat: 16.8860, lng: -93.1930 },
  { name: 'Progreso Loma Bonita', lat: 16.8820, lng: -93.1990 },
  { name: 'Clínica', lat: 16.87226, lng: -93.20509 },
  { name: 'Barrio de Guadalupe', lat: 16.8785, lng: -93.2070 },
  { name: 'Las Isabeles', lat: 16.8653, lng: -93.2036 },
];

const BASE_FARE = 12, PER_KM = 7, FREE_DAILY_LIMIT = 5, PREMIUM_MIN_PRICE = 80, SUB_PRICE = 70;
const TRIP_STAGES = ['confirmado', 'en_camino', 'llego', 'en_viaje', 'finalizado'];
const MANDADO_STAGES = ['confirmado', 'a_recoger', 'llego', 'recogido', 'en_camino', 'entregado'];

function haversineKm(a, b, c, d) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const x = rad(c - a), y = rad(d - b);
  const h = Math.sin(x / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fareFor(km) { return Math.round(BASE_FARE + PER_KM * km); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function driverServicesToday(driverId) {
  const row = db.prepare(
    `SELECT COUNT(*) c FROM requests WHERE driver_id=? AND status IN ('aceptado','finalizado')
     AND substr(created_at,1,10)=?`).get(driverId, todayStr());
  return row ? row.c : 0;
}
function driverHasSub(driver) {
  return driver && driver.subscription_until && new Date(driver.subscription_until) > new Date();
}
function driverComplete(driver) { return !!(driver && driver.selfie && driver.vehicle_photo); }

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', ch => { data += ch; if (data.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function offersFor(requestId) {
  return db.prepare(`SELECT * FROM offers WHERE request_id=? ORDER BY is_premium DESC, created_at ASC`).all(requestId);
}
function requestsWithOffers(rows) { return rows.map(r => ({ ...r, offers: offersFor(r.id) })); }

// ---- API ----
async function api(req, res, pathname) {
  const body = req.method === 'POST' ? await readBody(req) : {};
  const q = new URL(req.url, 'http://x').searchParams;

  if (pathname === '/api/health') return send(res, 200, { ok: true, app: 'SanFerGo', version: '1.0.0' });
  if (pathname === '/api/places') return send(res, 200, { ok: true, places: PLACES, fare: { base: BASE_FARE, per_km: PER_KM } });

  if (pathname === '/api/register-driver') {
    const { name, phone, vehicle, unit, selfie, vehicle_photo } = body;
    if (!name || !phone || !vehicle) return send(res, 400, { ok: false, error: 'Faltan datos del conductor.' });
    if (vehicle !== 'mototaxi' && vehicle !== 'moto') return send(res, 400, { ok: false, error: 'Vehículo no válido.' });
    const r = db.prepare(`INSERT INTO drivers (name, phone, vehicle, unit, selfie, vehicle_photo) VALUES (?,?,?,?,?,?)`)
      .run(name.trim(), phone.trim(), vehicle, (unit || '').trim(), selfie || null, vehicle_photo || null);
    return send(res, 200, { ok: true, driver: db.prepare('SELECT * FROM drivers WHERE id=?').get(r.lastInsertRowid) });
  }
  if (pathname === '/api/register-passenger') {
    const { name, phone, face_photo } = body;
    if (!name || !phone) return send(res, 400, { ok: false, error: 'Faltan datos del pasajero.' });
    const r = db.prepare(`INSERT INTO passengers (name, phone, face_photo) VALUES (?,?,?)`)
      .run(name.trim(), phone.trim(), face_photo || null);
    return send(res, 200, { ok: true, passenger: db.prepare('SELECT * FROM passengers WHERE id=?').get(r.lastInsertRowid) });
  }
  if (pathname === '/api/upload-driver-photo') {
    const { driver_id, kind, photo } = body;
    if (!driver_id || !photo || (kind !== 'selfie' && kind !== 'vehicle')) return send(res, 400, { ok: false, error: 'Datos incompletos.' });
    db.prepare(`UPDATE drivers SET ${kind === 'selfie' ? 'selfie' : 'vehicle_photo'}=? WHERE id=?`).run(photo, driver_id);
    return send(res, 200, { ok: true, driver: db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id) });
  }
  if (pathname === '/api/upload-passenger-photo') {
    const { passenger_id, photo } = body;
    if (!passenger_id || !photo) return send(res, 400, { ok: false, error: 'Datos incompletos.' });
    db.prepare('UPDATE passengers SET face_photo=? WHERE id=?').run(photo, passenger_id);
    return send(res, 200, { ok: true, passenger: db.prepare('SELECT * FROM passengers WHERE id=?').get(passenger_id) });
  }
  if (pathname === '/api/update-passenger') {
    const { passenger_id, name, phone } = body;
    const p = db.prepare('SELECT * FROM passengers WHERE id=?').get(passenger_id);
    if (!p) return send(res, 404, { ok: false, error: 'Pasajero no encontrado.' });
    db.prepare('UPDATE passengers SET name=?, phone=? WHERE id=?').run(name || p.name, phone || p.phone, passenger_id);
    return send(res, 200, { ok: true, passenger: db.prepare('SELECT * FROM passengers WHERE id=?').get(passenger_id) });
  }
  if (pathname === '/api/update-driver') {
    const { driver_id, name, phone, vehicle, unit } = body;
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id);
    if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
    db.prepare('UPDATE drivers SET name=?, phone=?, vehicle=?, unit=? WHERE id=?')
      .run(name || d.name, phone || d.phone, vehicle || d.vehicle, unit ?? d.unit, driver_id);
    return send(res, 200, { ok: true, driver: db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id) });
  }
  if (pathname === '/api/drivers') {
    return send(res, 200, { ok: true, drivers: db.prepare('SELECT * FROM drivers ORDER BY id DESC').all() });
  }
  if (pathname === '/api/passengers') {
    return send(res, 200, { ok: true, passengers: db.prepare('SELECT * FROM passengers ORDER BY id DESC').all() });
  }
  if (pathname === '/api/set-driver-online') {
    const { driver_id, online } = body;
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id);
    if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
    if (online && !driverComplete(d)) return send(res, 400, { ok: false, error: 'Completa tu registro: falta tu foto o la foto de tu mototaxi/moto.' });
    db.prepare('UPDATE drivers SET online=? WHERE id=?').run(online ? 1 : 0, driver_id);
    return send(res, 200, { ok: true, driver: db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id) });
  }
  if (pathname === '/api/subscribe-driver') {
    const { driver_id } = body;
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id);
    if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
    const base = driverHasSub(d) ? new Date(d.subscription_until) : new Date();
    base.setDate(base.getDate() + 7);
    const until = base.toISOString();
    db.prepare(`UPDATE drivers SET plan='suscripcion', subscription_until=? WHERE id=?`).run(until, driver_id);
    return send(res, 200, { ok: true, driver: db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id), price: SUB_PRICE });
  }
  if (pathname === '/api/create-request') {
    const { passenger_id, kind, origin_zone, origin_detail, origin_lat, origin_lng,
      dest_zone, dest_detail, dest_lat, dest_lng, distance_km, eta_minutes, price, payment_method, description } = body;
    if (kind !== 'viaje' && kind !== 'mandado') return send(res, 400, { ok: false, error: 'Tipo no válido.' });
    if (!dest_zone && !dest_detail) return send(res, 400, { ok: false, error: 'Falta el destino.' });
    const p = passenger_id ? db.prepare('SELECT * FROM passengers WHERE id=?').get(passenger_id) : null;
    const km = distance_km ?? (origin_lat != null && dest_lat != null ? haversineKm(origin_lat, origin_lng, dest_lat, dest_lng) : 1);
    const finalPrice = price ?? fareFor(km);
    const r = db.prepare(`INSERT INTO requests (kind, passenger_id, passenger_name, passenger_phone, passenger_photo,
      origin_zone, origin_detail, origin_lat, origin_lng, dest_zone, dest_detail, dest_lat, dest_lng,
      distance_km, eta_minutes, price, payment_method, description, status, trip_stage)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'buscando', 'confirmado')`).run(
      kind, passenger_id || null, p ? p.name : null, p ? p.phone : null, p ? p.face_photo : null,
      origin_zone || null, origin_detail || null, origin_lat ?? null, origin_lng ?? null,
      dest_zone || null, dest_detail || null, dest_lat ?? null, dest_lng ?? null,
      Math.round(km * 10) / 10, eta_minutes ?? Math.max(3, Math.round(km * 3.5)), finalPrice,
      payment_method || 'efectivo', description || '');
    return send(res, 200, { ok: true, request: db.prepare('SELECT * FROM requests WHERE id=?').get(r.lastInsertRowid) });
  }
  if (pathname === '/api/requests') {
    let rows;
    if (q.get('passenger_id')) rows = db.prepare('SELECT * FROM requests WHERE passenger_id=? ORDER BY id DESC LIMIT 50').all(q.get('passenger_id'));
    else if (q.get('driver_id')) rows = db.prepare('SELECT * FROM requests WHERE driver_id=? ORDER BY id DESC LIMIT 50').all(q.get('driver_id'));
    else if (q.get('open')) rows = db.prepare(`SELECT * FROM requests WHERE status='buscando' ORDER BY id DESC LIMIT 50`).all();
    else rows = db.prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 50').all();
    return send(res, 200, { ok: true, requests: requestsWithOffers(rows) });
  }
  if (pathname === '/api/driver-respond') {
    const { driver_id, request_id, kind, price, eta_minutes } = body;
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id);
    const r = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
    if (!d || !r) return send(res, 404, { ok: false, error: 'No encontrado.' });
    if (r.status !== 'buscando') return send(res, 400, { ok: false, error: 'Esta solicitud ya no está buscando conductor.' });
    if (!d.online) return send(res, 400, { ok: false, error: 'Ponte en línea para responder solicitudes.' });
    if (!driverComplete(d)) return send(res, 400, { ok: false, error: 'Completa tu registro con tus fotos para responder.' });
    if (r.kind === 'viaje' && d.vehicle !== 'mototaxi') return send(res, 400, { ok: false, error: 'Los viajes son solo en mototaxi.' });
    const hasSub = driverHasSub(d);
    const offeredPrice = price ?? r.price;
    if (!hasSub) {
      if (driverServicesToday(driver_id) >= FREE_DAILY_LIMIT) return send(res, 400, { ok: false, error: `Ya hiciste tus ${FREE_DAILY_LIMIT} servicios gratis de hoy. Activa la suscripción de $${SUB_PRICE} por semana para seguir.` });
      if (offeredPrice >= PREMIUM_MIN_PRICE) return send(res, 400, { ok: false, error: `Los servicios de $${PREMIUM_MIN_PRICE} o más son solo para suscripción. Activa la suscripción de $${SUB_PRICE} por semana.` });
    }
    const existing = db.prepare('SELECT * FROM offers WHERE request_id=? AND driver_id=?').get(request_id, driver_id);
    if (existing) return send(res, 400, { ok: false, error: 'Ya respondiste esta solicitud.' });
    const isPremium = hasSub ? 1 : 0;
    const o = db.prepare(`INSERT INTO offers (request_id, driver_id, driver_name, driver_phone, driver_photo, driver_plan,
      driver_unit, driver_vehicle, vehicle_photo, eta_minutes, kind, price, is_premium)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(request_id, driver_id, d.name, d.phone, d.selfie, d.plan,
      d.unit, d.vehicle, d.vehicle_photo, eta_minutes ?? 5, kind === 'contraoferta' ? 'contraoferta' : 'acepta',
      offeredPrice, isPremium);
    return send(res, 200, { ok: true, offer: db.prepare('SELECT * FROM offers WHERE id=?').get(o.lastInsertRowid) });
  }
  if (pathname === '/api/respond-offer') {
    const { passenger_id, request_id, offer_id, action, price } = body;
    const r = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
    const o = db.prepare('SELECT * FROM offers WHERE id=?').get(offer_id);
    if (!r || !o || o.request_id !== request_id) return send(res, 404, { ok: false, error: 'No encontrado.' });
    if (r.status !== 'buscando') return send(res, 400, { ok: false, error: 'Esta solicitud ya no está buscando conductor.' });
    if (action === 'acepta') {
      const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(o.driver_id);
      const price = o.passenger_counter_price || o.price; // si el pasajero contraofertó, se confirma a ese precio
      db.prepare(`UPDATE offers SET status='aceptada', price=? WHERE id=?`).run(price, offer_id);
      db.prepare(`UPDATE offers SET status='superada' WHERE request_id=? AND id!=?`).run(request_id, offer_id);
      db.prepare(`UPDATE requests SET status='aceptado', final_price=?, driver_id=?, driver_name=?, driver_phone=?,
        driver_photo=?, driver_unit=?, driver_vehicle=?, vehicle_photo=?, trip_stage='confirmado', trip_stage_at=datetime('now')
        WHERE id=?`).run(price, d.id, d.name, d.phone, d.selfie, d.unit, d.vehicle, d.vehicle_photo, request_id);
      return send(res, 200, { ok: true, request: db.prepare('SELECT * FROM requests WHERE id=?').get(request_id) });
    }
    if (action === 'rechaza') {
      db.prepare(`UPDATE offers SET status='rechazada' WHERE id=?`).run(offer_id);
      return send(res, 200, { ok: true });
    }
    if (action === 'contraoferta') {
      if (!price || price <= 0) return send(res, 400, { ok: false, error: 'Pon un precio para contraofertar.' });
      db.prepare(`UPDATE offers SET passenger_counter_price=? WHERE id=?`).run(price, offer_id);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { ok: false, error: 'Acción no válida.' });
  }
  if (pathname === '/api/raise-price') {
    const { passenger_id, request_id, price } = body;
    const r = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
    if (!r) return send(res, 404, { ok: false, error: 'No encontrado.' });
    if (r.status !== 'buscando') return send(res, 400, { ok: false, error: 'Ya no está buscando conductor.' });
    db.prepare('UPDATE requests SET price=? WHERE id=?').run(price, request_id);
    return send(res, 200, { ok: true, request: db.prepare('SELECT * FROM requests WHERE id=?').get(request_id) });
  }
  if (pathname === '/api/cancel-request') {
    const { request_id } = body;
    const r = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
    if (!r) return send(res, 404, { ok: false, error: 'No encontrado.' });
    if (r.status === 'aceptado' && (r.trip_stage === 'en_viaje' || r.trip_stage === 'en_camino')) {
      return send(res, 400, { ok: false, error: 'El servicio ya está en curso y no se puede cancelar desde la app.' });
    }
    db.prepare(`UPDATE requests SET status='cancelado' WHERE id=?`).run(request_id);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/advance-stage') {
    const { driver_id, request_id, stage } = body;
    const r = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
    if (!r) return send(res, 404, { ok: false, error: 'No encontrado.' });
    if (r.driver_id !== driver_id) return send(res, 403, { ok: false, error: 'Solo el conductor asignado puede avanzar el viaje.' });
    const allowed = r.kind === 'viaje' ? TRIP_STAGES : MANDADO_STAGES;
    if (!allowed.includes(stage)) return send(res, 400, { ok: false, error: 'Etapa no válida.' });
    const cur = allowed.indexOf(r.trip_stage), next = allowed.indexOf(stage);
    if (next !== cur + 1 && !(r.trip_stage === 'confirmado' && stage === allowed[1])) {
      return send(res, 400, { ok: false, error: 'No se puede saltar etapas.' });
    }
    const status = stage === 'finalizado' || stage === 'entregado' ? 'finalizado' : r.status;
    db.prepare(`UPDATE requests SET trip_stage=?, trip_stage_at=datetime('now'), status=? WHERE id=?`).run(stage, status, request_id);
    return send(res, 200, { ok: true, request: db.prepare('SELECT * FROM requests WHERE id=?').get(request_id) });
  }
  if (pathname === '/api/update-driver-location') {
    const { driver_id, request_id, lat, lng } = body;
    const r = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
    if (!r) return send(res, 404, { ok: false, error: 'No encontrado.' });
    if (r.driver_id !== driver_id) return send(res, 403, { ok: false, error: 'Solo el conductor asignado.' });
    if (r.status !== 'aceptado') return send(res, 400, { ok: false, error: 'El servicio no está activo.' });
    db.prepare(`UPDATE requests SET driver_lat=?, driver_lng=?, driver_loc_at=datetime('now') WHERE id=?`).run(lat, lng, request_id);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/set-payment-method') {
    const { request_id, method } = body;
    if (method !== 'efectivo' && method !== 'transferencia') return send(res, 400, { ok: false, error: 'Método no válido.' });
    db.prepare('UPDATE requests SET payment_method=? WHERE id=?').run(method, request_id);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/report-lost-item') {
    const { reporter_type, reporter_name, reporter_phone, item, service, date_text, contact } = body;
    if (!item) return send(res, 400, { ok: false, error: 'Describe el objeto.' });
    const r = db.prepare(`INSERT INTO lost_items (reporter_type, reporter_name, reporter_phone, item, service, date_text, contact, status)
      VALUES (?,?,?,?,?,?,?,?)`).run(reporter_type || 'pasajero', reporter_name || '', reporter_phone || '',
      item, service || '', date_text || '', contact || reporter_phone || '', 'perdido');
    return send(res, 200, { ok: true, item: db.prepare('SELECT * FROM lost_items WHERE id=?').get(r.lastInsertRowid) });
  }
  if (pathname === '/api/lost-items') {
    return send(res, 200, { ok: true, items: db.prepare('SELECT * FROM lost_items ORDER BY id DESC').all() });
  }
  if (pathname === '/api/set-lost-item-status') {
    const { id, status } = body;
    if (!['perdido', 'encontrado', 'devuelto'].includes(status)) return send(res, 400, { ok: false, error: 'Estado no válido.' });
    db.prepare('UPDATE lost_items SET status=? WHERE id=?').run(status, id);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { ok: false, error: 'Ruta no encontrada.' });
}

// ---- Archivos estáticos ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let pathname = decodeURIComponent(url.pathname);
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
    if (pathname.startsWith('/api/')) return api(req, res, pathname);
    if (pathname === '/') pathname = '/index.html';
    const file = path.join(PUBLIC_DIR, pathname);
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('No encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, error: String(e && e.message || e) });
  }
});
server.listen(PORT, () => console.log(`SanFerGo público en http://localhost:${PORT}`));
