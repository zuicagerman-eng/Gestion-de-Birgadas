/**
 * SINCRONIZACIÓN AUTOMÁTICA: "Gestion de Brigadas" (ORIGEN) → "Gestion de Brigadas 2.0" (DESTINO)
 *
 * Este script va pegado en el archivo DESTINO (Extensiones > Apps Script).
 * Las hojas de HOJAS_A_COPIAR quedan IDÉNTICAS a las del origen: datos, colores,
 * desplegables, casillas, anchos de columna y filas. Sin IMPORTRANGE ni enlaces.
 * En la actualización automática solo se reemplaza una hoja si cambió algo en el origen.
 */

// ID del archivo ORIGEN (el de la info actualizada). Es la parte de la URL entre /d/ y /edit
const ID_ORIGEN = 'PEGA_AQUI_EL_ID_DEL_ARCHIVO_ORIGEN';

// Cada cuántas horas se actualiza solo (1, 2, 4, 6, 8 o 12)
const CADA_HORAS = 1;

// Hojas que se traen completas del origen (mismo nombre en ambos archivos)
const HOJAS_A_COPIAR = [
  '2026 Brigadistas HOLCIM',
  '2026 Brigadistas INHOUSE',
  '2026 Cronograma Nacional Brigad',
  // '2026 TEMARIO NACIONAL BRIGADAS',  ← quitar las // del inicio para traerla también
];

// ───────────────────────────── MENÚ Y ACTIVADOR ─────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔄 Sincronización')
    .addItem('Sincronizar ahora', 'sincronizarAhora')
    .addItem('Activar actualización automática', 'activarAutomatico')
    .addItem('Desactivar actualización automática', 'desactivarAutomatico')
    .addItem('Ver resultado de la última sincronización', 'verUltimoResultado')
    .addToUi();
}

function activarAutomatico() {
  desactivarAutomatico_();
  ScriptApp.newTrigger('sincronizar').timeBased().everyHours(CADA_HORAS).create();
  avisar_('Listo: se actualizará automáticamente cada ' + CADA_HORAS + ' hora(s).');
}

function desactivarAutomatico() {
  desactivarAutomatico_();
  avisar_('Actualización automática desactivada.');
}

function desactivarAutomatico_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizar')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function sincronizarAhora() {
  SpreadsheetApp.getUi().alert('Sincronización terminada\n\n' + sincronizar_(true).resumen);
}

function verUltimoResultado() {
  const txt = PropertiesService.getDocumentProperties().getProperty('ULTIMO_RESULTADO');
  SpreadsheetApp.getUi().alert(txt || 'Todavía no se ha sincronizado.');
}

// ───────────────────────────── PROCESO PRINCIPAL ─────────────────────────────

/** La llama el activador automático: si hay un error, Google le envía un correo al dueño. */
function sincronizar() {
  const r = sincronizar_(false);
  if (r.error) throw new Error(r.resumen);
}

/** forzar = true copia todas las hojas aunque no hayan cambiado. */
function sincronizar_(forzar) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { resumen: 'Ya había una sincronización en curso.', error: false };
  const log = [];
  try {
    const destino = SpreadsheetApp.getActiveSpreadsheet();
    const origen = SpreadsheetApp.openById(ID_ORIGEN);
    const props = PropertiesService.getDocumentProperties();
    HOJAS_A_COPIAR.forEach(nombre => {
      try {
        const ho = origen.getSheetByName(nombre);
        if (!ho) throw new Error('no existe en el archivo origen');
        const huella = huella_(ho);
        if (!forzar && destino.getSheetByName(nombre) && props.getProperty('HUELLA_' + nombre) === huella) {
          log.push('= ' + nombre + ': sin cambios.');
          return;
        }
        copiarHoja_(ho, destino);
        props.setProperty('HUELLA_' + nombre, huella);
        log.push('✔ ' + nombre + ': actualizada.');
      } catch (e) {
        log.push('✖ ' + nombre + ': ' + e.message);
      }
    });
  } catch (e) {
    log.push('✖ ' + e.message);
  } finally {
    lock.releaseLock();
  }
  const resumen = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') +
    '\n' + log.join('\n');
  PropertiesService.getDocumentProperties().setProperty('ULTIMO_RESULTADO', resumen);
  console.log(resumen);
  return { resumen: resumen, error: log.some(l => l.startsWith('✖')) };
}

/**
 * Trae la hoja completa del origen y reemplaza la del destino en la misma posición.
 * Si otras hojas del destino tienen fórmulas que apuntan a esta hoja, se vuelven a
 * escribir al final para que no queden en #REF!.
 */
function copiarHoja_(hojaOrigen, destino) {
  const nombre = hojaOrigen.getName();
  const vieja = destino.getSheetByName(nombre);
  const activa = destino.getActiveSheet();
  const nueva = hojaOrigen.copyTo(destino);

  let posicion = destino.getNumSheets();
  let referencias = [];
  if (vieja) {
    posicion = vieja.getIndex();
    referencias = guardarReferencias_(destino, nombre, [vieja.getSheetId(), nueva.getSheetId()]);
    destino.deleteSheet(vieja);
  }
  nueva.setName(nombre);
  destino.setActiveSheet(nueva);
  destino.moveActiveSheet(posicion);
  referencias.forEach(r => r.hoja.getRange(r.fila, r.col).setFormula(r.formula));
  if (activa && activa.getName() !== nombre) destino.setActiveSheet(activa);
}

/** Celdas de otras hojas cuya fórmula menciona la hoja que se va a reemplazar. */
function guardarReferencias_(destino, nombre, excluirIds) {
  const refs = [];
  destino.getSheets().forEach(h => {
    if (excluirIds.indexOf(h.getSheetId()) !== -1 || h.getLastRow() === 0) return;
    h.getRange(1, 1, h.getLastRow(), h.getLastColumn()).getFormulas().forEach((fila, i) => {
      fila.forEach((f, j) => {
        if (f && f.indexOf(nombre) !== -1) refs.push({ hoja: h, fila: i + 1, col: j + 1, formula: f });
      });
    });
  });
  return refs;
}

/** Resumen corto del contenido y formato de la hoja, para saber si cambió algo. */
function huella_(h) {
  const r = h.getRange(1, 1, Math.max(h.getLastRow(), 1), Math.max(h.getLastColumn(), 1));
  const datos = JSON.stringify([
    h.getMaxRows(), h.getMaxColumns(), r.getValues(), r.getFormulas(),
    r.getBackgrounds(), r.getNumberFormats(), r.getMergedRanges().map(m => m.getA1Notation()),
  ]);
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, datos));
}

function avisar_(msg) {
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Sincronización', 8); } catch (e) { console.log(msg); }
}
