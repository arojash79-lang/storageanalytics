let datos = [];
let scadaHourlyRows = [];
let indiceActual = 0;
let intervalo = null;
let charts = {};

const $ = (id) => document.getElementById(id);
const strategySelectValue = () => window.currentStrategyFile || "estrategia_A.json";
const SCADA_HOURLY_URL = "data/sam_tmy_nasa_vs_cen_horario_scada_lite.json";
const SCADA_DATA_NOTE = "Los valores FV provienen de SAM; Generación real CEN, Reducciones CEN (curtailment) y precio provienen de CEN/SEN 2025. CEN disponible = Generación real CEN + Reducciones CEN.";

window.addEventListener("DOMContentLoaded", () => {
  buildCharts();
  bindEvents();
  updateStrategyLabel("estrategia_A.json");
  cargarDatosScadaHorario();
  cargarComparador();
  preloadDashboardJsons();
});

function preloadDashboardJsons() {
  Promise.allSettled([
    loadJsonWithFallback("data/recurso_solar_tmy_dashboard_bundle.json", "data/recurso_solar_tmy_dashboard_lite.json"),
    loadJsonWithFallback("data/recurso_solar_nasa_2025_dashboard_bundle.json", "data/recurso_solar_nasa_2025_dashboard_lite.json"),
    loadJsonWithFallback("data/comparativa_recurso_solar_tmy_vs_nasa_dashboard_bundle.json", "data/comparativa_recurso_solar_tmy_vs_nasa_dashboard_lite.json"),
    loadJsonWithFallback("data/validacion_fv_ceme1_dashboard_bundle.json", "data/validacion_fv_ceme1_dashboard_lite.json"),
    loadJsonWithFallback("data/perfil_este_oeste_sam_dashboard_bundle.json", "data/perfil_este_oeste_sam_dashboard_lite.json"),
  ]).then((results) => {
    const rejected = results.filter((result) => result.status === "rejected");
    if (rejected.length) {
      console.warn("Precarga JSON del dashboard con advertencias:", rejected.map((result) => result.reason));
    }
  });
}

async function loadJsonWithFallback(primaryPath, fallbackPath = null) {
  try {
    console.log("Cargando JSON:", primaryPath);
    const response = await fetch(primaryPath, { cache: "no-store" });
    if (!response.ok) throw new Error(`${primaryPath} HTTP ${response.status}`);
    const data = await response.json();
    console.log("JSON cargado correctamente:", primaryPath, data);
    return data;
  } catch (errorPrimary) {
    console.warn("Fallo JSON principal:", primaryPath, errorPrimary);
    if (!fallbackPath) throw errorPrimary;

    console.log("Intentando JSON lite:", fallbackPath);
    const responseFallback = await fetch(fallbackPath, { cache: "no-store" });
    if (!responseFallback.ok) throw new Error(`${fallbackPath} HTTP ${responseFallback.status}`);
    const dataFallback = await responseFallback.json();
    console.log("JSON lite cargado correctamente:", fallbackPath, dataFallback);
    return dataFallback;
  }
}

function pick(obj, keys, fallback = null) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return fallback;
}

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(value, decimals = 1, unit = "") {
  const n = toNumber(value);
  if (n === null) return "Dato no disponible";
  return `${n.toLocaleString("es-CL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${unit ? " " + unit : ""}`;
}

function bindEvents(){
  $("playBtn").addEventListener("click", play);
  $("pauseBtn").addEventListener("click", pause);
  $("resetBtn").addEventListener("click", reset);
  $("timeSlider").addEventListener("input", () => { indiceActual = Number($("timeSlider").value); update(); });
  $("dateInput").addEventListener("change", () => updateScadaDay(true));
  $("samCaseSelect").addEventListener("change", () => updateScadaDay(true));
  $("changeStrategyBtn").addEventListener("click", () => {
    const next = strategySelectValue() === "estrategia_A.json" ? "estrategia_B.json" : strategySelectValue() === "estrategia_B.json" ? "estrategia_C.json" : "estrategia_A.json";
    window.currentStrategyFile = next;
    updateStrategyLabel(next);
  });
}

async function cargarDatosScadaHorario(){
  pause();
  setScadaDataNote("Cargando datos horarios SAM/CEN 2025...");
  try{
    const json = await loadJsonWithFallback(SCADA_HOURLY_URL);
    scadaHourlyRows = Array.isArray(json) ? json : [];
    if(!scadaHourlyRows.length) throw new Error("JSON horario vacío");
    logScadaLoadDiagnostics(scadaHourlyRows);
    setScadaDataNote(SCADA_DATA_NOTE);
    updateScadaDay(true);
  }catch(e){
    console.error("No se pudo cargar el JSON horario SAM/CEN:", e);
    scadaHourlyRows = [];
    datos = [];
    indiceActual = 0;
    $("timeSlider").max = 0;
    $("timeSlider").value = 0;
    setScadaDataNote("No se pudo cargar data/sam_tmy_nasa_vs_cen_horario_scada_lite.json", true);
    update();
  }
}

function updateScadaDay(resetIndex = false){
  pause();
  const selectedDate = normalizeDate($("dateInput").value || "2025-05-15");
  const selectedCase = $("samCaseSelect").value || "SAM_NASA_2025";
  const rows = scadaHourlyRows
    .filter((row) => normalizeDate(row.timestamp) === selectedDate && String(row.caso_sam || "").trim() === selectedCase)
    .sort((a,b) => getTimestampTime(a.timestamp) - getTimestampTime(b.timestamp))
    .map(normalizeScadaRow);

  datos = rows;
  indiceActual = resetIndex ? 0 : Math.min(indiceActual, Math.max(0, datos.length - 1));
  $("timeSlider").max = Math.max(0, datos.length - 1);
  $("timeSlider").value = indiceActual;

  if(!datos.length && scadaHourlyRows.length){
    setScadaDataNote("Sin datos para la fecha seleccionada y caso SAM seleccionado");
    logScadaNoMatches(selectedDate, selectedCase);
  } else if(scadaHourlyRows.length) {
    setScadaDataNote(SCADA_DATA_NOTE);
  }

  update();
}

function normalizeScadaRow(row){
  const timestamp = normalizeTimestamp(row.timestamp);
  const fvPower = toNumber(row.sam_p_ac_mw);
  const fvEnergy = toNumber(row.sam_e_ac_mwh);
  const inyeccion = toNumber(pick(row, ["generacion_real_cen_mwh", "cen_inyeccion_mwh", "cen_inyeccion_sen_mwh"]), 0);
  const curtailment = toNumber(pick(row, ["reducciones_cen_mwh", "cen_curtailment_mwh", "curtailment_cen_mwh"]), 0);
  const disponible = toNumber(pick(row, ["cen_disponible_mwh", "energia_cen_disponible_mwh"]), inyeccion + curtailment);
  const precio = toNumber(pick(row, ["precio_spot_usd_mwh", "precio_prom_usd_mwh", "precio_mirage_220_usd_mwh"]), 0);
  const residuo = toNumber(
    pick(row, ["residuo_sam_menos_cen_disponible_mwh", "residuo_sam_menos_cen_disp_mwh", "residuo_sam_cen_disponible_mwh"]),
    fvEnergy - disponible
  );

  return {
    datetime: timestamp,
    caso_sam: row.caso_sam,
    fuente_meteorologica: row.fuente_meteorologica,
    rawTimestamp: row.timestamp,
    ghi: toNumber(row.meteo_ghi_wm2),
    dni: toNumber(row.meteo_dni_wm2),
    dhi: toNumber(row.meteo_dhi_wm2),
    fv: fvPower,
    fvPower,
    fvEnergy,
    inyeccion,
    curtailment,
    disponible,
    residuo,
    pmg: precio,
    ingreso_inyeccion_usd: toNumber(pick(row, ["ingreso_generacion_real_cen_usd", "cen_ingreso_inyeccion_usd"]), inyeccion * precio),
    valor_curtailment_usd: toNumber(pick(row, ["valor_reducciones_cen_usd", "cen_valor_curtailment_usd"]), curtailment * precio),
  };
}

function normalizeDate(value){
  if(!value) return "";
  if(value instanceof Date && validDate(value)) return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());

  const raw = String(value).trim();
  const ymd = raw.match(/(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/);
  if(ymd) return formatDateParts(ymd[1], ymd[2], ymd[3]);

  const dmy = raw.match(/(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/);
  if(dmy) return formatDateParts(dmy[3], dmy[2], dmy[1]);

  const parsed = new Date(raw.replace(" ", "T"));
  return validDate(parsed) ? formatDateParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()) : "";
}

function normalizeTimestamp(value){
  const date = normalizeDate(value);
  const timeMatch = String(value || "").match(/(?:T|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const time = timeMatch ? `${pad2(timeMatch[1])}:${timeMatch[2]}:${timeMatch[3] || "00"}` : "00:00:00";
  return date ? `${date}T${time}` : "";
}

function formatDateParts(year, month, day){
  return `${String(year).padStart(4,"0")}-${pad2(month)}-${pad2(day)}`;
}

function pad2(value){
  return String(value).padStart(2,"0");
}

function getTimestampTime(value){
  const normalized = normalizeTimestamp(value);
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getAvailableScadaDates(){
  return [...new Set(scadaHourlyRows.map((row) => normalizeDate(row.timestamp)).filter(Boolean))].sort();
}

function getAvailableScadaCases(){
  return [...new Set(scadaHourlyRows.map((row) => String(row.caso_sam || "").trim()).filter(Boolean))].sort();
}

function logScadaLoadDiagnostics(data){
  console.log("SCADA lite cargado:", data.length);
  console.log("Primer registro:", data[0]);
  console.log("Campos disponibles:", Object.keys(data[0] || {}));
  console.log("Casos disponibles:", [...new Set(data.map((row) => row.caso_sam))]);
  console.log("Fechas ejemplo:", data.slice(0, 5).map((row) => row.timestamp));
}

function logScadaNoMatches(selectedDate, selectedCase){
  const dates = getAvailableScadaDates();
  console.warn("[SCADA SAM/CEN] Sin datos para filtro horario", {
    selectedDate,
    selectedCase,
    fechaMinimaDisponible: dates[0] || null,
    fechaMaximaDisponible: dates[dates.length - 1] || null,
    casosDisponibles: getAvailableScadaCases(),
    primerRegistro: scadaHourlyRows[0] || null,
  });
}

function displaySamCase(casoSam, fuenteMeteorologica = ""){
  const raw = `${casoSam || ""} ${fuenteMeteorologica || ""}`;
  if(/tmy/i.test(raw)) return "SAM TMY Explorador Solar";
  if(/nasa/i.test(raw)) return "SAM NASA 2025";
  return casoSam || "--";
}

function displayReference(reference){
  if(reference === "CEN disponible = inyeccion + curtailment") {
    return "CEN disponible = Generación real CEN + Reducciones CEN";
  }
  if(reference === "CEN inyeccion real") {
    return "Generación real CEN (inyección registrada)";
  }
  return reference || "--";
}

function displayComparison(comparison){
  if(!comparison) return "SAM vs CEN";
  return String(comparison)
    .replace(/SAM TMY/g, "SAM TMY Explorador Solar")
    .replace(/SAM NASA POWER 2025/g, "SAM NASA 2025")
    .replace(/CEN SEN 2025/g, "CEN disponible 2025");
}

function setScadaDataNote(message, isError = false){
  const note = $("scadaDataNote");
  if(!note) return;
  note.textContent = message;
  note.classList.toggle("error", isError);
}

function updateStrategyLabel(file){
  const names = {
    "estrategia_A.json":"Beneficio Neto",
    "estrategia_B.json":"Umbral de Precio",
    "estrategia_C.json":"SOC Conservador"
  };
  $("strategyName").innerHTML = `<span class="badge-dot"></span> ${names[file] || "Sin datos"}`;
  $("strategyDescription").textContent = "Módulo BESS en desarrollo. Las estrategias se mantienen como simulación preliminar no validada.";
}

function play(){
  if(!datos.length) return;
  pause();
  intervalo = setInterval(() => {
    indiceActual = indiceActual < datos.length-1 ? indiceActual + 1 : 0;
    $("timeSlider").value = indiceActual;
    update();
  }, Number($("speedSelect").value));
}
function pause(){ if(intervalo){ clearInterval(intervalo); intervalo=null; } }
function reset(){ pause(); indiceActual=0; $("timeSlider").value=0; update(); }

function update(){
  const d = datos[indiceActual] || {};
  const dayRows = getCurrentDayRows(d.datetime);
  const rowsUntil = getRowsUntilCurrentHour(dayRows, d.datetime);
  const date = new Date(d.datetime);
  const hh = validDate(date) ? date.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"}) : "--:--";
  const dd = validDate(date) ? `${date.toLocaleDateString("es-CL")} · ${displaySamCase(d.caso_sam, d.fuente_meteorologica)}` : "Sin datos";

  set("simHour", hh); set("simDate", dd); set("sliderBubble", hh);
  set("ghi", n(d.ghi)); set("fv", n(d.fv,1)); set("curtailment", n(d.curtailment,1)); set("inyeccion", n(d.inyeccion,1));
  set("carga", n(d.disponible,1)); set("descarga", n(d.residuo,1)); set("soc", "--"); set("pmg", n(d.pmg,1));
  set("socLarge", "--"); set("energiaAlmacenada", "En desarrollo");
  set("energiaNominal", "No disponibles"); set("pMaxCarga", "--"); set("pMaxDescarga", "--"); set("eficiencia", "--");
  set("temperatura", "--"); set("soh", "--"); set("sohActual", "No disponible"); set("efc", "--");
  set("perdidaCapacidad", "No validada"); set("costoDeg2", "No calculado"); set("beneficio", "Módulo en desarrollo");

  set("ghiSub", `Máx. día: ${n(max(dayRows,"ghi"))} W/m²`);
  set("fvSub", `Máx. día: ${n(max(dayRows,"fvPower"),1)} MW`);
  const pctCurt = d.disponible ? (d.curtailment/d.disponible)*100 : 0;
  const pctInj = d.disponible ? (d.inyeccion/d.disponible)*100 : 0;
  set("curtSub", `${n(pctCurt,1)}% de CEN disponible`);
  set("injSub", `${n(pctInj,1)}% de CEN disponible`);
  set("pmgSub", `Promedio día: ${n(avg(dayRows,"pmg"),1)}`);

  set("energiaFvDia", `${n(sum(dayRows,"fvEnergy"),1)} MWh`);
  set("energiaDispDia", `${n(sum(dayRows,"disponible"),1)} MWh`);
  set("energiaInyDia", `${n(sum(dayRows,"inyeccion"),1)} MWh`);
  set("curtailmentDia", `${n(sum(dayRows,"curtailment"),1)} MWh`);
  set("ingreso", `USD ${money(sum(dayRows,"ingreso_inyeccion_usd"))}`);
  set("valorCurtDia", `USD ${money(sum(dayRows,"valor_curtailment_usd"))}`);
  set("curtRecDia", `${n(sum(dayRows,"residuo"),1)} MWh`);

  if($("batteryFill")) $("batteryFill").style.height = "0%";
  updateCharts(dayRows, rowsUntil);
}

function updateCharts(dayRows, rowsUntil){
  const labels = dayRows.map(x => hourLabel(x.datetime));
  const labelsUntil = rowsUntil.map(x => hourLabel(x.datetime));
  setChart(charts.operation, labels, ["fvEnergy","disponible","inyeccion","curtailment","pmg"].map(k => dayRows.map(x => x[k] || 0)));
  setChart(charts.radiation, labels, ["ghi","dni","dhi"].map(k => dayRows.map(x => x[k] || 0)));
  setChart(charts.soc, labels, [dayRows.map(x => x.residuo || 0)]);
  setChart(charts.pmg, labels, [dayRows.map(x => x.pmg || 0)]);
  setChart(charts.sparkGhi, labelsUntil, [rowsUntil.map(x=>x.ghi||0)]);
  setChart(charts.sparkFv, labelsUntil, [rowsUntil.map(x=>x.fvPower||0)]);
  setChart(charts.sparkCurt, labelsUntil, [rowsUntil.map(x=>x.curtailment||0)]);
  setChart(charts.sparkInj, labelsUntil, [rowsUntil.map(x=>x.inyeccion||0)]);
  setChart(charts.sparkCarga, labelsUntil, [rowsUntil.map(x=>x.disponible||0)]);
  setChart(charts.sparkDescarga, labelsUntil, [rowsUntil.map(x=>x.residuo||0)]);
  setChart(charts.sparkPmg, labelsUntil, [rowsUntil.map(x=>x.pmg||0)]);
}

function buildCharts(){
  charts.operation = lineChart("operationChart", ["Generación FV SAM (AC)","CEN disponible","Generación real CEN","Reducciones CEN (curtailment)","Precio spot"], ["#76ff45","#ffd21f","#31b7ff","#ff8a00","#b46cff"], false);
  charts.radiation = lineChart("radiationChart", ["GHI","DNI","DHI"], ["#ffd21f","#ff8a00","#31b7ff"], false);
  charts.soc = lineChart("socChart", ["Residuo SAM − CEN disponible"], ["#ff8a00"], false);
  charts.pmg = lineChart("pmgChart", ["Precio spot"], ["#9b78ff"], false);
  charts.sparkGhi = lineChart("sparkGhi", ["GHI"], ["#ffd21f"], true);
  charts.sparkFv = lineChart("sparkFv", ["FV"], ["#76ff45"], true);
  charts.sparkCurt = lineChart("sparkCurt", ["Reducciones CEN"], ["#ff8a00"], true);
  charts.sparkInj = lineChart("sparkInj", ["Generación real CEN"], ["#31b7ff"], true);
  charts.sparkCarga = lineChart("sparkCarga", ["Disp"], ["#ffd21f"], true);
  charts.sparkDescarga = lineChart("sparkDescarga", ["Residuo"], ["#ff8a00"], true);
  charts.sparkPmg = lineChart("sparkPmg", ["Precio"], ["#9b78ff"], true);
}

function lineChart(id, labels, colors, spark=false){
  const ctx = $(id);
  return new Chart(ctx, {type:"line",data:{labels:[],datasets:labels.map((label,i)=>({label,data:[],borderColor:colors[i],backgroundColor:colors[i]+"22",borderWidth:spark?1.5:2,pointRadius:0,tension:.28,fill:false}))},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:!spark,labels:{color:"#dbe9fa",boxWidth:18,font:{size:10}}},tooltip:{enabled:!spark}},scales:{x:{display:!spark,ticks:{color:"#b9c7d8",maxTicksLimit:9,font:{size:10}},grid:{color:"rgba(255,255,255,.05)"}},y:{display:!spark,ticks:{color:"#b9c7d8",font:{size:10}},grid:{color:"rgba(255,255,255,.06)"}}}}});
}
function setChart(chart, labels, arrays){ chart.data.labels=labels; arrays.forEach((arr,i)=>{ if(chart.data.datasets[i]) chart.data.datasets[i].data=arr; }); chart.update("none"); }

async function cargarComparador(){
  try{ const res = await fetch("data/comparador_estrategias.json", {cache:"no-store"}); const json = await res.json(); if(Array.isArray(json) && json.length){ renderTable(json); return; } }catch(e){}
  renderTable([]);
}
function renderTable(rows){
  if(!Array.isArray(rows) || !rows.length){
    $("strategyTable").innerHTML = `<tr><td colspan="9">Módulo BESS en desarrollo: no hay JSON de operación BESS validado.</td></tr>`;
    set("recommendedStrategy", "Sin datos BESS validados");
    set("recommendationText", "La operación BESS queda marcada como módulo en desarrollo hasta incorporar resultados validados.");
    return;
  }
  $("strategyTable").innerHTML = rows.map(r => `<tr class="${r.highlight?'highlight':''}"><td>${r.highlight?'★ ':''}${r.estrategia}</td><td>${money(r.ingreso)}</td><td>${money(r.costo)}</td><td>${money(r.neto)}</td><td>${n(r.soh,1)}</td><td>${n(r.efc,1)}</td><td>${money(r.curtailment)}</td><td>${n(r.usd_mwh,1)}</td><td>${money(r.usd_soh)}</td></tr>`).join("");
  const best = rows.slice().sort((a,b)=>(b.neto||0)-(a.neto||0))[0];
  if(best){ set("recommendedStrategy", best.estrategia); set("recommendationText", "La estrategia seleccionada maximiza el beneficio neto considerando ingresos y degradación del BESS."); }
}

