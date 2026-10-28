# Prompt para la sesión de GSTOR: puente con SIGBE

Copie todo lo que está debajo de la línea y péguelo en la sesión de Claude que trabaja en el repositorio
`holcim-centro-formacion` (módulo `01-gstor`).

---

Necesito un **puente con SIGBE** (la app de gestión de brigadas, otro proyecto de Apps Script) para que el personal de
Holcim entre a SIGBE con su **usuario de GSTOR (la cédula) y su misma clave**. Es igual al puente que ya existe con
Capacitaciones (`doPost` + `puenteCapacitaciones_` + `PUENTE_CAPACITACIONES`), pero con **su propia llave**, para poder
cortar uno sin tocar el otro. SIGBE ya está programado y espera exactamente lo que se describe aquí. Hágalo en una rama
aparte y solo en `01-gstor/Codigo.gs` (y la tabla de propiedades del `01-gstor/README.md`). Capacitaciones debe seguir
funcionando igual.

**Lo que SIGBE manda** (POST JSON a la URL /exec de GSTOR, con `Authorization: Bearer <token del dueño>`, igual que
Capacitaciones):

- `{ puente: <llave>, accion: 'estado' }` → responder `{ ok: true, activo: controlActivo_() }`.
- `{ puente: <llave>, accion: 'entrar', usuario: <cédula o correo>, clave: <clave> }` →
  - Si no hay usuario de GSTOR con esa cédula (o con ese correo): `{ ok: true, existe: false }`. **No lanzar error**:
    SIGBE lo deja entrar con otra clave.
  - Si existe: validar con `comprobarClave_` (así cuentan los intentos fallidos y el bloqueo junto con GSTOR y
    Capacitaciones). Si la clave no sirve, está inactivo o bloqueado, que lance el error de siempre.
  - Si la clave es temporal (`debeCambiar`): lanzar «Su clave de GSTOR es temporal: entre primero a GSTOR, cámbiela y
    vuelva a SIGBE con la nueva.»
  - Si sirve: `{ ok: true, existe: true, usuario, nombre, rol, correo, planta }`. `correo` es el del usuario o, si no
    tiene, el del maestro de Personal. `planta` es la del maestro de Personal (`personasRegistro_()`, por la cédula,
    p. ej. «HC-CALI»), o '' si no está.
- `{ puente: <llave>, accion: 'usuarios' }` → la lista de **todos** los usuarios de GSTOR, para que el gestor de SIGBE
  les asigne la sede antes de que entren: `{ ok: true, lista: [{ usuario, nombre, correo, rol, activo, planta, ultimo }] }`
  (ordenada por usuario). `planta` es la del maestro de Personal por la cédula ('' si no está); `correo`, el del usuario
  o, si no tiene, el del maestro. **Nunca** las huellas ni las sales.
- Llave incorrecta: que siga respondiendo como hoy (`puenteCapacitaciones_` dice que el puente no está autorizado).

**Lo que hay que agregar:**

1. `prepararPuenteSigbe()` (desde el editor, con `soloEditor_()`): crea la propiedad `PUENTE_SIGBE` si no existe (dos
   UUID sin guiones, como la de Capacitaciones) y escribe en el registro qué poner en SIGBE:
   `GSTOR_PUENTE = <llave>` y `GSTOR_URL = <URL /exec de GSTOR>`.
2. `doPost`: si `p.puente` coincide con `PUENTE_SIGBE` (comparar con `mismaHuella_`), atender con `puenteSigbe_(p)`;
   si no, con `puenteCapacitaciones_(p)` como hoy.
3. `puenteSigbe_(p)` con las tres acciones de arriba, y un ayudante que pase de cédula o correo al usuario de GSTOR
   (claves de `usuarios_()` en minúscula; el correo se busca en `reg.correo`, sin distinguir mayúsculas).
4. En `01-gstor/README.md`, en la tabla de propiedades: `PUENTE_SIGBE` — la pone `prepararPuenteSigbe`; es la llave con
   la que SIGBE pregunta si el usuario y la clave de GSTOR sirven; distinta de la de Capacitaciones; no se toca.

Esta es la versión que ya se probó contra SIGBE (con el `Codigo.gs` actual de `main`); úsela tal cual o adáptela a las
convenciones del repo, sin cambiar lo que responde:

