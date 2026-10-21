import { BrowserStore } from './idb.mjs';
import { createAttempt, viewAttempt, mutateAttempt, reviewAttempt, recordAttempt } from './core/attempt.mjs';
import { allQuestions } from './core/contract.mjs';
import { grade, trends } from './core/grading.mjs';
import { MAX_PACK_BYTES, validateLocalPack } from './core/local-pack.mjs';

export async function createBrowserAPI(base,options={}) {
  const store=new BrowserStore(options.databaseName || `toefl-daily:${new URL(base).pathname}`);
  await store.ready;
  let packs=[],exams=[],media=new Map(),activeMedia=new Map(),quality={sets:[]};
  const materials=new Map(),recordings=new Map();
  async function materialURL(path){
    if(!materials.has(path)){const blob=await store.material(path);if(!blob)return null;materials.set(path,URL.createObjectURL(blob));}
    return materials.get(path);
  }
  async function materialMap(entries){const map=new Map();for(const entry of entries){const url=await materialURL(entry.path);if(url)map.set(entry.url,url);}return map;}
  async function loadPacks(){packs=await store.packs();exams=packs.map(p=>p.exam);media=await materialMap(packs.flatMap(p=>p.media));quality={sets:packs.flatMap(p=>p.quality?.sets || [])};}
  await loadPacks();
  async function playback(path){
    if(!recordings.has(path)){const blob=await store.blob(path);if(!blob)throw Error('此浏览器中缺少对应录音，请检查导出的备份。');recordings.set(path,URL.createObjectURL(blob));}
    return recordings.get(path);
  }
  async function view(a){
    const out=viewAttempt(a);
    const entries=a.localMedia || packs.find(p=>p.id===a.exam.id && p.exam.contentRevision===a.exam.contentRevision)?.media || [];
    activeMedia=await materialMap(entries);
    out.materialsAvailable=entries.length>0 && activeMedia.size===entries.length;
    for(const answer of Object.values(out.answers))if(answer.recording)answer.recording=await playback(answer.recording);
    for(const item of out.report?.results || [])if(item.recording)item.recording=await playback(item.recording);
    return out;
  }
  async function packet(id){
    const a=await store.get(id);if(a.status!=='submitted')throw Error('交卷后才可导出评分包。');
    const embeddedRecordings=[];
    for(const [questionId,answer] of Object.entries(a.answers)){
      if(!answer.recording)continue;
      const blob=await store.blob(answer.recording);if(!blob)throw Error('导出失败：对应录音已丢失。');
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      embeddedRecordings.push({questionId,path:answer.recording,mimeType:blob.type,dataBase64:btoa(binary)});
    }
    return {schemaVersion:'1.0',attemptId:a.id,examRevision:a.exam.contentRevision,scope:a.scope,exam:a.exam,answers:a.answers,report:grade(a.exam,a),embeddedRecordings,rubricSources:{writing:'https://www.ets.org/pdfs/toefl/writing-rubrics.pdf',speaking:'https://www.ets.org/pdfs/toefl/speaking-rubrics.pdf'},instructions:'Browser practice export. Decode embeddedRecordings[].dataBase64 to local audio files before listening and grading. Use skills/toefl-daily/SKILL.md grade workflow. Grade only report.results within scope. Import matching review JSON into the website. Do not infer pronunciation from text.'};
  }
  async function request(url,options={}){
    const method=options.method || 'GET',body=typeof options.body==='string'?JSON.parse(options.body):options.body;
    if(url==='/api/dashboard'){
      const attempts=(await store.list()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      return {exams:exams.map(e=>({id:e.id,title:e.title,dateLabel:e.dateLabel,contentRevision:e.contentRevision,qualityNotes:e.qualityNotes,sourceFolder:e.source.folder,sections:['reading','listening','writing','speaking'].map(section=>({section,count:allQuestions(e).filter(q=>q.section===section).length})),stages:e.stages.map(s=>({id:s.id,section:s.section,label:s.label,durationSeconds:s.durationSeconds,count:s.groupIds.reduce((n,id)=>n+e.groups.find(g=>g.id===id).questions.length,0)})),minutes:e.stages.reduce((n,s)=>n+s.durationSeconds/60,0)})),attempts:attempts.map(a=>({id:a.id,examId:a.exam.id,title:a.exam.title,status:a.status,mode:a.mode,scope:a.scope,createdAt:a.createdAt,submittedAt:a.submittedAt,stageIndex:a.stageIndex,minutes:a.exam.stages.filter(s=>!a.scope || a.scope.stageIds.includes(s.id)).reduce((n,s)=>n+s.durationSeconds/60,0),report:a.status==='submitted'?grade(a.exam,a):null})),catalog:{sets:packs.map(p=>({folder:p.exam.source.folder,files:p.media.length,formats:{},incomplete:[]})),totalFiles:packs.reduce((n,p)=>n+p.media.length,0)},quality,trends:trends(attempts),sourceRoot:'此浏览器的本地题库'};
    }
    if(url==='/api/attempts' && method==='POST'){
      const pack=packs.find(p=>p.id===body.examId);if(!pack)throw Error('请先导入这套试卷的本地题包');
      const a=createAttempt(pack.exam,body.mode,body.scope);a.localMedia=structuredClone(pack.media);return view(await store.add(a));
    }
    const match=url.match(/^\/api\/attempts\/([a-f0-9-]{36})(?:\/(packet|review|recordings\/([a-z0-9-]+)))?$/);
    if(!match)throw Error('不支持的在线操作');
    const [,id,action,qid]=match;
    if(method==='GET' && !action)return view(await store.get(id));
    if(method==='PATCH' && !action)return view(await store.change(id,a=>mutateAttempt(a,body)));
    if(method==='GET' && action==='packet')return packet(id);
    if(method==='POST' && action==='review')return view(await store.change(id,a=>reviewAttempt(a,body)));
    if(method==='POST' && qid){
      const a=await store.change(id,a=>recordAttempt(a,qid,body),{questionId:qid,data:body});
      const path=a.answers[qid].recording;if(recordings.has(path)){URL.revokeObjectURL(recordings.get(path));recordings.delete(path);}
      return view(a);
    }
    throw Error('不支持的在线操作');
  }
  return {request,mediaURL:url=>activeMedia.get(url) || media.get(url) || (url.startsWith('blob:')?url:''),packet,
    async importPack(file){if(file.size>MAX_PACK_BYTES)throw Error('题包过大，请分别导入单套试卷');const pack=await validateLocalPack(JSON.parse(await file.text()));const count=await store.importPack(pack);await loadPacks();return count;},
    async downloadPacket(id){const data=await packet(id),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`toefl-${id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);},
    close:()=>store.close()};
}
