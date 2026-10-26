module.exports = {
  name: 'inject-ga',
  execute: async (context) => {
    const html = context.files['index.html'];
    if (typeof html !== 'string') return;

    const gaId = 'G-XXXXXXX'; // replace with your actual GA Measurement ID
    const gaScript = `
<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${gaId}');
</script>
`;

    // Insert the GA script right before the closing </head> tag
    if (html.includes('</head>')) {
      context.files['index.html'] = html.replace('</head>', `${gaScript}\n</head>`);
    }
  }
};