/**
 * SINCRONIZACIÓN AUTOMÁTICA: archivo ORIGINAL ("Gestion de Brigadas") → archivo 2.0 ("Gestion de Brigadas 2.0")
 *
 * Este archivo forma parte de un PROYECTO INDEPENDIENTE de Apps Script (no va dentro de ninguna hoja).
 * Los archivos se configuran en las Propiedades del script (Configuración del proyecto → Propiedades del
 * script) o desde la pantalla "Configuración" de la app SIGBE:
 *   SIGBE_ID_DESTINO  → URL o ID del archivo 2.0 (obligatorio)
 *   SIGBE_ID_ORIGEN   → URL o ID del archivo original, o NINGUNO si se trabaja solo con el 2.0
 *   SIGBE_CADA_HORAS  → cada cuántas horas corre la actualización automática (1, 2, 4, 6, 8 o 12)
 *
 * Las hojas de HOJAS_A_COPIAR quedan IDÉNTICAS a las del original: datos, colores, desplegables,
 * casillas, anchos de columna y filas. Sin IMPORTRANGE ni enlaces. En la actualización automática
 * solo se reemplaza una hoja si cambió algo en el original.
 *
 * SEGUROS:
 *  - Si el original se borra, está en la papelera o no se puede abrir: no se toca nada.
 *  - Si una hoja del original pierde de golpe más de MAXIMA_REDUCCION de su información respecto a la
 *    última vez que se copió (borrado masivo), esa hoja NO se copia y se avisa.
 *  - Antes del primer cambio de cada día se guarda una copia completa del 2.0 en la carpeta
 *    CARPETA_RESPALDOS de Drive (se guardan los últimos DIAS_RESPALDO). Se restaura desde la app.
 */

// Si una hoja del original queda con menos del 70 % de los datos que tenía la última vez que se copió, no se copia
const MAXIMA_REDUCCION = 0.3;

// Respaldos diarios (carpeta en el Drive de la cuenta que ejecuta el script)
const CARPETA_RESPALDOS = 'Respaldos Gestion de Brigadas 2.0';
const DIAS_RESPALDO = 30;

// Hojas que se traen completas del original. Basta con el comienzo del nombre de la pestaña.
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

// ───────────────────────────── CONFIGURACIÓN (propiedades del script) ─────────────────────────────

function props_() { return PropertiesService.getScriptProperties(); }
function prop_(k) { return props_().getProperty(k); }

/** Acepta la URL completa de una hoja de cálculo o solo su ID. */
function idDesdeTexto_(t) {
  const s = String(t || '').trim();
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : s;
}

function idDestino_() { return idDesdeTexto_(prop_('SIGBE_ID_DESTINO')); }

/** { modo: 'configurado' | 'ninguno' | 'sin_configurar', id } */
function configOrigen_() {
  const v = String(prop_('SIGBE_ID_ORIGEN') || '').trim();
  if (!v) return { modo: 'sin_configurar', id: '' };
  if (/^NINGUNO$/i.test(v)) return { modo: 'ninguno', id: '' };
  return { modo: 'configurado', id: idDesdeTexto_(v) };
}

function cadaHoras_() {
  const n = Number(prop_('SIGBE_CADA_HORAS')) || 1;
  return [1, 2, 4, 6, 8, 12].indexOf(n) === -1 ? 1 : n;
}

/** El archivo 2.0 (donde viven Indicador, Cronograma, la bitácora y las copias de HOLCIM/INHOUSE). */
function destino_() {
  const id = idDestino_();
  if (!id) throw new Error('No está configurado el archivo 2.0 (propiedad SIGBE_ID_DESTINO). Configúralo en la app o en Configuración del proyecto → Propiedades del script.');
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('No se pudo abrir el archivo 2.0 (' + id + '): ' + e.message + '. Revisa el ID y que la cuenta que ejecuta el script tenga permiso de edición.');
  }
}

