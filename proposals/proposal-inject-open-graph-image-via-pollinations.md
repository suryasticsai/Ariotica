# Inject Open Graph Image via Pollinations

Adds dynamic Open Graph meta tags with an image generated from Pollinations AI so shared links have rich previews.

## Proposed Code
```javascript
module.exports = {\n  name: 'inject-open-graph',\n  execute: async (context) => {\n    let html = context.files['index.html'];\n    if (!html) return;\n    const titleMatch = html.match(/<title[^>]*>([^<]*)<\\/title>/i);\n    const title = titleMatch ? titleMatch[1].trim() : 'Ariotic App';\n    const prompt = encodeURIComponent(`Open Graph image for ${title}`);\n    const ogImage = `https://image.pollinations.ai/prompt/${prompt}?width=1200&height=630&nologo=true&model=flux`.;\n    const metaTags = `\\n  <meta property=\"og:title\" content=\"${title}\">\\n  <meta property=\"og:type\" content=\"website\">\\n  <meta property=\"og:image\" content=\"${ogImage}\">`.;\n    if (/property=[\"']og:image[\"']/i.test(html)) {\n      html = html.replace(/<meta[^>]*property=[\"']og:image[\"'][^>]*>/i, `<meta property=\"og:image\" content=\"${ogImage}\">`);\n    } else {\n      html = html.replace('</head>', `${metaTags}\\n</head>`);\n    }\n    context.files['index.html'] = html;\n  }\n};
```

## Target Filename
`inject-open-graph.js`

## Commit Message
Add Open Graph image meta tags using Pollinations AI
