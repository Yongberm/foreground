(function wordMatchRacing() {
  "use strict";

  const Race = window.WordMatchRace;
  const Rules = window.WordMatchRules;

  const STAGE_WIDTH = 1920;
  const STAGE_HEIGHT = 1080;

  /*
   * 2차 수정(공통 기준): 제한 시간은 API info.play_time 을 먼저 쓰고, 값이 없으면 40초.
   * 초 단위 값은 content-loader 의 playTimeSeconds() 가 정한다(예전 A-6 은 120초).
   * 기획서 1-1: 문항별 6초 룰은 없다 — 정해진 시간 안에 많이 푸는 활동이다.
   */
  const FALLBACK_TOTAL_DURATION_MS = 40_000;
  const FRAME_CAP_MS = Race.FRAME_CAP_MS;
  const CAR_WIDTH = 166;
  const CAR_ORDER = Object.freeze(["red", "blue", "green"]);
  const CAR_IMAGES = Object.freeze({
    red: "asset/game/car-red.png",
    blue: "asset/game/car-blue.png",
    green: "asset/game/car-green.png",
  });
  /*
   * 보기 상자 색은 차선마다 고정(docs/preview_ready.png): 왼쪽 파랑(answer3),
   * 가운데 노랑(answer1), 오른쪽 초록(answer2). *-1 은 그림자가 깊은 판으로,
   * 정답을 얻는 순간 바꿔 끼워 상자가 튀어 오르는 느낌을 낸다.
   */
  const CHOICE_IMAGES = Object.freeze([
    "asset/game/answer3.png",
    "asset/game/answer1.png",
    "asset/game/answer2.png",
  ]);
  const CHOICE_HIT_IMAGES = Object.freeze([
    "asset/game/answer3-1.png",
    "asset/game/answer1-1.png",
    "asset/game/answer2-1.png",
  ]);
  // 장애물 3종(리소스 기준): 라바콘, 타이어, 바나나 껍질.
  const OBSTACLE_IMAGES = Object.freeze({
    cone: "asset/game/obstacle1.png",
    tires: "asset/game/obstacle2.png",
    banana: "asset/game/obstacle4.png",
  });
  // 연료통은 시간 아이템이다(사용자 지시 2026-09-04): 먹으면 제한 시간이 10초 늘어난다.
  const FUEL_IMAGE = "asset/game/obstacle3.png";
  const DEFAULT_FUEL_BONUS_SECONDS = 10;
  // 신호등 램프(사용자 지시 2026-09-04): 배너 소켓 위 왼쪽부터 빨강·노랑·초록. index.html 이 자리를 잡는다.
  const LAMP_IMAGES = Object.freeze([
    "asset/game/blinker_red.png",
    "asset/game/blinker_yellow.png",
    "asset/game/blinker_green.png",
  ]);
  const SOUND_ASSETS = Object.freeze({
    touch: "asset/sound/touch.mp3",
    correct: "asset/sound/success.mp3",
    incorrect: "asset/sound/fail.mp3",
    trap: "asset/sound/effect_trap.mp3",
    swap: "asset/sound/swap.mp3",
    show: "asset/sound/show.mp3",
    open: "asset/sound/open.mp3",
    cheer: "asset/sound/yeah.mp3",
    lose: "asset/sound/effect_falid_ha_ah.mp3",
    item: "asset/sound/item/item0.mp3",
  });
  // 배경음. 리소스 폴더가 준 bgm.mp3 를 효과음보다 한참 아래 볼륨으로 반복한다.
  const BGM_SRC = "asset/sound/bgm.mp3";
  const BGM_VOLUME = 0.35;

  const RESULT_TITLE_ASSETS = Object.freeze({
    excellent: { src: "asset/result/result_text0.png", alt: "Excellent" },
    good: { src: "asset/result/result_text1.png", alt: "Good" },
    // 검수표 r10: 대문자 A 를 쓴 새 그림. 파일 이름은 받은 그대로 둔다(빈칸은 %20).
    tryAgain: { src: "asset/result/Try%20Again.png?v=20261015-2", alt: "Try Again" },
  });

  // 등급별 여우 그림(사장님 지시 2026-09-30). 제목 그림과 같은 등급을 쓴다.
  // 미리받기 목록(PRELOAD_IMAGES)이 이 상수를 읽으므로 반드시 그 위에 둔다.
  const RESULT_FOX_ASSETS = Object.freeze({
    excellent: "asset/result/excellent.png?v=20261015-2",
    good: "asset/result/good.png?v=20261015-2",
    tryAgain: "asset/result/try_again.png?v=20261015-2",
  });
  const PARTICLE_COLORS = Object.freeze([
    "#fff044",
    "#ff7338",
    "#25dfff",
    "#ff4ca8",
    "#ffffff",
    "#6bf06f",
  ]);
  const SPARK_COLORS = Object.freeze(["#ffd400", "#ffffff", "#ff4fa3", "#ff8a00", "#4dffb0", "#ffe97a"]);

  /*
   * 출발 신호(승인된 A-3). 리소스 start_00~02(3·2·1)와 start(START)를 차례로 보여 준다.
   * 그림 안에 신호등이 있으므로 배너의 신호등은 출발한 뒤에만 초록을 켠다.
   */
  const COUNTDOWN_STEPS = Object.freeze([
    { src: "asset/start/start_00.png", alt: "3" },
    { src: "asset/start/start_01.png", alt: "2" },
    { src: "asset/start/start_02.png", alt: "1" },
    { src: "asset/start/start.png", alt: "START" },
  ]);
  const DEFAULT_COUNTDOWN_STEP_MS = 700;
  // START 그림이 뜨는 순간 출발한다(사용자 지시). 그림은 덮개 없이 이만큼 남았다가 사라진다.
  const COUNTDOWN_GO_HOLD_MS = 600;
  // 문제 발음은 직전 판정(정답·오답·장애물 등)에서 이만큼 지난 뒤에 들려준다(사용자 지시: 정답 순간에 발음 없음).
  const QUESTION_SOUND_DELAY_MS = 600;
  /*
   * 저사양 대비(사용자 요청 2026-09-04). 화면을 채우는 그림과 그림자 효과는 GPU 가 약한
   * 기기에서 프레임을 떨어뜨린다. (1) 시작할 때 큰 그림을 미리 해독해 첫 등장 때의
   * 멈칫거림을 없앤다. (2) 주행 중 프레임 시간을 재서 두 구간 연속 평균 26ms(약 38fps)를
   * 넘으면 그림자·불꽃·장식 애니메이션을 끄는 가벼운 모드(perf-lite)로 바꾼다.
   * (3) CPU 코어 2개 이하나 메모리 2GB 이하로 보고되는 기기는 처음부터 가벼운 모드다.
   */
  const PERF_SAMPLE_FRAMES = 90;
  const PERF_LITE_FRAME_MS = 26;
  const PERF_SAMPLE_CAP_MS = 250;
  const PRELOAD_TIMEOUT_MS = 4_000;
  const PRELOAD_IMAGES = Object.freeze([
    // 2차 수정: 도움말 화면의 뒤로가기. 처음 열 때 빈 칸으로 스치지 않게 미리 받는다.
    "asset/btn_back.png",
    // 시작 화면 트로피·Start·Ranking(2026-10-01). 광택 때문에 <img> 를 CSS 배경으로 바꿨더니
    // 시작 화면이 뜬 뒤에야 받기 시작해, 회선이 느리면 트로피 팝 연출이 빈 채로 끝났다.
    // 주소는 styles.css 의 배경·마스크와 글자까지 같아야 한다.
    "asset/start/back_tp.png",
    "asset/start/btn_start.png",
    "asset/start/btn_ranking.png?v=20261015-2",
    "asset/game/game_bg1.png",
    "asset/game/game_bg2.png",
    "asset/game/question.png",
    "asset/game/dimmed.png",
    "asset/game/popup.png",
    "asset/game/scroe.png",
    "asset/game/score_needle.png",
    "asset/game/time.png",
    "asset/game/time_needle.png",
    "asset/game/img.png",
    ...CHOICE_IMAGES,
    ...CHOICE_HIT_IMAGES,
    ...Object.values(OBSTACLE_IMAGES),
    FUEL_IMAGE,
    ...LAMP_IMAGES,
    ...Object.values(CAR_IMAGES),
    ...COUNTDOWN_STEPS.map((step) => step.src),
    "asset/result/bg.png?v=20261015-2",
    "asset/result/result_point_box.png?v=20261015-2",
    ...Object.values(RESULT_TITLE_ASSETS).map((asset) => asset.src),
    // 여우도 같이 받는다. 빠뜨리면 결과화면 첫 프레임에 index.html 의 초기 그림이나
    // 직전 판의 등급 여우가 잠깐 보인다(4차 공통 확인 항목).
    ...Object.values(RESULT_FOX_ASSETS),
  ]);
  /*
   * 배경 스크롤(사용자 지시 2026-09-04: 배경이 움직이는 방식, 고정 배경은 어색함).
   * 도로·연석·차선·풍경이 한 그림에 들어 있으므로 그림 전체 타일을 SCENE_PATTERN 순서
   * (bg1 → bg2 → bg2 → bg2, 반복)로 이어 붙여 줄과 같은 속도로 아래로 흘린다. 한 바퀴
   * (4장)를 다 내리면 처음으로 되감는다. 별도 도로 띠나 점선 오버레이는 없다.
   */
  const SCENE_PATTERN = Object.freeze(["bg1", "bg2", "bg2", "bg2"]);
  const SCENE_TILE_HEIGHT = 1080;
  const SCENE_CYCLE_HEIGHT = SCENE_PATTERN.length * SCENE_TILE_HEIGHT;
  const DEFAULT_SCORE_GAUGE_MAX = 2000;
  const FEEDBACK_MS = 520;
  const CAR_TILT_MS = 220;

  function readGameConfig() {
    try {
      const config = JSON.parse(document.querySelector("#gameConfig")?.textContent || "{}");
      return config && typeof config === "object" ? config : {};
    } catch {
      return {};
    }
  }

  const gameConfig = readGameConfig();

  // 설정 숫자 읽기: 빠졌거나 숫자가 아닐 때만 기본값. 0 도 유효한 값이다(검수 확정 2026-09-04: `||` 는 0 을 기본값으로 바꿨다).
  function readNumber(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  const scoring = Object.freeze({
    correct: readNumber(gameConfig.scoring?.correct, 100),
    incorrect: readNumber(gameConfig.scoring?.incorrect, -10),
    obstacle: readNumber(gameConfig.scoring?.obstacle, -10),
    comboEvery: Math.max(1, Math.trunc(readNumber(gameConfig.scoring?.comboEvery, 3))),
    comboBonus: readNumber(gameConfig.scoring?.comboBonus, 100),
  });
  const countdownStepMs = Math.max(200, readNumber(gameConfig.timing?.countdownStepMs, DEFAULT_COUNTDOWN_STEP_MS));
  const fuelBonusMs = Math.max(0, readNumber(gameConfig.timing?.fuelBonusSeconds, DEFAULT_FUEL_BONUS_SECONDS)) * 1_000;
  const scoreGaugeMax = Math.max(100, readNumber(gameConfig.gauge?.scoreMax, DEFAULT_SCORE_GAUGE_MAX));

  let totalDurationMs = FALLBACK_TOTAL_DURATION_MS;
  let words = [];
  let launchContext = null;
  // 2차 검수 공통-9: 시작 화면에 보여 줄 동화 정보(info API 의 title · subtitle). 없으면 빈 글자다.
  let storyInfo = { title: "", subtitle: "" };

  const elements = {
    stage: document.querySelector("#game-stage"),
    startScreen: document.querySelector("#start-screen"),
    startConfetti: document.querySelector("#start-confetti"),
    startStory: document.querySelector("#start-story"),
    startStoryTitle: document.querySelector("#start-story-title"),
    startStorySubtitle: document.querySelector("#start-story-subtitle"),
    playScreen: document.querySelector("#play-screen"),
    helpScreen: document.querySelector("#help-screen"),
    startButton: document.querySelector("#start-button"),
    startRankingButton: document.querySelector("#start-ranking-button"),
    helpButton: document.querySelector("#help-button"),
    helpContentViewport: document.querySelector(".help-content-viewport"),
    helpContent: document.querySelector("#help-content"),
    helpStatus: document.querySelector("#help-status"),
    helpStatusMessage: document.querySelector("#help-status-message"),
    helpRetryButton: document.querySelector("#help-retry-button"),
    soundButton: document.querySelector("#sound-button"),
    soundIcon: document.querySelector("#sound-icon"),
    navigationButton: document.querySelector("#navigation-button"),
    navigationIcon: document.querySelector("#navigation-icon"),
    statusToast: document.querySelector("#status-toast"),
    sceneTrack: document.querySelector("#scene-track"),
    roadItems: document.querySelector("#road-items"),
    effectsLayer: document.querySelector("#effects-layer"),
    car: document.querySelector("#car"),
    carImage: document.querySelector("#car-image"),
    questionWord: document.querySelector("#question-word"),
    comboMeter: document.querySelector("#combo-meter"),
    comboPips: Array.from(document.querySelectorAll(".combo-pip")),
    comboGains: Array.from(document.querySelectorAll(".combo-gain")),
    trafficLamps: Array.from(document.querySelectorAll(".traffic-lamp")),
    scoreFloat: document.querySelector("#score-float"),
    scoreBonusRing: document.querySelector("#score-bonus-ring"),
    scoreBonusFloat: document.querySelector("#score-bonus-float"),
    bonusFloat: document.querySelector("#bonus-float"),
    bonusFloatValue: document.querySelector("#bonus-float-value"),
    timeFloat: document.querySelector("#time-float"),
    scoreNeedle: document.querySelector("#score-needle"),
    timeNeedle: document.querySelector("#time-needle"),
    score: document.querySelector("#score-value"),
    time: document.querySelector("#time-value"),
    countdown: document.querySelector("#countdown"),
    countdownImage: document.querySelector("#countdown-image"),
    status: document.querySelector("#game-status"),
    carSelectDialog: document.querySelector("#car-select-dialog"),
    carSelectBackdrop: document.querySelector("#car-select-backdrop"),
    carTiles: Array.from(document.querySelectorAll(".car-tile")),
    endScreen: document.querySelector("#end-screen"),
    resultReplayButton: document.querySelector("#result-replay-button"),
    resultParticleCanvas: document.querySelector("#result-particle-canvas"),
    resultTitle: document.querySelector("#result-title"),
    resultFoxImage: document.querySelector("#result-fox-image"),
    resultCorrectPoints: document.querySelector("#result-correct-points"),
    resultIncorrectPoints: document.querySelector("#result-incorrect-points"),
    resultBonusPoints: document.querySelector("#result-bonus-points"),
    resultRank: document.querySelector("#result-rank"),
    resultTotalScore: document.querySelector("#result-total-score"),
    resultScoreNumber: document.querySelector("#result-score-number"),
    resultMessage: document.querySelector("#result-message"),
    incorrectAnswersButton: document.querySelector("#incorrect-answers-button"),
    incorrectAnswerDialog: document.querySelector("#incorrect-answer-dialog"),
    incorrectAnswerBackdrop: document.querySelector("#incorrect-answer-backdrop"),
    incorrectAnswerClose: document.querySelector("#incorrect-answer-close-button"),
    incorrectAnswerList: document.querySelector("#incorrect-answer-list"),
    rankingButton: document.querySelector("#ranking-button"),
    tryAgainButton: document.querySelector("#try-again-button"),
    resultDialog: document.querySelector("#result-dialog"),
    resultDialogBackdrop: document.querySelector("#result-dialog-backdrop"),
    resultDialogClose: document.querySelector("#result-dialog-close"),
    resultDialogTitle: document.querySelector("#result-dialog-title"),
    resultDialogContent: document.querySelector("#result-dialog-content"),
    rankingMyBadgeImage: document.querySelector("#ranking-my-badge-image"),
    rankingMyBadgeFallback: document.querySelector("#ranking-my-badge-fallback"),
    rankingMyName: document.querySelector("#ranking-my-name"),
    rankingMyScore: document.querySelector("#ranking-my-score"),
    loadingScreen: document.querySelector("#loading-screen"),
    loadingTitle: document.querySelector("#loading-title"),
    loadingMessage: document.querySelector("#loading-message"),
    retryButton: document.querySelector("#retry-button"),
  };

  const state = {
    race: null,
    scoreboard: null,
    rowNodes: new Map(),
    // idle → countdown → racing → ended
    phase: "idle",
    carColor: "red",
    gameStartedAt: 0,
    // 연료통으로 늘어난 시간(ms). 남은 시간 = 제한 시간 + 이 값 - 경과 시간.
    bonusTimeMs: 0,
    lastFrameAt: 0,
    animationFrameId: 0,
    countdownTimerIds: [],
    goSignalUntil: 0,
    lastResolveAt: 0,
    feedbackTimerIds: [],
    sceneOffset: 0,
    dragging: false,
    locked: true,
    ended: true,
    answeredCount: 0,
    historyRequested: false,
    historyPromise: null,
    resultRequestToken: 0,
  };
  // 검수 4차 q58: 출제된 문제와 맞힌 문제를 따로 들고, 오답노트는 둘의 차이로 만든다.
  const presentedQuestions = new Map();
  // 등급의 분모. 내려온 문제 줄을 그대로 세므로 같은 단어가 다시 나오면 또 센다.
  let presentedQuestionCount = 0;
  const correctQuestionKeys = new Set();
  const wrongAnswerCounts = new Map();
  // 2차 A-4: 단어마다 나온 횟수와 맞힌 횟수. 오답노트가 Incorrect 개수와 맞물리게 한다(rules.js 설명).
  const presentedTimes = new Map();
  const correctTimes = new Map();
  let comboFlashTimer = null;
  let carTiltTimer = null;
  let resultParticleFrame = 0;
  let resultParticles = [];
  let contentRequestToken = 0;
  let resultDialogReturnFocus = null;
  let incorrectDialogReturnFocus = null;
  let activeIncorrectAudio = null;
  let resultDialogRequestToken = 0;
  let startRankingRequestToken = 0;
  let helpRequestToken = 0;
  let helpReturnFocus = null;
  let currentScreen = "loading";
  let soundEnabled = true;
  let toastTimer = 0;
  const activeEffectAudios = new Set();
  let bgmAudio = null;
  let bgmWanted = false;
  let bgmWantedBeforeResult = null;

  /*
   * 공통 10항(사장님 지시 2026-09-29): 점수는 1000 이 아니라 1,000 으로 쓴다.
   * 12개 방이 같은 모양을 쓰도록 반올림하고, -0 은 0 으로 눕혀 "-0" 이 찍히지 않게 한다.
   * 개수·시계·문항 번호는 대상이 아니다.
   */
  function formatScore(value) {
    const rounded = Math.round(Number(value) || 0);
    return (rounded === 0 ? 0 : rounded).toLocaleString("en-US");
  }

  /* ---------------- 저사양 대비: 그림 미리 해독 · 가벼운 모드 ---------------- */

  const preloadedImages = new Map();

  function preloadImage(src) {
    if (preloadedImages.has(src)) return preloadedImages.get(src).ready;
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    const ready = (typeof image.decode === "function" ? image.decode() : Promise.resolve())
      .catch(() => {});
    // 해독된 그림이 캐시에서 밀려나지 않도록 요소를 붙들어 둔다.
    preloadedImages.set(src, { image, ready });
    return ready;
  }

  function preloadImages() {
    const all = Promise.all(PRELOAD_IMAGES.map(preloadImage));
    const timeout = new Promise((resolve) => window.setTimeout(resolve, PRELOAD_TIMEOUT_MS));
    return Promise.race([all, timeout]);
  }

  /*
   * 한글 글꼴(나눔스퀘어라운드 Bold, 2026-10-02)을 시작 화면 전에 받아 둔다. 칸 맞춤(차선 뜻 등)이 대체 글꼴
   * 폭으로 재지 않게 하고, 첫 화면에 대체 글꼴이 번쩍 보이지 않게 한다(styles.css 는 font-display: block).
   * 「가」를 넘겨 한글 글자에 쓰이는 글꼴을 받게 한다. 받지 못해도 그림과 같은 4초 뒤에는 진행한다.
   */
  const KOREAN_FONT_FACES = Object.freeze(['700 1em "NanumSquareRound Game"', '700 1em "Round Fallback"']);

  function preloadFonts() {
    if (typeof document.fonts?.load !== "function") return Promise.resolve();
    const all = Promise.all(KOREAN_FONT_FACES.map((face) => document.fonts.load(face, "가").catch(() => [])));
    const timeout = new Promise((resolve) => window.setTimeout(resolve, PRELOAD_TIMEOUT_MS));
    return Promise.race([all, timeout]);
  }

  const perf = { frameCount: 0, frameTotalMs: 0, slowWindows: 0, lite: false, reason: "" };

  function isLowEndDevice() {
    const cores = Number(navigator.hardwareConcurrency) || 0;
    const memory = Number(navigator.deviceMemory) || 0;
    return (cores > 0 && cores <= 2) || (memory > 0 && memory <= 2);
  }

  function enablePerfLite(reason) {
    if (perf.lite) return;
    perf.lite = true;
    perf.reason = reason;
    elements.stage.classList.add("perf-lite");
    emitNavigation("perf-lite", { reason });
  }

  // 주행 중 프레임 시간을 재어 느린 기기를 알아낸다. 탭 전환 같은 한 번의 긴 공백은 250ms 로 잘라 센다.
  function samplePerformance(rawDeltaMs) {
    if (perf.lite) return;
    perf.frameCount += 1;
    perf.frameTotalMs += Math.min(PERF_SAMPLE_CAP_MS, Math.max(0, rawDeltaMs));
    if (perf.frameCount < PERF_SAMPLE_FRAMES) return;
    const average = perf.frameTotalMs / perf.frameCount;
    perf.frameCount = 0;
    perf.frameTotalMs = 0;
    perf.slowWindows = average > PERF_LITE_FRAME_MS ? perf.slowWindows + 1 : 0;
    if (perf.slowWindows >= 2) enablePerfLite(`slow frames (${Math.round(average)}ms)`);
  }

  function emitNavigation(screen, detail = {}, { cancelable = false } = {}) {
    // cancelable 을 켜면 호스트가 preventDefault() 로 막을 수 있고, 막혔는지 돌려준다.
    // 기존 갈래들은 세 번째 인자를 주지 않으므로 cancelable: false 로 예전과 똑같이 돈다.
    const event = new CustomEvent("wordmatch:navigate", {
      detail: { screen, ...detail },
      cancelable,
    });
    const notPrevented = window.dispatchEvent(event);
    return notPrevented;
  }

  /*
   * 시작화면 X (사장님 지시 2026-09-30). 호스트 셸이 닫아 준다는 보장이 없어서
   * 스스로 돌아갈 길을 갖춘다. 어디로 갈지는 rules.js 의 순수 함수가 고르고
   * (남의 주소로 끌려가지 않게 거기서 거른다) 여기서는 고른 대로 움직이기만 한다.
   */
  function readCloseUrlParam() {
    try {
      return new URLSearchParams(window.location.search).get("close_url") || "";
    } catch (error) {
      return "";
    }
  }

  /*
    * [앱 전용 자리] 2차 검수 공통-12(2026-10-12 "앱 : 웹뷰 닫는 인터페이스 호출 … 내부에 앱에 올릴때 직접 작업예정"):
    * 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — 리틀팍스가 앱(Android · iOS)에 올릴 때 직접 작업한다.
    * 지금은 비어 있다. 화면에 알림은 띄우지 않는다. 함수 이름은 12개 게임이 모두 같다(리틀팍스에 알려 줄 인터페이스).
    */
  function closeAppWebView() {}

  /*
    * 게임을 닫는다 — 시작 화면의 X 버튼. 2차 검수 공통-12("닫기(X) 버튼 눌렀을때 동작 — 웹 : 창 닫기 / 앱 : 웹뷰 닫는
    * 인터페이스 호출"). 앱인지 웹인지 가르지 않고 늘 같은 순서로 한다:
    *   호스트가 막으면 끝 → closeAppWebView() → (이 방만) 돌아갈 주소를 받았으면 그리로 → 창 닫기 → 안 닫히면 온 곳으로.
    * 웹은 새 창으로 열리므로 창이 닫힌다. 예전에는 같은 출처에서 왔으면 history.back() 부터 했는데, 새 창에는 돌아갈
    * 기록이 없어 눌러도 아무 일이 없었다(OX 방이 먼저 겪음). 스크립트가 연 창이 아니면(주소를 직접 연 탭 · 링크로 들어온
    * 같은 탭 · 앱 웹뷰) 브라우저가 닫아 주지 않는다 — 그때만 예전처럼 온 곳으로 돌아간다.
    */
  function leaveGame() {
    // 호스트가 막으면 거기서 끝. 우리가 임의로 움직이지 않는다.
    if (!emitNavigation("close", {}, { cancelable: true })) return;

    closeAppWebView();

    const target = Rules.resolveCloseTarget({
      closeUrlParam: readCloseUrlParam(),
      configCloseUrl: gameConfig.deployment?.closeUrl,
      referrer: document.referrer,
      here: window.location.href,
    });

    // 돌아갈 주소를 받았으면(close_url · 설정값) 그리로 간다(사장님 지시 2026-09-30).
    if (target.action === "navigate") {
      window.location.assign(target.url);
      return;
    }
    window.close();
    if (window.closed) return;
    if (target.action === "back") {
      window.history.back();
      return;
    }
    // 마지막 수단까지 왔다. 닫히지도 않고 돌아갈 곳도 없을 때 안내를 띄우지 말라는 것이 사장님 지시다(2026-09-30).
    // 그래서 여기서 끝이다 — 아무 데도 못 갔을 때 X 는 눈에 보이는 반응이 없다. 지시의 결과이지 결함이 아니다.
  }

  function fitStage() {
    const scale = Math.min(
      window.innerWidth / STAGE_WIDTH,
      window.innerHeight / STAGE_HEIGHT,
    );
    elements.stage.style.setProperty("--stage-scale", String(scale));
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.statusToast.textContent = message;
    elements.statusToast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      elements.statusToast.classList.remove("is-visible");
      toastTimer = 0;
    }, 1_800);
  }

  function pressControl(button) {
    button.classList.add("is-pressed");
    window.setTimeout(() => button.classList.remove("is-pressed"), 160);
  }

  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  // 검수표 r7: 게임에 나오는 영어 단어는 모두 소문자로 보여 준다.
  function formatEnglishLabel(value) {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
  }

  /* ---------------- 소리 ---------------- */

  function stopEffectAudios() {
    activeEffectAudios.forEach((audio) => {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // 메타데이터 로드 전 currentTime 변경을 막는 브라우저가 있다.
      }
    });
    activeEffectAudios.clear();
  }

  /*
   * 효과음 풀. 소리마다 Audio 요소를 몇 개만 만들어 돌려쓴다. 차선을 바꾸거나 줄이
   * 나올 때마다 new Audio() 를 만들면 브라우저에 미디어 요소가 쌓여 시간이 갈수록
   * 프레임이 떨어질 수 있다(사용자 보고 2026-09-04).
   */
  const SOUND_POOL_SIZE = 6;
  const soundPools = new Map();

  function pooledAudio(soundUrl) {
    let pool = soundPools.get(soundUrl);
    if (!pool) {
      pool = { items: [], next: 0 };
      soundPools.set(soundUrl, pool);
    }
    const idle = pool.items.find((audio) => audio.paused || audio.ended);
    if (idle) return idle;
    if (pool.items.length < SOUND_POOL_SIZE) {
      const audio = new Audio(soundUrl);
      audio.preload = "auto";
      // 요소를 만들 때 한 번만 건다. 재생마다 걸면 끝나지 않은 리스너가 쌓인다(검수 확정 2026-09-04).
      const release = () => activeEffectAudios.delete(audio);
      audio.addEventListener("ended", release);
      audio.addEventListener("pause", release);
      audio.addEventListener("error", release);
      pool.items.push(audio);
      return audio;
    }
    const audio = pool.items[pool.next % pool.items.length];
    pool.next += 1;
    return audio;
  }

  function playAudioSource(source, volume = 1) {
    const soundUrl = String(source || "").trim();
    if (!soundEnabled || !soundUrl) return null;

    const audio = pooledAudio(soundUrl);
    audio.volume = Math.max(0, Math.min(1, volume));
    try {
      audio.currentTime = 0;
    } catch {
      // 메타데이터 로드 전 currentTime 변경을 막는 브라우저가 있다.
    }
    activeEffectAudios.add(audio);
    audio.play()?.catch(() => activeEffectAudios.delete(audio));
    return audio;
  }

  function playSound(name, volume) {
    return playAudioSource(SOUND_ASSETS[name], volume);
  }

  /*
   * 단어 발음. 문제가 배너에 나타날 때 그 단어의 sound_url(영어 발음)을 들려준다.
   * 주소가 있으면 회원 여부와 무관하게 재생하고, 미리 받아 두어 첫 재생이 늦지 않게 한다.
   */
  const wordAudioCache = new Map();
  let activeWordAudio = null;

  function wordAudioFor(soundUrl) {
    const url = String(soundUrl || "").trim();
    if (!url) return null;
    let audio = wordAudioCache.get(url);
    if (!audio) {
      audio = new Audio(url);
      audio.preload = "auto";
      wordAudioCache.set(url, audio);
      if (wordAudioCache.size > 48) {
        wordAudioCache.delete(wordAudioCache.keys().next().value);
      }
    }
    return audio;
  }

  function stopWordAudio() {
    if (!activeWordAudio) return;
    activeWordAudio.pause();
    try {
      activeWordAudio.currentTime = 0;
    } catch {
      // 메타데이터 로드 전 currentTime 변경을 막는 브라우저가 있다.
    }
    activeWordAudio = null;
  }

  function playWordAudio(soundUrl) {
    if (!soundEnabled) return false;
    const audio = wordAudioFor(soundUrl);
    if (!audio) return false;
    stopWordAudio();
    activeWordAudio = audio;
    try {
      audio.currentTime = 0;
    } catch {
      // 위와 같다.
    }
    audio.play()?.catch(() => {
      if (activeWordAudio === audio) activeWordAudio = null;
    });
    return true;
  }

  function prefetchWordAudio(list) {
    list.forEach((word) => wordAudioFor(word.soundUrl));
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
    /*
     * 공통 9-3: 멈추는 곳이 아니라 "다시 트는 곳"을 막아야 한다.
     * 이 방에는 자동재생이 거부되면 문서 전체에 1회용 제스처 리스너가 다시 걸리는 길이 있고,
     * 그 리스너가 부르는 armBgm() 은 bgmWanted 를 스스로 true 로 되돌린다.
     * 그래서 결과화면 조건을 여기 한 곳에 둔다 — 제스처·소리 토글·탭 복귀가 모두 이 문을 지난다.
     */
    if (!soundEnabled || !bgmWanted || currentScreen === "result") return;
    // 활성화가 없어 거부되면(터치 첫 조작 등) 다음 제스처에 다시 시도한다.
    ensureBgm().play()?.catch(() => armBgmOnGesture());
  }

  /*
   * 브라우저는 사용자가 한 번 누르기 전에는 소리를 내주지 않는다. 첫 조작 때
   * 배경음을 틀고, 그때 음소거였다면 "틀고 싶다"만 기억했다가 켜는 순간 이어 간다.
   * 터치 기기의 pointerdown 은 사용자 활성화로 인정되지 않아 play() 가 거부된다(검수 확정
   * 2026-09-04). 그래서 pointerup·click·touchend·keydown 에 걸고, 거부되면 다음 제스처에 다시 건다.
   */
  const BGM_GESTURE_EVENTS = Object.freeze(["pointerup", "click", "touchend", "keydown"]);
  let bgmGestureHandler = null;

  function armBgmOnGesture() {
    if (bgmGestureHandler) return;
    const handler = () => {
      /*
       * 결과화면에서는 아무것도 하지 않고 돌아간다(공통 9-3 부작용).
       * 여기서 리스너를 떼면 배경음은 어차피 가드에 막히는데 손잡이만 버려서,
       * 시작 화면으로 돌아간 뒤 첫 누름에 배경음이 나지 않는다.
       */
      if (currentScreen === "result") return;
      BGM_GESTURE_EVENTS.forEach((type) => document.removeEventListener(type, handler, true));
      bgmGestureHandler = null;
      armBgm();
    };
    bgmGestureHandler = handler;
    BGM_GESTURE_EVENTS.forEach((type) => {
      document.addEventListener(type, handler, { capture: true, passive: true });
    });
  }

  function armBgm() {
    bgmWanted = true;
    resumeBgm();
  }

  function pauseBgm() {
    if (bgmAudio) bgmAudio.pause();
  }

  function isLoggedInMember() {
    return Boolean(launchContext && !launchContext.isGuest && !launchContext.isDemo);
  }

  function updateSoundUI() {
    elements.soundIcon.src = soundEnabled
      ? "asset/btn_sound_on.png"
      : "asset/btn_sound_off.png";
    elements.soundButton.setAttribute("aria-pressed", String(soundEnabled));
    elements.soundButton.setAttribute("aria-label", soundEnabled ? "소리 끄기" : "소리 켜기");
  }

  /* ---------------- 화면 전환 ---------------- */

  /*
   * 시작 화면 Ranking 은 로그인한 회원만 쓸 수 있다. 로그인하지 않은 게스트(fu_id 없음 — 데모 포함)에게는 버튼을
   * 꺼서 딤 처리한다(2026-10-01 사용자 지시 "이전에 작업한 프로젝트 확인해서 동일하게" — 축구와 같은 방식:
   * 비활성 버튼은 .start-menu-button:disabled 로 흐려지고 광택이 없으며, 이름은 "랭킹, 로그인 필요").
   * 예전에는 살아 있다가 누르면 "로그인이 필요합니다" 안내를 띄웠다.
   */
  function setStartRankingEnabled(enabled) {
    const button = elements.startRankingButton;
    const loginRequired = Boolean(launchContext) && !isLoggedInMember();
    button.disabled = !enabled || !isLoggedInMember();
    if (loginRequired) button.setAttribute("aria-label", "랭킹, 로그인 필요");
    else button.removeAttribute("aria-label");
  }

  function setStartReady(ready) {
    elements.startButton.disabled = !ready;
    elements.startButton.setAttribute("aria-busy", String(!ready));
    setStartRankingEnabled(ready);
    elements.helpButton.disabled = !ready;
  }

  /*
    * 2차 검수 공통-9(사장님 2026-10-12): 시작 화면 로고와 버튼 사이에 동화 정보를 보여 준다.
    * 글자는 info API(GET /game/voca/info)의 title(시리즈) · subtitle(동화 제목)이다. 서버 글자는 textContent 로만 넣는다.
    * 둘이 같은 글자면 한 줄만, 둘 다 없으면(데모 · 테스트 · info 요청 실패) 통째로 감춘다 — 값을 지어 넣지 않는다.
    */
  const STORY_MIN_SCALE = 0.5;

  function cleanStoryText(value) {
    return typeof value === "string" || typeof value === "number"
      ? String(value).replace(/\s+/g, " ").trim()
      : "";
  }

  function readStoryInfo(info) {
    const title = cleanStoryText(info?.title);
    const subtitle = cleanStoryText(info?.subtitle);
    // 시리즈 없이 한 편짜리인 동화는 두 값이 같은 글자로 온다. 그때는 동화 제목 한 줄만 보인다.
    const same = title.toLocaleLowerCase("en-US") === subtitle.toLocaleLowerCase("en-US");
    return { title: same ? "" : title, subtitle };
  }

  // 긴 제목은 자르지 않고 두 줄을 같은 배율로 줄인다(기준 크기 40px 에 곱한다). 넘친 비율만큼 한 번에 줄이고,
  // 바닥(0.5배, 20px)에서도 넘치면 그때만 CSS 말줄임이 받는다. 화면에 보일 때만 잴 수 있다.
  // 폭은 정수로만 읽혀서, 딱 맞게 줄이면 소수점만큼 넘쳐 말줄임이 걸린다(실측: 0.553배에서 "Collecti…").
  // 그래서 자리보다 STORY_FIT_SLACK px 좁게 맞춘다.
  const STORY_FIT_SLACK = 2;

  function fitStartStory() {
    const box = elements.startStory;
    if (!box || box.hidden) return;
    box.style.setProperty("--story-scale", "1");
    const lines = [elements.startStoryTitle, elements.startStorySubtitle].filter((line) => line && !line.hidden);
    let scale = 1;
    for (let guard = 0; guard < 6 && scale > STORY_MIN_SCALE; guard += 1) {
      const worst = lines.reduce((ratio, line) => (
        line.clientWidth > 0 && line.scrollWidth > line.clientWidth
          ? Math.min(ratio, (line.clientWidth - STORY_FIT_SLACK) / line.scrollWidth)
          : ratio
      ), 1);
      if (worst >= 1) break;
      scale = Math.max(STORY_MIN_SCALE, Math.min(scale - 0.01, scale * worst));
      box.style.setProperty("--story-scale", scale.toFixed(3));
    }
  }

  function renderStartStory() {
    const box = elements.startStory;
    if (!box) return;
    elements.startStoryTitle.textContent = storyInfo.title;
    elements.startStorySubtitle.textContent = storyInfo.subtitle;
    elements.startStoryTitle.hidden = !storyInfo.title;
    elements.startStorySubtitle.hidden = !storyInfo.subtitle;
    box.hidden = !storyInfo.title && !storyInfo.subtitle;
    fitStartStory();
    // 글꼴이 늦게 오면 대체 글꼴 폭으로 맞춰진다. 다 받은 뒤 한 번 더 맞춘다.
    document.fonts?.ready?.then(fitStartStory);
  }

  function setScreen(screen) {
    currentScreen = screen;
    elements.stage.dataset.screen = screen;
    elements.stage.classList.remove(
      "screen-loading",
      "screen-start",
      "screen-help",
      "screen-play",
      "screen-result",
    );
    elements.stage.classList.add(`screen-${screen}`);

    elements.startScreen.hidden = screen !== "start";
    elements.helpScreen.hidden = screen !== "help";
    elements.playScreen.hidden = screen !== "play" && screen !== "result";

    const resultVisible = screen === "result";
    elements.endScreen.classList.toggle("is-visible", resultVisible);
    elements.endScreen.setAttribute("aria-hidden", String(!resultVisible));
    elements.stage.classList.toggle("result-mode", resultVisible);

    /*
      * 공통 9항: 결과화면에서는 소리 설정과 상관없이 배경음을 멈춘다.
      * soundEnabled 같은 설정 값은 건드리지 않으므로 시작 화면으로 가면 원래대로 다시 난다.
      * 효과음은 대상이 아니다.
      */
    if (resultVisible) {
      // 소리 설정 값(soundEnabled)은 건드리지 않고 "배경음을 원하는 상태"만 내린다.
      bgmWantedBeforeResult = bgmWanted;
      bgmWanted = false;
      pauseBgm();
    } else {
      if (bgmWantedBeforeResult !== null) {
        bgmWanted = bgmWantedBeforeResult;
        bgmWantedBeforeResult = null;
      }
      resumeBgm();
    }

    const controlsVisible = screen === "start" || screen === "help" || screen === "play";
    /*
     * 2차 수정(사장님 2026-10-01, 공통 기준): 도움말 화면에서만 X 대신 주황 뒤로가기(←)를 쓰고
     * 그 버튼을 스피커 자리(왼쪽 위)로 옮긴다. 도움말 화면에서는 스피커를 숨긴다.
     * 시작·게임 화면은 그대로 X 다(검수표 r12). 자리는 CSS 의 help-mode 가 정한다.
     */
    const helpVisible = screen === "help";
    elements.soundButton.hidden = !controlsVisible || helpVisible;
    elements.navigationButton.hidden = !controlsVisible;
    elements.stage.classList.toggle("help-mode", helpVisible);

    const closesGame = screen === "start";
    elements.navigationIcon.src = helpVisible ? "asset/btn_back.png" : "asset/btn_close.png";
    elements.navigationButton.setAttribute(
      "aria-label",
      closesGame
        ? "게임 닫기"
        : helpVisible ? "뒤로 가기" : "시작 화면으로 돌아가기",
    );
  }

  function clearResultParticles() {
    if (resultParticleFrame) {
      cancelAnimationFrame(resultParticleFrame);
    }
    resultParticleFrame = 0;
    resultParticles = [];
    const context = elements.resultParticleCanvas?.getContext("2d");
    context?.clearRect(0, 0, 1920, 1080);
  }

  function emitResultConfetti() {
    clearResultParticles();
    const context = elements.resultParticleCanvas?.getContext("2d", { alpha: true });
    if (!context) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const particleCount = reducedMotion ? 28 : 96;
    const startedAt = performance.now();
    resultParticles = Array.from({ length: particleCount }, (_, index) => ({
      x: randomBetween(18, 1902),
      y: randomBetween(-320, 40),
      vx: randomBetween(-0.75, 0.75),
      vy: randomBetween(2.4, 4.8),
      gravity: randomBetween(0.004, 0.012),
      sway: randomBetween(0.18, 0.75),
      phase: randomBetween(0, Math.PI * 2),
      width: randomBetween(8, 17),
      height: randomBetween(16, 31),
      rotation: randomBetween(0, Math.PI * 2),
      spin: randomBetween(-0.11, 0.11),
      color: PARTICLE_COLORS[index % PARTICLE_COLORS.length],
      duration: randomBetween(4_800, 6_800),
      delay: randomBetween(0, 1_300),
    }));

    function renderParticles(now) {
      const elapsed = now - startedAt;
      context.clearRect(0, 0, 1920, 1080);
      let activeCount = 0;

      resultParticles.forEach((particle) => {
        const age = elapsed - particle.delay;
        if (age < 0 || age >= particle.duration) return;
        activeCount += 1;
        const frames = age / 16.667;
        const progress = age / particle.duration;
        const x = particle.x + particle.vx * frames + Math.sin(particle.phase + age * 0.006) * particle.sway * 18;
        const y = particle.y + particle.vy * frames + particle.gravity * frames * frames;

        context.save();
        context.globalAlpha = Math.min(1, (1 - progress) * 1.5);
        context.translate(x, y);
        context.rotate(particle.rotation + particle.spin * frames);
        context.fillStyle = particle.color;
        context.fillRect(
          -particle.width / 2,
          -particle.height / 2,
          particle.width,
          particle.height,
        );
        context.restore();
      });

      if (activeCount > 0 || elapsed < 1_300) {
        resultParticleFrame = requestAnimationFrame(renderParticles);
      } else {
        resultParticleFrame = 0;
      }
    }

    resultParticleFrame = requestAnimationFrame(renderParticles);
  }

  function showLoading(title, message, { error = false, retry = false } = {}) {
    elements.loadingTitle.textContent = title;
    elements.loadingMessage.textContent = message;
    elements.loadingScreen.classList.toggle("is-error", error);
    elements.loadingScreen.hidden = false;
    elements.retryButton.hidden = !retry;
  }

  function hideLoading() {
    elements.loadingScreen.hidden = true;
    elements.loadingScreen.classList.remove("is-error");
    elements.retryButton.hidden = true;
  }

  /* ---------------- 도움말 ---------------- */

  function setHelpStatus(message, { retry = false } = {}) {
    elements.helpContent.replaceChildren();
    elements.helpStatusMessage.textContent = message;
    elements.helpRetryButton.hidden = !retry;
    elements.helpStatus.hidden = false;
    elements.helpScreen.setAttribute("aria-busy", String(!retry));
  }

  function renderHelpSections(items) {
    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const section = document.createElement("section");
      section.className = "help-section";

      if (item?.title) {
        const title = document.createElement("h3");
        title.className = "help-section-title";
        title.textContent = item.title;
        section.append(title);
      }
      if (item?.content) {
        const content = document.createElement("p");
        content.className = "help-section-content";
        content.textContent = item.content;
        section.append(content);
      }
      fragment.append(section);
    });

    elements.helpContent.replaceChildren(fragment);
    elements.helpStatus.hidden = true;
    elements.helpScreen.setAttribute("aria-busy", "false");
    elements.helpContentViewport.scrollTop = 0;
  }

  async function loadHelp({ retry = false } = {}) {
    const loader = window.WordMatchContent;
    const token = ++helpRequestToken;
    setHelpStatus("도움말을 불러오는 중입니다.");

    try {
      if (!loader || typeof loader.bootstrap !== "function" || typeof loader.getHelp !== "function") {
        throw new Error("도움말 데이터 로더를 사용할 수 없습니다.");
      }
      await loader.bootstrap();
      const items = await loader.getHelp({ retry });
      if (token !== helpRequestToken || currentScreen !== "help") return;
      if (!Array.isArray(items) || items.length === 0) {
        setHelpStatus("표시할 도움말이 없습니다.", { retry: true });
        return;
      }
      renderHelpSections(items);
    } catch {
      if (token !== helpRequestToken || currentScreen !== "help") return;
      setHelpStatus("도움말을 불러오지 못했습니다.", { retry: true });
    }
  }

  function openHelp() {
    if (currentScreen !== "start") return;
    helpReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : elements.helpButton;
    startRankingRequestToken += 1;
    closeResultDialog({ restoreFocus: false });
    closeCarSelect({ restoreFocus: false });
    setScreen("help");
    emitNavigation("help");
    elements.navigationButton.focus({ preventScroll: true });
    void loadHelp();
  }

  function closeHelp({ restoreFocus = true } = {}) {
    if (currentScreen !== "help") return;
    helpRequestToken += 1;
    const returnFocus = helpReturnFocus;
    helpReturnFocus = null;
    setStartReady(words.length > 0);
    setScreen("start");
    emitNavigation("help-close");
    if (restoreFocus) {
      const target = returnFocus
        && document.contains(returnFocus)
        && !returnFocus.disabled
        && returnFocus.getClientRects().length > 0
        ? returnFocus
        : elements.helpButton;
      target.focus({ preventScroll: true });
    }
  }

  /* ---------------- 오답노트 ---------------- */

  function stopIncorrectAudio() {
    if (!activeIncorrectAudio) return;
    activeIncorrectAudio.pause();
    try {
      activeIncorrectAudio.currentTime = 0;
    } catch {
      // 일부 브라우저는 메타데이터 로드 전 currentTime 변경을 허용하지 않는다.
    }
    activeIncorrectAudio = null;
  }

  function playIncorrectAudio(source) {
    const soundUrl = String(source || "").trim();
    if (!soundUrl) return;
    // 2차 수정(PDF 4쪽, 공통 기준): 소리를 꺼도 오답노트 단어 발음은 난다. 아이가 직접 누른 것이라서다.
    // 예전엔 소리가 꺼져 있으면 "Sound Off" 안내만 띄우고 돌아갔다.
    stopIncorrectAudio();
    const audio = new Audio(soundUrl);
    activeIncorrectAudio = audio;
    audio.addEventListener("ended", () => {
      if (activeIncorrectAudio === audio) activeIncorrectAudio = null;
    }, { once: true });
    audio.addEventListener("error", () => {
      if (activeIncorrectAudio !== audio) return;
      activeIncorrectAudio = null;
      elements.status.textContent = "발음을 재생할 수 없습니다.";
    }, { once: true });
    const playback = audio.play();
    playback?.catch((error) => {
      if (activeIncorrectAudio !== audio) return;
      activeIncorrectAudio = null;
      if (error?.name === "AbortError") return;
      elements.status.textContent = "발음을 재생할 수 없습니다.";
    });
  }

  function questionKey(english) {
    return String(english || "").trim().toLocaleLowerCase("en-US");
  }

  function incorrectAnswerNotes() {
    return Rules.buildIncorrectNotes({
      presented: [...presentedQuestions.values()],
      correctKeys: [...correctQuestionKeys],
      wrongCounts: Object.fromEntries(wrongAnswerCounts),
      presentCounts: Object.fromEntries(presentedTimes),
      correctCounts: Object.fromEntries(correctTimes),
    });
  }

  function updateIncorrectAnswersButton() {
    const notes = incorrectAnswerNotes();
    elements.incorrectAnswersButton.disabled = notes.length === 0;
    // 공통 9항: 누를 수 없는 버튼은 회색으로 두지 않고 자리까지 없앤다.
    elements.incorrectAnswersButton.hidden = notes.length === 0;
    elements.incorrectAnswersButton.setAttribute(
      "aria-label",
      notes.length > 0 ? `오답 보기, ${notes.length}개 단어` : "오답 없음",
    );
  }

  // 문제 줄이 내려오기 시작하면 출제로 센다. 판정이 없어도 오답노트에 남는다(q58).
  function recordPresentedQuestion(question) {
    const key = questionKey(question?.english);
    if (!key || presentedQuestions.has(key)) return;
    presentedQuestions.set(key, {
      english: String(question?.english || "").trim(),
      meaning: String(question?.meaning || "").trim(),
      soundUrl: String(question?.soundUrl || "").trim(),
    });
    updateIncorrectAnswersButton();
  }

  // 2차 A-4: 문제 줄이 내려올 때마다 그 단어가 나온 횟수를 센다(presentedQuestionCount 와 같은 자리).
  function countPresentation(question) {
    const key = questionKey(question?.english);
    if (!key) return;
    presentedTimes.set(key, (presentedTimes.get(key) || 0) + 1);
  }

  function recordCorrectAnswer(question) {
    const key = questionKey(question?.english);
    if (!key) return;
    correctQuestionKeys.add(key);
    correctTimes.set(key, (correctTimes.get(key) || 0) + 1);
    updateIncorrectAnswersButton();
  }

  /*
    * 그냥 지나친 것은 "아직 못 맞힌 것"으로만 센다. 오답노트에 담을지는 buildIncorrectNotes 가
    * 정한다 — 나온 횟수가 맞힌 횟수보다 많으면 담는다(2차 A-4). 앞에서 맞힌 단어라도 뒤 바퀴에서 지나치면 담긴다.
    */
  function recordMissedQuestion(question) {
    const key = questionKey(question?.english);
    if (!key) return;
    recordPresentedQuestion(question);
    updateIncorrectAnswersButton();
  }

  function recordIncorrectAnswer(entry) {
    const key = questionKey(entry?.english);
    if (!key) return;
    recordPresentedQuestion(entry);
    wrongAnswerCounts.set(key, (wrongAnswerCounts.get(key) || 0) + 1);
    updateIncorrectAnswersButton();
  }

  function createIncorrectAnswerCell(className) {
    const cell = document.createElement("div");
    cell.className = `incorrect-answer-cell ${className}`;
    cell.setAttribute("role", "cell");
    return cell;
  }

  function fitIncorrectWordText(element) {
    const cell = element.closest(".incorrect-answer-word");
    if (!cell) return;
    const maximumSize = 27;
    const minimumSize = 20;
    cell.style.setProperty("--incorrect-word-scale", "1");
    for (let size = maximumSize; size > minimumSize && element.scrollWidth > element.clientWidth; size -= 1) {
      cell.style.setProperty("--incorrect-word-scale", String((size - 1) / maximumSize));
    }
    // 긴 단어(2026-10-01 거름 해제): 그래도 넘치면 자르지 않고 맞을 때까지 넘친 비율만큼 더 줄인다.
    let scale = Number(cell.style.getPropertyValue("--incorrect-word-scale")) || 1;
    for (let guard = 0; guard < 20 && scale > 0.1 && element.scrollWidth > element.clientWidth + 1; guard += 1) {
      scale = Math.max(0.1, Math.min(scale - 0.01, scale * (element.clientWidth / element.scrollWidth)));
      cell.style.setProperty("--incorrect-word-scale", scale.toFixed(3));
    }
  }

  function renderIncorrectAnswerList() {
    elements.incorrectAnswerList.replaceChildren();
    const records = incorrectAnswerNotes();

    if (records.length === 0) {
      const empty = document.createElement("p");
      empty.className = "incorrect-answer-empty";
      empty.textContent = "오답이 없습니다.";
      elements.incorrectAnswerList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    records.forEach((record) => {
      const row = document.createElement("div");
      row.className = "incorrect-answer-row incorrect-answer-grid";
      row.setAttribute("role", "row");

      const audioCell = createIncorrectAnswerCell("incorrect-answer-audio");
      const speakerButton = document.createElement("button");
      speakerButton.className = "incorrect-answer-speaker";
      speakerButton.type = "button";
      speakerButton.disabled = !record.soundUrl;
      speakerButton.setAttribute(
        "aria-label",
        record.soundUrl
          ? `${record.english} 발음 듣기`
          : `${record.english} 발음 없음`,
      );
      const speakerIcon = document.createElement("img");
      speakerIcon.src = "asset/incorrect-answer/icon_speaker.png";
      speakerIcon.alt = "";
      speakerIcon.width = 37;
      speakerIcon.height = 30;
      speakerIcon.draggable = false;
      speakerButton.append(speakerIcon);
      speakerButton.addEventListener("click", () => playIncorrectAudio(record.soundUrl));
      audioCell.append(speakerButton);

      const wordCell = createIncorrectAnswerCell("incorrect-answer-word");
      const wordText = document.createElement("span");
      wordText.className = "incorrect-answer-word-text";
      wordText.textContent = formatEnglishLabel(record.english);
      wordCell.append(wordText);

      const meaningCell = createIncorrectAnswerCell("incorrect-answer-meaning");
      meaningCell.textContent = record.meaning || "정답 뜻 확인 필요";

      row.append(audioCell, wordCell, meaningCell);
      fragment.append(row);
    });

    elements.incorrectAnswerList.append(fragment);
    elements.incorrectAnswerList.scrollTop = 0;
    const fitWords = () => elements.incorrectAnswerList
      .querySelectorAll(".incorrect-answer-word-text")
      .forEach(fitIncorrectWordText);
    requestAnimationFrame(() => {
      fitWords();
      // 단어 글꼴(Lexend 600)은 이 창에서 처음 쓰여 그때 받기 시작한다. 받기 전에는 대체 글꼴 폭으로 맞춰져
      // 받은 뒤 넘친다(2026-10-01 실측: 43자 구문이 0.85 에서 멈춘 채 넘침). 다 받으면 다시 맞춘다.
      document.fonts?.ready?.then(fitWords);
    });
  }

  function closeIncorrectAnswerDialog({ restoreFocus = true } = {}) {
    if (elements.incorrectAnswerDialog.hidden) return;
    const returnFocus = incorrectDialogReturnFocus;
    incorrectDialogReturnFocus = null;
    stopIncorrectAudio();
    elements.incorrectAnswerDialog.hidden = true;
    if (restoreFocus) {
      const target = returnFocus
        && document.contains(returnFocus)
        && !returnFocus.disabled
        && returnFocus.getClientRects().length > 0
        ? returnFocus
        : elements.tryAgainButton;
      target.focus({ preventScroll: true });
    }
  }

  function openIncorrectAnswerDialog() {
    if (incorrectAnswerNotes().length === 0) return;
    resultDialogRequestToken += 1;
    closeResultDialog({ restoreFocus: false });
    incorrectDialogReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : elements.incorrectAnswersButton;
    renderIncorrectAnswerList();
    elements.incorrectAnswerDialog.hidden = false;
    playSound("open", 0.7);
    requestAnimationFrame(() => {
      if (elements.incorrectAnswerDialog.hidden) return;
      elements.incorrectAnswerClose.focus({ preventScroll: true });
    });
  }

  function trapDialogFocus(root, event) {
    const focusable = Array.from(root.querySelectorAll(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (!root.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ---------------- 랭킹 ---------------- */

  function closeResultDialog({ restoreFocus = true } = {}) {
    if (elements.resultDialog.hidden) return;
    const returnFocus = resultDialogReturnFocus;
    resultDialogReturnFocus = null;
    elements.resultDialog.hidden = true;
    if (restoreFocus) {
      const fallback = currentScreen === "start"
        ? elements.startButton
        : elements.tryAgainButton;
      const target = returnFocus
        && document.contains(returnFocus)
        && !returnFocus.disabled
        && returnFocus.getClientRects().length > 0
        ? returnFocus
        : fallback;
      target.focus({ preventScroll: true });
    }
  }

  function setRankingMyBadge(source) {
    const imageSource = String(source ?? "").trim();
    elements.rankingMyBadgeImage.hidden = true;
    elements.rankingMyBadgeFallback.hidden = false;
    elements.rankingMyBadgeImage.dataset.source = imageSource;

    if (!imageSource) {
      elements.rankingMyBadgeImage.removeAttribute("src");
      return;
    }

    elements.rankingMyBadgeImage.onload = () => {
      if (elements.rankingMyBadgeImage.dataset.source !== imageSource) return;
      elements.rankingMyBadgeFallback.hidden = true;
      elements.rankingMyBadgeImage.hidden = false;
    };
    elements.rankingMyBadgeImage.onerror = () => {
      if (elements.rankingMyBadgeImage.dataset.source !== imageSource) return;
      elements.rankingMyBadgeImage.hidden = true;
      elements.rankingMyBadgeFallback.hidden = false;
    };
    elements.rankingMyBadgeImage.src = imageSource;
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
    fallback.textContent = rank <= 3 ? "O" : "•";
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

  function renderRankingDialog(ranking) {
    elements.rankingMyName.textContent = String(ranking?.nickname ?? "").trim() || "회원";
    elements.rankingMyScore.textContent = formatScore(ranking?.best_score);
    setRankingMyBadge(ranking?.badge_image);
    elements.resultDialogContent.replaceChildren();

    const entries = Array.isArray(ranking?.rankings)
      ? ranking.rankings.slice(0, 20)
      : [];
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "ranking-empty";
      empty.textContent = "표시할 랭킹이 없습니다.";
      elements.resultDialogContent.append(empty);
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
        createRankingCell("ranking-row-name", String(entry?.nickname ?? "").trim() || "-"),
        createRankingCell("ranking-row-score", formatScore(entry?.best_score)),
      );
      fragment.append(row);
    });
    elements.resultDialogContent.append(fragment);
    elements.resultDialogContent.scrollTop = 0;
  }

  function openRankingDialog(ranking, returnFocus) {
    closeIncorrectAnswerDialog({ restoreFocus: false });
    resultDialogReturnFocus = returnFocus
      || (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      || (currentScreen === "start" ? elements.startButton : elements.tryAgainButton);
    renderRankingDialog(ranking);
    elements.resultDialog.hidden = false;
    playSound("open", 0.7);
    elements.resultDialogClose.focus({ preventScroll: true });
  }

  async function showStartRanking() {
    if (currentScreen !== "start" || elements.startRankingButton.disabled) return;
    pressControl(elements.startRankingButton);
    if (launchContext?.isGuest) {
      emitNavigation("ranking-blocked", { reason: "guest" });
      showToast("로그인이 필요합니다.");
      return;
    }
    if (launchContext?.isDemo) {
      emitNavigation("ranking-blocked", { reason: "demo" });
      showToast("데모 모드에서는 랭킹을 볼 수 없습니다.");
      return;
    }

    const token = ++startRankingRequestToken;
    elements.startRankingButton.disabled = true;
    // 검수 4차 q49: 랭킹을 부르는 동안 안내 문구를 띄우지 않는다(워드매치 6방 공통).
    try {
      const ranking = await window.WordMatchContent.getRanking();
      if (token !== startRankingRequestToken || currentScreen !== "start") return;
      openRankingDialog(ranking, elements.startRankingButton);
      emitNavigation("ranking", { ranking });
    } catch (error) {
      if (token !== startRankingRequestToken || currentScreen !== "start") return;
      showToast(`랭킹을 불러오지 못했습니다: ${error?.message || "연결 오류"}`);
    } finally {
      if (token === startRankingRequestToken && currentScreen === "start") {
        setStartRankingEnabled(true);
      }
    }
  }

  /* ---------------- 결과 ---------------- */

  // Rules.resultTier 가 돌려주는 등급 번호. 0 Excellent · 1 Good · 2 Try Again.
  const RESULT_TIER_TRY_AGAIN = 2;

  function getResultTitleAsset() {
    const scoreState = state.scoreboard ? state.scoreboard.getState() : null;
    // 분모는 판에 내려온 문제 수다. 손도 못 댄 문제까지 들어간다(사장님 지시 2026-09-29).
    const tier = Rules.resultTier(scoreState ? scoreState.correctCount : 0, presentedQuestionCount);
    // tier 도 함께 돌려준다. 여기서 펼치는 순간 얼려 둔 원본과 === 가 성립하지 않으므로,
    // 받는 쪽이 객체 동일성으로 등급을 알아내려 하면 소리 없이 틀린다(실제로 그랬다).
    if (tier === 0) return { ...RESULT_TITLE_ASSETS.excellent, fox: RESULT_FOX_ASSETS.excellent, tier };
    if (tier === 1) return { ...RESULT_TITLE_ASSETS.good, fox: RESULT_FOX_ASSETS.good, tier };
    return { ...RESULT_TITLE_ASSETS.tryAgain, fox: RESULT_FOX_ASSETS.tryAgain, tier };
  }

  function renderResultRankAndScore(rank, score) {
    const normalizedRank = Math.trunc(Number(rank) || 0);
    const scoreText = formatScore(score);
    elements.resultRank.textContent = normalizedRank > 0 ? `${formatScore(normalizedRank)}위` : "-";
    elements.resultScoreNumber.textContent = scoreText;
    elements.resultTotalScore.setAttribute("aria-label", `${scoreText}점`);
  }

  function renderResultBreakdown() {
    const scoreState = state.scoreboard.getState();
    const titleAsset = getResultTitleAsset();
    elements.resultTitle.src = titleAsset.src;
    elements.resultTitle.alt = titleAsset.alt;
    elements.resultFoxImage.src = titleAsset.fox;
    /*
      * Correct · Incorrect 는 점수 합이 아니라 개수다(사장님 2026-09-29).
      *   Correct   — 맞힌 회수.
      *   Incorrect — 못 맞힌 단어 수. 같은 단어를 여러 번 놓쳐도 하나로 센다(2차 검수 공통-10, 사장님 2026-10-12
      *               "Incorrect 지금 그대로 중복일경우 하나만 적용되게 중복허용 안함"). 오답노트(Incorrect Answers)에
      *               실리는 바로 그 목록을 세므로 이 숫자와 목록 줄 수는 늘 같다.
      * 그 전에는 Incorrect 가 출제 회수 − 맞힌 회수라, 같은 단어를 두 번 놓치면 2 였고 목록은 한 줄이었다.
      * 등급(Excellent · Good · Try Again)은 이 변경으로 바꾸지 않았다 — 분모는 여전히 판에 내려온 문제 수다
      * (getResultTitleAsset). 그래서 같은 단어를 여러 번 놓친 판에서는 Correct + Incorrect 가 내려온 문제 수보다 작다.
      * 장애물 충돌은 단어가 아니라 개수에 넣지 않는다(점수에는 그대로 감점된다).
      */
    const correctWordCount = Math.max(0, scoreState.correctCount);
    const incorrectWordCount = incorrectAnswerNotes().length;
    // 2차 검수 공통-2(완료화면 통일): 「개」와 Bonus 의 「+」를 붙이지 않는다. Bonus 뒤 「점」은 CSS(.result-points::after)가 그린다.
    elements.resultCorrectPoints.textContent = formatScore(correctWordCount);
    elements.resultIncorrectPoints.textContent = formatScore(incorrectWordCount);
    elements.resultBonusPoints.textContent = formatScore(Math.max(0, scoreState.bonusPoints));
    elements.resultCorrectPoints.setAttribute(
      "aria-label",
      `맞힘 ${formatScore(correctWordCount)}개`,
    );
    elements.resultIncorrectPoints.setAttribute(
      "aria-label",
      `못 맞힌 단어 ${formatScore(incorrectWordCount)}개`,
    );
    elements.resultBonusPoints.setAttribute(
      "aria-label",
      `보너스 점수 ${formatScore(scoreState.bonusPoints)}점`,
    );
    renderResultRankAndScore(0, scoreState.score);
    updateIncorrectAnswersButton();
    const rankingAvailable = isLoggedInMember();
    elements.rankingButton.hidden = !rankingAvailable;
    elements.rankingButton.disabled = true;
    elements.rankingButton.setAttribute(
      "aria-label",
      rankingAvailable
        ? "점수 저장 후 랭킹을 볼 수 있습니다"
        : "게스트 또는 데모 모드에서는 랭킹을 사용할 수 없습니다",
    );
    // 등급 번호로 견준다. 예전에는 얼려 둔 원본과 === 로 견주었는데 위에서 펼친 새 객체라
    // 언제나 거짓이었고, 그래서 Try Again 에서도 환호성이 났다(2026-09-30 고침).
    playSound(titleAsset.tier === RESULT_TIER_TRY_AGAIN ? "lose" : "cheer", 0.9);
  }

  async function persistResult() {
    if (state.historyRequested) return;
    state.historyRequested = true;
    const token = ++state.resultRequestToken;
    const score = state.scoreboard.getState().score;
    elements.resultMessage.textContent = launchContext?.isTest
      ? `${launchContext.testMode === "member" ? "로그인" : "게스트"} 테스트 결과를 확인하고 있습니다.`
      : launchContext?.isDemo
        ? "데모 모드 결과입니다."
        : "점수 결과를 확인하고 있습니다.";

    try {
      const result = await window.WordMatchContent.saveHistory(score);
      if (token !== state.resultRequestToken || !state.ended) return;
      if (result?.skipped) {
        elements.resultMessage.textContent = "데모 모드에서는 점수를 저장하지 않습니다.";
        return;
      }
      renderResultRankAndScore(result?.rank, result?.score ?? score);
      if (launchContext?.isTest) {
        elements.resultMessage.textContent = launchContext.isGuest
          ? "게스트 테스트 결과입니다. 점수는 저장하지 않습니다."
          : "로그인 사용자 테스트 결과입니다. 실제 점수는 저장하지 않습니다.";
      } else if (launchContext?.isGuest) {
        elements.resultMessage.textContent = "게스트 점수는 저장되지 않습니다.";
      } else if (Number(result?.rank) > 0) {
        elements.resultMessage.textContent = "점수와 순위를 저장했습니다.";
      } else {
        elements.resultMessage.textContent = "점수를 저장했습니다. 현재 순위는 20위 밖입니다.";
      }
    } catch (error) {
      if (token !== state.resultRequestToken || !state.ended) return;
      elements.resultMessage.textContent = `점수를 저장하지 못했습니다: ${error?.message || "연결 오류"}`;
    } finally {
      if (token === state.resultRequestToken && state.ended && isLoggedInMember()) {
        elements.rankingButton.disabled = false;
        elements.rankingButton.setAttribute("aria-label", "랭킹 보기");
      }
    }
  }

  async function showRanking() {
    if (elements.rankingButton.disabled) return;
    const token = state.resultRequestToken;
    const dialogToken = ++resultDialogRequestToken;
    elements.rankingButton.disabled = true;
    // 검수 4차 q49: 결과화면에서도 랭킹 로딩 안내 문구를 쓰지 않는다.
    try {
      const ranking = await window.WordMatchContent.getRanking();
      if (
        token !== state.resultRequestToken
        || dialogToken !== resultDialogRequestToken
        || !state.ended
      ) return;
      openRankingDialog(ranking, elements.rankingButton);
      elements.resultMessage.textContent = ranking?.nickname
        ? `${ranking.nickname}님의 최고 점수는 ${formatScore(ranking.best_score)}점입니다.`
        : "랭킹을 불러왔습니다.";
    } catch (error) {
      if (
        token !== state.resultRequestToken
        || dialogToken !== resultDialogRequestToken
        || !state.ended
      ) return;
      elements.resultMessage.textContent = `랭킹을 불러오지 못했습니다: ${error?.message || "연결 오류"}`;
    } finally {
      if (token === state.resultRequestToken && state.ended && isLoggedInMember()) {
        elements.rankingButton.disabled = false;
      }
    }
  }

  /* ---------------- 시계 · 점수 · 콤보 ---------------- */

  function formatTime(milliseconds) {
    return Rules.formatClock(Math.max(0, Math.ceil(milliseconds / 1000)));
  }

  /*
   * 남은 시간 글자. Lexend 숫자는 자리마다 폭이 달라 초가 바뀔 때마다 글자가 좌우로
   * 흔들린다(형제 방에서 겪음). 자리마다 고정 폭 상자에 넣고, 글자가 바뀔 때만 그린다.
   */
  let lastTimeText = "";
  function renderTimeText(text) {
    if (text === lastTimeText) return;
    lastTimeText = text;
    const fragment = document.createDocumentFragment();
    [...text].forEach((character) => {
      const cell = document.createElement("span");
      cell.className = character === ":" ? "time-colon" : "time-digit";
      cell.textContent = character;
      fragment.append(cell);
    });
    elements.time.replaceChildren(fragment);
  }

  // 게이지 바늘. 왼쪽 끝(-90°)이 빈 상태, 오른쪽 끝(+90°)이 가득 찬 상태다.
  function gaugeAngle(ratio) {
    const safe = Math.max(0, Math.min(1, Number(ratio) || 0));
    return -90 + safe * 180;
  }

  let lastRenderedScore = null;
  // 점수판에 지금 보이는 숫자. 보너스 굴림 중에는 최종값과 다르다.
  let shownScore = 0;
  let scoreTween = 0;
  let scoreTweenToken = 0;
  let scoreTweenFallback = 0;

  function writeScoreText(value) {
    shownScore = value;
    elements.score.textContent = formatScore(value);
  }

  // 굴림은 타이머 취소와 번호(scoreTweenToken) 두 겹으로 무효화한다(단어미로와 같다): 재시작 뒤 옛 점수가
  // 되살아나거나 연속 득점에서 숫자가 한 프레임 되돌아가지 않게.
  function cancelScoreTween() {
    scoreTweenToken += 1;
    if (scoreTween) {
      window.cancelAnimationFrame(scoreTween);
      scoreTween = 0;
    }
    window.clearTimeout(scoreTweenFallback);
    scoreTweenFallback = 0;
  }

  /*
   * 보너스 순간 점수 숫자 굴림(2026-10-02, 단어미로 animateScore 와 같은 값): 차이가 클수록 조금 길게,
   * 최대 0.72초, 끝으로 갈수록 느려진다. rAF 가 안 도는 환경(백그라운드 탭)에서도 최종값은 반드시 찍는다.
   * 동작 줄이기에서는 굴리지 않는다.
   */
  function animateScoreNumber(from, to) {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (from === to || reducedMotion) {
      writeScoreText(to);
      return;
    }
    const token = scoreTweenToken;
    const startedAt = Date.now();
    const span = Math.min(720, 280 + Math.abs(to - from) * 2);
    scoreTweenFallback = window.setTimeout(() => {
      if (token !== scoreTweenToken) return;
      if (scoreTween) window.cancelAnimationFrame(scoreTween);
      scoreTween = 0;
      writeScoreText(to);
    }, span + 120);
    const step = () => {
      if (token !== scoreTweenToken) return;
      const ratio = Math.min(1, (Date.now() - startedAt) / span);
      const eased = 1 - (1 - ratio) ** 3;
      writeScoreText(from + (to - from) * eased);
      if (ratio < 1) {
        scoreTween = window.requestAnimationFrame(step);
        return;
      }
      writeScoreText(to);
      scoreTween = 0;
      window.clearTimeout(scoreTweenFallback);
      scoreTweenFallback = 0;
    };
    scoreTween = window.requestAnimationFrame(step);
  }

  // roll: 3연속 보너스 순간에는 숫자를 굴려 올리고(단어미로와 같게), 튐은 playScoreBonus 의 금색 튐이 맡는다.
  function renderScore({ roll = false } = {}) {
    const score = state.scoreboard ? state.scoreboard.getState().score : 0;
    const from = shownScore;
    cancelScoreTween();
    elements.score.setAttribute("aria-label", `점수 ${formatScore(score)}`);
    elements.scoreNeedle.style.setProperty("--score-angle", `${gaugeAngle(score / scoreGaugeMax)}deg`);
    if (roll && lastRenderedScore !== null) {
      animateScoreNumber(from, score);
    } else {
      writeScoreText(score);
      // 점수가 오르면 점수판이 한 번 튄다(형제 방과 같은 "점수 추가 효과").
      if (lastRenderedScore !== null && score > lastRenderedScore) {
        elements.score.classList.remove("is-bumping");
        void elements.score.offsetWidth;
        elements.score.classList.add("is-bumping");
      }
    }
    lastRenderedScore = score;
  }

  /*
   * 3연속 보너스 순간 Score 연출(2026-10-02 사용자 지시, 단어미로 playScoreBonus 와 같은 구성):
   * 게이지 둘레 금빛 링, 점수 숫자 금색 튐, 그 위로 떠오르는 "보너스 +100". 1.1초 뒤 걷는다.
   */
  const SCORE_BONUS_EFFECT_MS = 1_100;
  let scoreBonusTimer = 0;

  function playScoreBonus(amount) {
    const bonus = Math.trunc(Number(amount) || 0);
    // 연출 요소가 없는 마크업(옛 index.html 이 캐시에 남은 경우 등)에서도 게임은 계속된다.
    if (bonus <= 0 || !elements.scoreBonusRing || !elements.scoreBonusFloat) return;
    window.clearTimeout(scoreBonusTimer);
    elements.scoreBonusRing.classList.remove("is-visible");
    elements.scoreBonusFloat.classList.remove("is-visible");
    elements.score.classList.remove("is-bonus-punch", "is-bumping");
    // 레이아웃을 한 번 읽어야 같은 클래스를 다시 붙일 때 애니메이션이 처음부터 돈다.
    void elements.scoreBonusRing.offsetWidth;
    elements.scoreBonusFloat.textContent = `보너스 +${formatScore(bonus)}`;
    elements.scoreBonusRing.classList.add("is-visible");
    elements.scoreBonusFloat.classList.add("is-visible");
    elements.score.classList.add("is-bonus-punch");
    scoreBonusTimer = window.setTimeout(endScoreBonus, SCORE_BONUS_EFFECT_MS);
  }

  function endScoreBonus() {
    window.clearTimeout(scoreBonusTimer);
    scoreBonusTimer = 0;
    elements.score.classList.remove("is-bonus-punch");
    if (!elements.scoreBonusRing || !elements.scoreBonusFloat) return;
    elements.scoreBonusRing.classList.remove("is-visible");
    elements.scoreBonusFloat.classList.remove("is-visible");
    elements.scoreBonusFloat.textContent = "";
  }

  function renderTimer(remainingMilliseconds) {
    const ratio = Math.max(0, Math.min(1, remainingMilliseconds / totalDurationMs));
    const remainingSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1000));
    renderTimeText(formatTime(remainingMilliseconds));
    elements.time.setAttribute("aria-label", `남은 시간 ${remainingSeconds}초`);
    elements.timeNeedle.style.setProperty("--time-angle", `${gaugeAngle(ratio)}deg`);
    elements.stage.classList.toggle(
      "timer-urgent",
      remainingMilliseconds > 5_000 && remainingMilliseconds <= 10_000,
    );
    elements.stage.classList.toggle(
      "timer-critical",
      remainingMilliseconds > 0 && remainingMilliseconds <= 5_000,
    );
  }

  // 배너 아래 콤보 알 세 개. 연속 정답이 하나씩 찰 때마다 켜진다.
  function renderCombo() {
    const filled = state.scoreboard ? state.scoreboard.getState().comboFilled : 0;
    elements.comboPips.forEach((pip, index) => {
      pip.classList.toggle("is-active", index < filled);
    });
    elements.comboMeter.setAttribute("aria-label", `연속 정답 ${filled}단계`);
  }

  // 콤보 보너스: 배너 아래 알 세 개가 잠깐 모두 켜진다(가운데 큰 글자 연출은 사용자 지시로 없앰).
  function celebrateCombo() {
    window.clearTimeout(comboFlashTimer);
    elements.comboPips.forEach((pip) => pip.classList.add("is-active"));
    comboFlashTimer = window.setTimeout(() => {
      comboFlashTimer = null;
      renderCombo();
    }, 900);
  }

  function resetComboPips() {
    window.clearTimeout(comboFlashTimer);
    comboFlashTimer = null;
    elements.comboPips.forEach((pip) => pip.classList.remove("is-active"));
    hideComboGains();
  }

  /*
   * 2차 수정(공통 기준): 연속 정답 첫째·둘째 알이 켜질 때 그 알 위에 방금 얻은 정답 점수를 띄운다.
   * 셋째(콤보 완성)는 showBonusFloat 가 셋째 알 위에 BONUS 와 보너스 점수로 띄운다.
   * '동작 줄이기' 에서는 styles.css 가 떠오름 없이 그대로 보여 주고, 끄는 것은 여기 타이머가 한다.
   */
  const COMBO_GAIN_MS = 900;
  const comboGainTimers = new Map();

  function showComboGain(index, amount) {
    const gain = elements.comboGains[index];
    const value = Math.trunc(Number(amount) || 0);
    if (!gain || value <= 0) return;
    window.clearTimeout(comboGainTimers.get(index));
    gain.textContent = `+${formatScore(value)}`;
    gain.classList.remove("is-visible");
    void gain.offsetWidth;
    gain.classList.add("is-visible");
    comboGainTimers.set(index, window.setTimeout(() => {
      gain.classList.remove("is-visible");
      comboGainTimers.delete(index);
    }, COMBO_GAIN_MS));
  }

  function hideComboGains() {
    comboGainTimers.forEach((timerId) => window.clearTimeout(timerId));
    comboGainTimers.clear();
    elements.comboGains.forEach((gain) => gain.classList.remove("is-visible"));
  }

  /*
   * 신호등(사용자 지시 2026-09-04). 배너 아래 소켓의 램프 하나가 판정 순간 켜졌다가 꺼진다:
   * 정답 초록, 오답 빨강, 장애물 충돌·문제 놓침 노랑. 연료통과 그냥 피한 줄은 켜지 않는다.
   * 새 판정이 오면 켜져 있던 램프를 끄고 새 램프를 켠다(같은 램프도 처음부터 다시).
   */
  const LAMP_BLINK_MS = 700; // styles.css 의 lampBlink 700ms 와 같다.
  let lampTimer = null;

  function blinkLamp(color) {
    window.clearTimeout(lampTimer);
    elements.trafficLamps.forEach((lamp) => {
      lamp.classList.remove("is-lit");
      if (lamp.dataset.lamp === color) {
        void lamp.offsetWidth;
        lamp.classList.add("is-lit");
      }
    });
    // 동작 줄이기(애니메이션 없음)에서도 켜졌다 꺼지게 시간으로 끈다(검수 확정 2026-09-04).
    lampTimer = window.setTimeout(resetTrafficLight, LAMP_BLINK_MS);
  }

  function resetTrafficLight() {
    window.clearTimeout(lampTimer);
    lampTimer = null;
    elements.trafficLamps.forEach((lamp) => lamp.classList.remove("is-lit"));
  }

  /*
   * 점수 변화 표시(사용자 지시): 점수 게이지 위로 "+100", "-10", 콤보면 "+200 COMBO" 가
   * 떠올랐다 사라진다.
   */
  let scoreFloatTimer = null;
  function showScoreFloat(delta) {
    const value = Math.trunc(Number(delta) || 0);
    if (value === 0) return;
    window.clearTimeout(scoreFloatTimer);
    elements.scoreFloat.textContent = `${value > 0 ? "+" : "-"}${formatScore(Math.abs(value))}`;
    elements.scoreFloat.classList.remove("is-visible", "is-gain", "is-loss");
    void elements.scoreFloat.offsetWidth;
    elements.scoreFloat.classList.add("is-visible", value > 0 ? "is-gain" : "is-loss");
    scoreFloatTimer = window.setTimeout(() => {
      scoreFloatTimer = null;
      elements.scoreFloat.classList.remove("is-visible");
    }, 800);
  }

  /*
   * 보너스 표시(검수표 r11). 3연속 정답 보너스는 정답 점수와 섞지 않고 그 위에서 따로
   * "BONUS +100" 으로 터진다. 금빛 고리 효과는 styles.css 의 bonusRing 이 맡는다.
   */
  const BONUS_FLOAT_MS = 1_100;

  function showBonusFloat(amount) {
    const value = Math.trunc(Number(amount) || 0);
    if (value <= 0) return;
    window.clearTimeout(bonusFloatTimer);
    // 2차 수정: "BONUS" 는 띠 그림 글자로 마크업에 있고, 여기서는 점수만 바꾼다.
    elements.bonusFloatValue.textContent = `+${formatScore(value)}`;
    elements.bonusFloat.classList.remove("is-visible");
    void elements.bonusFloat.offsetWidth;
    elements.bonusFloat.classList.add("is-visible");
    bonusFloatTimer = window.setTimeout(() => {
      bonusFloatTimer = null;
      elements.bonusFloat.classList.remove("is-visible");
    }, BONUS_FLOAT_MS);
  }

  function hideScoreFloat() {
    endScoreBonus();
    window.clearTimeout(scoreFloatTimer);
    scoreFloatTimer = null;
    elements.scoreFloat.classList.remove("is-visible");
    window.clearTimeout(timeFloatTimer);
    timeFloatTimer = null;
    elements.timeFloat.classList.remove("is-visible");
    window.clearTimeout(bonusFloatTimer);
    bonusFloatTimer = null;
    elements.bonusFloat.classList.remove("is-visible");
  }

  // 연료통을 먹었을 때 시간 게이지 위로 "+10s" 가 떠오른다.
  let timeFloatTimer = null;
  let bonusFloatTimer = null;
  function showTimeFloat(seconds) {
    window.clearTimeout(timeFloatTimer);
    elements.timeFloat.textContent = `+${Math.round(seconds)}s`;
    elements.timeFloat.classList.remove("is-visible");
    void elements.timeFloat.offsetWidth;
    elements.timeFloat.classList.add("is-visible");
    timeFloatTimer = window.setTimeout(() => {
      timeFloatTimer = null;
      elements.timeFloat.classList.remove("is-visible");
    }, 800);
  }

  /* ---------------- 게임 화면: 배너 · 신호등 · 도로 ---------------- */

  /*
   * 문제판 영어(2026-10-01 긴 단어도 내기). 한 줄이 기본이다. 예전과 같은 글자 수별 시작 크기에서 칸
   * (.question-word-cover 635x100)에 맞을 때까지 줄이되, 한 줄의 최소는 예전 가장 작은 배율 0.68(약 44px)이다. 그래도 안 들어가면 띄어쓰기에서
   * 두 줄로 나눠 두 줄 안에서 가장 크게 둔다 — OX 와 같은 규칙(사장님 결정 2026-10-01): 세 줄은 쓰지 않고,
   * 데이터에 줄바꿈이 있으면 그 자리를 따르며, 단어는 하나씩 줄바꿈 없는 칸(.word-part)에 넣어 하이픈
   * 뒤에서 나뉘지 않게 한다. 나눌 자리가 없는 한 단어는 한 줄로 더 줄인다(글자 중간에서 자르지 않는다).
   */
  const WORD_ONE_LINE_MIN_SCALE = 0.68;
  const WORD_MAX_WRAPPED_LINES = 2;

  // 글자 수에 따른 시작 크기(예전 그대로 — 예전에 나오던 단어는 모양이 같다). 여기서 칸에 맞게 줄이기만 한다.
  function wordScaleFor(text) {
    const length = String(text ?? "").length;
    if (length <= 10) return 1;
    if (length <= 13) return 0.82;
    return 0.68;
  }
  // 단어 사이 간격. 줄바꿈 없는 공백(U+00A0)은 붙여 두라는 뜻이라 단어를 가르지 않는다.
  const ENGLISH_WORD_GAP = /[^\S\u00A0]+/;

  function renderQuestionWordParts(element, label) {
    element.replaceChildren();
    label.split(/\s*\n\s*/).forEach((line, lineIndex) => {
      if (lineIndex > 0) element.append(document.createElement("br"));
      line.split(ENGLISH_WORD_GAP).filter(Boolean).forEach((word, wordIndex) => {
        if (wordIndex > 0) element.append(document.createTextNode(" "));
        const part = document.createElement("span");
        part.className = "word-part";
        part.textContent = word;
        element.append(part);
      });
    });
  }

  // 줄 수는 단어 칸 안 글자 사각형의 높이로 센다(OX 와 같은 방법 — 칸 자체의 상자는 글자보다 조금 위에 있어 같은 줄을 두 번 센다).
  function countRenderedLines(element) {
    const rects = [];
    element.querySelectorAll(".word-part").forEach((part) => {
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

  // 새 단어는 등장할 때 잠깐 1.06배로 커진다(@keyframes wordPop). 칸은 넘친 것을 잘라 내므로 그만큼 안쪽에 맞춘다.
  const WORD_POP_SCALE = 1.06;

  // 단어 칸은 칸(덮개) 가운데 놓인 grid 항목이라, 한 줄일 때는 자기 폭이 곧 글자 폭이다. 두 줄일 때 한 단어가
  // 칸보다 넓으면 넘친 폭은 scrollWidth 로만 보인다. 무대는 transform 으로 줄므로 레이아웃 px 은 1920 기준 그대로다.
  function questionWordRoom(room) {
    return { width: room.clientWidth / WORD_POP_SCALE, height: room.clientHeight / WORD_POP_SCALE };
  }

  function questionWordOverflows(element, room) {
    const { width, height } = questionWordRoom(room);
    return Math.max(element.offsetWidth, element.scrollWidth) > width + 1
      || element.offsetHeight > height + 1;
  }

  function fitQuestionWord() {
    const element = elements.questionWord;
    const room = element.parentElement;
    if (!room || room.clientWidth === 0) return;
    const setScale = (value) => element.style.setProperty("--word-scale", value.toFixed(3));
    const shrinkToFit = (floor) => {
      let scale = Number(element.style.getPropertyValue("--word-scale")) || 1;
      for (let guard = 0; guard < 30 && scale > floor && questionWordOverflows(element, room); guard += 1) {
        const target = questionWordRoom(room);
        const ratio = Math.min(
          target.width / Math.max(1, element.offsetWidth, element.scrollWidth),
          target.height / Math.max(1, element.offsetHeight),
        );
        scale = Math.max(floor, Math.min(scale - 0.01, scale * ratio));
        setScale(scale);
      }
    };
    const startScale = wordScaleFor(element.textContent);
    element.classList.remove("is-wrapped");
    element.style.removeProperty("max-width");
    setScale(startScale);
    shrinkToFit(WORD_ONE_LINE_MIN_SCALE);
    if (!questionWordOverflows(element, room)) return;
    if (!element.querySelector("br") && element.querySelectorAll(".word-part").length >= 2) {
      element.classList.add("is-wrapped");
      // 두 줄일 때 단어 칸은 줄 폭만큼 넓어진다. 그 폭을 등장 여유를 뺀 폭으로 묶어야 줄이 그 안에서 나뉜다.
      element.style.maxWidth = `${Math.floor(questionWordRoom(room).width)}px`;
      for (let scale = startScale; scale > 0.1; scale = Math.round((scale - 0.02) * 1000) / 1000) {
        setScale(scale);
        if (!questionWordOverflows(element, room) && countRenderedLines(element) <= WORD_MAX_WRAPPED_LINES) return;
      }
    }
    // 나눌 자리가 없는 한 단어, 데이터 줄바꿈으로 이미 여러 줄인 단어: 맞을 때까지 더 줄인다.
    shrinkToFit(0.05);
  }

  let shownQuestionWord = null;

  function showQuestionWord(question) {
    const label = formatEnglishLabel(question?.english);
    shownQuestionWord = question;
    renderQuestionWordParts(elements.questionWord, label);
    fitQuestionWord();
    // 영문 글꼴을 다 받기 전에 재면 대체 글꼴 폭으로 맞춘다(OX 실측). 다 받으면 같은 문제일 때 다시 맞춘다.
    document.fonts?.ready?.then(() => {
      if (shownQuestionWord === question) fitQuestionWord();
    });
    elements.questionWord.classList.remove("is-new");
    void elements.questionWord.offsetWidth;
    elements.questionWord.classList.add("is-new");
  }

  /*
   * 검수표 r53: 보기 글자는 4단계(조개)의 1.65cqw = 1920 기준 약 32px 에 맞춘다.
   * 긴 뜻에서도 줄어드는 폭을 좁게 두어 가장 큰 글자와 작은 글자의 차이를 줄인다.
   */
  const CHOICE_TEXT_MIN_SCALE = 0.8;

  function choiceTextScale(text) {
    const length = String(text ?? "").replace(/[\s\n]/g, "").length;
    if (length <= 6) return 1;
    if (length <= 10) return 0.94;
    if (length <= 14) return 0.88;
    return CHOICE_TEXT_MIN_SCALE + 0.02;
  }

  // 긴 뜻(2026-10-01 뜻 20자 거름 해제)은 0.8 아래로도 줄인다. 이 값은 끝없이 돌지 않게 막는 바닥일 뿐이다.
  const CHOICE_TEXT_FLOOR_SCALE = 0.05;
  // answer*.png(341x179) 밝은 면의 위아래(세 색 모두 같음, 2026-10-01 실측). 글자 상자는 이보다 아래로
  // 15px 길어서, 상자에 맞기만 하면 서너 줄짜리 뜻의 아랫줄이 테에 걸린다. 글자는 밝은 면 안에 있어야 한다.
  const CHOICE_FACE_TOP = 13;
  const CHOICE_FACE_BOTTOM = 130;

  // 여백을 뺀 내용 상자로 잰다(여백은 글자를 따라 줄지 않는다 — 바다속 실측). 글자 덩어리는 상자 가운데 놓이므로
  // 위아래 모두 밝은 면 안에 드는 높이까지만 쓴다.
  function choiceTextRoom(label) {
    const style = window.getComputedStyle(label);
    const paddingTop = parseFloat(style.paddingTop);
    const height = label.clientHeight - paddingTop - parseFloat(style.paddingBottom);
    const center = label.offsetTop + paddingTop + height / 2;
    return {
      height: Math.min(height, 2 * Math.min(center - CHOICE_FACE_TOP, CHOICE_FACE_BOTTOM - center)),
      width: label.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    };
  }

  function fitChoiceText(label, inner) {
    // 화면에 그려지지 않은 상자(크기 0)는 잴 수 없다. 재면 높이가 음수가 되어 배율이 NaN 이 된다.
    if (!label.isConnected || label.clientHeight === 0) return;
    label.classList.remove("is-long");
    let scale = choiceTextScale(inner.textContent);
    const setScale = (value) => label.style.setProperty("--choice-text-scale", String(value));
    setScale(scale);
    // 안쪽 상자는 폭이 100% 로 묶여 있어 offsetWidth 로는 넘침을 못 본다. scrollWidth 로 잰다.
    const overflows = () => inner.offsetHeight > choiceTextRoom(label).height
      || inner.scrollWidth > inner.clientWidth + 1;
    // 짧은 뜻은 예전처럼 5%씩 0.8 까지, 예전 상자에서.
    while (scale > CHOICE_TEXT_MIN_SCALE && overflows()) {
      scale = Math.round((scale - 0.05) * 100) / 100;
      setScale(scale);
    }
    if (!overflows()) return;
    // 그래도 안 들어가는 긴 뜻: 상자를 밝은 면에 꼭 맞추고(styles.css .is-long), 넘친 비율만큼 줄이기를
    // 맞을 때까지 되풀이한다. 줄 수와 줄 높이가 함께 줄어 높이는 대략 글자 크기의 제곱으로 주므로 제곱근만큼 줄인다.
    label.classList.add("is-long");
    for (let guard = 0; guard < 40 && scale > CHOICE_TEXT_FLOOR_SCALE && overflows(); guard += 1) {
      const room = choiceTextRoom(label);
      if (room.height <= 0 || room.width <= 0) break;
      const ratio = Math.min(
        room.height / Math.max(1, inner.offsetHeight),
        room.width / Math.max(1, inner.scrollWidth),
      );
      scale = Math.max(CHOICE_TEXT_FLOOR_SCALE, Math.min(scale - 0.01, scale * Math.sqrt(ratio)));
      scale = Math.floor(scale * 1000) / 1000;
      setScale(scale);
    }
  }

  function setChoiceLabel(inner, text) {
    inner.replaceChildren();
    String(text ?? "").split("\n").forEach((line, lineIndex, lines) => {
      inner.append(document.createTextNode(line));
      if (lineIndex < lines.length - 1) inner.append(document.createElement("br"));
    });
  }

  function createRowNode(row) {
    // 빈 줄(gap)은 그릴 것이 없다.
    if (!row.items || row.items.length === 0) return null;
    const node = document.createElement("div");
    node.className = "road-row";
    node.dataset.rowId = String(row.id);
    node.dataset.kind = row.kind;
    node.style.setProperty("--row-y", `${row.y}px`);

    row.items.forEach((item) => {
      const itemNode = document.createElement("div");
      itemNode.className = `road-item ${item.kind === "choice" ? "road-choice" : "road-obstacle"} lane-${item.lane}`;
      itemNode.dataset.lane = String(item.lane);
      // 검수표 r54: 상자마다 세로로 어긋나게 놓는다(race.js 가 정한 값).
      itemNode.style.setProperty("--item-offset", `${Number(item.offsetY) || 0}px`);
      const image = document.createElement("img");
      image.alt = "";
      image.draggable = false;
      if (item.kind === "choice") {
        image.className = "road-choice-image";
        image.src = CHOICE_IMAGES[item.lane] || CHOICE_IMAGES[1];
        image.width = Race.CHOICE_WIDTH;
        image.height = Race.CHOICE_HEIGHT;
        const label = document.createElement("span");
        label.className = "road-choice-text";
        const inner = document.createElement("span");
        inner.className = "road-choice-text-inner";
        setChoiceLabel(inner, item.text);
        label.style.setProperty("--choice-text-scale", String(choiceTextScale(item.text)));
        label.append(inner);
        itemNode.append(image, label);
        requestAnimationFrame(() => fitChoiceText(label, inner));
        // 한글 글꼴(나눔)이 시작 전 4초 안에 오지 못했으면 대체 글꼴 폭으로 맞춘 셈이라, 받은 뒤 다시 맞춘다
        // (2026-10-02 반박 검토: 8초 늦게 오자 3장 중 2장이 밝은 면 밖으로 나감). 이미 받았으면 하지 않는다.
        if (document.fonts && document.fonts.status !== "loaded") {
          document.fonts.ready.then(() => requestAnimationFrame(() => fitChoiceText(label, inner)));
        }
      } else if (item.kind === "fuel") {
        itemNode.className = `road-item road-fuel lane-${item.lane}`;
        image.className = "road-fuel-image";
        image.src = FUEL_IMAGE;
        image.width = Race.OBSTACLE_SIZE;
        image.height = Race.OBSTACLE_SIZE;
        itemNode.append(image);
      } else {
        image.className = "road-obstacle-image";
        image.src = OBSTACLE_IMAGES[item.obstacle] || OBSTACLE_IMAGES.cone;
        image.width = Race.OBSTACLE_SIZE;
        image.height = Race.OBSTACLE_SIZE;
        itemNode.append(image);
      }
      node.append(itemNode);
    });

    elements.roadItems.append(node);
    state.rowNodes.set(row.id, node);
    return node;
  }

  function removeRowNode(rowId) {
    const node = state.rowNodes.get(rowId);
    if (node) node.remove();
    state.rowNodes.delete(rowId);
  }

  function clearRowNodes() {
    state.rowNodes.forEach((node) => node.remove());
    state.rowNodes.clear();
    elements.roadItems.replaceChildren();
    elements.effectsLayer.replaceChildren();
  }

  function renderRows() {
    state.race.positions().forEach(({ id, y }) => {
      const node = state.rowNodes.get(id);
      if (node) node.style.setProperty("--row-y", `${y}px`);
    });
  }

  /*
   * 풍경 타일. 패턴 한 바퀴 뒤에 첫 장을 한 번 더 붙인다. offset 0 에서는 마지막(첫 장과
   * 같은) 타일이 보이고, 한 바퀴를 다 내리면 첫 장이 보이는 자리에서 되감으므로 끊기지 않는다.
   */
  function buildSceneTrack() {
    elements.sceneTrack.replaceChildren();
    [...SCENE_PATTERN, SCENE_PATTERN[0]].forEach((scene) => {
      const tile = document.createElement("div");
      tile.className = `scene-tile scene-tile-${scene}`;
      elements.sceneTrack.append(tile);
    });
    elements.sceneTrack.style.height = `${(SCENE_PATTERN.length + 1) * SCENE_TILE_HEIGHT}px`;
  }

  function setSceneOffset(offset) {
    state.sceneOffset = offset;
    elements.sceneTrack.style.setProperty("--scene-offset", `${offset - SCENE_CYCLE_HEIGHT}px`);
  }

  // 배경을 줄과 같은 속도로 내린다. 한 바퀴(4장)를 지나면 처음으로 되감는다.
  function advanceScene(delta) {
    const distance = (state.race.speed() * delta) / 1000;
    setSceneOffset((state.sceneOffset + distance) % SCENE_CYCLE_HEIGHT);
  }

  /*
   * 정답 불꽃. 별과 점이 사방으로 튀어 나가 사라지고 1.2초 뒤 스스로 치운다.
   * 검수표 r61(사용자 선택 2026-09-14): 맞힌 판넬이 속한 줄 노드 안 판넬 중심에서 터진다.
   * 줄과 함께 내려가 판넬을 따라가고, 줄 층은 자동차보다 아래라 불꽃이 자동차를 가리지 않는다.
   * 줄이 화면 밖으로 나가거나 화면을 초기화하면 줄과 함께 지워진다. 줄 노드가 없으면 효과층에 둔다.
   */
  const ROW_CENTER_Y = 110; // styles.css .road-row 높이 220px 의 절반 = 줄 기준점

  function spawnSparkles(lane, { rowNode = null, offsetY = 0, y = 0 } = {}) {
    const burst = document.createElement("span");
    burst.className = "spark-burst";
    burst.setAttribute("aria-hidden", "true");
    burst.style.left = `${Race.LANE_CENTERS[lane]}px`;
    burst.style.top = rowNode ? `${ROW_CENTER_Y + (Number(offsetY) || 0)}px` : `${y}px`;
    const count = 18;
    for (let index = 0; index < count; index += 1) {
      const spark = document.createElement("i");
      const angle = (Math.PI * 2 * index) / count + randomBetween(-0.25, 0.25);
      const distance = randomBetween(140, 300);
      spark.className = index % 3 === 2 ? "spark is-dot" : "spark";
      spark.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      spark.style.setProperty("--dy", `${Math.sin(angle) * distance - 50}px`);
      spark.style.setProperty("--rot", `${randomBetween(-260, 260)}deg`);
      spark.style.setProperty("--size", `${randomBetween(16, 40)}px`);
      spark.style.setProperty("--delay", `${randomBetween(0, 110)}ms`);
      spark.style.setProperty("--color", SPARK_COLORS[index % SPARK_COLORS.length]);
      burst.append(spark);
    }
    (rowNode || elements.effectsLayer).append(burst);
    window.setTimeout(() => burst.remove(), 1_200);
  }

  function shakeStage(className) {
    elements.stage.classList.remove(className);
    void elements.stage.offsetWidth;
    elements.stage.classList.add(className);
    state.feedbackTimerIds.push(window.setTimeout(() => {
      elements.stage.classList.remove(className);
    }, FEEDBACK_MS));
  }

  function bumpCar() {
    elements.car.classList.remove("is-bumped");
    void elements.car.offsetWidth;
    elements.car.classList.add("is-bumped");
    state.feedbackTimerIds.push(window.setTimeout(() => {
      elements.car.classList.remove("is-bumped");
    }, 450));
  }

  function clearFeedbackTimers() {
    state.feedbackTimerIds.forEach((id) => window.clearTimeout(id));
    state.feedbackTimerIds = [];
    elements.stage.classList.remove("feedback-correct", "feedback-wrong", "feedback-trap");
    elements.car.classList.remove("is-bumped", "tilt-left", "tilt-right");
    window.clearTimeout(carTiltTimer);
    carTiltTimer = null;
  }

  /* ---------------- 자동차 ---------------- */

  function placeCar(lane) {
    elements.car.style.setProperty("--car-x", `${Race.LANE_CENTERS[lane] - CAR_WIDTH / 2}px`);
    elements.car.dataset.lane = String(lane);
  }

  function applyLane(result, { direction = 0, silent = false } = {}) {
    placeCar(result.lane);
    if (!result.changed || silent) return;
    playSound("swap", 0.5);
    elements.car.classList.remove("tilt-left", "tilt-right");
    if (direction !== 0) {
      elements.car.classList.add(direction < 0 ? "tilt-left" : "tilt-right");
      window.clearTimeout(carTiltTimer);
      carTiltTimer = window.setTimeout(() => {
        elements.car.classList.remove("tilt-left", "tilt-right");
        carTiltTimer = null;
      }, CAR_TILT_MS);
    }
    elements.status.textContent = `${result.lane + 1}번 차선으로 옮겼습니다.`;
  }

  function steerToLane(lane) {
    if (state.phase !== "racing" || !state.race) return;
    const previous = state.race.state().lane;
    const result = state.race.setLane(lane);
    applyLane(result, { direction: Math.sign(result.lane - previous) });
  }

  function steerBy(delta) {
    if (state.phase !== "racing" || !state.race) return;
    const result = state.race.moveLane(delta);
    applyLane(result, { direction: Math.sign(delta) });
  }

  // 화면 좌표 → 무대 좌표. 무대는 scale 로 줄어 있으므로 비율로 되돌린다.
  function stageXFromClient(clientX) {
    const rect = elements.stage.getBoundingClientRect();
    if (!rect.width) return STAGE_WIDTH / 2;
    return ((clientX - rect.left) / rect.width) * STAGE_WIDTH;
  }

  function steerToClientX(clientX) {
    steerToLane(Race.laneForX(stageXFromClient(clientX)));
  }

  function selectCar(color) {
    if (!CAR_IMAGES[color]) return;
    state.carColor = color;
    elements.carImage.src = CAR_IMAGES[color];
    elements.carTiles.forEach((tile) => {
      tile.setAttribute("aria-pressed", String(tile.dataset.car === color));
    });
  }

  /* ---------------- 자동차 고르기 ---------------- */

  function openCarSelect() {
    if (currentScreen !== "start" || elements.startButton.disabled) return;
    // 기다리던 시작 화면 랭킹 응답이 자동차 선택 창 위에 뜨지 않게(검수 확정 2026-09-04) 토큰을 무효화하고 버튼을 되살린다.
    startRankingRequestToken += 1;
    setStartRankingEnabled(words.length > 0);
    closeResultDialog({ restoreFocus: false });
    elements.carSelectDialog.hidden = false;
    playSound("open", 0.7);
    emitNavigation("car-select");
    requestAnimationFrame(() => {
      if (elements.carSelectDialog.hidden) return;
      const current = elements.carTiles.find((tile) => tile.dataset.car === state.carColor);
      (current || elements.carTiles[0])?.focus({ preventScroll: true });
    });
  }

  function closeCarSelect({ restoreFocus = true } = {}) {
    if (elements.carSelectDialog.hidden) return;
    elements.carSelectDialog.hidden = true;
    if (restoreFocus && !elements.startButton.disabled) {
      elements.startButton.focus({ preventScroll: true });
    }
  }

  function chooseCar(tile) {
    selectCar(tile.dataset.car);
    pressControl(tile);
    closeCarSelect({ restoreFocus: false });
    emitNavigation("car-selected", { car: state.carColor });
    window.setTimeout(beginCountdown, 120);
  }

  /* ---------------- 게임 흐름 ---------------- */

  function clearCountdownTimers() {
    state.countdownTimerIds.forEach((id) => window.clearTimeout(id));
    state.countdownTimerIds = [];
  }

  function resetPlayVisuals() {
    clearRowNodes();
    clearFeedbackTimers();
    resetComboPips();
    resetTrafficLight();
    hideScoreFloat();
    shownQuestionWord = null;
    elements.questionWord.textContent = "";
    elements.questionWord.classList.remove("is-new", "is-wrapped");
    elements.questionWord.style.removeProperty("max-width");
    elements.stage.classList.remove("clock-running", "timer-ended", "timer-urgent", "timer-critical");
    setSceneOffset(0);
    lastRenderedScore = null;
    placeCar(1);
  }

  function popCountdownImage(step) {
    elements.countdownImage.src = step.src;
    elements.countdownImage.alt = step.alt;
    elements.countdownImage.classList.remove("is-popping");
    void elements.countdownImage.offsetWidth;
    elements.countdownImage.classList.add("is-popping");
  }

  /*
   * 출발 신호. 자동차를 고르면 도로 위에 3 → 2 → 1 그림이 한 박자씩 나오고, START 그림이
   * 뜨는 바로 그 순간 줄이 내려오기 시작한다(사용자 지시: 카운트가 완료되면 그때 게임이
   * 진행). START 그림은 어두운 덮개를 걷은 채 잠깐 남았다가 사라진다.
   */
  function beginCountdown() {
    if (words.length === 0) {
      showToast("게임 데이터를 준비하고 있습니다.");
      return;
    }
    clearCountdownTimers();
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = 0;
    state.phase = "countdown";
    state.locked = true;
    state.ended = true;
    state.dragging = false;
    resetPlayVisuals();
    // 결과 화면에서 기다리던 랭킹·기록 응답이 카운트다운 위에 창을 띄우지 않게 토큰을 무효화하고,
    // 결과 색종이 루프도 끈다(검수 확정 2026-09-04).
    state.resultRequestToken += 1;
    resultDialogRequestToken += 1;
    startRankingRequestToken += 1;
    clearResultParticles();
    closeResultDialog({ restoreFocus: false });
    closeIncorrectAnswerDialog({ restoreFocus: false });
    stopIncorrectAudio();
    setScreen("play");
    elements.resultMessage.textContent = "";
    // 보너스 굴림이 도는 중에 다시 하면 옛 굴림이 새 판 카운트다운에 앞 판 점수를 다시 찍었다(2026-10-02 반박 검토).
    cancelScoreTween();
    writeScoreText(0);
    elements.score.setAttribute("aria-label", `점수 ${formatScore(0)}`);
    elements.scoreNeedle.style.setProperty("--score-angle", "-90deg");
    renderTimer(totalDurationMs);
    elements.countdown.classList.remove("is-go");
    elements.countdown.hidden = false;
    popCountdownImage(COUNTDOWN_STEPS[0]);
    // "3" 에는 박자음을 두지 않는다 — 120ms 전 자동차 타일·다시 하기 클릭음이 그 박자다(두 소리 겹침 방지).
    state.goSignalUntil = 0;
    elements.status.textContent = "출발 준비. 3, 2, 1 다음 START 에서 시작합니다.";
    emitNavigation("countdown", { car: state.carColor });

    COUNTDOWN_STEPS.slice(1).forEach((step, index) => {
      const isGo = index === COUNTDOWN_STEPS.length - 2;
      state.countdownTimerIds.push(window.setTimeout(() => {
        popCountdownImage(step);
        playSound(isGo ? "show" : "touch", 0.7);
        if (isGo) {
          // START 와 동시에 출발. 덮개는 걷고 그림만 잠깐 남긴다.
          elements.countdown.classList.add("is-go");
          state.goSignalUntil = performance.now() + COUNTDOWN_GO_HOLD_MS;
          startRace();
        }
      }, countdownStepMs * (index + 1)));
    });
    state.countdownTimerIds.push(window.setTimeout(() => {
      elements.countdown.hidden = true;
      elements.countdown.classList.remove("is-go");
    }, countdownStepMs * (COUNTDOWN_STEPS.length - 1) + COUNTDOWN_GO_HOLD_MS));
  }

  // 출발. START 그림이 뜨는 순간 불린다 — 남은 카운트다운 타이머(그림 치우기)는 그대로 둔다.
  function startRace() {
    try {
      // 2차 수정(공통 기준): Try Again 이든 처음으로 → Start 든 앞 판 마지막 단어로 시작하지 않는다.
      // state.race 는 새 판을 만들 때까지 앞 판 그대로 남아 있다 — 그 배너 단어가 "마지막에 나왔던 단어"다.
      const previousLastWord = state.race?.state?.().currentQuestion?.english || "";
      state.race = Race.createRace({ words, avoidFirst: previousLastWord });
    } catch (error) {
      clearCountdownTimers();
      elements.countdown.hidden = true;
      elements.countdown.classList.remove("is-go");
      state.phase = "idle";
      state.ended = true;
      showLoading("게임을 준비하지 못했습니다", error?.message || "문제를 만들 수 없습니다.", { error: true, retry: true });
      return;
    }
    state.scoreboard = Rules.createScoreboard({
      correctScore: scoring.correct,
      incorrectScore: scoring.incorrect,
      obstacleScore: scoring.obstacle,
      streakLength: scoring.comboEvery,
      streakBonus: scoring.comboBonus,
      playTimeSeconds: Math.round(totalDurationMs / 1000),
    });

    presentedQuestions.clear();
    presentedQuestionCount = 0;
    correctQuestionKeys.clear();
    wrongAnswerCounts.clear();
    presentedTimes.clear();
    correctTimes.clear();
    updateIncorrectAnswersButton();
    state.historyRequested = false;
    state.resultRequestToken += 1;
    resultDialogRequestToken += 1;
    startRankingRequestToken += 1;
    helpRequestToken += 1;
    state.answeredCount = 0;
    state.bonusTimeMs = 0;
    state.lastResolveAt = 0;
    state.phase = "racing";
    state.locked = false;
    state.ended = false;
    if (isLoggedInMember()) prefetchWordAudio(words);

    applyLane(state.race.setLane(1), { silent: true });
    elements.stage.classList.remove("timer-ended", "timer-urgent", "timer-critical");
    elements.stage.classList.add("clock-running");
    renderScore();
    renderCombo();
    renderTimer(totalDurationMs);
    elements.status.textContent = "출발! 화면을 누르거나 좌우 화살표로 차선을 바꾸세요.";

    const now = performance.now();
    state.gameStartedAt = now;
    state.lastFrameAt = now;
    state.animationFrameId = requestAnimationFrame(update);
    emitNavigation("game", { car: state.carColor });
  }

  /*
   * 문제 등장 소리(사용자 지시 2026-09-04). 게임 중 발음은 "문제가 뜰 때만", 그리고 회원
   * (운영 fu_id·test_mode=member)에게만 들려준다. 게스트·데모는 등장 효과음(show)만 낸다.
   * 타이밍: 첫 문제는 START 그림과 같은 순간 생기므로 START 그림이 사라진 뒤에 낸다. 그 뒤 문제는
   * 줄 간격(race.js ROW_GAP_PX, 2026-09-14 780px)에 따라 판정이 끝나고 약 1.7~3.0초 뒤에 생기지만(2차 속도 절반,
   * 예전 0.8~1.5초를 실측으로 다시 쟀다),
   * 간격이 좁아 판정 직후에 생기더라도 판정에서 QUESTION_SOUND_DELAY_MS 가 지나기 전에는 내지 않는다.
   * 그래야 발음이 정답 소리처럼 들리지 않고 판정 효과음과도 겹치지 않는다. 출발 신호 중의
   * 등장 효과음은 이미 울린 START 효과음으로 대신한다.
   */
  function cueQuestionSound(question) {
    const now = performance.now();
    const speak = isLoggedInMember() && Boolean(question.soundUrl);
    if (!speak && state.goSignalUntil > now) return;
    const afterResolve = state.lastResolveAt > 0 ? state.lastResolveAt + QUESTION_SOUND_DELAY_MS : 0;
    const holdUntil = Math.max(state.goSignalUntil, afterResolve);
    const play = () => {
      if (speak) playWordAudio(question.soundUrl);
      else playSound("show", 0.5);
    };
    if (holdUntil > now) {
      state.countdownTimerIds.push(window.setTimeout(() => {
        if (state.phase !== "racing") return;
        play();
      }, holdUntil - now));
      return;
    }
    play();
  }

  function handleRaceEvent(event) {
    if (event.type === "spawn") {
      createRowNode(event.row);
      if (event.row.kind === "question") {
        presentedQuestionCount += 1;
        countPresentation(event.row.question);
        recordPresentedQuestion(event.row.question);
        showQuestionWord(event.row.question);
        cueQuestionSound(event.row.question);
        elements.status.textContent = `문제: ${formatEnglishLabel(event.row.question.english)}. 뜻 상자 ${event.row.items.length}개가 내려옵니다.`;
      }
      return;
    }
    if (event.type === "exit") {
      removeRowNode(event.row.id);
      return;
    }
    if (event.type === "resolve") applyResolve(event);
  }

  function applyResolve(event) {
    const node = state.rowNodes.get(event.row.id);
    const itemNode = node && event.item
      ? node.querySelector(`[data-lane="${event.item.lane}"]`)
      : null;
    if (node) {
      node.querySelectorAll(".road-item").forEach((entry) => {
        if (entry !== itemNode) entry.classList.add("is-passed");
      });
    }
    // 다음 문제의 발음은 이 판정에서 QUESTION_SOUND_DELAY_MS 뒤에 나온다(cueQuestionSound).
    // 그냥 지나간 장애물 줄(clear)은 소리가 없으므로 세지 않는다.
    if (event.outcome !== "clear") state.lastResolveAt = performance.now();

    if (event.outcome === "correct") {
      state.answeredCount += 1;
      recordCorrectAnswer(event.question);
      const outcome = state.scoreboard.registerCorrect();
      if (itemNode) {
        itemNode.classList.add("is-correct");
        const image = itemNode.querySelector("img");
        if (image) image.src = CHOICE_HIT_IMAGES[event.item.lane] || image.src;
      }
      playSound("correct", 0.9);
      spawnSparkles(event.item.lane, {
        rowNode: node,
        offsetY: event.item.offsetY,
        y: event.row.y + (Number(event.item.offsetY) || 0),
      });
      blinkLamp("green");
      renderScore({ roll: outcome.bonus });
      renderCombo();
      // 보너스 순간 Score 위에는 "보너스 +100" 하나만 띄운다 — 같은 자리 정답 "+100" 은 생략(사용자 선택 2026-10-02).
      if (!outcome.bonus) showScoreFloat(outcome.scoreDelta);
      if (!outcome.bonus) {
        // 방금 켜진 알(첫째·둘째) 위에 정답 점수. 셋째는 아래 보너스가 맡는다.
        const filled = state.scoreboard.getState().comboFilled;
        if (filled >= 1 && filled <= 2) showComboGain(filled - 1, outcome.scoreDelta);
      }
      if (outcome.bonus) {
        // 검수표 r11: 보너스는 정답 점수와 따로 표시하고 전용 효과를 낸다.
        celebrateCombo();
        showBonusFloat(outcome.bonusDelta);
        playScoreBonus(outcome.bonusDelta);
        playSound("cheer", 0.8);
      }
      elements.status.textContent = outcome.bonus
        ? `정답입니다. ${scoring.comboEvery}연속 보너스 ${formatScore(scoring.comboBonus)}점을 획득했습니다.`
        : `정답입니다. ${formatEnglishLabel(event.question.english)} - ${event.question.meaning}`;
      return;
    }

    if (event.outcome === "wrong") {
      state.answeredCount += 1;
      const wrongOutcome = state.scoreboard.registerWrong();
      showScoreFloat(wrongOutcome.scoreDelta);
      recordIncorrectAnswer({
        english: event.question.english,
        meaning: event.question.meaning,
        soundUrl: event.question.soundUrl,
      });
      if (itemNode) itemNode.classList.add("is-wrong");
      bumpCar();
      playSound("incorrect", 0.85);
      shakeStage("feedback-wrong");
      blinkLamp("red");
      renderScore();
      renderCombo();
      elements.status.textContent = `오답입니다. 정답은 ${event.question.meaning} 입니다.`;
      return;
    }

    if (event.outcome === "obstacle") {
      const obstacleOutcome = state.scoreboard.registerObstacle();
      showScoreFloat(obstacleOutcome.scoreDelta);
      if (itemNode) itemNode.classList.add("is-hit");
      bumpCar();
      playSound("trap", 0.9);
      shakeStage("feedback-trap");
      blinkLamp("yellow");
      renderScore();
      renderCombo();
      elements.status.textContent = "장애물에 부딪혔습니다.";
      return;
    }

    if (event.outcome === "fuel") {
      // 연료통: 제한 시간이 늘어난다(사용자 지시). 점수는 그대로.
      state.bonusTimeMs += fuelBonusMs;
      if (itemNode) itemNode.classList.add("is-collected");
      playSound("item", 0.9);
      showTimeFloat(fuelBonusMs / 1000);
      elements.status.textContent = `연료통을 먹었습니다. 시간이 ${Math.round(fuelBonusMs / 1000)}초 늘어납니다.`;
      return;
    }

    if (event.outcome === "miss") {
      recordMissedQuestion(event.question);
      blinkLamp("yellow");
      elements.status.textContent = "뜻 상자를 지나쳤습니다.";
    }
  }

  function endGame() {
    if (state.ended) return;
    state.ended = true;
    state.locked = true;
    state.phase = "ended";
    state.dragging = false;
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = 0;
    clearCountdownTimers();
    clearFeedbackTimers();
    resetComboPips();
    resetTrafficLight();
    hideScoreFloat();
    if (state.scoreboard) state.scoreboard.close();
    elements.stage.classList.remove("clock-running", "timer-urgent", "timer-critical");
    elements.stage.classList.add("timer-ended");
    stopWordAudio();
    renderTimer(0);
    closeResultDialog({ restoreFocus: false });
    closeIncorrectAnswerDialog({ restoreFocus: false });
    renderResultBreakdown();
    elements.resultMessage.textContent = "결과를 준비하고 있습니다.";
    setScreen("result");
    // 2차 수정(PDF 2쪽): Try Again 에서는 파티클을 내지 않는다. Good · Excellent 일 때만.
    // 앞 판 파티클이 남아 있지 않게 Try Again 이어도 지우기는 한다.
    if (getResultTitleAsset().tier === RESULT_TIER_TRY_AGAIN) clearResultParticles();
    else emitResultConfetti();
    state.historyPromise = persistResult();
    emitNavigation("ending");
    elements.status.textContent = `게임이 종료되었습니다. 최종 점수는 ${formatScore(state.scoreboard.getState().score)}점입니다.`;
    elements.tryAgainButton.focus({ preventScroll: true });
  }

  function update(now) {
    if (state.ended || state.phase !== "racing") return;
    const remaining = totalDurationMs + state.bonusTimeMs - (now - state.gameStartedAt);
    const rawDelta = now - state.lastFrameAt;
    const delta = Math.min(FRAME_CAP_MS, Math.max(0, rawDelta));
    state.lastFrameAt = now;
    samplePerformance(rawDelta);
    if (remaining <= 0) {
      renderTimer(0);
      endGame();
      return;
    }
    state.race.update(delta).forEach(handleRaceEvent);
    advanceScene(delta);
    renderRows();
    renderTimer(remaining);
    state.animationFrameId = requestAnimationFrame(update);
  }

  /*
   * 시작 화면 장식(사용자 지시 2026-09-04: 연출이 낡아 보임). 색종이 조각은 CSS 가 움직이고,
   * 여기서는 개수·자리·크기·박자만 정해 한 번 만든다. 음수 지연으로 처음부터 흩어져 있다.
   * perf-lite 와 동작 줄이기에서는 CSS 가 숨긴다.
   */
  const START_CONFETTI_COUNT = 14;

  function buildStartEffects() {
    if (!elements.startConfetti || elements.startConfetti.childElementCount > 0) return;
    const pieces = [];
    for (let index = 0; index < START_CONFETTI_COUNT; index += 1) {
      const piece = document.createElement("span");
      const x = ((index + 0.5) / START_CONFETTI_COUNT) * 100 + (index % 2 ? 2.5 : -2.5);
      piece.style.setProperty("--cx", `${x.toFixed(1)}%`);
      piece.style.setProperty("--cs", `${14 + (index % 4) * 3}px`);
      piece.style.setProperty("--cd", `${(9 + (index % 5) * 1.3).toFixed(1)}s`);
      piece.style.setProperty("--co", `${(-index * 0.9).toFixed(1)}s`);
      pieces.push(piece);
    }
    elements.startConfetti.replaceChildren(...pieces);
  }

  function showStartScreen({ restoreFocus = true } = {}) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = 0;
    clearCountdownTimers();
    state.phase = "idle";
    state.locked = true;
    state.ended = true;
    state.dragging = false;
    state.resultRequestToken += 1;
    resultDialogRequestToken += 1;
    startRankingRequestToken += 1;
    helpRequestToken += 1;
    resetPlayVisuals();
    clearResultParticles();
    stopIncorrectAudio();
    stopWordAudio();
    elements.countdown.hidden = true;
    elements.countdown.classList.remove("is-go");
    closeIncorrectAnswerDialog({ restoreFocus: false });
    closeResultDialog({ restoreFocus: false });
    closeCarSelect({ restoreFocus: false });
    setStartReady(words.length > 0);
    setScreen("start");
    // 화면이 보인 뒤에 잰다(감춰져 있으면 폭이 0 이다).
    renderStartStory();
    elements.status.textContent = "시작 화면입니다.";
    emitNavigation("start");
    if (restoreFocus && !elements.startButton.disabled) {
      elements.startButton.focus({ preventScroll: true });
    }
  }

  async function initializeContent({ force = false } = {}) {
    const loader = window.WordMatchContent;
    const token = ++contentRequestToken;
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = 0;
    clearCountdownTimers();
    state.phase = "idle";
    state.ended = true;
    setStartReady(false);
    setScreen("loading");
    elements.stage.classList.remove("clock-running", "timer-urgent", "timer-critical");
    showLoading("게임 준비 중", "단어와 게임 정보를 불러오고 있습니다.");

    try {
      if (!loader || typeof loader.bootstrap !== "function") {
        throw new Error("API 콘텐츠 로더를 시작할 수 없습니다.");
      }
      const loaded = await loader.bootstrap({ force });
      if (token !== contentRequestToken) return;
      if (!Array.isArray(loaded?.content?.words) || loaded.content.words.length < loader.MIN_WORD_COUNT) {
        throw new Error("게임에 사용할 단어가 충분하지 않습니다.");
      }

      words = loaded.content.words.map((word) => ({ ...word }));
      launchContext = loaded.launch || null;
      storyInfo = readStoryInfo(loaded.content.info);
      // 2차 수정: 제한 시간은 API info.play_time, 없으면 40초. 로더가 둘을 합쳐 준다.
      const playTimeSeconds = Math.trunc(Number(loader.playTimeSeconds()));
      totalDurationMs = playTimeSeconds > 0 ? playTimeSeconds * 1_000 : FALLBACK_TOTAL_DURATION_MS;
      // 큰 그림은 시작 화면이 뜨기 전에 미리 해독한다(최대 4초만 기다린다).
      showLoading("게임 준비 중", "그림을 준비하고 있습니다.");
      await Promise.all([preloadImages(), preloadFonts()]);
      if (token !== contentRequestToken) return;
      setStartReady(true);
      hideLoading();
      showStartScreen({ restoreFocus: false });
      emitNavigation("ready", {
        mode: launchContext?.isTest
          ? `test-${launchContext.testMode}`
          : launchContext?.isDemo
            ? "demo"
            : launchContext?.isGuest
              ? "guest"
              : "member",
        fcId: launchContext?.fcId || "",
        totalDurationMs,
      });
    } catch (error) {
      if (token !== contentRequestToken) return;
      words = [];
      launchContext = null;
      storyInfo = readStoryInfo(null);
      setStartReady(false);
      const missingContent = error?.code === "MISSING_FC_ID";
      showLoading(
        missingContent ? "콘텐츠 정보가 없습니다" : "게임을 준비하지 못했습니다",
        error?.message || "잠시 후 다시 시도해 주세요.",
        { error: true, retry: !missingContent },
      );
      elements.status.textContent = error?.message || "게임 데이터 로딩에 실패했습니다.";
    }
  }

  /* ---------------- 이벤트 ---------------- */

  elements.stage.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (
      !button
      || button.disabled
      || button === elements.soundButton
      || button.classList.contains("car-tile")
      || button.dataset.skipTouch === "true"
    ) return;
    playSound("touch");
  }, { capture: true });

  // 도로를 누르거나 끌면 그 자리의 차선으로 옮긴다(승인된 A-7).
  elements.playScreen.addEventListener("pointerdown", (event) => {
    if (state.phase !== "racing" || event.button > 0) return;
    if (event.target.closest("button")) return;
    state.dragging = true;
    try {
      elements.playScreen.setPointerCapture(event.pointerId);
    } catch {
      // 일부 브라우저는 포인터 캡처를 지원하지 않는다. 끌기만 못 할 뿐이다.
    }
    event.preventDefault();
    steerToClientX(event.clientX);
  });
  elements.playScreen.addEventListener("pointermove", (event) => {
    if (!state.dragging || state.phase !== "racing") return;
    steerToClientX(event.clientX);
  });
  const stopDragging = () => {
    state.dragging = false;
  };
  elements.playScreen.addEventListener("pointerup", stopDragging);
  elements.playScreen.addEventListener("pointercancel", stopDragging);
  elements.playScreen.addEventListener("lostpointercapture", stopDragging);

  document.addEventListener("keydown", (event) => {
    if (!elements.incorrectAnswerDialog.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeIncorrectAnswerDialog();
      } else if (event.key === "Tab") {
        trapDialogFocus(
          elements.incorrectAnswerDialog.querySelector(".incorrect-answer-modal"),
          event,
        );
      }
      return;
    }
    if (!elements.resultDialog.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeResultDialog();
        return;
      }
      if (event.key === "Tab") {
        const dialogCard = elements.resultDialog.querySelector(".result-dialog-card");
        trapDialogFocus(dialogCard, event);
      }
      return;
    }
    if (!elements.carSelectDialog.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCarSelect();
      } else if (event.key === "Tab") {
        trapDialogFocus(elements.carSelectDialog.querySelector(".car-select-popup"), event);
      }
      return;
    }
    if (currentScreen === "help" && event.key === "Escape") {
      event.preventDefault();
      closeHelp();
      return;
    }
    if (state.phase !== "racing") return;
    // 키보드 좌우 화살표(와 A/D)로 차선을 옮긴다(승인된 A-7).
    switch (event.key) {
      case "ArrowLeft":
      case "a":
      case "A":
        event.preventDefault();
        steerBy(-1);
        break;
      case "ArrowRight":
      case "d":
      case "D":
        event.preventDefault();
        steerBy(1);
        break;
      default:
        break;
    }
  });

  elements.soundButton.addEventListener("click", () => {
    pressControl(elements.soundButton);
    soundEnabled = !soundEnabled;
    if (!soundEnabled) {
      stopEffectAudios();
      stopIncorrectAudio();
      stopWordAudio();
      pauseBgm();
    } else {
      resumeBgm();
    }
    updateSoundUI();
    if (soundEnabled) playSound("touch");
    // 2차 수정(공통 기준): 소리를 켜고 끌 때 안내를 띄우지 않는다. 스피커 그림이 바뀌는 것으로 충분하다.
  });
  elements.navigationButton.addEventListener("click", () => {
    pressControl(elements.navigationButton);
    if (currentScreen === "help") {
      closeHelp();
    } else if (currentScreen === "play") {
      showStartScreen();
    } else if (currentScreen === "start") {
      leaveGame();
    }
  });
  elements.startButton.addEventListener("click", () => {
    if (elements.startButton.disabled) return;
    pressControl(elements.startButton);
    window.setTimeout(openCarSelect, 120);
  });
  elements.startRankingButton.addEventListener("click", () => void showStartRanking());
  elements.helpButton.addEventListener("click", () => {
    if (elements.helpButton.disabled) return;
    pressControl(elements.helpButton);
    window.setTimeout(openHelp, 120);
  });
  elements.helpRetryButton.addEventListener("click", () => void loadHelp({ retry: true }));
  elements.carTiles.forEach((tile) => {
    tile.addEventListener("click", () => {
      playSound("touch");
      chooseCar(tile);
    });
  });
  elements.carSelectBackdrop.addEventListener("click", () => closeCarSelect());

  function replayGame(button) {
    pressControl(button);
    window.setTimeout(beginCountdown, 120);
  }

  /*
   * 공통 9항: 결과화면의 X 는 그 판을 끝내고 시작 화면으로 간다.
   * "다시 하기"와 달리 돌아올 수 없으므로 점수 저장이 끝난 뒤에 움직이고,
   * 다음 판에 값이 섞이지 않도록 이 판의 기록을 모두 비운다.
   */
  function clearRoundRecords() {
    presentedQuestions.clear();
    presentedQuestionCount = 0;
    correctQuestionKeys.clear();
    wrongAnswerCounts.clear();
    presentedTimes.clear();
    correctTimes.clear();
    state.answeredCount = 0;
    state.bonusTimeMs = 0;
    state.historyRequested = false;
    state.historyPromise = null;
    updateIncorrectAnswersButton();
  }

  async function exitToStartScreen(button) {
    if (button.disabled) return;
    pressControl(button);
    button.disabled = true;
    try {
      await state.historyPromise;
    } catch (error) {
      // 저장 실패는 결과 문구로 이미 알렸다. 나가는 것까지 막지는 않는다.
    } finally {
      button.disabled = false;
      clearRoundRecords();
      showStartScreen();
    }
  }

  elements.resultReplayButton.addEventListener("click", () => void exitToStartScreen(elements.resultReplayButton));
  elements.tryAgainButton.addEventListener("click", () => replayGame(elements.tryAgainButton));
  elements.incorrectAnswersButton.addEventListener("click", openIncorrectAnswerDialog);
  elements.incorrectAnswerClose.addEventListener("click", () => closeIncorrectAnswerDialog());
  elements.incorrectAnswerBackdrop.addEventListener("click", () => closeIncorrectAnswerDialog());
  elements.rankingButton.addEventListener("click", () => void showRanking());
  elements.resultDialogClose.addEventListener("click", () => closeResultDialog());
  elements.resultDialogBackdrop.addEventListener("click", () => closeResultDialog());
  elements.retryButton.addEventListener("click", () => void initializeContent({ force: true }));

  // 배경음은 사용자가 처음 화면을 만졌을 때 시작한다. 그 전에는 브라우저가 막는다.
  armBgmOnGesture();

  window.addEventListener("resize", fitStage);
  window.addEventListener("orientationchange", fitStage);
  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = 0;
    clearCountdownTimers();
    clearFeedbackTimers();
    resetComboPips();
    hideScoreFloat();
    clearResultParticles();
    stopIncorrectAudio();
    stopWordAudio();
    stopEffectAudios();
    pauseBgm();
    window.clearTimeout(toastTimer);
    state.resultRequestToken += 1;
    resultDialogRequestToken += 1;
    startRankingRequestToken += 1;
    helpRequestToken += 1;
    contentRequestToken += 1;
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      void initializeContent({ force: true });
      // pagehide 가 배경음을 멈췄으므로 다음 조작 때 다시 이어 간다.
      if (bgmWanted) armBgmOnGesture();
    }
  });

  fitStage();
  updateSoundUI();
  if (isLowEndDevice()) enablePerfLite("low-end device");
  buildSceneTrack();
  selectCar(state.carColor);
  placeCar(1);
  setStartReady(false);
  buildStartEffects();
  void initializeContent();
})();
