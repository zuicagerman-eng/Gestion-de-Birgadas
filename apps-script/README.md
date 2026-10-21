# Sincronización automática de Gestión de Brigadas

Trae del archivo **ORIGEN** (*Gestion de Brigadas*, el actualizado) al archivo **DESTINO**
(*Gestion de Brigadas 2.0*) las hojas completas, **idénticas** a como están en el origen:
datos, colores, desplegables, casillas, anchos de columna y filas. No usa IMPORTRANGE ni enlaces.

Hojas que se traen (lista `HOJAS_A_COPIAR` al inicio del script):

- `2026 Brigadistas HOLCIM`
- `2026 Brigadistas INHOUSE`
- `2026 Cronograma Nacional Brigadas`
- `2026 TEMARIO NACIONAL BRIGADAS`: desactivada. Para traerla, quita las `//` del inicio de su línea.

Cada hoja se reemplaza en la misma posición y con el mismo nombre. Si otra hoja del 2.0 (por
ejemplo *Indicador*) tiene fórmulas que apuntan a ella, esas fórmulas se conservan.
En la actualización automática una hoja solo se reemplaza si cambió algo en el origen.
Si Google no permite copiar una pestaña completa entre archivos (error *"No se encontró la hoja …"*,
pasa con el Cronograma), esa pestaña se actualiza **celda por celda** en el 2.0: datos, fórmulas,
colores de fondo y de letra, negritas y formato de números. El resultado dice *"(celda por celda)"*.

## Seguros

- **Si el archivo origen se borra, está en la papelera o se pierde el acceso**, no se toca nada
  del 2.0 (queda como estaba). Cuando el origen ya no se use, desactiva la actualización automática
  y sigue trabajando en el 2.0.
- **Borrado masivo**: si una hoja del origen queda con menos del 70 % de los datos que tenía la última vez que se copió,
  esa hoja **no se copia** y se avisa (también por correo). Si el borrado era intencional:
  *🔄 Sincronización → Sincronizar aceptando un borrado grande*.
- **Respaldo diario**: antes del primer cambio de cada día se guarda una copia completa del 2.0 en la
  carpeta de Drive **Respaldos Gestion de Brigadas 2.0** (se guardan los últimos 30 días).
- **Restaurar**: *🔄 Sincronización → Restaurar desde un respaldo* → escribe la fecha o deja vacío
  para el más reciente. Vuelve a poner las hojas sincronizadas tal como estaban ese día.
  También puedes abrir cualquier respaldo de la carpeta directamente, o usar
  *Archivo → Historial de versiones* de Google.

Los porcentajes y la cantidad de días se cambian al inicio del script (`MAXIMA_REDUCCION`,
`DIAS_RESPALDO`).

## Instalación (una sola vez)

1. **Ambos archivos deben estar en formato Google Sheets**, no `.xlsx`. Si en Drive aparece la
   etiqueta `.XLSX` junto al nombre: *Archivo → Guardar como Hojas de cálculo de Google*.
2. Abre el **ORIGEN** y copia su ID de la URL:
   `https://docs.google.com/spreadsheets/d/`**`ESTE_ES_EL_ID`**`/edit`
3. Abre el **DESTINO (2.0)** → *Extensiones → Apps Script*.
4. En el archivo `SincronizarBrigadas.gs` pega todo [`SincronizarBrigadas.gs`](SincronizarBrigadas.gs)
   (ya trae el ID del origen en `ID_ORIGEN`; verifica que coincida con el del paso 2).
   **Guarda (💾 o Ctrl + S)** y espera a que desaparezca "Cambios sin guardar".
5. Recarga el 2.0 → menú **🔄 Sincronización → Sincronizar ahora** (la primera vez Google pide
   permisos, incluido el acceso a Drive para los respaldos: *Revisar permisos → tu cuenta → Configuración avanzada → Ir a … → Permitir*).
6. **🔄 Sincronización → Activar actualización automática**: desde ahí corre sola cada hora.

## Uso diario

- Se trabaja **solo en el ORIGEN**. Lo que se escriba a mano en esas hojas del 2.0 se pierde
  cuando la hoja se vuelve a traer.
- *Sincronizar ahora* siempre trae las hojas completas, hayan cambiado o no.
- *Ver resultado de la última sincronización* muestra qué hojas se actualizaron.
- Si una corrida automática falla, Google envía un correo al dueño del activador.
- Los botones del panel de control de HOLCIM (🔎 APLICAR / ↺ VER TODO) usan el script del
  archivo origen; en el 2.0 se ven igual pero no filtran.

