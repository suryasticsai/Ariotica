# Add SEO meta tags and minify generated assets

The generated web app often lacks essential SEO tags and contains unminified CSS/JS which increase load time. This plugin injects common SEO meta tags into index.html and performs simple whitespace‑based minification of style.css and script.js, improving search visibility and performance without requiring external libraries.

## Proposed Code
```javascript
module.exports = {\n  name: 'seo-minify',\n  execute: async (context) => {\n    // Add SEO meta tags to index.html\n    if (context.files['index.html']) {\n      const seoMeta = [\n        '<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">',\n        '<meta name=\"description\" content=\"Generated web app by Ariotica.\">',\n        '<meta property=\"og:title\" content=\"Ariotica Web App\">',\n        '<meta property=\"og:type\" content=\"website\">'\n      ].join('\\n');\n      // Insert before </head>\n      context.files['index.html'] = context.files['index.html'].replace(/<\\/head>/i, seoMeta + '\\n</head>');\n    }\n\n    // Minify CSS\n    if (context.files['style.css']) {\n      const css = context.files['style.css'];\n      const minified = css\n        .replace(/\\/\\*[^*]*\\*+(?:[^/*][^*]*\\*+)*\\//g, '') // remove comments\n        .replace(/\\s+/g, ' ') // collapse whitespace\n        .replace(/\\s*([:{},;])\\s*/g, '$1') // trim spaces around symbols\n        .trim();\n      context.files['style.css'] = minified;\n    }\n\n    // Minify JS\n    if (context.files['script.js']) {\n      const js = context.files['script.js'];\n      const minified = js\n        .replace(/\\/\\/.*$/gm, '') // remove line comments\n        .replace(/\\/\\*[^*]*\\*+(?:[^/*][^*]*\\*+)*\\//g, '') // remove block comments\n        .replace(/\\s+/g, ' ') // collapse whitespace\n        .replace(/\\s*([{}();,:=+\\-\\*/<>])\\s*/g, '$1')\n        .trim();\n      context.files['script.js'] = minified;\n    }\n  }\n};
```

## Target Filename
`seo_minify_plugin.js`

## Commit Message
feat: add SEO tags and minify generated CSS/JS
