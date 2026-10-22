/**
 * LIBRO NUEVO: "Gestión de Brigadas 2026" (un solo archivo que reemplaza al 1.0 y al 2.0).
 *
 * Qué trae:
 *  - Del 1.0 (archivo original): TODAS las pestañas VISIBLES, tal cual están (datos, fórmulas, colores,
 *    tablas, desplegables) y con el mismo nombre. Las ocultas no se traen.
 *  - Del 2.0: la pestaña "2026 Brigadistas HOLCIM" (lista de asistencia), con el mismo nombre y
 *    ORGANIZADA según el cronograma del 1.0:
 *      · cada módulo y sesión toma la fecha que el cronograma le da a la planta;
 *      · si en el cronograma la celda tiene "-" o fondo gris, esa sesión NO APLICA: queda en gris,
 *        con el texto "No aplica", sin casilla y sin contar en el cumplimiento;
 *      · si la planta tiene una sola sesión, la Sesión 2 de todos los módulos no aplica;
 *      · si el cronograma aún no tiene fecha, se deja la que haya en el 2.0 (o vacía);
 *      · se quitan los textos de explicación ("FECHA SEGÚN CRONOGRAMA…");
 *      · "Cumplimiento del (los) Módulo(s)" y "% de cumplimiento" quedan con fórmula: módulos asistidos
 *        sobre módulos que aplican y cuya fecha ya pasó (en un módulo con 2 sesiones basta asistir a una).
 *
 * Hasta el CORTE el libro nuevo es un espejo: cada actualización vuelve a traer lo que cambió en el
 * 1.0 y en el 2.0 (lo que se escriba directamente en el libro nuevo en esas pestañas se pierde).
 * Después del corte (libroNuevoCorte) ya no se toca: el 1.0 y el 2.0 quedan como archivo histórico
 * y se trabaja solo en el libro nuevo.
 *
 * Se maneja desde el editor de Apps Script (menú Ejecutar), con la cuenta dueña del proyecto:
 *   libroNuevoCrear()                 → crea el archivo (junto al 2.0 en Drive) y lo llena
 *   libroNuevoActualizar()            → trae lo que cambió (es la que llama el activador)
 *   libroNuevoActualizarTodo()        → vuelve a traer todas las pestañas aunque no hayan cambiado
 *   libroNuevoActivarAutomatico()     → actualización automática cada SIGBE_CADA_HORAS horas
 *   libroNuevoDesactivarAutomatico()
 *   libroNuevoEstado()                → muestra en el registro cómo está todo
 *   libroNuevoCorte()                 → última actualización y fin del espejo
 *   libroNuevoQuitarCorte()           → por si el corte se hizo antes de tiempo
 *
 * Usa del mismo proyecto: abrirOrigen_ (1.0), destino_ (2.0), copiarHoja_, buscarHoja_, huella_,
 * celdasConDatos_ y MAXIMA_REDUCCION (SincronizarBrigadas.gs); sigbeNorm_, sigbeEsGris_ y
 * sigbeEsPropietario_ (SIGBE.gs).
 */

const LN_VERSION = '1';
const LN_NOMBRE_ARCHIVO = 'Gestión de Brigadas 2026';
const LN_HOJA_ASISTENCIA = '2026 Brigadistas HOLCIM';
const LN_HOJA_CRONOGRAMA = '2026 Cronograma Nacional Brigadas';
const LN_ANTES_DE = '2026 Brigadistas INHOUSE'; // la lista de asistencia se ubica antes de esta pestaña
const LN_NO_APLICA = 'No aplica';
const LN_GRIS = '#d9d9d9';
const LN_GRIS_LETRA = '#7f7f7f';

