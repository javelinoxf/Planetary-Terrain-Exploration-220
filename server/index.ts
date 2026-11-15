import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const isProduction = process.env.NODE_ENV === 'production';

const ALLOWED_VECTOR_LAYERS: Record<'moon' | 'mars', ReadonlySet<string>> = {
  moon: new Set([
    'moon-craters',
    'moon-structures',
    'moon-psr',
    'moon-water-ice',
    'moon-apollo-traverses',
    'moon-landing-sites',
    'moon-exploration-regions',
    'moon-poi',
  ]),
  mars: new Set([
    'mars-craters',
    'mars-structures',
    'mars-hydrous-minerals',
    'mars-chloride-salts',
    'mars-rsl-ice',
    'mars-rover-traverses',
    'mars-landing-sites',
    'mars-exploration-regions',
    'mars-crism-coverage',
    'mars-poi',
  ]),
};

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

const demTileCache = new Map<string, CacheEntry<Buffer>>();
const MAX_DEM_CACHE_ENTRIES = 400;

const inFlightRequests = new Map<string, Promise<unknown>>();

function deduplicateInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, p);
  return p;
}

function parseFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseStrictInt(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function isValidLat(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isValidLonInput(lon: number): boolean {
  return Number.isFinite(lon) && lon >= -180 && lon <= 360;
}

function sanitizePublicError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message || '';
  if (msg.startsWith('Upstream NASA Trek') || msg.startsWith('Elevation service returned') || msg.startsWith('ImageServer exportImage returned') || msg.startsWith('Earth DEM service returned')) {
    return msg;
  }
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    if (msg.startsWith('Earth DEM service')) return 'Earth DEM service request timed out';
    return 'Upstream NASA Trek request timed out';
  }
  return fallback;
}

function getCached<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttlMs = CACHE_TTL_MS): void {
  if (memoryCache.size > 2000) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey !== undefined) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function getCachedDem(key: string): Buffer | null {
  const entry = demTileCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    demTileCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedDem(key: string, value: Buffer): void {
  if (demTileCache.size >= MAX_DEM_CACHE_ENTRIES) {
    const oldestKey = demTileCache.keys().next().value;
    if (oldestKey !== undefined) demTileCache.delete(oldestKey);
  }
  demTileCache.set(key, { value, expiresAt: Date.now() + 1000 * 60 * 60 });
}

function cleanArcgisText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(?:\?á)+/g, ' ')
    .replace(/\uFFFD/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    cleaned[k] = typeof v === 'string' ? cleanArcgisText(v) : v;
  }
  return cleaned;
}

function normalizeLon180(lon: number): number {
  let wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180 && lon > 0) wrapped = 180;
  return wrapped;
}

function arcgisFeatureToGeoJSON(
  feature: { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> },
  geometryTypeHint?: string
): {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
} | null {
  const geom = feature.geometry;
  const attrs = feature.attributes || {};
  if (!geom) return null;

  if (typeof geom.x === 'number' && typeof geom.y === 'number') {
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [normalizeLon180(geom.x), geom.y],
      },
      properties: attrs,
    };
  }

  if (Array.isArray(geom.points)) {
    const pts = (geom.points as number[][]).map((p) => [normalizeLon180(p[0]), p[1]]);
    return {
      type: 'Feature',
      geometry: {
        type: 'MultiPoint',
        coordinates: pts,
      },
      properties: attrs,
    };
  }

  if (Array.isArray(geom.paths)) {
    const paths = (geom.paths as number[][][]).map((ring) =>
      ring.map((pt) => [normalizeLon180(pt[0]), pt[1]])
    );
    return {
      type: 'Feature',
      geometry:
        paths.length === 1
          ? { type: 'LineString', coordinates: paths[0] }
          : { type: 'MultiLineString', coordinates: paths },
      properties: attrs,
    };
  }

  if (Array.isArray(geom.rings)) {
    const rings = (geom.rings as number[][][]).map((ring) =>
      ring.map((pt) => [normalizeLon180(pt[0]), pt[1]])
    );
    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: rings,
      },
      properties: attrs,
    };
  }

  if (geometryTypeHint === 'esriGeometryPoint' && typeof attrs.center_lon === 'number' && typeof attrs.center_lat === 'number') {
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [normalizeLon180(attrs.center_lon), attrs.center_lat],
      },
      properties: attrs,
    };
  }

  return null;
}

interface ArcgisQueryResponse {
  geometryType?: string;
  objectIdFieldName?: string;
  exceededTransferLimit?: boolean;
  objectIds?: number[];
  features?: Array<{ attributes?: Record<string, unknown>; geometry?: Record<string, unknown> }>;
  error?: { message?: string };
}

class NonRetryableHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  attempts = 3,
  timeoutMs = 15000
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const err = new NonRetryableHttpError(res.status, `Upstream NASA Trek error (${res.status})`);
        // Do not retry permanent 4xx errors (except 429 rate-limit)
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw err;
        }
        throw new Error(err.message);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (err instanceof NonRetryableHttpError || i === attempts - 1) {
        break;
      }
      const backoffMs = Math.min(2000, 250 * Math.pow(2, i) + Math.floor(Math.random() * 120));
      await sleepMs(backoffMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Upstream NASA Trek request failed');
}

async function fetchJsonWithRetry<T>(
  url: string,
  init?: RequestInit,
  attempts = 3,
  timeoutMs = 15000
): Promise<T> {
  const res = await fetchWithRetry(url, init, attempts, timeoutMs);
  return (await res.json()) as T;
}

async function fetchEarthTerrainTile(z: number, x: number, y: number): Promise<Buffer> {
  const cacheKey = `earth:${z}/${x}/${y}`;
  const cached = getCachedDem(cacheKey);
  if (cached) return cached;

  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`Earth DEM service returned HTTP ${response.status}`);
  }
  if (!response.headers.get('content-type')?.includes('image/png')) {
    throw new Error('Earth DEM service returned a non-PNG tile');
  }

  const tile = Buffer.from(await response.arrayBuffer());
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (tile.length < pngSignature.length || !tile.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error('Earth DEM service returned invalid PNG data');
  }

  setCachedDem(cacheKey, tile);
  return tile;
}

