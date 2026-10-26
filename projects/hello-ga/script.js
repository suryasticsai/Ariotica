(() => {
  // Update document title based on hash (default view)
  const updateTitle = () => {
    const route = location.hash.replace('#', '') || 'home';
    const titles = {
      home: 'Hello World App',
      about: 'About – Hello World App',
      settings: 'Settings – Hello World App'
    };
    document.title = titles[route] || 'Hello World App';
  };

  window.addEventListener('hashchange', updateTitle);
  // Initial call
  updateTitle();
})();