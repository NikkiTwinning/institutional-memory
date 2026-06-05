// ============================================================
// Strata & Skies — UI controller
// ============================================================

const DEFAULT_Q =
  "I just joined the company and I need read-only prod access to debug an " +
  "issue tomorrow. What do I do? Be specific about the steps and the people " +
  "I need to talk to.";

const questionEl = document.getElementById("question");
questionEl.value = DEFAULT_Q;

// Runaway dodo: wanders the viewport in random hops. Click it and it's gone.
(function setupDodo() {
  const dodo = document.getElementById("dodoRunner");
  if (!dodo) return;
  const img = dodo.querySelector(".dodo-img");

  let caught = false;
  let pendingMove = null;

  // Start somewhere visible-ish (mid-viewport) so the first hop has somewhere to go.
  let lastX = window.innerWidth * 0.5;
  let lastY = window.innerHeight * 0.5;
  dodo.style.transform = `translate(${Math.round(lastX)}px, ${Math.round(lastY)}px)`;

  function pickTarget() {
    const margin = 24;
    const w = dodo.offsetWidth || 120;
    const h = dodo.offsetHeight || 120;
    const maxX = Math.max(margin, window.innerWidth - w - margin);
    const maxY = Math.max(margin, window.innerHeight - h - margin);
    return {
      x: margin + Math.random() * (maxX - margin),
      y: margin + Math.random() * (maxY - margin),
    };
  }

  function hop() {
    if (caught) return;
    const { x, y } = pickTarget();
    // Vary speed so it doesn't feel mechanical (1.4-2.8s per hop).
    const duration = 1400 + Math.random() * 1400;
    dodo.style.transitionDuration = duration + "ms";
    dodo.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    // Face the direction of travel.
    if (x < lastX - 4) img.style.setProperty("--flip", "-1");
    else if (x > lastX + 4) img.style.setProperty("--flip", "1");
    lastX = x;
    lastY = y;
    const pause = 150 + Math.random() * 450;
    pendingMove = setTimeout(hop, duration + pause);
  }

  dodo.addEventListener("click", () => {
    if (caught) return;
    caught = true;
    if (pendingMove) clearTimeout(pendingMove);
    // Lock the dodo where it is right now so it doesn't keep gliding.
    const rect = dodo.getBoundingClientRect();
    dodo.style.transition = "none";
    dodo.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
    dodo.classList.add("caught");
    // Wait for the catch + puff animation, then drop the node.
    setTimeout(() => dodo.remove(), 700);
  });

  // Re-clamp on resize so a shrunk window doesn't park the dodo offscreen.
  window.addEventListener("resize", () => {
    if (caught) return;
    lastX = Math.min(lastX, window.innerWidth - 140);
    lastY = Math.min(lastY, window.innerHeight - 140);
  });

  setTimeout(hop, 600);
})();

const run1Btn = document.getElementById("run1");
const run2Btn = document.getElementById("run2");
const resetBtn = document.getElementById("reset");

run1Btn.addEventListener("click", () => runSession(1));
run2Btn.addEventListener("click", () => runSession(2));
resetBtn.addEventListener("click", resetMemory);

// keep the most recent memory snapshot from each session so we can diff
let lastMemoryS1 = [];
let lastMemoryS2 = [];

async function resetMemory() {
  if (!confirm("Wipe the agent's memory store?")) return;
  resetBtn.disabled = true;
  resetBtn.textContent = "Resetting…";
  try {
    const r = await fetch("/api/reset", { method: "POST" });
    const data = await r.json();
    resetBtn.textContent = `Reset (${data.removed} removed)`;
    lastMemoryS1 = [];
    lastMemoryS2 = [];
    clearMemoryPanel("memory1");
    clearMemoryPanel("memory2");
    setTimeout(() => (resetBtn.textContent = "Reset memory"), 1600);
  } catch (e) {
    alert("Reset failed: " + e);
    resetBtn.textContent = "Reset memory";
  } finally {
    resetBtn.disabled = false;
  }
}

function clearMemoryPanel(id) {
  const el = document.getElementById(id);
  el.innerHTML = `<p class="placeholder">No memory yet.</p>`;
}

