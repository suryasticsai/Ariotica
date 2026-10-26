'use strict';

function generateMutation() {
  const plugins = [
    {
      name: 'seo-injector',
      prompt: 'Write a plugin that injects OpenGraph (og:title, og:description) and Twitter Card meta tags into `context.files["index.html"]`.'
    },
    {
      name: 'auto-pwa',
      prompt: 'Write a plugin that automatically adds a `<meta name="apple-mobile-web-app-capable" content="yes">` tag and a manifest link into `context.files["index.html"]`.'
    },
    {
      name: 'dark-mode-toggle',
      prompt: 'Write a plugin that injects a floating dark-mode toggle button into `context.files["index.html"]` and the necessary CSS into `context.files["style.css"]`.'
    },
    {
      name: 'confetti-on-click',
      prompt: 'Write a plugin that injects a script into `context.files["index.html"]` that fires confetti whenever the user clicks a button.'
    },
    {
      name: 'perf-auditor',
      prompt: 'Write a plugin that scans `context.files["index.html"]` for `<img>` tags missing `loading="lazy"` and injects the attribute.'
    }
  ];

  const selected = plugins[Math.floor(Math.random() * plugins.length)];
  return selected;
}

module.exports = { generateMutation };