/**
 * SIGBE 2.0 - Sistema de Gestión de Brigadas (backend de la app web)
 *
 * Va en el mismo proyecto de Apps Script del archivo 2.0, junto a SincronizarBrigadas.gs
 * (usa su ID_ORIGEN).
 *
 * DÓNDE LEE Y ESCRIBE
 *  - Brigadistas HOLCIM e INHOUSE: en el ARCHIVO ORIGINAL (donde también marcan los
 *    proveedores). Así la app ve al instante lo que marcan ellos y lo que se registra aquí;
 *    el 2.0 lo recibe con la sincronización automática.
 *    Si el original ya no existe o está en la papelera, usa automáticamente el 2.0.
 *  - Indicador, Cronograma y Temarios: se leen del 2.0.
 *
 * Personas: se ubican por CÉDULA (y nombre si la cédula está repetida), nunca por número de fila.
 * Columnas: se ubican por el texto del encabezado ("PLANTA", "CÉDULA", "Asistencia"...).
 *
 * SEGURIDAD: registrar brigadistas y marcar asistencia exige iniciar sesión. El usuario y la
 * clave se configuran desde el menú 🔄 Sincronización → Configurar usuario y clave de la app
 * (no van escritos en el código).
 */

const SIGBE_HOJA_HOLCIM = '2026 Brigadistas HOLCIM';
const SIGBE_HOJA_INHOUSE = '2026 Brigadistas INHOUSE';
const SIGBE_HOJA_INDICADOR = 'Indicador';
const SIGBE_HOJA_CRONOGRAMA = '2026 Cronograma Nacional Brigadas';
const SIGBE_HORAS_SESION = 6;

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('SIGBE 2.0 - Sistema de Gestión de Brigadas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // Permite insertar la app en Google Sites u otra página interna
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ───────────────────────────── MÓDULO 1: TABLERO ─────────────────────────────

function getTableroControl() {
  try {
    const sh = sigbeHoja_(SpreadsheetApp.getActiveSpreadsheet(), SIGBE_HOJA_INDICADOR);
    const t = sigbeTabla_(sh, ['PLANTA', 'EMPRESA']);
    const c = n => t.col(n);
    const cols = {
      planta: c('PLANTA'), empresa: c('EMPRESA'), personas: c('TOTAL TRABAJADORES'),
      requeridos: c('BRIGADISTAS REQUERIDOS'), actuales: c('BRIGADISTAS ACTUALES'),
      gap: c('GAP POR GESTION'), cobertura: c('% COBERTURA ACTUAL'),
    };
    let planta = '';
    const tabla = [];
    let totalPersonal = 0, totalBrig = 0, totalRequeridos = 0, totalBrechas = 0;
    t.filas.forEach(f => {
      const v = f.valores;
      planta = String(v[cols.planta - 1] || '').trim() || planta;
      const empresa = String(v[cols.empresa - 1] || '').trim();
      if (!empresa) return;
      const fila = {
        planta: planta,
        empresa: empresa,
        esTotal: sigbeNorm_(empresa) === 'TOTAL',
        personas: sigbeNum_(v[cols.personas - 1]),
        requeridos: sigbeNum_(v[cols.requeridos - 1]),
        actuales: sigbeNum_(v[cols.actuales - 1]),
        gap: sigbeNum_(v[cols.gap - 1]),
        cobertura: sigbeNum_(v[cols.cobertura - 1]),
      };
      tabla.push(fila);
      if (!fila.esTotal) { // las filas TOTAL no se suman para no contar doble
        totalPersonal += fila.personas;
        totalBrig += fila.actuales;
        totalRequeridos += fila.requeridos;
        if (fila.gap > 0) totalBrechas += fila.gap;
      }
    });
    return {
      kpis: {
        totalPersonal: totalPersonal,
        totalBrig: totalBrig,
        totalRequeridos: Math.round(totalRequeridos * 10) / 10,
        pctGlobal: totalPersonal ? (totalBrig / totalPersonal * 100).toFixed(1) + '%' : '0%',
        totalBrechas: Math.round(totalBrechas * 10) / 10,
      },
      tabla: tabla,
    };
  } catch (e) {
    return { error: e.message, kpis: {}, tabla: [] };
  }
}

// ───────────────────────────── MÓDULO 2: DIRECTORIO ─────────────────────────────

function getDirectorioUnificado() {
  try {
    const ss = sigbeArchivoDatos_();
    const lista = [];
    sigbeLeerHolcim_(ss).personas.forEach(p => lista.push({
      planta: p.planta, tipo: 'HOLCIM', contratista: 'HOLCIM', estado: p.estado,
      nombre: p.nombre, cedula: p.cedula, certVigente: p.certificado,
    }));
    sigbeLeerInhouse_(ss).forEach(p => lista.push(p));
    return { lista: lista, fuente: sigbeFuente_(ss) };
  } catch (e) {
    return { error: e.message, lista: [] };
  }
}

// ───────────────────────────── MÓDULO 3: ASISTENCIA ─────────────────────────────

/** Solo las columnas "Asistencia" (casillas); la fecha de la sesión se muestra junto a cada una. */
function getSeguimientoAsistencia() {
  try {
    const ss = sigbeArchivoDatos_();
    const h = sigbeLeerHolcim_(ss);
    return {
      encabezados: h.asistencias.map(a => ({ key: a.key, modulo: a.modulo, titulo: a.titulo, sesion: a.sesion })),
      brigadistas: h.personas.map(p => ({
        planta: p.planta, estado: p.estado, nombre: p.nombre, cedula: p.cedula, empresa: 'HOLCIM',
        asistencias: h.asistencias.map(a => ({ marcada: p.valores[a.col - 1] === true, fecha: sigbeTexto_(p.valores[a.colFecha - 1]) })),
      })),
      fuente: sigbeFuente_(ss),
    };
  } catch (e) {
    return { error: e.message, encabezados: [], brigadistas: [] };
  }
}

/** Marca o desmarca una asistencia. Ubica a la persona por cédula (+ nombre) y la casilla por módulo y sesión. */
function guardarAsistencia(token, cedula, nombre, key, marcada) {
  const lock = LockService.getScriptLock();
  try {
    sigbeExigirSesion_(token);
    if (!lock.tryLock(20000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo.' };
    const ss = sigbeArchivoDatos_();
    const h = sigbeLeerHolcim_(ss);
    const a = h.asistencias.find(x => x.key === key);
    if (!a) return { exito: false, mensaje: 'No se encontró la columna de asistencia (' + key + ').' };
    const p = sigbeBuscarPersona_(h.personas, cedula, nombre);
    if (!p) return { exito: false, mensaje: 'No se encontró a ' + nombre + ' (' + cedula + ') en la hoja.' };
    h.hoja.getRange(p.fila, a.col).setValue(marcada === true);
    return { exito: true, mensaje: 'Guardado' };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────────── CRONOGRAMA Y TEMARIOS ─────────────────────────────

/** Cronograma completo, agrupado por planta (encabezado de 3 filas: planta / sesión / campo). */
function getCronogramaCapacitaciones() {
  try {
    const sh = sigbeHoja_(SpreadsheetApp.getActiveSpreadsheet(), SIGBE_HOJA_CRONOGRAMA);
    const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
    const plantas = [];
    let planta = null, sesion = '';
    for (let c = 2; c < v[0].length; c++) {
      if (v[0][c]) { planta = { nombre: v[0][c], columnas: [] }; plantas.push(planta); sesion = ''; }
      if (v[1][c]) sesion = v[1][c].trim();
      if (planta && v[2][c]) planta.columnas.push({ col: c, sesion: sesion, campo: v[2][c] });
    }
    let mes = '';
    const filas = [];
    for (let r = 3; r < v.length; r++) {
      mes = v[r][0] || mes;
      if (!v[r][1]) continue;
      filas.push({ mes: mes, entrenamiento: v[r][1], celdas: v[r] });
    }
    return { plantas: plantas, filas: filas };
  } catch (e) {
    return { error: e.message, plantas: [], filas: [] };
  }
}

/** Hojas de temario disponibles (en el 2.0 y, si existe, en el original). */
function getListaTemarios() {
  const nombres = [];
  const agregar = ss => {
    if (!ss) return;
    ss.getSheets().forEach(h => {
      const n = h.getName();
      if (/TEMARIO/i.test(n) && nombres.indexOf(n) === -1) nombres.push(n);
    });
  };
  agregar(SpreadsheetApp.getActiveSpreadsheet());
  agregar(sigbeOrigenOpcional_());
  return nombres;
}

/** Lee un temario: encabezados en la primera fila con 3 o más títulos; agrupa por la primera columna (celdas combinadas). */
function getTemarioCapacitacion(nombreHoja) {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja) ||
      (sigbeOrigenOpcional_() && sigbeOrigenOpcional_().getSheetByName(nombreHoja));
    if (!sh) return { error: 'No existe la hoja ' + nombreHoja, grupos: [] };
    const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
    const r0 = v.findIndex(f => f.filter(x => String(x).trim()).length >= 3);
    if (r0 === -1) return { grupos: [] };
    const enc = v[r0];
    const grupos = [];
    let actual = null;
    for (let r = r0 + 1; r < v.length; r++) {
      const f = v[r];
      if (!f.some(x => String(x).trim())) continue;
      if (f[0]) { actual = { titulo: f[0], items: [] }; grupos.push(actual); }
      if (!actual) { actual = { titulo: '', items: [] }; grupos.push(actual); }
      const item = [];
      for (let c = 1; c < f.length; c++) if (String(f[c]).trim() && enc[c]) item.push({ campo: enc[c], valor: f[c] });
      if (item.length) actual.items.push(item);
    }
    return { encabezado: enc[0], grupos: grupos };
  } catch (e) {
    return { error: e.message, grupos: [] };
  }
}

// ───────────────────────────── MÓDULO 4: GESTIÓN ─────────────────────────────

function validarLoginAdmin(usuario, clave) {
  const cache = CacheService.getScriptCache();
  const intentos = Number(cache.get('sigbe_intentos')) || 0;
  if (intentos >= 5) return { exito: false, mensaje: 'Demasiados intentos. Espera 10 minutos.' };
  const props = PropertiesService.getScriptProperties();
  const u = props.getProperty('SIGBE_USUARIO');
  const hash = props.getProperty('SIGBE_CLAVE_HASH');
  if (!u || !hash) return { exito: false, mensaje: 'Falta configurar el usuario y la clave (menú 🔄 Sincronización).' };
  if (usuario === u && sigbeHash_(clave, props.getProperty('SIGBE_SAL')) === hash) {
    cache.remove('sigbe_intentos');
    const token = Utilities.getUuid();
    cache.put('sigbe_sesion_' + token, usuario, SIGBE_HORAS_SESION * 3600);
    return { exito: true, token: token, mensaje: 'Acceso autorizado' };
  }
  cache.put('sigbe_intentos', String(intentos + 1), 600);
  return { exito: false, mensaje: 'Usuario o contraseña incorrectos' };
}

/** Listas para el formulario: plantas, estados, certificados y contratistas tal como los acepta la hoja. */
function getCatalogos() {
  try {
    const ss = sigbeArchivoDatos_();
    const h = sigbeLeerHolcim_(ss);
    const sh = h.hoja;
    const fila = h.filaEncabezado + 1;
    const lista = (col, porDefecto) => sigbeListaValidacion_(sh.getRange(fila, col)) || porDefecto;
    const plantasHolcim = lista(h.cols.planta, sigbeUnicos_(h.personas.map(p => p.planta)));
    const inhouse = sigbeLeerInhouse_(ss);
    return {
      plantasHolcim: plantasHolcim,
      plantasInhouse: sigbeUnicos_(inhouse.map(p => p.planta).concat(plantasHolcim)),
      estados: lista(h.cols.estado, ['Activo', 'Desvinculado']),
      certificados: h.cols.certificado ? lista(h.cols.certificado, ['41', '21', 'Pendiente']) : ['41', '21', 'Pendiente'],
      contratistas: sigbeUnicos_(inhouse.map(p => p.contratista)),
      fuente: sigbeFuente_(ss),
    };
  } catch (e) {
    return { error: e.message };
  }
}

/** Agrega un brigadista al final de su planta, copiando formato, desplegables y casillas de la fila de arriba. */
function registrarBrigadistaNuevo(token, data) {
  const lock = LockService.getScriptLock();
  try {
    sigbeExigirSesion_(token);
    const nombre = String(data.nombre || '').trim().toUpperCase();
    const cedula = String(data.cedula || '').replace(/\D/g, '');
    const planta = String(data.planta || '').trim();
    if (!nombre || !cedula || !planta) return { exito: false, mensaje: 'Planta, nombre y cédula son obligatorios.' };
    if (!lock.tryLock(20000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo.' };

    const ss = sigbeArchivoDatos_();
    const esHolcim = data.tipo === 'HOLCIM';
    const sh = sigbeHoja_(ss, esHolcim ? SIGBE_HOJA_HOLCIM : SIGBE_HOJA_INHOUSE);
    const t = sigbeTabla_(sh, ['CEDULA']);
    const colCed = t.col('CEDULA');
    const colPlanta = t.col('PLANTA');
    if (t.filas.some(f => String(f.valores[colCed - 1]).replace(/\D/g, '') === cedula)) {
      return { exito: false, mensaje: 'Ya existe un brigadista con la cédula ' + cedula + ' en ' + sh.getName() + '.' };
    }

    // Última fila de esa planta (sin contar los TOTAL); si la planta no existe, al final de los datos
    let pos = 0;
    t.filas.forEach(f => {
      const p = sigbeNorm_(f.valores[colPlanta - 1]);
      if (p === sigbeNorm_(planta)) pos = f.fila;
    });
    if (!pos) pos = t.filas.length ? t.filas[t.filas.length - 1].fila : t.filaEncabezado;

    sh.insertRowAfter(pos);
    const nueva = pos + 1;
    if (pos > t.filaEncabezado) {
      const modelo = sh.getRange(pos, 1, 1, sh.getMaxColumns());
      const destino = sh.getRange(nueva, 1, 1, sh.getMaxColumns());
      modelo.copyTo(destino, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      modelo.copyTo(destino, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    }
    const poner = (encabezado, valor) => {
      const c = t.col(encabezado);
      if (c && valor !== undefined && valor !== '') sh.getRange(nueva, c).setValue(valor);
    };
    poner('PLANTA', planta);
    poner('NOMBRE Y APELLIDO', nombre);
    poner('CEDULA', Number(cedula));
    poner('CERTIFICADO', sigbeNumOTexto_(data.certificado));
    if (esHolcim) {
      poner('ESTADO', data.estado || 'Activo');
      if (data.fechaIngreso) poner('FECHA DE INGRESO', sigbeFecha_(data.fechaIngreso));
    } else {
      poner('CONTRATISTA', String(data.contratista || '').trim().toUpperCase());
    }
    return {
      exito: true,
      mensaje: 'Brigadista guardado en "' + sh.getName() + '", fila ' + nueva + ' (' + sigbeFuente_(ss) + ').' +
        (sigbeFuente_(ss) === 'archivo original' ? ' Aparecerá en el 2.0 con la próxima sincronización.' : ''),
    };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

/** Menú del 2.0: guarda usuario y clave de la app (la clave se guarda cifrada con SHA-256, no en el código). */
function configurarUsuarioApp() {
  const ui = SpreadsheetApp.getUi();
  const u = ui.prompt('Usuario de la app SIGBE', 'Escribe el usuario administrador:', ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK || !u.getResponseText().trim()) return;
  const c = ui.prompt('Clave de la app SIGBE', 'Escribe la clave (mínimo 8 caracteres):', ui.ButtonSet.OK_CANCEL);
  if (c.getSelectedButton() !== ui.Button.OK) return;
  if (c.getResponseText().length < 8) { ui.alert('La clave debe tener al menos 8 caracteres.'); return; }
  const sal = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({
    SIGBE_USUARIO: u.getResponseText().trim(),
    SIGBE_SAL: sal,
    SIGBE_CLAVE_HASH: sigbeHash_(c.getResponseText(), sal),
  });
  ui.alert('Listo. Usuario y clave de la app actualizados.');
}

// ───────────────────────────── LECTURA DE HOJAS ─────────────────────────────

/** Archivo donde están los brigadistas: el original si existe; si no, el 2.0. */
function sigbeArchivoDatos_() {
  return sigbeOrigenOpcional_() || SpreadsheetApp.getActiveSpreadsheet();
}

function sigbeOrigenOpcional_() {
  if (typeof ID_ORIGEN === 'undefined' || !ID_ORIGEN) return null;
  try {
    if (DriveApp.getFileById(ID_ORIGEN).isTrashed()) return null;
    return SpreadsheetApp.openById(ID_ORIGEN);
  } catch (e) {
    return null;
  }
}

function sigbeFuente_(ss) {
  return ss.getId() === SpreadsheetApp.getActiveSpreadsheet().getId() ? 'archivo 2.0' : 'archivo original';
}

function sigbeHoja_(ss, nombre) {
  const exacta = ss.getSheetByName(nombre);
  if (exacta) return exacta;
  const corto = sigbeNorm_(nombre).slice(0, 31);
  const h = ss.getSheets().find(x => sigbeNorm_(x.getName()).indexOf(corto) === 0);
  if (!h) throw new Error('No existe la hoja "' + nombre + '" en "' + ss.getName() + '".');
  return h;
}

/**
 * Ubica la fila de encabezados (la primera, dentro de las 10 primeras, que tiene todos los títulos
 * pedidos) y devuelve las filas de datos con su número real de fila.
 */
function sigbeTabla_(sh, requeridos) {
  const ultima = sh.getLastRow();
  const cols = sh.getLastColumn();
  const v = sh.getRange(1, 1, ultima, cols).getValues();
  const r0 = v.slice(0, 10).findIndex(f => requeridos.every(req => f.some(x => sigbeNorm_(x) === sigbeNorm_(req))));
  if (r0 === -1) throw new Error('No se encontraron los encabezados en "' + sh.getName() + '".');
  const enc = v[r0].map(sigbeNorm_);
  const filas = [];
  for (let r = r0 + 1; r < v.length; r++) {
    if (v[r].some(x => x !== '' && x !== false && x !== null)) filas.push({ fila: r + 1, valores: v[r] });
  }
  return {
    filaEncabezado: r0 + 1,
    encabezados: enc,
    titulosArriba: r0 > 0 ? v[r0 - 1] : [],
    filas: filas,
    /** Columna (1-based) cuyo encabezado es igual al texto o, si no hay, empieza por él. */
    col: texto => {
      const k = sigbeNorm_(texto);
      let i = enc.indexOf(k);
      if (i === -1) i = enc.findIndex(e => e.indexOf(k) === 0);
      return i === -1 ? 0 : i + 1;
    },
  };
}

function sigbeLeerHolcim_(ss) {
  const sh = sigbeHoja_(ss, SIGBE_HOJA_HOLCIM);
  const t = sigbeTabla_(sh, ['PLANTA', 'CEDULA']);
  const cols = {
    planta: t.col('PLANTA'), estado: t.col('ESTADO'), nombre: t.col('NOMBRE Y APELLIDO'),
    cedula: t.col('CEDULA'), certificado: t.col('CERTIFICADO'),
  };

  // Casillas de asistencia: columnas cuyo encabezado empieza por "Asistencia".
  // La fecha de la sesión está en la columna de la izquierda; el módulo, en la fila de títulos de arriba.
  const asistencias = [];
  let modulo = '', titulo = '';
  t.encabezados.forEach((e, i) => {
    const m = String(t.titulosArriba[i] || '').match(/^\s*(M\d+)\s*:\s*(.*)$/);
    if (m) { modulo = m[1]; titulo = m[2].trim(); }
    if (e.indexOf('ASISTENCIA') !== 0 || i === 0 || !modulo) return;
    const s = String(t.encabezados[i - 1]).match(/SESION[_\s]*(\d+)/);
    const sesion = s ? 'Sesión ' + s[1] : 'Sesión ' + (asistencias.filter(a => a.modulo === modulo).length + 1);
    asistencias.push({ key: modulo + '|' + sesion, modulo: modulo, titulo: titulo, sesion: sesion, col: i + 1, colFecha: i });
  });

  const personas = [];
  t.filas.forEach(f => {
    const v = f.valores;
    const planta = String(v[cols.planta - 1] || '').trim();
    const nombre = String(v[cols.nombre - 1] || '').trim();
    if (!nombre || sigbeNorm_(planta).indexOf('TOTAL') === 0) return;
    personas.push({
      fila: f.fila, valores: v, planta: planta, nombre: nombre,
      estado: cols.estado ? String(v[cols.estado - 1] || '') : '',
      cedula: sigbeTexto_(v[cols.cedula - 1]),
      certificado: cols.certificado ? sigbeTexto_(v[cols.certificado - 1]) : '',
    });
  });
  return { hoja: sh, filaEncabezado: t.filaEncabezado, cols: cols, asistencias: asistencias, personas: personas };
}

function sigbeLeerInhouse_(ss) {
  const sh = sigbeHoja_(ss, SIGBE_HOJA_INHOUSE);
  const t = sigbeTabla_(sh, ['PLANTA', 'CEDULA']);
  const c = { planta: t.col('PLANTA'), contratista: t.col('CONTRATISTA') || t.col('EMPRESA'),
    nombre: t.col('NOMBRE Y APELLIDO'), cedula: t.col('CEDULA'), cert: t.col('CERTIFICADO'), estado: t.col('ESTADO') };
  return t.filas
    .filter(f => String(f.valores[c.nombre - 1] || '').trim())
    .map(f => ({
      planta: String(f.valores[c.planta - 1] || '').trim(), tipo: 'INHOUSE',
      contratista: c.contratista ? String(f.valores[c.contratista - 1] || '').trim() : '',
      estado: c.estado ? String(f.valores[c.estado - 1] || '') : '',
      nombre: String(f.valores[c.nombre - 1]).trim(), cedula: sigbeTexto_(f.valores[c.cedula - 1]),
      certVigente: c.cert ? sigbeTexto_(f.valores[c.cert - 1]) : '',
    }));
}

function sigbeBuscarPersona_(personas, cedula, nombre) {
  const ced = String(cedula || '').replace(/\D/g, '');
  const candidatos = personas.filter(p => ced ? p.cedula.replace(/\D/g, '') === ced : true);
  return candidatos.find(p => sigbeNorm_(p.nombre) === sigbeNorm_(nombre)) || (ced && candidatos.length === 1 ? candidatos[0] : null);
}

// ───────────────────────────── UTILIDADES ─────────────────────────────

function sigbeExigirSesion_(token) {
  if (!token || !CacheService.getScriptCache().get('sigbe_sesion_' + token)) {
    throw new Error('La sesión no es válida o expiró. Inicia sesión en "Gestión Brigadistas".');
  }
}

function sigbeHash_(texto, sal) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(sal || '') + String(texto || ''));
  return Utilities.base64Encode(bytes);
}

function sigbeListaValidacion_(celda) {
  const dv = celda.getDataValidation();
  if (!dv || dv.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return null;
  return dv.getCriteriaValues()[0].map(String);
}

function sigbeUnicos_(lista) {
  return lista.map(x => String(x || '').trim()).filter((x, i, a) => x && a.indexOf(x) === i).sort();
}

function sigbeNorm_(x) {
  return String(x === null || x === undefined ? '' : x)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();
}

function sigbeNum_(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v || '').replace('%', '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function sigbeNumOTexto_(v) {
  const s = String(v === undefined ? '' : v).trim();
  return /^\d+$/.test(s) ? Number(s) : s;
}

function sigbeTexto_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  return v === null || v === undefined ? '' : String(v).trim();
}

/** "2026-10-19" (del formulario) → fecha real de la hoja. */
function sigbeFecha_(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : s;
}
