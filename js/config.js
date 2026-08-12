/* ============================================================
   고반가든 MOT 점검 V2 — 설정
   ============================================================ */
window.MOT = window.MOT || {};

MOT.config = {
  /* Apps Script 웹앱 배포 URL (.../exec)
     결과 스프레드시트 "MOT_고반가든_점검결과_V2" 에 붙인 스크립트의 배포 주소.
     배포 후 아래 값을 채워 넣으세요. 앱 설정 화면에서도 변경할 수 있습니다. */
  SCRIPT_URL: "",

  /* 참고용 시트 주소 (앱 설정 화면 안내에 사용) */
  CHECKLIST_SHEET_URL: "https://docs.google.com/spreadsheets/d/1oRr-n4OX9Ue0BX51IN1uJ2trVMB7aDYVsy1woX-cUQE/edit",
  RESULT_SHEET_URL:    "https://docs.google.com/spreadsheets/d/1qMAtiJ8CC0QcL2ijSqV2PFeH1dEZo175E7bFNW4Tu9U/edit",

  BRAND: "고반가든",
  APP_VERSION: "2.0.1",

  /* 등급 컷 (점수 이상이면 해당 등급) */
  GRADE_CUTS: [
    { grade: "S", min: 90 },
    { grade: "A", min: 80 },
    { grade: "B", min: 70 },
    { grade: "C", min: 60 },
    { grade: "D", min: 50 },
    { grade: "F", min: 0  }
  ],

  /* 점검율에 따른 등급 상한 — 점검율이 낮으면 등급을 제한 */
  RATE_CAPS: [
    { min: 80, cap: null },   // 제한 없음
    { min: 60, cap: "A"  },
    { min: 50, cap: "B"  },
    { min: 0,  cap: "C"  }    // 50% 미만 → C + 재점검 대상
  ],
  RECHECK_RATE: 50,

  NETWORK_TIMEOUT: 12000,
  CHECKLIST_TTL: 6 * 60 * 60 * 1000
};

/* localStorage 키
   ⚠️ 고반식당 V2(motv2_*)·김치옥 V2(kimmot2_*)와 같은 주소(everside76.github.io)에
      배포되므로 저장 공간을 공유합니다. 키가 겹치면 서로의 점검 이력을 덮어씁니다. */
MOT.LS = {
  settings:  "gdnmot2_settings",
  history:   "gdnmot2_history",
  draft:     "gdnmot2_draft",
  checklist: "gdnmot2_checklist_cache",
  lastInput: "gdnmot2_last_input",
  inspector: "gdnmot2_inspector"
};

/* 변경 이력 (최신이 위) */
MOT.CHANGELOG = [
  { v: "2.0.1", date: "2026-08-12", items: [
    "구글 시트의 18번(뜨거우니 조심하세요) 구분과 7번 개인구분이 정리되어, 앱 내장본을 시트와 동일하게 맞췄습니다"
  ]},
  { v: "2.0.0", date: "2026-08-12", items: [
    "V2 전면 개편 — 체크리스트를 구글 시트에서 직접 불러옵니다. 문항·배점·판정 기준을 시트에서 고치면 앱에 바로 반영됩니다",
    "채점 방식 변경: 감점제 → 획득점수제. '일반' 문항의 이행 점수 합계가 100점이며, 미흡은 절반, 불이행은 0점입니다",
    "'상황발생시' 문항 신설 — 상황이 실제 발생했을 때만 점검하며, 불이행일 때만 점수가 차감됩니다",
    "'개인 / 매장공통' 구분 신설 — 결과 화면에서 개인 서비스와 매장 공통 항목의 점수를 나눠 봅니다",
    "문항별 이행·미흡·불이행 판정 기준을 점검 화면에서 바로 확인할 수 있습니다",
    "절대 금지 10계명은 시트에서 관리하며 위반 1건당 점수를 차감합니다"
  ]}
];
