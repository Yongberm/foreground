(function exposeWordMaze(global) {
  "use strict";

  /*
   * 단어 미로의 규칙
   *
   * - 이동은 상하좌우 4방향이다. 대각선은 쓰지 않는다.
   * - 입구는 항상 왼쪽 상단 (0행 0열)이다.
   * - 출구는 항상 마지막 열이다. 단어의 끝 철자가 마지막 열에 놓인다.
   * - 길은 하나다. 검수 r45 로 규칙이 바뀌었다. 예전에는 입구에 인접한 두 칸에
   *   모두 같은 글자(두 번째 철자)를 놓아 어느 쪽으로 가도 되게 했는데, 그러면
   *   찾아야 할 글자가 화면에 둘 보인다. "r 이 2개가 보여지면 안됩니다" 가
   *   그 이야기다. 이제 두 번째 철자는 인접 칸 중 하나에만 놓는다.
   * - 매 걸음마다 지금 칸의 이웃 중 다음 철자를 가진 칸은 정확히 하나여야 한다.
   *   지나온 칸도 함께 센다. 그러면 letters[i] 와 letters[i+2] 가 같은 단어
   *   (galaxy, telescope, level)는 가능한 배치가 0 이 되는데 — 바로 앞 칸은
   *   언제나 지금 칸의 이웃이기 때문이다 — 그런 단어는 isPlayableWord 가
   *   출제 단계에서 미리 걸러 낸다 (사용자 확정).
   * - 길은 맨 아래 행을 지나게 하되, 이는 필수가 아니라 선호다. 입구가
   *   0행이라 맨 아래 행에 닿으면 중간 행도 반드시 지나므로 사실상 "모든 행을
   *   쓴다"와 같은 뜻이다. 다만 길이가 cols+rows-1 보다 짧으면 기하학적으로
   *   불가능하다. 그럴 때는 조건을 풀어 출제한다 (사용자 확정).
   */

  const MIN_WORD_LENGTH = 5;
  const MAX_WORD_LENGTH = 12;
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
  const MAX_ATTEMPTS = 600;

  // 상하좌우만. 대각선 없음.
  const DIRECTIONS_4 = Object.freeze([[-1, 0], [1, 0], [0, -1], [0, 1]]);

  function isLetter(character) {
    return character >= "a" && character <= "z";
  }

  function wordLetters(text) {
    return String(text ?? "").trim().toLowerCase().split("");
  }

  /*
   * 기획서: 최소 배열 4*3, 최대 배열 6*4, 최대 12개 철자.
   *
   * 4방향에서는 한 걸음에 열이 하나 늘거나 행이 하나 바뀌거나 둘 중 하나다.
   * 왼쪽 상단에서 마지막 열까지 cols-1 걸음이 드므로 길이는 최소 cols+1 이어야
   * 한다. 맨 아래 행까지 들르려면 rows-1 걸음이 더 들어 cols+rows-1 이 되는데,
   * 그쪽은 필수가 아니라 선호다 (bottomRowFeasible 참고).
   *
   * 열 수는 될 수 있는 한 작게 잡는다. 그래야 맨 아래 행까지 들를 여유가 남아,
   * 5철자를 뺀 모든 길이에서 두 갈래 모두 격자 전체를 훑는다.
   */
  function chooseGrid(length) {
    if (length <= 6) return { cols: 4, rows: 3 };
    if (length === 7) return { cols: 5, rows: 3 };
    if (length === 8) return { cols: 6, rows: 3 };
    return { cols: 6, rows: 4 };
  }

  // 그 길이로 맨 아래 행을 밟고 마지막 열에서 끝낼 수 있는가.
  function bottomRowFeasible(length) {
    const grid = chooseGrid(length);
    return length >= grid.cols + grid.rows - 1;
  }

  // 입구는 항상 왼쪽 상단이다.
  function startIndexFor() {
    return 0;
  }

  /*
   * 검수 r45 를 문구 그대로 지키려면 letters[i] 와 letters[i+2] 가 같은 단어는
   * 낼 수 없다. i+1 번째 칸에 서면 방금 지나온 칸과 가야 할 칸이 둘 다 찾는
   * 글자를 들고 있는데, 바로 앞 칸은 언제나 이웃이라 격자를 키우든 줄이든
   * 길을 어떻게 꺾든 피할 수 없다(전수 탐색으로 가능한 배치 0 확인).
   * 그래서 출제 단계에서 미리 걸러 낸다 (사용자 확정).
   */
  function hasGapRepeat(letters) {
    for (let index = 0; index + 2 < letters.length; index += 1) {
      if (letters[index] === letters[index + 2]) return true;
    }
    return false;
  }

  function isPlayableWord(text) {
    const letters = wordLetters(text);
    if (letters.length < MIN_WORD_LENGTH || letters.length > MAX_WORD_LENGTH) return false;
    if (!letters.every(isLetter)) return false;
    return !hasGapRepeat(letters);
  }

  function neighborIndexes(index, grid) {
    const row = Math.floor(index / grid.cols);
    const col = index % grid.cols;
    const result = [];
    DIRECTIONS_4.forEach(([rowStep, colStep]) => {
      const nextRow = row + rowStep;
      const nextCol = col + colStep;
      if (nextRow < 0 || nextRow >= grid.rows) return;
      if (nextCol < 0 || nextCol >= grid.cols) return;
      result.push(nextRow * grid.cols + nextCol);
    });
    return result;
  }

  function isExit(index, grid) {
    return index % grid.cols === grid.cols - 1;
  }

  function shuffled(values, random) {
    const pool = values.slice();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool;
  }

  function rowsTouched(route, grid) {
    const seen = new Set();
    route.forEach((cellIndex) => seen.add(Math.floor(cellIndex / grid.cols)));
    return seen;
  }

  /*
   * 한 갈래의 경로를 찾는다. 비어 있는 칸은 필요한 철자로 채우면서 나아가고,
   * 막히면 채운 것을 되돌린다. 이미 글자가 있는 칸은 그 글자가 맞을 때만 쓴다.
   * 갈래끼리 같은 칸을 서로 다른 철자로 요구하는 충돌은 이 방식으로 걸러진다.
   *
   * wantRow 가 주어지면 그 행을 지나는 경로를 먼저 찾는다. 행 덮기를 맞추는 데
   * 쓰이며, 찾지 못하면 null 을 돌려 호출부가 조건 없이 다시 시도하게 한다.
   */
  function findRoute(branchIndex, options) {
    const { letters, grid, cells, siblings, random, wantRow } = options;
    const blocked = new Set(siblings);
    const visited = new Set([options.startIndex, branchIndex]);
    const path = [options.startIndex, branchIndex];

    /*
     * 검수 r45: 걸음마다 다음 철자를 가진 이웃이 하나뿐이어야 한다. 다 만든 뒤에
     * 세어 버리면 반복 글자가 있는 단어(level, telescope)에서 거의 매번 걸린다.
     * 그래서 놓는 순간에 두 방향으로 미리 막는다.
     *   - 새 칸이 이미 놓인 앞쪽 칸의 옆에 붙는데 그 칸이 찾던 다음 철자와 같은 경우
     *   - 지금 칸의 다른 이웃이 이미 이번 철자를 들고 있는 경우
     */
    function keepsChoiceUnique(next, step) {
      const letter = letters[step];
      const current = path[path.length - 1];
      // 지금 칸의 이웃 중 이번 철자를 든 칸이 이미 있으면 next 까지 둘이 된다.
      const currentNeighbors = neighborIndexes(current, grid);
      for (let i = 0; i < currentNeighbors.length; i += 1) {
        const other = currentNeighbors[i];
        if (other === next) continue;
        if (cells[other] === letter) return false;
      }
      // 새 칸이 앞쪽 어떤 칸의 이웃이면서, 그 칸이 찾던 다음 철자와 같으면 안 된다.
      for (let k = 0; k < path.length - 1; k += 1) {
        if (letters[k + 1] !== letter) continue;
        if (neighborIndexes(path[k], grid).indexOf(next) !== -1) return false;
      }
      return true;
    }

    function walk(step) {
      if (step >= letters.length) {
        if (wantRow === undefined) return true;
        return rowsTouched(path, grid).has(wantRow);
      }
      const current = path[path.length - 1];
      const isLastStep = step === letters.length - 1;
      const candidates = shuffled(
        neighborIndexes(current, grid).filter((next) => {
          if (visited.has(next) || blocked.has(next)) return false;
          if (isLastStep && !isExit(next, grid)) return false;
          return cells[next] === "" || cells[next] === letters[step];
        }),
        random,
      );

      for (let position = 0; position < candidates.length; position += 1) {
        const next = candidates[position];
        if (!keepsChoiceUnique(next, step)) continue;
        const wasFree = cells[next] === "";
        if (wasFree) cells[next] = letters[step];
        visited.add(next);
        path.push(next);
        if (walk(step + 1)) return true;
        path.pop();
        visited.delete(next);
        if (wasFree) cells[next] = "";
      }
      return false;
    }

    return walk(2) ? path.slice() : null;
  }

  /*
   * 경로에 쓰이지 않은 칸을 채운다. path[i]에 인접한 빈 칸에는 letters[i+1]을
   * 쓰지 않는다. 그 자리에 다음 철자가 놓이면 "인접하고 글자도 맞는데 오답"인
   * 칸이 생겨, 아이 입장에서 규칙이 깨진 것처럼 보인다.
   */
  function fillDistractors(options) {
    const { letters, grid, cells, routes, random } = options;
    const total = grid.cols * grid.rows;
    const onRoute = new Set();
    routes.forEach((route) => route.forEach((cellIndex) => onRoute.add(cellIndex)));

    const banned = [];
    for (let index = 0; index < total; index += 1) banned.push(new Set());
    routes.forEach((route) => {
      route.forEach((cellIndex, step) => {
        const nextLetter = letters[step + 1];
        if (!nextLetter) return;
        neighborIndexes(cellIndex, grid).forEach((neighbor) => {
          if (!onRoute.has(neighbor)) banned[neighbor].add(nextLetter);
        });
      });
    });

    for (let index = 0; index < total; index += 1) {
      if (cells[index] !== "") continue;
      const pool = ALPHABET.split("").filter((letter) => !banned[index].has(letter));
      const source = pool.length > 0 ? pool : ALPHABET.split("");
      cells[index] = source[Math.floor(random() * source.length)];
    }
  }

  function buildAttempt(letters, grid, branches, startIndex, random, needBottom) {
    const total = grid.cols * grid.rows;
    const cells = new Array(total).fill("");
    cells[startIndex] = letters[0];

    // 두 번째 철자는 인접 칸 하나에만 놓는다(검수 r45). 나머지 인접 칸은
    // 방해 글자가 되며, 아래 fillDistractors 가 두 번째 철자를 넣지 못하게 막는다.
    const branchIndex = shuffled(branches, random)[0];
    cells[branchIndex] = letters[1];

    const bottomRow = grid.rows - 1;
    const shared = { letters, grid, cells, startIndex, siblings: [], random };
    // 맨 아래 행을 지나는 경로를 먼저 찾고, 정 안 되면 조건 없이 찾는다.
    const route = (needBottom ? findRoute(branchIndex, { ...shared, wantRow: bottomRow }) : null)
      || findRoute(branchIndex, shared);
    if (!route) return null;
    if (needBottom && !rowsTouched(route, grid).has(bottomRow)) return null;

    const routes = [route];
    fillDistractors({ letters, grid, cells, routes, random });
    if (!singleChoiceEverywhere(letters, grid, cells, route)) return null;
    return { cells, routes, branchIndex };
  }

  /*
   * 걸음마다 "다음 철자를 가진 이웃"이 하나뿐인지 센다. 하나가 아니면 플레이어가
   * 어느 쪽인지 고를 수 없으므로 그 배치는 버린다.
   */
  /*
   * 걸음마다 지금 칸의 이웃 중 다음 철자를 든 칸이 정확히 하나인지 센다.
   * 지나온 칸도 함께 센다 — 검수 문구가 "찾는 철자가 2개 보이면 안 된다" 이므로
   * 눌리든 안 눌리든 화면에 둘 보이면 안 된다는 뜻으로 읽는다 (사용자 확정).
   * 이 기준을 지킬 수 없는 단어는 isPlayableWord 가 미리 걸러 낸다.
   */
  function singleChoiceEverywhere(letters, grid, cells, route) {
    for (let step = 0; step < letters.length - 1; step += 1) {
      const current = route[step];
      const wanted = letters[step + 1];
      let matches = 0;
      const neighbors = neighborIndexes(current, grid);
      for (let position = 0; position < neighbors.length; position += 1) {
        if (cells[neighbors[position]] === wanted) matches += 1;
      }
      if (matches !== 1) return false;
    }
    return true;
  }

  function createMaze(word, options) {
    const settings = options || {};
    const random = typeof settings.random === "function" ? settings.random : Math.random;

    if (!isPlayableWord(word)) {
      throw new Error(`미로로 만들 수 없는 단어입니다: ${word}`);
    }

    const letters = wordLetters(word);
    const grid = chooseGrid(letters.length);
    const total = grid.cols * grid.rows;
    const startIndex = startIndexFor();
    const branches = neighborIndexes(startIndex, grid);

    // 먼저 두 갈래 모두 맨 아래 행을 지나는 배치를 찾고, 못 찾으면 그 조건만
    // 풀어 다시 찾는다. 길이가 모자라 애초에 불가능하면 첫 단계는 건너뛴다.
    const canReachBottom = bottomRowFeasible(letters.length);
    for (let phase = canReachBottom ? 0 : 1; phase < 2; phase += 1) {
      const needBottom = phase === 0;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const built = buildAttempt(letters, grid, branches, startIndex, random, needBottom);
        if (!built) continue;
        return Object.freeze({
          word: letters.join(""),
          letters: Object.freeze(letters),
          cols: grid.cols,
          rows: grid.rows,
          cells: Object.freeze(built.cells),
          startIndex,
          // 검수 r45: 두 번째 철자가 놓인 칸 하나. 가이드는 첫 글자에만 쓰므로
          // 화면 표시에는 더 이상 쓰이지 않지만, 판정과 테스트에 필요해 남긴다.
          guideIndexes: Object.freeze([built.branchIndex]),
          exitIndexes: Object.freeze(
            Array.from({ length: total }, (_, index) => index).filter((index) => isExit(index, grid)),
          ),
          routes: Object.freeze(built.routes.map((route) => Object.freeze(route.slice()))),
          solution: Object.freeze(built.routes[0].slice()),
          usesBottomRow: needBottom,
        });
      }
    }

    throw new Error(`미로 경로를 만들지 못했습니다: ${word}`);
  }

  /*
   * 같은 철자가 여러 칸에 있으므로 정답 경로는 하나가 아니다. 미리 정해 둔
   * 경로와 대조하지 않고, 남은 철자를 출구까지 이을 수 있는지로 판정한다.
   */
  function completable(maze, visited, fromIndex, step) {
    if (step >= maze.letters.length) return isExit(fromIndex, maze);
    const isLastStep = step === maze.letters.length - 1;
    const candidates = neighborIndexes(fromIndex, maze).filter((next) => {
      if (visited[next]) return false;
      if (maze.cells[next] !== maze.letters[step]) return false;
      return !isLastStep || isExit(next, maze);
    });
    for (let position = 0; position < candidates.length; position += 1) {
      const next = candidates[position];
      visited[next] = true;
      const ok = completable(maze, visited, next, step + 1);
      visited[next] = false;
      if (ok) return true;
    }
    return false;
  }

  // progress는 지금까지 맞힌 칸 번호를 순서대로 담은 배열이다.
  function judge(maze, progress, clickedIndex) {
    const trail = Array.isArray(progress) ? progress : [];
    const step = trail.length;

    if (step >= maze.letters.length) return { correct: false, reason: "already_complete" };
    if (!Number.isInteger(clickedIndex) || clickedIndex < 0 || clickedIndex >= maze.cells.length) {
      return { correct: false, reason: "out_of_range" };
    }
    if (trail.indexOf(clickedIndex) !== -1) return { correct: false, reason: "visited" };

    if (step === 0) {
      if (clickedIndex !== maze.startIndex) return { correct: false, reason: "not_start" };
    } else if (neighborIndexes(trail[step - 1], maze).indexOf(clickedIndex) === -1) {
      return { correct: false, reason: "not_adjacent" };
    }

    if (maze.cells[clickedIndex] !== maze.letters[step]) return { correct: false, reason: "letter" };

    const isLastStep = step === maze.letters.length - 1;
    if (isLastStep && !isExit(clickedIndex, maze)) return { correct: false, reason: "not_exit" };

    const visited = new Array(maze.cells.length).fill(false);
    trail.forEach((cellIndex) => {
      visited[cellIndex] = true;
    });
    visited[clickedIndex] = true;
    if (!completable(maze, visited, clickedIndex, step + 1)) {
      return { correct: false, reason: "dead_end" };
    }

    return { correct: true, reason: "ok", complete: isLastStep };
  }

  /*
   * 지금 눌러야 할 칸들. 반짝임 가이드가 철자 진행에 맞춰 따라가도록 쓰인다.
   * 시작 전에는 입구 한 칸, 그 뒤로는 판정을 통과하는 이웃 칸들이다.
   */
  function nextCandidates(maze, progress) {
    const trail = Array.isArray(progress) ? progress : [];
    if (trail.length >= maze.letters.length) return [];
    if (trail.length === 0) return [maze.startIndex];
    return neighborIndexes(trail[trail.length - 1], maze)
      .filter((index) => judge(maze, trail, index).correct);
  }

  // 기회를 다 썼을 때 정답을 보여 주기 위한 경로. 지금까지 맞힌 칸에서 이어지는
  // 경로를 먼저 찾고, 없으면 생성 때의 경로를 그대로 쓴다.
  function solutionFrom(maze, progress) {
    const trail = Array.isArray(progress) ? progress : [];
    if (trail.length === 0) return maze.solution.slice();

    const visited = new Array(maze.cells.length).fill(false);
    trail.forEach((cellIndex) => {
      visited[cellIndex] = true;
    });
    const rest = [];

    function walk(fromIndex, step) {
      if (step >= maze.letters.length) return isExit(fromIndex, maze);
      const isLastStep = step === maze.letters.length - 1;
      const candidates = neighborIndexes(fromIndex, maze).filter((next) => {
        if (visited[next]) return false;
        if (maze.cells[next] !== maze.letters[step]) return false;
        return !isLastStep || isExit(next, maze);
      });
      for (let position = 0; position < candidates.length; position += 1) {
        const next = candidates[position];
        visited[next] = true;
        rest.push(next);
        if (walk(next, step + 1)) return true;
        rest.pop();
        visited[next] = false;
      }
      return false;
    }

    return walk(trail[trail.length - 1], trail.length)
      ? trail.concat(rest)
      : maze.solution.slice();
  }

  global.WordMaze = Object.freeze({
    MIN_WORD_LENGTH,
    MAX_WORD_LENGTH,
    isPlayableWord,
    chooseGrid,
    bottomRowFeasible,
    startIndexFor,
    neighborIndexes,
    isExit,
    createMaze,
    judge,
    nextCandidates,
    solutionFrom,
  });
})(typeof window !== "undefined" ? window : globalThis);
