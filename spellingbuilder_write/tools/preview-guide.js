(function installTraceEditorPreviewGuide(global) {
  "use strict";

  /*
   * 편집기 미리보기 전용 획순 안내 — 게임(app/stroke-guide.js)과 완전히 분리돼 있다.
   *
   * 게임 코드를 불러 쓰지 않는다. 편집기를 고치다 게임이 깨지는 일도,
   * 게임을 고치다 편집기가 깨지는 일도 없어야 한다.
   * CSS 클래스도 pv- 로 따로 쓴다(게임 styles.css 의 규칙이 새어 들어오지 않게).
   *
   * 대신 "실제로 이렇게 보인다"가 미리보기의 존재 이유이므로, 아래 값들은
   * 게임과 같아야 한다. 어긋나면 테스트가 잡는다
   * (app/tests/static-game.test.mjs · "미리보기 값이 게임과 어긋나지 않는다").
   */

  const NS = "http://www.w3.org/2000/svg";

  const C = {
    START_DOT_R: 11,
    BADGE_R: 26,
    RUNNER_R: 15,
    RUNNER_SPEED: 210,     // 좌표 단위 / 초
    RUNNER_MIN_MS: 520,
    RUNNER_MAX_MS: 6400,
    RUNNER_MIN_LEN: 50,
    STROKE_GAP_MS: 220,
  };

  const el = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  };
  const toPath = (pts) => pts.map((p, i) => (i ? "L" : "M") + p[0] + "," + p[1]).join(" ");
  const lengthOf = (path) => { try { return path.getTotalLength(); } catch (_) { return 0; } };
  const sweepMsOf = (len) => (len > 0
    ? Math.round(Math.min(C.RUNNER_MAX_MS, Math.max(C.RUNNER_MIN_MS, len / C.RUNNER_SPEED * 1000)))
    : C.RUNNER_MIN_MS);

  /* group: 안내를 담을 <g> · letter: { s: 획들, b: 번호들 } */
  function create(group, letter) {
    if (!group || !letter || !letter.s || !letter.s.length) return null;
    group.textContent = "";

    const nodes = letter.s.map((pts, index) => {
      const d = toPath(pts);
      const path = el("path", { class: "pv-path", d });
      group.appendChild(path);
      group.appendChild(el("circle", { class: "pv-start", cx: pts[0][0], cy: pts[0][1], r: C.START_DOT_R }));
      const start = group.lastChild;

      const len = lengthOf(path);

      let badge = null, label = null;
      const spot = letter.b && letter.b[index];
      if (spot) {
        badge = el("circle", { class: "pv-badge", cx: spot[0], cy: spot[1], r: C.BADGE_R });
        group.appendChild(badge);
        label = el("text", { class: "pv-label", x: spot[0], y: spot[1] });
        label.textContent = String(index + 1);
        group.appendChild(label);
      }
      return { path, start, d, len, sweepMs: sweepMsOf(len), badge, label };
    });

    // 방향 표시는 하나만. 획마다 두면 차례가 아닌 것도 계속 돌아 미리 움직이는 것처럼 보인다.
    const runner = el("circle", { class: "pv-runner", r: C.RUNNER_R });
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

    let timer = 0, active = -1;

    function stop() {
      if (timer) { global.clearTimeout(timer); timer = 0; }
      stopRunner();
    }

    function start() {
      stop();
      const tick = () => {
        active = (active + 1) % nodes.length;
        nodes.forEach((n, i) => {
          const on = i === active;
          n.path.classList.toggle("is-active", on);
          n.start.classList.toggle("is-active", on);
          if (n.badge) n.badge.classList.toggle("is-active", on);
          if (n.label) n.label.classList.toggle("is-active", on);
        });
        runOn(nodes[active]);
        // 1획이 끝나면 2획, 끝나면 3획 — 고정 간격을 쓰면 짧은 획 뒤에 빈 시간이 생긴다.
        timer = global.setTimeout(tick, nodes[active].sweepMs + C.STROKE_GAP_MS);
      };
      active = -1;
      tick();
    }

    return {
      start,
      stop,
      destroy() { stop(); group.textContent = ""; },
    };
  }

  global.TraceEditorPreviewGuide = Object.freeze({ ...C, create });
})(window);