function abrirOrigen_() {
  const cfg = configOrigen_();
  if (cfg.modo === 'sin_configurar') throw new Error('No hay archivo original configurado (propiedad SIGBE_ID_ORIGEN). Pon su URL o escribe NINGUNO si se trabaja solo con el 2.0.');
  if (cfg.modo === 'ninguno') throw new Error('Está configurado trabajar sin archivo original (NINGUNO).');
  let archivo;
  try {
    archivo = DriveApp.getFileById(cfg.id);
  } catch (e) {
    throw new Error('no se pudo abrir el archivo original (¿se borró, está mal el ID o ya no hay acceso?). No se tocó nada. ' +
      'Si ya no se usa, escribe NINGUNO en el archivo original y desactiva la actualización automática.');
  }
  if (archivo.isTrashed()) {
    throw new Error('el archivo original está en la papelera. No se tocó nada. ' +
      'Si ya no se usa, escribe NINGUNO en el archivo original y desactiva la actualización automática.');
  }
  return SpreadsheetApp.openById(cfg.id);
}

// ───────────────────────────── ACTIVADOR AUTOMÁTICO ─────────────────────────────

/** Crea (o reemplaza) el activador que llama a sincronizar() cada N horas. */
function activarAutomatico_(cadaHoras) {
  const n = [1, 2, 4, 6, 8, 12].indexOf(Number(cadaHoras)) === -1 ? cadaHoras_() : Number(cadaHoras);
  desactivarAutomatico_();
  ScriptApp.newTrigger('sincronizar').timeBased().everyHours(n).create();
  props_().setProperty('SIGBE_CADA_HORAS', String(n));
  return n;
}

function desactivarAutomatico_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizar')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function automaticoActivo_() {
  return ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'sincronizar');
}

// ───────────────────────────── PROCESO PRINCIPAL ─────────────────────────────

/** La llama el activador automático: si hay un error, Google le envía un correo al dueño. */
function sincronizar() {
  const r = sincronizar_(false, false, 'automatica');
  if (r.error) throw new Error(r.resumen);
}

/**
 * forzar = true copia todas las hojas aunque no hayan cambiado.
 * aceptarBorrado = true desactiva el seguro contra borrados masivos.
 * origenLlamada: 'automatica' (activador) o 'app' (SIGBE).
 * Deja el resultado en ULTIMO_RESULTADO (texto) y ULTIMO_RESULTADO_JSON (para la app).
 */
