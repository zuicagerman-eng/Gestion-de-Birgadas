# Prompt para la sesión de GSTOR: restricciones médicas para SIGBE

Copie todo lo que está debajo de la línea y péguelo en la sesión de Claude que trabaja en el repositorio
`holcim-centro-formacion` (módulo `01-gstor`).

---

Necesito que el **puente con SIGBE** (`puenteSigbe_`, el que ya responde «estado», «entrar» y «usuarios») tenga una
acción más, **«restricciones»**: la restricción médica y el vencimiento del examen médico de cada persona, tal como GSTOR
ya los tiene del D6 en su copia (filas `medico` de la hoja `Copia D6`: cédula, restricción, vencimiento). SIGBE ya está
programado y espera exactamente lo que se describe aquí. Hágalo en una rama aparte y solo en `01-gstor/Codigo.gs` (y la
descripción del puente en `01-gstor/README.md`).

**Lo que SIGBE manda** (POST JSON a la URL /exec de GSTOR, con la llave `PUENTE_SIGBE`, igual que las otras acciones):

- `{ puente: <llave>, accion: 'restricciones' }` → responder
  `{ ok: true, copiado: 'aaaa-mm-dd' | '', lista: [{ cedula, restriccion, vence }] }`:
  - Una entrada por persona que tenga restricción o fecha de examen en el D6. `restriccion` es el texto tal cual
    (por ejemplo «Sin restricción», «Alturas», «Espacios confinados»); `vence` es la fecha de vencimiento del examen médico
    en `aaaa-mm-dd`, o lo que diga la celda si no es una fecha.
  - Se lee **solo de la copia** (`Copia D6`), y de ella solo las filas `medico` (la copia es grande: no hace falta armarla
    entera). Si todavía no hay copia, de `copiaGuardadaD6_()` como hace hoy GSTOR.
  - **El D6 solo se lee, nunca se escribe**: esta acción no lo abre si hay copia, y no cambia nada en ningún lado.
- Llave incorrecta o acción desconocida: igual que hoy.

**Lo que hay que agregar** (úselo tal cual o adáptelo a las convenciones del repo, sin cambiar lo que responde):

```javascript
// En puenteSigbe_, antes del «throw new Error('Acción desconocida.')»:
  if (p.accion === 'restricciones') {   // restricción médica y examen médico del D6, desde la copia (solo se leen)
    return { ok: true, copiado: copiaD6Fecha_(), lista: medicosParaSigbe_() };
  }
```

```javascript
/**
 * Para SIGBE: cédula, restricción médica y vencimiento del examen médico de cada persona, tal como están en la copia
 * del D6 (filas «medico»). Se leen solo esas filas, en tramos seguidos (la copia es casi toda vencimientos y
 * asistencias). Sin copia, lo que da copiaGuardadaD6_(). El D6 no se toca.
 */
function medicosParaSigbe_() {
  var libro = idLibro('D6') ? abrirLibro('GSTOR') : null, h = libro && libro.getSheetByName(HOJA_COPIA), medicos = [];
  if (h && h.getLastRow() > 0) {
    var n = h.getLastRow(), tipos = h.getRange(1, 1, n, 1).getValues();
    for (var i = 0; i < n; ) {
      if (tipos[i][0] !== 'medico') { i++; continue; }
      var j = i;
      while (j < n && tipos[j][0] === 'medico') j++;
      h.getRange(i + 1, 1, j - i, 4).getValues().forEach(function (f) {
        medicos.push({ cedula: cedula(f[1]), restriccion: String(f[2] || ''), vence: f[3] });
      });
      i = j;
    }
  } else {
    var d = copiaGuardadaD6_();
    ((d && d.medicos) || []).forEach(function (x) { medicos.push({ cedula: x.cedula, restriccion: x.restriccion, vence: x.vence || x.texto }); });
  }
  return medicos.filter(function (x) { return x.cedula && (String(x.restriccion || '').trim() || x.vence); }).map(function (x) {
    var f = aFecha(x.vence);
    return { cedula: x.cedula, restriccion: String(x.restriccion || '').replace(/\s+/g, ' ').trim().slice(0, 120),
             vence: f ? aTexto(f) : String(x.vence || '').replace(/\s+/g, ' ').trim().slice(0, 30) };
  });
}

/** Fecha de la copia del D6 (aaaa-mm-dd), o '' si no hay. */
function copiaD6Fecha_() {
  try {
    var libro = abrirLibro('GSTOR'), h = libro && libro.getSheetByName(HOJA_COPIA);
    if (!h || h.getLastRow() < 1) return '';
    var info = h.getRange(1, 1, Math.min(10, h.getLastRow()), 4).getValues().filter(function (f) { return f[0] === 'info' && f[1] === 'copiado'; })[0];
    return info && aFecha(info[3]) ? aTexto(aFecha(info[3])) : '';
  } catch (e) { return ''; }
}
```

En `01-gstor/README.md`, donde se describe el puente con SIGBE, agregar: «`restricciones`: la restricción médica y el
vencimiento del examen médico de cada persona, de la copia del D6 (solo lectura). SIGBE los muestra y permite ajustarlos
en SIGBE sin tocar el D6».

Antes de entregar: `python3 scripts/revisar_d6.py` debe pasar, y compruebe que con la llave de SIGBE la acción
`restricciones` responde la lista y que «estado», «entrar» y «usuarios» siguen igual. Al final dígame qué archivo pegar en
GSTOR y recuérdeme publicar versión nueva **en la misma implementación** (la de la URL /exec).