async function fetchArcgisLayer(url: string): Promise<Array<{
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}>> {
  const data = await fetchJsonWithRetry<ArcgisQueryResponse>(url);
  if (data.error) {
    throw new Error(data.error.message || 'ArcGIS query error');
  }

  let rawFeatures = data.features || [];
  let geometryType = data.geometryType;

  // Handle ArcGIS maxRecordCount truncation via returnIdsOnly + POST objectIds chunking
  // (NASA Trek ArcGIS Server sets supportsPagination=false, so resultOffset is unsupported)
  if (data.exceededTransferLimit) {
    const parsedUrl = new URL(url);
    const layerBaseUrl = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/query$/, '')}`;

    // Respect upstream maxRecordCount when advertised
    let maxRecordCount = 1000;
    try {
      const layerMeta = await fetchJsonWithRetry<{ maxRecordCount?: number }>(
        `${layerBaseUrl}?f=json`,
        undefined,
        1
      );
      if (typeof layerMeta.maxRecordCount === 'number' && layerMeta.maxRecordCount > 0) {
        maxRecordCount = layerMeta.maxRecordCount;
      }
    } catch {
      maxRecordCount = 1000;
    }

    const idParams = new URLSearchParams();
    idParams.set('where', parsedUrl.searchParams.get('where') || '1=1');
    idParams.set('returnIdsOnly', 'true');
    idParams.set('f', 'json');

    const idsResp = await fetchJsonWithRetry<ArcgisQueryResponse>(
      `${parsedUrl.origin}${parsedUrl.pathname}?${idParams.toString()}`
    );
    if (idsResp.error) {
      throw new Error(idsResp.error.message || 'ArcGIS returnIdsOnly failed');
    }

    const objectIds = (idsResp.objectIds || []).slice().sort((a, b) => a - b);
    const oidField = idsResp.objectIdFieldName || 'OBJECTID';
    if (objectIds.length === 0) {
      throw new Error('ArcGIS exceededTransferLimit was true but returnIdsOnly returned 0 IDs');
    }

    const chunkSize = Math.min(maxRecordCount, 500);
    const chunks: number[][] = [];
    for (let i = 0; i < objectIds.length; i += chunkSize) {
      chunks.push(objectIds.slice(i, i + chunkSize));
    }

    const outFields = parsedUrl.searchParams.get('outFields') || '*';
    const outSR = parsedUrl.searchParams.get('outSR');

    const allChunkFeatures: Array<{ attributes?: Record<string, unknown>; geometry?: Record<string, unknown> }> = [];
    const seenIds = new Set<unknown>();

    // Bounded concurrency (3 chunks at a time)
    for (let i = 0; i < chunks.length; i += 3) {
      const batch = chunks.slice(i, i + 3);
      const batchResults = await Promise.all(
        batch.map(async (idChunk) => {
          const body = new URLSearchParams({
            objectIds: idChunk.join(','),
            outFields,
            f: 'json',
          });
          if (outSR) body.set('outSR', outSR);

          const chunkResp = await fetchJsonWithRetry<ArcgisQueryResponse>(
            `${parsedUrl.origin}${parsedUrl.pathname}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: body.toString(),
            }
          );
          if (chunkResp.error) {
            throw new Error(chunkResp.error.message || 'ArcGIS paginated chunk error');
          }
          if (!geometryType && chunkResp.geometryType) {
            geometryType = chunkResp.geometryType;
          }
          return chunkResp.features || [];
        })
      );

      for (const feat of batchResults.flat()) {
        const oid = feat.attributes?.[oidField] ?? feat.attributes?.FID ?? feat.attributes?.OBJECTID;
        if (oid !== undefined && oid !== null) {
          if (seenIds.has(oid)) continue;
          seenIds.add(oid);
        }
        allChunkFeatures.push(feat);
      }
    }

    if (allChunkFeatures.length !== objectIds.length) {
      throw new Error(
        `Incomplete ArcGIS pagination: expected ${objectIds.length} records, received ${allChunkFeatures.length}`
      );
    }

    rawFeatures = allChunkFeatures;
  }

  const out: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
  }> = [];
  for (const f of rawFeatures) {
    const converted = arcgisFeatureToGeoJSON(f, geometryType);
    if (converted && converted.geometry) {
      out.push({
        type: 'Feature',
        geometry: converted.geometry,
        properties: cleanAttributes(converted.properties),
      });
    }
  }
  return out;
}

async function queryElevationPoint(
  body: 'moon' | 'mars',
  lon: number,
  lat: number
): Promise<{ elevationM: number | null; source: string; lat: number; lon: number }> {
  const normLon = normalizeLon180(lon);
  const clampedLat = Math.max(-89.95, Math.min(89.95, lat));
  const key = `elev:${body}:${normLon.toFixed(3)}:${clampedLat.toFixed(3)}`;
  const cached = getCached<{ elevationM: number | null; source: string; lat: number; lon: number }>(key);
  if (cached) return cached;

  return deduplicateInFlight(key, async () => {
    const serviceUrl =
      body === 'moon'
        ? 'https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_256ppd_v06/ImageServer/identify'
        : 'https://trek.nasa.gov/mars/trekarcgis/rest/services/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer/identify';

    const sourceLabel =
      body === 'moon'
        ? 'NASA LRO LOLA Global DEM (256 ppd, v06)'
        : 'NASA MGS MOLA + ESA Mars Express HRSC Blended DEM (200 m/px)';

    const params = new URLSearchParams({
      geometry: `${normLon.toFixed(5)},${clampedLat.toFixed(5)}`,
      geometryType: 'esriGeometryPoint',
      returnGeometry: 'false',
      returnCatalogItems: 'false',
      f: 'json',
    });

    const data = await fetchJsonWithRetry<{ value?: string | number; error?: { message?: string } }>(
      `${serviceUrl}?${params.toString()}`,
      undefined,
      2,
      7000
    );
    if (data.error) {
      throw new Error('Upstream NASA Trek elevation service reported a query error');
    }
    const parsed = data.value !== undefined && data.value !== 'NoData' ? Number(data.value) : NaN;
    const result = {
      elevationM: Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : null,
      source: sourceLabel,
      lat: clampedLat,
      lon: normLon,
    };
    setCached(key, result, 1000 * 60 * 60);
    return result;
  });
}

