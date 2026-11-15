import React from 'react';
import {
  AlertTriangle,
  Crosshair,
  Database,
  Layers,
  MapPin,
  Ruler,
  Trash2,
} from 'lucide-react';
import { LAYER_CATEGORIES, PLANET_METADATA } from '@/data/planetaryCatalog';
import { formatLat, formatLon } from '@/utils/planetaryMath';
import type {
  ActiveLayerState,
  ElevationProfilePoint,
  LocationProbeResult,
  PlanetaryLayerSpec,
} from '@/types/planetary';

interface LayerInfoPanelProps {
  activeTab: 'info' | 'probe';
  onChangeTab: (tab: 'info' | 'probe') => void;
  selectedLayer: PlanetaryLayerSpec | null;
  activeLayerState: ActiveLayerState | undefined;
  onToggleLayer: (layer: PlanetaryLayerSpec) => void;
  onChangeOpacity: (layerId: string, opacity: number) => void;
  probe: LocationProbeResult | null;
  profilePoints: ElevationProfilePoint[];
  profileLoading: boolean;
  profileError?: string | null;
  onClearProfile: () => void;
  onRetryElevation: () => void;
}

function getSourceStatusLabel(layer: PlanetaryLayerSpec): {
  glyph: string;
  label: string;
  tone: string;
} {
  switch (layer.sourceType) {
    case 'wmts':
    case 'arcgis_tile':
      return { glyph: '●', label: 'Live NASA / USGS Tile Stream', tone: 'text-emerald-400' };
    case 'derived_dem':
      return { glyph: '◆', label: 'Derived Live from DEM Tiles', tone: 'text-cyan-400' };
    case 'vector_geojson':
      return { glyph: '■', label: 'Live GeoJSON Feature Catalog', tone: 'text-sky-400' };
    case 'unavailable':
      return { glyph: '✖', label: 'Unavailable Global Raster', tone: 'text-amber-400' };
  }
}

