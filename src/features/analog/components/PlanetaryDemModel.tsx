import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AnalogSiteTemplate } from '@/features/analog/data/analogSites';
import type { RegionPreset } from '@/types/planetary';

interface PlanetaryDemModelProps {
  region: RegionPreset;
  earthAnalog: AnalogSiteTemplate['earthAnalog'];
}

interface LoadedDem {
  grid: Float32Array;
  zoom: number;
  tileX: number;
  tileY: number;
}

type DemSource =
  | {
      kind: 'planetary';
      id: string;
      name: string;
      body: RegionPreset['body'];
      lat: number;
      lon: number;
    }
  | {
      kind: 'earth';
      id: string;
      name: string;
      description: string;
      lat: number;
      lon: number;
    };

function getTileCoordinates(region: { lat: number; lon: number }, zoom: number) {
  const columns = 2 ** (zoom + 1);
  const rows = 2 ** zoom;
  const tileX = Math.min(columns - 1, Math.max(0, Math.floor(((region.lon + 180) / 360) * columns)));
  const tileY = Math.min(rows - 1, Math.max(0, Math.floor(((90 - region.lat) / 180) * rows)));
  return { tileX, tileY };
}

function getEarthTileCoordinates(location: DemSource & { kind: 'earth' }, zoom: number) {
  const tileCount = 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, location.lat));
  const latitudeRadians = (latitude * Math.PI) / 180;
  const tileX = Math.min(
    tileCount - 1,
    Math.max(0, Math.floor(((location.lon + 180) / 360) * tileCount))
  );
  const tileY = Math.min(
    tileCount - 1,
    Math.max(
      0,
      Math.floor(
        ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * tileCount
      )
    )
  );
  return { tileX, tileY };
}

async function decodeTerrariumTile(response: Response): Promise<Float32Array> {
  const bitmap = await createImageBitmap(await response.blob());
  try {
    if (bitmap.width !== 256 || bitmap.height !== 256) {
      throw new Error('Earth DEM service returned a tile with unexpected dimensions.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Unable to decode the Earth DEM tile in this browser.');

    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const grid = new Float32Array(258 * 258);
    grid.fill(Number.NaN);

    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const pixel = (y * 256 + x) * 4;
        if (pixels[pixel + 3] === 0) continue;
        grid[(y + 1) * 258 + x + 1] =
          pixels[pixel] * 256 + pixels[pixel + 1] + pixels[pixel + 2] / 256 - 32768;
      }
    }

    for (let x = 1; x <= 256; x++) {
      grid[x] = grid[258 + x];
      grid[257 * 258 + x] = grid[256 * 258 + x];
    }
    for (let y = 1; y <= 256; y++) {
      grid[y * 258] = grid[y * 258 + 1];
      grid[y * 258 + 257] = grid[y * 258 + 256];
    }
    grid[0] = grid[259];
    grid[257] = grid[256];
    grid[257 * 258] = grid[256 * 258 + 1];
    grid[258 * 258 - 1] = grid[257 * 258 - 2];
    return grid;
  } finally {
    bitmap.close();
  }
}