function getCurrentDayRows(dt){ const day = (dt||"").slice(0,10); return datos.filter(x => (x.datetime||"").slice(0,10)===day); }
function getRowsUntilCurrentHour(rows, dt){ const t = new Date(dt).getTime(); return rows.filter(x => new Date(x.datetime).getTime() <= t); }
function hourLabel(dt){ const d=new Date(dt); return validDate(d)?d.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"}):"--"; }
function validDate(d){ return d instanceof Date && !isNaN(d.getTime()); }
function set(id,value){ const el=$(id); if(el) el.textContent = value ?? "--"; }
function n(v,dec=0){ if(v===undefined||v===null||Number.isNaN(Number(v))) return "--"; return Number(v).toLocaleString("es-CL",{maximumFractionDigits:dec,minimumFractionDigits:dec}); }
function money(v){ if(v===undefined||v===null||Number.isNaN(Number(v))) return "--"; return Number(v).toLocaleString("es-CL",{maximumFractionDigits:0}); }
function sum(rows,k){ return rows.reduce((a,b)=>a+(Number(b[k])||0),0); }
function max(rows,k){ return rows.reduce((m,b)=>Math.max(m,Number(b[k])||0),0); }
function avg(rows,k){ return rows.length ? sum(rows,k)/rows.length : 0; }
/* ============================================================
   MÓDULO RECURSO SOLAR (TMY)
   ------------------------------------------------------------
   Este bloque carga los datos JSON del TMY del Explorador Solar
   y alimenta la vista "Recurso Solar (TMY)" del dashboard.
   ============================================================ */

(() => {
  const SOLAR_DATA_URLS = {
    tmy: {
      primary: "data/recurso_solar_tmy_dashboard_bundle.json",
      fallback: "data/recurso_solar_tmy_dashboard_lite.json",
    },
    nasa: {
      primary: "data/recurso_solar_nasa_2025_dashboard_bundle.json",
      fallback: "data/recurso_solar_nasa_2025_dashboard_lite.json",
    },
    compare: {
      primary: "data/comparativa_recurso_solar_tmy_vs_nasa_dashboard_bundle.json",
      fallback: "data/comparativa_recurso_solar_tmy_vs_nasa_dashboard_lite.json",
    },
  };

  const solarState = {
    bundles: {},
    renderedBundle: null,
    currentMode: "tmy",
    charts: {},
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function formatNumber(value, decimals = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "--";
    }

    return Number(value).toLocaleString("es-CL", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function formatInteger(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "--";
    }

    return Number(value).toLocaleString("es-CL", {
      maximumFractionDigits: 0,
    });
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function destroySolarCharts() {
    Object.values(solarState.charts).forEach((chart) => {
      if (chart && typeof chart.destroy === "function") {
        chart.destroy();
      }
    });

    solarState.charts = {};
  }

  function getCssColor(variableName, fallback) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(variableName)
      .trim();

    return value || fallback;
  }

  function chartBaseOptions(extra = {}) {
    const gridColor = "rgba(140, 170, 210, 0.16)";
    const tickColor = "#b8cbe3";

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          labels: {
            color: tickColor,
            boxWidth: 14,
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: "rgba(3, 18, 34, 0.95)",
          titleColor: "#ffffff",
          bodyColor: "#d7e8ff",
          borderColor: "rgba(91, 141, 196, 0.45)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: {
            color: tickColor,
          },
          grid: {
            color: gridColor,
          },
        },
        y: {
          ticks: {
            color: tickColor,
          },
          grid: {
            color: gridColor,
          },
        },
      },
      ...extra,
    };
  }

  function lineDataset(label, data, color, yAxisID = "y") {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 4,
      tension: 0.28,
      fill: false,
      yAxisID,
    };
  }

  function barDataset(label, data, color, yAxisID = "y") {
    return {
      label,
      data,
      backgroundColor: color,
      borderColor: color,
      borderWidth: 1,
      yAxisID,
    };
  }

  async function loadSolarBundle(mode = solarState.currentMode) {
    const source = SOLAR_DATA_URLS[mode] || SOLAR_DATA_URLS.tmy;
    if (solarState.bundles[mode]) {
      return solarState.bundles[mode];
    }

    try {
      const bundle = await loadJsonWithFallback(source.primary, source.fallback);
      solarState.bundles[mode] = bundle;

      return bundle;
    } catch (error) {
      console.error(`No se pudo cargar el JSON de recurso solar (${source.primary}):`, error);
      return null;
    }
  }

  function setSolarHeader(mode) {
    const copy = {
      tmy: {
        eyebrow: "RECURSO SOLAR — TMY EXPLORADOR SOLAR",
        title: "Caracterización meteorológica TMY — María Elena",
        intro: "Visualización de GHI, DNI, DHI, temperatura ambiente y velocidad del viento a partir del archivo TMY del Explorador Solar.",
        note: "Las irradiancias corresponden al Año Meteorológico Típico (TMY) del Explorador Solar. Representan condiciones típicas de largo plazo y no mediciones reales de un año calendario específico.",
      },
      nasa: {
        eyebrow: "RECURSO SOLAR — NASA POWER 2025",
        title: "Caracterización meteorológica NASA POWER 2025",
        intro: "Visualización del recurso meteorológico histórico 2025 usado como base SAM para contraste operacional frente a datos CEN 2025.",
        note: "NASA POWER 2025 representa una serie histórica del año calendario 2025. Se usa para contraste operacional anual, no como año meteorológico típico.",
      },
      compare: {
        eyebrow: "RECURSO SOLAR — COMPARATIVA TMY VS NASA",
        title: "Comparativa meteorológica TMY Explorador Solar vs NASA POWER 2025",
        intro: "Comparación de GHI, DNI, DHI y perfiles horarios para separar año típico y meteorología histórica 2025.",
        note: "TMY caracteriza condiciones típicas de largo plazo; NASA POWER 2025 permite contrastar contra el mismo año calendario de los datos CEN.",
      },
    }[mode] || {};

    setText("solarEyebrow", copy.eyebrow);
    setText("solarTitle", copy.title);
    setText("solarIntro", copy.intro);
    const note = document.querySelector("#view-solar .method-note span");
    if (note) note.textContent = copy.note;
    byId("solarCompareConclusion")?.toggleAttribute("hidden", mode !== "compare");

    document.querySelectorAll(".solar-mode-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.solarMode === mode);
    });

    const labels = mode === "compare"
      ? [
        ["GHI DIARIO TMY", "TMY Explorador Solar"],
        ["GHI DIARIO NASA 2025", "NASA POWER 2025"],
        ["DIFERENCIA GHI", "NASA 2025 - TMY [% anual]"],
        ["GHI ANUAL TMY", "kWh/m²/año"],
        ["DNI ANUAL TMY", "kWh/m²/año"],
        ["DNI ANUAL NASA 2025", "kWh/m²/año"],
      ]
      : [
        ["GHI PROMEDIO DIARIA", "Global horizontal"],
        ["DNI PROMEDIO DIARIA", "Directa normal"],
        ["DHI PROMEDIO DIARIA", "Difusa horizontal"],
        ["GHI ANUAL", "Recurso global anual"],
        ["TEMPERATURA MEDIA", mode === "nasa" ? "Promedio NASA POWER 2025" : "Promedio anual TMY"],
        ["VIENTO MEDIO", mode === "nasa" ? "Dato no disponible si no existe en JSON" : "Promedio anual TMY"],
      ];

    document.querySelectorAll("#solarKpiCards .kpi-card").forEach((card, index) => {
      const title = card.querySelector(".kpi-content p");
      const subtitle = card.querySelector(".kpi-content > small");
      if (title && labels[index]) title.textContent = labels[index][0];
      if (subtitle && labels[index]) subtitle.textContent = labels[index][1];
    });
  }

  function monthName(month) {
    return ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][Number(month) - 1] || month;
  }

  function normalizeSamSolarBundle(bundle, label) {
    const kpis = bundle?.kpis || {};
    const mensual = Array.isArray(bundle?.mensual) ? bundle.mensual.map((row) => ({
      mes_corto: row.mes_corto || monthName(row.mes),
      ghi_kwh_m2_dia_promedio: (Number(row.ghi_kwh_m2) || 0) / 30,
      dni_kwh_m2_dia_promedio: (Number(row.dni_kwh_m2) || 0) / 30,
      dhi_kwh_m2_dia_promedio: (Number(row.dhi_kwh_m2) || 0) / 30,
      ghi_kwh_m2_mes: row.ghi_kwh_m2,
      dni_kwh_m2_mes: row.dni_kwh_m2,
      dhi_kwh_m2_mes: row.dhi_kwh_m2,
      temperatura_media_c: row.temp_amb_prom_c,
      temperatura_max_c: row.temp_amb_prom_c,
      temperatura_min_c: row.temp_amb_prom_c,
      viento_media_m_s: row.viento_prom_ms,
      viento_max_m_s: row.viento_prom_ms,
    })) : [];
    const perfil = Array.isArray(bundle?.perfil_horario) ? bundle.perfil_horario.map((row) => ({
      hora: row.hora,
      hora_label: row.hora_label,
      ghi_promedio_w_m2: row.ghi_prom_wm2,
      dni_promedio_w_m2: row.dni_prom_wm2,
      dhi_promedio_w_m2: row.dhi_prom_wm2,
    })) : [];

    return {
      metadata: { fuente: label, tipo_dato: label, ubicacion: "María Elena / CEME1" },
      kpis: {
        ghi_promedio_diario_kwh_m2_dia: (Number(kpis.ghi_anual_kwh_m2) || 0) / 365,
        dni_promedio_diario_kwh_m2_dia: (Number(kpis.dni_anual_kwh_m2) || 0) / 365,
        dhi_promedio_diario_kwh_m2_dia: (Number(kpis.dhi_anual_kwh_m2) || 0) / 365,
        ghi_anual_kwh_m2_anio: kpis.ghi_anual_kwh_m2,
        temperatura_media_anual_c: kpis.temp_amb_prom_c ?? kpis.temperatura_media_anual_c,
        viento_media_anual_m_s: kpis.wind_prom_m_s ?? kpis.viento_media_anual_m_s,
      },
      mensual,
      perfil_horario: perfil,
      horario: [],
    };
  }

  function normalizeCompareSolarBundle(bundle) {
    const tmy = Array.isArray(bundle?.kpis) ? bundle.kpis.find((row) => /tmy/i.test(`${row.caso || ""}`)) || {} : {};
    const nasa = Array.isArray(bundle?.kpis) ? bundle.kpis.find((row) => /nasa/i.test(`${row.caso || ""}`)) || {} : {};
    const mensual = Array.isArray(bundle?.mensual) ? bundle.mensual.map((row) => ({
      mes_corto: row.mes_nombre || monthName(row.mes),
      ghi_kwh_m2_dia_promedio: row.ghi_kwh_m2_tmy,
      dni_kwh_m2_dia_promedio: row.ghi_kwh_m2_nasa_2025,
      dhi_kwh_m2_dia_promedio: (Number(row.ghi_kwh_m2_nasa_2025) || 0) - (Number(row.ghi_kwh_m2_tmy) || 0),
      ghi_kwh_m2_mes: row.ghi_kwh_m2_tmy,
      dni_kwh_m2_mes: row.ghi_kwh_m2_nasa_2025,
      dhi_kwh_m2_mes: (Number(row.ghi_kwh_m2_nasa_2025) || 0) - (Number(row.ghi_kwh_m2_tmy) || 0),
      temperatura_media_c: row.temp_amb_prom_c_tmy,
      temperatura_max_c: row.temp_amb_prom_c_nasa_2025,
      temperatura_min_c: row.temp_amb_prom_c_tmy,
      viento_media_m_s: row.wind_prom_m_s_tmy,
      viento_max_m_s: row.wind_prom_m_s_nasa_2025,
    })) : [];
    const perfil = Array.isArray(bundle?.perfil_horario) ? bundle.perfil_horario.map((row) => ({
      hora: row.hora,
      hora_label: row.hora_label,
      compare_mode: true,
      ghi_promedio_w_m2: row.ghi_prom_wm2_tmy,
      dni_promedio_w_m2: row.ghi_prom_wm2_nasa_2025,
      dhi_promedio_w_m2: (Number(row.ghi_prom_wm2_nasa_2025) || 0) - (Number(row.ghi_prom_wm2_tmy) || 0),
    })) : [];
    const diffGhi = tmy.ghi_anual_kwh_m2 ? ((Number(nasa.ghi_anual_kwh_m2) - Number(tmy.ghi_anual_kwh_m2)) / Number(tmy.ghi_anual_kwh_m2)) * 100 : null;

    return {
      metadata: { fuente: "TMY vs NASA POWER 2025", tipo_dato: "Comparativa", ubicacion: "María Elena / CEME1" },
      kpis: {
        ghi_promedio_diario_kwh_m2_dia: tmy.ghi_anual_kwh_m2 ? Number(tmy.ghi_anual_kwh_m2) / 365 : null,
        dni_promedio_diario_kwh_m2_dia: nasa.ghi_anual_kwh_m2 ? Number(nasa.ghi_anual_kwh_m2) / 365 : null,
        dhi_promedio_diario_kwh_m2_dia: diffGhi,
        ghi_anual_kwh_m2_anio: tmy.ghi_anual_kwh_m2,
        temperatura_media_anual_c: tmy.dni_anual_kwh_m2,
        viento_media_anual_m_s: nasa.dni_anual_kwh_m2,
      },
      mensual,
      perfil_horario: perfil,
      horario: [],
    };
  }

  function solarNumeric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function solarAverage(values) {
    const valid = values.map(solarNumeric).filter((value) => value !== null);
    return valid.length ? valid.reduce((acc, value) => acc + value, 0) / valid.length : null;
  }

  function solarTotal(values) {
    const valid = values.map(solarNumeric).filter((value) => value !== null);
    return valid.length ? valid.reduce((acc, value) => acc + value, 0) : null;
  }

  function normalizeSolarHourlyRowV2(row) {
    return {
      ...row,
      dia_tmy: solarNumeric(pick(row, ["dia_tmy", "dia_anio"])),
      mes: solarNumeric(row.mes),
      mes_corto: row.mes_corto || monthName(row.mes),
      hora: solarNumeric(row.hora),
      hora_label: row.hora_label || `${String(row.hora).padStart(2, "0")}:00`,
      ghi: solarNumeric(pick(row, ["ghi", "ghi_wm2"])),
      dni: solarNumeric(pick(row, ["dni", "dni_wm2"])),
      dhi: solarNumeric(pick(row, ["dhi", "dhi_wm2"])),
      temperatura: solarNumeric(pick(row, ["temperatura", "temperatura_c"])),
      viento: solarNumeric(pick(row, ["viento", "viento_ms"])),
      ghi_kwh_m2_h: solarNumeric(row.ghi_kwh_m2_h),
      dni_kwh_m2_h: solarNumeric(row.dni_kwh_m2_h),
      dhi_kwh_m2_h: solarNumeric(row.dhi_kwh_m2_h),
    };
  }

  function finiteMax(values) {
    const valid = values.map(solarNumeric).filter((value) => value !== null);
    return valid.length ? Math.max(...valid) : null;
  }

  function finiteMin(values) {
    const valid = values.map(solarNumeric).filter((value) => value !== null);
    return valid.length ? Math.min(...valid) : null;
  }

  function buildSolarMonthlyFromHourlyV2(horario) {
    const groups = new Map();
    horario.forEach((row) => {
      const month = solarNumeric(row.mes);
      if (!month) return;
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month).push(row);
    });

    return [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([month, rows]) => {
        const uniqueDays = new Set(rows.map((row) => `${row.mes}-${row.dia || row.dia_tmy || row.fecha_codigo}`).filter(Boolean));
        const dayCount = uniqueDays.size || null;
        const ghiMonth = solarTotal(rows.map((row) => row.ghi_kwh_m2_h));
        const dniMonth = solarTotal(rows.map((row) => row.dni_kwh_m2_h));
        const dhiMonth = solarTotal(rows.map((row) => row.dhi_kwh_m2_h));

        return {
          mes: month,
          mes_corto: rows[0]?.mes_corto || monthName(month),
          ghi_kwh_m2_dia_promedio: dayCount && ghiMonth !== null ? ghiMonth / dayCount : null,
          dni_kwh_m2_dia_promedio: dayCount && dniMonth !== null ? dniMonth / dayCount : null,
          dhi_kwh_m2_dia_promedio: dayCount && dhiMonth !== null ? dhiMonth / dayCount : null,
          ghi_kwh_m2_mes: ghiMonth,
          dni_kwh_m2_mes: dniMonth,
          dhi_kwh_m2_mes: dhiMonth,
          temperatura_media_c: solarAverage(rows.map((row) => row.temperatura)),
          temperatura_max_c: finiteMax(rows.map((row) => row.temperatura)),
          temperatura_min_c: finiteMin(rows.map((row) => row.temperatura)),
          viento_media_m_s: solarAverage(rows.map((row) => row.viento)),
          viento_max_m_s: finiteMax(rows.map((row) => row.viento)),
        };
      });
  }

  function buildSolarProfileFromHourlyV2(horario) {
    const groups = new Map();
    horario.forEach((row) => {
      const hour = solarNumeric(row.hora);
      if (hour === null) return;
      if (!groups.has(hour)) groups.set(hour, []);
      groups.get(hour).push(row);
    });

    return [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([hour, rows]) => ({
        hora: hour,
        hora_label: rows[0]?.hora_label || `${String(hour).padStart(2, "0")}:00`,
        ghi_promedio_w_m2: solarAverage(rows.map((row) => row.ghi)),
        dni_promedio_w_m2: solarAverage(rows.map((row) => row.dni)),
        dhi_promedio_w_m2: solarAverage(rows.map((row) => row.dhi)),
      }));
  }

  function normalizeSolarResourceBundleV2(bundle) {
    const horario = Array.isArray(bundle?.horario)
      ? bundle.horario.map(normalizeSolarHourlyRowV2)
      : [];
    const mensual = Array.isArray(bundle?.mensual) && bundle.mensual.length
      ? bundle.mensual
      : buildSolarMonthlyFromHourlyV2(horario);
    const perfil = Array.isArray(bundle?.perfil_horario) && bundle.perfil_horario.length
      ? bundle.perfil_horario
      : buildSolarProfileFromHourlyV2(horario);
    const kpis = bundle?.kpis || {};

    return {
      metadata: bundle?.metadata || {},
      kpis: {
        ...kpis,
        viento_media_anual_m_s: pick(kpis, ["viento_media_anual_m_s", "viento_media_anual_ms"]),
      },
      mensual,
      perfil_horario: perfil,
      horario,
    };
  }

  function findSolarComparativeKpi(rows, pattern) {
    return Array.isArray(rows)
      ? rows.find((row) => pattern.test(`${row.indicador || ""}`)) || {}
      : {};
  }

  function normalizeCompareSolarBundleV2(bundle, tmyBundle, nasaBundle) {
    const tmy = normalizeSolarResourceBundleV2(tmyBundle || {});
    const nasa = normalizeSolarResourceBundleV2(nasaBundle || {});
    const compareKpis = Array.isArray(bundle?.kpis_comparativos) ? bundle.kpis_comparativos : [];
    const ghiDaily = findSolarComparativeKpi(compareKpis, /ghi.*promedio/i);
    const ghiAnnual = findSolarComparativeKpi(compareKpis, /ghi.*anual/i);
    const dniAnnual = findSolarComparativeKpi(compareKpis, /dni.*anual/i);
    const nasaMonthlyByMonth = new Map(nasa.mensual.map((row) => [Number(row.mes), row]));
    const nasaProfileByHour = new Map(nasa.perfil_horario.map((row) => [Number(row.hora), row]));
    const mensual = tmy.mensual.map((row) => {
      const other = nasaMonthlyByMonth.get(Number(row.mes)) || {};
      const tmyGhi = solarNumeric(row.ghi_kwh_m2_mes);
      const nasaGhi = solarNumeric(other.ghi_kwh_m2_mes);
      return {
        mes: row.mes,
        mes_corto: row.mes_corto,
        ghi_kwh_m2_dia_promedio: row.ghi_kwh_m2_mes,
        dni_kwh_m2_dia_promedio: other.ghi_kwh_m2_mes,
        dhi_kwh_m2_dia_promedio: tmyGhi !== null && nasaGhi !== null ? nasaGhi - tmyGhi : null,
        ghi_kwh_m2_mes: row.ghi_kwh_m2_mes,
        dni_kwh_m2_mes: other.ghi_kwh_m2_mes,
        dhi_kwh_m2_mes: tmyGhi !== null && nasaGhi !== null ? nasaGhi - tmyGhi : null,
        temperatura_media_c: row.temperatura_media_c,
        temperatura_max_c: other.temperatura_media_c,
        temperatura_min_c: row.temperatura_media_c,
        viento_media_m_s: row.viento_media_m_s,
        viento_max_m_s: other.viento_media_m_s,
      };
    });
    const perfil = tmy.perfil_horario.map((row) => {
      const other = nasaProfileByHour.get(Number(row.hora)) || {};
      const tmyGhi = solarNumeric(row.ghi_promedio_w_m2);
      const nasaGhi = solarNumeric(other.ghi_promedio_w_m2);
      return {
        hora: row.hora,
        hora_label: row.hora_label,
        compare_mode: true,
        ghi_promedio_w_m2: row.ghi_promedio_w_m2,
        dni_promedio_w_m2: other.ghi_promedio_w_m2,
        dhi_promedio_w_m2: tmyGhi !== null && nasaGhi !== null ? nasaGhi - tmyGhi : null,
      };
    });

    return {
      metadata: bundle?.metadata || { fuente: "TMY vs NASA POWER 2025", tipo_dato: "Comparativa", ubicacion: "MarÃ­a Elena / CEME1" },
      kpis: {
        ghi_promedio_diario_kwh_m2_dia: ghiDaily.tmy_explorador,
        dni_promedio_diario_kwh_m2_dia: ghiDaily.nasa_power_2025,
        dhi_promedio_diario_kwh_m2_dia: ghiAnnual.delta_pct_nasa_respecto_tmy,
        ghi_anual_kwh_m2_anio: ghiAnnual.tmy_explorador,
        temperatura_media_anual_c: dniAnnual.tmy_explorador,
        viento_media_anual_m_s: dniAnnual.nasa_power_2025,
      },
      mensual,
      perfil_horario: perfil,
      horario: [],
    };
  }

  function renderSolarKpis(kpis) {
    if (!kpis) return;

    setText("solarKpiGhiDaily", formatNumber(kpis.ghi_promedio_diario_kwh_m2_dia, 3));
    setText("solarKpiDniDaily", formatNumber(kpis.dni_promedio_diario_kwh_m2_dia, 3));
    setText("solarKpiDhiDaily", formatNumber(kpis.dhi_promedio_diario_kwh_m2_dia, 3));
    setText("solarKpiGhiAnnual", formatNumber(kpis.ghi_anual_kwh_m2_anio, 0));
    setText("solarKpiTemp", formatNumber(kpis.temperatura_media_anual_c, 1));
    setText("solarKpiWind", formatNumber(kpis.viento_media_anual_m_s, 1));
  }

  function renderSolarMetadata(metadata) {
    if (!metadata) return;

    setText("solarMetaFuente", metadata.fuente || "Explorador Solar");
    setText("solarMetaTipo", metadata.tipo_dato || "TMY");
    setText("solarMetaUbicacion", metadata.ubicacion || "María Elena / CEME1");

    const lat = metadata.latitude !== null && metadata.latitude !== undefined
      ? `${formatNumber(metadata.latitude, 4)}°`
      : "--";

    const lon = metadata.longitude !== null && metadata.longitude !== undefined
      ? `${formatNumber(metadata.longitude, 4)}°`
      : "--";

    const elev = metadata.elevation_m !== null && metadata.elevation_m !== undefined
      ? `${formatNumber(metadata.elevation_m, 0)} m`
      : "--";

    setText("solarMetaLat", lat);
    setText("solarMetaLon", lon);
    setText("solarMetaElev", elev);
  }

  function renderSolarPerfilHorario(perfil) {
    const canvas = byId("solarPerfilHorarioChart");
    if (!canvas || !Array.isArray(perfil)) return;

    const labels = perfil.map((row) => row.hora_label || `${String(row.hora).padStart(2, "0")}:00`);

    solarState.charts.perfilHorario = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset(solarState.currentMode === "compare" ? "GHI TMY Explorador Solar" : "GHI", perfil.map((row) => row.ghi_promedio_w_m2), "#f2c94c"),
          lineDataset(solarState.currentMode === "compare" ? "GHI NASA POWER 2025" : "DNI", perfil.map((row) => row.dni_promedio_w_m2), "#f2994a"),
          lineDataset(solarState.currentMode === "compare" ? "Δ GHI NASA - TMY" : "DHI", perfil.map((row) => row.dhi_promedio_w_m2), "#2d9cdb"),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: {
              color: "#b8cbe3",
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12,
            },
            grid: {
              color: "rgba(140, 170, 210, 0.16)",
            },
          },
          y: {
            title: {
              display: true,
              text: "W/m²",
              color: "#b8cbe3",
            },
            ticks: {
              color: "#b8cbe3",
            },
            grid: {
              color: "rgba(140, 170, 210, 0.16)",
            },
          },
        },
      }),
    });
  }

  function renderSolarMensualPromedio(mensual) {
    const canvas = byId("solarMensualPromedioChart");
    if (!canvas || !Array.isArray(mensual)) return;

    const labels = mensual.map((row) => row.mes_corto);

    solarState.charts.mensualPromedio = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset(solarState.currentMode === "compare" ? "GHI mensual TMY" : "GHI", mensual.map((row) => row.ghi_kwh_m2_dia_promedio), "#f2c94c"),
          lineDataset(solarState.currentMode === "compare" ? "GHI mensual NASA 2025" : "DNI", mensual.map((row) => row.dni_kwh_m2_dia_promedio), "#f2994a"),
          lineDataset(solarState.currentMode === "compare" ? "Δ GHI mensual" : "DHI", mensual.map((row) => row.dhi_kwh_m2_dia_promedio), "#2d9cdb"),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.16)" },
          },
          y: {
            title: {
              display: true,
              text: "kWh/m²/día",
              color: "#b8cbe3",
            },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.16)" },
          },
        },
      }),
    });
  }

  function renderSolarMensualAcumulada(mensual) {
    const canvas = byId("solarMensualAcumuladaChart");
    if (!canvas || !Array.isArray(mensual)) return;

    const labels = mensual.map((row) => row.mes_corto);

    solarState.charts.mensualAcumulada = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          barDataset(solarState.currentMode === "compare" ? "GHI TMY" : "GHI", mensual.map((row) => row.ghi_kwh_m2_mes), "#f2c94c"),
          barDataset(solarState.currentMode === "compare" ? "GHI NASA 2025" : "DNI", mensual.map((row) => row.dni_kwh_m2_mes), "#f2994a"),
          barDataset(solarState.currentMode === "compare" ? "Δ GHI" : "DHI", mensual.map((row) => row.dhi_kwh_m2_mes), "#2d9cdb"),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.12)" },
          },
          y: {
            title: {
              display: true,
              text: "kWh/m²/mes",
              color: "#b8cbe3",
            },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.16)" },
          },
        },
      }),
    });
  }

  function renderSolarTemperatura(mensual) {
    const canvas = byId("solarTemperaturaChart");
    if (!canvas || !Array.isArray(mensual)) return;

    const labels = mensual.map((row) => row.mes_corto);

    solarState.charts.temperatura = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("Temperatura media", mensual.map((row) => row.temperatura_media_c), "#ff6b6b"),
          lineDataset("Temperatura máxima", mensual.map((row) => row.temperatura_max_c), "#ffb3b3"),
          lineDataset("Temperatura mínima", mensual.map((row) => row.temperatura_min_c), "#9ec5ff"),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.16)" },
          },
          y: {
            title: {
              display: true,
              text: "°C",
              color: "#b8cbe3",
            },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.16)" },
          },
        },
      }),
    });
  }

  function renderSolarViento(mensual) {
    const canvas = byId("solarVientoChart");
    if (!canvas || !Array.isArray(mensual)) return;

    const labels = mensual.map((row) => row.mes_corto);

    solarState.charts.viento = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          barDataset("Velocidad media", mensual.map((row) => row.viento_media_m_s), "#4ade80"),
          lineDataset("Velocidad máxima", mensual.map((row) => row.viento_max_m_s), "#e5e7eb"),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.12)" },
          },
          y: {
            title: {
              display: true,
              text: "m/s",
              color: "#b8cbe3",
            },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.16)" },
          },
        },
      }),
    });
  }

  function colorForGhi(value, maxValue) {
    if (!value || value <= 0) return "rgba(4, 13, 27, 0.95)";

    const ratio = Math.max(0, Math.min(1, value / maxValue));

    const r = Math.round(25 + ratio * 230);
    const g = Math.round(70 + ratio * 170);
    const b = Math.round(120 - ratio * 80);

    return `rgb(${r}, ${g}, ${b})`;
  }

  function renderSolarHeatmap(horario) {
    const canvas = byId("solarHeatmapGhi");
    if (!canvas || !Array.isArray(horario)) return;

    const ctx = canvas.getContext("2d");
    const parent = canvas.parentElement;

    const cssWidth = parent.clientWidth || 600;
    const cssHeight = parent.clientHeight || 280;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const margin = {
      left: 44,
      right: 18,
      top: 18,
      bottom: 30,
    };

    const plotW = cssWidth - margin.left - margin.right;
    const plotH = cssHeight - margin.top - margin.bottom;

    const maxGhi = Math.max(...horario.map((row) => Number(row.ghi) || 0), 1);

    const cellW = plotW / 365;
    const cellH = plotH / 24;

    horario.forEach((row) => {
      const day = Number(row.dia_tmy);
      const hour = Number(row.hora);
      const ghi = Number(row.ghi) || 0;

      if (!day || hour < 0 || hour > 23) return;

      const x = margin.left + (day - 1) * cellW;
      const y = margin.top + (23 - hour) * cellH;

      ctx.fillStyle = colorForGhi(ghi, maxGhi);
      ctx.fillRect(x, y, Math.max(cellW + 0.5, 1), Math.max(cellH + 0.5, 1));
    });

    ctx.strokeStyle = "rgba(184, 203, 227, 0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);

    ctx.fillStyle = "#b8cbe3";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";

    const monthTicks = [
      { d: 15, label: "Ene" },
      { d: 46, label: "Feb" },
      { d: 74, label: "Mar" },
      { d: 105, label: "Abr" },
      { d: 135, label: "May" },
      { d: 166, label: "Jun" },
      { d: 196, label: "Jul" },
      { d: 227, label: "Ago" },
      { d: 258, label: "Sep" },
      { d: 288, label: "Oct" },
      { d: 319, label: "Nov" },
      { d: 349, label: "Dic" },
    ];

    monthTicks.forEach((tick) => {
      const x = margin.left + (tick.d - 1) * cellW;
      ctx.fillText(tick.label, x, cssHeight - 10);
    });

    ctx.textAlign = "right";

    [0, 6, 12, 18, 23].forEach((hour) => {
      const y = margin.top + (23 - hour) * cellH + 4;
      ctx.fillText(String(hour).padStart(2, "0"), margin.left - 8, y);
    });

    ctx.save();
    ctx.translate(13, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("Hora del día", 0, 0);
    ctx.restore();

    ctx.textAlign = "left";
    ctx.fillText(`GHI máx.: ${formatNumber(maxGhi, 0)} W/m²`, margin.left, 12);
  }

  async function renderSolarView(mode = solarState.currentMode) {
    solarState.currentMode = SOLAR_DATA_URLS[mode] ? mode : "tmy";
    setSolarHeader(solarState.currentMode);
    const rawBundle = await loadSolarBundle(solarState.currentMode);

    if (!rawBundle) {
      console.warn("No hay datos solares disponibles para renderizar.");
      return;
    }

    let bundle;
    if (solarState.currentMode === "compare") {
      const [tmyBundle, nasaBundle] = await Promise.all([
        loadSolarBundle("tmy"),
        loadSolarBundle("nasa"),
      ]);
      bundle = normalizeCompareSolarBundleV2(rawBundle, tmyBundle, nasaBundle);
    } else {
      bundle = normalizeSolarResourceBundleV2(rawBundle);
    }

    solarState.renderedBundle = bundle;

    renderSolarKpis(bundle.kpis);
    renderSolarMetadata(bundle.metadata);

    destroySolarCharts();
    if (typeof Chart === "undefined") {
      console.error("Chart.js no esta cargado.");
      return;
    }

    renderSolarPerfilHorario(bundle.perfil_horario);
    renderSolarMensualPromedio(bundle.mensual);
    renderSolarMensualAcumulada(bundle.mensual);
    renderSolarTemperatura(bundle.mensual);
    renderSolarViento(bundle.mensual);

    setTimeout(() => {
      renderSolarHeatmap(bundle.horario);
    }, 50);
  }

  function showDashboardView(viewName) {
    const target = byId(`view-${viewName}`);

    if (!target) {
      console.warn(`La vista '${viewName}' aún no está implementada.`);
      return;
    }

    document.querySelectorAll(".dashboard-view").forEach((view) => {
      view.classList.remove("active");
    });

    target.classList.add("active");

    document.querySelectorAll(".side-nav a[data-view]").forEach((link) => {
      link.classList.toggle("active", link.dataset.view === viewName);
    });

    document.querySelector(".top-controls")?.classList.toggle("hidden", viewName !== "general");

    if (viewName === "solar") {
      renderSolarView();
    }

    if (viewName === "simulacion") {
      const simulationView = byId("view-simulacion");
      const activeButton = simulationView?.querySelector(".plant-tab-btn.active[data-plant-panel]");
      const activePanel = activeButton?.dataset.plantPanel || "energia";

      if (activePanel === "energia") {
        window.renderPlantEnergyView?.(activeButton?.dataset.plantEnergyMode || "tmy");
      }

    }

    if (viewName === "sam-cen") {
      window.renderSamCenView?.();
    }

    if (viewName === "reportes") {
      window.renderReportesView?.();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setupDashboardNavigation() {
    document.querySelectorAll(".side-nav a[data-view]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();

        const viewName = link.dataset.view;

        if (!byId(`view-${viewName}`)) {
          console.warn(`Vista no disponible todavía: ${viewName}`);
          return;
        }

        showDashboardView(viewName);
      });
    });
  }

  function setupSolarResizeHandler() {
    let resizeTimer = null;

    window.addEventListener("resize", () => {
      const solarView = byId("view-solar");

      if (!solarView || !solarView.classList.contains("active")) {
        return;
      }

      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(() => {
        const bundle = solarState.renderedBundle;
        if (bundle && Array.isArray(bundle.horario)) {
          renderSolarHeatmap(bundle.horario);
        }
      }, 200);
    });
  }

  function setupSolarModeTabs() {
    document.querySelectorAll(".solar-mode-btn[data-solar-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        renderSolarView(button.dataset.solarMode || "tmy");
      });
    });
  }

  function initSolarModule() {
    setupDashboardNavigation();
    setupSolarModeTabs();
    setupSolarResizeHandler();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSolarModule);
  } else {
    initSolarModule();
  }
})();












