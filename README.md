# SanFerGo — versión pública (v1.4.20)

App real de SanFerGo para San Fernando, Chiapas: viajes en mototaxi y
mandados en moto/mototaxi, con precio puesto por el pasajero y regateo en
los dos sentidos. Un solo enlace público, datos compartidos en el servidor
(las solicitudes de los pasajeros les llegan a los choferes de verdad).

## v1.4.20 (2026-11-23) — el chofer de una cuenta no aparece en otra

- Reporte del usuario: en un mismo teléfono, al entrar con otra cuenta (Emiliano, Paulina) la tarjeta "Trabajar como chofer" seguía mostrando el chofer de la cuenta anterior ("Josué Eduardo · En línea"). Causa: `loadMe()` usaba el id de chofer guardado en el teléfono (`store.did`) aunque hubiera otra sesión, y `doLogout()` no lo borraba.
- Arreglo: con sesión, los perfiles (chofer y pasajero) vienen SOLO de `/api/me`, los enlazados a esa cuenta; el id guardado que no coincida se borra y nunca se usa. El id guardado solo se usa sin sesión (modo sin cuenta, heredado). `doLogout()` ahora limpia también `store.did` y `store.pid`. Sin chofer, el inicio sigue ofreciendo "Registrarse como conductor" con el formulario (solicitud pendiente de aprobación del administrador). Nada más cambia.
- Pruebas: suite completa contra BD limpia: 326 OK, 0 FAIL (315 de antes + 11 nuevos: `/api/me` de la cuenta B sin chofer, simulación real de `loadMe()` con el id viejo en el teléfono, control sin sesión, rama sin chofer y `doLogout()`). La suite se corre con `RESEND_API_KEY=test GOOGLE_CLIENT_ID=test-client-id` y una BD limpia.

## v1.4.19 (2026-11-23) — respaldo de la base de datos (solo admin)

- El administrador puede descargar una copia completa de la base de datos: nuevo endpoint `GET /api/admin/backup` (solo con token de sesión de administrador; sin él responde 403 y no sale ningún byte) y botón "💾 Respaldar base de datos" en el panel del administrador. Antes de servir el archivo se hace un checkpoint WAL para que la copia sea consistente; el archivo se descarga como `sanfergo-AAAA-MM-DD.db`. Nada más cambia.
- Pruebas: suite completa contra BD limpia: 315 OK, 0 FAIL (309 de antes + 6 nuevos del respaldo). La suite se corre con `RESEND_API_KEY=test GOOGLE_CLIENT_ID=test-client-id` y una BD limpia.

## v1.4.18 (2026-11-23) — página de Aviso de privacidad

- Google exige una URL de política de privacidad para publicar la app en la pantalla de consentimiento OAuth: nueva página pública `GET /privacidad` (aviso en español: qué datos se recopilan, con quién se comparten, derechos de acceso/corrección/eliminación por WhatsApp 9614868605, contacto SanFerGo, San Fernando, Chiapas) y enlace "Aviso de privacidad" en el pie de la pantalla de inicio de sesión (abre en pestaña nueva). Nada más cambia.
- Pruebas: suite completa contra BD limpia: 309 OK, 0 FAIL (306 de antes + 3 nuevos de privacidad). La suite se corre con `RESEND_API_KEY=test GOOGLE_CLIENT_ID=test-client-id` y una BD limpia.

## v1.4.17 (2026-11-23) — registro con código por correo + entrar con Google

- Petición del usuario: ahora que la app está alojada, al registrarse se puede pedir un código por correo o entrar con Google (antes no había código y el botón de Google era solo un aviso).
- Código por correo: al registrarse con correo, el servidor manda un código de 6 dígitos por correo (API HTTP de Resend, sin dependencias nuevas) y la cuenta se crea solo después de escribirlo. El código va hasheado (SHA-256), vence en 10 minutos, se agota a los 5 intentos fallidos; máximo 3 envíos por hora y 60 s entre envíos por correo. La pantalla "Revisa tu correo" tiene reenvío con cuenta atrás y "Cambiar correo o datos". Solo con número el registro sigue directo, sin código, como antes.
- Entrar con Google: botón real de Google (Google Identity Services) en el inicio de sesión; el servidor verifica el token con Google (tokeninfo: aud, correo verificado, expiración) y crea la cuenta o enlaza la que ya tenga ese correo (con su pasajero). El client ID llega al cliente por `/api/config` (es un identificador público, no un secreto).
- Sin las variables configuradas (`RESEND_API_KEY`, `RESEND_FROM`, `GOOGLE_CLIENT_ID`) la app sigue funcionando como antes: el código por correo queda desactivado y el botón de Google muestra su aviso, sin romperse nada. Cuentas viejas, viajes, tarifa, mapa y anuncios sin cambios.
- Pruebas: suite completa contra BD limpia: 306 OK, 0 FAIL (272 de antes + 34 nuevos: flujo del código, límites, vencimiento, bloqueo por intentos, Google rechazado y cliente), más 13 OK, 0 FAIL en jsdom para la pantalla de login (botón de Google real y paso del código). La suite se corre con `RESEND_API_KEY=test GOOGLE_CLIENT_ID=test-client-id` y una BD limpia; el envío real de correos no se prueba (no sale ningún correo).

