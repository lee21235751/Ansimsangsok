const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SB_TABLE = process.env.SUPABASE_LEADS_TABLE || 'leads';
const RESEND_URL = 'https://api.resend.com/emails';

function san(v, n=600){ const s=String(v||'').replace(/\s+/g,' ').trim(); return s.length>n?s.slice(0,n)+'...':s; }
function esc(v){ return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function notify({name,email,memo,score,createdAt}){
  const key=process.env.RESEND_API_KEY;
  const to=process.env.LEAD_NOTIFY_EMAIL||process.env.ADMIN_EMAIL||'';
  const from=process.env.LEAD_NOTIFY_FROM||'안심상속 <leads@send.ansimsangsok.kr>';
  if(!key||!to)return;

  const n=san(name,120)||'이름 없음';
  const e=san(email,180)||'이메일 없음';
  const m=san(memo,800)||'메모 없음';
  const sc=score==null?'없음':String(score);
  const dt=san(createdAt,80);

  const html=`<h2>안심상속 신규 리드 접수</h2>
<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #ddd">
<tr><th align="left" style="border:1px solid #ddd;background:#f7f7f7">이름</th><td style="border:1px solid #ddd">${esc(n)}</td></tr>
<tr><th align="left" style="border:1px solid #ddd;background:#f7f7f7">이메일</th><td style="border:1px solid #ddd">${esc(e)}</td></tr>
<tr><th align="left" style="border:1px solid #ddd;background:#f7f7f7">진단 점수</th><td style="border:1px solid #ddd">${esc(sc)}</td></tr>
<tr><th align="left" style="border:1px solid #ddd;background:#f7f7f7">접수 시각</th><td style="border:1px solid #ddd">${esc(dt)}</td></tr>
</table>
<h3>메모</h3><p style="white-space:pre-wrap">${esc(m)}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0">
<h3>운영자 빠른 응대 문구</h3>
<div style="padding:12px 14px;border:1px solid #e5e7eb;background:#fafafa;border-radius:10px;line-height:1.7">
<p>안녕하세요. 안심상속입니다.</p>
<p>신청해주신 내용을 확인했습니다.</p>
<p>유료 상세리포트는 현재 상황을 정리하고, 확인할 항목과 상담 전 준비할 질문을 정리하는 자료입니다.</p>
<p>리포트 확인을 원하시면 안내드리는 순서에 따라 진행해 주세요.</p>
</div>
<h3>처리 체크리스트</h3>
<ol style="line-height:1.8">
<li>이름과 이메일이 정상인지 확인</li>
<li>메모에 급한 일정이나 특이사항이 있는지 확인</li>
<li>리포트 안내 답장 발송</li>
<li>결제/수령 안내 여부 기록</li>
<li>실제 고객이 아닌 테스트 리드는 삭제 또는 테스트 표시</li>
</ol>`;

  try{
    await fetch(RESEND_URL,{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({from,to:[to],subject:'[안심상속] 신규 리드 접수 - '+n,text:`이름: ${n}\n이메일: ${e}\n점수: ${sc}\n시각: ${dt}\n\n메모:\n${m}`,html})});
  }catch(e){console.error('notify error',e)}
}

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,message:'Method not allowed'})}

  try{
    if(!SB_URL||!SB_KEY){console.error('Missing Supabase env');return res.status(500).json({ok:false,message:'안내자료 신청을 접수하지 못했습니다.'})}

    const b=req.body||{};
    const name=String(b.name||'').trim();
    const email=String(b.email||'').trim();
    const memo=String(b.memo||'').trim();
    const score=Number.isFinite(Number(b.score))?Number(b.score):null;
    const answers=b.answers&&typeof b.answers==='object'?b.answers:{};
    const reportRequestedAt=String(b.reportRequestedAt||'').trim();

    if(!name)return res.status(400).json({ok:false,message:'성함을 입력해주세요.'});
    if(!email||!email.includes('@'))return res.status(400).json({ok:false,message:'이메일을 정확히 입력해주세요.'});

    const createdAt=new Date().toISOString();
    const noteParts=['유입 경로: 안심상속 유료 상세리포트 신청'];
    if(memo)noteParts.unshift('고객 메모: '+memo);
    if(score!=null)noteParts.push('진단 점수: '+score);
    if(reportRequestedAt)noteParts.push('신청 시각: '+reportRequestedAt);
    if(Object.keys(answers).length)noteParts.push('진단 답변: '+JSON.stringify(answers));

    const r=await fetch(`${SB_URL}/rest/v1/${encodeURIComponent(SB_TABLE)}`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Prefer':'return=representation'},
      body:JSON.stringify({name,email,note:noteParts.join('\n'),created_at:createdAt})
    });

    if(!r.ok){console.error('Supabase insert failed',r.status);return res.status(500).json({ok:false,message:'안내자료 신청을 접수하지 못했습니다.'})}

    notify({name,email,memo,score,createdAt}).catch(()=>{});

    return res.status(200).json({ok:true,message:'신청이 접수되었습니다. 이메일 확인 후 안내드립니다.'});
  }catch(e){
    console.error('leads error',e);
    return res.status(500).json({ok:false,message:'안내자료 신청을 접수하지 못했습니다.'});
  }
}
