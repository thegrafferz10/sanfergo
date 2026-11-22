# SanFerGo — versión pública (v1.3.8)

App real de SanFerGo para San Fernando, Chiapas: viajes en mototaxi y
mandados en moto/mototaxi, con precio puesto por el pasajero y regateo en
los dos sentidos. Un solo enlace público, datos compartidos en el servidor
(las solicitudes de los pasajeros les llegan a los choferes de verdad).

## v1.3.8 (2026-11-22) — paso de origen igual que la app real
- El paso "¿De dónde sales?" ahora son dos tarjetas como en la app real: "Usar ubicación actual" destacada con borde verde e ícono de mira (abre el mapa con el pin en el GPS para confirmar o arrastrar) y "Ubicar un punto en el mapa" con ícono de pin (abre el mapa para tocar el punto). El flujo no cambia.

## v1.3.7 (2026-11-22) — inicio igual que la app real
- Quitada la tarjeta "Cosas perdidas" del inicio: el inicio muestra solo Viajes, Mandados y Negocios (Negocios ocupa todo el ancho de la segunda fila). La sección de Cosas perdidas sigue existiendo en el servidor y sus endpoints, solo ya no se entra desde el inicio.

## v1.3.6 (2026-11-22) — auditoría contra la app real
- Aceptación del chofer confirma al instante (sin segundo paso del pasajero); la contraoferta sigue esperando la decisión del pasajero.
- Rejilla de $5 en todos los caminos de aceptación; límite gratis de 5 servicios/día y tope de $80+ también al confirmar por respond-offer.
- Precio sugerido de mandado suma $10 por parada extra; sin mínimo de distancia (solo mínimo de precio $20).
- Chofer bloqueado puede terminar su viaje en curso; citas sin encimes por duración; anuncio de entrada al azar entre todos los activos; pago fijo al publicar; día en hora de Chiapas.
- Mapa principal OSM (Carto ya exige llave) con respaldo Esri; selector de destino sin botones (coincidencias al escribir); "Usar ubicación actual" abre el mapa para confirmar el pin; píldora "Vas a: destino" dinámica.
- Mandados "Quiero": selector Mototaxi/Moto en el paso 1, entrega solo con "Marcar mi punto", sin destino inventado a Centro; historial con "Repetir este viaje" por viaje.

## Qué incluye

- Cuentas e inicio de sesión (v1.2.0, login primero desde 2026-11-21): la
  app abre en la página de login estilo Facebook (encabezado verde con
  SanFerGo y «San Fernando, Chiapas», una sola tarjeta con número-o-correo,
  contraseña, botón grande «Iniciar sesión», opción de Google que explica
  que llega con el enlace permanente y botón «Crear cuenta nueva»). Sin
  sesión no se muestra el menú; tras entrar va directo al menú y al pie solo
  queda el enlace pequeño «Mi cuenta · @usuario» (cierra sesión; el admin
  abre su panel desde ahí). Crear cuenta con número y contraseña, o solo con correo;
  entrar con usuario, número o correo y contraseña. La contraseña se
  guarda con hash scrypt, nunca en texto plano. Si el número o correo
  ya tiene cuenta, la app avisa a nombre de quién está y ofrece
  «Recuperar mi cuenta con mi contraseña» (no abre la anterior sola).
  Sin código de verificación: no hay canal de SMS ni correo, la
  contraseña es la llave de recuperación. Perfiles viejos sin cuenta se
  reclaman entrando con su número y creando su contraseña. Una cuenta
  es perfil de pasajero; ser chofer pide el registro adicional de
  siempre, enlazado a la cuenta. «Continuar con Google» explica que
  llega cuando la app tenga su enlace permanente. Sesión persistente
  en el dispositivo.
- Panel de administrador (v1.3.5): la cuenta admin abre DIRECTO en el panel
  al iniciar sesión (usuario `admin`, contraseña `admin`, temporal).
  Siete opciones en tarjetas uniformes: Solicitudes de choferes,
  Solicitudes de negocio, Administrar choferes (ficha con suscripción y
  botón de eliminar, además del bloqueo con motivo), Administrar
  pasajeros, Cuentas, Anuncios y Tiendas. Cada opción abre SU PROPIA
  PANTALLA con título y botón «Regresar» arriba. Aviso ámbar con conteos
  cuando hay solicitudes nuevas (revisa cada 5 s). Chofer nuevo nace
  PENDIENTE y no puede ir en línea hasta que el admin lo acepta.
- Menú de inicio: Viajes, Mandados, Negocios (desbloqueado en v1.3.5).
  Sin barra inferior en el inicio, tonos blancos.
