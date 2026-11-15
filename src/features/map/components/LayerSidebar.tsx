import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
  Search,
  AlertCircle,
  X,
} from 'lucide-react';
import { LAYER_CATEGORIES, PLANET_METADATA } from '@/data/planetaryCatalog';
import type {
  ActiveLayerState,
  BasemapSpec,
  LayerCategoryId,
  PlanetaryBody,
  PlanetaryLayerSpec,
  RegionPreset,
} from '@/types/planetary';

interface LayerSidebarProps {
  body: PlanetaryBody;
  layers: PlanetaryLayerSpec[];
  activeLayers: Record<string, ActiveLayerState>;
  selectedLayerId: string | null;
  onToggleLayer: (layer: PlanetaryLayerSpec) => void;
  onToggleVisibility: (layerId: string) => void;
  onChangeOpacity: (layerId: string, opacity: number) => void;
  onSelectInfo: (layerId: string) => void;
  onClearOverlays: () => void;
  basemaps: BasemapSpec[];
  activeBasemapId: string;
  onSelectBasemap: (id: string) => void;
  regions: RegionPreset[];
  onSelectRegion: (region: RegionPreset) => void;
  vectorLoadingIds: Record<string, boolean>;
  vectorCounts: Record<string, number>;
  vectorErrors?: Record<string, string>;
  onRetryVector?: (layerId: string) => void;
}

