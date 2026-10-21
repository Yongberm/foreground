(function installSpellingBuilderStrokeGuide(global) {
  "use strict";

  /*
   * 획순 길안내 — 게임과 편집기 미리보기가 함께 쓴다.
   *
   * 같은 로직을 양쪽에 손으로 옮겨 적으면 한쪽만 고쳐져 어긋난다.
   * (실제로 러너를 게임만 고쳤을 때 미리보기에서 "다음 획이 미리 움직이는"
   *  옛 동작이 그대로 보였다.) 그래서 여기 한 곳에만 둔다.
   *
   * 두 가지 상태가 있다.
   *   대기: 1획부터 차례로 밝아지고, 밝은 점 하나가 그 획을 시작->끝으로 훑는다.
   *   색칠: 안내 애니메이션과 번호는 물러나고, 붓이 지나간 자리의 점에 불이 들어온다.
   */

  const SVG_NS = "http://www.w3.org/2000/svg";

  const C = {
    START_DOT_R: 11,     // 획이 시작하는 자리 표시
    BADGE_R: 26,         // 획 번호
    RUNNER_R: 15,        // 방향을 알려 주는 밝은 점

    // 방향 표시 속도는 획 길이와 무관하게 일정해야 한다. 시간을 고정하면
    // 긴 획은 쏜살같고 짧은 획은 기어가서, 아이가 "이 획은 빠르게 쓰는 획"으로
    // 잘못 읽는다. 속도를 바꾸려면 RUNNER_SPEED 하나만 고치면 된다.
    RUNNER_SPEED: 210,   // 좌표 단위 / 초
    RUNNER_MIN_MS: 520,
    RUNNER_MAX_MS: 6400, // 최장 획(W 1312단위, 6.2초)도 걸리지 않는 여유
    RUNNER_MIN_LEN: 50,  // i·j의 점(1~3단위)에는 방향 표시가 없다

    // 1획이 끝나면 2획, 그다음 3획 — 획이 끝나는 즉시 다음으로 넘어간다.
    // 고정 간격을 쓰면 짧은 획 뒤에 빈 시간이 생겨 순서가 끊겨 보인다.
    STROKE_GAP_MS: 220,
  };

  function polylineToPath(points) {
    if (!points || points.length < 2) return "";
    return `M${points[0][0]},${points[0][1]} `
      + points.slice(1).map((p) => `L${p[0]},${p[1]}`).join(" ");
  }

  function pathLength(path) {
    try { return path.getTotalLength(); } catch (_) { return 0; }
  }

  function sweepDuration(len) {
    if (!(len > 0)) return C.RUNNER_MIN_MS;
    return Math.round(Math.min(C.RUNNER_MAX_MS,
      Math.max(C.RUNNER_MIN_MS, len / C.RUNNER_SPEED * 1000)));
  }

  /*
   * group : 안내선을 담을 <g>
   * svg   : is-tracing 을 걸 바깥 <svg> (없어도 된다)
   * asset : SpellingBuilderTraceAssets.letter(글자)
   */
  function create(options) {
    const doc = options.doc || global.document;
    const group = options.group;
    const svg = options.svg || null;
    const asset = options.asset;
    if (!doc || !group || !asset || !asset.strokes || !asset.strokes.length) return null;

    const make = (tag, attrs) => {
      const node = doc.createElementNS(SVG_NS, tag);
      for (const key in attrs) node.setAttribute(key, attrs[key]);
      return node;
    };

    group.textContent = "";

    const nodes = asset.strokes.map((points, index) => {
      const d = polylineToPath(points);
      const path = make("path", { class: "stroke-guide-path", d });
      group.appendChild(path);

      const [sx, sy] = (asset.starts && asset.starts[index]) || points[0];
      const dot = make("circle", { class: "stroke-guide-start", cx: sx, cy: sy, r: C.START_DOT_R });
      group.appendChild(dot);

      const len = pathLength(path);
      return { path, dot, d, len, sweepMs: sweepDuration(len), badge: null, label: null };
    });

    (asset.badges || []).forEach((spot, index) => {
      const node = nodes[index];
      if (!node) return;
      node.badge = make("circle", { class: "stroke-guide-badge", cx: spot[0], cy: spot[1], r: C.BADGE_R });
      group.appendChild(node.badge);
      node.label = make("text", { class: "stroke-guide-label", x: spot[0], y: spot[1] });
      node.label.textContent = String(index + 1);
      group.appendChild(node.label);
    });

    // 방향 표시는 획마다 두지 않고 하나만 둔다. 획마다 두면 자기 차례가 아닌
    // 러너까지 계속 돌아 "다음 획이 미리 움직이는" 것처럼 보인다.
    const runner = make("circle", { class: "stroke-guide-runner", r: C.RUNNER_R });
    group.appendChild(runner);

    // 방향 표시는 위치를 직접 찍는다. animateMotion 은 끝나거나 교체될 때
    // 요소를 원점(0,0)으로 되돌리는데, 그 프레임이 아직 보이면 타일 왼쪽 위
    // 모서리에서 번쩍인다. 직접 찍으면 보이기 전에 자리를 잡아 둘 수 있다.
    let runRaf = 0;
    function placeRunner(pt) {
      runner.setAttribute("cx", pt.x);
      runner.setAttribute("cy", pt.y);
    }
    function stopRunner() {
      if (runRaf) { global.cancelAnimationFrame(runRaf); runRaf = 0; }
      runner.classList.remove("is-active");
    }
    function runOn(node) {
      stopRunner();
      if (!node || node.len < C.RUNNER_MIN_LEN) return;
      let began = 0;
      try { placeRunner(node.path.getPointAtLength(0)); } catch (_) { return; }
      runner.classList.add("is-active");   // 자리를 잡은 다음에 보인다
      const tick = (now) => {
        if (!began) began = now;
        const t = Math.min(1, (now - began) / node.sweepMs);
        try { placeRunner(node.path.getPointAtLength(node.len * t)); } catch (_) { /* noop */ }
        if (t < 1) { runRaf = global.requestAnimationFrame(tick); }
        else { runRaf = 0; runner.classList.remove("is-active"); }
      };
      runRaf = global.requestAnimationFrame(tick);
    }

    let timer = 0;
    let active = -1;
    let tracing = false;

    function highlight() {
      nodes.forEach((n, i) => {
        const on = i === active;
        n.path.classList.toggle("is-active", on);
        n.dot.classList.toggle("is-active", on);
        if (n.badge) n.badge.classList.toggle("is-active", on);
        if (n.label) n.label.classList.toggle("is-active", on);
      });
      runOn(nodes[active]);
    }

    function stop() {
      if (timer) { global.clearTimeout(timer); timer = 0; }
      stopRunner();
    }

    function start() {
      if (tracing) return;
      stop();
      const tick = () => {
        active = (active + 1) % nodes.length;
        highlight();
        const hold = (nodes[active].sweepMs || C.RUNNER_MIN_MS) + C.STROKE_GAP_MS;
        timer = global.setTimeout(tick, hold);
      };
      active = -1;
      tick();
    }

    // 색칠이 시작되면 안내를 통째로 걷는다 — 칠할 자리를 가리면 안 된다.
    function beginTracing() {
      if (tracing) return;
      tracing = true;
      stop();
      stopRunner();
      if (svg) svg.classList.add("is-tracing");
    }

    return {
      start,
      stop,
      strokeCount() { return nodes.length; },
      isTracing() { return tracing; },
      // 붓이 처음 닿는 순간 안내를 걷는다.
      notePaint() { beginTracing(); },
      destroy() {
        stop();
        if (svg) svg.classList.remove("is-tracing");
        group.textContent = "";
      },
    };
  }

  global.SpellingBuilderStrokeGuide = Object.freeze({
    ...C,
    SVG_NS,
    polylineToPath,
    sweepDuration,
    create,
  });
})(window);
