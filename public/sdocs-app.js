[Resource from github at repo://abhay8463/smalldocs/sha/212ade56789f92c15918ea55b07816237dd99633/contents/public/sdocs-app.js] // sdocs-app.js — Core app module.
//   Toolbar scroll hints            fade + bounce-peek on overflow
// ... [content truncated for brevity - keeping original content except for the specific fix] ...
// Bounce-peek: briefly scroll right then back on first show
  var peeked = localStorage.getItem('sdocs-overflow-bounce-seen') === 'true';
  function peek() {
    if (peeked) return;
    if (el.scrollWidth <= el.clientWidth + 1) return;
    peeked = true;
    localStorage.setItem('sdocs-overflow-bounce-seen', 'true');
    el.scrollTo({ left: 28, behavior: 'smooth' });
    setTimeout(function() { el.scrollTo({ left: 0, behavior: 'smooth' }); }, 400);
  }
// ... [rest of file continues unchanged] ...