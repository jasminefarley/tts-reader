const SERVER = "http://127.0.0.1:8765";
const out = document.getElementById("out");
const log = (msg) => { out.textContent = msg; };

document.getElementById("health").onclick = async () => {
  try {
    const res = await fetch(`${SERVER}/health`);
    log(`OK ${res.status}: ${await res.text()}`);
  } catch (err) {
    log(`FAILED: ${err}\n\nIs "uv run spike/server.py" running?`);
  }
};

document.getElementById("speak").onclick = async () => {
  const text = "Hello Jasmine. If you can hear this, the side panel can reach the local server.";
  const t0 = performance.now();
  try {
    const res = await fetch(`${SERVER}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const blob = await res.blob();
    const ms = Math.round(performance.now() - t0);
    const audio = new Audio(URL.createObjectURL(blob));
    await audio.play();
    log(`Playing. Request took ${ms} ms, ${blob.size} bytes.`);
  } catch (err) {
    log(`FAILED: ${err}`);
  }
};

// Runs inside every frame of the page, including cross-origin iframes.
function describeFrame() {
  const text = (document.body?.innerText ?? "").trim();
  return {
    url: location.href.slice(0, 120),
    isTop: window === window.top,
    chars: text.length,
    preview: text.slice(0, 160).replace(/\s+/g, " "),
  };
}

document.getElementById("probe").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: describeFrame,
    });
    const lines = results.map(({ frameId, result, error }) =>
      error
        ? `frame ${frameId}: ERROR ${error.message ?? error}`
        : `frame ${frameId} ${result.isTop ? "(top)" : ""}\n  ${result.url}\n  ${result.chars} chars: "${result.preview}"`
    );
    log(`${results.length} frame(s) reached:\n\n${lines.join("\n\n")}`);
  } catch (err) {
    log(`FAILED: ${err}`);
  }
};
