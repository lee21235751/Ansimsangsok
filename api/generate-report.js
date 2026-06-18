/**
 * 안심상속 유료 상세리포트 자동 생성 API
 * POST /api/generate-report
 *
 * 흐름: 진단 답변 → 유형 매칭 → 모듈 조합 → Claude API 생성 → 리포트 반환
 */

/* ── 1. 20개 유형 정의 및 매칭 규칙 ─────────────────────────────────── */

const REPORT_TYPES = {
  T01: { id: 'T01', title: '배우자와 자녀가 있는 일반 상속' },
  T02: { id: 'T02', title: '배우자만 있거나 자녀만 있는 상속' },
  T03: { id: 'T03', title: '자녀가 없고 형제자매가 관련되는 상속' },
  T04: { id: 'T04', title: '재혼가정 상속' },
  T05: { id: 'T05', title: '전혼 자녀가 있는 상속' },
  T06: { id: 'T06', title: '연락이 끊긴 가족이 있는 상속' },
  T07: { id: 'T07', title: '가족 간 갈등 가능성이 큰 상속' },
  T08: { id: 'T08', title: '부동산이 포함된 상속' },
  T09: { id: 'T09', title: '금융재산 중심 상속' },
  T10: { id: 'T10', title: '채무가 걱정되는 상속' },
  T11: { id: 'T11', title: '상속포기·한정승인 검토가 필요한 상속' },
  T12: { id: 'T12', title: '사망 전 증여가 있었던 상속' },
  T13: { id: 'T13', title: '유류분 문제가 생길 수 있는 상속' },
  T14: { id: 'T14', title: '유언장이 있는 상속' },
  T15: { id: 'T15', title: '유언장이 없거나 확인이 필요한 상속' },
  T16: { id: 'T16', title: '해외 거주 가족·해외 재산이 관련된 상속' },
  T17: { id: 'T17', title: '사업체·지분·법인 관련 상속' },
  T18: { id: 'T18', title: '고령 부모 생전 정리가 필요한 상황' },
  T19: { id: 'T19', title: '혼자 먼저 조용히 정리하려는 상황' },
  T20: { id: 'T20', title: '상담 전 질문과 준비자료를 정리해야 하는 상황' }
};

/**
 * 진단 답변 → 해당 리포트 유형들 매칭 (복수 선택 가능)
 * 점수가 높은 순서로 정렬, 최대 3개 유형 선택
 */
