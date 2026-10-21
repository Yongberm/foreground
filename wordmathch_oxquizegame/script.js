(function wordMatchOxQuiz() {
  "use strict";

  /* 2차 후속 ④: 한 판 시간은 API info 의 play_time(초)이 먼저다(사장님 결정 — 2차 수정 12번 "40초 고정"을 바꿨다).
     40초는 API 로 시간을 알 수 없을 때만 쓴다: 값이 없음 · 0 이하 · 숫자가 아님, info 요청 실패, 데모·테스트 모드. */
  const FALLBACK_DURATION_MS = 40_000;
  /* 한 문제는 한 번만 답한다 — 틀리면 바로 오답노트에 남기고 다음 단어로 넘어간다. "3번 다 틀려야 오답노트" 규칙은
     Spelling Builder 것이라 이 방(Word Match)에는 넣지 않는다(사장님 2026-10-12 "OX는 적용 하면안돼는 부분").
     같은 날 오전에 넣었던 3회 규칙을 빼면서 문제당 4초 자동 넘김도 되살렸다("예전처럼 되살림"). */
  const DEFAULT_QUESTION_DURATION_MS = 4_000;
  const FEEDBACK_DURATION_MS = Object.freeze({
    correct: 1_200,
    incorrect: 1_800,
  });
  /* 대기 그림은 effect_ani_idle_v5.gif 의 1번 프레임(눈 뜬 그림)을 뽑은 정지 그림이다 — 깜빡이지 않는다
     (사장님 2026-10-08 "눈 만 떠있게 1로 고정"). 원래 GIF 는 그대로 두었고 쓰지 않는다. */
  const CHARACTER_IMAGES = Object.freeze({
    idle: "assets/game/effect_idle_open.png",
    correct: "assets/game/effect_ani_correct.gif",
    incorrect: "assets/game/effect_ani_ Incorrect.gif",
  });
  const START_CHARACTER_IMAGE = "assets/start/effect_ani_correct_once.gif";
  const SOUND_ASSETS = Object.freeze({
    touch: "assets/sound/touch.mp3",
    correct: "assets/sound/success.mp3",
    incorrect: "assets/sound/fail.mp3",
  });
  /* 배경음: the_morning_hop (사용자 지정). 원본 이름 앞 공백은 주소에서 %20 으로 새므로 옮기면서 뗐다.
     볼륨은 같은 곡을 쓰는 형제 방(spellingbuilde_classroom·spellingbuilde_start)과 같은 0.15 다.
     이 곡은 평균 레벨이 높아 형제 방이 절반쯤 낮춰 쓰고 있어, 효과음 아래에 깔린다. */
  const BGM_SRC = "assets/sound/bgm/the_morning_hop.mp3";
  const BGM_VOLUME = 0.15;
  const BGM_GESTURE_EVENTS = Object.freeze(["pointerup", "click", "touchend", "keydown"]);

  /* 검수 공통 7항: 버전을 코드에 박으면 올릴 때 두 곳을 고쳐야 한다. 스타일시트 링크에서 읽는다.
     제목 그림에서 읽으면 처음 그림에 버전이 없는 방은 빈 값이 되어 조용히 실패한다(버블터치). */
  function readAssetVersion() {
    const href = document.querySelector('link[rel="stylesheet"]')?.getAttribute("href") || "";
    const found = href.match(/[?&]v=([^&"']+)/);
    return found ? `?v=${found[1]}` : "";
  }
  const ASSET_VERSION = readAssetVersion();

  /* 검수 신규: 결과화면 여우는 등급에 따라 바뀐다. 시안에서 잰 자리에 그림 요소로 놓는다
     (의사 요소 배경으로는 자바스크립트가 등급에 따라 바꿀 수 없다). */
  const RESULT_FOX_ASSETS = Object.freeze({
    excellent: `assets/result/excellent.png${ASSET_VERSION}`,
    good: `assets/result/good.png${ASSET_VERSION}`,
    tryAgain: `assets/result/try_again.png${ASSET_VERSION}`,
  });

  /* 여우 그림을 그냥 갈아 끼우면 새 그림이 다 받아질 때까지 지난 등급 여우가 계속 그려진다.
     찬 캐시에서 실제로 그랬다(대조군 세 번 모두 지난 그림). 감춘 뒤 바꾸고 다 받으면 푼다.
     ⚠ 이 두 함수는 RESULT_FOX_ASSETS 를 읽으므로 반드시 그 아래에 있어야 한다. */
  function preloadResultFoxes() {
    Object.values(RESULT_FOX_ASSETS).forEach((source) => {
      const image = new Image();
      image.decoding = "async";
      image.src = source;
    });
  }

  function showResultFox(tier) {
    const fox = elements.resultFox;
    const next = RESULT_FOX_ASSETS[tier];
    const 준비됨 = () => fox.complete && fox.naturalWidth > 0;
    // 같은 그림이 이미 준비되어 있으면 감출 까닭이 없다(같은 주소는 load 가 안 뜰 수도 있다).
    if (fox.getAttribute("src") === next && 준비됨()) {
      fox.hidden = false;
      return;
    }
    fox.hidden = true;
    // 못 받아도 자리를 영영 비워 두지 않는다.
    const reveal = () => { fox.hidden = false; };
    fox.onload = reveal;
    fox.onerror = reveal;
    fox.src = next;
    if (준비됨()) reveal();
  }

  const RESULT_TITLE_ASSETS = Object.freeze({
    excellent: { src: "assets/result/result_text0.png", alt: "Excellent" },
    good: { src: "assets/result/result_text1.png", alt: "Good" },
    /* 검수 3차 r10 으로 내용이 바뀐 그림이다. 파일 이름이 그대로라 주소에 버전을 달지 않으면
       학습자 브라우저가 옛 그림을 계속 쓴다(함정 12). 0번과 1번은 바뀌지 않아 달지 않는다. */
    tryAgain: { src: `assets/result/result_text2.png${ASSET_VERSION}`, alt: "Try Again" },
  });
  /* 리워드 제공 기준(사장님 결정 2026-09-29): Try again 은 70% 미만, Good 은 70~99%, Excellent 는 100%.
     정확히 70% 는 Good 이다. 경계는 여기 한 곳에만 둔다.
     분모는 화면의 Correct + Incorrect 다 — 맞힌 수와 못 맞힌 단어 수(오답노트 줄 수).
     사장님 2026-10-12 "출력물, 오답 화면 내용이 다름 통일해야함" · 등급 "같은 숫자로".
     못 맞힌 단어에는 틀리게 누른 것과 4초 안에 누르지 않아 넘어간 것이 모두 든다. */
  const RESULT_TITLE_THRESHOLDS = Object.freeze({
    excellent: 1,
    good: 0.7,
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

  /* 문제 영역 글자 크기는 영문·한글을 따로 잡는다.
     같은 크기로 두면 한글이 더 크게 보인다 — 라틴 글자는 em 상자를 덜 채우고
     한글은 꽉 채우기 때문이다. 형제 두더지(검수 r43)가 같은 지적을 받고
     팻말 영문 52px / 한글 40px(비율 0.77)로 나눠 두었다.
     크기는 5.31cqw(1920 기준 102px). 검수 r23 은 "2단계와 같은 크기"였고 축구 .quiz-word 가
     66px 이라 처음엔 3.44cqw 로 맞췄는데, 축구는 필드 위에 글자만 놓이는 반면 이 게임은
     큰 흰 카드 안에 들어가서 같은 px 라도 카드가 비어 보였다(사용자 확인). 칸 채움 30% -> 45%. 이후 칸을 키우고 여유가 생겨 각각 4px 더 올렸다가, 형제 방 폰트로 바꾸면서 각각 2px 줄였다(한글 4.11cqw = 79px).
     2026-10-02 사장님 "최대 크기 … 2~4px씩 줄여야"(관리 방 전달, 이 방 답 "실측 후 2~4px 안에서 고르기")로 한글을 3.91cqw(75px)로
     줄였다 — LV1~9 실제 뜻 320개를 75·76·77px 로 재서 고른 값. 같은 날 크기 조절은 넘칠 때만 줄이기로 정했다(fitKoreanText).
     r23 이전 값 6.35cqw(122px)보다는 작게 두어 단계 간 편차는 줄인 상태를 유지한다.
     minimum 은 자동 축소가 내려갈 수 있는 하한이다. 한글 lineStepCqw 는 줄이 하나 늘 때마다 줄이는 크기다(fitKoreanLayout). */
  const questionTextSize = Object.freeze({
    english: Object.freeze({
      maximumCqw: Number(gameConfig.typography?.englishMaxCqw) || 5.31,
      minimumCqw: Number(gameConfig.typography?.englishMinCqw) || 2.7,
    }),
    korean: Object.freeze({
      maximumCqw: Number(gameConfig.typography?.koreanMaxCqw) || 3.91,
      minimumCqw: Number(gameConfig.typography?.koreanMinCqw) || 1.72,
      lineStepCqw: Number(gameConfig.typography?.koreanLineStepCqw) || 0.38,
    }),
  });

  let totalDurationMs = FALLBACK_DURATION_MS;
  /* 2차 후속 ⑤: 가장 최근에 화면에 나온 단어. 새 판(Try Again · 처음으로 → Start)의 첫 단어로 바로 잇지 않으려고
     판이 바뀌어도 지우지 않는다. 페이지 안에서만 기억한다(사장님 결정 — 브라우저 저장소에 남기지 않는다). */
  let lastShownWordKey = null;
  let questions = [];
  let launchContext = null;

  const elements = {
    stage: document.querySelector("#game-stage"),
    startScreen: document.querySelector("#start-screen"),
    startCharacter: document.querySelector(".start-character"),
    playScreen: document.querySelector("#play-screen"),
    helpScreen: document.querySelector("#help-screen"),
    startButton: document.querySelector("#start-button"),
    startRankingButton: document.querySelector("#start-ranking-button"),
    startStory: document.querySelector("#start-story"),
    startStoryTitle: document.querySelector("#start-story-title"),
    startStorySubtitle: document.querySelector("#start-story-subtitle"),
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
    korean: document.querySelector("#word-korean"),
    score: document.querySelector("#score-value"),
    scoreBurst: document.querySelector("#score-burst"),
    time: document.querySelector("#time-value"),
    timerFill: document.querySelector("#timer-fill"),
    timerClock: document.querySelector(".timer-clock"),
    bonusMeter: document.querySelector("#bonus-meter"),
    bonusGain: document.querySelector("#bonus-gain"),
    bonusGainValue: document.querySelector("#bonus-gain .bonus-gain-value"),
    bonusStepGains: Array.from(document.querySelectorAll(".bonus-step-gain")),
    scoreDeltaLayer: document.querySelector("#score-delta-layer"),
    bonusSlots: Array.from(document.querySelectorAll(".bonus-slot")),
    buttons: Array.from(document.querySelectorAll(".answer-button")),
    character: document.querySelector(".character"),
    status: document.querySelector("#game-status"),
    endScreen: document.querySelector("#end-screen"),
    resultReplayButton: document.querySelector("#result-replay-button"),
    resultParticleCanvas: document.querySelector("#result-particle-canvas"),
    resultTitle: document.querySelector("#result-title"),
    resultFox: document.querySelector("#result-fox"),
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
    // 못 맞힌 단어 수 — 오답노트에 실린 단어 수와 늘 같다(recordIncorrectAnswer 가 맞춘다). 결과 화면 Incorrect 와 등급에 쓴다.
    incorrectCount: 0,
    historyRequested: false,
    resultRequestToken: 0,
  };
  const incorrectAnswerRecords = new Map();
  let comboBurstTimer = null;
  let scoreBonusTimer = null;
  let bonusGainTimer = null;
  let scoreShown = 0;
  let scoreTween = 0;
  const scoreDeltaTimers = new Set();
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
  let bgmGestureHandler = null;
  let leavingToStart = false;
  let toastTimer = 0;
  const activeEffectAudios = new Set();

  /* 검수 10항: 화면에 나가는 점수는 모두 이 함수를 거친다.
     잘라내기가 아니라 반올림이다 — 점수 상수를 gameConfig 에서 받으므로 소수가 쌓이면
     999.6 이 999 로 1 낮게 찍힌다. 그리고 -0.4 를 반올림하면 자바스크립트에서 음수 영이 되어
     "-0" 으로 읽히므로 영으로 눕힌다. */
  function formatScore(value) {
    const rounded = Math.round(Number(value) || 0);
    return (rounded === 0 ? 0 : rounded).toLocaleString("en-US");
  }

  function emitNavigation(screen, detail = {}) {
    window.dispatchEvent(new CustomEvent("wordmatch:navigate", {
      detail: { screen, ...detail },
    }));
  }

  /* [앱 전용 자리] 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — LF 가 앱(Android · iOS)에 올릴 때 직접 작업한다
     (업체 답 2026-10-12 "앱 : 웹뷰 닫는 인터페이스 호출 … 내부에 앱에 올릴때 직접 작업예정").
     지금은 비어 있다. 화면에 알림은 띄우지 않는다(사장님 2026-10-12 "함수 자리만 표시") — 웹에서는 closeGame 이 창을 닫는다. */
  function closeAppWebView() {}

  /* 게임을 닫는다 — 시작 화면의 X 버튼. 업체 답(2026-10-12): 웹은 새 창으로 열리므로 창을 닫고, 앱은 웹뷰 닫기 인터페이스를 부른다.
     그 전(2026-10-08 "X버튼 누를 경우 뒤로가기")에는 history.back() 만 했는데, 새 창에는 돌아갈 페이지가 없어 눌러도 아무 일도 없었다.
     스크립트가 연 창이 아니면(주소를 직접 연 탭 · 링크로 들어온 같은 탭 · 앱 웹뷰) 브라우저가 닫아 주지 않는다 — 그때는 예전처럼
     이전 페이지로 돌아간다. 알림은 띄우지 않는다(뒤로 간 페이지가 보관됐다 돌아오면 알림이 남는다). */
  function closeGame() {
    emitNavigation("close");
    closeAppWebView();
    window.close();
    if (!window.closed) window.history.back();
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
    /* 검수 공통 9-3: 결과화면에서는 배경음을 내지 않는다. 여기 한 곳에서 막아야
       소리 토글 · 제스처 리스너 · 뒤로가기 복귀 세 경로가 함께 막힌다. */
    if (currentScreen === "result") return;
    // 활성화가 없어 거부되면(터치 첫 조작 등) 다음 제스처에 다시 시도한다.
    ensureBgm().play()?.catch(() => armBgmOnGesture());
  }

  /*
   * 브라우저는 사용자가 한 번 누르기 전에는 소리를 내주지 않는다. 첫 조작 때 배경음을 틀고,
   * 그때 음소거였다면 "틀고 싶다"만 기억했다가 켜는 순간 이어 간다.
   * 터치 기기의 pointerdown 은 사용자 활성화로 인정되지 않아 play() 가 거부되므로(형제 racing 검수 확정)
   * pointerup·click·touchend·keydown 에 걸고, 거부되면 다음 제스처에 다시 건다.
   */
  function armBgmOnGesture() {
    if (bgmGestureHandler) return;
    const handler = () => {
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

  /* 새 단어가 뜰 때(판 시작 · 다음 단어 · 틀려서 다시 낼 때) 발음을 한 번 들려준다 — 회원이고 소리가 켜져 있을 때만.
     2026-10-12: 문제 카드의 단어 듣기 버튼은 뺐다(2차 검수 WM공통-1 "단어 듣기 사운드 버튼 삭제" — Word Match 통일).
     그래서 직접 눌러 다시 듣는 길과 그 안내(발음 정보 없음 · 재생 실패)는 없다. 오답노트의 스피커는 그대로다. */
  function playQuestionAudio() {
    if (!isLoggedInMember() || !soundEnabled) return;
    const soundUrl = String(state.currentQuestion?.soundUrl || "").trim();
    if (!soundUrl) return;

    stopQuestionAudio();
    const audio = new Audio(soundUrl);
    activeQuestionAudio = audio;
    const finish = () => {
      if (activeQuestionAudio === audio) activeQuestionAudio = null;
    };
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    audio.play()?.catch(finish);
  }

  function updateSoundUI() {
    elements.soundIcon.src = soundEnabled
      ? "assets/btn_sound_on.png"
      : "assets/btn_sound_off.png";
    elements.soundButton.setAttribute("aria-pressed", String(soundEnabled));
    elements.soundButton.setAttribute("aria-label", soundEnabled ? "소리 끄기" : "소리 켜기");
  }

  /* 시작 화면의 동화 정보 — API info 의 title(시리즈 제목) · subtitle(이야기 제목)을 로고와 Start 버튼 사이에 두 줄로 보여 준다
     (사장님 2026-10-12 "동화API … 적용 배치는 시작화면 로고와 버튼 사이", 검수표 공통-9).
     한 줄만 오면 그 줄만, 둘 다 없으면(테스트 모드 · 데모 · info 실패) 띠를 숨긴다 — 값을 지어 넣지 않는다. */
  function renderStartStory(info) {
    const title = String(info?.title ?? "").trim();
    const subtitle = String(info?.subtitle ?? "").trim();
    elements.startStoryTitle.textContent = title;
    elements.startStorySubtitle.textContent = subtitle;
    elements.startStoryTitle.hidden = !title;
    elements.startStorySubtitle.hidden = !subtitle;
    elements.startStory.hidden = !title && !subtitle;
  }

  /* 동화 정보 글자를 자리 폭에 맞춘다 — 길면 말줄임으로 자르지 않고 두 줄을 같은 배율로 줄인다
     (사장님 2026-10-12 "텍스트 범위는 지금 처럼 하돼 글자가 길어지면 폰트 크기를 줄이게"). 배율은 CSS 의 기준 크기(2.083333cqw,
     1920 기준 40px)에 곱한다. 바닥(0.5배, 20px)에서도 넘치면 그때만 CSS 의 말줄임이 남는다.
     화면에 보일 때만 잴 수 있다 — 숨어 있으면 폭이 0 이라 배율은 1 로 남는다. */
  function fitStartStory() {
    const story = elements.startStory;
    if (story.hidden) return;
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
    elements.helpScreen.hidden = screen !== "help";
    elements.playScreen.hidden = screen !== "play";

    const resultVisible = screen === "result";
    /* 검수 공통 9-3: 결과화면에서는 소리 설정과 무관하게 배경음을 멈춘다.
       설정 값(soundEnabled)은 건드리지 않으므로 시작 화면으로 나가면 원래대로 다시 난다.
       효과음은 대상이 아니다 — 멈추는 것은 배경음뿐이다. */
    if (resultVisible) pauseBgm();
    else resumeBgm();
    elements.endScreen.classList.toggle("is-visible", resultVisible);
    elements.endScreen.setAttribute("aria-hidden", String(!resultVisible));
    elements.stage.classList.toggle("result-mode", resultVisible);

    const controlsVisible = screen === "start" || screen === "help" || screen === "play";
    /* 2차 수정 2·3번: 도움말 화면에서만 X 대신 뒤로가기 그림을 쓰고 그 버튼을 스피커 자리(왼쪽 위)로 옮긴다.
       2차 후속 A-1: 도움말 화면에서는 스피커를 숨긴다. 시작·게임 화면은 그대로 둔다(사장님 결정).
       자리는 CSS 의 help-mode. */
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
      || (question?.isMatch ? question?.korean : "")
      || "",
    ).trim();
  }

  function getIncorrectAnswerKey(question) {
    return String(question?.english || "").trim().toLocaleLowerCase("en-US");
  }

  function updateIncorrectAnswersButton() {
    const records = [...incorrectAnswerRecords.values()];
    const totalWrongCount = records.reduce(
      (total, record) => total + record.wrongCount,
      0,
    );
    elements.incorrectAnswersButton.disabled = records.length === 0;
    elements.incorrectAnswersButton.setAttribute(
      "aria-label",
      records.length > 0
        ? `오답 보기, ${records.length}개 단어 ${totalWrongCount}회`
        : "오답 없음",
    );
  }

  /** 시간이 지나 넘어간 문항을 오답노트에 넣어야 하는지 본다.
      2차 수정 4번(사장님 2026-10-01): 시간 초과는 Incorrect 로 세므로 앞서 맞힌 단어라도 오답노트에 싣는다.
      9/29 절충안은 "맞혔고 틀린 적 없는 단어는 반복 바퀴에서 시간이 지나도 담지 않는다" 였는데, 그러면
      Incorrect 가 1 인데 노트가 비어 버튼이 숨었다(PDF 의 Correct 33 · Incorrect 1). 이 방은 그 한 줄을 되돌린다 —
      Incorrect 가 하나라도 있으면 버튼이 반드시 보이고, 0 이면 지금처럼 숨는다. */
  function shouldRecordTimeout(question) {
    return Boolean(getIncorrectAnswerKey(question));
  }

  /* 오답노트에 한 줄을 남긴다. 못 맞힌 문제마다 부른다 — 틀리게 눌렀을 때, 4초 안에 누르지 않아 넘어갈 때, 판이 끝날 때
     화면에 떠 있던 문제. 같은 단어는 한 줄로 묶고 wrongCount 만 올린다.
     결과 화면 Incorrect 는 여기서 오답노트 단어 수에 맞춘다(사장님 2026-10-12 "출력물, 오답 화면 내용이 다름 통일해야함"). */
  function recordIncorrectAnswer(question) {
    const key = getIncorrectAnswerKey(question);
    if (!key) return;

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
    state.incorrectCount = incorrectAnswerRecords.size;
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
    /* 긴 단어만 칸에 맞게 줄인다. 값은 배율이다 — CSS 의 기준 크기(2026-10-12 부터 1.56cqw, 1920 기준 30px)에 곱한다.
       예전에는 38 에서 24 까지 세는 px 처럼 보이는 숫자를 썼는데, 검수 q55 로 기준 크기가 38px 에서
       22px 로 내려가면서 같은 배율이 13px 까지 떨어져 읽기 어려워졌다. 바닥을 배율로 못박는다. */
    // 단어 칸(팝업 폭의 약 30%)은 가장 긴 단어가 줄지 않고 들어가는 폭이다. 그보다 긴 단어만 여기까지 줄인다.
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
      wordText.textContent = formatEnglishLabel(record.english);
      wordCell.append(wordText);

      const meaningCell = createIncorrectAnswerCell("incorrect-answer-meaning");
      meaningCell.textContent = record.correctMeaning || "정답 뜻 확인 필요";

      // 검수 q55: 틀린 횟수 칸은 사장님 지시로 화면에서 뺀다. 횟수는 목록 정렬에만 쓴다.
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
    /* 단어 글꼴(Lexend 400)은 이 팝업에서 처음 쓰여 늦게 올 수 있다. 대체 글꼴로 잰 폭은 좁아 긴 구문이 잘렸다
       (the head of the household — 실제 크롬에서 봄). 글꼴을 받은 뒤 한 번 더 맞춘다. */
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

  function getResultTier() {
    const answered = state.correctCount + state.incorrectCount;
    const correctRatio = answered > 0 ? state.correctCount / answered : 0;
    if (correctRatio >= RESULT_TITLE_THRESHOLDS.excellent) return "excellent";
    if (correctRatio >= RESULT_TITLE_THRESHOLDS.good) return "good";
    return "tryAgain";
  }

  function getResultTitleAsset() {
    return RESULT_TITLE_ASSETS[getResultTier()];
  }

  function renderResultRankAndScore(rank, score) {
    const normalizedRank = Math.trunc(Number(rank) || 0);
    const scoreText = formatScore(score);
    elements.resultRank.textContent = normalizedRank > 0 ? `${formatScore(normalizedRank)}위` : "-";
    elements.resultScoreNumber.textContent = scoreText;
    elements.resultTotalScore.setAttribute("aria-label", `${scoreText}점`);
  }

  function renderResultBreakdown() {
    const tier = getResultTier();
    const titleAsset = RESULT_TITLE_ASSETS[tier];
    elements.resultTitle.src = titleAsset.src;
    elements.resultTitle.alt = titleAsset.alt;
    showResultFox(tier);
    /* 검수 공통 6항: Correct·Incorrect 는 점수 합이 아니라 개수다.
       Correct 는 맞힌 횟수(같은 단어가 다음 바퀴에 또 나와 맞히면 또 센다), Incorrect 는 못 맞힌 단어 수다 —
       오답노트(Incorrect Answers)에 실린 줄 수와 같다(사장님 2026-10-12 "출력물, 오답 화면 내용이 다름 통일해야함").
       같은 단어를 다음 바퀴에 또 못 맞혀도 오답노트가 한 줄이라 Incorrect 도 늘지 않는다. 보너스와 내 점수는 점 그대로 둔다.
       화면에는 Correct·Incorrect 뒤에 "개" 를 붙이지 않는다(사장님 2026-10-08). 읽어 주는 말(aria-label)에는 남긴다. */
    const correctCount = state.correctCount;
    const incorrectCount = state.incorrectCount;
    elements.resultCorrectPoints.textContent = formatScore(correctCount);
    elements.resultIncorrectPoints.textContent = formatScore(incorrectCount);
    // 사장님 2026-10-08(모든 컨텐츠 공통): 보너스는 "+" 없이 숫자만 쓰고, 뒤의 "점" 은 CSS(.result-points::after)가 붙인다.
    elements.resultBonusPoints.textContent = formatScore(state.bonusPoints);
    elements.resultCorrectPoints.setAttribute(
      "aria-label",
      `맞힌 문제 ${formatScore(correctCount)}개`,
    );
    elements.resultIncorrectPoints.setAttribute(
      "aria-label",
      `못 맞힌 문제 ${formatScore(incorrectCount)}개`,
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

  /* 2차 후속 A-4·A-5: 한 바퀴를 만든다.
     문제 목록에는 단어마다 정답 문제와 오답 문제가 둘 다 들어 있어(content-loader 의 questionsFromWords)
     전체를 섞으면 한 바퀴에 같은 단어가 두 번 나왔다. 단어마다 둘 중 하나만 무작위로 골라 섞는다.
     다 돌면 다시 만들되, 앞 바퀴 마지막 단어(previousKey)가 새 바퀴 첫 단어로 바로 이어지지 않게 한다.
     새 판을 열 때도 앞 판 마지막 단어를 넘긴다(2차 후속 ⑤ — startGame · resetRoundState). */
  function shuffleQuestionOrder(previousKey = null) {
    const byWord = new Map();
    questions.forEach((question, index) => {
      const key = getIncorrectAnswerKey(question);
      if (!byWord.has(key)) byWord.set(key, []);
      byWord.get(key).push(index);
    });
    const order = [...byWord.values()].map((indexes) => indexes[Math.floor(Math.random() * indexes.length)]);
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

  /* 2차 후속 ④: API info 의 play_time(초)을 한 판 시간(ms)으로 바꾼다. 알 수 없으면 40초.
     숫자이거나 숫자만 적힌 문자열만 받는다 — Number(true) 는 1, Number("") 는 0 이라 그대로 쓰면 1초 판이나 0초 판이 된다.
     유한한지는 ms 로 바꾼 뒤에 본다 — 1e306 초는 유한하지만 ×1000 하면 Infinity 라 판이 끝나지 않는다(적대적 검토가 찾음).
     데모·테스트 모드에는 API 시간이 없다(로더가 넣는 값은 이 맥의 설정이다). */
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

    if (
      element.scrollWidth > element.clientWidth + 1
      || element.scrollHeight > element.clientHeight + 1
    ) {
      const widthRatio = element.clientWidth / Math.max(1, element.scrollWidth);
      const heightRatio = element.clientHeight / Math.max(1, element.scrollHeight);
      const precisionRatio = Math.min(1, widthRatio, heightRatio) * 0.98;
      size = Math.max(0.1, size * precisionRatio);
      element.style.fontSize = `${size.toFixed(2)}cqw`;
    }
    return size;
  }

  /* 2차 후속(사장님 결정 2026-10-01): 영문은 한 줄이 기본이다. 한 줄로 최소 크기(minimumCqw)까지 줄여도 칸에
     안 들어갈 때만 띄어쓰기 자리에서 두 줄로 나눈다 — 줄 길이는 CSS text-wrap: balance 가 고르게 맞추고,
     두 줄 안에서 가장 크게 둔다. 세 줄은 쓰지 않는다(세 줄이 더 크게 들어가도 두 줄).
     단어 데이터에 줄바꿈이 있으면(<br> 로 그렸다) 그 자리를 따르고 자동으로 나누지 않는다.
     띄어쓰기가 없는 한 단어는 나눌 자리가 없어 지금처럼 한 줄로 줄인다(글자 중간에서 자르지 않는다).
     자간으로 맞추는 안(견본 b·c)은 글자·단어가 붙어 사장님이 뺐다. 예: LV9 the head of the household 44px → 두 줄 77px. */
  const ENGLISH_MAX_WRAPPED_LINES = 2;
  /* 낱말 사이 간격(영문·한글 칸 공통). 줄바꿈 없는 공백(U+00A0 · 좁은 U+202F · 숫자 폭 U+2007 · U+FEFF)은
     데이터가 붙여 두라는 뜻이라 낱말을 가르지 않는다. */
  const WORD_GAP = /[^\S\u00A0\u2007\u202F\uFEFF]+/;

  /* 줄 수는 단어 칸(.word-part) 안 글자 사각형의 높이로 센다. 영문 칸 전체를 고르면 단어 칸 자체의 상자도
     함께 잡히는데, 그 상자는 글자보다 2px 쯤 위에 있어 같은 줄을 두 번 센다(적대적 검토가 실제 크롬에서 잼).
     같은 줄 안의 작은 높이 차이는 글자 높이의 절반까지 한 줄로 본다. */
  function countRenderedLines(element) {
    const rects = [];
    element.querySelectorAll(".word-part").forEach((part) => {
      const range = document.createRange();
      range.selectNodeContents(part);
      rects.push(...range.getClientRects());
    });
    return countLines(rects);
  }

  /* 글자 사각형을 위에서부터 훑어, 앞 줄보다 글자 높이의 절반 넘게 내려간 것만 새 줄로 센다. */
  function countLines(rects) {
    const sorted = [...rects].sort((left, right) => left.top - right.top);
    let lines = 0;
    let lineTop = -Infinity;
    sorted.forEach((rect) => {
      if (rect.top > lineTop + rect.height / 2) {
        lines += 1;
        lineTop = rect.top;
      }
    });
    return lines;
  }

  /* 번호·말줄임 붙임(카드와 같은 규칙): "1." · "(2." 뒤 띄어쓰기는 줄바꿈 없는 공백(U+00A0)으로, 띄어쓰기가 없으면 보이지 않는
     낱말 잇기(U+2060)로 다음 말과 붙인다. "3.5" 처럼 수가 이어지면 그대로다. 말줄임("..." · "…") 바로 뒤 글자도 U+2060 으로 붙인다.
     WORD_GAP 이 U+00A0 를 낱말 사이로 보지 않으므로 붙인 번호는 다음 말과 같은 낱말 칸(.word-part)에 들어간다. */
  const KOREAN_MARKER_GAP = /(^|[\s(])(\d+\.)([^\S\n]*)(?=[^\s\d⁠])/g;
  const KOREAN_ELLIPSIS_GAP = /(\.{2,}|…)(?=[^\s.…)⁠])/g;

  function glueKoreanMarkers(text) {
    return String(text ?? "")
      .replace(KOREAN_MARKER_GAP, (match, lead, marker, gap) => `${lead}${marker}${gap ? " " : "⁠"}`)
      .replace(KOREAN_ELLIPSIS_GAP, "$1⁠");
  }

  /* 한글 뜻 크기 — 줄 수마다 크기 하나(사장님 2026-10-02 "줄 바꿀떄마다 일정하게 변경되게", 답 "줄마다 7.3px씩",
     "그 단계 줄 수로 나눔", "한글 뜻만"). 같은 날 정했던 '넘칠 때만 줄이기'는 1~3줄이 모두 75px 이다가 4줄에서 16px 이
     한꺼번에 떨어지고, 넘친 뒤 0.06cqw 씩 줄이다 멈춘 자리라 같은 줄 수 안에서도 크기가 흩어져(3줄 60~75px) 바꿨다.
     - k줄 크기 = 최대 − (k−1) × lineStepCqw(0.38cqw). 1920 기준 75.1 / 67.8 / 60.5 / 53.2 / 45.9 / 38.6px 이고 최소(1.72cqw)
       아래 단계는 쓰지 않는다. 간격은 5줄 뜻이 칸 높이에 들 만큼(6.9px 이상) 잡았다 — 실제 뜻 320개에서 잼.
     - 1줄 크기부터 차례로 그려, 칸을 넘치지 않고 줄 수가 k 이하인 첫 단계를 쓴다. 그 크기에서 줄이 k 보다 적게 나오면
       (한 단계 작아져 다시 줄어든 뜻, 예: 꽥꽥 (우는 소리)) splitKoreanLines 로 k줄로 나눈다 — 같은 줄 수는 언제나 같은 크기다.
     - 띄어쓰기에서만 나누기는 그대로다(사장님 "띄어쓰기에서만"): 낱말마다 줄바꿈 없는 칸이라 띄어쓰기 없이 칸보다 넓은
       덩어리도 넘침으로 보고 다음 단계로 간다. 어느 단계에도 안 들면 최소 크기로 넘침만 막고, 그때도 넓은 덩어리가 남을
       때만 is-breaking 으로 낱말 안 줄바꿈을 연다 — 높이만 넘치면 끊지 않고 최소보다 더 줄인다.
     - 자간은 칸 CSS(.word -0.045em) 그대로다. 줄마다 자간을 늘려 줄 폭을 맞추는 견본도 보셨고 지금 자간으로 정하셨다. */
  function fitKoreanLayout(element, text, { maximumCqw, minimumCqw, lineStepCqw }) {
    renderWordParts(element, text);
    element.classList.remove("is-breaking");
    const over = () => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
    for (let level = 1; ; level += 1) {
      const size = Math.round((maximumCqw - (level - 1) * lineStepCqw) * 100) / 100;
      if (size < minimumCqw - 1e-9) break;
      element.style.fontSize = `${size.toFixed(2)}cqw`;
      if (over()) continue;
      const lines = countRenderedLines(element);
      if (lines > level) continue;
      if (lines < level) splitKoreanLines(element, level);
      return { size, lines: countRenderedLines(element) };
    }
    element.style.fontSize = `${minimumCqw.toFixed(2)}cqw`;
    if (element.scrollWidth > element.clientWidth + 1) element.classList.add("is-breaking");
    const size = fitQuestionText(element, { maximumCqw: minimumCqw, minimumCqw });
    return { size, lines: countRenderedLines(element) };
  }

  /* 뜻을 lines 줄로 나눈다: 감싸는 칸(.word-text)의 최대 폭을 좁혀 가며 줄 수가 lines 가 되는 가장 넓은 폭을 찾는다.
     줄 길이는 CSS text-wrap: balance 가 고르게 맞춘다. 낱말이 모자라 lines 줄이 안 되거나, 그 폭에 안 드는 낱말이 있거나,
     lines 줄이 칸 높이를 넘치면 폭을 풀고 나온 그대로 둔다. */
  function splitKoreanLines(element, lines) {
    const wrapper = element.querySelector(".word-text");
    const narrow = (width) => {
      wrapper.style.maxWidth = `${width}px`;
      return countRenderedLines(element);
    };
    let wide = element.clientWidth;
    let fits = 1;
    if (narrow(fits) < lines) {
      wrapper.style.maxWidth = "";
      return;
    }
    while (wide - fits > 1) {
      const middle = Math.floor((wide + fits) / 2);
      if (narrow(middle) >= lines) fits = middle;
      else wide = middle;
    }
    const split = narrow(fits) === lines
      && wrapper.scrollWidth <= fits + 1
      && element.scrollWidth <= element.clientWidth + 1
      && element.scrollHeight <= element.clientHeight + 1;
    if (!split) wrapper.style.maxWidth = "";
  }

  /* 붙이면 끊을 자리가 줄어 덩어리가 길어지고 더 작아지는 뜻이 생긴다 — 카드처럼 붙인 글자와 원래 글자를 둘 다 재어,
     붙인 쪽이 작아지거나 같은 크기에서 줄이 늘면 원래 글자를 쓴다. */
  function fitKoreanText(element, sizes, text) {
    const plain = String(text ?? "");
    const glued = glueKoreanMarkers(plain);
    const gluedFit = fitKoreanLayout(element, glued, sizes);
    if (glued === plain) return gluedFit.size;
    const plainFit = fitKoreanLayout(element, plain, sizes);
    const keepPlain = plainFit.size > gluedFit.size + 1e-9
      || (Math.abs(plainFit.size - gluedFit.size) < 1e-9 && plainFit.lines < gluedFit.lines);
    return keepPlain ? plainFit.size : fitKoreanLayout(element, glued, sizes).size;
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

  function formatEnglishLabel(value) {
    const label = String(value ?? "").trim();
    if (!label) return "";
    return label.toLocaleLowerCase("en-US");
  }

  function fitRenderedQuestion() {
    fitEnglishText(elements.english, questionTextSize.english);
    fitKoreanText(elements.korean, questionTextSize.korean, state.currentQuestion?.korean);
  }

  /* 영문 글꼴은 font-display: swap 이라 받기 전에 그리면 대체 글꼴로 잰 크기·줄 수가 실제와 어긋난다.
     LV9 첫 문제에서 대체 글꼴로 두 줄이던 구문이 글꼴이 오자 세 줄(79px)이 됐다(실제 크롬에서 잼).
     글꼴을 다 받으면 같은 문제일 때 다시 맞춘다. 이미 받았으면 한 번 더 맞출 뿐이라 결과가 같다. */
  function refitAfterFontsLoad() {
    const question = state.currentQuestion;
    document.fonts?.ready?.then(() => {
      if (state.currentQuestion === question) fitRenderedQuestion();
    });
  }

  /* 창 크기·회전으로 무대 크기가 바뀌면 지금 문제를 다시 맞춘다. cqw 라도 글자 폭이 칸과 정확히 비례하지 않아
     두 줄 경계에 맞춘 구문이 세 줄로 넘쳐 아래가 잘렸다(844×390 에서 맞춘 뒤 1920×1080 으로 — 적대적 검토가 잼).
     맞추면서 바뀌는 것은 글자 크기뿐이라 무대 크기는 그대로다(관찰이 되풀이되지 않는다). */
  function watchStageResize() {
    if (typeof ResizeObserver !== "function") return;
    new ResizeObserver(() => {
      if (currentScreen === "play" && state.currentQuestion) fitRenderedQuestion();
      if (currentScreen === "start") fitStartStory();
    }).observe(elements.stage);
  }

  /* 문제 카드 칸(영문·한글 공통)에 문구를 그린다. 데이터의 줄바꿈(로더가 글자 그대로 온 \n 도 줄바꿈으로 풀어 준다)은
     그 자리에서 바꾸고, 빈 줄은 접는다. 낱말은 하나씩 줄바꿈 없는 칸(.word-part)에 넣어 띄어쓰기에서만 줄이 바뀌게 한다 —
     그냥 두면 크롬이 '-' 뒤·'…' 뒤·'(' 앞에서도 나눈다(영문은 적대적 검토가, 한글은 실제 뜻 320개 실측이 잼).
     칸(.word)은 grid 라 자식 요소가 하나하나 따로 줄을 차지하므로 문구 전체를 감싸는 칸(.word-text) 하나에 넣는다. */
  function renderWordParts(element, text) {
    const wrapper = document.createElement("span");
    wrapper.className = "word-text";
    String(text ?? "").trim().split(/\s*\n\s*/).forEach((line, lineIndex) => {
      if (lineIndex > 0) wrapper.append(document.createElement("br"));
      line.split(WORD_GAP).filter(Boolean).forEach((word, wordIndex) => {
        if (wordIndex > 0) wrapper.append(document.createTextNode(" "));
        const part = document.createElement("span");
        part.className = "word-part";
        part.textContent = word;
        wrapper.append(part);
      });
    });
    element.replaceChildren(wrapper);
  }

  function renderQuestion() {
    renderWordParts(elements.english, formatEnglishLabel(state.currentQuestion.english));
    renderWordParts(elements.korean, state.currentQuestion.korean);
    fitRenderedQuestion();
    refitAfterFontsLoad();
  }

  function renderScore(value = state.score) {
    // 굴림 중간값도 같은 서식을 거친다 — 여기서 따로 반올림하면 서식 규칙이 두 곳으로 갈린다.
    const shown = formatScore(value);
    elements.score.textContent = shown;
    elements.score.setAttribute("aria-label", `점수 ${shown}`);
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // 굴릴 이유가 없는 자리(게임 시작·재시작·종료)는 트윈을 끊고 최종값을 바로 찍는다.
  function updateScore() {
    if (scoreTween) {
      window.cancelAnimationFrame(scoreTween);
      scoreTween = 0;
    }
    scoreShown = state.score;
    renderScore(scoreShown);
  }

  // Score 카드를 한 번 키웠다 되돌린다 (형제 waterpipe bumpScoreCard 기준).
  function bumpScoreCard() {
    const card = elements.score;
    card.classList.remove("is-bumping");
    void card.offsetWidth;
    card.classList.add("is-bumping");
  }

  /* 보너스 순간 Score 상자가 반응한다 — 상자 둘레 금빛 테두리·반짝임(#score-burst)과 점수 숫자 금색 펀치.
     형제 바다속 · 카드 · 두더지 방과 같은 구성이다(사장님 2026-10-12 "보너스 효과 없는것 같은데 형제들 확인해서
     보너스 효과 추가해" · "스코어 쪽 말하는거야"). 그 전에는 Score 상자가 막대 그림에 그려져 있어 보너스를 오른쪽
     보너스 칸(셋째 칸 버스트 · BONUS 표기)으로만 알렸다 — 그쪽 효과는 그대로다. 숫자는 그동안 animateScore 가 굴린다. */
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

  // 얻거나 잃은 점수를 Score 카드 위로 띄워 보낸다 (형제 waterpipe floatScoreDelta 기준).
  function floatScoreDelta(delta, { bonus = false } = {}) {
    if (!delta || !elements.scoreDeltaLayer) return;
    const node = document.createElement("span");
    node.className = `score-delta ${delta > 0 ? "is-plus" : "is-minus"}`;
    if (bonus) node.classList.add("is-bonus");
    node.textContent = `${delta > 0 ? "+" : ""}${formatScore(delta)}`;
    elements.scoreDeltaLayer.append(node);
    scoreDeltaTimers.add(window.setTimeout(() => node.remove(), 1_100));
  }

  // 화면을 떠날 때 떠 있던 표기를 정리한다.
  function clearScoreDeltas() {
    scoreDeltaTimers.forEach((id) => window.clearTimeout(id));
    scoreDeltaTimers.clear();
    if (elements.scoreDeltaLayer) elements.scoreDeltaLayer.replaceChildren();
    elements.score.classList.remove("is-bumping");
  }

  // r11: 보너스가 붙는 순간에만 점수판 숫자를 굴려 올린다 (형제 waterpipe animateScore 기준).
  function animateScore(target) {
    const from = scoreShown;
    if (from === target) return;
    if (prefersReducedMotion()) {
      updateScore();
      return;
    }
    if (scoreTween) window.cancelAnimationFrame(scoreTween);
    const startedAt = Date.now();
    const span = Math.min(720, 280 + Math.abs(target - from) * 2);
    /* 프레임이 돌지 않는 환경(백그라운드 탭, 동작 줄이기)에서는 rAF 콜백이 오지 않아
       숫자가 옛 값에 멈춘다. 시간이 지나면 최종 점수를 반드시 찍어 둔다. */
    window.setTimeout(() => {
      if (scoreShown !== target) {
        scoreShown = target;
        renderScore(target);
      }
    }, span + 120);
    const step = () => {
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

  function showBonusGain() {
    const gain = elements.bonusGain;
    // 2차 후속 A-3: 셋째 칸에는 실제로 점수에 더해지는 보너스 추가점수(scoring.comboBonus)를 BONUS 글자와 함께 띄운다.
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

  function hideBonusGain() {
    window.clearTimeout(bonusGainTimer);
    bonusGainTimer = null;
    elements.bonusGain.classList.remove("is-showing");
    elements.bonusGain.hidden = true;
    stepGainTimers.forEach((timerId) => window.clearTimeout(timerId));
    stepGainTimers.clear();
    elements.bonusStepGains.forEach((gain) => {
      gain.classList.remove("is-showing");
      gain.hidden = true;
    });
  }

  /* 2차 후속 A-3: 첫째·둘째 칸이 켜질 때 그 칸 위로 방금 얻은 정답 점수를 띄운다.
     보너스가 아니므로 셋째 칸의 BONUS 표기보다 작고 희게 둔다 — 보너스가 한눈에 갈리게. */
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
    clearScoreBonus();
  }

  /* 2차 수정 7·8번: 채움 그림(ui_timer2.png) 앞부분은 시계(ui_timer1.png) 밑에 깔리고 양 끝 3.2% 는 투명하다.
     그림 전체 폭에 비례해 자르면 남은 몫이 13.5% 아래로 내려가는 순간 바가 통째로 시계 밑에 숨어
     "10초 남았는데 바가 없다"가 되고, 처음 몇 초는 투명한 꼬리만 깎여 바가 안 움직인다.
     그래서 시계 오른쪽 끝부터 채움 잉크 끝까지만 남은 시간에 비례시킨다. 두 값은 그림 잉크와 CSS 자리에서 쟀다:
     시계 몸통(ui_timer1.png 132px 중 x 0..97, 바가 지나는 행에서도 97 이 끝) 끝 27.86% + 6.88% × 98/132 = 32.97%
       →  채움 그림 안에서 (32.97 − 29.43) / 39.06 = 0.0906
     ⚠ 그림 오른쪽의 반짝이 점(x 98..129)은 몸통과 떨어진 덩어리다. 그것까지 재면 0.1346 이 되어
       0초에도 초록 토막 33px 이 남고 끝으로 갈수록 남은 시간을 부풀린다(적대적 검토가 찾음).
     채움 잉크 끝은 그림 750px 중 726px = 0.968. CSS 의 .timer-fill · .timer-clock 자리를 바꾸면 다시 잰다. */
  const TIMER_FILL_VISIBLE_START = 0.0906;
  const TIMER_FILL_INK_END = 0.968;

  function renderTimer(remainingMilliseconds) {
    const ratio = Math.max(0, Math.min(1, remainingMilliseconds / totalDurationMs));
    const shown = TIMER_FILL_VISIBLE_START + ratio * (TIMER_FILL_INK_END - TIMER_FILL_VISIBLE_START);
    const remainingSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1000));
    elements.time.textContent = formatTime(remainingMilliseconds);
    elements.time.setAttribute("aria-label", `남은 시간 ${remainingSeconds}초`);
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
      state.streak = 0;
      renderCombo();
      // 시간이 지나 넘어간 문제도 못 맞힌 문제다. 앞서 맞힌 단어라도 남긴다(2차 수정 4번).
      if (shouldRecordTimeout(state.currentQuestion)) recordIncorrectAnswer(state.currentQuestion);
      elements.status.textContent = "시간이 지나 다음 문제로 이동합니다.";
    }

    state.orderPosition += 1;
    if (state.orderPosition >= state.questionOrder.length) {
      // 지금 떠 있는 문제가 앞 바퀴의 마지막 단어다 — 새 바퀴 첫 단어로 바로 다시 내지 않는다.
      state.questionOrder = shuffleQuestionOrder(getIncorrectAnswerKey(state.currentQuestion));
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
    /* 전체 시간이 다 되어 끝날 때, 화면에 떠 있던 문제도 못 맞힌 채 끝난 것이다.
       오답노트에 남기면 Incorrect 와 등급 계산에도 같이 들어간다(recordIncorrectAnswer). */
    if (!state.ended && !state.locked && state.currentQuestion) {
      if (shouldRecordTimeout(state.currentQuestion)) recordIncorrectAnswer(state.currentQuestion);
    }
    state.ended = true;
    state.locked = true;
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    stopQuestionAudio();
    clearFeedback();
    resetComboBurst();
    updateScore();
    clearScoreDeltas();
    elements.stage.classList.remove("clock-running", "timer-urgent", "timer-critical");
    elements.stage.classList.add("timer-ended");
    setButtonsDisabled(true);
    renderTimer(0);
    closeResultDialog({ restoreFocus: false });
    closeIncorrectAnswerDialog({ restoreFocus: false });
    renderResultBreakdown();
    elements.resultMessage.textContent = "결과를 준비하고 있습니다.";
    setScreen("result");
    // 2차 수정 5번: 파티클은 Good·Excellent 에서만 터진다. Try Again 에서는 앞 판 것까지 치운다.
    if (getResultTier() === "tryAgain") clearResultParticles();
    else emitResultConfetti();
    void persistResult();
    emitNavigation("ending");
    elements.status.textContent = `게임이 종료되었습니다. 최종 점수는 ${formatScore(state.score)}점입니다.`;
    elements.tryAgainButton.focus({ preventScroll: true });
  }

  function answerQuestion(answer) {
    if (state.locked || state.ended || !state.currentQuestion) return;

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
    const choseMatch = answer === "o";
    const isCorrect = choseMatch === state.currentQuestion.isMatch;
    const scoreBefore = state.score;
    let comboAwarded = false;

    if (isCorrect) {
      playSound("correct");
      state.streak += 1;
      state.correctCount += 1;
      state.correctPoints += scoring.correct;
      state.score += scoring.correct;
      if (state.streak === scoring.comboEvery) {
        state.bonusPoints += scoring.comboBonus;
        state.score += scoring.comboBonus;
        comboAwarded = true;
      }
      elements.stage.classList.add("feedback-correct");
      playCharacterFeedback("correct");
      elements.status.textContent = comboAwarded
        ? `정답입니다. ${scoring.comboEvery}연속 보너스 ${formatScore(scoring.comboBonus)}점을 획득했습니다.`
        : "정답입니다.";
    } else {
      playSound("incorrect");
      state.incorrectPoints += scoring.incorrect;
      state.score += scoring.incorrect;
      state.streak = 0;
      recordIncorrectAnswer(state.currentQuestion);
      elements.stage.classList.add("feedback-wrong");
      playCharacterFeedback("incorrect");
      elements.status.textContent = "오답입니다.";
    }

    // 보너스가 붙은 판만 굴려 올리고, 그 밖에는 즉시 반영한다.
    if (comboAwarded) {
      animateScore(state.score);
    } else {
      updateScore();
    }
    // 형제 waterpipe 호출 패턴: 점수가 바뀌면 카드를 튕기고 증감분을 띄운다.
    // 다만 보너스분은 Bonus 슬롯 표기(#bonus-gain)가 이미 맡고 있으므로 여기서 또 띄우지 않는다.
    // 형제 세 방은 Bonus 미터가 없어 Score 카드로 보너스까지 알린다.
    // 보너스가 붙으면 Score 상자에서 금빛으로 터뜨리고(playScoreBonus), 그 밖에는 카드를 튕긴다.
    if (comboAwarded) playScoreBonus();
    else bumpScoreCard();
    floatScoreDelta(comboAwarded ? scoring.correct : state.score - scoreBefore);
    renderCombo(state.streak, { burst: comboAwarded, step: isCorrect && !comboAwarded });

    state.feedbackTimerId = window.setTimeout(() => {
      clearFeedback();
      if (comboAwarded) {
        state.streak = 0;
        renderCombo();
      }
      if (!state.ended) {
        advanceQuestion(performance.now(), false);
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
      const questionRemaining = questionDurationMs - (now - state.questionStartedAt);
      if (questionRemaining <= 0) {
        advanceQuestion(now, true);
      }
    }
    state.animationFrameId = requestAnimationFrame(update);
  }

  function resetPressedState(button) {
    const image = button.querySelector("img");
    button.classList.remove("is-pressed");
    image.src = button.dataset.normal;
  }

  function setPressedState(button) {
    if (button.disabled) return;
    const image = button.querySelector("img");
    button.classList.add("is-pressed");
    image.src = button.dataset.push;
  }

  function showStartScreen({ restoreFocus = true } = {}) {
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
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
    // 동화 정보 글자 맞춤은 시작 화면이 보인 뒤에 잰다. 글꼴이 늦게 오면 폭이 달라지므로 받은 뒤에 한 번 더 잰다.
    requestAnimationFrame(fitStartStory);
    document.fonts?.load?.('600 1em "Lexend Game"')?.then(fitStartStory, () => {});
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

  function startGame() {
    if (questions.length === 0) {
      showToast("게임 데이터를 준비하고 있습니다.");
      return;
    }
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
    state.currentQuestion = null;
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
    updateScore();
    clearScoreDeltas();
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

  /* 한글 글꼴(나눔스퀘어라운드 ExtraBold, 433KB)은 로딩 화면 동안 단어와 함께 받는다(사장님 결정 2026-10-02 "로딩 화면에서
     미리 받기"). 받기 전에 그리면 대체 글꼴로 재고 그린 값이 첫 화면에 남는다. 3초 안에 안 오면 기다리지 않고 연다 —
     늦게 오면 refitAfterFontsLoad 가 문제 칸을 다시 맞춘다. 실패해도 게임은 연다(기기 글꼴이 뒤 대체로 남아 있다). */
  const HANGUL_FONT = '700 1em "NanumSquareRound Game"';
  const HANGUL_FONT_TIMEOUT_MS = 3_000;

  function loadHangulFont() {
    const fonts = document.fonts;
    if (!fonts || typeof fonts.load !== "function") return Promise.resolve(false);
    // 오답 목록 뜻 글자용 Bold(OTFB)도 미리 받아 둔다 — 시작을 기다리게 하지는 않는다(처음 열 때 ExtraBold 로 잠깐 그려지지 않게).
    Promise.resolve().then(() => fonts.load('1em "NanumSquareRound Note"', "가")).catch(() => {});
    return Promise.race([
      Promise.resolve()
        .then(() => fonts.load(HANGUL_FONT, "가"))
        .then((faces) => Array.isArray(faces) && faces.length > 0, () => false),
      new Promise((resolve) => {
        window.setTimeout(() => resolve(false), HANGUL_FONT_TIMEOUT_MS);
      }),
    ]);
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
      const [loaded] = await Promise.all([loader.bootstrap({ force }), loadHangulFont()]);
      if (token !== contentRequestToken) return;
      if (!Array.isArray(loaded?.content?.questions) || loaded.content.questions.length < 2) {
        throw new Error("게임에 사용할 문제가 충분하지 않습니다.");
      }

      questions = loaded.content.questions.map((question) => ({ ...question }));
      launchContext = loaded.launch || null;
      totalDurationMs = resolveDurationMs(loaded.content.info, launchContext);
      renderStartStory(loaded.content.info);
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
    button.addEventListener("click", () => answerQuestion(button.dataset.answer));
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
    const key = event.key.toLowerCase();
    if (key === "o" || key === "x") {
      answerQuestion(key);
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
    } else {
      resumeBgm();
    }
    updateSoundUI();
    if (soundEnabled) playSound("touch");
    // 2차 수정 9번: 켜고 끌 때 안내 팝업을 띄우지 않는다. 버튼 그림이 바뀌는 것으로 알린다.
  });
  elements.navigationButton.addEventListener("click", () => {
    pressControl(elements.navigationButton);
    if (currentScreen === "help") {
      closeHelp();
    } else if (currentScreen === "play") {
      showStartScreen();
    } else if (currentScreen === "start") {
      closeGame();
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

  /* 검수 공통 9-2: 결과화면 위쪽 버튼은 "다시 하기" 가 아니라 "시작 화면으로" 다.
     나가면 그 판은 끝나므로, 점수 저장이 끝난 뒤에 움직인다. 저장이 실패해도 붙잡아 두지는 않는다. */
  async function leaveToStart(button) {
    if (leavingToStart) return;
    leavingToStart = true;
    pressControl(button);
    try {
      await persistResult();
    } catch {
      // 저장 실패는 이미 결과 문구로 알린다. 나가는 것은 막지 않는다.
    }
    resetRoundState();
    showStartScreen();
    leavingToStart = false;
  }

  /* 한 판에 쌓인 것을 모두 되돌린다. 문항 순서와 오답 목록까지 되돌려야 다음 판의 분모가 어긋나지 않는다. */
  function resetRoundState() {
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    state.animationFrameId = 0;
    state.feedbackTimerId = 0;
    state.score = 0;
    state.streak = 0;
    state.correctPoints = 0;
    state.incorrectPoints = 0;
    state.bonusPoints = 0;
    state.correctCount = 0;
    state.incorrectCount = 0;
    state.historyRequested = false;
    state.questionOrder = shuffleQuestionOrder(lastShownWordKey);
    state.orderPosition = 0;
    state.currentQuestion = null;
    incorrectAnswerRecords.clear();
    incorrectAnswerSequence = 0;
    updateIncorrectAnswersButton();
    resetComboBurst();
    clearResultParticles();
    clearScoreDeltas();
    updateScore();
    renderCombo();
    elements.resultMessage.textContent = "";
  }

  elements.resultReplayButton.addEventListener("click", () => leaveToStart(elements.resultReplayButton));
  elements.tryAgainButton.addEventListener("click", () => replayGame(elements.tryAgainButton));
  elements.incorrectAnswersButton.addEventListener("click", openIncorrectAnswerDialog);
  elements.incorrectAnswerClose.addEventListener("click", () => closeIncorrectAnswerDialog());
  elements.incorrectAnswerBackdrop.addEventListener("click", () => closeIncorrectAnswerDialog());
  elements.rankingButton.addEventListener("click", () => void showRanking());
  elements.resultDialogClose.addEventListener("click", () => closeResultDialog());
  elements.resultDialogBackdrop.addEventListener("click", () => closeResultDialog());
  elements.retryButton.addEventListener("click", () => void initializeContent({ force: true }));
  /* 배경음은 시작 화면이 뜰 때 바로 틀어 본다(사장님 2026-10-08 "시작 화면에 BGM 재생이 안되는데 BGM 재생되게").
     브라우저가 자동 재생을 막으면 resumeBgm 이 첫 조작 대기(armBgmOnGesture)로 넘겨, 처음 화면을 만질 때 시작한다. */
  preloadResultFoxes();
  armBgm();

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
      // pagehide 가 배경음을 멈췄으므로 다음 조작 때 다시 이어 간다.
      if (bgmWanted) armBgmOnGesture();
    }
  });

  updateSoundUI();
  setStartReady(false);
  watchStageResize();
  void initializeContent();
})();
