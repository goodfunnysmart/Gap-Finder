'use strict';
(function () {
  var root = document.documentElement;
  var controls = document.querySelectorAll('[data-set-skin]');
  var status = document.getElementById('skin-status');
  function apply(skin) {
    if (skin !== 'classic' && skin !== 'dark') return;
    root.setAttribute('data-skin', skin);
    try { localStorage.setItem('gapfinder:skin', skin); } catch (e) {}
    controls.forEach(function (control) {
      control.setAttribute('aria-pressed', String(control.getAttribute('data-set-skin') === skin));
    });
    if (status) status.textContent = (skin === 'dark' ? 'Dark' : 'Classic') + ' appearance selected.';
  }
  var current = root.getAttribute('data-skin') === 'dark' ? 'dark' : 'classic';
  apply(current);
  controls.forEach(function (button) {
    button.addEventListener('click', function () { apply(button.getAttribute('data-set-skin')); });
  });
})();