// Planta de la lista de asistencia → bloque del cronograma (fila 1) y línea de negocio.
// [palabra en la columna PLANTA, palabra en el nombre del bloque del cronograma, línea]
// La línea decide qué filas del cronograma con prefijo ("AGG:", "CEM:", "RMX & TQC:") le tocan.
const LN_PLANTAS = [
  ['MONDONEDO', 'MONDONEDO', 'AGG'],
  ['TOCANCIPA', 'TOCANCIPA', 'TQC'],
  ['CHIA', 'CHIA', 'RMX'],
  ['SIBATE', 'SIBATE', 'RMX'],
  ['PUENTE ARANDA', 'PUENTE ARANDA', 'RMX'],
  ['BELLO', 'BELLO', 'RMX'],
  ['VALLE', 'CALISUR', 'RMX'],   // en el 2.0, RMX - VALLE usa las fechas de Calisur
  ['PALMIRA', 'PALMIRA', 'RMX'],
  ['CALISUR', 'CALISUR', 'RMX'],
  ['BOYACA', 'BOYACA', 'RMX'],
  ['NOBSA', 'NOBSA', 'CEM'],     // CEM - NOBSA y GEO - NOBSA comparten el bloque "CEM & GEO - Nobsa"
  ['BARRANCA', 'BARRANCA', 'GEO'],
  ['TELEPORT', 'TELEPORT', 'COR'],
  ['FUNDACION', 'FUNDACION', 'COR'],
];

// Módulo de la lista de asistencia → palabra que lo identifica en la columna ENTRENAMIENTO del cronograma.
// M8 tiene 3 partes (M8-1, M8-2, M8-3): son la 1.ª, 2.ª y 3.ª fila "0256" del cronograma.
const LN_MODULOS = {
  M1: 'PRIMER AUXILIO',
  M2: 'PLANES DE PREVENCION',
  M3: 'SUSTANCIAS PELIGROSAS',
  M4: 'ELECTRICO',
  M5: 'ALTURAS',
  M6: 'VEHICULAR',
  M7: 'SISMO',
  M8: '0256',
  M9: 'ACUATICO',
  M10: 'MINERIA',
  M11: 'HARINA',
};

// ───────────────────────────── FUNCIONES PARA EL EDITOR ─────────────────────────────

function libroNuevoCrear() {
  lnSoloDueno_();
  const props = props_();
  const actual = lnIdLibro_();
  if (actual) {
    try {
      const ss = SpreadsheetApp.openById(actual);
      return lnMostrar_('El libro nuevo ya existe: ' + ss.getUrl() + '\nPara llenarlo de nuevo ejecuta libroNuevoActualizarTodo.');
    } catch (e) {
      throw new Error('La propiedad LIBRO_NUEVO_ID apunta a un archivo que no se puede abrir (' + actual + '). ' +
        'Bórrala en Configuración del proyecto → Propiedades del script si quieres crear uno nuevo.');
    }
  }
  const v1 = abrirOrigen_();
  const v2 = destino_();
  const libro = SpreadsheetApp.create(LN_NOMBRE_ARCHIVO);
  try { libro.setSpreadsheetLocale(v1.getSpreadsheetLocale()); } catch (e) { /* se deja el de la cuenta */ }
  try { libro.setSpreadsheetTimeZone(v1.getSpreadsheetTimeZone()); } catch (e) { /* idem */ }
  try {
    const carpetas = DriveApp.getFileById(v2.getId()).getParents();
    if (carpetas.hasNext()) DriveApp.getFileById(libro.getId()).moveTo(carpetas.next());
  } catch (e) { /* queda en Mi unidad */ }
  props.setProperty('LIBRO_NUEVO_ID', libro.getId());
  const r = lnActualizar_(true);
  return lnMostrar_('Libro nuevo creado: ' + libro.getUrl() + '\n\n' + r.resumen);
}

/** La llama el activador automático. Solo trae las pestañas que cambiaron. */
function libroNuevoActualizar() {
  const r = lnActualizar_(false);
  if (r.error) throw new Error(r.resumen);
  return lnMostrar_(r.resumen);
}

function libroNuevoActualizarTodo() {
  lnSoloDueno_();
  const r = lnActualizar_(true);
  if (r.error) throw new Error(r.resumen);
  return lnMostrar_(r.resumen);
}

