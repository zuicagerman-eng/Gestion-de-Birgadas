# SIGBE — Sistema de Gestión de Brigadas (versión 4.0.2)

Aplicación web de Google Apps Script para gestionar las brigadas de emergencia: asistencia a capacitaciones,
avance por persona, brigadistas, cronograma, cobertura, revisión de datos e historial de cambios. Es el
**gestor general**: lo que se hace en la app queda en las hojas y en el historial, y lo que alguien cambie
directamente en el Excel se detecta y se anota.

Es un **proyecto independiente de Apps Script** (no vive dentro de ninguna hoja).

## Archivos del proyecto

| Archivo | Qué es |
|---|---|
| [`SIGBE.gs`](SIGBE.gs) | Backend de la app: lectura de datos (con caché), asistencia, brigadistas, revisión de cambios del Excel, estado, configuración. |
| [`LibroNuevo.gs`](LibroNuevo.gs) | Libro nuevo consolidado (1.0 + lista de asistencia del 2.0), su corte y la tarea automática. |
| [`SincronizarBrigadas.gs`](SincronizarBrigadas.gs) | Utilidades compartidas: abrir archivos, copiar pestañas, respaldos, activador. |
| [`Index.html`](Index.html) | Pantallas y estilos (HTML). |
| [`App.html`](App.html) | Código de las pantallas (JavaScript, sin etiquetas `<script>`). `doGet` lo manda codificado dentro de `Index.html` para que nada lo altere en el camino. |
| [`appsscript.json`](appsscript.json) | Manifiesto: zona horaria, permisos y tipo de publicación. |

## De dónde lee y dónde guarda

| | Antes del corte | Después del corte |
|---|---|---|
| Lista de asistencia "2026 Brigadistas HOLCIM" | **2.0** | Libro nuevo |
| INHOUSE, cronograma, Indicador., temario, Seguimiento y demás | **1.0** | Libro nuevo |
| Historial ("Bitácora SIGBE") | Libro nuevo | Libro nuevo |

Antes del corte, lo que se guarda desde la app llega al libro nuevo ~1 minuto después. Si el 1.0 o el 2.0 dejan
de abrir, la app muestra la copia del libro nuevo **en solo lectura** y lo avisa (guardar ahí se perdería).

> En la versión 3 la app leía la pestaña HOLCIM **oculta** del 1.0 y "Sincronizar" copiaba esa pestaña encima de la
> del 2.0. Eso ya no existe: la lista de asistencia es la del 2.0 y nada la sobrescribe.

## Pantallas

- **Inicio**: brigadistas activos, cumplimiento, contratistas con certificado, cobertura frente a la meta, sesiones
  pasadas sin asistencia, próximas capacitaciones y resumen de la revisión.
- **Tomar asistencia**: sede → sesión (filtros: pasadas sin registrar, próximas, con asistencia, sin fecha, no aplican)
  → lista con buscador, planta, marcar todos, imprimir para firmar, CSV y deshacer.
- **Avance por planta**: planta × módulo con el % de brigadistas Holcim activos que asistieron entre los que ya debían
  tomarlo (la sesión aplica y su fecha pasó); "·" con la próxima fecha si aún no le toca y "—" si no aplica. Clic en un %
  abre esa lista de asistencia. Sin detalle por persona (eso está en la ficha de cada brigadista). CSV.
- **Menú** agrupado: Dashboard · *Brigada* (Cobertura, Brigadistas) · *Asistencia y capacitaciones* (Tomar asistencia,
  Avance por planta, Cronograma, Temarios, Otras hojas) · *Control* (Historial de cambios, Revisión de datos, Registro de
  ingresos) · *Sistema* (Estado del sistema, Configuración, Ayuda).
