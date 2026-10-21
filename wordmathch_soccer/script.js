const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

const DEFAULT_GAME_CONFIG = {
  timing: {
    gameDurationMs: 40_000,
    questionDurationMs: 6_000,
    resultDurationMs: 1_100,
  },
  scoring: {
    correct: 100,
    incorrect: -10,
    comboEvery: 3,
    comboBonus: 100,
  },
  questions: [
    {
      word: "come back",
      answer: "(제자리로) 돌아오다, 되돌아가다",
      decoy: "(…에서) 나오다, 생겨나다",
    },
  ],
};

function readEmbeddedGameConfig() {
  const element = document.querySelector("#gameConfig");
  if (!element) {
    return DEFAULT_GAME_CONFIG;
  }

  try {
    const value = JSON.parse(element.textContent);
    return value && typeof value === "object" ? value : DEFAULT_GAME_CONFIG;
  } catch {
    return DEFAULT_GAME_CONFIG;
  }
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const GAME_CONFIG = readEmbeddedGameConfig();
const GAME_DURATION_MS = finiteNumber(
  GAME_CONFIG.timing?.gameDurationMs,
  DEFAULT_GAME_CONFIG.timing.gameDurationMs,
);
// 2차 수정: 한 판 시간은 API info 의 play_time(초)이 먼저다. 주지 않으면 위 설정값(40초)이다.
// 데모에는 API 시간이 없으므로 설정값을 쓴다. 상한·하한은 두지 않는다(사장님 결정 — 값은 API 에서 고친다).
let gameDurationMs = GAME_DURATION_MS;

function resolveGameDurationMs(info, launch) {
  if (!launch || launch.isDemo) {
    return GAME_DURATION_MS;
  }
  const raw = info?.play_time;
  // 숫자이거나 숫자만 적힌 글자만 받는다. Number(true) 는 1, Number("") 는 0 이라 그대로 쓰면 1초 판, 0초 판이 된다.
  const seconds = typeof raw === "number"
    ? raw
    : typeof raw === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(raw) ? Number(raw) : Number.NaN;
  // 밀리초로 바꾼 뒤에 유한한지 본다. 아주 큰 초는 곱하면 무한대가 되어 판이 끝나지 않는다.
  const milliseconds = seconds * 1000;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : GAME_DURATION_MS;
}

const QUESTION_DURATION_MS = finiteNumber(
  GAME_CONFIG.timing?.questionDurationMs,
  DEFAULT_GAME_CONFIG.timing.questionDurationMs,
);
const RESULT_DURATION_MS = finiteNumber(
  GAME_CONFIG.timing?.resultDurationMs,
  DEFAULT_GAME_CONFIG.timing.resultDurationMs,
);
const CORRECT_GOAL_DELAY_MS = 684;
const INCORRECT_IMPACT_DELAY_MS = 594;
const COMBO_EFFECT_VISIBLE_MS = 900;
// 골키퍼 배치 액션은 900ms 중 34% 지점부터 실제로 움직인다.
// 다이빙 그림도 그 순간 바꿔야 제자리에 얼어 있는 구간이 생기지 않는다.
const KEEPER_DIVE_START_MS = 306;
const ACTION_SCENE_ASSETS = {
  goalkeeper: {
    wait: "assets/game/goalkeeper_waite.webp",
    diveLeft: "assets/game/goalkeeper_left.png",
    diveRight: "assets/game/goalkeeper_right.png",
    save: "assets/game/goalkeeper_succese.webp",
    concede: "assets/game/goalkeeper_faile.webp",
  },
  kicker: {
    wait: "assets/game/kicker_waite.webp",
    kick: "assets/game/kicker_kic.webp",
    goal: "assets/game/kicker_succese.webp",
    blocked: "assets/game/kicker_faile.webp",
  },
};

function preloadActionSceneAssets() {
  Object.values(ACTION_SCENE_ASSETS).forEach((group) => {
    Object.values(group).forEach((src) => {
      const image = new Image();
      image.src = src;
    });
  });
}

preloadActionSceneAssets();

// 검수 신규: 등급별 여우도 미리 받아 둔다. 결과화면은 판이 끝나는 순간 바로 뜨는데,
// 그때 처음 받기 시작하면 그림이 늦게 나타난다. 미리 받아 두면 주소를 넣는 그 자리에서
// 이미 읽힌 상태가 되어 빈 자리가 생기지 않는다.
function preloadResultFoxAssets() {
  Object.values(RESULT_TITLE_ASSETS).forEach((asset) => {
    const image = new Image();
    image.src = asset.fox;
  });
}
const PARTICLE_COLORS = {
  goal: ["#fff35a", "#ffffff", "#2ce8ff", "#ff6a9e", "#ff9f2f"],
  impact: ["#ffffff", "#d8e5ef", "#aebfca", "#c7aa81", "#8a7761"],
  combo: ["#fff45c", "#ff9a2f", "#ff4db7", "#ffffff", "#42eeff"],
  result: ["#fff044", "#ff7338", "#25dfff", "#ff4ca8", "#ffffff", "#6bf06f"],
};
const RESULT_TITLE_ASSETS = {
  excellent: {
    src: "assets/result/result_text0.png",
    alt: "Excellent",
    // 검수 신규: 등급마다 여우 표정이 다르다. 파일 이름이 곧 등급이다.
    fox: "assets/result/excellent.png?v=2026-09-30-1",
  },
  good: {
    src: "assets/result/result_text1.png",
    alt: "Good",
    fox: "assets/result/good.png?v=2026-09-30-1",
  },
  tryAgain: {
    // 검수 삼차 열째 항으로 내용이 바뀐 그림이라 주소에 번호를 단다.
    src: "assets/result/result_text2.png?v=20260929-1",
    alt: "Try Again",
    fox: "assets/result/try_again.png?v=2026-09-30-1",
  },
};
preloadResultFoxAssets();
const SCORING = {
  correct: finiteNumber(GAME_CONFIG.scoring?.correct, DEFAULT_GAME_CONFIG.scoring.correct),
  incorrect: finiteNumber(GAME_CONFIG.scoring?.incorrect, DEFAULT_GAME_CONFIG.scoring.incorrect),
  comboEvery: Math.max(
    1,
    Math.floor(finiteNumber(GAME_CONFIG.scoring?.comboEvery, DEFAULT_GAME_CONFIG.scoring.comboEvery)),
  ),
  comboBonus: finiteNumber(
    GAME_CONFIG.scoring?.comboBonus,
    DEFAULT_GAME_CONFIG.scoring.comboBonus,
  ),
};
const configuredQuestions = Array.isArray(GAME_CONFIG.questions)
  ? GAME_CONFIG.questions.filter(
    (question) => question
      && typeof question.word === "string"
      && typeof question.answer === "string"
      && typeof question.decoy === "string",
  )
  : [];
let questions = configuredQuestions.length > 0
  ? configuredQuestions
  : DEFAULT_GAME_CONFIG.questions;

const RESULT_DATA_ADAPTER = {
  async getSummary(session) {
    const externalAdapter = window.WordMatchResultAdapter;
    if (externalAdapter && typeof externalAdapter.getSummary === "function") {
      return externalAdapter.getSummary({ ...session });
    }

    const content = window.WordMatchContent;
    const contentState = content?.getState?.();
    if (
      content
      && contentState?.launch
      && !contentState.launch.isGuest
      && !contentState.launch.isDemo
    ) {
      const result = await content.saveHistory(session.totalScore);
      return {
        rank: result?.rank ?? 0,
        cumulativeScore: session.totalScore,
        source: "api",
      };
    }

    return {
      rank: null,
      cumulativeScore: session.totalScore,
      source: "local",
    };
  },
};

const SOUND_ASSETS = {
  touch: "assets/sound/touch.mp3",
  correct: "assets/sound/success.mp3",
  incorrect: "assets/sound/fail.mp3",
  cheer: "assets/sound/audience_success_re.mp3",
  boo: "assets/sound/audience_fail_re.mp3",
};

// 배경음: 첫 사용자 동작 뒤 반복 재생하고 소리 버튼을 따른다 (형제 OX 방 배경음 기준).
const BGM_SRC = "assets/sound/bgm/the_morning_hop.mp3";
// 효과음은 볼륨을 따로 두지 않아 기본 크기로 나오므로 배경음은 그 아래에 깐다.
const BGM_VOLUME = 0.15;
// 브라우저 자동재생 정책상 사용자 동작이 있어야 소리를 낼 수 있다.
const BGM_GESTURE_EVENTS = Object.freeze([
  "pointerup",
  "click",
  "touchend",
  "keydown",
]);

const app = document.querySelector("#app");
const stage = document.querySelector("#gameStage");
const startScreen = document.querySelector("#startScreen");
const playScreen = document.querySelector("#playScreen");
const soundButton = document.querySelector("#soundButton");
const soundIcon = document.querySelector("#soundIcon");
const closeButton = document.querySelector("#closeButton");
const closeButtonIcon = closeButton.querySelector("img");
const startButton = document.querySelector("#startButton");
const rankingButton = document.querySelector("#rankingButton");
const resultRankingButton = document.querySelector("#resultRankingButton");
const loadingPanel = document.querySelector("#loadingPanel");
const loadingTitle = document.querySelector("#loadingTitle");
const loadingMessage = document.querySelector("#loadingMessage");
const retryLoadButton = document.querySelector("#retryLoadButton");
const statusToast = document.querySelector("#statusToast");
const quizWord = document.querySelector("#quizWord");
const storyInfo = document.querySelector("#storyInfo");
const storyTitle = document.querySelector("#storyTitle");
const storySubtitle = document.querySelector("#storySubtitle");
const questionCountdown = document.querySelector("#questionCountdown");
const questionCountdownTimer = document.querySelector("#questionCountdownTimer");
const questionCountdownValue = document.querySelector("#questionCountdownValue");
const questionCountdownStatus = document.querySelector("#questionCountdownStatus");
const choiceButtons = [
  document.querySelector("#choiceLeft"),
  document.querySelector("#choiceRight"),
];
const choiceTextElements = choiceButtons.map((button) => button.querySelector("span"));
const feedbackText = document.querySelector("#feedbackText");
const comboText = document.querySelector("#comboText");
const goalkeeperImage = document.querySelector("#goalkeeper");
const kickerImage = document.querySelector("#kicker");
const scoreValue = document.querySelector("#scoreValue");
const scoreBurst = document.querySelector("#scoreBurst");
const totalTimeText = document.querySelector("#totalTimeText");
const timerClock = document.querySelector(".timer-clock");
const comboMeter = document.querySelector("#comboMeter");
const comboBalls = [...document.querySelectorAll("[data-combo-step]")];
const gameParticleCanvas = document.querySelector("#gameParticleCanvas");
const resultParticleCanvas = document.querySelector("#resultParticleCanvas");
const endOverlay = document.querySelector("#endOverlay");
const resultCorrectPoints = document.querySelector("#resultCorrectPoints");
const resultIncorrectPoints = document.querySelector("#resultIncorrectPoints");
const resultBonusPoints = document.querySelector("#resultBonusPoints");
const resultCorrectCount = document.querySelector("#resultCorrectCount");
const resultIncorrectCount = document.querySelector("#resultIncorrectCount");
const resultTitle = document.querySelector("#resultTitle");
const resultMessage = document.querySelector("#resultMessage");
const resultFox = document.querySelector("#resultFox");
const resultRank = document.querySelector("#resultRank");
const resultTotalScore = document.querySelector("#resultTotalScore");
const resultScoreNumber = document.querySelector("#resultScoreNumber");
const resultHomeButton = document.querySelector("#resultHomeButton");
const helpButton = document.querySelector("#helpButton");
const helpScreen = document.querySelector("#helpScreen");
const helpContent = document.querySelector("#helpContent");
const helpStatus = document.querySelector("#helpStatus");
const helpStatusMessage = document.querySelector("#helpStatusMessage");
const helpRetryButton = document.querySelector("#helpRetryButton");
const incorrectAnswersButton = document.querySelector("#incorrectAnswersButton");
const incorrectAnswerDialog = document.querySelector("#incorrectAnswerDialog");
const incorrectAnswerBackdrop = document.querySelector("#incorrectAnswerBackdrop");
const incorrectAnswerCloseButton = document.querySelector("#incorrectAnswerCloseButton");
const incorrectAnswerList = document.querySelector("#incorrectAnswerList");
const tryAgainButton = document.querySelector("#tryAgainButton");
const rankingDialog = document.querySelector("#rankingDialog");
const rankingBackdrop = document.querySelector("#rankingBackdrop");
const rankingCloseButton = document.querySelector("#rankingCloseButton");
const rankingMemberSummary = document.querySelector("#rankingMemberSummary");
const rankingMemberBadgeImage = document.querySelector("#rankingMemberBadgeImage");
const rankingMemberBadgeFallback = document.querySelector("#rankingMemberBadgeFallback");
const rankingMemberName = document.querySelector("#rankingMemberName");
const rankingMemberScore = document.querySelector("#rankingMemberScore");
const rankingStatus = document.querySelector("#rankingStatus");
const rankingTable = document.querySelector("#rankingTable");
const rankingList = document.querySelector("#rankingList");
const textAnimationFrames = new WeakMap();
const incorrectAnswerRecords = new Map();
const activeAudioElements = new Set();
const questionAudio = new Audio();
questionAudio.preload = "auto";
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const gameParticleLayer = createParticleLayer(gameParticleCanvas, 120);
const resultParticleLayer = createParticleLayer(resultParticleCanvas, 140);

let soundEnabled = true;
let bgmAudio = null;
// 배경음을 원하는 화면인지. 시작 화면은 켜 두는 화면이라 참으로 시작하고,
// 결과화면에서 내려 둔다. 첫 사용자 동작 손잡이는 이 값을 올리지 않는다.
let bgmWanted = true;
let bgmGestureHandler = null;
let toastTimer;
let gameTickTimer;
let resultTimer;
let judgementTimer;
let keeperDiveTimer;
let gameEndsAt = 0;
// 판정 연출이 도는 동안에는 전체 남은 시간이 줄지 않게 한다.
// 시작 시각을 들고 있다가 다음 문제로 넘어갈 때 흘러간 만큼 종료 시각을 뒤로 민다.
let clockHoldStartedAt = 0;
// 결과 요약 갱신에는 회원 점수 저장이 들어 있다. 시작 화면으로 나갈 때 이것을 기다린다.
let resultSummaryPromise = Promise.resolve();
let leavingResult = false;
let questionEndsAt = 0;
let score = 0;
// 검수 보너스 효과: 점수판에 보이는 값과 굴림 상태. 실제 점수(score)와 따로 둔다.
let scoreShown = 0;
let scoreTween = 0;
let scoreBonusTimer = 0;
// 늦게 도는 폴백이 재시작 뒤의 새 점수를 옛 값으로 덮지 않도록 굴림마다 번호를 매긴다.
let scoreTweenToken = 0;
let correctPoints = 0;
let incorrectPoints = 0;
let bonusPoints = 0;
let correctCount = 0;
let incorrectCount = 0;
let timeoutCount = 0;
let correctStreak = 0;
let comboResetPending = false;
let lastQuestionIndex = -1;
let acceptingAnswer = false;
let gameRunning = false;
let resultRequestToken = 0;
let contentLoadToken = 0;
let contentReady = false;
let launchContext = null;
let lastQuestionCountdownText = "";
let incorrectAnswerSequence = 0;
let incorrectDialogReturnFocus = null;
let helpReturnFocus = null;
let helpRequestToken = 0;
let currentQuestionSoundUrl = "";
let questionAudioPlayToken = 0;
let rankingRequestToken = 0;
let rankingDialogReturnFocus = null;
let resultRankingReady = false;
let rankingRequestPending = false;

function resizeStage() {
  const styles = getComputedStyle(app);
  const safeWidth = app.clientWidth
    - Number.parseFloat(styles.paddingLeft || "0")
    - Number.parseFloat(styles.paddingRight || "0");
  const safeHeight = app.clientHeight
    - Number.parseFloat(styles.paddingTop || "0")
    - Number.parseFloat(styles.paddingBottom || "0");

  const scale = Math.min(safeWidth / DESIGN_WIDTH, safeHeight / DESIGN_HEIGHT);
  stage.style.setProperty("--stage-scale", String(Math.max(scale, 0.01)));
}

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function particleDensity() {
  if (reducedMotionQuery.matches) {
    return 0.35;
  }

  const hasLimitedCores = Number(navigator.hardwareConcurrency || 8) <= 4;
  const compactViewport = Math.min(window.innerWidth, window.innerHeight) <= 900;
  return hasLimitedCores || compactViewport ? 0.68 : 1;
}

function particleCount(baseCount) {
  return Math.max(1, Math.round(baseCount * particleDensity()));
}

function createParticleLayer(canvas, maximumParticles) {
  const context = canvas?.getContext("2d", { alpha: true });
  if (!context) {
    return Object.freeze({
      add() {},
      clear() {},
    });
  }

  const activeParticles = [];
  const particlePool = [];
  let animationFrame = 0;
  let previousTime = 0;

  function releaseParticle(index) {
    const [particle] = activeParticles.splice(index, 1);
    if (particle) {
      particlePool.push(particle);
    }
  }

  function drawStar(particle) {
    context.beginPath();
    for (let point = 0; point < 10; point += 1) {
      const radius = point % 2 === 0 ? particle.size : particle.size * 0.43;
      const angle = -Math.PI / 2 + (point * Math.PI) / 5;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (point === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.closePath();
    context.fill();
  }

  function drawParticle(particle, progress) {
    const opacity = particle.alpha
      * Math.pow(Math.max(0, 1 - progress), particle.fadePower);

    context.save();
    context.globalAlpha = opacity;
    context.translate(particle.x, particle.y);
    context.rotate(particle.rotation);

    if (particle.type === "glow") {
      context.globalCompositeOperation = "lighter";
      const gradient = context.createRadialGradient(
        0,
        0,
        0,
        0,
        0,
        particle.radius,
      );
      gradient.addColorStop(0, particle.color);
      gradient.addColorStop(0.28, particle.color);
      gradient.addColorStop(1, "transparent");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(0, 0, particle.radius, 0, Math.PI * 2);
      context.fill();
    } else if (particle.type === "ring") {
      context.globalCompositeOperation = "lighter";
      context.strokeStyle = particle.color;
      context.lineWidth = particle.lineWidth * Math.max(0.35, 1 - progress);
      context.beginPath();
      context.arc(0, 0, particle.radius, 0, Math.PI * 2);
      context.stroke();
    } else if (particle.type === "star") {
      context.globalCompositeOperation = "lighter";
      context.fillStyle = particle.color;
      drawStar(particle);
    } else if (particle.type === "confetti") {
      context.fillStyle = particle.color;
      context.fillRect(
        -particle.width / 2,
        -particle.height / 2,
        particle.width,
        particle.height,
      );
    } else {
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(0, 0, particle.size, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  }

  function renderFrame(timestamp) {
    const elapsed = previousTime
      ? Math.min(2.25, Math.max(0.35, (timestamp - previousTime) / 16.667))
      : 1;
    previousTime = timestamp;
    context.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

    for (let index = activeParticles.length - 1; index >= 0; index -= 1) {
      const particle = activeParticles[index];
      const elapsedMs = elapsed * 16.667;

      if (particle.delay > 0) {
        particle.delay -= elapsedMs;
        continue;
      }

      particle.age += elapsedMs;
      if (particle.age >= particle.duration) {
        releaseParticle(index);
        continue;
      }

      const progress = particle.age / particle.duration;
      particle.vy += particle.gravity * elapsed;
      particle.x += (
        particle.vx
        + Math.sin(particle.phase + particle.age * 0.006) * particle.sway
      ) * elapsed;
      particle.y += particle.vy * elapsed;
      particle.rotation += particle.spin * elapsed;
      particle.radius += particle.growth * elapsed;
      drawParticle(particle, progress);
    }

    if (activeParticles.length > 0) {
      animationFrame = window.requestAnimationFrame(renderFrame);
    } else {
      animationFrame = 0;
      previousTime = 0;
      context.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    }
  }

  function add(options = {}) {
    if (activeParticles.length >= maximumParticles) {
      releaseParticle(0);
    }

    const particle = particlePool.pop() || {};
    Object.assign(particle, {
      type: "circle",
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      gravity: 0,
      sway: 0,
      phase: randomBetween(0, Math.PI * 2),
      size: 6,
      width: 8,
      height: 16,
      radius: 6,
      growth: 0,
      rotation: 0,
      spin: 0,
      color: "#ffffff",
      alpha: 1,
      fadePower: 1.2,
      lineWidth: 4,
      duration: 800,
      delay: 0,
      age: 0,
      ...options,
    });
    activeParticles.push(particle);

    if (!animationFrame) {
      animationFrame = window.requestAnimationFrame(renderFrame);
    }
  }

  function clear() {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
    }
    animationFrame = 0;
    previousTime = 0;
    while (activeParticles.length > 0) {
      releaseParticle(activeParticles.length - 1);
    }
    context.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  }

  return Object.freeze({ add, clear });
}

function emitGoalParticles(shotSide) {
  const originX = shotSide === "left" ? 686 : 1210;
  const originY = 480;

  gameParticleLayer.add({
    type: "glow",
    x: originX,
    y: originY,
    radius: 30,
    growth: 3.8,
    duration: 390,
    color: "#fff6a4",
    alpha: 0.72,
    fadePower: 1.8,
  });
  gameParticleLayer.add({
    type: "ring",
    x: originX,
    y: originY,
    radius: 24,
    growth: 4.3,
    duration: 410,
    color: "#ffffff",
    lineWidth: 7,
    alpha: 0.88,
    fadePower: 1.5,
  });

  const count = particleCount(42);
  for (let index = 0; index < count; index += 1) {
    const angle = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(2.4, 8.2);
    const type = index % 3 === 0
      ? "star"
      : index % 3 === 1 ? "confetti" : "circle";
    gameParticleLayer.add({
      type,
      x: originX + randomBetween(-22, 22),
      y: originY + randomBetween(-18, 18),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - randomBetween(0.4, 2.2),
      gravity: type === "star" ? 0.035 : 0.08,
      size: randomBetween(5, 12),
      width: randomBetween(7, 13),
      height: randomBetween(13, 25),
      rotation: randomBetween(0, Math.PI * 2),
      spin: randomBetween(-0.16, 0.16),
      color: randomItem(PARTICLE_COLORS.goal),
      duration: randomBetween(320, 410),
      alpha: randomBetween(0.72, 1),
      fadePower: 1.35,
    });
  }
}

function emitSaveParticles(shotSide) {
  const originX = shotSide === "left" ? 792 : 1129;
  const originY = 574;

  gameParticleLayer.add({
    type: "ring",
    x: originX,
    y: originY,
    radius: 12,
    growth: 3.6,
    duration: 430,
    color: "#eef8ff",
    lineWidth: 6,
    alpha: 0.78,
    fadePower: 1.8,
  });

  const count = particleCount(22);
  for (let index = 0; index < count; index += 1) {
    const angle = randomBetween(-Math.PI * 0.92, Math.PI * 0.92);
    const direction = shotSide === "left" ? -1 : 1;
    const speed = randomBetween(1.2, 4.4);
    gameParticleLayer.add({
      type: "dust",
      x: originX + randomBetween(-9, 9),
      y: originY + randomBetween(-8, 8),
      vx: Math.cos(angle) * speed * direction,
      vy: Math.sin(angle) * speed - randomBetween(0.2, 1.4),
      gravity: 0.055,
      size: randomBetween(4, 11),
      color: randomItem(PARTICLE_COLORS.impact),
      duration: randomBetween(340, 490),
      alpha: randomBetween(0.4, 0.78),
      fadePower: 1.55,
    });
  }
}

function emitComboParticles() {
  // 보너스 공(무대 x 1673.25~1826.25)의 가로 가운데. 2차 검수 공통-5 로 공이 2px 오른쪽으로 갔고(1702 → 1704),
  // 10-15 하단바 바깥 여백을 줄여 46.25px 더 갔다.
  const originX = 1750.25;
  const originY = 980;

  gameParticleLayer.add({
    type: "glow",
    x: originX,
    y: originY,
    radius: 34,
    growth: 4.8,
    duration: 760,
    color: "#ffed68",
    alpha: 0.76,
    fadePower: 1.45,
  });
  [0, 140].forEach((delay, index) => {
    gameParticleLayer.add({
      type: "ring",
      x: originX,
      y: originY,
      radius: 30,
      growth: 4.7 + index,
      duration: 720,
      delay,
      color: index === 0 ? "#ffffff" : "#ff68c2",
      lineWidth: 8 - index * 2,
      alpha: 0.9,
      fadePower: 1.45,
    });
  });

  const count = particleCount(32);
  for (let index = 0; index < count; index += 1) {
    const angle = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(2.1, 7.4);
    gameParticleLayer.add({
      type: index % 2 === 0 ? "star" : "circle",
      x: originX + randomBetween(-18, 18),
      y: originY + randomBetween(-16, 16),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.2,
      gravity: 0.045,
      size: randomBetween(5, 12),
      rotation: randomBetween(0, Math.PI * 2),
      spin: randomBetween(-0.18, 0.18),
      color: randomItem(PARTICLE_COLORS.combo),
      duration: randomBetween(620, 880),
      alpha: randomBetween(0.72, 1),
      fadePower: 1.25,
    });
  }
}

function emitResultConfetti() {
  resultParticleLayer.clear();
  const count = particleCount(96);
  for (let index = 0; index < count; index += 1) {
    resultParticleLayer.add({
      type: "confetti",
      x: randomBetween(18, DESIGN_WIDTH - 18),
      y: randomBetween(-320, 40),
      vx: randomBetween(-0.75, 0.75),
      vy: randomBetween(2.4, 4.8),
      gravity: randomBetween(0.004, 0.012),
      sway: randomBetween(0.18, 0.75),
      width: randomBetween(8, 17),
      height: randomBetween(16, 31),
      rotation: randomBetween(0, Math.PI * 2),
      spin: randomBetween(-0.11, 0.11),
      color: randomItem(PARTICLE_COLORS.result),
      duration: randomBetween(4800, 6800),
      delay: randomBetween(0, 1300),
      alpha: randomBetween(0.72, 0.96),
      fadePower: 0.55,
    });
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  statusToast.textContent = message;
  statusToast.classList.add("is-visible");

  toastTimer = window.setTimeout(() => {
    statusToast.classList.remove("is-visible");
  }, 1800);
}

function pressButton(button) {
  button.classList.add("is-pressed");
  window.setTimeout(() => button.classList.remove("is-pressed"), 160);
}

function emitNavigation(screen, detail = {}, { cancelable = false } = {}) {
  // 돌려주는 값이 거짓이면 바깥에서 preventDefault 로 막은 것이다.
  return window.dispatchEvent(
    new CustomEvent("wordmatch:navigate", {
      detail: { screen, ...detail },
      cancelable,
    }),
  );
}

// 검수 신규: 시작 화면의 닫기로 밖에 나간다. 나갈 주소는 같은 사이트만 받는다.
// 파일 규약(file:)에서는 모든 주소의 출처가 "null" 이라 출처만 보면
// javascript: 와 data: 와 //다른호스트 가 전부 통과한다. 그래서 셋을 다 본다.
const CLOSE_TARGET_PROTOCOLS = Object.freeze(["http:", "https:", "file:"]);

function resolveSameSiteUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  let target;
  let here;
  try {
    target = new URL(text, window.location.href);
    here = new URL(window.location.href);
  } catch {
    return "";
  }

  if (!CLOSE_TARGET_PROTOCOLS.includes(target.protocol)) {
    return "";
  }
  if (target.protocol !== here.protocol) {
    return "";
  }
  if (target.host !== here.host) {
    return "";
  }
  if (target.origin !== here.origin) {
    return "";
  }
  return target.href;
}

// 배포 루트는 게임 폴더의 부모다. 모음 페이지(../index.html)는 여기 안에 있고,
// ../../ 로 더 올라가는 주소와 파일 규약의 다른 자리(/etc/passwd 같은)는 밖에 있다.
function isInsideDeploymentRoot(href) {
  if (!href) {
    return false;
  }
  try {
    return href.startsWith(new URL("../", window.location.href).href);
  } catch {
    return false;
  }
}

// 같은 문서로 옮기면 화면이 바뀌지 않는데 갈래는 '됐다'로 끝나 뒤의 뒤로가기와 창 닫기를
// 모두 건너뛴다. 그래서 버린다. 견주는 것은 경로뿐이다(사장님 지시) — 닫기 주소는 늘
// ?close_url= 질의를 달고 오므로 질의까지 견주면 index.html 이나 ./ 가 '다른 문서'로 빠져나가
// X 가 닫는 대신 게임을 다시 띄운다. 폴더로 끝나는 주소는 index.html 로 맞춘다.
function documentPath(url) {
  return url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
}

function isSameDocument(href) {
  try {
    return documentPath(new URL(href)) === documentPath(new URL(window.location.href));
  } catch {
    return false;
  }
}

function usableCloseUrl(value) {
  const href = resolveSameSiteUrl(value);
  if (!href || isSameDocument(href)) {
    return "";
  }
  return href;
}

function getCloseUrl() {
  let fromQuery = "";
  try {
    fromQuery = new URLSearchParams(window.location.search).get("close_url") ?? "";
  } catch {
    fromQuery = "";
  }

  // 주소창으로 온 값은 배포 루트 아래만 받는다. 밖에서 건넬 수 있는 값이기 때문이다.
  const queryUrl = usableCloseUrl(fromQuery);
  if (queryUrl && isInsideDeploymentRoot(queryUrl)) {
    return queryUrl;
  }

  // 설정 블록의 값은 납품본 안에 박힌 것이라 같은 사이트 검사만 둔다.
  // 리틀폭스가 루트 밖(예: 내 정보 페이지)으로 닫고 싶을 때를 막지 않기 위해서다.
  return usableCloseUrl(GAME_CONFIG.deployment?.closeUrl);
}

function canGoBackToSameSite() {
  return Boolean(resolveSameSiteUrl(document.referrer));
}

// 2차 검수 공통-12(리틀폭스 안내 2026-10-12): 서비스는 웹에서는 새 창으로, 앱(Android · iOS)에서는 앱 안 웹뷰로 열린다.
// 닫기(X)는 웹이면 창 닫기, 앱이면 웹뷰를 닫는 인터페이스 호출이다.

/* [앱 전용 자리] 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — 리틀폭스가 앱(Android · iOS)에 올릴 때 직접 작업한다.
   지금은 비어 있다. 화면에 알림은 띄우지 않는다(사장님 2026-10-12 "함수 자리만 표시").
   이름은 12개 게임이 모두 같다(사장님 "closeAppWebView() … 모든 컨텐츠에 적용"). 앱인지 웹인지 따로 가르지 않고 늘 먼저 부른다. */
function closeAppWebView() {}

// 게임을 닫는다 — 시작 화면의 X 단추. 순서: 바깥 닫기 알림 → 앱 닫기 자리 → (정해 둔 닫기 주소가 있으면 그리로) → 창 닫기 →
// 창이 안 닫혔고 같은 사이트에서 왔으면 이전 페이지.
// 창 닫기는 스크립트나 새 창으로 열린 창만 된다. 주소를 직접 연 탭 · 링크로 들어온 같은 탭 · 앱 웹뷰에서는 브라우저가 닫아 주지 않아
// window.closed 가 거짓으로 남고, 그때는 예전처럼 이전 페이지로 돌아간다. 전에는 뒤로 가기가 먼저라 새 창에서는 X 가 아무 일도 하지 않았다.
function leaveGame() {
  // 바깥이 막으면 여기서 끝난다.
  if (!emitNavigation("close", {}, { cancelable: true })) {
    return;
  }

  closeAppWebView();

  const url = getCloseUrl();
  if (url) {
    window.location.href = url;
    return;
  }
  // 닫힌 뒤에는 알리지 않는다 — 사장님 지시로 닫기 끝의 안내 문구를 없앴다. 다른 안내 문구는 그대로다.
  window.close();
  if (!window.closed && canGoBackToSameSite()) {
    window.history.back();
  }
}

function hasRankingAccess() {
  return Boolean(
    contentReady
    && launchContext
    && !launchContext.isGuest
    && !launchContext.isDemo,
  );
}

function rankingUnavailableLabel() {
  if (rankingRequestPending) {
    return "랭킹 불러오는 중";
  }
  if (!contentReady) {
    return "랭킹, 게임 준비 중";
  }
  if (launchContext?.isGuest) {
    return "랭킹, 로그인 필요";
  }
  if (launchContext?.isDemo) {
    return "랭킹, 데모 모드에서는 사용할 수 없음";
  }
  return "랭킹 보기";
}

function updateRankingAvailability() {
  const isAvailable = hasRankingAccess() && !rankingRequestPending;
  rankingButton.disabled = !isAvailable;
  rankingButton.setAttribute("aria-label", rankingUnavailableLabel());
  rankingButton.setAttribute("aria-busy", String(rankingRequestPending));

  const resultAvailable = isAvailable && resultRankingReady && !endOverlay.hidden;
  resultRankingButton.hidden = !resultAvailable;
  resultRankingButton.disabled = !resultAvailable;
  resultRankingButton.setAttribute(
    "aria-label",
    resultAvailable ? "랭킹 보기" : rankingUnavailableLabel(),
  );
  resultRankingButton.setAttribute("aria-busy", String(rankingRequestPending));
}

// 검수 q49: 랭킹을 불러오는 동안에는 안내 문구를 띄우지 않는다.
// 목록과 요약만 감춰 두고, 실패했을 때만 상태줄에 문구를 보여 준다.
function clearRankingStatus() {
  rankingMemberSummary.hidden = true;
  rankingTable.hidden = true;
  rankingStatus.hidden = true;
  rankingStatus.classList.remove("is-error");
  rankingStatus.textContent = "";
}

function setRankingStatus(message, { error = false } = {}) {
  rankingMemberSummary.hidden = true;
  rankingTable.hidden = true;
  rankingStatus.hidden = false;
  rankingStatus.classList.toggle("is-error", error);
  rankingStatus.textContent = message;
}

function setRankingMemberBadge(source) {
  const imageSource = String(source ?? "").trim();
  rankingMemberBadgeImage.hidden = true;
  rankingMemberBadgeFallback.hidden = false;
  rankingMemberBadgeImage.dataset.source = imageSource;

  if (!imageSource) {
    rankingMemberBadgeImage.removeAttribute("src");
    return;
  }

  rankingMemberBadgeImage.onload = () => {
    if (rankingMemberBadgeImage.dataset.source !== imageSource) {
      return;
    }
    rankingMemberBadgeFallback.hidden = true;
    rankingMemberBadgeImage.hidden = false;
  };
  rankingMemberBadgeImage.onerror = () => {
    if (rankingMemberBadgeImage.dataset.source !== imageSource) {
      return;
    }
    rankingMemberBadgeImage.hidden = true;
    rankingMemberBadgeFallback.hidden = false;
  };
  rankingMemberBadgeImage.src = imageSource;
}

function createRankingCell(className, text) {
  const cell = document.createElement("span");
  cell.className = `ranking-cell ${className}`;
  cell.setAttribute("role", "cell");
  cell.textContent = text;
  return cell;
}

function createRankingBadgeCell(entry, rank) {
  const cell = createRankingCell("ranking-row-badge", "");
  const fallback = document.createElement("span");
  fallback.textContent = rank <= 3 ? "★" : "●";
  fallback.setAttribute("aria-hidden", "true");

  const imageSource = String(entry?.badge_image ?? "").trim();
  if (imageSource) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    fallback.hidden = true;
    image.addEventListener("error", () => {
      image.remove();
      fallback.hidden = false;
    }, { once: true });
    image.src = imageSource;
    cell.append(image);
  }

  cell.append(fallback);
  return cell;
}

function renderRanking(ranking) {
  rankingStatus.hidden = true;
  rankingStatus.classList.remove("is-error");
  rankingMemberSummary.hidden = false;
  rankingTable.hidden = false;
  rankingMemberName.textContent = String(ranking?.nickname ?? "").trim() || "회원";
  rankingMemberScore.textContent = formatScore(ranking?.best_score);
  setRankingMemberBadge(ranking?.badge_image);

  rankingList.replaceChildren();
  const entries = Array.isArray(ranking?.rankings)
    ? ranking.rankings.slice(0, 20)
    : [];

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "ranking-empty";
    empty.textContent = "표시할 랭킹이 없습니다.";
    rankingList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  entries.forEach((entry, index) => {
    const rank = index + 1;
    const row = document.createElement("div");
    row.className = `ranking-row ranking-grid is-rank-${rank}`;
    row.classList.toggle("is-top-three", rank <= 3);
    row.setAttribute("role", "row");
    row.append(
      createRankingCell("ranking-row-rank", `${rank}위`),
      createRankingBadgeCell(entry, rank),
      createRankingCell(
        "ranking-row-name",
        String(entry?.nickname ?? "").trim() || "-",
      ),
      createRankingCell("ranking-row-score", formatScore(entry?.best_score)),
    );
    fragment.append(row);
  });

  rankingList.append(fragment);
  rankingList.scrollTop = 0;
}

function openRankingDialog(returnFocus) {
  closeIncorrectAnswerDialog({ restoreFocus: false });
  rankingDialogReturnFocus = returnFocus
    || (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    || rankingButton;
  rankingDialog.hidden = false;
  window.requestAnimationFrame(() => {
    rankingCloseButton.focus({ preventScroll: true });
  });
}

function closeRankingDialog({ restoreFocus = true } = {}) {
  if (rankingDialog.hidden) {
    return;
  }

  rankingRequestToken += 1;
  rankingRequestPending = false;
  rankingDialog.hidden = true;
  const returnFocus = rankingDialogReturnFocus;
  rankingDialogReturnFocus = null;
  updateRankingAvailability();

  if (
    restoreFocus
    && returnFocus instanceof HTMLElement
    && returnFocus.isConnected
    && !returnFocus.disabled
  ) {
    returnFocus.focus({ preventScroll: true });
  }
}

function trapRankingFocus(event) {
  if (event.key !== "Tab" || rankingDialog.hidden) {
    return;
  }

  const focusable = [rankingCloseButton, rankingList]
    .filter((element) => !element.hidden && !element.disabled);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!rankingDialog.contains(document.activeElement)) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

async function showRanking(returnFocus) {
  if (!hasRankingAccess() || rankingRequestPending) {
    return;
  }

  pressButton(returnFocus);
  openRankingDialog(returnFocus);
  clearRankingStatus();
  const token = ++rankingRequestToken;
  rankingRequestPending = true;
  updateRankingAvailability();

  try {
    const ranking = await window.WordMatchContent.getRanking();
    if (token !== rankingRequestToken || rankingDialog.hidden) {
      return;
    }
    renderRanking(ranking);
    if (!endOverlay.hidden) {
      setResultMessage(ranking?.nickname
        ? `${ranking.nickname}님의 최고 점수는 ${formatScore(ranking.best_score)}점입니다.`
        : "랭킹을 불러왔습니다.");
    }
    emitNavigation("ranking", { ranking });
    window.dispatchEvent(new CustomEvent("wordmatch:ranking", {
      detail: ranking,
    }));
  } catch (error) {
    if (token !== rankingRequestToken || rankingDialog.hidden) {
      return;
    }
    setRankingStatus(
      `랭킹을 불러오지 못했습니다. ${error?.message || "연결 상태를 확인해 주세요."}`,
      { error: true },
    );
    if (!endOverlay.hidden) {
      setResultMessage(`랭킹을 불러오지 못했습니다: ${error?.message || "연결 오류"}`);
    }
  } finally {
    if (token === rankingRequestToken) {
      rankingRequestPending = false;
      updateRankingAvailability();
    }
  }
}

function setHelpStatus(message, { retry = false } = {}) {
  helpContent.replaceChildren();
  helpStatusMessage.textContent = message;
  helpRetryButton.hidden = !retry;
  helpStatus.hidden = false;
  helpScreen.setAttribute("aria-busy", String(!retry));
}

function renderHelpSections(items) {
  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const section = document.createElement("section");
    section.className = "help-section";

    if (item.title) {
      const title = document.createElement("h2");
      title.className = "help-section-title";
      title.textContent = item.title;
      section.append(title);
    }

    if (item.content) {
      const content = document.createElement("p");
      content.className = "help-section-content";
      content.textContent = item.content;
      section.append(content);
    }

    fragment.append(section);
  });

  helpContent.replaceChildren(fragment);
  helpStatus.hidden = true;
  helpScreen.setAttribute("aria-busy", "false");
}

async function loadHelp({ retry = false } = {}) {
  const loader = window.WordMatchContent;
  const token = ++helpRequestToken;
  setHelpStatus("도움말을 불러오는 중입니다.");

  try {
    if (
      !loader
      || typeof loader.bootstrap !== "function"
      || typeof loader.getHelp !== "function"
    ) {
      throw new Error("도움말 데이터 로더를 사용할 수 없습니다.");
    }

    await loader.bootstrap();
    const items = await loader.getHelp({ retry });
    if (token !== helpRequestToken || helpScreen.hidden) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      setHelpStatus("표시할 도움말이 없습니다.", { retry: true });
      return;
    }

    renderHelpSections(items);
  } catch {
    if (token !== helpRequestToken || helpScreen.hidden) {
      return;
    }
    setHelpStatus("도움말을 불러오지 못했습니다.", { retry: true });
  }
}

function setHelpNavigation(helpVisible) {
  stage.classList.toggle("help-mode", helpVisible);
  soundButton.hidden = helpVisible;
  closeButtonIcon.src = helpVisible ? "assets/btn_back.png" : "assets/btn_close.png";
  closeButton.setAttribute("aria-label", helpVisible ? "뒤로 가기" : "게임 닫기");
}

function openHelp() {
  // 최종 테스트 검토: 도움말 단추는 눌림 모양을 보여 주느라 0.12초 뒤에 연다. 그 사이 Start 를 누르면
  // 게임이 먼저 시작되고, 늦게 온 열기가 게임 위를 덮었다. 시작 화면이 아니면 열지 않는다.
  if (!helpScreen.hidden || startScreen.hidden || gameRunning) {
    return;
  }

  helpReturnFocus = document.activeElement;
  startScreen.hidden = true;
  helpScreen.hidden = false;
  // 2차 수정(OX 와 같이): 도움말 화면에서만 X 대신 뒤로가기를 왼쪽 위(스피커 자리)에 두고
  // 스피커는 숨긴다. 시작·게임 화면은 그대로다. 자리는 CSS 의 help-mode 가 잡는다.
  setHelpNavigation(true);
  closeButton.focus({ preventScroll: true });
  emitNavigation("help");
  void loadHelp();
}

function closeHelp({ restoreFocus = true } = {}) {
  if (helpScreen.hidden) {
    return;
  }

  helpRequestToken += 1;
  helpScreen.hidden = true;
  startScreen.hidden = false;
  setHelpNavigation(false);
  emitNavigation("help-close");

  if (restoreFocus) {
    const focusTarget = helpReturnFocus?.isConnected ? helpReturnFocus : helpButton;
    focusTarget.focus({ preventScroll: true });
  }
  helpReturnFocus = null;
}

function setLoadingUI(status, message = "") {
  const isReady = status === "ready";
  const isError = status === "error";

  startButton.disabled = !isReady;
  startButton.setAttribute("aria-busy", String(!isReady && !isError));
  if (!isReady) {
    resultRankingReady = false;
  }
  updateRankingAvailability();
  loadingPanel.hidden = isReady;
  loadingPanel.classList.toggle("is-error", isError);
  loadingTitle.textContent = isError ? "Load failed" : "Loading...";
  loadingMessage.textContent = message;
  retryLoadButton.hidden = !isError;
}

function hasMemberPronunciation() {
  return Boolean(launchContext && !launchContext.isGuest);
}

function updatePronunciationAvailability() {
  const isAvailable = hasMemberPronunciation();
  incorrectAnswerDialog.classList.toggle(
    "pronunciation-disabled",
    !isAvailable,
  );

  if (!isAvailable) {
    stopQuestionAudio({ clearSource: true });
  }
}

// 2차 검수 공통-9(사장님 2026-10-12 "동화API … 확인해보고 적용"): 시작화면 로고와 Start 단추 사이에 동화 정보를 보여 준다.
// 따로 부르는 API 는 없다 — 한 판 시간(play_time)을 받는 게임 정보 API(info)가 동화 제목(title)과 편 제목(subtitle)도 준다.
// 받지 못했거나(info 실패) 데모 판이면 보이지 않는다. 한 줄만 오면 그 한 줄만 보인다.
function renderStoryInfo(info, launch) {
  // 동화 정보 요소가 없는 옛 index.html 이 캐시에 남아 있어도 게임이 멈추지 않게 한다.
  if (!storyInfo || !storyTitle || !storySubtitle) {
    return;
  }
  const decode = window.WordMatchContent?.decodeDisplayText;
  const read = (value) => {
    const text = typeof decode === "function" ? decode(value) : String(value ?? "");
    // 한 줄로 보여 준다. 응답에 줄바꿈이 섞여 와도 띄어쓰기 하나로 눕힌다.
    return String(text ?? "").replace(/\s+/g, " ").trim();
  };
  const isDemo = Boolean(launch?.isDemo);
  const title = isDemo ? "" : read(info?.title);
  const subtitle = isDemo ? "" : read(info?.subtitle);

  storyTitle.textContent = title;
  storySubtitle.textContent = subtitle;
  storyTitle.hidden = !title;
  storySubtitle.hidden = !subtitle;
  storyInfo.hidden = !title && !subtitle;
  [storyTitle, storySubtitle].forEach((line) => line.style.removeProperty("--story-line-scale"));
  if (storyInfo.hidden) {
    return;
  }
  // 글꼴이 준비된 뒤의 폭으로 맞춘다. 보이는 상태여야 폭을 잴 수 있다.
  window.requestAnimationFrame(() => {
    [storyTitle, storySubtitle].forEach(fitStoryLine);
  });
}

// 긴 제목만 칸(1280px)에 맞게 줄인다. 값은 배율이다 — CSS 의 기준 크기(38px)에 곱한다.
// 바닥은 0.7(약 27px)이고, 그래도 넘치면 스타일이 말줄임한다.
function fitStoryLine(element) {
  if (!element || element.hidden) {
    return;
  }
  const minimumScale = 0.7;
  const step = 0.02;
  element.style.setProperty("--story-line-scale", "1");
  for (let scale = 1; scale > minimumScale && element.scrollWidth > element.clientWidth; scale -= step) {
    element.style.setProperty("--story-line-scale", (scale - step).toFixed(2));
  }
}

async function initializeContent({ force = false } = {}) {
  const loader = window.WordMatchContent;
  const token = ++contentLoadToken;
  contentReady = false;
  launchContext = null;
  renderStoryInfo(null, null);
  updatePronunciationAvailability();
  setLoadingUI("loading", "게임 데이터를 준비하고 있습니다.");

  try {
    if (!loader || typeof loader.bootstrap !== "function") {
      throw new Error("게임 데이터 로더를 사용할 수 없습니다.");
    }

    const loaded = await loader.bootstrap({ force });
    if (token !== contentLoadToken) {
      return;
    }

    if (!Array.isArray(loaded?.content?.questions) || loaded.content.questions.length === 0) {
      throw new Error("게임 문제가 준비되지 않았습니다.");
    }

    questions = loaded.content.questions;
    launchContext = loaded.launch;
    gameDurationMs = resolveGameDurationMs(loaded.content.info, loaded.launch);
    updatePronunciationAvailability();
    renderStoryInfo(loaded.content.info, loaded.launch);
    contentReady = true;
    setLoadingUI("ready");
    emitNavigation("ready", {
      mode: launchContext?.isLocalApiTest
        ? launchContext.isGuest ? "local-api-guest" : "local-api-member"
        : launchContext?.isDemo
        ? "demo"
        : launchContext?.isGuest ? "guest" : "member",
      fcId: launchContext?.fcId || "",
    });

    if (window.location.hash === "#game") {
      startGame();
    }
  } catch (error) {
    if (token !== contentLoadToken) {
      return;
    }
    contentReady = false;
    setLoadingUI("error", error?.message || "게임 데이터를 불러오지 못했습니다.");
    emitNavigation("load-error", {
      code: error?.code || "CONTENT_LOAD_ERROR",
    });
  }
}

function playAudioSource(source, { onError, ignoreSoundSetting = false } = {}) {
  // ignoreSoundSetting: 사용자가 직접 누른 발음 단추처럼 소리 설정과 무관하게 들려줄 때만 쓴다.
  if ((!soundEnabled && !ignoreSoundSetting) || !source) {
    return null;
  }

  const audio = new Audio(source);
  activeAudioElements.add(audio);
  let playbackFinished = false;
  const cleanup = () => {
    playbackFinished = true;
    activeAudioElements.delete(audio);
  };
  const reportError = (error) => {
    if (playbackFinished) {
      return;
    }
    cleanup();
    onError?.(error);
  };
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", () => {
    reportError(audio.error);
  }, { once: true });
  audio.play().catch((error) => {
    if (error?.name !== "AbortError") {
      reportError(error);
    } else {
      cleanup();
    }
  });
  return audio;
}

