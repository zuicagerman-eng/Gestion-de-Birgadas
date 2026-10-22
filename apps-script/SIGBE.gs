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
 * PROGRAMACIÓN Y MÓDULOS: guardarCronograma escribe fechas/estado/observaciones en el cronograma y crearModulo agrega
 * las columnas del módulo a la lista y su fila "(M12)" al cronograma (ver la sección PROGRAMACIÓN).
 * USUARIOS: el principal (SIGBE_USUARIO) y los que él cree (SIGBE_USUARIOS, p. ej. Ambipar); ver la sección USUARIOS.
 *
 * SEGUROS AL ESCRIBIR: sesión obligatoria; personas por cédula (+ nombre) y columnas por encabezado; solo
 * casillas de asistencia y campos editables; si la celda cambió desde que se cargó la pantalla no se pisa;
 * no se marca asistencia en sesiones que el cronograma dice que no aplican; respaldo del archivo antes del
 * primer cambio de cada día; todo queda en el historial.
 */

// Versión de la app. Debe ser la misma en SIGBE.gs e Index.html; la app avisa si no coinciden.
const SIGBE_VERSION = '4.3.1';

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

// Datos del brigadista que se pueden diligenciar desde la app. Si la columna no existe en la hoja, se crea al
// guardar el primer dato (con el título "titulo", al final de la fila de encabezados).
const SIGBE_CAMPOS = {
  cedula: { etiqueta: 'Cédula', titulo: 'CÉDULA', buscar: ['CEDULA'] },
  grupo: { etiqueta: 'Grupo sanguíneo', titulo: 'GRUPO SANGUÍNEO', buscar: ['GRUPO SANGUINEO', 'GRUPO SANGUINEO Y RH', 'RH'] },
  fechaIngreso: { etiqueta: 'Fecha de ingreso', titulo: 'FECHA DE INGRESO A LA BRIGADA', buscar: ['FECHA DE INGRESO'], fecha: true },
  empresa: { etiqueta: 'Empresa', titulo: 'EMPRESA', buscar: ['EMPRESA'], buscarInhouse: ['CONTRATISTA', 'EMPRESA'] },
  clase1: { etiqueta: 'Brigadista Clase I', titulo: 'BRIGADISTA CLASE I', buscar: ['BRIGADISTA CLASE I', 'CLASE I'] },
  estado: { etiqueta: 'Estado', titulo: 'ESTADO', buscar: ['ESTADO'] },
  fechaRetiro: { etiqueta: 'Fecha de retiro', titulo: 'FECHA DE RETIRO', buscar: ['FECHA DE RETIRO', 'FECHA RETIRO'], fecha: true },
  certificado: { etiqueta: 'Certificado 0256', titulo: 'CERTIFICADO 0256', buscar: ['CERTIFICADO'] },
};
const SIGBE_GRUPOS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
const SIGBE_CLASE_I = ['Sí', 'No', 'En formación']; // si la columna tiene desplegable en la hoja, se usan esas opciones

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
  // getRawContent: el texto de los archivos tal cual, sin que Google lo procese
  const codigo = HtmlService.createTemplateFromFile('App').getRawContent();
  const b64 = Utilities.base64Encode(codigo, Utilities.Charset.UTF_8);
  const html = HtmlService.createTemplateFromFile('Index').getRawContent().replace('__SIGBE_APP__', b64);
  return HtmlService.createHtmlOutput(html)
    .setTitle('SIGBE - Gestión de Brigadas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Código de las pantallas (App.html) en base64. La página lo pide al abrir si no le llegó incrustado:
 * por este camino (google.script.run) Google no procesa el texto, así que llega intacto.
 */
function getCodigoApp() {
  return Utilities.base64Encode(HtmlService.createTemplateFromFile('App').getRawContent(), Utilities.Charset.UTF_8);
}

// ═════════════════════════════ ARRANQUE Y DATOS ═════════════════════════════

/** Configuración y sesión (no lee las hojas: es rápido). */
function getContexto(token) {
  const setup = sigbeEstadoSetup_();
  return {
    version: SIGBE_VERSION, setup: setup, usuario: sigbeUsuarioSesion_(token), perfil: sigbePerfil_(sigbeUsuarioSesion_(token)),
    lecturaPublica: sigbeLecturaPublica_(), corte: !!prop_('LIBRO_NUEVO_CORTE'),
    acceso: sigbeAcceso_(), visitante: sigbeAcceso_() === 'cedula' ? sigbeVisita_(token) : null,
    reducido: sigbeVistaReducida_(token), textosIngreso: sigbeAcceso_() === 'cedula' ? sigbeTextosIngreso_() : null,
  };
}

/**
 * Todos los datos que usan las pantallas, en un solo envío. forzar = true vuelve a leer las hojas
 * aunque haya una copia en caché (botón "Actualizar datos").
 */
function getDatos(token, forzar) {
  sigbeExigirLectura_(token);
  const salida = m => sigbeVistaReducida_(token) ? sigbeReducir_(m) : m;
  if (!forzar) {
    const m = sigbeCacheLeer_('sigbe_m_' + sigbeGen_());
    if (m) { m.desdeCache = true; return salida(m); }
  }
  const m = sigbeConstruirModelo_();
  sigbeCacheGuardar_('sigbe_m_' + sigbeGen_(), m);
  return salida(m);
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
      gs: p.grupo, c1: p.clase1, fr: p.fechaRetiro,
      m: h.sesiones.map(s => p.valores[s.colAsis - 1] === true ? '1' : '0').join(''), x: x,
    };
  });

  const lista = [];
  crono.filas.forEach(f => {
    // fila sin ninguna fecha (p. ej. la parte combinada de otra), salvo los módulos creados desde la app que aún no tienen fechas
    if (!f.celdas.some(c => c.tipo === 'fecha' || c.estado) && !f.tag) return;
    crono.bloques.forEach((b, i) => {
      const c = f.celdas[i];
      lista.push({ sede: b.sede, pl: b.nombre, n: b.n, ses: b.sesion, mes: f.mes, ent: f.nombre, pre: f.prefijo, cl: f.clave,
        f: c.fecha ? sigbeTexto_(c.fecha) : '', i: c.iso || '', amb: c.ambipar, e: c.estado, obs: c.obs, br: c.brig,
        fila: f.fila, b: i, na: c.tipo === 'noaplica' ? 1 : 0 });
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
    crono: lista,  // na = 1: "-" o gris (no aplica); las pantallas las muestran solo en el cronograma
    cronoFilas: crono.filas.map(f => ({ fila: f.fila, mes: f.mes, nombre: f.nombre, pre: f.prefijo, cl: f.clave })),
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
  paso('Código de pantallas (App.html)', () => {
    const raw = HtmlService.createTemplateFromFile('App').getRawContent();
    if (raw.indexOf('VERSION_HTML') === -1) throw new Error('App.html no parece el código de pantallas (no tiene VERSION_HTML)');
    const v = (raw.match(/VERSION_HTML = '([^']+)'/) || [])[1];
    return raw.split('\n').length + ' líneas · versión ' + v + (v !== SIGBE_VERSION ? ' ⚠ distinta a SIGBE.gs (' + SIGBE_VERSION + ')' : '') + ' · se envía por getCodigoApp (' + Math.round(getCodigoApp().length / 1024) + ' KB)';
  });
  paso('Página (Index.html)', () => {
    const raw = HtmlService.createTemplateFromFile('Index').getRawContent();
    if (raw.indexOf('sigbe-app-b64') === -1) throw new Error('Index.html no es de esta versión (no tiene el bloque sigbe-app-b64)');
    const h = doGet().getContent();
    const incrustado = h.indexOf('id="sigbe-app-b64" hidden>__SIGBE_APP__<') === -1 && h.indexOf('id="sigbe-app-b64"') !== -1;
    return raw.split('\n').length + ' líneas · código ' + (incrustado ? 'incrustado en la página' : 'no incrustado: la página lo pedirá con getCodigoApp al abrir (es normal)');
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
    ['grupo', 'clase1', 'empresa', 'fechaIngreso'].forEach(campo => {
      let v = String(data[campo] || '').trim();
      if (!v || (campo === 'empresa' && !esHolcim)) return; // la empresa del contratista va en CONTRATISTA
      if (campo === 'grupo') { v = v.toUpperCase().replace(/\s+/g, '').replace('0', 'O'); if (SIGBE_GRUPOS.indexOf(v) === -1) return; }
      const c = sigbeColCampo_(t, campo, !esHolcim) || sigbeCrearColumna_(sh, t, campo);
      sh.getRange(nueva, c).setValue(SIGBE_CAMPOS[campo].fecha ? sigbeFecha_(v) : v);
    });
    if (esHolcim) {
      poner('ESTADO', data.estado || 'Activo');
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
 * Cambia datos de una persona: grupo, fecha de ingreso, empresa, Clase I, estado, fecha de retiro, certificado
 * y la cédula (solo si está vacía). Si la columna no existe en la hoja, se crea.
 * data: { tipo, cedula, nombre, cambios: {campo: valorNuevo}, anteriores: {campo: valorQueMostrabaLaPantalla} }
 */
function actualizarBrigadista(token, data) {
  const r = actualizarBrigadistasLote(token, [data]);
  if (!r.exito) return r;
  const x = r.resultados[0] || {};
  return { exito: x.exito, mensaje: x.mensaje, rechazos: x.rechazos || [] };
}

/** Varios a la vez (edición en la tabla). lista: [data como en actualizarBrigadista] */
function actualizarBrigadistasLote(token, lista) {
  const lock = LockService.getScriptLock();
  try {
    const usuario = sigbeExigirSesion_(token);
    if (!lista || !lista.length) return { exito: true, mensaje: 'No había cambios.', resultados: [] };
    if (!lock.tryLock(20000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo en unos segundos.' };
    const F = sigbeFuentes_();
    const hojas = {}; // tipo → { sh, t, personas, inhouse, ss, respaldo }
    const hoja = tipo => {
      if (hojas[tipo]) return hojas[tipo];
      const inhouse = tipo === 'INHOUSE';
      sigbeExigirEscritura_(F, inhouse ? 'datos' : 'asistencia');
      const ss = inhouse ? F.datos : F.asistencia;
      const sh = sigbeHoja_(ss, inhouse ? SIGBE_HOJA_INHOUSE : SIGBE_HOJA_HOLCIM);
      const t = sigbeTabla_(sh, ['PLANTA', 'CEDULA']);
      const cN = t.col('NOMBRE Y APELLIDO'), cC = t.col('CEDULA');
      const personas = t.filas.filter(f => String(f.valores[cN - 1] || '').trim())
        .map(f => ({ fila: f.fila, valores: f.valores, nombre: String(f.valores[cN - 1]).trim(), cedula: sigbeTexto_(f.valores[cC - 1]) }));
      return (hojas[tipo] = { sh: sh, t: t, personas: personas, inhouse: inhouse, ss: ss, respaldo: false });
    };
    const bitacora = [], resultados = [];
    let total = 0;
    lista.forEach(data => {
      const H = hoja(data.tipo === 'INHOUSE' ? 'INHOUSE' : 'HOLCIM');
      const p = sigbeBuscarPersona_(H.personas, data.cedula, data.nombre);
      if (!p) { resultados.push({ exito: false, nombre: data.nombre, mensaje: 'No se encontró a ' + data.nombre + ' en la hoja.', rechazos: [] }); return; }
      const cambios = data.cambios || {}, anteriores = data.anteriores || {};
      const escrituras = [], rechazos = [];
      Object.keys(cambios).forEach(campo => {
        const def = SIGBE_CAMPOS[campo];
        if (!def) return;
        let nuevo = String(cambios[campo] === undefined || cambios[campo] === null ? '' : cambios[campo]).trim();
        const nuevoTexto = def.fecha && /^\d{4}-\d{2}-\d{2}$/.test(nuevo) ? nuevo.split('-').reverse().join('/') : nuevo;
        let c = sigbeColCampo_(H.t, campo, H.inhouse);
        const actual = c ? sigbeTexto_(p.valores[c - 1]) : '';
        if (nuevoTexto === actual) return;
        if (anteriores[campo] !== undefined && sigbeTexto_(anteriores[campo]) !== actual) {
          rechazos.push(def.etiqueta + ': cambió en la hoja mientras tanto (ahora es "' + actual + '")'); return;
        }
        if (campo === 'cedula') {
          if (actual) { rechazos.push('Cédula: ya tiene una; para corregirla hazlo en la hoja'); return; }
          nuevo = nuevo.replace(/\D/g, '');
          if (nuevo.length < 5 || nuevo.length > 12) { rechazos.push('Cédula: debe tener entre 5 y 12 números'); return; }
          if (Object.keys(hojas).some(k => hojas[k].personas.some(x => String(x.cedula).replace(/\D/g, '') === nuevo))) { rechazos.push('Cédula: ' + nuevo + ' ya está registrada'); return; }
        }
        if (campo === 'grupo' && nuevo) {
          nuevo = nuevo.toUpperCase().replace(/\s+/g, '').replace('0', 'O');
          if (SIGBE_GRUPOS.indexOf(nuevo) === -1) { rechazos.push('Grupo sanguíneo: "' + nuevo + '" no es válido (' + SIGBE_GRUPOS.join(', ') + ')'); return; }
        }
        if (campo === 'empresa' && H.inhouse) nuevo = nuevo.toUpperCase();
        if (c) {
          const opciones = sigbeListaValidacion_(H.sh.getRange(p.fila, c));
          if (opciones && nuevo && opciones.indexOf(nuevo) === -1) { rechazos.push(def.etiqueta + ': "' + nuevo + '" no está en las opciones de la hoja (' + opciones.join(', ') + ')'); return; }
        } else {
          c = sigbeCrearColumna_(H.sh, H.t, campo); // la columna no existía: se crea al final
        }
        let valor = nuevo;
        if (def.fecha) valor = nuevo ? sigbeFecha_(nuevo) : '';
        else if (campo === 'certificado' || campo === 'cedula') valor = sigbeNumOTexto_(nuevo);
        escrituras.push({ c: c, valor: valor });
        bitacora.push(['Edición de brigadista', H.sh.getName(), p.fila, p.cedula || nuevo, p.nombre, def.etiqueta, actual, nuevoTexto]);
      });
      if (escrituras.length) {
        if (!H.respaldo) { try { respaldoDelDia_(H.ss); } catch (e) { /* sigue */ } H.respaldo = true; }
        escrituras.forEach(e => { H.sh.getRange(p.fila, e.c).setValue(e.valor); p.valores[e.c - 1] = e.valor; });
        total += escrituras.length;
      }
      resultados.push({ exito: !!escrituras.length || !rechazos.length, nombre: p.nombre, rechazos: rechazos,
        mensaje: escrituras.length ? escrituras.length + ' dato(s) actualizado(s) de ' + p.nombre + (rechazos.length ? '. No se aplicó: ' + rechazos.join('; ') : '.')
          : (rechazos.length ? 'No se guardó: ' + rechazos.join('; ') : 'No había cambios.') });
    });
    if (bitacora.length) sigbeTrasGuardar_(F, usuario, bitacora);
    const conRechazos = resultados.filter(r => r.rechazos && r.rechazos.length);
    return { exito: true, guardados: total, resultados: resultados,
      mensaje: total + ' dato(s) guardado(s)' + (conRechazos.length ? '; ' + conRechazos.length + ' persona(s) con datos que no se aplicaron.' : '.') };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

/** Columna (1-based) de un campo del brigadista en esa tabla, o 0 si no existe. */
function sigbeColCampo_(t, campo, inhouse) {
  const def = SIGBE_CAMPOS[campo];
  const lista = (inhouse && def.buscarInhouse) || def.buscar;
  for (let i = 0; i < lista.length; i++) { const c = t.col(lista[i]); if (c) return c; }
  return 0;
}

/** Crea la columna de un campo al final de la fila de encabezados y la registra en la tabla leída. */
function sigbeCrearColumna_(sh, t, campo) {
  const c = Math.max(sh.getLastColumn(), t.encabezados.length) + 1;
  if (sh.getMaxColumns() < c) sh.insertColumnsAfter(sh.getMaxColumns(), c - sh.getMaxColumns());
  sh.getRange(t.filaEncabezado, c).setValue(SIGBE_CAMPOS[campo].titulo).setFontWeight('bold');
  while (t.encabezados.length < c) t.encabezados.push('');
  t.encabezados[c - 1] = sigbeNorm_(SIGBE_CAMPOS[campo].titulo);
  return c;
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
    grupos: SIGBE_GRUPOS,
    clases: lista(sh, h.cols.clase1, SIGBE_CLASE_I),
    empresas: (() => {
      let ind = [];
      try { ind = sigbeLeerIndicador_(sigbeHoja_(F.datos, SIGBE_HOJA_INDICADOR)).filter(f => !f.tot).map(f => f.emp); } catch (e) { ind = []; }
      return sigbeUnicos_(['HOLCIM'].concat(h.personas.map(p => p.empresa), inhouse.map(p => p.k), ind.map(x => String(x).toUpperCase())));
    })(),
    estadosCrono: (() => { // el desplegable de ESTADO del cronograma, si lo tiene
      try {
        const shC = sigbeHoja_(F.datos, SIGBE_HOJA_CRONOGRAMA), c = sigbeLeerCronograma_(shC);
        const b = c.bloques.find(x => x.col.ESTADO !== undefined), f = c.filas[0];
        return (b && f && sigbeListaValidacion_(shC.getRange(f.fila, b.col.ESTADO + 1))) || SIGBE_ESTADOS_CRONO;
      } catch (e) { return SIGBE_ESTADOS_CRONO; }
    })(),
    lineas: SIGBE_LINEAS,
  };
}

// ═════════════════════════════ PROGRAMACIÓN: CRONOGRAMA Y MÓDULOS ═════════════════════════════
// La app escribe en las mismas pestañas del libro (hasta el corte en el 1.0 / 2.0, que el libro nuevo copia;
// después del corte en el libro nuevo). Así el Excel sigue siendo un reflejo fiel y todo lo demás
// (sesiones que aplican, fechas de la lista, cumplimiento) sale de un solo lugar.

const SIGBE_ESTADOS_CRONO = ['Programada', 'Realizada', 'Reprogramada', 'Pendiente Ambipar', 'Cancelada'];
const SIGBE_LINEAS = ['AGG', 'CEM', 'GEO', 'RMX', 'TQC', 'COR'];
const SIGBE_MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
// Dato del formulario → encabezado de la columna dentro del bloque de cada planta (fila 3 del cronograma)
const SIGBE_CAMPOS_CRONO = {
  fecha: { col: 'FECHA HOLCIM', etiqueta: 'Fecha', fecha: true },
  ambipar: { col: 'FECHA AMBIPAR', etiqueta: 'Fecha Ambipar', fecha: true },
  estado: { col: 'ESTADO', etiqueta: 'Estado' },
  obs: { col: 'OBSERVACIONES', etiqueta: 'Observaciones' },
  brig: { col: '# BRIGADISTAS', etiqueta: '# Brigadistas' },
};

/**
 * Cambia sesiones del cronograma. lista: [{ fila, b, ent, pl, ses, cambios: {campo: valor}, anteriores: {campo: valor} }]
 *  fila = fila de la hoja; b = número de bloque (planta y sesión); ent/pl/ses confirman que es la misma celda.
 *  fecha: 'yyyy-MM-dd', '' (sin fecha) o '-' (no aplica en esa planta). ambipar: 'yyyy-MM-dd' o ''.
 */
function guardarCronograma(token, lista) {
  const lock = LockService.getScriptLock();
  try {
    const usuario = sigbeExigirSesion_(token);
    if (!lista || !lista.length) return { exito: true, guardados: 0, resultados: [], mensaje: 'No había cambios.' };
    if (!lock.tryLock(20000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo en unos segundos.' };
    const F = sigbeFuentes_();
    sigbeExigirEscritura_(F, 'datos');
    const sh = sigbeHoja_(F.datos, SIGBE_HOJA_CRONOGRAMA);
    const crono = sigbeLeerCronograma_(sh);
    const bitacora = [], resultados = [];
    let total = 0, respaldo = false;
    lista.forEach(x => {
      const f = crono.filas.find(r => r.fila === Number(x.fila)), b = crono.bloques[Number(x.b)];
      const donde = (x.ent || '') + ' · ' + (x.pl || '') + ' ' + (x.ses || '');
      if (!f || !b || f.nombre !== x.ent || b.nombre !== x.pl || b.sesion !== x.ses) {
        resultados.push({ exito: false, rechazos: [], mensaje: donde + ': el cronograma cambió mientras tanto. Actualiza los datos (↻) y vuelve a intentarlo.' });
        return;
      }
      const r = f.fila - 1;
      const cols = Object.keys(b.col).map(k => b.col[k]);
      const texto = c => c === undefined ? '' : crono.v[r][c] instanceof Date ? sigbeTexto_(crono.v[r][c]) : String(crono.d[r][c]).trim();
      const actualDe = campo => {
        const c = b.col[SIGBE_CAMPOS_CRONO[campo].col];
        if (campo === 'fecha' && c !== undefined && (texto(c) === '-' || sigbeEsGris_(crono.bg[r][c]))) return '-';
        return texto(c) === '-' && campo !== 'fecha' ? '' : texto(c);
      };
      const escrituras = [], rechazos = [];
      Object.keys(x.cambios || {}).forEach(campo => {
        const def = SIGBE_CAMPOS_CRONO[campo];
        if (!def) return;
        const c = b.col[def.col];
        if (c === undefined) { rechazos.push(def.etiqueta + ': el bloque de ' + b.nombre + ' no tiene esa columna'); return; }
        let nuevo = String(x.cambios[campo] === null || x.cambios[campo] === undefined ? '' : x.cambios[campo]).trim();
        if (def.fecha && nuevo && nuevo !== '-' && !/^\d{4}-\d{2}-\d{2}$/.test(nuevo)) { rechazos.push(def.etiqueta + ': fecha no válida'); return; }
        if (nuevo === '-' && campo !== 'fecha') nuevo = '';
        if (campo === 'brig' && nuevo && !/^\d{1,4}$/.test(nuevo)) { rechazos.push('# Brigadistas: debe ser un número'); return; }
        if (campo === 'obs') nuevo = nuevo.slice(0, 300);
        const nuevoTexto = /^\d{4}-\d{2}-\d{2}$/.test(nuevo) ? nuevo.split('-').reverse().join('/') : nuevo;
        const actual = actualDe(campo);
        if (nuevoTexto === actual) return;
        const ant = (x.anteriores || {})[campo];
        if (ant !== undefined && sigbeNorm_(ant) !== sigbeNorm_(actual)) { rechazos.push(def.etiqueta + ': cambió en la hoja mientras tanto (ahora es "' + (actual || 'vacío') + '")'); return; }
        if (campo === 'estado' && nuevo) {
          const opciones = sigbeListaValidacion_(sh.getRange(f.fila, c + 1));
          if (opciones && opciones.indexOf(nuevo) === -1) { rechazos.push('Estado: "' + nuevo + '" no está en las opciones de la hoja (' + opciones.join(', ') + ')'); return; }
        }
        escrituras.push({ c: c, valor: def.fecha && nuevoTexto && nuevoTexto !== '-' ? sigbeFecha_(nuevo) : nuevo, fecha: def.fecha && nuevoTexto && nuevoTexto !== '-' });
        // Mismos textos que usa la revisión de cambios del Excel, para que no los anote como hechos en el Excel
        if (campo === 'fecha') {
          if (nuevo === '-') bitacora.push(['Cronograma', sh.getName(), f.fila, '', '', 'No aplica · ' + donde, actual || '(sin fecha)', 'No aplica']);
          else bitacora.push(['Cronograma', sh.getName(), f.fila, '', '', 'Fecha · ' + donde, actual === '-' ? 'No aplica' : actual || '(sin fecha)', nuevoTexto || '(sin fecha)']);
        } else if (campo === 'estado') bitacora.push(['Cronograma', sh.getName(), f.fila, '', '', 'Estado · ' + donde, actual || '(vacío)', nuevo || '(vacío)']);
        else bitacora.push(['Cronograma', sh.getName(), f.fila, '', '', def.etiqueta + ' · ' + donde, actual, nuevoTexto]);
        // Una sesión que no aplicaba (en gris) y ahora tiene fecha: el bloque vuelve a blanco
        if (campo === 'fecha' && nuevo !== '-' && actual === '-') escrituras.push({ blanco: true });
      });
      if (escrituras.length) {
        if (!respaldo) { try { respaldoDelDia_(F.datos); } catch (e) { /* sigue */ } respaldo = true; }
        escrituras.forEach(e => {
          if (e.blanco) {
            const c0 = Math.min.apply(null, cols), c1 = Math.max.apply(null, cols);
            try { sh.getRange(f.fila, c0 + 1, 1, c1 - c0 + 1).setBackground('#ffffff'); } catch (err) { /* el color no es esencial */ }
            cols.forEach(c => { if (texto(c) === '-' && c !== b.col['FECHA HOLCIM']) { sh.getRange(f.fila, c + 1).setValue(''); } });
            return;
          }
          const celda = sh.getRange(f.fila, e.c + 1);
          celda.setValue(e.valor);
          if (e.fecha) { try { celda.setNumberFormat('dd/mm/yyyy'); } catch (err) { /* columna con formato fijo */ } }
        });
        total += escrituras.filter(e => !e.blanco).length;
      }
      resultados.push({ exito: escrituras.length > 0 || !rechazos.length, rechazos: rechazos,
        mensaje: escrituras.length ? donde + ': guardado' + (rechazos.length ? '. No se aplicó: ' + rechazos.join('; ') : '.') : (rechazos.length ? donde + ': ' + rechazos.join('; ') : donde + ': no había cambios.') });
    });
    if (bitacora.length) sigbeTrasGuardar_(F, usuario, bitacora, true);
    const conRechazos = resultados.filter(r => !r.exito || (r.rechazos && r.rechazos.length));
    return { exito: true, guardados: total, resultados: resultados,
      mensaje: total + ' dato(s) del cronograma guardado(s)' + (conRechazos.length ? '; ' + conRechazos.length + ' sesión(es) con algo que no se aplicó.' : '.') };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Crea un módulo nuevo: 4 columnas en la lista de asistencia (Sesión 1 y 2 con su casilla, antes del cumplimiento)
 * y su fila en el cronograma con la etiqueta "(M12)", que es la que une las dos cosas.
 * d: { nombre, mes, lineas: ['AGG', …] (vacío = todas) }  o  { fila } para usar un entrenamiento que ya está en
 * el cronograma pero no tiene columnas en la lista (p. ej. "Espacios confinados").
 */
function crearModulo(token, d) {
  const lock = LockService.getScriptLock();
  try {
    const usuario = sigbeExigirSesion_(token);
    if (!lock.tryLock(30000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo en unos segundos.' };
    const F = sigbeFuentes_();
    sigbeExigirEscritura_(F, 'datos');
    sigbeExigirEscritura_(F, 'asistencia');
    const shC = sigbeHoja_(F.datos, SIGBE_HOJA_CRONOGRAMA), shL = sigbeHoja_(F.asistencia, SIGBE_HOJA_HOLCIM);
    const crono = sigbeLeerCronograma_(shC), h = sigbeLeerHolcim_(shL);
    const numeros = h.sesiones.map(s => Number(s.modulo.slice(1))).concat(Object.keys(LN_MODULOS).map(k => Number(k.slice(1))),
      crono.filas.map(f => f.tag ? Number(f.tag.slice(1)) : 0));
    const clave = 'M' + (Math.max.apply(null, numeros.concat([0])) + 1);

    // Qué fila del cronograma
    let existente = null, nombre = '', lineas = [], mes = '';
    if (d.fila) {
      existente = crono.filas.find(f => f.fila === Number(d.fila));
      if (!existente) return { exito: false, mensaje: 'Esa fila ya no está en el cronograma. Actualiza los datos (↻).' };
      if (existente.clave) return { exito: false, mensaje: '"' + existente.nombre + '" ya es el módulo ' + existente.clave + '.' };
      nombre = existente.nombre;
    } else {
      nombre = String(d.nombre || '').replace(/\s+/g, ' ').trim().toUpperCase().replace(/\(M\d+\)/g, '').trim();
      if (nombre.length < 4) return { exito: false, mensaje: 'Escribe el nombre del entrenamiento.' };
      const igual = crono.filas.find(f => sigbeNorm_(f.nombre) === sigbeNorm_(nombre));
      if (igual) return { exito: false, mensaje: 'Ya hay una fila "' + igual.nombre + '" en el cronograma' + (igual.clave ? ' (módulo ' + igual.clave + ')' : ': elígela en "Usar uno del cronograma"') + '.' };
      lineas = (d.lineas || []).map(sigbeNorm_).filter(x => SIGBE_LINEAS.indexOf(x) !== -1);
      if (lineas.length === SIGBE_LINEAS.length) lineas = [];
      mes = sigbeNorm_(d.mes);
      if (SIGBE_MESES.indexOf(mes) === -1) return { exito: false, mensaje: 'Elige el mes.' };
    }

    // 1) Lista de asistencia: 4 columnas después del último módulo (quedan antes del cumplimiento)
    const avisos = [];
    const ultima = Math.max.apply(null, h.sesiones.map(s => s.colAsis));
    const fe = h.filaEncabezado, c0 = ultima + 1;
    try { respaldoDelDia_(F.asistencia); } catch (e) { /* sigue */ }
    if (F.datos.getId() !== F.asistencia.getId()) { try { respaldoDelDia_(F.datos); } catch (e) { /* sigue */ } }
    const err = sigbeColumnasSesion_(shL, h, ultima, clave, [1, 2], clave + ': ' + nombre, avisos);
    if (err) return { exito: false, mensaje: err };

    // 2) Cronograma: la fila del módulo con su etiqueta
    let fila;
    try {
      if (existente) {
        const celda = shC.getRange(existente.fila, 2);
        const lineasTexto = String(celda.getValue()).split('\n');
        lineasTexto[0] = lineasTexto[0].replace(/\s+$/, '') + ' (' + clave + ')';
        celda.setValue(lineasTexto.join('\n'));
        fila = existente.fila;
      } else {
        const im = SIGBE_MESES.indexOf(mes);
        const delMes = crono.filas.filter(f => sigbeNorm_(f.mes) === mes);
        const antes = crono.filas.filter(f => SIGBE_MESES.indexOf(sigbeNorm_(f.mes)) !== -1 && SIGBE_MESES.indexOf(sigbeNorm_(f.mes)) < im);
        const tras = delMes.length ? delMes[delMes.length - 1].fila : antes.length ? antes[antes.length - 1].fila : 3;
        shC.insertRowAfter(tras);
        fila = tras + 1;
        const ancho = Math.max(shC.getLastColumn(), 3);
        const valores = [delMes.length ? '' : mes.charAt(0) + mes.slice(1).toLowerCase(), (lineas.length ? lineas.join(' & ') : 'TODOS') + ': ' + nombre + ' (' + clave + ')'];
        for (let c = 2; c < ancho; c++) valores.push('');
        const conModulo = crono.filas.filter(f => f.clave);
        crono.bloques.forEach((b, i) => {
          const cfg = lnPlanta_(b.nombre);
          const otraLinea = lineas.length && cfg && lineas.indexOf(cfg.linea) === -1; // esta planta no es de esas líneas
          // Sesión extra de la planta (creada para uno o pocos temas): en la mayoría de los módulos tiene "-"
          const extra = b.n > 1 && conModulo.filter(f => f.celdas[i].tipo === 'noaplica').length * 2 > conModulo.length;
          if (otraLinea || extra) Object.keys(b.col).forEach(k => { valores[b.col[k]] = '-'; });
        });
        shC.getRange(fila, 1, 1, ancho).setValues([valores]);
        try { shC.getRange(fila, 3, 1, ancho - 2).setBackground('#ffffff'); } catch (e) { /* solo apariencia */ }
      }
    } catch (e) {
      sigbeTrasGuardar_(F, usuario, [['Nuevo módulo', shL.getName(), '', '', '', clave + ': ' + nombre, '', 'Columnas creadas; falló la fila del cronograma']], true);
      return { exito: false, mensaje: 'Se crearon las columnas de ' + clave + ' en la lista, pero no la fila del cronograma (' + e.message + '). Agrégala a mano con el texto "' + nombre + ' (' + clave + ')".' };
    }
    sigbeTrasGuardar_(F, usuario, [['Nuevo módulo', shL.getName() + ' / ' + shC.getName(), fila, '', '', clave + ': ' + nombre + ' (' + (lineas.length ? lineas.join(', ') : existente ? existente.prefijo : 'todas las líneas') + ')', '', 'Creado']], true);
    return { exito: true, clave: clave, nombre: nombre, avisos: avisos,
      mensaje: 'Módulo ' + clave + ' creado: "' + nombre + '". Ahora ponle las fechas por planta en el Cronograma.' + (avisos.length ? ' ' + avisos.join(' ') : '') };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Inserta en la lista de asistencia, después de la columna `despues`, las columnas de esas sesiones de un módulo
 * ("M7_Sesión_3" + "Asistencia M7_3") con casillas en las filas de personas. Devuelve un error en texto o ''.
 */
function sigbeColumnasSesion_(shL, h, despues, clave, sesiones, titulo, avisos) {
  const fe = h.filaEncabezado, ancho = sesiones.length * 2, c0 = despues + 1;
  try { shL.insertColumnsAfter(despues, ancho); }
  catch (e) { return 'Google no dejó agregar columnas en "' + shL.getName() + '" (' + e.message + '). No se cambió nada.'; }
  try { shL.getRange(1, despues - ancho + 1, fe, ancho).copyTo(shL.getRange(1, c0, fe, ancho), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) { /* solo apariencia */ }
  const enc = [];
  sesiones.forEach(n => { enc.push(clave + '_Sesión_' + n, 'Asistencia ' + clave + '_' + n); });
  shL.getRange(fe, c0, 1, ancho).setValues([enc]);
  if (fe > 1 && titulo) {
    shL.getRange(fe - 1, c0, 1, ancho).setValues([[titulo].concat(Array(ancho - 1).fill(''))]);
    try { shL.getRange(fe - 1, c0, 1, ancho).merge(); } catch (e) { /* ya combinada o en una tabla */ }
  }
  const ultimaFila = shL.getLastRow();
  if (ultimaFila > fe) {
    const personas = {};
    h.personas.forEach(p => { personas[p.fila] = true; });
    const casilla = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    const rango = shL.getRange(fe + 1, c0, ultimaFila - fe, ancho);
    const fondos = rango.getBackgrounds(), valores = [], dvs = [], formatos = [];
    const par = (a, b) => { const f = []; sesiones.forEach(() => f.push(a, b)); return f; };
    for (let r = fe + 1; r <= ultimaFila; r++) {
      const es = !!personas[r];
      if (es) fondos[r - fe - 1] = Array(ancho).fill('#ffffff');
      valores.push(es ? par('', false) : par('', ''));
      dvs.push(es ? par(null, casilla) : par(null, null));
      formatos.push(par('dd/mm/yyyy', 'General'));
    }
    try { rango.setBackgrounds(fondos); } catch (e) { /* solo apariencia */ }
    try { rango.setNumberFormats(formatos); } catch (e) { /* columna con tipo fijo */ }
    try { rango.setDataValidations(dvs); } catch (e) { avisos.push('No se pudieron poner las casillas en la hoja (' + e.message + '); la asistencia igual se puede tomar desde la app.'); }
    try { rango.setValues(valores); } catch (e) { /* quedan vacías: también cuentan como "no asistió" */ }
  }
  return '';
}

/**
 * Otra sesión de un módulo que ya existe en una planta (p. ej. una Sesión 2 o 3 del M7 en Teleport).
 * En el cronograma, cada sesión de una planta es un bloque de columnas (Fecha HOLCIM, Fecha AMBIPAR…): se agrega un
 * bloque "Sesión N" junto a los de esa planta, con "-" en todos los temas menos este. Si la lista de asistencia no tiene
 * columnas para la sesión N de ese módulo, también se agregan. Si la planta ya tiene una sesión en la que este tema
 * "no aplica", no se crea nada: se habilita esa (desde la app, con guardarCronograma).
 * d: { fila, ent, pl, fecha: 'yyyy-MM-dd' | '', ambipar, estado, obs }
 */
function agregarSesion(token, d) {
  const lock = LockService.getScriptLock();
  try {
    const usuario = sigbeExigirSesion_(token);
    if (!lock.tryLock(30000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo en unos segundos.' };
    const F = sigbeFuentes_();
    sigbeExigirEscritura_(F, 'datos');
    const shC = sigbeHoja_(F.datos, SIGBE_HOJA_CRONOGRAMA);
    const crono = sigbeLeerCronograma_(shC);
    const f = crono.filas.find(x => x.fila === Number(d.fila));
    if (!f || f.nombre !== d.ent) return { exito: false, mensaje: 'El cronograma cambió mientras tanto. Actualiza los datos (↻) y vuelve a intentarlo.' };
    if (!f.clave) return { exito: false, mensaje: '"' + f.nombre + '" no es un módulo de la lista de asistencia: conviértelo primero con "Nuevo módulo".' };
    const propios = crono.bloques.map((b, i) => ({ b: b, i: i })).filter(x => x.b.nombre === d.pl);
    if (!propios.length) return { exito: false, mensaje: 'No se encontró la planta "' + d.pl + '" en el cronograma.' };
    const libre = propios.findIndex(x => f.celdas[x.i].tipo === 'noaplica');
    if (libre !== -1) return { exito: false, habilitar: true, mensaje: 'La planta ya tiene la ' + propios[libre].b.sesion + ' (con "-" en este tema): habilítala en vez de crear otra.' };
    if (d.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) return { exito: false, mensaje: 'Fecha no válida.' };
    if (d.ambipar && !/^\d{4}-\d{2}-\d{2}$/.test(d.ambipar)) return { exito: false, mensaje: 'Fecha Ambipar no válida.' };
    const n = propios.length + 1, ultimo = propios[propios.length - 1].b;
    const cols = Object.keys(ultimo.col).map(k => ultimo.col[k]);
    const c0 = Math.min.apply(null, cols), c1 = Math.max.apply(null, cols), ancho = c1 - c0 + 1; // 0-based
    const avisos = [];
    try { respaldoDelDia_(F.datos); } catch (e) { /* sigue */ }

    // 1) Lista de asistencia: columnas de la sesión N del módulo, si no existen
    let columnas = false;
    const shL = sigbeHoja_(F.asistencia, SIGBE_HOJA_HOLCIM);
    const h = sigbeLeerHolcim_(shL);
    const delModulo = h.sesiones.filter(s => s.clave === f.clave);
    if (!delModulo.length) return { exito: false, mensaje: 'La lista de asistencia no tiene columnas del módulo ' + f.clave + '.' };
    const faltan = [];
    for (let k = 1; k <= n; k++) if (!delModulo.some(s => s.n === k)) faltan.push(k);
    if (faltan.length) {
      sigbeExigirEscritura_(F, 'asistencia');
      if (F.asistencia.getId() !== F.datos.getId()) { try { respaldoDelDia_(F.asistencia); } catch (e) { /* sigue */ } }
      const err = sigbeColumnasSesion_(shL, h, Math.max.apply(null, delModulo.map(s => s.colAsis)), f.clave, faltan, '', avisos);
      if (err) return { exito: false, mensaje: err };
      columnas = true;
    }

    // 2) Cronograma: bloque "Sesión N" a la derecha de las sesiones de la planta, "-" en los demás temas
    try { shC.insertColumnsAfter(c1 + 1, ancho); }
    catch (e) { return { exito: false, mensaje: 'Google no dejó agregar columnas en el cronograma (' + e.message + ').' + (columnas ? ' Las columnas de la lista sí quedaron creadas.' : '') }; }
    const alto = crono.v.length, nueva = c1 + 1; // primera columna nueva (0-based)
    const origen = shC.getRange(1, c0 + 1, alto, ancho), destino = shC.getRange(1, nueva + 1, alto, ancho);
    try { origen.copyTo(destino, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) { /* solo apariencia */ }
    try { origen.copyTo(destino, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false); } catch (e) { /* sin desplegables */ }
    const valores = [];
    for (let r = 0; r < alto; r++) {
      const fila = Array(ancho).fill('');
      if (r === 1) fila[0] = 'Sesión ' + n;
      else if (r === 2) for (let k = 0; k < ancho; k++) fila[k] = crono.d[2][c0 + k];
      else if (r > 2 && r + 1 !== f.fila && crono.filas.some(x => x.fila === r + 1)) fila.fill('-');
      valores.push(fila);
    }
    destino.setValues(valores);
    try { shC.getRange(f.fila, nueva + 1, 1, ancho).setBackground('#ffffff'); } catch (e) { /* solo apariencia */ }
    const col = k => ultimo.col[k] === undefined ? -1 : ultimo.col[k] - c0 + nueva;
    const poner = (k, v, fecha) => { const c = col(k); if (c < 0 || v === '' || v === undefined) return; const celda = shC.getRange(f.fila, c + 1); celda.setValue(fecha ? sigbeFecha_(v) : v); if (fecha) { try { celda.setNumberFormat('dd/mm/yyyy'); } catch (e) { /* formato fijo */ } } };
    poner('FECHA HOLCIM', d.fecha, true);
    poner('FECHA AMBIPAR', d.ambipar, true);
    poner('ESTADO', String(d.estado || '').trim());
    poner('OBSERVACIONES', String(d.obs || '').trim().slice(0, 300));

    const ses = 'Sesión ' + n, donde = f.nombre + ' · ' + d.pl + ' ' + ses;
    const bit = [['Nueva sesión', shC.getName(), f.fila, '', '', f.clave + ' · ' + donde + (columnas ? ' (con columnas nuevas en la lista)' : ''), '', 'Creada']];
    if (d.fecha) bit.push(['Cronograma', shC.getName(), f.fila, '', '', 'Fecha · ' + donde, '(sin fecha)', d.fecha.split('-').reverse().join('/')]);
    sigbeTrasGuardar_(F, usuario, bit, true);
    return { exito: true, sesion: n, columnas: columnas, avisos: avisos,
      mensaje: 'Se creó la ' + ses + ' de ' + f.clave + ' en ' + d.pl + '.' + (columnas ? ' La lista de asistencia ya tiene sus columnas.' : '') + (avisos.length ? ' ' + avisos.join(' ') : '') };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ═════════════════════════════ BRIGADISTAS QUE FALTAN EN LAS LISTAS ═════════════════════════════
// La pestaña Indicador. cuenta brigadistas por planta y empresa; las listas de la app pueden tener menos.
// getBrigadistasFaltantes busca en TODAS las pestañas (también las ocultas) del 1.0, el 2.0 y el libro nuevo las
// personas con cédula y nombre que no están en las listas, para revisarlas y traerlas con importarBrigadistas.

function getBrigadistasFaltantes(token) {
  sigbeExigirSesion_(token);
  const F = sigbeFuentes_();
  const h = sigbeLeerHolcim_(sigbeHoja_(F.asistencia, SIGBE_HOJA_HOLCIM));
  const inh = sigbeLeerInhouse_(sigbeHoja_(F.datos, SIGBE_HOJA_INHOUSE));
  const ya = {};
  h.personas.forEach(p => { ya[String(p.cedula).replace(/\D/g, '')] = true; });
  inh.forEach(p => { ya[String(p.c).replace(/\D/g, '')] = true; });
  const libros = [];
  // El 1.0 y el 2.0 originales (también después del corte: sus pestañas ocultas no pasaron al libro nuevo);
  // el libro nuevo solo después del corte (antes es una copia de ellos)
  const cfg = configOrigen_();
  [F.v1 || sigbeAbrir_(cfg.modo === 'configurado' ? cfg.id : ''), F.v2 || sigbeAbrir_(idDestino_()), F.corte ? F.libro : null]
    .forEach(ss => { if (ss && !libros.some(x => x.getId() === ss.getId())) libros.push(ss); });
  const propias = [SIGBE_HOJA_BITACORA, SIGBE_HOJA_INGRESOS].map(sigbeNorm_);
  const candidatos = {}, fuentes = [];
  libros.forEach(ss => {
    ss.getSheets().forEach(sh => {
      const nombre = sh.getName();
      if (propias.indexOf(sigbeNorm_(nombre)) !== -1 || /^Respaldo /i.test(nombre)) return;
      const esLista = (ss.getId() === F.asistencia.getId() && sh.getName() === h.hoja.getName()) || (ss.getId() === F.datos.getId() && sigbeNorm_(nombre).indexOf(sigbeNorm_(SIGBE_HOJA_INHOUSE)) === 0);
      if (esLista) return;
      const nf = Math.min(sh.getLastRow(), 3000), nc = Math.min(sh.getLastColumn(), 60);
      if (nf < 2 || nc < 2) return;
      const v = sh.getRange(1, 1, nf, nc).getValues();
      const r0 = v.slice(0, 10).findIndex(f => f.some(x => sigbeNorm_(x).indexOf('CEDULA') === 0) && f.some(x => /^NOMBRE/.test(sigbeNorm_(x))));
      if (r0 === -1) return;
      const enc = v[r0].map(sigbeNorm_), col = re => enc.findIndex(x => re.test(x));
      const cC = col(/^CEDULA/), cN = col(/^NOMBRE/), cP = col(/^PLANTA|^SEDE/), cE = col(/^EMPRESA|^CONTRATISTA/), cS = col(/^ESTADO/);
      let n = 0;
      for (let r = r0 + 1; r < v.length; r++) {
        const ced = String(v[r][cC]).replace(/\D/g, ''), nom = String(v[r][cN] || '').replace(/\s+/g, ' ').trim();
        if (ced.length < 5 || ced.length > 12 || !nom || ya[ced]) continue;
        n++;
        const fuente = ss.getName() + ' › ' + nombre + (sh.isSheetHidden() ? ' (oculta)' : '');
        const x = candidatos[ced] || (candidatos[ced] = { cedula: ced, nombre: nom.toUpperCase(), planta: '', empresa: '', estado: '', fuentes: [] });
        if (!x.planta && cP >= 0) x.planta = String(v[r][cP] || '').trim();
        if (!x.empresa && cE >= 0) x.empresa = String(v[r][cE] || '').trim().toUpperCase();
        if (!x.estado && cS >= 0) x.estado = String(v[r][cS] || '').trim();
        if (x.fuentes.indexOf(fuente) === -1) x.fuentes.push(fuente);
      }
      if (n) fuentes.push({ fuente: ss.getName() + ' › ' + nombre + (sh.isSheetHidden() ? ' (oculta)' : ''), n: n,
        evacuadores: /EVACUADOR/.test(sigbeNorm_(nombre)), contacto: /CONTACTO/.test(sigbeNorm_(nombre)) });
    });
  });
  const lista = Object.keys(candidatos).map(k => candidatos[k]);
  lista.forEach(x => { x.sede = x.planta ? sigbeSede_(x.planta) : ''; x.desvinculado = /desvinculado|retirado|inactivo/i.test(x.estado); });
  // Brigadistas por sede: Indicador frente a las listas
  let indicador = [];
  try { indicador = sigbeLeerIndicador_(sigbeHoja_(F.datos, SIGBE_HOJA_INDICADOR)).filter(f => !f.tot); } catch (e) { indicador = []; }
  const porSede = {};
  indicador.forEach(f => { const s = porSede[f.sede] = porSede[f.sede] || { sede: f.sede, indicador: 0, listas: 0 }; s.indicador += f.bri; });
  h.personas.filter(p => !/desvinculado/i.test(p.estado)).forEach(p => { const sd = sigbeSede_(p.planta); (porSede[sd] = porSede[sd] || { sede: sd, indicador: 0, listas: 0 }).listas++; });
  inh.filter(p => !/desvinculado/i.test(p.e)).forEach(p => { const sd = sigbeSede_(p.p); (porSede[sd] = porSede[sd] || { sede: sd, indicador: 0, listas: 0 }).listas++; });
  return {
    candidatos: lista.sort((a, b) => a.sede.localeCompare(b.sede, 'es') || a.nombre.localeCompare(b.nombre, 'es')),
    fuentes: fuentes,
    sedes: Object.keys(porSede).map(k => porSede[k]).sort((a, b) => (a.listas - a.indicador) - (b.listas - b.indicador)),
    plantasHolcim: sigbeUnicos_(h.personas.map(p => p.planta)),
    plantasInhouse: sigbeUnicos_(inh.map(p => p.p)),
  };
}

/** Trae a las listas las personas elegidas. lista: [{ tipo, planta, nombre, cedula, empresa }] */
function importarBrigadistas(token, lista) {
  sigbeExigirSesion_(token);
  const resultados = (lista || []).slice(0, 200).map(d => {
    const r = registrarBrigadistaNuevo(token, { tipo: d.tipo === 'INHOUSE' ? 'INHOUSE' : 'HOLCIM', planta: d.planta, nombre: d.nombre, cedula: d.cedula,
      contratista: d.tipo === 'INHOUSE' ? d.empresa : '', empresa: d.tipo === 'INHOUSE' ? '' : d.empresa, estado: 'Activo', fechaIngreso: '' });
    return { cedula: d.cedula, nombre: d.nombre, exito: r.exito, mensaje: r.mensaje };
  });
  const ok = resultados.filter(r => r.exito).length;
  return { exito: true, resultados: resultados, mensaje: ok + ' de ' + resultados.length + ' brigadista(s) agregado(s) a las listas.' };
}

/** Después de guardar: historial, caché nueva y actualización rápida del libro nuevo. */
function sigbeTrasGuardar_(F, usuario, filas, cambioCronograma) {
  sigbeBitacora_(usuario, filas);
  sigbeInvalidar_();
  sigbeProgramarActualizacion_(F, cambioCronograma);
}

/**
 * Programa la actualización del libro nuevo en ~1 minuto (si no hay una pendiente): hasta el corte, para copiar
 * lo guardado; después del corte, solo si cambió el cronograma o los módulos (para reorganizar la lista).
 */
function sigbeProgramarActualizacion_(F, cambioCronograma) {
  if (!F.libro || (F.corte && !cambioCronograma)) return false;
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
  sigbeExigirLectura_(token, true);
  return sigbeFuentes_().datos.getSheets().filter(h => !h.isSheetHidden() && !sigbeEsHojaPropia_(h.getName())).map(h => h.getName());
}

/** Una pestaña como tabla: { nombre, titulo, encabezados, filas }. Detecta la fila de títulos sola. */
function getHojaExtra(token, nombre) {
  sigbeExigirLectura_(token, true);
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
  sigbeExigirLectura_(token, true);
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
  m.holcim.forEach(p => { h[sigbeClavePersona_(p.c, p.n)] = { n: p.n, c: p.c, p: p.p, e: p.e, fi: p.fi, ce: p.ce, m: p.m, em: p.em, gs: p.gs, c1: p.c1, fr: p.fr }; });
  m.inhouse.forEach(p => { i[sigbeClavePersona_(p.c, p.n)] = { n: p.n, c: p.c, p: p.p, k: p.k, ce: p.ce, e: p.e, fi: p.fi, gs: p.gs, c1: p.c1, fr: p.fr }; });
  m.crono.forEach(x => { if (!x.na) cr[x.pl + '|' + x.ses + '|' + x.ent] = { f: x.f, e: x.e }; });
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
        if (!(c in v)) return; // la foto anterior no tenía ese dato (versión anterior)
        if (String(v[c] || '') !== String(n[c] || '')) out.push([A, hoja, '', n.c, n.n, etiqueta, v[c] || '', n[c] || '']);
      });
    });
    Object.keys(x).forEach(k => { if (!y[k]) out.push([A, hoja, '', x[k].c, x[k].n, 'Baja de la lista (' + x[k].p + ')', 'En la lista', 'Ya no está']); });
  };
  const extra = [['gs', 'Grupo sanguíneo'], ['c1', 'Brigadista Clase I'], ['fr', 'Fecha de retiro']];
  personas(SIGBE_HOJA_HOLCIM, a.h || {}, b.h || {}, [['e', 'Estado'], ['fi', 'Fecha de ingreso'], ['ce', 'Certificado 0256'], ['p', 'Planta'], ['em', 'Empresa']].concat(extra));
  personas(SIGBE_HOJA_INHOUSE, a.i || {}, b.i || {}, [['k', 'Empresa'], ['ce', 'Certificado 0256'], ['e', 'Estado'], ['p', 'Planta'], ['fi', 'Fecha de ingreso']].concat(extra));
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
    if (!x) { if (y.f) out.push([A, SIGBE_HOJA_CRONOGRAMA, '', '', '', 'Fecha · ' + ent + ' · ' + pl + ' ' + ses, '(sin fecha)', y.f]); return; }
    if (x.f !== y.f) out.push([A, SIGBE_HOJA_CRONOGRAMA, '', '', '', 'Fecha · ' + ent + ' · ' + pl + ' ' + ses, x.f || '(sin fecha)', y.f || '(sin fecha)']);
    if (x.e !== y.e) out.push([A, SIGBE_HOJA_CRONOGRAMA, '', '', '', 'Estado · ' + ent + ' · ' + pl + ' ' + ses, x.e || '(vacío)', y.e || '(vacío)']);
  });
  Object.keys(a.cr || {}).forEach(k => {
    if ((b.cr || {})[k]) return;
    const [pl, ses, ent] = k.split('|');
    out.push([A, SIGBE_HOJA_CRONOGRAMA, '', '', '', 'No aplica · ' + ent + ' · ' + pl + ' ' + ses, a.cr[k].f || '(sin fecha)', 'No aplica']);
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
  sigbeExigirLectura_(token, true);
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
  sigbeExigirLectura_(token, true);
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
  const acceso = sigbeAcceso_();
  add(acceso === 'publico' ? 'aviso' : 'ok', 'Acceso para ver', acceso === 'publico' ? 'Público: cualquiera con el enlace ve la información sin registrarse.' : acceso === 'cedula' ? 'Con cédula, nombre y aceptación de datos; cada ingreso queda en "' + SIGBE_HOJA_INGRESOS + '"' + (sigbeVistaReducida_('') ? ' (visitantes con vista reducida).' : ' (visitantes ven todo).') : 'Solo administradores con usuario y clave.', acceso === 'publico' ? 'En Configuración → Acceso elige "Con cédula y nombre".' : '');
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
  const escrito = String(usuario || '').trim();
  let quien = null;
  if (escrito === u && sigbeHash_(clave, props.getProperty('SIGBE_SAL')) === hash) quien = u;
  else {
    const x = sigbeUsuarios_()[escrito.toLowerCase()];
    if (x && x.activo !== false && sigbeHash_(clave, x.sal) === x.hash) quien = escrito.toLowerCase();
  }
  sigbeAnotarIngreso_(quien ? ['Administrador' + ((sigbePerfil_(quien) || {}).org ? ' (' + sigbePerfil_(quien).org + ')' : ''), '', quien, '', '', '', '', ''] : ['Intento fallido de administrador', '', escrito.slice(0, 40), '', '', '', '', '']);
  if (quien) {
    cache.remove('sigbe_intentos');
    const token = Utilities.getUuid();
    cache.put('sigbe_sesion_' + token, quien, SIGBE_HORAS_SESION * 3600);
    return { exito: true, token: token, usuario: quien, perfil: sigbePerfil_(quien), mensaje: 'Acceso autorizado' };
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
  const u = token ? CacheService.getScriptCache().get('sigbe_sesion_' + token) : null;
  return u && sigbePerfil_(u) ? u : null; // un usuario quitado o desactivado pierde la sesión al instante
}

// ═════════════════════════════ USUARIOS ═════════════════════════════
// El usuario principal es el de la configuración inicial (SIGBE_USUARIO): administra a los demás.
// Los demás (p. ej. uno de Ambipar) van en SIGBE_USUARIOS como JSON { usuario: { n, org, sal, hash, activo } };
// las claves nunca se guardan en texto, solo su huella con sal.
const SIGBE_ORGS = ['Holcim', 'Ambipar', 'Otra'];

function sigbeUsuarios_() {
  try { return JSON.parse(prop_('SIGBE_USUARIOS') || '{}') || {}; } catch (e) { return {}; }
}

function sigbePerfil_(usuario) {
  if (!usuario) return null;
  const principal = prop_('SIGBE_USUARIO');
  if (usuario === principal) return { usuario: principal, nombre: prop_('SIGBE_NOMBRE') || principal, org: prop_('SIGBE_ORG') || 'Holcim', principal: true };
  const x = sigbeUsuarios_()[usuario];
  if (!x || x.activo === false) return null;
  return { usuario: usuario, nombre: x.n || usuario, org: x.org || '', principal: false };
}

/** Cómo aparece quien hizo el cambio en el historial: "usuario (Organización)". */
function sigbeEtiquetaUsuario_(usuario) {
  const p = sigbePerfil_(usuario);
  return p && p.org ? usuario + ' (' + p.org + ')' : usuario;
}

function getUsuarios(token) {
  const yo = sigbePerfil_(sigbeExigirSesion_(token));
  const lista = sigbeUsuarios_();
  return {
    yo: yo, orgs: SIGBE_ORGS,
    usuarios: [{ usuario: prop_('SIGBE_USUARIO'), nombre: prop_('SIGBE_NOMBRE') || '', org: prop_('SIGBE_ORG') || 'Holcim', activo: true, principal: true }]
      .concat(Object.keys(lista).sort().map(k => ({ usuario: k, nombre: lista[k].n || '', org: lista[k].org || '', activo: lista[k].activo !== false, principal: false }))),
  };
}

/** Crea o edita un usuario (solo el principal). d: { usuario, nombre, org, clave (obligatoria al crear), activo, nuevo } */
function guardarUsuario(token, d) {
  const lock = LockService.getScriptLock();
  try {
    const yo = sigbePerfil_(sigbeExigirSesion_(token));
    if (!yo.principal) return { exito: false, mensaje: 'Solo el usuario principal (' + prop_('SIGBE_USUARIO') + ') administra los usuarios.' };
    if (!lock.tryLock(10000)) return { exito: false, mensaje: 'El sistema está ocupado, intenta de nuevo.' };
    const org = SIGBE_ORGS.indexOf(d.org) !== -1 ? d.org : 'Otra';
    const nombre = String(d.nombre || '').trim().slice(0, 60);
    if (d.usuario === yo.usuario) { // el principal solo cambia su nombre y organización aquí
      props_().setProperties({ SIGBE_NOMBRE: nombre, SIGBE_ORG: org });
      sigbeBitacora_(yo.usuario, [['Usuarios', 'Propiedades del script', '', '', '', 'Datos de ' + yo.usuario, '', nombre + ' · ' + org]]);
      return { exito: true, mensaje: 'Datos actualizados.' };
    }
    const u = String(d.usuario || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) return { exito: false, mensaje: 'El usuario debe tener de 3 a 30 letras, números, punto, guion o guion bajo (sin espacios ni tildes).' };
    if (u === String(prop_('SIGBE_USUARIO') || '').toLowerCase()) return { exito: false, mensaje: 'Ese usuario ya es el principal.' };
    const lista = sigbeUsuarios_();
    if (d.nuevo && lista[u]) return { exito: false, mensaje: 'El usuario "' + u + '" ya existe.' };
    if (!d.nuevo && !lista[u]) return { exito: false, mensaje: 'El usuario "' + u + '" no existe.' };
    const x = lista[u] || {};
    const cambios = [];
    if (d.clave) {
      if (String(d.clave).length < 8) return { exito: false, mensaje: 'La clave debe tener al menos 8 caracteres.' };
      x.sal = Utilities.getUuid(); x.hash = sigbeHash_(d.clave, x.sal);
      cambios.push(d.nuevo ? 'Usuario creado' : 'Clave restablecida');
    } else if (d.nuevo) return { exito: false, mensaje: 'Ponle una clave inicial (mínimo 8 caracteres).' };
    if ((x.n || '') !== nombre) { cambios.push('Nombre: ' + nombre); x.n = nombre; }
    if ((x.org || '') !== org) { cambios.push('Organización: ' + org); x.org = org; }
    const activo = d.activo !== false;
    if ((x.activo !== false) !== activo || d.nuevo) { if (!d.nuevo) cambios.push(activo ? 'Activado' : 'Desactivado'); x.activo = activo; }
    lista[u] = x;
    props_().setProperty('SIGBE_USUARIOS', JSON.stringify(lista));
    if (cambios.length) sigbeBitacora_(yo.usuario, [['Usuarios', 'Propiedades del script', '', '', '', 'Usuario ' + u + ' (' + org + ')', '', cambios.join(' · ')]]);
    return { exito: true, mensaje: d.nuevo ? 'Usuario "' + u + '" creado. Pásale la clave por un medio privado y pídele que la cambie al entrar.' : (cambios.length ? 'Guardado: ' + cambios.join(' · ') : 'No había cambios.') };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  } finally {
    lock.releaseLock();
  }
}

function quitarUsuario(token, usuario) {
  const yo = sigbePerfil_(sigbeExigirSesion_(token));
  if (!yo.principal) return { exito: false, mensaje: 'Solo el usuario principal administra los usuarios.' };
  const lista = sigbeUsuarios_();
  if (!lista[usuario]) return { exito: false, mensaje: 'Ese usuario no existe.' };
  const org = lista[usuario].org || '';
  delete lista[usuario];
  props_().setProperty('SIGBE_USUARIOS', JSON.stringify(lista));
  sigbeBitacora_(yo.usuario, [['Usuarios', 'Propiedades del script', '', '', '', 'Usuario ' + usuario + (org ? ' (' + org + ')' : ''), 'Activo', 'Eliminado']]);
  return { exito: true, mensaje: 'Usuario "' + usuario + '" eliminado: ya no puede entrar.' };
}

function sigbeHash_(texto, sal) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(sal || '') + String(texto || '')));
}

/** ¿Cualquiera con el enlace puede ver (no guardar), sin registrarse? Por defecto no. */
function sigbeLecturaPublica_() {
  return sigbeAcceso_() === 'publico';
}

/**
 * Lanza error si no puede ver: administrador, visitante registrado (acceso por cédula) o acceso público.
 * completa = true: además exige vista completa (historial, otras hojas, estado). El frontend reconoce los prefijos.
 */
function sigbeExigirLectura_(token, completa) {
  if (sigbeUsuarioSesion_(token)) return;
  const acceso = sigbeAcceso_();
  if (acceso !== 'publico' && !(acceso === 'cedula' && sigbeVisita_(token))) {
    throw new Error(acceso === 'cedula' ? 'INGRESO_REQUERIDO: Registra tu ingreso para ver la información.' : 'SESION_REQUERIDA: Inicia sesión para ver la información.');
  }
  if (completa && sigbeVistaReducida_(token)) throw new Error('SESION_REQUERIDA: Esta parte la ven solo los administradores.');
}

// ═════════════════════════════ INGRESO CON CÉDULA (CONSULTA) ═════════════════════════════
// SIGBE_ACCESO: 'cedula' (por defecto: para ver basta cédula, nombre y aceptar el tratamiento de datos y la
// confidencialidad; cada ingreso queda en la hoja "Ingresos SIGBE"), 'clave' (solo administradores) o 'publico'.
// Guardar cualquier cambio exige siempre usuario y clave de administrador.
// Visitantes con vista reducida (por defecto): cédulas enmascaradas, sin grupo sanguíneo (dato de salud) y sin
// historial, otras hojas ni estado del sistema. SIGBE_VISITA_COMPLETA = 'si' les muestra todo.

const SIGBE_HOJA_INGRESOS = 'Ingresos SIGBE';
const SIGBE_TEXTO_DATOS = 'AUTORIZACIÓN PARA EL TRATAMIENTO DE DATOS PERSONALES. En cumplimiento de la Ley 1581 de 2012 y sus ' +
  'decretos reglamentarios, autorizo de manera previa, expresa e informada a {RESPONSABLE} para registrar mi número de cédula, mi ' +
  'nombre y la fecha y hora de cada ingreso a SIGBE, con la finalidad de controlar y dejar trazabilidad del acceso a la información ' +
  'del programa de brigadas de emergencia. Sé que puedo conocer, actualizar, rectificar y pedir la supresión de mis datos, y revocar ' +
  'esta autorización, a través de {CONTACTO}, y que la política de tratamiento de datos personales de {RESPONSABLE} está disponible para consulta.';
const SIGBE_TEXTO_CONFIDENCIALIDAD = 'COMPROMISO DE CONFIDENCIALIDAD Y NO DIVULGACIÓN. La información de SIGBE incluye datos ' +
  'personales de los brigadistas (nombres, documentos, asistencia y otros). Me comprometo a usarla solo para la gestión de las brigadas, ' +
  'a no copiarla, divulgarla, publicarla ni compartirla con terceros sin autorización, y entiendo que mi ingreso queda registrado.';

function sigbeAcceso_() {
  const a = String(prop_('SIGBE_ACCESO') || '').trim().toLowerCase();
  if (a === 'cedula' || a === 'clave' || a === 'publico') return a;
  return /^(si|sí|true|1)$/i.test(String(prop_('SIGBE_LECTURA_PUBLICA') || '').trim()) ? 'publico' : 'cedula'; // compatibilidad con v4.0
}

function sigbeVisita_(token) {
  if (!token) return null;
  try { return JSON.parse(CacheService.getScriptCache().get('sigbe_visita_' + token) || 'null'); } catch (e) { return null; }
}

/** Sin sesión de administrador y sin permiso de vista completa: datos reducidos. */
function sigbeVistaReducida_(token) {
  return !sigbeUsuarioSesion_(token) && !/^(si|sí|true|1)$/i.test(String(prop_('SIGBE_VISITA_COMPLETA') || '').trim());
}

function sigbeTextosIngreso_() {
  const responsable = String(prop_('SIGBE_DATOS_RESPONSABLE') || 'Holcim Colombia').trim();
  const contacto = String(prop_('SIGBE_DATOS_CONTACTO') || '').trim();
  const poner = t => t.replace(/\{RESPONSABLE\}/g, responsable).replace(/\{CONTACTO\}/g, contacto || 'los canales de atención de datos personales de ' + responsable);
  const datos = poner(prop_('SIGBE_TEXTO_DATOS') || SIGBE_TEXTO_DATOS), conf = poner(prop_('SIGBE_TEXTO_CONFIDENCIALIDAD') || SIGBE_TEXTO_CONFIDENCIALIDAD);
  return { datos: datos, confidencialidad: conf, version: sigbeHash_(datos + '|' + conf, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) };
}

/** Cédula 1012345678 → ••••5678 (para visitantes). */
function sigbeEnmascarar_(c) {
  const d = String(c || '').replace(/\D/g, '');
  return d.length >= 5 ? '••••' + d.slice(-4) : String(c || '');
}

function sigbeReducir_(m) {
  const quitar = p => Object.assign({}, p, { c: sigbeEnmascarar_(p.c), gs: '' });
  return Object.assign({}, m, { holcim: m.holcim.map(quitar), inhouse: m.inhouse.map(quitar), reducido: true });
}

/**
 * Ingreso para consultar. d: { cedula, nombre, aceptaDatos, aceptaConfidencialidad, navegador }
 * Queda en "Ingresos SIGBE" con la versión del texto aceptado y si la cédula está en las listas.
 */
function registrarIngreso(d) {
  try {
    d = d || {};
    if (sigbeAcceso_() === 'clave') return { exito: false, mensaje: 'Esta app solo se abre con usuario y clave de administrador.' };
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get('sigbe_ingresos_min')) || 0;
    if (n > 60) return { exito: false, mensaje: 'Demasiados ingresos seguidos. Espera un minuto e intenta de nuevo.' };
    cache.put('sigbe_ingresos_min', String(n + 1), 60);
    const cedula = String(d.cedula || '').replace(/\D/g, '');
    const nombre = String(d.nombre || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (cedula.length < 5 || cedula.length > 12) return { exito: false, mensaje: 'Escribe tu número de cédula (de 5 a 12 números).' };
    if (nombre.length < 5 || nombre.split(' ').length < 2 || /\d/.test(nombre)) return { exito: false, mensaje: 'Escribe tu nombre y apellido.' };
    if (d.aceptaDatos !== true || d.aceptaConfidencialidad !== true) return { exito: false, mensaje: 'Para entrar debes aceptar la autorización de datos y el compromiso de confidencialidad.' };
    const textos = sigbeTextosIngreso_();
    let enListas = '';
    try {
      let m = sigbeCacheLeer_('sigbe_m_' + sigbeGen_());
      if (!m) { m = sigbeConstruirModelo_(); sigbeCacheGuardar_('sigbe_m_' + sigbeGen_(), m); }
      const igual = p => String(p.c).replace(/\D/g, '') === cedula;
      const h = m.holcim.find(igual), i = h ? null : m.inhouse.find(igual), p = h || i;
      if (!p) enListas = 'No está en las listas';
      else {
        const palabras = sigbeNorm_(p.n).split(' '), coincide = sigbeNorm_(nombre).split(' ').filter(w => w.length > 2 && palabras.indexOf(w) !== -1).length >= 2;
        enListas = (h ? 'Brigadista Holcim' : 'Contratista ' + (p.k || '')) + ' · ' + p.p + (coincide ? '' : ' · OJO: en la lista es ' + p.n);
      }
    } catch (e) { enListas = '(no se pudo revisar)'; }
    sigbeAnotarIngreso_(['Consulta', cedula, nombre, enListas, 'Sí', 'Sí', textos.version, String(d.navegador || '').slice(0, 150)]);
    const token = Utilities.getUuid();
    cache.put('sigbe_visita_' + token, JSON.stringify({ c: cedula, n: nombre }), SIGBE_HORAS_SESION * 3600);
    return { exito: true, token: token, visitante: { c: cedula, n: nombre }, mensaje: 'Bienvenido(a), ' + nombre + '.' };
  } catch (e) {
    return { exito: false, mensaje: e.message };
  }
}

function salirVisita(token) {
  if (token) CacheService.getScriptCache().remove('sigbe_visita_' + token);
  return true;
}

/** Fila en "Ingresos SIGBE": [tipo, cédula, nombre, en las listas, autorizó datos, confidencialidad, versión, navegador]. */
function sigbeAnotarIngreso_(fila) {
  try {
    const ss = sigbeFuentes_().registro;
    let sh = ss.getSheetByName(SIGBE_HOJA_INGRESOS);
    if (!sh) {
      sh = ss.insertSheet(SIGBE_HOJA_INGRESOS);
      sh.getRange(1, 1, 1, 9).setValues([['Fecha', 'Tipo', 'Cédula', 'Nombre o usuario', 'En las listas', 'Autorizó tratamiento de datos', 'Aceptó confidencialidad', 'Versión del texto', 'Navegador']])
        .setFontWeight('bold').setBackground('#1a252f').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      try { sh.protect().setDescription('Registro de ingresos a SIGBE (solo la app escribe aquí)').setWarningOnly(true); } catch (e) { /* sin permiso */ }
    }
    sh.getRange(sh.getLastRow() + 1, 1, 1, 9).setValues([[new Date()].concat(fila)]);
  } catch (e) {
    console.log('No se pudo anotar el ingreso: ' + e.message);
  }
}

/** Últimos ingresos (solo administradores). */
function getIngresos(token) {
  sigbeExigirSesion_(token);
  const reg = sigbeFuentes_().registro;
  const sh = reg && reg.getSheetByName(SIGBE_HOJA_INGRESOS);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = Math.min(sh.getLastRow() - 1, 3000);
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, 9).getValues().reverse().map(f => ({
    fecha: sigbeTexto_(f[0], true), iso: f[0] instanceof Date ? Utilities.formatDate(f[0], Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
    tipo: String(f[1]), cedula: sigbeTexto_(f[2]), nombre: String(f[3]), listas: String(f[4]), datos: String(f[5]), conf: String(f[6]), version: String(f[7]), navegador: String(f[8]),
  }));
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
    acceso: sigbeAcceso_(),
    visitaCompleta: !sigbeVistaReducida_(''),
    responsable: prop_('SIGBE_DATOS_RESPONSABLE') || 'Holcim Colombia',
    contacto: prop_('SIGBE_DATOS_CONTACTO') || '',
    textoDatos: prop_('SIGBE_TEXTO_DATOS') || SIGBE_TEXTO_DATOS,
    textoConfidencialidad: prop_('SIGBE_TEXTO_CONFIDENCIALIDAD') || SIGBE_TEXTO_CONFIDENCIALIDAD,
    automatica: sigbeActivadorAutomatico_(),
    carpetaRespaldos: CARPETA_RESPALDOS,
    respaldos: respaldos,
    ejecutaComo: cuentaScript_(),
  };
}

/** Guarda archivos y lectura pública. Comprueba que los archivos abran antes de guardarlos. */
function guardarConfiguracion(token, cfg) {
  const usuario = sigbeExigirSesion_(token);
  if (!sigbePerfil_(usuario).principal) return { exito: false, mensaje: 'Solo el usuario principal cambia los archivos y el acceso.' };
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
    if (cfg.lecturaPublica !== undefined && cfg.acceso === undefined) cfg.acceso = cfg.lecturaPublica ? 'publico' : 'clave';
    const nombresAcceso = { cedula: 'con cédula y nombre', clave: 'solo administradores', publico: 'público' };
    if (cfg.acceso !== undefined) {
      if (!nombresAcceso[cfg.acceso]) return { exito: false, mensaje: 'Modo de acceso no válido.' };
      if (cfg.acceso !== sigbeAcceso_()) { props.setProperty('SIGBE_ACCESO', cfg.acceso); props.deleteProperty('SIGBE_LECTURA_PUBLICA'); cambios.push('Acceso para ver → ' + nombresAcceso[cfg.acceso]); }
    }
    if (cfg.visitaCompleta !== undefined && !!cfg.visitaCompleta !== !sigbeVistaReducida_('')) {
      props.setProperty('SIGBE_VISITA_COMPLETA', cfg.visitaCompleta ? 'si' : 'no');
      cambios.push('Visitantes ven → ' + (cfg.visitaCompleta ? 'todo' : 'vista reducida'));
    }
    const texto = (campo, prop, defecto, etiqueta) => {
      if (cfg[campo] === undefined) return;
      const t = String(cfg[campo] || '').trim().slice(0, 4000);
      const actual = props.getProperty(prop) || defecto;
      if (t === actual || (!t && actual === defecto)) return;
      if (!t || t === defecto) props.deleteProperty(prop); else props.setProperty(prop, t);
      cambios.push(etiqueta + ' actualizado');
    };
    texto('responsable', 'SIGBE_DATOS_RESPONSABLE', 'Holcim Colombia', 'Responsable de los datos');
    texto('contacto', 'SIGBE_DATOS_CONTACTO', '', 'Contacto de datos personales');
    texto('textoDatos', 'SIGBE_TEXTO_DATOS', SIGBE_TEXTO_DATOS, 'Texto de autorización de datos');
    texto('textoConfidencialidad', 'SIGBE_TEXTO_CONFIDENCIALIDAD', SIGBE_TEXTO_CONFIDENCIALIDAD, 'Texto de confidencialidad');
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
  if (!sigbePerfil_(usuario).principal) return { exito: false, mensaje: 'Solo el usuario principal cambia la tarea automática.' };
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
  const yo = sigbeExigirSesion_(token);
  const props = PropertiesService.getScriptProperties();
  if (yo !== props.getProperty('SIGBE_USUARIO')) { // otro usuario: solo su clave (el nombre de usuario no cambia)
    const lista = sigbeUsuarios_(), x = lista[yo];
    if (!x || sigbeHash_(claveActual, x.sal) !== x.hash) return { exito: false, mensaje: 'La clave actual no es correcta.' };
    if (String(claveNueva || '').length < 8) return { exito: false, mensaje: 'La clave debe tener al menos 8 caracteres.' };
    x.sal = Utilities.getUuid(); x.hash = sigbeHash_(claveNueva, x.sal);
    props.setProperty('SIGBE_USUARIOS', JSON.stringify(lista));
    sigbeBitacora_(yo, [['Usuarios', 'Propiedades del script', '', '', '', 'Usuario ' + yo, '', 'Cambió su clave']]);
    CacheService.getScriptCache().remove('sigbe_sesion_' + token);
    return { exito: true, mensaje: 'Clave actualizada. Vuelve a iniciar sesión.' };
  }
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
    const quien = /^EXCEL/i.test(String(usuario)) ? usuario : sigbeEtiquetaUsuario_(usuario);
    sh.getRange(sh.getLastRow() + 1, 1, filas.length, 10).setValues(filas.map(f => [ahora, quien].concat(f)));
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
    grupo: sigbeColCampo_(t, 'grupo'), clase1: sigbeColCampo_(t, 'clase1'), fechaRetiro: sigbeColCampo_(t, 'fechaRetiro'),
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
      grupo: cols.grupo ? sigbeTexto_(v[cols.grupo - 1]) : '',
      clase1: cols.clase1 ? sigbeTexto_(v[cols.clase1 - 1]) : '',
      fechaRetiro: cols.fechaRetiro ? sigbeTexto_(v[cols.fechaRetiro - 1]) : '',
    });
  });
  return { hoja: sh, filaEncabezado: t.filaEncabezado, cols: cols, sesiones: sesiones, personas: personas };
}

/** Contratistas. completo = true devuelve también fila, valores y columnas (para escribir). */
function sigbeLeerInhouse_(sh, completo) {
  const t = sigbeTabla_(sh, ['PLANTA', 'CEDULA']);
  const c = { planta: t.col('PLANTA'), contratista: t.col('CONTRATISTA') || t.col('EMPRESA'),
    nombre: t.col('NOMBRE Y APELLIDO'), cedula: t.col('CEDULA'), cert: t.col('CERTIFICADO'), estado: t.col('ESTADO'),
    fi: sigbeColCampo_(t, 'fechaIngreso'), gs: sigbeColCampo_(t, 'grupo'), c1: sigbeColCampo_(t, 'clase1'), fr: sigbeColCampo_(t, 'fechaRetiro') };
  const txt = (v, col) => col ? sigbeTexto_(v[col - 1]) : '';
  return t.filas
    .filter(f => c.nombre && String(f.valores[c.nombre - 1] || '').trim() && sigbeNorm_(f.valores[c.planta - 1]).indexOf('TOTAL') !== 0)
    .map(f => {
      const v = f.valores;
      const p = {
        r: f.fila, p: String(v[c.planta - 1] || '').trim(), k: c.contratista ? String(v[c.contratista - 1] || '').trim() : '',
        n: String(v[c.nombre - 1]).trim(), c: sigbeTexto_(v[c.cedula - 1]), ce: c.cert ? sigbeTexto_(v[c.cert - 1]) : '',
        e: c.estado ? String(v[c.estado - 1] || '').trim() : '',
        fi: txt(v, c.fi), gs: txt(v, c.gs), c1: txt(v, c.c1), fr: txt(v, c.fr),
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
    const tag = lnEtiquetaModulo_(texto); // módulos creados desde la app: "NOMBRE (M12)"
    let clave = tag;
    if (!clave && texto.indexOf('0256') !== -1) clave = 'M8-' + (++k0256);
    else if (!clave) Object.keys(LN_MODULOS).some(x => x !== 'M8' && texto.indexOf(LN_MODULOS[x]) !== -1 && (clave = x));
    filas.push({
      fila: r + 1, mes: mes, nombre: (m ? m[2] : linea1).replace(/\s*\(M\d+\)\s*/i, ' ').trim(), prefijo: m ? m[1].trim() : 'TODOS', texto: texto, clave: clave, tag: tag,
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
  return { bloques: bloques, filas: filas, v: v, d: d, bg: bg };
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