---

# App web SIGBE 2.0 (versión 2.1.0)

Archivos: [`SIGBE.gs`](SIGBE.gs) (backend) e [`Index.html`](Index.html) (pantallas). Van en el **mismo
proyecto de Apps Script del 2.0**, junto a `SincronizarBrigadas.gs` (usa su `ID_ORIGEN`, su carpeta de
respaldos y su función de sincronización). Los tres archivos trabajan juntos: la app muestra el estado de la
sincronización y puede lanzarla; el menú del 2.0 muestra el diagnóstico de la app.

## Pantallas

| Menú | Para qué sirve |
|---|---|
| **Inicio** | Resumen de la sede: brigadistas activos, certificado 0256, asistencia registrada, cobertura, próximas capacitaciones y pendientes de certificado. Accesos rápidos. |
| **Tomar asistencia** | Paso a paso: sede → sesión (con su fecha y cuántos ya asistieron) → lista de personas con botón *Asistió / No asistió* → **Revisar y guardar** → opción **Deshacer**. Botones **Imprimir** (lista para firmar) y **CSV**. |
| **Brigadistas** | Buscar y filtrar (Holcim / contratistas, certificado, desvinculados). Clic en una persona → **ficha** (todas sus sesiones, certificado, cumplimiento) y **Editar** (estado, certificado, fecha de ingreso, contratista). **Registrar brigadista** y **Descargar** CSV. |
| **Cronograma** | Sesiones por mes con fecha, planta, sesión y estado; oculta las pasadas. |
| **Temarios** | Módulos de cada temario en acordeón. |
| **Cobertura** | Hoja *Indicador*: brigadistas actuales frente a requeridos, con barra de avance. |
| **Historial de cambios** | Todo lo guardado desde la app: quién, cuándo, antes y después. |
| **Estado del sistema** | Fuente de datos, última sincronización (detalle por hoja), actualización automática, respaldos, **diagnóstico automático** con *qué hacer* en cada punto, y botón **Sincronizar ahora**. |
| **Ayuda** | Cómo funciona todo, qué protege los datos y una tabla de "qué ves → qué significa → qué hacer". |

Arriba se elige la **sede** (se recuerda en ese navegador) y todo se filtra por ella. Las plantas de las
distintas hojas ("AGG - MONDOÑEDO", "Mondoñedo", "AGG - Mondoñedo") se agrupan por sede (`SIGBE_SEDES`).
Abajo a la izquierda se ve la **versión** instalada y la hora de la última actualización del 2.0; si las
pantallas y el servidor tienen versiones distintas, aparece un aviso amarillo (falta pegar un archivo o publicar).

## Dónde lee y escribe

| Dato | Lee de | Escribe en |
|---|---|---|
| Brigadistas HOLCIM e INHOUSE (lista, ficha, asistencia, registro, edición) | **archivo original** (al instante) | **archivo original** |
| Indicador, Cronograma, Temarios | archivo 2.0 | — |
| Historial (Bitácora SIGBE) | archivo 2.0 | archivo 2.0 |

El 2.0 recibe lo guardado desde la app en 1 a 2 minutos (y lo de los proveedores con la sincronización
de cada hora). Si el original se borra o va a la papelera, la app usa el 2.0 automáticamente.

## Seguros contra daños

- **Nada se guarda sin confirmar**: asistencia, registro y edición muestran un resumen antes de guardar.
- **Deshacer** inmediatamente después de guardar asistencia.
- **No pisa cambios ajenos**: si una casilla o un dato cambió en la hoja desde que se abrió la pantalla
  (por ejemplo, lo cambió un proveedor), ese cambio no se aplica y se avisa.
- **Solo escribe en casillas de asistencia y en 4 campos** (estado, certificado, fecha de ingreso, contratista),
  siempre con los valores que acepta la hoja (listas desplegables). Personas por cédula (+ nombre si la cédula
  se repite) y columnas por encabezado, nunca por posición. La planta y el nombre no se editan desde la app.
- **No deja registrar una cédula repetida** (ni en Holcim ni en contratistas).
- **Respaldo diario del archivo original** antes del primer cambio del día (carpeta *Respaldos Gestion
  de Brigadas 2.0*, últimos 30 días), además del respaldo diario del 2.0 y del historial de versiones de Google.
