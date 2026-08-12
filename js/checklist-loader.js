/* ============================================================
   체크리스트 로더 — 구글 시트에서 문항을 가져옵니다.

   [불러오는 순서]
     ① 기기에 저장된 캐시가 있으면 즉시 그것으로 화면을 띄우고,
        뒤에서 조용히 시트를 확인해 바뀐 게 있으면 캐시를 갱신합니다.
     ② 캐시가 없으면 시트를 직접 불러옵니다. (로딩 표시)
     ③ 시트에 연결할 수 없고 캐시도 없으면 앱에 내장된 스냅샷을 씁니다.

   점검을 시작하는 순간의 문항이 그대로 고정되므로,
   점검 도중 시트가 바뀌어도 진행 중인 점검은 영향을 받지 않습니다.
   ============================================================ */
window.MOT = window.MOT || {};

MOT.checklist = (function () {
  "use strict";

  var current = null;          // 현재 사용 중인 체크리스트
  var listeners = [];

  function onChange(fn) { listeners.push(fn); }
  function emit(reason) { listeners.forEach(function (fn) { try { fn(current, reason); } catch (e) {} }); }

  /* 시트 응답이 쓸 만한 형태인지 확인 */
  function usable(data) {
    return !!(data && data.result === "success" && data.items && data.items.length);
  }

  function stamp(data, source) {
    data.source = source;                       // sheet | cache | seed
    data.loadedAt = new Date().toISOString();
    return data;
  }

  /* 두 체크리스트가 실질적으로 같은지 (버전 + 내용 해시) */
  function same(a, b) {
    if (!a || !b) return false;
    return String(a.version || "") === String(b.version || "") &&
           String(a.contentHash || "") === String(b.contentHash || "");
  }

  function fromSeed() {
    return stamp(JSON.parse(JSON.stringify(MOT.seed)), "seed");
  }

  function fromCache() {
    var c = MOT.store.checklistCache();
    return usable(c) ? c : null;
  }

  /**
   * 체크리스트 준비.
   * @param {Function} onReady  (checklist) => void   화면을 그릴 수 있게 되면 호출
   * @param {Function} onNotice (message, level) => void  안내 문구 (level: info|warn|error)
   */
  function init(onReady, onNotice) {
    var notice = onNotice || function () {};
    var cached = fromCache();

    if (cached) {
      current = cached;
      current.source = "cache";
      onReady(current);
      refresh(true, notice);                    // 뒤에서 조용히 최신 확인
      return;
    }

    if (!MOT.api.hasUrl()) {                    // 시트 주소가 아직 없으면 내장본으로 시작
      current = fromSeed();
      onReady(current);
      notice("구글 시트에 연결되어 있지 않습니다. 앱에 내장된 체크리스트(" + current.version + ")로 점검합니다.", "warn");
      return;
    }

    MOT.api.fetchChecklist().then(function (data) {
      if (!usable(data)) throw new Error((data && data.message) || "체크리스트를 읽지 못했습니다");
      current = stamp(data, "sheet");
      /* 검증을 통과한 것만 기기에 저장합니다.
         문제가 있는 체크리스트를 캐시에 남기면 다음 실행에서도 계속 쓰이게 되므로,
         이번 한 번만 쓰고 시트를 고치면 바로 새로 받아가도록 합니다. */
      if (data.valid) MOT.store.saveChecklistCache(current);
      onReady(current);
      if (!data.valid) notice(issueText(data) + " — 시트를 고친 뒤 설정에서 '구글 시트에서 다시 불러오기'를 눌러 주세요.", "error");
    }).catch(function (err) {
      current = fromSeed();
      onReady(current);
      notice("구글 시트에 연결하지 못해 앱에 내장된 체크리스트(" + current.version + ")로 점검합니다. (" + err.message + ")", "warn");
    });
  }

  /**
   * 시트에서 최신 문항을 다시 가져옵니다.
   * @param {boolean} quiet  조용히 확인(실패해도 알리지 않음)
   */
  function refresh(quiet, onNotice) {
    var notice = onNotice || function () {};
    if (!MOT.api.hasUrl()) {
      if (!quiet) notice("구글 시트 주소가 설정되지 않았습니다. 설정 화면에서 입력해 주세요.", "error");
      return Promise.resolve(current);
    }
    return MOT.api.fetchChecklist(!quiet).then(function (data) {
      if (!usable(data)) throw new Error((data && data.message) || "체크리스트를 읽지 못했습니다");

      if (!data.valid && current && current.valid !== false) {
        // 시트에 문제가 있으면 기존 정상본을 유지하고 알림만 (현장 점검이 멈추지 않도록)
        notice(issueText(data) + " — 직전 정상 체크리스트로 계속 점검합니다.", "error");
        return current;
      }

      var changed = !same(current, data);
      current = stamp(data, "sheet");
      if (data.valid) MOT.store.saveChecklistCache(current);
      else MOT.store.clearChecklistCache();      // 문제 있는 체크리스트는 기기에 남기지 않음
      emit(changed ? "updated" : "same");

      if (!data.valid) notice(issueText(data), "error");
      else if (changed) notice("체크리스트가 " + (data.version || "최신본") + " 으로 갱신됐어요. (" + data.items.length + "문항)", "info");
      else if (!quiet) notice("이미 최신 체크리스트예요. (" + (data.version || "") + ")", "info");
      return current;
    }).catch(function (err) {
      if (!quiet) notice("체크리스트를 가져오지 못했어요. " + err.message, "error");
      return current;
    });
  }

  function issueText(data) {
    var n = (data.issues || []).length;
    return "⚠️ 체크리스트에 확인이 필요한 부분이 " + n + "건 있어요. " + (data.issues || [])[0] +
           (n > 1 ? " 외 " + (n - 1) + "건" : "");
  }

  function get() { return current; }

  /* 점검 시작 시점의 문항을 통째로 복사해 세션에 고정 */
  function snapshot() {
    if (!current) return null;
    return {
      version: current.version || "",
      contentHash: current.contentHash || "",
      source: current.source || "",
      stages: (current.stages || []).slice(),
      items: JSON.parse(JSON.stringify(current.items || [])),
      rules: JSON.parse(JSON.stringify(current.rules || []))
    };
  }

  /* 상태 배지용 문구 */
  function statusText() {
    if (!current) return { text: "체크리스트 불러오는 중…", level: "info" };
    var n = (current.items || []).length;
    if (current.source === "sheet")
      return { text: "체크리스트 " + (current.version || "") + " · " + n + "문항 · 시트 연결됨", level: "ok" };
    if (current.source === "cache")
      return { text: "체크리스트 " + (current.version || "") + " · " + n + "문항 · 저장된 사본", level: "info" };
    return { text: "체크리스트 " + (current.version || "") + " · " + n + "문항 · 앱 내장본", level: "warn" };
  }

  return { init: init, refresh: refresh, get: get, snapshot: snapshot,
           statusText: statusText, onChange: onChange };
})();
