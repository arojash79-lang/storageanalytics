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
