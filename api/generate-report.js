/**
 * 안심상속 유료 상세리포트 자동 생성 API
 * POST /api/generate-report
 */

/* Claude API 호출(+ JSON 파싱 실패 시 1회 재시도)이 시간이 걸릴 수 있어 함수 최대 실행시간을 넉넉히 잡음 */
export const maxDuration = 180;

/* 심화진단의 일부 문항(부양·기여, 부모 방임 이력, 갈등 유형)은 복수선택이 가능해 deep[key]가
   배열로 들어올 수 있음. 기존 코드가 전부 문자열 비교/보간을 전제로 하므로, 배열이면 콤마로
   합쳐 문자열로 평탄화해서 하위 로직(===비교, 템플릿 삽입)이 그대로 동작하게 함. */
function joinAns(v) {
  if (Array.isArray(v)) return v.length ? v.join(', ') : null;
  return v || null;
}

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
function buildSimulation(deep, freeAns) {
  if (!deep || typeof deep !== 'object' || !Object.keys(deep).length) return null;
  freeAns = freeAns && typeof freeAns === 'object' ? freeAns : {};

  const assetMidpoint = {
    '5억 미만': 2.5, '5억~10억': 7.5, '10억~30억': 20,
    '30억~100억': 65, '100억 이상': 150, '정확한 금액은 모르겠음': null
  };
  const finMidpoint = {
    '1억 미만': 0.5, '1억~3억': 2, '3억~5억': 4, '5억~10억': 7.5,
    '10억~30억': 20, '30억~50억': 40, '50억 이상': 70, '정확한 금액은 모르겠음': null
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

  /* 데이터 정합성 점검 (A+B 방식)
     B: financialAssets 구간이 50억 이상까지 확장돼 코인·주식 거액 보유자가 금액을 정확히 표현 가능.
     A: 무료설문에서 코인/해외주식/국내주식을 보유했다고 체크한 경우, 부동산 없이 거액이어도
        금융자산으로 설명되므로 모순이 아님(정상 인정). 요즘 코인·미국주식으로 부동산 없이
        수십억~100억대 자산가가 실제로 존재하기 때문.
     모순으로 보는 경우: 부동산 시가 입력이 없고(realEstateEok==null), 무료설문에 금융투자 신호도 없는데,
        전체 재산이 금융+해외 합산으로 설명되는 최대치를 5억 넘게 초과 → 입력 누락 가능성. */
  const finEok = finMidpoint[deep.financialAssets] ?? 0;
  const freeTypes = Array.isArray(freeAns.assetTypes) ? freeAns.assetTypes : [];
  const hasFinancialInvest = freeTypes.indexOf('crypto') >= 0
    || freeTypes.indexOf('overseas_stock') >= 0
    || freeTypes.indexOf('kr_stock') >= 0;
  const explainableMax = (realEstateEok || 0) + (finEok || 0) + (overseasEok || 0);
  const assetMismatch = totalEok != null && realEstateEok == null && !hasFinancialInvest
    && totalEok > explainableMax + 5; /* 금융투자 신호 없고 5억 이상 차이나면 입력 누락으로 간주 */

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
    realEstateEok, hasOverseasAsset, overseasEok, finEok, assetMismatch,
    realEstateCount: deep.realEstateCount || null,
    overseasAssetType: deep.overseasAssetType || null,
    spouseNationality: deep.spouseNationality || null,
    parentNeglect: joinAns(deep.parentNeglect),
    childrenNationality: deep.childrenNationality || null,
    predeceasedChild: deep.predeceasedChild || null,
    grandchildrenNationality: deep.grandchildrenNationality || null,
    spouseAlive, spouseEstranged, spouseCommonLaw, childCount, shareText, inheritanceTier,
    spouseShareEok, childShareEok, spouseForcedShareEok, childForcedShareEok,
    giftToHeir, giftAmountEok, priorGiftTiming: deep.priorGiftTiming || null,
    businessShare: deep.businessShare || null,
    foreignNatChildren: deep.foreignNatChildren || null,
    caregivingContribution: joinAns(deep.caregivingContribution),
    conflictDetail: joinAns(deep.conflictDetail),
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
  const hasFarmland = presence.includes('farmland');
  const hasIncomeRE = presence.includes('incomeRealEstate');

  if (a.unequalIntent==='있음 — 이미 마음을 정함' || a.unequalIntent==='있음 — 아직 확신은 없음') {
    lines.push('핵심: 특정 자녀(가족)에게 더 남기고 싶은 의향이 있는 경우, 단순히 유언장에 "더 준다"고만 적으면 다른 상속인이 유류분반환청구로 법정상속분의 1/2(직계비속·배우자 기준)까지는 결국 가져갈 수 있음. 따라서 "내 뜻대로 더 주는 것"을 실질적으로 지키려면 유류분 자체를 줄이는 합법적 설계(기여분 입증, 시효 활용, 사전 협의)가 함께 필요함. 이것이 일반적인 절세 상담과 다른, 이 리포트의 핵심 목적임.');
  }
  if (hasForeignNat) {
    lines.push('핵심: 자녀(가족)가 외국 국적인 경우, 본인(피상속인)이 한국 국적을 유지한다면 상속 자체는 한국 민법이 그대로 적용되어 상속권 자체는 보장됨(국제사법 제77조, 본국법주의). 문제는 권리가 아니라 "실행 절차". 외국국적 자녀는 한국 인감증명서를 발급받을 수 없어, 상속재산분할협의서나 위임장에 서명할 때 현지 공증인의 서명인증서와 아포스티유 인증, 공증된 한국어 번역문을 모두 갖춰야 함. 한국 재외공관(영사관)의 사서증서 인증만으로는 등기소·법원이 접수를 거부하는 경우가 실무상 많아, 이를 모르고 영사관에서 처리하려다 서류가 반려되는 사례가 흔함.');
    lines.push('상속재산분할협의서는 상속인 전원의 서명이 있어야 효력이 있어, 외국국적 자녀 한 명의 서류만 늦어져도 전체 절차가 멈춤. 국제우편 왕복, 번역공증까지 고려하면 통상 3개월 이상 걸릴 수 있어, 균등하게 또는 원하는 대로 나누고 싶어도 실제로는 한 사람 때문에 전체가 지연되는 경우가 많음. 생전에 위임장 양식을 미리 준비해두거나 자녀가 한국 방문 시 국내 공증으로 처리해두면 이런 지연을 막을 수 있음.');
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
    lines.push('[핵심] 가족관계증명서에 등재되지 않은 자녀(혼외자 등)가 있다면, 그 자녀가 친자로 "인지"되는 순간 다른 자녀들과 완전히 동일한 법정상속분을 갖게 됨. 인지는 본인이 생전에 스스로 할 수도 있고(임의인지), 본인 사후에 그 자녀가 유전자 검사 등을 통해 법원에 인지청구소송을 제기해 강제로 인정받을 수도 있음(사망 사실을 안 날로부터 2년 이내). 더 중요한 점은, 다른 상속인들이 이미 상속재산분할을 끝낸 뒤에 그 자녀가 인지되더라도 법적으로는 자신의 상속분에 해당하는 금액을 다른 상속인들에게 청구할 수 있다는 것(민법 제1014조) — 즉 이미 끝난 상속도 나중에 다시 흔들릴 수 있음. 이 문제를 사전에 분명히 하는 방법으로는 ① 본인이 생전에 그 자녀를 임의인지해 상속인 범위를 명확히 하는 방법 ② 유언장에 해당 자녀에 대한 입장을 명시해두는 방법이 효과적이며, 어느 쪽이든 변호사와의 상담을 통한 개별 확인이 필요한 영역이라는 점을 신중하고 담담한 톤으로 설명하세요.');
  }
  if (sim && sim.spouseEstranged) {
    lines.push('[핵심] 배우자와 별거 중이거나 이혼소송이 진행 중이지만 아직 정식으로 이혼이 확정되지 않았다면, 사망 당시 법률상 혼인관계만 유효하면 그것으로 충분하므로 배우자는 법정상속인 자격을 100% 그대로 유지함. 별거 기간이 길거나 사실상 관계가 끝났다고 느끼는 것은 법적 효력에 전혀 영향을 주지 않으며, 이는 본인의 의향과 무관하게 적용되는 강력한 기본값이라는 점을 분명히 설명하세요. 이를 원하지 않는다면 ① 이혼 절차를 사망 전에 완료하는 방법 ② 유언장으로 배우자의 몫을 유류분(법정상속분의 1/2) 수준까지로 최소화하는 방법(유류분 이하로는 줄일 수 없음)이 활용될 수 있다는 점을 구체적으로 설명하세요.');
  }
  if (sim && sim.spouseCommonLaw) {
    lines.push('[핵심] 혼인신고를 하지 않은 사실혼 관계(동거 포함)는 우리 민법상 상속권이 전혀 인정되지 않음 — 아무리 오래 함께 살았어도 법률혼 배우자와 달리 법정상속인이 될 수 없음. 사실혼 배우자에게 재산을 남기고 싶다면 반드시 유언장에 유증(특정인에게 재산을 남긴다는 명시)을 해야 하며, 그렇지 않으면 사실혼 배우자는 상속에서 완전히 배제됨. 다만 임대차보호법상 임차인 지위 승계, 일부 사회보험(산재·국민연금 등)에서는 사실혼 배우자도 보호받을 수 있다는 점은 별개로 설명하세요. 가장 확실한 보호 방법은 혼인신고이며, 그것이 어렵다면 유언장 작성이 사실상 필수에 가깝다는 점을 분명히 설명하세요.');
  }
  if ((deep && deep.testatorHealth || a.testatorHealth) === '인지 능력 저하가 진행 중(치매 진단 등)') {
    lines.push('[핵심] 유언장을 작성하는 사람의 의사능력(인지능력)이 저하된 상태라면, 추후 다른 상속인이 "유언 당시 정상적인 판단이 불가능했다"는 이유로 유언무효확인소송을 제기할 수 있음 — 실제로 유언 효력 분쟁에서 가장 흔한 사유 중 하나임. 법원은 보통 진단서·인지기능검사 결과(MMSE 등), 유언 작성 시점과 진단 시점의 선후관계, 유언 내용의 합리성(특정인에게 유독 유리한지) 등을 종합적으로 살펴봄. 실무에서 의사능력 분쟁 가능성을 낮추는 데 효과적인 방법으로는 ① 공정증서에 의한 유언(공증인과 증인 2인이 직접 확인하는 방식이라 자필증서보다 분쟁 시 효력을 인정받기 유리함) ② 유언 작성과 가까운 시점에 의사의 진단서나 소견서를 함께 받아 보관 ③ 가능하다면 작성 과정을 영상으로 남기는 방법 등이 있음. 다만 인지능력 저하의 정도가 이미 상당히 진행된 경우라면 유언 자체의 법적 효력이 처음부터 의심받을 수 있으므로, 이 부분은 명확히 짚어주되 변호사·의료진과의 상담을 통한 개별 판단이 필요하다는 점을 분명히 설명하세요.');
  } else if ((deep && deep.testatorHealth || a.testatorHealth) === '가벼운 건망증 등 경미한 변화가 있음') {
    lines.push('참고: 가벼운 인지 변화가 있는 단계에서는 통상 유언 능력 자체는 인정되는 경우가 많지만, 시간이 지날수록 의사능력 입증이 더 어려워질 수 있음. 작성 시점을 너무 늦추지 않는 것이 안전하며, 위와 같이 공정증서 유언 방식을 활용하면 분쟁 가능성을 낮추는 데 효과적이라는 점을 간단히 설명하세요.');
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
    lines.push('해외로 옮긴 부동산·사업체(싱가포르·미국 등)도 피상속인이 한국 국적이면 한국 민법상 상속재산에 포함되며, 유류분 산정 기초재산에도 합산됨. 해당국 절차와 한국 절차가 동시에 필요해 분배 실행이 늦어질 수 있으므로 미리 준비해두는 것이 안전함.');
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
    lines.push('법인 지분은 정관·주주간 계약 확인 필요. 경영을 맡을 특정 자녀에게 지분을 몰아주려는 경우, 다른 자녀의 유류분 침해 가능성이 매우 높음(지분 평가액이 커서). 가업상속공제(현재 최대 600억)는 상속세 부담을 줄여줄 뿐 유류분 문제 자체를 해결하지 않으므로, 별도로 유류분 대응 설계가 필요함. 또한 2026년 하반기 세법 개정안에서 대상 업종 축소·경영기간 요건 상향 등 제도 개편이 예고되어 있어, 진행 시점의 최신 시행 여부를 확인해두는 것이 안전함.');
  }
  if (a.conflict==='이미 뚜렷함') {
    lines.push('갈등이 있는 경우 유언장 등 문서화가 핵심. 협의 분할 과정에서 갈등 표면화 가능.');
  }
  if (hasLand) {
    lines.push('토지는 현금과 달리 물리적으로 똑같이 나누기 어려워, 공유지분 형태로 상속되는 경우가 많음. 공유지분 상태에서는 처분·개발 시 상속인 전원의 동의가 필요해 한 명이라도 반대하면 장기간 묶이는 경우가 흔함. 특정 자녀에게 토지를 온전히 남기고 싶다면, 다른 자녀에게 유류분 상당액을 현금이나 다른 재산으로 미리 정산해두는 방식이 효과적임.');
  }
  if (hasFarmland) {
    lines.push('[핵심] 농지(밭·논·과수원)도 토지와 마찬가지로 현금처럼 똑같이 나누기 어려워 공유지분 형태로 상속되는 경우가 많고, 공유지분 상태에서는 처분 시 상속인 전원의 동의가 필요해 한 명이라도 반대하면 장기간 묶일 수 있음. 특정 자녀에게 농지를 온전히 남기고 싶다면 다른 자녀에게 유류분 상당액을 현금 등으로 미리 정산해두는 방식이 효과적이며, 여기에 더해 농지법의 적용을 받는다는 점도 함께 고려해야 함. 좋은 소식은, 상속(유증 포함)으로 농지를 받는 경우에는 농지취득자격증명 없이 바로 등기가 가능해 일반 매매보다 절차가 오히려 간단함(농지법 제8조제1항 단서). 다만 직접 농사짓지 않는 상속농지는 전체 합산 1만㎡(1ha)까지만 자격증명 없이 계속 보유할 수 있고, 그 이상은 직접 경작하거나 처분해야 함 — 한국농어촌공사(농지은행)에 임대를 위탁하면 면적 제한 없이 계속 보유 가능함. 또한 피상속인(부모님 등)이 8년 이상 직접 경작한 농지라면, 상속받은 날로부터 3년 이내에 매도하면 상속인이 직접 농사를 짓지 않아도 양도소득세를 100% 감면받을 수 있음(연 1억원, 5년간 2억원 한도). 이 3년 기한을 넘기면 감면을 받기 위해 상속인이 직접 1년 이상 경작해야 하므로, 농사를 지을 계획이 없는 상속인이라면 3년 이내 매각 여부를 미리 정해두는 것이 중요함.');
  }
  if (hasIncomeRE) {
    lines.push('임대 목적 상가·건물은 임대수익이 함께 따라오므로, 단순 시가뿐 아니라 누가 임대관리·수익을 가져갈지도 분쟁 요소가 됨. 상속 후 공동소유 상태로 두면 임대료 배분, 관리비용 부담, 매각 여부를 둘러싸고 형제간 갈등이 길어지는 경우가 많아 미리 관리 방식(단독 상속 후 정산 vs 공동관리)을 정해두는 것이 중요함.');
  }
  if (deep.realEstateCount === '2건' || deep.realEstateCount === '3~4건' || deep.realEstateCount === '5건 이상') {
    lines.push('부동산이 여러 건이면, 단순히 시가 합계를 균등하게 나누는 것과 실제로 "어떤 부동산을 누가 가져가는지"는 전혀 다른 문제임. 같은 합계 금액이라도 입지·환금성·관리부담이 부동산마다 다르므로, 특정 자녀가 선호하는 부동산을 두고 다툼이 생기기 쉬움. 부동산별로 누구에게 남길지 미리 지정해두고, 가치 차이는 다른 재산이나 현금으로 조정하는 방식이 효과적임.');
  }
  if (a.conflict==='조금 있음') {
    lines.push('지금은 사이가 괜찮아 보여도, 실제 상속 협의 과정에서 분배 비율에 대한 미묘한 입장 차이가 표면화되는 경우가 많음. 사전에 분배 기준을 명확히 문서화해두는 것이 갈등 예방에 효과적.');
  }
  if (a.conflict==='없음') {
    lines.push('현재 갈등이 없더라도, 상속재산분할 소송은 2024년 처음 3,000건을 넘어 10년 새 3.6배로 늘었고 그중 82.7%가 1억원 이하 소액 분쟁이라는 통계가 있음. 사이가 좋은 가족도 막상 상속이 개시되면 입장이 달라질 수 있으므로 미리 정리해두는 것이 안전함.');
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
  const sim   = buildSimulation(deepAnswers, answers);
  const ctx   = getContext(answers, types, deepAnswers, sim);

  const presence = Array.isArray(answers.assetPresence)?answers.assetPresence:[];
  const counts   = answers.assetCounts||{};
  const reTypeLabel = {house:'주택',land:'토지',farmland:'농지',incomeRealEstate:'수익형부동산(상가등)',factory:'공장·창고',otherRealEstate:'기타부동산'};
  const reList   = ['house','land','farmland','incomeRealEstate','factory','otherRealEstate']
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
${sim.assetMismatch ? `
[⚠️ 데이터 정합성 경고 — 반드시 반영]
입력값에 따르면 부동산이 없다고 했는데 전체 재산(${formatEok(sim.totalEok)})이 금융자산·해외자산 합계로 설명되는 금액(약 ${formatEok(sim.finEok + (sim.overseasEok||0))})을 크게 초과합니다. 즉 재산 구성 입력에 빠진 부분이 있을 가능성이 높습니다. 이 경우 리포트는 다음을 지켜 작성하세요: ①유류분·법정상속분 추정액은 전체 재산 총액 기준으로 계산하되, "재산 구성 입력에 빈 부분이 있어 총액 기준으로 추정했다"는 점을 분배 비교(distribution)와 재산·채무(assets) 섹션에 자연스럽게 명시. ②부동산·금융·사업자산 중 빠진 항목이 있는지 다시 확인하도록 권하는 안내를 assets 섹션에 포함. ③다만 사용자가 실제로 현금·금융자산만 거액 보유한 경우일 수도 있으므로 단정하지 말고 "다시 확인해보시라"는 부드러운 어조로.` : ''}

이 숫자들은 정확한 세액이 아니라 "구간 추정"임을 리포트에 명시하되, 일반론이 아니라 이 숫자를 직접 인용해 계산 과정을 보여주는 방식으로 작성하세요.`;
  }

  /* 행동지침: 사용자 상황에 해당하는 것만 포함 (속도 최적화) */
  const hasOverseas    = sim && sim.hasOverseasAsset;
  const hasForeignKids = sim && sim.foreignNatChildren && sim.foreignNatChildren !== '0명';
  const hasPredecease  = sim && sim.predeceasedChild && sim.predeceasedChild !== '없음';
  const hasBusiness    = sim && sim.businessShare && sim.businessShare !== '없음 또는 미상';
  const hasCaregive    = sim && sim.caregivingContribution && sim.caregivingContribution !== '없음 또는 해당없음';
  const hasUnequalIntent = answers.unequalIntent && answers.unequalIntent !== '없음' && answers.unequalIntent !== '확인 안 됨';

  const conditionalInstructions = [
    '문장은 친구인 변호사가 저녁 식사 자리에서 설명하는 어투로 쓰세요. 딱딱한 법률 문서 어투 금지. "~해야 합니다" 대신 "~해두면 좋습니다", "지금 당장 할 수 있는 건 ~입니다" 식으로.',
    '법률 용어는 반드시 바로 뒤에 괄호로 쉬운 설명을 붙이세요. 예: 유류분(다른 상속인이 법적으로 최소한 받아야 하는 몫), 기여분(더 많이 돌봤다는 걸 인정받아 더 받는 것), 대습상속(자녀가 먼저 사망했을 때 손주가 대신 받는 것).',
    '서류 이름은 단독으로 쓰지 말고 "어떻게 받는지"를 함께 쓰세요. 예: "등기부등본 → 대법원 인터넷등기소(iros.go.kr)에서 바로 출력 가능", "가족관계증명서 → 주민센터 또는 정부24에서 발급".',
    '절차가 복잡할 때는 번호를 붙여 단계별로 쪼개주세요. "①현지에서 공증 → ②아포스티유 첨부(나라마다 이름이 다른 국제 인증 스탬프) → ③한국어로 번역해서 공증" 처럼.',
    hasUnequalIntent ? '특정 자녀에게 더 남기고 싶은 의향이 있으므로, simulation의 분배 비교 4단(my_wish→if_no_action→gap→after_defense)을 이 리포트의 심장으로 삼아 가장 공들여 쓰세요. if_no_action에는 "지금 그대로면 다른 자녀가 법적으로 돌려달라고 청구할 수 있는 금액은 약 OO원으로 추정됩니다"를 추정 금액을 직접 인용해 쓰고, after_defense와 defense_options에는 "약 X억 → 약 Y억"처럼 방어 후 금액이 줄어드는 수치 변화를 반드시 넣으세요. 2026년 개정으로 유류분은 부동산 지분이 아니라 현금(가액)으로 반환되므로, 현금·보험으로 정산 재원만 마련하면 부동산·사업체 자체는 온전히 지킬 수 있다는 점을 핵심 방어 논리로 쓰세요.' : '특정 자녀에게 더 주려는 의향이 뚜렷하지 않으므로, simulation의 분배 비교에서 분배 자체의 다툼 소지는 낮다고 솔직히 안심시키되, gap과 if_no_action은 분쟁이 아니라 실제 위험(외국국적 자녀 서류 지연으로 균등 분배조차 수개월 묶임, 공유 부동산 교착, 디지털자산 접근 불가 등)으로 잡고 after_defense에는 "수개월 지연 → 수주"처럼 기간이 줄어드는 변화를 쓰세요.',
    hasBusiness ? '사업체·지분이 있으므로: 사업을 물려받을 자녀가 실제로 그 사업에 몇 년 이상 일했느냐에 따라 세금을 크게 줄일 수 있는 제도(가업상속공제)가 있다고 쉽게 설명하세요. 세무사 상담이 꼭 필요하다는 점도 덧붙이세요.' : null,
    hasCaregive ? '부양·간병 기여가 있으므로: "더 돌봤다는 걸 나중에 법적으로 인정받으려면 지금부터 기록을 남겨야 합니다"라고 설명하고, 구체적으로 어떤 기록인지(통장 이체 내역, 병원 영수증, 주민등록 등본으로 같이 산 기간 증명 등)를 알기 쉽게 나열하세요.' : null,
    hasOverseas ? '해외 자산이 있으므로: "해외에 있는 재산도 한국 상속세 신고 대상입니다"라고 먼저 명확히 쓰고, 나라별로 별도 절차가 필요할 수 있다는 점을 설명하세요. 해외 주식계좌가 있다면 가족관계증명서를 영문으로 번역·공증해야 해외 금융기관에서 처리해준다는 실무 팁을 포함하세요.' : null,
    hasForeignKids ? '외국 국적 자녀가 있으므로: "상속받을 권리는 한국 자녀와 똑같습니다. 다만 서류 준비가 더 복잡합니다"라고 먼저 안심시킨 뒤, ①현지 공증 → ②국제 인증(아포스티유, 나라마다 이름이 다른 공식 도장) → ③한국어 번역 공증, 이 3단계가 필요하다고 설명하세요. 지금 미리 위임장(한국 대리인이 대신 처리할 수 있는 서류)을 준비해두면 나중에 자녀가 한국에 못 와도 처리할 수 있다는 팁도 넣으세요.' : null,
    hasPredecease ? '자녀 중 먼저 세상을 떠난 분이 있으므로: "그 자녀의 몫은 없어지지 않습니다. 그 자녀의 자녀(손주)가 대신 받게 됩니다"라고 먼저 설명하세요. 손주가 미성년자라면 법원에서 대신 처리해줄 어른(특별대리인)을 지정받아야 한다는 점도 쉽게 설명하세요.' : null,
  ].filter(Boolean).join('\n');

  const isParentPerspective = answers.perspective === '부모님 또는 배우자의 상속을 가족 입장에서 준비';
  const perspectiveNote = isParentPerspective ? '[중요] 이 사용자는 부모님(또는 배우자)의 상속을 자녀/가족 입장에서 준비하고 있습니다. 3인칭으로 일관되게 작성하세요.\n' : '';

  /* 공통 컨텍스트 — 두 파트 모두에 동일하게 들어감 */
  const commonCtx = `${perspectiveNote}
[진단]
점수:${score}(${level}), 유형:${types.join('/')}
가족:${answers.family||'-'}, 재혼/전혼자녀:${Array.isArray(answers.remarriage)&&answers.remarriage.length&&!answers.remarriage.includes('none')?answers.remarriage.join(','):'해당없음'}, 유언:${answers.will||'-'}, 부동산:${reList}
증여:${answers.gift||'-'}, 사업:${answers.business||'-'}, 해외:${overseas}
갈등:${answers.conflict||'-'}, 자료:${answers.documents||'-'}, 채무:${answers.debt||'-'}
${ctx?'\n[참고]\n'+ctx:''}${simBlock}

[행동지침]
${conditionalInstructions}`;

  const systemMsg = '안심상속 유료 상세리포트 작성 시스템. 목적: "사용자가 원하는 자녀(가족)에게 더 많이 남길 수 있도록 유류분 분쟁을 합법적으로 최소화하는 상속 설계를 돕는 것". 절세는 부차정보이고, "내 뜻대로 분배가 지켜지는가"와 유류분이 항상 메인. 법률·세무 조언 금지(구간 추정 계산 및 일반적 법령·판례 정보 제공은 허용). JSON만 반환. 코드블록 없이. 배열 항목은 반드시 별도 문자열로. [방어수단 원칙] 비용이 낮은 순서로 권할 것: 유언 → 사전증여 → 보험 → 신탁. 신탁은 최소가입금액이 커서 순재산이 작은 사용자에겐 권하지 말 것. [2026년 개정 법령 — 정확 반영] ①형제자매 유류분은 폐지됨(2024.4.25 위헌, 즉시 효력 상실), 형제가 상속인이어도 유류분 청구 불가. ②유류분 반환은 원물(부동산 지분 그 자체)이 아니라 가액(현금)으로 반환하도록 개정됨 — 부동산·사업체를 물려줘도 상대는 돈으로 받으므로, 현금·보험으로 미리 정산 재원을 마련하면 부동산·사업체 자체는 지킬 수 있음(핵심 방어 논리). ③부양·간병 기여 보상으로 준 증여는 유류분 반환 대상에서 제외될 수 있음(2026.1.1 이후 개시 상속). ④패륜 상속인은 상속권 상실 선고로 유류분권도 잃을 수 있음(2026.1.1 시행). [상속세 — 정확 반영] 자녀공제 1인 5억 확대안과 최고세율 50%→40% 인하안은 2026년 현재 국회 미통과/부결 상태이므로, 통과된 것처럼 쓰지 말 것. 현행 기준(자녀공제 1인 5천만원, 일괄공제 5억, 배우자공제 최소 5억~최대 30억, 최고세율 50%)으로 안내하되, 배우자+자녀 동시 상속 시 통상 약 10억(일괄 5억+배우자 최소 5억) 공제로 단순 추정할 수 있음. 가상자산(암호화폐) 양도소득 과세는 2027년으로 연기됨. 절대 금지 사항: ①"무료진단", "심화설문", "딥서베이", "리포트", "시스템", "모순", "데이터 불일치" 등 내부 시스템 용어를 고객에게 보이는 텍스트에 절대 사용하지 말 것. ②"(들)", "(또는 ~)" 같은 프롬프트 작성 스타일 표현 사용 금지. ③"가족과 함께", "자녀에게 보여주세요" 등 본인 외 공유를 전제하는 표현 금지(본인만 조용히 확인하는 서비스). ④고객이 시스템 내부 구조를 알 수 있는 어떤 표현도 금지. 고객 입장에서 자연스럽고 전문적인 어조로만 작성할 것.';

  /* ── 파트 A: 핵심 분석 섹션 (summary + simulation + persons + assets) ── */
  const promptA = `${commonCtx}

아래 JSON 파트 A를 작성하세요. 각 배열 항목은 반드시 독립된 문자열로 작성하세요.${sim ? ' simulation 섹션은 심화설문 데이터가 있으므로 포함하세요.' : ' simulation 섹션은 생략하세요(심화설문 데이터 없음).'}

{
  "summary": {
    "title": "내 상황 요약",
    "lead": "한 문장으로 현재 상황 핵심",
    "points": ["핵심사항1", "핵심사항2", "핵심사항3", "핵심사항4"]
  },${sim ? `
  "simulation": {
    "title": "내 뜻대로 남길 수 있는지 — 분배 비교",
    "disclaimer": "아래 금액은 입력하신 구간 정보를 바탕으로 한 단순 추정이며 실제 금액과 다를 수 있습니다. 정확한 금액은 변호사 상담이 필요합니다.",
    "asset_summary": "전체 재산·채무·순재산을 한 문단으로 정리",
    "legal_share": "배우자·자녀 법정상속분 비율과 금액을 구체 숫자로 설명",
    "my_wish": "[분배 비교 1단] 사용자가 원하는 분배 의도를 사용자 입장의 자연스러운 문장으로 1~2문장 재진술. 예: '회사에 5년 일한 장남에게 법인지분과 공장을, 차남에게는 상가와 현금을 남기고 싶어 하십니다.' 특정 자녀에게 더 주려는 의향이 없거나 갈등 소지가 낮으면 '균등하게, 다툼 없이 남기고 싶어 하십니다'처럼 솔직히 재진술.",
    "if_no_action": "[분배 비교 2단] 지금 아무 준비(유언·증여 등) 없이 상속이 개시되면 실제로 어떻게 쪼개지는지를 위 시뮬레이션 숫자를 직접 인용해 구체 금액으로. 유류분 청구가 작동하는 경우 누가 약 얼마를 청구할 수 있는지 명시. 갈등 소지가 낮은 경우엔 분배 자체보다 '절차가 막히는 지점'(예: 외국국적 자녀 서류 지연, 공유 부동산 교착, 디지털자산 접근 불가)을 실제 위험으로 제시.",
    "gap": "[분배 비교 3단] 내 뜻과 실제 결과가 어긋나는 핵심 지점 한 문장. 날카롭고 짧게. 갈등이 낮으면 분쟁이 아니라 절차 교착 등 실제 위험을 한 문장으로.",
    "after_defense": "[분배 비교 4단] 아래 방어수단을 적용했을 때 분배가 어떻게 의도에 가까워지는지. 반드시 '약 X억 → 약 Y억' 또는 '수개월 지연 → 수주'처럼 수치·기간이 바뀌는 형태로. 2026년 개정으로 유류분은 부동산 지분이 아니라 가액(현금)으로 반환되므로, 현금·보험으로 정산 재원을 미리 마련하면 부동산·사업체 자체는 지킬 수 있다는 점을 적극 활용해 설명.",
    "defense_options": "[방어수단 — 비용 낮은 순서로 배열. 각 항목은 {\"name\":\"수단명\",\"cost\":\"낮음/중간/높음\",\"effect\":\"약 X억 → 약 Y억 형태의 수치 변화\",\"note\":\"어디서 어떻게 하는지\"}. 비용 오름차순: 유언장 → 사전증여 → 보험 → 신탁. 순재산이 작으면(예: 5억 미만) 신탁은 넣지 말 것. 해당 사용자에게 과한 수단은 제외.]",
    "forced_share_check": "[하위호환용] my_wish~after_defense를 한 문단으로 요약한 텍스트. 위 4단을 합쳐 자연스러운 한 문단으로.",
    "tax_note": "과세대상 재산 구간과 대략적 공제 적용 가능성만 한두 문장으로 간단히 언급(부차정보)"
  },` : ''}
  "persons": {
    "title": "확인할 사람 관계",
    "checklist": ["항목1", "항목2", "항목3", "항목4"]
  },
  "assets": {
    "title": "재산과 채무",
    "checklist": ["항목1", "항목2", "항목3", "항목4", "항목5"]
  }
}

규칙: JSON만 반환. 코드블록 없이. 각 항목은 2~3문장으로 간결하게 작성하세요. 불필요하게 길게 쓰지 마세요.`;

  /* ── 파트 B: 실행 섹션 (documents + blind_spots + questions + next_steps) ── */
  const promptB = `${commonCtx}

아래 JSON 파트 B를 작성하세요. 각 배열 항목은 반드시 독립된 문자열로 작성하세요.

{
  "documents": {
    "title": "준비할 자료",
    "basic": ["서류1", "서류2", "서류3"],
    "situation_specific": ["서류1", "서류2", "서류3"]
  },
  "blind_spots": {
    "title": "놓치기 쉬운 항목",
    "items": [
      {"title": "항목명1", "content": "설명1"},
      {"title": "항목명2", "content": "설명2"},
      {"title": "항목명3", "content": "설명3"}
    ]
  },
  "questions": {
    "title": "상담 전 질문",
    "questions": ["질문1", "질문2", "질문3", "질문4"]
  },
  "next_steps": {
    "title": "다음 순서",
    "steps": [
      {"order": 1, "title": "단계1", "content": "지금 바로 할 수 있는 구체 행동"},
      {"order": 2, "title": "단계2", "content": "지금 바로 할 수 있는 구체 행동"},
      {"order": 3, "title": "단계3", "content": "지금 바로 할 수 있는 구체 행동"}
    ]
  }
}

규칙: JSON만 반환. 코드블록 없이. 각 항목은 2~3문장으로 간결하게 작성하세요. 불필요하게 길게 쓰지 마세요.`;

  const callPart = async (prompt, partName) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 7000,
        system: systemMsg,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error(`Claude API ${partName} ${res.status}`);
    const data = await res.json();
    const text = data.content.filter(b=>b.type==='text').map(b=>b.text).join('');
    try {
      return JSON.parse(text.replace(/```json|```/g,'').trim());
    } catch(e) {
      console.error(`${partName} JSON 파싱 실패. 길이=${text.length} 에러=${e.message}`);
      throw new Error(`${partName} 파싱 실패`);
    }
  };

  /* 파트 A와 B를 병렬로 동시 생성 — 순차 생성 대비 ~50% 시간 단축 */
  const [partA, partB] = await Promise.all([
    callPart(promptA, 'partA'),
    callPart(promptB, 'partB')
  ]);

  return {
    title: '안심상속 유료 상세리포트',
    subtitle: '내 상황에 맞춰 정리한 상속 준비 자료',
    level,
    score,
    matchedTypes: types,
    sections: {
      summary:    partA.summary,
      ...(partA.simulation ? { simulation: partA.simulation } : {}),
      persons:    partA.persons,
      assets:     partA.assets,
      documents:  partB.documents,
      blind_spots: partB.blind_spots,
      questions:  partB.questions,
      next_steps: partB.next_steps,
    },
    legal_notice: '이 리포트는 입력하신 정보를 바탕으로 한 일반적 상속 정보 제공 목적이며, 개별 법적·세무적 판단을 대체하지 않습니다. 유류분 시뮬레이션 수치는 추정치이며, 실제 상속세액은 공제·공시지가 변동 등으로 달라질 수 있으므로 세무사 상담을 받으세요. 형제자매 유류분 폐지(2024.4.25 위헌), 구하라법 상속권 상실선고 제도(2026.1.1 시행), 기여 보상 증여의 유류분 반환 제외 등 최근 개정 사항을 반영했습니다. 상속세 자녀공제 확대(1인 5억) 및 최고세율 인하 등은 2026년 현재 국회를 통과하지 않아 반영하지 않았으며, 현행 공제(일괄공제 5억, 배우자공제 최소 5억) 기준으로 안내합니다. 세법은 개정 논의가 진행 중이므로 신고 시점에 최신 내용을 확인하세요.',
    generated_at: new Date().toISOString()
  };
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
        sbUrlCheck + '/rest/v1/paid_reports?order_id=eq.' + encodeURIComponent(orderId) + '&select=status,report_generated,report_json,score,level,matched_types,created_at',
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
        /* 모바일에서 리포트 생성 중 다른 앱으로 나갔다 오는 등으로 재요청이 들어와도 에러 없이
           기존에 저장해둔 리포트를 그대로 돌려줌. 결제 1건당 리포트는 같은 내용을 몇 번이든
           다시 받을 수 있어야 함 — 단, 결제일로부터 30일이 지나면 더 이상 제공하지 않음. */
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const createdAt = record.created_at ? new Date(record.created_at).getTime() : 0;
        if (createdAt && (Date.now() - createdAt) > THIRTY_DAYS_MS) {
          return res.status(410).json({ok:false,message:'발급일로부터 30일이 지나 더 이상 조회할 수 없습니다.'});
        }
        if (!record.report_json) {
          /* 저장 단계에서 실패했던 구버전 데이터 등 report_json이 없는 예외 케이스 */
          return res.status(409).json({ok:false,message:'이미 이 결제로 리포트가 발급되었으나 저장된 내용을 찾을 수 없습니다. 안심상속에 문의해주세요.'});
        }
        return res.status(200).json({
          ok:true,
          report:record.report_json,
          meta:{matchedTypes:record.matched_types||[],score:record.score||0,level:record.level||'',generatedAt:record.report_json.generated_at}
        });
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
