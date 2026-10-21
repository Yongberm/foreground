(function wordMatchCardMatch() {
  "use strict";

  const Cards = window.WordMatchCards;
  const Rules = window.WordMatchRules;

  /*
   * 한글 글꼴(사장님 2026-10-02 "한글 표기는 전부 이걸 사용하도록" — 나눔스퀘어라운드 Bold, styles.css @font-face).
   * 받은 뒤에 시작 화면을 연다 — 카드 글자 맞춤 · 줄 수 · 가운데 맞춤이 대체 글꼴로 잰 값으로 남지 않게. 스크립트가 읽히자마자
   * 받기 시작해 단어 목록과 함께 기다린다. 받지 못하면 3초 뒤에 그대로 연다(시스템 한글 글꼴로 대체 — 게임은 막지 않는다).
   */
  const KOREAN_FONT = '700 1em "NanumSquareRound Game"';
  const KOREAN_FONT_TIMEOUT_MS = 3000;
  function loadKoreanFont(timeoutMs = KOREAN_FONT_TIMEOUT_MS) {
    if (!document.fonts || typeof document.fonts.load !== "function") return Promise.resolve(false);
    const load = document.fonts.load(KOREAN_FONT, "가").then((faces) => faces.length > 0, () => false);
    const timeout = new Promise((resolve) => window.setTimeout(() => resolve(false), timeoutMs));
    return Promise.race([load, timeout]);
  }
  const koreanFontReady = loadKoreanFont();

  const STAGE_WIDTH = 1920;
  const STAGE_HEIGHT = 1080;

  // 2차 수정(공통 기준 "한 판 시간", 사장님 2026-10-01): API info 의 play_time(초)이 먼저다. 40초는 API 로 시간을
  // 알 수 없을 때만 쓴다 — 값이 없음 · 0 이하 · 숫자가 아님, info 요청 실패, 데모·테스트 모드.
  // 상한·하한은 두지 않는다(잘못된 값은 API 쪽에서 고친다). 판이 바뀌어도 시계는 이어진다.
  // (예전에는 API 값을 무시하고 기획서의 1분 20초를 썼다.)
  const FALLBACK_DURATION_MS = 40_000;
  const FEEDBACK_DURATION_MS = Object.freeze({
    // 두 번째 카드에도 고른 표시를 먼저 보여 주는 시간(사용자 지시: 확인 뒤 다음 동작).
    confirm: 420,
    // 짝을 맞히면 한글 카드 글자색이 영문 카드 색으로 바뀐 채 잠시 머문 뒤 사라진다.
    // 녹화 실측: 섬광·불꽃이 0.4초 안에 끝나므로 그보다 오래 두면 멈춘 듯 보인다.
    correct: 520,
    clear: 360,
    incorrect: 560,
  });
  /*
   * 기획서 1: 카드가 뒷면으로 보였다가 앞면으로 제공된다.
   * 판이 깔린 뒤 잠시 뒷면을 보여 주고, 왼쪽 위부터 차례로 뒤집는다.
   */
  const DEAL_ENTER_STAGGER_MS = 45;
  const DEAL_FACE_DOWN_MS = 900;
  const FLIP_STAGGER_MS = 60;
  const FLIP_DURATION_MS = 420;
  const BOARD_SWAP_DELAY_MS = 520;
  /*
   * 2차 수정(공통 기준 "타임바는 시계 몸통 끝부터 남은 시간에 비례해 줄어들고, 0초에 비어 보임"):
   * 채움 그림(ui_timer2.png, 무대 x 570, 폭 750) 앞부분은 시계(ui_timer1.png, 무대 x 542) 밑에 깔린다. 예전에는
   * 알약 영역(24~725px)에 비례시켜, 남은 시간이 적을 때 바가 통째로 시계 밑에 숨었다(40초 판이면 남은 3초쯤부터
   * 바가 안 보임). 그래서 시계 몸통이 바를 '완전히' 덮는 끝부터 채움 잉크 끝까지만 남은 시간에 비례시킨다.
   * 두 값은 이 방 그림과 CSS 자리로 쟀다(PIL, 바디 45행 = 알파 200 이상인 행 26~70):
   *   시계 몸통이 불투명(알파 255)하게 덮는 가장 짧은 끝: 그림 x 63 → 63 / 750 = 0.084 (무대 x 633)
   *     ⚠ 그 뒤 14px 는 반투명 그림자라 밑의 바가 비쳐 보인다 — 거기까지 덮는다고 잡으면 0초에 토막이 남는다.
   *   채움 잉크(몸통) 끝: x 725 까지 → 726 / 750 = 0.968
   * CSS 의 .timer-fill · .timer-clock 자리를 바꾸면 다시 잰다. 시간이 꽉 찼을 때는 그림 전체를 그대로 보여 준다.
   */
  const TIMER_FILL_VISIBLE_START = 63 / 750;
  const TIMER_FILL_INK_END = 726 / 750;

  /*
   * 카드 격자. 시안 실측: 카드 280x199, 가로 간격 58, 세로 간격 33, 첫 줄 y 108,
   * 격자는 무대 가로 중앙(4x3 프리뷰는 왼쪽으로 60px 치우쳐 있어 가운데로 맞춘다).
   */
  const CARD_GAP_X = 58;
  const CARD_GAP_Y = 33;
  const GRID_TOP = 108;

  const CARD_FRONT_IMAGES = Object.freeze({
    green: "assets/game/card_gr.png",
    yellow: "assets/game/card_yel.png",
  });
  /*
   * 카드 뒷면. 사용자 지시(2026-09-02): 3x2 판은 waite_card_item_1(해먹 여우),
   * 4x3 판은 waite_card_item_2(튜브 여우).
   */
  const CARD_BACK_IMAGES = Object.freeze({
    first: "assets/game/waite_card_item_1.png",
    next: "assets/game/waite_card_item_2.png",
  });

  function cardBackFor(layout) {
    return layout && layout.columns === 3 && layout.rows === 2
      ? CARD_BACK_IMAGES.first
      : CARD_BACK_IMAGES.next;
  }
  const SOUND_ASSETS = Object.freeze({
    touch: "assets/sound/touch.mp3",
    correct: "assets/sound/success.mp3",
    incorrect: "assets/sound/fail.mp3",
    flip: "assets/sound/swap.mp3",
    deal: "assets/sound/show.mp3",
    open: "assets/sound/open.mp3",
    cheer: "assets/sound/yeah.mp3",
    lose: "assets/sound/effect_falid_ha_ah.mp3",
  });
  // 배경음. 리소스 폴더가 준 bgm.mp3 를 효과음보다 한참 아래 볼륨으로 반복한다.
  // 2차 검수 WM5-1("여전히 BGM 소리가 큽니다 (단어 소리가 안 들려요)" · "다른 게임이랑 맞춰주세요"): 0.35 → 0.15.
  // OX · 축구 · 바다속과 Spelling Builder 방들이 0.15 다. 이 방 곡은 OX 방 곡과 파일 음량이 같아(RMS -14.2dBFS)
  // 같은 값이면 같은 크기로 들린다. 단어 발음 · 효과음 볼륨은 그대로다.
  // 사장님 2026-10-15 "사운드 소리 반으로 줄여"(bgm.mp3 첨부) → "프로그램으로 내리지 말고 파일 자체를 수정하자":
  // 볼륨 값은 0.15 그대로 두고 파일(bgm.mp3)을 다시 만든다. 처음에는 진폭 절반(−6dB)이었고, "아직도 줄어든거 같지 않은데" 에
  // 사장님이 "원본 대비 −12dB" 를 고르셔서 진폭 1/4 로 다시 만들었다(192kbps · 길이 30.772s 원본 그대로, RMS -14.3 → -26.6dBFS).
  // 게임 속 배경음(× 0.15)은 단어 소리(검수 API 단어 6개, 소리 나는 부분 -16.7 ~ -20.1dBFS)보다 약 24dB 작다 — 검수 당시는 4.8dB 차.
  // 주소가 같아 예전 파일이 캐시에서 나오지 않게 버전을 단다. 리소스 폴더(리소스 폴더/cardmatch/sound/bgm.mp3)는 원본 그대로다.
  const BGM_SRC = "assets/sound/bgm.mp3?v=20261015-2";
  const BGM_VOLUME = 0.15;

  // character 는 등급별 여우(신규 2026-09-30). 제목 그림과 같은 판정으로 함께 고른다.
  const RESULT_TITLE_ASSETS = Object.freeze({
    excellent: { src: "assets/result/result_text0.png", alt: "Excellent", character: "assets/result/excellent.png?v=20260930-1" },
    good: { src: "assets/result/result_text1.png", alt: "Good", character: "assets/result/good.png?v=20260930-1" },
    // 검수 3차 r10 참고: 그림은 1차 때 이미 대문자 A 교체본이다. 대체 문구도 맞춘다.
    // 공통 7항: 내용이 바뀐 이 그림에만 캐시 버전을 단다(0·1 은 3차에 안 바뀌어 달지 않는다).
    tryAgain: { src: "assets/result/result_text2.png?v=20260930-1", alt: "Try Again", character: "assets/result/try_again.png?v=20260930-1" },
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
  const scoring = Object.freeze({
    correct: Number(gameConfig.scoring?.correct) || 100,
    incorrect: Number(gameConfig.scoring?.incorrect) || -10,
    comboEvery: Math.max(1, Math.trunc(Number(gameConfig.scoring?.comboEvery) || 3)),
    comboBonus: Number(gameConfig.scoring?.comboBonus) || 100,
  });

  let totalDurationMs = FALLBACK_DURATION_MS;
  let apiPlayTimeMs = 0;
  let words = [];
  let launchContext = null;

  const elements = {
    stage: document.querySelector("#game-stage"),
    startScreen: document.querySelector("#start-screen"),
    startCharacter: document.querySelector(".start-character"),
    startLogo: document.querySelector(".start-logo"),
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
    cardGrid: document.querySelector("#card-grid"),
    score: document.querySelector("#score-value"),
    time: document.querySelector("#time-value"),
    timerFill: document.querySelector("#timer-fill"),
    timerClock: document.querySelector(".timer-clock"),
    bonusMeter: document.querySelector("#bonus-meter"),
    scoreBurst: document.querySelector("#score-burst"),
    scoreDelta: document.querySelector("#score-delta"),
    bonusGain: document.querySelector("#bonus-gain"),
    bonusGainValue: document.querySelector("#bonus-gain .bonus-gain-value"),
    bonusStepGains: [...document.querySelectorAll(".bonus-step-gain")],
    bonusSlots: Array.from(document.querySelectorAll(".bonus-slot")),
    status: document.querySelector("#game-status"),
    endScreen: document.querySelector("#end-screen"),
    resultHomeButton: document.querySelector("#result-home-button"),
    resultParticleCanvas: document.querySelector("#result-particle-canvas"),
    resultTitle: document.querySelector("#result-title"),
    resultCharacter: document.querySelector("#result-character"),
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
    game: null,
    board: null,
    scoreboard: null,
    cardNodes: [],
    gameStartedAt: 0,
    animationFrameId: 0,
    feedbackTimerId: 0,
    dealTimerIds: [],
    locked: true,
    ended: true,
    answeredCount: 0,
    historyRequested: false,
    historyPromise: null,
    resultRequestToken: 0,
  };
  const incorrectAnswerRecords = new Map();
  let comboBurstTimer = null;
  let scoreBonusTimer = null;
  let bonusGainTimer = null;
  const stepGainTimers = new Map();
  let scoreDeltaTimer = null;
  let comboCheering = false;
  let resultParticleFrame = 0;
  let resultParticles = [];
  let contentRequestToken = 0;
  let resultDialogReturnFocus = null;
  let incorrectDialogReturnFocus = null;
  let incorrectAnswerSequence = 0;
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

  /*
   * 공통 10항(사장님 지시 2026-09-29): 점수는 1,000 형식으로 쓴다.
   * 굴림 연출이 소수 중간값으로 부를 수 있어 버림(trunc)이 아니라 반올림(round)이다 —
   * 버리면 999.6 이 999 로 한 칸 늦게 따라오고 마이너스 구간이 0 쪽으로 당겨진다.
   * -0 은 0 으로 눕힌다(round 로 바꾸면 falsy 덤이 사라진다).
   */
  function formatScore(value) {
    const rounded = Math.round(Number(value) || 0);
    return (rounded === 0 ? 0 : rounded).toLocaleString("en-US");
  }

  // 호스트가 듣는 화면 이동 알림. cancelable 로 쏜 알림은 호스트가 preventDefault() 로 막을 수 있고,
  // 막히면 false 를 돌려준다(지금은 시작화면 닫기만 cancelable 로 쏜다).
  function emitNavigation(screen, detail = {}, options = {}) {
    return window.dispatchEvent(new CustomEvent("wordmatch:navigate", {
      detail: { screen, ...detail },
      cancelable: Boolean(options.cancelable),
    }));
  }

  /*
   * 밖에서 들어온 주소(?close_url= · deployment.closeUrl · referrer)를 이 페이지와 같은 곳일 때만 쓴다.
   * origin 만 견주면 안 된다 — file:// 에서는 모든 주소의 origin 이 "null" 이라
   * javascript: · data: · //남의주소 가 전부 같은 곳으로 보인다(열린 리다이렉트를 넘어 스크립트 실행).
   * 그래서 protocol 과 host 까지 같고, http · https · file 중 하나일 때만 통과시킨다.
   */
  function sameOriginUrl(value, base = window.location.href) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    try {
      const b = new URL(base);
      const u = new URL(text, b.href);
      const ok = u.origin === b.origin
        && u.protocol === b.protocol
        && u.host === b.host
        && ["http:", "https:", "file:"].includes(u.protocol);
      return ok ? u.href : "";
    } catch {
      return "";
    }
  }

  /*
   * 지금 문서(같은 경로)로 가는 주소는 버린다 — 조각(#…)·쿼리만 달라도 같은 문서다(사장님 결정 09-30, 경로만 견줌).
   * #bye 는 문서 안 이동뿐인데 갈래가 '이동함'으로 끝나 X 가 아무 일도 안 했고, 페이지에 ?close_url=… 이 붙어 있으면
   * index.html · ./ · ?x=1 이 다른 주소로 보여 X 가 게임을 다시 띄웠다. 폴더(끝이 /)는 그 폴더의 index.html 로 본다.
   */
  function otherDocumentUrl(href) {
    if (!href) return "";
    const documentPath = (u) => (u.pathname.endsWith("/") ? `${u.pathname}index.html` : u.pathname);
    return documentPath(new URL(href)) === documentPath(new URL(window.location.href)) ? "" : href;
  }

  /*
   * [앱 전용 자리] 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — 리틀폭스가 앱(Android · iOS)에 올릴 때 직접 작업한다.
   * 지금은 비어 있다. 화면에 알림은 띄우지 않는다(사장님 2026-10-12 "함수 자리만 표시").
   * 이름은 12개 게임이 모두 같다(2차 검수 공통-12, 사장님 "closeAppWebView() … 모든 컨텐츠에 적용"). 앱인지 웹인지 가르지 않고
   * 먼저 부른다 — 다만 호스트(wordmatch:navigate 를 받는 쪽)가 닫기를 막으면 이것도 부르지 않는다(아래 leaveGame).
   */
  function closeAppWebView() {}

  /*
   * 게임을 닫는다 — 시작 화면의 X 버튼(2차 검수 공통-12 "닫기(X) 버튼 눌렀을때 동작 — 웹 : 창 닫기 / 앱 : 웹뷰 닫는 인터페이스 호출").
   * 호스트가 먼저다 — 닫기 알림을 막으면 여기서 끝낸다. 막지 않았으면
   * ① closeAppWebView() ② ?close_url= · #gameConfig 의 deployment.closeUrl 을 받았으면 그리로 ③ 창 닫기
   * ④ 창이 안 닫혔고 referrer 가 같은 곳이면 뒤로 순서로 시도하고, 안내(토스트)는 띄우지 않는다(사장님 결정 09-30).
   * 예전에는 같은 곳에서 왔으면 뒤로가기부터 했는데, 웹은 새 창으로 열려 돌아갈 기록이 없으니 창 닫기를 앞에 둔다
   * (OX 방이 먼저 겪음 — 바다속 · 레이싱 · 축구와 같은 순서). window.close() 는 스크립트가 연 창에서만 듣는다 —
   * 주소를 직접 연 탭 · 링크로 들어온 같은 탭 · 앱 웹뷰에서는 window.closed 가 거짓으로 남아, 그때만 예전처럼 온 곳으로 돌아간다.
   * 닫히지도 않고 돌아갈 곳도 없으면 X 가 아무 반응 없이 끝난다 — 지시대로의 결과다.
   * 두 주소 모두 지금 문서(같은 경로)면 버리고 다음 갈래로 간다(otherDocumentUrl). referrer 갈래에는 걸지 않는다.
   * ?close_url= 은 누구나 주소창에 붙일 수 있어 배포 루트(게임 폴더 한 층 위) 아래만 받는다 — 밖이면 버리고 다음 갈래로.
   * deployment.closeUrl 은 납품본에 박힌 값이라 같은-출처 검사만 둔다(운영이 루트 밖으로 닫을 수 있게).
   * 뒤로가기는 history.length 가 아니라 referrer 로 판단한다 — file:// 로 열면 referrer 가 비어
   * 직전에 보던 엉뚱한 화면으로 되돌아가지 않는다(OX 방은 안 닫히면 늘 뒤로 가지만 이 방은 2026-09-30 규칙을 지킨다).
   */
  function leaveGame() {
    if (!emitNavigation("close", {}, { cancelable: true })) return "host";
    closeAppWebView();
    const params = new URLSearchParams(window.location.search);
    const root = new URL("../", window.location.href).href;
    const fromQuery = otherDocumentUrl(sameOriginUrl(params.get("close_url")));
    const target = (fromQuery.startsWith(root) ? fromQuery : "")
      || otherDocumentUrl(sameOriginUrl(gameConfig.deployment?.closeUrl));
    if (target) {
      window.location.assign(target);
      return "url";
    }
    window.close();
    if (!window.closed && sameOriginUrl(document.referrer)) {
      window.history.back();
      return "back";
    }
    return "close";
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

  function playAudioSource(source, volume = 1) {
    const soundUrl = String(source || "").trim();
    if (!soundEnabled || !soundUrl) return null;

    const audio = new Audio(soundUrl);
    audio.volume = Math.max(0, Math.min(1, volume));
    activeEffectAudios.add(audio);
    const cleanup = () => activeEffectAudios.delete(audio);
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    audio.play()?.catch(cleanup);
    return audio;
  }

  function playSound(name, volume) {
    return playAudioSource(SOUND_ASSETS[name], volume);
  }

  /*
   * 단어 발음. 카드를 고르면 그 단어의 sound_url(영어 발음)을 들려준다 — 영어 카드든
   * 뜻 카드든 모두(사용자 지시, 2026-09-03 "한글 카드도 재생이 되어야해"). 회원 여부와
   * 무관하게 주소가 있으면 재생하고, 판을 깔 때 미리 받아 두어 첫 재생이 늦지 않게 한다.
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

  function prefetchWordAudio(board) {
    board.state().cells.forEach((cell) => {
      if (cell.card) wordAudioFor(cell.card.soundUrl);
    });
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
    ensureBgm().play()?.catch(() => {});
  }

  /*
   * 브라우저는 사용자가 한 번 누르기 전에는 소리를 내주지 않는다. 첫 조작 때
   * 배경음을 틀고, 그때 음소거였다면 "틀고 싶다"만 기억했다가 켜는 순간 이어 간다.
   */
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
      ? "assets/btn_sound_on.png"
      : "assets/btn_sound_off.png";
    elements.soundButton.setAttribute("aria-pressed", String(soundEnabled));
    elements.soundButton.setAttribute("aria-label", soundEnabled ? "소리 끄기" : "소리 켜기");
  }

  /* ---------------- 시작 화면 동화 정보 ---------------- */

  /*
   * 2차 검수 공통-9("시작화면 동화 정보 없음", 사장님 2026-10-12 "배치는 시작화면 로고와 버튼 사이"): API info 의
   * title(시리즈 제목) · subtitle(이야기 제목)을 로고와 Start 버튼 사이에 두 줄로 보여 준다. 한 줄만 오면 그 줄만,
   * 둘 다 없으면(테스트 모드 · 데모 · info 실패) 자리를 숨긴다 — 값을 지어 넣지 않는다. 레벨과 번호는 넣지 않는다.
   */
  function renderStartStory(info) {
    const title = String(info?.title ?? "").trim();
    const subtitle = String(info?.subtitle ?? "").trim();
    elements.startStoryTitle.textContent = title;
    elements.startStorySubtitle.textContent = subtitle;
    elements.startStoryTitle.hidden = !title;
    elements.startStorySubtitle.hidden = !subtitle;
    elements.startStory.hidden = !title && !subtitle;
  }

  /*
   * 동화 정보 글자를 자리 폭에 맞춘다 — 길면 자르지 않고 두 줄을 같은 배율로 줄인다
   * (사장님 2026-10-12 "글자가 길어지면 폰트 크기를 줄이게"). 배율은 CSS 의 기준 크기(.start-story)에 곱한다.
   * 바닥(0.5배)에서도 넘치면 그때만 CSS 의 말줄임이 남는다. 화면에 보일 때만 잴 수 있다 — 숨어 있으면 폭이 0 이다.
   * 그래서 시작 화면이 아닐 때 불리면(도움말이 열린 사이 글꼴이 도착하는 경우) 손대지 않는다. 시작 화면이 보일 때마다
   * setScreen 이 다시 잰다. 이 방 무대는 늘 1920px 이고 창 크기는 배율(transform)로만 맞추므로 창이 바뀌어도 다시 잴 것이 없다.
   */
  const START_STORY_FONT = '600 1em "Lexend Game"';
  const START_STORY_MIN_SCALE = 0.5;
  const START_STORY_SCALE_STEP = 0.02;
  function fitStartStory() {
    const story = elements.startStory;
    if (story.hidden || currentScreen !== "start" || story.clientWidth === 0) return;
    const lines = [elements.startStoryTitle, elements.startStorySubtitle].filter((line) => !line.hidden);
    let scale = 1;
    story.style.setProperty("--start-story-scale", "1");
    while (scale > START_STORY_MIN_SCALE && lines.some((line) => line.scrollWidth > line.clientWidth)) {
      scale = Math.max(START_STORY_MIN_SCALE, Number((scale - START_STORY_SCALE_STEP).toFixed(2)));
      story.style.setProperty("--start-story-scale", String(scale));
    }
  }

  /* ---------------- 화면 전환 ---------------- */

  /*
   * 시작 화면 Ranking 은 로그인한 회원만 쓸 수 있다. 로그인하지 않은 게스트(fu_id 없음 — 데모 포함)에게는 버튼을
   * 꺼서 딤 처리한다(사용자 지시 2026-10-01 "랭킹 버튼에 대해서 이전에 작업한 프로젝트 확인해서 동일하게 적용해" —
   * 레이싱 · 축구와 같은 방식: 비활성 버튼은 .start-menu-button:disabled 로 흐려지고 광택이 없으며, 이름은
   * "랭킹, 로그인 필요"). 예전에는 살아 있다가 누르면 "로그인이 필요합니다" 안내를 띄웠다.
   * 버튼을 켜는 자리(준비 완료 · 랭킹 응답 뒤)는 모두 이 함수를 거쳐 게스트에게 다시 살아나지 않는다.
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

  function setScreen(screen) {
    currentScreen = screen;
    // 공통 9-3(사장님 지시 2026-09-29): 결과화면에서는 소리 설정과 무관하게 배경음을 멈춘다.
    // 설정 값(soundEnabled)은 건드리지 않아, 시작 화면으로 돌아가면 원래대로 다시 난다.
    if (screen === "result") pauseBgm();
    else resumeBgm();
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
    // 2차 수정(공통 기준 "도움말 버튼"): 도움말 화면에서는 스피커를 숨기고, 그 자리(왼쪽 위)에 뒤로가기를 둔다.
    elements.soundButton.hidden = !controlsVisible || screen === "help";
    elements.navigationButton.hidden = !controlsVisible;

    // 검수표 r12(2026-08-26): 앞으로 가기 버튼이 아니라 X 버튼이어야 한다 — 시작 · 게임 화면.
    // 2차 수정: 도움말 화면에서만 주황 뒤로가기(btn_back.png). 자리는 CSS 의 .screen-help 가 잡는다.
    const closesGame = screen === "start";
    elements.navigationIcon.src = screen === "help" ? "assets/btn_back.png" : "assets/btn_close.png";
    elements.navigationButton.setAttribute(
      "aria-label",
      closesGame
        ? "게임 닫기"
        : screen === "help" ? "뒤로 가기" : "게임 나가기",
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
    // 2차 수정(PDF 4쪽, 공통 기준 "소리 끈 상태"): 소리를 꺼 두어도 오답노트 단어 발음은 누르면 난다 —
    // 학습자가 직접 고른 소리다. 예전에는 "Sound Off" 안내만 띄우고 내지 않았다.
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

  // 틀린 횟수 열을 없앤 뒤로는 안내 문구도 횟수를 말하지 않는다(파랑 기준 방과 같은 문구).
  // 공통 9-1 정정(사장님 결정 2026-09-29): 오답이 0건인 판에서도 자리까지 없앤다 — 예외 없음.
  function updateIncorrectAnswersButton() {
    const records = [...incorrectAnswerRecords.values()];
    elements.incorrectAnswersButton.hidden = records.length === 0;
    elements.incorrectAnswersButton.disabled = records.length === 0;
    elements.incorrectAnswersButton.setAttribute(
      "aria-label",
      records.length > 0 ? `오답 보기, ${records.length}개 단어` : "오답 없음",
    );
  }

  function recordIncorrectAnswer(entry) {
    const key = String(entry?.english || "").trim().toLocaleLowerCase("en-US");
    if (!key) return;

    const soundUrl = String(entry?.soundUrl || "").trim();
    const existing = incorrectAnswerRecords.get(key);
    if (existing) {
      existing.wrongCount += 1;
      if (!existing.soundUrl && soundUrl) existing.soundUrl = soundUrl;
    } else {
      incorrectAnswerRecords.set(key, {
        english: String(entry?.english || "").trim(),
        correctMeaning: String(entry?.meaning || "").trim(),
        soundUrl,
        wrongCount: 1,
        sequence: incorrectAnswerSequence,
      });
      incorrectAnswerSequence += 1;
    }
    updateIncorrectAnswersButton();
  }

  /*
   * q58(4차 검수): 한 문제도 맞히지 못한 채 시간이 끝나도 출제된 단어가 오답노트에 나와야 한다.
   * 짝을 맞히면 cards.js 가 그 자리의 카드를 비우므로, 끝났을 때 판에 남아 있는 카드가 곧
   * "출제됐지만 못 맞힌 단어"다. 오답으로 누른 적이 없으면 0회로 넣고, 이미 기록이 있으면 그대로 둔다.
   */
  function recordUnmatchedWordsOnBoard() {
    if (!state.board) return;
    state.board.state().cells.forEach((cell) => {
      const card = cell.card;
      if (!card) return;
      const english = String(card.english || "").trim();
      const key = english.toLocaleLowerCase("en-US");
      if (!key || incorrectAnswerRecords.has(key)) return;
      incorrectAnswerRecords.set(key, {
        english,
        correctMeaning: String(card.meaning || "").trim(),
        soundUrl: String(card.soundUrl || "").trim(),
        wrongCount: 0,
        sequence: incorrectAnswerSequence,
      });
      incorrectAnswerSequence += 1;
    });
    updateIncorrectAnswersButton();
  }

  function createIncorrectAnswerCell(className) {
    const cell = document.createElement("div");
    cell.className = `incorrect-answer-cell ${className}`;
    cell.setAttribute("role", "cell");
    return cell;
  }

  // 오답 목록 단어 글꼴(.incorrect-answer-word). 게임 화면에서는 쓰지 않는 굵기라 스크립트를 읽을 때 미리 받기 시작한다.
  const INCORRECT_WORD_FONT = '400 1em "Lexend Game"';
  document.fonts?.load?.(INCORRECT_WORD_FONT)?.catch?.(() => {});
  // 오답 목록 한글(나눔스퀘어라운드 Bold — 사장님 2026-10-15 "1번으로 통일")도 오답 목록에서만 쓰여 미리 받는다.
  document.fonts?.load?.('500 1em "NanumSquareRound List"', "가")?.catch?.(() => {});

  function fitIncorrectWordText(element) {
    const cell = element.closest(".incorrect-answer-word");
    if (!cell) return;
    /* 2차 수정(공통 기준 "오답노트 … 글자 크기를 같게"): OX 와 같은 줄임 — 긴 단어만 칸에 맞게 줄인다. 값은 배율이다 —
       CSS 의 기준 크기(.incorrect-answer-word, 2차 검수 공통-1 로 1.56cqw = 1920 기준 30px)에 곱하고,
       바닥은 배율 0.73(약 22px)으로 OX 와 같다. */
    const minimumScale = 0.73;
    const step = 0.02;
    cell.style.setProperty("--incorrect-word-scale", "1");
    for (let scale = 1; scale > minimumScale && element.scrollWidth > element.clientWidth; scale -= step) {
      cell.style.setProperty("--incorrect-word-scale", (scale - step).toFixed(2));
    }
  }

  /*
   * 검수표 r7(2026-08-19): 영단어는 모두 소문자로 나와야 한다. API 가 대문자로 시작하는
   * 표제어를 주더라도 낮춘다. 카드·오답노트·안내 문구가 모두 이 함수를 지난다.
   */
  function formatEnglishLabel(value) {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
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
      wordText.textContent = formatEnglishLabel(record.english);
      wordCell.append(wordText);

      const meaningCell = createIncorrectAnswerCell("incorrect-answer-meaning");
      meaningCell.textContent = record.correctMeaning || "정답 뜻 확인 필요";

      row.append(audioCell, wordCell, meaningCell);
      fragment.append(row);
    });

    elements.incorrectAnswerList.append(fragment);
    elements.incorrectAnswerList.scrollTop = 0;
    const fitWords = () => {
      if (elements.incorrectAnswerDialog.hidden) return;
      elements.incorrectAnswerList
        .querySelectorAll(".incorrect-answer-word-text")
        .forEach(fitIncorrectWordText);
    };
    requestAnimationFrame(fitWords);
    /* 2차 검수 공통-1 로 단어가 Lexend Regular(400)가 됐는데, 이 굵기는 오답 목록에서만 쓴다. 처음 열 때 아직 받지 않았으면
       대체 글꼴로 재고 덜 줄여, 글꼴이 도착한 뒤 긴 단어 오른쪽이 잘렸다(반박 검토가 찾음 — 28자 단어가 다시 열어야 맞음).
       글꼴을 받은 뒤 한 번 더 잰다. 미리 받기는 아래 INCORRECT_WORD_FONT 줄이 스크립트를 읽을 때 시작한다. */
    document.fonts?.load?.(INCORRECT_WORD_FONT)?.then(fitWords, () => {});
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
    // q49(4차 검수): 랭킹을 부르는 동안 로딩 토스트를 띄우지 않는다.
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
        setStartRankingEnabled(true);
      }
    }
  }

  /* ---------------- 결과 ---------------- */

  /*
   * 리워드 제공 기준(사장님 지시 2026-09-29): 분모는 "전체 제공 문제수"다 —
   * 푼 문제수가 아니라 판에 깔린 짝 전부(시간이 끝나 손도 못 댄 짝 포함).
   * 카드 방의 한 문제 = 한 짝이므로 game.pairsDealt 를 그대로 쓴다.
   */
  function getResultTitleAsset() {
    const scoreState = state.scoreboard ? state.scoreboard.getState() : null;
    const presented = state.game ? state.game.pairsDealt : 0;
    const tier = Rules.resultTier(scoreState ? scoreState.matchedCount : 0, presented);
    if (tier === 0) return RESULT_TITLE_ASSETS.excellent;
    if (tier === 1) return RESULT_TITLE_ASSETS.good;
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
    const scoreState = state.scoreboard.getState();
    const titleAsset = getResultTitleAsset();
    elements.resultTitle.src = titleAsset.src;
    elements.resultTitle.alt = titleAsset.alt;
    // 여우도 같은 등급을 따른다(별도 판정을 만들지 않는다).
    // 그림을 못 읽으면 깨진 표 대신 숨긴다(자산이 갈릴 때를 대비, 12방 공통 권고).
    elements.resultCharacter.hidden = true;
    elements.resultCharacter.src = titleAsset.character;
    /*
     * 공통 6항(사장님 지시 2026-09-29): Correct·Incorrect 는 점수 합이 아니라 개수다.
     * Incorrect 는 틀린 시도 수가 아니라 오답노트에 실리는 줄 수여서, 한 단어를 두 번 틀려도 1 이다.
     * 그래서 Correct + Incorrect 가 전체 제공 문제수(game.pairsDealt)와 맞물린다.
     * Bonus 와 My Score 는 점수 그대로다.
     */
    const correctCount = scoreState.matchedCount;
    /*
     * Incorrect 는 오답노트에 실리는 줄 수다. 2026-09-29 사장님 최종 결정으로 이 수의 정의는
     * 손대지 않는다 — 검수표 원문에 Incorrect 숫자에 대한 요구가 없어 방마다 지금 상태를 그대로 둔다.
     * (그날 코디네이터 문서에 오갔던 "전체 − Correct", "Correct + Incorrect = 전체" 는 모두 폐기됐다.)
     */
    const incorrectCount = incorrectAnswerRecords.size;
    // 2차 검수 공통-2: 숫자 뒤의 "개" 와 Bonus 앞의 "+" 는 쓰지 않는다. Bonus 의 "점" 은 CSS(.result-points::after)가 붙인다.
    // 2차 검수 공통-10: Incorrect 숫자는 오답 목록(Incorrect Answers)에 실리는 줄 수 그대로다 — 이 방은 이미 같은 수였다.
    // 등급(getResultTitleAsset)은 Incorrect 가 아니라 맞힌 짝 ÷ 전체 제공 짝으로 정하므로 손대지 않는다.
    elements.resultCorrectPoints.textContent = formatScore(correctCount);
    elements.resultIncorrectPoints.textContent = formatScore(incorrectCount);
    elements.resultBonusPoints.textContent = formatScore(scoreState.bonusPoints);
    elements.resultCorrectPoints.setAttribute("aria-label", `정답 ${formatScore(correctCount)}개`);
    elements.resultIncorrectPoints.setAttribute("aria-label", `오답 ${formatScore(incorrectCount)}개`);
    elements.resultBonusPoints.setAttribute("aria-label", `보너스 ${formatScore(scoreState.bonusPoints)}점`);
    renderResultRankAndScore(0, scoreState.score);
    updateIncorrectAnswersButton();
    const rankingAvailable = isLoggedInMember();
    // 공통 9-1: 이 판에서 아예 쓸 수 없는 버튼(게스트·데모의 랭킹)은 자리까지 없앤다.
    // 짝을 다 맞혀 오답이 0인 판은 흔해서, 오답 보기 버튼은 자리를 지키고 비활성으로만 둔다.
    elements.rankingButton.hidden = !rankingAvailable;
    elements.rankingButton.disabled = true;
    elements.rankingButton.setAttribute(
      "aria-label",
      rankingAvailable
        ? "점수 저장 후 랭킹을 볼 수 있습니다"
        : "게스트 또는 데모 모드에서는 랭킹을 사용할 수 없습니다",
    );
    playSound(titleAsset === RESULT_TITLE_ASSETS.tryAgain ? "lose" : "cheer", 0.9);
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
    // q49(4차 검수): 결과화면에도 로딩 문구를 쓰지 않는다. 먼저 있던 안내를 그대로 둔다.
    elements.rankingButton.disabled = true;
    try {
      const ranking = await window.WordMatchContent.getRanking();
      if (
        token !== state.resultRequestToken
        || dialogToken !== resultDialogRequestToken
        || !state.ended
      ) return;
      // 2차 수정(PDF 2쪽 "점수 하단 문구", 사장님 2026-10-01 "가" — 카드 방): 점수 밑 문구는 저장 결과
      // ("점수와 순위를 저장했습니다." 등)로 고정하고 Ranking 을 열어도 바꾸지 않는다. 예전에는 여기서
      // "OO님의 최고 점수는 N점입니다." 로 바꿔, 리틀폭스가 찍는 순간에 따라 게임마다 문구가 달라 보였다.
      openRankingDialog(ranking, elements.rankingButton);
    } catch (error) {
      if (
        token !== state.resultRequestToken
        || dialogToken !== resultDialogRequestToken
        || !state.ended
      ) return;
      // 랭킹을 못 불러온 것은 점수 밑 문구를 건드리지 않고 잠깐 알린다(시작 화면 랭킹과 같은 안내).
      showToast(`랭킹을 불러오지 못했습니다: ${error?.message || "연결 오류"}`);
    } finally {
      if (token === state.resultRequestToken && state.ended && isLoggedInMember()) {
        elements.rankingButton.disabled = false;
      }
    }
  }

  /* ---------------- 시계 · 점수 · 콤보 ---------------- */

  // 2차 수정: API info 의 play_time(초)을 한 판 시간(ms)으로 바꾼다. 알 수 없으면 40초(OX · 바다속과 같은 규칙).
  // 숫자이거나 숫자만 적힌 문자열만 받는다 — Number(true) 는 1, Number("") 는 0 이라 그대로 쓰면 1초 판이나 0초 판이 된다.
  // 유한한지는 ms 로 바꾼 뒤에 본다 — 1e306 초는 유한하지만 ×1000 하면 Infinity 라 판이 끝나지 않는다.
  // 데모·테스트 모드에는 API 시간이 없다(#gameConfig 데모 info 의 120초는 이 맥의 설정이라 쓰지 않는다).
  // API 가 준 시간(ms). 쓸 수 없는 값이면 0 — 준비 알림(apiPlayTimeMs)에도 이 값을 그대로 싣는다.
  function apiDurationMs(info) {
    const raw = info?.play_time;
    const seconds = typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(raw) ? Number(raw) : NaN;
    const milliseconds = seconds * 1000;
    return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
  }

  function resolveDurationMs(info, launch) {
    if (!launch || launch.isTest || launch.isDemo) return FALLBACK_DURATION_MS;
    return apiDurationMs(info) || FALLBACK_DURATION_MS;
  }

  function formatTime(milliseconds) {
    return Rules.formatClock(Math.max(0, Math.ceil(milliseconds / 1000)));
  }

  /*
   * 남은 시간 글자. Lexend 숫자는 자리마다 폭이 달라 초가 바뀔 때마다 글자가 좌우로
   * 흔들렸다(사용자 지시 2026-09-02). 자리마다 고정 폭 상자에 넣어 숫자가 바뀌어도
   * 자리가 움직이지 않게 한다. 매 프레임 DOM 을 다시 만들지 않도록 글자가 바뀔 때만 그린다.
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

  /*
   * 점수판. 검수 3차 r11(사장님 결정 2026-09-10, 전달_r11 09-14 개정판): 보너스를 받으면 숫자가
   * 최종값으로 튀지 않고 굴러 올라간다. 기준은 실로폰 방 updateScore·animateScore 이고, 이 방은
   * 폴백 무효화를 clearTimeout 과 번호(token) 둘 다로 한다 — 늦게 도는 폴백이 옛 점수를 되살리거나
   * 연속 굴림에서 숫자가 되돌아가지 않게. scoreShown 은 지금 화면에 그려진 숫자다.
   */
  let scoreShown = 0;
  let scoreTween = 0;
  let scoreTweenFallbackId = 0;
  let scoreTweenToken = 0;

  function currentScore() {
    return state.scoreboard ? state.scoreboard.getState().score : 0;
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  function renderScore(value = currentScore()) {
    const shown = Math.round(Number(value) || 0);
    elements.score.textContent = formatScore(shown);
    elements.score.setAttribute("aria-label", `점수 ${formatScore(shown)}`);
  }

  // 점수가 오를 때 점수판이 한 번 튄다(보너스가 아닌 정답의 기존 효과).
  function bumpScore() {
    elements.score.classList.remove("is-bumping");
    void elements.score.offsetWidth;
    elements.score.classList.add("is-bumping");
  }

  // 진행 중인 굴림과 예약된 폴백을 모두 무효로 만든다.
  function cancelScoreTween() {
    if (scoreTween) {
      cancelAnimationFrame(scoreTween);
      scoreTween = 0;
    }
    window.clearTimeout(scoreTweenFallbackId);
    scoreTweenFallbackId = 0;
    scoreTweenToken += 1;
  }

  // 굴림을 끊고 지금 점수를 바로 찍는다. 시작·재시작·종료·오답·보너스 아닌 정답에서 쓴다.
  function updateScore({ bump = true } = {}) {
    cancelScoreTween();
    const score = currentScore();
    const rose = score > scoreShown;
    scoreShown = score;
    renderScore(score);
    if (bump && rose) bumpScore();
  }

  function animateScore(target) {
    const to = Math.trunc(Number(target) || 0);
    const from = scoreShown;
    if (from === to || prefersReducedMotion()) {
      updateScore({ bump: false });
      return;
    }
    cancelScoreTween();
    const token = scoreTweenToken;
    const startedAt = Date.now();
    // 차이가 클수록 조금 길게, 최대 0.72초.
    const span = Math.min(720, 280 + Math.abs(to - from) * 2);
    // rAF 가 돌지 않는 환경(백그라운드 탭 등)에서도 최종값에 닿게 한다. 번호가 바뀌었으면 무시한다.
    scoreTweenFallbackId = window.setTimeout(() => {
      if (token !== scoreTweenToken) return;
      scoreTweenFallbackId = 0;
      if (scoreTween) {
        cancelAnimationFrame(scoreTween);
        scoreTween = 0;
      }
      scoreShown = to;
      renderScore(to);
    }, span + 120);
    const step = () => {
      if (token !== scoreTweenToken) return;
      const ratio = Math.min(1, (Date.now() - startedAt) / span);
      const eased = 1 - (1 - ratio) ** 3;
      scoreShown = from + (to - from) * eased;
      renderScore(scoreShown);
      if (ratio < 1) {
        scoreTween = requestAnimationFrame(step);
        return;
      }
      scoreShown = to;
      renderScore(to);
      scoreTween = 0;
      window.clearTimeout(scoreTweenFallbackId);
      scoreTweenFallbackId = 0;
    };
    scoreTween = requestAnimationFrame(step);
  }

  /*
   * 정답 불꽃. 카드 가운데에서 별과 점이 사방으로 튀어 나가 사라진다. 카드 격자에
   * 잠깐 붙였다가 스스로 치우므로 판이 새로 깔려도 남지 않는다.
   */
  const SPARK_COLORS = Object.freeze(["#ffd400", "#ffffff", "#ff4fa3", "#ff8a00", "#4dffb0", "#ffe97a"]);
  function spawnSparkles(cellIndex) {
    const node = cardNodeAt(cellIndex);
    if (!node) return;
    const burst = document.createElement("span");
    burst.className = "spark-burst";
    burst.setAttribute("aria-hidden", "true");
    burst.style.left = `calc(${node.button.style.getPropertyValue("--card-x")} + ${Cards.CARD_WIDTH / 2}px)`;
    burst.style.top = `calc(${node.button.style.getPropertyValue("--card-y")} + ${Cards.CARD_HEIGHT / 2 - 16}px)`;
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
    elements.cardGrid.append(burst);
    window.setTimeout(() => burst.remove(), 1_200);
  }

  // 몇 번째 판인지. 판마다 카드 색이 초록 → 노랑으로 번갈아 든다.

  /*
   * 하단 오른쪽 튜브 세 칸. 연속 정답이 하나씩 찰 때마다 켜진다. 켜는 개수는
   * scoreboard 의 comboFilled(0..2)를 그대로 따르고, 보너스 순간의 환호는
   * burstCombo 가 따로 그린 뒤 스스로 되돌린다.
   */
  function renderCombo() {
    if (comboCheering) return;
    const filled = state.scoreboard ? state.scoreboard.getState().comboFilled : 0;
    elements.bonusSlots.forEach((bonusSlot, index) => {
      bonusSlot.classList.toggle("is-active", index < filled);
      bonusSlot.classList.remove("is-bursting");
    });
    elements.bonusMeter.setAttribute("aria-label", `연속 정답 ${filled}단계`);
  }

  /*
   * 검수표 r11 후속(사용자 지시 2026-09-15): "보너스 점수 위치가 컴보위치가 아니라 Score 위치에서
   * 터져야해". 같은 하단 바를 쓰는 형제 바다속 방과 같은 구성으로 Score 상자에서 터뜨린다 — 상자
   * 둘레 금빛 테두리·반짝임(#score-burst)과 점수 숫자 펀치. 숫자는 그동안 animateScore 가 굴리고,
   * 콤보 튜브는 burstCombo 가 따로 터뜨린다.
   * 2차 수정(PDF 4쪽, 공통 기준): 상자 위로 떠오르던 "보너스 +100"(#score-bonus)은 걷었다 — 보너스 점수는
   * 보너스 칸 위(showBonusGain)에 뜬다. 테두리·펀치는 바다속처럼 그대로 둔다.
   */
  function playScoreBonus() {
    const { scoreBurst: burst, score } = elements;
    if (!burst) return;
    window.clearTimeout(scoreBonusTimer);
    burst.classList.remove("is-playing");
    // 점수판 튐(is-bumping)이 남아 있으면 펀치와 겹치므로 함께 지운다.
    score.classList.remove("is-bonus-punch", "is-bumping");
    // reflow 를 강제해야 같은 클래스를 다시 붙일 때 애니메이션이 처음부터 재생된다.
    void burst.offsetWidth;
    burst.classList.add("is-playing");
    score.classList.add("is-bonus-punch");
    scoreBonusTimer = window.setTimeout(clearScoreBonus, 1_100);
  }

  function clearScoreBonus() {
    window.clearTimeout(scoreBonusTimer);
    scoreBonusTimer = null;
    elements.scoreBurst?.classList.remove("is-playing");
    elements.score.classList.remove("is-bonus-punch");
  }

  /*
   * 2차 수정(PDF 4쪽 "보너스 UI 상단에 100점 노출", 공통 기준): 첫째·둘째 칸이 켜질 때 그 칸 위로 방금 얻은 정답
   * 점수(+100)를, 보너스가 붙으면 셋째 칸에 BONUS 띠와 실제로 더해진 보너스 점수를 띄운다(바다속 · OX 와 같은 구성).
   * 보너스가 아닌 칸 표기는 희고 작게 두어 보너스가 한눈에 갈린다.
   */
  function showBonusGain(amount) {
    const gain = elements.bonusGain;
    if (!gain || !elements.bonusGainValue) return;
    elements.bonusGainValue.textContent = `+${formatScore(amount)}`;
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

  function showStepGain(index, amount) {
    const gain = elements.bonusStepGains[index];
    if (!gain) return;
    gain.textContent = `+${formatScore(amount)}`;
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

  function hideBonusGains() {
    window.clearTimeout(bonusGainTimer);
    bonusGainTimer = null;
    if (elements.bonusGain) {
      elements.bonusGain.classList.remove("is-showing");
      elements.bonusGain.hidden = true;
    }
    stepGainTimers.forEach((timerId) => window.clearTimeout(timerId));
    stepGainTimers.clear();
    elements.bonusStepGains.forEach((gain) => {
      gain.classList.remove("is-showing");
      gain.hidden = true;
    });
  }

  /*
   * 검수표 r11 후속2(사용자 지시 2026-09-15): "현제 보너스만 나오는데 그외 다른 점수도 같이 올라가는게
   * 보여야해". 형제 바다속 방 showScoreDelta 와 같이 정답 +100(초록)·오답 -10(붉은색)을 Score 상자 위로
   * 띄운다. 값은 점수판이 실제로 더하거나 뺀 만큼(registerMatch·registerMiss 의 scoreDelta)이다.
   */
  function showScoreDelta(amount) {
    const node = elements.scoreDelta;
    const value = Math.trunc(Number(amount) || 0);
    if (!node || value === 0) return;
    window.clearTimeout(scoreDeltaTimer);
    node.classList.remove("is-gain", "is-loss");
    void node.offsetWidth;
    node.textContent = `${value > 0 ? "+" : "-"}${formatScore(Math.abs(value))}`;
    node.classList.add(value > 0 ? "is-gain" : "is-loss");
    scoreDeltaTimer = window.setTimeout(clearScoreDelta, 900);
  }

  function clearScoreDelta() {
    window.clearTimeout(scoreDeltaTimer);
    scoreDeltaTimer = null;
    if (!elements.scoreDelta) return;
    elements.scoreDelta.classList.remove("is-gain", "is-loss");
    elements.scoreDelta.textContent = "";
  }

  function burstCombo() {
    comboCheering = true;
    window.clearTimeout(comboBurstTimer);
    elements.bonusSlots.forEach((slot) => {
      slot.classList.remove("is-bursting");
      void slot.offsetWidth;
      slot.classList.add("is-active", "is-bursting");
    });
    elements.bonusMeter.setAttribute("aria-label", `연속 정답 ${scoring.comboEvery}단계, 보너스`);
    comboBurstTimer = window.setTimeout(() => {
      comboCheering = false;
      comboBurstTimer = null;
      elements.bonusSlots.forEach((slot) => {
        slot.classList.remove("is-active", "is-bursting");
      });
      renderCombo();
    }, 900);
  }

  function resetComboBurst() {
    window.clearTimeout(comboBurstTimer);
    comboBurstTimer = null;
    comboCheering = false;
    // Score 상자의 점수 표기·보너스 효과도 같이 정리한다(시작·종료·나가기·페이지를 떠날 때 모두 이 함수를 거친다).
    clearScoreBonus();
    clearScoreDelta();
    hideBonusGains();
    elements.bonusSlots.forEach((slot) => slot.classList.remove("is-active", "is-bursting"));
  }

  function renderTimer(remainingMilliseconds) {
    const ratio = Math.max(0, Math.min(1, remainingMilliseconds / totalDurationMs));
    const remainingSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1000));
    renderTimeText(formatTime(remainingMilliseconds));
    elements.time.setAttribute("aria-label", `남은 시간 ${remainingSeconds}초`);
    const filledEdge = ratio >= 1 ? 1 : TIMER_FILL_VISIBLE_START + ratio * (TIMER_FILL_INK_END - TIMER_FILL_VISIBLE_START);
    elements.timerFill.style.clipPath = `inset(0 ${(1 - filledEdge) * 100}% 0 0)`;
    elements.stage.classList.toggle(
      "timer-urgent",
      remainingMilliseconds > 5_000 && remainingMilliseconds <= 10_000,
    );
    elements.stage.classList.toggle(
      "timer-critical",
      remainingMilliseconds > 0 && remainingMilliseconds <= 5_000,
    );
  }

  /* ---------------- 카드 판 ---------------- */

  function clearDealTimers() {
    state.dealTimerIds.forEach((id) => window.clearTimeout(id));
    state.dealTimerIds = [];
  }

  /*
   * 격자 원점. 가로는 무대 중앙, 세로는 4x3 세 줄이 차지하는 띠(108~771) 안에서
   * 가운데다 — 첫 판 3x2 두 줄은 그 띠의 가운데(224)에 놓인다.
   */
  function gridGeometry(layout) {
    const width = layout.columns * Cards.CARD_WIDTH + (layout.columns - 1) * CARD_GAP_X;
    const left = Math.round((STAGE_WIDTH - width) / 2);
    const bandHeight = 3 * Cards.CARD_HEIGHT + 2 * CARD_GAP_Y;
    const height = layout.rows * Cards.CARD_HEIGHT + (layout.rows - 1) * CARD_GAP_Y;
    const top = GRID_TOP + Math.round((bandHeight - height) / 2);
    return { left, top };
  }

  /*
   * 영어 카드의 시작 크기. 사용자 지시(2026-09-03): 긴 단어는 한 줄에 들어가도록 글자 수로 먼저
   * 줄인다. 한글은 줄 수별 크기(KOREAN_LINE_PX, createTextMeasurer 한글 갈래)로 정하므로
   * 여기서 줄이지 않는다.
   */
  function textScaleFor(text, kind) {
    if (kind !== "en") return 1;
    const length = String(text ?? "").replace(/[\s\n]/g, "").length;
    if (length <= 7) return 1;
    if (length <= 10) return 0.86;
    if (length <= 13) return 0.74;
    return 0.64;
  }

  /*
   * 한 판의 글자 크기 계획. entries 는 카드마다 { kind, fit } 이고, fit 은 그 카드 글자가 상자를 넘치지 않고
   * 왼쪽 위 아이콘에 닿지 않는 최대 배율이다. 배율 1 = 38px(영어 최대 · 한글 최대는 KOREAN_MAX_PX). 한글 · 영어 모두 카드마다 제 배율을 쓴다.
   * 한글: 검수 3차 r65(사용자 선택 1: 판 단위 통일)는 그 판에서 가장 많이 줄여야 하는 카드에 맞춰 모두 같은 배율을
   * 썼다. 2차 수정(PDF 3쪽, 사장님 2026-10-01 "12장 화면 한글을 6장 화면 크기로, 안 들어가는 것만 줄임")으로 12장
   * 판을 카드마다로 바꾸었고, 이어 사장님 지시(2026-10-01 "6장 판도 12장처럼 카드마다 맞춰")로 6장 판도 카드마다다
   * — 실데이터에서 긴 뜻 하나 때문에 6장 판 한글 세 장이 모두 22.8px 로 작아져 12장 판보다 작게 보였다.
   */
  function planBoardTextScales(entries) {
    // 한글은 최대 크기(KOREAN_MAX_PX, 사장님 2026-10-02 16:36)를 넘지 않는다 — 맞춤 밖에서도.
    return entries.map((entry) => Math.min(entry.kind === "ko" ? KOREAN_MAX_SCALE : 1, entry.fit));
  }

  /*
   * 2차 수정(공통 기준 "긴 글자"): 서버가 내려주는 그대로 칸에 맞게 줄인다 — 단어는 빼지 않는다. 예전에는 배율 0.5
   * (19px)가 바닥이라 그래도 넘치면 칸(overflow: hidden)에 잘려 글자가 빠졌다. 바닥 아래로도 더 줄인다.
   * 영문은 한 줄이 기본이고, 한 줄로 바닥(0.5)까지 줄여도 안 들어갈 때만 띄어쓰기 자리에서 두 줄로 나눈다
   * (최대 두 줄, 단어 데이터에 줄바꿈이 있으면 그 자리, '-' 로 이은 단어는 가르지 않음 — OX · 바다속과 같은 규칙).
   */
  const TEXT_SCALE_FLOOR = 0.02;

  /*
   * 한글 카드 최대 크기(사장님 2026-10-02 16:36 "최대 크기 콘드를 프로젝트별로 2~4px씩 줄여야 할꺼야"): 38px → 34px.
   * 같은 px 라도 한글 글자(나눔스퀘어라운드 EB, 잉크 약 0.87em)가 영어 대문자 · 올라간 글자(Lexend, 약 0.74em)보다 커서
   * 38px 한글은 같은 38px 영어 짝보다 한 치수 크게 보였다. 34px 한글 잉크(약 29.6px)가 38px 영어(약 28.1px)와 가장 가깝다.
   * 실데이터 LV1~9 전후 측정은 검수_회신.md "한글 카드 최대 크기". 배율 1 = 38px(styles.css .card-text).
   */
  const KOREAN_MAX_PX = 34;
  const KOREAN_MAX_SCALE = KOREAN_MAX_PX / 38;
  /*
   * 한글 카드 줄 수별 크기(사장님 2026-10-02 "줄이 바낄대 마다 일정하게 줄어들게 해야함" · "3px씩으로 적용해"):
   * n줄이면 KOREAN_LINE_PX[n-1] — 1줄 34px, 줄이 하나 늘 때마다 3px씩(34/31/28/25/22/19/16/13/10). 같은 줄 수면 어느 카드든
   * 같은 크기다. 예전에는 카드마다 0.05 · 0.01 씩 줄여 딱 맞는 크기를 찾았고(2줄 우선 · 바닥 26.6px) 아이콘에 닿아도 줄여서,
   * 같은 3줄이 26.6px · 24.32px 처럼 제각각이었다("야 같은 세줄인데 왜 다른건데 ?"). 맞춤은 createTextMeasurer 의 한글 갈래.
   */
  const KOREAN_LINE_STEP_PX = 3;
  const KOREAN_LINE_PX = Object.freeze(Array.from({ length: 9 }, (_, index) => KOREAN_MAX_PX - KOREAN_LINE_STEP_PX * index));
  const ENGLISH_MAX_WRAPPED_LINES = 2;
  /* 단어 사이 간격. 줄바꿈 없는 공백(U+00A0)은 데이터가 붙여 두라는 뜻이라 단어를 가르지 않는다. */
  const ENGLISH_WORD_GAP = /[^\S\u00A0]+/;

  /*
   * 한글 뜻 문자열 처리(사장님 2026-10-02 16:36 "비율에 잘 맞게 나올수있 도록 문자열 처리"). 실데이터 뜻 319개 중 87개가
   * "1. (…) …, (2. …)" 꼴이라 줄 끝에 "1." · "(2." 만 홀로 남곤 했다(640번 맞춤 중 66번).
   * - 번호 표시 뒤 띄어쓰기는 줄바꿈 없는 공백(U+00A0)으로 바꿔 다음 말과 붙인다. 데이터에 띄어쓰기가 없는 "(2.프랑스인" 은
   *   보이지 않는 단어 잇기(U+2060)를 넣는다(모양은 그대로). "3.5" 처럼 수가 이어지면 그대로다.
   * - 말줄임("..." · "…") 바로 뒤 글자도 단어 잇기로 붙인다 — 크롬은 keep-all 이어도 마침표와 한글 사이를 가를 수 있어
   *   "(..." / "도)" 처럼 괄호 안이 갈리거나 "2. …" 만 줄 끝에 남았다.
   * 붙이면 끊을 자리가 줄어 2줄에 못 들어가는 뜻이 생긴다(예: "1. 동맹자, 동맹국, (2. 동지, 협력자, 지지자)" 24.3px 2줄 →
   * 22.8px 3줄). 크기 · 줄 수를 잃지 않는 것이 먼저라, 맞춤(createTextMeasurer)이 붙인 글자와 원래 글자(unglueKoreanMarkers)를 둘 다 재어
   * 붙인 쪽이 작아지거나 같은 크기에서 줄이 늘면 원래 글자를 쓴다(keepGluedKoreanFit).
   */
  const KOREAN_MARKER_GAP = /(^|[\s(])(\d+\.)([^\S\n]*)(?=[^\s\d\u2060])/g;
  const KOREAN_ELLIPSIS_GAP = /(\.{2,}|…)(?=[^\s.…)\u2060])/g;
  function glueKoreanMarkers(text) {
    return String(text)
      .replace(KOREAN_MARKER_GAP, (match, lead, marker, gap) => `${lead}${marker}${gap ? "\u00A0" : "\u2060"}`)
      .replace(KOREAN_ELLIPSIS_GAP, "$1\u2060");
  }
  function unglueKoreanMarkers(text) {
    return String(text).replace(/\u2060/g, "").replace(/(^|[\s(])(\d+\.)\u00A0/g, "$1$2 ");
  }
  function keepGluedKoreanFit(glued, plain) {
    return !(plain.scale > glued.scale || (plain.scale === glued.scale && plain.lines < glued.lines));
  }

  /*
   * 카드 그림 실측: 왼쪽 위 아이콘이 흰 글자 상자 안으로 들어오는 영역(카드 좌표, px).
   * card_gr 조개 x ≤ 70, y ≤ 65 / card_yel 불가사리 x ≤ 73, y ≤ 76.
   */
  const CARD_ICON_CLEAR = Object.freeze({
    green: Object.freeze({ right: 70, bottom: 65 }),
    yellow: Object.freeze({ right: 73, bottom: 76 }),
  });
  const TEXT_SCALE_STEP = 0.05;
  const TEXT_SCALE_MIN = 0.5;

  /*
   * 글자 크기 측정기. 판에 깔린 카드 하나를 복제해 변환(뒤집기·들림)을 걷어낸 보이지 않는 카드로
   * 잰다. 무대 배율은 카드 실제 폭 대비 레이아웃 폭으로 되돌린다. 예전 판정(scrollWidth 대
   * clientWidth)은 글자 상자가 grid 라 칸이 글자 폭만큼 늘어나 넘침을 보지 못했다 — 실제 글자 줄
   * 영역(Range)을 글자 상자·아이콘 영역과 비교한다.
   */
  function createTextMeasurer(sampleCard) {
    const probe = sampleCard.cloneNode(true);
    probe.setAttribute("aria-hidden", "true");
    probe.tabIndex = -1;
    probe.classList.remove("is-picked", "is-matched", "is-cleared", "is-wrong");
    probe.style.visibility = "hidden";
    probe.style.transition = "none";
    probe.style.animation = "none";
    probe.style.transform = "none";
    probe.querySelectorAll(".card-inner, .card-front").forEach((node) => {
      node.style.transform = "none";
      node.style.transition = "none";
    });
    elements.cardGrid.append(probe);
    const label = probe.querySelector(".card-text");
    const inner = probe.querySelector(".card-text-inner");
    const icon = CARD_ICON_CLEAR[elements.cardGrid.dataset.theme === "yellow" ? "yellow" : "green"];
    const setScale = (scale) => label.style.setProperty("--card-text-scale", String(scale));

    // 줄 수는 단어 칸(.word-part) 안 글자 사각형으로 센다. 같은 줄 안의 작은 높이 차이는 글자 높이의 절반까지 한 줄로 본다.
    function countLines() {
      const rects = [];
      inner.querySelectorAll(".word-part").forEach((part) => {
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

    // 한글 줄 수: 글자 줄 사각형을 위에서부터 세어 같은 줄(글자 높이의 절반 안)은 하나로 본다.
    function countTextLines() {
      const range = document.createRange();
      range.selectNodeContents(inner);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0).sort((left, right) => left.top - right.top);
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

    function blocked() {
      const cardRect = probe.getBoundingClientRect();
      const zoom = probe.offsetWidth > 0 ? cardRect.width / probe.offsetWidth : 1;
      const style = window.getComputedStyle(label);
      const boxWidth = label.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const boxHeight = label.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const range = document.createRange();
      range.selectNodeContents(inner);
      const whole = range.getBoundingClientRect();
      if (whole.width / zoom > boxWidth + 1 || whole.height / zoom > boxHeight + 1) return true;
      // 줄 상자에는 위아래 여백(line-height)이 붙는다. 글자 몸통만 보도록 글자 크기의 8%씩 걷어낸다.
      const inset = parseFloat(style.fontSize) * 0.08;
      return [...range.getClientRects()].some((line) => {
        if (line.width <= 0) return false;
        const left = (line.left - cardRect.left) / zoom;
        const top = (line.top - cardRect.top) / zoom + inset;
        const bottom = (line.bottom - cardRect.top) / zoom - inset;
        return left < icon.right && top < icon.bottom && bottom > 0;
      });
    }

    // floor 까지 한 단계씩 줄이고, 그 아래로는 0.01 씩 더 줄인다(바닥 아래는 맞을 때까지 — 단어를 빼지 않는다).
    function shrinkWhile(scale, floor, tooBig) {
      let next = scale;
      while (next > floor && tooBig()) {
        next = Math.max(floor, Math.round((next - TEXT_SCALE_STEP) * 100) / 100);
        setScale(next);
      }
      return next;
    }

    return {
      fit(sourceInner, kind) {
        probe.dataset.kind = kind;
        label.classList.remove("is-wrapped");
        inner.replaceChildren(...[...sourceInner.childNodes].map((node) => node.cloneNode(true)));
        inner.style.maxWidth = "";
        inner.style.transform = "";
        if (kind === "ko") {
          // 줄 수별 크기(KOREAN_LINE_PX 주석): 1줄 크기부터 차례로 그려 n줄 안에 들어가는 첫 n 을 쓴다.
          // 그 크기에서 n줄보다 적게 들어가면 폭(max-width)을 좁혀 n줄로 — 같은 줄 수는 같은 크기. 낱말 중간은 가르지 않는다
          // (한글 카드 글자는 overflow-wrap: normal, 좁힌 폭보다 긴 낱말이 있으면 좁히지 않는다).
          // 왼쪽 위 아이콘에 닿으면 줄이지 않고 아래 여유만큼 내려(transform) 피한다 — 여유가 모자랄 때만 다음 줄 수 크기로.
          // 번호 · 말줄임을 붙인 글자가 크기나 줄을 잃으면 원래 글자를 쓴다(glueKoreanMarkers 주석 — unglue: true 면
          // applyBoardTextScales 가 카드 글자를 되돌린다). 결과의 maxWidth · shift 는 applyBoardTextScales 가 카드에 그대로 쓴다.
          const zoomOf = () => { const r = probe.getBoundingClientRect(); return probe.offsetWidth > 0 ? r.width / probe.offsetWidth : 1; };
          const boxOf = () => {
            const style = window.getComputedStyle(label);
            const z = zoomOf();
            const cardRect = probe.getBoundingClientRect();
            const labelRect = label.getBoundingClientRect();
            const top = (labelRect.top - cardRect.top) / z + parseFloat(style.paddingTop);
            const height = label.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
            const width = label.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            return { top, bottom: top + height, width, height, z, cardRect, fontSize: parseFloat(style.fontSize) };
          };
          const textOf = () => {
            const range = document.createRange();
            range.selectNodeContents(inner);
            return { whole: range.getBoundingClientRect(), rects: [...range.getClientRects()].filter((r) => r.width > 0) };
          };
          const linesAt = (width) => {
            inner.style.maxWidth = width ? `${width}px` : "";
            return countTextLines();
          };
          const layoutTier = (n) => {
            const scale = KOREAN_LINE_PX[n - 1] / 38;
            setScale(scale);
            inner.style.maxWidth = "";
            inner.style.transform = "";
            const box = boxOf();
            const fitsBox = () => {
              const t = textOf();
              return t.whole.width / box.z <= box.width + 1 && t.whole.height / box.z <= box.height + 1;
            };
            if (!fitsBox()) return null;
            let lines = countTextLines();
            if (lines > n) return null;
            let maxWidth = 0;
            if (lines < n) {
              // 가장 넓은 폭 중 n줄이 되는 폭을 찾는다(폭이 줄면 줄 수는 늘기만 한다)
              let lo = 1;
              let hi = Math.floor(textOf().whole.width / box.z);
              while (lo < hi) {
                const mid = Math.ceil((lo + hi) / 2);
                if (linesAt(mid) >= n) lo = mid;
                else hi = mid - 1;
              }
              const t = textOf();
              const wordFits = t.whole.width / box.z <= lo + 1;
              if (linesAt(lo) === n && wordFits && fitsBox()) {
                maxWidth = lo;
                lines = n;
              } else {
                linesAt(0);
              }
            }
            const t = textOf();
            const need = Math.max(0, ...t.rects.map((q) => {
              const left = (q.left - box.cardRect.left) / box.z;
              const top = (q.top - box.cardRect.top) / box.z + box.fontSize * 0.08;
              return left < icon.right && top < icon.bottom ? Math.ceil(icon.bottom - top) + 1 : 0;
            }));
            let shift = 0;
            if (need > 0) {
              const room = box.bottom - (t.whole.bottom - box.cardRect.top) / box.z;
              if (need > room) return null;
              shift = need;
              inner.style.transform = `translateY(${shift}px)`;
              if (blocked()) return null;
            }
            return { scale, lines, maxWidth, shift };
          };
          const fitKorean = () => {
            for (let n = 1; n <= KOREAN_LINE_PX.length; n += 1) {
              const result = layoutTier(n);
              if (result) return result;
            }
            inner.style.maxWidth = "";
            inner.style.transform = "";
            let scale = KOREAN_LINE_PX[KOREAN_LINE_PX.length - 1] / 38;
            setScale(scale);
            while (scale > TEXT_SCALE_FLOOR && blocked()) {
              scale = Math.round((scale - 0.01) * 100) / 100;
              setScale(scale);
            }
            return { scale, lines: countTextLines(), maxWidth: 0, shift: 0 };
          };
          const out = (fitResult, unglue) => ({ scale: fitResult.scale, wrapped: false, unglue, maxWidth: fitResult.maxWidth, shift: fitResult.shift, lines: fitResult.lines });
          const glued = fitKorean();
          if (unglueKoreanMarkers(sourceInner.textContent) === sourceInner.textContent) return out(glued, false);
          inner.replaceChildren(...[...sourceInner.childNodes].map((node) => {
            const copy = node.cloneNode(true);
            if (copy.nodeType === Node.TEXT_NODE) copy.data = unglueKoreanMarkers(copy.data);
            return copy;
          }));
          const plain = fitKorean();
          if (keepGluedKoreanFit(glued, plain)) return out(glued, false);
          return out(plain, true);
        }
        let scale = textScaleFor(sourceInner.textContent, kind);
        setScale(scale);
        scale = shrinkWhile(scale, TEXT_SCALE_MIN, blocked);
        if (!blocked()) return { scale, wrapped: false };

        // 영문: 한 줄로 바닥까지 줄여도 넘치면 띄어쓰기 자리에서 두 줄로(데이터 줄바꿈이 있거나 한 단어면 나누지 않는다).
        const canWrap = kind === "en"
          && !inner.querySelector("br")
          && inner.querySelectorAll(".word-part").length >= 2;
        if (canWrap) {
          label.classList.add("is-wrapped");
          scale = 1;
          setScale(scale);
          const tooBig = () => blocked() || countLines() > ENGLISH_MAX_WRAPPED_LINES;
          scale = shrinkWhile(scale, TEXT_SCALE_MIN, tooBig);
          while (scale > TEXT_SCALE_FLOOR && tooBig()) {
            scale = Math.round((scale - 0.01) * 100) / 100;
            setScale(scale);
          }
          return { scale, wrapped: true };
        }

        while (scale > TEXT_SCALE_FLOOR && blocked()) {
          scale = Math.round((scale - 0.01) * 100) / 100;
          setScale(scale);
        }
        return { scale, wrapped: false };
      },
      dispose() {
        probe.remove();
      },
    };
  }

  // 판의 모든 카드 글자 크기를 한 번에 정한다. 뒤집히기 전에 정해 두어 뒤집힌 뒤 크기가 튀지 않는다.
  function applyBoardTextScales() {
    const nodes = state.cardNodes.filter((node) => node.label && node.inner && !node.button.hidden);
    // 화면이 가려져 카드 크기를 잴 수 없으면 건드리지 않는다(모든 카드가 최소 크기로 줄어드는 것을 막는다).
    if (nodes.length === 0 || nodes[0].button.offsetWidth === 0) return;
    const measurer = createTextMeasurer(nodes[0].button);
    const fits = nodes.map((node) => measurer.fit(node.inner, node.button.dataset.kind));
    measurer.dispose();
    const entries = nodes.map((node, index) => ({ kind: node.button.dataset.kind, fit: fits[index].scale }));
    // 한글 · 영어 모두 카드마다 — planBoardTextScales 주석(6장 판도, 사장님 2026-10-01).
    const scales = planBoardTextScales(entries);
    nodes.forEach((node, index) => {
      if (fits[index].unglue) {
        node.inner.childNodes.forEach((child) => {
          if (child.nodeType === Node.TEXT_NODE) child.data = unglueKoreanMarkers(child.data);
        });
      }
      node.label.style.setProperty("--card-text-scale", String(scales[index]));
      // 한글 줄 수별 크기의 폭 좁힘 · 아이콘 피해 내림(createTextMeasurer 한글 갈래)
      node.inner.style.maxWidth = fits[index].maxWidth ? `${fits[index].maxWidth}px` : "";
      node.inner.style.transform = fits[index].shift ? `translateY(${fits[index].shift}px)` : "";
      node.label.classList.toggle("is-wrapped", fits[index].wrapped);
    });
  }

  function setCardLabel(inner, card) {
    inner.replaceChildren();
    if (card.kind === "en") {
      // 2차 수정(공통 기준 "긴 글자"): 단어는 하나씩 줄바꿈 없는 칸(.word-part)에 넣는다 — 두 줄로 나눌 때 띄어쓰기에서만
      // 나뉘게 하려는 것이다(그냥 두면 크롬이 "state-of-the- / art" 처럼 '-' 뒤에서도 나눈다). 데이터 줄바꿈은 그 자리에서.
      formatEnglishLabel(card.text).split(/\s*\n\s*/).forEach((line, lineIndex) => {
        if (lineIndex > 0) inner.append(document.createElement("br"));
        line.split(ENGLISH_WORD_GAP).filter(Boolean).forEach((word, wordIndex) => {
          if (wordIndex > 0) inner.append(document.createTextNode(" "));
          const part = document.createElement("span");
          part.className = "word-part";
          part.textContent = word;
          inner.append(part);
        });
      });
      return;
    }
    String(card.text ?? "").split("\n").forEach((line, lineIndex, lines) => {
      inner.append(document.createTextNode(glueKoreanMarkers(line)));
      if (lineIndex < lines.length - 1) inner.append(document.createElement("br"));
    });
  }

  function setCardsDisabled(disabled) {
    state.cardNodes.forEach(({ button }) => {
      if (!button.hidden) button.disabled = disabled;
    });
  }

  function cardNodeAt(cellIndex) {
    return state.cardNodes.find((node) => node.cell === cellIndex) || null;
  }

  /*
   * 판을 격자에 맞춰 새로 그린다. 카드는 뒷면(3x2 는 item_1, 4x3 은 item_2)으로 나타났다가
   * DEAL_FACE_DOWN_MS 뒤 왼쪽 위부터 차례로 앞면으로 뒤집힌다.
   */
  function renderBoard(board, { onReady } = {}) {
    clearDealTimers();
    const boardState = board.state();
    const geometry = gridGeometry(boardState.layout);
    const theme = boardState.theme;
    elements.cardGrid.replaceChildren();
    elements.cardGrid.dataset.board = String(state.game ? state.game.boardsDealt : 1);
    elements.cardGrid.dataset.theme = theme;
    elements.cardGrid.style.setProperty("--grid-left", `${geometry.left}px`);
    elements.cardGrid.style.setProperty("--grid-top", `${geometry.top}px`);
    elements.stage.dataset.theme = theme;
    state.cardNodes = [];

    const fragment = document.createDocumentFragment();
    boardState.cells.forEach((cell) => {
      const card = cell.card;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card";
      button.dataset.cell = String(cell.index);
      button.style.setProperty("--card-x", `${cell.column * (Cards.CARD_WIDTH + CARD_GAP_X)}px`);
      button.style.setProperty("--card-y", `${cell.row * (Cards.CARD_HEIGHT + CARD_GAP_Y)}px`);
      button.style.setProperty("--card-order", String(cell.index));
      button.disabled = true;
      if (!card) {
        button.hidden = true;
        fragment.append(button);
        state.cardNodes.push({ cell: cell.index, button, label: null, inner: null });
        return;
      }
      button.dataset.kind = card.kind;
      button.dataset.wordId = card.wordId;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute(
        "aria-label",
        card.kind === "en" ? `영어 단어 ${formatEnglishLabel(card.text)}` : `뜻 ${card.text}`,
      );

      const inner = document.createElement("span");
      inner.className = "card-inner";

      const back = document.createElement("img");
      back.className = "card-face card-back";
      back.src = cardBackFor(boardState.layout);
      back.alt = "";
      back.width = Cards.CARD_WIDTH;
      back.height = Cards.CARD_HEIGHT;
      back.draggable = false;

      const front = document.createElement("span");
      front.className = "card-face card-front";
      const frontImage = document.createElement("img");
      frontImage.className = "card-front-image";
      frontImage.src = CARD_FRONT_IMAGES[theme] || CARD_FRONT_IMAGES.green;
      frontImage.alt = "";
      frontImage.width = Cards.CARD_WIDTH;
      frontImage.height = Cards.CARD_HEIGHT;
      frontImage.draggable = false;
      const label = document.createElement("span");
      label.className = "card-text";
      // 재기 전 · 화면이 가려져 못 잴 때(applyBoardTextScales)도 한글은 최대 크기(KOREAN_MAX_PX)를 넘지 않는다.
      if (card.kind === "ko") label.style.setProperty("--card-text-scale", String(KOREAN_MAX_SCALE));
      const labelInner = document.createElement("span");
      labelInner.className = "card-text-inner";
      setCardLabel(labelInner, card);
      label.append(labelInner);
      front.append(frontImage, label);

      inner.append(back, front);
      button.append(inner);
      fragment.append(button);
      state.cardNodes.push({ cell: cell.index, button, label, inner: labelInner });
    });
    elements.cardGrid.append(fragment);
    applyBoardTextScales();
    // 글꼴이 아직 오는 중이면 다 온 뒤 한 번 더 잰다(글꼴이 바뀌면 글자 폭이 달라진다).
    if (document.fonts && document.fonts.status !== "loaded") {
      const boardAtRender = board;
      document.fonts.ready.then(() => {
        if (state.board === boardAtRender && !state.ended) applyBoardTextScales();
      });
    }

    // 뒷면으로 차례로 나타난 뒤, 잠시 있다가 앞면으로 뒤집는다.
    const visibleNodes = state.cardNodes.filter((node) => !node.button.hidden);
    playSound("deal", 0.6);
    visibleNodes.forEach((node, order) => {
      state.dealTimerIds.push(window.setTimeout(() => {
        node.button.classList.add("is-dealt");
      }, order * DEAL_ENTER_STAGGER_MS));
    });
    const flipStartAt = visibleNodes.length * DEAL_ENTER_STAGGER_MS + DEAL_FACE_DOWN_MS;
    visibleNodes.forEach((node, order) => {
      state.dealTimerIds.push(window.setTimeout(() => {
        node.button.classList.add("is-flipped");
        if (order === 0) playSound("flip", 0.55);
      }, flipStartAt + order * FLIP_STAGGER_MS));
    });
    const readyAt = flipStartAt + visibleNodes.length * FLIP_STAGGER_MS + FLIP_DURATION_MS;
    state.dealTimerIds.push(window.setTimeout(() => {
      if (state.ended) return;
      setCardsDisabled(false);
      state.locked = false;
      if (typeof onReady === "function") onReady();
    }, readyAt));
    return readyAt;
  }

  function dealNextBoard() {
    if (!state.game || state.ended) return;
    stopWordAudio();
    state.board = state.game.nextBoard();
    prefetchWordAudio(state.board);
    const boardNumber = state.game.boardsDealt;
    elements.status.textContent = `${boardNumber}번째 판을 깝니다.`;
    // 새 판을 깔 때 "다음 판!" 알림은 띄우지 않는다(사용자 지시 2026-09-15). 화면 읽기 안내는 위 status 가 맡는다.
    renderBoard(state.board);
  }

  function markPicked(cellIndex, picked) {
    const node = cardNodeAt(cellIndex);
    if (!node) return;
    node.button.classList.toggle("is-picked", picked);
    node.button.setAttribute("aria-pressed", String(picked));
  }

  function clearBoardFeedback() {
    state.cardNodes.forEach(({ button }) => {
      button.classList.remove("is-picked", "is-wrong");
    });
    elements.stage.classList.remove("feedback-correct", "feedback-wrong");
  }

  function selectCard(cellIndex) {
    if (state.locked || state.ended || !state.board) return;
    const now = performance.now();
    if (now - state.gameStartedAt >= totalDurationMs) {
      endGame();
      return;
    }

    const result = state.game.select(cellIndex);
    if (result.status === "ignored") return;

    /*
     * 2차 수정(PDF 3쪽 "카드 클릭했을때 효과음 추가", 사장님 2026-10-01 "카드 누를 때 swap.mp3"): 받아들인 누름마다
     * 뒤집기 소리(swap.mp3)를 낸다 — 고름 · 고름 풀기 · 둘째 카드. 소리를 꺼 두었으면 playSound 가 내지 않는다.
     * 검수표 r56(2026-09-08)의 "카드를 클릭할 때 단어 발음은 내지 않는다"는 그대로다 — 단어 발음은
     * 짝이 성립했을 때만 한 번 낸다(resolvePick). 이 소리는 발음이 아니라 효과음이다.
     */
    playSound("flip", 0.55);
    if (result.status === "selected") {
      markPicked(cellIndex, true);
      elements.status.textContent = `${result.selection.kind === "en" ? "영어 단어" : "뜻"} ${result.selection.text} 카드를 골랐습니다.`;
      return;
    }

    if (result.status === "deselected") {
      markPicked(cellIndex, false);
      return;
    }

    state.locked = true;
    setCardsDisabled(true);

    /*
     * 두 번째 카드에도 고른 테를 먼저 보여 준다(확인). 바로 판정 연출로 들어가면
     * 무엇을 눌렀는지 보이지 않는다는 사용자 지시(2026-09-02)에 따라 잠시 뒤에 잇는다.
     */
    markPicked(cellIndex, true);
    const second = result.pair[1];
    elements.status.textContent = `${second.kind === "en" ? "영어 단어" : "뜻"} ${second.text} 카드를 골랐습니다. 확인 중입니다.`;
    state.feedbackTimerId = window.setTimeout(() => {
      if (state.ended) return;
      resolvePick(result);
    }, FEEDBACK_DURATION_MS.confirm);
  }

  // 두 장이 다 골라진 뒤의 판정 연출. 짝이면 글자색 변경 → 사라짐, 아니면 흔들림.
  function resolvePick(result) {
    if (result.status === "match") {
      state.answeredCount += 1;
      const outcome = state.scoreboard.registerMatch();
      const englishNode = cardNodeAt(result.englishCell);
      const koreanNode = cardNodeAt(result.koreanCell);
      [englishNode, koreanNode].forEach((node) => {
        if (!node) return;
        node.button.classList.remove("is-picked");
        node.button.setAttribute("aria-pressed", "false");
        node.button.classList.add("is-matched");
      });
      playSound("correct", 0.9);
      // 검수표 r56: 짝을 맞췄을 때 단어 사운드를 한 번 (두더지 방과 같은 규칙).
      playWordAudio(result.soundUrl);
      elements.stage.classList.add("feedback-correct");
      spawnSparkles(result.englishCell);
      spawnSparkles(result.koreanCell);
      // 검수 3차 r11: 보너스가 붙은 짝만 점수판을 굴려 올린다. 그 외에는 즉시 반영(+점수판 튐).
      if (outcome.bonus) animateScore(currentScore());
      else updateScore();
      // 검수표 r11 후속2: 정답 +100 은 늘 Score 상자 위로 띄운다.
      showScoreDelta(outcome.scoreDelta);
      renderCombo();
      if (outcome.bonus) {
        burstCombo();
        playScoreBonus();
        // 2차 수정: 보너스 점수는 셋째 칸(보너스 공) 위에 BONUS 띠와 함께 — Score 상자 위가 아니다.
        showBonusGain(outcome.bonusDelta);
        playSound("cheer", 0.8);
      } else if (outcome.comboFilled > 0) {
        // 2차 수정: 방금 켜진 칸(첫째·둘째) 위로 정답 점수.
        showStepGain(outcome.comboFilled - 1, outcome.scoreDelta);
      }
      elements.status.textContent = outcome.bonus
        ? `정답입니다. ${scoring.comboEvery}연속 보너스 ${formatScore(scoring.comboBonus)}점을 획득했습니다.`
        : `정답입니다. ${formatEnglishLabel(result.english)} - ${result.meaning}`;

      const boardCleared = result.boardCleared;
      state.feedbackTimerId = window.setTimeout(() => {
        elements.stage.classList.remove("feedback-correct");
        [englishNode, koreanNode].forEach((node) => {
          if (!node) return;
          node.button.classList.add("is-cleared");
        });
        state.feedbackTimerId = window.setTimeout(() => {
          [englishNode, koreanNode].forEach((node) => {
            if (!node) return;
            node.button.hidden = true;
            node.button.disabled = true;
          });
          if (state.ended) return;
          if (boardCleared) {
            elements.status.textContent = "판을 모두 맞혔습니다. 다음 판을 깝니다.";
            state.feedbackTimerId = window.setTimeout(dealNextBoard, BOARD_SWAP_DELAY_MS);
            return;
          }
          state.locked = false;
          setCardsDisabled(false);
        }, FEEDBACK_DURATION_MS.clear);
      }, FEEDBACK_DURATION_MS.correct);
      return;
    }

    // miss
    state.answeredCount += 1;
    const missOutcome = state.scoreboard.registerMiss();
    recordIncorrectAnswer(result);
    result.pair.forEach((card) => {
      markPicked(card.cell, false);
      const node = cardNodeAt(card.cell);
      if (!node) return;
      node.button.classList.add("is-wrong");
    });
    playSound("incorrect", 0.85);
    elements.stage.classList.add("feedback-wrong");
    updateScore({ bump: false });
    showScoreDelta(missOutcome.scoreDelta);
    renderCombo();
    elements.status.textContent = "오답입니다.";
    state.feedbackTimerId = window.setTimeout(() => {
      clearBoardFeedback();
      if (state.ended) return;
      state.locked = false;
      setCardsDisabled(false);
    }, FEEDBACK_DURATION_MS.incorrect);
  }

  /* ---------------- 게임 흐름 ---------------- */

  function endGame() {
    if (state.ended) return;
    state.ended = true;
    state.locked = true;
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    clearDealTimers();
    clearBoardFeedback();
    resetComboBurst();
    if (state.scoreboard) state.scoreboard.close();
    // 굴림 중에 끝나도 점수판은 최종값으로 즉시 맞춘다(검수 3차 r11).
    updateScore({ bump: false });
    elements.stage.classList.remove("clock-running", "timer-urgent", "timer-critical");
    elements.stage.classList.add("timer-ended");
    setCardsDisabled(true);
    stopWordAudio();
    renderTimer(0);
    closeResultDialog({ restoreFocus: false });
    closeIncorrectAnswerDialog({ restoreFocus: false });
    recordUnmatchedWordsOnBoard();
    renderResultBreakdown();
    elements.resultMessage.textContent = "결과를 준비하고 있습니다.";
    setScreen("result");
    // 2차 수정(PDF 2쪽, 공통 기준): 파티클은 Good · Excellent 에서만 터진다. Try Again 에서는 앞 판 것까지 치운다.
    // 등급은 제목 그림 · 여우 · 결과 소리와 같은 판정(getResultTitleAsset)이다.
    if (getResultTitleAsset() === RESULT_TITLE_ASSETS.tryAgain) clearResultParticles();
    else emitResultConfetti();
    state.historyPromise = persistResult();
    emitNavigation("ending");
    elements.status.textContent = `게임이 종료되었습니다. 최종 점수는 ${formatScore(state.scoreboard.getState().score)}점입니다.`;
    elements.tryAgainButton.focus({ preventScroll: true });
  }

  function update(now) {
    if (state.ended) return;
    const remaining = totalDurationMs - (now - state.gameStartedAt);
    renderTimer(remaining);
    if (remaining <= 0) {
      endGame();
      return;
    }
    state.animationFrameId = requestAnimationFrame(update);
  }

  function showStartScreen({ restoreFocus = true } = {}) {
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    clearDealTimers();
    state.animationFrameId = 0;
    state.feedbackTimerId = 0;
    state.locked = true;
    state.ended = true;
    state.resultRequestToken += 1;
    resultDialogRequestToken += 1;
    startRankingRequestToken += 1;
    helpRequestToken += 1;
    resetComboBurst();
    cancelScoreTween();
    clearResultParticles();
    clearBoardFeedback();
    stopIncorrectAudio();
    stopWordAudio();
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
    setCardsDisabled(true);
    // 나가면 그 판은 끝난다 — 판과 저장 약속도 비워, 다음 판이 지난 판 값을 쓰지 않게 한다.
    // 비우기 전에 마지막 판 단어만 기억해 둔다(다시 시작 규칙, rememberLastBoard).
    rememberLastBoard();
    state.game = null;
    state.board = null;
    state.historyPromise = null;
    setStartReady(words.length > 0);
    setScreen("start");
    // 동화 정보 글자는 setScreen 이 시작 화면을 켠 뒤에 잰다. 영문 글꼴(Lexend SemiBold)이 늦게 오면 폭이 달라지므로 받은 뒤에 한 번 더 잰다.
    document.fonts?.load?.(START_STORY_FONT)?.then(fitStartStory, () => {});
    elements.status.textContent = "시작 화면입니다.";
    emitNavigation("start");
    if (restoreFocus && !elements.startButton.disabled) {
      elements.startButton.focus({ preventScroll: true });
    }
  }

  /*
   * 2차 수정(사장님 2026-10-01 여쭐 것 답 "1. ㄱ", 세부 답 "(가)"): 다시 시작할 때 직전 게임 마지막 판에 깔렸던 단어를
   * 새 게임 첫 판에 넣지 않는다(cards.js createGame). 게임이 끝났든(Try Again · 결과 X) 도중에 나갔든(게임 중 X)
   * 그때 화면에 깔린 판이 마지막 판이다. 페이지를 새로 열면 기억하지 않는다 — 브라우저 저장소를 쓰지 않는다.
   */
  let lastBoardWordKeys = [];

  /*
   * 2차 수정(반박 검토가 찾음): Start · Try Again 은 눌림 모양을 보여 주느라 0.12초 뒤에 시작한다. 그 사이 한 번 더
   * 누르면 게임이 두 번 시작돼, 둘째 게임이 화면에 나오지도 않은 첫 게임의 판을 '직전 마지막 판'으로 피했다
   * (다시 시작 규칙이 깨짐 — 헤드리스 두 번 누름 12번 중 7번). 예약이 걸려 있으면 다시 걸지 않는다.
   */
  let startTimerId = 0;
  function scheduleStart() {
    if (startTimerId) return false;
    startTimerId = window.setTimeout(() => {
      startTimerId = 0;
      startGame();
    }, 120);
    return true;
  }

  function rememberLastBoard() {
    if (state.game && typeof state.game.boardWordKeys === "function") {
      lastBoardWordKeys = state.game.boardWordKeys();
    }
  }

  function startGame() {
    if (words.length === 0) {
      showToast("게임 데이터를 준비하고 있습니다.");
      return;
    }
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    clearDealTimers();
    resetComboBurst();
    clearResultParticles();
    closeResultDialog({ restoreFocus: false });
    closeIncorrectAnswerDialog({ restoreFocus: false });
    stopIncorrectAudio();
    incorrectAnswerRecords.clear();
    incorrectAnswerSequence = 0;
    updateIncorrectAnswersButton();
    state.historyRequested = false;
    state.resultRequestToken += 1;
    resultDialogRequestToken += 1;
    startRankingRequestToken += 1;
    helpRequestToken += 1;
    state.answeredCount = 0;
    state.locked = true;
    state.ended = false;

    try {
      rememberLastBoard();
      state.game = Cards.createGame({ words, avoid: lastBoardWordKeys });
    } catch (error) {
      state.ended = true;
      showLoading("게임을 준비하지 못했습니다", error?.message || "카드를 만들 수 없습니다.", { error: true, retry: true });
      return;
    }
    state.scoreboard = Rules.createScoreboard({
      correctScore: scoring.correct,
      incorrectScore: scoring.incorrect,
      streakLength: scoring.comboEvery,
      streakBonus: scoring.comboBonus,
      playTimeSeconds: Math.round(totalDurationMs / 1000),
    });

    clearBoardFeedback();
    elements.stage.classList.remove("timer-ended", "timer-urgent", "timer-critical");
    elements.stage.classList.add("clock-running");
    void elements.timerClock.offsetWidth;
    setScreen("play");
    elements.resultMessage.textContent = "";
    updateScore({ bump: false });
    renderCombo();
    renderTimer(totalDurationMs);
    elements.status.textContent = "게임을 시작합니다.";

    const now = performance.now();
    state.gameStartedAt = now;
    state.animationFrameId = requestAnimationFrame(update);
    dealNextBoard();
    emitNavigation("game");
  }

  async function initializeContent({ force = false } = {}) {
    const loader = window.WordMatchContent;
    const token = ++contentRequestToken;
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    clearDealTimers();
    setCardsDisabled(true);
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
      // 2차 수정: 한 판 시간은 API play_time 이 먼저, 알 수 없으면 40초(resolveDurationMs).
      totalDurationMs = resolveDurationMs(loaded.content.info, launchContext);
      // 준비 알림에는 API 가 실제로 준 시간만 싣는다(데모 · 테스트 · 쓸 수 없는 값이면 0).
      apiPlayTimeMs = launchContext?.isTest || launchContext?.isDemo ? 0 : apiDurationMs(loaded.content.info);
      renderStartStory(loaded.content.info);
      // 한글 글꼴을 받은 뒤에 시작 화면을 연다(위 loadKoreanFont).
      await koreanFontReady;
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
        apiPlayTimeMs,
      });
    } catch (error) {
      if (token !== contentRequestToken) return;
      words = [];
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

  /* ---------------- 이벤트 ---------------- */

  elements.stage.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (
      !button
      || button.disabled
      || button === elements.soundButton
      || button.classList.contains("card")
      || button.dataset.skipTouch === "true"
    ) return;
    playSound("touch");
  }, { capture: true });

  // 카드는 script.js가 만들므로 위임으로 받는다.
  elements.cardGrid.addEventListener("click", (event) => {
    const button = event.target.closest?.(".card");
    if (!button || button.disabled) return;
    selectCard(Number(button.dataset.cell));
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
    // 2차 수정(PDF 4쪽, 공통 기준 "소리 끈 상태"): 켜고 끌 때 안내 팝업을 띄우지 않는다. 버튼 그림이 바뀌는 것으로 알린다.
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
    scheduleStart();
  });
  elements.startRankingButton.addEventListener("click", () => void showStartRanking());
  elements.helpButton.addEventListener("click", () => {
    if (elements.helpButton.disabled) return;
    pressControl(elements.helpButton);
    window.setTimeout(openHelp, 120);
  });
  elements.helpRetryButton.addEventListener("click", () => void loadHelp({ retry: true }));

  /*
   * 공통 9-2(사장님 지시 2026-09-29): 결과화면 X 버튼. "다시 하기"와 달리 나가면 그 판은 끝나므로
   * 점수 저장이 끝난 뒤에 시작 화면으로 보낸다. 저장이 실패해도 화면은 넘어간다.
   */
  async function leaveToStartScreen(button) {
    if (button.disabled) return;
    pressControl(button);
    button.disabled = true;
    try {
      await state.historyPromise;
    } catch {
      // 저장 실패 문구는 persistResult 가 이미 남긴다.
    } finally {
      button.disabled = false;
      showStartScreen();
    }
  }

  function replayGame(button) {
    pressControl(button);
    scheduleStart();
  }

  elements.resultCharacter.addEventListener("load", () => {
    elements.resultCharacter.hidden = false;
  });
  elements.resultCharacter.addEventListener("error", () => {
    elements.resultCharacter.hidden = true;
  });
  elements.resultHomeButton.addEventListener("click", () => leaveToStartScreen(elements.resultHomeButton));
  elements.tryAgainButton.addEventListener("click", () => replayGame(elements.tryAgainButton));
  elements.incorrectAnswersButton.addEventListener("click", openIncorrectAnswerDialog);
  elements.incorrectAnswerClose.addEventListener("click", () => closeIncorrectAnswerDialog());
  elements.incorrectAnswerBackdrop.addEventListener("click", () => closeIncorrectAnswerDialog());
  elements.rankingButton.addEventListener("click", () => void showRanking());
  elements.resultDialogClose.addEventListener("click", () => closeResultDialog());
  elements.resultDialogBackdrop.addEventListener("click", () => closeResultDialog());
  elements.retryButton.addEventListener("click", () => void initializeContent({ force: true }));

  // 배경음은 사용자가 처음 화면을 만졌을 때 시작한다. 그 전에는 브라우저가 막는다.
  document.addEventListener("pointerdown", armBgm, { once: true });
  document.addEventListener("keydown", armBgm, { once: true });

  window.addEventListener("resize", fitStage);
  window.addEventListener("orientationchange", fitStage);
  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    clearDealTimers();
    resetComboBurst();
    cancelScoreTween();
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
    }
  });

  fitStage();
  updateSoundUI();
  setStartReady(false);
  void initializeContent();
})();
