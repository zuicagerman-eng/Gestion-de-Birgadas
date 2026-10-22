# SIGBE — Sistema de Gestión de Brigadas (versión 4.0.1)

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
- **Avance por persona**: tabla persona × módulo (✓ asistió, ✗ ya pasó y no asistió, · pendiente, — no aplica,
  ! marcada sin aplicar) con filtros por planta, estado y "con módulos vencidos", y CSV.
- **Brigadistas**: buscador, tipo, planta, estado, certificado, cumplimiento, orden por columna, ficha con sus sesiones,
  edición (estado, fecha de ingreso, certificado, contratista) y registro de personas nuevas.
- **Cronograma**: próximas / pasadas / por definir, filtros por mes, tema y estado; botón para abrir la asistencia.
- **Cobertura**: pestaña *Indicador.* con avance a la meta y comparación con las listas.
- **Revisión de datos**: posibles errores con filtros por gravedad y tipo (ver abajo).
- **Historial de cambios**: lo hecho desde la app y lo detectado en el Excel, con filtros y CSV.
- **Temarios** y **Otras hojas** (Seguimiento, Datos de contacto, Evacuadores…): consulta con buscador y filtros.
- **Estado del sistema** (archivos, tarea, respaldos, diagnóstico, "Actualizar ahora") y **Configuración**.

## Rapidez

La app pide **una sola vez** todos los datos (`getDatos`): el servidor lee cada pestaña una vez y guarda el resultado
en la caché de Apps Script por 10 minutos. Los filtros, la ficha, el avance y la revisión se calculan en el navegador,
sin volver a leer las hojas. Al guardar desde la app o con la tarea automática la caché se renueva. Arriba se ve la
hora de los datos y el botón ↻ los vuelve a leer.

## Qué sesiones aplican

Las mismas reglas que el libro nuevo (ver la sección siguiente): cronograma con fecha → esa fecha; `-` o gris → no aplica;
planta con una sola sesión → la Sesión 2 no aplica; filas `AGG:`, `CEM:`, `RMX & TQC:` solo para su línea. M8 tiene tres
partes (M8-1, M8-2, M8-3) y cada una es una sesión distinta. La app **no deja marcar** asistencia en una sesión que no
aplica: si sí se dictó, se corrige el cronograma.

## Revisión de datos

| Tipo | Gravedad |
|---|---|
| Asistencia marcada en una sesión que no aplica · cédula repetida | error |
| Sesión pasada sin ninguna asistencia · Seguimiento dice que se dictó y la lista no tiene asistentes · asistencia en fecha futura · asistencia antes de la fecha de ingreso · fecha de la lista distinta al cronograma · cédula vacía o rara · planta sin cronograma · Indicador distinto a las listas | aviso |
| Mismo nombre con cédulas distintas · activo sin asistencias · sin fecha de ingreso · contratista sin certificado · sesión pasada que sigue "Programada" · sesión sin fecha · Seguimiento con otra cantidad de asistentes | para saber |

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
   de asistencia si cambia el cronograma.

Otras: `libroNuevoActualizar` (traer cambios ya), `libroNuevoActualizarTodo` (todas las pestañas aunque no hayan
cambiado; también sirve para aceptar un borrado que sí era correcto), `libroNuevoEstado`, `libroNuevoDesactivarAutomatico`,
`libroNuevoQuitarCorte`. Si ya existe un archivo vacío que se quiera usar, pon su URL en la propiedad del script
`LIBRO_NUEVO_ID` y ejecuta `libroNuevoActualizarTodo`.

Mismo seguro que la sincronización: si una pestaña de origen pierde de golpe más del 30 % de sus datos, no se copia y se avisa.

## Instalación y actualización

1. **Proyecto**: [script.google.com](https://script.google.com) → el proyecto SIGBE → reemplaza el contenido de
   `SIGBE.gs`, `LibroNuevo.gs`, `SincronizarBrigadas.gs`, `Index.html` y **`App.html`** (➕ → HTML → nombre `App`)
   (y `appsscript.json` si cambió) → guarda. Al pegar, revisa que el final del archivo quede completo.
2. **Propiedades del script**: `SIGBE_ID_ORIGEN` (URL del 1.0), `SIGBE_ID_DESTINO` (URL del 2.0), `SIGBE_USUARIO`,
   `SIGBE_CLAVE_INICIAL` (se cifra y se borra al primer inicio de sesión), `SIGBE_LECTURA_PUBLICA` = `no`.
   `LIBRO_NUEVO_ID` lo pone `libroNuevoCrear`.
3. Comparte el 1.0 y el 2.0 como **editor** con la cuenta que ejecuta el script (`libroNuevoProbarAcceso` lo comprueba).
4. **Publicar**: *Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar* (la URL no cambia).
   La primera vez: *Nueva implementación → Aplicación web*, ejecutar como **Yo**.
5. **Tarea automática**: Configuración → *Activar* (o `libroNuevoActivarAutomatico` en el editor). Si quedó un activador
   viejo llamado `sincronizar`, ahora hace la tarea nueva; el diagnóstico avisa para dejar uno solo.

> El archivo contiene nombres y cédulas. Deja `SIGBE_LECTURA_PUBLICA = no`, comparte los archivos solo con quien los
> necesita y usa una clave fuerte.

## Seguros contra daños

- Para guardar hay que iniciar sesión; personas por cédula (+ nombre) y columnas por encabezado.
- Si la casilla cambió desde que se abrió la pantalla, no se pisa y se avisa.
- Antes del primer cambio del día desde la app se guarda una copia completa del archivo en Drive
  (*Respaldos Gestion de Brigadas 2.0*, 30 días por archivo). También está el historial de versiones de Google.
- Si una pestaña de origen pierde de golpe más del 30 % de sus datos, no se copia al libro nuevo y se avisa.
- Las columnas con tipo fijo de las tablas de Google no se fuerzan: se saltan y se avisa.
