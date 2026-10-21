(function exposeMoleGame(global) {
  "use strict";

  /*
   * 두더지 판 모델. DOM을 모른다 — 좌표와 짝짓기 판정, 그리고 한 판을 언제
   * 거둘지만 안다. 그래서 tests/ 에서 브라우저 없이 그대로 검증한다. 화면에
   * 올리고 내리는 연출은 script.js 몫이다.
   *
   * 판은 여덟 자리에 뜬다. 시안(docs/preview_game.png)을 배경 그림에 맞춰 재서
   * 얻은 값이며, 각 자리는 544x344 판 그림의 왼쪽 위 모서리다. 가운데 줄만 두 칸이라
   * 3-2-3 엇갈림이 된다.
   */
  const SLOTS = Object.freeze([
    /*
     * x 는 잎사귀까지 포함한 판 그림 폭을 기준으로 다시 잡았다. 시안에서 잰
     * 값(0줄 191/689/1161, 2줄 181/668/1166)은 가운데와 오른쪽 판이 -10px 로
     * 겹치고 2줄도 5px 밖에 안 남아 잎사귀가 서로 파고들었다.
     *
     * 영어 판 그림은 캔버스 안 x 35..516(481), 뜻 판은 1.0303 배 확대 뒤
     * x 34..504(470)이다. 501 간격으로 놓으면 어떤 조합이 이웃해도 최소 19px
     * 이 남고, 3장의 그림 양끝이 무대 가운데(960)에 맞는다.
     */
    Object.freeze({ index: 0, row: 0, x: 184, y: 8 }),
    Object.freeze({ index: 1, row: 0, x: 685, y: 8 }),
    Object.freeze({ index: 2, row: 0, x: 1186, y: 8 }),
    // 가운데 줄은 두 장이라 따로 가운데 정렬한다(그림 중심 960).
    Object.freeze({ index: 3, row: 1, x: 386, y: 295 }),
    Object.freeze({ index: 4, row: 1, x: 983, y: 295 }),
    /*
     * 아랫줄은 시안값 557 에서 8px 내렸다. 팻말 아래끝(887)이 하단 바(y 880)
     * 뒤로 7px 들어가 바닥이 뜨지 않는다.
     *
     * 이 줄의 하한은 558 이다 — 팻말 아래끝이 정확히 880 에 닿는 자리이고,
     * 그보다 올리면 바와 팻말 사이에 다시 틈이 보인다.
     */
    Object.freeze({ index: 5, row: 2, x: 184, y: 565 }),
    Object.freeze({ index: 6, row: 2, x: 685, y: 565 }),
    Object.freeze({ index: 7, row: 2, x: 1186, y: 565 }),
  ]);

  const BOARD_WIDTH = 544;
  const BOARD_HEIGHT = 344;
  // 판 그림마다 여우 표정이 네 가지다(eng0..3 / kor0..3).
  const POSE_COUNT = 4;

  // 한 번에 뜨는 짝의 수. 여덟 자리를 영어 넷 + 뜻 넷으로 채운다.
  const PAIRS_ON_BOARD = 4;

  /*
   * 한 판이 머무는 시간(검수 r38). 판이 깔린 뒤 이만큼 지나면 남은 팻말을 모두
   * 거두고 새로 깐다. 검수자 설명 그대로다 — "10초 동안 정답을 맞추면 영어,
   * 한글 팻말 짝이 없어지고 … 10초가 지나면 팻말은 다시 8개로 세팅".
   */
  const WAVE_SECONDS = 10;

  /*
   * 길이 거름은 없다(2차 수정, 공통 문서 1절 "단어 거름"). 예전에는 영어 14자 · 뜻 24자를
   * 넘으면 출제에서 뺐는데, 이제 서버가 주는 그대로 판 글자 상자에 맞게 줄인다(script.js
   * fitBoardText). 단어 내용이 문제면 API 쪽에서 고친다.
   */

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  /*
   * 출제 가능한 단어인지. 빈 단어 · 빈 뜻만 뺀다 — 게임이 성립하지 않기 때문이다.
   * 길이와 글자로는 거르지 않는다(2차 수정, 공통 문서 1절 "단어 거름" · 사장님 "권장대로 진행" 2026-10-02).
   * 공백 · 하이픈 · 마침표 · 아포스트로피가 든 표제어(`ice cream`, `good-bye`, `No thanks.`)도 API 문자열
   * 그대로 판에 올리고, 영어 판 글자는 script.js 가 한 줄 → 두 줄 규칙으로 칸에 맞춘다(카드 방과 같음).
   * 예전에는 알파벳만 받아 검수 API 320단어 가운데 46개가 빠졌다.
   */
  function isPlayableWord(word) {
    const isRecord = Boolean(word) && typeof word === "object";
    // 객체에 text 가 없으면 빈 단어다 — 객체 자체를 글자로 바꾸면 "[object Object]" 가 되어 통과해 버린다.
    const text = cleanText(isRecord ? word.text : word);
    if (!text) return false;
    if (isRecord && !cleanText(word.mean ?? word.meaning)) return false;
    return true;
  }

  /*
   * 판 위에서 두 단어가 겹치는지 가르는 열쇠. 영어는 대소문자와 단어 사이 공백 수(줄바꿈 · 줄바꿈 없는 공백 포함)를,
   * 뜻은 줄바꿈과 앞뒤 공백을 가리지 않는다. 판에는 공백이 하나로 모여 보이므로(script.js fillEnglishText)
   * `ice  cream` 과 `Ice Cream` 은 같은 모양이다 — 같은 판에 함께 올리면 어느 쪽 짝인지 알 수 없다.
   */
  function textKey(text) {
    return cleanText(text).toLowerCase().replace(/\s+/g, " ");
  }

  function meaningKey(mean) {
    return cleanText(mean).replace(/\s+/g, " ");
  }

  function shuffle(list, random) {
    const pool = list.slice();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool;
  }

  /*
   * 두 판이 짝인지. 같은 단어이면서 한쪽은 영어, 한쪽은 뜻이어야 한다. 같은 단어의
   * 같은 면 둘을 고르는 것은 짝이 아니다(애초에 그렇게 깔리지 않지만, 판정은
   * 깔린 모양에 기대지 않는다).
   */
  function isPair(a, b) {
    if (!a || !b) return false;
    if (a.slot === b.slot) return false;
    return a.wordId === b.wordId && a.kind !== b.kind;
  }

  function createBoard(options) {
    const settings = options && typeof options === "object" ? options : {};
    const random = typeof settings.random === "function" ? settings.random : Math.random;
    const pairsOnBoard = Math.max(1, Math.min(
      Math.trunc(Number(settings.pairsOnBoard) || PAIRS_ON_BOARD),
      Math.floor(SLOTS.length / 2),
    ));

    const source = Array.isArray(settings.words) ? settings.words : [];
    const playable = source.filter(isPlayableWord).map((word, position) => ({
      wordId: `w${position}`,
      text: cleanText(word.text),
      mean: cleanText(word.mean ?? word.meaning),
      soundUrl: cleanText(word.soundUrl ?? word.sound_url),
    }));
    if (playable.length === 0) {
      throw new Error("두더지 판에 올릴 수 있는 단어가 없습니다.");
    }

    // 문제 수만큼만 낸다. 단어가 모자라면 있는 만큼만 낸다.
    const questionCount = Math.max(1, Math.trunc(Number(settings.questionCount) || playable.length));
    /*
     * 한 바퀴에 낼 단어(출제 명단). 검수 4차 q57 "정해진 시간 동안 게임 진행되어야함" 에 따라,
     * 명단을 다 내고 판이 비면 같은 명단을 다시 섞어 낸다(사용자 선택 2026-09-29). 그래서
     * 대기열이 영영 비지 않고, 게임은 시간으로만 끝난다.
     */
    const roster = shuffle(playable, random).slice(0, Math.min(questionCount, playable.length));
    /*
     * 다시 시작할 때 직전 게임 마지막 판에 깔렸던 단어(공통 문서 1절 "다시 시작 (한 화면에
     * 여러 단어)"). 첫 판에서 빼고, 모자라면 뺄 수 있는 만큼만 빼서 모자란 자리만 그 단어로
     * 채운다 — 대기열 맨 뒤로 보내 두면 앞의 단어가 먼저 깔리고 모자랄 때만 닿는다.
     */
    const avoid = new Set((Array.isArray(settings.avoidFirst) ? settings.avoidFirst : []).map(textKey));
    const queue = roster.filter((word) => !avoid.has(textKey(word.text)))
      .concat(roster.filter((word) => avoid.has(textKey(word.text))));
    let rounds = 1;

    const slots = SLOTS.map((slot) => ({
      index: slot.index,
      row: slot.row,
      x: slot.x,
      y: slot.y,
      occupant: null,
    }));

    let selection = null;
    let matched = 0;
    // 한 번이라도 판에 나온 단어 수. 다시 깔기로 돌아온 단어는 또 세지 않는다.
    let served = 0;
    const seenWordIds = new Set();
    // 깔린 순번. 거둘 때 대기열에 돌려보내는 순서로 쓴다.
    let dealtCount = 0;
    /*
     * 이번 판(10초)에 깔린 단어. 판을 새로 깔 때 비운다. 맞혀서 사라진 짝도 남는다 —
     * 게임이 끝났을 때 "마지막 판에 깔렸던 단어"로 쓰고, 다음 판이 피할 "직전 판 단어"로도 쓴다.
     */
    let waveWords = [];
    /*
     * 직전 판에 깔렸던 단어(WM6-1 — LF 댓글 2026-09-29 "직전 문제와 연속 중복 방지"). 새 판은 이 단어를 피해 고르고,
     * 피하면 네 짝을 못 채울 때(명단이 작을 때)만 모자란 자리를 이 단어로 채운다 — 판을 깔 때 네 짝이 먼저다
     * (WM6-1 "판 세팅 바뀔 때 4개 총 8개 팻말"). 첫 판은 직전 게임 마지막 판 단어(avoidFirst)를 피한다.
     */
    let previousWave = new Set(roster.filter((word) => avoid.has(textKey(word.text))).map((word) => word.wordId));

    function occupantView(occupant) {
      return occupant
        ? {
          slot: occupant.slot,
          wordId: occupant.wordId,
          kind: occupant.kind,
          pose: occupant.pose,
          text: occupant.kind === "en" ? occupant.word.text : occupant.word.mean,
          english: occupant.word.text,
          meaning: occupant.word.mean,
          soundUrl: occupant.word.soundUrl,
        }
        : null;
    }

    function state() {
      return {
        slots: slots.map((slot) => ({
          index: slot.index,
          row: slot.row,
          x: slot.x,
          y: slot.y,
          occupant: occupantView(slot.occupant),
        })),
        selection: selection ? occupantView(selection) : null,
        remaining: queue.length,
        onBoard: slots.filter((slot) => slot.occupant).length,
        matched,
        served,
        // 판이 비면 명단을 다시 섞어 내므로 "다 냈다"로 끝나지 않는다(검수 4차 q57).
        // rounds 는 첫 명단 1 + 명단을 다시 섞어 대기열에 보탠 횟수다. 판 위 · 대기열에 없는 단어만 일부
        // 보태도 한 번으로 센다 — 정확한 "바퀴 수"는 아니다. 테스트만 읽는다.
        rounds,
      };
    }

    function freeSlots() {
      return slots.filter((slot) => !slot.occupant);
    }

    // 판 위에 있는 단어와 겹치는지. 같은 단어(wordId), 같은 철자, 같은 뜻 어느 하나라도 겹치면 올리지 않는다.
    function clashesWithBoard(word) {
      return slots.some((slot) => {
        const other = slot.occupant?.word;
        if (!other) return false;
        return other.wordId === word.wordId
          || textKey(other.text) === textKey(word.text)
          || meaningKey(other.mean) === meaningKey(word.mean);
      });
    }

    /*
     * 다음에 올릴 단어를 대기열에서 꺼낸다(WM6-1). 판 위 단어와 겹치는 것과 직전 판 단어는 건너뛰고 대기열에
     * 그대로 둔다 — 못 맞힌 단어는 대기열 맨 뒤에 있으므로 아직 안 나온 단어가 먼저 나온다.
     *  1) 대기열에서 판 위와 겹치지 않고 직전 판에도 없던 단어
     *  2) 없으면 명단을 다시 섞어 한 바퀴를 더한다(검수 4차 q57 · LF 댓글 "전체 단어 순환") — 이미 대기열에 있는
     *     단어는 넣지 않아 대기열에 같은 단어가 둘 생기지 않는다. 그 순간 판 위에 있는 단어도 새 바퀴에 넣는다 — 판 위에
     *     있는 동안은 건너뛰고 그 바퀴 뒤쪽에서 나온다. 빼 두면 그 단어는 판에서 맞혀 사라진 뒤 다음 바퀴까지 돌아오지 않아
     *     둘째 바퀴부터 단어마다 나오는 횟수가 2~3 번까지 벌어졌다(반박 검토 2026-10-15). 그 바퀴에서 다시 1) 을 찾는다
     *  3) 그래도 없으면 직전 판 단어라도 쓴다 — 판을 깔 때 네 짝이 먼저다(WM6-1 "4개 총 8개 팻말")
     * 그래도 없으면(명단이 판 한 장보다 적다) null — 그 자리는 비워 둔다.
     */
    function takeWord() {
      const clear = (word) => !clashesWithBoard(word);
      const fresh = (word) => clear(word) && !previousWave.has(word.wordId);
      let index = queue.findIndex(fresh);
      if (index < 0) {
        const waiting = new Set(queue.map((word) => word.wordId));
        const more = roster.filter((word) => !waiting.has(word.wordId));
        // 새 바퀴에 지금 올릴 수 있는 단어가 없으면(모두 판 위 — 명단이 판 한 장보다 작음) 보태지 않는다.
        // 새 바퀴가 직전 판 단어뿐이고 대기열에 쓸 단어가 남았으면 바퀴를 앞당겨 보태지 않는다.
        if (more.some(clear) && (more.some(fresh) || !queue.some(clear))) {
          queue.push(...shuffle(more, random));
          rounds += 1;
        }
        index = queue.findIndex(fresh);
        if (index < 0) index = queue.findIndex(clear);
      }
      if (index < 0) return null;
      return queue.splice(index, 1)[0];
    }

    // 빈 자리 둘에 한 짝을 올린다. 올릴 단어나 자리가 없으면 아무것도 하지 않는다.
    function placePair(placed) {
      const open = freeSlots();
      if (open.length < 2) return false;
      if (slots.filter((slot) => slot.occupant).length >= pairsOnBoard * 2) return false;
      const word = takeWord();
      if (!word) return false;
      if (!seenWordIds.has(word.wordId)) {
        seenWordIds.add(word.wordId);
        served += 1;
      }
      if (!waveWords.includes(word)) waveWords.push(word);
      dealtCount += 1;
      const picks = shuffle(open, random).slice(0, 2);
      const kinds = shuffle(["en", "ko"], random);
      picks.forEach((slot, position) => {
        slot.occupant = {
          slot: slot.index,
          wordId: word.wordId,
          kind: kinds[position],
          pose: Math.floor(random() * POSE_COUNT),
          order: dealtCount,
          word,
        };
        placed.push(occupantView(slot.occupant));
      });
      return true;
    }

    /*
     * 빈 판에 한 판을 깐다(검수 r38). 팻말이 한 장이라도 남아 있으면 아무것도 하지 않는다 —
     * 맞힌 자리는 채우지 않고 그 판이 끝날 때까지 비워 둔다(WM6-1 — LF 답 2026-10-08 "1문제만 맞혀도
     * 우선 유지"). 판은 네 짝을 다 맞혔을 때와 10초가 지났을 때만 새로 깔린다. 영어 판과 뜻 판이
     * 반드시 함께 올라가므로 화면에는 언제나 맞출 수 있는 짝만 있다.
     */
    function deal() {
      const placed = [];
      if (slots.some((slot) => slot.occupant)) return placed;
      if (waveWords.length > 0) previousWave = new Set(waveWords.map((word) => word.wordId));
      waveWords = [];
      while (placePair(placed)) { /* 자리가 차거나 단어가 떨어질 때까지 */ }
      return placed;
    }

    function slotAt(index) {
      return slots.find((slot) => slot.index === index) || null;
    }

    function clearSelection() {
      selection = null;
    }

    /*
     * 판 하나를 고른다.
     *  - 처음 고르면 selected
     *  - 같은 판을 다시 고르면 deselected
     *  - 짝이면 match, 두 판을 비운다
     *  - 짝이 아니면 miss, 고른 것을 풀어 준다
     */
    function select(index) {
      const slot = slotAt(index);
      if (!slot || !slot.occupant) {
        return { status: "ignored", reason: "empty_slot" };
      }
      const picked = slot.occupant;
      if (!selection) {
        selection = picked;
        return { status: "selected", selection: occupantView(picked) };
      }
      if (selection.slot === picked.slot) {
        clearSelection();
        return { status: "deselected", selection: occupantView(picked) };
      }
      const first = selection;
      clearSelection();
      if (isPair(first, picked)) {
        const cleared = [first.slot, picked.slot];
        cleared.forEach((slotIndex) => {
          const target = slotAt(slotIndex);
          if (target) target.occupant = null;
        });
        matched += 1;
        return {
          status: "match",
          cleared,
          pair: [occupantView(first), occupantView(picked)],
          english: first.word.text,
          meaning: first.word.mean,
          soundUrl: first.word.soundUrl,
        };
      }
      return {
        status: "miss",
        pair: [occupantView(first), occupantView(picked)],
        // 오답 집계는 고른 쪽 가운데 영어 판을 기준으로 남긴다. 둘 다 같은 면일
        // 수는 없으므로 언제나 하나는 영어다.
        english: first.kind === "en" ? first.word.text : picked.word.text,
        meaning: first.kind === "en" ? first.word.mean : picked.word.mean,
        soundUrl: first.kind === "en" ? first.word.soundUrl : picked.word.soundUrl,
      };
    }

    /*
     * 판을 다시 깔기 전에 남은 팻말을 모두 거둔다(검수 r38). 못 맞힌 단어는
     * 대기열 맨 뒤로 보낸다(사용자 선택) — 아직 안 나온 단어가 먼저 나오고,
     * 못 맞힌 단어는 한 바퀴 돈 뒤에 다시 나온다. 돌려보내는 순서는 판에 깔린
     * 순서다. 자리는 다음 deal 이 무작위로 다시 고른다.
     *
     * 짝 두 장은 언제나 함께 거둔다. 한 쪽만 남기면 남은 쪽이 영영 짝을 못 만난다.
     */
    function recall() {
      const going = slots.filter((slot) => slot.occupant);
      if (going.length === 0) return { status: "ignored", cleared: [], words: [] };
      clearSelection();
      const words = [];
      going
        .map((slot) => slot.occupant)
        .sort((a, b) => a.order - b.order)
        .forEach((occupant) => {
          if (!words.includes(occupant.word)) words.push(occupant.word);
        });
      const cleared = going.map((slot) => slot.index);
      going.forEach((slot) => { slot.occupant = null; });
      // 판 위에 있던 채로 다음 바퀴에 이미 들어간 단어(takeWord 2)는 그 자리에서 빼고 맨 뒤로 옮긴다 — 둘이 되지 않게.
      words.forEach((word) => {
        const waiting = queue.indexOf(word);
        if (waiting >= 0) queue.splice(waiting, 1);
        queue.push(word);
      });
      return { status: "recalled", cleared, words: words.map((word) => word.text) };
    }

    function occupiedWordIds() {
      const ids = [];
      slots.forEach((slot) => {
        if (slot.occupant && !ids.includes(slot.occupant.wordId)) ids.push(slot.occupant.wordId);
      });
      return ids;
    }

    // 이번 판에 깔린 단어의 영어 철자. 다시 시작할 때 첫 판에서 뺄 단어로 넘긴다.
    function waveWordTexts() {
      return waveWords.map((word) => word.text);
    }

    return Object.freeze({
      SLOTS,
      state,
      deal,
      waveWordTexts,
      select,
      recall,
      clearSelection,
      occupiedWordIds,
      get totalQuestions() {
        return Math.min(questionCount, playable.length);
      },
    });
  }

  /*
   * 한 판의 시계(검수 r38). DOM도 실제 타이머도 모른다 — setTimeout 과
   * clearTimeout 을 받아 쓰므로 테스트는 가짜 시계로 돌린다.
   *
   *  - start()  판을 깐 순간 부른다. waveMs(기본 10초) 뒤 onDue 를 부른다.
   *  - 그때 isBusy() 가 참이면(팻말을 골라 두었거나 정답·오답 효과가 도는 중)
   *    부르지 않고 미뤄 둔다. 사용자 선택 "짝 판정 뒤로 미룸" — 고르던 팻말이
   *    판정 전에 사라지지 않게 한다.
   *  - settle() 바쁜 일이 끝날 때마다 부른다. 미뤄 둔 것이 있고 이제 한가하면
   *    그때 onDue 를 부른다. 한 판에 onDue 는 한 번뿐이다.
   *  - stop()   게임이 끝나거나, 판이 비어 곧바로 다음 판을 깔 때 부른다.
   *
   * 늦게 도착한 타이머는 번호로 걸러 낸다. clearTimeout 이 듣지 않는 환경에서도
   * 멈춘 시계나 지난 판의 시계가 새 판을 거두지 못한다.
   */
  function createWaveClock(options) {
    const settings = options && typeof options === "object" ? options : {};
    const waveMs = Number(settings.waveMs) > 0 ? Number(settings.waveMs) : WAVE_SECONDS * 1000;
    const isBusy = typeof settings.isBusy === "function" ? settings.isBusy : () => false;
    const onDue = typeof settings.onDue === "function" ? settings.onDue : () => {};
    const setTimer = typeof settings.setTimeout === "function"
      ? settings.setTimeout
      : (callback, delay) => global.setTimeout(callback, delay);
    const clearTimer = typeof settings.clearTimeout === "function"
      ? settings.clearTimeout
      : (timerId) => global.clearTimeout(timerId);

    let generation = 0;
    let timerId = null;
    let running = false;
    let pending = false;

    function stop() {
      generation += 1;
      if (timerId !== null) clearTimer(timerId);
      timerId = null;
      running = false;
      pending = false;
    }

    function fire() {
      running = false;
      pending = false;
      onDue();
    }

    function start() {
      stop();
      const token = generation;
      running = true;
      timerId = setTimer(() => {
        if (token !== generation || !running) return;
        timerId = null;
        if (isBusy()) {
          pending = true;
          return;
        }
        fire();
      }, waveMs);
    }

    function settle() {
      if (!running || !pending || isBusy()) return false;
      fire();
      return true;
    }

    return Object.freeze({
      start,
      stop,
      settle,
      get running() {
        return running;
      },
      get pending() {
        return pending;
      },
    });
  }

  global.MoleGame = Object.freeze({
    SLOTS,
    BOARD_WIDTH,
    BOARD_HEIGHT,
    POSE_COUNT,
    PAIRS_ON_BOARD,
    WAVE_SECONDS,
    isPlayableWord,
    isPair,
    createBoard,
    createWaveClock,
  });
})(typeof window !== "undefined" ? window : globalThis);
