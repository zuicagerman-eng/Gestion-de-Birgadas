/**
 * SINCRONIZACIÓN AUTOMÁTICA: "Gestion de Brigadas" (ORIGEN) → "Gestion de Brigadas 2.0" (DESTINO)
 *
 * Este script va pegado en el archivo DESTINO (Extensiones > Apps Script).
 * Copia SOLO VALORES (nada de formatos, nada de IMPORTRANGE ni enlaces) y nunca
 * toca colores, bordes, anchos, validaciones, casillas ni fórmulas del destino.
 *
 * Qué sincroniza:
 *  - "2026 Cronograma Nacional Brigad": misma estructura en ambos → celda por celda.
 *    Las fórmulas del destino (columna "Estado") se respetan y se recalculan solas.
 *  - "2026 Brigadistas HOLCIM": estructuras distintas → se empareja cada persona por
 *    CÉDULA (o por planta + nombre si no tiene) y cada módulo por su NOMBRE, porque en
 *    el 2.0 los módulos están en otro orden (ver MAPA_MODULOS).
 *    Las personas nuevas se insertan al final de su planta copiando el formato de la fila
 *    de arriba. Nunca se borran filas.
 *  - "2026 Brigadistas INHOUSE": APAGADO por defecto (ver SINCRONIZAR_INHOUSE).
 *  - "2026 TEMARIO NACIONAL BRIGADAS": NO se sincroniza; en el 2.0 los módulos se
 *    reorganizaron y copiar el temario viejo encima lo desordenaría.
 */

// ───────────────────────────── CONFIGURACIÓN ─────────────────────────────

// ID del archivo ORIGEN (el de la info actualizada). Es la parte de la URL entre /d/ y /edit
const ID_ORIGEN = 'PEGA_AQUI_EL_ID_DEL_ARCHIVO_ORIGEN';

// Cada cuántas horas se actualiza solo (1, 2, 4, 6, 8 o 12)
const CADA_HORAS = 1;

const HOJA_CRONOGRAMA = '2026 Cronograma Nacional Brigad';
const HOJA_HOLCIM = '2026 Brigadistas HOLCIM';
const HOJA_INHOUSE = '2026 Brigadistas INHOUSE';

// La hoja INHOUSE del 2.0 hoy contiene una copia de la lista HOLCIM. Si se pone en true,
// el contenido de sus filas de datos se reemplaza por la lista INHOUSE del origen
// (solo contenido: formatos, casillas y validaciones se conservan).
const SINCRONIZAR_INHOUSE = false;

// Columnas de datos personales: [encabezado en ORIGEN, encabezado en DESTINO]
const COLUMNAS_PERSONA = [
  ['PLANTA', 'PLANTA'],
  ['ESTADO', 'ESTADO'],
  ['NOMBRE Y APELLIDO', 'NOMBRE Y APELLIDO'],
  ['CÉDULA', 'CÉDULA'],
  ['FECHA DE INGRESO A LA BRIGADA', 'FECHA DE INGRESO A LA BRIGADA'],
  ['Cummplimiento del (los) Modulo(s) (individual)', 'Cummplimiento del (los) Modulo(s) (individual)'],
  ['% de cumplimiento (individual)', '% de cumplimiento (individual)'],
];

// Módulos: [código ORIGEN, palabra clave ORIGEN, código DESTINO, palabra clave DESTINO]
// La palabra clave es un seguro: si alguien reordena módulos y ya no coincide,
// ese módulo NO se copia (se avisa en el registro) en vez de escribir en la columna equivocada.
// Sin pareja en el origen (quedan como están en el 2.0): M1 Primer auxilio, M11 Harina caliente.
// Sin pareja en el destino (no se copian): M2 (segundo "Acuático"), M7 Espacios confinados
// (en el 2.0 va junto con Alturas en M5, que se llena desde M6 Alturas).
const MAPA_MODULOS = [
  ['M1', 'ACUATICO', 'M9', 'ACUATICO'],
  ['M3', 'MINERIA', 'M10', 'MINERIA'],
  ['M4', 'PLANES DE PREVENCION', 'M2', 'PLAN DE EMERGENCIAS'],
  ['M5', 'MATPEL', 'M3', 'MATPEL'],
  ['M6', 'ALTURAS', 'M5', 'ALTURAS'],
  ['M8', '0256', 'M8', '0256'],
  ['M9', 'SISMO', 'M7', 'SISMO'],
  ['M10', 'VEHICULAR', 'M6', 'VEHICULAR'],
  ['M11', 'ELECTRICO', 'M4', 'ELECTRICO'],
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
  SpreadsheetApp.getUi().alert('Sincronización terminada\n\n' + sincronizar_().resumen);
}

