(function installSpellingBuilderContent(global) {
  "use strict";

  const apiModule = global.SpellingBuilderApi;
  if (!apiModule) {
    throw new Error("SpellingBuilderApi가 먼저 로드되어야 합니다.");
  }

  /* 도움말 기본 문구. API help가 비거나 실패할 때만 쓴다.
     규약 v1.2 기준 help는 아직 전 타입 공통 샘플을 돌려주므로(문구 확정 전),
     형제(seashell·oxquizegame)와 같은 공통 문구를 그대로 둔다 — 그래야
     데모·오프라인 화면이 운영 화면과 같아진다. */
  const DEFAULT_HELP_ITEMS = Object.freeze([
    Object.freeze({
      title: "게임 방법",
      content: "제시된 문제를 보고 제한 시간 안에 알맞은 답을 선택하세요.\n많이 맞힐수록 높은 점수를 얻습니다.",
    }),
    Object.freeze({
      title: "점수 · 콤보",
      content: "정답을 맞히면 점수를 얻고, 연속으로 맞히면 콤보 보너스 점수가 주어집니다.",
    }),
    Object.freeze({
      title: "랭킹",
      content: "랭킹은 매주 초기화됩니다.",
    }),
  ]);

  // 사양(기획서): 총 7문제 · 타이머 3분.
  const QUESTION_COUNT = 7;
  /* 규약 v1.2 info.play_time("전체 게임 플레이 타임(초) — 타입별 설정값").
     2차 수정 공통 1절(한 판 시간) · 부모 원장 4b397d52067d0ca2 7번: **API 의 play_time 을 먼저 쓴다.**
     시간을 주지 않거나 info 요청이 실패하면 이 방은 **180초**(사장님 권장안 — 공통의 40초가 아니다).
     상한·하한은 두지 않는다 — 잘못된 값은 API 쪽에서 고친다.
     ⚠ 검수 API 는 지금 120을 보낸다(공통 5절). 그래서 검수 서버에서 한 판은 2분이다. */
  const PLAY_TIME_SECONDS = 180;
  /* 블록 벽은 11칸 × 4줄이고 오답 철자 2개가 함께 놓인다.
     한 줄에 다 못 들어가면 계단형으로 아랫줄까지 이어 붙이는데
     (기획서: "철자가 길어질 경우 아래줄까지 단어 배치하여 연결 가능"),
     꺾이는 칸을 두 줄이 나눠 쓰므로 가로로 (철자 줄 길이 - 1)칸이 필요하다.
     11칸 벽에서는 철자 줄이 최대 12칸 -> 단어는 최대 10글자다.
     (형제는 1~11글자지만 그쪽은 벽 구조가 다르다.) */
  const MAX_WORD_LENGTH = 10;
  const MIN_WORD_LENGTH = 1;
  /* 뜻 길이 거름(12자)은 걷었다 — 2차 수정 공통 1절(긴 글자 · 단어 거름) · 부모 원장
     4b397d52067d0ca2 8번 "뜻 거름은 걷고 칸에 맞게 줄임". 긴 뜻은 script.js fitMeaningText 가
     위 간판에 맞게 줄이고(최소 32px), 그래도 안 들어가면 두 줄로 접는다.
     실측(검수 API LV1~9, 320개): 이 거름이 178개를 빼고 있었다 — 걷으면 통과 110 → 264개. */
  const TEST_MEMBER_ID = "LOCAL-TEST-MEMBER";
  const TEST_RANKING = Object.freeze({
    nickname: "Test Fox",
    best_score: 1200,
    badge_image: "",
    rankings: Object.freeze([
      Object.freeze({ nickname: "Test Fox", best_score: 1200 }),
      Object.freeze({ nickname: "Block Hero", best_score: 980 }),
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

  /* 공통 9항 8번(사장님 지시 2026-09-29): 서버가 준 글자 안의 이스케이프 문자와
     HTML 엔티티를 실제 문자로 바꾼다. 글자 그대로 온 "\\n" 이 화면에 역슬래시와 n 으로
     남던 문제다. 기준 방은 따라쓰기(spellingbuilder_write).

     경계선 셋 —
       1) 화면에 보여 줄 글자에만 쓴다. 소리 주소·식별자에는 쓰지 않는다(값이 바뀌면 안 된다).
       2) 태그(<br>)는 일부러 풀지 않는다. 화면에는 textContent 로만 넣으므로 태그를 살리려면
          innerHTML 이 필요하고, 그러면 서버가 준 글자가 화면 코드가 될 수 있다.
       3) 한 번만 푼다. 두 번 풀면 "&amp;lt;" 같은 글자가 태그로 바뀐다. */
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

  // 화면에 그대로 보여 줄 글자에만 쓴다. URL·식별자에는 쓰지 않는다.
  function decodeDisplayText(value) {
    const text = cleanText(value);
    if (!text) return "";
    return decodeEntities(decodeEscapes(text)).replace(/\r\n?/g, "\n").trim();
  }

  /* 2차 검수 공통-9: info 의 제목 · 부제목은 시작 화면 동화 정보에 그대로 찍힌다 — 앞뒤 빈칸과 엔티티를 풀어 둔다
     (API 명세 예시의 subtitle 은 앞에 빈칸이 있다). 다른 값(play_time 등)은 받은 그대로 둔다. OX 방 normalizeInfo 와 같다. */
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

  /* 블록 벽에 올릴 수 있는 단어: 1~10글자이고 모든 문자가 알파벳이어야 한다.
     - 길이(10글자)는 남긴다 — 벽에 안 들어간다는 실측 근거가 있다(부모 원장 8번 조건).
       11글자 단어는 오답 철자 2개를 붙이면 13칸이 되고 script.js placeRun 이
       "철자 줄이 블록 벽보다 깁니다" 로 놓지 못한다(information · coincidence 등 검수 API 10개).
     - 알파벳 거름(공백·하이픈·마침표 등)도 남긴다 — **사장님 확정 "지금처럼 빼"**(2026-10-02).
       그런 단어도 벽에는 놓이지만 빈 블록(" ")이나 "-"·"." 블록이 생긴다(검수 API 46개, 실측). */
  function isPlayableWord(text) {
    const letters = [...cleanText(text)];
    if (letters.length < MIN_WORD_LENGTH || letters.length > MAX_WORD_LENGTH) return false;
    return letters.every(isLetter);
  }

  // 시안(프리뷰): 블록 위 철자는 전부 소문자다.
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
        text: decodeDisplayText(item?.text),
        mean: decodeDisplayText(item?.mean),
        soundUrl: cleanText(item?.sound_url),
      }))
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

  // 사양: 7문제를 랜덤으로 뽑는다. 단어가 7개보다 적으면 있는 만큼 낸다.
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
          text: decodeDisplayText(word?.text),
          mean: decodeDisplayText(word?.mean),
          soundUrl: cleanText(word?.soundUrl || word?.sound_url),
        }))
        .filter((word) => word.text && word.mean && isPlayableWord(word.text))
      : [];
    if (words.length === 0) {
      throw contentError("개발용 데모 단어가 없습니다.", "INVALID_DEMO_QUESTIONS");
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
        /* play_time 은 설정에 있을 때만 싣는다. 여기서 180을 지어 넣으면 script.js 가 그것을 "API 값"
           으로 받아 gameConfig 의 block.timerSeconds 를 덮는다(독립 검토가 찾았다). */
        const testPlayTime = config?.demo?.info?.play_time;
        state.content.info = {
          source: `test-${launch.testMode}`,
          ...(testPlayTime !== undefined ? { play_time: testPlayTime } : {}),
        };
      } else if (launch.isDemo) {
        apiClient = apiModule.createClient({
          baseUrl: launch.apiBaseUrl,
          locale: launch.locale,
          apiUserAgent: launch.apiUserAgent,
        });
        const demo = config?.demo || {};
        state.content.questions = normalizeDemoQuestions(config);
        // play_time 은 데모 설정(demo.info)에 있을 때만 실린다 — 지어 넣지 않는다(위 테스트 모드와 같다).
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
        /* 2차 수정 공통 4절(함정): info 와 단어 목록을 Promise.all 로 묶으면 info 만 실패해도
           판이 안 열린다. info 는 한 판 시간(play_time)만 주므로 실패하면 기본 시간으로 연다.
           단어 목록이 실패하면 판을 열 수 없으므로 그대로 오류다. */
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
  function rebuildQuestions() {
    if (state.content.words.length > 0) {
      state.content.questions = createQuestions(state.content.words);
    }
    return state.content.questions.map(cloneQuestion);
  }

  function getHelp(options = {}) {
    if (options.retry && state.content.helpStatus === "error") {
      helpPromise = null;
    }
    return loadHelpInBackground();
  }

  /* 규약의 info.play_time(초). 값이 없거나 이상하면 기획서 사양값을 돌려준다.
     지금은 화면 타이머가 아니라 콘텐츠 메타데이터로 쓰인다 — 위 PLAY_TIME_SECONDS 주석 참조. */
  // script.js resolveRoundSeconds 와 같은 규칙: 버림한 양의 정수만, 참·거짓은 받지 않는다.
  function playTimeSeconds() {
    const raw = state.content.info?.play_time;
    if (typeof raw !== "number" && typeof raw !== "string") return PLAY_TIME_SECONDS;
    const seconds = Math.trunc(Number(raw));
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : PLAY_TIME_SECONDS;
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
    decodeDisplayText,
    normalizeInfo,
    bootstrap,
    rebuildQuestions,
    getHelp,
    getRanking,
    saveHistory,
    getState: snapshot,
    playTimeSeconds,
    readLaunchContext,
    createQuestions,
    normalizeVocabulary,
    displayLetters,
    isPlayableWord,
    QUESTION_COUNT,
    MAX_WORD_LENGTH,
    PLAY_TIME_SECONDS,
  });
})(window);