- **Brigadistas**: columnas Planta, Nombres y apellidos, Cédula, Grupo sanguíneo, Fecha de ingreso, Empresa,
  Brigadista Clase I, Estado y Fecha de retiro (solo si no está activo). Filtros por tipo, planta, estado, empresa y
  "datos por completar" (en **Planta** y **Empresa** se pueden marcar varias a la vez); lo que falta aparece como **Completar**. **Editar en la tabla** convierte las celdas en
  desplegables y fechas y guarda todo junto (con confirmación). Si la hoja no tiene la columna de un dato, la app la
  crea al final de los encabezados al guardar el primero. Ficha con sus sesiones y registro de personas nuevas.
  En la ficha, cada sesión tiene una casilla **Asistió**: se marcan o desmarcan varias (o **Marcar todas las ya
  realizadas**) y **Guardar asistencia** las guarda juntas en una sola llamada (con Deshacer). Las sesiones con fecha
  futura muestran **Aún no**. Si se cierra la ficha con cambios sin guardar, pregunta. Lo usan los tres tipos de usuario.
  Grupo sanguíneo: O+, O-, A+, A-, B+, B-, AB+, AB-. Clase I: la lista de la hoja si tiene desplegable; si no, Sí / No / En formación.
- **Cronograma**: próximas / pasadas / por definir / no aplican, filtros por mes, tema y estado; botón para abrir la asistencia.
  **Programar / Editar** cambia la fecha (Holcim), la fecha Ambipar, el estado, # brigadistas y observaciones de una planta,
  y puede pasar la fecha y el estado a otras plantas de la misma fila. "No aplica" pone `-`; desde **No aplican** se habilita.
  **Nuevo módulo** crea 4 columnas en la lista de asistencia (Sesión 1 y 2 con casilla, antes del cumplimiento) y su fila en
  el cronograma (en su mes, con prefijo de líneas si no es para todas) con la etiqueta `(M12)`, que es la que los une.
  También convierte en módulo un entrenamiento que ya está en el cronograma sin columnas (p. ej. Espacios confinados).
  **Programar / Agregar sesión** da otra sesión de un módulo en una planta (p. ej. una Sesión 2 o 3 del M7 en Teleport): si la planta
  ya tiene esa sesión con "-" en ese tema, la habilita; si no, agrega un bloque "Sesión N" de columnas junto a los de la
  planta en el cronograma (con "-" en los demás temas) y, si hace falta, las columnas `M7_Sesión_3` en la lista.
  Los módulos nuevos quedan con "-" en las sesiones extra que casi ningún tema usa.
- **Dashboard**: *Asistencia a las capacitaciones* (personal Holcim: asistencias registradas frente a las esperadas en
  los módulos ya dictados, brigadistas al día, contratistas con 0256, asistencia por sede) separada de *Cobertura de
  brigadistas* (Indicador frente a la meta del 20 %, con % por sede), más próximas capacitaciones y revisión de datos.
- **Cobertura**: una tarjeta por planta del *Indicador.* con % de la meta, brigadistas, requeridos y personal, y el
  detalle por empresa. **Brigadistas = los activos en las listas de la app** (lista de asistencia Holcim y contratistas
  registrados en la plataforma); del Indicador solo se toma el **personal** (meta = 20 %, redondeada hacia arriba). Cada
  brigadista va a la fila de su planta y empresa (Holcim → fila "Holcim…"; contratistas → la de su empresa); si su empresa
  no está en el Indicador se avisa. **Traer faltantes** (en Brigadistas) busca en otras pestañas del 1.0 y el 2.0 personas
  que no están en las listas, para registrarlas en la app. El Dashboard muestra la misma vista de Cobertura.
- **Sede** (arriba): se pueden elegir varias a la vez (o "solo" una); todas las vistas filtran por esas sedes.
- **Revisión de datos**: posibles errores con filtros por gravedad y tipo (ver abajo).
- **Historial de cambios**: lo hecho desde la app y lo detectado en el Excel, con filtros y CSV.
- **Temarios** y **Otras hojas** (Seguimiento, Datos de contacto, Evacuadores…): consulta con buscador y filtros.
- **Estado del sistema** (archivos, tarea, respaldos, diagnóstico, "Actualizar ahora") y **Configuración**.

