// Error Handler Module
// Централизованная обработка ошибок

function handleError(err, context) {
  try {
    const errorMessage = err.message || err.toString();
    const fullMessage = context
      ? `Ошибка выполнения (${context}): ${errorMessage}`
      : `Ошибка выполнения: ${errorMessage}`;

    if (window.showToast) {
      // Show only the error message, not the full message with context
      window.showToast(errorMessage, "error");
    } else {
      console.error(fullMessage);
    }
  } catch (e) {
    console.error("Критическая ошибка в обработчике ошибок:", e);
  }
}

async function handleApiError(response, context) {
  try {
    if (!response.ok) {
      // Try to get error message from JSON response
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      
      try {
        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes('application/json')) {
          const data = await response.clone().json();
          if (data && data.message) {
            errorMessage = data.message;
          } else if (data && data.error) {
            errorMessage = data.error;
          }
        }
      } catch (jsonErr) {
        // If JSON parsing fails, use default message
      }
      
      handleError(new Error(errorMessage), context);
      return true;
    }
    return false;
  } catch (err) {
    handleError(err, "handleApiError");
    return true;
  }
}

function wrapAsync(asyncFn, context) {
  return async function (...args) {
    try {
      return await asyncFn.apply(this, args);
    } catch (err) {
      handleError(err, context);
      throw err;
    }
  };
}

function wrapSync(fn, context) {
  return function (...args) {
    try {
      return fn.apply(this, args);
    } catch (err) {
      handleError(err, context);
      throw err;
    }
  };
}

// Export functions to global scope
window.ErrorHandler = {
  handleError,
  handleApiError,
  wrapAsync,
  wrapSync,
};
