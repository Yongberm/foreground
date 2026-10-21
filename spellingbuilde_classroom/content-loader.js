(function installSpellingBuilderContent(global) {
  "use strict";

  const apiModule = global.SpellingBuilderApi;
  if (!apiModule) {
    throw new Error("SpellingBuilderApi가 먼저 로드되어야 합니다.");
  }

  /* 터치 단어(5단계) 도움말 기본 문구. API help가 비거나 실패할 때만 쓴다.
     형제 스펠링 빌더(write·waterpipe·start)와 같은 스펙: 기획서의 규칙을 게임 전용
     문구로 옮기고, API 응답이 있으면 그쪽(JSON 항목 전부)이 우선한다. */
  const DEFAULT_HELP_ITEMS = Object.freeze([
    Object.freeze({
      title: "게임 방법",
      content: "칠판의 한글 뜻을 보고 아래 철자 타일을 단어 순서대로 누르세요.\n첫 글자는 미리 채워져 있고, 순서가 맞으면 철자가 위 칸으로 올라갑니다.",
    }),
    Object.freeze({
      title: "기회 · 점수",
      content: "한 문제의 기회는 3번이에요. 순서가 틀리면 기회가 줄고, 다 쓰면 정답을 보여 주고 다음 문제로 넘어갑니다.\n정답 +50점, 오답 -10점, 3문제 연속 정답이면 +100점 보너스!",
    }),
    Object.freeze({
      title: "시간",
      content: "총 12문제, 제한 시간은 3분 30초입니다.\n시간이 끝나면 결과 화면으로 넘어갑니다.",
    }),
  ]);

  // 사양(기획서 docs/기획서_터치단어_5단계.png): 총 12문제 · 타이머 3분 30초.
  const QUESTION_COUNT = 12;
  /* 규약 v1.2 info.play_time("전체 게임 플레이 타임(초) — 타입별 설정값").
     한 판 시간은 이 값을 먼저 쓴다(2차 수정 2026-10-02, 사장님 "한 판 시간 API 우선, 없으면
     지금 값 … 강의실 210초"). 예전에는 "전 타입 공통 기본값 120"이라며 쓰지 않았다 — 그
     판단을 걷었다. 값이 없을 때의 기본값은 기획서 사양(210초 = 3분 30초)이다.
     실제 게임 시간은 script.js 의 onContentReady 가 정한다(playSeconds). */
  const PLAY_TIME_SECONDS = 210;
  /* 정답 칸(answer_frame 1360px)에는 103px 칸이 109px 피치로 12개 들어간다(시안 실측).
     그래서 단어는 최대 12글자다. 이 게임은 오답 철자를 두지 않으므로 선택 줄도 같은 수다. */
  const MAX_WORD_LENGTH = 12;
  const MIN_WORD_LENGTH = 1;
  /* 뜻 길이로는 거르지 않는다(2차 수정 공통 1절 "단어 거름", 2026-10-02 — 길이 거름은 걷고,
     단어 내용이 문제면 API 쪽에서 고친다). 예전에는 화면 글자 24자를 넘는 뜻을 출제에서 뺐다.
     긴 뜻은 칠판 안에서 script.js 의 fitMeaningText 가 여러 줄로 접고 글자를 줄여 담는다. */
  const TEST_MEMBER_ID = "LOCAL-TEST-MEMBER";

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

  // 공통 8항(2026-09-29): 서버가 준 글자 안의 이스케이프 문자와 HTML 엔티티를 실제
  // 문자로 바꾼다. 글자 그대로 온 "\n" 이 화면에 역슬래시와 n 으로 남던 문제다.
  // 태그는 살리지 않는다 — 화면에는 textContent 로만 넣으므로 <br> 은 줄바꿈이 되지 않고
  // 글자 그대로 남는다. 태그를 살리려면 innerHTML 이 필요하고, 그러면 서버가 준 글자가
  // 화면 코드가 된다. 다만 &lt;br&gt; 처럼 엔티티로 온 것은 decodeEntities 가 "<br>" 이라는
  // 글자로 풀어 준다(화면에 <br> 이라고 보인다) — 태그로 동작하지는 않는다.
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
    /* NFC 로 모은다 — 악센트가 따로 붙은 꼴(NFD, 예: e + ´)로 오면 글자 하나가 타일 둘로 갈라진다
       (알파벳만 거름을 걷은 뒤 생긴 경우, 2026-10-02 반박 검사로 재현). */
    return decodeEntities(decodeEscapes(text)).replace(/\r\n?/g, "\n").trim().normalize("NFC");
  }

  /* info 의 제목 · 부제목은 화면 글자다(시작화면 동화 정보, 2차 검수 공통-9) — 단어 · 뜻과 같은 규칙으로 푼다
     (&amp; 같은 표기 · 앞뒤 빈칸 · 악센트 꼴). 나머지 값(play_time 등)은 그대로 둔다. */
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

  /* 정답 칸에 놓을 수 있는 단어: 1~12글자(띄어쓰기 · 기호도 한 칸)면 된다.
     - 12글자: 정답 칸이 103px 칸 12개뿐이다(answer_frame 1360px, 109px 피치 — 위 MAX_WORD_LENGTH).
       13글자 단어는 칸이 모자라 문제를 낼 수 없다 — 게임 구조라 남긴다.
     - 알파벳만 거름은 걷었다(2026-10-02, 사장님 "역시 API를 통해 전달 되는 내용이 세팅을 통해 해결" →
       선택지에서 "거름 걷기"). 띄어쓰기 · 하이픈 · 마침표가 든 단어도 나온다. 띄어쓰기는 빈 타일 ·
       빈 칸, 기호는 그 글자 타일이 되고, 순서대로 누르면 끝까지 풀린다(README 실측). 그런 단어를
       내지 않으려면 API 단어 세팅에서 뺀다. */
  function isPlayableWord(text) {
    // 칸 수는 판에 실제로 놓이는 글자(displayLetters — NFC · 소문자)로 센다. 소문자로 바꾸면
    // 길어지는 글자(예: İ → i̇)가 있어 원문 길이로 세면 12칸을 넘는 판이 생긴다.
    const letters = displayLetters(text);
    return letters.length >= MIN_WORD_LENGTH && letters.length <= MAX_WORD_LENGTH;
  }

  // 시안(docs/game_preview.png): 철자 타일과 정답 칸의 글자는 전부 소문자다.
  function displayLetters(text) {
    return [...cleanText(text).normalize("NFC").toLowerCase()];
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
      /* 남기는 거름은 게임이 성립하지 않는 것뿐이다: 빈 단어 · 빈 뜻, 그리고 정답 칸에 놓을 수
         없는 단어(isPlayableWord — 1~12글자). 근거는 isPlayableWord 위 주석. */
      .filter((item) => item.text
        && item.mean
        && isPlayableWord(item.text));

    if (words.length === 0) {
      throw contentError(
        `게임에는 1~${MAX_WORD_LENGTH}글자 단어가 필요합니다.`,
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
        `게임에는 1~${MAX_WORD_LENGTH}글자 단어가 필요합니다.`,
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

  /* help API 가 준 JSON 항목을 순서 그대로 쓴다(사용자 지시 2026-09-08: "JSON으로 받는 걸
     기준으로 뿌려야 한다"). 제목·본문이 모두 빈 항목만 뺀다 — 항목을 골라 내지 않는다. */
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
      /* 데모 · 시험 모드는 API 가 없다. play_time 은 설정에 적혀 있을 때만 싣고 지어내지 않는다
         (2차 수정 2026-10-02). 예전에는 없으면 210 을 채워 넣었는데, 한 판 시간이 info.play_time
         을 먼저 쓰게 되면서 그 지어낸 210 이 "API 값"처럼 보여 gameConfig.classroom.timerSeconds
         를 덮었다(이 방에서 12초 설정이 210초로 뜨는 것을 재현). 값이 없으면 script.js 가 설정값,
         그것도 없으면 210초로 간다. playTimeSeconds() 는 그대로 210 을 돌려준다. */
      const demoPlayTime = Number(config?.demo?.info?.play_time);
      const configuredPlayTime = Number.isFinite(demoPlayTime) && demoPlayTime > 0 ? { play_time: demoPlayTime } : {};
      if (launch.isTest) {
        state.content.questions = normalizeDemoQuestions(config);
        state.content.info = {
          source: `test-${launch.testMode}`,
          ...configuredPlayTime,
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
          ...configuredPlayTime,
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
        /* info 요청만 실패해도 판은 열린다(2차 수정 공통 4절, 2026-10-02). 예전에는 둘을
           Promise.all 로 묶어 info 하나가 실패하면 단어를 받고도 "불러오지 못했습니다"에서 멈췄다.
           info 가 실패하면 {} 로 두고, 한 판 시간은 지금 값(210초)으로 간다. 단어 목록 실패는
           그대로 오류다 — 단어 없이는 판을 열 수 없다. */
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
     화면 타이머는 script.js 가 같은 규칙(playSeconds)으로 정한다 — 위 PLAY_TIME_SECONDS 주석 참조. */
  function playTimeSeconds() {
    const raw = Number(state.content.info?.play_time);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : PLAY_TIME_SECONDS;
  }

  function requireLiveClient() {
    if (!state.launch || !apiClient) {
      throw contentError("게임 데이터 로더가 준비되지 않았습니다.", "CONTENT_NOT_READY");
    }
  }

  /* 랭킹 조회 함수는 없다 — 스펠링 빌더 게임에는 랭킹이 들어가지 않는다(사용자 결정 2026-09-08).
     규약의 ranking 엔드포인트는 부르지 않고, 기록(history)만 저장한다. */

  // 사양: 획득 점수(정답 +50 · 오답 -10 · 연속 보너스 +100 합산)를 저장한다.
  function saveHistory(score) {
    const numericScore = Math.trunc(Number(score));
    if (!Number.isFinite(numericScore)) {
      throw contentError("저장할 점수가 올바르지 않습니다.", "INVALID_SCORE");
    }
    if (state.launch?.isTest) {
      return Promise.resolve({ test: true, score: numericScore });
    }
    if (state.launch?.isDemo) {
      return Promise.resolve({ skipped: true, score: numericScore });
    }
    requireLiveClient();
    return apiClient.saveHistory({ fuId: state.launch.fuId, score: numericScore });
  }

  global.SpellingBuilderContent = Object.freeze({
    bootstrap,
    rebuildQuestions,
    getHelp,
    saveHistory,
    getState: snapshot,
    playTimeSeconds,
    readLaunchContext,
    createQuestions,
    decodeDisplayText,
    normalizeVocabulary,
    displayLetters,
    isPlayableWord,
    QUESTION_COUNT,
    MAX_WORD_LENGTH,
    PLAY_TIME_SECONDS,
  });
})(window);
