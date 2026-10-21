(function exposeWordMatchRules(global) {
  "use strict";

  /*
   * 점수·콤보·등급·시계. DOM을 모르므로 브라우저와 Node 양쪽에서 그대로 돈다.
   *
   * 값의 출처: 기획서(docs/game_spec.png) 항목 2.
   *   - Score: 정답 +100, 오답 -10, 3문제 연속 정답 시 추가 +100 콤보
   *   - 타이머: 1분 20초 (1~2단계 모두 포함)
   */
  const DEFAULTS = Object.freeze({
    playTimeSeconds: 80,
    correctScore: 100,
    incorrectScore: -10,
    // 하단 바 오른쪽 튜브 세 칸(combo_1/combo_2/combo_bonus)이 콤보 진행을 그린다.
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

    // 한글 카드와 영어 카드를 옳게 짝지었을 때.
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
     * 짝이 아닌 두 카드를 골랐을 때. 카드 짝 맞추기는 문제 단위가 없고 짝짓기
     * 하나가 곧 한 문제라, 콤보 튜브가 처음으로 돌아가도록 연속 기록도 끊는다
     * (두더지 방과 같은 판단).
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

    // 콤보 튜브 칸 수. 0..streakLength-1 을 돌아 마지막 칸은 보너스 순간에만 찬다.
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

  /*
   * 리워드 제공 기준(사장님 지시 2026-09-29, 12개 방 공통):
   *   Try again = 70% 미만 정답 · Good = 70%~99% · Excellent = 100%
   * 괄호로 "전체 제공 문제수 기준"이라고 못 박으셨다 — 분모는 푼 문제수가 아니라
   * 판에 깔린 짝 전부다(시간이 끝나 손도 못 댄 짝도 들어간다).
   * 70%가 Good 인지 Try again 인지는 사장님 확인 중이라, 경계값을 이 상수 한 곳에 둔다.
   */
  const RESULT_TIER_THRESHOLDS = Object.freeze({
    excellent: 1,
    good: 0.7,
  });

  // 결과 화면 문구. Excellent / Good / Try again 세 장이 있다.
  function resultTier(correctCount, presentedCount) {
    const total = Math.max(0, toInteger(presentedCount, 0));
    const correct = Math.max(0, toInteger(correctCount, 0));
    const ratio = total > 0 ? correct / total : 0;
    if (ratio >= RESULT_TIER_THRESHOLDS.excellent) return 0; // result_text0: Excellent
    if (ratio >= RESULT_TIER_THRESHOLDS.good) return 1; // result_text1: Good
    return 2; // result_text2: Try again
  }

  function formatClock(totalSeconds) {
    const safe = Math.max(0, Math.trunc(Number(totalSeconds) || 0));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  global.WordMatchRules = Object.freeze({
    DEFAULTS,
    RESULT_TIER_THRESHOLDS,
    createScoreboard,
    resultTier,
    formatClock,
  });
})(typeof window !== "undefined" ? window : globalThis);