function verUltimoResultado() {
  const txt = PropertiesService.getDocumentProperties().getProperty('ULTIMO_RESULTADO');
  SpreadsheetApp.getUi().alert(txt || 'Todavía no se ha sincronizado.');
}

// ───────────────────────────── PROCESO PRINCIPAL ─────────────────────────────

/** La llama el activador automático: si hay un error, Google le envía un correo al dueño. */
function sincronizar() {
  const r = sincronizar_();
  if (r.error) throw new Error(r.resumen);
  return r.resumen;
}

function sincronizar_() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { resumen: 'Ya había una sincronización en curso.', error: false };
  const log = [];
  try {
    const destino = SpreadsheetApp.getActiveSpreadsheet();
    const origen = SpreadsheetApp.openById(ID_ORIGEN);
    if (origen.getSpreadsheetTimeZone() !== destino.getSpreadsheetTimeZone()) {
      log.push('⚠ Las zonas horarias de los archivos son distintas (' + origen.getSpreadsheetTimeZone() +
        ' vs ' + destino.getSpreadsheetTimeZone() + '); las fechas podrían correrse un día.');
    }
    const pasos = [
      ['Cronograma', () => sincronizarCronograma_(origen, destino, log)],
      ['HOLCIM', () => sincronizarBrigadistas_(origen, destino, log)],
    ];
    if (SINCRONIZAR_INHOUSE) pasos.push(['INHOUSE', () => sincronizarInhouse_(origen, destino, log)]);
    pasos.forEach(([nombre, fn]) => {
      try { fn(); } catch (e) { log.push('✖ ' + nombre + ': ' + e.message); }
    });
  } catch (e) {
    log.push('✖ ' + e.message);
  } finally {
    lock.releaseLock();
  }
  const resumen = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') +
    '\n' + log.join('\n');
  PropertiesService.getDocumentProperties().setProperty('ULTIMO_RESULTADO', resumen.slice(0, 8000));
  console.log(resumen);
  return { resumen: resumen, error: log.some(l => l.startsWith('✖')) };
}

// ───────────────────────────── CRONOGRAMA ─────────────────────────────

function sincronizarCronograma_(origen, destino, log) {
  const so = hoja_(origen, HOJA_CRONOGRAMA);
  const sd = hoja_(destino, HOJA_CRONOGRAMA);
  const filas = Math.min(Math.max(so.getLastRow(), sd.getLastRow()), so.getMaxRows(), sd.getMaxRows());
  const cols = Math.min(so.getLastColumn(), sd.getLastColumn());
  const vo = so.getRange(1, 1, filas, cols).getValues();
  const fo = so.getRange(1, 1, filas, cols).getFormulas();
  const vd = sd.getRange(1, 1, filas, cols).getValues();
  const fd = sd.getRange(1, 1, filas, cols).getFormulas();

  // Seguro: los 3 renglones de encabezado (plantas / sesiones / columnas) deben ser iguales
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < cols; c++) {
      if (norm_(vo[r][c]) !== norm_(vd[r][c])) {
        throw new Error('los encabezados no coinciden en ' + celda_(r + 1, c + 1) +
          '; no se copió nada para no desordenar la hoja.');
      }
    }
  }

  let cambios = 0;
  for (let r = 3; r < filas; r++) {
    // Seguro por fila: el nombre del entrenamiento (col. B) debe ser el mismo
    if (norm_(vo[r][1]) !== norm_(vd[r][1]) && norm_(vd[r][1]) !== '') {
      log.push('  Cronograma fila ' + (r + 1) + ': el entrenamiento no coincide, se omitió.');
      continue;
    }
    const nuevos = [];
    for (let c = 0; c < cols; c++) {
      let nuevo = null; // null = no tocar
      if (fd[r][c]) {
        nuevo = null; // la fórmula del destino se respeta
      } else if (fo[r][c] && fo[r][c].indexOf('!') === -1) {
        nuevo = fo[r][c]; // misma fórmula local (sin referencias a otras hojas)
      } else if (!esError_(vo[r][c]) && !iguales_(vo[r][c], vd[r][c])) {
        nuevo = vo[r][c];
      }
      nuevos.push(nuevo);
    }
    cambios += escribirTramos_(sd, r + 1, nuevos);
  }
  log.push('✔ Cronograma: ' + cambios + ' celda(s) actualizada(s).');
}

