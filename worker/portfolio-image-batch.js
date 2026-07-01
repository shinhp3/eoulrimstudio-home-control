/**
 * Cloudflare Worker (eoulrimstudio-upload) — 1단계 배치 업로드
 *
 * 배포 방법:
 * 1. Cloudflare Dashboard → Workers → eoulrimstudio-upload → Edit code
 * 2. 「포트폴리오」 섹션에서 safePortfolioImagePath 바로 위에 gitCommitMultipleFiles 추가
 * 3. handlePortfolioImageUpload 함수 전체를 아래 handlePortfolioImageUpload 로 교체
 * 4. Save and deploy
 *
 * 기존 단일 업로드({ projectId, filename, content })도 그대로 동작합니다.
 */

async function gitCommitMultipleFiles(token, username, repo, files, message) {
  const refName = "heads/" + DEFAULT_BRANCH;
  const getRefUrl =
    GITHUB_API + "/repos/" + username + "/" + repo + "/git/ref/" + refName;
  const updateRefUrl =
    GITHUB_API + "/repos/" + username + "/" + repo + "/git/refs/" + refName;

  const ref = await githubJson("GET", getRefUrl, token);
  const parentSha = ref.object.sha;

  const commitObj = await githubJson(
    "GET",
    GITHUB_API + "/repos/" + username + "/" + repo + "/git/commits/" + parentSha,
    token
  );
  const baseTreeSha = commitObj.tree.sha;

  const treeItems = [];
  for (const file of files) {
    const blob = await githubJson(
      "POST",
      GITHUB_API + "/repos/" + username + "/" + repo + "/git/blobs",
      token,
      { content: file.content, encoding: "base64" }
    );
    treeItems.push({
      path: file.relPath,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const tree = await githubJson(
    "POST",
    GITHUB_API + "/repos/" + username + "/" + repo + "/git/trees",
    token,
    { base_tree: baseTreeSha, tree: treeItems }
  );

  const newCommit = await githubJson(
    "POST",
    GITHUB_API + "/repos/" + username + "/" + repo + "/git/commits",
    token,
    { message, tree: tree.sha, parents: [parentSha] }
  );

  await githubJson("PATCH", updateRefUrl, token, { sha: newCommit.sha });
}

async function handlePortfolioImageUpload(request, env) {
  try {
    const { token, username, repo } = requireEnvPortfolio(env);
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ success: false, error: "JSON 본문을 읽을 수 없습니다." }, 400);
    }

    if (Array.isArray(body.files) && body.files.length > 0) {
      const entries = [];
      const paths = [];
      for (const item of body.files) {
        const { projectId, filename, content } = item || {};
        if (!projectId || !filename || typeof content !== "string") {
          return jsonResponse(
            { success: false, error: "files[] 항목마다 projectId, filename, content(base64)가 필요합니다." },
            400
          );
        }
        const relPath = safePortfolioImagePath(projectId, filename);
        if (!relPath) {
          return jsonResponse({ success: false, error: "허용되지 않는 경로입니다: " + filename }, 400);
        }
        const trimmed = content.replace(/\s/g, "");
        if (!trimmed.length) {
          return jsonResponse({ success: false, error: "파일 내용이 비어 있습니다: " + filename }, 400);
        }
        entries.push({ relPath, content: trimmed });
        paths.push(relPath);
      }

      const label =
        paths.length === 1
          ? paths[0]
          : paths.length + " portfolio images";
      await gitCommitMultipleFiles(
        token,
        username,
        repo,
        entries,
        "Upload portfolio images (batch): " + label
      );
      return jsonResponse({ success: true, paths });
    }

    const { projectId, filename, content } = body;
    if (!projectId || !filename || typeof content !== "string") {
      return jsonResponse(
        { success: false, error: "projectId, filename, content(base64) 또는 files[] 배열이 필요합니다." },
        400
      );
    }
    const relPath = safePortfolioImagePath(projectId, filename);
    if (!relPath) return jsonResponse({ success: false, error: "허용되지 않는 경로입니다." }, 400);
    const trimmed = content.replace(/\s/g, "");
    if (!trimmed.length) {
      return jsonResponse({ success: false, error: "파일 내용이 비어 있습니다." }, 400);
    }
    const apiPath =
      GITHUB_API + "/repos/" + username + "/" + repo + "/contents/" + gitContentsPath(relPath);
    let sha;
    try {
      const existing = await githubJson(
        "GET",
        apiPath + "?ref=" + encodeURIComponent(DEFAULT_BRANCH),
        token
      );
      if (existing && existing.sha) sha = existing.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const putBody = {
      message: "Upload portfolio image: " + relPath,
      content: trimmed,
      branch: DEFAULT_BRANCH,
    };
    if (sha) putBody.sha = sha;
    await githubJson("PUT", apiPath, token, putBody);
    return jsonResponse({ success: true, path: relPath });
  } catch (e) {
    const msg = e.message || String(e);
    const status = typeof e.status === "number" && e.status >= 400 && e.status < 600 ? e.status : 500;
    return jsonResponse({ success: false, error: msg }, status);
  }
}