function matchReportTypes(answers) {
  const scores = {};
  const init = (id) => { if (!scores[id]) scores[id] = 0; };

  const family     = answers.family      || '';
  const will       = answers.will        || '';
  const gift       = answers.gift        || '';
  const business   = answers.business    || '';
  const conflict   = answers.conflict    || '';
  const documents  = answers.documents   || '';
  const overseas   = Array.isArray(answers.overseas) ? answers.overseas : [];
  const presence   = Array.isArray(answers.assetPresence) ? answers.assetPresence : [];
  const counts     = answers.assetCounts || {};

  /* 가족 구성 */
  if (family === '배우자와 자녀가 있음') {
    init('T01'); scores['T01'] += 40;
  }
  if (family === '재혼가정 또는 전혼 자녀가 있음') {
    init('T04'); scores['T04'] += 50;
    init('T05'); scores['T05'] += 40;
    init('T13'); scores['T13'] += 20;
  }
  if (family === '자녀가 없거나 형제자매와 관련될 수 있음') {
    init('T02'); scores['T02'] += 30;
    init('T03'); scores['T03'] += 40;
  }

  /* 유언장 */
  if (will === '이미 정리해둔 내용이 있음') {
    init('T14'); scores['T14'] += 40;
  }
  if (will === '아직 정리하지 못함') {
    init('T15'); scores['T15'] += 40;
    init('T19'); scores['T19'] += 20;
  }
  if (will === '생각은 있지만 문서로 정리하지 않음') {
    init('T15'); scores['T15'] += 25;
    init('T20'); scores['T20'] += 20;
  }

  /* 부동산 */
  const hasRealEstate = presence.some(v => !['none','unknown'].includes(v));
  if (hasRealEstate) {
    init('T08'); scores['T08'] += 35;
    const totalUnits = Object.values(counts).reduce((sum, v) => {
      if (v === '2채' || v === '2곳' || v === '2개' || v === '2건') return sum + 2;
      if (v === '3채 이상' || v === '3곳 이상' || v === '3개 이상' || v === '3건 이상') return sum + 3;
      if (v) return sum + 1;
      return sum;
    }, 0);
    if (totalUnits >= 3) {
      scores['T08'] += 15;
      init('T13'); scores['T13'] += 10;
    }
  }

  /* 사전 증여 */
  if (gift === '일부 있음') {
    init('T12'); scores['T12'] += 35;
    init('T13'); scores['T13'] += 20;
  }
  if (gift === '상당히 있음') {
    init('T12'); scores['T12'] += 50;
    init('T13'); scores['T13'] += 40;
  }

  /* 사업체·지분 */
  if (business === '중요한 비중을 차지함') {
    init('T17'); scores['T17'] += 50;
    init('T08'); scores['T08'] += 10;
  }
  if (business === '조금 있음') {
    init('T17'); scores['T17'] += 25;
  }

  /* 해외 */
  const hasOverseas = overseas.some(v => !['none','unknown'].includes(v));
  if (hasOverseas) {
    init('T16'); scores['T16'] += 45;
    if (overseas.includes('dual_nationality')) scores['T16'] += 10;
  }

  /* 갈등 */
  if (conflict === '조금 있음') {
    init('T07'); scores['T07'] += 35;
    init('T13'); scores['T13'] += 15;
  }
  if (conflict === '이미 뚜렷함') {
    init('T07'); scores['T07'] += 55;
    init('T13'); scores['T13'] += 25;
    init('T06'); scores['T06'] += 20;
  }

  /* 서류 정리 안됨 */
  if (documents === '거의 정리되어 있지 않음') {
    init('T20'); scores['T20'] += 35;
    init('T18'); scores['T18'] += 20;
  }
  if (documents === '일부만 정리되어 있음') {
    init('T20'); scores['T20'] += 20;
  }

  /* 모르겠음이 많으면 T20 */
  const unknownCount = [family, will, gift, business, conflict, documents]
    .filter(v => v.includes('모르겠음')).length;
  if (unknownCount >= 2) {
    init('T20'); scores['T20'] += unknownCount * 10;
  }

  /* 점수 없으면 기본 T01 */
  if (Object.keys(scores).length === 0) {
    scores['T01'] = 30;
  }

  /* 상위 3개 반환 */
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => REPORT_TYPES[id]);
}

/* ── 2. 상황별 문단 모듈 ─────────────────────────────────────────────── */

