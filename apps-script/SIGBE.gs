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

// Versión de la app. Debe ser la misma en SIGBE.gs e Index.html; la app avisa si no coinciden.
const SIGBE_VERSION = '2.1.0';

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
    version: SIGBE_VERSION,
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

  // Asistencias registradas vs. sesiones que aplican y tienen fecha (solo HOLCIM, que es donde hay casillas)
  let conFecha = 0, marcadas = 0;
  const porSede = {};
  holcim.filter(activos).forEach(p => {
    const s = sigbeSede_(p.planta);
    if (!porSede[s]) porSede[s] = sigbeSesionesSede_(h, s, holcim.filter(activos).filter(x => sigbeSede_(x.planta) === s)).sesiones;
    porSede[s].forEach(x => {
      if (!x.aplica) return;
      const fechaPersona = p.valores[x.colFecha - 1];
      if (fechaPersona instanceof Date || x.fechaIso) {
        conFecha++;
        if (p.valores[x.col - 1] === true) marcadas++;
      }
    });
  });

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
    nombre: p.nombre, cedula: p.cedula, certificado: p.certificado, cumplimiento: p.cumplimiento, fechaIngreso: p.fechaIngreso,
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

/**
 * Sesiones de la sede (módulo + sesión) con su fecha, si aplican según el cronograma y cuántos
 * tienen asistencia marcada. Ver sigbeSesionesSede_ para la regla.
 */
function getSesionesAsistencia(sede) {
  const ss = sigbeArchivoDatos_();
  const h = sigbeLeerHolcim_(ss);
  const personas = h.personas.filter(p => sigbeSede_(p.planta) === sede && !/DESVINCULADO/.test(sigbeNorm_(p.estado)));
  const info = sigbeSesionesSede_(h, sede, personas);
  return {
    total: personas.length,
    enCronograma: info.enCronograma,
    plantasCronograma: info.plantas,
    sesionesPorPlanta: info.sesionesPorPlanta,
    sesiones: info.sesiones.map(x => {
      let marcadas = 0;
      personas.forEach(p => { if (p.valores[x.col - 1] === true) marcadas++; });
      return { key: x.key, modulo: x.modulo, titulo: x.titulo, sesion: x.sesion, fecha: x.fecha, fechaIso: x.fechaIso,
        origenFecha: x.origenFecha, estado: x.estado, aplica: x.aplica, motivo: x.motivo, marcadas: marcadas };
    }),
  };
}

