// SanFerGo — servidor público (Node.js sin dependencias, SQLite persistente)
// Uso:  node server.js        (PORT=3000, datos en ./data/sanfergo.db)
//       PORT=8080 DATA_DIR=/ruta node server.js
//
// Estado del spec: 2026-11-22 (v1.3.5: el admin entra DIRECTO a su panel al
// iniciar sesión; chofer nuevo nace PENDIENTE hasta que el admin lo aprueba;
// Negocios desbloqueado con modelo por tipo (entrega/catálogo/citas) y
// paquete Premium $100/mes; anuncios de entrada flotantes, uno al azar por
// entrada, precargados; cada opción del panel abre su propia pantalla).
// Tarifa: $10 de salida + $2.50 cada 300 m; espera $1.25/min (parado, < ~5 km/h);
// mínimo por viaje $20; cada parada extra de mandado +$10.
// Cuentas: nombre, usuario, número y/o correo, contraseña con hash scrypt.
// Panel de administrador: solo entrando con la cuenta admin (temporal admin/admin).
// Sin código de verificación (no hay canal de SMS ni correo).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
  is_blocked INTEGER DEFAULT 0, block_reason TEXT, blocked_at TEXT,
  status TEXT DEFAULT 'pendiente',
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
  recipient_phone TEXT, items_json TEXT, stops_json TEXT, extra_stops INTEGER DEFAULT 0,
  status TEXT DEFAULT 'buscando', trip_stage TEXT, trip_stage_at TEXT,
  trip_started_at TEXT, finished_at TEXT,
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
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, username TEXT NOT NULL, phone TEXT, email TEXT,
  password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user', passenger_id INTEGER, driver_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username ON accounts (username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_phone ON accounts (phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts (email);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, account_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT, text TEXT, image TEXT,
  business_id INTEGER, label TEXT, entries TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, description TEXT, phone TEXT, image TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS store_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL, name TEXT NOT NULL, price REAL, image TEXT
);
-- Negocios (v1.3.5): el negocio nace con solicitud PENDIENTE; solo cuando el
-- admin lo activa aparece en Negocios. Tipo: 'entrega' (productos, carrito,
-- pedido con envío separado), 'catalogo' (productos y servicios visibles;
-- WhatsApp y llamada son solo botones de contacto, NADA de catálogo por
-- WhatsApp) o 'citas' (servicios con precio y duración, reserva por día y
-- hora sin encimes). La cuenta que lo crea queda como dueña.
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_account_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
  description TEXT, whatsapp TEXT, photo TEXT,
  status TEXT DEFAULT 'pendiente', open INTEGER DEFAULT 1,
  premium_until TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS business_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL, name TEXT NOT NULL, price REAL NOT NULL, image TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS business_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL, name TEXT NOT NULL, price REAL NOT NULL,
  duration_minutes INTEGER, image TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS business_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL, account_id INTEGER, passenger_name TEXT, passenger_phone TEXT,
  items_json TEXT NOT NULL, products_total REAL NOT NULL, delivery_fee REAL NOT NULL,
  total REAL NOT NULL, status TEXT DEFAULT 'pendiente', detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS business_appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL, service_id INTEGER NOT NULL, account_id INTEGER,
  client_name TEXT, client_phone TEXT, date TEXT NOT NULL, time TEXT NOT NULL,
  status TEXT DEFAULT 'reservada',
  created_at TEXT DEFAULT (datetime('now'))
);
`);
// Migración para bases creadas antes de estos campos (no falla si ya existen).
function addCol(table, col, def) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch (e) { /* ya existe */ }
}
addCol('drivers', 'is_blocked', 'INTEGER DEFAULT 0');
addCol('drivers', 'block_reason', 'TEXT');
addCol('drivers', 'blocked_at', 'TEXT');
addCol('drivers', 'status', "TEXT DEFAULT 'pendiente'");
addCol('ads', 'business_id', 'INTEGER');
addCol('ads', 'label', 'TEXT');
addCol('ads', 'entries', 'TEXT');
// Choferes registrados antes de v1.3.5 (sin estado): ya estaban activos,
// quedan aprobados; solo los nuevos nacen PENDIENTES.
db.exec(`UPDATE drivers SET status='aprobado' WHERE status IS NULL OR status=''`);
addCol('requests', 'recipient_phone', 'TEXT');
addCol('requests', 'items_json', 'TEXT');
addCol('requests', 'stops_json', 'TEXT');
addCol('requests', 'extra_stops', 'INTEGER DEFAULT 0');
addCol('requests', 'trip_started_at', 'TEXT');
addCol('requests', 'finished_at', 'TEXT');

// ---- Cuentas e inicio de sesión (desde v1.2.0) ----
// Contraseñas con scrypt (nunca en texto plano). La sesión es un token
// aleatorio guardado en el servidor; el cliente lo guarda en localStorage.
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function verifyPassword(pw, salt, hash) {
  try {
    const h = crypto.scryptSync(pw, salt, 64);
    const stored = Buffer.from(hash, 'hex');
    return h.length === stored.length && crypto.timingSafeEqual(h, stored);
  } catch (e) { return false; }
}
function cleanPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('52')) return d.slice(2);
  return d;
}
function cleanEmail(e) { return String(e || '').trim().toLowerCase(); }
function cleanUsername(u) { return String(u || '').trim().toLowerCase(); }
function publicAccount(a) {
  if (!a) return null;
  return { id: a.id, name: a.name, username: a.username, phone: a.phone, email: a.email, role: a.role, passenger_id: a.passenger_id, driver_id: a.driver_id, created_at: a.created_at };
}
function accountFromToken(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(String(token));
  if (!s) return null;
  return db.prepare('SELECT * FROM accounts WHERE id=?').get(s.account_id) || null;
}
function findAccountByIdentifier(idf) {
  const s = String(idf || '').trim();
  if (!s) return null;
  let a = db.prepare('SELECT * FROM accounts WHERE username=?').get(cleanUsername(s));
  if (a) return a;
  const ph = cleanPhone(s);
  if (ph.length === 10) a = db.prepare('SELECT * FROM accounts WHERE phone=?').get(ph);
  if (a) return a;
  const em = cleanEmail(s);
  if (em.includes('@')) a = db.prepare('SELECT * FROM accounts WHERE email=?').get(em);
  return a || null;
}
function newSession(accountId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, account_id) VALUES (?,?)').run(token, accountId);
  return token;
}
// Cuenta de administrador pre-registrada (temporal: admin / admin).
// El dueño la usa para entrar al panel y hacer pruebas; luego se cambia
// por una contraseña segura.
(function seedAdmin() {
  const existing = db.prepare('SELECT id FROM accounts WHERE username=?').get('admin');
  if (!existing) {
    const { salt, hash } = hashPassword('admin');
    db.prepare(`INSERT INTO accounts (name, username, phone, email, password_salt, password_hash, role)
      VALUES ('Administrador','admin',NULL,NULL,?,?,'admin')`).run(salt, hash);
  }
})();

// ---- Lugares de San Fernando, Chiapas (16 destinos) ----
// Centro y Parque: verificados. Guerrero (calle Vicente Guerrero), Clínica
// (Clínica San Luis) y Centro de Salud: geocodificados. Arco, Madero y
// Las Isabeles: puntos GPS reales de viajes del usuario. El resto son
// puntos distintos colocados alrededor del pueblo; si alguno queda mal,
// se corrige en este archivo (PLACES). Guerrero, Copalar y Terrero Copalar
// son tres lugares DIFERENTES.
const PLACES = [
  { name: 'Centro', lat: 16.8709, lng: -93.2063 },
  { name: 'Parque', lat: 16.87137, lng: -93.20652 },
  { name: 'Mercado', lat: 16.87018, lng: -93.20777 },
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

// ---- Negocios y lugares con nombre (rótulos del mapa al marcar punto) ----
// Nombres y coordenadas reales del registro de lugares de Meta (búsquedas
// local-search 2026-11-21, solo negocios activos): farmacias, carnicerías,
// Centro de Salud, Parque Central, Mercado Municipal y Arco de bienvenida.
// 'lugar' = referencia grande (siempre se pinta); 'negocio' = tienda
// (se pintan las más cercanas al centro del mapa, máx. 8 en pantalla).
// La gasolinera y los abarrotes NO se incluyeron: no se encontró ninguna
// con coordenadas verificadas y aquí no se inventan coordenadas.
const LANDMARKS = [
  { name: 'Clínica · Centro de Salud', lat: 16.874689, lng: -93.208188, kind: 'lugar' },
  { name: 'Parque Central', lat: 16.87137, lng: -93.20652, kind: 'lugar' },
  { name: 'Mercado Municipal', lat: 16.87018, lng: -93.20777, kind: 'lugar' },
  { name: 'Arco de bienvenida', lat: 16.8605, lng: -93.2059, kind: 'lugar' },
  { name: 'Farmacias Similares', lat: 16.870257, lng: -93.207105, kind: 'negocio' },
  { name: 'Farmacia del Super Descuento', lat: 16.870909, lng: -93.207935, kind: 'negocio' },
  { name: 'Farmacia San Agustín', lat: 16.8711, lng: -93.207283, kind: 'negocio' },
  { name: 'Farmacia Sagrado Corazón de Jesús', lat: 16.870465, lng: -93.206757, kind: 'negocio' },
  { name: 'Carnicería San Diego', lat: 16.871694, lng: -93.209058, kind: 'negocio' },
  { name: 'Carnicería La Central', lat: 16.869832, lng: -93.20729, kind: 'negocio' },
  { name: 'Carnicería Esperanzita', lat: 16.87026, lng: -93.207966, kind: 'negocio' },
  { name: 'Carnicería Gutiérrez', lat: 16.869432, lng: -93.207686, kind: 'negocio' },
  { name: 'Carnicería Pochi', lat: 16.870711, lng: -93.206417, kind: 'negocio' },
  { name: 'Carnicería San Fernando', lat: 16.870372, lng: -93.207847, kind: 'negocio' },
  { name: 'Carnicería Progreso', lat: 16.877048, lng: -93.221616, kind: 'negocio' },
];

// ---- Tarifa oficial (2026-11-20, validada en viajes reales del usuario) ----
// $10 de salida + $2.50 cada 300 m; esperando (parado, < ~5 km/h) $1.25/min
// (nunca distancia + espera a la vez); mínimo por viaje $20.
// Validado: 1.5 km = $22.50; 2.1 km = $27.50; 3.59 km + espera = $40.43.
// El usuario cobra $50 los viajes a colonias desde Centro; cuadra porque
// recoge un poco más arriba. NO cambiar la tarifa sin su orden.
const BASE_FARE = 10, PER_300M = 2.5, WAIT_PER_MIN = 1.25, MIN_TRIP = 20;
const MANDADO_EXTRA_STOP = 10;
const FREE_DAILY_LIMIT = 5, PREMIUM_MIN_PRICE = 80;
// Suscripción en tres planes (v1.3.0):
// semanal $50/7 días, mensual $150/30 días, anual $500/365 días.
// Los días se SUMAN a una suscripción activa.
const SUB_PLANS = {
  weekly: { price: 50, days: 7, label: 'semanal' },
  monthly: { price: 150, days: 30, label: 'mensual' },
  yearly: { price: 500, days: 365, label: 'anual' },
};
// Paquete Premium de negocios (v1.3.5): $100 al mes (30 días), por
// transferencia con 'Ya hice la transferencia', igual que choferes. Los
// datos de la transferencia NO están configurados: la app dice que se
// pregunte por WhatsApp, nunca se inventa una CLABE.
// Gratis: SOLO un negocio por cuenta. Topes gratis puestos por el
// constructor (NO confirmados por el usuario, se dejan exactamente así):
// 10 productos, 10 servicios, 30 pedidos/citas al mes por negocio.
const BIZ_PREMIUM_PRICE = 100, BIZ_PREMIUM_DAYS = 30;
const FREE_BIZ_LIMIT = 1, FREE_BIZ_MAX_PRODUCTS = 10, FREE_BIZ_MAX_SERVICES = 10;
const FREE_BIZ_MAX_MONTHLY = 30;
// Envío de pedidos de negocios tipo 'entrega': en la prueba se usó $20
// (pendiente confirmar con el usuario). El pedido lleva productos y envío
// SIEMPRE separados; la entrega es un mandado normal que pide el negocio.
const BIZ_DELIVERY_FEE = 20;
const BIZ_TYPES = ['entrega', 'catalogo', 'citas'];
const AD_ENTRIES = ['viajes', 'negocios', 'mandados'];
const TRIP_STAGES = ['confirmado', 'en_camino', 'llego', 'en_viaje', 'finalizado'];
const MANDADO_STAGES = ['confirmado', 'a_recoger', 'llego', 'recogido', 'en_camino', 'entregado'];

function haversineKm(a, b, c, d) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const x = rad(c - a), y = rad(d - b);
  const h = Math.sin(x / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Precio por distancia (sin espera, sin mínimo): $10 + $2.50 cada 300 m.
function fareFor(km) { return Math.round((BASE_FARE + (km / 0.3) * PER_300M) * 100) / 100; }
// Redondeo de precios (v1.3.1): los precios negociados solo se mueven de
// cinco en cinco. El sugerido sube al siguiente múltiplo de $5, con piso $20
// (estimado $17 o $18 → $20; $33 → $35; $30 se queda en $30). La tarifa
// del taxímetro (fareFor) NO cambia: su cobro final sigue exacto.
function roundUp5(x) { return Math.max(MIN_TRIP, Math.ceil(x / 5) * 5); }
function validNegotiatedPrice(p) { return Number.isFinite(p) && p >= MIN_TRIP && p <= 1000 && p % 5 === 0; }
const GRID_ERROR = 'El precio debe ir de cinco en cinco: $20, $25, $30, $35…';
// Precio sugerido: la tarifa redondeada hacia arriba a múltiplo de $5.
function suggestedPrice(km) { return roundUp5(fareFor(km)); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function driverServicesToday(driverId) {
  const row = db.prepare(
    `SELECT COUNT(*) c FROM requests WHERE driver_id=? AND status IN ('aceptado','finalizado')
     AND substr(created_at,1,10)=?`).get(driverId, todayStr());
  return row ? row.c : 0;
}
function driverServicesTotal(driverId) {
  const row = db.prepare(
    `SELECT COUNT(*) c FROM requests WHERE driver_id=? AND status IN ('aceptado','finalizado')`).get(driverId);
  return row ? row.c : 0;
}
function driverHasSub(driver) {
  return driver && driver.subscription_until && new Date(driver.subscription_until) > new Date();
}
function driverComplete(driver) { return !!(driver && driver.selfie && driver.vehicle_photo); }
function blockedMsg(driver) {
  return 'Estás bloqueado: ' + (driver.block_reason || 'infracción') + '. Habla con el administrador de SanFerGo.';
}

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
function publicDriver(d) {
  if (!d) return null;
  // Precios de suscripción en los tres planes (v1.3.0).
  return { ...d, services_done: driverServicesTotal(d.id),
    subscription_price: SUB_PLANS.weekly.price,
    subscription_price_monthly: SUB_PLANS.monthly.price,
    subscription_price_yearly: SUB_PLANS.yearly.price };
}
// ---- Negocios (v1.3.5) ----
function businessIsPremium(b) {
  return !!(b && b.premium_until && new Date(b.premium_until) > new Date());
}
function businessProducts(bid) { return db.prepare('SELECT * FROM business_products WHERE business_id=? ORDER BY id ASC').all(bid); }
function businessServices(bid) { return db.prepare('SELECT * FROM business_services WHERE business_id=? ORDER BY id ASC').all(bid); }
function publicBusiness(b) {
  if (!b) return null;
  const premium = businessIsPremium(b);
  return { ...b, is_premium: premium ? 1 : 0,
    premium_badge: premium ? '★ Premium · Verificado' : null,
    products: businessProducts(b.id), services: businessServices(b.id) };
}
function businessMonthCount(bid) {
  const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0);
  const iso = since.toISOString().slice(0, 10);
  const o = db.prepare(`SELECT COUNT(*) c FROM business_orders WHERE business_id=? AND substr(created_at,1,10)>=?`).get(bid, iso);
  const a = db.prepare(`SELECT COUNT(*) c FROM business_appointments WHERE business_id=? AND substr(created_at,1,10)>=?`).get(bid, iso);
  return (o ? o.c : 0) + (a ? a.c : 0);
}
function ownerBusinessCount(accountId) {
  const r = db.prepare(`SELECT COUNT(*) c FROM businesses WHERE owner_account_id=? AND status!='rechazado'`).get(accountId);
  return r ? r.c : 0;
}
function canManageBusiness(account, b) {
  return !!(account && b && (account.role === 'admin' || b.owner_account_id === account.id));
}
// Confirmar una solicitud con un conductor (v1.3.0: la aceptación del
// chofer confirma al instante; la forma de pago es la elegida al publicar
// y ya está guardada en la solicitud, no se vuelve a pedir).
function confirmRequest(requestId, d, finalPrice, acceptedOfferId) {
  if (acceptedOfferId) {
    db.prepare(`UPDATE offers SET status='aceptada', price=? WHERE id=?`).run(finalPrice, acceptedOfferId);
    db.prepare(`UPDATE offers SET status='superada' WHERE request_id=? AND id!=?`).run(requestId, acceptedOfferId);
  } else {
    db.prepare(`UPDATE offers SET status='superada' WHERE request_id=?`).run(requestId);
  }
  db.prepare(`UPDATE requests SET status='aceptado', final_price=?, driver_id=?, driver_name=?, driver_phone=?,
    driver_photo=?, driver_unit=?, driver_vehicle=?, vehicle_photo=?, trip_stage='confirmado', trip_stage_at=datetime('now')
    WHERE id=?`).run(finalPrice, d.id, d.name, d.phone, d.selfie, d.unit, d.vehicle, d.vehicle_photo, requestId);
  return db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
}

// ---- Resolver una ubicación pegada de WhatsApp ----
// Acepta: enlace de Google Maps (corto goo.gl / maps.app.goo.gl — se sigue
// la redirección — o completo), coordenadas decimales ("16.8778, -93.2080")
// o en grados/minutos/segundos como las muestra WhatsApp
// ("16°52'40.3\"N 93°12'28.6\"W"). La foto del mapa con el pin NO se acepta.
function dmsToDec(deg, min, sec, hemi) {
  let v = parseFloat(deg) + parseFloat(min) / 60 + parseFloat(sec) / 3600;
  if (hemi === 'S' || hemi === 'W') v = -v;
  return v;
}
function coordsFromText(text) {
  if (!text) return null;
  const t = String(text).trim();
  // DMS de WhatsApp: 16°52'40.3"N 93°12'28.6"W
  const dms = t.match(/(\d+)\s*°\s*(\d+)\s*['′]\s*([\d.]+)\s*["″]?\s*([NS])\s+(\d+)\s*°\s*(\d+)\s*['′]\s*([\d.]+)\s*["″]?\s*([EW])/i);
  if (dms) {
    const lat = dmsToDec(dms[1], dms[2], dms[3], dms[4].toUpperCase());
    const lng = dmsToDec(dms[5], dms[6], dms[7], dms[8].toUpperCase());
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  // Decimal: 16.8778, -93.2080 (también dentro de un texto más largo)
  const dec = t.match(/(-?\d{1,3}\.\d{3,})\s*[,;]\s*(-?\d{1,3}\.\d{3,})/);
  if (dec) {
    const lat = parseFloat(dec[1]), lng = parseFloat(dec[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}
function coordsFromUrl(url) {
  if (!url) return null;
  let m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = url.match(/[?&](?:q|ll|destination|origin)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = url.match(/\/place\/[^/]+\/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  return null;
}
async function resolveLocationText(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: 'Pega el enlace o las coordenadas.' };
  const direct = coordsFromText(t);
  if (direct) return { ok: true, ...direct, source: 'coords' };
  const urlMatch = t.match(/https?:\/\/[^\s]+/);
  if (urlMatch) {
    const url = urlMatch[0].replace(/[),.]+$/, '');
    const inUrl = coordsFromUrl(url);
    if (inUrl) return { ok: true, ...inUrl, source: 'link' };
    // Enlace corto o de Google Maps: seguir la redirección y leer las coords.
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(timer);
      const finalUrl = r.url || url;
      const found = coordsFromUrl(finalUrl);
      if (found) return { ok: true, ...found, source: 'link' };
      // Algunos enlaces traen las coordenadas en el cuerpo de la página.
      const body = await r.text().catch(() => '');
      const inBody = coordsFromUrl(body) || coordsFromText(body);
      if (inBody) return { ok: true, ...inBody, source: 'link' };
    } catch (e) { /* cae al mensaje de abajo */ }
    return { ok: false, error: 'No se pudo leer ese enlace. Ábrelo una vez en Google Maps y pega el enlace completo.' };
  }
  return { ok: false, error: 'No se entendió la ubicación. Pega el enlace de Google Maps o las coordenadas.' };
}

// ---- API ----
async function api(req, res, pathname) {
  const body = req.method === 'POST' ? await readBody(req) : {};
  const q = new URL(req.url, 'http://x').searchParams;

  if (pathname === '/api/health') return send(res, 200, { ok: true, app: 'SanFerGo', version: '1.3.5' });
  if (pathname === '/api/places') return send(res, 200, { ok: true, places: PLACES, landmarks: LANDMARKS, fare: { base: BASE_FARE, per_300m: PER_300M, wait_per_min: WAIT_PER_MIN, min: MIN_TRIP, extra_stop: MANDADO_EXTRA_STOP } });

  if (pathname === '/api/resolve-location') {
    const out = await resolveLocationText(body.text || body.url || '');
    return send(res, out.ok ? 200 : 400, out);
  }

  if (pathname === '/api/register-driver') {
    const { name, phone, vehicle, unit, selfie, vehicle_photo } = body;
    if (!name || !phone || !vehicle) return send(res, 400, { ok: false, error: 'Faltan datos del conductor.' });
    if (vehicle !== 'mototaxi' && vehicle !== 'moto') return send(res, 400, { ok: false, error: 'Vehículo no válido.' });
    const cleanPhone = phone.trim();
    const existing = db.prepare('SELECT * FROM drivers WHERE phone=?').get(cleanPhone);
    if (existing) {
      if (existing.is_blocked) return send(res, 400, { ok: false, error: blockedMsg(existing) });
      // Un solo perfil por teléfono: se devuelve el registro que ya existe.
      return send(res, 200, { ok: true, driver: publicDriver(existing), already: true });
    }
    const r = db.prepare(`INSERT INTO drivers (name, phone, vehicle, unit, selfie, vehicle_photo, status) VALUES (?,?,?,?,?,?, 'pendiente')`)
      .run(name.trim(), cleanPhone, vehicle, (unit || '').trim(), selfie || null, vehicle_photo || null);
    const created = publicDriver(db.prepare('SELECT * FROM drivers WHERE id=?').get(r.lastInsertRowid));
    // Chofer nuevo nace PENDIENTE (v1.3.5): no puede ir en línea ni responder
    // solicitudes hasta que el administrador lo apruebe.
    return send(res, 200, { ok: true, pending: true, message: 'Tu registro quedó pendiente de aprobación por el administrador de SanFerGo. Te avisaremos cuando te apruebe.', driver: created });
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
    return send(res, 200, { ok: true, driver: publicDriver(db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id)) });
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
    if (d.is_blocked) return send(res, 403, { ok: false, error: blockedMsg(d) });
    db.prepare('UPDATE drivers SET name=?, phone=?, vehicle=?, unit=? WHERE id=?')
      .run(name || d.name, phone || d.phone, vehicle || d.vehicle, unit ?? d.unit, driver_id);
    return send(res, 200, { ok: true, driver: publicDriver(db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id)) });
  }
  if (pathname === '/api/drivers') {
    return send(res, 200, { ok: true, drivers: db.prepare('SELECT * FROM drivers ORDER BY id DESC').all().map(publicDriver) });
  }
  if (pathname === '/api/passengers') {
    return send(res, 200, { ok: true, passengers: db.prepare('SELECT * FROM passengers ORDER BY id DESC').all() });
  }
  if (pathname === '/api/set-driver-online') {
    const { driver_id, online } = body;
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id);
    if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
    if (d.is_blocked) return send(res, 403, { ok: false, error: blockedMsg(d) });
    if (d.status !== 'aprobado') return send(res, 403, { ok: false, error: 'Tu registro de chofer está pendiente de aprobación por el administrador de SanFerGo. Aún no puedes ponerte en línea.' });
    if (online && !driverComplete(d)) return send(res, 400, { ok: false, error: 'Completa tu registro: falta tu foto o la foto de tu mototaxi/moto.' });
    db.prepare('UPDATE drivers SET online=? WHERE id=?').run(online ? 1 : 0, driver_id);
    return send(res, 200, { ok: true, driver: publicDriver(db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id)) });
  }
  if (pathname === '/api/subscribe-driver') {
    const { driver_id, plan } = body;
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id);
    if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
    if (d.is_blocked) return send(res, 403, { ok: false, error: blockedMsg(d) });
    // El chofer elige el plan; sin plan se usa el semanal. Los días se
    // suman a una suscripción activa (no se pierde lo que queda).
    const key = plan || 'weekly';
    const p = SUB_PLANS[key];
    if (!p) return send(res, 400, { ok: false, error: 'Plan no válido. Elige semanal ($50), mensual ($150) o anual ($500).' });
    const base = driverHasSub(d) ? new Date(d.subscription_until) : new Date();
    base.setDate(base.getDate() + p.days);
    const until = base.toISOString();
    db.prepare(`UPDATE drivers SET plan='suscripcion', subscription_until=? WHERE id=?`).run(until, driver_id);
    return send(res, 200, { ok: true, driver: publicDriver(db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id)), price: p.price, days: p.days, plan: key });
  }

  // ---- Cuentas e inicio de sesión ----
  if (pathname === '/api/register-account') {
    const { name, username, phone, email, password } = body;
    const nm = String(name || '').trim();
    const un = cleanUsername(username);
    const ph = phone ? cleanPhone(phone) : null;
    const em = email ? cleanEmail(email) : null;
    const pw = String(password || '');
    if (nm.length < 2) return send(res, 400, { ok: false, error: 'Pon tu nombre.' });
    if (!/^[a-z0-9_]{3,20}$/.test(un)) return send(res, 400, { ok: false, error: 'El nombre de usuario debe tener de 3 a 20 letras, números o guion bajo.' });
    if (!ph && !em) return send(res, 400, { ok: false, error: 'Regístrate con tu número o con tu correo.' });
    if (ph && ph.length !== 10) return send(res, 400, { ok: false, error: 'El número debe tener 10 dígitos.' });
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return send(res, 400, { ok: false, error: 'Ese correo no se ve válido.' });
    if (pw.length < 6) return send(res, 400, { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    if (db.prepare('SELECT id FROM accounts WHERE username=?').get(un)) return send(res, 409, { ok: false, error: 'Ese nombre de usuario ya está en uso. Elige otro.', field: 'username' });
    if (ph) {
      const byPhone = db.prepare('SELECT * FROM accounts WHERE phone=?').get(ph);
      if (byPhone) return send(res, 409, { ok: false, error: 'Ese número ya tiene cuenta.', exists: true, existing_name: byPhone.name, field: 'phone', identifier: ph });
    }
    if (em) {
      const byEmail = db.prepare('SELECT * FROM accounts WHERE email=?').get(em);
      if (byEmail) return send(res, 409, { ok: false, error: 'Ese correo ya tiene cuenta.', exists: true, existing_name: byEmail.name, field: 'email', identifier: em });
    }
    // Al registrarse se crea o se enlaza SOLO el perfil de pasajero (sin chofer).
    let passenger = null;
    if (ph) passenger = db.prepare('SELECT * FROM passengers WHERE phone=?').get(ph);
    if (!passenger) {
      const r = db.prepare('INSERT INTO passengers (name, phone, face_photo) VALUES (?,?,NULL)').run(nm, ph || '');
      passenger = db.prepare('SELECT * FROM passengers WHERE id=?').get(r.lastInsertRowid);
    }
    const { salt, hash } = hashPassword(pw);
    const r = db.prepare(`INSERT INTO accounts (name, username, phone, email, password_salt, password_hash, role, passenger_id, driver_id)
      VALUES (?,?,?,?,?,?,'user',?,NULL)`).run(nm, un, ph, em, salt, hash, passenger.id);
    const account = db.prepare('SELECT * FROM accounts WHERE id=?').get(r.lastInsertRowid);
    const token = newSession(account.id);
    return send(res, 200, { ok: true, account: publicAccount(account), token, passenger });
  }
  if (pathname === '/api/login') {
    const { identifier, password } = body;
    const pw = String(password || '');
    const a = findAccountByIdentifier(identifier);
    if (!a) {
      // ¿Hay un perfil viejo con ese número pero sin cuenta? Se puede reclamar.
      const ph = cleanPhone(identifier);
      if (ph.length === 10) {
        const p = db.prepare('SELECT * FROM passengers WHERE phone=?').get(ph);
        const d = !p ? db.prepare('SELECT * FROM drivers WHERE phone=?').get(ph) : null;
        if (p || d) { const nm = (p || d).name; return send(res, 404, { ok: false, needs_claim: true, profile_name: nm, phone: ph, error: 'Ya tienes un registro en SanFerGo a nombre de ' + nm + '. Crea tu contraseña para reclamarlo.' }); }
      }
      return send(res, 400, { ok: false, error: 'No existe una cuenta con ese usuario, número o correo. Crea tu cuenta.' });
    }
    if (!verifyPassword(pw, a.password_salt, a.password_hash)) return send(res, 400, { ok: false, error: 'Contraseña incorrecta.' });
    const token = newSession(a.id);
    const passenger = a.passenger_id ? db.prepare('SELECT * FROM passengers WHERE id=?').get(a.passenger_id) : null;
    const driver = a.driver_id ? db.prepare('SELECT * FROM drivers WHERE id=?').get(a.driver_id) : null;
    return send(res, 200, { ok: true, account: publicAccount(a), token, passenger, driver: driver ? publicDriver(driver) : null });
  }
  if (pathname === '/api/claim-account') {
    const { phone, password, username, name } = body;
    const ph = cleanPhone(phone);
    const un = cleanUsername(username);
    const pw = String(password || '');
    if (ph.length !== 10) return send(res, 400, { ok: false, error: 'Pon tu número de 10 dígitos.' });
    if (!/^[a-z0-9_]{3,20}$/.test(un)) return send(res, 400, { ok: false, error: 'El nombre de usuario debe tener de 3 a 20 letras, números o guion bajo.' });
    if (pw.length < 6) return send(res, 400, { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    if (db.prepare('SELECT id FROM accounts WHERE phone=?').get(ph)) return send(res, 409, { ok: false, error: 'Ese número ya tiene cuenta. Inicia sesión con tu contraseña.' });
    if (db.prepare('SELECT id FROM accounts WHERE username=?').get(un)) return send(res, 409, { ok: false, error: 'Ese nombre de usuario ya está en uso. Elige otro.', field: 'username' });
    const passenger = db.prepare('SELECT * FROM passengers WHERE phone=?').get(ph);
    const driver = db.prepare('SELECT * FROM drivers WHERE phone=?').get(ph);
    if (!passenger && !driver) return send(res, 404, { ok: false, error: 'No hay ningún perfil con ese número.' });
    const nm = String(name || '').trim() || (passenger ? passenger.name : driver.name);
    const { salt, hash } = hashPassword(pw);
    const r = db.prepare(`INSERT INTO accounts (name, username, phone, email, password_salt, password_hash, role, passenger_id, driver_id)
      VALUES (?,?,?,NULL,?,?,'user',?,?)`).run(nm, un, ph, salt, hash, passenger ? passenger.id : null, driver ? driver.id : null);
    const account = db.prepare('SELECT * FROM accounts WHERE id=?').get(r.lastInsertRowid);
    const token = newSession(account.id);
    return send(res, 200, { ok: true, account: publicAccount(account), token, passenger, driver: driver ? publicDriver(driver) : null });
  }
  if (pathname === '/api/me') {
    const a = accountFromToken(q.get('token') || body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Sesión no válida. Inicia sesión de nuevo.' });
    const passenger = a.passenger_id ? db.prepare('SELECT * FROM passengers WHERE id=?').get(a.passenger_id) : null;
    const driver = a.driver_id ? db.prepare('SELECT * FROM drivers WHERE id=?').get(a.driver_id) : null;
    return send(res, 200, { ok: true, account: publicAccount(a), passenger, driver: driver ? publicDriver(driver) : null });
  }
  if (pathname === '/api/logout') {
    if (body.token) db.prepare('DELETE FROM sessions WHERE token=?').run(String(body.token));
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/link-profiles') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const { passenger_id, driver_id } = body;
    if (passenger_id) {
      const p = db.prepare('SELECT * FROM passengers WHERE id=?').get(passenger_id);
      if (!p) return send(res, 404, { ok: false, error: 'Pasajero no encontrado.' });
      if (a.phone && cleanPhone(p.phone) && cleanPhone(p.phone) !== a.phone) return send(res, 400, { ok: false, error: 'Ese perfil de pasajero tiene otro número.' });
      db.prepare('UPDATE accounts SET passenger_id=? WHERE id=?').run(passenger_id, a.id);
    }
    if (driver_id) {
      const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id);
      if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
      if (a.phone && cleanPhone(d.phone) && cleanPhone(d.phone) !== a.phone) return send(res, 400, { ok: false, error: 'Ese perfil de chofer tiene otro número.' });
      db.prepare('UPDATE accounts SET driver_id=? WHERE id=?').run(driver_id, a.id);
    }
    return send(res, 200, { ok: true, account: publicAccount(db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id)) });
  }
  if (pathname === '/api/update-account') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const nm = String(body.name || '').trim();
    const un = body.username ? cleanUsername(body.username) : null;
    if (nm.length < 2) return send(res, 400, { ok: false, error: 'Pon tu nombre.' });
    if (un && !/^[a-z0-9_]{3,20}$/.test(un)) return send(res, 400, { ok: false, error: 'El nombre de usuario debe tener de 3 a 20 letras, números o guion bajo.' });
    if (un && un !== a.username && db.prepare('SELECT id FROM accounts WHERE username=?').get(un)) return send(res, 409, { ok: false, error: 'Ese nombre de usuario ya está en uso.', field: 'username' });
    db.prepare('UPDATE accounts SET name=?, username=? WHERE id=?').run(nm, un || a.username, a.id);
    return send(res, 200, { ok: true, account: publicAccount(db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id)) });
  }

  // ---- Anuncios de entrada flotantes (v1.3.5) ----
  // El Inicio NO muestra anuncios. Al entrar a Viajes, Negocios o Mandados
  // aparece UN solo anuncio flotante, elegido al azar entre los activos que
  // rotan en esa entrada (uno a la vez; si la persona tiene historial con
  // un negocio, se prefieren los anuncios de ese negocio). El anuncio es
  // SOLO imagen, obligatoria para publicar. Libre (sin enlace) o De un
  // negocio (con selector de negocios activos; al tocarlo va a su ficha).
  // /api/ads se conserva como lista de activos (compatibilidad y panel).
  function adEntries(a) {
    try { const e = JSON.parse(a.entries || 'null'); if (Array.isArray(e) && e.length) return e.filter(x => AD_ENTRIES.includes(x)); } catch (e) {}
    return AD_ENTRIES.slice(); // anuncios viejos (sin entradas): rotan en todas
  }
  function adWithBusiness(a) {
    if (!a) return null;
    let businessName = null;
    if (a.business_id) { const b = db.prepare('SELECT name FROM businesses WHERE id=?').get(a.business_id); businessName = b ? b.name : null; }
    return { ...a, entries: adEntries(a), business_name: businessName };
  }
  if (pathname === '/api/ads') {
    return send(res, 200, { ok: true, ads: db.prepare('SELECT * FROM ads WHERE active=1 ORDER BY id DESC').all().map(adWithBusiness) });
  }
  if (pathname === '/api/entry-ad') {
    const entry = String(q.get('entry') || 'viajes');
    if (!AD_ENTRIES.includes(entry)) return send(res, 400, { ok: false, error: 'Entrada no válida: viajes, negocios o mandados.' });
    const all = db.prepare('SELECT * FROM ads WHERE active=1 ORDER BY id ASC').all()
      .filter(a => a.image && adEntries(a).includes(entry)).map(adWithBusiness);
    if (!all.length) return send(res, 200, { ok: true, ad: null });
    // Con historial de la persona se prefieren los anuncios de negocios con
    // los que ya pidió (pedidos o citas); sin historial, al azar.
    let pool = all;
    const me = accountFromToken(q.get('token') || '');
    if (me) {
      const mine = db.prepare(`SELECT DISTINCT business_id FROM business_orders WHERE account_id=?
        UNION SELECT DISTINCT business_id FROM business_appointments WHERE account_id=?`).all(me.id, me.id).map(r => r.business_id);
      const preferred = all.filter(a => a.business_id && mine.includes(a.business_id));
      if (preferred.length) pool = preferred;
    }
    const ad = pool[Math.floor(Math.random() * pool.length)];
    return send(res, 200, { ok: true, ad });
  }
  if (pathname === '/api/admin-ads') {
    const a = accountFromToken(q.get('token') || body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    return send(res, 200, { ok: true, ads: db.prepare('SELECT * FROM ads ORDER BY id DESC').all().map(adWithBusiness) });
  }
  if (pathname === '/api/create-ad') {
    const a = accountFromToken(body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    // El anuncio es SOLO imagen: la imagen es obligatoria para publicar.
    if (!body.image || String(body.image).length < 100) return send(res, 400, { ok: false, error: 'El anuncio es solo imagen: sube una imagen para publicarlo.' });
    const label = String(body.label || body.title || '').trim().slice(0, 120) || null;
    const kind = body.kind || (body.business_id ? 'negocio' : 'libre');
    let businessId = null;
    if (kind === 'negocio') {
      businessId = parseInt(body.business_id, 10) || null;
      const b = businessId ? db.prepare('SELECT * FROM businesses WHERE id=?').get(businessId) : null;
      if (!b || b.status !== 'activo') return send(res, 400, { ok: false, error: 'Elige un negocio activo para vincular el anuncio.' });
    }
    let entries = AD_ENTRIES.slice();
    if (Array.isArray(body.entries) && body.entries.length) {
      const clean = body.entries.filter(x => AD_ENTRIES.includes(String(x)));
      if (clean.length) entries = clean;
    }
    const r = db.prepare('INSERT INTO ads (title, text, image, business_id, label, entries, active) VALUES (?,?,?,?,?,?,1)')
      .run(label, null, body.image, businessId, label, JSON.stringify(entries));
    return send(res, 200, { ok: true, ad: adWithBusiness(db.prepare('SELECT * FROM ads WHERE id=?').get(r.lastInsertRowid)) });
  }
  if (pathname === '/api/set-ad-active') {
    const a = accountFromToken(body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    db.prepare('UPDATE ads SET active=? WHERE id=?').run(body.active ? 1 : 0, body.ad_id);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/delete-ad') {
    const a = accountFromToken(body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    db.prepare('DELETE FROM ads WHERE id=?').run(body.ad_id);
    return send(res, 200, { ok: true });
  }
  // ---- Tiendas (catálogo; la edición llega cuando se reactive Negocios) ----
  if (pathname === '/api/stores') {
    const stores = db.prepare('SELECT * FROM stores WHERE active=1 ORDER BY id ASC').all()
      .map(s => ({ ...s, products: db.prepare('SELECT * FROM store_products WHERE store_id=? ORDER BY id ASC').all(s.id) }));
    return send(res, 200, { ok: true, stores });
  }
  if (pathname === '/api/admin-stores') {
    const a = accountFromToken(q.get('token') || body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const stores = db.prepare('SELECT * FROM stores ORDER BY id ASC').all()
      .map(s => ({ ...s, products: db.prepare('SELECT * FROM store_products WHERE store_id=? ORDER BY id ASC').all(s.id) }));
    return send(res, 200, { ok: true, stores });
  }
  // ---- Negocios (v1.3.5) ----
  // Negocios activos y visibles para todos (los Premium primero, con su
  // insignia '★ Premium · Verificado'). Los pendientes NO se ven aquí.
  if (pathname === '/api/businesses') {
    const list = db.prepare(`SELECT * FROM businesses WHERE status='activo' ORDER BY premium_until DESC, id ASC`).all()
      .map(publicBusiness);
    return send(res, 200, { ok: true, businesses: list });
  }
  if (pathname === '/api/business') {
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(q.get('id'));
    if (!b || b.status !== 'activo') return send(res, 404, { ok: false, error: 'Negocio no encontrado.' });
    return send(res, 200, { ok: true, business: publicBusiness(b) });
  }
  // Crear un negocio = mandar solicitud: al crear se pregunta de qué tipo
  // es (entrega, catalogo o citas). Gratis: SOLO un negocio por cuenta.
  if (pathname === '/api/request-business') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const name = String(body.name || '').trim();
    const type = String(body.type || '').trim();
    if (!BIZ_TYPES.includes(type)) return send(res, 400, { ok: false, error: 'Elige el tipo de negocio: entrega, catálogo o citas.' });
    if (name.length < 2 || name.length > 80) return send(res, 400, { ok: false, error: 'Pon el nombre del negocio.' });
    const whatsapp = String(body.whatsapp || '').trim();
    if (!whatsapp) return send(res, 400, { ok: false, error: 'Pon el WhatsApp del negocio.' });
    if (!businessIsPremium({ premium_until: (db.prepare('SELECT premium_until FROM businesses WHERE owner_account_id=? AND premium_until IS NOT NULL ORDER BY premium_until DESC LIMIT 1').get(a.id) || {}).premium_until }) && ownerBusinessCount(a.id) >= FREE_BIZ_LIMIT) {
      return send(res, 400, { ok: false, error: 'La versión gratis permite crear solo un negocio por cuenta. Activa el paquete Premium ($100 al mes) para crear más negocios.' });
    }
    const r = db.prepare(`INSERT INTO businesses (owner_account_id, name, type, description, whatsapp, photo, status, open)
      VALUES (?,?,?,?,?,?, 'pendiente', 1)`).run(a.id, name, type, String(body.description || '').trim() || null, whatsapp, body.photo || null);
    return send(res, 200, { ok: true, pending: true, message: 'Tu solicitud se mandó al administrador. Cuando la active, tu negocio aparecerá en Negocios.', business: publicBusiness(db.prepare('SELECT * FROM businesses WHERE id=?').get(r.lastInsertRowid)) });
  }
  if (pathname === '/api/my-businesses') {
    const a = accountFromToken(body.token || q.get('token'));
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const list = db.prepare('SELECT * FROM businesses WHERE owner_account_id=? ORDER BY id ASC').all(a.id).map(publicBusiness);
    return send(res, 200, { ok: true, businesses: list });
  }
  if (pathname === '/api/admin-business-requests') {
    const a = accountFromToken(body.token || q.get('token'));
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const list = db.prepare(`SELECT * FROM businesses WHERE status='pendiente' ORDER BY id ASC`).all().map(publicBusiness);
    return send(res, 200, { ok: true, businesses: list });
  }
  if (pathname === '/api/admin-businesses') {
    const a = accountFromToken(body.token || q.get('token'));
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const list = db.prepare('SELECT * FROM businesses ORDER BY id DESC').all().map(publicBusiness);
    return send(res, 200, { ok: true, businesses: list });
  }
  if (pathname === '/api/approve-business') {
    const a = accountFromToken(body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(body.business_id);
    if (!b) return send(res, 404, { ok: false, error: 'Negocio no encontrado.' });
    db.prepare(`UPDATE businesses SET status='activo' WHERE id=?`).run(body.business_id);
    return send(res, 200, { ok: true, business: publicBusiness(db.prepare('SELECT * FROM businesses WHERE id=?').get(body.business_id)) });
  }
  if (pathname === '/api/reject-business') {
    const a = accountFromToken(body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(body.business_id);
    if (!b) return send(res, 404, { ok: false, error: 'Negocio no encontrado.' });
    if (b.status === 'activo') return send(res, 400, { ok: false, error: 'Ese negocio ya está activo.' });
    db.prepare(`UPDATE businesses SET status='rechazado' WHERE id=?`).run(body.business_id);
    return send(res, 200, { ok: true });
  }
  // Ficha del negocio (dueña o admin): nombre, qué vende, WhatsApp, foto y
  // botón abierto/cerrado.
  if (pathname === '/api/update-business') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(body.business_id);
    if (!b) return send(res, 404, { ok: false, error: 'Negocio no encontrado.' });
    if (!canManageBusiness(a, b)) return send(res, 403, { ok: false, error: 'Solo la dueña del negocio o el administrador pueden editarlo.' });
    db.prepare(`UPDATE businesses SET name=?, description=?, whatsapp=?, photo=?, open=? WHERE id=?`).run(
      String(body.name || b.name).trim(), body.description != null ? String(body.description).trim() : b.description,
      body.whatsapp != null ? String(body.whatsapp).trim() : b.whatsapp,
      body.photo != null ? body.photo : b.photo,
      body.open != null ? (body.open ? 1 : 0) : b.open, body.business_id);
    return send(res, 200, { ok: true, business: publicBusiness(db.prepare('SELECT * FROM businesses WHERE id=?').get(body.business_id)) });
  }
  // Productos y servicios (dueña o admin). Topes gratis: 10 productos y
  // 10 servicios por negocio; con Premium, ilimitados.
  if (pathname === '/api/add-product') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(body.business_id);
    if (!b) return send(res, 404, { ok: false, error: 'Negocio no encontrado.' });
    if (!canManageBusiness(a, b)) return send(res, 403, { ok: false, error: 'Solo la dueña del negocio o el administrador pueden agregar productos.' });
    if (b.type === 'citas') return send(res, 400, { ok: false, error: 'Un negocio de citas vende servicios, no productos.' });
    if (!businessIsPremium(b) && businessProducts(b.id).length >= FREE_BIZ_MAX_PRODUCTS) return send(res, 400, { ok: false, error: `La versión gratis permite hasta ${FREE_BIZ_MAX_PRODUCTS} productos por negocio. Activa el paquete Premium ($100 al mes) para productos ilimitados.` });
    const name = String(body.name || '').trim();
    const price = Number(body.price);
    if (!name || !Number.isFinite(price) || price <= 0) return send(res, 400, { ok: false, error: 'Pon el nombre y el precio del producto.' });
    const r = db.prepare('INSERT INTO business_products (business_id, name, price, image) VALUES (?,?,?,?)').run(b.id, name, price, body.image || null);
    return send(res, 200, { ok: true, product: db.prepare('SELECT * FROM business_products WHERE id=?').get(r.lastInsertRowid) });
  }
  if (pathname === '/api/delete-product') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const pr = db.prepare('SELECT * FROM business_products WHERE id=?').get(body.product_id);
    if (!pr) return send(res, 404, { ok: false, error: 'Producto no encontrado.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(pr.business_id);
    if (!canManageBusiness(a, b)) return send(res, 403, { ok: false, error: 'Solo la dueña del negocio o el administrador pueden borrar productos.' });
    db.prepare('DELETE FROM business_products WHERE id=?').run(body.product_id);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/add-service') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(body.business_id);
    if (!b) return send(res, 404, { ok: false, error: 'Negocio no encontrado.' });
    if (!canManageBusiness(a, b)) return send(res, 403, { ok: false, error: 'Solo la dueña del negocio o el administrador pueden agregar servicios.' });
    if (b.type === 'entrega') return send(res, 400, { ok: false, error: 'Un negocio de entrega vende productos, no servicios.' });
    if (!businessIsPremium(b) && businessServices(b.id).length >= FREE_BIZ_MAX_SERVICES) return send(res, 400, { ok: false, error: `La versión gratis permite hasta ${FREE_BIZ_MAX_SERVICES} servicios por negocio. Activa el paquete Premium ($100 al mes) para servicios ilimitados.` });
    const name = String(body.name || '').trim();
    const price = Number(body.price);
    if (!name || !Number.isFinite(price) || price <= 0) return send(res, 400, { ok: false, error: 'Pon el nombre y el precio del servicio.' });
    const r = db.prepare('INSERT INTO business_services (business_id, name, price, duration_minutes, image) VALUES (?,?,?,?,?)')
      .run(b.id, name, price, body.duration_minutes != null ? parseInt(body.duration_minutes, 10) : null, body.image || null);
    return send(res, 200, { ok: true, service: db.prepare('SELECT * FROM business_services WHERE id=?').get(r.lastInsertRowid) });
  }
  if (pathname === '/api/delete-service') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const sv = db.prepare('SELECT * FROM business_services WHERE id=?').get(body.service_id);
    if (!sv) return send(res, 404, { ok: false, error: 'Servicio no encontrado.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(sv.business_id);
    if (!canManageBusiness(a, b)) return send(res, 403, { ok: false, error: 'Solo la dueña del negocio o el administrador pueden borrar servicios.' });
    db.prepare('DELETE FROM business_services WHERE id=?').run(body.service_id);
    return send(res, 200, { ok: true });
  }
  // Pedido (solo tipo 'entrega'): productos y envío SIEMPRE separados.
  // La entrega se hace como un mandado normal que pide el propio negocio.
  // Tope gratis: 30 pedidos/citas al mes por negocio; con Premium, ilimitados.
  if (pathname === '/api/create-order') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(body.business_id);
    if (!b || b.status !== 'activo') return send(res, 404, { ok: false, error: 'Negocio no encontrado o no activo.' });
    if (b.type !== 'entrega') return send(res, 400, { ok: false, error: 'Este negocio no vende por entrega.' });
    if (!b.open) return send(res, 400, { ok: false, error: 'El negocio está cerrado por ahora.' });
    if (!businessIsPremium(b) && businessMonthCount(b.id) >= FREE_BIZ_MAX_MONTHLY) return send(res, 400, { ok: false, error: `Este negocio llegó a sus ${FREE_BIZ_MAX_MONTHLY} pedidos/citas gratis del mes. Activa el paquete Premium ($100 al mes) para pedidos ilimitados.` });
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return send(res, 400, { ok: false, error: 'El carrito está vacío.' });
    let productsTotal = 0;
    const cleanItems = [];
    for (const it of items) {
      const pr = db.prepare('SELECT * FROM business_products WHERE id=? AND business_id=?').get(it.product_id, b.id);
      if (!pr) return send(res, 400, { ok: false, error: 'Un producto del carrito no es de este negocio.' });
      const qty = Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1));
      productsTotal += pr.price * qty;
      cleanItems.push({ product_id: pr.id, name: pr.name, price: pr.price, qty });
    }
    productsTotal = Math.round(productsTotal * 100) / 100;
    const deliveryFee = BIZ_DELIVERY_FEE;
    const r = db.prepare(`INSERT INTO business_orders (business_id, account_id, passenger_name, passenger_phone, items_json, products_total, delivery_fee, total, status, detail)
      VALUES (?,?,?,?,?,?,?,?, 'pendiente', ?)`).run(b.id, a.id, a.name, a.phone || '', JSON.stringify(cleanItems), productsTotal, deliveryFee, productsTotal + deliveryFee, String(body.detail || '').trim() || null);
    return send(res, 200, { ok: true, order: db.prepare('SELECT * FROM business_orders WHERE id=?').get(r.lastInsertRowid) });
  }
  if (pathname === '/api/my-orders') {
    const a = accountFromToken(body.token || q.get('token'));
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const list = db.prepare(`SELECT o.*, b.name AS business_name FROM business_orders o JOIN businesses b ON b.id=o.business_id
      WHERE o.account_id=? ORDER BY o.id DESC LIMIT 50`).all(a.id);
    return send(res, 200, { ok: true, orders: list });
  }
  if (pathname === '/api/business-orders') {
    const a = accountFromToken(body.token || q.get('token'));
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(q.get('business_id') || body.business_id);
    if (!b) return send(res, 404, { ok: false, error: 'Negocio no encontrado.' });
    if (!canManageBusiness(a, b)) return send(res, 403, { ok: false, error: 'Solo la dueña del negocio o el administrador pueden ver sus pedidos.' });
    const list = db.prepare('SELECT * FROM business_orders WHERE business_id=? ORDER BY id DESC LIMIT 100').all(b.id);
    return send(res, 200, { ok: true, orders: list });
  }
  if (pathname === '/api/set-order-status') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const o = db.prepare('SELECT * FROM business_orders WHERE id=?').get(body.order_id);
    if (!o) return send(res, 404, { ok: false, error: 'Pedido no encontrado.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(o.business_id);
    if (!canManageBusiness(a, b)) return send(res, 403, { ok: false, error: 'Solo la dueña del negocio o el administrador pueden cambiar el pedido.' });
    if (!['pendiente', 'preparando', 'en_camino', 'entregado', 'cancelado'].includes(String(body.status))) return send(res, 400, { ok: false, error: 'Estado no válido.' });
    db.prepare('UPDATE business_orders SET status=? WHERE id=?').run(body.status, body.order_id);
    return send(res, 200, { ok: true });
  }
  // Cita (solo tipo 'citas'): reserva por día y hora, sin encimes.
  if (pathname === '/api/create-appointment') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(body.business_id);
    if (!b || b.status !== 'activo') return send(res, 404, { ok: false, error: 'Negocio no encontrado o no activo.' });
    if (b.type !== 'citas') return send(res, 400, { ok: false, error: 'Este negocio no agenda citas.' });
    if (!b.open) return send(res, 400, { ok: false, error: 'El negocio está cerrado por ahora.' });
    if (!businessIsPremium(b) && businessMonthCount(b.id) >= FREE_BIZ_MAX_MONTHLY) return send(res, 400, { ok: false, error: `Este negocio llegó a sus ${FREE_BIZ_MAX_MONTHLY} pedidos/citas gratis del mes. Activa el paquete Premium ($100 al mes) para citas ilimitadas.` });
    const sv = db.prepare('SELECT * FROM business_services WHERE id=? AND business_id=?').get(body.service_id, b.id);
    if (!sv) return send(res, 400, { ok: false, error: 'Servicio no encontrado en este negocio.' });
    const date = String(body.date || '').trim(), time = String(body.time || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return send(res, 400, { ok: false, error: 'Elige el día (AAAA-MM-DD) y la hora (HH:MM) de tu cita.' });
    const clash = db.prepare(`SELECT id FROM business_appointments WHERE business_id=? AND date=? AND time=? AND status!='cancelada'`).get(b.id, date, time);
    if (clash) return send(res, 400, { ok: false, error: 'Esa hora ya está ocupada en este negocio. Elige otra hora.' });
    const r = db.prepare(`INSERT INTO business_appointments (business_id, service_id, account_id, client_name, client_phone, date, time, status)
      VALUES (?,?,?,?,?,?,?, 'reservada')`).run(b.id, sv.id, a.id, a.name, a.phone || '', date, time);
    return send(res, 200, { ok: true, appointment: db.prepare('SELECT * FROM business_appointments WHERE id=?').get(r.lastInsertRowid) });
  }
  if (pathname === '/api/my-appointments') {
    const a = accountFromToken(body.token || q.get('token'));
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const list = db.prepare(`SELECT ap.*, b.name AS business_name, s.name AS service_name FROM business_appointments ap
      JOIN businesses b ON b.id=ap.business_id LEFT JOIN business_services s ON s.id=ap.service_id
      WHERE ap.account_id=? ORDER BY ap.date DESC, ap.time DESC LIMIT 50`).all(a.id);
    return send(res, 200, { ok: true, appointments: list });
  }
  if (pathname === '/api/business-appointments') {
    const a = accountFromToken(body.token || q.get('token'));
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(q.get('business_id') || body.business_id);
    if (!b) return send(res, 404, { ok: false, error: 'Negocio no encontrado.' });
    if (!canManageBusiness(a, b)) return send(res, 403, { ok: false, error: 'Solo la dueña del negocio o el administrador pueden ver su agenda.' });
    const list = db.prepare(`SELECT ap.*, s.name AS service_name FROM business_appointments ap
      LEFT JOIN business_services s ON s.id=ap.service_id WHERE ap.business_id=? ORDER BY ap.date ASC, ap.time ASC LIMIT 200`).all(b.id);
    return send(res, 200, { ok: true, appointments: list });
  }
  if (pathname === '/api/cancel-appointment') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const ap = db.prepare('SELECT * FROM business_appointments WHERE id=?').get(body.appointment_id);
    if (!ap) return send(res, 404, { ok: false, error: 'Cita no encontrada.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(ap.business_id);
    if (ap.account_id !== a.id && !canManageBusiness(a, b)) return send(res, 403, { ok: false, error: 'Solo quien reservó o el negocio pueden cancelar la cita.' });
    db.prepare(`UPDATE business_appointments SET status='cancelada' WHERE id=?`).run(body.appointment_id);
    return send(res, 200, { ok: true });
  }
  // Paquete Premium de negocios: $100 al mes (30 días), por transferencia
  // con 'Ya hice la transferencia', igual que choferes. Los datos de la
  // transferencia NO están configurados: se pregunta por WhatsApp.
  if (pathname === '/api/subscribe-business') {
    const a = accountFromToken(body.token);
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(body.business_id);
    if (!b) return send(res, 404, { ok: false, error: 'Negocio no encontrado.' });
    if (!canManageBusiness(a, b)) return send(res, 403, { ok: false, error: 'Solo la dueña del negocio o el administrador pueden activar el Premium.' });
    const base = businessIsPremium(b) ? new Date(b.premium_until) : new Date();
    base.setDate(base.getDate() + BIZ_PREMIUM_DAYS);
    db.prepare(`UPDATE businesses SET premium_until=? WHERE id=?`).run(base.toISOString(), b.id);
    return send(res, 200, { ok: true, price: BIZ_PREMIUM_PRICE, days: BIZ_PREMIUM_DAYS,
      message: 'Paquete Premium activado por 30 días. Paga $100 por transferencia y toca «Ya hice la transferencia» en tu negocio. Pregunta los datos de la transferencia por WhatsApp al administrador de SanFerGo.',
      business: publicBusiness(db.prepare('SELECT * FROM businesses WHERE id=?').get(b.id)) });
  }
  // Estadísticas del negocio: beneficio Premium (gratis no las ve).
  if (pathname === '/api/business-stats') {
    const a = accountFromToken(body.token || q.get('token'));
    if (!a) return send(res, 401, { ok: false, error: 'Inicia sesión primero.' });
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(q.get('business_id') || body.business_id);
    if (!b) return send(res, 404, { ok: false, error: 'Negocio no encontrado.' });
    if (!canManageBusiness(a, b)) return send(res, 403, { ok: false, error: 'Solo la dueña del negocio o el administrador pueden ver las estadísticas.' });
    if (!businessIsPremium(b)) return send(res, 403, { ok: false, error: 'Las estadísticas son del paquete Premium ($100 al mes).' });
    const orders = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM business_orders WHERE business_id=?`).get(b.id);
    const appts = db.prepare(`SELECT COUNT(*) c FROM business_appointments WHERE business_id=?`).get(b.id);
    return send(res, 200, { ok: true, stats: { orders_total: orders.c, orders_amount: Math.round(orders.t * 100) / 100, appointments_total: appts.c, month_count: businessMonthCount(b.id), products: businessProducts(b.id).length, services: businessServices(b.id).length } });
  }
  // ---- Listas de administrador (cuentas y pasajeros) ----
  if (pathname === '/api/admin-accounts') {
    const a = accountFromToken(q.get('token') || body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    return send(res, 200, { ok: true, accounts: db.prepare('SELECT * FROM accounts ORDER BY id DESC').all().map(publicAccount) });
  }
  if (pathname === '/api/admin-passengers') {
    const a = accountFromToken(q.get('token') || body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    return send(res, 200, { ok: true, passengers: db.prepare('SELECT * FROM passengers ORDER BY id DESC').all() });
  }

  // ---- Panel de administrador (solo entrando con la cuenta admin) ----
  if (pathname === '/api/admin-drivers') {
    const a = accountFromToken(body.token || q.get('token'));
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const drivers = db.prepare('SELECT * FROM drivers ORDER BY id DESC').all().map(publicDriver);
    return send(res, 200, { ok: true, drivers });
  }
  if (pathname === '/api/block-driver') {
    const a = accountFromToken(body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const { driver_id, reason } = body;
    if (!reason || String(reason).trim().length < 3 || String(reason).trim().length > 300) return send(res, 400, { ok: false, error: 'Escribe el motivo del bloqueo (infracción, delito…), entre 3 y 300 caracteres.' });
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id);
    if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
    db.prepare(`UPDATE drivers SET is_blocked=1, block_reason=?, blocked_at=datetime('now'), online=0 WHERE id=?`).run(String(reason).trim(), driver_id);
    return send(res, 200, { ok: true, driver: publicDriver(db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id)) });
  }
  if (pathname === '/api/unblock-driver') {
    const a = accountFromToken(body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(body.driver_id);
    if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
    db.prepare(`UPDATE drivers SET is_blocked=0, block_reason=NULL, blocked_at=NULL WHERE id=?`).run(body.driver_id);
    return send(res, 200, { ok: true, driver: publicDriver(db.prepare('SELECT * FROM drivers WHERE id=?').get(body.driver_id)) });
  }
  // ---- Aprobación de choferes nuevos (v1.3.5, solo admin) ----
  // Un chofer nuevo nace PENDIENTE; hasta que el admin lo aprueba no puede
  // ir en línea ni responder. Los choferes ya activos quedan aprobados
  // (la migración al arrancar pone 'aprobado' a los que no tenían estado).
  if (pathname === '/api/admin-driver-requests') {
    const a = accountFromToken(body.token || q.get('token'));
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const drivers = db.prepare(`SELECT * FROM drivers WHERE status='pendiente' ORDER BY id ASC`).all().map(publicDriver);
    return send(res, 200, { ok: true, drivers });
  }
  if (pathname === '/api/approve-driver') {
    const a = accountFromToken(body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(body.driver_id);
    if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
    if (d.status === 'aprobado') return send(res, 200, { ok: true, driver: publicDriver(d), already: true });
    db.prepare(`UPDATE drivers SET status='aprobado' WHERE id=?`).run(body.driver_id);
    return send(res, 200, { ok: true, driver: publicDriver(db.prepare('SELECT * FROM drivers WHERE id=?').get(body.driver_id)) });
  }
  if (pathname === '/api/reject-driver') {
    const a = accountFromToken(body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(body.driver_id);
    if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
    if (d.status === 'aprobado') return send(res, 400, { ok: false, error: 'Ese conductor ya está aprobado; para sacarlo usa el bloqueo con motivo.' });
    db.prepare(`DELETE FROM drivers WHERE id=?`).run(body.driver_id);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/delete-driver') {
    const a = accountFromToken(body.token);
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(body.driver_id);
    if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
    db.prepare(`DELETE FROM drivers WHERE id=?`).run(body.driver_id);
    db.prepare(`UPDATE accounts SET driver_id=NULL WHERE driver_id=?`).run(body.driver_id);
    return send(res, 200, { ok: true });
  }
  // Resumen del panel: conteos de solicitudes nuevas (el cliente lo revisa
  // cada 5 segundos y muestra el aviso ámbar 'Tienes N solicitudes nuevas').
  if (pathname === '/api/admin-overview') {
    const a = accountFromToken(body.token || q.get('token'));
    if (!a || a.role !== 'admin') return send(res, 403, { ok: false, error: 'Solo el administrador de SanFerGo puede hacer esto.' });
    const pd = db.prepare(`SELECT COUNT(*) c FROM drivers WHERE status='pendiente'`).get();
    const pb = db.prepare(`SELECT COUNT(*) c FROM businesses WHERE status='pendiente'`).get();
    const pendingDrivers = pd ? pd.c : 0, pendingBusinesses = pb ? pb.c : 0;
    return send(res, 200, { ok: true, pending_drivers: pendingDrivers, pending_businesses: pendingBusinesses, pending_total: pendingDrivers + pendingBusinesses });
  }

  if (pathname === '/api/create-request') {
    const { passenger_id, passenger_name, passenger_phone, kind, origin_zone, origin_detail, origin_lat, origin_lng,
      dest_zone, dest_detail, dest_lat, dest_lng, distance_km, eta_minutes, price, payment_method, description,
      recipient_phone, items, stops, extra_stops } = body;
    if (kind !== 'viaje' && kind !== 'mandado') return send(res, 400, { ok: false, error: 'Tipo no válido.' });
    if (!dest_zone && !dest_detail) return send(res, 400, { ok: false, error: 'Falta el destino.' });
    // No se publica sin número de teléfono del pasajero: el conductor
    // necesita poder marcarle. Si no hay perfil, vienen nombre + teléfono.
    const p = passenger_id ? db.prepare('SELECT * FROM passengers WHERE id=?').get(passenger_id) : null;
    const pName = p ? p.name : (passenger_name || '').trim();
    const pPhone = p ? p.phone : (passenger_phone || '').trim();
    if (!pPhone) return send(res, 400, { ok: false, error: 'Falta tu número de teléfono: el conductor necesita poder marcarte. Regístrate como pasajero o escribe tu teléfono.' });
    const km = distance_km ?? (origin_lat != null && dest_lat != null ? haversineKm(origin_lat, origin_lng, dest_lat, dest_lng) : 1);
    const finalPrice = price ?? suggestedPrice(km);
    if (price != null && !validNegotiatedPrice(finalPrice)) return send(res, 400, { ok: false, error: GRID_ERROR });
    if (km < 0.5 || km > 30) return send(res, 400, { ok: false, error: 'Distancia fuera de rango para SanFerGo.' });
    // Forma de pago OBLIGATORIA al publicar (v1.3.0): es la final del
    // servicio y ya no se vuelve a pedir al confirmar.
    if (payment_method !== 'efectivo' && payment_method !== 'transferencia') return send(res, 400, { ok: false, error: 'Elige la forma de pago: efectivo o transferencia.' });
    const itemsJson = items ? JSON.stringify(items) : null;
    const stopsJson = stops ? JSON.stringify(stops) : null;
    const r = db.prepare(`INSERT INTO requests (kind, passenger_id, passenger_name, passenger_phone, passenger_photo,
      origin_zone, origin_detail, origin_lat, origin_lng, dest_zone, dest_detail, dest_lat, dest_lng,
      distance_km, eta_minutes, price, payment_method, description, recipient_phone, items_json, stops_json, extra_stops,
      status, trip_stage)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'buscando', 'confirmado')`).run(
      kind, passenger_id || null, pName || null, pPhone, p ? p.face_photo : null,
      origin_zone || null, origin_detail || null, origin_lat ?? null, origin_lng ?? null,
      dest_zone || null, dest_detail || null, dest_lat ?? null, dest_lng ?? null,
      Math.round(km * 10) / 10, eta_minutes ?? Math.max(3, Math.round(km * 3.5)), finalPrice,
      payment_method, description || '',
      recipient_phone ? String(recipient_phone).trim() : null, itemsJson, stopsJson, extra_stops || 0);
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
    const { driver_id, request_id, price, eta_minutes } = body;
    // kind (o action): 'aceptar_precio' confirma al instante (v1.3.0);
    // 'acepta' deja una oferta pendiente (compatibilidad); 'contraoferta'
    // deja la oferta pendiente del pasajero; 'aceptar_contraoferta_pasajero'
    // y 'rechazar_contraoferta_pasajero' responden a la contraoferta del pasajero.
    const kind = body.kind || body.action;
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id);
    const r = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
    if (!d || !r) return send(res, 404, { ok: false, error: 'No encontrado.' });
    if (d.is_blocked) return send(res, 403, { ok: false, error: blockedMsg(d) });
    if (d.status !== 'aprobado') return send(res, 403, { ok: false, error: 'Tu registro de chofer está pendiente de aprobación por el administrador de SanFerGo.' });
    if (r.status !== 'buscando') return send(res, 400, { ok: false, error: 'Esta solicitud ya no está buscando conductor.' });
    if (!d.online) return send(res, 400, { ok: false, error: 'Ponte en línea para responder solicitudes.' });
    if (!driverComplete(d)) return send(res, 400, { ok: false, error: 'Completa tu registro con tus fotos para responder.' });
    if (r.kind === 'viaje' && d.vehicle !== 'mototaxi') return send(res, 400, { ok: false, error: 'Los viajes son solo en mototaxi.' });
    const hasSub = driverHasSub(d);
    const offeredPrice = price ?? r.price;
    if (!hasSub) {
      if (driverServicesToday(driver_id) >= FREE_DAILY_LIMIT) return send(res, 400, { ok: false, error: `Ya hiciste tus ${FREE_DAILY_LIMIT} servicios gratis de hoy. Activa una suscripción para seguir.` });
      if (offeredPrice >= PREMIUM_MIN_PRICE) return send(res, 400, { ok: false, error: `Los servicios de $${PREMIUM_MIN_PRICE} o más son solo para suscripción. Activa una suscripción.` });
    }
    const existing = db.prepare('SELECT * FROM offers WHERE request_id=? AND driver_id=?').get(request_id, driver_id);
    const isPremium = hasSub ? 1 : 0;
    const insertOffer = (offerKind, offerPrice) => {
      const o = db.prepare(`INSERT INTO offers (request_id, driver_id, driver_name, driver_phone, driver_photo, driver_plan,
        driver_unit, driver_vehicle, vehicle_photo, eta_minutes, kind, price, is_premium)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(request_id, driver_id, d.name, d.phone, d.selfie, d.plan,
        d.unit, d.vehicle, d.vehicle_photo, eta_minutes ?? 5, offerKind, offerPrice, isPremium);
      return db.prepare('SELECT * FROM offers WHERE id=?').get(o.lastInsertRowid);
    };
    // Respuesta a la contraoferta del pasajero (sobre la oferta que ya existe).
    if (kind === 'rechazar_contraoferta_pasajero') {
      if (!existing || existing.passenger_counter_price == null) return send(res, 400, { ok: false, error: 'No hay contraoferta del pasajero para rechazar.' });
      db.prepare(`UPDATE offers SET status='rechazada' WHERE id=?`).run(existing.id);
      return send(res, 200, { ok: true, offer: db.prepare('SELECT * FROM offers WHERE id=?').get(existing.id) });
    }
    if (kind === 'aceptar_contraoferta_pasajero') {
      if (!existing || existing.passenger_counter_price == null) return send(res, 400, { ok: false, error: 'No hay contraoferta del pasajero para aceptar.' });
      const req2 = confirmRequest(request_id, d, existing.passenger_counter_price, existing.id);
      return send(res, 200, { ok: true, request: req2, offer: db.prepare('SELECT * FROM offers WHERE id=?').get(existing.id) });
    }
    // Aceptar el precio que ofreció el pasajero: confirmación INSTANTÁNEA
    // (v1.3.0). Ya no hay segunda aceptación del pasajero; la forma de
    // pago es la elegida al publicar y queda guardada en la solicitud.
    if (kind === 'aceptar_precio') {
      if (existing) return send(res, 400, { ok: false, error: 'Ya respondiste esta solicitud.' });
      if (offeredPrice < MIN_TRIP) return send(res, 400, { ok: false, error: 'El precio debe ser de al menos $20.' });
      const offer = insertOffer('acepta', offeredPrice);
      const req2 = confirmRequest(request_id, d, offeredPrice, offer.id);
      return send(res, 200, { ok: true, request: req2, offer });
    }
    // 'acepta' (compatibilidad) y 'contraoferta': la oferta queda pendiente
    // de la decisión del pasajero en /api/respond-offer. La contraoferta
    // también va de cinco en cinco (v1.3.1).
    if (existing) return send(res, 400, { ok: false, error: 'Ya respondiste esta solicitud.' });
    if (kind === 'contraoferta' && !validNegotiatedPrice(offeredPrice)) return send(res, 400, { ok: false, error: GRID_ERROR });
    const offer = insertOffer(kind === 'contraoferta' ? 'contraoferta' : 'acepta', offeredPrice);
    return send(res, 200, { ok: true, offer });
  }
  if (pathname === '/api/respond-offer') {
    const { passenger_id, request_id, offer_id, price } = body;
    // La acción puede venir como `action` ('acepta'/'rechaza'/'contraoferta',
    // compatibilidad v1.2.0) o como `response` ('aceptar'/'rechazar',
    // contrato de la app real v1.3.0); 'aceptar_contraoferta_pasajero' y
    // 'rechazar_contraoferta_pasajero' son alias de aceptar/rechazar.
    let action = body.action || body.response;
    if (action === 'aceptar' || action === 'aceptar_contraoferta_pasajero') action = 'acepta';
    if (action === 'rechazar' || action === 'rechazar_contraoferta_pasajero') action = 'rechaza';
    const r = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
    const o = db.prepare('SELECT * FROM offers WHERE id=?').get(offer_id);
    if (!r || !o || o.request_id !== request_id) return send(res, 404, { ok: false, error: 'No encontrado.' });
    if (r.status !== 'buscando') return send(res, 400, { ok: false, error: 'Esta solicitud ya no está buscando conductor.' });
    if (action === 'acepta') {
      const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(o.driver_id);
      if (!d) return send(res, 404, { ok: false, error: 'Conductor no encontrado.' });
      if (d.is_blocked) return send(res, 403, { ok: false, error: 'Este conductor está bloqueado y no puede tomar el servicio.' });
      const finalPrice = o.passenger_counter_price || o.price; // si el pasajero contraofertó, se confirma a ese precio
      // Al aceptar una contraoferta el viaje se confirma DE UNA VEZ con la
      // forma de pago elegida al publicar (sin paso de pago, v1.3.0).
      const req2 = confirmRequest(request_id, d, finalPrice, offer_id);
      return send(res, 200, { ok: true, request: req2 });
    }
    if (action === 'rechaza') {
      db.prepare(`UPDATE offers SET status='rechazada' WHERE id=?`).run(offer_id);
      return send(res, 200, { ok: true });
    }
    if (action === 'contraoferta') {
      if (!validNegotiatedPrice(price)) return send(res, 400, { ok: false, error: GRID_ERROR });
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
    if (!validNegotiatedPrice(price)) return send(res, 400, { ok: false, error: GRID_ERROR });
    db.prepare('UPDATE requests SET price=? WHERE id=?').run(price, request_id);
    return send(res, 200, { ok: true, request: db.prepare('SELECT * FROM requests WHERE id=?').get(request_id) });
  }
  if (pathname === '/api/cancel-request') {
    const { request_id } = body;
    const r = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
    if (!r) return send(res, 404, { ok: false, error: 'No encontrado.' });
    if (r.status === 'finalizado' || r.status === 'cancelado') return send(res, 400, { ok: false, error: 'Este servicio ya terminó.' });
    // Cancelar solo existe antes de que empiece el servicio: una vez que el
    // chofer tocó "Iniciar viaje" (en_viaje) o ya recogió el mandado
    // (recogido en adelante) ya no se puede cancelar.
    const started = (r.kind === 'viaje' && r.trip_stage === 'en_viaje') ||
      (r.kind === 'mandado' && ['recogido', 'en_camino', 'entregado'].includes(r.trip_stage || ''));
    if (r.status === 'aceptado' && started) {
      return send(res, 400, { ok: false, error: 'El servicio ya empezó y no se puede cancelar.' });
    }
    db.prepare(`UPDATE requests SET status='cancelado' WHERE id=?`).run(request_id);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/advance-stage') {
    const { driver_id, request_id, stage } = body;
    const r = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
    if (!r) return send(res, 404, { ok: false, error: 'No encontrado.' });
    if (r.driver_id !== driver_id) return send(res, 403, { ok: false, error: 'Solo el conductor asignado puede avanzar el viaje.' });
    const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(driver_id);
    if (d && d.is_blocked) return send(res, 403, { ok: false, error: blockedMsg(d) });
    const allowed = r.kind === 'viaje' ? TRIP_STAGES : MANDADO_STAGES;
    if (!allowed.includes(stage)) return send(res, 400, { ok: false, error: 'Etapa no válida.' });
    const cur = allowed.indexOf(r.trip_stage), next = allowed.indexOf(stage);
    if (next !== cur + 1 && !(r.trip_stage === 'confirmado' && stage === allowed[1])) {
      return send(res, 400, { ok: false, error: 'No se puede saltar etapas.' });
    }
    const isFinal = stage === 'finalizado' || stage === 'entregado';
    const status = isFinal ? 'finalizado' : r.status;
    // Marcar inicio real del recorrido (para el recibo: duración real).
    const startStage = r.kind === 'viaje' ? 'en_viaje' : 'en_camino';
    const stampStart = stage === startStage && !r.trip_started_at;
    db.prepare(`UPDATE requests SET trip_stage=?, trip_stage_at=datetime('now'), status=?
      ${stampStart ? ', trip_started_at=datetime(\'now\')' : ''}
      ${isFinal ? ', finished_at=datetime(\'now\')' : ''}
      WHERE id=?`).run(stage, status, request_id);
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
  if (pathname === '/api/update-delivery-point') {
    // El chofer pega una ubicación de WhatsApp en un mandado en curso.
    const { driver_id, request_id, lat, lng, detail } = body;
    const r = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
    if (!r) return send(res, 404, { ok: false, error: 'No encontrado.' });
    if (r.driver_id !== driver_id) return send(res, 403, { ok: false, error: 'Solo el conductor asignado.' });
    if (r.status !== 'aceptado') return send(res, 400, { ok: false, error: 'El servicio no está activo.' });
    if (lat == null || lng == null) return send(res, 400, { ok: false, error: 'Faltan las coordenadas.' });
    const ref = detail ? String(detail).trim() : '';
    const destDetail = `Ubicación de WhatsApp (${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)})` + (ref ? ' · ' + ref : '');
    db.prepare(`UPDATE requests SET dest_lat=?, dest_lng=?, dest_detail=? WHERE id=?`).run(lat, lng, destDetail, request_id);
    return send(res, 200, { ok: true, request: db.prepare('SELECT * FROM requests WHERE id=?').get(request_id) });
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
