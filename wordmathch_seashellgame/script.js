(function wordMatchOxQuiz() {
  "use strict";

  // 2차 수정 12번(공통 기준): 한 판 시간은 API info 의 play_time(초)이 먼저다. 40초는 API 로 시간을 알 수 없을 때만
  // 쓴다 — 값이 없음 · 0 이하 · 숫자가 아님, info 요청 실패, 데모·테스트 모드. 문항당 제한 시간은 그대로 6초.
  const FALLBACK_DURATION_MS = 40_000;
  const DEFAULT_QUESTION_DURATION_MS = 6_000;
  const FEEDBACK_DURATION_MS = Object.freeze({
    correct: 1_200,
    incorrect: 1_800,
  });
  // 조개는 문제가 출제되기 전에 입을 다물고 있다가 프레임 순서대로 열린다.
  // shellN_0(닫힘) -> shellN_1(반쯤 열림) -> shellN_2(열림).
  /* 2차 수정 7번: 채움 그림(ui_timer2.png) 앞부분은 시계(ui_timer1.png) 밑에 깔린다. 그림 전체 폭에 비례해 자르면
     남은 몫이 작아지는 순간 바가 통째로 시계 밑에 숨어 "10초 남았는데 타임바가 없음"이 된다(120초 판이면 남은
     10초에 보이는 바 0px — 이 방 그림과 자리로 재서 확인). 그래서 시계 몸통 오른쪽 끝부터 채움 잉크 끝까지만
     남은 시간에 비례시킨다. 두 값은 이 방 그림 잉크와 CSS 자리에서 쟀다(OX 와 그림·자리가 달라 값이 다르다):
       시계 몸통이 바를 '완전히' 덮는 곳: 바가 지나는 45행마다 채움 잉크가 시작하는 자리부터 시계 화소가 불투명
         (알파 255)한 데까지 재어 가장 짧은 것 — 무대 x 625.0 →  채움 그림(무대 x 558.0, 폭 750) 안에서 67 / 750 = 0.0893
       ⚠ 몸통 오른쪽 가장자리(x 626..637)는 반투명 그림자다. 그 밑의 바는 비쳐 보이므로 그것까지 덮는다고 재면
         (예전 값 0.1066, 알파 40 이상을 몸통으로 셈) 0초에도 채움 350화소가 비쳐 12px 토막이 남았다(반박 검토가 찾음).
       ⚠ 그림 오른쪽 반짝이 점(x 107..130, 따로 떨어진 덩어리 셋)까지 재면 0.1440 이 되어 더 많이 남는다.
       채움 잉크 끝: 그림 750px 중 x 725 까지 → 726 / 750 = 0.968
     CSS 의 .timer-fill · .timer-clock 자리를 바꾸면 다시 잰다.
     2차 검수 공통-5(2026-10-12)로 시계와 채움 그림을 함께 22.35px 왼쪽으로 옮겼다 — 위의 무대 x 는 이제 602.6 · 535.7 이고,
     둘 사이 거리가 그대로라 두 비율(0.0893 · 0.968)은 바뀌지 않는다(tests/second-round.test.mjs 가 그림에서 다시 잰다). */
  const TIMER_FILL_VISIBLE_START = 0.0893;
  const TIMER_FILL_INK_END = 0.968;
  const SHELL_CLOSED_HOLD_MS = 110;
  const SHELL_HALF_HOLD_MS = 120;
  const SHELL_OPEN_STAGGER_MS = 70;
  // 2026-10-02 사장님 "한글 표기는 전부 이걸 사용"(14:20 ExtraBold 로 바꿈): 한글 글꼴은 나눔스퀘어라운드 ExtraBold(styles.css @font-face).
  // 조개 뜻 칸은 글자 폭을 재서 크기를 맞추므로(fitQuestionText) 이 글꼴이 오기 전에 재면 대체 글꼴 폭으로 굳는다.
  // 그래서 처음부터 받아 두고, 시작 버튼은 받은 뒤에 연다. 못 받거나 늦으면 KOREAN_FONT_WAIT_MS 뒤에 그대로 열고
  // (CSS font-display: block 이 대체 글꼴로 넘어가는 3초와 같다), 늦게 도착하면 그때 조개 뜻을 다시 맞춘다.
  // document.fonts.ready 는 이미 요청된 글꼴만 기다리므로 아직 화면에 한글이 없을 때는 이 글꼴을 기다려 주지 않는다.
  // 같은 파일을 두 이름으로 쓴다: 한글 창 전체용과 영문 글꼴 뒤 한글 대체용(조개 뜻은 이쪽). 둘 다 받아 둔다.
  // 3초는 페이지를 연 때부터 센다 — 콘텐츠를 받은 뒤부터 세면 최대 대기가 "콘텐츠 시간 + 3초"가 되어 CSS 의 3초와 어긋난다.
  const KOREAN_FONTS = Object.freeze(['800 1em "NanumSquareRound Game"', '800 1em "NanumSquareRound Game Hangul"']);
  const KOREAN_FONT_WAIT_MS = 3_000;
  const koreanFontLoad = typeof document.fonts?.load === "function"
    ? Promise.all(KOREAN_FONTS.map((font) => Promise.resolve(document.fonts.load(font, "가")))).catch(() => [])
    : Promise.resolve([]);
  const koreanFontReady = Promise.race([
    koreanFontLoad,
    new Promise((resolve) => window.setTimeout(resolve, KOREAN_FONT_WAIT_MS)),
  ]);
  // 한글 창(도움말·오답노트·랭킹)의 영문 글자는 Lexend 로 그린다(14:59 "영문만 Lexend", 15:31 숫자·문장부호는 "나눔으로").
  // 창을 처음 열 때 받기 시작하면 그 사이 대체 글꼴로 그렸다가 바뀌므로, 한글 글꼴이 준비된 뒤 영문 글자 범위 이름
  // "Lexend Game Latin" 네 굵기를 미리 받아 둔다. 시작 버튼은 이것을 기다리지 않는다.
  const PANEL_LATIN_FONTS = Object.freeze(["400", "500", "600", "700"].map((weight) => `${weight} 1em "Lexend Game Latin"`));
  function preloadPanelLatinFonts() {
    if (typeof document.fonts?.load !== "function") return;
    PANEL_LATIN_FONTS.forEach((font) => {
      Promise.resolve().then(() => document.fonts.load(font, "A")).catch(() => {});
    });
  }
  void koreanFontReady.then(preloadPanelLatinFonts);
  // 오답 목록 표의 한글은 Bold 파일 이름(styles.css "NanumSquareRound Game List", 2026-10-15 "1번으로 통일 해")으로 그린다.
  // 창을 처음 열 때 받기 시작하면 font-display: block 동안 글자가 비므로 같은 때에 미리 받아 둔다. 시작 버튼은 기다리지 않는다.
  void koreanFontReady.then(() => {
    if (typeof document.fonts?.load !== "function") return;
    Promise.resolve().then(() => document.fonts.load('500 1em "NanumSquareRound Game List"', "가")).catch(() => {});
  });
  // 헤엄치는 여우 애니메이션(APNG, 36프레임 무한 루프) 한 벌만 있으므로
  // 세 상태 모두 같은 이미지를 쓰고, 정답·오답 반응은 CSS 애니메이션으로 준다.
  const CHARACTER_IMAGES = Object.freeze({
    idle: "assets/game/fox_swim2.png",
    correct: "assets/game/fox_swim2.png",
    incorrect: "assets/game/fox_swim2.png",
  });
  const START_CHARACTER_IMAGE = "assets/start/fox_swim2.png";
  const SOUND_ASSETS = Object.freeze({
    touch: "assets/sound/touch.mp3",
    correct: "assets/sound/success.mp3",
    incorrect: "assets/sound/fail.mp3",
  });

  // 배경음: 첫 사용자 동작 뒤 반복 재생하고 소리 버튼을 따른다 (형제 블록·OX·축구 방 배경음 기준).
  // 곡은 블록 방과 같은 파일이다.
  const BGM_SRC = "assets/sound/bgm/glockenspiel_acoustic_kids_bgm_loop.mp3";
  // 효과음은 볼륨을 따로 두지 않아 기본 크기로 나오므로 배경음은 그 아래에 깐다.
  const BGM_VOLUME = 0.15;
  // 브라우저 자동재생 정책상 사용자 동작이 있어야 소리를 낼 수 있다.
  const BGM_GESTURE_EVENTS = Object.freeze([
    "pointerup",
    "click",
    "touchend",
    "keydown",
  ]);

  // 검수 4차 5항(사장님 지시): 리워드 등급 기준.
  //   Try again  70% 미만 정답        Good  70~99%        Excellent  100%
  // 비율은 "전체 제공 문제수" 기준이다. 정확히 70% 는 Good 으로 본다
  // (사장님 그림에 70~71% 사이가 비어 있고 단정적인 규칙은 "70% 미만이면 Try again" 뿐이다).
  // 경계는 여기 한 곳에서만 바꾼다.
  const RESULT_TIER_RATIOS = Object.freeze({ excellent: 1, good: 0.7 });

  // 검수 4차 7항: 캐시 버전 숫자를 여기 박지 않는다. index.html 이 스타일시트에 달아 둔
  // ?v=... 를 한 번 읽어 쓴다 — 출처가 하나라 다음 차수에 어긋나지 않는다. 없으면 빈 문자열이다.
  let cachedAssetVersion = null;
  function assetVersion() {
    if (cachedAssetVersion === null) {
      const href = document.querySelector('link[rel="stylesheet"]')?.getAttribute("href") || "";
      const found = href.match(/\?v=[^"'&\s]+/);
      cachedAssetVersion = found ? found[0] : "";
    }
    return cachedAssetVersion;
  }

  // 여우 그림은 제목과 같은 칸에 둔다 — 등급 분기가 하나뿐이라 둘이 어긋날 수 없다.
  // 새로 받은 파일이라 캐시에 남은 옛 판이 없다. 그래서 버전을 달지 않는다
  // (바꾸지 않은 그림에 버전을 달면 차수마다 자산 전체를 다시 내려받게 된다).
  // 검수 4차: 그림 주소에는 언제나 캐시 버전을 붙인다. 다만 값은 그 파일이 실제로 바뀔 때만 올린다.
  // 여우 세 장이 들어온 차수 값으로 고정한다 — 스타일시트 버전을 읽는 assetVersion() 을 쓰면
  // 차수마다 값이 올라가 바뀌지도 않은 그림을 학습자가 다시 받는다.
  const FOX_VERSION = "?v=20260930-1";

  const RESULT_TITLE_ASSETS = Object.freeze({
    // result_text0 과 result_text1 은 내용이 바뀐 적이 없어 버전을 달지 않는다.
    excellent: { src: "assets/result/result_text0.png", alt: "Excellent", fox: `assets/result/excellent.png${FOX_VERSION}` },
    good: { src: "assets/result/result_text1.png", alt: "Good", fox: `assets/result/good.png${FOX_VERSION}` },
    // 3차 r10 으로 그림 내용이 바뀐 파일이다. 이름이 그대로라 버전을 달아야 옛 그림이 남지 않는다.
    tryAgain: {
      src: `assets/result/result_text2.png${assetVersion()}`,
      alt: "Try Again",
      fox: `assets/result/try_again.png${FOX_VERSION}`,
    },
  });

  // 검수 4차: 등급 여우를 미리 받아 디코드해 둔다.
  //   img.src 를 바꾸면 새 그림이 디코드될 때까지 img 에 남은 그림이 계속 그려진다.
  //   결과 화면은 src 를 바꾸는 같은 작업 안에서 켜지므로 그 사이가 그대로 보인다 —
  //   첫 판은 마크업 초기 그림이, 두 번째 판부터는 지난 판 등급 여우가 잠깐 남는다.
  //   주소는 위 표에서 읽는다. 따로 적지 않으므로 표와 어긋날 수 없고,
  //   마크업에 미리받기 링크를 더하지 않아 주소가 갈려 두 번 받는 일도 없다.
  const preloadedResultFoxes = Object.values(RESULT_TITLE_ASSETS).map((asset) => {
    const image = new Image();
    image.src = asset.fox;
    return image;
  });

  const PARTICLE_COLORS = Object.freeze([
    "#fff044",
    "#ff7338",
    "#25dfff",
    "#ff4ca8",
    "#ffffff",
    "#6bf06f",
  ]);

  function readGameConfig() {
    try {
      const config = JSON.parse(document.querySelector("#gameConfig")?.textContent || "{}");
      return config && typeof config === "object" ? config : {};
    } catch {
      return {};
    }
  }

  const gameConfig = readGameConfig();
  const questionDurationMs = Math.max(
    1_000,
    Number(gameConfig.timing?.questionDurationMs) || DEFAULT_QUESTION_DURATION_MS,
  );
  const scoring = Object.freeze({
    correct: Number(gameConfig.scoring?.correct) || 100,
    incorrect: Number(gameConfig.scoring?.incorrect) || -10,
    comboEvery: Math.max(1, Math.trunc(Number(gameConfig.scoring?.comboEvery) || 3)),
    comboBonus: Number(gameConfig.scoring?.comboBonus) || 100,
  });

  let totalDurationMs = FALLBACK_DURATION_MS;
  // 2차 수정 14번(공통 기준): 가장 최근에 화면에 나온 단어. 새 판(Try Again · 처음으로 → Start)의 첫 단어로 바로
  // 잇지 않으려고 판이 바뀌어도 지우지 않는다. 페이지 안에서만 기억한다(브라우저 저장소에 남기지 않는다).
  let lastShownWordKey = null;
  let questions = [];
  let launchContext = null;

  const elements = {
    stage: document.querySelector("#game-stage"),
    startScreen: document.querySelector("#start-screen"),
    startCharacter: document.querySelector(".start-character"),
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
    english: document.querySelector("#word-english"),
    score: document.querySelector("#score-value"),
    scoreDelta: document.querySelector("#score-delta"),
    scoreBurst: document.querySelector("#score-burst"),
    time: document.querySelector("#time-value"),
    timerFill: document.querySelector("#timer-fill"),
    timerClock: document.querySelector(".timer-clock"),
    bonusMeter: document.querySelector("#bonus-meter"),
    bonusSlots: Array.from(document.querySelectorAll(".bonus-slot")),
    bonusGain: document.querySelector("#bonus-gain"),
    bonusGainValue: document.querySelector("#bonus-gain .bonus-gain-value"),
    bonusStepGains: Array.from(document.querySelectorAll(".bonus-step-gain")),
    buttons: Array.from(document.querySelectorAll(".shell-button")),
    character: document.querySelector(".character"),
    status: document.querySelector("#game-status"),
    endScreen: document.querySelector("#end-screen"),
    resultHomeButton: document.querySelector("#result-home-button"),
    resultParticleCanvas: document.querySelector("#result-particle-canvas"),
    resultTitle: document.querySelector("#result-title"),
    resultFox: document.querySelector("#result-fox-image"),
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
    score: 0,
    streak: 0,
    questionOrder: [],
    orderPosition: 0,
    currentQuestion: null,
    currentAnsweredCorrectly: false,
    gameStartedAt: 0,
    questionStartedAt: 0,
    animationFrameId: 0,
    feedbackTimerId: 0,
    locked: false,
    ended: false,
    correctPoints: 0,
    incorrectPoints: 0,
    bonusPoints: 0,
    correctCount: 0,
    incorrectCount: 0,
    timeoutCount: 0,
    // 등급은 "전체 제공 문제수" 기준이라 같은 단어를 여러 번 맞혀도 한 번만 센다.
    // 이 방은 문제 목록이 한 바퀴 돌면 다시 섞여 반복되기 때문이다.
    correctQuestionKeys: new Set(),
    historyRequested: false,
    resultRequestToken: 0,
    shellTimerIds: [],
  };
  const incorrectAnswerRecords = new Map();
  let comboBurstTimer = null;
  let scoreDeltaTimer = null;
  let bonusBurstTimer = null;
  let resultParticleFrame = 0;
  let resultParticles = [];
  let contentRequestToken = 0;
  let resultDialogReturnFocus = null;
  let incorrectDialogReturnFocus = null;
  let incorrectAnswerSequence = 0;
  let activeIncorrectAudio = null;
  let activeQuestionAudio = null;
  let resultDialogRequestToken = 0;
  let startRankingRequestToken = 0;
  let helpRequestToken = 0;
  let helpReturnFocus = null;
  let currentScreen = "loading";
  let soundEnabled = true;
  let bgmAudio = null;
  let bgmWanted = false;
  // 검수 4차 9-2: X 버튼은 점수 저장이 끝난 뒤에 시작 화면으로 간다.
  let persistPromise = null;
  let bgmGestureHandler = null;
  let toastTimer = 0;
  const activeEffectAudios = new Set();

  function formatScore(value) {
    // 검수 4차 10항: 이 방 점수 상수는 서버 설정에서 온다(scoring.correct 등에 정수 강제가 없다).
    // 소수가 섞이면 Math.trunc 는 참값보다 한 점 낮게 찍는다(999.6 -> 999). 굴림 연출이 없어도 생긴다.
    // 반올림 결과가 0 이면 그냥 0 으로 눕힌다 — Math.round(-0.4) 는 -0 이고 그대로 쓰면 화면에 "-0" 이 뜬다.
    const rounded = Math.round(Number(value) || 0);
    return (rounded === 0 ? 0 : rounded).toLocaleString("en-US");
  }

  function emitNavigation(screen, detail = {}) {
    // 검수 4차: 취소 가능하게 쏜다. 감싸는 쪽이 preventDefault() 로 막으면 우리는 아무것도 하지 않는다.
    return window.dispatchEvent(new CustomEvent("wordmatch:navigate", {
      detail: { screen, ...detail },
      cancelable: true,
    }));
  }

  // 검수 4차: 밖에서 받은 주소는 이 검사를 통과할 때만 쓴다. 어느 검사가 무엇을 막는지 직접 재 두었다.
  //   host  — //evil.example/steal 과 file://evil.example/x 를 혼자 막는다. file:// 기준에서 이 둘의
  //           출처는 기준과 똑같아서(Chrome 은 양쪽 다 "file://") 출처 비교로는 걸리지 않는다. 실제 구멍은 이것이다.
  //   허용목록 — 페이지 자신이 data: 나 about: 에 떠 있을 때 같은 프로토콜의 주소를 혼자 막는다.
  //           납품 기준(file: · https:)에서는 홀로 일하는 자리가 없다 — 그 기준에서는 protocol 이 같은 일을
  //           이미 하기 때문이다. 과대평가하지 말고, 대신 지우지도 말 것(기준이 바뀌면 이것만 남는다).
  //   origin·protocol — 둘이 함께 있어야 하고, 어느 하나만으로 막히는 입력은 두 엔진 모두에 없다.
  //           (재서 확인: origin 만 지워도 · protocol 만 지워도 검사는 안 떨어지고, 둘 다 지우면 떨어진다.
  //            Chrome 이 file:// 문서에 주는 origin 은 "file://" 상수, node 는 "null" 상수라 어느 쪽도 홀로
  //            일하지 못한다.) 엔진이 달라질 때 한쪽이 남도록 둘 다 둔다.
  //   막지 않는 것 — 같은 호스트의 다른 경로다. file:// 기준에서 host 는 늘 "" 이므로 file:///… 로 시작하는
  //           아무 경로나 통과한다. 이 방 납품본에는 close_url 을 만들어 주는 쪽이 없으므로 지금은
  //           바깥에서 링크를 건네야만 닿는다. 경로 하한은 사장님 판단을 받고 따로 넣는다.
  //   엔진 차이 하나 더 — file://localhost/x 는 node 가 host 를 "" 로 눕혀 통과시키고 Chrome 은
  //           host="localhost" 로 남겨 막는다. 아래 검사는 node 에서 도니 이 입력의 판정은 Chrome 이 더 엄하다.
  const CLOSE_URL_PROTOCOLS = Object.freeze(["http:", "https:", "file:"]);

  function sameOriginUrl(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    let here;
    let there;
    try {
      here = new URL(window.location.href);
      there = new URL(text, window.location.href);
    } catch {
      return null;
    }
    const ok = there.origin === here.origin
      && there.protocol === here.protocol
      && there.host === here.host
      && CLOSE_URL_PROTOCOLS.includes(there.protocol);
    return ok ? there.href : null;
  }

  // 폴더로 끝나는 주소는 그 폴더의 index.html 을 뜻한다(이 게임들은 늘 index.html 로 뜬다).
  // 눕혀 놓고 견주지 않으면 ./ 가 지금 문서와 같은 것을 못 알아본다.
  function documentPath(url) {
    return url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  }

  // 게임 자신을 가리키는 주소는 나가기가 아니다 — 사장님 문구 "닫기 주소가 게임 자신의 경로를
  // 가리킬 때도 막기"(2026-09-30). 질의문자와 조각을 빼고 경로로 견준다.
  //   조각(#…)만 다른 주소는 화면을 그대로 두고, 질의만 다른 주소는 게임을 새로 읽을 뿐이다.
  //   어느 쪽도 성공으로 세면 뒤의 갈래를 건너뛰어 X 가 아무 일도 안 한 것처럼 보인다(직접 재서 확인).
  // 모음 페이지(../ 와 ../hub.html)는 경로가 달라 그대로 통과한다.
  function usableCloseUrl(value) {
    const href = sameOriginUrl(value);
    if (!href) return null;
    const here = new URL(window.location.href);
    const there = new URL(href);
    return documentPath(there) === documentPath(here) ? null : href;
  }

  // 주소창 인자는 배포 루트 아래만 받는다 — 사장님 문구 "주소창 인자에만 넣기"(2026-09-30).
  // 루트는 이 문서가 든 폴더의 부모다. 문자열을 직접 이어 붙이면 안 된다 — new URL("../", …) 은 끝에
  // 슬래시를 붙여 주고, 그 슬래시를 떼면 이름이 겹치는 형제 폴더가 통째로 통과한다(…/x 는 …/x-evil 도 먹는다).
  function deployRootHref() {
    try {
      return new URL("../", window.location.href).href;
    } catch {
      return null;
    }
  }

  // 루트 검사는 반드시 같은-출처 검사를 통과한 뒤에 건다. 순서를 바꾸면 javascript: 주소가
  // startsWith 에서 그냥 거짓이 되어, 규약 검사가 빠져도 아무도 모르게 된다.
  function closeUrlInDeployRoot(value) {
    const href = usableCloseUrl(value);
    if (!href) return null;
    const root = deployRootHref();
    return root && href.startsWith(root) ? href : null;
  }

  function closeUrlFromQuery() {
    try {
      return closeUrlInDeployRoot(new URL(window.location.href).searchParams.get("close_url"));
    } catch {
      return null;
    }
  }

  // 설정값에는 루트 제한을 걸지 않는다 — 납품본에 박힌 값이고, 루트 밖으로 닫아야 하는 운영이 있다.
  // 같은-출처 검사와 같은-문서 검사는 이쪽도 그대로 지난다.
  function closeUrlFromConfig() {
    return usableCloseUrl(gameConfig.deployment?.closeUrl);
  }

  function referrerIsSameOrigin() {
    return Boolean(sameOriginUrl(window.document.referrer));
  }

  // [앱 전용 자리] 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — 리틀폭스가 앱(Android · iOS)에 올릴 때 직접 작업한다.
  // 지금은 비어 있다. 화면에 알림은 띄우지 않는다(사장님 2026-10-12 "함수 자리만 표시").
  // 이름은 12개 게임이 모두 같다(2차 검수 공통-12, 사장님 "closeAppWebView() … 모든 컨텐츠에 적용"). 앱인지 웹인지 가르지 않고 먼저 부른다
  // — 다만 바깥(wordmatch:navigate 를 받는 쪽)이 닫기를 막으면 이것도 부르지 않는다(이 방의 2026-09-30 규칙 "바깥에서 막으면 이동하지 않는다").
  function closeAppWebView() {}

  // 게임을 닫는다 — 시작 화면의 X 버튼(2차 검수 공통-12 "웹 : 창 닫기 / 앱 : 웹뷰 닫는 인터페이스 호출").
  // 순서: 바깥이 막으면 끝 → 앱 닫기 자리 → (닫기 주소를 받았으면 그리로) → 창 닫기 → 안 닫혔고 같은 곳에서 왔으면 이전 페이지.
  // 전에는 같은 곳에서 왔으면 뒤로 가기부터 했는데, 웹은 새 창으로 열려 돌아갈 기록이 없으니 창 닫기를 앞에 둔다.
  function leaveGame() {
    if (!emitNavigation("close")) return;
    closeAppWebView();
    const target = closeUrlFromQuery() || closeUrlFromConfig();
    if (target) {
      window.location.assign(target);
      return;
    }
    // window.close() 는 스크립트가 연 창에서만 듣는다. 주소를 직접 연 탭 · 링크로 들어온 같은 탭 · 앱 웹뷰에서는
    // 브라우저가 닫아 주지 않아 window.closed 가 거짓으로 남는다 — 그때만 예전처럼 이전 페이지로 돌아간다.
    // 안내 문구는 쓰지 않는다 — 사장님 문구 "close토스트 사용하지마"(2026-09-30).
    // 닫지 못한 사실은 위에서 쏜 wordmatch:navigate 를 받은 쪽이 처리한다.
    window.close();
    // 뒤로 가기 여부는 referrer 로 본다. history.length 는 우리 화면 전환까지 세어 믿을 수 없고,
    // file:// 은 referrer 가 비어 있어 이 갈래가 저절로 걸러진다.
    // OX 방은 창이 안 닫히면 늘 뒤로 가지만, 이 방은 같은 곳에서 왔을 때만 간다(2026-09-30 규칙 — 축구 · 레이싱도 같다).
    if (!window.closed && referrerIsSameOrigin()) window.history.back();
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

  function playAudioSource(source) {
    const soundUrl = String(source || "").trim();
    if (!soundEnabled || !soundUrl) return null;

    const audio = new Audio(soundUrl);
    activeEffectAudios.add(audio);
    const cleanup = () => activeEffectAudios.delete(audio);
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    audio.play()?.catch(cleanup);
    return audio;
  }

  function playSound(name) {
    return playAudioSource(SOUND_ASSETS[name]);
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
    if (!soundEnabled || !bgmWanted) return;
    // 검수 4차 9-3: 결과 화면에서는 배경음을 시작하지 않는다.
    // 멈추는 것만으로는 두 경로로 되살아난다 — 탭을 떠났다 돌아올 때(visibilitychange)와,
    // 자동재생이 막혀 걸어 둔 제스처 리스너가 결과 화면의 클릭·키 입력에 반응할 때다.
    // 그래서 "멈추는 곳"이 아니라 배경음을 실제로 트는 이 한 곳에서 막는다.
    // soundEnabled 와 bgmWanted 는 건드리지 않아 시작 화면으로 가면 원래대로 난다.
    if (currentScreen === "result") return;
    // 자동재생이 막히면 다음 사용자 동작에서 다시 시도한다.
    ensureBgm().play()?.catch(() => armBgmOnGesture());
  }

  function armBgmOnGesture() {
    if (bgmGestureHandler) return;
    bgmGestureHandler = () => {
      BGM_GESTURE_EVENTS.forEach((type) => {
        document.removeEventListener(type, bgmGestureHandler, true);
      });
      bgmGestureHandler = null;
      armBgm();
    };
    BGM_GESTURE_EVENTS.forEach((type) => {
      document.addEventListener(type, bgmGestureHandler, { capture: true, passive: true });
    });
  }

  function armBgm() {
    bgmWanted = true;
    resumeBgm();
  }

  function pauseBgm() {
    bgmAudio?.pause();
  }

  function isLoggedInMember() {
    return Boolean(launchContext && !launchContext.isGuest && !launchContext.isDemo);
  }

  function stopQuestionAudio() {
    if (activeQuestionAudio) {
      activeQuestionAudio.pause();
      try {
        activeQuestionAudio.currentTime = 0;
      } catch {
        // 메타데이터 로드 전 currentTime 변경을 허용하지 않는 브라우저가 있다.
      }
      activeQuestionAudio = null;
    }
  }

  // 새 문제가 뜰 때 단어 발음을 한 번 들려준다(회원만 · 소리 설정을 따른다).
  // 2차 검수 WM공통-1: 문제 카드의 단어 듣기 버튼은 지웠다 — 다시 듣는 길은 없고, 이 자동 발음과 오답 목록의 스피커는 그대로다.
  function playQuestionAudio() {
    if (!isLoggedInMember()) return;

    const soundUrl = String(state.currentQuestion?.soundUrl || "").trim();
    if (!soundUrl || !soundEnabled) return;

    stopQuestionAudio();
    const audio = new Audio(soundUrl);
    activeQuestionAudio = audio;
    const finish = () => {
      if (activeQuestionAudio !== audio) return;
      activeQuestionAudio = null;
    };
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    audio.play()?.catch(() => {
      if (activeQuestionAudio !== audio) return;
      finish();
    });
  }

  function updateSoundUI() {
    elements.soundIcon.src = soundEnabled
      ? "assets/btn_sound_on.png"
      : "assets/btn_sound_off.png";
    elements.soundButton.setAttribute("aria-pressed", String(soundEnabled));
    elements.soundButton.setAttribute("aria-label", soundEnabled ? "소리 끄기" : "소리 켜기");
  }

  // 시작 화면의 동화 정보 — API info 의 title(시리즈 제목) · subtitle(이야기 제목)을 로고와 Start 버튼 사이에 두 줄로 보여 준다
  // (2차 검수 공통-9 "시작화면 동화 정보 없음", 사장님 2026-10-12 "배치는 시작화면 로고와 버튼 사이").
  // 한 줄만 오면 그 줄만, 둘 다 없으면(테스트 모드 · 데모 · info 실패) 자리를 숨긴다 — 값을 지어 넣지 않는다.
  function renderStartStory(info) {
    const title = String(info?.title ?? "").trim();
    const subtitle = String(info?.subtitle ?? "").trim();
    elements.startStoryTitle.textContent = title;
    elements.startStorySubtitle.textContent = subtitle;
    elements.startStoryTitle.hidden = !title;
    elements.startStorySubtitle.hidden = !subtitle;
    elements.startStory.hidden = !title && !subtitle;
  }

  // 동화 정보 글자를 자리 폭에 맞춘다 — 길면 자르지 않고 두 줄을 같은 배율로 줄인다
  // (사장님 2026-10-12 "글자가 길어지면 폰트 크기를 줄이게"). 배율은 CSS 의 기준 크기(.start-story)에 곱한다.
  // 바닥(0.5배)에서도 넘치면 그때만 CSS 의 말줄임이 남는다. 화면에 보일 때만 잴 수 있다 — 숨어 있으면 폭이 0 이다.
  // 그래서 시작 화면이 아닐 때 불리면(도움말이 열린 사이 글꼴이 도착하는 경우) 손대지 않는다 — 배율을 1 로 되돌려 놓으면
  // 시작 화면으로 돌아왔을 때 긴 제목이 잘린 채 남는다. 시작 화면이 보일 때마다 setScreen 이 다시 잰다.
  function fitStartStory() {
    const story = elements.startStory;
    if (story.hidden || currentScreen !== "start" || story.clientWidth === 0) return;
    const lines = [elements.startStoryTitle, elements.startStorySubtitle].filter((line) => !line.hidden);
    const minimumScale = 0.5;
    const step = 0.02;
    let scale = 1;
    story.style.setProperty("--start-story-scale", "1");
    while (scale > minimumScale && lines.some((line) => line.scrollWidth > line.clientWidth)) {
      scale = Math.max(minimumScale, Number((scale - step).toFixed(2)));
      story.style.setProperty("--start-story-scale", String(scale));
    }
  }

  function setStartReady(ready) {
    elements.startButton.disabled = !ready;
    elements.startButton.setAttribute("aria-busy", String(!ready));
    elements.startRankingButton.disabled = !ready;
    elements.helpButton.disabled = !ready;
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
    // 동화 정보 글자 맞춤은 시작 화면이 보인 뒤에 잰다(게임 · 결과 · 도움말에서 돌아올 때마다).
    if (screen === "start") requestAnimationFrame(fitStartStory);
    elements.helpScreen.hidden = screen !== "help";
    elements.playScreen.hidden = screen !== "play";

    const resultVisible = screen === "result";
    elements.endScreen.classList.toggle("is-visible", resultVisible);
    elements.endScreen.setAttribute("aria-hidden", String(!resultVisible));
    elements.stage.classList.toggle("result-mode", resultVisible);

    const controlsVisible = screen === "start" || screen === "help" || screen === "play";
    // 2차 수정 2번(공통 기준): 도움말 화면에서만 X 대신 뒤로가기 그림을 쓰고 그 버튼을 스피커 자리(왼쪽 위)로 옮긴다.
    // 도움말 화면에서는 스피커를 숨긴다. 시작·게임 화면은 그대로다(검수 r27·r12 의 X 버튼). 자리는 CSS 의 help-mode.
    const helpVisible = screen === "help";
    elements.soundButton.hidden = !controlsVisible || helpVisible;
    elements.navigationButton.hidden = !controlsVisible;
    elements.stage.classList.toggle("help-mode", helpVisible);

    const closesGame = screen === "start";
    elements.navigationIcon.src = helpVisible ? "assets/btn_back.png" : "assets/btn_close.png";
    elements.navigationButton.setAttribute(
      "aria-label",
      closesGame
        ? "게임 닫기"
        : helpVisible ? "뒤로 가기" : "시작 화면으로 돌아가기",
    );
  }

  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
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
    setStartReady(questions.length >= 2);
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
    // 2차 수정 11번: 소리를 꺼 두어도 오답노트 단어 발음은 누르면 난다 — 학습자가 직접 고른 소리다.
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

  function getIncorrectAnswerMeaning(question) {
    return String(
      question?.correctMeaning
      || question?.choices?.[question?.answerIndex]
      || "",
    ).trim();
  }

  function getIncorrectAnswerKey(question) {
    return String(question?.english || "").trim().toLocaleLowerCase("en-US");
  }

  function updateIncorrectAnswersButton() {
    const records = [...incorrectAnswerRecords.values()];
    elements.incorrectAnswersButton.disabled = records.length === 0;
    elements.incorrectAnswersButton.setAttribute(
      "aria-label",
      records.length > 0 ? `오답 보기, ${records.length}개 단어` : "오답 없음",
    );
  }

  // 2차 검수 WM4-1 · 공통-10: 오답 목록에는 실제로 틀리게 누른 단어 · 시간이 지나 못 맞힌 단어 · 판이 끝날 때 떠 있던 단어만 싣는다
  // (같은 단어는 한 줄). 화면에 나오지 못한 단어는 싣지 않는다 — 전에는 그것까지 실어(2026-10-01) 단어가 많은 판에서
  // 몇 문제만 풀어도 Incorrect 가 수십 개로 나왔다(검수표 "20문제 … 오답 53개"). 결과 화면의 Incorrect 는 이 목록의 줄 수다.
  function recordIncorrectAnswer(question) {
    const key = getIncorrectAnswerKey(question);
    if (!key) return;
    // 검수 4차 6항 절충안(사장님 확정): 오답노트에 담는 것은 그대로 두고,
    // "틀린 적 없이 맞힌 문항"이 반복 바퀴에서 다시 실리는 것만 막는다.
    //   한 번이라도 틀림 → 이미 목록에 있어 이 조건에 걸리지 않는다(그대로 남고 횟수도 오른다)
    //   끝내 못 맞힘   → 맞힌 집합에 없어 걸리지 않는다(q58 대로 들어간다)
    //   맞혔고 틀린 적 없음 → 둘 다 해당해 걸린다(넣지 않는다)
    if (state.correctQuestionKeys.has(key) && !incorrectAnswerRecords.has(key)) return;

    const soundUrl = String(question?.soundUrl || "").trim();
    const existing = incorrectAnswerRecords.get(key);
    if (existing) {
      existing.wrongCount += 1;
      if (!existing.soundUrl && soundUrl) existing.soundUrl = soundUrl;
    } else {
      incorrectAnswerRecords.set(key, {
        english: String(question?.english || "").trim(),
        correctMeaning: getIncorrectAnswerMeaning(question),
        soundUrl,
        wrongCount: 1,
        sequence: incorrectAnswerSequence,
      });
      incorrectAnswerSequence += 1;
    }
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
    // 긴 단어만 칸에 맞게 줄인다. 값은 배율이다 — CSS 의 기준 크기(.incorrect-answer-word, 1920 기준 30px)에 곱한다.
    const minimumScale = 0.73; // 1920 기준 약 22px
    const step = 0.02;
    cell.style.setProperty("--incorrect-word-scale", "1");
    for (let scale = 1; scale > minimumScale && element.scrollWidth > element.clientWidth; scale -= step) {
      cell.style.setProperty("--incorrect-word-scale", (scale - step).toFixed(2));
    }
  }

  function renderIncorrectAnswerList() {
    elements.incorrectAnswerList.replaceChildren();
    const records = [...incorrectAnswerRecords.values()].sort(
      (left, right) => right.wrongCount - left.wrongCount || left.sequence - right.sequence,
    );

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
      speakerIcon.src = "assets/incorrect-answer/icon_speaker.png";
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
      wordText.textContent = record.english;
      wordCell.append(wordText);

      const meaningCell = createIncorrectAnswerCell("incorrect-answer-meaning");
      meaningCell.textContent = record.correctMeaning || "정답 뜻 확인 필요";

      row.append(audioCell, wordCell, meaningCell);
      fragment.append(row);
    });

    elements.incorrectAnswerList.append(fragment);
    elements.incorrectAnswerList.scrollTop = 0;
    const fitWords = () => {
      elements.incorrectAnswerList
        .querySelectorAll(".incorrect-answer-word-text")
        .forEach(fitIncorrectWordText);
    };
    requestAnimationFrame(fitWords);
    // 2차 검수 공통-1 로 단어 굵기가 400 이 됐다. 그 글꼴(Lexend 400)은 이 팝업에서 처음 쓰여 늦게 올 수 있고, 대체 글꼴로 잰 폭은
    // 좁아 긴 구문이 잘릴 수 있다(OX 방이 겪음). 글꼴을 받은 뒤 한 번 더 맞춘다.
    document.fonts?.load?.('400 1em "Lexend Game"')?.then(fitWords, () => {});
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
    if (incorrectAnswerRecords.size === 0) return;
    resultDialogRequestToken += 1;
    closeResultDialog({ restoreFocus: false });
    incorrectDialogReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : elements.incorrectAnswersButton;
    renderIncorrectAnswerList();
    elements.incorrectAnswerDialog.hidden = false;
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
        elements.startRankingButton.disabled = false;
      }
    }
  }

  function getResultTitleAsset() {
    // 분모는 푼 문제수가 아니라 전체 제공 문제수다(사장님이 괄호로 못 박으셨다).
    // 목록이 반복되므로 분자는 "맞힌 서로 다른 문항 수"이고, 비율은 1 을 넘지 않는다.
    const provided = questions.length;
    const correctRatio = provided > 0
      ? Math.min(1, state.correctQuestionKeys.size / provided)
      : 0;
    if (correctRatio >= RESULT_TIER_RATIOS.excellent) return RESULT_TITLE_ASSETS.excellent;
    if (correctRatio >= RESULT_TIER_RATIOS.good) return RESULT_TITLE_ASSETS.good;
    return RESULT_TITLE_ASSETS.tryAgain;
  }

  function renderResultRankAndScore(rank, score) {
    const normalizedRank = Math.trunc(Number(rank) || 0);
    const scoreText = formatScore(score);
    elements.resultRank.textContent = normalizedRank > 0 ? `${formatScore(normalizedRank)}위` : "-";
    elements.resultScoreNumber.textContent = scoreText;
    elements.resultTotalScore.setAttribute("aria-label", `${scoreText}점`);
  }

  function renderResultBreakdown() {
    const titleAsset = getResultTitleAsset();
    elements.resultTitle.src = titleAsset.src;
    elements.resultTitle.alt = titleAsset.alt;
    elements.resultFox.src = titleAsset.fox;
    // Correct 와 Incorrect 는 점수 합이 아니라 개수다. Bonus 와 My Score 는 점수 그대로다.
    // Correct 는 맞힌 서로 다른 문항 수다.
    // Incorrect 는 오답 목록(Incorrect Answers)의 줄 수다(2차 검수 WM4-1 · 공통-10) — 두 숫자가 늘 같다.
    // 틀렸다가 같은 문제를 맞힌 단어는 목록에 남으므로 Correct 와 Incorrect 양쪽에 세일 수 있다.
    // 등급(getResultTitleAsset)은 Incorrect 를 쓰지 않는다 — 맞힌 서로 다른 문항 수 ÷ 전체 제공 문제수 그대로다.
    const correctCount = state.correctQuestionKeys.size;
    const incorrectCount = incorrectAnswerRecords.size;
    // 2차 검수 공통-2: 숫자 뒤의 "개" 와 Bonus 앞의 "+" 는 쓰지 않는다. Bonus 의 "점" 은 CSS(.result-points::after)가 붙인다.
    elements.resultCorrectPoints.textContent = formatScore(correctCount);
    elements.resultIncorrectPoints.textContent = formatScore(incorrectCount);
    elements.resultBonusPoints.textContent = formatScore(Math.max(0, state.bonusPoints));
    elements.resultCorrectPoints.setAttribute(
      "aria-label",
      `맞힌 문항 ${formatScore(correctCount)}개`,
    );
    elements.resultIncorrectPoints.setAttribute(
      "aria-label",
      `오답 문항 ${formatScore(incorrectCount)}개`,
    );
    elements.resultBonusPoints.setAttribute(
      "aria-label",
      `보너스 점수 ${formatScore(state.bonusPoints)}점`,
    );
    renderResultRankAndScore(0, state.score);
    updateIncorrectAnswersButton();
    const rankingAvailable = Boolean(launchContext && !launchContext.isGuest && !launchContext.isDemo);
    elements.rankingButton.disabled = true;
    elements.rankingButton.setAttribute(
      "aria-label",
      rankingAvailable
        ? "점수 저장 후 랭킹을 볼 수 있습니다"
        : "게스트 또는 데모 모드에서는 랭킹을 사용할 수 없습니다",
    );
  }

  async function persistResult() {
    if (state.historyRequested) return;
    state.historyRequested = true;
    const token = ++state.resultRequestToken;
    elements.resultMessage.textContent = launchContext?.isTest
      ? `${launchContext.testMode === "member" ? "로그인" : "게스트"} 테스트 결과를 확인하고 있습니다.`
      : launchContext?.isDemo
        ? "데모 모드 결과입니다."
        : "점수 결과를 확인하고 있습니다.";

    try {
      const result = await window.WordMatchContent.saveHistory(state.score);
      if (token !== state.resultRequestToken || !state.ended) return;
      if (result?.skipped) {
        elements.resultMessage.textContent = "데모 모드에서는 점수를 저장하지 않습니다.";
        return;
      }
      renderResultRankAndScore(result?.rank, result?.score ?? state.score);
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
      const rankingAvailable = Boolean(
        launchContext && !launchContext.isGuest && !launchContext.isDemo,
      );
      if (token === state.resultRequestToken && state.ended && rankingAvailable) {
        elements.rankingButton.disabled = false;
        elements.rankingButton.setAttribute("aria-label", "랭킹 보기");
      }
    }
  }

  // 2차 수정 14번: 새 판의 첫 단어가 앞 판 마지막 단어(previousKey)와 같으면 다른 자리와 바꾼다.
  // 이 방은 단어마다 문제가 하나라(content-loader 의 questionsFromWords) 단어로 묶을 필요는 없다.
  function shuffleQuestionOrder(previousKey = null) {
    const order = questions.map((_, index) => index);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
    }
    if (previousKey !== null && order.length > 1 && getIncorrectAnswerKey(questions[order[0]]) === previousKey) {
      const swapIndex = 1 + Math.floor(Math.random() * (order.length - 1));
      [order[0], order[swapIndex]] = [order[swapIndex], order[0]];
    }
    return order;
  }

  // 2차 수정 12번: API info 의 play_time(초)을 한 판 시간(ms)으로 바꾼다. 알 수 없으면 40초(OX 와 같은 규칙).
  // 숫자이거나 숫자만 적힌 문자열만 받는다 — Number(true) 는 1, Number("") 는 0 이라 그대로 쓰면 1초 판이나 0초 판이 된다.
  // 유한한지는 ms 로 바꾼 뒤에 본다 — 1e306 초는 유한하지만 ×1000 하면 Infinity 라 판이 끝나지 않는다.
  // 데모·테스트 모드에는 API 시간이 없다(로더가 넣는 데모 30초는 이 맥의 설정이라 쓰지 않는다).
  // 상한·하한은 두지 않는다 — 잘못된 값은 API 쪽에서 고친다(공통 기준).
  function resolveDurationMs(info, launch) {
    if (!launch || launch.isTest || launch.isDemo) return FALLBACK_DURATION_MS;
    const raw = info?.play_time;
    const seconds = typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(raw) ? Number(raw) : NaN;
    const milliseconds = seconds * 1000;
    return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : FALLBACK_DURATION_MS;
  }

  function formatTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  // 검수 r26: 최대 크기로 그리고, 상자를 넘치면 최소 크기까지 한 단계씩 줄인다.
  // 2차 수정(공통 기준 "긴 글자 — 칸에 맞게 줄임, 단어는 빼지 않음", 사장님 축구 답 "컨텐츠에서는 칸에 맞게"):
  // 최소로도 넘치면 잘라 단어를 빼는 대신 아래에서 비율로 더 줄인다. r26 의 "최소가 바닥"은 이 결정으로 바뀌었다.
  // 영문은 최소 아래 한 줄로 내려가지 않고 두 줄로 나뉜다(fitEnglishText). 한글 뜻은 예전에 18자 넘는 것을 로더가
  // 문제에서 뺐는데 그 걸러내기도 걷었다 — 긴 뜻은 조개 칸 안에서 줄어든다. 지나치게 긴 값은 서버에서 고친다.
  function fitQuestionText(element, { maximumCqw, minimumCqw }) {
    const step = 0.12;
    let size = maximumCqw;
    element.style.fontSize = `${size}cqw`;

    while (
      size > minimumCqw
      && (element.scrollWidth > element.clientWidth + 1
        || element.scrollHeight > element.clientHeight + 1)
    ) {
      size = Math.max(minimumCqw, size - step);
      element.style.fontSize = `${size.toFixed(2)}cqw`;
    }

    // 2차 수정 15번(공통 기준 "긴 글자"): 서버가 내려주는 그대로 칸에 맞게 줄인다 — 단어는 빼지 않는다.
    // 최소 크기로도 넘치면(칸이 overflow: hidden 이라 그대로 두면 잘려 단어가 빠진다) 비율로 더 줄인다.
    // 칸 안쪽 여백은 글자 크기를 따라 줄지 않으므로 비율은 여백을 뺀 내용 상자로 잡고, 맞을 때까지 되풀이한다.
    // (OX 처럼 여백째 한 번만 비율을 곱하면 덜 줄어 — 띄어쓰기 없는 45자 단어가 23.6px 에서도 오른쪽 여백을
    //  53px 파고들어 가운데에서 벗어났다. 이 방 영문 칸 여백은 좌우 69px 다. 실제 크롬에서 잼.)
    for (
      let pass = 0;
      pass < 6 && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
      pass += 1
    ) {
      const box = getComputedStyle(element);
      const padX = parseFloat(box.paddingLeft) + parseFloat(box.paddingRight);
      const padY = parseFloat(box.paddingTop) + parseFloat(box.paddingBottom);
      const widthRatio = Math.max(1, element.clientWidth - padX) / Math.max(1, element.scrollWidth - padX);
      const heightRatio = Math.max(1, element.clientHeight - padY) / Math.max(1, element.scrollHeight - padY);
      const precisionRatio = Math.min(1, widthRatio, heightRatio) * 0.98;
      size = Math.max(0.1, size * precisionRatio);
      element.style.fontSize = `${size.toFixed(2)}cqw`;
    }
    return size;
  }

  /* 2차 수정 15번(공통 기준): 영문은 한 줄이 기본이다. 한 줄로 최소 크기(minimumCqw)까지 줄여도 칸에 안 들어갈 때만
     띄어쓰기 자리에서 두 줄로 나눈다 — 줄 길이는 CSS text-wrap: balance 가 고르게 맞추고, 두 줄 안에서 가장 크게 둔다.
     세 줄은 쓰지 않는다. 단어 데이터에 줄바꿈이 있으면(<br> 로 그렸다) 그 자리를 따르고 자동으로 나누지 않는다.
     띄어쓰기가 없는 한 단어는 나눌 자리가 없어 한 줄로 줄인다(글자 중간에서 자르지 않는다). OX 구현과 같다. */
  const ENGLISH_MAX_WRAPPED_LINES = 2;
  /* 단어 사이 간격. 줄바꿈 없는 공백(U+00A0)은 데이터가 붙여 두라는 뜻이라 단어를 가르지 않는다. */
  const ENGLISH_WORD_GAP = /[^\S\u00A0]+/;

  /* 줄 수는 단어 칸(.word-part) 안 글자 사각형의 높이로 센다. 영문 칸 전체를 고르면 단어 칸 자체의 상자도 함께 잡혀
     같은 줄을 두 번 센다(OX 가 실제 크롬에서 잼). 같은 줄 안의 작은 높이 차이는 글자 높이의 절반까지 한 줄로 본다. */
  function countRenderedLines(element) {
    const rects = [];
    element.querySelectorAll(".word-part").forEach((part) => {
      const range = document.createRange();
      range.selectNodeContents(part);
      rects.push(...range.getClientRects());
    });
    rects.sort((left, right) => left.top - right.top);
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

  function fitEnglishText(element, { maximumCqw, minimumCqw }) {
    element.classList.remove("is-wrapped");
    const oneLineCqw = fitQuestionText(element, { maximumCqw, minimumCqw });
    if (
      oneLineCqw >= minimumCqw
      || element.querySelector("br")
      || element.querySelectorAll(".word-part").length < 2
    ) {
      return oneLineCqw;
    }

    element.classList.add("is-wrapped");
    const step = 0.12;
    let size = maximumCqw;
    for (;;) {
      element.style.fontSize = `${size.toFixed(2)}cqw`;
      const fits = element.scrollWidth <= element.clientWidth + 1
        && element.scrollHeight <= element.clientHeight + 1;
      if ((fits && countRenderedLines(element) <= ENGLISH_MAX_WRAPPED_LINES) || size <= 0.1) return size;
      size = Math.max(0.1, size - step);
    }
  }

  // 검수 r7: 영단어는 모두 소문자로 표시한다.
  function formatEnglishLabel(value) {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
  }

  function fitRenderedQuestion() {
    // 검수 r26: 하한은 실로폰 텍스트 박스와 같은 2.4cqw.
    // 상한은 quiz_panel.png 의 남색 안쪽(102px)에 맞춰 4cqw로 잡는다. 실로폰 철자
    // 타일값 4.58cqw는 잉크 상하 여유가 18px뿐이라 흰 링에 붙어 보였다.
    fitEnglishText(elements.english, {
      maximumCqw: 4,
      minimumCqw: 2.4,
    });
    elements.buttons.forEach((button) => {
      fitQuestionText(button.querySelector(".shell-text"), {
        maximumCqw: 1.65,
        minimumCqw: 0.85,
      });
    });
  }

  function clearShellTimers() {
    state.shellTimerIds.forEach((id) => window.clearTimeout(id));
    state.shellTimerIds = [];
  }

  function setShellState(button, shellState) {
    const image = button.querySelector(".shell-image");
    const source = button.dataset[shellState];
    if (source && image.getAttribute("src") !== source) {
      image.src = source;
    }
    button.dataset.shellState = shellState;
    button.classList.toggle("is-open", shellState === "open");
  }

  function renderQuestion() {
    // 2차 수정 15번: 단어는 하나씩 줄바꿈 없는 칸(.word-part)에 넣는다. 두 줄로 나눌 때 띄어쓰기에서만 나뉘게 하려는
    // 것이다 — 그냥 두면 크롬이 "state-of-the- / art" 처럼 '-' 뒤에서도 나눈다(OX 가 실제 크롬에서 잼).
    // 칸(.word)은 grid 라 자식이 하나하나 따로 줄을 차지한다 — 문구 전체를 감싸는 칸(.word-text) 하나에 넣는다.
    // 단어 데이터의 줄바꿈(로더가 글자 그대로 온 \n 도 풀어 준다)은 그 자리에서 바꾼다.
    const englishText = document.createElement("span");
    englishText.className = "word-text";
    formatEnglishLabel(state.currentQuestion.english)
      .split(/\s*\n\s*/)
      .forEach((line, lineIndex) => {
        if (lineIndex > 0) englishText.append(document.createElement("br"));
        line.split(ENGLISH_WORD_GAP).filter(Boolean).forEach((word, wordIndex) => {
          if (wordIndex > 0) englishText.append(document.createTextNode(" "));
          const part = document.createElement("span");
          part.className = "word-part";
          part.textContent = word;
          englishText.append(part);
        });
      });
    elements.english.replaceChildren(englishText);
    state.currentAnsweredCorrectly = false;
    clearShellTimers();

    elements.buttons.forEach((button, index) => {
      const label = String(state.currentQuestion.choices[index] ?? "");
      const text = button.querySelector(".shell-text");
      text.replaceChildren();
      label.split("\n").forEach((line, lineIndex, lines) => {
        text.append(document.createTextNode(line));
        if (lineIndex < lines.length - 1) {
          text.append(document.createElement("br"));
        }
      });
      button.setAttribute("aria-label", `${label.replace(/\n/g, " ")} 조개 선택`);
      // 출제 전에는 닫힌 프레임으로 두고, 뜻은 열린 뒤에만 보이게 한다.
      setShellState(button, "closed");
      const halfAt = SHELL_CLOSED_HOLD_MS + index * SHELL_OPEN_STAGGER_MS;
      state.shellTimerIds.push(
        window.setTimeout(() => {
          if (state.currentQuestion && !state.ended) setShellState(button, "half");
        }, halfAt),
        window.setTimeout(() => {
          if (state.currentQuestion && !state.ended) setShellState(button, "open");
        }, halfAt + SHELL_HALF_HOLD_MS),
      );
    });

    fitRenderedQuestion();
  }

  // 검수 r28·r11: 획득/차감 점수를 점수 박스 위에 띄운다.
  function showScoreDelta(text, kind) {
    const el = elements.scoreDelta;
    if (!el) return;
    window.clearTimeout(scoreDeltaTimer);
    el.classList.remove("is-gain", "is-loss", "is-bonus");
    // reflow 를 강제해야 같은 클래스를 다시 붙일 때 애니메이션이 재생된다.
    void el.offsetWidth;
    el.textContent = text;
    el.classList.add(kind);
    scoreDeltaTimer = window.setTimeout(() => {
      el.classList.remove("is-gain", "is-loss", "is-bonus");
      el.textContent = "";
    }, kind === "is-bonus" ? 1100 : 900);
  }

  // 보너스 순간 점수 박스가 반응한다: 금색 링·반짝임과 점수 숫자 펀치 (실로폰 comboRing·comboScorePunch 기준).
  function playBonusBurst() {
    const burst = elements.scoreBurst;
    const score = elements.score;
    if (!burst || !score) return;
    window.clearTimeout(bonusBurstTimer);
    burst.classList.remove("is-playing");
    score.classList.remove("is-bonus-punch");
    // reflow 를 강제해야 같은 클래스를 다시 붙일 때 애니메이션이 처음부터 재생된다.
    void burst.offsetWidth;
    burst.classList.add("is-playing");
    score.classList.add("is-bonus-punch");
    bonusBurstTimer = window.setTimeout(() => {
      burst.classList.remove("is-playing");
      score.classList.remove("is-bonus-punch");
    }, 1100);
  }

  function renderScore() {
    // 검수 4차 10항: 점수는 쉼표가 들어간 형식으로 통일한다.
    // 화면 글자와 읽어 주는 값이 어긋나지 않게 같은 함수를 거친다.
    const scoreText = formatScore(state.score);
    elements.score.textContent = scoreText;
    elements.score.setAttribute("aria-label", `점수 ${scoreText}`);
  }

  // 2차 수정 10번(공통 기준): 셋째 칸에는 실제로 점수에 더해지는 보너스 추가점수(scoring.comboBonus)를 BONUS 띠와 함께
  // 띄운다. 예전에는 점수판 위에 "보너스 +100" 으로 떴다(PDF 4쪽 지적).
  let bonusGainTimer = null;
  function showBonusGain() {
    const gain = elements.bonusGain;
    if (!gain) return;
    elements.bonusGainValue.textContent = `+${formatScore(scoring.comboBonus)}`;
    window.clearTimeout(bonusGainTimer);
    gain.classList.remove("is-showing");
    gain.hidden = false;
    void gain.offsetWidth;
    gain.classList.add("is-showing");
    bonusGainTimer = window.setTimeout(() => {
      gain.classList.remove("is-showing");
      gain.hidden = true;
      bonusGainTimer = null;
    }, 1_200);
  }

  // 첫째·둘째 칸이 켜질 때 그 칸 위로 방금 얻은 정답 점수를 띄운다.
  // 보너스가 아니므로 셋째 칸의 BONUS 표기보다 작고 희게 둔다 — 보너스가 한눈에 갈리게.
  const stepGainTimers = new Map();
  function showStepGain(index) {
    const gain = elements.bonusStepGains[index];
    if (!gain) return;
    gain.textContent = `+${formatScore(scoring.correct)}`;
    window.clearTimeout(stepGainTimers.get(index));
    gain.classList.remove("is-showing");
    gain.hidden = false;
    void gain.offsetWidth;
    gain.classList.add("is-showing");
    stepGainTimers.set(index, window.setTimeout(() => {
      gain.classList.remove("is-showing");
      gain.hidden = true;
      stepGainTimers.delete(index);
    }, 900));
  }

  function hideBonusGain() {
    window.clearTimeout(bonusGainTimer);
    bonusGainTimer = null;
    elements.bonusGain?.classList.remove("is-showing");
    if (elements.bonusGain) elements.bonusGain.hidden = true;
    stepGainTimers.forEach((timerId) => window.clearTimeout(timerId));
    stepGainTimers.clear();
    elements.bonusStepGains.forEach((gain) => {
      gain.classList.remove("is-showing");
      gain.hidden = true;
    });
  }

  function renderCombo(progress = state.streak, { burst = false, step = false } = {}) {
    elements.bonusSlots.forEach((bonusSlot, index) => {
      const keepsBurstVisible = index === 2 && bonusSlot.classList.contains("is-bursting");
      bonusSlot.classList.toggle("is-active", index < progress || keepsBurstVisible);
    });

    // 방금 켜진 칸이 첫째·둘째면 그 칸 위에 정답 점수를 띄운다. 셋째(콤보 완성)는 아래 burst 가 맡는다.
    if (step && !burst && progress >= 1) showStepGain(progress - 1);

    if (burst) {
      showBonusGain();
      const bonusSlot = elements.bonusSlots[2];
      window.clearTimeout(comboBurstTimer);
      bonusSlot.classList.remove("is-bursting");
      void bonusSlot.offsetWidth;
      bonusSlot.classList.add("is-active", "is-bursting");
      comboBurstTimer = window.setTimeout(() => {
        elements.bonusSlots.forEach((slot) => {
          slot.classList.remove("is-active", "is-bursting");
        });
        comboBurstTimer = null;
      }, FEEDBACK_DURATION_MS.correct);
    }

    elements.bonusMeter.setAttribute("aria-label", `연속 정답 ${progress}단계`);
  }

  function resetComboBurst() {
    window.clearTimeout(comboBurstTimer);
    comboBurstTimer = null;
    elements.bonusSlots[2].classList.remove("is-bursting");
    hideBonusGain();
  }

  function renderTimer(remainingMilliseconds) {
    const ratio = Math.max(0, Math.min(1, remainingMilliseconds / totalDurationMs));
    const remainingSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1000));
    elements.time.textContent = formatTime(remainingMilliseconds);
    elements.time.setAttribute("aria-label", `남은 시간 ${remainingSeconds}초`);
    const shown = TIMER_FILL_VISIBLE_START + ratio * (TIMER_FILL_INK_END - TIMER_FILL_VISIBLE_START);
    elements.timerFill.style.clipPath = `inset(0 ${(1 - shown) * 100}% 0 0)`;
    elements.stage.classList.toggle(
      "timer-urgent",
      remainingMilliseconds > 5_000 && remainingMilliseconds <= 10_000,
    );
    elements.stage.classList.toggle(
      "timer-critical",
      remainingMilliseconds > 0 && remainingMilliseconds <= 5_000,
    );
  }

  function setButtonsDisabled(disabled) {
    elements.buttons.forEach((button) => {
      button.disabled = disabled;
    });
  }

  function clearFeedback() {
    elements.buttons.forEach((button) => {
      button.classList.remove("is-correct", "is-wrong");
    });
    elements.stage.classList.remove("feedback-correct", "feedback-wrong");
    elements.character.classList.remove("is-feedback");
    elements.character.classList.add("is-idle");
    delete elements.character.dataset.feedback;
    elements.character.src = CHARACTER_IMAGES.idle;
  }

  function playCharacterFeedback(outcome) {
    elements.character.classList.remove("is-idle");
    elements.character.classList.add("is-feedback");
    elements.character.dataset.feedback = outcome;
    elements.character.src = CHARACTER_IMAGES[outcome];
  }

  function advanceQuestion(now, resetStreak) {
    stopQuestionAudio();
    if (resetStreak) {
      state.timeoutCount += 1;
      state.streak = 0;
      renderCombo();
      // 검수 q58: 못 맞히고 시간이 지난 문항도 오답노트에 남는다.
      recordIncorrectAnswer(state.currentQuestion);
      elements.status.textContent = "시간이 지나 다음 문제로 이동합니다.";
    }

    state.orderPosition += 1;
    if (state.orderPosition >= state.questionOrder.length) {
      // 사장님 '막기'(2026-10-01): 한 바퀴를 다 돌아 다시 섞을 때도 방금 나온 단어가 새 바퀴 첫 단어로 바로
      // 이어지지 않게 한다(OX 와 같다). 새 판의 첫 단어(resetRoundState)와 같은 장치다.
      state.questionOrder = shuffleQuestionOrder(lastShownWordKey);
      state.orderPosition = 0;
    }
    const questionIndex = state.questionOrder[state.orderPosition];
    state.currentQuestion = questions[questionIndex];
    lastShownWordKey = getIncorrectAnswerKey(state.currentQuestion);
    renderQuestion();
    playQuestionAudio();
    state.questionStartedAt = now;
  }

  function endGame() {
    state.ended = true;
    state.locked = true;
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    clearShellTimers();
    stopQuestionAudio();
    clearFeedback();
    resetComboBurst();
    elements.stage.classList.remove("clock-running", "timer-urgent", "timer-critical");
    elements.stage.classList.add("timer-ended");
    setButtonsDisabled(true);
    renderTimer(0);
    closeResultDialog({ restoreFocus: false });
    closeIncorrectAnswerDialog({ restoreFocus: false });
    // 검수 q58: 아무것도 맞히지 못하고 전체 시간이 끝나도 마지막 출제 문항이 남는다.
    if (state.currentQuestion && !state.currentAnsweredCorrectly) {
      recordIncorrectAnswer(state.currentQuestion);
    }
    renderResultBreakdown();
    elements.resultMessage.textContent = "결과를 준비하고 있습니다.";
    // 검수 4차 9-3: 결과 화면에서는 소리 설정과 상관없이 배경음을 멈춘다.
    // soundEnabled 와 bgmWanted 는 그대로 두어 시작 화면으로 가면 원래대로 난다.
    pauseBgm();
    setScreen("result");
    // 2차 수정 4번: 파티클은 Good·Excellent 에서만 터진다. Try Again 에서는 앞 판 것까지 치운다.
    if (getResultTitleAsset() === RESULT_TITLE_ASSETS.tryAgain) clearResultParticles();
    else emitResultConfetti();
    persistPromise = persistResult();
    emitNavigation("ending");
    elements.status.textContent = `게임이 종료되었습니다. 최종 점수는 ${formatScore(state.score)}점입니다.`;
    elements.tryAgainButton.focus({ preventScroll: true });
  }

  function answerQuestion(choice) {
    if (state.locked || state.ended || !state.currentQuestion) return;
    const choiceIndex = Number(choice);
    if (
      !Number.isInteger(choiceIndex)
      || choiceIndex < 0
      || choiceIndex >= elements.buttons.length
    ) return;

    const now = performance.now();
    if (now - state.gameStartedAt >= totalDurationMs) {
      endGame();
      return;
    }
    if (now - state.questionStartedAt >= questionDurationMs) {
      advanceQuestion(now, true);
      return;
    }

    stopQuestionAudio();
    state.locked = true;
    setButtonsDisabled(true);
    const isCorrect = choiceIndex === state.currentQuestion.answerIndex;
    const chosenShell = elements.buttons[choiceIndex];
    chosenShell.classList.add(isCorrect ? "is-correct" : "is-wrong");
    // 2차 검수 WM4-2: 오답 때 정답 조개를 밝히지 않는다(댓글 결론 "하이라이트 완전 제거"). 고른 조개의 흔들림만 남는다.
    if (isCorrect) {
      // 정답을 고른 그 시점에 조개가 바로 닫힌다. 중간 단계 없이 한 번에.
      setShellState(chosenShell, "closed");
    }
    let comboAwarded = false;

    if (isCorrect) {
      state.currentAnsweredCorrectly = true;
      playSound("correct");
      state.streak += 1;
      state.correctCount += 1;
      state.correctQuestionKeys.add(getIncorrectAnswerKey(state.currentQuestion));
      state.correctPoints += scoring.correct;
      state.score += scoring.correct;
      if (state.streak === scoring.comboEvery) {
        state.bonusPoints += scoring.comboBonus;
        state.score += scoring.comboBonus;
        comboAwarded = true;
      }
      showScoreDelta(`+${formatScore(scoring.correct)}`, "is-gain");
      elements.stage.classList.add("feedback-correct");
      playCharacterFeedback("correct");
      elements.status.textContent = comboAwarded
        ? `정답입니다. ${scoring.comboEvery}연속 보너스 ${formatScore(scoring.comboBonus)}점을 획득했습니다.`
        : "정답입니다.";
    } else {
      playSound("incorrect");
      state.incorrectCount += 1;
      state.incorrectPoints += scoring.incorrect;
      state.score += scoring.incorrect;
      state.streak = 0;
      showScoreDelta(`${formatScore(scoring.incorrect)}`, "is-loss");
      recordIncorrectAnswer(state.currentQuestion);
      elements.stage.classList.add("feedback-wrong");
      playCharacterFeedback("incorrect");
      elements.status.textContent = "오답입니다.";
    }

    renderScore();
    renderCombo(state.streak, { burst: comboAwarded, step: isCorrect && !comboAwarded });
    // 2차 수정 10번: 보너스 점수는 보너스 공 위(#bonus-gain)가 띄운다. 점수판 위에는 정답 점수(+100)만 남긴다.
    // 점수판의 금색 링·숫자 펀치는 그대로 둔다(9/14 보너스 효과 개선).
    if (comboAwarded) playBonusBurst();

    state.feedbackTimerId = window.setTimeout(() => {
      clearFeedback();
      if (comboAwarded) {
        state.streak = 0;
        renderCombo();
      }
      if (!state.ended) {
        // 사양: 정답이면 다음 문제를 랜덤으로 제공하고, 오답이면 오답 효과만 주고
        // 같은 문제를 유지한다. 6초가 지나면 update()가 강제로 다음 문제로 넘긴다.
        if (isCorrect) advanceQuestion(performance.now(), false);
        state.locked = false;
        setButtonsDisabled(false);
      }
    }, isCorrect ? FEEDBACK_DURATION_MS.correct : FEEDBACK_DURATION_MS.incorrect);
  }

  function update(now) {
    if (state.ended) return;

    const remaining = totalDurationMs - (now - state.gameStartedAt);
    renderTimer(remaining);
    if (remaining <= 0) {
      endGame();
      return;
    }
    if (!state.locked) {
      // 2차 수정 6번: 문제 시간 배지는 걷었다. 문제마다 6초가 흐르고 넘어가는 것은 그대로다.
      const questionRemaining = questionDurationMs - (now - state.questionStartedAt);
      if (questionRemaining <= 0) {
        advanceQuestion(now, true);
      }
    }
    state.animationFrameId = requestAnimationFrame(update);
  }

  // 누름은 CSS 눌림 효과만 준다. 조개 프레임은 바꾸지 않는다.
  // 누를 때 반쯤 접었다가 판정 후 다시 닫으면 한 동작이 끊겨 보이므로,
  // 조개가 닫히는 프레임은 정답 판정 시점에만 한 번 실행한다.
  function resetPressedState(button) {
    if (!button.classList.contains("is-pressed")) return;
    button.classList.remove("is-pressed");
  }

  function setPressedState(button) {
    if (button.disabled) return;
    button.classList.add("is-pressed");
  }

  function showStartScreen({ restoreFocus = true } = {}) {
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    clearShellTimers();
    state.animationFrameId = 0;
    state.feedbackTimerId = 0;
    state.locked = true;
    state.ended = true;
    state.resultRequestToken += 1;
    resultDialogRequestToken += 1;
    startRankingRequestToken += 1;
    helpRequestToken += 1;
    resetComboBurst();
    clearResultParticles();
    clearFeedback();
    stopQuestionAudio();
    stopIncorrectAudio();
    closeIncorrectAnswerDialog({ restoreFocus: false });
    closeResultDialog({ restoreFocus: false });
    elements.stage.classList.remove(
      "clock-running",
      "timer-ended",
      "timer-urgent",
      "timer-critical",
      "feedback-correct",
      "feedback-wrong",
    );
    setButtonsDisabled(true);
    setStartReady(questions.length >= 2);
    setScreen("start");
    // 동화 정보 글자는 setScreen 이 시작 화면을 켠 뒤에 잰다. 글꼴이 늦게 오면 폭이 달라지므로 받은 뒤에 한 번 더 잰다.
    document.fonts?.load?.('700 1em "Sofia Pro Soft"')?.then(fitStartStory, () => {});
    const restartedCharacter = elements.startCharacter.cloneNode(false);
    restartedCharacter.src = START_CHARACTER_IMAGE;
    elements.startCharacter.replaceWith(restartedCharacter);
    elements.startCharacter = restartedCharacter;
    elements.status.textContent = "시작 화면입니다.";
    emitNavigation("start");
    if (restoreFocus && !elements.startButton.disabled) {
      elements.startButton.focus({ preventScroll: true });
    }
  }

  // 검수 4차 9-2: 한 판의 상태를 처음으로 되돌린다. 다시 시작할 때와
  // X 버튼으로 시작 화면에 나갈 때가 같은 자리에서 같은 값을 지운다.
  // 문제 순서와 위치도 함께 되돌린다 — 5·6항의 "맞힌 서로 다른 문항" 계산이 여기 걸려 있다.
  function resetRoundState() {
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    resetComboBurst();
    clearResultParticles();
    closeResultDialog({ restoreFocus: false });
    closeIncorrectAnswerDialog({ restoreFocus: false });
    stopQuestionAudio();
    stopIncorrectAudio();
    state.score = 0;
    state.streak = 0;
    state.correctPoints = 0;
    state.incorrectPoints = 0;
    state.bonusPoints = 0;
    state.correctCount = 0;
    state.incorrectCount = 0;
    state.timeoutCount = 0;
    state.correctQuestionKeys.clear();
    incorrectAnswerRecords.clear();
    incorrectAnswerSequence = 0;
    updateIncorrectAnswersButton();
    state.historyRequested = false;
    state.resultRequestToken += 1;
    resultDialogRequestToken += 1;
    startRankingRequestToken += 1;
    helpRequestToken += 1;
    state.questionOrder = shuffleQuestionOrder(lastShownWordKey);
    state.orderPosition = 0;
  }

  function startGame() {
    if (questions.length === 0) {
      showToast("게임 데이터를 준비하고 있습니다.");
      return;
    }
    resetRoundState();
    state.currentQuestion = null;
    state.currentAnsweredCorrectly = false;
    state.locked = false;
    state.ended = false;

    clearFeedback();
    elements.stage.classList.remove("timer-ended", "timer-urgent", "timer-critical");
    elements.stage.classList.add("clock-running");
    void elements.timerClock.offsetWidth;
    setScreen("play");
    elements.resultMessage.textContent = "";
    elements.buttons.forEach(resetPressedState);
    setButtonsDisabled(false);
    renderScore();
    renderCombo();
    const questionIndex = state.questionOrder[state.orderPosition];
    state.currentQuestion = questions[questionIndex];
    lastShownWordKey = getIncorrectAnswerKey(state.currentQuestion);
    renderQuestion();
    playQuestionAudio();
    renderTimer(totalDurationMs);
    elements.status.textContent = "게임을 시작합니다.";

    const now = performance.now();
    state.gameStartedAt = now;
    state.questionStartedAt = now;
    state.animationFrameId = requestAnimationFrame(update);
    emitNavigation("game");
  }

  function waitForKoreanFont() {
    return koreanFontReady;
  }

  async function initializeContent({ force = false } = {}) {
    const loader = window.WordMatchContent;
    const token = ++contentRequestToken;
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    stopQuestionAudio();
    setButtonsDisabled(true);
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
      if (!Array.isArray(loaded?.content?.questions) || loaded.content.questions.length < 2) {
        throw new Error("게임에 사용할 문제가 충분하지 않습니다.");
      }

      questions = loaded.content.questions.map((question) => ({ ...question }));
      launchContext = loaded.launch || null;
      totalDurationMs = resolveDurationMs(loaded.content.info, launchContext);
      renderStartStory(loaded.content.info);
      await waitForKoreanFont();
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
      });
    } catch (error) {
      if (token !== contentRequestToken) return;
      questions = [];
      launchContext = null;
      renderStartStory(null);
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

  async function showRanking() {
    if (elements.rankingButton.disabled) return;
    const token = state.resultRequestToken;
    const dialogToken = ++resultDialogRequestToken;
    elements.rankingButton.disabled = true;
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
      if (
        token === state.resultRequestToken
        && state.ended
        && launchContext
        && !launchContext.isGuest
        && !launchContext.isDemo
      ) {
        elements.rankingButton.disabled = false;
      }
    }
  }

  elements.stage.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (
      !button
      || button.disabled
      || button === elements.soundButton
      || button.dataset.skipTouch === "true"
    ) return;
    playSound("touch");
  }, { capture: true });

  elements.buttons.forEach((button) => {
    button.addEventListener("pointerdown", () => setPressedState(button));
    button.addEventListener("pointerup", () => resetPressedState(button));
    button.addEventListener("pointercancel", () => resetPressedState(button));
    button.addEventListener("pointerleave", () => resetPressedState(button));
    button.addEventListener("blur", () => resetPressedState(button));
    button.addEventListener("click", () => answerQuestion(button.dataset.choice));
  });

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
    if (currentScreen === "help" && event.key === "Escape") {
      event.preventDefault();
      closeHelp();
      return;
    }
    if (event.repeat || currentScreen !== "play" || state.ended) return;
    // 1-4 map to the four shells left to right.
    if (event.key >= "1" && event.key <= "4") {
      answerQuestion(Number(event.key) - 1);
    }
  });

  elements.soundButton.addEventListener("click", () => {
    pressControl(elements.soundButton);
    soundEnabled = !soundEnabled;
    if (!soundEnabled) {
      stopEffectAudios();
      stopQuestionAudio();
      stopIncorrectAudio();
      pauseBgm();
    }
    updateSoundUI();
    if (soundEnabled) {
      playSound("touch");
      resumeBgm();
    }
    // 2차 수정 8번: 켜고 끌 때 안내 팝업을 띄우지 않는다. 버튼 그림이 바뀌는 것으로 알린다.
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
    window.setTimeout(startGame, 120);
  });
  elements.startRankingButton.addEventListener("click", () => void showStartRanking());
  elements.helpButton.addEventListener("click", () => {
    if (elements.helpButton.disabled) return;
    pressControl(elements.helpButton);
    window.setTimeout(openHelp, 120);
  });
  elements.helpRetryButton.addEventListener("click", () => void loadHelp({ retry: true }));

  function replayGame(button) {
    pressControl(button);
    window.setTimeout(startGame, 120);
  }

  // 검수 4차 9-2: 결과 화면의 X 는 "다시 하기"가 아니라 시작 화면으로 나가는 길이다.
  // 나가면 그 판은 끝나므로 점수 저장이 끝난 뒤에 이동한다.
  async function returnToStartFromResult(button) {
    if (button.disabled) return;
    button.disabled = true;
    pressControl(button);
    try {
      await persistPromise;
    } catch {
      // 저장에 실패해도 시작 화면으로는 보낸다. 실패 안내는 결과 화면이 이미 보여 줬다.
    }
    persistPromise = null;
    resetRoundState();
    showStartScreen();
    button.disabled = false;
  }

  elements.resultHomeButton.addEventListener("click", () => void returnToStartFromResult(elements.resultHomeButton));
  elements.tryAgainButton.addEventListener("click", () => replayGame(elements.tryAgainButton));
  elements.incorrectAnswersButton.addEventListener("click", openIncorrectAnswerDialog);
  elements.incorrectAnswerClose.addEventListener("click", () => closeIncorrectAnswerDialog());
  elements.incorrectAnswerBackdrop.addEventListener("click", () => closeIncorrectAnswerDialog());
  elements.rankingButton.addEventListener("click", () => void showRanking());
  elements.resultDialogClose.addEventListener("click", () => closeResultDialog());
  elements.resultDialogBackdrop.addEventListener("click", () => closeResultDialog());
  elements.retryButton.addEventListener("click", () => void initializeContent({ force: true }));
  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    resetComboBurst();
    clearResultParticles();
    stopQuestionAudio();
    stopIncorrectAudio();
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
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseBgm();
    } else {
      resumeBgm();
    }
  });

  // 검수 r26: @font-face 는 font-display: swap 이라 서체가 늦게 도착할 수 있다.
  // 폴백 글꼴 폭으로 맞춘 크기가 그대로 굳지 않도록 도착 후 한 번 다시 맞춘다.
  document.fonts?.ready?.then(() => {
    if (currentScreen === "play" && state.currentQuestion) fitRenderedQuestion();
  }).catch(() => {
    // 서체를 못 받으면 폴백 글꼴 기준으로 이미 맞춰져 있으므로 그대로 둔다.
  });
  // 한글 글꼴이 시작 대기(KOREAN_FONT_WAIT_MS)보다 늦게 오면 그 사이에 맞춘 조개 뜻을 이 글꼴 폭으로 다시 맞춘다.
  void koreanFontLoad.then(() => {
    if (currentScreen === "play" && state.currentQuestion) fitRenderedQuestion();
  });

  // 창 크기 · 회전으로 무대 크기가 바뀌면 동화 정보 글자를 다시 맞춘다. 맞추면서 바뀌는 것은 글자 크기뿐이라 무대 크기는 그대로다.
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      if (currentScreen === "start") fitStartStory();
    }).observe(elements.stage);
  }

  updateSoundUI();
  setStartReady(false);
  armBgmOnGesture();
  void initializeContent();
})();