## Entrada y tipos de usuario

Para ver cualquier dato hay que entrar con **usuario y clave** (no hay acceso público ni de consulta). Cada ingreso y
cada intento fallido quedan en la pestaña **"Ingresos SIGBE"** y se ven en **Registro de ingresos** (gestor y Holcim).

| Tipo | Qué puede hacer |
|---|---|
| **Gestor** (el usuario principal, `SIGBE_USUARIO`) | Todo, y es el único que crea, desactiva o elimina usuarios y cambia la configuración (archivos, tarea automática). |
| **Holcim** | Ve y cambia todo: asistencia, cronograma (fecha Holcim y Ambipar), módulos, sesiones, brigadistas, Indicador, traer faltantes. No administra usuarios ni la configuración. |
| **Ambipar (proveedor)** | Toma asistencia. En el cronograma pone la **Fecha Ambipar**, el estado, las observaciones y el # de brigadistas, **programa sesiones** (también habilita las que tienen "-") y **crea módulos**. No cambia la Fecha Holcim ni edita brigadistas o el Indicador. Su menú es lo mínimo: Dashboard (asistencia y próximas), Tomar asistencia, Avance por planta, Cronograma, Temarios, Ayuda y **Mi clave**; el servidor tampoco le entrega historial, otras hojas, estado del sistema, configuración ni usuarios. |

El gestor crea los usuarios en **Configuración → Usuarios** (usuario, nombre, correo, tipo, sedes y una clave temporal
generada), les pone una clave nueva, los desactiva o los elimina. **La clave temporal le llega al usuario por correo**
(al crearlo y con *Nueva clave*); no queda guardada en ningún lado ni en el historial. Si no tiene correo o el envío
falla, la app se la muestra al gestor una sola vez para que se la pase en privado. Quien entra con una clave temporal va
directo a **Mi usuario y clave** y no puede usar otra pantalla hasta cambiarla (la tabla de usuarios muestra *clave
temporal* mientras tanto). Las claves se guardan cifradas con sal en `SIGBE_USUARIOS`. Un usuario desactivado o eliminado pierde la sesión
al instante. El historial muestra quién hizo cada cambio, p. ej. `ambipar (Ambipar)`. Los permisos se revisan en el
servidor, no solo en la pantalla.

## Correos y avisos

Cada usuario tiene **correo** (sirve también para entrar: usuario o correo, con la misma clave) y **sedes** (las de la app,
que ya unifican los nombres de las hojas: p. ej. Valle = RMX - Valle, Palmira y Calisur; ninguna = todas). Al entrar, la app
muestra sus sedes. Cuando alguien **crea un módulo o una sesión, pone o cambia la Fecha Holcim, la Fecha Ambipar o el estado
de una sesión, o toma asistencia**, les llega un correo a los usuarios con correo y "Recibe avisos" de esa sede (Holcim,
Ambipar y el gestor), menos a quien hizo el cambio. Un módulo nuevo avisa a todas las sedes. Cada envío queda en el
historial ("Aviso por correo").

Los avisos **no salen en el momento** (mandar correos tarda y gasta el cupo): se juntan y a los 5 minutos
(`SIGBE_MINUTOS_AVISOS`) sale **un solo correo por persona** con todo lo que le toca ("Resumen de N cambio(s)"). Lo
envía la tarea `sigbeAvisosPendientes`, que la app programa sola; la tarea de cada hora también envía lo que haya quedado.

Los correos salen de la cuenta que ejecuta la app (MailApp). Para autorizarlos, el dueño ejecuta una vez **probarCorreo**
en el editor (manda un correo de prueba). Google limita los envíos por día (unos 100 en cuentas Gmail personales, 1.500 en
Google Workspace): se manda un correo por persona y por guardado, no uno por dato.

## Dónde queda lo que se programa