function libroNuevoActivarAutomatico() {
  lnSoloDueno_();
  if (!lnIdLibro_()) throw new Error('Primero ejecuta libroNuevoCrear.');
  if (props_().getProperty('LIBRO_NUEVO_CORTE')) throw new Error('Ya se hizo el corte: el libro nuevo no se actualiza más desde el 1.0 y el 2.0.');
  lnQuitarActivador_();
  const n = cadaHoras_();
  ScriptApp.newTrigger('libroNuevoActualizar').timeBased().everyHours(n).create();
  return lnMostrar_('Actualización automática del libro nuevo: cada ' + n + ' hora(s).');
}

function libroNuevoDesactivarAutomatico() {
  lnSoloDueno_();
  lnQuitarActivador_();
  return lnMostrar_('Actualización automática del libro nuevo desactivada.');
}

function libroNuevoEstado() {
  lnSoloDueno_();
  const props = props_();
  const id = lnIdLibro_();
  let url = '(no creado: ejecuta libroNuevoCrear)';
  if (id) { try { url = SpreadsheetApp.openById(id).getUrl(); } catch (e) { url = '(no se puede abrir ' + id + ')'; } }
  const auto = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'libroNuevoActualizar');
  return lnMostrar_([
    'Libro nuevo: ' + url,
    'Corte: ' + (props.getProperty('LIBRO_NUEVO_CORTE') || 'no (sigue siendo espejo del 1.0 y el 2.0)'),
    'Automático: ' + (auto ? 'sí, cada ' + cadaHoras_() + ' hora(s)' : 'no'),
    '', 'Última actualización:', props.getProperty('LIBRO_NUEVO_ULTIMO') || '(ninguna)',
  ].join('\n'));
}

function libroNuevoCorte() {
  lnSoloDueno_();
  const props = props_();
  if (props.getProperty('LIBRO_NUEVO_CORTE')) return lnMostrar_('El corte ya estaba hecho: ' + props.getProperty('LIBRO_NUEVO_CORTE'));
  // Actualización normal (no forzada): si hay un borrado masivo o un error, el corte no se hace
  const r = lnActualizar_(false);
  if (r.error) throw new Error('No se hizo el corte porque la última actualización tuvo avisos o errores: ' + r.resumen);
  lnQuitarActivador_();
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  props.setProperty('LIBRO_NUEVO_CORTE', fecha);
  return lnMostrar_('Corte hecho (' + fecha + '). Desde ahora se trabaja solo en el libro nuevo; ' +
    'el 1.0 y el 2.0 quedan como histórico.\n\n' + r.resumen);
}

function libroNuevoQuitarCorte() {
  lnSoloDueno_();
  props_().deleteProperty('LIBRO_NUEVO_CORTE');
  return lnMostrar_('Corte quitado. Ojo: la próxima actualización vuelve a traer las pestañas del 1.0 y el 2.0 ' +
    'y reemplaza lo que se haya escrito en esas pestañas del libro nuevo.');
}

// ───────────────────────────── PROCESO ─────────────────────────────

