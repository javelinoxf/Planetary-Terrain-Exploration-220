import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { PLANET_METADATA } from '@/data/planetaryCatalog';
import {
  POLAR_DERIVATIVE_MAX_LAT_DEG,
  formatLat,
  formatLon,
  isPolarDerivativeMasked,
  normalizeLon180,
  renderDerivedDemGrid,
  sampleTransectPoints,
} from '@/utils/planetaryMath';
import type {
  ActiveLayerState,
  BasemapSpec,
  DerivedDemMode,
  PlanetaryBody,
  PlanetaryFeatureCollection,
  PlanetaryLayerSpec,
  RegionPreset,
} from '@/types/planetary';

interface PlanetaryMap2DProps {
  body: PlanetaryBody;
  basemap: BasemapSpec;
  layers: PlanetaryLayerSpec[];
  activeLayers: Record<string, ActiveLayerState>;
  vectorData: Record<string, PlanetaryFeatureCollection>;
  showGraticule: boolean;
  featuredRegions: RegionPreset[];
  profileMode: boolean;
  probeCoord: { lat: number; lon: number } | null;
  profileSegment: { start: { lat: number; lon: number }; end: { lat: number; lon: number } } | null;
  flyToTarget: { lat: number; lon: number; zoom: number; nonce: number } | null;
  onSelectLocation: (lat: number, lon: number) => void;
  onSelectFeaturedRegion: (region: RegionPreset) => void;
  onCompleteProfile: (
    start: { lat: number; lon: number },
    end: { lat: number; lon: number }
  ) => void;
}

function createDerivedDemTileLayer(
  body: PlanetaryBody,
  mode: DerivedDemMode,
  opacity: number,
  maxNativeZoom = 7,
  onTileStatus?: (ok: boolean) => void
): L.GridLayer {
  const abortByTile = new WeakMap<HTMLElement, AbortController>();
  const MAX_CONCURRENT = 6;
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const pumpQueue = () => {
    while (activeCount < MAX_CONCURRENT && queue.length > 0) {
      const next = queue.shift();
      if (next) next();
    }
  };

  const DerivedGrid = L.GridLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const tile = document.createElement('canvas');
      tile.width = 256;
      tile.height = 256;

      const maxCols = Math.pow(2, coords.z + 1);
      const maxRows = Math.pow(2, coords.z);
      if (
        coords.z < 0 ||
        coords.z > maxNativeZoom ||
        coords.x < 0 ||
        coords.x >= maxCols ||
        coords.y < 0 ||
        coords.y >= maxRows
      ) {
        done(undefined, tile);
        return tile;
      }

      const ac = new AbortController();
      abortByTile.set(tile, ac);
      const url = `/api/dem-tile?body=${encodeURIComponent(body)}&z=${coords.z}&x=${coords.x}&y=${coords.y}`;

      const runTask = () => {
        if (ac.signal.aborted) {
          done(undefined, tile);
          return;
        }
        activeCount++;

        const attemptFetch = async (): Promise<void> => {
          for (let attempt = 0; attempt < 2; attempt++) {
            const res = await fetch(url, { signal: ac.signal });
            if (res.ok) {
              const buf = await res.arrayBuffer();
              if (ac.signal.aborted) return;
              const grid = new Float32Array(buf);
              if (grid.length === 258 * 258) {
                renderDerivedDemGrid(grid, 258, 258, tile, mode, body, coords.z, coords.y);
              }
              onTileStatus?.(true);
              return;
            }
            if (res.status >= 400 && res.status < 500 && res.status !== 429) {
              throw new Error(`DEM tile HTTP ${res.status}`);
            }
            if (attempt === 0 && !ac.signal.aborted) {
              await new Promise((r) => setTimeout(r, 300));
            }
          }
          throw new Error('DEM tile upstream error');
        };

        attemptFetch()
          .then(() => {
            done(undefined, tile);
          })
          .catch(() => {
            if (!ac.signal.aborted) onTileStatus?.(false);
            done(undefined, tile);
          })
          .finally(() => {
            activeCount = Math.max(0, activeCount - 1);
            pumpQueue();
          });
      };

      queue.push(runTask);
      pumpQueue();
      return tile;
    },
  });

  const layer = new (DerivedGrid as unknown as new (opts?: L.GridLayerOptions) => L.GridLayer)({
    tileSize: 256,
    opacity,
    bounds: [
      [-90, -180],
      [90, 180],
    ],
    noWrap: true,
    minZoom: 0,
    maxZoom: 10,
    maxNativeZoom,
  });

  layer.on('tileunload', (e: L.TileEvent) => {
    const ac = abortByTile.get(e.tile);
    if (ac) {
      ac.abort();
      abortByTile.delete(e.tile);
    }
  });

  return layer;
}

