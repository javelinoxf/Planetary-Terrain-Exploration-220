import type { DerivedDemMode, PlanetaryBody } from '../types/planetary';

export const PLANET_DEM_CONFIG: Record<
  PlanetaryBody,
  {
    radiusMeters: number;
    minorContourM: number;
    majorContourM: number;
    flatSlopeThresholdDeg: number;
    sourceService: string;
  }
> = {
  moon: {
    radiusMeters: 1_737_400, // IAU2000:30100 / LRO_LOLA_DEM SPHEROID["MOON_2000", 1737400.0, 0.0]
    minorContourM: 500,
    majorContourM: 1000,
    flatSlopeThresholdDeg: 0.25,
    sourceService: 'LRO_LOLA_DEM_Global_128ppd_v04 (Float32 meters)',
  },
  mars: {
    radiusMeters: 3_389_500, // IAU 2000 mean volumetric radius (m)
    minorContourM: 500,
    majorContourM: 1500,
    flatSlopeThresholdDeg: 0.25,
    sourceService: 'mola128_mola64_merge_90Nto90S_SimpleC_clon0 (Int16 meters)',
  },
};

export function formatLat(lat: number): string {
  const dir = lat >= 0 ? 'N' : 'S';
  return `${Math.abs(lat).toFixed(4)}° ${dir}`;
}

export function formatLon(lon: number): string {
  let norm = ((lon + 180) % 360 + 360) % 360 - 180;
  if (norm === -180 && lon > 0) norm = 180;
  const dir = norm >= 0 ? 'E' : 'W';
  const east360 = ((norm % 360) + 360) % 360;
  return `${Math.abs(norm).toFixed(4)}° ${dir} (${east360.toFixed(2)}°E)`;
}

export function normalizeLon180(lon: number): number {
  let wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180 && lon > 0) wrapped = 180;
  return wrapped;
}

export function planetaryDistanceKm(
  body: PlanetaryBody,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const radiusKm = body === 'moon' ? 1737.4 : 3389.5;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radiusKm * c;
}

export function sampleTransectPoints(
  body: PlanetaryBody,
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  steps = 20
): Array<{ lat: number; lon: number; distanceKm: number }> {
  const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));
  const lat1Deg = clampLat(start.lat);
  const lat2Deg = clampLat(end.lat);
  const lon1Deg = normalizeLon180(start.lon);
  const lon2Deg = normalizeLon180(end.lon);

  const count = Math.max(2, Math.floor(steps));
  const totalDist = planetaryDistanceKm(body, lat1Deg, lon1Deg, lat2Deg, lon2Deg);

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const phi1 = toRad(lat1Deg);
  const lam1 = toRad(lon1Deg);
  const phi2 = toRad(lat2Deg);
  const lam2 = toRad(lon2Deg);

  const x1 = Math.cos(phi1) * Math.cos(lam1);
  const y1 = Math.cos(phi1) * Math.sin(lam1);
  const z1 = Math.sin(phi1);

  const x2 = Math.cos(phi2) * Math.cos(lam2);
  const y2 = Math.cos(phi2) * Math.sin(lam2);
  const z2 = Math.sin(phi2);

  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);

  const out: Array<{ lat: number; lon: number; distanceKm: number }> = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    let latDeg: number;
    let lonDeg: number;

    if (sinOmega < 1e-7) {
      // Identical endpoints or near-antipodal fallback: avoid 0/0 division
      latDeg = clampLat(lat1Deg + (lat2Deg - lat1Deg) * t);
      let dLon = lon2Deg - lon1Deg;
      if (dLon > 180) dLon -= 360;
      if (dLon < -180) dLon += 360;
      lonDeg = normalizeLon180(lon1Deg + dLon * t);
    } else {
      const a = Math.sin((1 - t) * omega) / sinOmega;
      const b = Math.sin(t * omega) / sinOmega;
      const x = a * x1 + b * x2;
      const y = a * y1 + b * y2;
      const z = a * z1 + b * z2;
      const rHoriz = Math.hypot(x, y);
      latDeg = clampLat(toDeg(Math.atan2(z, rHoriz)));
      lonDeg = normalizeLon180(toDeg(Math.atan2(y, x)));
    }

    out.push({
      lat: latDeg,
      lon: lonDeg,
      distanceKm: Math.round(totalDist * t * 100) / 100,
    });
  }
  return out;
}

