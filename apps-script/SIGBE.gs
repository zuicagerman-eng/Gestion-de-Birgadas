/**
 * SIGBE 4 - Sistema de Gestión de Brigadas (backend de la app web)
 *
 * PROYECTO INDEPENDIENTE de Apps Script. Archivos: SIGBE.gs (este), LibroNuevo.gs, SincronizarBrigadas.gs,
 * Index.html y appsscript.json.
 *
 * DE DÓNDE LEE Y DÓNDE GUARDA LA APP
 *  - Hasta el corte (ver LibroNuevo.gs):
 *      · lista de asistencia "2026 Brigadistas HOLCIM" → en el 2.0 (SIGBE_ID_DESTINO)
 *      · INHOUSE, cronograma, Indicador., temario y demás pestañas → en el 1.0 (SIGBE_ID_ORIGEN)
 *    Lo que se guarda desde la app llega al libro nuevo ~1 minuto después (actualización rápida).
 *  - Después del corte: todo en el libro nuevo (LIBRO_NUEVO_ID).
 *  - Historial ("Bitácora SIGBE"): en el libro nuevo (o en el 2.0 si todavía no existe).
 *
 * VELOCIDAD: la app pide UNA sola vez todos los datos (getDatos) y filtra en el navegador. El servidor lee
 * cada pestaña una vez, arma un "modelo" compacto y lo guarda en caché (SIGBE_MINUTOS_CACHE). Cualquier
 * guardado desde la app o la tarea de cada hora invalida la caché.
 *
 * CAMBIOS HECHOS EN EL EXCEL: la tarea de cada hora (libroNuevoActualizar) llama a sigbeVigilar_, que compara
 * los datos con la pasada anterior y anota en el historial, como "Excel (detectado)", lo que no se hizo desde la app.
 *
 * SEGUROS AL ESCRIBIR: sesión obligatoria; personas por cédula (+ nombre) y columnas por encabezado; solo
 * casillas de asistencia y campos editables; si la celda cambió desde que se cargó la pantalla no se pisa;
 * no se marca asistencia en sesiones que el cronograma dice que no aplican; respaldo del archivo antes del
 * primer cambio de cada día; todo queda en el historial.
 */

// Versión de la app. Debe ser la misma en SIGBE.gs e Index.html; la app avisa si no coinciden.
const SIGBE_VERSION = '4.0.0';

const SIGBE_HOJA_HOLCIM = '2026 Brigadistas HOLCIM';
const SIGBE_HOJA_INHOUSE = '2026 Brigadistas INHOUSE';
const SIGBE_HOJA_INDICADOR = 'Indicador';
const SIGBE_HOJA_CRONOGRAMA = '2026 Cronograma Nacional Brigadas';
const SIGBE_HOJA_BITACORA = 'Bitácora SIGBE';
const SIGBE_HOJA_SEGUIMIENTO = '2026 Seguimiento';
const SIGBE_HORAS_SESION = 6;
const SIGBE_MINUTOS_CACHE = 10;
const SIGBE_MAX_CAMBIOS = 300;       // máximo de cambios del Excel que se anotan uno por uno en cada pasada
const SIGBE_FILAS_CRONOGRAMA = 120;  // el cronograma tiene ~20 filas de entrenamientos; no se leen las 1.000 vacías

// Sede: [nombre a mostrar, palabras que la identifican en cualquier hoja]
const SIGBE_SEDES = [
  ['Mondoñedo', ['MONDONEDO', 'MOSQUERA']],
  ['Tocancipá', ['TOCANCIPA', 'TQC', 'SOLUCIONES QUIMICAS']],
  ['Chía', ['CHIA']],
  ['Sibaté', ['SIBATE']],
  ['Puente Aranda', ['PUENTE ARANDA']],
  ['Bello', ['BELLO']],
  ['Valle', ['VALLE', 'PALMIRA', 'CALISUR', 'CALI']],
  ['Boyacá', ['BOYACA', 'TUNJA']],
  ['Nobsa', ['NOBSA', 'CEMENTO', 'GEOCYCLE']],
  ['Barranca', ['BARRANCA']],
  ['Teleport', ['TELEPORT']],
  ['Fundación', ['FUNDACION']],
  ['Transcem', ['TRANSCEM']],
];

/**
 * Arma la página: Index.html (pantallas y estilos) + App.html (código de las pantallas).
 * El código va en base64 (solo letras y números) para que ningún paso entre el editor y el navegador lo
 * altere, y sin pasar por el motor de plantillas (la app no usa <? ?>).
 */
