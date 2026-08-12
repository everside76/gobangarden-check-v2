/* ============================================================
   화면 렌더링 · 사용자 조작 처리
   ============================================================ */
(function () {
"use strict";

var CFG = MOT.config, S = MOT.scoring, ST = MOT.store, API = MOT.api, CL = MOT.checklist;
var WEEKDAYS = ["일","월","화","수","목","금","토"];

var session = null;        // 현재 점검
var navStack = ["home"];
var storeList = null;
var onlineCache = null;
var editingId = null;      // 이력에서 불러와 수정 중인 점검 ID

/* ---------- 짧은 도우미 ---------- */
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){
  return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]; }); }
/* onclick="f('...')" 처럼 인라인 핸들러 안에 넣는 문자열용.
   시트에서 온 값에 따옴표·역슬래시가 섞여도 버튼이 깨지지 않게 두 단계로 처리합니다. */
function jsArg(s){
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\").replace(/'/g, "\\'")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function todayStr(){ var d=new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function weekdayOf(s){ var d=new Date(s+"T00:00:00"); return isNaN(d)?"":WEEKDAYS[d.getDay()]; }
function uid(){ return "MOT2-"+Date.now().toString(36)+"-"+Math.floor(Math.random()*1e6).toString(36); }
function fmtRate(n){ var v=Math.round((Number(n)||0)*10)/10; return Number.isInteger(v)?String(v):v.toFixed(1); }
function icon(id){ return '<span class="icon"><svg><use href="#'+id+'"></use></svg></span>'; }
function toast(msg){
  var t=$("toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(t._h); t._h=setTimeout(function(){ t.classList.remove("show"); }, 2600);
}

/* ---------- 화면 전환 ---------- */
/* 상단바 제목 — 좁은 화면에서도 잘리지 않도록 짧게 씁니다 (화면 안에 전체 제목이 다시 나옵니다) */
var TITLES = { home:"고반가든 MOT2", check:"체크리스트", rules:"10계명 점검",
               result:"점검 결과", history:"점검 이력", settings:"설정", changelog:"변경 이력" };

function showScreen(id, push){
  if (push === undefined) push = true;
  document.querySelectorAll(".screen").forEach(function(s){ s.classList.remove("active"); });
  var el = $("screen-"+id);
  if (el) el.classList.add("active");
  $("barTitle").textContent = TITLES[id] || "MOT 점검";
  $("appbar").classList.toggle("has-back", id !== "home");
  if (push && navStack[navStack.length-1] !== id) navStack.push(id);
  window.scrollTo(0, 0);

  if (id === "home")      refreshEditBanner();
  if (id === "history")   renderHistory();
  if (id === "settings")  renderSettings();
  if (id === "changelog") renderChangelog();
}

/* 이력 수정 모드 안내 — 수정 중인 점검이 있으면 홈 화면에 알리고, 언제든 빠져나올 수 있게 합니다.
   (이 안내가 없으면 수정 모드인 줄 모르고 새 점검을 시작해 기존 기록을 덮어쓸 수 있습니다) */
function refreshEditBanner(){
  var box = $("editBanner");
  if (!box) return;
  if (editingId && session && session.id === editingId){
    box.innerHTML = '<div class="edit-banner">✏️ <b>'+esc(session.store)+'</b> ('+esc(session.date)+') 점검을 <b>수정하는 중</b>입니다.<br>'
      + '기본정보를 고친 뒤 <b>점검 시작하기</b>를 누르면 응답은 그대로 두고 이어서 수정됩니다.'
      + '<button class="btn secondary btn-sm" style="margin-top:10px;" onclick="MOTapp.cancelEdit()">수정 취소하고 새 점검하기</button></div>';
  } else {
    box.innerHTML = "";
    editingId = null;                    // 세션이 끊겼으면 수정 모드도 해제
  }
}
function cancelEdit(){
  editingId = null; session = null;
  ST.clearDraft();
  resetHomeForm();
  refreshEditBanner();
  toast("수정을 취소했어요. 새 점검을 시작할 수 있습니다");
}
function goBack(){ navStack.pop(); showScreen(navStack[navStack.length-1] || "home", false); }

/* ============================================================
   홈 화면
   ============================================================ */
function fillTimeSelect(sel){
  var el = $("f-time"); el.innerHTML = "";
  var now = new Date().getHours();
  for (var h=0; h<24; h++){
    var o = document.createElement("option");
    o.value = String(h); o.textContent = String(h).padStart(2,"0")+"시";
    el.appendChild(o);
  }
  el.value = String(sel === undefined || sel === "" ? now : sel);
}

function applyLastInput(){
  var v = ST.lastInput();
  if (v.store) $("f-store").value = v.store;
  if (v.staff !== undefined && v.staff !== "") $("f-staff").value = v.staff;
  if (v.inspector) $("f-inspector").value = v.inspector;
  $("f-date").value = todayStr();
  $("f-weekday").value = weekdayOf(todayStr());
  fillTimeSelect();
  $("f-target").value = "";        // 피점검자는 매번 새로 입력
}

function initHome(){
  $("f-date").value = todayStr();
  $("f-weekday").value = weekdayOf(todayStr());
  fillTimeSelect();
  applyLastInput();

  $("f-date").addEventListener("change", function(){ $("f-weekday").value = weekdayOf(this.value); });
  $("staffUp").addEventListener("click", function(){ stepStaff(1); });
  $("staffDown").addEventListener("click", function(){ stepStaff(-1); });
  $("f-store").addEventListener("input", onStoreInput);
  $("f-store").addEventListener("focus", ensureStoreList);
  $("f-store").addEventListener("blur", function(){ setTimeout(hideStoreSuggest, 180); });
  $("startBtn").addEventListener("click", startInspection);

  var d = ST.draft();
  if (d && d.store){
    var hint = $("resumeHint");
    hint.style.display = "block";
    hint.innerHTML = '작성 중이던 점검이 있어요 — <b>'+esc(d.store)+'</b> ('+esc(d.date||"")+') '
      + '<button class="crit-toggle" onclick="MOTapp.resumeDraft()" style="margin:0;">이어서 하기</button> · '
      + '<button class="crit-toggle" onclick="MOTapp.discardDraft()" style="margin:0; color:var(--sub);">지우기</button>';
  }
}

function stepStaff(d){
  var el = $("f-staff");
  var v = parseInt(el.value, 10); if (isNaN(v)) v = 0;
  v = Math.max(0, Math.min(99, v + d));
  el.value = String(v);
}

/* ---------- 점포명 자동완성 ---------- */
function ensureStoreList(){
  if (storeList !== null || !API.hasUrl()) return;
  storeList = [];
  API.fetchStores().then(function(list){ storeList = list || []; renderStoreSuggest(); }).catch(function(){});
}
function normStore(s){ return String(s||"").replace(/\s/g,"").toLowerCase(); }
function storeSim(q, t){
  q = normStore(q); t = normStore(t);
  if (!q || !t) return 0;
  if (t.indexOf(q) >= 0) return 0.9 + Math.min(0.1, q.length/40);
  var pairs = function(s){ var a=[]; for (var i=0;i<s.length-1;i++) a.push(s.substr(i,2)); return a; };
  var A = pairs(q), B = pairs(t);
  if (!A.length || !B.length) return 0;
  var hit = 0, used = {};
  A.forEach(function(p){
    for (var i=0;i<B.length;i++) if (!used[i] && B[i]===p){ used[i]=1; hit++; break; }
  });
  return 2*hit/(A.length+B.length);
}
function onStoreInput(){ ensureStoreList(); renderStoreSuggest(); }
function renderStoreSuggest(){
  var box = $("storeSuggest"), q = $("f-store").value.trim();
  if (!q || !storeList || !storeList.length){ hideStoreSuggest(); return; }
  var hits = storeList.map(function(s){ return { name:s, sim:storeSim(q,s) }; })
    .filter(function(h){ return h.sim > 0.28; })
    .sort(function(a,b){ return b.sim - a.sim; }).slice(0,5);
  if (!hits.length){ hideStoreSuggest(); return; }
  box.innerHTML = hits.map(function(h){
    return '<div class="ss-item" onclick="MOTapp.pickStore(\''+jsArg(h.name)+'\')">'
      + '<span>'+esc(h.name)+'</span><span class="ss-sim">'+Math.round(h.sim*100)+'%</span></div>';
  }).join("");
  box.style.display = "block";
}
function pickStore(name){ $("f-store").value = name; hideStoreSuggest(); }
function hideStoreSuggest(){ var b=$("storeSuggest"); if (b){ b.style.display="none"; b.innerHTML=""; } }

/* ---------- 점검 시작 ---------- */
function startInspection(){
  var store = $("f-store").value.trim();
  var staff = $("f-staff").value.trim();
  var target = $("f-target").value.trim();
  var inspector = $("f-inspector").value.trim();
  var date = $("f-date").value;
  var time = $("f-time").value;

  if (!store)      { toast("지점명을 입력해 주세요"); $("f-store").focus(); return; }
  if (staff === ""){ toast("총 홀 근무인원을 입력해 주세요"); $("f-staff").focus(); return; }
  if (!target)     { toast("피점검자를 입력해 주세요"); $("f-target").focus(); return; }
  if (!inspector)  { toast("점검자를 입력해 주세요"); $("f-inspector").focus(); return; }
  if (!date)       { toast("점검일을 선택해 주세요"); return; }

  var snap = CL.snapshot();
  if (!snap || !snap.items.length){ toast("체크리스트를 아직 불러오지 못했어요"); return; }

  ST.saveLastInput({ store:store, staff:staff, inspector:inspector });

  /* 이력 수정 중일 때만 기존 응답을 물려받습니다.
     session.id 와 editingId 가 일치하는지까지 확인해, 수정 모드가 남아 있다가
     엉뚱한 점검에 덮어써지는 일이 없게 합니다. */
  var keep = (editingId && session && session.id === editingId) ? session : null;
  session = {
    id: keep ? keep.id : uid(),
    brand: CFG.BRAND,
    store:store, staff:staff, target:target, inspector:inspector,
    date:date, weekday:weekdayOf(date), time:time+"시",
    checklist: keep ? keep.checklist : snap,
    answers: keep ? keep.answers : {},
    rules: keep ? keep.rules : {},
    rulesAck: keep ? keep.rulesAck : false,
    comment: keep ? keep.comment : "",
    sent: false,
    startedAt: keep ? keep.startedAt : new Date().toISOString()
  };
  saveDraft();
  renderCheck();
  showScreen("check");
}

function saveDraft(){ if (session) ST.saveDraft(session); }
function resumeDraft(){
  session = ST.draft();
  if (!session) return;
  editingId = session.sent ? null : (ST.findHistory(session.id) ? session.id : null);
  renderCheck(); showScreen("check");
}
function discardDraft(){
  var d = ST.draft();
  ST.clearDraft();
  if (d && session && d.id === session.id){ session = null; editingId = null; }
  $("resumeHint").style.display = "none";
  refreshEditBanner();
  toast("작성 중이던 점검을 지웠어요");
}

/* ============================================================
   점검 화면
   ============================================================ */
function items(){ return (session && session.checklist.items) || []; }
function stages(){
  var list = (session && session.checklist.stages) || [];
  var its = items();
  return list.filter(function(st){ return its.some(function(i){ return i.stage === st; }); });
}

function renderCheck(){
  var html = "";
  stages().forEach(function(st){
    var group = items().filter(function(i){ return i.stage === st; });
    html += '<div class="stage-head" id="st-'+esc(st)+'">'+esc(st)   // id는 getElementById로만 조회
         +  '<span class="stcount">'+group.length+'문항</span></div>';
    html += group.map(itemCard).join("");
  });
  $("itemList").innerHTML = html;
  $("progStore").textContent = session.store + " · " + session.date;
  updateFooter();
  refreshStageNav();
}

function itemCard(it){
  var situ = S.isSituational(it);
  var a = (session.answers[it.no]) || {};
  var occurred = !!a.occurred;
  var v = situ ? (occurred ? (a.value||"") : "") : (a.value||"");

  var cls = "item" + (situ ? " situ" : "") + (situ && occurred ? " occurred" : "");
  if (v) cls += " answered flag-" + v;
  else if (situ && !occurred) cls += " answered";

  var tags = "";
  if (situ) tags += '<span class="tag tag-situ">⚡ 상황발생시</span>';
  if (it.who === S.WHO_COMMON) tags += '<span class="tag tag-common">매장공통</span>';

  var no = jsArg(it.no);                    // 인라인 핸들러용
  var idNo = esc(it.no);                    // id 속성용
  var body = "";
  if (situ){
    body += '<div class="situ-guide">이 상황이 실제로 있었나요?</div>'
         +  '<div class="occur-row">'
         +  '<button class="occur'+(!occurred?" on off-state":"")+'" onclick="MOTapp.setOccur(\''+no+'\',false)">'
         +  (!occurred?"✔ ":"")+'상황 없었음</button>'
         +  '<button class="occur'+(occurred?" on":"")+'" onclick="MOTapp.setOccur(\''+no+'\',true)">'
         +  (occurred?"✔ ":"")+'발생함</button>'
         +  '</div>';
    if (occurred) body += ansRow(it, v, true);
  } else {
    body += ansRow(it, v, false);
    body += '<button class="na-btn'+(v==="N"?" on":"")+'" onclick="MOTapp.setAnswer(\''+no+'\',\'N\')">'
         +  (v==="N" ? "✔ 해당없음 (채점 제외)" : "해당없음 — 이번 점검에서 확인할 수 없었음")+'</button>';
  }

  return '<div class="'+cls+'" id="card-'+idNo+'">'
    + '<div class="item-top"><span class="item-no">'+esc(it.no)+'</span>'+tags
    + '<div class="item-text">'+esc(it.text)+'</div></div>'
    + body
    + '<div class="item-foot">'
    +   critToggle(it)
    +   '<button class="note-toggle" onclick="MOTapp.toggleNote(\''+no+'\')">'+icon("i-note")+'비고</button>'
    + '</div>'
    + critBox(it)
    + '<div class="note-box'+(a.note?" open":"")+'" id="note-'+idNo+'">'
    +   '<textarea rows="2" placeholder="특이사항을 적어 주세요" oninput="MOTapp.setNote(\''+no+'\',this.value)">'+esc(a.note||"")+'</textarea>'
    + '</div>'
    + '</div>';
}

function ansRow(it, v, situ){
  var ptO = situ ? "" : "+"+num(it.scoreO);
  var ptT = situ ? "" : "+"+num(it.scoreT);
  var ptX = situ ? (num(it.scoreX) ? String(num(it.scoreX))+"점" : "0") : "0점";
  return '<div class="ans-row">'
    + ansBtn(it.no,"O","○","이행",ptO,v)
    + (situ && !num(it.scoreT) ? "" : ansBtn(it.no,"T","△","미흡",ptT,v))
    + ansBtn(it.no,"X","✕","불이행",ptX,v)
    + '</div>';
}
function ansBtn(no, val, sym, label, pt, cur){
  return '<button class="ans'+(cur===val?" sel-"+val:"")+'" onclick="MOTapp.setAnswer(\''+jsArg(no)+'\',\''+val+'\')">'
    + '<span class="sym">'+sym+'</span><span class="lbl">'+label+'</span>'
    + (pt ? '<span class="pt">'+pt+'</span>' : "")+'</button>';
}
function num(v){ var n=Number(v); return isNaN(n)?0:n; }

/* 판정 기준은 기본으로 펼쳐 둡니다. 설정에서 끄면 접힌 상태로 시작합니다. */
function critAlwaysOpen(){ return ST.settings().critFold !== true; }

function critToggle(it){
  if (!it.critO && !it.critT && !it.critX) return "";
  var label = critAlwaysOpen() ? "📖 판정 기준 접기" : "📖 판정 기준";
  return '<button class="crit-toggle" onclick="MOTapp.toggleCrit(\''+jsArg(it.no)+'\')">'+label+'</button>';
}
function critBox(it){
  if (!it.critO && !it.critT && !it.critX) return "";
  /* 기준이 비어 있는 판정은 줄 자체를 그리지 않습니다.
     (상황발생시 문항처럼 미흡 판정이 없는 경우 빈 줄이 생기지 않도록) */
  function row(cls, label, txt){
    if (!txt) return "";
    return '<div class="crit-row '+cls+'"><b>'+label+'</b><span>'+esc(txt)+'</span></div>';
  }
  var open = critAlwaysOpen() ? " open" : "";
  return '<div class="crit-box'+open+'" id="crit-'+esc(it.no)+'">'
    + row("o","○ 이행", it.critO) + row("t","△ 미흡", it.critT) + row("x","✕ 불이행", it.critX)
    + '</div>';
}

function setAnswer(no, val){
  var it = items().find(function(i){ return i.no === no; });
  if (!session.answers[no]) session.answers[no] = {};
  var a = session.answers[no];
  if (S.isSituational(it) && !a.occurred) return;      // 미발생 상태에서는 판정 불가
  a.value = (a.value === val) ? "" : val;              // 같은 버튼 다시 누르면 해제
  saveDraft(); rerenderCard(no); updateFooter(); refreshStageNav();
}
function setOccur(no, occurred){
  if (!session.answers[no]) session.answers[no] = {};
  var a = session.answers[no];
  a.occurred = occurred;
  if (!occurred) a.value = "";
  saveDraft(); rerenderCard(no); updateFooter(); refreshStageNav();
}
function setNote(no, v){
  if (!session.answers[no]) session.answers[no] = {};
  session.answers[no].note = v; saveDraft();
}
function toggleNote(no){ var b=$("note-"+no); if (b) b.classList.toggle("open"); }
function toggleCrit(no){ var b=$("crit-"+no); if (b) b.classList.toggle("open"); }

function rerenderCard(no){
  var it = items().find(function(i){ return i.no === no; });
  var el = $("card-"+no);
  if (!it || !el) return;
  var critOpen = $("crit-"+no) && $("crit-"+no).classList.contains("open");
  var noteOpen = $("note-"+no) && $("note-"+no).classList.contains("open");
  el.outerHTML = itemCard(it);
  // 다시 그려도 사용자가 직접 접거나 편 상태를 그대로 둡니다
  if ($("crit-"+no)) $("crit-"+no).classList.toggle("open", critOpen);
  if (noteOpen && $("note-"+no)) $("note-"+no).classList.add("open");
}

function updateFooter(){
  var p = S.progress(session.checklist, session.answers);
  $("progFill").style.width = p.pct + "%";
  $("progText").textContent = p.done + " / " + p.total + " 항목";
  var chk = S.validate(session.checklist, session.answers);
  var btn = $("toRulesBtn");
  btn.disabled = !chk.ok;
  $("checkSummary").innerHTML = chk.ok
    ? "✅ 모든 항목을 확인했어요."
    : "남은 항목 <b>"+chk.missing.length+"</b>개 — "
      + (chk.missing[0].reason === "situ"
          ? "발생함으로 표시한 <b>"+chk.missing[0].no+"번</b>의 판정이 남았어요"
          : "<b>"+chk.missing[0].no+"번</b>부터 이어서 응답해 주세요")
      + ' · <button class="crit-toggle" style="margin:0;" onclick="MOTapp.jumpFirstMissing()">바로 가기</button>';
}
function jumpFirstMissing(){
  var chk = S.validate(session.checklist, session.answers);
  if (!chk.missing.length) return;
  var el = $("card-"+chk.missing[0].no);
  if (el) el.scrollIntoView({ behavior:"smooth", block:"center" });
}
function refreshStageNav(){
  $("stagenav").innerHTML = stages().map(function(st){
    var group = items().filter(function(i){ return i.stage === st; });
    var done = group.every(function(i){
      var a = S.answerOf(session.answers, i);
      return S.isSituational(i) ? (!a.occurred || a.value) : !!a.value;
    });
    return '<div class="snav'+(done?" done":"")+'" onclick="MOTapp.jumpStage(\''+jsArg(st)+'\')">'+esc(st)+'</div>';
  }).join("");
}
function jumpStage(st){ var el = $("st-"+st); if (el) el.scrollIntoView({ behavior:"smooth", block:"start" }); }

/* ============================================================
   10계명
   ============================================================ */
function goRules(){
  var chk = S.validate(session.checklist, session.answers);
  if (!chk.ok){ toast("아직 응답하지 않은 항목이 "+chk.missing.length+"개 있어요"); jumpFirstMissing(); return; }
  renderRules(); showScreen("rules");
}
function rules(){ return (session && session.checklist.rules) || []; }

function renderRules(){
  var list = rules();
  if (!list.length){
    $("ruleList").innerHTML = '<div class="empty-state">등록된 10계명이 없습니다.<br>구글 시트의 <b>10계명</b> 탭을 확인해 주세요.</div>';
  } else {
    var pen = list[0].penalty === undefined ? 5 : list[0].penalty;
    $("ruleIntro").innerHTML = '발생한 항목만 켜세요. <b>체크 1건당 총점에서 '+pen+'점 추가 감점</b>되며, 세부사항을 반드시 기록해 주세요.';
    $("ruleList").innerHTML = list.map(function(r){
      var s = session.rules[r.no] || {};
      var no = jsArg(r.no);
      return '<div class="rule'+(s.occurred?" on":"")+'" id="rule-'+esc(r.no)+'">'
        + '<div class="rule-head"><span class="rule-no">'+esc(r.no)+'</span>'
        + '<span class="rule-key">'+esc(r.key)+'</span>'
        + '<div class="switch'+(s.occurred?" on":"")+'" onclick="MOTapp.toggleRule(\''+no+'\')"><i></i></div></div>'
        + '<div class="rule-desc">'+esc(r.desc)+'</div>'
        + (s.occurred
            ? '<textarea rows="2" style="margin-top:10px;" placeholder="언제·누가·어떤 상황이었는지 적어 주세요"'
              + ' oninput="MOTapp.setRuleAction(\''+no+'\',this.value)">'+esc(s.action||"")+'</textarea>'
            : "")
        + '</div>';
    }).join("");
  }
  $("rulesAck").checked = !!session.rulesAck;
  syncRuleGate();
}
function toggleRule(no){
  if (!session.rules[no]) session.rules[no] = {};
  session.rules[no].occurred = !session.rules[no].occurred;
  saveDraft(); renderRules();
}
function setRuleAction(no, v){
  if (!session.rules[no]) session.rules[no] = {};
  session.rules[no].action = v; saveDraft();
}
function syncRuleGate(){
  var n = rules().filter(function(r){ return (session.rules[r.no]||{}).occurred; }).length;
  $("ruleSummary").innerHTML = n ? "🚫 위반 <b>"+n+"</b>건 체크됨" : "위반 없음";
  $("toResultBtn").disabled = !session.rulesAck;
}

/* ============================================================
   결과 화면
   ============================================================ */
function goResult(){ buildResult(); showScreen("result"); }

function compute(){ return S.compute(session.checklist, session.answers, session.rules, CFG); }

function buildResult(){
  var r = compute();
  session.comment = $("r-comment").value;

  $("r-score").innerHTML = r.score + "<small> / 100</small>";
  var g = $("r-grade"); g.textContent = "등급 " + r.grade; g.className = "grade grade-" + r.grade;

  var cn = $("r-capnote");
  if (r.capApplied){
    cn.style.display = "block";
    cn.textContent = "점검율 "+fmtRate(r.inspectRate)+"% · 등급 상한 "+r.gradeCap+" 적용 (점수 등급 "+r.gradeBeforeCap+")";
  } else { cn.style.display = "none"; }

  $("r-ok").textContent = r.ok; $("r-tri").textContent = r.tri;
  $("r-x").textContent = r.x;   $("r-na").textContent = r.na;

  /* 점수 계산 과정 */
  var calc = "획득 <b>"+r.normalGot+"</b> / 채점 만점 <b>"+r.normalMax+"</b>점 → 100점 환산 <b>"+r.baseScore+"</b>점";
  if (r.na) calc += ' <span style="color:var(--sub)">(해당없음 '+r.na+'건 제외)</span>';
  if (r.situPenalty) calc += '<br><span class="minus">⚡ 상황 대응 감점 −'+r.situPenalty+'점</span>';
  if (r.rulePenalty) calc += '<br><span class="minus">🚫 10계명 위반 '+r.ruleViolations.length+'건 −'+r.rulePenalty+'점</span>';
  if (r.situPenalty || r.rulePenalty) calc += "<br>= 최종 <b>"+r.score+"</b>점";
  $("r-calc").innerHTML = calc;

  /* 점검율 */
  var ex = [];
  if (r.na) ex.push("해당없음 "+r.na);
  if (r.unanswered) ex.push("미응답 "+r.unanswered);
  $("r-rate").innerHTML =
    '<div class="rate-line"><span class="rate-label">점검율</span><span class="rate-value">'+fmtRate(r.inspectRate)+'%</span></div>'
    + '<div class="rate-sub">'+r.inspected+' / '+r.normalTotal+' 문항 점검'+(ex.length?" ("+ex.join(" · ")+")":"")
    + (r.situTotal ? '<br>상황발생시 문항 '+r.situTotal+'개 중 <b>'+r.situOccurred+'건 발생</b> (점검율 계산에서 제외)' : "")
    + '</div>';
  $("r-recheck").innerHTML = r.needsRecheck
    ? '<div class="recheck-warn">⚠️ 점검율 '+CFG.RECHECK_RATE+'% 미만 — 재점검 계획 대상</div>' : "";

  /* 개인 · 매장공통 */
  function pct(got, max){ return max > 0 ? Math.round(got/max*100) : 0; }
  $("r-split").innerHTML =
      '<div class="split"><div class="sp-label">개인 서비스</div>'
    + '<div class="sp-val">'+r.personalGot+'<small> / '+r.personalMax+'점</small></div>'
    + '<div class="hint" style="margin-top:4px;">'+pct(r.personalGot,r.personalMax)+'% 달성</div></div>'
    + '<div class="split common"><div class="sp-label">매장공통</div>'
    + '<div class="sp-val">'+r.commonGot+'<small> / '+r.commonMax+'점</small></div>'
    + '<div class="hint" style="margin-top:4px;">'+pct(r.commonGot,r.commonMax)+'% 달성</div></div>';

  /* 단계별 */
  $("r-stages").innerHTML = stages().map(function(st){
    var m = r.stageMap[st] || { got:0, max:0, penalty:0, total:0, na:0 };
    var isNa = r.naStages.indexOf(st) >= 0;
    var ratio = m.max > 0 ? m.got/m.max : 0;
    var lv = ratio >= 0.9 ? "" : (ratio >= 0.7 ? " mid" : " low");

    /* 점수 표기
       - 채점 문항이 있는 단계   : 12 / 16점  (상황 감점이 함께 있으면 옆에 −4)
       - 상황발생시 문항만 있는 단계 : 감점이 있으면 −4점, 없으면 —  */
    var val, cls = "", pen = "";
    if (m.max > 0){
      val = m.got + " / " + m.max + "점";
      if (m.penalty) pen = '<span class="st-pen">−' + m.penalty + '</span>';
    } else if (m.penalty){
      val = "−" + m.penalty + "점";  cls = " pen";
    } else {
      val = isNa ? "해당없음" : "—";  cls = " na";
    }

    return '<div class="stage-score"><span class="st-name">'+esc(st)+'</span>'
      + '<span class="st-bar'+lv+'"><i style="width:'+Math.round(ratio*100)+'%"></i></span>'
      + '<span class="st-val'+cls+'">'+val+'</span>'
      + pen
      + '</div>';
  }).join("");

  /* 감점 블록 */
  var pen = "";
  if (r.situPenalty){
    var situList = r.deducted.filter(function(d){ return d.kind === S.KIND_SITU; });
    pen += '<div class="pen-block"><div class="pb-title"><span>⚡ 상황 대응 감점</span><span>−'+r.situPenalty+'점</span></div><ul>'
      + situList.map(function(d){ return '<li><b>'+esc(d.no)+'번</b> '+esc(d.text)+' — −'+d.amount+'점'
        + (d.note?'<br><span style="color:var(--sub)">└ '+esc(d.note)+'</span>':"")+'</li>'; }).join("")
      + '</ul></div>';
  }
  if (r.rulePenalty){
    pen += '<div class="rule-block"><div class="pb-title"><span>🚫 절대 금지 10계명 위반</span><span>−'+r.rulePenalty+'점</span></div><ul>'
      + r.ruleViolations.map(function(v){
          var act = (session.rules[v.no]||{}).action;
          return '<li><b>'+esc(v.key)+'</b> — '+esc(v.desc)+' (−'+(v.penalty===undefined?5:v.penalty)+'점)'
            + (act?'<br><span style="color:var(--sub)">└ '+esc(act)+'</span>':"")+'</li>';
        }).join("")
      + '</ul></div>';
  }
  $("r-penalty").innerHTML = pen;

  /* 점수가 깎인 항목 */
  var rows = r.deducted.filter(function(d){ return d.kind !== S.KIND_SITU; }).map(function(d){
    return '<li class="bd-item"><span class="bd-flag '+d.value+'">'
      + (d.value === "T" ? "△ 미흡" : "✕ 불이행")+' −'+d.amount+'</span>'
      + '<div><b>'+esc(d.no)+'.</b> '+esc(d.text)
      + (d.note?'<br><span style="color:var(--sub)">└ '+esc(d.note)+'</span>':"")+'</div></li>';
  });
  $("r-deduct-card").style.display = rows.length ? "block" : "none";
  $("r-deducts").innerHTML = rows.join("");

  $("r-comment").value = session.comment || "";
  var sb = $("sendBtn");
  if (session.sent){
    sb.disabled = true; sb.textContent = "✅ 전송 완료";
    $("sendHint").innerHTML = "이미 전송된 점검이에요. <b>저장하고 처음으로</b>를 눌러 새 점검을 시작하세요.";
  } else {
    sb.disabled = false; sb.innerHTML = icon("i-send")+"구글 시트로 결과 전송";
    $("sendHint").textContent = "";
  }
}

/* ============================================================
   전송 · 저장 · CSV
   ============================================================ */
function buildPayload(){
  var r = compute();
  return {
    id: session.id, sentAt: new Date().toISOString(),
    brand: session.brand, store: session.store, target: session.target || "",
    inspector: session.inspector, date: session.date, weekday: session.weekday,
    time: session.time || "", staff: session.staff || "",
    score: r.score, grade: r.grade,
    rawScore: r.normalGot, maxScore: r.normalMax,
    ok: r.ok, tri: r.tri, x: r.x, na: r.na, unanswered: r.unanswered,
    naStages: r.naStages.join(","), total: r.total,
    inspectRate: Math.round(r.inspectRate*10)/10,
    gradeBeforeCap: r.gradeBeforeCap, gradeCap: r.gradeCap || "",
    situPenalty: r.situPenalty, situOccurred: r.situOccurred,
    ruleViolations: r.ruleViolations.length, rulePenalty: r.rulePenalty,
    personalGot: r.personalGot, personalMax: r.personalMax,
    commonGot: r.commonGot, commonMax: r.commonMax,
    clVersion: session.checklist.version || "", clHash: session.checklist.contentHash || "",
    comment: ($("r-comment").value || "").trim(),
    items: S.itemRows(session.checklist, session.answers),
    rules: r.ruleViolations.map(function(v){
      return { no:v.no, key:v.key, desc:v.desc,
               penalty: v.penalty === undefined ? 5 : v.penalty,
               action: (session.rules[v.no]||{}).action || "" };
    })
  };
}

function sendToSheet(){
  if (!API.hasUrl()){ toast("구글 시트 주소를 먼저 설정해 주세요"); showScreen("settings"); return; }
  var btn = $("sendBtn");
  btn.disabled = true; btn.textContent = "전송 중…";
  $("sendHint").textContent = "구글 시트로 전송하고 있어요…";

  API.send(buildPayload()).then(function(res){
    persistCurrent(true); ST.clearDraft();
    btn.textContent = res.duplicated ? "✅ 이미 전송됨" : "✅ 전송 완료";
    $("sendHint").innerHTML = "구글 시트에 저장됐어요. <b>저장하고 처음으로</b>를 눌러 새 점검을 시작하세요.";
    onlineCache = null;
    toast("구글 시트로 전송 완료!");
  }).catch(function(err){
    persistCurrent(false);
    btn.disabled = false; btn.innerHTML = icon("i-send")+"다시 전송하기";
    /* 응답을 못 받았을 뿐 시트에는 저장됐을 수 있습니다.
       같은 점검을 다시 보내도 점검ID로 걸러져 중복 저장되지 않으므로 재전송이 안전합니다. */
    var timedOut = /abort|signal/i.test(err.message || "");
    $("sendHint").innerHTML = timedOut
      ? '응답이 늦어 확인하지 못했어요. <b>시트에는 이미 저장됐을 수 있습니다.</b><br>'
        + '결과는 기기에도 저장했으니 <b>점검 이력</b>에서 <b>다시 전송</b>해 보세요. (같은 점검은 두 번 저장되지 않습니다)'
      : '전송에 실패했어요 ('+esc(err.message)+').<br>결과는 이 기기에 저장했으니 <b>점검 이력</b>에서 나중에 다시 보낼 수 있어요.';
    toast(timedOut ? "응답이 늦어요 — 기기에 저장했어요" : "전송 실패 — 기기에 저장했어요");
  });
}

function persistCurrent(sent){
  if (!session || session.online) return;
  var r = compute();
  session.comment = $("r-comment") ? $("r-comment").value : session.comment;
  session.result = {
    score:r.score, grade:r.grade, ok:r.ok, tri:r.tri, x:r.x, na:r.na,
    unanswered:r.unanswered, ruleViolations:r.ruleViolations.length, total:r.total,
    rawScore:r.normalGot, maxScore:r.normalMax, situPenalty:r.situPenalty,
    rulePenalty:r.rulePenalty, inspectRate:Math.round(r.inspectRate*10)/10,
    naStages:r.naStages.join(", "), situOccurred:r.situOccurred
  };
  session.savedAt = new Date().toISOString();
  if (sent){ session.sent = true; session.sentAt = new Date().toISOString(); }
  ST.upsertHistory(session);
}

function finishToHome(){
  if (session && !session.online) persistCurrent(!!session.sent);
  var d = ST.draft();
  if (d && session && d.id === session.id) ST.clearDraft();
  session = null; editingId = null;
  resetHomeForm();
  showScreen("home"); navStack = ["home"];
  toast("점검을 저장했어요");
}
function resetHomeForm(){
  $("f-store").value=""; $("f-staff").value=""; $("f-target").value=""; $("f-inspector").value="";
  hideStoreSuggest(); applyLastInput();
  $("resumeHint").style.display = "none";
  if ($("r-comment")) $("r-comment").value = "";
}

function exportCsv(){
  var p = buildPayload();
  var head = ["점검ID","브랜드","지점명","피점검자","점검자","점검일","요일","점검시간","홀근무인원",
              "총점","등급","획득점수","채점만점","점검율","상황감점","10계명감점",
              "No","단계","일반구분","개인구분","항목","응답","배점","획득","감점","비고"];
  var lines = [head];
  p.items.forEach(function(it){
    lines.push([p.id,p.brand,p.store,p.target,p.inspector,p.date,p.weekday,p.time,p.staff,
                p.score,p.grade,p.rawScore,p.maxScore,p.inspectRate,p.situPenalty,p.rulePenalty,
                it.no,it.stage,it.kind,it.who,it.text,it.label,it.max,it.got,it.penalty,it.note]);
  });
  p.rules.forEach(function(r){
    lines.push([p.id,p.brand,p.store,p.target,p.inspector,p.date,p.weekday,p.time,p.staff,
                p.score,p.grade,p.rawScore,p.maxScore,p.inspectRate,p.situPenalty,p.rulePenalty,
                "계명"+r.no,"10계명",r.key,"",r.desc,"위반","",""," -"+r.penalty,r.action]);
  });
  var csv = lines.map(function(row){
    return row.map(function(c){ return '"'+String(c==null?"":c).replace(/"/g,'""')+'"'; }).join(",");
  }).join("\r\n");
  var blob = new Blob(["\uFEFF"+csv], { type:"text/csv;charset=utf-8;" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "MOT_"+p.store+"_"+p.date+".csv";
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  toast("CSV 파일을 저장했어요");
}

/* ============================================================
   점검 이력
   ============================================================ */
function renderHistory(){
  var hist = ST.history();
  if (!hist.length){
    $("histList").innerHTML = '<div class="empty-state"><div class="big">'+icon("i-list")+'</div>이 기기에 저장된 점검이 없어요.</div>';
    return;
  }
  $("histList").innerHTML = '<h2 style="font-size:14px; margin:14px 2px 10px;">📱 이 기기에 저장된 점검</h2>'
    + hist.map(function(h){ return histCard(h); }).join("");
}

/* 이력 카드 — 점수를 등급 색 배지로 크게 보여주고, 제외 단계와 판정 개수를 함께 표시 */
function histCard(h){
  var r = h.result || {};
  var id = jsArg(h.id);
  var meta = esc(h.date) + " (" + esc(h.weekday) + ")" + (h.time ? " " + esc(h.time) : "")
    + (h.target ? " · 대상 " + esc(h.target) : "")
    + " · 점검 " + esc(h.inspector || "-")
    + (h.staff !== undefined && h.staff !== "" ? " · 홀 " + esc(h.staff) + "명" : "");

  var excluded = r.naStages ? '제외 단계(해당없음): ' + esc(r.naStages)
               : (r.na ? '해당없음 ' + r.na + '건 제외' : "");

  var counts = "△" + (r.tri || 0) + " ✕" + (r.x || 0)
    + (r.unanswered ? " ?" + r.unanswered : "")
    + (r.situOccurred ? " ⚡" + r.situOccurred : "")
    + " 위반 " + (r.ruleViolations || 0);

  return '<div class="hist" onclick="MOTapp.viewHistory(\''+id+'\')" style="cursor:pointer;">'
    + '<div class="hist-top">'
    +   '<span class="hist-store"><span class="badge brand">'+esc(h.brand || CFG.BRAND)+'</span> '+esc(h.store)+'</span>'
    +   '<span class="badge '+(h.sent?"sent":"unsent")+'">'+(h.sent?"전송됨":"미전송")+'</span>'
    + '</div>'
    + '<div class="hist-meta">'+meta+'</div>'
    + (excluded ? '<div class="hist-meta" style="margin-top:3px;">'+excluded+'</div>' : "")
    + '<div class="hist-score-row">'
    +   '<span class="grade grade-'+(r.grade || "C")+' hist-score">'+(r.score !== undefined ? r.score : "-")+'점 · '+(r.grade || "-")+'</span>'
    +   '<span class="hist-meta">'+counts+'</span>'
    + '</div>'
    /* 전송된 점검은 기록 보존을 위해 수정·삭제할 수 없습니다 (결과 보기만 가능) */
    + '<div class="hist-actions" onclick="event.stopPropagation();">'
    +   '<button class="btn secondary" onclick="MOTapp.viewHistory(\''+id+'\')">'+icon("i-result")+'결과 보기</button>'
    +   (h.sent ? "" : '<button class="btn secondary" onclick="MOTapp.editHistory(\''+id+'\')">'+icon("i-note")+'수정하기</button>'
                     + '<button class="btn secondary" onclick="MOTapp.resendHistory(\''+id+'\')">'+icon("i-refresh")+'재전송</button>'
                     + '<button class="btn secondary" onclick="MOTapp.deleteHistory(\''+id+'\')">삭제</button>')
    + '</div></div>';
}

function viewHistory(id){
  var h = ST.findHistory(id);
  if (!h) return;
  session = JSON.parse(JSON.stringify(h));
  buildResult(); showScreen("result");
}
function editHistory(id){
  var h = ST.findHistory(id);
  if (!h) return;
  if (h.sent){ toast("이미 전송된 점검은 수정할 수 없어요"); return; }
  session = JSON.parse(JSON.stringify(h));
  editingId = id;
  fillHomeForm(session); saveDraft();
  renderCheck(); showScreen("check");
  toast("수정 모드 — 기본정보를 바꾸려면 홈으로 가서 고친 뒤 점검 시작을 누르세요");
}
function fillHomeForm(s){
  $("f-store").value = s.store || ""; $("f-staff").value = s.staff || "";
  $("f-target").value = s.target || ""; $("f-inspector").value = s.inspector || "";
  $("f-date").value = s.date || todayStr(); $("f-weekday").value = s.weekday || "";
  fillTimeSelect(String(parseInt(s.time, 10) || 0));
}
function resendHistory(id){
  var h = ST.findHistory(id);
  if (!h) return;
  session = JSON.parse(JSON.stringify(h));
  buildResult(); showScreen("result");
  toast("결과 화면에서 전송 버튼을 눌러 주세요");
}
function deleteHistory(id){
  var h = ST.findHistory(id);
  if (!h) return;
  if (h.sent){ toast("이미 전송된 점검은 삭제할 수 없어요"); return; }   // 기록 보존
  if (!confirm("이 점검 기록을 삭제할까요? 아직 전송하지 않았으므로 되돌릴 수 없습니다.")) return;
  ST.removeHistory(id); renderHistory(); toast("삭제했어요");
}

function toggleOnlineHistory(){
  var box = $("onlineHistList");
  if (box.style.display === "block"){ box.style.display = "none"; return; }
  box.style.display = "block";
  if (onlineCache){ renderOnlineHistory(); return; }
  $("onlineHistItems").innerHTML = '<div class="empty-state">불러오는 중…</div>';
  API.fetchList().then(function(list){
    onlineCache = list; renderOnlineHistory();
  }).catch(function(err){
    $("onlineHistItems").innerHTML = '<div class="empty-state">불러오지 못했어요.<br>'+esc(err.message)+'</div>';
  });
}
function renderOnlineHistory(){
  var q = ($("onlineSearch").value || "").trim();
  var list = onlineCache || [];
  if (q) list = list.filter(function(r){ return String(r.store||"").indexOf(q) >= 0; });
  if (!list.length){ $("onlineHistItems").innerHTML = '<div class="empty-state">기록이 없어요.</div>'; return; }
  /* 구글 시트에 저장된 기록은 열람 전용입니다 (수정·삭제 없음) */
  $("onlineHistItems").innerHTML = list.slice(0,100).map(function(r){
    return '<div class="hist">'
      + '<div class="hist-top">'
      +   '<span class="hist-store"><span class="badge brand">'+esc(r.brand||CFG.BRAND)+'</span> '+esc(r.store)+'</span>'
      +   '<span class="badge sent">시트 저장됨</span>'
      + '</div>'
      + '<div class="hist-meta">'+esc(r.date)+' ('+esc(r.weekday||"")+')'+(r.time?' '+esc(r.time):"")
      +   (r.target?' · 대상 '+esc(r.target):"")
      +   ' · 점검 '+esc(r.inspector||"-")
      +   (r.staff!==undefined && r.staff!=="" ? ' · 홀 '+esc(r.staff)+'명' : "")+'</div>'
      + '<div class="hist-score-row">'
      +   '<span class="grade grade-'+(r.grade||"C")+' hist-score">'+(r.score!==undefined?r.score:"-")+'점 · '+esc(r.grade||"-")+'</span>'
      +   '<span class="hist-meta">'
      +     (r.inspectRate!==undefined && r.inspectRate!=="" ? '점검율 '+fmtRate(r.inspectRate)+'%' : "")
      +     (r.ruleViolations ? ' · 위반 '+r.ruleViolations : "")
      +     (r.clVersion ? ' · '+esc(r.clVersion) : "")
      +   '</span>'
      + '</div></div>';
  }).join("");
}

/* ============================================================
   설정 · 변경 이력
   ============================================================ */
function renderSettings(){
  $("s-url").value = ST.settings().scriptUrl || "";
  $("s-critFold").checked = ST.settings().critFold === true;
  $("s-version").textContent = CFG.APP_VERSION;

  // 이미 설치해서 앱으로 실행 중이면 설치 버튼 대신 안내를 보여줍니다
  var installed = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  var ib = $("installBtn");
  if (ib){
    if (installed){
      ib.disabled = true;
      ib.innerHTML = "✅ 이미 설치되어 있어요";
      $("shortcutGuide").style.display = "none";
    } else {
      ib.disabled = false;
      ib.innerHTML = icon("i-home") + "설치하기";
      $("shortcutGuide").style.display = "";
    }
  }
  var s = CL.statusText();
  var b = $("clBadge2");
  b.className = "cl-badge " + (s.level === "ok" ? "ok" : s.level === "warn" ? "warn" : "");
  b.textContent = s.text;
  $("clSheetLink").innerHTML = '체크리스트 시트 → <a href="'+CFG.CHECKLIST_SHEET_URL+'" target="_blank" rel="noopener">MOT_고반가든_체크리스트</a>';
  $("resultSheetLink").innerHTML = '결과 시트 → <a href="'+CFG.RESULT_SHEET_URL+'" target="_blank" rel="noopener">MOT_고반가든_점검결과_V2</a>';
}
function saveUrl(){
  var s = ST.settings();
  s.scriptUrl = $("s-url").value.trim();
  ST.saveSettings(s);
  storeList = null; onlineCache = null;
  toast("저장했어요");
}
function testUrl(){
  if (!API.hasUrl()){ toast("먼저 URL을 입력하고 저장해 주세요"); return; }
  toast("확인 중…");
  API.fetchChecklist(true).then(function(d){
    if (d && d.result === "success") toast("연결 성공 — 문항 "+d.items.length+"개를 확인했어요");
    else toast("응답은 왔지만 문항을 읽지 못했어요: "+(d && d.message || ""));
  }).catch(function(err){ toast("연결 실패 — "+err.message); });
}
function reloadChecklist(){
  toast("구글 시트에서 불러오는 중…");
  CL.refresh(false, notice).then(function(){ renderSettings(); renderHomeBadge(); });
}
/* 앱 파일을 새로 내려받아 다시 시작합니다.
   (브라우저가 예전 화면·코드를 들고 있을 때 쓰는 탈출구) */
function updateApp(){
  var draft = ST.draft();
  if (draft && !confirm("작성 중인 점검이 있어요. 저장된 상태로 두고 앱을 새로 받을까요?")) return;
  toast("앱을 새로 받는 중…");
  var base = location.href.split("?")[0].split("#")[0];
  setTimeout(function(){ location.replace(base + "?r=" + Date.now()); }, 400);
}

function clearChecklistCache(){
  ST.clearChecklistCache();
  toast("저장된 사본을 지웠어요. 다시 불러옵니다.");
  CL.refresh(false, notice).then(function(){ renderSettings(); renderHomeBadge(); });
}

function renderChangelog(){
  $("changelogList").innerHTML = MOT.CHANGELOG.map(function(c, i){
    return '<div class="cl-card'+(i===0?" cur-ver":"")+'">'
      + '<div class="cl-ver"><b>v'+c.v+'</b><span class="date">'+c.date+'</span>'
      + (i===0?'<span class="cur">현재</span>':"")+'</div>'
      + '<ul>'+c.items.map(function(t){ return "<li>"+esc(t)+"</li>"; }).join("")+'</ul></div>';
  }).join("");
}

/* ============================================================
   체크리스트 상태 표시
   ============================================================ */
function renderHomeBadge(){
  var s = CL.statusText();
  var b = $("clBadge");
  b.className = "cl-badge " + (s.level === "ok" ? "ok" : s.level === "warn" ? "warn" : "");
  b.innerHTML = esc(s.text) + '<button onclick="MOTapp.reloadChecklist()">새로고침</button>';
}
function notice(msg, level){
  var box = $("homeNotice");
  if (!msg){ box.innerHTML = ""; return; }
  box.innerHTML = '<div class="notice '+(level||"info")+'">'+esc(msg)+'</div>';
  if (level === "info") setTimeout(function(){ if (box.firstChild) box.innerHTML = ""; }, 8000);
}

/* ============================================================
   홈 화면에 설치 · 메신저 인앱 브라우저 대응
   ============================================================ */
var deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", function(e){
  e.preventDefault();
  deferredInstallPrompt = e;                 // 브라우저가 설치를 지원하면 버튼으로 바로 띄웁니다
});
window.addEventListener("appinstalled", function(){
  deferredInstallPrompt = null;
  toast("앱을 설치했어요");
});

function installShortcut(){
  if (deferredInstallPrompt){
    var p = deferredInstallPrompt;
    deferredInstallPrompt = null;
    Promise.resolve(p.prompt()).then(function(){
      return p.userChoice;
    }).then(function(choice){
      toast(choice && choice.outcome === "accepted" ? "앱을 설치했어요" : "설치가 취소됐어요");
    }).catch(function(){
      showInstallGuide();
    });
    return;
  }
  showInstallGuide();
}
function showInstallGuide(){
  var g = $("shortcutGuide");
  if (g){ g.style.borderColor = "var(--brand)"; g.scrollIntoView({ behavior:"smooth", block:"center" }); }
  toast(isIOS() ? "공유 버튼 → '홈 화면에 추가'를 눌러 주세요" : "브라우저 메뉴에서 앱을 설치해 주세요");
}

function isIOS(){ return /iPhone|iPad|iPod/i.test(navigator.userAgent || ""); }
function isInAppBrowser(){
  var ua = navigator.userAgent || "";
  return /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|Line\/|DaumApps|everytimeApp|band|wv\)/i.test(ua);
}
function copyAppUrl(){
  var url = location.href;
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(url)
      .then(function(){ toast("주소를 복사했어요. Safari·Chrome 주소창에 붙여넣어 열어주세요."); })
      .catch(function(){ toast("주소: " + url); });
  } else { toast("주소: " + url); }
}
function openExternalBrowser(){
  var ua = navigator.userAgent || "", url = location.href;
  if (/KAKAOTALK/i.test(ua)){ location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(url); return; }
  if (/Android/i.test(ua) && !isIOS()){
    location.href = "intent://" + url.replace(/^https?:\/\//, "") + "#Intent;scheme=https;package=com.android.chrome;end";
    setTimeout(copyAppUrl, 1200);            // 인텐트가 안 먹을 때를 위한 폴백
    return;
  }
  copyAppUrl();                              // iOS·기타: 주소 복사 안내
}
function checkInAppBrowser(){
  if (!isInAppBrowser()) return;
  var w = $("inappWarn"); if (w) w.style.display = "block";
  if (isIOS()){ var ios = $("inappWarnIos"); if (ios) ios.style.display = "block"; }
}

/* ============================================================
   시작
   ============================================================ */
function boot(){
  initHome();
  $("backBtn").addEventListener("click", goBack);
  document.querySelectorAll("[data-go]").forEach(function(el){
    el.addEventListener("click", function(){ showScreen(el.getAttribute("data-go")); });
  });
  $("toRulesBtn").addEventListener("click", goRules);
  $("backToCheck").addEventListener("click", function(){ showScreen("check"); });
  $("toResultBtn").addEventListener("click", goResult);
  $("rulesAck").addEventListener("change", function(){
    if (session){ session.rulesAck = this.checked; saveDraft(); }
    syncRuleGate();
  });
  $("sendBtn").addEventListener("click", sendToSheet);
  $("csvBtn").addEventListener("click", exportCsv);
  $("finishBtn").addEventListener("click", finishToHome);
  $("onlineHistBtn").addEventListener("click", toggleOnlineHistory);
  $("onlineSearch").addEventListener("input", renderOnlineHistory);
  $("s-critFold").addEventListener("change", function(){
    var s = ST.settings(); s.critFold = this.checked; ST.saveSettings(s);
    if (session && $("screen-check")) renderCheck();      // 점검 중이면 즉시 반영
    toast(this.checked ? "판정 기준을 접어 둡니다" : "판정 기준을 항상 펼쳐 둡니다");
  });
  $("saveUrlBtn").addEventListener("click", saveUrl);
  $("testUrlBtn").addEventListener("click", testUrl);
  $("reloadClBtn").addEventListener("click", reloadChecklist);
  $("clearCacheBtn").addEventListener("click", clearChecklistCache);
  $("openChangelog").addEventListener("click", function(){ showScreen("changelog"); });
  $("installBtn").addEventListener("click", installShortcut);
  $("updateAppBtn").addEventListener("click", updateApp);
  $("openExternalBtn").addEventListener("click", openExternalBrowser);
  checkInAppBrowser();
  $("r-comment").addEventListener("input", function(){ if (session){ session.comment = this.value; saveDraft(); } });

  var bar = document.querySelector(".appbar");
  if (bar) document.documentElement.style.setProperty("--appbar-h", bar.offsetHeight + "px");

  CL.init(function(){ renderHomeBadge(); }, notice);
  CL.onChange(function(){ renderHomeBadge(); });
}

/* 화면에서 부르는 함수들 */
window.MOTapp = {
  showScreen: showScreen, pickStore: pickStore,
  setAnswer: setAnswer, setOccur: setOccur, setNote: setNote,
  toggleNote: toggleNote, toggleCrit: toggleCrit, jumpStage: jumpStage, jumpFirstMissing: jumpFirstMissing,
  toggleRule: toggleRule, setRuleAction: setRuleAction,
  resumeDraft: resumeDraft, discardDraft: discardDraft, cancelEdit: cancelEdit,
  viewHistory: viewHistory, editHistory: editHistory, resendHistory: resendHistory, deleteHistory: deleteHistory,
  reloadChecklist: reloadChecklist
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

})();