function TerrainSurface({ grid, verticalScale }: { grid: Float32Array; verticalScale: number }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070b10');
    const camera = new THREE.PerspectiveCamera(
      42,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      1000
    );
    camera.up.set(0, 0, 1);
    camera.position.set(145, -175, 150);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 35;
    controls.maxDistance = 500;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xb7c5d1, 1.25));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(-100, -120, 180);
    scene.add(light);
    const fill = new THREE.DirectionalLight(0x84b9c9, 0.75);
    fill.position.set(100, 80, 120);
    scene.add(fill);

    const geometry = new THREE.PlaneGeometry(240, 240, 255, 255);
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(positions.count * 3);
    const valid = new Uint8Array(positions.count);
    const elevations = new Float32Array(positions.count);
    let minElevation = Number.POSITIVE_INFINITY;
    let maxElevation = Number.NEGATIVE_INFINITY;
    let sumElevation = 0;
    let validCount = 0;

    for (let vertex = 0; vertex < positions.count; vertex++) {
      const column = vertex % 256;
      const rowFromBottom = Math.floor(vertex / 256);
      const sourceRow = 256 - rowFromBottom;
      const elevation = grid[sourceRow * 258 + column + 1];
      if (!Number.isFinite(elevation) || Math.abs(elevation) >= 50000) continue;
      valid[vertex] = 1;
      elevations[vertex] = elevation;
      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
      sumElevation += elevation;
      validCount++;
    }

    if (validCount === 0) {
      geometry.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      throw new Error('The DEM tile has no valid elevation samples.');
    }

    const meanElevation = sumElevation / validCount;
    const elevationRange = Math.max(1, maxElevation - minElevation);
    for (let vertex = 0; vertex < positions.count; vertex++) {
      if (!valid[vertex]) {
        positions.setZ(vertex, 0);
        colors.set([0, 0, 0], vertex * 3);
        continue;
      }
      const normalized = (elevations[vertex] - minElevation) / elevationRange;
      positions.setZ(vertex, (elevations[vertex] - meanElevation) * verticalScale);
      const color = new THREE.Color().setHSL(0.66 - normalized * 0.62, 0.75, 0.32 + normalized * 0.28);
      colors.set([color.r, color.g, color.b], vertex * 3);
    }

    const existingIndex = geometry.getIndex();
    if (existingIndex) {
      const validIndices: number[] = [];
      for (let offset = 0; offset < existingIndex.count; offset += 3) {
        const a = existingIndex.getX(offset);
        const b = existingIndex.getX(offset + 1);
        const c = existingIndex.getX(offset + 2);
        if (valid[a] && valid[b] && valid[c]) validIndices.push(a, b, c);
      }
      geometry.setIndex(validIndices);
    }
    positions.needsUpdate = true;
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const terrain = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })
    );
    scene.add(terrain);

    let frameId = 0;
    let disposed = false;
    const render = () => {
      if (disposed) return;
      frameId = window.requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    const resizeObserver = new ResizeObserver(() => {
      if (disposed) return;
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      geometry.dispose();
      (terrain.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [grid, verticalScale]);

  return <div ref={mountRef} className="absolute inset-0" />;
}

export function PlanetaryDemModel({ region, earthAnalog }: PlanetaryDemModelProps) {
  return <SiteTerrainModels region={region} earthAnalog={earthAnalog} />;
}

export function GeneralTerrainModel({
  body,
  lat,
  lon,
  zoom,
  verticalScale,
  locationName,
  autoGenerate = false,
}: {
  body: RegionPreset['body'];
  lat: number;
  lon: number;
  zoom: number;
  verticalScale: number;
  locationName: string;
  autoGenerate?: boolean;
}) {
  const source = useMemo<DemSource>(
    () => ({ kind: 'planetary', id: `general-${body}`, name: locationName, body, lat, lon }),
    [body, lat, lon, locationName]
  );
  return (
    <TerrainModelPanel
      source={source}
      zoom={zoom}
      verticalScale={verticalScale}
      height={520}
      autoGenerate={autoGenerate}
    />
  );
}

interface SiteTerrainModelsProps extends PlanetaryDemModelProps {
  earthAnalog: AnalogSiteTemplate['earthAnalog'];
}

function TerrainModelPanel({
  source,
  zoom,
  verticalScale,
  height = 360,
  width = 100,
  autoGenerate = false,
}: {
  source: DemSource;
  zoom: number;
  verticalScale: number;
  height?: number;
  width?: number;
  autoGenerate?: boolean;
}) {
  const [dem, setDem] = useState<LoadedDem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestNumber, setRequestNumber] = useState(autoGenerate ? 1 : 0);

  useEffect(() => {
    if (requestNumber === 0) return;
    const controller = new AbortController();
    const { tileX, tileY } =
      source.kind === 'earth'
        ? getEarthTileCoordinates(source, zoom)
        : getTileCoordinates(source, zoom);
    setLoading(true);
    setError(null);

    const url =
      source.kind === 'earth'
        ? `/api/earth-dem-tile?z=${zoom}&x=${tileX}&y=${tileY}`
        : `/api/dem-tile?body=${encodeURIComponent(source.body)}&z=${zoom}&x=${tileX}&y=${tileY}`;

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `DEM service returned HTTP ${response.status}`);
        }
        if (source.kind === 'earth') return decodeTerrariumTile(response);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== 258 * 258 * Float32Array.BYTES_PER_ELEMENT) {
          throw new Error('DEM service returned an unexpected elevation grid size.');
        }
        return new Float32Array(buffer);
      })
      .then((grid) => {
        if (!controller.signal.aborted) setDem({ grid, zoom, tileX, tileY });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Failed to generate terrain model.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [requestNumber, source, zoom]);

  const tileWidthDegrees = 360 / 2 ** (zoom + 1);
  const tileHeightDegrees = 180 / 2 ** zoom;
  const isEarth = source.kind === 'earth';

  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border border-slate-800 bg-[#0A0E17] p-3"
      style={{ width: `${width}%`, justifySelf: 'center' }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">{source.name}</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {isEarth
              ? `${source.description}. Descarga un mosaico de elevación terrestre y lo convierte localmente en una superficie 3D.`
              : `Descarga un mosaico DEM NASA para ${source.name} y lo convierte localmente en una superficie 3D interactiva.`}
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRequestNumber((previous) => previous + 1)}
          className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? 'Generando…' : dem ? 'Actualizar modelo' : 'Generar modelo'}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded border border-rose-500/30 bg-rose-950/40 p-3 text-xs text-rose-200">
          No se pudo generar el modelo: {error}
        </div>
      )}

      {dem ? (
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#0A0E17]">
          <div className="relative" style={{ height }}>
            <TerrainSurface grid={dem.grid} verticalScale={verticalScale} />
            <div className="pointer-events-none absolute left-3 top-3 rounded border border-slate-700 bg-[#071018]/90 px-2 py-1.5 text-[10px] font-mono text-slate-300">
              {source.name} · {isEarth ? 'Earth Terrarium DEM' : `NASA ${source.body.toUpperCase()} DEM`} · Z{dem.zoom} · tile {dem.tileX},{dem.tileY}
            </div>
          </div>
          <p className="border-t border-slate-800 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
            {isEarth
              ? '256 × 256 Terrarium elevation tile in Web Mercator; horizontal coverage varies with latitude.'
              : `Tile coverage ≈ ${tileWidthDegrees.toFixed(3)}° longitude × ${tileHeightDegrees.toFixed(3)}° latitude.`}{' '}
            Display scale is normalized; vertical relief is exaggerated by the slider and is not a scale model.
          </p>
        </div>
      ) : (
        <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-700 bg-[#070B12] px-5 text-center">
          <p className="max-w-xl text-xs leading-relaxed text-slate-400">
            Genera el modelo para solicitar el mosaico DEM de {source.name}.
          </p>
        </div>
      )}
    </section>
  );
}