function buildContextModules(answers, matchedTypes) {
  const modules = [];
  const typeIds = matchedTypes.map(t => t.id);

  const family    = answers.family    || '';
  const overseas  = Array.isArray(answers.overseas) ? answers.overseas : [];
  const conflict  = answers.conflict  || '';
  const gift      = answers.gift      || '';
  const business  = answers.business  || '';
  const presence  = Array.isArray(answers.assetPresence) ? answers.assetPresence : [];
  const counts    = answers.assetCounts || {};

  /* 가족 구성 모듈 */
  if (family === '재혼가정 또는 전혼 자녀가 있음') {
    modules.push({
      tag: 'family_complex',
      title: '재혼·전혼 자녀 관련 확인 사항',
      content: `재혼가정이나 전혼 자녀가 있는 경우, 법정상속인의 범위가 일반적인 경우보다 복잡합니다. 전혼 자녀도 친생자로서 법정상속권을 가지며, 현재 배우자 및 자녀와 동등한 상속분을 가질 수 있습니다. 상속 개시 전에 상속인 범위를 정확히 파악하는 것이 첫 번째 단계입니다.`
    });
  }

  /* 유류분 모듈 */
  if (typeIds.includes('T13') || gift === '상당히 있음') {
    modules.push({
      tag: 'forced_share_2026',
      title: '2026년 유류분 제도 변경 핵심',
      content: `2024년 4월 헌법재판소 결정과 2026년 2월 민법 개정으로 유류분 제도가 크게 바뀌었습니다. 핵심 변경사항 세 가지를 확인하세요. 첫째, 형제자매는 더 이상 유류분 청구권이 없습니다(즉시 효력 상실). 둘째, 피상속인을 장기간 유기하거나 학대한 상속인은 가정법원 선고로 상속권과 유류분권을 모두 잃을 수 있습니다(2026.1.1. 이후 개시 상속 적용). 셋째, 피상속인을 오랫동안 부양하거나 재산 형성에 기여한 상속인이 받은 증여는 유류분 반환청구 대상에서 제외될 수 있습니다.`
    });
  }

  /* 해외 모듈 */
  if (overseas.some(v => !['none','unknown'].includes(v))) {
    const items = [];
    if (overseas.includes('self_abroad')) items.push('본인 해외 거주');
    if (overseas.includes('family_abroad')) items.push('가족 해외 거주');
    if (overseas.includes('family_foreign_nationality')) items.push('가족 외국 국적');
    if (overseas.includes('dual_nationality')) items.push('복수국적');
    if (overseas.includes('overseas_asset')) items.push('해외 재산');
    modules.push({
      tag: 'overseas',
      title: '해외 요소 관련 확인 사항',
      content: `해당 항목(${items.join(', ')})이 있는 경우, 상속 절차가 복잡해질 수 있습니다. 해외 거주 상속인이 있으면 인감증명서 대신 서명공증 절차가 필요하고, 외국 국적자는 별도 서류가 요구됩니다. 복수국적자는 국적별 상속법 적용 기준이 달라질 수 있어 전문가 확인이 필요합니다. 해외 금융자산은 국내 신고 의무가 있으며, 해외 부동산은 해당 국가 법률이 적용됩니다.`
    });
  }

  /* 사업체·지분 모듈 */
  if (typeIds.includes('T17')) {
    modules.push({
      tag: 'business_succession',
      title: '사업체·지분 관련 확인 사항',
      content: `사업체, 법인 지분, 임대수익 부동산이 포함된 상속은 일반 금융재산 상속보다 복잡합니다. 법인 지분은 주식 또는 출자지분 형태로 상속되며, 회사 정관과 주주간 계약에 따라 처리 방식이 달라집니다. 가업상속공제(최대 600억 원)를 활용하면 상속세 부담을 크게 줄일 수 있지만, 요건이 까다롭고 사후 관리 의무가 5~7년간 지속됩니다. 사전에 충분한 검토가 필요한 영역입니다.`
    });
  }

  /* 갈등 모듈 */
  if (conflict === '이미 뚜렷함') {
    modules.push({
      tag: 'conflict_high',
      title: '가족 갈등이 있는 경우 우선 확인할 것',
      content: `가족 간 갈등이 이미 있는 경우, 상속 개시 후 분쟁으로 이어질 가능성이 높습니다. 법정상속 비율대로 분할하더라도 분쟁은 발생할 수 있으며, 유언장이 없으면 협의분할 과정에서 갈등이 표면화됩니다. 지금 단계에서 중요한 것은 분배 의도를 명확히 정리하고, 유언장 또는 증여 등 합법적 방법으로 뜻을 문서화하는 것입니다.`
    });
  }

  /* 부동산 복수 모듈 */
  const realEstateCount = Object.values(counts).reduce((sum, v) => {
    if (!v) return sum;
    if (v.includes('이상')) return sum + 3;
    const n = parseInt(v);
    return sum + (isNaN(n) ? 1 : n);
  }, 0);
  if (realEstateCount >= 2) {
    modules.push({
      tag: 'multi_realestate',
      title: '부동산 복수 보유 시 확인 사항',
      content: `부동산이 여러 필지·채·건물인 경우, 상속재산 평가 방법에 따라 세금이 크게 달라집니다. 공시지가 기준과 시가 기준의 차이를 반드시 확인하고, 상속 개시 후 6개월 내 신고 기한을 놓치지 않도록 준비해야 합니다. 또한 부동산이 여러 지역에 분산된 경우 각각의 등기 현황, 근저당, 임차인 현황을 미리 정리해두면 상속 절차가 훨씬 수월합니다.`
    });
  }

  /* 사전 증여 모듈 */
  if (gift === '일부 있음' || gift === '상당히 있음') {
    modules.push({
      tag: 'prior_gift',
      title: '사전 증여가 있는 경우 확인할 것',
      content: `상속 개시 전 10년 이내 상속인에게 한 증여는 상속재산에 합산되어 상속세 계산에 영향을 줍니다. 상속인 이외 제3자에 대한 증여는 1년 이내 것이 원칙이나, 유류분권리자 침해 의도가 있으면 기간 제한 없이 포함됩니다. 증여받은 상속인 간 불균등 증여는 특별수익으로 분류되어 상속분 계산에 반영될 수 있습니다. 증여 시기와 금액, 대상자를 정리해두는 것이 중요합니다.`
    });
  }

  return modules;
}

