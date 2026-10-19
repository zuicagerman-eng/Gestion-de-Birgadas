/**
 * SIGBE 2.0 - Sistema de Gestión de Brigadas (backend de la app web)
 *
 * Va en el mismo proyecto de Apps Script del archivo 2.0, junto a SincronizarBrigadas.gs
 * (usa su ID_ORIGEN y su carpeta de respaldos).
 *
 * DÓNDE LEE Y ESCRIBE
 *  - Brigadistas HOLCIM e INHOUSE: en el ARCHIVO ORIGINAL (donde también marcan los proveedores).
 *    El 2.0 lo recibe con la sincronización (1-2 minutos después de guardar desde la app).
 *    Si el original ya no existe o está en la papelera, usa automáticamente el 2.0.
 *  - Indicador, Cronograma y Temarios: se leen del 2.0.
 *
 * SEDES: cada hoja nombra las plantas distinto ("AGG - MONDOÑEDO", "Mondoñedo", "AGG - Mondoñedo"),
 * así que la app las agrupa por sede (ver SIGBE_SEDES) para poder filtrar todo por una sola.
 *
 * SEGUROS AL ESCRIBIR
 *  - Exige iniciar sesión (usuario y clave del menú 🔄 Sincronización, guardados cifrados).
 *  - Personas por CÉDULA (+ nombre si se repite) y columnas por ENCABEZADO, nunca por posición.
 *  - Solo escribe en casillas de asistencia (nunca sobre fechas o textos).
 *  - Si la casilla cambió desde que se cargó la pantalla (alguien más la marcó), no la pisa y avisa.
 *  - Respaldo completo del archivo original antes del primer cambio de cada día.
 *  - Cada cambio queda en la hoja "Bitácora SIGBE" del 2.0 (quién, cuándo, antes y después).
 */

const SIGBE_HOJA_HOLCIM = '2026 Brigadistas HOLCIM';
const SIGBE_HOJA_INHOUSE = '2026 Brigadistas INHOUSE';
const SIGBE_HOJA_INDICADOR = 'Indicador';
const SIGBE_HOJA_CRONOGRAMA = '2026 Cronograma Nacional Brigadas';
const SIGBE_HOJA_BITACORA = 'Bitácora SIGBE';
const SIGBE_HORAS_SESION = 6;
const SIGBE_DIAS_RESPALDO_ORIGINAL = 30;

