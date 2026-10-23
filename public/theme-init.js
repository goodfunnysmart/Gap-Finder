(function () {
  var allowed = {classic: true, dark: true};
  var query = '';
  try { query = new URLSearchParams(location.search).get('skin') || ''; } catch (e) { query = ''; }
  var saved = '';
  try { saved = localStorage.getItem('gapfinder:skin') || ''; } catch (e) { saved = ''; }
  var dark = false;
  try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { dark = false; }
  var skin = allowed[query] ? query : (allowed[saved] ? saved : (dark ? 'dark' : 'classic'));
  document.documentElement.setAttribute('data-skin', skin);
})();