En las mismas pestañas de siempre: el cronograma y la lista "2026 Brigadistas HOLCIM". Hasta el corte se escribe en
el 1.0 (cronograma) y el 2.0 (lista) y el libro nuevo lo copia ~1 minuto después; después del corte, en el libro nuevo,
y la lista se reorganiza sola (fechas y "No aplica") ~1 minuto después. Así el Excel sigue siendo un reflejo fiel y no
hay una segunda base de datos que pueda quedar distinta. La tarea de cada hora guarda el respaldo del día.

## Rapidez

La app pide **una sola vez** todos los datos (`getDatos`): el servidor lee cada pestaña una vez y guarda el resultado
en la caché de Apps Script por 10 minutos. Los filtros, la ficha, el avance y la revisión se calculan en el navegador,
sin volver a leer las hojas. Al guardar desde la app o con la tarea automática la caché se renueva. Arriba se ve la
hora de los datos y el botón ↻ los vuelve a leer.

Cada guardado abre solo los archivos que necesita (el corte lo deja en uno), escribe las filas seguidas de una vez,
lee las propiedades del script una sola vez y no copia el archivo de respaldo con el bloqueo tomado (eso lo hace la
tarea de cada hora). Los correos se envían aparte. En el navegador, las búsquedas esperan a que se deje de escribir.

## Qué sesiones aplican

Las mismas reglas que el libro nuevo (ver la sección siguiente): cronograma con fecha → esa fecha; `-` o gris → no aplica;
planta con una sola sesión → la Sesión 2 no aplica; filas `AGG:`, `CEM:`, `RMX & TQC:` solo para su línea. M8 tiene tres
partes (M8-1, M8-2, M8-3) y cada una es una sesión distinta. La app **no deja marcar** asistencia en una sesión que no
aplica: si sí se dictó, se corrige el cronograma.

**Fecha de ingreso a la brigada:** una sesión con fecha anterior al ingreso de la persona **no le aplica**. No sale en la
lista de esa sesión (una nota dice cuántos quedaron fuera y por qué; "Ver desvinculados y a quienes no les aplica" los
muestra), no cuenta como "no asistió" ni en su cumplimiento, en el avance por planta o en el Dashboard, y no se puede
marcar (si la fecha de ingreso está mal, se corrige primero). La fórmula de cumplimiento del libro nuevo hace lo mismo.
Si la persona no tiene fecha de ingreso, le aplican todas.

**Por sesión o por persona:** en *Tomar asistencia* se marca a todos los de una sesión; al tocar el nombre de alguien se
abre su ficha, donde se marcan sus sesiones (también desde *Brigadistas*).

## Revisión de datos

| Tipo | Gravedad |
|---|---|
| Asistencia marcada en una sesión que no aplica · cédula repetida | error |
| Datos incompletos del brigadista (botón Completar) · sesión pasada sin ninguna asistencia · Seguimiento dice que se dictó y la lista no tiene asistentes · asistencia en fecha futura · asistencia antes de la fecha de ingreso · fecha de la lista distinta al cronograma · cédula vacía o rara · planta sin cronograma · Indicador distinto a las listas | aviso |
| Mismo nombre con cédulas distintas · activo sin asistencias · contratista sin certificado · sesión pasada que sigue "Programada" · sesión sin fecha · Seguimiento con otra cantidad de asistentes | para saber |

El cruce con **2026 Seguimiento** se hace por tema y fecha (los nombres de planta no coinciden entre pestañas).

## Cambios hechos directamente en el Excel

La tarea automática (`libroNuevoActualizar`, cada `SIGBE_CADA_HORAS` horas) guarda una "foto" de los datos (personas,
estados, certificados, marcas de asistencia, fechas y estados del cronograma) en la carpeta de respaldos y la compara con
la anterior. Lo que cambió y **no** está en el historial como hecho desde la app se anota como *Excel (detectado)*.

## Libro nuevo consolidado ("Gestión de Brigadas 2026")

Un solo archivo que reemplaza al 1.0 y al 2.0. Se llena solo y se mantiene al día hasta el **corte**; después
del corte se trabaja únicamente en él y el 1.0 y el 2.0 quedan como histórico.

