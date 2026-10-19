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
proyecto de Apps Script del 2.0**, junto a `SincronizarBrigadas.gs` (usa su `ID_ORIGEN`).

## Dónde lee y escribe

| Dato | Lee de | Escribe en |
|---|---|---|
| Brigadistas HOLCIM e INHOUSE (directorio, asistencia, registro) | **archivo original** (al instante) | **archivo original** |
| Indicador (tablero), Cronograma, Temarios | archivo 2.0 | — |

Proveedores, personal Holcim y la app escriben en el **mismo archivo** (el original); el 2.0 lo recibe
con la sincronización de cada hora. Si el original se borra o va a la papelera, la app usa el 2.0
automáticamente. Las personas se ubican por **cédula** (y nombre si la cédula está repetida) y las
columnas por su **encabezado**, nunca por número de fila o columna.

## Instalación / actualización

1. En el editor de Apps Script del 2.0:
   - `Código.gs` → reemplazar todo por el contenido de `SIGBE.gs`.
   - `Index.html` → reemplazar todo por el contenido de `Index.html`.
   - `SincronizarBrigadas.gs` → reemplazar por la versión actual (trae el menú de la clave).
   - **Guardar (Ctrl + S).**
2. Recargar el 2.0 → **🔄 Sincronización → 🔐 Configurar usuario y clave de la app SIGBE**. La clave
   se guarda cifrada en las propiedades del proyecto, no en el código.
3. **Implementar → Administrar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar.**
   La URL de la app no cambia. Sin este paso la app sigue mostrando la versión anterior.

## Seguridad

- Ver la información no requiere clave; **marcar asistencia y registrar brigadistas sí** (la sesión dura 6 horas).
- La clave se verifica en el servidor en cada guardado. Tras 5 intentos fallidos se bloquea 10 minutos.