function playSound(name) {
  playAudioSource(SOUND_ASSETS[name]);
}

function ensureBgm() {
  if (!bgmAudio) {
    bgmAudio = new Audio(BGM_SRC);
    bgmAudio.loop = true;
    bgmAudio.volume = BGM_VOLUME;
    bgmAudio.preload = "auto";
  }
  return bgmAudio;
}

function resumeBgm() {
  if (!soundEnabled || !bgmWanted) {
    return;
  }
  // 자동재생이 막히면 다음 사용자 동작에서 다시 시도한다.
  ensureBgm().play()?.catch(() => armBgmOnGesture());
}

function armBgmOnGesture() {
  if (bgmGestureHandler) {
    return;
  }
  bgmGestureHandler = () => {
    BGM_GESTURE_EVENTS.forEach((type) => {
      document.removeEventListener(type, bgmGestureHandler, true);
    });
    bgmGestureHandler = null;
    // 검수 사차 아홉째 항 보강: 이 손잡이는 '다시 시도'일 뿐이다. 원하는 상태를 올리면
    // 결과화면에서 아무 데나 누르는 것만으로 멈춰 둔 배경음이 되살아난다.
    if (bgmWanted) {
      resumeBgm();
      return;
    }
    // 아직 배경음을 원하지 않는 화면이었다면 이 눌림은 쓰지 않은 것이다.
    // 다음 동작을 계속 기다려야 자동재생 허가를 놓치지 않는다.
    armBgmOnGesture();
  };
  BGM_GESTURE_EVENTS.forEach((type) => {
    document.addEventListener(type, bgmGestureHandler, {
      capture: true,
      passive: true,
    });
  });
}