async function buildVectorFeatures(body: 'moon' | 'mars', layerId: string) {
  if (!ALLOWED_VECTOR_LAYERS[body].has(layerId)) {
    throw new NonRetryableHttpError(400, 'Unknown vector layerId for planetary body');
  }
  const cacheKey = `vec:${body}:${layerId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  return deduplicateInFlight(cacheKey, async () => {

  let features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
  }> = [];
  let source = 'NASA Solar System Treks / USGS Astrogeology';

  if (body === 'moon') {
    if (layerId === 'moon-craters') {
      const q = encodeURIComponent("type='Crater, craters' AND diameter>=45");
      features = await fetchArcgisLayer(
        `https://trek.nasa.gov/moon/trekarcgis/rest/services/CombinedNomenclature/MapServer/0/query?where=${q}&outFields=FEATURE,LABEL,type,diameter,center_lon,center_lat,origin,quad_name&f=json`
      );
      source = 'IAU / USGS Lunar Planetary Nomenclature (Craters ≥ 45 km)';
    } else if (layerId === 'moon-structures') {
      const q = encodeURIComponent(
        "type IN ('Mare, maria','Mons, montes','Rima, rimae','Vallis, valles','Rupes, rupes','Catena, catenae','Dorsum, dorsa')"
      );
      features = await fetchArcgisLayer(
        `https://trek.nasa.gov/moon/trekarcgis/rest/services/CombinedNomenclature/MapServer/0/query?where=${q}&outFields=FEATURE,LABEL,type,diameter,center_lon,center_lat,origin&f=json`
      );
      source = 'IAU / USGS Lunar Geological Structure Nomenclature';
    } else if (layerId === 'moon-psr') {
      const [sp, np] = await Promise.all([
        fetchArcgisLayer(
          'https://trek.nasa.gov/moon/trekarcgis/rest/services/PSR_SP/MapServer/0/query?where=1%3D1&outFields=PSR_ID,Cent__Lat_,Cent__Long,Area__km2_,Lunar_Feat,Coverage__&outSR=104903&f=json'
        ),
        fetchArcgisLayer(
          'https://trek.nasa.gov/moon/trekarcgis/rest/services/PSR_NP/MapServer/0/query?where=1%3D1&outFields=PSR_ID,Cent__Lat_,Cent__Long,Area__km2_,Lunar_Feat,Coverage__&outSR=104903&f=json'
        ),
      ]);
      features = [
        ...sp.map((f) => ({ ...f, properties: { ...f.properties, pole: 'South Pole' } })),
        ...np.map((f) => ({ ...f, properties: { ...f.properties, pole: 'North Pole' } })),
      ];
      source = 'NASA LRO LOLA Permanently Shadowed Regions (North & South Polar Catalog)';
    } else if (layerId === 'moon-water-ice') {
      const [sp, np] = await Promise.all([
        fetchArcgisLayer(
          'https://trek.nasa.gov/moon/trekarcgis/rest/services/SP_IceLoc_280m/MapServer/0/query?where=1%3D1&outFields=*&outSR=104903&f=json'
        ),
        fetchArcgisLayer(
          'https://trek.nasa.gov/moon/trekarcgis/rest/services/NP_IceLoc_280m/MapServer/0/query?where=1%3D1&outFields=*&outSR=104903&f=json'
        ),
      ]);
      features = [
        ...sp.map((f) => ({ ...f, properties: { ...f.properties, pole: 'South Pole', method: 'M³ & LAMP Surface Water Ice Detection' } })),
        ...np.map((f) => ({ ...f, properties: { ...f.properties, pole: 'North Pole', method: 'M³ & LAMP Surface Water Ice Detection' } })),
      ];
      source = 'NASA Moon Trek / Chandrayaan-1 M³ & LRO LAMP Polar Water Ice Detections';
    } else if (layerId === 'moon-apollo-traverses') {
      const missions = [
        { name: 'Apollo 12 EVA', svc: 'Apollo12_path', year: 1969 },
        { name: 'Apollo 14 EVA', svc: 'Apollo14_path', year: 1971 },
        { name: 'Apollo 15 LRV Traverse', svc: 'Apollo15_path', year: 1971 },
        { name: 'Apollo 16 LRV Traverse', svc: 'Apollo16_path', year: 1972 },
        { name: 'Intrepid / Endurance-A Concept', svc: 'LOLAKaguya_NorthernTraverse_whole_line_v3', year: 2024 },
      ];
      const results = await Promise.all(
        missions.map(async (m) => {
          try {
            const feats = await fetchArcgisLayer(
              `https://trek.nasa.gov/moon/trekarcgis/rest/services/${m.svc}/MapServer/0/query?where=1%3D1&outFields=*&outSR=104903&f=json`
            );
            return feats.map((f) => ({
              ...f,
              properties: { ...f.properties, mission: m.name, year: m.year },
            }));
          } catch (error) {
            throw new Error(
              `Failed to retrieve ${m.name} traverse: ${
                error instanceof Error ? error.message : 'unknown upstream error'
              }`
            );
          }
        })
      );
      features = results.flat();
      source = 'NASA Moon Trek / LROC Apollo EVA & Traverse Archives';
    } else if (layerId === 'moon-landing-sites') {
      const q = encodeURIComponent("Spacecraft <> ' '");
      const nasaSites = await fetchArcgisLayer(
        `https://trek.nasa.gov/moon/trekarcgis/rest/services/CombinedNomenclature/MapServer/0/query?where=${q}&outFields=FID,Spacecraft,type,Date,Lat_Lon,Lat_Y,Lon_X,link&f=json`
      );
      const curatedLanders = [
        { name: 'Apollo 11 (Tranquility Base)', agency: 'NASA', year: '1969', type: 'Crewed Landing', lat: 0.6741, lon: 23.4731, matchNames: ['Apollo 11 LM descent stage'] },
        { name: 'Apollo 12 (Oceanus Procellarum)', agency: 'NASA', year: '1969', type: 'Crewed Landing', lat: -3.0124, lon: -23.4216, matchNames: ['Apollo 12 LM descent stage'] },
        { name: 'Apollo 14 (Fra Mauro)', agency: 'NASA', year: '1971', type: 'Crewed Landing', lat: -3.6453, lon: -17.4714, matchNames: ['Apollo 14 LM descent stage'] },
        { name: 'Apollo 15 (Hadley-Apennine)', agency: 'NASA', year: '1971', type: 'Crewed Landing', lat: 26.1322, lon: 3.6339, matchNames: ['Apollo 15 LM descent stage'] },
        { name: 'Apollo 16 (Descartes Highlands)', agency: 'NASA', year: '1972', type: 'Crewed Landing', lat: -8.973, lon: 15.5002, matchNames: ['Apollo 16 LM descent stage'] },
        { name: 'Apollo 17 (Taurus-Littrow)', agency: 'NASA', year: '1972', type: 'Crewed Landing', lat: 20.1908, lon: 30.7717, matchNames: ['Apollo 17 LM descent stage'] },
        { name: "Chang'e 3 / Yutu", agency: 'CNSA', year: '2013', type: 'Lander & Rover', lat: 44.1214, lon: -19.5116, matchNames: ["Chang'e 3", 'Yutu Rover'] },
        { name: "Chang'e 4 / Yutu-2 (Von Kármán)", agency: 'CNSA', year: '2019', type: 'Far-Side Lander & Rover', lat: -45.4561, lon: 177.5885, matchNames: ["Chang'e 4", 'Yutu 2'] },
        { name: "Chang'e 5 (Mons Rümker)", agency: 'CNSA', year: '2020', type: 'Sample Return', lat: 43.0576, lon: -51.9161, matchNames: ["Chang'e 5"] },
        { name: 'Chandrayaan-3 (Shiv Shakti Point)', agency: 'ISRO', year: '2023', type: 'Lander & Rover', lat: -69.373, lon: 32.319, matchNames: [] as string[] },
        { name: 'SLIM (Shioli Crater)', agency: 'JAXA', year: '2024', type: 'Precision Lander', lat: -13.316, lon: 25.251, matchNames: [] as string[] },
        { name: "Chang'e 6 (Apollo Basin)", agency: 'CNSA', year: '2024', type: 'Far-Side Sample Return', lat: -41.6385, lon: -153.9852, matchNames: [] as string[] },
      ];

      // Build lookup for upstream lander entries that represent the same physical landing site
      // while preserving distinct hardware stages (S-IVB, LM ascent stages, Lunokhod rovers, Chang'e 5 Ascent Craft, etc.)
      const upstreamByName = new Map<string, (typeof nasaSites)[number]>();
      for (const f of nasaSites) {
        const scName = String(f.properties.Spacecraft || '').trim();
        if (scName) upstreamByName.set(scName, f);
      }

      const mergedUpstreamNames = new Set<string>();
      const curatedFeatures = curatedLanders.map((s) => {
        let matchedUpstream: (typeof nasaSites)[number] | undefined;
        for (const mName of s.matchNames) {
          mergedUpstreamNames.add(mName);
          if (!matchedUpstream) matchedUpstream = upstreamByName.get(mName);
        }
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
          properties: {
            name: s.name,
            agency: s.agency,
            year: s.year,
            type: s.type,
            lat: s.lat,
            lon: s.lon,
            ...(matchedUpstream?.properties?.Date ? { Date: matchedUpstream.properties.Date } : {}),
            ...(matchedUpstream?.properties?.link ? { link: matchedUpstream.properties.link } : {}),
            sourceAttribution: matchedUpstream
              ? 'NASA Moon Trek CombinedNomenclature / NSSDC'
              : 'Mission Localization Catalog (ISRO / JAXA / CNSA)',
            LABEL: s.name,
            category: 'Verified Soft Landing',
          },
        };
      });

      const distinctUpstreamFeatures = nasaSites
        .filter((f) => !mergedUpstreamNames.has(String(f.properties.Spacecraft || '').trim()))
        .map((f) => {
          const props = { ...f.properties };
          // Remove redundant malformed upstream Lat_Lon string (e.g. Chang'e 5 S/N typo) since Lat_Y/Lon_X are verified
          delete props.Lat_Lon;
          return {
            ...f,
            properties: {
              ...props,
              sourceAttribution: 'NASA Moon Trek CombinedNomenclature / NSSDC',
              LABEL: props.Spacecraft || 'Lunar Spacecraft Site',
              category: props.type || 'Spacecraft Site',
            },
          };
        });

      features = [...curatedFeatures, ...distinctUpstreamFeatures];
      source = 'NASA Moon Trek / NSSDC Lunar Exploration Landing & Impact Catalog';
    } else if (layerId === 'moon-exploration-regions') {
      const artemisRegions = [
        { name: 'Peak Near Shackleton', lat: -88.8, lon: 123.0, radiusKm: 15, mission: 'Artemis III Candidate Region' },
        { name: 'Connecting Ridge', lat: -89.45, lon: -137.0, radiusKm: 15, mission: 'Artemis III Candidate Region' },
        { name: 'Connecting Ridge Extension', lat: -89.1, lon: -115.0, radiusKm: 15, mission: 'Artemis III Candidate Region' },
        { name: 'de Gerlache Rim 1', lat: -88.45, lon: -87.0, radiusKm: 15, mission: 'Artemis III Candidate Region' },
        { name: 'de Gerlache Rim 2', lat: -88.1, lon: -72.0, radiusKm: 15, mission: 'Artemis III Candidate Region' },
        { name: 'Faustini Rim A', lat: -87.3, lon: 78.0, radiusKm: 15, mission: 'Artemis III Candidate Region' },
        { name: 'Haworth', lat: -87.5, lon: -5.0, radiusKm: 15, mission: 'Artemis III Candidate Region' },
        { name: 'Malapert Massif', lat: -86.0, lon: 2.0, radiusKm: 15, mission: 'Artemis III Candidate Region' },
        { name: 'Leibnitz Beta Plateau', lat: -85.3, lon: 31.0, radiusKm: 15, mission: 'Artemis III Candidate Region' },
        { name: 'Nobile Rim 1', lat: -85.2, lon: 53.0, radiusKm: 15, mission: 'Artemis III Candidate Region' },
        { name: 'Mons Mouton (VIPER / Prime)', lat: -84.6, lon: 31.0, radiusKm: 15, mission: 'Artemis South Pole Exploration Zone' },
        { name: 'Schrödinger Basin (CLPS Farside)', lat: -75.0, lon: 132.4, radiusKm: 35, mission: 'Farside Seismic & Volatile Science' },
        { name: 'Aristarchus Plateau', lat: 25.5, lon: -49.0, radiusKm: 40, mission: 'Silicic Volcanism Priority Target' },
      ];
      features = artemisRegions.map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: { ...r, LABEL: r.name },
      }));
      source = 'NASA Artemis III Candidate South Pole Regions & SSERVI Priority Targets';
    } else if (layerId === 'moon-poi') {
      const pois = [
        { name: 'Tycho Central Peak', lat: -43.31, lon: -11.36, focus: 'Exposed lower-crustal anorthosite & fresh impact melt' },
        { name: 'Copernicus Crater', lat: 9.62, lon: -20.08, focus: 'Copernican-age stratigraphically dated ray crater' },
        { name: 'South Pole–Aitken Basin Center', lat: -53.0, lon: -169.0, focus: 'Largest impact basin in the Solar System (~2,500 km)' },
        { name: 'Reiner Gamma Swirl', lat: 7.5, lon: -59.0, focus: 'Magnetic anomaly & high-albedo lunar swirl' },
        { name: 'Ina Irregular Mare Patch', lat: 18.65, lon: 5.3, focus: 'Young (<100 Ma) basaltic outgassing/volcanic feature' },
        { name: 'Gruithuisen Domes', lat: 36.3, lon: -39.8, focus: 'Non-mare silicic volcanic domes (Lunar-VISE target)' },
        { name: 'LCROSS Cabeus Impact Site', lat: -84.675, lon: -48.725, focus: 'Confirmed ~5.6 wt% H₂O ice plume in permanently shadowed floor' },
        { name: 'Marius Hills Pit', lat: 14.09, lon: -56.77, focus: 'Confirmed intact lava tube skylight candidate' },
      ];
      features = pois.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { ...p, LABEL: p.name },
      }));
      source = 'NASA SSERVI & LRO Priority Lunar Science Targets';
    }
  } else if (body === 'mars') {
    if (layerId === 'mars-craters') {
      const q = encodeURIComponent("type='Crater, craters' AND diameter>=45");
      features = await fetchArcgisLayer(
        `https://trek.nasa.gov/mars/trekarcgis/rest/services/combinedNom/MapServer/0/query?where=${q}&outFields=name,type,diameter,quad_name,origin,x,y&f=json`
      );
      source = 'IAU / USGS Martian Planetary Nomenclature (Craters ≥ 45 km)';
    } else if (layerId === 'mars-structures') {
      const q = encodeURIComponent(
        "type IN ('Vallis, valles','Fossa, fossae','Rupes, rupes','Dorsum, dorsa','Mons, montes','Tholus, tholi','Chasma, chasmata','Patera, paterae')"
      );
      features = await fetchArcgisLayer(
        `https://trek.nasa.gov/mars/trekarcgis/rest/services/combinedNom/MapServer/0/query?where=${q}&outFields=name,type,diameter,quad_name,origin&f=json`
      );
      source = 'IAU / USGS Martian Tectonic, Volcanic & Fluvial Structures';
    } else if (layerId === 'mars-hydrous-minerals') {
      features = await fetchArcgisLayer(
        'https://trek.nasa.gov/mars/trekarcgis/rest/services/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/0/query?where=1%3D1&outFields=Type,Instrument,Latitude,Long_East&f=json'
      );
      source = 'Mars Express OMEGA & MRO CRISM Hydrous Mineral Catalog';
    } else if (layerId === 'mars-chloride-salts') {
      features = await fetchArcgisLayer(
        'https://trek.nasa.gov/mars/trekarcgis/rest/services/Chloride_Salt_bearing_Material_THEMIS_clon0/MapServer/0/query?where=1%3D1&outFields=Name,Label,Lat2,Lon2&f=json'
      );
      source = 'Mars Odyssey THEMIS Chloride Salt-Bearing Material Catalog';
    } else if (layerId === 'mars-rsl-ice') {
      features = await fetchArcgisLayer(
        'https://trek.nasa.gov/mars/trekarcgis/rest/services/RSLs_Gullies_New_IcyCraters_clon0/MapServer/0/query?where=1%3D1&outFields=*&f=json'
      );
      source = 'MRO HiRISE Recurring Slope Lineae, Gullies & Icy Impact Craters';
    } else if (layerId === 'mars-rover-traverses') {
      const rovers = [
        { name: 'Perseverance (Jezero Crater)', svc: 'Perseverance_Traverse_Path' },
        { name: 'Curiosity (Gale Crater)', svc: 'curiosity_path' },
        { name: 'Opportunity (Meridiani Planum)', svc: 'opportunity_path' },
        { name: 'Spirit (Gusev Crater)', svc: 'spirit_path' },
      ];
      const results = await Promise.all(
        rovers.map(async (r) => {
          try {
            const feats = await fetchArcgisLayer(
              `https://trek.nasa.gov/mars/trekarcgis/rest/services/${r.svc}/MapServer/0/query?where=1%3D1&outFields=*&f=json`
            );
            return feats.map((f) => ({
              ...f,
              properties: { ...f.properties, rover: r.name },
            }));
          } catch (error) {
            throw new Error(
              `Failed to retrieve ${r.name} traverse: ${
                error instanceof Error ? error.message : 'unknown upstream error'
              }`
            );
          }
        })
      );
      features = results.flat();
      source = 'NASA Mars Trek / JPL Official Surface Rover Traverse Archives';
    } else if (layerId === 'mars-landing-sites') {
      const landers = [
        { name: 'Viking 1 Lander', agency: 'NASA', year: 1976, region: 'Chryse Planitia', lat: 22.27, lon: -47.95 },
        { name: 'Viking 2 Lander', agency: 'NASA', year: 1976, region: 'Utopia Planitia', lat: 47.64, lon: 134.29 },
        { name: 'Mars Pathfinder / Sojourner', agency: 'NASA', year: 1997, region: 'Ares Vallis', lat: 19.13, lon: -33.22 },
        { name: 'Spirit (MER-A)', agency: 'NASA', year: 2004, region: 'Gusev Crater', lat: -14.5684, lon: 175.4726 },
        { name: 'Opportunity (MER-B)', agency: 'NASA', year: 2004, region: 'Meridiani Planum', lat: -1.9462, lon: -5.5272 },
        { name: 'Phoenix Lander', agency: 'NASA', year: 2008, region: 'Vastitas Borealis', lat: 68.2188, lon: -125.7492 },
        { name: 'Curiosity (MSL)', agency: 'NASA', year: 2012, region: 'Gale Crater', lat: -4.5895, lon: 137.4417 },
        { name: 'InSight Lander', agency: 'NASA', year: 2018, region: 'Elysium Planitia', lat: 4.5024, lon: 135.6234 },
        { name: 'Perseverance (Mars 2020) & Ingenuity', agency: 'NASA', year: 2021, region: 'Jezero Crater', lat: 18.4447, lon: 77.4508 },
        { name: 'Zhurong (Tianwen-1)', agency: 'CNSA', year: 2021, region: 'Utopia Planitia', lat: 25.066, lon: 109.925 },
      ];
      features = landers.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { ...s, LABEL: s.name },
      }));
      source = 'NASA Mars Trek & IAU Verified Mars Surface Missions';
    } else if (layerId === 'mars-exploration-regions') {
      features = await fetchArcgisLayer(
        'https://trek.nasa.gov/mars/trekarcgis/rest/services/mars2020/MapServer/0/query?where=1%3D1&outFields=Name,link&f=json'
      );
      source = 'NASA Mars 2020 Candidate Landing Sites & Exploration Zones';
    } else if (layerId === 'mars-crism-coverage') {
      features = await fetchArcgisLayer(
        'https://trek.nasa.gov/mars/trekarcgis/rest/services/mars_mro_crism_mtrdr_c0a_humex_frt_sites/MapServer/0/query?where=1%3D1&outFields=ProductId,CenterLat,CenterLon,UTCstart,SubSiteTag&f=json'
      );
      source = 'MRO CRISM MTRDR Targeted Observation Footprints (PDS Geosciences Node)';
    } else if (layerId === 'mars-poi') {
      const pois = [
        { name: 'Olympus Mons Summit Caldera', lat: 18.65, lon: -133.8, focus: 'Tallest shield volcano in the Solar System (~21.9 km above datum)' },
        { name: 'Melas Chasma (Valles Marineris)', lat: -10.52, lon: -72.54, focus: 'Deepest canyon segment (~9 km relief) with layered sulfates' },
        { name: 'Hellas Planitia Floor', lat: -42.4, lon: 70.5, focus: 'Deepest impact basin (~7,152 m below datum), highest surface pressure' },
        { name: 'Mawrth Vallis', lat: 22.3, lon: -16.5, focus: 'Thick phyllosilicate clay stratigraphy from Noachian era' },
        { name: 'Noctis Labyrinthus', lat: -6.8, lon: -96.5, focus: 'Fractured graben & fault intersection at Tharsis apex' },
        { name: 'Korolev Crater', lat: 72.8, lon: -164.5, focus: '81 km crater hosting permanent ~1.8 km thick water-ice mound' },
        { name: 'Nili Fossae', lat: 21.0, lon: 74.5, focus: 'Olivine & carbonate-rich crust adjacent to Isidis Basin' },
        { name: 'Cerberus Fossae', lat: 9.2, lon: 162.5, focus: 'Active marsquake tectonic fissure system detected by InSight' },
      ];
      features = pois.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { ...p, LABEL: p.name },
      }));
      source = 'NASA Mars Trek & Planetary Science Priority Targets';
    }
  }

    const fc = {
      type: 'FeatureCollection',
      layerId,
      source,
      features,
    };
    setCached(cacheKey, fc);
    return fc;
  });
}