// Sede: [nombre a mostrar, palabras que la identifican en cualquier hoja]
const SIGBE_SEDES = [
  ['Mondoñedo', ['MONDONEDO']],
  ['Tocancipá', ['TOCANCIPA', 'TQC']],
  ['Chía', ['CHIA']],
  ['Sibaté', ['SIBATE']],
  ['Puente Aranda', ['PUENTE ARANDA']],
  ['Bello', ['BELLO']],
  ['Valle', ['VALLE', 'PALMIRA', 'CALISUR']],
  ['Boyacá', ['BOYACA', 'TUNJA']],
  ['Nobsa', ['NOBSA', 'CEMENTO', 'GEOCYCLE']],
  ['Barranca', ['BARRANCA']],
  ['Teleport', ['TELEPORT']],
  ['Fundación', ['FUNDACION']],
  ['Transcem', ['TRANSCEM']],
];

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('SIGBE 2.0 - Sistema de Gestión de Brigadas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // Permite insertar la app en Google Sites u otra página interna
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ───────────────────────────── INICIO ─────────────────────────────

/** Datos para arrancar la app: sedes disponibles, estado de la sesión y de la sincronización. */
function getContexto(token) {
  const ss = sigbeArchivoDatos_();
  const h = sigbeLeerHolcim_(ss);
  const inh = sigbeLeerInhouse_(ss);
  const sedes = sigbeUnicos_(h.personas.concat(inh).map(p => sigbeSede_(p.planta)));
  return {
    sedes: SIGBE_SEDES.map(s => s[0]).filter(s => sedes.indexOf(s) !== -1),
    usuario: sigbeUsuarioSesion_(token),
    fuente: sigbeFuente_(ss),
    sync: getEstadoSincronizacion(),
  };
}

/** Resumen de la sede (o de todas si sede = ''). */
function getInicio(sede) {
  const ss = sigbeArchivoDatos_();
  const h = sigbeLeerHolcim_(ss);
  const enSede = p => !sede || sigbeSede_(p.planta) === sede;
  const activos = p => !/DESVINCULADO/.test(sigbeNorm_(p.estado));
  const holcim = h.personas.filter(enSede);
  const inhouse = sigbeLeerInhouse_(ss).filter(enSede);
  const todos = holcim.concat(inhouse).filter(activos);
  const certVigente = todos.filter(p => /^\d+$/.test(p.certificado)).length;

  // Asistencias registradas vs. sesiones con fecha (solo HOLCIM, que es donde hay casillas)
  let conFecha = 0, marcadas = 0;
  holcim.filter(activos).forEach(p => h.asistencias.forEach(a => {
    if (p.valores[a.colFecha - 1] instanceof Date) {
      conFecha++;
      if (p.valores[a.col - 1] === true) marcadas++;
    }
  }));

  const hoy = sigbeHoy_();
  const proximas = sigbeSesionesCronograma_()
    .filter(s => (!sede || s.sede === sede) && s.fechaIso && s.fechaIso >= hoy)
    .sort((a, b) => a.fechaIso < b.fechaIso ? -1 : 1)
    .slice(0, 8);

  const cobertura = sigbeLeerIndicador_().filter(f => !f.esTotal && (!sede || sigbeSede_(f.planta) === sede));
  const personas = cobertura.reduce((n, f) => n + f.personas, 0);
  const actuales = cobertura.reduce((n, f) => n + f.actuales, 0);
  const requeridos = cobertura.reduce((n, f) => n + f.requeridos, 0);

  return {
    brigadistas: todos.length,
    holcim: holcim.filter(activos).length,
    inhouse: inhouse.filter(activos).length,
    certVigente: certVigente,
    certPendiente: todos.length - certVigente,
    asistencia: { conFecha: conFecha, marcadas: marcadas },
    cobertura: { personas: personas, actuales: actuales, requeridos: Math.round(requeridos * 10) / 10,
      pct: personas ? Math.round(actuales / personas * 1000) / 10 : 0 },
    proximas: proximas,
    pendientesCert: todos.filter(p => !/^\d+$/.test(p.certificado))
      .map(p => ({ nombre: p.nombre, planta: p.planta, tipo: p.tipo || 'HOLCIM' })).slice(0, 50),
  };
}

// ───────────────────────────── BRIGADISTAS ─────────────────────────────

function getBrigadistas(sede) {
  const ss = sigbeArchivoDatos_();
  const lista = sigbeLeerHolcim_(ss).personas.map(p => ({
    planta: p.planta, sede: sigbeSede_(p.planta), tipo: 'HOLCIM', contratista: 'HOLCIM', estado: p.estado,
    nombre: p.nombre, cedula: p.cedula, certificado: p.certificado, cumplimiento: p.cumplimiento,
  })).concat(sigbeLeerInhouse_(ss).map(p => ({
    planta: p.planta, sede: sigbeSede_(p.planta), tipo: 'INHOUSE', contratista: p.contratista, estado: p.estado || 'Activo',
    nombre: p.nombre, cedula: p.cedula, certificado: p.certificado, cumplimiento: '',
  })));
  return lista.filter(p => !sede || p.sede === sede);
}

/** Listas para el formulario: plantas, estados y certificados tal como los acepta la hoja. */
function getCatalogos() {
  const ss = sigbeArchivoDatos_();
  const h = sigbeLeerHolcim_(ss);
  const fila = h.filaEncabezado + 1;
  const lista = (col, porDefecto) => (col && sigbeListaValidacion_(h.hoja.getRange(fila, col))) || porDefecto;
  const plantasHolcim = lista(h.cols.planta, sigbeUnicos_(h.personas.map(p => p.planta)));
  const inhouse = sigbeLeerInhouse_(ss);
  return {
    plantasHolcim: plantasHolcim,
    plantasInhouse: sigbeUnicos_(inhouse.map(p => p.planta).concat(plantasHolcim)),
    estados: lista(h.cols.estado, ['Activo', 'Desvinculado']),
    certificados: lista(h.cols.certificado, ['41', '21', 'Pendiente']),
    contratistas: sigbeUnicos_(inhouse.map(p => p.contratista)),
  };
}

/** Agrega un brigadista al final de su planta, copiando formato, desplegables y casillas de la fila de arriba. */
function registrarBrigadistaNuevo(token, data) {
  const lock = LockService.getScriptLock();
  try {
    const usuario = sigbeExigirSesion_(token);
    const nombre = String(data.nombre || '').trim().replace(/\s+/g, ' ').toUpperCase();
    const cedula = String(data.cedula || '').replace(/\D/g, '');
    const planta = String(data.planta || '').trim();
    if (!nombre || !planta) return { exito: false, mensaje: 'La planta y el nombre son obligatorios.' };
    if (cedula.length < 5 || cedula.length > 12) return { exito: false, mensaje: 'La cédula debe tener entre 5 y 12 números.' };
    if (!lock.tryLock(20000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo.' };

    const ss = sigbeArchivoDatos_();
    const esHolcim = data.tipo === 'HOLCIM';
    const sh = sigbeHoja_(ss, esHolcim ? SIGBE_HOJA_HOLCIM : SIGBE_HOJA_INHOUSE);
    const t = sigbeTabla_(sh, ['PLANTA', 'CEDULA']);
    const colCed = t.col('CEDULA');
    const colPlanta = t.col('PLANTA');
    // La cédula no puede existir ni en HOLCIM ni en INHOUSE
    const existe = sigbeLeerHolcim_(ss).personas.concat(sigbeLeerInhouse_(ss))
      .find(p => p.cedula.replace(/\D/g, '') === cedula);
    if (existe) return { exito: false, mensaje: 'La cédula ' + cedula + ' ya está registrada: ' + existe.nombre + ' (' + existe.planta + ').' };

    sigbeRespaldoOriginalDelDia_(ss);

    // Última fila de esa planta (sin contar los TOTAL); si la planta no existe, al final de los datos
    let pos = 0;
    t.filas.forEach(f => { if (sigbeNorm_(f.valores[colPlanta - 1]) === sigbeNorm_(planta)) pos = f.fila; });
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
    sigbeBitacora_(usuario, [['Registro de brigadista', sh.getName() + ' (' + sigbeFuente_(ss) + ')', nueva, cedula, nombre, planta, '', 'Nuevo']]);
    const programada = sigbeProgramarSincronizacion_(ss);
    return {
      exito: true,
      mensaje: nombre + ' quedó registrado en ' + planta + (programada ? '. Se verá en el 2.0 en 1 a 2 minutos.' : '.'),
    };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────────── ASISTENCIA ─────────────────────────────

/** Sesiones de la sede (módulo + sesión) con su fecha y cuántos tienen asistencia marcada. */
function getSesionesAsistencia(sede) {
  const ss = sigbeArchivoDatos_();
  const h = sigbeLeerHolcim_(ss);
  const personas = h.personas.filter(p => sigbeSede_(p.planta) === sede && !/DESVINCULADO/.test(sigbeNorm_(p.estado)));
  return {
    total: personas.length,
    sesiones: h.asistencias.map(a => {
      const fechas = {};
      let marcadas = 0;
      personas.forEach(p => {
        const f = sigbeTexto_(p.valores[a.colFecha - 1]);
        if (f) fechas[f] = (fechas[f] || 0) + 1;
        if (p.valores[a.col - 1] === true) marcadas++;
      });
      const fecha = Object.keys(fechas).sort((x, y) => fechas[y] - fechas[x])[0] || '';
      return { key: a.key, modulo: a.modulo, titulo: a.titulo, sesion: a.sesion, fecha: fecha,
        fechaIso: sigbeIso_(fecha), marcadas: marcadas };
    }),
  };
}

/** Brigadistas de la sede con su asistencia en una sesión. */
function getListaAsistencia(sede, key) {
  const ss = sigbeArchivoDatos_();
  const h = sigbeLeerHolcim_(ss);
  const a = h.asistencias.find(x => x.key === key);
  if (!a) throw new Error('No se encontró la sesión ' + key);
  return {
    modulo: a.modulo, titulo: a.titulo, sesion: a.sesion,
    personas: h.personas.filter(p => sigbeSede_(p.planta) === sede).map(p => ({
      nombre: p.nombre, cedula: p.cedula, planta: p.planta, estado: p.estado,
      activo: !/DESVINCULADO/.test(sigbeNorm_(p.estado)),
      marcada: p.valores[a.col - 1] === true,
      fecha: sigbeTexto_(p.valores[a.colFecha - 1]),
    })),
  };
}

/**
 * Guarda varios cambios de asistencia de una sesión.
 * cambios: [{ cedula, nombre, valor, anterior }] — "anterior" es lo que mostraba la pantalla;
 * si en la hoja ya no coincide (alguien la cambió), ese cambio no se aplica y se informa.
 */
function guardarAsistenciaLote(token, key, cambios) {
  const lock = LockService.getScriptLock();
  try {
    const usuario = sigbeExigirSesion_(token);
    if (!cambios || !cambios.length) return { exito: true, guardados: 0, conflictos: [], mensaje: 'No había cambios.' };
    if (!lock.tryLock(20000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo.' };
    const ss = sigbeArchivoDatos_();
    const h = sigbeLeerHolcim_(ss);
    const a = h.asistencias.find(x => x.key === key);
    if (!a) return { exito: false, mensaje: 'No se encontró la columna de asistencia (' + key + ').' };

    sigbeRespaldoOriginalDelDia_(ss);
    const conflictos = [];
    const bitacora = [];
    let guardados = 0;
    cambios.forEach(c => {
      const p = sigbeBuscarPersona_(h.personas, c.cedula, c.nombre);
      if (!p) { conflictos.push(c.nombre + ' (ya no está en la hoja)'); return; }
      const actual = p.valores[a.col - 1];
      if (actual !== true && actual !== false && actual !== '') { conflictos.push(c.nombre + ' (la celda no es una casilla)'); return; }
      if ((actual === true) !== (c.anterior === true)) { conflictos.push(c.nombre + ' (alguien la cambió mientras tanto)'); return; }
      h.hoja.getRange(p.fila, a.col).setValue(c.valor === true);
      guardados++;
      bitacora.push(['Asistencia', h.hoja.getName() + ' (' + sigbeFuente_(ss) + ')', p.fila, p.cedula, p.nombre,
        a.modulo + ' ' + a.sesion, actual === true ? 'Asistió' : 'No', c.valor === true ? 'Asistió' : 'No']);
    });
    if (bitacora.length) sigbeBitacora_(usuario, bitacora);
    if (guardados) sigbeProgramarSincronizacion_(ss);
    return {
      exito: true, guardados: guardados, conflictos: conflictos,
      mensaje: guardados + ' asistencia(s) guardada(s)' + (conflictos.length ? '; ' + conflictos.length + ' no se aplicaron.' : '.'),
    };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────────── CRONOGRAMA, TEMARIOS, INDICADORES ─────────────────────────────

/** Sesiones del cronograma de la sede, agrupadas por mes, listas para mostrar como lista. */
function getCronograma(sede) {
  const hoy = sigbeHoy_();
  const sesiones = sigbeSesionesCronograma_().filter(s => !sede || s.sede === sede);
  sesiones.forEach(s => { s.pasada = !!s.fechaIso && s.fechaIso < hoy; });
  return sesiones;
}

/** Hojas de temario disponibles (en el 2.0 y, si existe, en el original). */
function getListaTemarios() {
  const nombres = [];
  [SpreadsheetApp.getActiveSpreadsheet(), sigbeOrigenOpcional_()].forEach(ss => {
    if (!ss) return;
    ss.getSheets().forEach(h => {
      const n = h.getName();
      if (/TEMARIO/i.test(n) && nombres.indexOf(n) === -1) nombres.push(n);
    });
  });
  return nombres;
}

/** Lee un temario: encabezados en la primera fila con 3 o más títulos; agrupa por la primera columna. */
function getTemarioCapacitacion(nombreHoja) {
  const origen = sigbeOrigenOpcional_();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja) || (origen && origen.getSheetByName(nombreHoja));
  if (!sh) throw new Error('No existe la hoja ' + nombreHoja);
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const r0 = v.findIndex(f => f.filter(x => String(x).trim()).length >= 3);
  if (r0 === -1) return { grupos: [] };
  const enc = v[r0];
  const grupos = [];
  let actual = null;
  for (let r = r0 + 1; r < v.length; r++) {
    const f = v[r];
    if (!f.some(x => String(x).trim())) continue;
    if (f[0] || !actual) { actual = { titulo: f[0], items: [] }; grupos.push(actual); }
    const item = [];
    for (let c = 1; c < f.length; c++) if (String(f[c]).trim() && enc[c]) item.push({ campo: enc[c], valor: f[c] });
    if (item.length) actual.items.push(item);
  }
  return { encabezado: enc[0], grupos: grupos };
}

function getIndicadores(sede) {
  return sigbeLeerIndicador_().filter(f => !sede || sigbeSede_(f.planta) === sede);
}

// ───────────────────────────── HISTORIAL ─────────────────────────────

function getBitacora() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SIGBE_HOJA_BITACORA);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = Math.min(sh.getLastRow() - 1, 200);
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, 10).getValues().reverse().map(f => ({
    fecha: sigbeTexto_(f[0], true), usuario: f[1], accion: f[2], hoja: f[3], fila: f[4], cedula: sigbeTexto_(f[5]),
    nombre: f[6], detalle: f[7], antes: f[8], despues: f[9],
  }));
}

// ───────────────────────────── SESIÓN ─────────────────────────────

function validarLoginAdmin(usuario, clave) {
  const cache = CacheService.getScriptCache();
  const intentos = Number(cache.get('sigbe_intentos')) || 0;
  if (intentos >= 5) return { exito: false, mensaje: 'Demasiados intentos. Espera 10 minutos.' };
  const props = PropertiesService.getScriptProperties();
  const u = props.getProperty('SIGBE_USUARIO');
  const hash = props.getProperty('SIGBE_CLAVE_HASH');
  if (!u || !hash) return { exito: false, mensaje: 'Falta configurar el usuario y la clave (menú 🔄 Sincronización del 2.0).' };
  if (String(usuario).trim() === u && sigbeHash_(clave, props.getProperty('SIGBE_SAL')) === hash) {
    cache.remove('sigbe_intentos');
    const token = Utilities.getUuid();
    cache.put('sigbe_sesion_' + token, u, SIGBE_HORAS_SESION * 3600);
    return { exito: true, token: token, usuario: u, mensaje: 'Acceso autorizado' };
  }
  cache.put('sigbe_intentos', String(intentos + 1), 600);
  return { exito: false, mensaje: 'Usuario o clave incorrectos' };
}

function cerrarSesionApp(token) {
  if (token) CacheService.getScriptCache().remove('sigbe_sesion_' + token);
  return true;
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

// ───────────────────────────── SINCRONIZACIÓN RÁPIDA ─────────────────────────────

/**
 * Tras guardar en el original, programa una sincronización del 2.0 en ~1 minuto (en vez de esperar
 * la de cada hora). Si ya hay una pendiente no crea otra. Devuelve true si el cambio llegará así.
 */
function sigbeProgramarSincronizacion_(ss) {
  if (sigbeFuente_(ss) !== 'archivo original') return false; // se escribió directo en el 2.0
  try {
    const props = PropertiesService.getScriptProperties();
    const pendiente = Number(props.getProperty('SIGBE_SYNC_PENDIENTE')) || 0;
    if (Date.now() - pendiente < 10 * 60 * 1000) return true;
    ScriptApp.newTrigger('sincronizarPendiente').timeBased().after(60 * 1000).create();
    props.setProperty('SIGBE_SYNC_PENDIENTE', String(Date.now()));
    return true;
  } catch (e) {
    return false; // sin permiso para programar: llegará con la sincronización de cada hora
  }
}

/** La ejecuta el activador de un solo uso que crea sigbeProgramarSincronizacion_. */
function sincronizarPendiente() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizarPendiente')
    .forEach(t => ScriptApp.deleteTrigger(t));
  // Se libera antes de sincronizar: lo que se guarde mientras tanto programa otra pasada
  PropertiesService.getScriptProperties().deleteProperty('SIGBE_SYNC_PENDIENTE');
  if (typeof sincronizar === 'function') sincronizar();
}

/** Fecha y hora de la última sincronización del 2.0 (para mostrarla en la app). */
function getEstadoSincronizacion() {
  try {
    const txt = PropertiesService.getDocumentProperties().getProperty('ULTIMO_RESULTADO') || '';
    const pendiente = Number(PropertiesService.getScriptProperties().getProperty('SIGBE_SYNC_PENDIENTE')) || 0;
    return { ultima: txt.split('\n')[0], pendiente: Date.now() - pendiente < 10 * 60 * 1000 };
  } catch (e) {
    return { ultima: '', pendiente: false };
  }
}

// ───────────────────────────── SEGUROS ─────────────────────────────

/** Copia completa del archivo original antes del primer cambio del día (carpeta de respaldos del 2.0). */
function sigbeRespaldoOriginalDelDia_(ss) {
  if (sigbeFuente_(ss) !== 'archivo original') return; // el 2.0 ya tiene su propio respaldo diario
  const nombre = 'Respaldo ORIGINAL ' + sigbeHoy_();
  const carpeta = typeof carpetaRespaldos_ === 'function' ? carpetaRespaldos_() : DriveApp.getRootFolder();
  if (carpeta.getFilesByName(nombre).hasNext()) return;
  DriveApp.getFileById(ss.getId()).makeCopy(nombre, carpeta);
  const viejos = [];
  const it = carpeta.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('Respaldo ORIGINAL ') === 0) viejos.push(f);
  }
  viejos.sort((a, b) => b.getName().localeCompare(a.getName()));
  viejos.slice(SIGBE_DIAS_RESPALDO_ORIGINAL).forEach(f => f.setTrashed(true));
}

/** Agrega filas a la hoja "Bitácora SIGBE" del 2.0 (la crea si no existe). */
function sigbeBitacora_(usuario, filas) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(SIGBE_HOJA_BITACORA);
    if (!sh) {
      sh = ss.insertSheet(SIGBE_HOJA_BITACORA);
      sh.getRange(1, 1, 1, 10).setValues([['Fecha', 'Usuario', 'Acción', 'Hoja', 'Fila', 'Cédula', 'Nombre', 'Detalle', 'Antes', 'Después']])
        .setFontWeight('bold').setBackground('#1a252f').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      sh.protect().setDescription('Bitácora de la app SIGBE (solo la app escribe aquí)').setWarningOnly(true);
    }
    const ahora = new Date();
    sh.getRange(sh.getLastRow() + 1, 1, filas.length, 10).setValues(filas.map(f => [ahora, usuario].concat(f)));
  } catch (e) {
    console.log('No se pudo escribir la bitácora: ' + e.message);
  }
}

function sigbeExigirSesion_(token) {
  const u = sigbeUsuarioSesion_(token);
  if (!u) throw new Error('La sesión no es válida o expiró. Vuelve a iniciar sesión.');
  return u;
}

function sigbeUsuarioSesion_(token) {
  return token ? CacheService.getScriptCache().get('sigbe_sesion_' + token) : null;
}

function sigbeHash_(texto, sal) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(sal || '') + String(texto || ''));
  return Utilities.base64Encode(bytes);
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
  const v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), Math.max(sh.getLastColumn(), 1)).getValues();
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
    cedula: t.col('CEDULA'), certificado: t.col('CERTIFICADO'), cumplimiento: t.col('% DE CUMPLIMIENTO'),
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
    const cumpl = cols.cumplimiento ? v[cols.cumplimiento - 1] : '';
    personas.push({
      fila: f.fila, valores: v, planta: planta, nombre: nombre, tipo: 'HOLCIM',
      estado: cols.estado ? String(v[cols.estado - 1] || '') : '',
      cedula: sigbeTexto_(v[cols.cedula - 1]),
      certificado: cols.certificado ? sigbeTexto_(v[cols.certificado - 1]) : '',
      cumplimiento: typeof cumpl === 'number' ? Math.round(cumpl * 100) + '%' : '',
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
      certificado: c.cert ? sigbeTexto_(f.valores[c.cert - 1]) : '',
    }));
}

