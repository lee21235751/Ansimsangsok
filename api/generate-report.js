/**
 * 안심상속 유료 상세리포트 자동 생성 API
 * POST /api/generate-report
 */

/* Claude API 호출(+ JSON 파싱 실패 시 1회 재시도)이 시간이 걸릴 수 있어 함수 최대 실행시간을 넉넉히 잡음 */
export const maxDuration = 180;

/* ── 20개 유형 매칭 ── */
const TYPES = {
  T01:'배우자와 자녀가 있는 일반 상속',
  T02:'배우자만 있거나 자녀만 있는 상속',
  T03:'자녀가 없고 형제자매가 관련되는 상속',
  T04:'재혼가정 상속',
  T05:'전혼 자녀가 있는 상속',
  T06:'연락이 끊긴 가족이 있는 상속',
  T07:'가족 간 갈등 가능성이 큰 상속',
  T08:'부동산이 포함된 상속',
  T09:'금융재산 중심 상속',
  T10:'채무가 걱정되는 상속',
  T11:'상속포기·한정승인 검토가 필요한 상속',
  T12:'사망 전 증여가 있었던 상속',
  T13:'유류분 문제가 생길 수 있는 상속',
  T14:'유언장이 있는 상속',
  T15:'유언장이 없거나 확인이 필요한 상속',
  T16:'해외 거주 가족·해외 재산이 관련된 상속',
  T17:'사업체·지분·법인 관련 상속',
  T18:'고령 부모 생전 정리가 필요한 상황',
  T19:'혼자 먼저 조용히 정리하려는 상황',
  T20:'상담 전 질문과 준비자료를 정리해야 하는 상황'
};

function matchTypes(a) {
  const s = {};
  const add = (id, n) => { s[id] = (s[id]||0) + n; };
  const family   = a.family   || '';
  const will     = a.will     || '';
  const gift     = a.gift     || '';
  const unequalIntent = a.unequalIntent || '';
  const business = a.business || '';
  const conflict = a.conflict || '';
  const docs     = a.documents|| '';
  const overseas = Array.isArray(a.overseas) ? a.overseas : [];
  const assetTypes = Array.isArray(a.assetTypes) ? a.assetTypes : [];
  const presence = Array.isArray(a.assetPresence) ? a.assetPresence : [];
  const remarriage = Array.isArray(a.remarriage) ? a.remarriage : [];
  const hasRemarriage = remarriage.some(v => v !== 'none');
  const hasRE    = presence.some(v => !['none','unknown'].includes(v)) || assetTypes.includes('realestate');

  if (family==='배우자 또는 자녀가 있음')           { add('T01',40); }
  if (hasRemarriage) { add('T04',50); add('T05',40); add('T13',20); }
  if (family==='자녀가 없거나 형제자매와 관련될 수 있음') { add('T02',30); add('T03',40); }

  if (will==='이미 정리해둔 내용이 있음')          add('T14',40);
  if (will==='아직 정리하지 못함')                { add('T15',40); add('T19',20); }
  if (will==='생각은 있지만 문서로 정리하지 않음') { add('T15',25); add('T20',20); }

  if (hasRE) { add('T08',35); }

  if (gift==='일부 있음')    { add('T12',35); add('T13',20); }
  if (gift==='상당히 있음')  { add('T12',50); add('T13',40); }

  /* 핵심: 특정 자녀에게 더 주고 싶은 의향 — 이 서비스의 핵심 타겟 신호 */
  if (unequalIntent==='있음 — 이미 마음을 정함') { add('T13',55); }
  if (unequalIntent==='있음 — 아직 확신은 없음') { add('T13',40); }

  if (business==='중요한 비중을 차지함') { add('T17',50); }
  if (business==='조금 있음')           { add('T17',25); }
  if (assetTypes.includes('business') && business!=='중요한 비중을 차지함' && business!=='조금 있음') { add('T17',15); }

  const hasOverseas = overseas.some(v => !['none','unknown'].includes(v))
    || assetTypes.includes('overseas_stock') || assetTypes.includes('crypto');
  if (hasOverseas) {
    add('T16',45);
    /* 자산 해외이전·디지털자산은 실무상 더 까다로운 케이스라 가중치 상향 */
    if (overseas.includes('overseas_realestate_or_company')) add('T16',20);
    if (overseas.includes('overseas_securities') || assetTypes.includes('overseas_stock')) add('T16',15);
    if (overseas.includes('overseas_bank')) add('T16',10);
    if (overseas.includes('crypto') || assetTypes.includes('crypto')) add('T16',15);
    if (overseas.includes('permanent_residency')) add('T16',10);
    /* 외국국적·복수국적 자녀는 상속 실행 절차(서류·아포스티유) 자체가 막힐 수 있는 핵심 케이스 */
    if (overseas.includes('family_foreign_nationality')) add('T16',18);
    if (overseas.includes('dual_nationality')) add('T16',10);
  }

  if (conflict==='조금 있음')   { add('T07',35); add('T13',15); }
  if (conflict==='이미 뚜렷함') { add('T07',55); add('T13',25); add('T06',20); }

  if (docs==='거의 정리되어 있지 않음') { add('T20',35); add('T18',20); }
  if (docs==='일부만 정리되어 있음')     add('T20',20);

  const unknowns = [family,will,gift,business,conflict,docs].filter(v=>v.includes('모르겠음')).length;
  if (unknowns>=2) add('T20', unknowns*10);

  if (!Object.keys(s).length) s['T01']=30;

  return Object.entries(s).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=>TYPES[id]);
}

