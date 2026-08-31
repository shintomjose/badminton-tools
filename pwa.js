/* PWA-Bootstrap — bewusst eigenständig gehalten (kein Eingriff in app.js):
 * Head-Tags (Manifest, Theme-Color, iOS-Icons) werden hier injiziert,
 * damit index.html nur eine einzige Script-Zeile braucht. */
"use strict";

(function () {
  /* ---- Head-Tags injizieren ---- */
  function addTag(tag, attrs) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.head.appendChild(el);
    return el;
  }

  addTag("link", { rel: "manifest", href: "manifest.webmanifest" });
  addTag("meta", { name: "theme-color", content: "#0C1210" });
  addTag("link", { rel: "apple-touch-icon", href: "icons/apple-touch-icon.png" });
  addTag("meta", { name: "mobile-web-app-capable", content: "yes" });
  addTag("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
  addTag("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" });
  addTag("meta", { name: "apple-mobile-web-app-title", content: "Badminton" });

  /* ---- Offline-Anzeige ---- */
  const style = document.createElement("style");
  style.textContent = `
    #pwaOffline {
      position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
      background: #E3B341; color: #04221C; font: 600 13px/1 system-ui, sans-serif;
      padding: 8px 14px; border-radius: 999px; z-index: 9999;
      box-shadow: 0 4px 14px rgba(0,0,0,.35); pointer-events: none;
    }
    #pwaUpdate {
      position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
      background: #00FACD; color: #04221C; font: 600 13px/1 system-ui, sans-serif;
      padding: 10px 16px; border: 0; border-radius: 999px; z-index: 9999;
      cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.35);
    }
  `;
  document.head.appendChild(style);

  let offlineEl = null;
  function renderOnlineState() {
    if (!navigator.onLine && !offlineEl) {
      offlineEl = document.createElement("div");
      offlineEl.id = "pwaOffline";
      offlineEl.textContent = "⚡ Offline — Änderungen werden nicht geteilt";
      document.body.appendChild(offlineEl);
    } else if (navigator.onLine && offlineEl) {
      offlineEl.remove();
      offlineEl = null;
    }
  }
  window.addEventListener("online", renderOnlineState);
  window.addEventListener("offline", renderOnlineState);
  renderOnlineState();

  /* ---- Service Worker + Update-Flow ---- */
  if (!("serviceWorker" in navigator)) return;

  function showUpdateButton(worker) {
    if (document.getElementById("pwaUpdate")) return;
    const btn = document.createElement("button");
    btn.id = "pwaUpdate";
    btn.textContent = "⬆ Neue Version verfügbar — Aktualisieren";
    btn.addEventListener("click", () => {
      btn.disabled = true;
      worker.postMessage("SKIP_WAITING");
    });
    document.body.appendChild(btn);
  }

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateButton(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateButton(nw);
          }
        });
      });
    } catch (e) {
      console.warn("[PWA] Service Worker Registrierung fehlgeschlagen:", e);
    }
  });
})();
