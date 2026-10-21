(function installWordMatchApi(global) {
  "use strict";

  const DEFAULT_BASE_URL = "https://apis-review.littlefox.com";
  const DEFAULT_LOCALE = "ko_KR";
  const DEFAULT_GAME_TYPE = "word_match_02";
  const DEFAULT_TIMEOUT_MS = 10_000;

  class WordMatchApiError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = "WordMatchApiError";
      this.code = options.code || "API_ERROR";
      this.httpStatus = options.httpStatus || 0;
      this.bodyStatus = options.bodyStatus || 0;
      this.cause = options.cause;
    }
  }

  function requiredText(value, field) {
    const text = String(value ?? "").trim();
    if (!text) {
      throw new WordMatchApiError(`${field} 값이 필요합니다.`, {
        code: "INVALID_PARAMETER",
      });
    }
    return text;
  }

  function createClient(options = {}) {
    const fetchImpl = options.fetchImpl || global.fetch?.bind(global);
    if (typeof fetchImpl !== "function") {
      throw new WordMatchApiError("브라우저에서 fetch를 사용할 수 없습니다.", {
        code: "FETCH_UNAVAILABLE",
      });
    }

    const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    const locale = String(options.locale || DEFAULT_LOCALE).trim() || DEFAULT_LOCALE;
    const gameType = String(options.gameType || DEFAULT_GAME_TYPE).trim()
      || DEFAULT_GAME_TYPE;
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);

    async function request(path, query = {}) {
      const url = new URL(path, `${baseUrl}/`);
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      });

      const controller = new AbortController();
      const timeoutId = global.setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(url.toString(), {
          method: "GET",
          headers: {
            "api-locale": locale,
          },
          signal: controller.signal,
          credentials: "omit",
        });

        let payload;
        try {
          payload = await response.json();
        } catch (cause) {
          throw new WordMatchApiError("API 응답이 올바른 JSON이 아닙니다.", {
            code: "INVALID_JSON",
            httpStatus: response.status,
            cause,
          });
        }

        const bodyStatus = Number(payload?.status || 0);
        const bodyFailed = bodyStatus >= 400;
        if (!response.ok || bodyFailed) {
          throw new WordMatchApiError(
            payload?.message || `API 요청에 실패했습니다. (${bodyStatus || response.status})`,
            {
              code: "API_RESPONSE_ERROR",
              httpStatus: response.status,
              bodyStatus,
            },
          );
        }

        return payload?.data;
      } catch (error) {
        if (error instanceof WordMatchApiError) {
          throw error;
        }
        if (error?.name === "AbortError") {
          throw new WordMatchApiError("API 응답 시간이 초과되었습니다.", {
            code: "REQUEST_TIMEOUT",
            cause: error,
          });
        }
        throw new WordMatchApiError("API에 연결할 수 없습니다.", {
          code: "NETWORK_ERROR",
          cause: error,
        });
      } finally {
        global.clearTimeout(timeoutId);
      }
    }

    return Object.freeze({
      getGameInfo(fcId) {
        return request("/api/v1/game/voca/info", {
          fc_id: requiredText(fcId, "fc_id"),
          type: gameType,
        });
      },

      getVocabularyList(fcId) {
        return request("/api/v1/game/voca/list", {
          fc_id: requiredText(fcId, "fc_id"),
          type: gameType,
        });
      },

      getHelp() {
        return request("/api/v1/game/voca/help", {
          type: gameType,
        });
      },

      getRanking(fuId) {
        return request("/api/v1/game/voca/ranking", {
          fu_id: requiredText(fuId, "fu_id"),
          type: gameType,
        });
      },

      saveHistory({ fuId, score }) {
        const numericScore = Math.trunc(Number(score));
        if (!Number.isFinite(numericScore)) {
          throw new WordMatchApiError("저장할 점수가 올바르지 않습니다.", {
            code: "INVALID_PARAMETER",
          });
        }
        return request("/api/v1/game/voca/history", {
          fu_id: requiredText(fuId, "fu_id"),
          score: numericScore,
          type: gameType,
        });
      },
    });
  }

  global.WordMatchApi = Object.freeze({
    BASE_URL: DEFAULT_BASE_URL,
    DEFAULT_LOCALE,
    DEFAULT_GAME_TYPE,
    WordMatchApiError,
    createClient,
  });
})(window);
