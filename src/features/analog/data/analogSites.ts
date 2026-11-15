import { REGION_PRESETS } from '@/data/planetaryCatalog';
import type { PlanetaryBody, RegionPreset } from '@/types/planetary';

export interface AnalogSiteTemplate {
  id: string;
  body: PlanetaryBody;
  region: RegionPreset;
  earthAnalog: {
    id: string;
    name: string;
    lat: number;
    lon: number;
    description: string;
  };
}

const regionById = new Map(REGION_PRESETS.map((region) => [region.id, region]));

const SITE_TEMPLATES: Array<{
  id: string;
  regionId: string;
  earthAnalog: AnalogSiteTemplate['earthAnalog'];
}> = [
  {
    id: 'mars-analog-1',
    regionId: 'mars-jezero',
    earthAnalog: {
      id: 'E01',
      name: 'Tatacoa Desert, Colombia',
      lat: 3.232083,
      lon: -75.168167,
      description: 'Cuzco scientific sampling point',
    },
  },
  {
    id: 'mars-analog-2',
    regionId: 'mars-gale',
    earthAnalog: {
      id: 'E02',
      name: 'Alta Guajira, Colombia',
      lat: 12.2071,
      lon: -72.1802,
      description: 'Cabo de la Vela regional reference',
    },
  },
  {
    id: 'mars-analog-3',
    regionId: 'mars-olympus',
    earthAnalog: {
      id: 'E03',
      name: 'Nevado del Ruiz, Colombia',
      lat: 4.895278,
      lon: -75.3225,
      description: 'Earth analog location',
    },
  },
  {
    id: 'moon-analog-1',
    regionId: 'moon-apollo11',
    earthAnalog: {
      id: 'E04',
      name: 'Atacama Desert, Chile',
      lat: -24.063778,
      lon: -69.8805,
      description: 'Yungay hyper-arid sampling area',
    },
  },
  {
    id: 'moon-analog-2',
    regionId: 'moon-apollo15',
    earthAnalog: {
      id: 'E05',
      name: 'Fagradalsfjall, Iceland',
      lat: 63.895,
      lon: -22.258,
      description: 'Earth analog location',
    },
  },
];

export const ANALOG_SITE_TEMPLATES: AnalogSiteTemplate[] = SITE_TEMPLATES.map((template) => {
  const region = regionById.get(template.regionId);
  if (!region) {
    throw new Error(`Unknown planetary region in analog site template: ${template.regionId}`);
  }

  return {
    id: template.id,
    body: region.body,
    region,
    earthAnalog: template.earthAnalog,
  };
});

export function getAnalogSiteTemplates(body: PlanetaryBody): AnalogSiteTemplate[] {
  return ANALOG_SITE_TEMPLATES.filter((site) => site.body === body);
}
