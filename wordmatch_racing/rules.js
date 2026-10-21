(function exposeWordMatchRules(global) {
  "use strict";

  /*
   * 점수·콤보·등급·시계. DOM을 모르므로 브라우저와 Node 양쪽에서 그대로 돈다.
   *
   * 값의 출처: 기획서(docs/game_spec.png) 항목 3.
   *   - Score: 정답 +100, 오답 -10, 3문제 연속 정답 시 추가 +100 콤보 적용
   *   - 타이머: 정해진 시간. 승인된 A-6 — API info.play_time(현재 전 타입 120초),
   *     값이 없으면 120초.
   * 장애물 충돌은 기획서에 점수가 없다. 승인된 A-5 — 오답과 같은 -10, 콤보 초기화.
   */
  const DEFAULTS = Object.freeze({
    playTimeSeconds: 40,
    correctScore: 100,
    incorrectScore: -10,
    obstacleScore: -10,
    streakLength: 3,
    streakBonus: 100,
  });

  function toPositiveInteger(value, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function toInteger(value, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? number : fallback;
  }

  function resolveSettings(options) {
    const given = options && typeof options === "object" ? options : {};
    return Object.freeze({
      playTimeSeconds: toPositiveInteger(given.playTimeSeconds, DEFAULTS.playTimeSeconds),
      correctScore: toInteger(given.correctScore, DEFAULTS.correctScore),
      incorrectScore: toInteger(given.incorrectScore, DEFAULTS.incorrectScore),
      obstacleScore: toInteger(given.obstacleScore, DEFAULTS.obstacleScore),
      streakLength: toPositiveInteger(given.streakLength, DEFAULTS.streakLength),
      streakBonus: toInteger(given.streakBonus, DEFAULTS.streakBonus),
    });
  }

  function createScoreboard(options) {
    const settings = resolveSettings(options);

    const state = {
      score: 0,
      correctCount: 0,
      wrongCount: 0,
      obstacleCount: 0,
      bonusCount: 0,
      // 결과 화면은 개수가 아니라 항목별 점수를 보여 준다(형제와 같다).
      // 장애물 감점은 오답 점수 칸에 함께 쌓인다 — 결과 판에 칸이 셋뿐이다.
      correctPoints: 0,
      incorrectPoints: 0,
      bonusPoints: 0,
      streak: 0,
      closed: false,
    };

    /*
     * 기획서에 점수 하한이 적혀 있지 않다. 형제 방과 같은 판단으로 0에서 자르지
     * 않고 그대로 둔다. 필요하면 여기 한 곳만 고치면 된다.
     */
    function applyScore(delta) {
      state.score += delta;
      return delta;
    }

    // 정답 상자를 자동차로 지나갔을 때.
    function registerCorrect() {
      if (state.closed) {
        return { ...snapshot(), applied: false, scoreDelta: 0, bonusDelta: 0, bonus: false };
      }
      state.correctCount += 1;
      state.streak += 1;
      const scoreDelta = applyScore(settings.correctScore);
      state.correctPoints += settings.correctScore;

      let bonusDelta = 0;
      let bonus = false;
      if (state.streak > 0 && state.streak % settings.streakLength === 0) {
        bonus = true;
        bonusDelta = applyScore(settings.streakBonus);
        state.bonusCount += 1;
        state.bonusPoints += settings.streakBonus;
      }
      return { ...snapshot(), applied: true, scoreDelta, bonusDelta, bonus };
    }

    // 오답 상자를 지나갔을 때. 연속 기록은 끊긴다.
    function registerWrong() {
      if (state.closed) {
        return { ...snapshot(), applied: false, scoreDelta: 0 };
      }
      state.wrongCount += 1;
      state.streak = 0;
      const scoreDelta = applyScore(settings.incorrectScore);
      state.incorrectPoints += settings.incorrectScore;
      return { ...snapshot(), applied: true, scoreDelta };
    }

    // 장애물에 부딪혔을 때(승인된 A-5): 오답과 같은 감점, 연속 기록 초기화.
    function registerObstacle() {
      if (state.closed) {
        return { ...snapshot(), applied: false, scoreDelta: 0 };
      }
      state.obstacleCount += 1;
      state.streak = 0;
      const scoreDelta = applyScore(settings.obstacleScore);
      state.incorrectPoints += settings.obstacleScore;
      return { ...snapshot(), applied: true, scoreDelta };
    }

    function close() {
      state.closed = true;
      return snapshot();
    }

    // 콤보 칸 수. 0..streakLength-1 을 돌아 마지막 칸은 보너스 순간에만 찬다.
    function comboFilled() {
      return state.streak % settings.streakLength;
    }

    function snapshot() {
      return {
        score: state.score,
        correctCount: state.correctCount,
        wrongCount: state.wrongCount,
        obstacleCount: state.obstacleCount,
        bonusCount: state.bonusCount,
        correctPoints: state.correctPoints,
        incorrectPoints: state.incorrectPoints,
        bonusPoints: state.bonusPoints,
        streak: state.streak,
        comboFilled: comboFilled(),
        closed: state.closed,
      };
    }

    return Object.freeze({
      settings,
      registerCorrect,
      registerWrong,
      registerObstacle,
      close,
      getState: snapshot,
    });
  }

  /*
   * 결과 화면 문구. Excellent / Good / Try again 세 장이 있다.
   *
   * 리워드 제공 기준(사장님 지시 2026-09-29, 12개 방 공통):
   *   Try again — 70% 미만 정답 (전체 제공 문제수 기준)
   *   Good      — 70% 이상 100% 미만
   *   Excellent — 100%
   * 정확히 70% 는 Good 이다(70~71% 사이가 비어 있어 "70% 미만이면 Try again" 쪽을 따랐다).
   * 경계가 다시 바뀔 수 있어 GOOD_RATIO 한 곳에만 둔다.
   *
   * 분모는 「푼 문제수」가 아니라 「판에 내려온 문제수」다. 시간이 끝나 손도 대지 못한
   * 문제까지 들어간다. 이 방은 한 판에 같은 단어가 여러 번 나오므로 단어 수가 아니라
   * 출제 횟수로 센다(사용자 결정 2026-09-29).
   */
  const GOOD_RATIO = 0.7;

  function resultTier(correctCount, providedCount) {
    const total = Math.max(0, toInteger(providedCount, 0));
    const correct = Math.max(0, toInteger(correctCount, 0));
    const ratio = total > 0 ? correct / total : 0;
    if (ratio >= 1) return 0; // result_text0: Excellent
    if (ratio >= GOOD_RATIO) return 1; // result_text1: Good
    return 2; // result_text2: Try again
  }

  function formatClock(totalSeconds) {
    const safe = Math.max(0, Math.trunc(Number(totalSeconds) || 0));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function noteKey(english) {
    return String(english ?? "").trim().toLocaleLowerCase("en-US");
  }

  /*
   * 오답노트 목록. 검수 4차 q58 — 「맞힌 문제 제외」가 아니라
   * 「출제된 문제 중 못 맞힌 것」으로 만든다. 그래서 판정이 한 번도 없이
   * 타임아웃된 문제도 출제된 이상 목록에 남는다.
   * 한 단어가 두 번 나와 한 번은 틀리고 한 번은 맞힌 경우에도 남긴다.
   * 빠지는 것은 「나올 때마다 맞힌 단어」뿐이다. (4차 절충안은 앞에서 맞힌 단어를 뒤 바퀴에서
   * 지나쳐도 담지 않았는데, 2차 A-4 로 그 경우도 담는다 — 아래 주석.)
   * 정렬은 많이 틀린 것 먼저, 같으면 나온 순서대로.
   */
  /*
   * 오답노트(검수 4차 q58 · 2차 수정 A-4). 못 맞힌 적이 있는 단어를 모두, 단어마다 한 줄로 담는다 —
   * 단어마다 "나온 횟수 > 맞힌 횟수" 이면 담는다(손도 못 댄 문제까지).
   * 2차 검수 공통-10(사장님 2026-10-12 "중복일경우 하나만 적용되게 중복허용 안함")부터 **결과 화면 Incorrect 는
   * 이 목록의 줄 수**다(script.js). 같은 단어를 여러 번 놓쳐도 한 줄 · 하나다. 그 전에는 Incorrect 가
   * 출제 회수 − 맞힌 회수라, 노트가 비는 것이 Incorrect 0 일 때와 같기만 했고 숫자는 서로 달랐다.
   *
   * 2차 A-4(사장님 2026-10-01 '노트에 담기'): 4차 절충안 — 이미 맞히고 틀린 적 없는 단어는 뒤 바퀴에서
   * 지나쳐도 담지 않는다 — 을 그 경우만큼 굽혔다. 그 단어가 Incorrect 를 1 올리는데 노트에는 없어서
   * "Incorrect 1개" 인데 오답노트 버튼이 숨는 일이 났다(OX 는 시간 초과 단어를 노트에 실어 같은 일을 풀었다).
   *
   * presentCounts · correctCounts(단어 → 횟수)를 주면 그 값을 쓴다 — 게임은 늘 준다. 주지 않으면 presented
   * 목록의 등장 수와 correctKeys(한 번이라도 맞힘 = 1)로 어림한다. 틀린 적이 있으면(wrongCounts) 언제나 담는다.
   */
  function countTable(table) {
    if (!table || typeof table !== "object") return null;
    const map = new Map();
    Object.entries(table).forEach(([raw, value]) => {
      const key = noteKey(raw);
      if (!key) return;
      map.set(key, (map.get(key) || 0) + Math.max(0, Math.trunc(Number(value) || 0)));
    });
    return map;
  }

  function buildIncorrectNotes({
    presented = [],
    correctKeys = [],
    wrongCounts = {},
    presentCounts = null,
    correctCounts = null,
  } = {}) {
    const solved = new Set([...correctKeys].map(noteKey).filter(Boolean));
    const shownTable = countTable(presentCounts);
    const rightTable = countTable(correctCounts);
    const appearances = new Map();
    [...presented].forEach((entry) => {
      const key = noteKey(entry?.english);
      if (key) appearances.set(key, (appearances.get(key) || 0) + 1);
    });
    const byKey = new Map();
    [...presented].forEach((entry) => {
      const key = noteKey(entry?.english);
      if (!key) return;
      const wrongCount = Math.max(0, Math.trunc(Number(wrongCounts?.[key]) || 0));
      // 목록에 있으면 적어도 한 번은 나왔다.
      const timesShown = Math.max(1, shownTable ? shownTable.get(key) || 0 : appearances.get(key) || 0);
      const timesRight = rightTable ? rightTable.get(key) || 0 : solved.has(key) ? 1 : 0;
      if (!(timesShown > timesRight || wrongCount > 0)) return;
      const soundUrl = String(entry?.soundUrl ?? "").trim();
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.soundUrl && soundUrl) existing.soundUrl = soundUrl;
        return;
      }
      byKey.set(key, {
        key,
        english: String(entry?.english ?? "").trim(),
        meaning: String(entry?.meaning ?? "").trim(),
        soundUrl,
        wrongCount,
        sequence: byKey.size,
      });
    });
    return [...byKey.values()].sort(
      (left, right) => right.wrongCount - left.wrongCount || left.sequence - right.sequence,
    );
  }

  /*
   * 시작화면 X 를 눌렀을 때 어디로 갈지 고른다(사장님 지시 2026-09-30).
   * 주소를 밖에서 받아 이동하므로 남의 주소로 끌려가지 않게 걸러야 한다.
   *
   * 이 방은 서버 없이 파일 경로로 열린다. 그 위에서 Chrome(Blink)으로 직접 재 본 값이다.
   * 기준 file 페이지: origin "file://" · protocol "file:" · host "" (빈 문자열).
   *
   *              값                       출처만 견주면   여기 규칙
   *   javascript:alert(1)                    차단          차단   (origin 이 "null")
   *   data:text/html,…                       차단          차단   (origin 이 "null")
   *   //evil.example/steal                   통과 ⚠        차단   ← host 검사가 막는다
   *   file://evil.example/x                  통과 ⚠        차단   ← host 검사가 막는다
   *   https://evil.example/y                 차단          차단
   *   ../index.html · index.html?x=1         통과          통과
   *   file:///etc/passwd                     통과          통과   (같은 스킴·같은 호스트)
   *
   * 즉 **실제로 뚫리는 것은 호스트를 붙인 두 모양**이고 host 검사가 그것을 막는다.
   * protocol 검사와 CLOSE_URL_PROTOCOLS 는 겹치는 방어다 — 엔진이 origin 을 다르게
   * 매기는 경우(node 의 new URL 은 file 주소의 origin 을 "null" 로 준다)에도 버티게 한다.
   *
   * 막는 범위는 **스킴이 바뀌는 것과 호스트가 바뀌는 것**까지다. 같은 스킴·같은 호스트의
   * 다른 경로(file:///etc/passwd)는 막지 않는다 — "같은 출처니 안전"으로 읽지 말 것.
   *
   * 시험은 반드시 **파일 경로 기준**으로 한다. https 기준으로만 넣어 보면 위 두 모양이
   * 저절로 걸러져 시험은 통과하고 실제 환경에서만 뚫린다.
   */
  const CLOSE_URL_PROTOCOLS = Object.freeze(["http:", "https:", "file:"]);

  function isSameOriginUrl(value, here) {
    if (typeof value !== "string" || !value.trim() || typeof here !== "string" || !here) return false;
    try {
      const base = new URL(here);
      const url = new URL(value, here);
      return url.origin === base.origin
        && url.protocol === base.protocol
        && url.host === base.host
        && CLOSE_URL_PROTOCOLS.indexOf(url.protocol) !== -1;
    } catch (error) {
      return false;
    }
  }

  /*
   * 배포 루트 = 게임 폴더의 부모(사장님 지시 2026-09-30). 서버 구조가
   * <루트>/<게임>/index.html 이라 ../ 가 곧 루트이고 ../index.html 이 모음 페이지다.
   * (납품 때 app/ 겹이 펴져서 그렇다. 로컬 file:// 검수에서는 app/ 이 남아 있어
   *  ../ 가 방 폴더가 되는데, 검수용 모음 페이지는 납품 대상이 아니라 그대로 둔다.)
   */
  function isUnderDeploymentRoot(value, here) {
    if (!isSameOriginUrl(value, here)) return false;
    try {
      return new URL(value, here).href.startsWith(new URL("../", here).href);
    } catch (error) {
      return false;
    }
  }

  /*
   * 지금 문서와 같은 곳을 가리키는 주소인가(사장님 지시 2026-09-30).
   *
   * location.assign 은 조각(#…)이나 질의만 다른 주소에서는 문서를 다시 읽지 않는다.
   * 그런데 부르는 쪽은 "갔다"고 보고 뒤 갈래를 건너뛰므로 X 가 완전한 무동작이 됐다.
   * 실제 앱에서 ?close_url=%23bye 로 재현했다 — 주소에 #bye 만 붙고 아무 일도 없었다.
   * 막는 값을 찾는 돌연변이로는 이런 것이 안 나온다. "통과시키되 아무 일도 안 하는 입력"
   * 이라서다. 검사는 막는가만이 아니라 할 일을 하는가도 봐야 한다.
   *
   * 그래서 경로만 견준다. 질의와 조각은 문서를 가르지 않으므로 뺀다.
   * 폴더로 끝나는 주소는 그 폴더의 index.html 로 눕힌다 — 안 그러면 "./" 가 샌다.
   */
  function isSameDocument(value, here) {
    try {
      const path = (url) => (url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname);
      return path(new URL(value, here)) === path(new URL(here));
    } catch (error) {
      return false;
    }
  }

  function resolveCloseTarget({ closeUrlParam = "", configCloseUrl = "", referrer = "", here = "" } = {}) {
    // 주소창에서 오는 값은 아무나 붙일 수 있으니 루트 아래로 묶는다.
    // 아래 설정값은 납품본 안에 박혀 있어 공격자가 못 건드리므로 묶지 않는다 —
    // 묶으면 리틀폭스가 루트 밖으로 닫고 싶을 때 운영이 깨진다.
    if (isUnderDeploymentRoot(closeUrlParam, here) && !isSameDocument(closeUrlParam, here)) {
      return Object.freeze({ action: "navigate", url: new URL(closeUrlParam, here).href, source: "close_url" });
    }
    if (isSameOriginUrl(configCloseUrl, here) && !isSameDocument(configCloseUrl, here)) {
      return Object.freeze({ action: "navigate", url: new URL(configCloseUrl, here).href, source: "config" });
    }
    // referrer 가 있고 같은 출처일 때만 뒤로 간다. history.length 로 재면 파일 경로에서
    // 직전에 보던 다른 모드로 되돌아간다(단어 미로가 겪은 일).
    if (isSameOriginUrl(referrer, here)) {
      return Object.freeze({ action: "back", source: "referrer" });
    }
    return Object.freeze({ action: "close-window", source: "none" });
  }

  global.WordMatchRules = Object.freeze({
    DEFAULTS,
    GOOD_RATIO,
    createScoreboard,
    resultTier,
    formatClock,
    buildIncorrectNotes,
    isSameOriginUrl,
    isUnderDeploymentRoot,
    isSameDocument,
    resolveCloseTarget,
  });
})(typeof window !== "undefined" ? window : globalThis);
