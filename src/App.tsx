import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HomeScreen } from '@/features/home/HomeScreen';
import { LayerInfoPanel } from '@/features/map/components/LayerInfoPanel';
import { LayerSidebar } from '@/features/map/components/LayerSidebar';
import { PlanetaryGlobe3D } from '@/features/map/components/PlanetaryGlobe3D';
import { PlanetaryMap2D } from '@/features/map/components/PlanetaryMap2D';
import { TopNavBar } from '@/features/map/components/TopNavBar';
import { TerrainAnalogViewer } from '@/features/analog/components/TerrainAnalogViewer';
import { ANALOG_SITE_TEMPLATES } from '@/features/analog/data/analogSites';
import {
  BASEMAPS,
  PLANETARY_LAYERS,
  PLANET_METADATA,
  REGION_PRESETS,
} from './data/planetaryCatalog';
import type {
  ActiveLayerState,
  ElevationProfilePoint,
  LocationProbeResult,
  PlanetaryBody,
  PlanetaryFeatureCollection,
  PlanetaryGeoFeature,
  PlanetaryLayerSpec,
  RegionPreset,
} from '@/types/planetary';
import { normalizeLon180, planetaryDistanceKm, sampleTransectPoints } from '@/utils/planetaryMath';

function minDistanceToFeatureKm(
  body: PlanetaryBody,
  lat: number,
  lon: number,
  feat: PlanetaryGeoFeature
): number | null {
  const g = feat.geometry;
  if (!g || !g.coordinates) return null;

  const minOverPoints = (pts: number[][]): number | null => {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const d = planetaryDistanceKm(body, lat, lon, pt[1], pt[0]);
      if (d < best) best = d;
      // Check segment midpoint for sparse polyline/polygon boundaries
      if (i > 0 && Array.isArray(pts[i - 1]) && pts[i - 1].length >= 2) {
        const prev = pts[i - 1];
        const midLon = (prev[0] + pt[0]) * 0.5;
        const midLat = (prev[1] + pt[1]) * 0.5;
        if (Math.abs(pt[0] - prev[0]) <= 180) {
          const dMid = planetaryDistanceKm(body, lat, lon, midLat, midLon);
          if (dMid < best) best = dMid;
        }
      }
    }
    return Number.isFinite(best) ? best : null;
  };

  switch (g.type) {
    case 'Point': {
      const [fLon, fLat] = g.coordinates as [number, number];
      return planetaryDistanceKm(body, lat, lon, fLat, fLon);
    }
    case 'MultiPoint':
    case 'LineString':
      return minOverPoints(g.coordinates as number[][]);
    case 'MultiLineString': {
      let best = Number.POSITIVE_INFINITY;
      for (const line of g.coordinates as number[][][]) {
        const d = minOverPoints(line);
        if (d !== null && d < best) best = d;
      }
      return Number.isFinite(best) ? best : null;
    }
    case 'Polygon': {
      const outerRing = (g.coordinates as number[][][])[0] || [];
      let best = minOverPoints(outerRing) ?? Number.POSITIVE_INFINITY;
      if (outerRing.length > 0) {
        let sumLon = 0;
        let sumLat = 0;
        for (const p of outerRing) {
          sumLon += p[0];
          sumLat += p[1];
        }
        const cDist = planetaryDistanceKm(
          body,
          lat,
          lon,
          sumLat / outerRing.length,
          sumLon / outerRing.length
        );
        if (cDist < best) best = cDist;
      }
      return Number.isFinite(best) ? best : null;
    }
    case 'MultiPolygon': {
      let best = Number.POSITIVE_INFINITY;
      for (const poly of g.coordinates as number[][][][]) {
        const outerRing = poly[0] || [];
        const d = minOverPoints(outerRing);
        if (d !== null && d < best) best = d;
      }
      return Number.isFinite(best) ? best : null;
    }
    default:
      return null;
  }
}

