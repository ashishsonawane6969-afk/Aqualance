/**
 * speed-insights-init.js
 * Initializes Vercel Speed Insights for vanilla JavaScript
 */
(function() {
  // Load Speed Insights from Vercel CDN instead of node_modules
  var script = document.createElement('script');
  script.src = 'https://va.vercel-scripts.com/v1/speed-insights/script.debug.js';
  script.defer = true;
  script.setAttribute('data-endpoint', '/_vercel/speed-insights/vitals');
  document.head.appendChild(script);
})();
