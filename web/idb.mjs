export class BrowserStore {
  constructor(name){
    this.ready=new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,2);
      request.onupgradeneeded=()=>{const db=request.result;for(const [name,keyPath] of [['attempts','id'],['recordings','path'],['packs','id'],['materials','path']])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath});};
      request.onerror=()=>reject(Error('无法打开浏览器存储，请允许此网站保存数据后重试。'));
      request.onblocked=()=>reject(Error('请关闭此网站的其他旧页面后重试。'));
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
    });
  }
  async run(names,mode,work){
    const db=await this.ready;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(names,mode);let result,failure;
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(failure || Error('浏览器保存失败，请保留页面并检查可用存储空间。'));
      tx.onerror=()=>{};
      try{work(tx,value=>{result=value;},error=>{failure=error;tx.abort();});}catch(e){failure=e;tx.abort();}
    });
  }
  list(){return this.run(['attempts'],'readonly',(tx,set)=>{tx.objectStore('attempts').getAll().onsuccess=e=>set(e.target.result);});}
  get(id){return this.run(['attempts'],'readonly',(tx,set,fail)=>{tx.objectStore('attempts').get(id).onsuccess=e=>e.target.result?set(e.target.result):fail(Error('练习记录不存在，请返回首页。'));});}
  add(a){return this.run(['attempts'],'readwrite',(tx,set)=>{tx.objectStore('attempts').add(a);set(a);});}
  change(id,update,blob){
    return this.run(['attempts','recordings'],'readwrite',(tx,set,fail)=>{
      tx.objectStore('attempts').get(id).onsuccess=e=>{
        try{
          if(!e.target.result)throw Error('练习记录不存在');
          const a=update(e.target.result);
          tx.objectStore('attempts').put(a);
          if(blob){const answer=a.answers[blob.questionId];tx.objectStore('recordings').put({path:answer.recording,blob:blob.data});}
          set(a);
        }catch(error){fail(error);}
      };
    });
  }
  blob(path){return this.run(['recordings'],'readonly',(tx,set)=>{tx.objectStore('recordings').get(path).onsuccess=e=>set(e.target.result?.blob);});}
  packs(){return this.run(['packs'],'readonly',(tx,set)=>{tx.objectStore('packs').getAll().onsuccess=e=>set(e.target.result);});}
  material(path){return this.run(['materials'],'readonly',(tx,set)=>{tx.objectStore('materials').get(path).onsuccess=e=>set(e.target.result?.blob);});}
  importPack(pack){return this.run(['packs','materials'],'readwrite',(tx,set)=>{
    for(const file of pack.files)tx.objectStore('materials').put(file);
    for(const exam of pack.exams){const urls=new Set(exam.groups.flatMap(g=>[...(g.images || []),...(g.audio?[g.audio]:[])]));tx.objectStore('packs').put({id:exam.id,exam,media:pack.media.filter(m=>urls.has(m.url)),quality:{sets:(pack.quality?.sets || []).filter(s=>s.examId===exam.id)},importedAt:new Date().toISOString()});}
    set(pack.exams.length);
  });}
  async close(){(await this.ready).close();}
}