export default function App() {
  const [body, setBody] = useState<PlanetaryBody>('moon');
  const [viewMode, setViewMode] = useState<'home' | '2d' | '3d' | 'analog'>('home');
  const [selectedAnalogSiteId, setSelectedAnalogSiteId] = useState('moon-analog-1');

  const [basemapByBody, setBasemapByBody] = useState<Record<PlanetaryBody, string>>({
    moon: 'moon-wac',
    mars: 'mars-viking',
  });

  const [activeLayersByBody, setActiveLayersByBody] = useState<
    Record<PlanetaryBody, Record<string, ActiveLayerState>>
  >({
    moon: {},
    mars: {},
  });

  const [selectedLayerByBody, setSelectedLayerByBody] = useState<
    Record<PlanetaryBody, string | null>
  >({
    moon: null,
    mars: null,
  });

  const [rightTab, setRightTab] = useState<'info' | 'probe'>('info');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [showGraticule, setShowGraticule] = useState(true);
  const [profileMode, setProfileMode] = useState(false);

  const [vectorData, setVectorData] = useState<Record<string, PlanetaryFeatureCollection>>({});
  const [vectorLoadingIds, setVectorLoadingIds] = useState<Record<string, boolean>>({});
  const [vectorErrors, setVectorErrors] = useState<Record<string, string>>({});
  const [vectorRetryNonce, setVectorRetryNonce] = useState<Record<string, number>>({});
  const vectorFetchedRef = useRef<Set<string>>(new Set());

  const [probe, setProbe] = useState<LocationProbeResult | null>(null);
  const elevationRequestRef = useRef<AbortController | null>(null);
  const [profileSegment, setProfileSegment] = useState<{
    start: { lat: number; lon: number };
    end: { lat: number; lon: number };
  } | null>(null);
  const [profilePoints, setProfilePoints] = useState<ElevationProfilePoint[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [flyToTarget, setFlyToTarget] = useState<{
    lat: number;
    lon: number;
    zoom: number;
    nonce: number;
  } | null>(null);

  const planetBasemaps = useMemo(
    () => BASEMAPS.filter((b) => b.body === body),
    [body]
  );

  const planetLayers = useMemo(
    () => PLANETARY_LAYERS.filter((l) => l.body === body),
    [body]
  );

  const planetRegions = useMemo(
    () => REGION_PRESETS.filter((r) => r.body === body),
    [body]
  );
  const analogRegions = useMemo(
    () => ANALOG_SITE_TEMPLATES.filter((site) => site.body === body).map((site) => site.region),
    [body]
  );

  const activeBasemap = useMemo(() => {
    const id = basemapByBody[body];
    return planetBasemaps.find((b) => b.id === id) || planetBasemaps[0];
  }, [body, basemapByBody, planetBasemaps]);

  const activeLayers = activeLayersByBody[body];
  const selectedLayerId = selectedLayerByBody[body];
  const selectedLayer = useMemo(
    () => planetLayers.find((l) => l.id === selectedLayerId) || null,
    [planetLayers, selectedLayerId]
  );

  const vectorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [id, fc] of Object.entries(vectorData)) {
      counts[id] = fc.features.length;
    }
    return counts;
  }, [vectorData]);

  // Fetch GeoJSON vector datasets when activated for the active planet
  useEffect(() => {
    const activeVectorSpecs = planetLayers.filter(
      (l) =>
        l.sourceType === 'vector_geojson' &&
        activeLayers[l.id] &&
        !vectorFetchedRef.current.has(l.id)
    );

    if (activeVectorSpecs.length === 0) return;

    for (const spec of activeVectorSpecs) {
      vectorFetchedRef.current.add(spec.id);
      setVectorLoadingIds((prev) => ({ ...prev, [spec.id]: true }));
      setVectorErrors((prev) => {
        if (!prev[spec.id]) return prev;
        const next = { ...prev };
        delete next[spec.id];
        return next;
      });
      fetch(`/api/features?body=${encodeURIComponent(spec.body)}&layerId=${encodeURIComponent(spec.id)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`NASA Trek vector service returned HTTP ${res.status}`);
          return (await res.json()) as PlanetaryFeatureCollection;
        })
        .then((fc) => {
          setVectorData((prev) => ({ ...prev, [spec.id]: fc }));
        })
        .catch((err) => {
          vectorFetchedRef.current.delete(spec.id);
          setVectorErrors((prev) => ({
            ...prev,
            [spec.id]: err instanceof Error ? err.message : 'Failed to load vector layer',
          }));
        })
        .finally(() => {
          setVectorLoadingIds((prev) => ({ ...prev, [spec.id]: false }));
        });
    }
  }, [planetLayers, activeLayers, vectorRetryNonce]);

  const handleRetryVector = useCallback((layerId: string) => {
    vectorFetchedRef.current.delete(layerId);
    setVectorRetryNonce((prev) => ({ ...prev, [layerId]: (prev[layerId] || 0) + 1 }));
  }, []);

  const handleSelectBody = useCallback((nextBody: PlanetaryBody) => {
    if (nextBody === body) return;
    elevationRequestRef.current?.abort();
    elevationRequestRef.current = null;
    setBody(nextBody);
    const firstSite = ANALOG_SITE_TEMPLATES.find((site) => site.body === nextBody);
    if (firstSite) {
      setSelectedAnalogSiteId(firstSite.id);
      setFlyToTarget({
        lat: firstSite.region.lat,
        lon: firstSite.region.lon,
        zoom: firstSite.region.zoom,
        nonce: Date.now(),
      });
    }
    setProbe(null);
    setProfileMode(false);
    setProfileSegment(null);
    setProfilePoints([]);
    setProfileError(null);
  }, [body]);

  const handleSelectAnalogSite = useCallback((siteId: string, siteBody: PlanetaryBody) => {
    setSelectedAnalogSiteId(siteId);
    handleSelectBody(siteBody);
    const site = ANALOG_SITE_TEMPLATES.find((template) => template.id === siteId);
    if (site) {
      setFlyToTarget({
        lat: site.region.lat,
        lon: site.region.lon,
        zoom: site.region.zoom,
        nonce: Date.now(),
      });
    }
  }, [handleSelectBody]);

  const handleToggleLayer = useCallback(
    (layer: PlanetaryLayerSpec) => {
      setSelectedLayerByBody((prev) => ({ ...prev, [body]: layer.id }));
      setRightTab('info');
      setRightOpen(true);
      if (layer.sourceType === 'unavailable') {
        return;
      }
      setActiveLayersByBody((prev) => {
        const current = { ...prev[body] };
        if (current[layer.id]) {
          delete current[layer.id];
        } else {
          current[layer.id] = {
            layerId: layer.id,
            visible: true,
            opacity: layer.defaultOpacity,
          };
        }
        return { ...prev, [body]: current };
      });
    },
    [body]
  );

  const handleToggleVisibility = useCallback(
    (layerId: string) => {
      setActiveLayersByBody((prev) => {
        const current = prev[body];
        const target = current[layerId];
        if (!target) return prev;
        return {
          ...prev,
          [body]: {
            ...current,
            [layerId]: { ...target, visible: !target.visible },
          },
        };
      });
    },
    [body]
  );

  const handleChangeOpacity = useCallback(
    (layerId: string, opacity: number) => {
      setActiveLayersByBody((prev) => {
        const current = prev[body];
        const target = current[layerId];
        if (!target) return prev;
        return {
          ...prev,
          [body]: {
            ...current,
            [layerId]: { ...target, opacity },
          },
        };
      });
    },
    [body]
  );

  const handleClearOverlays = useCallback(() => {
    setActiveLayersByBody((prev) => ({ ...prev, [body]: {} }));
  }, [body]);

  const handleSelectInfo = useCallback(
    (layerId: string) => {
      setSelectedLayerByBody((prev) => ({ ...prev, [body]: layerId }));
      setRightTab('info');
      setRightOpen(true);
    },
    [body]
  );

  const handleSelectRegion = useCallback((region: RegionPreset) => {
    setFlyToTarget({
      lat: region.lat,
      lon: region.lon,
      zoom: region.zoom,
      nonce: Date.now(),
    });
  }, []);

  const handleOpenGeneralMap = useCallback(() => {
    setViewMode('2d');
    const site = ANALOG_SITE_TEMPLATES.find((template) => template.id === selectedAnalogSiteId);
    if (site) {
      setFlyToTarget({
        lat: site.region.lat,
        lon: site.region.lon,
        zoom: site.region.zoom,
        nonce: Date.now(),
      });
    }
  }, [selectedAnalogSiteId]);

  const handleResetView = useCallback(() => {
    const meta = PLANET_METADATA[body];
    setFlyToTarget({
      lat: meta.defaultCenter[1],
      lon: meta.defaultCenter[0],
      zoom: meta.defaultZoom,
      nonce: Date.now(),
    });
  }, [body]);

  const computeNearbyFeatures = useCallback(
    (targetBody: PlanetaryBody, lat: number, lon: number) => {
      const candidates: Array<{
        name: string;
        type: string;
        distanceKm: number;
        diameterKm?: number;
      }> = [];

      for (const spec of PLANETARY_LAYERS) {
        if (spec.body !== targetBody) continue;
        const fc = vectorData[spec.id];
        if (!fc) continue;

        for (const feat of fc.features) {
          const dist = minDistanceToFeatureKm(targetBody, lat, lon, feat);
          if (dist === null) continue;
          const p = feat.properties;
          const name =
            (p.LABEL as string) ||
            (p.FEATURE as string) ||
            (p.name as string) ||
            (p.Name as string) ||
            (p.mission as string) ||
            (p.rover as string) ||
            (p.PSR_ID as string) ||
            (p.Spacecraft as string) ||
            (p.ProductId as string);
          if (!name) continue;
          candidates.push({
            name,
            type: (p.type as string) || (p.category as string) || spec.name,
            distanceKm: dist,
            diameterKm: typeof p.diameter === 'number' ? p.diameter : undefined,
          });
        }
      }

      candidates.sort((a, b) => a.distanceKm - b.distanceKm);
      return candidates.slice(0, 6);
    },
    [vectorData]
  );

  const handleSelectLocation = useCallback(
    (rawLat: number, rawLon: number) => {
      const lat = Math.max(-90, Math.min(90, rawLat));
      const lon = normalizeLon180(rawLon);
      const currentBody = body;
      const nearby = computeNearbyFeatures(currentBody, lat, lon);
      elevationRequestRef.current?.abort();
      const requestController = new AbortController();
      elevationRequestRef.current = requestController;
      let requestTimedOut = false;
      const timeoutId = window.setTimeout(() => {
        requestTimedOut = true;
        requestController.abort();
      }, 16000);

      setProbe({
        body: currentBody,
        lat,
        lon,
        elevationM: null,
        elevationSource:
          currentBody === 'moon'
            ? 'NASA LRO LOLA Global DEM (256 ppd)'
            : 'NASA MGS MOLA + HRSC Blended DEM',
        elevationLoading: true,
        nearbyFeatures: nearby,
      });
      setRightTab('probe');
      setRightOpen(true);

      fetch(
        `/api/elevation?body=${encodeURIComponent(currentBody)}&lon=${encodeURIComponent(
          lon.toFixed(5)
        )}&lat=${encodeURIComponent(lat.toFixed(5))}`,
        { signal: requestController.signal }
      )
        .then(async (res) => {
          if (!res.ok) {
            const responseBody = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(responseBody?.error || `Elevation service returned HTTP ${res.status}`);
          }
          return (await res.json()) as {
            elevationM: number | null;
            source: string;
          };
        })
        .then((data) => {
          if (requestController.signal.aborted) return;
          setProbe((prev) =>
            prev && prev.body === currentBody && prev.lat === lat && prev.lon === lon
              ? {
                  ...prev,
                  elevationM: data.elevationM,
                  elevationSource: data.source,
                  elevationLoading: false,
                }
              : prev
          );
        })
        .catch((err) => {
          if (requestController.signal.aborted && !requestTimedOut) return;
          setProbe((prev) =>
            prev && prev.body === currentBody && prev.lat === lat && prev.lon === lon
              ? {
                  ...prev,
                  elevationLoading: false,
                  elevationError:
                    requestTimedOut
                      ? 'NASA DEM query timed out. Select a location to retry.'
                      : err instanceof Error
                        ? err.message
                        : 'Unable to reach NASA elevation service',
                }
              : prev
          );
        })
        .finally(() => {
          window.clearTimeout(timeoutId);
          if (elevationRequestRef.current === requestController) {
            elevationRequestRef.current = null;
          }
        });
    },
    [body, computeNearbyFeatures]
  );

  const handleSelectFeaturedRegion = useCallback((region: RegionPreset) => {
    const site = ANALOG_SITE_TEMPLATES.find((template) => template.region.id === region.id);
    if (site) setSelectedAnalogSiteId(site.id);
    setFlyToTarget({
      lat: region.lat,
      lon: region.lon,
      zoom: region.zoom,
      nonce: Date.now(),
    });
    handleSelectLocation(region.lat, region.lon);
  }, [handleSelectLocation]);

  const handleCompleteProfile = useCallback(
    async (rawStart: { lat: number; lon: number }, rawEnd: { lat: number; lon: number }) => {
      const start = {
        lat: Math.max(-90, Math.min(90, rawStart.lat)),
        lon: normalizeLon180(rawStart.lon),
      };
      const end = {
        lat: Math.max(-90, Math.min(90, rawEnd.lat)),
        lon: normalizeLon180(rawEnd.lon),
      };
      setProfileMode(false);
      setProfileSegment({ start, end });
      setProfileLoading(true);
      setProfileError(null);
      setRightTab('probe');
      setRightOpen(true);

      const points = sampleTransectPoints(body, start, end, 18);
      try {
        const res = await fetch('/api/elevation-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, points }),
        });
        if (!res.ok) throw new Error(`Elevation profile failed (HTTP ${res.status})`);
        const data = (await res.json()) as { samples: ElevationProfilePoint[] };
        setProfilePoints(data.samples);
      } catch (err) {
        setProfilePoints([]);
        setProfileError(
          err instanceof Error ? err.message : 'Unable to reach NASA elevation service'
        );
      } finally {
        setProfileLoading(false);
      }
    },
    [body]
  );

  const handleClearProfile = useCallback(() => {
    setProfileSegment(null);
    setProfilePoints([]);
    setProfileError(null);
  }, []);

  if (viewMode === 'home') {
    return (
      <HomeScreen
        onOpenAnalogMap={() => setViewMode('analog')}
        onOpenGeneralMap={handleOpenGeneralMap}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#07090E] text-slate-100 overflow-hidden">
      <TopNavBar
        body={body}
        onSelectBody={handleSelectBody}
        onGoHome={() => setViewMode('home')}
        viewMode={viewMode}
        onChangeViewMode={(m) => {
          setViewMode(m);
          if (m !== '2d') setProfileMode(false);
          if (m === '2d' || m === '3d') {
            const site = ANALOG_SITE_TEMPLATES.find(
              (template) => template.id === selectedAnalogSiteId
            );
            if (site) {
              setFlyToTarget({
                lat: site.region.lat,
                lon: site.region.lon,
                zoom: site.region.zoom,
                nonce: Date.now(),
              });
            }
          }
        }}
        basemaps={planetBasemaps}
        activeBasemapId={activeBasemap.id}
        onSelectBasemap={(id) =>
          setBasemapByBody((prev) => ({ ...prev, [body]: id }))
        }
        regions={planetRegions}
        onSelectRegion={handleSelectRegion}
        showGraticule={showGraticule}
        onToggleGraticule={() => setShowGraticule((v) => !v)}
        profileMode={profileMode}
        onToggleProfileMode={() => setProfileMode((v) => !v)}
        onResetView={handleResetView}
        leftOpen={leftOpen}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        rightOpen={rightOpen}
        onToggleRight={() => setRightOpen((v) => !v)}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {leftOpen && viewMode !== 'analog' && (
          <LayerSidebar
            body={body}
            layers={planetLayers}
            activeLayers={activeLayers}
            selectedLayerId={selectedLayerId}
            onToggleLayer={handleToggleLayer}
            onToggleVisibility={handleToggleVisibility}
            onChangeOpacity={handleChangeOpacity}
            onSelectInfo={handleSelectInfo}
            onClearOverlays={handleClearOverlays}
            basemaps={planetBasemaps}
            activeBasemapId={activeBasemap.id}
            onSelectBasemap={(id) =>
              setBasemapByBody((prev) => ({ ...prev, [body]: id }))
            }
            regions={planetRegions}
            onSelectRegion={handleSelectRegion}
            vectorLoadingIds={vectorLoadingIds}
            vectorCounts={vectorCounts}
            vectorErrors={vectorErrors}
            onRetryVector={handleRetryVector}
          />
        )}

        <main className="flex-1 min-w-0 h-full relative">
          {viewMode === 'analog' ? (
              <TerrainAnalogViewer
                body={body}
                selectedSiteId={selectedAnalogSiteId}
                onSelectSite={handleSelectAnalogSite}
              />
          ) : viewMode === '2d' ? (
            <PlanetaryMap2D
              body={body}
              basemap={activeBasemap}
              layers={planetLayers}
              activeLayers={activeLayers}
              vectorData={vectorData}
              showGraticule={showGraticule}
              featuredRegions={analogRegions}
              profileMode={profileMode}
              probeCoord={probe ? { lat: probe.lat, lon: probe.lon } : null}
              profileSegment={profileSegment}
              flyToTarget={flyToTarget}
              onSelectLocation={handleSelectLocation}
              onSelectFeaturedRegion={handleSelectFeaturedRegion}
              onCompleteProfile={handleCompleteProfile}
            />
          ) : (
            <PlanetaryGlobe3D
              body={body}
              basemap={activeBasemap}
              layers={planetLayers}
              activeLayers={activeLayers}
              vectorData={vectorData}
              showGraticule={showGraticule}
              featuredRegions={analogRegions}
              probeCoord={probe ? { lat: probe.lat, lon: probe.lon } : null}
              flyToTarget={flyToTarget}
              onSelectLocation={handleSelectLocation}
              onSelectFeaturedRegion={handleSelectFeaturedRegion}
            />
          )}
        </main>

        {rightOpen && viewMode !== 'analog' && (
          <LayerInfoPanel
            activeTab={rightTab}
            onChangeTab={setRightTab}
            selectedLayer={selectedLayer}
            activeLayerState={selectedLayer ? activeLayers[selectedLayer.id] : undefined}
            onToggleLayer={handleToggleLayer}
            onChangeOpacity={handleChangeOpacity}
            probe={probe}
            profilePoints={profilePoints}
            profileLoading={profileLoading}
            profileError={profileError}
            onClearProfile={handleClearProfile}
            onRetryElevation={() => {
              if (probe) handleSelectLocation(probe.lat, probe.lon);
            }}
          />
        )}
      </div>
    </div>
  );
}