export const LayerInfoPanel: React.FC<LayerInfoPanelProps> = ({
  activeTab,
  onChangeTab,
  selectedLayer,
  activeLayerState,
  onToggleLayer,
  onChangeOpacity,
  probe,
  profilePoints,
  profileLoading,
  profileError,
  onClearProfile,
  onRetryElevation,
}) => {
  const renderProfileChart = () => {
    const validPts = profilePoints.filter(
      (p): p is ElevationProfilePoint & { elevationM: number } => p.elevationM !== null
    );
    if (profileLoading) {
      return (
        <div className="p-3 bg-[#07090E] border border-slate-800 rounded text-xs text-slate-400 font-mono">
          Sampling NASA DEM transect...
        </div>
      );
    }
    if (profileError) {
      return (
        <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded space-y-1.5 text-xs text-amber-200">
          <div className="flex items-center justify-between">
            <span className="font-medium">Elevation Transect Unavailable</span>
            <button
              type="button"
              onClick={onClearProfile}
              className="text-[11px] text-slate-300 hover:text-white cursor-pointer"
            >
              Clear
            </button>
          </div>
          <p className="text-amber-200/80">{profileError}</p>
        </div>
      );
    }
    if (profilePoints.length === 0) return null;
    if (validPts.length < 2) {
      return (
        <div className="p-3 bg-[#07090E] border border-slate-800 rounded text-xs text-amber-400">
          Elevation transect returned insufficient valid DEM samples at this location.
        </div>
      );
    }

    const minE = Math.min(...validPts.map((p) => p.elevationM));
    const maxE = Math.max(...validPts.map((p) => p.elevationM));
    const spanE = Math.max(10, maxE - minE);
    const maxD = Math.max(1, validPts[validPts.length - 1].distanceKm);

    const width = 280;
    const height = 110;
    const padX = 8;
    const padY = 12;

    const coords = validPts.map((pt) => {
      const x = padX + (pt.distanceKm / maxD) * (width - padX * 2);
      const y = height - padY - ((pt.elevationM - minE) / spanE) * (height - padY * 2);
      return { x, y, pt };
    });

    const linePath = coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padY} L ${coords[0].x.toFixed(1)} ${height - padY} Z`;

    return (
      <div className="p-3 bg-[#07090E] border border-slate-800 rounded space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Ruler className="w-3.5 h-3.5 text-amber-400" />
            <span>Elevation Profile</span>
          </div>
          <button
            type="button"
            onClick={onClearProfile}
            className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28 overflow-visible">
          <line x1={padX} y1={padY} x2={width - padX} y2={padY} stroke="#1e293b" strokeDasharray="2 2" />
          <line x1={padX} y1={height / 2} x2={width - padX} y2={height / 2} stroke="#1e293b" strokeDasharray="2 2" />
          <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#334155" />
          <path d={areaPath} fill="rgba(6, 182, 212, 0.16)" />
          <path d={linePath} fill="none" stroke="#22d3ee" strokeWidth={1.75} />
        </svg>

        <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-slate-300 border-t border-slate-800 pt-2">
          <div>
            <div className="text-slate-500">Min Elev</div>
            <div>{minE.toFixed(0)} m</div>
          </div>
          <div>
            <div className="text-slate-500">Max Elev</div>
            <div>{maxE.toFixed(0)} m</div>
          </div>
          <div>
            <div className="text-slate-500">Span</div>
            <div>{maxD.toFixed(1)} km</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside className="w-[340px] shrink-0 bg-[#0A0E17] border-l border-slate-800 flex flex-col h-full overflow-hidden">
      {/* Tab Selector */}
      <div className="grid grid-cols-2 border-b border-slate-800 bg-[#0D121D] shrink-0">
        <button
          type="button"
          onClick={() => onChangeTab('info')}
          className={`py-2.5 px-3 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'info'
              ? 'border-cyan-400 text-slate-100 bg-[#0A0E17]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Layer Info</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeTab('probe')}
          className={`py-2.5 px-3 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'probe'
              ? 'border-cyan-400 text-slate-100 bg-[#0A0E17]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>Datos del planeta</span>
        </button>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-y-auto gis-scroll p-4 space-y-4">
        {activeTab === 'info' ? (
          selectedLayer ? (
            <>
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
                  <span>{PLANET_METADATA[selectedLayer.body].name}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {LAYER_CATEGORIES.find((c) => c.id === selectedLayer.category)?.label}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-slate-100 mt-1 leading-snug">
                  {selectedLayer.name}
                </h3>

                {(() => {
                  const st = getSourceStatusLabel(selectedLayer);
                  return (
                    <div className={`mt-1.5 text-xs font-medium flex items-center gap-1.5 ${st.tone}`}>
                      <span aria-hidden="true">{st.glyph}</span>
                      <span>{st.label}</span>
                    </div>
                  );
                })()}
              </div>

              {/* Activation & Opacity Bar */}
              {selectedLayer.sourceType === 'unavailable' ? (
                <div className="p-3 rounded bg-amber-950/30 border border-amber-800/50 text-xs text-amber-200 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Dataset Unavailable as Global Layer</span>
                  </div>
                  <p className="text-amber-200/80 leading-relaxed">
                    {selectedLayer.unavailableReason}
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded bg-[#0F1522] border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-300">
                      {activeLayerState ? 'Layer active on map' : 'Layer currently inactive'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onToggleLayer(selectedLayer)}
                      className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                        activeLayerState
                          ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                          : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                      }`}
                    >
                      {activeLayerState ? 'Deactivate' : 'Activate Layer'}
                    </button>
                  </div>

                  {activeLayerState && (
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                      <span className="text-[11px] text-slate-400">Opacity</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(activeLayerState.opacity * 100)}
                        onChange={(e) =>
                          onChangeOpacity(selectedLayer.id, Number(e.target.value) / 100)
                        }
                        className="gis-slider flex-1"
                      />
                      <span className="text-[11px] font-mono text-slate-200 w-9 text-right">
                        {Math.round(activeLayerState.opacity * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Scientific Description */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-1">
                  Scientific Description
                </h4>
                <p className="text-xs text-slate-300/90 leading-relaxed">
                  {selectedLayer.scientificDescription}
                </p>
              </div>

              {/* Legend */}
              {selectedLayer.legend && (
                <div className="p-3 rounded bg-[#07090E] border border-slate-800 space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="text-xs font-semibold text-slate-200">
                      {selectedLayer.legend.title}
                    </h4>
                    <span className="text-[10px] font-mono text-slate-400">
                      Unit: {selectedLayer.legend.unit}
                    </span>
                  </div>

                  {selectedLayer.legend.type === 'gradient' ? (
                    <>
                      <div
                        className="h-3 w-full rounded-sm border border-slate-700"
                        style={{
                          background: `linear-gradient(to right, ${selectedLayer.legend.stops
                            .map((s) => s.color)
                            .join(', ')})`,
                        }}
                      />
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-300">
                        <span>{selectedLayer.legend.minLabel}</span>
                        <span>{selectedLayer.legend.midLabel}</span>
                        <span>{selectedLayer.legend.maxLabel}</span>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      {selectedLayer.legend.stops.map((stop) => (
                        <div key={stop.label} className="flex items-center gap-2 text-xs text-slate-300">
                          <span
                            className="w-3 h-3 rounded-sm border border-white/15 shrink-0"
                            style={{ backgroundColor: stop.color }}
                          />
                          <span className="leading-snug">{stop.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Technical Metadata Table */}
              <div className="border-t border-slate-800 pt-3 space-y-2.5 text-xs">
                <h4 className="text-xs font-semibold text-slate-300">
                  Dataset Specifications
                </h4>
                <dl className="space-y-2">
                  <div className="grid grid-cols-[110px_1fr] gap-2">
                    <dt className="text-slate-400">Planetary Body</dt>
                    <dd className="text-slate-200 font-medium">
                      {PLANET_METADATA[selectedLayer.body].name}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[110px_1fr] gap-2">
                    <dt className="text-slate-400">Data Source</dt>
                    <dd className="text-slate-200 break-words">{selectedLayer.dataSource}</dd>
                  </div>
                  <div className="grid grid-cols-[110px_1fr] gap-2">
                    <dt className="text-slate-400">Instrument</dt>
                    <dd className="text-slate-200">{selectedLayer.instrument}</dd>
                  </div>
                  <div className="grid grid-cols-[110px_1fr] gap-2">
                    <dt className="text-slate-400">Spatial Resolution</dt>
                    <dd className="text-slate-200 font-mono text-[11px]">
                      {selectedLayer.spatialResolution}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[110px_1fr] gap-2">
                    <dt className="text-slate-400">Units</dt>
                    <dd className="text-slate-200 font-mono text-[11px]">
                      {selectedLayer.units}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[110px_1fr] gap-2">
                    <dt className="text-slate-400">Coverage</dt>
                    <dd className="text-slate-200">{selectedLayer.geographicCoverage}</dd>
                  </div>
                </dl>
              </div>

              {/* Limitations */}
              <div className="border-t border-slate-800 pt-3">
                <h4 className="text-xs font-semibold text-slate-300 mb-1">
                  Data Limitations &amp; Caveats
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {selectedLayer.dataLimitations}
                </p>
              </div>
            </>
          ) : (
            <div className="py-12 text-center space-y-2 text-slate-400">
              <Layers className="w-7 h-7 mx-auto text-slate-600" />
              <p className="text-xs">
                Select any dataset or info icon in the left sidebar to inspect scientific metadata, resolution, units, and legends.
              </p>
            </div>
          )
        ) : (
          /* Location Probe Tab */
          <div className="space-y-4">
            {probe ? (
              <>
                <div className="p-3 bg-[#07090E] border border-slate-800 rounded space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                      <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Datos del planeta</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">
                      {PLANET_METADATA[probe.body].name}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 text-xs font-mono border-t border-slate-800 pt-2">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Latitud</span>
                      <span className="text-slate-100">{formatLat(probe.lat)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Longitud</span>
                      <span className="text-slate-100">{formatLon(probe.lon)}</span>
                    </div>
                  </div>
                </div>

                {/* Live Elevation Readout */}
                <div className="p-3 bg-[#0F1522] border border-slate-800 rounded space-y-1.5">
                  <div className="text-[11px] text-slate-400">
                    Elevación ({PLANET_METADATA[probe.body].elevationDatum})
                  </div>
                  {probe.elevationLoading ? (
                    <div className="text-sm font-mono text-cyan-400">Consultando modelo de elevación NASA...</div>
                  ) : probe.elevationError ? (
                    <div className="space-y-2">
                      <div className="text-xs text-amber-400">{probe.elevationError}</div>
                      <button
                        type="button"
                        onClick={onRetryElevation}
                        className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/20"
                      >
                        Reintentar consulta NASA DEM
                      </button>
                    </div>
                  ) : probe.elevationM !== null ? (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-mono font-semibold text-slate-100">
                        {probe.elevationM > 0 ? `+${probe.elevationM.toLocaleString()}` : probe.elevationM.toLocaleString()}
                      </span>
                      <span className="text-xs font-mono text-slate-400">m</span>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">Sin datos en esta coordenada</div>
                  )}
                  <div className="text-[10px] text-slate-500">{probe.elevationSource}</div>
                </div>

                {/* Elevation Profile Chart */}
                {renderProfileChart()}

                {/* Nearby Landmarks */}
                <div className="border-t border-slate-800 pt-3 space-y-2">
                  <h4 className="text-xs font-semibold text-slate-300">
                    Nearest Cataloged Features
                  </h4>
                  {probe.nearbyFeatures.length > 0 ? (
                    <ul className="divide-y divide-slate-800/70 border border-slate-800 rounded bg-[#07090E]">
                      {probe.nearbyFeatures.map((feat, idx) => (
                        <li key={`${feat.name}-${idx}`} className="px-3 py-2 text-xs">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium text-slate-200 truncate">{feat.name}</span>
                            <span className="font-mono text-[11px] text-cyan-400 shrink-0">
                              {feat.distanceKm.toFixed(1)} km
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                            <span>{feat.type}</span>
                            {typeof feat.diameterKm === 'number' && feat.diameterKm > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono">Ø {feat.diameterKm.toFixed(1)} km</span>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Activate vector feature layers (Landing Sites, Craters, PSRs) to measure proximity to nearby targets.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="py-8 text-center space-y-2 text-slate-400 border border-slate-800 rounded bg-[#07090E] px-4">
                  <Crosshair className="w-6 h-6 mx-auto text-cyan-500/70" />
                  <p className="text-xs">
                    Click anywhere on the 2D Map or 3D Globe to inspect exact planetary coordinates, live NASA LOLA/MOLA elevation, and nearby geological features.
                  </p>
                </div>
                {renderProfileChart()}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