- Pedir viaje: botón «Solicitar el viaje» → origen por GPS o punto en el
  mapa → destino con buscador a pantalla completa (se escribe el lugar —sin
  importar mayúsculas ni acentos, «juarez» encuentra «Benito Juárez»—,
  el mapa se acerca y se ajusta el pin arrastrándolo o tocando el mapa;
  también se puede marcar el punto sin escribir nada) → detalles → precio
  y forma de pago (efectivo o transferencia, en el mismo paso) → publicar.
  Cada paso cabe en una pantalla, con «Regresar» arriba. Al publicar sin
  número de teléfono del pasajero el servidor lo rechaza. En el inicio de
  Viajes, «🔁 Repetir último viaje» pre-llena la solicitud con los mismos
  puntos de salida y destino del viaje anterior y lleva directo al paso de
  detalles/precio.
- Tarifa: **$10 de salida + $2.50 cada 300 m** en toda la app; esperando
  (parado) **$1.25/min**; **mínimo por viaje $20**. Validada en viajes
  reales: 1.5 km = $22.50; 2.1 km = $27.50; 3.59 km + espera = $40.43.
  NO cambiar la tarifa sin orden del usuario. Precios negociados (v1.3.1):
  solo se mueven **de $5 en $5**; el precio sugerido sube al siguiente
  múltiplo de $5 sin bajar de $20 ($17/$18 → $20, $33 → $35) y el servidor
  rechaza precios fuera de la rejilla. El cobro final del taxímetro sigue
  exacto, sin redondear. Cuentas (v1.3.3): entrar con un número que tiene
  perfil pero no cuenta ofrece crear la contraseña para reclamarlo; con un
  número sin perfil o con contraseña incorrecta sale un mensaje limpio.
  Mapas de marcar punto (v1.3.4): pintan con su nombre los negocios y
  lugares reales de San Fernando (farmacias, carnicerías, Centro de Salud,
  Parque Central, Mercado Municipal, Arco de bienvenida y más, con nombre
  y coordenadas del registro de lugares de Meta) además de los rótulos de
  las colonias, para que la gente se ubique por las tiendas que conoce.
  Contraseñas (v1.3.4): todos los campos de contraseña (inicio de sesión,
  crear cuenta y reclamar cuenta) llevan un botón de ojo para ver lo que
  se escribe. Reclamo (v1.3.4): la tarjeta dice «Ya tienes un registro en
  SanFerGo a nombre de…» y ningún error técnico crudo se muestra tal cual.
- El encabezado (logo SanFerGo + «San Fernando, Chiapas») solo sale en
  el inicio, no en los submenús. El inicio no tiene barra inferior.
- Viajes: al entrar se ve solo «¿A dónde vas?», la tarjeta «Pides
  como…», «Solicitar el viaje», el texto de ayuda, «Regresar al inicio»
  y el botón ámbar grande «Historial de viajes» (viajes pasados,
  terminados y cancelados, con recibo al tocar uno). «Buscando tu
  mototaxi…» cabe en una vista, sin scroll ni barra: las ofertas se ven
  en carrusel deslizable; el pasajero NO puede pedir otro viaje desde
  ahí, solo cancelar (que vuelve al inicio de Viajes). Cancelar solo
  existe antes de que empiece el viaje: una vez en viaje el servidor lo
  rechaza.
- Viajes solo en mototaxi; mandados en moto de dos ruedas o mototaxi.
- Ofertas: aceptar / contraofertar; el pasajero puede contraofertar y el
  chofer acepta o rechaza (sin auto-confirmación). Avisos en la parte de
  arriba de la pantalla.
- Alertas centralizadas (2026-11-21): todos los avisos de eventos nacen de
  una sola función, `fireAlert`, en el cliente: al chofer en línea le suena
  el tono distintivo de SanFerGo (generado con WebAudio), vibra el teléfono,
  sale el aviso flotante «¡Nuevo viaje!» y la notificación del sistema, esté
  en la pantalla que esté de modo chofer (el sondeo de solicitudes nuevas
  corre en cualquier pantalla de modo chofer); al pasajero le avisa cuando le
  aceptan el viaje, cuando el mototaxi pica «Voy en camino» y, con la alerta
  más fuerte, cuando ya está afuera de su domicilio. El permiso de
  notificaciones se pide al ponerse en línea el chofer y al publicar el
  pasajero. Los eventos de alerta nacen centralizados en `fireAlert`, de
  modo que al empaquetar la app como nativa esos mismos disparadores se
  conectan a las notificaciones push del teléfono (FCM/APNs); en la versión
  web el canal es la API de notificaciones del sistema. La pantalla se
  mantiene prendida (Wake Lock) mientras el taxímetro corre un recorrido y
  mientras hay un viaje activo en curso.
