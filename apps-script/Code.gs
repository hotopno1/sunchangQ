/**
 * AI 질문 코치 — Google Apps Script 백엔드
 *
 * 이 파일 하나가 예전 Railway 서버(server.js)가 하던 일을 모두 대신합니다.
 *  1) Claude API 호출 (질문 생성 / 질문 평가 / AI 프롬프트 다듬기)
 *  2) 랭킹 저장 및 조회 (이 스크립트가 붙어 있는 스프레드시트)
 *
 * [처음 설정]
 *  1. 구글 스프레드시트를 하나 만듭니다. (예: 'AI 질문 코치 랭킹')
 *  2. 확장 프로그램 > Apps Script 를 열고, 기본 코드를 지운 뒤 이 파일 내용을 전부 붙여넣습니다.
 *  3. 왼쪽 톱니바퀴(프로젝트 설정) > 스크립트 속성 에서
 *       속성 이름: ANTHROPIC_API_KEY
 *       값:        sk-ant- 로 시작하는 본인 API 키
 *     를 추가하고 저장합니다.
 *  4. 오른쪽 위 '배포 > 새 배포' > 유형 '웹 앱'
 *       실행 사용자: 나
 *       액세스 권한: 모든 사용자
 *     로 배포하고, 나오는 웹 앱 URL을 복사해 index.html 의 SCRIPT_API 에 붙여넣습니다.
 *
 * [코드를 고친 뒤에는]
 *  배포 > 배포 관리 > 연필 아이콘 > 버전 '새 버전' > 배포
 *  (이렇게 해야 URL이 바뀌지 않고 수정 내용이 반영됩니다.)
 */

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────
var MODEL = 'claude-haiku-5-5';   // 빠르고 저렴한 모델
var MAX_TOKENS = 2048;
var SHEET_NAME = 'ranking';       // 이 이름의 시트가 없으면 첫 번째 시트를 사용