/**
 * Equirectangular finite-difference slope/aspect derivatives become severely
 * anisotropic near ±90° (dy/dx = 1/cos(φ) reaches 11.47:1 at 85°, 57.3:1 at 89°,
 * 114.6:1 at 89.5°, and ∞ at 90°). Beyond ±85°, equirectangular Horn gradients
 * are masked rather than displaying noise-amplified East-West artifacts; polar
 * terrain analysis requires Polar Stereographic DTMs.
 */
export const POLAR_DERIVATIVE_MAX_LAT_DEG = 85;

export function isPolarDerivativeMasked(latDeg: number): boolean {
  return Math.abs(latDeg) > POLAR_DERIVATIVE_MAX_LAT_DEG;
}

/**
 * Computes physical ground cell size (dx, dy) in meters for a 256px tile pixel
 * in an Equirectangular (NASA Trek default028mm / EPSG:4326) tile pyramid at zoom `z`.
 *
 * Matrix dimensions at zoom z:
 *   cols = 2^(z + 1) tiles -> 512 * 2^z pixels spanning 360° longitude
 *   rows = 2^z tiles       -> 256 * 2^z pixels spanning 180° latitude
 * Angular pixel step:
 *   Δλ = Δφ = (180° / (256 * 2^z)) * (π / 180) rad
 * Physical spacing on sphere of radius R:
 *   dy = R * Δφ
 *   dx(φ) = R * cos(φ) * Δλ   (exact spherical cosine; no arbitrary clamp)
 */
export function computePixelSpacingMeters(
  body: PlanetaryBody,
  zoom: number,
  latDeg: number,
  tileSize = 256
): { dxMeters: number; dyMeters: number } {
  const radiusM = PLANET_DEM_CONFIG[body].radiusMeters;
  const rows = Math.pow(2, zoom);
  const radPerPx = Math.PI / (tileSize * rows);
  const cosLat = Math.max(0, Math.cos((latDeg * Math.PI) / 180));
  const dyMeters = radiusM * radPerPx;
  const dxMeters = radiusM * cosLat * radPerPx;
  return { dxMeters, dyMeters };
}

/**
 * Computes Horn (1981) 3x3 finite-difference partial derivatives (∂z/∂x Eastward,
 * ∂z/∂n Northward) in dimensionless m/m from a calibrated elevation grid (meters).
 * Grid row index increases Southward; column index increases Eastward.
 * Returns null if the center pixel or any of its 8 neighbors is NoData (non-finite),
 * or if polar convergence collapses dxMeters relative to dyMeters.
 */
export function computeHornGradient(
  grid: Float32Array,
  gridWidth: number,
  gridHeight: number,
  gx: number,
  gy: number,
  dxMeters: number,
  dyMeters: number
): { dzdx: number; dzdn: number } | null {
  if (
    gx <= 0 ||
    gx >= gridWidth - 1 ||
    gy <= 0 ||
    gy >= gridHeight - 1 ||
    !Number.isFinite(dxMeters) ||
    !Number.isFinite(dyMeters) ||
    dxMeters <= 0 ||
    dyMeters <= 0 ||
    dxMeters < 1e-6 * dyMeters
  ) {
    return null;
  }

  const r0 = (gy - 1) * gridWidth;
  const r1 = gy * gridWidth;
  const r2 = (gy + 1) * gridWidth;

  const a = grid[r0 + gx - 1];
  const b = grid[r0 + gx];
  const c = grid[r0 + gx + 1];
  const d = grid[r1 + gx - 1];
  const e = grid[r1 + gx];
  const f = grid[r1 + gx + 1];
  const g = grid[r2 + gx - 1];
  const h = grid[r2 + gx];
  const i = grid[r2 + gx + 1];

  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(c) ||
    !Number.isFinite(d) ||
    !Number.isFinite(e) ||
    !Number.isFinite(f) ||
    !Number.isFinite(g) ||
    !Number.isFinite(h) ||
    !Number.isFinite(i)
  ) {
    return null;
  }

  const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * dxMeters);
  // Row index increases Southward, so Northward elevation rise is (top - bottom)
  const dzdn = (a + 2 * b + c - (g + 2 * h + i)) / (8 * dyMeters);
  return { dzdx, dzdn };
}

