/**
 * ============================================================
 *  고반가든 MOT 점검 V2 — 구글 스프레드시트 스크립트
 *
 *  [설치 위치]  결과 스프레드시트 "MOT_고반가든_점검결과_V2" 에 붙입니다.
 *    1. 결과 시트 열기 → [확장 프로그램] → [Apps Script]
 *    2. 기존 코드 전부 지우고 이 파일 내용 전체를 붙여넣기
 *    3. 함수 목록에서 setupSheets 선택 → [실행] (최초 1회, 권한 승인 필요)
 *       → 결과 시트에 '점검요약'·'항목상세' 탭이,
 *         체크리스트 시트에 '메타'·'10계명'·'점포명' 탭이 자동 생성됩니다.
 *    4. [배포] → [새 배포] → 유형 "웹 앱"
 *         - 실행 계정: 나
 *         - 액세스 권한: 모든 사용자
 *    5. 생성된 .../exec URL을 앱 js/config.js 의 SCRIPT_URL 에 입력
 *
 *  [문항 원천]  MOT_고반가든_체크리스트 스프레드시트 (아래 CHECKLIST_SS_ID)
 *    앱은 이 스크립트를 통해 문항을 실시간으로 읽어갑니다.
 *    ※ V1 스크립트/시트는 전혀 건드리지 않습니다.
 * ============================================================
 */

/* ---------- 설정 ---------- */
var CHECKLIST_SS_ID = '1oRr-n4OX9Ue0BX51IN1uJ2trVMB7aDYVsy1woX-cUQE';  // MOT_고반가든_체크리스트

var SH_CHECKLIST = '체크리스트';   // 없으면 첫 번째 탭을 자동 사용
var SH_META      = '메타';
var SH_RULES     = '10계명';
var SH_STORES    = '점포명';
var SH_SUMMARY   = '점검요약';
var SH_DETAIL    = '항목상세';

var BRAND        = '고반가든';
var CACHE_KEY    = 'checklist_gdn_v2';
var CACHE_SEC    = 600;            // 체크리스트 응답 캐시 10분
var EXPECTED_MAX = 100;            // '일반' 문항 이행점수 합계 기대값

/* ---------- 시트 헤더 ----------
 * 1~26번은 V1 '점검요약'과 완전히 동일(순서·이름). 이후가 V2 확장 컬럼.
 * → 나중에 V1 결과와 통합할 때 앞 26열을 그대로 이어붙일 수 있습니다.
 */
var HEAD_SUMMARY = [
  // ── V1 호환 구간 (1~26) ──
  '전송일시','점검ID','브랜드','지점명','피점검자','점검자','점검일','요일','점검구분','주문방식',
  '총점','등급','가산점','이행(○)','미흡(△)','불이행(✕)','미응답','10계명위반','총항목수','종합코멘트',
  '해당없음','제외단계(해당없음)','원점수','만점','점검시간','홀근무인원',
  // ── V2 확장 구간 (27~) ──
  '점검율','점수등급','등급상한','상황감점','상황발생건수','10계명감점',
  '개인획득','개인만점','매장공통획득','매장공통만점','체크리스트버전','체크리스트해시'
];

// 1~13번은 V1 '항목상세'와 완전히 동일. 이후가 V2 확장 컬럼.
var HEAD_DETAIL = [
  // ── V1 호환 구간 (1~13) ──
  '전송일시','점검ID','브랜드','지점명','점검일','No','단계','구분','항목','응답','감점','가산','비고',
  // ── V2 확장 구간 (14~) ──
  '배점','획득점수','일반구분','개인구분','체크리스트버전'
];

/* ============================================================
 *  GET — 앱이 읽어가는 데이터
 *    ?action=checklist : 문항 + 10계명 + 버전 (앱 구동에 필수)
 *    ?action=stores    : 점포명 자동완성 목록
 *    ?action=list      : 점검요약 최신 300건
 *    ?action=detail&id : 점검 1건 상세
 * ============================================================ */