```javascript
/** Lo que piden Capacitaciones y SIGBE (cada uno con su llave). Siempre responde JSON: { ok, … } o { ok: false, error }. */
function doPost(e) {
  var r;
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    r = esPuenteSigbe_(p) ? puenteSigbe_(p) : puenteCapacitaciones_(p);
  }
  catch (x) { r = { ok: false, error: x.message }; }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

/** Desde el editor: crea la llave del puente con SIGBE (si no existe) y dice qué poner en SIGBE. */
function prepararPuenteSigbe() {
  soloEditor_();
  var clave = propiedad_('PUENTE_SIGBE');
  if (!clave) {
    clave = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    PropertiesService.getScriptProperties().setProperty('PUENTE_SIGBE', clave);
  }
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { /* sin implementación */ }
  Logger.log('En el proyecto de SIGBE → ⚙ Configuración del proyecto → Propiedades de la secuencia de comandos, ponga:\n' +
             '  GSTOR_PUENTE = ' + clave + '\n' +
             '  GSTOR_URL    = la URL /exec de GSTOR' + (url ? ': ' + url : '') + '\n' +
             'Publique GSTOR en versión nueva antes de probar. Esta llave no la escriba en ningún otro lado; ' +
             'si se filtra, borre PUENTE_SIGBE, corra esta función otra vez y cambie GSTOR_PUENTE en SIGBE.');
}

function esPuenteSigbe_(p) {
  var clave = propiedad_('PUENTE_SIGBE');
  return !!clave && mismaHuella_(String((p && p.puente) || ''), clave);
}

/** Lo que pide SIGBE: «estado», «entrar» (con la cédula o el correo y la clave de GSTOR) o «usuarios» (la lista). */
function puenteSigbe_(p) {
  if (p.accion === 'estado') return { ok: true, activo: controlActivo_() };
  if (p.accion === 'entrar') {
    var u0 = usuarioPorCedulaOCorreo_(p.usuario);
    if (!u0) return { ok: true, existe: false };   // no tiene usuario en GSTOR: SIGBE decide (clave del gestor)
    var r = comprobarClave_(u0, p.clave);           // si la clave no sirve, si está inactivo o bloqueado, lanza
    if (r.reg.debeCambiar) throw new Error('Su clave de GSTOR es temporal: entre primero a GSTOR, cámbiela y vuelva a SIGBE con la nueva.');
    var ced = cedula(u0), per = {};
    if (ced) { try { per = personasRegistro_().filter(function (x) { return x.cedula === ced; })[0] || {}; } catch (e) { per = {}; } }
    return { ok: true, existe: true, usuario: u0, nombre: r.reg.nombre || per.nombre || '', rol: r.reg.rol,
             correo: r.reg.correo || per.correo || '', planta: per.planta || '' };
  }
  if (p.accion === 'usuarios') {   // la lista para que el gestor de SIGBE les asigne la sede (sin huellas ni sales)
    var u = usuarios_(), plantas = {};
    try { personasRegistro_().forEach(function (x) { plantas[x.cedula] = x; }); } catch (e) { /* sin Personal: sin planta */ }
    return { ok: true, lista: Object.keys(u).sort().map(function (k) {
      var reg = u[k], per = plantas[cedula(k)] || {};
      return { usuario: k, nombre: reg.nombre || per.nombre || '', correo: reg.correo || per.correo || '', rol: reg.rol,
               activo: !!reg.activo, planta: per.planta || '', ultimo: reg.ultimo || '' };
    }) };
  }
  throw new Error('Acción desconocida.');
}

/** «1020827914» o «Correo@holcim.com» → el usuario de GSTOR ('' si no hay). */
function usuarioPorCedulaOCorreo_(texto) {
  var t = String(texto || '').trim().toLowerCase(), u = usuarios_();
  if (!t) return '';
  if (t.indexOf('@') < 0) return u[t] ? t : '';
  return Object.keys(u).filter(function (k) { return String(u[k].correo || '').trim().toLowerCase() === t; })[0] || '';
}
```

Antes de entregar: `python3 scripts/revisar_d6.py` debe pasar, y compruebe que Capacitaciones sigue entrando igual (con
su llave responde `{ ok, usuario, nombre, rol }` como antes) y que con la llave de Capacitaciones la acción `usuarios`
no responde la lista.

> Si en GSTOR ya pegó la primera versión de este puente (solo «estado» y «entrar»), lo único nuevo es la acción
> `usuarios` dentro de `puenteSigbe_`. Al final dígame qué archivo pegar en GSTOR y recuérdeme
publicar versión nueva **en la misma implementación** (la de la URL /exec) y luego correr `prepararPuenteSigbe`.
