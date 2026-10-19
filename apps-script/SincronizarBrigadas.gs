/**
 * SINCRONIZACIÓN AUTOMÁTICA: "Gestion de Brigadas" (ORIGEN) → "Gestion de Brigadas 2.0" (DESTINO)
 *
 * Este script va pegado en el archivo DESTINO (Extensiones > Apps Script).
 * Las hojas de HOJAS_A_COPIAR quedan IDÉNTICAS a las del origen: datos, colores,
 * desplegables, casillas, anchos de columna y filas. Sin IMPORTRANGE ni enlaces.
 * En la actualización automática solo se reemplaza una hoja si cambió algo en el origen.
 *
 * SEGUROS:
 *  - Si el archivo origen se borra, está en la papelera o no se puede abrir: no se toca nada.
 *  - Si una hoja del origen pierde de golpe más de MAXIMA_REDUCCION de su información respecto
 *    a la última vez que se copió (borrado masivo), esa hoja NO se copia y se avisa.
 *  - Antes del primer cambio de cada día se guarda una copia completa del 2.0 en la carpeta
 *    CARPETA_RESPALDOS de Drive (se guardan los últimos DIAS_RESPALDO). Se restaura desde
 *    el menú: 🔄 Sincronización → Restaurar desde un respaldo.
 */

// ID del archivo ORIGEN (el de la info actualizada). Es la parte de la URL entre /d/ y /edit
const ID_ORIGEN = '1yxSzgZAdRiGnLWssifVKfL0g1aPJlRRSkcYtjnYhpo0';

// Cada cuántas horas se actualiza solo (1, 2, 4, 6, 8 o 12)
const CADA_HORAS = 1;

// Si una hoja del origen queda con menos del 70 % de los datos que tenía la última vez que se copió, no se copia
const MAXIMA_REDUCCION = 0.3;

// Respaldos diarios del 2.0
const CARPETA_RESPALDOS = 'Respaldos Gestion de Brigadas 2.0';
const DIAS_RESPALDO = 30;

// Hojas que se traen completas del origen. Basta con el comienzo del nombre de la pestaña.
const HOJAS_A_COPIAR = [
  '2026 Brigadistas HOLCIM',
  '2026 Brigadistas INHOUSE',
  '2026 Cronograma Nacional Brigadas',
  // '2026 TEMARIO NACIONAL BRIGADAS',  ← quitar las // del inicio para traerla también
];

// Pestañas que Google no deja copiar completas entre archivos: se actualizan celda por celda
// (datos, fórmulas, colores y formato de números) sobre la pestaña que ya existe en el 2.0.
const HOJAS_CELDA_POR_CELDA = [
  '2026 Cronograma Nacional Brigadas',
];

// ───────────────────────────── MENÚ Y ACTIVADOR ─────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔄 Sincronización')
    .addItem('Sincronizar ahora', 'sincronizarAhora')
    .addItem('Activar actualización automática', 'activarAutomatico')
    .addItem('Desactivar actualización automática', 'desactivarAutomatico')
    .addItem('Ver resultado de la última sincronización', 'verUltimoResultado')
    .addSeparator()
    .addItem('Sincronizar aceptando un borrado grande', 'sincronizarAceptandoBorrado')
    .addItem('Restaurar desde un respaldo', 'restaurarRespaldo')
    .addSeparator()
    .addItem('🔐 Configurar usuario y clave de la app SIGBE', 'configurarUsuarioApp')
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
  SpreadsheetApp.getUi().alert('Sincronización terminada\n\n' + sincronizar_(true, false).resumen);
}

function sincronizarAceptandoBorrado() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('¿Seguro?', 'Se copiarán las hojas aunque en el origen se haya borrado mucha información ' +
    '(antes se guarda un respaldo).', ui.ButtonSet.YES_NO);
  if (ok === ui.Button.YES) ui.alert('Sincronización terminada\n\n' + sincronizar_(true, true).resumen);
}

function verUltimoResultado() {
  const txt = PropertiesService.getDocumentProperties().getProperty('ULTIMO_RESULTADO');
  SpreadsheetApp.getUi().alert(txt || 'Todavía no se ha sincronizado.');
}

// ───────────────────────────── PROCESO PRINCIPAL ─────────────────────────────

