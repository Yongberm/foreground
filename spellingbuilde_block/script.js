(function initSpellingBuilderBlock(global) {
  "use strict";

  // ============================================================
  // 순수 로직 (DOM/Canvas 없이 동작 · Node 테스트 대상)
  // ============================================================

  // 기획서(docs/기획서_블록단어_2단계.png) 수치. index.html gameConfig가 덮어쓸 수 있다.
  const RULES = Object.freeze({
    questionCount: 7,    // 총 7문제
    chances: 3,          // 한 문제 기회 3번
    decoyCount: 2,       // 오답 철자 2개를 단어 앞뒤로 붙인다
    letterScore: 50,     // 정답 +50
    missPenalty: 10,     // 오답 -10
    /* 기획서에 "기회 3번"과 "오답 시 기회 2번 차감"이 함께 적혀 있는데, 이 게임의
       오답은 '잘못 드래그' 한 가지뿐이라 2씩 깎으면 2회 만에 소진되어 같은 문서의
       "3회 오답일 경우 강제 전환"과 어긋난다. 두 번 명시된 3회 규칙을 따르고
       차감은 1로 둔다 — 2로 바꾸려면 gameConfig.block.wrongChanceCost 한 줄이다. */
    wrongChanceCost: 1,
    streakLength: 3,     // 3문제 연속 정답마다
    streakBonus: 100,    // 추가 +100
    timerSeconds: 180,   // 타이머 3분
  });

  /* 블록 벽 격자 — 시안(docs/game_preview.png)에서 실측한 1920x1080 좌표다.
     블록 자산이 125x125이고, 벽은 x=272에서 11칸(1375px), y=444에서 4줄이다.
     맨 아랫줄(row 3)은 하단 바(y=881~)에 아래쪽 절반이 가려진다 — 시안 그대로다. */
  const FIELD = Object.freeze({
    cols: 11,
    rows: 4,
    cell: 125,
    originX: 272,
    originY: 444,
  });

  /* 뜻 글자 크기(cqw). 기본은 54px(2.8125cqw)다 — 시안은 64px 였으나 3차 검수표
     r53 "상단 한글 폰트 사이즈 작게" 로 형제 강의실·파이프와 같은 54px 로 줄였다.
     긴 뜻은 흰 상자에 들어갈 때까지 줄이되 32px(1.6667cqw) 아래로는 내리지 않는다.
     styles.css 의 .meaning-text-inner font-size 와 반드시 같은 값이어야 한다. */
  const MEANING_FONT = Object.freeze({ base: 2.8125, min: 1.6667, floor: 0.8333 });
  /* 위 간판(top_pannel.png 588x157)의 흰 안쪽은 y30~135(105px, 화소 실측)다. 위아래 7px 씩 남겨
     91px 안에 글자를 넣는다. 줄을 바꾼 뒤 그래도 넘치는 긴 뜻만 floor(16px)까지 더 줄인다.
     사장님 2026-10-15 "좌우 상,하 패딩이 필요해 보임 2~3px정도": 위아래 여백을 4px → 7px(3px 더)로 — 좌우 3px 는 styles.css .meaning-text 의 padding. */
  const MEANING_BOX = Object.freeze({ panelHeight: 157, innerHeight: 91 });

  const WALL_COLORS = Object.freeze(["b", "g", "p", "y"]);
  const TILE_COLORS = Object.freeze(["b", "g", "r", "y"]);
  /* 검수표 r47: 단어 영역은 회색 하나로 보이고 첫 글자에만 색이 들어간다.
     회색은 전용 자산(block_black.png)이라 text_box_* 규칙에서 벗어난다. */
  const GRAY_TILE = "gray";

  function tileArtUrl(color) {
    return color === GRAY_TILE
      ? "assets/game/block_black.png"
      : `assets/game/text_box_${color}.png`;
  }
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

  function shuffled(list, random) {
    const pool = list.slice();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool;
  }

  function pick(list, random) {
    return list[Math.floor(random() * list.length)];
  }

  /* 오답 철자는 단어에 없는 알파벳에서 뽑는다 — 단어에 있는 글자를 쓰면 정답
     구간 말고도 단어처럼 읽히는 구간이 생겨 정답이 하나로 정해지지 않는다. */
  function pickDecoyLetters(letters, count, random = Math.random) {
    const used = new Set(letters);
    const candidates = [...ALPHABET].filter((letter) => !used.has(letter));
    return shuffled(candidates, random).slice(0, Math.max(0, count));
  }

  /* 한 문제의 철자 줄: 정답 철자를 순서대로 두고 오답 철자 2개를 앞뒤에 붙인다.
     기획서 "오답 1개 / 1개씩 단어 앞 뒤로도 붙일 수 있습니다. 경우의 수 총 3가지"
     -> 앞2·뒤0 / 앞1·뒤1 / 앞0·뒤2 중 하나를 고른다. */
  function buildRun(letters, options = {}) {
    if (!Array.isArray(letters) || letters.length === 0) {
      throw new Error("철자 줄에는 최소 1글자가 필요합니다.");
    }
    const random = options.random || Math.random;
    const decoyCount = Number.isFinite(options.decoyCount) ? options.decoyCount : RULES.decoyCount;
    const decoys = pickDecoyLetters(letters, decoyCount, random);
    const leadCount = decoys.length === 0 ? 0 : Math.floor(random() * (decoys.length + 1));
    const lead = decoys.slice(0, leadCount);
    const tail = decoys.slice(leadCount);
    const tiles = [
      ...lead.map((letter) => ({ letter, isDecoy: true })),
      ...letters.map((letter) => ({ letter, isDecoy: false })),
      ...tail.map((letter) => ({ letter, isDecoy: true })),
    ];
    return {
      tiles,
      startIndex: lead.length,
      endIndex: lead.length + letters.length - 1,
      leadCount: lead.length,
      tailCount: tail.length,
    };
  }

  /* 철자 줄을 격자에 놓는다.
     한 줄에 다 들어가면 왼쪽에서 오른쪽으로 쭉 놓는다.
     두 줄이 필요하면 계단형으로 꺾는다 — 첫 줄 마지막 칸 "바로 아래"에서
     둘째 줄을 시작해 다시 오른쪽으로 간다(→→→↓→→→).
     이렇게 해야 손가락을 떼지 않고 한 번에 드래그할 수 있다.
     (줄 끝에서 아랫줄 왼쪽 끝으로 돌아가면 드래그가 끊긴다.)

         c0        c1
     줄R  a  b  c  d
     줄R+1         e  f  g      <- d 아래 칸에서 이어진다

     꺾이는 칸을 두 줄이 나눠 쓰므로 가로로 length-1 칸이 필요하다. */
  function placeRun(runLength, options = {}) {
    const field = options.field || FIELD;
    const random = options.random || Math.random;
    const length = Math.trunc(runLength);
    if (!Number.isFinite(length) || length < 1) {
      throw new Error("철자 줄 길이가 올바르지 않습니다.");
    }
    // 하단 바에 가려지는 마지막 줄은 쓰지 않는다.
    const usableRows = Math.max(1, field.rows - 1);
    // 정답 줄에는 조각이 들어갈 칸을 최소 하나 남겨 둔다.
    const perRow = field.cols - 1;
    const maxLength = usableRows >= 2 ? field.cols + 1 : perRow;
    if (length > maxLength) {
      throw new Error("철자 줄이 블록 벽보다 깁니다.");
    }

    const wraps = length > perRow;
    const rowSpan = wraps ? 2 : 1;
    /* 정답 줄 위에는 테트로미노가 들어설 자리가 있어야 하므로 맨 윗줄(0)은
       정답 줄로 쓰지 않는다. */
    const minStartRow = Math.min(1, Math.max(0, usableRows - rowSpan));
    const maxStartRow = Math.max(minStartRow, usableRows - rowSpan);
    const startRow = minStartRow
      + Math.floor(random() * (maxStartRow - minStartRow + 1));

    if (!wraps) {
      const startCol = Math.floor(random() * (field.cols - length + 1));
      return Array.from({ length }, (_, index) => ({ row: startRow, col: startCol + index }));
    }

    // 계단은 가로로 length-1 칸을 쓴다.
    const span = length - 1;
    const startCol = Math.floor(random() * (field.cols - span + 1));
    /* 첫 줄에 몇 글자를 둘지. 양쪽 줄에 최소 한 글자씩 두고, 정답 줄(첫 줄)에
       조각 자리를 남기도록 field.cols - 1 을 넘지 않게 한다. */
    const maxFirst = Math.min(length - 1, field.cols - 1, field.cols - startCol);
    const minFirst = Math.max(1, length - (field.cols - startCol));
    const firstCount = minFirst + Math.floor(random() * (maxFirst - minFirst + 1));
    const turnCol = startCol + firstCount - 1;

    const cells = [];
    for (let index = 0; index < firstCount; index += 1) {
      cells.push({ row: startRow, col: startCol + index });
    }
    // 둘째 줄은 꺾이는 칸 바로 아래에서 시작해 오른쪽으로 이어진다.
    for (let index = 0; index < length - firstCount; index += 1) {
      cells.push({ row: startRow + 1, col: turnCol + index });
    }
    return cells;
  }

  /* ---- 표준 테트로미노 7종 ----
     실제 테트리스와 같은 조각만 쓴다(I·O·T·S·Z·J·L). 칸은 [행, 열] 오프셋이며
     행 우선으로 정렬해 두어 첫 칸이 왼쪽 위 기준점이 된다.
     색은 테트리스 가이드라인 색(I 하늘 · O 노랑 · T 보라 · S 초록 · Z 빨강 ·
     J 파랑 · L 주황)을 이 게임이 가진 네 가지 블록 자산에 가장 가깝게 맞춘 것이다. */
  const TETROMINOES = Object.freeze({
    I: Object.freeze({ color: "b", rotations: Object.freeze([
      Object.freeze([[0, 0], [0, 1], [0, 2], [0, 3]]),
      Object.freeze([[0, 0], [1, 0], [2, 0], [3, 0]]),
    ]) }),
    O: Object.freeze({ color: "y", rotations: Object.freeze([
      Object.freeze([[0, 0], [0, 1], [1, 0], [1, 1]]),
    ]) }),
    T: Object.freeze({ color: "p", rotations: Object.freeze([
      Object.freeze([[0, 1], [1, 0], [1, 1], [1, 2]]),
      Object.freeze([[0, 0], [1, 0], [1, 1], [2, 0]]),
      Object.freeze([[0, 0], [0, 1], [0, 2], [1, 1]]),
      Object.freeze([[0, 1], [1, 0], [1, 1], [2, 1]]),
    ]) }),
    S: Object.freeze({ color: "g", rotations: Object.freeze([
      Object.freeze([[0, 1], [0, 2], [1, 0], [1, 1]]),
      Object.freeze([[0, 0], [1, 0], [1, 1], [2, 1]]),
    ]) }),
    Z: Object.freeze({ color: "p", rotations: Object.freeze([
      Object.freeze([[0, 0], [0, 1], [1, 1], [1, 2]]),
      Object.freeze([[0, 1], [1, 0], [1, 1], [2, 0]]),
    ]) }),
    J: Object.freeze({ color: "b", rotations: Object.freeze([
      Object.freeze([[0, 0], [1, 0], [1, 1], [1, 2]]),
      Object.freeze([[0, 0], [0, 1], [1, 0], [2, 0]]),
      Object.freeze([[0, 0], [0, 1], [0, 2], [1, 2]]),
      Object.freeze([[0, 1], [1, 1], [2, 0], [2, 1]]),
    ]) }),
    L: Object.freeze({ color: "y", rotations: Object.freeze([
      Object.freeze([[0, 2], [1, 0], [1, 1], [1, 2]]),
      Object.freeze([[0, 0], [1, 0], [2, 0], [2, 1]]),
      Object.freeze([[0, 0], [0, 1], [0, 2], [1, 0]]),
      Object.freeze([[0, 0], [0, 1], [1, 1], [2, 1]]),
    ]) }),
  });

  // 회전 상태를 하나씩 펼친 목록 — 벽 타일링과 낙하 조각이 함께 쓴다.
  const PIECE_SHAPES = Object.freeze(
    Object.entries(TETROMINOES).flatMap(([type, piece]) => piece.rotations.map((cells, rotation) => {
      const rows = cells.map(([row]) => row);
      const cols = cells.map(([, col]) => col);
      const height = Math.max(...rows) + 1;
      const width = Math.max(...cols) + 1;
      const bottom = cells.filter(([row]) => row === height - 1).map(([, col]) => col).sort((a, b) => a - b);
      return Object.freeze({
        type,
        rotation,
        color: piece.color,
        cells: Object.freeze(cells.map((cell) => Object.freeze([...cell]))),
        height,
        width,
        // 바닥에 닿는 칸들. 이 폭이 벽에 뚫어 둘 빈 칸의 폭이 된다.
        bottomCols: Object.freeze(bottom),
        bottomFrom: bottom[0],
        bottomWidth: bottom.length,
      });
    })),
  );

  const MAX_PIECE_WIDTH = 4;

  // 이어진 빈 열 구간들
  function freeSpans(field, takenCols) {
    const spans = [];
    let from = -1;
    for (let col = 0; col <= field.cols; col += 1) {
      const free = col < field.cols && !takenCols.has(col);
      if (free && from < 0) from = col;
      else if (!free && from >= 0) { spans.push([from, col - 1]); from = -1; }
    }
    return spans;
  }

  /* 정답 줄에 뚫어 둘 빈 칸과, 거기에 딱 맞게 떨어질 테트로미노를 함께 고른다.
     조건: 조각의 바닥 칸들이 빈 칸과 정확히 겹치고, 조각 전체가 벽 안에 들어오며,
     정답 줄 위로 조각이 들어설 자리(높이)가 남아 있어야 한다. */
  function pickPiecePlacement(field, answerRow, takenCols, random) {
    const candidates = [];
    freeSpans(field, takenCols).forEach(([from, to]) => {
      const span = to - from + 1;
      PIECE_SHAPES.forEach((shape) => {
        if (shape.bottomWidth > Math.min(MAX_PIECE_WIDTH, span)) return;
        // 조각이 정답 줄 위로 들어설 높이가 있어야 한다.
        if (shape.height - 1 > answerRow) return;
        // 바닥 칸이 빈 구간 안에 들어오도록 조각의 왼쪽 열을 정한다.
        for (let left = 0; left + shape.width <= field.cols; left += 1) {
          const bottomStart = left + shape.bottomFrom;
          if (bottomStart < from || bottomStart + shape.bottomWidth - 1 > to) continue;
          candidates.push({ shape, left, bottomStart });
        }
      });
    });
    if (candidates.length === 0) {
      throw new Error("정답 줄에 맞는 테트로미노 자리가 없습니다.");
    }
    const chosen = candidates[Math.floor(random() * candidates.length)];
    return {
      type: chosen.shape.type,
      rotation: chosen.shape.rotation,
      color: chosen.shape.color,
      cells: chosen.shape.cells,
      height: chosen.shape.height,
      width: chosen.shape.width,
      // 착지했을 때 조각의 왼쪽 위 칸이 놓이는 자리
      row: answerRow - (chosen.shape.height - 1),
      col: chosen.left,
      // 정답 줄에서 이 조각이 메울 칸
      gap: { row: answerRow, col: chosen.bottomStart, width: chosen.shape.bottomWidth },
    };
  }

  /* 테트로미노가 들어가지 않는 자투리를 메울 작은 모양들(트로미노·도미노·한 칸).
     벽의 실루엣이 늘 4의 배수는 아니라서 마지막에 이것들이 필요하다. */
  const FILLER_SHAPES = Object.freeze([
    Object.freeze([[0, 0], [0, 1], [0, 2]]),
    Object.freeze([[0, 0], [1, 0], [2, 0]]),
    Object.freeze([[0, 0], [0, 1], [1, 0]]),
    Object.freeze([[0, 0], [0, 1], [1, 1]]),
    Object.freeze([[0, 0], [1, 0], [1, 1]]),
    Object.freeze([[0, 1], [1, 0], [1, 1]]),
    Object.freeze([[0, 0], [0, 1]]),
    Object.freeze([[0, 0], [1, 0]]),
    Object.freeze([[0, 0]]),
  ]);

  /* 벽의 블록을 테트로미노 모양으로 묶어 색을 입힌다.
     행 우선으로 훑으며 아직 색이 없는 칸을 조각의 왼쪽 위로 삼아 놓아 보고,
     테트로미노가 안 들어가면 자투리 모양으로 메운다.
     색은 그 조각의 규격 색을 쓰되, 옆에 같은 색이 이미 있으면 다른 색으로
     바꾼다 — 그래야 조각과 조각의 경계가 눈에 보인다. */
  function tileWithPieces(occupied, field, random) {
    const colors = new Map();
    const neighbourColors = (cellKeys) => {
      const around = new Set();
      cellKeys.forEach((key) => {
        const [row, col] = key.split(":").map(Number);
        [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]].forEach(([r, c]) => {
          const near = `${r}:${c}`;
          if (!cellKeys.includes(near) && colors.has(near)) around.add(colors.get(near));
        });
      });
      return around;
    };
    const colorFor = (preferred, cellKeys) => {
      const around = neighbourColors(cellKeys);
      if (!around.has(preferred)) return preferred;
      const free = WALL_COLORS.filter((color) => !around.has(color));
      return free.length > 0 ? free[Math.floor(random() * free.length)] : preferred;
    };

    for (let row = 0; row < field.rows; row += 1) {
      for (let col = 0; col < field.cols; col += 1) {
        const key = `${row}:${col}`;
        if (!occupied.has(key) || colors.has(key)) continue;
        const tetrominoes = shuffled(PIECE_SHAPES, random)
          .map((shape) => ({ cells: shape.cells, color: shape.color }));
        const fillers = FILLER_SHAPES.map((cells) => ({ cells, color: pick(WALL_COLORS, random) }));
        let placed = false;
        for (const shape of [...tetrominoes, ...fillers]) {
          const [anchorRow, anchorCol] = shape.cells[0];
          const target = shape.cells.map(([dr, dc]) => `${row + dr - anchorRow}:${col + dc - anchorCol}`);
          if (!target.every((cell) => occupied.has(cell) && !colors.has(cell))) continue;
          const color = colorFor(shape.color, target);
          target.forEach((cell) => colors.set(cell, color));
          placed = true;
          break;
        }
        if (!placed) colors.set(key, colorFor(pick(WALL_COLORS, random), [key]));
      }
    }
    return colors;
  }

  /* 벽 채우기 + 떨어질 조각 정하기.
     정답 줄에는 조각의 바닥 모양만큼 빈 칸을 두고, 조각이 지나갈 열은 그 위를
     모두 비워 실제로 떨어져 들어올 수 있게 한다. */
  /* options.accentIndex — 정답 첫 글자의 runIndex. 그 칸만 색 타일이고
     나머지 철자는 전부 회색이다(검수표 r47). 넘기지 않으면 0번 칸을 쓴다. */
  function buildWall(cells, options = {}) {
    const field = options.field || FIELD;
    const random = options.random || Math.random;
    const accentIndex = Number.isInteger(options.accentIndex) ? options.accentIndex : 0;
    // 색은 문제마다 새로 뽑는다 — 검수표 "색은 자유롭게 랜덤으로".
    const accentColor = pick(TILE_COLORS, random);
    const letterAt = new Map(cells.map((cell, index) => [`${cell.row}:${cell.col}`, index]));
    /* 조각이 들어갈 빈 칸은 철자가 시작하는 줄에 뚫는다.
       단어가 아랫줄까지 이어지면 그 줄도 정답 줄이다 — 정답을 맞혔을 때
       걸친 줄을 모두 지워야 철자가 남지 않는다. */
    const answerRows = [...new Set(cells.map((cell) => cell.row))].sort((a, b) => a - b);
    const answerRow = answerRows[0];
    const taken = new Set(
      cells.filter((cell) => cell.row === answerRow).map((cell) => cell.col),
    );
    const piece = pickPiecePlacement(field, answerRow, taken, random);
    const gapCols = new Set(
      Array.from({ length: piece.gap.width }, (_, index) => piece.gap.col + index),
    );
    // 조각이 차지할 열은 정답 줄 위쪽을 통째로 비워 둔다(S·Z처럼 옆으로 삐져나오는
    // 조각도 걸리지 않게 한다).
    const laneCols = new Set(
      Array.from({ length: piece.width }, (_, index) => piece.col + index),
    );

    const filled = [];
    for (let row = 0; row < field.rows; row += 1) filled.push(new Array(field.cols).fill(false));
    for (let col = 0; col < field.cols; col += 1) {
      let top;
      if (gapCols.has(col)) {
        top = answerRow + 1;            // 조각이 내려앉을 자리
      } else if (laneCols.has(col)) {
        top = answerRow;                // 통로만 비우고 정답 줄부터는 채운다
      } else {
        let letterTop = field.rows;
        for (let row = 0; row < field.rows; row += 1) {
          if (letterAt.has(`${row}:${col}`)) { letterTop = row; break; }
        }
        // 시안처럼 정답 줄 위로 0~2칸 더 쌓아 윗면을 들쭉날쭉하게 만든다.
        const extra = Math.floor(random() * 3);
        top = Math.min(letterTop, Math.max(0, answerRow - extra));
      }
      for (let row = top; row < field.rows; row += 1) filled[row][col] = true;
    }

    const occupied = new Set();
    for (let row = 0; row < field.rows; row += 1) {
      for (let col = 0; col < field.cols; col += 1) {
        if (filled[row][col] && !letterAt.has(`${row}:${col}`)) occupied.add(`${row}:${col}`);
      }
    }
    const colors = tileWithPieces(occupied, field, random);

    const grid = Array.from({ length: field.rows }, () => new Array(field.cols).fill(null));
    for (let row = 0; row < field.rows; row += 1) {
      for (let col = 0; col < field.cols; col += 1) {
        if (!filled[row][col]) continue;
        const key = `${row}:${col}`;
        if (letterAt.has(key)) {
          const runIndex = letterAt.get(key);
          grid[row][col] = {
            kind: "letter",
            runIndex,
            color: runIndex === accentIndex ? accentColor : GRAY_TILE,
          };
        } else {
          grid[row][col] = { kind: "block", color: colors.get(key) || pick(WALL_COLORS, random) };
        }
      }
    }
    return { grid, piece, answerRow, answerRows, accentColor };
  }

  /* ---- 테트리스 규칙 ---- */

  // 조각(칸 오프셋 목록)이 left 열에서 떨어질 때 멈추는 원점 행. 자리가 없으면 -1.
  function landingRow(grid, pieceCells, left, options = {}) {
    const field = options.field || FIELD;
    const fits = (row) => pieceCells.every(([dr, dc]) => {
      const r = row + dr;
      const c = left + dc;
      if (c < 0 || c >= field.cols) return false;
      if (r >= field.rows) return false;
      return r < 0 || !grid[r][c];
    });
    if (!fits(-(Math.max(...pieceCells.map(([r]) => r)) + 1))) return -1;
    let landing = -1;
    for (let row = -field.rows; row < field.rows; row += 1) {
      if (fits(row)) landing = row;
      else if (landing > -field.rows) break;
    }
    return landing;
  }

  // 빈 칸 하나 없이 꽉 찬 줄
  function fullRows(grid, options = {}) {
    const field = options.field || FIELD;
    const rows = [];
    for (let row = 0; row < field.rows; row += 1) {
      if (grid[row].every(Boolean)) rows.push(row);
    }
    return rows;
  }

  /* 줄을 지우고 위를 한 칸씩 내린다.
     moves는 화면에서 셀을 옮기기 위한 (이전 줄 -> 새 줄) 목록이다. */
  function collapseRows(grid, clearedRows, options = {}) {
    const field = options.field || FIELD;
    const cleared = new Set(clearedRows);
    const next = Array.from({ length: field.rows }, () => new Array(field.cols).fill(null));
    const moves = [];
    let write = field.rows - 1;
    for (let row = field.rows - 1; row >= 0; row -= 1) {
      if (cleared.has(row)) continue;
      if (write !== row) moves.push({ from: row, to: write });
      next[write] = grid[row].slice();
      write -= 1;
    }
    return { grid: next, moves };
  }

  /* 한 문제의 판정 상태 머신.
     - 정답 구간(단어와 정확히 같은 연속 구간)을 드래그하면 완료.
     - 그 밖의 구간이면 오답: 점수 -10, 기회 차감.
     - 기회를 다 쓰면 실패(failed) — 정답 노출 후 다음 문제로 강제 전환. */
  function createQuestionRun(run, rules = RULES) {
    const word = run.tiles
      .slice(run.startIndex, run.endIndex + 1)
      .map((tile) => tile.letter)
      .join("");
    let missCount = 0;
    let failed = false;
    let completed = false;
    return {
      get word() { return word; },
      get missCount() { return missCount; },
      get failed() { return failed; },
      get completed() { return completed; },
      chancesLeft() { return Math.max(0, rules.chances - missCount); },
      select(fromIndex, toIndex) {
        if (failed || completed) return { type: "ignored" };
        const from = Math.min(fromIndex, toIndex);
        const to = Math.max(fromIndex, toIndex);
        /* 한 칸만 고른 것은 드래그가 아니라 스쳐 지나간 터치다. 두 글자 이상인
           단어에서는 정답이 될 수 없으므로 기회를 깎지 않고 흘려보낸다 —
           그러지 않으면 손가락이 살짝 닿기만 해도 기회가 사라진다. */
        if (from === to && word.length > 1) return { type: "ignored" };
        if (from === run.startIndex && to === run.endIndex) {
          completed = true;
          return { type: "correct", from, to };
        }
        missCount += rules.wrongChanceCost;
        failed = missCount >= rules.chances;
        return {
          type: "wrong",
          from,
          to,
          chancesLeft: Math.max(0, rules.chances - missCount),
          failed,
        };
      },
    };
  }

  // 점수판: 정답 +50, 오답 -10(0점 하한 없음 — 4차 q61),
  // 3문제 연속 정답마다 +100 보너스. 한 번이라도 틀리면 연속이 끊긴다.
  function createScoreboard(rules = RULES) {
    let score = 0;
    let streak = 0;
    let bonusTotal = 0;
    return {
      get score() { return score; },
      get streak() { return streak; },
      get bonusTotal() { return bonusTotal; },
      miss() {
        /* 4차 검수 q61: 0점에서 오답이어도 마이너스로 내려가야 한다.
           예전에는 Math.max(0, ...) 로 0에서 멈춰, 0점 상태의 오답이
           화면에 아무 변화도 남기지 않았다. */
        score -= rules.missPenalty;
        /* 사장님 답(2026-10-02, "콤보,보너스, 효과 OX 확인해서 동일한 스펙으로 적용" 중
           '오답과 콤보' = "OX처럼 한 번 틀리면 끊김"): 기회가 남아 있어도 오답 한 번에 연속이 0 이다.
           예전에는 기회 3번을 다 써서 단어를 놓칠 때(wordFail)만 끊겼다. */
        streak = 0;
        return score;
      },
      wordComplete() {
        score += rules.letterScore;
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

  /* 공통 10항(사장님 지시 2026-09-29): 점수는 1000 이 아니라 1,000 으로 적는다.
     점수를 찍는 곳은 모두 이 함수를 거친다 — 자리마다 따로 쓰면 한 곳이 빠진다.

     "en-US" 를 못박는다: 빼면 브라우저 지역 설정에 따라 구분자가 달라진다.
     Math.round 를 쓴다: 점수 굴림 연출이 소수 중간값으로 이 함수를 부르므로,
     trunc 로 자르면 숫자가 한 칸 늦게 따라오고 마이너스 구간에서 0 쪽으로 당겨진다.
     0 으로 눕히는 줄은 함정목록 9번 — Math.round(-0.4) 는 -0 이고
     (-0).toLocaleString() 은 "-0" 이라, q61 로 0점 하한을 없앤 뒤
     마이너스에서 0 으로 굴러 올라오는 한순간 Score 칸에 -0 이 보인다.
     개수(Correct·Incorrect)·타이머·문항 번호는 이 함수를 쓰지 않는다. */
  function formatScore(value) {
    const rounded = Math.round(Number(value) || 0);
    return (rounded === 0 ? 0 : rounded).toLocaleString("en-US");
  }

  /* ---- 리워드 등급 ----
     사장님 지시(2026-09-29) · 공통_적용.md 5항:
       Try again — 70% 미만 정답 (전체 제공 문제수 기준)
       Good      — 70% 이상 100% 미만
       Excellent — 100%
     "정확히 70% 는 Good" 은 사장님 확인을 받은 값이다(2026-09-29).
     기준이 바뀌면 아래 상수 한 줄만 고치면 된다. */
  const GRADE_GOOD_MIN = 0.7;

  /* 등급마다 딸린 제목 그림·대체 글자·효과음. 세 가지를 각각 판정하면
     그림과 소리가 어긋날 수 있어 한 표에 묶어 둔다.
     result_text0=Excellent, 1=Good, 2=Try Again (검수표 r10 — 대문자 A 교체본) */
  /* 공통 9항 7번: script.js 가 조립하는 그림 주소에도 캐시 버전을 단다.
     index.html 의 <script src="script.js?v=..."> 와 같은 값이어야 한다 — 테스트가 붙든다.
     이걸 빼먹으면 3차 r10 으로 바꾼 result_text2.png 가 옛 그림 그대로 내려간다. */
  const ASSET_VERSION = "20261015-2";

  /* 등급별 여우는 2026-09-30 에 새로 들어온 그림이라 자기 차수를 쓴다.
     index.html 의 <img id="result-fox" ...?v=...> 와 같은 값이어야 한다 — 테스트가 붙든다. */
  const FOX_VERSION = "20260930-1";

  const GRADE_ART = Object.freeze({
    /* particles: 2차 수정 공통 2절 · PDF 2쪽 1번 — Try Again 은 파티클 없음, Good · Excellent 만. */
    excellent: Object.freeze({ image: "result_text0", alt: "Excellent", sound: "cheer", fox: "excellent", particles: true }),
    good: Object.freeze({ image: "result_text1", alt: "Good", sound: "stamp", fox: "good", particles: true }),
    tryAgain: Object.freeze({ image: "result_text2", alt: "Try Again", sound: "fail", fox: "try_again", particles: false }),
  });

  /* 분모는 전체 제공 문제수다 — 시간이 끝나 손도 못 댄 문제까지 들어간다.
     createGameFlow 의 total 은 판이 시작할 때 정해지고 줄지 않으므로 그대로 쓴다. */
  function gradeOf(tally) {
    /* tally 가 없을 때만 막으면 된다. 값이 NaN 이나 음수여도 아래 두 비교가
       모두 거짓이라 tryAgain 으로 떨어진다 — 따로 다듬어도 결과가 같아 두지 않았다. */
    const total = tally && tally.total > 0 ? tally.total : 0;
    const ratio = total > 0 ? tally.correct / total : 0;
    if (ratio >= 1) return "excellent";
    if (ratio >= GRADE_GOOD_MIN) return "good";
    return "tryAgain";
  }

  /* 닫기 이동 후보가 이 페이지와 같은 자리인지 본다. 아니면 null.

     origin 하나만 견주면 안 된다. 다만 **엔진마다 값이 다르다** — file 기준에서
     node 는 origin 을 문자열 "null" 로, 브라우저(Blink)는 "file://" 로 준다. 둘 다 직접 쟀다.

       후보                    node origin만   브라우저 origin만   넷을 보면
       //evil.example/x          통과            통과              차단  ← host 가 막는다
       file://evil.example/x     통과            통과              차단  ← host 가 막는다
       javascript: · data:       통과            차단              차단
       https://evil.example      차단            차단              차단

     곧 **브라우저에서 실제로 뚫리는 것은 위 둘**이고 host 검사가 막는다.
     막지 않는 것도 적어 둔다 — file:///etc/passwd 처럼 같은 스킴·같은 host 의
     다른 경로는 통과한다. 여기서 막는 것은 "다른 자리로 데려가는 것"까지다. */
  const CLOSE_SCHEMES = Object.freeze(["http:", "https:", "file:"]);

  function sameOriginTarget(value, baseHref) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    let base;
    let url;
    try {
      base = new URL(String(baseHref));
      url = new URL(raw, base);
    } catch { return null; }
    if (url.origin !== base.origin) return null;
    if (url.protocol !== base.protocol) return null;
    if (url.host !== base.host) return null;
    if (!CLOSE_SCHEMES.includes(url.protocol)) return null;
    return url.href;
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

  /* 콤보 표시 단계 = 이번 주기에서 켜 둘 블록 수(0·1·2).
     3연속을 채우면 보너스가 터지고 표시는 0으로 돌아간다.
     보너스가 "터지는 순간"은 상태가 아니라 사건이라 renderCombo 의 burst 가 따로 맡는다.
     여기서 streakLength를 돌려주면 다음 문제를 불러올 때마다 updateStreak가
     그 값을 다시 칠해 보너스 표시가 영영 꺼지지 않는다. */
  function streakStep(streak, length = RULES.streakLength) {
    const total = Math.max(0, Math.trunc(streak) || 0);
    if (length <= 0) return 0;
    return total % length;
  }

  /* 무대 좌표(1920x1080 기준)를 블록 벽의 칸으로 바꾼다.
     벽 밖이면 null 을 돌려준다.
     화면에서 요소를 집어(elementFromPoint) 찾지 않는 이유: 선택된 칸은
     위로 떠오르는 연출(translateY)이 걸려 있어 원래 자리의 아래쪽이
     비어 버린다 — 그 띠에서는 손가락이 칸 위에 있어도 못 찾는다.
     좌표로 계산하면 연출과 무관하게 늘 같은 자리를 가리킨다. */
  function cellFromPoint(stageX, stageY, field = FIELD) {
    if (!Number.isFinite(stageX) || !Number.isFinite(stageY)) return null;
    const col = Math.floor((stageX - field.originX) / field.cell);
    const row = Math.floor((stageY - field.originY) / field.cell);
    if (col < 0 || col >= field.cols) return null;
    if (row < 0 || row >= field.rows) return null;
    return { row, col };
  }

  /* 뜻 글자가 흰 상자를 넘으면 들어갈 만큼 줄인다.
     measured = 지금 크기로 잰 글자 폭, available = 상자 안쪽 폭(같은 단위).
     최소 크기 아래로는 내리지 않는다 — 그보다 작아지면 읽을 수 없다. */
  function fitFontSize(measured, available, base, min) {
    if (!(measured > 0) || !(available > 0) || !(base > 0)) return base;
    if (measured <= available) return base;
    return Math.max(min, base * (available / measured));
  }

  /* 최소 크기로도 한 줄에 안 들어가는 뜻이 있다. 그때는 글자를 더 줄이는 대신
     두 줄로 접는다 — 하한 아래로 내리면 읽을 수 없고, 접지 않으면 상자를 넘는다.
     ⚠ 2차 수정으로 뜻 12자 거름을 걷어 아주 긴 뜻(검수 API 최장 87자)이 들어온다. 그런 뜻은 두 줄로
       모자라 서너 줄이 되므로, 줄을 바꾼 뒤에도 흰 안쪽 높이를 넘으면 fitMeaningText 가 더 줄인다
       (예전 주석의 "두 줄이면 넉넉" 가정은 12자 거름이 있을 때만 맞았다). */
  function meaningNeedsWrap(measured, available, base, min) {
    if (!(measured > 0) || !(available > 0) || !(base > 0)) return false;
    return measured * (min / base) > available;
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Math.trunc(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  /* 2차 수정(PDF 3쪽 "정답 단어 팝업 첫글자 소문자로", 부모 원장 4b397d52067d0ca2 6번):
     정답 팝업·오답노트의 영어 단어는 **API 가 준 그대로** 쓴다. 첫 글자를 대문자로 바꾸지 않는다
     — 예전 형제 공통 "시작은 대문자" 규칙을 이 방에서 걷었다. 소문자로 강제하지도 않는다
     (API 가 "No thanks." 처럼 대문자를 주면 그대로다). 블록 위 철자는 시안대로 소문자다.
     question 을 주면 API 원문(english)을, 철자 배열을 주면 이어 붙인 그대로를 돌려준다. */
  function displayWord(source) {
    if (source && typeof source === "object" && !Array.isArray(source)) {
      const english = String(source.english ?? "").trim();
      return english || displayWord(source.letters);
    }
    return Array.isArray(source) ? source.join("") : String(source ?? "");
  }

  /* 2차 수정 공통 1절(한 판 시간): API 의 play_time 이 쓸 수 있는 값이면 그것을, 아니면 fallback 을 쓴다.
     쓸 수 있는 값 = 숫자(또는 숫자 글자)를 버림한 양의 정수. 상한·하한은 두지 않는다(잘못된 값은 API 에서 고친다).
     true/false 는 숫자로 바꾸면 1/0 이 되지만 시간이 아니므로 받지 않는다. content-loader 의 playTimeSeconds 도 같은 규칙이다. */
  function resolveRoundSeconds(playTime, fallback) {
    if (typeof playTime !== "number" && typeof playTime !== "string") return fallback;
    const seconds = Math.trunc(Number(playTime));
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : fallback;
  }

  /* 2차 수정 공통 1절(다시 시작, OX 기준): Try Again 이든 처음으로 → Start 든
     **앞 판 마지막 단어로 시작하지 않는다.** 새로 뽑은 첫 문제가 그 단어면 다른 단어와 자리를 바꾼다.
     바꿀 단어가 없으면(단어가 하나뿐) 그대로 둔다 — 판은 늘 열린다. 새로 고침하면 기억하지 않는다. */
  function wordKey(question) {
    return String(question?.english ?? (question?.letters || []).join("")).trim().toLowerCase();
  }

  function avoidFirstWord(questions, previousKey) {
    const list = Array.isArray(questions) ? questions.slice() : [];
    if (!previousKey || list.length < 2 || wordKey(list[0]) !== previousKey) return list;
    const swapAt = list.findIndex((question, index) => index > 0 && wordKey(question) !== previousKey);
    if (swapAt > 0) [list[0], list[swapAt]] = [list[swapAt], list[0]];
    return list;
  }

  const PureLogic = Object.freeze({
    RULES,
    FIELD,
    WALL_COLORS,
    TILE_COLORS,
    GRAY_TILE,
    tileArtUrl,
    MAX_PIECE_WIDTH,
    TETROMINOES,
    PIECE_SHAPES,
    pickPiecePlacement,
    tileWithPieces,
    FILLER_SHAPES,
    pickDecoyLetters,
    buildRun,
    placeRun,
    buildWall,
    landingRow,
    fullRows,
    collapseRows,
    createQuestionRun,
    createScoreboard,
    createGameFlow,
    sameOriginTarget,
    formatScore,
    GRADE_GOOD_MIN,
    GRADE_ART,
    gradeOf,
    createCountdown,
    formatClock,
    displayWord,
    avoidFirstWord,
    wordKey,
    resolveRoundSeconds,
    streakStep,
    cellFromPoint,
    fitFontSize,
    meaningNeedsWrap,
    MEANING_FONT,
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

  /* 형제 공통 흐름: 완성이든 실패든 단어를 크게 띄우고 발음을 들려준 뒤
     스스로 다음 문제로 넘어간다. 확인 버튼은 없다.
     검수표 r13 이 막은 것은 "문제 제시될 때"의 발음이지 정답 공개 시점이
     아니다 — 정답 공개는 성공·실패 양쪽 모두 울린다(형제 방과 같다).
     REVEAL_SOUND_MS 는 REVEAL_HOLD_MS 보다 반드시 작아야 한다. 크거나 같으면
     발음 콜백이 깨어나기 전에 다음 문제가 세대를 넘겨 소리가 통째로 사라진다. */
  const REVEAL_SOUND_MS = 320;   // 단어가 뜨고 발음이 나오기까지
  const REVEAL_HOLD_MS = 2000;   // 완성 단어를 보여 주는 최소 시간
  const FAIL_HOLD_MS = 2400;     // 정답 노출(실패)을 보여 주는 최소 시간
  /* 위 두 값은 "최소"다. 그 시간이 지났는데 단어 발음이 아직 나오는 중이면
     소리가 끝날 때까지 기다렸다가 넘어간다 — 길이를 우리가 정하지 않고
     소리 자체에 묻는다. 다만 'ended' 가 영영 오지 않는 경우(자산이 깨졌거나
     네트워크가 멈춘 경우)가 있으므로 이 상한을 두어 게임이 멈추지 않게 한다. */
  const WORD_SOUND_MAX_MS = 6000;
  const PIECE_SHOW_MS = 560;     // 어떤 조각인지 보이도록 벽 위에서 멈춰 있는 시간
  const DROP_MS = 1100;          // 조각이 천천히 내려오는 시간
  const CLEAR_MS = 460;          // 줄이 사라지고 위가 내려앉는 시간
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
    blockField: doc.getElementById("block-field"),
    dropPiece: doc.getElementById("drop-piece"),
    hudBar: doc.querySelector(".hud-bar"),
    scoreValue: doc.getElementById("score-value"),
    questionProgress: doc.getElementById("question-progress"),
    timerValue: doc.getElementById("timer-value"),
    timerFill: doc.getElementById("timer-fill"),
    bonusMeter: doc.getElementById("bonus-meter"),
    comboSlots: Array.from(doc.querySelectorAll(".streak-slot")),
    stepGains: Array.from(doc.querySelectorAll(".streak-step-gain")),
    bonusGain: doc.getElementById("bonus-gain"),
    bonusGainValue: doc.getElementById("bonus-gain-value"),
    wordReveal: doc.getElementById("word-reveal"),
    answerReveal: doc.getElementById("answer-reveal"),

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
    lastShownWord: "",  // 다시 시작 때 첫 문제로 다시 내지 않을 앞 판 마지막 단어(2차 수정)
    flow: null,
    scoreboard: null,
    run: null,            // 현재 문제의 철자 줄 {tiles, startIndex, endIndex}
    judge: null,          // 현재 문제의 판정 상태 머신
    /* 판·문제가 바뀔 때마다 올라가는 세대 번호. 늦게 깨어나는 setTimeout 을
       이번 세대에만 묶는 데 쓴다 — app.screen 검사만으로는 부족하다.
       새 판이 시작되면 screen 이 다시 "game" 이 되어 이전 판의 콜백이 통과하고,
       그 콜백이 새 판의 격자·노드를 덮어쓴다. */
    generation: 0,
    apiPlayTimeSeconds: 0, // 규약 info.play_time — 있으면 한 판 시간으로 쓴다(2차 수정)
    grid: null,           // 현재 블록 벽 (테트리스 격자)
    piece: null,          // 정답 시 떨어질 테트로미노와 착지 자리
    answerRow: -1,        // 조각이 내려앉는 줄(철자가 시작하는 줄)
    answerRows: [],       // 정답을 맞히면 사라지는 줄들(단어가 걸친 모든 줄)
    countdown: null,
    locked: true,         // 리빌/전환 중 드래그 입력 잠금
    muted: false,
    audio: null,
    lastFocus: null,
    activeModal: null,
    screen: "loading",
    wrongWords: [],
  };

  function announce(message) {
    if (el.gameStatus) el.gameStatus.textContent = message;
  }

  /* 상태 문구 한 줄. 지금 부르는 곳은 없다 — 닫기 안내는 사장님 문구(2026-09-30)
     "close문구 사용안함" 으로 없앴고, 연속정답 보너스 문구는 q52 로 보류 중이다.
     ⚠ 실측(2026-09-30): 헬퍼는 12방 모두 갖고 있으나(4방 toast · 8방 showToast),
       **실제로 부르는 곳이 0군데인 방은 이 방뿐이다**(나머지 1~11군데). 형제 방에 맞춘 것이
       아니라 이 방만 어긋난 상태이며, q52 복귀 대비로 남긴다. `toastTimer` 와
       styles.css 의 `.status-toast` 두 규칙도 같이 도달 불가다. */
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
  // navigation 아이콘은 시작 화면이면 '닫기', 그 외에는 '뒤로'다.
  function syncGlobalControls(screen) {
    const visible = screen === "start" || screen === "help" || screen === "game";
    /* 2차 수정 공통 1절(도움말 버튼, OX 기준): 도움말 화면에서만 X 를 없애고
       스피커 자리(왼쪽 위)에 ← 뒤로가기를 둔다. 도움말의 스피커는 숨긴다.
       시작·게임 화면은 검수표 r12 대로 오른쪽 위 X 그대로다. */
    const onHelp = screen === "help";
    if (el.soundButton) el.soundButton.hidden = !visible || onHelp;
    if (el.navigationButton) el.navigationButton.hidden = !visible;
    el.stage?.classList.toggle("help-mode", onHelp);
    const closesGame = screen === "start";
    if (el.navigationIcon) {
      el.navigationIcon.src = onHelp ? "assets/btn_back.png" : "assets/btn_close.png";
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
  /* 효과음 — 형제와 같은 방식. 같은 소리가 겹칠 수 있으므로 재생할 때마다 복제한다. */
  const sfx = (function createSfx() {
    const EFFECTS = {
      touch: "assets/sound/touch.mp3",     // 버튼 누름
      open: "assets/sound/open.mp3",       // 게임 시작
      show: "assets/sound/show.mp3",       // 정답 단어 등장(완성·실패 공용)
      success: "assets/sound/success.mp3", // 정답 구간 완성
      wrong: "assets/sound/fail.mp3",      // 오답: 띵~ 효과음
      clear: "assets/sound/stamp.mp3",     // 블록 줄 삭제
      // 연속 보너스 전용 소리는 없다 — OX 와 같다(사장님 답 2026-10-02 "OX처럼 없앰"). item2.mp3 파일은 그대로 둔다.
      cheer: "assets/sound/yeah.mp3",      // 결과 - 잘함
      stamp: "assets/sound/stamp.mp3",     // 결과 - 보통
      fail: "assets/sound/fail.mp3",       // 결과 - 아쉬움
    };
    /* 기획서 "정답 철자를 드래그 할때 각 알파벳 사운드 재생" — 리소스의
       piano_xylo 8음을 드래그가 한 칸 늘어날 때마다 차례로 울린다. */
    const NOTES = Array.from({ length: 8 }, (_, i) => `assets/sound/piano_xylo/xylo${i}.mp3`);
    const BGM_SRC = "assets/sound/bgm/glockenspiel_acoustic_kids_bgm_loop.mp3";
    const BGM_VOLUME = 0.15;
    let bgmAudio = null;
    let bgmWanted = false;
    /* 공통 9항 3번: 결과화면에서는 소리 설정과 무관하게 배경음을 멈춘다.
       무대를 누를 때마다 startBgm 을 부르는 리스너가 있어서 그냥 pause 만 하면
       결과화면에서 아무 데나 누르는 순간 다시 켜진다 — 그래서 억제 플래그를 둔다.
       app.muted(사용자 설정)는 건드리지 않는다. 결과화면을 벗어나면 원래대로 난다. */
    let bgmSuppressed = false;
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
      preload() { [...Object.values(EFFECTS), ...NOTES].forEach(clip); },
      effect(name, volume) { return playSrc(EFFECTS[name], volume); },
      note(step, volume) { return playSrc(NOTES[Math.abs(step) % NOTES.length], volume); },
      // 브라우저가 사용자의 조작 없이는 소리를 못 틀게 하므로 첫 클릭 때 불러 준다.
      startBgm() {
        bgmWanted = true;
        if (app.muted || bgmSuppressed) return;
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
      applyMuted() {
        if (app.muted) { if (bgmAudio) { try { bgmAudio.pause(); } catch { /* noop */ } } }
        else if (bgmWanted) this.startBgm();
      },
      // 결과화면 전용. 설정(app.muted)과 bgmWanted 는 그대로 두고 소리만 멈춘다.
      stopBgm() {
        bgmSuppressed = true;
        if (bgmAudio) { try { bgmAudio.pause(); } catch { /* noop */ } }
      },
      // 결과화면을 벗어날 때. 원래 설정대로 다시 난다.
      resumeBgm() {
        bgmSuppressed = false;
        if (bgmWanted) this.startBgm();
      },
    };
  })();

  /* 단어 발음. 자동 발음(정답 공개 때)은 소리 설정을 따른다.
     2차 수정 공통 1절(소리 끈 상태, OX 기준) · PDF 3쪽: 소리를 꺼도 **사용자가 직접 누른**
     오답노트 발음은 재생한다 — { userAction: true } 로 부른다. */
  function playSound(url, { userAction = false } = {}) {
    if (!url) return;
    if (app.muted && !userAction) return;
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

  /* 뜻 패널의 한글은 라인박스 중앙보다 위에 앉아 판 중앙에서 떠 보인다.
     문자열 잉크를 실측해 그만큼 내린다.
     가로는 보정하지 않는다 — flex 가운데 정렬이 이미 정확한데, 잉크 보정까지
     걸면 쉼표처럼 좌우 잉크가 비대칭인 문자열("영광, 영예")이 옆으로 밀린다. */
  const MEANING_MEASURE = { w: 1024, h: 192, font: 64 };

  /* 뜻 글자를 흰 상자 안에 들어가게 맞춘다. 기본 크기로 되돌려 재고, 넘치면
     비율로 한 번에 줄인 뒤 폰트 힌팅 때문에 남는 오차를 몇 번 더 조인다. */
  function fitMeaningText(node) {
    if (!node || !node.parentElement) return;
    const holder = node.parentElement;
    node.style.fontSize = `${MEANING_FONT.base}cqw`;
    /* 2차 검수 SB2-2 "7번 문제에 한글 영역 텍스트 벗어남": 줄바꿈도 한 줄(nowrap)로 되돌린 뒤 잰다.
       예전에는 크기만 되돌려, 앞 문제가 두 줄로 접힌 긴 뜻이면 이번 뜻을 접힌 폭(= 칸 폭 이하)으로 재고
       "들어간다" 로 보아 54px 한 줄로 그렸다 — 간판 밖으로 넘쳤다(문제 순서에 따라 7번처럼 뒤 문제에서만 난다). */
    node.style.whiteSpace = "nowrap";
    const style = global.getComputedStyle(holder);
    const available = holder.clientWidth
      - (Number.parseFloat(style.paddingLeft) || 0)
      - (Number.parseFloat(style.paddingRight) || 0);
    if (!(available > 0)) return;

    const measured = node.getBoundingClientRect().width;
    // 최소 크기로도 한 줄에 못 담으면 두 줄로 접는다.
    node.style.whiteSpace = meaningNeedsWrap(
      measured, available, MEANING_FONT.base, MEANING_FONT.min,
    ) ? "normal" : "nowrap";

    let size = fitFontSize(measured, available, MEANING_FONT.base, MEANING_FONT.min);
    if (size >= MEANING_FONT.base && node.style.whiteSpace === "nowrap") return;
    node.style.fontSize = `${size.toFixed(4)}cqw`;
    // 폰트 힌팅 때문에 한 번에 안 맞을 수 있어 몇 번 더 조인다.
    let guard = 0;
    while (node.getBoundingClientRect().width > available
      && size > MEANING_FONT.min && guard < 10) {
      size = Math.max(MEANING_FONT.min, size - 0.1);
      node.style.fontSize = `${size.toFixed(4)}cqw`;
      guard += 1;
    }
    // 줄을 바꿨는데 흰 안쪽 높이를 넘으면(아주 긴 뜻) 들어갈 때까지 더 줄인다 — 테두리 위로 넘치지 않게.
    if (node.style.whiteSpace === "normal") {
      const maxHeight = holder.clientHeight * (MEANING_BOX.innerHeight / MEANING_BOX.panelHeight);
      let shrink = 0;
      while (maxHeight > 0 && node.getBoundingClientRect().height > maxHeight
        && size > MEANING_FONT.floor && shrink < 80) {
        size = Math.max(MEANING_FONT.floor, size - 0.05);
        node.style.fontSize = `${size.toFixed(4)}cqw`;
        shrink += 1;
      }
    }
  }

  /* 2차 수정(PDF 3쪽 "상단 한글단어 세로 정렬 안맞음"): 잉크를 잴 때 화면과 같은 굵기로 잰다.
     styles.css .meaning-text-inner 는 800 인데 여기서 700 으로 재고 있어 굵기만큼 중심이 어긋났다.
     MEANING_WEIGHT 는 CSS 의 font-weight 와 반드시 같아야 한다(테스트가 붙든다). */
  const MEANING_WEIGHT = 800;
  /* 한글 글꼴(사장님 2026-10-02, 부모 원장 027fbd6b4ff949a3: "한글 표기는 전부" 나눔스퀘어라운드 —
     같은 날 9b16098d896b5cfb 로 파일이 ExtraBold(OTFEB) 로 바뀌었다. 이름(KOREAN_FONT_FAMILY)은 그대로다).
     캔버스 잉크 측정도 화면과 같은 글꼴로 재야 한다 — styles.css --korean-stack 과 반드시 같은 값이다. */
  const KOREAN_FONT_FAMILY = "NanumSquareRound Game";
  // 첫 문제를 그리기 전에 한글 글꼴을 기다리는 한도. font-display: block 의 막는 시간(3초)과 같다.
  const FONT_WAIT_MS = 3000;
  const KOREAN_FONT_STACK = `"${KOREAN_FONT_FAMILY}", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`;

  function centerMeaningText(node, text) {
    if (!node) return;
    const o = measureInkOffset(
      text,
      `${MEANING_WEIGHT} ${MEANING_MEASURE.font}px ${KOREAN_FONT_STACK}`,
      MEANING_MEASURE.w,
      MEANING_MEASURE.h,
      MEANING_MEASURE.font,
    );
    node.style.transform = `translateY(${o.y.toFixed(4)}em)`;
  }

  /* 한글 글꼴이 FONT_WAIT_MS 보다 늦게 오면 첫 뜻은 대체 글꼴로 재고 그렸다. 잉크 캐시 열쇠(글꼴 스택|글자)는
     글꼴이 와도 그대로라 그 값이 남는다 — 측정값을 버리고 지금 뜻을 다시 맞춘다.
     (2026-10-02 실측: 글꼴 응답을 4.5초 붙잡으면 첫 뜻 잉크 중심이 85.0 → 89.0, 4px 처졌다) */
  function refitMeaningAfterFont(loaded) {
    if (!loaded) return;
    inkOffsetCache.clear();
    const text = el.wordMeaning ? el.wordMeaning.textContent : "";
    if (!text) return;
    fitMeaningText(el.wordMeaning);
    centerMeaningText(el.wordMeaning, text);
  }

  // ============================================================
  // 블록 벽 렌더링
  // ============================================================
  const cqw = (px) => `${(px / STAGE_WIDTH) * 100}cqw`;

  let tileByIndex = new Map(); // runIndex -> {holder, art, glyph, button}
  let nodeAt = new Map();      // "row:col" -> 셀 노드

  const cellKey = (row, col) => `${row}:${col}`;
  const cellLeft = (col) => cqw(FIELD.originX + col * FIELD.cell);
  const cellTop = (row) => cqw(FIELD.originY + row * FIELD.cell);

  function makeCell(cell, run, row, col) {
    const holder = doc.createElement("div");
    holder.className = "field-cell";
    holder.style.left = cellLeft(col);
    holder.style.top = cellTop(row);
    holder.dataset.row = String(row);
    holder.dataset.col = String(col);

    if (cell.kind === "block") {
      const art = doc.createElement("img");
      art.className = "wall-block";
      art.src = `assets/game/block_${cell.color}.png`;
      art.alt = "";
      art.draggable = false;
      holder.appendChild(art);
      return holder;
    }

    const tile = run.tiles[cell.runIndex];
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "letter-tile";
    button.dataset.runIndex = String(cell.runIndex);
    button.setAttribute("aria-label", `철자 ${tile.letter}`);

    const art = doc.createElement("img");
    art.className = "letter-tile-art";
    art.src = tileArtUrl(cell.color);
    art.alt = "";
    art.draggable = false;

    const glyph = doc.createElement("span");
    glyph.className = "letter-tile-glyph";
    glyph.textContent = tile.letter;
    centerGlyph(glyph, tile.letter);

    button.append(art, glyph);
    holder.appendChild(button);
    tileByIndex.set(cell.runIndex, { holder, art, glyph, button, color: cell.color });
    return holder;
  }

  function renderField(grid, run) {
    if (!el.blockField) return;
    el.blockField.innerHTML = "";
    tileByIndex = new Map();
    nodeAt = new Map();
    for (let row = 0; row < FIELD.rows; row += 1) {
      for (let col = 0; col < FIELD.cols; col += 1) {
        const cell = grid[row][col];
        if (!cell) continue;
        const holder = makeCell(cell, run, row, col);
        nodeAt.set(cellKey(row, col), holder);
        el.blockField.appendChild(holder);
      }
    }
  }

  /* 세대를 하나 넘긴다. 이 시점 이전에 예약된 콜백은 전부 무효가 된다.
     그 콜백들이 하던 화면 정리(낙하 조각 숨기기)도 함께 못 하게 되므로
     여기서 직접 치운다 — 그러지 않으면 이전 판의 조각이 새 판 위에 떠 있는다. */
  function nextGeneration() {
    app.generation += 1;
    if (el.dropPiece) {
      el.dropPiece.hidden = true;
      el.dropPiece.classList.remove("is-falling", "is-showing");
    }
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

  // 재생 중인 단어 발음을 멈춘다(화면을 떠날 때 소리가 새지 않게).
  function stopSound() {
    if (!app.audio) return;
    try { app.audio.pause(); } catch { /* noop */ }
    app.audio = null;
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
  function shakeStage() {
    if (!el.blockField) return;
    global.clearTimeout(shakeTimer);
    restartAnimation(el.blockField, "is-jolted");
    shakeTimer = global.setTimeout(() => {
      el.blockField.classList.remove("is-jolted");
      shakeTimer = 0;
    }, 420);
  }

  // 조각이 떨어진 자리에 충격파를 한 번 퍼뜨린다.
  let impactTimer = 0;
  function impactAt(row, col, width) {
    if (!el.blockField) return;
    const centerX = FIELD.originX + (col + width / 2) * FIELD.cell;
    const centerY = FIELD.originY + (row + 0.5) * FIELD.cell;
    el.blockField.style.setProperty("--impact-x", cqw(centerX));
    el.blockField.style.setProperty("--impact-y", cqw(centerY));
    global.clearTimeout(impactTimer);
    restartAnimation(el.blockField, "is-impact");
    impactTimer = global.setTimeout(() => {
      el.blockField.classList.remove("is-impact");
      impactTimer = 0;
    }, 560);
  }

  /* 정답이 시작하는 칸을 깜빡여 알려 준다.
     기획서는 1회 오답 뒤에 켜라고 하지만, 사용자 지시로 문제가 나오자마자 켠다. */
  function showStartHint() {
    if (!app.run) return;
    tileByIndex.get(app.run.startIndex)?.holder.classList.add("is-hint");
  }

  // 판정이 끝나면 깜빡임을 멈춘다.
  function clearStartHint() {
    tileByIndex.forEach((node) => node.holder.classList.remove("is-hint"));
  }

  // ---- 드래그 선택 ----
  /* pointerId 를 기억해 한 손가락만 그린다. 기억하지 않으면 두 번째 손가락이
     닿는 순간 앵커가 그쪽으로 옮겨져, 제대로 그은 드래그가 오답이 된다. */
  const drag = { active: false, pointerId: null, anchor: -1, head: -1, played: -1 };

  // 화면 좌표를 무대(1920x1080) 좌표로 바꾼다.
  function stagePoint(event) {
    if (!el.blockField) return null;
    const rect = el.blockField.getBoundingClientRect();
    if (!(rect.width > 0)) return null;
    const scale = rect.width / STAGE_WIDTH;
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    };
  }

  // 그 자리에 놓인 철자의 순번. 철자가 아니거나 벽 밖이면 -1.
  function tileIndexFromEvent(event) {
    const point = stagePoint(event);
    if (!point) return -1;
    const cell = cellFromPoint(point.x, point.y);
    if (!cell || !app.grid) return -1;
    const filled = app.grid[cell.row] && app.grid[cell.row][cell.col];
    return filled && filled.kind === "letter" ? filled.runIndex : -1;
  }

  // 손가락이 벽(11x4 격자) 안에 있는가 — 밖에서 떼면 판정하지 않고 무른다.
  function isInsideField(event) {
    const point = stagePoint(event);
    return Boolean(point && cellFromPoint(point.x, point.y));
  }

  // 정답 첫 글자가 올라앉은 블록의 색. 선택한 칸을 이 색으로 갈아끼운다.
  function startTileColor() {
    if (!app.run) return "";
    return tileByIndex.get(app.run.startIndex)?.color || "";
  }

  // 타일 그림을 색 하나로 갈아끼운다. 색이 비어 있으면 원래 색(첫 글자는
  // 강조색, 나머지는 회색)으로 되돌린다.
  function paintTile(node, color) {
    const next = tileArtUrl(color || node.color);
    if (!node.art.src.endsWith(next)) node.art.src = next;
  }

  /* 검수표 r49: 철자를 드래그·터치하면 블록 색이 첫 글자 블록 색과 같아진다.
     다른 효과(밝기·들어올림·그림자)는 넣지 않는다. */
  function paintSelection() {
    const from = Math.min(drag.anchor, drag.head);
    const to = Math.max(drag.anchor, drag.head);
    const color = startTileColor();
    tileByIndex.forEach((node, index) => {
      const on = drag.active && index >= from && index <= to;
      node.holder.classList.toggle("is-selected", on);
      paintTile(node, on ? color : "");
    });
  }

  function clearSelection() {
    tileByIndex.forEach((node) => {
      node.holder.classList.remove("is-selected");
      paintTile(node, "");
    });
  }

  /* 정답으로 확정된 구간은 첫 글자 색으로 남는다.
     손을 떼는 순간 endDrag -> clearSelection 이 먼저 돌아 전부 회색으로
     되돌리므로, 판정이 정답이면 여기서 다시 칠해 준다. 이 타일들은 줄이
     사라질 때 함께 없어지므로 되돌릴 필요가 없다. */
  function paintRunAccent(from, to) {
    const color = startTileColor();
    if (!color) return;
    for (let index = from; index <= to; index += 1) {
      const node = tileByIndex.get(index);
      if (node) paintTile(node, color);
    }
  }

  function endDrag(event) {
    drag.active = false;
    drag.pointerId = null;
    if (event && el.blockField) {
      try { el.blockField.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    }
    clearSelection();
  }

  function onFieldPointerDown(event) {
    if (app.locked || !app.judge) return;
    // 이미 다른 손가락이 그리는 중이면 무시한다.
    if (drag.active) return;
    // 마우스는 왼쪽 버튼만 받는다.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const index = tileIndexFromEvent(event);
    if (index < 0) return;
    event.preventDefault();
    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.anchor = index;
    drag.head = index;
    drag.played = 0;
    try { el.blockField.setPointerCapture(event.pointerId); } catch { /* noop */ }
    paintSelection();
    sfx.note(0, 0.7);
  }

  function onFieldPointerMove(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    const index = tileIndexFromEvent(event);
    if (index < 0 || index === drag.head) return;
    drag.head = index;
    paintSelection();
    const span = Math.abs(drag.head - drag.anchor);
    if (span !== drag.played) {
      drag.played = span;
      sfx.note(span, 0.7);
    }
  }

  function onFieldPointerUp(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    const from = Math.min(drag.anchor, drag.head);
    const to = Math.max(drag.anchor, drag.head);
    // 벽 밖에서 손을 떼면 무르는 것으로 본다 — 그러지 않으면 드래그를
    // 취소할 방법이 전혀 없어, 잘못 잡았을 때도 반드시 판정을 받는다.
    const cancelled = !isInsideField(event);
    endDrag(event);
    if (cancelled) {
      announce("드래그를 취소했어요.");
      return;
    }
    judgeSelection(from, to);
  }

  function onFieldPointerCancel(event) {
    if (!drag.active || (event && event.pointerId !== drag.pointerId)) return;
    endDrag(event);
  }

  // ---- 판정 ----
  function judgeSelection(from, to) {
    if (app.locked || !app.judge) return;
    const result = app.judge.select(from, to);
    if (result.type === "ignored") return;

    if (result.type === "correct") {
      app.locked = true;
      clearStartHint();
      paintRunAccent(from, to);
      for (let index = from; index <= to; index += 1) {
        const node = tileByIndex.get(index);
        if (!node) continue;
        // 왼쪽부터 차례로 터지도록 순번을 CSS에 넘긴다.
        node.holder.style.setProperty("--pop", String(index - from));
        node.holder.classList.add("is-correct");
      }
      flashField("is-correct-flash", 620);
      /* 2차 검수 SB2-1 "정답 선택할 때 효과음 크기가 너무 큼": 0.85 → 0.5. success.mp3 는 이 방 효과음 가운데 가장 커서
         (실효 -16.4 dBFS, 오답음 fail.mp3 -20.3 · 블록 착지 stamp.mp3 -19.0 — 2026-10-15 파일을 풀어 잼), 0.5 면 오답음(0.85)과 비슷한 크기다. */
      sfx.effect("success", 0.5);
      announce(`${displayWord(currentQuestion() || app.judge.word)} 완성!`);
      laterInRound(runCorrectEffect, 180);
      return;
    }

    const SHAKE_MS = 380; // tileShake 키프레임 길이와 같게 유지한다
    for (let index = from; index <= to; index += 1) {
      const node = tileByIndex.get(index);
      if (!node) continue;
      restartAnimation(node.holder, "is-shaking");
      // 흔들림이 끝나면 클래스를 걷는다 — 남겨 두면 상태가 부정확해진다.
      global.setTimeout(() => node.holder.classList.remove("is-shaking"), SHAKE_MS);
    }
    const beforeMiss = app.scoreboard.score;
    flashField("is-wrong-flash", 460);
    shakeStage();
    app.scoreboard.miss();
    // OX 와 같이 보너스가 붙은 판만 굴려 올리고, 그 밖에는 즉시 반영한다.
    updateScore();
    bumpScoreCard();
    /* 4차 q61 로 0점 하한이 없어져 점수는 마이너스로도 내려간다.
       그래서 이 차이는 언제나 깎인 만큼 그대로다 — 예전에는 0 에서 멈춰
       실제로 깎인 만큼만 띄우려고 이렇게 뺐다. 하한을 되살리지 말 것. */
    floatScoreDelta(app.scoreboard.score - beforeMiss);
    // 오답 한 번에 콤보가 끊긴다 — 켜진 칸이 애니메이션 없이 모두 꺼진다(OX renderCombo(0)).
    renderCombo(0);
    sfx.effect("wrong", 0.85);
    announce(`단어가 아니에요. 남은 기회 ${result.chancesLeft}번.`);

    if (result.failed) {
      app.locked = true;
      clearStartHint();
      laterInRound(failWord, 320);
    }
  }

  /* 정답 효과(기획서 1-2 "정답일 경우 1번 블록이 내려와서 블록 완성").
     표준 테트로미노가 벽 위에 잠깐 떠서 어떤 조각인지 보여 준 뒤 천천히
     떨어져 빈 칸에 얹힌다. 그다음 정답 줄만 사라진다. */
  function runCorrectEffect() {
    if (app.screen !== "game" || !app.piece) { completeWord(); return; }
    dropPiece(app.piece, () => {
      if (app.screen !== "game") return;
      clearAnswerRows(() => {
        if (app.screen !== "game") return;
        completeWord();
      });
    });
  }

  // 조각을 벽 위에 띄웠다가 착지시킨 뒤, 실제 셀로 격자에 합친다.
  function dropPiece(piece, done) {
    const landing = landingRow(app.grid, piece.cells, piece.col);
    if (!el.dropPiece || landing < 0) { done(); return; }

    el.dropPiece.innerHTML = "";
    el.dropPiece.style.width = cqw(piece.width * FIELD.cell);
    el.dropPiece.style.height = cqw(piece.height * FIELD.cell);
    piece.cells.forEach(([dr, dc]) => {
      const art = doc.createElement("img");
      art.src = `assets/game/block_${piece.color}.png`;
      art.alt = "";
      art.draggable = false;
      art.style.left = cqw(dc * FIELD.cell);
      art.style.top = cqw(dr * FIELD.cell);
      el.dropPiece.appendChild(art);
    });
    el.dropPiece.style.left = cellLeft(piece.col);
    // 벽 위에 먼저 나타나 어떤 조각인지 보여 준다.
    el.dropPiece.style.top = cqw(FIELD.originY - (piece.height + 1) * FIELD.cell);
    el.dropPiece.hidden = false;
    el.dropPiece.classList.remove("is-falling");
    restartAnimation(el.dropPiece, "is-showing");
    announce(`${piece.type} 조각이 내려옵니다.`);

    laterInRound(() => {
      if (app.screen !== "game") { el.dropPiece.hidden = true; return; }
      el.dropPiece.classList.remove("is-showing");
      // 시작 위치를 확실히 반영시킨 뒤 목표값을 줘야 transition 이 걸린다.
      void el.dropPiece.offsetWidth;
      el.dropPiece.classList.add("is-falling");
      el.dropPiece.style.top = cellTop(landing);
    }, PIECE_SHOW_MS);

    /* 이 콜백은 app.grid·nodeAt·blockField 를 실제로 고친다. 세대 검사가 없으면
       정답 직후 1.8초 안에 타이머가 끝나거나 Try Again 을 누른 경우, 이전 판의
       조각이 새 판의 격자를 덮어써 조각이 안 떨어지거나 줄이 안 지워진다. */
    laterInRound(() => {
      el.dropPiece.hidden = true;
      el.dropPiece.classList.remove("is-falling");
      // 착지한 조각을 격자와 화면에 실제 블록으로 심는다.
      piece.cells.forEach(([dr, dc]) => {
        const row = landing + dr;
        const col = piece.col + dc;
        if (row < 0 || row >= FIELD.rows) return;
        const cell = { kind: "block", color: piece.color };
        app.grid[row][col] = cell;
        const holder = makeCell(cell, app.run, row, col);
        holder.classList.add("is-landed");
        nodeAt.set(cellKey(row, col), holder);
        el.blockField.appendChild(holder);
      });
      impactAt(landing, piece.col, piece.width);
      shakeStage();
      sfx.effect("clear", 0.7);
      done();
    }, PIECE_SHOW_MS + DROP_MS);
  }

  /* 정답 줄이 사라지고 그 위의 블록이 내려앉는다.
     (기획서: "단어가 모두 완성 되면 블록 줄이 한 칸 없어지면서")
     단어가 아랫줄까지 이어진 경우에는 걸친 줄을 모두 지운다 — 첫 줄만 지우면
     아랫줄 철자가 화면에 그대로 남는다. */
  function clearAnswerRows(done) {
    const rows = (app.answerRows || [])
      .filter((row) => Number.isInteger(row) && app.grid[row] && app.grid[row].every(Boolean));
    if (rows.length === 0) { done(); return; }

    rows.forEach((row) => {
      for (let col = 0; col < FIELD.cols; col += 1) {
        const node = nodeAt.get(cellKey(row, col));
        if (!node) continue;
        // 방금 착지한 조각의 등장 연출이 남아 있으면 삭제 연출과 겹친다.
        node.classList.remove("is-landed", "is-settling");
        // 왼쪽부터 차례로 튕겨 나가도록 순번을 CSS에 넘긴다.
        node.style.setProperty("--pop", String(col));
        node.classList.add("is-clearing");
      }
    });
    flashField("is-clear-flash", 520);
    shakeStage();

    const { grid, moves } = collapseRows(app.grid, rows);
    laterInRound(() => {
      rows.forEach((row) => {
        for (let col = 0; col < FIELD.cols; col += 1) {
          const key = cellKey(row, col);
          nodeAt.get(key)?.remove();
          nodeAt.delete(key);
        }
      });
      // 아래에서부터 옮겨야 새 자리가 서로 덮이지 않는다.
      [...moves].sort((a, b) => b.to - a.to).forEach(({ from, to }) => {
        for (let col = 0; col < FIELD.cols; col += 1) {
          const holder = nodeAt.get(cellKey(from, col));
          if (!holder) continue;
          nodeAt.delete(cellKey(from, col));
          nodeAt.set(cellKey(to, col), holder);
          holder.dataset.row = String(to);
          holder.classList.add("is-settling");
          holder.style.top = cellTop(to);
        }
      });
      app.grid = grid;
      laterInRound(done, CLEAR_MS);
    }, CLEAR_MS);
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
    // 굴림 중간값도 여기를 지나므로 굴러가는 동안에도 쉼표가 보인다.
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

  // 얻거나 잃은 점수를 Score 카드 위로 띄워 보낸다.
  // 판이 끝나거나 시작 화면으로 가면 clearScoreDeltas 가 남은 것을 모두 걷는다(OX 와 같다).
  const scoreDeltaTimers = new Set();
  function floatScoreDelta(delta) {
    if (!delta || !el.hudBar) return;
    const node = doc.createElement("span");
    node.className = `score-delta ${delta > 0 ? "is-plus" : "is-minus"}`;
    node.textContent = `${delta > 0 ? "+" : ""}${formatScore(delta)}`;
    el.hudBar.appendChild(node);
    const timerId = global.setTimeout(() => {
      node.remove();
      scoreDeltaTimers.delete(timerId);
    }, 1100);
    scoreDeltaTimers.add(timerId);
  }

  function clearScoreDeltas() {
    scoreDeltaTimers.forEach((timerId) => global.clearTimeout(timerId));
    scoreDeltaTimers.clear();
    if (el.hudBar) el.hudBar.querySelectorAll(".score-delta").forEach((node) => node.remove());
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

  // ---- 콤보 표시 ----
  /* 사장님 지시(2026-10-02) "콤보,보너스, 효과 OX 확인해서 동일한 스펙으로 적용".
     OX(wordmathch_oxquizegame) 의 renderCombo · showStepGain · showBonusGain 과 같은 차례·시간이다.
     - 첫째·둘째 칸이 켜질 때 그 칸 위에 방금 얻은 정답 점수(+50)를 0.9초 띄운다.
     - 셋째 정답이면 셋째 칸만 터지고(is-bursting) 그 위에 BONUS 띠와 +100 이 1.2초 솟는다.
       1.2초(COMBO_BURST_MS = OX FEEDBACK_DURATION_MS.correct)가 지나면 세 칸이 모두 꺼진다.
     - 효과가 뜨는 때는 이 방에서 점수가 더해지는 순간(completeWord)이다 — 사장님 답 "점수가 더해질 때".
     - 오답 한 번이면 칸이 애니메이션 없이 모두 꺼진다(사장님 답 "OX처럼 한 번 틀리면 끊김"). */
  const COMBO_BURST_MS = 1200;
  const STEP_GAIN_MS = 900;
  let comboBurstTimer = 0;
  let bonusGainTimer = 0;
  const stepGainTimers = new Map();

  function showStepGain(index) {
    const gain = el.stepGains[index];
    if (!gain) return;
    gain.textContent = `+${formatScore(app.rules.letterScore)}`;
    global.clearTimeout(stepGainTimers.get(index));
    gain.classList.remove("is-showing");
    gain.hidden = false;
    void gain.offsetWidth;
    gain.classList.add("is-showing");
    stepGainTimers.set(index, global.setTimeout(() => {
      gain.classList.remove("is-showing");
      gain.hidden = true;
      stepGainTimers.delete(index);
    }, STEP_GAIN_MS));
  }

  function showBonusGain(points) {
    const gain = el.bonusGain;
    if (!gain) return;
    // 셋째 칸에는 실제로 점수에 더해지는 보너스 추가점수를 BONUS 글자와 함께 띄운다.
    if (el.bonusGainValue) el.bonusGainValue.textContent = `+${formatScore(points)}`;
    global.clearTimeout(bonusGainTimer);
    gain.classList.remove("is-showing");
    gain.hidden = false;
    void gain.offsetWidth;
    gain.classList.add("is-showing");
    bonusGainTimer = global.setTimeout(() => {
      gain.classList.remove("is-showing");
      gain.hidden = true;
      bonusGainTimer = 0;
    }, COMBO_BURST_MS);
  }

  function hideBonusGain() {
    global.clearTimeout(bonusGainTimer);
    bonusGainTimer = 0;
    if (el.bonusGain) {
      el.bonusGain.classList.remove("is-showing");
      el.bonusGain.hidden = true;
    }
    stepGainTimers.forEach((timerId) => global.clearTimeout(timerId));
    stepGainTimers.clear();
    el.stepGains.forEach((gain) => {
      gain.classList.remove("is-showing");
      gain.hidden = true;
    });
  }

  function renderCombo(progress, { burst = false, step = false, points = 0 } = {}) {
    el.comboSlots.forEach((slot, index) => {
      const keepsBurstVisible = index === 2 && slot.classList.contains("is-bursting");
      slot.classList.toggle("is-active", index < progress || keepsBurstVisible);
    });

    // 방금 켜진 칸이 첫째·둘째면 그 칸 위에 정답 점수를 띄운다. 셋째(콤보 완성)는 아래 burst 가 맡는다.
    if (step && !burst && progress >= 1) showStepGain(progress - 1);

    if (burst) {
      showBonusGain(points);
      const slot = el.comboSlots[2];
      global.clearTimeout(comboBurstTimer);
      if (slot) {
        slot.classList.remove("is-bursting");
        void slot.offsetWidth;
        slot.classList.add("is-active", "is-bursting");
      }
      comboBurstTimer = global.setTimeout(() => {
        el.comboSlots.forEach((node) => node.classList.remove("is-active", "is-bursting"));
        comboBurstTimer = 0;
        // 칸이 모두 꺼졌으니 읽는 단계도 0 이다(OX 는 이때 renderCombo() 로 다시 칠한다).
        labelCombo(0);
      }, COMBO_BURST_MS);
    }

    labelCombo(progress);
  }

  function labelCombo(progress) {
    if (el.bonusMeter) el.bonusMeter.setAttribute("aria-label", `연속 정답 ${progress}단계`);
  }

  // 판 시작·끝·시작 화면: 터짐과 칸 위 표시를 걷고 모두 끈다.
  function resetComboBurst() {
    global.clearTimeout(comboBurstTimer);
    comboBurstTimer = 0;
    el.comboSlots.forEach((slot) => slot.classList.remove("is-active", "is-bursting"));
    hideBonusGain();
    labelCombo(0);
  }

  /* 지금 진행도를 다시 칠한다(문제를 불러올 때·실패했을 때).
     보너스가 터지는 동안(1.2초)은 손대지 않는다 — 진행도는 이미 0 이라 칠하면 첫째·둘째 칸이 먼저 꺼진다.
     OX 는 터짐이 끝나는 1.2초에 다음 문제를 내 이런 일이 없다. 여기서는 터짐이 끝나며 모두 끈다. */
  function updateStreak() {
    if (comboBurstTimer) return;
    renderCombo(streakStep(app.scoreboard ? app.scoreboard.streak : 0, app.rules.streakLength));
  }

  function updateTimerDisplay() {
    const now = Date.now();
    const remaining = app.countdown ? app.countdown.remainingSeconds(now) : app.rules.timerSeconds;
    /* 2차 수정 공통 2절(게임 화면, OX 기준): 남은 10초부터 시간 숫자와 타임바가 빨강으로 깜박이고,
       5초부터는 더 빠르다. 화면 가장자리 붉은 빛은 넣지 않는다.
       is-urgent = 10~5초, is-critical = 5~0초. 판이 끝나면 stopTimer 가 둘 다 뗀다. */
    const urgent = remaining > 5 && remaining <= 10;
    const critical = remaining > 0 && remaining <= 5;
    if (el.timerValue) {
      el.timerValue.textContent = formatClock(remaining);
      el.timerValue.classList.toggle("is-urgent", urgent);
      el.timerValue.classList.toggle("is-critical", critical);
    }
    if (el.timerFill) {
      const ratio = app.countdown ? app.countdown.remainingRatio(now) : 1;
      el.timerFill.style.width = `${(ratio * 100).toFixed(2)}%`;
      el.timerFill.classList.toggle("is-urgent", urgent);
      el.timerFill.classList.toggle("is-critical", critical);
    }
  }

  function stopTimer() {
    if (timerInterval) { global.clearInterval(timerInterval); timerInterval = 0; }
    el.timerValue?.classList.remove("is-urgent", "is-critical");
    el.timerFill?.classList.remove("is-urgent", "is-critical");
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

  // 단어 완성: 블록 연출이 끝났고, 단어를 크게 보여 주고 발음을 들려준 뒤
  // 스스로 다음 문제로 넘어간다.
  // (setTimeout으로 예약되므로, 그 사이 타이머가 끝나 결과로 넘어갔으면 버린다)
  function completeWord() {
    if (app.screen !== "game") return;
    const question = currentQuestion();
    if (!question) return;
    app.flow.completeWord(true);
    const beforeScore = app.scoreboard.score;
    const { streak, bonusAwarded } = app.scoreboard.wordComplete();
    /* OX 와 같은 차례(사장님 지시 2026-10-02): 보너스가 붙은 판만 숫자를 굴려 올리고 그 밖에는 즉시,
       카드는 매번 튕기고, 증감 표시는 정답 점수만(보너스분은 셋째 칸 위 BONUS 가 맡는다),
       그리고 같은 순간 콤보 칸. 보너스 전용 소리는 없다. */
    if (bonusAwarded > 0) animateScore(app.scoreboard.score);
    else updateScore();
    bumpScoreCard();
    floatScoreDelta(app.scoreboard.score - beforeScore - bonusAwarded);
    renderCombo(bonusAwarded > 0 ? app.rules.streakLength : streakStep(streak, app.rules.streakLength), {
      burst: bonusAwarded > 0,
      step: bonusAwarded === 0,
      points: bonusAwarded,
    });
    if (bonusAwarded > 0) {
      announce(`정답입니다. ${app.rules.streakLength}연속 보너스 ${formatScore(bonusAwarded)}점을 획득했습니다.`);
    }
    revealWord(question, false);
    sfx.effect("show", 0.8);
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
    app.wrongWords.push({
      // 문제 번호를 함께 담아 둔다(같은 문제를 두 번 담지 않았는지 볼 때 쓴다).
      index: app.flow.index,
      // 오답노트도 API 단어 그대로(2차 수정).
      english: displayWord(question),
      meaning: question.meaning,
      soundUrl: question.soundUrl,
    });
    // 기획서: 3회 오답이면 정답 효과와 사운드만 제공하고 넘어간다.
    paintRunAccent(app.run.startIndex, app.run.endIndex);
    for (let index = app.run.startIndex; index <= app.run.endIndex; index += 1) {
      tileByIndex.get(index)?.holder.classList.add("is-correct");
    }
    revealWord(question, true);
    sfx.effect("show", 0.8);
    announce(`정답은 ${displayWord(question)}입니다.`);
    advance(FAIL_HOLD_MS);
  }

  /* 정답 단어가 최대 폭(88cqw)을 넘으면 넘지 않을 때까지 줄인다 — 형제 따라쓰기 fitWordReveal 과 같은 법(SB공통-3).
     이 방 단어는 10글자까지라 보통은 줄지 않는다. 띄어쓰기가 든 API 단어가 와도 칸 밖으로 나가지 않게 둔다. */
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
      // 완성·실패(정답 노출) 화면 모두 API 단어 그대로 쓴다(2차 수정).
      const word = displayWord(question);
      /* 2차 검수 SB2-3 "정답 후 단어 카드 효과 글자별로 나옴 → 단어 전체가 한 번에": 예전에는 글자마다 순번을 줘
         하나씩 떨어뜨렸다. 이제 단어 전체를 한 덩어리로 넣고, 등장 효과는 형제 따라쓰기 · Star word 의 reveal-in 과 같다.
         SB공통-3 "폰트 크기는 따라쓰기 영어단어카드 크기로": 크기 · 긴 단어 기준(10글자부터) · 넘치면 줄이는 법도 따라쓰기와 같다. */
      el.wordReveal.classList.toggle("is-long", word.length > 9);
      // 덮개가 문제마다 숨었다(display: none) 다시 보이므로 등장 효과는 매번 처음부터 돈다.
      el.wordReveal.textContent = word;
      el.wordReveal.removeAttribute("aria-label");
    }
    if (el.answerReveal) {
      el.answerReveal.classList.toggle("is-fail", isFail);
      el.answerReveal.hidden = false;
    }
    // 보이게 된 뒤에 잰다 — 숨어 있으면 폭이 0 이다.
    fitWordReveal();
    /* 검수표 r13: 단어 사운드는 "문제 제시될 때" 나오면 안 된다 — 먼저 듣고
       철자를 맞추면 파닉스 학습이 되어 버리기 때문이다(loadQuestion 참조).
       정답이 화면에 공개되는 이 시점에는 들려준다. 맞혀서 공개되든 기회를
       다 써서 공개되든 마찬가지다 — 형제 방(classroom·waterpipe·write)과 같다.
       조건은 sound_url 이 있느냐 하나뿐이다. 없으면 playSound 가 그냥 빠진다.
       (사장님 지시 2026-09-10: "형제 방과 동일하게 / 사운드 URL이 있을때") */
    laterInRound(() => playSound(question.soundUrl), REVEAL_SOUND_MS);
  }

  /* 단어 발음이 아직 나오는 중이면 끝날 때까지 기다렸다가 fn 을 부른다.
     소리가 없거나(sound_url 없음·음소거) 이미 끝났거나 재생에 실패했으면
     곧바로 부른다. 'ended' 가 오지 않을 때를 대비해 상한 타이머를 함께 건다.
     둘 중 먼저 오는 쪽이 이기고, 나머지는 정리한다. */
  function afterWordSound(fn) {
    const audio = app.audio;
    if (!audio || audio.paused || audio.ended) { fn(); return; }
    let settled = false;
    let capTimer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      global.clearTimeout(capTimer);
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("error", finish);
      audio.removeEventListener("pause", finish);
      fn();
    };
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", finish);
    // stopSound() 나 다른 재생이 이 소리를 멈추면 더 기다릴 이유가 없다.
    audio.addEventListener("pause", finish);
    capTimer = global.setTimeout(finish, WORD_SOUND_MAX_MS);
  }

  function advance(delayMs) {
    global.clearTimeout(advanceTimer);
    // delayMs 는 연출을 위한 최소 시간이다. 그 뒤에도 발음이 남아 있으면
    // 소리가 끝나기를 기다린다 — laterInRound 로 두 번 다 세대에 묶어,
    // 이전 문제의 소리가 끝나며 새 문제를 건너뛰는 일이 없게 한다.
    advanceTimer = laterInRound(() => {
      advanceTimer = 0;
      const generation = app.generation;
      afterWordSound(() => {
        if (app.generation !== generation) return;
        if (app.screen !== "game") return;
        if (el.answerReveal) el.answerReveal.hidden = true;
        app.flow.advance();
        if (app.flow.isFinished()) { endGame(); return; }
        loadQuestion();
      });
    }, delayMs);
  }

  function loadQuestion() {
    const question = currentQuestion();
    if (!question) { endGame(); return; }
    // 다시 시작 규칙(2차 수정): 이 판에서 마지막으로 화면에 나온 단어를 기억한다.
    app.lastShownWord = wordKey(question);
    // 새 문제 — 이전 문제에 걸려 있던 지연 콜백을 전부 무효로 만든다.
    nextGeneration();
    stopSound();
    app.run = buildRun(question.letters, { decoyCount: app.rules.decoyCount });
    app.judge = createQuestionRun(app.run, app.rules);
    const cells = placeRun(app.run.tiles.length);
    const wall = buildWall(cells, { accentIndex: app.run.startIndex });
    app.grid = wall.grid;
    app.piece = wall.piece;
    app.answerRow = wall.answerRow;
    app.answerRows = wall.answerRows;
    renderField(app.grid, app.run);
    if (el.wordMeaning) {
      el.wordMeaning.textContent = question.meaning;
      // 크기를 먼저 맞춘 뒤 세로 보정을 건다(보정값은 em 단위라 크기와 무관하다).
      fitMeaningText(el.wordMeaning);
      centerMeaningText(el.wordMeaning, question.meaning);
    }
    if (el.answerReveal) el.answerReveal.hidden = true;
    updateProgress();
    updateStreak();
    showStartHint();
    app.locked = false;
    announce(`문제 ${app.flow.currentNumber()}. 뜻: ${question.meaning}. 단어가 되는 철자를 드래그하세요.`);
    /* 검수표 r13: 문제가 제시될 때는 단어 발음을 재생하지 않는다.
       먼저 소리를 듣고 철자를 맞추면 파닉스 학습이 되어 버리기 때문이다.
       발음은 정답이 화면에 공개되는 revealWord 에서만 울린다. */
  }

  function startGame() {
    sfx.resumeBgm();
    nextGeneration();
    stopSound();
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
    app.questions = avoidFirstWord(app.questions, app.lastShownWord);
    app.flow = createGameFlow(app.questions.length || app.rules.questionCount);
    app.scoreboard = createScoreboard(app.rules);
    app.wrongWords = [];
    updateScore();
    resetComboBurst();
    clearScoreDeltas();
    updateStreak();
    showScreen("playScreen");
    syncGlobalControls("game");
    /* 공통 11항 3번: 폰트를 기다리는 동안 X 로 나갈 수 있다. 세대에 묶지 않으면
       그 콜백이 나중에 돌아 이미 떠난 판을 세운다(실측: 나간 뒤 블록 29개가 깔렸다).
       startGame 첫 줄의 nextGeneration 이 올려 둔 번호를 붙잡아 두고 대조한다. */
    const generation = app.generation;
    /* 한글 글꼴을 받은 뒤에 첫 문제를 그린다 — 뜻 칸 맞춤·잉크 측정이 대체 글꼴로 잰 값으로 남지 않게.
       fonts.ready 만으로는 아직 화면에 안 쓰인 글꼴을 기다리지 않으므로 init 이 건 요청을 함께 기다린다.
       ⚠ 타이머는 첫 문제가 뜰 때 함께 시작한다 — 전에는 기다리기 전에 시작해, 글꼴(430KB)이 늦으면
         빈 판에서 시간이 흘렀다(독립 검토 실측: 8초 지연에 02:56 · 블록 0개). 기다림은 FONT_WAIT_MS 까지만 —
         그 뒤에는 대체 글꼴로라도 판을 연다(font-display: block 의 3초와 같은 한도). */
    const ready = Promise.race([
      Promise.all([
        doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve(),
        app.koreanFontReady || Promise.resolve(true),
      ]),
      new Promise((resolve) => { global.setTimeout(resolve, FONT_WAIT_MS); }),
    ]);
    ready.then(() => {
      if (app.generation !== generation) return;
      startTimer();
      loadQuestion();
    });
  }

  // ============================================================
  // 결과
  // ============================================================
  /* 오답노트에 담는 기준(사장님 2026-10-15 "초과로 못 푼 문제: 틀린문제만", 2차 검수 SB공통-1 "3회 모두 틀려야 오답노트에 노출"):
     **3번 다 틀린 문제만** 담는다 — 담는 곳은 failWord 하나다. 시간이 끝나 못 푼 문제(그때 떠 있던 문제 · 아직 안 나온 문제)는 담지 않는다.
     예전(4차 q58 · 공통 9항 6번, 2026-09-29)에는 판이 끝날 때 못 맞힌 문항을 모두 담고 Incorrect 를 '전체 - 정답' 으로 셌는데,
     이 말씀으로 바뀌었다. 그래서 Correct + Incorrect 가 전체 문제수보다 적을 수 있다. */

  function endGame() {
    // 타이머 만료 틱과 마지막 문제 전환이 겹쳐도 결과 처리(기록 저장)는 한 번만 한다.
    if (el.endScreen && el.endScreen.classList.contains("is-visible")) return;
    nextGeneration();
    stopSound();
    stopTimer();
    // 끝나는 순간 떠 있던 증감·BONUS·터짐을 걷는다(OX 와 같다). 결과 화면은 하단 막대째 숨긴다.
    resetComboBurst();
    clearScoreDeltas();
    app.locked = true;
    const tally = app.flow ? app.flow.tally() : { correct: 0, incorrect: 0, total: app.rules.questionCount };
    sfx.effect(GRADE_ART[gradeOf(tally)].sound, 0.9);
    showResult(tally);
  }

  function showResult(tally) {
    sfx.stopBgm();   // 공통 9항 3번 — 소리 설정과 무관하게 결과화면에서는 배경음이 없다
    const score = app.scoreboard ? app.scoreboard.score : 0;
    const bonus = app.scoreboard ? app.scoreboard.bonusTotal : 0;
    if (el.resultScoreNumber) el.resultScoreNumber.textContent = formatScore(score);
    if (el.resultTotalScore) el.resultTotalScore.setAttribute("aria-label", `내 점수 ${formatScore(score)}점`);
    /* 2차 검수 공통-2(완료화면 통일, OX 방처럼): Correct · Incorrect 숫자 뒤 '개' 를 뺀다. Bonus 는 '+' 없이 숫자 뒤 '점' 이고,
       그 '점' 은 styles.css 의 .result-points::after 가 붙인다 — 세 줄의 숫자 끝이 한 줄로 맞도록 Correct · Incorrect 에도
       같은 폭의 보이지 않는 자리를 둔다. 읽어 주는 기기에는 단위까지 읽히게 aria-label 을 그대로 둔다. */
    if (el.resultCorrectPoints) {
      el.resultCorrectPoints.textContent = String(tally.correct);
      el.resultCorrectPoints.setAttribute("aria-label", `정답 ${tally.correct}개`);
    }
    if (el.resultIncorrectPoints) {
      /* 2차 검수 공통-10: 이 숫자와 Incorrect Answers 목록 줄 수가 같다 — 둘 다 3번 다 틀린 문제(app.wrongWords)를 센다.
         시간이 끝나 못 푼 문제는 세지 않는다(사장님 2026-10-15 "틀린문제만"). 예전의 '전체 - 정답'(공통 9항 6번)은 이 말씀으로 바뀌었다. */
      const missed = app.wrongWords.length;
      el.resultIncorrectPoints.textContent = String(missed);
      el.resultIncorrectPoints.setAttribute("aria-label", `오답 ${missed}개`);
    }
    if (el.resultBonusPoints) {
      el.resultBonusPoints.textContent = formatScore(bonus);
      el.resultBonusPoints.setAttribute("aria-label", `보너스 ${formatScore(bonus)}점`);
    }
    // 등급은 gradeOf 한 곳에서 정한다 — 그림·대체 글자·효과음·여우·파티클이 어긋나지 않는다.
    const art = GRADE_ART[gradeOf(tally)];
    if (el.resultTitle) {
      el.resultTitle.src = `assets/result/${art.image}.png?v=${ASSET_VERSION}`;
      el.resultTitle.alt = art.alt;
      /* 여우도 같은 판정에서 고른다 — 따로 판정하면 제목과 표정이 어긋난다.
         그림에 표정이 다 들어 있어 alt 는 비워 둔다(제목이 등급을 읽어 준다).
         **싣기 전에 감춘다** — 안 그러면 지난 판(또는 첫 판에는 마크업 초기) 그림이 먼저 보인다.
         푸는 것은 load 핸들러가 한다(한 번만 붙여 둔다). */
      if (el.resultFox) {
        el.resultFox.hidden = true;
        el.resultFox.src = `assets/result/${art.fox}.png?v=${FOX_VERSION}`;
      }
    }
    if (el.resultMessage) {
      el.resultMessage.textContent = `${tally.total}문제 중 ${tally.correct}개를 맞혔어요!`;
    }
    renderIncorrectAnswers();

    showScreen("endScreen");
    syncGlobalControls("result");
    if (el.tryAgainButton) el.tryAgainButton.focus();
    /* 2차 수정 공통 2절(결과 화면) · PDF 2쪽 1번: Try Again 일 때는 파티클이 없다.
       Good · Excellent 일 때만 뿌린다. 제목·여우와 같은 art(같은 판정)에서 고른다. */
    if (art.particles) runParticles();
    else clearParticles();
    saveResult(score);
  }

  // 오답 단어 목록. 없으면 버튼을 잠그고 "오답 없음"으로 알린다(형제 공통).
  function renderIncorrectAnswers() {
    const rows = app.wrongWords;
    if (el.incorrectAnswersButton) {
      /* 공통 9항 1번: 안 쓰는 버튼은 회색으로 두지 말고 자리까지 없앤다.
         .result-actions 가 가로 가운데 정렬이라, 하나가 빠지면 남은 하나가 저절로 가운데로 온다. */
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
    /* 2차 검수 공통-1(OX 방처럼): 줄은 흰 바탕 그대로이고, 스피커는 원 없이 파란 그림만 둔다.
       칸은 발음 · 단어 · 뜻 셋이고 틀린 횟수 칸은 없다. 모양은 styles.css 의 .incorrect-answer-* 가 정한다. */
    rows.forEach((row) => {
      const line = doc.createElement("div");
      line.className = "incorrect-answer-row incorrect-answer-grid";
      line.setAttribute("role", "row");

      const audio = doc.createElement("span");
      audio.className = "incorrect-answer-audio";
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
        button.addEventListener("click", () => playSound(row.soundUrl, { userAction: true }));
        audio.appendChild(button);
      }
      const english = doc.createElement("span");
      english.className = "incorrect-answer-word";
      english.setAttribute("role", "cell");
      english.textContent = row.english;
      const meaning = doc.createElement("span");
      meaning.className = "incorrect-answer-meaning";
      meaning.setAttribute("role", "cell");
      meaning.textContent = row.meaning;

      line.append(audio, english, meaning);
      el.incorrectAnswerList.appendChild(line);
    });
  }

  /* 4차 검수 q51: 완료화면 My Score 에는 순위를 내보내지 않는다 — 점수만 남는다.
     점수 저장은 그대로 한다. history 응답의 rank 는 받아도 화면에 쓰지 않는다.
     저장 실패는 예전처럼 조용히 넘긴다(이 방에는 저장 안내 문구가 없다). */
  function saveResult(score) {
    if (!Content) return;
    Promise.resolve()
      .then(() => Content.saveHistory(score))
      .catch(() => {});
  }

  // 간단한 색종이 파티클 (결과 축하)
  // 지난 판(Good·Excellent)의 조각이 캔버스에 남아 Try Again 화면에 보이지 않게 비운다.
  function clearParticles() {
    const canvas = el.resultParticleCanvas;
    if (!canvas || typeof canvas.getContext !== "function") return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

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
    let block = {};
    try {
      const raw = doc.getElementById("gameConfig");
      const parsed = raw ? JSON.parse(raw.textContent) : {};
      block = parsed && typeof parsed.block === "object" ? parsed.block : {};
      // 닫기 이동 주소(선택). 호스트가 주소에 안 붙였을 때 쓴다.
      app.closeUrl = parsed?.deployment?.closeUrl ?? "";
    } catch { block = {}; app.closeUrl = ""; }
    app.rules = {
      ...RULES,
      questionCount: Number(block.questionCount) || RULES.questionCount,
      timerSeconds: Number(block.timerSeconds) || RULES.timerSeconds,
      wrongChanceCost: Number(block.wrongChanceCost) || RULES.wrongChanceCost,
    };
  }

  /* 시작 화면의 동화 정보 — API info 의 title(시리즈 제목) · subtitle(이야기 제목)을 로고와 Start 버튼 사이에 두 줄로 보여 준다
     (2차 검수 공통-9, 사장님 2026-10-12 "동화API … 적용 배치는 시작화면 로고와 버튼 사이인데 비율 잘 조절해서"). OX 방 renderStartStory 와 같다.
     한 줄만 오면 그 줄만, 둘 다 없으면(테스트 모드 · 데모 · info 실패) 자리를 숨긴다 — 값을 지어 넣지 않는다. 레벨 · 번호는 넣지 않는다. */
  function renderStartStory(info) {
    if (!el.startStory) return;
    const title = String(info?.title ?? "").trim();
    const subtitle = String(info?.subtitle ?? "").trim();
    if (el.startStoryTitle) { el.startStoryTitle.textContent = title; el.startStoryTitle.hidden = !title; }
    if (el.startStorySubtitle) { el.startStorySubtitle.textContent = subtitle; el.startStorySubtitle.hidden = !subtitle; }
    el.startStory.hidden = !title && !subtitle;
  }

  /* 동화 정보 글자를 자리 폭에 맞춘다 — 길면 말줄임으로 자르지 않고 두 줄을 같은 배율로 줄인다
     (사장님이 OX 방에서 2026-10-12 "텍스트 범위는 지금 처럼 하돼 글자가 길어지면 폰트 크기를 줄이게"). OX fitStartStory 와 같은 법 —
     배율은 CSS 의 기준 크기에 곱하고, 바닥(0.5배)에서도 넘칠 때만 CSS 의 말줄임이 남는다. 화면에 보일 때만 잴 수 있다. */
  function fitStartStory() {
    const story = el.startStory;
    if (!story || story.hidden || app.screen !== "start") return;
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

  function onContentReady(snapshot) {
    app.launch = snapshot.launch;
    renderStartStory(snapshot.content.info);
    /* 2차 수정 공통 1절(한 판 시간) · 부모 원장 4b397d52067d0ca2 7번: API 의 play_time 을 먼저 쓴다.
       시간을 주지 않거나 info 요청이 실패하면 gameConfig(180초)를 그대로 쓴다. 상한·하한 없음. */
    app.apiPlayTimeSeconds = resolveRoundSeconds(snapshot.content.info?.play_time, 0);
    if (app.apiPlayTimeSeconds > 0) app.rules.timerSeconds = app.apiPlayTimeSeconds;
    app.questions = snapshot.content.questions.slice(0, app.rules.questionCount);
    if (app.questions.length === 0) { showLoadError("게임에 사용할 단어가 없습니다."); return; }
    enableStart();
  }

  function enableStart() {
    nextGeneration();
    stopSound();
    sfx.resumeBgm();
    sfx.preload();
    global.clearTimeout(advanceTimer); advanceTimer = 0;
    resetComboBurst();
    clearScoreDeltas();
    stopTimer();
    app.locked = true;
    if (el.answerReveal) el.answerReveal.hidden = true;
    closeModal(el.incorrectAnswerDialog);
    showScreen("startScreen");
    syncGlobalControls("start");
    if (el.startButton) { el.startButton.disabled = false; el.startButton.removeAttribute("aria-busy"); }
    if (el.helpButton) el.helpButton.disabled = false;
    // 동화 정보 글자 맞춤은 시작 화면이 보인 뒤에 잰다. 글꼴이 늦게 오면 폭이 달라지므로 받은 뒤에 한 번 더 잰다.
    fitStartStory();
    try {
      doc.fonts?.load?.('600 1em "Lexend"')?.then(() => fitStartStory(), () => {});
    } catch { /* 글꼴을 못 기다려도 지금 잰 값이 남는다 */ }
  }

  /* [앱 전용 자리] 앱 내 웹뷰를 닫는 인터페이스 호출을 이 함수 안에 넣는다 — LF 가 앱(Android · iOS)에 올릴 때 직접 작업한다.
     지금은 비어 있다. 화면에 알림은 띄우지 않는다.
     2차 검수 공통-12(사장님 2026-10-12 "closeAppWebView() … 모든 컨텐츠에 적용"): 12개 게임 모두 같은 이름의 빈 함수를 두고
     게임을 닫는 X 에서 같은 차례로 부른다 — 이것이 리틀폭스에 알려 줄 인터페이스다(OX 방 판 -25 와 같다). */
  function closeAppWebView() {}

  /* 시작 화면의 X(게임 닫기). 결과 화면 X · 도움말 뒤로가기 · 게임 중 X 는 시작 화면으로 돌아갈 뿐이라 여기를 타지 않는다.
     차례(2차 검수 공통-12, OX 방과 같은 차례): ① 이 방의 닫기 알림(spellingbuilder:navigate) — 호스트가 막으면 끝
       ② closeAppWebView() ③ 창 닫기(웹은 새 창으로 열리므로 여기서 닫힌다)
       ④ 창이 안 닫혔으면(사람이 연 탭 · 링크로 들어온 같은 탭 · 앱 웹뷰) 같은 자리 close_url · 설정의 closeUrl 이 있으면 그리로(사장님 2026-09-30),
          없으면 이전 페이지(history.back) — OX 방 · 수정사항 문서와 같게 조건 없이 뒤로 간다. 예전에는 referrer 가 같은 자리일 때만
          뒤로 가서, 다른 자리에서 들어왔거나 referrer 가 빈 경우(앱 웹뷰) X 가 아무 일도 하지 않았다(2026-10-15 독립 검토).
     아무 문구도 띄우지 않는다 — 사장님 문구(2026-09-30) "close문구 사용안함", 그리고 fox 방의 "영어 Close 로 통일" 과
     나란히 올린 뒤 "이 방은 문구 없앰 그대로". 12방 중 문구 없는 방은 이 방뿐이며 알고 정한 것이다. */
  function closeGame() {
    const event = new global.CustomEvent("spellingbuilder:navigate", {
      detail: { screen: "close" },
      cancelable: true,
    });
    // 호스트가 preventDefault() 하면 여기서 끝낸다.
    if (!global.dispatchEvent(event)) return;

    closeAppWebView();
    /* 스크립트가 연 창만 닫힌다. 막히면 window.closed 가 false 로 남는다. */
    try { global.close(); } catch { /* 대개 막힌다 */ }
    if (global.closed) return;

    const here = global.location?.href || "";
    let fromQuery = "";
    try {
      fromQuery = new global.URLSearchParams(global.location?.search || "").get("close_url") || "";
    } catch { fromQuery = ""; }

    const target = sameOriginTarget(fromQuery, here) || sameOriginTarget(app.closeUrl, here);
    if (target) { global.location.assign(target); return; }

    /* 마지막. 돌아갈 페이지가 없으면 브라우저가 아무 일도 하지 않는다 — 문구는 띄우지 않는다. */
    global.history.back();
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
    if (el.blockField) {
      el.blockField.addEventListener("pointerdown", onFieldPointerDown);
      el.blockField.addEventListener("pointermove", onFieldPointerMove);
      el.blockField.addEventListener("pointerup", onFieldPointerUp);
      el.blockField.addEventListener("pointercancel", onFieldPointerCancel);
      // 드래그가 브라우저 기본 스크롤/선택으로 새지 않게 한다.
      el.blockField.addEventListener("dragstart", (event) => event.preventDefault());
      el.blockField.addEventListener("contextmenu", (event) => event.preventDefault());
    }

    // 어떤 조작이든 첫 클릭이면 배경음을 깨운다(브라우저 자동재생 제한 때문).
    el.stage?.addEventListener("click", () => sfx.startBgm(), { capture: true });
    el.startButton?.addEventListener("click", () => sfx.effect("touch", 0.7), { capture: true });
    el.startButton?.addEventListener("click", startGame);
    el.helpButton?.addEventListener("click", openHelp);
    el.helpRetryButton?.addEventListener("click", () => loadHelp(true));

    // 결과 화면의 두 버튼은 공통 9항 2번 뒤로 서로 다르다 — Try Again 은 새 판, 오른쪽 위 X 는 시작 화면(2차 검수 공통-3 으로 왼쪽 위에서 옮김).
    el.tryAgainButton?.addEventListener("click", startGame);
    /* 공통 9항 2번: 결과화면 위쪽 버튼은 "다시 하기"가 아니라 "시작 화면으로"다.
       enableStart 가 점수·타이머·오답 목록·열린 팝업을 모두 되돌린다.
       점수 저장은 showResult 에서 이미 보냈고 화면만 바뀌므로 끊기지 않는다. */
    /* 등급 그림이 실린 뒤에만 여우를 보여 준다. 한 번만 붙인다 —
       핸들러를 src 뒤에 붙여도 load 는 뜨지만(측정으로 확인됨), 매 판 다시 붙일 이유가 없다. */
    el.resultFox?.addEventListener("load", () => { el.resultFox.hidden = false; });

    el.resultReplayButton?.addEventListener("click", enableStart);
    el.incorrectAnswersButton?.addEventListener("click", () => {
      if (el.incorrectAnswersButton.disabled) return;
      openModal(el.incorrectAnswerDialog, el.incorrectAnswerCloseButton);
    });
    el.incorrectAnswerCloseButton?.addEventListener("click", () => closeModal(el.incorrectAnswerDialog));
    el.incorrectAnswerBackdrop?.addEventListener("click", () => closeModal(el.incorrectAnswerDialog));

    el.soundButton?.addEventListener("click", () => setMuted(!app.muted));
    el.navigationButton?.addEventListener("click", () => {
      if (app.screen === "help") { enableStart(); return; }
      if (app.screen === "game") { enableStart(); return; }
      // 시작 화면에서는 닫기 차례를 탄다.
      closeGame();
    });
    el.retryButton?.addEventListener("click", boot);

    /* 무대 크기가 바뀌면 동화 정보 글자를 다시 맞춘다 — 글자 크기는 cqw 라 비율은 같지만, 작은 화면에서 맞춘 배율이
       큰 화면에서 글꼴 힌팅 차이로 넘칠 수 있다(OX 방이 844×390 → 1920×1080 에서 겪은 일). */
    if (typeof global.ResizeObserver === "function" && el.stage) {
      new global.ResizeObserver(() => fitStartStory()).observe(el.stage);
    }

    doc.addEventListener("keydown", onKeydown);
  }

  /* 한글 글꼴을 받는다. 실패해도 게임은 대체 글꼴로 돌지만 숨기지 않고 콘솔에 남긴다
     (경로가 틀린 것을 깔린 글꼴이 조용히 가리지 않게 — @font-face 에 local() 을 두지 않은 것과 같은 이유). */
  function loadKoreanFont() {
    if (!doc.fonts || typeof doc.fonts.load !== "function") return Promise.resolve(false);
    const warn = () => global.console?.warn?.(`한글 글꼴 "${KOREAN_FONT_FAMILY}" 을 받지 못했다 — 대체 글꼴로 그린다. assets/font 경로를 확인할 것.`);
    try {
      return doc.fonts.load(`700 1em "${KOREAN_FONT_FAMILY}"`, "가")
        .then((faces) => {
          const loaded = Boolean(faces && faces.length > 0);
          if (!loaded) warn();
          return loaded;
        })
        .catch(() => { warn(); return false; });
    } catch {
      warn();
      return Promise.resolve(false);
    }
  }

  function init() {
    readConfig();
    // 블록 글꼴을 미리 로드해 첫 문제에서 글자가 늦게 뜨지 않게 한다.
    if (doc.fonts && typeof doc.fonts.load === "function") {
      try {
        doc.fonts.load('700 64px "SofiaProSoft"');
        doc.fonts.load('700 60px "Lexend"');
      } catch { /* noop */ }
    }
    app.koreanFontReady = loadKoreanFont();
    app.koreanFontReady.then(refitMeaningAfterFont);
    wireEvents();
    setMuted(false);
    boot();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