function doGet(e) {
  var action = (e && e.parameter) ? e.parameter.action : '';
  try {
    if (action === 'checklist') {
      var fresh = e.parameter.fresh === '1';
      return json_(getChecklist_(fresh));
    }
    if (action === 'stores') return json_({ result: 'success', stores: listStores_() });
    if (action === 'list')   return json_({ result: 'success', list: listSummaries_() });
    if (action === 'detail') return json_(getDetail_(e.parameter.id));
  } catch (err) {
    return json_({ result: 'error', message: String(err) });
  }
  return json_({ result: 'ok', message: '고반가든 MOT V2 수신 서버가 정상 동작 중입니다.' });
}

/* ---------- 체크리스트 로딩 ---------- */
function getChecklist_(skipCache) {
  var cache = CacheService.getScriptCache();
  if (!skipCache) {
    var hit = cache.get(CACHE_KEY);
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  }

  var ss = SpreadsheetApp.openById(CHECKLIST_SS_ID);
  var sh = ss.getSheetByName(SH_CHECKLIST) || ss.getSheets()[0];
  var values = sh.getDataRange().getValues();

  // 헤더 행 자동 탐지 — '순서'와 '체크항목'이 함께 있는 첫 행
  var headRow = -1, col = {};
  for (var r = 0; r < Math.min(values.length, 20); r++) {
    var map = {}, hasNo = false, hasText = false;
    for (var c = 0; c < values[r].length; c++) {
      var name = String(values[r][c] == null ? '' : values[r][c]).trim();
      if (!name) continue;
      map[name] = c;
      if (name === '순서') hasNo = true;
      if (name === '체크항목') hasText = true;
    }
    if (hasNo && hasText) { headRow = r; col = map; break; }
  }
  if (headRow < 0) {
    return { result: 'error', message: '체크리스트 시트에서 헤더 행(순서·체크항목)을 찾지 못했습니다.' };
  }

  var need = ['순서','단계','일반구분','개인구분','체크항목','이행시 점수','미흡시 점수','불이행시 점수'];
  var missing = need.filter(function (n) { return col[n] === undefined; });
  if (missing.length) {
    return { result: 'error', message: '필수 열 누락: ' + missing.join(', '), missing: missing };
  }

  var items = [], stages = [], issues = [], normalMax = 0, seenNo = {};
  for (var i = headRow + 1; i < values.length; i++) {
    var row = values[i];
    var no = String(row[col['순서']] == null ? '' : row[col['순서']]).trim();
    var text = String(row[col['체크항목']] == null ? '' : row[col['체크항목']]).trim();
    if (!no || !text) continue;                       // 빈 행·합계 행 건너뜀

    /* 시트에 '매장  공통'처럼 공백이 섞여 들어와도 인식되도록 내부 공백을 없앱니다 */
    var kind = String(row[col['일반구분']] || '').replace(/\s+/g, '');   // 일반 / 상황발생시
    var who  = String(row[col['개인구분']] || '').replace(/\s+/g, '');   // 개인 / 매장공통
    var stage = String(row[col['단계']] || '').trim();

    var it = {
      no: no,
      stage: stage,
      kind: kind,
      who: who,
      text: text,
      critO: cell_(row, col, '이행 기준'),
      critT: cell_(row, col, '미흡 기준'),
      critX: cell_(row, col, '불이행 기준'),
      scoreO: num_(row[col['이행시 점수']]),
      scoreT: num_(row[col['미흡시 점수']]),
      scoreX: num_(row[col['불이행시 점수']])
    };

    if (seenNo[no]) issues.push(no + '번: 순서가 중복됩니다 (문항 번호는 겹치면 안 됩니다)');
    seenNo[no] = true;

    if (kind !== '일반' && kind !== '상황발생시') issues.push(no + '번: 일반구분 값이 "' + kind + '" (일반/상황발생시 중 하나여야 함)');
    if (who !== '개인' && who !== '매장공통')     issues.push(no + '번: 개인구분 값이 "' + who + '" (개인/매장공통 중 하나여야 함)');
    if (!stage) issues.push(no + '번: 단계가 비어 있음');

    if (kind === '일반') {
      if (!(it.scoreO > 0)) issues.push(no + '번: 일반 문항인데 이행시 점수가 0 이하');
      normalMax += it.scoreO;
    } else if (kind === '상황발생시') {
      if (!(it.scoreX < 0)) issues.push(no + '번: 상황발생시 문항인데 불이행시 점수가 음수가 아님');
    }

    if (stage && stages.indexOf(stage) < 0) stages.push(stage);
    items.push(it);
  }

  if (!items.length) return { result: 'error', message: '체크리스트에 문항이 없습니다.' };
  if (normalMax !== EXPECTED_MAX) {
    issues.push("'일반' 문항 이행점수 합계가 " + normalMax + '점입니다. (' + EXPECTED_MAX + '점이어야 함)');
  }

  var meta = readMeta_(ss);
  var ruleOut = readRules_(ss);
  if (ruleOut.issue) issues.push(ruleOut.issue);

  var out = {
    result: 'success',
    valid: issues.length === 0,
    issues: issues,
    version: meta.version,
    revisedAt: meta.revisedAt,
    contentHash: hash_(JSON.stringify(items)),
    normalMax: normalMax,
    stages: stages,
    items: items,
    rules: ruleOut.rules,
    fetchedAt: nowStr_()
  };
  // 검증을 통과한 것만 캐시에 둡니다. 문제가 있으면 시트를 고치는 즉시 다시 읽히도록.
  if (out.valid) { try { cache.put(CACHE_KEY, JSON.stringify(out), CACHE_SEC); } catch (e) {} }
  return out;
}