/* ── 3. 공통 리포트 골격 (섹션 구조) ────────────────────────────────── */

function buildReportSkeleton(answers, matchedTypes, score) {
  const level = score >= 70 ? '주의 필요' : score >= 40 ? '확인 필요' : '기본 정리';

  return {
    meta: {
      version: 'paid-report-v1',
      generatedAt: new Date().toISOString(),
      score,
      level,
      matchedTypes: matchedTypes.map(t => t.title)
    },
    sections: [
      'section_summary',        // 1. 내 상황 요약
      'section_persons',        // 2. 먼저 확인할 사람 관계
      'section_assets',         // 3. 확인할 재산과 채무
      'section_documents',      // 4. 준비하면 좋은 자료
      'section_blind_spots',    // 5. 놓치기 쉬운 항목
      'section_questions',      // 6. 상담 전 정리할 질문
      'section_next_steps'      // 7. 다음에 확인할 순서
    ]
  };
}

/* ── 4. Claude API 프롬프트 빌더 ─────────────────────────────────────── */

function buildSystemPrompt() {
  return `당신은 안심상속 유료 상세리포트를 작성하는 전문 작성 시스템입니다.

【역할과 포지션】
- 법률·세무 조언을 제공하는 것이 아니라, 상속 상황을 정리하고 상담 전 준비를 돕는 리포트를 작성합니다.
- 법률 판단, 세금 계산 결과, 전문가 연결 보장, 결과 보장 표현은 절대 사용하지 않습니다.
- "상속정리 리포트"가 아닌 "유료 상세리포트"라는 명칭을 사용합니다.
- 독자가 혼자 조용히 읽는 비공개 자료임을 전제합니다.

【2026년 최신 법령 기준 - 반드시 반영】
■ 유류분 제도 (2026.2.12 개정 민법):
  - 형제자매의 유류분 청구권 폐지 (즉시 효력 상실)
  - 패륜 상속인(장기 유기·학대 등) 가정법원 선고로 상속권 및 유류분권 상실 가능 (2024.4.25 이후 개시 상속 소급 적용)
  - 피상속인 부양·재산 기여에 대한 보상적 증여는 유류분 반환청구 대상 제외
  - 민법 제1004조의2 신설 (상속권 상실 선고)
■ 상속세 공제 (2026년 현재):
  - 일괄공제: 5억 원 (기초공제 2억 + 인적공제 합계가 5억 미만이면 일괄공제 유리)
  - 배우자공제: 최소 5억, 최대 30억 (실제 상속받은 금액과 법정상속분 중 적은 금액)
  - 동거주택상속공제: 요건 충족 시 주택가액의 100% (최대 6억)
  - 유산취득세 전환: 2028년 이후 시행 목표 (현재 미시행)
■ 상속 순위: 직계비속(1순위) > 직계존속(2순위) > 형제자매(3순위) > 4촌 이내 방계혈족(4순위)
■ 법정상속분: 배우자는 직계비속 상속분의 1.5배, 자녀는 균등
■ 유언장 방식: 자필증서, 공정증서, 비밀증서, 구수증서, 녹음 (공정증서 가장 안전)
■ 상속 신고 기한: 상속개시일로부터 6개월 이내 (해외 거주자 9개월)
■ 한정승인·상속포기: 상속개시 사실을 안 날로부터 3개월 이내

【작성 원칙】
1. 쉬운 한글 사용 (한자·전문용어 최소화)
2. 단정적 표현 금지 ("~해야 합니다" 대신 "~확인해보시는 것이 좋습니다")
3. 법적 판단 표현 금지 ("법적으로 유효합니다", "상속세가 얼마입니다" 등)
4. 각 섹션은 실용적이고 구체적으로 작성
5. 마지막에 반드시 면책 문구 포함

응답은 반드시 아래 JSON 구조로만 반환하세요. 마크다운 코드블록이나 다른 텍스트 없이 JSON만 반환하세요.`;
}

