(function exposeCardMatch(global) {
  "use strict";

  /*
   * 카드 짝 맞추기 판 모델. DOM을 모른다 — 격자 배치와 짝 판정만 안다. 그래서
   * tests/ 에서 브라우저 없이 그대로 검증한다. 뒤집기·사라지기 연출은 script.js 몫이다.
   *
   * 기획서(docs/game_spec.png)는 1단계 3x3 → 2단계 4x3 이지만, 3x3(9장)은 홀수라
   * 짝이 맞지 않는다. 사용자 지시(2026-09-02 "3x3 -> 3x2로 수정"): 첫 판은 3x2(6장,
   * 3쌍), 그다음부터는 4x3(12장, 6쌍)이다. 카드 색은 판마다 초록 조개 → 노랑 불가사리
   * 순으로 번갈아 낸다. 한 판의 짝을 다 맞히면 시간이 끝날 때까지 새 판을 계속 낸다.
   */
  const LAYOUTS = Object.freeze({
    first: Object.freeze({ columns: 3, rows: 2, pairs: 3 }),
    next: Object.freeze({ columns: 4, rows: 3, pairs: 6 }),
  });
  const THEMES = Object.freeze(["green", "yellow"]);

  // 카드 그림(card_gr / card_yel / waite_card)의 원본 크기.
  const CARD_WIDTH = 280;
  const CARD_HEIGHT = 199;

  /*
   * 2차 수정(사장님 2026-10-01 "API로 전달 받은문자열이기 때문에 그대로 빼지말고 적용할것", 여쭐 것 답 "3. 셋 다 걷기"):
   * 예전에는 뜻 24자 · 영어 16자를 넘거나 영어에 알파벳/공백/하이픈/아포스트로피 밖의 글자(2nd, Mr. 등)가 있으면
   * 출제에서 뺐다. 이제 빼지 않고 카드 칸에 맞게 줄여 보인다(script.js 글자 맞춤). 내용이 이상한 단어는 API 쪽에서
   * 고친다. 이름은 다른 파일이 읽던 값이라 남기되 길이로 거르지 않는다.
   */
  const MAX_WORD_LENGTH = Infinity;
  const MAX_MEANING_LENGTH = Infinity;

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  /*
   * 출제 가능한 단어인지. 2차 수정 뒤로는 짝을 만들 수 있는지만 본다 — 단어와 뜻이 비어 있지 않으면 된다.
   * 길이와 글자 종류로는 거르지 않는다(위 주석). 뜻이 겹치는 단어는 로더가 앞의 하나만 남긴다(짝 판정 때문).
   */
  function isPlayableWord(word) {
    const text = cleanText(word?.text ?? word);
    const mean = cleanText(word?.mean ?? word?.meaning ?? "");
    if (!text) return false;
    if (word && typeof word === "object" && !mean) return false;
    return true;
  }

  // 단어 하나를 가리키는 열쇠. 게임마다 wordId 를 새로 매기므로 게임을 넘어 같은 단어를 알아볼 때는 이것을 쓴다.
  function wordKey(word) {
    return `${cleanText(word?.text)}\n${cleanText(word?.mean ?? word?.meaning)}`;
  }

  function shuffle(list, random) {
    const pool = list.slice();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool;
  }

  // n번째 판(0부터)의 카드 색. 초록, 노랑, 초록, 노랑…
  function themeAt(boardIndex) {
    const index = Math.max(0, Math.trunc(Number(boardIndex) || 0));
    return THEMES[index % THEMES.length];
  }

  // n번째 판(0부터)의 격자. 첫 판만 3x2, 그다음부터는 계속 4x3.
  function layoutAt(boardIndex) {
    const index = Math.max(0, Math.trunc(Number(boardIndex) || 0));
    return index === 0 ? LAYOUTS.first : LAYOUTS.next;
  }

  function normalizeLayout(value) {
    const columns = Math.trunc(Number(value?.columns));
    const rows = Math.trunc(Number(value?.rows));
    const pairs = Math.trunc(Number(value?.pairs));
    if (columns > 0 && rows > 0 && pairs > 0 && pairs * 2 <= columns * rows) {
      return Object.freeze({ columns, rows, pairs });
    }
    return LAYOUTS.next;
  }

  /*
   * 두 카드가 짝인지. 같은 단어이면서 한쪽은 영어, 한쪽은 뜻이어야 한다.
   * 같은 단어의 같은 면 둘은 짝이 아니다.
   */
  function isPair(a, b) {
    if (!a || !b) return false;
    if (a.cell === b.cell) return false;
    return a.wordId === b.wordId && a.kind !== b.kind;
  }

  /*
   * 단어 뭉치. 판을 새로 깔 때마다 다음 단어를 준다. 다 쓰면 다시 섞어 이어 가되,
   * 한 판 안에서는 같은 단어가 두 번 나오지 않는다.
   */
  function createDeck(options) {
    const settings = options && typeof options === "object" ? options : {};
    const random = typeof settings.random === "function" ? settings.random : Math.random;
    const source = Array.isArray(settings.words) ? settings.words : [];
    const playable = source.filter(isPlayableWord).map((word, position) => Object.freeze({
      wordId: `w${position}`,
      text: cleanText(word.text),
      mean: cleanText(word.mean ?? word.meaning),
      soundUrl: cleanText(word.soundUrl ?? word.sound_url),
    }));
    if (playable.length === 0) {
      throw new Error("카드에 올릴 수 있는 단어가 없습니다.");
    }

    let queue = shuffle(playable, random);

    /*
     * avoid(단어 열쇠 wordKey 목록)에 든 단어는 이번 뽑기에서 뒤로 미룬다 — 2차 수정 "다시 시작" 규칙(createGame 주석).
     * 뺄 수 있는 만큼 빼고, 모자라는 자리만 미룬 단어로 채운다. 미룬 단어도 섞인 차례 그대로라 무작위다.
     */
    function draw(count, avoid) {
      const wanted = Math.max(0, Math.trunc(Number(count) || 0));
      const avoided = new Set(avoid || []);
      if (avoided.size > 0) {
        queue = [
          ...queue.filter((word) => !avoided.has(wordKey(word))),
          ...queue.filter((word) => avoided.has(wordKey(word))),
        ];
      }
      const picked = [];
      while (picked.length < wanted) {
        if (queue.length === 0) {
          // 다 썼으면 다시 섞는다. 이번 판에 이미 뽑은 단어는 다음 뭉치에서 건너뛴다.
          const taken = new Set(picked.map((word) => word.wordId));
          queue = shuffle(playable, random).filter((word) => !taken.has(word.wordId));
          if (queue.length === 0) break;
        }
        picked.push(queue.shift());
      }
      // 미룬 단어는 이번 뽑기에서만 뒤로 간다 — 남은 뭉치는 다시 섞어 둘째 판부터는 거르지 않는다(반박 검토가 찾음:
      // 그대로 두면 미룬 단어가 뭉치 끝에 머물러 둘째 판에도 나오지 않았다).
      if (avoided.size > 0) queue = shuffle(queue, random);
      return picked;
    }

    return Object.freeze({
      draw,
      get size() {
        return playable.length;
      },
      get remaining() {
        return queue.length;
      },
    });
  }

  /*
   * 판 하나. layout 의 격자(첫 판 3x2 = 3쌍, 그다음 4x3 = 6쌍)에 짝(영어+뜻)을 섞어
   * 깐다. 단어가 모자라면 있는 만큼만 깔고 남는 칸은 비운다. theme 은 카드 그림 색
   * (green / yellow)이다.
   */
  function createBoard(options) {
    const settings = options && typeof options === "object" ? options : {};
    const random = typeof settings.random === "function" ? settings.random : Math.random;
    const theme = THEMES.includes(settings.theme) ? settings.theme : THEMES[0];
    const layout = normalizeLayout(settings.layout);
    const cellCount = layout.columns * layout.rows;
    const words = Array.isArray(settings.words) ? settings.words : [];
    if (words.length === 0) {
      throw new Error("판에 깔 단어가 없습니다.");
    }

    const pairWords = words.slice(0, layout.pairs);

    const cards = [];
    let cardSequence = 0;
    function makeCard(word, kind) {
      cardSequence += 1;
      return {
        cardId: `c${cardSequence}`,
        wordId: word.wordId,
        kind,
        text: kind === "en" ? word.text : word.mean,
        english: word.text,
        meaning: word.mean,
        soundUrl: word.soundUrl,
      };
    }
    pairWords.forEach((word) => {
      cards.push(makeCard(word, "en"), makeCard(word, "ko"));
    });

    const placed = shuffle(cards, random);
    const cells = Array.from({ length: cellCount }, (_, index) => ({
      index,
      row: Math.floor(index / layout.columns),
      column: index % layout.columns,
      card: placed[index] ? { ...placed[index], cell: index } : null,
    }));

    let selection = null;
    let matched = 0;

    function cardView(card) {
      return card ? { ...card } : null;
    }

    function state() {
      return {
        layout: { ...layout },
        theme,
        cells: cells.map((cell) => ({
          index: cell.index,
          row: cell.row,
          column: cell.column,
          card: cardView(cell.card),
        })),
        selection: cardView(selection),
        pairs: pairWords.length,
        matched,
        remainingPairs: pairWords.length - matched,
        onBoard: cells.filter((cell) => cell.card).length,
        cleared: matched >= pairWords.length,
      };
    }

    function cellAt(index) {
      return cells[Math.trunc(Number(index))] || null;
    }

    function clearSelection() {
      selection = null;
    }

    /*
     * 카드 하나를 고른다.
     *  - 처음 고르면 selected
     *  - 같은 카드를 다시 고르면 deselected
     *  - 짝이면 match, 두 카드를 치운다
     *  - 짝이 아니면 miss, 고른 것을 풀어 준다
     */
    function select(index) {
      const cell = cellAt(index);
      if (!cell || !cell.card) {
        return { status: "ignored", reason: "empty_cell" };
      }
      const picked = cell.card;
      if (!selection) {
        selection = picked;
        return { status: "selected", selection: cardView(picked) };
      }
      if (selection.cell === picked.cell) {
        clearSelection();
        return { status: "deselected", selection: cardView(picked) };
      }
      const first = selection;
      clearSelection();
      if (isPair(first, picked)) {
        const cleared = [first.cell, picked.cell];
        cleared.forEach((cellIndex) => {
          const target = cellAt(cellIndex);
          if (target) target.card = null;
        });
        matched += 1;
        const english = first.kind === "en" ? first : picked;
        const korean = first.kind === "en" ? picked : first;
        return {
          status: "match",
          cleared,
          pair: [cardView(first), cardView(picked)],
          englishCell: english.cell,
          koreanCell: korean.cell,
          english: first.english,
          meaning: first.meaning,
          soundUrl: first.soundUrl,
          boardCleared: matched >= pairWords.length,
        };
      }
      // 오답 집계는 고른 쪽 가운데 영어 카드를 기준으로 남긴다. 둘 다 뜻이면 첫 카드다.
      const reference = first.kind === "en" ? first : picked.kind === "en" ? picked : first;
      return {
        status: "miss",
        pair: [cardView(first), cardView(picked)],
        english: reference.english,
        meaning: reference.meaning,
        soundUrl: reference.soundUrl,
      };
    }

    return Object.freeze({
      layout,
      theme,
      state,
      select,
      clearSelection,
      get pairs() {
        return pairWords.length;
      },
    });
  }

  /*
   * 게임 한 판의 진행. 첫 판은 3x2, 그다음부터 4x3 판을 깔고, 짝을 다 맞히면 시간이
   * 끝날 때까지 새 판을 계속 깐다. 카드 색은 판마다 초록 → 노랑 순으로 번갈아 든다.
   * 단어는 deck 에서 이어서 뽑는다.
   */
  /*
   * 한 게임. 2차 수정(사장님 2026-10-01 여쭐 것 답 "1. ㄱ", 세부 답 "(가)"): 다시 시작할 때(Try Again · 결과 X → Start ·
   * 게임 중 X → Start) 직전 게임 마지막 판에 깔렸던 단어(맞혀서 사라진 짝 포함)를 새 게임 첫 판에 넣지 않는다.
   * settings.avoid 가 그 단어들의 열쇠(wordKey)다. 단어가 모자라 다 뺄 수 없으면(예: 단어 6~8개에 12장 판으로 끝남)
   * 뺄 수 있는 만큼 빼고 모자라는 자리만 그 단어 가운데 무작위로 채운다 — 판은 늘 열린다. 둘째 판부터는 거르지 않는다.
   */
  function createGame(options) {
    const settings = options && typeof options === "object" ? options : {};
    const random = typeof settings.random === "function" ? settings.random : Math.random;
    const deck = createDeck({ words: settings.words, random });
    const avoidOnFirstBoard = Array.isArray(settings.avoid) ? settings.avoid.slice() : [];

    let board = null;
    let boardsDealt = 0;
    let boardWords = [];
    // 지금까지 판에 깔린 짝의 총수 = "전체 제공 문제수"(리워드 기준의 분모).
    // 단어가 모자라 덜 깔린 판도 있으므로 layout.pairs 가 아니라 실제로 깔린 수를 센다.
    let pairsDealt = 0;

    function nextBoard() {
      const layout = layoutAt(boardsDealt);
      const theme = themeAt(boardsDealt);
      const words = deck.draw(layout.pairs, boardsDealt === 0 ? avoidOnFirstBoard : null);
      board = createBoard({ words, layout, theme, random });
      boardWords = words.slice(0, board.state().pairs);
      boardsDealt += 1;
      pairsDealt += board.state().pairs;
      return board;
    }

    function select(index) {
      if (!board) return { status: "ignored", reason: "no_board" };
      return board.select(index);
    }

    function state() {
      return {
        boardsDealt,
        pairsDealt,
        board: board ? board.state() : null,
        deckSize: deck.size,
      };
    }

    // 지금 판에 깔린 단어의 열쇠 — 맞혀서 사라진 짝도 든다. 다음 게임이 첫 판에서 피할 목록이다.
    function boardWordKeys() {
      return boardWords.map(wordKey);
    }

    return Object.freeze({
      nextBoard,
      select,
      state,
      boardWordKeys,
      get board() {
        return board;
      },
      get boardsDealt() {
        return boardsDealt;
      },
      get pairsDealt() {
        return pairsDealt;
      },
    });
  }

  global.WordMatchCards = Object.freeze({
    LAYOUTS,
    THEMES,
    CARD_WIDTH,
    CARD_HEIGHT,
    MAX_WORD_LENGTH,
    MAX_MEANING_LENGTH,
    isPlayableWord,
    wordKey,
    isPair,
    themeAt,
    layoutAt,
    createDeck,
    createBoard,
    createGame,
  });
})(typeof window !== "undefined" ? window : globalThis);