function sigbeLeerIndicador_() {
  const sh = sigbeHoja_(SpreadsheetApp.getActiveSpreadsheet(), SIGBE_HOJA_INDICADOR);
  const t = sigbeTabla_(sh, ['PLANTA', 'EMPRESA']);
  const c = { planta: t.col('PLANTA'), empresa: t.col('EMPRESA'), personas: t.col('TOTAL TRABAJADORES'),
    requeridos: t.col('BRIGADISTAS REQUERIDOS'), actuales: t.col('BRIGADISTAS ACTUALES'),
    gap: t.col('GAP POR GESTION'), cobertura: t.col('% COBERTURA ACTUAL') };
  let planta = '';
  const filas = [];
  t.filas.forEach(f => {
    const v = f.valores;
    planta = String(v[c.planta - 1] || '').trim() || planta;
    const empresa = String(v[c.empresa - 1] || '').trim();
    if (!empresa) return;
    filas.push({
      planta: planta, sede: sigbeSede_(planta), empresa: empresa, esTotal: sigbeNorm_(empresa) === 'TOTAL',
      personas: sigbeNum_(v[c.personas - 1]), requeridos: sigbeNum_(v[c.requeridos - 1]),
      actuales: sigbeNum_(v[c.actuales - 1]), gap: sigbeNum_(v[c.gap - 1]), cobertura: sigbeNum_(v[c.cobertura - 1]),
    });
  });
  return filas;
}