function buildUserPrompt(answers, matchedTypes, contextModules, score) {
  const level = score >= 70 ? '주의 필요' : score >= 40 ? '확인 필요' : '기본 정리';

  const assetList = [];
  const presence = Array.isArray(answers.assetPresence) ? answers.assetPresence : [];
  const counts   = answers.assetCounts || {};
  if (presence.includes('house'))            assetList.push(`주택 ${counts.house || '1채'}`);
  if (presence.includes('land'))             assetList.push(`토지 ${counts.land || '1곳'}`);
  if (presence.includes('incomeRealEstate')) assetList.push(`수익형 부동산 ${counts.incomeRealEstate || '1개'}`);
  if (presence.includes('factory'))          assetList.push(`공장·창고 ${counts.factory || '1곳'}`);
  if (presence.includes('otherRealEstate'))  assetList.push(`기타 부동산 ${counts.otherRealEstate || '1건'}`);

  const overseas = Array.isArray(answers.overseas) ? answers.overseas : [];
  const overseasLabels = {
    self_abroad: '본인 해외 거주',
    family_abroad: '가족 해외 거주',
    family_foreign_nationality: '가족 외국 국적',
    dual_nationality: '복수국적',
    overseas_asset: '해외 재산'
  };
  const overseasList = overseas
    .filter(v => !['none','unknown'].includes(v))
    .map(v => overseasLabels[v] || v);

  const contextText = contextModules.map(m =>
    `[${m.title}]\n${m.content}`
  ).join('\n\n');

  return `다음 고객의 진단 결과를 바탕으로 안심상속 유료 상세리포트를 작성해주세요.

【진단 결과 요약】
- 진단 점수: ${score}점 (${level})
- 매칭된 상황 유형: ${matchedTypes.map(t => t.title).join(', ')}

【진단 답변 요약】
- 가족 구성: ${answers.family || '미답변'}
- 유언장 준비: ${answers.will || '미답변'}
- 부동산 현황: ${assetList.length > 0 ? assetList.join(', ') : '해당 없음'}
- 사전 증여: ${answers.gift || '미답변'}
- 사업체·지분: ${answers.business || '미답변'}
- 해외 요소: ${overseasList.length > 0 ? overseasList.join(', ') : '없음'}
- 가족 갈등: ${answers.conflict || '미답변'}
- 자료 정리: ${answers.documents || '미답변'}

【상황별 핵심 정보 (리포트에 반드시 반영)】
${contextText}

위 정보를 바탕으로 다음 JSON 구조로 리포트를 작성하세요:

{
  "title": "안심상속 유료 상세리포트",
  "subtitle": "내 상황에 맞춰 정리한 상속 준비 자료",
  "level": "${level}",
  "score": ${score},
  "matchedTypes": ${JSON.stringify(matchedTypes.map(t => t.title))},
  "sections": {
    "summary": {
      "title": "내 상황 요약",
      "lead": "한 문장으로 현재 상황의 핵심",
      "points": ["핵심 확인사항 3~5개 (구체적으로)"]
    },
    "persons": {
      "title": "먼저 확인할 사람 관계",
      "description": "상속인 범위와 관계 정리 방법 설명",
      "checklist": ["확인할 항목 3~5개"]
    },
    "assets": {
      "title": "확인할 재산과 채무",
      "description": "재산 파악 방법 안내",
      "checklist": ["확인할 항목 4~6개 (진단 답변 기반으로 구체적으로)"]
    },
    "documents": {
      "title": "준비하면 좋은 자료",
      "description": "상담 전 준비할 서류 안내",
      "basic": ["기본 서류 3~4개"],
      "situation_specific": ["상황별 추가 서류 2~4개 (진단 답변 반영)"]
    },
    "blind_spots": {
      "title": "놓치기 쉬운 항목",
      "description": "이 상황에서 특히 주의해야 할 점",
      "items": [
        {"title": "항목명", "content": "구체적 설명 2~3문장"}
      ]
    },
    "questions": {
      "title": "상담 전 정리할 질문",
      "description": "전문가 상담 시 물어볼 질문 목록",
      "questions": ["질문 4~6개 (이 상황에 맞는 구체적 질문)"]
    },
    "next_steps": {
      "title": "다음에 확인할 순서",
      "description": "지금부터 할 수 있는 것들",
      "steps": [
        {"order": 1, "title": "단계명", "content": "설명"}
      ]
    }
  },
  "legal_notice": "본 리포트는 정보 제공 목적이며, 법률·세무 조언을 대체하지 않습니다. 구체적인 상황은 반드시 변호사·세무사 등 전문가와 상담하세요.",
  "generated_at": "${new Date().toISOString()}"
}`;
}

