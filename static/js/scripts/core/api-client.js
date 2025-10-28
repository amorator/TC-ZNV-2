// API Client Module
// Централизованная работа с API

async function apiRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isJson = contentType.includes('application/json');

    if (!response.ok) {
      if (isJson) {
        try {
          const data = await response.json();
          const msg = data && (data.message || data.error) ? (data.message || data.error) : `${response.statusText}`;
          throw new Error(msg || `HTTP ${response.status}`);
        } catch (_) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (isJson) {
      return await response.json();
    }
    // Fallback: treat plain text as error-friendly message
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(
        err,
        `API ${options.method || "GET"} ${url}`
      );
    }
    throw err;
  }
}

async function apiGet(url) {
  return apiRequest(url, { method: "GET" });
}

async function apiPost(url, data) {
  return apiRequest(url, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function apiPut(url, data) {
  return apiRequest(url, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

async function apiDelete(url) {
  return apiRequest(url, { method: "DELETE" });
}

async function apiUpload(url, formData) {
  try {
    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, `Upload to ${url}`);
    }
    throw err;
  }
}

// Export functions to global scope
window.ApiClient = {
  apiRequest,
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  apiUpload,
};
