# SanFerGo — versión pública

App real de SanFerGo para San Fernando, Chiapas: viajes en mototaxi y
mandados en moto/mototaxi, con precio puesto por el pasajero y regateo en
los dos sentidos. Un solo enlace público, datos compartidos en el servidor
(las solicitudes de los pasajeros les llegan a los choferes de verdad).

## Qué incluye

- Menú de inicio: Viajes, Mandados, Negocios bloqueado (Próximamente).
  Sin barra inferior en el inicio, tonos blancos.
- Pedir viaje: botón «Solicitar el viaje» (sin mapa) → origen por GPS o
  punto en el mapa → destino de 16 lugares o punto en el mapa → detalles
  y precio → publicar. Cada paso cabe en una pantalla, con «Regresar».
- Tarifa: **$12 de salida + $7 por km** en toda la app.
- Viajes solo en mototaxi; mandados en moto de dos ruedas o mototaxi.
- Ofertas: aceptar / contraofertar; el pasajero puede contraofertar y el
  chofer acepta o rechaza (sin auto-confirmación). Avisos en la parte de
  arriba de la pantalla.
- Viaje confirmado estilo Uber: Voy en camino → Ya llegué → Iniciar viaje
  → Llegué a destino. Sin línea temporal. Pantalla del viaje activo = mapa
  oscuro a pantalla completa, solo tiras flotantes, ruta azul y recorrido
  en azul claro. El pasajero ve el mototaxi moviéndose; el chofer ve el
  punto de recogida con guía «Cómo llegar» (distancia, tiempo, dirección)
  y botón discreto para abrir Google Maps (sin avisos ni confirmaciones).
  El mapa se monta una sola vez; el marcador se desliza suave.
- Modo chofer: «Trabajar como chofer», barra solo Inicio / Taxímetro /
  Recibir Viajes, pantallas paginadas con botones (una solicitud por
  página, Anterior/Siguiente) y contador de solicitudes en espera.
- Taxímetro: mapa oscuro a pantalla completa, aviso de aproximado, conteo
  en vivo (tiempo, distancia, velocidad, precio final), resumen y recibo.
- Registro: chofer con nombre, teléfono, vehículo, unidad y fotos
  obligatorias (selfie + mototaxi/moto); pasajero con nombre, teléfono y
  foto de cara obligatoria.
- Suscripción: gratis 5 servicios al día; $70/semana ilimitado, con
  prioridad (distintivo PRIORIDAD · SUSCRIPCIÓN) y acceso a servicios de
  $80 o más. Se paga por transferencia; el chofer toca «Ya hice la
  transferencia» para activar 7 días. La app NO trae cuenta/CLABE: el
  chofer debe pedir los datos de la transferencia por WhatsApp.
- Cosas perdidas: reportes de pasajeros y choferes, estados
  Perdido / Encontrado / Devuelto.
- Mandados: una sola pantalla, sin mapa al pedir; ciclo va a recoger →
  llegó → recogido → en camino → entregado.
- Sin sección de Actividad y sin Tiendas (pausadas por el usuario).
- Mapas sin llave: OpenStreetMap y Esri gris oscuro; rutas e indicaciones
  con OSRM (servidor público, sin llave), con respaldo en línea recta.
- PWA: manifiesto + meta tags para «Agregar a pantalla de inicio».

## Tecnología

- Node.js 22+ sin dependencias (solo módulos de la librería estándar).
- Base de datos SQLite persistente en `data/sanfergo.db` (WAL). Los
  registros y viajes sobreviven a reinicios y redespliegues: el archivo
  de la base de datos es el estado. Para migrar de servidor, basta copiar
  `data/sanfergo.db`.
- Las fotos se guardan achicadas (máx. 480 px, JPEG) dentro de la base.

## Cómo correrlo

```
node server.js            # http://localhost:3000
PORT=8080 node server.js  # otro puerto
DATA_DIR=/ruta/a/datos node server.js
```

No requiere cuentas ni llaves. Para ponerlo en internet hace falta un
host con Node.js y disco persistente (o un túnel como Cloudflare Tunnel).

## Puntos de los 16 destinos

Ver `server.js` (const PLACES). Centro (16.8709, -93.2063) y Parque
(Parque Central) están verificados; Guerrero (calle Vicente Guerrero) y
Clínica (Clínica San Luis) se geocodificaron; Arco, Madero y Las Isabeles
son puntos GPS reales de viajes del usuario; el resto son puntos distintos
colocados alrededor del pueblo y se corrigen en ese archivo si alguno
queda mal. Guerrero, Copalar y Terrero Copalar son tres lugares distintos.

## Datos

La app empieza limpia. Los registros del artefacto anterior (chofer
Josué Eduardo Villarreal Vazquez, unidad Hg67h; pasajera Lucia sanchez)
no se migran automáticamente: las fotos viven en la app anterior. El
usuario debe volver a registrarse aquí con sus fotos.
