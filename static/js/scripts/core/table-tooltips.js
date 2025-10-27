/**
 * Table Tooltips Module
 * Automatically adds tooltips to table cells with truncated/overflow content
 * 
 * @namespace TableTooltips
 */

(function() {
  'use strict';

  /**
   * Initialize tooltips for all table cells
   * Checks if cell content is truncated and adds a title attribute
   */
  function initTableTooltips() {
    // Find all table cells
    const cells = document.querySelectorAll('table td[role="cell"]');
    
    cells.forEach(cell => {
      // Check if content is horizontally truncated
      if (cell.scrollWidth > cell.clientWidth) {
        // Get the text content (excluding HTML elements like icons, buttons)
        const text = getTextContent(cell);
        if (text && text.trim()) {
          cell.setAttribute('title', text);
          cell.classList.add('cell-tooltip');
        }
      }
    });
  }

  /**
   * Get plain text content from a cell, filtering out interactive elements
   * @param {HTMLElement} cell - The table cell element
   * @returns {string} Plain text content
   */
  function getTextContent(cell) {
    // Clone the cell to avoid modifying the original
    const clone = cell.cloneNode(true);
    
    // Remove interactive elements (buttons, links, inputs, icons, etc.)
    const elementsToRemove = clone.querySelectorAll('button, a, input, select, textarea, .bi, i.bi, .btn, .badge, .icon, [data-testid], .note-badge, .permissions-list, .perms-cell');
    elementsToRemove.forEach(el => el.remove());
    
    // Return the text content
    return clone.textContent.trim();
  }

  /**
   * Initialize tooltips and observe DOM changes
   */
  function setup() {
    // Initial setup
    initTableTooltips();
    
    // Observe changes to table bodies (for dynamic content loading)
    const tableBodies = document.querySelectorAll('table tbody');
    
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          shouldUpdate = true;
        }
      });
      
      if (shouldUpdate) {
        initTableTooltips();
      }
    });
    
    tableBodies.forEach(tbody => {
      observer.observe(tbody, {
        childList: true,
        subtree: false
      });
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }

  // Export for external use
  window.TableTooltips = {
    init: initTableTooltips
  };

})();

