#!/usr/bin/env node
const fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
const renderer=fs.readFileSync(path.join(root,"scripts","render-guide.js"),"utf8");
const google=fs.readFileSync(path.join(root,"assets","google-route-map.js"),"utf8");
const baidu=fs.readFileSync(path.join(root,"assets","baidu-route-map.js"),"utf8");
const must=(ok,message)=>{if(!ok)throw new Error(message)};
must(renderer.includes('stops.every(isMainlandChina) ? "baidu" : "google"'),"缺少按路线范围选择百度/Google的规则");
must(renderer.includes('maps.googleapis.com/maps/api/js'),"缺少 Google Maps JSAPI 输出");
must(!renderer.includes('const startLeaflet=async function'),"渲染器仍内嵌未使用的 Leaflet 运行时");
must(!renderer.includes('<script>${tileLoader}</script>'),"渲染器仍注入未使用的 TileLoader");
must(google.includes('google-tiles-timeout')&&/await waitForTiles\(maps,\s*map/.test(google),"Google 底图等待必须实际调用可拒绝的超时门禁");
must(google.includes('prefers-reduced-motion: reduce')&&baidu.includes('prefers-reduced-motion: reduce'),"地图反向定位必须遵循减少动效偏好");
must(google.includes('decodePolyline(leg.encodedPolyline)')&&baidu.includes('decodePolyline(meta.encodedPolyline)'),"地图必须读取预生成道路几何，不得恢复坐标直线");
must(!google.includes('computeRoutes(')&&!baidu.includes('DrivingRoute('),"正式网页不得打开时在线规划路线");
console.log("PASS map provider selection and Google timeout contract");
