# Planetary Terrain Exploration

Interactive Moon and Mars mapping, location probes, and terrain comparisons with Earth analog sites.

## Workspaces

- **Analog Map** compares Earth and planetary measurements in a consistent category order and generates paired terrain models.
- **General Map** is an independent terrain-generation workspace with saved or custom coordinates, DEM zoom (`Z#`), and vertical relief controls.
- **2D Map / 3D Globe** provide planetary basemaps, layers, elevation probes, and nearby feature information. Probing a configured analog site also shows its Earth/planet measurement table; other coordinates show only available location data.

## Site data

The analog comparison templates live in `src/features/analog/data/analogSites.ts`. Measurement files are:

- `public/data/analog-mars-data.csv`
- `public/data/analog-moon-data.csv`

Each CSV has one row per configured site and paired `earth_` / `planet_` columns. Keep the existing header and column order when editing the files. Leave unknown values blank; the UI displays them as pending rather than inferring measurements.

Comparison categories are ordered as water/ice, biology, erosion/hydrology, human activity, illumination/operations, relief, subsurface, thermal data, and wind.

## Development

```sh
npm install
npm run dev
```

Run `npm run lint` for the TypeScript check and `npm run build` for a production build.

## GitHub deployment

Vite's project base is configured for the `Planetary-Terrain-Exploration` repository, and public CSVs are fetched relative to that base so they work under the repository path.

The interactive NASA elevation, DEM-tile, and feature requests use the Express routes in `server/index.ts`. GitHub Pages serves static files only and cannot run those routes; deploy the app with its Node server (or provide a compatible API backend) to enable those live services.