function lnActualizar_(forzar) {
  const props = props_();
  const corte = props.getProperty('LIBRO_NUEVO_CORTE');
  if (corte) return { resumen: 'Corte hecho el ' + corte + ': el libro nuevo ya no se actualiza desde el 1.0 y el 2.0.', error: false };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { resumen: 'Ya había una actualización en curso.', error: false };
  const log = [];
  let error = false;
  try {
    const id = lnIdLibro_();
    if (!id) throw new Error('No hay libro nuevo: ejecuta libroNuevoCrear.');
    const libro = SpreadsheetApp.openById(id);
    const v1 = abrirOrigen_();
    const v2 = destino_();
    const crono = buscarHoja_(v1, LN_HOJA_CRONOGRAMA);
    if (!crono) throw new Error('No se encontró la pestaña "' + LN_HOJA_CRONOGRAMA + '" en el 1.0.');
    const asistencia = buscarHoja_(v2, LN_HOJA_ASISTENCIA);
    if (!asistencia) throw new Error('No se encontró la pestaña "' + LN_HOJA_ASISTENCIA + '" en el 2.0.');

    // Pestañas visibles del 1.0, en su orden; la lista de asistencia (del 2.0) antes de INHOUSE
    const fuentes = hojasSanas_(v1)
      .filter(h => !h.isSheetHidden() && !empiezaIgual_(h.getName(), LN_HOJA_ASISTENCIA))
      .map(h => ({ hoja: h, nombre: h.getName(), organizar: false }));
    const lista = { hoja: asistencia, nombre: LN_HOJA_ASISTENCIA, organizar: true };
    const pos = fuentes.findIndex(f => empiezaIgual_(f.nombre, LN_ANTES_DE));
    fuentes.splice(pos === -1 ? fuentes.length : pos, 0, lista);

    let copiadas = 0;
    fuentes.forEach(f => {
      const vieja = libro.getSheetByName(f.nombre);
      const huella = LN_VERSION + ':' + huella_(f.hoja) + (f.organizar ? ':' + huella_(crono) : '');
      const claveHuella = 'LIBRO_NUEVO_HUELLA_' + f.nombre;
      if (!forzar && vieja && props.getProperty(claveHuella) === huella) { log.push('= ' + f.nombre + ': sin cambios.'); return; }
      const celdas = celdasConDatos_(f.hoja);
      const antes = Number(props.getProperty('LIBRO_NUEVO_CELDAS_' + f.nombre)) || 0;
      if (vieja && antes && celdas < antes * (1 - MAXIMA_REDUCCION)) {
        if (!forzar) {
          error = true;
          log.push('⚠ ' + f.nombre + ': en el archivo de origen quedó con ' + celdas + ' celdas con datos y antes tenía ' + antes +
            '. Parece un borrado masivo: NO se copió. Revisa el origen (o ejecuta libroNuevoActualizarTodo si el cambio es correcto).');
          return;
        }
        log.push('ℹ ' + f.nombre + ': tiene muchos menos datos que antes (' + antes + ' → ' + celdas + '); se copió porque fue una actualización completa.');
      }
      try {
        const modo = copiarHoja_(f.hoja, libro, vieja);
        if (f.organizar) {
          const r = lnOrganizarAsistencia_(libro.getSheetByName(f.nombre), crono);
          log.push('✔ ' + f.nombre + ' (del 2.0, organizada con el cronograma): ' + r.resumen);
          r.avisos.forEach(a => log.push('   · ' + a));
        } else {
          log.push('✔ ' + f.nombre + ': copiada' + (modo === 'contenido' ? ' celda por celda' : '') + '.');
        }
        props.setProperty(claveHuella, huella);
        props.setProperty('LIBRO_NUEVO_CELDAS_' + f.nombre, String(celdas));
        copiadas++;
      } catch (e) {
        error = true;
        log.push('✖ ' + f.nombre + ': ' + e.message);
      }
    });

    // Mismo orden que el 1.0
    fuentes.forEach((f, i) => {
      const h = libro.getSheetByName(f.nombre);
      if (h && h.getIndex() !== i + 1) { libro.setActiveSheet(h); libro.moveActiveSheet(i + 1); }
    });
    // La pestaña vacía con la que nace el archivo
    libro.getSheets().forEach(h => {
      if (/^(Hoja|Sheet) ?1$/i.test(h.getName()) && h.getLastRow() === 0 && libro.getSheets().length > 1) libro.deleteSheet(h);
    });
    log.unshift((error ? 'Actualización con avisos' : 'Actualización correcta') + ': ' + copiadas + ' pestaña(s) copiada(s) de ' + fuentes.length + '.');
  } catch (e) {
    error = true;
    log.unshift('✖ No se actualizó el libro nuevo: ' + e.message);
  } finally {
    lock.releaseLock();
  }
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const resumen = fecha + '\n' + log.join('\n');
  try { props.setProperty('LIBRO_NUEVO_ULTIMO', resumen.slice(0, 8000)); } catch (e) { /* sin propiedades */ }
  return { resumen: resumen, error: error };
}