function decodeUncompressedElevationTiff(buf: Buffer, fallbackNoData: number): Float32Array {
  if (buf.length < 8) throw new Error('Invalid TIFF buffer');
  const sig = buf.toString('ascii', 0, 2);
  if (sig !== 'II' && sig !== 'MM') throw new Error(`Unsupported TIFF byte order: ${sig}`);
  const le = sig === 'II';
  const r16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const r32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

  const ifdOff = r32(4);
  const count = r16(ifdOff);
  const tags: Record<number, unknown> = {};
  for (let i = 0; i < count; i++) {
    const off = ifdOff + 2 + i * 12;
    const tag = r16(off);
    const type = r16(off + 2);
    const cnt = r32(off + 4);
    const valOff = off + 8;
    const typeSize = type === 1 || type === 2 ? 1 : type === 3 ? 2 : type === 4 ? 4 : 8;
    const dataPos = cnt * typeSize <= 4 ? valOff : r32(valOff);
    if (type === 2) {
      tags[tag] = buf.toString('ascii', dataPos, dataPos + Math.max(0, cnt - 1));
    } else if (type === 3) {
      const a: number[] = [];
      for (let k = 0; k < cnt; k++) a.push(r16(dataPos + k * 2));
      tags[tag] = cnt === 1 ? a[0] : a;
    } else if (type === 4) {
      const a: number[] = [];
      for (let k = 0; k < cnt; k++) a.push(r32(dataPos + k * 4));
      tags[tag] = cnt === 1 ? a[0] : a;
    }
  }

  const w = Number(tags[256]);
  const h = Number(tags[257]);
  const bps = Number(tags[258]);
  const compression = Number(tags[259] ?? 1);
  const sampleFormat = Number(tags[339] ?? 1);
  if (compression !== 1) throw new Error(`Unsupported TIFF compression: ${compression}`);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error('Missing TIFF dimensions');
  }

  const gdalNoData = tags[42113] !== undefined ? Number(tags[42113]) : fallbackNoData;
  const isTiled = tags[324] !== undefined;
  const tw = Number(tags[322] || w);
  const th = Number(tags[323] || Number(tags[278] || h));
  const rawOffsets = isTiled ? tags[324] : tags[273];
  const offsets = (Array.isArray(rawOffsets) ? rawOffsets : [rawOffsets]).map(Number);

  const out = new Float32Array(w * h);
  out.fill(Number.NaN);
  const bpp = bps / 8;
  const tilesX = Math.ceil(w / tw);
  const tilesY = Math.ceil(h / th);

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const blockOff = offsets[ty * tilesX + tx];
      if (!Number.isFinite(blockOff)) continue;
      for (let py = 0; py < th; py++) {
        const iy = ty * th + py;
        if (iy >= h) break;
        for (let px = 0; px < tw; px++) {
          const ix = tx * tw + px;
          if (ix >= w) break;
          const pos = blockOff + (py * tw + px) * bpp;
          if (pos + bpp > buf.length) continue;
          let v = Number.NaN;
          if (bps === 32 && sampleFormat === 3) {
            v = le ? buf.readFloatLE(pos) : buf.readFloatBE(pos);
          } else if (bps === 16 && sampleFormat === 2) {
            v = le ? buf.readInt16LE(pos) : buf.readInt16BE(pos);
          } else if (bps === 16 && sampleFormat === 1) {
            v = le ? buf.readUInt16LE(pos) : buf.readUInt16BE(pos);
          }
          if (
            Number.isFinite(v) &&
            v !== gdalNoData &&
            v !== fallbackNoData &&
            Math.abs(v) < 50000
          ) {
            out[iy * w + ix] = v;
          }
        }
      }
    }
  }
  return out;
}

