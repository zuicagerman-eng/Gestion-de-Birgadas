# Sincronización automática de Gestión de Brigadas

Lleva la información del archivo **ORIGEN** (*Gestion de Brigadas*, el actualizado) al archivo
**DESTINO** (*Gestion de Brigadas 2.0*) cada hora. Solo copia **valores**: no usa IMPORTRANGE ni
enlaces y no cambia formatos, colores, casillas, validaciones ni fórmulas del 2.0.

## Qué se sincroniza

| Hoja | Cómo |
|---|---|
| `2026 Cronograma Nacional Brigad` | Celda por celda (las dos hojas tienen la misma estructura). Las fórmulas de "Estado" del 2.0 se conservan. |
| `2026 Brigadistas HOLCIM` | Persona por persona (por **cédula**, o planta + nombre si no tiene) y módulo por módulo **por nombre**, porque en el 2.0 los módulos van en otro orden. Las personas nuevas se insertan al final de su planta con el mismo formato. Nunca se borran filas. |
| `2026 Brigadistas INHOUSE` | **Apagado** por defecto (`SINCRONIZAR_INHOUSE = false`). Hoy esa hoja del 2.0 tiene una copia de la lista HOLCIM; si se activa, se reemplaza por la lista INHOUSE del origen (Planta, Contratista → Empresa, Nombre, Cédula). |
| `2026 TEMARIO NACIONAL BRIGADAS` | **No** se sincroniza: en el 2.0 los módulos se reorganizaron y copiar el temario viejo los desordenaría. |

### Equivalencia de módulos (HOLCIM)

| Origen | → | 2.0 |
|---|---|---|
| M1 Acuático | → | M9 Acuático |
| M3 Minería a cielo abierto | → | M10 Minería a cielo abierto |
| M4 Planes de prevención, preparación y respuesta | → | M2 Plan de emergencias Holcim y SCI |
| M5 MATPEL | → | M3 MATPEL |
| M6 Alturas | → | M5 Alturas y espacios confinados |
| M8 Resolución 0256 | → | M8 Resolución 0256 |
| M9 Sismo | → | M7 Sismo |
| M10 Vehicular | → | M6 Vehicular |
| M11 Eléctrico | → | M4 Eléctrico |

También se copian Planta, Estado, Nombre, Cédula, Fecha de ingreso, Cumplimiento y % de cumplimiento.

No se tocan: **M1 Primer auxilio** y **M11 Harina caliente** del 2.0 (no existen en el origen).
No se copian: **M2** del origen (segundo "Acuático"), **M7 Espacios confinados** (en el 2.0 va
dentro de M5 junto con Alturas) ni **Certificado vigente 0256** (el 2.0 no tiene esa columna).
Todo esto se cambia en `MAPA_MODULOS` y `COLUMNAS_PERSONA` al inicio del script.

## Instalación (una sola vez, ~5 minutos)

1. **Ambos archivos deben estar en formato Google Sheets**, no `.xlsx`. Si al abrirlos en Drive
   aparece la etiqueta `.XLSX` junto al nombre: *Archivo → Guardar como Hojas de cálculo de Google*
   y en adelante trabaja en esa versión.
2. Abre el **ORIGEN** y copia su ID de la URL:
   `https://docs.google.com/spreadsheets/d/`**`ESTE_ES_EL_ID`**`/edit`
3. Abre el **DESTINO (2.0)** → *Extensiones → Apps Script*.
4. Borra lo que haya en `Código.gs`, pega todo el contenido de
   [`SincronizarBrigadas.gs`](SincronizarBrigadas.gs) y reemplaza
   `PEGA_AQUI_EL_ID_DEL_ARCHIVO_ORIGEN` por el ID del paso 2. Guarda (💾).
5. Recarga el 2.0. Aparece el menú **🔄 Sincronización**.
6. **🔄 Sincronización → Sincronizar ahora**. La primera vez Google pide permisos
   (*Revisar permisos → tu cuenta → Configuración avanzada → Ir a … → Permitir*).
   Al terminar muestra cuántas celdas actualizó.
7. **🔄 Sincronización → Activar actualización automática**. Desde ahí corre sola cada hora,
   aunque nadie tenga el archivo abierto.

> Recomendado antes del primer uso: *Archivo → Crear una copia* del 2.0, o fíjate en el
> historial de versiones (*Archivo → Historial de versiones*) para poder volver atrás.

## Uso diario

- Se trabaja **solo en el ORIGEN**; el 2.0 se actualiza solo. Lo que se escriba a mano en
  las columnas sincronizadas del 2.0 se sobrescribe en la siguiente corrida.
- *Ver resultado de la última sincronización* muestra qué hizo y cualquier aviso
  (por ejemplo, personas que están en el 2.0 pero no en el origen).
- Si algo falla en una corrida automática, Google envía un correo al dueño del activador.
- Seguros incluidos: si alguien mueve columnas o cambia el nombre de un módulo, esa parte
  **no se copia** (y se avisa) en lugar de escribir en el lugar equivocado.
- Ambos archivos deben tener la misma zona horaria (*Archivo → Configuración*) para que las
  fechas no se corran un día; el script avisa si no coinciden.
