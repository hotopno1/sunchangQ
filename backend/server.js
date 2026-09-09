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
  const recipeInfo = {
    1: { name: '5W1H 변형하기', desc: 'who/when/where/what/why/how 중 하나를 골라 "만약에(if)"를 추가해 단순 사실 확인 질문을 상상력·가설적 사고 질문으로 바꾸는 기법' },
    2: { name: '5-Why 기법', desc: '현상의 표면이 아닌 본질적 원인을 파고드는 기법. "왜?"를 5번 반복해 더 깊은 질문으로 나아감' },
    3: { name: 'Q-Matrix 기법', desc: '가로축(사실 / 예측·상상 / 가치·판단) × 세로축(WHAT / WHO / HOW /
