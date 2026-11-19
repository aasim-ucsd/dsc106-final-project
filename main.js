// main.js: entry point for the page
// Loads D3 as an ES module (same style as the labs).
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import { drawMainViz } from './viz/main-viz.js';

// ---------------------------------------------------------------
// Ryan: paste/adapt your Project 3 visualization code here, or
// import it from its own file, e.g.:
//   import { drawMainViz } from './viz/main-viz.js';
//   drawMainViz('#main-viz');
//
// Data files (put them in a /data folder in the repo):
//   data/gsat_anom_model_ensemble_means_CMIP6_hist_SSP126.csv
//   data/gsat_anom_model_ensemble_means_CMIP6_hist_SSP585.csv
// ---------------------------------------------------------------

// Clears the "loading…" placeholder before drawing into a container.
export function clearPlaceholder(selector) {
  d3.select(selector).select('.placeholder').remove();
}

// Example usage once the chart is ready:
// clearPlaceholder('#main-viz');
// const svg = d3.select('#main-viz').append('svg').attr('viewBox', '0 0 800 400');

// Main interactive chart (Ryan): two futures, model range, zoom, threshold slider.
drawMainViz('#main-viz');
