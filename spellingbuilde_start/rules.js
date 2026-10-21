(function exposeSpellingBuilderRules(global) {
  "use strict";

  // 기획서(참고자료) 3번 항목.
  const DEFAULTS = Object.freeze({
    questionCount: 10,
    playTimeSeconds: 210, // 3분 30초
    correctScore: 50,
    incorrectScore: -10,
    streakLength: 3,
    streakBonus: 100,

    // 2차 수정(PDF 3쪽 "오답 3번일때 정답 노출로 수정, 현재는 오답 2번일때"):
    // 기획서가 "기회 2번 차감" 과 "3회 오답에 강제 전환" 으로 서로 어긋나 있었고,
    // 예전에는 앞쪽(2씩 깎기)을 따라 두 번째 오답에 정답이 열렸다. 검수가 뒤쪽으로
    // 정했으므로 1씩 깎아 세 번째 오답에 소진되게 한다.
    chances: 3,
    mistakePenalty: 1,
  });

  function toPositiveInteger(value, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function toInteger(value, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? number : fallback;
  }

  function resolveSettings(options) {
    const given = options && typeof options === "object" ? options : {};
    return Object.freeze({
      questionCount: toPositiveInteger(given.questionCount, DEFAULTS.questionCount),
      playTimeSeconds: toPositiveInteger(given.playTimeSeconds, DEFAULTS.playTimeSeconds),
      correctScore: toInteger(given.correctScore, DEFAULTS.correctScore),
      incorrectScore: toInteger(given.incorrectScore, DEFAULTS.incorrectScore),
      streakLength: toPositiveInteger(given.streakLength, DEFAULTS.streakLength),
      streakBonus: toInteger(given.streakBonus, DEFAULTS.streakBonus),
      chances: toPositiveInteger(given.chances, DEFAULTS.chances),
      mistakePenalty: toPositiveInteger(given.mistakePenalty, DEFAULTS.mistakePenalty),
    });
  }

  function createScoreboard(options) {
    const settings = resolveSettings(options);

    const state = {
      score: 0,
      correctCount: 0,
      incorrectCount: 0,
      bonusCount: 0,
      // 결과 화면은 개수가 아니라 항목별 점수를 보여 준다.
      correctPoints: 0,
      incorrectPoints: 0,
      bonusPoints: 0,
      mistakeCount: 0,
      streak: 0,
      chancesLeft: settings.chances,
      questionOpen: false,
    };

    // 기획서에 점수 하한이 적혀 있지 않다. 아이용 게임에서 음수 점수판은
    // 의도된 연출이 아닌 것으로 보이지만, 임의로 0에서 자르면 기획과 달라진다.
    // 지금은 자르지 않고 그대로 두며, 필요하면 여기 한 곳만 고치면 된다.
    function applyScore(delta) {
      state.score += delta;
      return delta;
    }

    function openQuestion() {
      state.questionOpen = true;
      state.chancesLeft = settings.chances;
      return snapshot();
    }

    // 철자 하나를 틀렸을 때. 점수는 기획서대로 오답마다 깎는다.
    function registerMistake() {
      if (!state.questionOpen) {
        return { ...snapshot(), applied: false, exhausted: false, scoreDelta: 0 };
      }
      state.mistakeCount += 1;
      state.chancesLeft = Math.max(0, state.chancesLeft - settings.mistakePenalty);
      const scoreDelta = applyScore(settings.incorrectScore);
      state.incorrectPoints += settings.incorrectScore;
      return {
        ...snapshot(),
        applied: true,
        exhausted: state.chancesLeft <= 0,
        scoreDelta,
      };
    }

    // 단어를 끝까지 완성했을 때. 연속 정답 보너스는 여기서만 붙는다.
    function completeQuestion() {
      if (!state.questionOpen) {
        return { ...snapshot(), applied: false, scoreDelta: 0, bonusDelta: 0, bonus: false };
      }
      state.questionOpen = false;
      state.correctCount += 1;
      state.streak += 1;
      const scoreDelta = applyScore(settings.correctScore);
      state.correctPoints += settings.correctScore;

      let bonusDelta = 0;
      let bonus = false;
      if (state.streak > 0 && state.streak % settings.streakLength === 0) {
        bonus = true;
        bonusDelta = applyScore(settings.streakBonus);
        state.bonusCount += 1;
        state.bonusPoints += settings.streakBonus;
      }
      return { ...snapshot(), applied: true, scoreDelta, bonusDelta, bonus };
    }

    // 기회를 모두 써서 정답을 보여 주고 넘어갈 때. 연속 정답은 끊긴다.
    function failQuestion() {
      if (!state.questionOpen) {
        return { ...snapshot(), applied: false };
      }
      state.questionOpen = false;
      state.incorrectCount += 1;
      state.streak = 0;
      return { ...snapshot(), applied: true };
    }

    function snapshot() {
      return {
        score: state.score,
        correctCount: state.correctCount,
        incorrectCount: state.incorrectCount,
        bonusCount: state.bonusCount,
        correctPoints: state.correctPoints,
        incorrectPoints: state.incorrectPoints,
        bonusPoints: state.bonusPoints,
        mistakeCount: state.mistakeCount,
        streak: state.streak,
        chancesLeft: state.chancesLeft,
        questionOpen: state.questionOpen,
      };
    }

    return Object.freeze({
      settings,
      openQuestion,
      registerMistake,
      completeQuestion,
      failQuestion,
      getState: snapshot,
    });
  }

  /*
   * 결과 화면 문구. Excellent / Good / Try again 세 장이 있다.
   *
   * 사장님 지시(2026-09-29 · 검수_4차/공통_적용.md 5항 "리워드 제공 기준"):
   *   Try again = 70% 미만 · Good = 71~99% · Excellent = 100% (전체 제공 문제수 기준)
   * 지시문에 70~71% 사이가 비어 있어 **정확히 70% 는 Good** 으로 정했다. 단정적으로 쓰인 규칙이
   * "70% 미만이면 Try again" 하나뿐이기 때문이다(부모 방 결정, 실로폰도 같은 답을 받음).
   * 옛 기준 0.8 / 0.5 는 폐기다. 경계값은 여기 한 곳에만 둔다.
   */
  const GOOD_MIN_RATIO = 0.7;

  function resultTier(correctCount, questionCount) {
    const total = toPositiveInteger(questionCount, DEFAULTS.questionCount);
    const correct = Math.max(0, toInteger(correctCount, 0));
    const ratio = total > 0 ? correct / total : 0;
    if (ratio >= 1) return 0; // result_text0: Excellent
    if (ratio >= GOOD_MIN_RATIO) return 1; // result_text1: Good
    return 2; // result_text2: Try again
  }

  function formatClock(totalSeconds) {
    const safe = Math.max(0, Math.trunc(Number(totalSeconds) || 0));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  global.SpellingBuilderRules = Object.freeze({
    DEFAULTS,
    GOOD_MIN_RATIO,
    createScoreboard,
    resultTier,
    formatClock,
  });
})(typeof window !== "undefined" ? window : globalThis);