/**
 * Computes terrain slope angle in degrees [0, 90) from physical gradients (dz/dx, dz/dn).
 */
export function computeSlopeDeg(dzdx: number, dzdn: number): number {
  return (Math.atan(Math.sqrt(dzdx * dzdx + dzdn * dzdn)) * 180) / Math.PI;
}

/**
 * Computes downslope compass azimuth in degrees clockwise from North:
 *   0° = North, 90° = East, 180° = South, 270° = West, normalized to [0, 360).
 * Downslope direction vector in (East, North) coordinates is (-dz/dx, -dz/dn).
 * Bearing clockwise from North = atan2(East_component, North_component) = atan2(-dzdx, -dzdn).
 */
export function computeDownslopeAspectDeg(dzdx: number, dzdn: number): number {
  const raw = (Math.atan2(-dzdx, -dzdn) * 180) / Math.PI;
  const norm = ((raw % 360) + 360) % 360;
  return norm === 360 ? 0 : norm;
}

/**
 * Computes normalized Lambertian hillshade intensity [0, 255] from physical gradients.
 */
export function computeHillshade(
  dzdx: number,
  dzdn: number,
  azimuthDeg = 315,
  altitudeDeg = 45
): number {
  const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdn * dzdn));
  const zenithRad = ((90 - altitudeDeg) * Math.PI) / 180;
  const azRad = (azimuthDeg * Math.PI) / 180;

  if (slopeRad < 1e-6) {
    return Math.round(Math.max(0, Math.cos(zenithRad)) * 255);
  }

  const aspectRad = (computeDownslopeAspectDeg(dzdx, dzdn) * Math.PI) / 180;
  const illum =
    Math.cos(zenithRad) * Math.cos(slopeRad) +
    Math.sin(zenithRad) * Math.sin(slopeRad) * Math.cos(azRad - aspectRad);

  return Math.round(Math.max(0, Math.min(1, illum)) * 255);
}

/**
 * Maps downslope azimuth [0°, 360°) to match the legend stops:
 *   0°/360° North (#ef4444 Red) -> 90° East (#eab308 Yellow) ->
 *   180° South (#06b6d4 Cyan) -> 270° West (#8b5cf6 Violet)
 */
function aspectColorRamp(deg: number): [number, number, number] {
  const stops: Array<{ deg: number; rgb: [number, number, number] }> = [
    { deg: 0, rgb: [239, 68, 68] },
    { deg: 90, rgb: [234, 179, 8] },
    { deg: 180, rgb: [6, 182, 212] },
    { deg: 270, rgb: [139, 92, 246] },
    { deg: 360, rgb: [239, 68, 68] },
  ];
  const d = ((deg % 360) + 360) % 360;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (d >= a.deg && d <= b.deg) {
      const t = (d - a.deg) / (b.deg - a.deg);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
      ];
    }
  }
  return stops[0].rgb;
}

function slopeColorRamp(deg: number, flatThresholdDeg = 0.25): [number, number, number, number] {
  if (deg < flatThresholdDeg) return [0, 0, 0, 0];
  const t = Math.min(1, deg / 35);
  if (t < 0.25) {
    const k = t / 0.25;
    return [
      Math.round(30 + (6 - 30) * k),
      Math.round(58 + (182 - 58) * k),
      Math.round(138 + (212 - 138) * k),
      205,
    ];
  }
  if (t < 0.55) {
    const k = (t - 0.25) / 0.3;
    return [
      Math.round(6 + (132 - 6) * k),
      Math.round(182 + (204 - 182) * k),
      Math.round(212 + (22 - 212) * k),
      215,
    ];
  }
  if (t < 0.8) {
    const k = (t - 0.55) / 0.25;
    return [
      Math.round(132 + (245 - 132) * k),
      Math.round(204 + (158 - 204) * k),
      Math.round(22 + (11 - 22) * k),
      225,
    ];
  }
  const k = (t - 0.8) / 0.2;
  return [
    Math.round(245 + (220 - 245) * k),
    Math.round(158 + (38 - 158) * k),
    Math.round(11 + (38 - 11) * k),
    235,
  ];
}

