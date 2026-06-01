<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Storage Analytics | BESS Performance & Degradation Suite</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #060913; }
        .bess-grid { background-image: radial-gradient(#1e293b 1px, transparent 1px); background-size: 16px 16px; }
    </style>
</head>
<body class="bess-grid text-slate-100 min-h-screen font-sans antialiased selection:bg-cyan-500 selection:text-black">

    <header class="border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md sticky top-0 z-50 px-6 py-4">
        <div class="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
            <div class="flex items-center space-x-3">
                <div class="p-2 bg-gradient-to-br from-cyan-500 to-emerald-500 rounded-lg shadow-lg shadow-cyan-500/20">
                    <svg class="w-6 h-6 text-slate-950 font-bold" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                    </svg>
                </div>
                <div>
                    <h1 class="text-lg font-bold text-white tracking-wide">STORAGE<span class="text-cyan-400">ANALYTICS</span></h1>
                    <p class="text-xs text-slate-400">BESS Degradation & Analytics Platform</p>
                </div>
            </div>
            <div class="flex items-center space-x-4 text-xs">
                <div class="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-md text-slate-300">
                    <span class="text-slate-500 mr-1">Planta:</span> FV San Pedro IV
                </div>
                <div class="flex items-center space-x-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2.5 py-1.5 rounded-md font-medium">
                    <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                    <span>Sistema Operacional</span>
                </div>
            </div>
        </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        
        <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            
            <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-xl backdrop-blur-sm relative overflow-hidden">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-sm text-slate-400 font-medium">State of Health (SoH)</span>
                    <span class="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-500/20">Óptimo</span>
                </div>
                <div class="flex items-baseline space-x-2">
                    <span class="text-3xl font-bold text-white tracking-tight">94.2%</span>
                    <span class="text-xs text-slate-500">-1.8% este año</span>
                </div>
                <div class="w-full bg-slate-800 h-1.5 rounded-full mt-4 overflow-hidden">
                    <div class="bg-gradient-to-r from-cyan-500 to-emerald-400 h-1.5 rounded-full" style="width: 94.2%"></div>
                </div>
            </div>

            <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-xl backdrop-blur-sm">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-sm text-slate-400 font-medium">Ciclos Equivalentes (FEC)</span>
                    <span class="text-xs text-slate-400">Límite: 6000</span>
                </div>
                <div class="flex items-baseline space-x-2">
                    <span class="text-3xl font-bold text-white tracking-tight">1,428</span>
                    <span class="text-xs text-slate-400">/ 6,000</span>
                </div>
                <p class="text-[11px] text-slate-500 mt-4">Tasa de degradación dentro de la curva de garantía estándar.</p>
            </div>

            <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-xl backdrop-blur-sm">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-sm text-slate-400 font-medium">Capacidad Disponible</span>
                    <span class="text-xs text-cyan-400">BESS Container A</span>
                </div>
                <div class="flex items-baseline space-x-2">
                    <span class="text-3xl font-bold text-slate-100 tracking-tight">4.71 MWh</span>
                    <span class="text-xs text-slate-500">de 5.00 MWh Nominal</span>
                </div>
                <div class="w-full bg-slate-800 h-1.5 rounded-full mt-4 overflow-hidden">
                    <div class="bg-cyan-500 h-1.5 rounded-full" style="width: 88%"></div>
                </div>
            </div>

            <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-xl backdrop-blur-sm">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-sm text-slate-400 font-medium">Temperatura Promedio</span>
                    <span class="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-500/20">HVAC Activo</span>
                </div>
                <div class="flex items-baseline space-x-2">
                    <span class="text-3xl font-bold text-white tracking-tight">24.8 °C</span>
                    <span class="text-xs text-slate-500">Máx: 27.1°C</span>
                </div>
                <p class="text-[11px] text-slate-500 mt-4">Rango térmico ideal para mitigar degradación acelerada.</p>
            </div>
        </section>

        <section class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            <div class="bg-slate-900/60 border border-slate-800/90 p-6 rounded-xl backdrop-blur-sm lg:col-span-2 flex flex-col justify-between">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-6">
                    <div>
                        <h3 class="text-base font-bold text-white tracking-tight">Curva de Degradación de Capacidad y Proyección</h3>
                        <p class="text-xs text-slate-400">Datos históricos medidos mediante pruebas de capacidad vs modelo matemático predictivo.</p>
                    </div>
                    <div class="flex space-x-3 text-xs">
                        <span class="flex items-center"><span class="w-2.5 h-2.5 bg-cyan-400 rounded-full mr-1.5"></span> Real</span>
                        <span class="flex items-center"><span class="w-2.5 h-2.5 bg-slate-600 rounded-full mr-1.5"></span> Predictivo</span>
                    </div>
                </div>
                
                <div class="h-64 w-full flex items-end justify-between relative border-b border-l border-slate-800 px-4 pb-2">
                    <div class="absolute inset-x-0 top-0 border-t border-slate-800/40 text-[10px] text-slate-600 pt-1">100%</div>
                    <div class="absolute inset-x-0 top-1/4 border-t border-slate-800/40 text-[10px] text-slate-600 pt-1">90%</div>
                    <div class="absolute inset-x-0 top-2/4 border-t border-slate-800/40 text-[10px] text-slate-600 pt-1">80%</div>
                    <div class="absolute inset-x-0 top-3/4 border-t border-slate-800/40 text-[10px] text-slate-600 pt-1">70% (EoL)</div>

                    <div class="w-1/12 h-[98%] bg-gradient-to-t from-cyan-950/40 to-cyan-500/80 rounded-t border-t border-cyan-400 group relative">
                        <span class="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] bg-slate-950 px-1 rounded text-white opacity-0 group-hover:opacity-100 transition-opacity">98%</span>
                    </div>
                    <div class="w-1/12 h-[96%] bg-gradient-to-t from-cyan-950/40 to-cyan-500/80 rounded-t border-t border-cyan-400 group relative"></div>
                    <div class="w-1/12 h-[94%] bg-gradient-to-t from-cyan-950/40 to-cyan-500/80 rounded-t border-t border-cyan-400 group relative"></div>
                    <div class="w-1/12 h-[92%] bg-gradient-to-t from-cyan-950/40 to-cyan-500/80 rounded-t border-t border-cyan-400 group relative"></div>
                    <div class="w-1/12 h-[90%] bg-gradient-to-t from-emerald-950/60 to-emerald-400 rounded-t border-t border-emerald-300 shadow-lg shadow-emerald-500/10 group relative">
                        <span class="absolute -top-7 left-1/2 -translate-x-1/2 text-[11px] bg-emerald-500 text-slate-950 font-bold px-1.5 py-0.5 rounded whitespace-nowrap">Hoy: 94.2%</span>
                    </div>
                    <div class="w-1/12 h-[87%] bg-gradient-to-t from-slate-900/20 to-slate-700/60 rounded-t border-t border-slate-500 border-dashed"></div>
                    <div class="w-1/12 h-[85%] bg-gradient-to-t from-slate-900/20 to-slate-700/60 rounded-t border-t border-slate-500 border-dashed"></div>
                    <div class="w-1/12 h-[83%] bg-gradient-to-t from-slate-900/20 to-slate-700/60 rounded-t border-t border-slate-500 border-dashed"></div>
                    <div class="w-1/12 h-[80%] bg-gradient-to-t from-slate-900/20 to-slate-700/60 rounded-t border-t border-slate-500 border-dashed"></div>
                    <div class="w-1/12 h-[77%] bg-gradient-to-t from-slate-900/20 to-amber-600/40 rounded-t border-t border-amber-500 border-dashed"></div>
                </div>
                
                <div class="flex justify-between text-[10px] text-slate-500 mt-2 px-4 font-mono">
                    <span>Año 1</span>
                    <span>Año 2</span>
                    <span>Año 3 (Actual)</span>
                    <span>Año 4 (Proy)</span>
                    <span>Año 5 (Proy)</span>
                    <span>Año 6 (Proy)</span>
                </div>
            </div>

            <div class="bg-slate-900/60 border border-slate-800/90 p-6 rounded-xl backdrop-blur-sm flex flex-col justify-between">
                <div>
                    <h3 class="text-base font-bold text-white mb-1 tracking-tight">Estado Operacional (C-Rate)</h3>
                    <p class="text-xs text-slate-400 mb-4">Comportamiento físico e intensidad de la carga actual del banco.</p>
                    
                    <div class="bg-slate-950/80 border border-slate-800 p-4 rounded-lg mb-4">
                        <div class="flex justify-between text-xs mb-1.5">
                            <span class="text-slate-400">Estado de Carga (SoC)</span>
                            <span class="font-mono text-cyan-400 font-bold">78.5%</span>
                        </div>
                        <div class="w-full bg-slate-800 h-3 rounded-md overflow-hidden p-0.5">
                            <div class="bg-gradient-to-r from-cyan-500 to-cyan-400 h-2 rounded" style="width: 78.5%"></div>
                        </div>
                        <div class="flex justify-between text-[10px] text-slate-500 mt-1">
                            <span>Modo: Descarga</span>
                            <span>Potencia: -1.25 MW</span>
                        </div>
                    </div>

                    <h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Parámetros de Salud Celular</h4>
                    <div class="space-y-2 text-xs">
                        <div class="flex justify-between py-1.5 border-b border-slate-800/60">
                            <span class="text-slate-500">Eficiencia Coulombica</span>
                            <span class="font-mono text-slate-300">99.82%</span>
                        </div>
                        <div class="flex justify-between py-1.5 border-b border-slate-800/60">
                            <span class="text-slate-500">Resistencia Interna Promedio</span>
                            <span class="font-mono text-amber-400">+4.2% mΩ (Variación)</span>
                        </div>
                        <div class="flex justify-between py-1.5 border-b border-slate-800/60">
                            <span class="text-slate-500">Voltaje de Celda Máximo</span>
                            <span class="font-mono text-slate-300">4.18 V</span>
                        </div>
                    </div>
                </div>

                <div class="mt-4 pt-4 border-t border-slate-800/60">
                    <button class="w-full text-center bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs py-2 px-4 rounded-lg transition-colors font-medium">
                        Exportar Reporte de Degradación (CSV)
                    </button>
                </div>
            </div>
        </section>

    </main>

    <footer class="max-w-7xl mx-auto px-6 py-6 border-t border-slate-900/60 text-center text-xs text-slate-600 w-full mt-12">
        &copy; 2026 Storage Analytics Chile. Suite Analítica de Almacenamiento en Baterías de Litio.
    </footer>

</body>
</html>
