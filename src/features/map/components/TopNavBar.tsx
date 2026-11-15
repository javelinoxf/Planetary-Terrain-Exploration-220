import React from 'react';
import {
  Compass,
  Globe,
  Grid,
  House,
  Layers,
  Map as MapIcon,
  Mountain,
  RotateCcw,
  Ruler,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import type { BasemapSpec, PlanetaryBody, RegionPreset } from '@/types/planetary';

interface TopNavBarProps {
  body: PlanetaryBody;
  onSelectBody: (body: PlanetaryBody) => void;
  onGoHome: () => void;
  viewMode: '2d' | '3d' | 'analog' | 'general';
  onChangeViewMode: (mode: '2d' | '3d' | 'analog' | 'general') => void;
  basemaps: BasemapSpec[];
  activeBasemapId: string;
  onSelectBasemap: (id: string) => void;
  regions: RegionPreset[];
  onSelectRegion: (region: RegionPreset) => void;
  showGraticule: boolean;
  onToggleGraticule: () => void;
  profileMode: boolean;
  onToggleProfileMode: () => void;
  onResetView: () => void;
  leftOpen: boolean;
  onToggleLeft: () => void;
  rightOpen: boolean;
  onToggleRight: () => void;
}

export const TopNavBar: React.FC<TopNavBarProps> = ({
  body,
  onSelectBody,
  onGoHome,
  viewMode,
  onChangeViewMode,
  basemaps,
  activeBasemapId,
  onSelectBasemap,
  regions,
  onSelectRegion,
  showGraticule,
  onToggleGraticule,
  profileMode,
  onToggleProfileMode,
  onResetView,
  leftOpen,
  onToggleLeft,
  rightOpen,
  onToggleRight,
}) => {
  return (
    <header className="h-13 shrink-0 bg-[#0A0E17] border-b border-slate-800 px-3 flex items-center justify-between gap-4 select-none z-30">
      {/* Left: Sidebar Toggle + Brand + Planet Switcher */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onGoHome}
          title="Back to start"
          aria-label="Back to start"
          className="p-1.5 rounded border border-slate-800 bg-[#0F141F] text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer shrink-0"
        >
          <House className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onToggleLeft}
          title={leftOpen ? 'Collapse layer sidebar' : 'Expand layer sidebar'}
          className="p-1.5 rounded border border-slate-800 bg-[#0F141F] text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer shrink-0"
        >
          {leftOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
        </button>

        <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold tracking-tight text-slate-100">
            Selene &amp; Ares Explorer
          </span>
        </div>

        <div className="h-5 w-px bg-slate-800 shrink-0" />

        {/* Planetary Body Switcher */}
        <div
          role="group"
          aria-label="Planetary Body Selection"
          className="flex items-center bg-[#060910] border border-slate-800 rounded p-0.5 shrink-0"
        >
          <button
            type="button"
            onClick={() => onSelectBody('moon')}
            className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              body === 'moon'
                ? 'bg-slate-200 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Moon
          </button>
          <button
            type="button"
            onClick={() => onSelectBody('mars')}
            className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              body === 'mars'
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Mars
          </button>
        </div>

        <select
          aria-label="View mode"
          value={viewMode}
          onChange={(event) =>
            onChangeViewMode(event.target.value as '2d' | '3d' | 'analog' | 'general')
          }
          className="2xl:hidden rounded border border-slate-800 bg-[#060910] px-2 py-1.5 text-xs text-slate-200"
        >
          <option value="2d">2D Map</option>
          <option value="3d">3D Globe</option>
          <option value="analog">Analog Map</option>
          <option value="general">General Map</option>
        </select>

        {/* 2D Map / 3D Globe Toggle */}
        <div
          role="group"
          aria-label="Explore Mode"
          className="hidden 2xl:flex items-center bg-[#060910] border border-slate-800 rounded p-0.5 shrink-0"
        >
          <button
            type="button"
            onClick={() => onChangeViewMode('2d')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === '2d'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>2D Map</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeViewMode('3d')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === '3d'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>3D Globe</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeViewMode('analog')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'analog'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <Mountain className="w-3.5 h-3.5" />
            <span>Analog Map</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeViewMode('general')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'general'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>General Map</span>
          </button>
        </div>
      </div>

      {/* Center: Basemap & Region Explorer */}
      {(viewMode === '2d' || viewMode === '3d') && <div className="hidden 2xl:flex items-center gap-2.5 min-w-0">
        <label className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap">
          <span>Basemap</span>
          <select
            value={activeBasemapId}
            onChange={(e) => onSelectBasemap(e.target.value)}
            className="bg-[#0F141F] border border-slate-800 hover:border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1.5 max-w-[230px] focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            {basemaps.map((bm) => (
              <option key={bm.id} value={bm.id}>
                {bm.shortName} ({bm.resolution})
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap">
          <Compass className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            defaultValue=""
            onChange={(e) => {
              const found = regions.find((r) => r.id === e.target.value);
              if (found) onSelectRegion(found);
              e.target.value = '';
            }}
            className="bg-[#0F141F] border border-slate-800 hover:border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1.5 max-w-[230px] focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="" disabled>
              Explore {body === 'moon' ? 'Lunar' : 'Martian'} Regions...
            </option>
            {regions.map((reg) => (
              <option key={reg.id} value={reg.id}>
                {reg.name}
              </option>
            ))}
          </select>
        </label>
      </div>}

      {/* Right: Map Controls + Inspector Toggle */}
      <div className="flex items-center gap-2 shrink-0">
        {(viewMode === '2d' || viewMode === '3d') && <>
        <button
          type="button"
          onClick={onToggleGraticule}
          title="Toggle Latitude/Longitude Graticule"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap cursor-pointer ${
            showGraticule
              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
              : 'bg-[#0F141F] border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <Grid className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Grid</span>
        </button>

        {viewMode === '2d' && (
          <button
            type="button"
            onClick={onToggleProfileMode}
            title="Measure Elevation Profile Transect (click 2 points on map)"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap cursor-pointer ${
              profileMode
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-[#0F141F] border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <Ruler className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">{profileMode ? 'Cancel Profile' : 'Profile'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onResetView}
          title="Reset Global View"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-800 bg-[#0F141F] text-slate-300 hover:text-white hover:border-slate-700 transition-colors whitespace-nowrap cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Reset</span>
        </button>

        <button
          type="button"
          onClick={onToggleRight}
          title={rightOpen ? 'Collapse inspector panel' : 'Expand inspector panel'}
          className="p-1.5 rounded border border-slate-800 bg-[#0F141F] text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
        >
          {rightOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>
        </>}
      </div>
    </header>
  );
};
