(function(){
  'use strict';
  if (!window.io) return;
  try {
    var forced = false; // stop emission after forced logout
    var presenceTimer = null;
    var heartbeatTimer = null;
    // Reuse a single app-wide socket if available
    var sock = window.socket;
    if (!sock) {
      sock = window.io(window.location.origin, { transports: ['websocket','polling'], path: '/socket.io/', withCredentials: true });
      window.socket = sock;
    }

    function emitPresence(){
      if (forced) return;
      try { sock.emit('presence:update', { page: location.pathname + location.search + location.hash }); } catch(_) {}
    }

    sock.on && sock.on('connect', function(){ emitPresence(); });
    // Support admin-force logout for every open session
    sock.on && sock.on('force-logout', function(){
      try { forced = true; } catch(_) {}
      try { if (presenceTimer) clearInterval(presenceTimer); } catch(_) {}
      try { if (heartbeatTimer) clearInterval(heartbeatTimer); } catch(_) {}
      try { sock && sock.disconnect && sock.disconnect(); } catch(_) {}
      try { location.replace('/logout'); } catch(_) {}
    });
    document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible') emitPresence(); });
    window.addEventListener('focus', emitPresence);
    window.addEventListener('hashchange', emitPresence);
    window.addEventListener('popstate', emitPresence);
    presenceTimer = setInterval(emitPresence, 5000);

    // HTTP heartbeat for idle tabs (covers cases when socket events are throttled)
    function httpHeartbeat(){
      if (forced) return;
      try {
        fetch('/presence/heartbeat', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: location.pathname + location.search + location.hash })
        }).then(function(r){
          try {
            if (r && (r.status === 401 || r.status === 403)) {
              forced = true;
              try { if (presenceTimer) clearInterval(presenceTimer); } catch(_) {}
              try { if (heartbeatTimer) clearInterval(heartbeatTimer); } catch(_) {}
              try { sock && sock.disconnect && sock.disconnect(); } catch(_) {}
              location.replace('/logout');
            }
          } catch(_) {}
        }).catch(function(){});
      } catch(_) {}
    }
    heartbeatTimer = setInterval(httpHeartbeat, 5000);

    // Initial
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', emitPresence);
    } else {
      emitPresence();
    }
  } catch(_) {}
})();