function pauseBgm() {
  bgmAudio?.pause();
}

function stopQuestionAudio({ clearSource = false } = {}) {
  questionAudioPlayToken += 1;
  questionAudio.pause();

  if (!clearSource) {
    return;
  }

  currentQuestionSoundUrl = "";
  questionAudio.removeAttribute("src");
  questionAudio.load();
}

function setQuestionAudioSource(source) {
  stopQuestionAudio();
  currentQuestionSoundUrl = String(source ?? "").trim();

  if (!currentQuestionSoundUrl) {
    questionAudio.removeAttribute("src");
    questionAudio.load();
    return;
  }

  if (questionAudio.getAttribute("src") !== currentQuestionSoundUrl) {
    questionAudio.src = currentQuestionSoundUrl;
    questionAudio.load();
  }
}

// 2차 검수 WM공통-1(OX 와 같이): 문제 카드의 단어 듣기 단추는 없다 — Word Match 통일.
// 새 문제가 뜰 때 회원에게 발음을 한 번 들려주는 것만 남는다(소리를 끄면 나지 않는다).
// 직접 눌러 다시 듣는 길이 없으므로 재생 실패 안내도 없다. 오답노트의 스피커는 그대로다.
function playQuestionAudio() {
  if (!hasMemberPronunciation() || !soundEnabled || !currentQuestionSoundUrl) {
    return;
  }

  const playToken = ++questionAudioPlayToken;
  questionAudio.pause();
  try {
    questionAudio.currentTime = 0;
  } catch {
    // 메타데이터 로드 전에는 currentTime 변경이 불가능할 수 있다.
  }

  questionAudio.play()?.catch((error) => {
    if (playToken !== questionAudioPlayToken || error?.name === "AbortError") {
      return;
    }
    // 자동 재생이 막혔거나 소리를 못 읽었다. 게임은 그대로 이어 간다.
  });
}

