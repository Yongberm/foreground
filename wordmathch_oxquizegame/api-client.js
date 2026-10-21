(function exposeWordMatchApi(global) {
  "use strict";

  const BASE_URL = "https://apis-review.littlefox.com";
  const API_PREFIX = "/api/v1/game/voca";
  const GAME_TYPE = "word_match_01";
  const DEFAULT_LOCALE = "ko_KR";
  const DEFAULT_API_USER_AGENT =
    "LITTLEFOX_VOCA_WEB:desktop/1.0.0/browser/Web:unknown";
  const DEFAULT_TIMEOUT_MS = 10_000;

  class ApiError extends Error {
    constructor(message, { code, status = 0, apiStatus = 0, cause } = {}) {
      super(message, cause === undefined ? undefined : { cause });
      this.name = "WordMatchApiError";
      this.code = code || "UNKNOWN_ERROR";
      this.status = status;
      this.apiStatus = apiStatus;
    }
  }

  function invalidParameter(name, reason) {
    return new ApiError(`${name} ${reason}`, {
      code: "INVALID_PARAM",
    });
  }

  function requireString(value, name) {
    if (typeof value !== "string" || value.trim() === "") {
      throw invalidParameter(name, "값이 필요합니다.");
    }
    if (/\r|\n/.test(value)) {
      throw invalidParameter(name, "값에 줄바꿈을 포함할 수 없습니다.");
    }
    return value.trim();
  }

  function optionalString(value, name) {
    if (value === undefined || value === null || value === "") return "";
    return requireString(value, name);
  }

  function normalizeBaseUrl(value) {
    const baseUrl = requireString(value, "baseUrl");
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch (error) {
      throw new ApiError("baseUrl이 올바른 절대 URL이 아닙니다.", {
        code: "INVALID_PARAM",
        cause: error,
      });
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw invalidParameter("baseUrl", "프로토콜은 http 또는 https여야 합니다.");
    }
    return parsed.origin;
  }

  function normalizeAuthToken(value) {
    const token = optionalString(value, "authToken");
    return token.replace(/^Bearer\s+/i, "");
  }

  function validateApiUserAgent(value) {
    const apiUserAgent = requireString(value, "apiUserAgent");
    const pattern = /^[^:\s]+:[^/\s]+\/[^/\s]+\/[^/\s]+\/[^:\s]+:[^\s]+$/;
    if (!pattern.test(apiUserAgent)) {
      throw invalidParameter(
        "apiUserAgent",
        "형식이 {app_name}:{device_type}/{app_version}/{device_name}/{os_name}:{os_version}와 일치하지 않습니다.",
      );
    }
    return apiUserAgent;
  }

  function validateTimeout(value) {
    if (!Number.isFinite(value) || value <= 0) {
      throw invalidParameter("timeoutMs", "값은 0보다 큰 숫자여야 합니다.");
    }
    return value;
  }

  function validateScore(value) {
    if (!Number.isSafeInteger(value)) {
      throw invalidParameter("score", "값은 안전한 정수여야 합니다.");
    }
    return value;
  }

  function createClient({
    fetchImpl = global.fetch && global.fetch.bind(global),
    baseUrl = BASE_URL,
    locale = DEFAULT_LOCALE,
    apiUserAgent = DEFAULT_API_USER_AGENT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    authToken = "",
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw invalidParameter("fetchImpl", "함수가 필요합니다.");
    }

    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const normalizedLocale = requireString(locale, "locale");
    const normalizedApiUserAgent = validateApiUserAgent(apiUserAgent);
    const normalizedTimeoutMs = validateTimeout(timeoutMs);
    const normalizedAuthToken = normalizeAuthToken(authToken);

    async function request(endpoint, parameters) {
      const url = new URL(`${API_PREFIX}/${endpoint}`, normalizedBaseUrl);
      Object.entries(parameters).forEach(([key, value]) => {
        if (value !== "" && value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });

      const headers = {
        Accept: "application/json",
        "api-user-agent": normalizedApiUserAgent,
        "api-locale": normalizedLocale,
      };
      if (normalizedAuthToken) {
        headers.Authorization = `Bearer ${normalizedAuthToken}`;
      }

      const controller = new AbortController();
      const timeoutId = global.setTimeout(
        () => controller.abort(),
        normalizedTimeoutMs,
      );

      try {
        let response;
        try {
          response = await fetchImpl(url.toString(), {
            method: "GET",
            headers,
            credentials: "omit",
            cache: "no-store",
            mode: "cors",
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted || error?.name === "AbortError") {
            throw new ApiError("API 요청 시간이 초과되었습니다.", {
              code: "TIMEOUT",
              cause: error,
            });
          }
          throw new ApiError("API 네트워크 요청에 실패했습니다.", {
            code: "NETWORK_ERROR",
            cause: error,
          });
        }

        if (!response || typeof response.json !== "function") {
          throw new ApiError("API 응답 객체가 올바르지 않습니다.", {
            code: "INVALID_RESPONSE",
          });
        }

        let payload;
        try {
          payload = await response.json();
        } catch (error) {
          throw new ApiError("API 응답을 JSON으로 해석할 수 없습니다.", {
            code: "INVALID_JSON",
            status: Number(response.status) || 0,
            cause: error,
          });
        }

        if (!response.ok) {
          throw new ApiError(
            typeof payload?.message === "string"
              ? payload.message
              : "API HTTP 요청이 실패했습니다.",
            {
              code: "HTTP_ERROR",
              status: Number(response.status) || 0,
              apiStatus: Number(payload?.status) || 0,
            },
          );
        }

        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new ApiError("API JSON 응답 형식이 올바르지 않습니다.", {
            code: "INVALID_RESPONSE",
            status: Number(response.status) || 0,
          });
        }

        if (payload.status !== 200) {
          throw new ApiError(
            typeof payload.message === "string"
              ? payload.message
              : "API가 오류 상태를 반환했습니다.",
            {
              code: "API_ERROR",
              status: Number(response.status) || 0,
              apiStatus: Number(payload.status) || 0,
            },
          );
        }

        return payload.data;
      } finally {
        global.clearTimeout(timeoutId);
      }
    }

    return Object.freeze({
      getGameInfo(fcId) {
        return request("info", {
          fc_id: requireString(fcId, "fcId"),
          type: GAME_TYPE,
        });
      },

      getVocabularyList(fcId) {
        return request("list", {
          fc_id: requireString(fcId, "fcId"),
        });
      },

      getHelp() {
        return request("help", {
          type: GAME_TYPE,
        });
      },

      getRanking(fuId) {
        return request("ranking", {
          fu_id: requireString(fuId, "fuId"),
          type: GAME_TYPE,
        });
      },

      saveHistory(options) {
        if (!options || typeof options !== "object" || Array.isArray(options)) {
          throw invalidParameter("saveHistory options", "객체가 필요합니다.");
        }
        return request("history", {
          type: GAME_TYPE,
          score: validateScore(options.score),
          fu_id: optionalString(options.fuId, "fuId"),
        });
      },
    });
  }

  global.WordMatchApi = Object.freeze({
    ApiError,
    BASE_URL,
    GAME_TYPE,
    DEFAULT_LOCALE,
    DEFAULT_API_USER_AGENT,
    createClient,
  });
})(window);
