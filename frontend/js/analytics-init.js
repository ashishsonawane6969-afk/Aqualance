/**
 * analytics-init.js
 * Initializes Vercel Web Analytics for vanilla JavaScript.
 *
 * This script loads the Vercel Analytics tracking script.
 * The script domain (va.vercel-scripts.com) is whitelisted in both
 * vercel.json CSP header and server.js helmet CSP.
 */
(function() {
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  var script = document.createElement('script');
  script.src = 'https://va.vercel-scripts.com/v1/script.js';
  script.defer = true;
  document.head.appendChild(script);
})();
