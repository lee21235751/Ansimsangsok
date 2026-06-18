import fs from "node:fs";
import path from "node:path";

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>\uC548\uC2EC\uC0C1\uC18D \uC124\uBB38\uC9C4\uB2E8</title>
<style>
  :root {
    --forest-deep: #06251d;
    --paper: #fffdf6;
    --muted: #5e6b64;
    --line: rgba(14, 53, 41, 0.18);
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; background: transparent;
    font-family: "Pretendard", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    color: #12231d; -webkit-text-size-adjust: 100%;
  }
  .survey {
    max-width: 680px; margin: 0 auto;
    padding: 4px 0 calc(40px + env(safe-area-inset-bottom, 0px));
  }
  .progress-row {
    display: flex; justify-content: space-between; align-items: baseline;
    margin: 0 0 8px; font-weight: 800; color: var(--forest-deep);
  }
  .progress-step { font-size: 1.05rem; }
  .progress-time { font-size: 0.92rem; color: var(--muted); font-weight: 700; }
  .progress-track {
    height: 8px; border-radius: 999px;
    background: rgba(14,53,41,0.12); overflow: hidden; margin: 0 0 18px;
  }
  .progress-bar {
    height: 100%; border-radius: 999px;
    background: linear-gradient(135deg, #f5dc8a, #c99938);
    transition: width 0.25s ease;
  }
  .card {
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 22px; padding: 20px 18px;
    box-shadow: 0 12px 30px rgba(0,0,0,0.06);
  }
  .q-title {
    margin: 0 0 6px; font-size: 1.22rem; line-height: 1.4;
    font-weight: 900; color: var(--forest-deep);
  }
  .q-help {
    margin: 0 0 16px; font-size: 0.96rem; line-height: 1.55;
    color: var(--muted); font-weight: 600;
  }
  .options { display: flex; flex-direction: column; gap: 10px; }
  .opt {
    display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
    width: 100%; margin: 0; min-height: 60px; padding: 15px 16px;
    border: 2px solid rgba(14,53,41,0.20); border-radius: 16px;
    background: #fff; color: var(--forest-deep);
    font-family: inherit; font-size: 1.04rem; font-weight: 800;
    text-align: left; line-height: 1.4; cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(215,173,85,0.15);
    -webkit-user-select: none; user-select: none;
    /* 전환 없음 — 즉각 반응 */
  }
  .opt.sel { background: #0e3529; color: #fff8dc; border-color: #d7ad55; }
  .opt-text { display: block; font-weight: 800; }
  .opt-mark { display: none; font-size: 0.8rem; font-weight: 800; color: #d7ad55; line-height: 1; }
  .opt.sel .opt-mark { display: block; }
  .asset-group { margin-top: 16px; }
  .asset-group:first-child { margin-top: 0; }
  .asset-title { font-weight: 900; color: var(--forest-deep); margin: 0 0 2px; font-size: 1.02rem; }
  .asset-q { margin: 0 0 8px; color: var(--muted); font-size: 0.92rem; font-weight: 600; }
  .empty-note { margin: 4px 0 0; color: var(--muted); font-weight: 700; line-height: 1.6; }
  .nav { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
  .btn {
    width: 100%; min-height: 56px; border-radius: 16px;
    font-family: inherit; font-size: 1.08rem; font-weight: 900;
    cursor: pointer; touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    border: 2px solid transparent;
  }
  .btn-next { background: linear-gradient(135deg,#f5dc8a,#c99938); color: var(--forest-deep); border-color: #c99938; }
  .btn-prev { background: #fff; color: var(--muted); border-color: var(--line); }
  .btn:disabled { opacity: 0.45; cursor: default; }
  .btn:active:not(:disabled) { opacity: 0.8; }
</style>
</head>
<body>
<div class="survey" id="survey">
  <div class="progress-row">
    <span class="progress-step" id="pStep">1 / 9</span>
    <span class="progress-time">\uC57D 2\uBD84 \uC18C\uC694</span>
  </div>
  <div class="progress-track">
    <div class="progress-bar" id="pBar" style="width:11%"></div>
  </div>
  <div class="card">
    <h3 class="q-title" id="qTitle"></h3>
    <p class="q-help" id="qHelp"></p>
    <div class="options" id="opts"></div>
  </div>
  <div class="nav">
    <button class="btn btn-next" id="btnNext" type="button">\uB2E4\uC74C</button>
    <button class="btn btn-prev" id="btnPrev" type="button" disabled>\uC774\uC804</button>
  </div>
</div>
<script>
(function(){
"use strict";

var Q = [
  { type:"single", key:"family",
    title:"\uD604\uC7AC \uC0C1\uC18D\uACFC \uAD00\uB828\uB41C \uAC00\uC871\uC758 \uAD6C\uC131\uC740 \uC5B4\uB5BB\uAC8C \uB418\uB098\uC694?",
    help:"\uD574\uB2F9\uD558\uB294 \uAD6C\uC131\uC744 \uC120\uD0DD\uD574\uC8FC\uC138\uC694.",
    options:[
      {label:"\uBC30\uC6B0\uC790\uC640 \uC790\uB140\uAC00 \uC788\uC74C", score:8},
      {label:"\uC804\uD63C \uC790\uB140 \uB610\uB294 \uD63C\uC678 \uC790\uB140\uAC00 \uC788\uC74C", score:22},
      {label:"\uC790\uB140\uAC00 \uD574\uC678\uC5D0 \uAC70\uC8FC\uD558\uAC70\uB098 \uC5F0\uB77D\uC774 \uC548 \uB418\uB294 \uC0C1\uD669\uC774 \uC788\uC74C", score:18},
      {label:"\uC798 \uBAA8\uB974\uACA0\uC2B5\uB2C8\uB2E4", score:12}
    ]},
  { type:"single", key:"will",
    title:"\uC720\uC5B8\uC7A5\uC774\uB098 \uC0C1\uC18D \uAD00\uB828 \uACF5\uC99D\uC744 \uBC1B\uC544\uB450\uC168\uB098\uC694?",
    help:"\uBB38\uC11C \uC0C1\uD0DC\uBCF4\uB2E4 \uC9C0\uAE08 \uC900\uBE44 \uC0C1\uD669\uC744 \uAE30\uC900\uC73C\uB85C \uC0DD\uAC01\uD574\uC8FC\uC138\uC694.",
    options:[
      {label:"\uC798 \uC900\uBE44\uB418\uC5B4 \uD65C\uC6A9\uD558\uACE0 \uC788\uC74C", score:6},
      {label:"\uB0B4\uC6A9\uC740 \uC788\uC9C0\uB9CC \uBB38\uC11C\uB85C \uC900\uBE44\uD558\uC9C0 \uC54A\uC74C", score:14},
      {label:"\uC804\uD61C \uC900\uBE44\uD558\uC9C0 \uC54A\uC74C", score:22},
      {label:"\uC798 \uBAA8\uB974\uACA0\uC2B5\uB2C8\uB2E4", score:12}
    ]},
  { type:"multiSimple", key:"assetPresence",
    title:"\uBCF4\uC720\uD55C \uBD80\uB3D9\uC0B0\uC774 \uC788\uB098\uC694?",
    help:"\uD574\uB2F9\uD558\uB294 \uD56D\uBAA9\uC744 \uBAA8\uB450 \uC120\uD0DD\uD574\uC8FC\uC138\uC694. \uC5EC\uB7EC \uAC1C\uB97C \uB3D9\uC2DC\uC5D0 \uC120\uD0DD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
    exclusive:["none","unknown"],
    options:[
      {value:"house",            label:"\uC8FC\uD0DD", score:0},
      {value:"land",             label:"\uD1A0\uC9C0", score:0},
      {value:"incomeRealEstate", label:"\uC218\uC775\uD615 \uBD80\uB3D9\uC0B0 (\uC0C1\uAC00/\uC624\uD53C\uC2A4\uD154/\uBE4C\uB529)", score:0},
      {value:"factory",          label:"\uACF5\uC7A5/\uCC3D\uACE0", score:0},
      {value:"otherRealEstate",  label:"\uAE30\uD0C0 \uBD80\uB3D9\uC0B0", score:0},
      {value:"none",             label:"\uD574\uB2F9 \uC5C6\uC74C", score:0},
      {value:"unknown",          label:"\uC798 \uBAA8\uB974\uACA0\uC2B5\uB2C8\uB2E4", score:8}
    ]},
  { type:"assetCounts", key:"assetCounts",
    title:"\uC120\uD0DD\uD55C \uBD80\uB3D9\uC0B0\uC744 \uAC01\uAC01 \uBA87 \uAC1C \uBCF4\uC720\uD558\uACE0 \uC788\uB098\uC694?",
    help:"\uC704\uC5D0\uC11C \uC788\uB2E4\uACE0 \uC120\uD0DD\uD55C \uD56D\uBAA9\uBCC4\uB85C \uAC1C\uC218\uB97C \uD655\uC778\uD574\uC8FC\uC138\uC694.",
    presenceKey:"assetPresence",
    assets:[
      {key:"house",            title:"\uC8FC\uD0DD",          q:"\uC8FC\uD0DD\uC744 \uBA87 \uCC44 \uC18C\uC720\uD558\uC138\uC694?",                           labels:["1\uCC44","2\uCC44","3\uCC44 \uC774\uC0C1"],             scores:[7,13,18]},
      {key:"land",             title:"\uD1A0\uC9C0",          q:"\uD1A0\uC9C0\uB97C \uBA87 \uD544\uC9C0 \uAC16\uACE0 \uC788\uB098\uC694?",                   labels:["1\uD544\uC9C0","2\uD544\uC9C0","3\uD544\uC9C0 \uC774\uC0C1"], scores:[8,14,20]},
      {key:"incomeRealEstate", title:"\uC218\uC775\uD615 \uBD80\uB3D9\uC0B0", q:"\uC0C1\uAC00/\uC624\uD53C\uC2A4\uD154/\uBE4C\uB529\uC744 \uBA87 \uAC1C \uBCF4\uC720\uD558\uACE0 \uC788\uB098\uC694?", labels:["1\uAC1C","2\uAC1C","3\uAC1C \uC774\uC0C1"], scores:[8,14,20]},
      {key:"factory",          title:"\uACF5\uC7A5/\uCC3D\uACE0", q:"\uACF5\uC7A5/\uCC3D\uACE0\uB97C \uBA87 \uACF3 \uAC16\uACE0 \uC788\uB098\uC694?",       labels:["1\uACF3","2\uACF3","3\uACF3 \uC774\uC0C1"],             scores:[8,14,20]},
      {key:"otherRealEstate",  title:"\uAE30\uD0C0 \uBD80\uB3D9\uC0B0", q:"\uAE30\uD0C0 \uBD80\uB3D9\uC0B0\uC744 \uBA87 \uAC1C \uC18C\uC720\uD558\uC138\uC694?", labels:["1\uAC1C","2\uAC1C","3\uAC1C \uC774\uC0C1"], scores:[6,11,16]}
    ]},
  { type:"single", key:"gift",
    title:"\uCD5C\uADFC\uC5D0 \uD2B9\uC815 \uAC00\uC871\uC5D0\uAC8C\uB9CC \uB354 \uB9CE\uC774 \uC904 \uC758\uD5A5\uC774 \uC788\uB098\uC694?",
    help:"\uC608\uB97C \uB4E4\uC5B4, \uC0AC\uC5C5 \uC591\uB3C4, \uC9D1 \uC99D\uC5EC, \uB545 \uC99D\uC5EC \uB4F1\uC744 \uC0DD\uAC01\uD558\uBA70 \uB2F5\uD574\uC8FC\uC138\uC694.",
    options:[
      {label:"\uC5C6\uC74C", score:4},
      {label:"\uC870\uAE08 \uC788\uC74C", score:16},
      {label:"\uC0C1\uB2F9\uD788 \uC788\uC74C", score:26},
      {label:"\uC798 \uBAA8\uB974\uACA0\uC2B5\uB2C8\uB2E4", score:14}
    ]},
  { type:"single", key:"business",
    title:"\uAC00\uC871\uC758 \uC0AC\uC5C5, \uC9C0\uBD84 \uB610\uB294 \uD2B9\uC218 \uBD80\uB3D9\uC0B0\uC744 \uBB3C\uB824\uC904 \uC758\uD5A5\uC774 \uC788\uB098\uC694?",
    help:"\uC0AC\uC5C5\uCCB4 \uB610\uB294 \uBC95\uC778 \uC9C0\uBD84, \uBE44\uC0C1\uC7A5\uC8FC\uC2DD, \uD2B9\uC218 \uBD80\uB3D9\uC0B0 \uB4F1\uC744 \uD3EC\uD568\uD558\uC5EC \uC0DD\uAC01\uD574\uC8FC\uC138\uC694.",
    options:[
      {label:"\uC5C6\uC74C", score:3},
      {label:"\uC77C\uBD80 \uC788\uC74C", score:12},
      {label:"\uBCF5\uC7A1\uD55C \uAD6C\uC870\uB85C \uC774\uC5B4\uC9C8 \uC608\uC815", score:24},
      {label:"\uC798 \uBAA8\uB974\uACA0\uC2B5\uB2C8\uB2E4", score:12}
    ]},
  { type:"multiSimple", key:"overseas",
    title:"\uD574\uC678 \uAD6D\uC801 / \uD574\uC678 \uAC70\uC8FC / \uD574\uC678 \uC790\uC0B0 \uAD00\uB828\uC774 \uC788\uB098\uC694?",
    help:"\uC5EC\uB7EC \uAC1C\uB97C \uB3D9\uC2DC\uC5D0 \uC120\uD0DD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uD574\uB2F9 \uC5C6\uC74C\uACFC \uC798 \uBAA8\uB974\uACA0\uC2B5\uB2C8\uB2E4\uB294 \uD558\uB098\uB9CC \uC120\uD0DD\uD574\uC8FC\uC138\uC694.",
    exclusive:["none","unknown"],
    options:[
      {value:"self_abroad",               label:"\uBCF8\uC778\uC774 \uD574\uC678 \uAC70\uC8FC \uC911", score:16},
      {value:"family_abroad",             label:"\uBC30\uC6B0\uC790 \uB610\uB294 \uC790\uB140\uAC00 \uD574\uC678 \uAC70\uC8FC \uC911", score:14},
      {value:"family_foreign_nationality",label:"\uBC30\uC6B0\uC790 \uB610\uB294 \uC790\uB140\uAC00 \uC678\uAD6D \uAD6D\uC801", score:16},
      {value:"overseas_asset",            label:"\uD574\uC678 \uBD80\uB3D9\uC0B0 \uB610\uB294 \uD574\uC678 \uAE08\uC735\uC790\uC0B0\uC774 \uC788\uC74C", score:18},
      {value:"none",                      label:"\uD574\uB2F9 \uC5C6\uC74C", score:0},
      {value:"unknown",                   label:"\uC798 \uBAA8\uB974\uACA0\uC2B5\uB2C8\uB2E4", score:10}
    ]},
  { type:"single", key:"conflict",
    title:"\uAC00\uC871 \uC0AC\uC774\uC5D0 \uC774\uBBF8 \uAC08\uB4F1\uC774\uB098 \uBD88\uD654\uAC00 \uC788\uAC70\uB098 \uC608\uC0C1\uB418\uB098\uC694?",
    help:"\uC9C1\uC811\uC801\uC73C\uB85C \uB2E4\uD22C\uC9C0\uB294 \uC54A\uB354\uB77C\uB3C4 \uBBF8\uBB18\uD55C \uBD84\uC704\uAE30\uB098 \uC608\uC0C1\uB418\uB294 \uC0C1\uD669\uB3C4 \uD3EC\uD568\uD558\uC5EC \uC0DD\uAC01\uD574\uC8FC\uC138\uC694.",
    options:[
      {label:"\uC5C6\uC74C", score:4},
      {label:"\uC77C\uBD80 \uC788\uC74C", score:14},
      {label:"\uC774\uBBF8 \uC2EC\uAC01\uD568", score:28},
      {label:"\uC798 \uBAA8\uB974\uACA0\uC2B5\uB2C8\uB2E4", score:12}
    ]},
  { type:"single", key:"documents",
    title:"\uC0C1\uC18D \uC11C\uB958, \uAC00\uC871\uAD00\uACC4 \uBC0F \uC7AC\uC0B0 \uBAA9\uB85D \uBB38\uC11C\uAC00 \uC900\uBE44\uB418\uC5B4 \uC788\uB098\uC694?",
    help:"\uACF5\uC99D\uD558\uC9C0 \uC54A\uC544\uB3C4 \uAD6C\uCC2E\uC2B5\uB2C8\uB2E4. \uB300\uCDA9\uC774\uB77C\uB3C4 \uBB38\uC11C\uAC00 \uC788\uB294\uC9C0 \uAE30\uC900\uC73C\uB85C \uC0DD\uAC01\uD574\uC8FC\uC138\uC694.",
    options:[
      {label:"\uC798 \uC815\uB9AC\uB418\uC5B4 \uC788\uC74C", score:4},
      {label:"\uC870\uAE08\uC774\uB77C\uB3C4 \uC900\uBE44\uB418\uC5B4 \uC788\uC74C", score:12},
      {label:"\uC804\uD61C \uC900\uBE44\uB418\uC5B4 \uC788\uC9C0 \uC54A\uC74C", score:22},
      {label:"\uC798 \uBAA8\uB974\uACA0\uC2B5\uB2C8\uB2E4", score:12}
    ]}
];

var state = { step:0, answers:{} };
var elOpts   = document.getElementById("opts");
var elTitle  = document.getElementById("qTitle");
var elHelp   = document.getElementById("qHelp");
var elStep   = document.getElementById("pStep");
var elBar    = document.getElementById("pBar");
var elNext   = document.getElementById("btnNext");
var elPrev   = document.getElementById("btnPrev");

/* ── 유틸 ── */
function esc(s){
  return String(s==null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

/* ── 선택지 HTML 생성 ── */
function buildOptions(q){
  if(q.type==="single"){
    var ans=state.answers[q.key];
    return q.options.map(function(o){
      var sel=ans===o.label?" sel":"";
      return '<button class="opt'+sel+'" data-v="'+esc(o.label)+'" type="button">'+
        '<span class="opt-text">'+esc(o.label)+'</span>'+
        '<span class="opt-mark">\u2713 \uC120\uD0DD\uB428</span></button>';
    }).join("");
  }
  if(q.type==="multiSimple"){
    var arr=Array.isArray(state.answers[q.key])?state.answers[q.key]:[];
    return q.options.map(function(o){
      var sel=arr.indexOf(o.value)!==-1?" sel":"";
      return '<button class="opt'+sel+'" data-v="'+esc(o.value)+'" type="button">'+
        '<span class="opt-text">'+esc(o.label)+'</span>'+
        '<span class="opt-mark">\u2713 \uC120\uD0DD\uB428</span></button>';
    }).join("");
  }
  if(q.type==="assetCounts"){
    var presence=Array.isArray(state.answers[q.presenceKey])
      ?state.answers[q.presenceKey].filter(function(k){return k!=="none"&&k!=="unknown";})
      :[];
    var assets=q.assets.filter(function(a){return presence.indexOf(a.key)!==-1;});
    if(!assets.length)
      return '<p class="empty-note">\uC55E \uC9C8\uBB38\uC5D0\uC11C \uBD80\uB3D9\uC0B0\uC744 \uC120\uD0DD\uD558\uBA74 \uC5EC\uAE30\uC11C \uAC1C\uC218\uB97C \uD655\uC778\uD569\uB2C8\uB2E4. \uC120\uD0DD\uD55C \uD56D\uBAA9\uC774 \uC5C6\uC73C\uBA74 \uB2E4\uC74C\uC73C\uB85C \uB118\uC5B4\uAC00\uC138\uC694.</p>';
    var counts=state.answers[q.key]||{};
    return assets.map(function(a){
      var opts=a.labels.map(function(lb){
        var sel=counts[a.key]===lb?" sel":"";
        return '<button class="opt'+sel+'" data-v="'+esc(lb)+'" data-ak="'+esc(a.key)+'" type="button">'+
          '<span class="opt-text">'+esc(lb)+'</span>'+
          '<span class="opt-mark">\u2713 \uC120\uD0DD\uB428</span></button>';
      }).join("");
      return '<div class="asset-group"><div class="asset-title">'+esc(a.title)+'</div>'+
        '<p class="asset-q">'+esc(a.q)+'</p>'+
        '<div class="options">'+opts+'</div></div>';
    }).join("");
  }
  return "";
}

/* ── 클릭 처리: DOM 재생성 없이 클래스만 토글 ── */
function handleTap(btn){
  var q=Q[state.step];
  if(!q||!btn) return;
  var v=btn.getAttribute("data-v");
  if(q.type==="single"){
    // 같은 그룹 전체 sel 제거 후 이 버튼만 sel
    var all=elOpts.querySelectorAll(".opt");
    for(var i=0;i<all.length;i++) all[i].classList.remove("sel");
    btn.classList.add("sel");
    state.answers[q.key]=v;
  } else if(q.type==="multiSimple"){
    var excl=q.exclusive||[];
    var isExcl=excl.indexOf(v)!==-1;
    var wasOn=btn.classList.contains("sel");
    if(isExcl){
      var all2=elOpts.querySelectorAll(".opt");
      for(var j=0;j<all2.length;j++) all2[j].classList.remove("sel");
      if(!wasOn) btn.classList.add("sel");
    } else {
      // 배타 옵션 해제
      var exBtns=elOpts.querySelectorAll(".opt");
      for(var k=0;k<exBtns.length;k++){
        if(excl.indexOf(exBtns[k].getAttribute("data-v"))!==-1)
          exBtns[k].classList.remove("sel");
      }
      if(wasOn) btn.classList.remove("sel");
      else btn.classList.add("sel");
    }
    // state 갱신
    var selBtns=elOpts.querySelectorAll(".opt.sel");
    var arr=[];
    for(var m=0;m<selBtns.length;m++) arr.push(selBtns[m].getAttribute("data-v"));
    state.answers[q.key]=arr;
  } else if(q.type==="assetCounts"){
    var ak=btn.getAttribute("data-ak");
    if(!ak) return;
    var grpBtns=elOpts.querySelectorAll('.opt[data-ak="'+ak+'"]');
    for(var n=0;n<grpBtns.length;n++) grpBtns[n].classList.remove("sel");
    btn.classList.add("sel");
    if(!state.answers[q.key]) state.answers[q.key]={};
    state.answers[q.key][ak]=v;
  }
}

/* ── 이벤트 바인딩: touchend(즉시) + click(PC 폴백) ── */
function bindOpts(){
  var btns=elOpts.querySelectorAll(".opt");
  for(var i=0;i<btns.length;i++){
    (function(btn){
      var tapped=false;
      btn.addEventListener("touchend",function(e){
        e.preventDefault();
        tapped=true;
        handleTap(btn);
        setTimeout(function(){tapped=false;},400);
      },false);
      btn.addEventListener("click",function(){
        if(tapped) return; // touchend가 이미 처리함
        handleTap(btn);
      },false);
    })(btns[i]);
  }
}

/* ── 질문 전환 시 전체 렌더 ── */
function render(){
  var q=Q[state.step];
  var total=Q.length;
  elStep.textContent=(state.step+1)+" / "+total;
  elBar.style.width=(((state.step+1)/total)*100)+"%";
  elTitle.textContent=q.title;
  elHelp.textContent=q.help||"";
  elOpts.innerHTML=buildOptions(q);
  bindOpts();
  elNext.textContent=state.step===total-1?"\uACB0\uACFC \uD655\uC778\uD558\uAE30":"\uB2E4\uC74C";
  elPrev.disabled=state.step===0;
  notifyH();
}

/* ── 높이 알림 ── */
function notifyH(){
  try{
    var el=document.getElementById("survey");
    var h=Math.max(
      el?el.offsetHeight:0,
      document.body?document.body.scrollHeight:0,
      document.documentElement?document.documentElement.scrollHeight:0
    );
    if(h>0) window.parent.postMessage({type:"ansim-survey-height",height:h+16},"*");
  }catch(e){}
}
function notifyHSoon(){
  notifyH();
  [50,200,500,1000].forEach(function(ms){setTimeout(notifyH,ms);});
}

/* ── next / prev 바인딩 ── */
function bindNav(el,fn){
  if(!el) return;
  var t=false;
  el.addEventListener("touchend",function(e){
    e.preventDefault(); t=true; fn();
    setTimeout(function(){t=false;},400);
  },false);
  el.addEventListener("click",function(){if(!t)fn();},false);
}

bindNav(elNext,function(){
  if(state.step<Q.length-1){state.step++;render();scrollTop();}
  else finish();
});
bindNav(elPrev,function(){
  if(state.step>0){state.step--;render();scrollTop();}
});

function scrollTop(){
  try{window.parent.postMessage({type:"ansim-survey-scrolltop"},"*");}catch(e){}
}
function finish(){
  try{window.parent.postMessage({type:"ansim-survey-complete",answers:JSON.parse(JSON.stringify(state.answers))},"*");}catch(e){}
}

window.addEventListener("message",function(ev){
  if(ev.data&&ev.data.type==="ansim-survey-reset"){
    state={step:0,answers:{}}; render(); scrollTop();
  }
});

render();
window.addEventListener("load",notifyHSoon);
window.addEventListener("resize",notifyH);
if(document.readyState==="complete") notifyHSoon();

})();
</script>
</body>
</html>`;


const outPath = path.join(process.cwd(), "public", "diagnosis.html");
fs.writeFileSync(outPath, html, { encoding: "utf8" });
console.log("\uC644\uB8CC:", outPath);