function updateSoundUI() {
  soundIcon.src = soundEnabled
    ? "assets/btn_sound_on.png"
    : "assets/btn_sound_off.png";
  soundButton.setAttribute("aria-pressed", String(soundEnabled));
  soundButton.setAttribute("aria-label", soundEnabled ? "소리 끄기" : "소리 켜기");
}

function cancelAnimatedTextFrame(element) {
  const frames = textAnimationFrames.get(element);
  if (!frames) {
    return;
  }
  window.cancelAnimationFrame(frames.first);
  window.cancelAnimationFrame(frames.second);
  textAnimationFrames.delete(element);
}

function clearGameTimers() {
  window.clearInterval(gameTickTimer);
  window.clearTimeout(resultTimer);
  window.clearTimeout(judgementTimer);
  window.clearTimeout(keeperDiveTimer);
  cancelAnimatedTextFrame(feedbackText);
  cancelAnimatedTextFrame(comboText);
  hideComboStepGains();
  clearScoreBonus();
  gameTickTimer = undefined;
  resultTimer = undefined;
  judgementTimer = undefined;
  keeperDiveTimer = undefined;
}

function holdGameClock() {
  if (clockHoldStartedAt === 0) {
    clockHoldStartedAt = performance.now();
  }
}

function releaseGameClock() {
  if (clockHoldStartedAt === 0) {
    return;
  }
  const held = performance.now() - clockHoldStartedAt;
  clockHoldStartedAt = 0;
  if (held > 0) {
    gameEndsAt += held;
  }
}

