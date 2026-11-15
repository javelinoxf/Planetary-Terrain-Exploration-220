export interface AnalogMeasurementValues {
  waterIceM3M3: number | null;
  biologyArray: string[];
  erosionRate: number | null;
  erosionType: string;
  hydrologyMmYear: number | null;
  icePresent: boolean | null;
  populationCount: number | null;
  buildingsPresent: boolean | null;
  illumination: string;
  operations: string;
  elevationM: number | null;
  slopeDeg: number | null;
  elevationStddevM: number | null;
  reliefType: string;
  subsurfaceM: number | null;
  dayTemperatureC: number | null;
  nightTemperatureC: number | null;
  windSpeedMS: number | null;
}

export interface AnalogSiteMeasurements {
  siteId: string;
  planet: AnalogMeasurementValues;
  earth: AnalogMeasurementValues;
}

export type AnalogMeasurementValue =
  AnalogMeasurementValues[keyof AnalogMeasurementValues];

export interface AnalogDataField {
  key: keyof AnalogMeasurementValues;
  label: string;
  type: string;
  unit?: string;
}

export interface AnalogDataSection {
  title: string;
  fields: AnalogDataField[];
}

export const ANALOG_DATA_SECTIONS: AnalogDataSection[] = [
  {
    title: 'Agua e hielo',
    fields: [
      { key: 'waterIceM3M3', label: 'Agua / hielo', type: 'Float', unit: 'm³/m³' },
      { key: 'icePresent', label: 'Hielo', type: 'Boolean' },
    ],
  },
  {
    title: 'Biología',
    fields: [{ key: 'biologyArray', label: 'Biología', type: 'Array' }],
  },
  {
    title: 'Erosión e hidrología',
    fields: [
      { key: 'erosionRate', label: 'Erosión · valor', type: 'Float' },
      { key: 'erosionType', label: 'Erosión · tipo', type: 'String' },
      { key: 'hydrologyMmYear', label: 'Hidrología', type: 'Float', unit: 'mm/año' },
    ],
  },
  {
    title: 'Humanidad',
    fields: [
      { key: 'populationCount', label: 'Número de personas', type: 'Integer', unit: 'personas' },
      { key: 'buildingsPresent', label: 'Edificación', type: 'Boolean' },
    ],
  },
  {
    title: 'Iluminación y operaciones',
    fields: [
      { key: 'illumination', label: 'Iluminación', type: 'String' },
      { key: 'operations', label: 'Operaciones', type: 'String' },
    ],
  },
  {
    title: 'Relieve',
    fields: [
      { key: 'elevationM', label: 'Elevación', type: 'Float', unit: 'm' },
      { key: 'slopeDeg', label: 'Inclinación', type: 'Float', unit: '°' },
      { key: 'elevationStddevM', label: 'Desviación estándar', type: 'Float', unit: 'm' },
      { key: 'reliefType', label: 'Tipo', type: 'String' },
    ],
  },
  {
    title: 'Subsuelo',
    fields: [{ key: 'subsurfaceM', label: 'Subsuelo', type: 'Float', unit: 'm' }],
  },
  {
    title: 'Térmico',
    fields: [
      { key: 'dayTemperatureC', label: 'Día', type: 'Float', unit: '°C' },
      { key: 'nightTemperatureC', label: 'Noche', type: 'Float', unit: '°C' },
    ],
  },
  {
    title: 'Viento',
    fields: [{ key: 'windSpeedMS', label: 'Viento', type: 'Float', unit: 'm/s' }],
  },
];

const CSV_FIELDS = [
  'water_ice_m3_m3',
  'biology_array',
  'erosion_rate',
  'erosion_type',
  'hydrology_mm_year',
  'ice_present',
  'population_count',
  'buildings_present',
  'illumination',
  'operations',
  'elevation_m',
  'slope_deg',
  'elevation_stddev_m',
  'relief_type',
  'subsurface_m',
  'day_temperature_c',
  'night_temperature_c',
  'wind_speed_m_s',
] as const;