- **Historial**: hoja *Bitácora SIGBE* del 2.0 con cada cambio (quién, cuándo, antes, después).
- **Sesión con clave** para guardar (6 horas); la clave se guarda cifrada y se verifica en el servidor;
  5 intentos fallidos bloquean 10 minutos. Sin sesión, la app es de solo lectura.

## Errores de sincronización que pueden aparecer (y qué hace el sistema)

| Situación | Cómo se nota | Qué hace el sistema | Qué hacer |
|---|---|---|---|
| El original se borró, está en la papelera o se perdió el acceso | Estado del sistema: "Fuente de datos: Archivo 2.0"; sincronización con ✖ "no se pudo abrir el archivo origen" | No toca el 2.0; la app sigue funcionando con el 2.0; correo al dueño | Si ya no se usa, desactivar la actualización automática. Si debería existir, restaurarlo en Drive. |
| Cambió el nombre de una pestaña en el original | ✖ "no existe en el archivo origen"; diagnóstico "Hojas en el original" en rojo | Esa hoja no se copia; las demás sí | Volver a ponerle el nombre exacto. |
| Cambió un encabezado (p. ej. "CÉDULA") | Diagnóstico "Columnas de la hoja HOLCIM" en rojo; la app no puede ubicar personas | La sincronización sigue copiando la hoja completa; la app bloquea las escrituras | Volver a escribir el encabezado igual que antes. |
| Se borró más del 30 % de una hoja en el original | ⚠ "posible borrado masivo" | Esa hoja **no** se copia al 2.0 (queda la versión anterior) | Si fue a propósito: menú 🔄 → "Sincronizar aceptando un borrado grande". Si no: restaurar el original desde Drive. |
| Google no deja copiar la pestaña completa | "No se encontró la hoja …" (interno) | Se actualiza celda por celda (datos, fórmulas, colores); se recuerda para las siguientes veces | Nada. Solo bordes y celdas combinadas nuevas no se copian. |
| Zona horaria distinta entre archivos | ℹ en la sincronización; diagnóstico en amarillo | Avisa | Archivo → Configuración → misma zona horaria en ambos. |
| Activador apagado o dañado | Diagnóstico "Actualización automática" en amarillo; "Última sincronización" muy antigua | La app sigue programando la actualización rápida al guardar | Menú 🔄 → Desactivar y volver a Activar la actualización automática. |
| La sincronización tarda más de 4 minutos | Diagnóstico "Duración" en amarillo | Avisa (Google corta a los 6 min) | Borrar filas/columnas vacías al final de las hojas del original. |
| Alguien edita HOLCIM/INHOUSE a mano en el 2.0 | Diagnóstico "Diferencias entre el original y el 2.0" | Se sobrescribe en la próxima sincronización | Editar siempre en el original o desde la app. |
| Dos sincronizaciones a la vez | "Ya había una sincronización en curso" | La segunda espera 30 s y, si no, se descarta | Nada; vuelve a correr sola. |
| La app corre con una cuenta sin permiso de edición | Error al guardar; "La app se ejecuta como" en el diagnóstico | No escribe | Implementar como "Yo" (el propietario) o dar permiso de edición a esa cuenta en ambos archivos. |
| Se pegó el código pero no se publicó | Aviso amarillo de versiones distintas; pantallas viejas | — | Implementar → Administrar implementaciones → ✏️ → Nueva versión. |

## Instalación / actualización

1. En el editor de Apps Script del 2.0:
   - `Código.gs` → reemplazar todo por el contenido de `SIGBE.gs`.
   - `Index.html` → reemplazar todo por el contenido de `Index.html`.
   - `SincronizarBrigadas.gs` → reemplazar todo por la versión actual (trae el detalle de la sincronización y el menú 🩺).
   - **Guardar (Ctrl + S).**
2. Si aún no se hizo: recargar el 2.0 → **🔄 Sincronización → 🔐 Configurar usuario y clave de la app SIGBE**.
3. **Implementar → Administrar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar.**
   La URL no cambia. Recomendado: **Ejecutar como: Yo** y acceso para los usuarios de tu organización.
   Google puede pedir de nuevo permisos (Drive y activadores): aceptarlos.
4. Abrir la app → **Estado del sistema**: el diagnóstico debe quedar sin errores (los avisos de cédulas
   repetidas o personas sin cédula son datos por corregir en el original, no fallas).
