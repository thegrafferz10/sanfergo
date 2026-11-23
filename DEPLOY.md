# Cómo poner SanFerGo en internet (enlace público)

La app está lista en `~/workspace/sanfergo-public/`. Para que cualquiera
la abra con un enlace hace falta un host con Node.js y disco persistente.
**No se puede publicar desde aquí sin crear una cuenta**: todos los hosts
gratuitos piden registrarse. Los pasos los hace el usuario (o Muse con él)
en unos 10 minutos, sin pagar nada.

## Opción recomendada: Render (gratis)

1. Entrar a https://render.com y crear una cuenta (con correo o Google).
2. Subir este proyecto a GitHub (o usar «Deploy from a public repo»):
   - Crear un repositorio nuevo en GitHub y subir la carpeta
     `sanfergo-public` (archivos `server.js`, `package.json`, `public/`,
     `README.md`).
3. En Render: **New → Web Service → Build and deploy from a Git repo**,
   elegir el repositorio.
4. Configuración:
   - **Runtime:** Node
   - **Build Command:** (vacío, no hay dependencias)
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
   - **Environment Variables:** `DATA_DIR` = `/var/data` (ver paso 5)
5. Disco persistente (para que los registros y viajes no se borren):
   - En el servicio: **Disks → Add Disk**, nombre `sanfergo-data`,
     **Mount Path:** `/var/data`, tamaño 1 GB (gratis en el plan Free).
   - Sin este disco, cada vez que Render reinicie el servicio se borra
     la base de datos. Con el disco, los datos sobreviven.
6. **Deploy.** Render da una URL pública como
   `https://sanfergo.onrender.com`. Esa es la liga que se comparte con
   los choferes y pasajeros: la abren en el teléfono y la agregan a su
   pantalla de inicio (la app ya trae manifiesto PWA).

Notas:
- El plan Free de Render «duerme» el servicio si nadie lo usa por un
  rato; la primera visita tarda ~30-60 segundos en despertar. Los datos
  no se pierden (están en el disco).
- Para cambiar de servidor después, basta copiar el archivo
  `data/sanfergo.db` (o `/var/data/sanfergo.db` en Render).

## Otras opciones (también gratis, también piden cuenta)

- **Railway** (railway.app): New Project → Deploy from GitHub. Añadir
  un volumen persistente y poner `DATA_DIR` a la ruta del volumen.
  El plan gratis es por uso (trial con crédito).
- **Fly.io** (fly.io): `fly launch`, `fly volumes create`, con
  `DATA_DIR` apuntando al volumen. Pide tarjeta solo para verificar la
  cuenta (no cobra en el plan gratis).
- **Un VPS** (DigitalOcean, Hetzner, etc.): clonar el proyecto, correr
  `node server.js` con `systemd` o `pm2`, y abrir el puerto. Aquí sí hay
  costo mensual.

## Variables de entorno (v1.4.33)

Sin estas variables la app funciona igual que antes: el registro con
correo no pide código y el botón de Google muestra su aviso. Para activar
las dos cosas, en Railway (Variables del servicio):

- `RESEND_API_KEY`: llave de Resend (https://resend.com, plan gratis:
  100 correos al día) para mandar el código de 6 dígitos por correo.
- `RESEND_FROM`: remitente del correo, por ejemplo
  `SanFerGo <hola@sanfergo.app>` (el dominio debe estar verificado en
  Resend; si no se pone, usa `onboarding@resend.dev`, que solo manda al
  correo del dueño de la cuenta de Resend).
- `GOOGLE_CLIENT_ID`: ID de cliente OAuth de Google Cloud (consola de
  Google Cloud → Credenciales → ID de cliente OAuth → tipo "Aplicación
  web", con el origen autorizado
  `https://sanfergo-production.up.railway.app` y luego el dominio propio
  cuando se compre).

## Qué NO funciona como lanzamiento

- El enlace del prototipo viejo (solo datos locales por teléfono).
- Una página estática (GitHub Pages, Netlify estático): cada persona
  vería solo sus propios datos; los viajes no llegarían a los choferes.
- Túneles temporales (Cloudflare Tunnel, localtunnel, ngrok sin cuenta):
  desde esta máquina están bloqueados por el proxy de salida, y aunque
  funcionaran, la liga cambia cada vez que se reinicia.

## Pruebas en vivo desde la laptop del usuario (temporal)

Mientras se compra el alojamiento, el servidor puede correr en la laptop
del usuario (Windows 11) para probar en vivo con unos cuantos choferes:

1. En la laptop: instalar Node.js 22+, copiar esta carpeta, y correr
   `node server.js` (dejar la laptop prendida todo el día, sin que se
   duerma, y con internet).
2. Para que los teléfonos lleguen a la laptop: correr el túnel incluido
   en `bin/cloudflared` con `cloudflared tunnel --url localhost:3000`
   (gratis, sin tarjeta) y compartir la liga que muestra.
3. La base de datos arranca limpia: el usuario debe registrarse de nuevo
   con sus fotos (chofer con unidad Hg67h y pasajero), probar el flujo y
   luego registrar a Juan, Pedro y Daniel.

## Después de publicar

1. Abrir la liga en el teléfono y registrarse de nuevo (la app empieza
   limpia): el usuario como chofer (con su selfie y foto del mototaxi,
   unidad Hg67h) y como pasajero (con su foto de cara).
2. Probar: pedir un viaje, aceptarlo como chofer, avanzar las etapas.
3. Registrar a Juan, Pedro y Daniel con sus datos y fotos.
4. Compartir la liga por WhatsApp a los choferes y en los grupos de
   San Fernando.