- Viaje confirmado estilo Uber: Voy en camino → Ya estoy afuera →
  Iniciar viaje → Llegué a destino. Sin línea temporal. Pantalla del
  viaje activo = mapa claro a pantalla completa, solo tiras flotantes blancas,
  ruta por calle (OSRM) y recorrido en azul claro. El pasajero ve el
  mototaxi moviéndose con su distancia y tiempo estimado; el chofer ve
  el punto de recogida con guía «Cómo llegar» (distancia, tiempo,
  dirección) y botón discreto para abrir Google Maps (sin avisos ni
  confirmaciones). Al tocar «Ya estoy afuera» el pasajero recibe el aviso
  y al chofer le sale el botón «Llamar» (tel:). El mapa se monta una sola
  El mapa se monta una sola vez; el marcador se desliza suave. En el mapa del
  chofer durante el viaje activo, el punto de recogida muestra el nombre del
  pasajero sobre el punto («Nombre · Colonia») en una píldora verde, estilo
  pin de ubicación en vivo de WhatsApp. Sin doble confirmación: el pasajero
  elige la forma de pago (efectivo o transferencia) en el mismo paso donde
  pone su precio, antes de publicar; cuando el chofer acepta el precio el
  servicio queda confirmado en ese momento (la contraoferta del chofer sí
  sigue esperando la decisión del pasajero, y su «Aceptar» confirma de una
  vez). El chofer comparte su GPS desde
  cualquier pantalla de la app. Al finalizar, recibo para el chofer y
  resumen con recibo para el pasajero. La contraoferta del pasajero queda
  guardada hasta que el chofer la acepta o la rechaza (sin
  auto-confirmación).
- Modo chofer: «Trabajar como chofer», barra solo Inicio / Taxímetro /
  Recibir Viajes; Recibir Viajes con pantallas paginadas (una solicitud por
  página, Anterior/Siguiente) y contador de solicitudes en espera. El Inicio
  del chofer ya no tiene franja «Modo chofer»: tarjeta de perfil (foto
  grande, nombre con «Mototaxi · Unidad …», píldora de estado + WhatsApp en
  su línea, botón «Ponerme en línea» debajo), las 4 entradas con un solo
  diseño uniforme de tarjeta con borde verde y flecha, y «Salir del modo
  chofer» en rojo al final de la página, arriba de la barra. La página hace
  scroll hasta el final.
- Taxímetro: mapa claro a pantalla completa, aviso de aproximado, conteo
  en vivo (tiempo, distancia, velocidad, precio final), resumen y recibo.
  Límite del plan gratis: máximo 5 recorridos del taxímetro por día (contados
  desde el historial del teléfono, en hora de America/Mexico_City, separado
  del contador de viajes/mandados); una píldora sobre el taxímetro muestra
  «Plan gratis · X de 5 recorridos del taxímetro hoy» y al llegar a 5 INICIAR
  queda bloqueado con la leyenda de pagar la suscripción y botón a
  «Mi plan y suscripción». Con suscripción, recorridos ilimitados.
  Cuenta por reloj real: al salir de la app (por ejemplo a WhatsApp) y
  volver, los minutos fuera se suman al tiempo y a la espera. Modo
  seguimiento (cámara pegada a la mototaxi) y modo heading-up (la
  mototaxi siempre hacia arriba, el mapa gira debajo), con brújula para
  volver al norte y botón para recentrar. Historial del taxímetro en el
  Inicio del chofer (recorridos guardados en el teléfono, 4 por página,
  con su resumen y recibo); la pestaña del Taxímetro NO lleva botón de
  historial, solo mapa + aviso + INICIAR.
- Panel de administrador (solo el dueño, teléfono 9614868605): botón
  «Panel de administrador» en el Inicio del chofer, visible solo si el
  teléfono guardado en el aparato es ese. Lista de choferes uno por uno
  con foto, WhatsApp, unidad, plan, estado y servicios hechos; ficha
  completa con las dos fotos y sus viajes/mandados; bloquear exige motivo
  (se guarda en la ficha) y saca al chofer de línea al momento: no puede
  ponerse en línea ni responder solicitudes ni re-registrarse con el
  mismo teléfono; los viajes en curso no se tocan.
- Registro: chofer con nombre, teléfono, vehículo, unidad y fotos
  obligatorias (selfie + mototaxi/moto); pasajero con nombre, teléfono y
  foto de cara obligatoria.
- Suscripción: gratis 5 servicios al día; tres planes de paga — $50 por
  semana (7 días), $150 por mes (30 días) o $500 por año (365 días), el
  chofer elige — con prioridad (distintivo PRIORIDAD · SUSCRIPCIÓN) y acceso
  a servicios de $80 o más. Se paga por transferencia; la confirmación
  muestra el precio y los días elegidos y el chofer toca «Ya hice la
  transferencia» para activar el plan. La app NO trae cuenta/CLABE: el
  chofer debe pedir los datos de la transferencia por WhatsApp.
