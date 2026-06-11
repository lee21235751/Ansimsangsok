import fs from "fs";
import path from "path";
import crypto from "crypto";

const root = process.cwd();
const registryPath = path.join(root, "data", "evidence-sources", "official-source-registry.json");
const snapshotPath = path.join(root, "data", "evidence-sources", "evidence-snapshot.json");

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\\uFEFF/, "");
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function hashText(text) {
  return crypto.createHash("sha256").update(text || "").digest("hex");
}

function isFetchableUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

async function fetchSource(source) {
  const startedAt = new Date().toISOString();

  if (!isFetchableUrl(source.url)) {
    return {
      id: source.id,
      name: source.name,
      provider: source.provider,
      grade: source.grade,
      category: source.category,
      status: "manual_review",
      reason: "URL이 국가별·민간 보조자료 또는 수동 확인 대상입니다.",
      checkedAt: startedAt,
      url: source.url,
      hash: null,
      contentLength: null
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(source.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "AnsimsangsokEvidenceFreshnessBot/1.0 (+https://www.ansimsangsok.kr)"
      }
    });

    clearTimeout(timeout);

    const text = await response.text();
    const compact = text.replace(/\s+/g, " ").slice(0, 200000);

    return {
      id: source.id,
      name: source.name,
      provider: source.provider,
      grade: source.grade,
      category: source.category,
      status: response.ok ? "checked" : "needs_review",
      httpStatus: response.status,
      checkedAt: startedAt,
      url: source.url,
      hash: hashText(compact),
      contentLength: text.length,
      sample: compact.slice(0, 500),
      reportUse: source.reportUse,
      riskRule: source.riskRule
    };
  } catch (error) {
    return {
      id: source.id,
      name: source.name,
      provider: source.provider,
      grade: source.grade,
      category: source.category,
      status: "needs_review",
      reason: String(error && error.message ? error.message : error),
      checkedAt: startedAt,
      url: source.url,
      hash: null,
      contentLength: null,
      reportUse: source.reportUse,
      riskRule: source.riskRule
    };
  }
}

function compareWithPrevious(currentItems, previousItems) {
  const previousById = new Map((previousItems || []).map(item => [item.id, item]));

  return currentItems.map(item => {
    const previous = previousById.get(item.id);
    const hashChanged = !!(previous && previous.hash && item.hash && previous.hash !== item.hash);

    return {
      ...item,
      previousHash: previous ? previous.hash || null : null,
      changed: hashChanged,
      changeStatus: !previous ? "new_baseline" : hashChanged ? "changed_needs_review" : "unchanged"
    };
  });
}

async function main() {
  const registry = readJson(registryPath);
  const previous = fs.existsSync(snapshotPath) ? readJson(snapshotPath) : { items: [] };

  const items = [];

  for (const source of registry.sources) {
    items.push(await fetchSource(source));
  }

  const compared = compareWithPrevious(items, previous.items);

  const changedCount = compared.filter(item => item.changed).length;
  const needsReviewCount = compared.filter(item => item.status !== "checked" || item.changeStatus === "changed_needs_review").length;
  const officialPrimary = compared.filter(item => item.grade === "A").length;
  const officialSupport = compared.filter(item => item.grade === "B").length;
  const publicSecondary = compared.filter(item => item.grade === "C").length;

  const snapshot = {
    version: registry.version,
    generatedAt: new Date().toISOString(),
    status: needsReviewCount > 0 ? "checked_with_review_items" : "checked",
    summary: {
      totalSources: compared.length,
      officialPrimary,
      officialSupport,
      publicSecondary,
      changedCount,
      needsReviewCount
    },
    items: compared,
    notes: [
      "자동 수집/갱신 파이프라인 v1 결과입니다.",
      "changed_needs_review 항목은 리포트에 결론처럼 반영하지 않고 최신 확인 필요로 분리합니다.",
      "민간자료는 공식 근거가 아니라 보조자료로만 사용합니다."
    ]
  };

  writeJson(snapshotPath, snapshot);

  console.log(JSON.stringify({
    ok: true,
    generatedAt: snapshot.generatedAt,
    summary: snapshot.summary
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