/** La llama el activador automático: si hay un error, Google le envía un correo al dueño. */
function sincronizar() {
  const r = sincronizar_(false, false);
  if (r.error) throw new Error(r.resumen);
}

/**
 * forzar = true copia todas las hojas aunque no hayan cambiado.
 * aceptarBorrado = true desactiva el seguro contra borrados masivos.
 */
function sincronizar_(forzar, aceptarBorrado) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { resumen: 'Ya había una sincronización en curso.', error: false };
  const log = [];
  try {
    const destino = SpreadsheetApp.getActiveSpreadsheet();
    const origen = abrirOrigen_();
    const props = PropertiesService.getDocumentProperties();
    limpiarCopiasDanadas_(destino);
    HOJAS_A_COPIAR.forEach(nombre => {
      try {
        const ho = buscarHoja_(origen, nombre);
        if (!ho) throw new Error('no existe en el archivo origen');
        const hd = buscarHoja_(destino, nombre);
        const huella = huella_(ho);
        if (!forzar && hd && props.getProperty('HUELLA_' + nombre) === huella) {
          log.push('= ' + nombre + ': sin cambios.');
          return;
        }
        // Base para detectar un borrado masivo: lo que tenía el origen la última vez que se copió
        const ahora = celdasConDatos_(ho);
        let antes = Number(props.getProperty('CELDAS_' + nombre)) || 0;
        if (!antes && hd && props.getProperty('HUELLA_' + nombre)) antes = celdasConDatos_(hd);
        if (!aceptarBorrado && antes && ahora < antes * (1 - MAXIMA_REDUCCION)) {
          log.push('⚠ ' + nombre + ': NO se copió. En el origen quedan ' + ahora + ' celdas con datos y la última vez había ' +
            antes + ' (posible borrado masivo). Si el cambio es correcto usa "Sincronizar aceptando un borrado grande".');
          return;
        }
        respaldoDelDia_(destino, log);
        const modo = copiarHoja_(ho, destino, hd);
        props.setProperty('HUELLA_' + nombre, huella);
        props.setProperty('CELDAS_' + nombre, String(ahora));
        log.push('✔ ' + nombre + ': actualizada' + (modo === 'contenido' ? ' (celda por celda).' : '.'));
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
  return { resumen: resumen, error: log.some(l => l.startsWith('✖') || l.startsWith('⚠')) };
}

function abrirOrigen_() {
  let archivo;
  try {
    archivo = DriveApp.getFileById(ID_ORIGEN);
  } catch (e) {
    throw new Error('no se pudo abrir el archivo origen (¿se borró o ya no hay acceso?). No se tocó nada. ' +
      'Si ya no se usa, desactiva la actualización automática.');
  }
  if (archivo.isTrashed()) {
    throw new Error('el archivo origen está en la papelera. No se tocó nada. ' +
      'Si ya no se usa, desactiva la actualización automática.');
  }
  return SpreadsheetApp.openById(ID_ORIGEN);
}

/** Pestañas del archivo que se pueden usar (Google a veces deja copias dañadas que fallan al tocarlas). */
function hojasSanas_(ss) {
  return ss.getSheets().filter(h => {
    try { h.getSheetId(); h.getLastRow(); return true; } catch (e) { return false; }
  });
}

function empiezaIgual_(a, b) {
  const clave = s => String(s).replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 31);
  return clave(a) === clave(b);
}

/** Borra las pestañas "Copia de …" / "Copy of …" de las hojas sincronizadas que dejaron intentos fallidos. */
function limpiarCopiasDanadas_(destino) {
  destino.getSheets().forEach(h => {
    try {
      const n = h.getName().replace(/^(Copia de |Copy of )/, '');
      if (n !== h.getName() && HOJAS_A_COPIAR.some(x => empiezaIgual_(n, x))) destino.deleteSheet(h);
    } catch (x) { /* si Google no la deja borrar, se ignora */ }
  });
}

/** Busca la pestaña por su nombre exacto o, si no, por cómo empieza (sin importar mayúsculas ni espacios). */
function buscarHoja_(ss, nombre) {
  const exacta = ss.getSheetByName(nombre);
  if (exacta) return exacta;
  const clave = s => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
  const corto = clave(nombre).slice(0, 31); // Excel corta los nombres a 31 letras
  return hojasSanas_(ss).find(h => clave(h.getName()).indexOf(corto) === 0) || null;
}

function celdasConDatos_(h) {
  if (h.getLastRow() === 0) return 0;
  return h.getRange(1, 1, h.getLastRow(), h.getLastColumn()).getValues()
    .reduce((n, fila) => n + fila.filter(v => v !== '' && v !== false).length, 0);
}

// ───────────────────────────── RESPALDOS ─────────────────────────────

function carpetaRespaldos_() {
  const it = DriveApp.getFoldersByName(CARPETA_RESPALDOS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA_RESPALDOS);
}

/** Una copia completa del 2.0 por día, antes del primer cambio. Borra (a la papelera) las más viejas. */
function respaldoDelDia_(destino, log) {
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const nombre = 'Respaldo 2.0 ' + hoy;
  const carpeta = carpetaRespaldos_();
  if (carpeta.getFilesByName(nombre).hasNext()) return;
  DriveApp.getFileById(destino.getId()).makeCopy(nombre, carpeta);
  log.push('💾 Respaldo guardado: ' + nombre);
  const respaldos = [];
  const it = carpeta.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('Respaldo 2.0 ') === 0) respaldos.push(f);
  }
  respaldos.sort((a, b) => b.getName().localeCompare(a.getName()));
  respaldos.slice(DIAS_RESPALDO).forEach(f => f.setTrashed(true));
}

