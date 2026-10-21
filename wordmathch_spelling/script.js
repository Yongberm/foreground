(function spellingBuilderXylophone() {
  "use strict";

  // 2차 수정(사장님 2026-10-02 "한 판 시간 API 우선, 없으면 지금 값(실로폰 180초)"):
  // 한 판 시간은 API info 의 play_time 을 먼저 쓴다. 주지 않거나 info 요청이 실패하면
  // 지금 값 3분이다. 상한 · 하한은 두지 않는다 — 잘못된 값은 API 쪽에서 고친다.
  const DEFAULT_TOTAL_DURATION_MS = 180_000;
  const FEEDBACK_DURATION_MS = Object.freeze({
    letter: 260,
    complete: 1_250,
    exhausted: 2_100,
  });
  // 철자 타일 한 줄이 쓸 수 있는 가로 폭(cqw)과 시안 타일 크기.
  const LETTER_ROW_MAX_CQW = 62;
  const LETTER_TILE_CQW = 6.1458;
  // 뜻 글자 크기 범위(cqw). 상자를 넘치면 이 사이에서 줄인다.
  const MEANING_FONT_MAX_CQW = 2.4;
  const MEANING_FONT_MIN_CQW = 1.1;
  const CHARACTER_IMAGE = "assets/game/char.png?v=20261021-1";
  const SOUND_ASSETS = Object.freeze({
    touch: "assets/sound/touch.mp3",
    correct: "assets/sound/success.mp3",
    incorrect: "assets/sound/fail.mp3",
  });
  // 건반 클릭음: 왼쪽부터 xylo2~xylo7을 순서대로 쓴다.
  const KEY_SOUNDS = Object.freeze([
    "assets/sound/xylo2.mp3",
    "assets/sound/xylo3.mp3",
    "assets/sound/xylo4.mp3",
    "assets/sound/xylo5.mp3",
    "assets/sound/xylo6.mp3",
    "assets/sound/xylo7.mp3",
  ]);

  // 등급별 여우(사장님 지시 2026-09-30): 제목 그림과 같은 자리에서 함께 갈린다.
  // 그림 이름이 곧 등급이라 파일명을 그대로 쓴다.
  const RESULT_TITLE_ASSETS = Object.freeze({
    excellent: { src: "assets/result/result_text0.png?v=20261021-1", alt: "Excellent", fox: "assets/result/excellent.png?v=20261021-1" },
    good: { src: "assets/result/result_text1.png?v=20261021-1", alt: "Good", fox: "assets/result/good.png?v=20261021-1" },
    // 검수 r10: 제목 그림을 대문자 A 교체본(2026-09-15)으로 바꾸면서 alt 도 맞춘다.
    tryAgain: { src: "assets/result/result_text2.png?v=20261021-1", alt: "Try Again", fox: "assets/result/try_again.png?v=20261021-1" },
  });
  // 검수 4차 리워드 기준(사장님 지시): 100% 면 Excellent, 70% 이상이면 Good,
  // 그 미만이면 Try again. 정확히 70% 는 Good 이다 — 단정적으로 쓰인 규칙이
  // "Try again 은 70% 미만" 하나뿐이기 때문이다. 경계는 여기 한 곳에서만 고친다.
  const RESULT_TIER = Object.freeze({ excellent: 1, good: 0.7 });
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
    correct: Number(gameConfig.scoring?.correct) || 50,
    incorrect: Number(gameConfig.scoring?.incorrect) || -10,
    comboEvery: Math.max(1, Math.trunc(Number(gameConfig.scoring?.comboEvery) || 3)),
    comboBonus: Number(gameConfig.scoring?.comboBonus) || 100,
    chances: Math.max(1, Math.trunc(Number(gameConfig.scoring?.chances) || 3)),
  });
  const configuredTotalDurationMs = Math.max(
    5_000,
    Number(gameConfig.timing?.totalDurationMs) || DEFAULT_TOTAL_DURATION_MS,
  );

  let totalDurationMs = configuredTotalDurationMs;
  let apiPlayTimeMs = 0;
  let questions = [];
  let launchContext = null;
  // 2차 수정(공통 1절 '다시 시작'): 앞 판에서 마지막으로 보인 단어. 새로 고침하면 잊는다.
  let previousRoundLastWord = "";

  const elements = {
    stage: document.querySelector("#game-stage"),
    startScreen: document.querySelector("#start-screen"),
    startEffects: document.querySelector("#start-effects"),
    startLogo: document.querySelector(".start-logo"),
    xylophone: document.querySelector(".xylophone"),
    scoreGauge: document.querySelector(".score-gauge"),
    playScreen: document.querySelector("#play-screen"),
    helpScreen: document.querySelector("#help-screen"),
    startButton: document.querySelector("#start-button"),
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
    startStory: document.querySelector("#start-story"),
    startStoryTitle: document.querySelector("#start-story-title"),
    startStorySubtitle: document.querySelector("#start-story-subtitle"),
    meaning: document.querySelector("#word-meaning"),
    meaningText: document.querySelector("#word-meaning-text"),
    letterRow: document.querySelector("#letter-row"),
    keys: Array.from(document.querySelectorAll(".key")),
    character: document.querySelector(".character"),
    score: document.querySelector("#score-value"),
    scoreArc: document.querySelector("#score-arc"),
    progress: document.querySelector("#progress-value"),
    time: document.querySelector("#time-value"),
    timerArc: document.querySelector("#timer-arc"),
    status: document.querySelector("#game-status"),
    scorePopups: document.querySelector("#score-popups"),
    scoreBonus: document.querySelector("#score-bonus"),
    answerReveal: document.querySelector("#answer-reveal"),
    wordReveal: document.querySelector("#word-reveal"),
    endScreen: document.querySelector("#end-screen"),
    resultExitButton: document.querySelector("#result-exit-button"),
    resultParticleCanvas: document.querySelector("#result-particle-canvas"),
    resultTitle: document.querySelector("#result-title"),
    resultFox: document.querySelector("#result-fox"),
    resultCorrectPoints: document.querySelector("#result-correct-points"),
    resultIncorrectPoints: document.querySelector("#result-incorrect-points"),
    resultCorrectCount: document.querySelector("#result-correct-count"),
    resultIncorrectCount: document.querySelector("#result-incorrect-count"),
    resultBonusPoints: document.querySelector("#result-bonus-points"),
    resultBonusCount: document.querySelector("#result-bonus-count"),
    resultTotalScore: document.querySelector("#result-total-score"),
    resultScoreNumber: document.querySelector("#result-score-number"),
    resultMessage: document.querySelector("#result-message"),
    incorrectAnswersButton: document.querySelector("#incorrect-answers-button"),
    incorrectAnswerDialog: document.querySelector("#incorrect-answer-dialog"),
    incorrectAnswerBackdrop: document.querySelector("#incorrect-answer-backdrop"),
    incorrectAnswerClose: document.querySelector("#incorrect-answer-close-button"),
    incorrectAnswerList: document.querySelector("#incorrect-answer-list"),
    tryAgainButton: document.querySelector("#try-again-button"),
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
    targetPosition: 0,
    chances: scoring.chances,
    wrongInWord: 0,
    gameStartedAt: 0,
    animationFrameId: 0,
    feedbackTimerId: 0,
    locked: false,
    ended: false,
    correctPoints: 0,
    incorrectPoints: 0,
    bonusPoints: 0,
    correctCount: 0,
    incorrectCount: 0,
    exhaustedCount: 0,
    historyRequested: false,
    resultRequestToken: 0,
    tileElements: [],
    // 2차 수정(공통 4절 '다시 시작' 함정): 판 번호. startGame 이 올리고, 판 안에서 걸어 둔 예약은
    // 예약한 판 번호일 때만 실행한다. ended 같은 표시는 새 판에서 다시 거짓이 되어 앞 판 예약을 못 거른다.
    round: 0,
  };
  const incorrectAnswerRecords = new Map();
  let resultParticleFrame = 0;
  let resultParticles = [];
  let contentRequestToken = 0;
  let incorrectDialogReturnFocus = null;
  let incorrectAnswerSequence = 0;
  let activeIncorrectAudio = null;
  let activeQuestionAudio = null;
  let helpRequestToken = 0;
  let helpReturnFocus = null;
  let currentScreen = "loading";
  let soundEnabled = true;
  let resultPersistPromise = null;
  // 검수 q54: 게임 화면 BGM. 글로켄슈필 음원(사장님 지정)을 낮은 소리로 반복 재생한다.
  // 자동재생 정책 때문에 Start 버튼 같은 사용자 동작에서만 시작된다.
  const BGM_SOURCE = "assets/sound/bgm/glockenspiel_acoustic_kids_bgm_loop.mp3";
  const BGM_VOLUME = 0.32;
  let bgmAudio = null;
  let toastTimer = 0;
  // 검수 r11: 점수판 트윈 상태. scoreShown 은 지금 화면에 그려진 숫자다.
  let scoreShown = 0;
  let scoreTween = 0;
  let scoreTweenFallbackId = 0;
  const activeEffectAudios = new Set();

  // 검수 10항 보강: 점수 상수가 gameConfig 에서 오므로 소수가 섞일 수 있다.
  // 자르면 참값보다 1 낮게 찍히므로 반올림한다. -0 은 "-0" 으로 표기되니 눕힌다.
  function formatScore(value) {
    const rounded = Math.round(Number(value) || 0);
    return (rounded === 0 ? 0 : rounded).toLocaleString("en-US");
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  // 한 번만 재생하고 스스로 정리되는 클래스 애니메이션.
  function playOnce(element, className, fallbackMs) {
    if (!element) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    const clear = () => element.classList.remove(className);
    element.addEventListener("animationend", clear, { once: true });
    window.setTimeout(clear, fallbackMs);
  }

  // 누른 건반에서 그 건반 색 음표가 떠오른다. 건반 안에 붙이고 위치는 CSS가
  // 잡으므로 레이아웃 측정이 필요 없다(측정에 의존하면 화면이 아직 배치되지
  // 않은 순간에 연출이 통째로 빠진다).
  function floatKeyNote(keyElement) {
    if (prefersReducedMotion()) return;
    const source = keyElement.querySelector(".key-note");
    if (!source) return;

    const note = document.createElement("img");
    note.className = "key-note-pop";
    note.src = source.getAttribute("src");
    note.alt = "";
    note.draggable = false;
    keyElement.classList.add("has-note-pop");
    keyElement.append(note);

    const cleanup = () => {
      note.remove();
      if (!keyElement.querySelector(".key-note-pop")) {
        keyElement.classList.remove("has-note-pop");
      }
    };
    note.addEventListener("animationend", cleanup, { once: true });
    window.setTimeout(cleanup, 1_400);
  }

  // 떠다니는 음표 자리(cqw). 가운데는 로고(9~87 x 4.4~35.3)와 버튼(41~59 x
  // 38.2~51), 왼쪽 아래는 배경 실로폰이 차지하므로 화면 가장자리에만 둔다.
  const START_FLOAT_NOTES = Object.freeze([
    { note: 0, left: 3.4, top: 20.5, size: 3.4, opacity: 0.88, duration: 9.4, delay: 0, drift: 1.1 },
    { note: 2, left: 8.2, top: 34.5, size: 2.8, opacity: 0.78, duration: 11.2, delay: 1.6, drift: -0.9 },
    { note: 3, left: 24.5, top: 39.5, size: 2.5, opacity: 0.7, duration: 10.4, delay: 3.1, drift: 1.3 },
    { note: 4, left: 90.5, top: 13.5, size: 3.2, opacity: 0.85, duration: 10.8, delay: 0.8, drift: -1.2 },
    { note: 5, left: 94.2, top: 31, size: 2.7, opacity: 0.75, duration: 12.1, delay: 2.4, drift: 1 },
    { note: 1, left: 87.5, top: 45.5, size: 3, opacity: 0.8, duration: 9.9, delay: 4.2, drift: -1.1 },
  ]);

  // 시작 화면 가장자리에 실로폰 색 음표를 띄운다.
  function buildStartEffects() {
    if (!elements.startEffects || elements.startEffects.childElementCount > 0) return;
    if (prefersReducedMotion()) return;

    const fragment = document.createDocumentFragment();
    START_FLOAT_NOTES.forEach((item) => {
      const note = document.createElement("img");
      note.className = "float-note";
      note.src = `assets/game/keyboard${item.note}_note.png?v=20261021-1`;
      note.alt = "";
      note.draggable = false;
      note.style.left = `${item.left}cqw`;
      note.style.top = `${item.top}cqw`;
      note.style.setProperty("--note-size", `${item.size}cqw`);
      note.style.setProperty("--note-opacity", String(item.opacity));
      note.style.setProperty("--note-duration", `${item.duration}s`);
      note.style.setProperty("--note-delay", `${item.delay}s`);
      note.style.setProperty("--note-drift", `${item.drift}cqw`);
      fragment.append(note);
    });
    elements.startEffects.append(fragment);
  }

  function emitNavigation(screen, detail = {}) {
    // 막을 수 있게 내보낸다. 모음 페이지가 preventDefault() 로 가로채면
    // 이 방은 아무 데도 가지 않고 그쪽 처리에 맡긴다.
    const event = new CustomEvent("spellingbuilder:navigate", {
      cancelable: true,
      detail: { screen, ...detail },
    });
    window.dispatchEvent(event);
    return !event.defaultPrevented;
  }

  /* [앱 전용 자리] 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — LF 가 앱(Android · iOS)에 올릴 때 직접 작업한다.
     지금은 비어 있다. 화면에 알림은 띄우지 않는다(2차 검수 공통-12 — 12개 게임 모두 같은 이름의 빈 함수, 같은 순서로 부른다). */
  function closeAppWebView() {}

  // 2차 검수 공통-12(사장님 2026-10-15 "OX 방과 똑같이"): 게임을 닫는 X(시작 화면)는 알림 → closeAppWebView() → 창 닫기 →
  // 창이 안 닫히면 이전 페이지 순서다. window.close() 는 스크립트가 연 창만 닫고, 직접 연 탭 · 링크로 들어온 탭 · 앱 웹뷰에서는
  // 무시되어 window.closed 가 거짓으로 남는다. 옛 close_url · 설정 주소 · 같은 출처 referrer 갈래(2026-09-30)는 걷었다.
  // 모음 페이지가 알림을 preventDefault() 로 가로채면 그쪽 처리에 맡기고 여기서는 아무것도 하지 않는다.
  function closeGame() {
    if (!emitNavigation("close")) return "handled";
    closeAppWebView();
    window.close();
    if (window.closed) return "closed";
    window.history.back();
    return "back";
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

  // 검수 q54: BGM 은 효과음과 따로 둔다. stopEffectAudios 가 꺼 버리면 안 된다.
  function startBgm() {
    if (!soundEnabled) return;
    if (!bgmAudio) {
      bgmAudio = new Audio(BGM_SOURCE);
      bgmAudio.loop = true;
      bgmAudio.volume = BGM_VOLUME;
    }
    bgmAudio.play()?.catch(() => {});
  }

  function stopBgm({ rewind = true } = {}) {
    if (!bgmAudio) return;
    bgmAudio.pause();
    if (!rewind) return;
    try {
      bgmAudio.currentTime = 0;
    } catch (error) {
      // 되감기에 실패해도 재생만 멈추면 된다.
    }
  }

  function playSound(name) {
    return playAudioSource(SOUND_ASSETS[name]);
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

  // 사양: 단어가 완성되거나 기회를 모두 쓰면 단어 사운드를 들려준다. 회원 여부와 무관하다.
  // 2차 검수 SB3-2: 문제 영역의 다시 듣기(스피커) 버튼을 없앴다 — 발음은 이 저절로 나는 재생 하나이고,
  // 소리를 끄면 나지 않는다(오답노트의 발음 버튼은 그대로다).
  function playWordAudio() {
    const soundUrl = String(state.currentQuestion?.soundUrl || "").trim();
    if (!soundUrl || !soundEnabled) return;

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
      ? "assets/btn_sound_on.png?v=20261021-1"
      : "assets/btn_sound_off.png?v=20261021-1";
    elements.soundButton.setAttribute("aria-pressed", String(soundEnabled));
    elements.soundButton.setAttribute("aria-label", soundEnabled ? "소리 끄기" : "소리 켜기");
  }

  /* 2차 검수 공통-9: 시작 화면의 동화 정보 — API info 의 title · subtitle 을 로고와 Start 사이에 두 줄로 보여 준다
     (사장님 2026-10-12 "동화API … 적용 배치는 시작화면 로고와 버튼 사이"). 한 줄만 오면 그 줄만, 둘 다 없으면
     (테스트 모드 · 데모 · info 실패) 자리를 숨긴다 — 값을 지어 넣지 않는다. 레벨과 번호는 넣지 않는다. */
  function renderStartStory(info) {
    const title = String(info?.title ?? "").trim();
    const subtitle = String(info?.subtitle ?? "").trim();
    elements.startStoryTitle.textContent = title;
    elements.startStorySubtitle.textContent = subtitle;
    elements.startStoryTitle.hidden = !title;
    elements.startStorySubtitle.hidden = !subtitle;
    elements.startStory.hidden = !title && !subtitle;
  }

  /* 긴 제목은 말줄임으로 자르지 않고 두 줄을 같은 배율로 줄인다(사장님 OX 방 "글자가 길어지면 폰트 크기를 줄이게").
     배율은 CSS 기준 크기(2.083333cqw, 1920 기준 40px)에 곱하고 바닥은 0.5배다 — 그래도 넘치면 그때만 CSS 말줄임이 남는다.
     화면에 보일 때만 잴 수 있어 시작 화면을 연 뒤(showStartScreen)와 글꼴을 받은 뒤에 부른다. */
  function fitStartStory() {
    const story = elements.startStory;
    if (story.hidden || currentScreen !== "start") return;
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
    elements.endScreen.classList.toggle("is-visible", resultVisible);
    elements.endScreen.setAttribute("aria-hidden", String(!resultVisible));
    elements.stage.classList.toggle("result-mode", resultVisible);

    // 검수 r38(1차 r35 번복): 결과 화면에는 X·BG 버튼을 띄우지 않는다. 1차에서 결과
    // 화면에도 X 를 넣었으나 3차에서 삭제로 바뀌었다. 다른 방과 같이 시작·도움말·게임
    // 화면에서만 보인다.
    const controlsVisible = screen === "start" || screen === "help" || screen === "play";
    // 2차 수정 PDF 2·3번(공통 1절, OX 와 같이): 도움말 화면에서만 스피커를 숨기고 X 대신
    // ← 를 왼쪽 위 스피커 자리에 둔다. 자리는 CSS 의 .screen-help 가 잡는다.
    // 시작·게임 화면은 그대로다.
    const helpVisible = screen === "help";
    elements.soundButton.hidden = !controlsVisible || helpVisible;
    elements.navigationButton.hidden = !controlsVisible;

    // 검수 r33/r12: 앞으로 가기 아이콘은 쓰지 않는다. 시작·게임 화면은 X, 도움말 화면은 ← 다.
    elements.navigationIcon.src = helpVisible
      ? "assets/btn_back.png?v=20261021-1"
      : "assets/btn_close.png?v=20261021-1";
    elements.navigationButton.setAttribute(
      "aria-label",
      screen === "start"
        ? "게임 닫기"
        : helpVisible ? "뒤로 가기" : "게임 나가기",
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
    const loader = window.SpellingBuilderContent;
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
    setStartReady(questions.length >= 1);
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
    // 2차 수정 PDF 3쪽(공통 1절): 오답노트 발음은 사람이 직접 누른 소리라 소리를 꺼도 재생한다.
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

  function getIncorrectAnswerKey(question) {
    return String(question?.english || "").trim().toLocaleLowerCase("en-US");
  }

  function updateIncorrectAnswersButton() {
    const records = [...incorrectAnswerRecords.values()];
    // 검수 9-1: 쓰지 않는 버튼은 회색으로 두지 않고 자리까지 없앤다.
    // 결과 버튼 줄은 가운데 정렬이라 남은 버튼 하나가 저절로 가운데로 온다.
    const hasRecords = records.length > 0;
    elements.incorrectAnswersButton.hidden = !hasRecords;
    elements.incorrectAnswersButton.disabled = !hasRecords;
    elements.incorrectAnswersButton.setAttribute(
      "aria-label",
      records.length > 0
        ? `오답 보기, ${records.length}개 단어`
        : "오답 없음",
    );
  }

  // 2차 검수 SB공통-1(검수표 "3회 모두 틀려야 오답노트에 노출", 사장님 2026-10-12 "그 3번 틀린것을 오답에 기록"):
  // 오답노트에는 기회 3번을 모두 틀린 문제만 싣는다. finishWord 가 기회를 다 썼을 때 한 번 부른다.
  // 한두 번 틀리고 맞힌 문제, 시간이 끝나 못 끝낸 문제, 나오지 않은 문제는 싣지 않는다(사장님 2026-10-15 "넣지 않음") —
  // 옛 검수 q58(타임아웃에도 나온 단어를 싣는다)은 이 결정으로 걷었다. 같은 단어는 한 줄이다.
  function recordIncorrectAnswer(question) {
    const key = getIncorrectAnswerKey(question);
    if (!key || incorrectAnswerRecords.has(key)) return;
    incorrectAnswerRecords.set(key, {
      english: String(question?.english || "").trim(),
      correctMeaning: String(question?.meaning || "").trim(),
      soundUrl: String(question?.soundUrl || "").trim(),
      sequence: incorrectAnswerSequence,
    });
    incorrectAnswerSequence += 1;
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
    // 고정 숫자(옛 38/24)는 CSS 글자 크기가 바뀔 때마다 어긋난다. 지금 렌더된 크기를
    // 읽어 배율을 잡고, 그 크기의 3분의 2까지만 줄인다.
    cell.style.setProperty("--incorrect-word-scale", "1");
    const maximumSize = Number.parseFloat(getComputedStyle(element).fontSize) || 0;
    if (maximumSize <= 0) return;
    const minimumSize = maximumSize * (2 / 3);
    for (let size = maximumSize; size > minimumSize && element.scrollWidth > element.clientWidth; size -= 1) {
      cell.style.setProperty("--incorrect-word-scale", String((size - 1) / maximumSize));
    }
  }

  function renderIncorrectAnswerList() {
    elements.incorrectAnswerList.replaceChildren();
    // 나온 차례대로 싣는다 — 줄마다 3번 모두 틀린 문제라 틀린 횟수로 가를 것이 없다.
    const records = [...incorrectAnswerRecords.values()].sort(
      (left, right) => left.sequence - right.sequence,
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
      speakerIcon.src = "assets/incorrect-answer/icon_speaker.png?v=20261021-1";
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
    requestAnimationFrame(() => {
      elements.incorrectAnswerList
        .querySelectorAll(".incorrect-answer-word-text")
        .forEach(fitIncorrectWordText);
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
    if (incorrectAnswerRecords.size === 0) return;
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

  function getResultTitleAsset() {
    // 분모는 이 판이 낸 전체 문제 수다. 타임아웃으로 손도 못 댄 문제까지 들어간다.
    const total = state.questionOrder.length || questions.length;
    const correctRatio = total > 0 ? state.correctCount / total : 0;
    if (correctRatio >= RESULT_TIER.excellent) return RESULT_TITLE_ASSETS.excellent;
    if (correctRatio >= RESULT_TIER.good) return RESULT_TITLE_ASSETS.good;
    return RESULT_TITLE_ASSETS.tryAgain;
  }

  // 검수 q51: 완료화면 My Score 에는 순위를 내보내지 않는다. 점수만 보여 준다.
  // history 응답의 rank 는 그대로 받지만 화면에는 쓰지 않는다.
  function renderResultScore(score) {
    const scoreText = formatScore(score);
    elements.resultScoreNumber.textContent = scoreText;
    elements.resultTotalScore.setAttribute("aria-label", `${scoreText}점`);
  }

  // 검수 6항: Correct 는 완성한 문제 수다. 오타를 내고도 완성한 문제는 맞힌 쪽으로 센다.
  // 2차 검수 공통-10(사장님 2026-10-12 "결과 다르게 나오는거 공통으로 묶어서"): Incorrect 는 오답노트에 실린 줄 수와 같다 —
  // 3번 모두 틀린 문제만(SB공통-1). 시간이 끝나 못 끝낸 문제와 나오지 않은 문제는 어느 쪽에도 세지 않아(사장님 2026-10-15
  // "넣지 않음") Correct + Incorrect 가 문제 수보다 작을 수 있다. 옛 '두 수의 합 = 전체 문제 수'(검수 6항)는 이 결정으로 걷었다.
  // 등급은 지금처럼 Correct 비율로 정한다(getResultTitleAsset). 점수(오답마다 -10)는 그대로다.
  function getResultCounts() {
    const presentedCount = state.questionOrder.length || questions.length;
    const correctCount = Math.min(Math.max(0, state.correctCount), presentedCount);
    return {
      presentedCount,
      correctCount,
      incorrectCount: incorrectAnswerRecords.size,
    };
  }

  // 등급별 여우는 세 장을 미리 받아 둔다. 받아 두지 않으면 등급이 바뀐 판에서
  // 새 그림이 풀릴 때까지 img 에 남은 지난 판 여우가 계속 그려진다.
  const foxPreload = new Map();
  function preloadResultFoxes() {
    Object.values(RESULT_TITLE_ASSETS).forEach(({ fox }) => {
      if (!fox || foxPreload.has(fox)) return;
      const image = new Image();
      image.src = fox;
      foxPreload.set(fox, image);
    });
  }

  // 미리받기가 아직 안 끝난 경우까지 막는다. 다 받아지기 전에는 감춰 두고
  // 받아진 뒤에 보여 준다 — 잘못된 그림을 한 프레임도 보여 주지 않는다.
  function setResultFox(source) {
    const fox = elements.resultFox;
    if (!fox || !source) return;
    const ready = foxPreload.get(source);
    if (ready && ready.complete && ready.naturalWidth > 0) {
      fox.src = source;
      fox.hidden = false;
      return;
    }
    fox.hidden = true;
    fox.onload = () => {
      if (fox.getAttribute("src") === source) fox.hidden = false;
    };
    fox.src = source;
  }

  function renderResultBreakdown() {
    const titleAsset = getResultTitleAsset();
    elements.resultTitle.src = titleAsset.src;
    elements.resultTitle.alt = titleAsset.alt;
    setResultFox(titleAsset.fox);
    // 검수 6항: Correct·Incorrect 는 점수 합이 아니라 문항 개수다.
    const counts = getResultCounts();
    elements.resultCorrectCount.textContent = formatScore(counts.correctCount);
    elements.resultIncorrectCount.textContent = formatScore(counts.incorrectCount);
    // 2차 검수 공통-2: Bonus 는 '+' 없이 숫자만 쓴다. 뒤의 '점' 은 CSS(.result-points::after)가 붙인다.
    elements.resultBonusCount.textContent = formatScore(state.bonusPoints);
    elements.resultCorrectPoints.setAttribute(
      "aria-label",
      `정답 ${formatScore(counts.correctCount)}개`,
    );
    elements.resultIncorrectPoints.setAttribute(
      "aria-label",
      `오답 ${formatScore(counts.incorrectCount)}개`,
    );
    elements.resultBonusPoints.setAttribute(
      "aria-label",
      `보너스 점수 ${formatScore(state.bonusPoints)}점`,
    );
    renderResultScore(state.score);
    // 2차 검수 공통-2(Spelling Builder 하단 문구 "00문제 중 00개를 맞혔어요! -> 이 메시지로 통일"): 블록단어 방과 같은 문구다.
    // 저장 진행 · 결과 문구는 화면에 쓰지 않는다(persistResult).
    elements.resultMessage.textContent = `${formatScore(counts.presentedCount)}문제 중 ${formatScore(counts.correctCount)}개를 맞혔어요!`;
    updateIncorrectAnswersButton();
  }

  async function persistResult() {
    if (state.historyRequested) return;
    state.historyRequested = true;
    const token = ++state.resultRequestToken;
    // 2차 검수 공통-2: 하단 문구는 맞힌 수 안내 하나로 통일했다 — 저장 진행 · 결과 문구는 화면에 쓰지 않는다.
    // 저장에 실패하면 화면 읽기 프로그램에만 알린다(시각 문구 없음).
    try {
      const result = await window.SpellingBuilderContent.saveHistory(state.score);
      if (token !== state.resultRequestToken || !state.ended) return;
      if (result?.skipped) return;
      renderResultScore(result?.score ?? state.score);
    } catch (error) {
      if (token !== state.resultRequestToken || !state.ended) return;
      elements.status.textContent = `점수를 저장하지 못했습니다: ${error?.message || "연결 오류"}`;
    }
  }

  // 2차 수정(공통 1절 '다시 시작'): 판을 떠날 때(끝남 · 게임 중 X) 마지막으로 보인 단어를
  // 적어 둔다. startGame 은 이 값을 읽기만 하므로 Start · Try Again 을 빠르게 두 번 눌러
  // startGame 이 두 번 돌아도 두 번째가 첫 번째 새 판의 단어로 덮어쓰지 않는다.
  function rememberRoundLastWord() {
    if (state.questionOrder.length === 0) return;
    const english = String(state.currentQuestion?.english || "");
    if (english) previousRoundLastWord = english;
  }

  // 새 판의 첫 문제가 앞 판 마지막 단어이면 다른 단어와 자리를 바꾼다. 바꿀 자리는 무작위로
  // 고른다 — 늘 바로 다음 자리와 바꾸면 그 단어가 둘째 문제로 나오는 일이 두 배로 잦아진다.
  // 판에 그 단어밖에 없으면 바꿀 수 없으므로 그대로 연다(판은 늘 열린다).
  function avoidPreviousLastWord(order) {
    if (!previousRoundLastWord || order.length < 2) return order;
    if (questions[order[0]]?.english !== previousRoundLastWord) return order;
    const candidates = order
      .map((index, position) => (position > 0 && questions[index]?.english !== previousRoundLastWord ? position : -1))
      .filter((position) => position > 0);
    if (candidates.length === 0) return order;
    const swapAt = candidates[Math.floor(Math.random() * candidates.length)];
    [order[0], order[swapAt]] = [order[swapAt], order[0]];
    return order;
  }

  function shuffleQuestionOrder() {
    const order = questions.map((_, index) => index);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
    }
    return order;
  }

  function formatTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function maximumReachableScore() {
    const perWord = scoring.correct * window.SpellingBuilderContent.BLANK_COUNT;
    const combos = Math.floor(questions.length / scoring.comboEvery);
    return questions.length * perWord + combos * scoring.comboBonus;
  }

  // pathLength를 1000으로 정규화해 두었으므로 남은 길이만 dashoffset으로 준다.
  // 비율이 0이면 둥근 캡이 점으로 남기 때문에 아예 감춘다.
  function setArc(element, ratio) {
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    const circle = element.querySelector("circle");
    if (!circle) return;
    circle.setAttribute("stroke-dashoffset", String(Math.round(1000 * (1 - clamped))));
    element.dataset.empty = String(clamped <= 0);
  }

  function renderScore(value = state.score) {
    const shown = Math.round(Number(value) || 0);
    elements.score.textContent = formatScore(shown);
    // 검수 10항: 낭독 문구의 점수도 화면과 같은 1,000 형식으로 읽어 준다.
    elements.score.setAttribute("aria-label", `점수 ${formatScore(shown)}`);
    const maximum = maximumReachableScore();
    setArc(elements.scoreArc, maximum > 0 ? shown / maximum : 0);
  }

  // 트윈을 걷어내고 지금 점수를 그대로 찍는다. 정답·오답처럼 즉시 반영해야 하는
  // 자리와 게임 시작·재시작에서 쓴다. animateScore 와 짝으로 둔다.
  function updateScore() {
    if (scoreTween) {
      cancelAnimationFrame(scoreTween);
      scoreTween = 0;
    }
    window.clearTimeout(scoreTweenFallbackId);
    scoreShown = state.score;
    renderScore(state.score);
  }

  // 검수 r11: 보너스가 붙는 순간 점수판 숫자가 최종값으로 튀지 않고 굴러 올라간다.
  function animateScore(target) {
    const to = Math.trunc(Number(target) || 0);
    const from = scoreShown;
    if (from === to || prefersReducedMotion()) {
      updateScore();
      return;
    }

    if (scoreTween) cancelAnimationFrame(scoreTween);
    window.clearTimeout(scoreTweenFallbackId);

    const startedAt = Date.now();
    // 차이가 클수록 조금 길게, 최대 0.72초.
    const span = Math.min(720, 280 + Math.abs(to - from) * 2);

    // rAF 가 안 도는 환경(백그라운드 탭 등)에서 숫자가 옛 값에 멈추지 않게 한다.
    scoreTweenFallbackId = window.setTimeout(() => {
      if (scoreShown === to) return;
      scoreShown = to;
      renderScore(to);
      if (scoreTween) {
        cancelAnimationFrame(scoreTween);
        scoreTween = 0;
      }
    }, span + 120);

    const step = () => {
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
    };
    scoreTween = requestAnimationFrame(step);
  }

  function renderProgress() {
    const total = state.questionOrder.length || questions.length;
    const current = Math.min(total, state.orderPosition + 1);
    const text = total > 0 ? `${current}/${total}` : "-/-";
    elements.progress.textContent = text;
    elements.progress.setAttribute("aria-label", `문항 ${text}`);
  }

  function renderTimer(remainingMilliseconds) {
    const ratio = totalDurationMs > 0
      ? Math.max(0, Math.min(1, remainingMilliseconds / totalDurationMs))
      : 0;
    const remainingSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1000));
    elements.time.textContent = formatTime(remainingMilliseconds);
    elements.time.setAttribute("aria-label", `남은 시간 ${remainingSeconds}초`);
    setArc(elements.timerArc, ratio);
    // 2차 수정(공통 2절, OX 와 같은 이름과 구간): 남은 10초부터 빨강으로 깜박이고(urgent),
    // 5초부터 더 빠르다(critical). 예전 30~10초 노랑 단계는 없다.
    elements.stage.classList.toggle(
      "timer-urgent",
      remainingMilliseconds > 5_000 && remainingMilliseconds <= 10_000,
    );
    elements.stage.classList.toggle(
      "timer-critical",
      remainingMilliseconds > 0 && remainingMilliseconds <= 5_000,
    );
  }

  function setKeysDisabled(disabled) {
    elements.keys.forEach((key) => {
      // 철자 없는 건반은 채울 값이 없으므로 항상 누를 수 없다.
      key.disabled = disabled || key.dataset.mode !== "letter" || key.classList.contains("is-used");
    });
  }

  function renderKeys() {
    const keys = state.currentQuestion?.keys || [];
    elements.keys.forEach((element, index) => {
      const key = keys[index] || { letter: "" };
      const letter = String(key.letter || "");
      element.classList.remove("is-used", "is-correct", "is-wrong", "is-pressed");
      element.dataset.mode = letter ? "letter" : "note";
      element.querySelector(".key-letter").textContent = letter;
      element.setAttribute(
        "aria-label",
        letter ? `${letter} 건반` : "빈 건반",
      );
      element.setAttribute("aria-hidden", letter ? "false" : "true");
    });
  }

  function renderLetterRow() {
    const question = state.currentQuestion;
    elements.letterRow.replaceChildren();
    state.tileElements = [];
    if (!question) return;

    const tileSize = Math.min(
      LETTER_TILE_CQW,
      LETTER_ROW_MAX_CQW / Math.max(1, question.letters.length),
    );
    elements.letterRow.style.setProperty("--tile-size", `${tileSize.toFixed(4)}cqw`);

    const blanks = new Set(question.blanks);
    const fragment = document.createDocumentFragment();
    question.letters.forEach((character, index) => {
      const tile = document.createElement("span");
      const isLetter = /^[a-z]$/i.test(character);
      tile.className = "letter-tile";
      if (!isLetter) {
        tile.classList.add("is-gap");
      } else if (!blanks.has(index)) {
        tile.classList.add("is-filled");
      }

      tile.style.setProperty("--tile-index", String(index));
      const glyph = document.createElement("span");
      glyph.className = "letter";
      glyph.textContent = isLetter && blanks.has(index) ? "" : character;
      tile.append(glyph);
      fragment.append(tile);
      state.tileElements.push(tile);
    });
    elements.letterRow.append(fragment);
    elements.letterRow.setAttribute(
      "aria-label",
      `${question.english} — 빈칸 ${question.blanks.length}개`,
    );
  }

  // 뜻은 상자 안에서 좌우 여백(발음 버튼 자리)을 침범하지 않아야 한다. 기본
  // 크기로 넘치면 들어갈 때까지 줄이고, 최소 크기에서도 넘치면 남는 비율만큼
  // 한 번 더 줄여 상자 밖으로 나가지 않게 한다.
  function fitMeaningText() {
    const box = elements.meaning;
    const inner = elements.meaningText;
    if (!box || !inner) return;

    const step = 0.06;
    let size = MEANING_FONT_MAX_CQW;
    box.style.setProperty("--meaning-font-size", `${size}cqw`);

    const overflows = () => inner.scrollWidth > box.clientWidth + 1
      || inner.scrollHeight > box.clientHeight + 1;

    let guard = 0;
    while (size > MEANING_FONT_MIN_CQW && overflows() && guard++ < 60) {
      size = Math.max(MEANING_FONT_MIN_CQW, size - step);
      box.style.setProperty("--meaning-font-size", `${size.toFixed(2)}cqw`);
    }

    if (overflows() && box.clientWidth > 0 && box.clientHeight > 0) {
      const widthRatio = box.clientWidth / Math.max(1, inner.scrollWidth);
      const heightRatio = box.clientHeight / Math.max(1, inner.scrollHeight);
      const ratio = Math.min(1, widthRatio, heightRatio) * 0.98;
      box.style.setProperty("--meaning-font-size", `${Math.max(0.1, size * ratio).toFixed(2)}cqw`);
    }
  }

  // 보너스(사장님 2026-10-02 "Score 보너스 효과 단어미로(Star) 프로젝트 확인해서 효과 동일하게 적용"):
  // 단어미로 playScoreBonus 와 같은 구성 — 점수 원 둘레 금빛 링 · 숫자 금색 펀치(is-combo)와 원 위로
  // 떠오르는 "보너스 +100"(is-bonus)을 같은 순간에 켜고 1.1초 뒤 함께 걷는다. 숫자 굴림은 animateScore.
  // 다시 시작(startGame · showStartScreen)은 clearScoreBonus 로 바로 걷는다 — 앞 판 효과가 새 판에 남지 않게.
  const BONUS_EFFECT_MS = 1_100;
  let scoreBonusTimer = 0;
  function playScoreBonus(amount) {
    const bonus = Math.trunc(Number(amount) || 0);
    const gauge = elements.scoreGauge;
    const label = elements.scoreBonus;
    if (bonus <= 0 || !gauge || !label) return;
    window.clearTimeout(scoreBonusTimer);
    gauge.classList.remove("is-combo");
    label.classList.remove("is-bonus");
    // 레이아웃을 한 번 읽어야 같은 클래스를 다시 붙일 때 애니메이션이 처음부터 돈다.
    void gauge.offsetWidth;
    label.textContent = `보너스 +${formatScore(bonus)}`;
    gauge.classList.add("is-combo");
    label.classList.add("is-bonus");
    scoreBonusTimer = window.setTimeout(clearScoreBonus, BONUS_EFFECT_MS);
  }

  function clearScoreBonus() {
    window.clearTimeout(scoreBonusTimer);
    scoreBonusTimer = 0;
    elements.scoreGauge?.classList.remove("is-combo");
    if (elements.scoreBonus) {
      elements.scoreBonus.classList.remove("is-bonus");
      elements.scoreBonus.textContent = "";
    }
  }

  // 검수 r36/r11: 점수 증감을 화면에 띄운다. 단어를 완성하면 그 단어에서 실제로
  // 오른 합계(철자 2개 x scoring.correct = +100)를, 오답이면 -10 을 보여준다.
  // 보너스는 여기서 띄우지 않는다 — 점수 원 위의 playScoreBonus 가 맡는다(단어미로와 같다).
  function showScorePopup(amount) {
    const host = elements.scorePopups;
    if (!host) return;

    // 자리가 한 곳뿐이라 앞 팝업이 남아 있으면 숫자가 겹쳐 뭉갠다. 최신 증감만 보인다.
    host.replaceChildren();

    const popup = document.createElement("span");
    const value = Math.trunc(Number(amount) || 0);
    popup.className = `score-popup ${value < 0 ? "is-loss" : "is-gain"}`;
    popup.textContent = `${value > 0 ? "+" : ""}${formatScore(value)}`;
    host.append(popup);

    const clear = () => popup.remove();
    popup.addEventListener("animationend", clear, { once: true });
    window.setTimeout(clear, 1_600);
  }

  function currentTargetIndex() {
    const question = state.currentQuestion;
    if (!question) return -1;
    return question.blanks[state.targetPosition] ?? -1;
  }

  function renderTarget() {
    const targetIndex = currentTargetIndex();
    state.tileElements.forEach((tile, index) => {
      tile.classList.toggle("is-target", index === targetIndex);
    });
    elements.letterRow.dataset.chances = String(state.chances);
  }

  function renderQuestion() {
    const question = state.currentQuestion;
    elements.meaningText.textContent = question?.meaning || "";
    fitMeaningText();
    state.targetPosition = 0;
    state.chances = scoring.chances;
    state.wrongInWord = 0;
    renderLetterRow();
    renderKeys();
    renderTarget();
    renderProgress();
    setKeysDisabled(false);
    // 검수 r13: 문제가 제시될 때는 단어 사운드를 내지 않는다. 먼저 들려주면
    // 철자를 듣고 맞히는 파닉스 학습이 되어 버린다. 재생은 finishWord 에서
    // 단어를 완성했거나 기회를 모두 쓴 뒤에만 한다.
  }

  function clearFeedback() {
    elements.keys.forEach((key) => key.classList.remove("is-correct", "is-wrong"));
    elements.stage.classList.remove("feedback-correct", "feedback-wrong");
    elements.character.classList.remove("is-feedback");
    elements.character.classList.add("is-idle");
    delete elements.character.dataset.feedback;
    elements.character.src = CHARACTER_IMAGE;
  }

  function playCharacterFeedback(outcome) {
    elements.character.classList.remove("is-idle");
    elements.character.classList.add("is-feedback");
    elements.character.dataset.feedback = outcome;
  }

  function revealRemainingBlanks() {
    const question = state.currentQuestion;
    if (!question) return;
    question.blanks.slice(state.targetPosition).forEach((letterIndex) => {
      const tile = state.tileElements[letterIndex];
      if (!tile) return;
      tile.classList.add("is-filled", "is-revealed");
      tile.classList.remove("is-target");
      tile.querySelector(".letter").textContent = question.letters[letterIndex];
    });
  }

  // 2차 검수 SB3-4 · SB공통-3: 단어카드. 글자 크기는 따라쓰기 단어카드 기준 — 156px, 10자 이상은 118px(.is-long), 그래도
  // 최대 폭(88cqw)을 넘으면 넘지 않을 때까지 줄인다(따라쓰기 fitWordReveal 과 같은 방식).
  function fitWordReveal() {
    const word = elements.wordReveal;
    word.style.setProperty("--reveal-scale", "1");
    let scale = 1;
    while (scale > 0.3 && word.scrollWidth > word.clientWidth + 0.5) {
      scale = Math.round((scale - 0.04) * 100) / 100;
      word.style.setProperty("--reveal-scale", String(scale));
    }
  }

  // 맞혀서 완성했을 때와 기회를 다 써서 정답을 보여 줄 때 모두 띄운다(다른 Spelling Builder 방과 같다).
  // 다음 문제로 넘어갈 때(advanceQuestion) · 판이 끝날 때 · 시작 화면으로 나갈 때 걷는다.
  function showWordReveal(question, { exhausted }) {
    const word = String(question?.english || "");
    elements.wordReveal.textContent = word;
    elements.wordReveal.classList.toggle("is-long", word.length > 9);
    elements.answerReveal.classList.toggle("is-fail", exhausted);
    elements.answerReveal.hidden = false;
    fitWordReveal();
  }

  function hideWordReveal() {
    elements.answerReveal.hidden = true;
    elements.answerReveal.classList.remove("is-fail");
    elements.wordReveal.textContent = "";
  }

  function advanceQuestion() {
    stopQuestionAudio();
    hideWordReveal();
    state.orderPosition += 1;
    if (state.orderPosition >= state.questionOrder.length) {
      endGame();
      return;
    }
    state.currentQuestion = questions[state.questionOrder[state.orderPosition]];
    renderQuestion();
    clearFeedback();
    state.locked = false;
  }

  function finishWord({ exhausted }) {
    state.locked = true;
    setKeysDisabled(true);

    if (exhausted) {
      state.exhaustedCount += 1;
      state.streak = 0;
      recordIncorrectAnswer(state.currentQuestion);
      revealRemainingBlanks();
      elements.status.textContent = `기회를 모두 사용했습니다. 정답은 ${state.currentQuestion.english}입니다.`;
    } else {
      let bonusAwarded = false;
      state.correctCount += 1;
      // 완성한 단어는 왼쪽부터 물결처럼 튀어오른다.
      playOnce(elements.letterRow, "is-complete", 1_400);
      showScorePopup(scoring.correct * window.SpellingBuilderContent.BLANK_COUNT);
      if (state.wrongInWord === 0) {
        state.streak += 1;
        if (state.streak > 0 && state.streak % scoring.comboEvery === 0) {
          bonusAwarded = true;
          state.bonusPoints += scoring.comboBonus;
          state.score += scoring.comboBonus;
          playScoreBonus(scoring.comboBonus);
          // 검수 10항: 낭독 문구의 점수도 화면과 같은 서식을 거친다.
          elements.status.textContent = `${scoring.comboEvery}문제 연속 정답! 보너스 ${formatScore(scoring.comboBonus)}점입니다.`;
        } else {
          elements.status.textContent = "단어를 완성했습니다.";
        }
      } else {
        state.streak = 0;
        elements.status.textContent = "단어를 완성했습니다.";
      }
      // 검수 r11: 보너스가 붙은 판만 점수판을 굴려 올린다. 그 외에는 즉시 반영.
      if (bonusAwarded) animateScore(state.score);
      else updateScore();
    }

    showWordReveal(state.currentQuestion, { exhausted });
    // 사양: 완성/강제 전환 모두 단어 사운드를 들려준 뒤 다음 문제로 넘어간다.
    playWordAudio();

    const round = state.round;
    state.feedbackTimerId = window.setTimeout(() => {
      if (state.ended || round !== state.round) return;
      advanceQuestion();
    }, exhausted ? FEEDBACK_DURATION_MS.exhausted : FEEDBACK_DURATION_MS.complete);
  }

  function pressKey(keyIndex) {
    if (state.locked || state.ended || !state.currentQuestion) return;
    const index = Number(keyIndex);
    if (!Number.isInteger(index) || index < 0 || index >= elements.keys.length) return;

    const keyElement = elements.keys[index];
    if (keyElement.disabled) return;
    const key = state.currentQuestion.keys[index];
    const letter = String(key?.letter || "");
    if (!letter) return;

    // 건반을 누르면 그 건반의 실로폰 음이 먼저 울리고, 정답·오답 효과가 겹친다.
    playAudioSource(KEY_SOUNDS[index]);

    const targetIndex = currentTargetIndex();
    if (targetIndex < 0) return;
    const expected = String(state.currentQuestion.letters[targetIndex] || "").toLowerCase();
    const isCorrect = letter.toLowerCase() === expected;

    if (isCorrect) {
      playSound("correct");
      keyElement.classList.remove("is-wrong");
      void keyElement.offsetWidth;
      keyElement.classList.add("is-correct", "is-used");
      keyElement.disabled = true;

      const tile = state.tileElements[targetIndex];
      if (tile) {
        tile.classList.add("is-filled");
        tile.classList.remove("is-target");
        tile.querySelector(".letter").textContent = state.currentQuestion.letters[targetIndex];
        playOnce(tile, "is-pop", 700);
      }
      floatKeyNote(keyElement);

      state.correctPoints += scoring.correct;
      state.score += scoring.correct;
      state.targetPosition += 1;
      updateScore();
      elements.stage.classList.remove("feedback-wrong");
      elements.stage.classList.add("feedback-correct");
      playCharacterFeedback("correct");

      if (state.targetPosition >= state.currentQuestion.blanks.length) {
        finishWord({ exhausted: false });
        return;
      }

      renderTarget();
      elements.status.textContent = "정답입니다.";
      const round = state.round;
      state.feedbackTimerId = window.setTimeout(() => {
        if (!state.ended && round === state.round) clearFeedback();
      }, FEEDBACK_DURATION_MS.letter);
      return;
    }

    playSound("incorrect");
    keyElement.classList.remove("is-correct");
    void keyElement.offsetWidth;
    keyElement.classList.add("is-wrong");
    state.incorrectCount += 1;
    state.wrongInWord += 1;
    state.incorrectPoints += scoring.incorrect;
    state.score += scoring.incorrect;
    showScorePopup(scoring.incorrect);
    state.chances = Math.max(0, state.chances - 1);
    updateScore();
    renderTarget();
    elements.stage.classList.remove("feedback-correct");
    elements.stage.classList.add("feedback-wrong");
    playCharacterFeedback("incorrect");

    if (state.chances <= 0) {
      finishWord({ exhausted: true });
      return;
    }

    elements.status.textContent = `오답입니다. 남은 기회 ${state.chances}번입니다.`;
    const round = state.round;
    state.feedbackTimerId = window.setTimeout(() => {
      if (!state.ended && round === state.round) clearFeedback();
    }, FEEDBACK_DURATION_MS.letter);
  }

  function endGame() {
    rememberRoundLastWord();
    state.ended = true;
    stopBgm();
    state.locked = true;
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    stopQuestionAudio();
    clearFeedback();
    // 검수 r11: 트윈이 돌던 중 끝나도 점수판은 최종값으로 확정한다.
    updateScore();
    elements.stage.classList.remove("timer-urgent", "timer-critical");
    setKeysDisabled(true);
    renderTimer(0);
    hideWordReveal();
    closeIncorrectAnswerDialog({ restoreFocus: false });
    renderResultBreakdown();
    void preloadIncorrectFont();
    setScreen("result");
    // 2차 수정 PDF(결과 화면): 파티클은 Good · Excellent 에서만 낸다. Try Again 은 내지 않는다.
    if (getResultTitleAsset() !== RESULT_TITLE_ASSETS.tryAgain) emitResultConfetti();
    // 검수 9-2: X 버튼이 점수 저장이 끝난 뒤에 나가도록 저장 약속을 들고 있는다.
    resultPersistPromise = persistResult();
    emitNavigation("ending");
    elements.status.textContent = `게임이 종료되었습니다. 최종 점수는 ${formatScore(state.score)}점입니다.`;
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

  function resetPressedState(key) {
    key.classList.remove("is-pressed");
  }

  function setPressedState(key) {
    if (key.disabled) return;
    key.classList.add("is-pressed");
  }

  // 검수 9-2: 시작 화면으로 나갈 때 점수·오답 목록·저장 표시를 판 시작과 같은 상태로 되돌린다.
  function resetRoundState() {
    state.score = 0;
    state.streak = 0;
    state.correctPoints = 0;
    state.incorrectPoints = 0;
    state.bonusPoints = 0;
    state.correctCount = 0;
    state.incorrectCount = 0;
    state.exhaustedCount = 0;
    incorrectAnswerRecords.clear();
    incorrectAnswerSequence = 0;
    updateIncorrectAnswersButton();
    state.historyRequested = false;
    resultPersistPromise = null;
  }

  function showStartScreen({ restoreFocus = true } = {}) {
    stopBgm();
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    state.animationFrameId = 0;
    state.feedbackTimerId = 0;
    state.locked = true;
    state.ended = true;
    state.resultRequestToken += 1;
    helpRequestToken += 1;
    clearResultParticles();
    clearFeedback();
    hideWordReveal();
    stopQuestionAudio();
    stopIncorrectAudio();
    closeIncorrectAnswerDialog({ restoreFocus: false });
    clearScoreBonus();
    // 게임 중 X 로 나온 판도 '앞 판'이다. 끝난 판이면 endGame 이 이미 같은 값을 적어 두었다.
    rememberRoundLastWord();
    resetRoundState();
    updateScore();
    elements.stage.classList.remove(
      "timer-urgent",
      "timer-critical",
      "feedback-correct",
      "feedback-wrong",
    );
    setKeysDisabled(true);
    setStartReady(questions.length >= 1);
    setScreen("start");
    fitStartStory();
    // 제목 글꼴이 아직 오는 중이면 다 받은 뒤 한 번 더 잰다(대체 글꼴 폭으로 잰 배율이 남지 않게).
    document.fonts?.ready?.then(fitStartStory);
    buildStartEffects();
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
    clearResultParticles();
    closeIncorrectAnswerDialog({ restoreFocus: false });
    clearScoreBonus();
    stopQuestionAudio();
    stopIncorrectAudio();

    // 사양: 매 판 문제를 랜덤으로 다시 낸다. 빈칸 위치와 건반 배치도 새로 뽑는다.
    const rebuilt = window.SpellingBuilderContent.rebuildQuestions?.();
    if (Array.isArray(rebuilt) && rebuilt.length > 0) {
      questions = rebuilt;
    }

    resetRoundState();
    state.round += 1;
    state.resultRequestToken += 1;
    helpRequestToken += 1;
    state.questionOrder = avoidPreviousLastWord(shuffleQuestionOrder());
    state.orderPosition = 0;
    state.locked = false;
    state.ended = false;

    clearFeedback();
    hideWordReveal();
    elements.stage.classList.remove("timer-urgent", "timer-critical");
    setScreen("play");
    elements.resultMessage.textContent = "";
    state.currentQuestion = questions[state.questionOrder[state.orderPosition]];
    renderQuestion();
    updateScore();
    renderTimer(totalDurationMs);
    elements.status.textContent = "게임을 시작합니다.";

    const now = performance.now();
    state.gameStartedAt = now;
    state.animationFrameId = requestAnimationFrame(update);
    // 검수 q54: Start 버튼을 누른 흐름이라 자동재생 정책에 걸리지 않는다.
    startBgm();
    emitNavigation("game");
  }

  // 한글 글꼴(사장님 2026-10-02 "한글 표기는 전부 이걸 사용", 14:20 OTFEB 로): 동봉 나눔스퀘어라운드 ExtraBold
  // (styles.css @font-face)를 한 번만 요청하고 같은 약속을 돌려준다. 뜻 칸은 글자를 재서 줄이므로
  // 이 글꼴을 받은 뒤에 시작 화면을 연다. 받지 못해도(경로 · 네트워크) 게임은 막지 않는다 —
  // KOREAN_FONT_WAIT_MS 가 지나면 대체 글꼴로 이어 가고, 늦게 도착하면 지금 뜻을 다시 맞춘다.
  const KOREAN_FONT = '700 1em "NanumSquareRound Game"';
  const KOREAN_FONT_WAIT_MS = 3_000;
  let koreanFontPromise = null;
  function loadKoreanFont() {
    if (!koreanFontPromise) {
      koreanFontPromise = document.fonts && typeof document.fonts.load === "function"
        ? document.fonts.load(KOREAN_FONT, "가").catch(() => [])
        : Promise.resolve([]);
    }
    return koreanFontPromise;
  }

  // 오답 목록 전용 한글(나눔스퀘어라운드 Bold, 사장님 2026-10-15 "1번으로 통일")은 결과 화면이 뜰 때 받아 둔다 —
  // 목록을 처음 열 때 대체 글꼴로 한 번 그려졌다가 바뀌지 않게. 받지 못해도 ExtraBold 로 그려진다(styles.css 대체 순서).
  let incorrectFontPromise = null;
  function preloadIncorrectFont() {
    if (!incorrectFontPromise && document.fonts && typeof document.fonts.load === "function") {
      incorrectFontPromise = document.fonts.load('500 1em "NanumSquareRound List"', "가").catch(() => []);
    }
    return incorrectFontPromise;
  }

  function waitForKoreanFont() {
    return Promise.race([
      loadKoreanFont(),
      new Promise((resolve) => { window.setTimeout(resolve, KOREAN_FONT_WAIT_MS); }),
    ]);
  }

  async function initializeContent({ force = false } = {}) {
    const loader = window.SpellingBuilderContent;
    const token = ++contentRequestToken;
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    stopQuestionAudio();
    setKeysDisabled(true);
    setStartReady(false);
    setScreen("loading");
    showLoading("게임 준비 중", "단어와 게임 정보를 불러오고 있습니다.");

    try {
      if (!loader || typeof loader.bootstrap !== "function") {
        throw new Error("API 콘텐츠 로더를 시작할 수 없습니다.");
      }
      const loaded = await loader.bootstrap({ force });
      if (token !== contentRequestToken) return;
      if (!Array.isArray(loaded?.content?.questions) || loaded.content.questions.length < 1) {
        throw new Error("게임에 사용할 문제가 충분하지 않습니다.");
      }

      questions = loaded.content.questions;
      launchContext = loaded.launch || null;
      renderStartStory(loaded.content.info);
      const apiPlayTime = Math.trunc(Number(loaded.content.info?.play_time));
      apiPlayTimeMs = Number.isSafeInteger(apiPlayTime) && apiPlayTime > 0
        ? apiPlayTime * 1_000
        : 0;
      totalDurationMs = apiPlayTimeMs > 0 ? apiPlayTimeMs : configuredTotalDurationMs;
      // 한글 글꼴을 받은 뒤에 시작 화면을 연다 — 첫 문제 뜻 칸을 대체 글꼴로 재지 않게.
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
        apiPlayTimeMs,
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

  elements.keys.forEach((key) => {
    key.addEventListener("pointerdown", () => setPressedState(key));
    key.addEventListener("pointerup", () => resetPressedState(key));
    key.addEventListener("pointercancel", () => resetPressedState(key));
    key.addEventListener("pointerleave", () => resetPressedState(key));
    key.addEventListener("blur", () => resetPressedState(key));
    key.addEventListener("click", () => pressKey(key.dataset.key));
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
    if (currentScreen === "help" && event.key === "Escape") {
      event.preventDefault();
      closeHelp();
      return;
    }
    if (event.repeat || currentScreen !== "play" || state.ended) return;
    // 1-6은 왼쪽부터 여섯 건반에 대응한다.
    if (event.key >= "1" && event.key <= "6") {
      pressKey(Number(event.key) - 1);
      return;
    }
    // 글자 키로도 해당 철자의 건반을 누를 수 있다.
    if (/^[a-z]$/i.test(event.key)) {
      const match = elements.keys.findIndex((key) => key.dataset.mode === "letter"
        && !key.disabled
        && key.querySelector(".key-letter").textContent.toLowerCase() === event.key.toLowerCase());
      if (match >= 0) pressKey(match);
    }
  });

  elements.soundButton.addEventListener("click", () => {
    pressControl(elements.soundButton);
    soundEnabled = !soundEnabled;
    if (!soundEnabled) {
      stopEffectAudios();
      stopQuestionAudio();
      stopIncorrectAudio();
      stopBgm({ rewind: false });
    }
    updateSoundUI();
    if (soundEnabled) playSound("touch");
    // 검수 q54: BG 버튼으로 껐다 켜면 게임 화면에서만 BGM 이 다시 흐른다.
    if (soundEnabled && currentScreen === "play") startBgm();
    // 2차 수정 PDF 3쪽: 소리를 켜고 끌 때 Sound On/Off 안내를 띄우지 않는다.
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

  // 검수 9-2: 점수 저장이 끝난 뒤에 시작 화면으로 보낸다. 저장이 실패해도 멈추지 않는다.
  function exitToStartScreen() {
    if (elements.resultExitButton.disabled) return;
    pressControl(elements.resultExitButton);
    elements.resultExitButton.disabled = true;
    const pending = resultPersistPromise || Promise.resolve();
    void pending.catch(() => {}).then(() => {
      elements.resultExitButton.disabled = false;
      // 저장을 기다리는 사이 Try Again 으로 새 판이 시작됐으면 그 판을 시작 화면으로 끌어내지
      // 않는다(나중 누름이 이긴다). 끌어내면 '다시 시작' 규칙이 시작도 못 한 판의 단어를 앞 판
      // 마지막 단어로 적는다.
      if (currentScreen !== "result") return;
      showStartScreen();
    });
  }

  elements.resultExitButton.addEventListener("click", exitToStartScreen);
  elements.tryAgainButton.addEventListener("click", () => replayGame(elements.tryAgainButton));
  elements.incorrectAnswersButton.addEventListener("click", openIncorrectAnswerDialog);
  elements.incorrectAnswerClose.addEventListener("click", () => closeIncorrectAnswerDialog());
  elements.incorrectAnswerBackdrop.addEventListener("click", () => closeIncorrectAnswerDialog());
  elements.retryButton.addEventListener("click", () => void initializeContent({ force: true }));
  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(state.animationFrameId);
    clearTimeout(state.feedbackTimerId);
    clearResultParticles();
    stopQuestionAudio();
    stopIncorrectAudio();
    stopEffectAudios();
    window.clearTimeout(toastTimer);
    state.resultRequestToken += 1;
    helpRequestToken += 1;
    contentRequestToken += 1;
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      void initializeContent({ force: true });
    }
  });

  preloadResultFoxes();
  // 한글 글꼴은 API 를 기다리는 동안 함께 받는다. 시작 화면이 열린 뒤에 늦게 도착하면(3초 넘게
  // 걸린 경우) 지금 보이는 뜻을 그 글꼴로 다시 맞춘다.
  void loadKoreanFont()
    .then(() => document.fonts?.ready)
    .then(() => {
      if (currentScreen === "play" && state.currentQuestion) fitMeaningText();
      if (currentScreen === "start") fitStartStory();
    });
  updateSoundUI();
  setStartReady(false);
  void initializeContent();
})();
