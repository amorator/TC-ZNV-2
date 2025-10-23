// Error Handler Module
// Централизованная обработка ошибок

function handleError(err, context) {
  try {
    const errorMessage = err.message || err.toString();
    const fullMessage = context
      ? `Ошибка выполнения (${context}): ${errorMessage}`
      : `Ошибка выполнения: ${errorMessage}`;

    if (window.showToast) {
      window.showToast(fullMessage, "error");
    } else {
      console.error(fullMessage);
    }
  } catch (e) {
    console.error("Критическая ошибка в обработчике ошибок:", e);
  }
}

function handleApiError(response, context) {
  try {
    if (!response.ok) {
      const message = `HTTP ${response.status}: ${response.statusText}`;
      handleError(new Error(message), context);
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
