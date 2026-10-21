(function installSpellingBuilderContent(global) {
  "use strict";

  const apiModule = global.SpellingBuilderApi;
  if (!apiModule) {
    throw new Error("SpellingBuilderApi가 먼저 로드되어야 합니다.");
  }

  // 따라쓰기(1단계) 도움말 기본 문구. API help가 비거나 실패할 때만 쓴다.
  const DEFAULT_HELP_ITEMS = Object.freeze([
    Object.freeze({
      title: "게임 방법",
      content: "화면 가운데 글자를 손가락이나 마우스로 따라 칠하세요.\n한 글자를 다 칠하면 다음 글자가 나옵니다.",
    }),
    Object.freeze({
      title: "단어 완성",
      content: "단어의 모든 글자를 칠하면 단어와 소리를 확인할 수 있어요.\n확인 버튼을 누르면 다음 문제로 넘어갑니다.",
    }),
    Object.freeze({
      title: "랭킹",
      content: "완성한 단어 수가 랭킹에 기록됩니다.\n랭킹은 로그인한 회원만 볼 수 있어요.",
    }),
  ]);

  // 사양(따라쓰기 1단계): 전체 5문항.
  // 2차 수정(사장님 "판에 안 들어간다는 근거를 보일 때만 남김", 2026-10-01): 길이 거름(영어 1~7자 · 뜻 12자)은 걷었다.
  // 검수 API LV1~9 의 320개 가운데 뜻 12자 거름이 178개, 영어 8자 이상 거름이 127개를 빼고 있었는데,
  // 글자 줄에 13칸(가장 긴 a-z 단어 craftsmanship)을 깔아 재 보니 1632px 로 1920 무대 안에 들어갔다.
  // 그보다 긴 단어는 script.js 가 칸을 줄여 맞춘다. 뜻은 간판 안에서 글자를 줄여 맞춘다.
  // 남긴 것: a-z 거름 — 따라쓰기 안내 자산(trace-assets.js)이 A–Z·a–z 52자뿐이라 띄어쓰기·하이픈·마침표·숫자는
  // 따라 쓸 획이 없다(같은 320개 중 46개, 예 "hula hoop" · "good-bye" · "No thanks.").
  const QUESTION_COUNT = 5;
  const MIN_WORD_LENGTH = 1;
  // 검수 r7(2026-08-19): "영어문제는 모두 소문자로 나와야 함".
  // 참고 이미지에는 "시작은 대문자"라고 적혀 있었으나 검수 지시가 이를 뒤집는다.
  const CAPITALIZE_FIRST = false;
  const TEST_MEMBER_ID = "LOCAL-TEST-MEMBER";
  const TEST_RANKING = Object.freeze({
    nickname: "Test Fox",
    best_score: 5,
    badge_image: "",
    rankings: Object.freeze([
      Object.freeze({ nickname: "Test Fox", best_score: 5 }),
      Object.freeze({ nickname: "Word Hero", best_score: 5 }),
      Object.freeze({ nickname: "Little Star", best_score: 4 }),
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

  // 검수 4차 q53(2026-09-29): 서버가 준 글자 안의 이스케이프 문자와 HTML 엔티티를
  // 실제 문자로 바꾼다. 글자 그대로 온 "\n" 이 화면에 역슬래시와 n 으로 남던 문제다.
  // 태그(<br>)는 일부러 풀지 않는다 — 화면에는 textContent 로만 넣으므로, 태그를 살리려면
  // innerHTML 이 필요하고 그러면 서버가 준 글자가 화면 코드가 될 수 있다(사장님 승인 범위도 1·2번뿐).
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

  // info 응답에서 화면에 그리는 글자(동화 제목 · 부제목)만 표시용으로 푼다. 나머지 값은 그대로 둔다.
  function normalizeInfo(info) {
    if (!info || typeof info !== "object") return {};
    const normalized = { ...info };
    for (const key of ["title", "subtitle"]) {
      if (key in normalized) normalized[key] = decodeDisplayText(normalized[key]);
    }
    return normalized;
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

  function letterCount(text) {
    return [...text].filter(isLetter).length;
  }

  // 따라쓰기 대상 단어: 모든 문자가 알파벳이어야 한다. 공백/기호가 섞인 단어(예: "ice cream")는
  // 따라 쓸 획 자산이 없어 판에 들어가지 못한다. 길이는 거르지 않는다(위 2차 수정 주석).
  function isTraceableWord(text) {
    const letters = [...cleanText(text)];
    if (letters.length < MIN_WORD_LENGTH) return false;
    return letters.every(isLetter);
  }

  // 시안/주석 "시작은 대문자": 첫 글자만 대문자, 나머지는 소문자.
  function displayLetters(text) {
    const letters = [...cleanText(text).toLowerCase()];
    if (CAPITALIZE_FIRST && letters.length > 0) {
      letters[0] = letters[0].toLocaleUpperCase("en-US");
    }
    return letters;
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
        text: decodeDisplayText(item?.text),
        mean: decodeDisplayText(item?.mean),
        soundUrl: cleanText(item?.sound_url),
      }))
      .filter((item) => item.text
        && item.mean
        && isTraceableWord(item.text));

    if (words.length === 0) {
      throw contentError(
        "게임에는 알파벳으로만 된 영어 단어가 필요합니다.",
        "INVALID_VOCABULARY",
      );
    }
    return words;
  }

  // 사양: 5문항을 랜덤으로 뽑는다. 단어가 5개보다 적으면 있는 만큼 낸다.
  // avoidFirst: 직전 판 마지막 단어(2차 수정 공통 "다시 시작 — 앞 판 마지막 단어로 시작하지 않음").
  // 뽑힌 판 안에 다른 단어가 있으면 첫 문제로 두지 않는다 — 처음 나오는 다른 단어와 자리를 바꾼다.
  // 판이 한 문제뿐이면 단어도 하나뿐이라(최대 5문항) 어쩔 수 없이 쓴다(판은 늘 열린다).
  function createTraceQuestions(words, random = Math.random, { avoidFirst = "" } = {}) {
    if (!Array.isArray(words) || words.length === 0) {
      throw contentError("문제로 만들 단어가 없습니다.", "INVALID_VOCABULARY");
    }
    const playable = words.filter((word) => word
      && typeof word.text === "string"
      && typeof word.mean === "string"
      && isTraceableWord(word.text));
    if (playable.length === 0) {
      throw contentError(
        "게임에는 알파벳으로만 된 영어 단어가 필요합니다.",
        "INVALID_VOCABULARY",
      );
    }
    const selection = pickIndexes(playable.length, Math.min(QUESTION_COUNT, playable.length), random);
    const avoid = cleanText(avoidFirst);
    if (avoid && playable[selection[0]].text === avoid) {
      // 목록에 같은 단어가 겹쳐 있을 수 있으니 바로 다음 칸이 아니라 처음 나오는 다른 단어와 바꾼다.
      const other = selection.findIndex((position) => playable[position].text !== avoid);
      if (other > 0) [selection[0], selection[other]] = [selection[other], selection[0]];
    }
    return selection.map((position) => questionFromWord(playable[position]));
  }

  function normalizeDemoQuestions(config, random = Math.random) {
    const source = Array.isArray(config?.demo?.words) ? config.demo.words : config?.words;
    const words = Array.isArray(source)
      ? source
        .map((word) => ({
          text: decodeDisplayText(word?.text),
          mean: decodeDisplayText(word?.mean),
          soundUrl: cleanText(word?.soundUrl || word?.sound_url),
        }))
        .filter((word) => word.text && word.mean && isTraceableWord(word.text))
      : [];
    if (words.length === 0) {
      throw contentError("개발용 데모 단어가 없습니다.", "INVALID_DEMO_QUESTIONS");
    }
    return createTraceQuestions(words, random);
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
        // 2차 수정(공통 4절 함정): info 와 단어 목록을 Promise.all 로 묶어 두면 info 만 실패해도 판이 안 열린다.
        // info 에서는 시작 화면의 동화 제목 · 부제목만 쓴다(공통-9). 실패하면 빈 값으로 두고 단어 목록만 기다린다.
        const [info, vocabulary] = await Promise.all([
          apiClient.getGameInfo(launch.fcId).catch(() => null),
          apiClient.getVocabularyList(launch.fcId),
        ]);
        const words = normalizeVocabulary(vocabulary);
        state.content.info = normalizeInfo(info);
        state.content.words = words;
        state.content.questions = createTraceQuestions(words);
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

  // 사양: 매 판마다 문제를 다시 뽑는다(같은 단어 목록이라도 순서를 새로 섞는다).
  function rebuildQuestions({ avoidFirst = "" } = {}) {
    if (state.content.words.length > 0) {
      state.content.questions = createTraceQuestions(state.content.words, Math.random, { avoidFirst });
    }
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

  // 사양: 완성한 단어 수(0~5)를 점수로 저장한다. 점수/콤보/보너스는 없다.
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
    createTraceQuestions,
    normalizeVocabulary,
    displayLetters,
    isTraceableWord,
    decodeDisplayText,
    normalizeInfo,
    QUESTION_COUNT,
  });
})(window);
