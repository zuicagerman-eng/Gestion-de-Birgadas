/**
 * ARCHIVOS, COPIAS Y RESPALDOS (utilidades compartidas por SIGBE.gs y LibroNuevo.gs).
 *
 * Desde la versión 4 ya NO existe la sincronización "original → 2.0" (copiaba la pestaña HOLCIM oculta del
 * 1.0 encima de la lista de asistencia del 2.0). Lo que corre cada hora es libroNuevoActualizar (LibroNuevo.gs):
 * trae el 1.0 y el 2.0 al libro nuevo hasta el corte y anota los cambios hechos directamente en el Excel.
 *
 * Propiedades del script:
 *   SIGBE_ID_ORIGEN   → URL o ID del 1.0 (archivo original), o NINGUNO
 *   SIGBE_ID_DESTINO  → URL o ID del 2.0 (donde está la lista de asistencia HOLCIM)
 *   LIBRO_NUEVO_ID    → URL o ID del libro nuevo (lo crea libroNuevoCrear)
 *   SIGBE_CADA_HORAS  → cada cuántas horas corre la tarea automática (1, 2, 4, 6, 8 o 12)
 *
 * Seguros: si una pestaña de origen pierde de golpe más de MAXIMA_REDUCCION de su información, no se copia;
 * antes del primer cambio del día que hace la app en un archivo se guarda una copia completa en Drive.
 */

// Si una hoja del original queda con menos del 70 % de los datos que tenía la última vez que se copió, no se copia
const MAXIMA_REDUCCION = 0.3;

// Respaldos diarios (carpeta en el Drive de la cuenta que ejecuta el script)
const CARPETA_RESPALDOS = 'Respaldos Gestion de Brigadas 2.0'; // se conserva el nombre de siempre
const DIAS_RESPALDO = 30;

// Pestañas que Google no deja copiar completas entre archivos: se actualizan celda por celda
// (datos, fórmulas, colores y formato de números) sobre la pestaña que ya existe en el 2.0.
const HOJAS_CELDA_POR_CELDA = [
  '2026 Cronograma Nacional Brigadas',
];

// ───────────────────────────── CONFIGURACIÓN (propiedades del script) ─────────────────────────────

// Cada lectura de una propiedad es una llamada a Google: se leen todas una vez por ejecución y se guardan aquí.
// Lo que se escribe con props_() actualiza también esta copia. Para leer-modificar-escribir algo que otra
// ejecución puede cambiar a la vez (la cola de avisos), usar propsFrescas_() dentro del bloqueo.
let sigbePropsMemo_ = null;
function props_() {
  const p = PropertiesService.getScriptProperties();
  if (!sigbePropsMemo_) sigbePropsMemo_ = p.getProperties();
  const m = sigbePropsMemo_;
  const w = {
    getProperty: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    getProperties: () => Object.assign({}, m),
    setProperty: (k, v) => { p.setProperty(k, v); m[k] = String(v); return w; },
    setProperties: o => { p.setProperties(o); Object.keys(o).forEach(k => { m[k] = String(o[k]); }); return w; },
    deleteProperty: k => { p.deleteProperty(k); delete m[k]; return w; },
  };
  return w;
}
function prop_(k) { return props_().getProperty(k); }
function propsFrescas_() { sigbePropsMemo_ = null; return props_(); }

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
  revisarArchivo_(cfg.id, 'original (SIGBE_ID_ORIGEN)');
  return SpreadsheetApp.openById(cfg.id);
}

/** Cuenta con la que corre el script (la que necesita acceso a los archivos). */
function cuentaScript_() {
  try { return Session.getEffectiveUser().getEmail() || '(desconocida)'; } catch (e) { return '(desconocida)'; }
}