/* ── 심화설문 → 시뮬레이션 데이터 변환 ── */
function buildSimulation(deep) {
  if (!deep || typeof deep !== 'object' || !Object.keys(deep).length) return null;

  const assetMidpoint = {
    '5억 미만': 2.5, '5억~10억': 7.5, '10억~30억': 20,
    '30억~100억': 65, '100억 이상': 150, '정확한 금액은 모르겠음': null
  };
  const finMidpoint = {
    '1억 미만': 0.5, '1억~3억': 2, '3억~5억': 4, '5억~10억': 7.5, '10억 이상': 12, '정확한 금액은 모르겠음': null
  };
  const debtMidpoint = {
    '없음': 0, '1천만원 미만': 0.05, '1천만~1억': 0.5, '1억 이상': 1.5, '정확한 금액은 모르겠음': null
  };
  const overseasMidpoint = {
    '1억 미만': 0.5, '1억~3억': 2, '3억~5억': 4, '5억 이상': 7, '정확한 금액은 모르겠음': null
  };

  const realEstateEok  = assetMidpoint[deep.realEstateValue] ?? null;
  const overseasEok    = overseasMidpoint[deep.overseasAssetValue] ?? 0;
  const hasOverseasAsset = !!deep.overseasAssetValue && deep.overseasAssetValue !== '정확한 금액은 모르겠음';

  const totalEok = assetMidpoint[deep.totalAssets] ?? null;
  const debtEok  = debtMidpoint[deep.debt] ?? 0;
  /* 해외자산은 totalAssets 구간 추정에 이미 포함했을 가능성이 있으므로 합산하지 않고 별도 표기만 함 */
  const netEok   = totalEok != null ? Math.max(0, totalEok - (debtEok||0)) : null;

  /* 일괄공제 5억 + 배우자공제(최소5억) 단순 적용 예시 — 실제 세액 아님, 구간 추정용 */
  /* 별거 중이거나 이혼소송이 진행 중이어도 정식 이혼이 완료되지 않았다면 법적으로는 100% 배우자 상속인 자격을 그대로 유지함 */
  const spouseAlive = deep.spouseStatus === '생존(혼인관계 유지·동거)' || deep.spouseStatus === '생존 — 별거 중(정식 이혼 안 함)' || deep.spouseStatus === '생존 — 이혼소송 진행 중(아직 미확정)';
  const spouseEstranged = deep.spouseStatus === '생존 — 별거 중(정식 이혼 안 함)' || deep.spouseStatus === '생존 — 이혼소송 진행 중(아직 미확정)';
  const spouseCommonLaw = deep.spouseStatus === '사실혼 — 혼인신고는 하지 않음(동거·내연관계 포함)';
  const baseDeduction = 5; /* 일괄공제 5억 */
  const spouseDeduction = spouseAlive ? 5 : 0; /* 최소 배우자공제 5억 (실제는 최대 30억까지 변동) */
  const totalDeduction = baseDeduction + spouseDeduction;
  const taxableEok = netEok != null ? Math.max(0, netEok - totalDeduction) : null;

  /* 법정상속분 비율 계산
     1순위: 직계비속(자녀) + 배우자(1.5) — 자녀 있으면 항상 이 순위로 확정
     2순위: 직계존속(부모) + 배우자(1.5) — 자녀 없고 부모 생존 시
     3순위: 형제자매(균등) — 자녀·부모 모두 없을 때, 배우자 있으면 배우자 단독 우선
     주의: 직계존속·형제자매는 유류분 비율이 다름(직계존속 1/3, 형제자매는 2024년 헌재 위헌 결정으로 유류분 자체 폐지) */
  const childCount = { '0명':0,'1명':1,'2명':2,'3명':3,'4명 이상':4 }[deep.childrenCount];
  const parentsAlive = deep.parentsAlive === '생존';
  const siblingsCount = { '0명':0,'1명':1,'2명':2,'3명 이상':3 }[deep.siblingsCount];
  let shareText = null;
  let spouseShareEok = null, childShareEok = null;
  let spouseForcedShareEok = null, childForcedShareEok = null;
  let inheritanceTier = null; /* 'children' | 'parents' | 'siblings' | 'spouse_only' | null */

  if (childCount > 0) {
    inheritanceTier = 'children';
  } else if (childCount === 0) {
    if (parentsAlive) {
      inheritanceTier = 'parents';
    } else if (spouseAlive) {
      inheritanceTier = 'spouse_only';
    } else if (siblingsCount != null) {
      inheritanceTier = 'siblings';
    }
  }

  if (inheritanceTier === 'children' && netEok != null) {
    const spouseShare = spouseAlive ? 1.5 : 0;
    const totalShare = spouseShare + childCount * 1;
    if (totalShare > 0) {
      const parts = [];
      if (spouseAlive) {
        const ratio = spouseShare/totalShare;
        parts.push(`배우자 ${(ratio*100).toFixed(1)}%`);
        spouseShareEok = netEok * ratio;
        spouseForcedShareEok = spouseShareEok * 0.5; /* 배우자 유류분 = 법정상속분의 1/2 */
      }
      if (childCount > 0) {
        const ratio = 1/totalShare;
        parts.push(`자녀 1인당 ${(ratio*100).toFixed(1)}%`);
        childShareEok = netEok * ratio;
        childForcedShareEok = childShareEok * 0.5; /* 직계비속 유류분 = 법정상속분의 1/2 */
      }
      shareText = parts.join(', ');
    }
  } else if (inheritanceTier === 'parents' && netEok != null) {
    /* 직계존속(부모)도 배우자와 1.5:1 비율로 공동상속, 유류분은 법정상속분의 1/3 */
    const spouseShare = spouseAlive ? 1.5 : 0;
    const totalShare = spouseShare + 1; /* 부모 전체를 1로 단순화(부 또는 모 단독 생존도 동일 취급) */
    const parts = [];
    if (spouseAlive) {
      const ratio = spouseShare/totalShare;
      parts.push(`배우자 ${(ratio*100).toFixed(1)}%`);
      spouseShareEok = netEok * ratio;
      spouseForcedShareEok = spouseShareEok * 0.5;
    }
    const parentRatio = 1/totalShare;
    parts.push(`직계존속(부모) 전체 ${(parentRatio*100).toFixed(1)}%`);
    childShareEok = netEok * parentRatio; /* 변수명은 재사용하되 실질은 직계존속 몫 */
    childForcedShareEok = childShareEok * (1/3); /* 직계존속 유류분 = 법정상속분의 1/3 */
    shareText = parts.join(', ') + ' (자녀가 없어 직계존속이 1순위로 공동상속)';
  } else if (inheritanceTier === 'spouse_only' && netEok != null) {
    spouseShareEok = netEok;
    spouseForcedShareEok = netEok * 0.5;
    shareText = '배우자 단독상속 100% (직계비속·직계존속이 모두 없어 배우자가 전부 상속)';
  } else if (inheritanceTier === 'siblings' && netEok != null) {
    /* 자녀·부모 모두 없고 배우자도 없으면 형제자매가 균등 상속. 형제자매는 2024년 헌재 위헌 결정으로 유류분 자체가 폐지됨 */
    const n = Math.max(1, siblingsCount || 1);
    childShareEok = netEok / n;
    childForcedShareEok = 0; /* 형제자매는 유류분 없음 */
    shareText = `형제자매 ${n}인 균등상속 (1인당 ${(100/n).toFixed(1)}%, 유류분 권리 없음)`;
  }

  /* 유류분 산정 기초재산 관련 플래그
     주의: 상속인(자녀 등)에 대한 증여는 시기와 무관하게 전부 합산됨(10년 제한 아님).
     제3자 증여만 상속개시 전 1년분 합산. 이 서비스의 증여 문항은 가족(상속인) 대상 증여를 전제로 함. */
  const giftToHeir = !!deep.priorGiftAmount; /* 증여액 입력이 있으면 상속인 증여로 간주, 시기 무관 항상 합산대상 */
  const giftAmountEok = { '1천만원 미만':0.05,'1천만~5천만':0.3,'5천만~1억':0.75,'1억~5억':3,'5억 이상':7 }[deep.priorGiftAmount] ?? null;

  return {
    totalEok, debtEok, netEok, totalDeduction, taxableEok,
    realEstateEok, hasOverseasAsset, overseasEok,
    realEstateCount: deep.realEstateCount || null,
    overseasAssetType: deep.overseasAssetType || null,
    spouseNationality: deep.spouseNationality || null,
    parentNeglect: deep.parentNeglect || null,
    childrenNationality: deep.childrenNationality || null,
    predeceasedChild: deep.predeceasedChild || null,
    grandchildrenNationality: deep.grandchildrenNationality || null,
    spouseAlive, spouseEstranged, spouseCommonLaw, childCount, shareText, inheritanceTier,
    spouseShareEok, childShareEok, spouseForcedShareEok, childForcedShareEok,
    giftToHeir, giftAmountEok, priorGiftTiming: deep.priorGiftTiming || null,
    businessShare: deep.businessShare || null,
    foreignNatChildren: deep.foreignNatChildren || null,
    caregivingContribution: deep.caregivingContribution || null,
    conflictDetail: deep.conflictDetail || null,
    expertNeed: deep.expertNeed || null
  };
}

function formatEok(n) {
  if (n == null) return '확인 필요';
  if (n === 0) return '0원';
  return n >= 1 ? `약 ${n.toFixed(1)}억 원` : `약 ${Math.round(n*10000)}만 원`;
}