/** Brigadistas de la sede con su asistencia en una sesión. */
function getListaAsistencia(sede, key) {
  const ss = sigbeArchivoDatos_();
  const h = sigbeLeerHolcim_(ss);
  const a = h.asistencias.find(x => x.key === key);
  if (!a) throw new Error('No se encontró la sesión ' + key);
  const personasSede = h.personas.filter(p => sigbeSede_(p.planta) === sede);
  const info = sigbeSesionesSede_(h, sede, personasSede.filter(p => !/DESVINCULADO/.test(sigbeNorm_(p.estado)))).sesiones.find(x => x.key === key) || {};
  return {
    modulo: a.modulo, titulo: a.titulo, sesion: a.sesion, fecha: info.fecha || '', estado: info.estado || '',
    aplica: info.aplica !== false, motivo: info.motivo || '',
    personas: personasSede.map(p => ({
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

// ───────────────────────────── FICHA Y EDICIÓN DE BRIGADISTA ─────────────────────────────

/** Todo lo de una persona: datos, certificado y, si es HOLCIM, cada sesión con su fecha y asistencia. */
function getFichaBrigadista(tipo, cedula, nombre) {
  const ss = sigbeArchivoDatos_();
  if (tipo === 'INHOUSE') {
    const p = sigbeBuscarPersona_(sigbeLeerInhouse_(ss), cedula, nombre);
    if (!p) throw new Error('No se encontró a ' + nombre + ' en la hoja INHOUSE.');
    return { tipo: 'INHOUSE', nombre: p.nombre, cedula: p.cedula, planta: p.planta, sede: sigbeSede_(p.planta), contratista: p.contratista,
      estado: p.estado || 'Activo', certificado: p.certificado, fila: p.fila, hoja: p.hoja.getName(), sesiones: [], fuente: sigbeFuente_(ss) };
  }
  const h = sigbeLeerHolcim_(ss);
  const p = sigbeBuscarPersona_(h.personas, cedula, nombre);
  if (!p) throw new Error('No se encontró a ' + nombre + ' en la hoja HOLCIM.');
  const hoy = sigbeHoy_();
  const sede = sigbeSede_(p.planta);
  const info = sigbeSesionesSede_(h, sede, h.personas.filter(x => sigbeSede_(x.planta) === sede && !/DESVINCULADO/.test(sigbeNorm_(x.estado))));
  return {
    tipo: 'HOLCIM', nombre: p.nombre, cedula: p.cedula, planta: p.planta, sede: sede, contratista: 'HOLCIM',
    estado: p.estado, certificado: p.certificado, fechaIngreso: p.fechaIngreso, cumplimiento: p.cumplimiento,
    cumplimientoTexto: p.cumplimientoTexto, fila: p.fila, hoja: h.hoja.getName(), fuente: sigbeFuente_(ss),
    sesiones: h.asistencias.map(a => {
      const x = info.sesiones.find(y => y.key === a.key) || {};
      const fechaPersona = sigbeTexto_(p.valores[a.colFecha - 1]);
      const fecha = sigbeIso_(fechaPersona) ? fechaPersona : (x.fecha || fechaPersona);
      const iso = sigbeIso_(fecha);
      return { key: a.key, modulo: a.modulo, titulo: a.titulo, sesion: a.sesion, fecha: fecha,
        marcada: p.valores[a.col - 1] === true, pasada: !!iso && iso < hoy, aplica: x.aplica !== false, motivo: x.motivo || '' };
    }),
  };
}

/**
 * Cambia datos de una persona (solo estado, certificado, fecha de ingreso o contratista).
 * data: { tipo, cedula, nombre, cambios: {campo: valorNuevo}, anteriores: {campo: valorQueMostrabaLaPantalla} }
 * Si el valor en la hoja ya no es el que mostraba la pantalla, no se escribe (alguien lo cambió).
 */
function actualizarBrigadista(token, data) {
  const lock = LockService.getScriptLock();
  try {
    const usuario = sigbeExigirSesion_(token);
    if (!lock.tryLock(20000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo.' };
    const ss = sigbeArchivoDatos_();
    const esHolcim = data.tipo !== 'INHOUSE';
    let p, sh, col;
    if (esHolcim) {
      const h = sigbeLeerHolcim_(ss);
      p = sigbeBuscarPersona_(h.personas, data.cedula, data.nombre);
      sh = h.hoja;
      col = { estado: h.cols.estado, certificado: h.cols.certificado, fechaIngreso: h.cols.fechaIngreso };
    } else {
      p = sigbeBuscarPersona_(sigbeLeerInhouse_(ss), data.cedula, data.nombre);
      if (p) { sh = p.hoja; col = { contratista: p.cols.contratista, certificado: p.cols.cert, estado: p.cols.estado }; }
    }
    if (!p) return { exito: false, mensaje: 'No se encontró a ' + data.nombre + ' (' + data.cedula + ') en la hoja.' };

    const etiquetas = { estado: 'Estado', certificado: 'Certificado 0256', fechaIngreso: 'Fecha de ingreso', contratista: 'Contratista' };
    const cambios = data.cambios || {};
    const anteriores = data.anteriores || {};
    const bitacora = [];
    const escrituras = [];
    const rechazos = [];
    Object.keys(cambios).forEach(campo => {
      const c = col[campo];
      if (!c) { rechazos.push(etiquetas[campo] + ': esa columna no existe en la hoja'); return; }
      const actual = sigbeTexto_(p.valores[c - 1]);
      let nuevo = String(cambios[campo] === undefined ? '' : cambios[campo]).trim();
      if (campo === 'contratista') nuevo = nuevo.toUpperCase();
      if (nuevo === actual) return; // sin cambio real
      if (anteriores[campo] !== undefined && sigbeTexto_(anteriores[campo]) !== actual) {
        rechazos.push(etiquetas[campo] + ': cambió en la hoja mientras tanto (ahora es "' + actual + '")'); return;
      }
      const lista = sigbeListaValidacion_(sh.getRange(p.fila, c));
      if (lista && nuevo && lista.indexOf(nuevo) === -1) {
        rechazos.push(etiquetas[campo] + ': "' + nuevo + '" no está en las opciones de la hoja (' + lista.join(', ') + ')'); return;
      }
      let valor = nuevo;
      if (campo === 'fechaIngreso') valor = nuevo ? sigbeFecha_(nuevo) : '';
      if (campo === 'certificado') valor = sigbeNumOTexto_(nuevo);
      escrituras.push({ c: c, valor: valor });
      const nuevoTexto = campo === 'fechaIngreso' && /^\d{4}-\d{2}-\d{2}$/.test(nuevo) ? nuevo.split('-').reverse().join('/') : nuevo;
      bitacora.push(['Edición de brigadista', sh.getName() + ' (' + sigbeFuente_(ss) + ')', p.fila, p.cedula, p.nombre, etiquetas[campo], actual, nuevoTexto]);
    });
    if (!escrituras.length) {
      return { exito: !rechazos.length, mensaje: rechazos.length ? 'No se guardó: ' + rechazos.join('; ') : 'No había cambios.', rechazos: rechazos };
    }
    sigbeRespaldoOriginalDelDia_(ss);
    escrituras.forEach(e => sh.getRange(p.fila, e.c).setValue(e.valor));
    sigbeBitacora_(usuario, bitacora);
    sigbeProgramarSincronizacion_(ss);
    return { exito: true, mensaje: escrituras.length + ' dato(s) actualizado(s) de ' + p.nombre + (rechazos.length ? '. No se aplicó: ' + rechazos.join('; ') : '.'), rechazos: rechazos };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────────── ESTADO DEL SISTEMA Y DIAGNÓSTICO ─────────────────────────────

/** Estado general para la pantalla "Estado del sistema". */
function getEstadoSistema() {
  const ss = sigbeArchivoDatos_();
  const origen = sigbeOrigenOpcional_();
  let detalle = null;
  let ultimaOk = '';
  try {
    const props = PropertiesService.getDocumentProperties();
    detalle = JSON.parse(props.getProperty('ULTIMO_RESULTADO_JSON') || 'null');
    ultimaOk = props.getProperty('ULTIMA_SYNC_OK') || '';
  } catch (e) { /* sin propiedades */ }
  return {
    version: SIGBE_VERSION,
    fuente: sigbeFuente_(ss),
    origen: origen ? { nombre: origen.getName(), url: origen.getUrl() } : null,
    destino: { nombre: SpreadsheetApp.getActiveSpreadsheet().getName(), url: SpreadsheetApp.getActiveSpreadsheet().getUrl() },
    ejecutaComo: sigbeCorreoEjecucion_(),
    sync: Object.assign(getEstadoSincronizacion(), { detalle: detalle, ultimaOk: ultimaOk, automatica: sigbeActivadorAutomatico_() }),
    respaldos: sigbeResumenRespaldos_(),
    bitacora: sigbeConteoBitacora_(),
    hojasSincronizadas: typeof HOJAS_A_COPIAR !== 'undefined' ? HOJAS_A_COPIAR : [],
  };
}

/** Sincronización manual desde la app (exige sesión). Puede tardar hasta 1-2 minutos. */
function sincronizarDesdeApp(token) {
  try {
    sigbeExigirSesion_(token);
    if (typeof sincronizar_ !== 'function') return { exito: false, mensaje: 'Falta el archivo SincronizarBrigadas.gs en el proyecto.' };
    const r = sincronizar_(true, false, 'app');
    if (r.enCurso) return { exito: true, enCurso: true, mensaje: 'Ya había una sincronización en curso; espera un momento y revisa el estado.' };
    return { exito: !r.error, mensaje: r.error ? 'Terminó con avisos o errores. Revisa el detalle.' : 'Sincronización completa.', detalle: r.detalle };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  }
}

/**
 * Revisa todo lo que puede fallar en la sincronización y en la app, y dice qué hacer en cada caso.
 * Lo usa la pantalla "Estado del sistema" y el menú 🩺 del 2.0.
 */
function diagnosticoSistema() {
  const R = [];
  const add = (clave, estado, titulo, detalle, solucion) => R.push({ clave: clave, estado: estado, titulo: titulo, detalle: detalle || '', solucion: solucion || '' });
  const destino = SpreadsheetApp.getActiveSpreadsheet();
  const origen = sigbeOrigenOpcional_();
  const cadaHoras = typeof CADA_HORAS !== 'undefined' ? CADA_HORAS : 1;

  // 1. Archivo original
  if (origen) add('origen', 'ok', 'Archivo original', 'Accesible: "' + origen.getName() + '". La app lee y guarda ahí.');
  else add('origen', 'aviso', 'Archivo original', 'No se puede abrir (borrado, en la papelera o sin acceso). La app está usando el 2.0.',
    'Si el original ya no se usa, desactiva la actualización automática en el menú 🔄 del 2.0. Si debería existir, revisa Drive y los permisos de ' + sigbeCorreoEjecucion_() + '.');

  // 2. Hojas en el original
  if (origen) {
    const hojas = (typeof HOJAS_A_COPIAR !== 'undefined' ? HOJAS_A_COPIAR : [SIGBE_HOJA_HOLCIM, SIGBE_HOJA_INHOUSE, SIGBE_HOJA_CRONOGRAMA]);
    const faltan = hojas.filter(n => { try { sigbeHoja_(origen, n); return false; } catch (e) { return true; } });
    if (faltan.length) add('hojasOrigen', 'error', 'Hojas en el original', 'No se encuentran: ' + faltan.join(', ') + '. La sincronización marcará "no existe en el archivo origen".',
      'Alguien cambió el nombre de la pestaña en el original. Vuelve a ponerle el nombre exacto o actualiza HOJAS_A_COPIAR en SincronizarBrigadas.gs.');
    else add('hojasOrigen', 'ok', 'Hojas en el original', 'Están todas las que se sincronizan (' + hojas.length + ').');
  }

  // 3. Estructura de HOLCIM e INHOUSE (en el archivo que usa la app)
  const ss = sigbeArchivoDatos_();
  let holcim = null, inhouse = null;
  try {
    holcim = sigbeLeerHolcim_(ss);
    const faltan = ['planta', 'estado', 'nombre', 'cedula'].filter(k => !holcim.cols[k]).map(k => ({ planta: 'PLANTA', estado: 'ESTADO', nombre: 'NOMBRE Y APELLIDO', cedula: 'CÉDULA' })[k]);
    if (faltan.length) add('estructuraHolcim', 'error', 'Columnas de la hoja HOLCIM', 'No se encuentran: ' + faltan.join(', ') + '.', 'Alguien cambió el texto del encabezado. Vuelve a escribirlo igual que antes.');
    else if (!holcim.asistencias.length) add('estructuraHolcim', 'error', 'Columnas de la hoja HOLCIM', 'No se encontró ninguna columna "Asistencia" bajo los títulos "M1:", "M2:"…', 'Los encabezados de asistencia deben empezar por "Asistencia" y los de módulo por "M1:", "M2:", etc.');
    else add('estructuraHolcim', 'ok', 'Columnas de la hoja HOLCIM', holcim.personas.length + ' personas, ' + holcim.asistencias.length + ' sesiones con casilla de asistencia' + (holcim.cols.certificado ? '' : ' (sin columna de certificado)') + '.');
  } catch (e) { add('estructuraHolcim', 'error', 'Hoja HOLCIM', e.message, 'Revisa que la pestaña exista y tenga la fila de encabezados (PLANTA, ESTADO, NOMBRE Y APELLIDO, CÉDULA…).'); }
  try {
    inhouse = sigbeLeerInhouse_(ss);
    add('estructuraInhouse', 'ok', 'Columnas de la hoja INHOUSE', inhouse.length + ' contratistas.');
  } catch (e) { add('estructuraInhouse', 'error', 'Hoja INHOUSE', e.message, 'Revisa que la pestaña exista y tenga encabezados PLANTA, CONTRATISTA, NOMBRE Y APELLIDO, CÉDULA.'); }

  // 4. Hojas del 2.0
  const faltan20 = [SIGBE_HOJA_INDICADOR, SIGBE_HOJA_CRONOGRAMA, SIGBE_HOJA_HOLCIM, SIGBE_HOJA_INHOUSE].filter(n => { try { sigbeHoja_(destino, n); return false; } catch (e) { return true; } });
  if (faltan20.length) add('hojas20', 'error', 'Hojas del archivo 2.0', 'Faltan: ' + faltan20.join(', ') + '.', 'Ejecuta "Sincronizar ahora" (trae HOLCIM, INHOUSE y Cronograma) o revisa el nombre de la pestaña Indicador.');
  else add('hojas20', 'ok', 'Hojas del archivo 2.0', 'Indicador, Cronograma, HOLCIM e INHOUSE presentes.');

  // 5. Zona horaria
  if (origen) {
    const a = origen.getSpreadsheetTimeZone(), b = destino.getSpreadsheetTimeZone();
    if (a !== b) add('zonaHoraria', 'aviso', 'Zona horaria', 'Original: ' + a + ' · 2.0: ' + b + '. Las fechas pueden correrse un día al copiarse.', 'En cada archivo: Archivo → Configuración → Zona horaria, y deja la misma (America/Bogota).');
    else add('zonaHoraria', 'ok', 'Zona horaria', 'Ambos archivos en ' + a + '.');
  }

  // 6. Activador automático
  const auto = sigbeActivadorAutomatico_();
  if (auto.desconocido) add('activador', 'info', 'Actualización automática', 'No se pudo consultar desde aquí.', 'Revísalo en el menú 🔄 Sincronización del 2.0.');
  else if (auto.activa) add('activador', 'ok', 'Actualización automática', 'Activa: cada ' + cadaHoras + ' hora(s).');
  else add('activador', 'aviso', 'Actualización automática', 'No está activa: el 2.0 solo se actualiza cuando alguien sincroniza a mano o guarda desde la app.', 'En el 2.0: menú 🔄 Sincronización → Activar actualización automática.');

  // 7. Última sincronización
  const est = getEstadoSincronizacion();
  let detalle = null;
  try { detalle = JSON.parse(PropertiesService.getDocumentProperties().getProperty('ULTIMO_RESULTADO_JSON') || 'null'); } catch (e) {}
  if (!est.ultima) add('ultimaSync', 'aviso', 'Última sincronización', 'Nunca se ha sincronizado.', 'En el 2.0: menú 🔄 Sincronización → Sincronizar ahora.');
  else {
    const horas = sigbeHorasDesde_(est.ultima);
    const errores = detalle && detalle.lineas ? detalle.lineas.filter(l => l.tipo === 'error' || l.tipo === 'aviso') : [];
    if (errores.length) add('ultimaSync', 'error', 'Última sincronización', est.ultima + ': ' + errores.map(l => l.texto).join(' | '),
      'Lee el mensaje: "no existe en el archivo origen" = pestaña renombrada; "posible borrado masivo" = se borró mucha información en el original (si es correcto, usa "Sincronizar aceptando un borrado grande"); "No se encontró la hoja" = Google no dejó copiar la pestaña (se reintenta celda por celda).');
    else if (auto.activa && horas !== null && horas > cadaHoras * 2 + 0.5) add('ultimaSync', 'aviso', 'Última sincronización', est.ultima + ' (hace ' + Math.round(horas) + ' horas, más de lo esperado).',
      'El activador puede haber fallado (Google avisa por correo al dueño). Prueba "Sincronizar ahora"; si falla, desactiva y vuelve a activar la actualización automática.');
    else add('ultimaSync', 'ok', 'Última sincronización', est.ultima + (detalle ? ' · ' + detalle.duracionSeg + ' s · ' + ({ manual: 'desde el menú', automatica: 'automática', app: 'desde la app' })[detalle.origen] : '') + (est.pendiente ? ' · hay una actualización rápida en curso' : ''));
    if (detalle && detalle.duracionSeg > 240) add('duracionSync', 'aviso', 'Duración de la sincronización', detalle.duracionSeg + ' segundos. Google corta los scripts a los 6 minutos.',
      'Reduce filas/columnas vacías en las hojas del original (filas al final sin datos) o quita hojas de HOJAS_A_COPIAR que no necesites.');
  }

  // 8. Desfase entre original y 2.0
  if (origen && holcim) {
    try {
      const h20 = sigbeLeerHolcim_(destino);
      const clave = p => p.cedula + '|' + sigbeNorm_(p.nombre);
      const a = holcim.personas.map(clave), b = h20.personas.map(clave);
      const soloOrigen = a.filter(x => b.indexOf(x) === -1).length, solo20 = b.filter(x => a.indexOf(x) === -1).length;
      let asisDif = 0;
      holcim.personas.forEach(p => { const q = h20.personas.find(x => clave(x) === clave(p)); if (q) holcim.asistencias.forEach(x => { const y = h20.asistencias.find(z => z.key === x.key); if (y && (p.valores[x.col - 1] === true) !== (q.valores[y.col - 1] === true)) asisDif++; }); });
      if (soloOrigen || solo20 || asisDif) add('desfase', 'aviso', 'Diferencias entre el original y el 2.0 (HOLCIM)', (soloOrigen ? soloOrigen + ' persona(s) solo en el original. ' : '') + (solo20 ? solo20 + ' solo en el 2.0. ' : '') + (asisDif ? asisDif + ' asistencia(s) distintas.' : ''),
        'Es normal durante unos minutos tras un cambio. Si persiste, usa "Sincronizar ahora". Recuerda: lo que se escriba a mano en HOLCIM/INHOUSE del 2.0 se pierde al sincronizar.');
      else add('desfase', 'ok', 'Original y 2.0 (HOLCIM)', 'Mismas personas y mismas asistencias.');
    } catch (e) { add('desfase', 'info', 'Original y 2.0', 'No se pudo comparar: ' + e.message); }
  }

  // 9. Respaldos
  const resp = sigbeResumenRespaldos_();
  if (!resp.carpeta) add('respaldos', 'aviso', 'Respaldos', 'Todavía no existe la carpeta de respaldos (se crea con el primer cambio o sincronización).');
  else add('respaldos', resp.ultimos.length || resp.ultimosOriginal.length ? 'ok' : 'aviso', 'Respaldos en Drive', resp.ultimos.length || resp.ultimosOriginal.length ? 'Último del 2.0: ' + (resp.ultimos[0] || 'ninguno aún') + ' · último del original: ' + (resp.ultimosOriginal[0] || 'ninguno aún') : 'La carpeta existe pero está vacía.',
    'Se restaura desde el menú 🔄 Sincronización → Restaurar desde un respaldo, o abriendo la copia en Drive.');

  // 10. Usuario y clave
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SIGBE_USUARIO') && props.getProperty('SIGBE_CLAVE_HASH')) add('credenciales', 'ok', 'Usuario y clave de la app', 'Configurados (usuario: ' + props.getProperty('SIGBE_USUARIO') + ').');
  else add('credenciales', 'error', 'Usuario y clave de la app', 'No están configurados: nadie puede guardar desde la app.', 'En el 2.0: menú 🔄 Sincronización → 🔐 Configurar usuario y clave de la app SIGBE.');

  // 11. Calidad de datos
  if (holcim && inhouse) {
    const todos = holcim.personas.concat(inhouse);
    const porCed = {};
    todos.forEach(p => { const c = p.cedula.replace(/\D/g, ''); if (c) (porCed[c] = porCed[c] || []).push(p.nombre + ' (' + p.planta + ')'); });
    const dup = Object.keys(porCed).filter(c => porCed[c].length > 1);
    if (dup.length) add('duplicados', 'aviso', 'Cédulas repetidas', dup.slice(0, 5).map(c => c + ': ' + porCed[c].join(' / ')).join(' · ') + (dup.length > 5 ? ' · y ' + (dup.length - 5) + ' más' : ''),
      'La app distingue por nombre cuando la cédula se repite, pero conviene corregirlas en el original.');
    else add('duplicados', 'ok', 'Cédulas repetidas', 'Ninguna.');
    const sinCed = todos.filter(p => !p.cedula.replace(/\D/g, ''));
    if (sinCed.length) add('sinCedula', 'aviso', 'Personas sin cédula', sinCed.slice(0, 8).map(p => p.nombre).join(', ') + (sinCed.length > 8 ? ' y ' + (sinCed.length - 8) + ' más' : ''), 'Agrega la cédula en el original; sin ella la app solo puede ubicarlas por nombre.');
    const sedes = SIGBE_SEDES.map(x => x[0]);
    const sinSede = sigbeUnicos_(todos.map(p => p.planta).filter(p => sedes.indexOf(sigbeSede_(p)) === -1));
    if (sinSede.length) add('sedes', 'aviso', 'Plantas sin sede asignada', sinSede.join(', '), 'Esas personas solo aparecen en "Todas las sedes". Agrega la palabra clave de la planta en SIGBE_SEDES (SIGBE.gs).');
    else add('sedes', 'ok', 'Plantas y sedes', 'Todas las plantas tienen sede.');
  }

  // 12. Cronograma frente a brigadistas (de aquí salen las sesiones que aplican por sede)
  if (holcim) {
    try {
      const crono = sigbeCronogramaCeldas_();
      const sedesCrono = sigbeUnicos_(crono.bloques.map(b => b.sede));
      const sedesHolcim = sigbeUnicos_(holcim.personas.map(p => sigbeSede_(p.planta)));
      const sinCrono = sedesHolcim.filter(x => sedesCrono.indexOf(x) === -1);
      if (sinCrono.length) add('cronogramaSedes', 'aviso', 'Sedes sin columna en el cronograma', sinCrono.join(', ') + '. Para ellas la app ofrece todas las sesiones.', 'Agrega la planta al cronograma (fila 1) o revisa su nombre.');
      else add('cronogramaSedes', 'ok', 'Sedes en el cronograma', sedesCrono.length + ' plantas con ' + crono.bloques.length + ' bloques de sesión; sesiones por sede: ' +
        sedesHolcim.map(x => x + ' ' + Math.max.apply(null, crono.bloques.filter(b => b.sede === x).map(b => b.n)) ).join(', ') + '.');
      const sinFila = [];
      const vistos = {};
      holcim.asistencias.forEach(a => {
        if (vistos[a.modulo]) return; vistos[a.modulo] = true;
        const clave = sigbeClaveEntrenamiento_(a.titulo);
        if (!crono.filas.some(f => sigbeMismoEntrenamiento_(f.clave, clave))) sinFila.push(a.modulo + ' ' + a.titulo);
      });
      if (sinFila.length) add('cronogramaModulos', 'info', 'Módulos de HOLCIM sin fila en el cronograma', sinFila.join(' · ') + '. Sus sesiones solo se ofrecen si ya tienen fecha en la hoja de brigadistas.', 'Si el módulo sí se dicta, agrega su fila al cronograma con el mismo nombre.');
      else add('cronogramaModulos', 'ok', 'Módulos y cronograma', 'Todos los módulos de HOLCIM tienen fila en el cronograma.');
    } catch (e) { add('cronogramaSedes', 'aviso', 'Cronograma', 'No se pudo leer: ' + e.message, 'Revisa que la pestaña del cronograma exista en el 2.0 con sus 3 filas de encabezado.'); }
  }

  // 13. Ejecución y versión
  add('ejecucion', 'info', 'La app se ejecuta como', sigbeCorreoEjecucion_() + '. Esa cuenta necesita editar el original y el 2.0.');
  add('version', 'info', 'Versión instalada', 'SIGBE ' + SIGBE_VERSION + '. Si la app muestra otra versión, falta "Implementar → Nueva versión".');

  return { fecha: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'), revisiones: R,
    resumen: { ok: R.filter(r => r.estado === 'ok').length, aviso: R.filter(r => r.estado === 'aviso').length, error: R.filter(r => r.estado === 'error').length } };
}

function sigbeActivadorAutomatico_() {
  try {
    const t = ScriptApp.getProjectTriggers().filter(x => x.getHandlerFunction() === 'sincronizar');
    return { activa: t.length > 0, cadaHoras: typeof CADA_HORAS !== 'undefined' ? CADA_HORAS : 1 };
  } catch (e) {
    return { activa: false, desconocido: true };
  }
}

function sigbeResumenRespaldos_() {
  try {
    const nombre = typeof CARPETA_RESPALDOS !== 'undefined' ? CARPETA_RESPALDOS : 'Respaldos Gestion de Brigadas 2.0';
    const it = DriveApp.getFoldersByName(nombre);
    if (!it.hasNext()) return { carpeta: null, ultimos: [], ultimosOriginal: [] };
    const carpeta = it.next();
    const a = [], b = [];
    const files = carpeta.getFiles();
    while (files.hasNext()) {
      const n = files.next().getName();
      if (n.indexOf('Respaldo 2.0 ') === 0) a.push(n.replace('Respaldo 2.0 ', ''));
      else if (n.indexOf('Respaldo ORIGINAL ') === 0) b.push(n.replace('Respaldo ORIGINAL ', ''));
    }
    a.sort().reverse(); b.sort().reverse();
    return { carpeta: nombre, url: carpeta.getUrl(), ultimos: a.slice(0, 3), ultimosOriginal: b.slice(0, 3), total: a.length + b.length };
  } catch (e) {
    return { carpeta: null, ultimos: [], ultimosOriginal: [], error: e.message };
  }
}

function sigbeConteoBitacora_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SIGBE_HOJA_BITACORA);
  return sh ? Math.max(sh.getLastRow() - 1, 0) : 0;
}

function sigbeCorreoEjecucion_() {
  try { return Session.getEffectiveUser().getEmail() || '(cuenta del propietario)'; } catch (e) { return '(cuenta del propietario)'; }
}

/** Horas transcurridas desde una fecha "yyyy-MM-dd HH:mm" (hora del script); null si no se puede leer. */
function sigbeHorasDesde_(txt) {
  const m = String(txt).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return null;
  const ahora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  const a = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const b = Date.UTC(+ahora[1], +ahora[2] - 1, +ahora[3], +ahora[4], +ahora[5]);
  return (b - a) / 3600000;
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
    cumplimientoTexto: t.col('CUMMPLIMIENTO') || t.col('CUMPLIMIENTO DEL'), fechaIngreso: t.col('FECHA DE INGRESO'),
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
      cumplimientoTexto: cols.cumplimientoTexto ? sigbeTexto_(v[cols.cumplimientoTexto - 1]) : '',
      fechaIngreso: cols.fechaIngreso ? sigbeTexto_(v[cols.fechaIngreso - 1]) : '',
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
      fila: f.fila, valores: f.valores, hoja: sh, cols: c,
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

// ───────────────────────────── CRONOGRAMA → SESIONES QUE APLICAN POR SEDE ─────────────────────────────

let sigbeCronoCache_ = null;

/**
 * Lee el cronograma una sola vez por ejecución y lo deja como:
 *  bloques: [{ planta, sede, sesion, n (1 o 2), colFecha, colEstado }]  (una planta puede tener 1 o 2 bloques)
 *  filas:   [{ entrenamiento, clave, celdas: [{ aplica, fecha, fechaIso, estado }] }]  (una celda por bloque)
 * Una celda con "-" (o fondo gris) significa que ese entrenamiento NO aplica a esa planta.
 */
function sigbeCronogramaCeldas_() {
  if (sigbeCronoCache_) return sigbeCronoCache_;
  const sh = sigbeHoja_(SpreadsheetApp.getActiveSpreadsheet(), SIGBE_HOJA_CRONOGRAMA);
  const rango = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn());
  const v = rango.getValues(), d = rango.getDisplayValues(), bg = rango.getBackgrounds();
  const bloques = [];
  let planta = '', bloque = null, n = 0;
  for (let c = 2; c < d[0].length; c++) {
    if (d[0][c]) { planta = d[0][c].trim(); n = 0; }
    if (d[0][c] || d[1][c]) {
      n++;
      bloque = { planta: planta, sede: sigbeSede_(planta), sesion: (d[1][c] || 'Sesión ' + n).trim(), n: n, colFecha: -1, colEstado: -1 };
      bloques.push(bloque);
    }
    if (bloque && d[2][c]) {
      const k = sigbeNorm_(d[2][c]);
      if (k === 'FECHA HOLCIM') bloque.colFecha = c;
      if (k === 'ESTADO') bloque.colEstado = c;
    }
  }
  const filas = [];
  for (let r = 3; r < d.length; r++) {
    const entrenamiento = d[r][1].trim();
    if (!entrenamiento) continue;
    filas.push({
      entrenamiento: entrenamiento,
      clave: sigbeClaveEntrenamiento_(entrenamiento),
      celdas: bloques.map(b => {
        if (b.colFecha < 0) return { aplica: false, fecha: '', fechaIso: '', estado: '' };
        const txt = d[r][b.colFecha].trim();
        const val = v[r][b.colFecha];
        const noAplica = txt === '-' || sigbeEsGris_(bg[r][b.colFecha]);
        const esError = txt.charAt(0) === '#'; // #VALUE!, #REF!… en el cronograma = sin fecha
        return {
          aplica: !noAplica,
          fecha: val instanceof Date ? sigbeTexto_(val) : (noAplica || esError ? '' : txt),
          fechaIso: val instanceof Date ? Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
          estado: b.colEstado >= 0 ? d[r][b.colEstado].trim() : '',
        };
      }),
    });
  }
  sigbeCronoCache_ = { bloques: bloques, filas: filas };
  return sigbeCronoCache_;
}

/**
 * Para una sede, decide qué sesiones de la hoja HOLCIM aplican, con qué fecha y por qué.
 * Regla: una sesión aplica si (a) ya tiene fecha real en la hoja de brigadistas para esa planta, o
 * (b) el cronograma tiene, para esa planta, una celda que no sea "-" en una fila del mismo módulo.
 * Las filas del cronograma que coinciden con el módulo se recorren en orden y, dentro de cada una,
 * Sesión 1 y luego Sesión 2: así M8 (Rsln 0256, 3 filas) da 3 sesiones a una planta de 1 sesión y 6 a una de 2.
 * Si la sede no aparece en el cronograma, todas las sesiones aplican (no hay con qué filtrar).
 */
function sigbeSesionesSede_(h, sede, personasSede) {
  let crono = null;
  try { crono = sigbeCronogramaCeldas_(); } catch (e) { crono = null; }
  const idxBloques = crono ? crono.bloques.map((b, i) => i).filter(i => crono.bloques[i].sede === sede) : [];
  const enCronograma = idxBloques.length > 0;
  const plantas = sigbeUnicos_(idxBloques.map(i => crono.bloques[i].planta));
  const sesionesPorPlanta = enCronograma ? Math.max.apply(null, idxBloques.map(i => crono.bloques[i].n)) : 0;

  // Fecha real más común en la hoja de brigadistas, por sesión
  const fechaHoja = a => {
    const c = {};
    personasSede.forEach(p => { const f = p.valores[a.colFecha - 1]; if (f instanceof Date) { const t = sigbeTexto_(f); c[t] = (c[t] || 0) + 1; } });
    return Object.keys(c).sort((x, y) => c[y] - c[x])[0] || '';
  };

  const clavesUsadas = {};
  const porModulo = {};
  const sesiones = h.asistencias.map(a => {
    if (!porModulo[a.modulo]) {
      const clave = sigbeClaveEntrenamiento_(a.titulo);
      const duplicado = !!clavesUsadas[clave];
      clavesUsadas[clave] = true;
      const filas = (crono && !duplicado) ? crono.filas.filter(f => sigbeMismoEntrenamiento_(f.clave, clave)) : [];
      // Celdas aplicables para la sede: se toma la planta con más celdas (en Valle hay Palmira y Calisur)
      let celdas = [];
      plantas.forEach(pl => {
        const idx = idxBloques.filter(i => crono.bloques[i].planta === pl);
        const lista = [];
        filas.forEach(f => idx.forEach(i => { const c = f.celdas[i]; if (c.aplica) lista.push(c); }));
        if (lista.length > celdas.length) celdas = lista;
      });
      porModulo[a.modulo] = { filas: filas.length, celdas: celdas, duplicado: duplicado, i: 0 };
    }
    const m = porModulo[a.modulo];
    const celda = m.celdas[m.i++] || null;
    const fh = fechaHoja(a);
    let aplica, motivo;
    if (fh) { aplica = true; motivo = 'Fecha asignada en la hoja de brigadistas'; }
    else if (!enCronograma) { aplica = true; motivo = 'La sede no está en el cronograma: se ofrecen todas las sesiones'; }
    else if (celda) { aplica = true; motivo = 'Según el cronograma'; }
    else if (m.duplicado) { aplica = false; motivo = 'Módulo repetido en la hoja (mismo nombre que otro) y sin fecha'; }
    else if (m.filas) { aplica = false; motivo = 'No aplica en esta sede según el cronograma'; }
    else { aplica = false; motivo = 'Este módulo no está en el cronograma y no tiene fecha en la hoja'; }
    const fecha = fh || (celda ? celda.fecha : '');
    return { key: a.key, modulo: a.modulo, titulo: a.titulo, sesion: a.sesion, col: a.col, colFecha: a.colFecha,
      fecha: fecha, fechaIso: fh ? sigbeIso_(fh) : (celda ? celda.fechaIso : ''), origenFecha: fh ? 'hoja' : (celda && celda.fecha ? 'cronograma' : ''),
      estado: celda ? celda.estado : '', aplica: aplica, motivo: motivo };
  });
  return { enCronograma: enCronograma, plantas: plantas, sesionesPorPlanta: sesionesPorPlanta, sesiones: sesiones };
}

/** Texto comparable de un entrenamiento: primera línea, sin prefijo "AGG:", "TODOS:", "RMX & TQC:", sin tildes ni puntuación. */
function sigbeClaveEntrenamiento_(txt) {
  let t = String(txt || '').split('\n')[0].trim();
  const m = t.match(/^([A-Za-z&\s]{1,15}):\s*(.+)$/);
  if (m) t = m[2];
  return sigbeNorm_(t).replace(/[,;:.()*]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sigbeMismoEntrenamiento_(a, b) {
  if (!a || !b || a.length < 8 || b.length < 8) return false;
  return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
}

/** Fondo gris (como las celdas "-" del cronograma): tonos entre #505050 y #d0d0d0 con r≈g≈b. */
function sigbeEsGris_(color) {
  const m = String(color || '').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r >= 0x50 && r <= 0xd0;
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
