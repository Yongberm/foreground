(function installWordMatchContent(global) {
  "use strict";

  const apiModule = global.WordMatchApi;
  if (!apiModule) {
    throw new Error("WordMatchApi가 먼저 로드되어야 합니다.");
  }

  const CRITICAL_IMAGE_SELECTOR = [
    ".stadium-background",
    ".game-logo",
    ".quiz-panel > img",
    ".goalkeeper",
    ".kicker",
    ".game-ball",
    ".hud-background",
    ".result-layout",
  ].join(",");

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
  const audioCache = new Map();

  function readEmbeddedConfig() {
    const element = document.querySelector("#gameConfig");
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

  function readLaunchContext() {
    const params = new URLSearchParams(global.location.search);
    const config = readEmbeddedConfig();
    const deployment = config?.deployment || {};
    const localApiTest = config?.localApiTest || {};
    const isLocalFile = global.location.protocol === "file:";
    const hasExplicitIdentity = params.has("fc_id") || params.has("fu_id");
    const isLocalApiTest = isLocalFile
      && localApiTest.enabled === true
      && !hasExplicitIdentity
      && params.get("demo") !== "1";
    const fcId = String(
      params.get("fc_id") || (isLocalApiTest ? localApiTest.fcId : "") || "",
    ).trim();
    const fuId = String(
      params.get("fu_id") || (isLocalApiTest ? localApiTest.fuId : "") || "",
    ).trim() || null;
    const locale = String(
      params.get("api-locale")
      || (isLocalApiTest ? localApiTest.locale : "")
      || apiModule.DEFAULT_LOCALE,
    ).trim()
      || apiModule.DEFAULT_LOCALE;
    const explicitDemo = params.get("demo") === "1";
    const localDemo = isLocalFile && !fcId;
    const apiBaseUrl = String(
      deployment.apiBaseUrl || apiModule.BASE_URL,
    ).trim() || apiModule.BASE_URL;
    const gameType = String(
      deployment.gameType || apiModule.DEFAULT_GAME_TYPE,
    ).trim() || apiModule.DEFAULT_GAME_TYPE;

    return {
      type: String(params.get("type") || "word").trim() || "word",
      fcId,
      fuId,
      locale,
      apiBaseUrl,
      gameType,
      isGuest: !fuId,
      isDemo: explicitDemo || localDemo,
      isLocalApiTest,
    };
  }

  function snapshot() {
    return {
      launch: state.launch ? { ...state.launch } : null,
      loading: { ...state.loading },
      content: {
        ...state.content,
        words: [...state.content.words],
        questions: [...state.content.questions],
        help: [...state.content.help],
      },
    };
  }

  function emitState() {
    global.dispatchEvent(new CustomEvent("wordmatch:content-state", {
      detail: snapshot(),
    }));
  }

  function setLoading(status, message, error = null) {
    state.loading = { status, message, error };
    emitState();
  }

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  // 검수 사차 여덟째 항: 서버가 준 글자 안의 이스케이프와 HTML 엔티티를 실제 문자로 바꾼다.
  // 글자 그대로 온 역슬래시 n 이 화면에 두 글자로 남던 문제다. 형제 따라쓰기 방 구현을 그대로 옮겼다.
  // 태그는 일부러 풀지 않는다 — 화면에는 textContent 로만 넣으므로, 태그를 살리려면 innerHTML 이
  // 필요하고 그러면 서버가 준 글자가 화면 코드가 될 수 있다.
  const ESCAPES = Object.freeze({
    n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0", "\\": "\\", "'": "'", '"': '"',
  });
  const ENTITIES = Object.freeze({
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
  });

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
        const isHex = body[1] === "x" || body[1] === "X";
        const code = Number.parseInt(body.slice(1).replace(/^[xX]/, ""), isHex ? 16 : 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return ENTITIES[body.toLowerCase()] ?? whole;
    });
  }

  // 화면에 그대로 보여 줄 글자에만 쓴다. 소리 주소나 식별자에는 쓰지 않는다(값이 바뀌면 안 된다).
  function decodeDisplayText(value) {
    const text = cleanText(value);
    if (!text) {
      return "";
    }
    return decodeEntities(decodeEscapes(text)).replace(/\r\n?/g, "\n").trim();
  }

  function normalizeApiVocabulary(items) {
    if (!Array.isArray(items)) {
      throw new Error("단어 목록 형식이 올바르지 않습니다.");
    }

    const words = items
      .map((item) => ({
        text: decodeDisplayText(item?.text),
        mean: decodeDisplayText(item?.mean),
        soundUrl: cleanText(item?.sound_url),
      }))
      .filter((item) => item.text && item.mean);

    const uniqueMeanCount = new Set(words.map((item) => item.mean)).size;
    if (words.length < 2 || uniqueMeanCount < 2) {
      throw new Error("게임에는 서로 다른 뜻을 가진 단어가 2개 이상 필요합니다.");
    }

    const questions = words.map((word, index) => {
      let decoy = "";
      for (let offset = 1; offset < words.length; offset += 1) {
        const candidate = words[(index + offset) % words.length];
        if (candidate.mean !== word.mean) {
          decoy = candidate.mean;
          break;
        }
      }
      return {
        word: word.text,
        answer: word.mean,
        decoy,
        soundUrl: word.soundUrl,
      };
    });

    return { words, questions };
  }

  function normalizeDemoQuestions(config) {
    const questions = Array.isArray(config?.questions)
      ? config.questions
        .map((question) => ({
          word: decodeDisplayText(question?.word),
          answer: decodeDisplayText(question?.answer),
          decoy: decodeDisplayText(question?.decoy),
          soundUrl: cleanText(question?.soundUrl),
        }))
        .filter((question) => question.word && question.answer && question.decoy)
      : [];

    if (questions.length === 0) {
      throw new Error("개발용 데모 문제가 없습니다.");
    }
    return questions;
  }

  function waitForImage(image) {
    if (image.complete) {
      return image.naturalWidth > 0
        ? Promise.resolve()
        : Promise.reject(new Error(`이미지를 불러오지 못했습니다: ${image.getAttribute("src")}`));
    }

    return new Promise((resolve, reject) => {
      const timeoutId = global.setTimeout(() => {
        cleanup();
        reject(new Error(`이미지 로딩 시간이 초과되었습니다: ${image.getAttribute("src")}`));
      }, 8_000);

      const cleanup = () => {
        global.clearTimeout(timeoutId);
        image.removeEventListener("load", handleLoad);
        image.removeEventListener("error", handleError);
      };
      const handleLoad = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error(`이미지를 불러오지 못했습니다: ${image.getAttribute("src")}`));
      };

      image.addEventListener("load", handleLoad, { once: true });
      image.addEventListener("error", handleError, { once: true });
    });
  }

  // 사장님(10-02): 한글 표기는 나눔스퀘어라운드. 받은 뒤에 시작해야 뜻 칸을 이 글꼴로 잰다.
  // 못 받거나(경로 오류·망 오류) 8초(이미지와 같은 한도)를 넘기면 더 기다리지 않는다.
  // 한글은 뒤의 시스템 글꼴로 그려지고 게임은 그대로 열린다(글꼴 하나 때문에 Start 가 잠기지 않게).
  function waitForKoreanFont() {
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = global.setTimeout(resolve, 8_000);
    });
    const load = document.fonts.load('700 48px "NanumSquareRound Game"', "한글").catch(() => []);
    return Promise.race([load, timeout]).finally(() => global.clearTimeout(timeoutId));
  }

  async function preloadCriticalAssets() {
    const images = [...document.querySelectorAll(CRITICAL_IMAGE_SELECTOR)];
    const fontLoads = document.fonts
      ? [
        document.fonts.load('600 48px "Lexend Game"'),
        document.fonts.load('normal 300 48px "Sofia Pro Soft Game"'),
        document.fonts.load('normal 400 48px "Sofia Pro Soft Game"'),
        document.fonts.load('normal 500 48px "Sofia Pro Soft Game"'),
        document.fonts.load('normal 700 48px "Sofia Pro Soft Game"'),
        waitForKoreanFont(),
      ]
      : [];

    // 오답 목록만 쓰는 보통 굵기 글꼴(사장님 2026-10-15 "1번으로 통일 해")은 미리 받아 두기만 하고 기다리지 않는다.
    // 목록은 한 판이 끝난 뒤에 열리니 그때는 받아져 있다(긴 단어 맞춤이 받은 글꼴로 잰다). 못 받아도 시작을 막지 않고
    // 목록은 바로 뒤 글꼴로 그려진다.
    if (document.fonts) {
      document.fonts.load('400 30px "Lexend Regular Game"').catch(() => []);
      document.fonts.load('500 27px "NanumSquareRound B Game"', "한글").catch(() => []);
    }

    await Promise.all([
      ...images.map(waitForImage),
      ...fontLoads,
    ]);
  }

  function preloadVocabularyAudio(questions) {
    if (typeof global.Audio !== "function") {
      return;
    }
    questions.forEach((question) => {
      if (!question.soundUrl || audioCache.has(question.soundUrl)) {
        return;
      }
      const audio = new Audio();
      audio.preload = "metadata";
      audio.src = question.soundUrl;
      audioCache.set(question.soundUrl, audio);
      audio.load();
    });
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

  function loadHelpInBackground() {
    if (!apiClient || state.launch?.isDemo) {
      return Promise.resolve([]);
    }
    if (helpPromise) {
      return helpPromise;
    }

    state.content.helpStatus = "loading";
    emitState();
    helpPromise = apiClient.getHelp()
      .then((items) => {
        state.content.help = normalizeHelp(items);
        state.content.helpStatus = "ready";
        emitState();
        return [...state.content.help];
      })
      .catch((error) => {
        state.content.helpStatus = "error";
        emitState();
        throw error;
      });
    helpPromise.catch(() => {});
    return helpPromise;
  }

  async function runBootstrap() {
    const launch = readLaunchContext();
    state.launch = launch;
    state.content = {
      info: null,
      words: [],
      questions: [],
      help: [],
      helpStatus: "idle",
    };
    helpPromise = null;
    apiClient = apiModule.createClient({
      baseUrl: launch.apiBaseUrl,
      locale: launch.locale,
      gameType: launch.gameType,
    });
    setLoading("loading", "게임 데이터를 불러오는 중입니다.");

    try {
      if (launch.isDemo) {
        const config = readEmbeddedConfig();
        await preloadCriticalAssets();
        state.content.questions = normalizeDemoQuestions(config);
        state.content.info = {
          title: "Word Match Soccer",
          content_id: "DEMO",
          source: "demo",
        };
      } else {
        if (!launch.fcId) {
          const error = new Error("게임 실행 파라미터 fc_id가 없습니다.");
          error.code = "MISSING_FC_ID";
          throw error;
        }

        // 2차 수정: info 는 한 판 시간(play_time)을 준다. 받지 못해도 단어 목록이 있으면 게임은 연다
        // (그때 한 판은 40초). 단어 목록이 실패하면 문제를 낼 수 없으니 지금처럼 오류로 올린다.
        const [info, vocabulary] = await Promise.all([
          Promise.resolve(apiClient.getGameInfo(launch.fcId)).catch(() => null),
          apiClient.getVocabularyList(launch.fcId),
          preloadCriticalAssets(),
        ]);
        const normalized = normalizeApiVocabulary(vocabulary);
        state.content.info = info || {};
        state.content.words = normalized.words;
        state.content.questions = normalized.questions;
        preloadVocabularyAudio(normalized.questions);
      }

      const readyMessage = launch.isLocalApiTest
        ? `실제 API ${launch.isGuest ? "게스트" : "회원"} 테스트 준비 완료`
        : launch.isDemo ? "데모 준비 완료" : "게임 준비 완료";
      setLoading("ready", readyMessage);
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

  async function getHelp(options = {}) {
    if (options.retry && state.content.helpStatus === "error") {
      helpPromise = null;
    }
    return loadHelpInBackground();
  }

  function assertMember(action) {
    if (!state.launch || state.launch.isGuest) {
      const error = new Error(`게스트는 ${action} 기능을 사용할 수 없습니다.`);
      error.code = "GUEST_NOT_ALLOWED";
      throw error;
    }
  }

  function getRanking() {
    assertMember("랭킹");
    if (state.launch.isDemo) {
      const error = new Error("데모 모드에서는 랭킹을 조회하지 않습니다.");
      error.code = "DEMO_NOT_ALLOWED";
      throw error;
    }
    return apiClient.getRanking(state.launch.fuId);
  }

  function saveHistory(score) {
    const numericScore = Math.trunc(Number(score) || 0);
    if (!state.launch || state.launch.isGuest || state.launch.isDemo) {
      return Promise.resolve({
        skipped: true,
        rank: 0,
        score: numericScore,
      });
    }
    return apiClient.saveHistory({
      fuId: state.launch.fuId,
      score,
    });
  }

  global.WordMatchContent = Object.freeze({
    bootstrap,
    decodeDisplayText,
    getHelp,
    getRanking,
    saveHistory,
    getState: snapshot,
    readLaunchContext,
  });
})(window);
