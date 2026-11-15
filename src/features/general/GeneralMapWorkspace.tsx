import { useEffect, useState } from 'react';
import { MapPinned } from 'lucide-react';
import { GeneralTerrainModel } from '@/features/analog/components/PlanetaryDemModel';
import type { PlanetaryBody, RegionPreset } from '@/types/planetary';

interface GeneralMapWorkspaceProps {
  body: PlanetaryBody;
  regions: RegionPreset[];
}

export function GeneralMapWorkspace({ body, regions }: GeneralMapWorkspaceProps) {
  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [latitude, setLatitude] = useState('0');
  const [longitude, setLongitude] = useState('0');
  const [zoom, setZoom] = useState(8);
  const [verticalScale, setVerticalScale] = useState(0.012);
  const [submittedLocation, setSubmittedLocation] = useState<{
    lat: number;
    lon: number;
    name: string;
  } | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    const firstRegion = regions[0];
    if (!firstRegion) return;
    setSelectedRegionId(firstRegion.id);
    setLatitude(String(firstRegion.lat));
    setLongitude(String(firstRegion.lon));
    setSubmittedLocation(null);
    setInputError(null);
  }, [body, regions]);

  const handleSelectRegion = (regionId: string) => {
    setSelectedRegionId(regionId);
    const region = regions.find((item) => item.id === regionId);
    if (region) {
      setLatitude(String(region.lat));
      setLongitude(String(region.lon));
      setInputError(null);
    }
  };

  const handleGenerate = () => {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setInputError('La latitud debe estar entre −90° y 90°.');
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setInputError('La longitud debe estar entre −180° y 180°.');
      return;
    }
    const selectedRegion = regions.find((region) => region.id === selectedRegionId);
    setInputError(null);
    setSubmittedLocation({
      lat,
      lon,
      name: selectedRegion && selectedRegion.lat === lat && selectedRegion.lon === lon
        ? selectedRegion.name
        : 'Custom location',
    });
  };

  return (
    <section className="h-full overflow-y-auto bg-[#07090E] p-4 text-slate-100 lg:p-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
        <header>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-400">
            <span className="h-px w-5 bg-cyan-500" />
            General Map · independent terrain workspace
          </div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Generate a planetary terrain map</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Choose a saved location or enter coordinates. Zoom level and vertical relief are independent
            from the Analog Map settings.
          </p>
        </header>

        <section className="rounded-lg border border-slate-800 bg-[#0A0E17] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <MapPinned className="h-4 w-4 text-cyan-400" />
            Location and terrain settings
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <label className="text-[11px] text-slate-400 xl:col-span-2">
              Saved location
              <select
                value={selectedRegionId}
                onChange={(event) => handleSelectRegion(event.target.value)}
                className="mt-1 block w-full rounded border border-slate-700 bg-[#0F141F] px-2 py-2 text-xs text-slate-200"
              >
                <option value="">Custom coordinates</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>{region.name}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-slate-400">
              Latitude
              <input
                type="number"
                min={-90}
                max={90}
                step="any"
                value={latitude}
                onChange={(event) => {
                  setLatitude(event.target.value);
                  setSelectedRegionId('');
                }}
                className="mt-1 block w-full rounded border border-slate-700 bg-[#0F141F] px-2 py-2 text-xs font-mono text-slate-200"
              />
            </label>
            <label className="text-[11px] text-slate-400">
              Longitude
              <input
                type="number"
                min={-180}
                max={180}
                step="any"
                value={longitude}
                onChange={(event) => {
                  setLongitude(event.target.value);
                  setSelectedRegionId('');
                }}
                className="mt-1 block w-full rounded border border-slate-700 bg-[#0F141F] px-2 py-2 text-xs font-mono text-slate-200"
              />
            </label>
            <label className="text-[11px] text-slate-400">
              Zoom level (Z#)
              <select
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="mt-1 block w-full rounded border border-slate-700 bg-[#0F141F] px-2 py-2 text-xs text-slate-200"
              >
                {[6, 7, 8, 9, 10].map((level) => <option key={level} value={level}>Z{level}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-slate-400 sm:col-span-2 xl:col-span-2">
              Vertical scale · {verticalScale.toFixed(3)}
              <input
                type="range"
                min={0.004}
                max={0.04}
                step={0.002}
                value={verticalScale}
                onChange={(event) => setVerticalScale(Number(event.target.value))}
                className="gis-slider mt-3 block w-full"
                aria-label="General Map vertical scale"
              />
            </label>
          </div>
          {inputError && (
            <p role="alert" className="mt-3 text-xs text-rose-300">{inputError}</p>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            className="mt-4 rounded border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20"
          >
            Generate map
          </button>
        </section>

        {submittedLocation && (
          <GeneralTerrainModel
            key={`${body}:${submittedLocation.lat}:${submittedLocation.lon}`}
            body={body}
            lat={submittedLocation.lat}
            lon={submittedLocation.lon}
            zoom={zoom}
            verticalScale={verticalScale}
            locationName={submittedLocation.name}
            autoGenerate
          />
        )}
      </div>
    </section>
  );
}
