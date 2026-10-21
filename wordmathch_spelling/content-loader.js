(function installSpellingBuilderContent(global) {
  "use strict";

  const apiModule = global.SpellingBuilderApi;
  if (!apiModule) {
    throw new Error("SpellingBuilderApi가 먼저 로드되어야 합니다.");
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
    // 검수 r31: 스펠링빌더는 랭킹이 없다. help API 가 응답하지 않을 때 쓰는
    // 이 기본 문구에서도 랭킹 항목을 뺀다.
  ]);

  // 사양: 총 10문제, 한 단어에서 2개 철자를 빈칸으로, 건반 6개는
  // 정답 철자 2개 + 오답 철자 2개 + 철자 없는 빈 건반 2개로 채운다.
  const QUESTION_COUNT = 10;
  const BLANK_COUNT = 2;
  const KEY_COUNT = 6;
  const DISTRACTOR_COUNT = 2;
  // 2차 수정(공통 1절 '단어 거름', 사장님 2026-10-02 "걷기"): 영어 길이 상한(14자)은 걷었다.
  // 검수 API 320개 중 5개(띄어쓰기 든 16~25자 구)가 빠지고 있었다. 긴 단어는 빼지 않고
  // 철자 타일을 줄여 한 줄에 담는다(script.js renderLetterRow — 25자에서 타일 47.6px · 글자 35.5px).
  // 가릴 철자가 2개 안 되는 단어만 게임이 성립하지 않으므로 계속 뺀다.
  // 2차 수정(공통 1절 '단어 거름'): 뜻 길이 거름(24자)은 걷었다. 검수 API 9레벨 320개 중
  // 88개가 이 거름에 빠지고 있었다(2026-10-02 실측). 긴 뜻은 빼지 않고 뜻 상자에 맞게
  // 줄인다(script.js fitMeaningText). 뜻 문구가 너무 길면 API 쪽에서 고친다.
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
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

  // === 검수 8항 특수문자 처리 시작 ===
  // 화면에 보이는 글자에만 쓴다. 소리 주소·식별자·URL 은 대상이 아니다.
  // 태그는 일부러 풀지 않는다 — 글자 참조만 풀기 때문에 <br> 은 <br> 글자 그대로 남는다.
  // 한 번만 푼다 — 한 번 훑고 끝내므로 &amp;lt; 는 &lt; 까지만 풀린다.
  const HEX_DIGITS = "0123456789abcdef";

  const SIMPLE_ESCAPES = {
    n: "\n",
    t: "\t",
    r: "\r",
    "\\": "\\",
    '"': '"',
    "'": "'",
  };

  const NAMED_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00a0",
    ndash: "\u2013",
    mdash: "\u2014",
    hellip: "\u2026",
    lsquo: "\u2018",
    rsquo: "\u2019",
    ldquo: "\u201c",
    rdquo: "\u201d",
    middot: "\u00b7",
    bull: "\u2022",
    deg: "\u00b0",
    times: "\u00d7",
    divide: "\u00f7",
    copy: "\u00a9",
    reg: "\u00ae",
    trade: "\u2122",
  };

  function isHexRun(value, width) {
    if (value.length !== width) return false;
    for (const character of value) {
      if (!HEX_DIGITS.includes(character.toLowerCase())) return false;
    }
    return true;
  }

  function decodeEscapes(value) {
    const text = String(value ?? "");
    if (!text.includes("\\")) return text;

    let decoded = "";
    let index = 0;
    while (index < text.length) {
      const character = text[index];
      if (character !== "\\" || index + 1 >= text.length) {
        decoded += character;
        index += 1;
        continue;
      }

      const marker = text[index + 1];
      if (marker === "u" || marker === "x") {
        const width = marker === "u" ? 4 : 2;
        const digits = text.slice(index + 2, index + 2 + width);
        if (isHexRun(digits, width)) {
          decoded += String.fromCodePoint(Number.parseInt(digits, 16));
          index += 2 + width;
          continue;
        }
        decoded += character;
        index += 1;
        continue;
      }

      const mapped = SIMPLE_ESCAPES[marker];
      if (mapped === undefined) {
        decoded += character;
        index += 1;
        continue;
      }
      decoded += mapped;
      index += 2;
    }
    return decoded;
  }

  function decodeEntities(value) {
    const text = String(value ?? "");
    if (!text.includes("&")) return text;
    return text.replace(
      /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
      (match, body) => {
        if (body[0] === "#") {
          const isHex = body[1] === "x" || body[1] === "X";
          const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
          if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
          return String.fromCodePoint(code);
        }
        const mapped = NAMED_ENTITIES[body];
        return mapped === undefined ? match : mapped;
      },
    );
  }

  function decodeDisplayText(value) {
    return decodeEntities(decodeEscapes(String(value ?? "").trim()));
  }
  // === 검수 8항 특수문자 처리 끝 ===

  // 2차 검수 공통-9: 시작 화면에 쓰는 동화 제목 · 부제목도 단어 · 뜻과 같이 특수 문자를 풀어 둔다.
  // 나머지 값(play_time 등)은 받은 그대로다.
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

  function cloneQuestion(question) {
    return {
      ...question,
      letters: [...question.letters],
      blanks: [...question.blanks],
      keys: question.keys.map((key) => ({ ...key })),
    };
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
        questions: state.content.questions.map(cloneQuestion),
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

    global.dispatchEvent(new global.CustomEvent("spellingbuilder:content-state", {
      detail: snapshot(),
    }));
  }

  function setLoading(status, message, error = null) {
    state.loading = { status, message, error };
    emitState();
  }

  function isPlayableWord(text) {
    const letters = [...text];
    if (letters.length < BLANK_COUNT) return false;
    return letters.filter(isLetter).length >= BLANK_COUNT;
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
        `게임에는 철자 ${BLANK_COUNT}개 이상을 가릴 수 있는 단어가 필요합니다.`,
        "INVALID_VOCABULARY",
      );
    }

    return words;
  }

  function pickIndexes(count, size, random) {
    // Fisher-Yates over the candidate positions, then keep the first `size`.
    const pool = Array.from({ length: count }, (_, index) => index);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool.slice(0, size);
  }

  function chooseBlanks(letters, random) {
    const candidates = letters
      .map((letter, index) => ({ letter: letter.toLowerCase(), index }))
      .filter((entry) => isLetter(entry.letter));

    // 같은 철자가 두 건반에 겹쳐 보이지 않도록 서로 다른 철자를 먼저 고른다.
    // 서로 다른 철자가 부족한 단어(예: "ee")에서만 중복을 허용한다.
    const byLetter = new Map();
    candidates.forEach((entry) => {
      if (!byLetter.has(entry.letter)) byLetter.set(entry.letter, []);
      byLetter.get(entry.letter).push(entry.index);
    });

    const distinctLetters = [...byLetter.keys()];
    if (distinctLetters.length >= BLANK_COUNT) {
      const picked = pickIndexes(distinctLetters.length, BLANK_COUNT, random)
        .map((position) => {
          const group = byLetter.get(distinctLetters[position]);
          return group[Math.floor(random() * group.length)];
        });
      return picked.sort((left, right) => left - right);
    }

    return pickIndexes(candidates.length, BLANK_COUNT, random)
      .map((position) => candidates[position].index)
      .sort((left, right) => left - right);
  }

  function chooseDistractors(answerLetters, random) {
    const excluded = new Set(answerLetters);
    const pool = [...ALPHABET].filter((letter) => !excluded.has(letter));
    return pickIndexes(pool.length, DISTRACTOR_COUNT, random)
      .map((position) => pool[position]);
  }

  function buildKeys(answerLetters, random) {
    const keys = [
      ...answerLetters.map((letter) => ({ letter, isAnswer: true })),
      ...chooseDistractors(answerLetters, random).map((letter) => ({ letter, isAnswer: false })),
    ];
    while (keys.length < KEY_COUNT) {
      keys.push({ letter: "", isAnswer: false });
    }

    const order = pickIndexes(keys.length, keys.length, random);
    return order.map((position) => keys[position]);
  }

  // 검수 r7: 영단어는 모두 소문자로 보여준다. 시안은 첫 글자를 대문자로 그렸으나
  // (예: "Auditorium") 검수에서 전 게임 공통으로 소문자 통일이 확정됐다.
  function displayLetters(text) {
    return [...text.toLocaleLowerCase("en-US")];
  }

  function questionFromWord(word, random) {
    const letters = displayLetters(word.text);
    const blanks = chooseBlanks(letters, random);
    const answerLetters = blanks.map((index) => letters[index].toLowerCase());

    return {
      // 검수 r7: 오답 노트와 음성 안내도 이 값을 그대로 쓴다. API 는 "Auditorium"
      // 처럼 첫 글자를 대문자로 내려주므로 여기서 소문자로 맞춰 둔다.
      english: letters.join(""),
      meaning: word.mean,
      soundUrl: word.soundUrl,
      letters,
      blanks,
      keys: buildKeys(answerLetters, random),
    };
  }

  // 입력은 normalizeVocabulary를 통과한 단어({text, mean, soundUrl})다. API 원본
  // 형태(sound_url)를 그대로 넘기면 여기서 걸러 호출부의 실수를 드러낸다.
  function createSpellingQuestions(words, random = Math.random) {
    if (!Array.isArray(words) || words.length === 0) {
      throw contentError("문제로 만들 단어가 없습니다.", "INVALID_VOCABULARY");
    }
    const playable = words.filter((word) => word
      && typeof word.text === "string"
      && typeof word.mean === "string"
      && isPlayableWord(word.text));
    if (playable.length === 0) {
      throw contentError(
        `게임에는 철자 ${BLANK_COUNT}개 이상을 가릴 수 있는 단어가 필요합니다.`,
        "INVALID_VOCABULARY",
      );
    }
    // 사양: 총 10문제를 랜덤으로 제공한다. 단어가 10개보다 적으면 있는 만큼 낸다.
    const selection = pickIndexes(playable.length, Math.min(QUESTION_COUNT, playable.length), random);
    return selection.map((position) => questionFromWord(playable[position], random));
  }

  function normalizeDemoQuestions(config, random = Math.random) {
    const source = Array.isArray(config?.demo?.words)
      ? config.demo.words
      : config?.words;
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

    return createSpellingQuestions(words, random);
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
        // 2차 수정: 한 판 시간은 API play_time 을 쓰고 없으면 지금 값(180초)이다. 테스트 모드는
        // API 가 없으므로 설정에 적힌 값이 있을 때만 넘긴다 — 지어낸 60초를 넣으면 그것이 한 판 시간이 된다.
        const testPlayTime = Number(config?.demo?.info?.play_time);
        state.content.info = {
          source: `test-${launch.testMode}`,
          ...(testPlayTime > 0 ? { play_time: testPlayTime } : {}),
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
        // 2차 수정(공통 4절): info 는 한 판 시간과 동화 제목 · 부제목(2차 검수 공통-9)을 준다. info 요청만 실패해도 판은 열고
        // 한 판 시간은 지금 값(180초)으로 간다. 단어 목록이 실패하면 지금처럼 오류 화면이다.
        const [info, vocabulary] = await Promise.all([
          apiClient.getGameInfo(launch.fcId).catch(() => null),
          apiClient.getVocabularyList(launch.fcId),
        ]);
        const words = normalizeVocabulary(vocabulary);
        state.content.info = normalizeInfo(info);
        state.content.words = words;
        state.content.questions = createSpellingQuestions(words);
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

  // 사양: 매 판마다 빈칸 위치와 건반 배치를 다시 뽑는다. 같은 단어 목록이라도
  // 두 번째 판이 첫 판과 같은 문제가 되지 않도록 한다.
  function rebuildQuestions() {
    if (state.content.words.length > 0) {
      state.content.questions = createSpellingQuestions(state.content.words);
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

  global.SpellingBuilderContent = Object.freeze({
    bootstrap,
    rebuildQuestions,
    getHelp,
    getRanking,
    saveHistory,
    getState: snapshot,
    readLaunchContext,
    createSpellingQuestions,
    normalizeVocabulary,
    QUESTION_COUNT,
    BLANK_COUNT,
    KEY_COUNT,
  });
})(window);