function setChoiceEnabled(enabled) {
  choiceButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

// 최종 테스트 후속(OX 와 같이): 첫째·둘째 공 위로 떠오르는 정답 점수. 보너스가 아니므로 작고 희다.
const comboStepGains = [...document.querySelectorAll(".combo-step-gain")];
const comboStepGainTimers = new Map();

function showComboStepGain(index) {
  const gain = comboStepGains[index];
  if (!gain) {
    return;
  }
  gain.textContent = formatBonus(SCORING.correct);
  window.clearTimeout(comboStepGainTimers.get(index));
  gain.classList.remove("is-showing");
  gain.hidden = false;
  void gain.offsetWidth;
  gain.classList.add("is-showing");
  comboStepGainTimers.set(index, window.setTimeout(() => {
    gain.classList.remove("is-showing");
    gain.hidden = true;
    comboStepGainTimers.delete(index);
  }, 900));
}

function hideComboStepGains() {
  comboStepGainTimers.forEach((timerId) => window.clearTimeout(timerId));
  comboStepGainTimers.clear();
  comboStepGains.forEach((gain) => {
    gain.classList.remove("is-showing");
    gain.hidden = true;
  });
}

// 보너스 효과(사장님 2026-10-12 "금빛 링 + 숫자 커짐" — 형제 카드 · 바다속 · 두더지 방식): 보너스가 붙는 순간
// Score 상자 둘레에 금빛 테두리 · 반짝임(#scoreBurst)을 퍼뜨리고 점수 숫자를 금색으로 키웠다 되돌린다.
// 숫자는 그동안 animateScore 가 굴리고, 보너스 점수 표기는 보너스 공 위(showBonusGain)에 뜬다.
const SCORE_BONUS_EFFECT_MS = 1100;

function playScoreBonus() {
  // 링 요소가 없는 옛 index.html 이 캐시에 남아 있어도 게임이 멈추지 않게 한다.
  if (!scoreBurst) {
    return;
  }
  window.clearTimeout(scoreBonusTimer);
  scoreBurst.classList.remove("is-playing");
  scoreValue.classList.remove("is-bonus-punch");
  // 레이아웃을 한 번 읽어야 같은 클래스를 다시 붙일 때 애니메이션이 처음부터 돈다.
  void scoreBurst.offsetWidth;
  scoreBurst.classList.add("is-playing");
  scoreValue.classList.add("is-bonus-punch");
  scoreBonusTimer = window.setTimeout(clearScoreBonus, SCORE_BONUS_EFFECT_MS);
}

// 판이 끝나거나 다시 시작할 때(clearGameTimers)도 불린다. 효과가 다음 화면에 남지 않는다.
function clearScoreBonus() {
  window.clearTimeout(scoreBonusTimer);
  scoreBonusTimer = 0;
  scoreBurst?.classList.remove("is-playing");
  scoreValue.classList.remove("is-bonus-punch");
}

// 보너스 공 위 표기: BONUS 띠와 보너스 점수를 함께 띄운다(OX 와 같이).
function showBonusGain() {
  showAnimatedText(comboText, formatBonus(SCORING.comboBonus));
  // resetActionScene 이 className 을 되돌리며 함께 지운다.
  comboText.classList.add("is-bonus-gain");
  const label = document.createElement("span");
  label.className = "combo-text-label";
  label.textContent = "BONUS";
  const value = document.createElement("span");
  value.className = "combo-text-value";
  value.textContent = formatBonus(SCORING.comboBonus);
  comboText.replaceChildren(label, value);
}

function renderComboProgress(step, { burst = false } = {}) {
  const normalizedStep = Math.max(
    0,
    Math.min(comboBalls.length, Math.trunc(Number(step) || 0)),
  );

  comboBalls.forEach((ball) => {
    const ballStep = Number(ball.dataset.comboStep);
    ball.classList.toggle("is-active", ballStep <= normalizedStep);
    ball.classList.toggle(
      "is-bursting",
      burst && ballStep === comboBalls.length,
    );
  });
  comboMeter?.setAttribute(
    "aria-label",
    `콤보 ${normalizedStep}/${comboBalls.length}`,
  );
}

function resetComboProgress() {
  comboResetPending = false;
  renderComboProgress(0);
}

function setActionSceneImage(element, src) {
  if (!element || !src) {
    return;
  }
  if (element.getAttribute("src") !== src) {
    element.setAttribute("src", src);
  }
}

function resetActionScene() {
  cancelAnimatedTextFrame(feedbackText);
  cancelAnimatedTextFrame(comboText);
  playScreen.classList.remove(
    "is-resolving",
    "result-correct",
    "result-wrong",
    "shot-left",
    "shot-right",
  );
  choiceButtons.forEach((button) => button.classList.remove("is-selected"));
  feedbackText.className = "feedback-text";
  feedbackText.textContent = "";
  comboText.className = "combo-text";
  comboText.textContent = "";
  setActionSceneImage(goalkeeperImage, ACTION_SCENE_ASSETS.goalkeeper.wait);
  setActionSceneImage(kickerImage, ACTION_SCENE_ASSETS.kicker.wait);
  kickerImage.classList.remove("is-kick-shift");
}

function showAnimatedText(element, message, ...classes) {
  cancelAnimatedTextFrame(element);
  element.className = element === feedbackText ? "feedback-text" : "combo-text";
  const isEnglish = isEnglishGameText(message);
  element.textContent = isEnglish ? formatEnglishGameText(message) : message;
  if (isEnglish) {
    element.classList.add("is-english");
  }

  const frames = { first: 0, second: 0 };
  frames.first = window.requestAnimationFrame(() => {
    frames.first = 0;
    frames.second = window.requestAnimationFrame(() => {
      frames.second = 0;
      if (textAnimationFrames.get(element) !== frames) {
        return;
      }
      textAnimationFrames.delete(element);
      element.classList.add("is-visible", ...classes);
    });
  });
  textAnimationFrames.set(element, frames);
}

function getNextQuestionIndex() {
  if (questions.length === 1) {
    return 0;
  }

  let index = lastQuestionIndex;
  while (index === lastQuestionIndex) {
    index = Math.floor(Math.random() * questions.length);
  }
  return index;
}

function isEnglishGameText(value) {
  const text = String(value ?? "");
  return /[a-z]/i.test(text) && !/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(text);
}

function formatEnglishGameText(value) {
  // 검수 r7: 영단어는 모두 소문자로 표시한다 (첫 글자 대문자화 제거)
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

// 2차 수정: 문제 단어는 한 줄이 기본이다. 한 줄로 최소 크기까지 줄여도 칸에 안 들어갈 때만
// 띄어쓰기 자리에서 두 줄로 나눈다(두 줄 안에서 가장 크게, 세 줄은 쓰지 않는다). 데이터에 줄바꿈(\n)이
// 있으면 그 자리를 따르고 자동으로 나누지 않는다. 띄어쓰기가 없는 한 단어는 나눌 자리가 없어 한 줄로
// 계속 줄인다 — 글자 중간이나 '-' 뒤에서 자르지 않는다(단어마다 줄바꿈 없는 칸에 넣는 까닭).
// 사장님: 문제박스 최대 크기 74px 로 고정(10-01, 잠시 100px 로 올렸던 것을 되돌림). 바꾸지 않는다.
const QUIZ_WORD_MAX_PX = 74;
// 최종 테스트 후속(OX 와 같이): 한 줄 최소 크기는 OX 의 2.7cqw(1920 기준 51.84px)다. 그보다 작게 줄여야 하면 두 줄로 나눈다.
const QUIZ_WORD_MIN_ONE_LINE_PX = 52;
const QUIZ_WORD_MAX_LINES = 2;
const QUIZ_WORD_FLOOR_PX = 12;
// 단어 사이 간격. 줄바꿈 없는 공백(U+00A0)은 붙여 두라는 뜻이라 가르지 않는다.
const QUIZ_WORD_GAP = /[^\S\u00A0]+/;

function renderQuizWord(value) {
  const raw = String(value ?? "").trim();
  const isEnglish = isEnglishGameText(raw);
  const text = isEnglish ? formatEnglishGameText(raw) : raw;
  const wrapper = document.createElement("span");
  wrapper.className = "quiz-word-text";
  text.split(/\s*\n\s*/).forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      wrapper.append(document.createElement("br"));
    }
    line.split(QUIZ_WORD_GAP).filter(Boolean).forEach((word, wordIndex) => {
      if (wordIndex > 0) {
        wrapper.append(document.createTextNode(" "));
      }
      const part = document.createElement("span");
      part.className = "quiz-word-part";
      part.textContent = word;
      wrapper.append(part);
    });
  });
  quizWord.replaceChildren(wrapper);
  quizWord.classList.toggle("is-english", isEnglish);
  fitQuizWord();
}

function quizWordOverflows() {
  return quizWord.scrollWidth > quizWord.clientWidth + 1
    || quizWord.scrollHeight > quizWord.clientHeight + 1;
}

// 줄 수는 단어 칸 안 글자 사각형의 높이로 센다. 같은 줄의 작은 높이 차이는 글자 높이의 절반까지 한 줄로 본다.
function countQuizWordLines() {
  const rects = [];
  quizWord.querySelectorAll(".quiz-word-part").forEach((part) => {
    const range = document.createRange();
    range.selectNodeContents(part);
    rects.push(...range.getClientRects());
  });
  rects.sort((upper, lower) => upper.top - lower.top);
  let lines = 0;
  let lineTop = -Infinity;
  rects.forEach((rect) => {
    if (rect.top > lineTop + rect.height / 2) {
      lines += 1;
      lineTop = rect.top;
    }
  });
  return lines;
}

function setQuizWordSize(size) {
  quizWord.style.fontSize = `${size}px`;
}