// ───────────────────────────── BRIGADISTAS HOLCIM ─────────────────────────────

function sincronizarBrigadistas_(origen, destino, log) {
  const so = hoja_(origen, HOJA_HOLCIM);
  const sd = hoja_(destino, HOJA_HOLCIM);
  const eo = estructura_(so);
  const ed = estructura_(sd);

  // Pares de columnas [col origen, col destino] (1-based)
  const pares = [];
  COLUMNAS_PERSONA.forEach(([ho, hd]) => {
    const co = eo.encabezados[norm_(ho)];
    const cd = ed.encabezados[norm_(hd)];
    if (co && cd) pares.push([co, cd]);
    else log.push('  HOLCIM: no se encontró la columna "' + (co ? hd : ho) + '", se omitió.');
  });
  MAPA_MODULOS.forEach(([mo, kwo, md, kwd]) => {
    const a = eo.modulos[mo];
    const b = ed.modulos[md];
    if (!a || !b || norm_(a.titulo).indexOf(kwo) === -1 || norm_(b.titulo).indexOf(kwd) === -1) {
      log.push('  HOLCIM: el módulo ' + mo + '→' + md + ' no coincide con su nombre esperado, se omitió.');
      return;
    }
    if (a.ancho !== b.ancho) {
      log.push('  HOLCIM: ' + mo + '→' + md + ' tienen distinto número de columnas, se omitió.');
      return;
    }
    for (let i = 0; i < a.ancho; i++) pares.push([a.col + i, b.col + i]);
  });

  const colCedO = eo.encabezados[norm_('CÉDULA')];
  const colNomO = eo.encabezados[norm_('NOMBRE Y APELLIDO')];
  const colCedD = ed.encabezados[norm_('CÉDULA')];
  const colNomD = ed.encabezados[norm_('NOMBRE Y APELLIDO')];

  const filasOrigen = leerFilas_(so, eo.filaEncabezado, colCedO, colNomO);

  // 1) Insertar al final de su planta a las personas que aún no existen en el destino
  let filasDestino = leerFilas_(sd, ed.filaEncabezado, colCedD, colNomD);
  const faltantes = filasOrigen.filter(fo => !emparejar_(fo, filasDestino, new Set()));
  if (faltantes.length) {
    const porPosicion = {};
    faltantes.forEach(fo => {
      const pos = ultimaFilaDePlanta_(filasDestino, fo.planta) ||
        (filasDestino.length ? filasDestino[filasDestino.length - 1].fila : ed.filaEncabezado);
      (porPosicion[pos] = porPosicion[pos] || []).push(fo);
    });
    const ancho = sd.getMaxColumns();
    Object.keys(porPosicion).map(Number).sort((x, y) => y - x).forEach(pos => {
      const grupo = porPosicion[pos];
      sd.insertRowsAfter(pos, grupo.length);
      const modelo = sd.getRange(pos, 1, 1, ancho);
      const nuevas = sd.getRange(pos + 1, 1, grupo.length, ancho);
      modelo.copyTo(nuevas, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      modelo.copyTo(nuevas, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
      grupo.forEach((fo, i) => {
        sd.getRange(pos + 1 + i, colCedD).setValue(fo.valores[colCedO - 1]);
        sd.getRange(pos + 1 + i, colNomD).setValue(fo.valores[colNomO - 1]);
      });
    });
    log.push('✔ HOLCIM: ' + faltantes.length + ' persona(s) nueva(s) agregada(s): ' +
      faltantes.map(f => f.valores[colNomO - 1]).join(', ') + '.');
    filasDestino = leerFilas_(sd, ed.filaEncabezado, colCedD, colNomD);
  }

  // 2) Actualizar valores fila por fila
  const usadas = new Set();
  let celdas = 0;
  let personas = 0;
  filasOrigen.forEach(fo => {
    const fd = emparejar_(fo, filasDestino, usadas);
    if (!fd) return;
    usadas.add(fd.fila);
    const nuevos = new Array(fd.valores.length).fill(null);
    pares.forEach(([co, cd]) => {
      const v = fo.valores[co - 1];
      if (!fd.formulas[cd - 1] && !esError_(v) && !iguales_(v, fd.valores[cd - 1])) nuevos[cd - 1] = v;
    });
    const n = escribirTramos_(sd, fd.fila, nuevos);
    if (n) { celdas += n; personas++; }
  });
  const sobrantes = filasDestino.filter(fd => !usadas.has(fd.fila));
  log.push('✔ HOLCIM: ' + celdas + ' celda(s) actualizada(s) en ' + personas + ' fila(s).');
  if (sobrantes.length) {
    log.push('  HOLCIM: en el 2.0 hay ' + sobrantes.length + ' fila(s) que no están en el origen (no se tocaron): ' +
      sobrantes.map(f => f.valores[colNomD - 1] || f.valores[0]).join(', ') + '.');
  }
}

// ───────────────────────────── INHOUSE (opcional) ─────────────────────────────

function sincronizarInhouse_(origen, destino, log) {
  const so = hoja_(origen, HOJA_INHOUSE);
  const sd = hoja_(destino, HOJA_INHOUSE);
  const eo = estructura_(so);
  const ed = estructura_(sd);
  const mapa = [['PLANTA', 'PLANTA'], ['CONTRATISTA', 'EMPRESA'], ['NOMBRE Y APELLIDO', 'NOMBRE Y APELLIDO'], ['CÉDULA', 'CÉDULA']]
    .map(([ho, hd]) => [eo.encabezados[norm_(ho)], ed.encabezados[norm_(hd)], ho]);
  mapa.forEach(([co, cd, h]) => { if (!co || !cd) throw new Error('no se encontró la columna ' + h); });

  const colCedO = eo.encabezados[norm_('CÉDULA')];
  const colNomO = eo.encabezados[norm_('NOMBRE Y APELLIDO')];
  const filasOrigen = leerFilas_(so, eo.filaEncabezado, colCedO, colNomO);

  const primera = ed.filaEncabezado + 1;
  const ultima = Math.max(sd.getLastRow(), primera);
  const ancho = sd.getLastColumn();
  // Si faltan filas, se agregan al final copiando formato de la última
  const disponibles = ultima - primera + 1;
  if (filasOrigen.length > disponibles) {
    const extra = filasOrigen.length - disponibles;
    sd.insertRowsAfter(ultima, extra);
    const modelo = sd.getRange(ultima, 1, 1, sd.getMaxColumns());
    const nuevas = sd.getRange(ultima + 1, 1, extra, sd.getMaxColumns());
    modelo.copyTo(nuevas, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    modelo.copyTo(nuevas, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
  const total = Math.max(filasOrigen.length, disponibles);
  const rango = sd.getRange(primera, 1, total, ancho);
  const actuales = rango.getValues();
  const formulas = rango.getFormulas();
  let celdas = 0;
  actuales.forEach((fila, i) => {
    const fo = filasOrigen[i];
    const nuevos = fila.map((v, c) => {
      if (formulas[i][c]) return null;
      const par = mapa.find(([, cd]) => cd === c + 1);
      const deseado = fo && par ? fo.valores[par[0] - 1] : ''; // lo que no viene del origen queda vacío
      return iguales_(deseado, v) || esError_(deseado) ? null : deseado;
    });
    celdas += escribirTramos_(sd, primera + i, nuevos);
  });
  log.push('✔ INHOUSE: ' + filasOrigen.length + ' persona(s); ' + celdas + ' celda(s) actualizada(s).');
}

// ───────────────────────────── UTILIDADES ─────────────────────────────

function hoja_(ss, nombre) {
  const h = ss.getSheetByName(nombre);
  if (!h) throw new Error('no existe la hoja "' + nombre + '" en "' + ss.getName() + '"');
  return h;
}

/** Ubica la fila de encabezados (la que tiene "CÉDULA") y los títulos de módulo (fila de arriba). */
function estructura_(sh) {
  const n = Math.min(10, sh.getLastRow());
  const cols = sh.getLastColumn();
  const v = sh.getRange(1, 1, n, cols).getValues();
  const r = v.findIndex(fila => fila.some(x => norm_(x) === norm_('CÉDULA')));
  if (r === -1) throw new Error('no se encontró la fila de encabezados en "' + sh.getName() + '"');
  const encabezados = {};
  v[r].forEach((x, c) => { const k = norm_(x); if (k && !encabezados[k]) encabezados[k] = c + 1; });
  const modulos = {};
  if (r > 0) {
    v[r - 1].forEach((x, c) => {
      const m = String(x).match(/^\s*(M\d+)\s*:/);
      if (!m) return;
      const mr = sh.getRange(r, c + 1).getMergedRanges();
      modulos[m[1]] = { col: c + 1, ancho: mr.length ? mr[0].getNumColumns() : 1, titulo: x };
    });
  }
  return { filaEncabezado: r + 1, encabezados, modulos };
}

/** Lee las filas con datos bajo el encabezado, con su llave de emparejamiento. */
function leerFilas_(sh, filaEncabezado, colCed, colNom) {
  const primera = filaEncabezado + 1;
  const n = sh.getLastRow() - filaEncabezado;
  if (n <= 0) return [];
  const rango = sh.getRange(primera, 1, n, sh.getLastColumn());
  const valores = rango.getValues();
  const formulas = rango.getFormulas();
  const filas = [];
  valores.forEach((v, i) => {
    if (v.every(x => x === '' || x === false)) return;
    const ced = String(v[colCed - 1]).replace(/\D/g, '');
    const planta = norm_(v[0]);
    filas.push({
      fila: primera + i,
      valores: v,
      formulas: formulas[i],
      planta: planta,
      cedula: ced,
      nombre: planta + '|' + norm_(v[colNom - 1]),
    });
  });
  return filas;
}

/** Busca la fila del destino para una fila del origen: primero por cédula, luego por planta + nombre. */
function emparejar_(fo, filasDestino, usadas) {
  const libres = filasDestino.filter(fd => !usadas.has(fd.fila));
  if (fo.cedula) {
    const porCed = libres.find(fd => fd.cedula === fo.cedula);
    if (porCed) return porCed;
  }
  return libres.find(fd => fd.nombre === fo.nombre && fo.nombre.split('|')[1] !== '') ||
    // filas de totales u otras sin nombre: se emparejan por el texto de la columna A
    libres.find(fd => !fo.cedula && fo.nombre.split('|')[1] === '' && fd.nombre === fo.nombre) ||
    null;
}

function ultimaFilaDePlanta_(filas, planta) {
  let ultima = 0;
  filas.forEach(f => { if (f.planta === planta) ultima = f.fila; });
  return ultima;
}

/**
 * Escribe solo las celdas que cambian (agrupadas en tramos contiguos de la fila).
 * nuevos[i] === null significa "no tocar". Devuelve cuántas celdas cambió.
 */
function escribirTramos_(sh, fila, nuevos) {
  let cambios = 0;
  let i = 0;
  while (i < nuevos.length) {
    if (nuevos[i] === null) { i++; continue; }
    let j = i;
    while (j < nuevos.length && nuevos[j] !== null) j++;
    sh.getRange(fila, i + 1, 1, j - i).setValues([nuevos.slice(i, j)]);
    cambios += j - i;
    i = j;
  }
  return cambios;
}

function iguales_(a, b) {
  if ((a === '' || a === false) && (b === '' || b === false)) return true; // casilla vacía = sin marcar
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date || b instanceof Date) return false;
  return a === b;
}

function esError_(v) {
  return typeof v === 'string' && /^#(VALUE!|REF!|N\/A|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!)$/.test(v);
}

function norm_(x) {
  return String(x === null || x === undefined ? '' : x)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();
}

function celda_(r, c) {
  let s = '';
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s + r;
}

function avisar_(msg) {
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Sincronización', 8); } catch (e) { console.log(msg); }
}
