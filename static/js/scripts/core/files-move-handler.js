/**
 * Files Move Handler Module
 * Обработка перемещения файлов
 */

/**
 * Setup move modal event handlers
 */
function setupMoveModal() {
  try {
    const moveCategorySelect = document.getElementById('move-target-root');
    const moveSubcategorySelect = document.getElementById('move-target-sub');
    
    if (!moveCategorySelect || !moveSubcategorySelect) {
      return;
    }

    // Handle category selection change
    moveCategorySelect.addEventListener('change', function() {
      updateSubcategoriesForMove(this);
    });

    // If no usable categories rendered, fetch via API and populate
    var hasUsable = false;
    try {
      var opts = moveCategorySelect.options;
      if (opts && opts.length) {
        for (var i=0;i<opts.length;i++) {
          var o = opts[i];
          if (o.disabled) continue;
          if (!o.value) continue;
          hasUsable = true; break;
        }
      }
    } catch(_) {}
    if (!hasUsable) {
      try {
        fetch('/api/files/categories', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }})
          .then(function(r){ return r.json(); })
          .then(function(j){
            if (j && j.status === 'success' && Array.isArray(j.items)) {
              moveCategorySelect.innerHTML = '';
              j.items.forEach(function(cat){
                var opt = document.createElement('option');
                opt.value = String(cat.id);
                opt.textContent = String(cat.name || '');
                try {
                  var subsMap = {};
                  (cat.subs || []).forEach(function(s){ subsMap[String(s.id)] = s.name; });
                  opt.setAttribute('data-subs', JSON.stringify(subsMap));
                } catch(_) {}
                moveCategorySelect.appendChild(opt);
              });
              if (moveCategorySelect.options.length > 0) {
                moveCategorySelect.selectedIndex = 0;
                updateSubcategoriesForMove(moveCategorySelect);
              }
            }
          })
          .catch(function(){});
      } catch(_) {}
    } else {
      // Initialize subcategories when modal opens
      if (moveCategorySelect.selectedIndex >= 0) {
        updateSubcategoriesForMove(moveCategorySelect);
      }
    }
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'setupMoveModal');
  }
}

/**
 * Update subcategories list when category is selected
 * @param {HTMLSelectElement} categorySelect - The category select element
 */
function updateSubcategoriesForMove(categorySelect) {
  try {
    const subSelect = document.getElementById('move-target-sub');
    if (!subSelect) return;

    const selectedOption = categorySelect.options[categorySelect.selectedIndex];
    if (!selectedOption) return;

    // Get subs data from data attribute
    let subs = {};
    try {
      subs = JSON.parse(selectedOption.getAttribute('data-subs') || '{}');
    } catch (e) {
      subs = {};
    }

    // Get current file's category and subcategory IDs
    const currentCatId = window.current_category_id || 0;
    const currentSubId = window.current_subcategory_id || 0;
    const selectedCatId = parseInt(selectedOption.value) || 0;

    // Populate function
    function populate(subMap) {
      subSelect.innerHTML = '';
      const entries = Object.entries(subMap || {});
      entries.forEach(function([subId, subName]){
        const subIdNum = parseInt(subId) || 0;
        if (selectedCatId === currentCatId && subIdNum === currentSubId) return;
        const option = document.createElement('option');
        option.value = String(subIdNum);
        option.textContent = String(subName || '');
        subSelect.appendChild(option);
      });
      if (subSelect.options.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.disabled = true;
        option.textContent = 'Нет доступных подкатегорий';
        subSelect.appendChild(option);
      }
    }

    // If inline data is empty, fetch from API
    if (!subs || Object.keys(subs).length === 0) {
      try {
        fetch('/api/files/subcategories?category_id=' + encodeURIComponent(selectedCatId), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }})
          .then(function(r){ return r.json(); })
          .then(function(j){
            if (j && j.status === 'success' && Array.isArray(j.items)) {
              var map = {};
              j.items.forEach(function(it){ map[String(it.id)] = it.name; });
              populate(map);
            } else {
              populate(subs || {});
            }
          })
          .catch(function(){ populate(subs || {}); });
      } catch(_) {
        populate(subs || {});
      }
    } else {
      populate(subs);
    }
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'updateSubcategoriesForMove');
  }
}

/**
 * Setup popup values to exclude current category/subcategory
 */
function setupMovePopupValues() {
  try {
    const moveCategorySelect = document.getElementById('move-target-root');
    if (!moveCategorySelect) return;

    const currentCatId = window.current_category_id || 0;
    const currentSubId = window.current_subcategory_id || 0;

    // Do not hide categories; we only exclude the current subcategory from choices

    // Pick first category that has at least one available subcategory (excluding current)
    let picked = false;
    for (let i = 0; i < moveCategorySelect.options.length; i++) {
      const opt = moveCategorySelect.options[i];
      if (opt.style.display === 'none') continue;
      let subs = {};
      try { subs = JSON.parse(opt.getAttribute('data-subs') || '{}'); } catch(_) { subs = {}; }
      // Count subs excluding current when same category
      const catId = parseInt(opt.value) || 0;
      const avail = Object.keys(subs).filter(function(k){
        const sid = parseInt(k)||0;
        return !(catId === currentCatId && sid === currentSubId);
      });
      if (avail.length > 0) {
        moveCategorySelect.selectedIndex = i;
        picked = true;
        break;
      }
    }
    // If nothing suitable found, keep current selection
    updateSubcategoriesForMove(moveCategorySelect);
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'setupMovePopupValues');
  }
}

// Run setup when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    setupMoveModal();
    
    // Setup on modal open
    const moveModal = document.getElementById('popup-move');
    if (moveModal) {
      // Observe modal visibility
      const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const style = moveModal.getAttribute('style') || '';
            if (style.includes('block') || moveModal.classList.contains('active')) {
              setupMovePopupValues();
            }
          }
        });
      });
      
      observer.observe(moveModal, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    
    setupMoveModal();
  });
} else {
  setupMoveModal();
  
  // Setup on modal open
  const moveModal = document.getElementById('popup-move');
  if (moveModal) {
    // Observe modal visibility
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          const style = moveModal.getAttribute('style') || '';
          if (style.includes('block') || moveModal.classList.contains('active')) {
            setupMovePopupValues();
          }
        }
      });
    });
    
    observer.observe(moveModal, { attributes: true, attributeFilter: ['style', 'class'] });
  }
}

// Export functions
window.FilesMoveHandler = {
  setupMoveModal,
  updateSubcategoriesForMove,
  setupMovePopupValues,
};