/* ── 상황별 컨텍스트 모듈 ── */
function getContext(a, types, deep, sim) {
  deep = deep || {};
  const lines = [];
  const overseas = Array.isArray(a.overseas) ? a.overseas : [];
  const assetTypes = Array.isArray(a.assetTypes) ? a.assetTypes : [];
  const hasOverseas = overseas.some(v=>!['none','unknown'].includes(v)) || assetTypes.includes('overseas_stock') || assetTypes.includes('crypto');
  const hasPR = overseas.includes('permanent_residency');
  const hasOverseasRE = overseas.includes('overseas_realestate_or_company');
  const hasOverseasSec = overseas.includes('overseas_securities') || assetTypes.includes('overseas_stock');
  const hasOverseasBank = overseas.includes('overseas_bank');
  const hasCrypto = overseas.includes('crypto') || assetTypes.includes('crypto');
  const hasDual = overseas.includes('dual_nationality');
  const hasForeignNat = overseas.includes('family_foreign_nationality');
  const presence = Array.isArray(a.assetPresence) ? a.assetPresence : [];
  const hasLand = presence.includes('land');
  const hasIncomeRE = presence.includes('incomeRealEstate');

  if (a.unequalIntent==='있음 — 이미 마음을 정함' || a.unequalIntent==='있음 — 아직 확신은 없음') {
    lines.push('핵심: 특정 자녀(가족)에게 더 남기고 싶은 의향이 있는 경우, 단순히 유언장에 "더 준다"고만 적으면 다른 상속인이 유류분반환청구로 법정상속분의 1/2(직계비속·배우자 기준)까지는 결국 가져갈 수 있음. 따라서 "내 뜻대로 더 주는 것"을 실질적으로 지키려면 유류분 자체를 줄이는 합법적 설계(기여분 입증, 시효 활용, 사전 협의)가 함께 필요함. 이것이 일반적인 절세 상담과 다른, 이 리포트의 핵심 목적임.');
  }
  if (hasForeignNat) {
    lines.push('핵심: 자녀(가족)가 외국 국적인 경우, 본인(피상속인)이 한국 국적을 유지한다면 상속 자체는 한국 민법이 그대로 적용되어 상속권 자체는 보장됨(국제사법 제77조, 본국법주의). 문제는 권리가 아니라 "실행 절차". 외국국적 자녀는 한국 인감증명서를 발급받을 수 없어, 상속재산분할협의서나 위임장에 서명할 때 현지 공증인의 서명인증서와 아포스티유 인증, 공증된 한국어 번역문을 모두 갖춰야 함. 한국 재외공관(영사관)의 사서증서 인증만으로는 등기소·법원이 접수를 거부하는 경우가 실무상 많아, 이를 모르고 영사관에서 처리하려다 서류가 반려되는 사례가 흔함.');
    lines.push('상속재산분할협의서는 상속인 전원의 서명이 있어야 효력이 있어, 외국국적 자녀 한 명의 서류만 늦어져도 전체 절차가 멈춤. 국제우편 왕복, 번역공증까지 고려하면 통상 3개월 이상 걸릴 수 있어, 균등하게 또는 원하는 대로 나누고 싶어도 실제로는 한 사람 때문에 전체가 지연되는 경우가 많음. 가능하면 생전에 위임장 양식을 미리 준비해두거나, 자녀가 한국 방문 시 국내 공증으로 처리해두는 방법을 검토할 것.');
  }
  if (hasDual) {
    lines.push('핵심: 국적법상 복수국적자는 대한민국 법령 적용에서 대한민국 국민으로만 처우받음. 즉 한국 내 상속 절차에서는 외국 국적을 따로 주장할 수 없고 한국 국민 기준으로 처리되므로, 한국 인감증명서·기본증명서 발급이 가능해 외국국적자보다 절차가 한결 간단함. 상속 관련 서류는 한국 국적 기준으로 준비하면 됨.');
  }
  const remarriageArr = Array.isArray(a.remarriage) ? a.remarriage : [];
  const hasMyPriorChildren = remarriageArr.includes('my_prior_children');
  const hasSpousePriorChildren = remarriageArr.includes('spouse_prior_children');
  const hasChildAdoptedAway = remarriageArr.includes('my_child_adopted_away');
  const wantsAvoidStepInheritance = remarriageArr.includes('avoid_step_inheritance');
  const hasUnrecognizedChild = remarriageArr.includes('unrecognized_child');
  if (hasMyPriorChildren || hasSpousePriorChildren || hasChildAdoptedAway || types.some(t=>t.includes('전혼')||t.includes('재혼'))) {
    if (hasMyPriorChildren) {
      lines.push('나의 전혼 자녀(이전 혼인에서 낳은 친자식)도 법정상속인으로, 현재 배우자와의 사이에서 낳은 자녀와 완전히 동등한 상속분을 가짐. 상속인 범위를 정확히 파악하고 빠뜨리지 않도록 해야 함.');
    }
    if (hasSpousePriorChildren) {
      lines.push('주의(흔한 오해): 배우자가 데려온 자녀(의붓자식)는 친양자 입양 등 정식 입양 절차를 거치지 않았다면 법적으로 상속인이 아님. 오랜 기간 함께 살아 친자녀처럼 느껴지더라도 법정상속분은 없으며, 그 의붓자식에게 재산을 남기고 싶다면 입양 절차를 밟거나 유언으로 유증을 명시해야 함.');
    }
    if (hasChildAdoptedAway) {
      lines.push('참고(안심 정보): 나의 전혼 자녀가 전 배우자의 재혼 상대에게 친양자로 입양되었다면, 그 순간 그 자녀와 본인 사이의 법적 친자관계는 종료됨. 따라서 그 자녀는 더 이상 본인의 법정상속인이 아니며, 본인 사망 시 상속 대상에서 자동으로 제외됨. 이는 본인의 상속인 범위를 줄여주는 정보이므로 정확히 알려드릴 것(단, 일반 양자 입양이라면 친생관계가 유지되어 여전히 상속인이므로, 친양자인지 일반양자인지 정확히 확인이 필요하다는 점도 함께 안내).');
    }
    if (!hasMyPriorChildren && !hasSpousePriorChildren && !hasChildAdoptedAway) {
      /* 무료진단에서 remarriage 답변이 없어도 심화설문 등에서 재혼/전혼 키워드가 잡힌 경우의 기본 안내 */
      lines.push('재혼가정인 경우, 전혼 자녀(친자식)는 법정상속인이지만 배우자가 데려온 자녀(의붓자식)는 입양하지 않았다면 상속인이 아니라는 점을 구분해 상속인 범위를 정확히 파악할 필요가 있음.');
    }
  }
  if (wantsAvoidStepInheritance) {
    lines.push('[핵심] 본인이 먼저 사망하면 재산 일부가 배우자에게 가는데, 그 배우자가 나중에 사망하면 그 재산(원래 본인 재산이었던 부분 포함)은 배우자의 고유재산이 되어 배우자의 직계비속(배우자의 전혼 자녀 포함)에게 그대로 상속됨. 본인의 친자식이 아닌 배우자의 전혼 자녀에게 결국 자신의 재산이 흘러가는 것을 막을 방법이 없는가에 대해, 재산 규모와 무관하게 활용 가능한 방법들을 비용·난이도 순으로 설명하세요. ① 유언장에서 배우자 몫을 법정상속분이 아니라 유류분 수준(법정상속분의 1/2)까지로 정하고 나머지는 친자식에게 직접 분배하도록 지정하는 방법 — 배우자에게 가는 절대액이 줄어들면 나중에 의붓자식에게 흘러갈 수 있는 금액도 함께 줄어드는 구조. 별도 비용이 거의 들지 않음. ② 생전에 친자식에게 직접 사전증여하는 방법 — 배우자를 거치지 않고 바로 자녀에게 재산을 이전하는 단순한 방법(10년간 5천만원까지는 증여세 공제 적용). 소액부터 가능. ③ 종신보험 등에서 수익자를 친자식으로 직접 지정하는 방법 — 보험금은 원칙적으로 상속재산이 아니라 지정된 수익자의 고유재산이 되므로, 큰 목돈 없이도 활용 가능. ④ 유언대용신탁 — 1차 수익자를 배우자로, 배우자 사망 후 잔여재산의 2차(후순위) 수익자를 친자식으로 지정하는 연속수익자 구조로, 일반 유언장으로는 구현할 수 없는 방법이지만 신탁 설계 비용과 최소 가입금액이 있어 재산 규모가 작다면 ①~③이 먼저 검토되는 경우가 많고, 여력이 될 때 추가로 고려되는 방법. 어떤 방법을 쓰든 배우자의 유류분(법정상속분의 1/2)은 완전히 배제할 수 없다는 공통 한계가 있다는 점도 함께 설명하세요.');
  }
  if (hasUnrecognizedChild) {
    lines.push('[핵심] 가족관계증명서에 등재되지 않은 자녀(혼외자 등)가 있다면, 그 자녀가 친자로 "인지"되는 순간 다른 자녀들과 완전히 동일한 법정상속분을 갖게 됨. 인지는 본인이 생전에 스스로 할 수도 있고(임의인지), 본인 사후에 그 자녀가 유전자 검사 등을 통해 법원에 인지청구소송을 제기해 강제로 인정받을 수도 있음(사망 사실을 안 날로부터 2년 이내). 더 중요한 점은, 다른 상속인들이 이미 상속재산분할을 끝낸 뒤에 그 자녀가 인지되더라도 법적으로는 자신의 상속분에 해당하는 금액을 다른 상속인들에게 청구할 수 있다는 것(민법 제1014조) — 즉 이미 끝난 상속도 나중에 다시 흔들릴 수 있음. 이 문제를 사전에 분명히 하는 방법으로는 ① 본인이 생전에 그 자녀를 임의인지해 상속인 범위를 명확히 하는 방법 ② 유언장에 해당 자녀에 대한 입장을 명시해두는 방법이 일반적으로 활용되며, 어느 쪽이든 변호사와의 상담을 통한 개별 확인이 필요한 영역이라는 점을 신중하고 담담한 톤으로 설명하세요.');
  }
  if (sim && sim.spouseEstranged) {
    lines.push('[핵심] 배우자와 별거 중이거나 이혼소송이 진행 중이지만 아직 정식으로 이혼이 확정되지 않았다면, 사망 당시 법률상 혼인관계만 유효하면 그것으로 충분하므로 배우자는 법정상속인 자격을 100% 그대로 유지함. 별거 기간이 길거나 사실상 관계가 끝났다고 느끼는 것은 법적 효력에 전혀 영향을 주지 않으며, 이는 본인의 의향과 무관하게 적용되는 강력한 기본값이라는 점을 분명히 설명하세요. 이를 원하지 않는다면 ① 이혼 절차를 사망 전에 완료하는 방법 ② 유언장으로 배우자의 몫을 유류분(법정상속분의 1/2) 수준까지로 최소화하는 방법(유류분 이하로는 줄일 수 없음)이 활용될 수 있다는 점을 구체적으로 설명하세요.');
  }
  if (sim && sim.spouseCommonLaw) {
    lines.push('[핵심] 혼인신고를 하지 않은 사실혼 관계(동거 포함)는 우리 민법상 상속권이 전혀 인정되지 않음 — 아무리 오래 함께 살았어도 법률혼 배우자와 달리 법정상속인이 될 수 없음. 사실혼 배우자에게 재산을 남기고 싶다면 반드시 유언장에 유증(특정인에게 재산을 남긴다는 명시)을 해야 하며, 그렇지 않으면 사실혼 배우자는 상속에서 완전히 배제됨. 다만 임대차보호법상 임차인 지위 승계, 일부 사회보험(산재·국민연금 등)에서는 사실혼 배우자도 보호받을 수 있다는 점은 별개로 설명하세요. 가장 확실한 보호 방법은 혼인신고이며, 그것이 어렵다면 유언장 작성이 사실상 필수에 가깝다는 점을 분명히 설명하세요.');
  }
  if (deep && deep.testatorHealth === '인지 능력 저하가 진행 중(치매 진단 등)') {
    lines.push('[핵심] 유언장을 작성하는 사람의 의사능력(인지능력)이 저하된 상태라면, 추후 다른 상속인이 "유언 당시 정상적인 판단이 불가능했다"는 이유로 유언무효확인소송을 제기할 수 있음 — 실제로 유언 효력 분쟁에서 가장 흔한 사유 중 하나임. 법원은 보통 진단서·인지기능검사 결과(MMSE 등), 유언 작성 시점과 진단 시점의 선후관계, 유언 내용의 합리성(특정인에게 유독 유리한지) 등을 종합적으로 살펴봄. 실무에서 의사능력 분쟁 가능성을 낮추기 위해 일반적으로 활용되는 방법으로는 ① 공정증서에 의한 유언(공증인과 증인 2인이 직접 확인하는 방식이라 자필증서보다 분쟁 시 효력을 인정받기 유리함) ② 유언 작성과 가까운 시점에 의사의 진단서나 소견서를 함께 받아 보관 ③ 가능하다면 작성 과정을 영상으로 남기는 방법 등이 있음. 다만 인지능력 저하의 정도가 이미 상당히 진행된 경우라면 유언 자체의 법적 효력이 처음부터 의심받을 수 있으므로, 이 부분은 일반적 설명으로 마무리하고 변호사·의료진과의 상담을 통한 개별 판단이 필요하다는 점을 분명히 설명하세요.');
  } else if (deep && deep.testatorHealth === '가벼운 건망증 등 경미한 변화가 있음') {
    lines.push('참고: 가벼운 인지 변화가 있는 단계에서는 통상 유언 능력 자체는 인정되는 경우가 많지만, 시간이 지날수록 의사능력 입증이 더 어려워질 수 있음. 작성 시점을 너무 늦추지 않는 것이 일반적으로 권장되며, 위와 같이 공정증서 유언 방식을 활용하면 분쟁 가능성을 낮추는 데 도움이 된다는 점을 간단히 설명하세요.');
  }
  if (sim && sim.childCount > 0 && sim.businessShare) {
    lines.push('참고(사업체 지분 보유 + 자녀가 있는 경우): 상속인 중 미성년 자녀가 있다면, 상속재산분할협의나 사업체 지분 승계 시 친권자(보통 배우자)와 미성년 자녀 사이에 이해관계가 충돌할 수 있어 가정법원에 특별대리인 선임을 신청해야 협의가 유효함. 자녀가 아직 어리다면 이 점을 미리 확인해두는 것이 좋다는 점을 설명하세요(자녀가 이미 성년이라면 해당 없음).');
  }
  if (types.some(t=>t.includes('유류분')) || types.some(t=>t.includes('형제자매')) || ['parents','spouse_only','siblings'].includes(sim && sim.inheritanceTier)) {
    lines.push('유류분 권리자: 형제자매는 2024년 4월 헌법재판소 위헌 결정으로 이미 유류분 권리가 폐지됨(자녀·배우자·부모만 유류분 보유, 직계비속·배우자는 법정상속분의 1/2, 직계존속은 1/3). 2026년 1월 1일부터 시행된 구하라법(상속권 상실 선고 제도, 민법 제1004조의2)으로 패륜상속인에 대한 상속권 상실선고 제도가 신설되었고, 기여에 대한 보상 성격 증여는 유류분 반환 대상에서 제외하도록 명문화됨.');
    lines.push('주의: 유언대용신탁은 과거 유류분 회피 수단으로 알려졌으나, 최근 판례는 신탁재산도 유류분 산정 기초재산에 포함시키는 추세이므로 만능 해법이 아님. 신탁만 믿고 다른 준비를 소홀히 하면 안 됨.');
    lines.push('합법적으로 유류분 영향을 줄이는 실무적 방법 3가지: ① 특정 자녀의 부양·간병·재산형성 기여를 구체적으로 입증할 자료(통장 이체내역, 간병기록, 진단서 등)를 미리 확보해 기여분으로 인정받는 방법(2026 개정으로 기여 보상 증여는 유류분에서 제외됨) ② 유류분반환청구권의 소멸시효(침해를 안 날로부터 1년, 상속개시일로부터 10년)를 정확히 이해하고 시기를 설계하는 방법 ③ 유언장에 증여·유증의 경위와 이유를 구체적으로 명시해 다른 상속인의 이해를 구하고 분쟁 가능성 자체를 낮추는 방법.');
  }
  if (sim && sim.parentNeglect && sim.parentNeglect !== '없음') {
    lines.push('[핵심] 부모(직계존속)가 본인이 미성년이던 시절 양육 의무를 중대하게 저버렸거나 학대 등 부당한 대우를 했다면, 2026년 1월 1일 시행된 구하라법(민법 제1004조의2 상속권 상실 선고)에 따라 그 부모의 상속권 상실을 가정법원에 청구할 수 있음. 상속 개시와 동시에 자동으로 배제되는 것이 아니라 반드시 이해관계인이 가정법원에 별도로 청구해야 하며, 양육비 미지급 내역, 주민등록상 분리 기간, 학교·병원·복지기관의 보호자 기록, 제3자 진술 등이 핵심 증거로 활용됨. 이 법은 2024년 4월 25일 이후 개시된 상속에도 소급 적용될 수 있다는 점, 그리고 본인이 생전에 공정증서(공증)로 상속권 상실의 의사를 미리 표시해두는 방법도 있다는 점을 설명하세요. 관련 증거(과거 양육 공백을 보여주는 자료)를 미리 정리해두면 추후 도움이 될 수 있다는 점도 함께 언급하세요.');
  }
  if (hasPR && !hasForeignNat) {
    lines.push('핵심: 영주권(시민권 아님)은 국적 변경이 아님. 본인이 한국 국적을 유지하면 상속에는 원칙적으로 한국 민법이 그대로 적용됨(국제사법상 본국법주의). 영주권 보유 자체만으로 상속 준거법이 바뀌지 않는다는 점을 명확히 설명하세요.');
  }
  if (hasOverseasRE) {
    lines.push('해외로 옮긴 부동산·사업체(싱가포르·미국 등)도 피상속인이 한국 국적이면 한국 민법상 상속재산에 포함되며, 유류분 산정 기초재산에도 합산됨. 해당국 절차와 한국 절차가 동시에 필요해 분배 실행이 늦어질 수 있으므로 미리 준비할 것.');
  }
  if (hasOverseasSec) {
    lines.push('미국·홍콩 등 해외 증권계좌(주식)도 한국 거주자 기준 상속재산에 합산됨. 해외 증권사는 한국 가족관계증명서를 영문공증·아포스티유 받아 별도 상속절차(probate 등)를 거쳐야 인출 가능한 경우가 많아 시간이 오래 걸림.');
  }
  if (hasOverseasBank) {
    lines.push('해외 예금·은행계좌도 한국 거주자 기준 상속재산에 포함되며, 매월 말일 중 단 하루라도 잔액이 5억 원을 초과한 적이 있으면 해외금융계좌 신고 대상이 될 수 있음. 해외 은행은 한국 가족관계증명서·사망진단서를 영문공증·아포스티유 받아 제출해야 하고, 은행마다 절차가 달라 일반 상속재산보다 인출까지 오래 걸리는 경우가 많음. 계좌 정보(은행명·지점·계좌번호)를 가족이 전혀 모르면 존재 자체를 놓칠 수 있어 미리 정리해두는 것이 중요함.');
  }
  if (hasCrypto) {
    lines.push('암호화폐도 상속재산에 포함되며 상속세 신고 대상. 거래소 계정이면 가족관계증명서·사망진단서로 상속인 인출 신청 가능하나, 일반 재산 조회(안심상속 원스톱서비스 등)에는 가상자산 보유 사실이 나오지 않는 경우가 많아 가족이 존재 자체를 모르고 지나칠 수 있음. 개인 지갑(콜드월렛)의 시드구문·키를 본인만 알고 있으면 사망 시 영구히 접근 불가능해질 수 있어 사전에 안전한 방식으로 정보를 남겨두는 것이 중요함.');
  }
  if (hasOverseas && !hasOverseasRE && !hasOverseasSec && !hasOverseasBank && !hasCrypto && !hasPR) {
    lines.push('해외 거주 상속인은 서명공증 필요, 외국 국적자는 별도 서류, 해외 금융자산은 국내 신고 의무 있음(해외금융계좌 신고제도 — 매월 말일 중 단 하루라도 합산 잔액이 5억 원을 초과하면 다음 해 6월까지 신고 대상).');
  }
  if (types.some(t=>t.includes('사업체')||t.includes('지분'))) {
    lines.push('법인 지분은 정관·주주간 계약 확인 필요. 경영을 맡을 특정 자녀에게 지분을 몰아주려는 경우, 다른 자녀의 유류분 침해 가능성이 매우 높음(지분 평가액이 커서). 가업상속공제(현재 최대 600억)는 상속세 부담을 줄여줄 뿐 유류분 문제 자체를 해결하지 않으므로, 별도로 유류분 대응 설계가 필요함. 또한 2026년 하반기 세법 개정안에서 대상 업종 축소·경영기간 요건 상향 등 제도 개편이 예고되어 있어, 시점에 따라 적용 가능 여부가 달라질 수 있으므로 최신 시행 여부를 확인할 것.');
  }
  if (a.conflict==='이미 뚜렷함') {
    lines.push('갈등이 있는 경우 유언장 등 문서화가 핵심. 협의 분할 과정에서 갈등 표면화 가능.');
  }
  if (hasLand) {
    lines.push('토지·농지는 현금과 달리 물리적으로 똑같이 나누기 어려워, 공유지분 형태로 상속되는 경우가 많음. 공유지분 상태에서는 처분·개발 시 상속인 전원의 동의가 필요해 한 명이라도 반대하면 장기간 묶이는 경우가 흔함. 특정 자녀에게 농지를 온전히 남기고 싶다면, 다른 자녀에게 유류분 상당액을 현금이나 다른 재산으로 미리 정산하는 방안을 함께 검토할 것.');
  }
  if (hasIncomeRE) {
    lines.push('임대 목적 상가·건물은 임대수익이 함께 따라오므로, 단순 시가뿐 아니라 누가 임대관리·수익을 가져갈지도 분쟁 요소가 됨. 상속 후 공동소유 상태로 두면 임대료 배분, 관리비용 부담, 매각 여부를 둘러싸고 형제간 갈등이 길어지는 경우가 많아 미리 관리 방식(단독 상속 후 정산 vs 공동관리)을 정해두는 것이 중요함.');
  }
  if (deep.realEstateCount === '2건' || deep.realEstateCount === '3~4건' || deep.realEstateCount === '5건 이상') {
    lines.push('부동산이 여러 건이면, 단순히 시가 합계를 균등하게 나누는 것과 실제로 "어떤 부동산을 누가 가져가는지"는 전혀 다른 문제임. 같은 합계 금액이라도 입지·환금성·관리부담이 부동산마다 다르므로, 특정 자녀가 선호하는 부동산을 두고 다툼이 생기기 쉬움. 부동산별로 누구에게 남길지 미리 지정해두고, 가치 차이는 다른 재산이나 현금으로 조정하는 방식을 권장함.');
  }
  if (a.conflict==='조금 있음') {
    lines.push('지금은 사이가 괜찮아 보여도, 실제 상속 협의 과정에서 분배 비율에 대한 미묘한 입장 차이가 표면화되는 경우가 많음. 사전에 분배 기준을 명확히 문서화해두는 것이 갈등 예방에 효과적.');
  }
  if (a.conflict==='없음') {
    lines.push('현재 갈등이 없더라도, 국내 상속 관련 소송 건수는 이혼소송의 약 2배이며 그중 다수가 소액(1억원 이하) 분쟁이라는 점을 참고할 것. 사이가 좋은 가족도 막상 상속이 개시되면 입장이 달라질 수 있으므로 미리 정리해두는 것이 안전함.');
  }
  if (a.gift==='일부 있음'||a.gift==='상당히 있음') {
    lines.push('핵심: 상속인(자녀 등)에게 한 증여는 시기와 무관하게 기간 제한 없이 전부 유류분 산정 기초재산에 합산됨(10년 제한이 아님). 제3자에 대한 증여만 상속개시 전 1년분만 합산됨. 따라서 특정 자녀에게 일찍 증여했다고 해서 유류분 계산에서 빠지지 않음 — 이 점을 반드시 인지해야 함.');
  }
  if (a.documents==='거의 정리되어 있지 않음') {
    lines.push('재산 목록·가족관계·채무 현황이 정리되어 있지 않으면, 상속 개시 시 상속인들이 전체 그림을 파악하는 데만 상당한 시간이 걸림. 지금 한 장으로 정리해두는 것만으로도 향후 혼란을 크게 줄일 수 있음.');
  }
  return lines.join('\n');
}

