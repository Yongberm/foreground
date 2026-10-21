(function exposeSpellingBuilderContent(global) {
  "use strict";

  const apiModule = global.SpellingBuilderApi;
  const mazeModule = global.WordMaze;

  // 도움말 API가 비어 있거나 데모로 돌 때 쓰는 기본 문구. 기획서의 규칙을 그대로
  // 옮긴 것이라 API 응답이 있으면 그쪽이 우선한다.
  const DEFAULT_HELP_ITEMS = Object.freeze([
    Object.freeze({
      title: "게임 방법",
      content: "위쪽에 한글 뜻이 나옵니다. 왼쪽 위 화살표가 가리키는 입구 칸부터 시작해, 위아래 양옆으로 붙은 칸만 순서대로 끌거나 눌러 단어를 완성하세요. 대각선으로는 갈 수 없습니다.",
    }),
    Object.freeze({
      title: "입구와 출구",
      content: "반짝이는 칸이 첫 철자입니다. 두 번째 철자부터는 반짝임이 없으니 이웃한 칸에서 직접 찾아 누르세요. 마지막 철자는 항상 오른쪽 끝 줄, 곧 출구에 있습니다.",
    }),
    Object.freeze({
      title: "기회",
      content: "한 문제에 기회는 3번입니다. 틀린 칸을 누를 때마다 기회가 1번 줄어듭니다. 세 번 틀리면 정답을 보여 주고 다음 문제로 넘어갑니다.",
    }),
    Object.freeze({
      title: "점수",
      content: "정답 +50점, 오답 -10점입니다. 3문제를 연속으로 맞히면 100점을 더 받습니다.",
    }),
    Object.freeze({
      title: "시간",
      content: "제한 시간은 3분 30초입니다. 시간이 끝나면 결과 화면으로 넘어갑니다.",
    }),
  ]);

  // 기획서: 총 10문제, 타이머 3분 30초.
  const QUESTION_COUNT = 10;
  const PLAY_TIME_SECONDS = 210;
  const TEST_MEMBER_ID = "LOCAL-TEST-MEMBER";
  const TEST_RANKING = Object.freeze({
    nickname: "Test Fox",
    best_score: 1800,
    badge_image: "",
    rankings: Object.freeze([
      Object.freeze({ nickname: "Test Fox", best_score: 1800 }),
      Object.freeze({ nickname: "Word Hero", best_score: 1500 }),
      Object.freeze({ nickname: "Little Star", best_score: 1200 }),
    ]),
  });

  const state = {
    launch: null,
    loading: { status: "idle", message: "", error: null },
    content: {
      info: null,
      words: [],
      questions: [],
      help: [],
      helpStatus: "idle",
    },
  };

  let apiClient = null;
  let bootstrapPromise = null;
  let helpPromise = null;

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  /*
   * 검수 4차 8항(2026-09-29): 서버가 준 글자 안의 이스케이프 문자와 HTML 엔티티를 실제 문자로 바꾼다.
   * 글자 그대로 온 "\n" 이 화면에 역슬래시와 n 으로 남던 문제다. 경계선 셋을 지킨다 —
   *   1) 화면에 보여 줄 글자에만 쓴다. 소리 주소·URL 은 값이 바뀌면 안 되므로 cleanText 그대로 둔다
   *   2) 태그(<br>)는 풀지 않는다. 화면에는 textContent 로만 넣으므로 태그를 살리려면 innerHTML 이
   *      필요하고, 그러면 서버가 준 글자가 화면 코드가 될 수 있다
   *   3) 한 번만 푼다. "&amp;amp;" 는 "&amp;" 까지만 간다
   * 기준 구현은 따라쓰기 spellingbuilder_write/app/content-loader.js 다.
   */
  const ESCAPES = Object.freeze({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0", "\\": "\\", "'": "'", '"': '"' });
  const ENTITIES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" });

  function decodeEscapes(text) {
    return text.replace(
      /\\(u\{[0-9a-fA-F]{1,6}\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[nrtbfv0\\'"])/g,
      (whole, body) => {
        if (body[0] === "u" || body[0] === "x") {
          const hex = body.replace(/^u\{|^u|^x|\}$/g, "");
          const code = Number.parseInt(hex, 16);
          return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return ESCAPES[body] ?? whole;
      },
    );
  }

  function decodeEntities(text) {
    return text.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (whole, body) => {
      if (body[0] === "#") {
        const code = Number.parseInt(body.slice(1).replace(/^[xX]/, ""), body[1] === "x" || body[1] === "X" ? 16 : 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[body.toLowerCase()] ?? whole;
    });
  }

  /* 화면에 그대로 보여 줄 글자에만 쓴다. */
  function decodeDisplayText(value) {
    const text = cleanText(value);
    if (!text) return "";
    return decodeEntities(decodeEscapes(text)).replace(/\r\n?/g, "\n").trim();
  }

  function contentError(message, code) {
    const error = new Error(message);
    error.name = "SpellingBuilderContentError";
    error.code = code || "CONTENT_ERROR";
    return error;
  }

  function readEmbeddedConfig() {
    const element = global.document?.querySelector?.("#gameConfig");
    if (!element) return {};
    try {
      const value = JSON.parse(element.textContent);
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function isLocalHostname(hostname) {
    const value = cleanText(hostname).toLowerCase();
    return value === "localhost"
      || value.endsWith(".localhost")
      || value === "127.0.0.1"
      || value === "::1"
      || value === "[::1]";
  }

  function readLaunchContext() {
    const params = new URLSearchParams(global.location?.search || "");
    const config = readEmbeddedConfig();
    const deployment = config?.deployment || {};
    const fcId = cleanText(params.get("fc_id"));
    const requestedFuId = cleanText(params.get("fu_id")) || null;
    const locale = cleanText(params.get("api-locale")) || apiModule.DEFAULT_LOCALE || "ko_KR";
    const protocol = cleanText(global.location?.protocol).toLowerCase();
    const localRuntime = protocol === "file:" || isLocalHostname(global.location?.hostname);
    const requestedTestMode = cleanText(params.get("test_mode")).toLowerCase();
    const testMode = localRuntime && (requestedTestMode === "guest" || requestedTestMode === "member")
      ? requestedTestMode
      : null;
    const fuId = testMode === "member"
      ? TEST_MEMBER_ID
      : testMode === "guest"
        ? null
        : requestedFuId;
    const explicitDemo = params.get("demo") === "1";

    return {
      fcId,
      fuId,
      locale,
      // 닫기 단추가 갈 곳. 주소를 거르는 것은 부르는 쪽에서 한다(script.js safeCloseTarget).
      closeUrl: cleanText(deployment.closeUrl),
      apiBaseUrl: cleanText(deployment.apiBaseUrl) || apiModule.BASE_URL,
      apiUserAgent: cleanText(deployment.apiUserAgent) || apiModule.DEFAULT_API_USER_AGENT,
      isGuest: !fuId,
      isDemo: !testMode && (explicitDemo || (localRuntime && !fcId)),
      isTest: Boolean(testMode),
      isLocalRuntime: localRuntime,
      testMode,
    };
  }

  function cloneRecord(value) {
    return value && typeof value === "object" ? { ...value } : value;
  }

  // 미로는 생성 시점에 고정된다. 얼려 둔 객체를 그대로 넘겨 호출부가 격자를
  // 건드려도 판정이 흔들리지 않게 한다.
  function cloneQuestion(question) {
    return { ...question, maze: question.maze };
  }

  function snapshot() {
    return {
      launch: state.launch ? { ...state.launch } : null,
      loading: { ...state.loading, error: cloneRecord(state.loading.error) },
      content: {
        info: cloneRecord(state.content.info),
        words: state.content.words.map((word) => ({ ...word })),
        questions: state.content.questions.map(cloneQuestion),
        help: state.content.help.map((item) => ({ ...item })),
        helpStatus: state.content.helpStatus,
      },
    };
  }

  function emitState() {
    if (typeof global.dispatchEvent !== "function" || typeof global.CustomEvent !== "function") {
      return;
    }
    global.dispatchEvent(new global.CustomEvent("spellingbuilder:content-state", {
      detail: snapshot(),
    }));
  }

  function setLoading(status, message, error = null) {
    state.loading = { status, message, error };
    emitState();
  }

  // API 원본 형태는 { text, mean, sound_url }이다. 미로에 올릴 수 없는 표제어는
  // 여기서 걸러 낸다.
  function normalizeVocabulary(items) {
    if (!Array.isArray(items)) {
      throw contentError("단어 목록 형식이 올바르지 않습니다.", "INVALID_VOCABULARY");
    }

    const words = items
      .map((item) => ({
        // 화면 글자는 풀어서, 소리 주소는 그대로 (검수 4차 8항).
        text: decodeDisplayText(item?.text),
        mean: decodeDisplayText(item?.mean),
        soundUrl: cleanText(item?.sound_url),
      }))
      /*
       * 2차 공통(단어 거름): 뜻 길이 거름(24자)은 걷는다. 긴 뜻은 뜻 칸이 글자를 줄여
       * 담는다(script.js fitMeaningText). 남기는 거름은 미로가 성립하지 않는 것뿐이다 —
       * 철자 5~12개(격자 크기), 영문자만(칸마다 알파벳 하나, 사장님 '남김'),
       * 한 칸 건너 같은 철자(전수 탐색으로 배치 0, maze.js hasGapRepeat).
       */
      .filter((item) => item.text
        && item.mean
        && mazeModule.isPlayableWord(item.text));

    if (words.length === 0) {
      throw contentError(
        `게임에는 철자 ${mazeModule.MIN_WORD_LENGTH}~${mazeModule.MAX_WORD_LENGTH}개인 영어 단어가 필요합니다.`,
        "INVALID_VOCABULARY",
      );
    }
    return words;
  }

  function pickIndexes(count, size, random) {
    const pool = Array.from({ length: count }, (_, index) => index);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool.slice(0, size);
  }

  function questionFromWord(word, random) {
    return {
      english: word.text,
      meaning: word.mean,
      soundUrl: word.soundUrl,
      maze: mazeModule.createMaze(word.text, { random }),
    };
  }

  function createMazeQuestions(words, random = Math.random) {
    if (!Array.isArray(words) || words.length === 0) {
      throw contentError("문제로 쓸 단어가 없습니다.", "INVALID_VOCABULARY");
    }
    const playable = words.filter((word) => word
      && typeof word.text === "string"
      && typeof word.mean === "string"
      && mazeModule.isPlayableWord(word.text));
    if (playable.length === 0) {
      throw contentError("미로로 만들 수 있는 단어가 없습니다.", "INVALID_VOCABULARY");
    }
    const selection = pickIndexes(playable.length, Math.min(QUESTION_COUNT, playable.length), random);
    return selection.map((position) => questionFromWord(playable[position], random));
  }

  /*
   * 데모·테스트 단어도 목록으로 남겨 둔다. 예전에는 문제만 만들고 목록을 버려서
   * 다시하기가 같은 열 문제를 같은 순서로 되풀이했다(미로만 새로 그림).
   */
  function demoWords(config) {
    const source = Array.isArray(config?.demo?.words) ? config.demo.words : config?.words;
    const words = Array.isArray(source)
      ? source
        .map((word) => ({
          text: decodeDisplayText(word?.text),
          mean: decodeDisplayText(word?.mean),
          soundUrl: cleanText(word?.sound_url ?? word?.soundUrl),
        }))
        .filter((word) => word.text && word.mean && mazeModule.isPlayableWord(word.text))
      : [];
    if (words.length === 0) {
      throw contentError("데모 단어 목록이 비어 있습니다.", "INVALID_VOCABULARY");
    }
    return words;
  }

  function normalizeHelp(items) {
    return Array.isArray(items)
      ? items
        .map((item) => ({ title: decodeDisplayText(item?.title), content: decodeDisplayText(item?.content) }))
        .filter((item) => item.title || item.content)
      : [];
  }

  function defaultHelpItems() {
    return DEFAULT_HELP_ITEMS.map((item) => ({ ...item }));
  }

  function loadHelpInBackground() {
    if (!apiClient) {
      state.content.help = defaultHelpItems();
      state.content.helpStatus = "ready";
      emitState();
      return Promise.resolve(state.content.help.map((item) => ({ ...item })));
    }
    if (helpPromise) return helpPromise;

    state.content.helpStatus = "loading";
    emitState();
    helpPromise = apiClient.getHelp()
      .then((items) => {
        const normalized = normalizeHelp(items);
        state.content.help = normalized.length > 0 || !state.launch?.isDemo
          ? normalized
          : defaultHelpItems();
        state.content.helpStatus = "ready";
        emitState();
        return state.content.help.map((item) => ({ ...item }));
      })
      .catch((error) => {
        if (state.launch?.isDemo) {
          state.content.help = defaultHelpItems();
          state.content.helpStatus = "ready";
          emitState();
          return state.content.help.map((item) => ({ ...item }));
        }
        state.content.helpStatus = "error";
        emitState();
        throw error;
      });
    helpPromise.catch(() => {});
    return helpPromise;
  }

  function getHelp(options = {}) {
    if (options.retry && state.content.helpStatus === "error") {
      helpPromise = null;
    }
    return loadHelpInBackground();
  }

  function playTimeSeconds() {
    const raw = Number(state.content.info?.play_time);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : PLAY_TIME_SECONDS;
  }

  /*
   * 2차 검수 공통-9: 시작 화면 동화 정보. 이미 받고 있는 info 응답의 title · subtitle 을 쓴다
   * (API 명세서 v1.2 GET /api/v1/game/voca/info). 레벨과 번호는 넣지 않는다. info 를 못 받았거나
   * 데모 · 제목 없음이면 빈 값이고, 그때 시작 화면은 동화 정보만 숨긴다.
   */
  function storyInfo() {
    const info = state.content.info;
    return {
      title: decodeDisplayText(info?.title),
      subtitle: decodeDisplayText(info?.subtitle),
    };
  }

  async function runBootstrap() {
    const launch = readLaunchContext();
    const config = readEmbeddedConfig();
    state.launch = launch;
    state.content = { info: null, words: [], questions: [], help: [], helpStatus: "idle" };
    apiClient = null;
    helpPromise = null;
    setLoading("loading", "게임 데이터를 불러오는 중입니다.");

    try {
      if (launch.isTest) {
        // 테스트 회원은 진짜 회원이 아니다. 박아 둔 단어에는 발음 주소가 없으므로
        // 다른 소리를 끼워 넣어 발음인 척하지 않는다 — 주소가 없으면 화면에서
        // 발음 버튼 자체가 사라진다(사용자 지시).
        state.content.words = demoWords(config);
        state.content.questions = createMazeQuestions(state.content.words);
        state.content.info = {
          source: `test-${launch.testMode}`,
          play_time: Number(config?.demo?.info?.play_time) || PLAY_TIME_SECONDS,
        };
      } else if (launch.isDemo) {
        // 데모는 서버를 쓰지 않는다. 예전에는 여기서 API 클라이언트를 만들었는데,
        // 그러면 도움말만이 클라이언트를 쓰는 바람에 file:// 로 연 페이지가
        // 리뷰 서버로 요청을 한 번 쏘고 CORS로 막혀 최대 10초를 기다렸다.
        // 랭킹과 점수 저장은 이미 데모에서 빠져나가므로 null로 두면 된다.
        const demo = config?.demo || {};
        state.content.words = demoWords(config);
        state.content.questions = createMazeQuestions(state.content.words);
        state.content.info = {
          ...(demo.info && typeof demo.info === "object" ? demo.info : {}),
          source: "demo",
        };
      } else {
        if (!launch.fcId) {
          throw contentError("게임 실행 파라미터 fc_id가 없습니다.", "MISSING_FC_ID");
        }
        apiClient = apiModule.createClient({
          baseUrl: launch.apiBaseUrl,
          locale: launch.locale,
          apiUserAgent: launch.apiUserAgent,
        });
        /*
         * 2차 공통 4절: info 와 단어 목록을 Promise.all 로 묶어 두면 info 요청 하나만
         * 실패해도 판이 열리지 않는다. info 는 한 판 시간만 주므로 실패하면 빈 값으로
         * 두고 playTimeSeconds() 가 기본 210초를 쓴다. 단어 목록 실패는 지금처럼 오류다.
         */
        const [info, vocabulary] = await Promise.all([
          apiClient.getGameInfo(launch.fcId).catch(() => null),
          apiClient.getVocabularyList(launch.fcId),
        ]);
        const words = normalizeVocabulary(vocabulary);
        state.content.info = info && typeof info === "object" ? { ...info } : {};
        state.content.words = words;
        state.content.questions = createMazeQuestions(words);
      }

      setLoading(
        "ready",
        launch.isTest
          ? `${launch.testMode === "member" ? "로그인" : "게스트"} 테스트 준비 완료`
          : launch.isDemo
            ? "데모 준비 완료"
            : "게임 준비 완료",
      );
      void loadHelpInBackground();
      return snapshot();
    } catch (error) {
      setLoading("error", error?.message || "게임 데이터를 불러오지 못했습니다.", {
        code: error?.code || "CONTENT_LOAD_ERROR",
        message: error?.message || "알 수 없는 오류",
      });
      throw error;
    }
  }

  function bootstrap(options = {}) {
    if (options.force) bootstrapPromise = null;
    if (!bootstrapPromise) {
      bootstrapPromise = runBootstrap().catch((error) => {
        bootstrapPromise = null;
        throw error;
      });
    }
    return bootstrapPromise;
  }

  /*
   * 다시하기는 같은 단어 목록에서 문제와 미로를 새로 뽑는다.
   * 2차 공통(다시 시작): 앞 판 마지막 단어로 시작하지 않는다. 뽑은 첫 문제가 그
   * 단어면 다른 문제와 자리를 바꾼다. 바꿀 다른 단어가 없으면 그대로 연다 — 판은 늘 열린다.
   */
  function avoidFirstWord(questions, avoid) {
    if (!avoid || questions.length < 2 || questions[0].english !== avoid) return questions;
    const swapAt = questions.findIndex((question) => question.english !== avoid);
    if (swapAt < 0) return questions;
    const reordered = questions.slice();
    [reordered[0], reordered[swapAt]] = [reordered[swapAt], reordered[0]];
    return reordered;
  }

  function rebuildQuestions(options = {}) {
    const avoid = typeof options.avoidFirst === "string" ? options.avoidFirst : "";
    if (state.content.words.length > 0) {
      state.content.questions = avoidFirstWord(createMazeQuestions(state.content.words), avoid);
    } else if (state.content.questions.length > 0) {
      // 지금은 닿지 않는 갈래다(데모·테스트도 목록을 남긴다). 닿더라도 첫 단어 규칙은 지킨다.
      state.content.questions = avoidFirstWord(state.content.questions.map((question) => ({
        ...question,
        maze: mazeModule.createMaze(question.english, {}),
      })), avoid);
    }
    emitState();
    return snapshot().content.questions;
  }

  function requireLiveClient() {
    if (!state.launch || !apiClient) {
      throw contentError("게임 데이터 로더가 준비되지 않았습니다.", "CONTENT_NOT_READY");
    }
  }

  function getRanking() {
    if (!state.launch) {
      throw contentError("게임 데이터 로더가 준비되지 않았습니다.", "CONTENT_NOT_READY");
    }
    if (state.launch.isTest) {
      if (state.launch.isGuest) {
        throw contentError("게스트 테스트 모드에서는 랭킹 기능을 사용할 수 없습니다.", "GUEST_NOT_ALLOWED");
      }
      return Promise.resolve({
        nickname: TEST_RANKING.nickname,
        best_score: TEST_RANKING.best_score,
        badge_image: TEST_RANKING.badge_image,
        rankings: TEST_RANKING.rankings.map((entry) => ({ ...entry })),
      });
    }
    if (state.launch.isDemo) {
      throw contentError("데모 모드에서는 랭킹 기능을 사용할 수 없습니다.", "DEMO_NOT_ALLOWED");
    }
    if (state.launch.isGuest) {
      throw contentError("게스트는 랭킹 기능을 사용할 수 없습니다.", "GUEST_NOT_ALLOWED");
    }
    requireLiveClient();
    return apiClient.getRanking(state.launch.fuId);
  }

  function saveHistory(score) {
    const numericScore = Math.trunc(Number(score));
    if (!Number.isFinite(numericScore)) {
      throw contentError("점수는 숫자여야 합니다.", "INVALID_SCORE");
    }
    if (!state.launch) {
      throw contentError("게임 데이터 로더가 준비되지 않았습니다.", "CONTENT_NOT_READY");
    }
    // 데모와 테스트는 실제 기록을 남기지 않는다. 화면 흐름만 이어 준다.
    if (state.launch.isTest || state.launch.isDemo || state.launch.isGuest) {
      return Promise.resolve({ saved: false, rank: 0, score: numericScore });
    }
    requireLiveClient();
    return apiClient.saveHistory({ fuId: state.launch.fuId, score: numericScore });
  }

  global.SpellingBuilderContent = Object.freeze({
    bootstrap,
    rebuildQuestions,
    getHelp,
    getRanking,
    saveHistory,
    getState: snapshot,
    readLaunchContext,
    createMazeQuestions,
    normalizeVocabulary,
    playTimeSeconds,
    storyInfo,
    QUESTION_COUNT,
    PLAY_TIME_SECONDS,
  });
})(window);
