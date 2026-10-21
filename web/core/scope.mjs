import { allQuestions, SECTIONS } from './contract.mjs';

const labels={reading:'阅读',listening:'听力',writing:'写作',speaking:'口语'};

export function createScope(exam, selection={}) {
  if (!selection || typeof selection!=='object' || Array.isArray(selection) || Object.keys(selection).some(k=>!['section','stageId'].includes(k))) throw Error('Invalid practice scope');
  const {section,stageId}=selection;
  if (section!==undefined && stageId!==undefined) throw Error('Choose a section or a stage, not both');
  if (section!==undefined) {
    if (!SECTIONS.includes(section)) throw Error('Invalid practice section');
    const stageIds=exam.stages.filter(s=>s.section===section).map(s=>s.id);
    if (!stageIds.length) throw Error('Section not found');
    return {kind:'section',label:`${labels[section]}专项`,section,stageIds};
  }
  if (stageId!==undefined) {
    const stage=exam.stages.find(s=>s.id===stageId);
    if (!stage) throw Error('Practice stage not found');
    return {kind:'stage',label:`${stage.label}专项`,section:stage.section,stageIds:[stage.id]};
  }
  return {kind:'full',label:'完整模考',stageIds:exam.stages.map(s=>s.id)};
}

export function attemptStages(exam, attempt) {
  // Missing scope means a full exam for records created before module practice.
  if (!attempt.scope) return exam.stages;
  const ids=attempt.scope.stageIds;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size!==ids.length || ids.some(id=>!exam.stages.some(s=>s.id===id))) throw Error('Invalid saved practice scope');
  return exam.stages.filter(s=>ids.includes(s.id));
}

export function attemptQuestions(exam, attempt) {
  const groups=new Set(attemptStages(exam,attempt).flatMap(s=>s.groupIds));
  return allQuestions(exam).filter(q=>groups.has(q.groupId));
}

export function isFullAttempt(attempt) {
  return !attempt.scope || attempt.scope.kind==='full';
}
