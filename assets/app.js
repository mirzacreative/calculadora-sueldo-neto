/* SueldoNeto — lógica de la calculadora de sueldo neto 2026 (solo front-end).
   Criterios 2026 verificados: MEI 0,15% trabajador; base máxima 5.101,20 €/mes
   (61.214,40 €/año, Orden PJC/297/2026); cuota de solidaridad 2026.
   Escala estatal IRPF vigente. La escala autonómica 2026 no está confirmada
   para todas las CCAA: se aplica la escala estatal como aproximación (provisional).
   País Vasco y Navarra: régimen foral, se muestra aviso. */
(function () {
  'use strict';

  /* ---------- Datos fiscales 2026 ---------- */
  var STATE_SCALE = [
    { limit: 12450, rate: 0.095 },
    { limit: 20200, rate: 0.12 },
    { limit: 35200, rate: 0.15 },
    { limit: 60000, rate: 0.185 },
    { limit: 300000, rate: 0.225 },
    { limit: Infinity, rate: 0.245 }
  ];

  var SS = {
    comunes: 0.0470,          // Contingencias comunes (trabajador)
    desempleoIndef: 0.0155,   // Desempleo contrato indefinido
    desempleoTemp: 0.0160,    // Desempleo contrato temporal
    formacion: 0.0010,        // Formación profesional
    mei: 0.0015,              // MEI 2026 trabajador (0,15 %)
    baseMaxAnual: 61214.40,   // 5.101,20 x 12
    // Cuota de solidaridad 2026 (parte del trabajador) sobre el exceso de la base máxima
    solT1: 0.0019, solT2: 0.0021, solT3: 0.0024
  };

  var ART20 = { max: 6498, umbral1: 14047.50, umbral2: 19747.50, coef: 1.14 };
  var RED_CONJUNTA = 3400; // Reducción por tributación conjunta

  function cuotaEscala(base, scale) {
    var q = 0, prev = 0, i, tramo;
    for (i = 0; i < scale.length; i++) {
      if (base <= prev) break;
      tramo = Math.min(base, scale[i].limit) - prev;
      q += tramo * scale[i].rate;
      prev = scale[i].limit;
    }
    return q;
  }

  function tipoMarginal(base, scale) {
    var prev = 0, i;
    for (i = 0; i < scale.length; i++) {
      if (base <= scale[i].limit) return scale[i].rate;
      prev = scale[i].limit;
    }
    return scale[scale.length - 1].rate;
  }

  function reduccionArt20(rnt) {
    if (rnt <= ART20.umbral1) return ART20.max;
    if (rnt <= ART20.umbral2) {
      var r = ART20.max - ART20.coef * (rnt - ART20.umbral1);
      return r > 0 ? r : 0;
    }
    return 0;
  }

  function minimoDescendientes(n) {
    var tabla = [2400, 2700, 4000, 4500], total = 0, i;
    for (i = 0; i < n; i++) total += i < 4 ? tabla[i] : 4500;
    return total;
  }

  function fmtEUR(n) {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  function calcular(d) {
    var tipoDesempleo = d.contrato === 'temporal' ? SS.desempleoTemp : SS.desempleoIndef;
    var tipoSS = SS.comunes + tipoDesempleo + SS.formacion + SS.mei;
    var baseSS = Math.min(d.bruto, SS.baseMaxAnual);
    var ss = baseSS * tipoSS;

    var sol = 0, exceso = d.bruto - SS.baseMaxAnual, t1, t2, t3;
    if (exceso > 0) {
      t1 = Math.min(exceso, SS.baseMaxAnual * 0.10);
      sol += t1 * SS.solT1;
      t2 = Math.min(Math.max(0, exceso - SS.baseMaxAnual * 0.10), SS.baseMaxAnual * 0.40);
      sol += t2 * SS.solT2;
      t3 = Math.max(0, exceso - SS.baseMaxAnual * 0.50);
      sol += t3 * SS.solT3;
    }

    var rnt = d.bruto - ss - sol;
    var red20 = reduccionArt20(rnt);
    var bi = Math.max(0, rnt - red20 - (d.conyuge ? RED_CONJUNTA : 0));

    var mpf = d.edad >= 75 ? 8100 : (d.edad >= 65 ? 6700 : 5550);
    mpf += minimoDescendientes(d.hijos);
    if (d.hijoMenor3) mpf += 2800;
    if (d.discapacidad === '33') mpf += 3000;
    if (d.discapacidad === '65') mpf += 9000;

    var bl = Math.max(0, bi - mpf);
    var cuotaEstatal = cuotaEscala(bl, STATE_SCALE);
    var cuotaAutonomica = cuotaEscala(bl, STATE_SCALE); // Provisional: escala estatal
    var irpf = cuotaEstatal + cuotaAutonomica;

    var netoAnual = d.bruto - ss - sol - irpf;
    var divisor = d.pagas === '14' ? 14 : 12;
    var netoMensual = netoAnual / divisor;

    var marg = tipoMarginal(bl, STATE_SCALE);
    var desglose = {
      comunes: baseSS * SS.comunes,
      desempleo: baseSS * tipoDesempleo,
      formacion: baseSS * SS.formacion,
      mei: baseSS * SS.mei,
      solidaridad: sol,
      total: ss + sol
    };

    return {
      ss: ss, sol: sol, desglose: desglose, rnt: rnt, red20: red20, bi: bi,
      mpf: mpf, bl: bl, cuotaEstatal: cuotaEstatal, cuotaAutonomica: cuotaAutonomica,
      irpf: irpf, netoAnual: netoAnual, netoMensual: netoMensual,
      tipoMedio: d.bruto > 0 ? (irpf / d.bruto) * 100 : 0,
      tipoMarginal: marg * 2 * 100,
      foral: (d.ccaa === 'pais-vasco' || d.ccaa === 'navarra')
    };
  }

  /* ---------- UI ---------- */
  function $(id) { return document.getElementById(id); }

  function initCalc() {
    var form = $('calcForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = {
        bruto: parseFloat($('bruto').value) || 0,
        ccaa: $('ccaa').value,
        pagas: $('pagas').value,
        edad: parseInt($('edad').value, 10) || 0,
        contrato: $('contrato').value,
        hijos: parseInt($('hijos').value, 10) || 0,
        hijoMenor3: $('hijoMenor3').checked,
        conyuge: $('conyuge').checked,
        discapacidad: $('discapacidad').value
      };
      if (d.bruto <= 0) { alert('Introduce un salario bruto anual válido.'); return; }
      var r = calcular(d);
      $('rNetoMes').textContent = fmtEUR(r.netoMensual);
      $('rNetoAnio').textContent = fmtEUR(r.netoAnual);
      $('rPagas').textContent = d.pagas === '14' ? 'en 14 pagas' : 'en 12 pagas';
      $('rSS').textContent = fmtEUR(r.desglose.total);
      $('rIRPF').textContent = fmtEUR(r.irpf);
      $('rTipoMedio').textContent = r.tipoMedio.toFixed(2).replace('.', ',') + ' %';
      $('rTipoMarginal').textContent = r.tipoMarginal.toFixed(1).replace('.', ',') + ' %';
      $('rBase').textContent = fmtEUR(r.bi);
      $('rDesglose').innerHTML =
        '<li>Contingencias comunes (4,70 %): <strong>' + fmtEUR(r.desglose.comunes) + '</strong></li>' +
        '<li>Desempleo: <strong>' + fmtEUR(r.desglose.desempleo) + '</strong></li>' +
        '<li>Formación profesional (0,10 %): <strong>' + fmtEUR(r.desglose.formacion) + '</strong></li>' +
        '<li>MEI 2026 (0,15 %): <strong>' + fmtEUR(r.desglose.mei) + '</strong></li>' +
        (r.sol > 0 ? '<li>Cuota de solidaridad: <strong>' + fmtEUR(r.sol) + '</strong></li>' : '') +
        '<li>Cuota íntegra estatal: <strong>' + fmtEUR(r.cuotaEstatal) + '</strong></li>' +
        '<li>Cuota íntegra autonómica (provisional): <strong>' + fmtEUR(r.cuotaAutonomica) + '</strong></li>';
      var avisos = '';
      if (r.foral) avisos += '<div class="notice prov"><strong>Régimen foral:</strong> el País Vasco y Navarra aplican su propia escala de IRPF. Este cálculo usa la escala estatal como aproximación y el resultado es <strong>provisional</strong>.</div>';
      avisos += '<div class="notice prov"><strong>Escala autonómica provisional:</strong> se ha aplicado la escala estatal a la cuota autonómica. Tu comunidad autónoma puede tener una escala propia para 2026 que modifique ligeramente el resultado.</div>';
      $('rAvisos').innerHTML = avisos;
      $('results').classList.add('show');
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* Menú móvil */
  function initNav() {
    var btn = document.querySelector('.nav-toggle'), links = document.querySelector('.nav-links');
    if (btn && links) btn.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* Banner de cookies (RGPD) */
  function initCookies() {
    var banner = $('cookieBanner');
    if (!banner) return;
    try {
      if (localStorage.getItem('sn_cookies')) return;
    } catch (e) { return; }
    banner.hidden = false;
    $('cookieAccept').addEventListener('click', function () {
      try { localStorage.setItem('sn_cookies', 'all'); } catch (e) {}
      banner.hidden = true;
    });
    $('cookieReject').addEventListener('click', function () {
      try { localStorage.setItem('sn_cookies', 'essential'); } catch (e) {}
      banner.hidden = true;
    });
  }

  /* Formulario de contacto (sin backend: abre el correo) */
  function initContact() {
    var form = $('contactForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = $('cNombre').value.trim(), m = $('cEmail').value.trim(), t = $('cMensaje').value.trim();
      if (!n || !m || !t) { alert('Completa todos los campos.'); return; }
      window.location.href = 'mailto:CONTACT-EMAIL-PLACEHOLDER?subject=' +
        encodeURIComponent('Contacto SueldoNeto: ' + n) + '&body=' +
        encodeURIComponent(t + '\n\n— ' + n + ' (' + m + ')');
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      initNav(); initCookies(); initCalc(); initContact();
    });
  }

  /* Exportado para pruebas con node */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calcular: calcular, cuotaEscala: cuotaEscala, STATE_SCALE: STATE_SCALE, SS: SS };
  }
})();
