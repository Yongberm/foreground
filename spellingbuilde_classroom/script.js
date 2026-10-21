(function initSpellingBuilderClassroom(global) {
  "use strict";

  // ============================================================
  // 순수 로직 (DOM/Canvas 없이 동작 · Node 테스트 대상)
  // ============================================================

  // 기획서(docs/기획서_터치단어_5단계.png) 수치. index.html gameConfig가 덮어쓸 수 있다.
  const RULES = Object.freeze({
    questionCount: 12,   // 총 12문제
    chances: 3,          // 한 문제 기회 3번
    wordScore: 50,       // 정답 +50
    missPenalty: 10,     // 오답 -10
    /* 기획서에 "한 문제에 총 기회는 3번"과 "오답 철자를 누르면 기회 2번 차감"이 함께
       적혀 있는데, 2씩 깎으면 두 번째 오답에 소진되어 같은 문서의 "3회 오답일 경우
       강제 전환"과 어긋난다. 형제(block)와 같은 판단으로 두 번 명시된 3회 규칙을
       따르고 차감은 1로 둔다 — 2로 바꾸려면 gameConfig.classroom.wrongChanceCost 한 줄이다. */
    wrongChanceCost: 1,
    streakLength: 3,     // 3문제 연속 정답마다
    streakBonus: 100,    // 추가 +100
    /* 한 판 시간. API info.play_time 이 오면 그 값을 쓰고(2차 수정 2026-10-02, 사장님
       "한 판 시간 API 우선, 없으면 지금 값"), 없거나 잘못됐거나 info 요청이 실패하면 이 값이다. */
    timerSeconds: 210,   // 타이머 3분 30초
    /* 기획서 2-2: "첫번째 철자는 무조건 보여지는 것으로" — 정답 칸의 첫 글자는
       처음부터 채워 두고, 그 철자 타일 하나는 이미 쓴 것으로 표시한다. */
    revealFirstLetter: true,
  });

  /* 정답 칸·철자 타일 배치 — 시안(docs/game_preview.png)의 1920x1080 실측값이다.
     정답 칸(103px)과 타일(110px)이 같은 109px 피치로 12개 놓이고, 첫 칸은 x=306에서
     시작한다. 단어가 12글자보다 짧으면 남는 칸 수의 절반만큼 오른쪽으로 밀어
     가운데에 둔다. */
  const BOARD = Object.freeze({
    slots: 12,
    pitch: 109,
    slotSize: 103,
    tileSize: 110,
    originX: 306,
    slotTop: 438,
    tileTop: 600,
  });

  /* 뜻 글자 크기(cqw). 검수 r59(2026-09-09) "한글 텍스트 크기를 6단계 파이프 게임과
     같게" — 파이프의 .meaning-text 는 54px(2.8125cqw)이다. 이 값이 2026-09-08 의
     "최대 84px" 지시를 덮는다(사용자 승인 2026-09-10).
     칠판의 텍스트 영역(가운데 664x282)을 벗어나면 두 줄로 접은 뒤 들어갈 때까지
     줄이되 36px(1.875cqw) 아래로는 내리지 않는다 — 54px 에서는 대개 한 줄에 들어간다. */
  const MEANING_FONT = Object.freeze({ base: 2.8125, min: 1.875 });

  function shuffled(list, random) {
    const pool = list.slice();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool;
  }

  /* 2-1 선택 줄: 정답 철자를 순서 없이 랜덤 배치한다. 오답 철자는 두지 않는다
     (기획서). 섞은 결과가 정답 순서 그대로면 문제가 아니므로 다시 섞는다 —
     단, "aa"처럼 어떻게 섞어도 같은 단어는 그대로 둔다. */
  function buildTiles(letters, options = {}) {
    if (!Array.isArray(letters) || letters.length === 0) {
      throw new Error("철자 타일에는 최소 1글자가 필요합니다.");
    }
    const random = options.random || Math.random;
    const source = letters.map((letter, index) => ({ letter, sourceIndex: index }));
    const canDiffer = new Set(letters).size > 1;
    let tiles = shuffled(source, random);
    let guard = 0;
    while (canDiffer && tiles.every((tile, index) => tile.letter === letters[index]) && guard < 20) {
      tiles = shuffled(source, random);
      guard += 1;
    }
    // 재시도 상한에 걸리면(사실상 없다) 앞뒤를 바꿔서라도 순서를 깨뜨린다.
    if (canDiffer && tiles.every((tile, index) => tile.letter === letters[index])) {
      const swapWith = tiles.findIndex((tile) => tile.letter !== tiles[0].letter);
      [tiles[0], tiles[swapWith]] = [tiles[swapWith], tiles[0]];
    }
    return tiles.map((tile) => ({ letter: tile.letter, sourceIndex: tile.sourceIndex }));
  }

  /* 한 문제의 판정 상태 머신.
     - 정답 칸은 왼쪽부터 차례로 채운다. 기대하는 철자(letters[cursor])와 같은 글자의
       타일을 누르면 정답 — 같은 글자가 여러 개면 어느 타일을 눌러도 된다.
     - 다른 글자를 누르면 오답: 기회 차감. 기회를 다 쓰면 실패(failed) — 정답을
       노출하고 다음 문제로 강제 전환한다.
     - 첫 글자는 처음부터 채워 둔다(rules.revealFirstLetter). 한 글자 단어는 채우면
       끝나 버리므로 두 글자 이상일 때만 미리 채운다. */
  function createQuestionRound(letters, rules = RULES, options = {}) {
    if (!Array.isArray(letters) || letters.length === 0) {
      throw new Error("문제에는 최소 1글자가 필요합니다.");
    }
    const word = letters.join("");
    const tiles = buildTiles(letters, options);
    const filled = new Array(letters.length).fill("");
    const consumed = new Array(tiles.length).fill(false);
    let cursor = 0;
    let missCount = 0;
    let failed = false;
    let completed = false;
    let prefilledTile = -1;

    if (rules.revealFirstLetter && letters.length > 1) {
      filled[0] = letters[0];
      prefilledTile = tiles.findIndex((tile) => tile.letter === letters[0]);
      consumed[prefilledTile] = true;
      cursor = 1;
    }

    return {
      get word() { return word; },
      get letters() { return letters.slice(); },
      get tiles() { return tiles.map((tile) => ({ ...tile })); },
      get cursor() { return cursor; },
      get missCount() { return missCount; },
      get failed() { return failed; },
      get completed() { return completed; },
      get prefilledTile() { return prefilledTile; },
      filledLetters() { return filled.slice(); },
      consumedTiles() { return consumed.slice(); },
      expectedLetter() { return completed ? "" : letters[cursor]; },
      chancesLeft() { return Math.max(0, rules.chances - missCount); },
      tap(tileIndex) {
        if (failed || completed) return { type: "ignored" };
        const tile = tiles[tileIndex];
        if (!tile || consumed[tileIndex]) return { type: "ignored" };
        if (tile.letter === letters[cursor]) {
          consumed[tileIndex] = true;
          filled[cursor] = tile.letter;
          const slot = cursor;
          cursor += 1;
          completed = cursor >= letters.length;
          return { type: completed ? "complete" : "correct", tileIndex, slot, letter: tile.letter };
        }
        missCount += rules.wrongChanceCost;
        failed = missCount >= rules.chances;
        return {
          type: "wrong",
          tileIndex,
          slot: cursor,
          expected: letters[cursor],
          chancesLeft: Math.max(0, rules.chances - missCount),
          failed,
        };
      },
      /* 기회 소진: 남은 칸을 정답으로 채우고 남은 타일을 모두 쓴 것으로 표시한다.
         돌려주는 목록은 화면이 어느 칸·타일을 새로 칠해야 하는지 알려 준다. */
      reveal() {
        const slots = [];
        for (let index = cursor; index < letters.length; index += 1) {
          filled[index] = letters[index];
          slots.push(index);
        }
        const revealedTiles = [];
        consumed.forEach((used, index) => {
          if (!used) { consumed[index] = true; revealedTiles.push(index); }
        });
        cursor = letters.length;
        return { slots, tiles: revealedTiles };
      },
    };
  }

  /* 점수판: 정답 +50, 오답 -10, 3문제 연속 정답마다 +100 보너스. 실패하면 연속이 끊긴다.
     검수 q61(2026-09-28): 0점에서 오답이면 마이너스로 내려가야 한다. 예전에는 0을
     하한으로 두어 0에서 멈췄는데, 그것이 지적됐다 — 하한을 두지 않는다. */
  function createScoreboard(rules = RULES) {
    let score = 0;
    let streak = 0;
    let bonusTotal = 0;
    return {
      get score() { return score; },
      get streak() { return streak; },
      get bonusTotal() { return bonusTotal; },
      miss() {
        score -= rules.missPenalty;
        return score;
      },
      wordComplete() {
        score += rules.wordScore;
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

  /* 리워드 제공 기준 — 사장님 지시 2026-09-29, 12개 방 공통.
       Try again  70% 미만 정답 (전체 제공 문제수 기준)
       Good       71~99% 정답
       Excellent  100% 정답
     분모는 **전체 제공 문제수**다. 시간이 끝나 손도 못 댄 문제도 분모에 들어간다
     (tally.total 이 그 판의 문제 수라 이미 그렇다).
     정확히 70% 는 Good 이다 — 사장님 그림에 70~71% 사이가 비어 있고, 단정적으로 쓰인 규칙은
     "70% 미만이면 Try again" 하나뿐이라 부모 방이 그렇게 정했다(확정 대기).
     확정이 달리 오면 이 상수 한 줄만 고치면 된다. */
  const GOOD_MIN_RATIO = 0.7;

  /* 결과 등급. 타이틀 그림·alt·결과 소리가 모두 이것 하나를 쓴다 —
     예전에는 경계 0.6 이 세 곳에 흩어져 있어 한 곳만 고치면 소리와 그림이 어긋났다.
     모양(상수명·시그니처·반환 문자열)은 fox 코디네이터가 12방에 배포한 참고 구현
     (따라쓰기 방)과 같게 맞춘 것이다 — 방마다 다르면 대조가 어렵다. */
  function resultTier(ratio) {
    const value = Number.isFinite(ratio) ? ratio : 0;
    if (value >= 1) return "excellent";
    return value >= GOOD_MIN_RATIO ? "good" : "tryAgain";
  }

  // 맞힌 수와 전체 제공 문제수로 정답률을 낸다. 문제가 없으면 0 이다.
  function correctRatio(correct, total) {
    const totalCount = Math.max(0, Math.trunc(total) || 0);
    const correctCount = Math.max(0, Math.trunc(correct) || 0);
    return totalCount > 0 ? correctCount / totalCount : 0;
  }

  /* 오답노트에 실을 목록 — **화면에 나온 문제 중 못 맞힌 것**이다(2차 수정 2026-10-02,
     사장님 "오답노트는 나온 문제만 담고 Incorrect 숫자도 같은 기준").
     results[i] 는 맞히면 true, 기회를 소진하면 false, 손도 못 댄 문제면 undefined 다.
     shown 은 화면에 나온 문제 수다(createGameFlow 의 present()).
     - 나온 뒤 손도 못 대고 시간이 끝난 문제(undefined)는 들어간다 — 검수 q58 과 PDF 4번
       "아무것도 안하고 게임 시간이 지나도 나왔던 문제는 incorrect answer 에".
     - **나오지 않은 문제는 빠진다.** 예전(q58 때)에는 출제 목록 12개를 다 훑어서, 시간이
       끝나면 화면에 한 번도 안 나온 단어까지 최대 12개가 오답노트에 실렸다. */
  /* 점수 표기(공통 10항 2026-09-29): 1000 이 아니라 1,000 으로 쓴다. 점수를 글자로 쓰는
     자리는 모두 이 함수를 거친다 — 자리마다 따로 쓰면 한 곳이 빠진다.
     - "en-US" 를 명시한다. 빼면 브라우저 지역 설정에 따라 구분자가 달라진다.
     - 반올림은 Math.round 다. Math.trunc 는 굴림 연출의 중간값 999.6 을 999 로 만들어
       숫자가 1,000 에 닿기 전에 멈춘 것처럼 보인다.
     - Math.round(-0.4) 는 -0 이고 (-0).toLocaleString() 은 "-0" 이라 화면에 -0 이 보인다.
       이 게임은 점수 하한이 없어(q61) 0 근처를 실제로 지나가므로 0 으로 눕힌다.
     단위("점"·"개")는 붙이지 않는다 — 부르는 자리가 붙인다. */
  function formatScore(value) {
    const rounded = Math.round(Number(value) || 0);
    return (rounded === 0 ? 0 : rounded).toLocaleString("en-US");
  }

  /* 자바스크립트가 조립하는 그림 주소에도 캐시 버전을 붙인다(공통 7항 2026-09-29).
     버전은 index.html 이 그 자리에 이미 박아 둔 것을 그대로 물려받는다 — 버전을 두 곳에
     적어 두면 한쪽만 올리게 되고, 그러면 내용이 바뀐 그림을 브라우저가 옛것으로 보여 준다. */
  function assetVersionOf(url) {
    const query = String(url ?? "").split("?")[1];
    return query ? `?${query}` : "";
  }

  /* 공통 11항(2026-09-29): index.html 이 ?v= 를 붙여 preload 한 그림을 자바스크립트가
     버전 없이 요청하면 브라우저는 둘을 다른 주소로 보아 preload 를 버리고 같은 그림을
     두 번 받는다. 조립하는 주소에도 같은 버전을 붙여 한 주소로 맞춘다. */
  function assetUrl(path, version) {
    const base = String(path ?? "");
    const tag = String(version ?? "");
    if (!base || !tag || base.includes("?")) return base;
    return `${base}${tag}`;
  }

  /* 닫기 주소가 안전한지 본다(2026-09-30). origin 만 견주면 안 된다 —
     file:// 에서는 URL.origin 이 어떤 주소든 문자열 "null" 이라 언제나 같다고 나온다.
     검수가 12개 방 모두 file:// 로 돈다. 그런데 엔진마다 값이 다르니 둘 다 맞춰야 한다 —
     직접 재 보면 node 는 file:// 기준 origin 이 "null" 이라 javascript: · data: · //evil ·
     file://evil 이 전부 통과하고, 브라우저(Blink)는 origin 이 "file://" 이라 앞의 둘은
     막히지만 //evil.example 과 file://evil.example 은 여전히 통과한다.
     그래서 protocol 과 host 까지 견주고, 받아들일 프로토콜을 따로 정해 둔다 —
     이 조합은 두 엔진 모두에서 넷을 다 막고 상대 경로는 통과시킨다. */
  const CLOSE_PROTOCOLS = Object.freeze(["http:", "https:", "file:"]);

  function isSameOriginUrl(value, baseHref) {
    const raw = String(value ?? "").trim();
    if (!raw) return false;
    try {
      const base = new URL(String(baseHref));
      const url = new URL(raw, base);
      return url.origin === base.origin
        && url.protocol === base.protocol
        && url.host === base.host
        && CLOSE_PROTOCOLS.includes(url.protocol);
    } catch {
      return false;
    }
  }

  /* 주소창으로 들어온 닫기 주소는 배포 루트 아래로만 보낸다(사장님 결정 2026-09-30).
     루트는 게임 폴더 한 층 위다 — 모음 페이지(../index.html)는 거기 있고, ../../etc/passwd
     같은 더 위쪽은 벗어난다.
     🔴 단서: 이 제한은 게임이 루트에서 두 단계 이상 깊을 때만 실효가 있다. 직접 재 보면
     게임이 사이트 첫 단계에 놓이면 루트가 file:/// 나 https://host/ 가 되어 ../../etc/passwd
     가 그대로 통과한다(file:/// 이면 file:///etc/passwd 까지). 실제 배포는
     /littlefox/v2/<게임>/ 라 세 단계이므로 막힌다.
     설정에 박아 둔 deployment.closeUrl 에는 걸지 않는다 — 운영이 루트 밖으로 닫고 싶을 때가
     있고, 그 값은 주소창과 달리 납품본 안에 있다. */
  function isUnderDeployRoot(value, baseHref) {
    const raw = String(value ?? "").trim();
    if (!raw) return false;
    try {
      const base = new URL(String(baseHref));
      return new URL(raw, base).href.startsWith(new URL("../", base).href);
    } catch {
      return false;
    }
  }

  /* 같은 문서를 가리키는 주소인지 본다(2026-09-30). 지금 파일을 그대로 가리키면
     location.assign 은 불려도 이동이 없다. 그것을 "성공"으로 치면 뒤 갈래를 모두 건너뛰어
     X 가 완전한 무동작이 된다.

     🔴 경로만 견준다. 처음에는 조각만 지우고 href 를 통째로 견줬는데, 실제 배포 주소에는
     질의가 늘 붙어 있어(fc_id · fu_id · api-locale · close_url) 기준에는 질의가 있고
     후보에는 없다 → 두 href 가 달라 "다른 문서"로 통과했다. 그래서 index.html · ./ ·
     ?x=1 · ?x=1#bye 가 다 새어 X 가 게임을 다시 띄웠다(이 방에서 재현).
     질의와 조각은 문서를 가르지 않으므로 pathname 만 본다.

     폴더로 끝나는 주소는 그 폴더의 index.html 로 눕힌다 — 모음 페이지는 파일 꼴로 보내지만
     주소창 입력이나 서버 디렉터리 색인은 폴더 꼴로 들어온다. 이 눕힘을 빼면 파일 꼴 기준에서는
     './' 가, 폴더 꼴 기준에서는 'index.html' 이 샌다(둘 다 재서 확인했다). */
  function documentPath(url) {
    return url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  }

  function isSameDocument(value, baseHref) {
    const raw = String(value ?? "").trim();
    if (!raw) return true;
    try {
      const here = new URL(String(baseHref));
      return documentPath(new URL(raw, here)) === documentPath(here);
    } catch {
      return false;
    }
  }

  // 쓸 수 있는 닫기 주소인지 — 안전하고, 가는 곳이 지금 문서가 아니어야 한다.
  function usableCloseUrl(value, baseHref, { underRoot = false } = {}) {
    if (!isSameOriginUrl(value, baseHref)) return false;
    if (underRoot && !isUnderDeployRoot(value, baseHref)) return false;
    return !isSameDocument(value, baseHref);
  }

  /* 시작화면 X 를 눌렀을 때 어디로 갈지 고른다. 순서가 정해져 있다:
     준 주소 → 설정에 적힌 주소 → 온 곳으로 되돌리기 → 창 닫기 → 그래도 안 되면 안내.
     되돌리기는 document.referrer 로 판단한다 — history.length 는 다른 모드에서 넘어온
     경우까지 세어서, file:// 로 열면 직전에 보던 남의 화면으로 되돌아간다. */
  function chooseCloseAction({ closeParam, configUrl, referrer, baseHref } = {}) {
    if (usableCloseUrl(closeParam, baseHref, { underRoot: true })) {
      return { type: "assign", url: String(closeParam).trim() };
    }
    if (usableCloseUrl(configUrl, baseHref)) return { type: "assign", url: String(configUrl).trim() };
    if (isSameOriginUrl(referrer, baseHref)) return { type: "back" };
    return { type: "close" };
  }

  function collectWrongWords(questions, results = [], shown = Array.isArray(questions) ? questions.length : 0) {
    if (!Array.isArray(questions)) return [];
    const seen = Math.max(0, Math.trunc(shown) || 0);
    return questions
      .filter((question, index) => question && index < seen && results[index] !== true)
      .map((question) => ({
        english: displayWord(question.letters),
        meaning: question.meaning,
        soundUrl: question.soundUrl,
      }));
  }

  /* 다시 시작할 때 첫 문제가 직전 판에서 마지막으로 나온 단어면 다른 자리와 바꾼다
     (2차 수정 공통 1절 "다시 시작", 2026-10-02). Try Again 이든 X → Start 든 같다.
     단어는 영어 철자로 견준다 — 같은 철자가 다른 뜻으로 두 번 들어 있어도 같은 단어다.
     바꿀 단어가 없으면(문제가 하나뿐이거나 전부 같은 단어) 그대로 둔다 — 판은 늘 열린다.
     새로 고침하면 기억하지 않는다(app 상태에만 둔다). */
  function avoidLeadingWord(questions, lastWord) {
    if (!Array.isArray(questions) || questions.length < 2) return questions;
    const key = (question) => displayWord(question?.letters ?? question?.english ?? "");
    const last = displayWord(String(lastWord ?? ""));
    if (!last || key(questions[0]) !== last) return questions;
    const swapAt = questions.findIndex((question, index) => index > 0 && key(question) !== last);
    if (swapAt < 0) return questions;
    const out = questions.slice();
    [out[0], out[swapAt]] = [out[swapAt], out[0]];
    return out;
  }

  /* 한 판 시간(초). API info.play_time 을 먼저 쓰고, 양의 수가 아니면 fallback 이다
     (2차 수정 2026-10-02). 상한·하한은 두지 않는다 — 잘못된 값은 API 쪽에서 고친다(공통 1절). */
  function playSeconds(apiValue, fallback = RULES.timerSeconds) {
    const value = Math.trunc(Number(apiValue));
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  /* 남은 초 → 경고 단계. 10~6초 urgent(1초 주기), 5~1초 critical(0.5초 주기), 그 밖은 없음.
     0초는 판이 끝나는 순간이라 경고를 걸지 않는다. */
  function timerUrgency(remainingSeconds) {
    const value = Number(remainingSeconds);
    if (!Number.isFinite(value) || value <= 0 || value > 10) return "";
    return value <= 5 ? "critical" : "urgent";
  }

  /* 결과 파티클은 Good · Excellent 에서만 낸다 — Try again 에서는 없다(2차 수정 PDF 2쪽 1번). */
  function particlesFor(tier) {
    return tier === "good" || tier === "excellent";
  }

  // 문항 진행/정오 집계.
  function createGameFlow(totalQuestions) {
    const total = Math.max(1, Math.trunc(totalQuestions) || 1);
    let index = 0;
    let correct = 0;
    let incorrect = 0;
    let shown = 0;
    const results = [];
    return {
      total,
      get index() { return index; },
      get correct() { return correct; },
      get incorrect() { return incorrect; },
      /* 화면에 나온 문제 수. 문제를 그릴 때(loadQuestion) present() 로 센다 — index 로
         어림하면 다음 문제로 넘어가기 직전(정답 노출 중)과 넘어간 직후가 구별되지 않는다. */
      get shown() { return shown; },
      currentNumber() { return Math.min(index + 1, total); },
      isFinished() { return index >= total; },
      present() {
        if (index < total) shown = Math.max(shown, index + 1);
        return shown;
      },
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
      tally() { return { correct, incorrect, total, shown, results: results.slice() }; },
    };
  }

  // 전체 게임 카운트다운. now(ms)를 밖에서 넣어 순수하게 검사할 수 있다.
  function createCountdown(totalSeconds) {
    const totalMs = Math.max(0, totalSeconds) * 1000;
    let deadline = null;
    return {
      get totalSeconds() { return totalMs / 1000; },
      start(nowMs) { deadline = nowMs + totalMs; },
      remainingSeconds(nowMs) {
        if (deadline === null) return Math.ceil(totalMs / 1000);
        return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
      },
      remainingRatio(nowMs) {
        if (totalMs <= 0) return 0;
        if (deadline === null) return 1;
        return Math.max(0, Math.min(1, (deadline - nowMs) / totalMs));
      },
      isExpired(nowMs) { return deadline !== null && nowMs >= deadline; },
    };
  }

  /* 연속 정답 표시 단계 = 이번 주기에서 채워 둘 칸 수(0·1·2).
     3연속을 채우면 보너스가 터지고 표시는 0으로 돌아간다. 점수 원판의 고리가
     이 값을 3분의 1씩 채워 보여 준다(형제 block의 콤보 블록에 해당). */
  function streakStep(streak, length = RULES.streakLength) {
    const total = Math.max(0, Math.trunc(streak) || 0);
    if (length <= 0) return 0;
    return total % length;
  }

  // 정답 칸·타일의 왼쪽 x(무대 px). 단어가 짧으면 남는 칸의 절반만큼 밀어 가운데에 둔다.
  function slotLeft(index, count, board = BOARD) {
    const total = Math.max(1, Math.min(board.slots, Math.trunc(count) || 1));
    const offset = ((board.slots - total) * board.pitch) / 2;
    return board.originX + offset + index * board.pitch;
  }

  function tileLeft(index, count, board = BOARD) {
    // 타일(110)은 칸(103)보다 크므로 같은 중심에 오도록 반씩 빼 준다.
    return slotLeft(index, count, board) - (board.tileSize - board.slotSize) / 2;
  }

  /* 뜻 글자가 칠판을 넘으면 들어갈 만큼 줄인다.
     measured = 지금 크기로 잰 글자 폭, available = 칠판 안쪽 폭(같은 단위).
     최소 크기 아래로는 내리지 않는다 — 그보다 작아지면 읽을 수 없다. */
  function fitFontSize(measured, available, base, min) {
    if (!(measured > 0) || !(available > 0) || !(base > 0)) return base;
    if (measured <= available) return base;
    return Math.max(min, base * (available / measured));
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Math.trunc(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  /* 표기 규칙(검수 r7, 2026-08-19): "영어문제는 모두 소문자로 나와야 함".
     정답 노출·오답노트에 보이는 영어 단어도 전부 소문자다 — 예전에는 형제 공통
     "시작은 대문자"를 따라 첫 글자를 올렸는데, 검수에서 그것이 지적됐다.
     타일·정답 칸의 철자는 원래부터 소문자다. */
  function displayWord(letters) {
    const word = Array.isArray(letters) ? letters.join("") : String(letters ?? "");
    if (!word) return "";
    return word.toLocaleLowerCase("en-US");
  }

  const PureLogic = Object.freeze({
    RULES,
    BOARD,
    MEANING_FONT,
    buildTiles,
    createQuestionRound,
    GOOD_MIN_RATIO,
    resultTier,
    correctRatio,
    assetVersionOf,
    assetUrl,
    isSameOriginUrl,
    isUnderDeployRoot,
    documentPath,
    isSameDocument,
    usableCloseUrl,
    chooseCloseAction,
    formatScore,
    collectWrongWords,
    avoidLeadingWord,
    playSeconds,
    particlesFor,
    timerUrgency,
    createScoreboard,
    createGameFlow,
    createCountdown,
    streakStep,
    slotLeft,
    tileLeft,
    fitFontSize,
    formatClock,
    displayWord,
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

  /* 캐시 버전은 index.html 이 박아 둔 것을 실행 중에 읽는다 — script.js 에 숫자를 따로
     적으면 다음 차수에 한쪽만 올라간다(함정 6). 스타일시트 링크는 늘 있고 버전을 단다. */
  const ASSET_VERSION = assetVersionOf(doc.querySelector('link[rel="stylesheet"]')?.getAttribute("href"));
  const asset = (path) => assetUrl(path, ASSET_VERSION);

  // 형제 공통 흐름: 완성(또는 실패)하면 칠판에 단어를 띄우고 사운드를 들려준 뒤
  // 스스로 다음 문제로 넘어간다. 확인 버튼은 없다.
  const FLY_MS = 240;            // 타일 글자가 정답 칸으로 날아가는 시간(CSS와 같다)
  const REVEAL_SOUND_MS = 320;   // 단어가 칠판에 뜨고 발음이 나오기까지
  const REVEAL_HOLD_MS = 2000;   // 완성 단어를 보여 주는 시간
  const FAIL_HOLD_MS = 2400;     // 정답 노출(실패)을 보여 주는 시간
  /* 문제 제시 때 발음을 내던 지연 상수는 검수 r13 으로 사라졌다 —
     발음은 정답·정답 노출 뒤(REVEAL_SOUND_MS)에만 난다. */
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
    meaningHolder: doc.getElementById("word-meaning"),
    // 정답 노출 오버레이(r60) — 칠판이 아니라 화면 가운데에 단어만 띄운다.
    answerReveal: doc.getElementById("answer-reveal"),
    wordReveal: doc.getElementById("word-reveal"),
    answerSlots: doc.getElementById("answer-slots"),
    letterTiles: doc.getElementById("letter-tiles"),
    scoreRing: doc.querySelector(".hud-score"),
    scoreRingFill: doc.getElementById("score-ring-fill"),
    scoreValue: doc.getElementById("score-value"),
    timerRing: doc.querySelector(".hud-timer"),
    timerRingFill: doc.getElementById("timer-ring-fill"),
    questionProgress: doc.getElementById("question-progress"),
    timerValue: doc.getElementById("timer-value"),

    // 결과는 화면(end-screen)이다 — 형제 공통.
    endScreen: doc.getElementById("end-screen"),
    resultTitle: doc.getElementById("result-title"),
    resultChar: doc.getElementById("result-char"),
    resultScoreNumber: doc.getElementById("result-score-number"),
    resultTotalScore: doc.getElementById("result-total-score"),
    resultCorrectPoints: doc.getElementById("result-correct-points"),
    resultIncorrectPoints: doc.getElementById("result-incorrect-points"),
    resultBonusPoints: doc.getElementById("result-bonus-points"),
    resultMessage: doc.getElementById("result-message"),
    resultExitButton: doc.getElementById("result-exit-button"),
    resultParticleCanvas: doc.getElementById("result-particle-canvas"),
    tryAgainButton: doc.getElementById("try-again-button"),
    incorrectAnswersButton: doc.getElementById("incorrect-answers-button"),

    // 오답 목록 팝업 (형제 공통의 랭킹 팝업 result-dialog 는 이 게임에 없다 — 스펠링 빌더는 랭킹을 넣지 않는다)
    incorrectAnswerDialog: doc.getElementById("incorrect-answer-dialog"),
    incorrectAnswerBackdrop: doc.getElementById("incorrect-answer-backdrop"),
    incorrectAnswerCloseButton: doc.getElementById("incorrect-answer-close-button"),
    incorrectAnswerList: doc.getElementById("incorrect-answer-list"),
  };

  // ---- 실행 상태 ----
  const app = {
    rules: { ...RULES },
    closeUrl: "",
    launch: null,
    questions: [],
    flow: null,
    scoreboard: null,
    round: null,          // 현재 문제의 판정 상태 머신
    /* 판·문제가 바뀔 때마다 올라가는 세대 번호. 늦게 깨어나는 setTimeout 을
       이번 세대에만 묶는 데 쓴다 — app.screen 검사만으로는 부족하다.
       새 판이 시작되면 screen 이 다시 "game" 이 되어 이전 판의 콜백이 통과하고,
       그 콜백이 새 판의 칸·타일을 덮어쓴다. */
    generation: 0,
    apiPlayTimeSeconds: 0, // 규약 info.play_time — 0 이면 API 가 주지 않은 것이다
    lastWord: "",          // 직전 판에서 마지막으로 나온 단어(다시 시작 첫 문제 비교용)
    configTimerSeconds: 0, // API 가 한 판 시간을 주지 않을 때 쓰는 값(설정값 또는 210)
    countdown: null,
    locked: true,         // 전환 중 입력 잠금
    muted: false,
    audio: null,
    lastFocus: null,
    activeModal: null,
    screen: "loading",
    wrongWords: [],
    savePromise: null,
    exiting: false,
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

  /* 형제 공통 계약: navigation 은 start / help / game 에서, sound 는 start / game 에서 보인다.
     - 시작 · 게임 화면: 오른쪽 위 X(검수 r12 2026-08-26 — 예전에 시작 화면 밖에서 쓰던 화살표가
       지적돼 X 로 바꿨다), 왼쪽 위 스피커.
     - **도움말 화면만**: X 를 없애고 왼쪽 위(스피커 자리)에 ← 뒤로가기, 스피커는 숨긴다
       (2차 수정 PDF 1쪽, 공통 1절 "도움말 버튼" 2026-10-02). 버튼은 하나를 그대로 쓰고
       자리(.is-help-back)와 그림만 바꾼다 — 누르는 동작은 같다(시작 화면으로).
     누르는 동작은 그대로다(도움말·게임에서는 시작 화면으로, 시작 화면에서는 닫기). */
  function syncGlobalControls(screen) {
    const visible = screen === "start" || screen === "help" || screen === "game";
    const onHelp = screen === "help";
    if (el.soundButton) el.soundButton.hidden = !visible || onHelp;
    if (el.navigationButton) {
      el.navigationButton.hidden = !visible;
      el.navigationButton.classList.toggle("is-help-back", onHelp);
    }
    const closesGame = screen === "start";
    if (el.navigationIcon) {
      el.navigationIcon.src = asset(onHelp ? "assets/btn_back.png" : "assets/btn_close.png");
    }
    if (el.navigationButton) {
      el.navigationButton.setAttribute(
        "aria-label",
        closesGame ? "게임 닫기" : onHelp ? "뒤로 가기" : "시작 화면으로 돌아가기",
      );
    }
    app.screen = screen;
  }

  // ---- 사운드 ----
  /* 효과음 — 형제와 같은 방식. 같은 소리가 겹칠 수 있으므로 재생할 때마다 복제한다.
     이 게임의 리소스는 효과음 7개 + 배경음 1개이고 전부 쓴다. */
  const sfx = (function createSfx() {
    const EFFECTS = {
      touch: "assets/sound/touch.mp3",     // 버튼 누름 · 정답 철자 터치
      open: "assets/sound/open.mp3",       // 게임 시작
      show: "assets/sound/show.mp3",       // 칠판에 단어 등장(완성·실패 공용)
      success: "assets/sound/success.mp3", // 단어 완성
      wrong: "assets/sound/fail.mp3",      // 오답: 띵~ 효과음
      bonus: "assets/sound/stamp.mp3",     // 연속 보너스
      cheer: "assets/sound/success.mp3",   // 결과 - 잘함
      stamp: "assets/sound/stamp.mp3",     // 결과 - 보통
      fail: "assets/sound/fail.mp3",       // 결과 - 아쉬움
    };
    // 배경음: the_morning_hop (사용자 지정 2026-09-08). 이전 morning_blocks 는 자산에서 빠졌다.
    const BGM_SRC = "assets/sound/bgm/the_morning_hop.mp3";
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
      /* 결과화면에서는 배경음을 멈춘다(공통 9항 2026-09-29). 사용자의 소리 설정
         app.muted 는 건드리지 않는다 — 시작 화면이나 다음 판에서는 원래 설정대로 다시 난다.
         효과음은 대상이 아니다. bgmWanted 를 내려 두어야 소리를 다시 켜도 되살아나지 않는다. */
      stopBgm() {
        bgmWanted = false;
        if (bgmAudio) { try { bgmAudio.pause(); } catch { /* noop */ } }
      },
      applyMuted() {
        if (app.muted) { if (bgmAudio) { try { bgmAudio.pause(); } catch { /* noop */ } } }
        else if (bgmWanted) this.startBgm();
      },
    };
  })();

  /* 단어 발음. 소리를 끄면 나지 않는다 — 단, 오답노트 발음 버튼은 사용자가 그 단어를 들으려고
     직접 누른 것이라 소리를 꺼도 낸다(2차 수정 PDF 3쪽, 공통 1절 "소리 끈 상태").
     정답 노출 때 자동으로 나는 발음(revealWord)은 그대로 소리 설정을 따른다. */
  function playSound(url, { evenMuted = false } = {}) {
    if (!url || (app.muted && !evenMuted)) return;
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

  // 재생 중인 단어 발음을 멈춘다(화면을 떠날 때 소리가 새지 않게).
  function stopSound() {
    if (!app.audio) return;
    try { app.audio.pause(); } catch { /* noop */ }
    app.audio = null;
  }

  function setMuted(muted) {
    app.muted = muted;
    if (el.soundButton) {
      el.soundButton.setAttribute("aria-pressed", String(!muted));
      el.soundButton.setAttribute("aria-label", muted ? "소리 켜기" : "소리 끄기");
    }
    if (el.soundIcon) {
      el.soundIcon.src = asset(muted ? "assets/btn_sound_off.png" : "assets/btn_sound_on.png");
    }
    if (muted && app.audio) { try { app.audio.pause(); } catch { /* noop */ } }
    sfx.applyMuted();
  }

  // ============================================================
  // 글자 중심 맞추기 (형제 write 규칙)
  // ============================================================
  /* textBaseline "middle"은 폰트 em 상자 기준이라 내림이 없는 글자는 위로 뜨고
     어센더 글자는 아래로 처져 보인다. 글자마다 실제 잉크 경계상자를 캔버스로
     실측해 그 중심을 상자 정중앙에 맞춘다. 오프셋은 em 단위로 캐시하므로
     화면 크기와 무관하게 맞는다. */
  const inkOffsetCache = new Map();

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
      inkOffsetCache.set(key, offset);
    } catch { /* 측정 실패 시 기본 정렬(오프셋 0)로 둔다 */ }
    return offset;
  }

  const GLYPH_MEASURE = { canvas: 160, font: 112 };

  function centerGlyph(node, glyph) {
    const o = measureInkOffset(
      glyph,
      `700 ${GLYPH_MEASURE.font}px "SofiaProSoft", "Lexend", sans-serif`,
      GLYPH_MEASURE.canvas,
      GLYPH_MEASURE.canvas,
      GLYPH_MEASURE.font,
    );
    node.style.transform = `translate(${o.x.toFixed(4)}em, ${o.y.toFixed(4)}em)`;
  }

  /* 뜻 글자를 칠판 안에 들어가게 맞춘다. 기본 크기로 되돌려 재고, 넘치면 두 줄로
     접은 뒤에도 넘치면 비율로 줄인다. 폰트 힌팅 때문에 남는 오차를 몇 번 더 조인다.
     영어 단어(wrap: false)는 접지 않고 줄이기만 한다 — 단어가 두 줄로 끊기면 안 된다. */
  /* 글상자는 max-width 로 텍스트 영역에 묶여 있어 getBoundingClientRect 만 보면 넘친
     글자를 못 잡는다(상자는 영역 폭에서 멈추고 글자만 밖으로 삐져나온다).
     실제 글자 폭은 scrollWidth 에 있으므로 둘 중 큰 값을 쓴다. */
  function contentWidth(node) {
    return Math.max(node.getBoundingClientRect().width, node.scrollWidth || 0);
  }

  function fitMeaningText(node, options = {}) {
    if (!node || !node.parentElement) return;
    const holder = node.parentElement;
    const base = Number.isFinite(options.base) ? options.base : MEANING_FONT.base;
    const min = Number.isFinite(options.min) ? options.min : MEANING_FONT.min;
    node.style.fontSize = `${base}cqw`;
    node.style.whiteSpace = "nowrap";
    if (options.wrap === false) {
      const style = global.getComputedStyle(holder);
      const available = holder.clientWidth
        - (Number.parseFloat(style.paddingLeft) || 0)
        - (Number.parseFloat(style.paddingRight) || 0);
      const measured = contentWidth(node);
      const size = fitFontSize(measured, available, base, min);
      if (size < base) node.style.fontSize = `${size.toFixed(4)}cqw`;
      return;
    }
    const style = global.getComputedStyle(holder);
    const available = holder.clientWidth
      - (Number.parseFloat(style.paddingLeft) || 0)
      - (Number.parseFloat(style.paddingRight) || 0);
    const availableHeight = holder.clientHeight
      - (Number.parseFloat(style.paddingTop) || 0)
      - (Number.parseFloat(style.paddingBottom) || 0);
    if (!(available > 0)) return;

    let measured = contentWidth(node);
    if (measured <= available) return;
    /* 한 줄에 안 들어가면 먼저 두 줄로 접는다 — 텍스트 영역은 두 줄이 들어갈 만큼 높다.
       줄은 띄어쓰기에서만 꺾인다(CSS word-break: keep-all). 그래서 한 줄에 못 들어가는
       어절은 상자 밖으로 삐져나오고, 그것을 scrollWidth 로 잡아 글자를 줄인다. */
    node.style.whiteSpace = "normal";
    let size = base;
    let guard = 0;
    while (guard < 40) {
      const rect = node.getBoundingClientRect();
      const fits = rect.width <= available + 0.5
        && rect.height <= availableHeight + 0.5
        && node.scrollWidth <= node.clientWidth + 1;
      if (fits) break;
      if (size <= min) break;
      size = Math.max(min, size - 0.15);
      node.style.fontSize = `${size.toFixed(4)}cqw`;
      guard += 1;
    }
    measured = contentWidth(node);
    if (measured > available && size > min) {
      size = fitFontSize(measured, available, size, min);
      node.style.fontSize = `${size.toFixed(4)}cqw`;
    }
  }

  // ============================================================
  // 정답 칸 · 철자 타일 렌더링
  // ============================================================
  const cqw = (px) => `${(px / STAGE_WIDTH) * 100}cqw`;

  let slotNodes = [];  // slot index -> {holder, art, glyph}
  let tileNodes = [];  // tile index -> {button, art, glyph}

  function makeSlot(index, count, letter) {
    const holder = doc.createElement("div");
    holder.className = "answer-slot";
    holder.style.left = cqw(slotLeft(index, count));
    holder.dataset.slot = String(index);

    const art = doc.createElement("img");
    art.className = "answer-slot-art";
    art.src = asset("assets/game/answer_box2.png");
    art.alt = "";
    art.draggable = false;

    const glyph = doc.createElement("span");
    glyph.className = "answer-slot-glyph";
    if (letter) {
      glyph.textContent = letter;
      centerGlyph(glyph, letter);
      holder.classList.add("is-filled", "is-prefilled");
    }

    holder.append(art, glyph);
    return { holder, art, glyph };
  }

  function makeTile(tile, index, count, used) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "letter-tile";
    button.style.left = cqw(tileLeft(index, count));
    button.dataset.tile = String(index);
    button.setAttribute("aria-label", `철자 ${tile.letter}`);

    const art = doc.createElement("img");
    art.className = "letter-tile-art";
    art.src = asset("assets/game/answer_off.png");
    art.alt = "";
    art.draggable = false;

    const glyph = doc.createElement("span");
    glyph.className = "letter-tile-glyph";
    glyph.textContent = tile.letter;
    centerGlyph(glyph, tile.letter);

    button.append(art, glyph);
    if (used) {
      button.classList.add("is-used");
      button.disabled = true;
      button.setAttribute("aria-label", `철자 ${tile.letter} (이미 사용)`);
    }
    return { button, art, glyph };
  }

  function renderBoard(round) {
    if (!el.answerSlots || !el.letterTiles) return;
    el.answerSlots.innerHTML = "";
    el.letterTiles.innerHTML = "";
    const letters = round.letters;
    const filled = round.filledLetters();
    const consumed = round.consumedTiles();
    const count = letters.length;
    slotNodes = letters.map((_, index) => {
      const node = makeSlot(index, count, filled[index]);
      el.answerSlots.appendChild(node.holder);
      return node;
    });
    tileNodes = round.tiles.map((tile, index) => {
      const node = makeTile(tile, index, count, consumed[index]);
      el.letterTiles.appendChild(node.button);
      return node;
    });
    paintTarget();
  }

  // 지금 채워야 하는 칸을 점선(answer_box1)으로 표시한다 — 기획서 "하이라이트".
  function paintTarget() {
    if (!app.round) return;
    const cursor = app.round.cursor;
    slotNodes.forEach((node, index) => {
      const isTarget = !app.round.completed && !app.round.failed && index === cursor;
      node.holder.classList.toggle("is-target", isTarget);
      node.art.src = asset(isTarget ? "assets/game/answer_box1.png" : "assets/game/answer_box2.png");
    });
  }

  function fillSlot(index, letter, options = {}) {
    const node = slotNodes[index];
    if (!node) return;
    node.glyph.textContent = letter;
    centerGlyph(node.glyph, letter);
    node.holder.classList.add("is-filled");
    node.holder.classList.toggle("is-revealed", Boolean(options.revealed));
    restartAnimation(node.holder, "is-landing");
  }

  function useTile(index, options = {}) {
    const node = tileNodes[index];
    if (!node) return;
    node.button.disabled = true;
    node.button.classList.add("is-used");
    node.button.classList.toggle("is-revealed", Boolean(options.revealed));
    node.button.classList.remove("is-pressed");
  }

  /* 세대를 하나 넘긴다. 이 시점 이전에 예약된 콜백은 전부 무효가 된다.
     그 콜백들이 하던 화면 정리(날아가는 글자 치우기)도 함께 못 하게 되므로
     여기서 직접 치운다 — 그러지 않으면 이전 문제의 글자가 새 문제 위에 남는다. */
  function nextGeneration() {
    app.generation += 1;
    if (el.playScreen) {
      el.playScreen.querySelectorAll(".fly-glyph").forEach((node) => node.remove());
    }
    /* 세대가 바뀌면 그 세대의 지연 콜백이 하던 화면 정리도 못 하게 되므로
       정답 오버레이는 여기서 직접 걷는다 — 그러지 않으면 이전 판의 단어가
       새 판 위에 덮인 채로 남는다. */
    if (el.answerReveal) el.answerReveal.hidden = true;
    // 노출과 함께 보너스 연출도 걷는다 — 판 끝(endGame) · 새 판 · 시작 화면 모두 여기를 지난다.
    clearScoreBonus();
    return app.generation;
  }

  /* 이번 세대에만 실행되는 지연 콜백. 문제가 넘어가거나 판이 바뀌면 버려진다. */
  function laterInRound(fn, ms) {
    const generation = app.generation;
    return global.setTimeout(() => {
      if (app.generation !== generation) return;
      fn();
    }, ms);
  }

  // ---- 연출 도우미 ----
  /* 같은 애니메이션을 다시 틀려면 클래스를 뗐다 붙여야 하는데, 그 사이에 브라우저가
     레이아웃을 다시 계산해야 애니메이션이 되감긴다.
     이때 requestAnimationFrame 으로 미루면 프레임이 돌지 않는 환경(백그라운드 탭 등)
     에서는 콜백이 아예 실행되지 않아 연출이 조용히 사라진다.
     offsetWidth 를 읽어 리플로를 그 자리에서 강제하면 항상 즉시 다시 시작된다. */
  function restartAnimation(node, className) {
    if (!node) return;
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }

  const flashTimers = new Map();

  // 화면 전체에 잠깐 빛을 입힌다(정답 초록 · 오답 빨강).
  function flashField(className, ms) {
    if (!el.playScreen) return;
    global.clearTimeout(flashTimers.get(className));
    restartAnimation(el.playScreen, className);
    flashTimers.set(className, global.setTimeout(() => {
      el.playScreen.classList.remove(className);
      flashTimers.delete(className);
    }, ms));
  }

  let shakeTimer = 0;
  function shakeBoard() {
    if (!el.letterTiles) return;
    global.clearTimeout(shakeTimer);
    restartAnimation(el.letterTiles, "is-jolted");
    shakeTimer = global.setTimeout(() => {
      el.letterTiles.classList.remove("is-jolted");
      shakeTimer = 0;
    }, 420);
  }

  /* 누른 타일의 글자가 정답 칸으로 날아간다. 도착하면 칸을 채운다.
     날아가는 글자는 세대에 묶여 있어 문제가 바뀌면 nextGeneration 이 치운다. */
  function flyLetter(tileIndex, slotIndex, letter, done) {
    if (!el.playScreen) { done(); return; }
    const count = app.round ? app.round.letters.length : 1;
    const fromX = tileLeft(tileIndex, count) + BOARD.tileSize / 2;
    const fromY = BOARD.tileTop + BOARD.tileSize / 2;
    const toX = slotLeft(slotIndex, count) + BOARD.slotSize / 2;
    const toY = BOARD.slotTop + BOARD.slotSize / 2;
    const node = doc.createElement("span");
    node.className = "fly-glyph";
    node.textContent = letter;
    node.setAttribute("aria-hidden", "true");
    node.style.left = cqw(fromX);
    node.style.top = cqw(fromY);
    el.playScreen.appendChild(node);
    // 시작 위치를 확실히 반영시킨 뒤 목표값을 줘야 transition 이 걸린다.
    void node.offsetWidth;
    node.classList.add("is-flying");
    node.style.left = cqw(toX);
    node.style.top = cqw(toY);
    laterInRound(() => {
      node.remove();
      done();
    }, FLY_MS);
  }

  // ---- 터치 판정 ----
  function onTileClick(event) {
    const button = event.target.closest(".letter-tile");
    if (!button || button.disabled) return;
    const index = Number(button.dataset.tile);
    if (!Number.isInteger(index)) return;
    judgeTap(index);
  }

  function judgeTap(index) {
    if (app.locked || !app.round) return;
    const result = app.round.tap(index);
    if (result.type === "ignored") return;

    const node = tileNodes[index];
    if (result.type === "correct" || result.type === "complete") {
      if (node) restartAnimation(node.button, "is-pressed");
      useTile(index);
      sfx.effect("touch", 0.75);
      paintTarget();
      announce(`${result.letter} 정답. ${app.round.completed ? "단어 완성!" : `다음 철자 ${app.round.expectedLetter()}.`}`);
      if (result.type === "complete") app.locked = true;
      flyLetter(index, result.slot, result.letter, () => {
        fillSlot(result.slot, result.letter);
        if (result.type === "complete") laterInRound(completeWord, 120);
      });
      return;
    }

    // 오답: 타일이 흔들리고 화면이 붉게 번쩍이며 점수가 깎인다.
    const SHAKE_MS = 380; // tileShake 키프레임 길이와 같게 유지한다
    if (node) {
      restartAnimation(node.button, "is-shaking");
      global.setTimeout(() => node.button.classList.remove("is-shaking"), SHAKE_MS);
    }
    const beforeMiss = app.scoreboard.score;
    flashField("is-wrong-flash", 460);
    shakeBoard();
    app.scoreboard.miss();
    animateScore(app.scoreboard.score);
    bumpScoreCard();
    // 0점이 하한이라 실제로 깎인 만큼만 띄운다.
    floatScoreDelta(app.scoreboard.score - beforeMiss);
    sfx.effect("wrong", 0.85);
    announce(`틀렸어요. 남은 기회 ${result.chancesLeft}번.`);

    if (result.failed) {
      app.locked = true;
      laterInRound(failWord, 320);
    }
  }

  // ============================================================
  // 게임 진행
  // ============================================================
  let advanceTimer = 0;
  let timerInterval = 0;

  function currentQuestion() {
    return app.questions[app.flow.index] || null;
  }

  // ---- 점수 표시 ----
  let scoreShown = 0;
  let scoreTween = 0;
  /* 트윈 세대. 새 트윈이 시작되거나 점수가 초기화되면 올라간다 —
     이전 트윈의 보정 타이머가 깨어나 옛 점수를 다시 찍는 것을 막는다. */
  let scoreToken = 0;

  function renderScore(value) {
    // 굴림 연출도 이 함수를 거치므로 중간값 내내 1,000 형식이다(공통 10항).
    if (el.scoreValue) el.scoreValue.textContent = formatScore(value);
  }

  // 애니메이션 없이 즉시 맞춘다(판 시작·복구용).
  function updateScore() {
    if (scoreTween) { global.cancelAnimationFrame(scoreTween); scoreTween = 0; }
    scoreToken += 1;
    scoreShown = app.scoreboard ? app.scoreboard.score : 0;
    renderScore(scoreShown);
  }

  // 점수가 오르내리는 것을 눈으로 좇을 수 있게 숫자를 굴린다.
  function animateScore(target) {
    const from = scoreShown;
    if (from === target) return;
    if (scoreTween) global.cancelAnimationFrame(scoreTween);
    const startedAt = Date.now();
    const span = Math.min(720, 280 + Math.abs(target - from) * 2);
    const token = (scoreToken += 1);
    /* 프레임이 돌지 않는 환경(백그라운드 탭 등)에서는 rAF 콜백이 오지 않아
       숫자가 옛 값에 멈춘다. 시간이 지나면 최종 점수를 반드시 찍어 둔다.
       단, 그 사이 새 판이 시작돼 점수가 0으로 되돌아갔다면 버린다 —
       그러지 않으면 새 판 점수판에 이전 판 점수가 찍힌다. */
    global.setTimeout(() => {
      if (token !== scoreToken) return;
      if (scoreShown !== target) { scoreShown = target; renderScore(target); }
    }, span + 120);
    const step = () => {
      const ratio = Math.min(1, (Date.now() - startedAt) / span);
      const eased = 1 - Math.pow(1 - ratio, 3);
      scoreShown = from + (target - from) * eased;
      renderScore(scoreShown);
      if (ratio < 1) {
        scoreTween = global.requestAnimationFrame(step);
      } else {
        scoreShown = target;
        renderScore(target);
        scoreTween = 0;
      }
    };
    scoreTween = global.requestAnimationFrame(step);
  }

  // 얻거나 잃은 점수를 점수 원판 위로 띄워 보낸다. 보너스는 "보너스 +100" 으로 원판 바로 위에 뜬다.
  function floatScoreDelta(delta, options = {}) {
    if (!delta || !el.scoreRing) return;
    const node = doc.createElement("span");
    node.className = `score-delta ${delta > 0 ? "is-plus" : "is-minus"}`;
    if (options.bonus) {
      node.classList.add("is-bonus");
      // Star 의 #score-delta 처럼 화면 읽기에서는 빼 둔다 — 점수는 점수 칸(output)이 알린다.
      node.setAttribute("aria-hidden", "true");
    }
    const signed = `${delta > 0 ? "+" : ""}${formatScore(delta)}`;
    node.textContent = options.bonus ? `보너스 ${signed}` : signed;
    el.scoreRing.appendChild(node);
    global.setTimeout(() => node.remove(), 1100);
  }

  /* 보너스 순간 점수 원판 연출 — 단어미로(Star, spellingbuilde_start) 방 playScoreBonus 와 같은 구성이다
     (사장님 2026-10-02 "보너스 효과 단어미로(Star) 프로젝트 확인해서 효과 동일하게 적용"): 원판 둘레에서
     금빛 링이 퍼지고(comboRing), 점수 숫자가 금색으로 한 번 튀고(comboScorePunch), 원판 바로 위로
     "보너스 +100" 이 떠올랐다 사라진다. 숫자 굴림은 animateScore 가 맡는다.
     보너스가 나는 순간 정답 노출(.answer-reveal, z-index 50)이 무대 전체를 어둡게 덮는 것도 Star 와 같아서,
     Star 처럼 연출 동안 점수 원판을 노출 위로 올리고(is-bonus-lift) 노출이 닫힐 때 내린다 — 그대로 두면
     링 · 펀치 · 글자가 전부 어둡게 묻힌다(2026-10-02 실제 판에서 찍어 봄).
     링 · 글자는 1.1초 뒤 걷고(endScoreBonusEffect), 노출이 닫힐 때 · 세대가 바뀔 때(판 끝 · 새 판 · 시작 화면)
     링 · 글자 · 올림을 함께 걷는다(clearScoreBonus) — Star 의 hideReveal · finishGame 과 같다. 효과 도중
     X → Start 나 시간 끝이면 새 판 · 숨은 판에 남지 않게. */
  const BONUS_EFFECT_MS = 1100;
  let scoreBonusTimer = 0;

  function playScoreBonus(amount) {
    const bonus = Math.trunc(Number(amount) || 0);
    if (bonus <= 0 || !el.scoreRing) return;
    clearScoreBonus();
    /* 앞 정답이 남긴 숫자 튐 클래스를 걷는다 — 남겨 두면 1.1초 뒤 링 클래스를 걷는 순간 숫자의 animation 이
       펀치에서 튐으로 바뀌며 한 번 더 튄다(2026-10-02 실제 판에서 잼). */
    if (el.scoreValue) el.scoreValue.classList.remove("is-bumping");
    // 레이아웃을 한 번 읽어야 같은 클래스를 다시 붙일 때 애니메이션이 처음부터 돈다.
    void el.scoreRing.offsetWidth;
    el.scoreRing.classList.add("is-combo", "is-bonus-lift");
    floatScoreDelta(bonus, { bonus: true });
    scoreBonusTimer = global.setTimeout(endScoreBonusEffect, BONUS_EFFECT_MS);
  }

  // 1.1초 뒤 링과 글자를 걷는다. 원판은 정답 노출이 닫힐 때까지 위에 둔다 — 중간에 내리면 남은 동안 원판이 다시 어두워진다.
  function endScoreBonusEffect() {
    if (scoreBonusTimer) { global.clearTimeout(scoreBonusTimer); scoreBonusTimer = 0; }
    if (!el.scoreRing) return;
    el.scoreRing.classList.remove("is-combo");
    el.scoreRing.querySelectorAll(".score-delta.is-bonus").forEach((node) => node.remove());
  }

  function clearScoreBonus() {
    endScoreBonusEffect();
    if (el.scoreRing) el.scoreRing.classList.remove("is-bonus-lift");
  }

  function bumpScoreCard() {
    if (!el.scoreValue) return;
    restartAnimation(el.scoreValue, "is-bumping");
  }

  function updateProgress() {
    if (el.questionProgress && app.flow) {
      el.questionProgress.textContent = `${app.flow.currentNumber()}/${app.flow.total}`;
    }
  }

  // ---- 연속 정답 표시(점수 원판 고리) ----
  // 3문제 연속 정답까지의 진행을 고리가 3분의 1씩 차는 것으로 보여 준다.
  let streakResetTimer = 0;
  const STREAK_BURST_MS = 1100;

  /* 원판의 진행 호(SVG)에 0..1 을 넣는다. 둥근 끝은 길이 0 에서도 점으로 남으므로
     0 이면 감춘다 — 그러지 않으면 12시 자리에 점이 늘 찍혀 있다. */
  function paintRing(node, ratio) {
    if (!node) return;
    const safe = Math.max(0, Math.min(1, Number(ratio) || 0));
    node.style.setProperty("--progress", safe.toFixed(4));
    node.classList.toggle("is-empty", safe < 0.002);
  }

  function paintStreak(step, celebrating = false) {
    const length = Math.max(1, app.rules.streakLength);
    const ratio = celebrating ? 1 : Math.max(0, Math.min(1, step / length));
    paintRing(el.scoreRingFill, ratio);
    if (el.scoreRing) el.scoreRing.classList.toggle("is-burst", celebrating);
  }

  function updateStreak() {
    if (streakResetTimer) { global.clearTimeout(streakResetTimer); streakResetTimer = 0; }
    paintStreak(streakStep(app.scoreboard ? app.scoreboard.streak : 0, app.rules.streakLength));
  }

  /* 보너스가 터지면 고리를 꽉 채워 빛내고, 잠시 뒤 스스로 처음으로 돌아간다.
     이렇게 하지 않으면 보너스 표시가 다음 정답 때까지 그대로 남는다. */
  function celebrateStreak() {
    if (streakResetTimer) global.clearTimeout(streakResetTimer);
    paintStreak(0, true);
    streakResetTimer = global.setTimeout(() => {
      streakResetTimer = 0;
      // 축하가 끝나면 지금 진행도(보너스 직후면 0)로 되돌린다.
      paintStreak(streakStep(app.scoreboard ? app.scoreboard.streak : 0, app.rules.streakLength));
    }, STREAK_BURST_MS);
  }

  function updateTimerDisplay() {
    const now = Date.now();
    const remaining = app.countdown ? app.countdown.remainingSeconds(now) : app.rules.timerSeconds;
    if (el.timerValue) el.timerValue.textContent = formatClock(remaining);
    paintTimerUrgency(remaining);
    paintRing(el.timerRingFill, app.countdown ? app.countdown.remainingRatio(now) : 1);
  }

  /* 남은 10초부터 시간 숫자와 타이머 고리가 빨강으로 깜박이고, 5초부터 더 빠르다(2차 수정
     공통 2절, OX 가 처음 정한 형태 그대로 timer-urgent 10~6초 · timer-critical 5~1초).
     예전의 "10초부터 노랑으로 커졌다 작아짐(is-low)"은 걷었다. 화면 가장자리 빛은 넣지 않는다. */
  function paintTimerUrgency(remaining) {
    const holder = el.timerValue ? el.timerValue.closest(".hud-timer") : null;
    if (!holder) return;
    const stage = timerUrgency(remaining);
    holder.classList.toggle("timer-urgent", stage === "urgent");
    holder.classList.toggle("timer-critical", stage === "critical");
  }

  function stopTimer() {
    if (timerInterval) { global.clearInterval(timerInterval); timerInterval = 0; }
    paintTimerUrgency(Infinity);  // 판이 끝나거나 나가면 빨간 상태도 함께 내린다
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
        endGame();
      }
    }, 250);
  }

  /* 정오답 후 정답 단어 노출 — 검수 r60(2026-09-09), 6단계 파이프와 같은 형태.
     칠판은 한글 뜻을 그대로 둔 채, 화면을 덮는 오버레이 가운데에 단어만 크게 띄운다.
     (예전에는 칠판 글자를 영어 단어로 바꿔 끼웠는데 그것이 지적됐다.)
     발음은 여기서만 재생한다 — 문제 제시 때는 내지 않는다(r13). */
  function revealWord(question, isFail) {
    const word = displayWord(question.letters);
    if (el.wordReveal) {
      el.wordReveal.textContent = word;
      el.wordReveal.classList.toggle("is-long", word.length > 9);
    }
    if (el.answerReveal) {
      el.answerReveal.classList.toggle("is-fail", isFail);
      el.answerReveal.hidden = false;
    }
    laterInRound(() => playSound(question.soundUrl), REVEAL_SOUND_MS);
  }

  function hideAnswerReveal() {
    if (el.answerReveal) el.answerReveal.hidden = true;
    // 보너스 연출 동안 노출 위로 올렸던 점수 원판을 노출과 함께 내린다(Star 의 hideReveal 과 같음).
    clearScoreBonus();
  }

  /* 칠판은 문제가 나올 때부터 다음 문제로 넘어갈 때까지 한글 뜻을 그대로 유지한다(r60). */
  function showBoardMeaning(question) {
    if (!el.wordMeaning) return;
    el.wordMeaning.textContent = question.meaning;
    fitMeaningText(el.wordMeaning);
  }

  // 단어 완성: 칸이 모두 찼고, 칠판에 단어를 띄우고 발음을 들려준 뒤
  // 스스로 다음 문제로 넘어간다.
  // (setTimeout으로 예약되므로, 그 사이 타이머가 끝나 결과로 넘어갔으면 버린다)
  function completeWord() {
    if (app.screen !== "game") return;
    const question = currentQuestion();
    if (!question) return;
    app.flow.completeWord(true);
    const beforeScore = app.scoreboard.score;
    const { bonusAwarded } = app.scoreboard.wordComplete();
    animateScore(app.scoreboard.score);
    if (bonusAwarded > 0) {
      /* 보너스 단어는 단어미로(Star) 방처럼 보너스 연출만 보인다 — 그 단어의 "+50" 글자와 숫자 튐은
         띄우지 않는다(숫자 금색 펀치와 튐은 같은 transform 이라 함께 돌 수 없고, 예전에는 "+50" 과
         300ms 뒤 "+100" 이 같은 자리에서 겹쳤다). 점수는 50 + 100 이 한 번에 굴러 올라간다. */
      playScoreBonus(bonusAwarded);
      // 연속 고리는 꽉 차며 빛나는 것으로 진행을 마저 보여 준다(형제 block과 같은 방식).
      celebrateStreak();
      sfx.effect("bonus", 0.8);
    } else {
      bumpScoreCard();
      floatScoreDelta(app.scoreboard.score - beforeScore);
      updateStreak();
    }
    // 왼쪽 칸부터 차례로 튀어 오른다.
    slotNodes.forEach((node, index) => {
      node.holder.style.setProperty("--pop", String(index));
      node.holder.classList.add("is-correct");
    });
    paintTarget();
    flashField("is-correct-flash", 620);
    sfx.effect("success", 0.85);
    revealWord(question, false);
    sfx.effect("show", 0.6);
    announce(`${displayWord(question.letters)} 완성!`);
    advance(REVEAL_HOLD_MS);
  }

  // 기회 소진: 정답을 노출하고 단어 사운드를 들려준 뒤 다음 문제로 강제 전환.
  function failWord() {
    if (app.screen !== "game") return;
    const question = currentQuestion();
    if (!question) return;
    app.flow.completeWord(false);
    app.scoreboard.wordFail();
    updateStreak();
    /* 오답노트 목록은 여기서 쌓지 않는다 — endGame 에서 출제 목록과 정오 결과로
       한 번에 만든다(q58). 그래야 손도 못 댄 문제까지 들어간다. */
    // 기획서: 3회 오답이면 2-2에 정답과 단어 사운드를 제공한 뒤 다음 문제로 넘어간다.
    const revealed = app.round.reveal();
    revealed.slots.forEach((slot, order) => {
      const node = slotNodes[slot];
      if (node) node.holder.style.setProperty("--pop", String(order));
      fillSlot(slot, question.letters[slot], { revealed: true });
    });
    revealed.tiles.forEach((tile) => useTile(tile, { revealed: true }));
    paintTarget();
    revealWord(question, true);
    sfx.effect("show", 0.8);
    announce(`정답은 ${displayWord(question.letters)}입니다.`);
    advance(FAIL_HOLD_MS);
  }

  function advance(delayMs) {
    global.clearTimeout(advanceTimer);
    advanceTimer = laterInRound(() => {
      advanceTimer = 0;
      if (app.screen !== "game") return;
      hideAnswerReveal();
      app.flow.advance();
      if (app.flow.isFinished()) { endGame(); return; }
      loadQuestion();
    }, delayMs);
  }

  function loadQuestion() {
    const question = currentQuestion();
    if (!question) { endGame(); return; }
    // 새 문제 — 이전 문제에 걸려 있던 지연 콜백을 전부 무효로 만든다.
    nextGeneration();
    stopSound();
    app.round = createQuestionRound(question.letters, app.rules);
    renderBoard(app.round);
    showBoardMeaning(question);
    /* 이 문제는 화면에 나왔다 — 오답노트와 Incorrect 는 나온 문제만 센다(2차 수정 2026-10-02).
       다음 판 첫 문제와 견줄 '마지막으로 나온 단어'도 여기서 적는다. */
    app.flow.present();
    app.lastWord = displayWord(question.letters);
    updateProgress();
    updateStreak();
    app.locked = false;
    announce(`문제 ${app.flow.currentNumber()}. 뜻: ${question.meaning}. 철자를 순서대로 터치하세요.`);
    /* 검수 r13(2026-08-28): 문제가 제시될 때는 단어 사운드를 내지 않는다 —
       발음을 듣고 철자를 맞히면 파닉스 학습이 되어 이 게임의 목적을 벗어난다.
       발음은 정답을 맞혔거나 정답이 노출된 뒤(revealWord)에만 재생한다. */
  }

  /* 한글 글꼴(나눔스퀘어라운드 ExtraBold)을 받는 약속. 칠판 뜻을 칸에 맞추는 일(fitMeaningText)은 글자 폭을
     재므로 이 글꼴이 실린 뒤에 해야 한다 — doc.fonts.ready 는 "지금 받는 중인 글꼴"만 기다려서, 아직 아무도
     요청하지 않은 글꼴이면 곧바로 끝나 대체 글꼴로 잰 값이 남는다(2026-10-02). 실패해도 판은 연다. */
  const KOREAN_FONT = '700 1em "NanumSquareRound Game"';
  /* 글꼴을 기다리는 상한 — font-display: block 의 감춤 기간(약 3초)과 같다. 그 뒤로는 어차피 대체 글꼴이
     보이므로 더 기다리지 않고 판을 연다. 상한이 없으면 느린 망 · 멈춘 요청에서 첫 문제가 안 나온 채
     빈 판에 시계만 흘렀다(2026-10-02 반박 검사로 재현). */
  const KOREAN_FONT_WAIT_MS = 3000;
  let koreanFontReady = Promise.resolve();
  function loadKoreanFont() {
    if (!doc.fonts || typeof doc.fonts.load !== "function") return koreanFontReady;
    try {
      koreanFontReady = doc.fonts.load(KOREAN_FONT, "가").catch(() => []);
    } catch { koreanFontReady = Promise.resolve(); }
    // 상한을 넘겨 늦게 도착하면 지금 칠판 뜻을 새 글꼴로 다시 맞춘다(대체 글꼴로 잰 값이 남지 않게).
    koreanFontReady.then(() => { if (app.screen === "game") fitMeaningText(el.wordMeaning); });
    return koreanFontReady;
  }

  function koreanFontOrTimeout() {
    return Promise.race([koreanFontReady, new Promise((resolve) => global.setTimeout(resolve, KOREAN_FONT_WAIT_MS))]);
  }

  function startGame() {
    nextGeneration();
    stopSound();
    // 앞 판에서 떠오르던 점수 글자(+50 · 보너스 +100)와 보너스 링이 새 판 점수 원판 위에 남지 않게 걷는다.
    if (el.scoreRing) el.scoreRing.querySelectorAll(".score-delta").forEach((node) => node.remove());
    clearScoreBonus();
    sfx.effect("open", 0.7);
    // 사양: 매 판마다 문제를 다시 뽑는다(두 번째 판이 첫 판과 같지 않도록).
    if (Content && typeof Content.rebuildQuestions === "function") {
      try {
        const fresh = Content.rebuildQuestions();
        if (Array.isArray(fresh) && fresh.length > 0) {
          app.questions = fresh.slice(0, app.rules.questionCount);
        }
      } catch { /* 재추첨 실패는 진행을 막지 않는다 */ }
    }
    /* 직전 판 마지막 단어로 시작하지 않는다(2차 수정 공통 1절). 재추첨이 실패해 같은 목록을
       다시 쓰는 경우에도 걸리도록 재추첨 바깥에 둔다. */
    app.questions = avoidLeadingWord(app.questions, app.lastWord);
    app.flow = createGameFlow(app.questions.length || app.rules.questionCount);
    app.scoreboard = createScoreboard(app.rules);
    app.wrongWords = [];
    updateScore();
    updateStreak();
    showScreen("playScreen");
    syncGlobalControls("game");
    sfx.startBgm();  // 결과화면에서 멈춘 배경음을 원래 설정대로 되살린다(공통 9항)
    // 시계는 첫 문제를 그릴 때 돈다 — 글꼴을 기다리는 동안에는 한 판 시간 그대로 보여 준다.
    stopTimer();
    app.countdown = null;
    updateTimerDisplay();
    /* 폰트를 기다리는 동안 사장님이 X 를 누르면 판은 끝난 것이다 — 세대를 확인하지
       않으면 시작 화면 위에서 판이 되살아난다(공통 11항 2026-09-29). */
    const generation = app.generation;
    const ready = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    // 한글 글꼴까지 받은 뒤에(상한 3초) 첫 문제를 그리고 시계를 돌린다 — 뜻을 대체 글꼴로 재지 않게.
    Promise.all([ready, koreanFontOrTimeout()]).then(() => {
      if (app.generation !== generation) return;
      startTimer();
      loadQuestion();
    });
  }

  // ============================================================
  // 결과
  // ============================================================
  function endGame() {
    // 타이머 만료 틱과 마지막 문제 전환이 겹쳐도 결과 처리(기록 저장)는 한 번만 한다.
    if (el.endScreen && el.endScreen.classList.contains("is-visible")) return;
    nextGeneration();
    stopSound();
    stopTimer();
    app.locked = true;
    sfx.stopBgm();   // 결과화면에서는 소리 설정과 무관하게 배경음이 없다(공통 9항)
    const tally = app.flow ? app.flow.tally() : { correct: 0, incorrect: 0, total: app.rules.questionCount, shown: 0 };
    /* 오답노트는 여기서 만든다 — 화면에 나온 문제 중 못 맞힌 것이다. 나온 뒤 손도 못 대고
       시간이 끝난 문제는 들어가고, 한 번도 나오지 않은 문제는 빠진다(2차 수정 2026-10-02). */
    app.wrongWords = collectWrongWords(app.questions, tally.results, tally.shown);
    const tier = resultTier(correctRatio(tally.correct, tally.total));
    sfx.effect(tier === "excellent" ? "cheer" : tier === "good" ? "stamp" : "fail", 0.9);
    showResult(tally);
  }

  /* 여우 그림은 다 받은 뒤에 보여 준다(2026-09-30). src 를 바꾼 바로 다음 줄에서 결과화면을
     켜면 새 그림이 디코드될 때까지 지난 판 여우가 그대로 그려진다 — 이 방에서 재현했다
     (화면이 켜지는 순간 complete false · naturalWidth 0).
     감추기가 src 보다 앞이어야 한다 — 그 사이가 벌어지면 지난 그림이 그대로 그려진다
     (대조군: 감추지 않고 src 만 바꾸면 hidden false 인 채 complete false, naturalWidth 는
      지난 그림 값 그대로였다).
     핸들러를 src 앞에 거는 것은 12개 방 공통 형태라 맞춰 둔 것이지 필요해서가 아니다 —
     "캐시된 그림은 src 를 넣는 순간 실려 onload 를 놓친다"는 말이 돌았는데 이 방에서 재 보니
     핸들러를 src 뒤에 붙여도 onload 가 떴다(2026-09-30). 해롭지 않아 형태만 남긴다.
     못 받아도 영영 감춰 두지 않는다 — onerror 에서도 다시 보여 준다. */
  function showResultChar(src) {
    const node = el.resultChar;
    if (!node) return;
    if (node.getAttribute("src") === src && node.complete && node.naturalWidth > 0) {
      node.hidden = false;
      return;
    }
    node.hidden = true;
    node.onload = () => { node.hidden = false; };
    node.onerror = () => { node.hidden = false; };
    node.src = src;
  }

  function showResult(tally) {
    const score = app.scoreboard ? app.scoreboard.score : 0;
    const bonus = app.scoreboard ? app.scoreboard.bonusTotal : 0;
    if (el.resultScoreNumber) el.resultScoreNumber.textContent = formatScore(score);
    if (el.resultTotalScore) el.resultTotalScore.setAttribute("aria-label", `내 점수 ${formatScore(score)}점`);
    if (el.resultCorrectPoints) {
      // 숫자만 쓴다 — '개'는 지웠다(2차 검수 공통-2). 낭독은 그대로 "정답 N개"다.
      el.resultCorrectPoints.textContent = `${tally.correct}`;
      el.resultCorrectPoints.setAttribute("aria-label", `정답 ${tally.correct}개`);
    }
    if (el.resultIncorrectPoints) {
      /* 오답 칸은 오답노트에 실리는 줄 수와 같은 수다 — 화면에 나온 문제 중 못 맞힌 것
         (2차 수정 2026-10-02, 사장님 "Incorrect 숫자도 같은 기준"). 시간이 끝나 한 번도
         나오지 않은 문제는 세지 않으므로, 그런 판에서는 Correct + Incorrect 가 전체 제공
         문제수(tally.total)보다 작다. 예전(공통 6항 2026-09-29)에는 안 나온 문제까지 세어
         합이 늘 전체 문제수였다. flow 의 incorrect 는 '기회를 소진한 문제 수'라는 다른
         뜻이므로 여기에 쓰지 않는다. */
      const wrong = app.wrongWords.length;
      el.resultIncorrectPoints.textContent = `${wrong}`;
      el.resultIncorrectPoints.setAttribute("aria-label", `오답 ${wrong}개`);
    }
    if (el.resultBonusPoints) {
      // '점'은 CSS(.result-points::after)가 붙인다 — 숫자와 위 · 아래 끝을 맞추려고 크기 · 자리를 따로 준다(공통-16).
      el.resultBonusPoints.textContent = formatScore(bonus);
      el.resultBonusPoints.setAttribute("aria-label", `보너스 ${formatScore(bonus)}점`);
    }
    // result_text0=Excellent, 1=Good, 2=Try again — 그림·여우·파티클이 이 판정 하나를 쓴다.
    const tier = resultTier(correctRatio(tally.correct, tally.total));
    if (el.resultTitle || el.resultChar) {
      const variant = tier === "excellent" ? "result_text0" : tier === "good" ? "result_text1" : "result_text2";
      if (el.resultTitle) {
        el.resultTitle.src = asset(`assets/result/${variant}.png`);
        el.resultTitle.alt = tier === "excellent" ? "Excellent" : tier === "good" ? "Good" : "Try again";
      }
      /* 여우도 같은 판정으로 고른다(2026-09-30) — 판정을 두 번 하면 한쪽만 바뀌는 날이 온다.
         alt 는 비워 둔다: 제목 그림이 이미 등급을 말하므로 낭독기가 두 번 말하지 않는다. */
      if (el.resultChar) {
        const face = tier === "excellent" ? "excellent" : tier === "good" ? "good" : "try_again";
        showResultChar(asset(`assets/result/${face}.png`));
      }
    }
    if (el.resultMessage) {
      el.resultMessage.textContent = `${tally.total}문제 중 ${tally.correct}개를 맞혔어요!`;
    }
    renderIncorrectAnswers();

    showScreen("endScreen");
    syncGlobalControls("result");
    if (el.tryAgainButton) el.tryAgainButton.focus();
    if (particlesFor(tier)) runParticles();
    else clearParticles();
    saveResult(score);
  }

  /* 결과판의 숫자를 지운다. showResult 가 열기 전에 늘 다시 채우지만, 끝난 판의 점수가
     화면 밖에 남아 있지 않도록 시작 화면으로 돌아갈 때 비운다(공통 9항 2026-09-29). */
  function clearResultPanel() {
    /* <output> 은 aria-label 이 곧 읽히는 이름이다 — 글자만 지우면 화면에는 "0개"가,
       읽어 주는 소리로는 지난 판의 "정답 8개"가 남는다. 둘을 같이 지운다. */
    const blank = (node, text, label) => {
      if (!node) return;
      node.textContent = text;
      node.setAttribute("aria-label", label);
    };
    const zero = formatScore(0);
    blank(el.resultScoreNumber, zero, zero);
    // 화면 글자는 숫자만이다 — '개'는 지웠고 Bonus 의 '점'은 CSS 가 붙인다(2차 검수 공통-2). 낭독 이름은 단위째.
    blank(el.resultCorrectPoints, "0", "정답 0개");
    blank(el.resultIncorrectPoints, "0", "오답 0개");
    blank(el.resultBonusPoints, zero, `보너스 ${zero}점`);
    if (el.resultTotalScore) el.resultTotalScore.setAttribute("aria-label", `내 점수 ${zero}점`);
    if (el.resultMessage) el.resultMessage.textContent = "";
    if (el.incorrectAnswerList) el.incorrectAnswerList.innerHTML = "";
    if (el.incorrectAnswersButton) {
      el.incorrectAnswersButton.hidden = true;
      el.incorrectAnswersButton.disabled = true;
      el.incorrectAnswersButton.setAttribute("aria-label", "오답 없음");
    }
  }

  // 오답 단어 목록. 없으면 버튼을 잠그고 "오답 없음"으로 알린다(형제 공통).
  function renderIncorrectAnswers() {
    const rows = app.wrongWords;
    if (el.incorrectAnswersButton) {
      /* 오답이 없으면 회색으로 남기지 않고 자리까지 없앤다(공통 9항 2026-09-29).
         .result-actions 가 가운데 정렬이라 남은 "다시 하기" 하나가 그대로 가운데에 온다. */
      el.incorrectAnswersButton.hidden = rows.length === 0;
      el.incorrectAnswersButton.disabled = rows.length === 0;
      el.incorrectAnswersButton.setAttribute(
        "aria-label",
        rows.length === 0 ? "오답 없음" : `오답 ${rows.length}개 보기`,
      );
    }
    if (!el.incorrectAnswerList) return;
    el.incorrectAnswerList.innerHTML = "";
    /* 오답 목록 글자는 따로 받는 Bold 글꼴이다(styles.css "NanumSquareRound Game List", 2026-10-15). block 이라 처음
       여는 순간 받기 시작하면 뜻이 잠깐 비므로 결과 화면에서 미리 받아 둔다. 실패해도 대체 글꼴로 이어 간다. */
    if (rows.length > 0 && doc.fonts && doc.fonts.load) {
      doc.fonts.load('500 1em "NanumSquareRound Game List"', "뜻").catch(() => {});
    }
    /* 줄 구조는 기준 방(OX)과 같다 — 칸(.incorrect-answer-cell) 셋: 발음 · 단어 · 뜻
       (2차 수정 공통 2절, 2026-10-02). 발음 주소가 없는 단어는 이 방 예전대로 스피커를 두지 않는다. */
    const cell = (kind) => {
      const node = doc.createElement("div");
      node.className = `incorrect-answer-cell ${kind}`;
      node.setAttribute("role", "cell");
      return node;
    };
    rows.forEach((row) => {
      const line = doc.createElement("div");
      line.className = "incorrect-answer-row incorrect-answer-grid";
      line.setAttribute("role", "row");

      const audio = cell("incorrect-answer-audio");
      if (row.soundUrl) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "incorrect-answer-speaker";
        button.setAttribute("aria-label", `${row.english} 발음 듣기`);
        const icon = doc.createElement("img");
        icon.src = asset("assets/incorrect-answer/icon_speaker.png");
        icon.alt = "";
        icon.width = 37;
        icon.height = 30;
        icon.draggable = false;
        button.appendChild(icon);
        button.addEventListener("click", () => playSound(row.soundUrl, { evenMuted: true }));
        audio.appendChild(button);
      }
      const english = cell("incorrect-answer-word");
      const englishText = doc.createElement("span");
      englishText.className = "incorrect-answer-word-text";
      englishText.textContent = row.english;
      english.appendChild(englishText);
      const meaning = cell("incorrect-answer-meaning");
      meaning.textContent = row.meaning;

      line.append(audio, english, meaning);
      el.incorrectAnswerList.appendChild(line);
    });
  }

  /* 긴 단어를 칸에 맞게 줄인다 — 배율을 0.02 씩 내리고, 배율이 0.73 이하가 되면 멈춘다(마지막으로
     넣는 값은 0.72). 기준 방(OX)과 같은 반복이다.
     창이 감춰져 있으면 폭이 0 이라 잴 수 없으므로 창을 연 뒤에 부르고, 글꼴을 받은 뒤 한 번 더
     부른다(공통 2절 "글꼴을 받은 뒤 다시 맞춤"). 뜻은 줄바꿈으로 다 보이므로 줄이지 않는다. */
  const INCORRECT_WORD_MIN_SCALE = 0.73;
  function fitIncorrectWords() {
    if (!el.incorrectAnswerList || !el.incorrectAnswerDialog || el.incorrectAnswerDialog.hidden) return;
    el.incorrectAnswerList.querySelectorAll(".incorrect-answer-word-text").forEach((text) => {
      const holder = text.closest(".incorrect-answer-word");
      if (!holder) return;
      holder.style.setProperty("--incorrect-word-scale", "1");
      for (let scale = 1; scale > INCORRECT_WORD_MIN_SCALE && text.scrollWidth > text.clientWidth; scale -= 0.02) {
        holder.style.setProperty("--incorrect-word-scale", (scale - 0.02).toFixed(2));
      }
    });
  }

  /* 기록(history)은 저장하되 등수는 보여 주지 않는다 — 스펠링 빌더 게임에는 랭킹이 없다
     (사용자 결정 2026-09-08). saveHistory 는 데모에서 동기적으로 throw 할 수 있어 Promise 로 감싼다. */
  /* 저장 약속을 들고 있는다(공통 9항 2026-09-29). "다시 하기"와 달리 X 로 시작 화면에
     나가면 그 판은 끝나므로, 나가기 전에 이 약속이 끝나기를 기다려야 한다. */
  function saveResult(score) {
    if (!Content) { app.savePromise = Promise.resolve(); return; }
    app.savePromise = Promise.resolve()
      .then(() => Content.saveHistory(score))
      .catch(() => { /* 기록 저장 실패는 결과 화면을 막지 않는다 */ });
  }

  // 결과화면 X: 점수 저장이 끝난 뒤에 시작 화면으로 간다. 두 번 눌러도 한 번만 나간다.
  function exitToStart() {
    if (app.exiting) return;
    app.exiting = true;
    if (el.resultExitButton) el.resultExitButton.disabled = true;
    Promise.resolve(app.savePromise)
      .catch(() => { /* 저장 실패해도 나가는 것은 막지 않는다 */ })
      .then(() => {
        app.exiting = false;
        if (el.resultExitButton) el.resultExitButton.disabled = false;
        enableStart();
      });
  }

  // Try again 판에서는 지난 판 파티클이 남아 보이지 않게 캔버스를 비운다.
  function clearParticles() {
    const canvas = el.resultParticleCanvas;
    if (!canvas || typeof canvas.getContext !== "function") return;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  }

  // 간단한 색종이 파티클 (결과 축하) — Good · Excellent 에서만 부른다(particlesFor).
  function runParticles() {
    const canvas = el.resultParticleCanvas;
    if (!canvas || typeof canvas.getContext !== "function") return;
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
  // 모달 (오답 팝업 포커스 처리)
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

  // (형제 공통의 랭킹 팝업·렌더러는 이 게임에 없다 — 스펠링 빌더는 랭킹을 넣지 않는다.)

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
    let classroom = {};
    try {
      const raw = doc.getElementById("gameConfig");
      const parsed = raw ? JSON.parse(raw.textContent) : {};
      classroom = parsed && typeof parsed.classroom === "object" ? parsed.classroom : {};
      // 닫기 주소만 여기서 함께 읽는다 — 나머지 deployment 값은 content-loader 가 쓴다.
      const deployment = parsed && typeof parsed.deployment === "object" ? parsed.deployment : {};
      app.closeUrl = typeof deployment.closeUrl === "string" ? deployment.closeUrl : "";
    } catch { classroom = {}; app.closeUrl = ""; }
    app.rules = {
      ...RULES,
      questionCount: Number(classroom.questionCount) || RULES.questionCount,
      timerSeconds: Number(classroom.timerSeconds) || RULES.timerSeconds,
      wrongChanceCost: Number(classroom.wrongChanceCost) || RULES.wrongChanceCost,
    };
    /* API 가 시간을 주지 않을 때 돌아갈 값 — "지금 값"(설정값, 없으면 210초)이다. */
    app.configTimerSeconds = app.rules.timerSeconds;
  }

  function onContentReady(snapshot) {
    app.launch = snapshot.launch;
    /* 한 판 시간은 API info.play_time 을 먼저 쓴다(2차 수정 2026-10-02, 사장님 "한 판 시간
       API 우선, 없으면 지금 값 … 강의실 210초"). 예전에는 "전 타입 공통 목업 120초"라며
       메타데이터로만 보관하고 210초를 박아 썼다 — 그 판단을 걷는다. 지금 검수 API 는 120 을
       주므로 검수 서버에서는 한 판이 2분이다(공통 문서 5절, 값은 API 쪽에서 고친다).
       값이 없거나 잘못됐거나 info 요청이 실패하면(content-loader 가 {} 로 둔다) 지금 값이다. */
    app.apiPlayTimeSeconds = playSeconds(snapshot.content.info?.play_time, 0);
    app.rules.timerSeconds = playSeconds(app.apiPlayTimeSeconds, app.configTimerSeconds);
    app.questions = snapshot.content.questions.slice(0, app.rules.questionCount);
    if (app.questions.length === 0) { showLoadError("게임에 사용할 단어가 없습니다."); return; }
    renderStartStory(snapshot.content.info);
    enableStart();
  }

  /* 시작화면 동화 정보(2차 검수 공통-9, 2026-10-15) — API info 의 title(윗줄) · subtitle(아랫줄).
     레벨 · 번호는 넣지 않는다(검수표 캡처에 레벨이 없고 번호는 API 값에 없다). 둘 다 없으면 통째로 숨는다. */
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

  /* 긴 제목은 말줄임 대신 두 줄을 같은 배율로 줄인다(사장님 2026-10-12 OX 방 "글자가 길어지면 폰트 크기를
     줄이게" — 기준 방 OX 의 fitStartStory 와 같은 방식). 배율은 CSS 기준 크기(40px)에 곱하고 바닥은 0.5배다.
     바닥에서도 넘칠 때만 CSS 의 말줄임이 남는다. 화면에 보일 때만 잴 수 있다(숨으면 폭이 0). */
  const START_STORY_MIN_SCALE = 0.5;
  function fitStartStory() {
    const story = el.startStory;
    if (!story || story.hidden || app.screen !== "start") return;
    const lines = [el.startStoryTitle, el.startStorySubtitle].filter((line) => line && !line.hidden);
    let scale = 1;
    story.style.setProperty("--start-story-scale", "1");
    while (scale > START_STORY_MIN_SCALE && lines.some((line) => line.scrollWidth > line.clientWidth)) {
      scale = Math.max(START_STORY_MIN_SCALE, Number((scale - 0.02).toFixed(2)));
      story.style.setProperty("--start-story-scale", String(scale));
    }
  }

  function enableStart() {
    nextGeneration();
    stopSound();
    sfx.preload();
    global.clearTimeout(advanceTimer); advanceTimer = 0;
    if (streakResetTimer) { global.clearTimeout(streakResetTimer); streakResetTimer = 0; }
    paintStreak(0);
    stopTimer();
    app.locked = true;
    /* 시작 화면으로 돌아가면 그 판은 끝난 것이다 — 점수판과 오답 목록을 비우고
       화면의 점수도 0 으로 되돌린다(공통 9항 2026-09-29). */
    app.scoreboard = null;
    app.wrongWords = [];
    updateScore();
    clearResultPanel();
    closeModal(el.incorrectAnswerDialog);
    showScreen("startScreen");
    syncGlobalControls("start");
    // 동화 정보 글자 폭은 보이는 지금 재고, 영어 글꼴을 받은 뒤 한 번 더 잰다(대체 글꼴 폭으로 남지 않게).
    fitStartStory();
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(fitStartStory);
    if (el.startButton) { el.startButton.disabled = false; el.startButton.removeAttribute("aria-busy"); }
    if (el.helpButton) el.helpButton.disabled = false;
  }

  /* [앱 전용 자리] 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — LF 가 앱(Android · iOS)에 올릴 때
     직접 작업한다. 지금은 비어 있다. 화면에 알림은 띄우지 않는다(2차 검수 공통-12, 사장님 2026-10-12
     "closeAppWebView() 알려서 모든 컨텐츠에 적용" — 12개 게임 모두 같은 이름의 빈 함수다). */
  function closeAppWebView() {}

  /* 시작화면 X — 게임을 닫는 X 는 이것 하나다(결과 화면 X · 도움말 ← · 게임 중 X 는 시작 화면으로 간다).
     순서(2차 검수 공통-12, 사장님 2026-10-15 "공통 순서 + 기존 대비책"):
       ① 알림(spellingbuilder:navigate, cancelable) — 호스트가 preventDefault 하면 여기서 끝
       ② closeAppWebView() — 앱 웹뷰 닫기 자리(지금은 빈 함수)
       ③ window.close() — 웹은 새 창으로 열리므로 창을 닫는다. 브라우저가 허용하는 창(스크립트가 연 창, 그리고
          크롬 · 사파리에서는 기록이 한 장뿐인 최상위 창 — 링크로 새로 연 탭도 여기에 든다)만 닫히고, 그 밖에서는
          무시되어 window.closed 가 false 로 남는다. 앱 웹뷰에서는 닫기 요청이 앱에 전해져 closed 가 참이 될 수
          있다 — 그때 앱이 닫아 주지 않으면 화면이 남고 ④ 도 하지 않는다(closeAppWebView 가 채워지기 전까지).
          반박 검토가 헤드리스 크롬에서 직접 연 새 탭이 closed: true 로 닫히는 것을 재현했다(2026-10-15).
       ④ 안 닫혔을 때만 이 방의 예전 대비책: 준 주소(close_url) → 설정 주소 → 같은 출처에서 왔으면 뒤로.
          넷 다 아니면 아무 반응이 없다 — 닫기에서는 문구를 띄우지 않는다(사장님 2026-09-30).
     예전(2026-09-30~10-02)에는 ④ 를 먼저 하고 창 닫기를 맨 끝에 두었다. 주소는 isSameOriginUrl 을 통과한 것만
     쓴다 — 그 검사가 대비책의 핵심이다. */
  function closeGame() {
    const event = new global.CustomEvent("spellingbuilder:navigate", {
      detail: { screen: "close" },
      cancelable: true,
    });
    const allowed = global.dispatchEvent(event);
    if (!allowed) return;            // 호스트가 막았다 — 여기서 끝

    closeAppWebView();
    try { global.close(); } catch { /* noop */ }
    if (global.closed) return;

    const baseHref = global.location?.href;
    let closeParam = "";
    try { closeParam = new global.URLSearchParams(global.location?.search || "").get("close_url") || ""; }
    catch { closeParam = ""; }
    const action = chooseCloseAction({
      closeParam,
      configUrl: app.closeUrl,
      referrer: doc.referrer,
      baseHref,
    });

    if (action.type === "assign") { global.location.assign(action.url); return; }
    if (action.type === "back") global.history.back();
    // action.type === "close" — 창 닫기는 ③ 에서 이미 했다. 더 할 것이 없다.
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
    if (el.letterTiles) {
      el.letterTiles.addEventListener("click", onTileClick);
      el.letterTiles.addEventListener("dragstart", (event) => event.preventDefault());
      el.letterTiles.addEventListener("contextmenu", (event) => event.preventDefault());
    }

    // 어떤 조작이든 첫 클릭이면 배경음을 깨운다(브라우저 자동재생 제한 때문).
    // 결과화면에서는 화면을 눌러도 배경음이 살아나지 않는다(공통 9항).
    el.stage?.addEventListener("click", () => { if (app.screen !== "result") sfx.startBgm(); }, { capture: true });
    el.startButton?.addEventListener("click", () => sfx.effect("touch", 0.7), { capture: true });
    el.startButton?.addEventListener("click", startGame);
    el.helpButton?.addEventListener("click", openHelp);
    el.helpRetryButton?.addEventListener("click", () => loadHelp(true));

    // 결과 화면: 다시 하기 두 곳(좌상단 리플레이 · Try Again)은 같은 동작이다.
    el.tryAgainButton?.addEventListener("click", startGame);
    el.resultExitButton?.addEventListener("click", exitToStart);
    el.incorrectAnswersButton?.addEventListener("click", () => {
      if (el.incorrectAnswersButton.disabled) return;
      openModal(el.incorrectAnswerDialog, el.incorrectAnswerCloseButton);
      fitIncorrectWords();
      if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(fitIncorrectWords);
    });
    el.incorrectAnswerCloseButton?.addEventListener("click", () => closeModal(el.incorrectAnswerDialog));
    el.incorrectAnswerBackdrop?.addEventListener("click", () => closeModal(el.incorrectAnswerDialog));

    el.soundButton?.addEventListener("click", () => setMuted(!app.muted));
    el.navigationButton?.addEventListener("click", () => {
      if (app.screen === "help") { enableStart(); return; }
      if (app.screen === "game") { enableStart(); return; }
      closeGame();
    });
    el.retryButton?.addEventListener("click", boot);

    doc.addEventListener("keydown", onKeydown);
  }

  function init() {
    readConfig();
    // 타일 글꼴을 미리 로드해 첫 문제에서 글자가 늦게 뜨지 않게 한다.
    if (doc.fonts && typeof doc.fonts.load === "function") {
      try {
        doc.fonts.load('700 64px "SofiaProSoft"');
        doc.fonts.load('700 60px "Lexend"');
      } catch { /* noop */ }
    }
    loadKoreanFont();
    wireEvents();
    setMuted(false);
    boot();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
