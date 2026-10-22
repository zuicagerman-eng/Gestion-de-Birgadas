# SIGBE 2.0 — Sistema de Gestión de Brigadas (versión 3.0.0, proyecto independiente)

Aplicación web de Google Apps Script para gestionar las brigadas de emergencia: brigadistas, asistencia a
capacitaciones, cronograma, temarios, cobertura e historial. Incluye la **sincronización automática** del
archivo original (donde marcan los proveedores) al archivo 2.0.

Desde la versión 3.0.0 es un **proyecto independiente de Apps Script**: no vive dentro de ninguna hoja de
cálculo, sirve para cualquier cuenta de Google (Workspace o Gmail) y los archivos que usa se configuran
desde la propia app.

## Archivos del proyecto

| Archivo | Qué es |
|---|---|
| [`SIGBE.gs`](SIGBE.gs) | Backend de la app: datos, asistencia, brigadistas, configuración, diagnóstico. |
| [`SincronizarBrigadas.gs`](SincronizarBrigadas.gs) | Sincronización original → 2.0, respaldos, restauración, activador. |
| [`LibroNuevo.gs`](LibroNuevo.gs) | Libro nuevo consolidado (1.0 + lista de asistencia del 2.0) y su corte. |
| [`Index.html`](Index.html) | Todas las pantallas. |
| [`appsscript.json`](appsscript.json) | Manifiesto: zona horaria, permisos (scopes) y tipo de publicación. |

## Instalación en una cuenta de Google (Workspace o Gmail)

1. **Archivos de datos**: ten en Drive de esa cuenta (o compartidos con ella con permiso de edición):
   - el **archivo 2.0** (*Gestion de Brigadas 2.0*), con las pestañas Indicador, Cronograma, HOLCIM e INHOUSE;
   - opcionalmente el **archivo original** (*Gestion de Brigadas*), si los proveedores siguen marcando ahí.
   Ambos en formato Google Sheets (no `.xlsx`). Si vienen de otra cuenta y no se pueden copiar directamente,
   descárgalos como `.xlsx` y súbelos; luego *Archivo → Guardar como Hojas de cálculo de Google*.
