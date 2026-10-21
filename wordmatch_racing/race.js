(function exposeWordMatchRace(global) {
  "use strict";

  /*
   * 레이싱 판의 규칙과 배치. DOM을 모른다.
   *
   * 기획서(docs/game_spec.png) 개요·항목 1: 문제 제공 영역의 영어 단어에 맞는 뜻
   * 상자가 도로 위로 내려오고(보기 2~3개), 자동차를 좌우로 옮겨 정답만 얻는다.
   * 오답과 장애물은 피한다. 문항별 6초 룰은 없고 정해진 시간 안에 많이 푼다.
   *
   * 좌표는 1920×1080 무대 px. 실측(docs/preview_ready.png):
   *   - 도로 3차선 x 393~768 / 782~1150 / 1165~1535 → 차선 가운데 580 / 966 / 1350
   *   - 보기 상자(answer*.png) 341×179, 장애물(obstacle*.png) 210×210
   *   - 자동차는 y 830~1034 에 서 있다 → 줄의 가운데가 HIT_LINE_Y 에 닿는 순간 판정
   */
  const STAGE_WIDTH = 1920;
  const LANE_COUNT = 3;
  const LANE_CENTERS = Object.freeze([580, 966, 1350]);
  const LANE_BOUNDARIES = Object.freeze([775, 1157]);
  const CHOICE_WIDTH = 341;
  const CHOICE_HEIGHT = 179;
  const OBSTACLE_SIZE = 210;
  const ROW_HEIGHT = 220;
  const ROW_SPAWN_Y = -240;
  const HIT_LINE_Y = 880;
  const EXIT_Y = 1260;
  /*
   * 내려오는 줄 사이 간격(px). 사용자 선택 2026-09-14 "제안 2": 세로 엇갈림을 넣기 전과 같은 여유가
   * 되도록 560 에서 780 으로 넓혔다. 같은 차선에서 가장 좁은 틈은 간격에서 최대 어긋남 220,
   * 상자 반 89.5, 장애물 반 105 를 뺀 약 366px 이다. 배너 단어가 판정보다 먼저 바뀌지 않으려면
   * 두 줄 간격이 출발 위치에서 판정선까지 거리 이상이어야 한다: 2 x 780 >= 880 - (-240).
   * 이 조건은 race 테스트가 지킨다.
   */
  const ROW_GAP_PX = 780;
  /*
   * 보기 상자 세로 어긋남(검수표 r54, 사용자 확인 2026-09-10: 세로 엇갈림).
   * 상자마다 0 · S · 2S 만큼 아래로 밀어 한 줄로 나란히 서지 않게 한다. 어긋남을 0 이상으로만
   * 두는 까닭: 상자가 제 자리에서 판정선에 닿을 때 판정하는데, 어긋남이 음수면 배너가 다음
   * 단어로 바뀐 뒤에도 판정이 남아 배너와 판정 줄이 어긋난다. 0 이상이면 늦어도 줄의 기준점이
   * 판정선에 닿는 순간까지 모두 끝나고, 다음 문제는 그 뒤에 나온다(ROW_GAP_PX 설명).
   */
  const CHOICE_STAGGER_Y = 110;
  // 속도(px/초). 문제를 지날 때마다 조금씩 빨라지고 MAX_SPEED 에서 멈춘다.
  // 2차 수정(사장님 2026-10-01): 지금의 절반. 출발·최고만이 아니라 증가폭도 절반이라
  // 어느 문제에서나 예전 속도의 정확히 1/2 이다(예전 430 · +8 · 525).
  const BASE_SPEED = 215;
  const SPEED_STEP = 4;
  const MAX_SPEED = 262.5;
  // 한 번 update 에 움직일 수 있는 최대 시간. 탭이 숨었다 돌아와도 줄이 건너뛰지 않는다.
  const FRAME_CAP_MS = 100;
  // 문제 줄 다음에 장애물 줄이 올 확률. 장애물 줄은 연달아 오지 않는다.
  const OBSTACLE_CHANCE = 0.7;
  const OBSTACLE_KINDS = Object.freeze(["cone", "tires", "banana"]);
  // 장애물 줄의 빈 차선에 연료통(시간 아이템)이 놓일 확률(사용자 지시 2026-09-04: 먹으면 10초 추가).
  const FUEL_CHANCE = 0.3;
  const CHOICE_COUNTS = Object.freeze([2, 3]);
  const THREE_CHOICE_CHANCE = 0.6;
  // 보기 3개 = 정답 1 + 오답 2 → 서로 다른 뜻이 셋은 있어야 한다.
  const MIN_WORD_COUNT = 3;

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function resolveRandom(random) {
    return typeof random === "function" ? random : Math.random;
  }

  function shuffle(list, random) {
    const items = [...list];
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [items[index], items[swap]] = [items[swap], items[index]];
    }
    return items;
  }

  /*
   * 출제 가능한 단어: 표제어가 알파벳(공백·하이픈·아포스트로피·마침표 허용, 글자가 하나는 있어야 함)이고
   * 뜻이 있으면 된다. 아포스트로피(' ’)와 마침표는 2026-10-01 사용자 지시("글자 규칙 단어 5개도 내도록 해")로
   * 더했다 — 실제 데이터의 No thanks. · nurse's office · on one's own · ahead of one's time · take ... in.
   * 숫자와 그 밖의 기호는 지금처럼 거른다. 표제어는 화면에 textContent 로만 쓰이므로 어떤 글자도 안전하다.
   * 길이로는 거르지 않는다(2026-10-01 사용자 지시: 영어 16자·뜻 20자 거름을 걷고 칸에 맞게 줄인다).
   * 서버가 내려준 단어는 빼지 않고, 긴 단어·뜻은 script.js 가 문제판·차선 상자에 맞춰 줄인다.
   */
  function isPlayableWord(word) {
    const text = cleanText(word?.text);
    const mean = cleanText(word?.mean ?? word?.meaning);
    if (!text || !mean) return false;
    return /^[A-Za-z' \u2019.-]+$/.test(text) && /[A-Za-z]/.test(text);
  }

  function normalizeWords(words) {
    if (!Array.isArray(words)) {
      throw new Error("단어 목록이 필요합니다.");
    }
    const seen = new Set();
    const seenTexts = new Set();
    const list = [];
    words.forEach((word, index) => {
      if (!isPlayableWord(word)) return;
      const mean = cleanText(word.mean ?? word.meaning);
      const key = mean.replace(/\s+/g, "");
      // 같은 표제어가 두 뜻으로 오면(예: light 빛/가벼운) 처음 것만 남긴다. 다른 뜻이 오답 상자에 올라
      // 맞는 뜻을 골라도 오답 처리되는 것을 막는다(검수 확정 2026-09-04).
      const textKey = cleanText(word.text).toLowerCase();
      if (seen.has(key) || seenTexts.has(textKey)) return;
      seen.add(key);
      seenTexts.add(textKey);
      list.push(Object.freeze({
        wordId: `w${index}-${cleanText(word.text).toLowerCase()}`,
        text: cleanText(word.text),
        mean,
        soundUrl: cleanText(word.soundUrl ?? word.sound_url),
      }));
    });
    return list;
  }

  /*
   * 단어 뭉치. 한 바퀴 안에서는 같은 단어를 두 번 내지 않고, 다 쓰면 다시 섞어
   * 이어 간다. 새로 섞을 때 방금 낸 단어가 바로 또 나오지 않게 맨 뒤로 보낸다.
   */
  function createDeck({ words, random, avoidFirst = "" } = {}) {
    const rng = resolveRandom(random);
    const pool = normalizeWords(words);
    if (pool.length === 0) {
      throw new Error("출제할 수 있는 단어가 없습니다.");
    }
    let stack = [];
    let lastDrawn = null;
    // 2차 수정(공통 기준): 앞 판 마지막 단어로 새 판을 시작하지 않는다. 첫 섞기에서만 쓴다 —
    // 그 뒤로는 한 판 안의 lastDrawn 이 같은 일을 한다. 표제어 글자로 견준다(판마다 wordId 가 같다는 보장이 없다).
    const avoidText = cleanText(avoidFirst).toLowerCase();

    function refill() {
      stack = shuffle(pool, rng);
      const top = stack[stack.length - 1];
      const repeats = lastDrawn
        ? top.wordId === lastDrawn.wordId
        : Boolean(avoidText) && top.text.toLowerCase() === avoidText;
      if (pool.length > 1 && repeats) {
        stack.unshift(stack.pop());
      }
    }

    function draw() {
      if (stack.length === 0) refill();
      lastDrawn = stack.pop();
      return lastDrawn;
    }

    return Object.freeze({
      words: pool,
      get size() {
        return pool.length;
      },
      get remaining() {
        return stack.length;
      },
      draw,
    });
  }

  function pickDistractors({ text: headword, meaning, pool, count, random }) {
    const rng = resolveRandom(random);
    const seen = new Set([cleanText(meaning).replace(/\s+/g, "")]);
    const headwordKey = cleanText(headword).toLowerCase();
    const candidates = [];
    (Array.isArray(pool) ? pool : []).forEach((other) => {
      // 같은 단어의 다른 뜻은 오답이 아니다(검수 확정 2026-09-04).
      if (headwordKey && cleanText(other?.text).toLowerCase() === headwordKey) return;
      const text = cleanText(other?.mean ?? other?.meaning);
      const key = text.replace(/\s+/g, "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      candidates.push(text);
    });
    return shuffle(candidates, rng).slice(0, Math.max(0, count));
  }

  /*
   * 문제 하나. 기획서 1-1: 보기가 2~3개(정답 1 + 오답 1~2). 보기는 서로 다른
   * 차선에 놓이고, 정답 차선은 매번 무작위다.
   */
  function buildQuestion({ word, pool, random, choiceCount } = {}) {
    const rng = resolveRandom(random);
    if (!word || !isPlayableWord(word)) {
      throw new Error("문제로 낼 수 없는 단어입니다.");
    }
    const english = cleanText(word.text);
    const meaning = cleanText(word.mean ?? word.meaning);
    const wanted = CHOICE_COUNTS.includes(choiceCount)
      ? choiceCount
      : rng() < THREE_CHOICE_CHANCE ? 3 : 2;
    const distractors = pickDistractors({ text: english, meaning, pool, count: wanted - 1, random: rng });
    const lanes = shuffle([...Array(LANE_COUNT).keys()], rng).slice(0, distractors.length + 1);
    const choices = [
      { lane: lanes[0], text: meaning, correct: true },
      ...distractors.map((text, index) => ({ lane: lanes[index + 1], text, correct: false })),
    ].sort((left, right) => left.lane - right.lane);
    return Object.freeze({
      english,
      meaning,
      soundUrl: cleanText(word.soundUrl ?? word.sound_url),
      choices: Object.freeze(choices.map((choice) => Object.freeze(choice))),
    });
  }

  // 무대 x 좌표가 어느 차선인지. 손으로 누른 자리에서 차선을 고른다.
  function laneForX(x) {
    const value = Number(x);
    if (!Number.isFinite(value)) return 1;
    if (value < LANE_BOUNDARIES[0]) return 0;
    if (value < LANE_BOUNDARIES[1]) return 1;
    return 2;
  }

  function clampLane(index) {
    const value = Math.trunc(Number(index));
    if (!Number.isFinite(value)) return 1;
    return Math.max(0, Math.min(LANE_COUNT - 1, value));
  }

  function snapshotRow(row) {
    return {
      id: row.id,
      kind: row.kind,
      y: row.y,
      resolved: row.resolved,
      question: row.question,
      items: row.items.map((item) => ({ ...item })),
    };
  }

  /*
   * 한 판. update(deltaMs) 가 줄을 내리고 판정하며 일어난 일을 이벤트로 돌려준다.
   *   spawn   — 새 줄이 위에 나타났다(question 줄이면 문제 배너를 바꾼다)
   *   resolve — 줄이 판정선에 닿았다. outcome: correct / wrong / miss / obstacle / fuel / clear
   *   exit    — 줄이 무대 아래로 나갔다
   * 줄의 종류는 question(보기 상자), obstacle(장애물, 연료통 아이템 포함), gap(빈 줄) 세 가지다.
   */
  function createRace({
    words,
    random,
    obstacleChance = OBSTACLE_CHANCE,
    fuelChance = FUEL_CHANCE,
    startLane = 1,
    // 보기 개수를 2 또는 3으로 고정한다. 비우면 문제마다 무작위(기획서 1-1: 2~3개).
    choiceCount = null,
    // 앞 판 마지막 단어(영어). 이 단어로 첫 문제를 내지 않는다(2차 수정).
    avoidFirst = "",
  } = {}) {
    const rng = resolveRandom(random);
    const deck = createDeck({ words, random: rng, avoidFirst });
    const fixedChoiceCount = CHOICE_COUNTS.includes(choiceCount) ? choiceCount : null;
    if (deck.size < MIN_WORD_COUNT) {
      throw new Error(`게임에는 서로 다른 뜻을 가진 단어가 ${MIN_WORD_COUNT}개 이상 필요합니다.`);
    }
    const chance = Number.isFinite(Number(obstacleChance))
      ? Math.max(0, Math.min(1, Number(obstacleChance)))
      : OBSTACLE_CHANCE;
    const fuelOdds = Number.isFinite(Number(fuelChance))
      ? Math.max(0, Math.min(1, Number(fuelChance)))
      : FUEL_CHANCE;

    const state = {
      lane: clampLane(startLane),
      speed: BASE_SPEED,
      elapsedMs: 0,
      rows: [],
      nextRowId: 1,
      questionCount: 0,
      spawnedQuestions: 0,
      currentQuestion: null,
      lastKind: null,
    };

    /*
     * 줄의 종류. 문제 줄은 연달아 오지 않는다 — 배너의 단어와 판정선에 닿는 줄이 늘
     * 같아야 하므로, 문제 사이에는 장애물 줄이나 빈 줄(gap)이 하나 들어간다.
     */
    function nextKind() {
      if (state.lastKind !== "question") return "question";
      return rng() < chance ? "obstacle" : "gap";
    }

    function spawnRow() {
      const kind = nextKind();
      const row = {
        id: state.nextRowId,
        kind,
        y: ROW_SPAWN_Y,
        resolved: false,
        items: [],
        question: null,
      };
      state.nextRowId += 1;

      if (kind === "question") {
        const question = buildQuestion({
          word: deck.draw(),
          pool: deck.words,
          random: rng,
          choiceCount: fixedChoiceCount,
        });
        row.question = question;
        const offsets = shuffle(
          [...Array(LANE_COUNT).keys()].map((step) => step * CHOICE_STAGGER_Y),
          rng,
        );
        row.items = question.choices.map((choice, index) => ({
          lane: choice.lane,
          kind: "choice",
          text: choice.text,
          correct: choice.correct,
          offsetY: offsets[index],
          state: "idle",
        }));
        state.currentQuestion = question;
        state.spawnedQuestions += 1;
      } else if (kind === "obstacle") {
        // 장애물은 1~2개. 늘 한 차선은 비워 두어 피할 길을 남긴다.
        const count = Math.min(rng() < 0.5 ? 1 : 2, LANE_COUNT - 1);
        const lanes = shuffle([...Array(LANE_COUNT).keys()], rng)
          .slice(0, count)
          .sort((left, right) => left - right);
        row.items = lanes.map((lane) => ({
          lane,
          kind: "obstacle",
          offsetY: 0,
          obstacle: OBSTACLE_KINDS[Math.floor(rng() * OBSTACLE_KINDS.length)],
          state: "idle",
        }));
        // 연료통(시간 아이템)은 장애물이 없는 차선에 하나 놓인다. 먹으면 10초가 늘어난다.
        const freeLanes = [...Array(LANE_COUNT).keys()].filter((lane) => !lanes.includes(lane));
        if (freeLanes.length > 0 && rng() < fuelOdds) {
          const lane = freeLanes[Math.floor(rng() * freeLanes.length)];
          row.items.push({ lane, kind: "fuel", offsetY: 0, state: "idle" });
          row.items.sort((left, right) => left.lane - right.lane);
        }
      }

      state.lastKind = kind;
      state.rows.push(row);
      return row;
    }

    // 상자가 놓인 자리. 줄의 기준점에서 제 어긋남만큼 아래다.
    function itemLineY(row, item) {
      return row.y + (Number(item?.offsetY) || 0);
    }

    function resolveRow(row, item) {
      row.resolved = true;
      let outcome;
      if (row.kind === "question") {
        if (item) {
          item.state = "hit";
          outcome = item.correct ? "correct" : "wrong";
        } else {
          outcome = "miss";
        }
        state.questionCount += 1;
        state.speed = Math.min(MAX_SPEED, BASE_SPEED + SPEED_STEP * state.questionCount);
      } else if (item) {
        item.state = "hit";
        outcome = item.kind === "fuel" ? "fuel" : "obstacle";
      } else {
        outcome = "clear";
      }
      row.items.forEach((entry) => {
        if (entry.state === "idle") entry.state = "passed";
      });
      return {
        type: "resolve",
        row: snapshotRow(row),
        lane: state.lane,
        outcome,
        item: item ? { ...item } : null,
        question: row.question,
      };
    }

    function update(deltaMs) {
      const events = [];
      const dt = Math.max(0, Math.min(Number(deltaMs) || 0, FRAME_CAP_MS));
      state.elapsedMs += dt;
      const distance = (state.speed * dt) / 1000;
      state.rows.forEach((row) => {
        row.y += distance;
      });
      /*
       * 판정(검수표 r54). 보기 상자가 세로로 엇갈려 있으므로 줄 전체가 아니라 상자마다
       * 제 자리에서 판정선에 닿는다. 자동차가 있는 차선의 상자가 닿는 순간 한 번만 판정하고,
       * 마지막 상자까지 지나갔는데 아무것도 못 지났으면 그때 놓친 것으로 본다.
       * 빈 줄(gap)은 상자가 없으므로 줄의 기준점으로 판정한다.
       */
      state.rows.forEach((row) => {
        if (row.resolved) return;
        if (row.items.length === 0) {
          if (row.y >= HIT_LINE_Y) events.push(resolveRow(row, null));
          return;
        }
        row.items
          .filter((entry) => !entry.crossed && itemLineY(row, entry) >= HIT_LINE_Y)
          .sort((left, right) => (Number(right.offsetY) || 0) - (Number(left.offsetY) || 0))
          .forEach((entry) => {
            entry.crossed = true;
            if (!row.resolved && entry.lane === state.lane) events.push(resolveRow(row, entry));
          });
        if (!row.resolved && row.items.every((entry) => entry.crossed)) {
          events.push(resolveRow(row, null));
        }
      });
      state.rows = state.rows.filter((row) => {
        if (row.y >= EXIT_Y) {
          events.push({ type: "exit", row: snapshotRow(row) });
          return false;
        }
        return true;
      });
      const last = state.rows[state.rows.length - 1];
      if (!last || last.y - ROW_SPAWN_Y >= ROW_GAP_PX) {
        events.push({ type: "spawn", row: snapshotRow(spawnRow()) });
      }
      return events;
    }

    function setLane(index) {
      const lane = clampLane(index);
      const changed = lane !== state.lane;
      state.lane = lane;
      return { lane, changed };
    }

    function moveLane(delta) {
      return setLane(state.lane + (Math.trunc(Number(delta)) || 0));
    }

    // 지금 속도(px/초). 도로 띠를 줄과 같은 속도로 흘리는 데 쓴다.
    function speed() {
      return state.speed;
    }

    // 매 프레임 그리기용. 줄마다 id 와 y 만 준다.
    function positions() {
      return state.rows.map((row) => ({ id: row.id, y: row.y }));
    }

    function snapshot() {
      return {
        lane: state.lane,
        speed: state.speed,
        elapsedMs: state.elapsedMs,
        questionCount: state.questionCount,
        spawnedQuestions: state.spawnedQuestions,
        currentQuestion: state.currentQuestion,
        deckSize: deck.size,
        rows: state.rows.map(snapshotRow),
      };
    }

    return Object.freeze({
      update,
      setLane,
      moveLane,
      speed,
      positions,
      state: snapshot,
    });
  }

  global.WordMatchRace = Object.freeze({
    STAGE_WIDTH,
    LANE_COUNT,
    LANE_CENTERS,
    LANE_BOUNDARIES,
    CHOICE_WIDTH,
    CHOICE_HEIGHT,
    OBSTACLE_SIZE,
    ROW_HEIGHT,
    ROW_SPAWN_Y,
    HIT_LINE_Y,
    EXIT_Y,
    ROW_GAP_PX,
    CHOICE_STAGGER_Y,
    BASE_SPEED,
    SPEED_STEP,
    MAX_SPEED,
    FRAME_CAP_MS,
    OBSTACLE_CHANCE,
    OBSTACLE_KINDS,
    FUEL_CHANCE,
    CHOICE_COUNTS,
    MIN_WORD_COUNT,
    isPlayableWord,
    laneForX,
    createDeck,
    buildQuestion,
    createRace,
  });
})(typeof window !== "undefined" ? window : globalThis);
