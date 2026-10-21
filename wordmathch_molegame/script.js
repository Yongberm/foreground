(function bootMoleGame(global) {
  "use strict";

  const doc = global.document;
  const Mole = global.MoleGame;
  const Rules = global.MoleGameRules;
  const Content = global.MoleGameContent;

  // 그림 주소를 조립해 부를 때 붙이는 판 번호. index.html 의 `?v=` 와 같은 값을 쓴다.
  const ASSET_VERSION = "2026-10-15e";

  const STAGE_WIDTH = 1920;
  const STAGE_HEIGHT = 1080;

  /*
   * 팻말은 한 판씩 깔린다(검수 r38). 짝마다 9~12초 뒤 따로 내려가던 예전
   * 방식은 "나타났다 없어지는 것이 비규칙적이라 혼란스럽다"는 검수를 받았다.
   * 이제 한 판이 Mole.WAVE_SECONDS(10초) 동안 머물고, 그 시계는 mole.js 의
   * createWaveClock 이 센다.
   */
  // 남은 팻말이 사라지는 애니메이션(boardFade 300ms)을 기다리는 시간.
  const WAVE_LEAVE_MS = 320;
  // 판이 비고 나서 다음 판이 올라오기까지.
  const REFILL_DELAY_MS = 620;
  /*
   * WM6-2(검수 No.91 "팻말 터치할 때마다 효과 동일하게"): 두 번째로 누른 팻말도 첫 팻말과 같은 하이라이트(is-picked)를
   * 이만큼 보인 뒤에 짝이면 두 장이 함께 사라지고, 짝이 아니면 함께 흔들린다. 예전에는 두 번째 팻말이 하이라이트 없이
   * 곧바로 사라지거나 흔들렸다.
   */
  const PICK_HOLD_MS = 280;
  const WRONG_HOLD_MS = 520;
  const TIMER_TICK_MS = 200;
  /*
   * 남은 시간 경고(2차 수정, 공통 문서 2절). 남은 10초부터 시간 숫자와 타임바가 빨강으로
   * 깜박이고, 5초부터는 더 빠르게 깜박인다. 화면 가장자리 붉은 빛은 넣지 않는다.
   * 예전에는 15초부터 노랑이었다.
   */
  const URGENT_SECONDS = 10;
  const CRITICAL_SECONDS = 5;
  // 보너스 환호를 보여 주는 시간. 지나면 콤보 칸이 빈 상태로 돌아간다.
  const COMBO_CHEER_MS = 900;
  // 판 등장 애니메이션(340ms)이 끝났다고 볼 시각. animationend 가 오지 않아도
  // 이 시간이 지나면 클래스를 떼어 판을 평소 상태로 돌린다.
  const BOARD_ENTER_FALLBACK_MS = 600;

  let comboResetTimer = 0;
  let comboCheering = false;

  const el = {};
  const ids = [
    "game-stage", "stage-tools", "help-button", "sound-button", "navigation-button",
    "status-toast",
    "start-screen", "start-button", "start-ranking-button",
    "start-story", "start-story-title", "start-story-subtitle",
    "play-screen", "board-field",
    "score-value", "progress-value", "hud-timer", "timer-value", "timer-icon", "timer-fill-clip", "combo-tray",
    "combo-gain-1", "combo-gain-2", "combo-bonus-gain", "combo-bonus-gain-value",
    "score-delta", "score-burst",
    "end-screen", "result-headline", "result-fox", "result-correct", "result-incorrect",
    "result-bonus", "result-total-value", "result-total-score", "result-rank",
    "result-message", "result-replay-button", "result-particle-canvas",
    "incorrect-answers-button", "try-again-button", "ranking-button",
    "incorrect-answer-dialog", "incorrect-answer-backdrop", "incorrect-answer-close", "incorrect-answer-list",
    "ranking-dialog", "ranking-backdrop", "ranking-close", "ranking-body",
    "ranking-my-nickname", "ranking-my-score", "ranking-status",
    "ranking-my-badge-image", "ranking-my-badge-fallback",
    "help-dialog", "help-content", "help-content-viewport", "help-status", "help-status-text", "help-retry-button",
    "loading-screen", "loading-title", "loading-message", "retry-button",
  ];
  ids.forEach((id) => {
    el[id] = doc.getElementById(id);
  });

  const game = {
    board: null,
    scoreboard: null,
    screen: "loading",
    running: false,
    locked: true,
    introPlayed: false,
    timerId: null,
    deadline: 0,
    totalSeconds: 0,
    remainingSeconds: 0,
    wrongRecords: new Map(),
    // 검수 4차 q58: 판에 한 번이라도 나온 단어와, 그중 맞힌 단어.
    presentedWords: new Map(),
    matchedWords: new Set(),
    // 검수 4차 9-2: 점수 저장 약속과 "나가는 중" 표시. 저장 전에 나가면 그 판이 사라진다.
    saving: null,
    leaving: false,
    /*
     * 게임을 새로 시작할 때마다 오른다. 판을 거두거나 정답·오답 효과를 기다리는
     * 지연 동작이 그 사이 시작된 새 게임에 끼어들지 않도록 이 번호를 대조한다.
     */
    round: 0,
    // 한 판의 10초 시계(mole.js createWaveClock). 게임마다 새로 만든다.
    wave: null,
    /*
     * 직전 게임 마지막 판에 깔렸던 단어(공통 문서 1절 "다시 시작"). 맞혀서 사라진 짝도 든다.
     * 다음 게임 첫 판에서 뺀다. 메모리에만 두므로 새로 고침하면 잊는다.
     */
    lastBoardWords: [],
    slotNodes: [],
  };

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
      pop: "assets/sound/swap.mp3",
    };
    /*
     * 배경음. 형제 방들은 쓰지 않지만 이 방은 쓰라는 지시가 있었다. 고른 근거는
     * README 를 보라 — 루프 이음매·템포·밝기를 재서 골랐다. 효과음보다 한참
     * 아래에 깔아야 정답/오답 소리가 묻히지 않는다.
     */
    const BGM_SRC = "assets/sound/kids_word_game_bgm_loop.mp3";
    /*
     * 이 곡은 후보 가운데 가장 조용하다(RMS 0.100). 앞서 쓰던 acoustic_loop
     * (0.141)와 같은 크기로 들리게 하려면 0.3 이 아니라 0.4 여야 한다.
     */
    const BGM_VOLUME = 0.4;

    const cache = new Map();
    let muted = false;
    let wordAudio = null;
    let bgmAudio = null;
    // 사용자가 한 번이라도 화면을 눌러 배경음을 틀 자격이 생겼는지.
    let bgmWanted = false;

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

    function ensureBgm() {
      if (!bgmAudio) {
        bgmAudio = new global.Audio(BGM_SRC);
        bgmAudio.loop = true;
        bgmAudio.volume = BGM_VOLUME;
        bgmAudio.preload = "auto";
      }
      return bgmAudio;
    }

    // 실제로 재생을 거는 곳. 설정(muted·bgmWanted) 판단은 부르는 쪽이 한다.
    function playBgmNow() {
      const audio = ensureBgm();
      const played = audio.play();
      if (played && typeof played.catch === "function") played.catch(() => {});
    }

    return {
      preload() {
        Object.values(EFFECTS).forEach(clip);
      },
      /*
       * 브라우저는 사용자가 한 번 누르기 전에는 소리를 내주지 않는다. 그래서
       * 첫 조작 때 불러 준다. 그때 음소거 상태였다면 틀지 않고 "틀고 싶다"는
       * 것만 기억해 두었다가, 소리를 켜는 순간 이어서 재생한다.
       */
      startBgm() {
        bgmWanted = true;
        if (muted) return;
        playBgmNow();
      },
      stopBgm() {
        bgmWanted = false;
        if (bgmAudio) bgmAudio.pause();
      },
      /*
       * 검수 4차 9-3: 결과 화면에서는 소리 설정과 무관하게 배경음이 멈춘다.
       * stopBgm 과 달리 "틀고 싶다"는 기억(bgmWanted)과 음소거 설정은 건드리지 않는다 —
       * 시작 화면으로 돌아가면 원래 설정대로 다시 나야 하기 때문이다.
       */
      pauseBgm() {
        if (bgmAudio) bgmAudio.pause();
      },
      resumeBgm() {
        if (muted || !bgmWanted) return;
        playBgmNow();
      },
      effect(name, volume) {
        return playSrc(EFFECTS[name], volume);
      },
      /*
       * 단어 발음은 API가 준 sound_url을 그대로 쓴다. 로컬 사운드에는 없다.
       * options.evenMuted — 소리를 꺼 두었어도 낸다. 사용자가 직접 누른 발음(오답노트 스피커)만
       * 쓴다(2차 수정 11번, 공통 문서 1절 "소리 끈 상태"). 짝을 맞혔을 때 저절로 나는 발음은 그대로 꺼진다.
       */
      word(url, onState, options) {
        const notify = (playing) => {
          if (typeof onState === "function") onState(playing);
        };
        const evenMuted = Boolean(options && options.evenMuted);
        if ((muted && !evenMuted) || !url) {
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
      setMuted(value) {
        muted = Boolean(value);
        if (muted) {
          if (wordAudio) wordAudio.pause();
          if (bgmAudio) bgmAudio.pause();
        } else if (bgmWanted) {
          playBgmNow();
        }
        return muted;
      },
      isMuted() {
        return muted;
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
    node.textContent = message;
    node.classList.add("is-visible");
    global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(() => {
      node.classList.remove("is-visible");
    }, 1900);
  }

  function showScreen(name) {
    game.screen = name;
    // 시작 화면에서는 토스트가 로고를 가리지 않도록 아래로 내려간다.
    el["game-stage"].classList.toggle("screen-start", name === "start");
    if (name !== "end") clearParticles();
    el["start-screen"].hidden = name !== "start";
    el["play-screen"].hidden = name !== "play";
    el["end-screen"].hidden = name !== "end";
    syncNavigation();
    syncToolsVisibility();

    /*
     * 검수 4차 9-3: 결과 화면에서는 배경음이 나지 않는다. 소리 설정은 그대로 두므로
     * 다른 화면으로 가면 원래대로 다시 난다. 효과음은 대상이 아니다.
     */
    if (name === "end") sound.pauseBgm();
    else sound.resumeBgm();

    // 첫 진입 때만 등장 연출을 한 번 돌린다. 게임에서 돌아올 때는 없다.
    if (name === "start" && !game.introPlayed) {
      game.introPlayed = true;
      playIntro();
    }
  }

  /*
   * 첫 진입 연출. 로고가 팝인하고 여우 셋이 0.16초 간격으로 차례로 솟는다.
   * 끝나면 클래스를 떼어, 여우는 CSS 의 되풀이 연출(foxPeek)로 넘어가고 로고는
   * 움직임 없이 고정된다. 게임에서 돌아올 때는 재생하지 않는다.
   */
  const INTRO_PARTS = [
    { selector: ".start-logo", className: "logo-enter" },
    { selector: ".start-fox", className: "fox-enter" },
  ];

  /*
   * 등장 연출은 fill-mode: both 라 첫 프레임(opacity 0)을 붙잡고 시작한다.
   * 그래서 클래스를 떼는 일이 animationend 하나에만 걸려 있으면 위험하다 —
   * 화면을 그리지 않는 상황에서는 그 이벤트가 오지 않고, 로고와 여우가 영영
   * 투명하게 남는다(판 등장에서 겪은 것과 같은 함정). 가장 늦은 여우가
   * 0.62s + 0.76s 에 끝나므로 넉넉히 2초 뒤에는 무조건 떼어 낸다.
   */
  const INTRO_FALLBACK_MS = 2000;

  function playIntro() {
    INTRO_PARTS.forEach(({ selector, className }) => {
      doc.querySelectorAll(selector).forEach((node) => {
        const clear = () => node.classList.remove(className);
        node.classList.add(className);
        node.addEventListener("animationend", clear, { once: true });
        global.setTimeout(clear, INTRO_FALLBACK_MS);
      });
    });
  }

  /*
   * 시작 화면에서는 게임을 닫는 X, 게임 화면에서는 시작 화면으로 돌아가는 X 다(검수 r12).
   *
   * 도움말 화면에서만 X 대신 뒤로가기(←)를 스피커 자리(왼쪽 위)에 두고, 스피커는 숨긴다
   * (2차 수정 1번, 공통 문서 1절 "도움말 버튼" — OX 와 같다). 시작 · 게임 화면은 그대로다.
   * 그림과 자리는 CSS 의 .help-mode 가 바꾼다.
   */
  function syncNavigation() {
    const onHelp = !el["help-dialog"].hidden;
    const closesGame = !onHelp && game.screen === "start";
    el["game-stage"].classList.toggle("help-mode", onHelp);
    el["sound-button"].hidden = onHelp;
    el["navigation-button"].setAttribute(
      "aria-label",
      closesGame ? "게임 닫기" : onHelp ? "뒤로 가기" : "시작 화면으로 돌아가기",
    );
  }

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
    const anyOpen = ["incorrect-answer-dialog", "ranking-dialog"]
      .some((id) => !el[id].hidden);
    const onLoading = !el["loading-screen"].hidden;
    // 결과 화면에서는 코너 버튼을 내린다. 형제와 같은 규칙이고, 그러지 않으면
    // 사운드 버튼이 다시하기 버튼을 거의 다 덮고 클릭까지 가로챈다.
    el["stage-tools"].hidden = anyOpen || onLoading || game.screen === "end";
    // 도움말 버튼은 시작 화면에서만 보인다(형제 방과 같은 지시).
    el["help-button"].hidden = game.screen !== "start" || !el["help-dialog"].hidden;
  }

  function openDialog(dialog) {
    dialog.hidden = false;
    syncToolsVisibility();
    syncNavigation();
    sound.effect("open", 0.7);
  }

  function closeDialog(dialog) {
    dialog.hidden = true;
    syncToolsVisibility();
    syncNavigation();
  }

  /*
   * fc_id 와 fu_id 가 모두 있는 로그인 회원인지. 게스트와 데모는 제외한다.
   * 형제 방들과 같은 기준이다.
   */
  function isLoggedInMember() {
    const launch = Content.getState().launch;
    return Boolean(launch && !launch.isGuest && !launch.isDemo);
  }

  /*
   * 영어 단어는 첫 글자를 대문자로 보여 준다. mole.js 는 철자를 원본 그대로
   * 들고 있고 짝 판정은 wordId 로 하므로, 여기서 바꾸는 것은 화면에 찍히는
   * 글자뿐이다.
   */
  /*
   * 화면에 찍는 영어 단어. 검수 r7·r42 로 **모두 소문자**가 되었다. 처음에는
   * 형제 방들처럼 첫 글자를 대문자로 올렸는데, 검수에서 "단어는 소문자로
   * 시작하게" 로 뒤집혔다. API 가 대문자로 주더라도 여기서 내린다.
   *
   * 짝 판정은 wordId 로 하므로 표기를 바꿔도 게임 판정에는 영향이 없다.
   */
  function displayWord(text) {
    return String(text || "").trim().toLowerCase();
  }

  /* ---------------- 판 그리기 ---------------- */

  /*
   * 여덟 자리에 판 노드를 한 번만 만들어 두고, 내용만 갈아 끼운다. 매번 새로
   * 만들면 CSS 전환이 처음부터 다시 시작해 올라오는 동작이 끊긴다.
   */
  function buildSlots() {
    const field = el["board-field"];
    field.textContent = "";
    game.slotNodes = Mole.SLOTS.map((slot) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "board";
      button.dataset.slot = String(slot.index);
      button.dataset.row = String(slot.row);
      button.style.setProperty("--slot-x", `${slot.x}px`);
      button.style.setProperty("--slot-y", `${slot.y}px`);
      button.hidden = true;
      button.disabled = true;

      const art = doc.createElement("img");
      art.className = "board-art";

      /*
       * 고른 판을 물들이는 층(검수 r39). 판 그림의 알파를 마스크로 써서 팻말
       * 모양에 정확히 맞물린다. 마스크 주소는 자리마다 그림이 달라 paintSlot 이
       * --board-art 로 넣어 준다.
       */
      const tint = doc.createElement("span");
      tint.className = "board-tint";
      tint.setAttribute("aria-hidden", "true");
      art.alt = "";
      art.draggable = false;
      art.width = Mole.BOARD_WIDTH;
      art.height = Mole.BOARD_HEIGHT;

      const label = doc.createElement("p");
      label.className = "board-text";
      /*
       * 글자는 라벨 안의 span 에 담는다. 라벨 자체는 가운데 정렬을 맡은 flex
       * 상자라 넘침을 재는 데 쓸 수 없다 — 가운데 정렬이면 내용이 위아래로
       * 똑같이 넘쳐서 scrollHeight 가 clientHeight 와 같게 나오고, 줄이는
       * 판정이 영영 걸리지 않는다. span 의 실제 높이를 재야 한다.
       */
      const labelText = doc.createElement("span");
      labelText.className = "board-text-inner";
      label.appendChild(labelText);

      /*
       * 누르는 영역(2026-09-15 사용자 지시 "터치 영역은 텍스트 박스 단위로만").
       * 판 그림 전체는 누름을 받지 않고, 팻말 판 자리에 둔 이 투명한 칸만 받는다.
       * 누름은 버튼으로 올라가므로 board-field 의 위임 처리기는 그대로 판을 찾는다.
       */
      const hit = doc.createElement("span");
      hit.className = "board-hit";
      hit.setAttribute("aria-hidden", "true");

      button.append(art, tint, label, hit);
      field.appendChild(button);
      return { slot, button, art, tint, label, labelText };
    });
  }

  /*
   * 판 안쪽 글자 상자를 넘치면 5%씩 줄인다. 뜻은 API가 주는 문장이라 길이가
   * 제각각이고, 글자 수를 미리 세는 것보다 실제로 재는 편이 정확하다.
   */
  /*
   * 뜻은 API 가 주는 문장이라 길이가 제각각이다("행성" 두 자부터
   * "1. (특수한) 기술, (2. 미술, 예술)" 같은 긴 것까지). 글자 수를 미리 세지
   * 않고 실제로 재서, 글자 상자를 넘치면 5%씩 줄인다.
   *
   * 재는 대상은 라벨이 아니라 그 안의 span 이다. 라벨은 가운데 정렬 flex 라
   * 넘친 내용이 위아래로 갈려 scrollHeight 로는 넘침을 알 수 없다.
   */
  /*
   * 2차 수정(공통 문서 1절 "긴 글자"): 길이 거름을 걷어 아주 긴 뜻(검수 API 최대 87자)도 판에
   * 오른다. 단어는 빼지 않고 칸에 맞게 줄인다. 2026-10-02 실제 뜻 팻말에서 잰 값으로는 70~87자
   * 뜻이 모두 0.55 배(22px)에서 들어갔다. 바닥은 그보다 긴 문구가 와도 넘치지 않게 0.5 에서
   * 0.3(12px)으로 내려 두었다 — 지금 자료로는 닿지 않는다.
   */
  const BOARD_TEXT_MIN_SCALE = 0.3;

  /*
   * 영어 판 글자(2차 수정 — 영어 글자 거름을 걷어 `ice-cream parlor`, `ahead of one's time` 같은 구문이 온다.
   * 공통 문서 1절 "긴 글자"의 두 줄 규칙, OX 방 fitEnglishText 와 같은 방식).
   *  1) 한 줄이 기본이다. 칸에 안 들어가면 5%씩 줄이되 한 줄로는 0.5배(26px)까지만 줄인다.
   *  2) 그래도 안 들어가면 **띄어쓰기 자리에서만** 두 줄로 나눈다. 줄 길이는 CSS text-wrap: balance 가 고르게
   *     맞추고, 1배부터 다시 내려가며 두 줄 안에 드는 가장 큰 크기를 고른다. 세 줄은 쓰지 않는다.
   *  3) 단어는 하나씩 줄바꿈 없는 칸(.word-part)에 넣어 `-` 뒤에서 갈리지 않는다(`ice-cream`).
   *  4) 데이터에 줄바꿈이 있으면 그 자리에서 바꾸고 자동으로 나누지 않는다.
   *  5) 띄어쓰기가 없는 한 단어는 나눌 자리가 없어 한 줄로 끝까지(0.3배) 줄인다 — 글자 중간에서 자르지 않는다.
   */
  const ENGLISH_ONE_LINE_MIN_SCALE = 0.5;
  const ENGLISH_MAX_WRAPPED_LINES = 2;
  // 단어 사이 간격. 줄바꿈 없는 공백(U+00A0)은 붙여 두라는 뜻이라 단어를 가르지 않는다.
  const ENGLISH_WORD_GAP = /[^\S\u00A0]+/;

  function fillEnglishText(inner, text) {
    inner.textContent = "";
    displayWord(text)
      .split(/\s*\n\s*/)
      .forEach((line, lineIndex) => {
        if (lineIndex > 0) inner.appendChild(doc.createElement("br"));
        line.split(ENGLISH_WORD_GAP).filter(Boolean).forEach((word, wordIndex) => {
          if (wordIndex > 0) inner.appendChild(doc.createTextNode(" "));
          const part = doc.createElement("span");
          part.className = "word-part";
          part.textContent = word;
          inner.appendChild(part);
        });
      });
  }

  // 글자 상자에 들어가는 자리(안쪽 여백을 뺀 폭과 높이). clientHeight/clientWidth 는 여백을 포함한다.
  function boardTextRoom(label) {
    const style = global.getComputedStyle(label);
    return {
      height: label.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      width: label.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    };
  }

  // 폭은 scrollWidth 로 잰다 — 한 줄로 묶인 영어는 span 폭(100%)을 넘쳐도 offsetWidth 가 그대로다.
  function boardTextFits(inner, room) {
    return inner.offsetHeight <= room.height && inner.scrollWidth <= room.width + 1;
  }

  // 1배부터 5%씩 줄여 들어가는 크기를 찾는다. floor 에 닿으면 거기서 멈춘다.
  function shrinkBoardText(label, inner, room, floor) {
    let scale = 1;
    label.style.setProperty("--board-text-scale", "1");
    while (!boardTextFits(inner, room) && scale > floor) {
      scale = Math.max(floor, Math.round((scale - 0.05) * 100) / 100);
      label.style.setProperty("--board-text-scale", String(scale));
    }
    return boardTextFits(inner, room);
  }

  /*
   * 그려진 줄 수. 글자 상자 높이(배율 이전 레이아웃 값)를 줄 높이로 나눠 센다. OX 방은 글자 사각형 위치로
   * 셌는데, 이 방은 무대를 transform 으로 줄여서 창 크기가 0 이면(숨은 창) 사각형이 모두 0 이 되어 언제나
   * 한 줄로 셌다 — 세 줄 구문이 두 줄 판정을 통과했다(반박 검토). offsetHeight 와 줄 높이는 배율과 무관하다.
   */
  function countRenderedLines(inner) {
    const lineHeight = parseFloat(global.getComputedStyle(inner).lineHeight);
    if (!(lineHeight > 0)) return 1;
    return Math.max(1, Math.round(inner.offsetHeight / lineHeight));
  }

  /*
   * 뜻 판 한글 크기 — 줄 수마다 정해진 크기(사장님 2026-10-02 "줄 바꿈시 일정한 간격으로 폰트가 작아지개해 아무렇게나 바꾸지
   * 말고", 간격 답 '4px'). 줄이 하나 늘 때마다 4px 씩 작아진다: 1줄 36 · 2줄 32 · 3줄 28 · 4줄 24 · 5줄 20 · 16 · 12px.
   *  - n = 1 부터 올리며 그 단계 크기(36 - 4(n - 1)px)로 그렸을 때 **n줄 안 + 칸 안**이 되는 첫 단계를 쓴다. 그래서 같은
   *    줄 수의 판은 같은 크기이고, 크기는 이 일곱 값만 나온다(바로 앞 카드 방식은 1px 씩 맞춰 뜻마다 33·31·29px 로 제각각이었다).
   *  - 단계 크기로 줄이 그 단계보다 적게 그려지는 뜻(예: 36px 로 2줄인데 32px 로는 1줄)은 폭을 좁혀 그 단계 줄 수로 나눈다
   *    (사장님 답 '줄 수를 크기에 맞춤' — wrapToLines). 그래서 띄어쓰기로 나눌 자리가 있는 뜻은 1줄 36px · 2줄 32px ·
   *    3줄 28px 이다. 줄 수 맞춤은 3줄(28px)까지만 한다(KO_MATCH_LINES_MAX).
   *  - 판 높이(108px, 줄 높이 1.16em) 때문에 4줄은 23px 이하여야 들어가 4줄 단계 24px 는 칸을 넘친다 — 4줄이 필요한 긴 뜻은
   *    24 · 20px 에서 3~4줄로 들어가고 폭은 좁히지 않는다(사장님께 "긴 뜻은 3줄 24 · 20px 로 남는다"고 말씀드린 대로).
   *    12px 단계는 7줄도 칸에 들어가 폭을 좁히면 좁은 기둥이 되므로(반박 검토) 이 상한이 막는다.
   *  - 띄어쓰기에서만 나누는 규칙은 그대로다(styles.css .board-ko .board-text keep-all). 띄어쓰기 없이 12px 로도 칸보다
   *    긴 덩어리만 덩어리 안에서 끊는다(is-broken).
   * 지나간 규칙(여백 기준 → 카드 방식 1px 맞춤 · 2줄 우선 · 바닥 28px)과 실데이터 전후는 README "뜻 판 한글 크기".
   */
  const KO_MAX_PX = 36;
  const KO_LINE_STEP_PX = 4;
  const KO_MATCH_LINES_MAX = 3;
  const KO_MIN_PX = 12;

  /*
   * 번호 · 말줄임 붙이기(카드 방 glueKoreanMarkers 와 같은 규칙). "1. (…) …, (2. …)" 꼴 뜻에서 "1." · "(2." 만 줄 끝에
   * 홀로 남지 않게 번호 뒤 띄어쓰기는 줄바꿈 없는 공백(U+00A0)으로, 띄어쓰기가 없으면 보이지 않는 단어 잇기(U+2060)로
   * 다음 말과 붙인다("3.5" 처럼 수가 이어지면 그대로). 말줄임("..." · "…") 바로 뒤 글자도 단어 잇기로 붙인다.
   * 붙이면 끊을 자리가 줄어 크기를 잃을 수 있어 붙인 글자와 원래 글자를 둘 다 재어 고른다(keepGluedKoreanFit).
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
  // 붙인 쪽이 작아지거나, 같은 크기에서 줄이 늘거나, 덩어리 안에서 끊어야 하면(이 방만의 마지막 수) 원래 글자를 쓴다.
  function keepGluedKoreanFit(glued, plain) {
    if (glued.broken !== plain.broken) return !glued.broken;
    return !(plain.px > glued.px || (plain.px === glued.px && plain.lines < glued.lines));
  }

  // 지금 크기에서 글자가 lines 줄보다 적게 그려지면 글자 상자 폭을 좁혀 lines 줄로 나눈다(그 줄 수로 나뉘는 가장 넓은 폭).
  // 그 줄 수가 칸 높이에 안 들어가거나, 좁힌 폭에서 덩어리가 넘치거나, 정확히 lines 줄이 안 되면 폭을 되돌린다.
  function wrapToLines(inner, room, lines) {
    if (countRenderedLines(inner) >= lines) return;
    const lineHeight = parseFloat(global.getComputedStyle(inner).lineHeight);
    if (!(lineHeight > 0) || lines * lineHeight > room.height) return;
    let low = 1;
    let high = Math.floor(room.width);
    let best = 0;
    while (low <= high) {
      const width = Math.floor((low + high) / 2);
      inner.style.width = `${width}px`;
      if (countRenderedLines(inner) >= lines) {
        best = width;
        low = width + 1;
      } else {
        high = width - 1;
      }
    }
    inner.style.width = best ? `${best}px` : "";
    if (!best || countRenderedLines(inner) !== lines || inner.scrollWidth > best + 1 || !boardTextFits(inner, room)) {
      inner.style.width = "";
    }
  }

  function fitKoreanPx(label, inner, room) {
    const setPx = (px) => label.style.setProperty("--board-text-scale", String(px / KO_MAX_PX));
    label.classList.remove("is-broken");
    inner.style.width = "";
    let px = KO_MAX_PX;
    // 단계 n(= step)의 크기로 n줄 안에 칸 안이면 멈춘다. 다음 단계가 12px 아래면 거기서 멈춘다.
    let step = 1;
    for (;; step += 1) {
      setPx(px);
      if ((boardTextFits(inner, room) && countRenderedLines(inner) <= step) || px - KO_LINE_STEP_PX < KO_MIN_PX) break;
      px -= KO_LINE_STEP_PX;
    }
    // 띄어쓰기 없이 바닥 크기로도 칸보다 긴 덩어리: 그때만 덩어리 안에서 끊고, 크기는 바닥 그대로 둔다(사장님 답
    // "두더지만 띄어쓰기에서" — 다시 키우면 다른 덩어리까지 낱말 중간에서 끊긴다, 반박 검토).
    const broken = !boardTextFits(inner, room);
    if (broken) label.classList.add("is-broken");
    else if (step <= KO_MATCH_LINES_MAX) wrapToLines(inner, room, step);
    return { px, lines: countRenderedLines(inner), broken, width: inner.style.width };
  }

  // 글자 상자의 지금 글자(붙인 것이든 원래 것이든)에서 두 판을 만들어 재므로 다시 맞춰도 같은 결과다.
  function fitKoreanBoardText(label, inner, room) {
    const plainText = unglueKoreanMarkers(inner.textContent);
    const gluedText = glueKoreanMarkers(plainText);
    inner.textContent = gluedText;
    const glued = fitKoreanPx(label, inner, room);
    if (gluedText === plainText) return;
    inner.textContent = plainText;
    const plain = fitKoreanPx(label, inner, room);
    if (!keepGluedKoreanFit(glued, plain)) return;
    inner.textContent = gluedText;
    inner.style.width = glued.width;
    label.style.setProperty("--board-text-scale", String(glued.px / KO_MAX_PX));
    label.classList.toggle("is-broken", glued.broken);
  }

  function fitBoardText(label, inner) {
    label.classList.remove("is-wrapped", "is-broken");
    inner.style.width = ""; // 뜻 판이 줄 수를 맞추려 좁힌 폭(wrapToLines)을 다음 글자에 남기지 않는다
    // 자리는 1배에서 잰다 — 영어 판 위쪽 여백(--cap-nudge)이 글자 크기 비례라, 직전 단어의 배율이 남아 있으면
    // 칸 높이가 그만큼 달라진다(반박 검토).
    label.style.setProperty("--board-text-scale", "1");
    const room = boardTextRoom(label);
    if (!label.closest(".board-en")) {
      // 뜻 판: 띄어쓰기에서만 나누고(styles.css .board-ko .board-text) 줄 수마다 정해진 크기를 고른다(위 fitKoreanBoardText).
      fitKoreanBoardText(label, inner, room);
      return;
    }
    if (shrinkBoardText(label, inner, room, ENGLISH_ONE_LINE_MIN_SCALE)) return;
    // 데이터 줄바꿈이 있거나 한 단어뿐이면 나누지 않고 끝까지 줄인다.
    if (inner.querySelector("br") || inner.querySelectorAll(".word-part").length < 2) {
      shrinkBoardText(label, inner, room, BOARD_TEXT_MIN_SCALE);
      return;
    }
    label.classList.add("is-wrapped");
    let scale = 1;
    for (;;) {
      label.style.setProperty("--board-text-scale", String(scale));
      const fits = boardTextFits(inner, room);
      if ((fits && countRenderedLines(inner) <= ENGLISH_MAX_WRAPPED_LINES) || scale <= BOARD_TEXT_MIN_SCALE) return;
      scale = Math.max(BOARD_TEXT_MIN_SCALE, Math.round((scale - 0.05) * 100) / 100);
    }
  }

  function paintSlot(node, occupant) {
    const { button, art, label, labelText } = node;
    if (!occupant) {
      button.classList.remove("is-entering", "is-leaving", "is-picked", "is-wrong", "is-matched");
      button.disabled = true;
      button.hidden = true;
      button.removeAttribute("aria-pressed");
      button.setAttribute("aria-label", "빈 자리");
      labelText.textContent = "";
      return;
    }
    const kind = occupant.kind;
    button.classList.remove("is-entering", "is-leaving", "is-picked", "is-wrong", "is-matched");
    button.classList.toggle("board-en", kind === "en");
    button.classList.toggle("board-ko", kind === "ko");
    button.dataset.wordId = occupant.wordId;
    button.dataset.kind = kind;
    const artSource = `assets/game/${kind === "en" ? "eng" : "kor"}${occupant.pose}.png`;
    art.src = artSource;
    // 물들이는 층이 같은 그림을 마스크로 쓰도록 넘겨 준다(r39).
    button.style.setProperty("--board-art", `url("${artSource}")`);
    if (kind === "en") fillEnglishText(labelText, occupant.text);
    else labelText.textContent = occupant.text;
    button.setAttribute(
      "aria-label",
      kind === "en" ? `영어 단어 ${displayWord(occupant.text)}` : `뜻 ${occupant.text}`,
    );
    button.setAttribute("aria-pressed", "false");
    button.hidden = false;
    button.disabled = false;
    fitBoardText(label, labelText);
    /*
     * 글꼴을 받기 전에 재면 폭이 달라 한 줄 · 두 줄 판정이 어긋난다(OX 방에서 두 줄이 세 줄로 넘친 사례).
     * 받은 뒤 같은 팻말이 그대로면 한 번 더 맞춘다.
     */
    const paintedWord = occupant.wordId;
    doc.fonts?.ready?.then(() => {
      if (button.dataset.wordId === paintedWord && button.dataset.kind === kind && !button.hidden) {
        fitBoardText(label, labelText);
      }
    });
    /*
     * 등장은 keyframes 로 돌리고 끝나면 클래스를 뗀다. 애니메이션이 아예 돌지
     * 않는 상황에서도 판의 기본 상태가 "보이는" 쪽이라 그대로 떠 있다.
     * (전환에 기대던 예전 방식은 화면을 그리지 않을 때 판이 투명하게 남았다.)
     */
    /*
     * 등장 애니메이션이 도는 동안에는 transform 이 키프레임 값으로 고정된다.
     * 그래서 클래스를 떼는 일을 animationend 하나에만 걸어 두면, 그 이벤트가
     * 오지 않는 상황에서 판이 내려간 자리에 굳고 고르기 확대(r39)도 묻힌다.
     * 인트로와 같은 방식으로 타이머를 함께 걸어 반드시 풀리게 한다.
     */
    button.classList.add("is-entering");
    const dropEntering = () => button.classList.remove("is-entering");
    button.addEventListener("animationend", dropEntering, { once: true });
    global.setTimeout(dropEntering, BOARD_ENTER_FALLBACK_MS);
  }

  function nodeForSlot(index) {
    return game.slotNodes.find((node) => node.slot.index === index) || null;
  }

  function syncBoard() {
    if (!game.board) return;
    const state = game.board.state();
    state.slots.forEach((slot) => {
      const node = nodeForSlot(slot.index);
      if (!node) return;
      const occupied = Boolean(slot.occupant);
      const wasOccupied = !node.button.hidden;
      /*
       * 사라지는 중인 판(is-matched · is-leaving)은 지금 내용이 아니다. 맞힌 짝 자리를 곧바로 채울 때
       * (2차 수정 7번) 같은 단어가 같은 면으로 같은 자리에 다시 올 수 있는데, 단어와 면만 견주면
       * 다시 그리지 않아 투명하고 누를 수 없는 판이 남았다(명단이 작을수록 잦다). 그래서 무조건 다시 그린다.
       */
      const fading = node.button.classList.contains("is-matched") || node.button.classList.contains("is-leaving");
      if (occupied && (!wasOccupied || fading || node.button.dataset.wordId !== slot.occupant.wordId
        || node.button.dataset.kind !== slot.occupant.kind)) {
        paintSlot(node, slot.occupant);
      } else if (!occupied && wasOccupied) {
        paintSlot(node, null);
      }
    });
  }

  /*
   * 검수 4차 q58: 판에 나온 단어를 모아 둔다. 시간이 끝났을 때 맞히지 못한 단어를
   * 오답노트에 내야 하는데, 한 번도 고르지 않은 단어는 오답 기록에 남지 않기 때문이다.
   * 판을 새로 깔 때 여기를 거친다.
   */
  function rememberPresented(placed) {
    placed.forEach((occupant) => {
      const key = occupant.english.toLowerCase();
      if (game.presentedWords.has(key)) return;
      game.presentedWords.set(key, {
        english: occupant.english,
        meaning: occupant.meaning || "",
        soundUrl: occupant.soundUrl || "",
      });
    });
  }

  /*
   * 빈 판에 한 판을 깔고 그 판의 10초를 새로 센다(검수 r38). 팻말이 한 장이라도
   * 남아 있으면 mole.js 가 아무것도 깔지 않는다 — 맞힌 자리는 그 판이 끝날 때까지 비워 둔다(WM6-1).
   */
  function dealBoards() {
    if (!game.running || !game.board) return;
    const placed = game.board.deal();
    if (placed.length === 0) return;
    rememberPresented(placed);
    syncBoard();
    sound.effect("pop", 0.5);
    updateHud();
    if (game.wave) game.wave.start();
  }

  /*
   * 판 시계가 10초에 부른다. 남은 팻말을 모두 사라지게 하고(못 맞힌 단어는
   * 대기열 맨 뒤로), 무작위 자리에 새 판을 깐다. 팻말을 골라 둔 동안이나
   * 정답·오답 효과가 도는 동안에는 시계가 부르지 않고 미뤄 둔다(isWaveBusy).
   */
  function recallBoards() {
    if (!game.running || !game.board) return;
    const round = game.round;
    const result = game.board.recall();
    if (result.status !== "recalled") {
      dealBoards();
      return;
    }
    // 사라지는 동안에는 누르지 못하게 막는다. 다음 판을 깔 때 푼다.
    game.locked = true;
    result.cleared.forEach((slotIndex) => {
      const node = nodeForSlot(slotIndex);
      if (!node) return;
      // 흔들림(is-wrong)이 남아 있으면 사라지는 애니메이션을 덮으므로 함께 뗀다.
      node.button.classList.remove("is-picked", "is-entering", "is-wrong");
      node.button.classList.add("is-leaving");
      node.button.disabled = true;
    });
    global.setTimeout(() => {
      if (round !== game.round || !game.running) return;
      syncBoard();
      global.setTimeout(() => {
        if (round !== game.round || !game.running) return;
        game.locked = false;
        dealBoards();
      }, REFILL_DELAY_MS);
    }, WAVE_LEAVE_MS);
  }

  // 팻말을 골라 두었거나 정답·오답 효과가 도는 동안에는 판을 거두지 않는다.
  function isWaveBusy() {
    if (!game.running || !game.board) return true;
    return game.locked || Boolean(game.board.state().selection);
  }

  // 바쁜 일이 끝날 때마다 부른다. 그 사이 10초가 지났다면 이제 판을 거둔다.
  function settleWave() {
    if (game.wave) game.wave.settle();
  }

  function stopWave() {
    if (game.wave) game.wave.stop();
  }

  /* ---------------- 짝 맞추기 ---------------- */

  function setBoardsEnabled(enabled) {
    game.slotNodes.forEach(({ button }) => {
      if (!button.hidden) button.disabled = !enabled;
    });
  }

  function markPicked(slotIndex, picked) {
    const node = nodeForSlot(slotIndex);
    if (!node) return;
    node.button.classList.toggle("is-picked", picked);
    node.button.setAttribute("aria-pressed", String(picked));
  }

  function recordWrong(entry) {
    if (!entry || !entry.english) return;
    const key = entry.english.toLowerCase();
    const current = game.wrongRecords.get(key);
    if (current) {
      current.count += 1;
      return;
    }
    game.wrongRecords.set(key, {
      english: entry.english,
      meaning: entry.meaning || "",
      soundUrl: entry.soundUrl || "",
      count: 1,
    });
  }

  function updateHud() {
    if (!game.scoreboard || !game.board) return;
    const state = game.scoreboard.getState();
    // 점수 숫자는 여기서 쓰지 않는다. updateHud 는 판을 깔 때도 불려서, 쓰면 굴러가던
    // 보너스 점수를 최종값으로 덮어 버린다. 점수판은 updateScore·animateScore 몫이다.
    /*
     * 검수 4차 q57 로 명단이 되풀이되므로 맞힌 수가 문제 수를 넘을 수 있다. 읽어 주는
     * 문구는 맞힌 개수만 센다.
     */
    el["progress-value"].textContent = `맞힌 짝 ${state.matchedCount}개`;
    syncCombo(state);
  }

  /*
   * 하단 오른쪽 여우 세 칸. 연속 정답이 하나씩 찰 때마다 켜진다.
   *
   * 켜는 개수는 scoreboard 의 comboFilled(0..2)를 그대로 따른다. 예전에는
   * "연속이 있는데 comboFilled 가 0이면 세 칸 모두 켠다"는 예외를 두었는데,
   * 보너스가 터진 뒤 그 상태가 그대로 굳어 다음 정답을 맞힐 때까지 세 칸이
   * 계속 켜져 있었다 — 초기화가 안 되는 것처럼 보이던 원인이다. 보너스 순간의
   * 환호는 cheerCombo 가 따로 그리고 스스로 되돌린다.
   */
  function syncCombo(state) {
    // 환호가 도는 동안에는 건드리지 않는다. 판이 새로 깔리거나 시계가 돌 때마다
    // updateHud 가 불려서, 막아 두지 않으면 환호가 0.5초도 못 가고 지워진다.
    if (comboCheering) return;
    const foxes = el["combo-tray"].querySelectorAll(".combo-fox");
    foxes.forEach((fox, index) => {
      fox.classList.toggle("is-lit", index < state.comboFilled);
    });
  }

  /* ---------------- 점수판 ---------------- */

  /*
   * 점수판 숫자(검수 r11 후속, 2026-09-15 사용자 지시 "점수 효과 형제 프로젝트 확인해서 적용").
   * 형제 방 기준 코드(실로폰 updateScore·animateScore, 카드 cancelScoreTween)를 옮겼다.
   *  - updateScore   굴림을 끊고 지금 점수를 바로 찍는다. 시작·종료와 보너스가 아닌 득점·감점.
   *  - animateScore  보너스 판에서만 최대 0.72초 동안 굴려 올린다.
   * rAF 가 돌지 않는 환경을 위해 폴백 타이머를 함께 걸고, 옛 굴림과 폴백은 타이머 취소와
   * 번호(scoreTweenToken) 두 겹으로 무효화한다. 하나라도 빠지면 재시작 뒤 옛 점수가
   * 되살아나거나 연속 굴림에서 숫자가 한 프레임 되돌아간다(09-14 코디네이터 전달문).
   * scoreShown 은 지금 화면에 그려진 숫자다.
   */
  let scoreShown = 0;
  let scoreTween = 0;
  let scoreTweenFallbackId = 0;
  let scoreTweenToken = 0;

  function currentScore() {
    return game.scoreboard ? game.scoreboard.getState().score : 0;
  }

  function prefersReducedMotion() {
    return Boolean(global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  // 검수 4차 q59: 천단위에 쉼표를 찍는다(1,000). 형제 방들과 같은 en-US 자릿수 구분이다.
  /*
   * 점수는 어디서나 천단위에 쉼표를 찍는다(사장님 지시 2026-09-29) — 점수판·증감 표시·
   * 보너스·결과 화면·랭킹이 모두 이 함수를 쓴다. 개수(`N개`)와 시계·등급은 대상이 아니다.
   *
   * 버림이 아니라 **반올림**이다. 점수 굴림 연출은 사이 값이 소수라, 버리면 숫자가 목표보다
   * 한 칸 늦게 따라오고 마이너스 구간에서는 0 쪽으로 당겨진다(999.6 -> 999, -9.6 -> -9).
   * 그리고 반올림한 -0 을 0 으로 눕힌다(검수 함정 9번) — 굴림이 마이너스에서 0 으로
   * 올라오는 순간 화면에 "-0" 이 보였다. 눕히는 자리는 이 함수 한 곳뿐이다.
   */
  function formatScore(value) {
    const rounded = Math.round(Number(value) || 0);
    // `rounded === 0` 은 0 과 -0 둘 다 참이다 — 마이너스 영을 눕히는 곳은 여기 한 곳뿐이다.
    return (rounded === 0 ? 0 : rounded).toLocaleString("en-US");
  }

  function renderScore(value) {
    // 반올림과 -0 눕히기는 formatScore 한 곳이 맡는다. 여기서 또 하지 않는다.
    const shown = formatScore(value);
    el["score-value"].textContent = shown;
    el["score-value"].setAttribute("aria-label", `점수 ${shown}점`);
  }

  // 진행 중인 굴림과 예약된 폴백을 모두 무효로 만든다.
  function cancelScoreTween() {
    if (scoreTween) {
      global.cancelAnimationFrame(scoreTween);
      scoreTween = 0;
    }
    global.clearTimeout(scoreTweenFallbackId);
    scoreTweenFallbackId = 0;
    scoreTweenToken += 1;
    el["score-value"].removeAttribute("aria-busy");
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
    // 차이가 클수록 조금 길게, 최대 0.72초.
    const span = Math.min(720, 280 + Math.abs(to - from) * 2);
    // 굴러가는 동안 읽기 도구가 사이 값을 하나하나 읽지 않게 한다.
    el["score-value"].setAttribute("aria-busy", "true");
    // rAF 가 돌지 않아도 최종값에 닿게 한다. 번호가 바뀌었으면 옛 폴백이라 무시한다.
    scoreTweenFallbackId = global.setTimeout(() => {
      if (token !== scoreTweenToken) return;
      scoreTweenFallbackId = 0;
      if (scoreTween) {
        global.cancelAnimationFrame(scoreTween);
        scoreTween = 0;
      }
      scoreShown = to;
      renderScore(to);
      el["score-value"].removeAttribute("aria-busy");
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
      el["score-value"].removeAttribute("aria-busy");
    };
    scoreTween = global.requestAnimationFrame(step);
  }

  /* ---------------- 점수 증감 · 보너스 표기 ---------------- */

  // 보너스 연출(상자 링·"보너스 +100"·숫자 펀치)이 머무는 시간. 형제 카드 방과 같다.
  const BONUS_EFFECT_MS = 1100;
  let scoreDeltaTimer = 0;
  let scoreBonusTimer = 0;

  /*
   * 점수가 바뀌는 순간 Score 상자 위에 얼마가 오갔는지 띄운다. 형제 워드매치
   * 방들과 같은 역할이고, 값은 rules.js 가 실제로 준 점수를 그대로 쓴다 —
   * gameConfig.scoring 으로 배점을 바꾸면 표시도 따라간다.
   *
   * 같은 종류가 연달아 나올 때 애니메이션이 다시 돌도록 클래스를 떼고 레이아웃을
   * 한 번 읽어 준다. 그러지 않으면 두 번째부터는 아무 움직임 없이 지나간다.
   */
  function showScoreDelta(amount, kind) {
    const value = Math.trunc(Number(amount) || 0);
    if (value === 0) return;
    const node = el["score-delta"];
    clearScoreBonus();
    global.clearTimeout(scoreDeltaTimer);
    node.classList.remove("is-gain", "is-loss");
    void node.offsetWidth;
    node.textContent = value > 0 ? `+${formatScore(value)}` : formatScore(value);
    node.classList.add(kind);
    scoreDeltaTimer = global.setTimeout(() => {
      node.classList.remove("is-gain", "is-loss");
      node.textContent = "";
    }, 900);
  }

  function hideScoreDelta() {
    global.clearTimeout(scoreDeltaTimer);
    el["score-delta"].classList.remove("is-gain", "is-loss");
    el["score-delta"].textContent = "";
  }

  /*
   * 보너스 순간 Score 상자에서 터지는 연출(형제 카드 방 playScoreBonus, 바다속 방
   * playBonusBurst). 상자 둘레 금빛 링·반짝임(#score-burst)과 점수 숫자 금색 펀치를 건다.
   * 숫자 굴림은 animateScore 가 따로 맡는다.
   *
   * 보너스 점수 글자("보너스 +100")는 예전에 이 상자 위 증감 자리에 띄웠다. 2차 수정 10번
   * ("보너스 UI 상단에 100점 노출, 현재는 스코어 위에 노출")으로 보너스 여우 위로 옮겼다 —
   * showBonusGain 이 맡는다.
   */
  function playScoreBonus(bonusPoints) {
    const amount = Math.trunc(Number(bonusPoints) || 0);
    const burst = el["score-burst"];
    const score = el["score-value"];
    // 링 요소가 없는 옛 index.html 이 캐시에 남아 있어도 게임이 멈추지 않게 한다(형제 카드 방과 같다).
    if (amount <= 0 || !burst) return;
    global.clearTimeout(scoreBonusTimer);
    burst.classList.remove("is-playing");
    score.classList.remove("is-bonus-punch");
    // 레이아웃을 한 번 읽어야 같은 클래스를 다시 붙일 때 애니메이션이 처음부터 돈다.
    void burst.offsetWidth;
    burst.classList.add("is-playing");
    score.classList.add("is-bonus-punch");
    scoreBonusTimer = global.setTimeout(clearScoreBonus, BONUS_EFFECT_MS);
  }

  function clearScoreBonus() {
    global.clearTimeout(scoreBonusTimer);
    scoreBonusTimer = 0;
    el["score-burst"]?.classList.remove("is-playing");
    el["score-value"].classList.remove("is-bonus-punch");
  }

  /*
   * 콤보 여우 위 점수(2차 수정 10번, 공통 문서 2절 "보너스 점수" — OX · 축구 · 바다속과 같다).
   *  - 첫째 · 둘째 여우가 켜질 때: 그 여우 위에 정답 점수(+100)를 작고 희게
   *  - 셋째(보너스) 여우: BONUS 띠와 보너스 점수
   * 값은 rules.js 가 실제로 준 점수라 gameConfig.scoring 으로 배점을 바꾸면 따라간다.
   * '동작 줄이기'에서도 보인다 — 보임은 hidden 이 가르고, 애니메이션은 꾸밈일 뿐이다.
   */
  const COMBO_GAIN_MS = 900;
  const BONUS_GAIN_MS = 1200;
  const comboGainTimers = new Map();

  function flashGain(node, key, ms) {
    if (!node) return;
    global.clearTimeout(comboGainTimers.get(key));
    node.classList.remove("is-showing");
    node.hidden = false;
    void node.offsetWidth;
    node.classList.add("is-showing");
    comboGainTimers.set(key, global.setTimeout(() => {
      node.classList.remove("is-showing");
      node.hidden = true;
      comboGainTimers.delete(key);
    }, ms));
  }

  function showComboStepGain(index, amount) {
    const node = el[`combo-gain-${index + 1}`];
    if (!node) return;
    node.textContent = `+${formatScore(amount)}`;
    flashGain(node, `step-${index}`, COMBO_GAIN_MS);
  }

  function showBonusGain(amount) {
    const node = el["combo-bonus-gain"];
    if (!node) return;
    el["combo-bonus-gain-value"].textContent = `+${formatScore(amount)}`;
    flashGain(node, "bonus", BONUS_GAIN_MS);
  }

  function hideComboGains() {
    comboGainTimers.forEach((timerId) => global.clearTimeout(timerId));
    comboGainTimers.clear();
    ["combo-gain-1", "combo-gain-2", "combo-bonus-gain"].forEach((id) => {
      if (!el[id]) return;
      el[id].classList.remove("is-showing");
      el[id].hidden = true;
    });
  }

  /*
   * 보너스 순간에만 세 칸을 한꺼번에 켜고 환호시킨 뒤, 잠시 후 스스로 끈다.
   * 끄고 나면 다음 콤보가 빈 칸부터 다시 찬다.
   */
  function cheerCombo() {
    const foxes = el["combo-tray"].querySelectorAll(".combo-fox");
    comboCheering = true;
    foxes.forEach((fox) => {
      fox.classList.add("is-lit", "is-cheer");
      fox.addEventListener("animationend", () => {
        fox.classList.remove("is-cheer");
      }, { once: true });
    });
    global.clearTimeout(comboResetTimer);
    comboResetTimer = global.setTimeout(() => {
      comboCheering = false;
      foxes.forEach((fox) => fox.classList.remove("is-lit", "is-cheer"));
      if (game.scoreboard) syncCombo(game.scoreboard.getState());
    }, COMBO_CHEER_MS);
  }

  function handleSelect(slotIndex) {
    if (!game.running || game.locked || !game.board) return;
    const result = game.board.select(slotIndex);

    if (result.status === "ignored") return;

    if (result.status === "selected") {
      markPicked(slotIndex, true);
      sound.effect("touch", 0.6);
      return;
    }

    if (result.status === "deselected") {
      markPicked(slotIndex, false);
      // 골라 둔 채 10초가 지났다면 선택을 푼 지금 판을 거둔다.
      settleWave();
      return;
    }

    /*
     * 두 번째 팻말(WM6-2). 판정은 mole.js 가 이미 끝냈고 점수와 소리도 지금 낸다 — 미루는 것은 화면뿐이다.
     * 두 번째 팻말에도 첫 팻말과 같은 하이라이트를 걸어 PICK_HOLD_MS 동안 둘 다 골라진 모습으로 둔 뒤,
     * 짝이면 함께 사라지고 짝이 아니면 함께 흔들린다. 그동안 누름은 잠겨 있고 10초 판 바꾸기도 미뤄진다(isWaveBusy).
     */
    const round = game.round;
    game.locked = true;
    markPicked(slotIndex, true);

    if (result.status === "match") {
      const outcome = game.scoreboard.registerMatch();
      // 검수 4차 q58: 맞힌 단어는 오답노트에서 뺀다.
      game.matchedWords.add(result.english.toLowerCase());
      // 사용자 지시: 짝을 맞혔을 때는 실로폰 음계 대신 성공 사운드만 낸다.
      sound.effect("success", 0.9);
      // WM6-3: 정답 단어 팝업(무대 가운데 큰 영어 단어)은 띄우지 않는다 — 워드매치 가운데 이 게임만 떴다.
      // 회원 여부와 무관하게 완성된 단어는 읽어 준다(형제 방과 같은 규칙).
      sound.word(result.soundUrl);
      // updateHud 가 먼저다 — 뒤에 두면 방금 켠 환호를 곧바로 지운다.
      updateHud();
      if (outcome.bonus) {
        /*
         * 보너스 판(검수 r11 후속, 2026-09-15): 숫자는 정답+보너스만큼 굴려 올리고, Score 상자
         * 링과 숫자 펀치를 건다. 보너스 점수 글자는 2차 수정 10번으로 Score 위가 아니라 보너스
         * 여우(셋째 칸) 위에 BONUS 와 함께 띄운다. Score 위에는 다른 짝과 같이 정답 점수만 뜬다.
         */
        animateScore(currentScore());
        showScoreDelta(outcome.scoreDelta, "is-gain");
        playScoreBonus(outcome.bonusDelta);
        showBonusGain(outcome.bonusDelta);
        cheerCombo();
      } else {
        showScoreDelta(outcome.scoreDelta, "is-gain");
        updateScore();
        // 2차 수정(공통 문서 2절): 첫째 · 둘째 여우가 켜지면 그 위에 정답 점수를 띄운다.
        const filled = game.scoreboard.getState().comboFilled;
        if (filled >= 1) showComboStepGain(filled - 1, outcome.scoreDelta);
      }

      global.setTimeout(() => {
        if (round !== game.round || !game.running) return;
        // 하이라이트를 단 채로 사라진다(styles.css .board.is-picked.is-matched).
        result.cleared.forEach((index) => {
          const node = nodeForSlot(index);
          if (node) node.button.classList.add("is-matched");
        });
        global.setTimeout(() => {
          if (round !== game.round || !game.running) return;
          // 맞힌 자리는 채우지 않는다 — 이 판이 끝날 때까지 비워 둔다(WM6-1).
          syncBoard();
          // 검수 4차 q57: 명단을 다 내도 끝나지 않는다. 게임은 제한 시간으로만 끝난다.
          game.locked = false;
          if (game.board.state().onBoard === 0) {
            /*
             * WM6-1(LF 답 2026-10-08 "지정 시간 내에 4문제를 다 맞히면 바로 새로운 판"): 10초가 되기 전에
             * 네 짝을 다 맞혔다. 빈 판으로 기다리게 하지 않고 곧바로 다음 판을 깔고 10초를 새로 센다.
             */
            stopWave();
            global.setTimeout(() => {
              if (round !== game.round) return;
              dealBoards();
            }, REFILL_DELAY_MS);
            return;
          }
          // 정답 효과가 도는 사이 10초가 지났다면 이제 판을 거둔다.
          settleWave();
        }, WAVE_LEAVE_MS);
      }, PICK_HOLD_MS);
      return;
    }

    // miss — 오답 효과만 내고 팻말은 남긴다.
    const miss = game.scoreboard.registerMiss();
    showScoreDelta(miss.scoreDelta, "is-loss");
    updateScore();
    recordWrong(result);
    sound.effect("fail", 0.85);
    updateHud();
    global.setTimeout(() => {
      if (round !== game.round || !game.running) return;
      result.pair.forEach((occupant) => {
        markPicked(occupant.slot, false);
        const node = nodeForSlot(occupant.slot);
        if (!node) return;
        node.button.classList.add("is-wrong");
        node.button.addEventListener("animationend", () => {
          node.button.classList.remove("is-wrong");
        }, { once: true });
      });
      global.setTimeout(() => {
        if (round !== game.round || !game.running) return;
        game.locked = false;
        // 오답 효과가 도는 사이 10초가 지났다면 이제 판을 거둔다.
        settleWave();
      }, WRONG_HOLD_MS);
    }, PICK_HOLD_MS);
  }

  /* ---------------- 타이머 ---------------- */

  /*
   * 시계 글자는 초 단위, 막대는 소수까지.
   *
   * 막대는 남은 시간을 소수째까지 그대로 쓰고(0.2초마다 갱신) CSS 전환은 걸지
   * 않는다. 실제로 줄이는 것은 styles.css `.hud-timer-fill` 의 clip-path 다.
   *
   * 검수 r40 "타임바 줄어들 때 잔상 남습니다" 는 원인을 재현으로 확정하지
   * 못했다. 09-10 에 여기 적었던 "그림의 바깥 빛무리가 잘린 끝에서 밝은
   * 세로선으로 남는다" 는 설명은 틀렸다 — 빛무리 알파는 최대 20/255(약 8%)라
   * 밝은 선을 만들 수 없다. 09-15 에 같은 채움 그림을 쓰는 형제 방과 같은
   * clip-path 방식으로 맞췄다. 보이는 길이는 예전과 같다.
   */
  function updateClock() {
    el["timer-value"].textContent = Rules.formatClock(game.remainingSeconds);
    const exact = game.running
      ? Math.max(0, (game.deadline - Date.now()) / 1000)
      : game.remainingSeconds;
    const ratio = game.totalSeconds > 0
      ? Math.max(0, Math.min(1, exact / game.totalSeconds))
      : 0;
    el["timer-fill-clip"].style.setProperty("--timer-progress", ratio.toFixed(4));
    /*
     * 숫자 · 스톱워치 · 타임바가 함께 급해진다 — 숫자만 깜빡이면 눈에 잘 띄지 않는다.
     * 10~6초는 is-urgent, 5~0초는 is-critical(더 빠르게). 둘은 겹치지 않는다(바다속 방과 같은 이름 짓기).
     */
    const left = game.remainingSeconds;
    const critical = game.running && left <= CRITICAL_SECONDS;
    const urgent = game.running && left <= URGENT_SECONDS && !critical;
    el["hud-timer"].classList.toggle("is-urgent", urgent);
    el["hud-timer"].classList.toggle("is-critical", critical);
  }

  function stopTimer() {
    if (game.timerId !== null) {
      global.clearInterval(game.timerId);
      game.timerId = null;
    }
  }

  function startTimer(seconds) {
    stopTimer();
    game.totalSeconds = seconds;
    game.deadline = Date.now() + seconds * 1000;
    game.remainingSeconds = seconds;
    updateClock();
    game.timerId = global.setInterval(() => {
      const left = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
      // 초가 그대로여도 막대는 계속 줄어야 하므로 건너뛰지 않고 매 틱 그린다.
      game.remainingSeconds = left;
      updateClock();
      if (left <= 0) {
        // 시간이 끝나면 결과 화면으로 넘어간다.
        finishGame();
      }
    }, TIMER_TICK_MS);
  }

  /* ---------------- 시작과 종료 ---------------- */

  function startGame() {
    const snapshot = Content.getState();
    const words = snapshot.content.questions;
    if (!words || words.length === 0) {
      setLoading(true, "출제할 단어가 없습니다", "이 콘텐츠에는 판에 올릴 수 있는 단어가 없습니다.", { error: true, retry: true });
      return;
    }

    game.saving = null;
    game.leaving = false;
    stopWave();
    global.clearTimeout(comboResetTimer);
    comboCheering = false;
    clearScoreBonus();
    hideComboGains();
    hideScoreDelta();
    game.wrongRecords = new Map();
    // 검수 4차 q58: 새 게임이 시작되면 나온 단어·맞힌 단어 기록도 비운다.
    game.presentedWords = new Map();
    game.matchedWords = new Set();
    try {
      game.board = Mole.createBoard({
        words,
        questionCount: words.length,
        // 공통 문서 1절 "다시 시작": 직전 게임 마지막 판 단어로 새 첫 판을 열지 않는다.
        avoidFirst: game.lastBoardWords,
      });
    } catch (error) {
      setLoading(true, "게임을 준비하지 못했습니다", error?.message || "판을 만들 수 없습니다.", { error: true, retry: true });
      return;
    }
    game.scoreboard = Rules.createScoreboard({
      questionCount: game.board.totalQuestions,
      playTimeSeconds: Content.playTimeSeconds(),
      // #gameConfig.scoring 에 적힌 것만 덮어쓴다. 없으면 rules.js DEFAULTS.
      ...Content.scoring(),
    });
    // 지난 게임에 걸어 둔 지연 동작은 이 번호가 달라져 스스로 물러난다.
    game.round += 1;
    game.running = true;
    game.locked = false;
    game.wave = Mole.createWaveClock({
      waveMs: Mole.WAVE_SECONDS * 1000,
      isBusy: isWaveBusy,
      onDue: recallBoards,
    });

    buildSlots();
    showScreen("play");
    updateHud();
    // 새 점수판(0)을 곧바로 찍는다. 굴러가던 지난 점수와 그 폴백은 여기서 끊긴다.
    updateScore();
    startTimer(game.scoreboard.settings.playTimeSeconds);
    dealBoards();
  }

  /*
   * 결과 화면. 형제 방들과 같이 정답·오답·보너스 자리에는 개수가 아니라 항목별
   * 점수가 들어간다. 순위와 저장 문구는 history API 응답으로 채운다.
   */
  function renderRankAndScore(rank, score) {
    const normalized = Math.trunc(Number(rank) || 0);
    el["result-rank"].textContent = normalized > 0 ? `${normalized}위` : "-";
    // 검수 4차 q59: 결과 화면 총점도 같은 자릿수 구분을 쓴다.
    el["result-total-value"].textContent = formatScore(score);
    el["result-total-score"].setAttribute("aria-label", `${formatScore(score)}점`);
  }

  /*
   * 등급마다 딸린 것을 한곳에 모은다(사장님 지시 2026-09-30). 그림·읽기 글자·소리가
   * 같은 줄에 있어야 등급이 늘거나 바뀔 때 하나만 빠지는 일이 없다 — 실제로 Good 과
   * Try again 이 같은 `stamp` 를 쓰고, `lose` 는 선언만 된 채 한 번도 울리지 않았다.
   * 차례는 rules.js 의 tier 와 같다: 0 Excellent · 1 Good · 2 Try again.
   */
  // confetti — 결과 화면 파티클을 내는지(2차 수정 4번: Try again 은 내지 않는다).
  const RESULT_TIERS = Object.freeze([
    Object.freeze({ headline: "result_text0", fox: "excellent", alt: "Excellent", sound: "cheer", confetti: true }),
    Object.freeze({ headline: "result_text1", fox: "good", alt: "Good", sound: "stamp", confetti: true }),
    Object.freeze({ headline: "result_text2", fox: "try_again", alt: "Try again", sound: "lose", confetti: false }),
  ]);

  /*
   * 검수 4차 9-2(사장님 지시 2026-09-29): 결과 화면 위쪽 버튼은 "다시 하기"가 아니라
   * "시작 화면으로"다. 다시 하기와 달리 나가면 그 판은 끝나므로 **점수 저장이 끝난 뒤에**
   * 움직인다. 나가면서 판과 열린 팝업을 정리한다.
   */
  function goToStartScreen() {
    if (game.leaving) return;
    game.leaving = true;
    const leave = () => {
      game.leaving = false;
      if (!el["incorrect-answer-dialog"].hidden) closeDialog(el["incorrect-answer-dialog"]);
      if (!el["ranking-dialog"].hidden) closeDialog(el["ranking-dialog"]);
      el["incorrect-answer-list"].textContent = "";
      el["ranking-body"].textContent = "";
      leavePlay();
      clearParticles();
      game.saving = null;
      showScreen("start");
    };
    Promise.resolve(game.saving).then(leave, leave);
  }

  function fillResult() {
    const state = game.scoreboard.getState();
    /*
     * 등급 분모는 **전체 제공 문제수**다(사장님 확답 2026-09-29).
     * 3차까지는 푼 짝의 수(맞힘+틀림)로 나눠서, 시간이 끝나 손도 못 댄 짝이 빠졌다 —
     * 열 짝 중 세 짝만 다뤄 셋 다 맞히면 Excellent 가 나왔다. 지시문이 괄호로
     * "전체 제공 문제수 기준" 이라고 못 박아 뒤집었다.
     */
    const tier = Rules.resultTier(Rules.resultRatio(state.matchedCount, game.board.totalQuestions));
    const look = RESULT_TIERS[tier];
    const headline = el["result-headline"];
    /*
     * 검수 4차 7항: 이 그림만 주소를 조립해 부르느라 캐시 버전이 없었다 — 3차 r10 으로
     * result_text2.png 의 내용이 바뀌었는데 옛 그림이 그대로 남을 수 있다. 조립형이라
     * 안 바뀐 result_text0·1 에도 함께 달리지만, 한 번 더 받는 것으로 끝난다.
     * 값은 index.html 의 `?v=` 와 같은 판을 쓴다.
     */
    headline.src = `assets/result/${look.headline}.png?v=${ASSET_VERSION}`;
    headline.alt = look.alt;
    /*
     * 등급별 여우도 같은 tier 로 고른다(사장님 지시 2026-09-30). 글자는 제목 그림이 말하므로 alt 는 비운다.
     * 그림을 못 읽으면 숨긴다 — 카드 위에 깨진 그림 표시가 남는 것보다 없는 편이 낫다.
     */
    const fox = el["result-fox"];
    fox.hidden = true;
    fox.onload = () => { fox.hidden = false; };
    fox.onerror = () => { fox.hidden = true; };
    fox.src = `assets/result/${look.fox}.png?v=${ASSET_VERSION}`;

    /*
     * 검수 4차 6항(2026-09-29): Correct 와 Incorrect 는 **개수**다. 점수 합을 찍던 자리라
     * 오답노트 줄 수와 어긋난다는 지적이 여러 방에서 나왔다. 같은 단어가 다시 나와도(q57) 문항 하나로 센다.
     * 점수는 Bonus 와 My Score 에 남는다.
     *
     * 공통-10(사장님 2026-10-12): Incorrect 숫자는 오답 목록(Incorrect Answers)에 실리는 줄 수 그대로다 — 둘 다
     * buildIncorrectList 하나에서 나온다. 등급은 Incorrect 가 아니라 맞힌 수 / 전체 제공 문제수로 정한다.
     *
     * 공통-2(완료화면 시트 · 사장님 2026-10-12): 숫자 뒤 '개' 를 빼고, Bonus 는 '+' 없이 숫자만 쓴다. Bonus 뒤 '점' 은
     * styles.css 의 .result-points::after 가 붙인다(Correct · Incorrect 에는 같은 폭의 보이지 않는 자리 — 세 줄 숫자 끝 맞춤).
     */
    const correctCount = game.matchedWords.size;
    const wrongCount = buildIncorrectList().length;
    el["result-correct"].textContent = String(correctCount);
    el["result-incorrect"].textContent = String(wrongCount);
    el["result-bonus"].textContent = formatScore(state.bonusPoints);
    el["result-correct"].setAttribute("aria-label", `맞힌 문항 ${correctCount}개`);
    el["result-incorrect"].setAttribute("aria-label", `못 맞힌 문항 ${wrongCount}개`);
    el["result-bonus"].setAttribute("aria-label", `보너스 점수 ${formatScore(state.bonusPoints)}점`);
    renderRankAndScore(0, state.score);

    // 검수 4차 q58: 못 맞힌 문항이 있으면 오답노트를 연다 — Incorrect 숫자와 같은 수다.
    el["incorrect-answers-button"].disabled = wrongCount === 0;
    el["incorrect-answers-button"].setAttribute(
      "aria-label",
      wrongCount > 0 ? `오답 ${wrongCount}개 보기` : "오답 없음",
    );

    // 랭킹은 점수를 저장한 뒤에 열린다.
    const launch = Content.getState().launch;
    const rankingAvailable = Boolean(launch && !launch.isGuest && !launch.isDemo);
    el["ranking-button"].disabled = true;
    el["ranking-button"].setAttribute(
      "aria-label",
      rankingAvailable
        ? "점수 저장 후 랭킹을 볼 수 있습니다"
        : "게스트 또는 데모 모드에서는 랭킹을 사용할 수 없습니다",
    );

    // 등급마다 다른 소리. 예전에는 Good 과 Try again 이 둘 다 `stamp` 였다(사장님 지시 2026-09-30).
    sound.effect(look.sound, 0.9);
    return tier;
  }

  // 점수 저장. 결과를 받아 순위와 안내 문구를 채우고, 회원이면 랭킹을 연다.
  function persistResult() {
    const launch = Content.getState().launch;
    const score = game.scoreboard.getState().score;
    el["result-message"].textContent = launch?.isTest
      ? `${launch.testMode === "member" ? "로그인" : "게스트"} 테스트 결과입니다.`
      : launch?.isDemo
        ? "데모 모드 결과입니다."
        : "점수를 저장하는 중입니다.";

    let saving = null;
    game.saving = null;
    try {
      saving = Content.saveHistory(score);
    } catch (error) {
      el["result-message"].textContent = error?.message || "점수를 저장하지 못했습니다.";
      return;
    }
    if (!saving || typeof saving.then !== "function") return;

    // 9-2 의 나가기 버튼이 이 약속을 기다린다 — 저장 전에 나가면 그 판이 사라진다.
    game.saving = saving;
    saving
      .then((data) => {
        const rank = Math.trunc(Number(data?.rank) || 0);
        renderRankAndScore(rank, score);
        // 형제와 같은 순서다. 테스트 모드를 먼저 갈라내지 않으면 저장하지도 않은
        // 점수를 두고 "저장했습니다"라고 말하게 된다.
        if (launch?.isTest) {
          el["result-message"].textContent = launch.isGuest
            ? "게스트 테스트 결과입니다. 점수는 저장하지 않습니다."
            : "로그인 사용자 테스트 결과입니다. 실제 점수는 저장하지 않습니다.";
        } else if (launch?.isDemo) {
          el["result-message"].textContent = "데모 모드에서는 점수를 저장하지 않습니다.";
        } else if (launch?.isGuest) {
          el["result-message"].textContent = "게스트 점수는 저장되지 않습니다.";
        } else if (rank > 0) {
          el["result-message"].textContent = "점수와 순위를 저장했습니다.";
        } else {
          el["result-message"].textContent = "점수를 저장했습니다. 현재 순위는 20위 밖입니다.";
        }
        if (launch && !launch.isGuest && !launch.isDemo) {
          el["ranking-button"].disabled = false;
          el["ranking-button"].setAttribute("aria-label", "랭킹 보기");
        }
      })
      .catch((error) => {
        el["result-message"].textContent = error?.message || "점수를 저장하지 못했습니다.";
      });
  }

  // 지금 판에 깔린 단어(맞혀서 사라진 짝 포함)를 다음 게임 첫 판에서 뺄 단어로 남긴다.
  function rememberLastBoard() {
    if (game.board) game.lastBoardWords = [...game.board.waveWordTexts()];
  }

  function finishGame() {
    if (!game.running) return;
    rememberLastBoard();
    game.running = false;
    game.locked = true;
    stopTimer();
    stopWave();
    global.clearTimeout(comboResetTimer);
    comboCheering = false;
    clearScoreBonus();
    hideComboGains();
    hideScoreDelta();
    // 굴러가던 점수가 있으면 끊고 최종 점수를 바로 찍는다.
    updateScore();
    setBoardsEnabled(false);
    if (game.scoreboard) game.scoreboard.close();

    const tier = fillResult();
    showScreen("end");
    // 2차 수정 4번: Try Again 에서는 파티클을 내지 않는다(Good · Excellent 일 때만).
    if (RESULT_TIERS[tier].confetti) emitConfetti();
    persistResult();
  }

  /* ---------------- 결과 파티클 ---------------- */

  /*
   * 결과 화면 색종이. 형제 방들과 같은 방식이다 — 캔버스에 사각 조각을 흩뿌리고
   * 흔들리며 떨어지게 한다. 화면을 벗어나면 스스로 멈춘다.
   */
  const PARTICLE_COLORS = Object.freeze([
    "#fff044", "#ff7338", "#25dfff", "#ff4ca8", "#ffffff", "#6bf06f",
  ]);

  let particles = [];
  let particleFrame = 0;

  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  function clearParticles() {
    if (particleFrame) {
      global.cancelAnimationFrame(particleFrame);
      particleFrame = 0;
    }
    particles = [];
    const canvas = el["result-particle-canvas"];
    const context = canvas?.getContext?.("2d");
    if (context) context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function emitConfetti() {
    const canvas = el["result-particle-canvas"];
    const context = canvas?.getContext?.("2d");
    if (!context) return;
    clearParticles();

    const reduced = global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const count = reduced ? 28 : 96;
    particles = Array.from({ length: count }, () => ({
      x: randomBetween(0, canvas.width),
      y: randomBetween(-canvas.height, 0),
      width: randomBetween(10, 20),
      height: randomBetween(14, 26),
      speed: randomBetween(2.2, 5.4),
      drift: randomBetween(-1.1, 1.1),
      spin: randomBetween(-0.09, 0.09),
      angle: randomBetween(0, Math.PI * 2),
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
    }));

    function step() {
      context.clearRect(0, 0, canvas.width, canvas.height);
      let alive = 0;
      particles.forEach((piece) => {
        if (piece.y > canvas.height + 40) return;
        alive += 1;
        piece.y += piece.speed;
        piece.x += piece.drift + Math.sin(piece.y / 46) * 0.9;
        piece.angle += piece.spin;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.angle);
        context.fillStyle = piece.color;
        context.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
        context.restore();
      });
      if (alive === 0) {
        particleFrame = 0;
        return;
      }
      particleFrame = global.requestAnimationFrame(step);
    }

    particleFrame = global.requestAnimationFrame(step);
  }

  /* ---------------- 오답노트 ---------------- */

  function cell(className, text) {
    const node = doc.createElement("span");
    node.className = `incorrect-answer-cell ${className}`;
    node.setAttribute("role", "cell");
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 긴 단어는 칸을 넘지 않도록 글자 크기를 줄인다.
  function fitWordText(textNode) {
    textNode.style.setProperty("--incorrect-word-scale", "1");
    let scale = 1;
    for (let step = 0; step < 10; step += 1) {
      if (textNode.scrollWidth <= textNode.clientWidth) break;
      scale -= 0.06;
      textNode.style.setProperty("--incorrect-word-scale", String(scale));
    }
  }

  /*
   * 오답노트에 낼 줄 — **다시 볼 단어**를 낸다(사장님 확정 2026-09-29).
   *
   *   담는다   : 한 번이라도 틀린 문항 (나중에 맞혔어도 — 다시 볼 단어다)
   *   담는다   : 출제됐는데 끝내 못 맞힌 문항 (검수 4차 q58 원문)
   *   담지 않음: 틀린 적 없이 맞힌 문항 (q57 재출제로 다시 나와도)
   *   담지 않음: 한 번도 출제되지 않은 문항
   *
   * 한동안 "명단에서 끝내 맞히지 못한 문항 전부"로 두었다. 결과 화면의
   * `Correct 개수 + Incorrect 개수` 를 전체 제공 문제수와 맞추려던 것인데,
   * 그러면 틀렸다가 나중에 맞힌 단어가 오답노트에서 빠진다. 검수표 원문에는
   * 오답노트 내용을 바꾸라는 요구가 없어 원래대로 되돌렸고, 합을 맞추라는 요구도
   * 함께 철회되었다. 대신 이미 맞힌 문항이 반복 바퀴에 다시 실리지 않는 것만 지킨다.
   *
   * 많이 틀린 것을 먼저, 같은 횟수면 알파벳 순으로 낸다. 한 번도 고르지 못한 단어는 0회다.
   */
  function buildIncorrectList() {
    const rows = Array.from(game.wrongRecords.values())
      .sort((a, b) => b.count - a.count || a.english.localeCompare(b.english));
    const listed = new Set(rows.map((row) => row.english.toLowerCase()));
    const untouched = [];
    game.presentedWords.forEach((word, key) => {
      // 맞힌 문항은 여기서 걸러진다 — q57 로 다시 출제되어도 줄이 새로 생기지 않는다.
      if (game.matchedWords.has(key) || listed.has(key)) return;
      untouched.push({ ...word, count: 0 });
    });
    untouched.sort((a, b) => a.english.localeCompare(b.english));
    return rows.concat(untouched);
  }

  function renderIncorrectList() {
    const list = el["incorrect-answer-list"];
    list.textContent = "";
    const rows = buildIncorrectList();

    if (rows.length === 0) {
      const empty = doc.createElement("p");
      empty.className = "incorrect-answer-empty";
      empty.textContent = "틀린 단어가 없습니다.";
      list.appendChild(empty);
      return;
    }

    const fragment = doc.createDocumentFragment();
    const pending = [];
    rows.forEach((row) => {
      const line = doc.createElement("div");
      line.className = "incorrect-answer-row incorrect-answer-grid";
      line.setAttribute("role", "row");

      const audio = cell("incorrect-answer-audio");
      const speaker = doc.createElement("button");
      speaker.type = "button";
      speaker.className = "incorrect-answer-speaker";
      speaker.dataset.skipTouch = "true";
      speaker.disabled = !row.soundUrl;
      speaker.setAttribute("aria-label", `${displayWord(row.english)} 발음 듣기`);
      const icon = doc.createElement("img");
      icon.src = "assets/incorrect-answer/icon_speaker.png";
      icon.alt = "";
      icon.width = 37;
      icon.height = 30;
      speaker.appendChild(icon);
      speaker.addEventListener("click", () => {
        if (!row.soundUrl) return;
        // 2차 수정 11번: 소리를 꺼 두었어도 직접 누른 발음은 들려준다(안내 없이).
        sound.word(row.soundUrl, null, { evenMuted: true });
      });
      audio.appendChild(speaker);

      const word = cell("incorrect-answer-word");
      const wordText = doc.createElement("span");
      wordText.className = "incorrect-answer-word-text";
      wordText.textContent = displayWord(row.english);
      word.appendChild(wordText);
      pending.push(wordText);

      // 검수 4차 q55: 초록 preview 에는 "틀린 횟수" 칸이 없다.
      line.append(audio, word, cell("incorrect-answer-meaning", row.meaning));
      fragment.appendChild(line);
    });
    list.appendChild(fragment);
    pending.forEach(fitWordText);
    // 글꼴을 받기 전에 재면 폭이 달라진다 — 받은 뒤 한 번 더 맞춘다(공통 문서 2절 "글꼴을 받은 뒤 다시 맞춤").
    doc.fonts?.ready?.then(() => pending.forEach(fitWordText));
  }

  /* ---------------- 랭킹 ---------------- */

  const RANKING_ROW_LIMIT = 20;

  function rankingCell(className, text) {
    const node = doc.createElement("span");
    node.className = `ranking-cell ${className}`;
    node.setAttribute("role", "cell");
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /*
   * 배지 그림이 오면 쓰고, 없거나 못 불러오면 글자로 대신한다. 대체 글자는
   * 형제 방들과 같이 3위까지 "O", 그 아래는 가운뎃점이다 — 순위 숫자를 다시
   * 쓰면 왼쪽 순위 칸과 같은 값이 두 번 나온다.
   */
  function rankingBadgeCell(entry, rank) {
    const node = rankingCell("ranking-row-badge");
    const source = String(entry?.badge_image || "").trim();
    const fallback = doc.createElement("span");
    fallback.textContent = rank <= 3 ? "O" : "•";
    fallback.setAttribute("aria-hidden", "true");
    if (!source) {
      node.appendChild(fallback);
      return node;
    }
    const image = doc.createElement("img");
    image.src = source;
    image.alt = "";
    image.loading = "lazy";
    fallback.hidden = true;
    image.addEventListener("error", () => {
      image.remove();
      fallback.hidden = false;
    }, { once: true });
    node.append(image, fallback);
    return node;
  }

  function setMyBadge(source) {
    const image = el["ranking-my-badge-image"];
    const fallback = el["ranking-my-badge-fallback"];
    const value = String(source || "").trim();
    if (!value) {
      image.hidden = true;
      fallback.hidden = false;
      return;
    }
    image.src = value;
    image.hidden = false;
    fallback.hidden = true;
    image.addEventListener("error", () => {
      image.hidden = true;
      fallback.hidden = false;
    }, { once: true });
  }

  function renderRanking(data) {
    // 축구 기준(랭킹_기준.md 4항): 목록은 최대 20위까지만 낸다.
    const rows = (Array.isArray(data?.rankings) ? data.rankings : []).slice(0, RANKING_ROW_LIMIT);
    el["ranking-my-nickname"].textContent = String(data?.nickname || "회원");
    el["ranking-my-score"].textContent = formatScore(data?.best_score);
    setMyBadge(data?.badge_image);

    const body = el["ranking-body"];
    body.textContent = "";
    if (rows.length === 0) {
      const empty = doc.createElement("p");
      empty.className = "ranking-empty";
      empty.textContent = "표시할 랭킹이 없습니다.";
      body.appendChild(empty);
      el["ranking-status"].textContent = "랭킹이 비어 있습니다.";
      return;
    }

    const fragment = doc.createDocumentFragment();
    rows.forEach((entry, index) => {
      const rank = index + 1;
      const line = doc.createElement("div");
      line.className = "ranking-row ranking-grid";
      line.setAttribute("role", "row");
      if (rank <= 3) line.classList.add("is-top-three", `is-rank-${rank}`);
      line.append(
        rankingCell("ranking-row-rank", `${rank}위`),
        rankingBadgeCell(entry, rank),
        rankingCell("ranking-row-name", String(entry?.nickname || "-")),
        rankingCell("ranking-row-score", formatScore(entry?.best_score)),
      );
      fragment.appendChild(line);
    });
    body.appendChild(fragment);
    el["ranking-status"].textContent = `랭킹 ${rows.length}명을 불러왔습니다.`;
  }

  function openRanking() {
    // 게스트 · 데모에서는 두 Ranking 버튼이 모두 꺼져 있어 여기 오지 않는다. 혹시 와도 안내 없이 물러난다(공통 문서 6절 5번).
    if (!isLoggedInMember()) return;
    let asking = null;
    try {
      asking = Content.getRanking();
    } catch (error) {
      showToast(error?.message || "랭킹을 사용할 수 없습니다.");
      return;
    }
    // 검수 4차 q49: "랭킹을 불러오는 중입니다." 토스트는 띄우지 않는다. 일부 방에만 떠서
    // 방마다 달라 보였고, 팝업이 열리면 그 안의 상태 문구가 결과를 알린다.
    asking
      .then((data) => {
        renderRanking(data);
        openDialog(el["ranking-dialog"]);
      })
      .catch((error) => {
        showToast(error?.message || "랭킹을 불러오지 못했습니다.");
      });
  }

  /* ---------------- 도움말 ---------------- */

  function renderHelp(items) {
    const box = el["help-content"];
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
    el["help-content-viewport"].scrollTop = 0;
    syncHelpScrollHint();
  }

  /*
   * 아래에 더 읽을 것이 남았는지 표시한다. OS 스크롤바는 설정에 따라 안 보이거나
   * 스크롤하는 동안만 잠깐 떠서, 그것만 믿으면 아이가 아래 내용을 못 보고 닫는다.
   */
  function syncHelpScrollHint() {
    const viewport = el["help-content-viewport"];
    const more = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 8;
    el["help-dialog"].classList.toggle("has-more", more);
  }

  function setHelpStatus(text, showRetry) {
    el["help-status"].hidden = false;
    el["help-status-text"].textContent = text;
    el["help-retry-button"].hidden = !showRetry;
  }

  function openHelp() {
    openDialog(el["help-dialog"]);
    el["help-content"].textContent = "";
    setHelpStatus("도움말을 불러오는 중입니다.", false);
    Content.getHelp()
      .then(renderHelp)
      .catch(() => setHelpStatus("도움말을 불러오지 못했습니다.", true));
  }

  /* [앱 전용 자리] 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — LF 가 앱(Android · iOS)에 올릴 때 직접 작업한다. 지금은 비어 있다. 화면에 알림은 띄우지 않는다. */
  function closeAppWebView() {}

  /*
   * 시작 화면의 X — 게임을 닫는 X 는 이것 하나다. 결과 화면 X · 게임 중 X(시작 화면으로) · 도움말 ←는 건드리지 않는다.
   *
   * 공통-12(사장님 2026-10-12 "closeAppWebView() 알려서 모든 컨텐츠에 적용할수있게해", 붙여 주신 글 "닫기(X) 버튼
   * 눌렀을때 동작 — 웹 : 창 닫기 / 앱 : 웹뷰 닫는 인터페이스 호출"): 12개 게임 모두 같은 이름의 빈 함수
   * closeAppWebView() 를 두고 같은 순서로 부른다 — 리틀폭스가 앱에 올릴 때 이 함수 안을 채운다. 게임은 앱인지 웹인지
   * 가르지 않는다.
   *
   *   0) 이 방의 닫기 알림 molegame:navigate 를 쏜다. 셸이 막으면(preventDefault) 여기서 끝
   *   1) closeAppWebView()
   *   2) window.close() — 웹은 새 창으로 열리므로 창을 닫는다(스크립트가 연 창만 닫힌다)
   *   3) 창이 닫히지 않았으면 이 방이 2026-09-30 부터 쓰던 길(사장님 지시 "뒤로가기 기능, 또는 정해진 url로 이동"):
   *      정해진 주소(?close_url= 또는 마크업 설정)가 있으면 그리로, 같은 자리에서 들어왔으면(referrer) 뒤로
   *
   * OX 의 대비책은 무조건 history.back() 이지만, 이 방은 referrer 가 같은 자리일 때만 뒤로 간다 — file:// 로 열면
   * history.length 가 직전에 보던 다른 모드 주소를 가리켜 엉뚱한 곳으로 돌아갔다(referrer 는 file:// 에서 비어 걸러진다).
   * 주소는 content-loader 가 같은 자리인지 검사한 것만 넘겨 준다.
   *
   * 다 안 되면 아무것도 하지 않는다. 한때 안내 문구를 띄웠으나 사장님 지시로 뺐다(2026-09-30, "토스트 뜨지 않게").
   * 지나간 이야기(지금 규칙 아님): 공통-12 전에는 정해진 주소 → referrer 뒤로 → window.close() 순서였다. 규칙으로 읽지 마십시오.
   */
  function closeGame() {
    const allowed = global.dispatchEvent(new global.CustomEvent("molegame:navigate", {
      detail: { screen: "close" },
      cancelable: true,
    }));
    if (!allowed) return;

    closeAppWebView();
    global.close();
    if (global.closed) return;

    const closeUrl = Content.getState().launch?.closeUrl;
    if (closeUrl) {
      global.location.href = closeUrl;
      return;
    }

    const referrer = String(doc.referrer || "");
    if (!referrer) return;
    try {
      const from = new global.URL(referrer);
      const here = new global.URL(global.location.href);
      if (from.origin === here.origin && from.protocol === here.protocol && from.host === here.host) {
        global.history.back();
      }
    } catch {
      // 읽을 수 없는 referrer 는 없는 것으로 본다.
    }
  }

  /* ---------------- 부트스트랩 ---------------- */

  /*
   * 시작 화면 Ranking 을 켜고 끄는 곳은 여기 하나뿐이다(공통 문서 6절 5번 — 레이싱 · 카드의
   * setStartRankingEnabled). 로그인하지 않은 게스트(데모 포함)는 꺼서 흐리게 두고, 눌러도
   * 반응 · 안내가 없다. 다른 곳에서 disabled 를 직접 풀면 게스트에게 다시 살아난다.
   * 예전에는 버튼을 살려 두고 누르면 "로그인이 필요합니다" 안내를 띄웠다.
   */
  function setStartRankingEnabled(wanted) {
    const button = el["start-ranking-button"];
    const launch = Content.getState().launch;
    const enabled = Boolean(wanted) && isLoggedInMember();
    button.disabled = !enabled;
    if (enabled) {
      button.removeAttribute("aria-label");
    } else if (launch?.isDemo) {
      button.setAttribute("aria-label", "랭킹, 데모 모드에서는 사용할 수 없음");
    } else {
      button.setAttribute("aria-label", "랭킹, 로그인 필요");
    }
  }

  function enableStartMenu() {
    el["start-button"].disabled = false;
    el["start-button"].removeAttribute("aria-busy");
    setStartRankingEnabled(true);
    el["help-button"].disabled = false;
  }

  /*
   * 한글 글꼴(나눔스퀘어라운드 ExtraBold, 사장님 지시 2026-10-02 — 처음 Bold 에서 14:20 ExtraBold 로)을 받아 둔다. 팻말 · 오답노트 칸 맞춤과 첫 화면은
   * 이 글꼴로 재고 그려야 한다 — 대체 글꼴로 잰 크기가 남으면 받은 뒤 넘치거나 남는다.
   * 받지 못해도(경로가 틀림 · 느린 망) 게임은 열린다: 실패는 삼키고 최대 KOREAN_FONT_WAIT_MS 만 기다린다.
   * 한 번 건 요청은 다시 걸지 않는다(다시 시도 버튼으로 load 가 또 불려도).
   */
  const KOREAN_FONT = '700 1em "NanumSquareRound Game"';
  // 오답 목록 전용 보통 굵기 한글(styles.css "NanumSquareRound List", 사장님 2026-10-15 "1번으로 통일 해"). 결과 화면에서야
  // 쓰이므로 시작 화면을 기다리게 하지 않고 미리 받기만 걸어 둔다 — 목록을 열 때 글자가 비어 보이지 않게.
  const INCORRECT_LIST_FONT = '500 1em "NanumSquareRound List"';
  const KOREAN_FONT_WAIT_MS = 3000;
  let koreanFontReady = null;

  function loadKoreanFont() {
    if (!koreanFontReady) {
      const loading = typeof doc.fonts?.load === "function"
        ? doc.fonts.load(KOREAN_FONT, "가").catch(() => [])
        : Promise.resolve([]);
      const timeout = new Promise((resolve) => {
        global.setTimeout(() => resolve([]), KOREAN_FONT_WAIT_MS);
      });
      koreanFontReady = Promise.race([loading, timeout]);
      if (typeof doc.fonts?.load === "function") doc.fonts.load(INCORRECT_LIST_FONT, "가").catch(() => []);
    }
    return koreanFontReady;
  }

  /*
   * 시작 화면 동화 정보(공통-9 — 사장님 2026-10-12 "적용 배치는 시작화면 로고와 버튼 사이인데 비율 잘 조절해서").
   * info 응답의 title 을 윗줄, subtitle 을 아랫줄에 낸다. 둘 다 없으면(데모 · 테스트 모드 · info 실패) 동화 정보만
   * 숨기고 배치는 그대로 둔다. 레벨과 번호는 넣지 않는다(검수표 캡처에 레벨이 없고, 번호는 API 값에 없다 — OX 와 같다).
   */
  function renderStartStory(info) {
    const title = String(info?.title ?? "").trim();
    const subtitle = String(info?.subtitle ?? "").trim();
    el["start-story-title"].textContent = title;
    el["start-story-subtitle"].textContent = subtitle;
    el["start-story-title"].hidden = !title;
    el["start-story-subtitle"].hidden = !subtitle;
    el["start-story"].hidden = !title && !subtitle;
  }

  /*
   * 동화 정보 글자를 자리 폭에 맞춘다 — 길면 말줄임으로 자르지 않고 두 줄을 같은 배율로 줄인다(사장님이 OX 방에서
   * 하신 말씀 "텍스트 범위는 지금 처럼 하돼 글자가 길어지면 폰트 크기를 줄이게"). 배율은 CSS 의 기준 크기(40px)에
   * 곱한다. 바닥(0.5배, 20px)에서도 넘치면 그때만 CSS 의 말줄임이 남는다. scrollWidth · clientWidth 는 무대 배율과
   * 무관한 값이라 창 크기와 상관없이 같다. 숨어 있으면 폭이 0 이라 재지 않는다.
   */
  const START_STORY_MIN_SCALE = 0.5;
  const START_STORY_STEP = 0.02;

  function fitStartStory() {
    const story = el["start-story"];
    if (story.hidden || el["start-screen"].hidden) return;
    const lines = [el["start-story-title"], el["start-story-subtitle"]].filter((line) => !line.hidden);
    let scale = 1;
    story.style.setProperty("--start-story-scale", "1");
    while (scale > START_STORY_MIN_SCALE && lines.some((line) => line.scrollWidth > line.clientWidth)) {
      scale = Math.max(START_STORY_MIN_SCALE, Number((scale - START_STORY_STEP).toFixed(2)));
      story.style.setProperty("--start-story-scale", String(scale));
    }
  }

  function load() {
    setLoading(true, "게임 준비 중", "단어와 게임 정보를 불러오고 있습니다.");
    // 시작 화면은 단어와 한글 글꼴이 둘 다 준비된 뒤에 연다. 글꼴 쪽은 실패하지 않는다(위).
    Promise.all([Content.bootstrap({ force: true }), loadKoreanFont()])
      .then(() => {
        setLoading(false);
        renderStartStory(Content.getState().content.info);
        showScreen("start");
        fitStartStory();
        // 영어 글꼴을 받기 전에 잰 폭이 남지 않게 받은 뒤 한 번 더 맞춘다.
        doc.fonts?.ready?.then(fitStartStory);
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

  function leavePlay() {
    // 게임 중 X → 시작 화면에서도 같은 규칙이다. 결과 화면에서 나갈 때는 finishGame 이 이미 남겼다.
    if (game.running) rememberLastBoard();
    stopTimer();
    stopWave();
    global.clearTimeout(comboResetTimer);
    comboCheering = false;
    clearScoreBonus();
    hideComboGains();
    hideScoreDelta();
    game.running = false;
    game.locked = true;
  }

  function bindEvents() {
    global.addEventListener("resize", fitStage);
    global.addEventListener("orientationchange", fitStage);

    // 판은 script.js가 만들므로 위임으로 받는다.
    el["board-field"].addEventListener("click", (event) => {
      const button = event.target.closest?.(".board");
      if (!button || button.disabled) return;
      handleSelect(Number(button.dataset.slot));
    });

    el["start-button"].addEventListener("click", startGame);
    el["start-ranking-button"].addEventListener("click", openRanking);
    el["retry-button"].addEventListener("click", load);

    const restart = () => {
      Content.rebuildQuestions();
      startGame();
    };
    el["try-again-button"].addEventListener("click", restart);
    el["result-replay-button"].addEventListener("click", goToStartScreen);
    el["incorrect-answers-button"].addEventListener("click", () => {
      // 먼저 열고 그 다음에 그린다 — 숨은 동안에는 폭이 0 이라 긴 단어 줄이기가 돌지 않는다.
      openDialog(el["incorrect-answer-dialog"]);
      renderIncorrectList();
    });
    el["ranking-button"].addEventListener("click", openRanking);

    [
      ["incorrect-answer-dialog", ["incorrect-answer-backdrop", "incorrect-answer-close"]],
      ["ranking-dialog", ["ranking-backdrop", "ranking-close"]],
    ].forEach(([dialogId, closers]) => {
      closers.forEach((closerId) => {
        el[closerId].addEventListener("click", () => closeDialog(el[dialogId]));
      });
    });

    el["help-button"].addEventListener("click", openHelp);
    el["help-content-viewport"].addEventListener("scroll", syncHelpScrollHint, { passive: true });
    global.addEventListener("resize", syncHelpScrollHint);
    /*
     * 글자 상자 크기가 바뀔 때마다 "더 있음(▾)"을 다시 잰다. 한글 글꼴(나눔스퀘어라운드)이 3초보다 늦게 오면 시작 화면이
     * 먼저 열려 도움말을 대체 글꼴로 재고, 글꼴이 실린 뒤 77px 넘쳐도 ▾ 가 뜨지 않았다(반박 검토 — 글꼴만 9초 늦춘 서버로 재현).
     * 스크롤 · 창 크기 말고는 다시 잴 계기가 없었기 때문이다. 크기 관찰은 글꼴이 바뀌어 줄이 늘어도 불린다.
     */
    if (typeof global.ResizeObserver === "function") {
      new global.ResizeObserver(syncHelpScrollHint).observe(el["help-content"]);
    }
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
      // 켤 때만 확인음을 낸다. 2차 수정 9번: 켜고 끌 때 안내 팝업은 띄우지 않는다 — 단추 그림이 상태를 보여 준다.
      if (!muted) sound.effect("touch", 0.7);
    });

    /*
     * 버튼 클릭음. 형제처럼 무대 하나에 캡처 단계로 걸어 둔다. 사운드 버튼은
     * 자기 확인음이 따로 있어 빼고, data-skip-touch를 단 버튼도 건너뛴다.
     * 판은 짝짓기 쪽에서 소리를 내므로 여기서 또 내지 않는다.
     */
    el["game-stage"].addEventListener("click", (event) => {
      const button = event.target.closest?.("button");
      if (!button
        || button.disabled
        || button === el["sound-button"]
        || button.classList.contains("board")
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
      // 진행 중이던 판은 버리고 시작 화면으로 돌아간다.
      leavePlay();
      showScreen("start");
    });

    /*
     * 배경음은 사용자가 처음 화면을 만졌을 때 시작한다. 브라우저가 그 전에는
     * 자동 재생을 막기 때문이다. 한 번 걸리면 다시 걸 필요가 없다.
     */
    const armBgm = () => sound.startBgm();
    doc.addEventListener("pointerdown", armBgm, { once: true });
    doc.addEventListener("keydown", armBgm, { once: true });

    doc.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      [el["incorrect-answer-dialog"], el["ranking-dialog"], el["help-dialog"]]
        .forEach((dialog) => closeDialog(dialog));
    });
  }

  function init() {
    // 한글 글꼴은 가장 먼저 받기 시작한다 — 단어 요청과 겹쳐 기다리는 시간을 줄인다.
    loadKoreanFont();
    fitStage();
    bindEvents();
    buildSlots();
    sound.preload();
    showScreen("loading");
    load();
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