function doGet() {
  const codigo = HtmlService.createHtmlOutputFromFile('App').getContent();
  const b64 = Utilities.base64Encode(codigo, Utilities.Charset.UTF_8);
  const html = HtmlService.createHtmlOutputFromFile('Index').getContent()
    .replace('/*SIGBE_APP*/', 'window.__sigbeCargarApp("' + b64 + '");');
  return HtmlService.createHtmlOutput(html)
    .setTitle('SIGBE - Gestión de Brigadas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ═════════════════════════════ ARRANQUE Y DATOS ═════════════════════════════

/** Configuración y sesión (no lee las hojas: es rápido). */
function getContexto(token) {
  const setup = sigbeEstadoSetup_();
  return {
    version: SIGBE_VERSION, setup: setup, usuario: sigbeUsuarioSesion_(token),
    lecturaPublica: sigbeLecturaPublica_(), corte: !!prop_('LIBRO_NUEVO_CORTE'),
  };
}

/**
 * Todos los datos que usan las pantallas, en un solo envío. forzar = true vuelve a leer las hojas
 * aunque haya una copia en caché (botón "Actualizar datos").
 */
function getDatos(token, forzar) {
  sigbeExigirLectura_(token);
  if (!forzar) {
    const m = sigbeCacheLeer_('sigbe_m_' + sigbeGen_());
    if (m) { m.desdeCache = true; return m; }
  }
  const m = sigbeConstruirModelo_();
  sigbeCacheGuardar_('sigbe_m_' + sigbeGen_(), m);
  return m;
}

/**
 * Modelo compacto:
 *  sesiones: [{ key, clave, modulo, parte, n, titulo }]                (columnas de la lista de asistencia)
 *  plantas:  { planta: { sede, linea, enCrono, nSes, bloques, s: [{ a, f, i, o, e, mo }] } }  (una por sesión)
 *            a = 1 aplica / 0 no; f = fecha dd/MM/yyyy; i = yyyy-MM-dd; o = 'cronograma' | 'hoja'; e = estado; mo = motivo
 *  holcim:   [{ r, p, e, n, c, ce, fi, em, m, x }]  m = '0101…' (asistencia por sesión); x = { índice: texto/fecha propia }
 *  inhouse:  [{ r, p, k, n, c, ce, e }]
 *  crono:    [{ sede, pl, n, ses, mes, ent, pre, cl, f, i, amb, e, obs, br }]
 *  indicador:[{ p, sede, emp, tot, per, bri, meta, bre }]
 *  seguimiento: [{ cap, pl, f, i, ah, ac, tot, ej, inf, cl }]  (pestaña "2026 Seguimiento": sesiones realizadas y asistentes)
 */
function sigbeConstruirModelo_() {
  const F = sigbeFuentes_();
  const avisos = F.avisos.slice();
  const h = sigbeLeerHolcim_(sigbeHoja_(F.asistencia, SIGBE_HOJA_HOLCIM));
  let crono = { bloques: [], filas: [] };
  try { crono = sigbeLeerCronograma_(sigbeHoja_(F.datos, SIGBE_HOJA_CRONOGRAMA)); }
  catch (e) { avisos.push('Cronograma: ' + e.message + ' Sin él, todas las sesiones se muestran como aplicables.'); }
  let inhouse = [], indicador = [];
  try { inhouse = sigbeLeerInhouse_(sigbeHoja_(F.datos, SIGBE_HOJA_INHOUSE)); } catch (e) { avisos.push('INHOUSE: ' + e.message); }
  try { indicador = sigbeLeerIndicador_(sigbeHoja_(F.datos, SIGBE_HOJA_INDICADOR)); } catch (e) { avisos.push('Indicador: ' + e.message); }
  let seguimiento = [];
  try { seguimiento = sigbeLeerSeguimiento_(sigbeHoja_(F.datos, SIGBE_HOJA_SEGUIMIENTO)); } catch (e) { /* pestaña opcional */ }

  const plantas = {};
  sigbeUnicos_(h.personas.map(p => p.planta)).forEach(pl => {
    plantas[pl] = sigbeInfoPlanta_(crono, pl, h.sesiones, h.personas.filter(p => p.planta === pl));
  });

  const holcim = h.personas.map(p => {
    const x = {};
    h.sesiones.forEach((s, i) => {
      const v = p.valores[s.colFecha - 1];
      if (v instanceof Date) { const t = sigbeTexto_(v); if (t !== plantas[p.planta].s[i].f) x[i] = t; }
      else if (String(v === null || v === undefined ? '' : v).trim() && !lnEsNota_(v)) x[i] = String(v).trim().slice(0, 60);
    });
    return {
      r: p.fila, p: p.planta, e: p.estado, n: p.nombre, c: p.cedula, ce: p.certificado, fi: p.fechaIngreso, em: p.empresa,
      m: h.sesiones.map(s => p.valores[s.colAsis - 1] === true ? '1' : '0').join(''), x: x,
    };
  });

  const lista = [];
  crono.filas.forEach(f => {
    if (!f.celdas.some(c => c.tipo === 'fecha' || c.estado)) return; // fila sin ninguna fecha (p. ej. la parte combinada de otra)
    crono.bloques.forEach((b, i) => {
      const c = f.celdas[i];
      if (c.tipo === 'noaplica') return;
      lista.push({ sede: b.sede, pl: b.nombre, n: b.n, ses: b.sesion, mes: f.mes, ent: f.nombre, pre: f.prefijo, cl: f.clave,
        f: c.fecha ? sigbeTexto_(c.fecha) : '', i: c.iso || '', amb: c.ambipar, e: c.estado, obs: c.obs, br: c.brig });
    });
  });

  const sedes = sigbeUnicos_(h.personas.map(p => sigbeSede_(p.planta)).concat(inhouse.map(p => sigbeSede_(p.p)), lista.map(x => x.sede)));
  return {
    v: SIGBE_VERSION,
    generado: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    hoy: sigbeHoy_(),
    fuentes: {
      corte: F.corte,
      asistencia: { nombre: F.asistencia.getName(), url: F.asistencia.getUrl(), id: F.asistencia.getId() },
      datos: { nombre: F.datos.getName(), url: F.datos.getUrl(), id: F.datos.getId() },
      soloLectura: F.soloLectura,
    },
    avisos: avisos,
    sesiones: h.sesiones.map(s => ({ key: s.key, clave: s.clave, modulo: s.modulo, parte: s.parte, n: s.n, titulo: s.titulo })),
    plantas: plantas,
    holcim: holcim,
    inhouse: inhouse.map(p => Object.assign(p, { sede: sigbeSede_(p.p) })),
    crono: lista,
    indicador: indicador,
    seguimiento: seguimiento,
    sedes: SIGBE_SEDES.map(s => s[0]).filter(s => sedes.indexOf(s) !== -1).concat(sedes.filter(s => !SIGBE_SEDES.some(x => x[0] === s))),
  };
}

/**
 * Qué sesiones aplican a una planta, con qué fecha y por qué (misma regla que el libro nuevo):
 * cronograma con fecha → esa fecha; "-" o gris → no aplica; vacío → la fecha más común de la hoja;
 * planta con 1 sesión → la Sesión 2 no aplica; filas con prefijo (AGG:, CEM:, RMX & TQC:) solo para esa línea.
 */
function sigbeInfoPlanta_(crono, planta, sesiones, personas) {
  const cfg = lnPlanta_(planta);
  const bloques = cfg ? crono.bloques.map((b, i) => ({ b: b, i: i })).filter(x => x.b.planta.indexOf(cfg.bloque) !== -1) : [];
  const enCrono = bloques.length > 0;
  const no = mo => ({ a: 0, f: '', i: '', o: '', e: '', mo: mo });
  const s = sesiones.map(ses => {
    const comun = sigbeFechaComun_(personas, ses.colFecha);
    const r = { a: 1, f: comun, i: sigbeIso_(comun), o: comun ? 'hoja' : '', e: '', mo: '' };
    if (!enCrono) { r.mo = cfg ? 'Su bloque no está en el cronograma' : 'La planta no está en la tabla LN_PLANTAS'; return r; }
    if (ses.n > bloques.length) return no('La planta tiene ' + bloques.length + ' sesión por tema');
    const fila = lnFilaModulo_(crono, { modulo: ses.modulo, parte: ses.parte }, cfg.linea);
    if (fila === undefined) { r.mo = 'Módulo sin regla en el cronograma'; return r; }
    if (fila === null) return no('Este módulo no es para la línea ' + cfg.linea);
    const c = fila.celdas[bloques[ses.n - 1].i];
    if (c.tipo === 'noaplica') return no('En el cronograma tiene "-" o está en gris');
    r.e = c.estado;
    if (c.tipo === 'fecha') { r.f = sigbeTexto_(c.fecha); r.i = c.iso; r.o = 'cronograma'; }
    else r.mo = 'El cronograma aún no tiene fecha';
    return r;
  });
  return { sede: sigbeSede_(planta), linea: cfg ? cfg.linea : '', enCrono: enCrono, nSes: bloques.length,
    bloques: bloques.map(x => x.b.nombre + ' · ' + x.b.sesion), s: s };
}

/** Fecha que más se repite en una columna de la hoja para esas personas (dd/MM/yyyy) o ''. */
function sigbeFechaComun_(personas, col) {
  const c = {};
  personas.forEach(p => { const v = p.valores[col - 1]; if (v instanceof Date) { const t = sigbeTexto_(v); c[t] = (c[t] || 0) + 1; } });
  return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || '';
}

/**
 * PARA EL EDITOR: revisa paso a paso lo que hace la app al abrir y dice dónde falla y cuánto tarda.
 * Ejecútala desde el editor (menú Ejecutar → probarApp) y mira el registro de ejecución.
 */
function probarApp() {
  lnSoloDueno_();
  const L = ['SIGBE ' + SIGBE_VERSION + ' · cuenta que ejecuta: ' + cuentaScript_()];
  const paso = (nombre, f) => {
    const t = Date.now();
    try { const r = f(); L.push('✔ ' + nombre + ' (' + ((Date.now() - t) / 1000).toFixed(1) + ' s)' + (r ? ': ' + r : '')); return true; }
    catch (e) { L.push('✖ ' + nombre + ': ' + e.message + (e.stack ? '\n   ' + String(e.stack).split('\n').slice(0, 4).join('\n   ') : '')); return false; }
  };
  paso('Configuración', () => { const s = sigbeEstadoSetup_(); return 'lista=' + s.listo + ' · usuario y clave=' + s.credenciales + (s.destinoError ? ' · ' + s.destinoError : ''); });
  let F = null;
  if (!paso('Archivos', () => { F = sigbeFuentes_(); return 'asistencia en "' + F.asistencia.getName() + '" · datos en "' + F.datos.getName() + '"' + (F.corte ? ' · después del corte' : ' · antes del corte') + (F.avisos.length ? ' · ' + F.avisos.join(' | ') : ''); })) return lnMostrar_(L.join('\n'));
  paso('Lista de asistencia', () => { const h = sigbeLeerHolcim_(sigbeHoja_(F.asistencia, SIGBE_HOJA_HOLCIM)); return h.personas.length + ' personas · ' + h.sesiones.length + ' sesiones'; });
  paso('Cronograma', () => { const c = sigbeLeerCronograma_(sigbeHoja_(F.datos, SIGBE_HOJA_CRONOGRAMA)); return c.bloques.length + ' bloques · ' + c.filas.length + ' temas'; });
  paso('INHOUSE', () => sigbeLeerInhouse_(sigbeHoja_(F.datos, SIGBE_HOJA_INHOUSE)).length + ' personas');
  paso('Indicador', () => sigbeLeerIndicador_(sigbeHoja_(F.datos, SIGBE_HOJA_INDICADOR)).length + ' filas');
  paso('Datos completos para la app', () => {
    const m = sigbeConstruirModelo_();
    const fechas = [];
    const buscar = (o, ruta) => { if (o instanceof Date) fechas.push(ruta); else if (o && typeof o === 'object') Object.keys(o).forEach(k => buscar(o[k], ruta + '.' + k)); };
    buscar(m, 'datos');
    if (fechas.length) throw new Error('hay fechas que el navegador no puede recibir: ' + fechas.slice(0, 5).join(', '));
    return m.holcim.length + ' Holcim · ' + m.inhouse.length + ' contratistas · ' + m.crono.length + ' sesiones de cronograma · ' + Math.round(JSON.stringify(m).length / 1024) + ' KB' + (m.avisos.length ? ' · avisos: ' + m.avisos.join(' | ') : '');
  });
  paso('Caché', () => { sigbeCacheGuardar_('sigbe_prueba', { ok: 1 }); return sigbeCacheLeer_('sigbe_prueba') ? 'funciona' : 'no guarda (la app funciona igual, pero más lenta)'; });
  return lnMostrar_(L.join('\n'));
}

// ═════════════════════════════ ASISTENCIA Y BRIGADISTAS (ESCRITURA) ═════════════════════════════

/**
 * Guarda varios cambios de asistencia de una sesión (key = "M8-2|1").
 * cambios: [{ cedula, nombre, valor, anterior }] — "anterior" es lo que mostraba la pantalla.
 */
function guardarAsistenciaLote(token, key, cambios) {
  const lock = LockService.getScriptLock();
  try {
    const usuario = sigbeExigirSesion_(token);
    if (!cambios || !cambios.length) return { exito: true, guardados: 0, conflictos: [], mensaje: 'No había cambios.' };
    if (!lock.tryLock(20000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo en unos segundos.' };
    const F = sigbeFuentes_();
    sigbeExigirEscritura_(F, 'asistencia');
    const sh = sigbeHoja_(F.asistencia, SIGBE_HOJA_HOLCIM);
    const h = sigbeLeerHolcim_(sh);
    const s = h.sesiones.find(x => x.key === key);
    if (!s) return { exito: false, mensaje: 'No se encontró la columna de asistencia (' + key + '). ¿Cambió el encabezado?' };
    let crono = null;
    try { crono = sigbeLeerCronograma_(sigbeHoja_(F.datos, SIGBE_HOJA_CRONOGRAMA)); } catch (e) { crono = null; }
    const info = {};
    const aplica = p => {
      if (!crono) return true;
      if (!info[p.planta]) info[p.planta] = sigbeInfoPlanta_(crono, p.planta, [s], h.personas.filter(x => x.planta === p.planta));
      return info[p.planta].s[0].a === 1;
    };

    try { respaldoDelDia_(F.asistencia); } catch (e) { /* sin espacio en Drive: se sigue, queda el historial de versiones */ }
    const conflictos = [], bitacora = [], aplicados = [];
    let guardados = 0;
    cambios.forEach(c => {
      const p = sigbeBuscarPersona_(h.personas, c.cedula, c.nombre);
      if (!p) { conflictos.push(c.nombre + ' (ya no está en la lista)'); return; }
      const actual = p.valores[s.colAsis - 1];
      if (actual !== true && actual !== false && actual !== '') { conflictos.push(c.nombre + ' (la celda no es una casilla)'); return; }
      if ((actual === true) !== (c.anterior === true)) { conflictos.push(c.nombre + ' (alguien la cambió mientras tanto)'); return; }
      if (c.valor === true && !aplica(p)) { conflictos.push(c.nombre + ' (según el cronograma esa sesión no aplica en ' + p.planta + ')'); return; }
      if (c.valor === true && /NO HACIA PARTE|NO APLICA/.test(sigbeNorm_(p.valores[s.colFecha - 1]))) {
        conflictos.push(c.nombre + ' (en la hoja dice "' + String(p.valores[s.colFecha - 1]).trim() + '")'); return;
      }
      sh.getRange(p.fila, s.colAsis).setValue(c.valor === true);
      guardados++;
      aplicados.push({ cedula: c.cedula, nombre: c.nombre, valor: c.valor === true, anterior: actual === true });
      bitacora.push(['Asistencia', sh.getName(), p.fila, p.cedula, p.nombre, s.clave + ' Sesión ' + s.n,
        actual === true ? 'Asistió' : 'No', c.valor === true ? 'Asistió' : 'No']);
    });
    if (guardados) sigbeTrasGuardar_(F, usuario, bitacora);
    return {
      exito: true, guardados: guardados, conflictos: conflictos, aplicados: aplicados,
      mensaje: guardados + ' asistencia(s) guardada(s)' + (conflictos.length ? '; ' + conflictos.length + ' no se aplicaron.' : '.'),
    };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

/** Agrega un brigadista al final de su planta, copiando formato y desplegables de la fila de arriba. */
function registrarBrigadistaNuevo(token, data) {
  const lock = LockService.getScriptLock();
  try {
    const usuario = sigbeExigirSesion_(token);
    const nombre = String(data.nombre || '').trim().replace(/\s+/g, ' ').toUpperCase();
    const cedula = String(data.cedula || '').replace(/\D/g, '');
    const planta = String(data.planta || '').trim();
    if (!nombre || !planta) return { exito: false, mensaje: 'La planta y el nombre son obligatorios.' };
    if (cedula.length < 5 || cedula.length > 12) return { exito: false, mensaje: 'La cédula debe tener entre 5 y 12 números.' };
    if (!lock.tryLock(20000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo en unos segundos.' };

    const F = sigbeFuentes_();
    const esHolcim = data.tipo === 'HOLCIM';
    sigbeExigirEscritura_(F, esHolcim ? 'asistencia' : 'datos');
    const ss = esHolcim ? F.asistencia : F.datos;
    const sh = sigbeHoja_(ss, esHolcim ? SIGBE_HOJA_HOLCIM : SIGBE_HOJA_INHOUSE);
    const t = sigbeTabla_(sh, ['PLANTA', 'CEDULA']);
    const colPlanta = t.col('PLANTA');
    const existe = sigbeLeerHolcim_(sigbeHoja_(F.asistencia, SIGBE_HOJA_HOLCIM)).personas.map(p => ({ n: p.nombre, p: p.planta, c: p.cedula }))
      .concat(sigbeLeerInhouse_(sigbeHoja_(F.datos, SIGBE_HOJA_INHOUSE)).map(p => ({ n: p.n, p: p.p, c: p.c })))
      .find(p => String(p.c).replace(/\D/g, '') === cedula);
    if (existe) return { exito: false, mensaje: 'La cédula ' + cedula + ' ya está registrada: ' + existe.n + ' (' + existe.p + ').' };

    try { respaldoDelDia_(ss); } catch (e) { /* sigue */ }
    // Última fila de esa planta (sin contar los TOTAL); si la planta no existe, al final de los datos
    let pos = 0;
    t.filas.forEach(f => { if (sigbeNorm_(f.valores[colPlanta - 1]) === sigbeNorm_(planta)) pos = f.fila; });
    if (!pos) pos = t.filas.length ? t.filas[t.filas.length - 1].fila : t.filaEncabezado;
    sh.insertRowAfter(pos);
    const nueva = pos + 1;
    if (pos > t.filaEncabezado) {
      const modelo = sh.getRange(pos, 1, 1, sh.getMaxColumns());
      const destino = sh.getRange(nueva, 1, 1, sh.getMaxColumns());
      try { modelo.copyTo(destino, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) { /* tabla con tipos fijos */ }
      try { modelo.copyTo(destino, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false); } catch (e) { /* idem */ }
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
      // Después del corte nadie más organiza la lista: se aplica el cronograma a la fila nueva aquí mismo
      if (F.corte) { try { lnOrganizarAsistencia_(sh, sigbeHoja_(F.datos, SIGBE_HOJA_CRONOGRAMA)); } catch (e) { /* queda sin fechas hasta la próxima */ } }
    } else {
      poner('CONTRATISTA', String(data.contratista || '').trim().toUpperCase());
    }
    sigbeTrasGuardar_(F, usuario, [['Registro de brigadista', sh.getName(), nueva, cedula, nombre, 'Alta en la lista (' + planta + ')', '', 'Alta']]);
    return { exito: true, mensaje: nombre + ' quedó registrado en ' + planta + '.' };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Cambia datos de una persona (estado, certificado, fecha de ingreso o contratista).
 * data: { tipo, cedula, nombre, cambios: {campo: valorNuevo}, anteriores: {campo: valorQueMostrabaLaPantalla} }
 */
function actualizarBrigadista(token, data) {
  const lock = LockService.getScriptLock();
  try {
    const usuario = sigbeExigirSesion_(token);
    if (!lock.tryLock(20000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo en unos segundos.' };
    const F = sigbeFuentes_();
    const esHolcim = data.tipo !== 'INHOUSE';
    sigbeExigirEscritura_(F, esHolcim ? 'asistencia' : 'datos');
    const ss = esHolcim ? F.asistencia : F.datos;
    let p, sh, col;
    if (esHolcim) {
      sh = sigbeHoja_(ss, SIGBE_HOJA_HOLCIM);
      const h = sigbeLeerHolcim_(sh);
      p = sigbeBuscarPersona_(h.personas, data.cedula, data.nombre);
      col = { estado: h.cols.estado, certificado: h.cols.certificado, fechaIngreso: h.cols.fechaIngreso };
    } else {
      sh = sigbeHoja_(ss, SIGBE_HOJA_INHOUSE);
      const lista = sigbeLeerInhouse_(sh, true);
      p = sigbeBuscarPersona_(lista, data.cedula, data.nombre);
      if (p) col = { contratista: p.cols.contratista, certificado: p.cols.cert, estado: p.cols.estado };
    }
    if (!p) return { exito: false, mensaje: 'No se encontró a ' + data.nombre + ' (' + data.cedula + ') en la hoja.' };

    const etiquetas = { estado: 'Estado', certificado: 'Certificado 0256', fechaIngreso: 'Fecha de ingreso', contratista: 'Contratista' };
    const cambios = data.cambios || {}, anteriores = data.anteriores || {};
    const bitacora = [], escrituras = [], rechazos = [];
    Object.keys(cambios).forEach(campo => {
      if (!etiquetas[campo]) return;
      const c = col[campo];
      if (!c) { rechazos.push(etiquetas[campo] + ': esa columna no existe en la hoja'); return; }
      const actual = sigbeTexto_(p.valores[c - 1]);
      let nuevo = String(cambios[campo] === undefined ? '' : cambios[campo]).trim();
      if (campo === 'contratista') nuevo = nuevo.toUpperCase();
      const nuevoTexto = campo === 'fechaIngreso' && /^\d{4}-\d{2}-\d{2}$/.test(nuevo) ? nuevo.split('-').reverse().join('/') : nuevo;
      if (nuevoTexto === actual) return;
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
      bitacora.push(['Edición de brigadista', sh.getName(), p.fila, p.cedula, p.nombre, etiquetas[campo], actual, nuevoTexto]);
    });
    if (!escrituras.length) {
      return { exito: !rechazos.length, mensaje: rechazos.length ? 'No se guardó: ' + rechazos.join('; ') : 'No había cambios.', rechazos: rechazos };
    }
    try { respaldoDelDia_(ss); } catch (e) { /* sigue */ }
    escrituras.forEach(e => sh.getRange(p.fila, e.c).setValue(e.valor));
    sigbeTrasGuardar_(F, usuario, bitacora);
    return { exito: true, mensaje: escrituras.length + ' dato(s) actualizado(s) de ' + p.nombre + (rechazos.length ? '. No se aplicó: ' + rechazos.join('; ') : '.'), rechazos: rechazos };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

/** Opciones de los formularios tal como las aceptan las hojas. */
function getCatalogos(token) {
  sigbeExigirLectura_(token);
  const F = sigbeFuentes_();
  const sh = sigbeHoja_(F.asistencia, SIGBE_HOJA_HOLCIM);
  const h = sigbeLeerHolcim_(sh);
  const fila = h.filaEncabezado + 1;
  const lista = (hoja, col, porDefecto) => { try { return (col && sigbeListaValidacion_(hoja.getRange(fila, col))) || porDefecto; } catch (e) { return porDefecto; } };
  const shI = sigbeHoja_(F.datos, SIGBE_HOJA_INHOUSE);
  const inhouse = sigbeLeerInhouse_(shI, true);
  const colCert = inhouse.length ? inhouse[0].cols.cert : 0;
  let certificados = ['41', '21', 'Pendiente'];
  if (colCert) { try { certificados = sigbeListaValidacion_(shI.getRange(inhouse[0].fila, colCert)) || certificados; } catch (e) { /* por defecto */ } }
  const plantasHolcim = lista(sh, h.cols.planta, sigbeUnicos_(h.personas.map(p => p.planta)));
  return {
    plantasHolcim: plantasHolcim,
    plantasInhouse: sigbeUnicos_(inhouse.map(p => p.p).concat(plantasHolcim)),
    estados: lista(sh, h.cols.estado, ['Activo', 'Desvinculado']),
    certificados: certificados,
    contratistas: sigbeUnicos_(inhouse.map(p => p.k)),
    holcimTieneCertificado: !!h.cols.certificado,
  };
}

/** Después de guardar: historial, caché nueva y actualización rápida del libro nuevo. */
function sigbeTrasGuardar_(F, usuario, filas) {
  sigbeBitacora_(usuario, filas);
  sigbeInvalidar_();
  sigbeProgramarActualizacion_(F);
}

/** Hasta el corte, programa la actualización del libro nuevo en ~1 minuto (si no hay una pendiente). */
function sigbeProgramarActualizacion_(F) {
  if (F.corte || !F.libro) return false;
  try {
    const props = props_();
    const pendiente = Number(props.getProperty('SIGBE_SYNC_PENDIENTE')) || 0;
    if (Date.now() - pendiente < 10 * 60 * 1000) return true;
    ScriptApp.newTrigger('libroNuevoPendiente').timeBased().after(60 * 1000).create();
    props.setProperty('SIGBE_SYNC_PENDIENTE', String(Date.now()));
    return true;
  } catch (e) {
    return false; // llegará con la tarea de cada hora
  }
}

// ═════════════════════════════ OTRAS PANTALLAS (LECTURA) ═════════════════════════════

/** Pestañas visibles de temario. */
function getListaTemarios(token) {
  sigbeExigirLectura_(token);
  return sigbeFuentes_().datos.getSheets().filter(h => !h.isSheetHidden() && /TEMARIO/i.test(h.getName())).map(h => h.getName());
}

/** Lee un temario: encabezados en la primera fila con 3 o más títulos; agrupa por la primera columna. */
function getTemarioCapacitacion(token, nombreHoja) {
  sigbeExigirLectura_(token);
  const clave = 'sigbe_t_' + sigbeGen_() + '_' + Utilities.base64EncodeWebSafe(String(nombreHoja)).slice(0, 120);
  const c = sigbeCacheLeer_(clave);
  if (c) return c;
  const sh = sigbeFuentes_().datos.getSheetByName(nombreHoja);
  if (!sh || !/TEMARIO/i.test(nombreHoja)) throw new Error('No existe la hoja de temario ' + nombreHoja);
  const v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), Math.max(sh.getLastColumn(), 1)).getDisplayValues();
  const r0 = v.findIndex(f => f.filter(x => String(x).trim()).length >= 3);
  let res = { encabezado: '', grupos: [] };
  if (r0 !== -1) {
    const enc = v[r0];
    const grupos = [];
    let actual = null;
    for (let r = r0 + 1; r < v.length; r++) {
      const f = v[r];
      if (!f.some(x => String(x).trim())) continue;
      if (f[0] || !actual) { actual = { titulo: f[0], items: [] }; grupos.push(actual); }
      const item = [];
      for (let k = 1; k < f.length; k++) if (String(f[k]).trim() && enc[k]) item.push({ campo: enc[k], valor: f[k] });
      if (item.length) actual.items.push(item);
    }
    res = { encabezado: enc[0], grupos: grupos };
  }
  sigbeCacheGuardar_(clave, res);
  return res;
}

/** Pestañas visibles que no tienen pantalla propia (Seguimiento, Datos de contacto, Evacuadores…). */
function getHojasExtra(token) {
  sigbeExigirLectura_(token);
  return sigbeFuentes_().datos.getSheets().filter(h => !h.isSheetHidden() && !sigbeEsHojaPropia_(h.getName())).map(h => h.getName());
}

/** Una pestaña como tabla: { nombre, titulo, encabezados, filas }. Detecta la fila de títulos sola. */
function getHojaExtra(token, nombre) {
  sigbeExigirLectura_(token);
  const clave = 'sigbe_x_' + sigbeGen_() + '_' + Utilities.base64EncodeWebSafe(String(nombre)).slice(0, 120);
  const c = sigbeCacheLeer_(clave);
  if (c) return c;
  const sh = sigbeFuentes_().datos.getSheetByName(nombre);
  if (!sh || sh.isSheetHidden() || sigbeEsHojaPropia_(nombre)) throw new Error('La pestaña "' + nombre + '" no está disponible.');
  const nf = Math.min(Math.max(sh.getLastRow(), 1), 3000), nc = Math.min(Math.max(sh.getLastColumn(), 1), 60);
  const d = sh.getRange(1, 1, nf, nc).getDisplayValues();
  let r0 = 0, mejor = -1;
  for (let r = 0; r < Math.min(6, d.length); r++) {
    const n = d[r].filter(x => String(x).trim()).length;
    if (n > mejor) { mejor = n; r0 = r; }
  }
  const usadas = [];
  for (let k = 0; k < nc; k++) if (d.some((f, r) => r >= r0 && String(f[k]).trim())) usadas.push(k);
  const filas = [];
  for (let r = r0 + 1; r < d.length; r++) {
    const f = usadas.map(k => String(d[r][k]).trim());
    if (f.some(String)) filas.push(f);
  }
  const res = {
    nombre: nombre,
    titulo: d.slice(0, r0).map(f => f.filter(x => String(x).trim()).join(' · ')).filter(String).join(' — '),
    encabezados: usadas.map(k => String(d[r0][k]).replace(/\s+/g, ' ').trim() || 'Columna ' + lnLetra_(k)),
    filas: filas,
  };
  sigbeCacheGuardar_(clave, res);
  return res;
}

function sigbeEsHojaPropia_(nombre) {
  const n = sigbeNorm_(nombre);
  return ['2026 BRIGADISTAS HOLCIM', '2026 BRIGADISTAS INHOUSE', '2026 CRONOGRAMA', 'INDICADOR', 'BITACORA SIGBE'].some(x => n.indexOf(x) === 0) ||
    n.indexOf('TEMARIO') !== -1;
}

/** Historial: cambios hechos desde la app y cambios detectados en el Excel (los más recientes primero). */
function getCambios(token) {
  sigbeExigirLectura_(token);
  const reg = sigbeFuentes_().registro;
  const sh = reg && reg.getSheetByName(SIGBE_HOJA_BITACORA);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = Math.min(sh.getLastRow() - 1, 3000);
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, 10).getValues().reverse().map(f => ({
    fecha: sigbeTexto_(f[0], true), iso: f[0] instanceof Date ? Utilities.formatDate(f[0], Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
    usuario: String(f[1]), excel: /^EXCEL/i.test(String(f[1])), accion: String(f[2]), hoja: String(f[3]), fila: f[4],
    cedula: sigbeTexto_(f[5]), nombre: String(f[6]), detalle: String(f[7]), antes: sigbeTexto_(f[8]), despues: sigbeTexto_(f[9]),
  }));
}

// ═════════════════════════════ CAMBIOS HECHOS EN EL EXCEL ═════════════════════════════

/**
 * Compara los datos actuales con la foto de la pasada anterior y anota en el historial lo que cambió y no
 * se hizo desde la app. La llama la tarea de cada hora. Devuelve una línea de resumen.
 */
function sigbeVigilar_() {
  sigbeLimpiarCaches_();
  const m = sigbeConstruirModelo_();
  sigbeInvalidar_();
  sigbeCacheGuardar_('sigbe_m_' + sigbeGen_(), m);
  const foto = sigbeFoto_(m);
  const props = props_();
  let archivo = null, anterior = null;
  const id = props.getProperty('SIGBE_FOTO_ID');
  if (id) { try { archivo = DriveApp.getFileById(id); if (archivo.isTrashed()) archivo = null; } catch (e) { archivo = null; } }
  if (archivo) { try { anterior = JSON.parse(archivo.getBlob().getDataAsString()); } catch (e) { anterior = null; } }

  let texto;
  if (!anterior) texto = 'Primera foto de los datos guardada: desde la próxima pasada se anotan los cambios hechos en el Excel.';
  else if (anterior.origen !== foto.origen) texto = 'Cambiaron los archivos de origen (por ejemplo, por el corte): no se comparan esta vez.';
  else {
    const cambios = sigbeQuitarHechosPorApp_(sigbeDiferencias_(anterior, foto));
    if (cambios.length) {
      const filas = cambios.slice(0, SIGBE_MAX_CAMBIOS);
      if (cambios.length > SIGBE_MAX_CAMBIOS) filas.push(['Detectado en el Excel', '', '', '', '', 'Hubo ' + cambios.length + ' cambios; se anotaron los primeros ' + SIGBE_MAX_CAMBIOS + '.', '', '']);
      sigbeBitacora_('Excel (detectado)', filas);
    }
    texto = cambios.length + ' cambio(s) hechos directamente en el Excel anotados en el historial.';
  }
  const json = JSON.stringify(foto);
  if (archivo) archivo.setContent(json);
  else props.setProperty('SIGBE_FOTO_ID', carpetaRespaldos_().createFile('SIGBE foto de datos (no borrar).json', json, 'application/json').getId());
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  props.setProperty('SIGBE_VIGILA_ULTIMO', fecha + ' · ' + texto);
  return 'ℹ ' + texto;
}

function sigbeClavePersona_(c, n) {
  return String(c || '').replace(/\D/g, '') + '|' + sigbeNorm_(n);
}

function sigbeFoto_(m) {
  const h = {}, i = {}, cr = {};
  m.holcim.forEach(p => { h[sigbeClavePersona_(p.c, p.n)] = { n: p.n, c: p.c, p: p.p, e: p.e, fi: p.fi, ce: p.ce, m: p.m }; });
  m.inhouse.forEach(p => { i[sigbeClavePersona_(p.c, p.n)] = { n: p.n, c: p.c, p: p.p, k: p.k, ce: p.ce, e: p.e }; });
  m.crono.forEach(x => { cr[x.pl + '|' + x.ses + '|' + x.ent] = { f: x.f, e: x.e }; });
  return { v: 1, origen: m.fuentes.asistencia.id + '|' + m.fuentes.datos.id, ses: m.sesiones.map(s => s.key), h: h, i: i, cr: cr };
}

/** Diferencias entre dos fotos: filas para el historial [acción, hoja, fila, cédula, nombre, detalle, antes, después]. */
function sigbeDiferencias_(a, b) {
  const out = [];
  const A = 'Detectado en el Excel';
  const personas = (hoja, x, y, campos) => {
    Object.keys(y).forEach(k => {
      const n = y[k], v = x[k];
      if (!v) { out.push([A, hoja, '', n.c, n.n, 'Alta en la lista (' + n.p + ')', '', 'Alta']); return; }
      campos.forEach(([c, etiqueta]) => {
        if (String(v[c] || '') !== String(n[c] || '')) out.push([A, hoja, '', n.c, n.n, etiqueta, v[c] || '', n[c] || '']);
      });
    });
    Object.keys(x).forEach(k => { if (!y[k]) out.push([A, hoja, '', x[k].c, x[k].n, 'Baja de la lista (' + x[k].p + ')', 'En la lista', 'Ya no está']); });
  };
  personas(SIGBE_HOJA_HOLCIM, a.h || {}, b.h || {}, [['e', 'Estado'], ['fi', 'Fecha de ingreso'], ['ce', 'Certificado 0256'], ['p', 'Planta']]);
  personas(SIGBE_HOJA_INHOUSE, a.i || {}, b.i || {}, [['k', 'Contratista'], ['ce', 'Certificado 0256'], ['e', 'Estado'], ['p', 'Planta']]);
  Object.keys(b.h || {}).forEach(k => {
    const x = (a.h || {})[k], y = b.h[k];
    if (!x) return;
    b.ses.forEach((key, j) => {
      const ja = a.ses.indexOf(key);
      if (ja === -1) return;
      const va = x.m.charAt(ja), vb = y.m.charAt(j);
      if (va && vb && va !== vb) out.push([A, SIGBE_HOJA_HOLCIM, '', y.c, y.n, key.replace('|', ' Sesión '), va === '1' ? 'Asistió' : 'No', vb === '1' ? 'Asistió' : 'No']);
    });
  });
  Object.keys(b.cr || {}).forEach(k => {
    const x = (a.cr || {})[k], y = b.cr[k];
    const [pl, ses, ent] = k.split('|');
    if (!x) { out.push([A, SIGBE_HOJA_CRONOGRAMA, '', '', '', 'Sesión nueva · ' + ent + ' · ' + pl + ' ' + ses, '', y.f || '(sin fecha)']); return; }
    if (x.f !== y.f) out.push([A, SIGBE_HOJA_CRONOGRAMA, '', '', '', 'Fecha · ' + ent + ' · ' + pl + ' ' + ses, x.f || '(sin fecha)', y.f || '(sin fecha)']);
    if (x.e !== y.e) out.push([A, SIGBE_HOJA_CRONOGRAMA, '', '', '', 'Estado · ' + ent + ' · ' + pl + ' ' + ses, x.e || '(vacío)', y.e || '(vacío)']);
  });
  Object.keys(a.cr || {}).forEach(k => {
    if ((b.cr || {})[k]) return;
    const [pl, ses, ent] = k.split('|');
    out.push([A, SIGBE_HOJA_CRONOGRAMA, '', '', '', 'Sesión quitada (ahora "-" o sin fila) · ' + ent + ' · ' + pl + ' ' + ses, a.cr[k].f || '(sin fecha)', 'No aplica']);
  });
  return out;
}

/** Quita de la lista los cambios que ya están en el historial como hechos desde la app (últimas 48 horas). */
function sigbeQuitarHechosPorApp_(cambios) {
  if (!cambios.length) return cambios;
  const reg = sigbeFuentes_().registro;
  const sh = reg && reg.getSheetByName(SIGBE_HOJA_BITACORA);
  if (!sh || sh.getLastRow() < 2) return cambios;
  const n = Math.min(sh.getLastRow() - 1, 1500);
  const limite = Date.now() - 48 * 3600 * 1000;
  const app = {};
  sh.getRange(sh.getLastRow() - n + 1, 1, n, 10).getValues().forEach(f => {
    if (/^EXCEL/i.test(String(f[1])) || !(f[0] instanceof Date) || f[0].getTime() < limite) return;
    const k = String(f[5]).replace(/\D/g, '') + '|' + sigbeNorm_(f[7]) + '|' + sigbeNorm_(sigbeTexto_(f[9]));
    app[k] = (app[k] || 0) + 1;
  });
  return cambios.filter(c => {
    const k = String(c[3]).replace(/\D/g, '') + '|' + sigbeNorm_(c[5]) + '|' + sigbeNorm_(c[7]);
    if (app[k]) { app[k]--; return false; }
    return true;
  });
}

// ═════════════════════════════ ESTADO DEL SISTEMA ═════════════════════════════

function getEstadoSistema(token) {
  sigbeExigirLectura_(token);
  const props = props_();
  const archivo = (prop, nombre) => {
    const id = idDesdeTexto_(prop_(prop));
    if (!id || /^NINGUNO$/i.test(id)) return { nombre: nombre, configurado: false };
    try { const ss = SpreadsheetApp.openById(id); return { nombre: nombre, configurado: true, ok: true, titulo: ss.getName(), url: ss.getUrl() }; }
    catch (e) { return { nombre: nombre, configurado: true, ok: false, error: e.message }; }
  };
  return {
    version: SIGBE_VERSION,
    corte: props.getProperty('LIBRO_NUEVO_CORTE') || '',
    archivos: [archivo('SIGBE_ID_ORIGEN', '1.0 (original)'), archivo('SIGBE_ID_DESTINO', '2.0 (lista de asistencia)'), archivo('LIBRO_NUEVO_ID', 'Libro nuevo')],
    automatica: sigbeActivadorAutomatico_(),
    ultimaActualizacion: props.getProperty('LIBRO_NUEVO_ULTIMO') || '',
    ultimaRevision: props.getProperty('SIGBE_VIGILA_ULTIMO') || '',
    pendiente: Date.now() - (Number(props.getProperty('SIGBE_SYNC_PENDIENTE')) || 0) < 10 * 60 * 1000,
    respaldos: sigbeRespaldosResumen_(),
    ejecutaComo: cuentaScript_(),
  };
}

/** "Actualizar ahora": trae el 1.0 y el 2.0 al libro nuevo (hasta el corte) y revisa cambios del Excel. */
function actualizarAhora(token) {
  try {
    const usuario = sigbeExigirSesion_(token);
    const lineas = [];
    let error = false;
    if (lnIdLibro_()) {
      const r = lnActualizar_(false);
      lineas.push(r.resumen);
      error = r.error;
    } else lineas.push('Todavía no hay libro nuevo (se crea desde el editor con libroNuevoCrear).');
    try { lineas.push(sigbeVigilar_()); } catch (e) { error = true; lineas.push('✖ Revisión de cambios en el Excel: ' + e.message); }
    sigbeBitacora_(usuario, [['Actualización manual', '', '', '', '', 'Actualizar ahora desde la app', '', error ? 'Con avisos' : 'Correcta']]);
    return { exito: !error, mensaje: error ? 'Terminó con avisos o errores.' : 'Actualización completa.', detalle: lineas.join('\n') };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  }
}

/** Revisa todo lo que puede fallar y dice qué hacer en cada caso. */
function diagnosticoSistema(token) {
  sigbeExigirLectura_(token);
  const R = [];
  const add = (estado, titulo, detalle, solucion) => R.push({ estado: estado, titulo: titulo, detalle: detalle || '', solucion: solucion || '' });
  const props = props_();
  const corte = props.getProperty('LIBRO_NUEVO_CORTE');

  [['SIGBE_ID_ORIGEN', '1.0 (original)', !corte], ['SIGBE_ID_DESTINO', '2.0 (lista de asistencia)', !corte], ['LIBRO_NUEVO_ID', 'Libro nuevo', true]].forEach(([p, nombre, necesario]) => {
    const id = idDesdeTexto_(prop_(p));
    if (!id || /^NINGUNO$/i.test(id)) { add(necesario ? 'aviso' : 'info', 'Archivo ' + nombre, 'No está configurado (' + p + ').', 'Configúralo en Configuración → Archivos.'); return; }
    try { const f = revisarArchivo_(id, nombre); add('ok', 'Archivo ' + nombre, 'Accesible: "' + f.getName() + '".'); }
    catch (e) { add(necesario ? 'error' : 'aviso', 'Archivo ' + nombre, e.message, 'Comparte el archivo como editor con ' + cuentaScript_() + ' o corrige la URL en Configuración.'); }
  });
  add('info', 'Corte', corte ? 'Hecho el ' + corte + ': la app lee y guarda en el libro nuevo.' : 'Todavía no: la asistencia se lee y guarda en el 2.0 y lo demás en el 1.0; el libro nuevo es un espejo.');

  let F = null;
  try { F = sigbeFuentes_(); F.avisos.forEach(a => add('aviso', 'Fuente de datos', a, 'Revisa el acceso al archivo en Configuración.')); }
  catch (e) { add('error', 'Fuente de datos', e.message); }

  if (F) {
    try {
      const h = sigbeLeerHolcim_(sigbeHoja_(F.asistencia, SIGBE_HOJA_HOLCIM));
      const faltan = ['planta', 'estado', 'nombre', 'cedula'].filter(k => !h.cols[k]);
      const m8 = h.sesiones.filter(s => s.modulo === 'M8').length;
      if (faltan.length) add('error', 'Lista de asistencia', 'Faltan columnas: ' + faltan.join(', ') + '.', 'Alguien cambió el texto del encabezado; vuelve a escribirlo igual.');
      else if (!h.sesiones.length) add('error', 'Lista de asistencia', 'No se encontraron columnas "M1_Sesión_1" + "Asistencia…".', 'Revisa la fila de encabezados de la lista de asistencia.');
      else add('ok', 'Lista de asistencia', h.personas.length + ' personas · ' + h.sesiones.length + ' sesiones con casilla (M8 en ' + m8 + ' columnas)' + (h.cols.certificado ? '' : ' · sin columna de certificado') + '.');
      try {
        const crono = sigbeLeerCronograma_(sigbeHoja_(F.datos, SIGBE_HOJA_CRONOGRAMA));
        const plantas = sigbeUnicos_(h.personas.map(p => p.planta));
        const sinRegla = plantas.filter(p => !lnPlanta_(p));
        const sinBloque = plantas.filter(p => { const c = lnPlanta_(p); return c && !crono.bloques.some(b => b.planta.indexOf(c.bloque) !== -1); });
        if (sinRegla.length || sinBloque.length) add('aviso', 'Plantas y cronograma', (sinRegla.length ? 'Sin regla en LN_PLANTAS: ' + sinRegla.join(', ') + '. ' : '') + (sinBloque.length ? 'Sin bloque en el cronograma: ' + sinBloque.join(', ') + '.' : ''),
          'Para esas plantas se ofrecen todas las sesiones. Agrega la planta a LN_PLANTAS (LibroNuevo.gs) o su bloque al cronograma.');
        else add('ok', 'Plantas y cronograma', crono.bloques.length + ' bloques de sesión; todas las plantas de la lista tienen su bloque.');
        const sinFila = sigbeUnicos_(h.sesiones.map(s => s.clave)).filter(cl => { const s = h.sesiones.find(x => x.clave === cl); return lnFilaModulo_(crono, s, 'TODOS') === undefined; });
        if (sinFila.length) add('info', 'Módulos sin regla', sinFila.join(', ') + ': no tienen palabra clave en LN_MODULOS; se ofrecen en todas las plantas.');
      } catch (e) { add('aviso', 'Cronograma', e.message, 'Revisa que la pestaña del cronograma tenga sus 3 filas de encabezado.'); }
    } catch (e) { add('error', 'Lista de asistencia', e.message, 'Revisa que la pestaña exista con su fila de encabezados.'); }
    try { const i = sigbeLeerInhouse_(sigbeHoja_(F.datos, SIGBE_HOJA_INHOUSE)); add('ok', 'Contratistas (INHOUSE)', i.length + ' personas.'); }
    catch (e) { add('aviso', 'Contratistas (INHOUSE)', e.message); }
    try { const i = sigbeLeerIndicador_(sigbeHoja_(F.datos, SIGBE_HOJA_INDICADOR)); add(i.length ? 'ok' : 'aviso', 'Indicador', i.length + ' filas.'); }
    catch (e) { add('aviso', 'Indicador', e.message, 'La pantalla Cobertura necesita la pestaña "Indicador." con PLANTA, EMPRESA, TOTAL PERSONAS y TOTAL BRIGADISTAS.'); }
    const tzs = [F.asistencia, F.datos].map(ss => ss.getSpreadsheetTimeZone());
    if (tzs.some(t => t !== Session.getScriptTimeZone())) add('aviso', 'Zona horaria', 'Proyecto: ' + Session.getScriptTimeZone() + ' · archivos: ' + sigbeUnicos_(tzs).join(', ') + '.', 'Deja America/Bogota en Archivo → Configuración de cada hoja.');
    else add('ok', 'Zona horaria', Session.getScriptTimeZone() + ' en el proyecto y en los archivos.');
  }

  const auto = sigbeActivadorAutomatico_();
  if (auto.desconocido) add('info', 'Tarea automática', 'No se pudo consultar.');
  else if (!auto.activa) add('aviso', 'Tarea automática', 'Apagada: ni el libro nuevo se actualiza ni se anotan los cambios hechos en el Excel.', 'Actívala en Configuración.');
  else add('ok', 'Tarea automática', 'Activa cada ' + auto.cadaHoras + ' hora(s).');
  const ult = props.getProperty('SIGBE_VIGILA_ULTIMO') || '';
  const horas = sigbeHorasDesde_(ult);
  if (!ult) add('aviso', 'Revisión de cambios del Excel', 'Todavía no ha corrido.', 'Usa "Actualizar ahora" en esta pantalla o espera la tarea automática.');
  else if (auto.activa && horas !== null && horas > auto.cadaHoras * 2 + 0.5) add('aviso', 'Revisión de cambios del Excel', 'Última: ' + ult + ' (hace ' + Math.round(horas) + ' h).', 'La tarea pudo fallar (Google avisa por correo). Prueba "Actualizar ahora".');
  else add('ok', 'Revisión de cambios del Excel', ult);
  if (ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'sincronizar')) add('aviso', 'Activador viejo', 'Existe un activador de la versión 3 ("sincronizar"). Ya no copia nada del 1.0 al 2.0: hace la tarea nueva.', 'Desactiva y vuelve a activar la tarea en Configuración para dejar uno solo.');

  if (props.getProperty('SIGBE_USUARIO') && (props.getProperty('SIGBE_CLAVE_HASH') || props.getProperty('SIGBE_CLAVE_INICIAL'))) add(props.getProperty('SIGBE_CLAVE_INICIAL') ? 'aviso' : 'ok', 'Usuario y clave', 'Configurados (usuario: ' + props.getProperty('SIGBE_USUARIO') + ')' + (props.getProperty('SIGBE_CLAVE_INICIAL') ? '. La clave inicial sigue en texto en las propiedades: se cifra y se borra al primer inicio de sesión.' : '.'), props.getProperty('SIGBE_CLAVE_INICIAL') ? 'Inicia sesión una vez y después cambia la clave en Configuración.' : '');
  else add('error', 'Usuario y clave', 'No están configurados: nadie puede guardar.', 'Pon SIGBE_USUARIO y SIGBE_CLAVE_INICIAL en las Propiedades del script.');
  add(sigbeLecturaPublica_() ? 'aviso' : 'ok', 'Lectura sin iniciar sesión', sigbeLecturaPublica_() ? 'Permitida: cualquiera con el enlace ve nombres y cédulas.' : 'Exigida: hay que iniciar sesión para ver.', sigbeLecturaPublica_() ? 'En una cuenta pública conviene exigir sesión (Configuración → Acceso).' : '');
  add('info', 'La app se ejecuta como', cuentaScript_() + '. Esa cuenta necesita editar los archivos.');
  add('info', 'Versión', 'SIGBE ' + SIGBE_VERSION + '. Si las pantallas muestran otra versión, falta "Implementar → Nueva versión".');
  return { fecha: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'), revisiones: R,
    resumen: { ok: R.filter(r => r.estado === 'ok').length, aviso: R.filter(r => r.estado === 'aviso').length, error: R.filter(r => r.estado === 'error').length } };
}

function sigbeActivadorAutomatico_() {
  try { return { activa: automaticoActivo_(), cadaHoras: cadaHoras_() }; }
  catch (e) { return { activa: false, desconocido: true, cadaHoras: cadaHoras_() }; }
}

function sigbeRespaldosResumen_() {
  try {
    const lista = listarRespaldos_();
    const it = DriveApp.getFoldersByName(CARPETA_RESPALDOS);
    return { carpeta: CARPETA_RESPALDOS, url: it.hasNext() ? it.next().getUrl() : '', ultimos: lista.slice(0, 6) };
  } catch (e) {
    return { carpeta: CARPETA_RESPALDOS, url: '', ultimos: [], error: e.message };
  }
}

/** Horas transcurridas desde una fecha "yyyy-MM-dd HH:mm" (hora del script); null si no se puede leer. */
function sigbeHorasDesde_(txt) {
  const m = String(txt).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return null;
  const ahora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  return (Date.UTC(+ahora[1], +ahora[2] - 1, +ahora[3], +ahora[4], +ahora[5]) - Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) / 3600000;
}

// ═════════════════════════════ SESIÓN ═════════════════════════════

function validarLoginAdmin(usuario, clave) {
  const cache = CacheService.getScriptCache();
  const intentos = Number(cache.get('sigbe_intentos')) || 0;
  if (intentos >= 5) return { exito: false, mensaje: 'Demasiados intentos. Espera 10 minutos.' };
  const props = PropertiesService.getScriptProperties();
  sigbeConsumirClaveInicial_(props);
  const u = props.getProperty('SIGBE_USUARIO');
  const hash = props.getProperty('SIGBE_CLAVE_HASH');
  if (!u || !hash) return { exito: false, mensaje: 'Falta configurar el usuario y la clave (Propiedades del script SIGBE_USUARIO y SIGBE_CLAVE_INICIAL).' };
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

/** Si hay una clave inicial en texto (SIGBE_CLAVE_INICIAL), la guarda cifrada y la borra. */
function sigbeConsumirClaveInicial_(props) {
  const inicial = props.getProperty('SIGBE_CLAVE_INICIAL');
  if (!inicial) return;
  sigbeGuardarClave_(props.getProperty('SIGBE_USUARIO') || 'admin', inicial);
  props.deleteProperty('SIGBE_CLAVE_INICIAL');
}

function sigbeGuardarClave_(usuario, clave) {
  if (String(clave || '').length < 8) throw new Error('La clave debe tener al menos 8 caracteres.');
  const sal = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({
    SIGBE_USUARIO: String(usuario || 'admin').trim(),
    SIGBE_SAL: sal,
    SIGBE_CLAVE_HASH: sigbeHash_(clave, sal),
  });
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
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(sal || '') + String(texto || '')));
}

/** ¿Cualquiera con el enlace puede ver (no guardar)? Por defecto no. */
function sigbeLecturaPublica_() {
  return /^(si|sí|true|1)$/i.test(String(PropertiesService.getScriptProperties().getProperty('SIGBE_LECTURA_PUBLICA') || 'no').trim());
}

/** Lanza error si la lectura exige sesión y no la hay. El frontend reconoce el prefijo SESION_REQUERIDA. */
function sigbeExigirLectura_(token) {
  if (sigbeLecturaPublica_()) return;
  if (!sigbeUsuarioSesion_(token)) throw new Error('SESION_REQUERIDA: Inicia sesión para ver la información.');
}

/** Qué falta para que la app pueda funcionar. */
function sigbeEstadoSetup_() {
  const props = PropertiesService.getScriptProperties();
  const credenciales = !!(props.getProperty('SIGBE_USUARIO') && (props.getProperty('SIGBE_CLAVE_HASH') || props.getProperty('SIGBE_CLAVE_INICIAL')));
  let datosOk = false, datosError = '';
  const configurado = !!(idDestino_() || lnIdLibro_());
  if (configurado) { try { sigbeFuentes_(); datosOk = true; } catch (e) { datosError = e.message; } }
  return {
    listo: credenciales && datosOk,
    credenciales: credenciales,
    destinoConfigurado: configurado,
    destinoAccesible: datosOk,
    destinoError: datosError,
    origen: configOrigen_().modo,
    esPropietario: sigbeEsPropietario_(),
    ejecutaComo: cuentaScript_(),
  };
}

/** True cuando quien abre la app es la misma cuenta que la ejecuta (el dueño del proyecto). */
function sigbeEsPropietario_() {
  try {
    const activo = Session.getActiveUser().getEmail();
    const efectivo = Session.getEffectiveUser().getEmail();
    return !!activo && activo === efectivo;
  } catch (e) { return false; }
}

// ═════════════════════════════ CONFIGURACIÓN ═════════════════════════════

/** Configuración inicial desde la app: solo sin credenciales y solo la cuenta dueña. */
function configuracionInicial(datos) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SIGBE_USUARIO') && (props.getProperty('SIGBE_CLAVE_HASH') || props.getProperty('SIGBE_CLAVE_INICIAL'))) {
    return { exito: false, mensaje: 'La app ya tiene usuario y clave. Inicia sesión y usa Configuración.' };
  }
  if (!sigbeEsPropietario_()) {
    return { exito: false, mensaje: 'La configuración inicial solo puede hacerla la cuenta dueña del proyecto (' + cuentaScript_() + '), o poniendo SIGBE_USUARIO y SIGBE_CLAVE_INICIAL en las Propiedades del script.' };
  }
  try {
    const usuario = String(datos.usuario || '').trim();
    if (!usuario) return { exito: false, mensaje: 'El usuario es obligatorio.' };
    if (datos.idDestino !== undefined) props.setProperty('SIGBE_ID_DESTINO', idDesdeTexto_(datos.idDestino));
    if (datos.idOrigen !== undefined) props.setProperty('SIGBE_ID_ORIGEN', /^NINGUNO$/i.test(String(datos.idOrigen).trim()) || !String(datos.idOrigen).trim() ? 'NINGUNO' : idDesdeTexto_(datos.idOrigen));
    sigbeGuardarClave_(usuario, datos.clave);
    sigbeLimpiarCaches_();
    return { exito: true, mensaje: 'Configuración guardada. Ya puedes iniciar sesión.' };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  }
}

function getConfiguracion(token) {
  sigbeExigirSesion_(token);
  const props = PropertiesService.getScriptProperties();
  const info = id => { if (!id || /^NINGUNO$/i.test(id)) return { id: id || '', nombre: '', url: '' }; try { const ss = SpreadsheetApp.openById(id); return { id: id, nombre: ss.getName(), url: ss.getUrl() }; } catch (e) { return { id: id, nombre: '', url: '', error: 'No se puede abrir con la cuenta ' + cuentaScript_() }; } };
  const cfg = configOrigen_();
  let respaldos = [];
  try { respaldos = listarRespaldos_().slice(0, 40); } catch (e) { respaldos = []; }
  return {
    usuario: props.getProperty('SIGBE_USUARIO') || '',
    origen: Object.assign(info(cfg.modo === 'configurado' ? cfg.id : ''), { modo: cfg.modo }),
    destino: info(idDestino_()),
    libro: info(lnIdLibro_()),
    corte: props.getProperty('LIBRO_NUEVO_CORTE') || '',
    lecturaPublica: sigbeLecturaPublica_(),
    automatica: sigbeActivadorAutomatico_(),
    carpetaRespaldos: CARPETA_RESPALDOS,
    respaldos: respaldos,
    ejecutaComo: cuentaScript_(),
  };
}

/** Guarda archivos y lectura pública. Comprueba que los archivos abran antes de guardarlos. */
function guardarConfiguracion(token, cfg) {
  const usuario = sigbeExigirSesion_(token);
  const props = PropertiesService.getScriptProperties();
  const cambios = [];
  let reiniciarEspejo = false;
  try {
    const archivo = (campo, prop, etiqueta, permiteNinguno) => {
      if (cfg[campo] === undefined) return null;
      const t = String(cfg[campo] || '').trim();
      let valor;
      if (!t || /^NINGUNO$/i.test(t)) {
        if (!permiteNinguno) return 'El ' + etiqueta + ' es obligatorio.';
        valor = 'NINGUNO';
      } else {
        valor = idDesdeTexto_(t);
        try { SpreadsheetApp.openById(valor).getName(); } catch (e) { return 'No se pudo abrir el ' + etiqueta + ' con esa URL: ' + e.message; }
      }
      if (valor !== String(props.getProperty(prop) || '')) { props.setProperty(prop, valor); cambios.push(etiqueta + ' → ' + valor); reiniciarEspejo = true; }
      return null;
    };
    const err = archivo('idOrigen', 'SIGBE_ID_ORIGEN', 'archivo 1.0', true) || archivo('idDestino', 'SIGBE_ID_DESTINO', 'archivo 2.0', !!lnIdLibro_()) ||
      (cfg.idLibro !== undefined && String(cfg.idLibro).trim() ? archivo('idLibro', 'LIBRO_NUEVO_ID', 'libro nuevo', false) : null);
    if (err) return { exito: false, mensaje: err };
    if (reiniciarEspejo) {
      Object.keys(props.getProperties()).filter(k => /^LIBRO_NUEVO_(HUELLA|CELDAS)_/.test(k)).forEach(k => props.deleteProperty(k));
    }
    if (cfg.lecturaPublica !== undefined) {
      const v = cfg.lecturaPublica ? 'si' : 'no';
      if (v !== (sigbeLecturaPublica_() ? 'si' : 'no')) { props.setProperty('SIGBE_LECTURA_PUBLICA', v); cambios.push('Lectura sin sesión → ' + (cfg.lecturaPublica ? 'permitida' : 'exigida')); }
    }
    sigbeLimpiarCaches_();
    sigbeInvalidar_();
    if (cambios.length) sigbeBitacora_(usuario, cambios.map(c => ['Configuración', 'Propiedades del script', '', '', '', c, '', '']));
    return { exito: true, mensaje: cambios.length ? 'Guardado: ' + cambios.join(' · ') : 'No había cambios.' };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  }
}

/** Activa o desactiva la tarea automática (actualizar el libro nuevo + anotar cambios del Excel). */
function configurarAutomatico(token, activar, cadaHoras) {
  const usuario = sigbeExigirSesion_(token);
  try {
    if (activar) {
      if (!lnIdLibro_()) return { exito: false, mensaje: 'Primero crea el libro nuevo (libroNuevoCrear desde el editor) o pon su URL en Archivos.' };
      const n = activarAutomatico_(cadaHoras);
      sigbeBitacora_(usuario, [['Configuración', 'Activadores', '', '', '', 'Tarea automática cada ' + n + ' h', '', 'Activa']]);
      return { exito: true, mensaje: 'Tarea automática activa cada ' + n + ' hora(s).' };
    }
    desactivarAutomatico_();
    sigbeBitacora_(usuario, [['Configuración', 'Activadores', '', '', '', 'Tarea automática', 'Activa', 'Desactivada']]);
    return { exito: true, mensaje: 'Tarea automática desactivada.' };
  } catch (e) {
    return { exito: false, mensaje: e.message + ' (si dice que no hay permiso: vuelve a autorizar el proyecto desde el editor).' };
  }
}

function cambiarClave(token, claveActual, usuarioNuevo, claveNueva) {
  sigbeExigirSesion_(token);
  const props = PropertiesService.getScriptProperties();
  sigbeConsumirClaveInicial_(props);
  if (sigbeHash_(claveActual, props.getProperty('SIGBE_SAL')) !== props.getProperty('SIGBE_CLAVE_HASH')) return { exito: false, mensaje: 'La clave actual no es correcta.' };
  try {
    sigbeGuardarClave_(usuarioNuevo || props.getProperty('SIGBE_USUARIO'), claveNueva);
    CacheService.getScriptCache().remove('sigbe_sesion_' + token);
    return { exito: true, mensaje: 'Usuario y clave actualizados. Vuelve a iniciar sesión.' };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  }
}

// ═════════════════════════════ FUENTES, CACHÉ E HISTORIAL ═════════════════════════════

let sigbeFuentesCache_ = null;

/** Olvida los archivos abiertos en esta ejecución (tras cambiar la configuración). */
function sigbeLimpiarCaches_() { sigbeFuentesCache_ = null; }

function sigbeAbrir_(id) {
  if (!id || /^NINGUNO$/i.test(id)) return null;
  try { return SpreadsheetApp.openById(id); } catch (e) { return null; }
}

/**
 * Archivos que usa la app en esta ejecución:
 *   asistencia → lista "2026 Brigadistas HOLCIM" (2.0 hasta el corte, libro nuevo después)
 *   datos      → INHOUSE, cronograma, Indicador., temario y demás (1.0 hasta el corte, libro nuevo después)
 *   registro   → donde está la "Bitácora SIGBE" (libro nuevo, o 2.0 si aún no existe)
 * Si antes del corte el 2.0 o el 1.0 no abren, se lee la copia del libro nuevo en SOLO LECTURA
 * (guardar ahí se perdería con la siguiente actualización).
 */
function sigbeFuentes_() {
  if (sigbeFuentesCache_) return sigbeFuentesCache_;
  const corte = !!prop_('LIBRO_NUEVO_CORTE');
  // El libro nuevo solo se abre si hace falta (abrir un archivo tarda): después del corte, como respaldo
  // de lectura, o para el historial.
  let libroAbierto = false, libroCache = null;
  const libro = () => { if (!libroAbierto) { libroAbierto = true; libroCache = sigbeAbrir_(lnIdLibro_()); } return libroCache; };
  const cfg = configOrigen_();
  const v1 = corte ? null : sigbeAbrir_(cfg.modo === 'configurado' ? cfg.id : '');
  const v2 = corte ? null : sigbeAbrir_(idDestino_());
  const avisos = [];
  const soloLectura = {};
  let asistencia = corte ? libro() : v2, datos = corte ? libro() : v1;
  if (!asistencia && !corte && libro()) { asistencia = libro(); soloLectura.asistencia = true; avisos.push('El 2.0 no se puede abrir: se muestra la copia del libro nuevo y no se puede guardar asistencia.'); }
  if (!datos && !corte && libro()) { datos = libro(); soloLectura.datos = true; if (cfg.modo === 'configurado') avisos.push('El 1.0 no se puede abrir: se muestra la copia del libro nuevo y no se pueden guardar contratistas.'); }
  if (!datos && !corte && v2) { datos = v2; avisos.push('No hay 1.0 ni libro nuevo: el cronograma y lo demás se leen del 2.0 (puede estar desactualizado).'); }
  if (!asistencia) throw new Error(corte ? 'No se puede abrir el libro nuevo (LIBRO_NUEVO_ID).' : 'No se puede abrir el 2.0 (lista de asistencia). Revisa su URL en Configuración y que la cuenta ' + cuentaScript_() + ' tenga acceso.');
  if (!datos) throw new Error('No se puede abrir el 1.0 (archivo original). Revisa su URL en Configuración.');
  sigbeFuentesCache_ = { corte: corte, v1: v1, v2: v2, asistencia: asistencia, datos: datos, avisos: avisos, soloLectura: soloLectura };
  Object.defineProperty(sigbeFuentesCache_, 'libro', { get: libro });
  Object.defineProperty(sigbeFuentesCache_, 'registro', { get: () => libro() || v2 || v1 || asistencia });
  return sigbeFuentesCache_;
}

function sigbeExigirEscritura_(F, que) {
  if (F.soloLectura[que]) {
    throw new Error(que === 'asistencia'
      ? 'Ahora mismo el 2.0 no se puede abrir: la app muestra una copia y no puede guardar asistencia. Revisa el acceso al 2.0 en Estado del sistema.'
      : 'Ahora mismo el 1.0 no se puede abrir: la app muestra una copia y no puede guardar contratistas. Revisa el acceso al 1.0 en Estado del sistema.');
  }
}

/** Generación de los datos: cambia con cada guardado y con la tarea automática (invalida la caché). */
function sigbeGen_() { return prop_('SIGBE_GEN') || '0'; }
function sigbeInvalidar_() { try { props_().setProperty('SIGBE_GEN', String(Date.now())); } catch (e) { /* sin propiedades */ } }

/** CacheService guarda hasta 100 KB por valor: el JSON se parte en trozos. */
function sigbeCacheGuardar_(clave, obj) {
  try {
    const txt = JSON.stringify(obj);
    const trozo = 40000, n = Math.ceil(txt.length / trozo) || 1, o = {};
    for (let i = 0; i < n; i++) o[clave + '_' + i] = txt.substr(i * trozo, trozo);
    o[clave + '_n'] = String(n);
    CacheService.getScriptCache().putAll(o, SIGBE_MINUTOS_CACHE * 60);
  } catch (e) { /* demasiado grande o sin caché: se leerá de las hojas */ }
}

function sigbeCacheLeer_(clave) {
  try {
    const c = CacheService.getScriptCache();
    const n = Number(c.get(clave + '_n'));
    if (!n) return null;
    const claves = [];
    for (let i = 0; i < n; i++) claves.push(clave + '_' + i);
    const todo = c.getAll(claves);
    let txt = '';
    for (let i = 0; i < n; i++) { if (todo[claves[i]] === undefined || todo[claves[i]] === null) return null; txt += todo[claves[i]]; }
    return JSON.parse(txt);
  } catch (e) { return null; }
}

/** Agrega filas a la "Bitácora SIGBE" (la crea si no existe). */
function sigbeBitacora_(usuario, filas) {
  try {
    const ss = sigbeFuentes_().registro;
    let sh = ss.getSheetByName(SIGBE_HOJA_BITACORA);
    if (!sh) {
      sh = ss.insertSheet(SIGBE_HOJA_BITACORA);
      sh.getRange(1, 1, 1, 10).setValues([['Fecha', 'Usuario', 'Acción', 'Hoja', 'Fila', 'Cédula', 'Nombre', 'Detalle', 'Antes', 'Después']])
        .setFontWeight('bold').setBackground('#1a252f').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      try { sh.protect().setDescription('Historial de la app SIGBE (solo la app escribe aquí)').setWarningOnly(true); } catch (e) { /* sin permiso */ }
    }
    const ahora = new Date();
    sh.getRange(sh.getLastRow() + 1, 1, filas.length, 10).setValues(filas.map(f => [ahora, usuario].concat(f)));
  } catch (e) {
    console.log('No se pudo escribir el historial: ' + e.message);
  }
}

// ═════════════════════════════ LECTURA DE HOJAS ═════════════════════════════

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
  if (r0 === -1) throw new Error('No se encontraron los encabezados (' + requeridos.join(', ') + ') en "' + sh.getName() + '".');
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

/**
 * Lista de asistencia. Sesiones = columnas "M1_Sesión_1", "M8-2-Sesión_1"… seguidas de una "Asistencia…".
 * key = "M8-2|1" (módulo + parte + número de sesión): cada parte de M8 es una sesión distinta.
 */
function sigbeLeerHolcim_(sh) {
  const t = sigbeTabla_(sh, ['PLANTA', 'CEDULA']);
  const cols = {
    planta: t.col('PLANTA'), estado: t.col('ESTADO'), nombre: t.col('NOMBRE Y APELLIDO'), cedula: t.col('CEDULA'),
    certificado: t.col('CERTIFICADO'), fechaIngreso: t.col('FECHA DE INGRESO'), empresa: t.col('EMPRESA'),
  };
  const titulos = {};
  const sesiones = [];
  t.encabezados.forEach((e, i) => {
    const tm = String(t.titulosArriba[i] || '').match(/^\s*M(\d+)\s*:\s*([\s\S]*)$/);
    if (tm) titulos[tm[1]] = tm[2].replace(/\s+/g, ' ').trim();
    const m = e.match(/^M(\d+)(?:-(\d+))?[-_ ]*SESION[-_ ]*(\d+)$/);
    if (!m || String(t.encabezados[i + 1] || '').indexOf('ASISTENCIA') !== 0) return;
    const clave = 'M' + m[1] + (m[2] ? '-' + m[2] : '');
    sesiones.push({ key: clave + '|' + m[3], clave: clave, modulo: 'M' + m[1], parte: m[2] ? Number(m[2]) : 0, n: Number(m[3]), colFecha: i + 1, colAsis: i + 2 });
  });
  sesiones.forEach(s => { s.titulo = titulos[s.modulo.slice(1)] || ''; });

  const personas = [];
  t.filas.forEach(f => {
    const v = f.valores;
    const planta = String(v[cols.planta - 1] || '').trim();
    const nombre = String(cols.nombre ? v[cols.nombre - 1] || '' : '').trim();
    if (!nombre || !planta || sigbeNorm_(planta).indexOf('TOTAL') === 0) return;
    personas.push({
      fila: f.fila, valores: v, planta: planta, nombre: nombre,
      estado: cols.estado ? String(v[cols.estado - 1] || '').trim() : '',
      cedula: sigbeTexto_(v[cols.cedula - 1]),
      certificado: cols.certificado ? sigbeTexto_(v[cols.certificado - 1]) : '',
      fechaIngreso: cols.fechaIngreso ? sigbeTexto_(v[cols.fechaIngreso - 1]) : '',
      empresa: cols.empresa ? sigbeTexto_(v[cols.empresa - 1]) : '',
    });
  });
  return { hoja: sh, filaEncabezado: t.filaEncabezado, cols: cols, sesiones: sesiones, personas: personas };
}

/** Contratistas. completo = true devuelve también fila, valores y columnas (para escribir). */
function sigbeLeerInhouse_(sh, completo) {
  const t = sigbeTabla_(sh, ['PLANTA', 'CEDULA']);
  const c = { planta: t.col('PLANTA'), contratista: t.col('CONTRATISTA') || t.col('EMPRESA'),
    nombre: t.col('NOMBRE Y APELLIDO'), cedula: t.col('CEDULA'), cert: t.col('CERTIFICADO'), estado: t.col('ESTADO') };
  return t.filas
    .filter(f => c.nombre && String(f.valores[c.nombre - 1] || '').trim() && sigbeNorm_(f.valores[c.planta - 1]).indexOf('TOTAL') !== 0)
    .map(f => {
      const v = f.valores;
      const p = {
        r: f.fila, p: String(v[c.planta - 1] || '').trim(), k: c.contratista ? String(v[c.contratista - 1] || '').trim() : '',
        n: String(v[c.nombre - 1]).trim(), c: sigbeTexto_(v[c.cedula - 1]), ce: c.cert ? sigbeTexto_(v[c.cert - 1]) : '',
        e: c.estado ? String(v[c.estado - 1] || '').trim() : '',
      };
      if (completo) Object.assign(p, { fila: f.fila, valores: v, cols: c, nombre: p.n, cedula: p.c, planta: p.p });
      return p;
    });
}

/** Pestaña "Indicador." (o "Indicador"): acepta los encabezados nuevos y los anteriores. */
function sigbeLeerIndicador_(sh) {
  const t = sigbeTabla_(sh, ['PLANTA', 'EMPRESA']);
  const col = (...ks) => { for (let i = 0; i < ks.length; i++) { const x = t.col(ks[i]); if (x) return x; } return 0; };
  const c = { planta: col('PLANTA'), empresa: col('EMPRESA'), personas: col('TOTAL PERSONAS', 'TOTAL TRABAJADORES'),
    brig: col('TOTAL BRIGADISTAS', 'BRIGADISTAS ACTUALES'), meta: col('META', 'BRIGADISTAS REQUERIDOS'), brecha: col('BRECHA', 'GAP') };
  if (!c.personas || !c.brig) throw new Error('No se encontraron las columnas TOTAL PERSONAS y TOTAL BRIGADISTAS en "' + sh.getName() + '".');
  let planta = '';
  const filas = [];
  t.filas.forEach(f => {
    const v = f.valores;
    planta = String(v[c.planta - 1] || '').trim() || planta;
    const empresa = String(v[c.empresa - 1] || '').trim();
    if (!empresa || !planta) return;
    const per = sigbeNum_(v[c.personas - 1]), bri = sigbeNum_(v[c.brig - 1]);
    const meta = c.meta ? sigbeNum_(v[c.meta - 1]) : per * 0.2;
    filas.push({ p: planta, sede: sigbeSede_(planta), emp: empresa, tot: sigbeNorm_(empresa) === 'TOTAL' ? 1 : 0,
      per: per, bri: bri, meta: Math.round(meta * 10) / 10, bre: Math.round((c.brecha ? sigbeNum_(v[c.brecha - 1]) : meta - bri) * 10) / 10 });
  });
  return filas;
}

/**
 * "2026 Seguimiento": una fila por sesión dictada con la cantidad de asistentes. Sirve para comparar
 * con las marcas de la lista de asistencia. cl = módulo según el tema ('M8' para las de la 0256).
 */
function sigbeLeerSeguimiento_(sh) {
  const t = sigbeTabla_(sh, ['MODULO', 'CAPACITACION']);
  const c = { cap: t.col('CAPACITACION'), pl: t.col('PLANTAS') || t.col('PLANTA'), f: t.col('FECHA EJECUCION') || t.col('FECHA'),
    ah: t.col('ASISTENCIA HOLCIM'), ac: t.col('ASISTENCIA CONTRATISTAS'), tot: t.col('TOTAL BRIGADISTAS'), ej: t.col('EJECUCION'), inf: t.col('REVISION INFORME') || t.col('ENVIO INFORME') };
  const claves = { M1: ['PRIMER AUXILIO'], M2: ['PLANES DE PREVENCION', 'PLAN DE EMERGENCIA'], M3: ['SUSTANCIAS PELIGROSAS', 'MATPEL'], M4: ['ELECTRICO'],
    M5: ['ALTURAS', 'CONFINADOS'], M6: ['VEHICULAR'], M7: ['SISMO'], M8: ['0256', 'CONTRAINCENDIOS'], M9: ['ACUATICO'], M10: ['MINERIA'], M11: ['HARINA'] };
  return t.filas.map(f => {
    const v = f.valores, cap = String(v[c.cap - 1] || '').trim();
    if (!cap) return null;
    const n = sigbeNorm_(cap);
    const fecha = c.f ? v[c.f - 1] : '';
    return {
      cap: cap, pl: c.pl ? String(v[c.pl - 1] || '').trim() : '', f: sigbeTexto_(fecha),
      i: fecha instanceof Date ? Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      ah: c.ah ? sigbeNum_(v[c.ah - 1]) : 0, ac: c.ac ? sigbeNum_(v[c.ac - 1]) : 0, tot: c.tot ? sigbeNum_(v[c.tot - 1]) : 0,
      ej: c.ej ? String(v[c.ej - 1] || '').trim() : '', inf: c.inf ? String(v[c.inf - 1] || '').trim() : '',
      cl: Object.keys(claves).find(k => claves[k].some(x => n.indexOf(x) !== -1)) || '',
    };
  }).filter(Boolean);
}

/**
 * Cronograma: fila 1 = planta, fila 2 = sesión, fila 3 = campos (Fecha HOLCIM, Fecha AMBIPAR, # Brigadistas,
 * Estado, Observaciones). Devuelve { bloques, filas } con la forma que usan lnPlanta_/lnFilaModulo_.
 */
function sigbeLeerCronograma_(sh) {
  const nf = Math.min(Math.max(sh.getLastRow(), 4), SIGBE_FILAS_CRONOGRAMA);
  const rango = sh.getRange(1, 1, nf, Math.max(sh.getLastColumn(), 3));
  const v = rango.getValues(), d = rango.getDisplayValues(), bg = rango.getBackgrounds();
  const tz = Session.getScriptTimeZone();
  const bloques = [];
  let planta = '', b = null, n = 0;
  for (let c = 2; c < d[0].length; c++) {
    if (String(d[0][c]).trim()) { planta = String(d[0][c]).trim(); n = 0; }
    if (String(d[0][c]).trim() || String(d[1][c]).trim()) {
      n++;
      b = { planta: sigbeNorm_(planta), nombre: planta, sede: sigbeSede_(planta), n: n, sesion: (String(d[1][c]).trim() || 'Sesión ' + n).replace(/\s+/g, ' '), col: {} };
      bloques.push(b);
    }
    const k = sigbeNorm_(d[2][c]);
    if (b && k && b.col[k] === undefined) b.col[k] = c;
  }
  bloques.forEach(x => { x.cf = x.col['FECHA HOLCIM'] === undefined ? -1 : x.col['FECHA HOLCIM']; });
  const filas = [];
  let mes = '', k0256 = 0;
  for (let r = 3; r < d.length; r++) {
    if (String(d[r][0]).trim()) mes = String(d[r][0]).trim();
    const linea1 = String(d[r][1] || '').split('\n')[0].trim();
    if (!linea1) continue;
    const m = linea1.match(/^([^:]{1,20}):\s*(.*)$/);
    const pref = m ? sigbeNorm_(m[1]) : 'TODOS';
    const texto = sigbeNorm_(linea1);
    let clave = '';
    if (texto.indexOf('0256') !== -1) clave = 'M8-' + (++k0256);
    else Object.keys(LN_MODULOS).some(x => x !== 'M8' && texto.indexOf(LN_MODULOS[x]) !== -1 && (clave = x));
    filas.push({
      fila: r + 1, mes: mes, nombre: m ? m[2].trim() : linea1, prefijo: m ? m[1].trim() : 'TODOS', texto: texto, clave: clave,
      lineas: pref === 'TODOS' ? null : pref.split(/\s*(?:&|,|\/|\bY\b)\s*/).filter(String),
      celdas: bloques.map(x => {
        const extra = campo => { const c = x.col[campo]; if (c === undefined) return ''; if (v[r][c] instanceof Date) return sigbeTexto_(v[r][c]); const t = String(d[r][c]).trim(); return t === '-' ? '' : t; };
        const base = { estado: extra('ESTADO'), ambipar: extra('FECHA AMBIPAR'), obs: extra('OBSERVACIONES'), brig: extra('# BRIGADISTAS') };
        if (x.cf < 0) return Object.assign(base, { tipo: 'vacio' });
        const txt = String(d[r][x.cf]).trim(), val = v[r][x.cf];
        if (txt === '-' || sigbeEsGris_(bg[r][x.cf])) return Object.assign(base, { tipo: 'noaplica', estado: '' });
        if (val instanceof Date) return Object.assign(base, { tipo: 'fecha', fecha: val, iso: Utilities.formatDate(val, tz, 'yyyy-MM-dd') });
        return Object.assign(base, { tipo: 'vacio' });
      }),
    });
  }
  return { bloques: bloques, filas: filas };
}

function sigbeBuscarPersona_(personas, cedula, nombre) {
  const ced = String(cedula || '').replace(/\D/g, '');
  const candidatos = personas.filter(p => ced ? String(p.cedula).replace(/\D/g, '') === ced : true);
  return candidatos.find(p => sigbeNorm_(p.nombre) === sigbeNorm_(nombre)) || (ced && candidatos.length === 1 ? candidatos[0] : null);
}

/** Fondo gris (como las celdas "-" del cronograma): tonos entre #505050 y #d0d0d0 con r≈g≈b. */
function sigbeEsGris_(color) {
  const m = String(color || '').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r >= 0x50 && r <= 0xd0;
}

// ═════════════════════════════ UTILIDADES ═════════════════════════════

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
