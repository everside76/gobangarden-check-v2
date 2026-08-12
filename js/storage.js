/* ============================================================
   기기 저장소 (localStorage) — 설정 · 점검 이력 · 임시저장
   ============================================================ */
window.MOT = window.MOT || {};

MOT.store = (function () {
  "use strict";
  var LS = MOT.LS;

  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function set(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function remove(key) { try { localStorage.removeItem(key); } catch (e) {} }
  function getJSON(key, fallback) {
    try { var v = JSON.parse(get(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function setJSON(key, v) { return set(key, JSON.stringify(v)); }

  /* ---------- 설정 ---------- */
  function settings()          { return getJSON(LS.settings, {}); }
  function saveSettings(s)     { return setJSON(LS.settings, s); }
  function scriptUrl() {
    var s = settings();
    return String(s.scriptUrl || MOT.config.SCRIPT_URL || "").trim();
  }

  /* ---------- 점검 이력 ---------- */
  function history()           { return getJSON(LS.history, []); }
  function saveHistory(arr)    { return setJSON(LS.history, arr); }
  function upsertHistory(session) {
    var hist = history();
    var idx = hist.findIndex(function (h) { return h.id === session.id; });
    var copy = JSON.parse(JSON.stringify(session));
    if (idx >= 0) hist[idx] = copy; else hist.unshift(copy);
    if (hist.length > 200) hist = hist.slice(0, 200);
    saveHistory(hist);
    return hist;
  }
  function findHistory(id)     { return history().find(function (h) { return h.id === id; }) || null; }
  function removeHistory(id) {
    saveHistory(history().filter(function (h) { return h.id !== id; }));
  }

  /* ---------- 임시저장(작성 중인 점검) ---------- */
  function draft()             { return getJSON(LS.draft, null); }
  function saveDraft(session)  { return setJSON(LS.draft, session); }
  function clearDraft()        { remove(LS.draft); }

  /* ---------- 최근 입력값 (다음 점검 기본값) ---------- */
  function lastInput()         { return getJSON(LS.lastInput, {}); }
  function saveLastInput(v)    { return setJSON(LS.lastInput, v); }

  /* ---------- 체크리스트 캐시 ---------- */
  function checklistCache()    { return getJSON(LS.checklist, null); }
  function saveChecklistCache(data) { return setJSON(LS.checklist, data); }
  function clearChecklistCache()    { remove(LS.checklist); }

  return {
    get: get, set: set, remove: remove, getJSON: getJSON, setJSON: setJSON,
    settings: settings, saveSettings: saveSettings, scriptUrl: scriptUrl,
    history: history, saveHistory: saveHistory, upsertHistory: upsertHistory,
    findHistory: findHistory, removeHistory: removeHistory,
    draft: draft, saveDraft: saveDraft, clearDraft: clearDraft,
    lastInput: lastInput, saveLastInput: saveLastInput,
    checklistCache: checklistCache, saveChecklistCache: saveChecklistCache,
    clearChecklistCache: clearChecklistCache
  };
})();