/** Menú: vuelve a poner en el 2.0 las hojas sincronizadas tal como estaban en un respaldo. */
function restaurarRespaldo() {
  const ui = SpreadsheetApp.getUi();
  const carpeta = carpetaRespaldos_();
  const nombres = [];
  const archivos = {};
  const it = carpeta.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('Respaldo 2.0 ') === 0) { nombres.push(f.getName()); archivos[f.getName()] = f; }
  }
  if (!nombres.length) { ui.alert('Todavía no hay respaldos en la carpeta "' + CARPETA_RESPALDOS + '".'); return; }
  nombres.sort().reverse();
  const r = ui.prompt('Restaurar desde un respaldo',
    'Respaldos disponibles:\n' + nombres.map(n => n.replace('Respaldo 2.0 ', '')).join('\n') +
    '\n\nEscribe la fecha (AAAA-MM-DD) o deja vacío para el más reciente:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const fecha = r.getResponseText().trim();
  const elegido = fecha ? archivos['Respaldo 2.0 ' + fecha] : archivos[nombres[0]];
  if (!elegido) { ui.alert('No hay respaldo con la fecha ' + fecha + '.'); return; }

  const destino = SpreadsheetApp.getActiveSpreadsheet();
  const respaldo = SpreadsheetApp.openById(elegido.getId());
  const log = [];
  HOJAS_A_COPIAR.forEach(nombre => {
    const h = buscarHoja_(respaldo, nombre);
    if (!h) { log.push('– ' + nombre + ': no estaba en el respaldo.'); return; }
    copiarHoja_(h, destino, buscarHoja_(destino, nombre));
    log.push('✔ ' + nombre + ': restaurada.');
  });
  ui.alert('Restaurado desde ' + elegido.getName() + '\n\n' + log.join('\n') +
    '\n\nOjo: si el archivo origen sigue con el borrado, desactiva la actualización automática ' +
    'o corrige el origen antes de la próxima sincronización.');
}

/**
 * Trae la hoja completa del origen y reemplaza la del destino en la misma posición.
 * Si otras hojas del destino tienen fórmulas que apuntan a esta hoja, se vuelven a
 * escribir al final para que no queden en #REF!.
 */
