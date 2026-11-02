/* travel-google-route-map: v2 — cached road geometry and one optional nearby layer. */
(function (global) {
  "use strict";
  const waitForMaps = (timeoutMs = 12000) => new Promise((resolve, reject) => {
    const end = Date.now() + timeoutMs;
    const check = () => global.google?.maps?.Map ? resolve(global.google.maps)
      : Date.now() >= end ? reject(new Error("google-api-unavailable")) : global.setTimeout(check, 60);
    check();
  });
  const waitForTiles = (maps, map, timeoutMs = 10000) => new Promise((resolve, reject) => {
    let done = false, listener;
    const finish = (callback, value) => {
      if (done) return;
      done = true; global.clearTimeout(timer);
      if (listener) maps.event.removeListener(listener);
      callback(value);
    };
    const timer = global.setTimeout(() => finish(reject, new Error("google-tiles-timeout")), timeoutMs);
    listener = maps.event.addListenerOnce(map, "tilesloaded", () => finish(resolve));
  });
  function decodePolyline(encoded) {
    const path = []; let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
      const read = () => {
        let result = 0, shift = 0, byte;
        do {
          if (index >= encoded.length) throw new Error("invalid-road-polyline");
          byte = encoded.charCodeAt(index++) - 63;
          result |= (byte & 31) << shift; shift += 5;
          if (shift > 30) throw new Error("invalid-road-polyline");
        } while (byte >= 32);
        return result & 1 ? ~(result >> 1) : result >> 1;
      };
      lat += read(); lng += read();
      const point = { lat: lat / 1e5, lng: lng / 1e5 };
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) throw new Error("invalid-road-polyline");
      path.push(point);
    }
    if (path.length < 2) throw new Error("invalid-road-polyline");
    return path;
  }
  const quietStyle = () => {
    const css = global.getComputedStyle?.(document.body);
    const color = (name, fallback) => css?.getPropertyValue(name)?.trim() || fallback;
    return [
    { featureType: "landscape", elementType: "geometry", stylers: [{ color: color("--guide-page", "#f2f6f2") }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: color("--guide-page-soft", "#d7e9e5") }] },
    { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { featureType: "poi.business", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: color("--guide-page-soft", "#e6ebe5") }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: color("--guide-on-light-muted", "#667a78") }] },
    { featureType: "administrative", elementType: "labels.text.fill", stylers: [{ color: color("--guide-on-light-muted", "#708280") }] }
    ];
  };
  const instances = new WeakMap();
  async function createMap(options) {
    const maps = await waitForMaps(options.timeoutMs);
    const { data, root, status, overlay } = options;
    if (!root || !data?.places || !data?.days) throw new Error("invalid-map-data");
    const byId = new Map(data.places.map(place => [place.id, place]));
    const point = place => ({ lat: Number(place.coordinates.latitude), lng: Number(place.coordinates.longitude) });
    const themeColor = () => global.getComputedStyle?.(document.body)?.getPropertyValue("--guide-action")?.trim() || "#176f6a";
    const nearbyColor = () => global.getComputedStyle?.(document.body)?.getPropertyValue("--guide-map-candidate")?.trim() || "#c77b3e";
    const titleOf = place => place.localName && place.localName !== place.name ? place.name + " / " + place.localName : place.name;
    const setStatus = message => { if (status) { status.textContent = message; status.hidden = !message; } };
    const markerIcon = (color, selected = false) => ({ path: maps.SymbolPath.CIRCLE, scale: selected ? 12 : 8, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: selected ? 3 : 2 });
    const escape = value => String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    const focusFormal = id => {
      const nodes = [...document.querySelectorAll("[data-place-id]")].filter(node => node.dataset.placeId === id);
      const target = nodes.find(node => !node.closest(".day[hidden]")) || nodes[0];
      if (!target) return;
      const day = target.closest("[data-day-panel]");
      if (day?.hidden) document.querySelector(`[data-day-tab="${day.dataset.dayPanel}"]`)?.click();
      const reduced = global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
      target.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "center" });
      target.classList.add("is-map-focused");
      global.setTimeout(() => target.classList.remove("is-map-focused"), 1800);
    };
    const map = new maps.Map(root, { center: { lat: 0, lng: 0 }, zoom: 4, styles: quietStyle(), clickableIcons: false, gestureHandling: "cooperative", mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
    const info = new maps.InfoWindow();
    const selectedDayKey = () => { const day = document.querySelector('[data-day-tab][aria-selected="true"]')?.dataset.dayTab; return day ? `day-${day}` : data.days[0]?.key; };
    let activeKey = selectedDayKey(), overlays = [], nearbyMarkers = [], nearbyVisible = false, locationMarker = null;
    const bindings = [];
    const documentHandlers = new Map();
    const bind = (node, name, fn) => { node.addEventListener(name, fn); bindings.push([node, name, fn]); if (node === document) documentHandlers.set(name, fn); };
    const clear = () => { overlays.forEach(layer => { maps.event.clearInstanceListeners?.(layer); layer.setMap?.(null); }); overlays = []; nearbyMarkers = []; info.close?.(); };
    const popup = (marker, place) => {
      const query = encodeURIComponent([place.name, place.address].filter(Boolean).join(" "));
      info.setContent(`<strong>${escape(titleOf(place))}</strong><br><a href="https://www.google.com/maps/search/?api=1&amp;query=${query}" target="_blank" rel="noopener noreferrer">打开地图导航 ↗</a>`);
      info.open({ map, anchor: marker });
    };
    const selectNearby = id => {
      const selected = nearbyMarkers.find(entry => entry.place.id === id);
      if (!selected) return;
      nearbyMarkers.forEach(entry => entry.marker.setIcon?.(markerIcon(nearbyColor(), entry.place.id === id)));
      document.querySelectorAll("[data-nearby-card]").forEach(card => card.classList.toggle("is-active", card.dataset.nearbyCard === id && card.closest("[data-nearby-panel]")?.dataset.nearbyPanel === activeKey));
      map.panTo(point(selected.place)); popup(selected.marker, selected.place);
    };
    const setNearby = visible => {
      nearbyVisible = Boolean(visible);
      nearbyMarkers.forEach(entry => entry.marker.setMap(nearbyVisible ? map : null));
      if (!nearbyVisible) { info.close?.(); document.querySelectorAll("[data-nearby-card]").forEach(card => card.classList.remove("is-active")); }
    };
    const renderView = key => {
      const view = data.days.find(day => day.key === key) || data.explorations?.find(segment => segment.key === key);
      if (!view) return;
      activeKey = key; clear();
      const bounds = new maps.LatLngBounds();
      const ordered = (view.runs || []).flatMap(run => run.map(node => node.placeId));
      const firstById = new Map();
      ordered.forEach((id, index) => { if (!firstById.has(id)) firstById.set(id, index); });
      const alphabet = index => index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
      firstById.forEach((index, id) => {
        const place = byId.get(id); if (!place) return;
        const lastIndex = ordered.lastIndexOf(id);
        const label = index === 0 && lastIndex === ordered.length - 1 && lastIndex > 0 ? `${alphabet(index)}/${alphabet(lastIndex)}` : alphabet(index);
        const marker = new maps.Marker({ position: point(place), map, title: titleOf(place), icon: markerIcon(themeColor(), true), label: { text: label, color: "#fff", fontWeight: "700", fontSize: label.length > 1 ? "10px" : "12px" }, zIndex: 10 });
        marker.addListener("click", () => { popup(marker, place); focusFormal(place.id); });
        overlays.push(marker); bounds.extend(point(place));
      });
      if (view.kind !== "exploration") {
        const roadPairs = new Set((view.roadLegs || []).map(leg => `${leg.fromPlaceId}→${leg.toPlaceId}`));
        const expectedPairs = (view.runs || []).flatMap(run => run.slice(1).map((node, index) => `${run[index].placeId}→${node.placeId}`));
        setStatus(expectedPairs.some(pair => !roadPairs.has(pair)) ? "部分道路路线尚未核实；地图不绘制直线代替道路。" : "");
        (view.roadLegs || []).forEach(leg => {
          const path = decodePolyline(leg.encodedPolyline);
          path.forEach(roadPoint => bounds.extend(roadPoint));
          overlays.push(new maps.Polyline({ path, map, strokeColor: "#fff", strokeOpacity: .96, strokeWeight: 9, zIndex: 1 }));
          overlays.push(new maps.Polyline({ path, map, strokeColor: themeColor(), strokeOpacity: .94, strokeWeight: 5, zIndex: 2 }));
        });
      } else setStatus("");
      (view.candidates || []).forEach(candidate => {
        const place = byId.get(candidate.placeId); if (!place) return;
        const marker = new maps.Marker({ position: point(place), title: titleOf(place), icon: markerIcon(nearbyColor()), zIndex: 5 });
        marker.addListener("click", () => {
          selectNearby(place.id);
          const card = [...document.querySelectorAll("[data-nearby-card]")].find(node => node.dataset.nearbyCard === place.id && node.closest("[data-nearby-panel]")?.dataset.nearbyPanel === activeKey);
          card?.scrollIntoView?.({ block: "nearest", behavior: global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth" });
        });
        nearbyMarkers.push({ marker, place }); overlays.push(marker);
      });
      if (firstById.size > 1) map.fitBounds(bounds, 55);
      else if (firstById.size === 1) { map.setCenter(bounds.getCenter()); map.setZoom?.(14); }
      setNearby(view.kind === "exploration" || Boolean(document.querySelector("[data-nearby-switch]")?.checked));
      document.querySelectorAll("[data-map-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mapView === key)));
      document.querySelectorAll("[data-candidate-panel]").forEach(panel => panel.hidden = panel.dataset.candidatePanel !== key);
      document.dispatchEvent(new CustomEvent("guide:map-view-change", { detail: { key } }));
    };
    renderView(activeKey);
    try { await waitForTiles(maps, map, Math.max(5000, Number(options.tileTimeoutMs) || 10000)); }
    catch (error) { clear(); maps.event.clearInstanceListeners?.(map); root.replaceChildren(); throw error; }
    if (selectedDayKey() !== activeKey) renderView(selectedDayKey());
    overlay?.classList.remove("is-visible", "is-final-fallback");
    document.querySelectorAll("[data-map-view]").forEach(button => bind(button, "click", () => renderView(button.dataset.mapView)));
    bind(document, "guide:day-change", event => { const key = `day-${event.detail?.dayNumber}`; if (data.days.some(day => day.key === key)) renderView(key); });
    bind(document, "guide:focus-place", event => { const key = event.detail?.dayNumber ? `day-${event.detail.dayNumber}` : activeKey; if (key !== activeKey) renderView(key); const place = byId.get(event.detail?.placeId); if (place) map.panTo(point(place)); });
    bind(document, "guide:nearby-toggle", event => { if (!event.detail?.key || event.detail.key === activeKey) setNearby(event.detail?.visible); });
    bind(document, "guide:theme-change", () => { map.setOptions?.({ styles: quietStyle() }); renderView(activeKey); });
    bind(document, "guide:focus-nearby", event => { const key = `day-${event.detail?.dayNumber}`; if (key !== activeKey) renderView(key); setNearby(true); selectNearby(event.detail?.placeId); });
    bind(document, "guide:current-location", event => { const lat = Number(event.detail?.latitude), lng = Number(event.detail?.longitude); if (!Number.isFinite(lat) || !Number.isFinite(lng)) return; locationMarker?.setMap(null); locationMarker = new maps.Marker({ position: { lat, lng }, map, title: "当前位置" }); map.panTo({ lat, lng }); });
    options.flushPending?.(documentHandlers);
    return { map, provider: "google", destroy() { bindings.forEach(([node, name, fn]) => node.removeEventListener(name, fn)); clear(); locationMarker?.setMap(null); maps.event.clearInstanceListeners?.(map); root.replaceChildren(); instances.delete(root); } };
  }
  function start(options) {
    const root = options?.root;
    if (root && instances.has(root)) return instances.get(root);
    const queued = new Map();
    const names = ['guide:day-change', 'guide:focus-place', 'guide:nearby-toggle', 'guide:theme-change', 'guide:focus-nearby', 'guide:current-location'];
    const capture = event => { queued.delete(event.type); queued.set(event.type, { detail: event.detail }); };
    names.forEach(name => document.addEventListener(name, capture));
    const stop = () => names.forEach(name => document.removeEventListener(name, capture));
    const pending = createMap({ ...options, flushPending(handlers) {
      stop();
      for (const [name, event] of queued) handlers.get(name)?.(event);
      queued.clear();
    } }).finally(stop);
    if (root) { instances.set(root, pending); pending.catch(() => { if (instances.get(root) === pending) instances.delete(root); }); }
    return pending;
  }
  global.TravelGoogleRouteMap = Object.freeze({ start, decodePolyline });
})(window);
