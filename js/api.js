/* ============================================================
   구글 시트 통신 (Apps Script 웹앱)
   ============================================================ */
window.MOT = window.MOT || {};

MOT.api = (function () {
  "use strict";

  function url() { return MOT.store.scriptUrl(); }
  function hasUrl() { return !!url(); }

  /* 제한시간이 있는 fetch */
  function fetchTimeout(target, options, ms) {
    options = options || {};
    ms = ms || MOT.config.NETWORK_TIMEOUT;
    if (typeof AbortController === "undefined") return fetch(target, options);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    options.signal = ctrl.signal;
    return fetch(target, options).finally(function () { clearTimeout(timer); });
  }

  function getJSON(params) {
    if (!hasUrl()) return Promise.reject(new Error("구글 시트 주소가 설정되지 않았습니다"));
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    return fetchTimeout(url() + "?" + qs).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  /* 체크리스트 문항 가져오기 */
  function fetchChecklist(fresh) {
    return getJSON(fresh ? { action: "checklist", fresh: "1" } : { action: "checklist" });
  }

  /* 점포명 목록 */
  function fetchStores() {
    return getJSON({ action: "stores" }).then(function (d) {
      return (d && d.result === "success") ? (d.stores || []) : [];
    });
  }

  /* 온라인 점검이력 */
  function fetchList() {
    return getJSON({ action: "list" }).then(function (d) {
      return (d && d.result === "success") ? (d.list || []) : [];
    });
  }

  function fetchDetail(id) {
    return getJSON({ action: "detail", id: id });
  }

  /* 결과 전송 — Apps Script는 text/plain 으로 받아야 preflight 없이 통과
     제한시간을 넉넉히 둡니다. Apps Script가 한동안 쉬었다가 처음 깨어날 때(콜드스타트)
     20초를 넘기는 일이 있어, 실제로는 저장됐는데 앱만 '실패'로 보이는 문제가 있었습니다. */
  function send(payload) {
    if (!hasUrl()) return Promise.reject(new Error("구글 시트 주소가 설정되지 않았습니다"));
    return fetchTimeout(url(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }, 60000).then(function (res) {
      return res.json().catch(function () { return { result: res.ok ? "success" : "error" }; });
    }).then(function (j) {
      if (j && (j.result === "success" || j.ok)) return j;
      throw new Error((j && j.message) || "전송 실패");
    });
  }

  return { hasUrl: hasUrl, url: url, fetchChecklist: fetchChecklist, fetchStores: fetchStores,
           fetchList: fetchList, fetchDetail: fetchDetail, send: send };
})();
