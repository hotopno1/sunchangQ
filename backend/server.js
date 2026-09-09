require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPrompt(recipe, mode, userInput, topic) {
  const names = {
    1: '5W1H 변형하기',
    2: '5-Why 기법',
    3: 'Q-Matrix 기법',
    4: '열린 질문 만들기'
  };
  const descs = {
    1: 'who/when/where/what/why/how 중 하나를 골라 "만약에(if)"를 추가해 단순 사실 확인 질문을 상상력 질문으로 바꾸는 기법',
    2: '현상의 표면이 아닌 본질적 원인을 파고드는 기법. "왜?"를 5번 반복해 더 깊은 질문으로 나아감',
    3: '가로축(사실/예측상상/가치판단) x 세로축(WHAT/WHO/HOW/WHY)를 조합해 논리적이고 수준 높은 질문을 만드는 기법',
    4: '닫힌 질문(네/아니오)을 열린 질문(다양한 생각, 탐구, 토론 유발)으로 바꾸는 기법'
  };

  const name = names[recipe];
  const desc = descs[recipe];

  if (mode === 'feedback') {
    const fields = {
      1: 'score(0-100 정수), grade(A/B/C/D), gradeLabel(한줄평가어), good(잘된점 1-2문장), improve(5W1H+if 관점 보완점 1-2문장), revised(개선된 질문 1개), tip(응원 메시지 1문장)',
      2: 'score, grade, gradeLabel, good, improve, revised, whyChain(["1번째 왜: ...", "2번째 왜: ...", "3번째 왜: ..."] 배열), tip',
      3: 'score, grade, gradeLabel, matrixRow(WHAT/WHO/HOW/WHY 중 하나), matrixCol(사실/예측상상/가치판단 중 하나), matrixLevel(기초/중급/심화 중 하나), good, improve, revised, tip',
      4: 'score, grade, gradeLabel, questionType(완전히 닫힌 질문/반쯤 열린 질문/잘 열린 질문 중 하나), good, improve, revised, tip'
    };
    return '당신은 질문 생성 레시피 전문 교육 코치입니다. 한국 중학생 대상 교육용 앱입니다. 친절하고 격려하는 톤으로 답변하세요.\n\n[레시피 ' + recipe + ': ' + name + ']\n' + desc + '\n\n학생이 만든 질문: "' + userInput + '"\n\n위 질문을 레시피 ' + recipe + ' 기준으로 평가해주세요.\n아래 JSON 형식으로만 응답하세요. JSON 외 어떤 텍스트도 없이:\n{' + fields[recipe] + '}';
  }

  const formats = {
    1: '{"questions":[{"type":"WHAT+if","q":"질문"},{"type":"WHO+if","q":"질문"},{"type":"WHY+if","q":"질문"},{"type":"HOW+if","q":"질문"}],"tip":"핵심포인트"}',
    2: '{"startQuestion":"출발질문","whyChain":[{"step":1,"q":"질문"},{"step":2,"q":"질문"},{"step":3,"q":"질문"},{"step":4,"q":"질문"},{"step":5,"q":"질문"}],"insight":"핵심통찰"}',
    3: '{"questions":[{"row":"WHAT","col":"사실","q":"질문"},{"row":"WHO","col":"예측상상","q":"질문"},{"row":"HOW","col":"예측상상","q":"질문"},{"row":"WHY","col":"가치판단","q":"질문"},{"row":"WHY","col":"예측상상","q":"질문"}],"tip":"핵심포인트"}',
    4: '{"closedExamples":[{"closed":"닫힌질문1","open":"열린질문1"},{"closed":"닫힌질문2","open":"열린질문2"}],"bestQuestion":"최고열린질문","tip":"핵심포인트"}'
  };
  return '당신은 질문 생성 레시피 전문 교육 코치입니다. 한국 중학생 교육용 앱입니다.\n\n[레시피 ' + recipe + ': ' + name + ']\n' + desc + '\n\n주제: "' + topic + '"\n\n위 주제로 레시피 ' + recipe + '에 맞는 질문을 생성해주세요.\n아래 JSON 형식으로만 응답하세요. JSON 외 어떤 텍스트도 없이:\n' + formats[recipe];
}

app.post('/api/coach', async function(req, res) {
  const recipe = req.body.recipe;
  const mode = req.body.mode;
  const question = req.body.question;
  const topic = req.body.topic;
  const promptText = req.body.promptText;
  const systemPrompt = req.body.systemPrompt;

  if (!mode) {
    return res.status(400).json({ error: '필수 파라미터가 없습니다.' });
  }

  // 프롬프트 분석 모드
  if (mode === 'prompt_analyze') {
    if (!systemPrompt) return res.status(400).json({ error: '프롬프트를 입력해주세요.' });
    try {
      var message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: systemPrompt }]
      });
      var text = message.content.map(function(b) { return b.text || ''; }).join('');
      var clean = text.replace(/```json|```/g, '').trim();
      var result = JSON.parse(clean);
      return res.json({ success: true, result: result });
    } catch (err) {
      console.error('프롬프트 분석 오류:', err.message);
      return res.status(500).json({ error: 'AI 응답 오류: ' + err.message });
    }
  }

  if (mode === 'feedback' && !question) {
    return res.status(400).json({ error: '질문을 입력해주세요.' });
  }
  if (mode === 'generate' && !topic) {
    return res.status(400).json({ error: '주제를 입력해주세요.' });
  }

  try {
    var prompt = buildPrompt(recipe, mode, question, topic);
    var message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });
    var text = message.content.map(function(b) { return b.text || ''; }).join('');
    var clean = text.replace(/```json|```/g, '').trim();
    var result = JSON.parse(clean);
    res.json({ success: true, result: result });
  } catch (err) {
    console.error('API 오류:', err.message);
    res.status(500).json({ error: 'AI 응답 오류: ' + err.message });
  }
});

app.get('/health', function(req, res) {
  res.json({ status: 'ok' });
});

app.listen(PORT, function() {
  console.log('서버 실행 중: http://localhost:' + PORT);
});