/* ── 5. Claude API 호출 ──────────────────────────────────────────────── */

async function callClaudeAPI(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Claude API 오류: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const text = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  /* JSON 파싱 (코드블록 제거 후) */
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

/* ── 6. Supabase 저장 ────────────────────────────────────────────────── */

async function saveReportToSupabase(leadId, reportData) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return { ok: false, skipped: true };

  const row = {
    lead_id: leadId || null,
    score: reportData.score,
    level: reportData.level,
    matched_types: reportData.matchedTypes,
    report_json: reportData,
    created_at: new Date().toISOString()
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/paid_reports`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(row)
  });

  return { ok: res.ok, status: res.status };
}

/* ── 7. 메인 핸들러 ─────────────────────────────────────────────────── */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const answers  = body.answers  && typeof body.answers  === 'object' ? body.answers  : {};
    const score    = Number.isFinite(Number(body.score))   ? Number(body.score) : 0;
    const leadId   = String(body.leadId || '').trim() || null;
    const email    = String(body.email  || '').trim();

    /* 기본 검증 */
    if (!email || !email.includes('@')) {
      return res.status(400).json({ ok: false, message: '이메일이 필요합니다.' });
    }

    /* 유형 매칭 */
    const matchedTypes   = matchReportTypes(answers);
    const contextModules = buildContextModules(answers, matchedTypes);
    buildReportSkeleton(answers, matchedTypes, score); // 구조 참조용

    /* Claude API 호출 */
    const systemPrompt = buildSystemPrompt();
    const userPrompt   = buildUserPrompt(answers, matchedTypes, contextModules, score);

    let reportData;
    try {
      reportData = await callClaudeAPI(systemPrompt, userPrompt);
    } catch (apiErr) {
      console.error('Claude API 오류:', apiErr);
      return res.status(502).json({
        ok: false,
        message: '리포트 생성 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
      });
    }

    /* Supabase 저장 (실패해도 응답은 정상 반환) */
    saveReportToSupabase(leadId, reportData).catch(err =>
      console.error('Supabase 저장 실패:', err)
    );

    return res.status(200).json({
      ok: true,
      report: reportData,
      meta: {
        matchedTypes: matchedTypes.map(t => t.title),
        score,
        level: reportData.level,
        generatedAt: reportData.generated_at
      }
    });

  } catch (err) {
    console.error('generate-report 오류:', err);
    return res.status(500).json({
      ok: false,
      message: '리포트 생성 중 오류가 발생했습니다.'
    });
  }
}
