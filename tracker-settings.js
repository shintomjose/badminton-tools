/* =====================================================================
 * Match Tracker — settings view (venues)
 *
 * Reached through the gear button in the tracker top bar; not a sub-tab.
 * Manages the `locations` collection: add, rename, delete, pick the
 * default. The entry view's venue dropdown reads the same list, so a
 * change here shows up on the next mount of the entry view.
 *
 * Renaming does not rewrite history: sessions and matches keep the
 * venue name they were written with (same rule as a player's club).
 * ===================================================================== */
"use strict";

Object.assign(EN, {
  "Einstellungen": "Settings",
  "Orte": "Venues",
  "Zurück": "Back",
  "Standard": "Default",
  "Als Standard": "Set as default",
  "Umbenennen": "Rename",
  "Ort löschen": "Delete venue",
  "Neuer Ort": "New venue",
  "Hinzufügen": "Add",
  "Speichern": "Save",
  "Abbrechen": "Cancel",
  "Name eingeben": "Enter a name",
  "Ort hinzugefügt": "Venue added",
  "Ort umbenannt": "Venue renamed",
  "Ort gelöscht": "Venue deleted",
  "Standard-Ort gesetzt": "Default venue set",
  "„{0}“ löschen? Gespeicherte Spiele behalten ihren Ort.": "Delete “{0}”? Saved matches keep their venue.",
  "Der Standard-Ort kann nicht gelöscht werden — erst einen anderen wählen.": "The default venue cannot be deleted — pick another one first.",
  "Der Standard-Ort wird bei jedem Training vorausgewählt. Umbenennen ändert alte Spiele nicht.":
    "The default venue is preselected on every training day. Renaming does not change old matches.",
  "Orte nicht ladbar": "Venues could not be loaded",
});