/** Aplica el cronograma a la pestaña de asistencia ya copiada en el libro nuevo. */
function lnOrganizarAsistencia_(hoja, cronoHoja) {
  const filas = hoja.getLastRow(), cols = hoja.getLastColumn();
  const rango = hoja.getRange(1, 1, filas, cols);
  const dvs = rango.getDataValidations();
  const datos = {
    valores: rango.getValues(),
    formulas: rango.getFormulas(),
    fondos: rango.getBackgrounds(),
    formatos: rango.getNumberFormats(),
    casillas: dvs.map(f => f.map(dv => !!dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX)),
  };
  const rc = cronoHoja.getRange(1, 1, cronoHoja.getLastRow(), cronoHoja.getLastColumn());
  const crono = lnLeerCronograma_(rc.getValues(), rc.getDisplayValues(), rc.getBackgrounds());
  const p = lnPlanAsistencia_(datos, crono, new Date());

  // Se escribe de una vez el bloque de módulos + cumplimiento (desde la primera fila de datos)
  const f0 = p.filaEncabezado + 1, c0 = p.colDesde, c1 = p.colHasta;
  const alto = filas - f0, ancho = c1 - c0 + 1;
  if (alto > 0 && ancho > 0) {
    const corta = m => m.slice(f0).map(f => f.slice(c0, c1 + 1));
    const valores = corta(p.valores).map((f, i) => f.map((v, j) => p.formulas[f0 + i][c0 + j] || v));
    const bloque = hoja.getRange(f0 + 1, c0 + 1, alto, ancho);
    bloque.setValues(valores);
    bloque.setBackgrounds(corta(p.fondos));
    bloque.setNumberFormats(corta(p.formatos));
    const casilla = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    try {
      bloque.setDataValidations(corta(p.casillas).map((f, i) => f.map((quiere, j) => {
        const r = f0 + i, c = c0 + j;
        if (quiere === datos.casillas[r][c]) return dvs[r][c];
        return quiere ? casilla : null;
      })));
    } catch (e) {
      // Si Google no deja cambiar las casillas (p. ej. columna de tabla con tipo fijo), igual no cuentan: la
      // fórmula de cumplimiento ignora las marcas de las sesiones "No aplica".
      p.avisos.push('No se pudieron quitar/poner casillas (' + e.message + '); las sesiones "No aplica" igual no cuentan.');
    }

    // Formato condicional: "No aplica" siempre en gris (va primero para ganarle a los colores de asistencia)
    const a1 = lnLetra_(p.colMinModulo) + (f0 + 1), izq = lnLetra_(p.colMinModulo - 1) + (f0 + 1);
    const formula = '=OR(' + a1 + '="' + LN_NO_APLICA + '",' + izq + '="' + LN_NO_APLICA + '")';
    const reglas = hoja.getConditionalFormatRules();
    const yaEsta = reglas.some(r => { try { return r.getBooleanCondition().getCriteriaValues()[0] === formula; } catch (e) { return false; } });
    if (!yaEsta && p.colMinModulo > 0) {
      const regla = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(formula)
        .setBackground(LN_GRIS).setFontColor(LN_GRIS_LETRA)
        .setRanges([hoja.getRange(f0 + 1, p.colMinModulo + 1, alto, p.colMaxModulo - p.colMinModulo + 1)])
        .build();
      hoja.setConditionalFormatRules([regla].concat(reglas));
    }
  }
  return p;
}

// ───────────────────────────── LÓGICA (sin llamadas a Google) ─────────────────────────────

/**
 * Cronograma → { bloques: [{ planta, n, col }], filas: [{ texto, lineas, celdas: [{ tipo, fecha }] }] }
 * tipo: 'fecha' | 'noaplica' ("-" o fondo gris) | 'vacio' (sin fecha todavía). lineas: null = TODOS.
 */
