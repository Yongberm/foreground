(function initSpellingBuilderTrace(global) {
  "use strict";

  // ============================================================
  // 순수 로직 (DOM/Canvas 없이 동작 · Node 테스트 대상)
  // ============================================================

  // 화면 흐름: 로딩 -> 시작 -> 게임 -> 결과(모달).
  const SCREEN_ORDER = Object.freeze(["loading", "start", "game", "result"]);

  function nextScreen(name) {
    const index = SCREEN_ORDER.indexOf(name);
    if (index < 0 || index >= SCREEN_ORDER.length - 1) return null;
    return SCREEN_ORDER[index + 1];
  }

  // 채운 비율. 표본 총량이 0이면 0.
  function coverageRatio(filled, total) {
    if (!(total > 0)) return 0;
    const ratio = filled / total;
    if (ratio < 0) return 0;
    if (ratio > 1) return 1;
    return ratio;
  }

  // 사양: 한 철자 95% 이상이면 완료.
  function isLetterComplete(ratio, threshold) {
    return ratio >= threshold;
  }

  // 사양: 모든 철자 90% 이상이면 단어를 correct로 본다.
  function isWordCorrect(letterRatios, threshold) {
    return Array.isArray(letterRatios)
      && letterRatios.length > 0
      && letterRatios.every((ratio) => ratio >= threshold);
  }

  // 리워드 제공 기준(사장님 지시 2026-09-29) — 분모는 전체 제공 문제수다.
  //   Try again  70% 미만
  //   Good       70% 이상 100% 미만   (사장님 그림의 "71%~99%" 와 70~71% 사이가 비어 있어
  //                                    단정적으로 쓰인 "70% 미만이면 Try again" 을 경계로 삼는다)
  //   Excellent  100%
  // 그림·소리·대체 텍스트가 이 한 곳만 본다 — 셋이 어긋나면 소리와 등급이 따로 논다.
  const GOOD_MIN_RATIO = 0.7;

  function resultTier(ratio) {
    const value = Number.isFinite(ratio) ? ratio : 0;
    if (value >= 1) return "excellent";
    return value >= GOOD_MIN_RATIO ? "good" : "tryAgain";
  }

  // ============================================================
  // 닫기(시작 화면 X) — 사장님 지시 2026-09-30
  // ============================================================

  // 옮겨 갈 주소가 "우리 자리" 인지 본다.
  // origin 만 비교하면 안 된다 — file:// 에서는 모든 주소의 origin 이 "null" 이라
  // javascript: · data: · //evil.example 이 전부 통과한다(검수는 file:// 로 돈다).
  // 그래서 protocol 과 host 까지 같이 보고, 스킴도 허용 목록으로 묶는다.
  // 이 검사가 막아 주는 것은 **스킴 전환과 호스트 이동**까지다 —
  // file:// 에서 앱 폴더 밖의 같은 스킴 주소(file:///etc/...)까지 막지는 못한다.
  const CLOSE_SCHEMES = Object.freeze(["http:", "https:", "file:"]);

  function sameSiteUrl(value, baseHref) {
    if (!value || !baseHref) return null;
    try {
      const base = new URL(baseHref);
      const target = new URL(value, baseHref);
      const ok = target.origin === base.origin
        && target.protocol === base.protocol
        && target.host === base.host
        && CLOSE_SCHEMES.includes(target.protocol);
      return ok ? target.href : null;
    } catch {
      return null;
    }
  }

  // 주소창으로 들어온 주소를 배포 루트(게임 폴더 한 층 위) 아래로 묶는다(사장님 결정 2026-09-30).
  // 게임 폴더 아래로만 묶으면 모음 페이지(../index.html)로 못 돌아가서 경계를 한 층 위로 잡았다.
  // 판단은 URL 이 ".." 과 %2e%2e 를 정리한 뒤의 주소로 한다 — 우회 경로도 같은 규칙에 걸린다.
  function withinDeployRoot(url, baseHref) {
    if (!url || !baseHref) return false;
    try {
      const root = new URL("../", baseHref).href;
      return new URL(url).href.startsWith(root);
    } catch {
      return false;
    }
  }

  // 옮겨 갈 주소가 지금 문서 밖인지 본다. 조각(#…)만 다른 주소는 같은 문서다 —
  // 그리로 옮기면 조각 이동만 일어나 아무 데도 안 가는데 갈래는 성공으로 끝나서
  // 뒤 갈래와 안내를 모두 건너뛴다(X 무동작, 코디네이터 전달 2026-09-30).
  // 판단은 조각과 close_url 인자를 지운 주소로 한다 — 주소창 갈래에서는 지금 주소에 close_url 이
  // 붙어 있어 index.html 이 "다른 문서" 로 보이지만, 그리로 옮기면 게임이 다시 뜰 뿐이다.
  // 다른 질의 인자가 다르면 다른 문서로 본다(질의로 경로를 가르는 배포를 막지 않는다).
  function leavesDocument(url, baseHref) {
    try {
      const here = new URL(baseHref);
      const there = new URL(url);
      for (const u of [here, there]) {
        u.hash = "";
        u.searchParams.delete("close_url");
      }
      return here.href !== there.href;
    } catch {
      return false;
    }
  }

  // 어디로 나갈지 고른다. 순서: 주소창의 close_url → 설정의 closeUrl → 온 길로 뒤로 → 창 닫기.
  // 주소창 값은 누구나 붙일 수 있으니 배포 루트 아래로 묶고, 설정값은 납품본에 박힌 값이라
  // 같은 출처 검사(sameSiteUrl)까지만 본다. 두 갈래 모두 지금 문서를 가리키면 버리고 다음 갈래로 넘긴다.
  function decideClose({ href = "", search = "", configuredUrl = "", referrer = "" } = {}) {
    const fromQuery = sameSiteUrl(new URLSearchParams(search).get("close_url"), href);
    if (fromQuery && withinDeployRoot(fromQuery, href) && leavesDocument(fromQuery, href)) {
      return { action: "navigate", url: fromQuery, source: "close_url" };
    }
    const fromConfig = sameSiteUrl(configuredUrl, href);
    if (fromConfig && leavesDocument(fromConfig, href)) {
      return { action: "navigate", url: fromConfig, source: "config" };
    }
    if (sameSiteUrl(referrer, href)) return { action: "back", source: "referrer" };
    return { action: "close", source: "window" };
  }

  // 결정을 실제로 수행한다. 2차 공통-12(사장님 2026-10-15 "권하신 대로"): 웹은 새 창으로 열리고 앱은 웹뷰로 열리므로
  // 알림 → 앱 웹뷰 닫기 자리(closeApp) → 창 닫기를 먼저 하고, 창이 안 닫혔을 때만 위 갈래(close_url → 설정 → 온 길)로 간다.
  // 새 창에는 돌아갈 페이지가 없어 뒤로 가기를 먼저 하면 X 가 아무 일도 하지 않는다.
  // 안 닫혀도 안내는 띄우지 않는다(사장님 결정 2026-09-30) — 갈래가 없으면 X 는 아무 반응이 없다.
  function performClose(io) {
    if (io.dispatch() === false) return "blocked";   // 호스트가 preventDefault 로 막았다
    if (io.closeApp) io.closeApp();
    io.closeWindow();
    if (io.isClosed && io.isClosed()) return "closed";
    const decision = io.decision;
    if (decision.action === "navigate") { io.navigate(decision.url); return "navigate"; }
    if (decision.action === "back") { io.back(); return "back"; }
    return "open";
  }

  // 문항 진행/정답 집계 상태 머신. 타이머·점수·콤보 없음.
  function createGameFlow(totalQuestions) {
    const total = Math.max(1, Math.trunc(totalQuestions) || 1);
    let index = 0;
    let correct = 0;
    const results = [];
    return {
      total,
      get index() { return index; },
      get correct() { return correct; },
      currentNumber() { return Math.min(index + 1, total); },
      isLast() { return index >= total - 1; },
      isFinished() { return index >= total; },
      // 현재 단어를 완성 처리(정답 1건 가산). 문항당 한 번만 반영한다.
      completeWord(isCorrect = true) {
        if (index >= total) return;
        if (results[index] !== undefined) return;
        results[index] = Boolean(isCorrect);
        if (isCorrect) correct += 1;
      },
      // 확인 버튼: 다음 문항으로. 마지막이면 index가 total에 도달해 종료 상태가 된다.
      advance() {
        if (index < total) index += 1;
        return index;
      },
      progress() { return { current: Math.min(index + 1, total), total, done: Math.min(index, total) }; },
      tally() { return { correct, total, results: results.slice() }; },
    };
  }

  const PureLogic = Object.freeze({
    SCREEN_ORDER,
    nextScreen,
    coverageRatio,
    isLetterComplete,
    isWordCorrect,
    createGameFlow,
    resultTier,
    GOOD_MIN_RATIO,
    sameSiteUrl,
    withinDeployRoot,
    leavesDocument,
    decideClose,
    performClose,
  });

  global.SpellingBuilderGame = PureLogic;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = PureLogic;
  }

  // ============================================================
  // 브라우저 전용 배선 (문서가 있을 때만)
  // ============================================================
  const doc = global.document;
  if (!doc) return;

  const Content = global.SpellingBuilderContent;

  // 형제(spellingbuilde_start)와 같은 흐름: 완성하면 단어를 크게 띄우고
  // 사운드를 들려준 뒤 스스로 다음 문제로 넘어간다. 확인 버튼은 없다.
  const REVEAL_SOUND_MS = 320;   // 단어가 뜨고 발음이 나오기까지
  const REVEAL_HOLD_MS = 2000;   // 단어를 보여 주는 시간

  // 검수 r46 결정(2026-09-15): 이번 버전에서는 여우 캐릭터를 보이지 않는다.
  // 자산·좌표·CSS 는 남겨 두고 이 스위치만 끈다 — true 로 바꾸면 그대로 다시 나온다.
  const SHOW_FOX = false;

  const DEFAULTS = Object.freeze({
    questionCount: 5,
    letterAdvanceRatio: 0.95,
    wordCorrectRatio: 0.9,
  });

  // ---- DOM 참조 ----
  const el = {
    stage: doc.getElementById("game-stage"),
    statusToast: doc.getElementById("status-toast"),
    soundButton: doc.getElementById("sound-button"),
    soundIcon: doc.getElementById("sound-icon"),
    navigationButton: doc.getElementById("navigation-button"),
    navigationIcon: doc.getElementById("navigation-icon"),

    loadingScreen: doc.getElementById("loading-screen"),
    loadingTitle: doc.getElementById("loading-title"),
    loadingMessage: doc.getElementById("loading-message"),
    retryButton: doc.getElementById("retry-button"),

    startScreen: doc.getElementById("start-screen"),
    startButton: doc.getElementById("start-button"),
    helpButton: doc.getElementById("help-button"),
    startStory: doc.getElementById("start-story"),
    startStoryTitle: doc.getElementById("start-story-title"),
    startStorySubtitle: doc.getElementById("start-story-subtitle"),

    helpScreen: doc.getElementById("help-screen"),
    helpContent: doc.getElementById("help-content"),
    helpStatus: doc.getElementById("help-status"),
    helpStatusMessage: doc.getElementById("help-status-message"),
    helpRetryButton: doc.getElementById("help-retry-button"),

    playScreen: doc.getElementById("play-screen"),
    gameStatus: doc.getElementById("game-status"),
    wordMeaning: doc.getElementById("word-meaning-text"),
    traceTile: doc.getElementById("trace-tile"),
    traceCanvas: doc.getElementById("trace-canvas"),
    traceFoxes: [...doc.querySelectorAll(".trace-fox")],
    wordReveal: doc.getElementById("word-reveal"),
    answerReveal: doc.getElementById("answer-reveal"),
    strokeOrder: doc.getElementById("stroke-order"),
    letterRow: doc.getElementById("letter-row"),
    gameProgress: doc.getElementById("game-progress"),

    // 결과는 화면(end-screen)이다 — 형제 공통.
    endScreen: doc.getElementById("end-screen"),
    resultTitle: doc.getElementById("result-title"),
    resultFox: doc.getElementById("result-fox"),
    resultScoreNumber: doc.getElementById("result-score-number"),
    resultTotalScore: doc.getElementById("result-total-score"),
    resultCorrectPoints: doc.getElementById("result-correct-points"),
    resultIncorrectPoints: doc.getElementById("result-incorrect-points"),
    resultBonusPoints: doc.getElementById("result-bonus-points"),
    resultMessage: doc.getElementById("result-message"),
    resultCloseButton: doc.getElementById("result-close-button"),
    resultParticleCanvas: doc.getElementById("result-particle-canvas"),
    tryAgainButton: doc.getElementById("try-again-button"),

    // 오답(미완성) 목록 팝업
    incorrectAnswerDialog: doc.getElementById("incorrect-answer-dialog"),
    incorrectAnswerBackdrop: doc.getElementById("incorrect-answer-backdrop"),
    incorrectAnswerCloseButton: doc.getElementById("incorrect-answer-close-button"),
    incorrectAnswerList: doc.getElementById("incorrect-answer-list"),

    // 랭킹 팝업은 id가 result-dialog다 — 형제 공통.
  };

  // ---- 실행 상태 ----
  const app = {
    config: { ...DEFAULTS },
    launch: null,
    questions: [],
    flow: null,
    muted: false,
    audio: null,
    lastFocus: null,
    activeModal: null,
    trace: null,
    screen: "loading",
    wrongWords: [],
    savePromise: null,
    // 11-3: 판이 몇 번째로 열린 것인지. 시작할 때 올리고, 늦게 도착한 콜백은 이 값으로 걸러진다.
    round: 0,
    // 2차 수정: 마지막으로 화면에 나온 단어. 다시 시작할 때 이 단어로 첫 문제를 내지 않는다(새로 고침하면 잊는다).
    lastShownWord: "",
  };

  function announce(message) {
    if (el.gameStatus) el.gameStatus.textContent = message;
  }

  let toastTimer = 0;
  function toast(message) {
    if (!el.statusToast) return;
    global.clearTimeout(toastTimer);
    el.statusToast.textContent = message;
    el.statusToast.classList.toggle("is-visible", Boolean(message));
    if (!message) return;
    toastTimer = global.setTimeout(() => {
      el.statusToast.classList.remove("is-visible");
      toastTimer = 0;
    }, 1600);
  }

  // ---- 화면 전환 ----
  const SCREENS = ["loadingScreen", "startScreen", "helpScreen", "playScreen"];
  function showScreen(key) {
    SCREENS.forEach((name) => {
      const node = el[name];
      if (!node) return;
      const visible = name === key;
      if (name === "loadingScreen") {
        node.classList.toggle("is-hidden", !visible);
      } else {
        node.hidden = !visible;
      }
    });
    // 결과는 화면이지만 hidden이 아니라 is-visible로 켠다(형제 공통).
    const resultVisible = key === "endScreen";
    if (el.endScreen) {
      el.endScreen.classList.toggle("is-visible", resultVisible);
      el.endScreen.setAttribute("aria-hidden", String(!resultVisible));
    }
    if (el.stage) el.stage.classList.toggle("result-mode", resultVisible);
  }

  // 형제 공통 계약: sound·navigation은 start / help / game 에서 보이고
  // 검수 r12(2026-08-26): "앞으로 가기 버튼은 아니고, X 버튼으로 변경해주세요" — 시작 · 게임 화면은 X 하나다.
  // 2차 수정(PDF 1쪽 · 공통 "도움말 버튼"): 도움말 화면에서만 X 대신 왼쪽 위(스피커 자리)에 주황 뒤로가기 그림을
  // 두고 스피커는 숨긴다. 자리는 CSS 의 .help-mode 가 잡는다. 누를 때의 동작(게임 종료 / 시작 화면 복귀)은 그대로다.
  function syncGlobalControls(screen) {
    const visible = screen === "start" || screen === "help" || screen === "game";
    const helpMode = screen === "help";
    if (el.soundButton) el.soundButton.hidden = !visible || helpMode;
    if (el.navigationButton) el.navigationButton.hidden = !visible;
    if (el.stage) el.stage.classList.toggle("help-mode", helpMode);
    const closesGame = screen === "start";
    if (el.navigationIcon) el.navigationIcon.src = helpMode ? "assets/btn_back.png" : "assets/btn_close.png";
    if (el.navigationButton) {
      el.navigationButton.setAttribute(
        "aria-label",
        closesGame ? "게임 닫기" : helpMode ? "뒤로 가기" : "시작 화면으로 돌아가기",
      );
    }
    app.screen = screen;
  }

  // ---- 사운드 ----
  /* 효과음 — 형제(spellingbuilde_start)와 같은 파일·같은 방식.
     같은 소리가 겹칠 수 있으므로 재생할 때마다 복제한다. */
  const sfx = (function createSfx() {
    const EFFECTS = {
      touch: "assets/sound/touch.mp3",     // 버튼 누름
      open: "assets/sound/open.mp3",       // 게임 시작
      show: "assets/sound/show.mp3",       // 정답 단어 등장
      success: "assets/sound/success.mp3", // 단어 완성
      cheer: "assets/sound/yeah.mp3",      // 결과 - 잘함
      stamp: "assets/sound/stamp.mp3",     // 결과 - 보통
      fail: "assets/sound/fail.mp3",       // 결과 - 미완성 있음
    };
    // 철자를 하나 끝낼 때마다 음이 한 칸씩 올라간다.
    const SCALE = Array.from({ length: 8 }, (_, i) => `assets/sound/xylo${i}.mp3`);
    /*
     * 배경음. 평균 -14.3dBFS 로 형제(spellingbuilde_start)가 쓰는 곡과 같은 레벨이라
     * 볼륨도 같은 값을 쓴다. 효과음(success -16.4dBFS)보다 아래에 깔린다.
     */
    const BGM_SRC = "assets/sound/morning_blocks.mp3";
    const BGM_VOLUME = 0.15;
    let bgmAudio = null;
    let bgmWanted = false;
    const cache = new Map();
    const clip = (src) => {
      if (!cache.has(src)) {
        const audio = new global.Audio(src);
        audio.preload = "auto";
        cache.set(src, audio);
      }
      return cache.get(src);
    };
    const playSrc = (src, volume) => {
      if (app.muted || !src) return null;
      try {
        const node = clip(src).cloneNode(true);
        node.volume = typeof volume === "number" ? volume : 1;
        const played = node.play();
        if (played && typeof played.catch === "function") played.catch(() => {});
        return node;
      } catch { return null; }
    };
    return {
      preload() { Object.values(EFFECTS).forEach(clip); SCALE.forEach(clip); },
      effect(name, volume) { return playSrc(EFFECTS[name], volume); },
      note(step) { return playSrc(SCALE[Math.max(0, Math.trunc(step)) % SCALE.length], 0.85); },
      /*
       * 브라우저가 사용자의 조작 없이는 소리를 못 틀게 하므로 첫 클릭 때 불러 준다.
       * 두 번째부터는 이미 돌고 있어 아무 일도 하지 않는다(형제와 같은 방식).
       */
      startBgm() {
        bgmWanted = true;
        if (app.muted) return;
        if (!bgmAudio) {
          try {
            bgmAudio = new global.Audio(BGM_SRC);
            bgmAudio.loop = true;
            bgmAudio.volume = BGM_VOLUME;
            bgmAudio.preload = "auto";
          } catch { bgmAudio = null; return; }
        }
        const played = bgmAudio.play();
        if (played && typeof played.catch === "function") played.catch(() => {});
      },
      // 9-3(2026-09-29 사장님 지시): 결과화면에서는 소리 설정과 상관없이 배경음을 멈춘다.
      // bgmWanted 와 음소거 값은 건드리지 않는다 — 시작 화면으로 돌아가면 설정대로 다시 난다.
      stopBgm() {
        if (bgmAudio) { try { bgmAudio.pause(); } catch { /* noop */ } }
      },
      // 음소거 버튼을 누르면 배경음도 같이 멈추고, 풀면 원래 돌던 경우에만 다시 튼다.
      applyMuted() {
        if (app.muted) { if (bgmAudio) { try { bgmAudio.pause(); } catch { /* noop */ } } }
        else if (bgmWanted) this.startBgm();
      },
    };
  })();

  function playSound(url) {
    if (app.muted || !url) return;
    try {
      if (app.audio) { app.audio.pause(); app.audio = null; }
      const audio = new global.Audio(url);
      app.audio = audio;
      const played = audio.play();
      if (played && typeof played.catch === "function") played.catch(() => {});
    } catch {
      /* 사운드 재생 실패는 게임 진행을 막지 않는다. */
    }
  }

  function setMuted(muted) {
    app.muted = muted;
    if (el.soundButton) {
      el.soundButton.setAttribute("aria-pressed", String(!muted));
      el.soundButton.setAttribute("aria-label", muted ? "소리 켜기" : "소리 끄기");
    }
    if (el.soundIcon) {
      el.soundIcon.src = muted ? "assets/btn_sound_off.png" : "assets/btn_sound_on.png";
    }
    if (muted && app.audio) { try { app.audio.pause(); } catch { /* noop */ } }
    sfx.applyMuted();
  }

  // ============================================================
  // 획순 길안내 (기획서 1-3: 디자인 표기 전용 · 판정에는 관여하지 않는다)
  //
  // 경로·시작점·번호 위치는 trace-assets.js에 구워 둔 자산을 그대로 쓴다.
  // 런타임 계산이 없으므로 결과가 항상 같고, 글자별로 손보기도 쉽다.
  // ============================================================
  const TraceAssets = global.SpellingBuilderTraceAssets;
  const ASSET_SIZE = TraceAssets ? TraceAssets.CANVAS_SIZE : 560;

  // ============================================================
  // 따라쓰기 캔버스 (칠하기)
  // ============================================================
  // 560이면 내림글자(j·g·y)의 어센더~디센더가 잘리지 않는다.
  const CANVAS_SIZE = 560;
  // preview 기준: 소문자 'a'가 타일 높이의 약 55%를 채운다.
  const GLYPH_FONT = '700 560px "SofiaProSoft", "Lexend", system-ui, sans-serif';
  const BASE_COLOR = "#fdfcf7";
  const FILL_COLOR = "#f5a623";
  const SAMPLE_STRIDE = 6;
  const BRUSH_RADIUS = 50;

  function createTrace(canvas) {
    const ctx = canvas.getContext("2d");
    const paint = doc.createElement("canvas");
    paint.width = CANVAS_SIZE;
    paint.height = CANVAS_SIZE;
    const paintCtx = paint.getContext("2d");
    const mask = doc.createElement("canvas");
    mask.width = CANVAS_SIZE;
    mask.height = CANVAS_SIZE;
    const maskCtx = mask.getContext("2d");

    const view = {
      glyph: "",
      samples: [],
      covered: null,
      filled: 0,
      total: 0,
      active: false,
      onProgress: null,
      lastPoint: null,
      offsetX: 0,
      offsetY: 0,
    };

    // textBaseline "middle"은 폰트 em 상자 기준이라 내림 공간까지 포함한다.
    // 그래서 S·A처럼 내림이 없는 글자는 위로 떠 보인다. 실제 글자 경계상자를
    // 재서 그만큼 밀어 타일 정중앙에 맞춘다.
    function drawGlyph(context, color) {
      context.save();
      context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      context.fillStyle = color;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = GLYPH_FONT;
      context.fillText(
        view.glyph,
        CANVAS_SIZE / 2 + view.offsetX,
        CANVAS_SIZE / 2 + view.offsetY,
      );
      context.restore();
    }

    function measureInk(data) {
      let minX = CANVAS_SIZE, minY = CANVAS_SIZE, maxX = -1, maxY = -1;
      for (let y = 0; y < CANVAS_SIZE; y += 2) {
        for (let x = 0; x < CANVAS_SIZE; x += 2) {
          if (data[(y * CANVAS_SIZE + x) * 4 + 3] > 128) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return maxX >= 0 ? { minX, minY, maxX, maxY } : null;
    }

    function buildSamples() {
      // 1차: 보정 없이 그려 실제 잉크 범위를 잰다.
      view.offsetX = 0;
      view.offsetY = 0;
      drawGlyph(maskCtx, "#000");
      const probe = measureInk(maskCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data);
      if (probe) {
        view.offsetX = CANVAS_SIZE / 2 - (probe.minX + probe.maxX) / 2;
        view.offsetY = CANVAS_SIZE / 2 - (probe.minY + probe.maxY) / 2;
      }
      // 2차: 가운데 맞춘 상태로 다시 그려 샘플·거리장을 만든다.
      drawGlyph(maskCtx, "#000");
      const data = maskCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
      const samples = [];
      for (let y = 0; y < CANVAS_SIZE; y += SAMPLE_STRIDE) {
        for (let x = 0; x < CANVAS_SIZE; x += SAMPLE_STRIDE) {
          const alpha = data[(y * CANVAS_SIZE + x) * 4 + 3];
          if (alpha > 128) samples.push(x, y);
        }
      }
      view.samples = samples;
      view.total = samples.length / 2;
      view.covered = new Uint8Array(view.total);
      view.filled = 0;
      // 글리프의 실제 경계상자(캔버스 대비 0~1). 획순 배지를 글자 위에 얹는 데 쓴다.
      if (view.total > 0) {
        let minX = CANVAS_SIZE, minY = CANVAS_SIZE, maxX = 0, maxY = 0;
        for (let i = 0; i < view.total; i += 1) {
          const x = samples[i * 2];
          const y = samples[i * 2 + 1];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        view.bbox = {
          x: minX / CANVAS_SIZE,
          y: minY / CANVAS_SIZE,
          w: Math.max(1, maxX - minX) / CANVAS_SIZE,
          h: Math.max(1, maxY - minY) / CANVAS_SIZE,
        };
      } else {
        view.bbox = { x: 0, y: 0, w: 1, h: 1 };
      }
    }

    function render() {
      drawGlyph(ctx, BASE_COLOR);
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      ctx.drawImage(paint, 0, 0);
      ctx.restore();
    }

    function stamp(x, y) {
      paintCtx.fillStyle = FILL_COLOR;
      paintCtx.beginPath();
      paintCtx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2);
      paintCtx.fill();
      const r2 = BRUSH_RADIUS * BRUSH_RADIUS;
      const s = view.samples;
      for (let i = 0; i < view.total; i += 1) {
        if (view.covered[i]) continue;
        const dx = s[i * 2] - x;
        const dy = s[i * 2 + 1] - y;
        if (dx * dx + dy * dy <= r2) {
          view.covered[i] = 1;
          view.filled += 1;
        }
      }
      if (typeof view.onStamp === "function") view.onStamp(x, y, BRUSH_RADIUS);
    }

    function paintSegment(x, y) {
      const last = view.lastPoint;
      if (last) {
        const dist = Math.hypot(x - last.x, y - last.y);
        const steps = Math.max(1, Math.floor(dist / (BRUSH_RADIUS / 2)));
        for (let step = 1; step <= steps; step += 1) {
          const t = step / steps;
          stamp(last.x + (x - last.x) * t, last.y + (y - last.y) * t);
        }
      } else {
        stamp(x, y);
      }
      view.lastPoint = { x, y };
      render();
      if (typeof view.onProgress === "function") {
        view.onProgress(coverageRatio(view.filled, view.total));
      }
    }

    function toCanvasPoint(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_SIZE / rect.width;
      const scaleY = CANVAS_SIZE / rect.height;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    // 이번에 "새로 누른" 획인지. 글자가 바뀌면 내려간다 —
    // 이 표시가 없으면 누르고 있던 클릭이 다음 글자로 그대로 이어져 멋대로 칠해진다.
    function pointerDown(event) {
      if (!view.active) return;
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      view.armed = true;
      view.lastPoint = null;
      const point = toCanvasPoint(event.clientX, event.clientY);
      paintSegment(point.x, point.y);
    }

    function pointerMove(event) {
      if (!view.active || !view.armed) return;
      if (event.buttons === 0 && view.lastPoint === null) return;
      const point = toCanvasPoint(event.clientX, event.clientY);
      paintSegment(point.x, point.y);
    }

    function pointerUp() {
      view.armed = false;
      view.lastPoint = null;
    }

    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("pointerleave", pointerUp);

    return {
      setLetter(glyph) {
        view.glyph = glyph;
        // 누르고 있던 손가락·마우스가 다음 글자까지 이어져 칠하지 않게 한다.
        // 다시 누를 때까지 입력을 받지 않는다.
        view.armed = false;
        view.lastPoint = null;
        paintCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        buildSamples();
        render();
      },
      enable(onProgress) {
        view.active = true;
        view.onProgress = onProgress;
      },
      // 붓이 닿는 순간을 획순 안내가 받아 본다(안내를 걷기 위해).
      onStamp(fn) { view.onStamp = fn; },
      disable() {
        view.active = false;
        view.armed = false;
        view.lastPoint = null;
      },
      fill() {
        // 완료 시 글자를 꽉 채운 상태로 보여준다.
        paintCtx.fillStyle = FILL_COLOR;
        paintCtx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        view.filled = view.total;
        if (view.covered) view.covered.fill(1);
        render();
      },
      ratio() { return coverageRatio(view.filled, view.total); },
      bbox() { return { ...(view.bbox || { x: 0, y: 0, w: 1, h: 1 }) }; },
    };
  }

  // ============================================================
  // 게임 진행
  // ============================================================
  let currentLetterIndex = 0;
  let letterRatios = [];

  // 진행 표시: 제공된 별 자산을 쓴다(start_basic=빈 별, start_active=채운 별).
  // 분홍 메모 "상시로 볼 수 있게 문항 수 표기" -> 별과 함께 n/N 숫자도 항상 보여준다.
  function buildProgress(total, done) {
    if (!el.gameProgress) return;
    el.gameProgress.setAttribute("aria-label", `문항 진행 ${done} / ${total}`);
    let stars = "";
    for (let i = 0; i < total; i += 1) {
      const filled = i < done;
      const src = filled ? "assets/game/start_active.png" : "assets/game/start_basic.png";
      stars += `<img class="progress-star${filled ? " is-filled" : ""}" src="${src}" alt="" draggable="false">`;
    }
    el.gameProgress.innerHTML = stars;
  }

  // 2차 수정(길이 거름을 걷음): 13칸(1632px)까지는 원래 크기로 들어간다. 그보다 긴 단어는 줄 폭이
  // 1690px(88cqw — 완성 단어와 같은 상한)을 넘지 않게 칸 · 간격 · 글자를 같은 비율로 줄인다.
  const SLOT_WIDTH_PX = 108;
  const SLOT_GAP_PX = 19;
  const LETTER_ROW_MAX_PX = 1690;
  function letterRowScale(count) {
    const width = count * SLOT_WIDTH_PX + Math.max(0, count - 1) * SLOT_GAP_PX;
    return width > LETTER_ROW_MAX_PX ? LETTER_ROW_MAX_PX / width : 1;
  }

  function renderLetterRow(letters, doneCount, currentIndex) {
    if (!el.letterRow) return;
    el.letterRow.innerHTML = "";
    el.letterRow.style.setProperty("--slot-scale", String(letterRowScale(letters.length)));
    letters.forEach((letter, index) => {
      const slot = doc.createElement("span");
      slot.className = "letter-slot";
      if (index < doneCount) slot.classList.add("is-done");
      else if (index === currentIndex) slot.classList.add("is-current");
      else slot.classList.add("is-pending");
      const glyph = doc.createElement("span");
      glyph.className = "letter-slot-glyph";
      glyph.textContent = letter;
      slot.appendChild(glyph);
      el.letterRow.appendChild(slot);
    });
  }

  // ---- 한글 글꼴 ----
  // 사장님 2026-10-02 "한글 표기는 전부 이걸 사용": 동봉 나눔스퀘어라운드 Bold(styles.css 의 @font-face).
  // 한 번만 요청하고 같은 약속을 돌려준다. 못 받아도(경로 · 네트워크) 게임은 대체 글꼴로 이어간다.
  const KOREAN_FONT = '700 1em "NanumSquareRound Game"';
  let koreanFontPromise = null;
  function loadKoreanFont() {
    if (!koreanFontPromise) {
      koreanFontPromise = doc.fonts && typeof doc.fonts.load === "function"
        ? doc.fonts.load(KOREAN_FONT, "가").catch(() => [])
        : Promise.resolve([]);
    }
    return koreanFontPromise;
  }

  // ---- 뜻 글자 맞춤 ----
  // 2차 수정(공통 "긴 글자 — 칸에 맞게 줄임, 단어는 빼지 않음"): 뜻 12자 거름을 걷었으니 긴 뜻은 간판 안에서 줄인다.
  // 한 줄을 먼저 시도하고(간판은 한 줄 판이다), 한 줄로는 MEANING_ONE_LINE_FLOOR 아래로 내려가야 하면 줄을 나눠 다시 맞춘다.
  // 판의 크기는 CSS 의 .meaning-text 패딩이 잡는다(top_panner_box.png 의 밝은 안쪽 판 21~129행).
  const MEANING_ONE_LINE_FLOOR = 0.6;
  const MEANING_MIN_SCALE = 0.2;
  const MEANING_SCALE_STEP = 0.02;

  function meaningFits(box, inner) {
    const style = global.getComputedStyle(box);
    const width = box.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
    const height = box.clientHeight - parseFloat(style.paddingTop || "0") - parseFloat(style.paddingBottom || "0");
    return inner.scrollWidth <= width + 0.5 && inner.getBoundingClientRect().height <= height + 0.5;
  }

  function fitMeaningText() {
    const inner = el.wordMeaning;
    const box = inner && inner.parentElement;
    if (!inner || !box || typeof global.getComputedStyle !== "function") return;
    box.classList.remove("is-wrapped");
    let scale = 1;
    box.style.setProperty("--meaning-scale", "1");
    while (scale > MEANING_ONE_LINE_FLOOR && !meaningFits(box, inner)) {
      scale = Math.round((scale - MEANING_SCALE_STEP) * 100) / 100;
      box.style.setProperty("--meaning-scale", String(scale));
    }
    if (!meaningFits(box, inner)) {
      box.classList.add("is-wrapped");
      scale = 1;
      box.style.setProperty("--meaning-scale", "1");
      while (scale > MEANING_MIN_SCALE && !meaningFits(box, inner)) {
        scale = Math.round((scale - MEANING_SCALE_STEP) * 100) / 100;
        box.style.setProperty("--meaning-scale", String(scale));
      }
    }
    centerMeaningInk(inner);
  }

  // 2차 수정(PDF 2쪽 "한글 문제 텍스트 세로 정렬 — 아래로 치우침"): 뜻은 운영체제 한글 글꼴로 그려진다
  // (맥 Apple SD Gothic Neo, 윈도우 Malgun Gothic). 예전 고정 보정 0.09em 은 맥 글꼴에서만 가운데였다 —
  // 이 맥에서 Nanum Gothic 으로 바꿔 재면 4px 아래로 처졌다. 그래서 실제로 그려질 글꼴로 잉크를 재서
  // 잉크 가운데를 줄 상자 가운데로 옮긴다. 잴 수 없으면 CSS 의 0.09em 이 그대로 남는다.
  function centerMeaningInk(inner) {
    const text = (inner.textContent || "").replace(/[^\p{L}\p{N}]/gu, "") || inner.textContent || "";
    if (!text) return;
    try {
      const style = global.getComputedStyle(inner);
      const context = doc.createElement("canvas").getContext("2d");
      if (!context) return;
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const m = context.measureText(text);
      const size = parseFloat(style.fontSize);
      const values = [m.fontBoundingBoxAscent, m.fontBoundingBoxDescent, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent];
      if (!size || !values.every(Number.isFinite)) return;
      const shift = (m.fontBoundingBoxDescent - m.fontBoundingBoxAscent) / 2
        + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      inner.style.setProperty("--meaning-shift", `${(shift / size).toFixed(4)}em`);
    } catch { /* 재지 못하면 CSS 기본값이 남는다 */ }
  }

  // 완성 단어: 최대 폭(88cqw)을 넘으면 넘지 않을 때까지 줄인다(2차 수정, 길이 거름을 걷음).
  function fitWordReveal() {
    const word = el.wordReveal;
    if (!word) return;
    word.style.setProperty("--reveal-scale", "1");
    let scale = 1;
    while (scale > 0.3 && word.scrollWidth > word.clientWidth + 0.5) {
      scale = Math.round((scale - 0.04) * 100) / 100;
      word.style.setProperty("--reveal-scale", String(scale));
    }
  }

  // 여우는 쓰는 동안 판 뒤에서 좌우로 나왔다 사라진다.
  // 좌/우 자세가 그림 두 장으로 나뉘어 있어 고르기만 하면 된다.
  let foxTimer = 0;

  function stopFox() {
    if (foxTimer) { global.clearTimeout(foxTimer); foxTimer = 0; }
    el.traceFoxes.forEach((fox) => fox.classList.remove("is-visible"));
  }

  function scheduleFox(firstDelay) {
    stopFox();
    // SHOW_FOX 가 꺼져 있으면 그림을 hidden 으로 내려 아예 그리지 않는다.
    el.traceFoxes.forEach((fox) => { fox.hidden = !SHOW_FOX; });
    if (!SHOW_FOX || el.traceFoxes.length === 0) return;
    const showOnce = () => {
      // 자세가 다른 그림 두 장 중 하나를 골라 가로로 밀어 낸다.
      // 회전도 좌우 반전도 없다 — 이동 하나뿐이다.
      const pick = el.traceFoxes[Math.random() < 0.5 ? 0 : el.traceFoxes.length - 1];
      el.traceFoxes.forEach((fox) => fox.classList.toggle("is-visible", fox === pick));
      const stay = 1600 + Math.random() * 1200;
      foxTimer = global.setTimeout(() => {
        pick.classList.remove("is-visible");
        const gap = 900 + Math.random() * 1100;
        foxTimer = global.setTimeout(showOnce, gap);
      }, stay);
    };
    foxTimer = global.setTimeout(showOnce, firstDelay);
  }

  // 획순 길안내를 그린다. 좌표는 자산 그대로이므로 계산이 없다.
  let strokeGuide = null;
  let advanceTimer = 0;

  function stopStrokeGuide() {
    if (strokeGuide) strokeGuide.stop();
  }

  function clearStrokeGuide() {
    if (app.trace && typeof app.trace.onStamp === "function") app.trace.onStamp(null);
    if (strokeGuide) { strokeGuide.destroy(); strokeGuide = null; }
    const group = doc.getElementById("stroke-order-paths");
    if (group) group.innerHTML = "";
  }

  // 획순 길안내의 동작은 stroke-guide.js 한 곳에 있다.
  // 편집기 미리보기가 같은 모듈을 쓰므로 한쪽만 고쳐져 어긋날 일이 없다.
  const StrokeGuide = global.SpellingBuilderStrokeGuide;

  function renderStrokeOrder(glyph) {
    const group = doc.getElementById("stroke-order-paths");
    if (!group || !StrokeGuide) return;
    clearStrokeGuide();
    const asset = TraceAssets && TraceAssets.letter(glyph);
    if (!asset || asset.strokes.length === 0) return;

    strokeGuide = StrokeGuide.create({
      doc,
      group,
      svg: doc.getElementById("stroke-order"),
      asset,
    });
    if (!strokeGuide) return;
    strokeGuide.start();

    // 붓이 처음 닿는 순간 안내를 걷는다.
    if (app.trace && typeof app.trace.onStamp === "function") {
      app.trace.onStamp(() => strokeGuide && strokeGuide.notePaint());
    }
  }

  function currentQuestion() {
    return app.questions[app.flow.index] || null;
  }

  function startLetter(index) {
    const question = currentQuestion();
    if (!question) return;
    currentLetterIndex = index;
    renderLetterRow(question.letters, index, index);
    app.trace.setLetter(question.letters[index]);
    renderStrokeOrder(question.letters[index]);
    app.trace.enable((ratio) => {
      letterRatios[index] = ratio;
      if (isLetterComplete(ratio, app.config.letterAdvanceRatio)) {
        completeLetter(index);
      }
    });
    announce(`${index + 1}번째 글자 ${question.letters[index]}를 따라 칠하세요.`);
  }

  function completeLetter(index) {
    const question = currentQuestion();
    if (!question) return;
    app.trace.disable();
    app.trace.fill();
    letterRatios[index] = 1;
    sfx.effect("success", 0.85);   // 철자 하나를 끝낼 때마다 같은 완성음
    if (index + 1 < question.letters.length) {
      renderLetterRow(question.letters, index + 1, index + 1);
      global.setTimeout(() => startLetter(index + 1), 320);
    } else {
      renderLetterRow(question.letters, question.letters.length, -1);
      global.setTimeout(completeWord, 260);
    }
  }

  function completeWord() {
    const question = currentQuestion();
    if (!question) return;
    const ratios = question.letters.map((_, index) => (letterRatios[index] ?? 0));
    const correct = isWordCorrect(ratios, app.config.wordCorrectRatio);
    app.flow.completeWord(correct);
    if (!correct) {
      // 미완성 단어는 결과 화면의 Incorrect Answers 목록에 남긴다.
      // 4차 q55: 목록은 스피커·단어·뜻 세 칸이라 채운 정도는 담지 않는다.
      app.wrongWords.push({
        english: question.letters.join(""),
        meaning: question.meaning,
        soundUrl: question.soundUrl,
      });
    }

    const word = question.letters.join("");
    if (el.wordReveal) {
      el.wordReveal.textContent = word;
      // 긴 단어는 판을 넘지 않도록 글자를 줄인다(형제와 같은 기준).
      el.wordReveal.classList.toggle("is-long", word.length > 9);
      fitWordReveal();
    }
    // 마지막 철자에서 completeLetter 가 이미 success 를 울렸다.
    // 여기서 또 울리면 260ms 간격으로 같은 소리가 두 번 나므로 등장음만 낸다.
    if (el.answerReveal) el.answerReveal.hidden = false;
    sfx.effect("show", 0.8);
    if (el.traceTile) el.traceTile.classList.add("is-revealing");
    clearStrokeGuide();
    if (app.trace) app.trace.disable();
    global.setTimeout(() => playSound(question.soundUrl), REVEAL_SOUND_MS);
    announce(`${word} 완성!`);
    advance(REVEAL_HOLD_MS);
  }

  // 단어를 보여 준 뒤 스스로 다음 문제로. 확인 버튼을 누르지 않는다.
  function advance(delayMs) {
    global.clearTimeout(advanceTimer);
    advanceTimer = global.setTimeout(() => {
      advanceTimer = 0;
      if (el.answerReveal) el.answerReveal.hidden = true;
      app.flow.advance();
      if (app.flow.isFinished()) { endGame(); return; }
      loadQuestion();
    }, delayMs);
  }

  function loadQuestion() {
    const question = currentQuestion();
    if (!question) { endGame(); return; }
    letterRatios = [];
    app.lastShownWord = question.english;
    if (el.wordMeaning) el.wordMeaning.textContent = question.meaning;
    fitMeaningText();
    if (el.answerReveal) el.answerReveal.hidden = true;
    if (el.wordReveal) el.wordReveal.textContent = "";
    if (el.traceTile) el.traceTile.classList.remove("is-revealing");
    buildProgress(app.flow.total, app.flow.progress().done);
    startLetter(0);
    // 검수 r13(2026-08-28): 문제가 나올 때는 발음을 내지 않는다.
    // 소리를 먼저 들려주면 철자를 맞히는 게 아니라 파닉스 받아쓰기가 된다.
    // 발음은 단어를 완성한 뒤 completeWord 에서만 재생한다.
  }


  function startGame() {
    app.round += 1;   // 11-3: 새 판이 열렸다 — 이전 판의 늦은 콜백은 여기서 무효가 된다.
    sfx.effect("open", 0.7);
    // 사양: 매 판마다 문제를 다시 뽑는다(두 번째 판이 첫 판과 같지 않도록).
    if (Content && typeof Content.rebuildQuestions === "function") {
      try {
        // 2차 수정(공통 "다시 시작"): 직전 판에 마지막으로 나온 단어로 새 판을 시작하지 않는다.
        const fresh = Content.rebuildQuestions({ avoidFirst: app.lastShownWord || "" });
        if (Array.isArray(fresh) && fresh.length > 0) {
          app.questions = fresh.slice(0, app.config.questionCount);
        }
      } catch { /* 재추첨 실패는 진행을 막지 않는다 */ }
    }
    app.flow = createGameFlow(app.questions.length || app.config.questionCount);
    app.wrongWords = [];
    currentLetterIndex = 0;
    showScreen("playScreen");
    syncGlobalControls("game");
    // 글자 마스크와 표시 글리프가 같은 폰트로 그려지도록 폰트 로드를 기다린다.
    scheduleFox(900);
    // 11-3(2026-09-30): 폰트를 기다리는 사이에 X 를 누르면 판은 닫혔는데 콜백이 뒤늦게 도착해
    // 시작 화면 위로 판을 되살린다. 열 때의 세대를 적어 두고, 그 사이 판이 다시 열렸거나
    // 닫혔으면(enableStart 가 세대를 올린다) 아무 일도 하지 않는다.
    const round = app.round;
    // 나눔 글꼴(2026-10-02): 뜻 글자는 한글 글꼴을 받은 뒤에 재야 한다(fitMeaningText · centerMeaningInk).
    // fonts.ready 는 "지금 받는 중인 것"만 기다려서, 아직 요청되지 않은 글꼴은 빠질 수 있다 — 따로 불러 함께 기다린다.
    const ready = Promise.all([
      doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve(),
      loadKoreanFont(),
    ]);
    ready.then(() => { if (app.round === round) loadQuestion(); });
  }

  // ============================================================
  // 결과
  // ============================================================

  // index.html 이 제목 그림에 달아 둔 ?v=... 를 한 번 읽어 둔다. 없으면 빈 문자열이다.
  let cachedAssetVersion = null;
  function assetVersion() {
    if (cachedAssetVersion === null) {
      const src = el.resultTitle ? el.resultTitle.getAttribute("src") || "" : "";
      const found = src.match(/\?v=[^"'&\s]+/);
      cachedAssetVersion = found ? found[0] : "";
    }
    return cachedAssetVersion;
  }

  function endGame() {
    const tally = app.flow.tally();
    sfx.stopBgm();   // 9-3: 결과화면에서는 배경음을 멈춘다(설정값은 그대로).
    // 결과 등급에 맞는 소리 — 형제와 같은 기준(전부 완성=환호, 절반 이상=도장, 그 외=실패).
    const ratio = tally.total > 0 ? tally.correct / tally.total : 0;
    const tier = resultTier(ratio);
    sfx.effect(tier === "excellent" ? "cheer" : tier === "good" ? "stamp" : "fail", 0.9);
    showResult(tally);
  }

  function showResult(tally) {
    if (el.resultScoreNumber) el.resultScoreNumber.textContent = String(tally.correct);
    if (el.resultTotalScore) el.resultTotalScore.setAttribute("aria-label", `완성한 단어 ${tally.correct}개`);
    // 2차 공통-2: 숫자 뒤 '개' 는 화면에서 뺀다(읽어 주는 이름에는 남긴다).
    if (el.resultCorrectPoints) {
      el.resultCorrectPoints.textContent = String(tally.correct);
      el.resultCorrectPoints.setAttribute("aria-label", `완성 ${tally.correct}개`);
    }
    // 따라쓰기는 틀리는 길이 없다(글자를 다 칠해야 넘어가고 끝나면 완성으로 기록된다) — Incorrect 는 숫자 대신
    // Bonus 처럼 '-' 로 둔다(사장님 2026-10-15 "incorrect 숫자 표현을 bonus처럼 해").
    if (el.resultIncorrectPoints) el.resultIncorrectPoints.textContent = "-";
    // 사양: 보너스 미적용. 공통 카드의 행은 유지하되 값은 미적용으로 표시한다.
    // 2차 공통-2 의 보너스 '점' 은 붙이지 않는다 — 점수 없는 방(사장님 2026-10-15 "권하신 대로").
    if (el.resultBonusPoints) el.resultBonusPoints.textContent = "-";
    if (el.resultTitle) {
      const ratio = tally.total > 0 ? tally.correct / tally.total : 0;
      // result_text0=Excellent, 1=Good, 2=Try Again (검수 3차 r10: 상단 제목의 대체 텍스트도 대문자 A)
      const titles = {
        excellent: { file: "result_text0", alt: "Excellent", fox: "excellent" },
        good: { file: "result_text1", alt: "Good", fox: "good" },
        tryAgain: { file: "result_text2", alt: "Try Again", fox: "try_again" },
      };
      const title = titles[resultTier(ratio)];
      // 7항(2026-09-29): 제목 그림은 여기서 이름을 지어 부르므로 index.html 의 링크와 달리
      // 캐시 버전이 빠진다. 3차 r10 으로 내용이 바뀐 result_text2.png 가 옛 그림으로 남는다.
      // 버전의 출처는 index.html 한 곳 — 첫 src 에 붙어 있는 값을 그대로 쓴다.
      el.resultTitle.src = `assets/result/${title.file}.png${assetVersion()}`;
      el.resultTitle.alt = title.alt;
      // 등급별 여우(2026-09-30 사장님 지시)도 같은 판정에서 고른다 —
      // 제목과 표정이 어긋나지 않도록 고르는 곳을 하나로 둔다.
      // 그림을 못 읽으면 깨진 아이콘 대신 아예 숨긴다(자산이 빠져도 결과화면은 멀쩡하게).
      if (el.resultFox) {
        el.resultFox.hidden = true;
        el.resultFox.onload = () => { el.resultFox.hidden = false; };
        el.resultFox.onerror = () => { el.resultFox.hidden = true; };
        el.resultFox.src = `assets/result/${title.fox}.png${assetVersion()}`;
      }
    }
    // 2차 공통-2: 하단 문구는 Spelling Builder 공통 문구로 통일한다.
    if (el.resultMessage) el.resultMessage.textContent = `${tally.total}문제 중 ${tally.correct}개를 맞혔어요!`;
    renderIncorrectAnswers();

    stopFox();
    clearStrokeGuide();
    showScreen("endScreen");
    syncGlobalControls("result");
    if (el.tryAgainButton) el.tryAgainButton.focus();
    // 2차 수정(공통 결과 화면): Try Again 일 때는 파티클이 없다(Good · Excellent 일 때만).
    if (resultTier(tally.total > 0 ? tally.correct / tally.total : 0) !== "tryAgain") runParticles();
    saveResult(tally.correct);
  }

  // 미완성 단어 목록.
  // 검수 4차 q58(2026-09-29 사장님 결정): 이 방은 타이머가 없어 미완성 단어가 생기지 않는다.
  // 결과화면의 Incorrect Answers 버튼을 없애고 남은 버튼만 가운데 세웠다(이 방에만 해당).
  // 팝업 자체는 남겨 둔다 — 줄 모양이 다른 방들이 맞춰 오는 기준이고, 버튼만 되살리면 다시 쓸 수 있다.
  function renderIncorrectAnswers() {
    const rows = app.wrongWords;
    if (!el.incorrectAnswerList) return;
    el.incorrectAnswerList.innerHTML = "";
    rows.forEach((row) => {
      const line = doc.createElement("div");
      line.className = "incorrect-answer-row incorrect-answer-grid";
      line.setAttribute("role", "row");

      const audio = doc.createElement("span");
      audio.setAttribute("role", "cell");
      if (row.soundUrl) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "incorrect-answer-audio";
        button.setAttribute("aria-label", `${row.english} 발음 듣기`);
        const icon = doc.createElement("img");
        icon.src = "assets/incorrect-answer/icon_speaker.png";
        icon.alt = "";
        icon.width = 37;
        icon.height = 30;
        button.appendChild(icon);
        button.addEventListener("click", () => playSound(row.soundUrl));
        audio.appendChild(button);
      }
      const english = doc.createElement("span");
      english.setAttribute("role", "cell");
      english.textContent = row.english;
      const meaning = doc.createElement("span");
      meaning.setAttribute("role", "cell");
      meaning.textContent = row.meaning;
      line.append(audio, english, meaning);
      el.incorrectAnswerList.appendChild(line);
    });
  }

  // 9-2: X 버튼은 이 저장이 끝난 뒤에 시작 화면으로 나간다. 그래서 약속을 남겨 둔다.
  function saveResult(score) {
    if (!Content) { app.savePromise = Promise.resolve(); return app.savePromise; }
    app.savePromise = Promise.resolve()
      .then(() => Content.saveHistory(score))
      // 4차 q51: 응답의 rank 는 받기만 하고 화면에는 쓰지 않는다(순위 미노출, 점수만).
      .catch(() => { /* 기록 저장 실패는 결과 화면을 막지 않는다 */ });
    return app.savePromise;
  }

  // 간단한 색종이 파티클 (결과 축하)
  function runParticles() {
    const canvas = el.resultParticleCanvas;
    if (!canvas || typeof canvas.getContext !== "function") return;
    const ctx = canvas.getContext("2d");
    const colors = ["#f5a623", "#7cc043", "#4aa3f0", "#f26d9c", "#ffd23f"];
    const pieces = Array.from({ length: 90 }, () => ({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height,
      size: 8 + Math.random() * 10,
      speed: 2 + Math.random() * 3,
      drift: -1 + Math.random() * 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      spin: Math.random() * Math.PI,
    }));
    let frame = 0;
    function tick() {
      if (!el.endScreen.classList.contains("is-visible")) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        p.y += p.speed;
        p.x += p.drift;
        p.spin += 0.1;
        if (p.y > canvas.height) p.y = -20;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });
      frame += 1;
      if (frame < 240) global.requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    global.requestAnimationFrame(tick);
  }

  // ============================================================
  // 모달 (결과 · 랭킹 · 도움말 공통 포커스 처리)
  // ============================================================
  function focusable(container) {
    return Array.from(container.querySelectorAll(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
    )).filter((node) => !node.hidden && !node.disabled);
  }

  function openModal(dialog, focusTarget) {
    if (!dialog) return;
    if (app.activeModal && app.activeModal !== dialog) closeModal(app.activeModal);
    app.lastFocus = doc.activeElement;
    dialog.hidden = false;
    app.activeModal = dialog;
    (focusTarget || dialog.querySelector("button"))?.focus();
  }

  function closeModal(dialog) {
    if (!dialog || dialog.hidden) return;
    dialog.hidden = true;
    if (app.activeModal === dialog) app.activeModal = null;
    const restore = app.lastFocus;
    if (restore && typeof restore.focus === "function" && doc.contains(restore)) restore.focus();
  }

  function onKeydown(event) {
    if (!app.activeModal) return;
    if (event.key === "Escape") { closeModal(app.activeModal); return; }
    if (event.key !== "Tab") return;
    const nodes = focusable(app.activeModal);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  // ============================================================
  // 도움말
  // ============================================================
  function openHelp() {
    showScreen("helpScreen");
    syncGlobalControls("help");
    loadHelp(false);
  }

  function loadHelp(retry) {
    if (!Content) return;
    setHelpStatus("도움말을 불러오는 중입니다.", false);
    Promise.resolve()
      .then(() => Content.getHelp({ retry }))
      .then((items) => renderHelp(items))
      .catch(() => setHelpStatus("도움말을 불러오지 못했습니다.", true));
  }

  function setHelpStatus(message, showRetry) {
    if (el.helpStatusMessage) el.helpStatusMessage.textContent = message;
    if (el.helpStatus) el.helpStatus.hidden = false;
    if (el.helpRetryButton) el.helpRetryButton.hidden = !showRetry;
  }

  // 형제 공통: help API가 주는 title/content를 section > h3 + p 로 그대로 뿌린다.
  // 클래스 이름(help-section / help-section-title / help-section-content)도 형제와 같다 —
  // 시안 규칙(첫 제목 주황, 이후 보라, 본문 검정)이 그 이름에 걸려 있다.
  function renderHelp(items) {
    if (!el.helpContent) return;
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) { setHelpStatus("도움말이 없습니다.", false); return; }
    const fragment = doc.createDocumentFragment();
    list.forEach((item) => {
      const section = doc.createElement("section");
      section.className = "help-section";
      if (item && item.title) {
        const title = doc.createElement("h3");
        title.className = "help-section-title";
        title.textContent = item.title;
        section.append(title);
      }
      if (item && item.content) {
        const content = doc.createElement("p");
        content.className = "help-section-content";
        content.textContent = item.content;
        section.append(content);
      }
      fragment.append(section);
    });
    el.helpContent.replaceChildren(fragment);
    if (el.helpStatus) el.helpStatus.hidden = true;
    const viewport = doc.querySelector(".help-content-viewport");
    if (viewport) viewport.scrollTop = 0;
  }

  // ============================================================
  // 부트스트랩
  // ============================================================
  function readConfig() {
    let trace = {};
    let closeUrl = "";
    try {
      const raw = doc.getElementById("gameConfig");
      const parsed = raw ? JSON.parse(raw.textContent) : {};
      trace = parsed && typeof parsed.trace === "object" ? parsed.trace : {};
      // 닫을 때 갈 주소(호스트가 정해 준다). 주소창의 close_url 이 우선한다.
      closeUrl = String(parsed?.deployment?.closeUrl || "");
    } catch { trace = {}; closeUrl = ""; }
    app.config = {
      questionCount: Number(trace.questionCount) || DEFAULTS.questionCount,
      letterAdvanceRatio: Number(trace.letterAdvanceRatio) || DEFAULTS.letterAdvanceRatio,
      wordCorrectRatio: Number(trace.wordCorrectRatio) || DEFAULTS.wordCorrectRatio,
      closeUrl,
    };
  }

  // ---- 시작 화면 동화 정보 ----
  // 2차 공통-9(사장님 2026-10-12 "동화API … 적용 배치는 시작화면 로고와 버튼 사이"): info 의 제목 · 부제목 두 줄.
  // 한 줄만 오면 그 줄만, 둘 다 없으면(테스트 모드 · 데모 · info 실패) 자리를 숨긴다 — 값을 지어 넣지 않는다.
  function renderStartStory(info) {
    if (!el.startStory || !el.startStoryTitle || !el.startStorySubtitle) return;
    const title = String(info?.title ?? "").trim();
    const subtitle = String(info?.subtitle ?? "").trim();
    el.startStoryTitle.textContent = title;
    el.startStorySubtitle.textContent = subtitle;
    el.startStoryTitle.hidden = !title;
    el.startStorySubtitle.hidden = !subtitle;
    el.startStory.hidden = !title && !subtitle;
  }

  // 길면 말줄임으로 자르지 않고 두 줄을 같은 배율로 줄인다(사장님이 OX 방에서 "글자가 길어지면 폰트 크기를 줄이게").
  // 바닥(0.5배)에서도 넘치면 그때만 CSS 의 말줄임이 남는다. 화면에 보일 때만 잴 수 있다.
  const STORY_MIN_SCALE = 0.5;
  const STORY_SCALE_STEP = 0.02;
  function fitStartStory() {
    const story = el.startStory;
    if (!story || story.hidden) return;
    const lines = [el.startStoryTitle, el.startStorySubtitle].filter((line) => line && !line.hidden);
    let scale = 1;
    story.style.setProperty("--start-story-scale", "1");
    while (scale > STORY_MIN_SCALE && lines.some((line) => line.scrollWidth > line.clientWidth)) {
      scale = Math.max(STORY_MIN_SCALE, Number((scale - STORY_SCALE_STEP).toFixed(2)));
      story.style.setProperty("--start-story-scale", String(scale));
    }
  }

  function onContentReady(snapshot) {
    app.launch = snapshot.launch;
    app.questions = snapshot.content.questions.slice(0, app.config.questionCount);
    if (app.questions.length === 0) { showLoadError("게임에 사용할 단어가 없습니다."); return; }
    renderStartStory(snapshot.content.info);
    enableStart();
    // 글꼴(SofiaProSoft · 한글 나눔)이 늦게 들어오면 폭이 바뀐다 — 둘 다 들어온 뒤 한 번 더 잰다.
    Promise.all([loadKoreanFont(), doc.fonts ? doc.fonts.ready : null])
      .catch(() => {})
      .then(() => { if (app.screen === "start") fitStartStory(); });
  }

  function enableStart() {
    app.round += 1;   // 11-3: 판을 떠났다 — 열려 있던 판의 늦은 콜백은 여기서 무효가 된다.
    sfx.preload();
    // 9-3: 결과화면에서 멈춰 둔 배경음을 설정대로 되돌린다(음소거면 그대로 꺼져 있다).
    sfx.applyMuted();
    global.clearTimeout(advanceTimer); advanceTimer = 0;
    stopFox();
    clearStrokeGuide();
    closeModal(el.incorrectAnswerDialog);
    showScreen("startScreen");
    syncGlobalControls("start");
    fitStartStory();
    if (el.startButton) { el.startButton.disabled = false; el.startButton.removeAttribute("aria-busy"); }
    if (el.helpButton) el.helpButton.disabled = false;
  }

  /* [앱 전용 자리] 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — LF 가 앱(Android · iOS)에 올릴 때 직접 작업한다. 지금은 비어 있다. 화면에 알림은 띄우지 않는다. */
  function closeAppWebView() {}

  // 시작 화면의 X. 호스트가 이벤트를 막으면 아무 일도 하지 않고, 아니면 앱 웹뷰 닫기 자리 → 창 닫기,
  // 창이 안 닫히면 정해진 주소 → 온 길 순으로 나간다(자세한 순서는 performClose · decideClose).
  function closeGame() {
    return performClose({
      dispatch: () => global.dispatchEvent(new global.CustomEvent("spellingbuilder:navigate", {
        detail: { screen: "close" },
        cancelable: true,
      })),
      closeApp: () => closeAppWebView(),
      decision: decideClose({
        href: global.location ? global.location.href : "",
        search: global.location ? global.location.search : "",
        configuredUrl: app.config.closeUrl,
        referrer: doc.referrer || "",
      }),
      navigate: (url) => { global.location.href = url; },
      back: () => global.history.back(),
      closeWindow: () => { try { global.close(); } catch { /* 닫을 수 없는 창이다 */ } },
      isClosed: () => Boolean(global.closed),
    });
  }

  function showLoadError(message) {
    showScreen("loadingScreen");
    if (el.loadingTitle) el.loadingTitle.textContent = "불러오기 실패";
    if (el.loadingMessage) el.loadingMessage.textContent = message;
    if (el.retryButton) el.retryButton.hidden = false;
  }

  function boot() {
    if (!Content) { showLoadError("게임 로더를 찾을 수 없습니다."); return; }
    showScreen("loadingScreen");
    if (el.loadingTitle) el.loadingTitle.textContent = "게임 준비 중";
    if (el.loadingMessage) el.loadingMessage.textContent = "단어와 게임 정보를 불러오고 있습니다.";
    if (el.retryButton) el.retryButton.hidden = true;
    Content.bootstrap({ force: true })
      .then((snapshot) => onContentReady(snapshot))
      .catch((error) => showLoadError(error?.message || "게임 데이터를 불러오지 못했습니다."));
  }

  // ---- 이벤트 배선 ----
  function wireEvents() {
    app.trace = createTrace(el.traceCanvas);

    // 어떤 조작이든 첫 클릭이면 배경음을 깨운다(브라우저 자동재생 제한 때문).
    el.stage?.addEventListener("click", () => sfx.startBgm(), { capture: true });
    el.startButton?.addEventListener("click", () => sfx.effect("touch", 0.7), { capture: true });
    el.startButton?.addEventListener("click", startGame);
    el.helpButton?.addEventListener("click", openHelp);
    el.helpRetryButton?.addEventListener("click", () => loadHelp(true));


    // 결과 화면: 다시 하기 두 곳(우상단 리플레이 · Try Again)은 같은 동작이다.
    el.tryAgainButton?.addEventListener("click", startGame);
    // 9-2: 우상단은 다시 시작이 아니라 나가기다. 점수 저장이 끝난 뒤 시작 화면으로 돌아간다.
    el.resultCloseButton?.addEventListener("click", () => {
      Promise.resolve(app.savePromise).catch(() => {}).then(() => enableStart());
    });
    el.incorrectAnswerCloseButton?.addEventListener("click", () => closeModal(el.incorrectAnswerDialog));
    el.incorrectAnswerBackdrop?.addEventListener("click", () => closeModal(el.incorrectAnswerDialog));

    // 랭킹 팝업(id: result-dialog)

    el.soundButton?.addEventListener("click", () => setMuted(!app.muted));
    el.navigationButton?.addEventListener("click", () => {
      if (app.screen === "help") { enableStart(); return; }
      if (app.screen === "game") { enableStart(); return; }
      // 시작 화면: 호스트에게 알리고, 막지 않으면 실제로 나간다.
      closeGame();
    });
    el.retryButton?.addEventListener("click", boot);

    doc.addEventListener("keydown", onKeydown);

    doc.addEventListener("spellingbuilder:content-state", () => {});
  }

  // 개발용 획순 감사 훅. ?guide_audit=1 일 때만 노출한다(배포 동작에는 영향 없음).
  // 52자 전부의 안내선을 게임을 진행하지 않고 확인할 수 있다.
  function installAuditHook() {
    const params = new URLSearchParams(global.location?.search || "");
    if (params.get("guide_audit") !== "1") return;
    global.__spellingBuilderGuideAudit = {
      show(glyph) {
        showScreen("playScreen");
        app.trace.setLetter(glyph);
        renderStrokeOrder(glyph);
        const asset = TraceAssets && TraceAssets.letter(glyph);
        return { bbox: app.trace.bbox(), strokes: asset ? asset.strokes.length : 0 };
      },
    };
  }

  function init() {
    readConfig();
    // 트레이스 글리프 폰트를 미리 로드(페이지 진입 시점)해 시작 시 마스크 불일치를 막는다.
    if (doc.fonts && typeof doc.fonts.load === "function") {
      try {
        doc.fonts.load('700 360px "SofiaProSoft"');
        doc.fonts.load('700 60px "Lexend"');
        loadKoreanFont();
      } catch { /* noop */ }
    }
    wireEvents();
    installAuditHook();
    setMuted(false);
    boot();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
