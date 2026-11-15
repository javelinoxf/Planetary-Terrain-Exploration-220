import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sun, Eye, EyeOff, RotateCw } from 'lucide-react';
import { PLANET_METADATA } from '@/data/planetaryCatalog';
import { formatLat, formatLon, renderDerivedDemGrid } from '@/utils/planetaryMath';
import type {
  ActiveLayerState,
  BasemapSpec,
  PlanetaryBody,
  PlanetaryFeatureCollection,
  PlanetaryLayerSpec,
  RegionPreset,
} from '@/types/planetary';

interface PlanetaryGlobe3DProps {
  body: PlanetaryBody;
  basemap: BasemapSpec;
  layers: PlanetaryLayerSpec[];
  activeLayers: Record<string, ActiveLayerState>;
  vectorData: Record<string, PlanetaryFeatureCollection>;
  showGraticule: boolean;
  featuredRegions: RegionPreset[];
  probeCoord: { lat: number; lon: number } | null;
  flyToTarget: { lat: number; lon: number; zoom: number; nonce: number } | null;
  onSelectLocation: (lat: number, lon: number) => void;
  onSelectFeaturedRegion: (region: RegionPreset) => void;
}

const GLOBE_RADIUS = 10;
const _vec3 = new THREE.Vector3();
const _targetDir = new THREE.Vector3();
const _camPos = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function latLonToVector3(lat: number, lon: number, radius: number, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  out.set(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
  return out;
}

function vector3ToLatLon(v: THREE.Vector3): { lat: number; lon: number } {
  const n = v.clone().normalize();
  const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)));
  const lonRaw = THREE.MathUtils.radToDeg(Math.atan2(n.z, -n.x)) - 180;
  const lon = ((lonRaw + 180) % 360 + 360) % 360 - 180;
  return { lat, lon };
}

interface MosaicResult {
  canvas: HTMLCanvasElement;
  failedTiles: number;
}

function drawTileWithinBounds(
  context: CanvasRenderingContext2D,
  tile: CanvasImageSource,
  x: number,
  y: number,
  zoom: number,
  bounds: [[number, number], [number, number]] | undefined,
  tileSize: number
): void {
  if (!bounds) {
    context.drawImage(tile, x * tileSize, y * tileSize, tileSize, tileSize);
    return;
  }

  const cols = Math.pow(2, zoom + 1);
  const rows = Math.pow(2, zoom);
  const tileWest = -180 + (x / cols) * 360;
  const tileEast = -180 + ((x + 1) / cols) * 360;
  const tileNorth = 90 - (y / rows) * 180;
  const tileSouth = 90 - ((y + 1) / rows) * 180;
  const west = Math.max(tileWest, bounds[0][1]);
  const east = Math.min(tileEast, bounds[1][1]);
  const north = Math.min(tileNorth, bounds[1][0]);
  const south = Math.max(tileSouth, bounds[0][0]);
  if (east <= west || north <= south) return;

  const sourceX = ((west - tileWest) / (tileEast - tileWest)) * tileSize;
  const sourceY = ((tileNorth - north) / (tileNorth - tileSouth)) * tileSize;
  const sourceWidth = ((east - west) / (tileEast - tileWest)) * tileSize;
  const sourceHeight = ((north - south) / (tileNorth - tileSouth)) * tileSize;
  // Tile-level bounds alone admit whole low-zoom tiles that overlap a polar limit.
  context.drawImage(
    tile,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x * tileSize + sourceX,
    y * tileSize + sourceY,
    sourceWidth,
    sourceHeight
  );
}