function sincronizar_(forzar, aceptarBorrado, origenLlamada) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { resumen: 'Ya había una sincronización en curso.', error: false, enCurso: true };
  const inicio = Date.now();
  const log = [];
  try {
    const cfg = configOrigen_();
    if (cfg.modo === 'ninguno') {
      log.push('ℹ Se trabaja solo con el archivo 2.0 (sin archivo original): no hay nada que sincronizar.');
    } else {
      const destino = destino_();
      const origen = abrirOrigen_();
      const props = props_();
      if (origen.getSpreadsheetTimeZone() !== destino.getSpreadsheetTimeZone()) {
        log.push('ℹ Zonas horarias distintas (original: ' + origen.getSpreadsheetTimeZone() + ', 2.0: ' + destino.getSpreadsheetTimeZone() +
          '). Las fechas podrían correrse un día; iguálalas en Archivo → Configuración de cada hoja.');
      }
      limpiarCopiasDanadas_(destino);
      HOJAS_A_COPIAR.forEach(nombre => {
        try {
          const ho = buscarHoja_(origen, nombre);
          if (!ho) throw new Error('no existe en el archivo original');
          const hd = buscarHoja_(destino, nombre);
          const huella = huella_(ho);
          if (!forzar && hd && props.getProperty('HUELLA_' + nombre) === huella) {
            log.push('= ' + nombre + ': sin cambios.');
            return;
          }
          // Base para detectar un borrado masivo: lo que tenía el original la última vez que se copió
          const ahora = celdasConDatos_(ho);
          let antes = Number(props.getProperty('CELDAS_' + nombre)) || 0;
          if (!antes && hd && props.getProperty('HUELLA_' + nombre)) antes = celdasConDatos_(hd);
          if (!aceptarBorrado && antes && ahora < antes * (1 - MAXIMA_REDUCCION)) {
            log.push('⚠ ' + nombre + ': NO se copió. En el original quedan ' + ahora + ' celdas con datos y la última vez había ' +
              antes + ' (posible borrado masivo). Si el cambio es correcto usa "Sincronizar aceptando un borrado grande" en Configuración.');
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
    }
  } catch (e) {
    log.push('✖ ' + e.message);
  } finally {
    lock.releaseLock();
  }
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const resumen = fecha + '\n' + log.join('\n');
  const error = log.some(l => l.indexOf('✖') === 0 || l.indexOf('⚠') === 0);
  const prefijos = [['✔', 'ok'], ['=', 'igual'], ['⚠', 'aviso'], ['✖', 'error'], ['💾', 'respaldo'], ['ℹ', 'info']];
  const clasificar = l => {
    const p = prefijos.find(x => l.indexOf(x[0]) === 0);
    return p ? { tipo: p[1], texto: l.slice(p[0].length).trim() } : { tipo: 'info', texto: l };
  };
  const detalle = {
    fecha: fecha,
    duracionSeg: Math.round((Date.now() - inicio) / 1000),
    origen: origenLlamada || 'app',
    error: error,
    lineas: log.map(clasificar),
  };
  try {
    const props = props_();
    props.setProperty('ULTIMO_RESULTADO', resumen);
    props.setProperty('ULTIMO_RESULTADO_JSON', JSON.stringify(detalle));
    if (!error) props.setProperty('ULTIMA_SYNC_OK', fecha);
  } catch (e) { /* sin propiedades (no debería pasar) */ }
  console.log(resumen);
  return { resumen: resumen, error: error, detalle: detalle };
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

/** Respaldos disponibles en la carpeta: [{ tipo: '2.0' | 'original', fecha, nombre, id }], más recientes primero. */
function listarRespaldos_() {
  const it = DriveApp.getFoldersByName(CARPETA_RESPALDOS);
  if (!it.hasNext()) return [];
  const files = it.next().getFiles();
  const lista = [];
  while (files.hasNext()) {
    const f = files.next();
    const n = f.getName();
    if (n.indexOf('Respaldo 2.0 ') === 0) lista.push({ tipo: '2.0', fecha: n.replace('Respaldo 2.0 ', ''), nombre: n, id: f.getId() });
    else if (n.indexOf('Respaldo ORIGINAL ') === 0) lista.push({ tipo: 'original', fecha: n.replace('Respaldo ORIGINAL ', ''), nombre: n, id: f.getId() });
  }
  return lista.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.tipo.localeCompare(b.tipo));
}

/** Vuelve a poner en el 2.0 las hojas sincronizadas tal como estaban en el respaldo del 2.0 de esa fecha. */
function restaurarRespaldo_(fecha) {
  const r = listarRespaldos_().find(x => x.tipo === '2.0' && x.fecha === fecha);
  if (!r) throw new Error('No hay respaldo del 2.0 con fecha ' + fecha + '.');
  const destino = destino_();
  const respaldo = SpreadsheetApp.openById(r.id);
  const log = [];
  HOJAS_A_COPIAR.forEach(nombre => {
    const h = buscarHoja_(respaldo, nombre);
    if (!h) { log.push('– ' + nombre + ': no estaba en el respaldo.'); return; }
    copiarHoja_(h, destino, buscarHoja_(destino, nombre));
    log.push('✔ ' + nombre + ': restaurada.');
  });
  return { nombre: r.nombre, lineas: log };
}

/**
 * Trae la hoja completa del original y reemplaza la del destino en la misma posición.
 * Si otras hojas del destino tienen fórmulas que apuntan a esta hoja, se vuelven a
 * escribir al final para que no queden en #REF!.
 */
function copiarHoja_(hojaOrigen, destino, vieja) {
  const nombre = vieja ? vieja.getName() : hojaOrigen.getName();
  // Google a veces no deja copiar una pestaña completa entre archivos ("No se encontró la hoja …",
  // por ejemplo cuando tiene enlaces a otras pestañas). Entonces se actualiza la pestaña que ya
  // existe en el 2.0 celda por celda, y se recuerda para no volver a intentarlo cada hora.
  const props = props_();
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
  return 'completa';
}

/**
 * Plan B: deja la pestaña del destino igual a la del original sin reemplazarla:
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