function fitQuizWord() {
  quizWord.classList.remove("is-wrapped");
  let size = QUIZ_WORD_MAX_PX;
  setQuizWordSize(size);
  while (size > QUIZ_WORD_MIN_ONE_LINE_PX && quizWordOverflows()) {
    size -= 1;
    setQuizWordSize(size);
  }
  if (!quizWordOverflows()) {
    return size;
  }

  const partCount = quizWord.querySelectorAll(".quiz-word-part").length;
  if (quizWord.querySelector("br") || partCount < 2) {
    // 나눌 자리가 없거나 데이터가 줄을 정했다. 자르지 않고 들어갈 때까지 더 줄인다.
    while (size > QUIZ_WORD_FLOOR_PX && quizWordOverflows()) {
      size -= 1;
      setQuizWordSize(size);
    }
    return size;
  }

  quizWord.classList.add("is-wrapped");
  for (size = QUIZ_WORD_MAX_PX; ; size -= 1) {
    setQuizWordSize(size);
    const fits = !quizWordOverflows() && countQuizWordLines() <= QUIZ_WORD_MAX_LINES;
    if (fits || size <= QUIZ_WORD_FLOOR_PX) {
      return size;
    }
  }
}

// 2차 수정: 긴 한글 뜻은 단어를 빼지 않고 칸 안에 맞게 글자를 줄인다(사장님 — 서버가 주는 값이라
// 콘텐츠는 칸에 맞게 보여 준다). 칸은 최대 245px 까지 자라고 그다음부터 글자가 작아진다.
const CHOICE_TEXT_MAX_PX = 40;
const CHOICE_TEXT_FLOOR_PX = 12;

// 여유를 두지 않는다. 1px 라도 칸 밖으로 나가면 한 단계 더 줄인다(PDF 예시 '박차…' 가 1px 걸쳤다).
function choiceOverflows(button) {
  return button.scrollHeight > button.clientHeight
    || button.scrollWidth > button.clientWidth;
}

function fitChoiceText(button) {
  const text = button.querySelector("span");
  let size = CHOICE_TEXT_MAX_PX;
  text.style.fontSize = `${size}px`;
  while (size > CHOICE_TEXT_FLOOR_PX && choiceOverflows(button)) {
    size -= 1;
    text.style.fontSize = `${size}px`;
  }
  return size;
}

function fitChoiceTexts() {
  choiceButtons.forEach(fitChoiceText);
}

// 글꼴은 받기 전에 대체 글꼴로 그려진다. 다 받으면 같은 문제일 때 한 번 더 맞춘다.
function refitAfterFontsLoad(question) {
  document.fonts?.ready?.then(() => {
    if (questions[lastQuestionIndex] === question && gameRunning) {
      fitQuizWord();
      fitChoiceTexts();
    }
  });
}

function renderGameText(element, value) {
  const text = String(value ?? "").trim();
  const isEnglish = isEnglishGameText(text);

  element.textContent = isEnglish ? formatEnglishGameText(text) : text;
  element.classList.toggle("is-english", isEnglish);
}

function showNextQuestion() {
  releaseGameClock();
  if (!gameRunning || performance.now() >= gameEndsAt) {
    finishGame();
    return;
  }

  gameParticleLayer.clear();
  if (comboResetPending) {
    resetComboProgress();
  }
  resetActionScene();
  setChoiceEnabled(true);

  const questionIndex = getNextQuestionIndex();
  const question = questions[questionIndex];
  const pronunciationAvailable = hasMemberPronunciation();
  const answerOnLeft = Math.random() < 0.5;
  lastQuestionIndex = questionIndex;

  renderQuizWord(question.word);
  setQuestionAudioSource(pronunciationAvailable ? question.soundUrl : "");
  renderGameText(
    choiceTextElements[0],
    answerOnLeft ? question.answer : question.decoy,
  );
  renderGameText(
    choiceTextElements[1],
    answerOnLeft ? question.decoy : question.answer,
  );
  fitChoiceTexts();
  refitAfterFontsLoad(question);
  choiceButtons[0].dataset.correct = String(answerOnLeft);
  choiceButtons[1].dataset.correct = String(!answerOnLeft);

  questionEndsAt = Math.min(performance.now() + QUESTION_DURATION_MS, gameEndsAt);
  acceptingAnswer = true;
  updateTimers();
  if (pronunciationAvailable) {
    playQuestionAudio();
  }
}

