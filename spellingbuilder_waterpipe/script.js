(function initSpellingBuilderWaterpipe(global) {
  "use strict";

  // ============================================================
  // 순수 로직 (DOM/Canvas 없이 동작 · Node 테스트 대상)
  // ============================================================

  // 기획서(스펙 이미지) 수치. index.html gameConfig가 덮어쓸 수 있다.
  const RULES = Object.freeze({
    questionCount: 12,   // 총 12문제
    chances: 3,          // 한 문제 기회 3번
    decoyCount: 2,       // 오답 철자는 정답 철자 +2개씩 배치
    letterScore: 50,     // 정답 +50
    missPenalty: 10,     // 오답 -10
    wrongChanceCost: 1,  // 순서를 틀리게 클릭 -> 기회 1 차감
    /* 2차 검수 공통-6(사장님 2026-10-12 "오답일 경우 3번의 기회 준 후 모두 틀리면 넘어가게"): 오답 철자도 기회 1 만 깎는다.
       예전 2 였을 때는 오답 철자 한 번 + 순서 틀림 한 번, 2번 만에 다음 문제로 넘어갔다(검수표 "2회 틀린 경우 다음 문제로"). */
    decoyChanceCost: 1,  // 오답 철자를 클릭 -> 기회 1 차감
    streakLength: 3,     // 3문제 연속 정답마다
    streakBonus: 100,    // 추가 +100
    timerSeconds: 210,   // 타이머 3분 30초
  });

  /* 파이프 슬롯 13곳 — 시안(docs/프리뷰_슬롯위치.png)에서 방울 중심을 검출한
     1920x1080 좌표다. 세로 파이프 중심(482 · 1430)에 좌우 열을 맞췄다.
     pipe.png의 보석 장식(960,331 · 960,762 · 482,539 · 1434,539)은 방울이
     놓이지 않은 곳에서 그대로 보인다. */
  const SLOTS = Object.freeze([
    Object.freeze({ x: 482, y: 325 }),
    Object.freeze({ x: 719, y: 325 }),
    Object.freeze({ x: 956, y: 325 }),
    Object.freeze({ x: 1193, y: 325 }),
    Object.freeze({ x: 1430, y: 325 }),
    Object.freeze({ x: 482, y: 539 }),
    Object.freeze({ x: 1430, y: 539 }),
    Object.freeze({ x: 482, y: 747 }),
    Object.freeze({ x: 719, y: 747 }),
    Object.freeze({ x: 898, y: 747 }),
    Object.freeze({ x: 1077, y: 747 }),
    Object.freeze({ x: 1256, y: 747 }),
    Object.freeze({ x: 1430, y: 747 }),
  ]);

  const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

  function shuffled(list, random) {
    const pool = list.slice();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool;
  }

  // 오답 철자: 단어에 없는 알파벳에서 뽑는다 — 정답과 같은 글자면
  // "순서에 맞는 클릭"과 구분할 수 없기 때문이다.
  function pickDecoyLetters(letters, count, random = Math.random) {
    const used = new Set(letters);
    const candidates = [...ALPHABET].filter((letter) => !used.has(letter));
    return shuffled(candidates, random).slice(0, Math.max(0, count));
  }

  // 한 문제의 방울 배치: 정답 철자(순서 없이) + 오답 철자를 랜덤 슬롯에 놓는다.
  // 슬롯 수(13)를 넘으면 오답 철자부터 줄인다.
  function buildRound(letters, options = {}) {
    const random = options.random || Math.random;
    const slotCount = options.slotCount || SLOTS.length;
    const wanted = Number.isFinite(options.decoyCount) ? options.decoyCount : RULES.decoyCount;
    if (!Array.isArray(letters) || letters.length === 0 || letters.length > slotCount) {
      throw new Error(`방울에 올릴 철자는 1~${slotCount}개여야 합니다.`);
    }
    const decoyCount = Math.min(wanted, slotCount - letters.length);
    const decoys = pickDecoyLetters(letters, decoyCount, random);
    const bubbles = [
      ...letters.map((letter) => ({ letter, isDecoy: false })),
      ...decoys.map((letter) => ({ letter, isDecoy: true })),
    ];
    const slotIndexes = shuffled(Array.from({ length: slotCount }, (_, i) => i), random)
      .slice(0, bubbles.length);
    return shuffled(bubbles, random).map((bubble, position) => ({
      ...bubble,
      slotIndex: slotIndexes[position],
    }));
  }

  /* 한 문제의 판정 상태 머신.
     - 순서에 맞는 정답 철자: 진행(+1). 남은 철자가 없으면 완료.
     - 순서가 틀린 정답 철자: 기회 1 차감.
     - 오답(단어에 없는) 철자: 기회 1 차감(2차 검수 공통-6 — 예전에는 2).
     - 기회를 다 쓰면 실패(failed) — 정답 노출 후 다음 문제로 강제 전환. */
  function createQuestionRun(letters, rules = RULES) {
    let nextIndex = 0;
    let missCount = 0;
    let failed = false;
    return {
      get nextIndex() { return nextIndex; },
      get nextLetter() { return letters[nextIndex] ?? null; },
      get missCount() { return missCount; },
      get failed() { return failed; },
      get completed() { return !failed && nextIndex >= letters.length; },
      chancesLeft() { return Math.max(0, rules.chances - missCount); },
      tap(letter, isDecoy = false) {
        if (failed || nextIndex >= letters.length) {
          return { type: "ignored" };
        }
        if (!isDecoy && letter === letters[nextIndex]) {
          nextIndex += 1;
          return {
            type: "correct",
            collectedCount: nextIndex,
            completed: nextIndex >= letters.length,
          };
        }
        missCount += isDecoy ? rules.decoyChanceCost : rules.wrongChanceCost;
        failed = missCount >= rules.chances;
        return {
          type: "wrong",
          isDecoy,
          chancesLeft: Math.max(0, rules.chances - missCount),
          failed,
        };
      },
    };
  }

  // 점수판: 정답 +50, 오답 -10(0점 아래로는 내려가지 않는다),
  // 3문제 연속 정답마다 +100 보너스. 실패하면 연속이 끊긴다.
  function createScoreboard(rules = RULES) {
    let score = 0;
    let streak = 0;
    let bonusTotal = 0;
    return {
      get score() { return score; },
      get streak() { return streak; },
      get bonusTotal() { return bonusTotal; },
      letterCorrect() {
        score += rules.letterScore;
        return score;
      },
      miss() {
        // 검수 q61: 0점에서도 마이너스로 내려가야 한다(하한 없음).
        score -= rules.missPenalty;
        return score;
      },
      wordComplete() {
        streak += 1;
        const bonusAwarded = rules.streakLength > 0 && streak % rules.streakLength === 0
          ? rules.streakBonus
          : 0;
        if (bonusAwarded > 0) {
          score += bonusAwarded;
          bonusTotal += bonusAwarded;
        }
        return { score, streak, bonusAwarded };
      },
      wordFail() {
        streak = 0;
      },
    };
  }

  // 문항 진행/정오 집계.
  function createGameFlow(totalQuestions) {
    const total = Math.max(1, Math.trunc(totalQuestions) || 1);
    let index = 0;
    let correct = 0;
    let incorrect = 0;
    const results = [];
    return {
      total,
      get index() { return index; },
      get correct() { return correct; },
      get incorrect() { return incorrect; },
      currentNumber() { return Math.min(index + 1, total); },
      isFinished() { return index >= total; },
      completeWord(isCorrect = true) {
        if (index >= total) return;
        if (results[index] !== undefined) return;
        results[index] = Boolean(isCorrect);
        if (isCorrect) correct += 1;
        else incorrect += 1;
      },
      advance() {
        if (index < total) index += 1;
        return index;
      },
      tally() { return { correct, incorrect, total, results: results.slice() }; },
    };
  }

  // 전체 게임 카운트다운. now(ms)를 밖에서 넣어 순수하게 검사할 수 있다.
  function createCountdown(totalSeconds) {
    const totalMs = Math.max(0, totalSeconds) * 1000;
    let deadline = null;
    return {
      start(nowMs) { deadline = nowMs + totalMs; },
      remainingSeconds(nowMs) {
        if (deadline === null) return Math.ceil(totalMs / 1000);
        return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
      },
      isExpired(nowMs) { return deadline !== null && nowMs >= deadline; },
    };
  }

  /* 리워드 제공 기준(사장님 지시 2026-09-29, 12개 방 공통)
       Try again  정답률 70% 미만
       Good       70% 이상 100% 미만   ← 표에 비어 있던 70~71% 구간은 Good 으로 확정받음
       Excellent  100%
     분모는 "전체 제공 문제수"다 — 시간이 끝나 손도 못 댄 문제도 들어간다.
     경계는 이 상수 하나뿐이니, 기준이 바뀌면 여기만 고친다. */
  const REWARD_GOOD_MIN = 0.7;

  /* 결과화면 Incorrect 는 오답노트와 같은 기준이다 — 오답노트 줄 수(2차 검수 공통-10).
     2차 검수 SB공통-1(사장님 2026-10-15): 3번 모두 틀려 기회를 다 쓴 문제만 센다. 시간이 끝날 때 풀던 문제 ·
     손도 못 댄 문제는 Incorrect 에도 오답노트에도 들지 않는다(예전 검수 q58 기준을 바꿈). 결과 문구 "N문제 중 M개" 와
     등급 분모(5항)는 그대로 전체 제공 문제수다. 숫자는 showResult 가 오답노트 목록에서 바로 센다. */

  /* 2차 공통 1절 · 사장님(파이프 2차 "한 판 시간 API 우선, 없으면 지금 값"):
     API info 의 play_time 을 먼저 쓴다. 값이 없거나 숫자가 아니거나 0 이하면 "시간을 주지 않은 것"으로 보고
     지금 값(gameConfig 의 timerSeconds, 210초)을 쓴다. 상한 · 하한은 두지 않는다 — 잘못된 값은 API 쪽에서 고친다. */
  function resolveTimerSeconds(playTime, fallback) {
    if (playTime === null || playTime === undefined || playTime === "" || typeof playTime === "boolean") return fallback;
    const given = Number(playTime);
    return Number.isFinite(given) && given > 0 ? given : fallback;
  }

  function rewardGrade(correct, total) {
    const asked = Math.max(0, Math.trunc(total) || 0);
    if (asked <= 0) return "try_again";
    const ratio = Math.max(0, Math.trunc(correct) || 0) / asked;
    if (ratio >= 1) return "excellent";
    if (ratio >= REWARD_GOOD_MIN) return "good";
    return "try_again";
  }

  const REWARD_VIEW = {
    excellent: { image: "result_text0", alt: "Excellent", sound: "cheer", character: "excellent" },
    good: { image: "result_text1", alt: "Good", sound: "stamp", character: "good" },
    try_again: { image: "result_text2", alt: "Try again", sound: "fail", character: "try_again" },
  };

  function formatClock(seconds) {
    const safe = Math.max(0, Math.trunc(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  /* 표기 규칙(검수 r7·r52): 화면에 보이는 영어 단어는 모두 소문자다.
     2026-08-28에는 첫 글자를 대문자로 쓰기로 했으나, 검수표 r52
     "정답란에 단어 첫 알파벳이 대문자로 변경되어요. 단어 전체는 소문자로"
     에 따라 사장님 승인을 받아 되돌렸다. */
  /* 닫기 이동에 쓸 주소인지 본다. 같은 사이트일 때만 돌려준다.
     origin 비교만으로는 모자라다 — file:// 에서는 어떤 주소든 origin 이 "null" 이라
     javascript:·data:·//evil.example 이 전부 통과한다(검수는 file:// 로 돈다).
     그래서 프로토콜과 호스트까지 같은지 보고, 쓸 수 있는 프로토콜만 받는다. */
  const CLOSE_PROTOCOLS = Object.freeze(["http:", "https:", "file:"]);

  /* 주소창으로 들어온 닫기 주소는 배포 루트(게임 폴더의 부모) 아래로만 보낸다.
     모음 페이지(../index.html)는 그 안이고, ../../etc/passwd 나 file:///etc/passwd 는 밖이다.
     gameConfig 의 closeUrl 은 납품본에 박힌 값이라 이 제한을 걸지 않는다(사장님 결정). */
  /* 지금 화면을 가리키는 주소는 쓰지 않는다. 그런 값을 "갈 곳을 찾았다"로 치면
     뒤 갈래도 건너뛰어 X 가 아무 일도 안 하거나, 같은 판을 다시 띄운다.
     조각(#)만 지우는 것으로는 모자랐다 — 기준 주소에 ?close_url=... 이 붙어 있으면
     "index.html" 은 쿼리가 달라 다른 주소로 보이는데 같은 화면을 다시 띄운다(재현 확인).
     그래서 경로만 견준다(사장님 결정). 폴더로 끝나는 주소는 그 폴더의 index.html 로
     눕혀 봐야 "./" 가 새지 않는다. 호스트는 이 앞의 sameOriginUrl 이 이미 묶는다. */
  function documentPath(url) {
    return url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  }

  function leavesCurrentDocument(href, baseHref) {
    if (!href || !baseHref) return false;
    try {
      return documentPath(new URL(href)) !== documentPath(new URL(baseHref));
    } catch {
      return false;
    }
  }

  function withinDeployRoot(href, baseHref) {
    if (!href || !baseHref) return false;
    try {
      return String(href).startsWith(new URL("../", baseHref).href);
    } catch {
      return false;
    }
  }

  function sameOriginUrl(value, baseHref) {
    const text = String(value ?? "").trim();
    if (!text || !baseHref) return null;
    try {
      const base = new URL(baseHref);
      const url = new URL(text, baseHref);
      if (!CLOSE_PROTOCOLS.includes(url.protocol)) return null;
      if (url.protocol !== base.protocol) return null;
      if (url.host !== base.host) return null;
      if (url.origin !== base.origin) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function displayWord(letters) {
    const word = Array.isArray(letters) ? letters.join("") : String(letters ?? "");
    return word.toLocaleLowerCase("en-US");
  }

  const PureLogic = Object.freeze({
    RULES,
    SLOTS,
    pickDecoyLetters,
    buildRound,
    createQuestionRun,
    createScoreboard,
    createGameFlow,
    createCountdown,
    formatClock,
    rewardGrade,
    resolveTimerSeconds,
    REWARD_GOOD_MIN,
    displayWord,
    sameOriginUrl,
    withinDeployRoot,
    leavesCurrentDocument,
    documentPath,
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

  /* 검수 4차 7항: 여기서 조립하는 주소에도 index.html 과 같은 캐시 버전을 붙인다.
     result_text2.png 는 3차 r10 으로 내용이 바뀐 파일인데, 버전 없이 나가면
     아이 브라우저에 옛 그림이 그대로 남는다. 버전은 이 스크립트 주소에서 가져온다. */
  const ASSET_QUERY = (() => {
    const own = doc.currentScript && doc.currentScript.getAttribute("src");
    const fromScript = own ? own.split("?")[1] : "";
    if (fromScript) return fromScript;
    const title = doc.getElementById("result-title");
    const fromTitle = title ? (title.getAttribute("src") || "").split("?")[1] : "";
    return fromTitle || "";
  })();

  function versionedAsset(path) {
    return ASSET_QUERY ? `${path}?${ASSET_QUERY}` : path;
  }


  const Content = global.SpellingBuilderContent;

  // 형제 공통 흐름: 완성(또는 실패)하면 단어를 크게 띄우고 사운드를 들려준 뒤
  // 스스로 다음 문제로 넘어간다. 확인 버튼은 없다.
  const REVEAL_SOUND_MS = 320;   // 단어가 뜨고 발음이 나오기까지
  const REVEAL_HOLD_MS = 2000;   // 완성 단어를 보여 주는 시간
  const FAIL_HOLD_MS = 2400;     // 정답 노출(실패)을 보여 주는 시간
  const FLY_MS = 300;            // 철자가 트레이로 날아가는 시간
  const STAGE_WIDTH = 1920;      // 무대 설계 좌표(px). 1cqw = 19.2px.

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
    startStory: doc.getElementById("start-story"),
    startStoryTitle: doc.getElementById("start-story-title"),
    startStorySubtitle: doc.getElementById("start-story-subtitle"),
    helpButton: doc.getElementById("help-button"),

    helpScreen: doc.getElementById("help-screen"),
    helpContent: doc.getElementById("help-content"),
    helpStatus: doc.getElementById("help-status"),
    helpStatusMessage: doc.getElementById("help-status-message"),
    helpRetryButton: doc.getElementById("help-retry-button"),

    playScreen: doc.getElementById("play-screen"),
    gameStatus: doc.getElementById("game-status"),
    wordMeaning: doc.getElementById("word-meaning-text"),
    pipeSlots: doc.getElementById("pipe-slots"),
    answerSlots: doc.getElementById("answer-slots"),
    scoreValue: doc.getElementById("score-value"),
    scorePanel: doc.querySelector(".score-panel"),
    questionProgress: doc.getElementById("question-progress"),
    timerValue: doc.getElementById("timer-value"),
    wordReveal: doc.getElementById("word-reveal"),
    answerReveal: doc.getElementById("answer-reveal"),

    // 결과는 화면(end-screen)이다 — 형제 공통.
    endScreen: doc.getElementById("end-screen"),
    resultTitle: doc.getElementById("result-title"),
    resultCharacter: doc.getElementById("result-character"),
    resultScoreNumber: doc.getElementById("result-score-number"),
    resultTotalScore: doc.getElementById("result-total-score"),
    resultCorrectPoints: doc.getElementById("result-correct-points"),
    resultIncorrectPoints: doc.getElementById("result-incorrect-points"),
    resultBonusPoints: doc.getElementById("result-bonus-points"),
    resultMessage: doc.getElementById("result-message"),
    resultReplayButton: doc.getElementById("result-replay-button"),
    resultParticleCanvas: doc.getElementById("result-particle-canvas"),
    tryAgainButton: doc.getElementById("try-again-button"),
    incorrectAnswersButton: doc.getElementById("incorrect-answers-button"),

    // 오답 목록 팝업
    incorrectAnswerDialog: doc.getElementById("incorrect-answer-dialog"),
    incorrectAnswerBackdrop: doc.getElementById("incorrect-answer-backdrop"),
    incorrectAnswerCloseButton: doc.getElementById("incorrect-answer-close-button"),
    incorrectAnswerList: doc.getElementById("incorrect-answer-list"),

  };

  // ---- 실행 상태 ----
  const app = {
    rules: { ...RULES },
    launch: null,
    questions: [],
    flow: null,
    scoreboard: null,
    run: null,            // 현재 문제의 판정 상태 머신
    countdown: null,
    locked: true,         // 리빌/전환 중 방울 입력 잠금
    muted: false,
    audio: null,
    lastFocus: null,
    activeModal: null,
    screen: "loading",
    wrongWords: [],
    wrongIndexes: new Set(),
    solvedIndexes: new Set(),
    savePending: null,
    exiting: false,
    generation: 0,
    closeUrl: "",
    configTimerSeconds: RULES.timerSeconds,   // gameConfig 값 — API play_time 이 없을 때 쓰는 "지금 값"
    lastWord: "",          // 앞 판에서 마지막으로 화면에 나와 있던 단어(다시 시작 규칙)
    particleRun: 0,        // 결과 파티클 세대 — 새 결과가 뜨면 앞 파티클은 그 자리에서 멈춘다
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

  // 형제 공통 계약: sound·navigation은 start / help / game 에서 보인다.
  function syncGlobalControls(screen) {
    const visible = screen === "start" || screen === "help" || screen === "game";
    /* 2차 공통 1절(OX 기준): 도움말 화면에서만 X 를 없애고 왼쪽 위(스피커 자리)에 ← 뒤로가기를 둔다.
       도움말 화면의 스피커는 숨긴다. 시작 · 게임 화면은 그대로다(스피커 왼쪽 · X 오른쪽, 검수 r12).
       뒤로가기는 따로 버튼을 만들지 않고 같은 버튼을 왼쪽으로 옮겨 그림만 바꾼다(.is-back). */
    const isHelp = screen === "help";
    if (el.soundButton) el.soundButton.hidden = !visible || isHelp;
    if (el.navigationButton) {
      el.navigationButton.hidden = !visible;
      el.navigationButton.classList.toggle("is-back", isHelp);
      el.navigationButton.setAttribute(
        "aria-label",
        screen === "start" ? "게임 닫기" : isHelp ? "뒤로 가기" : "시작 화면으로 돌아가기",
      );
    }
    // index.html 이 받은 주소와 같게 버전을 붙인다 — 버전 없이 넣으면 같은 그림을 두 주소로 다시 받는다.
    if (el.navigationIcon) {
      el.navigationIcon.src = versionedAsset(isHelp ? "assets/btn_back.png" : "assets/btn_close.png");
    }
    app.screen = screen;
  }

  // ---- 사운드 ----
  /* 효과음 — 형제와 같은 방식. 같은 소리가 겹칠 수 있으므로 재생할 때마다 복제한다. */
  const sfx = (function createSfx() {
    /* 판정 효과음은 성공·실패 두 가지만 쓴다(사용자 확정).
       show는 판정음이 아니라 단어가 크게 뜰 때의 등장음이다. */
    const EFFECTS = {
      touch: "assets/sound/touch.mp3",           // 버튼 누름
      open: "assets/sound/open.mp3",             // 게임 시작
      show: "assets/sound/show.mp3",             // 정답 단어 등장(완성·실패 공용)
      success: "assets/sound/success.mp3",       // 정답 철자 터치
      wrong: "assets/sound/fail.mp3",            // 오답: 띵~ 효과음
      cheer: "assets/sound/yeah.mp3",            // 결과 - 잘함
      stamp: "assets/sound/stamp.mp3",           // 결과 - 보통
      fail: "assets/sound/fail.mp3",             // 결과 - 아쉬움
    };
    // 배경음: morning_blocks (사용자 확정). 효과음 아래에 깔린다.
    const BGM_SRC = "assets/sound/bgm/morning_blocks.mp3";
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
      preload() { Object.values(EFFECTS).forEach(clip); },
      effect(name, volume) { return playSrc(EFFECTS[name], volume); },
      // 브라우저가 사용자의 조작 없이는 소리를 못 틀게 하므로 첫 클릭 때 불러 준다.
      startBgm() {
        bgmWanted = true;
        if (app.muted) return;
        /* 공통 9-3: 결과화면에서는 어느 길로 들어와도 배경음을 틀지 않는다 —
           무대 클릭, 소리 다시 켜기(setMuted -> applyMuted), 어느 쪽이든 여기를 지난다.
           bgmWanted 는 그대로 두므로 시작 화면으로 돌아가면 설정대로 다시 난다. */
        if (app.screen === "result") return;
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
      /* 공통 9-3: 결과화면에서만 멈춘다. bgmWanted·app.muted 는 건드리지 않으므로
         시작 화면으로 돌아가 applyMuted() 를 부르면 원래 설정대로 다시 난다. */
      stopBgm() {
        if (bgmAudio) { try { bgmAudio.pause(); } catch { /* noop */ } }
      },
      applyMuted() {
        if (app.muted) { if (bgmAudio) { try { bgmAudio.pause(); } catch { /* noop */ } } }
        else if (bgmWanted) this.startBgm();
      },
    };
  })();

  // 회원(게스트·데모가 아닌)에게만 문제 시작 발음을 들려준다 — 형제와 같다.
  function isLoggedInMember() {
    const launch = app.launch;
    return Boolean(launch && !launch.isGuest && !launch.isDemo);
  }

  /* 2차 공통 1절 '소리 끈 상태'(OX 사장님 답): 소리를 꺼도 아이가 직접 누른 발음은 난다(force).
     이 방에서 직접 누르는 발음은 오답노트 스피커뿐이다 — 문제에는 발음 버튼이 없다(검수 r13).
     단어를 완성하거나 정답이 공개될 때 저절로 나는 발음은 소리를 끄면 나지 않는다. */
  function playSound(url, options = {}) {
    if (!url || (app.muted && !options.force)) return;
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
  // 파이프 방울 렌더링
  // ============================================================
  const cqw = (px) => `${(px / STAGE_WIDTH) * 100}cqw`;

  /* 형제(write) 규칙 '글자 배치': textBaseline "middle"은 폰트 em 상자 기준이라
     내림이 없는 글자는 위로 뜨고 어센더 글자는 아래로 처져 보인다. 그래서
     글자마다 실제 잉크 경계상자를 캔버스로 실측해 그 중심을 상자 정중앙에
     맞춘다(write는 이 방식으로 52자 중심 오차 2px 이내).
     오프셋은 em 단위로 캐시하므로 화면 크기와 무관하게 맞는다. */
  const inkOffsetCache = new Map();

  // 문자열의 잉크 경계상자를 재서 중앙까지의 오프셋을 em 단위로 돌려준다.
  function measureInkOffset(text, fontCss, canvasW, canvasH, fontPx) {
    const key = `${fontCss}|${text}`;
    if (inkOffsetCache.has(key)) return inkOffsetCache.get(key);
    let offset = { x: 0, y: 0 };
    try {
      const canvas = doc.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, canvasW, canvasH);
      ctx.fillStyle = "#000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = fontCss;
      ctx.fillText(text, canvasW / 2, canvasH / 2);
      const data = ctx.getImageData(0, 0, canvasW, canvasH).data;
      let minX = canvasW;
      let minY = canvasH;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < canvasH; y += 1) {
        for (let x = 0; x < canvasW; x += 1) {
          if (data[(y * canvasW + x) * 4 + 3] > 128) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= 0) {
        offset = {
          x: (canvasW / 2 - (minX + maxX) / 2) / fontPx,
          y: (canvasH / 2 - (minY + maxY) / 2) / fontPx,
        };
      }
      /* 글꼴이 아직 실리지 않았으면 이 값은 대체 글꼴로 잰 것이다 — 이번에는 쓰되 캐시에는 남기지 않는다.
         남기면 글꼴이 실린 뒤에도 같은 글자는 끝까지 대체 글꼴 기준으로 맞춰진다(나눔 글꼴 적용 2026-10-02). */
      const settled = !doc.fonts || typeof doc.fonts.check !== "function" || doc.fonts.check(fontCss, text);
      if (settled) inkOffsetCache.set(key, offset);
    } catch { /* 측정 실패 시 기본 정렬(오프셋 0)로 둔다 */ }
    return offset;
  }

  const GLYPH_MEASURE = { canvas: 160, font: 112 };

  function measureGlyphOffset(glyph) {
    return measureInkOffset(
      glyph,
      `700 ${GLYPH_MEASURE.font}px "SofiaProSoft", "Lexend", sans-serif`,
      GLYPH_MEASURE.canvas,
      GLYPH_MEASURE.canvas,
      GLYPH_MEASURE.font,
    );
  }

  function centerGlyph(node, glyph) {
    const o = measureGlyphOffset(glyph);
    node.style.transform = `translate(${o.x.toFixed(4)}em, ${o.y.toFixed(4)}em)`;
  }

  /* 뜻 패널의 한글도 같은 방식으로 맞춘다 — 한글 글리프는 라인박스 중앙보다
     위에 앉아 판 중앙에서 떠 보인다(사용자 보고). 문자열 잉크를 실측해 내린다. */
  const MEANING_MEASURE = { w: 1024, h: 192, font: 64 };
  /* 화면(.meaning-text 의 --korean-stack)과 같은 글꼴로 잰다 — 다른 글꼴로 재면 그 차이만큼 세로가 어긋난다.
     사장님 2026-10-02 "한글 표기는 전부 나눔스퀘어 라운드 bold". 굵기도 CSS(700)와 같아야 한다. */
  const KOREAN_FONT_FAMILY = '"NanumSquareRound Game", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';

  function centerMeaningText(node, text) {
    if (!node) return;
    const o = measureInkOffset(
      text,
      `700 ${MEANING_MEASURE.font}px ${KOREAN_FONT_FAMILY}`,
      MEANING_MEASURE.w,
      MEANING_MEASURE.h,
      MEANING_MEASURE.font,
    );
    node.style.transform = `translate(${o.x.toFixed(4)}em, ${o.y.toFixed(4)}em)`;
  }

  /* 한글 글꼴이 실리기를 기다린다. 요청 자체는 로딩 화면의 한글을 그릴 때 CSS 가 건다 — 여기서는 그 요청이
     끝나는 약속을 init 에서 한 번 만들어 두고, 첫 문제를 깔기 전에 기다린다(startGame) — 뜻 칸 맞춤 · 잉크 가운데
     맞춤이 대체 글꼴로 잰 값으로 남지 않게. 못 받아도(경로 오류 등) 판은 연다.
     "가" 를 넘겨야 한글이 들어 있는 이 글꼴을 실제로 받는다(글자를 안 주면 받지 않을 수 있다). */
  const KOREAN_FONT = '700 1em "NanumSquareRound Game"';
  /* 사장님 답(2026-10-02, 부모 방 directive-log 51번 — 워터파이프만): 느린 망에서는 한글 글꼴을 최대 8초 기다린다
     (축구 방과 같은 한도). 그동안 로딩 문구는 숨기고(스피너는 돈다) Start 는 열지 않는다. 8초가 넘거나 받기가
     실패하면(404 · 망 오류) 더 기다리지 않고 대체 글꼴로 연다 — 글꼴 하나 때문에 Start 가 잠기지 않게. */
  const KOREAN_FONT_WAIT_MS = 8000;
  /* 한도는 페이지를 연 때부터 8초인 마감 하나다 — 로딩 문구의 CSS 대비(8초 애니메이션)와 같은 기준이고,
     로딩과 첫 판이 나눠 쓴다. 반박 검토 실측: init 부터 재면 스크립트가 늦게 오는 망에서 JS 마감이 CSS 보다 늦어
     CSS 가 먼저 문구를 대체 글꼴로 드러냈다(1.6Mbps 에서 9.5~17.1초). 판마다 따로 재면 8초 뒤 Start 를 누른
     첫 판이 아직 받는 중인 글꼴을 또 8초 기다려 빈 판이 이어졌다(12초 늦춤). */
  const SCRIPT_STARTED_AT = Date.now();
  function pageElapsedMs() {
    const perf = global.performance;
    return perf && typeof perf.now === "function" ? perf.now() : Date.now() - SCRIPT_STARTED_AT;
  }
  function capFontWait(promise) {
    let timer = 0;
    const left = Math.max(0, KOREAN_FONT_WAIT_MS - pageElapsedMs());
    const cap = new Promise((resolve) => { timer = global.setTimeout(() => resolve([]), left); });
    return Promise.race([Promise.resolve(promise).catch(() => []), cap]).finally(() => global.clearTimeout(timer));
  }
  let koreanFontPromise = null;
  function loadKoreanFont() {
    if (!koreanFontPromise) {
      let load;
      try {
        load = doc.fonts && typeof doc.fonts.load === "function" ? doc.fonts.load(KOREAN_FONT, "가") : Promise.resolve([]);
      } catch { load = Promise.resolve([]); }
      /* 한도(8초)가 지난 뒤에 글꼴이 오면, 그사이 대체 글꼴 폭으로 맞춘 뜻 칸을 이 글꼴로 다시 맞춘다
         (반박 검토 실측: 9초에 오면 뜻이 칸을 13~27px 넘어 끝 글자가 잘렸다). 받기 실패면 할 일이 없다. */
      Promise.resolve(load).then(() => refitShownMeaning(), () => {});
      koreanFontPromise = capFontWait(load).then((faces) => {
        // 받았든 못 받았든 기다림은 끝났다 — 숨겨 둔 로딩 문구를 보인다(styles.css 의 korean-font-ready).
        doc.documentElement?.classList.add("korean-font-ready");
        return faces;
      });
    }
    return koreanFontPromise;
  }

  /* 판에 쓰는 영어 글꼴(방울 · 트레이 · 점수 · 시간 — --latin-stack 의 SofiaProSoft, 빠진 글자는 Lexend).
     사장님 답(2026-10-02 15:27, 부모 방 directive-log 55번 — 워터파이프만): Start 는 이 글꼴도 한글 글꼴과 같은
     8초 마감(페이지 연 때부터) 안에서 기다린다. 하나가 못 와도(404 · 망 오류) 나머지를 기다리고, 판은 연다. */
  const GAME_FONTS = ['700 64px "SofiaProSoft"', '700 60px "Lexend"'];
  let gameFontsPromise = null;
  function loadGameFonts() {
    if (!gameFontsPromise) {
      const loads = GAME_FONTS.map((font) => {
        try {
          return doc.fonts && typeof doc.fonts.load === "function" ? Promise.resolve(doc.fonts.load(font)).catch(() => []) : Promise.resolve([]);
        } catch { return Promise.resolve([]); }
      });
      gameFontsPromise = capFontWait(Promise.all(loads));
    }
    return gameFontsPromise;
  }

  // 게임 중 보이는 뜻 칸을 지금 글꼴로 다시 맞춘다(글꼴이 한도 뒤에 왔을 때).
  function refitShownMeaning() {
    if (app.screen !== "game" || !el.wordMeaning) return;
    const question = currentQuestion();
    if (question) fitMeaning(el.wordMeaning.parentElement, el.wordMeaning, question.meaning);
  }

  /* 2차 수정(공통 1절 '긴 글자', 공통 4절): 뜻 길이 거름을 걷어 아주 긴 뜻(검수 API 최장 87자)이 들어온다.
     서버가 준 그대로 위 칸에 맞게 줄인다 — 단어는 빼지 않는다. 수치는 형제 블록 방과 같다.
       ① 기본 크기(54px)로 한 줄에 들어가면 그대로 둔다
       ② 아니면 한 줄에 들어갈 때까지 줄이되 32px(min) 아래로는 내리지 않는다
       ③ 32px 로도 한 줄에 안 들어가면 줄을 바꾸고, 칸 높이를 넘으면 16px(floor)까지 더 줄인다
     "두 줄이면 넉넉" 같은 가정은 거름이 있을 때만 맞는다(블록은 87자 뜻이 4줄이 되어 테두리를 덮었다).
     그래서 줄을 바꾼 뒤에는 실제 높이를 재서 칸 안에 들어올 때까지 줄인다. */
  const MEANING_FONT = Object.freeze({ base: 2.8125, min: 1.6667, floor: 0.8333 });
  // 판의 글자 칸(pannel.png 판 영역 높이 130px) 안에서 위아래로 남길 여백(px, 1920 기준).
  const MEANING_MARGIN = 4;

  function fitMeaning(holder, inner, text) {
    if (!holder || !inner) return;
    holder.style.fontSize = "";
    holder.style.whiteSpace = "";
    inner.style.transform = "";
    const box = holder.getBoundingClientRect();
    if (!(box.width > 0)) { centerMeaningText(inner, text); return; }
    const width = () => inner.getBoundingClientRect().width;
    const setSize = (cqwValue) => { holder.style.fontSize = `${cqwValue.toFixed(4)}cqw`; };
    // ① 한 줄 · 기본 크기
    if (width() <= box.width) { centerMeaningText(inner, text); return; }
    // ② 한 줄 · 줄여서
    let size = Math.max(MEANING_FONT.min, MEANING_FONT.base * (box.width / width()));
    setSize(size);
    let guard = 0;
    while (width() > box.width && size > MEANING_FONT.min && guard < 20) {
      size = Math.max(MEANING_FONT.min, size - 0.05);
      setSize(size);
      guard += 1;
    }
    if (width() <= box.width) { centerMeaningText(inner, text); return; }
    // ③ 여러 줄 — 잉크 보정은 한 줄일 때만 맞으므로 여러 줄은 칸 가운데 정렬(grid)에 맡긴다.
    holder.style.whiteSpace = "normal";
    // 여백은 1920 기준 px 이므로 지금 무대 폭에 맞춰 환산한다.
    const stageWidth = el.stage ? el.stage.getBoundingClientRect().width : STAGE_WIDTH;
    const maxHeight = box.height - MEANING_MARGIN * 2 * ((stageWidth || STAGE_WIDTH) / STAGE_WIDTH);
    let shrink = 0;
    while (inner.getBoundingClientRect().height > maxHeight && size > MEANING_FONT.floor && shrink < 120) {
      size = Math.max(MEANING_FONT.floor, size - 0.05);
      setSize(size);
      shrink += 1;
    }
  }

  /* slot_on/off.png(237x237)는 광택·그림자까지 담고 있고 방울 몸통(129px 원)의
     중심은 자산 (119,106)에 있다. 몸통 원을 히트 영역(버튼)으로 쓰고, 광택은
     pointer-events 없는 <img>로 밑에 깐다 — 이웃 슬롯 간격(179px)보다 자산이
     커서(237px), 버튼을 자산 크기로 만들면 서로를 덮기 때문이다. */
  const SLOT_ART = Object.freeze({ size: 237, coreX: 119, coreY: 106, coreSize: 129 });

  function buildSlotElements() {
    if (!el.pipeSlots) return [];
    el.pipeSlots.innerHTML = "";
    return SLOTS.map((slot, index) => {
      const holder = doc.createElement("div");
      holder.className = "pipe-slot";
      holder.style.left = cqw(slot.x - SLOT_ART.coreX);
      holder.style.top = cqw(slot.y - SLOT_ART.coreY);
      holder.hidden = true;

      const art = doc.createElement("img");
      art.className = "pipe-slot-art";
      art.src = versionedAsset("assets/game/slot_on.png");
      art.alt = "";
      art.draggable = false;

      const core = doc.createElement("button");
      core.type = "button";
      core.className = "pipe-slot-core";
      core.dataset.slotIndex = String(index);
      const glyph = doc.createElement("span");
      glyph.className = "pipe-slot-letter";
      core.appendChild(glyph);

      holder.append(art, core);
      el.pipeSlots.appendChild(holder);
      return { holder, art, core, glyph };
    });
  }

  let slotEls = [];
  let bubbleBySlot = new Map(); // slotIndex -> {letter, isDecoy, collected}

  function renderRound(bubbles) {
    bubbleBySlot = new Map();
    slotEls.forEach((slotEl, index) => {
      const bubble = bubbles.find((item) => item.slotIndex === index) || null;
      slotEl.holder.hidden = !bubble;
      slotEl.holder.classList.remove("is-empty", "is-shaking", "is-bursting");
      slotEl.art.src = versionedAsset("assets/game/slot_on.png");
      if (bubble) {
        bubbleBySlot.set(index, { ...bubble, collected: false });
        slotEl.glyph.textContent = bubble.letter;
        centerGlyph(slotEl.glyph, bubble.letter);
        slotEl.core.disabled = false;
        slotEl.core.setAttribute("aria-label", `철자 ${bubble.letter}`);
      } else {
        slotEl.glyph.textContent = "";
        slotEl.core.disabled = true;
        slotEl.core.removeAttribute("aria-label");
      }
    });
  }

  function emptySlot(index) {
    const slotEl = slotEls[index];
    if (!slotEl) return;
    slotEl.holder.classList.add("is-empty");
    slotEl.art.src = versionedAsset("assets/game/slot_off.png");
    slotEl.glyph.textContent = "";
    slotEl.core.disabled = true;
  }

  /* 같은 연출을 잇달아 낼 때 애니메이션을 되감는다(형제 block과 같은 방식).
     requestAnimationFrame 으로 미루면 프레임이 돌지 않는 환경(백그라운드 탭)에서
     콜백이 오지 않아 연출이 조용히 사라진다. offsetWidth 를 읽어 리플로를 그
     자리에서 강제하면 항상 즉시 다시 시작된다. */
  function restartAnimation(node, className) {
    if (!node) return;
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }

  const flashTimers = new Map();
  const FLASH_CLASSES = ["is-correct-flash", "is-wrong-flash"];

  // 판정 순간 화면 전체에 잠깐 빛을 입힌다(정답 초록 · 오답 빨강).
  function flashField(className, ms) {
    if (!el.playScreen) return;
    /* 두 플래시는 같은 ::before 를 쓴다. 정답 직후 오답을 누르면 앞 플래시가
       아직 남아 있어, 클래스만 더하면 애니메이션이 되감기지 않고 이어져
       타이밍과 색이 어긋난다. 반대쪽 플래시를 먼저 걷어 항상 처음부터 재생한다. */
    FLASH_CLASSES.forEach((name) => {
      if (name === className) return;
      global.clearTimeout(flashTimers.get(name));
      flashTimers.delete(name);
      el.playScreen.classList.remove(name);
    });
    global.clearTimeout(flashTimers.get(className));
    restartAnimation(el.playScreen, className);
    flashTimers.set(className, global.setTimeout(() => {
      el.playScreen.classList.remove(className);
      flashTimers.delete(className);
    }, ms));
  }

  // 오답이면 파이프와 방울이 함께 한 번 흔들린다.
  let joltTimer = 0;
  function joltStage() {
    if (!el.playScreen) return;
    global.clearTimeout(joltTimer);
    restartAnimation(el.playScreen, "is-jolted");
    joltTimer = global.setTimeout(() => {
      el.playScreen.classList.remove("is-jolted");
      joltTimer = 0;
    }, 420);
  }

  // 정답 방울: 밝게 터지며 링이 퍼진다. 철자는 그 사이 트레이로 날아간다.
  const BURST_MS = 520;
  function burstSlot(index) {
    const slotEl = slotEls[index];
    if (!slotEl) return;
    restartAnimation(slotEl.holder, "is-bursting");
    global.setTimeout(() => slotEl.holder.classList.remove("is-bursting"), BURST_MS);
  }

  const SHAKE_MS = 380; // bubbleShake 키프레임 길이와 같게 유지한다
  function shakeSlot(index) {
    const slotEl = slotEls[index];
    if (!slotEl) return;
    restartAnimation(slotEl.holder, "is-shaking");
    // 흔들림이 끝나면 클래스를 걷는다 — 남겨 두면 상태가 부정확해진다.
    global.setTimeout(() => slotEl.holder.classList.remove("is-shaking"), SHAKE_MS);
  }

  /* ---- 정답 트레이 (검수 r51) ----
     동그라미 칩을 늘어놓던 방식은 긴 단어에서 하단이 꽉 차 몇 글자짜리인지
     가늠하기 어려웠다. 이제 문제가 나오는 순간 철자 수만큼 밑줄을 깔아 두고,
     모은 철자를 그 위에 하나씩 앉힌다. */
  let collected = [];

  // 문제 시작: 철자 수만큼 빈 밑줄을 깐다.
  function buildSlots(count) {
    collected = [];
    if (!el.answerSlots) return;
    el.answerSlots.innerHTML = "";
    for (let index = 0; index < count; index += 1) {
      const slot = doc.createElement("span");
      slot.className = "answer-slot";
      const glyph = doc.createElement("span");
      glyph.className = "answer-slot-letter";
      slot.appendChild(glyph);
      el.answerSlots.appendChild(slot);
    }
  }

  // 철자가 도착한 칸만 채운다 — 전체를 다시 그리면 앞 글자까지 다시 튄다.
  function fillSlot(letter) {
    const index = collected.length;
    collected.push(letter);
    const slot = el.answerSlots && el.answerSlots.children[index];
    if (!slot) return;
    // 검수 r52: 정답란의 영어 단어는 모두 소문자다.
    slot.firstChild.textContent = letter.toLocaleLowerCase("en-US");
    restartAnimation(slot, "is-filled");
  }

  // 철자가 날아가 앉을 칸의 무대 좌표(1920x1080 기준).
  function slotTargetPoint(index) {
    const fallback = { x: 960, y: 931 };
    const box = el.answerSlots && el.answerSlots.children[index];
    if (!el.stage || !box || typeof box.getBoundingClientRect !== "function") return fallback;
    const stageRect = el.stage.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    if (!stageRect.width) return fallback;
    const scale = STAGE_WIDTH / stageRect.width;
    return {
      x: (boxRect.left + boxRect.width / 2 - stageRect.left) * scale,
      y: (boxRect.top + boxRect.height / 2 - stageRect.top) * scale,
    };
  }

  /* 방울에서 트레이로 철자가 날아간다. 무대 좌표(cqw)로 움직여 스케일과 무관하다.
     목적지는 판정이 알려 준 자리(targetIndex)로 받는다 — 아이가 비행(300ms)보다
     빠르게 연타하면 아직 채워지지 않은 칸 수로는 목적지가 한 칸 뒤처진다. */
  function flyLetter(slotIndex, letter, targetIndex, done) {
    const play = el.playScreen;
    const slot = SLOTS[slotIndex];
    if (!play || !slot) { done(); return; }
    const flyer = doc.createElement("span");
    flyer.className = "fly-letter";
    const glyph = doc.createElement("span");
    glyph.className = "fly-letter-glyph";
    glyph.textContent = letter;
    centerGlyph(glyph, letter);
    flyer.appendChild(glyph);
    flyer.style.left = cqw(slot.x);
    flyer.style.top = cqw(slot.y);
    play.appendChild(flyer);
    // 그 철자가 앉을 밑줄 칸으로 곧장 날아간다.
    const target = slotTargetPoint(targetIndex);
    global.requestAnimationFrame(() => {
      flyer.style.left = cqw(target.x);
      flyer.style.top = cqw(target.y);
      flyer.style.transform = "translate(-50%, -50%) scale(0.72)";
      flyer.style.opacity = "0.25";
    });
    global.setTimeout(() => { flyer.remove(); done(); }, FLY_MS);
  }

  // ============================================================
  // 게임 진행
  // ============================================================
  let advanceTimer = 0;
  let timerInterval = 0;

  function currentQuestion() {
    return app.questions[app.flow.index] || null;
  }

  let scoreShown = 0;
  let scoreTween = 0;
  let scoreTweenFallback = 0;

  /* 검수 q59: 1,000점을 넘으면 천단위 콤마를 붙인다(마이너스도 -1,010 처럼).
     Math.round 는 -0.3 을 -0 으로 만들고 (-0).toLocaleString() 은 "-0" 이라,
     마이너스에서 0 으로 굴러 올라올 때 화면에 "-0" 이 찍힌다 — 0 으로 눕힌다. */
  function formatScore(value) {
    const rounded = Math.round(Number(value) || 0);
    return (rounded === 0 ? 0 : rounded).toLocaleString("en-US");
  }

  function renderScore(value) {
    if (!el.scoreValue) return;
    const text = formatScore(value);
    el.scoreValue.textContent = text;
    // aria-label 이 내용을 가리므로 읽히는 이름에도 값을 담는다(형제 실로폰과 같은 방식).
    el.scoreValue.setAttribute("aria-label", `점수 ${text}`);
  }

  // 애니메이션 없이 즉시 맞춘다(판 시작·결과 복구용).
  function updateScore() {
    if (scoreTween) { global.cancelAnimationFrame(scoreTween); scoreTween = 0; }
    // 함정목록 3: 굴림을 멈출 때 폴백도 함께 무효화한다. 남기면 옛 점수가 되살아난다.
    global.clearTimeout(scoreTweenFallback);
    scoreTweenFallback = 0;
    scoreShown = app.scoreboard ? app.scoreboard.score : 0;
    renderScore(scoreShown);
  }

  // 점수가 오르내리는 것을 눈으로 좇을 수 있게 숫자를 굴린다(형제 block과 같은 방식).
  function animateScore(target) {
    const to = Math.trunc(Number(target) || 0);
    const from = scoreShown;
    if (from === to) return;
    if (scoreTween) global.cancelAnimationFrame(scoreTween);
    /* 함정목록 3: 새 굴림을 시작하기 전에 옛 폴백을 반드시 끈다. 남겨 두면
       굴림 도중 재시작할 때 0을 찍은 뒤 옛 점수가 되살아나고,
       0.2초 간격 연속 득점에서 숫자가 한 프레임 되돌아간다. */
    global.clearTimeout(scoreTweenFallback);
    const startedAt = Date.now();
    const span = Math.min(720, 280 + Math.abs(to - from) * 2);
    // 프레임이 돌지 않는 환경(백그라운드 탭 등)에서도 최종 점수는 반드시 찍는다.
    scoreTweenFallback = global.setTimeout(() => {
      scoreTweenFallback = 0;
      if (scoreShown === to) return;
      scoreShown = to;
      renderScore(to);
      if (scoreTween) { global.cancelAnimationFrame(scoreTween); scoreTween = 0; }
    }, span + 120);
    const step = () => {
      const ratio = Math.min(1, (Date.now() - startedAt) / span);
      const eased = 1 - Math.pow(1 - ratio, 3);
      scoreShown = from + (to - from) * eased;
      renderScore(scoreShown);
      if (ratio < 1) {
        scoreTween = global.requestAnimationFrame(step);
        return;
      }
      scoreShown = to;
      renderScore(to);
      scoreTween = 0;
      global.clearTimeout(scoreTweenFallback);
      scoreTweenFallback = 0;
    };
    scoreTween = global.requestAnimationFrame(step);
  }

  function bumpScoreCard() {
    restartAnimation(el.scoreValue, "is-bumping");
  }

  /* 얻거나 잃은 점수(철자마다 +50 · -10)를 Score 카드 위로 띄워 보낸다. 연속 보너스는 playScoreBonus 가 그린다. */
  function floatScoreDelta(delta) {
    if (!delta || !el.scorePanel) return;
    const node = doc.createElement("span");
    node.className = `score-delta ${delta > 0 ? "is-plus" : "is-minus"}`;
    // 공통 10항: 점수 값은 어느 자리든 같은 서식을 거친다(지금 값은 ±10·+50 이라 화면은 그대로).
    node.textContent = `${delta > 0 ? "+" : ""}${formatScore(delta)}`;
    el.scorePanel.appendChild(node);
    global.setTimeout(() => node.remove(), 1100);
  }

  /* 연속 보너스 효과 — 사장님(2026-10-02) "단어미로(Star) 보너스 효과를 이 방 테마에 맞게 적용".
     단어미로와 같은 짜임으로, 정답 공개와 같은 순간에 한꺼번에 돈다.
       ① 점수 굴림(animateScore — 평소와 같음)
       ② Score 판째 정답 덮개(.answer-reveal) 위로 올린다 — 사장님 "점수판째 올림"(10-02 "숫자만 올림"을 바꿈)
       ③ 카드 둘레로 물방울 고리가 퍼진다 — 사장님 "물방울 하늘색 고리"(이 방 방울 터짐과 같은 흰빛 하늘색)
       ④ 점수 숫자가 크게 튀었다 돌아온다 — 사장님 "크기만, 색은 그대로"
       ⑤ "보너스 +100" 글자가 카드 위에서 흔들리며 자리 잡고 떠올라 사라진다 — 사장님 "보너스 +100"
     올림은 정답 덮개가 걷힐 때(다음 문제 · 새 판 · 시작 화면) clearScoreBonus 가 함께 내린다.
     효과음은 없다(전용 효과음 쓰지 않음 — 사용자 확정, 단어미로도 없음). */
  const BONUS_EFFECT_MS = 1100;
  let scoreBonusTimer = 0;
  function playScoreBonus(amount) {
    if (!el.scorePanel) return;
    clearScoreBonus();
    // 마지막 철자의 +50 이 같은 자리에서 아직 떠오르는 중이면 보너스 글자와 겹친다 — 보너스가 그 자리를 넘겨받는다.
    el.scorePanel.querySelectorAll(".score-delta").forEach((node) => node.remove());
    el.scorePanel.classList.add("is-bonus-lift");
    /* 마지막 철자의 범프(.is-bumping)가 숫자에 남아 있으면, 1.1초 뒤 is-combo 를 뗄 때 범프가 다시 돌아 숫자가
       한 번 더 튄다(반박 검토 실측 — 점수는 그대로인데 덮개 위에서 1.18배). 펀치가 그 자리를 넘겨받는다. */
    el.scoreValue?.classList.remove("is-bumping");
    restartAnimation(el.scorePanel, "is-combo");
    const label = doc.createElement("span");
    label.className = "score-delta is-bonus";
    label.setAttribute("aria-hidden", "true");   // 읽어주기는 announce 가 한다
    label.textContent = `보너스 +${formatScore(amount)}`;
    el.scorePanel.appendChild(label);
    scoreBonusTimer = global.setTimeout(() => {
      scoreBonusTimer = 0;
      el.scorePanel.classList.remove("is-combo");
      label.remove();
    }, BONUS_EFFECT_MS);
  }

  function clearScoreBonus() {
    global.clearTimeout(scoreBonusTimer);
    scoreBonusTimer = 0;
    if (!el.scorePanel) return;
    el.scorePanel.classList.remove("is-combo", "is-bonus-lift");
    el.scorePanel.querySelectorAll(".score-delta.is-bonus").forEach((node) => node.remove());
  }

  /* 2차 공통 4절: 판을 새로 열거나 떠날 때 앞 판의 떠오르는 점수 · 날아가던 철자 · 방울 연출을 걷는다.
     지우는 예약(1.1초 · 0.3초)을 기다리면 새 판 0점 위에 앞 판 "+50 · +100" 이 떠다닌다(반박 검토 실측). */
  function clearGameEffects() {
    clearScoreBonus();
    /* 앞 판 점수 범프(.is-bumping)를 뗀다 — 남겨 두면 게임 화면이 다시 보일 때 애니메이션이 다시 돌아 새 판 "0" 이
       한 번 튄다(사장님 답 "고침", 부모 방 directive-log 59번). 판 중 범프는 bumpScoreCard 가 매번 다시 건다. */
    el.scoreValue?.classList.remove("is-bumping");
    if (el.playScreen) {
      el.playScreen.querySelectorAll(".score-delta, .fly-letter").forEach((node) => node.remove());
    }
    slotEls.forEach((slotEl) => slotEl.holder.classList.remove("is-bursting", "is-shaking"));
  }

  function updateProgress() {
    if (el.questionProgress && app.flow) {
      el.questionProgress.textContent = `${app.flow.currentNumber()}/${app.flow.total}`;
    }
  }

  /* 2차 공통 2절(게임 화면, OX 기준): 남은 10초부터 시간 숫자가 빨갛게 깜박이고 5초부터는 더 빠르다.
     is-urgent = 10~5초, is-critical = 5~0초. 화면 가장자리 붉은 빛은 넣지 않는다.
     이 방에는 타임바가 없어 숫자만 해당한다. 판이 끝나면 stopTimer 가 둘 다 뗀다. */
  function updateTimerDisplay() {
    if (!el.timerValue) return;
    const remaining = app.countdown ? app.countdown.remainingSeconds(Date.now()) : app.rules.timerSeconds;
    el.timerValue.textContent = formatClock(remaining);
    const running = Boolean(app.countdown);
    el.timerValue.classList.toggle("is-urgent", running && remaining > 5 && remaining <= 10);
    el.timerValue.classList.toggle("is-critical", running && remaining > 0 && remaining <= 5);
  }

  function stopTimer() {
    if (timerInterval) { global.clearInterval(timerInterval); timerInterval = 0; }
    el.timerValue?.classList.remove("is-urgent", "is-critical");
  }

  function startTimer() {
    stopTimer();
    app.countdown = createCountdown(app.rules.timerSeconds);
    app.countdown.start(Date.now());
    updateTimerDisplay();
    timerInterval = global.setInterval(() => {
      updateTimerDisplay();
      // 사양: 시간이 끝나면 엔딩 페이지로 이동한다(문제 중간이어도).
      if (app.countdown.isExpired(Date.now())) {
        stopTimer();
        global.clearTimeout(advanceTimer); advanceTimer = 0;
        if (el.answerReveal) el.answerReveal.hidden = true;
        endGame();
      }
    }, 250);
  }

  function onSlotTap(event) {
    if (app.locked || !app.run) return;
    const index = Number(event.currentTarget.dataset.slotIndex);
    const bubble = bubbleBySlot.get(index);
    if (!bubble || bubble.collected) return;

    const result = app.run.tap(bubble.letter, bubble.isDecoy);
    /* 2차 공통 4절(스타워드 방이 찾은 함정): 아래 예약들은 이 판에만 속한다. 정답 공개 중에 X → Start 나
       Try Again 을 누르면 새 판이 열린 뒤에 예약이 돌아 새 판 문제를 건너뛰거나 앞 판 철자를 칠한다.
       app.screen 은 새 판에서 다시 "game" 이라 막지 못하므로 판 번호(generation)로 가른다. */
    const generation = app.generation;
    const inThisGame = (fn) => () => { if (generation === app.generation) fn(); };
    if (result.type === "correct") {
      bubble.collected = true;
      const beforeCorrect = app.scoreboard.score;
      app.scoreboard.letterCorrect();
      animateScore(app.scoreboard.score);
      bumpScoreCard();
      floatScoreDelta(app.scoreboard.score - beforeCorrect);
      sfx.effect("success", 0.85);
      flashField("is-correct-flash", 620);
      burstSlot(index);
      emptySlot(index);
      flyLetter(index, bubble.letter, result.collectedCount - 1, inThisGame(() => fillSlot(bubble.letter)));
      announce(`${bubble.letter} 철자를 모았어요.`);
      if (result.completed) {
        app.locked = true;
        /* 완료 처리(completeWord)는 철자가 날아간 뒤에야 도는 예약이라, 그 사이에
           시간이 끝나면 flow 에는 아직 정답 표시가 없다. 마지막 철자를 맞힌 이 순간
           "푼 문제"로 새겨 두어야 다 맞힌 단어가 오답노트에 실리지 않는다(검수 q58). */
        app.solvedIndexes.add(app.flow.index);
        global.setTimeout(inThisGame(completeWord), FLY_MS + 120);
      }
      return;
    }
    if (result.type === "wrong") {
      const beforeMiss = app.scoreboard.score;
      app.scoreboard.miss();
      animateScore(app.scoreboard.score);
      bumpScoreCard();
      // 깎인 만큼 띄운다 — 검수 q61 이후로 0 아래로도 내려간다.
      floatScoreDelta(app.scoreboard.score - beforeMiss);
      sfx.effect("wrong", 0.85);
      flashField("is-wrong-flash", 460);
      joltStage();
      shakeSlot(index);
      announce(
        result.isDecoy
          ? `이 철자는 단어에 없어요. 남은 기회 ${result.chancesLeft}번.`
          : `순서가 달라요. 남은 기회 ${result.chancesLeft}번.`,
      );
      if (result.failed) {
        app.locked = true;
        global.setTimeout(inThisGame(failWord), 260);
      }
    }
  }

  // 단어 완성: 방울 컬러 변경·이동은 이미 끝났고, 단어를 크게 보여 주고
  // 발음을 들려준 뒤 스스로 다음 문제로 넘어간다.
  // (setTimeout으로 예약되므로, 그 사이 타이머가 끝나 결과로 넘어갔으면 버린다)
  function completeWord() {
    if (app.screen !== "game") return;
    const question = currentQuestion();
    if (!question) return;
    app.flow.completeWord(true);
    const { bonusAwarded } = app.scoreboard.wordComplete();
    animateScore(app.scoreboard.score);
    /* 2차 수정(PDF 3쪽): 상단 "연속 정답 보너스 +100!" 팝업은 없앴다. 보너스는 Score 판에서 단어미로처럼
       보인다(playScoreBonus — 사장님 2026-10-02). 정답 공개와 같은 순간에 돌아 예약이 없다.
       화면에 안 보이는 읽어주기(announce)에는 남긴다. 전용 효과음(info_reward.mp3)은 사용하지 않는다(사용자 확정). */
    if (bonusAwarded > 0) playScoreBonus(bonusAwarded);
    revealWord(question, false);
    // 마지막 철자에서 이미 성공음이 났으므로 여기서는 등장음만 낸다(형제와 같은 이유).
    sfx.effect("show", 0.8);
    const bonusNote = bonusAwarded > 0 ? ` 연속 정답 보너스 +${formatScore(bonusAwarded)}점.` : "";
    announce(`${displayWord(question.letters)} 완성!${bonusNote}`);
    advance(REVEAL_HOLD_MS);
  }

  // 기회 소진: 정답을 노출하고 단어 사운드를 들려준 뒤 다음 문제로 강제 전환.
  function failWord() {
    if (app.screen !== "game") return;
    const question = currentQuestion();
    if (!question) return;
    app.flow.completeWord(false);
    app.scoreboard.wordFail();
    recordWrong(app.flow.index);
    revealWord(question, true);
    sfx.effect("show", 0.8);
    announce(`정답은 ${displayWord(question.letters)}입니다.`);
    advance(FAIL_HOLD_MS);
  }

  /* 2차 검수 SB공통-3("폰트 크기는 따라쓰기 영어단어카드 크기로 통일"): 글자 크기 · 최대 폭은 따라쓰기 방 값(156px · 긴 단어 118px ·
     최대 폭 88cqw)이다. 최대 폭을 넘는 단어만 넘지 않을 때까지 줄인다 — 따라쓰기 방 fitWordReveal 과 같은 방식.
     보일 때만 잴 수 있어 덮개를 연 뒤에 부른다. */
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

  function revealWord(question, isFail) {
    if (el.wordReveal) {
      // 완성·실패(정답 노출) 화면 모두 첫 글자를 대문자로 표기한다(스펙 "시작은 대문자").
      const word = displayWord(question.letters);
      el.wordReveal.textContent = word;
      el.wordReveal.classList.toggle("is-long", word.length > 9);
    }
    if (el.answerReveal) {
      el.answerReveal.classList.toggle("is-fail", isFail);
      el.answerReveal.hidden = false;
    }
    fitWordReveal();
    // 저절로 나는 발음이라 소리를 끄면 나지 않는다. 판을 떠났으면 앞 판 단어 발음을 내지 않는다.
    const generation = app.generation;
    global.setTimeout(() => {
      if (generation === app.generation) playSound(question.soundUrl);
    }, REVEAL_SOUND_MS);
  }

  function advance(delayMs) {
    global.clearTimeout(advanceTimer);
    advanceTimer = global.setTimeout(() => {
      advanceTimer = 0;
      if (app.screen !== "game") return;
      if (el.answerReveal) el.answerReveal.hidden = true;
      clearScoreBonus();   // 덮개가 걷히면 덮개 위로 올렸던 Score 판도 내린다
      app.flow.advance();
      if (app.flow.isFinished()) { endGame(); return; }
      loadQuestion();
    }, delayMs);
  }

  function loadQuestion() {
    const question = currentQuestion();
    if (!question) { endGame(); return; }
    app.run = createQuestionRun(question.letters, app.rules);
    buildSlots(question.letters.length);
    if (el.wordMeaning) {
      el.wordMeaning.textContent = question.meaning;
      // 글꼴을 받은 뒤라(startGame 이 판의 영어 글꼴과 한글 글꼴을 기다린다) 잰 폭이 화면과 같다.
      // 8초 한도가 지나 대체 글꼴로 깔렸으면 글꼴이 온 뒤 refitShownMeaning 이 다시 맞춘다.
      fitMeaning(el.wordMeaning.parentElement, el.wordMeaning, question.meaning);
    }
    if (el.answerReveal) el.answerReveal.hidden = true;
    renderRound(buildRound(question.letters, { decoyCount: app.rules.decoyCount }));
    updateProgress();
    app.locked = false;
    announce(`문제 ${app.flow.currentNumber()}. 뜻: ${question.meaning}`);
    /* 검수 r13: 문제가 제시될 때는 단어 사운드를 내지 않는다.
       먼저 듣고 철자를 고르면 파닉스 학습이 되어 버린다. 발음은 단어를
       완성했거나 정답이 공개된 뒤(revealWord)에만 재생한다. */
  }

  /* 다시 시작 규칙(2차 공통 1절, OX 사장님 답): 판을 떠나는 순간 화면에 나와 있던 단어를 기억해 두고,
     다음 판을 그 단어로 시작하지 않는다. Try Again · 결과 X → Start · 게임 중 X → Start 모두 같다.
     시작할 때가 아니라 떠날 때 기억해야 Start 를 빠르게 두 번 눌러도 앞 판 단어가 그대로 남는다. */
  function rememberLastWord() {
    if (!app.flow || app.questions.length === 0) return;
    const index = Math.min(app.flow.index, app.questions.length - 1);
    app.lastWord = app.questions[index]?.english || "";
  }

  function startGame() {
    sfx.effect("open", 0.7);
    // 사양: 매 판마다 문제를 다시 뽑는다(두 번째 판이 첫 판과 같지 않도록).
    if (Content && typeof Content.rebuildQuestions === "function") {
      try {
        const fresh = Content.rebuildQuestions({ avoid: app.lastWord });
        if (Array.isArray(fresh) && fresh.length > 0) {
          app.questions = fresh.slice(0, app.rules.questionCount);
        }
      } catch { /* 재추첨 실패는 진행을 막지 않는다 */ }
    }
    // 앞 판의 "다음 문제로" 예약이 남아 있으면 새 판 첫 문제를 건너뛴다 — 새 판을 열기 전에 끈다.
    global.clearTimeout(advanceTimer); advanceTimer = 0;
    app.generation += 1;   // 새 판 — 옛 판에 묶인 콜백은 여기서 무효가 된다(11-3)
    clearGameEffects();
    app.flow = createGameFlow(app.questions.length || app.rules.questionCount);
    app.scoreboard = createScoreboard(app.rules);
    app.wrongWords = [];
    app.wrongIndexes = new Set();
    app.solvedIndexes = new Set();
    updateScore();
    showScreen("playScreen");
    syncGlobalControls("game");
    // 새 판 시간은 첫 문제가 깔릴 때부터 잰다 — 그때까지는 멈춘 채 한 판 시간 전체를 보인다(앞 판 남은 시간이 아니라).
    stopTimer();
    app.countdown = null;
    updateTimerDisplay();
    /* 공통 11-3: 폰트를 기다렸다 판을 까는 콜백은 이 판에만 속한다. 시작 직후 나가면
       콜백이 나중에 돌아 시작 화면 위에 판을 깔 수 있으므로 판 세대로 묶는다. */
    const generation = app.generation;
    /* 판에 쓰는 글꼴(영어 — 방울 · 트레이 · 점수 · 시간, 한글 — 뜻)이 실린 뒤에 첫 문제를 깐다 — 그 글꼴로 재야 한다.
       둘 다 같은 8초 마감(페이지 연 때부터)에 묶여 있고 Start 가 이미 기다렸으니 보통은 바로 끝난다.
       받는 중인 모든 글꼴(fonts.ready)을 기다리면 판에 안 쓰는 결과 화면 · 다시 시도 글꼴(Lexend 600)까지 기다려
       Start 뒤 빈 판이 생겼다(영어 글꼴 6초 늦춤 실측: Start 6.4초, 첫 문제 8.4초). */
    const ready = Promise.all([loadGameFonts(), loadKoreanFont()]);
    ready.then(() => {
      if (generation !== app.generation) return;
      loadQuestion();
      /* 타이머는 첫 문제가 깔린 뒤에 시작한다 — 글꼴을 기다리는 빈 판에서 시간이 흐르지 않게
         (사장님 답, 부모 방 directive-log 51번). 문제가 없어 바로 끝난 판(endGame 이 세대를 올림)은 시작하지 않는다. */
      if (generation !== app.generation) return;
      startTimer();
    });
  }

  // ============================================================
  // 결과
  // ============================================================
  function endGame() {
    // 타이머 만료 틱과 마지막 문제 전환이 겹쳐도 결과 처리(기록 저장)는 한 번만 한다.
    if (el.endScreen && el.endScreen.classList.contains("is-visible")) return;
    stopTimer();
    app.locked = true;
    rememberLastWord();
    creditSolvedWord();
    /* 판이 끝났다 — 이 판에 걸린 예약(완료 · 철자 칠하기 · 보너스 숫자 · 정답 발음)을 여기서 무효로 한다.
       올리지 않으면 시간이 끝난 뒤 결과 화면 위에서 앞 단어 발음이 난다(반박 검토 실측). */
    app.generation += 1;
    clearScoreBonus();   // 판이 끝났다 — 덮개 위로 올렸던 Score 판 · 고리 · 글자도 걷는다(단어미로 finishGame 과 같다)
    /* 2차 검수 SB공통-1 · 공통-10(사장님 2026-10-15 "A-4는 이번 규칙대로"): 오답노트와 Incorrect 숫자에는 3번 모두 틀린 문제만 싣는다.
       예전(검수 q58)에는 시간이 끝날 때 풀던 문제 · 손도 못 댄 문제도 여기서 실었는데, 그 정리를 뺐다 — 기회 소진(failWord)만 싣는다. */
    const tally = app.flow ? app.flow.tally() : { correct: 0, incorrect: 0, total: app.rules.questionCount };
    sfx.effect(REWARD_VIEW[rewardGrade(tally.correct, tally.total)].sound, 0.9);
    showResult(tally);
  }

  /* 여우 그림 갈아 끼우기.
     그냥 src 를 바꾸면 결과화면이 뜨는 첫 프레임에 그림이 아직 없어 자리가 비어 보인다.
     감춘 채로 불러오고 다 받으면 보여 준다(숨김 → 핸들러 → src 순서).
     같은 등급이 연달아 나오면(같은 주소) 감출 것 없이 바로 보여 준다 — 크롬은 같은 주소를
     다시 넣어도 load 를 띄우므로 감춰도 풀리기는 하지만, 그 한 번의 왕복이 필요 없다.
     (대조군으로 확인: 이 갈래를 빼도 load 는 뜨고 여우는 사라지지 않는다) */
  /* 등급별 여우 세 장을 미리 받아 둔다. 감추고 불러오는 것만으로는 결과화면이 뜨는
     첫 프레임에 자리가 비는 것을 막지 못한다 — 그림이 이미 준비돼 있어야 한다.
     시작 화면으로 돌아올 때마다 불러도 이미 받아 둔 것은 다시 받지 않는다. */
  function preloadCharacters() {
    Object.values(REWARD_VIEW).forEach((view) => {
      try {
        const img = new global.Image();
        img.src = versionedAsset(`assets/result/${view.character}.png`);
      } catch { /* 미리받기는 실패해도 게임을 막지 않는다 */ }
    });
  }

  function showCharacter(nextSrc) {
    const fox = el.resultCharacter;
    if (!fox) return;
    if (fox.getAttribute("src") === nextSrc && fox.complete && fox.naturalWidth > 0) {
      fox.hidden = false;
      return;
    }
    fox.hidden = true;
    fox.onload = () => { fox.hidden = false; };
    fox.onerror = () => { fox.hidden = true; };
    fox.src = nextSrc;
  }

  function showResult(tally) {
    const score = app.scoreboard ? app.scoreboard.score : 0;
    const bonus = app.scoreboard ? app.scoreboard.bonusTotal : 0;
    if (el.resultScoreNumber) el.resultScoreNumber.textContent = formatScore(score);
    if (el.resultTotalScore) el.resultTotalScore.setAttribute("aria-label", `내 점수 ${formatScore(score)}점`);
    /* 2차 검수 공통-2(완료화면 통일): Correct · Incorrect 는 숫자만('개' 삭제), Bonus 는 '+' 없이 숫자 뒤 '점'.
       '점' 은 CSS(.result-points::after)가 붙인다 — 숫자와 '점' 의 위아래 끝을 따로 맞추려고 글자를 나눈다(공통-16). */
    if (el.resultCorrectPoints) {
      el.resultCorrectPoints.textContent = String(tally.correct);
      el.resultCorrectPoints.setAttribute("aria-label", `정답 ${tally.correct}개`);
    }
    if (el.resultIncorrectPoints) {
      /* 오답노트와 같은 수 — 3번 모두 틀린 문제(SB공통-1). 같은 목록에서 세므로 오답노트 줄 수와 어긋날 수 없다(공통-10). */
      const missed = app.wrongWords.length;
      el.resultIncorrectPoints.textContent = String(missed);
      el.resultIncorrectPoints.setAttribute("aria-label", `오답 ${missed}개`);
    }
    if (el.resultBonusPoints) {
      // 공통 10항: 점수를 보여 주는 자리는 모두 같은 서식을 거친다(개수는 대상이 아니다).
      el.resultBonusPoints.textContent = formatScore(bonus);
      el.resultBonusPoints.setAttribute("aria-label", `보너스 ${formatScore(bonus)}점`);
    }
    // 소리·그림·읽히는 이름·파티클이 어긋나지 않게 판정을 한 번만 한다.
    const grade = rewardGrade(tally.correct, tally.total);
    if (el.resultTitle) {
      const view = REWARD_VIEW[grade];
      el.resultTitle.src = versionedAsset(`assets/result/${view.image}.png`);
      el.resultTitle.alt = view.alt;
      // 여우도 같은 판정을 쓴다 — 제목과 표정이 어긋날 수 없다.
      if (el.resultCharacter) showCharacter(versionedAsset(`assets/result/${view.character}.png`));
    }
    if (el.resultMessage) {
      el.resultMessage.textContent = `${tally.total}문제 중 ${tally.correct}개를 맞혔어요!`;
    }
    renderIncorrectAnswers();
    /* 오답 목록 전용 글꼴(나눔 Bold)은 팝업이 처음 그려질 때에야 받는다 — font-display: block 이라 그사이 글자가 비어 보인다.
       결과 화면이 뜰 때 미리 받아 둔다(실패해도 대체 글꼴로 그려지므로 기다리지 않는다). */
    if (app.wrongWords.length > 0) {
      try { doc.fonts?.load('500 1em "NanumSquareRound Text"', "가")?.catch(() => {}); } catch { /* noop */ }
    }

    showScreen("endScreen");
    syncGlobalControls("result");
    if (el.tryAgainButton) el.tryAgainButton.focus();
    // 공통 9-3: 결과화면에서는 소리 설정과 무관하게 BGM 을 멈춘다(효과음은 그대로).
    sfx.stopBgm();
    // 2차 공통 2절(PDF 2쪽 1번): 파티클은 Good · Excellent 일 때만. Try Again 은 축하가 아니다.
    if (grade === "try_again") stopParticles();
    else runParticles();
    saveResult(score);
  }

  // 오답 단어 목록. 없으면 버튼을 잠그고 "오답 없음"으로 알린다(형제 공통).
  // 3번 모두 틀려 기회를 다 쓴 문제만 담는다(2차 검수 SB공통-1). 같은 문제를 두 번 담지 않는다.
  function recordWrong(index) {
    const question = app.questions[index];
    if (!question || app.solvedIndexes.has(index) || app.wrongIndexes.has(index)) return;
    app.wrongIndexes.add(index);
    app.wrongWords.push({
      // 오답노트에도 소문자 표기를 쓴다.
      english: displayWord(question.letters),
      meaning: question.meaning,
      soundUrl: question.soundUrl,
    });
  }

  /* 2차 수정(사장님 "Correct 로 셈"): 마지막 철자를 맞힌 뒤 완료 처리(0.42초 예약)가 돌기 전에 시간이
     끝나면, 그 단어는 오답노트에서는 빠지는데(solvedIndexes, q58) 맞힌 수에도 들지 않아 어디에도 세지 않았다.
     아이는 철자를 다 맞혔으므로 결과로 넘어가는 이 순간 맞힌 문제로 적는다. 연속 보너스는 붙이지 않는다
     (보너스는 완료 처리에서만 준다 — 점수는 철자마다 이미 들어갔다). */
  function creditSolvedWord() {
    if (!app.flow) return;
    const index = app.flow.index;
    if (!app.solvedIndexes.has(index)) return;
    const recorded = app.flow.tally().results[index];
    if (recorded === undefined) app.flow.completeWord(true);
  }

  function renderIncorrectAnswers() {
    const rows = app.wrongWords;
    if (el.incorrectAnswersButton) {
      // 공통 9-1: 쓸 수 없는 버튼은 회색으로 두지 않고 자리까지 없앤다(사장님 선택).
      const empty = rows.length === 0;
      el.incorrectAnswersButton.hidden = empty;
      el.incorrectAnswersButton.disabled = empty;
      el.incorrectAnswersButton.setAttribute(
        "aria-label",
        empty ? "오답 없음" : `오답 ${rows.length}개 보기`,
      );
    }
    if (!el.incorrectAnswerList) return;
    el.incorrectAnswerList.innerHTML = "";
    /* 2차 검수 공통-1(사장님 2026-10-12 "화면이라면 OX퀴즈 처럼 적용"): 줄은 OX 방과 같은 짜임 — 스피커 칸(원 없는 파란 스피커) ·
       단어 칸(가운데) · 뜻 칸. 표 모양은 styles.css 의 .incorrect-answer-* 가 정한다. */
    rows.forEach((row) => {
      const line = doc.createElement("div");
      line.className = "incorrect-answer-row incorrect-answer-grid";
      line.setAttribute("role", "row");

      const audio = doc.createElement("span");
      audio.className = "incorrect-answer-cell incorrect-answer-audio";
      audio.setAttribute("role", "cell");
      if (row.soundUrl) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "incorrect-answer-speaker";
        button.setAttribute("aria-label", `${row.english} 발음 듣기`);
        const icon = doc.createElement("img");
        icon.src = "assets/incorrect-answer/icon_speaker.png";
        icon.alt = "";
        icon.width = 37;
        icon.height = 30;
        icon.draggable = false;
        button.appendChild(icon);
        // 아이가 직접 누른 발음 — 소리를 꺼도 난다(2차 공통 1절 '소리 끈 상태').
        button.addEventListener("click", () => playSound(row.soundUrl, { force: true }));
        audio.appendChild(button);
      }
      const english = doc.createElement("span");
      english.className = "incorrect-answer-cell incorrect-answer-word";
      english.setAttribute("role", "cell");
      const englishText = doc.createElement("span");
      englishText.className = "incorrect-answer-word-text";
      englishText.textContent = row.english;
      english.appendChild(englishText);
      const meaning = doc.createElement("span");
      meaning.setAttribute("role", "cell");
      // 뜻 거름을 걷어 긴 뜻이 들어온다 — 뜻 칸만 줄을 바꿔 다 보인다.
      meaning.className = "incorrect-answer-cell incorrect-answer-meaning";
      meaning.textContent = row.meaning;

      line.append(audio, english, meaning);
      el.incorrectAnswerList.appendChild(line);
    });
  }

  /* 긴 단어만 단어 칸에 맞게 줄인다(OX 방과 같은 방식). 값은 배율 — CSS 기준 크기(1.56cqw, 1920 기준 30px)에 곱한다.
     단어 칸(팝업 폭의 약 30%)은 대부분의 단어가 줄지 않고 들어가는 폭이다. 바닥은 0.73배(약 22px).
     팝업이 보일 때만 잴 수 있다 — 숨어 있으면 폭이 0 이다. 그래서 팝업을 연 뒤에 부른다. */
  function fitIncorrectWords() {
    if (!el.incorrectAnswerList) return;
    el.incorrectAnswerList.querySelectorAll(".incorrect-answer-word-text").forEach((text) => {
      const cell = text.parentElement;
      const minimumScale = 0.73;
      const step = 0.02;
      cell.style.setProperty("--incorrect-word-scale", "1");
      for (let scale = 1; scale > minimumScale && text.scrollWidth > text.clientWidth; scale -= step) {
        cell.style.setProperty("--incorrect-word-scale", (scale - step).toFixed(2));
      }
    });
  }

  function saveResult(score) {
    if (!Content) { app.savePending = Promise.resolve(); return; }
    // 공통 9-2: X 로 나갈 때 이 약속이 끝난 뒤에 화면을 옮긴다 — 저장 전에 나가면 그 판이 사라진다.
    app.savePending = Promise.resolve()
      // 검수 q51: 순위는 화면에 쓰지 않는다. 기록은 그대로 저장하고 응답의 rank 는 받기만 한다.
      .then(() => Content.saveHistory(score))
      .catch(() => { /* 저장 실패는 결과 화면을 막지 않는다 */ });
  }

  /* 파티클 세대: 새 결과가 뜰 때마다 올린다. 앞 결과(Good)의 파티클이 아직 돌고 있을 때
     Try Again 결과가 뜨면, 앞 파티클이 다음 프레임에서 스스로 멈추고 캔버스를 비운다. */
  function stopParticles() {
    app.particleRun += 1;
    const canvas = el.resultParticleCanvas;
    if (!canvas || typeof canvas.getContext !== "function") return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // 간단한 색종이 파티클 (결과 축하)
  function runParticles() {
    const canvas = el.resultParticleCanvas;
    if (!canvas || typeof canvas.getContext !== "function") return;
    app.particleRun += 1;
    const run = app.particleRun;
    const ctx = canvas.getContext("2d");
    const colors = ["#f5a623", "#4aa3f0", "#7cc043", "#f26d9c", "#ffd23f"];
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
      if (run !== app.particleRun) return;   // 더 새 결과가 캔버스를 맡았다 — 지우지도 않는다
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
  // 모달 (오답 목록 팝업 포커스 처리)
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
    let waterpipe = {};
    try {
      const raw = doc.getElementById("gameConfig");
      const parsed = raw ? JSON.parse(raw.textContent) : {};
      waterpipe = parsed && typeof parsed.waterpipe === "object" ? parsed.waterpipe : {};
      const deployment = parsed && typeof parsed.deployment === "object" ? parsed.deployment : {};
      app.closeUrl = typeof deployment.closeUrl === "string" ? deployment.closeUrl : "";
    } catch { waterpipe = {}; app.closeUrl = ""; }
    app.configTimerSeconds = Number(waterpipe.timerSeconds) || RULES.timerSeconds;
    app.rules = {
      ...RULES,
      questionCount: Number(waterpipe.questionCount) || RULES.questionCount,
      timerSeconds: app.configTimerSeconds,
    };
  }

  function onContentReady(snapshot) {
    app.launch = snapshot.launch;
    /* 한 판 시간: API info 의 play_time 이 먼저, 없으면 지금 값(gameConfig). 데모 · 시험 로더는 info 에
       play_time 을 지어 넣지 않는다 — 지어 넣으면 그 기본값이 gameConfig 를 이긴다(2차 공통 4절 함정). */
    const info = snapshot.content && snapshot.content.info;
    app.rules.timerSeconds = resolveTimerSeconds(info ? info.play_time : undefined, app.configTimerSeconds);
    updateTimerDisplay();
    renderStartStory(info);
    app.questions = snapshot.content.questions.slice(0, app.rules.questionCount);
    if (app.questions.length === 0) { showLoadError("게임에 사용할 단어가 없습니다."); return; }
    /* 한글 글꼴과 판에 쓰는 영어 글꼴이 실리거나(같은 8초 마감) 받기가 실패한 뒤에 Start 를 연다 — Start 를 누른 뒤
       빈 판에서 글꼴을 기다리지 않게(사장님 답, 부모 방 directive-log 51번 · 영어 글꼴은 55번).
       그사이 로딩 화면을 떠났으면(다시 시도 등) 열지 않는다. */
    Promise.all([loadKoreanFont(), loadGameFonts()]).then(() => { if (app.screen === "loading") enableStart(); });
  }

  /* 공통 9-2: 결과화면의 X. "다시 하기"와 달리 나가면 그 판은 끝나므로,
     점수 저장이 끝난 뒤에 시작 화면으로 옮기고 게임 상태를 비운다. */
  function exitToStart() {
    if (app.exiting) return;
    app.exiting = true;
    /* 저장을 기다리는 동안 아직 보이는 Try Again 으로 새 판을 열 수 있다. 그 뒤에 저장이 끝나 이 예약이 돌면
       진행 중인 새 판을 시작 화면으로 내쫓는다(반박 검토 실측, 저장이 느린 회원 모드) — 판 번호로 가른다. */
    const generation = app.generation;
    const go = () => {
      app.exiting = false;
      if (generation !== app.generation) return;
      app.flow = null;
      app.run = null;
      app.scoreboard = null;
      app.countdown = null;
      app.wrongWords = [];
      app.wrongIndexes = new Set();
      app.solvedIndexes = new Set();
      renderIncorrectAnswers();
      updateScore();
      // 화면에 남은 숫자도 처음 상태로 돌린다(점수·타이머·문항).
      updateTimerDisplay();
      if (el.questionProgress) el.questionProgress.textContent = `1/${app.rules.questionCount}`;
      enableStart();
      // 소리 설정값은 건드리지 않았으니 원래 설정대로 BGM 이 다시 난다(9-3).
      sfx.applyMuted();
    };
    Promise.resolve(app.savePending).then(go, go);
  }

  /* [앱 전용 자리] 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — LF 가 앱(Android · iOS)에 올릴 때 직접 작업한다.
     지금은 비어 있다. 화면에 알림은 띄우지 않는다. (2차 검수 공통-12 — 12개 게임 모두 같은 이름 · 같은 순서) */
  function closeAppWebView() {}

  /* 시작 화면의 X. 호스트에게 먼저 알리고(막으면 거기서 끝), 앱 웹뷰 닫기 자리 → 창 닫기 순서로 부른다(공통-12, OX 와 같은 순서).
     창이 닫히지 않으면(직접 연 탭 · 링크로 들어온 같은 탭 · 앱 웹뷰) 예전처럼 갈 곳을 차례로 찾는다.
     주소는 sameOriginUrl 을 지난 것만 쓴다 — 아니면 아이를 남의 사이트로 보낼 수 있다. */
  function closeGame() {
    const notice = new global.CustomEvent("spellingbuilder:navigate", {
      detail: { screen: "close" },
      cancelable: true,
    });
    // 호스트가 preventDefault() 하면 호스트가 알아서 닫는다는 뜻이다.
    if (!global.dispatchEvent(notice)) return;

    closeAppWebView();
    // 웹은 새 창으로 열린다(공통-12 '서비스 호출방법') — 스크립트가 연 창이면 여기서 닫힌다.
    try { global.close(); } catch { /* noop */ }
    if (global.closed) return;

    const here = global.location ? global.location.href : "";
    let params = null;
    try { params = new global.URLSearchParams(global.location.search); } catch { params = null; }
    /* ① 주소창 close_url — 같은 사이트이면서 배포 루트 아래일 때만.
       ② gameConfig 의 closeUrl — 납품본에 박힌 값이라 루트 제한은 걸지 않는다.
       둘 다 "같은 문서"는 버린다 — 이동이 안 일어나는데 갈 곳을 찾았다고 치면 X 가 멈춘다. */
    const fromQuery = sameOriginUrl(params ? params.get("close_url") : "", here);
    const fromConfig = sameOriginUrl(app.closeUrl, here);
    const target = (withinDeployRoot(fromQuery, here) && leavesCurrentDocument(fromQuery, here) ? fromQuery : null)
      || (leavesCurrentDocument(fromConfig, here) ? fromConfig : null);
    if (target) { global.location.href = target; return; }

    /* 같은 사이트에서 들어왔을 때만 뒤로 간다(file:// 은 referrer 가 비어 있어 저절로 걸러진다).
       갈 곳이 없으면 여기서 아무 일도 일어나지 않는다 — 안내 문구는 띄우지 않는다(사장님 지시). */
    if (sameOriginUrl(doc.referrer, here)) global.history.back();
  }

  /* 2차 검수 공통-9: 시작 화면 로고와 Start 사이의 동화 정보 — 1줄 title, 2줄 subtitle(이미 받는 info 응답).
     값이 없으면(데모 · 시험 · info 실패) 동화 정보만 숨기고 배치는 그대로 둔다. 레벨 · 번호는 넣지 않는다. */
  function renderStartStory(info) {
    if (!el.startStory) return;
    const title = String(info?.title ?? "").trim();
    const subtitle = String(info?.subtitle ?? "").trim();
    el.startStoryTitle.textContent = title;
    el.startStorySubtitle.textContent = subtitle;
    el.startStoryTitle.hidden = !title;
    el.startStorySubtitle.hidden = !subtitle;
    el.startStory.hidden = !title && !subtitle;
  }

  /* 동화 정보 글자를 자리 폭에 맞춘다 — 길면 말줄임 대신 두 줄을 같은 배율로 줄인다(사장님이 OX 방에서 하신 말씀
     "글자가 길어지면 폰트 크기를 줄이게", 공통-9 '다른 방이 맞추는 법'). 배율은 CSS 기준 크기(2.083333cqw, 1920 기준 40px)에 곱한다.
     바닥(0.5배)에서도 넘치면 그때만 CSS 의 말줄임이 남는다. 화면에 보일 때만 잴 수 있다 — 숨어 있으면 폭이 0 이다. */
  function fitStartStory() {
    const story = el.startStory;
    if (!story || story.hidden) return;
    const lines = [el.startStoryTitle, el.startStorySubtitle].filter((line) => line && !line.hidden);
    const minimumScale = 0.5;
    const step = 0.02;
    let scale = 1;
    story.style.setProperty("--start-story-scale", "1");
    while (scale > minimumScale && lines.some((line) => line.scrollWidth > line.clientWidth)) {
      scale = Math.max(minimumScale, Number((scale - step).toFixed(2)));
      story.style.setProperty("--start-story-scale", String(scale));
    }
  }

  function enableStart() {
    app.generation += 1;   // 판을 떠난다 — 남아 있는 콜백을 무효로 만든다(11-3)
    clearGameEffects();
    sfx.preload();
    preloadCharacters();
    global.clearTimeout(advanceTimer); advanceTimer = 0;
    stopTimer();
    app.locked = true;
    if (el.answerReveal) el.answerReveal.hidden = true;
    closeModal(el.incorrectAnswerDialog);
    showScreen("startScreen");
    fitStartStory();
    syncGlobalControls("start");
    if (el.startButton) { el.startButton.disabled = false; el.startButton.removeAttribute("aria-busy"); }
    if (el.helpButton) el.helpButton.disabled = false;
  }

  function showLoadError(message) {
    showScreen("loadingScreen");
    /* 사장님 답(2026-10-02 15:27, 부모 방 directive-log 55번 — 워터파이프만): 오류 문구와 "다시 시도" 버튼은 글꼴
       기다림과 상관없이 곧바로 보이고 누를 수 있게 한다(글꼴이 아직이면 대체 글꼴로). 정상 로딩 문구만 숨긴다. */
    el.loadingScreen?.classList.add("is-error");
    if (el.loadingTitle) el.loadingTitle.textContent = "불러오기 실패";
    if (el.loadingMessage) el.loadingMessage.textContent = message;
    if (el.retryButton) el.retryButton.hidden = false;
  }

  function boot() {
    if (!Content) { showLoadError("게임 로더를 찾을 수 없습니다."); return; }
    showScreen("loadingScreen");
    el.loadingScreen?.classList.remove("is-error");   // 다시 불러오는 동안은 정상 로딩 문구(글꼴 전에는 숨김)
    if (el.loadingTitle) el.loadingTitle.textContent = "게임 준비 중";
    if (el.loadingMessage) el.loadingMessage.textContent = "단어와 게임 정보를 불러오고 있습니다.";
    if (el.retryButton) el.retryButton.hidden = true;
    Content.bootstrap({ force: true })
      .then((snapshot) => onContentReady(snapshot))
      .catch((error) => showLoadError(error?.message || "게임 데이터를 불러오지 못했습니다."));
  }

  // ---- 이벤트 배선 ----
  function wireEvents() {
    slotEls = buildSlotElements();
    slotEls.forEach((slotEl) => slotEl.core.addEventListener("click", onSlotTap));

    // 어떤 조작이든 첫 클릭이면 배경음을 깨운다(브라우저 자동재생 제한 때문).
    // 결과화면 차단은 startBgm 안에 있다 — 트는 곳이 한 군데여야 새 경로가 생겨도 새지 않는다.
    el.stage?.addEventListener("click", () => sfx.startBgm(), { capture: true });
    el.startButton?.addEventListener("click", () => sfx.effect("touch", 0.7), { capture: true });
    el.startButton?.addEventListener("click", startGame);
    el.helpButton?.addEventListener("click", openHelp);
    el.helpRetryButton?.addEventListener("click", () => loadHelp(true));

    // 결과 화면: 다시 하기 두 곳(좌상단 리플레이 · Try Again)은 같은 동작이다.
    el.tryAgainButton?.addEventListener("click", startGame);
    el.resultReplayButton?.addEventListener("click", exitToStart);
    el.incorrectAnswersButton?.addEventListener("click", () => {
      if (el.incorrectAnswersButton.disabled) return;
      // 2차 검수 SB6-1: Incorrect Answers 버튼에도 누르는 효과음(시작 화면 Start 와 같은 touch).
      sfx.effect("touch", 0.7);
      openModal(el.incorrectAnswerDialog, el.incorrectAnswerCloseButton);
      fitIncorrectWords();
      if (el.incorrectAnswerList) el.incorrectAnswerList.scrollTop = 0;
    });
    el.incorrectAnswerCloseButton?.addEventListener("click", () => closeModal(el.incorrectAnswerDialog));
    el.incorrectAnswerBackdrop?.addEventListener("click", () => closeModal(el.incorrectAnswerDialog));

    el.soundButton?.addEventListener("click", () => setMuted(!app.muted));
    el.navigationButton?.addEventListener("click", () => {
      /* 도움말 ← → 시작 화면. 같은 버튼이 시작 화면에서는 "게임 닫기"(X)가 되므로, 키보드 포커스를 그대로 두면
         Enter 한 번 더에 게임이 닫힌다 — 도움말을 연 버튼으로 돌려놓는다(반박 검토 실측). */
      if (app.screen === "help") { enableStart(); el.helpButton?.focus(); return; }
      // 게임 중 X → 시작 화면: 지금 나와 있던 단어로 다음 판을 시작하지 않게 기억해 둔다.
      if (app.screen === "game") { rememberLastWord(); enableStart(); return; }
      closeGame();
    });
    el.retryButton?.addEventListener("click", boot);

    doc.addEventListener("keydown", onKeydown);
  }

  function init() {
    readConfig();
    // 방울·트레이 글꼴(영어)과 한글 글꼴을 시작하자마자 받는다 — 첫 문제에서 글자가 늦게 뜨지 않게, Start 는 둘 다 기다린다.
    loadGameFonts();
    loadKoreanFont();
    wireEvents();
    setMuted(false);
    boot();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
