(function () {
  const menu = document.getElementById('library-menu');
  if (!menu) return;

  const button = menu.querySelector('summary');
  menu.addEventListener('toggle', function () {
    button.setAttribute('aria-expanded', String(menu.open));
  });
  menu.querySelectorAll('a, button').forEach(function (control) {
    control.addEventListener('click', function () { menu.open = false; });
  });
  document.addEventListener('click', function (event) {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !menu.open) return;
    menu.open = false;
    button.focus();
  });
})();
