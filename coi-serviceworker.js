/*! coi-serviceworker v0.1.6 - Guido Zuidhof, licensed under MIT */
let coepCredentialless = false;
if (typeof window === 'undefined') {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
  self.addEventListener("message", event => {
    if (event.data && event.data.type === "GET_CLIENT_ID")
      event.ports[0].postMessage(self.registration.scope);
  });
  self.addEventListener("fetch", event => {
    const r = event.request;
    if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;
    const request = (
      coepCredentialless && r.mode === "no-cors"
        ? new Request(r, { credentials: "omit" })
        : r
    );
    event.respondWith(
      fetch(request).then(response => {
        if (response.status === 0) return response;
        const newHeaders = new Headers(response.headers);
        newHeaders.set("Cross-Origin-Embedder-Policy",
          coepCredentialless ? "credentialless" : "require-corp");
        if (!coepCredentialless) newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }).catch(e => console.error(e))
    );
  });
} else {
  (() => {
    const reloadTries = (() => {
      const stored = localStorage.getItem("coiReloadTries");
      return stored ? parseInt(stored) : 0;
    })();
    if (reloadTries > 2) return; // Reduce reload attempts
    const coepDegraded = (crossOriginIsolated !== true && typeof SharedArrayBuffer !== "undefined");
    if (!coepDegraded && !window.SharedArrayBuffer) {
      localStorage.setItem("coiReloadTries", (reloadTries + 1).toString());
      location.reload();
    }
    if (!coepDegraded) localStorage.removeItem("coiReloadTries");
    if (!crossOriginIsolated && typeof SharedArrayBuffer === "undefined") {
      coepCredentialless = true;
    }
    navigator.serviceWorker && navigator.serviceWorker.register("/imagetool/coi-serviceworker.js")
      .then(registration => {
        registration.addEventListener("updatefound", () => location.reload());
        if (registration.active && !navigator.serviceWorker.controller)
          location.reload();
      });
  })();
}