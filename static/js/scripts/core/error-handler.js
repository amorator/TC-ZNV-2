// Error Handler Module
// Централизованная обработка ошибок

function handleError(err, context) {
  try {
    // Suppress benign aborts (e.g., background refresh cancelled on navigation/visibility)
    try {
      const name = (err && err.name) || '';
      const msg = (err && err.message) || (err && String(err)) || '';
      const lower = String(msg).toLowerCase();
      if (name === 'AbortError' ||
          lower.includes('signal is aborted') ||
          lower.includes('the user aborted a request') ||
          lower.includes('aborted') ||
          lower.includes('aborterror')) {
        return; // do not toast on aborted background requests
      }
    } catch (_) {}

    let errorMessage = err.message || err.toString();
    // Normalize common HTTP errors to friendly Russian messages
    try {
      const lower = String(errorMessage).toLowerCase();
      if (lower.startsWith('http 429') || lower.includes('too many requests')) {
        errorMessage = 'Слишком частые запросы. Попробуйте позже.';
      } else if (lower.startsWith('http 503') || lower.includes('service temporarily unavailable')) {
        errorMessage = 'Сервис временно недоступен. Попробуйте позже.';
      }
    } catch (_) {}
    const fullMessage = context
      ? `Ошибка выполнения (${context}): ${errorMessage}`
      : `Ошибка выполнения: ${errorMessage}`;

    if (window.showToast) {
      window.showToast(errorMessage, "error");
    }
  } catch (e) {
    // Silently handle errors in error handler to avoid infinite loops
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