/* ── Claude API 호출 ── */
async function callClaude(answers, types, score, deepAnswers) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 없음');

  const level = score>=70?'주의 필요':score>=40?'확인 필요':'기본 정리';
  const sim   = buildSimulation(deepAnswers);
  const ctx   = getContext(answers, types, deepAnswers, sim);

  const presence = Array.isArray(answers.assetPresence)?answers.assetPresence:[];
  const counts   = answers.assetCounts||{};
  const reTypeLabel = {house:'주택',land:'토지·농지',incomeRealEstate:'수익형부동산(상가등)',factory:'공장·창고',otherRealEstate:'기타부동산'};
  const reList   = ['house','land','incomeRealEstate','factory','otherRealEstate']
    .filter(k=>presence.includes(k))
    .map(k=>`${reTypeLabel[k]} ${counts[k]||'1'}건`)
    .join(', ') || '없음';

  const overseas = (Array.isArray(answers.overseas)?answers.overseas:[])
    .filter(v=>!['none','unknown'].includes(v)).join(', ')||'없음';

  let simBlock = '';
  if (sim) {
    simBlock = `

[심화설문 기반 시뮬레이션 데이터 — 반드시 simulation 섹션에 이 숫자를 그대로 활용해 구체적으로 작성]
- 전체 추정 재산: ${formatEok(sim.totalEok)}
- 부동산 추정 시가: ${formatEok(sim.realEstateEok)}
- 부동산 보유 건수(심화설문): ${sim.realEstateCount || '미상'}
- 부동산 보유 현황(무료진단 기준): ${reList}
- 해외자산 보유: ${sim.hasOverseasAsset ? formatEok(sim.overseasEok)+' 추정' : '없음 또는 모름'}
- 해외자산 형태: ${sim.overseasAssetType || '해당없음'}
- 배우자 국적·영주권 상태: ${sim.spouseNationality || '해당없음'}
- 자녀 국적·영주권 상태: ${sim.childrenNationality || '해당없음'}
- 먼저 사망한 자녀(대습상속 가능성): ${sim.predeceasedChild && sim.predeceasedChild !== '없음' ? sim.predeceasedChild : '없음'}
- 대습상속인이 될 손주의 국적·영주권 상태: ${sim.grandchildrenNationality || '해당없음'}
- 부모(직계존속)의 과거 양육의무 위반/학대 이력: ${sim.parentNeglect && sim.parentNeglect !== '없음' ? sim.parentNeglect + ' (구하라법 적용 검토 대상)' : '없음 또는 해당없음'}
- 무료진단에서 확인된 해외 요소(전체): ${overseas}
- 외국 국적(시민권) 보유 자녀 수: ${sim.foreignNatChildren && sim.foreignNatChildren !== '0명' ? sim.foreignNatChildren : '없음 또는 미상'}
- 채무 추정: ${formatEok(sim.debtEok)}
- 순재산(재산-채무): ${formatEok(sim.netEok)}
- 적용 가능 공제 추정(일괄공제5억${sim.spouseAlive?'+배우자공제 최소5억':''}): ${formatEok(sim.totalDeduction)}
- 과세대상 재산 추정(순재산-공제): ${formatEok(sim.taxableEok)}
- 배우자 생존: ${sim.spouseAlive ? '예':'아니오'}${sim.spouseEstranged ? ' (단, 별거 중이거나 이혼소송 진행 중 — 정식 이혼이 완료되지 않아 법적으로는 100% 배우자 상속인 자격 유지)' : ''}${sim.spouseCommonLaw ? ' (사실혼 관계 — 혼인신고 없어 법적 상속권 없음)' : ''}
- 자녀 수: ${sim.childCount ?? '미상'}명
- 상속순위 구분(inheritanceTier): ${sim.inheritanceTier === 'children' ? '1순위 직계비속(자녀)' : sim.inheritanceTier === 'parents' ? '2순위 직계존속(부모) — 자녀 없음' : sim.inheritanceTier === 'spouse_only' ? '배우자 단독상속 — 직계비속·직계존속 모두 없음' : sim.inheritanceTier === 'siblings' ? '3순위 형제자매 — 자녀·부모·배우자 모두 없음' : '확인 필요'}
- 법정상속분 비율: ${sim.shareText || '확인 필요'}
- 배우자 법정상속분 추정액: ${formatEok(sim.spouseShareEok)} / 배우자 유류분(법정상속분의 1/2) 추정액: ${formatEok(sim.spouseForcedShareEok)}
${sim.inheritanceTier === 'parents' ? `- 직계존속(부모) 전체 법정상속분 추정액: ${formatEok(sim.childShareEok)} / 직계존속 유류분(법정상속분의 1/3) 추정액: ${formatEok(sim.childForcedShareEok)}` : sim.inheritanceTier === 'siblings' ? `- 형제자매 1인당 법정상속분 추정액: ${formatEok(sim.childShareEok)} (형제자매는 2024년 헌재 위헌 결정으로 유류분 권리 자체가 없음)` : `- 자녀 1인당 법정상속분 추정액: ${formatEok(sim.childShareEok)} / 자녀 1인당 유류분(법정상속분의 1/2) 추정액: ${formatEok(sim.childForcedShareEok)}`}
- 특정 자녀(가족)에게 더 남기고 싶은 의향: ${answers.unequalIntent || '확인 안 됨'}
- 사업체·법인 지분율: ${sim.businessShare || '없음 또는 미상'}
- 상속인(자녀 등) 대상 사전증여 여부: ${sim.giftToHeir ? '예 (시기: '+(sim.priorGiftTiming||'미상')+', 시기와 무관하게 유류분 산정 시 전부 합산됨)':'없음 또는 미상'}
- 사전증여 추정액: ${formatEok(sim.giftAmountEok)}
- 부양·간병 등 기여 사실: ${sim.caregivingContribution || '없음 또는 미상'}
- 갈등 구체 유형: ${sim.conflictDetail || '없음'}
- 희망 전문가 분야: ${sim.expertNeed || '미정'}

이 숫자들은 정확한 세액이 아니라 "구간 추정"임을 리포트에 명시하되, 일반론이 아니라 이 숫자를 직접 인용해 계산 과정을 보여주는 방식으로 작성하세요.

[행동지침 — 매우 중요]
이 리포트의 핵심 목적은 절세가 아니라 "사용자가 원하는 자녀(가족)에게 더 많이 남길 수 있도록, 유류분 분쟁을 합법적으로 최소화하는 것"입니다. 모든 섹션을 이 목적을 중심으로 작성하세요.
"~점검이 필요합니다", "~확인이 필요합니다", "~검토하세요" 로만 끝나는 문장을 남발하지 마세요. 가능한 모든 곳에서 실제로 선택 가능한 구체적 옵션을 2~3개씩 제시하세요.
특정 자녀에게 더 남기고 싶은 의향이 있다면, 위에 제시된 "자녀 1인당 유류분 추정액" 숫자를 직접 인용해 "다른 자녀가 청구 가능한 금액은 약 OO원으로 추정되며, 이를 줄이거나 방어하려면 다음 방법을 검토할 수 있습니다"식으로 구체적으로 작성하세요.
예시: 유류분 문제라면 "① 다른 상속인에게 유류분 상당액을 사전 정산하는 방법 ② 기여분을 인정받을 증빙을 미리 확보하는 방법(2026 개정으로 기여 보상 증여는 유류분에서 제외됨) ③ 유언장에 증여 경위를 명시해두는 방법" 식으로 구체적 선택지를 나열하세요.
사업체·지분이 있다면 가업상속공제 요건(피상속인 경영기간, 상속인 가업 종사 등)을 일반론이 아니라 입력된 지분율 기준으로 적용 가능성을 언급하세요.
기여(부양·간병) 사실이 있다면 기여분 주장의 실질적 근거가 될 수 있는 자료(통장 이체내역, 진단서, 간병 영수증 등)를 구체적으로 설명하세요.
해외 영주권 상태가 "한국 국적 유지"라면, 영주권은 시민권과 다르며 한국 국적을 유지하는 한 상속에는 한국 민법이 그대로 적용된다는 점을 명확히 설명하세요. 해외로 옮긴 회사·부동산이 있다면 한국 거주자는 전세계 자산이 한국 상속세 과세대상에 합산된다는 점과 해당국 절차가 별도로 필요할 수 있다는 점을 설명하세요. 해외 증권계좌(미국·홍콩 등)가 있다면 가족관계증명서의 영문공증·아포스티유가 필요할 수 있다는 실무 팁을 포함하세요. 암호화폐가 있다면 개인 지갑 시드구문·키 정보를 안전하게 남겨두는 방법이 일반적으로 권장된다는 점을 구체적으로 설명하세요.
자녀(가족)가 외국 국적이거나 복수국적인 경우, 핵심은 "상속받을 권리가 없는 게 아니라 서류 절차가 막힌다"는 점입니다. 본인이 한국 국적을 유지하면 외국국적 자녀도 한국 민법상 동일한 상속권이 있다는 점을 먼저 설명하되, 인감증명서 대체(현지 공증+아포스티유+번역공증), 재외공관 인증만으로는 등기소가 거부하는 경우가 많다는 점, 상속인 전원 서명이 필요해 한 사람의 서류 지연이 전체를 막을 수 있다는 점을 구체적으로 설명하세요. "생전에 위임장 양식을 미리 준비해두는 방법", "자녀가 한국 방문 시 국내 공증으로 처리해두는 방법" 같이 실제로 활용되는 사전 대비책을 함께 소개하세요.
먼저 사망한 자녀가 있고 그 자녀에게 자녀(손주)가 있다면, 대습상속이 적용되어 그 손주(들)가 사망한 부모를 대신해 상속인이 된다는 점을 명확히 설명하세요. 손주가 여러 명이면 사망한 자녀의 몫을 손주들이 다시 나눠 받는다는 점, 그리고 이 경우 상속인 구성 자체가 복잡해지므로(미성년 손주가 있다면 특별대리인 선임이 필요할 수 있음) 가족관계를 미리 정확히 파악해두는 것이 중요하다는 점을 설명하세요. 먼저 사망한 자녀에게 자녀(손주)가 없다면 대습상속은 발생하지 않고 그 몫은 다른 상속인들에게 귀속된다는 점도 함께 언급하세요.
[핵심] 대습상속도 법정상속분일 뿐, 협의나 유언이 없을 때 적용되는 기본값입니다. 본인의 뜻에 따라 그 손주에게 법정상속분보다 더 남기거나 덜 남기는 것 모두 유언으로 설계할 수 있습니다. 다만 손주도 직계비속이므로 사망한 부모(자녀)의 위치를 그대로 물려받아 유류분 권리자가 되며, 유류분(법정상속분의 1/2)까지는 완전히 배제할 수 없다는 점을 명확히 설명하세요. 즉 "줄 수 있는 범위를 줄이거나 늘릴 수는 있지만, 유류분 이하로는 줄일 수 없다"는 원칙을 적용해 다른 유류분 설명과 동일한 논리로 설명하세요.
대습상속인이 될 손주가 외국 시민권이거나 복수국적인 경우, 위에서 설명한 외국국적 자녀와 동일한 서류 절차 문제(한국 인감증명서 발급 불가, 현지 공증+아포스티유+번역공증 필요, 재외공관 인증만으로는 등기소가 거부할 수 있음)가 그대로 적용된다는 점을 설명하세요. 특히 손주가 미성년자이면서 동시에 외국 국적인 경우 특별대리인 선임 절차와 서류 인증 절차가 함께 필요해 더 복잡해질 수 있다는 점도 짚어주세요.`;
  }

  const isParentPerspective = answers.perspective === '부모님 또는 배우자의 상속을 가족 입장에서 준비';

  const prompt = `안심상속 유료 상세리포트를 작성하세요.

${isParentPerspective ? '[중요] 이 사용자는 본인이 아니라 부모님(또는 배우자)의 상속을 자녀/가족 입장에서 미리 준비하고 있습니다. 리포트 전체에서 "당신의 재산"이 아니라 "부모님의 재산", "당신이 사망하면"이 아니라 "부모님이 돌아가시면" 식으로 호칭을 사용자(자녀) 기준 3인칭으로 일관되게 작성하세요. summary와 next_steps에는 "부모님과 미리 대화해보기", "부모님 의사 표현이 가능할 때 유언장 작성을 권해드리기" 같은 자녀 입장의 실행 항목을 포함하세요.' : ''}

[진단]
점수:${score}(${level}), 유형:${types.join('/')}
가족:${answers.family||'-'}, 재혼/전혼자녀:${Array.isArray(answers.remarriage)&&answers.remarriage.length&&!answers.remarriage.includes('none')?answers.remarriage.join(','):'해당없음'}, 유언:${answers.will||'-'}, 부동산:${reList}
증여:${answers.gift||'-'}, 사업:${answers.business||'-'}, 해외:${overseas}
갈등:${answers.conflict||'-'}, 자료:${answers.documents||'-'}, 채무:${answers.debt||'-'}
${ctx?'\n[참고]\n'+ctx:''}${simBlock}

아래 JSON을 정확히 따라 작성하세요. 각 배열 항목은 반드시 독립된 문자열로 작성하세요.${sim ? ' simulation 섹션은 심화설문 데이터가 있을 때만 포함하세요.' : ' simulation 섹션은 생략하세요(심화설문 데이터 없음).'}

{
  "title": "안심상속 유료 상세리포트",
  "subtitle": "내 상황에 맞춰 정리한 상속 준비 자료",
  "level": "${level}",
  "score": ${score},
  "matchedTypes": ${JSON.stringify(types)},
  "sections": {
    "summary": {
      "title": "내 상황 요약",
      "lead": "한 문장으로 현재 상황 핵심",
      "points": ["핵심사항1", "핵심사항2", "핵심사항3", "핵심사항4"]
    },${sim ? `
    "simulation": {
      "title": "내가 원하는 대로 남길 수 있는지 시뮬레이션",
      "disclaimer": "아래 수치는 입력하신 구간 정보를 바탕으로 한 단순 추정이며 실제 금액과 다를 수 있습니다. 정확한 금액은 변호사 상담이 필요합니다.",
      "asset_summary": "전체 재산·채무·순재산을 한 문단으로 정리",
      "legal_share": "배우자·자녀 법정상속분 비율과 금액을 구체 숫자로 설명 — 협의나 유언이 없을 때 강제 적용되는 '디폴트값'임을 명확히 (이것이 사용자가 원하는 분배와 다를 수 있다는 점을 강조)",
      "forced_share_check": "[가장 중요한 섹션] 사용자가 원하는 분배(특정 자녀에게 더 남기고 싶은 의향)를 실행했을 때, 다른 상속인이 유류분반환청구로 법적으로 가져갈 수 있는 정확한 금액을 구체 숫자로 제시. 그 금액을 줄이거나 방어할 수 있는 실무적 방법을 단계별로 제시. 이 리포트의 핵심 결론에 해당하는 섹션이므로 가장 구체적이고 길게 작성",
      "tax_note": "상속세는 이 리포트의 핵심이 아니므로, 참고로 과세대상 재산 구간과 대략적 공제 적용 가능성만 한두 문장으로 간단히 언급(상세 계산은 세무사 상담 권유)"
    },` : ''}
    "persons": {
      "title": "확인할 사람 관계",
      "checklist": ["항목1", "항목2", "항목3", "항목4"]
    },
    "assets": {
      "title": "재산과 채무",
      "checklist": ["항목1", "항목2", "항목3", "항목4", "항목5"]
    },
    "documents": {
      "title": "준비할 자료",
      "basic": ["서류1", "서류2", "서류3"],
      "situation_specific": ["서류1", "서류2", "서류3"]
    },
    "blind_spots": {
      "title": "놓치기 쉬운 항목",
      "items": [
        {"title": "항목명1", "content": "설명1 — 가능하면 실제 선택지 2개 이상 포함"},
        {"title": "항목명2", "content": "설명2 — 가능하면 실제 선택지 2개 이상 포함"}
      ]
    },
    "questions": {
      "title": "상담 전 질문",
      "questions": ["질문1", "질문2", "질문3", "질문4"]
    },
    "next_steps": {
      "title": "다음 순서",
      "steps": [
        {"order": 1, "title": "단계1", "content": "지금 바로 할 수 있는 구체 행동으로 작성"},
        {"order": 2, "title": "단계2", "content": "지금 바로 할 수 있는 구체 행동으로 작성"},
        {"order": 3, "title": "단계3", "content": "지금 바로 할 수 있는 구체 행동으로 작성"}
      ]
    }
  },
  "legal_notice": "이 리포트는 입력하신 정보를 바탕으로 한 일반적 상속 정보 제공 목적이며, 개별 법적·세무적 판단을 대체하지 않습니다. 유류분 시뮬레이션 수치는 추정치이며, 실제 상속세액은 공제·공시지가 변동 등으로 달라질 수 있으므로 세무사 상담을 받으세요. 외국국적 자녀·해외자산이 있는 경우, 변호사 상담이 필수입니다. 2026년 최신 법령(상속권 상실선고 제도, 기여분 인정 확대, 형제자매 유류분 폐지, 우회상속 규제, 자녀공제 5억원)을 기준으로 작성되었습니다.",
  "generated_at": "${new Date().toISOString()}"
}

규칙: JSON만 반환. 코드블록 없이. 배열 항목은 반드시 별도 문자열로. "~필요합니다/검토하세요/확인하세요"로만 끝나는 문장을 연속 사용하지 말 것 — 최소 절반 이상의 항목에는 실제 선택지나 구체적 행동을 포함할 것. 전체 리포트 톤은 담백하고 자신감 있게 작성할 것 — "정보 제공 목적", "조언을 대체하지 않습니다", "법적 책임을 지지 않습니다" 같은 방어적·면책성 표현은 절대 사용하지 말 것. 아무도 묻지 않은 책임 회피를 먼저 꺼내지 말 것.`;

  const callOnce = async (extraInstruction) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10000,
        system: '안심상속 유료 상세리포트 작성 시스템. 이 서비스의 목적은 절세가 아니라 "사용자가 원하는 자녀(가족)에게 더 많이 남길 수 있도록, 유류분 분쟁을 합법적으로 최소화하는 상속 설계를 돕는 것"임. 모든 답변은 이 목적을 중심으로 작성할 것. 법률·세무 조언 금지(단, 입력된 구간 수치 기반 단순 추정 계산 및 일반적인 법령·판례 정보 제공은 허용). "점검이 필요합니다"식 모호한 문장 대신, 가능한 곳마다 실제 선택 가능한 구체적 옵션을 제시할 것. JSON만 반환.',
        messages: [{ role: 'user', content: prompt + (extraInstruction || '') }]
      })
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}`);
    const data = await res.json();
    const text = data.content.filter(b=>b.type==='text').map(b=>b.text).join('');
    return { text, stopReason: data.stop_reason };
  };

  let first;
  try {
    first = await callOnce();
    return JSON.parse(first.text.replace(/```json|```/g,'').trim());
  } catch (parseErr) {
    console.error('1차 JSON 파싱 실패. stop_reason=' + (first && first.stopReason) + ' 응답길이=' + (first && first.text.length) + ' 원본에러=' + parseErr.message + ' - 재시도 진행');
    const retryInstruction = '\n\n[중요] 이전 응답이 너무 길어 중간에 잘렸습니다. 각 섹션의 설명을 더 간결하게 줄이고, 전체 JSON이 반드시 완전하게 끝나도록 작성하세요.';
    const second = await callOnce(retryInstruction);
    try {
      return JSON.parse(second.text.replace(/```json|```/g,'').trim());
    } catch (parseErr2) {
      console.error('2차(재시도) JSON 파싱도 실패. stop_reason=' + second.stopReason + ' 응답길이=' + second.text.length + ' 원본에러=' + parseErr2.message);
      throw parseErr2;
    }
  }
}

/* ── 메인 핸들러 ── */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ok:false,message:'Method not allowed'});
  }

  try {
    const body    = req.body||{};
    const answers = body.answers && typeof body.answers==='object' ? body.answers : {};
    const score   = Number.isFinite(Number(body.score)) ? Number(body.score) : 0;
    const deepAnswers = body.deepAnswers && typeof body.deepAnswers==='object' ? body.deepAnswers : null;
    const orderId = typeof body.orderId === 'string' ? body.orderId : null;

    /* 결제 검증: orderId가 paid_reports에 status='paid'로 존재하고 아직 리포트를 발급받지 않았는지 확인.
       이 검증이 없으면 누구나 이 엔드포인트를 직접 호출해 결제 없이 리포트를 받을 수 있음. */
    const sbUrlCheck = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/,'');
    const sbKeyCheck = process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if (!sbUrlCheck || !sbKeyCheck) {
      console.error('SUPABASE 환경변수 누락 - 결제 검증 불가');
      return res.status(500).json({ok:false,message:'서버 설정 오류입니다. 잠시 후 다시 시도해주세요.'});
    }
    if (!orderId) {
      return res.status(402).json({ok:false,message:'결제 정보가 확인되지 않았습니다. 처음부터 다시 진행해주세요.'});
    }
    try {
      const checkRes = await fetch(
        sbUrlCheck + '/rest/v1/paid_reports?order_id=eq.' + encodeURIComponent(orderId) + '&select=status,report_generated',
        { headers: { apikey: sbKeyCheck, Authorization: 'Bearer ' + sbKeyCheck } }
      );
      if (!checkRes.ok) {
        const errText = await checkRes.text().catch(() => '');
        console.error('결제 검증 조회 실패. orderId=' + orderId + ' status=' + checkRes.status + ' body=' + errText);
        return res.status(500).json({ok:false,message:'결제 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'});
      }
      const rows = await checkRes.json();
      const record = Array.isArray(rows) ? rows[0] : null;
      if (!record || record.status !== 'paid') {
        console.error('결제 기록 없음 또는 미결제 상태. orderId=' + orderId + ' found=' + JSON.stringify(rows));
        return res.status(402).json({ok:false,message:'결제가 확인되지 않았습니다. 결제 후 다시 시도해주세요.'});
      }
      if (record.report_generated) {
        return res.status(409).json({ok:false,message:'이미 이 결제로 리포트가 발급되었습니다.'});
      }
    } catch (checkErr) {
      console.error('결제 검증 중 오류:', checkErr.message);
      return res.status(500).json({ok:false,message:'결제 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'});
    }

    const types = matchTypes(answers);

    let report;
    try {
      report = await callClaude(answers, types, score, deepAnswers);
    } catch(e) {
      console.error('Claude 오류:', e.message);
      return res.status(502).json({ok:false,message:'리포트 생성 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.'});
    }

    /* 리포트 발급 완료 표시 + 리포트 본문 저장 (결제 시점에 만들어둔 같은 order_id 행을 업데이트)
       실패해도 무시 (리포트 자체는 이미 사용자에게 정상 응답됨) */
    try {
      await fetch(
        sbUrlCheck + '/rest/v1/paid_reports?order_id=eq.' + encodeURIComponent(orderId),
        {
          method: 'PATCH',
          headers: {
            apikey: sbKeyCheck,
            Authorization: 'Bearer ' + sbKeyCheck,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            report_generated: true,
            score,
            level: report.level,
            matched_types: types,
            report_json: report,
          }),
        }
      );
    } catch (markErr) {
      console.error('리포트 발급 완료 표시 실패(리포트 자체는 정상 발급됨):', markErr.message);
    }

    return res.status(200).json({ok:true,report,meta:{matchedTypes:types,score,level:report.level,generatedAt:report.generated_at}});

  } catch(e) {
    console.error('핸들러 오류:', e);
    return res.status(500).json({ok:false,message:'리포트 생성 중 오류가 발생했습니다.'});
  }
}