function runSession(n) {
  const question = questionEl.value.trim();
  if (!question) {
    questionEl.focus();
    return;
  }

  const ids = {
    btn: n === 1 ? run1Btn : run2Btn,
    otherBtn: n === 1 ? run2Btn : run1Btn,
    answerEl: document.getElementById(`answer${n}`),
    activityEl: document.getElementById(`activity${n}`),
    statusEl: document.getElementById(`status${n}`),
    memoryEl: document.getElementById(`memory${n}`),
  };

  // reset panels for this run
  ids.answerEl.innerHTML = "";
  const pre = document.createElement("pre");
  pre.className = "answer-text";
  ids.answerEl.appendChild(pre);

  ids.activityEl.innerHTML = `<li class="empty">waiting for the agent…</li>`;
  ids.statusEl.textContent = "running";
  ids.statusEl.className = "status running";
  ids.btn.disabled = true;
  resetBtn.disabled = true;

  const url = `/api/session${n}?q=${encodeURIComponent(question)}`;
  const es = new EventSource(url);

  let activityCleared = false;
  let answerText = "";

  es.onmessage = (msg) => {
    let data;
    try {
      data = JSON.parse(msg.data);
    } catch (e) {
      console.warn("bad sse", msg.data);
      return;
    }

    switch (data.type) {
      case "started":
        renderMemoryDiff(
          ids.memoryEl,
          [],
          data.memory_before || [],
          /*flagChanged=*/ false,
          /*emptyMsg=*/ "Memory is empty at the start of this run.",
        );
        if (n === 1) lastMemoryS1 = data.memory_before || [];
        else lastMemoryS2 = data.memory_before || [];
        break;

      case "text":
        if (!activityCleared) {
          ids.activityEl.innerHTML = "";
          activityCleared = true;
        }
        answerText += data.text;
        pre.textContent = answerText;
        ids.answerEl.scrollTop = ids.answerEl.scrollHeight;
        break;

      case "tool": {
        if (!activityCleared) {
          ids.activityEl.innerHTML = "";
          activityCleared = true;
        }
        const li = document.createElement("li");
        const tag = document.createElement("span");
        tag.className = "tag " + (data.is_memory ? "memory" : "tool");
        tag.textContent = data.is_memory ? "memory" : "tool";
        const name = document.createElement("strong");
        name.textContent = data.name;
        const target = document.createElement("span");
        target.className = "target";
        target.textContent = data.target ? truncate(data.target, 220) : "";
        li.appendChild(tag);
        li.appendChild(name);
        if (data.target) li.appendChild(target);
        ids.activityEl.appendChild(li);
        ids.activityEl.scrollTop = ids.activityEl.scrollHeight;
        break;
      }

      case "done":
        // answer captured during streaming; nothing extra to do here.
        break;

      case "finished": {
        const before =
          n === 1 ? lastMemoryS1 : lastMemoryS2; // snapshot from "started"
        const after = data.memory_after || [];
        if (n === 1) lastMemoryS1 = after;
        else lastMemoryS2 = after;

        renderMemoryDiff(
          ids.memoryEl,
          before,
          after,
          /*flagChanged=*/ true,
          n === 1
            ? "Agent didn't write anything to memory."
            : "Agent didn't change memory.",
        );
        ids.statusEl.textContent = "done";
        ids.statusEl.className = "status done";
        ids.btn.disabled = false;
        resetBtn.disabled = false;
        es.close();
        break;
      }

      case "warn":
        appendActivity(ids.activityEl, "warn", data.msg);
        break;

      case "error":
        appendActivity(ids.activityEl, "error", data.msg);
        ids.statusEl.textContent = "error";
        ids.statusEl.className = "status error";
        ids.btn.disabled = false;
        resetBtn.disabled = false;
        es.close();
        break;
    }
  };

  es.onerror = (e) => {
    // EventSource fires onerror on normal close — only react if we're still running
    if (ids.statusEl.textContent === "running") {
      appendActivity(ids.activityEl, "error", "connection lost");
      ids.statusEl.textContent = "error";
      ids.statusEl.className = "status error";
      ids.btn.disabled = false;
      resetBtn.disabled = false;
    }
    es.close();
  };
}

function appendActivity(ul, kind, text) {
  const li = document.createElement("li");
  const tag = document.createElement("span");
  tag.className = "tag " + (kind === "error" ? "memory" : "tool");
  tag.textContent = kind;
  const t = document.createElement("span");
  t.className = "target";
  t.textContent = text;
  li.appendChild(tag);
  li.appendChild(t);
  ul.appendChild(li);
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function renderMemoryDiff(container, before, after, flagChanged, emptyMsg) {
  container.innerHTML = "";
  if (!after.length) {
    container.innerHTML = `<p class="placeholder">${emptyMsg}</p>`;
    return;
  }
  const byPath = new Map(before.map((m) => [m.path, m]));
  for (const f of after) {
    const prev = byPath.get(f.path);
    const changed = flagChanged && (!prev || prev.content !== f.content);
    const wrapper = document.createElement("div");
    wrapper.className = "mem-file" + (changed ? " changed" : "");

    const head = document.createElement("div");
    head.className = "mem-file-head";

    const left = document.createElement("div");
    const path = document.createElement("span");
    path.className = "path";
    path.textContent = f.path;
    left.appendChild(path);
    if (changed) {
      const flag = document.createElement("span");
      flag.className = "changed-flag";
      flag.style.marginLeft = "8px";
      flag.textContent = prev ? "updated" : "new";
      left.appendChild(flag);
    }
    const size = document.createElement("span");
    size.className = "size";
    size.textContent = `${f.size.toLocaleString()} chars`;
    head.appendChild(left);
    head.appendChild(size);

    const body = document.createElement("div");
    body.className = "mem-file-body";
    body.textContent = f.content;

    wrapper.appendChild(head);
    wrapper.appendChild(body);
    container.appendChild(wrapper);
  }
}