/* ============================================================
   DESEMPEÑO ENERGÉTICO PLANTA FV (SAM)
   ============================================================ */
(function () {
  const PLANT_ENERGY_SOURCES = {
    tmy: {
      url: "data/validacion_fv_ceme1_dashboard_bundle.json",
      fallback: "data/validacion_fv_ceme1_dashboard_lite.json",
      type: "single",
      kicker: "RESULTADOS SAM — TMY",
      title: "Desempeño energético anual equivalente",
      status: "TMY DATOS OK",
      metaLabel: "TMY Explorador Solar de Chile",
    },
    nasa: {
      url: "data/validacion_fv_ceme1_dashboard_bundle.json",
      fallback: "data/validacion_fv_ceme1_dashboard_lite.json",
      type: "single",
      kicker: "RESULTADOS SAM — NASA POWER 2025",
      title: "Desempeño energético anual equivalente · serie 2025",
      status: "NASA DATOS OK",
      metaLabel: "NASA POWER serie 2025",
    },
    compare: {
      url: "data/validacion_fv_ceme1_dashboard_bundle.json",
      fallback: "data/validacion_fv_ceme1_dashboard_lite.json",
      type: "compare",
      kicker: "COMPARATIVA SAM — TMY VS NASA 2025",
      title: "Comparativa energética anual y horaria",
      status: "COMPARATIVA OK",
      metaLabel: "TMY Explorador Solar de Chile vs NASA POWER serie 2025",
    },
  };

  const plantEnergyState = {
    bundles: {},
    currentMode: "tmy",
    renderedMode: null,
    charts: {},
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function formatNumber(value, decimals = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "--";
    }

    return Number(value).toLocaleString("es-CL", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function formatInteger(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "--";
    }

    return Number(value).toLocaleString("es-CL", {
      maximumFractionDigits: 0,
    });
  }

  function asPercent(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "--";
    }

    const number = Number(value);
    return formatNumber(number <= 1.5 ? number * 100 : number, 1);
  }

  function getCssColor(variableName, fallback) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(variableName)
      .trim();

    return value || fallback;
  }

  function destroyPlantCharts() {
    Object.values(plantEnergyState.charts).forEach((chart) => {
      if (chart && typeof chart.destroy === "function") {
        chart.destroy();
      }
    });

    plantEnergyState.charts = {};
  }

  function chartBaseOptions(extra = {}) {
    const tickColor = "#b8cbe3";
    const gridColor = "rgba(140, 170, 210, 0.14)";

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          labels: {
            color: tickColor,
            boxWidth: 14,
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: "rgba(3, 18, 34, 0.96)",
          titleColor: "#ffffff",
          bodyColor: "#d7e8ff",
          borderColor: "rgba(91, 141, 196, 0.45)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: { color: tickColor },
          grid: { color: gridColor },
        },
        y: {
          ticks: { color: tickColor },
          grid: { color: gridColor },
        },
      },
      ...extra,
    };
  }

  function lineDataset(label, data, color, yAxisID = "y") {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 4,
      tension: 0.28,
      fill: false,
      yAxisID,
    };
  }

  function barDataset(label, data, color, yAxisID = "y") {
    return {
      label,
      data,
      backgroundColor: `${color}cc`,
      borderColor: color,
      borderWidth: 1,
      borderRadius: 4,
      yAxisID,
    };
  }

  function normalizePlantEnergyMode(mode) {
    return PLANT_ENERGY_SOURCES[mode] ? mode : plantEnergyState.currentMode || "tmy";
  }

  function setPlantEnergyStatus(text, isError = false) {
    const statusEl = byId("plantEnergyStatus");
    if (statusEl) statusEl.classList.toggle("error", isError);
    setText("plantEnergyStatus", text);
  }

  function setPlantEnergyHeader(source, bundle = null) {
    setText("plantEnergyKicker", source.kicker);
    setText("plantEnergyTitle", source.title);

    const metadata = bundle?.metadata || bundle?.kpis || {};
    const tool = metadata.herramienta || "SAM";
    const resolution = metadata.resolucion || metadata.resolucion_temporal || "horaria";
    setText("plantEnergyMeta", `${tool} · ${source.metaLabel} · ${resolution}`);
  }

  function setActiveEnergyModeButton(mode) {
    document.querySelectorAll(".plant-energy-mode-btn[data-plant-energy-mode]").forEach((button) => {
      const isActive = button.dataset.plantEnergyMode === mode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function plantNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function plantSum(rows, key) {
    const values = (Array.isArray(rows) ? rows : []).map((row) => plantNumber(row[key])).filter((value) => value !== null);
    return values.length ? values.reduce((acc, value) => acc + value, 0) : null;
  }

  function weightedAverage(rows, valueKey, weightKey) {
    const valid = (Array.isArray(rows) ? rows : [])
      .map((row) => ({ value: plantNumber(row[valueKey]), weight: plantNumber(row[weightKey]) }))
      .filter((row) => row.value !== null && row.weight !== null && row.weight > 0);
    const weightTotal = valid.reduce((acc, row) => acc + row.weight, 0);
    return weightTotal ? valid.reduce((acc, row) => acc + row.value * row.weight, 0) / weightTotal : null;
  }

  function findValidationSamCase(raw, mode) {
    const pattern = mode === "tmy" ? /tmy/i : /nasa|2025/i;
    return (Array.isArray(raw?.sam_resumen_casos) ? raw.sam_resumen_casos : [])
      .find((row) => pattern.test(`${row.caso_sam || ""} ${row.nombre_caso || ""} ${row.fuente_meteorologica || ""}`)) || {};
  }

  function filterValidationSubmodels(raw, mode) {
    const pattern = mode === "tmy" ? /tmy/i : /nasa|2025/i;
    return (Array.isArray(raw?.sam_submodelos) ? raw.sam_submodelos : [])
      .filter((row) => pattern.test(`${row.caso_sam || ""} ${row.nombre_caso || ""} ${row.fuente_meteorologica || ""}`));
  }

  function filterValidationProfile(raw, mode) {
    const source = mode === "tmy"
      ? raw?.perfil_este_oeste_sam_tmy
      : raw?.perfil_este_oeste_sam_nasa_2025;
    const rows = Array.isArray(source) && source.length
      ? source
      : (Array.isArray(raw?.perfil_este_oeste_sam) ? raw.perfil_este_oeste_sam : []);
    const pattern = mode === "tmy" ? /tmy/i : /nasa|2025/i;
    return rows
      .filter((row) => pattern.test(`${row.caso_sam || ""} ${row.nombre_caso || ""} ${row.fuente_meteorologica || ""}`))
      .sort((a, b) => Number(a.hora) - Number(b.hora));
  }

  function buildPlantKpisFromValidation(raw, mode, submodels) {
    const summary = findValidationSamCase(raw, mode);
    const energy = plantNumber(summary.energia_ac_neta_gwh);
    return {
      energia_ac_neta_gwh_anio: energy,
      energia_dc_gwh_anio: plantNumber(summary.energia_dc_gwh),
      potencia_ac_nominal_mwac: null,
      potencia_dc_nominal_mwp: plantSum(submodels, "potencia_dc_mwp"),
      potencia_ac_maxima_mw: plantNumber(summary.potencia_ac_max_mw),
      factor_planta_ac_pct: weightedAverage(submodels, "sam_single_capacity_factor_ac_pct", "energia_ac_neta_gwh"),
      performance_ratio_ponderado: weightedAverage(submodels, "sam_single_performance_ratio", "energia_ac_neta_gwh"),
      poa_este_anual_kwh_m2: null,
      poa_oeste_anual_kwh_m2: null,
      ghi_anual_kwh_m2: plantNumber(summary.ghi_anual_kwh_m2),
      dni_anual_kwh_m2: plantNumber(summary.dni_anual_kwh_m2),
      dhi_anual_kwh_m2: plantNumber(summary.dhi_anual_kwh_m2),
    };
  }

  function buildPlantMonthlyFromValidation(raw, mode) {
    const key = mode === "tmy" ? "sam_tmy_gwh" : "sam_nasa_2025_gwh";
    return (Array.isArray(raw?.mensual) ? raw.mensual : []).map((row) => ({
      mes: row.mes,
      mes_nombre: row.mes_nombre || row.mes,
      energia_ac_neta_gwh: plantNumber(row[key]),
      energia_dc_gwh: null,
      poa_este_kwh_m2: null,
      poa_oeste_kwh_m2: null,
    }));
  }

  function buildPlantHourlyFromValidation(raw, mode) {
    return filterValidationProfile(raw, mode).map((row) => ({
      hora: row.hora,
      hora_label: `${String(row.hora).padStart(2, "0")}:00`,
      potencia_ac_prom_mw: plantNumber(row.total_mwh),
      potencia_dc_prom_mw: null,
    }));
  }

  function buildPlantBalanceFromSubmodels(submodels) {
    const map = new Map();
    (Array.isArray(submodels) ? submodels : []).forEach((row) => {
      const orientation = row.orientacion || "Sin orientacion";
      map.set(orientation, (map.get(orientation) || 0) + (Number(row.energia_ac_neta_gwh) || 0));
    });
    return [...map.entries()].map(([orientacion, energia_ac_neta_gwh]) => ({ orientacion, energia_ac_neta_gwh }));
  }

  function buildSinglePlantBundleFromValidation(raw, mode) {
    const submodels = filterValidationSubmodels(raw, mode);
    const source = PLANT_ENERGY_SOURCES[mode];
    return {
      metadata: { herramienta: "SAM", resolucion_temporal: "horaria", fuente: source.metaLabel },
      kpis: buildPlantKpisFromValidation(raw, mode, submodels),
      mensual: buildPlantMonthlyFromValidation(raw, mode),
      perfil_horario: buildPlantHourlyFromValidation(raw, mode),
      submodelos: submodels,
      balance_orientacion: buildPlantBalanceFromSubmodels(submodels),
    };
  }

  function buildComparePlantBundleFromValidation(raw) {
    const tmy = buildSinglePlantBundleFromValidation(raw, "tmy");
    const nasa = buildSinglePlantBundleFromValidation(raw, "nasa");
    const nasaByMonth = new Map(nasa.mensual.map((row) => [Number(row.mes), row]));
    const nasaByHour = new Map(nasa.perfil_horario.map((row) => [Number(row.hora), row]));
    const nasaSubmodelsById = new Map(nasa.submodelos.map((row) => [row.submodelo, row]));
    const metrics = ["energia_ac_neta_gwh_anio", "factor_planta_ac_pct", "performance_ratio_ponderado", "ghi_anual_kwh_m2", "dni_anual_kwh_m2", "dhi_anual_kwh_m2"];

    return {
      metadata: { herramienta: "SAM", resolucion_temporal: "horaria", fuente: "TMY Explorador Solar vs NASA POWER 2025" },
      kpis: [
        { caso: "SAM_TMY", fuente_meteorologica: "SAM TMY Explorador Solar", ...tmy.kpis },
        { caso: "SAM_NASA_2025", fuente_meteorologica: "SAM NASA 2025", ...nasa.kpis },
      ],
      comparativa_kpis: metrics.map((metric) => {
        const tmyValue = plantNumber(tmy.kpis[metric]);
        const nasaValue = plantNumber(nasa.kpis[metric]);
        return {
          metrica: metric,
          tmy: tmyValue,
          nasa_2025: nasaValue,
          delta_nasa_menos_tmy: tmyValue !== null && nasaValue !== null ? nasaValue - tmyValue : null,
          delta_pct_respecto_tmy: tmyValue !== null && nasaValue !== null && tmyValue !== 0 ? ((nasaValue - tmyValue) / tmyValue) * 100 : null,
        };
      }),
      mensual: tmy.mensual.map((row) => {
        const other = nasaByMonth.get(Number(row.mes)) || {};
        return {
          mes: row.mes,
          mes_nombre: row.mes_nombre,
          energia_ac_neta_gwh_tmy: row.energia_ac_neta_gwh,
          energia_ac_neta_gwh_nasa_2025: other.energia_ac_neta_gwh,
          energia_dc_gwh_tmy: row.energia_dc_gwh,
          energia_dc_gwh_nasa_2025: other.energia_dc_gwh,
          poa_este_kwh_m2_tmy: row.poa_este_kwh_m2,
          poa_este_kwh_m2_nasa_2025: other.poa_este_kwh_m2,
          poa_oeste_kwh_m2_tmy: row.poa_oeste_kwh_m2,
          poa_oeste_kwh_m2_nasa_2025: other.poa_oeste_kwh_m2,
        };
      }),
      perfil_horario: tmy.perfil_horario.map((row) => {
        const other = nasaByHour.get(Number(row.hora)) || {};
        return {
          hora: row.hora,
          hora_label: row.hora_label,
          potencia_ac_prom_mw_tmy: row.potencia_ac_prom_mw,
          potencia_ac_prom_mw_nasa_2025: other.potencia_ac_prom_mw,
          potencia_dc_prom_mw_tmy: row.potencia_dc_prom_mw,
          potencia_dc_prom_mw_nasa_2025: other.potencia_dc_prom_mw,
        };
      }),
      submodelos: tmy.submodelos.map((row) => {
        const other = nasaSubmodelsById.get(row.submodelo) || {};
        return {
          ...row,
          energia_ac_neta_gwh_tmy: row.energia_ac_neta_gwh,
          energia_ac_neta_gwh_nasa_2025: other.energia_ac_neta_gwh,
        };
      }),
      balance_orientacion: [
        ...tmy.balance_orientacion.map((row) => ({ caso: "SAM_TMY", ...row })),
        ...nasa.balance_orientacion.map((row) => ({ caso: "SAM_NASA_2025", ...row })),
      ],
    };
  }

  function normalizePlantBundle(raw, mode) {
    if (!raw?.sam_resumen_casos) return raw;
    return mode === "compare"
      ? buildComparePlantBundleFromValidation(raw)
      : buildSinglePlantBundleFromValidation(raw, mode);
  }

  async function loadPlantBundle(mode) {
    const source = PLANT_ENERGY_SOURCES[mode];
    if (!source) return null;

    if (plantEnergyState.bundles[mode]) {
      return plantEnergyState.bundles[mode];
    }

    try {
      const rawBundle = await loadJsonWithFallback(source.url, source.fallback);
      const bundle = normalizePlantBundle(rawBundle, mode);
      plantEnergyState.bundles[mode] = bundle;

      return bundle;
    } catch (error) {
      console.error(`No se pudo cargar el bundle Planta FV SAM (${source.url}):`, error);
      return null;
    }
  }

  function renderPlantEnergyKpis(kpis) {
    if (!kpis) return;

    setPlantKpiLabels([
      { title: "ENERGIA AC NETA ANUAL", unit: " GWh/anio", subtitle: "Egrid neta SAM" },
      { title: "ENERGIA DC ANUAL", unit: " GWh/anio", subtitle: "Entrada DC equivalente" },
      { title: "POTENCIA AC NOMINAL", unit: " MWac", subtitle: "Inversores modelados" },
      { title: "POTENCIA DC NOMINAL", unit: " MWp", subtitle: "Campo FV equivalente" },
      { title: "POTENCIA AC MAXIMA SIMULADA", unit: " MW", subtitle: "Maximo horario TMY" },
      { title: "FACTOR DE PLANTA AC", unit: " %", subtitle: "Sobre potencia AC" },
      { title: "PERFORMANCE RATIO", unit: " %", subtitle: "PR ponderado" },
      { title: "POA ESTE / OESTE ANUAL", subtitle: "kWh/m2/anio" },
      { title: "GHI ANUAL", unit: " kWh/m2/anio", subtitle: "Global horizontal TMY" },
      { title: "DNI ANUAL", unit: " kWh/m2/anio", subtitle: "Directa normal TMY" },
    ]);

    setText("plantKpiAcNetAnnual", formatNumber(kpis.energia_ac_neta_gwh_anio, 1));
    setText("plantKpiDcAnnual", formatNumber(kpis.energia_dc_gwh_anio, 1));
    setText("plantKpiAcNominal", formatNumber(kpis.potencia_ac_nominal_mwac, 1));
    setText("plantKpiDcNominal", formatNumber(kpis.potencia_dc_nominal_mwp, 1));
    setText("plantKpiAcMax", formatNumber(kpis.potencia_ac_maxima_mw, 1));
    setText("plantKpiCapacityFactor", formatNumber(kpis.factor_planta_ac_pct, 1));
    setText("plantKpiPerformanceRatio", asPercent(kpis.performance_ratio_ponderado));
    setText("plantKpiPoaEast", formatInteger(kpis.poa_este_anual_kwh_m2));
    setText("plantKpiPoaWest", formatInteger(kpis.poa_oeste_anual_kwh_m2));
    setText("plantKpiGhiAnnual", formatInteger(kpis.ghi_anual_kwh_m2));
    setText("plantKpiDniAnnual", formatInteger(kpis.dni_anual_kwh_m2));
    setText("plantKpiGhiSub", "Global horizontal TMY");
    setText("plantKpiDniSub", "Directa normal TMY");
  }

  function findCompareCase(kpis, pattern, fallbackIndex) {
    if (!Array.isArray(kpis)) return {};

    return kpis.find((row) => pattern.test(`${row.caso || ""} ${row.fuente_meteorologica || ""}`))
      || kpis[fallbackIndex]
      || {};
  }

  function formatPair(left, right, decimals = 1) {
    return `${formatNumber(left, decimals)} / ${formatNumber(right, decimals)}`;
  }

  function formatIntegerPair(left, right) {
    return `${formatInteger(left)} / ${formatInteger(right)}`;
  }

  function formatPercentPair(left, right) {
    return `${asPercent(left)} / ${asPercent(right)}`;
  }

  function setPlantKpiLabels(labels) {
    const cards = document.querySelectorAll("#plant-panel-energia .plant-energy-kpi");
    labels.forEach((item, index) => {
      const card = cards[index];
      if (!card) return;
      const title = card.querySelector("p");
      const subtitle = card.querySelector(":scope > small");
      const unit = card.querySelector("h3 small");
      if (title && item.title) title.textContent = item.title;
      if (unit && Object.prototype.hasOwnProperty.call(item, "unit")) unit.textContent = item.unit;
      if (subtitle && item.subtitle) subtitle.textContent = item.subtitle;
    });
  }

  function renderPlantCompareKpis(kpis) {
    const tmy = findCompareCase(kpis, /tmy/i, 0);
    const nasa = findCompareCase(kpis, /nasa/i, 1);
    const diff = tmy.energia_ac_neta_gwh_anio
      ? ((Number(nasa.energia_ac_neta_gwh_anio) - Number(tmy.energia_ac_neta_gwh_anio)) / Number(tmy.energia_ac_neta_gwh_anio)) * 100
      : null;

    setPlantKpiLabels([
      { title: "ENERGIA AC NETA TMY", unit: " GWh/anio", subtitle: "GWh/anio" },
      { title: "ENERGIA AC NETA NASA 2025", unit: " GWh/anio", subtitle: "GWh/anio" },
      { title: "DIFERENCIA AC", unit: " %", subtitle: "NASA - TMY" },
      { title: "FACTOR DE PLANTA TMY / NASA", unit: " %", subtitle: "%" },
      { title: "PERFORMANCE RATIO TMY / NASA", unit: " %", subtitle: "%" },
      { title: "GHI ANUAL TMY / NASA", unit: " kWh/m2/anio", subtitle: "kWh/m2/anio" },
      { title: "DNI ANUAL TMY / NASA", unit: " kWh/m2/anio", subtitle: "kWh/m2/anio" },
      { title: "POA ESTE / OESTE TMY", subtitle: "kWh/m2/anio" },
      { title: "POA ESTE / OESTE NASA", unit: " kWh/m2/anio", subtitle: "kWh/m2/anio" },
      { title: "DHI ANUAL TMY / NASA", unit: " kWh/m2/anio", subtitle: "kWh/m2/anio" },
    ]);

    setText("plantKpiAcNetAnnual", formatNumber(tmy.energia_ac_neta_gwh_anio, 1));
    setText("plantKpiDcAnnual", formatNumber(nasa.energia_ac_neta_gwh_anio, 1));
    setText("plantKpiAcNominal", formatNumber(diff, 1));
    setText("plantKpiDcNominal", formatPair(tmy.factor_planta_ac_pct, nasa.factor_planta_ac_pct, 1));
    setText("plantKpiAcMax", formatPercentPair(tmy.performance_ratio_ponderado, nasa.performance_ratio_ponderado));
    setText("plantKpiCapacityFactor", formatIntegerPair(tmy.ghi_anual_kwh_m2, nasa.ghi_anual_kwh_m2));
    setText("plantKpiPerformanceRatio", formatIntegerPair(tmy.dni_anual_kwh_m2, nasa.dni_anual_kwh_m2));
    setText("plantKpiPoaEast", formatInteger(tmy.poa_este_anual_kwh_m2));
    setText("plantKpiPoaWest", formatInteger(tmy.poa_oeste_anual_kwh_m2));
    setText("plantKpiGhiAnnual", formatIntegerPair(nasa.poa_este_anual_kwh_m2, nasa.poa_oeste_anual_kwh_m2));
    setText("plantKpiDniAnnual", formatIntegerPair(tmy.dhi_anual_kwh_m2, nasa.dhi_anual_kwh_m2));
    setText("plantKpiGhiSub", "Este / Oeste NASA 2025");
    setText("plantKpiDniSub", "Difusa horizontal TMY / NASA");
  }

  function setCompareDetailsVisible(visible) {
    const details = byId("plantCompareDetails");
    if (details) details.hidden = !visible;
    const samNote = byId("plantSamMethodNote");
    if (samNote) samNote.hidden = visible;
  }

  function metricLabel(metric) {
    return {
      energia_ac_neta_gwh_anio: "Energía AC neta",
      factor_planta_ac_pct: "Factor de planta",
      performance_ratio_ponderado: "Performance Ratio",
      ghi_anual_kwh_m2: "GHI anual",
      dni_anual_kwh_m2: "DNI anual",
      dhi_anual_kwh_m2: "DHI anual",
      poa_este_anual_kwh_m2: "POA Este",
      poa_oeste_anual_kwh_m2: "POA Oeste",
    }[metric] || metric;
  }

  function renderPlantCompareDiffTable(rows) {
    const tbody = byId("plantCompareDiffBody");
    if (!tbody) return;
    const order = [
      "energia_ac_neta_gwh_anio",
      "factor_planta_ac_pct",
      "performance_ratio_ponderado",
      "ghi_anual_kwh_m2",
      "dni_anual_kwh_m2",
      "dhi_anual_kwh_m2",
      "poa_este_anual_kwh_m2",
      "poa_oeste_anual_kwh_m2",
    ];
    const map = new Map((Array.isArray(rows) ? rows : []).map((row) => [row.metrica, row]));
    tbody.innerHTML = order.map((metric) => {
      const row = map.get(metric) || {};
      const isPp = metric === "factor_planta_ac_pct" || metric === "performance_ratio_ponderado";
      const delta = isPp ? row.delta_nasa_menos_tmy : row.delta_pct_respecto_tmy;
      const unit = isPp ? "pp" : "%";
      const decimals = metric === "performance_ratio_ponderado" ? 3 : 1;
      return `<tr><td>${metricLabel(metric)}</td><td>${formatNumber(row.tmy, decimals)}</td><td>${formatNumber(row.nasa_2025, decimals)}</td><td>${delta === undefined || delta === null ? "--" : `${formatNumber(delta, 1)} ${unit}`}</td></tr>`;
    }).join("");
  }

  function renderPlantCompareSubmodelTable(rows) {
    const tbody = byId("plantCompareSubmodelBody");
    if (!tbody) return;
    tbody.innerHTML = (Array.isArray(rows) ? rows : []).map((row) => {
      const potenciaDcMwp = (Number(row.strings) || 0) * (Number(row.modulos_por_string) || 0) * (Number(row.modulo_wp) || 0) / 1_000_000;
      return `<tr><td>${row.submodelo || "--"}</td><td>${row.orientacion || "--"}</td><td>${row.modulo_wp || "--"} Wp</td><td>${formatInteger(row.strings)}</td><td>${formatInteger(row.inversores)}</td><td>${formatNumber(potenciaDcMwp, 1)} MWp</td><td>${formatNumber(row.energia_ac_neta_gwh_tmy, 1)} GWh</td><td>${formatNumber(row.energia_ac_neta_gwh_nasa_2025, 1)} GWh</td></tr>`;
    }).join("");
  }

  function verifySubmodelTotals(bundle) {
    const submodelos = Array.isArray(bundle.submodelos) ? bundle.submodelos : [];
    const tmy = findCompareCase(bundle.kpis, /tmy/i, 0);
    const nasa = findCompareCase(bundle.kpis, /nasa/i, 1);
    const sumTmy = submodelos.reduce((acc, row) => acc + (Number(row.energia_ac_neta_gwh_tmy) || 0), 0);
    const sumNasa = submodelos.reduce((acc, row) => acc + (Number(row.energia_ac_neta_gwh_nasa_2025) || 0), 0);
    if (Math.abs(sumTmy - (Number(tmy.energia_ac_neta_gwh_anio) || 0)) > 0.2) {
      console.warn("[Planta FV] La suma SC01-SC06 TMY no coincide con la energía total TMY.", { sumTmy, total: tmy.energia_ac_neta_gwh_anio });
    }
    if (Math.abs(sumNasa - (Number(nasa.energia_ac_neta_gwh_anio) || 0)) > 0.2) {
      console.warn("[Planta FV] La suma SC01-SC06 NASA no coincide con la energía total NASA 2025.", { sumNasa, total: nasa.energia_ac_neta_gwh_anio });
    }
  }

  function renderPlantMonthlyEnergy(mensual) {
    const canvas = byId("plantMonthlyEnergyChart");
    if (!canvas || !Array.isArray(mensual)) return;

    const blue = getCssColor("--blue", "#2689ff");
    const green = getCssColor("--green", "#76ff45");
    const labels = mensual.map((row) => row.mes_nombre || row.mes_corto || row.mes);

    plantEnergyState.charts.monthlyEnergy = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          barDataset("AC neta", mensual.map((row) => row.energia_ac_neta_gwh), green),
          barDataset("DC", mensual.map((row) => row.energia_dc_gwh), blue),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "GWh", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
          },
        },
      }),
    });
  }

  function renderPlantHourlyProfile(perfil) {
    const canvas = byId("plantHourlyProfileChart");
    if (!canvas || !Array.isArray(perfil)) return;

    const cyan = getCssColor("--cyan", "#31b7ff");
    const yellow = getCssColor("--yellow", "#ffd21f");
    const labels = perfil.map((row) => row.hora_label || `${String(row.hora).padStart(2, "0")}:00`);

    plantEnergyState.charts.hourlyProfile = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("AC promedio", perfil.map((row) => row.potencia_ac_prom_mw), cyan),
          lineDataset("DC promedio", perfil.map((row) => row.potencia_dc_prom_mw), yellow),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3", maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "MW", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
          },
        },
      }),
    });
  }

  function renderPlantPoaOrientation(mensual) {
    const canvas = byId("plantPoaOrientationChart");
    if (!canvas || !Array.isArray(mensual)) return;

    const green = getCssColor("--green", "#76ff45");
    const orange = getCssColor("--orange", "#ff8a00");
    const labels = mensual.map((row) => row.mes_nombre || row.mes_corto || row.mes);

    plantEnergyState.charts.poaOrientation = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("POA Este", mensual.map((row) => row.poa_este_kwh_m2), green),
          lineDataset("POA Oeste", mensual.map((row) => row.poa_oeste_kwh_m2), orange),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "kWh/m²", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
            beginAtZero: true,
          },
        },
      }),
    });
  }

  function renderPlantSubmodelEnergy(submodelos) {
    const canvas = byId("plantSubmodelEnergyChart");
    if (!canvas || !Array.isArray(submodelos)) return;

    const green = getCssColor("--green", "#76ff45");
    const orange = getCssColor("--orange", "#ff8a00");
    const labels = submodelos.map((row) => row.submodelo);
    const colors = submodelos.map((row) => row.orientacion === "Oeste" ? `${orange}cc` : `${green}cc`);

    plantEnergyState.charts.submodelEnergy = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            ...barDataset("AC neta", submodelos.map((row) => row.energia_ac_neta_gwh), green),
            backgroundColor: colors,
            borderColor: colors,
          },
        ],
      },
      options: chartBaseOptions({
        plugins: {
          ...chartBaseOptions().plugins,
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "GWh", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
          },
        },
      }),
    });
  }

  function renderPlantOrientationBalance(balance) {
    const canvas = byId("plantOrientationBalanceChart");
    if (!canvas || !Array.isArray(balance)) return;

    const green = getCssColor("--green", "#76ff45");
    const orange = getCssColor("--orange", "#ff8a00");

    plantEnergyState.charts.orientationBalance = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: balance.map((row) => row.orientacion),
        datasets: [
          {
            label: "Energía AC neta",
            data: balance.map((row) => row.energia_ac_neta_gwh),
            backgroundColor: [`${green}cc`, `${orange}cc`],
            borderColor: [green, orange],
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: "#b8cbe3",
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: "rgba(3, 18, 34, 0.96)",
            titleColor: "#ffffff",
            bodyColor: "#d7e8ff",
            callbacks: {
              label: (context) => `${context.label}: ${formatNumber(context.raw, 1)} GWh`,
            },
          },
        },
      },
    });
  }

  function renderPlantCompareMonthly(mensual) {
    const canvas = byId("plantMonthlyEnergyChart");
    if (!canvas || !Array.isArray(mensual)) return;

    const blue = getCssColor("--blue", "#2689ff");
    const cyan = getCssColor("--cyan", "#31b7ff");
    const green = getCssColor("--green", "#76ff45");
    const yellow = getCssColor("--yellow", "#ffd21f");
    const labels = mensual.map((row) => row.mes_nombre || row.mes_corto || row.mes);

    plantEnergyState.charts.monthlyEnergy = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          barDataset("AC TMY", mensual.map((row) => row.energia_ac_neta_gwh_tmy), green),
          barDataset("AC NASA 2025", mensual.map((row) => row.energia_ac_neta_gwh_nasa_2025), cyan),
          barDataset("DC TMY", mensual.map((row) => row.energia_dc_gwh_tmy), yellow),
          barDataset("DC NASA 2025", mensual.map((row) => row.energia_dc_gwh_nasa_2025), blue),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "GWh", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
          },
        },
      }),
    });
  }

  function renderPlantCompareHourly(perfil) {
    const canvas = byId("plantHourlyProfileChart");
    if (!canvas || !Array.isArray(perfil)) return;

    const blue = getCssColor("--blue", "#2689ff");
    const cyan = getCssColor("--cyan", "#31b7ff");
    const green = getCssColor("--green", "#76ff45");
    const yellow = getCssColor("--yellow", "#ffd21f");
    const labels = perfil.map((row) => row.hora_label || `${String(row.hora).padStart(2, "0")}:00`);

    plantEnergyState.charts.hourlyProfile = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("AC TMY", perfil.map((row) => row.potencia_ac_prom_mw_tmy), cyan),
          { ...lineDataset("AC NASA 2025", perfil.map((row) => row.potencia_ac_prom_mw_nasa_2025), green), borderDash: [6, 4] },
          lineDataset("DC TMY", perfil.map((row) => row.potencia_dc_prom_mw_tmy), yellow),
          { ...lineDataset("DC NASA 2025", perfil.map((row) => row.potencia_dc_prom_mw_nasa_2025), blue), borderDash: [6, 4] },
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3", maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "MW", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
          },
        },
      }),
    });
  }

  function renderPlantComparePoa(mensual) {
    const canvas = byId("plantPoaOrientationChart");
    if (!canvas || !Array.isArray(mensual)) return;

    const green = getCssColor("--green", "#76ff45");
    const orange = getCssColor("--orange", "#ff8a00");
    const cyan = getCssColor("--cyan", "#31b7ff");
    const purple = getCssColor("--purple", "#b46cff");
    const labels = mensual.map((row) => row.mes_nombre || row.mes_corto || row.mes);

    plantEnergyState.charts.poaOrientation = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("Este TMY", mensual.map((row) => row.poa_este_kwh_m2_tmy), green),
          { ...lineDataset("Este NASA 2025", mensual.map((row) => row.poa_este_kwh_m2_nasa_2025), cyan), borderDash: [6, 4] },
          lineDataset("Oeste TMY", mensual.map((row) => row.poa_oeste_kwh_m2_tmy), orange),
          { ...lineDataset("Oeste NASA 2025", mensual.map((row) => row.poa_oeste_kwh_m2_nasa_2025), purple), borderDash: [6, 4] },
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "kWh/m²", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
            beginAtZero: true,
          },
        },
      }),
    });
  }

  function renderPlantCompareSubmodel(submodelos) {
    const canvas = byId("plantSubmodelEnergyChart");
    if (!canvas || !Array.isArray(submodelos)) return;

    const green = getCssColor("--green", "#76ff45");
    const blue = getCssColor("--blue", "#2689ff");
    const labels = submodelos.map((row) => row.submodelo);

    plantEnergyState.charts.submodelEnergy = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          barDataset("AC TMY", submodelos.map((row) => row.energia_ac_neta_gwh_tmy), green),
          barDataset("AC NASA 2025", submodelos.map((row) => row.energia_ac_neta_gwh_nasa_2025), blue),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "GWh", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
          },
        },
      }),
    });
  }

  function findBalanceValue(balance, casePattern, orientationPattern) {
    const row = Array.isArray(balance)
      ? balance.find((item) => casePattern.test(`${item.caso || ""}`) && orientationPattern.test(`${item.orientacion || ""}`))
      : null;

    return row?.energia_ac_neta_gwh ?? null;
  }

  function renderPlantCompareBalance(balance) {
    const canvas = byId("plantOrientationBalanceChart");
    if (!canvas || !Array.isArray(balance)) return;

    const green = getCssColor("--green", "#76ff45");
    const blue = getCssColor("--blue", "#2689ff");

    plantEnergyState.charts.orientationBalance = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Este", "Oeste"],
        datasets: [
          barDataset("TMY", [
            findBalanceValue(balance, /tmy/i, /este/i),
            findBalanceValue(balance, /tmy/i, /oeste/i),
          ], green),
          barDataset("NASA 2025", [
            findBalanceValue(balance, /nasa/i, /este/i),
            findBalanceValue(balance, /nasa/i, /oeste/i),
          ], blue),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "GWh", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
          },
        },
      }),
    });
  }

  function renderSinglePlantEnergyBundle(bundle) {
    setCompareDetailsVisible(false);
    renderPlantEnergyKpis(bundle.kpis);
    renderPlantMonthlyEnergy(bundle.mensual);
    renderPlantHourlyProfile(bundle.perfil_horario);
    renderPlantPoaOrientation(bundle.mensual);
    renderPlantSubmodelEnergy(bundle.submodelos);
    renderPlantOrientationBalance(bundle.balance_orientacion);
  }

  function renderComparePlantEnergyBundle(bundle) {
    setCompareDetailsVisible(true);
    renderPlantCompareKpis(bundle.kpis);
    renderPlantCompareDiffTable(bundle.comparativa_kpis);
    renderPlantCompareMonthly(bundle.mensual);
    renderPlantCompareHourly(bundle.perfil_horario);
    renderPlantComparePoa(bundle.mensual);
    renderPlantCompareSubmodel(bundle.submodelos);
    renderPlantCompareSubmodelTable(bundle.submodelos);
    renderPlantCompareBalance(bundle.balance_orientacion);
    verifySubmodelTotals(bundle);
  }

  async function renderPlantEnergyView(mode) {
    const nextMode = normalizePlantEnergyMode(mode);
    const source = PLANT_ENERGY_SOURCES[nextMode];
    plantEnergyState.currentMode = nextMode;
    setActiveEnergyModeButton(nextMode);

    if (plantEnergyState.renderedMode === nextMode && Object.keys(plantEnergyState.charts).length) {
      return;
    }

    setPlantEnergyHeader(source);
    setPlantEnergyStatus("CARGANDO");
    const bundle = await loadPlantBundle(nextMode);

    if (plantEnergyState.currentMode !== nextMode) return;

    if (!bundle) {
      destroyPlantCharts();
      plantEnergyState.renderedMode = null;
      setPlantEnergyStatus("ERROR DATOS", true);
      setText("plantEnergyMeta", `No se pudo cargar ${source.url}`);
      return;
    }

    setPlantEnergyHeader(source, bundle);
    setPlantEnergyStatus(source.status);
    destroyPlantCharts();
    if (typeof Chart === "undefined") {
      console.error("Chart.js no esta cargado.");
      return;
    }

    if (source.type === "compare") {
      renderComparePlantEnergyBundle(bundle);
    } else {
      renderSinglePlantEnergyBundle(bundle);
    }

    plantEnergyState.renderedMode = nextMode;
  }

  window.renderPlantEnergyView = renderPlantEnergyView;
  window.getActivePlantEnergyMode = () => plantEnergyState.currentMode;
})();


