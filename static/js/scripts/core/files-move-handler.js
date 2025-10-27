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

    // Initialize subcategories when modal opens
    if (moveCategorySelect.selectedIndex >= 0) {
      updateSubcategoriesForMove(moveCategorySelect);
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

    // Clear existing options
    subSelect.innerHTML = '';

    // Add subcategory options
    if (Object.keys(subs).length > 0) {
      for (const [subId, subName] of Object.entries(subs)) {
        const subIdNum = parseInt(subId) || 0;
        
        // Skip current subcategory
        if (selectedCatId === currentCatId && subIdNum === currentSubId) {
          continue;
        }
        
        const option = document.createElement('option');
        option.value = subId;
        option.textContent = subName;
        subSelect.appendChild(option);
      }
      
      // If no subcategories available, show message
      if (subSelect.options.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.disabled = true;
        option.textContent = 'Нет доступных подкатегорий';
        subSelect.appendChild(option);
      }
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.disabled = true;
      option.textContent = 'Нет подкатегорий';
      subSelect.appendChild(option);
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

    // Hide current category if it has only one subcategory
    if (moveCategorySelect.options.length > 0) {
      for (let i = 0; i < moveCategorySelect.options.length; i++) {
        const option = moveCategorySelect.options[i];
        const catId = parseInt(option.value) || 0;
        
        if (catId === currentCatId) {
          try {
            const subs = JSON.parse(option.getAttribute('data-subs') || '{}');
            // If this is current category and it has only one subcategory, hide it
            if (Object.keys(subs).length === 1 && parseInt(Object.keys(subs)[0]) === currentSubId) {
              option.style.display = 'none';
            }
          } catch (e) {
            // Continue if parsing fails
          }
        }
      }
    }

    // Initialize subcategories for first visible category
    if (moveCategorySelect.selectedIndex >= 0) {
      updateSubcategoriesForMove(moveCategorySelect);
    }
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