async function fetchCalibratedDemTile(
  body: 'moon' | 'mars',
  z: number,
  x: number,
  y: number
): Promise<Buffer> {
  const cacheKey = `dem:${body}:${z}:${x}:${y}`;
  const cached = getCachedDem(cacheKey);
  if (cached) return cached;

  return deduplicateInFlight(cacheKey, async () => {
    const cols = Math.pow(2, z + 1);
    const rows = Math.pow(2, z);
    const degPerPx = 180 / (256 * rows);

    // 1px overlap halo around the 256x256 tile eliminates tile-seam discontinuities
    const xmin = -180 + (x / cols) * 360 - degPerPx;
    const xmax = -180 + ((x + 1) / cols) * 360 + degPerPx;
    const ymax = 90 - (y / rows) * 180 + degPerPx;
    const ymin = 90 - ((y + 1) / rows) * 180 - degPerPx;

    const serviceUrl =
      body === 'moon'
        ? 'https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_128ppd_v04/ImageServer/exportImage'
        : 'https://trek.nasa.gov/mars/trekarcgis/rest/services/mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer/exportImage';
    const sr = body === 'moon' ? '104903' : '104905';
    const noDataVal = body === 'moon' ? -99999 : -32768;

    const params = new URLSearchParams({
      bbox: `${xmin},${ymin},${xmax},${ymax}`,
      bboxSR: sr,
      imageSR: sr,
      size: '258,258',
      format: 'tiff',
      interpolation: 'RSP_BilinearInterpolation',
      noData: String(noDataVal),
      f: 'image',
    });

    const res = await fetchWithRetry(`${serviceUrl}?${params.toString()}`, undefined, 3, 12000);
    const tiffBuf = Buffer.from(await res.arrayBuffer());

  const grid = decodeUncompressedElevationTiff(tiffBuf, noDataVal);
  if (grid.length !== 258 * 258) {
    throw new Error(`Unexpected DEM grid size: ${grid.length}`);
  }

  // Clamp ONLY outer planetary domain halo pixels (beyond ±180° lon or ±90° lat)
  // while leaving all interior NoData cells strictly as NaN.
  const w = 258;
  if (y === 0) {
    for (let ix = 0; ix < w; ix++) {
      if (!Number.isFinite(grid[ix]) && Number.isFinite(grid[w + ix])) {
        grid[ix] = grid[w + ix];
      }
    }
  }
  if (y === rows - 1) {
    for (let ix = 0; ix < w; ix++) {
      if (!Number.isFinite(grid[(w - 1) * w + ix]) && Number.isFinite(grid[(w - 2) * w + ix])) {
        grid[(w - 1) * w + ix] = grid[(w - 2) * w + ix];
      }
    }
  }
  if (x === 0) {
    for (let iy = 0; iy < w; iy++) {
      if (!Number.isFinite(grid[iy * w]) && Number.isFinite(grid[iy * w + 1])) {
        grid[iy * w] = grid[iy * w + 1];
      }
    }
  }
  if (x === cols - 1) {
    for (let iy = 0; iy < w; iy++) {
      if (!Number.isFinite(grid[iy * w + w - 1]) && Number.isFinite(grid[iy * w + w - 2])) {
        grid[iy * w + w - 1] = grid[iy * w + w - 2];
      }
    }
  }

  const outBuf = Buffer.from(grid.buffer, grid.byteOffset, grid.byteLength);
  setCachedDem(cacheKey, outBuf);
  return outBuf;
  });
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'planetary-gis-api' });
  });

  app.get('/api/elevation', async (req, res) => {
    try {
      const body = req.query.body === 'mars' ? 'mars' : req.query.body === 'moon' ? 'moon' : null;
      const lon = parseFiniteNumber(req.query.lon);
      const lat = parseFiniteNumber(req.query.lat);
      if (!body || lon === null || lat === null || !isValidLat(lat) || !isValidLonInput(lon)) {
        res.status(400).json({
          error: 'Valid body (moon|mars), lat [-90, 90], and lon [-180, 360] are required.',
        });
        return;
      }
      const data = await queryElevationPoint(body, lon, lat);
      res.json({ body, ...data });
    } catch (err) {
      console.error('/api/elevation error:', err);
      res.status(502).json({
        error: sanitizePublicError(err, 'Unable to reach NASA elevation service'),
      });
    }
  });

  app.post('/api/elevation-profile', async (req, res) => {
    try {
      const payload = req.body as {
        body?: unknown;
        points?: unknown;
      };
      const body = payload?.body === 'mars' ? 'mars' : payload?.body === 'moon' ? 'moon' : null;
      if (
        !body ||
        !Array.isArray(payload.points) ||
        payload.points.length < 2 ||
        payload.points.length > 24
      ) {
        res.status(400).json({
          error: 'Invalid elevation profile request: body (moon|mars) and 2-24 points are required.',
        });
        return;
      }

      const validatedPoints: Array<{ lon: number; lat: number; distanceKm: number }> = [];
      for (const rawPt of payload.points) {
        if (!rawPt || typeof rawPt !== 'object') {
          res.status(400).json({ error: 'Each profile point must be an object with lat, lon, and distanceKm.' });
          return;
        }
        const pt = rawPt as Record<string, unknown>;
        const lat = parseFiniteNumber(pt.lat);
        const lon = parseFiniteNumber(pt.lon);
        const distanceKm = parseFiniteNumber(pt.distanceKm);
        if (
          lat === null ||
          lon === null ||
          distanceKm === null ||
          !isValidLat(lat) ||
          !isValidLonInput(lon) ||
          distanceKm < 0
        ) {
          res.status(400).json({
            error: 'Invalid point coordinates in elevation profile (lat [-90, 90], lon [-180, 360], distanceKm >= 0).',
          });
          return;
        }
        validatedPoints.push({ lon, lat, distanceKm });
      }

      // Bounded concurrency (6 requests per batch) to avoid hammering upstream ImageServer
      const samples: Array<{
        distanceKm: number;
        lat: number;
        lon: number;
        elevationM: number | null;
      }> = [];
      let upstreamFailures = 0;

      for (let i = 0; i < validatedPoints.length; i += 6) {
        const batch = validatedPoints.slice(i, i + 6);
        const batchResults = await Promise.all(
          batch.map(async (pt) => {
            try {
              const val = await queryElevationPoint(body, pt.lon, pt.lat);
              return {
                distanceKm: pt.distanceKm,
                lat: val.lat,
                lon: val.lon,
                elevationM: val.elevationM,
              };
            } catch {
              upstreamFailures++;
              return {
                distanceKm: pt.distanceKm,
                lat: Math.max(-89.95, Math.min(89.95, pt.lat)),
                lon: normalizeLon180(pt.lon),
                elevationM: null,
              };
            }
          })
        );
        samples.push(...batchResults);
      }

      if (upstreamFailures === validatedPoints.length) {
        res.status(502).json({
          error: 'Unable to reach NASA elevation service for transect samples',
        });
        return;
      }

      res.json({ body, samples });
    } catch (err) {
      console.error('/api/elevation-profile error:', err);
      res.status(502).json({
        error: sanitizePublicError(err, 'Failed to sample elevation profile'),
      });
    }
  });

  app.get('/api/features', async (req, res) => {
    try {
      const body = req.query.body === 'mars' ? 'mars' : req.query.body === 'moon' ? 'moon' : null;
      const layerId = typeof req.query.layerId === 'string' ? req.query.layerId.trim() : '';
      if (!body || !layerId || !ALLOWED_VECTOR_LAYERS[body].has(layerId)) {
        res.status(400).json({
          error: 'Valid body (moon|mars) and cataloged vector layerId are required.',
        });
        return;
      }
      const fc = await buildVectorFeatures(body, layerId);
      res.json(fc);
    } catch (err) {
      if (err instanceof NonRetryableHttpError && err.status === 400) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('/api/features error:', err);
      res.status(502).json({
        error: sanitizePublicError(err, 'Failed to retrieve NASA planetary vector layer'),
      });
    }
  });

  app.get('/api/dem-tile', async (req, res) => {
    try {
      const body = req.query.body === 'mars' ? 'mars' : req.query.body === 'moon' ? 'moon' : null;
      const z = parseStrictInt(req.query.z);
      const x = parseStrictInt(req.query.x);
      const y = parseStrictInt(req.query.y);
      if (!body || z === null || x === null || y === null || z < 0 || z > 10) {
        res.status(400).json({ error: 'Valid body (moon|mars), integer z [0..10], x, and y are required.' });
        return;
      }
      const cols = Math.pow(2, z + 1);
      const rows = Math.pow(2, z);
      if (x < 0 || x >= cols || y < 0 || y >= rows) {
        res.status(400).json({ error: 'Tile coordinates out of bounds for zoom level.' });
        return;
      }
      const buf = await fetchCalibratedDemTile(body, z, x, y);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buf);
    } catch (err) {
      console.error('/api/dem-tile error:', err);
      res.status(502).json({
        error: sanitizePublicError(err, 'Failed to retrieve calibrated DEM grid'),
      });
    }
  });

  app.get('/api/earth-dem-tile', async (req, res) => {
    try {
      const z = parseStrictInt(req.query.z);
      const x = parseStrictInt(req.query.x);
      const y = parseStrictInt(req.query.y);
      if (z === null || x === null || y === null || z < 0 || z > 15) {
        res.status(400).json({ error: 'Valid integer z [0..15], x, and y are required.' });
        return;
      }

      const tileCount = 2 ** z;
      if (x < 0 || x >= tileCount || y < 0 || y >= tileCount) {
        res.status(400).json({ error: 'Tile coordinates out of bounds for zoom level.' });
        return;
      }

      const tile = await fetchEarthTerrainTile(z, x, y);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(tile);
    } catch (err) {
      console.error('/api/earth-dem-tile error:', err);
      res.status(502).json({
        error: sanitizePublicError(err, 'Failed to retrieve Earth elevation tile'),
      });
    }
  });

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Unknown API endpoint' });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON request body' });
      return;
    }
    if (err && typeof err === 'object' && 'status' in err && (err as { status?: number }).status === 413) {
      res.status(413).json({ error: 'Request payload exceeds size limit' });
      return;
    }
    console.error('Unhandled express middleware error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  if (isProduction) {
    const distDir = path.join(projectRoot, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, HOST, () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      console.error('Could not determine the planetary explorer server address.');
      process.exitCode = 1;
      server.close();
      return;
    }
    console.log(`Planetary Terrain Explorer listening on http://${HOST}:${address.port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
