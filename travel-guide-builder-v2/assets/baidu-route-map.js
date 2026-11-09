/* travel-baidu-route-map: v1
   百度 JS API GL 的轻量路线适配器：只使用一次 JSAPI/底图加载；不做地点搜索、地理编码、路线规划、定位或预取。
   输入坐标来自 trip-data.places；道路几何只读取预生成折线，不以直线冒充道路。 */
(function (global) {
  "use strict";
  const SCRIPT_ID = "travel-baidu-jsapi";

  // 百度官方 bootstrap 会用 document.write() 继续加载 /getscript；因此首个 <script>
  // 必须由渲染器在 HTML 解析阶段直接输出。这里绝不再动态插入 bootstrap。
  function load() {
    return global.BMapGL ? Promise.resolve(global.BMapGL) : Promise.reject(new Error("api-unavailable"));
  }
  const instances = new WeakMap();
  async function createMap(options) {
    const data = options.data;
    const root = options.root;
    const status = options.status;
    const overlay = options.overlay;
    const BMapGL = await load(options);
    if (!root || !data || !Array.isArray(data.places)) throw new Error("invalid-map-data");
    const coordType = global.BMAP_COORD_WGS84;
    if (coordType !== undefined) BMapGL.coordType = coordType;
    root.replaceChildren();
    const map = new BMapGL.Map(root, { enableRotate: false, enableTilt: false, ...(coordType === undefined ? {} : { coordType }) });
    map.enableScrollWheelZoom(false);
    const byId = new Map(data.places.map((place) => [place.id, place]));
    const markerByPlace = new Map();
    const nearbyPlaceIds = new Set();
    let labels = [];
    const selectedDayKey = () => { const day = document.querySelector('[data-day-tab][aria-selected="true"]')?.dataset.dayTab; return day ? `day-${day}` : data.days?.[0]?.key; };
    let activeKey = data.overview ? "all" : selectedDayKey();
    let tilesReady = false;
    let currentLocation = null;
    let nearbyVisible = false;
    const bindings = [];
    const documentHandlers = new Map();
    const bind = (node, name, fn) => { node.addEventListener(name, fn); bindings.push([node, name, fn]); if (node === document) documentHandlers.set(name, fn); };
    const decodePolyline = (encoded) => {
      let index=0,lat=0,lng=0; const result=[];
      const read=()=>{let value=0,shift=0,byte;do{if(index>=encoded.length)throw Error("invalid-road-polyline");byte=encoded.charCodeAt(index++)-63;value|=(byte&31)<<shift;shift+=5;if(shift>30)throw Error("invalid-road-polyline");}while(byte>=32);return value&1?~(value>>1):value>>1;};
      while(index<encoded.length){lat+=read();lng+=read();result.push(new BMapGL.Point(lng/1e5,lat/1e5));}
      if(result.length<2)throw Error("invalid-road-polyline");return result;
    };

    const setStatus = (message) => { if (status) { status.textContent = message; status.hidden = !message; } };
    const point = (place) => new BMapGL.Point(Number(place.coordinates.longitude), Number(place.coordinates.latitude));
    const focusItem = (placeId) => {
      const candidates = Array.from(document.querySelectorAll("[data-place-id]")).filter((node) => node.dataset.placeId === placeId);
      const target = candidates.find((node) => !node.closest(".day[hidden]")) || candidates[0];
      if (!target) return;
      const day = target.closest("[data-day-panel]");
      if (day?.hidden) document.querySelector(`[data-day-tab="${day.dataset.dayPanel}"]`)?.click();
      const reduceMotion = global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      target.classList.add("is-map-focused");
      global.setTimeout(() => target.classList.remove("is-map-focused"), 1800);
    };
    const mapLabel = (text, position, className, offsetY) => {
      const label = new BMapGL.Label(text, { position, offset: new BMapGL.Size(-22, offsetY) });
      label.setStyle({ color: "#123e63", background: "rgba(255,255,255,.94)", border: "1px solid #9bc6dc", borderRadius: "999px", padding: "3px 7px", fontSize: "12px", lineHeight: "16px", boxShadow: "0 2px 7px rgba(12,58,86,.14)", whiteSpace: "nowrap", pointerEvents: "none" });
      label.__travelClass = className;
      map.addOverlay(label); labels.push(label);
      return label;
    };
    const updateLabels = () => {
      const showTime = map.getZoom() >= 11;
      labels.forEach((label) => label.__travelClass === "time" ? (showTime ? label.show() : label.hide()) : label.show());
    };
    const markerIcon = (label, selected = false) => {
      const nearby = label === "•";
      const size = nearby ? (selected ? 26 : 18) : 34;
      const color = global.getComputedStyle?.(document.body)?.getPropertyValue(nearby ? "--guide-map-candidate" : "--guide-action")?.trim() || (nearby ? "#c77b3e" : "#176f6a");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2-2}" fill="${color}" stroke="white" stroke-width="2"/>${nearby?"":`<text x="50%" y="53%" text-anchor="middle" dominant-baseline="central" fill="white" font-size="${label.length>1?10:14}" font-weight="700">${label}</text>`}</svg>`;
      return BMapGL.Icon ? new BMapGL.Icon("data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), new BMapGL.Size(size,size)) : null;
    };
    const selectNearby = (placeId, scroll = false) => {
      const cards = [...document.querySelectorAll("[data-nearby-card]")];
      const card = cards.find(node => node.dataset.nearbyCard === placeId && node.closest("[data-nearby-panel]")?.dataset.nearbyPanel === activeKey);
      cards.forEach(node => node.classList.toggle("is-active", node === card));
      markerByPlace.forEach((marker, id) => { if (nearbyPlaceIds.has(id)) { const icon = markerIcon("•", id === placeId); if (icon) marker.setIcon?.(icon); } });
      if (scroll) card?.scrollIntoView?.({ block: "nearest", behavior: global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth" });
    };
    const showInfo = place => {
      const title = place.localName && place.localName !== place.name ? place.name + " / " + place.localName : place.name;
      map.openInfoWindow(new BMapGL.InfoWindow("<strong>" + String(title).replace(/[&<>]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c])) + "</strong>"), point(place), coordType === undefined ? {} : { coordType });
    };
    const addMarker = (place, label) => {
      if (markerByPlace.has(place.id)) return markerByPlace.get(place.id);
      const nearby = label === "•", icon = markerIcon(label);
      if (nearby) nearbyPlaceIds.add(place.id);
      const marker = new BMapGL.Marker(point(place), { ...(coordType === undefined ? {} : { coordType }), ...(icon ? { icon } : {}) });
      const title = (place.localName && place.localName !== place.name) ? place.name + " / " + place.localName : place.name;
      marker.setTitle(title);
      marker.addEventListener("click", () => {
        if (!nearby && !document.dispatchEvent(new CustomEvent("guide:map-marker-select", { cancelable: true, detail: { key: activeKey, placeId: place.id } }))) return;
        if (nearby) selectNearby(place.id, true); else focusItem(place.id);
        showInfo(place);
      });
      map.addOverlay(marker); markerByPlace.set(place.id, marker);
      return marker;
    };
    const addSegment = (meta) => {
      const path=decodePolyline(meta.encodedPolyline);
      const color=global.getComputedStyle?.(document.body)?.getPropertyValue("--guide-action")?.trim()||"#176f6a";
      map.addOverlay(new BMapGL.Polyline(path,{strokeColor:"#fff",strokeWeight:9,strokeOpacity:.95,...(coordType===undefined?{}:{coordType})}));
      map.addOverlay(new BMapGL.Polyline(path,{strokeColor:color,strokeWeight:5,strokeOpacity:.92,...(coordType===undefined?{}:{coordType})}));
      return path;
    };
    const setNearby = visible => {
      const next = Boolean(visible);
      if (next === nearbyVisible) return;
      nearbyVisible = next;
      if (next) {
        const view = data.days.find(day => day.key === activeKey) || data.explorations?.find(segment => segment.key === activeKey);
        for (const candidate of view?.candidates || []) {
          const place = byId.get(candidate.placeId);
          if (!place) continue;
          if (!markerByPlace.has(place.id)) addMarker(place, '•');
          else if (nearbyPlaceIds.has(place.id)) map.addOverlay(markerByPlace.get(place.id));
        }
      } else {
        for (const id of nearbyPlaceIds) map.removeOverlay(markerByPlace.get(id));
        map.closeInfoWindow?.();
        document.querySelectorAll('[data-nearby-card]').forEach(card => card.classList.remove('is-active'));
      }
    };
    const renderView = (key) => {
      activeKey = key; map.clearOverlays(); markerByPlace.clear(); nearbyPlaceIds.clear(); labels = [];
      const view = key === "all" ? data.overview : data.days.find((day) => day.key === key) || data.explorations?.find((segment) => segment.key === key);
      if (!view) return;
      const points = []; let order = 0;
      const ordered=(view.runs||[]).flatMap(run=>run.map(node=>node.placeId));
      (view.runs || []).forEach((run) => {
        run.forEach((node) => { const place = byId.get(node.placeId); if (!place) return; const label=order===0&&ordered.lastIndexOf(node.placeId)===ordered.length-1&&ordered.length>1?`A/${String.fromCharCode(65+ordered.length-1)}`:String.fromCharCode(65+order);addMarker(place,label);order++;points.push(point(place)); });
      });
      if(view.kind!=="exploration"){
        const expected=(view.runs||[]).flatMap(run=>run.slice(1).map((node,index)=>`${run[index].placeId}→${node.placeId}`));
        const supplied=new Set((view.roadLegs||[]).map(leg=>`${leg.fromPlaceId}→${leg.toPlaceId}`));
        setStatus(expected.some(pair=>!supplied.has(pair))?"部分道路路线尚未核实；地图不绘制直线代替道路。":"");
        (view.roadLegs||[]).forEach(meta=>points.push(...addSegment(meta)));
      }
      nearbyVisible = false;
      setNearby(view.kind === "exploration" || Boolean(document.querySelector("[data-nearby-switch]")?.checked));
      if (nearbyVisible) (view.candidates || []).forEach(candidate => { const place = byId.get(candidate.placeId); if (place) points.push(point(place)); });
      if (currentLocation) map.addOverlay(new BMapGL.Marker(new BMapGL.Point(currentLocation.longitude,currentLocation.latitude)));
      if (points.length > 1) map.setViewport(points, { margins: [32, 32, 32, 32], enableAnimation: !global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches });
      else if (points.length === 1) map.centerAndZoom(points[0], 13);
      document.querySelectorAll("[data-map-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mapView === key)));
      document.querySelectorAll("[data-candidate-panel]").forEach((panel) => { panel.hidden = panel.dataset.candidatePanel !== key; });
      document.dispatchEvent(new CustomEvent("guide:map-view-change",{detail:{key}}));
      updateLabels();
    };
    try { await new Promise((resolve, reject) => {
      const timeout = global.setTimeout(() => reject(new Error("tiles-timeout")), Math.max(4000, Number(options.tileTimeoutMs) || 8000));
      map.addEventListener("tilesloaded", () => { if (tilesReady) return; tilesReady = true; global.clearTimeout(timeout); resolve(); });
      try { renderView(activeKey); } catch (error) { global.clearTimeout(timeout); reject(error); }
    }); } catch (error) { map.clearOverlays(); map.destroy?.(); root.replaceChildren(); throw error; }
    overlay?.classList.remove("is-visible", "is-final-fallback");
    if (!data.overview && selectedDayKey() !== activeKey) renderView(selectedDayKey());
    map.addEventListener("zoomend", updateLabels);
    document.querySelectorAll("[data-map-view]").forEach((button) => bind(button, "click", () => renderView(button.dataset.mapView)));
    bind(document, "guide:day-change", (event) => { const key = "day-" + event.detail?.dayNumber; if (data.days.some((day) => day.key === key)) renderView(key); });
    bind(document, "guide:focus-place", (event) => { const placeId = event.detail?.placeId; if (!placeId) return; const key = event.detail?.dayNumber ? "day-" + event.detail.dayNumber : activeKey; if (key !== activeKey && data.days.some((day) => day.key === key)) renderView(key); const place = byId.get(placeId); const marker = markerByPlace.get(placeId); if (place) { map.centerAndZoom(point(place), Math.max(map.getZoom(), 13)); if (marker) showInfo(place); } });
    bind(document, "guide:current-location", (event) => { const lat=Number(event.detail?.latitude),lng=Number(event.detail?.longitude); if(!Number.isFinite(lat)||!Number.isFinite(lng))return;currentLocation={latitude:lat,longitude:lng};renderView(activeKey);map.centerAndZoom(new BMapGL.Point(lng,lat),Math.max(map.getZoom(),13)); });
    bind(document, "guide:nearby-toggle",event=>{if(event.detail?.key && event.detail.key!==activeKey)return;setNearby(event.detail?.visible);});
    bind(document, "guide:theme-change",()=>renderView(activeKey));
    bind(document, "guide:focus-nearby",event=>{const key=`day-${event.detail?.dayNumber}`;if(key!==activeKey)renderView(key);setNearby(true);const place=byId.get(event.detail?.placeId);if(place){map.centerAndZoom(point(place),Math.max(map.getZoom(),14));selectNearby(place.id);showInfo(place);}});
    options.flushPending?.(documentHandlers);
    return { map, provider: "baidu", destroy() { bindings.forEach(([node,name,fn])=>node.removeEventListener(name,fn)); map.removeEventListener?.("zoomend",updateLabels); map.clearOverlays(); map.destroy?.(); root.replaceChildren(); instances.delete(root); } };
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
  global.TravelBaiduRouteMap = Object.freeze({ load, start });
})(window);
