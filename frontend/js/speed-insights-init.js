/**
 * speed-insights-init.js
 * Initializes Vercel Speed Insights for vanilla JavaScript
 */

import { injectSpeedInsights } from '../node_modules/@vercel/speed-insights/dist/index.mjs';

// Initialize Speed Insights
// This will automatically track Core Web Vitals and other performance metrics
injectSpeedInsights({
  // The framework field helps Vercel identify the setup
  framework: 'vanilla'
});