/* ============================================================
   SAM VS CEN 2025
   ============================================================ */
(function () {
  const SAM_CEN_DATA_URLS = {
    validationBundle: "data/validacion_fv_ceme1_dashboard_bundle.json",
    validationLite: "data/validacion_fv_ceme1_dashboard_lite.json",
  };

  const samCenState = {
    bundle: null,
    loaded: false,
    rendered: false,
    charts: {},
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function formatNumber(value, decimals = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "--";
    }

    return Number(value).toLocaleString("es-CL", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function getCssColor(variableName, fallback) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(variableName)
      .trim();

    return value || fallback;
  }

  function setSamCenStatus(text, isError = false) {
    const statusEl = byId("samCenStatus");
    if (statusEl) statusEl.classList.toggle("error", isError);
    setText("samCenStatus", text);
  }

  function destroySamCenCharts() {
    Object.values(samCenState.charts).forEach((chart) => {
      if (chart && typeof chart.destroy === "function") {
        chart.destroy();
      }
    });

    samCenState.charts = {};
  }

  function chartBaseOptions(extra = {}) {
    const tickColor = "#b8cbe3";
    const gridColor = "rgba(140, 170, 210, 0.14)";

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          labels: {
            color: tickColor,
            boxWidth: 14,
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: "rgba(3, 18, 34, 0.96)",
          titleColor: "#ffffff",
          bodyColor: "#d7e8ff",
          borderColor: "rgba(91, 141, 196, 0.45)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: { color: tickColor },
          grid: { color: gridColor },
        },
        y: {
          ticks: { color: tickColor },
          grid: { color: gridColor },
        },
      },
      ...extra,
    };
  }

  function barDataset(label, data, color, yAxisID = "y") {
    return {
      label,
      data,
      backgroundColor: `${color}cc`,
      borderColor: color,
      borderWidth: 1,
      borderRadius: 4,
      yAxisID,
    };
  }

  function lineDataset(label, data, color, yAxisID = "y") {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 4,
      tension: 0.28,
      fill: false,
      yAxisID,
    };
  }

  async function loadSamCenBundle() {
    if (samCenState.loaded && samCenState.bundle) {
      return samCenState.bundle;
    }

    try {
      const rawBundle = await loadJsonWithFallback(SAM_CEN_DATA_URLS.validationBundle, SAM_CEN_DATA_URLS.validationLite);
      const bundle = normalizeValidationSamCenBundle(rawBundle);
      bundle.__sourceUrl = SAM_CEN_DATA_URLS.validationBundle;
      samCenState.bundle = bundle;
      samCenState.loaded = true;
      return bundle;
    } catch (error) {
      console.warn(`No se pudo cargar ${SAM_CEN_DATA_URLS.validationBundle}:`, error);
    }

    console.error("No se pudo cargar SAM vs CEN 2025 desde ningÃºn JSON disponible.");
    return null;
  }

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function readKpi(kpis, keys) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(kpis || {}, key)) {
        const value = numberOrNull(kpis[key]);
        if (value !== null) return value;
      }
    }
    return null;
  }

  function normalizeValidationMetricRows(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const comparison = row.comparacion || row.nombre || "";
      const caseName = /tmy/i.test(comparison)
        ? "SAM_TMY"
        : /pron|centralizado/i.test(comparison)
          ? "PRONOSTICO_CENTRALIZADO_CEN"
          : "SAM_NASA_2025";
      const reference = /real/i.test(comparison)
        ? "CEN inyeccion real"
        : /pron|centralizado/i.test(comparison) && !/^pron/i.test(comparison)
          ? "Pronostico centralizado CEN"
          : "CEN disponible = inyeccion + curtailment";

      return {
        ...row,
        caso_sam: row.caso_sam || caseName,
        fuente_meteorologica: row.fuente_meteorologica || comparison,
        referencia: row.referencia || reference,
        filtro: row.filtro || row.normalizacion_nrmse || "todas_las_horas",
        mbe: row.mbe ?? row.mbe_mwh,
        mae: row.mae ?? row.mae_mwh,
        rmse: row.rmse ?? row.rmse_mwh,
        corr_pearson: row.corr_pearson ?? row.correlacion_r ?? row.r,
        delta_pct: row.delta_pct ?? row.sesgo_anual_pct,
      };
    });
  }

  function normalizeValidationSamCenBundle(raw) {
    const kpis = raw?.kpis || {};
    const samNasa = readKpi(kpis, ["energia_sam_nasa_2025_gwh", "sam_nasa_2025_gwh"]);
    const samTmy = readKpi(kpis, ["energia_sam_tmy_explorador_solar_gwh", "energia_sam_tmy_gwh", "sam_tmy_gwh"]);
    const centralizado = readKpi(kpis, ["energia_pronostico_centralizado_cen_gwh", "pronostico_centralizado_cen_gwh"]);
    const disponible = readKpi(kpis, ["energia_cen_disponible_gwh", "cen_disponible_gwh"]);
    const real = readKpi(kpis, ["energia_generacion_real_cen_gwh", "generacion_real_cen_gwh"]);
    const reducciones = readKpi(kpis, ["energia_reducciones_cen_gwh", "reducciones_cen_gwh"]);
    const factor = readKpi(kpis, ["factor_reducciones_cen_pct", "factor_curtailment_pct"]);
    const delta1 = readKpi(kpis, ["delta_1_sam_centralizado_gwh", "delta_e1_gwh"]) ?? (samNasa !== null && centralizado !== null ? samNasa - centralizado : null);
    const delta2 = readKpi(kpis, ["delta_2_centralizado_disponible_gwh", "delta_e2_gwh"]) ?? (centralizado !== null && disponible !== null ? centralizado - disponible : null);
    const delta3 = readKpi(kpis, ["delta_3_reducciones_gwh", "delta_e3_gwh"]) ?? (disponible !== null && real !== null ? disponible - real : reducciones);
    const residuoDisponible = readKpi(kpis, ["residuo_sam_nasa_vs_cen_disponible_gwh", "residuo_sam_nasa_2025_menos_cen_disponible_gwh"]) ?? (samNasa !== null && disponible !== null ? samNasa - disponible : null);
    const residuoTotal = readKpi(kpis, ["residuo_total_sam_nasa_generacion_real_gwh", "residuo_total_sam_real_gwh"]) ?? (samNasa !== null && real !== null ? samNasa - real : null);
    const mensual = Array.isArray(raw?.mensual) ? raw.mensual : [];
    const indicadores = normalizeValidationMetricRows(raw?.metricas || raw?.indicadores);

    return {
      metadata: { ...(raw?.metadata || {}), planta: raw?.metadata?.planta || "CEME1", anio: raw?.metadata?.anio || "2025", comparacion: raw?.metadata?.descripcion || "SAM NASA 2025 vs CEN" },
      cen_kpis: {
        energia_inyectada_cen_gwh: real,
        energia_curtailment_cen_gwh: reducciones ?? delta3,
        energia_disponible_cen_gwh: disponible,
        energia_pronostico_centralizado_cen_gwh: centralizado,
        factor_curtailment_anual_pct: factor,
        delta_1_sam_centralizado_gwh: delta1,
        delta_2_centralizado_disponible_gwh: delta2,
        delta_3_reducciones_gwh: delta3,
        residuo_sam_nasa_cen_disponible_gwh: residuoDisponible,
        residuo_total_sam_nasa_generacion_real_gwh: residuoTotal,
      },
      sam_kpis: [
        { caso_sam: "SAM_TMY", fuente_meteorologica: "SAM TMY Explorador Solar", energia_ac_neta_gwh: samTmy },
        { caso_sam: "SAM_NASA_2025", fuente_meteorologica: "SAM NASA 2025", energia_ac_neta_gwh: samNasa },
      ],
      resumen_anual: [
        { caso_sam: "SAM_TMY", fuente_meteorologica: "SAM TMY Explorador Solar", sam_ac_gwh: samTmy, cen_disponible_gwh: disponible, cen_inyeccion_gwh: real, cen_curtailment_gwh: reducciones, sam_menos_cen_disponible_gwh: samTmy !== null && disponible !== null ? samTmy - disponible : null },
        { caso_sam: "SAM_NASA_2025", fuente_meteorologica: "SAM NASA 2025", sam_ac_gwh: samNasa, cen_disponible_gwh: disponible, cen_inyeccion_gwh: real, cen_curtailment_gwh: reducciones, sam_menos_cen_disponible_gwh: residuoDisponible },
      ],
      indicadores,
      mensual: mensual.flatMap((row) => {
        const month = row.mes_nombre || row.mes;
        const base = {
          mes: row.mes,
          mes_nombre: month,
          cen_inyeccion_gwh: row.energia_generacion_real_cen_gwh ?? row.generacion_real_cen_gwh,
          cen_curtailment_gwh: row.energia_reducciones_cen_gwh ?? row.reducciones_cen_gwh,
          cen_disponible_gwh: row.energia_cen_disponible_gwh ?? row.cen_disponible_gwh,
          pronostico_centralizado_cen_gwh: row.energia_pronostico_centralizado_cen_gwh ?? row.pronostico_centralizado_cen_gwh,
          delta_1_sam_centralizado_gwh: row.delta_1_sam_centralizado_gwh,
          delta_2_centralizado_disponible_gwh: row.delta_2_centralizado_disponible_gwh,
          delta_3_reducciones_gwh: row.delta_3_reducciones_gwh,
        };
        return [
          {
            ...base,
            caso_sam: "SAM_TMY",
            fuente_meteorologica: "SAM TMY Explorador Solar",
            sam_e_ac_gwh: row.energia_sam_tmy_explorador_solar_gwh ?? row.sam_tmy_gwh,
            residuo_sam_menos_cen_disp_gwh: numberOrNull(row.sam_tmy_gwh) !== null && numberOrNull(base.cen_disponible_gwh) !== null ? numberOrNull(row.sam_tmy_gwh) - numberOrNull(base.cen_disponible_gwh) : null,
          },
          {
            ...base,
            caso_sam: "SAM_NASA_2025",
            fuente_meteorologica: "SAM NASA 2025",
            sam_e_ac_gwh: row.energia_sam_nasa_2025_gwh ?? row.sam_nasa_2025_gwh,
            residuo_sam_menos_cen_disp_gwh: row.residuo_sam_nasa_cen_disponible_gwh ?? (numberOrNull(row.sam_nasa_2025_gwh) !== null && numberOrNull(base.cen_disponible_gwh) !== null ? numberOrNull(row.sam_nasa_2025_gwh) - numberOrNull(base.cen_disponible_gwh) : null),
          },
        ];
      }),
      perfil_horario: [],
    };
  }

  function findSamCase(rows, pattern) {
    return Array.isArray(rows)
      ? rows.find((row) => pattern.test(`${row.caso_sam || ""} ${row.fuente_meteorologica || ""}`)) || {}
      : {};
  }

  function splitByCase(rows) {
    return {
      tmy: Array.isArray(rows) ? rows.filter((row) => /tmy/i.test(`${row.caso_sam || ""}`)) : [],
      nasa: Array.isArray(rows) ? rows.filter((row) => /nasa/i.test(`${row.caso_sam || ""}`)) : [],
    };
  }

  function renderSamCenKpis(bundle) {
    const cen = bundle.cen_kpis || {};
    const samTmy = findSamCase(bundle.sam_kpis, /tmy/i);
    const samNasa = findSamCase(bundle.sam_kpis, /nasa/i);
    const summaryTmy = findSamCase(bundle.resumen_anual, /tmy/i);
    const summaryNasa = findSamCase(bundle.resumen_anual, /nasa/i);
    const centralizado = cen.energia_pronostico_centralizado_cen_gwh;
    const delta1 = cen.delta_1_sam_centralizado_gwh ?? (
      Number.isFinite(Number(samNasa.energia_ac_neta_gwh)) && Number.isFinite(Number(centralizado))
        ? Number(samNasa.energia_ac_neta_gwh) - Number(centralizado)
        : null
    );
    const delta2 = cen.delta_2_centralizado_disponible_gwh ?? (
      Number.isFinite(Number(centralizado)) && Number.isFinite(Number(cen.energia_disponible_cen_gwh))
        ? Number(centralizado) - Number(cen.energia_disponible_cen_gwh)
        : null
    );
    const delta3 = cen.delta_3_reducciones_gwh ?? (
      Number.isFinite(Number(cen.energia_disponible_cen_gwh)) && Number.isFinite(Number(cen.energia_inyectada_cen_gwh))
        ? Number(cen.energia_disponible_cen_gwh) - Number(cen.energia_inyectada_cen_gwh)
        : cen.energia_curtailment_cen_gwh
    );

    setText("samCenKpiInjection", formatNumber(cen.energia_inyectada_cen_gwh, 1));
    setText("samCenKpiCurtailment", formatNumber(cen.energia_curtailment_cen_gwh, 1));
    setText("samCenKpiAvailable", formatNumber(cen.energia_disponible_cen_gwh, 1));
    setText("samCenKpiCurtailmentFactor", formatNumber(cen.factor_curtailment_anual_pct, 1));
    setText("samCenKpiTmyAnnual", formatNumber(centralizado, 1));
    setText("samCenKpiNasaAnnual", formatNumber(samNasa.energia_ac_neta_gwh, 1));
    setText("samCenKpiTmyDelta", formatNumber(delta1, 1));
    setText("samCenKpiTmyDeltaPct", "SAM NASA 2025 - Pronóstico centralizado CEN");
    setText("samCenKpiNasaDelta", formatNumber(delta2, 1));
    setText("samCenKpiNasaDeltaPct", "Pronóstico centralizado CEN - CEN disponible");
    setText("samCenKpiDelta3", formatNumber(delta3, 1));
  }

  function renderSamCenHeader(bundle) {
    setText("samCenHeaderPlant", bundle.metadata?.planta || "CEME1");
    setText("samCenHeaderYear", bundle.metadata?.anio || "2025");
    setText("samCenHeaderBus", "MIRAJE_220");
  }

  function renderSamCenFlow(bundle) {
    const cen = bundle.cen_kpis || {};
    const samTmy = findSamCase(bundle.sam_kpis, /tmy/i);
    const samNasa = findSamCase(bundle.sam_kpis, /nasa/i);

    setText("samCenFlowTmy", formatNumber(samTmy.energia_ac_neta_gwh, 1));
    setText("samCenFlowNasa", formatNumber(samNasa.energia_ac_neta_gwh, 1));
    setText("samCenFlowAvailable", formatNumber(cen.energia_disponible_cen_gwh, 1));
    setText("samCenFlowInjection", formatNumber(cen.energia_inyectada_cen_gwh, 1));
    setText("samCenFlowCurtailment", formatNumber(cen.energia_curtailment_cen_gwh, 1));
  }

  function findTechnicalIndicator(indicators, pattern) {
    if (!Array.isArray(indicators)) return {};

    return indicators.find((row) =>
      pattern.test(`${row.caso_sam || ""}`) &&
      row.referencia === "CEN disponible = inyeccion + curtailment" &&
      row.filtro === "todas_las_horas"
    ) || indicators.find((row) =>
      pattern.test(`${row.caso_sam || ""}`) &&
      row.referencia === "CEN disponible = inyeccion + curtailment"
    ) || {};
  }

  function getNrmseState(nrmse) {
    const value = Number(nrmse);
    if (!Number.isFinite(value)) return { className: "state-unknown", label: "--" };
    if (value < 15) return { className: "state-ok", label: "OK" };
    if (value <= 25) return { className: "state-warn", label: "ADVERTENCIA" };
    return { className: "state-alarm", label: "ALTO RESIDUO" };
  }

  function updateInstrument(prefix, cardId, row) {
    const state = getNrmseState(row.nrmse_pct);
    const card = byId(cardId);
    if (card) {
      card.classList.remove("state-ok", "state-warn", "state-alarm", "state-unknown", "best");
      card.classList.add(state.className);
    }

    setText(`${prefix}Semaphore`, state.label);
    setText(`${prefix}Nrmse`, formatNumber(row.nrmse_pct, 1));
    setText(`${prefix}Rmse`, formatNumber(row.rmse, 1));
    setText(`${prefix}Mbe`, formatNumber(row.mbe, 1));
    setText(`${prefix}Mae`, formatNumber(row.mae, 1));
    setText(`${prefix}Corr`, formatNumber(row.corr_pearson, 3));
    setText(`${prefix}Delta`, `${formatNumber(row.delta_pct, 1)} %`);
  }

  function renderSamCenInstruments(indicators) {
    const tmy = findTechnicalIndicator(indicators, /tmy/i);
    const nasa = findTechnicalIndicator(indicators, /nasa/i);
    const nasaBetter = Number(nasa.nrmse_pct) < Number(tmy.nrmse_pct) &&
      Number(nasa.rmse) < Number(tmy.rmse) &&
      Math.abs(Number(nasa.mbe)) < Math.abs(Number(tmy.mbe));

    updateInstrument("samCenTmy", "samCenTmyInstrument", tmy);
    updateInstrument("samCenNasa", "samCenNasaInstrument", nasa);

    setText("samCenTmyBadge", "SAM TMY EXPLORADOR SOLAR");
    setText("samCenNasaBadge", nasaBetter ? "MEJOR AJUSTE SAM NASA 2025" : "SAM NASA 2025");

    const nasaCard = byId("samCenNasaInstrument");
    const tmyCard = byId("samCenTmyInstrument");
    if (nasaCard) nasaCard.classList.toggle("best", nasaBetter);
    if (tmyCard) tmyCard.classList.toggle("best", !nasaBetter);
  }

  function appendIndicatorRow(tbody, row) {
    const tr = document.createElement("tr");
    tr.classList.add(getNrmseState(row.nrmse_pct).className);
    [
      displaySamCase(row.caso_sam, row.fuente_meteorologica),
      displayReference(row.referencia),
      row.filtro,
      formatNumber(row.mbe, 2),
      formatNumber(row.mae, 2),
      formatNumber(row.rmse, 2),
      `${formatNumber(row.nrmse_pct, 1)} %`,
      formatNumber(row.corr_pearson, 3),
      `${formatNumber(row.delta_pct, 1)} %`,
    ].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value || "--";
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  }

  function renderSamCenIndicators(indicators) {
    const technicalBody = byId("samCenTechnicalTableBody");
    const operationalBody = byId("samCenOperationalTableBody");
    if (!technicalBody || !operationalBody) return;

    technicalBody.replaceChildren();
    operationalBody.replaceChildren();

    (Array.isArray(indicators) ? indicators : []).forEach((row) => {
      if (row.referencia === "CEN disponible = inyeccion + curtailment") {
        appendIndicatorRow(technicalBody, row);
      }

      if (row.referencia === "CEN inyeccion real") {
        appendIndicatorRow(operationalBody, row);
      }
    });
  }

  function renderSamCenAnnualChart(bundle) {
    const canvas = byId("samCenAnnualChart");
    if (!canvas) return;

    const cen = bundle.cen_kpis || {};
    const samTmy = findSamCase(bundle.sam_kpis, /tmy/i);
    const samNasa = findSamCase(bundle.sam_kpis, /nasa/i);
    const cyan = getCssColor("--cyan", "#31b7ff");
    const green = getCssColor("--green", "#76ff45");
    const blue = getCssColor("--blue", "#2689ff");
    const yellow = getCssColor("--yellow", "#ffd21f");

    samCenState.charts.annual = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Generación real CEN", "CEN disponible", "SAM TMY Explorador Solar", "SAM NASA 2025"],
        datasets: [{
          label: "Energía anual",
          data: [
            cen.energia_inyectada_cen_gwh,
            cen.energia_disponible_cen_gwh,
            samTmy.energia_ac_neta_gwh,
            samNasa.energia_ac_neta_gwh,
          ],
          backgroundColor: [`${cyan}cc`, `${yellow}cc`, `${green}cc`, `${blue}cc`],
          borderColor: [cyan, yellow, green, blue],
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: chartBaseOptions({
        plugins: {
          ...chartBaseOptions().plugins,
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "GWh", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
          },
        },
      }),
    });
  }

  function renderSamCenMonthlyChart(mensual) {
    const canvas = byId("samCenMonthlyChart");
    if (!canvas || !Array.isArray(mensual)) return;

    const { tmy, nasa } = splitByCase(mensual);
    const baseRows = nasa.length ? nasa : tmy;
    const labels = baseRows.map((row) => row.mes_nombre || row.mes);
    const cyan = getCssColor("--cyan", "#31b7ff");
    const yellow = getCssColor("--yellow", "#ffd21f");
    const green = getCssColor("--green", "#76ff45");
    const blue = getCssColor("--blue", "#2689ff");
    const orange = getCssColor("--orange", "#ff8a00");
    const purple = getCssColor("--purple", "#b46cff");

    samCenState.charts.monthly = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { ...lineDataset("SAM NASA 2025", baseRows.map((row) => row.sam_e_ac_gwh), blue), type: "line" },
          { ...lineDataset("Pronóstico centralizado CEN", baseRows.map((row) => row.pronostico_centralizado_cen_gwh), purple), type: "line" },
          { ...lineDataset("CEN disponible", baseRows.map((row) => row.cen_disponible_gwh), yellow), type: "line" },
          { ...lineDataset("Generación real CEN", baseRows.map((row) => row.cen_inyeccion_gwh), cyan), type: "line" },
          barDataset("Reducciones CEN (curtailment)", baseRows.map((row) => row.cen_curtailment_gwh), orange),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
            stacked: false,
          },
          y: {
            title: { display: true, text: "GWh", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
            stacked: false,
          },
        },
      }),
    });
  }

  function renderSamCenResidualChart(mensual) {
    const canvas = byId("samCenResidualChart");
    if (!canvas || !Array.isArray(mensual)) return;

    const { tmy, nasa } = splitByCase(mensual);
    const labels = tmy.map((row) => row.mes_nombre || row.mes);
    const green = getCssColor("--green", "#76ff45");
    const blue = getCssColor("--blue", "#2689ff");

    samCenState.charts.residual = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          barDataset("Residuo SAM TMY Explorador Solar − CEN disponible", tmy.map((row) => row.residuo_sam_menos_cen_disp_gwh), green),
          barDataset("Residuo SAM NASA 2025 − CEN disponible", nasa.map((row) => row.residuo_sam_menos_cen_disp_gwh), blue),
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "GWh", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
          },
        },
      }),
    });
  }

  function renderSamCenHourlyChart(perfil) {
    const canvas = byId("samCenHourlyChart");
    if (!canvas || !Array.isArray(perfil)) return;

    const { tmy, nasa } = splitByCase(perfil);
    const labels = tmy.map((row) => row.hora_label || `${String(row.hora).padStart(2, "0")}:00`);
    const cyan = getCssColor("--cyan", "#31b7ff");
    const yellow = getCssColor("--yellow", "#ffd21f");
    const green = getCssColor("--green", "#76ff45");
    const blue = getCssColor("--blue", "#2689ff");

    samCenState.charts.hourly = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("Generación real CEN", tmy.map((row) => row.cen_inyeccion_prom_mwh), cyan),
          lineDataset("CEN disponible", tmy.map((row) => row.cen_disponible_prom_mwh), yellow),
          lineDataset("SAM TMY Explorador Solar", tmy.map((row) => row.sam_e_ac_prom_mwh), green),
          { ...lineDataset("SAM NASA 2025", nasa.map((row) => row.sam_e_ac_prom_mwh), blue), borderDash: [6, 4] },
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3", maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "MWh promedio", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
          },
        },
      }),
    });
  }

  function renderSamCenCurtPriceChart(perfil) {
    const canvas = byId("samCenCurtPriceChart");
    if (!canvas || !Array.isArray(perfil)) return;

    const { tmy } = splitByCase(perfil);
    const labels = tmy.map((row) => row.hora_label || `${String(row.hora).padStart(2, "0")}:00`);
    const orange = getCssColor("--orange", "#ff8a00");
    const purple = getCssColor("--purple", "#b46cff");

    samCenState.charts.curtPrice = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          barDataset("Reducciones CEN (curtailment)", tmy.map((row) => row.cen_curtailment_prom_mwh), orange, "y"),
          { ...lineDataset("Precio promedio", tmy.map((row) => row.precio_prom_usd_mwh), purple, "y1"), type: "line" },
        ],
      },
      options: chartBaseOptions({
        scales: {
          x: {
            ticks: { color: "#b8cbe3", maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            grid: { color: "rgba(140, 170, 210, 0.1)" },
          },
          y: {
            title: { display: true, text: "MWh promedio", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { color: "rgba(140, 170, 210, 0.14)" },
          },
          y1: {
            position: "right",
            title: { display: true, text: "USD/MWh", color: "#b8cbe3" },
            ticks: { color: "#b8cbe3" },
            grid: { drawOnChartArea: false },
          },
        },
      }),
    });
  }

  window.renderSamCenView = async function renderSamCenView() {
    if (samCenState.rendered && Object.keys(samCenState.charts).length) return;

    setSamCenStatus("CARGANDO");
    setText("samCenMeta", "Cargando data/validacion_fv_ceme1_dashboard_bundle.json...");
    const bundle = await loadSamCenBundle();

    if (!bundle) {
      destroySamCenCharts();
      samCenState.rendered = false;
      setSamCenStatus("ERROR DATOS", true);
      setText("samCenMeta", "No se pudo cargar validacion_fv_ceme1_dashboard_bundle.json ni los bundles de respaldo");
      return;
    }

    setSamCenStatus("DATA OK");
    setText(
      "samCenMeta",
      `${bundle.metadata?.planta || "CEME1"} · ${displayComparison(bundle.metadata?.comparacion)} · ${bundle.metadata?.anio || "2025"} · ${bundle.__sourceUrl || "dashboard/data"}`
    );

    renderSamCenHeader(bundle);
    renderSamCenFlow(bundle);
    renderSamCenKpis(bundle);
    renderSamCenInstruments(bundle.indicadores);
    renderSamCenIndicators(bundle.indicadores);
    destroySamCenCharts();
    renderSamCenAnnualChart(bundle);
    renderSamCenMonthlyChart(bundle.mensual);
    renderSamCenResidualChart(bundle.mensual);
    renderSamCenHourlyChart(bundle.perfil_horario);
    renderSamCenCurtPriceChart(bundle.perfil_horario);

    samCenState.rendered = true;
  };
})();


