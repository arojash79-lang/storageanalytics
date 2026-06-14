let datos = [];
let indiceActual = 0;
let intervalo = null;

let operationChart;
let radiationChart;
let socChart;
let pmgChart;

const strategySelect = document.getElementById("strategySelect");
const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const speedSelect = document.getElementById("speedSelect");
const timeSlider = document.getElementById("timeSlider");

document.addEventListener("DOMContentLoaded", () => {
  crearGraficosVacios();
  cargarEstrategia();

  strategySelect.addEventListener("change", cargarEstrategia);
  playBtn.addEventListener("click", play);
  pauseBtn.addEventListener("click", pause);
  resetBtn.addEventListener("click", reset);
  timeSlider.addEventListener("input", moverSlider);
});

async function cargarEstrategia() {
  pause();

  const archivo = strategySelect.value;
  const ruta = `data/${archivo}`;

  try {
    const respuesta = await fetch(ruta);
    datos = await respuesta.json();

    if (!Array.isArray(datos) || datos.length === 0) {
      mostrarSinDatos();
      return;
    }

    indiceActual = 0;
    timeSlider.max = datos.length - 1;
    timeSlider.value = 0;

    actualizarDashboard();
  } catch (error) {
    console.warn("No se pudo cargar el archivo:", ruta);
    mostrarSinDatos();
  }
}

function play() {
  if (!datos.length) return;

  pause();

  const velocidad = Number(speedSelect.value);

  intervalo = setInterval(() => {
    if (indiceActual < datos.length - 1) {
      indiceActual++;
      timeSlider.value = indiceActual;
      actualizarDashboard();
    } else {
      pause();
    }
  }, velocidad);
}

function pause() {
  if (intervalo) {
    clearInterval(intervalo);
    intervalo = null;
  }
}

function reset() {
  pause();
  indiceActual = 0;
  timeSlider.value = 0;
  actualizarDashboard();
}

function moverSlider() {
  indiceActual = Number(timeSlider.value);
  actualizarDashboard();
}

function actualizarDashboard() {
  const d = datos[indiceActual];
  if (!d) return;

  const fecha = new Date(d.datetime);

  document.getElementById("simHour").textContent = fecha.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit"
  });

  document.getElementById("simDate").textContent = fecha.toLocaleDateString("es-CL");

  setText("ghi", d.ghi);
  setText("fv", d.fv);
  setText("curtailment", d.curtailment);
  setText("inyeccion", d.inyeccion);
  setText("carga", d.carga_bess);
  setText("descarga", d.descarga_bess);
  setText("soc", d.soc);
  setText("pmg", d.pmg);

  setText("socLarge", `${format(d.soc)}%`);
  setText("energiaAlmacenada", `${format(d.energia_almacenada)} MWh`);
  setText("soh", `${format(d.soh)} %`);
  setText("sohActual", `${format(d.soh)} %`);
  setText("efc", d.efc);

  setText("ingreso", `${formatMoney(d.ingreso_acumulado)} USD`);
  setText("costoDeg", `${formatMoney(d.costo_degradacion)} USD`);
  setText("costoDeg2", `${formatMoney(d.costo_degradacion)} USD`);
  setText("beneficio", `${formatMoney(d.beneficio_neto)} USD`);

  const perdida = d.soh ? 100 - d.soh : null;
  setText("perdidaCapacidad", perdida !== null ? `${format(perdida)} %` : "-- %");

  document.getElementById("batteryFill").style.height = `${d.soc || 0}%`;

  actualizarGraficos();
}