function createPopupElement(props: Record<string, unknown>, layerName: string): HTMLElement {
  const title =
    (props.LABEL as string) ||
    (props.FEATURE as string) ||
    (props.name as string) ||
    (props.Name as string) ||
    (props.mission as string) ||
    (props.rover as string) ||
    (props.PSR_ID as string) ||
    (props.ProductId as string) ||
    layerName;

  const skipKeys = new Set([
    'FID',
    'OBJECTID',
    'jC_lineclr',
    'jC_fillclr',
    'filled',
    'lwidth',
    'Radius',
    'showlbl',
    'LABEL',
    'CLEAN_FEAT',
    'clean_name',
    'notes',
    'score',
    'link',
    'ExtURL',
    'Ext2URL',
    'Ext3URL',
    'ProdURL',
    'FilesURL',
    'LabelURL',
    'PILOTURL',
  ]);

  const root = document.createElement('div');
  root.style.minWidth = '210px';
  root.style.maxWidth = '280px';

  const titleEl = document.createElement('div');
  titleEl.style.fontSize = '12px';
  titleEl.style.fontWeight = '600';
  titleEl.style.color = '#f8fafc';
  titleEl.style.marginBottom = '4px';
  titleEl.textContent = String(title);
  root.appendChild(titleEl);

  const subEl = document.createElement('div');
  subEl.style.fontSize = '10px';
  subEl.style.color = '#38bdf8';
  subEl.style.marginBottom = '6px';
  subEl.textContent = String(layerName);
  root.appendChild(subEl);

  let rowCount = 0;
  for (const [k, v] of Object.entries(props)) {
    if (skipKeys.has(k) || v === null || v === undefined) continue;
    const str = String(v).trim();
    if (!str || str === 'null') continue;

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.gap = '12px';
    row.style.fontSize = '11px';
    row.style.padding = '2px 0';
    row.style.borderBottom = '1px solid #1e293b';

    const keySpan = document.createElement('span');
    keySpan.style.color = '#94a3b8';
    keySpan.textContent = k;

    const valSpan = document.createElement('span');
    valSpan.style.color = '#e2e8f0';
    valSpan.style.fontFamily = 'monospace';
    valSpan.style.textAlign = 'right';
    valSpan.style.maxWidth = '170px';
    valSpan.style.overflow = 'hidden';
    valSpan.style.textOverflow = 'ellipsis';
    valSpan.textContent = str;

    row.appendChild(keySpan);
    row.appendChild(valSpan);
    root.appendChild(row);

    rowCount++;
    if (rowCount >= 6) break;
  }

  return root;
}