async function fetchEquirectangularMosaic(
  tileUrlTemplate: string,
  zoom: number,
  body: PlanetaryBody,
  derivedMode?: 'slope' | 'aspect' | 'contour',
  bounds?: [[number, number], [number, number]],
  abortSignal?: AbortSignal
): Promise<MosaicResult> {
  const cols = Math.pow(2, zoom + 1);
  const rows = Math.pow(2, zoom);
  const tileSize = 256;
  const canvas = document.createElement('canvas');
  canvas.width = cols * tileSize;
  canvas.height = rows * tileSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, failedTiles: 0 };

  let failedTiles = 0;
  const coordsList: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < rows; y++) {
    const tileNorthLat = 90 - (y / rows) * 180;
    const tileSouthLat = 90 - ((y + 1) / rows) * 180;
    if (bounds && (tileNorthLat <= bounds[0][0] || tileSouthLat >= bounds[1][0])) {
      continue;
    }
    for (let x = 0; x < cols; x++) {
      const tileWestLon = -180 + (x / cols) * 360;
      const tileEastLon = -180 + ((x + 1) / cols) * 360;
      if (bounds && (tileEastLon <= bounds[0][1] || tileWestLon >= bounds[1][1])) {
        continue;
      }
      coordsList.push({ x, y });
    }
  }

  const MAX_CONCURRENT = derivedMode ? 6 : 12;
  let cursor = 0;

  const worker = async () => {
    while (cursor < coordsList.length) {
      if (abortSignal?.aborted) return;
      const { x, y } = coordsList[cursor++];

      if (derivedMode) {
        try {
          const res = await fetch(
            `/api/dem-tile?body=${encodeURIComponent(body)}&z=${zoom}&x=${x}&y=${y}`,
            { signal: abortSignal }
          );
          if (!res.ok) {
            failedTiles++;
            continue;
          }
          if (abortSignal?.aborted) return;
          const buf = await res.arrayBuffer();
          if (abortSignal?.aborted) return;
          const grid = new Float32Array(buf);
          if (grid.length === 258 * 258) {
            const tmp = document.createElement('canvas');
            renderDerivedDemGrid(grid, 258, 258, tmp, derivedMode, body, zoom, y);
            drawTileWithinBounds(ctx, tmp, x, y, zoom, bounds, tileSize);
          }
        } catch {
          if (!abortSignal?.aborted) failedTiles++;
        }
        continue;
      }

      const url = tileUrlTemplate
        .replace('{z}', String(zoom))
        .replace('{x}', String(x))
        .replace('{y}', String(y));

      await new Promise<void>((resolve) => {
        if (abortSignal?.aborted) {
          resolve();
          return;
        }
        const img = new Image();
        let settled = false;
        const finish = (failed = false) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          abortSignal?.removeEventListener('abort', handleAbort);
          if (failed && !abortSignal?.aborted) failedTiles++;
          resolve();
        };
        const handleAbort = () => finish();
        const timeoutId = window.setTimeout(() => finish(true), 12000);
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (!abortSignal?.aborted) {
            drawTileWithinBounds(ctx, img, x, y, zoom, bounds, tileSize);
          }
          finish();
        };
        img.onerror = () => finish(true);
        abortSignal?.addEventListener('abort', handleAbort, { once: true });
        img.src = url;
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT, coordsList.length) }, () => worker())
  );
  return { canvas, failedTiles };
}