function lnLeerCronograma_(v, d, bg) {
  const bloques = [];
  let planta = '', bloque = null, n = 0;
  for (let c = 2; c < d[0].length; c++) {
    if (d[0][c]) { planta = sigbeNorm_(d[0][c]); n = 0; }
    if (d[0][c] || d[1][c]) { n++; bloque = { planta: planta, n: n, col: -1 }; bloques.push(bloque); }
    if (bloque && bloque.col < 0 && sigbeNorm_(d[2][c]) === 'FECHA HOLCIM') bloque.col = c;
  }
  const filas = [];
  for (let r = 3; r < d.length; r++) {
    const linea1 = String(d[r][1] || '').split('\n')[0].trim();
    if (!linea1) continue;
    const m = linea1.match(/^([^:]{1,20}):/);
    const pref = m ? sigbeNorm_(m[1]) : 'TODOS';
    filas.push({
      fila: r + 1,
      texto: sigbeNorm_(linea1),
      lineas: pref === 'TODOS' ? null : pref.split(/\s*(?:&|,|\/|\bY\b)\s*/).filter(String),
      celdas: bloques.map(b => {
        if (b.col < 0) return { tipo: 'vacio' };
        const txt = String(d[r][b.col] || '').trim(), val = v[r][b.col];
        if (txt === '-' || sigbeEsGris_(bg[r][b.col])) return { tipo: 'noaplica' };
        if (val instanceof Date) return { tipo: 'fecha', fecha: val };
        return { tipo: 'vacio' };
      }),
    });
  }
  return { bloques: bloques, filas: filas };
}

function lnPlanta_(planta) {
  const n = sigbeNorm_(planta);
  const e = LN_PLANTAS.find(x => n.indexOf(x[0]) !== -1);
  return e ? { bloque: e[1], linea: e[2] } : null;
}

/** Fila del cronograma que corresponde a una unidad (módulo o parte de M8) para una línea de negocio. */
function lnFilaModulo_(crono, u, linea) {
  const clave = LN_MODULOS[u.modulo];
  if (!clave) return undefined; // módulo sin regla: no se toca
  const filas = crono.filas.filter(f => f.texto.indexOf(clave) !== -1);
  if (u.parte) return filas[u.parte - 1] || null;
  return filas.find(f => !f.lineas || f.lineas.indexOf(linea) !== -1) || null;
}

function lnEsNota_(v) {
  return typeof v === 'string' && /FECHA SEG[UÚ]N CRONOGRAMA/i.test(v);
}

/**
 * Decide, celda por celda, cómo queda la lista de asistencia. Devuelve copias de las matrices
 * (valores, formulas, fondos, formatos, casillas) ya organizadas, más un resumen y avisos.
 */
