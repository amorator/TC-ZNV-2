// Configuration Module
// Работа с конфигурацией из config.ini

let configCache = null;

async function loadConfig() {
  if (configCache) {
    return configCache;
  }

  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    configCache = await response.json();
    return configCache;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "loadConfig");
    } else {
      console.error("Ошибка загрузки конфигурации:", err);
    }
    // Fallback к значениям по умолчанию
    return getDefaultConfig();
  }
}

function getDefaultConfig() {
  return {
    files: {
      max_size_mb: 10,
      max_upload_files: 5,
      max_parallel_uploads: 3,
      allowed_types: ["audio/*", "video/*"],
    },
    web: {
      min_password_length: 1,
      session_lifetime: 86400,
    },
  };
}

function getFileConfig() {
  return configCache?.files || getDefaultConfig().files;
}

function getWebConfig() {
  return configCache?.web || getDefaultConfig().web;
}

function getMaxFileSizeBytes() {
  const config = getFileConfig();
  return (config.max_size_mb || 10) * 1024 * 1024;
}

function getMaxUploadFiles() {
  const config = getFileConfig();
  return config.max_upload_files || 5;
}

function getMaxParallelUploads() {
  const config = getFileConfig();
  return config.max_parallel_uploads || 3;
}

function getAllowedFileTypes() {
  const config = getFileConfig();
  if (config.allowed_types) {
    // Parse comma-separated string from config.ini
    return config.allowed_types.split(",").map((type) => type.trim());
  }
  return getDefaultConfig().files.allowed_types;
}

function getMinPasswordLength() {
  const config = getWebConfig();
  return config.min_password_length || 1;
}

function getSessionLifetime() {
  const config = getWebConfig();
  return config.session_lifetime || 86400;
}

function getReconnectInterval() {
  const config = getWebConfig();
  return config.reconnect_interval || 5; // Fallback to 5 seconds
}

// Export functions to global scope
window.Config = {
  loadConfig,
  getFileConfig,
  getWebConfig,
  getMaxFileSizeBytes,
  getMaxUploadFiles,
  getMaxParallelUploads,
  getAllowedFileTypes,
  getMinPasswordLength,
  getSessionLifetime,
  getReconnectInterval,
  getDefaultConfig,
};

// Auto-load config on page load
document.addEventListener("DOMContentLoaded", () => {
  // Defer config loading to avoid blocking DOMContentLoaded
  if (window.requestIdleCallback) {
    window.requestIdleCallback(
      () => {
        loadConfig();
      },
      { timeout: 2000 }
    ); // Add timeout to prevent indefinite delay
  } else {
    setTimeout(() => {
      if (window.requestIdleCallback) {
        window.requestIdleCallback(
          () => {
            loadConfig();
          },
          { timeout: 2000 }
        );
      } else {
        loadConfig();
      }
    }, 0);
  }
});
