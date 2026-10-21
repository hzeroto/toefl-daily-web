export const SECTIONS = ['reading','listening','writing','speaking'];
export const TYPES = ['single-choice','word-completion','sentence-build','essay','spoken'];
export const RUBRICS = ['ets-2026-email','ets-2026-discussion','ets-2026-repeat','ets-2026-interview'];
export const TASKS = ['complete-words','daily-reading','academic-reading','choose-response','conversation','announcement','academic-talk','build-sentence','write-email','academic-discussion','listen-repeat','take-interview'];
export function validateExam(e) {
  const errors = [];
  const check = (ok,msg) => { if (!ok) errors.push(msg); };
  check(e?.schemaVersion === '1.0','schemaVersion must be 1.0');
  check(/^[a-z0-9-]+$/.test(e?.id || ''),'invalid exam id');
  check(typeof e?.contentRevision === 'string' && e.contentRevision.length > 0,'missing contentRevision');
  check(e?.status === 'ready','only ready exams are playable');
  check(e?.delivery === 'fixed-form-practice','unsupported delivery mode');
  check(e?.profile === 'toefl-ibt-2026','unsupported exam profile');
  check(typeof e?.source?.folder==='string' && Array.isArray(e.source.files) && e.source.files.length>0,'missing source files');
  for(const f of e?.source?.files || []) check(typeof f.path==='string' && /^[a-f0-9]{64}$/.test(f.sha256 || ''),'invalid source fingerprint');
  check(Array.isArray(e?.groups) && e.groups.length > 0,'missing groups');
  check(Array.isArray(e?.stages) && e.stages.length > 0,'missing stages');
  const qids = new Set(), gids = new Set(), covered = [];
  for (const g of e?.groups || []) {
    check(typeof g.id === 'string' && !gids.has(g.id),`duplicate/missing group ${g.id}`); gids.add(g.id);
    check(SECTIONS.includes(g.section),`invalid section ${g.id}`);
    check(TASKS.includes(g.taskType) && !!g.provenance && typeof g.title==='string',`missing task type/title/provenance ${g.id}`);
    check(Array.isArray(g.questions) && g.questions.length > 0,`empty group ${g.id}`);
    check(!g.audio || /^\/media\/[^/]+$/.test(g.audio),`invalid audio ${g.id}`);
    for (const img of g.images || []) check(/^\/assets\/[\w/-]+\.(png|jpg|jpeg|webp)$/i.test(img),`invalid image ${img}`);
    for (const q of g.questions || []) {
      check(typeof q.id === 'string' && /^[a-z0-9-]+$/.test(q.id) && !qids.has(q.id),`duplicate/invalid question ${q.id}`); qids.add(q.id);
      check(TYPES.includes(q.type),`invalid question type ${q.id}`);
      if(q.type!=='word-completion')check(typeof q.prompt==='string' && !!q.prompt,`missing prompt ${q.id}`);
      check(Array.isArray(q.tags) && q.tags.length > 0,`missing tags ${q.id}`);
      if (['single-choice','word-completion','sentence-build'].includes(q.type)) {
        check(typeof q.answer === 'string' && !!q.answer,`missing answer ${q.id}`);
        check(!!q.answerSource && !!q.answerConfidence,`unverified answer ${q.id}`);
      } else {
        check(RUBRICS.includes(q.rubric) && q.maxScore === 5,`invalid rubric ${q.id}`);
      }
      if (q.type === 'single-choice') {
        check(q.options?.length >= 2 && q.options.some(o=>o.id===q.answer),`invalid options/key ${q.id}`);
        check(new Set(q.options?.map(o=>o.id)).size === q.options?.length,`duplicate options ${q.id}`);
      }
      if (q.type === 'word-completion') check(q.answer?.toLowerCase().startsWith(q.prefix?.toLowerCase()) && q.missingLetters === q.answer?.length - q.prefix?.length && g.passage?.includes(`{{${q.id}}}`),`invalid cloze ${q.id}`);
      if (q.type === 'sentence-build') check(Array.isArray(q.wordBank) && q.wordBank.length > 0,`missing word bank ${q.id}`);
      if (q.type === 'spoken') check(!!g.audio && q.responseSeconds > 0 && typeof q.reference==='string' && !!q.reference,`missing spoken audio/timing/reference ${q.id}`);
    }
  }
  const stages = new Set();
  for (const s of e?.stages || []) {
    check(!stages.has(s.id),`duplicate stage ${s.id}`); stages.add(s.id);
    check(Number.isInteger(s.durationSeconds) && s.durationSeconds>0 && SECTIONS.includes(s.section),`invalid stage ${s.id}`);
    check(Array.isArray(s.groupIds) && s.groupIds.length>0,`empty stage ${s.id}`);
    for (const gid of s.groupIds || []) { covered.push(gid); check(e.groups?.find(g=>g.id===gid)?.section===s.section,`stage/group mismatch ${gid}`); }
  }
  check(covered.length === gids.size && new Set(covered).size === gids.size && covered.every(g=>gids.has(g)),'all groups must occur in exactly one stage');
  for (const section of SECTIONS) check(e?.groups?.some(g=>g.section===section),`missing ${section}`);
  if (errors.length) throw Error(errors.join('\n'));
  return e;
}
export function publicExam(e) {
  const out = structuredClone(e);
  delete out.source.files;
  out.source = { folder:out.source.folder,description:out.source.description };
  for (const g of out.groups) for (const q of g.questions) for (const field of ['answer','acceptedAnswers','answerSource','answerConfidence','reference','explanation']) delete q[field];
  return out;
}
export function allQuestions(e) { return e.groups.flatMap(g=>g.questions.map(q=>({...q,section:g.section,taskType:g.taskType,groupId:g.id}))); }