function actualizarGraficos() {
  const datosHastaAhora = datos.slice(0, indiceActual + 1);

  const labels = datosHastaAhora.map(d => {
    const fecha = new Date(d.datetime);
    return fecha.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  });

  operationChart.data.labels = labels;
  operationChart.data.datasets[0].data = datosHastaAhora.map(d => d.fv);
  operationChart.data.datasets[1].data = datosHastaAhora.map(d => d.inyeccion);
  operationChart.data.datasets[2].data = datosHastaAhora.map(d => d.curtailment);
  operationChart.data.datasets[3].data = datosHastaAhora.map(d => d.carga_bess);
  operationChart.data.datasets[4].data = datosHastaAhora.map(d => d.descarga_bess);
  operationChart.update();

  radiationChart.data.labels = labels;
  radiationChart.data.datasets[0].data = datosHastaAhora.map(d => d.ghi);
  radiationChart.data.datasets[1].data = datosHastaAhora.map(d => d.dni);
  radiationChart.data.datasets[2].data = datosHastaAhora.map(d => d.dhi);
  radiationChart.update();

  socChart.data.labels = labels;
  socChart.data.datasets[0].data = datosHastaAhora.map(d => d.soc);
  socChart.update();

  pmgChart.data.labels = labels;
  pmgChart.data.datasets[0].data = datosHastaAhora.map(d => d.pmg);
  pmgChart.update();
}

function crearGraficosVacios() {
  operationChart = new Chart(document.getElementById("operationChart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "Producción FV", data: [], borderColor: "#7cff4f", tension: 0.25 },
        { label: "Inyección", data: [], borderColor: "#2fa8ff", tension: 0.25 },
        { label: "Curtailment", data: [], borderColor: "#ff8a00", tension: 0.25 },
        { label: "Carga BESS", data: [], borderColor: "#38a1ff", tension: 0.25 },
        { label: "Descarga BESS", data: [], borderColor: "#bb6cff", tension: 0.25 }
      ]
    },
    options: opcionesGrafico("MW")
  });

  radiationChart = new Chart(document.getElementById("radiationChart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "GHI", data: [], borderColor: "#ffd23f", tension: 0.25 },
        { label: "DNI", data: [], borderColor: "#ff8a00", tension: 0.25 },
        { label: "DHI", data: [], borderColor: "#2fa8ff", tension: 0.25 }
      ]
    },
    options: opcionesGrafico("W/m²")
  });

  socChart = new Chart(document.getElementById("socChart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "SOC", data: [], borderColor: "#bb6cff", tension: 0.25 }
      ]
    },
    options: opcionesGrafico("%")
  });

  pmgChart = new Chart(document.getElementById("pmgChart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "PMg", data: [], borderColor: "#a77dff", tension: 0.25 }
      ]
    },
    options: opcionesGrafico("USD/MWh")
  });
}

function opcionesGrafico(tituloEje) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: "#dce8f7"
        }
      }
    },
    scales: {
      x: {
        ticks: { color: "#aab8c8" },
        grid: { color: "rgba(255,255,255,0.06)" }
      },
      y: {
        title: {
          display: true,
          text: tituloEje,
          color: "#aab8c8"
        },
        ticks: { color: "#aab8c8" },
        grid: { color: "rgba(255,255,255,0.06)" }
      }
    }
  };
}

function mostrarSinDatos() {
  datos = [];
  indiceActual = 0;
  timeSlider.max = 0;
  timeSlider.value = 0;

  const ids = [
    "simHour", "simDate", "ghi", "fv", "curtailment", "inyeccion",
    "carga", "descarga", "soc", "pmg", "socLarge", "energiaAlmacenada",
    "soh", "sohActual", "efc", "ingreso", "costoDeg", "costoDeg2",
    "beneficio", "perdidaCapacidad"
  ];

  ids.forEach(id => setText(id, "--"));

  document.getElementById("strategyName").textContent = "Sin datos";
  document.getElementById("batteryFill").style.height = "0%";

  limpiarGraficos();
}

function limpiarGraficos() {
  [operationChart, radiationChart, socChart, pmgChart].forEach(chart => {
    chart.data.labels = [];
    chart.data.datasets.forEach(dataset => dataset.data = []);
    chart.update();
  });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;

  if (value === undefined || value === null || Number.isNaN(value)) {
    el.textContent = "--";
  } else {
    el.textContent = value;
  }
}

function format(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return "--";
  return Number(value).toLocaleString("es-CL", {
    maximumFractionDigits: 2
  });
}

function formatMoney(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return "--";
  return Number(value).toLocaleString("es-CL", {
    maximumFractionDigits: 0
  });
}
