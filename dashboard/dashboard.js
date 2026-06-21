let datos = [];
let scadaHourlyRows = [];
let indiceActual = 0;
let intervalo = null;
let charts = {};

const $ = (id) => document.getElementById(id);
const strategySelectValue = () => window.currentStrategyFile || "estrategia_A.json";
const SCADA_HOURLY_URL = "data/sam_tmy_nasa_vs_cen_horario_scada_lite.json";

window.addEventListener("DOMContentLoaded", () => {
  buildCharts();
  bindEvents();
  updateStrategyLabel("estrategia_A.json");
  cargarDatosScadaHorario();
  cargarComparador();
});

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
    const res = await fetch(SCADA_HOURLY_URL, {cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    scadaHourlyRows = Array.isArray(json) ? json : [];
    if(!scadaHourlyRows.length) throw new Error("JSON horario vacío");
    logScadaLoadDiagnostics(scadaHourlyRows);
    setScadaDataNote("Los valores FV provienen de SAM y los valores de inyección, curtailment y precio provienen de CEN/SEN 2025. CEN disponible se define como inyección + curtailment.");
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
    setScadaDataNote("Los valores FV provienen de SAM y los valores de inyección, curtailment y precio provienen de CEN/SEN 2025. CEN disponible se define como inyección + curtailment.");
  }

  update();
}