export const LayerSidebar: React.FC<LayerSidebarProps> = ({
  body,
  layers,
  activeLayers,
  selectedLayerId,
  onToggleLayer,
  onToggleVisibility,
  onChangeOpacity,
  onSelectInfo,
  onClearOverlays,
  basemaps,
  activeBasemapId,
  onSelectBasemap,
  regions,
  onSelectRegion,
  vectorLoadingIds,
  vectorCounts,
  vectorErrors,
  onRetryVector,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<LayerCategoryId, boolean>>({
    topography: false,
    geology: false,
    environment: false,
    water_resources: false,
    exploration: false,
  });

  const planetMeta = PLANET_METADATA[body];
  const activeCount = Object.keys(activeLayers).length;

  const filteredByCategory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const map: Record<LayerCategoryId, PlanetaryLayerSpec[]> = {
      topography: [],
      geology: [],
      environment: [],
      water_resources: [],
      exploration: [],
    };
    for (const layer of layers) {
      if (
        !q ||
        layer.name.toLowerCase().includes(q) ||
        layer.shortDescription.toLowerCase().includes(q) ||
        layer.instrument.toLowerCase().includes(q)
      ) {
        map[layer.category].push(layer);
      }
    }
    return map;
  }, [layers, searchQuery]);

  const toggleCategory = (catId: LayerCategoryId) => {
    setExpandedCategories((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  return (
    <aside className="w-[336px] shrink-0 bg-[#0A0E17] border-r border-slate-800 flex flex-col h-full overflow-hidden select-none">
      {/* Planet Summary Header */}
      <div className="px-4 py-3 border-b border-slate-800 bg-[#0D121D]">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">
            {planetMeta.name} Geospatial Layers
          </h2>
          <span className="text-[11px] font-mono text-slate-400">
            R = {planetMeta.meanRadiusKm.toFixed(1)} km
          </span>
        </div>
        <p className="text-[11px] text-slate-400 mt-0.5 truncate" title={planetMeta.crsLabel}>
          {planetMeta.crsLabel}
        </p>

        {/* Compact mobile/tablet basemap & region selectors when top nav hides them */}
        <div className="mt-2.5 grid grid-cols-1 gap-2 lg:hidden">
          <select
            value={activeBasemapId}
            onChange={(e) => onSelectBasemap(e.target.value)}
            className="w-full bg-[#07090E] border border-slate-800 text-slate-200 text-xs rounded px-2 py-1.5"
          >
            {basemaps.map((bm) => (
              <option key={bm.id} value={bm.id}>
                Basemap: {bm.shortName}
              </option>
            ))}
          </select>
          <select
            defaultValue=""
            onChange={(e) => {
              const found = regions.find((r) => r.id === e.target.value);
              if (found) onSelectRegion(found);
              e.target.value = '';
            }}
            className="w-full bg-[#07090E] border border-slate-800 text-slate-200 text-xs rounded px-2 py-1.5"
          >
            <option value="" disabled>
              Jump to {planetMeta.name} Region...
            </option>
            {regions.map((reg) => (
              <option key={reg.id} value={reg.id}>
                {reg.name}
              </option>
            ))}
          </select>
        </div>

        {/* Search & Active Summary */}
        <div className="mt-2.5 relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${planetMeta.name.toLowerCase()} datasets...`}
            className="w-full bg-[#07090E] border border-slate-800 focus:border-cyan-500 rounded pl-8 pr-7 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
          <span className="font-mono">
            {activeCount} active {activeCount === 1 ? 'layer' : 'layers'} · {layers.length} total
          </span>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={onClearOverlays}
              className="text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Expandable Categories */}
      <div className="flex-1 overflow-y-auto gis-scroll divide-y divide-slate-800/80">
        {LAYER_CATEGORIES.map((cat) => {
          const catLayers = filteredByCategory[cat.id];
          if (searchQuery && catLayers.length === 0) return null;
          const isOpen = searchQuery ? true : expandedCategories[cat.id];
          const activeInCat = catLayers.filter((l) => Boolean(activeLayers[l.id])).length;

          return (
            <section key={cat.id} className="bg-[#0A0E17]">
              <button
                type="button"
                onClick={() => toggleCategory(cat.id)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-[#111827] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                  <span className="text-xs font-semibold tracking-wide text-slate-200 truncate">
                    {cat.label}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-slate-400 shrink-0">
                  {activeInCat > 0 ? (
                    <span className="text-cyan-400">{activeInCat}/{catLayers.length}</span>
                  ) : (
                    <span>{catLayers.length}</span>
                  )}
                </span>
              </button>

              {isOpen && (
                <div className="divide-y divide-slate-800/50 border-t border-slate-800/50">
                  {catLayers.map((layer) => {
                    const activeState = activeLayers[layer.id];
                    const isActive = Boolean(activeState);
                    const isVisible = activeState ? activeState.visible : false;
                    const isUnavailable = layer.sourceType === 'unavailable';
                    const isSelected = selectedLayerId === layer.id;
                    const isLoadingVec = Boolean(vectorLoadingIds[layer.id]);
                    const vecCount = vectorCounts[layer.id];

                    return (
                      <div
                        key={layer.id}
                        className={`px-4 py-2.5 transition-colors ${
                          isSelected
                            ? 'bg-cyan-950/25'
                            : isActive
                            ? 'bg-[#0F1522]'
                            : 'hover:bg-[#0E131E]'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          {/* Activation Checkbox */}
                          <input
                            type="checkbox"
                            checked={isActive}
                            disabled={isUnavailable}
                            onChange={() => onToggleLayer(layer)}
                            aria-label={`Activate ${layer.name}`}
                            className="mt-0.5 h-3.5 w-3.5 rounded-sm border-slate-600 bg-[#07090E] accent-cyan-500 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed shrink-0"
                          />

                          {/* Layer Title & Meta */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-1.5">
                              <button
                                type="button"
                                onClick={() => onSelectInfo(layer.id)}
                                className={`text-left text-xs font-medium leading-snug cursor-pointer ${
                                  isUnavailable
                                    ? 'text-slate-500'
                                    : isActive
                                    ? 'text-slate-100'
                                    : 'text-slate-300 hover:text-white'
                                }`}
                              >
                                {layer.name}
                              </button>

                              {/* Controls: Visibility + Info */}
                              <div className="flex items-center gap-1 shrink-0">
                                {isActive && (
                                  <button
                                    type="button"
                                    onClick={() => onToggleVisibility(layer.id)}
                                    title={isVisible ? 'Hide layer on map' : 'Show layer on map'}
                                    className={`p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer ${
                                      isVisible ? 'text-cyan-400' : 'text-slate-500'
                                    }`}
                                    aria-label={`Toggle visibility for ${layer.name}`}
                                  >
                                    {isVisible ? (
                                      <Eye className="w-3.5 h-3.5" />
                                    ) : (
                                      <EyeOff className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onSelectInfo(layer.id)}
                                  title="Inspect dataset metadata and legend"
                                  className={`p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer ${
                                    isSelected ? 'text-cyan-300 bg-slate-800/80' : 'text-slate-400 hover:text-slate-200'
                                  }`}
                                  aria-label={`Information for ${layer.name}`}
                                >
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                              {layer.shortDescription}
                            </p>

                            {/* Unavailable or Source Status */}
                            {isUnavailable ? (
                              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-amber-400/90 font-medium">
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                <span>Unavailable globally — click info for details</span>
                              </div>
                            ) : (
                              <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                                <span>{layer.instrument}</span>
                                {layer.sourceType === 'derived_dem' && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-cyan-400/80">DEM Derived</span>
                                  </>
                                )}
                                {isActive && isLoadingVec && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-amber-300">Loading features...</span>
                                  </>
                                )}
                                {isActive && !isLoadingVec && typeof vecCount === 'number' && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-slate-300">{vecCount} features</span>
                                  </>
                                )}
                              </div>
                            )}
                            {isActive && !isLoadingVec && vectorErrors?.[layer.id] && (
                              <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded px-2 py-1">
                                <span className="truncate">{vectorErrors[layer.id]}</span>
                                {onRetryVector && (
                                  <button
                                    type="button"
                                    onClick={() => onRetryVector(layer.id)}
                                    className="text-cyan-300 hover:text-cyan-200 font-medium shrink-0 cursor-pointer"
                                  >
                                    Retry
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Opacity Slider & Inline Legend when Active */}
                            {isActive && activeState && (
                              <div className="mt-2 pt-2 border-t border-slate-800/80 space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-400 w-12 shrink-0">
                                    Opacity
                                  </span>
                                  <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={Math.round(activeState.opacity * 100)}
                                    onChange={(e) =>
                                      onChangeOpacity(layer.id, Number(e.target.value) / 100)
                                    }
                                    className="gis-slider flex-1"
                                    aria-label={`${layer.name} opacity`}
                                  />
                                  <span className="text-[10px] font-mono text-slate-300 w-8 text-right">
                                    {Math.round(activeState.opacity * 100)}%
                                  </span>
                                </div>

                                {layer.legend && layer.legend.type === 'gradient' && (
                                  <div>
                                    <div
                                      className="h-2 w-full rounded-sm border border-slate-700/70"
                                      style={{
                                        background: `linear-gradient(to right, ${layer.legend.stops
                                          .map((s) => s.color)
                                          .join(', ')})`,
                                      }}
                                    />
                                    <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 mt-0.5">
                                      <span>{layer.legend.minLabel}</span>
                                      <span>{layer.legend.maxLabel}</span>
                                    </div>
                                  </div>
                                )}

                                {layer.vectorColor && (
                                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                    <span
                                      className="inline-block w-2.5 h-2.5 rounded-sm border border-white/20"
                                      style={{ backgroundColor: layer.vectorColor }}
                                    />
                                    <span>Vector overlay ({layer.vectorGeometry || 'feature'})</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
};
