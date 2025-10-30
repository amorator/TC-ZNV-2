function setupOrdersSearch() {
  var input = document.getElementById('searchinp');
  if (!input) return;
  if (input._ordersSearchBound) return;
  input._ordersSearchBound = true;

  var timer = null;
  var trigger = function() {
    var val = (input.value || '').trim();
    if (window.ordersDoFilter) {
      window.ordersDoFilter(val, 1);
    }
  };
  input.addEventListener('input', function() {
    clearTimeout(timer);
    var v = (input.value || '').trim();
    if (!v) {
      if (window.ordersDoFilter) window.ordersDoFilter('', 1);
      return;
    }
    timer = setTimeout(trigger, 250);
  });
  input.addEventListener('keydown', function(e){
    if (e.key === 'Enter') {
      clearTimeout(timer);
      trigger();
    }
  });
  try {
    var table = document.getElementById('maintable');
    var tbody = table && table.tBodies && table.tBodies[0];
    if (tbody && !tbody._ordersSearchObserver) {
      var mo = new MutationObserver(function(){ setupOrdersSearch(); });
      mo.observe(tbody, { childList: true, subtree: true });
      tbody._ordersSearchObserver = mo;
    }
  } catch(_) {}
}

window.OrdersSearch = {
  setupOrdersSearch
};

(function autoInitOrdersSearch(){
    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function(){
                window.OrdersSearch && window.OrdersSearch.setupOrdersSearch && window.OrdersSearch.setupOrdersSearch();
            });
        } else {
            window.OrdersSearch && window.OrdersSearch.setupOrdersSearch && window.OrdersSearch.setupOrdersSearch();
        }
    } catch(e) {}
})();
