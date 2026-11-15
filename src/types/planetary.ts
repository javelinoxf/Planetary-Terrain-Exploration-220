export type PlanetaryBody = 'moon' | 'mars';

export type LayerCategoryId =
  | 'topography'
  | 'geology'
  | 'environment'
  | 'water_resources'
  | 'exploration';

export type LayerSourceType =
  | 'wmts'
  | 'arcgis_tile'
  | 'derived_dem'
  | 'vector_geojson'
  | 'unavailable';

export type DerivedDemMode = 'slope' | 'aspect' | 'contour';

export interface LegendStop {
  color: string;
  label: string;
  value?: string;
}

export interface LayerLegend {
  title: string;
  type: 'gradient' | 'categorical';
  unit: string;
  minLabel?: string;
  midLabel?: string;
  maxLabel?: string;
  stops: LegendStop[];
}

export interface BasemapSpec {
  id: string;
  body: PlanetaryBody;
  name: string;
  shortName: string;
  source: string;
  resolution: string;
  tileUrl: string;
  maxNativeZoom: number;
  bounds?: [[number, number], [number, number]];
  attribution: string;
  description: string;
}

export interface PlanetaryLayerSpec {
  id: string;
  body: PlanetaryBody;
  category: LayerCategoryId;
  name: string;
  shortDescription: string;
  scientificDescription: string;
  sourceType: LayerSourceType;
  tileUrl?: string;
  maxNativeZoom?: number;
  bounds?: [[number, number], [number, number]];
  demSourceUrl?: string;
  derivedMode?: DerivedDemMode;
  vectorEndpointId?: string;
  vectorColor?: string;
  vectorGeometry?: 'point' | 'polyline' | 'polygon' | 'mixed';
  dataSource: string;
  instrument: string;
  spatialResolution: string;
  units: string;
  geographicCoverage: string;
  dataLimitations: string;
  unavailableReason?: string;
  defaultOpacity: number;
  defaultActive?: boolean;
  legend?: LayerLegend;
}

export interface ActiveLayerState {
  layerId: string;
  visible: boolean;
  opacity: number;
}

export interface RegionPreset {
  id: string;
  body: PlanetaryBody;
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
  zoom: number;
  category: string;
}

export interface LocationProbeResult {
  body: PlanetaryBody;
  lat: number;
  lon: number;
  elevationM: number | null;
  elevationSource: string;
  elevationLoading: boolean;
  elevationError?: string;
  nearbyFeatures: Array<{
    name: string;
    type: string;
    distanceKm: number;
    diameterKm?: number;
  }>;
}

export interface ElevationProfilePoint {
  distanceKm: number;
  lat: number;
  lon: number;
  elevationM: number | null;
}

export interface PlanetaryGeoFeature {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'MultiPoint' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon';
    coordinates: unknown;
  };
  properties: Record<string, unknown>;
}

export interface PlanetaryFeatureCollection {
  type: 'FeatureCollection';
  layerId: string;
  source: string;
  features: PlanetaryGeoFeature[];
}
