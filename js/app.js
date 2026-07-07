// ============================================================
// SEApp — hash 路由 + 導覽 + toast
// ============================================================
window.SEApp = (function() {
  'use strict';

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { el.hidden = true; }, 2200);
  }

  function setNav(name) {
    document.querySelectorAll('.bottom-nav a').forEach(function(a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === name);
    });
  }

  function route() {
    window.SETts.stop();
    var el = document.getElementById('view');
    var hash = (location.hash || '#calendar').slice(1);
    var parts = hash.split('/');
    var V = window.SEViews;

    window.scrollTo(0, 0);

    switch (parts[0]) {
      case 'calendar': case '':
        setNav('calendar'); V.renderCalendar(el); break;
      case 'day':
        setNav('calendar'); V.renderDay(el, parts[1]); break;
      case 'library':
        setNav('library'); V.renderLibrary(el); break;
      case 'vocab':
        setNav('library'); V.renderVocabLib(el); break;
      case 'grammar':
        setNav('library');
        if (parts[1]) V.renderGrammarDetail(el, parts[1]);
        else V.renderGrammarLib(el);
        break;
      case 'reading':
        setNav('library');
        if (parts[1]) V.renderReadingDetail(el, parts[1]);
        else V.renderReadingLib(el);
        break;
      case 'writing':
        setNav('library');
        if (parts[1]) V.renderWritingWeek(el, parts[1]);
        else V.renderWritingLib(el);
        break;
      case 'wrong':
        setNav('wrong'); V.renderWrong(el); break;
      case 'stats':
        setNav('stats'); V.renderStats(el); break;
      default:
        setNav('calendar'); V.renderCalendar(el);
    }
  }

  function init() {
    window.addEventListener('hashchange', route);
    window.SEStore.updateBadge();
    route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { toast: toast, route: route };
})();