function copiarHoja_(hojaOrigen, destino, vieja) {
  const nombre = vieja ? vieja.getName() : hojaOrigen.getName();
  const activa = destino.getActiveSheet();
  // Google a veces no deja copiar una pestaña completa entre archivos ("No se encontró la hoja …",
  // por ejemplo cuando tiene enlaces a otras pestañas). Entonces se actualiza la pestaña que ya
  // existe en el 2.0 celda por celda, y se recuerda para no volver a intentarlo cada hora.
  const props = PropertiesService.getDocumentProperties();
  const clave = 'SOLO_CONTENIDO_' + hojaOrigen.getName();
  const celdaPorCelda = HOJAS_CELDA_POR_CELDA.some(n => empiezaIgual_(hojaOrigen.getName(), n));
  if (vieja && (celdaPorCelda || props.getProperty(clave))) {
    actualizarContenido_(hojaOrigen, vieja);
    return 'contenido';
  }
  const idsAntes = hojasSanas_(destino).map(h => h.getSheetId());
  let nueva;
  try {
    nueva = hojaOrigen.copyTo(destino);
    SpreadsheetApp.flush();
    // Antes de tocar la pestaña vieja se comprueba que la copia quedó sana
    // (a veces Google la crea dañada y falla después con "No se encontró la hoja …").
    const idNueva = nueva.getSheetId();
    nueva.getLastRow();
    if (!hojasSanas_(destino).some(h => h.getSheetId() === idNueva)) throw new Error('la copia no quedó en el archivo');
  } catch (e) {
    destino.getSheets().forEach(h => {
      try { if (idsAntes.indexOf(h.getSheetId()) === -1) destino.deleteSheet(h); } catch (x) { /* copia dañada */ }
    });
    if (!vieja) throw new Error('Google no dejó copiar la pestaña (' + e.message + ') y no existe en el 2.0 para actualizarla.');
    props.setProperty(clave, e.message);
    actualizarContenido_(hojaOrigen, vieja);
    return 'contenido';
  }

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
  return 'completa';
}

/**
 * Plan B: deja la pestaña del destino igual a la del origen sin reemplazarla:
 * datos, fórmulas, colores de fondo y de letra, negritas y formato de números.
 * Solo escribe lo que cambió, así que los enlaces y bordes de las celdas iguales no se tocan.
 */
function actualizarContenido_(ho, hd) {
  if (hd.getMaxRows() < ho.getMaxRows()) hd.insertRowsAfter(hd.getMaxRows(), ho.getMaxRows() - hd.getMaxRows());
  if (hd.getMaxColumns() < ho.getMaxColumns()) hd.insertColumnsAfter(hd.getMaxColumns(), ho.getMaxColumns() - hd.getMaxColumns());
  const filas = Math.max(ho.getLastRow(), hd.getLastRow(), 1);
  const cols = Math.max(ho.getLastColumn(), hd.getLastColumn(), 1);
  const ro = ho.getRange(1, 1, filas, cols);
  const rd = hd.getRange(1, 1, filas, cols);

  const vo = ro.getValues(), fo = ro.getFormulas();
  const vd = rd.getValues(), fd = rd.getFormulas();
  for (let r = 0; r < filas; r++) {
    const nuevos = [];
    for (let c = 0; c < cols; c++) {
      let nuevo = null; // null = no tocar
      if (fo[r][c]) {
        if (fo[r][c] !== fd[r][c]) nuevo = fo[r][c];
      } else if (fd[r][c] || !iguales_(vo[r][c], vd[r][c])) {
        if (!esError_(vo[r][c])) nuevo = vo[r][c];
      }
      nuevos.push(nuevo);
    }
    escribirTramos_(hd, r + 1, nuevos);
  }

  [['getBackgrounds', 'setBackgrounds'], ['getFontColors', 'setFontColors'],
    ['getFontWeights', 'setFontWeights'], ['getNumberFormats', 'setNumberFormats']].forEach(([leer, escribir]) => {
    const a = ro[leer]();
    if (JSON.stringify(a) !== JSON.stringify(rd[leer]())) rd[escribir](a);
  });
}

/** Escribe solo las celdas con valor distinto de null, agrupadas en tramos seguidos de la fila. */
function escribirTramos_(sh, fila, nuevos) {
  let i = 0;
  while (i < nuevos.length) {
    if (nuevos[i] === null) { i++; continue; }
    let j = i;
    while (j < nuevos.length && nuevos[j] !== null) j++;
    sh.getRange(fila, i + 1, 1, j - i).setValues([nuevos.slice(i, j)]);
    i = j;
  }
}

function iguales_(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date || b instanceof Date) return false;
  return a === b;
}

function esError_(v) {
  return typeof v === 'string' && /^#(VALUE!|REF!|N\/A|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!)$/.test(v);
}

/** Celdas de otras hojas cuya fórmula menciona la hoja que se va a reemplazar. */
function guardarReferencias_(destino, nombre, excluirIds) {
  const refs = [];
  hojasSanas_(destino).forEach(h => {
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
