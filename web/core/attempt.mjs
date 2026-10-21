import { publicExam } from './contract.mjs';
import { grade, validateReview } from './grading.mjs';
import { createScope, attemptStages } from './scope.mjs';

export function createAttempt(exam,mode='exam',selection={}) {
  if(!exam)throw Error('Exam not found');
  if(!['exam','practice'].includes(mode))throw Error('Invalid mode');
  return {schemaVersion:'1.0',id:globalThis.crypto.randomUUID(),exam:structuredClone(exam),mode,scope:createScope(exam,selection),status:'active',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),revision:0,stageIndex:0,groupIndex:0,stageState:'ready',deadline:null,answers:{},playedAudio:[],events:[],stageHistory:[],review:null};
}

export function viewAttempt(a) {
  const {exam,...rest}=a,visible=publicExam(exam),stages=attemptStages(exam,a);
  const ids=new Set(stages.flatMap(s=>s.groupIds));
  visible.stages=stages;visible.groups=visible.groups.filter(g=>ids.has(g.id));
  return {...structuredClone(rest),exam:visible,report:a.status==='submitted'?grade(exam,a):null,expired:a.stageState==='running' && Date.now()>a.deadline};
}

export function mutateAttempt(attempt,body) {
  const a=structuredClone(attempt);
  if(body.revision!==a.revision){const e=Error('练习已在另一页面更新，请刷新后继续。');e.status=409;throw e;}
  if(a.status!=='active')throw Error('Attempt already submitted');
  const stages=attemptStages(a.exam,a),stage=stages[a.stageIndex];
  const group=a.exam.groups.find(g=>g.id===stage.groupIds[a.groupIndex]);
  const action=body.action,expired=a.stageState==='running' && Date.now()>a.deadline;
  if(['answers','navigate','played','recordingStarted'].includes(action) && (a.stageState!=='running' || expired))throw Error('该部分已结束，不能继续修改答案。');
  if(action==='start'){
    if(a.stageState!=='ready')throw Error('Stage already started');
    a.stageState='running';a.deadline=Date.now()+stage.durationSeconds*1000;a.stageStartedAt=new Date().toISOString();
  }else if(action==='answers'){
    for(const [qid,text] of Object.entries(body.answers || {})){
      const q=group.questions.find(q=>q.id===qid);
      if(!q || q.type==='spoken' || typeof text!=='string' || text.length>30000)throw Error('Invalid answer');
      if(q.type==='single-choice' && text && !q.options.some(o=>o.id===text))throw Error('Invalid option');
      a.answers[qid]={...a.answers[qid],text,updatedAt:new Date().toISOString()};
    }
  }else if(action==='navigate'){
    const i=body.groupIndex;
    if(!Number.isInteger(i) || i<0 || i>=stage.groupIds.length || (!stage.allowBack && i!==a.groupIndex+1))throw Error('Invalid navigation');
    const target=a.exam.groups.find(g=>g.id===stage.groupIds[i]);
    if(stage.section==='reading' && target.module<group.module && a.mode==='exam')throw Error('Module already closed');
    a.groupIndex=i;
  }else if(action==='played'){
    if(!group.audio || body.audio!==group.audio)throw Error('Invalid audio');
    if(!a.playedAudio.includes(group.audio))a.playedAudio.push(group.audio);
  }else if(action==='recordingStarted'){
    const q=group.questions[0];if(q.type!=='spoken')throw Error('Not spoken');
    a.answers[q.id]={...a.answers[q.id],recordingStartedAt:new Date().toISOString()};
  }else if(action==='finishStage'){
    if(a.stageState!=='running')throw Error('Stage not started');
    a.stageHistory.push({id:stage.id,startedAt:a.stageStartedAt,endedAt:new Date().toISOString(),timedOut:expired});
    a.stageIndex++;a.groupIndex=0;a.deadline=null;a.stageState='ready';
    if(a.stageIndex===stages.length){a.status='submitted';a.submittedAt=new Date().toISOString();a.stageState='finished';}
  }else if(action==='submit'){
    a.status='submitted';a.submittedAt=new Date().toISOString();a.stageState='finished';a.deadline=null;
  }else throw Error('Unknown action');
  a.revision++;a.updatedAt=new Date().toISOString();return a;
}

export function reviewAttempt(attempt,body) {
  if(attempt.status!=='submitted')throw Error('Submit before review');
  const a=structuredClone(attempt),review=validateReview(body,a.exam,a);
  a.review={...review,items:[...(a.review?.items || []).filter(old=>!review.items.some(n=>n.questionId===old.questionId)),...review.items]};
  a.revision++;a.updatedAt=new Date().toISOString();return a;
}

export function recordAttempt(attempt,qid,blob) {
  const a=structuredClone(attempt),stage=attemptStages(a.exam,a)[a.stageIndex];
  const group=stage && a.exam.groups.find(g=>g.id===stage.groupIds[a.groupIndex]);
  const q=group?.questions.find(q=>q.id===qid && q.type==='spoken'),started=Date.parse(a.answers[qid]?.recordingStartedAt || '');
  if(a.status!=='active' || a.stageState!=='running' || !q || !Number.isFinite(started) || Date.now()>a.deadline+15000 || Date.now()>started+(q.responseSeconds+30)*1000)throw Error('Recording does not belong to the active spoken task');
  const mime=blob.type.split(';')[0],ext={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/wav':'wav'}[mime];
  if(!ext || blob.size<20 || blob.size>20*1024*1024)throw Error('Invalid recording');
  a.answers[qid]={...a.answers[qid],recording:`/recordings/${a.id}/${qid}.${ext}`,recordingBytes:blob.size,recordingMime:mime,updatedAt:new Date().toISOString()};
  a.revision++;a.updatedAt=new Date().toISOString();return a;
}