**Qué contiene**

- Del **1.0**: todas las pestañas **visibles**, tal cual (mismo nombre, datos, fórmulas, colores, tablas,
  desplegables). Las ocultas no se traen.
- Del **2.0**: la pestaña **2026 Brigadistas HOLCIM** (lista de asistencia), con el mismo nombre, ubicada antes
  de *2026 Brigadistas INHOUSE* y **organizada con el cronograma del 1.0**:

| En el cronograma, para la planta y la sesión | En la lista de asistencia |
|---|---|
| Fecha | Esa fecha en la columna *Mx_Sesión_n* y casilla de asistencia habilitada. |
| `-` o fondo gris | Texto **No aplica**, celda gris, **sin casilla** y no cuenta en el cumplimiento. |
| Vacía (aún sin fecha) | Se deja lo que diga el 2.0 (o vacío) y la casilla habilitada. |
| La planta tiene una sola sesión | La *Sesión 2* de todos los módulos: **No aplica**. |

  Se quitan los textos de explicación ("FECHA SEGÚN CRONOGRAMA…"). Las marcas de asistencia del 2.0 se conservan.
  *Cumplimiento del (los) Módulo(s)* y *% de cumplimiento* quedan con fórmula: módulos asistidos sobre módulos que
  aplican y cuya fecha ya pasó (en un módulo con dos sesiones basta asistir a una). Las filas TOTAL suman las de su planta.

**Cómo se relaciona cada módulo con el cronograma** (columna ENTRENAMIENTO del 1.0)

| Módulo | Fila del cronograma |
|---|---|
| M1 | Primer auxilio |
| M2 | Planes de prevención, preparación y respuesta |
| M3 | Sustancias peligrosas (MATPEL) |
| M4 | Eléctrico |
| M5 | Alturas (comparte celda con espacios confinados) |
| M6 | Vehicular |
| M7 | Sismo |
| M8-1, M8-2, M8-3 | 1.ª, 2.ª y 3.ª fila "Resolución 0256" |
| M9 | Acuático de la línea de la planta (AGG, CEM o RMX & TQC) |
| M10 | Minería de la línea de la planta (AGG o CEM) |
| M11 | Harina caliente (CEM) |

Las filas con prefijo (`AGG:`, `CEM:`, `RMX & TQC:`) solo aplican a esa línea; `TODOS:` aplica a todas. La planta y
su bloque del cronograma están en la tabla `LN_PLANTAS` de [`LibroNuevo.gs`](LibroNuevo.gs): **RMX - VALLE usa el
bloque de Calisur** (así estaba en el 2.0) y **CEM - NOBSA y GEO - NOBSA** usan el bloque *CEM & GEO - Nobsa* con las
filas de CEM. Para cambiar una regla se cambia el cronograma (poner `-` o la fecha), no la lista de asistencia.

**Pasos (en el editor de Apps Script, con la cuenta dueña; menú Ejecutar)**

1. `libroNuevoCrear`: crea el archivo junto al 2.0 en Drive y lo llena. El enlace queda en el registro de ejecución.
2. `libroNuevoActivarAutomatico`: lo mantiene al día cada `SIGBE_CADA_HORAS` horas (solo copia las pestañas que cambiaron).
3. Mientras no haya corte, **no escribas en esas pestañas del libro nuevo**: cada actualización las vuelve a traer
   del 1.0 y del 2.0. Se marca desde la app (que guarda en el 2.0).
4. `libroNuevoCorte` cuando se decida el cambio: hace una última actualización (si hay un borrado masivo o un error,
   **no** hace el corte) y desde ahí el libro nuevo es el oficial: la app pasa a leer y guardar ahí. La tarea
   automática sigue corriendo para anotar lo que se cambie directamente en el libro y para reorganizar la lista
   de asistencia si cambia el cronograma. Todo el corte se hace con el bloqueo tomado: si alguien guarda en ese
   momento, espera y su cambio queda en el libro nuevo.