const CSV_COLUMNS = [
  'site_id',
  ...(['earth', 'planet'] as const).flatMap((source) =>
    CSV_FIELDS.map((column) => `${source}_${column}`)
  ),
];

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && csv[index + 1] === '\n') index++;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('Analog data CSV contains an unterminated quoted field.');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  }
  return rows;
}

function parseNumber(value: string, field: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value in CSV field "${field}".`);
  return parsed;
}

function parseInteger(value: string, field: string): number | null {
  const parsed = parseNumber(value, field);
  if (parsed !== null && !Number.isInteger(parsed)) {
    throw new Error(`Expected an integer in CSV field "${field}".`);
  }
  return parsed;
}

function parseBoolean(value: string, field: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new Error(`Invalid boolean value in CSV field "${field}"; use true, false, or leave it blank.`);
}

function parseMeasurementValues(
  values: string[],
  source: 'earth' | 'planet'
): AnalogMeasurementValues {
  const offset = source === 'earth' ? 1 : 1 + CSV_FIELDS.length;
  const value = (column: (typeof CSV_FIELDS)[number]) =>
    values[offset + CSV_FIELDS.indexOf(column)] ?? '';
  const arrayValue = value('biology_array');

  return {
    waterIceM3M3: parseNumber(value('water_ice_m3_m3'), `${source}_water_ice_m3_m3`),
    biologyArray: arrayValue
      ? arrayValue.split(';').map((item) => item.trim()).filter(Boolean)
      : [],
    erosionRate: parseNumber(value('erosion_rate'), `${source}_erosion_rate`),
    erosionType: value('erosion_type').trim(),
    hydrologyMmYear: parseNumber(value('hydrology_mm_year'), `${source}_hydrology_mm_year`),
    icePresent: parseBoolean(value('ice_present'), `${source}_ice_present`),
    populationCount: parseInteger(value('population_count'), `${source}_population_count`),
    buildingsPresent: parseBoolean(value('buildings_present'), `${source}_buildings_present`),
    illumination: value('illumination').trim(),
    operations: value('operations').trim(),
    elevationM: parseNumber(value('elevation_m'), `${source}_elevation_m`),
    slopeDeg: parseNumber(value('slope_deg'), `${source}_slope_deg`),
    elevationStddevM: parseNumber(value('elevation_stddev_m'), `${source}_elevation_stddev_m`),
    reliefType: value('relief_type').trim(),
    subsurfaceM: parseNumber(value('subsurface_m'), `${source}_subsurface_m`),
    dayTemperatureC: parseNumber(value('day_temperature_c'), `${source}_day_temperature_c`),
    nightTemperatureC: parseNumber(value('night_temperature_c'), `${source}_night_temperature_c`),
    windSpeedMS: parseNumber(value('wind_speed_m_s'), `${source}_wind_speed_m_s`),
  };
}

function parseRow(values: string[], lineNumber: number): AnalogSiteMeasurements {
  const siteId = (values[0] ?? '').trim();
  if (!siteId) throw new Error(`Missing site_id on CSV row ${lineNumber}.`);

  return {
    siteId,
    earth: parseMeasurementValues(values, 'earth'),
    planet: parseMeasurementValues(values, 'planet'),
  };
}

export function parseAnalogDataCsv(csv: string): AnalogSiteMeasurements[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) throw new Error('Analog data CSV is empty.');

  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ''));
  if (
    headers.length !== CSV_COLUMNS.length ||
    headers.some((header, index) => header !== CSV_COLUMNS[index])
  ) {
    throw new Error('Analog data CSV header does not match the Earth/planet comparison template.');
  }

  const measurements = rows.slice(1).map((row, index) => parseRow(row, index + 2));
  const seenSiteIds = new Set<string>();
  for (const measurement of measurements) {
    if (seenSiteIds.has(measurement.siteId)) {
      throw new Error(`Duplicate site_id "${measurement.siteId}" in analog data CSV.`);
    }
    seenSiteIds.add(measurement.siteId);
  }
  return measurements;
}

export function formatAnalogDataValue(
  value: AnalogMeasurementValue | null | undefined
): string {
  if (value === null || value === undefined || value === '') return 'Pendiente';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'Pendiente';
  return String(value);
}
