/* ============================================================
   채점 엔진 — 순수 계산만 담당 (화면·저장소에 의존하지 않음)

   [채점 방식]
   ① '일반' 문항 (24개, 이행 점수 합계 100점)
        이행   → 시트의 '이행시 점수'
        미흡   → 시트의 '미흡시 점수'
        불이행 → 0점
        해당없음 · 미응답 → 채점 제외 (분자·분모 모두에서 빠짐)
      기본점수 = 획득합계 ÷ 채점대상 만점 × 100  (반올림)

   ② '상황발생시' 문항 (6개)
        기본값은 '미발생' — 채점과 무관
        발생했을 때만 판정하며, 불이행일 때만 시트의 '불이행시 점수'(−2·−4)를 차감

   ③ 절대 금지 10계명
        위반 1건당 시트에 적힌 감점(기본 5점)을 차감

   최종점수 = 기본점수 − 상황감점 − 10계명감점  (0~100 범위로 자름)

   ※ 점수는 어떤 경우에도 코드에서 만들어내지 않고 시트 값을 그대로 씁니다.
     시트에서 배점을 바꾸면 코드 수정 없이 그대로 반영됩니다.
   ============================================================ */
window.MOT = window.MOT || {};

MOT.scoring = (function () {
  "use strict";

  var KIND_NORMAL = "일반";
  var KIND_SITU   = "상황발생시";
  var WHO_COMMON  = "매장공통";

  var LABEL = { O: "이행", T: "미흡", X: "불이행", N: "해당없음" };

  function isSituational(it) { return it && it.kind === KIND_SITU; }
  function isNormal(it)      { return !isSituational(it); }   // 구분이 비어 있으면 일반으로 간주

  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

  /* 문항 하나의 획득 점수 ('일반' 문항 전용) */
  function gotOf(it, value) {
    if (value === "O") return num(it.scoreO);
    if (value === "T") return num(it.scoreT);
    return 0;                       // 불이행
  }

  /* 상황발생시 문항의 감점액 (양수로 반환).
     시트의 점수 컬럼을 그대로 씁니다 — 미흡 점수에 음수가 적혀 있으면 그만큼 감점하고,
     0이면 감점하지 않습니다. (현재 시트는 미흡 0점이라 불이행일 때만 깎입니다) */
  function penaltyOf(it, value) {
    if (value === "X") return Math.abs(num(it.scoreX));
    if (value === "T") return Math.abs(num(it.scoreT));
    return 0;
  }

  /* 응답 꺼내기 — 상황발생시 문항은 '발생함'으로 표시된 경우에만 판정값이 유효 */
  function answerOf(answers, it) {
    var a = (answers && answers[it.no]) || {};
    if (isSituational(it)) {
      return { occurred: !!a.occurred, value: a.occurred ? (a.value || "") : "", note: a.note || "" };
    }
    return { occurred: true, value: a.value || "", note: a.note || "" };
  }

  function gradeOf(score, cuts) {
    for (var i = 0; i < cuts.length; i++) if (score >= cuts[i].min) return cuts[i].grade;
    return cuts[cuts.length - 1].grade;
  }

  function capOfRate(rate, caps) {
    for (var i = 0; i < caps.length; i++) if (rate >= caps[i].min) return caps[i].cap;
    return null;
  }

  /* 등급 상한 적용 — 낮은 쪽을 채택하며, 상한이 등급을 올리지는 않음 */
  function applyCap(grade, cap, order) {
    if (!cap) return grade;
    return order.indexOf(cap) > order.indexOf(grade) ? cap : grade;
  }

  /**
   * 채점
   * @param {Object} checklist  {items:[], rules:[], stages:[]}
   * @param {Object} answers    {문항번호: {value:'O'|'T'|'X'|'N', occurred:bool, note}}
   * @param {Object} ruleState  {계명번호: {occurred:bool, action}}
   * @param {Object} cfg        MOT.config (등급 컷·상한 기준)
   */
  function compute(checklist, answers, ruleState, cfg) {
    var items = (checklist && checklist.items) || [];
    var rules = (checklist && checklist.rules) || [];
    answers = answers || {};
    ruleState = ruleState || {};

    var cuts  = cfg.GRADE_CUTS;
    var caps  = cfg.RATE_CAPS;
    var order = cuts.map(function (c) { return c.grade; });

    var normalGot = 0, normalMax = 0;          // 채점 대상(응답한 일반 문항)의 획득·만점
    var normalTotal = 0, fullMax = 0;          // 일반 문항 전체 수·전체 만점
    var ok = 0, tri = 0, x = 0, na = 0, unanswered = 0;
    var situPenalty = 0, situOccurred = 0, situNotOccurred = 0, situUnanswered = 0;
    var personalGot = 0, personalMax = 0, commonGot = 0, commonMax = 0;
    var stageMap = {};                          // 단계별 집계
    var deducted = [];                          // 결과 화면용 감점 내역

    function stage(name) {
      if (!stageMap[name]) stageMap[name] = { got: 0, max: 0, penalty: 0, total: 0, answered: 0, na: 0 };
      return stageMap[name];
    }

    items.forEach(function (it) {
      var st = stage(it.stage || "기타");
      st.total++;
      var a = answerOf(answers, it);

      if (isSituational(it)) {
        if (!a.occurred) { situNotOccurred++; return; }
        situOccurred++;
        if (!a.value) { situUnanswered++; return; }     // 발생 표시만 하고 판정 안 함
        st.answered++;
        if (a.value === "O") ok++;
        else if (a.value === "T") tri++;
        else if (a.value === "X") x++;
        var p = penaltyOf(it, a.value);
        if (p > 0) {
          situPenalty += p;
          st.penalty += p;
          deducted.push({ no: it.no, stage: it.stage, kind: it.kind, who: it.who, text: it.text,
                          value: a.value, label: LABEL[a.value], amount: p, note: a.note });
        }
        return;
      }

      /* ── 일반 문항 ── */
      normalTotal++;
      fullMax += num(it.scoreO);

      if (a.value === "N") { na++; st.na++; return; }
      if (!a.value)        { unanswered++; return; }

      st.answered++;
      var max = num(it.scoreO);
      var got = gotOf(it, a.value);

      normalMax += max;  normalGot += got;
      st.max += max;     st.got += got;

      if (it.who === WHO_COMMON) { commonMax += max; commonGot += got; }
      else                       { personalMax += max; personalGot += got; }

      if (a.value === "O") ok++;
      else if (a.value === "T") tri++;
      else if (a.value === "X") x++;

      if (got < max) {
        deducted.push({ no: it.no, stage: it.stage, kind: it.kind, who: it.who, text: it.text,
                        value: a.value, label: LABEL[a.value], amount: max - got, note: a.note });
      }
    });

    /* 10계명 */
    var ruleViolations = rules.filter(function (r) { return (ruleState[r.no] || {}).occurred; });
    var rulePenalty = ruleViolations.reduce(function (s, r) {
      var p = r.penalty === undefined ? 5 : Math.abs(num(r.penalty));
      return s + p;
    }, 0);

    /* 점수 산출 */
    var baseScore = normalMax > 0 ? Math.round(normalGot / normalMax * 100) : 0;
    var score = Math.max(0, Math.min(100, baseScore - situPenalty - rulePenalty));

    /* 점검율 — 분모는 '일반' 문항 전체(24). 해당없음·미응답은 분자에서만 빠집니다.
       상황발생시 문항은 상황이 없으면 점검 자체가 불가하므로 분모에서 제외합니다. */
    var inspected = normalTotal - na - unanswered;
    var inspectRate = normalTotal > 0 ? inspected / normalTotal * 100 : 0;
    var rateShown = Math.round(inspectRate * 10) / 10;

    var gradeBeforeCap = gradeOf(score, cuts);
    var gradeCap = normalTotal > 0 ? capOfRate(rateShown, caps) : null;
    var grade = applyCap(gradeBeforeCap, gradeCap, order);
    var needsRecheck = normalTotal > 0 && rateShown < cfg.RECHECK_RATE;

    /* 전 항목이 해당없음인 단계 */
    var naStages = Object.keys(stageMap).filter(function (s) {
      var m = stageMap[s];
      return m.total > 0 && m.na === m.total;
    });

    deducted.sort(function (a, b) { return b.amount - a.amount; });

    return {
      items: items,
      // 점수
      score: score, baseScore: baseScore,
      normalGot: normalGot, normalMax: normalMax, fullMax: fullMax,
      situPenalty: situPenalty, rulePenalty: rulePenalty,
      // 등급
      grade: grade, gradeBeforeCap: gradeBeforeCap, gradeCap: gradeCap,
      capApplied: !!gradeCap && grade !== gradeBeforeCap,
      // 응답 집계
      ok: ok, tri: tri, x: x, na: na, unanswered: unanswered,
      normalTotal: normalTotal, total: items.length,
      situOccurred: situOccurred, situNotOccurred: situNotOccurred, situUnanswered: situUnanswered,
      situTotal: items.length - normalTotal,
      // 점검율 (분모 = 일반 문항 전체)
      inspected: inspected, inspectRate: inspectRate, rateShown: rateShown, needsRecheck: needsRecheck,
      // 구분별
      personalGot: personalGot, personalMax: personalMax,
      commonGot: commonGot, commonMax: commonMax,
      // 상세
      stageMap: stageMap, naStages: naStages, deducted: deducted,
      ruleViolations: ruleViolations
    };
  }

  /**
   * 결과 화면으로 넘어갈 수 있는지 확인
   *  - 일반 문항 미응답이 있으면 막음
   *  - 상황 '발생함'으로 표시했는데 판정하지 않은 문항이 있으면 막음
   */
  function validate(checklist, answers) {
    var items = (checklist && checklist.items) || [];
    var missing = [];
    items.forEach(function (it) {
      var a = answerOf(answers, it);
      if (isSituational(it)) {
        if (a.occurred && !a.value) missing.push({ no: it.no, stage: it.stage, reason: "situ" });
      } else if (!a.value) {
        missing.push({ no: it.no, stage: it.stage, reason: "unanswered" });
      }
    });
    return { ok: missing.length === 0, missing: missing };
  }

  /** 진행률 표시용 — 응답이 필요한 문항 중 몇 개를 처리했는지 */
  function progress(checklist, answers) {
    var items = (checklist && checklist.items) || [];
    var done = 0;
    items.forEach(function (it) {
      var a = answerOf(answers, it);
      if (isSituational(it)) { if (!a.occurred || a.value) done++; }   // 미발생 처리도 완료로 봄
      else if (a.value) done++;
    });
    return { done: done, total: items.length, pct: items.length ? Math.round(done / items.length * 100) : 0 };
  }

  /** 구글 시트 전송용 페이로드의 items 부분 */
  function itemRows(checklist, answers) {
    var items = (checklist && checklist.items) || [];
    return items.map(function (it) {
      var a = answerOf(answers, it);
      var label, max, got, penalty;
      if (isSituational(it)) {
        label   = !a.occurred ? "상황없음" : (LABEL[a.value] || "미응답");
        max     = 0;
        got     = 0;
        penalty = a.occurred ? penaltyOf(it, a.value) : 0;
      } else {
        label   = LABEL[a.value] || "미응답";
        max     = num(it.scoreO);
        got     = (a.value === "N" || !a.value) ? 0 : gotOf(it, a.value);
        penalty = (a.value === "N" || !a.value) ? 0 : max - got;
      }
      return { no: it.no, stage: it.stage, kind: it.kind, who: it.who, text: it.text,
               value: a.value, label: label, max: max, got: got, penalty: penalty, note: a.note || "" };
    });
  }

  return {
    KIND_NORMAL: KIND_NORMAL, KIND_SITU: KIND_SITU, WHO_COMMON: WHO_COMMON, LABEL: LABEL,
    isSituational: isSituational, isNormal: isNormal,
    gotOf: gotOf, penaltyOf: penaltyOf, answerOf: answerOf,
    compute: compute, validate: validate, progress: progress, itemRows: itemRows
  };
})();