/* ============================================================
   REPORTE BLOQUE 1 + EXPORTACIÓN PDF
   ============================================================ */
(function () {
  const REPORT_DATA_URLS = {
    validationBundle: "data/validacion_fv_ceme1_dashboard_bundle.json",
    validationLite: "data/validacion_fv_ceme1_dashboard_lite.json",
    profileBundle: "data/perfil_este_oeste_sam_dashboard_bundle.json",
    profileLite: "data/perfil_este_oeste_sam_dashboard_lite.json",
    tmy: "data/validacion_fv_ceme1_dashboard_bundle.json",
    nasa: "data/validacion_fv_ceme1_dashboard_bundle.json",
    compare: "data/validacion_fv_ceme1_dashboard_bundle.json",
    samCen: "data/validacion_fv_ceme1_dashboard_bundle.json",
  };

  const reportState = {
    loaded: false,
    bundles: null,
    monthlyChart: null,
    waterfallChart: null,
    profileChart: null,
    rendering: false,
  };
  const PDF_EXPORT_WIDTH_PX = 740;

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function formatNumber(value, decimals = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
    return Number(value).toLocaleString("es-CL", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function formatAvailable(value, decimals = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "Dato no disponible";
    return formatNumber(value, decimals);
  }

  function formatInteger(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
    return Number(value).toLocaleString("es-CL", { maximumFractionDigits: 0 });
  }

  function formatDateTime(date = new Date()) {
    return date.toLocaleString("es-CL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function findCase(rows, pattern) {
    return Array.isArray(rows)
      ? rows.find((row) => pattern.test(`${row.caso || ""} ${row.caso_sam || ""} ${row.fuente_meteorologica || ""}`)) || {}
      : {};
  }

  function normalizeKey(key) {
    return String(key || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function getField(obj, candidates) {
    if (!obj || typeof obj !== "object") return undefined;
    const direct = candidates.find((key) => Object.prototype.hasOwnProperty.call(obj, key));
    if (direct) return obj[direct];

    const normalized = new Map(Object.keys(obj).map((key) => [normalizeKey(key), key]));
    const match = candidates
      .map(normalizeKey)
      .map((key) => normalized.get(key))
      .find(Boolean);

    return match ? obj[match] : undefined;
  }

  function findFieldByTokens(obj, tokenGroups) {
    if (!obj || typeof obj !== "object") return undefined;
    const keys = Object.keys(obj);
    const found = keys.find((key) => {
      const normalized = normalizeKey(key);
      return tokenGroups.every((group) => group.some((token) => normalized.includes(normalizeKey(token))));
    });
    return found ? obj[found] : undefined;
  }

  function readNumber(obj, candidates, tokenGroups = []) {
    let value = getField(obj, candidates);
    if (value === undefined && tokenGroups.length) value = findFieldByTokens(obj, tokenGroups);
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function readEnergyGwh(obj, candidates, tokenGroups = []) {
    let value;
    let sourceKey = candidates.find((key) => Object.prototype.hasOwnProperty.call(obj || {}, key));

    if (sourceKey) {
      value = obj[sourceKey];
    } else if (obj && typeof obj === "object") {
      const normalized = new Map(Object.keys(obj).map((key) => [normalizeKey(key), key]));
      const normalizedKey = candidates.map(normalizeKey).map((key) => normalized.get(key)).find(Boolean);
      sourceKey = normalizedKey;
      value = normalizedKey ? obj[normalizedKey] : undefined;
    }

    if (value === undefined && tokenGroups.length && obj && typeof obj === "object") {
      sourceKey = Object.keys(obj).find((key) => {
        const normalized = normalizeKey(key);
        return tokenGroups.every((group) => group.some((token) => normalized.includes(normalizeKey(token))));
      });
      value = sourceKey ? obj[sourceKey] : undefined;
    }

    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return /(^|_)mwh($|_)/i.test(normalizeKey(sourceKey)) ? number / 1000 : number;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      return Object.entries(value).map(([key, row]) =>
        row && typeof row === "object" ? { nombre: key, comparacion: key, ...row } : { nombre: key, valor: row }
      );
    }
    return [];
  }

  function addRows(tbodyId, rows) {
    const tbody = byId(tbodyId);
    if (!tbody) return;
    tbody.replaceChildren();

    rows.forEach((cells) => {
      const tr = document.createElement("tr");
      cells.forEach((cell) => {
        const td = document.createElement("td");
        td.textContent = cell ?? "--";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  async function loadJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} al cargar ${url}`);
    return response.json();
  }

  async function loadOptionalJson(url) {
    try {
      return await loadJson(url);
    } catch (error) {
      console.warn(error.message || error);
      return null;
    }
  }

  async function loadOptionalJsonWithFallback(primaryPath, fallbackPath = null) {
    try {
      return await loadJsonWithFallback(primaryPath, fallbackPath);
    } catch (error) {
      console.warn(error.message || error);
      return null;
    }
  }

  async function loadReportBundles() {
    if (reportState.loaded && reportState.bundles) return reportState.bundles;

    console.log("Cargando reporte Bloque 1...");

    const [validationBundle, profileBundle] = await Promise.all([
      loadOptionalJsonWithFallback(REPORT_DATA_URLS.validationBundle, REPORT_DATA_URLS.validationLite),
      loadOptionalJsonWithFallback(REPORT_DATA_URLS.profileBundle, REPORT_DATA_URLS.profileLite),
    ]);

    if (validationBundle) {
      console.log("JSON de validación cargado correctamente");
      console.log("KPIs detectados:", Object.keys(validationBundle.kpis || {}));
      console.log("Filas mensuales detectadas:", asArray(validationBundle.mensual).length);
      console.log("Métricas detectadas:", asArray(validationBundle.metricas || validationBundle.indicadores).length);
      setText("reportPdfStatus", "");
      reportState.bundles = { validation: validationBundle, profile: profileBundle };
      reportState.loaded = true;
      return reportState.bundles;
    }

    const [tmy, nasa, compare, samCen] = await Promise.all([
      loadJson(REPORT_DATA_URLS.tmy),
      loadJson(REPORT_DATA_URLS.nasa),
      loadJson(REPORT_DATA_URLS.compare),
      loadJson(REPORT_DATA_URLS.samCen),
    ]);

    console.warn("JSON de validación no encontrado; usando bundles actuales del dashboard para Reportes.");
    setText("reportPdfStatus", "JSON de validación no encontrado; usando bundles actuales.");
    console.log("KPIs detectados:", Object.keys({ ...(nasa.kpis || {}), ...(samCen.cen_kpis || {}) }));
    console.log("Filas mensuales detectadas:", asArray(samCen.mensual).length);
    console.log("Métricas detectadas:", asArray(samCen.indicadores).length);
    reportState.bundles = { tmy, nasa, compare, samCen };
    reportState.loaded = true;
    return reportState.bundles;
  }

  function renderReportHeader() {
    setText("reportGeneratedAt", formatDateTime());
  }

  function validationKpiValue(kpis, key) {
    const map = {
      samNasa: {
        candidates: ["energia_anual_sam_nasa_2025_gwh", "sam_nasa_2025_gwh", "sam_nasa_2025_anual_gwh", "energia_sam_nasa_2025_gwh", "sam_nasa_2025_mwh", "sam_nasa_mwh"],
        tokens: [["sam"], ["nasa"], ["gwh", "mwh", "energia"]],
      },
      samTmy: {
        candidates: ["energia_anual_sam_tmy_explorador_solar_gwh", "sam_tmy_explorador_solar_gwh", "sam_tmy_gwh", "sam_tmy_mwh"],
        tokens: [["sam"], ["tmy"], ["gwh", "mwh", "energia"]],
      },
      centralizado: {
        candidates: ["energia_anual_pronostico_centralizado_cen_gwh", "energia_pronostico_centralizado_cen_gwh", "pronostico_centralizado_cen_gwh", "centralizado_cen_gwh", "pronostico_centralizado_cen_mwh"],
        tokens: [["pronostico", "centralizado"], ["cen"], ["gwh", "mwh", "energia"]],
      },
      cenDisponible: {
        candidates: ["cen_disponible_anual_gwh", "energia_cen_disponible_gwh", "cen_disponible_gwh", "energia_disponible_cen_gwh", "cen_disponible_mwh"],
        tokens: [["cen"], ["disponible"], ["gwh", "mwh", "energia"]],
      },
      generacionReal: {
        candidates: ["generacion_real_cen_anual_gwh", "energia_generacion_real_cen_gwh", "generacion_real_cen_gwh", "energia_inyectada_cen_gwh", "cen_inyeccion_gwh", "generacion_real_cen_mwh"],
        tokens: [["generacion", "inyeccion"], ["real", "cen"], ["gwh", "mwh", "energia"]],
      },
      reducciones: {
        candidates: ["reducciones_cen_anuales_gwh", "energia_reducciones_cen_gwh", "reducciones_cen_gwh", "energia_curtailment_cen_gwh", "cen_curtailment_gwh", "reducciones_cen_mwh"],
        tokens: [["reducciones", "curtailment"], ["cen"], ["gwh", "mwh", "energia"]],
      },
      residuo: {
        candidates: ["residuo_sam_nasa_2025_menos_cen_disponible_gwh", "sam_nasa_menos_cen_disponible_gwh", "residuo_sam_cen_disponible_gwh", "residuo_sam_nasa_2025_menos_cen_disponible_mwh"],
        tokens: [["residuo", "diferencia"], ["sam"], ["cen"], ["disponible"]],
      },
      delta1: {
        candidates: ["delta_1_sam_centralizado_gwh", "delta_e1_sam_nasa_2025_menos_pronostico_centralizado_cen_gwh", "delta_e1_gwh", "de1_gwh", "sam_nasa_menos_pronostico_centralizado_cen_gwh", "delta_e1_mwh"],
        tokens: [["delta_e1", "de1", "e1"], ["gwh", "mwh", "energia"]],
      },
      delta2: {
        candidates: ["delta_2_centralizado_disponible_gwh", "delta_e2_pronostico_centralizado_cen_menos_cen_disponible_gwh", "delta_e2_gwh", "de2_gwh", "centralizado_menos_cen_disponible_gwh", "delta_e2_mwh"],
        tokens: [["delta_e2", "de2", "e2"], ["gwh", "mwh", "energia"]],
      },
      delta3: {
        candidates: ["delta_3_reducciones_gwh", "delta_e3_reducciones_cen_gwh", "delta_e3_gwh", "de3_gwh", "energia_reducciones_cen_gwh", "reducciones_cen_gwh", "delta_e3_mwh"],
        tokens: [["delta_e3", "de3", "e3", "reducciones", "curtailment"], ["gwh", "mwh", "energia"]],
      },
      factorReducciones: {
        candidates: ["factor_reducciones_cen_pct", "factor_curtailment_anual_pct", "factor_curtailment_pct", "reducciones_cen_pct"],
        tokens: [["factor"], ["reducciones", "curtailment"]],
      },
    };

    const config = map[key];
    if (!config) return null;
    return key === "factorReducciones"
      ? readNumber(kpis, config.candidates, config.tokens)
      : readEnergyGwh(kpis, config.candidates, config.tokens);
  }

  function derivedDeltaFromKpis(kpis, key) {
    const samNasa = validationKpiValue(kpis, "samNasa");
    const centralizado = validationKpiValue(kpis, "centralizado");
    const cenDisponible = validationKpiValue(kpis, "cenDisponible");
    const generacionReal = validationKpiValue(kpis, "generacionReal");

    if (key === "delta1" && samNasa !== null && centralizado !== null) return samNasa - centralizado;
    if (key === "delta2" && centralizado !== null && cenDisponible !== null) return centralizado - cenDisponible;
    if (key === "delta3" && cenDisponible !== null && generacionReal !== null) return cenDisponible - generacionReal;
    return null;
  }

  function getDeltaValue(validation, key, fallbackKpis) {
    const deltas = validation.deltas || {};
    const rows = asArray(deltas);
    const direct = validationKpiValue(deltas, key);
    if (direct !== null) return direct;
    const row = rows.find((item) => normalizeKey(`${item.nombre || ""} ${item.eslabon || ""} ${item.comparacion || ""}`).includes(key.replace("delta", "e")));
    if (row) {
      return readEnergyGwh(row, ["energia_anual_gwh", "valor_gwh", "delta_gwh", "energia_gwh", "valor_mwh", "delta_mwh"], [["gwh", "mwh", "energia", "valor", "delta"]]);
    }
    const directKpi = validationKpiValue(fallbackKpis, key);
    if (directKpi !== null) return directKpi;
    return derivedDeltaFromKpis(fallbackKpis, key);
  }

  function buildConclusionesBloque1(validation) {
    const kpis = validation?.kpis || {};
    const energiaSamNasa = validationKpiValue(kpis, "samNasa");
    const energiaSamTmy = validationKpiValue(kpis, "samTmy");
    const energiaPronostico = validationKpiValue(kpis, "centralizado");
    const energiaCenDisponible = validationKpiValue(kpis, "cenDisponible");
    const energiaGeneracionReal = validationKpiValue(kpis, "generacionReal");
    const energiaReducciones = validationKpiValue(kpis, "reducciones");
    const factorReducciones = validationKpiValue(kpis, "factorReducciones");
    const deltaSamPronostico = energiaSamNasa !== null && energiaPronostico !== null ? energiaSamNasa - energiaPronostico : null;
    const deltaSamPronosticoPct = deltaSamPronostico !== null && energiaPronostico !== null && energiaPronostico !== 0
      ? (deltaSamPronostico / energiaPronostico) * 100
      : null;
    const deltaSamCenDisponible = energiaSamNasa !== null && energiaCenDisponible !== null ? energiaSamNasa - energiaCenDisponible : null;
    const delta1 = getDeltaValue(validation, "delta1", kpis);
    const delta2 = getDeltaValue(validation, "delta2", kpis);
    const delta3 = getDeltaValue(validation, "delta3", kpis);
    const residuoTotal = energiaSamNasa !== null && energiaGeneracionReal !== null ? energiaSamNasa - energiaGeneracionReal : null;

    return {
      resumenEjecutivo:
        `El Bloque 1 evalua la coherencia tecnico-operacional de la simulacion fotovoltaica de CEME1. ` +
        `La simulacion SAM NASA 2025 alcanza ${fmt(energiaSamNasa, 1, "GWh/ano")}, mientras que el Pronostico centralizado CEN alcanza ${fmt(energiaPronostico, 1, "GWh/ano")}. ` +
        `La diferencia anual entre ambas referencias es ${fmt(deltaSamPronostico, 1, "GWh")}, equivalente a ${fmt(deltaSamPronosticoPct, 2, "%")}. ` +
        `Esta convergencia respalda la representatividad anual del modelo FV para el periodo 2025, sin interpretarse como validacion fisica absoluta.`,
      lecturaTecnica:
        `Frente al CEN disponible de ${fmt(energiaCenDisponible, 1, "GWh/ano")}, el residuo SAM NASA 2025 - CEN disponible es ${fmt(deltaSamCenDisponible, 1, "GWh")}. ` +
        `Esta diferencia debe interpretarse como discrepancia tecnico-operacional, dado que SAM no modela fallas reales, mantenimientos no informados, indisponibilidades tecnicas ni restricciones operacionales reales.`,
      reducciones:
        `Las Reducciones CEN alcanzan ${fmt(energiaReducciones, 1, "GWh/ano")}, equivalentes al ${fmt(factorReducciones, 1, "%")} del CEN disponible. ` +
        `Esta energia reducida constituye la senal operacional principal para evaluar recuperacion energetica mediante BESS.`,
      descomposicion:
        `La brecha total entre SAM NASA 2025 y Generacion real CEN se descompone en tres eslabones: ` +
        `Delta E1 = ${fmt(delta1, 1, "GWh")}, Delta E2 = ${fmt(delta2, 1, "GWh")} y Delta E3 = ${fmt(delta3, 1, "GWh")}. ` +
        `La suma de estos componentes se compara con el residuo total de ${fmt(residuoTotal, 1, "GWh")}, permitiendo verificar la consistencia algebraica de la cadena SAM, Pronostico CEN, CEN disponible y Generacion real CEN.`,
      decision:
        `La decision tecnica del Bloque 1 es utilizar SAM NASA 2025 como base de contraste operacional frente a CEN 2025, ` +
        `mantener SAM TMY Explorador Solar como referencia meteorologica tipica y usar las Reducciones CEN como senal de energia recuperable potencial para el analisis BESS del Bloque 2.`,
      samTmy: energiaSamTmy,
    };
  }

  function renderValidationReportSummary(validation) {
    const kpis = validation.kpis || {};
    const samNasa = validationKpiValue(kpis, "samNasa");
    const cenDisponible = validationKpiValue(kpis, "cenDisponible");
    const centralizado = validationKpiValue(kpis, "centralizado");
    const residuo = validationKpiValue(kpis, "residuo");

    setText(
      "reportExecutiveSummary",
      `El Bloque 1 consolida la comparación entre SAM NASA 2025, SAM TMY Explorador Solar, Pronóstico centralizado CEN y CEN disponible. ` +
      `SAM NASA 2025 registra ${formatAvailable(samNasa, 1)} GWh, el Pronóstico centralizado CEN ${formatAvailable(centralizado, 1)} GWh ` +
      `y CEN disponible ${formatAvailable(cenDisponible, 1)} GWh. El residuo SAM NASA 2025 − CEN disponible es ${formatAvailable(residuo, 1)} GWh. ` +
      `La lectura técnica separa simulación, pronóstico operacional y reducciones CEN como eslabones del residuo.`
    );

    setText("reportKpiSamNasa", formatAvailable(samNasa, 1));
    setText("reportKpiSamTmy", formatAvailable(validationKpiValue(kpis, "samTmy"), 1));
    setText("reportKpiCentralized", formatAvailable(centralizado, 1));
    setText("reportKpiCenAvailable", formatAvailable(cenDisponible, 1));
    setText("reportKpiRealGen", formatAvailable(validationKpiValue(kpis, "generacionReal"), 1));
    setText("reportKpiReductions", formatAvailable(validationKpiValue(kpis, "reducciones"), 1));
    setText("reportKpiReductionFactor", formatAvailable(validationKpiValue(kpis, "factorReducciones"), 1));
    setText("reportKpiResidual", formatAvailable(residuo, 1));
    setText("reportKpiDelta1", formatAvailable(getDeltaValue(validation, "delta1", kpis), 1));
    setText("reportKpiDelta2", formatAvailable(getDeltaValue(validation, "delta2", kpis), 1));
    setText("reportKpiDelta3", formatAvailable(getDeltaValue(validation, "delta3", kpis), 1));
  }

  function renderValidationAnnualTable(validation) {
    const rows = asArray(validation.resumen_anual);
    if (!rows.length) {
      addRows("reportAnnualResultsBody", [["Dato no disponible", "Dato no disponible", "Dato no disponible", "Dato no disponible", "No se encontró resumen_anual en el JSON"]]);
      return;
    }

    addRows("reportAnnualResultsBody", rows.map((row) => [
      getField(row, ["senal", "señal", "signal", "nombre", "variable", "caso", "caso_sam", "comparacion"]) || "Dato no disponible",
      formatAvailable(readEnergyGwh(row, ["energia_anual_gwh", "energia_gwh", "valor_gwh", "energia_anual_mwh", "valor_mwh"], [["energia", "valor"], ["gwh", "mwh"]]), 1),
      formatAvailable(readEnergyGwh(row, ["diferencia_contra_cen_disponible_gwh", "diff_cen_disponible_gwh", "delta_cen_disponible_gwh", "diferencia_gwh"], [["diferencia", "delta"], ["cen"], ["disponible"]]), 1),
      formatAvailable(readNumber(row, ["diferencia_contra_cen_disponible_pct", "diff_cen_disponible_pct", "delta_pct", "diferencia_pct"], [["diferencia", "delta"], ["pct", "porcentaje"]]), 1),
      getField(row, ["interpretacion", "interpretación", "descripcion", "descripción", "nota"]) || "Dato no disponible",
    ]));
  }

  function renderValidationMetrics(validation) {
    const rows = asArray(validation.metricas || validation.indicadores);
    if (!rows.length) {
      addRows("reportValidationBody", [["Dato no disponible", "Dato no disponible", "Dato no disponible", "Dato no disponible", "Dato no disponible", "Dato no disponible", "Dato no disponible"]]);
      return;
    }

    addRows("reportValidationBody", rows.map((row) => [
      getField(row, ["comparacion", "comparación", "nombre", "caso", "caso_sam", "referencia"]) || "Dato no disponible",
      formatAvailable(readNumber(row, ["mbe_mwh", "mbe"], [["mbe"]]), 2),
      formatAvailable(readNumber(row, ["mae_mwh", "mae"], [["mae"]]), 2),
      formatAvailable(readNumber(row, ["rmse_mwh", "rmse"], [["rmse"]]), 2),
      formatAvailable(readNumber(row, ["nrmse_pct", "nrmse"], [["nrmse"]]), 1),
      formatAvailable(readNumber(row, ["correlacion_r", "corr_pearson", "r"], [["correlacion", "corr", "pearson", "r"]]), 3),
      formatAvailable(readNumber(row, ["sesgo_anual_pct", "delta_pct", "bias_pct"], [["sesgo", "bias", "delta"], ["pct"]]), 1),
    ]));
  }

  function renderValidationSources(validation) {
    const rows = asArray(validation?.fuentes_datos);
    if (rows.length) {
      addRows("reportSourcesBody", rows.map((row) => [
        getField(row, ["fuente"]) || "Dato no disponible",
        getField(row, ["variable_dashboard", "variable"]) || "Dato no disponible",
        getField(row, ["uso_bloque1", "uso"]) || "Dato no disponible",
        getField(row, ["observacion", "observaciÃ³n", "nota"]) || "Dato no disponible",
      ]));
      return;
    }

    addRows("reportSourcesBody", [
      ["SAM NASA 2025", "sam_nasa_2025_mwh", "Simulación técnica FV 2025", "No incorpora fallas, mantenimientos ni indisponibilidad real"],
      ["SAM TMY Explorador Solar", "sam_tmy_mwh", "Caso meteorológico típico", "Base de caracterización solar"],
      ["Pronóstico centralizado CEN", "pronostico_centralizado_cen_mwh", "Referencia operacional CEN", "Archivos Centralizado CEME1 2025"],
      ["Generación real CEN", "generacion_real_cen_mwh", "Producción efectiva", "Equivale a RealSolar / señal CEN validada"],
      ["Reducciones CEN", "reducciones_cen_mwh", "Energía reducida", "Equivale al curtailment CEN"],
      ["CEN disponible", "cen_disponible_mwh", "Generación real + reducciones", "Referencia operacional principal"],
      ["Precio spot Mirage 220", "precio_spot_usd_mwh", "Valorización económica", "Puente hacia análisis BESS"],
    ]);
  }

  function getMonthlyValue(row, key) {
    const map = {
      samNasa: [["sam_nasa_2025_gwh", "sam_nasa_gwh", "sam_nasa_2025_mwh"], [["sam"], ["nasa"]]],
      samTmy: [["sam_tmy_gwh", "sam_tmy_explorador_solar_gwh", "sam_tmy_mwh"], [["sam"], ["tmy"]]],
      centralizado: [["pronostico_centralizado_cen_gwh", "centralizado_cen_gwh", "pronostico_centralizado_cen_mwh"], [["pronostico", "centralizado"], ["cen"]]],
      cenDisponible: [["cen_disponible_gwh", "energia_disponible_cen_gwh", "cen_disponible_mwh"], [["cen"], ["disponible"]]],
      generacionReal: [["generacion_real_cen_gwh", "cen_inyeccion_gwh", "generacion_real_cen_mwh"], [["generacion", "inyeccion"], ["cen"]]],
      reducciones: [["reducciones_cen_gwh", "cen_curtailment_gwh", "reducciones_cen_mwh"], [["reducciones", "curtailment"], ["cen"]]],
    };
    const [candidates, tokens] = map[key] || [[], []];
    return readEnergyGwh(row, candidates, tokens);
  }

  function renderValidationResidual(validation) {
    const kpis = validation.kpis || {};
    const delta1 = getDeltaValue(validation, "delta1", kpis);
    const delta2 = getDeltaValue(validation, "delta2", kpis);
    const delta3 = getDeltaValue(validation, "delta3", kpis);
    const conclusiones = buildConclusionesBloque1(validation);
    const residuoTotal = validationKpiValue(kpis, "samNasa") !== null && validationKpiValue(kpis, "generacionReal") !== null
      ? validationKpiValue(kpis, "samNasa") - validationKpiValue(kpis, "generacionReal")
      : null;

    setText(
      "reportResidualText",
      "La descomposición operacional separa la brecha entre simulación técnica, pronóstico operacional, disponibilidad observada y reducciones CEN."
    );

    setText("reportResidualText", conclusiones.descomposicion);

    const rows = [
      ["ΔE1", "SAM NASA 2025 − Pronóstico centralizado CEN", delta1, "Brecha entre simulación técnica SAM y referencia operacional seleccionada por el CEN."],
      ["ΔE2", "Pronóstico centralizado CEN − CEN disponible", delta2, "Desviación entre pronóstico centralizado CEN y disponibilidad operacional observada."],
      ["ΔE3", "CEN disponible − Generación real CEN", delta3, "Reducciones CEN, equivalentes al curtailment operacional y a la oportunidad energética para el BESS."],
      ["Residuo total", "SAM NASA 2025 − Generación real CEN", residuoTotal, "Brecha total entre simulación SAM NASA 2025 y generación real CEN."],
    ];

    addRows("reportResidualBody", rows.map(([label, comparison, value, interpretation]) => [
      label,
      comparison,
      formatAvailable(value, 1),
      interpretation,
    ]));

    renderWaterfallChart(rows.map(([label, , value]) => ({ label, value })));
  }

  function renderReportSummary(bundles) {
    if (bundles.validation) {
      renderValidationReportSummary(bundles.validation);
      return;
    }

    const { nasa, samCen } = bundles;
    const cen = samCen.cen_kpis || {};
    const summaryNasa = findCase(samCen.resumen_anual, /nasa/i);
    const indicatorsNasa = (samCen.indicadores || []).find((row) =>
      /nasa/i.test(`${row.caso_sam || ""}`) &&
      row.referencia === "CEN disponible = inyeccion + curtailment" &&
      row.filtro === "todas_las_horas"
    ) || {};

    setText(
      "reportExecutiveSummary",
      `El Bloque 1 consolida la modelación FV horaria de CEME1 en SAM y la contrasta con la referencia operacional CEN 2025. ` +
      `La simulación SAM NASA 2025 alcanza ${formatNumber(nasa.kpis?.energia_ac_neta_gwh_anio, 1)} GWh/año, mientras que ` +
      `CEN disponible registra ${formatNumber(cen.energia_disponible_cen_gwh, 1)} GWh/año. El residuo SAM − CEN disponible ` +
      `es ${formatNumber(summaryNasa.sam_menos_cen_disponible_gwh, 1)} GWh (${formatNumber(summaryNasa.sam_menos_cen_disponible_pct, 1)} %), ` +
      `con nRMSE horario de ${formatNumber(indicatorsNasa.nrmse_pct, 1)} %. Este residuo se interpreta como discrepancia técnico-operacional.`
    );

    setText("reportKpiSamNasa", formatNumber(nasa.kpis?.energia_ac_neta_gwh_anio, 1));
    setText("reportKpiSamTmy", formatNumber(findCase(samCen.sam_kpis, /tmy/i).energia_ac_neta_gwh, 1));
    setText("reportKpiCentralized", "Dato no disponible");
    setText("reportKpiCenAvailable", formatNumber(cen.energia_disponible_cen_gwh, 1));
    setText("reportKpiResidual", formatNumber(summaryNasa.sam_menos_cen_disponible_gwh, 1));
    setText("reportKpiRealGen", formatNumber(cen.energia_inyectada_cen_gwh, 1));
    setText("reportKpiReductions", formatNumber(cen.energia_curtailment_cen_gwh, 1));
    setText("reportKpiReductionFactor", formatNumber(cen.factor_curtailment_anual_pct, 1));
    setText("reportKpiDelta1", "Dato no disponible");
    setText("reportKpiDelta2", "Dato no disponible");
    setText("reportKpiDelta3", formatNumber(cen.energia_curtailment_cen_gwh, 1));
  }

  function renderReportTables(bundles) {
    if (bundles.validation) {
      renderValidationSources(bundles.validation);
      renderValidationAnnualTable(bundles.validation);
      renderValidationMetrics(bundles.validation);
      return;
    }

    const { tmy, nasa, compare, samCen } = bundles;
    const cen = samCen.cen_kpis || {};
    const samTmy = findCase(samCen.sam_kpis, /tmy/i);
    const samNasa = findCase(samCen.sam_kpis, /nasa/i);
    const summaryNasa = findCase(samCen.resumen_anual, /nasa/i);

    addRows("reportSourcesBody", [
      ["SAM NASA 2025", "sam_nasa_2025_mwh", "Simulación técnica FV horaria bajo meteorología histórica 2025", "No incorpora fallas, mantenimientos ni indisponibilidad real"],
      ["SAM TMY Explorador Solar", "sam_tmy_mwh", "Caso base meteorológico típico para comparación técnica FV", "Año meteorológico típico del Explorador Solar"],
      ["CEN/SEN 2025", "cen_disponible_mwh", "Generación real CEN, Reducciones CEN y CEN disponible", "Referencia operacional construida desde datos CEN"],
      ["Comparativa TMY vs NASA 2025", "comparativa_sam", "Contraste meteorológico y energético entre escenarios SAM", "No modifica fórmulas ni referencias CEN"],
    ]);

    addRows("reportAnnualResultsBody", [
      ["SAM TMY Explorador Solar", formatNumber(samTmy.energia_ac_neta_gwh, 1), formatNumber((samTmy.energia_ac_neta_gwh || 0) - (cen.energia_disponible_cen_gwh || 0), 1), "Dato no disponible", "Simulación FV con año meteorológico típico"],
      ["SAM NASA 2025", formatNumber(samNasa.energia_ac_neta_gwh, 1), formatNumber(summaryNasa.sam_menos_cen_disponible_gwh, 1), formatNumber(summaryNasa.sam_menos_cen_disponible_pct, 1), "Simulación FV con meteorología histórica 2025"],
      ["Generación real CEN", formatNumber(cen.energia_inyectada_cen_gwh, 1), formatNumber((cen.energia_inyectada_cen_gwh || 0) - (cen.energia_disponible_cen_gwh || 0), 1), "Dato no disponible", "Señal de generación real CEN, equivalente a inyección registrada"],
      ["Reducciones CEN (curtailment)", formatNumber(cen.energia_curtailment_cen_gwh, 1), "Dato no disponible", "Dato no disponible", "Reducciones operacionales definidas por CEN"],
      ["CEN disponible", formatNumber(cen.energia_disponible_cen_gwh, 1), "0,0", "0,0", "Generación real CEN + Reducciones CEN"],
      ["Residuo SAM NASA 2025 − CEN disponible", formatNumber(summaryNasa.sam_menos_cen_disponible_gwh, 1), formatNumber(summaryNasa.sam_menos_cen_disponible_gwh, 1), formatNumber(summaryNasa.sam_menos_cen_disponible_pct, 1), "Discrepancia técnico-operacional"],
      ["Factor reducciones CEN", formatNumber(cen.factor_curtailment_anual_pct, 1), "Dato no disponible", "Dato no disponible", "Reducciones CEN / CEN disponible"],
    ]);

    addRows("reportValidationBody", (samCen.indicadores || []).map((row) => [
      `${displaySamCase(row.caso_sam, row.fuente_meteorologica)} vs ${displayReference(row.referencia)} (${row.filtro || "--"})`,
      formatNumber(row.mbe, 2),
      formatNumber(row.mae, 2),
      formatNumber(row.rmse, 2),
      `${formatNumber(row.nrmse_pct, 1)} %`,
      formatNumber(row.corr_pearson, 3),
      `${formatNumber(row.delta_pct, 1)} %`,
    ]));
  }

  function renderResidualSection(bundles) {
    if (bundles.validation) {
      renderValidationResidual(bundles.validation);
      return;
    }

    const { samCen } = bundles;
    const cen = samCen.cen_kpis || {};
    const summaryNasa = findCase(samCen.resumen_anual, /nasa/i);
    const samNasa = findCase(samCen.sam_kpis, /nasa/i);

    setText(
      "reportResidualText",
      "La descomposición operacional separa la energía disponible CEN en Generación real CEN y Reducciones CEN. " +
      "El residuo se calcula contra CEN disponible y no contra la inyección registrada, evitando confundir restricciones operacionales con error puro del modelo FV."
    );

    const residuoTotal = (samNasa.energia_ac_neta_gwh || 0) - (cen.energia_inyectada_cen_gwh || 0);
    addRows("reportResidualBody", [
      ["ΔE1", "SAM NASA 2025 − Pronóstico centralizado CEN", "Dato no disponible", "Brecha entre simulación técnica SAM y referencia operacional seleccionada por el CEN."],
      ["ΔE2", "Pronóstico centralizado CEN − CEN disponible", "Dato no disponible", "Desviación entre pronóstico centralizado CEN y disponibilidad operacional observada."],
      ["ΔE3", "CEN disponible − Generación real CEN", formatNumber(cen.energia_curtailment_cen_gwh, 1), "Reducciones CEN, equivalentes al curtailment operacional y a la oportunidad energética para el BESS."],
      ["Residuo total", "SAM NASA 2025 − Generación real CEN", formatNumber(residuoTotal, 1), "Brecha total entre simulación SAM NASA 2025 y generación real CEN."],
    ]);

    renderWaterfallChart([
      { label: "ΔE1", value: null },
      { label: "ΔE2", value: null },
      { label: "ΔE3", value: cen.energia_curtailment_cen_gwh },
      { label: "Residuo total", value: residuoTotal },
    ]);
  }

  function renderReportConclusion(bundles) {
    if (bundles.validation) {
      setText(
        "reportConclusion",
        "La comparación entre SAM NASA 2025, el pronóstico centralizado CEN y el CEN disponible permite cerrar el bloque FV mediante una descomposición operacional del residuo. Esta estructura separa la brecha entre simulación técnica, pronóstico operacional y reducciones CEN, entregando una base consistente para avanzar hacia la simulación del BESS y la valorización de energía reducida."
      );
      return;
    }

    const summaryNasa = findCase(bundles.samCen.resumen_anual, /nasa/i);
    setText(
      "reportConclusion",
      `El Bloque 1 deja establecida una referencia técnica y operacional para CEME1. SAM NASA 2025 se usa como simulación ` +
      `técnica de generación FV y CEN disponible como referencia operacional antes de reducciones. La brecha anual de ` +
      `${formatNumber(summaryNasa.sam_menos_cen_disponible_gwh, 1)} GWh debe leerse como discrepancia técnico-operacional ` +
      `y sirve como base para los análisis posteriores de recuperación energética y operación BESS.`
    );
  }

  function renderReportLimitations(validation) {
    const list = byId("reportLimitationsList");
    if (!list) return;
    const rows = Array.isArray(validation?.limitaciones) && validation.limitaciones.length
      ? validation.limitaciones
      : [
        "No se dispone de irradiancia in situ en CEME1.",
        "La validacion es indirecta, usando referencias operacionales oficiales del CEN.",
        "SAM no modela fallas reales, mantenimientos no informados ni indisponibilidad tecnica historica.",
        "Las Reducciones CEN se interpretan como curtailment operacional recuperable potencialmente por el BESS.",
      ];
    list.replaceChildren(...rows.map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }));
  }

  function getEastWestRows(bundles) {
    const profile = bundles.profile || {};
    const validation = bundles.validation || {};
    const candidates = [
      profile.perfil_horario_nasa_2025,
      validation.perfil_este_oeste_sam_nasa_2025,
      profile.perfil_horario,
      validation.perfil_este_oeste_sam,
    ].find((rows) => Array.isArray(rows) && rows.length);

    const rows = Array.isArray(candidates) ? candidates : [];
    const nasaRows = rows.filter((row) => /nasa|2025/i.test(`${row.caso_sam || ""} ${row.nombre_caso || ""} ${row.fuente_meteorologica || ""}`));
    return (nasaRows.length ? nasaRows : rows)
      .map((row) => ({
        hora: Number(row.hora),
        este_mwh: readNumber(row, ["este_mwh", "energia_este_mwh"]),
        oeste_mwh: readNumber(row, ["oeste_mwh", "energia_oeste_mwh"]),
        total_mwh: readNumber(row, ["total_mwh", "energia_total_mwh"]),
      }))
      .filter((row) => Number.isFinite(row.hora))
      .sort((a, b) => a.hora - b.hora);
  }

  function destroyProfileChart() {
    if (reportState.profileChart && typeof reportState.profileChart.destroy === "function") {
      reportState.profileChart.destroy();
    }
    reportState.profileChart = null;
  }

  function renderReportEastWestProfile(bundles) {
    const canvas = byId("reportEastWestChart");
    const note = byId("reportEastWestNote");
    if (!canvas) return;
    const rows = getEastWestRows(bundles);
    destroyProfileChart();

    if (!rows.length || typeof Chart === "undefined") {
      if (note) note.textContent = "Perfil Este/Oeste no disponible. Ejecute nuevamente el script CEN-SAM con generacion de perfil Este/Oeste.";
      return;
    }

    if (note) note.textContent = "Perfil horario representativo de produccion FV - configuracion Este/Oeste. Caso principal: SAM NASA 2025.";

    reportState.profileChart = new Chart(canvas, {
      type: "line",
      data: {
        labels: rows.map((row) => `${String(row.hora).padStart(2, "0")}:00`),
        datasets: [
          { label: "Este", data: rows.map((row) => row.este_mwh), borderColor: "#1b6dcc", backgroundColor: "#1b6dcc", borderWidth: 2, pointRadius: 2, tension: 0.25 },
          { label: "Oeste", data: rows.map((row) => row.oeste_mwh), borderColor: "#e27820", backgroundColor: "#e27820", borderWidth: 2, pointRadius: 2, tension: 0.25 },
          { label: "Total", data: rows.map((row) => row.total_mwh), borderColor: "#1e8f49", backgroundColor: "#1e8f49", borderWidth: 2, pointRadius: 2, tension: 0.25 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { labels: { color: "#16324d", boxWidth: 14, usePointStyle: true } },
          tooltip: {
            backgroundColor: "rgba(255,255,255,0.96)",
            titleColor: "#0b1d31",
            bodyColor: "#18344f",
            borderColor: "#bdd1e5",
            borderWidth: 1,
          },
        },
        scales: {
          x: { ticks: { color: "#18344f", maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { color: "rgba(20, 60, 96, 0.08)" } },
          y: { title: { display: true, text: "MWh promedio", color: "#18344f" }, ticks: { color: "#18344f" }, grid: { color: "rgba(20, 60, 96, 0.12)" } },
        },
      },
      plugins: [{
        id: "reportEastWestWhiteCanvas",
        beforeDraw(chart) {
          const { ctx, width, height } = chart;
          ctx.save();
          ctx.globalCompositeOperation = "destination-over";
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
        },
      }],
    });
  }

  function destroyMonthlyChart() {
    if (reportState.monthlyChart && typeof reportState.monthlyChart.destroy === "function") {
      reportState.monthlyChart.destroy();
    }
    reportState.monthlyChart = null;
  }

  function destroyWaterfallChart() {
    if (reportState.waterfallChart && typeof reportState.waterfallChart.destroy === "function") {
      reportState.waterfallChart.destroy();
    }
    reportState.waterfallChart = null;
  }

  function renderWaterfallChart(rows) {
    const canvas = byId("reportWaterfallChart");
    if (!canvas || typeof Chart === "undefined") return;

    destroyWaterfallChart();
    reportState.waterfallChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: rows.map((row) => row.label),
        datasets: [{
          label: "Energía anual [GWh]",
          data: rows.map((row) => Number.isFinite(Number(row.value)) ? Number(row.value) : 0),
          backgroundColor: ["#1b6dcc", "#8d63c7", "#e27820", "#174a7c"],
          borderColor: ["#1b6dcc", "#8d63c7", "#e27820", "#174a7c"],
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(255,255,255,0.96)",
            titleColor: "#0b1d31",
            bodyColor: "#18344f",
            borderColor: "#bdd1e5",
            borderWidth: 1,
          },
        },
        scales: {
          x: { ticks: { color: "#18344f" }, grid: { color: "rgba(20, 60, 96, 0.08)" } },
          y: {
            title: { display: true, text: "GWh/año", color: "#18344f" },
            ticks: { color: "#18344f" },
            grid: { color: "rgba(20, 60, 96, 0.12)" },
          },
        },
      },
      plugins: [{
        id: "reportWaterfallWhiteCanvas",
        beforeDraw(chart) {
          const { ctx, width, height } = chart;
          ctx.save();
          ctx.globalCompositeOperation = "destination-over";
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
        },
      }],
    });
  }

  function renderMonthlyChart(bundles) {
    const canvas = byId("reportMonthlyChart");
    if (!canvas || typeof Chart === "undefined") return;

    const validation = bundles.validation;
    const rows = validation
      ? asArray(validation.mensual)
      : (bundles.samCen.mensual || []).filter((row) => /nasa/i.test(`${row.caso_sam || ""}`));
    const labels = rows.map((row) => row.mes_nombre || row.mes);

    destroyMonthlyChart();
    reportState.monthlyChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: validation ? [
          {
            type: "line",
            label: "SAM NASA 2025",
            data: rows.map((row) => getMonthlyValue(row, "samNasa") || 0),
            borderColor: "#1b6dcc",
            backgroundColor: "#1b6dcc",
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.25,
            yAxisID: "y",
          },
          {
            type: "line",
            label: "SAM TMY Explorador Solar",
            data: rows.map((row) => getMonthlyValue(row, "samTmy") || 0),
            borderColor: "#1e8f49",
            backgroundColor: "#1e8f49",
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.25,
            yAxisID: "y",
          },
          {
            type: "line",
            label: "Pronóstico centralizado CEN",
            data: rows.map((row) => getMonthlyValue(row, "centralizado") || 0),
            borderColor: "#8d63c7",
            backgroundColor: "#8d63c7",
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.25,
            yAxisID: "y",
          },
          {
            type: "line",
            label: "CEN disponible",
            data: rows.map((row) => getMonthlyValue(row, "cenDisponible") || 0),
            borderColor: "#c69a00",
            backgroundColor: "#c69a00",
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.25,
            yAxisID: "y",
          },
          {
            type: "line",
            label: "Generación real CEN",
            data: rows.map((row) => getMonthlyValue(row, "generacionReal") || 0),
            borderColor: "#3178c4",
            backgroundColor: "#3178c4",
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.25,
            yAxisID: "y",
          },
          {
            label: "Reducciones CEN",
            data: rows.map((row) => getMonthlyValue(row, "reducciones") || 0),
            backgroundColor: "rgba(226, 120, 32, 0.34)",
            borderColor: "#e27820",
            borderWidth: 1,
            yAxisID: "y",
          },
        ] : [
          {
            type: "line",
            label: "SAM NASA 2025",
            data: rows.map((row) => row.sam_e_ac_gwh || 0),
            borderColor: "#1b6dcc",
            backgroundColor: "#1b6dcc",
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.25,
            yAxisID: "y",
          },
          {
            type: "line",
            label: "CEN disponible",
            data: rows.map((row) => row.cen_disponible_gwh || 0),
            borderColor: "#c69a00",
            backgroundColor: "#c69a00",
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.25,
            yAxisID: "y",
          },
          {
            label: "Generación real CEN",
            data: rows.map((row) => row.cen_inyeccion_gwh || 0),
            backgroundColor: "rgba(49, 120, 196, 0.42)",
            borderColor: "#3178c4",
            borderWidth: 1,
            yAxisID: "y",
          },
          {
            label: "Reducciones CEN (curtailment)",
            data: rows.map((row) => row.cen_curtailment_gwh || 0),
            backgroundColor: "rgba(226, 120, 32, 0.42)",
            borderColor: "#e27820",
            borderWidth: 1,
            yAxisID: "y",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            labels: { color: "#16324d", boxWidth: 14, usePointStyle: true },
          },
          tooltip: {
            backgroundColor: "rgba(255,255,255,0.96)",
            titleColor: "#0b1d31",
            bodyColor: "#18344f",
            borderColor: "#bdd1e5",
            borderWidth: 1,
          },
        },
        scales: {
          x: {
            ticks: { color: "#18344f", maxRotation: 0 },
            grid: { color: "rgba(20, 60, 96, 0.08)" },
          },
          y: {
            title: { display: true, text: "GWh/mes", color: "#18344f" },
            ticks: { color: "#18344f" },
            grid: { color: "rgba(20, 60, 96, 0.12)" },
          },
        },
      },
      plugins: [{
        id: "reportWhiteCanvas",
        beforeDraw(chart) {
          const { ctx, width, height } = chart;
          ctx.save();
          ctx.globalCompositeOperation = "destination-over";
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
        },
      }],
    });
  }

  async function renderReportesView() {
    if (reportState.rendering) return;
    reportState.rendering = true;

    try {
      renderReportHeader();
      const bundles = await loadReportBundles();
      renderReportSummary(bundles);
      renderReportTables(bundles);
      renderReportLimitations(bundles.validation);
      renderResidualSection(bundles);
      renderReportConclusion(bundles);
      if (bundles.validation) {
        const conclusiones = buildConclusionesBloque1(bundles.validation);
        setText("reportConclusion", `${conclusiones.lecturaTecnica} ${conclusiones.reducciones} ${conclusiones.decision}`);
      }
      renderMonthlyChart(bundles);
      renderReportEastWestProfile(bundles);
    } catch (error) {
      console.error("No se pudo renderizar Reportes:", error);
      setText("reportPdfStatus", "No se pudieron cargar los datos del reporte");
    } finally {
      reportState.rendering = false;
    }
  }

  function replaceCanvasesWithImages(original, clone) {
    const originalCanvases = original.querySelectorAll("canvas");
    const cloneCanvases = clone.querySelectorAll("canvas");

    originalCanvases.forEach((canvas, index) => {
      const cloneCanvas = cloneCanvases[index];
      if (!cloneCanvas) return;

      try {
        const img = document.createElement("img");
        img.src = canvas.toDataURL("image/png", 1);
        img.alt = canvas.getAttribute("aria-label") || "Gráfico del reporte";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "contain";
        img.style.display = "block";
        cloneCanvas.replaceWith(img);
      } catch (error) {
        console.warn("No se pudo convertir canvas del reporte a imagen:", error);
      }
    });
  }

  async function exportReportPdf() {
    const button = byId("exportReportPdfBtn");
    const status = byId("reportPdfStatus");
    const source = byId("reportBloque1Content");

    if (!source) return;

    if (typeof window.html2pdf !== "function") {
      if (status) status.textContent = "No se pudo cargar la librería PDF";
      return;
    }

    if (button) button.disabled = true;
    if (status) status.textContent = "Generando PDF...";

    try {
      await renderReportesView();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const clone = source.cloneNode(true);
      clone.classList.add("pdf-report-page", "pdf-export-mode");
      clone.style.width = `${PDF_EXPORT_WIDTH_PX}px`;
      clone.style.maxWidth = `${PDF_EXPORT_WIDTH_PX}px`;
      const clonedDate = clone.querySelector("#reportGeneratedAt");
      if (clonedDate) clonedDate.textContent = formatDateTime();
      clone.querySelectorAll(".pdf-hide").forEach((el) => el.remove());
      replaceCanvasesWithImages(source, clone);

      const temp = document.createElement("div");
      temp.className = "pdf-export-host";
      temp.style.position = "fixed";
      temp.style.left = "0";
      temp.style.top = "0";
      temp.style.zIndex = "99999";
      temp.style.background = "#ffffff";
      temp.style.width = `${PDF_EXPORT_WIDTH_PX}px`;
      temp.style.maxWidth = `${PDF_EXPORT_WIDTH_PX}px`;
      temp.style.overflow = "hidden";
      temp.appendChild(clone);
      document.body.appendChild(temp);
      const captureWidth = Math.ceil(clone.getBoundingClientRect().width) || PDF_EXPORT_WIDTH_PX;

      const pdfWorker = window.html2pdf()
        .set({
          margin: [10, 9, 14, 9],
          filename: "reporte_bloque1_ceme1_fv_cen.pdf",
          image: { type: "jpeg", quality: 0.99 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            logging: false,
            windowWidth: captureWidth,
            width: captureWidth,
            scrollX: 0,
            scrollY: 0,
            x: 0,
            y: 0,
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: {
            mode: ["css", "legacy"],
            avoid: [".report-chart-card", ".report-kpi-grid article", ".report-table tr", ".report-profile-section"],
          },
        })
        .from(clone)
        .toPdf();

      await pdfWorker.get("pdf").then((pdf) => {
        const pageCount = pdf.internal.getNumberOfPages();
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        for (let page = 1; page <= pageCount; page += 1) {
          pdf.setPage(page);
          pdf.setTextColor(15, 39, 66);
          pdf.setFontSize(7);
          pdf.text("Storage Analytics | Reporte Bloque 1", 9, 6);
          pdf.text(`Pagina ${page} de ${pageCount}`, pageWidth - 9, pageHeight - 5, { align: "right" });
          pdf.text("Storage Analytics - Actividad de Graduacion MIE UC - CEME1 FV + BESS", 9, pageHeight - 5);
        }
      });

      await pdfWorker.save();

      temp.remove();
      if (status) status.textContent = "PDF generado correctamente";
      setTimeout(() => {
        if (status && status.textContent === "PDF generado correctamente") status.textContent = "";
      }, 4500);
    } catch (error) {
      console.error("No se pudo exportar el reporte PDF:", error);
      if (status) status.textContent = "No se pudo generar el PDF";
    } finally {
      document.querySelectorAll(".pdf-export-host").forEach((el) => el.remove());
      if (button) button.disabled = false;
    }
  }

  function initReportModule() {
    const button = byId("exportReportPdfBtn");
    if (button) button.addEventListener("click", exportReportPdf);
  }

  window.renderReportesView = renderReportesView;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReportModule);
  } else {
    initReportModule();
  }
})();


/* ============================================================
   SUBPESTAÑAS INTERNAS PLANTA FV / SIMULACIÓN ENERGÉTICA
   ============================================================ */
(function () {
  function setupSimulationPanels() {
    const target = document.getElementById("simulation-energy-panels");
    const samCenHost = document.getElementById("sam-cen-panel-host");
    const energyPanel = document.getElementById("plant-panel-energia");
    const samCenPanel = document.getElementById("plant-panel-sam-cen");

    if (!target || !energyPanel) return;

    if (energyPanel.parentElement !== target) {
      target.appendChild(energyPanel);
    }

    if (samCenHost && samCenPanel && samCenPanel.parentElement !== samCenHost) {
      samCenHost.appendChild(samCenPanel);
    }

    energyPanel.classList.add("active");
    if (samCenPanel) samCenPanel.classList.add("active");
  }

  function initPlantTabs() {
    setupSimulationPanels();

    const buttons = document.querySelectorAll(".plant-tab-btn[data-plant-panel]");
    if (!buttons.length) return;

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const panelName = button.dataset.plantPanel;
        const scope = button.closest(".dashboard-view") || document;

        scope.querySelectorAll(".plant-tab-btn[data-plant-panel]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });

        scope.querySelectorAll(".plant-panel").forEach((panel) => {
          panel.classList.toggle("active", panel.id === `plant-panel-${panelName}`);
        });

        if (panelName === "energia") {
          window.renderPlantEnergyView?.(button.dataset.plantEnergyMode);
        }

        if (panelName === "sam-cen") {
          window.renderSamCenView?.();
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPlantTabs);
  } else {
    initPlantTabs();
  }
})();