/** Comprueba que el archivo exista, que esta cuenta lo vea, que no esté en la papelera y que sea una Hoja de Google. */
function revisarArchivo_(id, cual) {
  const cuenta = cuentaScript_();
  let archivo;
  try {
    archivo = DriveApp.getFileById(id);
  } catch (e) {
    throw new Error('no se pudo abrir el archivo ' + cual + ' con el ID ' + id + '. La cuenta ' + cuenta +
      ' no lo ve: o el ID está mal, o el archivo no está compartido con esa cuenta (si es de un dominio corporativo, ' +
      'puede que no se permita compartir con cuentas de fuera). Abre el enlace con esa cuenta para comprobarlo. No se tocó nada.');
  }
  if (archivo.isTrashed()) throw new Error('el archivo ' + cual + ' está en la papelera. No se tocó nada.');
  const tipo = archivo.getMimeType();
  if (tipo !== 'application/vnd.google-apps.spreadsheet') {
    throw new Error('el archivo ' + cual + ' ("' + archivo.getName() + '") no es una Hoja de cálculo de Google sino ' +
      (/sheet|excel/i.test(tipo) ? 'un Excel subido a Drive' : 'un archivo de tipo ' + tipo) +
      '. Ábrelo y usa Archivo → Guardar como Hojas de cálculo de Google, y pon la URL de esa copia. No se tocó nada.');
  }
  return archivo;
}

// ───────────────────────────── ACTIVADOR AUTOMÁTICO ─────────────────────────────

/** Crea (o reemplaza) el activador de la tarea de cada N horas (libroNuevoActualizar). */
function activarAutomatico_(cadaHoras) {
  const n = [1, 2, 4, 6, 8, 12].indexOf(Number(cadaHoras)) === -1 ? cadaHoras_() : Number(cadaHoras);
  desactivarAutomatico_();
  ScriptApp.newTrigger('libroNuevoActualizar').timeBased().everyHours(n).create();
  props_().setProperty('SIGBE_CADA_HORAS', String(n));
  return n;
}

/** Quita el activador de la tarea y también el de la sincronización vieja (versión 3), si quedó alguno. */
function desactivarAutomatico_() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['libroNuevoActualizar', 'sincronizar'].indexOf(t.getHandlerFunction()) !== -1)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function automaticoActivo_() {
  return ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'libroNuevoActualizar');
}

/** Compatibilidad con la versión 3: si quedó un activador viejo, ahora hace la tarea nueva (nunca copia 1.0 → 2.0). */
function sincronizar() { return libroNuevoActualizar(); }

/** Compatibilidad con la versión 3 (actualización rápida tras guardar desde la app). */
function sincronizarPendiente() { return libroNuevoPendiente(); }

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

/**
 * Copia completa del archivo antes del primer cambio del día que hace la app en él
 * ("Respaldo <nombre> yyyy-MM-dd"). Guarda los últimos DIAS_RESPALDO de cada archivo.
 */
function respaldoDelDia_(ss) {
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const prefijo = 'Respaldo ' + ss.getName() + ' ';
  const carpeta = carpetaRespaldos_();
  if (carpeta.getFilesByName(prefijo + hoy).hasNext()) return false;
  DriveApp.getFileById(ss.getId()).makeCopy(prefijo + hoy, carpeta);
  const viejos = [];
  const it = carpeta.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(prefijo) === 0 && /\d{4}-\d{2}-\d{2}$/.test(f.getName())) viejos.push(f);
  }
  viejos.sort((a, b) => b.getName().localeCompare(a.getName()));
  viejos.slice(DIAS_RESPALDO).forEach(f => f.setTrashed(true));
  return true;
}

/** Respaldos de la carpeta: [{ archivo, fecha, nombre, url }], más recientes primero. */
function listarRespaldos_() {
  const it = DriveApp.getFoldersByName(CARPETA_RESPALDOS);
  if (!it.hasNext()) return [];
  const files = it.next().getFiles();
  const lista = [];
  while (files.hasNext()) {
    const f = files.next();
    const m = f.getName().match(/^Respaldo (.+) (\d{4}-\d{2}-\d{2})$/);
    if (m) lista.push({ archivo: m[1], fecha: m[2], nombre: f.getName(), url: f.getUrl() });
  }
  return lista.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.archivo.localeCompare(b.archivo));
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
