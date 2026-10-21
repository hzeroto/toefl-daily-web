import { SECTIONS } from './contract.mjs';
import { attemptQuestions, attemptStages, isFullAttempt } from './scope.mjs';

export const normalize = value => String(value || '').normalize('NFKC').replace(/[’‘]/g,"'").toLowerCase().replace(/[.,!?;:]/g,'').replace(/\s+/g,' ').trim();
export function grade(exam, attempt) {
  const reviews = new Map((attempt.review?.items || []).map(r=>[r.questionId,r]));
  const questions=attemptQuestions(exam,attempt);
  const results = questions.map(q=>{
    const response = attempt.answers[q.id] || {};
    const objective = ['single-choice','word-completion','sentence-build'].includes(q.type);
    const review = reviews.get(q.id);
    const correct = objective ? [q.answer,...(q.acceptedAnswers || [])].some(a=>normalize(a)===normalize(response.text)) : null;
    return { questionId:q.id,section:q.section,taskType:q.taskType,tags:q.tags,type:q.type,answer:objective?q.answer:undefined,response:response.text || '',recording:response.recording || null,score:objective?(correct?1:0):(review?.score ?? null),maxScore:objective?1:5,status:objective?'graded':review?'reviewed':'pending',correct,feedback:review?.feedback || null,evidence:review?.evidence || [],nextAction:review?.nextAction || null };
  });
  const sections = SECTIONS.filter(section=>questions.some(q=>q.section===section)).map(section=>{
    const items = results.filter(r=>r.section===section), obj = items.filter(r=>r.correct!==null), sub = items.filter(r=>r.correct===null), done=sub.filter(r=>r.score!==null);
    return { section,objectiveEarned:obj.reduce((n,r)=>n+r.score,0),objectiveTotal:obj.length,subjectiveEarned:done.length ? done.reduce((n,r)=>n+r.score,0) : null,subjectiveMax:done.length*5,subjectiveReviewed:done.length,subjectiveTotal:sub.length,pending:sub.length-done.length,officialBand:null };
  });
  const tags = new Map();
  // Unanswered items cost raw points, but do not diagnose a knowledge weakness.
  for (const r of results.filter(r=>r.correct!==null && r.response.trim())) for (const tag of r.tags) {
    const id = `${r.section}:${tag}`;
    const t = tags.get(id) || {section:r.section,tag,total:0,correct:0,questionIds:[]};
    t.total++; t.correct+=r.correct?1:0;
    if (!r.correct) t.questionIds.push(r.questionId);
    tags.set(id,t);
  }
  const weaknesses = [...tags.values()].filter(t=>t.questionIds.length).map(t=>({...t,accuracy:t.correct/t.total,confidence:t.total>=5?'初步证据':'样本较少'})).sort((a,b)=>a.accuracy-b.accuracy);
  return {schemaVersion:'1.0',scoreType:'practice-raw-and-rubric',officialBand:null,sections,results,weaknesses,summary:attempt.review?.summary || null,priorities:attempt.review?.priorities || [],scoringNote:'客观题按已核对答案计原始分；主观题按 ETS 2026 量表作练习评分。没有 ETS 试卷标定与自适应参数，不换算官方 1–6 分。'};
}
export function validateReview(review, exam, attempt) {
  if (review?.schemaVersion!=='1.0' || review.attemptId!==attempt.id || review.examRevision!==exam.contentRevision) throw Error('Review version, attempt or exam revision mismatch');
  if (typeof review.reviewer!=='string' || !review.reviewer.trim() || !Array.isArray(review.rubricSources) || !review.rubricSources.length || !review.rubricSources.every(s=>typeof s==='string' && /^https:\/\//.test(s)) || !Array.isArray(review.items) || !review.items.length) throw Error('Review needs reviewer, sources and items');
  if(review.summary!==undefined && typeof review.summary!=='string')throw Error('Invalid review summary');
  if(review.priorities!==undefined && (!Array.isArray(review.priorities) || review.priorities.some(s=>typeof s!=='string')))throw Error('Invalid review priorities');
  const questions = new Map(attemptQuestions(exam,attempt).map(q=>[q.id,q]));
  const seen = new Set();
  for (const item of review.items) {
    const q = questions.get(item.questionId);
    if (!q || !['essay','spoken'].includes(q.type) || seen.has(q.id)) throw Error(`Invalid or duplicate review item ${item.questionId}`);
    seen.add(q.id);
    if (!Number.isInteger(item.score) || item.score<0 || item.score>5 || item.rubric!==q.rubric) throw Error(`Invalid rubric/score ${q.id}`);
    if (typeof item.feedback!=='string' || !item.feedback.trim() || !Array.isArray(item.evidence) || !item.evidence.length || typeof item.nextAction!=='string' || !item.nextAction.trim()) throw Error(`Missing evidence or next action ${q.id}`);
    if (q.type==='spoken' && (!attempt.answers[q.id]?.recording || item.audioReviewed!==true)) throw Error(`Spoken review must listen to recording: ${q.id}`);
    if (item.evidence.some(e=>typeof e!=='string' || !e.trim())) throw Error(`Invalid evidence ${q.id}`);
  }
  return review;
}
export function trends(attempts) {
  // First exposure only: retakes are deliberately excluded from trend estimates.
  const seen=new Set(), points=[];
  for (const a of [...attempts].filter(a=>a.status==='submitted').sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt))) {
    const repeated=seen.has(a.exam.id); seen.add(a.exam.id);
    const report=grade(a.exam,a);
    const completedAllStages=a.stageHistory?.length===attemptStages(a.exam,a).length;
    points.push({id:a.id,date:a.submittedAt,title:a.exam.title,examId:a.exam.id,mode:a.mode,scope:a.scope,retake:repeated,completedAllStages,included:!repeated && a.mode==='exam' && isFullAttempt(a) && completedAllStages,sections:report.sections});
  }
  return points;
}