function formatTime(milliseconds) {
  // 한 판 시간이 API 에서 오므로 1분을 넘을 수 있다. 분:초 로 적는다.
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatScore(value) {
  // 형제 프로젝트 공통 규약 및 RANKING_SPEC 명문 규정: 점수 표기는 en-US 로케일
  // 버림이 아니라 반올림이다. 점수 상수는 마크업의 설정 블록에서 오므로 소수가 들어올 수 있고,
  // 버림은 그때 한 점 낮게 찍는다. 빼기 영은 빼기 기호 없이 영으로 눕힌다.
  const rounded = Math.round(finiteNumber(value, 0));
  return (rounded === 0 ? 0 : rounded).toLocaleString("en-US");
}

function renderScore(value = score) {
  const text = formatScore(value);
  scoreValue.textContent = text;
  // 형제 프로젝트와 같은 문구로 대체 설명을 함께 갱신한다.
  scoreValue.setAttribute("aria-label", `점수 ${text}`);
}

// 점수를 즉시 반영한다. 게임 시작·재시작·종료와 보너스가 아닌 판에서 쓴다.
function updateScore() {
  if (scoreTween) {
    window.cancelAnimationFrame(scoreTween);
    scoreTween = 0;
  }
  scoreTweenToken += 1;
  scoreShown = score;
  renderScore(scoreShown);
}

// 검수 보너스 효과: 보너스가 붙는 순간 점수판 숫자를 굴려 올린다 (형제 waterpipe·OX 방 animateScore 기준).
function animateScore(target) {
  const from = scoreShown;
  if (from === target) return;
  if (reducedMotionQuery.matches) {
    updateScore();
    return;
  }
  if (scoreTween) window.cancelAnimationFrame(scoreTween);
  const token = (scoreTweenToken += 1);
  const startedAt = Date.now();
  const span = Math.min(720, 280 + Math.abs(target - from) * 2);
  /* 프레임이 돌지 않는 환경(백그라운드 탭 등)에서는 rAF 콜백이 오지 않아 숫자가 옛 값에 멈춘다.
     시간이 지나면 최종 점수를 반드시 찍어 둔다. 그 사이 재시작 등으로 점수판을 새로 찍었으면 건너뛴다. */
  window.setTimeout(() => {
    if (token === scoreTweenToken && scoreShown !== target) {
      scoreShown = target;
      renderScore(target);
    }
  }, span + 120);
  const step = () => {
    if (token !== scoreTweenToken) return;
    const ratio = Math.min(1, (Date.now() - startedAt) / span);
    const eased = 1 - Math.pow(1 - ratio, 3);
    scoreShown = from + (target - from) * eased;
    renderScore(scoreShown);
    if (ratio < 1) {
      scoreTween = window.requestAnimationFrame(step);
    } else {
      scoreShown = target;
      renderScore(target);
      scoreTween = 0;
    }
  };
  scoreTween = window.requestAnimationFrame(step);
}

function formatBonus(value) {
  // 부호 판단도 반올림한 값으로 한다. 반올림 뒤 0이면 더하기를 붙인다.
  const number = Math.round(finiteNumber(value, 0));
  return `${number >= 0 ? "+" : ""}${formatScore(number)}`;
}

function setQuestionCountdownSeconds(value) {
  const seconds = Math.max(0, Math.ceil(finiteNumber(value, 0)));
  const text = `문제 ${seconds}초`;
  if (text === lastQuestionCountdownText) {
    return;
  }

  lastQuestionCountdownText = text;
  questionCountdown.setAttribute("aria-label", text);
  questionCountdownTimer.hidden = false;
  questionCountdownStatus.hidden = true;
  questionCountdownValue.textContent = String(seconds);
}

function clearQuestionCountdown() {
  lastQuestionCountdownText = "";
  questionCountdown.setAttribute("aria-label", "");
  questionCountdownTimer.hidden = true;
  questionCountdownStatus.hidden = true;
  questionCountdownStatus.textContent = "";
}

function setQuestionCountdownStatus(value) {
  const text = String(value ?? "");
  if (text === lastQuestionCountdownText) {
    return;
  }

  lastQuestionCountdownText = text;
  questionCountdown.setAttribute("aria-label", text);
  questionCountdownTimer.hidden = true;
  questionCountdownStatus.hidden = false;
  questionCountdownStatus.textContent = text;
}

function buildSessionSummary() {
  return {
    correctPoints,
    incorrectPoints,
    bonusPoints,
    correctCount,
    incorrectCount,
    timeoutCount,
    // 오답노트(Incorrect Answers)에 실린 단어 수. 결과 화면의 Incorrect 와 등급이 이 값을 쓴다.
    incorrectWordCount: incorrectAnswerRecords.size,
    totalScore: score,
  };
}

// 검수 사차 보탬: 리워드 제공 기준 (사장님 지시). 다시 하기는 일곱 할 미만,
// 중간 등급은 일곱 할부터, 최고 등급은 모두 맞혔을 때만이다.
const RESULT_GRADE_RATIO = Object.freeze({
  excellent: 1,
  good: 0.7,
});

function getResultTitleAsset(session) {
  // 사장님 2026-10-12 "결과 화면에 오답 수랑 현제 오답페이지에 수량이 다름"(OX 와 같이): 등급도 화면에 보이는
  // Correct · Incorrect 로 계산한다. Incorrect 는 오답노트에 실린 단어 수다 — 틀렸거나 시간이 끝난 단어가 한 줄씩이라
  // 같은 단어를 여러 번 놓쳐도 한 번만 센다. 그 전에는 놓친 횟수(틀린 누름 + 시간 초과)를 다 세어 분모에 넣었다.
  const presentedCount = session.correctCount + session.incorrectWordCount;
  const correctRatio = presentedCount > 0
    ? session.correctCount / presentedCount
    : 0;

  if (correctRatio >= RESULT_GRADE_RATIO.excellent) {
    return RESULT_TITLE_ASSETS.excellent;
  }
  if (correctRatio >= RESULT_GRADE_RATIO.good) {
    return RESULT_TITLE_ASSETS.good;
  }
  return RESULT_TITLE_ASSETS.tryAgain;
}

function renderResultTitle(session) {
  const asset = getResultTitleAsset(session);
  resultTitle.src = asset.src;
  resultTitle.alt = asset.alt;
  // 여우는 제목과 같은 등급을 따른다. 읽어 주는 글은 제목 쪽에만 둔다.
  // 이미 읽혀 있는 같은 그림이면 숙일 까닭이 없다. 숙였다가 읽힘 알림을 기다리면
  // 그 알림이 늦거나 오지 않는 환경에서 여우가 한동안 비어 보인다.
  if (
    resultFox.getAttribute("src") === asset.fox
    && resultFox.complete
    && resultFox.naturalWidth > 0
  ) {
    resultFox.hidden = false;
    return;
  }

  // 처음 받는 그림은 읽힌 뒤에 보인다. 못 읽으면 깨진 그림표 대신 아무것도 보이지 않게 둔다.
  resultFox.hidden = true;
  resultFox.onload = () => {
    resultFox.hidden = false;
  };
  resultFox.onerror = () => {
    resultFox.hidden = true;
  };
  resultFox.src = asset.fox;
}

function renderResultRankAndScore(rank, totalScore) {
  const normalizedRank = Math.trunc(finiteNumber(rank, 0));
  const normalizedScore = finiteNumber(totalScore, 0);
  const rankText = normalizedRank > 0 ? `${formatScore(normalizedRank)}위` : "-";
  const scoreText = formatScore(normalizedScore);

  resultRank.textContent = rankText;
  resultScoreNumber.textContent = scoreText;
  resultTotalScore.setAttribute("aria-label", `${scoreText}점`);
}

function renderResultBreakdown(session) {
  renderResultTitle(session);
  // 검수 사차 여섯째 항: 정답과 오답은 점수가 아니라 개수로 보여 준다.
  // Correct 는 맞힌 횟수다(같은 단어가 또 나와 맞히면 또 센다). Incorrect 는 못 맞힌 단어 수다 — 오답노트(Incorrect Answers)에
  // 실린 줄 수와 늘 같다(사장님 2026-10-12 "결과 화면에 오답 수랑 현제 오답페이지에 수량이 다름", OX 와 같은 방식).
  // 그 전에는 놓친 횟수(틀린 누름 + 시간 초과)를 세어, 같은 단어를 두 번 틀리면 Incorrect 2 에 오답노트는 1줄이었다.
  // 등급(getResultTitleAsset)도 이 두 수로 계산한다. 점수는 그대로 틀릴 때마다 깎인다.
  const correctCount = session.correctCount;
  const missedCount = session.incorrectWordCount;
  resultCorrectCount.textContent = formatScore(correctCount);
  resultIncorrectCount.textContent = formatScore(missedCount);
  // 2차 검수 공통-2(OX 와 같이): 보너스는 "+" 없이 숫자만 쓴다. 뒤의 "점" 은 스타일(.result-points::after)이 붙인다.
  resultBonusPoints.textContent = formatScore(session.bonusPoints);
  // 형제 프로젝트와 같은 문구로 항목별 대체 설명을 갱신한다.
  resultCorrectPoints.setAttribute(
    "aria-label",
    `맞힌 문제 ${formatScore(correctCount)}개`,
  );
  resultIncorrectPoints.setAttribute(
    "aria-label",
    `못 맞힌 문제 ${formatScore(missedCount)}개`,
  );
  resultBonusPoints.setAttribute(
    "aria-label",
    `보너스 점수 ${formatScore(session.bonusPoints)}점`,
  );
  renderResultRankAndScore(0, session.totalScore);
}

function getIncorrectAnswerKey(question) {
  return String(question?.word ?? "").trim().toLocaleLowerCase("en-US");
}

function updateIncorrectAnswersButton() {
  const records = [...incorrectAnswerRecords.values()];
  const totalWrongCount = records.reduce(
    (total, record) => total + record.wrongCount,
    0,
  );

  // 그 판에 오답이 없으면 자리까지 감춘다. 남은 버튼은 스타일에서 가운데로 모인다.
  incorrectAnswersButton.hidden = records.length === 0;
  incorrectAnswersButton.disabled = records.length === 0;
  incorrectAnswersButton.setAttribute(
    "aria-label",
    records.length > 0
      ? `오답 보기, ${records.length}개 단어 ${totalWrongCount}회`
      : "오답 없음",
  );
}

function recordIncorrectAnswer(question) {
  const key = getIncorrectAnswerKey(question);
  if (!key) {
    return;
  }

  const existing = incorrectAnswerRecords.get(key);
  if (existing) {
    existing.wrongCount += 1;
  } else {
    incorrectAnswerRecords.set(key, {
      word: String(question.word ?? "").trim(),
      meaning: String(question.answer ?? "").trim(),
      soundUrl: String(question.soundUrl ?? "").trim(),
      wrongCount: 1,
      sequence: incorrectAnswerSequence,
    });
    incorrectAnswerSequence += 1;
  }

  updateIncorrectAnswersButton();
}

// 최종 테스트 후속(OX 와 같이): 긴 단어만 칸에 맞게 줄인다. 값은 배율이다 — CSS 의 기준 크기(30px)에 곱한다.
// 바닥은 배율 0.73(약 22px)이다. 그보다 작으면 읽기 어렵다.
function fitIncorrectWordText(element) {
  const cell = element.closest(".incorrect-answer-word");
  if (!cell) {
    return;
  }
  const minimumScale = 0.73;
  const step = 0.02;
  cell.style.setProperty("--incorrect-word-scale", "1");
  for (let scale = 1; scale > minimumScale && element.scrollWidth > element.clientWidth; scale -= step) {
    cell.style.setProperty("--incorrect-word-scale", (scale - step).toFixed(2));
  }
}

function createIncorrectAnswerCell(className, role = "cell") {
  const cell = document.createElement("div");
  cell.className = `incorrect-answer-cell ${className}`;
  cell.setAttribute("role", role);
  return cell;
}

function renderIncorrectAnswerList() {
  incorrectAnswerList.replaceChildren();
  const pronunciationAvailable = hasMemberPronunciation();
  incorrectAnswerDialog.classList.toggle(
    "pronunciation-disabled",
    !pronunciationAvailable,
  );
  const records = [...incorrectAnswerRecords.values()].sort(
    (left, right) => (
      right.wrongCount - left.wrongCount
      || left.sequence - right.sequence
    ),
  );

  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "incorrect-answer-empty";
    empty.textContent = "오답이 없습니다.";
    incorrectAnswerList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  records.forEach((record) => {
    const row = document.createElement("div");
    row.className = "incorrect-answer-row incorrect-answer-grid";
    row.setAttribute("role", "row");

    const audioCell = createIncorrectAnswerCell("incorrect-answer-audio");
    if (pronunciationAvailable) {
      const speakerButton = document.createElement("button");
      speakerButton.className = "incorrect-answer-speaker";
      speakerButton.type = "button";
      speakerButton.disabled = !record.soundUrl;
      speakerButton.dataset.skipTouch = "true";
      speakerButton.setAttribute(
        "aria-label",
        record.soundUrl
          ? `${formatEnglishGameText(record.word)} 발음 듣기`
          : `${formatEnglishGameText(record.word)} 발음 없음`,
      );
      const speakerIcon = document.createElement("img");
      speakerIcon.src = "assets/incorrect-answer/icon_speaker.png";
      speakerIcon.alt = "";
      speakerIcon.width = 37;
      speakerIcon.height = 30;
      speakerIcon.draggable = false;
      speakerButton.append(speakerIcon);
      speakerButton.addEventListener("click", () => {
        // 2차 수정: 소리를 꺼도 오답노트 단어 발음은 들려준다(직접 누른 것이므로).
        playAudioSource(record.soundUrl, {
          ignoreSoundSetting: true,
          onError: () => showToast("Pronunciation unavailable"),
        });
      });
      audioCell.append(speakerButton);
    }

    const wordCell = createIncorrectAnswerCell("incorrect-answer-word");
    const wordText = document.createElement("span");
    wordText.className = "incorrect-answer-word-text";
    wordText.textContent = formatEnglishGameText(record.word);
    wordCell.append(wordText);

    const meaningCell = createIncorrectAnswerCell("incorrect-answer-meaning");
    meaningCell.textContent = record.meaning;

    row.append(audioCell, wordCell, meaningCell);
    fragment.append(row);
  });

  incorrectAnswerList.append(fragment);
  incorrectAnswerList.scrollTop = 0;
  window.requestAnimationFrame(() => {
    incorrectAnswerList
      .querySelectorAll(".incorrect-answer-word-text")
      .forEach(fitIncorrectWordText);
  });
}

function openIncorrectAnswerDialog() {
  if (incorrectAnswerRecords.size === 0) {
    return;
  }

  incorrectDialogReturnFocus = document.activeElement;
  incorrectAnswerDialog.hidden = false;
  renderIncorrectAnswerList();
  window.requestAnimationFrame(() => {
    incorrectAnswerCloseButton.focus({ preventScroll: true });
  });
}

function closeIncorrectAnswerDialog({ restoreFocus = true } = {}) {
  if (incorrectAnswerDialog.hidden) {
    return;
  }

  incorrectAnswerDialog.hidden = true;
  if (
    restoreFocus
    && incorrectDialogReturnFocus instanceof HTMLElement
    && !incorrectDialogReturnFocus.disabled
  ) {
    incorrectDialogReturnFocus.focus({ preventScroll: true });
  }
  incorrectDialogReturnFocus = null;
}

// 최종 테스트 후속(사장님, OX 와 같이): 결과화면 점수 밑에 저장 상태를 알린다. 문구는 OX 와 같다.
function setResultMessage(text) {
  resultMessage.textContent = text;
}

async function refreshResultSummary(session, token) {
  const launch = launchContext;
  setResultMessage(launch?.isDemo ? "데모 모드 결과입니다." : "점수 결과를 확인하고 있습니다.");
  try {
    const summary = await RESULT_DATA_ADAPTER.getSummary(session);
    if (token !== resultRequestToken || endOverlay.hidden) {
      return;
    }

    const rank = Math.trunc(finiteNumber(summary?.rank, 0));
    const cumulativeScore = finiteNumber(summary?.cumulativeScore, session.totalScore);
    renderResultRankAndScore(rank, cumulativeScore);
    if (launch?.isDemo) {
      setResultMessage("데모 모드에서는 점수를 저장하지 않습니다.");
    } else if (!launch || launch.isGuest) {
      setResultMessage("게스트 점수는 저장되지 않습니다.");
    } else if (rank > 0) {
      setResultMessage("점수와 순위를 저장했습니다.");
    } else {
      setResultMessage("점수를 저장했습니다. 현재 순위는 20위 밖입니다.");
    }
  } catch (error) {
    // 서버 어댑터가 실패해도 로컬 결과 팝업은 그대로 유지한다. 실패했다는 것만 알린다.
    if (token === resultRequestToken && !endOverlay.hidden) {
      setResultMessage(`점수를 저장하지 못했습니다: ${error?.message || "연결 오류"}`);
    }
  } finally {
    if (token === resultRequestToken && !endOverlay.hidden) {
      resultRankingReady = true;
      updateRankingAvailability();
    }
  }
}

function updateTimers() {
  if (!gameRunning) {
    return;
  }

  const now = performance.now();
  // 판정 중에는 시계를 멈춘 것처럼 보여야 한다. 종료 시각은 판정이 끝날 때
  // 한꺼번에 뒤로 밀리므로, 그 전까지는 멈춘 시점 기준으로 남은 시간을 읽는다.
  const clockNow = clockHoldStartedAt === 0 ? now : clockHoldStartedAt;
  const gameRemaining = Math.max(0, gameEndsAt - clockNow);
  const gameRatio = gameRemaining / gameDurationMs;
  playScreen.style.setProperty("--time-ratio", String(gameRatio));
  // 최종 테스트 후속(OX 와 같이): 남은 10초부터 급박(urgent), 5초부터 더 급박(critical)이다.
  playScreen.classList.toggle(
    "timer-urgent",
    gameRemaining > 5_000 && gameRemaining <= 10_000,
  );
  playScreen.classList.toggle(
    "timer-critical",
    gameRemaining > 0 && gameRemaining <= 5_000,
  );
  totalTimeText.textContent = formatTime(gameRemaining);

  if (gameRemaining <= 0) {
    finishGame();
    return;
  }

  if (acceptingAnswer) {
    const questionRemaining = Math.max(0, questionEndsAt - now);
    setQuestionCountdownSeconds(questionRemaining / 1000);
    if (questionRemaining <= 0) {
      handleQuestionTimeout();
    }
  }
}

function handleQuestionTimeout() {
  if (!acceptingAnswer) {
    return;
  }

  acceptingAnswer = false;
  stopQuestionAudio();
  holdGameClock();
  correctStreak = 0;
  resetComboProgress();
  timeoutCount += 1;
  // 검수 q58: 시간 초과로 끝난 문제도 출제된 문제이므로 오답노트에 남긴다.
  recordIncorrectAnswer(questions[lastQuestionIndex]);
  setChoiceEnabled(false);
  // 검수 r21: 시간 초과 배지와 TIME OUT 문구는 표시하지 않는다 (제한 시간 자체는 유지).
  // 표시를 없앤 만큼 남은 시간 영에서 멈춘 카운트다운도 함께 감춘다.
  clearQuestionCountdown();
  resultTimer = window.setTimeout(showNextQuestion, 900);
}

function resolveAnswer(button) {
  if (!acceptingAnswer || !gameRunning) {
    return;
  }

  acceptingAnswer = false;
  stopQuestionAudio();
  holdGameClock();
  setChoiceEnabled(false);
  button.classList.add("is-selected");

  const isCorrect = button.dataset.correct === "true";
  const shotSide = Math.random() < 0.5 ? "left" : "right";
  let comboAwarded = false;
  let comboProgress = 0;

  if (isCorrect) {
    correctStreak += 1;
    correctCount += 1;
    correctPoints += SCORING.correct;
    if (correctStreak >= SCORING.comboEvery) {
      bonusPoints += SCORING.comboBonus;
      comboAwarded = true;
      comboProgress = comboBalls.length;
      correctStreak = 0;
      comboResetPending = true;
    } else {
      comboProgress = Math.min(correctStreak, comboBalls.length);
    }
  } else {
    correctStreak = 0;
    resetComboProgress();
    incorrectCount += 1;
    incorrectPoints += SCORING.incorrect;
    recordIncorrectAnswer(questions[lastQuestionIndex]);
  }

  score = correctPoints + incorrectPoints + bonusPoints;
  // 보너스 판은 골이 들어가 보너스 표기가 뜨는 순간 점수판을 굴린다. 나머지 판은 즉시 반영한다.
  if (!comboAwarded) {
    updateScore();
  }
  setQuestionCountdownStatus("판정 중");
  playScreen.classList.add(
    "is-resolving",
    isCorrect ? "result-correct" : "result-wrong",
    `shot-${shotSide}`,
  );

  const diveSide = isCorrect
    ? (shotSide === "left" ? "right" : "left")
    : shotSide;
  // 대기 구간에는 대기 자세를 유지하고, 몸이 움직이기 시작할 때 다이빙 자세로 바꾼다.
  window.clearTimeout(keeperDiveTimer);
  keeperDiveTimer = window.setTimeout(() => {
    keeperDiveTimer = undefined;
    if (!gameRunning || !playScreen.classList.contains("is-resolving")) {
      return;
    }
    setActionSceneImage(
      goalkeeperImage,
      diveSide === "left"
        ? ACTION_SCENE_ASSETS.goalkeeper.diveLeft
        : ACTION_SCENE_ASSETS.goalkeeper.diveRight,
    );
  }, KEEPER_DIVE_START_MS);
  setActionSceneImage(kickerImage, ACTION_SCENE_ASSETS.kicker.kick);
  kickerImage.classList.add("is-kick-shift");

  if (isCorrect) {
    judgementTimer = window.setTimeout(() => {
      judgementTimer = undefined;
      if (!gameRunning || !playScreen.classList.contains("result-correct")) {
        return;
      }
      showAnimatedText(
        feedbackText,
        formatBonus(SCORING.correct),
        "is-correct",
      );
      setActionSceneImage(kickerImage, ACTION_SCENE_ASSETS.kicker.goal);
      kickerImage.classList.remove("is-kick-shift");
      setActionSceneImage(
        goalkeeperImage,
        ACTION_SCENE_ASSETS.goalkeeper.concede,
      );
      playSound("correct");
      playSound("cheer");
      emitGoalParticles(shotSide);
      renderComboProgress(comboProgress, { burst: comboAwarded });
      // 최종 테스트 후속(OX 와 같이): 첫째·둘째 공이 켜지면 그 공 위에 방금 얻은 정답 점수를 띄운다.
      // 셋째(보너스) 공은 아래 보너스 표기가 맡는다.
      if (!comboAwarded && comboProgress >= 1 && comboProgress < comboBalls.length) {
        showComboStepGain(comboProgress - 1);
      }
      if (comboAwarded) {
        emitComboParticles();
        animateScore(score);
        showBonusGain();
        playScoreBonus();
      }
    }, CORRECT_GOAL_DELAY_MS);
  } else {
    judgementTimer = window.setTimeout(() => {
      judgementTimer = undefined;
      if (!gameRunning || !playScreen.classList.contains("result-wrong")) {
        return;
      }
      showAnimatedText(
        feedbackText,
        formatScore(SCORING.incorrect),
        "is-wrong",
      );
      setActionSceneImage(kickerImage, ACTION_SCENE_ASSETS.kicker.blocked);
      kickerImage.classList.remove("is-kick-shift");
      setActionSceneImage(goalkeeperImage, ACTION_SCENE_ASSETS.goalkeeper.save);
      playSound("incorrect");
      playSound("boo");
      emitSaveParticles(shotSide);
    }, INCORRECT_IMPACT_DELAY_MS);
  }

  const nextQuestionDelay = comboAwarded
    ? Math.max(
      RESULT_DURATION_MS,
      CORRECT_GOAL_DELAY_MS + COMBO_EFFECT_VISIBLE_MS,
    )
    : RESULT_DURATION_MS;
  resultTimer = window.setTimeout(showNextQuestion, nextQuestionDelay);
}

function finishGame() {
  if (!gameRunning) {
    return;
  }

  gameRunning = false;
  acceptingAnswer = false;
  clockHoldStartedAt = 0;
  stopQuestionAudio({ clearSource: true });
  clearGameTimers();
  // 종료 시에는 굴림을 끊고 최종 점수를 즉시 찍는다.
  updateScore();
  resetComboProgress();
  setChoiceEnabled(false);
  playScreen.style.setProperty("--time-ratio", "0");
  playScreen.classList.remove("clock-running", "timer-urgent", "timer-critical");
  playScreen.classList.add("timer-ended", "showing-result");
  totalTimeText.textContent = "00:00";
  setQuestionCountdownStatus("종료");
  const session = buildSessionSummary();
  const token = ++resultRequestToken;
  resultRankingReady = false;
  updateRankingAvailability();
  renderResultBreakdown(session);
  updateIncorrectAnswersButton();
  gameParticleLayer.clear();
  // 검수 사차 아홉째 항: 결과화면에서는 소리 설정과 무관하게 배경음을 멈춘다.
  // 소리 설정값은 그대로 두고 배경음을 원하는 상태만 내려 둔다. 그래야 탭이 숨었다
  // 돌아오는 것처럼 다른 경로로 복귀가 불려도 결과화면에서는 다시 나지 않는다.
  bgmWanted = false;
  pauseBgm();
  endOverlay.hidden = false;
  stage.classList.add("result-mode");
  // 2차 수정: Try Again 에서는 파티클을 내지 않는다(Good·Excellent 일 때만).
  resultParticleLayer.clear();
  if (getResultTitleAsset(session) !== RESULT_TITLE_ASSETS.tryAgain) {
    emitResultConfetti();
  }
  setResultMessage("결과를 준비하고 있습니다.");
  resultSummaryPromise = refreshResultSummary(session, token);
  emitNavigation("ending");
}

function startGame() {
  if (!contentReady) {
    showToast("Loading...");
    return;
  }

  clearGameTimers();
  gameParticleLayer.clear();
  resultParticleLayer.clear();
  closeHelp({ restoreFocus: false });
  closeIncorrectAnswerDialog({ restoreFocus: false });
  closeRankingDialog({ restoreFocus: false });
  startScreen.hidden = true;
  playScreen.hidden = false;
  endOverlay.hidden = true;
  stage.classList.remove("result-mode");
  setResultMessage("");
  // 다시 하기로 들어오면 결과화면에서 멈춰 둔 배경음을 설정대로 되돌린다.
  // 결과화면 덮개를 감춘 뒤에 튼다. 순서가 뒤집히면 결과화면 위에서 소리가 난다.
  bgmWanted = true;
  resumeBgm();
  closeButton.setAttribute("aria-label", "시작 화면으로 돌아가기");

  score = 0;
  correctPoints = 0;
  incorrectPoints = 0;
  bonusPoints = 0;
  correctCount = 0;
  incorrectCount = 0;
  timeoutCount = 0;
  correctStreak = 0;
  resetComboProgress();
  // 2차 수정: 앞 판 마지막 단어로 새 판을 시작하지 않는다(다시 하기와 처음으로 → Start 모두).
  // 그래서 lastQuestionIndex 를 지우지 않고 남겨 두어 첫 문제를 고를 때도 피하게 한다.
  incorrectAnswerRecords.clear();
  incorrectAnswerSequence = 0;
  resultRankingReady = false;
  updateIncorrectAnswersButton();
  updateScore();
  resultRequestToken += 1;
  renderResultBreakdown(buildSessionSummary());
  playScreen.classList.remove(
    "timer-ended",
    "timer-urgent",
    "timer-critical",
    "showing-result",
  );
  void timerClock.offsetWidth;
  playScreen.classList.add("clock-running");
  gameRunning = true;
  clockHoldStartedAt = 0;
  gameEndsAt = performance.now() + gameDurationMs;

  showNextQuestion();
  gameTickTimer = window.setInterval(updateTimers, 100);
  emitNavigation("game");
}

function showStartScreen() {
  gameRunning = false;
  acceptingAnswer = false;
  stopQuestionAudio({ clearSource: true });
  clearGameTimers();
  gameParticleLayer.clear();
  resultParticleLayer.clear();
  closeHelp({ restoreFocus: false });
  resetComboProgress();
  closeIncorrectAnswerDialog({ restoreFocus: false });
  closeRankingDialog({ restoreFocus: false });
  resultRankingReady = false;
  // 나가면 그 판은 끝이다. 점수와 오답 목록을 지우고 배경음을 설정대로 되돌린다.
  incorrectAnswerRecords.clear();
  incorrectAnswerSequence = 0;
  updateIncorrectAnswersButton();
  correctPoints = 0;
  incorrectPoints = 0;
  bonusPoints = 0;
  correctCount = 0;
  incorrectCount = 0;
  timeoutCount = 0;
  correctStreak = 0;
  score = 0;
  updateScore();
  resetActionScene();
  playScreen.classList.remove(
    "clock-running",
    "timer-urgent",
    "timer-critical",
    "timer-ended",
    "showing-result",
  );
  endOverlay.hidden = true;
  stage.classList.remove("result-mode");
  setResultMessage("");
  playScreen.hidden = true;
  startScreen.hidden = false;
  closeButton.setAttribute("aria-label", "게임 닫기");
  // 결과화면에서 내려 둔 상태를 되돌린다. 덮개를 감춘 뒤에 튼다.
  // 소리를 꺼 둔 사용자에게는 여전히 나지 않는다.
  bgmWanted = true;
  resumeBgm();
  updateRankingAvailability();
  emitNavigation("start");
}

stage.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (
    !button
    || button.disabled
    || button === soundButton
    || button.dataset.skipTouch === "true"
  ) {
    return;
  }
  playSound("touch");
}, { capture: true });

