/**
 * 안심상속 유료 상세리포트 자동 생성 API
 * POST /api/generate-report
 */

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
  const business = a.business || '';
  const conflict = a.conflict || '';
  const docs     = a.documents|| '';
  const overseas = Array.isArray(a.overseas) ? a.overseas : [];
  const presence = Array.isArray(a.assetPresence) ? a.assetPresence : [];
  const hasRE    = presence.some(v => !['none','unknown'].includes(v));

  if (family==='배우자와 자녀가 있음')           { add('T01',40); }
  if (family==='재혼가정 또는 전혼 자녀가 있음') { add('T04',50); add('T05',40); add('T13',20); }
  if (family==='자녀가 없거나 형제자매와 관련될 수 있음') { add('T02',30); add('T03',40); }

  if (will==='이미 정리해둔 내용이 있음')          add('T14',40);
  if (will==='아직 정리하지 못함')                { add('T15',40); add('T19',20); }
  if (will==='생각은 있지만 문서로 정리하지 않음') { add('T15',25); add('T20',20); }

  if (hasRE) { add('T08',35); }

  if (gift==='일부 있음')    { add('T12',35); add('T13',20); }
  if (gift==='상당히 있음')  { add('T12',50); add('T13',40); }

  if (business==='중요한 비중을 차지함') { add('T17',50); }
  if (business==='조금 있음')           { add('T17',25); }

  const hasOverseas = overseas.some(v => !['none','unknown'].includes(v));
  if (hasOverseas) add('T16',45);

  if (conflict==='조금 있음')   { add('T07',35); add('T13',15); }
  if (conflict==='이미 뚜렷함') { add('T07',55); add('T13',25); add('T06',20); }

  if (docs==='거의 정리되어 있지 않음') { add('T20',35); add('T18',20); }
  if (docs==='일부만 정리되어 있음')     add('T20',20);

  const unknowns = [family,will,gift,business,conflict,docs].filter(v=>v.includes('모르겠음')).length;
  if (unknowns>=2) add('T20', unknowns*10);

  if (!Object.keys(s).length) s['T01']=30;

  return Object.entries(s).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=>TYPES[id]);
}

/* ── 상황별 컨텍스트 모듈 ── */
function getContext(a, types) {
  const lines = [];
  const overseas = Array.isArray(a.overseas) ? a.overseas : [];
  const hasOverseas = overseas.some(v=>!['none','unknown'].includes(v));

  if (types.some(t=>t.includes('전혼')||t.includes('재혼'))) {
    lines.push('전혼 자녀도 법정상속인으로 현배우자 자녀와 동등한 상속분을 가짐. 상속인 범위 정확히 파악 필요.');
  }
  if (types.some(t=>t.includes('유류분'))) {
    lines.push('2026.2.12 민법 개정: 형제자매 유류분 폐지, 패륜상속인 상속권 상실 가능, 기여 보상 증여는 유류분 반환 제외.');
  }
  if (hasOverseas) {
    lines.push('해외 거주 상속인은 서명공증 필요, 외국 국적자는 별도 서류, 해외 금융자산은 국내 신고 의무.');
  }
  if (types.some(t=>t.includes('사업체')||t.includes('지분'))) {
    lines.push('법인 지분은 정관·주주간 계약 확인 필요. 가업상속공제(최대 600억) 검토 가능하나 요건 까다로움.');
  }
  if (a.conflict==='이미 뚜렷함') {
    lines.push('갈등이 있는 경우 유언장 등 문서화가 핵심. 협의 분할 과정에서 갈등 표면화 가능.');
  }
  if (a.gift==='일부 있음'||a.gift==='상당히 있음') {
    lines.push('10년 이내 상속인 증여는 상속재산 합산. 불균등 증여는 특별수익으로 상속분 조정 가능.');
  }
  return lines.join('\n');
}

/* ── Claude API 호출 ── */
async function callClaude(answers, types, score) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 없음');

  const level = score>=70?'주의 필요':score>=40?'확인 필요':'기본 정리';
  const ctx   = getContext(answers, types);

  const presence = Array.isArray(answers.assetPresence)?answers.assetPresence:[];
  const counts   = answers.assetCounts||{};
  const reList   = ['house','land','incomeRealEstate','factory','otherRealEstate']
    .filter(k=>presence.includes(k))
    .map(k=>`${k}:${counts[k]||'1'}`)
    .join(', ') || '없음';

  const overseas = (Array.isArray(answers.overseas)?answers.overseas:[])
    .filter(v=>!['none','unknown'].includes(v)).join(', ')||'없음';

  const prompt = `안심상속 유료 상세리포트를 작성하세요.

[진단]
점수:${score}(${level}), 유형:${types.join('/')}
가족:${answers.family||'-'}, 유언:${answers.will||'-'}, 부동산:${reList}
증여:${answers.gift||'-'}, 사업:${answers.business||'-'}, 해외:${overseas}
갈등:${answers.conflict||'-'}, 자료:${answers.documents||'-'}
${ctx?'\n[참고]\n'+ctx:''}

아래 JSON을 정확히 따라 작성하세요. 각 배열 항목은 반드시 독립된 문자열로 작성하세요.

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
    },
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
        {"title": "항목명1", "content": "설명1"},
        {"title": "항목명2", "content": "설명2"}
      ]
    },
    "questions": {
      "title": "상담 전 질문",
      "questions": ["질문1", "질문2", "질문3", "질문4"]
    },
    "next_steps": {
      "title": "다음 순서",
      "steps": [
        {"order": 1, "title": "단계1", "content": "설명1"},
        {"order": 2, "title": "단계2", "content": "설명2"},
        {"order": 3, "title": "단계3", "content": "설명3"}
      ]
    }
  },
  "legal_notice": "본 리포트는 정보 제공 목적이며 법률·세무 조언을 대체하지 않습니다. 구체적 사항은 변호사·세무사와 상담하세요.",
  "generated_at": "${new Date().toISOString()}"
}

규칙: JSON만 반환. 코드블록 없이. 배열 항목은 반드시 별도 문자열로.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: '안심상속 유료 상세리포트 작성 시스템. 법률·세무 조언 금지. 상황 정리와 준비 안내만. JSON만 반환.',
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const text = data.content.filter(b=>b.type==='text').map(b=>b.text).join('');
  return JSON.parse(text.replace(/```json|```/g,'').trim());
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
    const email   = String(body.email||'').trim();

    // email optional

    const types = matchTypes(answers);

    let report;
    try {
      report = await callClaude(answers, types, score);
    } catch(e) {
      console.error('Claude 오류:', e.message);
      return res.status(502).json({ok:false,message:'리포트 생성 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.'});
    }

    /* Supabase 저장 (실패해도 무시) */
    const sbUrl = (process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.VITE_SUPABASE_ANON_KEY||'';
    if (sbUrl && sbKey) {
      fetch(`${sbUrl}/rest/v1/paid_reports`, {
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':sbKey,'Authorization':'Bearer '+sbKey},
        body: JSON.stringify({lead_id:body.leadId||null,score,level:report.level,matched_types:types,report_json:report,created_at:new Date().toISOString()})
      }).catch(()=>{});
    }

    return res.status(200).json({ok:true,report,meta:{matchedTypes:types,score,level:report.level,generatedAt:report.generated_at}});

  } catch(e) {
    console.error('핸들러 오류:', e);
    return res.status(500).json({ok:false,message:'리포트 생성 중 오류가 발생했습니다.'});
  }
}
