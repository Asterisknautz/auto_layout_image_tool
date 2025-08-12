/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
let coepCredentialless = false;
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
    self.addEventListener("message", event => {
        if (event.data && event.data.type === "COEP_CREDENTIALLESS") {
            coepCredentialless = true;
        }
    });
    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
            return;
        }
        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, {
                credentials: "omit",
            })
            : r;
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.status === 0) {
                        return response;
                    }
                    const newHeaders = new Headers(response.headers);
                    newHeaders.set("Cross-Origin-Embedder-Policy", 
                        coepCredentialless ? "credentialless" : "require-corp"
                    );
                    if (!newHeaders.has("Cross-Origin-Opener-Policy")) {
                        newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
                    }
                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch(e => console.error(e))
        );
    });
} else {
    (() => {
        const reloadedByCoiServiceWorker = window.sessionStorage.getItem("coiReloadedByCoiServiceWorker");
        window.sessionStorage.removeItem("coiReloadedByCoiServiceWorker");
        const coepDegrading = (reloadedByCoiServiceWorker == "coepdegrade");
        
        const params = new URLSearchParams(location.search);
        const coepCredentialless = !params.has("nocredentialless");
        
        if (typeof SharedArrayBuffer !== "undefined") {
            // SharedArrayBuffer is present, no need for COI service worker
            return;
        }
        
        const currentScript = document.currentScript;
        function loadCoiServiceWorker() {
            const newWorker = new Worker(window.location.origin + currentScript.src, {
                type: 'module'
            });
            
            navigator.serviceWorker.register(window.location.origin + currentScript.src)
                .then(registration => {
                    if (registration.active && !navigator.serviceWorker.controller) {
                        window.sessionStorage.setItem("coiReloadedByCoiServiceWorker", "coepdegrade");
                        window.location.reload();
                    }
                    registration.addEventListener("updatefound", () => {
                        window.sessionStorage.setItem("coiReloadedByCoiServiceWorker", "coepdegrade");
                        window.location.reload();
                    });
                    
                    if (coepCredentialless) {
                        registration.active?.postMessage({type: "COEP_CREDENTIALLESS"});
                    }
                })
                .catch(() => {
                    // Service worker registration failed
                });
        }
        
        if ("serviceWorker" in navigator) {
            loadCoiServiceWorker();
        }
    })();
}