soundButton.addEventListener("click", () => {
  const wasSoundEnabled = soundEnabled;
  if (wasSoundEnabled) {
    playSound("touch");
  }
  soundEnabled = !wasSoundEnabled;
  if (!soundEnabled) {
    stopQuestionAudio();
    pauseBgm();
  }
  if (soundEnabled) {
    playSound("touch");
    resumeBgm();
  }
  // 2차 수정: 소리 켜기·끄기 안내 팝업은 띄우지 않는다. 단추 그림이 상태를 보여 준다.
  updateSoundUI();
});

startButton.addEventListener("click", () => {
  if (!contentReady) {
    return;
  }
  pressButton(startButton);
  startGame();
});

rankingButton.addEventListener("click", () => {
  void showRanking(rankingButton);
});

resultRankingButton.addEventListener("click", () => {
  void showRanking(resultRankingButton);
});

retryLoadButton.addEventListener("click", () => {
  void initializeContent({ force: true });
});

closeButton.addEventListener("click", () => {
  if (!helpScreen.hidden) {
    closeHelp();
    return;
  }
  if (!playScreen.hidden) {
    showStartScreen();
    return;
  }
  if (isCloseGuarded()) {
    return;
  }
  leaveGame();
});

choiceButtons.forEach((button) => {
  button.addEventListener("click", () => resolveAnswer(button));
});

function replayGame(button) {
  pressButton(button);
  startGame();
}

// 결과 화면의 X 와 시작 화면의 닫기 단추는 같은 자리(오른쪽 위)다(2차 검수 공통-3 으로 X 를 옮겼다).
// 결과 화면 X 를 연달아 두 번 누르면 둘째 누름이 방금 나타난 닫기 단추에 들어가 게임을 나가 버린다(독립 검토가 찾음).
// 결과 화면에서 시작 화면으로 옮긴 직후 잠깐은 닫기 단추의 "게임 나가기"를 받지 않는다. 도움말 닫기 · 게임 중 나가기는 그대로다.
const CLOSE_GUARD_AFTER_RESULT_MS = 700;
let closeGuardUntil = 0;

function armCloseGuard() {
  closeGuardUntil = performance.now() + CLOSE_GUARD_AFTER_RESULT_MS;
}

function isCloseGuarded() {
  return performance.now() < closeGuardUntil;
}

// 검수 사차 아홉째 항: 결과화면에서 시작 화면으로 나간다. 다시 하기와 달리 이 판은 여기서 끝나므로,
// 회원 점수 저장이 들어 있는 결과 요약 갱신이 끝난 뒤에 화면을 옮긴다.
async function leaveResultToStart(button) {
  if (leavingResult) {
    return;
  }
  leavingResult = true;
  pressButton(button);
  button.disabled = true;

  try {
    await resultSummaryPromise;
  } finally {
    leavingResult = false;
    button.disabled = false;
    armCloseGuard();
    showStartScreen();
  }
}

resultHomeButton.addEventListener("click", () => {
  void leaveResultToStart(resultHomeButton);
});
tryAgainButton.addEventListener("click", () => replayGame(tryAgainButton));
incorrectAnswersButton.addEventListener("click", openIncorrectAnswerDialog);
incorrectAnswerCloseButton.addEventListener("click", () => {
  closeIncorrectAnswerDialog();
});
incorrectAnswerBackdrop.addEventListener("click", () => {
  closeIncorrectAnswerDialog();
});
rankingCloseButton.addEventListener("click", () => {
  closeRankingDialog();
});
rankingBackdrop.addEventListener("click", () => {
  closeRankingDialog();
});

helpButton.addEventListener("click", () => {
  pressButton(helpButton);
  window.setTimeout(openHelp, 120);
});

helpRetryButton.addEventListener("click", () => {
  void loadHelp({ retry: true });
});

window.addEventListener("resize", resizeStage, { passive: true });
window.addEventListener("orientationchange", resizeStage, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopQuestionAudio();
    pauseBgm();
    gameParticleLayer.clear();
    resultParticleLayer.clear();
  } else {
    resumeBgm();
  }
});
window.addEventListener("keydown", (event) => {
  if (!rankingDialog.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeRankingDialog();
    } else {
      trapRankingFocus(event);
    }
    return;
  }
  if (event.key !== "Escape") {
    return;
  }
  if (!incorrectAnswerDialog.hidden) {
    closeIncorrectAnswerDialog();
    return;
  }
  if (!helpScreen.hidden) {
    closeHelp();
  }
});

resizeStage();
updateSoundUI();
setChoiceEnabled(false);
armBgmOnGesture();
void initializeContent();