(function () {
  if (typeof MT === "undefined") return;

  const ICON_EDIT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
  const ICON_STAR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.4l-5.7 3.1 1.2-6.4L2.8 9.7l6.4-.8Z"/></svg>';
  const ICON_STAR_FILL = ICON_STAR.replace('fill="none"', 'fill="currentColor"');

  const state = {
    host: null,
    locations: [],
    loaded: false,
    error: null,
    editingId: null,      // row whose name is being edited
    busy: false,          // one write at a time — a double tap must not duplicate
  };

  function iconBtn(act, id, label, svg, extraCls) {
    return '<button type="button" class="btn mt-icon-btn' + (extraCls ? " " + extraCls : "") + '"' +
      ' data-act="' + act + '" data-id="' + esc(id) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
      svg + "</button>";
  }

  function rowHtml(l) {
    if (state.editingId === l.id) {
      return '<li class="mts-row editing" data-id="' + esc(l.id) + '">' +
        '<form class="mts-rename" data-id="' + esc(l.id) + '">' +
          '<input type="text" value="' + esc(l.name) + '" autocomplete="off" aria-label="' + esc(t("Umbenennen")) + '">' +
          '<button type="submit" class="btn primary">' + esc(t("Speichern")) + "</button>" +
          '<button type="button" class="btn" data-act="cancel">' + esc(t("Abbrechen")) + "</button>" +
        "</form>" +
      "</li>";
    }
    return '<li class="mts-row" data-id="' + esc(l.id) + '">' +
      '<span class="mts-name">' + esc(l.name) +
        (l.isDefault ? ' <span class="mt-badge trn">' + esc(t("Standard")) + "</span>" : "") +
      "</span>" +
      '<span class="mts-tools">' +
        iconBtn("default", l.id, t("Als Standard"), l.isDefault ? ICON_STAR_FILL : ICON_STAR, l.isDefault ? "is-default" : "") +
        iconBtn("rename", l.id, t("Umbenennen"), ICON_EDIT, "") +
        iconBtn("delete", l.id, t("Ort löschen"), ICON_TRASH, "mt-danger") +
      "</span>" +
    "</li>";
  }

  function render() {
    const host = state.host;
    if (!host) return;
    let body;
    if (!state.loaded) body = '<p class="mt-muted">' + esc(t("Laden …")) + "</p>";
    else if (state.error) body = '<p class="mt-muted">' + esc(t("Orte nicht ladbar")) + "</p>";
    else body =
      '<ul class="mts-list">' + state.locations.map(rowHtml).join("") + "</ul>" +
      '<form class="add-form mts-add">' +
        '<input type="text" placeholder="' + esc(t("Neuer Ort")) + '" autocomplete="off" aria-label="' + esc(t("Neuer Ort")) + '">' +
        '<button type="submit" class="btn">' + esc(t("Hinzufügen")) + "</button>" +
      "</form>";
    host.innerHTML =
      '<section class="panel mt-card mts-panel">' +
        '<div class="mt-trn-head">' +
          "<h2>" + esc(t("Orte")) + "</h2>" +
          '<button type="button" class="btn small" data-act="back">' + esc(t("Zurück")) + "</button>" +
        "</div>" +
        '<p class="mt-muted">' + esc(t("Der Standard-Ort wird bei jedem Training vorausgewählt. Umbenennen ändert alte Spiele nicht.")) + "</p>" +
        body +
      "</section>";
  }

  async function load() {
    state.error = null;
    try {
      state.locations = await MT.repo.listLocations();
      state.loaded = true;
    } catch (e) {
      state.loaded = true;
      state.error = e;
      MT.toastError(e, "Laden fehlgeschlagen");
    }
    render();
  }

  function byId(id) { return state.locations.find(l => l.id === id) || null; }

  async function run(fn, doneMsg) {
    if (state.busy) return;
    state.busy = true;
    try {
      await fn();
      if (doneMsg) toast(t(doneMsg));
    } catch (e) {
      MT.toastError(e, "Speichern fehlgeschlagen");
    } finally {
      state.busy = false;
      render();
    }
  }

  function onClick(e) {
    if (!e.target || typeof e.target.closest !== "function") return;
    const btn = e.target.closest("[data-act]");
    if (!btn || !state.host || !state.host.contains(btn)) return;
    const act = btn.dataset.act, id = btn.dataset.id;
    if (act === "back") { MT.showView("entry"); return; }
    if (act === "cancel") { state.editingId = null; render(); return; }
    if (act === "rename") {
      state.editingId = id;
      render();
      const inp = state.host.querySelector('.mts-rename[data-id="' + id + '"] input');
      if (inp) { inp.focus(); inp.select(); }
      return;
    }
    if (act === "default") {
      const l = byId(id);
      if (!l || l.isDefault) return;
      run(async () => {
        await MT.repo.setDefaultLocation(id);
        state.locations.forEach(x => { x.isDefault = x.id === id; });
        state.locations = await MT.repo.listLocations().catch(() => state.locations);
      }, "Standard-Ort gesetzt");
      return;
    }
    if (act === "delete") {
      const l = byId(id);
      if (!l) return;
      if (l.isDefault) { toast(t("Der Standard-Ort kann nicht gelöscht werden — erst einen anderen wählen.")); return; }
      if (!window.confirm(tt("„{0}“ löschen? Gespeicherte Spiele behalten ihren Ort.", l.name))) return;
      run(async () => {
        await MT.repo.deleteLocation(id);
        state.locations = state.locations.filter(x => x.id !== id);
      }, "Ort gelöscht");
      return;
    }
  }

  function onSubmit(e) {
    const form = e.target && typeof e.target.closest === "function" ? e.target.closest("form") : null;
    if (!form || !state.host || !state.host.contains(form)) return;
    e.preventDefault();
    const inp = form.querySelector("input");
    const name = String(inp && inp.value || "").trim();
    if (!name) { toast(t("Name eingeben")); if (inp) inp.focus(); return; }

    if (form.classList.contains("mts-add")) {
      run(async () => {
        const id = await MT.repo.addLocation(name, { isDefault: !state.locations.length });
        state.locations = state.locations.concat([{ id: id, name: name, isDefault: !state.locations.length }]);
      }, "Ort hinzugefügt");
      return;
    }
    if (form.classList.contains("mts-rename")) {
      const id = form.dataset.id;
      const l = byId(id);
      if (!l) return;
      if (name === l.name) { state.editingId = null; render(); return; }
      run(async () => {
        await MT.repo.updateLocation(id, { name: name });
        l.name = name;
        state.editingId = null;
      }, "Ort umbenannt");
      return;
    }
  }

  MT.registerView("settings", {
    label: t("Einstellungen"),
    hidden: true,                      // reached via the gear, not the sub-tabs
    mount: function (host) {
      state.host = host;
      state.editingId = null;
      host.addEventListener("click", onClick);
      host.addEventListener("submit", onSubmit);
      render();
      load();
    },
    unmount: function () {
      if (state.host) {
        state.host.removeEventListener("click", onClick);
        state.host.removeEventListener("submit", onSubmit);
      }
      state.host = null;
    },
  });
})();