2. **Proyecto**: entra a [script.google.com](https://script.google.com) → *Nuevo proyecto* → ponle nombre (p. ej. *SIGBE*).
   - En *Código.gs* pega el contenido de `SIGBE.gs`.
   - *➕ → Secuencia de comandos* → nómbrala `SincronizarBrigadas` → pega `SincronizarBrigadas.gs`.
   - *➕ → HTML* → nómbrala `Index` → pega `Index.html`.
   - ⚙️ *Configuración del proyecto* → marca *Mostrar el archivo de manifiesto "appsscript.json"* → en el
     editor abre `appsscript.json` y pega el del repositorio (zona horaria America/Bogota y permisos exactos).
   - Guarda (Ctrl + S).
3. **Propiedades del script** (⚙️ *Configuración del proyecto → Propiedades del script → Añadir propiedad*):

   | Propiedad | Valor |
   |---|---|
   | `SIGBE_ID_DESTINO` | URL del archivo 2.0 (obligatorio) |
   | `SIGBE_ID_ORIGEN` | URL del archivo original, o `NINGUNO` si se trabaja solo con el 2.0 |
   | `SIGBE_USUARIO` | usuario administrador (p. ej. `admin`) |
   | `SIGBE_CLAVE_INICIAL` | clave de al menos 8 caracteres; en el primer inicio de sesión se guarda cifrada y se borra |
   | `SIGBE_LECTURA_PUBLICA` | `no` (recomendado: ver exige sesión) o `si` (cualquiera con el enlace puede ver, no guardar) |

   Alternativa: publicar la app y abrirla con la **misma cuenta dueña del proyecto**; aparece la pantalla
   *Configuración inicial* con un formulario (solo funciona mientras no haya usuario y clave).
4. **Publicar**: *Implementar → Nueva implementación → ⚙️ Aplicación web*:
   - *Ejecutar como*: **Yo** (la cuenta dueña).
   - *Quién tiene acceso*: en Gmail, **Cualquier usuario con cuenta de Google**; en Workspace puede ser
     *Cualquier usuario de la organización*. (*Cualquier usuario*, sin cuenta, también funciona: la app tiene
     su propia clave; en ese caso deja `SIGBE_LECTURA_PUBLICA = no`.)
   - Autoriza los permisos (hojas de cálculo, Drive, activadores, correo de la cuenta).
   - Copia la URL `…/exec`: es la de la app.
5. **Primer uso**: abre la app → inicia sesión → **Estado del sistema** (el diagnóstico debe quedar sin rojos) →
   **Configuración → Activar actualización automática** (si hay archivo original).

### Actualizar a una versión nueva
Reemplaza el contenido de los archivos que cambiaron, guarda y luego *Implementar → Administrar
implementaciones → ✏️ → Versión: Nueva versión → Implementar*. La URL no cambia. Si las pantallas y el
servidor tienen versiones distintas, la app muestra un aviso amarillo.

### Pasar de la cuenta corporativa a una cuenta pública (lista de verificación)
1. Copiar el archivo 2.0 (y el original, si aplica) a la cuenta nueva (ver paso 1).
2. Crear el proyecto y publicar (pasos 2–4). Las propiedades, activadores y respaldos **no** se copian solos:
   se configuran de nuevo.
3. En la app: Configuración → verificar archivos, activar actualización automática, cambiar la clave.
4. En la cuenta antigua: desactivar la actualización automática (o borrar el activador en el editor) para que
   dos sincronizaciones no corran a la vez contra el mismo original, y archivar la implementación anterior.
5. Avisar la URL nueva a los usuarios. La carpeta *Respaldos Gestion de Brigadas 2.0* se crea en el Drive
   de la cuenta nueva con el primer cambio.

> Nota: el archivo contiene nombres y cédulas (datos personales). Al moverlo a una cuenta fuera de la
> organización, conviene dejar `SIGBE_LECTURA_PUBLICA = no`, compartir los archivos solo con quien los
> necesita y usar una clave fuerte.

## Pantallas

| Menú | Para qué sirve |
|---|---|
| **Inicio** | Resumen de la sede: brigadistas activos, certificado 0256, asistencia registrada, cobertura, próximas capacitaciones y pendientes de certificado. Accesos rápidos. |
| **Tomar asistencia** | Paso a paso: sede → sesión (con su fecha y cuántos ya asistieron) → lista de personas con botón *Asistió / No asistió* → **Revisar y guardar** → opción **Deshacer**. Botones **Imprimir** (lista para firmar) y **CSV**. |
| **Brigadistas** | Buscar y filtrar (Holcim / contratistas, certificado, desvinculados). Clic en una persona → **ficha** (todas sus sesiones, certificado, cumplimiento) y **Editar** (estado, certificado, fecha de ingreso, contratista). **Registrar brigadista** y **Descargar** CSV. |
| **Cronograma** | Sesiones por mes con fecha, planta, sesión y estado; oculta las pasadas. |
| **Temarios** | Módulos de cada temario en acordeón. |
| **Cobertura** | Hoja *Indicador*: brigadistas actuales frente a requeridos, con barra de avance. |
| **Historial de cambios** | Todo lo guardado desde la app: quién, cuándo, antes y después (hoja *Bitácora SIGBE* del 2.0). |
| **Estado del sistema** | Fuente de datos, última sincronización (detalle por hoja), actualización automática, respaldos, **diagnóstico automático** con *qué hacer* en cada punto y botón **Sincronizar ahora**. |
| **Configuración** | Archivos (2.0 y original), lectura sin sesión, actualización automática (activar/desactivar, cada N horas), usuario y clave, respaldos (restaurar) y "sincronizar aceptando un borrado grande". Exige sesión. |
| **Ayuda** | Cómo funciona, qué protege los datos y una tabla de "qué ves → qué significa → qué hacer". |

Arriba se elige la **sede** (se recuerda en ese navegador) y todo se filtra por ella. Las plantas de las
distintas hojas ("AGG - MONDOÑEDO", "Mondoñedo", "AGG - Mondoñedo") se agrupan por sede (`SIGBE_SEDES`).

## Qué sesiones ofrece la app en cada sede (regla del cronograma)

La hoja HOLCIM tiene columnas de asistencia para todos los módulos con Sesión 1 y Sesión 2 (M8 con 6),
pero **cada planta tiene 1 o 2 sesiones y no todos los entrenamientos le aplican**. Eso lo dice el
**Cronograma**: los bloques "Sesión 1 / Sesión 2" bajo cada planta (fila 2) y las celdas con `-` (gris)
en *Fecha HOLCIM*, que significan "no aplica". La app lo lee así, por sede:

1. Busca las filas del cronograma cuyo entrenamiento tiene el mismo nombre que el módulo de HOLCIM
   (sin el prefijo "AGG:", "TODOS:", "RMX & TQC:", y sin tildes ni puntuación).
2. Recorre esas filas en orden y, en cada una, Sesión 1 y luego Sesión 2 de la planta; cada celda que no
   sea `-` es una sesión que aplica. Así M8 (Rsln 0256, 3 filas) da 3 sesiones a una planta de 1 sesión y 6 a una de 2.
3. Una sesión también aplica si ya tiene **fecha real** en la hoja de brigadistas para esa planta.
4. La fecha mostrada es la de la hoja de brigadistas; si no hay, la del cronograma (con su estado:
   Programada, Pendiente Holcim…). `#VALUE!` o vacío = "sin fecha aún".
5. Si la sede no aparece en el cronograma, se ofrecen todas las sesiones. Un módulo repetido en HOLCIM
   (M2 tiene el mismo nombre que M1) solo se ofrece si tiene fecha en la hoja.

En "Tomar asistencia" se ven solo las sesiones que aplican y un enlace *"Ver las N que no aplican"*; una
sesión que no aplica igual se puede marcar (sale un aviso). La ficha del brigadista y el indicador de
asistencia del Inicio usan la misma regla. El diagnóstico avisa si una sede no está en el cronograma o
si un módulo no tiene fila.

## Dónde lee y escribe

| Dato | Lee de | Escribe en |
|---|---|---|
| Brigadistas HOLCIM e INHOUSE (lista, ficha, asistencia, registro, edición) | **archivo original** si está configurado y accesible; si no, el 2.0 | el mismo |
| Indicador, Cronograma, Temarios | archivo 2.0 | — |
| Historial (Bitácora SIGBE) | archivo 2.0 | archivo 2.0 |

El 2.0 recibe lo guardado desde la app en 1 a 2 minutos y lo de los proveedores con la actualización
automática (cada N horas). Con `SIGBE_ID_ORIGEN = NINGUNO` todo se hace directamente en el 2.0.

## Sincronización original → 2.0

Las hojas de `HOJAS_A_COPIAR` (HOLCIM, INHOUSE, Cronograma) quedan **idénticas** a las del original: datos,
colores, desplegables, casillas, anchos de columna y filas. Sin IMPORTRANGE ni enlaces. En la actualización
automática una hoja solo se reemplaza si cambió algo en el original. Si Google no permite copiar una pestaña
completa (pasa con el Cronograma), se actualiza **celda por celda** (datos, fórmulas, colores, formato de
números); el resultado dice *"(celda por celda)"*. Las fórmulas de otras hojas del 2.0 que apuntan a las
hojas sincronizadas se conservan.

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
   del 1.0 y del 2.0. Se sigue marcando como hasta ahora.
4. `libroNuevoCorte` cuando se decida el cambio: hace una última actualización (si hay un borrado masivo o un error,
   **no** hace el corte), apaga la actualización automática y desde ahí el libro nuevo es el oficial.

Otras: `libroNuevoActualizar` (traer cambios ya), `libroNuevoActualizarTodo` (todas las pestañas aunque no hayan
cambiado; también sirve para aceptar un borrado que sí era correcto), `libroNuevoEstado`, `libroNuevoDesactivarAutomatico`,
`libroNuevoQuitarCorte`. Si ya existe un archivo vacío que se quiera usar, pon su URL en la propiedad del script
`LIBRO_NUEVO_ID` y ejecuta `libroNuevoActualizarTodo`.

Mismo seguro que la sincronización: si una pestaña de origen pierde de golpe más del 30 % de sus datos, no se copia y se avisa.

## Seguros contra daños

- **Nada se guarda sin confirmar**: asistencia, registro, edición y configuración muestran un resumen antes.
- **Deshacer** inmediatamente después de guardar asistencia.
- **No pisa cambios ajenos**: si una casilla o un dato cambió en la hoja desde que se abrió la pantalla,
  ese cambio no se aplica y se avisa.
- **Solo escribe en casillas de asistencia y en 4 campos** (estado, certificado, fecha de ingreso, contratista),
  siempre con los valores que acepta la hoja. Personas por cédula (+ nombre si se repite) y columnas por
  encabezado, nunca por posición. La planta y el nombre no se editan desde la app.
- **No deja registrar una cédula repetida**.
- **Borrado masivo**: si una hoja del original queda con menos del 70 % de los datos que tenía la última vez,
  no se copia y se avisa; se acepta explícitamente desde Configuración.
- **Respaldo diario** del 2.0 (antes del primer cambio del día) y del original (antes del primer cambio desde
  la app) en la carpeta de Drive *Respaldos Gestion de Brigadas 2.0*, últimos 30 días; **restauración** desde
  Configuración. Además, el historial de versiones de Google.
- **Historial**: hoja *Bitácora SIGBE* del 2.0 con cada cambio (quién, cuándo, antes, después), incluidos
  los cambios de configuración.
- **Sesión con clave** (6 horas); la clave se guarda cifrada (SHA-256 con sal) y se verifica en el servidor;
  5 intentos fallidos bloquean 10 minutos. Con `SIGBE_LECTURA_PUBLICA = no`, incluso ver exige sesión.
- **Configuración inicial protegida**: desde la app solo la puede hacer la cuenta dueña del proyecto y
  solo mientras no existan credenciales.

## Errores de sincronización que pueden aparecer (y qué hace el sistema)

| Situación | Cómo se nota | Qué hace el sistema | Qué hacer |
|---|---|---|---|
| El original se borró, está en la papelera o se perdió el acceso | Estado del sistema: "Fuente de datos: Archivo 2.0"; sincronización con ✖ | No toca el 2.0; la app sigue funcionando con el 2.0; correo al dueño | Si ya no se usa: Configuración → archivo original `NINGUNO`. Si debería existir, restaurarlo en Drive. |
| Cambió el nombre de una pestaña en el original | ✖ "no existe en el archivo original"; diagnóstico "Hojas en el original" en rojo | Esa hoja no se copia; las demás sí | Volver a ponerle el nombre exacto. |
| Cambió un encabezado (p. ej. "CÉDULA") | Diagnóstico "Columnas de la hoja HOLCIM" en rojo | La sincronización sigue; la app bloquea las escrituras | Volver a escribir el encabezado igual que antes. |
| Se borró más del 30 % de una hoja en el original | ⚠ "posible borrado masivo" | Esa hoja **no** se copia | Si fue a propósito: Configuración → "Sincronizar aceptando un borrado grande". Si no: restaurar el original desde Drive. |
| Google no deja copiar la pestaña completa | "No se encontró la hoja …" (interno) | Se actualiza celda por celda y se recuerda | Nada. |
| Zona horaria distinta (archivos o proyecto) | Diagnóstico en amarillo | Avisa | Misma zona horaria en ambos archivos y en el proyecto (`appsscript.json`). |
| Activador apagado | Diagnóstico "Actualización automática" en amarillo | La app sigue programando la actualización rápida al guardar | Configuración → Activar. |
| La sincronización tarda más de 4 minutos | Diagnóstico "Duración" en amarillo | Avisa (Google corta a los 6 min) | Borrar filas/columnas vacías al final de las hojas del original. |
| Alguien edita HOLCIM/INHOUSE a mano en el 2.0 | Diagnóstico "Diferencias entre el original y el 2.0" | Se sobrescribe en la próxima sincronización | Editar siempre en el original o desde la app. |
| La app corre con una cuenta sin permiso de edición | Error al guardar; diagnóstico "Archivo 2.0" en rojo | No escribe | Compartir ambos archivos con permiso de edición a la cuenta que ejecuta la app. |
| Se pegó el código pero no se publicó | Aviso amarillo de versiones distintas | — | Implementar → Administrar implementaciones → ✏️ → Nueva versión. |
| "Inicia sesión para ver la información" | La lectura exige sesión | Pide la clave | Iniciar sesión; o Configuración → Acceso para permitir ver sin sesión. |
