(function exposeMoleGameContent(global) {
  "use strict";

  const apiModule = global.MoleGameApi;
  const moleModule = global.MoleGame;

  // 도움말 API가 비어 있거나 데모로 돌 때 쓰는 기본 문구. API 응답이 있으면
  // 그쪽이 우선한다.
  const DEFAULT_HELP_ITEMS = Object.freeze([
    Object.freeze({
      title: "게임 방법",
      content: "담장 위로 여우들이 팻말 여덟 장을 들고 올라옵니다. 영어 단어 팻말과 그 뜻이 적힌 팻말을 하나씩 눌러 짝을 맞추세요. 10초가 지나면 남은 팻말이 사라지고 새 팻말이 올라옵니다.",
    }),
    Object.freeze({
      title: "짝 맞추기",
      content: "먼저 누른 팻말이 골라진 상태로 남습니다. 두 번째로 누른 팻말이 짝이면 둘 다 사라지고, 짝이 아니면 고르기가 풀립니다. 네 짝을 모두 맞히면 기다리지 않고 새 팻말이 올라옵니다.",
    }),
    Object.freeze({
      title: "점수 · 콤보",
      content: "짝을 맞히면 100점, 틀리면 10점이 깎입니다. 연속으로 세 번 맞히면 100점을 더 받습니다. 틀리면 연속 기록은 처음으로 돌아갑니다.",
    }),
    Object.freeze({
      title: "시간",
      content: "화면 아래 시계가 남은 시간을 보여 줍니다. 시간이 끝나면 결과 화면으로 넘어갑니다.",
    }),
  ]);

  // 총 문제(짝) 수. 시간이 남아 있는 동안 이만큼 짝을 낸다.
  const QUESTION_COUNT = 10;
  /*
   * 한 판 시간. API info 의 play_time(초)을 먼저 쓰고, 주지 않거나 info 요청이 실패하면 40초다
   * (2차 수정, 공통 문서 1절 "한 판 시간"). 상한 · 하한은 두지 않는다 — 잘못된 값은 API 쪽에서 고친다.
   * 예전 기본값 120 은 규약 v1.2 의 "전 타입 기본값"이었다.
   */
  const PLAY_TIME_SECONDS = 40;
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
   * 검수 4차 8항(2026-09-29, 12개 방 공통): 서버가 준 글자 안의 이스케이프 문자와
   * HTML 엔티티를 실제 문자로 바꾼다. 글자 그대로 온 "\n" 이 화면에 역슬래시와 n 으로
   * 남던 문제다. 기준 구현은 따라쓰기 방(spellingbuilder_write)이다.
   *
   * 경계선 셋을 지킨다.
   *  - 화면에 낼 글자에만 쓴다. 소리 주소와 URL 에는 쓰지 않는다 — 값이 바뀌면 안 된다.
   *  - 태그(<br>)는 일부러 풀지 않는다. 화면에는 textContent 로만 넣으므로 태그를 살리려면
   *    innerHTML 이 필요하고, 그러면 서버가 준 글자가 화면 코드가 될 수 있다.
   *  - 한 번만 푼다. 두 번 풀면 "&amp;lt;" 같은 글자가 태그로 되살아난다.
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

  /*
   * 공통-9(사장님 2026-10-12 "동화API 전달 해준적이 있다는데 확인해보고 적용"): info 응답의 title · subtitle 을 시작 화면
   * 로고와 Start 사이에 낸다. 화면 글자라 단어와 같이 이스케이프 · 엔티티를 푼다. 나머지 값(play_time 등)은 그대로다.
   */
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
    error.name = "MoleGameContentError";
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

  /*
   * 셸이 건네는 "닫고 나서 갈 주소"를 받는다. 받은 주소로 옮겨 가는 기능이라
   * **같은 곳인지**를 세 가지로 모두 본다 — 하나라도 빠지면 뚫린다.
   *
   *  - `origin` 만 보면 안 된다: 검수는 `file://` 로 도는데 그때 origin 은 어떤 주소든
   *    문자열 "null" 이라 언제나 같다고 나온다. `javascript:` 와 `data:` 가 그대로 통과한다.
   *  - `protocol` 만 보태도 안 된다: `//evil.example/steal` 은 `file://` 기준에서 protocol 이
   *    `file:` 로 남는다. 그건 `host` 가 잡는다(기준 host 는 빈 문자열).
   *
   * 통과시키는 것은 이 페이지와 같은 자리의 http·https·file 주소뿐이다.
   */
  const CLOSE_URL_PROTOCOLS = Object.freeze(["http:", "https:", "file:"]);

  function sameOriginUrl(value) {
    const raw = cleanText(value);
    if (!raw) return null;
    const here = cleanText(global.location?.href);
    if (!here) return null;
    try {
      const base = new URL(here);
      const target = new URL(raw, here);
      const same = target.origin === base.origin
        && target.protocol === base.protocol
        && target.host === base.host
        && CLOSE_URL_PROTOCOLS.includes(target.protocol);
      return same ? target.href : null;
    } catch {
      return null;
    }
  }

  /*
   * 지금 이 문서를 가리키는 주소는 닫기 주소로 쓰지 않는다(2026-09-30).
   * `#bye`·`index.html`·`./`·`?x=1` 같은 값으로 옮겨 가면 창이 닫히는 대신 게임이 다시 뜨거나
   * 아무 일도 일어나지 않는다. 그러면서 "옮겼다"로 처리돼 뒤의 방법(뒤로·닫기)을 건너뛰었다.
   * 질의와 조각은 문서를 바꾸지 않으므로 경로만 견준다. 폴더 주소(…/)는 그 폴더의
   * index.html 로 눕혀 견준다 — 주소창이나 디렉터리 색인으로 들어오면 폴더 꼴이다.
   */
  function documentPath(url) {
    return url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  }

  function usableCloseUrl(value) {
    const href = sameOriginUrl(value);
    if (!href) return null;
    try {
      const here = new URL(cleanText(global.location?.href));
      return documentPath(new URL(href)) === documentPath(here) ? null : href;
    } catch {
      return null;
    }
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
      apiBaseUrl: cleanText(deployment.apiBaseUrl) || apiModule.BASE_URL,
      apiUserAgent: cleanText(deployment.apiUserAgent) || apiModule.DEFAULT_API_USER_AGENT,
      isGuest: !fuId,
      isDemo: !testMode && (explicitDemo || (localRuntime && !fcId)),
      isTest: Boolean(testMode),
      isLocalRuntime: localRuntime,
      testMode,
      // 닫은 뒤 갈 주소. 쿼리가 먼저고, 없으면 마크업 설정. 같은 자리가 아니면 버린다.
      closeUrl: usableCloseUrl(params.get("close_url")) || usableCloseUrl(deployment.closeUrl),
    };
  }

  function cloneRecord(value) {
    return value && typeof value === "object" ? { ...value } : value;
  }

  function snapshot() {
    return {
      launch: state.launch ? { ...state.launch } : null,
      loading: { ...state.loading, error: cloneRecord(state.loading.error) },
      content: {
        info: cloneRecord(state.content.info),
        words: state.content.words.map((word) => ({ ...word })),
        questions: state.content.questions.map((question) => ({ ...question })),
        help: state.content.help.map((item) => ({ ...item })),
        helpStatus: state.content.helpStatus,
      },
    };
  }

  function emitState() {
    if (typeof global.dispatchEvent !== "function" || typeof global.CustomEvent !== "function") {
      return;
    }
    global.dispatchEvent(new global.CustomEvent("molegame:content-state", {
      detail: snapshot(),
    }));
  }

  function setLoading(status, message, error = null) {
    state.loading = { status, message, error };
    emitState();
  }

  // API 원본 형태는 { text, mean, sound_url }이다. 판에 올릴 수 없는 표제어(빈 단어 · 빈 뜻)만
  // 여기서 걸러 낸다. 길이와 글자로는 거르지 않는다(2차 수정).
  function normalizeVocabulary(items) {
    if (!Array.isArray(items)) {
      throw contentError("단어 목록 형식이 올바르지 않습니다.", "INVALID_VOCABULARY");
    }

    const words = items
      .map((item) => ({
        // 단어와 뜻은 화면에 그대로 나가므로 푼다. 소리 주소는 값이라 손대지 않는다(8항).
        text: decodeDisplayText(item?.text),
        mean: decodeDisplayText(item?.mean),
        soundUrl: cleanText(item?.sound_url),
      }))
      .filter((item) => item.text && item.mean && moleModule.isPlayableWord(item));

    if (words.length === 0) {
      throw contentError(
        "게임에는 영어 단어와 그 뜻이 필요합니다.",
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

  /*
   * 미로 방과 달리 문제 하나에 격자가 붙지 않는다. 두더지는 짝 하나가 곧 한
   * 문제라 "문제"는 출제할 단어를 고르고 섞어 둔 목록이다.
   */
  function createQuestions(words, random = Math.random) {
    if (!Array.isArray(words) || words.length === 0) {
      throw contentError("문제로 쓸 단어가 없습니다.", "INVALID_VOCABULARY");
    }
    const playable = words.filter((word) => word && moleModule.isPlayableWord(word));
    if (playable.length === 0) {
      throw contentError("판에 올릴 수 있는 단어가 없습니다.", "INVALID_VOCABULARY");
    }
    const selection = pickIndexes(playable.length, Math.min(QUESTION_COUNT, playable.length), random);
    return selection.map((position) => ({ ...playable[position] }));
  }

  function normalizeDemoQuestions(config, random = Math.random) {
    const source = Array.isArray(config?.demo?.words) ? config.demo.words : config?.words;
    const words = Array.isArray(source)
      ? source
        .map((word) => ({
          text: cleanText(word?.text),
          mean: cleanText(word?.mean),
          soundUrl: cleanText(word?.sound_url ?? word?.soundUrl),
        }))
        .filter((word) => word.text && word.mean && moleModule.isPlayableWord(word))
      : [];
    if (words.length === 0) {
      throw contentError("데모 단어 목록이 비어 있습니다.", "INVALID_VOCABULARY");
    }
    return createQuestions(words, random);
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
   * 점수 설정을 #gameConfig 에서 읽는다. 키 이름은 형제 워드매치 방들과 같다 —
   * `correct` / `incorrect` / `comboEvery` / `comboBonus`. 콘텐츠를 만지는 쪽이
   * 게임마다 다른 이름을 외우지 않아도 되도록 바깥 이름을 맞춘 것이고, 안쪽
   * rules.js 는 correctScore/... 라는 제 이름을 쓰므로 여기서 옮겨 준다.
   *
   * 적히지 않았거나 숫자가 아닌 값은 **넘기지 않는다.** 그래야 rules.js 의
   * DEFAULTS 가 그대로 산다.
   *
   * 형제들은 `Number(x) || 100` 꼴을 쓰는데 그러면 0 이 기본값으로 되돌아간다 —
   * `incorrect: 0`(감점 없음)을 적을 수 없다. 여기서는 유한한 숫자인지만 보고
   * 0 도 그대로 받는다. 바깥 이름은 형제와 같고 판정만 엄격하다.
   */
  function readScoringOverrides(config) {
    const raw = config?.scoring;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const NAMES = {
      correct: "correctScore",
      incorrect: "incorrectScore",
      comboEvery: "streakLength",
      comboBonus: "streakBonus",
    };
    const overrides = {};
    Object.entries(NAMES).forEach(([outer, inner]) => {
      const value = raw[outer];
      if (value === undefined || value === null || value === "") return;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      overrides[inner] = numeric;
    });
    return overrides;
  }

  function scoring() {
    return readScoringOverrides(readEmbeddedConfig());
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
        // 발음 버튼 자체가 사라진다(형제 방과 같은 기준).
        state.content.questions = normalizeDemoQuestions(config);
        state.content.info = {
          source: `test-${launch.testMode}`,
          play_time: Number(config?.demo?.info?.play_time) || PLAY_TIME_SECONDS,
        };
      } else if (launch.isDemo) {
        // 데모는 서버를 쓰지 않는다. API 클라이언트를 아예 만들지 않아야
        // file:// 로 연 페이지가 도움말 때문에 리뷰 서버로 요청을 쏘고 CORS로
        // 막혀 기다리는 일이 없다(형제 방에서 고친 자리).
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
        /*
         * 2차 수정(공통 문서 4절): info 가 실패해도 판은 열린다 — 한 판 시간이 40초로 갈 뿐이다.
         * 둘을 그냥 Promise.all 로 묶으면 info 실패가 단어 목록까지 버려 판이 열리지 않았다.
         */
        const [info, vocabulary] = await Promise.all([
          apiClient.getGameInfo(launch.fcId).catch(() => null),
          apiClient.getVocabularyList(launch.fcId),
        ]);
        const words = normalizeVocabulary(vocabulary);
        state.content.info = normalizeInfo(info);
        state.content.words = words;
        state.content.questions = createQuestions(words);
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

  // 다시하기는 같은 단어 목록에서 문제를 새로 뽑는다. 두 번째 판이 첫 판과 같은
  // 순서가 되지 않도록 한다.
  function rebuildQuestions() {
    if (state.content.words.length > 0) {
      state.content.questions = createQuestions(state.content.words);
    } else if (state.content.questions.length > 0) {
      state.content.questions = createQuestions(state.content.questions);
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

  global.MoleGameContent = Object.freeze({
    bootstrap,
    rebuildQuestions,
    getHelp,
    getRanking,
    saveHistory,
    getState: snapshot,
    scoring,
    readScoringOverrides,
    readLaunchContext,
    createQuestions,
    normalizeVocabulary,
    playTimeSeconds,
    QUESTION_COUNT,
    PLAY_TIME_SECONDS,
  });
})(window);
