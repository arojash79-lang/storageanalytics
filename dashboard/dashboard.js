let datos = [];
let indiceActual = 0;
let intervalo = null;
let charts = {};

const $ = (id) => document.getElementById(id);
const strategySelectValue = () => window.currentStrategyFile || "estrategia_A.json";

const demoRows = createDemoDay();

window.addEventListener("DOMContentLoaded", () => {
  buildCharts();
  bindEvents();
  cargarEstrategia("estrategia_A.json");
  cargarComparador();
});

function bindEvents(){
  $("playBtn").addEventListener("click", play);
  $("pauseBtn").addEventListener("click", pause);
  $("resetBtn").addEventListener("click", reset);
  $("timeSlider").addEventListener("input", () => { indiceActual = Number($("timeSlider").value); update(); });
  $("changeStrategyBtn").addEventListener("click", () => {
    const next = strategySelectValue() === "estrategia_A.json" ? "estrategia_B.json" : strategySelectValue() === "estrategia_B.json" ? "estrategia_C.json" : "estrategia_A.json";
    cargarEstrategia(next);
  });
}

async function cargarEstrategia(file){
  pause();
  window.currentStrategyFile = file;
  try{
    const res = await fetch(`data/${file}`, {cache:"no-store"});
    const json = await res.json();
    if(Array.isArray(json) && json.length){ datos = json; }
    else { datos = demoRows; }
  }catch(e){
    datos = demoRows;
  }
  indiceActual = Math.min(indiceActual, datos.length-1);
  $("timeSlider").max = datos.length-1;
  $("timeSlider").value = indiceActual;
  updateStrategyLabel(file);
  update();
}

function updateStrategyLabel(file){
  const names = {
    "estrategia_A.json":"Beneficio Neto",
    "estrategia_B.json":"Umbral de Precio",
    "estrategia_C.json":"SOC Conservador"
  };
  $("strategyName").innerHTML = `<span class="badge-dot"></span> ${names[file] || "Sin datos"}`;
  $("strategyDescription").textContent = names[file] === "Beneficio Neto" ? "Maximiza el beneficio neto considerando ingresos y degradación del BESS." : "Estrategia preliminar para análisis comparativo.";
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
  const dd = validDate(date) ? date.toLocaleDateString("es-CL") : "Sin datos";

  set("simHour", hh); set("simDate", dd); set("sliderBubble", hh);
  set("ghi", n(d.ghi)); set("fv", n(d.fv)); set("curtailment", n(d.curtailment)); set("inyeccion", n(d.inyeccion));
  set("carga", n(d.carga_bess)); set("descarga", n(d.descarga_bess)); set("soc", n(d.soc)); set("pmg", n(d.pmg,1));
  set("socLarge", `${n(d.soc)}%`); set("energiaAlmacenada", `${n(d.energia_almacenada)} MWh`);
  set("energiaNominal", `${n(d.energia_nominal || 960)} MWh`); set("pMaxCarga", `${n(d.pmax_carga || 240)} MW`);
  set("pMaxDescarga", `${n(d.pmax_descarga || 240)} MW`); set("eficiencia", `${n(d.eficiencia || 90.2,1)} %`);
  set("temperatura", `${n(d.temperatura || 26.4,1)} °C`); set("soh", `${n(d.soh,2)} %`); set("sohActual", `${n(d.soh,2)} %`);
  set("efc", n(d.efc,1)); set("perdidaCapacidad", `${n(100 - (d.soh || 100),2)} %`);
  set("ingreso", `USD ${money(d.ingreso_acumulado)}`); set("costoDeg", `USD ${money(d.costo_degradacion)}`);
  set("costoDeg2", `USD ${money(d.costo_degradacion)}`); set("beneficio", `USD ${money(d.beneficio_neto)}`);
  set("ghiSub", `Máx. día: ${n(max(dayRows,"ghi"))} W/m²`); set("fvSub", `Máx. día: ${n(max(dayRows,"fv"))} MW`);
  const pctCurt = d.fv ? (d.curtailment/d.fv)*100 : 0; const pctInj = d.fv ? (d.inyeccion/d.fv)*100 : 0;
  set("curtSub", `${n(pctCurt,1)}% de la producción`); set("injSub", `${n(pctInj,1)}% de la producción`);
  set("pmgSub", `Promedio día: ${n(avg(dayRows,"pmg"),1)}`);

  set("energiaFvDia", `${n(sum(rowsUntil,"fv"))} MWh`); set("energiaInyDia", `${n(sum(rowsUntil,"inyeccion"))} MWh`);
  set("curtailmentDia", `${n(sum(rowsUntil,"curtailment"))} MWh`); set("cargaDia", `${n(sum(rowsUntil,"carga_bess"))} MWh`);
  set("descargaDia", `${n(sum(rowsUntil,"descarga_bess"))} MWh`); set("curtRecDia", `${n(sum(rowsUntil,"carga_bess"))} MWh`);

  $("batteryFill").style.height = `${Math.max(0, Math.min(100, d.soc || 0))}%`;
  updateCharts(dayRows, rowsUntil);
}

