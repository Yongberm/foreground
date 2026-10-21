(function installWordMatchContent(global) {
  "use strict";

  const apiModule = global.WordMatchApi;
  const raceModule = global.WordMatchRace;
  if (!apiModule) {
    throw new Error("WordMatchApi가 먼저 로드되어야 합니다.");
  }
  if (!raceModule) {
    throw new Error("WordMatchRace가 먼저 로드되어야 합니다.");
  }

  // 도움말 API가 비어 있거나 실패했을 때, 그리고 데모로 돌 때 쓰는 기본 문구
  // (승인된 A-9). API 응답이 있으면 그쪽이 우선한다.
  const DEFAULT_HELP_ITEMS = Object.freeze([
    Object.freeze({
      title: "게임 방법",
      content: "위에 나온 영어 단어의 뜻을 찾으세요.\n자동차를 좌우로 움직여 정답 상자만 지나가고, 오답 상자와 장애물은 피하세요.",
    }),
    Object.freeze({
      title: "조작",
      content: "화면을 누르거나 끌어서 차선을 바꿉니다.\n키보드 좌우 화살표로도 움직일 수 있습니다.",
    }),
    Object.freeze({
      title: "점수 · 콤보",
      content: "정답은 100점, 오답과 장애물은 10점이 깎입니다.\n연속으로 세 번 맞히면 100점을 더 받습니다.",
    }),
    Object.freeze({
      title: "랭킹",
      content: "랭킹은 매주 초기화됩니다.",
    }),
  ]);

  // 규약 v1.2: play_time 은 타입별 설정값이다(검수 API 는 지금 120초를 보낸다).
  // 2차 수정(사장님 2026-10-01, 공통 기준): API 의 play_time 을 먼저 쓰고, 주지 않거나 요청이
  // 실패하면 40초. 상한·하한은 두지 않는다 — 잘못된 값은 API 쪽에서 고친다. (예전 A-6 은 120초)
  const PLAY_TIME_SECONDS = 40;
  const MIN_WORD_COUNT = raceModule.MIN_WORD_COUNT;
  const TEST_MEMBER_ID = "LOCAL-TEST-MEMBER";
  // api-locale 은 요청 헤더에 실리므로 Latin-1 로 표현되는 로케일 형식만 받는다(예: ko_KR, en-GB).
  // 비라틴 문자가 오면 Headers 생성에서 예외가 나 모든 요청이 깨진다(검수 확정 2026-09-04).
  const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})*$/;
  // 회원 테스트(test_mode=member)의 발음 자리 소리. 내장 단어에는 발음 주소가 없으므로
  // 형제 방(OX퀴즈·조개·스펠링)과 같이 touch.mp3 를 끼워 회원 모드의 소리 흐름을 확인한다.
  const TEST_QUESTION_SOUND = "asset/sound/touch.mp3";
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
   * 공통 8항(q53, 사장님 지시 2026-09-29): 서버가 준 글자 안의 이스케이프 표기와 HTML 엔티티를
   * 실제 문자로 바꾼다. 글자 그대로 온 "\n" 이 화면에 역슬래시와 n 으로 남던 문제다.
   * 경계 셋 — 화면에 보여 줄 글자에만(소리 주소·식별자·URL 은 값이 바뀌면 안 되므로 제외),
   * 태그는 풀지 않음(textContent 로만 넣으므로 태그를 살리려면 innerHTML 이 필요하고
   * 그러면 서버가 준 글자가 화면 코드가 된다), 한 번만 풀기.
   * 기준 구현은 따라쓰기 방 content-loader.js 의 네 함수 한 벌이다.
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

  // 화면에 그대로 보여 줄 글자에만 쓴다. 소리 주소·식별자에는 쓰지 않는다.
  function decodeDisplayText(value) {
    const text = cleanText(value);
    if (!text) return "";
    return decodeEntities(decodeEscapes(text)).replace(/\r\n?/g, "\n").trim();
  }

  // 2차 검수 공통-9: 시작 화면에 보이는 동화 제목(title · subtitle)도 단어 · 도움말처럼 서버 글자를 풀어서 담는다
  // (&amp; · &#39; · \uXXXX 같은 표기가 화면에 그대로 찍히지 않게). 다른 값(play_time 등)은 건드리지 않는다.
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
    const requestedLocale = cleanText(params.get("api-locale"));
    const locale = LOCALE_PATTERN.test(requestedLocale)
      ? requestedLocale
      : (apiModule.DEFAULT_LOCALE || "ko_KR");
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
   * API 원본 형태는 { text, mean, sound_url }이다. 표제어 글자 규칙(race.js isPlayableWord — 알파벳·공백·하이픈·
   * 아포스트로피·마침표)에 맞지 않는 표제어는 여기서 걸러 낸다.
   * 길이로는 거르지 않는다(2026-10-01) — 긴 단어·뜻은 화면에서 칸에 맞게 줄인다. 뜻이 같은 단어가
   * 둘이면 오답 상자에 정답과 같은 글자가 올라올 수 있으므로 앞의 하나만 남긴다.
   */
  function normalizeVocabulary(items) {
    if (!Array.isArray(items)) {
      throw contentError("단어 목록 형식이 올바르지 않습니다.", "INVALID_VOCABULARY");
    }

    const seenMeanings = new Set();
    const seenTexts = new Set();
    const words = items
      .map((item) => ({
        // 화면 글자만 푼다. 소리 주소는 값이 바뀌면 안 되므로 그대로 둔다(공통 8항 경계).
        text: decodeDisplayText(item?.text),
        mean: decodeDisplayText(item?.mean),
        soundUrl: cleanText(item?.sound_url ?? item?.soundUrl),
      }))
      .filter((item) => item.text && item.mean && raceModule.isPlayableWord(item))
      .filter((item) => {
        // 뜻이 같은 단어와 표제어가 같은 단어(다른 뜻)는 처음 것만 남긴다(검수 확정 2026-09-04, race.js 와 같은 규칙).
        const key = item.mean.replace(/\s+/g, "");
        const textKey = item.text.toLowerCase();
        if (seenMeanings.has(key) || seenTexts.has(textKey)) return false;
        seenMeanings.add(key);
        seenTexts.add(textKey);
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
        // 2차 수정(사장님 2026-10-01): 서버 글에 "\n" 처럼 알아볼 수 있는 특수 문자가 글자 그대로 오면
        // 적용한다(줄바꿈 등). 모르는 코드는 지금처럼 그대로 보인다 — decodeDisplayText 는 아는 것만
        // 풀고 나머지는 손대지 않는다. 내려주는 값 자체를 고치는 것은 서버 쪽 일이다.
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
        state.content.help = normalized.length > 0 ? normalized : defaultHelpItems();
        state.content.helpStatus = "ready";
        emitState();
        return state.content.help.map((item) => ({ ...item }));
      })
      .catch(() => {
        // 승인된 A-9: 도움말을 못 받으면 기본 문구를 보여 준다. 다시 시도는 getHelp({retry}).
        state.content.help = defaultHelpItems();
        state.content.helpStatus = "fallback";
        emitState();
        return state.content.help.map((item) => ({ ...item }));
      });
    return helpPromise;
  }

  // API info.play_time 이 있으면 그 값, 없으면 40초(2차 수정).
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
        // 회원 테스트는 발음 주소가 없는 내장 단어에 TEST_QUESTION_SOUND 를 끼워 회원 모드의
        // 소리 흐름(문제가 뜰 때 발음)을 확인할 수 있게 한다(사용자 지시 2026-09-04, 형제 방 기준).
        // 게스트 테스트는 발음이 없다.
        state.content.words = normalizeDemoWords(config).map((word) => ({
          ...word,
          soundUrl: launch.testMode === "member"
            ? word.soundUrl || TEST_QUESTION_SOUND
            : word.soundUrl,
        }));
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
          ...normalizeInfo(demo.info),
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
        // 2차 수정(공통 기준 "요청이 실패하면 40초"): info 는 한 판 시간(play_time)만 준다. 그 요청이 실패해도
        // 단어 목록이 있으면 게임은 40초로 연다. 예전엔 둘을 Promise.all 로 묶어 info 하나만 실패해도 오류 화면이었다.
        // 단어 목록이 실패하면 문제를 낼 수 없으니 그대로 오류로 올린다(재시도 화면). 두 요청은 함께 보낸다.
        // then 안에서 부르므로 getGameInfo 가 동기로 던져도 여기서 잡힌다.
        const infoRequest = Promise.resolve()
          .then(() => apiClient.getGameInfo(launch.fcId))
          .catch(() => null);
        const vocabulary = await apiClient.getVocabularyList(launch.fcId);
        const info = await infoRequest;
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
    if (options.retry && state.content.helpStatus === "fallback") {
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
    playTimeSeconds,
    MIN_WORD_COUNT,
    PLAY_TIME_SECONDS,
  });
})(window);
