(function bootSpellingBuilder(global) {
  "use strict";

  const doc = global.document;
  const Maze = global.WordMaze;
  const Rules = global.SpellingBuilderRules;
  const Content = global.SpellingBuilderContent;

  const STAGE_WIDTH = 1920;
  const STAGE_HEIGHT = 1080;

  // 미로가 놓이는 상자. 격자가 커지면 칸을 줄여 이 상자 안에 맞춘다.
  // 칸 크기를 정하는 상자는 실제 영역보다 조금 작게 둔다. 격자가 영역 테두리에
  // 딱 붙지 않도록 하는 여백이다. MAZE_AREA_HEIGHT는 styles.css의 .maze-area
  // 높이와 같아야 화살표 세로 위치가 맞는다.
  const MAZE_AREA_HEIGHT = 458;
  // 폭은 왼쪽 여우(오른쪽 끝 447px)와 오른쪽 타이머 원형(왼쪽 끝 1482px) 사이를
  // 넘지 않게 잡는다. 가운데 정렬이라 980이면 양쪽에 여유가 남는다.
  const FIT_WIDTH = 980;
  const FIT_HEIGHT = 450;
  const ARROW_WIDTH = 69;
  const ARROW_HEIGHT = 46;
  const GAP_X_RATIO = 0.61;
  const GAP_Y_RATIO = 0.31;
  const MAX_TILE = 165;

  const REVEAL_CORRECT_MS = 1500;
  const REVEAL_FAIL_MS = 2300;
  const TIMER_TICK_MS = 200;
  // 2차 공통: 남은 10초부터 빨강으로 깜박이고, 막바지 5초부터는 더 빠르게 깜박인다.
  const URGENT_SECONDS = 10;
  const FINAL_SECONDS = 5;

  const el = {};
  const ids = [
    "game-stage", "stage-tools", "help-button", "sound-button", "navigation-button",
    "status-toast",
    "start-screen", "start-button", "start-story", "start-story-title", "start-story-subtitle",
    "play-screen", "meaning-text", "maze-grid", "start-arrow", "play-fox",
    "score-delta",
    "score-value", "progress-value", "timer-value",
    "answer-reveal", "answer-reveal-word",
    "end-screen", "result-headline", "result-fox", "result-correct", "result-incorrect",
    "result-bonus", "result-total-value", "result-total-score",
    "result-message", "result-home-button", "result-particle-canvas",
    "incorrect-answers-button", "try-again-button",
    "incorrect-answer-dialog", "incorrect-answer-backdrop", "incorrect-answer-close", "incorrect-answer-list",
    "help-dialog", "help-content", "help-status", "help-status-text", "help-retry-button",
    "loading-screen", "loading-title", "loading-message", "retry-button",
  ];
  ids.forEach((id) => {
    el[id] = doc.getElementById(id);
  });

  /*
   * 등급별 여우를 시작할 때 미리 받아 둔다.
   *
   * 노린 것: 그림이 정해지는 때가 결과 화면이 열리는 바로 그 순간이라(fillResult 다음 줄이
   * showScreen("end")), 그때 처음 받으면 디코드가 끝날 때까지 img 에 남아 있던 그림이 그려진다.
   * 두 번째 판부터는 그것이 "지난 판 등급의 여우"다.
   *
   * 잰 것: 시작할 때 세 장 요청이 나가는 것은 확인했다(없는 판은 good.png 한 건뿐).
   * 다만 이 방에서는 미리받기가 있든 없든 · 캐시를 켜든 끄든 네 조건 모두 첫 프레임에
   * 준비돼 있어, 이 줄이 잔상을 줄이는지는 이 방에서 입증하지 못했다. 형제 세 방
   * (버블터치 · 실로폰 · 워드파이프)은 대조군을 두고 잔상을 재현했다 — 방마다 갈린다.
   * 비용이 시작 때 세 장뿐이라 그대로 둔다. 자세한 것은 app/검수_회신.md.
   */
  const FOX_VERSION = "20260930";
  const FOX_NAMES = ["excellent", "good", "try_again"];
  /*
   * 결과화면 효과음도 등급 숫자로 고른다. 전에는 `tier === 0 ? "cheer" : "stamp"` 라
   * Good 과 Try again 이 같은 소리를 들었다 — 잘했을 때와 아쉬웠을 때가 구분되지 않았다.
   * 표로 두면 등급이 늘어도 소리가 빠지지 않고, 제목 그림·여우와 같은 숫자에서 함께 갈린다.
   * Try again 의 lose 는 게임 중 정답 공개(못 맞힘)에도 쓰이지만 둘 다 "아쉽다" 로 뜻이 같고,
   * 형제 방 카드짝·레이싱도 낮은 등급에 같은 소리를 쓴다 (사장님 확인 2026-09-30).
   */
  const RESULT_SOUNDS = ["cheer", "stamp", "lose"];
  // 2차 수정(PDF 2쪽 "Try Again에서는 파티클 효과 제외, Good·Excellent 일때만"):
  // 색종이도 같은 등급 숫자로 고른다. 제목 그림·여우·소리와 어긋나지 않게 한 표에 둔다.
  const RESULT_CONFETTI = [true, true, false];
  const foxSource = (tier) => `assets/result/${FOX_NAMES[tier]}.png?v=${FOX_VERSION}`;
  FOX_NAMES.forEach((_, tier) => {
    const image = new global.Image();
    image.src = foxSource(tier);
  });
  // 2차: 도움말 ← 는 CSS 배경이라 도움말을 처음 열 때에야 받기 시작한다. 빈 칸으로 잠깐
  // 보이지 않게 미리 받는다(CSS 의 주소와 글자까지 같아야 같은 캐시를 쓴다).
  new global.Image().src = "assets/public/btn_back.png";

  const game = {
    questions: [],
    index: 0,
    board: null,
    progress: [],
    locked: true,
    running: false,
    dragging: false,
    pointerIndex: null,
    screen: "loading",
    introPlayed: false,
    remainingSeconds: 0,
    timerId: null,
    deadline: 0,
    wrongRecords: new Map(),
    // 2차 공통(다시 시작): 앞 판에서 마지막으로 화면에 나왔던 단어. 새로 고침하면 잊는다.
    lastWord: "",
    // 판 번호. 판을 시작할 때마다 하나 올린다. 예약해 둔 일은 자기 판 번호가 아니면 하지 않는다.
    round: 0,
    cells: [],
    maze: null,
  };

  /* ---------------- 무대 크기 ---------------- */

  function fitStage() {
    const scale = Math.min(
      global.innerWidth / STAGE_WIDTH,
      global.innerHeight / STAGE_HEIGHT,
    );
    el["game-stage"].style.setProperty("--stage-scale", String(scale));
  }

  /* ---------------- 소리 ---------------- */

  const sound = (function createSound() {
    const EFFECTS = {
      touch: "assets/sound/touch.mp3",
      success: "assets/sound/success.mp3",
      fail: "assets/sound/fail.mp3",
      lose: "assets/sound/effect_falid_ha_ah.mp3",
      open: "assets/sound/open.mp3",
      cheer: "assets/sound/yeah.mp3",
      stamp: "assets/sound/stamp.mp3",
      show: "assets/sound/show.mp3",
    };
    // 철자를 맞힐 때마다 음이 한 칸씩 올라간다.
    const SCALE = Array.from({ length: 8 }, (_, index) => `assets/sound/xylo${index}.mp3`);

    /*
     * 배경음. 처음에는 쓰지 않기로 했다가 사용자 지시로 다시 넣었고, 곡도 사용자가
     * the_morning_hop 으로 정했다. 원본 파일 이름은 앞에 공백이 있어(" the_morning_hop.mp3")
     * 주소에 넣으면 %20 으로 새니, 옮기면서 공백을 뗐다.
     * 이 곡은 리소스 폴더에서 음색이 가장 낮아(370Hz) 철자를 맞힐 때 올라가는
     * 실로폰 음(xylo0~7)과 겹치지 않는다. 대신 평균 레벨이 -14.3dB 로 앞서 쓰던
     * 곡(-20.0dB)보다 5.7dB 크므로 볼륨을 그만큼(약 절반) 낮춰 같은 크기로 들리게 한다.
     * let_start 효과음은 여전히 쓰지 않는다.
     */
    const BGM_SRC = "assets/sound/the_morning_hop.mp3";
    const BGM_VOLUME = 0.15;

    const cache = new Map();
    let muted = false;
    let wordAudio = null;
    let bgmAudio = null;
    let bgmWanted = false;
    // 검수 4차 9-3: 결과화면에서는 소리 설정과 무관하게 BGM 을 막는다. 설정값(bgmWanted·muted)은 건드리지 않는다.
    let bgmBlocked = false;

    function clip(src) {
      if (!cache.has(src)) {
        const audio = new global.Audio(src);
        audio.preload = "auto";
        cache.set(src, audio);
      }
      return cache.get(src);
    }

    function playSrc(src, volume) {
      if (muted || !src) return null;
      try {
        // 같은 효과음이 겹칠 수 있으므로 복제해서 재생한다.
        const node = clip(src).cloneNode(true);
        node.volume = typeof volume === "number" ? volume : 1;
        const played = node.play();
        if (played && typeof played.catch === "function") played.catch(() => {});
        return node;
      } catch {
        return null;
      }
    }

    return {
      preload() {
        Object.values(EFFECTS).forEach(clip);
        SCALE.forEach(clip);
      },
      effect(name, volume) {
        return playSrc(EFFECTS[name], volume);
      },
      note(step) {
        const index = Math.max(0, Math.trunc(step)) % SCALE.length;
        return playSrc(SCALE[index], 0.85);
      },
      // 단어 발음은 API가 준 sound_url을 그대로 쓴다. 로컬 사운드에는 없다.
      // onState 로 재생 시작·종료를 알려 버튼이 재생 중 표시를 켜고 끌 수 있게 한다.
      // 2차 공통(소리 끈 상태): 사람이 직접 누른 발음(manual)은 소리를 꺼도 난다 —
      // 오답노트 발음. 정답 뒤에 저절로 나는 발음은 지금처럼 나지 않는다.
      word(url, onState, options) {
        const notify = (playing) => {
          if (typeof onState === "function") onState(playing);
        };
        const manual = Boolean(options && options.manual);
        if ((muted && !manual) || !url) {
          notify(false);
          return Promise.resolve();
        }
        try {
          if (wordAudio) wordAudio.pause();
          const audio = new global.Audio(url);
          wordAudio = audio;
          const finish = () => {
            if (wordAudio === audio) wordAudio = null;
            notify(false);
          };
          audio.addEventListener("playing", () => notify(true), { once: true });
          audio.addEventListener("ended", finish, { once: true });
          audio.addEventListener("error", finish, { once: true });
          const played = audio.play();
          return played && typeof played.catch === "function"
            ? played.catch(() => { finish(); })
            : Promise.resolve();
        } catch {
          notify(false);
          return Promise.resolve();
        }
      },
      /*
       * 배경음. 브라우저가 사용자의 조작 없이는 소리를 못 틀게 하므로, 첫 클릭
       * 때 한 번 불러 준다. 두 번째부터는 이미 돌고 있어 아무 일도 하지 않는다.
       */
      startBgm() {
        bgmWanted = true;
        if (muted || bgmBlocked) return;
        if (!bgmAudio) {
          try {
            bgmAudio = new global.Audio(BGM_SRC);
            bgmAudio.loop = true;
            bgmAudio.volume = BGM_VOLUME;
          } catch {
            bgmAudio = null;
            return;
          }
        }
        const played = bgmAudio.play();
        if (played && typeof played.catch === "function") played.catch(() => {});
      },
      setMuted(value) {
        muted = Boolean(value);
        if (muted) {
          if (wordAudio) wordAudio.pause();
          if (bgmAudio) bgmAudio.pause();
        } else if (bgmWanted) {
          this.startBgm();
        }
        return muted;
      },
      isMuted() {
        return muted;
      },
      /* 결과화면 동안만 BGM 을 막는다. 설정값은 그대로라 시작 화면으로 돌아가면 원래대로 난다. */
      blockBgm(value) {
        bgmBlocked = Boolean(value);
        if (bgmBlocked) {
          if (bgmAudio) bgmAudio.pause();
          return;
        }
        if (bgmWanted && !muted) this.startBgm();
      },
    };
  })();

  /* ---------------- 화면 전환 ---------------- */

  /*
   * 순간 알림. 형제와 같다 — 화면을 바꾸지 않고 한마디만 띄웠다 지운다.
   * 연달아 부르면 앞의 것을 밀어내고 타이머를 다시 잰다.
   */
  let toastTimer = 0;

  function showToast(message) {
    const node = el["status-toast"];
    if (!node) return;
    global.clearTimeout(toastTimer);
    node.textContent = message;
    node.classList.add("is-visible");
    toastTimer = global.setTimeout(() => {
      node.classList.remove("is-visible");
      toastTimer = 0;
    }, 1800);
  }

  /*
   * 시작 화면의 X.
   *
   * 규약 문서(voca-game-api)에 닫기 동작은 한 줄도 없고, 우리가 쏘던
   * spellingbuilder:navigate 를 듣는 코드도 납품본 어디에도 없었다 — 이름조차 방마다
   * 갈렸다(spellingbuilder / wordmatch / molegame). "셸이 닫아 준다"는 가정만 있었고
   * 눌러도 아무 일이 없었다. 호스트가 나중에 받을 자리는 cancelable 로 남기고,
   * 아무도 막지 않으면 우리가 나간다.
   */
  const CLOSE_PROTOCOLS = ["http:", "https:", "file:"];

  /*
   * 밖에서 받은 주소를 그대로 쓰면 이 페이지가 사람을 남의 곳으로 보내는 도구가 된다.
   *
   * origin 비교만으로는 모자란다. file:// 에서 실제로 새어 나가는 것을 재 보면
   * (크롬 실측, 이 방 index.html 기준 origin = "file:")
   *   //evil.example/steal   → file://evil.example/steal   origin 검사 통과 ⚠
   *   file://evil.example/x                                origin 검사 통과 ⚠
   * 둘 다 host 검사가 막는다. javascript: · data: · about:blank 는 크롬에서는 origin
   * 이 다르지만, 엔진마다 다르므로(node 는 file:// 의 origin 이 "null" 이라 셋 다
   * origin 검사를 통과한다) protocol 과 허용 목록으로 한 번 더 막는다.
   * 검사도 file:// 기준으로 돌린다 — https 기준으로만 보면 저절로 걸러져 뚫린 줄 모른다.
   */
  function safeCloseTarget(value, location) {
    if (!value) return "";
    let here;
    let target;
    try {
      here = new global.URL(location.href);
      target = new global.URL(String(value), location.href);
    } catch (error) {
      return "";
    }
    if (target.origin !== here.origin) return "";
    if (target.protocol !== here.protocol) return "";
    if (target.host !== here.host) return "";
    if (!CLOSE_PROTOCOLS.includes(target.protocol)) return "";
    return target.href;
  }

  /*
   * 배포 루트 아래인지. 서버에서는 모음 페이지가 <루트>/index.html 이고 게임이
   * <루트>/<방>/index.html 이라(배포_v2/올리기.sh), 게임 기준 ".." 가 곧 배포 루트다.
   * 모음이 보내는 "../index.html" 은 통과하고 file:///etc/passwd 는 걸린다.
   *
   * 이 제한은 주소창으로 들어오는 close_url 에만 건다. gameConfig 의 deployment.closeUrl
   * 은 납품본 안에 박힌 값이라 묶으면 리틀폭스가 루트 밖으로 닫고 싶을 때 운영이 깨진다.
   */
  function underDeployRoot(href, location) {
    if (!href) return "";
    try {
      const root = new global.URL("../", location.href).href;
      return href.startsWith(root) ? href : "";
    } catch (error) {
      return "";
    }
  }

  /*
   * 같은 문서를 가리키는 주소는 버린다.
   *
   * "#bye" 처럼 조각만 다른 값은 같은-출처 검사도 루트 제한도 전부 통과한다(같은 문서는
   * 늘 루트 안이다). 그런데 location 에 넣어도 문서가 바뀌지 않고, 갈래는 "성공" 으로
   * 끝나 뒤의 갈래와 안내를 모두 건너뛴다 — X 가 통째로 무동작이 된다. 실제 크롬에서
   * ?close_url=%23bye 로 재현했다(주소에 #bye 만 붙고 안내도 안 떴다).
   *
   * 위험한 값을 찾는 돌연변이로는 나오지 않는 자리다. 막지도 않고 하지도 않는 경우라서다.
   */
  function documentPath(url) {
    // 폴더로 끝나는 주소는 그 폴더의 index.html 이다. 눕히지 않으면 "./" 가 새어 나간다.
    return url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  }

  function leavesThisDocument(href, location) {
    if (!href) return "";
    try {
      const here = new global.URL(location.href);
      const there = new global.URL(href);
      /*
       * 질의와 조각은 빼고 경로만 본다. 조각만 지우던 예전 방식은 실제 주소에서 뚫렸다 —
       * close_url 은 늘 질의로 들어오니 기준에는 "?…close_url=index.html" 이 붙어 있고
       * index.html 에는 없어서 두 주소가 달라 보였다. 그래서 index.html · ./ · ?x=1 이
       * "다른 문서" 로 통과했고, X 가 닫는 대신 게임을 다시 띄웠다.
       */
      return documentPath(there) === documentPath(here) ? "" : href;
    } catch (error) {
      return "";
    }
  }

  /* [앱 전용 자리] 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — LF 가 앱(Android · iOS)에 올릴 때 직접 작업한다. 지금은 비어 있다. 화면에 알림은 띄우지 않는다. */
  function closeAppWebView() {}

  /*
   * 2차 검수 공통-12(사장님 2026-10-12 "closeAppWebView() 를 모든 컨텐츠에 적용"): 열두 방이 같은 순서다 —
   * (방의 닫기 알림) → closeAppWebView() → window.close() → 창이 안 닫혔을 때만 예전 갈래.
   * 웹은 새 창으로 열리니 window.close() 로 닫힌다. 브라우저가 닫기를 막는 창(스크립트가 열지 않았고
   * 방문 기록이 둘 이상인 탭 등)과 앱 웹뷰에서는 무시되고 window.closed 가 false 로 남아, 예전처럼
   * close_url · 설정 주소 · referrer 뒤로가기를 차례로 본다. 앱 웹뷰에서 앱이 닫아 준 뒤에도 closed 가
   * false 로 남는지는 실제 앱에서 확인하지 못했다. 이 방은 그 갈래가 OX 의 history.back() 한 줄보다 길 뿐 같은 자리다.
   */
  function closeGame() {
    // ① 호스트가 받을 자리. preventDefault() 하면 우리는 나서지 않는다.
    const notice = new global.CustomEvent("spellingbuilder:navigate", {
      detail: { screen: "close" },
      cancelable: true,
    });
    if (!global.dispatchEvent(notice)) return;

    // ② 앱 웹뷰 닫기 자리 ③ 창 닫기 — 닫혔으면 끝이다.
    closeAppWebView();
    global.close();
    if (global.closed) return;

    // ④ 모음 페이지가 붙여 보내는 주소 ⑤ 배포 설정에 박아 둔 주소
    const params = new global.URLSearchParams(global.location.search || "");
    const fromQuery = underDeployRoot(safeCloseTarget(params.get("close_url"), global.location), global.location);
    const fromConfig = safeCloseTarget(Content.getState().launch?.closeUrl, global.location);
    const target = leavesThisDocument(fromQuery, global.location)
      || leavesThisDocument(fromConfig, global.location);
    if (target) {
      global.location.href = target;
      return;
    }
    /*
     * ⑥ 온 곳으로 되돌아간다. 조건을 history.length 로 두면 같은 탭의 다른 방문까지
     * 세어, file:// 로 열었을 때 직전에 보던 다른 모드 URL 로 되돌아가 버린다.
     * file:// 은 referrer 가 비어 있으니, referrer 로 두면 그 경우가 저절로 걸러진다.
     */
    /*
     * 갈래가 모두 비면 더 하지 않는다. 예전에는 창이 살아 있으면 "탭을 닫아 주세요." 를 띄웠는데
     * 사장님 지시로 걷었다(열두 방 통일). 그래서 창도 안 닫히고 갈 곳도 없는 경우 — 루트 밖 주소 ·
     * 타 사이트 주소 · 설정값이 빈 값 · referrer 없음 — 에는 X 가 아무 반응도 내지 않는다.
     * 지시의 결과이지 결함이 아니다. 창 닫기는 이제 맨 끝이 아니라 ③ 에서 먼저 한다(공통-12).
     */
    if (safeCloseTarget(doc.referrer, global.location)) {
      global.history.back();
    }
  }

  function showScreen(name) {
    game.screen = name;
    // 시작 화면에서는 토스트가 로고·여우를 가리지 않도록 아래로 내려간다.
    el["game-stage"].classList.toggle("screen-start", name === "start");
    if (name !== "end") clearParticles();
    el["start-screen"].hidden = name !== "start";
    el["play-screen"].hidden = name !== "play";
    el["end-screen"].hidden = name !== "end";
    syncNavigation();
    syncToolsVisibility();
    // 숨어 있는 동안에는 잴 수 없다 — 시작 화면이 보일 때마다 동화 정보 글자를 다시 맞춘다.
    if (name === "start") fitStartStory();

    // 첫 진입 때만 등장 연출을 한 번 돌린다. 게임에서 돌아올 때는 없다.
    if (name === "start" && !game.introPlayed) {
      game.introPlayed = true;
      playIntro();
    }
  }

  /*
   * 로고가 먼저 튀어 들어오고, 뒤에 숨어 있던 여우가 이어서 솟는다. 연출이 끝나면
   * 클래스를 떼어 평소 상태로 돌려준다 — 로고는 고정, 여우는 숨쉬기.
   */
  const INTRO_PARTS = [
    { selector: ".start-logo", className: "logo-enter" },
    { selector: ".start-fox", className: "fox-enter" },
    { selector: ".start-sparks .spark", className: "spark-enter" },
  ];

  function playIntro() {
    INTRO_PARTS.forEach(({ selector, className }) => {
      doc.querySelectorAll(selector).forEach((node) => {
        node.classList.add(className);
        node.addEventListener("animationend", () => {
          node.classList.remove(className);
        }, { once: true });
      });
    });
  }

  /*
   * wordmathch_spelling과 같은 규칙이다. 시작 화면에서는 게임을 닫는 X, 그 밖의
   * 화면에서는 시작 화면으로 돌아가는 화살표가 된다.
   */
  function syncNavigation() {
    const onHelp = !el["help-dialog"].hidden;
    const closesGame = !onHelp && game.screen === "start";
    // 검수 r12: 아이콘은 항상 X 다. is-back 클래스는 더 이상 쓰지 않는다.
    el["navigation-button"].setAttribute(
      "aria-label",
      closesGame ? "게임 닫기" : onHelp ? "뒤로 가기" : "시작 화면으로 돌아가기",
    );
  }

  /*
   * 로딩과 오류를 한 화면에서 쓴다. 형제처럼 제목 줄을 따로 두고 is-error를 붙여
   * 둘을 눈으로 구분한다 — 예전에는 둘이 똑같이 생겨서 기다리는 중인지 실패한
   * 것인지 알 수가 없었다.
   */
  function setLoading(visible, title, message, options) {
    const settings = options || {};
    el["loading-screen"].hidden = !visible;
    el["loading-screen"].classList.toggle("is-error", Boolean(settings.error));
    if (title) el["loading-title"].textContent = title;
    if (message) el["loading-message"].textContent = message;
    el["retry-button"].hidden = !settings.retry;
    syncToolsVisibility();
  }

  // 팝업 닫기 버튼이 무대 오른쪽 위 공용 버튼과 같은 자리에 온다. 팝업이 떠 있는
  // 동안에는 공용 버튼을 감춰 두 개가 겹쳐 보이지 않게 한다.
  function syncToolsVisibility() {
    // 도움말은 팝업이 아니라 화면이다. 형제처럼 코너 버튼을 남겨 두고,
    // 오른쪽 위 화살표가 "도움말 닫기"가 된다.
    const anyOpen = !el["incorrect-answer-dialog"].hidden;
    const onLoading = !el["loading-screen"].hidden;
    // 결과 화면에서는 코너 버튼을 내린다. 형제와 같은 규칙이고, 그러지 않으면
    // 사운드 버튼(33,33 / 66x69, z-index 40)이 다시하기 버튼(27,17 / 80x83,
    // z-index 5)을 거의 다 덮고 클릭까지 가로챈다.
    el["stage-tools"].hidden = anyOpen || onLoading || game.screen === "end";
    // 2차 공통(도움말 버튼): 도움말 화면에서만 스피커를 숨기고, 오른쪽 위 X 를 왼쪽 위
    // (스피커 자리) ← 로 바꾼다. 자리와 그림은 CSS 의 .help-mode 가 맡는다.
    // 시작·게임 화면은 그대로다.
    const onHelp = !el["help-dialog"].hidden;
    el["sound-button"].hidden = onHelp;
    el["stage-tools"].classList.toggle("help-mode", onHelp);
    // 도움말 버튼은 시작 화면에서만 보인다(사용자 지시).
    // 도움말을 보는 동안에는 자기 자신을 다시 누를 이유가 없으니 같이 내린다.
    el["help-button"].hidden = game.screen !== "start" || !el["help-dialog"].hidden;
  }

  function openDialog(dialog) {
    dialog.hidden = false;
    syncToolsVisibility();
    // 도움말이 열리고 닫힐 때 오른쪽 위 화살표의 뜻이 바뀐다.
    syncNavigation();
    sound.effect("open", 0.7);
  }

  function closeDialog(dialog) {
    dialog.hidden = true;
    syncToolsVisibility();
    syncNavigation();
  }

  /*
   * 정답 뒤 자동 발음. setTimeout 으로 불려 소리를 끄면 안 난다.
   * 2차 검수 SB4-확인1(사장님 2026-10-15 "스피커 버튼 삭제"): 게임 중 단어 듣기 스피커 버튼을 지웠다.
   * 문제를 풀고 난 뒤 저절로 들려주는 발음은 그대로다.
   */
  function playQuestionAudio() {
    const question = currentQuestion();
    if (!question) return;
    sound.word(question.soundUrl);
  }

  /*
   * 영어 단어는 첫 글자를 대문자로 보여 준다. maze.js 는 철자를 전부 소문자로
   * 저장하고 소문자끼리 비교하므로, 여기서 바꾸는 것은 화면에 찍히는 글자뿐이고
   * 경로 판정에는 영향이 없다.
   */
  /*
   * 검수 r7: 영단어는 모든 화면에서 소문자로 보여야 한다. 예전에는 첫 글자를
   * 대문자로 올렸는데(사용자 지시), 검수에서 뒤집혔다. 대문자를 떼는 것만으로는
   * 부족하다 — API 가 대문자로 시작하는 단어를 줄 수 있고, 격자는 maze.js 가
   * 따로 소문자로 낮추므로 같은 화면에서 격자만 소문자가 되기 때문이다.
   * 여기서 확실히 낮춘다. 미로 판정은 원래부터 소문자끼리 비교한다.
   */
  function displayWord(text) {
    return String(text ?? "").trim().toLocaleLowerCase("en-US");
  }

  /*
   * 여우는 상태에 따라 세 가지 애니메이션으로 바뀐다. 그림 파일을 갈아 끼우는
   * 방식이라, 같은 상태를 다시 넣을 때는 건드리지 않아 애니메이션이 끊기지 않게 한다.
   */
  const FOX_STATES = Object.freeze({
    idle: "assets/game/effect_ani_idle.webp",
    success: "assets/game/effect_ani_success.webp",
    failed: "assets/game/effect_ani_failed.webp",
  });

  function setFox(state) {
    const src = FOX_STATES[state] || FOX_STATES.idle;
    const fox = el["play-fox"];
    if (!fox || fox.dataset.state === state) return;
    fox.dataset.state = state;
    fox.src = src;
  }

  /* ---------------- 미로 그리기 ---------------- */

  function tileMetrics(cols, rows) {
    const byWidth = FIT_WIDTH / (cols + GAP_X_RATIO * (cols - 1));
    const byHeight = FIT_HEIGHT / (rows + GAP_Y_RATIO * (rows - 1));
    const tile = Math.min(byWidth, byHeight, MAX_TILE);
    return {
      tile,
      gapX: tile * GAP_X_RATIO,
      gapY: tile * GAP_Y_RATIO,
    };
  }

  function renderMaze(maze) {
    const { tile, gapX, gapY } = tileMetrics(maze.cols, maze.rows);
    const grid = el["maze-grid"];
    grid.style.setProperty("--cols", String(maze.cols));
    grid.style.setProperty("--tile", `${tile}px`);
    grid.style.setProperty("--gap-x", `${gapX}px`);
    grid.style.setProperty("--gap-y", `${gapY}px`);
    grid.textContent = "";

    game.cells = maze.cells.map((letter, index) => {
      // 검수 r7: 입구 칸도 소문자 그대로 보여 준다.
      const shown = letter;
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "maze-cell";
      button.dataset.index = String(index);
      // 철자 칸은 실로폰 음이 따로 나므로 공용 클릭음에서 뺀다(형제의 키와 같다).
      button.dataset.skipTouch = "true";
      // 글자만 따로 내려야 해서 span으로 감싼다. 버튼째로 옮기면 별 그림도 같이 움직인다.
      const glyph = doc.createElement("span");
      glyph.className = "maze-letter";
      glyph.textContent = shown;
      button.appendChild(glyph);
      button.setAttribute("role", "gridcell");
      button.setAttribute(
        "aria-label",
        `${Math.floor(index / maze.cols) + 1}행 ${(index % maze.cols) + 1}열 ${shown}`,
      );
      if (index === maze.startIndex) button.classList.add("is-start");
      grid.appendChild(button);
      return button;
    });

    // 화살표는 첫 철자 칸 왼쪽에 붙는다. 격자가 가운데 정렬이라 좌표를 직접
    // 계산한다. 좌표계는 .maze-area 안이므로 영역의 top은 더하지 않는다.
    const gridWidth = maze.cols * tile + (maze.cols - 1) * gapX;
    const gridHeight = maze.rows * tile + (maze.rows - 1) * gapY;
    const gridLeft = (STAGE_WIDTH - gridWidth) / 2;
    const gridTop = (MAZE_AREA_HEIGHT - gridHeight) / 2;
    // 입구는 첫 열이지만 0행이 아니다. 그 행에 맞춰 화살표를 놓는다.
    const startRow = Math.floor(maze.startIndex / maze.cols);
    const startTop = gridTop + startRow * (tile + gapY);
    const arrow = el["start-arrow"];
    arrow.hidden = false;
    arrow.style.left = `${gridLeft - ARROW_WIDTH - 12}px`;
    arrow.style.top = `${startTop + tile / 2 - ARROW_HEIGHT / 2}px`;

  }

  function setCellsEnabled(enabled) {
    game.cells.forEach((cell) => {
      cell.disabled = !enabled;
    });
  }

  /*
   * 반짝임은 철자 진행을 따라간다. 매 걸음마다 지금 눌러야 할 칸을 다시 칠해
   * 아이가 다음에 어디로 갈지 늘 알 수 있게 한다. 기획서의 "첫 철자 인접 3칸
   * 깜빡임"을 단어 끝까지 이어 놓은 것이다.
   */
  /*
   * 검수 r45: 가이드는 첫 글자에만 둔다. 예전에는 걸음마다 다음 칸을 반짝여
   * 사실상 길을 알려 주었는데, 그러면 스스로 철자를 찾는 놀이가 되지 않는다.
   * 이제 입구 칸만 반짝이고, 두 번째 철자부터는 직접 찾아야 한다.
   */
  function paintGuides() {
    const atStart = !game.progress || game.progress.length === 0;
    const candidates = atStart && game.maze
      ? Maze.nextCandidates(game.maze, game.progress)
      : [];
    const wanted = new Set(candidates);
    game.cells.forEach((cell, index) => {
      cell.classList.toggle("is-guide", wanted.has(index));
    });
  }

  function clearGuides() {
    game.cells.forEach((cell) => cell.classList.remove("is-guide"));
  }

  /* ---------------- 게임 진행 ---------------- */

  function currentQuestion() {
    return game.questions[game.index] || null;
  }

  /*
   * 점수판. 검수 r11 (부모 방 수정사항/전달_r11_보너스효과.md, 2026-09-14 개정판):
   * 보너스를 받으면 숫자가 최종값으로 튀지 않고 굴러 올라간다. 기준은 실로폰
   * wordmathch_spelling 의 updateScore·animateScore 다. 파이프 구현은 폴백을
   * 무효화하지 않아 전달문이 참고를 막았으므로 보지 않았다.
   *  - updateScore   굴림을 끊고 지금 점수를 바로 찍는다. 새 문제·감점·기회 소진·종료.
   *  - animateScore  보너스 판에서만 최대 0.72초 동안 굴려 올린다.
   * rAF 가 돌지 않는 환경을 위해 폴백 타이머를 함께 건다. 옛 굴림과 그 폴백은
   * 타이머 취소와 번호(scoreTweenToken) 두 겹으로 무효화한다 — 하나라도 빠지면
   * 재시작 뒤 옛 점수가 되살아나거나 연속 굴림에서 숫자가 한 프레임 되돌아간다.
   * scoreShown 은 지금 화면에 그려진 숫자다. tests/score-tween.test.mjs 가 이 함수들을
   * 소스에서 떼어 내 가짜 시계 위에서 검사한다.
   */
  let scoreShown = 0;
  let scoreTween = 0;
  let scoreTweenFallbackId = 0;
  let scoreTweenToken = 0;

  function prefersReducedMotion() {
    return Boolean(global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  function currentScore() {
    return game.board ? game.board.getState().score : 0;
  }

  /*
   * 검수 4차 10항(사장님 지시 2026-09-29): 점수는 1000 이 아니라 1,000 처럼 찍는다.
   * "en-US" 를 명시해야 브라우저 지역 설정에 따라 구분자가 달라지지 않는다.
   * 0 을 더해 -0 을 0 으로 눕힌다 — Math.round(-0.3) 은 -0 이고 (-0).toLocaleString() 은 "-0" 이라
   * 점수가 마이너스에서 0 으로 굴러 올라오는 마지막 한순간 "-0" 이 보인다(함정목록 9번).
   * 굴림 중간값도 이 함수를 지나므로 자리마다 따로 쓰지 않는다.
   * 개수(N개)·타이머·문항 번호·등급은 대상이 아니다.
   */
  function formatScore(value) {
    return (Math.round(Number(value) || 0) + 0).toLocaleString("en-US");
  }

  function renderScore(value) {
    el["score-value"].textContent = formatScore(value);
  }

  function cancelScoreTween() {
    scoreTweenToken += 1;
    if (scoreTween) {
      global.cancelAnimationFrame(scoreTween);
      scoreTween = 0;
    }
    global.clearTimeout(scoreTweenFallbackId);
    scoreTweenFallbackId = 0;
  }

  function updateScore() {
    cancelScoreTween();
    scoreShown = currentScore();
    renderScore(scoreShown);
  }

  function animateScore(target) {
    const to = Math.trunc(Number(target) || 0);
    const from = scoreShown;
    if (from === to || prefersReducedMotion()) {
      updateScore();
      return;
    }

    cancelScoreTween();
    const token = scoreTweenToken;
    const startedAt = Date.now();
    // 차이가 클수록 조금 길게, 최대 0.72초 (실로폰과 같다).
    const span = Math.min(720, 280 + Math.abs(to - from) * 2);

    // rAF 가 안 도는 환경(백그라운드 탭 등)에서 숫자가 옛 값에 멈추지 않게 한다.
    scoreTweenFallbackId = global.setTimeout(() => {
      if (token !== scoreTweenToken) return;
      if (scoreTween) {
        global.cancelAnimationFrame(scoreTween);
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
        scoreTween = global.requestAnimationFrame(step);
        return;
      }
      scoreShown = to;
      renderScore(to);
      scoreTween = 0;
      global.clearTimeout(scoreTweenFallbackId);
      scoreTweenFallbackId = 0;
    };
    scoreTween = global.requestAnimationFrame(step);
  }

  // 진행 표시만 갱신한다. 점수는 updateScore / animateScore 가 따로 맡는다 —
  // 여기서 점수를 바로 찍으면 보너스 굴림이 시작 값을 잃는다.
  function updateHud() {
    el["progress-value"].textContent = `${Math.min(game.index + 1, game.questions.length)}/${game.questions.length}`;
  }

  function updateClock() {
    el["timer-value"].textContent = Rules.formatClock(game.remainingSeconds);
    el["timer-value"].classList.toggle(
      "is-urgent",
      game.running && game.remainingSeconds <= URGENT_SECONDS,
    );
    el["timer-value"].classList.toggle(
      "is-final",
      game.running && game.remainingSeconds <= FINAL_SECONDS,
    );
  }

  /*
   * 뜻은 길이가 제각각이다. 상자를 넘치면 글자를 한 단계씩(5%) 줄여 칸 안에 들어가게 한다.
   * 글자를 미리 세지 않고 실제로 재서 맞춘다. 2차 수정으로 뜻 24자 거름을 걷었다 —
   * 87자는 0.40배 · 3줄로 들어간다(실측). 가장 작게(0.30배, 16.2px) 줄여도 넘치는 것은
   * 약 250자부터이고, 그때는 위아래가 잘린다. 그만큼 긴 뜻은 서버 쪽 문구를 줄일 일이다.
   *
   * 2026-10-02 사장님 답: 한글은 띄어쓰기에서만 줄을 나눈다(무대의 keep-all). 그래서 띄어쓰기 없는 한글
   * 덩어리도 영어 낱말처럼 한 덩어리다. 두 단계로 맞춘다 —
   *   1) 낱말을 나누지 않고 글자를 줄여 본다(예전 영어 긴 낱말과 같은 길).
   *   2) 가장 작게(0.30배) 줄여도 넘칠 때만 is-split-words 를 달아 낱말 안을 나누고 다시 줄인다.
   * 처음엔 뜻 칸에 overflow-wrap: anywhere 를 바로 걸었는데, 긴 영어 낱말이 줄이기 전에 낱말 안에서
   * 나뉘었다(antidisestablishmentarianism: 예전 0.55배 한 줄 → 0.70배 두 줄, 반박 리뷰).
   */
  function fitMeaningText() {
    const node = el["meaning-text"];
    const fits = () => node.scrollHeight <= node.clientHeight && node.scrollWidth <= node.clientWidth;
    const shrinkToFit = () => {
      node.style.setProperty("--meaning-scale", "1");
      for (let step = 0; step < 14; step += 1) {
        if (fits()) return true;
        node.style.setProperty("--meaning-scale", String(1 - (step + 1) * 0.05));
      }
      return fits();
    };
    node.classList.remove("is-split-words");
    if (shrinkToFit()) return;
    node.classList.add("is-split-words");
    shrinkToFit();
  }

  function showReveal(word, isCorrect) {
    const plate = el["answer-reveal-word"];
    plate.textContent = displayWord(word);
    // 긴 단어는 판을 넘지 않도록 글자를 줄인다.
    plate.classList.toggle("is-long", String(word).length > 9);
    el["answer-reveal"].classList.toggle("is-correct", Boolean(isCorrect));
    el["answer-reveal"].hidden = false;
  }

  function hideReveal() {
    el["answer-reveal"].hidden = true;
    // 보너스 동안 공개 위로 올렸던 점수 원도 공개와 함께 내려온다.
    clearScoreBonus();
  }

  function renderQuestion() {
    const question = currentQuestion();
    if (!question) {
      finishGame("완료");
      return;
    }

    game.maze = question.maze;
    game.progress = [];
    game.board.openQuestion();

    el["meaning-text"].textContent = question.meaning || "";
    fitMeaningText();

    hideReveal();
    endDrag();
    setFox("idle");
    renderMaze(question.maze);
    paintGuides();
    updateHud();
    // 새 문제·새 판은 점수를 바로 찍는다(굴림이 남아 있으면 끊는다).
    updateScore();
    // 검수 r13: 문제가 나올 때는 단어 사운드를 들려주지 않는다. 소리를 먼저 듣고
    // 철자를 맞히면 파닉스 학습이 되어 버리기 때문이다. 정답을 맞힌 뒤에만 낸다.
    setCellsEnabled(true);
    game.locked = false;
  }

  /*
   * 앞 판에서 예약해 둔 일이 새 판으로 넘어오지 않게 한다.
   * 다음 문제로 넘기기(2.3초) · 정답 길 칠하기 · 정답 뒤 자동 발음은 시간이 지난 뒤에 돈다.
   * 예전에는 이것들을 끄지 않아, 정답 공개 중에 X → Start 하거나 공개 중에 시간이 끝나
   * 곧바로 Try Again 을 누르면 새 판이 1번 문제에서 2번으로 건너뛰고, 앞 판 정답 길이 새 판
   * 칸에 칠해지고, 새 문제의 답 발음이 저절로 났다(실제 화면으로 재현). game.running 만 보면
   * 새 판에서 다시 true 가 되므로 막지 못한다 — 판 번호로 가른다.
   */
  function laterInRound(task, delayMs) {
    const round = game.round;
    return global.setTimeout(() => {
      if (round !== game.round) return;
      task();
    }, delayMs);
  }

  function advance(delayMs) {
    game.locked = true;
    setCellsEnabled(false);
    laterInRound(() => {
      if (!game.running) return;
      game.index += 1;
      if (game.index >= game.questions.length) {
        finishGame("완료");
        return;
      }
      renderQuestion();
    }, delayMs);
  }

  /*
   * 보너스 순간 Score 원에서 터지는 연출. 09-15 형제 카드·두더지 방 playScoreBonus 와
   * 같은 구성이다 — 원 둘레 금빛 링(실로폰 comboRing), 점수 숫자 금색 펀치
   * (comboScorePunch), 원 위로 떠오르는 "보너스 +100". 숫자 굴림은 animateScore 가 맡는다.
   *
   * 이 방만의 사정: 보너스를 받는 순간 정답 공개(z-index 20)가 무대 전체를 어둡게 덮는다.
   * 점수 원은 z-index 2 라 그대로 두면 굴림·링·표기가 전부 흐리게 묻힌다. 그래서 연출이
   * 도는 동안 is-bonus-lift 로 점수 원을 공개 위로 올리고, 공개가 닫힐 때(hideReveal) 내린다.
   * 링과 표기는 형제처럼 1.1초 뒤 걷지만, 원은 공개가 닫힐 때까지 위에 둔다 — 중간에
   * 내리면 남은 0.4초 동안 원이 다시 어두워지는 게 보인다.
   */
  const BONUS_EFFECT_MS = 1100;
  let scoreBonusTimer = 0;

  function playScoreBonus(amount) {
    const bonus = Math.trunc(Number(amount) || 0);
    const gauge = doc.querySelector(".gauge-score");
    const delta = el["score-delta"];
    if (bonus <= 0 || !gauge || !delta) return;
    global.clearTimeout(scoreBonusTimer);
    gauge.classList.remove("is-combo");
    delta.classList.remove("is-bonus");
    // 레이아웃을 한 번 읽어야 같은 클래스를 다시 붙일 때 애니메이션이 처음부터 돈다.
    void gauge.offsetWidth;
    delta.textContent = `보너스 +${formatScore(bonus)}`;
    gauge.classList.add("is-combo", "is-bonus-lift");
    delta.classList.add("is-bonus");
    scoreBonusTimer = global.setTimeout(endScoreBonusEffect, BONUS_EFFECT_MS);
  }

  // 1.1초 뒤 링과 표기만 걷는다. 점수 원은 정답 공개가 닫힐 때까지 위에 둔다.
  function endScoreBonusEffect() {
    global.clearTimeout(scoreBonusTimer);
    scoreBonusTimer = 0;
    doc.querySelector(".gauge-score")?.classList.remove("is-combo");
    const delta = el["score-delta"];
    if (delta) {
      delta.classList.remove("is-bonus");
      delta.textContent = "";
    }
  }

  function clearScoreBonus() {
    endScoreBonusEffect();
    doc.querySelector(".gauge-score")?.classList.remove("is-bonus-lift");
  }

  function handleComplete() {
    clearGuides();
    setFox("success");
    const question = currentQuestion();
    const result = game.board.completeQuestion();
    updateHud();

    sound.effect("success");
    // 기획서 2-1: 정답이 모두 완성되면 단어 사운드를 들려주고 다음 문제로.
    laterInRound(() => playQuestionAudio(), 320);

    showReveal(question.english, true);
    // 검수 r11: 보너스 판은 점수판을 굴려 올리고 Score 원에서 연출을 터뜨린다.
    // 보너스가 아닌 판은 즉시 반영한다. 정답 공개를 연 뒤에 켜야 점수 원이 그 위로 올라온다.
    if (result?.bonus) {
      animateScore(result.score);
      playScoreBonus(result.bonusDelta);
    } else {
      updateScore();
    }
    advance(REVEAL_CORRECT_MS);
  }

  function handleExhausted() {
    const question = currentQuestion();
    game.board.failQuestion();
    recordWrong(question);
    updateHud();
    updateScore();

    // 기획서: 정답과 단어 사운드를 제공한 뒤 다음 문제로 강제 전환.
    clearGuides();
    setFox("failed");
    const solution = Maze.solutionFrom(question.maze, game.progress);
    solution.forEach((cellIndex, step) => {
      laterInRound(() => {
        const cell = game.cells[cellIndex];
        if (cell) cell.classList.add("is-active");
      }, step * 90);
    });

    sound.effect("lose", 0.8);
    showReveal(question.english, false);
    laterInRound(() => playQuestionAudio(), 700);
    advance(REVEAL_FAIL_MS);
  }

  function activateCell(index, button) {
    game.progress.push(index);
    button.classList.add("is-active");
    button.disabled = true;
    sound.note(game.progress.length - 1);
    paintGuides();
  }

  /*
   * 오답노트는 단어마다 한 줄이다.
   *
   * 2차 검수 SB공통-1(사장님 2026-10-12 · 10-15): 오답노트에는 **3번 모두 틀린 문제만** 싣는다.
   * 한두 번 틀리고 맞힌 문제와, 시간이 끝날 때 화면에 떠 있던 문제(3번을 다 틀리지 않은 문제)는
   * 싣지 않는다. 그래서 기회를 다 쓴 그 순간(handleExhausted)에서만 부른다.
   * 예전 규칙 — 틀릴 때마다 적기, 4차 q58 "시간 종료 때 출제된 못 맞힌 문제 채워 넣기" — 은 폐기다.
   * 결과 화면 Incorrect 숫자도 이 목록의 줄 수다(공통-10). 점수 감점은 틀릴 때마다 그대로다.
   */
  function recordWrong(question) {
    if (!question || game.wrongRecords.has(question.english)) return;
    game.wrongRecords.set(question.english, {
      english: question.english,
      meaning: question.meaning,
      soundUrl: question.soundUrl,
    });
  }

  function registerWrong(button) {
    // 기획서: 오답은 이미지 변화 없음. 소리와 흔들림으로만 알린다.
    sound.effect("fail", 0.8);
    button.classList.remove("is-wrong");
    // 리플로를 한 번 강제해야 같은 칸을 연달아 눌러도 애니메이션이 다시 돈다.
    void button.offsetWidth;
    button.classList.add("is-wrong");

    const outcome = game.board.registerMistake();
    updateHud();
    updateScore();
    if (outcome.exhausted) handleExhausted();
  }

  /*
   * 미로에서 고를 수 있는 칸은 지금 서 있는 칸에 붙어 있는 칸뿐이다. 끌고 가다
   * 멀리 떨어진 칸을 스치는 것은 선택이 아니므로 조용히 넘긴다. 붙어 있는데
   * 글자가 틀렸거나 출구가 아닌 칸에서 끝내려 할 때만 오답으로 센다.
   */
  function attemptCell(index) {
    if (game.locked || !game.running) return;
    if (!Number.isInteger(index)) return;
    const button = game.cells[index];
    if (!button) return;

    const verdict = Maze.judge(game.maze, game.progress, index);
    if (verdict.correct) {
      activateCell(index, button);
      if (verdict.complete) handleComplete();
      return;
    }
    if (verdict.reason === "letter"
      || verdict.reason === "not_exit"
      || verdict.reason === "dead_end") {
      registerWrong(button);
    }
  }

  function cellIndexFromPoint(x, y) {
    const node = doc.elementFromPoint(x, y);
    const button = node && node.closest ? node.closest(".maze-cell") : null;
    if (!button || button.parentElement !== el["maze-grid"]) return null;
    return Number(button.dataset.index);
  }

  function endDrag() {
    game.dragging = false;
    game.pointerIndex = null;
  }

  function handlePointerDown(event) {
    const button = event.target.closest?.(".maze-cell");
    if (!button) return;
    // 끌기 도중 글자가 선택되거나 화면이 스크롤되지 않게 한다.
    event.preventDefault();
    game.dragging = true;
    game.pointerIndex = Number(button.dataset.index);
    // 포인터가 격자 밖으로 나가도 move와 up을 계속 받는다.
    try {
      el["maze-grid"].setPointerCapture(event.pointerId);
    } catch {
      /* 포인터 캡처를 지원하지 않으면 창 이벤트로 받는다. */
    }
    attemptCell(game.pointerIndex);
  }

  function handlePointerMove(event) {
    if (!game.dragging) return;
    const index = cellIndexFromPoint(event.clientX, event.clientY);
    if (index === null || index === game.pointerIndex) return;
    game.pointerIndex = index;
    attemptCell(index);
  }

  function handleGridKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const button = event.target.closest?.(".maze-cell");
    if (!button) return;
    event.preventDefault();
    attemptCell(Number(button.dataset.index));
  }

  /* ---------------- 타이머 ---------------- */

  function stopTimer() {
    if (game.timerId !== null) {
      global.clearInterval(game.timerId);
      game.timerId = null;
    }
  }

  function startTimer(seconds) {
    stopTimer();
    game.deadline = Date.now() + seconds * 1000;
    game.remainingSeconds = seconds;
    updateClock();
    game.timerId = global.setInterval(() => {
      const left = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
      if (left === game.remainingSeconds) return;
      game.remainingSeconds = left;
      updateClock();
      if (left <= 0) {
        // 기획서: 시간이 종료되면 엔딩 페이지로 이동.
        finishGame("시간 종료");
      }
    }, TIMER_TICK_MS);
  }

  /* ---------------- 시작과 종료 ---------------- */

  /*
   * 검수 4차 9-2: 결과화면 X 는 시작 화면으로 나간다. "다시 하기"와 달리 그 판은 끝나므로
   * 점수 저장이 끝난 뒤에 움직이고, 점수·타이머·오답 목록·열린 팝업을 모두 비운다.
   */
  let resultSaving = null;

  function returnToStart() {
    // 회원 판은 점수 저장이 끝난 뒤에 나간다. 그 사이 Try Again 으로 새 판이 열렸으면
    // 늦게 도는 leave 가 그 판을 끊고 시작 화면으로 보내면 안 된다 — 나중에 누른 쪽이 이긴다.
    const round = game.round;
    const leave = () => {
      if (round !== game.round) return;
      stopTimer();
      game.running = false;
      game.locked = true;
      if (!el["incorrect-answer-dialog"].hidden) closeDialog(el["incorrect-answer-dialog"]);
      hideReveal();
      game.board = null;
      game.questions = [];
      game.index = 0;
      game.progress = [];
      game.wrongRecords = new Map();
      resultSaving = null;
      updateScore();
      sound.blockBgm(false);
      showScreen("start");
    };
    if (resultSaving && typeof resultSaving.finally === "function") {
      resultSaving.finally(leave);
      return;
    }
    leave();
  }

  /*
   * 앞 판에서 마지막으로 화면에 나왔던 단어. 열 문제를 다 풀면 index 가 끝을 넘으므로
   * 마지막 문제로 눌러 둔다.
   */
  function lastServedWord() {
    if (!game.questions.length) return game.lastWord;
    const index = Math.min(Math.max(0, game.index), game.questions.length - 1);
    return game.questions[index]?.english || game.lastWord;
  }

  // 게임 중 X. 진행 중이던 판은 버리고 시작 화면으로 돌아간다.
  // 2차 공통(다시 시작): 다음 판이 이 단어로 시작하지 않게 적어 둔다.
  function quitToStart() {
    game.lastWord = lastServedWord();
    stopTimer();
    game.running = false;
    game.locked = true;
    endDrag();
    hideReveal();
    showScreen("start");
  }

  function startGame() {
    /*
     * 2차 공통(다시 시작): 판을 시작할 때마다 새로 뽑고, 앞 판 마지막 단어로 시작하지
     * 않는다 — Try Again · 결과 X → Start · 게임 중 X → Start 모두. 예전에는 Try Again 만
     * 새로 뽑아서, 결과 X 나 게임 중 X 로 나갔다가 Start 를 누르면 같은 목록·같은 순서·
     * 같은 미로가 다시 나왔다. 첫 판(앞 판이 없을 때)은 불러올 때 뽑은 것을 쓴다.
     */
    if (game.lastWord) Content.rebuildQuestions({ avoidFirst: game.lastWord });
    game.round += 1;
    const snapshot = Content.getState();
    game.questions = snapshot.content.questions;
    if (game.questions.length === 0) {
      setLoading(true, "출제할 단어가 없습니다", "이 콘텐츠에는 미로로 낼 수 있는 단어가 없습니다.", { error: true, retry: true });
      return;
    }

    game.index = 0;
    game.wrongRecords = new Map();
    resultSaving = null;
    sound.blockBgm(false);
    game.board = Rules.createScoreboard({
      questionCount: game.questions.length,
      playTimeSeconds: Content.playTimeSeconds(),
    });
    game.running = true;

    showScreen("play");
    renderQuestion();
    startTimer(game.board.settings.playTimeSeconds);
  }

  /*
   * 결과 화면. 형제 프로젝트와 같이 정답·오답·보너스 자리에는 개수가 아니라
   * 항목별 점수가 들어간다. 저장 문구는 history API 응답으로 채운다.
   *
   * 검수 4차 q51(기준 방 실로폰): My Score 에 순위를 내지 않는다. 점수만 남긴다.
   * history 응답의 rank 는 받기만 하고 화면에 쓰지 않는다.
   */
  function renderResultScore(score) {
    el["result-total-value"].textContent = formatScore(score);
    el["result-total-score"].setAttribute("aria-label", `${formatScore(score)}점`);
  }

  function resultMessage(correctCount, questionCount) {
    return `${questionCount}문제 중 ${correctCount}개를 맞혔어요!`;
  }

  function fillResult() {
    const state = game.board.getState();
    // 사장님 지시(2026-09-29): 등급은 "전체 제공 문제수 기준" 이다. 시간이 끝나 손도 못 댄 문제도
    // 분모에 든다. 예전에는 푼 문제 수(맞힌 수 + 틀린 수)로 나눴고 "세 문제 풀어 셋 다 맞히면
    // Excellent" 였는데, 그 기준은 폐기됐다 — 검수_4차/공통_적용.md 5항.
    const tier = Rules.resultTier(state.correctCount, game.questions.length);
    const headline = el["result-headline"];
    // 검수 4차 7항: 3차 r10 으로 내용이 바뀐 제목 그림이라 주소에도 캐시 버전을 단다.
    headline.src = `assets/result/result_text${tier}.png?v=20260929`;
    headline.alt = ["Excellent", "Good", "Try again"][tier];
    // 등급별 여우도 같은 숫자로 고른다. 등급 판정은 Rules.resultTier 한 곳뿐이라 갈래가 생기지 않는다.
    // 주소와 캐시 버전은 미리 받아 둘 때 쓴 것과 같은 자리(foxSource)에서 나온다.
    el["result-fox"].src = foxSource(tier);

    // 검수 4차 6항(2026-09-29): Correct·Incorrect 는 점수가 아니라 개수로 찍는다. Incorrect 개수는
    // 오답노트에 실리는 줄 수와 반드시 같아야 하므로 같은 값을 쓴다(2차 검수 공통-10). Bonus 와 My Score 는 점수다.
    // 2차 검수 공통-2(완료화면 통일): 숫자 뒤 '개' 를 지우고, Bonus 는 앞 '+' 를 지운다. Bonus 숫자 뒤 '점' 은
    // CSS(.result-points::after)가 붙인다 — 숫자 끝 세 줄이 한 줄로 서도록 Correct·Incorrect 에도 같은 폭의 빈 자리를 둔다.
    const wrongCount = game.wrongRecords.size;
    el["result-correct"].textContent = String(state.correctCount);
    el["result-incorrect"].textContent = String(wrongCount);
    el["result-bonus"].textContent = formatScore(state.bonusPoints);
    el["result-correct"].setAttribute("aria-label", `정답 ${state.correctCount}개`);
    el["result-incorrect"].setAttribute("aria-label", `오답 ${wrongCount}개`);
    el["result-bonus"].setAttribute("aria-label", `보너스 점수 ${formatScore(state.bonusPoints)}점`);
    renderResultScore(state.score);
    // 2차 검수 공통-2(Spelling Builder): 아래 문구는 "00문제 중 00개를 맞혔어요!" 하나로 통일한다.
    // 분모는 등급과 같은 전체 제공 문제수다.
    el["result-message"].textContent = resultMessage(state.correctCount, game.questions.length);
    // 검수 4차 9-1: 누를 수 없는 버튼은 회색으로 두지 않고 자리까지 감춘다. 남은 버튼은 가운데로 모인다.
    el["incorrect-answers-button"].hidden = wrongCount === 0;
    el["incorrect-answers-button"].disabled = wrongCount === 0;
    el["incorrect-answers-button"].setAttribute(
      "aria-label",
      wrongCount > 0 ? `오답 ${wrongCount}개 보기` : "오답 없음",
    );

    sound.effect(RESULT_SOUNDS[tier], 0.9);
    return tier;
  }

  /*
   * 점수 저장. 저장은 그대로 하고, 결과를 화면 문구로 알리지 않는다.
   * 2차 검수 공통-2: 아래 문구 자리는 "00문제 중 00개를 맞혔어요!" 로 통일됐다 — 예전에 이 자리에 찍던
   * "점수를 저장했습니다." · "게스트 점수는 저장되지 않습니다." · 테스트/데모 안내 · 저장 실패 문구는 걷었다.
   * 저장에 실패하면 콘솔에만 남긴다. 시작 화면으로 나가는 X 는 저장이 끝나기를 기다린다(resultSaving).
   */
  function persistResult() {
    const score = game.board.getState().score;
    let saving = null;
    try {
      saving = Content.saveHistory(score);
      resultSaving = saving;
    } catch (error) {
      global.console?.warn?.("점수를 저장하지 못했습니다.", error);
      return;
    }
    if (!saving || typeof saving.then !== "function") return;
    saving.catch((error) => {
      global.console?.warn?.("점수를 저장하지 못했습니다.", error);
    });
  }

  function finishGame() {
    if (!game.running) return;
    game.running = false;
    game.locked = true;
    stopTimer();
    setCellsEnabled(false);
    hideReveal();
    // 굴림이 남아 있으면 끊고 최종 점수를 바로 찍는다.
    updateScore();

    // 2차 검수 SB공통-1: 시간이 끝날 때 떠 있던 문제는 오답노트에 넣지 않는다(3번 모두 틀린 문제만).

    // 2차 공통(다시 시작): 다음 판이 이 단어로 시작하지 않게 적어 둔다.
    game.lastWord = lastServedWord();
    const tier = fillResult();
    showScreen("end");
    // 검수 4차 9-3: 결과화면에서는 BGM 을 멈춘다. 효과음은 그대로다.
    sound.blockBgm(true);
    if (RESULT_CONFETTI[tier]) emitConfetti();
    persistResult();
  }

  /* ---------------- 결과 파티클 ---------------- */

  /*
   * 결과 화면 색종이. wordmathch_spelling과 같은 방식이다 — 캔버스에 사각 조각을
   * 흩뿌리고 흔들리며 떨어지게 한다. 화면을 벗어나면 스스로 멈춘다.
   */
  const PARTICLE_COLORS = Object.freeze([
    "#fff044", "#ff7338", "#25dfff", "#ff4ca8", "#ffffff", "#6bf06f",
  ]);

  let particleFrame = 0;
  let particles = [];

  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  function clearParticles() {
    if (particleFrame) global.cancelAnimationFrame(particleFrame);
    particleFrame = 0;
    particles = [];
    el["result-particle-canvas"]?.getContext("2d")?.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  }

  function emitConfetti() {
    clearParticles();
    const context = el["result-particle-canvas"]?.getContext("2d", { alpha: true });
    if (!context) return;

    const reduced = global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const count = reduced ? 28 : 96;
    const startedAt = global.performance.now();
    particles = Array.from({ length: count }, (_, index) => ({
      x: randomBetween(18, STAGE_WIDTH - 18),
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
      duration: randomBetween(4800, 6800),
      delay: randomBetween(0, 1300),
    }));

    function render(now) {
      const elapsed = now - startedAt;
      context.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
      let active = 0;

      particles.forEach((particle) => {
        const age = elapsed - particle.delay;
        if (age < 0 || age >= particle.duration) return;
        active += 1;
        const frames = age / 16.667;
        const progress = age / particle.duration;
        const x = particle.x + particle.vx * frames
          + Math.sin(particle.phase + age * 0.006) * particle.sway * 18;
        const y = particle.y + particle.vy * frames + particle.gravity * frames * frames;

        context.save();
        context.globalAlpha = Math.min(1, (1 - progress) * 1.5);
        context.translate(x, y);
        context.rotate(particle.rotation + particle.spin * frames);
        context.fillStyle = particle.color;
        context.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
        context.restore();
      });

      if (active > 0 || elapsed < 1300) {
        particleFrame = global.requestAnimationFrame(render);
      } else {
        particleFrame = 0;
      }
    }

    particleFrame = global.requestAnimationFrame(render);
  }

  /* ---------------- 오답노트 / 랭킹 / 도움말 ---------------- */

  function cell(className, text) {
    const node = doc.createElement("div");
    node.className = `incorrect-answer-cell ${className}`;
    node.setAttribute("role", "cell");
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 긴 단어는 칸을 넘지 않도록 글자 크기를 줄인다.
  /*
   * 긴 단어는 칸에 들어갈 때까지 줄인다. 바닥은 24px 이다.
   * 기준 크기를 숫자로 적어 두면 CSS 를 바꿀 때 또 어긋난다 — q55 로 단어 글자를 38px 에서 31px 로
   * 줄였을 때 적어 둔 38 이 남아 바닥이 19.6px 까지 내려갔다(4차 함정목록 16번, 레이싱·실로폰도 같은 곳).
   * 그래서 배율을 1 로 되돌린 뒤 계산된 글자 크기를 읽어 분모로 쓴다. 형제 실로폰과 같은 방식이다.
   */
  const WORD_MIN_FONT_PX = 24;

  function fitWordText(textNode) {
    const host = textNode.closest(".incorrect-answer-word");
    if (!host) return;
    host.style.setProperty("--incorrect-word-scale", "1");
    const base = Number.parseFloat(global.getComputedStyle(host).fontSize) || WORD_MIN_FONT_PX;
    for (let size = base; size > WORD_MIN_FONT_PX && textNode.scrollWidth > textNode.clientWidth; size -= 1) {
      host.style.setProperty("--incorrect-word-scale", String((size - 1) / base));
    }
  }

  function renderIncorrectList() {
    const body = el["incorrect-answer-list"];
    body.textContent = "";

    // 모두 3번씩 틀린 단어라 횟수로 가를 것이 없다. 틀린 순서 그대로 싣는다.
    const records = [...game.wrongRecords.values()];

    if (records.length === 0) {
      const empty = doc.createElement("p");
      empty.className = "incorrect-answer-empty";
      empty.textContent = "오답이 없습니다.";
      body.appendChild(empty);
      return;
    }

    const fragment = doc.createDocumentFragment();
    records.forEach((record) => {
      const row = doc.createElement("div");
      row.className = "incorrect-answer-row incorrect-answer-grid";
      row.setAttribute("role", "row");

      // 사용자 지시: 발음 주소가 없는 단어는 스피커 자리를 비운다.
      const audio = cell("incorrect-answer-audio");
      if (record.soundUrl) {
        const speaker = doc.createElement("button");
        speaker.type = "button";
        speaker.className = "incorrect-answer-speaker";
        speaker.setAttribute("aria-label", `${displayWord(record.english)} 발음 듣기`);
        const icon = doc.createElement("img");
        icon.src = "assets/incorrect-answer/icon_speaker.png";
        icon.alt = "";
        icon.width = 37;
        icon.height = 30;
        icon.draggable = false;
        speaker.appendChild(icon);
        speaker.addEventListener("click", () => sound.word(record.soundUrl, null, { manual: true }));
        audio.appendChild(speaker);
      }

      const word = cell("incorrect-answer-word");
      const wordText = doc.createElement("span");
      wordText.className = "incorrect-answer-word-text";
      wordText.textContent = displayWord(record.english);
      word.appendChild(wordText);

      row.append(
        audio,
        word,
        cell("incorrect-answer-meaning", record.meaning || "정답 뜻 확인 필요"),
      );
      fragment.appendChild(row);
    });

    body.appendChild(fragment);
    body.scrollTop = 0;
    global.requestAnimationFrame(() => {
      body.querySelectorAll(".incorrect-answer-word-text").forEach(fitWordText);
    });
  }

  // 배지 그림이 오면 쓰고, 없거나 못 불러오면 글자로 대신한다.
  /*
   * 형제 프로젝트와 같은 구조다. help API 의 title/content 를 섹션으로 뿌리고,
   * 첫 제목만 주황, 나머지는 보라로 나온다(색은 CSS가 정한다).
   */
  function renderHelp(items) {
    const box = el["help-content"];
    global.setTimeout(syncHelpOverflow, 0);
    box.textContent = "";
    const fragment = doc.createDocumentFragment();
    items.forEach((item) => {
      const section = doc.createElement("section");
      section.className = "help-section";
      if (item?.title) {
        const title = doc.createElement("h3");
        title.className = "help-section-title";
        title.textContent = item.title;
        section.appendChild(title);
      }
      if (item?.content) {
        const content = doc.createElement("p");
        content.className = "help-section-content";
        content.textContent = item.content;
        section.appendChild(content);
      }
      fragment.appendChild(section);
    });
    box.appendChild(fragment);
    el["help-status"].hidden = true;
    document.querySelector(".help-content-viewport").scrollTop = 0;
  }

  function setHelpStatus(text, showRetry) {
    el["help-status"].hidden = false;
    el["help-status-text"].textContent = text;
    el["help-retry-button"].hidden = !showRetry;
  }

  /*
   * 도움말이 아래로 더 남았는지 표시한다. 내용 길이는 API 응답에 따라 달라지므로
   * 열 때와 굴릴 때, 그리고 창 크기가 바뀔 때마다 다시 잰다.
   */
  function syncHelpOverflow() {
    const viewport = doc.querySelector(".help-content-viewport");
    if (!viewport) return;
    const more = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 4;
    el["help-dialog"].classList.toggle("has-more", more);
  }

  function openHelp() {
    openDialog(el["help-dialog"]);
    // 두 번째로 열 때 지난번 굴린 자리가 남아 있으면 중간부터 보인다.
    const viewport = doc.querySelector(".help-content-viewport");
    if (viewport) viewport.scrollTop = 0;
    el["help-content"].textContent = "";
    setHelpStatus("도움말을 불러오는 중입니다.", false);
    Content.getHelp()
      .then(renderHelp)
      .catch(() => setHelpStatus("도움말을 불러오지 못했습니다.", true));
  }

  /* ---------------- 부트스트랩 ---------------- */

  function enableStartMenu() {
    const launch = Content.getState().launch;
    el["start-button"].disabled = false;
    el["start-button"].removeAttribute("aria-busy");
    el["help-button"].disabled = false;
  }

  /*
   * 2026-10-02 사장님: 한글 표기는 전부 나눔스퀘어라운드(같은 날 Bold → ExtraBold). 글꼴을 받기 전에 글자를 재면
   * 대체 글꼴로 잰 값이 남는다(뜻 칸 줄이기 · 도움말 넘침 표시). 불러오는 동안 함께 받아 두고,
   * 받은 뒤에 시작 화면을 연다. 파일이 없거나 늦어도 게임은 막지 않는다 — 3초 뒤에는 그냥 연다.
   * 한글만 맡는 이름(NanumSquareRound Hangul)은 unicode-range 라 한글 글자를 줘야 받는다.
   */
  const KOREAN_FONTS = ['700 1em "NanumSquareRound Game"', '700 1em "NanumSquareRound Hangul"'];
  const KOREAN_FONT_WAIT_MS = 3000;
  let koreanFontReady = null;

  function loadKoreanFont() {
    if (!koreanFontReady) {
      const fonts = doc.fonts;
      const loading = fonts && typeof fonts.load === "function"
        ? Promise.all(KOREAN_FONTS.map((font) => fonts.load(font, "가"))).catch(() => [])
        : Promise.resolve([]);
      // 오답 목록 전용 나눔 Bold(2026-10-15)는 미리 받아만 둔다 — 결과 화면에서 처음 열 때 글자가 비지 않게.
      // 시작 화면을 여는 조건(KOREAN_FONTS)에는 넣지 않는다.
      if (fonts && typeof fonts.load === "function") fonts.load('500 1em "NanumSquareRound List"', "가").catch(() => {});
      const timeout = new Promise((resolve) => global.setTimeout(resolve, KOREAN_FONT_WAIT_MS, []));
      koreanFontReady = Promise.race([loading, timeout]);
    }
    return koreanFontReady;
  }

  /*
   * 나눔을 실제로 받았는지 보고 그에 맞춘다. 3초 안에 오지 않으면 시작 화면은 시스템 글꼴로 열리고,
   * 나중에 도착하면 font-display: block 이 그때 나눔으로 바꿔 그린다. 그러면 시스템 글꼴로 맞춘 칸
   * (뜻 칸 줄이기 · 도움말 넘침 표시 · 점수 배지 내림)을 나눔으로 다시 맞춰야 한다. 글꼴 받기가 끝날
   * 때마다(loadingdone) 다시 부른다.
   */
  function onKoreanFontLoaded() {
    const fonts = doc.fonts;
    const ready = Boolean(fonts && typeof fonts.check === "function" && fonts.check(KOREAN_FONTS[0], "가"));
    doc.documentElement.classList.toggle("korean-font-ready", ready);
    if (!ready) return;
    if (game.screen === "play") fitMeaningText();
    if (game.screen === "start") fitStartStory();
    syncHelpOverflow();
  }

  /*
   * 2차 검수 공통-9: 시작 화면 로고와 Start 사이의 동화 정보 — 1줄 title, 2줄 subtitle.
   * 사장님(OX 방, 2026-10-12): 배경은 투명하게 하고 글자는 잘 보이게, 글자 범위는 그대로 두되 길어지면
   * 글자 크기를 줄인다. 그래서 두 줄을 같은 배율로 0.02 씩 줄이고(바닥 0.5배), 그래도 넘칠 때만 말줄임이다.
   * 제목이 없으면(데모 · info 실패 · 빈 값) 동화 정보만 숨기고 배치는 그대로 둔다.
   */
  const STORY_MIN_SCALE = 0.5;

  function renderStartStory() {
    const { title, subtitle } = Content.storyInfo();
    el["start-story-title"].textContent = title;
    el["start-story-subtitle"].textContent = subtitle;
    el["start-story-title"].hidden = !title;
    el["start-story-subtitle"].hidden = !subtitle;
    el["start-story"].hidden = !title && !subtitle;
    fitStartStory();
  }

  function fitStartStory() {
    const box = el["start-story"];
    if (box.hidden) return;
    const lines = [el["start-story-title"], el["start-story-subtitle"]].filter((line) => !line.hidden);
    const overflows = () => lines.some((line) => line.scrollWidth > line.clientWidth + 0.5);
    let scale = 1;
    box.style.setProperty("--story-scale", "1");
    while (scale > STORY_MIN_SCALE && overflows()) {
      scale = Math.max(STORY_MIN_SCALE, Math.round((scale - 0.02) * 100) / 100);
      box.style.setProperty("--story-scale", String(scale));
    }
  }

  function load() {
    setLoading(true, "게임 준비 중", "단어와 게임 정보를 불러오고 있습니다.");
    Content.bootstrap({ force: true })
      .then(() => loadKoreanFont())
      .then(() => {
        onKoreanFontLoaded();
        setLoading(false);
        showScreen("start");
        renderStartStory();
        enableStartMenu();
      })
      .catch((error) => {
        // 형제와 같다 — fc_id가 없는 것은 다시 눌러도 풀리지 않으므로 재시도를 감춘다.
        const missingContent = error?.code === "MISSING_FC_ID";
        setLoading(
          true,
          missingContent ? "콘텐츠 정보가 없습니다" : "게임을 준비하지 못했습니다",
          error?.message || "잠시 후 다시 시도해 주세요.",
          { error: true, retry: !missingContent },
        );
      });
  }

  function bindEvents() {
    global.addEventListener("resize", fitStage);
    global.addEventListener("orientationchange", fitStage);

    // 기획서 보완 지시: 끌면서 별이 바뀌어야 한다. 탭도 같은 경로로 처리된다.
    el["maze-grid"].addEventListener("pointerdown", handlePointerDown);
    el["maze-grid"].addEventListener("pointermove", handlePointerMove);
    el["maze-grid"].addEventListener("pointerup", endDrag);
    el["maze-grid"].addEventListener("pointercancel", endDrag);
    el["maze-grid"].addEventListener("keydown", handleGridKeyDown);
    global.addEventListener("pointerup", endDrag);

    el["start-button"].addEventListener("click", startGame);
    el["retry-button"].addEventListener("click", load);

    // 새로 뽑는 일은 startGame 이 맡는다(어느 길로 다시 시작하든 같은 규칙).
    el["try-again-button"].addEventListener("click", startGame);
    el["result-home-button"].addEventListener("click", returnToStart);
    el["incorrect-answers-button"].addEventListener("click", () => {
      renderIncorrectList();
      openDialog(el["incorrect-answer-dialog"]);
    });

    [
      ["incorrect-answer-dialog", ["incorrect-answer-backdrop", "incorrect-answer-close"]],
    ].forEach(([dialogId, closers]) => {
      closers.forEach((closerId) => {
        el[closerId].addEventListener("click", () => closeDialog(el[dialogId]));
      });
    });

    el["help-button"].addEventListener("click", openHelp);
    doc.querySelector(".help-content-viewport")
      ?.addEventListener("scroll", syncHelpOverflow, { passive: true });
    el["help-retry-button"].addEventListener("click", () => {
      setHelpStatus("도움말을 불러오는 중입니다.", false);
      Content.getHelp({ retry: true })
        .then(renderHelp)
        .catch(() => setHelpStatus("도움말을 불러오지 못했습니다.", true));
    });

    el["sound-button"].addEventListener("click", () => {
      const muted = sound.setMuted(!sound.isMuted());
      el["sound-button"].classList.toggle("is-on", !muted);
      el["sound-button"].setAttribute("aria-pressed", String(!muted));
      el["sound-button"].setAttribute("aria-label", muted ? "소리 켜기" : "소리 끄기");
      // 켤 때만 확인음을 낸다. 2차 수정(PDF 3쪽 "Sound on, off 안내 팝업 삭제"):
      // 켜고 끌 때 "Sound On/Off" 안내는 띄우지 않는다. 버튼 그림이 상태를 보여 준다.
      if (!muted) sound.effect("touch", 0.7);
    });

    /*
     * 버튼 클릭음. 형제처럼 무대 하나에 캡처 단계로 걸어 둔다. 사운드 버튼은
     * 자기 확인음이 따로 있어 빼고, data-skip-touch를 단 버튼도 건너뛴다.
     */
    el["game-stage"].addEventListener("click", (event) => {
      // 어떤 조작이든 첫 클릭이면 배경음을 깨운다(브라우저 자동재생 제한 때문).
      sound.startBgm();
      const button = event.target.closest?.("button");
      if (!button
        || button.disabled
        || button === el["sound-button"]
        || button.dataset.skipTouch === "true") return;
      sound.effect("touch", 0.7);
    }, { capture: true });

    el["navigation-button"].addEventListener("click", () => {
      if (!el["help-dialog"].hidden) {
        closeDialog(el["help-dialog"]);
        return;
      }
      if (game.screen === "start") {
        closeGame();
        return;
      }
      quitToStart();
    });

    doc.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      [el["incorrect-answer-dialog"], el["help-dialog"]]
        .forEach((dialog) => closeDialog(dialog));
    });
  }

  function init() {
    fitStage();
    bindEvents();
    sound.preload();
    // 단어를 불러오는 동안 한글 글꼴도 같이 받기 시작한다. 늦게 와도 다시 맞춘다.
    doc.fonts?.addEventListener?.("loadingdone", onKoreanFontLoaded);
    loadKoreanFont();
    showScreen("loading");
    load();
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