function lnPlanAsistencia_(datos, crono, hoy) {
  const copia = m => m.map(f => f.slice());
  const V = copia(datos.valores), F = copia(datos.formulas), B = copia(datos.fondos);
  const N = copia(datos.formatos), C = copia(datos.casillas);
  const fe = V.findIndex((f, i) => i < 6 && f.some(x => sigbeNorm_(x) === 'PLANTA'));
  if (fe < 0) throw new Error('no se encontró la fila de encabezados (columna PLANTA) en la lista de asistencia.');
  const enc = V[fe].map(sigbeNorm_);
  const cPlanta = enc.indexOf('PLANTA');
  const cNombre = enc.findIndex(x => x.indexOf('NOMBRE') === 0);
  const cCedula = enc.findIndex(x => x.indexOf('CEDULA') === 0);
  const cCumpl = enc.findIndex(x => /^CU+M+PLIMIENTO/.test(x));
  const cPorc = enc.findIndex(x => x.indexOf('% DE CUMPLIMIENTO') === 0);

  const unidades = [];
  enc.forEach((x, c) => {
    const m = x.match(/^M(\d+)(?:-(\d+))?[-_ ]*SESION[-_ ]*(\d)$/);
    if (!m || !/^ASISTENCIA/.test(enc[c + 1] || '')) return;
    unidades.push({ modulo: 'M' + m[1], parte: m[2] ? Number(m[2]) : 0, clave: 'M' + m[1] + (m[2] ? '-' + m[2] : ''), sesion: Number(m[3]), cf: c, ca: c + 1 });
  });
  if (!unidades.length) throw new Error('no se encontraron columnas de módulos (M1_Sesión_1, Asistencia…) en la lista de asistencia.');
  const colMinModulo = Math.min.apply(null, unidades.map(u => u.cf));
  const colMaxModulo = Math.max.apply(null, unidades.map(u => u.ca));

  const cuenta = { personas: 0, fechas: 0, noAplica: 0, notas: 0 };
  const avisos = {};
  const aviso = (k, t) => { avisos[k] = t; };
  const dia = x => Utilities.formatDate(x, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  const blanco = r => { /* fondo de una celda que deja de estar en gris */ return sigbeEsGris_(r) || /^#d9d9d9$/i.test(r) || /^#ffff00$/i.test(r) ? '#ffffff' : r; };
  const filasPersona = [];

  for (let r = fe + 1; r < V.length; r++) {
    const planta = String(V[r][cPlanta] || '').trim();
    if (!planta || /^TOTAL/i.test(planta)) continue;
    if (!String(cNombre >= 0 ? V[r][cNombre] : '').trim() && !String(cCedula >= 0 ? V[r][cCedula] : '').trim()) continue;
    cuenta.personas++;
    filasPersona.push(r);
    const cfg = lnPlanta_(planta);
    const bloques = cfg ? crono.bloques.map((b, i) => ({ b: b, i: i })).filter(x => x.b.planta.indexOf(cfg.bloque) !== -1) : [];
    if (!bloques.length) aviso('sin:' + planta, planta + ': no está en el cronograma; sus fechas se dejaron como vienen del 2.0.');

    unidades.forEach(u => {
      if (lnEsNota_(V[r][u.cf])) { V[r][u.cf] = ''; F[r][u.cf] = ''; B[r][u.cf] = blanco(B[r][u.cf]); cuenta.notas++; }
      if (!bloques.length) return;
      let tipo = 'vacio', fecha = null;
      if (u.sesion > bloques.length) tipo = 'noaplica';
      else {
        const fila = lnFilaModulo_(crono, u, cfg.linea);
        if (fila === undefined) return;
        if (fila === null) tipo = 'noaplica';
        else { const celda = fila.celdas[bloques[u.sesion - 1].i]; tipo = celda.tipo; fecha = celda.fecha || null; }
      }
      if (tipo === 'noaplica') {
        if (V[r][u.ca] === true) aviso('marca:' + planta + u.clave + u.sesion, planta + ' ' + u.clave + ' sesión ' + u.sesion +
          ': tenía asistencias marcadas pero según el cronograma no aplica; no se cuentan.');
        V[r][u.cf] = LN_NO_APLICA; F[r][u.cf] = '';
        V[r][u.ca] = ''; F[r][u.ca] = ''; C[r][u.ca] = false;
        B[r][u.cf] = LN_GRIS; B[r][u.ca] = LN_GRIS;
        cuenta.noAplica++;
        return;
      }
      if (tipo === 'fecha') {
        const antes = V[r][u.cf];
        if (antes instanceof Date && dia(antes) !== dia(fecha)) aviso('fecha:' + planta + u.clave + u.sesion, planta + ' ' + u.clave +
          ' sesión ' + u.sesion + ': en el 2.0 decía ' + dia(antes) + ' y el cronograma dice ' + dia(fecha) + ' (quedó la del cronograma).');
        V[r][u.cf] = fecha; F[r][u.cf] = ''; N[r][u.cf] = 'dd/mm/yyyy';
        cuenta.fechas++;
      } else if (V[r][u.cf] === LN_NO_APLICA) {
        V[r][u.cf] = '';
      }
      B[r][u.cf] = blanco(B[r][u.cf]); B[r][u.ca] = blanco(B[r][u.ca]);
      C[r][u.ca] = true;
      if (typeof V[r][u.ca] !== 'boolean' && !F[r][u.ca]) V[r][u.ca] = false;
    });
  }

  // Cumplimiento con fórmula: módulos asistidos / módulos que aplican y ya tienen fecha pasada
  if (cCumpl >= 0) {
    const grupos = {};
    unidades.forEach(u => { (grupos[u.clave] = grupos[u.clave] || []).push(u); });
    const L = lnLetra_;
    const porFila = fila => {
      const asis = [], debe = [];
      Object.keys(grupos).forEach(k => {
        const g = grupos[k];
        const marcas = g.map(u => 'AND(' + L(u.ca) + fila + '=TRUE,' + L(u.cf) + fila + '<>"' + LN_NO_APLICA + '")');
        asis.push('N(OR(' + marcas.join(',') + '))');
        debe.push('N(OR(' + marcas.concat(g.map(u => 'AND(ISNUMBER(' + L(u.cf) + fila + '),' + L(u.cf) + fila + '<=h)')).join(',') + '))');
      });
      return '=LET(h,TODAY(),c,' + asis.join('+') + ',t,' + debe.join('+') + ',c&" / "&t)';
    };
    const pct = fila => '=IFERROR(VALUE(REGEXEXTRACT(' + L(cCumpl) + fila + ',"^\\d+"))/VALUE(REGEXEXTRACT(' + L(cCumpl) + fila + ',"\\d+$")),"")';
    const sumar = (a, b) => {
      const r = L(cCumpl) + a + ':' + L(cCumpl) + b;
      const parte = re => 'SUM(ARRAYFORMULA(IFERROR(VALUE(REGEXEXTRACT(' + r + ',"' + re + '")),0)))';
      return '=' + parte('^\\d+') + '&" / "&' + parte('\\d+$');
    };
    filasPersona.forEach(r => {
      F[r][cCumpl] = porFila(r + 1);
      if (cPorc >= 0) { F[r][cPorc] = pct(r + 1); N[r][cPorc] = '0%'; }
    });
    let desde = fe + 2;
    for (let r = fe + 1; r < V.length; r++) {
      if (!/^TOTAL/i.test(String(V[r][cPlanta] || '').trim())) continue;
      if (r + 1 > desde) {
        F[r][cCumpl] = sumar(desde, r);
        if (cPorc >= 0) { F[r][cPorc] = pct(r + 1); N[r][cPorc] = '0%'; }
      }
      desde = r + 2;
    }
  }

  const colHasta = Math.max(colMaxModulo, cCumpl, cPorc);
  return {
    valores: V, formulas: F, fondos: B, formatos: N, casillas: C,
    filaEncabezado: fe, colDesde: colMinModulo, colHasta: colHasta,
    colMinModulo: colMinModulo, colMaxModulo: colMaxModulo, unidades: unidades,
    resumen: cuenta.personas + ' brigadistas, ' + cuenta.fechas + ' fechas puestas desde el cronograma, ' +
      cuenta.noAplica + ' sesiones marcadas "No aplica", ' + cuenta.notas + ' textos de explicación quitados.',
    avisos: Object.keys(avisos).sort().map(k => avisos[k]),
  };
}

// ───────────────────────────── UTILIDADES ─────────────────────────────

function lnIdLibro_() { return idDesdeTexto_(prop_('LIBRO_NUEVO_ID')); }

function lnQuitarActivador_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'libroNuevoActualizar')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/** Estas funciones cambian archivos: solo la cuenta dueña, desde el editor (no desde la app publicada). */
function lnSoloDueno_() {
  if (!sigbeEsPropietario_()) throw new Error('Solo la cuenta dueña del proyecto puede ejecutar esto, desde el editor de Apps Script.');
}

function lnMostrar_(texto) {
  console.log(texto);
  return texto;
}

/** 0 → A, 25 → Z, 26 → AA … */
function lnLetra_(c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}