// ─────────────────────────────────────────────
// 웹 요청 입구
// ─────────────────────────────────────────────
function doGet(e) {
  try {
    return jsonOut({ success: true, data: readRanking() });
  } catch (err) {
    return jsonOut({ success: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || 'coach';

    if (action === 'coach') return jsonOut(handleCoach(body));
    if (action === 'rank_save') return jsonOut(handleRankSave(body));
    if (action === 'rank_list') return jsonOut({ success: true, data: readRanking() });

    return jsonOut({ success: false, error: '알 수 없는 요청입니다: ' + action });
  } catch (err) {
    return jsonOut({ success: false, error: String(err.message || err) });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────
// Claude API 호출
// ─────────────────────────────────────────────
function askClaude(prompt) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('API 키가 설정되지 않았습니다. 스크립트 속성에 ANTHROPIC_API_KEY를 추가해주세요.');

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var raw = res.getContentText();
  if (code !== 200) {
    var msg = raw;
    try { msg = JSON.parse(raw).error.message; } catch (ignore) {}
    throw new Error('AI 응답 오류(' + code + '): ' + msg);
  }

  var data = JSON.parse(raw);
  var text = '';
  for (var i = 0; i < data.content.length; i++) {
    if (data.content[i].type === 'text') text += data.content[i].text;
  }
  return text;
}

/** AI 답변에서 JSON 부분만 안전하게 뽑아내기 */
function parseJsonLoose(text) {
  var clean = String(text).replace(/```json/g, '').replace(/```/g, '').trim();
  var start = clean.indexOf('{');
  var end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI가 올바른 형식으로 답하지 않았어요. 다시 시도해주세요.');
  return JSON.parse(clean.slice(start, end + 1));
}

// ─────────────────────────────────────────────
// 레시피별 프롬프트
// ─────────────────────────────────────────────
var RECIPE_NAMES = {
  1: '5W1H 변형하기',
  2: '5-Why 기법',
  3: 'Q-Matrix 기법',
  4: '열린 질문 만들기'
};

var RECIPE_DESCS = {
  1: 'who/when/where/what/why/how 중 하나를 골라 "만약에(if)"를 추가해 단순 사실 확인 질문을 상상력 질문으로 바꾸는 기법',
  2: '현상의 표면이 아닌 본질적 원인을 파고드는 기법. "왜?"를 5번 반복해 더 깊은 질문으로 나아감',
  3: '가로축(사실/예측상상/가치판단) x 세로축(WHAT/WHO/HOW/WHY)를 조합해 논리적이고 수준 높은 질문을 만드는 기법',
  4: '닫힌 질문(네/아니오)을 열린 질문(다양한 생각, 탐구, 토론 유발)으로 바꾸는 기법'
};

var FEEDBACK_FIELDS = {
  1: 'score(0-100 정수), grade(A/B/C/D), gradeLabel(한줄평가어), good(잘된점 1-2문장), improve(5W1H+if 관점 보완점 1-2문장), revised(개선된 질문 1개), tip(응원 메시지 1문장)',
  2: 'score, grade, gradeLabel, good, improve, revised, whyChain(["1번째 왜: ...", "2번째 왜: ...", "3번째 왜: ..."] 배열), tip',
  3: 'score, grade, gradeLabel, matrixRow(WHAT/WHO/HOW/WHY 중 하나), matrixCol(사실/예측상상/가치판단 중 하나), matrixLevel(기초/중급/심화 중 하나), good, improve, revised, tip',
  4: 'score, grade, gradeLabel, questionType(완전히 닫힌 질문/반쯤 열린 질문/잘 열린 질문 중 하나), good, improve, revised, tip'
};

var GENERATE_FORMATS = {
  1: '{"questions":[{"type":"WHAT+if","q":"질문"},{"type":"WHO+if","q":"질문"},{"type":"WHY+if","q":"질문"},{"type":"HOW+if","q":"질문"}],"tip":"핵심포인트"}',
  2: '{"startQuestion":"출발질문","whyChain":[{"step":1,"q":"질문"},{"step":2,"q":"질문"},{"step":3,"q":"질문"},{"step":4,"q":"질문"},{"step":5,"q":"질문"}],"insight":"핵심통찰"}',
  3: '{"questions":[{"row":"WHAT","col":"사실","q":"질문"},{"row":"WHO","col":"예측상상","q":"질문"},{"row":"HOW","col":"예측상상","q":"질문"},{"row":"WHY","col":"가치판단","q":"질문"},{"row":"WHY","col":"예측상상","q":"질문"}],"tip":"핵심포인트"}',
  4: '{"closedExamples":[{"closed":"닫힌질문1","open":"열린질문1"},{"closed":"닫힌질문2","open":"열린질문2"}],"bestQuestion":"최고열린질문","tip":"핵심포인트"}'
};

function buildRecipePrompt(recipe, mode, question, topic) {
  var head = '당신은 질문 생성 레시피 전문 교육 코치입니다. 한국 중학생 대상 교육용 앱입니다.\n\n' +
             '[레시피 ' + recipe + ': ' + RECIPE_NAMES[recipe] + ']\n' + RECIPE_DESCS[recipe] + '\n\n';

  if (mode === 'feedback') {
    return head +
      '친절하고 격려하는 톤으로 답변하세요.\n\n학생이 만든 질문: "' + question + '"\n\n' +
      '위 질문을 레시피 ' + recipe + ' 기준으로 평가해주세요.\n' +
      '아래 JSON 형식으로만 응답하세요. JSON 외 어떤 텍스트도 없이:\n{' + FEEDBACK_FIELDS[recipe] + '}';
  }

  return head +
    '주제: "' + topic + '"\n\n위 주제로 레시피 ' + recipe + '에 맞는 질문을 생성해주세요.\n' +
    '아래 JSON 형식으로만 응답하세요. JSON 외 어떤 텍스트도 없이:\n' + GENERATE_FORMATS[recipe];
}

/** AI 프롬프트 만들기 3단계 */
function buildStepPrompt(step, sentence, context) {
  var head = '당신은 AI 프롬프트 교육 코치입니다. 한국 중학생 대상입니다.\n\n';
  var ctx = context
    ? '\n\n[수업 맥락] ' + context +
      '\n제안하는 문장은 반드시 이 과목과 핵심 키워드에 관련된 내용이 되도록 다듬으세요. ' +
      '학생이 이 주제를 공부할 때 AI에게 실제로 보낼 만한 문장이어야 합니다.'
    : '';

  if (step === 1) {
    return head + '학생의 원래 문장: "' + sentence + '"' + ctx +
      '\n\n[1단계: 명확성 높이기]\n이 문장에서 대상/범위/종류가 불분명한 부분을 명확하게 만든 버전 3개를 제안하세요. ' +
      '각 버전에서 명확성을 높인 핵심 구절도 알려주세요.\n\nJSON으로만 응답:\n' +
      '{"explanation":"명확성이란 대상과 범위를 분명히 하는 것입니다. 예시 1문장","problem":"원래 문장에서 불명확한 점 1문장",' +
      '"options":[{"text":"명확하게 바꾼 버전1","highlight":"핵심 구절"},{"text":"명확하게 바꾼 버전2","highlight":"핵심 구절"},{"text":"명확하게 바꾼 버전3","highlight":"핵심 구절"}]}';
  }

  if (step === 2) {
    return head + '1단계 완성 문장: "' + sentence + '"' + ctx +
      '\n\n[2단계: 구체성 높이기]\n이 문장에 숫자, 조건, 형식 등을 추가해 더 구체적으로 만든 버전 3개를 제안하세요. ' +
      '각 버전에서 구체성을 높인 핵심 구절도 알려주세요.\n\nJSON으로만 응답:\n' +
      '{"explanation":"구체성이란 원하는 내용을 세밀하게 표현하는 것입니다. 예시 1문장","problem":"현재 문장에서 더 구체화할 수 있는 점 1문장",' +
      '"options":[{"text":"구체적으로 바꾼 버전1","highlight":"핵심 구절"},{"text":"구체적으로 바꾼 버전2","highlight":"핵심 구절"},{"text":"구체적으로 바꾼 버전3","highlight":"핵심 구절"}]}';
  }

  return head + '2단계 완성 문장: "' + sentence + '"' + ctx +
    '\n\n[3단계: 목적 추가하기]\n이 문장에 목적(왜 필요한지, 어떻게 사용할지)을 추가한 버전 3개를 제안하세요.\n\n' +
    '⚠️ 중요: 목적은 반드시 문장의 맨 앞에 배치하세요. 형식: "[목적을 나타내는 구절] + 기존 문장" 순서로 작성하세요.\n' +
    '예시: "학교 발표 준비를 위해, ..." 또는 "친구들과 추억을 남기려고, ..." 처럼 목적이 앞에 와야 합니다.\n\nJSON으로만 응답:\n' +
    '{"explanation":"목적을 문장 앞에 추가하면 AI가 왜 이 정보가 필요한지 바로 파악할 수 있습니다.","problem":"현재 문장에 목적이 빠진 이유 1문장",' +
    '"options":[{"text":"[목적구절] + 기존문장 버전1","highlight":"맨 앞에 추가된 목적 구절"},{"text":"[목적구절] + 기존문장 버전2","highlight":"맨 앞에 추가된 목적 구절"},{"text":"[목적구절] + 기존문장 버전3","highlight":"맨 앞에 추가된 목적 구절"}]}';
}

// ─────────────────────────────────────────────
// 요청 처리
// ─────────────────────────────────────────────
function handleCoach(body) {
  var mode = body.mode;

  if (mode === 'prompt_analyze') {
    var step = Number(body.step);
    if (!body.sentence) return { success: false, error: '문장을 입력해주세요.' };
    if (!(step >= 1 && step <= 3)) return { success: false, error: '단계 정보가 잘못되었습니다.' };
    return {
      success: true,
      result: parseJsonLoose(askClaude(buildStepPrompt(step, String(body.sentence), body.context ? String(body.context) : '')))
    };
  }

  var recipe = Number(body.recipe);
  if (!RECIPE_NAMES[recipe]) return { success: false, error: '레시피를 선택해주세요.' };
  if (mode === 'feedback' && !body.question) return { success: false, error: '질문을 입력해주세요.' };
  if (mode === 'generate' && !body.topic) return { success: false, error: '주제를 입력해주세요.' };
  if (mode !== 'feedback' && mode !== 'generate') return { success: false, error: '알 수 없는 모드입니다.' };

  var prompt = buildRecipePrompt(recipe, mode, String(body.question || ''), String(body.topic || ''));
  return { success: true, result: parseJsonLoose(askClaude(prompt)) };
}

function handleRankSave(body) {
  var studentId = String(body.studentId || '');
  if (!/^\d{4}$/.test(studentId)) return { success: false, error: '학번 4자리 숫자를 입력해주세요.' };
  if (!body.question) return { success: false, error: '질문이 없습니다.' };

  // 여러 학생이 동시에 눌러도 기록이 섞이지 않도록 순서를 세움
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    getSheet().appendRow([
      body.recipe,
      body.question,
      body.score,
      body.grade,
      Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
      "'" + studentId          // 앞의 ' 는 0으로 시작하는 학번이 숫자로 바뀌지 않게 막아줌
    ]);
  } finally {
    lock.releaseLock();
  }
  return { success: true };
}

// ─────────────────────────────────────────────
// 시트 다루기
// ─────────────────────────────────────────────
function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['recipe', 'question', 'score', 'grade', 'timestamp', 'studentId']);
  }
  return sheet;
}

function readRanking() {
  var rows = getSheet().getDataRange().getValues();
  var data = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[1] || r[2] === '' || r[2] === null) continue;
    data.push({
      recipe: r[0],
      question: r[1],
      score: r[2],
      grade: r[3],
      timestamp: r[4]
      // 학번(r[5])은 내보내지 않음 — 시트에서 선생님만 확인
    });
  }
  data.sort(function (a, b) { return Number(b.score) - Number(a.score); });
  return data;
}

// ─────────────────────────────────────────────
// 설정 확인용 — 스크립트 편집기에서 직접 실행해보세요
// ─────────────────────────────────────────────
function 설정확인() {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  Logger.log(key ? 'API 키 등록됨 (' + key.slice(0, 10) + '...)' : '❌ API 키가 없습니다');
  Logger.log('시트 이름: ' + getSheet().getName());
  Logger.log('AI 테스트: ' + askClaude('안녕이라고만 답해줘').slice(0, 50));
}