export const PlanetaryGlobe3D: React.FC<PlanetaryGlobe3DProps> = ({
  body,
  basemap,
  layers,
  activeLayers,
  vectorData,
  showGraticule,
  featuredRegions,
  probeCoord,
  flyToTarget,
  onSelectLocation,
  onSelectFeaturedRegion,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const onSelectLocationRef = useRef(onSelectLocation);
  onSelectLocationRef.current = onSelectLocation;
  const onSelectFeaturedRegionRef = useRef(onSelectFeaturedRegion);
  onSelectFeaturedRegionRef.current = onSelectFeaturedRegion;
  const featuredRegionsRef = useRef(featuredRegions);
  featuredRegionsRef.current = featuredRegions;

  const [sunAzimuth, setSunAzimuth] = useState(45);
  const [autoSpin, setAutoSpin] = useState(false);
  const [dockVisible, setDockVisible] = useState(true);
  const [textureStatus, setTextureStatus] = useState('Streaming NASA globe tiles...');
  const mosaicCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const bumpCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    globeMesh: THREE.Mesh;
    globeMat: THREE.MeshStandardMaterial;
    sunLight: THREE.DirectionalLight;
    graticuleGroup: THREE.Group;
    vectorGroup: THREE.Group;
    featuredSiteGroup: THREE.Group;
    probeMarker: THREE.Group;
    compositeCanvas: HTMLCanvasElement;
    compositeTexture: THREE.CanvasTexture;
    bumpTexture: THREE.CanvasTexture;
    requestRender: () => void;
    flyTarget: THREE.Vector3 | null;
    autoSpin: boolean;
    isSoftwareGl: boolean;
  } | null>(null);

  // Initialize Three.js WebGL scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04060a);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.25;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      42,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      400
    );
    camera.position.set(0, 5, 29);
    if (flyToTarget) {
      camera.position.copy(latLonToVector3(flyToTarget.lat, flyToTarget.lon, camera.position.length()));
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 13.5;
    controls.maxDistance = 55;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.65;

    // Subtle procedural starfield
    const starPositions = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const r = 120 + ((i * 73) % 80);
      const theta = ((i * 137.508) % 360) * (Math.PI / 180);
      const phi = Math.acos(1 - 2 * ((i + 0.5) / 900));
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xcbd5e1, size: 0.45, sizeAttenuation: true });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // 3-point planetary illumination rig
    const sunLight = new THREE.DirectionalLight(0xfff5e8, 2.6);
    sunLight.position.set(35, 12, 35);
    scene.add(sunLight);

    const hemiFill = new THREE.HemisphereLight(0x94a3b8, 0x0f172a, 0.45);
    scene.add(hemiFill);

    // Composite Texture & Bump Texture
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = 2048;
    compositeCanvas.height = 1024;
    const initCtx = compositeCanvas.getContext('2d');
    if (initCtx) {
      initCtx.fillStyle = '#1e293b';
      initCtx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    }
    const compositeTexture = new THREE.CanvasTexture(compositeCanvas);
    compositeTexture.colorSpace = THREE.SRGBColorSpace;
    compositeTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 512;
    bumpCanvas.height = 256;
    const bumpTexture = new THREE.CanvasTexture(bumpCanvas);

    const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 48);
    const globeMat = new THREE.MeshStandardMaterial({
      map: compositeTexture,
      bumpMap: bumpTexture,
      bumpScale: 0.28,
      roughness: 0.9,
      metalness: 0.04,
    });
    const globeMesh = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globeMesh);

    // Spherical Graticule (30° intervals)
    const graticuleGroup = new THREE.Group();
    const gratMat = new THREE.LineBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.35,
    });
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lon = -180; lon <= 180; lon += 4) {
        pts.push(latLonToVector3(lat, lon, GLOBE_RADIUS + 0.02));
      }
      graticuleGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 4) {
        pts.push(latLonToVector3(lat, lon, GLOBE_RADIUS + 0.02));
      }
      graticuleGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
    }
    scene.add(graticuleGroup);

    const vectorGroup = new THREE.Group();
    scene.add(vectorGroup);

    const featuredSiteGroup = new THREE.Group();
    scene.add(featuredSiteGroup);

    // 3D Location Probe Beacon (multi-part group)
    const probeMarker = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.18, 0.28, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    const pinGeo = new THREE.ConeGeometry(0.11, 0.45, 12);
    const pinMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, emissive: 0x0891b2 });
    const pin = new THREE.Mesh(pinGeo, pinMat);
    pin.rotation.x = Math.PI;
    pin.position.z = 0.28;
    probeMarker.add(ring, pin);
    probeMarker.visible = false;
    scene.add(probeMarker);

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;
    let lastTime = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastTime) / 1000);
        lastTime = now;

        const st = sceneRef.current;
        let keepAnimating = false;

        if (st?.flyTarget) {
          const dist = camera.position.length();
          _targetDir.copy(st.flyTarget).normalize().multiplyScalar(dist);
          camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetDir.x, 5.5, dt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetDir.y, 5.5, dt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetDir.z, 5.5, dt);
          camera.position.normalize().multiplyScalar(dist);
          if (camera.position.distanceTo(_targetDir) < 0.08) {
            st.flyTarget = null;
          } else {
            keepAnimating = true;
          }
        }

        if (st?.autoSpin && !st.flyTarget) {
          const angle = dt * 0.12;
          _camPos.copy(camera.position);
          camera.position.x = _camPos.x * Math.cos(angle) - _camPos.z * Math.sin(angle);
          camera.position.z = _camPos.x * Math.sin(angle) + _camPos.z * Math.cos(angle);
          keepAnimating = true;
        }

        const controlsChanged = controls.update();
        if (controlsChanged) keepAnimating = true;

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty || keepAnimating) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    controls.addEventListener('start', () => {
      if (sceneRef.current) {
        sceneRef.current.flyTarget = null;
      }
    });
    controls.addEventListener('change', requestRender);

    // Raycast click-to-inspect (ignore drags)
    const raycaster = new THREE.Raycaster();
    const pointerDownPos = { x: 0, y: 0 };
    const pointerNdc = new THREE.Vector2();
    let pointerDownId: number | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return;
      pointerDownPos.x = e.clientX;
      pointerDownPos.y = e.clientY;
      pointerDownId = e.pointerId;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerDownId) return;
      pointerDownId = null;
      const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (moved > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      camera.updateMatrixWorld(true);
      globeMesh.updateMatrixWorld(true);
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects([globeMesh, featuredSiteGroup], true);
      if (hits.length > 0) {
        let target: THREE.Object3D | null = hits[0].object;
        while (target && !target.userData.region) target = target.parent;
        if (target?.userData.region) {
          onSelectFeaturedRegionRef.current(target.userData.region as RegionPreset);
          return;
        }
        const { lat, lon } = vector3ToLatLon(hits[0].point);
        const hitDirection = hits[0].point.clone().normalize();
        const nearestRegion = featuredRegionsRef.current
          .map((region) => ({
            region,
            angle: hitDirection.angleTo(latLonToVector3(region.lat, region.lon, 1)),
          }))
          .sort((a, b) => a.angle - b.angle)[0];
        if (nearestRegion && nearestRegion.angle <= THREE.MathUtils.degToRad(1.5)) {
          onSelectFeaturedRegionRef.current(nearestRegion.region);
          return;
        }
        onSelectLocationRef.current(lat, lon);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObserver.observe(container);

    sceneRef.current = {
      renderer,
      scene,
      camera,
      controls,
      globeMesh,
      globeMat,
      sunLight,
      graticuleGroup,
      vectorGroup,
      featuredSiteGroup,
      probeMarker,
      compositeCanvas,
      compositeTexture,
      bumpTexture,
      requestRender,
      flyTarget: null,
      autoSpin: false,
      isSoftwareGl,
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      globeGeo.dispose();
      globeMat.dispose();
      compositeTexture.dispose();
      bumpTexture.dispose();
      starGeo.dispose();
      starMat.dispose();
      gratMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      pinGeo.dispose();
      pinMat.dispose();
      envTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = sceneRef.current?.featuredSiteGroup;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if ('geometry' in child && child.geometry) (child.geometry as THREE.BufferGeometry).dispose();
      if ('material' in child && child.material) (child.material as THREE.Material).dispose();
    }

    for (const region of featuredRegions) {
      const marker = new THREE.Group();
      marker.userData.region = region;
      marker.position.copy(latLonToVector3(region.lat, region.lon, GLOBE_RADIUS + 0.1));

      const color = region.body === 'mars' ? 0xf59e0b : 0x22d3ee;
      const markerMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 12, 8),
        new THREE.MeshBasicMaterial({ color })
      );
      markerMesh.userData.region = region;
      marker.add(markerMesh);

      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = 512;
      labelCanvas.height = 64;
      const context = labelCanvas.getContext('2d');
      if (context) {
        context.fillStyle = '#071018';
        context.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
        context.strokeStyle = region.body === 'mars' ? '#f59e0b' : '#22d3ee';
        context.strokeRect(1, 1, labelCanvas.width - 2, labelCanvas.height - 2);
        context.fillStyle = '#f8fafc';
        context.font = '24px sans-serif';
        context.fillText(region.name, 14, 41, labelCanvas.width - 28);
      }
      const labelTexture = new THREE.CanvasTexture(labelCanvas);
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: true })
      );
      label.scale.set(3.1, 0.39, 1);
      label.position.set(1.75, 0.25, 0);
      label.userData.region = region;
      marker.add(label);
      group.add(marker);
    }

    sceneRef.current?.requestRender();
  }, [featuredRegions]);

  // Load real NASA DEM BumpMap when planet changes (cached per body)
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;

    const cachedBump = bumpCacheRef.current.get(body);
    if (cachedBump) {
      const tex = new THREE.CanvasTexture(cachedBump);
      st.globeMat.bumpMap?.dispose();
      st.globeMat.bumpMap = tex;
      st.globeMat.needsUpdate = true;
      st.requestRender();
      return;
    }

    const ac = new AbortController();
    const demUrl =
      body === 'moon'
        ? 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_DEM_Global_128ppd_v04/1.0.0/default/default028mm/{z}/{y}/{x}.png'
        : 'https://trek.nasa.gov/tiles/Mars/EQ/mola128_mola64_merge_90Nto90S_SimpleC_clon0/1.0.0/default/default028mm/{z}/{y}/{x}.png';

    fetchEquirectangularMosaic(demUrl, 1, body, undefined, undefined, ac.signal).then(({ canvas, failedTiles }) => {
      if (ac.signal.aborted || !sceneRef.current) return;
      if (failedTiles === 0) bumpCacheRef.current.set(body, canvas);
      const tex = new THREE.CanvasTexture(canvas);
      sceneRef.current.globeMat.bumpMap?.dispose();
      sceneRef.current.globeMat.bumpMap = tex;
      sceneRef.current.globeMat.needsUpdate = true;
      sceneRef.current.requestRender();
    });

    return () => ac.abort();
  }, [body]);

  // Composite Basemap + Active Raster Overlays onto Globe Texture
  // Layer canvases are cached by (body, id, tileZ, derivedMode) so opacity slider updates NEVER trigger network fetches.
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    const ac = new AbortController();

    const activeRasterSpecs = layers.filter(
      (l) =>
        l.body === body &&
        activeLayers[l.id]?.visible &&
        (l.sourceType === 'wmts' || l.sourceType === 'arcgis_tile' || l.sourceType === 'derived_dem')
    );

    const cacheKeyFor = (
      id: string,
      tileZ: number,
      mode?: string
    ) => `${body}:${id}:z${tileZ}:${mode || 'tile'}`;

    const setCachedMosaic = (key: string, canvas: HTMLCanvasElement) => {
      const cache = mosaicCacheRef.current;
      if (cache.size >= 28) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, canvas);
    };

    const getOrFetchMosaic = async (
      key: string,
      url: string,
      tileZ: number,
      derivedMode?: 'slope' | 'aspect' | 'contour',
      bounds?: [[number, number], [number, number]]
    ): Promise<MosaicResult> => {
      const cached = mosaicCacheRef.current.get(key);
      if (cached) {
        return { canvas: cached, failedTiles: 0 };
      }
      const res = await fetchEquirectangularMosaic(url, tileZ, body, derivedMode, bounds, ac.signal);
      if (!ac.signal.aborted && res.failedTiles === 0) {
        setCachedMosaic(key, res.canvas);
      }
      return res;
    };

    const compositeAtZoom = async (z: number): Promise<number> => {
      const baseZ = Math.min(z, basemap.maxNativeZoom);
      const baseKey = cacheKeyFor(`bm:${basemap.id}`, baseZ);
      const baseRes = await getOrFetchMosaic(baseKey, basemap.tileUrl, baseZ, undefined, basemap.bounds);
      if (ac.signal.aborted) return 0;

      let totalFailed = baseRes.failedTiles;

      const overlayResults = await Promise.all(
        activeRasterSpecs.map(async (spec) => {
          const tileZ = Math.min(z, spec.maxNativeZoom ?? z);
          const url = spec.sourceType === 'derived_dem' ? spec.demSourceUrl : spec.tileUrl;
          if (!url && spec.sourceType !== 'derived_dem') return null;
          const ovKey = cacheKeyFor(spec.id, tileZ, spec.derivedMode);
          const ovRes = await getOrFetchMosaic(ovKey, url || '', tileZ, spec.derivedMode, spec.bounds);
          totalFailed += ovRes.failedTiles;
          return {
            canvas: ovRes.canvas,
            opacity: activeLayers[spec.id]?.opacity ?? spec.defaultOpacity,
          };
        })
      );

      if (ac.signal.aborted || !sceneRef.current) return totalFailed;

      const outCanvas = sceneRef.current.compositeCanvas;
      const targetWidth = Math.max(2048, baseRes.canvas.width);
      const targetHeight = Math.max(1024, baseRes.canvas.height);
      if (outCanvas.width !== targetWidth || outCanvas.height !== targetHeight) {
        outCanvas.width = targetWidth;
        outCanvas.height = targetHeight;
      }
      const ctx = outCanvas.getContext('2d');
      if (!ctx) return totalFailed;

      ctx.clearRect(0, 0, outCanvas.width, outCanvas.height);
      ctx.globalAlpha = 1;
      ctx.drawImage(baseRes.canvas, 0, 0, outCanvas.width, outCanvas.height);

      for (const ov of overlayResults) {
        if (!ov) continue;
        ctx.globalAlpha = ov.opacity;
        ctx.drawImage(ov.canvas, 0, 0, outCanvas.width, outCanvas.height);
      }
      ctx.globalAlpha = 1;

      sceneRef.current.compositeTexture.needsUpdate = true;
      sceneRef.current.requestRender();
      return totalFailed;
    };

    // Fast path: if all z2 mosaics are already cached, re-composite immediately (e.g. opacity slider changes)
    const baseZ2 = Math.min(2, basemap.maxNativeZoom);
    const allZ2Cached =
      mosaicCacheRef.current.has(cacheKeyFor(`bm:${basemap.id}`, baseZ2)) &&
      activeRasterSpecs.every((spec) => {
        const tileZ = Math.min(2, spec.maxNativeZoom ?? 2);
        return mosaicCacheRef.current.has(cacheKeyFor(spec.id, tileZ, spec.derivedMode));
      });

    if (allZ2Cached) {
      void compositeAtZoom(2).then((failed) => {
        if (!ac.signal.aborted) {
          setTextureStatus(
            failed > 0
              ? `${basemap.shortName} · ${failed} tiles failed`
              : `${basemap.shortName} · 2048×1024px`
          );
        }
      });
    } else {
      setTextureStatus(`Loading ${basemap.shortName} preview...`);
      compositeAtZoom(1).then(() => {
        if (ac.signal.aborted) return;
        setTextureStatus('Streaming z2 high-res texture...');
        return compositeAtZoom(2).then((failed) => {
          if (!ac.signal.aborted) {
            setTextureStatus(
              failed > 0
                ? `${basemap.shortName} · ${failed} tiles failed`
                : `${basemap.shortName} · 2048×1024px`
            );
          }
        });
      });
    }

    return () => ac.abort();
  }, [body, basemap, layers, activeLayers]);

  // Render Active Vector Points & Traverses onto 3D Sphere Surface
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;

    while (st.vectorGroup.children.length > 0) {
      const child = st.vectorGroup.children[0] as THREE.Object3D;
      st.vectorGroup.remove(child);
      if ('geometry' in child && child.geometry) (child.geometry as THREE.BufferGeometry).dispose();
      if ('material' in child && child.material) (child.material as THREE.Material).dispose();
    }

    const activeVecSpecs = layers.filter(
      (l) =>
        l.body === body &&
        l.sourceType === 'vector_geojson' &&
        activeLayers[l.id]?.visible &&
        vectorData[l.id]
    );

    for (const spec of activeVecSpecs) {
      const fc = vectorData[spec.id];
      const opacity = activeLayers[spec.id]?.opacity ?? 1;
      const color = new THREE.Color(spec.vectorColor || '#22d3ee');
      const ptPositions: number[] = [];

      for (const feat of fc.features) {
        const g = feat.geometry;
        if (g.type === 'Point') {
          const [lon, lat] = g.coordinates as [number, number];
          latLonToVector3(lat, lon, GLOBE_RADIUS + 0.08, _vec3);
          ptPositions.push(_vec3.x, _vec3.y, _vec3.z);
        } else if (g.type === 'MultiPoint') {
          for (const [lon, lat] of g.coordinates as number[][]) {
            latLonToVector3(lat, lon, GLOBE_RADIUS + 0.08, _vec3);
            ptPositions.push(_vec3.x, _vec3.y, _vec3.z);
          }
        } else if (g.type === 'LineString' || g.type === 'MultiLineString') {
          const lines =
            g.type === 'LineString'
              ? [g.coordinates as number[][]]
              : (g.coordinates as number[][][]);
          for (const line of lines.slice(0, 60)) {
            const pts = line.map(([lon, lat]) => latLonToVector3(lat, lon, GLOBE_RADIUS + 0.06));
            if (pts.length > 1) {
              const lGeo = new THREE.BufferGeometry().setFromPoints(pts);
              const lMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
              st.vectorGroup.add(new THREE.Line(lGeo, lMat));
            }
          }
        } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
          const polygons =
            g.type === 'Polygon'
              ? [g.coordinates as number[][][]]
              : (g.coordinates as number[][][][]);
          for (const poly of polygons) {
            const ring = poly[0] || [];
            if (ring.length > 2) {
              const pts = ring.map(([lon, lat]) => latLonToVector3(lat, lon, GLOBE_RADIUS + 0.06));
              const pGeo = new THREE.BufferGeometry().setFromPoints(pts);
              const pMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
              st.vectorGroup.add(new THREE.Line(pGeo, pMat));
            }
          }
        }
      }

      if (ptPositions.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(ptPositions, 3));
        const mat = new THREE.PointsMaterial({
          color,
          size: spec.id.includes('landing') ? 0.36 : 0.22,
          transparent: true,
          opacity,
        });
        st.vectorGroup.add(new THREE.Points(geo, mat));
      }
    }

    st.requestRender();
  }, [body, layers, activeLayers, vectorData]);

  // Graticule visibility
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.graticuleGroup.visible = showGraticule;
    st.requestRender();
  }, [showGraticule]);

  // Probe Marker on 3D Globe
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    if (!probeCoord) {
      st.probeMarker.visible = false;
    } else {
      const pos = latLonToVector3(probeCoord.lat, probeCoord.lon, GLOBE_RADIUS + 0.06);
      st.probeMarker.position.copy(pos);
      st.probeMarker.lookAt(pos.clone().multiplyScalar(2));
      st.probeMarker.visible = true;
    }
    st.requestRender();
  }, [probeCoord]);

  // Solar Illumination Azimuth
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    const rad = THREE.MathUtils.degToRad(sunAzimuth);
    st.sunLight.position.set(Math.cos(rad) * 45, 14, Math.sin(rad) * 45);
    st.requestRender();
  }, [sunAzimuth]);

  // Auto Spin
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.autoSpin = autoSpin && !st.isSoftwareGl;
    if (st.autoSpin) st.requestRender();
  }, [autoSpin]);

  // Keep the selected region in view when changing planets or selecting a site.
  useEffect(() => {
    const st = sceneRef.current;
    if (!st || !flyToTarget) return;
    const distance = st.camera.position.length();
    st.camera.position.copy(
      latLonToVector3(flyToTarget.lat, flyToTarget.lon, distance)
    );
    st.controls.target.set(0, 0, 0);
    st.controls.update();
    st.flyTarget = null;
    st.requestRender();
  }, [flyToTarget]);

  return (
    <div className="relative w-full h-full bg-[#04060A] overflow-hidden">
      <div ref={mountRef} className="w-full h-full cursor-crosshair" />

      {/* Top-Left Status Readout (solid background, zero backdrop-blur) */}
      <div className="absolute top-3 left-3 pointer-events-none bg-[#0A0E17] border border-slate-800 rounded px-3 py-1.5 text-[11px] text-slate-300 flex items-center gap-2">
        <span className="font-semibold text-slate-100">{PLANET_METADATA[body].name} 3D Globe</span>
        <span className="text-slate-600" aria-hidden="true">·</span>
        <span className="font-mono text-slate-400">{textureStatus}</span>
      </div>

      {/* Bottom-Left Probe Coordinate */}
      {probeCoord && (
        <div className="absolute bottom-3 left-3 pointer-events-none bg-[#0A0E17] border border-slate-800 rounded px-3 py-1.5 text-[11px] font-mono text-slate-200">
          Probe: {formatLat(probeCoord.lat)} · {formatLon(probeCoord.lon)}
        </div>
      )}

      {/* Collapsible Bottom Dock for 3D Illumination & Spin */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center z-20">
        <button
          type="button"
          onClick={() => setDockVisible((v) => !v)}
          className="px-3 py-1 text-[11px] font-medium bg-[#0A0E17] border border-slate-800 border-b-0 rounded-t text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
        >
          {dockVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          <span>{dockVisible ? 'Hide 3D Controls' : 'Show 3D Controls'}</span>
        </button>

        {dockVisible && (
          <div className="bg-[#0A0E17] border border-slate-800 rounded px-4 py-2 flex items-center gap-4 text-xs">
            <label className="flex items-center gap-2 text-slate-300 whitespace-nowrap">
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>Solar Angle</span>
              <input
                type="range"
                min={0}
                max={360}
                value={sunAzimuth}
                onChange={(e) => setSunAzimuth(Number(e.target.value))}
                className="gis-slider w-28"
              />
              <span className="font-mono text-[11px] text-slate-400 w-9">{sunAzimuth}°</span>
            </label>

            <div className="h-4 w-px bg-slate-800" />

            <button
              type="button"
              onClick={() => setAutoSpin((s) => !s)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs transition-colors cursor-pointer ${
                autoSpin
                  ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                  : 'bg-[#0F141F] border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>{autoSpin ? 'Pause Spin' : 'Auto Rotate'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