function cell_(row, col, name) {
  if (col[name] === undefined) return '';
  var v = row[col[name]];
  return String(v == null ? '' : v).trim();
}

function readMeta_(ss) {
  var sh = ss.getSheetByName(SH_META);
  var out = { version: '', revisedAt: '' };
  if (!sh || sh.getLastRow() < 1) return out;
  var vals = sh.getDataRange().getValues();
  var tz = ss.getSpreadsheetTimeZone() || 'Asia/Seoul';
  vals.forEach(function (r) {
    var k = String(r[0] == null ? '' : r[0]).trim();
    var v = r[1];
    if (k === '체크리스트버전') out.version = String(v == null ? '' : v).trim();
    if (k === '개정일')        out.revisedAt = fmtDate_(v, tz, 'yyyy-MM-dd');
  });
  return out;
}

/** 10계명 탭 읽기 — {rules:[], issue:''} 반환. 헤더가 잘못돼 조용히 비는 일이 없게 사유를 함께 알립니다. */
function readRules_(ss) {
  var sh = ss.getSheetByName(SH_RULES);
  if (!sh) return { rules: [], issue: "'" + SH_RULES + "' 탭이 없습니다. setupSheets 를 실행해 주세요." };
  if (sh.getLastRow() < 2) return { rules: [], issue: "'" + SH_RULES + "' 탭에 내용이 없습니다." };

  var vals = sh.getDataRange().getValues();
  var head = vals[0].map(function (v) { return String(v == null ? '' : v).trim(); });
  var iNo = head.indexOf('번호'), iKey = head.indexOf('구분'), iDesc = head.indexOf('내용'), iPen = head.indexOf('감점');
  if (iDesc < 0) {
    return { rules: [], issue: "'" + SH_RULES + "' 탭의 첫 행에 '내용' 열이 없습니다. (필요한 헤더: 번호 · 구분 · 내용 · 감점)" };
  }

  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var no = String(vals[i][iNo < 0 ? 0 : iNo] == null ? '' : vals[i][iNo < 0 ? 0 : iNo]).trim();
    var desc = String(vals[i][iDesc] || '').trim();
    if (!no || !desc) continue;
    // 시트가 '01'을 숫자 1로 저장해도 V1과 같은 두 자리 표기(01~10)로 맞춥니다.
    if (/^\d$/.test(no)) no = '0' + no;
    out.push({
      no: no,
      key: iKey >= 0 ? String(vals[i][iKey] || '').trim() : '',
      desc: desc,
      penalty: iPen >= 0 ? Math.abs(num_(vals[i][iPen])) : 5
    });
  }
  return { rules: out, issue: out.length ? '' : "'" + SH_RULES + "' 탭에서 읽어들인 항목이 없습니다." };
}

function listStores_() {
  var ss = SpreadsheetApp.openById(CHECKLIST_SS_ID);
  var sh = ss.getSheetByName(SH_STORES);
  if (!sh || sh.getLastRow() < 1) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  var HEADERS = { '점포명': 1, '지점명': 1, '매장명': 1, '점포': 1, 'store': 1, 'Store': 1 };
  var out = [], seen = {};
  vals.forEach(function (r) {
    var v = (r[0] == null ? '' : String(r[0])).trim();
    if (!v || HEADERS[v] || seen[v]) return;
    seen[v] = true; out.push(v);
  });
  return out;
}

