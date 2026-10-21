(function installSpellingBuilderContent(global) {
  "use strict";

  const apiModule = global.SpellingBuilderApi;
  if (!apiModule) {
    throw new Error("SpellingBuilderApi가 먼저 로드되어야 합니다.");
  }

  // 워드파이프 도움말 기본 문구. API help가 비거나 실패할 때만 쓴다.
  const DEFAULT_HELP_ITEMS = Object.freeze([
    Object.freeze({
      title: "게임 방법",
      content: "한글 뜻을 보고 파이프 위의 철자 방울을 순서대로 누르세요.\n순서가 맞으면 철자가 아래 칸으로 모여 단어가 완성됩니다.",
    }),
    Object.freeze({
      title: "기회 · 점수",
      content: "한 문제의 기회는 3번이에요. 순서가 틀리면 1번, 단어에 없는 철자를 누르면 2번 줄어듭니다.\n정답 철자는 +50점, 오답은 -10점, 3문제 연속 정답이면 +100점 보너스!",
    }),
    Object.freeze({
      title: "랭킹",
      content: "얻은 점수가 랭킹에 기록됩니다.\n랭킹은 로그인한 회원만 볼 수 있어요.",
    }),
  ]);

  // 사양(워드파이프): 총 12문제 · 타이머 3분30초.
  const QUESTION_COUNT = 12;
  /* 파이프 슬롯이 13곳이고 오답 철자를 2개씩 더 놓으므로 단어는 11글자까지다.
     2차 수정(사장님 "둘 다 남긴다", 2026-10-02): 영어 길이 · 알파벳 거름은 판의 구조 때문에 남긴다.
     12~13자는 오답 철자를 사양(+2개)보다 줄여야 들어가고 14자부터는 자리가 모자란다.
     띄어쓰기 · 기호는 누를 방울이 될 수 없다. 검수 API 9레벨 320개 중 이 둘로 빠지는 것은 49개다. */
  const MAX_WORD_LENGTH = 11;
  const MIN_WORD_LENGTH = 1;
  /* 2차 수정(공통 1절 · 블록 · 따라쓰기와 같은 답): 뜻 길이 거름(12자)은 걷었다.
     서버가 준 뜻은 그대로 내고 화면이 칸에 맞게 줄인다(script.js fitMeaning). 이 거름 하나로
     검수 API 320개 중 178개가 빠져 LV1~5 가 12문제를 못 채웠다. */
  const TEST_MEMBER_ID = "LOCAL-TEST-MEMBER";
  const TEST_RANKING = Object.freeze({
    nickname: "Test Fox",
    best_score: 1200,
    badge_image: "",
    rankings: Object.freeze([
      Object.freeze({ nickname: "Test Fox", best_score: 1200 }),
      Object.freeze({ nickname: "Word Hero", best_score: 980 }),
      Object.freeze({ nickname: "Little Star", best_score: 640 }),
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

  /* 검수 4차 8항(2026-09-29): 서버가 준 글자 안의 이스케이프 문자와 HTML 엔티티를
     실제 문자로 바꾼다. 글자 그대로 온 "\n" 이 화면에 역슬래시와 n 으로 남던 문제다.
     경계선 셋 — 화면에 보이는 글자에만 쓰고(소리 주소·URL 은 값이 바뀌면 안 된다),
     태그(<br>)는 일부러 풀지 않으며(화면에는 textContent 로만 넣는다), 한 번만 푼다. */
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

  // 화면에 그대로 보여 줄 글자에만 쓴다. URL·식별자에는 쓰지 않는다(값이 바뀌면 안 된다).
  function decodeDisplayText(value) {
    const text = cleanText(value);
    if (!text) return "";
    return decodeEntities(decodeEscapes(text)).replace(/\r\n?/g, "\n").trim();
  }

  function contentError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function isLetter(character) {
    return /^[a-z]$/i.test(character);
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

  // 기동 컨텍스트: URL 쿼리(fc_id, fu_id, api-locale, test_mode, demo)를 읽어
  // 회원/게스트/데모/테스트 상태를 파생한다. test_mode는 로컬 런타임에서만 해석된다.
  function readLaunchContext() {
    const params = new URLSearchParams(global.location?.search || "");
    const config = readEmbeddedConfig();
    const deployment = config?.deployment || {};
    const fcId = cleanText(params.get("fc_id"));
    const requestedFuId = cleanText(params.get("fu_id")) || null;
    const locale = cleanText(params.get("api-locale"))
      || apiModule.DEFAULT_LOCALE
      || "ko_KR";
    const protocol = cleanText(global.location?.protocol).toLowerCase();
    const localRuntime = protocol === "file:"
      || isLocalHostname(global.location?.hostname);
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
    const apiBaseUrl = cleanText(deployment.apiBaseUrl) || apiModule.BASE_URL;
    const apiUserAgent = cleanText(deployment.apiUserAgent) || apiModule.DEFAULT_API_USER_AGENT;

    return {
      fcId,
      fuId,
      locale,
      apiBaseUrl,
      apiUserAgent,
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

  function cloneQuestion(question) {
    return { ...question, letters: [...question.letters] };
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

  // 파이프에 올릴 수 있는 단어: 1~11글자이고 모든 문자가 알파벳이어야 한다.
  // 공백/기호가 섞인 단어(예: "ice cream")나 12글자 이상은 슬롯 수를 벗어나 제외한다.
  function isPlayableWord(text) {
    const letters = [...cleanText(text)];
    if (letters.length < MIN_WORD_LENGTH || letters.length > MAX_WORD_LENGTH) return false;
    return letters.every(isLetter);
  }

  // 시안(프리뷰): 방울·트레이 철자는 전부 소문자다.
  function displayLetters(text) {
    return [...cleanText(text).toLowerCase()];
  }

  function questionFromWord(word) {
    return {
      english: word.text,
      meaning: word.mean,
      soundUrl: word.soundUrl,
      letters: displayLetters(word.text),
    };
  }

  function pickIndexes(count, size, random) {
    const pool = Array.from({ length: count }, (_, index) => index);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool.slice(0, size);
  }

  function normalizeVocabulary(items) {
    if (!Array.isArray(items)) {
      throw contentError("단어 목록 형식이 올바르지 않습니다.", "INVALID_VOCABULARY");
    }
    const words = items
      .map((item) => ({
        // 화면에 보이는 글자만 푼다 — 소리 주소는 값이 바뀌면 안 되므로 cleanText 로만 다듬는다(8항).
        text: decodeDisplayText(item?.text),
        mean: decodeDisplayText(item?.mean),
        soundUrl: cleanText(item?.sound_url),
      }))
      // 빈 단어 · 빈 뜻처럼 게임이 성립하지 않는 것과, 판에 올릴 수 없는 영어만 뺀다(뜻 길이는 보지 않는다).
      .filter((item) => item.text
        && item.mean
        && isPlayableWord(item.text));

    if (words.length === 0) {
      throw contentError(
        `게임에는 1~${MAX_WORD_LENGTH}글자 영어 단어가 필요합니다.`,
        "INVALID_VOCABULARY",
      );
    }
    return words;
  }

  // 사양: 12문제를 랜덤으로 뽑는다. 단어가 12개보다 적으면 있는 만큼 낸다.
  function createQuestions(words, random = Math.random) {
    if (!Array.isArray(words) || words.length === 0) {
      throw contentError("문제로 만들 단어가 없습니다.", "INVALID_VOCABULARY");
    }
    const playable = words.filter((word) => word
      && typeof word.text === "string"
      && typeof word.mean === "string"
      && isPlayableWord(word.text));
    if (playable.length === 0) {
      throw contentError(
        `게임에는 1~${MAX_WORD_LENGTH}글자 영어 단어가 필요합니다.`,
        "INVALID_VOCABULARY",
      );
    }
    const selection = pickIndexes(playable.length, Math.min(QUESTION_COUNT, playable.length), random);
    return selection.map((position) => questionFromWord(playable[position]));
  }

  function normalizeDemoQuestions(config, random = Math.random) {
    const source = Array.isArray(config?.demo?.words) ? config.demo.words : config?.words;
    const words = Array.isArray(source)
      ? source
        .map((word) => ({
          text: cleanText(word?.text),
          mean: cleanText(word?.mean),
          soundUrl: cleanText(word?.soundUrl || word?.sound_url),
        }))
        .filter((word) => word.text && word.mean && isPlayableWord(word.text))
      : [];
    if (words.length === 0) {
      throw contentError("개발용 데모 단어가 없습니다.", "INVALID_DEMO_QUESTIONS");
    }
    return createQuestions(words, random);
  }

  /* 2차 수정(공통 1절 '도움말 특수 문자'): 도움말도 화면에 보이는 글자라 단어와 같은 규칙으로 푼다.
     검수 API help 본문에는 "\n" 이 글자 그대로 들어 있어 화면에 역슬래시와 n 이 보였다.
     알아볼 수 있는 것(\n · \u… · &amp; 등)만 풀고, 잘못된 코드는 그대로 둔다(decodeDisplayText). */
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
        state.content.questions = normalizeDemoQuestions(config);
        state.content.info = { source: `test-${launch.testMode}` };
      } else if (launch.isDemo) {
        apiClient = apiModule.createClient({
          baseUrl: launch.apiBaseUrl,
          locale: launch.locale,
          apiUserAgent: launch.apiUserAgent,
        });
        const demo = config?.demo || {};
        state.content.questions = normalizeDemoQuestions(config);
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
        /* 2차 공통 4절: info 와 단어 목록을 Promise.all 로 묶으면 info 하나만 실패해도 판이 열리지 않는다.
           단어만 있으면 게임은 성립하므로 info 실패는 null 로 받고, 한 판 시간은 지금 값을 쓴다. */
        const [info, vocabulary] = await Promise.all([
          apiClient.getGameInfo(launch.fcId).catch(() => null),
          apiClient.getVocabularyList(launch.fcId),
        ]);
        const words = normalizeVocabulary(vocabulary);
        state.content.info = info && typeof info === "object" ? { ...info } : {};
        state.content.words = words;
        state.content.questions = createQuestions(words);
      }

      setLoading(
        "ready",
        launch.isTest
          ? `${launch.testMode === "member" ? "로그인" : "게스트"} 테스트 준비 완료`
          : launch.isDemo ? "데모 준비 완료" : "게임 준비 완료",
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

  /* 2차 공통 1절(OX 사장님 답): 다시 시작할 때 앞 판 마지막에 나온 단어로 바로 시작하지 않는다.
     첫 문제가 그 단어면 그 단어가 아닌 가장 앞의 문제와 자리를 바꾼다. 바꿀 단어가 없으면(단어 1개)
     그대로 둔다 — 판은 늘 열린다. 새로 고침하면 기억하지 않는다(앞 단어는 script 가 들고 있다). */
  function avoidFirstQuestion(questions, avoidText) {
    const list = Array.isArray(questions) ? questions.slice() : [];
    const key = (value) => cleanText(value).toLowerCase();
    const avoid = key(avoidText);
    if (!avoid || list.length < 2 || key(list[0]?.english) !== avoid) return list;
    const swapIndex = list.findIndex((question, index) => index > 0 && key(question?.english) !== avoid);
    if (swapIndex > 0) [list[0], list[swapIndex]] = [list[swapIndex], list[0]];
    return list;
  }

  // 사양: 매 판마다 문제를 다시 뽑는다(같은 단어 목록이라도 순서를 새로 섞는다).
  // 데모 · 시험은 단어 목록이 따로 없어 순서가 그대로이므로, 앞 단어 피하기만 한다.
  function rebuildQuestions(options = {}) {
    if (state.content.words.length > 0) {
      state.content.questions = createQuestions(state.content.words);
    }
    state.content.questions = avoidFirstQuestion(state.content.questions, options.avoid);
    return state.content.questions.map(cloneQuestion);
  }

  function getHelp(options = {}) {
    if (options.retry && state.content.helpStatus === "error") {
      helpPromise = null;
    }
    return loadHelpInBackground();
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

  // 사양: 획득 점수(정답 +50 · 오답 -10 · 연속 보너스 +100 합산)를 저장한다.
  function saveHistory(score) {
    const numericScore = Math.trunc(Number(score));
    if (!Number.isFinite(numericScore)) {
      throw contentError("저장할 점수가 올바르지 않습니다.", "INVALID_SCORE");
    }
    if (state.launch?.isTest) {
      return Promise.resolve({ test: true, rank: state.launch.isGuest ? 0 : 1, score: numericScore });
    }
    if (state.launch?.isDemo) {
      return Promise.resolve({ skipped: true, rank: 0, score: numericScore });
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
    createQuestions,
    avoidFirstQuestion,
    normalizeVocabulary,
    normalizeHelp,
    displayLetters,
    decodeDisplayText,
    isPlayableWord,
    QUESTION_COUNT,
    MAX_WORD_LENGTH,
  });
})(window);