export const PlanetaryMap2D: React.FC<PlanetaryMap2DProps> = ({
  body,
  basemap,
  layers,
  activeLayers,
  vectorData,
  showGraticule,
  featuredRegions,
  profileMode,
  probeCoord,
  profileSegment,
  flyToTarget,
  onSelectLocation,
  onSelectFeaturedRegion,
  onCompleteProfile,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const basemapLayerRef = useRef<L.TileLayer | null>(null);
  const overlayLayersRef = useRef<Map<string, L.Layer>>(new Map());
  const graticuleLayerRef = useRef<L.LayerGroup | null>(null);
  const probeMarkerRef = useRef<L.CircleMarker | null>(null);
  const profileGroupRef = useRef<L.LayerGroup | null>(null);
  const featuredSitesLayerRef = useRef<L.LayerGroup | null>(null);
  const profileDraftStartRef = useRef<{ lat: number; lon: number } | null>(null);

  const profileModeRef = useRef(profileMode);
  profileModeRef.current = profileMode;

  const onSelectLocationRef = useRef(onSelectLocation);
  onSelectLocationRef.current = onSelectLocation;
  const onSelectFeaturedRegionRef = useRef(onSelectFeaturedRegion);
  onSelectFeaturedRegionRef.current = onSelectFeaturedRegion;

  const onCompleteProfileRef = useRef(onCompleteProfile);
  onCompleteProfileRef.current = onCompleteProfile;

  const [cursorCoord, setCursorCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(2);
  const [viewExtendsPolar, setViewExtendsPolar] = useState<boolean>(false);
  const [profileStepHint, setProfileStepHint] = useState<string | null>(null);
  const [tileErrorsBySource, setTileErrorsBySource] = useState<Record<string, number>>({});

  // Initialize Leaflet map once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const map = L.map(el, {
      crs: L.CRS.EPSG4326,
      center: flyToTarget ? [flyToTarget.lat, flyToTarget.lon] : [0, 0],
      zoom: flyToTarget ? flyToTarget.zoom : 2,
      minZoom: 1,
      maxZoom: 10,
      maxBounds: [
        [-90, -180],
        [90, 180],
      ],
      maxBoundsViscosity: 0.9,
      worldCopyJump: false,
      zoomControl: false,
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      setCursorCoord({
        lat: Math.max(-90, Math.min(90, e.latlng.lat)),
        lon: normalizeLon180(e.latlng.lng),
      });
    });

    map.on('mouseout', () => {
      setCursorCoord(null);
    });

    const syncPolarCoverage = () => {
      const b = map.getBounds();
      setViewExtendsPolar(
        b.getNorth() > POLAR_DERIVATIVE_MAX_LAT_DEG || b.getSouth() < -POLAR_DERIVATIVE_MAX_LAT_DEG
      );
    };

    map.on('zoomend', () => {
      setZoomLevel(map.getZoom());
      syncPolarCoverage();
    });

    map.on('moveend', syncPolarCoverage);
    syncPolarCoverage();

    map.on('click', (e: L.LeafletMouseEvent) => {
      const lat = Math.max(-90, Math.min(90, e.latlng.lat));
      const lon = normalizeLon180(e.latlng.lng);

      if (profileModeRef.current) {
        if (!profileDraftStartRef.current) {
          profileDraftStartRef.current = { lat, lon };
          setProfileStepHint('Click end point to complete elevation transect');
          const grp = profileGroupRef.current;
          if (grp) {
            grp.clearLayers();
            L.circleMarker([lat, lon], {
              radius: 5,
              color: '#f59e0b',
              fillColor: '#f59e0b',
              fillOpacity: 1,
              weight: 2,
            }).addTo(grp);
          }
        } else {
          const start = profileDraftStartRef.current;
          profileDraftStartRef.current = null;
          setProfileStepHint(null);
          onCompleteProfileRef.current(start, { lat, lon });
        }
        return;
      }

      onSelectLocationRef.current(lat, lon);
    });

    const probeGroup = L.layerGroup().addTo(map);
    profileGroupRef.current = probeGroup;
    featuredSitesLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setZoomLevel(map.getZoom());

    const resizeObs = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObs.observe(el);

    return () => {
      resizeObs.disconnect();
      map.remove();
      mapRef.current = null;
      basemapLayerRef.current = null;
      overlayLayersRef.current.clear();
      featuredSitesLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const markerGroup = featuredSitesLayerRef.current;
    if (!markerGroup) return;

    markerGroup.clearLayers();
    for (const region of featuredRegions) {
      const marker = L.circleMarker([region.lat, region.lon], {
        radius: 7,
        color: '#f8fafc',
        weight: 2,
        fillColor: region.body === 'mars' ? '#f59e0b' : '#22d3ee',
        fillOpacity: 1,
      });
      marker.bindTooltip(region.name, {
        permanent: true,
        direction: 'top',
        offset: [0, -6],
        className: 'analog-site-label',
      });
      marker.on('click', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event.originalEvent);
        onSelectFeaturedRegionRef.current(region);
        mapRef.current?.setView([region.lat, region.lon], region.zoom);
      });
      marker.addTo(markerGroup);
    }
  }, [featuredRegions]);

  // Reset profile draft when exiting profileMode
  useEffect(() => {
    if (!profileMode) {
      profileDraftStartRef.current = null;
      setProfileStepHint(null);
    } else {
      setProfileStepHint('Click start point on planetary surface');
    }
  }, [profileMode]);

  // Reset view and stale tile errors when body switches
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const meta = PLANET_METADATA[body];
    map.setView([meta.defaultCenter[1], meta.defaultCenter[0]], meta.defaultZoom, {
      animate: false,
    });
    setZoomLevel(meta.defaultZoom);
    setTileErrorsBySource({});
  }, [body]);

  // Update Basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (basemapLayerRef.current) {
      map.removeLayer(basemapLayerRef.current);
    }
    setTileErrorsBySource((prev) => {
      if (!prev.__basemap__) return prev;
      const next = { ...prev };
      delete next.__basemap__;
      return next;
    });

    const tile = L.tileLayer(basemap.tileUrl, {
      bounds: basemap.bounds ?? [
        [-90, -180],
        [90, 180],
      ],
      noWrap: true,
      minZoom: 0,
      maxZoom: 10,
      maxNativeZoom: basemap.maxNativeZoom,
      tileSize: 256,
      crossOrigin: 'anonymous',
      attribution: basemap.attribution,
    });

    tile.on('tileerror', () => {
      setTileErrorsBySource((prev) => ({ ...prev, __basemap__: (prev.__basemap__ || 0) + 1 }));
    });
    tile.on('tileload', () => {
      setTileErrorsBySource((prev) => {
        if (!prev.__basemap__) return prev;
        const next = { ...prev };
        delete next.__basemap__;
        return next;
      });
    });

    tile.addTo(map);
    tile.bringToBack();
    basemapLayerRef.current = tile;
  }, [basemap]);

  // Synchronize Overlay Layers (WMTS, ArcGIS Tiles, Derived DEM, Vector GeoJSON)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentOverlays = overlayLayersRef.current;
    const layerSpecMap = new Map(layers.map((l) => [l.id, l]));

    // Remove deactivated or invisible layers, or layers whose planet changed
    for (const [id, leafletLayer] of currentOverlays.entries()) {
      const st = activeLayers[id];
      const spec = layerSpecMap.get(id);
      if (!st || !st.visible || !spec || spec.body !== body) {
        map.removeLayer(leafletLayer);
        currentOverlays.delete(id);
        setTileErrorsBySource((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }

    // Add or update active visible layers
    for (const spec of layers) {
      if (spec.body !== body) continue;
      const st = activeLayers[spec.id];
      if (!st || !st.visible || spec.sourceType === 'unavailable') continue;

      const existing = currentOverlays.get(spec.id);

      if (spec.sourceType === 'wmts' || spec.sourceType === 'arcgis_tile') {
        if (existing && 'setOpacity' in existing) {
          (existing as L.TileLayer).setOpacity(st.opacity);
        } else if (spec.tileUrl) {
          const tile = L.tileLayer(spec.tileUrl, {
            bounds: spec.bounds ?? [
              [-90, -180],
              [90, 180],
            ],
            noWrap: true,
            minZoom: 0,
            maxZoom: 10,
            maxNativeZoom: spec.maxNativeZoom ?? 5,
            tileSize: 256,
            opacity: st.opacity,
            crossOrigin: 'anonymous',
          });
          tile.on('tileerror', () => {
            setTileErrorsBySource((prev) => ({
              ...prev,
              [spec.id]: (prev[spec.id] || 0) + 1,
            }));
          });
          tile.on('tileload', () => {
            setTileErrorsBySource((prev) => {
              if (!prev[spec.id]) return prev;
              const next = { ...prev };
              delete next[spec.id];
              return next;
            });
          });
          tile.addTo(map);
          currentOverlays.set(spec.id, tile);
        }
      } else if (spec.sourceType === 'derived_dem' && spec.derivedMode) {
        if (existing && 'setOpacity' in existing) {
          (existing as L.GridLayer).setOpacity(st.opacity);
        } else {
          const derived = createDerivedDemTileLayer(
            body,
            spec.derivedMode,
            st.opacity,
            spec.maxNativeZoom ?? 7,
            (ok) => {
              setTileErrorsBySource((prev) => {
                if (ok) {
                  if (!prev[spec.id]) return prev;
                  const next = { ...prev };
                  delete next[spec.id];
                  return next;
                }
                return { ...prev, [spec.id]: (prev[spec.id] || 0) + 1 };
              });
            }
          );
          derived.addTo(map);
          currentOverlays.set(spec.id, derived);
        }
      } else if (spec.sourceType === 'vector_geojson') {
        const fc = vectorData[spec.id];
        if (!fc) continue;

        if (existing) {
          // Update opacity for GeoJSON features
          (existing as L.GeoJSON).setStyle(() => ({
            opacity: st.opacity,
            fillOpacity: spec.vectorGeometry === 'polygon' ? st.opacity * 0.28 : st.opacity * 0.85,
          }));
        } else {
          const color = spec.vectorColor || '#22d3ee';
          const geo = L.geoJSON(fc as unknown as GeoJSON.GeoJsonObject, {
            pointToLayer: (feature, latlng) => {
              const diam = Number(feature.properties?.diameter || 0);
              const radius =
                spec.id.includes('craters') && diam > 0
                  ? Math.max(3, Math.min(11, Math.sqrt(diam) * 0.55))
                  : spec.id.includes('landing')
                  ? 6
                  : 4.5;
              return L.circleMarker(latlng, {
                radius,
                color: '#07090e',
                weight: 1.25,
                fillColor: color,
                fillOpacity: st.opacity * 0.9,
                opacity: st.opacity,
              });
            },
            style: (feature) => {
              const gType = feature?.geometry?.type;
              if (gType === 'LineString' || gType === 'MultiLineString') {
                return {
                  color,
                  weight: 2.5,
                  opacity: st.opacity,
                };
              }
              return {
                color,
                weight: 1.5,
                opacity: st.opacity,
                fillColor: color,
                fillOpacity: st.opacity * 0.25,
              };
            },
            onEachFeature: (feature, layer) => {
              if (feature.properties) {
                layer.bindPopup(
                  createPopupElement(feature.properties as Record<string, unknown>, spec.name)
                );
              }
            },
          });
          geo.addTo(map);
          currentOverlays.set(spec.id, geo);
        }
      }
    }
  }, [body, layers, activeLayers, vectorData]);

  // Graticule Overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (graticuleLayerRef.current) {
      map.removeLayer(graticuleLayerRef.current);
      graticuleLayerRef.current = null;
    }

    if (!showGraticule) return;

    const grp = L.layerGroup();
    const lineStyle: L.PolylineOptions = {
      color: '#64748b',
      weight: 0.75,
      opacity: 0.45,
      dashArray: '3 4',
      interactive: false,
    };

    for (let lat = -60; lat <= 60; lat += 30) {
      L.polyline(
        [
          [lat, -180],
          [lat, 180],
        ],
        {
          ...lineStyle,
          weight: lat === 0 ? 1.1 : 0.75,
          opacity: lat === 0 ? 0.65 : 0.4,
        }
      ).addTo(grp);
    }

    for (let lon = -150; lon <= 180; lon += 30) {
      L.polyline(
        [
          [-90, lon],
          [90, lon],
        ],
        {
          ...lineStyle,
          weight: lon === 0 ? 1.1 : 0.75,
          opacity: lon === 0 ? 0.65 : 0.4,
        }
      ).addTo(grp);
    }

    grp.addTo(map);
    graticuleLayerRef.current = grp;
  }, [showGraticule]);

  // Selected Location Probe Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (probeMarkerRef.current) {
      map.removeLayer(probeMarkerRef.current);
      probeMarkerRef.current = null;
    }

    if (probeCoord) {
      const marker = L.circleMarker([probeCoord.lat, probeCoord.lon], {
        radius: 7,
        color: '#22d3ee',
        weight: 2,
        fillColor: '#06b6d4',
        fillOpacity: 0.25,
        interactive: false,
      }).addTo(map);
      probeMarkerRef.current = marker;
    }
  }, [probeCoord]);

  // Completed Elevation Profile Transect (follows sampled spherical great-circle path)
  useEffect(() => {
    const grp = profileGroupRef.current;
    if (!grp) return;
    grp.clearLayers();
    if (!profileSegment) return;

    const sampled = sampleTransectPoints(body, profileSegment.start, profileSegment.end, 24);
    const segments: Array<Array<[number, number]>> = [[]];
    for (let i = 0; i < sampled.length; i++) {
      const pt = sampled[i];
      if (i > 0 && Math.abs(pt.lon - sampled[i - 1].lon) > 180) {
        segments.push([]);
      }
      segments[segments.length - 1].push([pt.lat, pt.lon]);
    }

    for (const seg of segments) {
      if (seg.length < 2) continue;
      L.polyline(seg, {
        color: '#f59e0b',
        weight: 2.5,
        dashArray: '5 4',
      }).addTo(grp);
    }

    for (const pt of [profileSegment.start, profileSegment.end]) {
      L.circleMarker([pt.lat, pt.lon], {
        radius: 5,
        color: '#f59e0b',
        fillColor: '#fef3c7',
        fillOpacity: 1,
        weight: 2,
      }).addTo(grp);
    }
  }, [body, profileSegment]);

  // Fly-to region preset
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToTarget) return;
    map.setView([flyToTarget.lat, flyToTarget.lon], flyToTarget.zoom);
  }, [flyToTarget]);

  const totalTileErrors = Object.values(tileErrorsBySource).reduce((acc, n) => acc + n, 0);

  return (
    <div className="relative w-full h-full bg-[#04060A] overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />

      {/* Top-Left Basemap & Transect Instruction HUD */}
      <div className="absolute top-3 left-3 z-[450] pointer-events-none space-y-1.5">
        <div className="bg-[#0A0E17]/95 border border-slate-800 rounded px-3 py-1.5 text-[11px] text-slate-300 flex items-center gap-2">
          <span className="font-semibold text-slate-100">{PLANET_METADATA[body].name}</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-slate-300">{basemap.shortName}</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="font-mono text-slate-400">{basemap.resolution}</span>
        </div>

        {profileStepHint && (
          <div className="bg-amber-950/95 border border-amber-500/60 rounded px-3 py-1.5 text-xs text-amber-200 font-medium">
            {profileStepHint}
          </div>
        )}

        {totalTileErrors > 0 && (
          <div className="bg-amber-950/95 border border-amber-600/50 rounded px-3 py-1.5 text-[11px] text-amber-200 max-w-md">
            Upstream tile warning: {totalTileErrors} NASA Trek {totalTileErrors === 1 ? 'tile' : 'tiles'} failed to load cleanly; pan or zoom to retry.
          </div>
        )}

        {layers.some(
          (l) =>
            l.body === body &&
            l.sourceType === 'derived_dem' &&
            (l.derivedMode === 'slope' || l.derivedMode === 'aspect') &&
            activeLayers[l.id]?.visible
        ) &&
          (viewExtendsPolar ||
            (cursorCoord && isPolarDerivativeMasked(cursorCoord.lat)) ||
            (probeCoord && isPolarDerivativeMasked(probeCoord.lat))) && (
            <div className="bg-slate-900/95 border border-amber-500/50 rounded px-3 py-1.5 text-[11px] text-amber-200 max-w-md">
              Polar Slope/Aspect Masked (|lat| &gt; {POLAR_DERIVATIVE_MAX_LAT_DEG}°): Equirectangular pixel anisotropy exceeds 11.5:1 near the poles; use Polar Stereographic DTMs above {POLAR_DERIVATIVE_MAX_LAT_DEG}°.
            </div>
          )}
      </div>

      {/* Bottom-Left Live Coordinate Telemetry Bar */}
      <div className="absolute bottom-3 left-3 z-[450] pointer-events-none bg-[#0A0E17]/95 border border-slate-800 rounded px-3 py-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-300">
        {cursorCoord ? (
          <>
            <span>Lat: {formatLat(cursorCoord.lat)}</span>
            <span>Lon: {formatLon(cursorCoord.lon)}</span>
          </>
        ) : (
          <span className="text-slate-400">Move cursor or click surface to inspect coordinates</span>
        )}
        <span className="text-slate-500">Zoom: Z{zoomLevel}</span>
      </div>
    </div>
  );
};