## v1.4.16 (2026-11-23) — carrusel de anuncios en Negocios

- Petición del usuario con captura de referencia (como el inicio de la app de la captura): en Negocios, arriba van los anuncios en formato horizontal y abajo las tarjetas de negocios. Carrusel con los anuncios activos que rotan en Negocios (los mismos de `/api/ads` que el flotante de entrada), banners de 210 px con swipe (scroll-snap), puntos abajo, auto-avance cada 5 s que se pausa al tocar; tocar un anuncio vinculado abre su negocio, el libre no hace nada; sin anuncios activos no se muestra nada. Los tres botones y las tarjetas de negocios quedan exactos. El anuncio flotante de entrada no cambia.

## v1.4.15 (2026-11-22) — paso de detalles sin aplastar + mapa en vivo del chofer encuadrado por etapa

- Detalle 1 (captura del usuario 7:29, paso "Tu recorrido"): las dos filas de puntos se veían feas — el texto del origen ("Punto en el mapa · cerca de Arco") y del destino ("Punto en el mapa · cerca de Madero") se aplastaba en tiritas verticales de una palabra por línea, al lado de dos botones ámbar "Cambiar" gigantes. Causa raíz: la misma que el paso de destino en v1.4.13 — la regla `.strip button{width:100%}` hacía que "Cambiar" ocupara casi toda la fila y el texto (flex:1, sin mínimo ni ellipsis) se encogiera a su mínimo; además `.strip button` le ponía fondo ámbar al botón aunque su clase es `linklike`. Arreglo (solo ese paso, patrón de la pastilla de ruta de la app real, `routePill`, y de su captura 7:34): cada fila es punto de color + texto en UNA línea con ellipsis + "Cambiar" compacto blanco con borde (nueva clase `.pickdet`: `width:auto`, `flex-shrink:0`, borde 1 px, radio 10 px, 12 px). Regresar, "≈ min · km de recorrido", la caja verde "Tu recorrido" y "Continuar" quedan igual en función y lugar.
- Detalle 2 (captura del usuario 7:31, panel del chofer al aceptar el viaje): aparecía un mapa ENORME y vacío — la mototaxi en la orilla, el punto de recogida apenas visible y sin ruta. Causa raíz: `renderLiveMap` encuadraba los TRES puntos a la vez (recogida + destino + chofer) con `fitPoints`, así que con un recorrido de 2.7 km el zoom se alejaba a todo el trayecto y la ruta (chofer → recogida, un tramo corto) quedaba invisible. Arreglo (igual que la app real, que sigue al vehículo con el punto objetivo adelante y no encuadra todo el recorrido): el encuadre del chofer es POR ETAPA — antes de iniciar, SOLO chofer + punto de recogida (la ruta azul hacia él); una vez iniciado el viaje, chofer + destino (la ruta hacia donde van a llegar). Sin GPS del chofer aún, se centra el punto objetivo a zoom de calle. El lado pasajero no cambia (ya centraba la recogida a zoom 16). Tiras, botones de etapa, "Cómo llegar" y tarjeta inferior sin cambios.
- Extra en la misma pantalla (el usuario marcó la píldora verde enorme): el marcador de recogida era una píldora gigante porque `.pass-pin` no envolvía el texto (`white-space:nowrap` sin tope de ancho) — con "Josue Eduardo · Punto en el mapa" ocupaba casi todo el ancho del mapa. Ahora es compacto como el letrero de la app real: máximo 200 px, texto envuelto y centrado, 12 px, radio 16 px (mismo cambio para la etiqueta "Destino · …").
- Verificado en navegador real (Chrome headless) con el flujo completo: paso de detalles con los dos puntos (filas en una línea, Cambiar compacto) y mapa en vivo del chofer en etapa Confirmado (recogida + chofer encuadrados, zoom cerrado) y tras iniciar el viaje (destino + ruta).

## v1.4.14 (2026-11-22) — banner de viaje activo en Inicio: el mapa en vivo ya no se pierde