function SiteTerrainModels({ region, earthAnalog }: SiteTerrainModelsProps) {
  const [zoom, setZoom] = useState(8);
  const [verticalScale, setVerticalScale] = useState(0.012);
  const [planetaryMapHeight, setPlanetaryMapHeight] = useState(360);
  const [earthMapHeight, setEarthMapHeight] = useState(360);
  const [planetaryMapWidth, setPlanetaryMapWidth] = useState(100);
  const [earthMapWidth, setEarthMapWidth] = useState(100);
  const planetarySource = useMemo<DemSource>(
    () => ({
      kind: 'planetary',
      id: region.id,
      name: region.name,
      body: region.body,
      lat: region.lat,
      lon: region.lon,
    }),
    [region]
  );
  const earthSource = useMemo<DemSource>(
    () => ({
      kind: 'earth',
      ...earthAnalog,
    }),
    [earthAnalog]
  );

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Comparación de modelos topográficos</h3>
          <p className="mt-1 text-xs text-slate-400">
            Genera los dos modelos independientemente. La escala vertical se comparte para facilitar la inspección.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-slate-400">
            Nivel de resolución
            <select
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="mt-1 block rounded border border-slate-700 bg-[#0F141F] px-2 py-1.5 text-xs text-slate-200"
            >
              {[6, 7, 8, 9, 10].map((level) => (
                <option key={level} value={level}>Z{level}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-slate-400">
            Escala vertical
            <input
              type="range"
              min={0.004}
              max={0.04}
              step={0.002}
              value={verticalScale}
              onChange={(event) => setVerticalScale(Number(event.target.value))}
              className="gis-slider mt-2 block w-28"
            />
          </label>
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          {
            label: `Mapa planetario · ${region.name}`,
            width: planetaryMapWidth,
            setWidth: setPlanetaryMapWidth,
            height: planetaryMapHeight,
            setHeight: setPlanetaryMapHeight,
            widthLabel: 'Ancho mapa planetario',
            heightLabel: 'Altura mapa planetario',
          },
          {
            label: `Mapa Tierra · ${earthAnalog.name}`,
            width: earthMapWidth,
            setWidth: setEarthMapWidth,
            height: earthMapHeight,
            setHeight: setEarthMapHeight,
            widthLabel: 'Ancho mapa Tierra',
            heightLabel: 'Altura mapa Tierra',
          },
        ]).map((mapSize) => (
          <section key={mapSize.label} className="grid gap-3 rounded border border-slate-800 bg-[#0A0E17] p-3 sm:grid-cols-2">
            <label className="text-[11px] text-slate-400">
              {mapSize.widthLabel} · {mapSize.width}%
              <input
                type="range"
                min={60}
                max={100}
                step={10}
                value={mapSize.width}
                onChange={(event) => mapSize.setWidth(Number(event.target.value))}
                className="gis-slider mt-2 block w-full"
                aria-label={mapSize.widthLabel}
              />
            </label>
            <label className="text-[11px] text-slate-400">
              {mapSize.heightLabel} · {mapSize.height} px
              <input
                type="range"
                min={240}
                max={640}
                step={40}
                value={mapSize.height}
                onChange={(event) => mapSize.setHeight(Number(event.target.value))}
                className="gis-slider mt-2 block w-full"
                aria-label={mapSize.heightLabel}
              />
            </label>
          </section>
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <TerrainModelPanel key={planetarySource.id} source={planetarySource} zoom={zoom} verticalScale={verticalScale} height={planetaryMapHeight} width={planetaryMapWidth} />
        <TerrainModelPanel key={earthSource.id} source={earthSource} zoom={zoom} verticalScale={verticalScale} height={earthMapHeight} width={earthMapWidth} />
      </div>
      <p className="text-[10px] leading-relaxed text-slate-500">
        Los modelos terrestres usan tiles Terrarium de Terrain Tiles; los de Marte y la Luna usan sus fuentes DEM NASA.
        Los niveles de zoom solo eligen la escala del mosaico y no garantizan la resolución nativa del dato.
      </p>
    </section>
  );
}
