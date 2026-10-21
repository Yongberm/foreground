(function exposeMoleGameRules(global) {
  "use strict";

  /*
   * 점수·콤보·등급·시계. DOM을 모르므로 브라우저와 Node 양쪽에서 그대로 돈다.
   *
   * 값의 출처에 대하여 — 두더지 기획서(`mole _devguide.key`)는 PGRF 안전 바닥이
   * `*.key`(개인키) 패턴으로 막고 있어 아직 읽지 못했다. 그래서 확정 수치가 아니라
   * 형제 방(spellingbuilde_start / wordmathch_spelling)이 쓰는 값을 그대로 옮겨
   * 두었다. 기획서가 열리면 이 DEFAULTS 한 곳만 고치면 된다.
   */
  const DEFAULTS = Object.freeze({
    questionCount: 10,
    // 2차 수정(공통 문서 1절): 기본 40초. 실행 시점에는 info.play_time 이 있으면 그쪽이 이긴다.
    // 예전 120 은 규약 v1.2 문서의 "전 타입 기본값"이었다.
    playTimeSeconds: 40,
    /*
     * 정답 100 은 워드매치 계열 공통 규격이다. OX퀴즈·Soccer·레이싱·바다속·
     * 카드매칭 다섯 방이 모두 `correct: 100 / incorrect: -10 / comboEvery: 3 /
     * comboBonus: 100` 을 쓴다.
     *
     * 처음에는 50 이었는데, 이 방을 만들 때 참고한 형제가 스펠링빌더 4단계
     * (spellingbuilde_start)여서 **다른 계열의 값**을 가져온 탓이다. 50 은
     * 스펠링빌더 규격이다. 시안의 `Score 1500` 도 100 기준이라야 나온다 —
     * 50 으로는 열 문제를 다 맞혀도 800 이 최대다.
     */
    correctScore: 100,
    incorrectScore: -10,
    // 하단 바 오른쪽 여우 세 칸(ui_bonus0/1/2)이 콤보 진행을 그린다.
    streakLength: 3,
    streakBonus: 100,
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
    });
  }

  function createScoreboard(options) {
    const settings = resolveSettings(options);

    const state = {
      score: 0,
      matchedCount: 0,
      missCount: 0,
      bonusCount: 0,
      // 결과 화면은 개수가 아니라 항목별 점수를 보여 준다(형제와 같다).
      correctPoints: 0,
      incorrectPoints: 0,
      bonusPoints: 0,
      streak: 0,
      closed: false,
    };

    /*
     * 기획서에 점수 하한이 적혀 있지 않다. 형제 방과 같은 판단으로 0에서 자르지
     * 않고 그대로 둔다. 필요하면 여기 한 곳만 고치면 된다.
     */
    function applyScore(delta) {
      state.score += delta;
      return delta;
    }

    // 영어 판과 뜻 판을 옳게 짝지었을 때.
    function registerMatch() {
      if (state.closed) {
        return { ...snapshot(), applied: false, scoreDelta: 0, bonusDelta: 0, bonus: false };
      }
      state.matchedCount += 1;
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

    /*
     * 짝이 아닌 두 판을 골랐을 때. 하단 콤보 여우가 처음으로 돌아가야 하므로
     * 연속 기록도 함께 끊는다 — 형제의 "오답은 점수만, 연속은 문제 실패에서 끊김"과
     * 다른 점이다. 두더지는 문제 단위가 없고 짝짓기 하나가 곧 한 문제이기 때문이다.
     */
    function registerMiss() {
      if (state.closed) {
        return { ...snapshot(), applied: false, scoreDelta: 0 };
      }
      state.missCount += 1;
      state.streak = 0;
      const scoreDelta = applyScore(settings.incorrectScore);
      state.incorrectPoints += settings.incorrectScore;
      return { ...snapshot(), applied: true, scoreDelta };
    }

    function close() {
      state.closed = true;
      return snapshot();
    }

    // 콤보 여우 칸 수. 0..streakLength-1 을 돌려 마지막 칸은 보너스 순간에만 찬다.
    function comboFilled() {
      return state.streak % settings.streakLength;
    }

    function snapshot() {
      return {
        score: state.score,
        matchedCount: state.matchedCount,
        missCount: state.missCount,
        bonusCount: state.bonusCount,
        correctPoints: state.correctPoints,
        incorrectPoints: state.incorrectPoints,
        bonusPoints: state.bonusPoints,
        streak: state.streak,
        comboFilled: comboFilled(),
        closed: state.closed,
      };
    }

    return Object.freeze({
      settings,
      registerMatch,
      registerMiss,
      close,
      getState: snapshot,
    });
  }

  // 결과 화면 문구. Excellent / Good / Try again 세 장이 있다.
  /*
   * 리워드 제공 기준(사장님 지시 2026-09-29, 12개 방 공통):
   *   Try again  70% 미만        Good  70~99%        Excellent  100%
   * 정확히 70% 는 Good 이다 — 단정적으로 쓰인 규칙이 "70% 미만이면 Try again" 하나뿐이다.
   * 경계가 다시 움직일 수 있으니 값은 여기 두 줄에만 둔다.
   */
  const TIER_EXCELLENT_RATIO = 1;
  const TIER_GOOD_RATIO = 0.7;

  /*
   * 비율은 **전체 제공 문제수**로 나눈다(사장님 확답 2026-09-29).
   * 3차까지는 푼 짝의 수로 나눴다 — 그래서 열 짝 중 세 짝만 다뤄 셋 다 맞히면
   * Excellent 가 됐다. 지시문이 괄호로 "전체 제공 문제수 기준" 이라고 못 박아 뒤집었다.
   */
  function resultRatio(correctCount, questionCount) {
    const total = toPositiveInteger(questionCount, DEFAULTS.questionCount);
    const correct = Math.max(0, toInteger(correctCount, 0));
    return total > 0 ? correct / total : 0;
  }

  // 등급은 비율 하나로만 갈린다. 경계를 보는 곳은 여기뿐이다.
  function resultTier(ratio) {
    const value = Number.isFinite(Number(ratio)) ? Number(ratio) : 0;
    if (value >= TIER_EXCELLENT_RATIO) return 0; // result_text0: Excellent
    return value >= TIER_GOOD_RATIO ? 1 : 2; // result_text1: Good / result_text2: Try again
  }

  function formatClock(totalSeconds) {
    const safe = Math.max(0, Math.trunc(Number(totalSeconds) || 0));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  global.MoleGameRules = Object.freeze({
    DEFAULTS,
    createScoreboard,
    resultRatio,
    resultTier,
    formatClock,
  });
})(typeof window !== "undefined" ? window : globalThis);