- Cosas perdidas: reportes de pasajeros y choferes, estados
  Perdido / Encontrado / Devuelto.
- Mandados rediseñados (2026-11-20): al entrar preguntan «¿Qué quieres
  hacer?» con dos opciones grandes. «Quiero un mandado» (que me traigan
  algo: la entrega siempre es mi ubicación actual; lista editable de
  cosas; opción de un solo lugar o varios lados, cada parada extra +$10)
  y «Enviar un mandado» (mando algo mío: la recogida siempre es mi
  ubicación actual con GPS; la entrega con buscador de lugar (se escribe el lugar y se ajusta el pin en el mapa), WhatsApp de
  quien recibe con botón «Pedir ubicación por WhatsApp», y campo «Pegar
  ubicación de WhatsApp» que acepta enlaces de Google Maps —incluidos los
  cortos goo.gl / maps.app.goo.gl— o coordenadas decimales o en
  grados/minutos/segundos). Los dos sentidos van por pasos cortos con
  «Continuar» y «Regresar», sin formulario largo con scroll y sin barra
  inferior; sin tarjeta de perfil ni franja «Pides como…» en Mandados.
  El chofer también puede pegar una ubicación en el mandado en curso.
  El ciclo es: va a recoger → llegó → recogido → en camino → entregado,
  con el mismo mapa en vivo y recibo que los viajes.
- Sin sección de Actividad y sin Tiendas (pausadas por el usuario).
- Un solo mapa claro fijo estilo Apple Maps a pantalla completa en toda la
  app, con pinch-zoom, arrastre con un dedo, pin arrastrable, giro con dos
  dedos para rotar y brújula para volver al norte. Sin opciones de híbrido /
  satélite. El mapa gira con el rumbo del mototaxi (heading-up: la mototaxi
  siempre apunta arriba).
- Mapas: MapLibre GL con teselas claras de CartoDB Positron (sin llave),
  con respaldo a OSM estándar (también claro) si las teselas no cargan; rutas
  por calle con OSRM (servidor público, sin llave). Si OSRM no devuelve ruta
  por calle, NO se dibuja ninguna línea (sin respaldo en línea recta). La
  línea azul del recorrido se suaviza solo para mostrarla (se ignoran
  temblores menores a ~8 m, se corrigen picos y se amortigua la punta); la
  distancia y el precio siguen usando los pasos crudos.
- PWA: manifiesto + meta tags para «Agregar a pantalla de inicio».
- Negocios (v1.3.5): crear un negocio manda solicitud (nombre, qué vende,
  WhatsApp, foto) y el admin la revisa y activa. Tres tipos: entrega
  (productos con foto y precio, carrito, pedido con productos y envío
  separados), catálogo (productos y servicios visibles en la app; WhatsApp
  y llamada solo como botones de contacto) y citas (reserva por día y hora
  sin encimes, agenda para el negocio). Pantalla con «Crear un negocio»,
  «Ver mi cita» y «Ver mi pedido» arriba y los negocios aceptados abajo;
  la dueña administra en «Administrar negocio». Paquete Premium $100 al
  mes (30 días, por transferencia con «Ya hice la transferencia»; los
  datos de la transferencia NO están configurados): gratis solo 1 negocio
  por cuenta; Premium permite más negocios, destacado con
  «★ Premium · Verificado», productos/servicios ilimitados, pedidos y
  citas ilimitados, estadísticas y publicidad gratis. Topes gratis:
  10 productos, 10 servicios, 30 pedidos/citas al mes.
- Anuncios de entrada flotantes (v1.3.5): el Inicio NO muestra anuncios.
  Al entrar a Viajes, Negocios o Mandados aparece UN solo anuncio
  flotante, al azar entre los activos que rotan en esa entrada (con
  historial se prefieren los de negocios con los que ya se pidió),
  precargado al iniciar sesión para salir al instante, con X grande que
  lo cierra al instante; abajo lleva «Publicidad», el nombre del negocio
  y botón «Ver negocio» (lleva a su ficha). El anuncio es SOLO imagen
  (obligatoria), libre o vinculado a un negocio; el admin elige en qué
  entradas rota cada uno.

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
El buscador de destino suma además Benito Juárez, El Progreso, Valle Bonito,
Miguel Hidalgo y Vicente Guerrero (puntos aproximados alrededor del pueblo,
ajustables con el pin).

## Datos

La app empieza limpia. Los registros del artefacto anterior (chofer
Josué Eduardo Villarreal Vazquez, unidad Hg67h; pasajera Lucia sanchez)
no se migran automáticamente: las fotos viven en la app anterior. El
usuario debe volver a registrarse aquí con sus fotos.