/** Todas las sesiones del cronograma como lista: sede, planta, mes, entrenamiento, sesión, fecha, estado... */
function sigbeSesionesCronograma_() {
  const sh = sigbeHoja_(SpreadsheetApp.getActiveSpreadsheet(), SIGBE_HOJA_CRONOGRAMA);
  const rango = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn());
  const v = rango.getValues();
  const d = rango.getDisplayValues();
  // Bloques: planta (fila 1) → sesión (fila 2) → campos (fila 3)
  const bloques = [];
  let planta = '', bloque = null;
  for (let c = 2; c < d[0].length; c++) {
    if (d[0][c]) planta = d[0][c].trim();
    if (d[0][c] || d[1][c]) { bloque = { planta: planta, sesion: (d[1][c] || 'Sesión 1').trim(), campos: {} }; bloques.push(bloque); }
    if (bloque && d[2][c]) bloque.campos[sigbeNorm_(d[2][c])] = c;
  }
  const lista = [];
  let mes = '';
  for (let r = 3; r < d.length; r++) {
    mes = d[r][0].trim() || mes;
    const entrenamiento = d[r][1].trim();
    if (!entrenamiento) continue;
    bloques.forEach(b => {
      const cf = b.campos['FECHA HOLCIM'];
      if (cf === undefined) return;
      const fechaTxt = d[r][cf].trim();
      if (!fechaTxt || fechaTxt === '-') return;
      const val = (k) => b.campos[k] !== undefined ? d[r][b.campos[k]].trim() : '';
      lista.push({
        sede: sigbeSede_(b.planta), planta: b.planta, mes: mes, entrenamiento: entrenamiento, sesion: b.sesion,
        fecha: v[r][cf] instanceof Date ? sigbeTexto_(v[r][cf]) : fechaTxt,
        fechaIso: v[r][cf] instanceof Date ? Utilities.formatDate(v[r][cf], Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
        fechaAmbipar: val('FECHA AMBIPAR'), estado: val('ESTADO'), observaciones: val('OBSERVACIONES'),
        brigadistas: val('# BRIGADISTAS'),
      });
    });
  }
  return lista;
}

