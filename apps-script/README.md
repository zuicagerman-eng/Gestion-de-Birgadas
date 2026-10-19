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

# App web SIGBE 2.0

Archivos: [`SIGBE.gs`](SIGBE.gs) (backend) e [`Index.html`](Index.html) (pantallas). Van en el **mismo
proyecto de Apps Script del 2.0**, junto a `SincronizarBrigadas.gs` (usa su `ID_ORIGEN` y su carpeta de respaldos).

## Pantallas

| Menú | Para qué sirve |
|---|---|
| **Inicio** | Resumen de la sede: brigadistas activos, certificado 0256, asistencia registrada, cobertura, próximas capacitaciones y pendientes de certificado. Accesos rápidos. |
| **Tomar asistencia** | Paso a paso: sede → sesión (con su fecha y cuántos ya asistieron) → lista de personas con botón *Asistió / No asistió* → **Revisar y guardar** (resumen antes de guardar) → opción **Deshacer**. |
| **Brigadistas** | Buscar y filtrar (Holcim / contratistas, certificado, desvinculados). **Registrar brigadista** con revisión antes de guardar. |
| **Cronograma** | Sesiones por mes con fecha, planta, sesión y estado; oculta las pasadas. |
| **Temarios** | Módulos de cada temario en acordeón. |
| **Cobertura** | Hoja *Indicador*: brigadistas actuales frente a requeridos, con barra de avance. |
| **Historial de cambios** | Todo lo guardado desde la app: quién, cuándo, antes y después. |

Arriba se elige la **sede** (se recuerda en ese navegador) y todo se filtra por ella. Las plantas de las
distintas hojas ("AGG - MONDOÑEDO", "Mondoñedo", "AGG - Mondoñedo") se agrupan por sede (`SIGBE_SEDES`).

## Dónde lee y escribe

| Dato | Lee de | Escribe en |
|---|---|---|
| Brigadistas HOLCIM e INHOUSE (lista, asistencia, registro) | **archivo original** (al instante) | **archivo original** |
| Indicador, Cronograma, Temarios | archivo 2.0 | — |
| Historial (Bitácora SIGBE) | archivo 2.0 | archivo 2.0 |

El 2.0 recibe lo guardado desde la app en 1 a 2 minutos (y lo de los proveedores con la sincronización
de cada hora). Si el original se borra o va a la papelera, la app usa el 2.0 automáticamente.

## Seguros contra daños

- **Nada se guarda sin confirmar**: la asistencia se marca en pantalla, se revisa en un resumen y solo
  entonces se guarda; el registro de brigadistas también muestra los datos antes de guardar.
- **Deshacer** inmediatamente después de guardar asistencia.
- **No pisa cambios ajenos**: si una casilla cambió en la hoja desde que se abrió la pantalla
  (por ejemplo, la marcó un proveedor), ese cambio no se aplica y se avisa.
- **Solo escribe en casillas de asistencia**, nunca sobre fechas o textos. Personas por cédula (+ nombre
  si la cédula se repite) y columnas por encabezado, nunca por posición.
- **No deja registrar una cédula repetida** (ni en Holcim ni en contratistas).
- **Respaldo diario del archivo original** antes del primer cambio del día (carpeta *Respaldos Gestion
  de Brigadas 2.0*, últimos 30 días), además del respaldo diario del 2.0 y del historial de versiones de Google.
- **Historial**: hoja *Bitácora SIGBE* del 2.0 con cada cambio (quién, cuándo, antes, después).
- **Sesión con clave** para guardar (6 horas); la clave se guarda cifrada y se verifica en el servidor;
  5 intentos fallidos bloquean 10 minutos. Sin sesión, la app es de solo lectura.

## Instalación / actualización

1. En el editor de Apps Script del 2.0:
   - `Código.gs` → reemplazar todo por el contenido de `SIGBE.gs`.
   - `Index.html` → reemplazar todo por el contenido de `Index.html`.
   - `SincronizarBrigadas.gs` → reemplazar por la versión actual.
   - **Guardar (Ctrl + S).**
2. Si aún no se hizo: recargar el 2.0 → **🔄 Sincronización → 🔐 Configurar usuario y clave de la app SIGBE**.
3. **Implementar → Administrar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar.**
   La URL no cambia. Recomendado: **Ejecutar como: Yo** y acceso para los usuarios de tu organización.
   Google puede pedir de nuevo permisos (Drive, para el respaldo del original): aceptarlos.
