import { useEffect, useState } from 'react';
import { Database, WandSparkles } from 'lucide-react';
import { ANALOG_SITE_TEMPLATES } from '@/features/analog/data/analogSites';
import {
  ANALOG_DATA_SECTIONS,
  formatAnalogDataValue,
  parseAnalogDataCsv,
  type AnalogSiteMeasurements,
} from '@/features/analog/data/analogData';
import { PlanetaryDemModel } from './PlanetaryDemModel';
import type { PlanetaryBody } from '@/types/planetary';

interface TerrainAnalogViewerProps {
  body: PlanetaryBody;
  selectedSiteId: string;
  onSelectSite: (siteId: string, body: PlanetaryBody) => void;
}

export function TerrainAnalogViewer({
  body,
  selectedSiteId,
  onSelectSite,
}: TerrainAnalogViewerProps) {
  const [activeTab, setActiveTab] = useState<'data' | 'model'>('data');
  const [siteMeasurements, setSiteMeasurements] = useState<Record<string, AnalogSiteMeasurements>>({});
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const selectedSite =
    ANALOG_SITE_TEMPLATES.find((site) => site.id === selectedSiteId) ??
    ANALOG_SITE_TEMPLATES.find((site) => site.body === body) ??
    ANALOG_SITE_TEMPLATES[0];
  const measurements = siteMeasurements[selectedSite.id];

  useEffect(() => {
    const controller = new AbortController();
    setDataLoading(true);
    fetch('/data/analog-site-data.csv', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Analog data CSV returned HTTP ${response.status}`);
        return response.text();
      })
      .then((csv) => {
        const rows = parseAnalogDataCsv(csv);
        const validSiteIds = new Set(ANALOG_SITE_TEMPLATES.map((site) => site.id));
        const unknownSite = rows.find((row) => !validSiteIds.has(row.siteId));
        if (unknownSite) throw new Error(`Unknown site_id "${unknownSite.siteId}" in analog data CSV.`);
        setSiteMeasurements(Object.fromEntries(rows.map((row) => [row.siteId, row])));
        setDataError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setDataError(cause instanceof Error ? cause.message : 'Unable to load the analog data CSV.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setDataLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    setActiveTab('data');
  }, [selectedSiteId]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto bg-[#07090E] p-4 text-slate-100 lg:p-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-400">
              <span className="h-px w-5 bg-cyan-500" />
              Analog Map · selected sites
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">
              Planetary site data and terrain
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Choose one of the five sites. Its data is loaded from the CSV template; its coordinates
              appear on its planetary map, and its terrain can be compared with the configured Earth analog.
            </p>
          </div>
        </header>

        <section aria-labelledby="analog-sites-heading" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="analog-sites-heading" className="text-sm font-semibold text-slate-200">
                Five selected sites
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Add or replace the site definitions in{' '}
                <code className="font-mono text-slate-300">src/features/analog/data/analogSites.ts</code>.
              </p>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">
              5 Earth analogs configured
            </span>
          </div>
          <div role="tablist" aria-label="Select planetary site" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {ANALOG_SITE_TEMPLATES.map((site, index) => {
              const isSelected = site.id === selectedSite.id;
              const planetIndex =
                ANALOG_SITE_TEMPLATES.slice(0, index + 1).filter((entry) => entry.body === site.body)
                  .length;
              return (
                <button
                  key={site.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-controls="analog-site-content"
                  onClick={() => {
                    onSelectSite(site.id, site.body);
                    setActiveTab('data');
                  }}
                  className={`rounded border px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-100'
                      : 'border-slate-800 bg-[#0A0E17] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <span className="block text-[10px] font-mono uppercase tracking-wider text-slate-500">
                    {site.body === 'mars' ? 'Mars' : 'Moon'} site {planetIndex}
                  </span>
                  <span className="mt-1 block text-xs font-medium leading-snug">
                    {site.region.name}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section id="analog-site-content" role="tabpanel" className="space-y-4">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">{selectedSite.region.name}</h2>
              <p className="mt-1 text-xs text-slate-400">
                {selectedSite.region.subtitle} · {selectedSite.region.lat.toFixed(4)}°,
                {' '}{selectedSite.region.lon.toFixed(4)}°
              </p>
              <p className="mt-1 text-xs text-emerald-300">
                Earth analog: {selectedSite.earthAnalog.name} · {selectedSite.earthAnalog.lat.toFixed(4)}°,
                {' '}{selectedSite.earthAnalog.lon.toFixed(4)}°
              </p>
            </div>
            <span className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] font-mono text-amber-300">
              {selectedSite.body.toUpperCase()}
            </span>
          </header>

          <div role="tablist" aria-label="Site information and terrain tools" className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
            <button type="button" role="tab" aria-selected={activeTab === 'data'} onClick={() => setActiveTab('data')} className={`flex items-center gap-1.5 rounded px-3 py-2 text-xs ${activeTab === 'data' ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-400 hover:bg-slate-800/60'}`}>
              <Database className="h-3.5 w-3.5" /> Datos del sitio
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'model'} onClick={() => setActiveTab('model')} className={`flex items-center gap-1.5 rounded px-3 py-2 text-xs ${activeTab === 'model' ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-400 hover:bg-slate-800/60'}`}>
              <WandSparkles className="h-3.5 w-3.5" /> Generar modelo
            </button>
          </div>

          {activeTab === 'data' && (
            <section aria-label="Datos del sitio" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-400">
                  Valores pendientes de recopilación. Completa la fila del sitio en{' '}
                  <code className="font-mono text-slate-300">public/data/analog-site-data.csv</code>.
                </p>
                <span className="rounded border border-slate-700 bg-[#0A0E17] px-2 py-1 text-[10px] font-mono text-slate-400">
                  site_id: {selectedSite.id}
                </span>
              </div>
              {dataLoading && <p className="text-xs text-cyan-300">Cargando plantilla CSV…</p>}
              {dataError && (
                <div role="alert" className="rounded border border-rose-500/30 bg-rose-950/40 p-3 text-xs text-rose-200">
                  No se pudo cargar la plantilla de datos: {dataError}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {ANALOG_DATA_SECTIONS.map((section) => (
                  <article key={section.title} className="rounded-lg border border-slate-800 bg-[#0A0E17]">
                    <h3 className="border-b border-slate-800 px-3 py-2 text-xs font-semibold text-slate-200">
                      {section.title}
                    </h3>
                    <dl className="divide-y divide-slate-800/70 px-3">
                      {section.fields.map((field) => (
                        <div key={field.key} className="flex items-start justify-between gap-3 py-2">
                          <dt className="text-xs text-slate-400">
                            {field.label}
                            <span className="mt-0.5 block text-[10px] text-slate-600">
                              {field.type}{field.unit ? ` · ${field.unit}` : ''}
                            </span>
                          </dt>
                          <dd className="max-w-[55%] break-words text-right text-xs font-mono text-slate-200">
                            {formatAnalogDataValue(measurements?.[field.key] ?? null)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'model' && (
            <PlanetaryDemModel region={selectedSite.region} earthAnalog={selectedSite.earthAnalog} />
          )}
        </section>
      </div>
    </section>
  );
}