/* ============================================================
 *  POST — 점검 결과 저장
 * ============================================================ */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tz = ss.getSpreadsheetTimeZone() || 'Asia/Seoul';
    var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');

    var summary = getOrCreateSheet_(ss, SH_SUMMARY, HEAD_SUMMARY);
    var detail  = getOrCreateSheet_(ss, SH_DETAIL,  HEAD_DETAIL);

    if (data.id && idExists_(summary, data.id)) {
      return json_({ result: 'success', duplicated: true, id: data.id });
    }

    summary.appendRow([
      // ── V1 호환 구간 ──
      stamp,
      data.id || '',
      data.brand || BRAND,
      data.store || '',
      data.target || '',
      data.inspector || '',
      data.date || '',
      data.weekday || '',
      '',                              // 점검구분 — V2 미사용(V1 컬럼 유지)
      '',                              // 주문방식 — V2 폐지(V1 컬럼 유지)
      num_(data.score),
      data.grade || '',
      0,                               // 가산점 — V2 미사용(V1 컬럼 유지)
      num_(data.ok),
      num_(data.tri),
      num_(data.x),
      num_(data.unanswered),
      num_(data.ruleViolations),
      num_(data.total),
      data.comment || '',
      num_(data.na),
      data.naStages || '',
      num_(data.rawScore),             // 원점수 = 획득점수
      num_(data.maxScore),             // 만점   = 채점 대상 만점
      data.time || '',
      num_(data.staff),
      // ── V2 확장 구간 ──
      num_(data.inspectRate),
      data.gradeBeforeCap || '',
      data.gradeCap || '',
      num_(data.situPenalty),
      num_(data.situOccurred),
      num_(data.rulePenalty),
      num_(data.personalGot),
      num_(data.personalMax),
      num_(data.commonGot),
      num_(data.commonMax),
      data.clVersion || '',
      data.clHash || ''
    ]);

    var rows = [];
    (data.items || []).forEach(function (it) {
      rows.push([
        stamp, data.id || '', data.brand || BRAND, data.store || '', data.date || '',
        it.no || '', it.stage || '', 'S',           // 구분 — V1 호환(전 항목 서비스)
        it.text || '', it.label || '',
        num_(it.penalty), 0, it.note || '',         // 감점 / 가산(V2 미사용) / 비고
        num_(it.max), num_(it.got), it.kind || '', it.who || '', data.clVersion || ''
      ]);
    });
    (data.rules || []).forEach(function (r) {
      rows.push([
        stamp, data.id || '', data.brand || BRAND, data.store || '', data.date || '',
        '계명' + (r.no || ''), '10계명', r.key || '',
        r.desc || '', '위반', num_(r.penalty), 0, r.action || '',
        '', '', '10계명', '', data.clVersion || ''
      ]);
    });
    if (rows.length) {
      detail.getRange(detail.getLastRow() + 1, 1, rows.length, HEAD_DETAIL.length).setValues(rows);
    }

    return json_({ result: 'success', id: data.id, rows: rows.length });

  } catch (err) {
    return json_({ result: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* ============================================================
 *  온라인 점검이력 조회
 * ============================================================ */
function listSummaries_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || 'Asia/Seoul';
  var sh = ss.getSheetByName(SH_SUMMARY);
  if (!sh || sh.getLastRow() < 2) return [];
  var w = Math.min(sh.getLastColumn(), HEAD_SUMMARY.length);
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues();
  var out = [];
  rows.forEach(function (r) {
    if (!r[1]) return;
    out.push({
      sentAt: fmtDate_(r[0], tz, 'yyyy-MM-dd HH:mm'),
      id: String(r[1]), brand: String(r[2] || ''), store: String(r[3] || ''),
      target: String(r[4] || ''), inspector: String(r[5] || ''),
      date: fmtDate_(r[6], tz, 'yyyy-MM-dd'), weekday: String(r[7] || ''),
      score: r[10], grade: String(r[11] || ''),
      ruleViolations: r[17], time: String(r[24] || ''), staff: String(r[25] || ''),
      inspectRate: r[26], clVersion: String(r[36] || '')
    });
  });
  out.reverse();
  return out.slice(0, 300);
}

function getDetail_(id) {
  if (!id) return { result: 'error', message: 'id가 없습니다' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || 'Asia/Seoul';
  var sm = ss.getSheetByName(SH_SUMMARY);
  var summary = null;
  if (sm && sm.getLastRow() >= 2) {
    var w = Math.min(sm.getLastColumn(), HEAD_SUMMARY.length);
    var rows = sm.getRange(2, 1, sm.getLastRow() - 1, w).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][1]) === String(id)) {
        var r = rows[i];
        summary = {
          id: String(r[1]), brand: String(r[2] || ''), store: String(r[3] || ''),
          target: String(r[4] || ''), inspector: String(r[5] || ''),
          date: fmtDate_(r[6], tz, 'yyyy-MM-dd'), weekday: String(r[7] || ''),
          score: r[10], grade: String(r[11] || ''),
          ok: r[13], tri: r[14], x: r[15], unanswered: r[16],
          ruleViolations: r[17], total: r[18], comment: String(r[19] || ''),
          na: r[20], naStages: String(r[21] || ''), rawScore: r[22], maxScore: r[23],
          time: String(r[24] || ''), staff: String(r[25] || ''),
          inspectRate: r[26], gradeBeforeCap: String(r[27] || ''), gradeCap: String(r[28] || ''),
          situPenalty: r[29], situOccurred: r[30], rulePenalty: r[31],
          personalGot: r[32], personalMax: r[33], commonGot: r[34], commonMax: r[35],
          clVersion: String(r[36] || '')
        };
        break;
      }
    }
  }
  if (!summary) return { result: 'error', message: '해당 점검을 찾을 수 없습니다' };

  var items = [], rules = [];
  var dt = ss.getSheetByName(SH_DETAIL);
  if (dt && dt.getLastRow() >= 2) {
    var dw = Math.min(dt.getLastColumn(), HEAD_DETAIL.length);
    var drows = dt.getRange(2, 1, dt.getLastRow() - 1, dw).getValues();
    drows.forEach(function (r) {
      if (String(r[1]) !== String(id)) return;
      var no = String(r[5] == null ? '' : r[5]);
      if (no.indexOf('계명') === 0) {
        rules.push({ no: no.replace('계명', ''), key: String(r[7] || ''), desc: String(r[8] || ''),
                     penalty: r[10], action: String(r[12] || '') });
      } else {
        items.push({ no: no, stage: String(r[6] || ''), text: String(r[8] || ''),
                     label: String(r[9] || ''), penalty: r[10], note: String(r[12] || ''),
                     max: r[13], got: r[14], kind: String(r[15] || ''), who: String(r[16] || '') });
      }
    });
  }
  return { result: 'success', summary: summary, items: items, rules: rules };
}

