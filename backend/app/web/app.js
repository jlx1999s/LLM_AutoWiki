const output = document.getElementById("output");

function show(data) {
  output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

async function request(url, options) {
  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const payload = await response.json();
    if (!response.ok) {
      show({ status: response.status, error: payload });
      return null;
    }
    show(payload);
    return payload;
  } catch (err) {
    show({ error: String(err) });
    return null;
  }
}

document.getElementById("btnIngest").addEventListener("click", async () => {
  const path = document.getElementById("ingestPath").value.trim();
  const recursive = document.getElementById("ingestRecursive").checked;
  if (!path) {
    show("请输入导入路径。");
    return;
  }
  await request("/api/ingest", {
    method: "POST",
    body: JSON.stringify({ path, recursive }),
  });
});

document.getElementById("btnBuild").addEventListener("click", async () => {
  await request("/api/wiki/build", { method: "POST", body: "{}" });
});

document.getElementById("btnQA").addEventListener("click", async () => {
  const question = document.getElementById("qaQuestion").value.trim();
  const top_k = Number(document.getElementById("qaTopK").value || 5);
  const strategy = document.getElementById("qaStrategy").value;
  if (!question) {
    show("请输入问题。");
    return;
  }
  await request("/api/qa/query", {
    method: "POST",
    body: JSON.stringify({ question, top_k, strategy }),
  });
});

document.getElementById("btnEval").addEventListener("click", async () => {
  const dataset_path = document.getElementById("evalPath").value.trim();
  const top_k = Number(document.getElementById("evalTopK").value || 5);
  const strategy = document.getElementById("evalStrategy").value;
  const payload = { top_k, strategy };
  if (dataset_path) {
    payload.dataset_path = dataset_path;
  }
  await request("/api/eval/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
});

document.getElementById("btnEvalLatest").addEventListener("click", async () => {
  await request("/api/eval/latest", { method: "GET" });
});