function updateCharts(dayRows, rowsUntil){
  const labels = dayRows.map(x => hourLabel(x.datetime));
  const labelsUntil = rowsUntil.map(x => hourLabel(x.datetime));
  setChart(charts.operation, labels, ["fv","inyeccion","curtailment","carga_bess","descarga_bess","pmg"].map(k => dayRows.map(x => x[k] || 0)));
  setChart(charts.radiation, labels, ["ghi","dni","dhi"].map(k => dayRows.map(x => x[k] || 0)));
  setChart(charts.soc, labels, [dayRows.map(x => x.soc || 0)]);
  setChart(charts.pmg, labels, [dayRows.map(x => x.pmg || 0)]);
  setChart(charts.sparkGhi, labelsUntil, [rowsUntil.map(x=>x.ghi||0)]);
  setChart(charts.sparkFv, labelsUntil, [rowsUntil.map(x=>x.fv||0)]);
  setChart(charts.sparkCurt, labelsUntil, [rowsUntil.map(x=>x.curtailment||0)]);
  setChart(charts.sparkInj, labelsUntil, [rowsUntil.map(x=>x.inyeccion||0)]);
  setChart(charts.sparkCarga, labelsUntil, [rowsUntil.map(x=>x.carga_bess||0)]);
  setChart(charts.sparkDescarga, labelsUntil, [rowsUntil.map(x=>x.descarga_bess||0)]);
  setChart(charts.sparkPmg, labelsUntil, [rowsUntil.map(x=>x.pmg||0)]);
}

function buildCharts(){
  charts.operation = lineChart("operationChart", ["Producción FV","Inyección","Curtailment","Carga BESS","Descarga BESS","PMg"], ["#76ff45","#31b7ff","#ff8a00","#2689ff","#b46cff","#ffd21f"], false);
  charts.radiation = lineChart("radiationChart", ["GHI","DNI","DHI"], ["#ffd21f","#ff8a00","#31b7ff"], false);
  charts.soc = lineChart("socChart", ["SOC"], ["#b46cff"], false);
  charts.pmg = lineChart("pmgChart", ["PMg"], ["#9b78ff"], false);
  charts.sparkGhi = lineChart("sparkGhi", ["GHI"], ["#ffd21f"], true);
  charts.sparkFv = lineChart("sparkFv", ["FV"], ["#76ff45"], true);
  charts.sparkCurt = lineChart("sparkCurt", ["Curt"], ["#ff8a00"], true);
  charts.sparkInj = lineChart("sparkInj", ["Iny"], ["#76ff45"], true);
  charts.sparkCarga = lineChart("sparkCarga", ["Carga"], ["#2689ff"], true);
  charts.sparkDescarga = lineChart("sparkDescarga", ["Desc"], ["#b46cff"], true);
  charts.sparkPmg = lineChart("sparkPmg", ["PMg"], ["#9b78ff"], true);
}