function sigbeBuscarPersona_(personas, cedula, nombre) {
  const ced = String(cedula || '').replace(/\D/g, '');
  const candidatos = personas.filter(p => ced ? p.cedula.replace(/\D/g, '') === ced : true);
  return candidatos.find(p => sigbeNorm_(p.nombre) === sigbeNorm_(nombre)) || (ced && candidatos.length === 1 ? candidatos[0] : null);
}

// ───────────────────────────── UTILIDADES ─────────────────────────────

/** Sede a la que pertenece un nombre de planta de cualquier hoja ("AGG - MONDOÑEDO" → "Mondoñedo"). */
function sigbeSede_(planta) {
  const n = sigbeNorm_(planta);
  const s = SIGBE_SEDES.find(x => x[1].some(k => n.indexOf(k) !== -1));
  return s ? s[0] : String(planta || '').trim();
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

function sigbeTexto_(v, conHora) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), conHora ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy');
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  return v === null || v === undefined ? '' : String(v).trim();
}

function sigbeHoy_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** "dd/MM/yyyy" → "yyyy-MM-dd" (para ordenar y comparar). */
function sigbeIso_(txt) {
  const m = String(txt).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}

/** "2026-10-19" (del formulario) → fecha real de la hoja. */
function sigbeFecha_(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : s;
}