function normalizeScadaRow(row){
  const timestamp = normalizeTimestamp(row.timestamp);
  const fvPower = toNumber(row.sam_p_ac_mw);
  const fvEnergy = toNumber(row.sam_e_ac_mwh);
  const inyeccion = toNumber(row.cen_inyeccion_mwh);
  const curtailment = toNumber(row.cen_curtailment_mwh);
  const disponible = toNumber(row.cen_disponible_mwh, inyeccion + curtailment);
  const precio = toNumber(row.precio_spot_usd_mwh);

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
    residuo: toNumber(row.residuo_sam_menos_cen_disp_mwh, fvEnergy - disponible),
    pmg: precio,
    ingreso_inyeccion_usd: toNumber(row.cen_ingreso_inyeccion_usd, inyeccion * precio),
    valor_curtailment_usd: toNumber(row.cen_valor_curtailment_usd, curtailment * precio),
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

function toNumber(value, fallback = 0){
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
  const dd = validDate(date) ? `${date.toLocaleDateString("es-CL")} · ${d.caso_sam || ""}` : "Sin datos";

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
  charts.operation = lineChart("operationChart", ["Producción FV SAM","CEN disponible","Inyección CEN","Curtailment","Precio spot"], ["#76ff45","#ffd21f","#31b7ff","#ff8a00","#b46cff"], false);
  charts.radiation = lineChart("radiationChart", ["GHI","DNI","DHI"], ["#ffd21f","#ff8a00","#31b7ff"], false);
  charts.soc = lineChart("socChart", ["Residuo SAM-CEN disp."], ["#ff8a00"], false);
  charts.pmg = lineChart("pmgChart", ["Precio spot"], ["#9b78ff"], false);
  charts.sparkGhi = lineChart("sparkGhi", ["GHI"], ["#ffd21f"], true);
  charts.sparkFv = lineChart("sparkFv", ["FV"], ["#76ff45"], true);
  charts.sparkCurt = lineChart("sparkCurt", ["Curt"], ["#ff8a00"], true);
  charts.sparkInj = lineChart("sparkInj", ["Iny"], ["#31b7ff"], true);
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
  const SOLAR_DATA_URL = "data/recurso_solar_tmy_dashboard_bundle.json";

  const solarState = {
    loaded: false,
    bundle: null,
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

  async function loadSolarBundle() {
    if (solarState.loaded && solarState.bundle) {
      return solarState.bundle;
    }

    try {
      const response = await fetch(SOLAR_DATA_URL, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const bundle = await response.json();
      solarState.bundle = bundle;
      solarState.loaded = true;

      return bundle;
    } catch (error) {
      console.error("No se pudo cargar el JSON del recurso solar TMY:", error);
      return null;
    }
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
          lineDataset("GHI", perfil.map((row) => row.ghi_promedio_w_m2), "#f2c94c"),
          lineDataset("DNI", perfil.map((row) => row.dni_promedio_w_m2), "#f2994a"),
          lineDataset("DHI", perfil.map((row) => row.dhi_promedio_w_m2), "#2d9cdb"),
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
          lineDataset("GHI", mensual.map((row) => row.ghi_kwh_m2_dia_promedio), "#f2c94c"),
          lineDataset("DNI", mensual.map((row) => row.dni_kwh_m2_dia_promedio), "#f2994a"),
          lineDataset("DHI", mensual.map((row) => row.dhi_kwh_m2_dia_promedio), "#2d9cdb"),
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
          barDataset("GHI", mensual.map((row) => row.ghi_kwh_m2_mes), "#f2c94c"),
          barDataset("DNI", mensual.map((row) => row.dni_kwh_m2_mes), "#f2994a"),
          barDataset("DHI", mensual.map((row) => row.dhi_kwh_m2_mes), "#2d9cdb"),
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

  async function renderSolarView() {
    const bundle = await loadSolarBundle();

    if (!bundle) {
      console.warn("No hay datos solares disponibles para renderizar.");
      return;
    }

    renderSolarKpis(bundle.kpis);
    renderSolarMetadata(bundle.metadata);

    destroySolarCharts();

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

    if (viewName === "solar") {
      renderSolarView();
    }

    if (viewName === "planta") {
      const energyPanel = byId("plant-panel-energia");
      if (energyPanel && energyPanel.classList.contains("active")) {
        window.renderPlantEnergyView?.();
      }

      const samCenPanel = byId("plant-panel-sam-cen");
      if (samCenPanel && samCenPanel.classList.contains("active")) {
        window.renderSamCenView?.();
      }
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
        if (solarState.bundle && Array.isArray(solarState.bundle.horario)) {
          renderSolarHeatmap(solarState.bundle.horario);
        }
      }, 200);
    });
  }

  function initSolarModule() {
    setupDashboardNavigation();
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
      url: "data/planta_fv_sam_dashboard_bundle.json",
      type: "single",
      kicker: "RESULTADOS SAM — TMY",
      title: "Desempeño energético anual equivalente",
      status: "TMY DATOS OK",
      metaLabel: "TMY Explorador Solar de Chile",
    },
    nasa: {
      url: "data/planta_fv_sam_nasa_2025_dashboard_bundle.json",
      type: "single",
      kicker: "RESULTADOS SAM — NASA POWER 2025",
      title: "Desempeño energético anual equivalente · serie 2025",
      status: "NASA DATOS OK",
      metaLabel: "NASA POWER serie 2025",
    },
    compare: {
      url: "data/comparativa_tmy_vs_nasa_2025_dashboard_bundle.json",
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

  async function loadPlantBundle(mode) {
    const source = PLANT_ENERGY_SOURCES[mode];
    if (!source) return null;

    if (plantEnergyState.bundles[mode]) {
      return plantEnergyState.bundles[mode];
    }

    try {
      const response = await fetch(source.url, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const bundle = await response.json();
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
      const potenciaDcMwp = (Number(row.strings) || 0) * 30 * (Number(row.modulo_wp) || 0) / 1_000_000;
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
  const SAM_CEN_BUNDLE_URL = "data/sam_tmy_nasa_vs_cen_dashboard_bundle.json";

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
      const response = await fetch(SAM_CEN_BUNDLE_URL, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const bundle = await response.json();
      samCenState.bundle = bundle;
      samCenState.loaded = true;
      return bundle;
    } catch (error) {
      console.error("No se pudo cargar SAM vs CEN 2025:", error);
      return null;
    }
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

    setText("samCenKpiInjection", formatNumber(cen.energia_inyectada_cen_gwh, 1));
    setText("samCenKpiCurtailment", formatNumber(cen.energia_curtailment_cen_gwh, 1));
    setText("samCenKpiAvailable", formatNumber(cen.energia_disponible_cen_gwh, 1));
    setText("samCenKpiCurtailmentFactor", formatNumber(cen.factor_curtailment_anual_pct, 1));
    setText("samCenKpiTmyAnnual", formatNumber(samTmy.energia_ac_neta_gwh, 1));
    setText("samCenKpiNasaAnnual", formatNumber(samNasa.energia_ac_neta_gwh, 1));
    setText("samCenKpiTmyDelta", formatNumber(summaryTmy.sam_menos_cen_disponible_gwh, 1));
    setText("samCenKpiTmyDeltaPct", `${formatNumber(summaryTmy.sam_menos_cen_disponible_pct, 1)} % vs CEN disponible`);
    setText("samCenKpiNasaDelta", formatNumber(summaryNasa.sam_menos_cen_disponible_gwh, 1));
    setText("samCenKpiNasaDeltaPct", `${formatNumber(summaryNasa.sam_menos_cen_disponible_pct, 1)} % vs CEN disponible`);
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

    setText("samCenTmyBadge", "CASO BASE TÍPICO");
    setText("samCenNasaBadge", nasaBetter ? "MEJOR AJUSTE 2025" : "AÑO HISTÓRICO 2025");

    const nasaCard = byId("samCenNasaInstrument");
    const tmyCard = byId("samCenTmyInstrument");
    if (nasaCard) nasaCard.classList.toggle("best", nasaBetter);
    if (tmyCard) tmyCard.classList.toggle("best", !nasaBetter);
  }

  function appendIndicatorRow(tbody, row) {
    const tr = document.createElement("tr");
    tr.classList.add(getNrmseState(row.nrmse_pct).className);
    [
      row.caso_sam,
      row.referencia,
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
        labels: ["CEN inyección", "CEN disponible", "SAM TMY", "SAM NASA 2025"],
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
    const labels = tmy.map((row) => row.mes_nombre || row.mes);
    const cyan = getCssColor("--cyan", "#31b7ff");
    const yellow = getCssColor("--yellow", "#ffd21f");
    const green = getCssColor("--green", "#76ff45");
    const blue = getCssColor("--blue", "#2689ff");

    samCenState.charts.monthly = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { ...lineDataset("SAM TMY", tmy.map((row) => row.sam_e_ac_gwh), green), type: "line" },
          { ...lineDataset("SAM NASA 2025", nasa.map((row) => row.sam_e_ac_gwh), blue), type: "line" },
          barDataset("CEN disponible", tmy.map((row) => row.cen_disponible_gwh), yellow),
          barDataset("CEN inyección", tmy.map((row) => row.cen_inyeccion_gwh), cyan),
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
          barDataset("SAM TMY - CEN disponible", tmy.map((row) => row.residuo_sam_menos_cen_disp_gwh), green),
          barDataset("SAM NASA - CEN disponible", nasa.map((row) => row.residuo_sam_menos_cen_disp_gwh), blue),
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
          lineDataset("CEN inyección", tmy.map((row) => row.cen_inyeccion_prom_mwh), cyan),
          lineDataset("CEN disponible", tmy.map((row) => row.cen_disponible_prom_mwh), yellow),
          lineDataset("SAM TMY", tmy.map((row) => row.sam_e_ac_prom_mwh), green),
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
          barDataset("Curtailment CEN", tmy.map((row) => row.cen_curtailment_prom_mwh), orange, "y"),
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
    setText("samCenMeta", "Cargando data/sam_tmy_nasa_vs_cen_dashboard_bundle.json...");
    const bundle = await loadSamCenBundle();

    if (!bundle) {
      destroySamCenCharts();
      samCenState.rendered = false;
      setSamCenStatus("ERROR DATOS", true);
      setText("samCenMeta", "No se pudo cargar data/sam_tmy_nasa_vs_cen_dashboard_bundle.json");
      return;
    }

    setSamCenStatus("DATA OK");
    setText(
      "samCenMeta",
      `${bundle.metadata?.planta || "CEME1"} · ${bundle.metadata?.comparacion || "SAM vs CEN"} · ${bundle.metadata?.anio || "2025"}`
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
   SUBPESTAÑAS INTERNAS PLANTA FV (SAM)
   ============================================================ */
(function () {
  function initPlantTabs() {
    const buttons = document.querySelectorAll(".plant-tab-btn[data-plant-panel]");
    if (!buttons.length) return;

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const panelName = button.dataset.plantPanel;

        buttons.forEach((item) => {
          item.classList.toggle("active", item === button);
        });

        document.querySelectorAll(".plant-panel").forEach((panel) => {
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