function lineChart(id, labels, colors, spark=false){
  const ctx = $(id);
  return new Chart(ctx, {type:"line",data:{labels:[],datasets:labels.map((label,i)=>({label,data:[],borderColor:colors[i],backgroundColor:colors[i]+"22",borderWidth:spark?1.5:2,pointRadius:0,tension:.28,fill:false}))},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:!spark,labels:{color:"#dbe9fa",boxWidth:18,font:{size:10}}},tooltip:{enabled:!spark}},scales:{x:{display:!spark,ticks:{color:"#b9c7d8",maxTicksLimit:9,font:{size:10}},grid:{color:"rgba(255,255,255,.05)"}},y:{display:!spark,ticks:{color:"#b9c7d8",font:{size:10}},grid:{color:"rgba(255,255,255,.06)"}}}}});
}
function setChart(chart, labels, arrays){ chart.data.labels=labels; arrays.forEach((arr,i)=>{ if(chart.data.datasets[i]) chart.data.datasets[i].data=arr; }); chart.update("none"); }

async function cargarComparador(){
  try{ const res = await fetch("data/comparador_estrategias.json", {cache:"no-store"}); const json = await res.json(); if(Array.isArray(json) && json.length){ renderTable(json); return; } }catch(e){}
  renderTable([
    {estrategia:"Recuperación Máxima", ingreso:10850000, costo:2450000, neto:8400000, soh:91.2, efc:328.4, curtailment:18250, usd_mwh:28.7, usd_soh:26865},
    {estrategia:"Umbral de Precio (PMg)", ingreso:11230000, costo:2890000, neto:8340000, soh:93.4, efc:265.1, curtailment:16120, usd_mwh:31.4, usd_soh:30944},
    {estrategia:"SOC Conservador", ingreso:9250000, costo:1320000, neto:7930000, soh:96.5, efc:148.2, curtailment:9450, usd_mwh:35.6, usd_soh:36629},
    {estrategia:"Vida Útil Prioritaria", ingreso:8150000, costo:980000, neto:7170000, soh:97.8, efc:96.4, curtailment:6210, usd_mwh:38.2, usd_soh:39645},
    {estrategia:"Beneficio Neto (Actual)", ingreso:11180000, costo:2720000, neto:8460000, soh:94.6, efc:232.7, curtailment:15330, usd_mwh:32.8, usd_soh:28732, highlight:true}
  ]);
}
function renderTable(rows){
  $("strategyTable").innerHTML = rows.map(r => `<tr class="${r.highlight?'highlight':''}"><td>${r.highlight?'★ ':''}${r.estrategia}</td><td>${money(r.ingreso)}</td><td>${money(r.costo)}</td><td>${money(r.neto)}</td><td>${n(r.soh,1)}</td><td>${n(r.efc,1)}</td><td>${money(r.curtailment)}</td><td>${n(r.usd_mwh,1)}</td><td>${money(r.usd_soh)}</td></tr>`).join("");
  const best = rows.slice().sort((a,b)=>(b.neto||0)-(a.neto||0))[0];
  if(best){ set("recommendedStrategy", best.estrategia); set("recommendationText", "La estrategia seleccionada maximiza el beneficio neto considerando ingresos y degradación del BESS."); }
}

