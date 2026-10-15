# Sincronización automática de Gestión de Brigadas

Trae del archivo **ORIGEN** (*Gestion de Brigadas*, el actualizado) al archivo **DESTINO**
(*Gestion de Brigadas 2.0*) las hojas completas, **idénticas** a como están en el origen:
datos, colores, desplegables, casillas, anchos de columna y filas. No usa IMPORTRANGE ni enlaces.

Hojas que se traen (lista `HOJAS_A_COPIAR` al inicio del script):

- `2026 Brigadistas HOLCIM`
- `2026 Brigadistas INHOUSE`
- `2026 Cronograma Nacional Brigad`
- `2026 TEMARIO NACIONAL BRIGADAS`: desactivada. Para traerla, quita las `//` del inicio de su línea.

Cada hoja se reemplaza en la misma posición y con el mismo nombre. Si otra hoja del 2.0 (por
ejemplo *Indicador*) tiene fórmulas que apuntan a ella, esas fórmulas se conservan.
En la actualización automática una hoja solo se reemplaza si cambió algo en el origen.

## Instalación (una sola vez)

1. **Ambos archivos deben estar en formato Google Sheets**, no `.xlsx`. Si en Drive aparece la
   etiqueta `.XLSX` junto al nombre: *Archivo → Guardar como Hojas de cálculo de Google*.
2. Abre el **ORIGEN** y copia su ID de la URL:
   `https://docs.google.com/spreadsheets/d/`**`ESTE_ES_EL_ID`**`/edit`
3. Abre el **DESTINO (2.0)** → *Extensiones → Apps Script*.
4. Borra lo que haya en `Código.gs`, pega todo [`SincronizarBrigadas.gs`](SincronizarBrigadas.gs) y
   reemplaza `PEGA_AQUI_EL_ID_DEL_ARCHIVO_ORIGEN` por el ID del paso 2. Guarda (💾).
5. Recarga el 2.0 → menú **🔄 Sincronización → Sincronizar ahora** (la primera vez Google pide
   permisos: *Revisar permisos → tu cuenta → Configuración avanzada → Ir a … → Permitir*).
6. **🔄 Sincronización → Activar actualización automática**: desde ahí corre sola cada hora.

## Uso diario

- Se trabaja **solo en el ORIGEN**. Lo que se escriba a mano en esas hojas del 2.0 se pierde
  cuando la hoja se vuelve a traer.
- *Sincronizar ahora* siempre trae las hojas completas, hayan cambiado o no.
- *Ver resultado de la última sincronización* muestra qué hojas se actualizaron.
- Si una corrida automática falla, Google envía un correo al dueño del activador.
- Los botones del panel de control de HOLCIM (🔎 APLICAR / ↺ VER TODO) usan el script del
  archivo origen; en el 2.0 se ven igual pero no filtran.
