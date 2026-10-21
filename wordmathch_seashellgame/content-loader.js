(function installWordMatchContent(global) {
  "use strict";

  const apiModule = global.WordMatchApi;
  if (!apiModule) {
    throw new Error("WordMatchApi가 먼저 로드되어야 합니다.");
  }

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

  const CHOICE_COUNT = 4;
  // 2차 수정(공통 기준 "긴 글자 — 단어는 빼지 않음"): 예전에는 한글 뜻이 18자(잠정치)를 넘으면 조개 안에 안 들어간다고
  // 문제에서 뺐다. 이제 빼지 않고 조개 칸 안에서 글자를 줄인다(script.js fitQuestionText). 지나치게 긴 값은 서버에서 고친다.
  const TEST_MEMBER_ID = "LOCAL-TEST-MEMBER";
  const TEST_QUESTION_SOUND = "assets/sound/touch.mp3";
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

  // 검수 4차 8항(2026-09-29): 서버가 준 글자 안의 이스케이프 문자와 HTML 엔티티를
  // 실제 문자로 바꾼다. 글자 그대로 온 "\n" 이 화면에 역슬래시와 n 으로 남던 문제다.
  // 태그(<br>)는 일부러 풀지 않는다 — 화면에는 textContent 로만 넣으므로, 태그를 살리려면
  // innerHTML 이 필요하고 그러면 서버가 준 글자가 화면 코드가 될 수 있다.
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

  // 시작 화면에 그대로 보여 주는 동화 정보(title · subtitle)는 단어 · 도움말과 같은 방식으로 다듬는다 — 앞뒤 빈칸을 떼고
  // 글자 그대로 온 엔티티 · 이스케이프를 푼다(API 명세 예시의 subtitle 은 앞에 빈칸이 있다). 다른 값(play_time 등)은 받은 그대로 둔다.
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
        questions: state.content.questions.map((question) => ({ ...question })),
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

  function normalizeVocabulary(items) {
    if (!Array.isArray(items)) {
      throw contentError("단어 목록 형식이 올바르지 않습니다.", "INVALID_VOCABULARY");
    }

    const words = items
      .map((item) => ({
        // 검수 4차 8항: 화면에 보여 줄 글자만 푼다. 소리 주소는 값이 바뀌면 안 되므로 그대로 둔다.
        text: decodeDisplayText(item?.text),
        mean: decodeDisplayText(item?.mean),
        soundUrl: cleanText(item?.sound_url),
      }))
      .filter((item) => item.text && item.mean);

    const uniqueMeanCount = new Set(words.map((word) => word.mean)).size;
    if (words.length < CHOICE_COUNT || uniqueMeanCount < CHOICE_COUNT) {
      throw contentError(
        `게임에는 서로 다른 뜻을 가진 단어가 ${CHOICE_COUNT}개 이상 필요합니다.`,
        "INVALID_VOCABULARY",
      );
    }

    return words;
  }

  function questionsFromWords(words) {
    return words.map((word, index) => {
      // Distractors walk forward from this word so the set is stable for the
      // same list; the correct slot moves with the index so it is spread over
      // all four shells. Unpredictability comes from shuffleQuestionOrder,
      // which randomizes the order the questions are asked in.
      const distractors = [];
      for (
        let offset = 1;
        offset < words.length && distractors.length < CHOICE_COUNT - 1;
        offset += 1
      ) {
        const candidate = words[(index + offset) % words.length].mean;
        if (candidate !== word.mean && !distractors.includes(candidate)) {
          distractors.push(candidate);
        }
      }

      const answerIndex = index % CHOICE_COUNT;
      const choices = [];
      let nextDistractor = 0;
      for (let slot = 0; slot < CHOICE_COUNT; slot += 1) {
        choices.push(
          slot === answerIndex ? word.mean : distractors[nextDistractor++],
        );
      }

      return {
        english: word.text,
        choices,
        answerIndex,
        soundUrl: word.soundUrl,
        correctMeaning: word.mean,
      };
    });
  }

  function createChoiceQuestions(items) {
    return questionsFromWords(normalizeVocabulary(items));
  }

  function normalizeDemoQuestions(config) {
    const source = Array.isArray(config?.demo?.questions)
      ? config.demo.questions
      : config?.questions;
    const questions = Array.isArray(source)
      ? source
        .map((question) => {
          const choices = Array.isArray(question?.choices)
            ? question.choices.map((choice) => decodeDisplayText(choice))
            : [];
          const answerIndex = Number(question?.answerIndex);
          return {
            english: decodeDisplayText(question?.english),
            choices,
            answerIndex,
            soundUrl: cleanText(question?.soundUrl),
            correctMeaning: decodeDisplayText(question?.correctMeaning)
              || choices[answerIndex]
              || "",
          };
        })
        .filter(
          (question) => question.english
            && question.choices.length === CHOICE_COUNT
            && question.choices.every((choice) => choice !== "")
            && Number.isInteger(question.answerIndex)
            && question.answerIndex >= 0
            && question.answerIndex < CHOICE_COUNT,
        )
      : [];

    if (questions.length === 0) {
      throw contentError("개발용 데모 문제가 없습니다.", "INVALID_DEMO_QUESTIONS");
    }

    return questions;
  }

  function normalizeHelp(items) {
    return Array.isArray(items)
      ? items
        // 2차 수정 13번(사장님 "Rasing에 사용한 내용대로"): 서버 글에 "\n" 처럼 알아볼 수 있는 특수 문자가
        // 글자 그대로 오면 적용한다(줄바꿈 등). 모르는 코드는 지금처럼 그대로 보인다 — decodeDisplayText 는 아는
        // 것만 풀고 나머지는 손대지 않는다. 내려주는 값 자체를 고치는 것은 서버 쪽 일이다.
        // 디코더는 레이싱 content-loader 와 주석을 빼면 한 글자도 다르지 않다(2026-10-01 대조).
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

  async function runBootstrap() {
    const launch = readLaunchContext();
    const config = readEmbeddedConfig();
    state.launch = launch;
    state.content = {
      info: null,
      words: [],
      questions: [],
      help: [],
      helpStatus: "idle",
    };
    apiClient = null;
    helpPromise = null;
    setLoading("loading", "게임 데이터를 불러오는 중입니다.");

    try {
      if (launch.isTest) {
        state.content.questions = normalizeDemoQuestions(config).map((question) => ({
          ...question,
          soundUrl: launch.testMode === "member"
            ? question.soundUrl || TEST_QUESTION_SOUND
            : question.soundUrl,
        }));
        state.content.info = {
          source: `test-${launch.testMode}`,
          play_time: Number(config?.demo?.info?.play_time) || 30,
        };
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
        // 2차 수정 12번(공통 기준 "요청이 실패하면 40초"): info 는 한 판 시간(play_time)과 시작 화면 동화 정보(title · subtitle)를 준다. 받지 못해도 단어 목록이
        // 있으면 게임은 40초로 연다(OX 와 같다). 예전에는 둘을 Promise.all 로 묶어 info 하나만 실패해도 판이 열리지 않았다.
        // 두 요청은 함께 보낸다. 단어 목록이 실패하면 문제를 낼 수 없으니 info 를 기다리지 않고 바로 오류로 올린다.
        const infoRequest = Promise.resolve(apiClient.getGameInfo(launch.fcId)).catch(() => null);
        const vocabulary = await apiClient.getVocabularyList(launch.fcId);
        const info = await infoRequest;
        const words = normalizeVocabulary(vocabulary);
        state.content.info = normalizeInfo(info);
        state.content.words = words;
        state.content.questions = questionsFromWords(words);
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
    decodeDisplayText,
    bootstrap,
    getHelp,
    getRanking,
    saveHistory,
    getState: snapshot,
    readLaunchContext,
    createChoiceQuestions,
    CHOICE_COUNT,
  });
})(window);