- El usuario (chofer, 19:03 CST) aceptó un viaje, el mapa en vivo se le desapareció y no lo encontraba por ningún lado: su Inicio de chofer solo mostraba la entrada "Servicio en curso · ver el mapa" (1 en total · 1 en curso). Causa raíz: tras aceptar, el mapa en vivo solo vive en memoria (`liveReq`); al salir de la vista (Regresar o la barra Inicio/Taxímetro/Recibir Viajes) o al recargar, se pierde, y la única vuelta era abrir "Mis viajes confirmados" y tocar el botón de adentro — dos toques escondidos, sin ningún aviso arriba. La entrada en sí funciona (el dato sí viene del servidor), pero no se ve.
- Arreglo (igual a la app real, que muestra el aviso verde con "Ver mi viaje en curso" arriba del Inicio de chofer): banner verde oscuro (#14532d) ARRIBA de todo en el Inicio de chofer — "¡El pasajero confirmó tu viaje!" + origen → destino · pasajero · $precio · ya puedes empezar el servicio + botón ámbar "Ver mi viaje en curso" que abre el mapa en vivo (para mandado: "¡El pasajero confirmó tu mandado!" / "Ver mi mandado en curso") + X para cerrarlo. Se pinta desde el servidor en cada visita al inicio (`driverCounts()`), así que sobrevive a salir del mapa y a recargar; la X solo lo oculta en esa sesión. La entrada "Servicio en curso · ver el mapa" sigue funcionando igual.
- Lo mismo del lado pasajero: banner verde en el Inicio — "¡Tu viaje fue aceptado! Tu mototaxi viene en camino" + origen → destino · con chofer · $precio + botón ámbar "Ver mi viaje en curso" que abre el mapa en vivo (mandado igual con su texto) + X. En Viajes el viaje aceptado ya se reabría solo en el mapa en vivo al entrar (`renderViajes` hace `goLive` con el activo); eso se conserva y se verifica. El banner solo aparece con viaje aceptado y desaparece al terminar/cancelar. Tarifa, taxímetro, destino, anuncio y pie de versión sin cambios. Verificado en navegador real (Chrome headless) con el flujo completo: publicar → aceptar → salir del mapa → el banner aparece en Inicio → al tocarlo vuelve el mismo mapa en vivo; tras recargar, el banner vuelve a aparecer; del lado pasajero igual en Inicio y reabriendo Viajes.

## v1.4.13 (2026-11-22) — el paso de destino "¿A dónde vas?" igual que en la app real + el anuncio con la geometría exacta de la app

- El usuario pidió un viaje en la web (18:36 CST) y mandó dos capturas del paso "¿A dónde vas?": la web salía "todo feo" y debía verse como en la app. En la web, el chip verde del origen ("Sales de: …") se aplastaba en una tirita vertical de una letra por línea y no había botón "Regresar". Causa raíz: la regla `.strip button{width:100%}` hacía que el botón "Cambiar" ocupara toda la fila y el chip (flex:1, base 0) se encogiera a su mínimo. Arreglo (solo ese paso, sin tocar el flujo ni la lógica): la fila superior ahora es como en la app — píldora "‹ Regresar" (misma acción que en la app: volver al paso de origen) + píldora verde de origen con el texto truncado con ellipsis y el botón "Cambiar" compacto DENTRO de la píldora — y la tarjeta de búsqueda va aparte y compacta (borde verde 2 px en el input, como en la app). Las tiras superior e inferior son transparentes (nueva clase `.pickdest`): los elementos flotan sueltos sobre el mapa en vez de ir dentro de una tarjeta blanca grande. El mapa queda visible con "Estás aquí" y abajo van la píldora de pista + "Confirmar este destino", como en la app.
- El usuario también marcó el anuncio en rojo (18:39 CST): en la app está súper bien y la web debe verse así. La v1.4.12 lo había dejado ceñido a la imagen (56dvh, ~266 px de ancho); ahora la web copia la geometría exacta del `EntryAdOverlay` actual de la app real: tarjeta `max-width:340px`, radio 24 px, sin borde, imagen `width:100%` a su proporción natural (sin tope de alto). El pie (PUBLICIDAD + nombre + "Ver negocio"), la X y la lógica (preload, sorteo, cierre instantáneo) no cambian. Verificado en navegador real (Chrome headless) con el paso de destino y con un anuncio vinculado, comparando contra las capturas de la app.

## v1.4.12 (2026-11-22) — el anuncio flotante de entrada va SIN marco: solo la imagen

- El usuario mandó dos capturas 6:15 CST del anuncio flotante y pidió: "Arregla esto de los anuncios para que aparezca ver el negocio y quita el Marco y que aparezca sola imagen sin un Marco adicional". En las capturas se veían dos cosas: (1) el marco ámbar de 2 px de `.adfloat` y (2) franjas blancas a los lados de la imagen — la imagen es vertical (9:16) y con `width:100%` + `max-height:62dvh` + `object-fit:contain` quedaba encogida dentro de la tarjeta de 400 px.
- Arreglo (solo CSS del flotante, sin tocar la lógica de anuncios): `.adfloat` sin borde ni radio (`border:0; border-radius:0`) y con `width:max-content; max-width:min(92vw,400px)` — la tarjeta se ciñe al ancho de la imagen renderizada; la imagen con `width:auto; max-width:100%; max-height:56dvh` (fondo blanco), así toca los bordes izquierdo y derecho de la tarjeta sin franjas. La imagen va un poco más chica que el tamaño completo (56dvh en vez de 62dvh, agregado del usuario), sin marco ni franjas. El pie (PUBLICIDAD + nombre + botón verde "Ver negocio"), la X grande, el cierre al tocar fuera, el preload y el sorteo al azar no cambian. Verificado en navegador real (Chrome headless) con un anuncio vinculado: la imagen toca los bordes laterales de la tarjeta, sin borde ámbar, y el pie muestra nombre + "Ver negocio".
- El botón "Ver negocio" que faltaba en la segunda captura NO era un bug de render ni una carrera: era el anuncio LIBRE (misma imagen del combo, sin negocio vinculado). El servidor resuelve `business_id` y `business_name` en el mismo payload de `/api/entry-ad` (`adWithBusiness`), así que un anuncio vinculado nunca llega sin nombre ni botón; el libre, por diseño, muestra solo "Publicidad". El anuncio libre se arregla vinculándolo a Pizzería Santa Fe en el panel de admin (no es cambio de código).

## v1.4.11 (2026-11-22) — el bearing del giro es +rumbo en MapLibre (el signo estaba al revés) + pie de versión en inicio

- El usuario probó la 1.4.10 y dijo "Nada sigue igual" (el taxímetro seguía con la línea al lado), y pidió: "Por qué no checas la configuración que tiene la aplicación y esa misma se la pasas". La app real gira su mapa con CSS (`RotatedBase` en `MapView.tsx`: `transform: rotate(bearing)` con `bearing = -rumbo`); la web gira con el bearing nativo de MapLibre (`easeTo({bearing})`).
- Prueba decisiva en navegador real (Chrome headless del sandbox, MapLibre 4.7.1, mismo estilo y opciones de `makeMap`, simulación del taxímetro con la cadena de seguimiento verbatim): el bearing nativo SÍ gira el mapa (jumpTo/easeTo con bearing cambian `getBearing()` y la proyección), pero con el signo OPUESTO al `rotate()` de CSS: con bearing -90 el este queda ABAJO en pantalla, con bearing +90 queda ARRIBA (números de `project()` del punto 60 m al este; el fuente de MapLibre lo confirma: `bearing() = -angle/π*180`). El signo viejo (`newBearing = -rumbo`, desde v1.4.4) dejaba la moto hacia abajo o de lado aunque el rumbo ya fuera estable — y los tests viejos afirmaban ese signo malo (bearing -180° para ir al sur), por eso pasaban 248/248 mientras el usuario lo veía mal.
- Arreglo (solo el signo, en el taxímetro y en el viaje en vivo): `newBearing = taxiLastHeading` y `applyHeading` devuelve `liveLastHeading` (sin el menos). Referencia estable >4 m, `taxiBearingDeg`, suavizado, un solo `easeTo`, diseño compacto, ícono, anuncios y tarifa sin cambios; `coords.heading` sigue prohibida. El giro con GPS real no se puede verificar sin un teléfono en movimiento: hay que probarlo andando en la mototaxi — la línea azul debe quedar siempre abajo.
- Pie de versión en inicio (petición del usuario, captura 5:44 CST): debajo del enlace "Mi cuenta" sale "Versión 1.4.11" en texto pequeño y discreto, de la única constante `APP_VERSION` del cliente; el test compara el pie con `/api/health` para que coincidan al subir de versión. Solo en inicio, nada más cambia de diseño.

## v1.4.10 (2026-11-22) — el anuncio flotante de entrada va a sangre, como en la app real

- El usuario mandó dos capturas 5:24 CST de la web y pidió: "También arregla esto de los anuncios, en la app se ve bonito". Diferencia visible: en la web la imagen del anuncio quedaba metida dentro de un marco blanco de 12 px (la tarjeta `.adfloat` llevaba `padding:12px` y la imagen `border-radius:12px`), mientras en la app real (`App.tsx`, `EntryAdOverlay`) la imagen va A SANGRE, pegada a los bordes de la tarjeta (`max-h-[62dvh] w-full object-contain bg-black/5`, sin radio propio — las esquinas las recorta la tarjeta) y solo el bloque de abajo lleva `p-4` con "Publicidad", el nombre del negocio y el botón verde "Ver negocio".
- Arreglo (solo CSS del flotante, sin tocar la lógica de anuncios): `.adfloat` sin padding, con `max-height:85dvh; overflow-y:auto` (como la app real); `.adfloat img` sin `border-radius`, fondo `rgba(0,0,0,.05)` (el `bg-black/5` de la app real), `max-height:62dvh; object-fit:contain`; `.adfoot` con `padding:16px` (el `p-4`) y sin `margin-top`; `.adx` en `top:12px; right:12px` (el `right-3 top-3`) sobre la esquina de la imagen a sangre. Precarga, sorteo al azar, cierre instantáneo con la X, "Ver negocio" y anuncios libres sin cambios.

## v1.4.9 (2026-11-22) — el giro usa la referencia estable de la app real: la línea azul siempre abajo

- El usuario seguía viendo la línea azul AL LADO de la mototaxi (capturas 5:17/5:18: la línea va a la derecha, la moto apunta arriba pero viaja de lado) y exigió, con razón: "en la app real funciona muy bien, no sé por qué aquí no lo puedes hacer" — la línea azul SIEMPRE debe quedar ABAJO de la mototaxi. Su video de 41 s de la app real andando lo confirma: la mototaxi queda clavada apuntando SIEMPRE hacia arriba en el centro, el mapa va girando debajo para acomodarse (incluso cuando la calle hace curva), y la línea azul queda SIEMPRE abajo, recta detrás de ella.
- Causa raíz: la web movía su referencia de rumbo en CADA lectura GPS (~1 Hz). Con lecturas de ~1 Hz el rumbo salía de dos puntos de ~5 m con ruido de GPS de varios metros, así que el rumbo saltaba y el mapa nunca quedaba derecho. La app real (`MapView.tsx`, modo `followVehicle`) guarda una referencia (`lastVehiclePosRef`) que SOLO se actualiza cuando el mototaxi avanzó MÁS DE ~4 m desde ella (`distMeters(prevPos, vehicle) > 4`) y solo entonces calcula el rumbo con `bearingDeg` (círculo máximo); el marcador queda clavado en el centro y es el mapa el que se acomoda debajo; el bearing de la cámara es `-rumbo`, suavizado cuadro a cuadro por el camino más corto (constante ~500 ms).
- Arreglo: la web replica ese método exacto en el taxímetro (`startTaxiWatch`): referencia estable `taxiHeadingRef` que solo avanza con >4 m de movimiento real, rumbo con `taxiBearingDeg` (la misma fórmula de círculo máximo de la app real), suavizado 0.7 por lectura por el camino más corto, bearing = -rumbo, un solo `easeTo` por lectura (centro + giro + padding) y marcador centrado en la franja libre con el padding medido del DOM. Se quitó la puerta de velocidad (la app real tampoco la tiene: la referencia de >4 m ya filtra el temblor parado). El viaje en vivo NO se tocó: su rumbo ya venía de desplazamientos entre ticks del polling. Sin cambios de tarifa, conteo de km/espera, umbral de 4 m solo-para-cobrar, diseño compacto de v1.4.7, ícono ni brújula (sigue prohibida: cero referencias a `coords.heading` en el cliente). El servidor sirve `index.html` también para `/?v=1.4.9` (la ruta `/` ignora el query y se sirve sin caché), para mandar el link con versión y forzar carga fresca en el teléfono. El giro con GPS real no se puede verificar sin un teléfono en movimiento: hay que probarlo andando en la mototaxi.

## v1.4.8 (2026-11-22) — el giro ya no usa la brújula del teléfono: la moto iba hacia abajo

- El giro estaba al revés 180° (captura del usuario 4:56: la línea azul del recorrido venía desde arriba hasta la mototaxi, o sea que viajaba hacia abajo en la pantalla, mientras el ícono apunta hacia arriba; "Debería ser al revés"). Causa raíz: el rumbo prefería la brújula del teléfono cuando traía un valor válido, pero ese dato es hacia dónde apunta el aparato, NO la dirección del viaje — en la mototaxi el teléfono va en el bolsillo o en el tablero mirando al chofer, así que apunta al revés del viaje. Arreglo: el rumbo del taxímetro es SIEMPRE el del desplazamiento entre lecturas consecutivas (≥ 2 m), que es la verdadera dirección del viaje; la brújula del teléfono no se lee nunca para el giro (no queda ninguna referencia a ella en el cliente). `coords.speed` se sigue usando para la velocidad mostrada, con el respaldo por desplazamiento que ya existía. Sin cambios de tarifa, conteo, umbral de 4 m, diseño compacto de v1.4.7, ícono ni viaje en vivo (su `applyHeading` ya usaba desplazamiento). El giro con GPS real no se puede verificar sin un teléfono en movimiento: hay que probarlo andando en la mototaxi.

## v1.4.7 (2026-11-22) — taxímetro compacto, mismo ícono, giro que sí gira y chofer que sí entra en línea

- Rediseño compacto del taxímetro corriendo, igual que la app real (capturas del usuario: app real 4:35 vs web 4:34/4:37): (1) EL MISMO ícono de la app real (`MototaxiTopIcon` del artefacto `sanfergo-app`, copiado tal cual: mototaxi amarilla vista desde arriba con rueda delantera, manubrio con espejos, faro, carenado, casco del chofer, parabrisas y techo ámbar con dos ruedas traseras, 46×62 px) en el marcador del taxímetro Y en el del chofer del viaje en vivo (usan el mismo `motoIconEl()`); (2) "Precio final" como píldora flotante compacta y centrada (~60% de ancho, `width:max-content`), no tarjeta a todo lo ancho; (3) abajo UNA sola tarjeta oscura compacta con "Tiempo de viaje" y "Kilómetros" a la izquierda y FINALIZAR a la derecha, TODO EN UNA SOLA FILA (`.taxifinal` flex), no filas apiladas con botón a todo lo ancho; (4) se quita la píldora "Plan gratis · N de 50 recorridos" del taxímetro corriendo (la app real no la muestra ahí; se queda en la pantalla de INICIO del taxímetro y en el aviso de límite alcanzado); (5) se oculta el botón de la brújula corriendo (la app real no lo muestra ahí); el círculo negro de velocidad se queda igual.
- El giro SEGUÍA sin funcionar en v1.4.6 (captura 4:41: mapa en norte-arriba, mototaxi de lado): todo el cálculo del rumbo estaba dentro de `if(speedKmh >= 5)` y `speedKmh` venía de `pos.coords.speed`, que en el iPhone llega null andando → `newBearing` quedaba null siempre. Ahora la velocidad y el rumbo se calculan del desplazamiento entre lecturas consecutivas (`lastFix`: distancia/tiempo, con piso de ruido de 2.5 m; rumbo del desplazamiento ≥ 2 m) cuando el GPS no los trae; `coords.speed`/`coords.heading` solo mandan si traen un valor válido. Sin cambios de tarifa, conteo de km/espera ni umbral de 4 m solo-para-cobrar; el resto de v1.4.6 se queda (un solo easeTo, suavizado 0.7, guarda de 2 m).
- La etiqueta "Inicio del recorrido" quedaba medio tapada por el círculo de velocidad cuando el punto de inicio caía cerca del borde derecho ("Inicio del recor..."). Ahora `adjustTaxiStartOffset()` la corre a la izquierda lo justo para que su borde derecho quede libre del círculo, recalculado en cada lectura del GPS y con cada movimiento del mapa; el offset base de 34 px hacia abajo se queda.
- El chofer no podía ponerse en línea (capturas 4:20 admin y 4:42 chofer): su perfil decía "pendiente de aprobación" aunque el admin ya lo había aprobado y la lista de solicitudes estaba vacía. Causa raíz: `renderDriverHome()` revisaba `d.status === 'activo'` (valor de NEGOCIOS), pero los choferes usan `'pendiente'`/`'aprobado'` en el servidor — la condición nunca era verdadera, el botón quedaba deshabilitado siempre. NO era un problema de datos: la fila del chofer ya estaba en `'aprobado'` en el servidor. Arreglo: la condición ahora revisa `'aprobado'`; el estado del chofer se vuelve a pedir al servidor al abrir su inicio (`refreshMyDriver()`) y al tocar "Ponerme en línea" (`toggleOnline()` refresca antes de intentar); y aprobar en el admin activa también cualquier otra fila pendiente con el mismo teléfono, por si hubiera un registro duplicado. El flujo aprobar → en línea ya estaba probado en los tests de API y sigue pasando.
- El padding de seguimiento se sigue midiendo desde el DOM, así que se adapta al diseño compacto y la mototaxi queda centrada en la franja libre, que ahora es más grande; los valores por defecto bajaron de 170/280 a 150/220. Sin cambios de tarifa, conteo, límites (50), tarjeta Tiempo/Distancia/Espera ni barra inferior. El giro con GPS real no se puede verificar sin un teléfono en movimiento: hay que probarlo andando en la mototaxi.

## v1.4.6 (2026-11-22) — el giro del taxímetro ya gira de verdad (un solo easeTo)

- Causa raíz del video del usuario (45 s andando, 0 a 19 km/h, el mapa no giró nunca y la calle quedó diagonal): en `startTaxiWatch()` había DOS `easeTo` seguidos en el mismo callback — primero el del giro (`bearing: -taxiLastHeading, duration: 300`) y enseguida el del centrado (`taxiFollowCenter` → `taxiCenterOn`, `duration: 600`). En MapLibre cada `easeTo` cancela la animación anterior, así que el giro se cancelaba antes de pintar un cuadro y el mapa quedaba siempre en norte-arriba. El mismo patrón existía en el viaje en vivo (`applyHeading` + el centrado del polling cada 5 s). Ahora NUNCA hay dos `easeTo` seguidos para el mismo mapa en el mismo tick: en el taxímetro `taxiFollowCenter()` acepta el bearing y hace UN SOLO `easeTo` con centro + giro + padding (si no se recentra — seguimiento apagado o guarda de 2 m — el giro va solo en su propio `easeTo`); en el viaje en vivo `applyHeading()` ya no anima, solo devuelve el rumbo suavizado, y el polling hace UNA sola llamada con centro + bearing + padding. La guarda de 2 m, `coords.heading`, el suavizado 0.7 y el umbral de 4 m solo-para-tarifa de v1.4.5 se quedan como están.
- Dato del video: al inicio del recorrido las píldoras "Vas aquí" (verde) e "Inicio del recorrido" (blanca) se encimaban porque el punto de inicio y la mototaxi están casi en el mismo lugar. La etiqueta "Inicio del recorrido" ahora va 34 px hacia abajo del punto (offset del marcador) para no tapar nunca la píldora de la mototaxi.
- Sin cambios de tarifa, conteo, límites (50), diseño de tarjetas ni etiquetas del mapa. El giro con GPS real no se puede verificar sin un teléfono en movimiento: hay que probarlo andando en la mototaxi.

## v1.4.5 (2026-11-22) — el taxímetro gira derecho y el mapa queda libre

- Causa: todo el movimiento del mapa (marcador, centrado y giro heading-up) estaba dentro del `if(d >= 0.004)` de la tarifa. A 12 km/h (~3.3 m/s) casi todos los pasos GPS quedan por debajo de 4 m y se rechazaban, así que el mapa solo se movía en los saltos ocasionales, con rumbo de puntos saltados y ruidosos — por eso el camino se veía de lado en vez de recto hacia arriba. Ahora el marcador, el centrado y el giro se actualizan en CADA lectura GPS aceptada (accuracy ≤ 150 m); el umbral de 4 m queda solo para sumar km a la tarifa y agregar puntos a la ruta. Sin cambios de tarifa ni de conteo de km/espera.
- Rumbo más reactivo: se usa `pos.coords.heading` del GPS cuando viene (iOS lo da andando) y velocidad ≥ 5 km/h; si no viene, se calcula de los puntos con ≥ 2 m de desplazamiento. Suavizado de 0.5 a 0.7 y duración del giro de 500 a 300 ms, para que el camino quede recto hacia arriba. El signo del bearing se verificó: bearing = -heading. Lo mismo (0.7 / 300 ms) en el giro del viaje en vivo (`applyHeading`).
- Mapa despejado: en el taxímetro y en el viaje en vivo se ocultan las capas de símbolos de puntos de interés del estilo vectorial (los nombres de negocios); se quedan los nombres de calles. Además se achicaron los controles: círculo de velocidad 76→62 px, botones de zoom/brújula 42→36 px, píldoras "Vas aquí" e "Inicio del recorrido" de 12 a 11 px. Las tarjetas (Tiempo/Distancia/Espera, Precio final, Tiempo/Kilómetros + FINALIZAR) no se tocaron. El giro con GPS real no se puede verificar sin un teléfono en movimiento: hay que probarlo andando en la mototaxi.

## v1.4.4 (2026-11-22) — seguimiento del taxímetro: la mototaxi ya no se pierde

- Causa: los handlers de `dragstart`/`zoomstart`/`rotatestart` apagaban el seguimiento con cualquier evento, y el propio giro heading-up (`easeTo` con bearing) dispara `rotatestart` aunque sea programático: al primer cambio de rumbo el seguimiento se apagaba solo y aparecía "Centrar en mi ubicación". Ahora los handlers solo apagan el seguimiento cuando el evento trae `e.originalEvent` (gesto real del usuario); el giro, el zoom +/- y la brújula ya no lo apagan. Lo mismo se corrigió en el mapa del viaje en vivo.
- La mototaxi ya no queda en el centro geográfico del mapa (tapada por Precio final / Tiempo / FINALIZAR): el centrado en seguimiento usa `padding` medido desde el DOM (alturas reales de las tarjetas de arriba y de abajo), así la mototaxi queda en la franja libre entre ellas. El giro heading-up no cambia.
- Al reabrir el taxímetro con un recorrido en curso, el seguimiento se reanuda solo (`taxiFollow = true`).
- Sin cambios de tarifa, conteo de km/espera, límites (50) ni diseño de tarjetas. El seguimiento con GPS real no se puede verificar sin un teléfono en movimiento: hay que probarlo en el teléfono del usuario.

## v1.4.3 (2026-11-22) — borrar historial del taxímetro y límites gratis a 50 para pruebas

- En "Historial del taxímetro" hay un botón "Borrar todo el historial" con confirmación en dos pasos en línea (primer toque: "¿Seguro? Toca de nuevo para borrar"; segundo toque: borra). El historial vive solo en el teléfono (localStorage), así que al borrarlo el conteo diario de hoy vuelve a 0 y el chofer puede iniciar recorridos de nuevo sin esperar al día siguiente. Nada del servidor se toca.
- En la tarjeta de límite del taxímetro ("Has completado tus recorridos gratis") hay un enlace "Borrar mi historial del taxímetro" que abre el historial para llegar al botón sin buscarlo.
- Límites gratis a 50 por día PARA PRUEBAS: taxímetro (50 recorridos/día, antes 5) y servicios (50 viajes/mandados al día, antes 5). La constante `FREE_DAILY_LIMIT` es 50 en servidor y cliente; todos los textos ("de 50 recorridos", "de 50 servicios hoy") usan la constante. Sin cambios de tarifa ni de la lógica de conteo.

## v1.4.2 (2026-11-22) — index.html y manifest sin caché

- `index.html` y `manifest.webmanifest` se sirven con `Cache-Control: no-cache`: el teléfono revalida siempre y baja la versión nueva tras cada despliegue. Antes los teléfonos seguían mostrando el index.html viejo (p. ej. el taxímetro viejo con tarjetas blancas y botón Volver) aunque `/api/health` ya devolvía la versión nueva. Los demás archivos estáticos siguen con caché normal. Sin cambios de diseño, lógica, tarifa ni rutas.

## v1.4.1 (2026-11-22) — taxímetro igual que la app real

- Inicio del taxímetro: píldora oscura del plan (gratis o Premium), mototaxi centrada en el mapa con la píldora verde "Estás aquí", controles de zoom (+/−/brújula) arriba a la derecha y tarjeta oscura con el texto del aproximado + botón ámbar "INICIAR" a la derecha. Sin línea de tarifa ni botón "Volver": la salida es la barra inferior Inicio / Taxímetro / Recibir Viajes.
- Taxímetro corriendo: tarjeta oscura arriba con Tiempo (barra + "N seg"), Distancia (barra + "N m") y Espera ("Detenido HH:MM:SS · +$X.XX" o "En movimiento"); mototaxi en el centro del mapa con la píldora verde "Vas aquí" y la etiqueta "Inicio del recorrido" en el punto de partida; círculo negro con la velocidad ("17 Km/h"); tarjeta oscura de "Precio final $X.XX" exacto; tarjeta oscura abajo con "Tiempo de viaje HH:MM:SS", "Kilómetros" y botón ámbar "FINALIZAR". El mapa sigue a la mototaxi y gira con su rumbo (heading-up) como en la app real; al mover el mapa aparece el botón oscuro para volver a la vista de seguimiento. La píldora oscura del plan sigue visible mientras corre.
- Sin cambios de lógica: la tarifa ($10 base + $2.50 cada 300 m, espera $1.25/min, mínimo $20), el conteo de distancia/tiempo/espera, la velocidad y el precio final se calculan exactamente como antes; solo cambia la presentación. Al volver a entrar al taxímetro con un recorrido en curso se restaura la etiqueta de inicio y la línea de ruta.

## v1.4.0 (2026-11-22) — revisión completa contra la app real (v104)

- Mapa: estilo vectorial de Meta "canterbury_1_0" como principal (con respaldo OSM/Esri); registro completo de lugares de la app real (12 lugares + 30 negocios + extras de la web); zonas con las coordenadas reales (21 zonas); rótulos con punto verde/ámbar y estilo de la app real; atribución "© OpenStreetMap" visible; controles redondos propios en los mapas de marcar punto (sin NavigationControl); buscador solo entre las 21 zonas.
- Login, inicio, registro de pasajero y Mi cuenta como en la app real (encabezado verde, botón ámbar "Crear cuenta nueva", aviso de Google en la misma tarjeta, reclamar con confirmar contraseña, duplicado con sus dos botones, inicio con 3 tarjetas blancas + tarjeta verde oscuro del chofer, sin "¿Primera vez?" ni marca de agua).
- Viajes: "Pides como…" con formulario en la misma pantalla si no hay perfil; "Tu último viaje" con repetir el último FINALIZADO; origen sin GPS sin buscador; destino con píldora verde + buscador en línea; detalles y precio a pantalla completa con ruta, pastilla y hoja inferior (stepper de $5, pago con dos botones, botón ámbar "Pedir viaje"); buscando con caja ámbar, botones +$10/+$20 y "Cancelar viaje" como texto; carrusel de ofertas solo con puntos; viaje en vivo con títulos en frase completa, aviso verde oscuro #14532d (sin aviso al llegar), tarjeta del chofer con "Precio final" y "Cambiar" pago; historial solo de viajes.
- Mandados: entrada con subtítulo y botones de 96 px; "Enviar" y "Quiero" en 5 pasos con "Paso N de 5", selector de vehículo, buscadores en línea, pegar ubicación de WhatsApp en línea, entrega solo con "Marcar mi punto" (mapa sin buscador, botón deshabilitado sin punto) y precio a pantalla completa; "Enviar" manda `vehicle`; buscando de mandados igual que el de viajes.
- Negocios: principal con 3 botones (72 px), filtro por categoría y tarjetas con foto alta y chips; crear en un solo formulario con la pregunta de tipo primero y ficha completa (categoría, colonia, horario, envío); ficha de entrega con carrito (envío configurado del negocio), formulario de pedido y éxito; catálogo con "Preguntar por WhatsApp" por ítem; citas con formulario (fecha + select de hora 9:00–19:30) y éxito; "Administrar negocio" con tarjeta Premium arriba y panel del dueño en pestañas (Pedidos, Productos/Citas, Servicios, Mi negocio, Estadísticas, Premium); ciclo de vida completo de pedidos; "Ver mi pedido"/"Ver mi cita" por teléfono sin sesión; Paquete Premium con flujo en 2 pasos ("Ya hice la transferencia · Activar").
- Chofer: registro con dos botones de vehículo, unidad obligatoria y caja ámbar si faltan fotos; inicio con línea de vehículo correcta (moto/mototaxi), caja ámbar de pendiente, botón en línea deshabilitado con motivo y entradas con subtítulos; taxímetro con píldora de conteo también en premium y aviso de límite en línea (sin modal); Recibir Viajes con pestañas En curso/Solicitudes, lista visible fuera de línea, caja de límite gratis, contraoferta en línea y avisos de mayor tarifa; viaje activo con píldora verde #14532d, nombre del pasajero solo en viajes y botones de mandado corregidos ("Voy por el encargo" → "Ya lo entregué"); suscripción con 3 botones y confirmación en 2 pasos por transferencia (plan semanal/mensual/anual bien cableado al servidor).
- Admin: tarjeta del admin con inicial y píldora roja, aviso ámbar solo con pendientes, retícula de 7 tarjetas uniformes con ícono y ayuda (sin marca de sección abierta); cada opción abre su propia pantalla con "Regresar al panel de administrador" + H1; solicitudes de choferes con foto del vehículo grande, sin botón de rechazar y con paginador; ficha del chofer con fotos 112×112, bloque SUSCRIPCIÓN completo y bloqueo/eliminación en dos pasos en línea; anuncios con botones "Anuncio libre"/"De un negocio", pista de imagen y casillas con texto completo.
- Servidor: etapas de mandado como la app real (confirmado → en_camino → llego → recogido → en_viaje → entregado, sin `a_recoger`); pago cambiable mientras el viaje está confirmado (antes de salir); unidad obligatoria; campos de negocio (categoría, colonia, horario, envío, vistas) y de producto/servicio (disponibilidad, descripción); pedidos con zona/dirección/pago/nota y envío del negocio; pedidos y citas por teléfono; ciclo de estados de pedido completo; estadísticas Premium con views y conteos del mes.
- Pendiente anotado: 8 nombres del mapa base de Meta no se pudieron verificar en Nominatim (De Moda BreJan, Restaurante La Dona, Studio Gv, Impresiones El Gansito, Prendamex San Fernando, vital farmacias, Óptica JADE, Instituto Juan) y se dejaron fuera sin inventar coordenadas.

## v1.3.9 (2026-11-22) — confirmación del pin igual que la app real
- Tras "Usar ubicación actual" la pantalla de confirmar el punto es como en la app real: píldora Regresar blanca, tarjeta de instrucciones ("Confirma o fija tu punto de salida"), pin naranja arrastrable con píldora verde "Tu punto de salida", píldora azul "Estás aquí" sobre el GPS, píldora "Punto marcado · cerca de <zona>" (zona más cercana, se actualiza al mover el pin) y botón grande ámbar "Confirmar este punto de salida". Sin buscador en esta pantalla; el buscador se queda solo en "Ubicar un punto en el mapa", destino y mandados. El flujo no cambia.

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
