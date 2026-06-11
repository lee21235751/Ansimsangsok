import fs from "fs";
import path from "path";

const root = process.cwd();
const registryPath = path.join(root, "data", "evidence-sources", "official-source-registry.json");
const snapshotPath = path.join(root, "data", "evidence-sources", "evidence-snapshot.json");
const publicPath = path.join(root, "public", "index.html");

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\\uFEFF/, "");
  return JSON.parse(raw);
}

const registry = readJson(registryPath);
const snapshot = readJson(snapshotPath);
const html = fs.existsSync(publicPath) ? fs.readFileSync(publicPath, "utf8") : "";

const requiredSourceIds = [
  "law-civil-code",
  "law-inheritance-tax",
  "open-law-api",
  "supreme-court-cases",
  "nts-inheritance-tax",
  "taxlaw-nts",
  "international-official",
  "private-secondary"
];

const forbiddenTerms = [
  "해결해드립니다",
  "결과를 보장",
  "반드시 승소",
  "세금이 줄어듭니다",
  "무조건 받을 수 있습니다",
  "결제 완료",
  "결제 성공"
];

const missingSources = requiredSourceIds.filter(id => !registry.sources.some(source => source.id === id));
const forbiddenFound = forbiddenTerms.filter(term => html.includes(term));
const hasSnapshot = Array.isArray(snapshot.items);
const hasSummary = !!snapshot.summary;
const hasOfficialPrimary = registry.sources.filter(source => source.grade === "A").length >= 5;
const hasRiskRules = registry.sources.every(source => source.riskRule && source.reportUse);
const hasPublicSecondaryLimited = registry.sources
  .filter(source => source.grade === "C")
  .every(source => String(source.riskRule).includes("공식 근거로 표시하지 않는다"));

const report = {
  ok: missingSources.length === 0 && forbiddenFound.length === 0 && hasSnapshot && hasSummary && hasOfficialPrimary && hasRiskRules && hasPublicSecondaryLimited,
  checkedAt: new Date().toISOString(),
  sourceCount: registry.sources.length,
  missingSources,
  forbiddenFound,
  hasSnapshot,
  hasSummary,
  hasOfficialPrimary,
  hasRiskRules,
  hasPublicSecondaryLimited,
  snapshotStatus: snapshot.status,
  snapshotSummary: snapshot.summary
};

console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  process.exitCode = 1;
}