function createDemoDay(){
  const arr=[]; let soc=50; let ingreso=0; let deg=0; let efc=0;
  for(let h=0;h<24;h++){
    const solar = Math.max(0, Math.sin((h-5)/15*Math.PI));
    const ghi = Math.round(1100*Math.pow(solar,1.15));
    const dni = Math.round(760*Math.pow(solar,1.1));
    const dhi = Math.round(360*Math.pow(solar,.9));
    const fv = Math.round(650*Math.pow(solar,1.05));
    const curtailment = h>=8 && h<=16 ? Math.round(Math.max(0,fv-430)*(0.7+0.25*Math.sin(h))) : 0;
    const carga = h>=7 && h<=13 ? Math.min(curtailment,180) : 0;
    const descarga = h>=19 && h<=22 ? Math.round(60+55*Math.sin((h-19)/3*Math.PI)) : 0;
    soc = Math.max(8,Math.min(98,soc + carga/24 - descarga/18));
    const pmg = h<5 ? 40+5*Math.sin(h) : h<9 ? 18+3*Math.sin(h) : h<17 ? 14+8*Math.random() : 32+14*Math.sin((h-17)/5*Math.PI);
    ingreso += descarga*pmg; deg += (carga+descarga)*0.55; efc += descarga/960;
    arr.push({datetime:`2025-05-15T${String(h).padStart(2,"0")}:00:00`,ghi,dni,dhi,fv,curtailment,inyeccion:Math.max(0,fv-curtailment),carga_bess:carga,descarga_bess:descarga,soc:Math.round(soc),soh:99.05-(efc*.002),pmg:Number(pmg.toFixed(1)),energia_almacenada:Math.round(soc/100*960),energia_nominal:960,pmax_carga:240,pmax_descarga:240,eficiencia:90.2,temperatura:26.4,efc:Number((23.6+efc).toFixed(1)),ingreso_acumulado:Math.round(125430+ingreso),costo_degradacion:Math.round(8230+deg),beneficio_neto:Math.round(117200+ingreso-deg)});
  }
  return arr;
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
  const PLANT_SAM_BUNDLE_URL = "data/planta_fv_sam_dashboard_bundle.json";

  const plantEnergyState = {
    loaded: false,
    rendered: false,
    bundle: null,
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

  async function loadPlantBundle() {
    if (plantEnergyState.loaded && plantEnergyState.bundle) {
      return plantEnergyState.bundle;
    }

    try {
      const response = await fetch(PLANT_SAM_BUNDLE_URL, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const bundle = await response.json();
      plantEnergyState.bundle = bundle;
      plantEnergyState.loaded = true;

      return bundle;
    } catch (error) {
      console.error("No se pudo cargar el bundle Planta FV SAM:", error);
      return null;
    }
  }

  function renderPlantEnergyKpis(kpis) {
    if (!kpis) return;

    setText("plantKpiAcNetAnnual", formatNumber(kpis.energia_ac_neta_gwh_anio, 1));
    setText("plantKpiDcAnnual", formatNumber(kpis.energia_dc_gwh_anio, 1));
    setText("plantKpiAcNominal", formatNumber(kpis.potencia_ac_nominal_mwac, 1));
    setText("plantKpiDcNominal", formatNumber(kpis.potencia_dc_nominal_mwp, 1));
    setText("plantKpiAcMax", formatNumber(kpis.potencia_ac_maxima_mw, 1));
    setText("plantKpiCapacityFactor", formatNumber(kpis.factor_planta_ac_pct, 1));
    setText("plantKpiPerformanceRatio", asPercent(kpis.performance_ratio_ponderado));
    setText("plantKpiPoaEast", formatInteger(kpis.poa_este_anual_kwh_m2));
    setText("plantKpiPoaWest", formatInteger(kpis.poa_oeste_anual_kwh_m2));
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

  async function renderPlantEnergyView() {
    if (plantEnergyState.rendered) return;

    setText("plantEnergyStatus", "CARGANDO");
    const bundle = await loadPlantBundle();

    if (!bundle) {
      setText("plantEnergyStatus", "ERROR DATOS");
      byId("plantEnergyStatus")?.classList.add("error");
      setText("plantEnergyMeta", "No se pudo cargar data/planta_fv_sam_dashboard_bundle.json");
      return;
    }

    const statusEl = byId("plantEnergyStatus");
    if (statusEl) statusEl.classList.remove("error");
    setText("plantEnergyStatus", "DATOS OK");
    setText(
      "plantEnergyMeta",
      `${bundle.metadata?.herramienta || "SAM"} · ${bundle.metadata?.fuente_meteorologica || "TMY Explorador Solar"} · ${bundle.metadata?.resolucion || "horaria"}`
    );

    renderPlantEnergyKpis(bundle.kpis);
    destroyPlantCharts();
    renderPlantMonthlyEnergy(bundle.mensual);
    renderPlantHourlyProfile(bundle.perfil_horario);
    renderPlantPoaOrientation(bundle.mensual);
    renderPlantSubmodelEnergy(bundle.submodelos);
    renderPlantOrientationBalance(bundle.balance_orientacion);

    plantEnergyState.rendered = true;
  }

  window.renderPlantEnergyView = renderPlantEnergyView;
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
          window.renderPlantEnergyView?.();
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