export interface ContourSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  levelM: number;
  isMajor: boolean;
}

function interpEdge(vA: number, vB: number, level: number): number {
  const denom = vB - vA;
  if (Math.abs(denom) < 1e-9) return 0.5;
  return Math.max(0, Math.min(1, (level - vA) / denom));
}

/**
 * Extracts iso-elevation line segments in tile pixel coordinates [0, tileW] x [0, tileH]
 * using Marching Squares with bilinear saddle disambiguation.
 * Skips any 2x2 cell containing a NoData (non-finite) corner.
 */
export function computeMarchingSquaresContours(
  grid: Float32Array,
  gridWidth: number,
  gridHeight: number,
  halo: number,
  minorIntervalM: number,
  majorIntervalM: number
): ContourSegment[] {
  const segments: ContourSegment[] = [];
  if (minorIntervalM <= 0 || gridWidth < 2 || gridHeight < 2) return segments;

  const startX = Math.max(0, halo - 1);
  const endX = gridWidth - 2 - Math.max(0, halo - 1);
  const startY = Math.max(0, halo - 1);
  const endY = gridHeight - 2 - Math.max(0, halo - 1);

  for (let gy = startY; gy <= endY; gy++) {
    for (let gx = startX; gx <= endX; gx++) {
      const z00 = grid[gy * gridWidth + gx]; // Top-Left (bit 8)
      const z10 = grid[gy * gridWidth + gx + 1]; // Top-Right (bit 4)
      const z11 = grid[(gy + 1) * gridWidth + gx + 1]; // Bottom-Right (bit 2)
      const z01 = grid[(gy + 1) * gridWidth + gx]; // Bottom-Left (bit 1)

      if (
        !Number.isFinite(z00) ||
        !Number.isFinite(z10) ||
        !Number.isFinite(z11) ||
        !Number.isFinite(z01)
      ) {
        continue;
      }

      const cMin = Math.min(z00, z10, z11, z01);
      const cMax = Math.max(z00, z10, z11, z01);
      if (cMax - cMin < 1e-6) continue;

      const kMin = Math.ceil(cMin / minorIntervalM);
      const kMax = Math.floor(cMax / minorIntervalM);
      if (kMin > kMax) continue;

      // Pixel center coordinates in tile-space [0..256]:
      // Grid index (gx, gy) corresponds to pixel center (gx - halo + 0.5, gy - halo + 0.5)
      const x0 = gx - halo + 0.5;
      const y0 = gy - halo + 0.5;

      for (let k = kMin; k <= kMax; k++) {
        const level = k * minorIntervalM;
        const b00 = z00 >= level ? 8 : 0;
        const b10 = z10 >= level ? 4 : 0;
        const b11 = z11 >= level ? 2 : 0;
        const b01 = z01 >= level ? 1 : 0;
        const mask = b00 | b10 | b11 | b01;
        if (mask === 0 || mask === 15) continue;

        const isMajor = Math.abs(level % majorIntervalM) < 1e-6;

        // Edges: 0 = Top (00-10), 1 = Right (10-11), 2 = Bottom (01-11), 3 = Left (00-01)
        const edgePt = (edge: number): [number, number] => {
          switch (edge) {
            case 0:
              return [x0 + interpEdge(z00, z10, level), y0];
            case 1:
              return [x0 + 1, y0 + interpEdge(z10, z11, level)];
            case 2:
              return [x0 + interpEdge(z01, z11, level), y0 + 1];
            default:
              return [x0, y0 + interpEdge(z00, z01, level)];
          }
        };

        const addSeg = (eA: number, eB: number) => {
          const [x1, y1] = edgePt(eA);
          const [x2, y2] = edgePt(eB);
          segments.push({ x1, y1, x2, y2, levelM: level, isMajor });
        };

        switch (mask) {
          case 1:
          case 14:
            addSeg(3, 2);
            break;
          case 2:
          case 13:
            addSeg(2, 1);
            break;
          case 3:
          case 12:
            addSeg(3, 1);
            break;
          case 4:
          case 11:
            addSeg(0, 1);
            break;
          case 5: {
            // Saddle: Top-Right (10) & Bottom-Left (01) >= level
            const zCenter = 0.25 * (z00 + z10 + z11 + z01);
            if (zCenter >= level) {
              addSeg(0, 3);
              addSeg(1, 2);
            } else {
              addSeg(0, 1);
              addSeg(3, 2);
            }
            break;
          }
          case 6:
          case 9:
            addSeg(0, 2);
            break;
          case 7:
          case 8:
            addSeg(0, 3);
            break;
          case 10: {
            // Saddle: Top-Left (00) & Bottom-Right (11) >= level
            const zCenter = 0.25 * (z00 + z10 + z11 + z01);
            if (zCenter >= level) {
              addSeg(0, 1);
              addSeg(3, 2);
            } else {
              addSeg(0, 3);
              addSeg(1, 2);
            }
            break;
          }
        }
      }
    }
  }

  return segments;
}

