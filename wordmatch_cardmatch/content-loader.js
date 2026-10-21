(function installWordMatchContent(global) {
  "use strict";

  const apiModule = global.WordMatchApi;
  const cardsModule = global.WordMatchCards;
  if (!apiModule) {
    throw new Error("WordMatchApi가 먼저 로드되어야 합니다.");
  }
  if (!cardsModule) {
    throw new Error("WordMatchCards가 먼저 로드되어야 합니다.");
  }

  // 도움말 API가 비어 있거나 데모로 돌 때 쓰는 기본 문구. API 응답이 있으면
  // 그쪽이 우선한다.
  const DEFAULT_HELP_ITEMS = Object.freeze([
    Object.freeze({
      title: "게임 방법",
      content: "카드가 뒤집혀 앞면이 보이면, 한글 단어 카드와 같은 뜻의 영어 단어 카드를 하나씩 눌러 짝을 맞추세요.\n짝이 맞으면 두 카드가 사라집니다.",
    }),
    Object.freeze({
      title: "판",
      content: "4x3 판의 짝 6쌍을 모두 맞히면 새 판이 나옵니다.\n초록 카드와 노랑 카드가 번갈아 나오고, 정해진 시간 안에 되도록 많은 짝을 맞히세요.",
    }),
    Object.freeze({
      title: "점수 · 콤보",
      content: "짝을 맞히면 100점, 틀리면 10점이 깎입니다.\n연속으로 세 번 맞히면 100점을 더 받습니다.",
    }),
    Object.freeze({
      title: "랭킹",
      content: "랭킹은 매주 초기화됩니다.",
    }),
  ]);

  // 2차 수정(공통 기준 "한 판 시간"): API play_time 이 먼저이고, 알 수 없으면 40초다(script.js resolveDurationMs).
  const PLAY_TIME_SECONDS = 40;
  // 4x3 판은 짝 6쌍이라 서로 다른 단어 6개가 있어야 판을 깐다.
  const MIN_WORD_COUNT = 6;
  const MAX_MEANING_LENGTH = cardsModule.MAX_MEANING_LENGTH;
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
    loading: {
      status: "idle",
      message: "",
      error: null,
    },
    content: {
      info: null,
      words: [],
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
   * 공통 8항(검수 4차 q53 · 기준 방 따라쓰기): 서버가 준 글자 안의 이스케이프 문자와 HTML 엔티티를
   * 실제 문자로 바꾼다. 글자 그대로 온 "\n" 이 화면에 역슬래시와 n 으로 남던 문제다.
   * 경계선 셋 — 화면에 보여 줄 글자에만 쓰고(소리 주소·URL·식별자는 그대로), 태그(<br>)는 풀지 않으며
   * (화면에는 textContent 로만 넣는다), 한 번만 푼다.
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

  // 화면에 그대로 보여 줄 글자에만 쓴다. URL·식별자에는 쓰지 않는다(값이 바뀌면 안 된다).
  function decodeDisplayText(value) {
    const text = cleanText(value);
    if (!text) return "";
    return decodeEntities(decodeEscapes(text)).replace(/\r\n?/g, "\n").trim();
  }

  // 2차 검수 공통-9: 시작 화면에 그대로 보여 주는 동화 정보(title · subtitle)는 단어 · 도움말과 같은 방식으로 다듬는다 —
  // 앞뒤 빈칸을 떼고 글자 그대로 온 엔티티 · 이스케이프를 푼다(API 명세 예시의 subtitle 은 앞에 빈칸이 있다).
  // 다른 값(play_time 등)은 받은 그대로 둔다. info 를 받지 못했으면 빈 객체다.
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
    error.name = "WordMatchContentError";
    error.code = code || "CONTENT_ERROR";
    return error;
  }

  function readEmbeddedConfig() {
    const element = global.document?.querySelector?.("#gameConfig");
    if (!element) {
      return {};
    }

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
    const apiBaseUrl = cleanText(deployment.apiBaseUrl)
      || apiModule.BASE_URL;
    const apiUserAgent = cleanText(deployment.apiUserAgent)
      || apiModule.DEFAULT_API_USER_AGENT;

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

  function snapshot() {
    return {
      launch: state.launch ? { ...state.launch } : null,
      loading: {
        ...state.loading,
        error: cloneRecord(state.loading.error),
      },
      content: {
        info: cloneRecord(state.content.info),
        words: state.content.words.map((word) => ({ ...word })),
        help: state.content.help.map((item) => ({ ...item })),
        helpStatus: state.content.helpStatus,
      },
    };
  }

  function emitState() {
    if (
      typeof global.dispatchEvent !== "function"
      || typeof global.CustomEvent !== "function"
    ) {
      return;
    }

    global.dispatchEvent(new global.CustomEvent("wordmatch:content-state", {
      detail: snapshot(),
    }));
  }

  function setLoading(status, message, error = null) {
    state.loading = { status, message, error };
    emitState();
  }

  /*
   * API 원본 형태는 { text, mean, sound_url }이다. 단어나 뜻이 비어 짝을 만들 수 없는 것만
   * 걸러 낸다(2차 수정: 길이 · 글자 종류로는 빼지 않는다 — cards.js isPlayableWord). 같은 뜻을 가진
   * 단어가 둘이면 어느 카드를 골라도 짝이 되어야 하는데 wordId 로 판정하므로
   * 뜻 중복은 짝을 못 만드는 카드를 만든다 — 그래서 뜻이 겹치는 단어는 앞의
   * 하나만 남긴다.
   */
  function normalizeVocabulary(items) {
    if (!Array.isArray(items)) {
      throw contentError("단어 목록 형식이 올바르지 않습니다.", "INVALID_VOCABULARY");
    }

    const seenMeanings = new Set();
    const words = items
      .map((item) => ({
        text: decodeDisplayText(item?.text),
        mean: decodeDisplayText(item?.mean),
        soundUrl: cleanText(item?.sound_url ?? item?.soundUrl),
      }))
      .filter((item) => item.text && item.mean && cardsModule.isPlayableWord(item))
      .filter((item) => {
        const key = item.mean.replace(/\s+/g, "");
        if (seenMeanings.has(key)) return false;
        seenMeanings.add(key);
        return true;
      });

    if (words.length < MIN_WORD_COUNT) {
      throw contentError(
        `게임에는 서로 다른 뜻을 가진 단어가 ${MIN_WORD_COUNT}개 이상 필요합니다.`,
        "INVALID_VOCABULARY",
      );
    }

    return words;
  }

  function normalizeDemoWords(config) {
    const source = Array.isArray(config?.demo?.words) ? config.demo.words : config?.words;
    if (!Array.isArray(source) || source.length === 0) {
      throw contentError("개발용 데모 단어가 없습니다.", "INVALID_DEMO_WORDS");
    }
    return normalizeVocabulary(source);
  }

  function normalizeHelp(items) {
    return Array.isArray(items)
      ? items
        .map((item) => ({
          title: decodeDisplayText(item?.title),
          content: decodeDisplayText(item?.content),
        }))
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
    if (helpPromise) {
      return helpPromise;
    }

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

  function playTimeSeconds() {
    const raw = Number(state.content.info?.play_time);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : PLAY_TIME_SECONDS;
  }

  async function runBootstrap() {
    const launch = readLaunchContext();
    const config = readEmbeddedConfig();
    state.launch = launch;
    state.content = {
      info: null,
      words: [],
      help: [],
      helpStatus: "idle",
    };
    apiClient = null;
    helpPromise = null;
    setLoading("loading", "게임 데이터를 불러오는 중입니다.");

    try {
      if (launch.isTest) {
        // 테스트 회원은 진짜 회원이 아니다. 박아 둔 단어에는 발음 주소가 없으므로
        // 다른 소리를 끼워 넣어 발음인 척하지 않는다(형제 방과 같은 기준).
        state.content.words = normalizeDemoWords(config);
        state.content.info = {
          source: `test-${launch.testMode}`,
          play_time: Number(config?.demo?.info?.play_time) || PLAY_TIME_SECONDS,
        };
      } else if (launch.isDemo) {
        // 데모는 서버를 쓰지 않는다. API 클라이언트를 아예 만들지 않아야
        // file:// 로 연 페이지가 도움말 때문에 리뷰 서버로 요청을 쏘고 CORS로
        // 막혀 기다리는 일이 없다.
        const demo = config?.demo || {};
        state.content.words = normalizeDemoWords(config);
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
        // 2차 수정(공통 기준 "한 판 시간"): info 가 실패해도 판은 열린다 — 한 판 시간이 40초로 갈 뿐이다.
        // 둘을 그냥 Promise.all 로 묶으면 info 실패가 단어 목록까지 버려 판이 열리지 않았다(바다속이 찾은 함정).
        const [info, vocabulary] = await Promise.all([
          apiClient.getGameInfo(launch.fcId).catch(() => null),
          apiClient.getVocabularyList(launch.fcId),
        ]);
        // 2차 검수 공통-9: info 는 한 판 시간(play_time)과 시작 화면 동화 정보(title · subtitle)를 준다.
        state.content.info = normalizeInfo(info);
        state.content.words = normalizeVocabulary(vocabulary);
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
    if (options.force) {
      bootstrapPromise = null;
    }
    if (!bootstrapPromise) {
      bootstrapPromise = runBootstrap().catch((error) => {
        bootstrapPromise = null;
        throw error;
      });
    }
    return bootstrapPromise;
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

  function saveHistory(score) {
    const numericScore = Math.trunc(Number(score));
    if (!Number.isFinite(numericScore)) {
      throw contentError("저장할 점수가 올바르지 않습니다.", "INVALID_SCORE");
    }

    if (state.launch?.isTest) {
      return Promise.resolve({
        test: true,
        rank: state.launch.isGuest ? 0 : 1,
        score: numericScore,
      });
    }

    if (state.launch?.isDemo) {
      return Promise.resolve({
        skipped: true,
        rank: 0,
        score: numericScore,
      });
    }

    requireLiveClient();
    return apiClient.saveHistory({
      fuId: state.launch.fuId,
      score: numericScore,
    });
  }

  global.WordMatchContent = Object.freeze({
    bootstrap,
    getHelp,
    getRanking,
    saveHistory,
    getState: snapshot,
    readLaunchContext,
    normalizeVocabulary,
    normalizeInfo,
    decodeDisplayText,
    playTimeSeconds,
    MIN_WORD_COUNT,
    PLAY_TIME_SECONDS,
    MAX_MEANING_LENGTH,
  });
})(window);