/* ============================================================
 *  최초 1회 실행 — 필요한 탭을 만들고 기본값을 채웁니다.
 *  (이미 있는 탭은 건드리지 않습니다)
 * ============================================================ */
function setupSheets() {
  var log = [];

  // 1) 결과 시트 — 점검요약 / 항목상세
  var rs = SpreadsheetApp.getActiveSpreadsheet();
  getOrCreateSheet_(rs, SH_SUMMARY, HEAD_SUMMARY); log.push('결과 시트: ' + SH_SUMMARY + ' 준비 완료');
  getOrCreateSheet_(rs, SH_DETAIL,  HEAD_DETAIL);  log.push('결과 시트: ' + SH_DETAIL + ' 준비 완료');

  // 2) 체크리스트 시트 — 메타 / 10계명 / 점포명
  var cs = SpreadsheetApp.openById(CHECKLIST_SS_ID);

  if (!cs.getSheetByName(SH_META)) {
    var m = cs.insertSheet(SH_META);
    m.getRange(1, 1, 3, 2).setValues([
      ['항목', '값'],
      ['체크리스트버전', 'v2.0'],
      ['개정일', Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd')]
    ]);
    styleHead_(m, 2);
    m.getRange('A5').setValue('※ 문항을 고친 뒤에는 체크리스트버전을 올려 주세요 (예: v2.1). 앱이 변경을 감지해 새 문항을 받아갑니다.');
    log.push('체크리스트 시트: ' + SH_META + ' 생성');
  } else log.push('체크리스트 시트: ' + SH_META + ' 이미 있음 (건너뜀)');

  if (!cs.getSheetByName(SH_RULES)) {
    var r = cs.insertSheet(SH_RULES);
    var rules = [
      ['번호', '구분', '내용', '감점'],
      ['01', '고객방치', '입점 시 인사나 안내 없이 고객 방치하기', 5],
      ['02', '흡연',     '유니폼 입고 흡연하기', 5],
      ['03', '폭언',     '고객 앞에서 직원 혼내기', 5],
      ['04', '무응답',   '고객 요청에 대답 안 하기 (실행 여부 관계없이)', 5],
      ['05', '책임전가', '고객 불편사항에 대해 즉시 사과하지 않기', 5],
      ['06', '불친절',   '음식 나올 때 테이블에 던지듯 내려놓기', 5],
      ['07', '오픈준수', '오픈 시간에 영업 준비가 안 되어 있기', 5],
      ['08', '감정행동', '감정 상태를 행동(그릇 소리·집게·카트 등)으로 고객에게 드러내기', 5],
      ['09', '강요',     '메뉴 인분수 강요하기', 5],
      ['10', '마감준수', '마감 시간대, 고객 퇴점 전 청소 시작하기', 5]
    ];
    r.getRange(2, 1, rules.length - 1, 1).setNumberFormat('@');   // 번호를 텍스트로 (01 → 1 방지)
    r.getRange(1, 1, rules.length, 4).setValues(rules);
    r.setColumnWidth(3, 460);
    styleHead_(r, 4);
    log.push('체크리스트 시트: ' + SH_RULES + ' 생성 (10개 항목, 각 5점 감점)');
  } else log.push('체크리스트 시트: ' + SH_RULES + ' 이미 있음 (건너뜀)');

  if (!cs.getSheetByName(SH_STORES)) {
    var s = cs.insertSheet(SH_STORES);
    s.getRange(1, 1).setValue('점포명');
    styleHead_(s, 1);
    s.getRange('A3').setValue('※ 이 열에 점포명을 한 줄에 하나씩 적어 두면 앱에서 자동완성됩니다.');
    log.push('체크리스트 시트: ' + SH_STORES + ' 생성 (점포명을 채워 주세요)');
  } else log.push('체크리스트 시트: ' + SH_STORES + ' 이미 있음 (건너뜀)');

  Logger.log(log.join('\n'));
  return log.join('\n');
}

/**
 * 체크리스트가 앱에서 제대로 읽히는지 점검합니다.
 * Apps Script 편집기에서 이 함수를 실행하고 [실행 로그]를 확인하세요.
 */
function checkChecklist() {
  var d = getChecklist_(true);
  if (d.result !== 'success') { Logger.log('❌ ' + d.message); return d.message; }
  var out = [
    '체크리스트 버전 : ' + (d.version || '(메타 탭 비어 있음)'),
    '문항 수         : ' + d.items.length + '개',
    "'일반' 만점     : " + d.normalMax + '점' + (d.normalMax === EXPECTED_MAX ? ' ✅' : ' ❌ (100점이어야 함)'),
    '단계            : ' + d.stages.join(' · '),
    '10계명          : ' + d.rules.length + '개',
    '검증            : ' + (d.valid ? '통과 ✅' : '문제 ' + d.issues.length + '건 ❌')
  ];
  if (!d.valid) out.push('', '── 문제 목록 ──', d.issues.join('\n'));
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/* ---------- 보조 함수 ---------- */
function getOrCreateSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    styleHead_(sh, header.length);
  }
  return sh;
}

function styleHead_(sh, cols) {
  sh.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#a8906c').setFontColor('#241d12');
  sh.setFrozenRows(1);
}

function idExists_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var ids = sheet.getRange(2, 2, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return true;
  return false;
}

function hash_(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < 4; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function fmtDate_(v, tz, pattern) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, pattern);
  return v == null ? '' : String(v);
}

function nowStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

// 숫자로 바꿀 수 있으면 숫자로, 아니면 원래 값(빈 값은 '')을 그대로 둡니다.
function num_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  return isNaN(n) ? v : n;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