/**
 * Renders scientifically calibrated DEM derivatives (slope, aspect, or contour lines)
 * onto a 256x256 HTMLCanvasElement from a Float32Array elevation grid in meters.
 *
 * When `gridWidth === 258` and `gridHeight === 258`, a 1px neighbor halo eliminates
 * artificial tile-seam boundary gradients and keeps contours continuous across tiles.
 */
export function renderDerivedDemGrid(
  grid: Float32Array,
  gridWidth: number,
  gridHeight: number,
  canvas: HTMLCanvasElement,
  mode: DerivedDemMode,
  body: PlanetaryBody,
  zoom: number,
  tileY: number
): void {
  const tileW = 256;
  const tileH = 256;
  canvas.width = tileW;
  canvas.height = tileH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const halo = gridWidth >= tileW + 2 && gridHeight >= tileH + 2 ? Math.floor((gridWidth - tileW) / 2) : 0;
  const cfg = PLANET_DEM_CONFIG[body];

  if (mode === 'contour') {
    ctx.clearRect(0, 0, tileW, tileH);
    const segments = computeMarchingSquaresContours(
      grid,
      gridWidth,
      gridHeight,
      halo,
      cfg.minorContourM,
      cfg.majorContourM
    );

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Minor contours
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    for (const seg of segments) {
      if (!seg.isMajor) {
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
      }
    }
    ctx.stroke();

    // Major contours
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.92)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const seg of segments) {
      if (seg.isMajor) {
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
      }
    }
    ctx.stroke();
    return;
  }

  const dst = ctx.createImageData(tileW, tileH);
  const d = dst.data;
  const rows = Math.pow(2, zoom);
  const degPerPx = 180 / (tileH * rows);

  for (let py = 0; py < tileH; py++) {
    const latDeg = 90 - (tileY * tileH + py + 0.5) * degPerPx;
    if (isPolarDerivativeMasked(latDeg)) {
      for (let px = 0; px < tileW; px++) {
        d[(py * tileW + px) * 4 + 3] = 0;
      }
      continue;
    }
    const { dxMeters, dyMeters } = computePixelSpacingMeters(body, zoom, latDeg, tileH);
    const gy = py + halo;

    for (let px = 0; px < tileW; px++) {
      const gx = px + halo;
      const idx = (py * tileW + px) * 4;
      const grad = computeHornGradient(grid, gridWidth, gridHeight, gx, gy, dxMeters, dyMeters);
      if (!grad) {
        d[idx + 3] = 0;
        continue;
      }

      const slopeDeg = computeSlopeDeg(grad.dzdx, grad.dzdn);
      if (mode === 'slope') {
        const [r, g, b, a] = slopeColorRamp(slopeDeg, cfg.flatSlopeThresholdDeg);
        d[idx] = r;
        d[idx + 1] = g;
        d[idx + 2] = b;
        d[idx + 3] = a;
      } else {
        // Aspect: mask flat terrain below slope threshold to avoid quantization noise
        if (slopeDeg < cfg.flatSlopeThresholdDeg) {
          d[idx + 3] = 0;
          continue;
        }
        const aspectDeg = computeDownslopeAspectDeg(grad.dzdx, grad.dzdn);
        const [r, g, b] = aspectColorRamp(aspectDeg);
        d[idx] = r;
        d[idx + 1] = g;
        d[idx + 2] = b;
        d[idx + 3] = 195;
      }
    }
  }

  ctx.putImageData(dst, 0, 0);
}
