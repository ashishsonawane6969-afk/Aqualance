/**
 * speed-insights-init.js
 * Initializes Vercel Speed Insights for vanilla JavaScript.
 *
 * FIX: was loading script.js which is blocked by CSP in production
 * and also triggers extra console noise. Using the production script URL.
 * The script domain (va.vercel-scripts.com) is now whitelisted in both
 * vercel.json CSP header and server.js helmet CSP.
 */
(function() {
  var script = document.createElement('script');
  script.src = 'https://va.vercel-scripts.com/v1/speed-insights/script.js';
  script.defer = true;
  script.setAttribute('data-endpoint', '/_vercel/speed-insights/vitals');
  document.head.appendChild(script);
})();