Al reorganizar la lista con el cronograma **nunca se borra una marca de asistencia** (si la sesión pasa a "No aplica",
la marca queda y no cuenta; sale en Revisión de datos) ni el texto propio de una persona en la fecha (p. ej. "NO HACÍA
PARTE"). Solo se reorganiza si cambian fechas, "-", filas o la cantidad de personas, no por el estado o las observaciones.

Otras: `libroNuevoActualizar` (traer cambios ya), `libroNuevoActualizarTodo` (todas las pestañas aunque no hayan
cambiado; también sirve para aceptar un borrado que sí era correcto), `libroNuevoEstado`, `libroNuevoDesactivarAutomatico`,
`libroNuevoQuitarCorte` (se niega si ya hay cambios desde la app en el libro nuevo: la siguiente copia del 1.0 y el
2.0 los borraría). Si ya existe un archivo vacío que se quiera usar, pon su URL en la propiedad del script
`LIBRO_NUEVO_ID` y ejecuta `libroNuevoActualizarTodo`.

Mismo seguro que la sincronización: si una pestaña de origen pierde de golpe más del 30 % de sus datos, no se copia y se avisa.

## Instalación y actualización

1. **Proyecto**: [script.google.com](https://script.google.com) → el proyecto SIGBE → reemplaza el contenido de
   `SIGBE.gs`, `LibroNuevo.gs`, `SincronizarBrigadas.gs`, `Index.html` y **`App.html`** (➕ → HTML → nombre `App`)
   (y `appsscript.json` si cambió) → guarda. Al pegar, revisa que el final del archivo quede completo.
2. **Propiedades del script**: `SIGBE_ID_ORIGEN` (URL del 1.0), `SIGBE_ID_DESTINO` (URL del 2.0), `SIGBE_USUARIO`,
   `SIGBE_CLAVE_INICIAL` (se cifra y se borra al primer inicio de sesión).
   `LIBRO_NUEVO_ID` lo pone `libroNuevoCrear`.
3. Comparte el 1.0 y el 2.0 como **editor** con la cuenta que ejecuta el script (`libroNuevoProbarAcceso` lo comprueba).
4. **Publicar**: *Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar* (la URL no cambia).
   La primera vez: *Nueva implementación → Aplicación web*, ejecutar como **Yo**.
5. **Tarea automática**: Configuración → *Activar* (o `libroNuevoActivarAutomatico` en el editor). Si quedó un activador
   viejo llamado `sincronizar`, ahora hace la tarea nueva; el diagnóstico avisa para dejar uno solo.

> El archivo contiene nombres y cédulas: para ver cualquier dato hay que iniciar sesión. Comparte los archivos solo con
> quien los necesita y usa una clave fuerte.

## Seguros contra daños

- Para ver o guardar hay que iniciar sesión; personas por cédula (+ nombre; sin cédula, solo entre quienes tampoco la
  tienen, y la fila desempata homónimos) y columnas por encabezado.
- Un texto que empieza con `=` o `+` se guarda como texto, no como fórmula.
- Las funciones de mantenimiento (`probarCorreo`, `libroNuevoProbarAcceso`, las tareas automáticas) solo las corre la
  cuenta dueña o su activador; no se pueden llamar desde la app publicada.
- Cinco claves erradas bloquean ese usuario 10 minutos (no a los demás).
- Si la casilla cambió desde que se abrió la pantalla, no se pisa y se avisa.
- Cada día la tarea automática guarda una copia completa de los archivos en uso en Drive (*Respaldos Gestion de
  Brigadas 2.0*, 30 días por archivo); si un día no corrió, el primer guardado la hace. Antes de crear un módulo o
  una sesión también. Además está el historial de versiones de Google.
- Si una pestaña de origen pierde de golpe más del 30 % de sus datos, no se copia al libro nuevo y se avisa.
- Las columnas con tipo fijo de las tablas de Google no se fuerzan: se saltan y se avisa.
